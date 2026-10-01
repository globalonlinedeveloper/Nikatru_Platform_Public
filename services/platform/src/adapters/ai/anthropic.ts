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
//   · on Opus 5.5 and Sonnet 5.5 the server-side refusal fallback is on by
//     default (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks:
//     "default"` — the "default" form, on the Claude API). A rescued call is
//     served by another model, so the outcome names `servedModel` and the meter
//     prices by it.
//
// 🔴 NO CALL WITHOUT A RESERVATION. `beforeCall` is asked first; without one the
// adapter refuses every call (`unavailable`) and the SDK is never invoked.
// 🔴 THE KEY NEVER LEAVES THIS FILE. It is the SDK's credential and nothing
// else: `logLevel: 'off'` (the SDK's debug level prints headers), and no detail
// carries an SDK message or a response body. The conformance suite feeds a
// sentinel key and reads every log line, outcome and error-sink envelope for it.
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
  type AiCapability,
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

/** The beta that turns the server-side refusal fallback on. */
export const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
/** The models that take `output_config.effort` (Haiku 4.5 refuses the field). */
export const EFFORT_MODELS: ReadonlySet<AiModelId> = new Set<AiModelId>(['claude-sonnet-5-5', 'claude-opus-5-5']);
/** The models the refusal fallback is sent for, in its "default" form. */
export const FALLBACK_MODELS: ReadonlySet<AiModelId> = new Set<AiModelId>(['claude-sonnet-5-5', 'claude-opus-5-5']);

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
      const reserved = await reserveOrRefuse(CARRIER, deps.beforeCall, request);
      if (!('id' in reserved)) return reserved;
      const fallback = FALLBACK_MODELS.has(request.model);
      let message: Anthropic.Beta.BetaMessage;
      let errors: Sdk['default'] | null = null;
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
            ...(fallback ? { betas: [ANTHROPIC_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
          },
          options?.signal ? { signal: options.signal } : undefined,
        );
      } catch (err) {
        return failureOf(errors, err, reserved.id);
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
        reserved.id,
      );
    },
  };
}

/** A thrown SDK error, as an outcome: by its TYPED class, never by its message. */
function failureOf(sdkClass: Sdk['default'] | null, err: unknown, reservationId: string): AiOutcome {
  if (sdkClass && (err instanceof sdkClass.APIUserAbortError || err instanceof sdkClass.APIConnectionError)) return aiNoAnswerOutcome(CARRIER, err, reservationId);
  if (sdkClass && err instanceof sdkClass.APIError && typeof err.status === 'number') return aiAnsweredOutcome(CARRIER, err.status, reservationId);
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : 'Error';
  return { ok: false, kind: 'invalid', retryable: false, reservationId, detail: `${CARRIER}: the call could not be made (${name})` };
}
