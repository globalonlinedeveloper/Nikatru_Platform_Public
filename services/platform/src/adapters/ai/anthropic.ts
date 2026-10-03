// ─────────────────────────────────────────────────────────────────────────────
// adapters/ai/anthropic.ts — THE ANTHROPIC ADAPTER of the AI port
// (services/_shared/src/ports/ai.ts; registry tooling/ports/ai.json, row
// `anthropic`). OUR key, server-side only: every Anthropic fact lives here.
//
// On the official SDK, @anthropic-ai/sdk, which lists Cloudflare Workers among
// its supported runtimes and takes a `fetch` (read 2026-10-02 at
// https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript). The
// Messages API facts were read the same day at
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs and
// https://platform.claude.com/docs/en/api/errors:
//   · structured output is `output_config.format` (json_schema); the old
//     `output_format` is deprecated;
//   · the stop reason is read BEFORE the content: a `refusal` (HTTP 200, billed,
//     "the output may not match your schema") and a `max_tokens` stop ("may be
//     incomplete") are outcomes with no output (ports/ai.ts stoppedOutcome);
//   · the stable system prefix carries `cache_control: ephemeral`, so a repeat
//     reads it from the cache (a prefix below the model's minimum is simply not
//     cached — it is never an error);
//   · Claude Opus 5.5 and Claude Sonnet 5.5 take `output_config.effort`, sent
//     explicitly (Opus 5.5 defaults to `medium`); Claude Haiku 4.5 refuses the
//     field, so it is never sent there. No `thinking` field is sent: Opus 5.5
//     cannot disable it and Sonnet 5.5 runs adaptive by default;
//   · the server-side refusal fallback is sent as an EXPLICIT, PRICED chain from
//     config (AiLimits.fallbacks, from tooling/ports/ai.json `cost.models.<m>.
//     fallbacks`): `betas: ["server-side-fallback-2026-06-01"]`, `fallbacks:
//     [{model}, …]`. The header is paired with the BODY FORM: "The header must
//     be exactly `server-side-fallback-2026-06-01` for this array form; the
//     newer `fallbacks: "default"` scalar form uses `server-side-fallback-
//     2026-07-01` instead … pairing either header with the other form returns
//     a 400" (claude-api skill, TypeScript README "Refusal Fallbacks", cached
//     2026-09-25, read 2026-10-02). Never `"default"`: its routing is server-side and "not
//     published per model" (refusals-and-fallback, read 2026-10-02), so the
//     models it reaches could not be priced before the call. A model whose chain
//     is empty sends no fallback;
//   · "`usage.iterations` is the per-attempt record of what you're billed. The
//     top-level `usage` counts describe only the attempt that produced the
//     returned message" (same page): the outcome's `billing` is every iteration,
//     each with its own model, and the top-level usage only when there are none.
//
// 🔴 NO CALL WITHOUT A RESERVATION OF THE WORST CASE. Before the wire
// (ports/ai.ts reserveOrRefuse): the feature has an input cap, every model the
// chain can reach is priced, the input's bound is within the cap, and
// `beforeCall` grants every attempt at the input and output caps. Without one
// the adapter refuses every call and the SDK is never invoked. A call that gets
// no answer is billing-unknown and settles at that reservation.
// 🔴 THE KEY NEVER LEAVES THIS FILE. It is the SDK's credential and nothing
// else: `logLevel: 'off'` — the SDK already redacts x-api-key, authorization and
// cookie, but its debug level prints the request BODY (user content), and with
// no explicit level it falls back to ANTHROPIC_LOG — and no detail carries an
// SDK message or a response body. The conformance suite feeds a sentinel key and
// a sentinel input under ANTHROPIC_LOG=debug, and reads every log line (key and
// content), outcome and error-sink envelope (key) for them.
// 🔴 NO RETRIES HERE (`maxRetries: 0`): a retry is another call, and another
// call is another reservation — the caller's meter decides.
//
// Its secret is NIKATRU_ANTHROPIC_API_KEY, by name, on the platform Worker's Env.
// Only services/platform/src/ports.ts (the composition root) may import this
// file — assert-ports limb 4. Tests may, to drive it over recorded bytes.
// ─────────────────────────────────────────────────────────────────────────────
import type Anthropic from '@anthropic-ai/sdk';
import {
  type AiBeforeCall,
  type AiCallOptions,
  type AiAttempt,
  type AiCapability,
  type AiLimits,
  type AiModelId,
  type AiOutcome,
  type AiProvider,
  type AiRequest,
  type AiStopReason,
  aiAnsweredOutcome,
  aiNoAnswerOutcome,
  reserveOrRefuse,
  stoppedOutcome,
} from '../../../../_shared/src/ports/ai';

/**
 * The beta that turns the server-side refusal fallback on, for the ARRAY form
 * this adapter sends (`fallbacks: [{model}, …]`). `-2026-07-01` belongs only to
 * the scalar `fallbacks: "default"` form, which this adapter never sends.
 */
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-06-01';
/** The models that take `output_config.effort` (Haiku 4.5 refuses the field). */
export const EFFORT_MODELS: ReadonlySet<AiModelId> = new Set<AiModelId>(['claude-sonnet-5-5', 'claude-opus-5-5']);

/**
 * How long one call may take before it is `timeout`.
 *
 * @ceiling none — a per-call wait we chose, not a platform resource.
 */
export const ANTHROPIC_CALL_TIMEOUT_MS = 60_000;

export interface AnthropicAiDeps {
  readonly apiKey: string;
  /** T17's meter. Absent: every call is refused, and nothing is sent. */
  readonly beforeCall?: AiBeforeCall;
  /** Prices, per-feature input caps and the fallback chains — config, never constants here. */
  readonly limits: AiLimits;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const CARRIER = 'Anthropic';

/**
 * The SDK, loaded on the FIRST CALL, not at import. The composition root
 * imports this file, and every module that imports the app imports the
 * composition root: a top-level SDK import cost every Worker test that loads
 * the app the whole SDK (measured 2026-10-02: test/health.test.ts's first case
 * went past its 5 s bound). The deployed bundle is byte-identical either way,
 * because nothing calls aiFor yet and esbuild drops the unreachable call.
 */
type Sdk = typeof import('@anthropic-ai/sdk');
let sdk: Promise<Sdk> | null = null;
const loadSdk = (): Promise<Sdk> => (sdk ??= import('@anthropic-ai/sdk'));

const STOP: Readonly<Record<string, AiStopReason>> = {
  end_turn: 'end_turn',
  max_tokens: 'max_tokens',
  refusal: 'refusal',
  pause_turn: 'pause_turn',
};

/** The Anthropic AiProvider for OUR key. */
export function createAnthropicAi(deps: AnthropicAiDeps): AiProvider {
  const capabilities: ReadonlySet<AiCapability> = new Set<AiCapability>(['structured', 'vision', 'cache']);
  let client: Anthropic | null = null;

  return {
    id: 'anthropic',
    capabilities,
    async complete(request: AiRequest, options?: AiCallOptions): Promise<AiOutcome> {
      const reserved = await reserveOrRefuse(CARRIER, deps.beforeCall, request, deps.limits);
      if (!('id' in reserved)) return reserved;
      const chain = reserved.attemptModels.slice(1);
      let message: Anthropic.Beta.BetaMessage;
      let errors: Sdk['default'] | null = null;
      // Set just before the request is handed to the SDK: an error before it means
      // nothing left this Worker (nothing billed); one after it may have been billed.
      let sent = false;
      try {
        const { default: AnthropicSdk } = await loadSdk();
        errors = AnthropicSdk;
        client ??= new AnthropicSdk({
          apiKey: deps.apiKey,
          maxRetries: 0,
          timeout: deps.timeoutMs ?? ANTHROPIC_CALL_TIMEOUT_MS,
          logLevel: 'off',
          ...(deps.fetchImpl ? { fetch: deps.fetchImpl } : {}),
        });
        sent = true;
        message = await client.beta.messages.create(
          {
            model: request.model,
            max_tokens: request.maxOutputTokens,
            system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
            messages: [
              {
                role: 'user',
                content: [
                  ...(request.images ?? []).map((img) => ({
                    type: 'image' as const,
                    source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
                  })),
                  { type: 'text' as const, text: request.input },
                ],
              },
            ],
            output_config: {
              format: { type: 'json_schema', schema: request.schema as Record<string, unknown> },
              ...(EFFORT_MODELS.has(request.model) ? { effort: request.effort ?? 'medium' } : {}),
            },
            ...(chain.length ? { betas: [ANTHROPIC_FALLBACK_BETA], fallbacks: chain.map((model) => ({ model })) } : {}),
          },
          options?.signal ? { signal: options.signal } : undefined,
        );
      } catch (err) {
        return failureOf(errors, err, reserved, sent);
      }
      const usage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      };
      const text = message.content.find((b) => b.type === 'text');
      return stoppedOutcome(
        CARRIER,
        STOP[message.stop_reason ?? ''] ?? 'other',
        text && text.type === 'text' ? text.text : null,
        request.schema,
        usage,
        message.model,
        attemptsOf(message, request.model, usage),
        reserved,
      );
    },
  };
}

/**
 * Every attempt the provider billed, each with its OWN model: one per
 * `usage.iterations` entry (a declined attempt is a `message` entry, the
 * fallback that answered a `fallback_message` entry; an entry with no model is
 * the requested one). With no iterations, the one attempt is the top-level usage.
 */
function attemptsOf(message: Anthropic.Beta.BetaMessage, requested: string, topLevel: AiAttempt['usage']): AiAttempt[] {
  const its = message.usage.iterations ?? [];
  if (!its.length) return [{ model: message.model, usage: topLevel }];
  return its.map((it) => ({
    model: ('model' in it && typeof it.model === 'string' && it.model) || requested,
    usage: {
      inputTokens: it.input_tokens ?? 0,
      outputTokens: ('output_tokens' in it ? it.output_tokens : 0) ?? 0,
      cacheReadTokens: it.cache_read_input_tokens ?? 0,
      cacheWriteTokens: it.cache_creation_input_tokens ?? 0,
    },
  }));
}

/**
 * A thrown SDK error, as an outcome: by its TYPED class, never by its message.
 * An error the provider ANSWERED is not billed; no answer, or an error of no
 * known class once the request was handed to the SDK (`sent`), is
 * billing-unknown and settles at the reservation. An error BEFORE that (the SDK
 * failed to load, the client failed to build) ran nothing: known, no attempts.
 */
function failureOf(sdkClass: Sdk['default'] | null, err: unknown, reserved: { readonly id: string; readonly reserveUsd: number }, sent: boolean): AiOutcome {
  if (sdkClass && (err instanceof sdkClass.APIUserAbortError || err instanceof sdkClass.APIConnectionError)) return aiNoAnswerOutcome(CARRIER, err, reserved.id, reserved.reserveUsd);
  if (sdkClass && err instanceof sdkClass.APIError && typeof err.status === 'number') return aiAnsweredOutcome(CARRIER, err.status, reserved.id, reserved.reserveUsd);
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : 'Error';
  return {
    ok: false,
    kind: 'invalid',
    retryable: false,
    billing: sent ? { known: false } : { known: true, attempts: [] },
    reservationId: reserved.id,
    reservedUsd: reserved.reserveUsd,
    detail: `${CARRIER}: the call could not be made (${name})`,
  };
}
