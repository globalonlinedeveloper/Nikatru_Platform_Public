#!/usr/bin/env node
// assert-github-matrix — reconcile catalog/store-matrix.json against the ACTUAL GitHub org.
//
// READ-ONLY. The only thing this file does to GitHub is `gh repo list <org> --json ...`. It creates
// no repository, renames none, deletes none, and holds no code path that could. Everything it finds
// that would require a write is REPORTED, never performed.
//
// ── WHAT IT RECONCILES ──────────────────────────────────────────────────────────────────────────
//   1. declared -> real   which intended repo names exist in the org, and which do not
//   2. real -> declared   which repos the org actually holds that the registry accounts for NOWHERE
//                         (orphans), and which `outOfMatrix` lines name a repo that is not there
//   3. visibility         PUBLIC/PRIVATE as GitHub reports it, against what the registry declares
//   4. PENDING RENAME     any row whose intended repo name differs from the name GitHub has NOW,
//                         printed together with everything measurable that pins the OLD name
//   5. local -> declared   each slot directory's real `git remote get-url origin` against boundRemote
//
// ── 🔴 THE EXIT-CODE RULE, AND WHY IT IS SHAPED THIS WAY ────────────────────────────────────────
// Two kinds of wrong live in this report and they must never share a colour:
//
//   OWNER ACTION — work only the owner can do. A rename. A visibility change. Reconnecting a
//   Cloudflare Pages binding. This file has no write scope and neither should it. These PRINT, in
//   full, on EVERY run, and they DO NOT change the exit code. A build held permanently red on work
//   the build cannot do teaches every reader that red is negotiable, and once that is learned the
//   next real failure is negotiated away too. This corpus has already paid for that lesson.
//
//   FINDING — work nobody needs permission for. A malformed registry row. An orphan repo nobody
//   declared. A measured field that has gone stale. Every one of these is fixed by editing a JSON
//   file in this repository. These FAIL, exit 1, no discussion.
//
// ── 🔴 AND THE THIRD THING: COVERAGE LOST ───────────────────────────────────────────────────────
// If `gh` cannot reach GitHub — not installed, not authenticated, no network, rate-limited — this
// guard has not checked anything, and it says so and exits 2. "I could not look" is a different
// message from "it is stale" and the same colour. There is no exit-0 path that skipped the network.
//
// `--offline` deliberately skips the network limb and exits 3 — NON-ZERO, so an offline run can
// never be mistaken for a clean one, in a log, in a CI summary, or by a person in a hurry.
//
// Exit: 0 network limb RAN and no findings · 1 findings · 2 could not resolve / could not look
//       3 --offline (network limb deliberately skipped, nothing about GitHub was verified)
//       Findings dominate: --offline WITH findings exits 1, because 1 is the more actionable.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'assert-github-matrix';

// ---- argv: an unrecognised flag REFUSES ----------------------------------------------------------
// A typo'd `--ofline` that silently ran the full network limb and exited 0 would be a FALSE CLEAN,
// which is the one result this guard exists to make impossible.
// `--gh-fixture <file>` feeds this guard a `gh repo list` payload from disk instead of GitHub. It
// exists so the floors below (empty listing, truncated listing) can be PROVEN able to fire, which
// `gh` itself will never do on demand. It follows the pattern assert-store-matrix.mjs already sets
// with --projects/--registry, and it carries the same two safety properties, both mandatory:
//   · it is PRINTED, in capitals, so a fixture run cannot be mistaken in a log for a real one; and
//   · a fixture run NEVER exits 0. Not on success, not on a clean fixture, not ever. A test seam
//     that can produce the same exit code as a passing real run is a way to fake a passing real run.
// `--projects <dir>` names the store-tree anchor EXPLICITLY instead of walking up for the ancestor
// holding both Projects/ and nikatru/. It is the same override assert-store-matrix.mjs already
// carries, for the same reason and with the same safety property: it is PRINTED in capitals, and a
// path that does not exist is REFUSED (exit 2) rather than read as "no tree here".
// 🔴 IT CANNOT MANUFACTURE A PASS. It feeds LIMB 2 (local remotes) and the rename report only;
// exit 0 still requires the GitHub limb to have actually RUN. Its purpose is that this guard's own
// suite can construct its subject rather than inherit one from the developer's home directory — a
// suite whose verdict depends on the filesystem layout of the box it ran on is not a suite, which is
// the property the credential-scrubbing note below already claims and this flag makes true.
const KNOWN = new Set(['--offline', '--help', '-h', '--gh-fixture', '--projects']);
const argv = process.argv.slice(2);
const pjIdx = argv.indexOf('--projects');
const PROJECTS_OVERRIDE = pjIdx >= 0 && pjIdx + 1 < argv.length ? argv[pjIdx + 1] : null;
if (pjIdx >= 0 && !PROJECTS_OVERRIDE) {
  console.error(`${NAME}: --projects needs a directory path.`);
  process.exit(2);
}
if (PROJECTS_OVERRIDE) argv.splice(pjIdx, 2);
const fxIdx = argv.indexOf('--gh-fixture');
const GH_FIXTURE = fxIdx >= 0 && fxIdx + 1 < argv.length ? argv[fxIdx + 1] : null;
if (fxIdx >= 0 && !GH_FIXTURE) {
  console.error(`${NAME}: --gh-fixture needs a file path.`);
  process.exit(2);
}
if (GH_FIXTURE) argv.splice(fxIdx, 2);
const unknown = argv.filter((a) => !KNOWN.has(a));
if (unknown.length) {
  console.error(`${NAME}: unrecognised argument(s): ${unknown.join(' ')}`);
  console.error(`  known: ${[...KNOWN].join(' ')}`);
  console.error('  Refusing rather than running a different check than the one you asked for.');
  process.exit(2);
}
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`${NAME} — reconcile catalog/store-matrix.json against the real GitHub org (READ-ONLY).`);
  console.log('  (no flags)   full run: structure + local remotes + GitHub. Exit 0 clean, 1 findings, 2 could not look.');
  console.log('  --offline    skip the GitHub limb. ALWAYS exits non-zero (3), never mistakable for clean.');
  console.log('  --projects <dir>  name the store-tree anchor explicitly instead of walking up for it.');
  process.exit(2); // --help is not a check having passed.
}
const OFFLINE = argv.includes('--offline');

const die = (msg, extra = []) => {
  console.error(`${NAME}: ${msg}`);
  for (const e of extra) console.error(`  ${e}`);
  process.exit(2);
};

// ---- anchor: walk UP for the directory holding BOTH `Projects/` and `nikatru/`. -----------------
// Ported verbatim in spirit from tooling/scripts/spec-guards.mjs and assert-store-matrix.mjs. It
// never counts `..` levels: fifteen slots will sit at varying depths and a fixed level count is
// wrong the moment one of them moves. Not-found EXITS 2 and names every directory walked — it never
// degrades into "nothing to check here", which is how a locator turns a check into a skip.
function findAnchor(startDir) {
  const walked = [];
  let cur = startDir;
  for (;;) {
    walked.push(cur);
    if (existsSync(join(cur, 'Projects')) && existsSync(join(cur, 'nikatru'))) {
      return { root: join(cur, 'Projects'), walked };
    }
    const up = dirname(cur);
    if (up === cur) return { root: null, walked };
    cur = up;
  }
}

let PROJECTS = null;
let walked = [];
if (PROJECTS_OVERRIDE) {
  PROJECTS = resolve(PROJECTS_OVERRIDE);
  console.log(`!! --projects OVERRIDE IN USE: ${PROJECTS} — this is NOT the anchored tree.`);
  if (!existsSync(PROJECTS)) {
    die(`--projects was given ${PROJECTS}, which does not exist.`, [
      'A wrong path is a defect, not an absence, and is refused rather than read as "no tree here".',
    ]);
  }
} else {
  ({ root: PROJECTS, walked } = findAnchor(dirname(SELF)));
}
if (!PROJECTS) {
  die('ANCHOR NOT FOUND — no ancestor of this file holds both Projects/ and nikatru/.', [
    'Walked:', ...walked.map((w) => '  ' + w),
  ]);
}

const REPO_ROOT = resolve(dirname(SELF), '..', '..');
const REGISTRY = join(REPO_ROOT, 'catalog', 'store-matrix.json');
if (!existsSync(REGISTRY)) die(`REGISTRY NOT FOUND at ${REGISTRY}`);

let reg;
try {
  reg = JSON.parse(readFileSync(REGISTRY, 'utf8'));
} catch (e) {
  die(`REGISTRY UNPARSEABLE — ${e.message}`);
}
if (!Array.isArray(reg.slots) || reg.slots.length === 0) die('REGISTRY has no `slots` array, or it is empty.');

const gh = reg.github;
if (!gh || typeof gh !== 'object') {
  die('REGISTRY has no `github` block — there is no org to look in and no place a repo may be declared out of the matrix.');
}
const ORG = gh.org;
if (typeof ORG !== 'string' || !ORG.trim()) die('REGISTRY `github.org` is missing or not a non-empty string.');

// ── the two ledgers. They are never merged and never printed under one heading. ──────────────────
const findings = [];   // fixable by anyone -> exit 1
const actions = [];    // owner-only        -> printed always, exit code untouched
const notes = [];      // limbs that were genuinely not applicable HERE -> printed, never silent
const fail = (m) => findings.push(m);
const owner = (m) => actions.push(m);
const note = (m) => notes.push(m);

// ---- derivations. Same swap the whole corpus uses; defined once. ---------------------------------
const pathOf = (s) => `${s.store}/${s.target}/${s.type}`;
const privateDirOf = (s) => String(s.publicDir).replace(/_Public$/, '_Private');
const dirOf = (s, side) => (side === 'public' ? s.publicDir : privateDirOf(s));
const VIS = new Set(['PUBLIC', 'PRIVATE', 'INTERNAL']); // exactly gh's spellings — see below
const REPO_RE = /^[A-Za-z0-9._-]+$/;
const OWNER_REPO_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;
// The side a repo sits on IS the visibility it should have. Derived from the side name, never typed
// per row — a per-row copy of this would be fifteen chances to disagree with the word "Public".
const expectedVisFor = (side) => (side === 'public' ? 'PUBLIC' : 'PRIVATE');

// =================================================================================================
// LIMB 1 — STRUCTURE. Runs first, runs offline, and is the limb that FAILS.
// A malformed row is not a GitHub problem; it is a JSON problem, and nobody needs permission to fix
// one. Everything downstream derives repo NAMES from these fields, so a bad row is not a finding to
// note in passing — it is a hole in this guard's own coverage.
// =================================================================================================
const intendedOwners = new Map(); // repo name -> "path (side)" that intends it
const boundOwners = new Map();    // repo name -> "path (side)" that binds it

for (const [i, s] of reg.slots.entries()) {
  const where = `slots[${i}]`;
  for (const k of ['store', 'target', 'type', 'publicDir']) {
    if (typeof s[k] !== 'string' || !s[k].trim()) {
      fail(`${where}: \`${k}\` is missing or not a non-empty string — repo names cannot be derived from this row`);
    }
  }
  if (typeof s.publicDir !== 'string' || typeof s.target !== 'string' || typeof s.type !== 'string') continue;
  const p = pathOf(s);

  // Precondition for THIS guard's derivation, not a second home for the naming rule:
  // assert-store-matrix.mjs owns `Nikatru_<target>_<type>_Public`. Checked here because without the
  // _Public suffix the _Private name cannot be derived and half this reconciliation silently vanishes.
  if (!/_Public$/.test(s.publicDir)) {
    fail(`${p}: publicDir "${s.publicDir}" has no _Public suffix, so the private repo name cannot be derived — this row would be reconciled HALF-BLIND`);
    continue;
  }

  const repos = s.repos;
  if (!repos || typeof repos !== 'object') { fail(`${p}: \`repos\` is missing or not an object`); continue; }

  for (const side of ['public', 'private']) {
    const rec = repos[side];
    const at = `${p} ${side}`;
    if (!rec || typeof rec !== 'object') { fail(`${at}: \`repos.${side}\` is missing or not an object`); continue; }

    if (typeof rec.existsOnGitHub !== 'boolean') {
      fail(`${at}: repos.${side}.existsOnGitHub is ${JSON.stringify(rec.existsOnGitHub)}, must be a boolean`);
    }
    const vis = rec.visibility ?? null;
    if (vis !== null && !VIS.has(vis)) {
      // Spelling matters and is not cosmetic: assert-store-matrix.mjs compares this field to gh's
      // output with ===. Constraining it to gh's exact spellings is what keeps the two guards from
      // disagreeing about the same field.
      fail(`${at}: repos.${side}.visibility is ${JSON.stringify(rec.visibility)}, must be null or one of ${[...VIS].join('/')} (gh's exact spellings — assert-store-matrix.mjs compares this with ===)`);
    }

    const dir = dirOf(s, side);
    if (!REPO_RE.test(dir)) fail(`${at}: derived repo name "${dir}" is not a legal GitHub repo name`);
    if (intendedOwners.has(dir)) fail(`${at}: intended repo name "${dir}" is ALSO intended by ${intendedOwners.get(dir)} — two rows cannot own one name`);
    else intendedOwners.set(dir, at);

    const br = rec.boundRemote ?? null;
    if (br !== null) {
      if (typeof br !== 'string' || !OWNER_REPO_RE.test(br)) {
        fail(`${at}: repos.${side}.boundRemote is ${JSON.stringify(br)}, must be null or an "owner/repo" string`);
      } else {
        const [, o, r] = br.match(OWNER_REPO_RE);
        if (o !== ORG) {
          // Not a stylistic complaint. `gh repo list <org>` is this guard's ONLY window; a
          // boundRemote outside that org is a binding this run cannot see, and reporting it as
          // checked would be a lie by omission.
          fail(`${at}: boundRemote "${br}" is owned by "${o}", not the declared org "${ORG}" — this guard looks only in ${ORG} and CANNOT reconcile it`);
        }
        if (boundOwners.has(r)) fail(`${at}: boundRemote "${r}" is ALSO bound by ${boundOwners.get(r)} — one repo cannot back two slot sides`);
        else boundOwners.set(r, at);
      }
    }
  }
}

// ---- the github block's own shape ---------------------------------------------------------------
if (!Array.isArray(gh.outOfMatrix)) {
  fail('github.outOfMatrix is missing or not an array — with no declaration surface, EVERY repo in the org reads as an orphan');
}
const outOfMatrix = new Map();
for (const [i, e] of (Array.isArray(gh.outOfMatrix) ? gh.outOfMatrix : []).entries()) {
  const at = `github.outOfMatrix[${i}]`;
  if (!e || typeof e !== 'object' || typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) {
    fail(`${at}: \`repo\` is missing or is not a legal repo name`);
    continue;
  }
  for (const k of ['why', 'measured']) {
    if (typeof e[k] !== 'string' || !e[k].trim()) {
      fail(`${at} (${e.repo}): \`${k}\` is missing or empty — an allow-list entry that does not say what it is for is a place to silence findings`);
    }
  }
  if (outOfMatrix.has(e.repo)) fail(`${at}: "${e.repo}" is declared out-of-matrix twice`);
  else outOfMatrix.set(e.repo, e);

  // github.accountingRule says EXACTLY ONE. Double-declaration is the shape where a repo looks
  // accounted for from either end while nobody actually owns it.
  if (intendedOwners.has(e.repo)) fail(`${at}: "${e.repo}" is declared out-of-matrix AND is the intended repo name of ${intendedOwners.get(e.repo)} — accountingRule says EXACTLY ONE`);
  if (boundOwners.has(e.repo)) fail(`${at}: "${e.repo}" is declared out-of-matrix AND is the boundRemote of ${boundOwners.get(e.repo)} — accountingRule says EXACTLY ONE`);
}

const pins = gh.renamePins;
if (!pins || typeof pins !== 'object') {
  fail('github.renamePins is missing — a rename would then be reported with nothing named as depending on the old name, which is worse than not reporting it');
}
const pinsObservable = Array.isArray(pins?.observable) ? pins.observable : [];
const pinsUnobservable = Array.isArray(pins?.unobservable) ? pins.unobservable : [];
if (pins && !Array.isArray(pins.observable)) fail('github.renamePins.observable is missing or not an array');
if (pins && !Array.isArray(pins.unobservable)) fail('github.renamePins.unobservable is missing or not an array');
if (pins && Array.isArray(pins.unobservable) && pins.unobservable.length === 0) {
  // Measured fact, not an opinion: the Cloudflare Pages binding lives in a dashboard and nothing in
  // this tree can read it. A renamePins block claiming everything is observable is claiming a
  // coverage this repository does not have.
  fail('github.renamePins.unobservable is EMPTY — at least the Cloudflare Pages binding is unobservable from here, and an empty list claims a coverage this tree does not have');
}
for (const [i, e] of pinsObservable.entries()) {
  const at = `github.renamePins.observable[${i}]`;
  for (const k of ['id', 'repoDir', 'path', 'matchField', 'why']) {
    if (typeof e?.[k] !== 'string' || !e[k].trim()) fail(`${at}: \`${k}\` is missing or empty`);
  }
}
for (const [i, e] of pinsUnobservable.entries()) {
  const at = `github.renamePins.unobservable[${i}]`;
  for (const k of ['id', 'what', 'why', 'notMeasured']) {
    if (typeof e?.[k] !== 'string' || !e[k].trim()) fail(`${at}: \`${k}\` is missing or empty`);
  }
}

// =================================================================================================
// LIMB 1b — ONE FACT, ONE PLACE: the org name.
//
// `github.org` is the declaration. Any OTHER script in this repo that asks GitHub about this org
// holds a second copy of that fact, and the second copy is the one that goes stale — change the org
// in the registry and a hardcoded literal keeps confidently querying the old one, which answers
// "no such repo" for everything and reads exactly like an unbuilt matrix.
//
// The duplicate is not always removable: sibling guards are edited by other sessions and taking
// ownership of their source is a race. So where the copy cannot be deleted, it is CHECKED. A file
// that shells out to `gh repo list` must either READ `github.org` from the registry, or spell the
// declared org exactly. Neither is true => the two copies have already disagreed.
//
// The file list is DERIVED (every .mjs under tooling/ci and tooling/scripts), never typed, so a new
// script that queries GitHub is covered the day it lands rather than the day someone remembers it.
// =================================================================================================
{
  const scanDirs = [join(REPO_ROOT, 'tooling', 'ci'), join(REPO_ROOT, 'tooling', 'scripts')];
  const GH_LIST = /gh\s+repo\s+list|['"]repo['"]\s*,\s*['"]list['"]/;
  const READS_REGISTRY = /github\s*\??\.\s*org/;
  let scannedFiles = 0;
  let queriers = 0;
  for (const d of scanDirs) {
    if (!existsSync(d)) { note(`org-literal limb: ${d} is not present — NOT SCANNED`); continue; }
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.mjs')) continue;
      const abs = join(d, f.name);
      if (abs === SELF) continue; // this file reads github.org by construction
      let src;
      try { src = readFileSync(abs, 'utf8'); } catch { continue; }
      scannedFiles++;
      if (!GH_LIST.test(src)) continue;
      queriers++;
      if (READS_REGISTRY.test(src)) continue;
      if (src.includes(ORG)) {
        // A literal copy that currently AGREES. Not a failure — but it is a second copy of a fact,
        // and saying so on every run is the only thing that keeps it from being forgotten.
        note(`org name is DUPLICATED as a literal in tooling/${d.endsWith('scripts') ? 'scripts' : 'ci'}/${f.name} — it queries \`gh repo list\` without reading github.org. It agrees with the registry TODAY; nothing but this line will notice the day it stops.`);
      } else {
        fail(`tooling/${d.endsWith('scripts') ? 'scripts' : 'ci'}/${f.name} queries \`gh repo list\` but neither reads \`github.org\` from the registry nor contains the declared org "${ORG}" — the two copies of the org name have DISAGREED. Editing one file fixes it; nobody needs permission.`);
      }
    }
  }
  note(`org-literal limb: ${scannedFiles} tooling script(s) scanned, ${queriers} of them query \`gh repo list\`.`);
}

// =================================================================================================
// LIMB 2 — LOCAL. The slot directory's REAL git remote against what the registry declares.
//
// 🔴 THE TWO ABSENCES ARE ANSWERED BY TWO DIFFERENT TESTS, ON PURPOSE (STORE-MATRIX-PLAN.md 4.3).
//   absent because THIS CHECKOUT does not contain it — a CI checkout holds one repo, never thirty —
//     PRINTS what it could not reach and does not fail. That limb is genuinely not applicable here.
//   present but DISAGREEING with the declaration — a tree with no .git that declares a boundRemote,
//     an origin pointing somewhere else — FAILS. The registry has gone stale and a JSON edit fixes it.
// One cheap test answering both is how spec-guards.mjs once declared seven guards not-applicable BY
// NAME and exited 0: every printed word true, the conclusion false.
// =================================================================================================
const normaliseRemote = (url) => {
  let u = String(url).trim().replace(/\.git$/, '');
  let m = u.match(/^https?:\/\/(?:[^@/]+@)?github\.com\/(.+)$/i) || u.match(/^git@github\.com:(.+)$/i)
    || u.match(/^ssh:\/\/git@github\.com\/(.+)$/i);
  return m ? { host: 'github.com', slug: m[1] } : { host: null, slug: null, raw: u };
};

let localCompared = 0;
let localUnreachable = 0;
for (const s of reg.slots) {
  if (typeof s.publicDir !== 'string' || !/_Public$/.test(s.publicDir)) continue;
  const p = pathOf(s);
  for (const side of ['public', 'private']) {
    const rec = s.repos?.[side];
    if (!rec || typeof rec !== 'object') continue;
    const declared = typeof rec.boundRemote === 'string' ? rec.boundRemote : null;
    const abs = join(PROJECTS, s.store, s.target, s.type, dirOf(s, side));

    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      localUnreachable++;
      note(`${p} ${side}: slot directory NOT PRESENT in this checkout — local remote NOT compared (${dirOf(s, side)}). Existence of slot directories is assert-store-matrix.mjs's check, not this one.`);
      continue;
    }
    if (!existsSync(join(abs, '.git'))) {
      if (declared !== null) {
        fail(`${p} ${side}: registry declares boundRemote "${declared}" but the directory on disk has NO .git — a tree with no git cannot have a remote`);
      }
      localCompared++;
      continue;
    }
    let url = null;
    try {
      url = execFileSync('git', ['-C', abs, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch {
      url = null; // no `origin` configured — a real, measured state, not an error
    }
    localCompared++;
    if (url === null) {
      if (declared !== null) fail(`${p} ${side}: registry declares boundRemote "${declared}" but the checkout has NO \`origin\` remote`);
      continue;
    }
    const { slug, raw } = normaliseRemote(url);
    if (!slug) {
      fail(`${p} ${side}: origin is "${raw}", which this guard cannot read as a github.com owner/repo — it cannot be reconciled and is not being silently passed`);
      continue;
    }
    if (declared === null) fail(`${p} ${side}: registry declares boundRemote null but the checkout's origin is "${slug}"`);
    else if (declared !== slug) fail(`${p} ${side}: registry declares boundRemote "${declared}" but the checkout's origin is "${slug}"`);
  }
}

// =================================================================================================
// The rename dependency report. Derived, never typed: the count of pinning entries is obtained by
// OPENING the pinned file, and the in-repo occurrences by grepping. A number typed here would be a
// second copy of a fact, and the copy is the one that goes stale.
// =================================================================================================
function reportOldNameDependents(oldName, indent = '   ') {
  const I = indent;
  const out = [];
  const full = `${ORG}/${oldName}`;
  out.push(`${I}WHAT PINS THE OLD NAME "${full}". Every one of these must be repointed BEFORE the rename,`);
  out.push(`${I}not after — see the byte-compare caveat below.`);
  out.push('');

  let n = 0;

  // (1) The pins nothing here can read. Printed FIRST and printed EVERY time: an unreadable pin is
  //     the one most likely to be forgotten precisely because no run ever mentions it otherwise.
  for (const e of pinsUnobservable) {
    n++;
    out.push(`${I}${n}. ${e.what}`);
    out.push(`${I}   NOT OBSERVABLE FROM HERE. ${e.why}`);
    out.push(`${I}   NOT MEASURED: ${e.notMeasured}`);
    out.push('');
  }

  // (2) The declared, readable pins — counted by opening the file.
  for (const e of pinsObservable) {
    n++;
    const repoAbs = join(PROJECTS, ...String(e.repoDir).split('/'));
    const fileAbs = join(repoAbs, ...String(e.path).split('/'));
    out.push(`${I}${n}. ${e.repoDir}/${e.path}`);

    // 🔴 THE TWO ABSENCES, AND WHY BOTH OF THEM REFUSE HERE.
    // The obvious design is "sibling repo missing => not in this checkout => print and carry on".
    // That is WRONG in this guard, and the reason is the anchor: reaching this line at all required
    // an ancestor holding BOTH `Projects/` and `nikatru/`. A CI checkout holds one repo and neither
    // marker, so it never gets here — it exits 2 at the anchor. Therefore, if we ARE here, the store
    // tree IS present, and a declared repoDir that is not in it is a WRONG PATH, not a thin checkout.
    // Excusing it as "not applicable" would be the exact shape spec-guards.mjs was bitten by: seven
    // guards declared not-applicable BY NAME, every printed word true, the conclusion false — and
    // here the false conclusion would be a rename reported with an understated blast radius.
    if (!existsSync(repoAbs)) {
      die(`renamePins.observable[${e.id}] declares repoDir "${e.repoDir}", and it is NOT in the anchored store tree.`, [
        `Looked in: ${repoAbs}`,
        `The anchor resolved (${PROJECTS}), so the store tree IS present and this is a WRONG PATH,`,
        'not a checkout that happens to lack a sibling. A thin checkout cannot reach this line: it',
        'fails the anchor first.',
        'Refusing rather than reporting a rename whose blast radius was silently under-counted.',
      ]);
    }
    if (!existsSync(fileAbs)) {
      die(`renamePins.observable[${e.id}] declares ${e.repoDir}/${e.path}, the repo IS present at ${repoAbs}, and the file IS NOT THERE.`, [
        'That is a declaration pointing at nothing, not a checkout that lacks a sibling.',
        'Refusing rather than reporting a rename with an unknown blast radius.',
      ]);
    }
    let data;
    try {
      data = JSON.parse(readFileSync(fileAbs, 'utf8'));
    } catch (err) {
      die(`renamePins.observable[${e.id}]: ${e.repoDir}/${e.path} is UNPARSEABLE — ${err.message}`, [
        'The pinning entries cannot be counted, so the rename report would understate its own blast radius.',
      ]);
    }
    if (!Array.isArray(data)) {
      die(`renamePins.observable[${e.id}]: ${e.repoDir}/${e.path} is not the declared shape (top-level array).`);
    }
    const hits = data.filter((row) => typeof row?.[e.matchField] === 'string' && row[e.matchField] === full);
    out.push(`${I}   ${hits.length} of ${data.length} entr${data.length === 1 ? 'y' : 'ies'} pin it by \`${e.matchField}\` (counted by opening the file, never typed):`);
    for (const h of hits) {
      const bits = [h.category, h.path, h.state].filter((x) => typeof x === 'string');
      out.push(`${I}     - ${bits.join('  ·  ') || JSON.stringify(h[e.matchField])}`);
    }
    out.push(`${I}   byte-compared by ${e.byteComparedBy ?? '(not declared)'}`);
    out.push(`${I}   ${e.why}`);
    if (e.renameRedirectCaveat) out.push(`${I}   CAVEAT: ${e.renameRedirectCaveat}`);
    out.push('');
  }

  // (3) Textual occurrences, MEASURED. Nothing in the registry lists these; grep finds them, so the
  //     report cannot fall behind the tree the way a hand-maintained list would.
  n++;
  out.push(`${I}${n}. Literal "${full}" occurrences in the trees this run can actually see:`);
  const scanDirs = [['(this repo)', REPO_ROOT], ...pinsObservable.map((e) => [e.repoDir, join(PROJECTS, ...String(e.repoDir).split('/'))])];
  for (const [label, abs] of scanDirs) {
    if (!existsSync(join(abs, '.git'))) {
      out.push(`${I}   ${label}: not a git checkout here — NOT SCANNED (this is a limb that did not run, not a clean result)`);
      continue;
    }
    let lines = [];
    let scanned = true;
    try {
      const res = execFileSync('git', ['-C', abs, 'grep', '-n', '-I', '-F', full], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      lines = res.split('\n').filter(Boolean);
    } catch (err) {
      // git grep exits 1 for "no matches" — a real answer. Anything else is a failed scan.
      if (err.status === 1) lines = [];
      else scanned = false;
    }
    if (!scanned) {
      out.push(`${I}   ${label}: git grep FAILED — occurrences NOT counted here.`);
      continue;
    }
    const files = new Map();
    for (const l of lines) {
      const f = l.slice(0, l.indexOf(':'));
      files.set(f, (files.get(f) ?? 0) + 1);
    }
    out.push(`${I}   ${label}: ${lines.length} line(s) across ${files.size} tracked file(s)`);
    for (const [f, c] of [...files].sort((a, b) => b[1] - a[1])) out.push(`${I}     ${String(c).padStart(4)}  ${f}`);
  }
  out.push('');
  out.push(`${I}Nothing in this file renames anything. This is a report.`);
  return out.join('\n');
}

// =================================================================================================
// LIMB 3 — GITHUB. Opt-in only in the sense that --offline opts OUT, and opting out is non-zero.
// =================================================================================================
let ranGitHub = false;
if (!OFFLINE) {
  const LIMIT = 1000;
  let raw;
  if (GH_FIXTURE) {
    console.log(`!! --gh-fixture IN USE: ${GH_FIXTURE}`);
    console.log('!! THIS RUN DID NOT TALK TO GITHUB. Nothing it prints is a statement about the real org.');
    console.log('!! A fixture run cannot exit 0 — see the exit line at the end.');
    if (!existsSync(GH_FIXTURE)) die(`--gh-fixture ${GH_FIXTURE} does not exist.`);
    raw = readFileSync(GH_FIXTURE, 'utf8');
  } else {
    try {
      raw = execFileSync('gh', ['repo', 'list', ORG, '--limit', String(LIMIT), '--json', 'name,visibility,isArchived'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const first = String(e.stderr || e.message || '').split('\n').filter(Boolean)[0] || String(e.message);
      die('COVERAGE LOST — `gh repo list` could not look at GitHub.', [
        first,
        'Nothing about the org was verified on this run.',
        '"I could not look" is a DIFFERENT MESSAGE from "it is stale", and the SAME COLOUR.',
        'There is no exit-0 path through this guard that skipped the network.',
      ]);
    }
  }
  let list;
  try {
    list = JSON.parse(raw);
  } catch (e) {
    die(`COVERAGE LOST — \`gh repo list\` returned output this guard cannot parse: ${e.message}`);
  }
  if (!Array.isArray(list)) die('COVERAGE LOST — `gh repo list` did not return a JSON array.');
  // 🔴 THE FLOOR, AND IT IS THE POINT RATHER THAN A DETAIL.
  // An empty listing satisfies every assertion below VACUOUSLY: no repo exists, so every
  // `existsOnGitHub: false` agrees; no repo is unaccounted for, so there are no orphans; and the run
  // prints ok having verified nothing. That is not a hypothetical — a token whose `repo` scope has
  // lapsed returns exactly this, successfully, with exit 0. An org that genuinely holds nothing
  // cannot be reconciled against a registry that names real bound remotes either way.
  if (list.length === 0) {
    die(`COVERAGE LOST — \`gh repo list ${ORG}\` returned ZERO repositories.`, [
      'Every check below would pass vacuously against an empty listing and this run would print ok',
      'having verified nothing. The usual cause is a token that can no longer see the org, which',
      'succeeds and returns [] rather than failing.',
      'Refusing. "The org is empty" is not a conclusion this guard is willing to reach quietly.',
    ]);
  }
  if (list.length >= LIMIT) {
    // Orphan detection is a claim about the WHOLE org. A truncated listing cannot support it, and a
    // truncated listing that reported "no orphans" would be the exact false clean this guard forbids.
    die(`COVERAGE LOST — \`gh repo list\` returned ${list.length} repos, at or above the --limit of ${LIMIT}.`, [
      'The listing may be truncated, so "no orphans" could not be honestly concluded from it.',
      'Raise the limit in this file and re-run.',
    ]);
  }
  ranGitHub = true;

  const have = new Map(list.map((r) => [r.name, r]));

  // ---- declared -> real, per slot side -----------------------------------------------------------
  for (const s of reg.slots) {
    if (typeof s.publicDir !== 'string' || !/_Public$/.test(s.publicDir)) continue;
    const p = pathOf(s);
    for (const side of ['public', 'private']) {
      const rec = s.repos?.[side];
      if (!rec || typeof rec !== 'object') continue;
      const intended = dirOf(s, side);
      const at = `${p} ${side}`;

      const real = have.get(intended) ?? null;
      const exists = real !== null;
      if (rec.existsOnGitHub !== exists) {
        fail(`${at}: repos.${side}.existsOnGitHub says ${rec.existsOnGitHub}, GitHub says ${exists} for "${intended}" — a measured field that has gone stale; editing it needs nobody's permission`);
      }
      const declaredVis = rec.visibility ?? null;
      const actualVis = exists ? real.visibility : null;
      if (declaredVis !== actualVis) {
        fail(`${at}: repos.${side}.visibility says ${JSON.stringify(declaredVis)}, GitHub says ${JSON.stringify(actualVis)} for "${intended}"`);
      }
      if (exists && real.isArchived) {
        owner(`${at}: "${intended}" exists and is ARCHIVED on GitHub. An archived repo accepts no pushes; unarchiving is a GitHub-side change only the owner can make.`);
      }

      // ---- PENDING RENAME ------------------------------------------------------------------------
      const br = typeof rec.boundRemote === 'string' && OWNER_REPO_RE.test(rec.boundRemote) ? rec.boundRemote : null;
      if (!br) continue;
      const boundName = br.split('/')[1];
      const boundReal = have.get(boundName) ?? null;

      if (!boundReal) {
        owner(`${at}: boundRemote "${br}" DOES NOT EXIST in org ${ORG}. Either it was renamed or deleted on GitHub, or the binding is wrong. Resolving it is a GitHub-side decision; this guard will not guess which.`);
        continue;
      }
      if (boundName !== intended) {
        const banner = [
          `${at}: PENDING RENAME.`,
          `   registry intends : ${intended}`,
          `   GitHub has NOW   : ${boundName}  (${boundReal.visibility}${boundReal.isArchived ? ', ARCHIVED' : ''})`,
          `   The rename is the OWNER'S and nothing here can perform it — this file holds no write path`,
          `   to GitHub. Until the owner does it, this prints on EVERY run and the build stays GREEN,`,
          `   because a build held red on work the build cannot do teaches everyone that red is negotiable.`,
          '',
          reportOldNameDependents(boundName),
        ].join('\n');
        owner(banner);
      }
      const wantVis = expectedVisFor(side);
      if (boundReal.visibility !== wantVis) {
        owner(`${at}: boundRemote "${br}" is ${boundReal.visibility} on GitHub, but it backs the ${side.toUpperCase()} side of this slot, which means ${wantVis}. Changing repository visibility is a GitHub-side change only the owner can make.`);
      }
      if (boundReal.isArchived) {
        owner(`${at}: boundRemote "${br}" is ARCHIVED on GitHub.`);
      }
    }
  }

  // ---- real -> declared: orphans, and stale out-of-matrix lines -----------------------------------
  // github.accountingRule: every repo the org holds is accounted for by an intended name, a
  // boundRemote, or an outOfMatrix line. Anything else is an ORPHAN and FAILS — the fix is one line
  // in catalog/store-matrix.json and needs nobody's permission, which is exactly why it is red.
  const accounted = new Set([...intendedOwners.keys(), ...boundOwners.keys(), ...outOfMatrix.keys()]);
  const orphans = list.map((r) => r).filter((r) => !accounted.has(r.name));
  for (const r of orphans) {
    fail(`ORPHAN — org ${ORG} holds "${r.name}" (${r.visibility}${r.isArchived ? ', ARCHIVED' : ''}) and catalog/store-matrix.json accounts for it NOWHERE: it is no row's intended name, no row's boundRemote, and no github.outOfMatrix entry. Declare it or file it. Nobody needs permission to add that line.`);
  }
  for (const [name] of outOfMatrix) {
    if (!have.has(name)) {
      fail(`STALE DECLARATION — github.outOfMatrix names "${name}", and org ${ORG} does not hold it. Deleting a line needs nobody's permission either.`);
    }
  }

  // Unbound-but-existing intended names are worth saying out loud without being a failure.
  for (const [name, at] of intendedOwners) {
    if (have.has(name) && !boundOwners.has(name)) {
      note(`"${name}" exists in ${ORG} and is the intended name of ${at}, but no row binds it as a boundRemote — the repo exists ahead of the tree.`);
    }
  }
} else {
  note('GitHub limb SKIPPED — --offline was passed. NOTHING about the org was verified: not existence, not visibility, not orphans, not renames.');
}

// =================================================================================================
// REPORT
// =================================================================================================
console.log(`${NAME} — catalog/store-matrix.json  vs  github.com/${ORG}   (READ-ONLY: gh repo list)`);
console.log(`  anchor   ${PROJECTS}`);
console.log(`  registry ${REGISTRY}`);
console.log(`  rows ${reg.slots.length} · intended repo names ${intendedOwners.size} · bound remotes ${boundOwners.size} · declared out-of-matrix ${outOfMatrix.size}`);
console.log(`  local remotes compared ${localCompared} · slot directories not in this checkout ${localUnreachable}`);
console.log(`  github limb ${ranGitHub ? 'RAN' : 'DID NOT RUN'}`);
console.log('');

if (notes.length) {
  console.log(`NOT CHECKED HERE — ${notes.length} limb(s) that did not run on this checkout. Printed because silence is not success:`);
  for (const n of notes) console.log(`  · ${n}`);
  console.log('');
}

if (actions.length) {
  console.log('='.repeat(96));
  console.log(`ACTION NEEDED — OWNER ONLY. ${actions.length} item(s). These DO NOT fail this build.`);
  console.log('Nothing below can be done by this repository, by CI, or by this guard. Every one of them');
  console.log('requires a change made by the owner outside git. They print on every run until they are done.');
  console.log('='.repeat(96));
  for (const a of actions) {
    console.log('');
    console.log(`  ${a.split('\n').join('\n  ')}`);
  }
  console.log('');
}

let exit = 0;
if (findings.length) {
  console.error(`${NAME}: ${findings.length} FINDING(S) — every one is fixable by editing this repository. No permission required, so these are RED.`);
  for (const f of findings) console.error(`  - ${f}`);
  exit = 1;
} else if (GH_FIXTURE) {
  console.error(`${NAME}: --gh-fixture was used, so the org was NOT looked at. No findings, but this is NOT a pass.`);
  console.error('  Exiting 4 — a fixture run is structurally incapable of exiting 0.');
  exit = 4;
} else if (OFFLINE) {
  console.error(`${NAME}: --offline. The GitHub limb did not run, so this run verified NOTHING about the org.`);
  console.error('  Exiting 3 — NON-ZERO ON PURPOSE, so an offline run can never be read as a clean one.');
  exit = 3;
} else {
  console.log(`${NAME}: ok — registry and org reconcile. ${actions.length} owner action(s) outstanding and printed above.`);
  exit = 0;
}
process.exit(exit);
