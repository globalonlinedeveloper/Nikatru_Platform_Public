// ─────────────────────────────────────────────────────────────────────────────
// submit-preconditions.mjs — the gates a store submission must pass, and which
// channel rows each one applies to. ONE table: limb 3 of
// assert-publish-steps-guarded.mjs reads it to decide which steps every submit
// lane must run, and assert-iap-review-screenshots.mjs reads its channel list.
//
// Row O-SUBMIT-LANES-SKIP-PRECONDITION-GATES. Measured on main at 80ef8e39: no
// submit-*.yml ran assert-name-clearance.mjs or assert-iap-review-screenshots.mjs,
// so a submit dry run went green over a name nobody had cleared and over an
// auto-renewable with no review screenshot. The one gate a lane did run —
// assert-play-device-coverage.mjs in submit-play.yml — was added by hand and read
// by no guard, so deleting it was green too.
//
// The table names the GATES. Which LANES owe them is read from
// tooling/channel-register.json on every run: a row with a `submission.workflow`
// owes every entry that applies to it, in that workflow's `submission.job` and
// in every store-publish job of the same workflow. A new submission row is red
// until its lane runs its gates.
//
// SCOPED BY SURFACE. assert-name-clearance.mjs grades the names in
// catalog/apps.json, so its entry applies to rows whose `surface` is `app`. The
// amo row carries a `submission` too (extensions.yml, job store-publish); run
// there, the name gate would grade the app's name rather than the extension's.
// An extension name gate is its own decision, not taken here, and limb 3 prints
// every submission row no entry applies to, so that gap is on screen on every
// run rather than silent.
//
// Pure data and predicates: no filesystem, no exit. The coverage question is the
// caller's — limb 3 exits COVERAGE LOST on a guard path that is not on disk, a
// named channel the register does not declare, and a register with no
// submission row at all.
// ─────────────────────────────────────────────────────────────────────────────

/** The channels whose store reviews an auto-renewable subscription against its
 *  review screenshot. assert-iap-review-screenshots.mjs grades this list's one
 *  entry and refuses a second; macos-appstore joins when a macOS product is
 *  declared, together with that reader learning a second tree. */
export const IAP_REVIEW_CHANNELS = ['ios-appstore'];

/** A row a lane submits: it names the workflow that carries its submission. */
export const submits = (row) => typeof row?.submission?.workflow === 'string' && row.submission.workflow.trim() !== '';

/**
 * One entry per gate:
 *   guard       the repo-relative guard a lane step runs as `node <guard> <arg>`;
 *   arg(row)    the argument that step passes, formed from the channel row;
 *   channels    the channel ids the entry names outright (each must be a
 *               register row), or null when it applies by a row property;
 *   appliesTo   true when a lane submitting `row` owes this gate.
 */
export const SUBMIT_PRECONDITIONS = [
  {
    guard: 'tooling/ci/assert-name-clearance.mjs',
    arg: (row) => `--for-submission=${row.id}`,
    channels: null,
    appliesTo: (row) => submits(row) && row.surface === 'app',
  },
  {
    guard: 'tooling/ci/assert-iap-review-screenshots.mjs',
    arg: () => '--for-submission',
    channels: IAP_REVIEW_CHANNELS,
    appliesTo: (row) => submits(row) && IAP_REVIEW_CHANNELS.includes(row.id),
  },
  {
    guard: 'tooling/ci/assert-play-device-coverage.mjs',
    arg: (row) => `--for-submission=${row.id}`,
    channels: ['android-play'],
    appliesTo: (row) => submits(row) && row.id === 'android-play',
  },
];
