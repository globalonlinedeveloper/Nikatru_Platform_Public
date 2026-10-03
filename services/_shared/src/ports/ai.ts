// ─────────────────────────────────────────────────────────────────────────────
// ports/ai.ts — THE AI PORT. What a Worker asks a model for, and nothing about
// which provider answers it.
//
// The standard is tooling/ports/README.md; the registry is tooling/ports/ai.json
// (features, the model each one runs on, the price of every model, secrets by
// NAME); the conformance suite every adapter passes is
// services/_shared/test/conformance/ai.ts (`runAiConformance`).
//
// 🔴 NO CALL WITHOUT A RESERVATION (the owner lock, 2026-10-01: "if using AI ...
// it should come from customer pocket"). Every adapter is built with a
// `beforeCall` — the meter's reservation hook, which train-st-ai-customer-pays
// (T17) wires — and asks it BEFORE it touches the wire. A refused reservation is
// `unavailable` and nothing is sent; an adapter built with NO `beforeCall` refuses
// every call the same way. So no code path can make a call we pay for until the
// meter exists: `reserveOrRefuse` below is that rule, and the suite holds every
// adapter to it with a counting carrier that must see zero calls.
//
// 🔴 HARD-CAPPED: THE RESERVATION IS THE WORST CASE (review 1 of #1136). Before
// the wire, every adapter checks (reserveOrRefuse): the feature has an input cap
// (AiLimits.maxInputTokens, config), the requested model AND every fallback it
// may reach is priced (a model with no price can never be called), and the
// input's conservative bound (estimateInputTokens) is within the cap. It then
// reserves every attempt at the input and output caps (worstCaseUsd). The meter
// settles to what ran (`billing.attempts`, each attempt at its OWN model's
// prices — a declined attempt and the fallback that answered are both billed),
// and a call with no answer is `billing: {known: false}`: it settles AT ITS
// RESERVATION, never at zero (settle).
//
// 🔴 THE MODEL IS CONFIG, NEVER A CONSTANT IN AN ADAPTER. A request names its
// model (`AiRequest.model`), chosen per FEATURE by the composition root from the
// registry (`features.<f>.model`, null until T17 measures the cheapest model
// that meets the quality bar). The candidate list is AI_MODEL_CANDIDATES.
//
// 🔴 OUTCOMES, NEVER THROWS ACROSS THE PORT. Every call resolves to one of:
//   · ok          — the model finished (`end_turn`) and its output parsed and
//                   validated against the request's schema; `output` is that
//                   value. Only an ok outcome carries output.
//   · refused     — the model declined (`stop_reason: refusal`). NO output, even
//                   a partial one. Billed, so `usage` is reported.
//   · incomplete  — the model stopped before finishing (`max_tokens`,
//                   `pause_turn`, a context-window stop). NO output: a truncated
//                   JSON is not rows. Billed, so `usage` is reported.
//   · retryable   — the provider answered "not now" (429, 5xx). Not retried
//                   HERE: the caller's meter decides, because a retry is another
//                   call to reserve.
//   · invalid     — the request cannot be served as asked (400, 404, 413, 422),
//                   or the output did not validate. Never retried.
//   · unavailable — no reservation (refused or no meter wired), no key, or the
//                   provider refused the credential (401, 403). Nothing billed.
//   · timeout     — no answer within the bound, or the caller aborted.
//
// 🔴 NO KEY AND NO CONTENT IN A DETAIL. `detail` is printed into logs and the
// error sink, so it carries the provider and the status — never the key, never
// the prompt, never the provider's response body. The suite feeds a sentinel key
// and holds every adapter to it.
//
// Types and pure helpers only: no vendor import, no bare import (see
// services/_shared/src/health.ts's header for why nothing here may carry one).
// ─────────────────────────────────────────────────────────────────────────────

/** The features that may call a model. Each one's model is config (ai.json). */
export const AI_FEATURES = ['import', 'review', 'help'] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

/** The models a feature may be set to. Exact ids, never with a date suffix. */
export const AI_MODEL_CANDIDATES = ['claude-haiku-4-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export type AiModelId = (typeof AI_MODEL_CANDIDATES)[number];

/** What an adapter can do. Declared, never assumed. */
export type AiCapability = 'structured' | 'vision' | 'cache';

/** How hard a model that takes an effort setting should think. */
export type AiEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A JSON Schema, as the provider's structured-output format takes it. */
export type AiJsonSchema = Readonly<Record<string, unknown>>;

export interface AiImage {
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  /** Base64, no data: prefix. */
  readonly base64: string;
}

export interface AiRequest {
  readonly feature: AiFeature;
  /** From config (the composition root's feature table), never from an adapter. */
  readonly model: AiModelId;
  /** The STABLE instructions. An adapter that declares `cache` caches this prefix. */
  readonly system: string;
  /** The per-call input: the text the user handed over. */
  readonly input: string;
  /** Only to an adapter that declares `vision`. */
  readonly images?: readonly AiImage[];
  /** The output's shape. The output is validated against it before it is returned. */
  readonly schema: AiJsonSchema;
  readonly maxOutputTokens: number;
  /** Sent only to a model that takes an effort setting; default `medium`, explicitly. */
  readonly effort?: AiEffort;
}

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export type AiStopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'pause_turn' | 'other';

/** One attempt the provider ran for a call, and what it used — billed at ITS model's prices. */
export interface AiAttempt {
  readonly model: string;
  readonly usage: AiUsage;
}

/**
 * What the provider bills for one call, for the meter to settle.
 *   · known: true  — every attempt that ran: a declined attempt AND the fallback
 *                    that answered are two entries, each priced by its own
 *                    model. No entries when nothing ran (a refusal before the
 *                    wire, or an error answer the provider does not bill).
 *   · known: false — NO ANSWER (a timeout, an abort, a lost connection). The
 *                    provider may still have run the call and billed it, so it
 *                    settles AT ITS RESERVATION — the worst case — never at zero.
 */
export type AiBilling = { readonly known: true; readonly attempts: readonly AiAttempt[] } | { readonly known: false };

/** What the meter is asked before a call: the WORST CASE the call can cost. */
export interface AiReservationRequest {
  readonly feature: AiFeature;
  readonly model: AiModelId;
  /** The requested model, then every fallback the call may reach — each priced. */
  readonly attemptModels: readonly string[];
  /** The feature's input cap (config): the bound the input was checked against. */
  readonly maxInputTokens: number;
  /** This request's conservative input estimate (estimateInputTokens): never above the cap. */
  readonly estimatedInputTokens: number;
  readonly maxOutputTokens: number;
  /** Every attempt at the input cap and the output cap, input priced at the dearer of input and cache write. */
  readonly reserveUsd: number;
}

export type AiReservation = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly detail: string };

/** T17's meter. Reserves (or refuses) BEFORE any call; an adapter without one refuses. */
export type AiBeforeCall = (request: AiReservationRequest) => Promise<AiReservation>;

export type AiFailureKind = 'refused' | 'incomplete' | 'retryable' | 'invalid' | 'unavailable' | 'timeout';

export type AiOutcome =
  | {
      readonly ok: true;
      readonly output: unknown;
      readonly stopReason: 'end_turn';
      /** The attempt that produced the output (the meter reads `billing`, which has every attempt). */
      readonly usage: AiUsage;
      /** The model that served the call (a refusal fallback may differ from the one asked). */
      readonly servedModel: string;
      readonly billing: AiBilling;
      readonly reservationId: string;
      readonly reservedUsd: number;
    }
  | {
      readonly ok: false;
      readonly kind: AiFailureKind;
      readonly retryable: boolean;
      /** Set when the model answered: a refusal and a truncation are billed. */
      readonly stopReason?: AiStopReason;
      readonly usage?: AiUsage;
      readonly status?: number;
      readonly billing: AiBilling;
      readonly reservationId?: string;
      readonly reservedUsd?: number;
      /** Printable: the provider and what happened. Never a key, never content. */
      readonly detail: string;
    };

export interface AiCallOptions {
  readonly signal?: AbortSignal;
}

export interface AiProvider {
  /** The adapter id of tooling/ports/ai.json. */
  readonly id: string;
  readonly capabilities: ReadonlySet<AiCapability>;
  complete(request: AiRequest, options?: AiCallOptions): Promise<AiOutcome>;
}

/** The price of one model, per million tokens, as read from the provider's page. */
export interface AiModelPrice {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
  readonly cacheReadUsdPerMTok: number;
  readonly cacheWriteUsdPerMTok: number;
  readonly asOf: string;
  readonly verify: string;
}

/** Every priced model of an adapter (ai.json `adapters[].cost.models`). */
export type AiCostModel = Readonly<Record<string, AiModelPrice>>;

/**
 * The spend limits a server adapter is built with — all config, from
 * tooling/ports/ai.json through the composition root, never constants in an
 * adapter:
 *   · prices          every model a call may reach;
 *   · maxInputTokens  per FEATURE, the input cap; null means no cap was set, and
 *                     every call for that feature is refused;
 *   · fallbacks       per model, the refusal-fallback chain the adapter sends
 *                     (each model priced; an empty chain sends none);
 *   · maxOutputTokens per model, the most `max_tokens` it accepts
 *                     (AI_MODEL_MAX_OUTPUT_TOKENS in production); a model not
 *                     listed accepts none, so a call that reaches it is refused.
 */
export interface AiLimits {
  readonly prices: AiCostModel;
  readonly maxInputTokens: Readonly<Record<AiFeature, number | null>>;
  readonly fallbacks: Readonly<Record<string, readonly string[]>>;
  readonly maxOutputTokens: Readonly<Record<string, number>>;
}

/** The USD a call cost, or null when the model is not priced (never a guess). */
export function costUsd(costModel: AiCostModel, model: string, usage: AiUsage): number | null {
  const p = costModel[model];
  if (!p) return null;
  return (
    (usage.inputTokens * p.inputUsdPerMTok +
      usage.outputTokens * p.outputUsdPerMTok +
      usage.cacheReadTokens * p.cacheReadUsdPerMTok +
      usage.cacheWriteTokens * p.cacheWriteUsdPerMTok) /
    1_000_000
  );
}

export const ZERO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * The input bound, conservatively. The SDK's own count (messages.countTokens) is
 * a network call, not an offline one, so the bound is taken from bytes: a
 * tokenizer token always covers AT LEAST ONE byte, so the UTF-8 byte length of
 * the text is never below its token count (a ratio of 1 token per byte — real
 * text runs nearer 3-4 bytes per token, so this over-states by 3-4×, the safe
 * side). The schema rides in the request too, so its bytes count; each image is
 * bounded by the high-resolution tier's ceiling (IMAGE_TOKEN_CEILING); and
 * REQUEST_OVERHEAD_TOKENS covers the framing a request adds around its text.
 */
/**
 * The most visual tokens one image costs: the high-resolution tier's ceiling,
 * Claude 4.7 and later (vision docs, read 2026-10-02).
 *
 * @ceiling none — an upper bound in an input ESTIMATE, the provider's own per-image maximum, not a platform resource we spend.
 */
export const IMAGE_TOKEN_CEILING = 4784;
/**
 * The framing a request adds around its text: a margin, not a measurement.
 *
 * @ceiling none — a safety margin in an input ESTIMATE, not a platform resource we spend.
 */
export const REQUEST_OVERHEAD_TOKENS = 2048;
/**
 * The most output tokens each model a call may reach accepts as `max_tokens`
 * (the claude-api skill, shared/models.md, cached 2026-09-25: 128K for Opus 5.5,
 * Sonnet 5.5, Opus 5 and Opus 4.8; 64K for Haiku 4.5). A model not listed here
 * accepts none: the call is refused, never sent with a guess.
 *
 * @ceiling none — the provider's own per-request maximum, checked before a reservation, not a platform resource we spend.
 */
export const AI_MODEL_MAX_OUTPUT_TOKENS: Readonly<Record<string, number>> = {
  'claude-haiku-4-5': 64_000,
  'claude-sonnet-5-5': 128_000,
  'claude-opus-5-5': 128_000,
  'claude-opus-4-8': 128_000,
  'claude-opus-5': 128_000,
};

/**
 * Why `maxOutputTokens` cannot price a reservation, or null when it can: a
 * positive integer at or under the limit of EVERY model in the chain (the same
 * `max_tokens` is sent to each fallback). 0, a negative, NaN, a fraction or one
 * over the limit would hand the meter a zero, negative, NaN or wrong worst case.
 */
export function maxOutputTokensProblem(maxOutputTokens: number, attemptModels: readonly string[], limits: Readonly<Record<string, number>>): string | null {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) return `maxOutputTokens ${String(maxOutputTokens)} is not a positive integer`;
  for (const m of attemptModels) {
    const limit = limits[m];
    if (limit === undefined) return `no output limit is known for ${m}`;
    if (maxOutputTokens > limit) return `maxOutputTokens ${maxOutputTokens} is over ${m}'s limit of ${limit}`;
  }
  return null;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;
export function estimateInputTokens(request: AiRequest): number {
  return (
    utf8Bytes(request.system) +
    utf8Bytes(request.input) +
    utf8Bytes(JSON.stringify(request.schema)) +
    (request.images?.length ?? 0) * IMAGE_TOKEN_CEILING +
    REQUEST_OVERHEAD_TOKENS
  );
}

/** The most a call can cost: every attempt in `models` at the input and output caps; null when one is not priced. */
export function worstCaseUsd(prices: AiCostModel, models: readonly string[], maxInputTokens: number, maxOutputTokens: number): number | null {
  let total = 0;
  for (const m of models) {
    const p = prices[m];
    if (!p) return null;
    total += (maxInputTokens * Math.max(p.inputUsdPerMTok, p.cacheWriteUsdPerMTok) + maxOutputTokens * p.outputUsdPerMTok) / 1_000_000;
  }
  return total;
}

/** What the attempts cost, each at its own model's prices; null when an attempt's model is not priced. */
export function attemptsUsd(prices: AiCostModel, attempts: readonly AiAttempt[]): number | null {
  let total = 0;
  for (const a of attempts) {
    const c = costUsd(prices, a.model, a.usage);
    if (c === null) return null;
    total += c;
  }
  return total;
}

export interface AiSettlement {
  /** What the customer is charged for the call. */
  readonly chargeUsd: number;
  /** What goes back to the customer's balance from the reservation. */
  readonly releaseUsd: number;
  /** `attempts`: priced from what ran. `reservation`: usage unknown (or unpriced), charged at the worst case. */
  readonly basis: 'attempts' | 'reservation';
}

/**
 * Settle one call against its reservation. Usage known → charge every attempt at
 * its own model's prices and release the rest. Usage unknown (no answer), or an
 * attempt on a model the table does not price → charge the reservation, release
 * nothing: a call we cannot measure is billed at its worst case, never at zero.
 */
export function settle(prices: AiCostModel, reservedUsd: number, outcome: AiOutcome): AiSettlement {
  if (!outcome.billing.known) return { chargeUsd: reservedUsd, releaseUsd: 0, basis: 'reservation' };
  const charge = attemptsUsd(prices, outcome.billing.attempts);
  if (charge === null) return { chargeUsd: reservedUsd, releaseUsd: 0, basis: 'reservation' };
  return { chargeUsd: charge, releaseUsd: Math.max(0, reservedUsd - charge), basis: 'attempts' };
}

const NOTHING_RAN: AiBilling = { known: true, attempts: [] };

/**
 * Everything checked before the wire, then the reservation: the reservation id
 * and its USD, or the outcome that sends nothing. In order:
 *   1. the feature has an input cap (none: refused);
 *   2. the requested model AND every fallback it may reach is priced (else refused —
 *      a model with no price can never be called), and `maxOutputTokens` is a
 *      positive integer within every one of their output limits (else refused);
 *   3. the input's conservative estimate is within the cap (else refused);
 *   4. a meter is wired (none is a refusal, never a free call), and it grants the
 *      worst case.
 */
export async function reserveOrRefuse(
  carrier: string,
  beforeCall: AiBeforeCall | undefined,
  request: AiRequest,
  limits: AiLimits,
): Promise<{ readonly id: string; readonly reserveUsd: number; readonly attemptModels: readonly string[] } | AiOutcome> {
  const refuse = (kind: AiFailureKind, detail: string): AiOutcome => ({ ok: false, kind, retryable: false, billing: NOTHING_RAN, detail: `${carrier}: ${detail}` });
  const cap = limits.maxInputTokens[request.feature];
  if (typeof cap !== 'number' || !(cap > 0)) return refuse('invalid', `feature ${request.feature} has no input cap, so no call is made`);
  const attemptModels = [request.model, ...(limits.fallbacks[request.model] ?? [])];
  const unpriced = attemptModels.filter((m) => !limits.prices[m]);
  if (unpriced.length) return refuse('invalid', `no price for ${unpriced.join(', ')}, so no call is made`);
  const outputProblem = maxOutputTokensProblem(request.maxOutputTokens, attemptModels, limits.maxOutputTokens);
  if (outputProblem) return refuse('invalid', `${outputProblem}, so no call is made`);
  const estimated = estimateInputTokens(request);
  if (estimated > cap) return refuse('invalid', `the input (about ${estimated} tokens, bounded) is over the ${request.feature} cap of ${cap}, so no call is made`);
  if (!beforeCall) return refuse('unavailable', 'no meter is wired (beforeCall), so no call is made');
  const reserveUsd = worstCaseUsd(limits.prices, attemptModels, cap, request.maxOutputTokens) as number;
  let r: AiReservation;
  try {
    r = await beforeCall({
      feature: request.feature,
      model: request.model,
      attemptModels,
      maxInputTokens: cap,
      estimatedInputTokens: estimated,
      maxOutputTokens: request.maxOutputTokens,
      reserveUsd,
    });
  } catch {
    return refuse('unavailable', 'the reservation failed, so no call is made');
  }
  if (!r.ok) return refuse('unavailable', `reservation refused (${r.detail})`);
  return { id: r.id, reserveUsd, attemptModels };
}

/** The outcome of a provider that ANSWERED with a non-2xx `status`: an error answer is not billed. */
export function aiAnsweredOutcome(carrier: string, status: number, reservationId?: string, reservedUsd?: number): AiOutcome {
  const base = {
    status,
    billing: NOTHING_RAN,
    ...(reservationId === undefined ? {} : { reservationId }),
    ...(reservedUsd === undefined ? {} : { reservedUsd }),
  };
  if (status === 429 || status >= 500) return { ok: false, kind: 'retryable', retryable: true, ...base, detail: `${carrier} answered ${status}` };
  if (status === 401 || status === 403) return { ok: false, kind: 'unavailable', retryable: false, ...base, detail: `${carrier} answered ${status}: the credential was refused` };
  return { ok: false, kind: 'invalid', retryable: false, ...base, detail: `${carrier} answered ${status}` };
}

/** The outcome of a call that got NO answer: it may still have run, so its usage is UNKNOWN and it settles at the reservation. */
export function aiNoAnswerOutcome(carrier: string, err: unknown, reservationId?: string, reservedUsd?: number): AiOutcome {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : 'Error';
  const timedOut = /Timeout|Abort/i.test(name);
  return {
    ok: false,
    kind: 'timeout',
    retryable: false,
    billing: { known: false },
    ...(reservationId === undefined ? {} : { reservationId }),
    ...(reservedUsd === undefined ? {} : { reservedUsd }),
    detail: `${carrier} not reached: ${timedOut ? 'no answer within the bound' : name}`,
  };
}

/**
 * The outcome of a model that ANSWERED, from its stop reason and its text — the
 * stop reason is read FIRST, so a refusal or a truncation never yields output.
 * `attempts` is every attempt the provider ran (and bills); `usage` is the one
 * that produced the answer.
 */
export function stoppedOutcome(
  carrier: string,
  stopReason: AiStopReason,
  text: string | null,
  schema: AiJsonSchema,
  usage: AiUsage,
  servedModel: string,
  attempts: readonly AiAttempt[],
  reservation: { readonly id: string; readonly reserveUsd: number },
): AiOutcome {
  const billed = { stopReason, usage, billing: { known: true as const, attempts }, reservationId: reservation.id, reservedUsd: reservation.reserveUsd };
  if (stopReason === 'refusal') return { ok: false, kind: 'refused', retryable: false, ...billed, detail: `${carrier}: the model declined` };
  if (stopReason !== 'end_turn') {
    return { ok: false, kind: 'incomplete', retryable: false, ...billed, detail: `${carrier}: the model stopped before finishing (${stopReason})` };
  }
  if (text === null) return { ok: false, kind: 'invalid', retryable: false, ...billed, detail: `${carrier}: the answer carried no text` };
  let output: unknown;
  try {
    output = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'invalid', retryable: false, ...billed, detail: `${carrier}: the answer is not JSON` };
  }
  const problem = schemaProblem(schema, output);
  if (problem !== null) return { ok: false, kind: 'invalid', retryable: false, ...billed, detail: `${carrier}: the answer does not match the schema (${problem})` };
  return {
    ok: true,
    output,
    stopReason: 'end_turn',
    usage,
    servedModel,
    billing: { known: true, attempts },
    reservationId: reservation.id,
    reservedUsd: reservation.reserveUsd,
  };
}

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v;

/**
 * The first way `value` fails `schema`, or null. The subset structured output
 * uses: type, enum, const, properties, required, additionalProperties, items,
 * minItems, maxItems. A path, never a value, is named — a value may be content.
 */
export function schemaProblem(schema: AiJsonSchema, value: unknown, at = '$'): string | null {
  const s = schema as Record<string, unknown>;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    const t = typeOf(value);
    if (!types.some((x) => x === t || (x === 'number' && t === 'integer'))) return `${at} is ${t}, expected ${types.join(' | ')}`;
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) return `${at} is not one of the enum`;
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(value)) return `${at} is not the const`;
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) return `${at} has fewer than ${s.minItems} item(s)`;
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) return `${at} has more than ${s.maxItems} item(s)`;
    if (s.items && typeof s.items === 'object') {
      for (let i = 0; i < value.length; i++) {
        const p = schemaProblem(s.items as AiJsonSchema, value[i], `${at}[${i}]`);
        if (p) return p;
      }
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, AiJsonSchema>;
    for (const r of (s.required ?? []) as string[]) if (!(r in obj)) return `${at} lacks \`${r}\``;
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) {
        const p = schemaProblem(props[k], v, `${at}.${k}`);
        if (p) return p;
      } else if (s.additionalProperties === false) return `${at} has an unknown key`;
    }
  }
  return null;
}
