// ─────────────────────────────────────────────────────────────────────────────
// error-sink.ts — [pipeline 11]E-8. A WHOLE-FILE RE-EXPORT of the
// `sentry-envelope` adapter of the telemetry port's `ErrorSink`.
//
// port-telemetry moved the body to
// services/_shared/src/adapters/telemetry/sentry-envelope.ts and the port's types
// to services/_shared/src/ports/telemetry.ts. This file keeps every carrier's
// `export * from '../../../_shared/src/error-sink'` and every `reportWorkerError(`
// call in an `app.onError` working unchanged; tooling/ci/worker-shared-modules.mjs
// follows the chain carrier → here → the adapter, so
// tooling/ci/assert-worker-error-sink.mjs still judges the body.
//
// ⚠️ THIS LINE IS THE PORT'S ONE DECLARED IMPORT EXCEPTION. assert-ports limb 4
// lets only a Worker's composition root (services/<w>/src/ports.ts) import an
// adapter; this file is named in tooling/ports/telemetry.json `handTables`, and the
// waiver prints on every run until the onError callers reach the sink through
// `errorSinkFor(env)`. Add nothing else here: a file that re-exports AND
// declares is a fork wearing a delegation (worker-shared-modules.mjs).
// ─────────────────────────────────────────────────────────────────────────────
export * from './adapters/telemetry/sentry-envelope';
