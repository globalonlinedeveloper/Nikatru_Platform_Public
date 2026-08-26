#!/usr/bin/env node
/* assert-e2e-proof-fresh.mjs — is the weekly e2e proof still being produced?
 *
 * WHY IT IS HERE AND NOT ONLY IN e2e.yml. The `proof-fresh` job in
 * .github/workflows/e2e.yml asks these same two questions, and its header is
 * the reasoning for all of it — including the paragraph headed "MAX_AGE_DAYS =
 * 15, DERIVED FROM THE CRON RATHER THAN CHOSEN", which is why the ceiling here
 * is 15 and not 14. But that job runs inside e2e.yml, which fires on its own
 * weekly cron, on workflow_dispatch, or on a `run-e2e` label that this
 * repository does not define. So a dead cron silences its own alarm. This copy
 * is called from ci.yml, on every push to main and on every pull request.
 *
 * ADVISORY. main in this repository has no branch protection and no rulesets,
 * so a red here reddens a check and blocks nothing.
 *
 * Exit 0 = the timer fired inside the ceiling AND the newest scheduled run
 * whose e2e legs all passed is inside it too.  Exit 1 = one of those is false.
 * Exit 2 = the gate could not run, which is never reported as health.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = 'e2e.yml';
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

/* ── SELF-CHECK: THE CEILING IS DERIVED, SO THE CRON IS LOAD-BEARING ────────
   Full-line comments are dropped first. */
const wfPath = process.env.PROOF_ALARM_WORKFLOW || path.join(ROOT, '.github', 'workflows', WORKFLOW);
let raw = '';
try { raw = fs.readFileSync(wfPath, 'utf8'); }
catch (e) { cannotRun(`could not read ${wfPath} (${e.message}). The ceiling is derived from that file's cron, so with the file unreadable there is nothing to derive it from.`); }
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
     Read off the matrix legs of past runs, never off run conclusions. A run
     with ZERO matching legs is NOT green: a vacuous `every` over an empty
     list is exactly how a renamed job would report health. */
  const jobsOf = async id => {
    if (fixture) return (fixture.jobs && fixture.jobs[String(id)]) || [];
    const j = await api(`/repos/${repo}/actions/runs/${id}/jobs?per_page=100`);
    return Array.isArray(j.jobs) ? j.jobs : [];
  };
  let green = null;
  let walked = 0;
  for (const r of sched) {
    if (walked >= WALK_BACK) break;
    walked++;
    const legs = (await jobsOf(r.id)).filter(j => j && LEG.test(String(j.name)));
    const ok = legs.length > 0 && legs.every(j => j.conclusion === 'success');
    console.log(`proof-fresh run ${r.id}  ${r.created_at}  legs=${legs.length}  ${ok ? 'GREEN' : 'not-green'}  [${legs.map(j => j.name + '=' + j.conclusion).join(', ') || 'no e2e leg'}]`);
    if (ok) { green = r; break; }
  }
  let greenAge = null;
  if (!green) {
    err(`NO GREEN SCHEDULED RUN in the newest ${walked} scheduled ${WORKFLOW} run(s)${sched.length > walked ? ` (of ${sched.length} visible; the walk is capped at ${WALK_BACK})` : ''}. The weekly proof has been red, or has run nothing, for every one of them.`);
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
