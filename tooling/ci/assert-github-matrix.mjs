#!/usr/bin/env node
// assert-github-matrix — reconcile tooling/github-org.json against the ACTUAL GitHub org.
//
// READ-ONLY. The only thing this file does to GitHub is `gh repo list <org> --json ...`. It creates
// no repository, renames none, deletes none, and holds no code path that could. Everything it finds
// that would require a write is REPORTED, never performed.
//
// ⏱ 2026-09-25 — RE-KEYED (O-STORE-MATRIX-IS-A-DEAD-DECLARATION). It read the `github` block of the
// store matrix, a register of store slots reduced to one row on 2026-08-19 and read by nothing but
// its own guards. The matrix and those guards were retired; the GitHub facts moved to
// tooling/github-org.json, and this guard now reads that file and tooling/dead-repos.json only.
// The accounting rule is now "every repo the org holds is a `platform` entry, its bound remote, or
// an `otherRepos` entry" — a name recorded DEAD is not an accounting surface, so a dead name the
// org holds again is still an ORPHAN, and its message names the death record.
//
// ── WHAT IT RECONCILES ──────────────────────────────────────────────────────────────────────────
//   1. declared -> real   every `platform` and `otherRepos` entry names a repo the org holds
//   2. real -> declared   which repos the org actually holds that the registry accounts for NOWHERE
//                         (orphans), and which declared names the org does not hold (stale lines)
//   3. visibility         PUBLIC/PRIVATE as GitHub reports it, against what the registry declares
//   4. PENDING RENAME     any entry whose checkout is bound to a name other than its `repo`,
//                         printed together with everything measurable that pins the OLD name
//   5. local -> declared   each checkout's real `git remote get-url origin` against boundRemote
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

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
/* 🔴 2026-09-07 — THE TWO `git` READS BELOW ARE POINTED AT OTHER REPOSITORIES: the
   checkouts under the products root, one per `platform` entry. `-C` does not select
   a repository when the caller environment carries `GIT_DIR`, `GIT_INDEX_FILE` or any
   of the four siblings, all of which git exports into a hook process — measured this
   day on `tooling/scripts/assert-public-citations.mjs`, which enumerated the private
   corpus 567 files while pointed at this tree 2022. Under such an environment the
   `origin` read here would answer with THIS checkout remote for every checkout, and every
   entry would reconcile against the wrong repository while printing its name. This
   guard has no hook path today, so it was correct by coincidence; `repoGitRaw` deletes
   the six variables from the child environment and proves each checkout directory is a
   repository ROOT before reading it. */
import { repoGitRaw, RepoGitError } from '../scripts/repo-git.mjs';
// 2026-08-18: this guard's ONLY directory listing is of tooling/ci and tooling/scripts, which are
// directories of THIS repository, so it imports `listDir` and nothing else. It deliberately does NOT
// import `listCheckoutsAcrossWorkspace`: that primitive is for the guards whose subject is the
// checkouts spread across the workspace, and this file never enumerates those — it derives each path
// from tooling/github-org.json (LIMB 2, `join(PROJECTS, e.checkout)`) and tests it with existsSync,
// which visits a path somebody already declared rather than choosing what to visit. There is therefore
// NO boundary-crossing call site in this file, and no dated exemption comment below, because writing
// one would claim a crossing that does not happen — prose satisfying a rule instead of code obeying it.
import { listDir } from './tree-walk.mjs';
// 2026-08-21: LIMB 1b matched its regex against RAW source and so counted prose ABOUT `gh repo list`
// as an execution of it. `stripSourceComments` blanks comment spans to spaces, newlines kept, so
// offsets and line numbers survive; string literals pass through VERBATIM, which is load-bearing here
// and is argued at the call site. Nothing else in this file reads source text, so this import has
// exactly one consumer by design.
// ⚠️ CORRECTED THE SAME DAY, and recorded rather than quietly swapped: this line first imported
// a differently-shaped strip helper from a SECOND stripper module written earlier in this same
// session. Neither the module nor its export is named here, and the export is the half that was
// missed on the first correction: a symbol that exists nowhere is as dangling as a filename. That module
// has been DELETED, and is not named here because a comment naming a module that does not exist is
// worse than no comment. text-reductions.mjs had been this corpus's shared stripper since 2026-08-02
// and covers more extensions (.sql, .jsonc, .kts among them, which the deleted one returned
// verbatim); keeping both would have left TWO shared strippers to drift apart, which is the
// duplication this repository names as its cardinal defect. Same properties, one home.
import { stripSourceComments } from './text-reductions.mjs';
// 🔴 2026-09-19 — MISSING SINCE #695 (c886f24e), which bounded the `gh repo list` call below and
// never imported the bound. Every NO-FLAG run died `ReferenceError: boundedSpawn is not defined`
// — exit 1, a FINDING's number, for a guard that had looked at nothing. Unseen because every case
// in its suite was --offline or --gh-fixture; the stubbed-gh cases now run the no-flag path.
import { boundedSpawn, timeoutFromEnv } from './bounded-spawn.mjs';

const SELF = fileURLToPath(import.meta.url);
const NAME = 'assert-github-matrix';

// ---- argv: an unrecognised flag REFUSES ----------------------------------------------------------
// A typo'd `--ofline` that silently ran the full network limb and exited 0 would be a FALSE CLEAN,
// which is the one result this guard exists to make impossible.
// `--gh-fixture <file>` feeds this guard a `gh repo list` payload from disk instead of GitHub. It
// exists so the floors below (empty listing, truncated listing) can be PROVEN able to fire, which
// `gh` itself will never do on demand. It carries two safety properties, both mandatory:
//   · it is PRINTED, in capitals, so a fixture run cannot be mistaken in a log for a real one; and
//   · a fixture run NEVER exits 0. Not on success, not on a clean fixture, not ever. A test seam
//     that can produce the same exit code as a passing real run is a way to fake a passing real run.
// `--projects <dir>` names the store-tree anchor EXPLICITLY instead of walking up for the ancestor
// holding both Projects/ and nikatru/, with the same safety property as the fixture seam: it is
// PRINTED in capitals, and a path that does not exist is REFUSED (exit 2) rather than read as "no
// tree here".
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
  console.log(`${NAME} — reconcile tooling/github-org.json against the real GitHub org (READ-ONLY).`);
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
// Ported verbatim in spirit from tooling/scripts/spec-guards.mjs. It never counts `..` levels:
// checkouts have sat at varying depths and a fixed level count is wrong the moment one of them
// moves. Not-found EXITS 2 and names every directory walked — it never
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
const REGISTRY = join(REPO_ROOT, 'tooling', 'github-org.json');
if (!existsSync(REGISTRY)) die(`REGISTRY NOT FOUND at ${REGISTRY}`);

// `github` is the parsed tooling/github-org.json. The name is load-bearing for LIMB 1b below: a
// script that asks GitHub about the org must READ `github.org`, and this file does exactly that.
let github;
try {
  github = JSON.parse(readFileSync(REGISTRY, 'utf8'));
} catch (e) {
  die(`REGISTRY UNPARSEABLE — ${e.message}`);
}
if (!github || typeof github !== 'object' || Array.isArray(github)) die('REGISTRY is not a JSON object.');
if (!Array.isArray(github.platform) || github.platform.length === 0) {
  die('REGISTRY has no `platform` array, or it is empty — there is no repository this platform is built from to reconcile.');
}
const ORG = github.org;
if (typeof ORG !== 'string' || !ORG.trim()) die('REGISTRY `org` is missing or not a non-empty string.');

// ---- the dead names. tooling/dead-repos.json is NOT an accounting surface (see the orphan limb):
// it is read so an orphan that carries a dead name says so, because a dead name the org holds again
// is a RE-CLAIMED name, which is louder than a new one. Unreadable is a refusal, not an empty list.
const DEAD_REPOS = join(REPO_ROOT, 'tooling', 'dead-repos.json');
let dead;
try {
  dead = JSON.parse(readFileSync(DEAD_REPOS, 'utf8'));
} catch (e) {
  die(`DEAD-REPO LIST UNREADABLE at ${DEAD_REPOS} — ${e.message}`);
}
if (!Array.isArray(dead?.repos) || dead.repos.length === 0) {
  die(`DEAD-REPO LIST at ${DEAD_REPOS} has no \`repos\` array, or it is empty — an orphan carrying a dead name would read as a new one.`);
}
const deadByName = new Map(dead.repos.filter((d) => typeof d?.name === 'string').map((d) => [d.name, d]));

// ── the two ledgers. They are never merged and never printed under one heading. ──────────────────
const findings = [];   // fixable by anyone -> exit 1
const actions = [];    // owner-only        -> printed always, exit code untouched
const notes = [];      // limbs that were genuinely not applicable HERE -> printed, never silent
const fail = (m) => findings.push(m);
const owner = (m) => actions.push(m);
const note = (m) => notes.push(m);

// ---- shapes. gh's exact spellings; defined once. -------------------------------------------------
const VIS = new Set(['PUBLIC', 'PRIVATE', 'INTERNAL']); // exactly gh's spellings — see below
const REPO_RE = /^[A-Za-z0-9._-]+$/;
const OWNER_REPO_RE = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;
const platform = github.platform;
const whereOf = (e, i) => `platform[${i}]${typeof e?.repo === 'string' ? ` (${e.repo})` : ''}`;

// =================================================================================================
// LIMB 1 — STRUCTURE. Runs first, runs offline, and is the limb that FAILS.
// A malformed entry is not a GitHub problem; it is a JSON problem, and nobody needs permission to fix
// one. Everything downstream reads repo NAMES from these fields, so a bad entry is not a finding to
// note in passing — it is a hole in this guard's own coverage.
// =================================================================================================
const platformOwners = new Map(); // repo name -> "platform[i]" that declares it
const boundOwners = new Map();    // repo name -> "platform[i]" whose checkout is bound to it

for (const [i, e] of platform.entries()) {
  const where = whereOf(e, i);
  if (!e || typeof e !== 'object') { fail(`${where}: not an object`); continue; }
  if (typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) {
    fail(`${where}: \`repo\` is missing or is not a legal GitHub repo name — it cannot be reconciled`);
    continue;
  }
  if (typeof e.checkout !== 'string' || !REPO_RE.test(e.checkout)) {
    fail(`${where}: \`checkout\` is missing or is not a single directory name under Projects/ — the local remote cannot be read`);
  }
  if (typeof e.measured !== 'string' || !e.measured.trim()) {
    fail(`${where}: \`measured\` is missing or empty — a declaration that does not say how it was measured cannot be told from a guess`);
  }
  if (!VIS.has(e.visibility)) {
    // Spelling matters and is not cosmetic: this field is compared to gh's output with ===.
    fail(`${where}: \`visibility\` is ${JSON.stringify(e.visibility)}, must be one of ${[...VIS].join('/')} (gh's exact spellings — compared with ===)`);
  }
  if (platformOwners.has(e.repo)) fail(`${where}: "${e.repo}" is ALSO declared by ${platformOwners.get(e.repo)} — two entries cannot own one name`);
  else platformOwners.set(e.repo, where);

  if (!Object.prototype.hasOwnProperty.call(e, 'boundRemote')) {
    fail(`${where}: \`boundRemote\` is absent — it must be an "owner/repo" string or an explicit null, because an absent key cannot be told from a forgotten one`);
    continue;
  }
  const br = e.boundRemote;
  if (br !== null) {
    if (typeof br !== 'string' || !OWNER_REPO_RE.test(br)) {
      fail(`${where}: boundRemote is ${JSON.stringify(br)}, must be null or an "owner/repo" string`);
    } else {
      const [, o, r] = br.match(OWNER_REPO_RE);
      if (o !== ORG) {
        // Not a stylistic complaint. `gh repo list <org>` is this guard's ONLY window; a
        // boundRemote outside that org is a binding this run cannot see, and reporting it as
        // checked would be a lie by omission.
        fail(`${where}: boundRemote "${br}" is owned by "${o}", not the declared org "${ORG}" — this guard looks only in ${ORG} and CANNOT reconcile it`);
      }
      if (boundOwners.has(r)) fail(`${where}: boundRemote "${r}" is ALSO bound by ${boundOwners.get(r)} — one repo cannot back two checkouts`);
      else boundOwners.set(r, where);
    }
  }
}

// ---- the other repos, and the rename pins -------------------------------------------------------
if (!Array.isArray(github.otherRepos)) {
  fail('otherRepos is missing or not an array — with no declaration surface, EVERY repo outside the platform reads as an orphan');
}
const otherRepos = new Map();
for (const [i, e] of (Array.isArray(github.otherRepos) ? github.otherRepos : []).entries()) {
  const where = `otherRepos[${i}]`;
  if (!e || typeof e !== 'object' || typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) {
    fail(`${where}: \`repo\` is missing or is not a legal repo name`);
    continue;
  }
  for (const k of ['why', 'measured']) {
    if (typeof e[k] !== 'string' || !e[k].trim()) {
      fail(`${where} (${e.repo}): \`${k}\` is missing or empty — an allow-list entry that does not say what it is for is a place to silence findings`);
    }
  }
  if (otherRepos.has(e.repo)) fail(`${where}: "${e.repo}" is declared in otherRepos twice`);
  else otherRepos.set(e.repo, e);

  // accountingRule says EXACTLY ONE. Double-declaration is the shape where a repo looks
  // accounted for from either end while nobody actually owns it.
  if (platformOwners.has(e.repo)) fail(`${where}: "${e.repo}" is declared in otherRepos AND is the \`repo\` of ${platformOwners.get(e.repo)} — accountingRule says EXACTLY ONE`);
  if (boundOwners.has(e.repo)) fail(`${where}: "${e.repo}" is declared in otherRepos AND is the boundRemote of ${boundOwners.get(e.repo)} — accountingRule says EXACTLY ONE`);
}

const pins = github.renamePins;
if (!pins || typeof pins !== 'object') {
  fail('renamePins is missing — a rename would then be reported with nothing named as depending on the old name, which is worse than not reporting it');
}
const pinsObservable = Array.isArray(pins?.observable) ? pins.observable : [];
const pinsUnobservable = Array.isArray(pins?.unobservable) ? pins.unobservable : [];
if (pins && !Array.isArray(pins.observable)) fail('renamePins.observable is missing or not an array');
if (pins && !Array.isArray(pins.unobservable)) fail('renamePins.unobservable is missing or not an array');
if (pins && Array.isArray(pins.unobservable) && pins.unobservable.length === 0) {
  // Measured fact, not an opinion: the Cloudflare Pages binding lives in a dashboard and nothing in
  // this tree can read it. A renamePins block claiming everything is observable is claiming a
  // coverage this repository does not have.
  fail('renamePins.unobservable is EMPTY — at least the Cloudflare Pages binding is unobservable from here, and an empty list claims a coverage this tree does not have');
}
for (const [i, e] of pinsObservable.entries()) {
  const where = `renamePins.observable[${i}]`;
  for (const k of ['id', 'repoDir', 'path', 'matchField', 'why']) {
    if (typeof e?.[k] !== 'string' || !e[k].trim()) fail(`${where}: \`${k}\` is missing or empty`);
  }
}
for (const [i, e] of pinsUnobservable.entries()) {
  const where = `renamePins.unobservable[${i}]`;
  for (const k of ['id', 'what', 'why', 'notMeasured']) {
    if (typeof e?.[k] !== 'string' || !e[k].trim()) fail(`${where}: \`${k}\` is missing or empty`);
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
    // IN-TREE LISTING — `listDir`, never the crossing primitive. `scanDirs` is built from REPO_ROOT, so
    // every entry here is meant to be this tree's own, and the org-literal rule below is a statement
    // about THIS repository's tooling scripts. A worktree or stray clone parked under tooling/ci would
    // put another repository's .mjs files in range of that statement.
    // ⚠️ HONESTLY: at THIS call site the exclusion is not currently load-bearing. The loop is one level
    // deep and takes `f.isFile()` only, so a nested checkout — always a DIRECTORY — is dropped by that
    // filter whether or not listDir dropped it first; the scanned count is identical either way. It is
    // written as `listDir` because the rule is that no guard enumerates a directory itself, and because
    // the day this loop learns to recurse — or to look at directory entries — is the day the property
    // starts mattering, silently, with nobody re-deriving it.
    // THE DATED RECORD, AND IT HAS MOVED — kept rather than replaced, because a measurement that
    // changed is worth more than the number alone:
    //   measured 2026-08-18: 145 scanned, 1 querier, before and after the listDir swap.
    //   measured 2026-08-21: 152 scanned, 6 raw queriers against 1 after the comment strip below.
    //     THE ARITHMETIC, written out because the first attempt to reconcile these two numbers was
    //     OFF BY ONE: `scanned` is not a directory listing — SELF is skipped four lines below. Today
    //     tooling/ci holds 144 top-level .mjs (144 of them tracked) and tooling/scripts holds 9, so
    //     scanned = 144 - 1 + 9 = 152, which is what this limb prints. So 145 cannot be "exactly
    //     today's tooling/ci count" under either reading: the listing is 144 and the scanned-from-
    //     tooling/ci figure is 143. What the 2026-08-18 record actually counted cannot be settled
    //     from here, and this line claims nothing about it beyond that it does not reconcile.
    //   ⚠️ 152, not the 153 an earlier pass of this comment recorded, and 6 raw, not 7: both were
    //     measured while tooling/ci still held an untracked, since-deleted stripper module. The
    //     older numbers are kept here because a measurement that moved for a known reason is worth
    //     more than the number alone.
    //   The listDir property is still not load-bearing at this call site, before or after the swap.
    //   Both numbers are DERIVED, so both move: a .mjs added to either directory changes the first
    //   and can change the second. They are recorded to be re-derived, not to be trusted.
    for (const f of listDir(d, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.mjs')) continue;
      const abs = join(d, f.name);
      if (abs === SELF) continue; // this file reads github.org by construction
      let raw;
      try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
      scannedFiles++;
      // ═══ 🔴 MATCH CODE, NOT PROSE ABOUT CODE. LIVE DEFECT, FOUND AND FIXED 2026-08-21. ═══════════
      // This limb read RAW source until today, so all three matches below — GH_LIST, READS_REGISTRY,
      // and the ORG literal — could be satisfied by a COMMENT rather than by code. A file that only
      // MENTIONS `github.org` no longer counts as reading it, and one that only mentions the org in
      // prose no longer counts as spelling it; both of those are tightenings this change makes too.
      // That is not a hypothetical in a corpus written in this house style,
      // where prose about code sits next to the code:
      //
      //   MEASURED 2026-08-21 over the 152 scanned files — 6 matched GH_LIST raw, 1 matched after
      //   stripping. The one was the store-slot guard retired on 2026-09-25, which really did
      //   `execFileSync('gh', ['repo', 'list', ...])`. All five false ones carry ONE shared comment
      //   paragraph advising a reader to verify a repo name with that command; `git log -S` on that
      //   sentence dates it to cc19a3a, 2026-08-20.
      //   ⚠️ AN EARLIER PASS OF THIS COMMENT SAID 7 raw, and a still earlier one asserted 8. Neither
      //   reproduces now. 7 was measured while an untracked second stripper module — written and
      //   deleted in this same session — sat in tooling/ci quoting the command in its header while
      //   never spelling the org; 8 was a transient
      //   reading that also caught assert-guard-coverage.mjs while it briefly carried the command
      //   inside a quoted description string (see the string-literal note below). Re-measured on the
      //   settled tree: 6 raw, 1 stripped.
      //
      // WHAT WAS LIVE ABOUT IT: THE COUNT PRINTED AT THE FOOT OF THIS LIMB COULD NOT FALL. Six files
      // matched raw while exactly one queried, and the six could not drop below five while that
      // shared paragraph stood. So the one signal the count exists to give — "nothing queries GitHub
      // any more, i.e. the scan stopped reaching the tree" — could never be observed. An assertion
      // that cannot fail, exactly the shape CLAUDE.md names.
      //
      // ⚠️ AND WHAT WAS NOT LIVE. CORRECTED 2026-08-21, hours after it was written, because a wrong
      // claim about this file's own subject is that subject one level up. A previous pass of this
      // comment said the raw read "MANUFACTURED A FALSE RED", citing an --offline run that exited 1
      // with one finding. That run happened — but the sole finding was against that same UNTRACKED
      // stripper module, created earlier in this same session and since deleted, so the red was
      // SELF-INFLICTED and never existed on the committed tree at all. Re-simulated
      // 2026-08-21 with the raw branch over today's tree: 6 NOTE(duplicated) and ZERO findings. The
      // unfallable count above is the whole of the live defect; there was no second one.
      //
      // 🔴 STRING LITERALS MUST SURVIVE, AND THAT IS WHY THIS READ IS `stripSourceComments` ALONE.
      // text-reductions.mjs also exports `stripStringLiterals`, the separate composable tool for
      // callers that need literals gone. This limb is not one of them, and composing it here would
      // DELETE THE LIMB SILENTLY: a real querier matches on STRING LITERALS — the one measured on
      // 2026-08-21 (the store-slot guard, retired 2026-09-25, when this limb was left with no real
      // querier to see) was a single boundedSpawn argv carrying both its GH_LIST match AND its sole
      // copy of the org literal. Measured 2026-08-21, composing stripStringLiterals on top of
      // the comment strip takes the querier count 1 -> 0 and that file stops containing ORG, so the
      // limb would go blind while still printing a confident, green "0 of them query".
      // stripSourceComments does not blank string literals. That is the behaviour this limb needs.
      //
      // ⚠️ WHAT THIS DOES NOT CATCH, stated because an overclaiming comment here is worse than none:
      // prose living inside a STRING literal, which strings-verbatim cannot touch and must not. A file
      // that merely NAMES this command inside a quoted string — a description, an error message, a
      // manifest blurb — still lands in the branches below though it queries nothing.
      // This is not theoretical: OBSERVED 2026-08-21, mid-session, assert-guard-coverage.mjs briefly
      // carried the command inside a quoted description string and was reported by exactly that path.
      // It was gone by the time this comment was written (re-measured on the settled tree: 6 raw, 1
      // stripped, no string-literal case remaining), which is precisely why the limitation is recorded
      // here rather than left to be rediscovered. The repair for such a case belongs in the OTHER
      // file — do not spell the command literally in prose — never in teaching this one to blank
      // strings, for the reason directly above.
      //
      // The extension is passed as a LITERAL '.mjs' rather than derived, because the filter four lines
      // above admits nothing else. That matters: text-reductions returns an unknown extension VERBATIM
      // and says nothing, so a loop that could see other extensions would owe a check that the
      // reduction actually reduced (assert-no-do-alarms.mjs and assert-android-target-sdk.mjs carry
      // one). This one cannot, and '.mjs' is in COMMENT_STYLES.
      // ═════════════════════════════════════════════════════════════════════════════════════════════
      const src = stripSourceComments(raw, '.mjs');
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
// LIMB 2 — LOCAL. Each `platform` checkout's REAL git remote against what the registry declares.
//
// 🔴 THE TWO ABSENCES ARE ANSWERED BY TWO DIFFERENT TESTS, ON PURPOSE (STORE-MATRIX-PLAN.md 4.3).
//   absent because THIS TREE does not contain it — a CI checkout holds one repo, never its siblings —
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
for (const [i, e] of platform.entries()) {
  if (!e || typeof e !== 'object' || typeof e.repo !== 'string' || typeof e.checkout !== 'string' || !REPO_RE.test(e.checkout)) continue;
  const p = whereOf(e, i);
  const declared = typeof e.boundRemote === 'string' ? e.boundRemote : null;
  // 🔴 UNTIL 2026-08-20 THIS RESOLVED ONLY THE STORE x PLATFORM x TYPE PATH, AND THAT TREE WAS
  // FLATTENED ON 2026-08-19: every local-remote comparison reported "NOT PRESENT" and was SKIPPED,
  // and this guard still printed `ok — registry and org reconcile`, having compared nothing on
  // disk. The checkouts are plain siblings under `Projects/`, which is what `checkout` names; the
  // floor at the REPORT below is what keeps a skip from reading as a pass.
  const abs = join(PROJECTS, e.checkout);

  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    localUnreachable++;
    note(`${p}: checkout directory NOT PRESENT in this tree — local remote NOT compared (${e.checkout}).`);
    continue;
  }
  if (!existsSync(join(abs, '.git'))) {
    if (declared !== null) {
      fail(`${p}: registry declares boundRemote "${declared}" but the directory on disk has NO .git — a tree with no git cannot have a remote`);
    }
    localCompared++;
    continue;
  }
  let url = null;
  try {
    const r = repoGitRaw(abs, ['remote', 'get-url', 'origin']);
    // A non-zero status here is DATA: no `origin` configured is a real, measured
    // state, not an error. It was already read that way; what changed is that the
    // repository answering is now the one named by `abs` and nothing else.
    url = r.status === 0 ? String(r.stdout ?? '').trim() : null;
  } catch (err) {
    if (!(err instanceof RepoGitError)) throw err;
    // git absent, or `abs` is not a repository root at all. NOT folded into "no
    // origin": that would report a considered comparison over a read that never
    // happened, which is the vacuous pass this file exists to refuse.
    note(`${p}: local remote NOT read — ${err.message} ${err.detail}`.replace(/\s+/g, ' ').trim());
    localUnreachable++;
    continue;
  }
  localCompared++;
  if (url === null) {
    if (declared !== null) fail(`${p}: registry declares boundRemote "${declared}" but the checkout has NO \`origin\` remote`);
    continue;
  }
  const { slug, raw } = normaliseRemote(url);
  if (!slug) {
    fail(`${p}: origin is "${raw}", which this guard cannot read as a github.com owner/repo — it cannot be reconciled and is not being silently passed`);
    continue;
  }
  if (declared === null) fail(`${p}: registry declares boundRemote null but the checkout's origin is "${slug}"`);
  else if (declared !== slug) fail(`${p}: registry declares boundRemote "${declared}" but the checkout's origin is "${slug}"`);
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
      const res = repoGitRaw(abs, ['grep', '-n', '-I', '-F', full]);
      // git grep exits 1 for "no matches" — a real answer. Anything else is a failed scan.
      if (res.status === 0) lines = String(res.stdout ?? '').split('\n').filter(Boolean);
      else if (res.status === 1) lines = [];
      else scanned = false;
    } catch (e) {
      if (!(e instanceof RepoGitError)) throw e;
      scanned = false; // git absent, or `abs` is not a repository root — a limb that did not run
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
    // 🔴 BOUNDED. `gh` reaches a network this runner does not control. An
    // unbounded spawn waiting on it does not fail loudly — the JOB is cancelled
    // at its own timeout-minutes, the log stops mid-guard, and nothing names the
    // command; that is how the launcher-icons hang read for five runs before
    // `flutter create` was bounded. GH_LIST_TIMEOUT_MS moves the bound and
    // cannot remove it, and a time-out is COVERAGE LOST — the org was never
    // looked at, which is a different message from "the register is stale" and
    // deliberately the same colour.
    const gh = boundedSpawn(
      'gh',
      ['repo', 'list', ORG, '--limit', String(LIMIT), '--json', 'name,visibility,isArchived'],
      { timeoutMs: timeoutFromEnv('GH_LIST_TIMEOUT_MS', 60_000), label: 'gh repo list' },
    );
    if (!gh.ok) {
      const first = String(gh.stderr || '').split('\n').filter(Boolean)[0] || '';
      die('COVERAGE LOST — `gh repo list` could not look at GitHub.', [
        gh.detail,
        ...(first ? [first] : []),
        'Nothing about the org was verified on this run.',
        '"I could not look" is a DIFFERENT MESSAGE from "it is stale", and the SAME COLOUR.',
        'There is no exit-0 path through this guard that skipped the network.',
      ]);
    }
    raw = gh.stdout;
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

  // ---- declared -> real, per platform entry ------------------------------------------------------
  for (const [i, e] of platform.entries()) {
    if (!e || typeof e !== 'object' || typeof e.repo !== 'string' || !REPO_RE.test(e.repo)) continue;
    const where = whereOf(e, i);

    const real = have.get(e.repo) ?? null;
    if (!real) {
      fail(`STALE DECLARATION — ${where}: org ${ORG} does not hold "${e.repo}". A measured field that has gone stale; editing it needs nobody's permission.`);
    } else {
      if (e.visibility !== real.visibility) {
        fail(`${where}: visibility says ${JSON.stringify(e.visibility ?? null)}, GitHub says ${JSON.stringify(real.visibility)} for "${e.repo}"`);
      }
      if (real.isArchived) {
        owner(`${where}: "${e.repo}" exists and is ARCHIVED on GitHub. An archived repo accepts no pushes; unarchiving is a GitHub-side change only the owner can make.`);
      }
    }

    // ---- PENDING RENAME --------------------------------------------------------------------------
    const br = typeof e.boundRemote === 'string' && OWNER_REPO_RE.test(e.boundRemote) ? e.boundRemote : null;
    if (!br) continue;
    const boundName = br.split('/')[1];
    const boundReal = have.get(boundName) ?? null;

    if (!boundReal) {
      owner(`${where}: boundRemote "${br}" DOES NOT EXIST in org ${ORG}. Either it was renamed or deleted on GitHub, or the binding is wrong. Resolving it is a GitHub-side decision; this guard will not guess which.`);
      continue;
    }
    if (boundName !== e.repo) {
      const banner = [
        `${where}: PENDING RENAME.`,
        `   registry intends : ${e.repo}`,
        `   GitHub has NOW   : ${boundName}  (${boundReal.visibility}${boundReal.isArchived ? ', ARCHIVED' : ''})`,
        `   The rename is the OWNER'S and nothing here can perform it — this file holds no write path`,
        `   to GitHub. Until the owner does it, this prints on EVERY run and the build stays GREEN,`,
        `   because a build held red on work the build cannot do teaches everyone that red is negotiable.`,
        '',
        reportOldNameDependents(boundName),
      ].join('\n');
      owner(banner);
    }
    if (VIS.has(e.visibility) && boundReal.visibility !== e.visibility) {
      owner(`${where}: boundRemote "${br}" is ${boundReal.visibility} on GitHub, but the entry declares ${e.visibility}. Changing repository visibility is a GitHub-side change only the owner can make.`);
    }
    if (boundReal.isArchived) {
      owner(`${where}: boundRemote "${br}" is ARCHIVED on GitHub.`);
    }
  }

  // ---- real -> declared: orphans, and stale otherRepos lines --------------------------------------
  // accountingRule: every repo the org holds is a `platform` repo, a boundRemote, or an otherRepos
  // line. Anything else is an ORPHAN and FAILS — the fix is one line in tooling/github-org.json and
  // needs nobody's permission, which is exactly why it is red. A DEAD name is not an accounting
  // surface: the org holding one again is a re-claim, so it stays an ORPHAN and says so.
  const accounted = new Set([...platformOwners.keys(), ...boundOwners.keys(), ...otherRepos.keys()]);
  const orphans = list.filter((r) => !accounted.has(r.name));
  for (const r of orphans) {
    const d = deadByName.get(r.name);
    const deadNote = d
      ? ` 🔴 AND tooling/dead-repos.json records "${r.name}" as DEAD (${d.how ?? 'how not recorded'} ${d.died ?? 'date not recorded'}): the org holds a dead name again, which is a RE-CLAIMED name, not a new repo — record \`revived\` there and declare it here, or find out who re-created it.`
      : '';
    fail(`ORPHAN — org ${ORG} holds "${r.name}" (${r.visibility}${r.isArchived ? ', ARCHIVED' : ''}) and tooling/github-org.json accounts for it NOWHERE: it is no platform entry's repo, no boundRemote, and no otherRepos entry. Declare it or file it. Nobody needs permission to add that line.${deadNote}`);
  }
  for (const [name] of otherRepos) {
    if (!have.has(name)) {
      fail(`STALE DECLARATION — otherRepos names "${name}", and org ${ORG} does not hold it. Deleting a line needs nobody's permission either.`);
    }
  }
} else {
  note('GitHub limb SKIPPED — --offline was passed. NOTHING about the org was verified: not existence, not visibility, not orphans, not renames.');
}

// =================================================================================================
// REPORT
// =================================================================================================
console.log(`${NAME} — tooling/github-org.json  vs  github.com/${ORG}   (READ-ONLY: gh repo list)`);
console.log(`  anchor   ${PROJECTS}`);
console.log(`  registry ${REGISTRY}`);
console.log(`  platform repos ${platformOwners.size} · bound remotes ${boundOwners.size} · other repos ${otherRepos.size} · dead names known ${deadByName.size}`);
console.log(`  local remotes compared ${localCompared} · checkouts not in this tree ${localUnreachable}`);

// 🔴 ZERO COMPARISONS IS NOT A PASS, AND UNTIL 2026-08-20 IT WAS. `localCompared`
// and `localUnreachable` were PRINTED and nothing read them, so the whole
// local-vs-registry half could skip every entry and this guard still exited 0
// saying the registry and the org reconcile. It had been doing exactly that since
// the 2026-08-19 flattening: 4 declared boundRemotes, 0 compared.
//
// ⚠️ The floor is DERIVED from the registry, not typed: however many entries
// declare a `boundRemote`, at least one of them must have been read off a real
// checkout. A registry that declares none legitimately compares none.
const declaredSides = platform.filter((e) => typeof e?.boundRemote === 'string').length;
if (declaredSides > 0 && localCompared === 0) {
  console.error(
    `✗ COVERAGE LOST — ${declaredSides} platform checkout(s) declare a boundRemote and NOT ONE was compared against a ` +
      'checkout on disk. Every "registry and org reconcile" verdict above rests on the GitHub half alone; the local ' +
      'half proved nothing. That is the state this guard was in from the 2026-08-19 flattening until 2026-08-20, ' +
      'while printing ok.',
  );
  process.exitCode = 2; // read at the exit line below: a COVERAGE LOST (2), not a finding — findings still dominate
}
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
} else if (process.exitCode === 2) {
  // 🔴 UNTIL 2026-09-19 THE ✗ ABOVE SET exitCode = 1 AND process.exit(exit) BELOW OVERWROTE IT: the
  // local half comparing nothing still exited 0. A fixture (4) or --offline (3) run already cannot pass.
  coverageLost(`the local limb compared NONE of the ${declaredSides} declared boundRemote checkout(s) — see ✗ above.`);
} else {
  console.log(`${NAME}: ok — registry and org reconcile. ${actions.length} owner action(s) outstanding and printed above.`);
  exit = 0;
}
process.exit(exit);

/** The COVERAGE LOST stop for a limb that could not look: prints what was not seen and exits 2 —
 *  never 1, which would read as a finding, and never 0 (AGENTS.md exit-code convention,
 *  O-EXIT2-CONVENTION-GAP). `die` above is the same verdict for the resolve/network stops (anchor,
 *  registry, `gh repo list` unreachable or vacuous); this is the one the summary reaches.
 *  Declared LAST (hoisted) so no line above moves. */
function coverageLost(msg) {
  console.error(`${NAME}: COVERAGE LOST — ${msg}`);
  console.error('  Nothing this run printed as reconciled is evidence. Exiting 2: could not look, not a finding.');
  process.exit(2);
}
