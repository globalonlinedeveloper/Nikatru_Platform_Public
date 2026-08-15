#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// submit-windows-store.mjs — the repeatable submission path for the Microsoft
// Store channel.
//
// [pipeline D-10] "For each store channel, the path from signed artifact to
//                  submitted release is scripted and repeatable … so submission
//                  #2 costs minutes, not archaeology."
//
// D-10's replacement acceptance has three re-checkable limbs. This file is
// limb (i) — "a submission script exists AND resolves to a step in a workflow,
// parsed not grepped" — and it is deliberately the FIRST script in
// `tooling/release/`, a directory that did not exist until now. Limb (ii) is
// Private/runbooks/store-submission-windows.md. Limb (iii) — a submission
// record in the [10]D-9 ledger — needs a real submission and stays UNSATISFIED;
// it is the only one of the three that can prove the path was walked rather
// than merely written, and nothing here pretends otherwise.
//
// ── WHY MICROSOFT FIRST, WHEN FASTLANE COVERS THREE OTHER STORES ─────────────
// fastlane's `deliver` covers ios+mac, `supply` covers android, and there is NO
// fastlane path for Microsoft Store. Microsoft is simultaneously the channel we
// can register first ($0, no D-U-N-S, 2–5 business days) and the one fastlane
// cannot reach — so the first submission path this factory needs is precisely
// the one no third party provides.
//
// ── WHAT THIS SCRIPT WILL AND WILL NOT DO ────────────────────────────────────
// `--dry-run`  validates the metadata tree, the packaged .msix and the
//              configured package identity, and exits 0 WITHOUT one byte
//              leaving the machine. This is the mode CI runs.
// `--submit`   REFUSES, loudly, with `UNVERIFIED: <what>`. See the block above
//              the submit path for the full reasoning. In short: the Partner
//              Center submission endpoints were not fetched from a primary
//              source in this increment, and this repo's standing rule is that
//              an unsourced fact is marked UNVERIFIED rather than guessed —
//              because an invented endpoint fails at the worst possible moment,
//              against a live store account, with a half-created submission.
//
// 🔴 NOTHING HERE IS LIVE AND NOTHING HERE CAN BE. The register's windows-store
// row is `served: false` and its `packageIdentity` is the sentinel
// PARTNER-CENTER-PENDING, because OWNER_QUEUE A-2 (the publisher account) is an
// owner action an agent must never take. A dry run over a package that cannot
// be submitted is still worth having: it is what makes registration day minutes
// rather than archaeology, which is the whole of D-10.
//
// Usage:
//   node tooling/release/submit-windows-store.mjs --dry-run [--app <id>]
//   node tooling/release/submit-windows-store.mjs --dry-run --allow-missing-artifact
//   node tooling/release/submit-windows-store.mjs --submit --app <id>     (refuses)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable. 1 = it is not, or --submit.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const CHANNEL_ID = 'windows-store';
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
  console.error('\nsubmit-windows-store: FAILED');
  process.exit(1);
}

function die(lines) {
  console.error('');
  for (const l of lines) console.error(l);
  console.error('\nsubmit-windows-store: FAILED');
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
// 🔴 THIS IS A DELIBERATE STOP, NOT AN UNFINISHED FUNCTION, AND IT IS AT THE TOP
// ON PURPOSE: a refusal that arrives after half the work has run reads like a
// late failure rather than a design decision, and there must be no path on which
// --submit gets partway.
//
// Everything this script validates is verifiable from this repository.
// Everything a submission needs beyond that is a claim about a remote API, and
// this increment fetched no primary source for any of it. This repo's standing
// rule — "NEVER invent a limit; an invented limit fires on correct input" —
// applies at least as hard to an endpoint: a guessed URL or payload shape does
// not fail here, on a laptop, in a dry run. It fails against a LIVE store
// account, mid-submission, leaving a half-created draft a human has to unpick in
// a console. The honest failure is louder and cheaper than the plausible one.
//
// Two further facts make stopping the correct engineering answer rather than a
// cop-out: there is no publisher account to authenticate against (OWNER_QUEUE
// A-2), and the package identity is a sentinel — so even a perfectly correct
// implementation could not be RUN, let alone tested, and CLAUDE.md forbids
// shipping a seam whose open path has never been proven.
const UNVERIFIED = [
  'the Microsoft Store submission API base URL and API version',
  'the endpoint path and HTTP method that creates a submission for a product',
  'the endpoint that requests the package upload URL, and the upload protocol it expects',
  'the request body shape for listing metadata (field names, localisation envelope)',
  'the endpoint and payload that COMMITS a submission, and how its status is polled',
  'the OAuth token endpoint, grant type and resource/scope value for Entra -> Partner Center',
  'whether the `msstore` CLI (Microsoft Store Developer CLI) or the REST API is the supported path today, and which API version each speaks',
];
if (SUBMIT) {
  console.error('');
  console.error('FAIL --submit is NOT IMPLEMENTED, and refusing is the implementation.');
  console.error('');
  for (const u of UNVERIFIED) console.error(`     UNVERIFIED: ${u}`);
  console.error('');
  console.error('     Each line above is a fact about a remote API that was NOT fetched from a primary');
  console.error('     source. Guessing one does not fail here — it fails against a live store account,');
  console.error('     mid-submission. Source them (URL + date, the way the D-5 limits table does), then');
  console.error('     write the calls. Until then the console path in the runbook is the submission path:');
  console.error('       Private/runbooks/store-submission-windows.md');
  console.error('');
  console.error('     Nothing was validated: this refusal is BEFORE the checks on purpose, so there is no');
  console.error('     path on which a submission gets halfway.');
  console.error('\nsubmit-windows-store: FAILED');
  process.exit(1);
}

// ── the register is the single declaration everything below reads ────────────
const registerRaw = read(REGISTER);
if (registerRaw === null) {
  coverageLost([
    `${REGISTER} does not exist.`,
    'The channel row, the package identity and the metadata contract all live there. With it gone',
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
    'metadata directory template and no package identity to validate.',
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
    'and reports the listing complete — which is exactly the shape [10]D-5 exists to remove.',
  ]);
}
const extraFiles = contract?.perChannel?.[CHANNEL_ID]?.additionalFiles ?? [];
const maxLines = contract?.perChannel?.[CHANNEL_ID]?.maxLines ?? {};
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
  die([
    `FAIL no app "${appId}" in ${APPS}.`,
    `     Known: ${apps.map((a) => a.slug).join(', ')}`,
  ]);
}

console.log(`── Microsoft Store submission path · app "${app.slug}" · channel "${CHANNEL_ID}" ──`);
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
    '     is nothing to submit but whatever somebody last typed into Partner Center.',
  ]);
}

let filesChecked = 0;
for (const rel of [...requiredFiles, ...extraFiles]) {
  const p = join(metaDir, rel);
  const text = read(p.split('\\').join('/'));
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
  const limit = maxLines[rel];
  if (limit && Number.isInteger(limit.max)) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    if (lines.length > limit.max) {
      problems.push(`${p} has ${lines.length} entries; the limit is ${limit.max}. Source: ${limit.source}`);
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

// ── 2. the package identity ──────────────────────────────────────────────────
// Read from BOTH declarations and compare. The register is authoritative; the
// pubspec is what `msix` actually packages with. Two copies of an identity is
// how the wrong one ships.
const identity = channel.packageIdentity ?? {};
const SENTINEL = identity.notYetConfiguredSentinel ?? null;
if (!SENTINEL) {
  coverageLost([
    `channel "${CHANNEL_ID}" declares no \`packageIdentity.notYetConfiguredSentinel\`.`,
    'Without it this script cannot tell a placeholder from a real Partner Center value, so it would',
    'either treat the placeholder as configured and "validate" a submission under an identity that',
    'does not exist, or reject a correctly configured account. Both are worse than stopping here.',
  ]);
}

/** Minimal, INDENTATION-AWARE reader for the `msix_config:` block of a pubspec.
 *  Deliberately not a general YAML parser: the block is flat key/scalar pairs by
 *  construction, and adding a dependency to `tooling/release/` for eight lines
 *  would be the first non-stdlib thing in the release path. It self-checks — a
 *  block that parses to nothing is reported, never assumed empty. */
function msixConfig(pubspecText) {
  const lines = pubspecText.split('\n');
  const at = lines.findIndex((l) => /^msix_config:\s*$/.test(l));
  if (at === -1) return null;
  const out = {};
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\S/.test(line)) break; // back to top level
    const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const pubspecRel = `apps/${app.slug}/pubspec.yaml`;
const pubspecText = read(pubspecRel);
if (pubspecText === null) {
  die([`FAIL ${pubspecRel} does not exist — nothing declares how this app is packaged.`]);
}
const cfg = msixConfig(pubspecText);
if (cfg === null) {
  die([
    `FAIL ${pubspecRel} declares no \`msix_config:\` block.`,
    '     The MSIX package identity is this channel row\'s field and the pubspec is where `msix`',
    '     reads it. Without the block, packaging falls back to `com.flutter.<name>` — an identity',
    '     that belongs to nobody and cannot be submitted.',
  ]);
}
if (Object.keys(cfg).length === 0) {
  coverageLost([
    `${pubspecRel} has an \`msix_config:\` block that parsed to ZERO keys.`,
    'The reader has stopped reaching the block, so every identity comparison below would compare',
    'undefined to undefined and agree.',
  ]);
}

/** register field -> pubspec field. Both names are load-bearing: the register
 *  speaks camelCase and `msix` speaks snake_case, and neither can be renamed to
 *  match the other. */
const IDENTITY_FIELDS = [
  ['identityName', 'identity_name'],
  ['publisherDisplayName', 'publisher_display_name'],
  ['publisher', 'publisher'],
];

let pending = 0;
let configured = 0;
for (const [regField, yamlField] of IDENTITY_FIELDS) {
  const declared = identity[regField];
  const packaged = cfg[yamlField];
  if (declared === undefined || declared === null || String(declared).trim() === '') {
    problems.push(`${REGISTER} channel "${CHANNEL_ID}" packageIdentity.${regField} is missing. The register is the single declaration of this identity; an absent field is not a placeholder, it is a hole.`);
    continue;
  }
  if (packaged === undefined) {
    problems.push(`${pubspecRel} msix_config.${yamlField} is missing while the register declares ${regField}. \`msix\` would package a DIFFERENT identity from the one the register documents.`);
    continue;
  }
  if (String(declared) !== String(packaged)) {
    problems.push(
      `package identity DISAGREES: ${REGISTER} says ${regField} = ${JSON.stringify(String(declared))}, ${pubspecRel} says ${yamlField} = ${JSON.stringify(String(packaged))}. One of the two ships and nothing says which.`,
    );
    continue;
  }
  if (String(declared).includes(SENTINEL)) pending++;
  else configured++;
}

if (pending > 0 && configured > 0) {
  problems.push(
    `package identity is HALF configured — ${configured} real value(s) and ${pending} still ${SENTINEL}. A partially-assigned identity packages cleanly and submits under a name that is part real and part placeholder.`,
  );
} else if (pending > 0) {
  prints.push(
    `PACKAGE IDENTITY NOT YET CONFIGURED — all ${pending} field(s) are ${SENTINEL}. Assigned by Partner Center after OWNER_QUEUE A-2 (Product → Product identity). The .msix BUILDS and is NOT SUBMITTABLE; that is the expected state, not a fault.`,
  );
} else {
  ok(`package identity — ${configured} field(s), register and ${pubspecRel} agree`);
}

// `store: true` is the keyKind "none" half of the row made real.
if (String(cfg.store).toLowerCase() !== 'true') {
  problems.push(
    `${pubspecRel} msix_config.store is ${JSON.stringify(cfg.store ?? '(absent)')}, not true. The register's signing.keyKind for this row is "none" BECAUSE the Store re-signs; without \`store: true\`, \`msix\` signs with a self-generated test certificate instead, which the Store rejects and which is a key nobody owns.`,
  );
}

// ── 3. the artifact ──────────────────────────────────────────────────────────
const outputPath = cfg.output_path ?? `build/windows/runner/Release`;
const outputName = cfg.output_name ?? app.slug;
const msixRel = `apps/${app.slug}/${outputPath}/${outputName}.msix`.split('\\').join('/');
const acceptedFormats = (channel.artifactFormats ?? []).filter((f) => typeof f === 'string');
if (!acceptedFormats.some((f) => msixRel.endsWith(f))) {
  problems.push(
    `the configured output ${msixRel} matches none of the formats channel "${CHANNEL_ID}" accepts (${acceptedFormats.join(', ')}). The packaging config and the register disagree about what this channel takes.`,
  );
}

if (existsSync(abs(msixRel))) {
  const bytes = statSync(abs(msixRel)).size;
  if (bytes === 0) {
    problems.push(`${msixRel} exists and is ZERO bytes. A truncated package uploads and fails review, which costs a submission slot.`);
  } else {
    ok(`artifact ${msixRel} — ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
  }
} else if (ALLOW_MISSING_ARTIFACT) {
  prints.push(
    `NO PACKAGED ARTIFACT — ${msixRel} is not on disk and --allow-missing-artifact was passed, so the listing and identity were validated and the package was not. Build it with:  flutter build windows --release && dart run msix:create`,
  );
} else {
  problems.push(
    `${msixRel} does not exist. Run \`flutter build windows --release && dart run msix:create\` in apps/${app.slug} first, or pass --allow-missing-artifact to validate the listing alone (and say so in the output, which is what that flag does).`,
  );
}

// ── 4. credentials — presence only, never values ─────────────────────────────
// Partner Center authenticates the submission API with a Microsoft Entra ID
// (formerly Azure AD) application registered against the Partner Center tenant.
// These names are OURS — the secret names this repo would use — not an API
// contract, so nothing here is claimed as sourced.
const CREDENTIAL_ENV = [
  ['MS_STORE_TENANT_ID', 'the Entra tenant the Partner Center account is associated with'],
  ['MS_STORE_CLIENT_ID', 'the Entra application (client) id authorised in Partner Center'],
  ['MS_STORE_CLIENT_SECRET', 'that application\'s client secret'],
  ['MS_STORE_PRODUCT_ID', 'the Partner Center product this app record is'],
];
const missingCreds = CREDENTIAL_ENV.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
if (missingCreds.length === 0) {
  ok(`credentials — all ${CREDENTIAL_ENV.length} environment variable(s) present (values never read or printed)`);
} else {
  prints.push(
    `CREDENTIALS NOT CONFIGURED — ${missingCreds.length} of ${CREDENTIAL_ENV.length} absent: ${missingCreds.map(([k]) => k).join(', ')}. They cannot exist before OWNER_QUEUE A-2 creates the account, so this is a printed gap and not a failure. (${missingCreds.map(([k, why]) => `${k} = ${why}`).join(' · ')})`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (owner-gated behind OWNER_QUEUE A-2) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nsubmit-windows-store: FAILED');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('');
  console.log('submit-windows-store: DRY RUN OK — nothing was sent to Microsoft.');
  console.log(`   Console-only steps that must happen first: ${channel.submission?.runbook ?? 'Private/runbooks/store-submission-windows.md'}`);
  process.exit(0);
}

// The --submit path refused at the top of this file, before any check ran.
