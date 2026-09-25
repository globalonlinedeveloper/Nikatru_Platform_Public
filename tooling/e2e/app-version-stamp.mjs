// [pipeline B-17] The ONE definition of a non-release APP_VERSION stamp.
//
// A live `flutter drive` against production writes rows into platform_db
// (consent_artifacts, and events when analytics is granted) carrying the
// build's APP_VERSION. tooling/ops/check-prod-provenance.mjs must be able to
// attribute every such value, so every live drive stamps one of the shapes
// below — never the `dev` a build falls back to when nothing is passed.
//
// Before 2026-09-23 the e2e shape lived as a private regex inside the monitor
// and its derivation lived in YAML (e2e.yml's "Stamp this run" step): two
// copies nothing tied together. The store capture had no stamp at all, and its
// Linux job wrote two `dev` consent rows to production (run 35818960378). This
// module is the one place the shapes live. It is imported by:
//   - tooling/ops/check-prod-provenance.mjs  — the `e2e-run` and `store-capture`
//     resolvers;
//   - tooling/ci/assert-live-writer-provenance.mjs — which lane a workflow is
//     bound to, and the shape every rendered stamp must match;
//   - tooling/store/capture-play-screenshots.mjs — `appVersionDefine`, the
//     argv the store capture pushes onto its drive;
//   - tooling/e2e/purge.mjs — `stampDeletable`, the bound on its stamp delete.
//
// Pure: no fs, no network, no top-level side effects.

/** 1-9 digits mirrors assert-app-versioning.mjs's MAX_RUN_DIGITS. */
export const MAX_RUN_DIGITS = 9;
/** 7 lower-case hex mirrors its SHA_LEN and `${GITHUB_SHA::7}`. */
export const SHA_LEN = 7;

/** `<prefix>-<run_number>-<sha7>`, both halves anchored and captured. The
 *  longest value is 3 + 1 + 9 + 1 + 7 = 21 characters, inside the 32 that
 *  services/platform/src/routes/events.ts binds with `str(body?.app_version, 32)`
 *  (above which a value is stored as NULL rather than truncated). */
export const stampShape = (prefix) =>
  new RegExp(`^${prefix}-(\\d{1,${MAX_RUN_DIGITS}})-([0-9a-f]{${SHA_LEN}})$`);

/** What .github/workflows/e2e.yml stamps: e2e-<run_number>-<sha7>. */
export const E2E_RUN_SHAPE = stampShape('e2e');

/** The store capture workflow's file name, as the GitHub runs API names it. */
export const CAPTURE_WORKFLOW = 'store-screenshots.yml';
/** What a store-screenshots.yml capture stamps: cap-<run_number>-<sha7>. */
export const STORE_CAPTURE_SHAPE = stampShape('cap');
/** A local rehearsal only: unique per invocation and DELIBERATELY unwitnessable
 *  (the monitor's `store-capture` resolver refuses it, so a rehearsal row that
 *  survives its purge stays red). */
export const REHEARSAL_SHAPE = /^rehearsal-\d{10}$/;

const CAPTURE_WORKFLOW_REF = /\/\.github\/workflows\/store-screenshots\.yml@/;

/** The APP_VERSION a live store capture must stamp, or null = REFUSE.
 *
 *  Inside GitHub Actions it is DERIVED from the default env every step carries
 *  (GITHUB_RUN_NUMBER, GITHUB_SHA, GITHUB_WORKFLOW_REF), never read from a value
 *  a workflow sets: store-screenshots.yml is workflow_dispatch-only, so
 *  GITHUB_SHA is the run's head_sha, which is exactly what the monitor's witness
 *  compares. Another workflow's run number would lie, so any other
 *  GITHUB_WORKFLOW_REF is refused.
 *
 *  Outside Actions the only accepted value is STORE_CAPTURE_APP_VERSION =
 *  rehearsal-<10-digit epoch>. A hand-set local `cap-*` is refused: it would
 *  borrow a real run's witness. */
export function captureStamp(env = process.env) {
  if (env.GITHUB_ACTIONS === 'true') {
    if (!CAPTURE_WORKFLOW_REF.test(env.GITHUB_WORKFLOW_REF ?? '')) return null;
    const n = env.GITHUB_RUN_NUMBER;
    const sha = (env.GITHUB_SHA ?? '').toLowerCase();
    const s = `cap-${n}-${sha.slice(0, SHA_LEN)}`;
    return STORE_CAPTURE_SHAPE.test(s) ? s : null;
  }
  const local = env.STORE_CAPTURE_APP_VERSION;
  return REHEARSAL_SHAPE.test(local ?? '') ? local : null;
}

/** Why captureStamp(env) returned null, in words that name the variable. */
export function captureStampRefusal(env = process.env) {
  const contract =
    'a live store capture writes consent rows to production and must stamp them APP_VERSION=cap-<GITHUB_RUN_NUMBER>-<GITHUB_SHA::7>, ' +
    'derived inside a store-screenshots.yml Actions run; outside Actions set STORE_CAPTURE_APP_VERSION=rehearsal-<10-digit epoch>';
  if (env.GITHUB_ACTIONS === 'true') {
    if (!CAPTURE_WORKFLOW_REF.test(env.GITHUB_WORKFLOW_REF ?? '')) {
      return `GITHUB_WORKFLOW_REF=${env.GITHUB_WORKFLOW_REF ?? '(unset)'} is not .github/workflows/${CAPTURE_WORKFLOW}, so its run number would not witness the rows: ${contract}`;
    }
    if (!/^\d{1,9}$/.test(env.GITHUB_RUN_NUMBER ?? '')) {
      return `GITHUB_RUN_NUMBER=${env.GITHUB_RUN_NUMBER ?? '(unset)'} is not 1-${MAX_RUN_DIGITS} digits: ${contract}`;
    }
    return `GITHUB_SHA=${env.GITHUB_SHA ?? '(unset)'} does not start with ${SHA_LEN} hex characters: ${contract}`;
  }
  const local = env.STORE_CAPTURE_APP_VERSION;
  if (local === undefined || local === '') {
    return `not inside GitHub Actions (GITHUB_ACTIONS, GITHUB_RUN_NUMBER unset) and STORE_CAPTURE_APP_VERSION is unset: ${contract}`;
  }
  return `STORE_CAPTURE_APP_VERSION=${local} is not rehearsal-<10-digit epoch> (a local cap-* would borrow a real run's witness): ${contract}`;
}

/** A stamp purge may delete BY: unique to one run, and no verifier reads its
 *  rows. Never `e2e-*` (verify_consent.mjs reads those rows, and matrix legs
 *  share one stamp), never `dev`, never a release version. */
export const stampDeletable = (s) =>
  typeof s === 'string' && (STORE_CAPTURE_SHAPE.test(s) || REHEARSAL_SHAPE.test(s));

/** One row per workflow that runs a live drive against production. `source`
 *  says where the stamp comes from:
 *    'env'             — a step or job env key the workflow sets (`env`);
 *    'actions-default' — derived by captureStamp from the Actions default env,
 *                        so the workflow sets nothing.
 *  ⏱ 2026-09-25 — `backend: 'sandbox'` marks a lane whose drives reach the
 *  env.sandbox Workers (tooling/store/capture-backend.mjs), not production:
 *  assert-live-writer-provenance.mjs L6 then holds its jobs to the sandbox hosts
 *  and its purges to the sandbox D1 ids. A lane without it is a production lane. */
export const STAMP_LANES = Object.freeze([
  Object.freeze({
    resolver: 'e2e-run',
    workflow: 'e2e.yml',
    prefix: 'e2e',
    source: 'env',
    env: 'E2E_APP_VERSION',
  }),
  Object.freeze({
    resolver: 'store-capture',
    workflow: CAPTURE_WORKFLOW,
    prefix: 'cap',
    source: 'actions-default',
    backend: 'sandbox',
  }),
]);

/** The lane a workflow is bound to, by its FILE NAME (e2e.yml), the way the
 *  GitHub runs API and CAPTURE_WORKFLOW name it. A file name, not a repo path:
 *  this module never reads a workflow, and assert-workflow-readers.mjs treats a
 *  repo path to one as a reader. */
export const laneForWorkflow = (file) => STAMP_LANES.find((l) => l.workflow === file) ?? null;
export const laneByResolver = (id) => STAMP_LANES.find((l) => l.resolver === id) ?? null;

export class StampRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'StampRefused';
  }
}

/** The argv a SCRIPT that spawns a live `flutter drive` must push — the same
 *  idiom as capture-network-posture.mjs's launchDefineArgs(). A proof/demo
 *  build is not backend-live and gets [] without reading env at all. */
export function appVersionDefine({ lane, live, env = process.env }) {
  if (!live) return [];
  const l = typeof lane === 'string' ? laneByResolver(lane) : lane;
  if (!l) throw new StampRefused(`no stamp lane named \`${lane}\` in tooling/e2e/app-version-stamp.mjs STAMP_LANES`);
  if (l.source === 'actions-default') {
    // captureStamp is the whole check: a `cap-*` derived inside the capture
    // workflow, or a local `rehearsal-*` (unwitnessable on purpose).
    const v = captureStamp(env);
    if (v === null) throw new StampRefused(captureStampRefusal(env));
    return ['--dart-define', `APP_VERSION=${v}`];
  }
  const v = env[l.env];
  if (!v) {
    throw new StampRefused(
      `${l.env} is unset: a live drive would stamp APP_VERSION=dev, which the production provenance monitor cannot attribute`,
    );
  }
  if (!stampShape(l.prefix).test(v)) {
    throw new StampRefused(`${l.env}=${v} is not ${l.prefix}-<run>-<sha7>, the shape the \`${l.resolver}\` resolver accepts`);
  }
  return ['--dart-define', `APP_VERSION=${v}`];
}
