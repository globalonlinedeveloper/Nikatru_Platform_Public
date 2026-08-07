#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-alert-disposition.mjs — no alert closes itself by being ignored.
//
// [pipeline 14]O-5. Requirement: "each firing is resolved, deferred with a
// reason, or converted into a tracked item, and the record of that decision is
// durable." Acceptance: "for every alerting source, the count of firings without
// a recorded disposition is zero — checked against the source's own API, not
// from memory."
//
// The operative replacement in the stage table narrows that to something a
// machine can actually falsify: each source DECLARES where its firing history is
// readable, the guard FAILS CLOSED when a declared source has none, and a
// disposition must be an EXPLICIT ACT — resolve, ignore-with-reason, or a linked
// issue THAT IS CLOSED. An auto-filed issue sitting open is therefore
// undispositioned, which is the true state and not a false alarm.
//
// ── WHY O-5's `Enforced by.` LINE WAS FALSE AT HEAD ─────────────────────────
// O-5 names "status.mjs (disposition limb)". Measured 2026-08-07:
// tooling/ops/status.mjs is 493 lines and the string `disposition` occurs ZERO
// times in it. There was no limb. The criterion quantified over a thing that did
// not exist — the same empty-domain defect stage 14 found eighteen times in its
// own audit — and it printed nothing at all, which reads as nothing wrong.
//
// ── THE TWO LIMBS, AND WHY ONLY ONE OF THEM FAILS THE BUILD ─────────────────
//
// LIMB A — STRUCTURAL, FAILS THE BUILD, FAILS CLOSED.
//   Does every alerting source in the TREE declare a readable firing history,
//   and is that declaration still true? This is the `check-migrations 5→4` class:
//   a source that silently drops out of the scanned set takes its own alarm with
//   it and the guard keeps printing ok over the survivors. Every narrowing here
//   is a hard failure — including the narrowing of THIS GUARD'S OWN MATCHER,
//   because a job whose title stopped being a literal is a source this scan can
//   no longer see.
//
// LIMB B — THE DISPOSITION GAP ITSELF. PRINTS. NEVER FAILS.
//   🔴 STATED WITH A DATE SO NOBODY LATER "FIXES" IT INTO A FAILURE.
//   On 2026-08-07 issue #24 ("Nightly E2E (live) is failing against production")
//   has been open 11 days while e2e.yml's scheduled runs on 08-05, 08-06 and
//   08-07 were all `success`. It is a genuine undispositioned firing. It is ALSO
//   only closable by a person: duty.workflow.e2e.yml's own `response` field says
//   "the issue is closed by a human, never automatically — closing it IS the
//   acknowledgement that someone looked." An agent closing it would FABRICATE
//   the exact signal this requirement measures, and a guard that failed on it
//   would redden `main` over an act only the owner may perform.
//   [pipeline C-6]: an owner-gated gap PRINTS on every run rather than failing
//   the build. Raising limb B to a failure is not a tightening — it is a merge
//   block on somebody else's inbox.
//
//   #151 ("Scheduled duty is not reporting healthy") is open too and is NOT a
//   gap: ops-watch.yml run 31162205780 failed today, so its issue tracking a
//   live red source is correctly open. Open-while-green and open-while-red are
//   opposite states and the guard must not average them.
//
// ⚠️ WHAT THIS GUARD DELIBERATELY DOES NOT DO
//   · NO COMMENT-COUNT HEURISTIC. #24 carries seven comments and every single
//     one is `github-actions[bot]` — the alerting job manufacturing its own
//     evidence of attention — while all seventeen GlitchTip issues sit at zero.
//     Comment count correlates with nothing and would score the bot's own noise
//     as human disposition.
//   · NO GLITCHTIP LIMB. GLITCHTIP_TOKEN is not a repository secret
//     (OWNER_QUEUE S-8), so a GlitchTip limb in CI would skip whenever the token
//     was absent — and a check that skips reports ok, which is the whole defect.
//     Reconciling GlitchTip stays a command run by hand
//     (tooling/ops/verify-monitors.mjs), exactly as [pipeline 11]E-9 settled it.
//   · NO TYPED MARKERS. The issue titles are DERIVED from tooling/ops/register.json
//     and cross-checked against the workflow that files them. Typing
//     'Nightly E2E (live) is failing against production' into this file would
//     make the guard agree with itself forever after the register moved on.
//
// FAILS CLOSED with no token. "I could not look" must never read as "it is
// fine" — that is how the original claim became unfalsifiable. Locally, with no
// GH_TOKEN, this exits non-zero by design, identically to
// assert-e2e-proof-fresh.mjs. In CI it uses the ambient GITHUB_TOKEN.
//
// Offline testing: --probe-file <json> --now <iso> injects the API answers so the
// decision logic runs for real with no network. It prints a loud banner so its
// presence in a real CI log is unmistakable.
//
// Usage:  node tooling/ci/assert-alert-disposition.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseAllWorkflows, WORKFLOW_DIR } from './workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTER_REL = 'tooling/ops/register.json';
const GH_API = 'https://api.github.com';
const DEFAULT_REPO = 'globalonlinedeveloper/Project_Cross_Platform_Apps';
const PROBE_TIMEOUT_MS = 15_000;
const ISSUE_PAGE_SIZE = 100;
const ISSUE_PAGE_CAP = 5;
const RUN_SAMPLE = 30;

/** The clause a register row uses to declare its durable issue. The TITLE is a
 *  capture, never a constant — see the header. Both live occurrences are
 *  `mechanism.record` strings ending `the reused issue titled '<TITLE>'`. */
const DECLARATION = /issue titled '([^']+)'/;

/** How a workflow job files that issue. Detected on the CREATE, because the
 *  create-or-comment pair always contains it; a job that only ever comments has
 *  no way to start the durable thread it depends on. */
const FILES_AN_ISSUE = /gh issue create\b/;

/** The literal the job matches on. `TITLE:` is real YAML, not a comment, so the
 *  comment-stripping in parseWorkflow cannot eat it. */
const TITLE_LITERAL = /^\s*TITLE:\s*(['"])(.+?)\1\s*$/;

function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

// ─── LIMB A · derivation ─────────────────────────────────────────────────────

/** Every job in the tree that files a GitHub issue, classified.
 *
 *  `alerting` is decided by ONE structural fact: the job is gated on
 *  `failure()`, so its running IS a firing. `ops-watch.yml`'s `digest` job also
 *  calls `gh issue create` and is NOT an alert — it runs `if: github.event.schedule
 *  == '45 7 * * 1' || workflow_dispatch`, i.e. on a timer regardless of health,
 *  so "Weekly ops digest" (#140) sitting open forever is its design and not an
 *  ignored alarm. The exclusion is COMPUTED and PRINTED, never a name in a
 *  skip-list. */
export function issueFilingJobs(root = ROOT) {
  const out = [];
  for (const wf of parseAllWorkflows(root)) {
    for (const job of wf.jobs.values()) {
      const body = job.lines.map((l) => l.text).join('\n');
      if (!FILES_AN_ISSUE.test(body)) continue;
      const titles = [];
      for (const l of job.lines) {
        const m = l.text.match(TITLE_LITERAL);
        if (m) titles.push({ title: m[2], n: l.n });
      }
      const cond = job.jobIf?.cond ?? '';
      out.push({
        workflow: wf.rel,
        job: job.name,
        cond,
        alerting: /\bfailure\(\)/.test(cond),
        titles,
      });
    }
  }
  return out;
}

/** Every register row that declares a durable issue as its firing record. */
export function declaredSources(root = ROOT) {
  const raw = readFileSync(join(root, REGISTER_REL), 'utf8');
  const register = JSON.parse(raw);
  const rows = Array.isArray(register?.rows) ? register.rows : [];
  return rows
    .map((r) => {
      const m = DECLARATION.exec(String(r?.mechanism?.record ?? ''));
      return m ? { id: r.id, title: m[1], anchor: r?.mechanism?.anchor ?? null } : null;
    })
    .filter(Boolean);
}

/** LIMB A. Both directions, plus this guard's own matcher.
 *
 *  Returns { problems, sources, nonAlerting }. `problems` non-empty ⇒ exit 1. */
export function reconcile(root = ROOT) {
  const problems = [];

  if (!existsSync(join(root, WORKFLOW_DIR))) {
    return { problems: [`COVERAGE LOST — ${WORKFLOW_DIR} does not exist, so this scan ranges over no workflow at all and would report clean for a repository with no alerting whatsoever.`], sources: [], nonAlerting: [] };
  }
  if (!existsSync(join(root, REGISTER_REL))) {
    return { problems: [`COVERAGE LOST — ${REGISTER_REL} does not exist. Every source declaration lives in it, so without it the declared set is empty and the identity below is vacuously satisfied.`], sources: [], nonAlerting: [] };
  }

  let declared;
  try {
    declared = declaredSources(root);
  } catch (e) {
    return { problems: [`COVERAGE LOST — ${REGISTER_REL} could not be parsed (${e.message}). An unreadable register is not an empty one.`], sources: [], nonAlerting: [] };
  }

  const filing = issueFilingJobs(root);
  // THE MATCHER'S OWN SELF-CHECK. If nobody in the tree matches FILES_AN_ISSUE
  // any more — a switch to actions/github-script, a rename, a refactor into a
  // composite action — then every check below ranges over the empty set and
  // prints ok. That is exactly the defect this stage exists to remove.
  if (filing.length === 0) {
    problems.push(
      `COVERAGE LOST — no job in ${WORKFLOW_DIR} matches ${FILES_AN_ISSUE}. Either this repository files no alerts at all, ` +
        'or the way it files them changed and this guard can no longer see any source. Both are indistinguishable from ' +
        'here, and both must stop the build rather than report clean over nothing.',
    );
  }

  const alerting = filing.filter((f) => f.alerting);
  const nonAlerting = filing.filter((f) => !f.alerting);

  // A job that files an issue but whose title is not a literal cannot be
  // reconciled with anything. Fail rather than drop it: an unclassifiable source
  // silently leaving the set is precisely the narrowing limb A is here to catch.
  for (const f of filing) {
    if (f.titles.length === 0) {
      problems.push(
        `${f.workflow} job '${f.job}' calls \`gh issue create\` but declares no literal \`TITLE:\`. Its issue title cannot be ` +
          'read from the tree, so it can be neither matched to a register declaration nor queried against the API — the source ' +
          'would leave the scanned set without anything going red.',
      );
    }
  }

  const alertTitles = new Map();
  for (const f of alerting) for (const t of f.titles) alertTitles.set(t.title, f);

  if (alertTitles.size === 0 && filing.length > 0) {
    problems.push(
      `COVERAGE LOST — ${filing.length} job(s) file issues and NOT ONE is gated on \`failure()\`, so this guard sees zero ` +
        'alerting sources. An alert whose firing condition was widened to "always" stops being a firing record, and the ' +
        'disposition question below would then range over nothing.',
    );
  }

  const declaredTitles = new Map(declared.map((d) => [d.title, d]));
  if (declaredTitles.size === 0) {
    problems.push(
      `COVERAGE LOST — no row in ${REGISTER_REL} declares a durable issue (no \`mechanism.record\` matches ${DECLARATION}). ` +
        'The register is where a source declares WHERE its firing history is readable; with no declaration there is nothing ' +
        'to read and nothing to check.',
    );
  }

  // → direction 1: the tree has an alerting source the register never declared.
  for (const [title, f] of alertTitles) {
    const d = declaredTitles.get(title);
    if (!d) {
      problems.push(
        `${f.workflow} job '${f.job}' files the durable issue "${title}" on failure, but NO row in ${REGISTER_REL} declares it. ` +
          'A source whose firing history is not declared has nowhere its dispositions are checked — this is the declaration ' +
          "clause failing closed, and the fix is a `mechanism.record` naming the issue, not a widening here.",
      );
      continue;
    }
    if (d.anchor !== f.workflow) {
      problems.push(
        `${REGISTER_REL} row '${d.id}' declares the issue "${title}" but anchors at ${d.anchor ?? '(nothing)'}, while the job that ` +
          `actually files it is '${f.job}' in ${f.workflow}. The anchor is what this guard reads run history from, so a crossed ` +
          "pair reports one source's health against another's alarm.",
      );
    }
  }

  // → direction 2: the register declares a source the tree no longer has. This
  //   is the mutation that matters. Deleting the `the reused issue titled '…'`
  //   clause from a row narrows the declared set from 2 to 1 and every remaining
  //   check still passes over the survivor — which is how a source disappears
  //   while CI stays green.
  for (const [title, d] of declaredTitles) {
    if (!alertTitles.has(title)) {
      const nonAlert = nonAlerting.find((f) => f.titles.some((t) => t.title === title));
      problems.push(
        `${REGISTER_REL} row '${d.id}' declares its firing record as the issue "${title}", but no \`failure()\`-gated job in ` +
          `${WORKFLOW_DIR} files it` +
          (nonAlert ? ` (${nonAlert.workflow} job '${nonAlert.job}' does, but it is not gated on failure() — it is a digest, not an alarm)` : '') +
          '. A declared source with no firing log is unreadable, and the acceptance is checked against the source\'s own API, ' +
          'which there is now no API to check.',
      );
    }
  }

  const sources = [];
  for (const [title, f] of alertTitles) {
    const d = declaredTitles.get(title);
    if (d && d.anchor === f.workflow) sources.push({ ...d, workflow: f.workflow, job: f.job });
  }
  sources.sort((a, b) => a.id.localeCompare(b.id));
  return { problems, sources, nonAlerting };
}

// ─── LIMB B · the disposition verdict, kept pure ─────────────────────────────

/** Health of a source, from its OWN run history. Only SCHEDULED runs count: the
 *  alert job is gated on `github.event_name == 'schedule'`, so a hand-pressed
 *  green says nothing about the alarm. Two `workflow_dispatch` runs went green
 *  on 2026-08-01 in the middle of a six-night outage; counting them would have
 *  reported the nightly healthy on its worst night. */
export function sourceHealth(runs) {
  if (!Array.isArray(runs)) return { state: 'unreadable', why: 'run list was not an array' };
  const scheduled = runs
    .filter((r) => r && r.event === 'schedule' && r.created_at)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (scheduled.length === 0) return { state: 'unreadable', why: 'no scheduled run in the sampled history' };
  const newest = scheduled[0];
  const firings = scheduled.filter((r) => r.conclusion === 'failure').length;
  if (newest.conclusion === 'success') return { state: 'green', newest, firings, sampled: scheduled.length };
  if (newest.conclusion === 'failure') return { state: 'red', newest, firings, sampled: scheduled.length };
  // in_progress, cancelled, skipped, null — a state that is neither. Say so
  // rather than rounding it to either; an unknown health scored as green would
  // print a gap that is not one, and scored as red would hide one that is.
  return { state: 'indeterminate', newest, firings, sampled: scheduled.length, why: `newest scheduled run concluded '${newest.conclusion}'` };
}

/** THE DISPOSITION VERDICT.
 *
 *  An OPEN auto-filed issue is undispositioned by definition — closing it is the
 *  explicit act. What the source's health decides is whether that is a GAP or
 *  simply a live alarm doing its job:
 *
 *    open + source green  → UNDISPOSITIONED. The condition cleared and nobody
 *                           acknowledged it. This is #24 today.
 *    open + source red    → ACTIVE. Correctly open. NOT a gap. This is #151.
 *    open + indeterminate → reported as such, claimed as neither.
 *
 *  Nothing here sets an exit code. See the header for why. */
export function classify(issue, health, nowMs) {
  const ageDays = (nowMs - Date.parse(issue.created_at)) / 86_400_000;
  const base = { number: issue.number, title: issue.title, ageDays, health: health.state };
  if (health.state === 'green') return { ...base, verdict: 'undispositioned' };
  if (health.state === 'red') return { ...base, verdict: 'active' };
  return { ...base, verdict: 'indeterminate' };
}

// ─── the boring half: the API ────────────────────────────────────────────────

const ghToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

async function ghJson(path) {
  const res = await fetch(`${GH_API}${path}`, {
    headers: {
      authorization: `Bearer ${ghToken()}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'nikatru-alert-disposition',
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${path}`);
  return res.json();
}

/** Every OPEN issue, paginated. The `search` endpoint is deliberately NOT used:
 *  it matches fuzzily and it lags its own index, and a marker that must match
 *  EXACTLY (the workflow does `select(.title == env.TITLE)`) cannot be resolved
 *  through a relevance ranking. Hitting the page cap without exhausting is an
 *  ENUMERATION FAILURE, not an empty answer — it fails closed. */
async function fetchOpenIssues(repo) {
  const all = [];
  for (let page = 1; page <= ISSUE_PAGE_CAP; page++) {
    const body = await ghJson(`/repos/${repo}/issues?state=open&per_page=${ISSUE_PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(body)) throw new Error('issue list was not an array');
    all.push(...body.filter((i) => !i.pull_request));
    if (body.length < ISSUE_PAGE_SIZE) return all;
  }
  throw new Error(`more than ${ISSUE_PAGE_CAP * ISSUE_PAGE_SIZE} open issues — this enumeration is truncated and cannot claim to have seen every firing`);
}

async function fetchRuns(repo, workflowFile) {
  const body = await ghJson(`/repos/${repo}/actions/workflows/${workflowFile}/runs?per_page=${RUN_SAMPLE}`);
  if (!Array.isArray(body?.workflow_runs)) throw new Error('run history was not an array');
  return body.workflow_runs;
}

async function main() {
  const probeFile = flag('--probe-file');
  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`FAIL  --now ${nowFlag} is not a parseable timestamp`);
    process.exit(1);
  }

  const { problems, sources, nonAlerting } = reconcile(ROOT);

  console.log('[14]O-5 — every alerting source declares a readable firing history, and every firing is dispositioned.');
  for (const f of nonAlerting) {
    for (const t of f.titles) {
      console.log(`   ·  not an alert: ${f.workflow} job '${f.job}' files "${t.title}" on \`${f.cond || '(no condition)'}\` — a timer, not a failure gate.`);
    }
  }

  if (problems.length) {
    console.error(`\n✗ ${problems.length} structural problem(s) — limb A:`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  console.log(`✓ limb A — ${sources.length} alerting source(s), each declared with a readable firing history:`);
  for (const s of sources) console.log(`   ·  ${s.id} → "${s.title}" filed by job '${s.job}' in ${s.workflow}`);

  // ── the firing history must actually be readable. No token, a non-200, a
  //    truncated page walk: all limb A failures. "I could not look" is not "fine".
  let issues;
  const runsByWorkflow = new Map();
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;

  if (probeFile) {
    console.log(`\n⚠️  --probe-file ${probeFile} — API ANSWERS ARE INJECTED. This is a TEST RUN, not a live check.`);
    const probe = JSON.parse(readFileSync(probeFile, 'utf8'));
    if (probe.issuesError) {
      console.error(`\n✗ limb A — the firing history is NOT readable: ${probe.issuesError}`);
      process.exit(1);
    }
    issues = probe.issues;
    for (const s of sources) runsByWorkflow.set(s.workflow, probe.runs?.[s.workflow.split('/').pop()]);
  } else {
    if (!ghToken()) {
      console.error(
        '\n✗ limb A — neither GITHUB_TOKEN nor GH_TOKEN is in the environment, so no declared firing history could be read. ' +
          'This FAILS CLOSED on purpose: an unreadable source is the state O-5 exists to catch, and reporting ok here would ' +
          'mean the guard passes hardest exactly when it can see least.',
      );
      process.exit(1);
    }
    try {
      issues = await fetchOpenIssues(repo);
      for (const s of sources) runsByWorkflow.set(s.workflow, await fetchRuns(repo, s.workflow.split('/').pop()));
    } catch (e) {
      console.error(`\n✗ limb A — a declared firing history could not be enumerated: ${e.message}`);
      process.exit(1);
    }
  }

  if (!Array.isArray(issues)) {
    console.error('\n✗ limb A — the open-issue enumeration did not return a list, so no firing can be shown to have a disposition.');
    process.exit(1);
  }

  const verdicts = [];
  for (const s of sources) {
    const health = sourceHealth(runsByWorkflow.get(s.workflow));
    if (health.state === 'unreadable') {
      console.error(`\n✗ limb A — ${s.id} declares ${s.workflow} as its firing history and it could not be read: ${health.why}.`);
      process.exit(1);
    }
    const open = issues.filter((i) => i.title === s.title);
    console.log(
      `\n   ${s.id} — source is ${health.state.toUpperCase()} (newest scheduled run ${health.newest.id ?? '?'} = ${health.newest.conclusion}; ` +
        `${health.firings} failure(s) in the last ${health.sampled} scheduled runs); ${open.length} open issue(s) titled "${s.title}".`,
    );
    for (const i of open) verdicts.push({ source: s, ...classify(i, health, nowMs) });
  }

  const gaps = verdicts.filter((v) => v.verdict === 'undispositioned');
  const active = verdicts.filter((v) => v.verdict === 'active');
  const unknown = verdicts.filter((v) => v.verdict === 'indeterminate');

  for (const v of active) {
    console.log(`\n✓ limb B — #${v.number} is open and its source is RED right now. Correctly open; a live alarm is not an ignored one.`);
  }
  for (const v of unknown) {
    console.log(`\n⚠  limb B — #${v.number} is open and its source's newest scheduled run is neither success nor failure. Neither state is claimed.`);
  }

  if (gaps.length === 0) {
    console.log('\n✓ limb B — no issue is open against a source that is reporting healthy. Every firing has been dispositioned.');
    return;
  }

  console.log(`\n⬜ limb B — ${gaps.length} UNDISPOSITIONED FIRING(S). This PRINTS and does not fail the build; see below.`);
  for (const v of gaps) {
    console.log(
      `   ⬜ #${v.number} "${v.title}" — open ${v.ageDays.toFixed(1)} day(s), while ${v.source.workflow}'s newest SCHEDULED run is a SUCCESS. ` +
        'The condition cleared and nobody acknowledged it, so the firing has no recorded disposition.',
    );
  }
  console.log(
    '\n   WHY THIS PRINTS RATHER THAN FAILS — recorded 2026-08-07, do not "fix" it into a failure:\n' +
      '   The register states the disposition IS a human closing the issue ("closing it IS the acknowledgement that someone\n' +
      '   looked"). Closing it from CI, or from an agent, would fabricate the very signal this requirement measures, and\n' +
      '   failing the build would block every merge in the repository on an act only the owner may perform.\n' +
      '   [pipeline C-6]: an owner-gated gap prints on every run. The remedy is to READ the issue and close it, by hand.',
  );
}

// Only run when executed directly, so the pure halves can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main().catch((e) => {
    console.error(`FAIL  ${e.stack || e.message}`);
    process.exit(1);
  });
}
