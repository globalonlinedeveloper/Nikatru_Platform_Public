#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-play.mjs — the repeatable submission path for the Google Play channel.
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// D-10's replacement acceptance has three re-checkable limbs. This file is
// limb (i) for `android-play` — "a submission script exists AND resolves to a
// step in a workflow, parsed not grepped". Limb (ii) is
// company/runbooks/store-submission-android.md. Limb (iii) — a submission record
// in the [10]D-9 ledger — needs a real submission and stays UNSATISFIED; it is
// the only one of the three that can prove the path was walked rather than
// merely written, and nothing here pretends otherwise.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the built .aab, the package name,
//              the signing posture and the service-account configuration, and
//              exits 0 WITHOUT one byte leaving the machine. This is the mode
//              CI runs.
// `--submit`   REFUSES, loudly, with `UNVERIFIED: <what>`. The Play Developer
//              API's endpoints, edit-lifecycle and payload shapes were not
//              fetched from a primary source in this increment, and this repo's
//              standing rule is that an unsourced fact is marked UNVERIFIED
//              rather than guessed — because an invented endpoint does not fail
//              here, on a laptop. It fails against a LIVE Play account,
//              mid-submission, leaving a half-created edit a human unpicks in a
//              console.
//
// 🔴 NOTHING HERE IS LIVE AND NOTHING HERE CAN BE. The register's android-play
// row is `served: false`; there is no publisher account (OWNER_QUEUE A-3), no
// upload key, and — for a personal account created after 2023-11-13 — a
// 12-tester × 14-continuous-day closed test standing between any build and
// production. Those are owner actions an agent must never take. A dry run over a
// bundle that cannot be submitted is still worth having: it is what makes
// registration day minutes rather than archaeology, which is the whole of D-10.
//
// Usage:
//   node tooling/release/submit-play.mjs --dry-run [--app <id>]
//   node tooling/release/submit-play.mjs --dry-run --allow-missing-artifact
//   node tooling/release/submit-play.mjs --submit --app <id>        (refuses)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable. 1 = it is not, or --submit.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANNEL_ID = 'android-play';
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
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

if (DRY_RUN === SUBMIT) {
  die([
    'FAIL exactly one of --dry-run and --submit is required.',
    '     Defaulting either way is how a dry run becomes a submission (or a submission',
    '     silently becomes a no-op). The mode has to be said out loud.',
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
// this increment fetched no primary source for any of it.
//
// Two further facts make stopping the correct engineering answer rather than a
// cop-out: there is no publisher account to authenticate against (OWNER_QUEUE
// A-3), and no upload key exists — so even a perfectly correct implementation
// could not be RUN, let alone tested, and CLAUDE.md forbids shipping a seam
// whose open path has never been proven.
const UNVERIFIED = [
  'the Google Play Developer API base URL and API version currently supported',
  'the edit lifecycle endpoints (insert an edit, upload a bundle to it, assign it to a track, commit or validate it) and their exact paths',
  'the OAuth scope string a service account must hold, and whether a JWT bearer assertion or a metadata-server token is the supported grant today',
  'the request body shape for a track assignment (release notes envelope, staged-rollout fraction, status vocabulary)',
  'whether the Play Console still accepts programmatic promotion out of a closed test, or whether the 12-tester gate is console-only',
  'the exact upload protocol for an .aab (resumable vs simple upload) and its size limits',
  'whether `r0adkll/upload-google-play` (the action this path would most likely use) is still maintained and which API version it speaks',
];
if (SUBMIT) {
  console.error('');
  console.error('FAIL --submit is NOT IMPLEMENTED, and refusing is the implementation.');
  console.error('');
  for (const u of UNVERIFIED) console.error(`     UNVERIFIED: ${u}`);
  console.error('');
  console.error('     Each line above is a fact about a remote API that was NOT fetched from a primary');
  console.error('     source. Guessing one does not fail here — it fails against a live Play account,');
  console.error('     mid-submission. Source them (URL + date, the way the D-5 limits table does), then');
  console.error('     write the calls. Until then the console path in the runbook is the submission path:');
  console.error('       company/runbooks/store-submission-android.md');
  console.error('');
  console.error('     Nothing was validated: this refusal is BEFORE the checks on purpose, so there is no');
  console.error('     path on which a submission gets halfway.');
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

// ── the register is the single declaration everything below reads ────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row, the artifact format and the metadata contract all live there. With it gone',
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
    'metadata directory template and no signing posture to validate.',
  ]);
}
if (channel.submittable !== true) {
  die([
    `FAIL channel "${CHANNEL_ID}" is not marked \`submittable\` in ${REGISTER}.`,
    '     A store you cannot submit to has no submission path to run.',
  ]);
}

const contract = register.storeMetadataContract;
const requiredFiles = Array.isArray(contract?.requiredFiles) ? contract.requiredFiles : [];
if (requiredFiles.length === 0) {
  coverageLost([
    `${REGISTER} declares no \`storeMetadataContract.requiredFiles\`.`,
    'The metadata validation below iterates that list. Empty, it checks every file in zero seconds',
    'and reports the listing complete — which is exactly the shape [10]D-5 exists to remove.',
  ]);
}
const extraFiles = contract?.perChannel?.[CHANNEL_ID]?.additionalFiles ?? [];
const maxLines = contract?.perChannel?.[CHANNEL_ID]?.maxLines ?? {};
const maxChars = contract?.perChannel?.[CHANNEL_ID]?.maxChars ?? {};
const urlFiles = new Set(contract?.urlFiles ?? []);

/** Unicode CODE POINTS of the trimmed text — the same counting rule
 *  assert-store-metadata.mjs uses, and for the same reason (see
 *  storeMetadataContract._limitsWhy). `.length` is UTF-16 units and would count
 *  one emoji as two, rejecting copy that is inside Google's published limit. */
const charCount = (text) => [...text.trim()].length;

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

console.log(`── Google Play submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
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
    '     is nothing to submit but whatever somebody last typed into the Play Console.',
  ]);
}

let filesChecked = 0;
let limitsChecked = 0;
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
      problems.push(
        `${p} is not a single absolute https URL: ${JSON.stringify(url)}. Play requires a reachable privacy policy URL on the store listing for any app that collects personal data, and a malformed one blocks the release rather than failing review later.`,
      );
    }
  }

  // A limit with no `source` is a FAULT, not a licence to enforce it anyway —
  // an unsourced number is indistinguishable from a remembered one, and a
  // remembered one fires on CORRECT input.
  const lineLimit = maxLines[rel];
  if (lineLimit && Number.isInteger(lineLimit.max)) {
    if (typeof lineLimit.source !== 'string' || lineLimit.source.trim() === '') {
      problems.push(`${REGISTER} maxLines["${rel}"] for "${CHANNEL_ID}" declares max ${lineLimit.max} with no \`source\`.`);
    } else {
      limitsChecked++;
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
      if (lines.length > lineLimit.max) {
        problems.push(`${p} has ${lines.length} entries; the limit is ${lineLimit.max}. Source: ${lineLimit.source}`);
      }
    }
  }
  const charLimit = maxChars[rel];
  if (charLimit && Number.isInteger(charLimit.max)) {
    if (typeof charLimit.source !== 'string' || charLimit.source.trim() === '') {
      problems.push(`${REGISTER} maxChars["${rel}"] for "${CHANNEL_ID}" declares max ${charLimit.max} with no \`source\`.`);
    } else {
      limitsChecked++;
      const n = charCount(text);
      if (n > charLimit.max) {
        problems.push(`${p} is ${n} characters; Play caps this field at ${charLimit.max}. Source: ${charLimit.source}`);
      }
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
const declaredLimits = [maxLines, maxChars].reduce((n, o) => n + Object.keys(o).filter((k) => k !== '_why').length, 0);
if (declaredLimits > 0 && limitsChecked === 0) {
  coverageLost([
    `${declaredLimits} field limit(s) are declared for "${CHANNEL_ID}" and NOT ONE was evaluated.`,
    'Either the contract names files this tree does not carry, or every limit lost its `source`.',
    'Both report every listing field within its limit by never measuring one.',
  ]);
}
if (!problems.length) {
  ok(`metadata tree ${metaDir} — ${filesChecked} field(s) present and non-empty, ${limitsChecked} within a SOURCED Play limit`);
}

// ── 2. the package name ──────────────────────────────────────────────────────
// 🔴 IMMUTABLE AFTER THE FIRST UPLOAD. Play binds the listing to the
// applicationId permanently — there is no rename, only a second listing with a
// second review and a split of every rating and install count. [10]D-3 owns the
// general assertion across all platforms; this is the release path refusing to
// ship an artifact whose identity it did not check, which is not the same job.
const gradleRel = `apps/${app.slug}/android/app/build.gradle.kts`;
const gradleText = read(gradleRel);
if (gradleText === null) {
  die([
    `FAIL ${gradleRel} does not exist — nothing declares this app's Android package name or how it is signed.`,
  ]);
}
const appIdMatch = gradleText.match(/^\s*applicationId\s*=\s*"([^"]+)"/m);
if (!appIdMatch) {
  coverageLost([
    `${gradleRel} declares no \`applicationId\`.`,
    'Without it the package name this submission would claim is undefined, and both checks below',
    'would compare undefined to undefined and agree. Play binds the package name permanently at the',
    'first upload; there is no version of "we will fix it later".',
  ]);
}
const packageName = appIdMatch[1];
const expectedPackage = `com.nikatru.${app.slug}`;
if (packageName !== expectedPackage) {
  problems.push(
    `${gradleRel} declares applicationId "${packageName}" and architecture §24's canonical form for app "${app.slug}" is "${expectedPackage}". Play binds the package name at the FIRST upload and it can never be changed — a mismatch also silently splits one app into two in every analytics report, and the store half cannot be corrected.`,
  );
} else {
  ok(`package name ${packageName} — matches the canonical com.nikatru.<app_id> form`);
}

// ── 3. the signing posture ───────────────────────────────────────────────────
// The env var NAMES are PARSED OUT OF THE GRADLE FILE rather than repeated here.
// Two copies of that list is how they drift, and the drift is silent: this
// script would report "no keystore configured" forever while Gradle happily read
// a different variable. Parsing also means DELETING the signing block fails here
// instead of quietly reverting the shape to an unconditional debug config.
const envPairs = [...gradleText.matchAll(/"(\w+)"\s+to\s+"([A-Z0-9_]+)"/g)].map((m) => [m[1], m[2]]);
if (envPairs.length === 0) {
  coverageLost([
    `${gradleRel} declares no release-signing environment map.`,
    'The `releaseSigningEnv` block is the shape that lets a keystore be supplied as configuration',
    'rather than as a code change. With it gone the release build is unconditionally debug-signed and',
    'this script cannot tell — it would report the posture it expected instead of the one in the file.',
  ]);
}
if (!/signingConfigs\.getByName\("debug"\)/.test(gradleText)) {
  problems.push(
    `${gradleRel} no longer names the debug signing config as the fallback. That fallback is a RECORDED owner decision (the register's android-play notes): with no keystore supplied, the release build is a debug-signed BUILD PROOF. Removing it turns every keyless build into a failure rather than a proof.`,
  );
}

const suppliedEnv = envPairs.filter(([, env]) => (process.env[env] ?? '').trim() !== '');
const keyPropertiesRel = `apps/${app.slug}/android/key.properties`;
const hasKeyProperties = existsSync(abs(keyPropertiesRel));

if (hasKeyProperties) {
  prints.push(
    `SIGNING: ${keyPropertiesRel} is present, so Gradle reads the keystore from it and the environment is not consulted. Its CONTENTS are deliberately not read here — this script never touches key material. (The file is gitignored: .gitignore:57 and apps/${app.slug}/android/.gitignore:12.)`,
  );
} else if (suppliedEnv.length === 0) {
  prints.push(
    `SIGNING POSTURE: DEBUG FALLBACK — none of ${envPairs.map(([, e]) => e).join(', ')} is set and there is no ${keyPropertiesRel}, so the release build is debug-signed. This is the RECORDED owner decision, not a defect: the lane produces a build PROOF, and the real upload key arrives with OWNER_QUEUE A-3 / S-5. 🔴 A debug-signed .aab CANNOT be uploaded to Play.`,
  );
} else if (suppliedEnv.length < envPairs.length) {
  problems.push(
    `signing is HALF configured — ${suppliedEnv.length} of ${envPairs.length} keystore variable(s) set (${suppliedEnv.map(([, e]) => e).join(', ')}). Gradle refuses this state on purpose and so does this script: falling back to debug with three of four values present produces a debug-signed artifact from a run that looked like a signing run, and Play accepts a given upload key exactly once.`,
  );
} else {
  ok(`signing posture — all ${envPairs.length} keystore variable(s) supplied (values never read or printed)`);
}

// ── 4. the artifact ──────────────────────────────────────────────────────────
// Flutter's app-bundle output path is fixed by the tool, not configurable in the
// pubspec the way `msix`'s output is, so it is derived rather than read.
const aabRel = `apps/${app.slug}/build/app/outputs/bundle/release/app-release.aab`;
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => aabRel.endsWith(f))) {
  problems.push(
    `the build output ${aabRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The build lane and the register disagree about what this channel takes.`,
  );
}

if (existsSync(abs(aabRel))) {
  const bytes = statSync(abs(aabRel)).size;
  if (bytes === 0) {
    problems.push(`${aabRel} exists and is ZERO bytes. A truncated bundle uploads and fails processing, which costs a version code.`);
  } else {
    ok(`artifact ${aabRel} — ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(
    `NO BUILT ARTIFACT — ${aabRel} is not on disk and --allow-missing-artifact was passed, so the listing, package name and signing posture were validated and the bundle was NOT. Build it with:  flutter build appbundle --release`,
  );
} else {
  problems.push(
    `${aabRel} does not exist. Run \`flutter build appbundle --release\` in apps/${app.slug} first, or pass --allow-missing-artifact to validate the listing alone (and say so in the output, which is what that flag does).`,
  );
}

// ── 5. the service account — presence and SHAPE, never values ────────────────
// The Play Developer API authenticates with a Google Cloud service account that
// has been granted access in the Play Console. Play needs exactly ONE secret,
// which is why this list is shorter than the Microsoft path's four: the package
// name is derived above and the track is a choice, not a credential.
//
// This validates that the JSON PARSES and carries the fields a service-account
// key has. A malformed or truncated secret is otherwise discovered at
// submission time, against a live account — and a secret that was pasted with a
// wrapping quote or a missing newline looks exactly like a present one to a
// bare presence check.
const SA_ENV = 'PLAY_SERVICE_ACCOUNT_JSON';
const SA_REQUIRED_KEYS = ['type', 'client_email', 'private_key'];
const saRaw = (process.env[SA_ENV] ?? '').trim();
if (saRaw === '') {
  prints.push(
    `SERVICE ACCOUNT NOT CONFIGURED — ${SA_ENV} is absent. It cannot exist before OWNER_QUEUE A-3 creates the Play Developer account and a Google Cloud service account is granted access in the Play Console, so this is a printed gap and not a failure.`,
  );
} else {
  let sa = null;
  try {
    sa = JSON.parse(saRaw);
  } catch (e) {
    // The message is the parser's, about STRUCTURE. No fragment of the value is
    // echoed: a service-account key is a private key.
    problems.push(
      `${SA_ENV} is set but is not valid JSON (${e.message}). A service-account key that does not parse fails at submission time against a live account; catching it here costs nothing. The value is never printed.`,
    );
  }
  if (sa !== null) {
    if (typeof sa !== 'object' || Array.isArray(sa)) {
      problems.push(`${SA_ENV} parses but is not a JSON object. A Google service-account key is an object with at least ${SA_REQUIRED_KEYS.join(', ')}.`);
    } else {
      const missing = SA_REQUIRED_KEYS.filter((k) => typeof sa[k] !== 'string' || sa[k].trim() === '');
      if (missing.length > 0) {
        problems.push(`${SA_ENV} parses but is missing ${missing.join(', ')}. Only the KEY NAMES are reported — no value from this secret is ever printed.`);
      } else if (sa.type !== 'service_account') {
        problems.push(`${SA_ENV} has type ${JSON.stringify(sa.type)}; the Play Developer API needs a service-account key (type "service_account"). An OAuth client secret is a different credential and fails at token exchange.`);
      } else {
        ok(`service account — ${SA_ENV} parses and carries ${SA_REQUIRED_KEYS.length} required field(s) (values never read or printed)`);
      }
    }
  }
}

// The track is a CHOICE, not a credential, and deliberately NOT validated
// against a vocabulary: Play supports custom closed-test track names alongside
// internal/alpha/beta/production, so an allowlist here would reject correct
// input — the exact failure mode the D-5 limits table exists to prevent.
const track = (process.env.PLAY_TRACK ?? '').trim();
prints.push(
  `TRACK: ${track === '' ? 'unset (the runbook\'s first upload goes to a CLOSED test, not production)' : JSON.stringify(track)}. Not validated against a vocabulary — Play allows custom closed-test track names, so an allowlist would reject correct input.`,
);

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated behind OWNER_QUEUE A-3) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nsubmit-play: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-play: DRY RUN OK — nothing was sent to Google.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'company/runbooks/store-submission-android.md'}`);
  console.log('   ⬜ And a CALENDAR, not a task: 12 testers opted in to a closed test for 14 continuous');
  console.log('      days before production access (personal accounts created after 2023-11-13), plus');
  console.log('      developer verification. Neither is something this script can shorten.');
  process.exit(0);
}

// The --submit path refused at the top of this file, before any check ran.
