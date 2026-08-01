#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-snap.mjs — the repeatable submission path for the Snap Store channel.
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// This file is limb (i) — "a submission script exists AND resolves to a step in
// a workflow, parsed not grepped". Limb (ii) is
// company/runbooks/store-submission-snap.md. Limb (iii) — a submission record in
// the [10]D-9 ledger — needs a real submission and stays UNSATISFIED.
//
// ── THERE IS NO FASTLANE PATH FOR SNAP ───────────────────────────────────────
// fastlane's `deliver` covers ios+mac and `supply` covers android; Snap, like
// Microsoft Store and Web, has none (D-5, verified against fastlane's own action
// pages 2026-07-29). So this script is the only thing that will ever stand
// between this repo and the Snap Store.
//
// ── WHAT IS OWNER-GATED HERE IS A NAME, NOT AN ACCOUNT ───────────────────────
// 🔴 The snap name is a GLOBAL namespace across the entire Snap Store, claimed
// once with `snapcraft register <name>` and shared with nobody. That claim is the
// whole of OWNER_QUEUE A-6 — there is no publisher-account application, no
// business verification and no fee, which makes this the cheapest store channel
// on paper and the one with the sharpest irreversible edge: the name is either
// available or it is somebody else's, and finding out is the same action as
// taking it. So the name we intend to claim lives in the metadata tree
// (`snap-name.txt`) where it can be reviewed and diffed BEFORE it is claimed.
//
// ── WE HOLD NO KEY ON THIS PATH ──────────────────────────────────────────────
// The register's signing.keyKind for this row is "none" because CANONICAL signs
// the binary, and its restoreDrill is `required: false` for the same reason.
// There is nothing of ours to lose here — the opposite of the Android upload key.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the artifact and the credential
//              configuration, and exits 0 WITHOUT one byte leaving the machine.
// `--submit`   REFUSES, loudly, with `UNVERIFIED: <what>`. The `snapcraft upload`
//              / `snapcraft release` verbs, their channel-map semantics and the
//              credential format were not fetched from a primary source in this
//              increment. Guessing does not fail here, on a laptop — it fails
//              against the live store, and on this channel a wrong `release`
//              pushes a build to real users' machines via SILENT AUTO-UPDATE.
//              That is the strongest reason of any channel to refuse rather than
//              approximate.
//
// Usage:
//   node tooling/release/submit-snap.mjs --dry-run [--app <id>]
//   node tooling/release/submit-snap.mjs --dry-run --allow-missing-artifact
//   node tooling/release/submit-snap.mjs --submit --app <id>     (refuses)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable. 1 = it is not, or --submit.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHANNEL_ID = 'linux-snap';
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
  console.error('\nsubmit-snap: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nsubmit-snap: FAILED');
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
// 🔴 A DELIBERATE STOP, NOT AN UNFINISHED FUNCTION. It is at the top so there is
// no path on which --submit gets partway. On this channel that matters more than
// on any other: `snapcraft release` promotes a revision into a channel that real
// installations track, and Snap auto-updates SILENTLY. A guessed verb here does
// not produce a failed API call, it produces a wrong build on somebody's desktop.
const UNVERIFIED = [
  'the exact `snapcraft upload` invocation and what it returns (revision id? URL? nothing?)',
  'the `snapcraft release <name> <revision> <channel>` semantics, and the risk/track/branch grammar of a channel spec',
  'whether upload and release are one step or two for a first submission, and which one triggers store review',
  'the format and scope of SNAPCRAFT_STORE_CREDENTIALS, how it is exported, and how long it stays valid',
  'the store-review queue behaviour for a first submission of a CLOSED-SOURCE snap, and which confinement levels need manual review',
  'the exact `snapcraft.yaml` keys required for a store listing vs. for a local build',
  'whether listing metadata (title, summary, description, category, license, screenshots) is pushed by snapcraft at all, or is dashboard-only',
];
if (SUBMIT) {
  console.error('');
  console.error('FAIL --submit is NOT IMPLEMENTED, and refusing is the implementation.');
  console.error('');
  for (const u of UNVERIFIED) console.error(`     UNVERIFIED: ${u}`);
  console.error('');
  console.error('     Each line above is a fact about the Snap Store that was NOT fetched from a primary');
  console.error('     source. On this channel a guessed `release` does not fail cleanly — Snap auto-updates');
  console.error('     silently, so the wrong revision reaches real machines. Source them (URL + date, the');
  console.error('     way the D-5 limits table does), then write the calls. Until then the console path in');
  console.error('     the runbook is the submission path:  company/runbooks/store-submission-snap.md');
  console.error('');
  console.error('     Nothing was validated: this refusal is BEFORE the checks on purpose.');
  console.error('\nsubmit-snap: FAILED');
  process.exit(1);
}

// ── the register is the single declaration everything below reads ────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row and the metadata contract both live there. With it gone every validation below',
    'would range over undefined and pass by having nothing to check.',
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
    'This script exists to submit to exactly that row. Without it there is no artifact format and no',
    'metadata directory template to validate.',
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
const urlFiles = new Set(contract?.urlFiles ?? []);

// 🔴 NO NUMERIC LIMIT IS READ FOR THIS CHANNEL AND THAT IS THE FINDING. No Snap
// Store listing limit was fetched from a primary source, so the register
// declares none and this script enforces none. An invented limit fires on
// CORRECT input — a made-up "120 characters or fewer" once rejected this repo's
// own fixture at 129. If a limit is ever added to the register with its
// citation, it is added here in the same increment.
const declaredLimits = Object.keys(contract?.perChannel?.[CHANNEL_ID] ?? {}).filter((k) => k === 'maxChars' || k === 'maxLines');
if (declaredLimits.length > 0) {
  problems.push(
    `${REGISTER} now declares ${declaredLimits.join(' and ')} for "${CHANNEL_ID}", and this script does not read them — so a limit that looks enforced would not be. Wire it here in the same increment that adds it there, with its source.`,
  );
}

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

console.log(`── Snap Store submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
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
    '     [10]D-5: the listing lives in the repo and the dashboard is a copy of it. With no tree there',
    '     is nothing to submit but whatever somebody last typed into snapcraft.io.',
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
      problems.push(`${p} is not a single absolute https URL: ${JSON.stringify(url)}.`);
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

// ── 2. the snap name — the one irreversible field ────────────────────────────
// It is not validated against the store (that would BE the claim). What is
// checked is that the repo holds a single, syntactically usable name, because
// `snapcraft register` takes it verbatim and the namespace is global.
//
// ⚠️ THE CHARACTER RULES ARE UNVERIFIED. The shape below (lowercase letters,
// digits and hyphens; not starting or ending with a hyphen) is what every
// published snap name observably looks like, and it is applied as a SHAPE check
// with that caveat rather than as a sourced limit — it can only reject a name
// that no snap has ever had, so it cannot fire on correct input the way a
// guessed LENGTH limit would.
const NAME_FILE = 'snap-name.txt';
const snapNameRaw = read(`${metaDir}/${NAME_FILE}`);
if (snapNameRaw === null) {
  problems.push(
    `${metaDir}/${NAME_FILE} is missing. It holds the GLOBAL Snap Store namespace this app intends to claim, and it exists precisely so that name is reviewable before \`snapcraft register\` takes it.`,
  );
} else {
  const snapName = snapNameRaw.trim();
  if (snapName.includes('\n')) {
    problems.push(`${metaDir}/${NAME_FILE} contains more than one line. A snap has exactly one name; two candidates means nobody decided.`);
  } else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(snapName)) {
    problems.push(
      `${metaDir}/${NAME_FILE} is ${JSON.stringify(snapName)}, which is not the shape a snap name takes (lowercase letters, digits and hyphens; not leading or trailing a hyphen). ⚠️ The authoritative character rules are UNVERIFIED — this is a shape check, not a sourced limit.`,
    );
  } else {
    ok(`snap name "${snapName}" — one line, usable shape (availability is UNVERIFIED and cannot be checked without claiming it)`);
    prints.push(
      `SNAP NAME NOT REGISTERED — "${snapName}" is the name this repo intends to claim, and whether it is available is UNVERIFIED: the store was not queried, and it cannot be reserved without claiming it. \`snapcraft register ${snapName}\` is the entirety of OWNER_QUEUE A-6 and is an owner action.`,
    );
  }
}

// ── 3. the artifact ──────────────────────────────────────────────────────────
// ⚠️ THIS PATH IS OURS, NOT A SNAPCRAFT CONTRACT. snapcraft writes
// `<name>_<version>_<arch>.snap` into its working directory; where this repo
// would collect it is a convention this repo chooses. The register's
// artifactFormats is what decides whether the file is even the right KIND.
const artifactRel = `apps/${app.slug}/build/linux/snap/${app.slug}.snap`;
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => artifactRel.endsWith(f))) {
  problems.push(
    `the configured output ${artifactRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The packaging convention and the register disagree about what this channel takes.`,
  );
}

if (existsSync(abs(artifactRel))) {
  const bytes = statSync(abs(artifactRel)).size;
  if (bytes === 0) {
    problems.push(`${artifactRel} exists and is ZERO bytes. A truncated snap uploads and fails review.`);
  } else {
    ok(`artifact ${artifactRel} — ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(`NO PACKAGED ARTIFACT — ${artifactRel} is not on disk and --allow-missing-artifact was passed, so the listing was validated and the package was not.`);
} else {
  problems.push(`${artifactRel} does not exist, and nothing in this repo builds it yet (see the snapcraft recipe gap below). Pass --allow-missing-artifact to validate the listing alone.`);
}

// ── 4. the recipe that does not exist yet ────────────────────────────────────
// Printed, not failed: writing it is deferred work ([ADR 015] — native Linux
// waits for revenue), not a regression. But a gap nobody sees becomes permanent
// ([pipeline C-6]), and "there is a submission script" reads as more readiness
// than there is while nothing can produce the thing it submits.
const RECIPE_CANDIDATES = [`apps/${app.slug}/snap/snapcraft.yaml`, `apps/${app.slug}/snapcraft.yaml`];
const recipe = RECIPE_CANDIDATES.find((r) => existsSync(abs(r)));
if (!recipe) {
  prints.push(
    `NO SNAPCRAFT RECIPE — none of ${RECIPE_CANDIDATES.join(', ')} exists, so nothing in this repo can build a .snap today. ` +
      'The register\'s row already records the shape it must take ([ADR 015] §3): ingest the prebuilt CI artifact via `plugin: dump`, bundle libmpv via `stage-packages: [libmpv2]`, and declare `plugs: [opengl, wayland, x11, audio-playback]`. ' +
      'Deferred with native Linux, not missing by accident.',
  );
} else {
  ok(`snapcraft recipe ${recipe}`);
}

// ── 5. credentials — presence only, never values ─────────────────────────────
// `snapcraft` authenticates non-interactively with an exported credential blob.
// The NAME below is snapcraft's own documented variable; its FORMAT and lifetime
// are UNVERIFIED and are listed in the refusal block above. Nothing here reads
// or prints the value.
const CREDENTIAL_ENV = [['SNAPCRAFT_STORE_CREDENTIALS', 'the exported store credential snapcraft reads for a non-interactive upload']];
const missingCreds = CREDENTIAL_ENV.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
if (missingCreds.length === 0) {
  ok(`credentials — all ${CREDENTIAL_ENV.length} environment variable(s) present (values never read or printed)`);
} else {
  prints.push(
    `CREDENTIALS NOT CONFIGURED — ${missingCreds.map(([k]) => k).join(', ')} absent. It cannot exist before OWNER_QUEUE A-6, so this is a printed gap and not a failure. (${missingCreds.map(([k, why]) => `${k} = ${why}`).join(' · ')})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated behind OWNER_QUEUE A-6) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nsubmit-snap: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-snap: DRY RUN OK — nothing was sent to the Snap Store.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'company/runbooks/store-submission-snap.md'}`);
  process.exit(0);
}

// The --submit path refused at the top of this file, before any check ran.
