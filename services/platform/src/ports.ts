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
// ⏱ 2026-10-01 · fix-india-rail-tax-data: which rail SELLS on web is `checkoutRailFor(market)`
// below, from the rendered CHECKOUT_RAIL_BY_MARKET — a buyer-declared market, never a header.
//
// TELEMETRY (tooling/ports/telemetry.json) · ⏱ 2026-10-02 · port-telemetry, the Worker half:
//   · `errorSinkFor(env)` — the `sentry-envelope` adapter (GLITCHTIP_DSN).
//     `app.onError` still calls `reportWorkerError(` through lib/error-sink.ts, the
//     port's one declared exception (tooling/ports/telemetry.json `handTables`).
//   · `notifierFor(severity, env)` — the route in ports/telemetry.ts
//     NOTIFIER_ROUTES: a primary and an off-Box-B fallback, tried once each.
// Selecting another adapter is an edit to that table and to the switch below,
// never to a caller.
// AI (tooling/ports/ai.json). `aiFor(feature, env, { beforeCall })` is the
// provider and the model for one feature, or why there is none:
//   · the model of each feature is AI_FEATURE_TABLE below — a hand table
//     mirroring ai.json `features`, declared there as a `handTables` waiver until
//     T17 renders it with tooling/ports/render.mjs (which renders payments
//     today); test/ai-port.test.ts fails on any difference. Every
//     model is NULL until train-st-ai-customer-pays (T17) measures the cheapest
//     model that meets each feature's quality bar, so today every feature is
//     "no model yet" and nothing can call a model;
//   · 🔴 NO METER, NO PROVIDER: without T17's `beforeCall` (the reservation) no
//     provider is built, and the adapter refuses on its own as well — two locks
//     on the one rule that no call is made that the customer has not paid for;
//   · AI_COST_MODEL is the price of every model a call may reach (the candidates
//     and their fallbacks), AI_FALLBACKS each model's priced fallback chain, and
//     each feature's maxInputTokens its input cap — together aiLimits(), which
//     the adapter checks BEFORE the wire and the meter settles with
//     (ports/ai.ts reserveOrRefuse, settle). All mirror ai.json.
// The stub (services/_shared/src/ports/fakes/ai.ts) is never selected here.
//
// AUTH (tooling/ports/auth.json) · ⏱ 2026-10-03 · port-auth, the Worker half:
//   · `identityFor(env)` — the `gotrue` IdentityAdmin (adapters/identity/gotrue.ts)
//     on SUPABASE_URL and the service key: the native sign-in relay, the desktop
//     hand-off, the session list and revoke, the account read and delete, and the
//     keep-alive. No other module builds an identity-provider URL (assert-ports
//     limb 4). The fake (ports/fakes/identity.ts) is never selected here.
// ⏱ 2026-10-01 · fix-india-rail-tax-data: which rail SELLS on web is `checkoutRailFor(market)`
// below, from the rendered CHECKOUT_RAIL_BY_MARKET — a buyer-declared market, never a header.
// ─────────────────────────────────────────────────────────────────────────────
import type { AiBeforeCall, AiCostModel, AiEffort, AiFeature, AiLimits, AiModelId, AiProvider } from '../../_shared/src/ports/ai';
import { AI_MODEL_MAX_OUTPUT_TOKENS } from '../../_shared/src/ports/ai';
import type { MailSenders, MailStream, MailTransport } from '../../_shared/src/ports/mail';
import { createAnthropicAi } from './adapters/ai/anthropic';
import { createResendMail } from './adapters/mail/resend';
import { MAIL_FROM } from './generated/entity';
import type { Env } from './types';
import { isMoneyEnvironment, type MoneyEnvironment } from './lib/mor/contract';
import type { RailInbound, RailOutbound, SecretReader } from '../../_shared/src/ports/payments';
import { CHECKOUT_RAIL_BY_MARKET, MOR_VERIFIER_IDS, PAYMENTS_ADAPTERS, type PaymentsAdapterId, type PortEnvironment } from './generated/ports';
import { paddleVerifier } from './lib/mor/paddle';
import { razorpayVerifier } from './lib/mor/razorpay';
import { revenuecatVerifier } from './lib/mor/revenuecat';
import { paddleRail } from './lib/mor/paddle-rail';
import { razorpayRail } from './lib/mor/razorpay-rail';
import { fakeVerifier, makeFakeRail } from '../../_shared/src/ports/fakes/payments';
import { RAIL_PRICE_IDS } from './routes/rail-price-ids';
import { NOTIFIER_ROUTES, withFallback } from '../../_shared/src/ports/telemetry';
import type { AlertSeverity, ErrorSink, Notifier, NotifierId } from '../../_shared/src/ports/telemetry';
import { sentryEnvelopeSink } from '../../_shared/src/adapters/telemetry/sentry-envelope';
import { ntfyNotifier } from '../../_shared/src/adapters/telemetry/notify-ntfy';
import { webhookNotifier } from '../../_shared/src/adapters/telemetry/notify-webhook';
import { mailNotifier } from '../../_shared/src/adapters/telemetry/notify-mail';
import type { IdentityAdmin } from '../../_shared/src/ports/identity';
import { gotrueIdentityAdmin } from './adapters/identity/gotrue';

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
  // ⏱ 2026-10-01 · fix-india-rail-tax-data (O-RAZORPAY-CHECKOUT-ADAPTER): checkout (a subscription's hosted
  // page) and cancel at the cycle end. Its plan ids are RAIL_PRICE_IDS.razorpay — empty until the plans
  // exist, so every checkout answers `invalid`, nothing sent. Selected only via `checkoutRailFor('IN')`.
  razorpay: razorpayRail,
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
 * (`checkoutRailFor(market)`, formerly CHECKOUT_RAIL_ID) is passed straight in: the null test is made here, on a typed
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

/**
 * ⏱ 2026-10-01 · fix-india-rail-tax-data · THE WEB CHECKOUT RAIL FOR A BUYER-DECLARED MARKET.
 *
 * Pure, and the ONLY reader of the rendered CHECKOUT_RAIL_BY_MARKET (tooling/ports/render.mjs,
 * from tooling/channel-register.json's `web` purchaseRail: `rail` is the default, `regionRails`
 * the per-country rail). `market` is what the BUYER declared in the checkout request, validated
 * by the caller to ISO 3166-1 alpha-2; null, unknown or a market with no region rail → the
 * default rail. It is NEVER `cf.country` or any IP geolocation (Q2 is ruled): a VPN or a
 * traveller would otherwise be routed to a rail they cannot pay on, and the route would be
 * deciding money from a header nobody signed.
 *
 * THE BACKSTOP IS THE RAIL'S, NOT OURS: the Razorpay account accepts DOMESTIC instruments only
 * (international cards off), so a buyer outside India who declares `IN` cannot complete the
 * payment there. That is an OWNER / ACCOUNT setting on the Razorpay dashboard, not code, and
 * nothing here can verify it — Private/runbooks carry the switch.
 */
export function checkoutRailFor(market: string | null): PaymentsAdapterId | null {
  const byMarket = CHECKOUT_RAIL_BY_MARKET;
  if (market !== null && /^[A-Z]{2}$/.test(market) && Object.hasOwn(byMarket, market)) return byMarket[market] ?? null;
  return byMarket.default ?? null;
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

/**
 * ⏱ 2026-10-03 · port-auth. The identity provider, on this Worker's credentials
 * (tooling/ports/auth.json, the `IdentityAdmin` half): GoTrue at `SUPABASE_URL`,
 * or at `base` for a call that names another origin (a keep-alive target).
 * `fetchImpl` is the injection a caller already had (lib/reminders.ts).
 */
export function identityFor(
  env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY' | 'SUPABASE_ANON_KEY'>,
  opts: { base?: string; fetchImpl?: typeof fetch } = {},
): IdentityAdmin {
  return gotrueIdentityAdmin({
    base: opts.base ?? env.SUPABASE_URL,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    publicKey: env.SUPABASE_ANON_KEY,
    fetchImpl: opts.fetchImpl,
  });
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

/**
 * Per feature: the adapter, the model (null until T17 measures), its effort, and its INPUT CAP (null: every call refused).
 *
 * The import cap, 24,000, admits the feature's DECLARED call plus one screenshot under the
 * conservative bound (ports/ai.ts estimateInputTokens, 1 token per UTF-8 byte):
 *   · the declared 3,000 input tokens (instructions + paste, ai.json tokensPerCall.input) as
 *     text run about 4 bytes per token — "100,000 characters (roughly 25,000 tokens)", the
 *     claude-api skill's managed-agents-tools.md, cached 2026-09-25 — so 12,000 bytes;
 *   · one screenshot: IMAGE_TOKEN_CEILING, 4,784; the framing: REQUEST_OVERHEAD_TOKENS, 2,048;
 *   · 18,832 so far, which leaves 5,168 bytes for the output schema.
 * The bound stays 1 token per byte (a token never covers less than a byte), so a call's real
 * input is never above the cap the reservation is priced at. test/ai-port.test.ts holds both sides.
 */
export const AI_FEATURE_TABLE: Readonly<Record<AiFeature, { adapter: 'anthropic'; model: AiModelId | null; effort: AiEffort | null; maxInputTokens: number | null }>> = {
  import: { adapter: 'anthropic', model: null, effort: null, maxInputTokens: 24000 },
  review: { adapter: 'anthropic', model: null, effort: null, maxInputTokens: null },
};

/** The price per million tokens of every model a call may reach — the candidates and their fallbacks (ai.json, `asOf` and `verify` there). */
export const AI_COST_MODEL: AiCostModel = {
  'claude-haiku-4-5': { inputUsdPerMTok: 1, outputUsdPerMTok: 5, cacheReadUsdPerMTok: 0.1, cacheWriteUsdPerMTok: 1.25, asOf: '2026-10-02', verify: 'tooling/ports/ai.json' },
  'claude-sonnet-5-5': { inputUsdPerMTok: 2, outputUsdPerMTok: 10, cacheReadUsdPerMTok: 0.2, cacheWriteUsdPerMTok: 2.5, asOf: '2026-10-02', verify: 'tooling/ports/ai.json' },
  'claude-opus-5-5': { inputUsdPerMTok: 4, outputUsdPerMTok: 20, cacheReadUsdPerMTok: 0.2, cacheWriteUsdPerMTok: 5, asOf: '2026-10-02', verify: 'tooling/ports/ai.json' },
  'claude-opus-4-8': { inputUsdPerMTok: 5, outputUsdPerMTok: 25, cacheReadUsdPerMTok: 0.5, cacheWriteUsdPerMTok: 6.25, asOf: '2026-10-02', verify: 'tooling/ports/ai.json' },
  'claude-opus-5': { inputUsdPerMTok: 5, outputUsdPerMTok: 25, cacheReadUsdPerMTok: 0.5, cacheWriteUsdPerMTok: 6.25, asOf: '2026-10-02', verify: 'tooling/ports/ai.json' },
};

/** Per model, the refusal-fallback chain sent with it — every model in it priced above (ai.json `cost.models.<m>.fallbacks`). */
export const AI_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'claude-opus-5-5': ['claude-opus-4-8', 'claude-opus-5'],
};

/** The spend limits every AI provider is built with, from the three tables above.
 *  A function, not a const: a top-level property read is kept by esbuild, so a
 *  const would ship these tables in a Worker that calls no model. */
export function aiLimits(): AiLimits {
  return {
    prices: AI_COST_MODEL,
    maxInputTokens: { import: AI_FEATURE_TABLE.import.maxInputTokens, review: AI_FEATURE_TABLE.review.maxInputTokens },
    fallbacks: AI_FALLBACKS,
    maxOutputTokens: AI_MODEL_MAX_OUTPUT_TOKENS,
  };
}

export type AiSelection =
  | { readonly ok: true; readonly feature: AiFeature; readonly model: AiModelId; readonly effort: AiEffort | null; readonly provider: AiProvider }
  | { readonly ok: false; readonly detail: string };

/** The provider and model for one feature — or why there is none. Never the key. */
export function aiFor(
  feature: AiFeature,
  env: Pick<Env, 'NIKATRU_ANTHROPIC_API_KEY'>,
  wiring: { readonly beforeCall?: AiBeforeCall; readonly fetchImpl?: typeof fetch } = {},
): AiSelection {
  const row = AI_FEATURE_TABLE[feature];
  if (!row.model) return { ok: false, detail: `ai: feature ${feature} has no model yet (tooling/ports/ai.json features.${feature}.model)` };
  if (row.maxInputTokens === null) return { ok: false, detail: `ai: feature ${feature} has no input cap (tooling/ports/ai.json features.${feature}.maxInputTokens), so no provider is built` };
  if (!wiring.beforeCall) return { ok: false, detail: 'ai: no meter is wired (beforeCall), so no provider is built' };
  const apiKey = env.NIKATRU_ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'ai: NIKATRU_ANTHROPIC_API_KEY is not set on this Worker' };
  const provider = createAnthropicAi({ apiKey, beforeCall: wiring.beforeCall, limits: aiLimits(), ...(wiring.fetchImpl ? { fetchImpl: wiring.fetchImpl } : {}) });
  return { ok: true, feature, model: row.model, effort: row.effort, provider };
}
