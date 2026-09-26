// ─────────────────────────────────────────────────────────────────────────────
// store-environment.mjs — a store publish runs only inside the `store-publish`
// GitHub environment, and only once that environment is shown to carry a
// required reviewer.
//
// [ADR 031] class A: a store publish is owner-only, per instance. The gate is a
// GitHub environment with a required reviewer, and `environment:` on a job FAILS
// OPEN on its own — GitHub documents that "Running a workflow that references an
// environment that does not exist will create an environment with the referenced
// name", with no protection rules. So the publisher reads the environment back
// at run time, immediately before its first store call.
//
// ⏱ C4b, 2026-09-25: THE READ IS NOT WRITTEN HERE ANY MORE. It is
// `requirePublishEnvironment` in tooling/release/submit-common.mjs, the function
// submit-play, submit-snap and submit-windows-store call, and this file
// re-exports it under the name the three extension publishers call. Until then
// this was the fourth copy of the read (EXT-3, 2026-09-24).
//
// Reaching into tooling/ from scripts/ is allowed: scripts/ is repository
// tooling, and nothing under it is packed into an extension (scripts/README.md).
// The extensions core sync grades vendor/core bytes only, and
// assert-extensions-build-free refuses a build step, not an import. This file
// already imported tooling/ci/record-deployment.mjs (EXT-6), as
// scripts/publish-arming.mjs imports tooling/ci/channel-arming.mjs.
//
// assert-release-provenance.mjs limb 4 holds every store publish job to
// `environment:` AND its publisher to a call of requireStorePublishEnvironment(),
// and credits that call because this file re-exports submit-common's read under
// that name and submit-common performs it.
// ─────────────────────────────────────────────────────────────────────────────

export {
  requirePublishEnvironment as requireStorePublishEnvironment,
  requirePublishEnvironment,
  PUBLISH_ENVIRONMENT as STORE_PUBLISH_ENVIRONMENT,
} from '../../../tooling/release/submit-common.mjs';
