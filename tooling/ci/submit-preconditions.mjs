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

/** ⏱ O-BRICK-SELLS-NOTHING-IN-A-STORE (12a) — the store-billing channels, where an app sells through
 *  RevenueCat. assert-app-yaml --for-submission refuses a `billing.mobileIap` still `state: pending` on each. */
export const IAP_STORE_CHANNELS = ['android-play', 'ios-appstore', 'macos-appstore'];

/** A row a lane submits: it names the workflow that carries its submission. */
export const submits = (row) => typeof row?.submission?.workflow === 'string' && row.submission.workflow.trim() !== '';

/** ⏱ 2026-09-26 — the sworn declarations of a channel: every `.json` in its
 *  storeMetadataContract additionalFiles, the set assert-sworn-store-files.mjs
 *  grades (O-BRICK-SWORN-FILES-HAVE-NO-PREVIEW-STATE). Read off the register the
 *  caller passes, so a channel that gains a sworn file owes the gate with no
 *  edit here. */
export const swornFilesOf = (register, channelId) =>
  (register?.storeMetadataContract?.perChannel?.[channelId]?.additionalFiles ?? []).filter(
    (f) => typeof f === 'string' && f.endsWith('.json'),
  );

/** ⏱ O-REAL-SUBMISSION-FLAG-UNGUARDED (absent from open.json on 2026-09-27; 9b, rv-c22) — the flag that tells a declaration gate
 *  it runs inside a REAL submission (LEAD RULING O-A2-R1 (absent from open.json: a ruling, not a row): `declaredOn: null` refuses a real
 *  submission only). An entry carrying `realFlag` has it checked by limb 3 of
 *  assert-publish-steps-guarded.mjs: REQUIRED in a job that holds a store publish step,
 *  REFUSED in one that does not, since a dry run never refuses on a declaration date. */
export const REAL_SUBMISSION_FLAG = '--real-submission';

/** ⏱ LEAD RULING 2026-09-26 22:00Z (9b, rv-c22) — channels whose store takes a console
 *  declaration that has NO sworn file in this repository, so the declaration DATE alone
 *  (apps/<id>/app.yaml stores.<channel>.declaredOn) gates a real submission. Each names
 *  the console form, which the refusal tells the owner to submit. */
export const DECLARATION_ONLY_CHANNELS = Object.freeze({
  'windows-store': "Partner Center's Properties (the privacy answers) and its age ratings questionnaire",
});

/** Submitting app channels that owe NO declaration gate, each with its ruling. Limb 3 fails a
 *  submitting app row that is neither gated nor listed here, so a new store lane cannot skip
 *  the declaration gate by omission. */
export const DECLARATION_EXEMPT = Object.freeze({
  'linux-snap': 'the Snap Store has no privacy-declaration form to swear (LEAD RULING 2026-09-26 22:00Z)',
  'macos-appstore': "one App Store Connect record covers iOS and macOS, so its App Privacy answers are ios-appstore's, gated in the same job",
});

/**
 * One entry per gate:
 *   guard       the repo-relative guard a lane step runs as `node <guard> <arg>`;
 *   arg(row)    the argument that step passes, formed from the channel row;
 *   channels    the channel ids the entry names outright (each must be a
 *               register row), or null when it applies by a row property;
 *   appliesTo   true when a lane submitting `row` owes this gate; its second
 *               argument is the parsed channel register the row came from;
 *   realFlag    the flag its step carries in a job that publishes, and never in
 *               one that does not (a declaration gate, and the Small Business
 *               Program gate);
 *   declaresConsole  true on the gate that answers a store's console declaration:
 *               limb 3 requires one on every submitting app row not in
 *               DECLARATION_EXEMPT.
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
  // ⏱ 2026-09-26 — a preview declaration ("sworn": false) cannot be submitted
  // (O-BRICK-SWORN-FILES-HAVE-NO-PREVIEW-STATE). Applies to every submitting row
  // whose channel carries a sworn file: android-play and ios-appstore today.
  // macos-appstore carries none of its own; the audit it shares is ios-appstore's,
  // and submit-appstore.yml runs this ios-appstore step in the job that submits both.
  {
    guard: 'tooling/ci/assert-sworn-store-files.mjs',
    arg: (row) => `--for-submission=${row.id}`,
    channels: null,
    // ⏱ 9b (rv-c22): and every channel whose declaration lives only in its console
    // (DECLARATION_ONLY_CHANNELS: windows-store), where the date alone is graded.
    appliesTo: (row, register) =>
      submits(row) && (swornFilesOf(register, row.id).length > 0 || Object.hasOwn(DECLARATION_ONLY_CHANNELS, row.id)),
    realFlag: REAL_SUBMISSION_FLAG,
    declaresConsole: true,
  },
  // ⏱ 2026-09-29 (AB-M5-02) — the first App Store sale waits for the Small Business Program
  // enrolment (owner queue A-18): a real submission on a channel whose purchaseRail is
  // `apple-iap` is refused while tooling/catalog/fee-register.json carries no enrolment date.
  // It carries `realFlag` for the same reason the declaration gate does — a dry run never
  // refuses — but it is not a console declaration, so it neither needs nor satisfies
  // DECLARATION_EXEMPT (`declaresConsole` is what limb 3's undeclared-channel check reads).
  {
    guard: 'tooling/ci/assert-small-business-program.mjs',
    arg: (row) => `--for-submission=${row.id}`,
    channels: null,
    appliesTo: (row) => submits(row) && row?.purchaseRail?.rail === 'apple-iap',
    realFlag: REAL_SUBMISSION_FLAG,
  },
  // ⏱ 12a — a paywall that cannot buy is an incomplete app in review: an app whose
  // billing.mobileIap is still pending (no RevenueCat apps) builds, and is never submitted
  // (O-BRICK-SELLS-NOTHING-IN-A-STORE). An app with no mobile IAP passes it.
  {
    guard: 'tooling/ci/assert-app-yaml.mjs',
    arg: (row) => `--for-submission=${row.id}`,
    channels: IAP_STORE_CHANNELS,
    appliesTo: (row) => submits(row) && IAP_STORE_CHANNELS.includes(row.id),
  },
];
