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
// parsed not grepped". Limb (ii) is Private/company/runbooks/store-submission-apple.md.
// Limb (iii) — a submission record in the [10]D-9 ledger — needs a real
// submission and stays UNSATISFIED; it is the only one of the three that can
// prove the path was walked rather than merely written, and nothing here
// pretends otherwise.
//
// ── WHY ONE SCRIPT FOR TWO CHANNELS ──────────────────────────────────────────
// The two rows are separate submissions with separate App Store Connect records,
// separate metadata trees and independent review outcomes — which is why the
// register carries two rows and this repo carries two metadata trees. But they
// authenticate with the SAME Apple Developer account (OWNER_QUEUE A-4) and the
// SAME App Store Connect API key. Two scripts would be two copies of one
// authentication path, and the second one would be the first to drift
// ([pipeline F-2]). So: one script, `--channel`, and every path it touches comes
// from the register row it was pointed at.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the artifact and the bundle
//              identifier the Xcode project actually builds, and exits 0 WITHOUT
//              one byte leaving the machine. This is the mode CI runs.
// `--submit`   REFUSES, loudly, with `UNVERIFIED: <what>`. The App Store Connect
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
// There is no Apple Developer account, no distribution certificate, no
// provisioning profile and no App Store Connect API key — OWNER_QUEUE A-4 — and
// this script wires NONE of them. A dry run over an artifact that cannot yet be
// signed is still worth having: it is what makes enrolment day minutes rather
// than archaeology, which is the whole of D-10.
//
// Usage:
//   node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore
//   node tooling/release/submit-appstore.mjs --dry-run --channel macos-appstore --app subly
//   node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore --allow-missing-artifact
//   node tooling/release/submit-appstore.mjs --submit  --channel ios-appstore     (refuses)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable. 1 = it is not, or --submit.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readAppleBundleId } from '../ci/read-identity.mjs';

const CHANNELS = ['ios-appstore', 'macos-appstore'];
const REGISTER = 'tooling/channel-register.json';
const APPS = 'sites/_shared/_data/apps.json';

// ── arguments ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const DRY_RUN = flag('dry-run');
const SUBMIT = flag('submit');
const ALLOW_MISSING_ARTIFACT = flag('allow-missing-artifact');
const ROOT = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const problems = [];
const prints = [];
const ok = (m) => console.log(`ok   ${m}`);
const abs = (rel) => join(ROOT, rel);
const read = (rel) => (existsSync(abs(rel)) ? readFileSync(abs(rel), 'utf8') : null);

/** The scan cannot continue and reporting "clean" would be a lie about nothing. */
function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nsubmit-appstore: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nsubmit-appstore: FAILED');
  process.exit(1);
}

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
// Two further facts make stopping the correct engineering answer rather than a
// cop-out: there is no Apple Developer account to authenticate against
// (OWNER_QUEUE A-4), and no distribution certificate exists — so even a
// perfectly correct implementation could not be RUN, let alone tested, and
// CLAUDE.md forbids shipping a seam whose open path has never been proven.
const UNVERIFIED = [
  'the App Store Connect API base URL and version segment',
  'the endpoint and payload that reserve an app version, and how a localisation is attached to it',
  'the endpoint that creates a build upload / reserves an asset, and the upload protocol it expects',
  'the field names of the listing payload (name, subtitle, keywords, description, promotional text) and the locale envelope they sit in',
  'the endpoint and payload that SUBMIT a version for review, and how review state is polled',
  'the exact JWT claim set, algorithm and expiry the API accepts for a .p8 key (issuer id, key id, audience)',
  'whether the App Store Connect API, `xcrun altool` or Transporter is the supported UPLOAD path today for each of .ipa and .pkg, and which one the Xcode 26 floor requires',
  'the required Xcode version PIN — the floor "Xcode 26 or later" is sourced, but nothing in this repo pins it (tooling/versions.json has no `xcode` key)',
];
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
  console.error('     path:  Private/company/runbooks/store-submission-apple.md');
  console.error('');
  console.error('     Nothing was validated: this refusal is BEFORE the checks on purpose, so there is no');
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

const appId = opt('app') ?? apps[0]?.slug;
const app = apps.find((a) => a.slug === appId);
if (!app) {
  die([`FAIL no app "${appId}" in ${APPS}.`, `     Known: ${apps.map((a) => a.slug).join(', ')}`]);
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
// proves the taglines are distinct across apps, and it proves nothing about the
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
  ok('[10]D-6 preflight — distinct tagline, and the app is live on the web before a store sees it');
}

// ── 2. the bundle identifier ─────────────────────────────────────────────────
// Read from BOTH declarations and compare, for the same reason the Microsoft
// path compares the MSIX identity: two copies of an identity is how the wrong
// one ships. Unlike Partner Center's assigned values this one is OURS, already
// real, and therefore checkable today with no Apple account.
//
// ⚠️ iOS and macOS declare it in DIFFERENT FILES and the register says which.
// The macOS pbxproj carries only `com.nikatru.subly.RunnerTests`, so a reader
// that assumed one location would compare against the TEST bundle's id and
// agree with itself.
const bundle = channel.bundleIdentifier ?? null;
if (bundle === null) {
  coverageLost([
    `channel "${CHANNEL_ID}" declares no \`bundleIdentifier\`.`,
    'It is the single declaration this script compares the Xcode project against. Absent, the',
    'comparison below has no left-hand side and would report agreement between two unknowns.',
  ]);
}
const declaredBundle = typeof bundle.value === 'string' ? bundle.value.trim() : '';
const declaredInTemplate = typeof bundle.declaredIn === 'string' ? bundle.declaredIn : '';
if (declaredBundle === '' || declaredInTemplate === '') {
  problems.push(
    `channel "${CHANNEL_ID}" bundleIdentifier is incomplete in ${REGISTER} (value=${JSON.stringify(bundle.value ?? null)}, declaredIn=${JSON.stringify(bundle.declaredIn ?? null)}). An absent field is a hole, not a placeholder.`,
  );
} else {
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
        `bundle identifier DISAGREES for app "${app.slug}" on channel "${CHANNEL_ID}": ${REGISTER} says ${JSON.stringify(declaredBundle)}, ${declaredInRel} builds ${JSON.stringify(appBundles[0])}. App Store Connect binds a record to ONE bundle id — an upload under the other is rejected, and changing it after a release makes a different app.`,
      );
    } else {
      ok(`bundle identifier ${declaredBundle} — register and ${declaredInRel} agree`);
    }
  }
}

// ── 3. the artifact ──────────────────────────────────────────────────────────
// ⚠️ THESE PATHS ARE OURS, NOT AN APPLE CONTRACT. `flutter build ipa` writes to
// build/ios/ipa/; a Mac App Store .pkg is produced by `productbuild` from a
// signed .app, which needs the distribution certificate OWNER_QUEUE A-4 gates,
// so its location is a convention this repo chooses. Nothing here is claimed as
// sourced, and the register's artifactFormats is what decides whether the file
// is even the right KIND.
const ARTIFACT = {
  'ios-appstore': `apps/${app.slug}/build/ios/ipa/${app.slug}.ipa`,
  'macos-appstore': `apps/${app.slug}/build/macos/pkg/${app.slug}.pkg`,
};
const artifactRel = ARTIFACT[CHANNEL_ID];
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
      `Producing one needs the distribution certificate and provisioning profile OWNER_QUEUE A-4 gates, and Apple hardware: neither exists, and no signing is wired anywhere in this repo.`,
  );
} else {
  problems.push(
    `${artifactRel} does not exist. It cannot be produced without the OWNER_QUEUE A-4 distribution certificate, so pass --allow-missing-artifact to validate the listing and identity alone (and say so in the output, which is what that flag does).`,
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
  ['APP_STORE_CONNECT_APP_ID', "the App Store Connect record's numeric app id for this channel"],
];
const missingCreds = CREDENTIAL_ENV.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
if (missingCreds.length === 0) {
  ok(`credentials — all ${CREDENTIAL_ENV.length} environment variable(s) present (values never read or printed)`);
} else {
  prints.push(
    `CREDENTIALS NOT CONFIGURED — ${missingCreds.length} of ${CREDENTIAL_ENV.length} absent: ${missingCreds.map(([k]) => k).join(', ')}. They cannot exist before OWNER_QUEUE A-4 creates the Apple Developer account, so this is a printed gap and not a failure. (${missingCreds.map(([k, why]) => `${k} = ${why}`).join(' · ')})`,
  );
}

// ── 5. the floors that are sourced, and are not met ──────────────────────────
// Printed on every run rather than failing, because pinning Xcode is real work
// that nobody can validate without an Apple runner — and a gap nobody sees
// becomes permanent ([pipeline C-6]).
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
      'tooling/versions.json has no `xcode` key and build-platforms.yml pins only the runner image label (`macos-26`), which is not the same thing: the image can move its default Xcode without this repo noticing. ' +
      'Also sourced and relevant: the macos-26 runner is arm64-only.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated behind OWNER_QUEUE A-4) ──');
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
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'Private/company/runbooks/store-submission-apple.md'}`);
  process.exit(0);
}

// The --submit path refused at the top of this file, before any check ran.
