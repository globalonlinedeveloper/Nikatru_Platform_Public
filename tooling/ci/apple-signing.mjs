#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// apple-signing.mjs — materialise the APPLE DISTRIBUTION IDENTITY for one CI
// build and decide, out loud, whether this run is allowed to be unsigned.
//
// This is the macOS/iOS half of the pair `tooling/ci/android-signing.mjs`
// already forms for Play, and it is deliberately the same shape, because the
// defect it forecloses is the same one and it has already happened once here.
//
// 🔴 WHY THIS EXISTS — the defect it closes, named. PR #202 declared four Apple
// secrets on the `ios-appstore` and `macos-appstore` rows of
// tooling/channel-register.json. `grep -rn APPLE_DIST_CERT_P12_BASE64` over the
// whole tree on 2026-08-08 returned THE REGISTER AND NOTHING ELSE: no workflow
// named them, no script read them, nothing compared them to anything. That is
// the Android state of 2026-08-04 exactly — a correct declaration with no
// consumer — and on the Android side it meant every .aab the factory had ever
// produced was debug-signed while every configuration check stayed green. The
// Apple lane's version of the same silence is worse in one respect: today
// `build-platforms.yml` runs `flutter build ios --release --no-codesign`, so
// the lane's UNSIGNED-ness is real and correct, and the day somebody removes
// `--no-codesign` there is nothing anywhere that would notice the secrets were
// never wired.
//
//   all four supplied   → materialise the .p12 and the profiles, arrange a
//                         per-run keychain, write the ExportOptions.plist the
//                         signed export needs, posture = `release-signed`
//   none supplied       → posture = `unsigned-build-proof`, the gap PRINTED IN
//                         CAPITALS and named (the Apple distribution certificate;
//                         the account is ACTIVE, none issued) — UNLESS this is a release lane AND
//                         the register ARMS one of the two Apple rows, where the
//                         absence is a FAILURE and not a posture
//   some supplied       → FAIL. Three of four is an artifact nobody can
//                         explain, and Apple's notion of a "correctly signed but
//                         wrong identity" build is rejected at upload, after the
//                         account is spent. ONE EXCEPTION, and it is stated as a
//                         narrowing rather than folded in silently: on a BUILD
//                         PROOF lane a set consisting only of `KEYLESS_ENV`
//                         names — today just `APPLE_TEAM_ID` — is the
//                         `unsigned-build-proof` ending with the supplied name
//                         PRINTED as deliberately unused. See `resolvePosture`.
//                         On a release lane it is still a failure.
//
// 🔴 THE RELEASE-LANE FAILURE IS SCOPED BY THE REGISTER, NOT BY THE TAG ALONE,
// AND THAT CORRECTION WAS MEASURED. Until 2026-08-09 the middle ending read
// "UNLESS this is a release lane" full stop, and the consequence was that a
// `subscriptiontracker-v*` tag killed the `apple` job — while `windows-signing.mjs` killed
// `windows` and `appimage-signing.mjs` killed `linux_web_android` for the same
// reason. build-platforms.yml's `release` job `needs:` all three, so the FIRST
// GitHub Release this repository would ever publish was unreachable, blocked on
// an Apple enrolment protecting a submission that cannot happen: BOTH Apple rows
// are `lane: null` — nothing in this repository emits an .ipa or a .pkg, and
// `build-platforms.yml` builds iOS with `--no-codesign` on purpose. The scope
// test now comes from the register's own `served` / `submittable` / `lane`
// fields, through `tooling/ci/channel-arming.mjs`, and the gap is PRINTED IN
// FULL on the release lane instead ([pipeline C-6], the same rule the .pkg
// installer-certificate gap below already follows). The failing case did not go
// away: give an Apple row a lane, or mark it served, and the identical tag fails
// naming the field that armed it.
//
// ⚠️ THIS SCRIPT IS NOT THE PROOF. It says what it INTENDS; it cannot say what
// xcodebuild did. `tooling/ci/assert-artifact-signed-apple.mjs` reads the real
// signature back out of the built bundle with `codesign -dvv` and fails if the
// signer disagrees with the posture exported here. A step that arranges a
// credential and then reports its own success is the "green means ran" failure
// with extra stages — the exact reason the Android pair is two files.
//
// ── NAMES COME FROM THE REGISTER, AND THE COPY HERE IS COMPARED TO IT ────────
// The Android script parses its variable names out of build.gradle.kts because
// Gradle is the authority for what Gradle reads. There is no equivalent build
// file here: `xcodebuild` reads a keychain and a plist, not a named set of
// environment variables, so the authority for the NAMES is the register, which
// is where [9]R-3 limb 2 says signing secrets are enumerated.
//
// But this script cannot merely read them, because it must know what each one
// IS — one is base64 of a PKCS#12, one is its passphrase, one is base64 of a
// profile set, one is a 10-character team identifier, and they are validated
// and used in four completely different ways. A role map is therefore declared
// below, and the register's declared set is COMPARED TO IT on every run, in
// both directions, PER ROW — the two rows do NOT declare the same set, and
// comparing one list against both is the defect the role map's own header
// records and dates. Two copies of a list drift; two copies that are compared
// cannot drift silently. Renaming a secret in the register without
// teaching this file fails HERE, loudly, instead of producing an unsigned build
// from a run that looked like a signing run.
//
// ── KEY MATERIAL IS WRITTEN OUTSIDE THE REPOSITORY, ON PURPOSE ───────────────
// $RUNNER_TEMP, never the workspace — the .p12, the keychain database, the
// decoded profiles and the generated ExportOptions.plist. Every
// `actions/upload-artifact` path in this repo is workspace-relative, so key
// material inside the tree is one broad `path:` away from being published, and
// on a PUBLIC repo an artifact is downloadable by anyone. Outside the tree
// there is no glob that can reach it.
//
// ── THE KEYCHAIN PASSWORD IS GENERATED PER RUN AND IS NOT A SECRET ───────────
// `security create-keychain -p` needs a password. It is `randomBytes(24)`,
// generated here, never printed, never exported, and never stored. Making it a
// repository secret would be worse in every direction: it would be one more
// name to keep in step, one more rotation obligation, and a long-lived value
// protecting a keychain that exists for the length of one job in a directory
// the runner destroys — while the credential it guards is already in that job's
// environment. A per-run random value cannot leak from a previous run because
// there is no previous run to leak from.
//
// ── ⬜ A GAP THIS SCRIPT PRINTS AND CANNOT CLOSE ─────────────────────────────
// A Mac App Store `.pkg` needs TWO certificates: an application certificate
// (Apple Distribution / 3rd Party Mac Developer Application) to sign the .app,
// and an INSTALLER certificate (Mac Installer Distribution / 3rd Party Mac
// Developer Installer) to sign the package `productbuild` produces. Since
// 2026-08-20 the register declares BOTH — `APPLE_DIST_CERT_P12_BASE64` on both
// Apple rows and `APPLE_INSTALLER_CERT_P12_BASE64` on macos-appstore alone — so
// what is missing is no longer the NAME, it is the certificate: nothing can
// issue one until something asks the ASC API for one; the ACCOUNT is active. The macos-appstore `.pkg` intent below is
// therefore planned and printed rather than run, and nothing in this file
// imports an installer identity into the keychain. That is printed on every run
// rather than failing the build, because the missing item is an owner action on
// a certificate nothing has issued yet (the account is ACTIVE) and a guard that blocks
// CI on an unclosed gap blocks every merge in the repository. CORRECTED 2026-09-08:
// this gap is no longer owner-gated. It is code-gated - an agent holding the ASC
// key can issue the certificate - and it is printed for the second reason only.
//
// Usage:
//   node tooling/ci/apple-signing.mjs [--app <slug>] [--out <dir>]
//                                     [--channel <ios-appstore|macos-appstore>]…
//                                     [--repo-root <path>] [--github-env <path>]
//                                     [--method <app-store-connect|…>]
//          --app also chooses the profiles: only those whose bundle id is
//          apps.<slug>.bundleId in tooling/apple-provisioning.json go further,
//          and exactly one iOS and one macOS profile must match.
// `--channel` is repeatable and names the register rows this run signs for; the
// release lane and the arming verdict are read over exactly those rows. Absent,
// it is both Apple rows. ONE identity signs both, so the build-platforms `apple`
// job names both.
//
// ⏱ 2026-09-25 — the ADAPTER over tooling/ci/signing-seam.mjs
// (O-SIGNING-PRIMITIVES-IN-FOUR-COPIES): the all-or-none law, the release-lane
// derivation, the base64 decode, key placement and the $GITHUB_ENV export are
// the seam's; the role map, the Apple messages, the keychain plan and both
// exits are this file's.
// Env in:  the four names WANTED below (the register declares them on both Apple
//          rows; the fifth, row-only name is recognised and never read here)
//          GITHUB_REF, GITHUB_WORKFLOW_REF — read to DERIVE whether this is a
//          release lane. There is deliberately no flag a workflow can set or
//          forget; see the derivation block.
// Env out (via $GITHUB_ENV): APPLE_SIGNING_POSTURE and, when signing was
//          arranged, the keychain / plist / team paths the export steps read.
// Exit 0 = the posture is decided and legal for this lane. 1 = it is not.
//      2 = COVERAGE LOST — the question could not be asked (register, row or input missing).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { armedFatalLines, unarmedGapLines } from './channel-arming.mjs';
import { boundedSpawn, timeoutFromEnv } from './bounded-spawn.mjs';
import { REGISTER as PROVISIONING_REGISTER, bundleIdOf } from './apple-provisioning.mjs';
import {
  decideSecretSet,
  decodeKey,
  exportEnv,
  newlineOffenders,
  placeKey,
  releaseLane as laneOfRows,
  releaseSignal,
} from './signing-seam.mjs';

export { newlineOffenders };

export const APPS = 'catalog/apps.json';
export const REGISTER = 'tooling/channel-register.json';
/** BOTH Apple rows. One Apple Developer account and one distribution identity
 *  serve two App Store Connect records, so the two rows share the four names
 *  `WANTED` below — but they are NOT required to declare the same set, and
 *  saying they were is what broke this file (see the role map). macos-appstore
 *  carries one name iOS cannot use; the comparison is therefore per row. */
export const CHANNEL_IDS = ['ios-appstore', 'macos-appstore'];

export const POSTURE_ENV = 'APPLE_SIGNING_POSTURE';
export const RELEASE_SIGNED = 'release-signed';
export const UNSIGNED_PROOF = 'unsigned-build-proof';

/**
 * The role map. Every name here must appear in the declared set of the row it
 * belongs to, and vice versa — checked on every run, both directions, per row.
 *
 * 🔴 THE DEFECT THIS SHAPE CLOSES, AND IT WAS LIVE, NOT LATENT. Until
 * 2026-08-21 this map held FOUR names and `main()` compared the same four
 * against BOTH rows. Commit 2d2f51b (2026-08-20) added a FIFTH name —
 * `APPLE_INSTALLER_CERT_P12_BASE64` — to the macos-appstore row ALONE, and the
 * comparison had no way to say "this row, not that one", so it read a correct
 * declaration as drift. Measured on a clean tree 2026-08-21:
 * `node tooling/ci/apple-signing.mjs --app subscriptiontracker` → EXIT 1 (2 since 2026-09-16), "FAIL COVERAGE LOST
 * — …macos-appstore row and this script disagree… declared in the register and
 * unknown here: APPLE_INSTALLER_CERT_P12_BASE64". The `apple` job's only
 * invocation of this script — search `build-platforms.yml` for the line
 * `run: node tooling/ci/apple-signing.mjs --app`, which was :942 on 2026-08-21;
 * the anchor is the text, not the number — carries no `if:` guard, and
 * `continue-on-error:` is set on no job and no step in this repository
 * (measured 2026-08-21 over `.github/workflows/`: the literal string occurs
 * exactly twice, both inside `#` comments in deploy-web.yml — so zero
 * occurrences as a key), so the `apple` job failed on EVERY lane and the
 * `release` job that `needs:` it could not run — tag or no tag.
 *
 * ⚠️ THE TWO ROWS DO NOT DECLARE THE SAME SET, AND THAT IS THE RECORD RATHER
 * THAN A CONVENIENCE. The register's own `why` for the fifth name says it in
 * capitals: macOS only, do not copy it onto ios-appstore, because iOS ships an
 * .ipa and needs no installer certificate at all — declaring it there would name
 * a credential that lane can never use. So `ROW_ONLY_ENV` below is scoped, and a
 * name appearing on the wrong row is still COVERAGE LOST.
 *
 * ⚠️ WHAT THIS DOES NOT CATCH — said plainly, because an overclaiming comment
 * here would be worse than none:
 *   · the installer certificate is RECOGNISED, never ARRANGED. It is deliberately
 *     outside `WANTED`, so the all-or-none law does not range over it, nothing
 *     reads it from the environment, and supplying the other four still resolves
 *     to `release-signed`. The `productbuild` step stays a printed intent.
 *   · nothing here compares the register to the WORKFLOW. "A secret is declared
 *     and no lane names it" is assert-channel-register.mjs §8's subject, and §8
 *     prints that case rather than failing it.
 *   · a name on the wrong ROW is caught; a name given the wrong ROLE is not. The
 *     keys below are this file's own vocabulary and the register does not carry
 *     them, so swapping `p12` and `profiles` would pass this comparison and fail
 *     later, at a byte validator.
 */
export const ROLE_ENV = Object.freeze({
  p12: 'APPLE_DIST_CERT_P12_BASE64',
  p12Password: 'APPLE_DIST_CERT_PASSWORD',
  profiles: 'APPLE_PROVISIONING_PROFILES_BASE64',
  teamId: 'APPLE_TEAM_ID',
  installerP12: 'APPLE_INSTALLER_CERT_P12_BASE64',
});

/** The names this script READS FROM THE ENVIRONMENT and arranges into a keychain.
 *  Both Apple rows declare exactly these, and the all-or-none law ranges over
 *  exactly these. A name that arrives here starts being required of every row. */
export const WANTED = Object.freeze([ROLE_ENV.p12, ROLE_ENV.p12Password, ROLE_ENV.profiles, ROLE_ENV.teamId]);

/** THE WANTED NAMES THAT CARRY NO KEY MATERIAL — today, exactly one.
 *
 *  `APPLE_TEAM_ID` is a ten-character public identifier. It appears in
 *  ExportOptions.plist, in an .xcodeproj, in the App Store Connect URL and on
 *  the developer portal; it is a secret in this repository only because the
 *  owner has not published which team the apps belong to. Everything else in
 *  `WANTED` is a private key, its password, or the profiles that name it.
 *
 *  🔴 THIS LIST EXISTS TO KEEP ONE CASE OFF THE ALL-OR-NONE LAW, AND NOTHING
 *  MORE. On a BUILD PROOF lane nothing is signed, so a team id that is present
 *  is not half a signing arrangement — it is an identifier for an arrangement
 *  this lane was never going to make. `resolvePosture` uses it for exactly that,
 *  and only when `proofLane` is true; a RELEASE lane still gets the all-or-none
 *  refusal on every partial set, team-id-only included. See the box on
 *  `resolvePosture` for why the two lanes must answer differently.
 *
 *  ⚠️ A NAME ADDED HERE STOPS BEING ABLE TO FAIL A BUILD PROOF. Add one only if
 *  supplying it alone cannot produce a differently-signed artifact — which for
 *  anything holding or unlocking a key it cannot. */
export const KEYLESS_ENV = Object.freeze([ROLE_ENV.teamId]);

/** Names one row declares and the other must not, keyed by that row's channel id.
 *
 *  🔴 `WANTED` AND THIS MAP MUST PARTITION `ROLE_ENV`, AND A TEST SAYS SO. These
 *  are the file's second and third enumerations of the same names; a role added
 *  to `ROLE_ENV` alone would be KNOWN and yet reachable from neither, so
 *  `expectedNames()` would never expect it and `homeRowOf()` would return null
 *  for it while the printed message insisted it had a home row. The pin is the
 *  test named `WANTED and ROW_ONLY_ENV PARTITION ROLE_ENV` in
 *  test/apple-signing.test.mjs — added 2026-08-21, and it goes red on a sixth
 *  role that reaches neither list, or on a name that reaches both. */
export const ROW_ONLY_ENV = Object.freeze({
  'macos-appstore': Object.freeze([ROLE_ENV.installerP12]),
});

/** The exact set a given row must declare: the shared four plus its own. */
export function expectedNames(channelId) {
  return [...WANTED, ...(ROW_ONLY_ENV[channelId] ?? [])];
}

/**
 * The bidirectional comparison, for ONE row.
 *   extra     — declared there, unknown here. A new credential nobody taught
 *               this file about, so it cannot be validated or used at all.
 *   absent    — expected here, not declared there. It would be read from an
 *               environment nobody declared.
 *   misplaced — the sharp subset of `extra`: a name this file DOES know, sitting
 *               on a row it does not belong to. That reads as a copy-paste
 *               between two adjacent rows rather than as a new secret, so it is
 *               named separately with the row it actually belongs to.
 */
export function registerDrift(channelId, declared) {
  const expected = expectedNames(channelId);
  const known = Object.values(ROLE_ENV);
  const list = Array.isArray(declared) ? declared : [];
  const extra = list.filter((n) => !expected.includes(n)).sort();
  return {
    extra,
    absent: expected.filter((n) => !list.includes(n)).sort(),
    misplaced: extra.filter((n) => known.includes(n)),
  };
}

/** Which row a row-only name belongs to, so a misplacement can say where it goes. */
export function homeRowOf(name) {
  return Object.entries(ROW_ONLY_ENV).find(([, names]) => names.includes(name))?.[0] ?? null;
}

/** The item behind the absent signing arrangement, named in full so the printed gap
 *  is actionable without opening another file. */
export const OWNER_GAP = 'App Store screenshots and the owner-run first submission (the signing infrastructure now exists)';
//
// CORRECTED 2026-09-09, and this is the SECOND correction of this constant in as
// many days. The 2026-09-08 text said the missing item was a distribution
// CERTIFICATE. That was true when it was written and is not true now: on
// 2026-09-09 the App Store Connect API issued, against this account and with the
// key this repository already holds, a DISTRIBUTION certificate, a
// MAC_INSTALLER_DISTRIBUTION certificate, a UNIVERSAL App ID for
// `com.nikatru.subly`, and one IOS_APP_STORE and one MAC_APP_STORE profile
// against that App ID.
//
// 🔴 NO RESOURCE ID IS WRITTEN HERE (O-APPLE-RESOURCE-IDS-IN-COMMENTS). This
// header used to list them as the live ones after the App ID and both profiles
// had been deleted and re-minted, and it went on saying so. The live ids are
// `protected` (and each app's `resourceId`) in tooling/apple-provisioning.json;
// the ones that were live once are its `retired` list, dated from git history.
// assert-apple-entitlements.mjs refuses any of them written back into a .mjs
// under tooling/ci.
//
// The App ID and both profiles were superseded 2026-09-09, later the same day,
// when the owner moved the package identifier to
// `com.nikatru.subscriptiontracker` (ADR 067's slug rename). An App ID is not
// renamable and a provisioning profile is issued against ONE App ID, so the
// three identifier-bound resources were deleted and re-minted — profiles first,
// because a profile referencing an App ID blocks its deletion, and each deletion
// returned 204. The re-minted App ID kept capability IN_APP_PURCHASE, and its two
// profiles are named "Nikatru Subscription Tracker iOS App Store" and "…macOS App
// Store". The two CERTIFICATES are identifier-INDEPENDENT and were REUSED
// unchanged: both new profiles name the same distribution certificate the
// deleted pair did. `/v1/apps` held ZERO records before the deletion and holds zero now: no
// App Store Connect app record was ever created against `com.nikatru.subly`, so
// that identifier was NOT permanently spent and the deletion was clean.
// `APPLE_PROVISIONING_PROFILES_BASE64` was re-set from the two new profiles in
// the same pass — a profile is bound to its App ID, so the old secret would have
// failed the embedded-identifier check in build-platforms.yml rather than
// signing something wrong quietly.
//
// and the five repository secrets that carry them exist. So the gap is no longer
// an account (closed 2026-08-31), no longer a certificate (closed today), and no
// longer a missing build step: this file's `signedExportPlan` is now RUN by
// build-platforms.yml rather than printed, and that lane emits a signed .ipa and
// a signed .pkg.
//
// 🔴 WHAT REMAINS IS NOT SOMETHING CODE CAN CLOSE, AND THAT IS WHY THIS CONSTANT
// IS RE-POINTED RATHER THAN DELETED. A first submission needs screenshots,
// listing copy, and an App Store Connect app record — and the app record and the
// submission are the OWNER'S call, after he has tested the product. No agent
// creates either. `tooling/release/submit-appstore.mjs` still refuses `--submit`
// by design; that refusal is the mechanical half of this rule and this sentence
// is the documentary half. They must not drift apart.

// ═════════════════════════════════════════════════════════════════════════════
// PURE DECISION LOGIC
//
// 🔬 EVERYTHING BELOW THIS LINE AND ABOVE `main()` IS A PURE FUNCTION, AND THE
// REASON IS THIS BOX. `security`, `codesign`, `xcrun` and `productbuild` exist
// only on macOS; this repository is developed on Windows and its guard lane runs
// on ubuntu. If the decisions lived inside the darwin-only execution path they
// could not be tested anywhere the authors work, and an untested branch in a
// signing seam is the thing this file exists to prevent. So the decisions are
// separated from the doing: the laws below are unit-tested with fixtures on any
// platform, and only the `security` invocations are gated on
// `process.platform === 'darwin'`.
//
// 🔴 CORRECTED 2026-08-21 — THIS LINE SAID "the FOUR `security` invocations" AND
// THE NUMBER WAS FALSE. Re-measured today by importing this module and calling
// the function: `keychainPlan()` returns SIX steps and `argv[0] === 'security'`
// on all six — create-keychain, set-keychain-settings, unlock-keychain, import,
// set-key-partition-list, list-keychains. Their identity and ORDER are pinned by
// the test named `the keychain is created, unlocked and imported into — in that
// order`, so this prose is no longer the only copy of the count. A SEVENTH
// `security` call sits on the same darwin-gated path and is not part of the
// plan: `existingUserKeychains()` reads the current user search list so the
// sixth step can EXTEND it instead of replacing it. The test file's header
// already said "six"; this box was the copy that drifted — which is the whole
// argument for pinning a count in a test rather than in a sentence.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * THE ALL-OR-NONE LAW. Which of the wanted names carry a value.
 * `kind` is 'all' | 'none' | 'partial'; 'partial' is fatal on EVERY lane.
 */
export function secretSetLaw(values, wanted = WANTED) {
  return decideSecretSet(wanted, values);
}

/**
 * IS THIS A RELEASE LANE? — DERIVED, NEVER DECLARED IN THE WORKFLOW.
 *
 * 🔴 A HAND-WRITTEN `APPLE_SIGNING_REQUIRED: 'true'` LINE IN THE YAML WOULD BE
 * THE SAME MISTAKE ONE LEVEL UP. The whole defect being foreclosed here is a
 * switch that was never thrown; a flag a workflow can delete is a switch of
 * exactly that kind, and deleting it would silently revert a submission lane to
 * producing a build proof with every check still green. So the question is put
 * to two things a workflow file cannot delete:
 *
 *   (a) A TAG PUSH. `GITHUB_REF` starting `refs/tags/` is a release by every
 *       reading, and GitHub sets it, not us.
 *   (b) THE CHANNEL'S DECLARED SUBMISSION PATH. The register names the workflow
 *       that submits to App Store Connect ([10]D-10 limb (i)); a workflow whose
 *       whole subject is a submittable artifact may not produce one that cannot
 *       be submitted. `GITHUB_WORKFLOW_REF` is the running workflow's own path,
 *       also set by GitHub.
 *
 * Everything else — a branch push, a pull request, a fork, the weekly six-
 * platform proof — is a BUILD PROOF and is allowed to be unsigned provided it
 * says so. A fork PR holds no secrets, so the unsigned ending must stay a
 * passing one or every fork contribution fails on work only the owner can do.
 *
 * ⏱ 2026-09-25 — the derivation is signing-seam.mjs's `releaseSignal`; this is
 * its Apple reading. main() asks the seam's `releaseLane` instead, over the rows
 * `--channel` named, which adds channel-arming's verdict to the same answer.
 */
export function releaseLane({ gitRef = '', workflowRef = '', submissionWorkflows = [] } = {}) {
  return releaseSignal({ gitRef, workflowRef, submissionWorkflows, label: 'Apple' });
}

/**
 * THE THREE ENDINGS, plus the one this platform adds — and, since 2026-09-07,
 * one narrowing of the first: `proofLane` with a team id and no key material.
 *
 * Returns `{ posture, fatal }`. `fatal` is null or `{ lines }`; a caller that
 * ignores `fatal` and reads `posture` gets null, which cannot be exported.
 *
 * ⚠️ THE FOURTH ENDING — ALL FOUR SECRETS ON A NON-macOS RUNNER — IS FATAL ON
 * EVERY LANE, and that is a decision worth defending. The alternatives were to
 * export `unsigned-build-proof` (which would be a lie: the secrets WERE
 * supplied, and the verifier's posture comparison would then certify an unsigned
 * artifact as the intended outcome) or to export `release-signed` anyway (a
 * worse lie: nothing was arranged). Apple signing cannot be arranged off macOS —
 * `security` and the keychain do not exist elsewhere — so a lane that supplied
 * the secrets on another runner is misconfigured, and the honest report of a
 * misconfiguration is a failure with the platform named in it.
 *
 * 🔴 `required` IS NOW "A RELEASE LANE **AND** AN ARMED CHANNEL". The caller
 * derives it from the release signal AND `channel-arming.mjs`'s reading of the
 * register; `armed` carries the rows that made it true so the message names the
 * FIELD that armed them and not only the secret that is missing. Passing
 * `required: true` with no `armed` rows still produces the exact message it
 * always did — which is why every existing case of this function is unchanged.
 */
export function resolvePosture({ law, required, platform = process.platform, armed = [], proofLane = false } = {}) {
  if (law.kind === 'partial') {
    // 🔴 THE TEAM-ID-ONLY BUILD PROOF — ADDED 2026-09-07, AND IT IS A NARROWING
    // OF ONE CASE, NOT A HOLE IN THE LAW.
    //
    // MEASURED: run 34094776599's Apple job failed here with `supplied:
    // APPLE_TEAM_ID` while the line directly above it read `lane requires
    // signing: no ... a BUILD PROOF is legal here`. Run 33870692144 had passed
    // the identical step four days earlier — nothing in this file moved between
    // them; an `APPLE_TEAM_ID` repository secret was created in between, for the
    // store-metadata work. So a lane that declares it needs no signing was
    // failed by the arrival of a value it had already decided not to use.
    //
    // THE FIX IS NOT TO WEAKEN THE ALL-OR-NONE LAW, AND IT IS NOT A PLACEHOLDER
    // SECRET. No Apple distribution certificate exists (the enrolment IS active), so the other
    // three are not created in this repository today, and a build
    // PROOF that depends on them is a proof that can never run. What is wrong is
    // the ARITHMETIC: "three of four are missing" is a statement about a signing
    // arrangement, and on a proof lane there is no arrangement to be partial
    // about. The one supplied name carries no key material (`KEYLESS_ENV`), so
    // nothing here can produce a differently-signed artifact — the posture is
    // the same UNSIGNED-BUILD-PROOF it was when the secret did not exist.
    //
    // WHAT STAYS EXACTLY AS IT WAS. `proofLane` defaults to false, so every
    // existing caller and every existing case is unchanged. On a RELEASE lane
    // (`proofLane: false`) a team-id-only set is still fatal — there the missing
    // three are the whole point. And on a proof lane a set containing ANY key
    // material (a .p12 without its password, profiles without a certificate) is
    // still fatal, because that IS half an arrangement and it would go on to
    // produce a bundle signed by something nobody chose.
    if (proofLane && law.supplied.every((n) => KEYLESS_ENV.includes(n))) {
      return { posture: UNSIGNED_PROOF, fatal: null, ignoredIdentity: [...law.supplied] };
    }
    return {
      posture: null,
      fatal: {
        lines: [
          'FAIL Apple signing is HALF configured and this build refuses to guess.',
          `     supplied: ${law.supplied.join(', ')}`,
          `     missing:  ${law.missing.join(', ')}`,
          '     Supply all of them or none. Three of four produces an UNSIGNED or wrongly-signed bundle',
          '     from a run that looked like a signing run, and Apple rejects it at upload — after the',
          '     account, the App Store Connect record and the review slot are already spent.',
        ],
      },
    };
  }

  if (law.kind === 'none') {
    if (required) {
      return {
        posture: null,
        fatal: {
          lines: [
            'FAIL this is a RELEASE lane and no Apple signing secrets are configured.',
            `     absent: ${law.missing.join(', ')}`,
            '',
            ...armedFatalLines(armed),
            ...(armed.length ? [''] : []),
            '     A release lane that cannot sign must not produce an artifact. App Store Connect rejects an',
            '     unsigned upload, so continuing here would spend a build, an artifact and a version string to',
            '     arrive at a bundle that cannot be submitted — with every check green.',
            '',
            `     🔴 THE MISSING ITEM IS NOT A SECRET AND NO LONGER A CERTIFICATE: ${OWNER_GAP}.`,
            '     There is no distribution certificate to export - the enrolment is ACTIVE and empty - so the four',
            '     secrets below have not been created; the ASC API can now issue what they carry:',
            ...WANTED.map((n) => `       ${n}`),
            '     …or run this lane on a non-release trigger, where an unsigned BUILD PROOF is the recorded,',
            '     labelled outcome rather than a silent one.',
          ],
        },
      };
    }
    return { posture: UNSIGNED_PROOF, fatal: null };
  }

  if (platform !== 'darwin') {
    return {
      posture: null,
      fatal: {
        lines: [
          `FAIL all four Apple signing secrets are supplied and this runner is "${platform}", not macOS.`,
          '     ⬜ COVERAGE — `security`, `codesign`, `xcrun` and `productbuild` exist only on macOS, so the',
          '        keychain could not be created and NOTHING was arranged. Every value above was validated;',
          '        only the arrangement is impossible here.',
          '     Exporting a posture from this run would be a claim about a keychain that does not exist.',
          '     Run the Apple lane on a macOS runner (this repository pins macos-26), or unset the secrets',
          '     to take the labelled unsigned-build-proof path.',
        ],
      },
    };
  }

  return { posture: RELEASE_SIGNED, fatal: null };
}

/**
 * The `security` invocations that import one .p12 into a fresh, per-run
 * keychain and make it the one `codesign` searches.
 *
 * Constructed rather than executed so the SHAPE is testable off macOS. Each
 * entry carries its argv and the human reason, and `redactArgv` is what any
 * printer must pass it through — a plan that prints its own passwords is a
 * plan that leaks two secrets into a public build log.
 *
 * The order matters and is not arbitrary:
 *   create-keychain          a NEW keychain, never the login keychain — a CI job
 *                            must not be able to touch a developer's own keys
 *   set-keychain-settings    -lut 21600: no automatic re-lock mid-build, and a
 *                            6-hour ceiling so a leaked path is not a leaked key
 *                            forever
 *   unlock-keychain          import and codesign both need it open
 *   import -T                grants ONLY the four tools that need the key. `-A`
 *                            (any application) is the tempting shorter form and
 *                            is strictly broader for no benefit
 *   set-key-partition-list   without it, macOS 10.12+ shows a UI prompt on first
 *                            use of the key — which on a headless runner is not
 *                            a prompt, it is a hang until the job times out
 *   list-keychains -s        codesign searches the SEARCH LIST, not a path; a
 *                            keychain that exists and is not in it is invisible
 */
export function keychainPlan({ keychain, keychainPassword, p12Path, p12Password, existingKeychains = [] } = {}) {
  return [
    { why: 'a fresh keychain, never the login keychain', argv: ['security', 'create-keychain', '-p', keychainPassword, keychain] },
    { why: 'no auto-relock mid-build; 6-hour ceiling', argv: ['security', 'set-keychain-settings', '-lut', '21600', keychain] },
    { why: 'import and codesign both need it open', argv: ['security', 'unlock-keychain', '-p', keychainPassword, keychain] },
    {
      why: 'import the distribution identity, granting only the tools that need it',
      argv: [
        'security', 'import', p12Path, '-k', keychain, '-P', p12Password, '-f', 'pkcs12',
        '-T', '/usr/bin/codesign', '-T', '/usr/bin/security', '-T', '/usr/bin/productbuild', '-T', '/usr/bin/productsign',
      ],
    },
    {
      why: 'without this the first key use raises a UI prompt, which on a headless runner is a hang',
      argv: ['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', keychainPassword, keychain],
    },
    {
      why: 'codesign searches the search list, not a path',
      argv: ['security', 'list-keychains', '-d', 'user', '-s', keychain, ...existingKeychains],
    },
  ];
}

/** Describe the whitespace around a secret WITHOUT quoting any of it.
 *
 *  Every element of the return value is a literal written here, so no part of
 *  the input — not a character, not a length — can travel into a log through
 *  this function. That is the property that makes it safe to call on a
 *  passphrase, and it is why the caller reports "a trailing carriage return"
 *  rather than a count.
 *
 *  The CR case is named FIRST and separately because it is the one that actually
 *  happened, and the one nobody sees: `openssl rand` on Windows emits CRLF, so a
 *  `tr -d '\n'` leaves a CR that every local tool then round-trips happily. */
export function whitespaceShape(raw) {
  const s = String(raw ?? '');
  const found = [];
  if (/^\s/.test(s)) found.push('leading whitespace');
  if (/\r\n$/.test(s)) found.push('a trailing CRLF — the Windows `openssl rand` case');
  else if (/\r$/.test(s)) found.push('a trailing carriage return — the Windows `openssl rand` case');
  else if (/\n$/.test(s)) found.push('a trailing newline');
  else if (/[ \t]$/.test(s)) found.push('a trailing space or tab');
  else if (/\s$/.test(s)) found.push('trailing whitespace');
  return found.length === 0 ? ['whitespace this check does not name individually'] : found;
}

/** Where Xcode SCANS for provisioning profiles, newest location first.
 *
 *  Xcode 16+ reads `~/Library/Developer/Xcode/UserData/Provisioning Profiles`;
 *  everything before it read `~/Library/MobileDevice/Provisioning Profiles`.
 *  Both are returned rather than one chosen from the toolchain version, because
 *  choosing would make this depend on a version check that is itself a thing
 *  that can be wrong, to save one file copy.
 *
 *  Pure so the paths can be asserted without a home directory: the caller
 *  supplies `home`, and only `main()` reads the environment. */
export function xcodeProfileDirs(home = process.env.HOME ?? '') {
  return [
    join(home, 'Library', 'Developer', 'Xcode', 'UserData', 'Provisioning Profiles'),
    join(home, 'Library', 'MobileDevice', 'Provisioning Profiles'),
  ];
}

/** The SECOND import: the Mac Installer Distribution identity, which signs the
 *  .pkg and CANNOT sign anything else.
 *
 *  🔴 THIS IS A SEPARATE STEP AND NOT A SECOND ENTRY IN `keychainPlan` BECAUSE
 *  IT IS OPTIONAL IN A WAY THE OTHER FOUR ARE NOT. `WANTED` is the all-or-none
 *  set and every Apple row declares it; `APPLE_INSTALLER_CERT_P12_BASE64` is
 *  declared by the macos-appstore row ALONE (`ROW_ONLY_ENV`), because the
 *  ios-appstore row has no .pkg and must not be failed for lacking an installer
 *  certificate. Folding it into the all-or-none law would start requiring it of
 *  the iOS row; leaving it out of the keychain entirely leaves `productbuild`
 *  with no identity. So it imports when supplied, and the macOS packaging step
 *  refuses loudly when the identity it needs is not in the keychain — the gap
 *  lands on the ONE lane that needs it, at the moment it is needed.
 *
 *  `-T /usr/bin/productbuild` and `-T /usr/bin/productsign` are the point of the
 *  step: those are the only two tools that ever use this key. */
export function installerImportPlan({ keychain, p12Path, p12Password } = {}) {
  return [
    {
      why: 'import the Mac Installer Distribution identity for productbuild',
      argv: [
        'security', 'import', p12Path, '-k', keychain, '-P', p12Password, '-f', 'pkcs12',
        '-T', '/usr/bin/productbuild', '-T', '/usr/bin/productsign', '-T', '/usr/bin/security',
      ],
    },
  ];
}

/**
 * Pull the real identity names out of `security find-identity -v <keychain>`.
 *
 * 🔴 THE NAMES ARE READ BACK OUT OF THE KEYCHAIN, NEVER CONSTRUCTED FROM THE
 * TEAM ID. The obvious shortcut — `Apple Distribution: ${owner} (${teamId})` —
 * requires this file to know the account holder's name, which it does not and
 * should not, and it produces a string that LOOKS right while matching no
 * identity, so `codesign -s` fails with "no identity found" several minutes into
 * a build. What is in the keychain is the authority for what can be signed with.
 *
 * `find-identity` prints `  1) <40-hex-sha1> "<name>"` per identity. Apple names
 * the app-signing identity `Apple Distribution: …` (the modern name) or
 * `3rd Party Mac Developer Application: …` (its legacy spelling, still issued
 * for MAC_APP_DISTRIBUTION); the installer identity is always
 * `3rd Party Mac Developer Installer: …`. Order matters in the app match: the
 * installer prefix also begins "3rd Party Mac Developer", so testing for the
 * installer FIRST is what keeps it out of the application slot.
 */
export function pickIdentities(stdout) {
  const names = [...String(stdout ?? '').matchAll(/^\s*\d+\)\s+[0-9A-F]{40}\s+"([^"]+)"/gim)].map((m) => m[1]);
  const installer = names.find((n) => n.startsWith('3rd Party Mac Developer Installer:')) ?? null;
  const application =
    names.find((n) => n.startsWith('Apple Distribution:')) ??
    names.find((n) => n.startsWith('3rd Party Mac Developer Application:')) ??
    null;
  return { names, application, installer };
}

/**
 * Replace every occurrence of a secret value with `***`.
 *
 * Exact-value replacement, not a name-based one: the passwords appear as bare
 * argv elements with nothing around them to key on, and the empty string is
 * excluded because replacing it would blank the whole line.
 */
export function redactArgv(argv, secrets = []) {
  const hide = secrets.filter((s) => typeof s === 'string' && s !== '');
  return argv.map((a) => (hide.includes(a) ? '***' : a));
}

/** Apple team identifiers are ten upper-case alphanumerics. Format only — no
 *  check here can tell a well-formed team id from the RIGHT one, and pretending
 *  otherwise would be an assertion that cannot fail. */
export function teamIdProblem(value) {
  if (!/^[A-Z0-9]{10}$/.test(String(value))) {
    return (
      `${ROLE_ENV.teamId} is not a 10-character Apple team identifier (ten upper-case letters or digits). ` +
      'The value is never printed. With the wrong team id xcodebuild selects a different identity or none at ' +
      'all, and the build that results is refused at upload rather than here.'
    );
  }
  return null;
}

/**
 * A `.mobileprovision` / `.provisionprofile` is a CMS (PKCS#7) envelope with an
 * XML property list inside it. The plist is stored as plain text, so the
 * envelope does not have to be parsed to read it — the bytes between `<?xml`
 * and the closing `</plist>` are the whole record.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES NOT DO: it does not verify the CMS signature.
 * A profile is not a secret and not an authenticator — Apple's own tooling
 * validates it at signing time, and a check here that "verified" it with an
 * incomplete implementation would be an assertion whose passing means nothing.
 * What is read is exactly what this script must cross-check: the team it belongs
 * to, the application it is for, its name (which ExportOptions.plist addresses
 * it by) and when it expires.
 *
 * Returns null when the bytes are not a profile at all.
 */
export function parseMobileProvision(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer);
  const start = text.indexOf('<?xml');
  const end = text.lastIndexOf('</plist>');
  if (start === -1 || end === -1 || end < start) return null;
  const plist = text.slice(start, end + '</plist>'.length);

  const str = (key) => plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`))?.[1] ?? null;
  const date = (key) => plist.match(new RegExp(`<key>${key}</key>\\s*<date>([^<]*)</date>`))?.[1] ?? null;
  const arr = (key) => {
    const block = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1];
    if (block === undefined) return [];
    return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  };

  const name = str('Name');
  const uuid = str('UUID');
  const teamIds = arr('TeamIdentifier');
  const expires = date('ExpirationDate');
  // `application-identifier` lives in the Entitlements dict and is
  // `<TEAMID>.<bundle id>`; the wildcard form ends in `.*`.
  //
  // 🔴 macOS SPELLS THE SAME KEY DIFFERENTLY, AND READING ONLY THE iOS SPELLING
  // SILENTLY DROPS EVERY .provisionprofile. Measured 2026-09-09 on the two
  // profiles this account actually issued: the IOS_APP_STORE profile carries
  // `application-identifier = Q2B2BY33B6.com.nikatru.subly`, the MAC_APP_STORE
  // (that identifier was RETIRED later the same day for
  // `com.nikatru.subscriptiontracker`; the measurement is quoted as measured,
  // and the two spellings it found are a property of the PLATFORM, not of the
  // identifier — re-read on the replacement profiles and both still hold)
  // profile carries `com.apple.application-identifier` with the identical
  // value. Before this fallback the macOS profile parsed to `bundleId: null`,
  // which is not a loud failure anywhere — it made the profile INVISIBLE to the
  // bundle-id cross-check below and excluded it from the ExportOptions
  // `provisioningProfiles` map, whose builder filters on `p.bundleId && p.name`.
  // A profile that is silently not mapped is the "green means ran" shape: the
  // build signs with whatever Xcode picks and the disagreement surfaces at
  // upload. Read both spellings; prefer the iOS one when a profile has both.
  const appIdentifier = str('application-identifier') ?? str('com\\.apple\\.application-identifier');
  const bundleId =
    appIdentifier && teamIds.some((t) => appIdentifier.startsWith(`${t}.`))
      ? appIdentifier.slice(appIdentifier.indexOf('.') + 1)
      : appIdentifier;

  if (name === null && teamIds.length === 0 && appIdentifier === null) return null;
  return { name, uuid, teamIds, expires, appIdentifier, bundleId };
}

/**
 * The plist `flutter build ipa --export-options-plist` and `xcodebuild
 * -exportArchive` consume.
 *
 * `signingStyle: manual` is not a preference. Automatic signing asks Apple for a
 * profile at build time, which needs an App Store Connect API key this lane does
 * not have and makes the artifact depend on the state of a remote account —
 * exactly the kind of build nobody can reproduce a month later. Manual signing
 * uses the profiles supplied as a secret, which is why they are a secret.
 */
export function exportOptionsPlist({ teamId, method = 'app-store-connect', profiles = [], signingStyle = 'manual' } = {}) {
  const usable = profiles.filter((p) => p && p.bundleId && p.name);
  // 🔴 TWO PROFILES FOR ONE BUNDLE ID IS REFUSED, NOT LAST-ONE-WINS. Measured
  // 2026-09-09, and it was caused by fixing a DIFFERENT bug an hour earlier.
  // This app is a universal purchase: the iOS and macOS profiles carry the SAME
  // bundle id — `com.nikatru.subly` when this was measured, today
  // `com.nikatru.subscriptiontracker` — deliberately. Until the macOS spelling of
  // `application-identifier` was read, the macOS profile resolved to
  // `bundleId: null` and the filter above silently dropped it — so this map
  // happened to hold exactly one entry, for the right platform, by accident.
  // Once both parsed, both landed under one key and the LAST won, which was the
  // macOS one. `xcodebuild -exportArchive` then said:
  //
  //     error: exportArchive Provisioning profile "… macOS App Store" has
  //     platform "macOS", which does not match the current platform "iOS".
  //
  // A plist is per-platform, so the caller must pass one platform's profiles. A
  // duplicate key here means it did not, and emitting a dict whose meaning
  // depends on ordering is how the accident above stayed invisible.
  const seen = new Map();
  for (const p of usable) {
    if (seen.has(p.bundleId)) {
      throw new Error(
        `exportOptionsPlist: two profiles claim bundle id "${p.bundleId}" — "${seen.get(p.bundleId)}" and "${p.name}". ` +
          'An ExportOptions.plist describes ONE platform; pass only that platform\'s profiles. This app is a ' +
          'universal purchase, so its iOS and macOS profiles share a bundle id by design and a plist holding both ' +
          'silently exports against whichever came last.',
      );
    }
    seen.set(p.bundleId, p.name);
  }
  const mapping = usable
    .map((p) => `      <key>${p.bundleId}</key>\n      <string>${p.name}</string>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    '    <key>method</key>',
    `    <string>${method}</string>`,
    '    <key>teamID</key>',
    `    <string>${teamId}</string>`,
    '    <key>signingStyle</key>',
    `    <string>${signingStyle}</string>`,
    '    <key>uploadSymbols</key>',
    '    <true/>',
    '    <key>provisioningProfiles</key>',
    '    <dict>',
    ...(mapping === '' ? [] : [mapping]),
    '    </dict>',
    '  </dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * The signed-export INTENTS: the exact commands the later steps run, built here
 * so the paths this script produced are the paths they consume.
 *
 * Printed rather than executed. This file's job ends at "the credential is in
 * place and here is what to run with it"; running a Flutter build from inside a
 * credential-arranging step would put an eight-minute compile inside the step
 * that holds the passwords in argv, and would make one failure indistinguishable
 * from the other.
 */
export function signedExportPlan({ appSlug, exportOptionsPath, keychain, teamId, outDir } = {}) {
  const plan = [
    {
      channel: 'ios-appstore',
      what: 'the signed .ipa the App Store Connect upload takes',
      cwd: `apps/${appSlug}`,
      argv: ['flutter', 'build', 'ipa', '--release', '--export-options-plist', exportOptionsPath],
      produces: `apps/${appSlug}/build/ios/ipa/*.ipa`,
    },
    {
      channel: 'macos-appstore',
      what: 'the signed .app the installer package wraps',
      cwd: `apps/${appSlug}`,
      argv: ['flutter', 'build', 'macos', '--release'],
      produces: `apps/${appSlug}/build/macos/Build/Products/Release/*.app`,
    },
    {
      channel: 'macos-appstore',
      what: 'the .pkg the Mac App Store accepts',
      cwd: `apps/${appSlug}`,
      argv: [
        'productbuild', '--component', 'build/macos/Build/Products/Release/<App>.app', '/Applications',
        '--sign', `3rd Party Mac Developer Installer: <name> (${teamId})`,
        '--keychain', keychain,
        join(outDir ?? '$RUNNER_TEMP', `${appSlug}.pkg`),
      ],
      produces: join(outDir ?? '$RUNNER_TEMP', `${appSlug}.pkg`),
    },
  ];
  return plan;
}

/**
 * A newline in a value is REFUSED rather than escaped. `$GITHUB_ENV` is
 * line-oriented, so a value carrying one writes a SECOND assignment of the
 * writer's choosing into the environment of every later step in the job — a
 * secret becomes a way to set PATH. No Apple credential contains a line break,
 * so refusing costs nothing, and the alternative (a heredoc with a random
 * delimiter) only moves the same question to the delimiter.
 *
 * ⏱ 2026-09-25 — `newlineOffenders` is signing-seam.mjs's, imported and
 * re-exported at the top of this file (O-SIGNING-PRIMITIVES-IN-FOUR-COPIES).
 */

/** ZIP64 marks an absent 32-bit value with an all-ones sentinel and carries the
 *  real one in a 64-bit field elsewhere. 0xFFFFFFFF read as an offset is how
 *  the Windows leg crashed; these two names exist so that number never appears
 *  bare in a comparison again. */
const U32_SENTINEL = 0xffffffff;
const U16_SENTINEL = 0xffff;

/**
 * The ZIP64 extended-information extra field (header id 0x0001) of ONE
 * central-directory entry, or null when it is absent or unusable.
 *
 * 🔴 THE SLOTS ARE POSITIONAL AND CONDITIONAL, WHICH IS THE WHOLE DIFFICULTY.
 * APPNOTE 4.5.3 orders them uncompressed size, compressed size, local-header
 * offset, disk-start — and each 8-byte slot is present ONLY IF its 32-bit
 * counterpart in the fixed header was the sentinel. So a reader that wants the
 * compressed size cannot simply take slot 0: it must first ask whether the
 * UNCOMPRESSED size was a sentinel too, and step over that slot if it was. Both
 * shapes occur inside ONE real archive — a 16-byte payload (two sizes, real
 * offset) for the first member and a 24-byte one (two sizes and the offset) for
 * every later member, because the first member sits at offset 0 and 0 needs no
 * 64-bit field. Measured on the fixture this change is tested against.
 *
 * `whichPresent` is therefore the CALLER'S reading of the fixed header, never a
 * guess made here. Anything that does not add up — a truncated payload, no
 * 0x0001 field at all, a value larger than the archive that contains it — is
 * REFUSED as null rather than approximated, and unzip() turns that into "not a
 * readable zip", which both callers already treat as a failure.
 */
function zip64ExtraFields(buffer, extraStart, extraLen, whichPresent) {
  const end = extraStart + extraLen;
  if (end > buffer.length) return null;
  for (let q = extraStart; q + 4 <= end; ) {
    const id = buffer.readUInt16LE(q);
    const size = buffer.readUInt16LE(q + 2);
    const payloadEnd = q + 4 + size;
    if (payloadEnd > end) return null;
    if (id !== 0x0001) { q = payloadEnd; continue; }
    let r = q + 4;
    // Read one 8-byte slot, bounded by the PAYLOAD only. Whether the VALUE is
    // credible depends on what the slot means, which is the caller's business
    // below and not this reader's.
    const slot = () => {
      if (r + 8 > payloadEnd) return null;
      const v = buffer.readBigUInt64LE(r);
      r += 8;
      return v;
    };
    // 🔴 THIS BOUND IS TRUE OF AN OFFSET AND OF A COMPRESSED SIZE, AND FALSE OF
    // AN UNCOMPRESSED ONE. Nothing inside this archive can START past its end,
    // and no member's stored bytes can be more numerous than the file holding
    // them — but a member's UNCOMPRESSED size is a property of the decompressed
    // content and is routinely LARGER than the whole archive. That is what
    // compression is.
    //
    // MEASURED 2026-08-25 on the real subscriptiontracker.msix (build-platforms 32823633046,
    // the first run to keep the package after the guard refused it): entry [2]
    // `flutter_windows.dll` declares an uncompressed size of 21,284,864 bytes
    // inside a 16,585,733-byte archive — 1.28x the file that contains it, and
    // entirely ordinary for a DLL. Applying the offset bound to that slot
    // returned null, which unzip() turned into "could not be read as a zip",
    // which the guard reported as COVERAGE LOST over the whole package. A check
    // added for safety was the thing refusing a valid package.
    //
    // The uncompressed slot is READ ONLY TO STEP OVER IT — its value is
    // discarded — so it needs the payload bound and nothing else.
    const withinArchive = (v) => (v === null || v > BigInt(buffer.length) ? null : Number(v));
    const out = {};
    if (whichPresent.uncompressedSize && slot() === null) return null;
    if (whichPresent.compressedSize) {
      const v = withinArchive(slot());
      if (v === null) return null;
      out.compressedSize = v;
    }
    if (whichPresent.localOffset) {
      const v = withinArchive(slot());
      if (v === null) return null;
      out.localOffset = v;
    }
    return out;
  }
  return null;
}

/**
 * A minimal ZIP reader — central directory only, stored and deflated members,
 * ZIP64 included. TWO CALLERS, ON TWO PLATFORMS:
 *
 *   • profileMembers() below, for the APPLE provisioning-profile bundle the
 *     profiles secret carries. That secret holds a SET (one iOS profile, one
 *     macOS profile at least), and a set has to arrive in a container. A zip is
 *     what every tool on every desk already produces, so it is what is
 *     accepted; the alternative — an invented separator between concatenated
 *     profiles — would be a format only this repository knows, which nobody
 *     would produce correctly under pressure.
 *   • tooling/ci/assert-artifact-signed-msix.mjs, for the WINDOWS .msix that
 *     `dart run msix:create` writes, opened to read AppxManifest.xml and to
 *     prove AppxSignature.p7x is ABSENT.
 *
 * 🔴 THIS COMMENT USED TO CLAIM THE NARROW SCOPE, AND THAT CLAIM COST THE
 * WINDOWS LEG WEEKS. It said the reader existed for "a handful of small files",
 * "one iOS profile, one macOS profile" — while the msix guard had been
 * importing it the whole time. The stated domain and the real one disagreed,
 * and the code was correct for the stated one, so the header read like an
 * explanation instead of like a bug. MEASURED on build-platforms run
 * 32814517717 (2026-08-25, the first dispatch to get past the argv defect
 * PR #366 fixed): the 16,585,912-byte .msix made this function throw
 * `RangeError [ERR_OUT_OF_RANGE] … Received 4294967295`, and the guard CRASHED
 * instead of reporting anything. The other five platforms were green on that
 * same run.
 *
 * 🔴 AND ZIP64 IS NOT A ">4 GB" FEATURE HERE. 4294967295 is 0xFFFFFFFF, the
 * ZIP64 sentinel, in a package of 16.6 MB. An .msix is an OPC/APPX package and
 * the packaging tool writes the ZIP64 end-of-central-directory record, its
 * locator and the sentinels REGARDLESS OF SIZE. A reader that handles only the
 * 32-bit fields is not "enough for small archives"; it is enough for archives
 * whose WRITER chose not to use ZIP64, which is a property of the tool and not
 * of the bytes.
 *
 * The ZIP64 path is entered ONLY where a sentinel is actually present, so an
 * archive carrying none — every zip an Apple desk produces today — is read by
 * exactly the statements that read it before, in the same order. That is not a
 * claim: test/apple-signing.test.mjs pins the whole non-ZIP64 answer set,
 * truncations and byte corruptions included.
 *
 * Only two compression methods exist in practice for the files either caller
 * hands over and both are handled. Anything else is REFUSED by name rather than
 * skipped: a member silently dropped is a profile silently missing, and the
 * build that follows fails at codesign with a message about entitlements.
 */
export function unzip(buffer) {
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  let count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);

  // ── ZIP64, entered only where the 32-bit record says it cannot answer ──────
  // The locator sits immediately before the EOCD and points at the EOCD64
  // record, which carries the real entry count and central-directory offset.
  // A sentinel with no locator behind it is not a zip this reader can open, and
  // saying so with null — the answer both callers already handle — is the whole
  // difference between a verdict and an ERR_OUT_OF_RANGE stack trace.
  if (count === U16_SENTINEL || p === U32_SENTINEL) {
    const loc = eocd - 20;
    if (loc < 0 || buffer.readUInt32LE(loc) !== 0x07064b50) return null;
    const rec = buffer.readBigUInt64LE(loc + 8);
    if (rec + 56n > BigInt(buffer.length)) return null;
    const recAt = Number(rec);
    if (buffer.readUInt32LE(recAt) !== 0x06064b50) return null;
    if (count === U16_SENTINEL) {
      const total = buffer.readBigUInt64LE(recAt + 32);
      if (total > BigInt(buffer.length)) return null;
      count = Number(total);
    }
    if (p === U32_SENTINEL) {
      const off = buffer.readBigUInt64LE(recAt + 48);
      if (off > BigInt(buffer.length)) return null;
      p = Number(off);
    }
  }

  const out = [];
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(p + 10);
    let compressedSize = buffer.readUInt32LE(p + 20);
    const nameLen = buffer.readUInt16LE(p + 28);
    const extraLen = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    let localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // The per-entry half of the same story. `p + 24` — the uncompressed size —
    // is read INSIDE the branch because that is the only place its value means
    // anything: it says whether the extra field's first slot belongs to it.
    // ⚠️ AND THAT IS A PREFERENCE, NOT A PINNED PROPERTY. Hoisting it beside
    // the other fixed reads was MUTATED on 2026-08-25 and the suite stayed
    // GREEN — both placements answer identically for every archive the tests
    // can build, because the only input that could tell them apart is one where
    // p+24 is off the end while p+20 is not, and BOTH placements throw
    // ERR_OUT_OF_RANGE there. Saying so here is cheaper than a test that
    // pretends to hold the line.
    if (compressedSize === U32_SENTINEL || localOffset === U32_SENTINEL) {
      const z = zip64ExtraFields(buffer, p + 46 + nameLen, extraLen, {
        uncompressedSize: buffer.readUInt32LE(p + 24) === U32_SENTINEL,
        compressedSize: compressedSize === U32_SENTINEL,
        localOffset: localOffset === U32_SENTINEL,
      });
      if (z === null) return null;
      if (z.compressedSize !== undefined) compressedSize = z.compressedSize;
      if (z.localOffset !== undefined) localOffset = z.localOffset;
    }
    p += 46 + nameLen + extraLen + commentLen;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const lNameLen = buffer.readUInt16LE(localOffset + 26);
    const lExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buffer.slice(dataStart, dataStart + compressedSize);
    if (name.endsWith('/')) continue;
    if (method === 0) out.push({ name, bytes: raw });
    else if (method === 8) out.push({ name, bytes: inflateRawSync(raw) });
    else out.push({ name, bytes: null, unsupportedMethod: method });
  }
  return out;
}

/**
 * Turn the decoded profiles blob into named members.
 * A single DER profile (first byte 0x30) and a zip of several are both accepted.
 */
export function profileMembers(bytes) {
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) {
    const entries = unzip(bytes);
    if (entries === null) return { kind: 'zip', members: null };
    return {
      kind: 'zip',
      members: entries.filter((e) => !e.name.split('/').pop().startsWith('.') && !e.name.startsWith('__MACOSX/')),
    };
  }
  if (bytes[0] === 0x30) return { kind: 'single', members: [{ name: 'profile-1.mobileprovision', bytes }] };
  return { kind: 'unknown', members: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE IMPURE HALF — argument handling, the filesystem, and the darwin-only
// execution of the plan above.
// ═════════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
/** Every value of a repeatable flag, in order. A flag with nothing after it (or
 *  another flag) comes back as null, so the caller refuses it instead of
 *  dropping it and signing for the default set. */
const optAll = (name) =>
  argv.flatMap((a, i) => (a === `--${name}` ? [i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : null] : []));

/** 🔴 AN EMPTY STRING IS NOT AN UNSET VARIABLE, and `??` cannot tell them apart.
 *  Recorded on the Android side by mutation, 2026-08-04, and reused unchanged
 *  rather than re-derived: with `GITHUB_ENV=''` the null check passes and the
 *  script crashes with `ENOENT: open ''` AFTER printing a successful posture,
 *  and with `RUNNER_TEMP=''` the key material is written to `resolve('')` — the
 *  CURRENT DIRECTORY, which is the repository, which is the one place this file
 *  exists to keep it out of. Neither can happen on a real runner, and "it cannot
 *  happen in production" is how both survive review. */
const envOr = (name, fallback) => {
  const v = (process.env[name] ?? '').trim();
  return v === '' ? fallback : v;
};

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\napple-signing: FAILED');
  // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\napple-signing: FAILED');
  process.exit(1);
}

function main() {
  const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  // 🔴 THE BARE `tmpdir()` FALLBACK WROTE PREDICTABLY-NAMED FILES INTO A
  // WORLD-WRITABLE DIRECTORY, and CodeQL called it (`js/insecure-temporary-file`,
  // high). In CI this path is never taken — `RUNNER_TEMP` is set and is private
  // to the job — but the fallback is what a developer running this by hand gets,
  // and `/tmp/subly-distribution.p12` is a name anyone can pre-create as a
  // symlink. The file that lands there is a PKCS#12 holding a real private key.
  //
  // `mkdtempSync` creates a fresh directory with a random suffix, owned by this
  // user, mode 0700. It is the documented remedy rather than a way to quiet the
  // rule, and the two explicit paths — `--out` and `RUNNER_TEMP` — are untouched
  // because both are already private and both are chosen by the caller.
  //
  // `envOr` is kept for the empty-string case: RUNNER_TEMP set to '' must fall
  // through to the private directory, not resolve to the process's cwd.
  const OUT_DIR = resolve(opt('out') ?? envOr('RUNNER_TEMP', null) ?? mkdtempSync(join(tmpdir(), 'apple-signing-')));
  const GITHUB_ENV = opt('github-env') ?? envOr('GITHUB_ENV', null);
  const METHOD = opt('method') ?? 'app-store-connect';

  const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

  // ── the register: the authority for the NAMES and for the release lane ─────
  const registerRaw = read(REGISTER);
  if (registerRaw === null) {
    coverageLost([
      `${REGISTER} does not exist.`,
      'It declares the Apple signing secrets and names the workflow that submits to App Store Connect,',
      'which is both halves of how this script decides anything. Without it the decision would be made',
      'blind and would default to "a build proof is fine" — on the one lane where it is not.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(registerRaw);
  } catch (e) {
    coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
  }

  // ── which rows: `--channel <id>`, repeatable; absent, both Apple rows ──────
  const named = optAll('channel');
  const notOurs = named.filter((c) => c === null || !CHANNEL_IDS.includes(c));
  if (notOurs.length) {
    die([
      `FAIL --channel ${notOurs.map((c) => c ?? '(no value)').join(', ')} is not a channel this script signs.`,
      `     It signs ${CHANNEL_IDS.join(' and ')}. Another key kind's channel has its own adapter — the one`,
      `     its row names in \`signing.seam.prepare\` in ${REGISTER}.`,
    ]);
  }
  const channelIds = named.length > 0 ? [...new Set(named)] : CHANNEL_IDS;

  const rows = [];
  for (const id of channelIds) {
    const row = (register.channels ?? []).find((c) => c.id === id);
    if (!row) {
      coverageLost([
        `${REGISTER} declares no "${id}" channel.`,
        'That row is where the Apple signing secrets are enumerated ([9]R-3 limb 2) and where the submission',
        'workflow is declared. With it gone this script would compare its role map to nothing and the release',
        'lane derivation would silently stop recognising a submission run.',
      ]);
    }
    rows.push(row);
  }

  // ── the role map vs the register, both directions, both rows ──────────────
  for (const row of rows) {
    const declared = row.signing?.ciSecrets?.names;
    if (!Array.isArray(declared) || declared.length === 0) {
      coverageLost([
        `${REGISTER}'s ${row.id} row declares no \`signing.ciSecrets.names\`.`,
        'That list is the authority for which secrets are Apple signing material. With it absent this script',
        'would fall back to the copy below, which is the drift it exists to catch.',
      ]);
    }
    const { extra, absent, misplaced } = registerDrift(row.id, declared);
    if (extra.length || absent.length) {
      coverageLost([
        `${REGISTER}'s ${row.id} row and this script disagree about which secrets sign an Apple build.`,
        extra.length ? `     declared in the register and unknown here: ${extra.join(', ')}` : '',
        absent.length ? `     expected here and not declared in the register: ${absent.join(', ')}` : '',
        ...misplaced.map(
          (n) =>
            `     ⚠️ ${n} IS known here — but only on the ${homeRowOf(n)} row, and the ${row.id} lane can ` +
            'never use it. This reads as a copy between two adjacent rows, not as a new credential.',
        ),
        'Each name is validated and used differently — one is a PKCS#12, one its passphrase, one a profile',
        'set, one a team identifier — so a name this script does not recognise cannot be handled at all, and',
        'a name it expects that the register has dropped would be read from an environment nobody declared.',
      ].filter((l) => l !== ''));
    }
  }

  // ── which app ──────────────────────────────────────────────────────────────
  const appsRaw = read(APPS);
  if (appsRaw === null) coverageLost([`${APPS} does not exist — there is no app to sign for.`]);
  let apps;
  try {
    apps = JSON.parse(appsRaw);
  } catch (e) {
    coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
  }
  if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);
  const appId = opt('app') ?? apps[0]?.slug;
  const app = apps.find((a) => a.slug === appId);
  if (!app) die([`FAIL no app "${appId}" in ${APPS}.`, `     Known: ${apps.map((a) => a.slug).join(', ')}`]);

  // ── is this a release lane, and is a row it serves armed? ─────────────────
  // 🔴 IS EITHER APPLE ROW ARMED? Derived from the rows this script already
  // found by id, out of their own `served` / `submittable` / `lane` fields —
  // there is no channel name in this decision, only the rows the register
  // handed back. Any row arming makes the release lane fatal: ONE identity
  // signs both, so a partial answer is not on offer. The seam's `releaseLane`
  // asks channel-arming for that verdict; `mustSign` is "release lane AND armed".
  const { lane, gap, mustSign: releaseFatal } = laneOfRows({
    rows,
    gitRef: process.env.GITHUB_REF ?? '',
    workflowRef: process.env.GITHUB_WORKFLOW_REF ?? '',
    label: 'Apple',
  });

  const values = Object.fromEntries(WANTED.map((n) => [n, (process.env[n] ?? '').trim()]));
  const law = secretSetLaw(values);

  console.log(`── Apple signing · app "${app.slug}" · lane requires signing: ${lane.required ? 'YES' : 'no'} ──`);
  for (const r of lane.reasons) console.log(`   required because ${r}`);
  if (!lane.required) console.log('   no release signal (not a tag push, not a declared submission workflow) — a BUILD PROOF is legal here');
  for (const b of lane.blind) console.log(`   ⬜ ${b}`);

  // ── partial and the missing-on-an-ARMED-release-lane endings ──────────────
  // `proofLane` is the NEGATION of the derived release signal, never a flag a
  // workflow can set — the same argument the `releaseLane()` box makes one level
  // up. It lets exactly one partial set through: a team id and no key material,
  // on a lane that already printed that it needs no signing. See `resolvePosture`.
  const early = resolvePosture({ law, required: releaseFatal, armed: gap.armed, proofLane: !lane.required });
  if (law.kind === 'partial' || (law.kind === 'none' && releaseFatal)) {
    if (early.fatal !== null) die(early.fatal.lines);
  }
  const identityOnly = law.kind === 'partial' && early.fatal === null;

  // ── the legal unsigned ending — LABELLED, which is the whole difference ───
  if (law.kind === 'none' || identityOnly) {
    // A release lane whose channels are NOT armed. Printed in full and not
    // fatal: no lane in this repository emits an .ipa or a .pkg, so failing
    // would block the release of five ready channels on an enrolment only the
    // owner can buy. Guarded by `lane.required`, so a branch push, a fork PR and
    // the weekly platform proof print exactly what they printed before.
    if (lane.required) {
      console.log('');
      for (const l of unarmedGapLines({
        armings: gap.unarmed,
        secretNames: law.missing,
        laneReasons: lane.reasons,
        ownerItem: `${OWNER_GAP} — the certificates, bundle id and profiles exist; THIS RUN was not given the secrets`,
        // ⏱ FLIPPED BACK TO OWNER-GATED 2026-09-09, and the flip is the honest
        // half of today's change rather than a regression. On 2026-09-08 this
        // was set `false` with a correct reason: the missing item was a
        // certificate, and an agent holding the ASC key could issue one. It did
        // — so that item is closed, and OWNER_GAP now names what is actually
        // left: App Store screenshots and the first submission. Neither is
        // agent-closable, and neither should be: creating an app record or
        // submitting to App Review is the owner's call, after he has tested the
        // product. Leaving this `false` would print "An agent CAN close this
        // one" over work no agent is permitted to do, which is a worse lie than
        // the one it replaced.
        ownerGated: true,
      })) {
        console.log(l);
      }
    }
    console.log('');
    console.log(`⬜ SIGNING POSTURE: ${UNSIGNED_PROOF.toUpperCase()}`);
    if (identityOnly) {
      // Say which names arrived and that they were IGNORED. A run that quietly
      // treated a supplied value as absent would be the same class of silence
      // this file exists to refuse — the difference between the two endings has
      // always been the label, not the artifact.
      console.log(`   ⬜ SUPPLIED AND DELIBERATELY UNUSED ON THIS LANE: ${early.ignoredIdentity.join(', ')}`);
      console.log('      No key material was supplied, so there is nothing to arrange and nothing was arranged.');
      console.log('      A team identifier alone cannot sign, and this lane already reported it needs no signing.');
      console.log('      🔴 ON A RELEASE LANE THIS SAME SET IS STILL FATAL. Nothing about the all-or-none law moved.');
    } else {
      console.log(`   🔴 NO APPLE SIGNING SECRETS ARE SET, AND THE REASON IS NOT A MISSING SECRET.`);
    }
    console.log(`   🔴 THE MISSING ITEM IS THE ${OWNER_GAP.toUpperCase()}.`);
    console.log('   The enrolment is ACTIVE and the signing infrastructure EXISTS as of 2026-09-09: a distribution');
    console.log('   certificate, a Mac installer certificate, a universal bundle id and two App Store profiles,');
    console.log('   all issued through the ASC API. THIS RUN was simply not handed the secrets that carry them,');
    console.log('   which is correct for a branch, a fork PR and the weekly proof - it says nothing about the account.');
    console.log('   🔴 AN UNSIGNED BUNDLE CANNOT BE UPLOADED TO APP STORE CONNECT. This artifact is a build');
    console.log('      proof: it proves the Apple modules compile, and nothing about a signing identity.');
    console.log('   This is the correct outcome for a branch, a fork PR and the weekly platform proof.');
    exportEnv({ [POSTURE_ENV]: UNSIGNED_PROOF }, GITHUB_ENV, EXPORT_STOPS);
    console.log('\napple-signing: OK (unsigned build proof, labelled)');
    process.exit(0);
  }

  // ═══ all four supplied ═════════════════════════════════════════════════════
  // Every value is validated BEFORE anything is written. The Android script
  // learned this the expensive way: its first live run wrote the keystore and
  // then refused the export, leaving a real key on disk from a run that failed.
  const teamId = values[ROLE_ENV.teamId];
  const teamProblem = teamIdProblem(teamId);
  if (teamProblem !== null) die([`FAIL ${teamProblem}`]);

  // 🔴 A PASSWORD THIS SCRIPT HAD TO TRIM IS REFUSED, NOT TRIMMED. Measured
  // 2026-09-09, and it cost two full CI runs to find. The .p12 was exported on
  // Windows with a passphrase generated by `openssl rand -base64 24 | tr -d
  // '\n='`; Windows openssl writes CRLF, `tr` removed only the LF, and the
  // passphrase the archive was encrypted with ended in a CARRIAGE RETURN. Every
  // local `openssl pkcs12 -in` verified fine, because it was handed the same
  // stray byte. The `.trim()` on the line above then removed it here — so
  // `security import` was given a passphrase one byte shorter than the one the
  // file was built with, and macOS answered:
  //
  //     SecKeychainItemImport: The user name or passphrase you entered is not correct.
  //
  // which is TRUE and says nothing about where the byte went. Trimming is right
  // for a value that arrives through $GITHUB_ENV or a here-doc; for the one
  // value that is compared byte-for-byte against a file somebody else created,
  // trimming converts "your secret has an invisible character in it" into "your
  // password is wrong". The difference between the raw and trimmed forms is
  // therefore a FAILURE with the diagnosis written out, and the value itself is
  // never printed — only its lengths.
  const rawPassword = process.env[ROLE_ENV.p12Password] ?? '';
  if (rawPassword !== values[ROLE_ENV.p12Password]) {
    die([
      `FAIL ${ROLE_ENV.p12Password} carries leading or trailing whitespace, and it is being REFUSED rather than trimmed.`,
      // 🔴 NOTHING DERIVED FROM THE PASSWORD REACHES THIS MESSAGE — not even its
      // length. The first version printed both lengths, and CodeQL flagged it as
      // `js/clear-text-logging` (high). A length is not the secret, but the flag
      // is right in spirit: the shortest path from "print a harmless projection"
      // to "print the value" is one careless edit, and a rule that has to
      // distinguish them is a rule that eventually gets it wrong. What is
      // printed instead is drawn from the fixed allowlist below, so the only
      // strings that can appear are ones written here.
      `     Found: ${whitespaceShape(rawPassword).join(', ')}.`,
      '     A .p12 is encrypted with the EXACT bytes it was given, so a stray CR or newline in this secret and',
      '     not in the archive (or the reverse) makes `security import` report "the passphrase you entered is',
      '     not correct" — which is true, and points nowhere near the cause.',
      "     The usual source is a password generated on Windows: `openssl rand` writes CRLF there, so a",
      "     `tr -d '\\n'` leaves the CR behind. Re-create the secret with no surrounding whitespace and",
      '     re-export the .p12 with the same bytes. Neither value is printed above.',
    ]);
  }

  // A PKCS#12 is DER: a SEQUENCE, first byte 0x30. Structure, not a size floor —
  // an invented minimum length would fire on a correct small file and pass a
  // padded stub. The usual real-world failure is base64 of an HTML error page.
  const p12 = decodeSecret(values[ROLE_ENV.p12], ROLE_ENV.p12, {
    magic: DER,
    magicLines: (d) => [
      `FAIL ${ROLE_ENV.p12} decodes to ${d.length} byte(s) that are not a PKCS#12.`,
      `     Expected DER (first byte 0x30); found ${d.found}.`,
      '     No part of the value is printed. The usual cause is base64 of the wrong file, or of an error',
      '     page a download produced. Re-export the identity from Keychain Access as a .p12 and re-encode it.',
    ],
  });

  const profileBytes = decodeSecret(values[ROLE_ENV.profiles], ROLE_ENV.profiles);
  const { kind: blobKind, members } = profileMembers(profileBytes);
  if (members === null) {
    die([
      `FAIL ${ROLE_ENV.profiles} decodes to ${profileBytes.length} byte(s) this script cannot read as profiles.`,
      `     Detected shape: ${blobKind}. Expected either ONE .mobileprovision/.provisionprofile (DER, first`,
      '     byte 0x30) or a ZIP containing them. No part of the value is printed.',
    ]);
  }
  const unsupported = members.filter((m) => m.bytes === null);
  if (unsupported.length) {
    die([
      `FAIL ${ROLE_ENV.profiles} is a zip whose member(s) use a compression method this script cannot read:`,
      ...unsupported.map((m) => `       ${m.name} (method ${m.unsupportedMethod})`),
      '     Skipping a member would silently drop a provisioning profile, and the build that follows fails at',
      '     codesign with a message about entitlements. Re-create the archive with stored or deflated entries.',
    ]);
  }

  const parsed = [];
  for (const m of members) {
    const p = parseMobileProvision(m.bytes);
    if (p === null) {
      die([
        `FAIL ${ROLE_ENV.profiles} carries a member that is not a provisioning profile: ${m.name}`,
        '     A provisioning profile is a CMS envelope with an XML plist inside; this member has no plist.',
        '     No part of the value is printed.',
      ]);
    }
    parsed.push({ ...p, member: m.name });
  }
  if (parsed.length === 0) {
    coverageLost([
      `${ROLE_ENV.profiles} yielded ZERO profiles after decoding.`,
      'Every cross-check below would have ranged over an empty list and printed ok, which is this',
      "repository's single most repeated failure.",
    ]);
  }

  // ── O-SECOND-APP-SIGNS-AS-THE-FIRST: only THIS app's profiles go further ──
  // APPLE_PROVISIONING_PROFILES_BASE64 is one secret for the whole account, so
  // from the second app on it carries every app's profiles. The exported profile
  // names used to be an Object.fromEntries over ALL of them: the last member of
  // the zip won, and `--app a` built with app b's profile until App Store
  // Connect refused the upload. Everything below — the team and expiry checks,
  // the install, ExportOptions.plist and the exported names — reads `kept`. The
  // bundle id is read through apple-provisioning.mjs, where it is decided.
  const provisioningRaw = read(PROVISIONING_REGISTER);
  if (provisioningRaw === null) {
    coverageLost([
      `${PROVISIONING_REGISTER} does not exist, so there is no bundle id to keep ${ROLE_ENV.profiles}'s profiles to.`,
      'Installing every profile the secret carries is how one app gets built with another app\'s profile.',
    ]);
  }
  let provisioning;
  try {
    provisioning = JSON.parse(provisioningRaw);
  } catch (e) {
    coverageLost([`${PROVISIONING_REGISTER} is not valid JSON — ${e.message}`]);
  }
  let bundleId;
  try {
    bundleId = bundleIdOf(provisioning, app.slug);
  } catch (e) {
    die([`FAIL --app "${app.slug}": ${e.message}.`, '     Nothing was installed and no key material was written.']);
  }
  const kept = parsed.filter((p) => p.bundleId === bundleId);
  const dropped = parsed.filter((p) => !kept.includes(p));
  const keptIos = kept.filter((p) => !p.member.endsWith('.provisionprofile'));
  const keptMacos = kept.filter((p) => p.member.endsWith('.provisionprofile'));
  const profileListing = [
    ...kept.map((p) => `        kept                 "${p.name}" → ${p.bundleId} · expires ${p.expires ?? 'unstated'}`),
    ...dropped.map((p) => `        dropped (other app)  "${p.name}" → ${p.bundleId ?? '(no application-identifier)'}`),
  ];
  if (keptIos.length !== 1 || keptMacos.length !== 1) {
    die([
      `FAIL --app ${app.slug} signs as ${bundleId}, and ${ROLE_ENV.profiles} carries ${keptIos.length} iOS profile(s)`,
      `     (.mobileprovision) and ${keptMacos.length} macOS profile(s) (.provisionprofile) for it. Exactly one of each is`,
      '     required: none leaves the build nothing to sign with, and two would leave the exported name to',
      '     whichever member came last in the zip. Profiles for other apps may stay in the secret.',
      ...profileListing,
    ]);
  }

  // The team cross-check. A profile from a DIFFERENT team than the one
  // xcodebuild is told to use produces a build that codesigns and is refused at
  // upload — the failure surfaces at the store, which is the one place this
  // repository has decided failures must not surface.
  const wrongTeam = kept.filter((p) => !p.teamIds.includes(teamId));
  if (wrongTeam.length) {
    die([
      `FAIL ${ROLE_ENV.profiles} carries profile(s) belonging to a different team than ${ROLE_ENV.teamId}.`,
      ...wrongTeam.map((p) => `       ${p.member} — "${p.name}" belongs to ${p.teamIds.join(', ') || '(no team)'}`),
      '     A profile binds the certificate to a bundle id and its entitlements FOR ONE TEAM. Signing with a',
      '     mismatched pair produces a valid signature that App Store Connect refuses, after the upload.',
      `     The team identifier itself is not printed above beyond what the profiles declare.`,
    ]);
  }

  const now = Date.now();
  const expired = kept.filter((p) => p.expires !== null && Date.parse(p.expires) < now);
  if (expired.length) {
    die([
      `FAIL ${ROLE_ENV.profiles} carries EXPIRED provisioning profile(s).`,
      ...expired.map((p) => `       ${p.member} — "${p.name}" expired ${p.expires}`),
      '     An expired profile fails at codesign, several minutes into a build, with a message about',
      '     entitlements rather than about a date. Re-download it from the Apple Developer portal.',
    ]);
  }

  // ── the fourth ending: this platform cannot arrange anything ──────────────
  const decided = resolvePosture({ law, required: lane.required });
  if (decided.fatal !== null) die(decided.fatal.lines);

  // ── nothing was written until here ────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const p12Path = join(OUT_DIR, `${app.slug}-distribution.p12`);
  const keychain = join(OUT_DIR, `${app.slug}-signing.keychain-db`);
  const profileDir = join(OUT_DIR, `${app.slug}-profiles`);
  const exportOptionsPath = join(OUT_DIR, `${app.slug}-ExportOptions.plist`);
  if (!isAbsolute(p12Path) || !isAbsolute(keychain)) {
    coverageLost([
      `the resolved key-material paths are not absolute (${p12Path}).`,
      '`security` resolves a relative keychain against the working directory, which for a CI job is the',
      'repository — the one place this file exists to keep key material out of.',
    ]);
  }
  // 0600 on a POSIX runner. Written outside the workspace either way — the
  // seam's `placeKey` refuses a relative path and chmods after the write.
  placeOrStop(p12Path, p12);
  mkdirSync(profileDir, { recursive: true });
  for (const p of kept) {
    const member = members.find((m) => m.name === p.member);
    placeOrStop(join(profileDir, p.member.split('/').pop()), member.bytes);
  }

  // ── and INSTALLED where Xcode actually looks ──────────────────────────────
  // 🔴 WRITING THEM TO $RUNNER_TEMP IS NOT INSTALLING THEM, AND THE BUILD SAYS
  // SO SEVERAL MINUTES LATER. Measured 2026-09-09, with manual signing correctly
  // in force and the identity in the keychain:
  //
  //     error: No profile for team '…' matching 'Nikatru Subly macOS App Store'
  //     (the profile is named 'Nikatru Subscription Tracker macOS App Store' since
  //      the 2026-09-09 re-mint; the quote is the message as it was measured)
  //     found: Xcode couldn't find any provisioning profiles matching …
  //
  // `PROVISIONING_PROFILE_SPECIFIER` names a profile; it does not point at a
  // file. Xcode resolves the name by SCANNING its own profile directory, so a
  // profile that exists only in a temp directory this script invented is, to
  // xcodebuild, not present at all. `APPLE_PROVISIONING_PROFILES_DIR` is still
  // exported — `-exportArchive` and any later step may want the originals — but
  // the copy below is the one the build reads.
  //
  // Both directories are written because the location MOVED: Xcode 16 and newer
  // read `~/Library/Developer/Xcode/UserData/Provisioning Profiles`, and older
  // toolchains read `~/Library/MobileDevice/Provisioning Profiles`. Writing both
  // costs two file copies and removes a silent dependency on the runner image's
  // Xcode version — the kind of dependency that turns into a mystery failure the
  // week the image is bumped.
  //
  // The filename is the profile's own UUID, which is the convention Xcode itself
  // uses. Name collisions between two profiles are therefore impossible unless
  // they ARE the same profile.
  const installedTo = [];
  for (const dir of xcodeProfileDirs()) {
    mkdirSync(dir, { recursive: true });
    for (const p of kept) {
      const member = members.find((m) => m.name === p.member);
      const ext = p.member.endsWith('.provisionprofile') ? 'provisionprofile' : 'mobileprovision';
      if (p.uuid === null) {
        coverageLost([
          `the profile "${p.name ?? p.member}" carries no UUID, so it cannot be installed under the name Xcode looks for.`,
          'Installing it under any other name leaves the build resolving PROVISIONING_PROFILE_SPECIFIER against a',
          'directory that does not contain it, which fails minutes later with a message about entitlements.',
        ]);
      }
      placeOrStop(join(dir, `${p.uuid}.${ext}`), member.bytes);
    }
    installedTo.push(dir);
  }
  // ONE PLATFORM'S PROFILES, and the file extension is what says which. A
  // `.provisionprofile` is macOS and a `.mobileprovision` is iOS; this plist is
  // consumed by the iOS `flutter build ipa --export-options-plist` and by
  // nothing else, because the macOS side never runs `-exportArchive` — `flutter
  // build macos` signs in place and `productbuild` wraps the result.
  const iosProfiles = kept.filter((p) => !p.member.endsWith('.provisionprofile'));
  if (iosProfiles.length === 0) {
    coverageLost([
      `${ROLE_ENV.profiles} carries no iOS profile (.mobileprovision), so ExportOptions.plist would map NOTHING.`,
      'An empty `provisioningProfiles` dict does not fail the export — it makes xcodebuild fall back to',
      'searching, which is the automatic signing this lane refuses. The .ipa would either not build or',
      'build against a profile nobody chose.',
    ]);
  }
  writeFileSync(exportOptionsPath, exportOptionsPlist({ teamId, method: METHOD, profiles: iosProfiles }));

  // ── the keychain ──────────────────────────────────────────────────────────
  const keychainPassword = randomBytes(24).toString('base64url');
  const plan = keychainPlan({
    keychain,
    keychainPassword,
    p12Path,
    p12Password: values[ROLE_ENV.p12Password],
    existingKeychains: existingUserKeychains(),
  });
  // The installer identity shares APPLE_DIST_CERT_PASSWORD: it is one credential
  // in two files, and the register declares no second password name. Validated
  // to the same DER floor as the distribution .p12 before anything is written.
  const installerRaw = (process.env[ROLE_ENV.installerP12] ?? '').trim();
  const installerP12Path = join(OUT_DIR, `${app.slug}-installer.p12`);
  if (installerRaw !== '') {
    const ip12 = decodeSecret(installerRaw, ROLE_ENV.installerP12, {
      magic: DER,
      magicLines: (d) => [
        `FAIL ${ROLE_ENV.installerP12} decodes to ${d.length} byte(s) that are not a PKCS#12.`,
        `     Expected DER (first byte 0x30); found ${d.found}.`,
        '     No part of the value is printed. This is the Mac Installer Distribution identity that signs',
        '     the .pkg; it is a DIFFERENT certificate from the one that signs the .app inside it.',
      ],
    });
    placeOrStop(installerP12Path, ip12);
    plan.splice(4, 0, ...installerImportPlan({
      keychain,
      p12Path: installerP12Path,
      p12Password: values[ROLE_ENV.p12Password],
    }));
  }
  // 🔴 THE PLAN THAT GETS LOGGED NEVER CONTAINS A SECRET IN THE FIRST PLACE.
  //
  // This used to build the full argv — passwords included — and redact it on the
  // way to the log with `redactArgv`. That was correct and it was still the
  // wrong shape, for two reasons. The mechanical one: CodeQL flagged it
  // `js/clear-text-logging` (high), because a value read from
  // APPLE_DIST_CERT_PASSWORD reached a `console.log`, and no static analysis can
  // see that a function in between removed it. The real one: redaction is a
  // subtraction applied AFTER the secret is already in the string, so it is one
  // missed call site away from printing a passphrase into a public CI log.
  //
  // Now the secret is never in the logged array. `sealArgv` swaps each secret
  // for an opaque placeholder, and the real values are substituted back ONLY
  // into the argument handed to spawnSync. The redaction cannot be forgotten at
  // a call site because there is nothing left to redact: the thing being logged
  // is the sealed form, and the unsealed form exists solely as an argument to
  // the process being run.
  const sealed = new Map([
    ['<keychain-password>', keychainPassword],
    ['<p12-password>', values[ROLE_ENV.p12Password]],
  ]);
  const unseal = (argv) => argv.map((a) => (sealed.has(a) ? sealed.get(a) : a));
  const sealArgv = (argv) => {
    const bySecret = new Map([...sealed].map(([k, v]) => [v, k]));
    return argv.map((a) => bySecret.get(a) ?? a);
  };

  console.log('');
  for (const step of plan) {
    const shown = sealArgv(step.argv);
    console.log(`   $ ${shown.join(' ')}`);
    const real = unseal(shown);
    // ⏱ 2026-09-12 — BOUNDED, and the LABEL is the sealed argv, never the real
    // one. `security import` and `security set-key-partition-list` can block on
    // a keychain prompt that no runner will ever answer; unbounded, that is the
    // job cancelled at its own timeout-minutes with the log stopping mid-guard.
    // The module prints `label` and nothing else from the command, which is what
    // keeps the redaction this whole block exists for intact.
    const r = boundedSpawn(real[0], real.slice(1), {
      timeoutMs: timeoutFromEnv('SECURITY_CMD_TIMEOUT_MS', 120_000),
      label: `security ${step.argv[1]}`,
    });
    if (r.timedOut) {
      die([
        `FAIL \`security ${step.argv[1]}\` did not return — ${step.why}.`,
        `     ${r.detail}`,
        '     A keychain command that blocks is waiting for a prompt no runner will answer. The keychain is in',
        '     $RUNNER_TEMP and the runner destroys it with the job; nothing needs unpicking by hand.',
      ]);
    }
    if (r.error || r.status !== 0) {
      // ⚠️ STDERR STILL GOES THROUGH `redactArgv`, NOT THROUGH `sealArgv`, AND
      // THE DIFFERENCE MATTERS. Sealing swaps WHOLE arguments and is exact,
      // which is right for an argv we built. Anything `security` writes is a
      // free-form sentence, so a secret could appear as a SUBSTRING of a longer
      // line, and only substring redaction catches that. This is the one place
      // the values are still needed, and it is the correct trade: a weaker
      // redaction here would be a real leak, where the static-analysis alert it
      // avoids is about a call that provably removes them.
      const stderrLines = String(r.stderr ?? '').trim().split('\n');
      die([
        `FAIL \`security ${step.argv[1]}\` failed — ${step.why}.`,
        `     ${redactArgv(stderrLines, [...sealed.values(), values[ROLE_ENV.p12], values[ROLE_ENV.profiles], installerRaw]).join(' ')}`,
        '     The keychain is in $RUNNER_TEMP and the runner destroys it with the job; nothing needs',
        '     unpicking by hand. No password appears in this output.',
      ]);
    }
  }

  // ── read the identities back out of the keychain ──────────────────────────
  // 🔴 THIS IS A MEASUREMENT, NOT A RESTATEMENT OF THE PLAN ABOVE. Every step
  // exited 0, which says the commands ran, not that an identity exists — a .p12
  // holding a certificate whose private key did not travel with it imports
  // cleanly and yields NO identity. `find-identity` is the first thing in this
  // script that can tell those two apart, and a build that gets past here with
  // no application identity fails ten minutes later inside codesign.
  // ⏱ 2026-09-12 — BOUNDED, and a time-out may NOT be read as "no identity".
  // `pickIdentities('')` answers zero identities, which is the same shape as a
  // .p12 that carried no private key — the exact distinction this measurement
  // exists to make. So the bound is reported as itself, before the parse.
  const found = boundedSpawn('security', ['find-identity', '-v', keychain], {
    timeoutMs: timeoutFromEnv('SECURITY_CMD_TIMEOUT_MS', 120_000),
    label: 'security find-identity -v',
  });
  if (found.timedOut) {
    die([
      'FAIL `security find-identity -v` did not return, so the keychain was never read back.',
      `     ${found.detail}`,
      '     Empty output from this command is indistinguishable from a keychain holding no identity, which is',
      '     the one thing this step exists to tell apart. It is reported as unread rather than as empty.',
    ]);
  }
  const { names, application, installer } = pickIdentities(found.stdout);
  if (application === null) {
    die([
      'FAIL the keychain imported without error and contains NO application-signing identity.',
      `     \`security find-identity -v\` listed ${names.length} identit(ies): ${names.join(', ') || '(none)'}`,
      `     ${ROLE_ENV.p12} must be a PKCS#12 carrying BOTH the certificate and its private key. Exporting`,
      '     only the certificate produces exactly this: a clean import and nothing to sign with.',
    ]);
  }
  if (installerRaw !== '' && installer === null) {
    die([
      `FAIL ${ROLE_ENV.installerP12} was supplied and imported, and no installer identity came back.`,
      `     \`security find-identity -v\` listed: ${names.join(', ') || '(none)'}`,
      '     A Mac App Store .pkg needs "3rd Party Mac Developer Installer: …". Without it `productbuild`',
      '     would either refuse or — worse — emit an UNSIGNED package that App Store Connect rejects.',
    ]);
  }

  exportEnv(
    {
      [POSTURE_ENV]: RELEASE_SIGNED,
      [ROLE_ENV.teamId]: teamId,
      APPLE_KEYCHAIN_PATH: keychain,
      APPLE_EXPORT_OPTIONS_PLIST: exportOptionsPath,
      APPLE_PROVISIONING_PROFILES_DIR: profileDir,
      APPLE_DIST_IDENTITY: application,
      ...(installer === null ? {} : { APPLE_INSTALLER_IDENTITY: installer }),
      ...Object.fromEntries(
        kept
          .filter((p) => p.name !== null)
          .map((p) => [p.member.endsWith('.provisionprofile') ? 'APPLE_MACOS_PROFILE_NAME' : 'APPLE_IOS_PROFILE_NAME', p.name]),
      ),
    },
    GITHUB_ENV,
    EXPORT_STOPS,
  );

  console.log('');
  console.log(`ok   distribution identity imported into a per-run keychain — ${p12.length} byte(s), outside the workspace`);
  console.log(`ok   ${kept.length} of ${parsed.length} provisioning profile(s) kept for ${bundleId} (--app ${app.slug}), team-checked and in date;`);
  console.log(`     ${dropped.length} dropped (other app) — not checked, not installed, not exported:`);
  for (const line of profileListing) console.log(line);
  console.log(`ok   installed into ${installedTo.length} Xcode profile director(ies), named by UUID — this is what`);
  console.log('     PROVISIONING_PROFILE_SPECIFIER resolves against; a temp directory is not searched:');
  for (const d of installedTo) console.log(`        ${d}`);
  console.log(`ok   ExportOptions.plist written (method "${METHOD}", signingStyle manual)`);
  console.log(`ok   application identity in the keychain: "${application}"`);
  console.log(`ok   installer identity in the keychain:   ${installer === null ? '(none supplied — no .pkg can be signed in this job)' : `"${installer}"`}`);
  console.log('');
  console.log('   ── the signed-export intents, with the paths this step produced ──');
  for (const step of signedExportPlan({ appSlug: app.slug, exportOptionsPath, keychain, teamId, outDir: OUT_DIR })) {
    console.log(`   [${step.channel}] ${step.what}`);
    console.log(`      $ (cd ${step.cwd} && ${step.argv.join(' ')})`);
    if (step.gap) console.log(`      🔴 ${step.gap}`);
  }
  console.log('');
  console.log(`⬜ SIGNING POSTURE: ${RELEASE_SIGNED.toUpperCase()}`);
  console.log('   This says what was ARRANGED, not what xcodebuild did.');
  console.log('   tooling/ci/assert-artifact-signed-apple.mjs reads the signature back out of the built bundle');
  console.log('   with `codesign -dvv` and fails if the real signer disagrees with this line.');
  console.log('\napple-signing: OK');
}

/** DER opens with a SEQUENCE: first byte 0x30. Both .p12 files are DER. */
const DER = [[0x30]];

/** The seam's `decodeKey`, with this file's two stops on its answer. A value
 *  that passed the presence check and is whitespace only is COVERAGE LOST (the
 *  check above it did not check enough); one that does not round-trip, or is
 *  not the format asked for, is a FAIL. `magicLines` is the Apple wording for
 *  the second — the reader needs the key KIND, which the seam does not know. */
function decodeSecret(raw, name, { magic = null, magicLines = null } = {}) {
  const d = decodeKey(raw, { name, magic });
  if (d.problem === 'empty') coverageLost(d.lines);
  if (d.problem === 'magic' && magicLines !== null) die(magicLines(d));
  if (d.problem !== null) die(d.lines);
  return d.bytes;
}

/** The seam's `placeKey`: a refusal (a relative path, zero bytes) wrote nothing
 *  and is COVERAGE LOST here, the same stop the absolute-path check above uses. */
function placeOrStop(path, bytes) {
  const refused = placeKey(path, bytes);
  if (refused !== null) coverageLost(refused);
}

/** What the seam's `exportEnv` does with a refusal, and what it says when there
 *  is no $GITHUB_ENV: not a failure (this script is runnable by hand), and not a
 *  silent pass — assert-artifact-signed-apple.mjs requires the posture and
 *  refuses to run without it, so a build in which this export did not happen
 *  fails there rather than proceeding unlabelled. */
const EXPORT_STOPS = {
  fail: die,
  unexported: ['   assert-artifact-signed-apple.mjs refuses to run without APPLE_SIGNING_POSTURE.'],
};

/** The current user search list, so adding ours does not REMOVE the system one.
 *  `security list-keychains -s` REPLACES the list; the shorter form that passes
 *  only our keychain works right up until something else in the job needs the
 *  login keychain, and then fails somewhere unrelated. */
function existingUserKeychains() {
  // ⏱ 2026-09-12 — BOUNDED. This one already degrades to `[]` on any failure by
  // design (the caller then adds only our keychain), so a time-out joins the
  // failures it already tolerates rather than becoming a new refusal — but it
  // must not be able to hang the job while doing so.
  const r = boundedSpawn('security', ['list-keychains', '-d', 'user'], {
    timeoutMs: timeoutFromEnv('SECURITY_CMD_TIMEOUT_MS', 120_000),
    label: 'security list-keychains -d user',
  });
  if (!r.ok) return [];
  return [...r.stdout.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
