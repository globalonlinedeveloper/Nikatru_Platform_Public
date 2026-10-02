// ─────────────────────────────────────────────────────────────────────────────
// ports.ts — THE PLATFORM WORKER'S COMPOSITION ROOT. The one module that imports
// an adapter (tooling/ports/README.md §3; assert-ports limb 4 holds it): every
// other module asks for a port here and never learns who answers it.
//
// MAIL (tooling/ports/mail.json). `mailFor(stream, env)` is the MailTransport for
// one stream, or null when the stream's key is not set on this Worker (the caller
// records "not configured" and sends nothing — a notice and a reminder are
// allowed to not happen; the row they are about is already stored).
//   · The From of each stream is the entity source's, from src/generated/entity.ts.
//   · The adapter and secret of each stream are MAIL_STREAM_TABLE below — a hand
//     table mirroring mail.json `streams`, declared there as a `handTables` waiver
//     until the port renderer lands; test/mail-port.test.ts fails on any
//     difference between the two.
//   · `reminders` takes RESEND_REMINDERS_API_KEY when it is set, else the reports
//     key under the reminder digest's own small daily cap (lib/reminders.ts
//     MAX_REMINDER_MAILS_PER_DAY — never raised here).
// The fake (services/_shared/src/ports/fakes/mail.ts) is never selected here:
// it serves tests only, which build it themselves, so it is in no bundle.
// The SES adapter is a draft and is not imported here: nothing can select it.
//
// PAYMENTS (tooling/ports/payments.json) · ⏱ 2026-10-01 · port-pay-core. Routes ask for a
// rail by the provider id a row or a URL carries — `railFor`, `inboundFor` — and never
// name a vendor. Which adapters exist, in which environment, and how each cancels is the
// RENDERED table (src/generated/ports.ts, from payments.json by tooling/ports/render.mjs).
// The two binding records below are typed by the rendered id union: a rendered adapter
// with no binding, or a binding for an id the registry does not list, fails `tsc`.
//
// TELEMETRY (tooling/ports/telemetry.json) · ⏱ 2026-10-02 · port-telemetry, the Worker half:
//   · `errorSinkFor(env)` — the `sentry-envelope` adapter (GLITCHTIP_DSN).
//     `app.onError` still calls `reportWorkerError(` through lib/error-sink.ts, the
//     port's one declared exception (tooling/ports/telemetry.json `handTables`).
//   · `notifierFor(severity, env)` — the route in ports/telemetry.ts
//     NOTIFIER_ROUTES: a primary and an off-Box-B fallback, tried once each.
// Selecting another adapter is an edit to that table and to the switch below,
// never to a caller.
// ─────────────────────────────────────────────────────────────────────────────
import type { MailSenders, MailStream, MailTransport } from '../../_shared/src/ports/mail';
import { createResendMail } from './adapters/mail/resend';
import { MAIL_FROM } from './generated/entity';
import type { Env } from './types';
import { isMoneyEnvironment, type MoneyEnvironment } from './lib/mor/contract';
import type { RailInbound, RailOutbound, SecretReader } from '../../_shared/src/ports/payments';
import { MOR_VERIFIER_IDS, PAYMENTS_ADAPTERS, type PaymentsAdapterId, type PortEnvironment } from './generated/ports';
import { paddleVerifier } from './lib/mor/paddle';
import { razorpayVerifier } from './lib/mor/razorpay';
import { revenuecatVerifier } from './lib/mor/revenuecat';
import { paddleRail } from './lib/mor/paddle-rail';
import { fakeVerifier, makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import { RAIL_PRICE_IDS } from './routes/rail-price-ids';
import { NOTIFIER_ROUTES, withFallback } from '../../_shared/src/ports/telemetry';
import type { AlertSeverity, ErrorSink, Notifier, NotifierId } from '../../_shared/src/ports/telemetry';
import { sentryEnvelopeSink } from '../../_shared/src/adapters/telemetry/sentry-envelope';
import { ntfyNotifier } from '../../_shared/src/adapters/telemetry/notify-ntfy';
import { webhookNotifier } from '../../_shared/src/adapters/telemetry/notify-webhook';
import { mailNotifier } from '../../_shared/src/adapters/telemetry/notify-mail';

type MailSecret = 'RESEND_API_KEY' | 'RESEND_REMINDERS_API_KEY';

/** Per stream: the adapter id and its secret NAMES, first one set wins. */
export const MAIL_STREAM_TABLE: Readonly<Record<MailStream, { adapter: 'resend'; secrets: readonly MailSecret[] }>> = {
  reports: { adapter: 'resend', secrets: ['RESEND_API_KEY'] },
  reminders: { adapter: 'resend', secrets: ['RESEND_REMINDERS_API_KEY', 'RESEND_API_KEY'] },
};

/** The From of every stream, from the entity source. */
export const MAIL_SENDERS: MailSenders = MAIL_FROM;

/** The secret NAME a stream would send with on this Worker, or null. Never the value. */
export function mailSecretFor(stream: MailStream, env: Pick<Env, MailSecret>): MailSecret | null {
  return MAIL_STREAM_TABLE[stream].secrets.find((n) => !!env[n]) ?? null;
}

/** The MailTransport for one stream, or null when its key is not set. */
export function mailFor(stream: MailStream, env: Pick<Env, MailSecret>, fetchImpl?: typeof fetch): MailTransport | null {
  const secret = mailSecretFor(stream, env);
  if (!secret) return null;
  return createResendMail({ apiKey: env[secret] as string, senders: MAIL_SENDERS, ...(fetchImpl ? { fetchImpl } : {}) });
}

/** Each adapter's inbound half, keyed by its rendered id. */
const INBOUND: { readonly [K in PaymentsAdapterId]: RailInbound } = {
  paddle: paddleVerifier,
  razorpay: razorpayVerifier,
  revenuecat: revenuecatVerifier,
  fake: fakeVerifier,
};

/** Each adapter's outbound half, or null for a rail with no outbound verb built yet. */
const OUTBOUND: { readonly [K in PaymentsAdapterId]: ((secrets: SecretReader) => RailOutbound) | null } = {
  paddle: paddleRail,
  razorpay: null, // O-RAZORPAY-CHECKOUT-ADAPTER: checkout, cancel and the plan ids arrive with Razorpay PR B.
  revenuecat: null, // a store rail: only the store that billed can cancel (cancel path `store`).
  // The fake sells what Paddle prices, so a sandbox rehearses the same catalogue.
  fake: () => makeFakeRail((appId, offeringId) => RAIL_PRICE_IDS.paddle?.[appId]?.[offeringId] !== undefined),
};

const ROW = new Map(PAYMENTS_ADAPTERS.map((a) => [a.id as string, a]));

/**
 * Every rail that verifies REAL money, in the rendered order (MOR_VERIFIER_IDS: the non-fake
 * adapters declaring `verify`). lib/mor/registry.ts re-exports it and `verifierFor` reads it; the
 * fake is reached only through `inboundFor`, in the environments the registry lists for it.
 */
export const MOR_VERIFIERS: readonly RailInbound[] = MOR_VERIFIER_IDS.map((id) => INBOUND[id]);

/** True when `provider` is a payments adapter this environment may serve. */
export function servesIn(provider: string, environment: PortEnvironment): boolean {
  return ROW.get(provider)?.environments.includes(environment) ?? false;
}

/**
 * The inbound verifier for a webhook's provider segment, or null — and null in an
 * environment the registry does not list it for, so `/v1/money/fake` is a 404 on a
 * live deploy exactly as an unknown provider is.
 */
export function inboundFor(provider: string, environment: MoneyEnvironment | null): RailInbound | null {
  const row = ROW.get(provider);
  if (row === undefined) return null;
  if (environment !== null && !row.environments.includes(environment)) return null;
  return INBOUND[row.id];
}

/**
 * The outbound rail for a provider id, bound to this Worker's secrets BY NAME, or null
 * when the registry lists no outbound half for it. Callers narrow with `railCan`.
 *
 * `provider` is `string | null` so a RENDERED selection that may be null
 * (CHECKOUT_RAIL_ID) is passed straight in: the null test is made here, on a typed
 * parameter, and never by a route against a generated constant whose value the build
 * already fixes (#1127, CodeQL #548 js/comparison-between-incompatible-types).
 *
 * The SAME environment rule as `inboundFor` (#1127 money review, finding 2): a rail the
 * registry does not list for this deploy's MONEY_ENVIRONMENT binds to null, so a row
 * carrying `provider = 'fake'` can never be "cancelled" against an in-memory rail on a
 * deployed Worker. An unset or unrecognised MONEY_ENVIRONMENT reads as `live`, the
 * narrowest set: a misconfigured Worker never widens what it serves (every deploy sets
 * it; wrangler.jsonc and assert-money-config.mjs hold that).
 */
export function railFor(provider: string | null, env: Env): RailOutbound | null {
  if (provider === null) return null;
  const row = ROW.get(provider);
  if (row === undefined) return null;
  const environment: MoneyEnvironment = isMoneyEnvironment(env.MONEY_ENVIRONMENT) ? env.MONEY_ENVIRONMENT : 'live';
  if (!row.environments.includes(environment)) return null;
  const make = OUTBOUND[row.id];
  if (make === null) return null;
  const secrets: SecretReader = (name) => {
    const v = (env as unknown as Record<string, unknown>)[name];
    return typeof v === 'string' ? v : undefined;
  };
  return make(secrets);
}

/** The port's generic accessor (tooling/ports/README.md §3): the payments adapters a deploy may select. */
export function portFor(port: 'payments', environment: PortEnvironment): readonly PaymentsAdapterId[] {
  if (port !== 'payments') return [];
  return PAYMENTS_ADAPTERS.filter((a) => a.environments.includes(environment)).map((a) => a.id);
}

/** One notifier adapter by its wire id (tooling/ports/telemetry.json). */
export function notifierAdapter(id: NotifierId, env: Env): Notifier {
  switch (id) {
    case 'ntfy':
      return ntfyNotifier(env);
    case 'webhook':
      return webhookNotifier(env, 'nikatru-platform');
    case 'mail':
      return mailNotifier();
  }
}

/** The owner-alert channel for `severity`: its primary, then its fallback once. */
export function notifierFor(severity: AlertSeverity, env: Env): Notifier {
  const route = NOTIFIER_ROUTES[severity];
  return withFallback(notifierAdapter(route.primary, env), route.fallback ? notifierAdapter(route.fallback, env) : null);
}

/** The telemetry port's ErrorSink adapter for this Worker. */
export function errorSinkFor(env: Env): ErrorSink {
  return sentryEnvelopeSink(env);
}
