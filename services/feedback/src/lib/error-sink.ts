// error-sink.ts — a RE-EXPORT. The one home is services/_shared/src/error-sink.ts.
// Its header holds the hand-rolled-envelope reasoning, the privacy invariants,
// the fail-open rule and why `SinkContext.appId` is optional rather than
// defaulted. [pipeline 11]E-8, [ADR 067] decision 2.
//
// ⏱ STAMPED FROM 2026-09-08. Until then a backend app stamped from this brick
// had NO crash sink at all: `src/index.ts`'s `app.onError` only wrote to
// `console.error`, and `tooling/ci/assert-worker-error-sink.mjs` derives its
// subject from every `services/*/src/index.ts` — so the generated Worker failed
// that guard on limb 2 (the handler does not call the sink), limb 3 (the module
// does not exist) and limb 5 (no deploy job supplies its vars) the first time CI
// ran on it. Both live Workers had been fixed; the template every future backend
// is generated from had not.
export * from '../../../_shared/src/error-sink';
