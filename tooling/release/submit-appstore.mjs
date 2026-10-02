#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-appstore.mjs — the repeatable submission path for BOTH Apple store
// channels: ios-appstore (.ipa) and macos-appstore (.pkg).
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// D-10's replacement acceptance has three re-checkable limbs. This file is
// limb (i) — "a submission script exists AND resolves to a step in a workflow,
// parsed not grepped". Limb (ii) is Private/runbooks/store-submission-apple.md.
// Limb (iii) — a submission record in the [10]D-9 ledger — needs a real
// submission and stays UNSATISFIED; it is the only one of the three that can
// prove the path was walked rather than merely written, and nothing here
// pretends otherwise.
//
// ── WHY ONE SCRIPT FOR TWO CHANNELS ──────────────────────────────────────────
// The two rows are separate submissions with separate App Store Connect records,
// separate metadata trees and independent review outcomes — which is why the
// register carries two rows and this repo carries two metadata trees. But they
// authenticate with the SAME Apple Developer account (ACTIVE since 2026-08-31) and the
// SAME App Store Connect API key. Two scripts would be two copies of one
// authentication path, and the second one would be the first to drift
// ([pipeline F-2]). So: one script, `--channel`, and every path it touches comes
// from the register row it was pointed at.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the artifact and the bundle
//              identifier the Xcode project actually builds, and exits 0 WITHOUT
//              one byte leaving the machine. This is the mode CI runs.
// `--submit`   runs the Small Business Program gate
//              (assert-small-business-program.mjs --real-submission) and prints
//              its verdict, exiting there if it refuses; only then REFUSES,
//              loudly, with `UNVERIFIED: <what>`. The App Store Connect
//              API's endpoints, payload shapes and JWT parameters were not
//              fetched from a primary source in this increment, and this repo's
//              standing rule is that an unsourced fact is marked UNVERIFIED
//              rather than guessed — an invented endpoint does not fail here, on
//              a laptop, in a dry run. It fails against a LIVE App Store Connect
//              account, mid-upload, leaving a half-created version a human has to
//              unpick in a console.
//
// ── THE TOOL LANDSCAPE, SO THE NEXT READER DOES NOT RE-DERIVE IT ─────────────
// `xcrun altool` is retired for this path — the App Store Connect API is the
// supported route, authenticated with a `.p8` private key (issuer id + key id +
// key), not with an Apple ID password.
//
// 🔴 `xcrun notarytool` IS NOT PART OF EITHER CHANNEL HERE. Notarization belongs
// to **Developer ID direct distribution** — a `.dmg`/`.pkg` hosted by us — which
// this register does not carry as a row at all. A **Mac App Store** submission is
// signed and reviewed, NOT notarized. Conflating the two is the most common way
// this path goes wrong, so it is written in three places: here, the
// macos-appstore tree README, and the runbook.
//
// 🔴 NOTHING HERE IS LIVE AND NOTHING HERE CAN BE. Both rows are `served: false`.
// CORRECTED 2026-09-08: this paragraph used to open "There is no Apple Developer
// account", frozen at a reading from 2026-08-03, twenty-eight days before the
// enrolment. There IS one, it is ACTIVE, and its App Store Connect API key exists
// and works — it is what answered HTTP 200. What does not exist is a distribution
// certificate or a provisioning profile (both empty sets on 2026-09-08), and
// this script wires NONE of them. A dry run over an artifact that cannot yet be
// signed is still worth having: it is what makes enrolment day minutes rather
// than archaeology, which is the whole of D-10.
// ⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the certificate and the profile
// exist since 2026-09-09, and build-platforms.yml signs with them. submit-appstore.yml
// builds unsigned by choice until the signing seam lands in that lane; `--submit` refuses.
//
// Usage:
//   node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore
//   node tooling/release/submit-appstore.mjs --dry-run --channel macos-appstore --app subscriptiontracker
//   node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore --allow-missing-artifact
//   node tooling/release/submit-appstore.mjs --submit  --channel ios-appstore     (refuses)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable. 1 = it is not, or --submit.
//       2 = COVERAGE LOST: an input it must read is absent or unreadable (submit-common.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readAppleBundleId } from '../ci/read-identity.mjs';
import { appleArtifactPath } from '../ci/apple-signing.mjs';
import { submitCli, storeSubmitter, invokedAsScript } from './submit-common.mjs';
import { bundleIdOf, REGISTER as APPLE_REGISTER } from '../ci/apple-provisioning.mjs';
import { storeRecordOf, missingIdsOf } from '../store/store-record.mjs';

const CHANNELS = ['ios-appstore', 'macos-appstore'];
const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

// ── the ChannelSubmitter (submit-common.mjs · tooling/ports/channels.json) ────
/** Both Apple channels behind the one store contract — one submitter per row,
 *  as the register carries one row per channel. `--submit` REFUSES by design
 *  (UNVERIFIED below), so the plan is the console path the runbook walks, every
 *  write a human's in App Store Connect; `upload` runs that refusing `--submit`. */
const appleSubmitter = (channel) =>
  storeSubmitter({
    channel,
    script: 'tooling/release/submit-appstore.mjs',
    steps: (artifact) => [
      { does: `run the Small Business Program gate for ${channel} before any submission`, surface: 'local', call: `node tooling/ci/assert-small-business-program.mjs --for-submission=${channel} --real-submission`, writes: false },
      { does: `upload ${artifact?.path ?? 'the signed build'} to App Store Connect (the API path is UNVERIFIED, so a human uploads)`, surface: 'console', call: 'App Store Connect — Private/runbooks/store-submission-apple.md', writes: true },
      { does: 'attach the build to the version and submit it for review', surface: 'console', call: 'App Store Connect — Private/runbooks/store-submission-apple.md', writes: true },
    ],
    uploadArgv: (artifact) => ['--submit', '--channel', channel, '--app', artifact.app],
  });
export const iosAppstoreSubmitter = appleSubmitter(CHANNELS[0]);
export const macosAppstoreSubmitter = appleSubmitter(CHANNELS[1]);

// ── the CLI, which runs only when this file is the entry point ────────────────
// ⏱ 2026-10-01 (port-channels): the export above made this file a module that
// tooling/release/test/submitters.contract.test.mjs imports, and a script whose
// body runs on import cannot be imported — it would read the test's argv and
// exit. So the body is `cli()`, called below only when node was pointed at this
// file. The body is the CLI exactly as it was, and it is DELIBERATELY LEFT AT
// COLUMN 0: re-indenting it would rewrite every line other lanes patch here, and
// every patch to it would stop applying. Its behaviour, flags and exit codes are
// unchanged; the dry runs in ci.yml `app-dryrun` walk it as before.
if (invokedAsScript(import.meta.url)) await cli();

async function cli() {
// ── arguments, and the two stops (submit-common.mjs: COVERAGE LOST exits 2) ──
const { flag, opt, root: ROOT, ok, abs, read, coverageLost, die, appOf } = submitCli('submit-appstore');

const DRY_RUN = flag('dry-run');
const SUBMIT = flag('submit');
const ALLOW_MISSING_ARTIFACT = flag('allow-missing-artifact');

const problems = [];
const prints = [];

if (DRY_RUN === SUBMIT) {
  die([
    'FAIL exactly one of --dry-run and --submit is required.',
    '     Defaulting either way is how a dry run becomes a submission (or a submission',
    '     silently becomes a no-op). The mode has to be said out loud.',
  ]);
}

const CHANNEL_ID = opt('channel');
if (!CHANNELS.includes(CHANNEL_ID)) {
  die([
    `FAIL --channel must be one of: ${CHANNELS.join(', ')}${CHANNEL_ID ? ` (got ${JSON.stringify(CHANNEL_ID)})` : ' (none given)'}.`,
    '     iOS and macOS are SEPARATE App Store Connect records with separate metadata trees and',
    '     independent review outcomes. Defaulting to one of them would submit the wrong listing',
    '     to the right account, which reviews cleanly and is still wrong.',
  ]);
}

// ── --submit refuses, FIRST, before anything else runs ───────────────────────
// 🔴 A DELIBERATE STOP, NOT AN UNFINISHED FUNCTION, AND IT IS AT THE TOP ON
// PURPOSE: a refusal that arrives after half the work has run reads like a late
// failure rather than a design decision, and there must be no path on which
// --submit gets partway.
//
// Everything this script validates is verifiable from this repository.
// Everything a submission needs beyond that is a claim about a remote API, and
// this increment fetched no primary source for any of it. The standing rule —
// "NEVER invent a limit; an invented limit fires on correct input" — applies at
// least as hard to an endpoint.
//
// One further fact makes stopping the correct engineering answer rather than a
// cop-out: the lane that runs this script builds unsigned by choice until the
// signing seam lands in it, so there is no signed artifact a submission could
// carry — even a perfectly correct implementation could not be RUN, let alone
// tested, and CLAUDE.md forbids shipping a seam whose open path has never been
// proven. (The account is ACTIVE since 2026-08-31, OWNER_QUEUE A-4.)
const UNVERIFIED = [
  'the App Store Connect API base URL and version segment',
  'the endpoint and payload that reserve an app version, and how a localisation is attached to it',
  'the endpoint that creates a build upload / reserves an asset, and the upload protocol it expects',
  'the field names of the listing payload (name, subtitle, keywords, description, promotional text) and the locale envelope they sit in',
  'the endpoint and payload that SUBMIT a version for review, and how review state is polled',
  'the exact JWT claim set, algorithm and expiry the API accepts for a .p8 key (issuer id, key id, audience)',
  'whether the App Store Connect API, `xcrun altool` or Transporter is the supported UPLOAD path today for each of .ipa and .pkg, and which one the Xcode 26 floor requires',
];
// 🔴 THE ONE CHECK THAT RUNS BEFORE THE REFUSAL: the Small Business Program gate
// (AB-M5-02). It reads two registers and sends nothing, and it guards the
// SUBMISSION rather than the bytes: a submission made from a laptop, or through
// the App Store Connect API once the calls below are sourced, sells at the
// standard commission unless the enrolment is recorded. CI publish jobs carry it
// through submit-preconditions.mjs; this path had nothing. It stays here, in
// front, when the refusal below is replaced by real calls. Resolved from THIS
// FILE, like the D-6 preflight below, so `--repo-root` points only its reads.
const SBP_GATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-small-business-program.mjs');
const sbpCommand = `node tooling/ci/assert-small-business-program.mjs --for-submission=${CHANNEL_ID} --real-submission`;
const SBP_GATE_TIMEOUT_MS = 120000;
// 🔴 A GATE, NOT A REPORT: a non-zero status exits HERE, in its own block, before
// the refusal below. Whoever replaces that refusal with real App Store Connect
// calls replaces a different block, and this one still stops a submission the
// gate refused (#1088 review, minor 1). A gate that did not answer (timeout,
// signal) is a refusal too: its status is null, never 0.
if (SUBMIT) {
  const g = spawnSync(process.execPath, [SBP_GATE, `--for-submission=${CHANNEL_ID}`, '--real-submission', ROOT], {
    encoding: 'utf8',
    timeout: SBP_GATE_TIMEOUT_MS,
  });
  console.error('');
  console.error(
    g.status === 0
      ? `ok   the Small Business Program gate passed (${sbpCommand}).`
      : `FAIL the Small Business Program gate REFUSED this submission (${sbpCommand} exited ${g.status}${g.error ? `, ${g.error.code ?? g.error.message}` : ''}):`,
  );
  for (const l of `${g.stdout ?? ''}${g.stderr ?? ''}`.trimEnd().split('\n')) console.error(`     ${l}`);
  if (g.status !== 0) {
    console.error('\nsubmit-appstore: FAILED — nothing was submitted.');
    // The gate's COVERAGE LOST (2) is not folded into a refusal's 1: it could not read the enrolment at all.
    process.exit(g.status === 2 ? 2 : 1);
  }
}

if (SUBMIT) {
  console.error('');
  console.error('FAIL --submit is NOT IMPLEMENTED, and refusing is the implementation.');
  console.error('');
  for (const u of UNVERIFIED) console.error(`     UNVERIFIED: ${u}`);
  console.error('');
  console.error('     Each line above is a fact about a remote API that was NOT fetched from a primary');
  console.error('     source. Guessing one does not fail here — it fails against a live App Store Connect');
  console.error('     account, mid-upload. Source them (URL + date, the way the D-5 limits table does),');
  console.error('     then write the calls. Until then the console path in the runbook is the submission');
  console.error('     path:  Private/runbooks/store-submission-apple.md');
  console.error(`     and that console submission is gated too: before it, run  ${sbpCommand}`);
  console.error('     and submit only if it exits 0.');
  console.error('');
  console.error('     Nothing else was validated: this refusal is BEFORE the checks on purpose, so there is no');
  console.error('     path on which a submission gets halfway.');
  console.error('\nsubmit-appstore: FAILED');
  process.exit(1);
}

// ── the register is the single declaration everything below reads ────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row, the bundle identifier and the metadata contract all live there. With it gone',
    'every validation below would range over undefined and pass by having nothing to check.',
  ]);
}
let register;
try {
  register = JSON.parse(registerRaw);
} catch (e) {
  coverageLost([`${REGISTER} is not valid JSON — ${e.message}`]);
}

const channel = (register.channels ?? []).find((c) => c.id === CHANNEL_ID);
if (!channel) {
  coverageLost([
    `${REGISTER} declares no "${CHANNEL_ID}" channel.`,
    'This script exists to submit to exactly that row. Without it there is no artifact format, no',
    'metadata directory template and no bundle identifier to validate.',
  ]);
}
if (channel.submittable !== true) {
  die([`FAIL channel "${CHANNEL_ID}" is not marked \`submittable\` in ${REGISTER}.`, '     A store you cannot submit to has no submission path to run.']);
}

const contract = register.storeMetadataContract;
const requiredFiles = Array.isArray(contract?.requiredFiles) ? contract.requiredFiles : [];
if (requiredFiles.length === 0) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract.requiredFiles\`.`,
    'The metadata validation below iterates that list. Empty, it checks every file in zero seconds',
    'and reports the listing complete — exactly the shape [10]D-5 exists to remove.',
  ]);
}
const extraFiles = contract?.perChannel?.[CHANNEL_ID]?.additionalFiles ?? [];
const maxChars = contract?.perChannel?.[CHANNEL_ID]?.maxChars ?? {};
const urlFiles = new Set(contract?.urlFiles ?? []);

// ── which app ────────────────────────────────────────────────────────────────
const appsRaw = read(APPS);
if (appsRaw === null) coverageLost([`${APPS} does not exist — there is no app to submit.`]);
let apps;
try {
  apps = JSON.parse(appsRaw);
} catch (e) {
  coverageLost([`${APPS} is not valid JSON — ${e.message}`]);
}
if (!Array.isArray(apps) || apps.length === 0) coverageLost([`${APPS} carries no app entries.`]);

// `--app` is required (submit-common appOf); there is no first-app default.
const app = appOf(apps, APPS);

// ── the app's own Apple identity and App Store record ───────────────────────
// ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b). Both are per app, and the channel
// row carries neither:
//   · the bundle id the app signs with is tooling/apple-provisioning.json's, read
//     by apple-provisioning.mjs's bundleIdOf and never derived again here;
//   · the App Store Connect record this channel submits to is the app's own
//     apps/<id>/app.yaml `stores.<channel>`, read by tooling/store/store-record.mjs.
// Until 9b the row carried ONE bundleIdentifier and the lane ONE App Store Connect
// app id (the APP_STORE_CONNECT_{IOS,MACOS}_APP_ID secrets), so this block refused
// any app but the first (O-STORE-LANES-HARD-WIRE-ONE-APP). With the record per app
// there is no first app to protect, and the refusal retired with its subject.
const appleRaw = read(APPLE_REGISTER);
if (appleRaw === null) {
  coverageLost([
    `${APPLE_REGISTER} does not exist, so the bundle id app "${app.slug}" signs with cannot be read.`,
    'It is the one declaration of that id; without it the Xcode project below has nothing to be compared to.',
  ]);
}
let appBundle;
try {
  appBundle = bundleIdOf(JSON.parse(appleRaw), app.slug);
} catch (e) {
  die([`FAIL ${e.message}.`, `     App "${app.slug}" has no Apple identity, so it has no App Store record to submit to.`]);
}
let ascRecord;
try {
  ascRecord = storeRecordOf(ROOT, app.slug, CHANNEL_ID);
} catch (e) {
  die([
    `FAIL ${e.message}.`,
    `     The App Store Connect record "${CHANNEL_ID}" submits to is app "${app.slug}"'s own; without one this run has no target.`,
  ]);
}

console.log(`── Apple App Store submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
console.log(`   mode: ${DRY_RUN ? 'DRY RUN (nothing leaves this machine)' : 'SUBMIT'}`);
console.log('');

// ── 1. the metadata tree ─────────────────────────────────────────────────────
const metaDir = String(channel.storeMetadataDir ?? '').replace('{app}', app.slug);
if (metaDir === '') {
  coverageLost([`channel "${CHANNEL_ID}" declares no \`storeMetadataDir\` — there is no listing to submit.`]);
}
if (!existsSync(abs(metaDir)) || !statSync(abs(metaDir)).isDirectory()) {
  die([
    `FAIL the store metadata tree ${metaDir} does not exist.`,
    '     [10]D-5: the listing lives in the repo and the console is a copy of it. With no tree there',
    '     is nothing to submit but whatever somebody last typed into App Store Connect.',
  ]);
}

let filesChecked = 0;
for (const rel of [...requiredFiles, ...extraFiles]) {
  const p = `${metaDir}/${rel}`;
  const text = read(p);
  if (text === null) {
    problems.push(`${p} is missing. ${REGISTER}'s storeMetadataContract requires it.`);
    continue;
  }
  if (text.trim() === '') {
    problems.push(`${p} is EMPTY. An empty listing field satisfies "the file exists" and submits a blank.`);
    continue;
  }
  filesChecked++;

  if (urlFiles.has(rel)) {
    const url = text.trim();
    if (!/^https:\/\/\S+$/.test(url) || /\s/.test(url)) {
      problems.push(`${p} is not a single absolute https URL: ${JSON.stringify(url)}. App Store Connect requires a resolvable privacy policy URL, and a support URL that 404s is a review rejection.`);
    }
  }

  // 🔴 THE ONLY TWO APPLE LENGTH LIMITS WITH A PRIMARY SOURCE, and the guard
  // refuses to enforce one that arrives without its citation. Everything else on
  // an Apple listing — the keywords field, the description, promotional text —
  // is COULD-NOT-ESTABLISH and carries NO number, here or in the register.
  const chars = maxChars[rel];
  if (chars && (Number.isInteger(chars.max) || Number.isInteger(chars.min))) {
    if (typeof chars.source !== 'string' || chars.source.trim() === '') {
      problems.push(
        `${REGISTER} declares a ${CHANNEL_ID} character limit for ${rel} with NO \`source\`. An invented limit fires on CORRECT input; this path will not enforce a number nobody sourced.`,
      );
    } else {
      const n = text.trim().length;
      if (Number.isInteger(chars.max) && n > chars.max) problems.push(`${p} is ${n} characters; the limit is ${chars.max}. Source: ${chars.source}`);
      if (Number.isInteger(chars.min) && n < chars.min) problems.push(`${p} is ${n} characters; the minimum is ${chars.min}. Source: ${chars.source}`);
    }
  }
}
// A pass produced by reading nothing is the failure this repo keeps meeting.
if (filesChecked === 0) {
  coverageLost([
    `${metaDir} yielded ZERO readable metadata files out of ${requiredFiles.length + extraFiles.length} expected.`,
    'Every field check above ran over an empty set. The scan is broken or the tree was emptied;',
    'either way this is not a listing that can be submitted.',
  ]);
}
if (!problems.length) ok(`metadata tree ${metaDir} — ${filesChecked} field(s) present and non-empty`);

// ── [10]D-6 PREFLIGHT — the portfolio-safety gate, run by the RELEASE PATH ────
// 🔴 IN THE SCRIPT AND NOT ONLY IN CI, and the difference is the whole point.
// CI runs assert-submission-safety.mjs on every push in its PORTFOLIO mode; that
// compares the taglines across apps, and it says nothing about the
// app somebody is submitting RIGHT NOW. The `--submitting` mode's
// web-prove-first rule can only be asked at the moment of a submission — so it
// is asked here, by the path that would do it, rather than by a lane that ran
// hours earlier on a different question.
//
// A strike attaches to the PUBLISHER, so the cost of getting this wrong is every
// other app in the portfolio losing distribution at once (L21).
{
  // Resolved from THIS FILE, never from ROOT: `--repo-root` points the CHECKS
  // at another tree (that is how the tests drive this script), and the guard
  // itself always lives beside the release scripts. Resolving it from ROOT
  // meant a fixture root had to contain a copy of tooling/ci to be testable.
  const safety = join(dirname(fileURLToPath(import.meta.url)), '..', 'ci', 'assert-submission-safety.mjs');
  const r = spawnSync(process.execPath, [safety, ROOT, '--submitting', '--app', app.slug], { encoding: 'utf8' });
  if (r.status !== 0) {
    die([
      'FAIL the [10]D-6 submission-safety preflight refused this submission:',
      `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd(),
    ]);
  }
  ok(`[10]D-6 preflight — catalog/apps.json records "${app.slug}" as status "live"; ${((r.stdout ?? '').match(/TAGLINE PAIRS COMPARED: \d+/) ?? ['TAGLINE PAIRS COMPARED: unreported'])[0]}. This preflight made no web request.`);
}

// ── 2. the bundle identifier ─────────────────────────────────────────────────
// Read from BOTH declarations and compare, for the same reason the Microsoft
// path compares the MSIX identity: two copies of an identity is how the wrong
// one ships. Unlike Partner Center's assigned values this one is OURS, already
// real, and therefore checkable today with no Apple account.
//
// ⚠️ iOS and macOS declare it in DIFFERENT FILES and the register says which.
// The macOS pbxproj carries only `com.nikatru.subscriptiontracker.RunnerTests`, so a reader
// that assumed one location would compare against the TEST bundle's id and
// agree with itself.
// ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): the VALUE is bundleIdOf's (above), and
// the FILE Xcode declares it in is the row's `identity.declaredIn` — the same (kind,
// file) pair tooling/ci/assert-store-identity.mjs grades against bundleIdOf. The row
// no longer carries a `bundleIdentifier` value of its own: a second copy of an
// identity is how the wrong one ships.
const declaredBundle = appBundle;
const declaredInTemplate = typeof channel.identity?.declaredIn === 'string' ? channel.identity.declaredIn.trim() : '';
if (declaredInTemplate === '') {
  coverageLost([
    `channel "${CHANNEL_ID}" declares no \`identity.declaredIn\`.`,
    'It names the file Xcode declares the bundle id in (the pbxproj for iOS, an xcconfig for macOS). Absent,',
    'the comparison below has no file to read and would report agreement between two unknowns.',
  ]);
}
{
  const declaredInRel = declaredInTemplate.replace('{app}', app.slug);
  const projectText = read(declaredInRel);
  if (projectText === null) {
    problems.push(`${declaredInRel} does not exist, so channel "${CHANNEL_ID}"'s bundle identifier cannot be compared to what Xcode actually builds.`);
  } else {
    // 🔴 THE READER IS SHARED with tooling/ci/assert-store-identity.mjs since
    // 2026-08-03 (tooling/ci/read-identity.mjs). It drops the TEST bundles
    // EXPLICITLY rather than by taking "the first match" — order-dependent and
    // silently wrong — and the macOS pbxproj contains nothing but RunnerTests,
    // so that distinction is the difference between checking the app and
    // checking the test target. One declaration: a second copy of an identity
    // reader fails by reporting agreement between two things it read wrongly.
    const bundleRead = readAppleBundleId(projectText, declaredInRel);
    if (bundleRead.lost) {
      coverageLost([
        bundleRead.lost,
        'Either the file layout changed or this script is reading the wrong file.',
      ]);
    }
    const appBundles = bundleRead.value === null ? [] : [bundleRead.value];
    if (bundleRead.missing) {
      problems.push(bundleRead.missing);
    } else if (appBundles[0] !== declaredBundle) {
      problems.push(
        `bundle identifier DISAGREES for app "${app.slug}" on channel "${CHANNEL_ID}": ${APPLE_REGISTER} says ${JSON.stringify(declaredBundle)}, ${declaredInRel} builds ${JSON.stringify(appBundles[0])}. App Store Connect binds a record to ONE bundle id — an upload under the other is rejected, and changing it after a release makes a different app.`,
      );
    } else {
      ok(`bundle identifier ${declaredBundle} — ${APPLE_REGISTER} and ${declaredInRel} agree`);
    }
  }
}

// ── 3. the artifact ──────────────────────────────────────────────────────────
// ⚠️ THESE PATHS ARE OURS, NOT AN APPLE CONTRACT. `flutter build ipa` writes to
// build/ios/ipa/; a Mac App Store .pkg is produced by `productbuild` from a
// signed .app, which submit-appstore.yml does not make (unsigned by choice until
// the signing seam lands there), so its location is a convention this repo chooses. Nothing here is claimed as
// sourced, and the register's artifactFormats is what decides whether the file
// is even the right KIND.
// ⏱ 2026-09-25 (O-APPLE-PROVER-SKIPS-THE-PKG): the path is the row's own
// `signing.seam.artifactGlob`, through apple-signing.mjs's appleArtifactPath —
// the glob bp's upload and PROVE are held to. The two literals that stood here
// were a third copy of it.
let artifactRel;
try {
  artifactRel = appleArtifactPath(channel, app.slug);
} catch (e) {
  coverageLost([
    `channel "${CHANNEL_ID}" gives no artifact path: ${e.message}.`,
    `${REGISTER}'s signing.seam.artifactGlob is the one path the upload, PROVE and this script read.`,
  ]);
}
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => artifactRel.endsWith(f))) {
  problems.push(
    `the configured output ${artifactRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The packaging convention and the register disagree about what this channel takes.`,
  );
}

if (existsSync(abs(artifactRel))) {
  const bytes = statSync(abs(artifactRel)).size;
  if (bytes === 0) {
    problems.push(`${artifactRel} exists and is ZERO bytes. A truncated upload is rejected after the wait, which costs a review slot.`);
  } else {
    ok(`artifact ${artifactRel} — ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(
    `NO SIGNED ARTIFACT — ${artifactRel} is not on disk and --allow-missing-artifact was passed, so the listing and the bundle identifier were validated and the package was not. ` +
      'The lane that runs this dry run builds unsigned by choice until the signing seam lands in it, and --submit refuses, so there is no signed package to read here.',
  );
} else {
  problems.push(
    `${artifactRel} does not exist. The lane that runs this dry run builds unsigned by choice until the signing seam lands in it, and --submit refuses, so pass --allow-missing-artifact to validate the listing and identity alone (and say so in the output, which is what that flag does).`,
  );
}

// ── 4. credentials — presence only, never values ─────────────────────────────
// The App Store Connect API authenticates with a `.p8` private key plus the two
// ids that identify it. These NAMES are OURS — the secret names this repo would
// use — not an API contract, so nothing here is claimed as sourced.
//
// 🔴 THE KEY ITSELF IS NEVER READ, PARSED OR PRINTED by this script, only tested
// for presence. A dry run has no reason to touch private key material, and a
// release path that reads a secret it does not need is a release path that can
// leak one.
const CREDENTIAL_ENV = [
  ['APP_STORE_CONNECT_ISSUER_ID', 'the App Store Connect API issuer id (per-team, from Users and Access -> Integrations)'],
  ['APP_STORE_CONNECT_KEY_ID', 'the id of the .p8 API key'],
  ['APP_STORE_CONNECT_PRIVATE_KEY', 'the .p8 private key contents — never read by this script, only checked for presence'],
];
const missingCreds = CREDENTIAL_ENV.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
if (missingCreds.length === 0) {
  ok(`credentials — all ${CREDENTIAL_ENV.length} environment variable(s) present (values never read or printed)`);
} else {
  prints.push(
    `CREDENTIALS NOT CONFIGURED — ${missingCreds.length} of ${CREDENTIAL_ENV.length} absent: ${missingCreds.map(([k]) => k).join(', ')}. The ASC API key among them DOES exist as a repository secret; the certificate ones have never been issued, so this is a printed gap and not a failure. (${missingCreds.map(([k, why]) => `${k} = ${why}`).join(' · ')})`,
  );
}

// ── 4b. the App Store Connect record — the app's own, never a secret ─────────
// ⏱ O-STORE-RECORDS-ARE-ONE-PER-CHANNEL (9b): it was APP_STORE_CONNECT_APP_ID,
// fed from one repository secret per channel — one app's record for every app.
// A pending record is the owner's step (create the record), printed like the
// other owner-gated gaps; an issued one with a hole is a finding.
if (ascRecord.state === 'issued') {
  const holes = missingIdsOf(CHANNEL_ID, ascRecord);
  if (holes.length > 0) {
    problems.push(`${ascRecord.rel} stores.${CHANNEL_ID} is state: issued and lacks ${holes.join(', ')}. An issued record names the App Store Connect record it is.`);
  } else {
    ok(`App Store Connect record ${ascRecord.recordId} — ${ascRecord.rel} stores.${CHANNEL_ID} (issued; the app's own record, not a secret)`);
  }
} else {
  prints.push(
    `APP STORE RECORD PENDING — ${ascRecord.rel} stores.${CHANNEL_ID} is state: pending, so app "${app.slug}" has no App Store Connect record yet. ` +
      'Creating it is an owner step; its Apple ID is then written into the record as recordId, state: issued.',
  );
}

// ── 5. the floors that are sourced, and are not met ──────────────────────────
// Printed on every run rather than failing, because pinning Xcode is real work
// that nobody can validate without an Apple runner — and a gap nobody sees
// becomes permanent ([pipeline C-6]).
//
// 🔴 THIS TEST IS `hasOwnProperty`, AND FROM 2026-08-08 TO 2026-08-20 THAT WAS
// THE ONLY THING IN THE REPOSITORY STANDING BETWEEN A BUILD AND A STORE POLICY
// ALREADY IN FORCE — the warning landed 2026-08-01 (e90b110) and the `xcode` key
// that silenced it landed 2026-08-08 (fb9fe26), both measured with `git log -S`.
// The key's PRESENCE silenced the warning; nothing compared the pin to
// the machine, so writing `xcode: "26"` down removed the sentence describing
// the hazard and left the hazard untouched. A declaration read as an
// enforcement is this corpus's cardinal defect wearing its most convincing
// costume, because the declaration is TRUE — it is just not a check.
//
// Since 2026-08-20 the enforcement exists: tooling/ci/assert-xcode-floor.mjs
// runs in build-platforms.yml's `apple` job and compares `xcodebuild -version`
// against this key, refusing COVERAGE LOST when it cannot ask. So the test
// below is now what it always read like — "is there a floor for that guard to
// enforce?" — rather than the floor itself.
const versionsRaw = read('tooling/versions.json');
let xcodePinned = false;
if (versionsRaw !== null) {
  try {
    xcodePinned = Object.prototype.hasOwnProperty.call(JSON.parse(versionsRaw), 'xcode');
  } catch {
    xcodePinned = false;
  }
}
if (!xcodePinned) {
  prints.push(
    'XCODE FLOOR NOT PINNED — developer.apple.com/news/upcoming-requirements/ (fetched 2026-07-29): apps uploaded to App Store Connect "must be built with Xcode 26 or later", in force since 28 April 2026. ' +
      'tooling/versions.json has no `xcode` key, so tooling/ci/assert-xcode-floor.mjs has no floor to compare the runner against and exits COVERAGE LOST. ' +
      'Also sourced and relevant: the macos-26 runner is arm64-only.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (no signing credentials are configured; A-4 closed 2026-08-31) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nsubmit-appstore: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-appstore: DRY RUN OK — nothing was sent to Apple.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'Private/runbooks/store-submission-apple.md'}`);
  process.exit(0);
}

// The --submit path refused at the top of this file, before any check ran.
}
