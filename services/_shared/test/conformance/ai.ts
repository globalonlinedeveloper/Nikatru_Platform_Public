// ─────────────────────────────────────────────────────────────────────────────
// conformance/ai.ts — THE AI PORT'S CONFORMANCE SUITE. Every server adapter of
// tooling/ports/ai.json passes these scenarios, each against its OWN bytes.
//
// A suite is a scenario list plus a per-adapter fixture (tooling/ports/README.md
// §3 "Conformance"): the adapter's test hands `runAiConformance` one harness
// builder per scenario — for the Anthropic adapter, the SDK over a carrier that
// answers with a recorded Messages API body; for the stub, the stub scripted to
// answer the same way. Each builder is handed the meter (`beforeCall`) the
// scenario needs, so the suite — not the fixture — decides whether a call is
// reserved. 🔴 THE RUNNER THROWS WHEN A SCENARIO HAS NO FIXTURE: a missing
// fixture is never a skip.
//
// assert-ports limb 6 counts an adapter conformant when its test file CALLS
// `runAiConformance` and ai.json names no pending case for it.
//
// The scenarios (exported, so the suite's own red controls —
// test/ai-conformance.test.ts — can run one against a mutated adapter):
//   structured-rows     an ended answer comes back as rows that validate
//                       against the schema, from one call
//   refusal             a `refusal` stop is `refused` with NO output, and its
//                       usage is still reported (it is billed)
//   max-tokens          a `max_tokens` stop is `incomplete` with NO output — the
//                       stop reason is read before the content
//   usage-reported      input, output, cache-read and cache-write tokens reach
//                       the outcome as the carrier reported them
//   reservation-refused a refused reservation is `unavailable` and NOTHING
//                       reaches the carrier (the counting carrier sees 0)
//   no-meter            with no `beforeCall` wired, every call is `unavailable`
//                       and nothing reaches the carrier (CUSTOMER-PAYS)
//   key-not-logged      the adapter's key never appears in a console line, an
//                       outcome, or the error-sink envelope built from one,
//                       across success and every failure
//   rate-limited        a 429 is `retryable`
//   server-error        a 5xx is `retryable`
//   bad-request         a 400 is `invalid`, not retryable
//   model-from-config   two requests naming two models put two different
//                       `model` values on the wire
//   unpriced-model      a model with no price (or a fallback with none) is refused
//                       BEFORE the reservation and the wire
//   no-input-cap        a feature with no input cap in config is refused
//   input-over-cap      an input over its feature's cap is refused before the
//                       reservation and the wire
//   fallback-metered    a declined attempt and the fallback that answered are BOTH
//                       billed, each at its own model's prices (a hand computation)
//   reservation-covers-charge  the reservation is the worst case: never below the
//                       charge, and settling releases the difference
//   timeout-settles-at-reservation  no answer is usage UNKNOWN: it settles at the
//                       reservation, never at zero
// ─────────────────────────────────────────────────────────────────────────────
import type { AiAttempt, AiBeforeCall, AiCostModel, AiLimits, AiModelId, AiOutcome, AiProvider, AiRequest, AiReservationRequest, AiUsage } from '../../src/ports/ai';
import { AI_MODEL_MAX_OUTPUT_TOKENS, attemptsUsd, settle, worstCaseUsd } from '../../src/ports/ai';
import { buildEnvelope } from '../../src/error-sink';

export const AI_SCENARIOS = [
  'structured-rows',
  'refusal',
  'max-tokens',
  'usage-reported',
  'reservation-refused',
  'no-meter',
  'key-not-logged',
  'rate-limited',
  'server-error',
  'bad-request',
  'model-from-config',
  'unpriced-model',
  'no-input-cap',
  'input-over-cap',
  'fallback-metered',
  'reservation-covers-charge',
  'timeout-settles-at-reservation',
] as const;
export type AiScenario = (typeof AI_SCENARIOS)[number];

/** One scenario's harness: the provider, and what reached its carrier. */
export interface AiHarness {
  readonly provider: AiProvider;
  /** Calls that reached the carrier (HTTP requests, or the stub's wire). */
  calls(): number;
  /** The `model` of every call that reached the carrier, in order. */
  models(): string[];
  /** For usage-reported: the usage the carrier's answer carried. */
  readonly expectedUsage?: AiUsage;
}

export interface AiConformanceSubject {
  /** The adapter id under test. */
  readonly adapter: string;
  /** The key the harnesses build the adapter with: a sentinel, never a real key. */
  readonly secret: string;
  /** One harness builder per scenario, given the meter the scenario wants; a missing one throws. */
  readonly fixtures: Partial<Record<AiScenario, (beforeCall: AiBeforeCall | undefined) => AiHarness | Promise<AiHarness>>>;
}

/** The output shape every scenario asks for. */
export const CONFORMANCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount'],
        properties: { name: { type: 'string' }, amount: { type: 'number' } },
      },
    },
  },
} as const;

/** What a fixture answers an ended call with: rows that validate. */
export const CONFORMANCE_ROWS_TEXT = JSON.stringify({ rows: [{ name: 'Fixture streaming', amount: 9.99 }] });
/** A truncated answer: what a `max_tokens` stop leaves behind. Never rows. */
export const CONFORMANCE_TRUNCATED_TEXT = '{"rows":[{"name":"Fixture str';

export const conformanceRequest = (model: AiModelId = 'claude-haiku-4-5'): AiRequest => ({
  feature: 'import',
  model,
  system: 'Extract the subscriptions in the input as rows.',
  input: 'conformance input',
  schema: CONFORMANCE_SCHEMA,
  maxOutputTokens: 512,
});

/**
 * The limits every harness is built with — the prices of tooling/ports/ai.json
 * (read 2026-10-02), an import cap, NO cap for review, and Opus 5.5's priced
 * fallback chain.
 */
const price = (input: number, output: number, cacheRead: number, cacheWrite: number) =>
  ({ inputUsdPerMTok: input, outputUsdPerMTok: output, cacheReadUsdPerMTok: cacheRead, cacheWriteUsdPerMTok: cacheWrite, asOf: '2026-10-02', verify: 'tooling/ports/ai.json' });
export const CONFORMANCE_PRICES: AiCostModel = {
  'claude-haiku-4-5': price(1, 5, 0.1, 1.25),
  'claude-sonnet-5-5': price(2, 10, 0.2, 2.5),
  'claude-opus-5-5': price(4, 20, 0.2, 5),
  'claude-opus-4-8': price(5, 25, 0.5, 6.25),
  'claude-opus-5': price(5, 25, 0.5, 6.25),
};
export const CONFORMANCE_INPUT_CAP = 8000;
export const CONFORMANCE_LIMITS: AiLimits = {
  prices: CONFORMANCE_PRICES,
  maxInputTokens: { import: CONFORMANCE_INPUT_CAP, review: null },
  fallbacks: { 'claude-opus-5-5': ['claude-opus-4-8', 'claude-opus-5'] },
  maxOutputTokens: AI_MODEL_MAX_OUTPUT_TOKENS,
};

/**
 * The fallback-metered fixture: Opus 5.5 declines mid-output, Opus 4.8 answers.
 * By hand, at the prices above:
 *   Opus 5.5  1000 in × 4 + 200 out × 20 + 1500 cache-write × 5 = 15,500 / 1e6 = 0.0155
 *   Opus 4.8  2500 in × 5 + 400 out × 25                          = 22,500 / 1e6 = 0.0225
 *   charge                                                                       0.0380 USD
 */
export const FALLBACK_ATTEMPTS: readonly AiAttempt[] = [
  { model: 'claude-opus-5-5', usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 1500 } },
  { model: 'claude-opus-4-8', usage: { inputTokens: 2500, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 } },
];
export const FALLBACK_CHARGE_USD = 0.038;

/** The meter's answers. GRANT grants; `recordingGrant` grants and keeps every request it was asked. */
export const GRANT: AiBeforeCall = async () => ({ ok: true, id: 'reservation-1' });
export const recordingGrant = (into: AiReservationRequest[]): AiBeforeCall => async (r) => {
  into.push(r);
  return { ok: true, id: `reservation-${into.length}` };
};
export const REFUSE: AiBeforeCall = async () => ({ ok: false, detail: 'no credits' });

const fail = (scenario: string, what: string): never => {
  throw new Error(`ai conformance ${scenario}: ${what}`);
};

function expectFailure(scenario: string, out: AiOutcome, kind: string, retryable: boolean): void {
  if (out.ok) return fail(scenario, `expected ${kind}, got ok`);
  if (out.kind !== kind) fail(scenario, `expected kind ${kind}, got ${out.kind} (${out.detail})`);
  if (out.retryable !== retryable) fail(scenario, `expected retryable ${retryable}, got ${out.retryable}`);
  if ('output' in out) fail(scenario, `a ${kind} outcome carries output`);
}

/** Run ONE scenario against one harness; throws (with the reason) when the adapter does not conform. */
export async function checkAiScenario(scenario: AiScenario, h: AiHarness, secret: string, reservations: readonly AiReservationRequest[] = []): Promise<void> {
  const p = h.provider;
  switch (scenario) {
    case 'structured-rows': {
      const out = await p.complete(conformanceRequest());
      if (!out.ok) return fail(scenario, `expected ok, got ${out.kind} (${out.detail})`);
      // The type says end_turn; the check is for an adapter whose runtime value says otherwise.
      const stop: string = out.stopReason;
      if (stop !== 'end_turn') fail(scenario, `stopReason ${stop}`);
      const rows = (out.output as { rows?: unknown })?.rows;
      if (!Array.isArray(rows) || rows.length === 0) fail(scenario, 'no rows came back');
      if (JSON.stringify(out.output) !== CONFORMANCE_ROWS_TEXT) fail(scenario, 'the rows are not the ones the carrier answered');
      if (h.calls() !== 1) fail(scenario, `expected 1 call, got ${h.calls()}`);
      return;
    }
    case 'refusal': {
      const out = await p.complete(conformanceRequest());
      expectFailure(scenario, out, 'refused', false);
      if (!out.ok && out.stopReason !== 'refusal') fail(scenario, `stopReason ${String(out.stopReason)}`);
      if (!out.ok && !out.usage) fail(scenario, 'a refusal is billed, and its usage was not reported');
      return;
    }
    case 'max-tokens': {
      const out = await p.complete(conformanceRequest());
      expectFailure(scenario, out, 'incomplete', false);
      if (!out.ok && out.stopReason !== 'max_tokens') fail(scenario, `stopReason ${String(out.stopReason)}`);
      if (!out.ok && !out.usage) fail(scenario, 'a truncation is billed, and its usage was not reported');
      return;
    }
    case 'usage-reported': {
      const want = h.expectedUsage ?? fail(scenario, 'the fixture names no expectedUsage');
      if (want.cacheReadTokens === 0 || want.cacheWriteTokens === 0) fail(scenario, 'the fixture must report cache reads AND writes, or the mapping of either is unexamined');
      const out = await p.complete(conformanceRequest());
      if (!out.ok) return fail(scenario, `expected ok, got ${out.kind}`);
      for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
        if (out.usage[k] !== want[k]) fail(scenario, `${k} is ${out.usage[k]}, the carrier reported ${want[k]}`);
      }
      return;
    }
    case 'reservation-refused':
    case 'no-meter': {
      for (let i = 0; i < 2; i++) {
        const out = await p.complete(conformanceRequest());
        expectFailure(scenario, out, 'unavailable', false);
      }
      if (h.calls() !== 0) fail(scenario, `${h.calls()} call(s) reached the carrier without a reservation`);
      return;
    }
    case 'key-not-logged': {
      if (secret.length < 12) fail(scenario, 'the sentinel key is too short to be found by accident');
      const lines: string[] = [];
      const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
      const saved = methods.map((m) => console[m]);
      for (const m of methods) {
        console[m] = (...args: unknown[]) => {
          lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' '));
        };
      }
      const outcomes: AiOutcome[] = [];
      try {
        for (let i = 0; i < 5; i++) outcomes.push(await p.complete(conformanceRequest()));
      } finally {
        methods.forEach((m, i) => {
          console[m] = saved[i];
        });
      }
      const failures = outcomes.filter((o) => !o.ok);
      if (failures.length < 3) fail(scenario, `the harness produced ${failures.length} failure(s); the scenario needs a success and at least three failures to examine`);
      if (h.calls() === 0) fail(scenario, 'nothing reached the carrier, so the key was never used');
      const envelopes = failures.map((o) =>
        buildEnvelope(new Error(o.ok ? '' : o.detail), { service: 'conformance', release: undefined, requestId: undefined, method: 'POST', path: '/ai' }, 'https://k@sink.invalid/1', new Date(0)),
      );
      for (const text of [...lines, ...outcomes.map((o) => JSON.stringify(o)), ...envelopes]) {
        // "match" / "no match" only: the key is never printed by a test either.
        if (text.includes(secret)) fail(scenario, 'the key appears in a log line, an outcome or an error-sink envelope: match');
      }
      return;
    }
    case 'rate-limited':
    case 'server-error': {
      const out = await p.complete(conformanceRequest());
      expectFailure(scenario, out, 'retryable', true);
      if (h.calls() !== 1) fail(scenario, `a retryable answer must not be retried here: ${h.calls()} call(s)`);
      return;
    }
    case 'bad-request': {
      const out = await p.complete(conformanceRequest());
      expectFailure(scenario, out, 'invalid', false);
      if (h.calls() !== 1) fail(scenario, `expected 1 call, got ${h.calls()}`);
      return;
    }
    case 'model-from-config': {
      const a = await p.complete(conformanceRequest('claude-haiku-4-5'));
      const b = await p.complete(conformanceRequest('claude-opus-5-5'));
      if (!a.ok || !b.ok) return fail(scenario, 'a call under a configured model failed');
      const seen = h.models();
      if (seen.length !== 2 || seen[0] !== 'claude-haiku-4-5' || seen[1] !== 'claude-opus-5-5') {
        fail(scenario, `the wire carried ${JSON.stringify(seen)}; the two configured models were not sent as asked`);
      }
      return;
    }
    case 'unpriced-model': {
      const out = await p.complete(conformanceRequest('claude-unpriced-fixture' as AiModelId));
      expectFailure(scenario, out, 'invalid', false);
      if (h.calls() !== 0 || reservations.length !== 0) fail(scenario, `an unpriced model reached the meter (${reservations.length}) or the wire (${h.calls()})`);
      return;
    }
    case 'no-input-cap': {
      const out = await p.complete({ ...conformanceRequest(), feature: 'review' });
      expectFailure(scenario, out, 'invalid', false);
      if (h.calls() !== 0 || reservations.length !== 0) fail(scenario, 'a feature with no input cap reached the meter or the wire');
      return;
    }
    case 'input-over-cap': {
      const out = await p.complete({ ...conformanceRequest(), input: 'x'.repeat(CONFORMANCE_INPUT_CAP + 1) });
      expectFailure(scenario, out, 'invalid', false);
      if (h.calls() !== 0 || reservations.length !== 0) fail(scenario, 'an input over its cap reached the meter or the wire');
      return;
    }
    case 'fallback-metered': {
      const out = await p.complete(conformanceRequest('claude-opus-5-5'));
      if (!out.ok) return fail(scenario, `expected ok, got ${out.kind} (${out.detail})`);
      if (!out.billing.known) return fail(scenario, 'a call that answered reported its usage as unknown');
      const models = out.billing.attempts.map((a) => a.model);
      if (JSON.stringify(models) !== JSON.stringify(FALLBACK_ATTEMPTS.map((a) => a.model))) fail(scenario, `attempts ${JSON.stringify(models)}: every attempt is billed, the declined one too`);
      const r = reservations[0] ?? fail(scenario, 'no reservation was asked for');
      if (JSON.stringify(r.attemptModels) !== JSON.stringify(['claude-opus-5-5', 'claude-opus-4-8', 'claude-opus-5'])) fail(scenario, `the reservation covered ${JSON.stringify(r.attemptModels)}, not the whole chain`);
      const worst = worstCaseUsd(CONFORMANCE_PRICES, r.attemptModels, CONFORMANCE_INPUT_CAP, conformanceRequest().maxOutputTokens) ?? 0;
      if (Math.abs(r.reserveUsd - worst) > 1e-12) fail(scenario, `reserved ${r.reserveUsd}, the worst case of the whole chain is ${worst}`);
      const st = settle(CONFORMANCE_PRICES, r.reserveUsd, out);
      if (Math.abs(st.chargeUsd - FALLBACK_CHARGE_USD) > 1e-12) fail(scenario, `charged ${st.chargeUsd}, the hand computation is ${FALLBACK_CHARGE_USD}`);
      if (st.chargeUsd > r.reserveUsd) fail(scenario, 'the charge is above the reservation');
      return;
    }
    case 'reservation-covers-charge': {
      const out = await p.complete(conformanceRequest('claude-sonnet-5-5'));
      if (!out.ok) return fail(scenario, `expected ok, got ${out.kind}`);
      const r = reservations[0] ?? fail(scenario, 'no reservation was asked for');
      if (r.maxInputTokens !== CONFORMANCE_INPUT_CAP || r.estimatedInputTokens > r.maxInputTokens) fail(scenario, 'the reservation does not carry the input cap and an estimate within it');
      if (out.billing.known !== true) return fail(scenario, 'usage unknown on an answered call');
      const charge = attemptsUsd(CONFORMANCE_PRICES, out.billing.attempts) ?? fail(scenario, 'an attempt is unpriced');
      if (!(r.reserveUsd >= charge)) fail(scenario, `reserved ${r.reserveUsd} below the charge ${charge}`);
      const st = settle(CONFORMANCE_PRICES, r.reserveUsd, out);
      if (st.basis !== 'attempts' || Math.abs(st.releaseUsd - (r.reserveUsd - charge)) > 1e-12) fail(scenario, 'settling did not release the difference');
      return;
    }
    case 'timeout-settles-at-reservation': {
      const out = await p.complete(conformanceRequest());
      expectFailure(scenario, out, 'timeout', false);
      if (out.billing.known) fail(scenario, 'no answer was reported as known usage: it may still have been billed');
      const r = reservations[0] ?? fail(scenario, 'no reservation was asked for');
      const st = settle(CONFORMANCE_PRICES, r.reserveUsd, out);
      if (st.chargeUsd !== r.reserveUsd || st.releaseUsd !== 0 || st.basis !== 'reservation') fail(scenario, `a timeout settled at ${st.chargeUsd}, not its reservation ${r.reserveUsd}`);
      return;
    }
  }
}

/** The test runner's two registration functions — vitest's `describe` and `it`,
 *  passed in so this module imports no runner (services/_shared/test is outside
 *  every Worker's node_modules, and tsc resolves imports from the file). */
export interface AiTestApi {
  describe(name: string, body: () => void): unknown;
  it(name: string, body: () => Promise<void>): unknown;
}

/** The entry point an adapter's test CALLS, with vitest's `describe` and `it`.
 *  Throws on a missing fixture. */
export function runAiConformance(subject: AiConformanceSubject, t: AiTestApi): void {
  const missing = AI_SCENARIOS.filter((s) => typeof subject.fixtures[s] !== 'function');
  if (missing.length) {
    throw new Error(`runAiConformance(${subject.adapter}): no fixture for ${missing.join(', ')} — a missing fixture is never a skip`);
  }
  t.describe(`ai port conformance — ${subject.adapter}`, () => {
    for (const s of AI_SCENARIOS) {
      t.it(s, async () => {
        const build = subject.fixtures[s] as (b: AiBeforeCall | undefined) => AiHarness | Promise<AiHarness>;
        const reservations: AiReservationRequest[] = [];
        const meter = s === 'reservation-refused' ? REFUSE : s === 'no-meter' ? undefined : recordingGrant(reservations);
        const h = await build(meter);
        await checkAiScenario(s, h, subject.secret, reservations);
      });
    }
  });
}
