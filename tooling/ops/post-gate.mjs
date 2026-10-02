// ─────────────────────────────────────────────────────────────────────────────
// post-gate.mjs — WHICH RUNS ARE "MAIN ITSELF", for readers of RUN OBJECTS.
// ⏱ 2026-10-02 (O-MERGES-DEPEND-ON-THE-LAPTOP).
//
// NOT A GUARD and not a second definition: it re-exports the post-gate predicate
// from tooling/ci/workflow-scan.mjs, the one place it is written. It exists so a
// reader that grades a run object (land-rules.mjs, land-gate.mjs,
// refresh-executed-floor.mjs, land-next.mjs) can ask that one definition without
// importing the workflow parse itself, which would make each a workflow reader it
// is not (assert-workflow-readers.mjs registers THIS file as the one that imports it).
//
// A push to main and a dispatch on main are the same pipeline: land.yml merges with
// the workflow's GITHUB_TOKEN, whose push starts no run, and dispatches ci.yml on
// main instead.
// ─────────────────────────────────────────────────────────────────────────────
import { POST_GATE_EVENTS, POST_GATE_IF, isPostGateRun } from '../ci/workflow-scan.mjs';

export { POST_GATE_EVENTS, POST_GATE_IF, isPostGateRun };
