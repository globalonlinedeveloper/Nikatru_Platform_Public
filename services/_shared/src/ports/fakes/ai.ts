// ─────────────────────────────────────────────────────────────────────────────
// fakes/ai.ts — THE AI STUB. An AiProvider that COUNTS what reached its pretend
// wire and answers what a test scripted, and calls no model.
//
// Selectable in `test` and `sandbox` only (tooling/ports/ai.json, the `stub`
// row; assert-ports limb 7 refuses it in live). No Worker module imports it —
// only tests do, so it is in no bundle.
//
// Deterministic: it answers from a queue a test fills with `answer(...)` — any
// stop reason with any text and usage, an HTTP status, or no answer at all —
// and, when the queue is empty, the `defaultText` it was built with, ended
// normally. It asks for a reservation exactly as a real adapter does
// (`reserveOrRefuse`), so `calls` is the proof T17 needs: a refused reservation,
// or no meter at all, leaves it at zero. It passes the same conformance suite as
// every real adapter (services/_shared/test/ai-stub.conformance.test.ts).
// ─────────────────────────────────────────────────────────────────────────────
import {
  type AiAttempt,
  type AiBeforeCall,
  type AiCallOptions,
  type AiCapability,
  type AiLimits,
  type AiOutcome,
  type AiProvider,
  type AiRequest,
  type AiStopReason,
  type AiUsage,
  aiAnsweredOutcome,
  aiNoAnswerOutcome,
  reserveOrRefuse,
  stoppedOutcome,
} from '../ai';

/** One scripted answer. */
export type StubAiAnswer =
  | {
      readonly kind: 'stop';
      readonly stopReason: AiStopReason;
      readonly text: string | null;
      readonly usage?: AiUsage;
      readonly servedModel?: string;
      /** Every attempt the provider ran (a fallback chain is several); default: one, the served model's. */
      readonly attempts?: readonly AiAttempt[];
    }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'hang' };

export interface StubAiProvider extends AiProvider {
  /** Calls that reached the (pretend) wire — after a reservation was granted. */
  readonly calls: number;
  /** Every request that reached the wire, in order. */
  readonly requests: readonly AiRequest[];
  /** Queue the next answer. */
  answer(next: StubAiAnswer): void;
}

export interface StubAiDeps {
  readonly beforeCall?: AiBeforeCall;
  /** The same spend limits a real adapter is built with: prices, input caps, fallback chains. */
  readonly limits: AiLimits;
  /** The text an unscripted call ends with. */
  readonly defaultText?: string;
  /** How long a `hang` waits before it gives up, when no signal aborts it first. */
  readonly timeoutMs?: number;
}

const CARRIER = 'stub ai';
export const STUB_AI_USAGE: AiUsage = { inputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function createStubAi(deps: StubAiDeps): StubAiProvider {
  const queue: StubAiAnswer[] = [];
  const requests: AiRequest[] = [];
  const capabilities: ReadonlySet<AiCapability> = new Set<AiCapability>(['structured', 'vision', 'cache']);
  return {
    id: 'stub',
    capabilities,
    get calls() {
      return requests.length;
    },
    get requests() {
      return requests;
    },
    answer(next: StubAiAnswer) {
      queue.push(next);
    },
    async complete(request: AiRequest, options?: AiCallOptions): Promise<AiOutcome> {
      const reserved = await reserveOrRefuse(CARRIER, deps.beforeCall, request, deps.limits);
      if (!('id' in reserved)) return reserved;
      requests.push(request);
      const next = queue.shift() ?? { kind: 'stop', stopReason: 'end_turn', text: deps.defaultText ?? '{}' };
      if (next.kind === 'status') return aiAnsweredOutcome(CARRIER, next.status, reserved.id, reserved.reserveUsd);
      if (next.kind === 'hang') {
        const err = await new Promise<Error>((resolve) => {
          const done = () => resolve(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
          options?.signal?.addEventListener('abort', done, { once: true });
          setTimeout(done, deps.timeoutMs ?? 20);
        });
        return aiNoAnswerOutcome(CARRIER, err, reserved.id, reserved.reserveUsd);
      }
      const usage = next.usage ?? STUB_AI_USAGE;
      const served = next.servedModel ?? request.model;
      return stoppedOutcome(CARRIER, next.stopReason, next.text, request.schema, usage, served, next.attempts ?? [{ model: served, usage }], reserved);
    },
  };
}
