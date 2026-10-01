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
export const AI_FEATURES = ['import', 'review'] as const;
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

/** What the meter is asked before a call. The reservation covers at most this. */
export interface AiReservationRequest {
  readonly feature: AiFeature;
  readonly model: AiModelId;
  readonly maxOutputTokens: number;
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
      readonly usage: AiUsage;
      /** The model that served the call (a refusal fallback may differ from the one asked). */
      readonly servedModel: string;
      readonly reservationId: string;
    }
  | {
      readonly ok: false;
      readonly kind: AiFailureKind;
      readonly retryable: boolean;
      /** Set when the model answered: a refusal and a truncation are billed. */
      readonly stopReason?: AiStopReason;
      readonly usage?: AiUsage;
      readonly status?: number;
      readonly reservationId?: string;
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
 * The reservation every adapter asks for before the wire: the reservation id,
 * or the `unavailable` outcome that sends nothing. No `beforeCall` is a refusal,
 * never a free call.
 */
export async function reserveOrRefuse(
  carrier: string,
  beforeCall: AiBeforeCall | undefined,
  request: AiRequest,
): Promise<{ readonly id: string } | AiOutcome> {
  if (!beforeCall) {
    return { ok: false, kind: 'unavailable', retryable: false, detail: `${carrier}: no meter is wired (beforeCall), so no call is made` };
  }
  let r: AiReservation;
  try {
    r = await beforeCall({ feature: request.feature, model: request.model, maxOutputTokens: request.maxOutputTokens });
  } catch {
    return { ok: false, kind: 'unavailable', retryable: false, detail: `${carrier}: the reservation failed, so no call is made` };
  }
  if (!r.ok) return { ok: false, kind: 'unavailable', retryable: false, detail: `${carrier}: reservation refused (${r.detail})` };
  return { id: r.id };
}

/** The outcome of a provider that ANSWERED with a non-2xx `status`. */
export function aiAnsweredOutcome(carrier: string, status: number, reservationId?: string): AiOutcome {
  const base = { status, ...(reservationId === undefined ? {} : { reservationId }) };
  if (status === 429 || status >= 500) return { ok: false, kind: 'retryable', retryable: true, ...base, detail: `${carrier} answered ${status}` };
  if (status === 401 || status === 403) return { ok: false, kind: 'unavailable', retryable: false, ...base, detail: `${carrier} answered ${status}: the credential was refused` };
  return { ok: false, kind: 'invalid', retryable: false, ...base, detail: `${carrier} answered ${status}` };
}

/** The outcome of a call that got NO answer. */
export function aiNoAnswerOutcome(carrier: string, err: unknown, reservationId?: string): AiOutcome {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : 'Error';
  const timedOut = /Timeout|Abort/i.test(name);
  return {
    ok: false,
    kind: 'timeout',
    retryable: false,
    ...(reservationId === undefined ? {} : { reservationId }),
    detail: `${carrier} not reached: ${timedOut ? 'no answer within the bound' : name}`,
  };
}

/**
 * The outcome of a model that ANSWERED, from its stop reason and its text — the
 * stop reason is read FIRST, so a refusal or a truncation never yields output.
 */
export function stoppedOutcome(
  carrier: string,
  stopReason: AiStopReason,
  text: string | null,
  schema: AiJsonSchema,
  usage: AiUsage,
  servedModel: string,
  reservationId: string,
): AiOutcome {
  const billed = { stopReason, usage, reservationId };
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
  return { ok: true, output, stopReason: 'end_turn', usage, servedModel, reservationId };
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
