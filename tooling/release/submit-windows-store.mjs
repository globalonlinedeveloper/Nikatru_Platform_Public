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
//
// 🔴 CORRECTED 2026-09-12. Everything in this block said `--submit` REFUSES with
// `UNVERIFIED: <what>`, and that "NOTHING HERE IS LIVE AND NOTHING HERE CAN BE".
// Both were true when they were written and both had been FALSE since #627
// (7a102b78), which fetched the Partner Center endpoints from primary sources,
// cited each one, and built the real submit path at `submitPath()` below. A
// header that says a script cannot ship is the most expensive kind of stale
// comment: it is the sentence a reader checks BEFORE deciding how carefully to
// read the rest, and this repository's own doctrine is that a wrong claim about
// a file's subject is that subject one level up. The paragraphs are corrected
// rather than deleted, and the history is left visible.
//
// `--dry-run`  validates the metadata tree, the packaged .msix and the
//              configured package identity, and exits 0 WITHOUT one byte
//              leaving the machine. This is the mode CI runs.
// `--submit`   REALLY SUBMITS, and is gated. Every one of these must hold, each
//              refusing separately and by name:
//                PG-1   `--confirm <phrase>`, TYPED, never a default
//                PG-1b  GITHUB_ACTIONS=true and GITHUB_REPOSITORY set — the lane
//                PG-2   every remote fact still carries its primary-source URL
//                PG-3   all five MS_STORE_* secrets non-empty, fail CLOSED
//                PG-6   the publish environment EXISTS and carries a REQUIRED
//                       REVIEWER, read back from the GitHub API at run time
//
// ⚠️ WHAT IS STILL NOT LIVE, AND WHY THAT IS NOT THIS FILE'S DOING. The
// register's windows-store row is `served: false` and its `packageIdentity` is
// still the sentinel PARTNER-CENTER-PENDING, because OWNER_QUEUE A-2 (the
// publisher account) is an owner action an agent must never take. So today
// `--submit` stops at the placeholder-identity refusal, and nothing has been
// submitted to any store. That is a fact about the ACCOUNT, not about this
// script: the moment the three identity values are copied out of Partner Center,
// this path publishes. Read it as live code.
//
// ⏱ CORRECTED 2026-09-22 — the paragraph above is kept as written and is no
// longer true of the identity. The publisher account is verified and the three
// values were copied out of Partner Center that day: `packageIdentity.identityName`
// is 60210NIKATRU.NikatruSubscriptionTracker, mirrored in the pubspec, with the
// Package Family Name recomputed by assert-channel-register.mjs §6e. So the
// placeholder-identity refusal below no longer fires for this app; it stays, for
// the next app stamped on the sentinel. What stops `--submit` now is only the
// gates listed above — the typed confirm phrase, the GitHub Actions lane, all
// five MS_STORE_* secrets, and the publish environment's required reviewer —
// and the row is still `served: false`. Nothing has been submitted; the submit
// is the owner's word, never an agent's.
//
// ⏱ 2026-09-25 — O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1). The identity NAME is
// no longer the row's: it is the record of the app named by `--app`,
// apps/<id>/app.yaml `stores.windows-store`, read through
// tooling/ci/read-identity.mjs windowsIdentityOf. The row keeps the sentinel and
// the account's `publisher` and `publisherDisplayName`. A second app therefore
// validates and submits under its OWN identity, or refuses on the placeholder.
//
// Usage:
//   node tooling/release/submit-windows-store.mjs --dry-run [--app <id>]
//   node tooling/release/submit-windows-store.mjs --dry-run --allow-missing-artifact
//   node tooling/release/submit-windows-store.mjs --submit --app <id> --confirm <phrase>
//                                                 (inside GitHub Actions only)
//   [--repo-root <path>]   point every path below at a different tree (tests)
//
// Exit 0 = the submission path is walkable, or the submission succeeded.
//       1 = it is not, or a gate refused.
//       2 = COVERAGE LOST: an input it must read is absent or unreadable (submit-common.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { submitCli, requirePublishEnvironment, PUBLISH_ENVIRONMENT } from './submit-common.mjs';
import { windowsIdentityOf } from '../ci/read-identity.mjs';

const CHANNEL_ID = 'windows-store';
const REGISTER = 'tooling/channel-register.json';
const APPS = 'catalog/apps.json';

// ── arguments, and the two stops (submit-common.mjs: COVERAGE LOST exits 2) ──
const { flag, opt, root: ROOT, ok, abs, read, coverageLost, die } = submitCli('submit-windows-store');

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

// ─────────────────────────────────────────────────────────────────────────────
// PRIMARY SOURCES — every remote fact `--submit` acts on, and where it came
// from. ALL FETCHED 2026-09-07. This block is not decoration: the seven-line
// `UNVERIFIED` refusal it replaces demanded exactly this, in exactly this form
// ("Source them (URL + date, the way the D-5 limits table does), then write the
// calls"), and a fact whose URL is not written down here is a fact this script
// may not act on. An invented endpoint does not fail on a laptop; it fails
// against a live store account, mid-submission, leaving a half-created draft.
//
// 🔴 EVERY ONE OF THESE IS CHECKED AT RUN TIME BY `sourceOk`, NOT MERELY
// DOCUMENTED. Blank one and `--submit` REFUSES naming it, before any call is
// made. That is what stops this block decaying into a comment: a citation
// nothing reads is a citation nobody has to keep true.
// ─────────────────────────────────────────────────────────────────────────────
const PRIMARY_SOURCES = Object.freeze({
  // "Create and manage submissions using Microsoft Store services" — the end-to-end
  // process, the Azure AD (Entra) token exchange, and the prerequisite that an app
  // must already have ONE completed submission made in Partner Center.
  submissionApi: 'https://learn.microsoft.com/en-us/windows/uwp/monetize/create-and-manage-submissions-using-windows-store-services',
  // "Manage app submissions" — the six methods and their URLs, including commit
  // and status, and the CommitStarted → PreProcessing / CommitFailed transition.
  manageAppSubmissions: 'https://learn.microsoft.com/en-us/windows/uwp/monetize/manage-app-submissions',
  // "Create an app submission" — the response body, including `fileUploadUrl`
  // (the Azure Blob SAS URI) and the `applicationPackages` / `listings` shapes.
  createAppSubmission: 'https://learn.microsoft.com/en-us/windows/uwp/monetize/create-an-app-submission',
  // The Microsoft Store Developer CLI: commands, options and the CI/CD guidance.
  msstoreCli: 'https://learn.microsoft.com/en-us/windows/apps/publish/msstore-dev-cli/commands',
  // Its releases, read from the GitHub REST API: v0.4.2, published 2026-09-02,
  // repository not archived (pushed 2026-09-04).
  msstoreReleases: 'https://api.github.com/repos/microsoft/msstore-cli/releases',
  // GitHub environments — the protection-rules read PG-6 below performs.
  githubEnvironmentsApi: 'https://docs.github.com/en/rest/deployments/environments',
});

/** The REST facts, written down beside the transport that speaks them. The CLI
 *  is what this script RUNS; these are what it runs ON, and they are recorded so
 *  a reader can check the transport's behaviour against the documented API
 *  rather than against the CLI's own output.
 *  - token:   POST https://login.microsoftonline.com/<tenant_id>/oauth2/token
 *             grant_type=client_credentials, resource=https://manage.devcenter.microsoft.com
 *             (60-minute lifetime)          — PRIMARY_SOURCES.submissionApi
 *  - base:    https://manage.devcenter.microsoft.com/v1.0/my
 *  - create:  POST   .../applications/{applicationId}/submissions
 *  - update:  PUT    .../applications/{applicationId}/submissions/{submissionId}
 *  - upload:  PUT the ZIP to the `fileUploadUrl` SAS URI returned by create
 *  - commit:  POST   .../applications/{applicationId}/submissions/{submissionId}/commit
 *  - status:  GET    .../applications/{applicationId}/submissions/{submissionId}/status
 *                                            — PRIMARY_SOURCES.manageAppSubmissions */
const REST = Object.freeze({
  tokenEndpoint: 'https://login.microsoftonline.com/{tenant}/oauth2/token',
  resource: 'https://manage.devcenter.microsoft.com',
  base: 'https://manage.devcenter.microsoft.com/v1.0/my',
});

/** 🔴 WHAT IS STILL NOT SOURCED, AND EXACTLY WHICH LIMB REFUSES BECAUSE OF IT.
 *  Two of the original seven survive the 2026-09-07 fetch. Each is written as
 *  {gap, limb} rather than as prose, because a gap with no named consequence is
 *  a note and a gap with one is a decision somebody can overturn with a URL. */
const UNSOURCED = Object.freeze([
  {
    gap: 'whether `msstore reconfigure` STRICTLY REQUIRES `--sellerId`, or merely accepts it. The options table still marks none of the four account parameters required, and no page fetched states the rule — so the REQUIREMENT is unsourced in exactly the way it was on 2026-09-07.',
    limb: 'RESOLVED IN THE OTHER DIRECTION on 2026-09-09, and the limb moved with it. This script now PASSES `--sellerId`, because the question that decides the code is not "is it required" but "is it correct", and that one IS sourced: the page names SellerId as one of the account-identifying parameters and BOTH of its CI/CD examples pass it. Passing a documented identifier the examples supply costs nothing if it is optional and is the whole lane if it is not, so the asymmetry decides it. What stays unsourced is only the strictness, which no longer gates anything.',
  },
  {
    gap: 'the RAW-HTTP transport: the exact Azure Blob request the ZIP upload to `fileUploadUrl` must make (the documentation demonstrates it only through the .NET CloudBlockBlob class), and the submission-body shape a full listing PUT would need field by field.',
    limb: 'the RAW-REST path is NOT implemented — no request in this file goes to manage.devcenter.microsoft.com. Everything that touches the Store goes through the Microsoft Store Developer CLI, which already holds both. The same gap keeps LISTING SYNC refused: the listing is a console act, per the runbook.',
  },
]);

/** The submission verbs, in the order the CLI documents them. `publish` uploads
 *  the package and leaves the submission in DRAFT (`--noCommit`); `submission
 *  publish` commits it; `submission poll` waits on the commit. Split exactly as
 *  the documented example splits it, because the page also warns that `publish`
 *  RECREATES the draft — "Run publish before updating metadata, not after" — so
 *  the order is a documented constraint and not a preference. */
const CLI = 'msstore';
const CONFIRM_TOKEN = 'SUBMIT-TO-MICROSOFT-STORE';

/** Is the citation for a sourced fact still there? Called before any remote call
 *  that depends on it; the mutation test blanks one URL and asserts exit 1.
 *  A PREDICATE rather than a refusal, because the refusal has to happen inside
 *  the async submit path — see the shell-12 note there. */
function sourceOk(key) {
  const url = PRIMARY_SOURCES[key];
  return typeof url === 'string' && url.startsWith('https://') && url.length > 'https://'.length && !/\s/.test(url);
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

// ── 2. the package identity ──────────────────────────────────────────────────
// Read from BOTH declarations and compare. The declarations are authoritative
// (the app's own record for the identity name, the register row for the
// account); the pubspec is what `msix` actually packages with. Two copies of an
// identity is how the wrong one ships.
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

/** declared field -> pubspec field -> whose it is. The names are load-bearing:
 *  the declarations speak camelCase and `msix` speaks snake_case, and neither
 *  can be renamed to match the other. `app` is read from the app's own record
 *  (O-SECOND-APP-SIGNS-AS-THE-FIRST limb (1)); `account` from the channel row. */
const IDENTITY_FIELDS = [
  ['identityName', 'identity_name', 'app'],
  ['publisherDisplayName', 'publisher_display_name', 'account'],
  ['publisher', 'publisher', 'account'],
];

const record = windowsIdentityOf(ROOT, app.slug);
if (record.missing) {
  problems.push(record.missing);
} else if (!record.value) {
  problems.push(
    `${record.rel} declares no stores.${CHANNEL_ID} record. It is the one declaration of the identity Partner Center issued app "${app.slug}"; with none there is nothing to package or submit under. An app with no product yet declares ${SENTINEL} in both fields.`,
  );
}

const pending = { app: 0, account: 0 };
const configured = { app: 0, account: 0 };
for (const [field, yamlField, whose] of IDENTITY_FIELDS) {
  const declared = whose === 'app' ? record.value?.identityName : identity[field];
  const source = whose === 'app' ? `${record.rel} stores.${CHANNEL_ID}.${field}` : `${REGISTER} channel "${CHANNEL_ID}" packageIdentity.${field}`;
  const packaged = cfg[yamlField];
  if (declared === undefined || declared === null || String(declared).trim() === '') {
    // The app's record was named above; the account's facts are a hole here.
    if (whose === 'account') {
      problems.push(`${source} is missing. It is the ACCOUNT's, declared once for every app; an absent field is not a placeholder, it is a hole.`);
    }
    continue;
  }
  if (packaged === undefined) {
    problems.push(`${pubspecRel} msix_config.${yamlField} is missing while ${source} declares it. \`msix\` would package a DIFFERENT identity from the one declared.`);
    continue;
  }
  if (String(declared) !== String(packaged)) {
    problems.push(
      `package identity DISAGREES: ${source} = ${JSON.stringify(String(declared))}, ${pubspecRel} says ${yamlField} = ${JSON.stringify(String(packaged))}. One of the two ships and nothing says which.`,
    );
    continue;
  }
  if (String(declared).includes(SENTINEL)) pending[whose]++;
  else configured[whose]++;
}
const pendingAll = pending.app + pending.account;
const configuredAll = configured.app + configured.account;

if (pending.account > 0 && configured.account > 0) {
  problems.push(
    `package identity is HALF configured — the account's publisher and publisher display name are ${configured.account} real and ${pending.account} still ${SENTINEL}. A partially-assigned identity packages cleanly and submits under a name that is part real and part placeholder.`,
  );
} else if (configured.app > 0 && pending.account > 0) {
  problems.push(
    `package identity is HALF configured — identity_name is issued and the account's ${pending.account} field(s) are still ${SENTINEL}. An issued identity packaged under a placeholder publisher submits as nobody's.`,
  );
} else if (pending.app > 0) {
  prints.push(
    pending.account > 0
      ? `PACKAGE IDENTITY NOT YET CONFIGURED — all ${pendingAll} field(s) are ${SENTINEL}. Assigned by Partner Center after OWNER_QUEUE A-2 (Product → Product identity). The .msix BUILDS and is NOT SUBMITTABLE; that is the expected state, not a fault.`
      : `PACKAGE IDENTITY NOT YET CONFIGURED — identity_name is ${SENTINEL} under the account's configured publisher: Partner Center has not issued app "${app.slug}" its own identity. The .msix BUILDS and is NOT SUBMITTABLE; reserve the app's name in Partner Center and copy the issued values into ${record.rel} stores.${CHANNEL_ID}.`,
  );
  // ⏱ 2026-09-11 — "NOT SUBMITTABLE" ABOVE WAS A SENTENCE, NOT A CHECK. With every field
  // still the sentinel this branch only PRINTED, so `--submit` walked on to `msstore publish`
  // under `identity_name: PARTNER-CENTER-PENDING` (REVIEW-stores-2026-09-10 #3). On the dry run
  // the placeholder stays a print — it is owner work (A-2), not a defect. On a real submission
  // it is a REFUSAL, raised here so it lands in the same problems block as the credential check
  // and exits before any preflight that talks to GitHub or Microsoft. The phrase
  // "PLACEHOLDER PACKAGE IDENTITY — --submit REFUSED" is read by
  // tooling/ci/assert-store-identity.mjs, which runs this script with every credential blanked
  // on every push to prove the refusal still stands.
  // ⏱ 2026-09-25 — and it refuses on the identity NAME alone: under a configured
  // account, an app Partner Center has not issued its own identity yet (the state
  // the brick stamps) would otherwise be "partly real" and walk on.
  if (SUBMIT) {
    problems.push(
      `PLACEHOLDER PACKAGE IDENTITY — --submit REFUSED: ${pending.account > 0 ? `all ${pendingAll} identity field(s) are still ${SENTINEL} in ${record.rel}, ${REGISTER} and ${pubspecRel}` : `identity_name is still ${SENTINEL} in both ${record.rel} and ${pubspecRel}`}. Microsoft binds a product to its Package/Identity/Name at the first upload; publishing under a placeholder is a package no Partner Center product owns. Reserve this app's name in Partner Center, copy the issued identity (Product → Product identity) into ${record.rel} stores.${CHANNEL_ID}, render it into msix_config (node tooling/app-yaml/render.mjs), then submit.`,
    );
  }
} else {
  // 🔴 THIS LINE IS THE LIVE LANE'S DRY-RUN OUTPUT and is kept byte-for-byte as it
  // was before the identity name moved to the app's record (B4a-2): "register"
  // here reads as the declarations, the app's record for the name and the row
  // for the account.
  ok(`package identity — ${configuredAll} field(s), register and ${pubspecRel} agree`);
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
// 🔴 MS_STORE_SELLER_ID IS AN ACCOUNT IDENTIFIER, NOT A SECRET-SHAPED THING, and it
// is in this list anyway because this list is what makes a missing value a NAMED
// refusal instead of the CLI's own error. See the `reconfigure` call below for why
// it is passed; see Private/runbooks/store-submission-windows.md for which of the two
// seller ids on this account is the live one — they differ by three digits and the
// wrong one authenticates against nothing. The VALUES live in that runbook and in the
// GitHub secrets (the four ids at repository level, the client secret in the
// store-publish environment); none is written into this public tree.
const CREDENTIAL_ENV = [
  ['MS_STORE_TENANT_ID', 'the Entra tenant the Partner Center account is associated with'],
  ['MS_STORE_CLIENT_ID', 'the Entra application (client) id authorised in Partner Center'],
  ['MS_STORE_CLIENT_SECRET', 'that application\'s client secret'],
  ['MS_STORE_PRODUCT_ID', 'the Partner Center product this app record is'],
  ['MS_STORE_SELLER_ID', 'the Partner Center SELLER id — the account `msstore reconfigure` configures against'],
];
// ⏱ 2026-09-25 — O-STORE-SECRETS-REACH-THE-DRY-RUN. A credential whose
// `ciSecretRegister.nonSigning` row is scoped to a GitHub environment is readable
// only in a job bound to that environment, and the dry-run job has none. So the
// dry run does not look for it — an absence it cannot see is not a gap it can
// report — and says instead where it IS checked: the submit job's first step, and
// this script's --submit path below, which still requires all five. The scope is
// read from the register row assert-channel-register §8c grades the workflows
// against; a register with no such row (a test fixture) leaves every name checked.
const scopedTo = new Map(
  (Array.isArray(register.ciSecretRegister?.nonSigning) ? register.ciSecretRegister.nonSigning : [])
    .filter((e) => typeof e?.name === 'string' && typeof e?.environment === 'string' && e.environment.trim() !== '')
    .map((e) => [e.name, e.environment.trim()]),
);
const checkedHere = SUBMIT ? CREDENTIAL_ENV : CREDENTIAL_ENV.filter(([k]) => !scopedTo.has(k));
for (const [k, why] of CREDENTIAL_ENV) {
  if (SUBMIT || !scopedTo.has(k)) continue;
  ok(`${why.replace(/^that application's /, '')}: checked in the environment-bound submit job — ${k} lives in the "${scopedTo.get(k)}" environment, which this dry run cannot see`);
}
const missingCreds = checkedHere.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
if (missingCreds.length === 0) {
  ok(`credentials — all ${checkedHere.length} environment variable(s) present (values never read or printed)`);
} else {
  prints.push(
    `CREDENTIALS NOT CONFIGURED — ${missingCreds.length} of ${checkedHere.length} absent: ${missingCreds.map(([k]) => k).join(', ')}. They cannot exist before OWNER_QUEUE A-2 creates the account, so this is a printed gap and not a failure. (${missingCreds.map(([k, why]) => `${k} = ${why}`).join(' · ')})`,
  );
  // 🔴 …AND ON `--submit` IT IS A FAILURE, RAISED HERE SO THE EMPTY SECRET IS
  // NAMED BEFORE any later check can fail first. The artifact check below runs
  // in the same pass, so a submit attempt with neither a package nor a
  // credential reports BOTH — and the credential line, which is the one a
  // reader has to act on, is not hidden behind whichever check happens to be
  // written first. [pipeline C-6] keeps it a PRINT on the dry run, where the
  // owner-gated gap is not a defect; on a real submission it is fail-closed.
  if (SUBMIT) {
    problems.push(
      `${missingCreds.length} of ${CREDENTIAL_ENV.length} Microsoft Store credential(s) are EMPTY: ${missingCreds.map(([k]) => k).join(', ')}. --submit cannot authenticate without them, and a submission job that discovers that and reports success is a green tick over a store that received nothing.`,
    );
    for (const [k] of missingCreds) {
      if (!scopedTo.has(k)) continue;
      problems.push(
        `${k} is a "${scopedTo.get(k)}" ENVIRONMENT secret, readable only in a job bound to that environment. OWNER STEP: GitHub → Settings → Environments → ${scopedTo.get(k)} → Environment secrets → add ${k}.`,
      );
    }
    // 🔴 THE SELLER ID GETS ITS OWN SENTENCE, because it is the newest of the five and
    // the only one whose absence used to be INVISIBLE. Before 2026-09-09 this script
    // passed tenant/client/secret and no seller id at all, so a missing one produced
    // no message here and no message from the CLI either — there was nothing to miss.
    // Now that `--sellerId` is passed, an empty value reaches `msstore reconfigure` as
    // a bare `--sellerId` with nothing after it, and what comes back is the CLI's own
    // argument error naming no secret at all. This line is what stops that.
    if (missingCreds.some(([k]) => k === 'MS_STORE_SELLER_ID')) {
      problems.push(
        'MS_STORE_SELLER_ID specifically: it is the Partner Center SELLER id, which `msstore reconfigure` takes as --sellerId, and it is NOT the product id. This account has carried TWO seller ids that differ by three digits; the retired one authenticates against nothing while looking entirely plausible in a log, so read the live one from Private/runbooks/store-submission-windows.md rather than from memory or from an old workflow run.',
      );
    }
  }
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

// ─────────────────────────────────────────────────────────────────────────────
// ── --submit — THE REAL SUBMISSION PATH ──────────────────────────────────────
//
// It runs AFTER every check above, and each preflight below is a separate
// refusal with its own message, because "the submission failed" without a reason
// is what sends somebody to a console to find out.
//
//   PG-1  the confirm phrase, typed, not a checkbox
//   PG-2  every primary source still cited (`requireSource`, above)
//   PG-3  every MS_STORE_* secret NON-EMPTY — fail CLOSED, naming the empty one
//   PG-6  the publish environment EXISTS and carries a REQUIRED REVIEWER
//
// 🔴 PG-6 IS THE LIMB WITHOUT WHICH `environment:` IS DECORATION. GitHub
// documents that running a workflow which references an environment that does
// not exist CREATES one with that name — and no protection rules — so the job
// proceeds immediately, unapproved, while the run history shows an environment
// as if a gate had been honoured. `environment:` on its own FAILS OPEN. PG-6
// reads the rules back at run time, through submit-common.mjs
// `requirePublishEnvironment` (C4b, 2026-09-25), and refuses an environment with
// no rule carrying a reviewer.
//
// ⚠️ EVERY REFUSAL BELOW SETS `process.exitCode` AND RETURNS; none calls
// `process.exit()`. On Windows, `process.exit()` while undici still holds a
// socket dies inside libuv and leaves with 3221226505 rather than the code the
// script chose (TRAPS shell-12) — and this path makes an HTTPS call.
// ─────────────────────────────────────────────────────────────────────────────
async function submitPath() {
  const fail = (lines) => {
    console.error('');
    for (const l of lines) console.error(l);
    console.error('\nsubmit-windows-store: FAILED');
    process.exitCode = 1;
  };

  const confirm = opt('confirm');
  if (confirm !== CONFIRM_TOKEN) {
    return fail([
      `FAIL --submit requires --confirm ${CONFIRM_TOKEN}; got ${JSON.stringify(confirm ?? '')}.`,
      '     A store submission is [ADR 031] class A. The phrase is TYPED rather than checked so that',
      '     nothing on this path can be reached by a default.',
    ]);
  }

  // ── PG-1b · THE LANE ────────────────────────────────────────────────────────
  // ⏱ 2026-09-12 — 🔴 --submit REFUSES OUTSIDE GITHUB ACTIONS, and that is the
  // gate, not a limitation. submit-play.mjs:321 and submit-snap.mjs:359 have
  // carried this check since their submit paths existed; this file's submit path
  // landed in #627 WITHOUT it, so every gate below could be satisfied on a
  // laptop — PG-3's five secrets by `export`, and PG-6's required-reviewer read
  // by a personal token with `repo` scope, which answers the environments API
  // exactly as the runner's does. The approval [ADR 031] requires exists in one
  // place only, a GitHub environment on a JOB, and it is recorded in a run's
  // history; a submission that ran anywhere else has by construction not passed
  // it. PG-6 asks whether the gate EXISTS, which is a different question from
  // whether this process went through it, and only this check asks the second.
  if ((process.env.GITHUB_ACTIONS ?? '') !== 'true' || (process.env.GITHUB_REPOSITORY ?? '').trim() === '') {
    return fail([
      'FAIL --submit runs only inside GitHub Actions (GITHUB_ACTIONS=true and GITHUB_REPOSITORY set).',
      `     [ADR 031:117-124] the publish gate is a GitHub environment ("${PUBLISH_ENVIRONMENT}") carrying a`,
      '     REQUIRED REVIEWER. That approval is recorded in a run\'s history and exists nowhere else, so a',
      '     submission from a laptop is not "the same thing without the paperwork" — it is the control',
      '     removed. Dispatch .github/workflows/submit-windows-store.yml instead.',
    ]);
  }

  for (const key of ['submissionApi', 'manageAppSubmissions', 'createAppSubmission', 'msstoreCli', 'msstoreReleases', 'githubEnvironmentsApi']) {
    if (!sourceOk(key)) {
      return fail([
        `FAIL the primary source for "${key}" is ${JSON.stringify(PRIMARY_SOURCES[key] ?? null)}, not an absolute https URL.`,
        '     This script may act only on a remote fact whose source is written down. An unsourced',
        '     endpoint does not fail here, on a laptop — it fails against a live store account,',
        '     mid-submission, leaving a half-created draft a human has to unpick in a console.',
        '     Restore the citation (URL + the date it was fetched) or delete the call that needs it.',
      ]);
    }
  }
  ok(`primary sources — ${Object.keys(PRIMARY_SOURCES).length} citation(s) present; this path acts on nothing that is not sourced`);

  const emptyCreds = CREDENTIAL_ENV.filter(([k]) => !process.env[k] || process.env[k].trim() === '');
  if (emptyCreds.length > 0) {
    return fail([
      `FAIL ${emptyCreds.length} of ${CREDENTIAL_ENV.length} Microsoft Store credential(s) are EMPTY: ${emptyCreds.map(([k]) => k).join(', ')}.`,
      ...emptyCreds.map(([k, why]) => `     ${k} — ${why}`),
      '     THIS LANE FAILS CLOSED. A submission job that discovers it cannot authenticate and then',
      '     reports success is a green tick over a store that received nothing. The four values come',
      '     from an Entra application associated with the Partner Center account:',
      `     ${PRIMARY_SOURCES.submissionApi} — "You must associate an Azure AD application with your`,
      '     Partner Center account and obtain your tenant ID, client ID and key."',
      '     OWNER STEP: Private/runbooks/store-submission-windows.md, section "the four secrets" (FIVE since 2026-09-09 — MS_STORE_SELLER_ID joined them).',
      ...emptyCreds
        .filter(([k]) => scopedTo.has(k))
        .map(([k]) => `     ${k} is a "${scopedTo.get(k)}" ENVIRONMENT secret: GitHub → Settings → Environments → ${scopedTo.get(k)} → Environment secrets → add ${k}.`),
    ]);
  }
  ok(`credentials — all ${CREDENTIAL_ENV.length} environment variable(s) present (values never read or printed)`);

  // ── PG-6 · the environment EXISTS and carries a REQUIRED REVIEWER ───────────
  // ⏱ C4b, 2026-09-25: `requirePublishEnvironment` in submit-common.mjs, the one
  // read submit-play and submit-snap make too. It returns a verdict and never
  // exits, so this path still stops through `fail` (process.exitCode, shell-12).
  // 🔴 ITS REVIEWER RULE IS THE STRICT INTERSECTION. This file keyed on a rule
  // whose `type` was `required_reviewers`; the other three copies keyed on a
  // NON-EMPTY `reviewers` list. The shared read requires both at once, so it
  // refuses everything any of the four refused (its doc says what changed in
  // each direction). And its success line no
  // longer says "this submission paused for a human": `can_admins_bypass` is
  // read off the same response and reported, since where it is not false an
  // administrator can dispatch past the reviewer.
  const gate = await requirePublishEnvironment({ label: 'PG-6', userAgent: 'nikatru-submit-windows-store' });
  if (!gate.ok) return fail(gate.lines);
  for (const l of gate.lines) console.log(l);

  // ── the transport ──────────────────────────────────────────────────────────
  // 🔴 THE CLI, NOT RAW REST, AND FOR THE SAME REASON SNAP SPEAKS `snapcraft`.
  // The Microsoft Store Developer CLI is Microsoft's own, cross-platform,
  // documented and actively released (v0.4.2, published 2026-09-02), and it
  // already holds the two links UNSOURCED above records this repository does not
  // have: the Azure Blob upload of the ZIP, and the full submission-body shape.
  // Writing raw REST would mean guessing both.
  const cliCheck = spawnSync(CLI, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (cliCheck.error !== undefined && cliCheck.error !== null) {
    return fail([
      `FAIL the Microsoft Store Developer CLI (\`${CLI}\`) is not on PATH — ${cliCheck.error.message}.`,
      `     Install it as the lane does. ${PRIMARY_SOURCES.msstoreCli}`,
      '     This is a refusal and not a fallback: the second transport would be the raw REST path',
      '     whose two missing links are recorded in UNSOURCED above.',
    ]);
  }
  ok(`transport — \`${CLI}\` present: ${String(cliCheck.stdout ?? '').trim().split('\n')[0]}`);

  const productId = process.env.MS_STORE_PRODUCT_ID;
  let broke = false;
  const runCli = (args, label) => {
    if (broke) return;
    console.log(`→    ${CLI} ${args[0]}${args[1] !== undefined && !args[1].startsWith('--') ? ` ${args[1]}` : ''} …`);
    const r = spawnSync(CLI, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) {
      broke = true;
      fail([
        `FAIL ${label} exited ${r.status === null ? `on signal ${r.signal}` : r.status}.`,
        `     ${PRIMARY_SOURCES.msstoreCli}`,
        '     Read the CLI output above. A partial submission stays in Partner Center as a DRAFT and',
        '     has to be finished or deleted there; this script does not guess which.',
      ]);
    }
  };

  // 1. configure the CLI non-interactively from the five secrets.
  //
  // 🔴 THE SELLER ID IS NOT RE-CHECKED HERE, and the reason is worth a line so it is
  // not "helpfully" re-added. A guard was written at exactly this point — refuse if
  // MS_STORE_SELLER_ID is empty, before the CLI is handed `--sellerId ''` — and it is
  // UNREACHABLE: PG-3 above pushes every empty credential onto `problems`, and
  // `problems.length` exits at line ~522, which is before this function is ever
  // called. An assertion that cannot fail is worse than none (docs/verification-
  // discipline.md), so PG-3 is the one preflight and it carries the whole message.
  runCli(
    [
      'reconfigure',
      '--tenantId', process.env.MS_STORE_TENANT_ID,
      '--clientId', process.env.MS_STORE_CLIENT_ID,
      '--clientSecret', process.env.MS_STORE_CLIENT_SECRET,
      // 🔴 ADDED 2026-09-09, closing the gap UNSOURCED used to carry. The options
      // table marks none of the four required, which is why this script passed
      // three and called the fourth unmeasured — but "not marked required" is a
      // property of a documentation table, not of the CLI, and both of the CI/CD
      // examples on that page pass it. Passing an identifier the tool documents
      // and both of its examples supply is not a guess; omitting it was.
      '--sellerId', process.env.MS_STORE_SELLER_ID,
    ],
    'msstore reconfigure',
  );
  // 2. upload the package into a DRAFT submission. `--noCommit` is deliberate:
  //    the documented example runs publish FIRST and commits separately, because
  //    `publish` RECREATES the draft and would discard staged metadata.
  runCli(['publish', join(ROOT, `apps/${app.slug}`), '--inputFile', abs(msixRel), '--appId', productId, '--noCommit'], 'msstore publish');
  // 3. commit it, then 4. wait for the commit to be accepted.
  runCli(['submission', 'publish', productId], 'msstore submission publish');
  runCli(['submission', 'poll', productId], 'msstore submission poll');
  if (broke) return undefined;

  console.log('');
  console.log('   ── what a green run here still does NOT prove ──');
  console.log(`   ⬜ CERTIFICATION IS THE STORE'S AND IS NOT THIS SCRIPT'S VERDICT. ${PRIMARY_SOURCES.manageAppSubmissions}:`);
  console.log('      the status moves CommitStarted → PreProcessing on success and CommitFailed on error, and');
  console.log("      everything after PreProcessing is Microsoft's review queue. A committed submission is not");
  console.log('      a published app.');
  console.log(`   ⬜ THE API UNDERNEATH THE CLI, printed so a reader can check the transport against the`);
  console.log(`      documented calls rather than against its own output: token ${REST.tokenEndpoint} (resource`);
  console.log(`      ${REST.resource}) · submissions under ${REST.base}/applications/{applicationId}/submissions.`);
  for (const u of UNSOURCED) console.log(`   ⬜ UNSOURCED: ${u.gap}  → ${u.limb}`);
  console.log('');
  console.log(`submit-windows-store: SUBMITTED — ${app.slug} committed to the Microsoft Store for certification.`);
  return undefined;
}

await submitPath();

