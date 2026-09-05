#!/usr/bin/env node
/* assert-e2e-proof-fresh.mjs — is the weekly e2e proof still being produced?
 *
 * THE ONLY IMPLEMENTATION, CALLED FROM TWO PLACES. Until 2026-08-27 this file
 * and the `proof-fresh` job in .github/workflows/e2e.yml were two copies of the
 * same alarm: the job was the original, this was a documented port of it, and
 * the EXPECT_LEGS block below was added to the ORIGINAL after the port was
 * taken. Nothing propagated it and nothing asserted agreement, so the copy that
 * runs on every push was the WEAKER one. At 42962e9 e2e.yml:1080 read
 * `EXPECT_LEGS > 0 && legs.length === EXPECT_LEGS && …` against this file's
 * `legs.length > 0 && …`, while the runs query either side of it was
 * byte-identical once de-indented. Both call sites now run THIS file.
 *
 * BOTH CALL SITES SURVIVE ON PURPOSE, because their silences are complementary:
 *   ci.yml         — every push to main and every PR. A dead cron cannot
 *                    silence it, which is the whole reason it exists.
 *   e2e.yml        — its own `proof-fresh` job, on the weekly cron, on
 *                    workflow_dispatch, or on a `run-e2e` label this repository
 *                    does not define. A quiet main cannot silence it.
 *
 * THREE THINGS IT DOES DIFFERENTLY FROM THE Platform_Public SIBLINGS
 * (tooling/ci/assert-e2e-proof-fresh.mjs, assert-platform-proof-fresh.mjs):
 *
 * 1. THE QUERY FILTERS `event=schedule`, NOT `status=success`. The siblings
 *    size a window over SUCCESSES, so every green hand-press eats a slot and
 *    can push the last scheduled success off the page. Filtering on the EVENT
 *    means a dispatch cannot occupy a slot at all, and 100 rows is ~100 weeks
 *    of this cron.
 * 2. GREEN IS READ OFF THE `e2e ·` MATRIX LEGS OF PAST RUNS, NOT OFF RUN
 *    CONCLUSIONS. e2e.yml's copy of this call is IN the run it grades, so
 *    grading conclusions would DEADLOCK: the job going red makes the run red,
 *    which makes it not a success, which keeps the job red forever.
 * 3. AGES ARE `created_at` — WHEN THE TIMER FIRED. That is the quantity both
 *    limbs are about, and it is the field the page is ordered by, so the
 *    created_at/updated_at ordering caveat the siblings carry cannot arise.
 *
 * MAX_AGE_DAYS = 15, DERIVED FROM THE CRON RATHER THAN CHOSEN. One weekly slot
 * gives a 14-day ceiling exactly ONE reliable chance to renew, because the
 * day-14 slot fires AT the ceiling and measured GitHub schedule drift in this
 * org reaches +226 minutes (HANDOFF-2026-08-26 §1, four samples). 15 leaves
 * that second slot a full day of drift room. A second cron slot is the lever
 * that brings this DOWN; raising it is not a lever, it is a retreat.
 *
 * ⛔ ITS RED CANNOT BE CLEARED BY PRESSING THE BUTTON. `workflow_dispatch` runs
 * are excluded by the query, so a hand-press REVEALS a dead cron instead of
 * renewing it — the scar both siblings record.
 *
 * ADVISORY. main in this repository has no branch protection and no rulesets,
 * so a red here reddens a check on the checks page and blocks nothing. Clearing
 * it is an owner action, not this gate's.
 *
 * Exit 0 = the timer fired inside the ceiling AND the newest scheduled run
 * carrying every e2e leg this checkout expects, all passed, is inside it too.
 * Exit 2 = the gate could not run, which is never reported as health.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 🔴 THE WORKFLOW THIS GATE READS ITS CEILING OUT OF IS NO LONGER IN THIS TREE.
   Until 2026-09-05 this repository was its own, and `.github/workflows/e2e.yml`
   sat beside these scripts. It is now a subtree of Nikatru_Platform_Public
   ([ADR 067] decision 1), GitHub reads only the repository ROOT's
   `.github/workflows/`, and the three lanes there are one file. So the name is a
   CANDIDATE LIST resolved against whichever workflow directory really exists —
   the subtree's own, if this tree is ever split back out with
   `git subtree split --prefix=extensions`, and the repository root's otherwise.

   ⚠️ FOUND BY CI ON THE MERGE'S FIRST GREEN PARSE, not by reading. This gate
   exited 2 — `could not read …/extensions/.github/workflows/e2e.yml (there is no
   workflows in …/extensions/.github)` — which is the CANNOT RUN path working
   exactly as designed: a gate that cannot find its subject says so instead of
   reporting freshness it never measured. */
const WORKFLOW_CANDIDATES = ['extensions.yml', 'e2e.yml'];
const BRANCH = 'main';
/* Derived from the cron, and re-derived by the self-check below, which reddens
   if the cadence stops being weekly. */
const MAX_AGE_DAYS = 15;
/* The maximum this endpoint accepts. The query filters event=schedule, so a
   hand-press cannot consume a row and 100 rows is ~100 weeks of this cron. */
const RUNS_PAGE_SIZE = 100;
/* How far back the GREEN limb walks before reporting that it found none. */
const WALK_BACK = 12;
/* The matrix legs, named `e2e · <dir>`. Prefix-matched because the dir comes
   from discovery. "Discover e2e suites" does not match, nor does proof-fresh. */
const LEG = /^e2e[^A-Za-z0-9]/;
/* The `<cat>/<tool>` payload AFTER the prefix and its separator. The separator
   is "a run of non-alphanumerics", never the literal `·`: that character is
   U+00B7, it crosses the GitHub API and a source-encoding boundary to get here,
   and a gate pinned to one byte sequence for it would stop parsing — silently —
   the day it arrived mojibake'd or was retyped as a dash.

   🔴 THE GREEDY RUN EATS A LEADING `_`. `[^A-Za-z0-9]+` is greedy and the
   payload was required to START alphanumeric, so `e2e · _Vendor/Tool_A` yielded
   `Vendor/Tool_A` — MEASURED 2026-08-27 as `NEVER EXERCISED: _Vendor/Tool_A
   NOT IN THIS CHECKOUT: Vendor/Tool_A`, exit 1, on a PERFECT proof. A category
   beginning with a non-alphanumeric is discovered by the walk below (it skips
   only dot-names and LEG_SKIP), so that shape is reachable. LEG_WS is tried
   first and resolves it by taking the separator as WHITESPACE-DELIMITED, which
   is what e2e.yml:84 actually emits; the greedy form stays as a fallback so an
   unspaced separator still parses. */
const LEG_WS = /^e2e\s+(?:[^\sA-Za-z0-9]+\s+)?([A-Za-z0-9_].*?)\s*$/;
const LEG_DIR = /^e2e[^A-Za-z0-9]+([A-Za-z0-9].*)$/;
const legDirOf = n => { const m = LEG_WS.exec(n) || LEG_DIR.exec(n); return m ? m[1].trim() : null; };
const DAY = 86400000;

const red = [];
const err = m => { console.log('::error::' + m); red.push(m); };
const cannotRun = m => { console.log('::error::' + m); process.exit(2); };

/* `--repo-root <dir>` is HONOURED, not accepted-and-ignored: it moves the tree
   this gate reads its cron out of. */
let rootArg = '';
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--repo-root') {
    rootArg = argv[++i] || '';
    if (!rootArg) cannotRun('--repo-root was given with no directory after it.');
  } else {
    cannotRun(`unknown option ${JSON.stringify(argv[i])} — this gate takes --repo-root <dir> and nothing else. Everything else it needs comes from GH_TOKEN and REPO (or GITHUB_REPOSITORY).`);
  }
}
const ROOT = rootArg ? path.resolve(rootArg) : REPO_ROOT;

/* Resolved ONE ENTRY AT A TIME and compared byte-for-byte, never existsSync: CI
   IS LINUX and a case-insensitive host answers for names it cannot open. */
const dirent = (p, name) => {
  const es = fs.readdirSync(p, { withFileTypes: true });
  return es.find(d => d.name === name) || es.find(d => d.name.toLowerCase() === name.toLowerCase()) || null;
};

/* Where GitHub actually reads workflows from. This tree's own directory first —
   that is the standalone-repository case and the case after a subtree split — and
   the enclosing repository's root second, which is where they live today.
   `git rev-parse --show-toplevel` is asked rather than assumed, so a fixture tree
   that is not a work tree simply yields no second candidate. */
function workflowRoots(root) {
  const roots = [root];
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
    if (top && path.resolve(top) !== path.resolve(root)) roots.push(path.resolve(top));
  } catch (_) { /* not a work tree: one candidate is all there is */ }
  return roots;
}

/* ── SELF-CHECK: THE CEILING IS DERIVED, SO THE CRON IS LOAD-BEARING ────────
   Full-line comments are dropped first. */
let wfPath = '';
let raw = '';
/* Set from whichever candidate resolved, so every message below and the run-history
   query all name the file this gate really read. */
let WORKFLOW = '';
{
  const tried = [];
  for (const base of workflowRoots(ROOT)) {
    for (const name of WORKFLOW_CANDIDATES) {
      const attempt = path.join(base, '.github', 'workflows', name);
      try {
        let p = base;
        for (const seg of ['.github', 'workflows', name]) {
          const d = dirent(p, seg);
          if (!d) throw new Error(`there is no ${seg} in ${p}`);
          if (d.name !== seg) throw new Error(`${seg} is on disk as ${d.name}, a case a Linux runner does not open`);
          p = path.join(p, seg);
        }
        raw = fs.readFileSync(p, 'utf8');
        wfPath = p;
        WORKFLOW = name;
        break;
      } catch (e) { tried.push(`${attempt} (${e.message})`); }
    }
    if (wfPath) break;
  }
  if (!wfPath) {
    cannotRun(`could not read the workflow that carries the e2e cron. Tried, in order:\n  ` +
      tried.join('\n  ') +
      `\nThe ceiling is derived from that file's cron, so with no such file there is nothing to derive it from.`);
  }
}
const yaml = raw.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

const crons = [...yaml.matchAll(/cron:\s*['"]([^'"]+)/g)].map(m => m[1].trim());
const weekly = e => { const f = e.trim().split(/\s+/); return f.length === 5 && f[2] === '*' && f[3] === '*' && /^[0-6]$/.test(f[4]); };
if (!crons.length) {
  err(`COVERAGE LOST — ${WORKFLOW} declares no cron. MAX_AGE_DAYS = ${MAX_AGE_DAYS} is derived from a weekly cadence, and with no timer at all this is a countdown rather than a guard.`);
} else {
  const odd = crons.filter(c => !weekly(c));
  if (odd.length) err(`COVERAGE LOST — ${WORKFLOW} cron(s) ${odd.join(', ')} are not weekly. MAX_AGE_DAYS = ${MAX_AGE_DAYS} is DERIVED from one slot every 7 days plus a day of drift room; against another cadence it stops describing anything.`);
  if (crons.length > 1) console.log(`::notice::${crons.length} cron slots (${crons.join(', ')}). More slots than the derivation assumes is safe but LOOSE — re-derive MAX_AGE_DAYS downward rather than leaving it at ${MAX_AGE_DAYS}.`);
}
/* The GREEN limb keys on the matrix job name, so a rename blinds it. ANCHORED
   TO THE 4-SPACE JOB INDENT, because e2e.yml's artifact-upload step carries a
   `name: e2e-out-...` that an unanchored form matches instead — which returns
   exit 0 across the exact rename this exists to catch. */
if (!/^ {4}name:\s*e2e[^A-Za-z0-9]/m.test(yaml)) {
  err(`COVERAGE LOST — no job in ${WORKFLOW} carries a name starting e2e at the job indent, which is the prefix the GREEN limb matches run jobs on. Rename the matcher in the same commit as the job.`);
}

/* ── WHICH LEGS A GREEN RUN HAS TO CARRY ────────────────────────────────────
   `legs.every(success)` is vacuously true over an EMPTY list. It is ALSO true
   over ONE leg on a run whose matrix used to be four legs wide, so without a
   floor a proof that stopped covering three tool directories reads GREEN and
   keeps reading green for as long as the surviving leg passes.

   THE EXPECTED SET IS DERIVED, NOT TYPED: it re-runs the rule e2e.yml's
   `discover` job uses — a <Category>/<Tool>/test/e2e/package.json — over the
   checkout this gate already has. WHAT IT COSTS, plainly: adding a tool reddens
   this until the next scheduled run covers it, and that red is a TRUE sentence
   — the last green proof did not run the new tool.

   🔴 A SET, NOT A CARDINALITY, since 2026-08-27. A count is preserved by a
   rename and by a delete-one-add-one, so until that day the `<cat>/<tool>`
   payload of a leg name was compared to nothing. Measured on injected history:
   a checkout carrying Full_Screen_Shot and Second_Tool, against runs whose two
   legs are Full_Screen_Shot and a GONE_Tool that is not in the checkout, logged
   `legs=2/2  GREEN` and exited 0 — Second_Tool never exercised by any run in
   that history. The legs are now parsed and compared as a set of names.

   🔴 JOINED WITH `/`, NEVER path.sep. The leg name is built on a Linux runner
   from `${cat}/${tool}`; joining with path.sep here would compare
   `Extension\Tool` to `Extension/Tool` on Windows and pass on Linux only.

   ⚠️ ROOTED AT ROOT, NOT AT cwd. e2e.yml's copy of this block read `"."`, which
   is the same thing only when the gate is run from the tree it grades. Measured
   2026-08-27: with cwd = a developer's own checkout and --repo-root = a fixture
   holding zero e2e suites, the cwd form printed "expects 1 e2e leg(s)" and
   exited 0 — it graded the wrong tree and looked healthy doing it. */
const LEG_SKIP = new Set(['templates', '_skeleton', 'node_modules']);
const legDirs = p => fs.readdirSync(p, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('.') && !LEG_SKIP.has(d.name)).map(d => d.name);
const EXPECT_DIRS = new Set();
const NO_PKG = [];
const MISCASED = [];
try {
  for (const cat of legDirs(ROOT))
    for (const tool of legDirs(path.join(ROOT, cat))) {
      let p = path.join(ROOT, cat, tool), off = false, reached = true;
      for (const seg of ['test', 'e2e']) {
        const d = dirent(p, seg);
        if (!d || !d.isDirectory()) { reached = false; break; }
        if (d.name !== seg) off = true;
        p = path.join(p, d.name);
      }
      if (!reached) continue;
      const pkg = dirent(p, 'package.json');
      if (!pkg || !pkg.isFile()) NO_PKG.push(cat + '/' + tool);
      else if (off || pkg.name !== 'package.json') MISCASED.push(cat + '/' + tool);
      else EXPECT_DIRS.add(cat + '/' + tool);
    }
} catch (e) {
  cannotRun(`could not walk ${ROOT} for <Category>/<Tool>/test/e2e/package.json (${e.message}). The expected leg set is derived from that walk, so with the tree unreadable there is nothing to derive it from.`);
}
if (NO_PKG.length) {
  err(`COVERAGE LOST — a test/e2e directory with no package.json in it: ${NO_PKG.join(', ')}. That is the REMOVAL direction of the cost above, which states only the add: deleting that one file takes the tool out of the discover matrix AND out of the expected set in the same commit, so a NEVER EXERCISED red goes green with the suite still on disk. Measured 2026-08-27 — two suites and a proof covering one: legs=1/2 not-green exit 1, then rm one package.json and nothing else, legs=1/1 GREEN exit 0.`);
}
if (MISCASED.length) {
  err(`COVERAGE LOST — test/e2e/package.json reachable only under a different case: ${MISCASED.join(', ')}. A case-insensitive filesystem counts that as a suite and the Linux runner does not, so it is excluded here and the two hosts disagree about the expected set.`);
}
/* ── THE COMMITTED SUITE SET, AS A FILE IN THE GRADED TREE ──────────────────
   Everything above is DERIVED, and derivation on its own cannot tell "this tool
   never had a suite" from "this tool's suite was deleted in this commit": both
   read as an absent test/e2e. The NO_PKG limb bites only because
   `rm test/e2e/package.json` LEAVES THE DIRECTORY BEHIND to be found.
   `rm -r test/e2e` leaves nothing at all, and `rm -rf <Category>/<Tool>` less
   than that. MEASURED 2026-08-27, two suites and a proof covering one:
   legs=1/2 not-green exit 1, then rm -r the second suite's test/e2e and nothing
   else, legs=1/1 GREEN exit 0.

   🔴 THE LIST IS A FILE IN ROOT, NOT A CONSTANT IN THIS GATE, since 2026-08-27,
   AND THAT IS WHAT CLOSES THE `rm -rf` HOLE. As a constant the removal check had
   to be made INERT wherever the tool directory was absent — otherwise it was one
   repository's fact smuggled into whatever `--repo-root` names — and that
   inertness WAS the hole. MEASURED 2026-08-27 on a two-suite bite tree:
   `rm -rf Extension/Full_Screen_Shot` with the run history losing the same leg
   logged `legs=1/1  GREEN` and exited 0, the deletion invisible. Read out of
   SUITES_FILE in ROOT the set is a fact about the tree BEING GRADED, so no
   inertness is needed and the same deletion reddens.

   Removing a suite therefore means DELETING ITS LINE FROM THAT FILE in the same
   commit. That is the whole mechanism: the shrink stops being a deletion nobody
   reads and becomes a line in the diff. A file can be edited in the commit that
   deletes the suite, which a constant in a gate is only grudgingly.

   🔴 BOTH DIRECTIONS, since 2026-08-27. A suite in the tree and NOT in the file
   was a ::notice:: rather than a red, because a constant here could not be right
   for any checkout but this one — so every ADDED suite was unprotected until
   somebody remembered to type its name. A file that travels with the checkout
   can be right for it, so that is a red now, and it names the suite.

   ⚠️ READ FROM ROOT, NEVER FROM THIS FILE'S OWN REPO. Resolved against
   REPO_ROOT it would grade every `--repo-root` tree against THIS repository's
   list — the decoy shape the PROOF_ALARM_WORKFLOW scar records for wfPath.
   ⚠️ Segment by segment and byte-exact, never existsSync: CI IS LINUX and a
   case-insensitive host answers for names it cannot open. */
const SUITES_FILE = 'scripts/e2e-suites.json';
let WIRED_SUITES = [];
{
  let p = ROOT;
  try {
    for (const seg of SUITES_FILE.split('/')) {
      const d = dirent(p, seg);
      if (!d) throw new Error(`there is no ${seg} in ${p}`);
      if (d.name !== seg) throw new Error(`${seg} is on disk as ${d.name}, a case a Linux runner does not open`);
      p = path.join(p, seg);
    }
  } catch (e) {
    cannotRun(`could not reach ${SUITES_FILE} under ${ROOT} (${e.message}). The committed suite set IS that file, so with it unreachable there is nothing to compare the tree against — and an ABSENT list must not read as "nothing was deleted".`);
  }
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { cannotRun(`${SUITES_FILE} could not be read as JSON (${e.message}). An unparseable list is not an empty one.`); }
  if (!doc || !Array.isArray(doc.suites)) {
    cannotRun(`${SUITES_FILE} carries no \`suites\` array. A missing or renamed key would read as an empty list, and an empty list is a comparison over nothing that every deletion passes.`);
  }
  WIRED_SUITES = doc.suites;
}
if (!WIRED_SUITES.length) {
  err(`COVERAGE LOST — the \`suites\` array in ${SUITES_FILE} is empty, so the comparison below is over nothing and every deletion passes it. Emptying the list is not how a suite is retired; deleting the one name is.`);
}
/* The walk above builds every name by joining with '/', so an entry of another
   shape can never match one — it would sit in the list LOOKING like protection.
   A backslash-joined `Extension\Tool` is the reachable instance of that. */
const BAD_ENTRY = WIRED_SUITES.filter(s => typeof s !== 'string' || !/^[^/\\]+\/[^/\\]+$/.test(s));
if (BAD_ENTRY.length) {
  cannotRun(`${SUITES_FILE} names ${BAD_ENTRY.length} entr(ies) that are not a \`<Category>/<Tool>\` string: ${BAD_ENTRY.map(s => JSON.stringify(s)).join(', ')}. Nothing this gate derives can ever equal one, so it protects nothing while reading as though it did.`);
}
/* A repeated name means ONE of its two lines can be deleted with the tree
   untouched and nothing here moves — a line that reads as protection and is not.
   A set comparison collapses the repeat, which is exactly why it is caught here
   rather than left to the comparison. */
const DUPED = [...new Set(WIRED_SUITES.filter((s, i) => WIRED_SUITES.indexOf(s) !== i))].sort();
if (DUPED.length) {
  err(`COVERAGE LOST — ${SUITES_FILE} names ${DUPED.join(', ')} more than once. Deleting one of those lines changes nothing here, so that line is not the committed record it looks like.`);
}
const REMOVED = WIRED_SUITES.filter(s =>
  !EXPECT_DIRS.has(s) && !NO_PKG.includes(s) && !MISCASED.includes(s));
if (REMOVED.length) {
  err(`COVERAGE LOST — ${REMOVED.join(', ')} is named in ${SUITES_FILE} and this checkout has no <Category>/<Tool>/test/e2e/package.json for it. Deleting the suite — or the whole tool directory — takes it out of the discover matrix AND out of the expected set in the same commit, so a NEVER EXERCISED red goes green with nothing left to point at. A DELIBERATE removal is not blocked by this, it is made loud: delete the name from ${SUITES_FILE} in the same commit as the directory.`);
}
const UNLISTED = [...EXPECT_DIRS].filter(d => !WIRED_SUITES.includes(d)).sort();
if (UNLISTED.length) {
  err(`COVERAGE LOST — ${UNLISTED.join(', ')} carries a test/e2e suite and is NOT named in ${SUITES_FILE}. Until it is, deleting that directory shrinks the expected set with no red at all. Add the name in the same commit as the suite.`);
}

const EXPECT_LEGS = EXPECT_DIRS.size;
if (!EXPECT_LEGS) {
  err('COVERAGE LOST — this checkout carries no <Category>/<Tool>/test/e2e/package.json, so the expected leg count is 0 and every run below would be graded against nothing.');
} else {
  console.log(`proof-fresh expects ${EXPECT_LEGS} e2e leg(s) per run, one each for ${[...EXPECT_DIRS].sort().join(', ')} — derived from this checkout by the discover rule and required above to equal the committed set in ${SUITES_FILE}`);
}

/* Offline injection, so the decision logic is exercisable without a token or a
   network. It banners, because its presence in a real CI log would mean
   nothing below is a statement about this repository. */
const FIXTURE = process.env.PROOF_ALARM_FIXTURE || '';
const NOW = process.env.PROOF_ALARM_NOW ? Date.parse(process.env.PROOF_ALARM_NOW) : Date.now();
let fixture = null;
if (FIXTURE) {
  try { fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')); }
  catch (e) { cannotRun(`PROOF_ALARM_FIXTURE ${FIXTURE} could not be read as JSON (${e.message}).`); }
  console.log(`::warning::PROOF_ALARM_FIXTURE is set (${FIXTURE}) — run history is INJECTED and nothing below is a statement about this repository.`);
}
if (Number.isNaN(NOW)) cannotRun('PROOF_ALARM_NOW is not a parseable date.');

const api = async p => {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('no GH_TOKEN in the environment — run history is unreadable, so this fails closed rather than certifying a timer it cannot see');
  const res = await fetch('https://api.github.com' + p, {
    headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-proof-fresh' }
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${p}`);
  return res.json();
};

(async () => {
  const repo = process.env.REPO || process.env.GITHUB_REPOSITORY || '';
  if (!fixture && !repo) throw new Error('REPO and GITHUB_REPOSITORY are both empty — the query would have been built against nothing');

  const runsPath = `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&event=schedule&per_page=${RUNS_PAGE_SIZE}`;
  const bodyJson = fixture ? fixture : await api(runsPath);
  const rows = bodyJson && bodyJson.workflow_runs;
  if (!Array.isArray(rows)) throw new Error('run list was not an array — an unreadable answer is a failure, not a pass');

  /* The server-side event filter is re-checked here. A filter that quietly
     stopped filtering would let hand-presses back in, which is the one thing
     this whole gate exists to exclude. */
  const sched = rows.filter(r => r && r.event === 'schedule' && r.created_at)
                    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (sched.length !== rows.length) {
    err(`the query asked for event=schedule and ${rows.length - sched.length} of ${rows.length} row(s) came back otherwise. The window is not what it says it is.`);
  }
  if (rows.length >= RUNS_PAGE_SIZE) {
    console.log(`::notice::the run page came back full (${rows.length} >= per_page ${RUNS_PAGE_SIZE}, the maximum). Only the GREEN limb can be affected, and only if its walk reaches the end.`);
  }

  /* ── LIMB 1: DID THE TIMER FIRE ───────────────────────────────────────── */
  if (!sched.length) {
    err(`no scheduled run of ${WORKFLOW} on ${BRANCH} is in the run history at all. Either the timer has never fired, or the workflow was renamed and this query is watching a name nothing uses.`);
  }
  let timerAge = null;
  if (sched.length) {
    timerAge = (NOW - Date.parse(sched[0].created_at)) / DAY;
    if (Number.isNaN(timerAge)) err(`newest scheduled run ${sched[0].id} has an unparseable created_at: ${sched[0].created_at}`);
    else if (timerAge > MAX_AGE_DAYS) err(`THE CRON IS DEAD OR DISABLED — the newest scheduled ${WORKFLOW} run (${sched[0].id}, ${sched[0].created_at}) fired ${timerAge.toFixed(1)} day(s) ago, ceiling ${MAX_AGE_DAYS}. A dispatch cannot clear this; only the timer can.`);
    else console.log(`proof-fresh TIMER ok  newest scheduled run ${sched[0].id} fired ${timerAge.toFixed(1)} day(s) ago (ceiling ${MAX_AGE_DAYS})`);
  }

  /* ── LIMB 2: WAS THE LAST THING IT PRODUCED GREEN ──────────────────────
     Read off the matrix legs of past runs, never off run conclusions. Green is
     the SET of `<cat>/<tool>` the legs name being EXPECT_DIRS exactly, all
     successful — not "some legs, all successful". Zero legs is the vacuous case
     a renamed job produces; a subset is the partial-discovery case a dropped
     tool produces; a same-size DIFFERENT set is the rename a count cannot see. */
  const jobsOf = async id => {
    if (fixture) return (fixture.jobs && fixture.jobs[String(id)]) || [];
    const j = await api(`/repos/${repo}/actions/runs/${id}/jobs?per_page=100`);
    return Array.isArray(j.jobs) ? j.jobs : [];
  };
  let green = null;
  let walked = 0;
  let sawLeg = false;
  let sawDir = false;
  for (const r of sched) {
    if (walked >= WALK_BACK) break;
    walked++;
    const legs = (await jobsOf(r.id)).filter(j => j && LEG.test(String(j.name)));
    if (legs.length) sawLeg = true;
    const covered = new Set();
    let unparseable = 0;
    for (const j of legs) {
      const d = legDirOf(String(j.name).trim());
      if (d) { covered.add(d); sawDir = true; } else unparseable++;
    }
    const missing = [...EXPECT_DIRS].filter(d => !covered.has(d)).sort();
    const surplus = [...covered].filter(d => !EXPECT_DIRS.has(d)).sort();
    /* `legs=2/1 GREEN`, exit 0 until 2026-08-27: a set collapses duplicates, a count does not. */
    const dupes = legs.length - covered.size - unparseable;
    const ok = EXPECT_LEGS > 0 && unparseable === 0 && dupes === 0 && legs.length === EXPECT_LEGS &&
               !missing.length && !surplus.length &&
               legs.every(j => j.conclusion === 'success');
    console.log(`proof-fresh run ${r.id}  ${r.created_at}  legs=${legs.length}/${EXPECT_LEGS}  ${ok ? 'GREEN' : 'not-green'}  [${legs.map(j => j.name + '=' + j.conclusion).join(', ') || 'no e2e leg'}]` +
      (missing.length ? `  NEVER EXERCISED: ${missing.join(', ')}` : '') +
      (surplus.length ? `  NOT IN THIS CHECKOUT: ${surplus.join(', ')}` : '') +
      (unparseable ? `  ${unparseable} leg name(s) yielded no <cat>/<tool>` : '') +
      (dupes ? `  ${dupes} DUPLICATE leg name(s) — ${legs.length} legs naming ${covered.size} dir(s)` : ''));
    if (ok) { green = r; break; }
  }
  /* If every matched leg name yielded nothing, the set this gate compares was
     EMPTY on every run — which is not "the legs are missing", it is "this gate
     stopped being able to read them". */
  if (sawLeg && !sawDir) {
    err(`COVERAGE LOST — job names matching ${LEG} were found in the newest ${walked} scheduled ${WORKFLOW} run(s), and not one of them yielded a <cat>/<tool> after the prefix. The set compared below was empty on every run, so the leg-name shape in ${WORKFLOW} has changed and this gate is reading nothing out of it.`);
  }
  let greenAge = null;
  if (!green) {
    err(`NO GREEN SCHEDULED RUN in the newest ${walked} scheduled ${WORKFLOW} run(s)${sched.length > walked ? ` (of ${sched.length} visible; the walk is capped at ${WALK_BACK})` : ''}. The weekly proof has been red, has run nothing, or did not run the ${EXPECT_LEGS} leg(s) this checkout expects, for every one of them.`);
  } else {
    greenAge = (NOW - Date.parse(green.created_at)) / DAY;
    if (greenAge > MAX_AGE_DAYS) err(`THE WEEKLY PROOF IS STALE — the newest scheduled run whose e2e legs all passed is ${green.id} (${green.created_at}), ${greenAge.toFixed(1)} day(s) old, ceiling ${MAX_AGE_DAYS}. The cron may well be firing; what it produces is red.`);
    else console.log(`proof-fresh GREEN ok  scheduled run ${green.id} passed every e2e leg ${greenAge.toFixed(1)} day(s) ago (ceiling ${MAX_AGE_DAYS})`);
  }

  if (red.length) {
    console.log(`::error::${red.length} freshness finding(s): ${red.join(' | ')}`);
    process.exit(1);
  }
  console.log(`proof-fresh ok — timer ${timerAge.toFixed(1)}d, green proof ${greenAge.toFixed(1)}d, both inside ${MAX_AGE_DAYS}d`);
})().catch(e => {
  console.log(`::error::proof-fresh COVERAGE LOST — ${e.message}. It could not read the run history, and a guard that cannot see the timer must not certify it.`);
  process.exit(2);
});
