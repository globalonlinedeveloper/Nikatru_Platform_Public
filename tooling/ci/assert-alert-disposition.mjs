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
//   An open auto-filed issue is undispositioned, and the register says the
//   disposition IS a person closing it: duty.workflow.e2e.yml's own `response`
//   field reads "the issue is closed by a human, never automatically — closing
//   it IS the acknowledgement that someone looked." An agent closing one would
//   FABRICATE the exact signal this requirement measures, and a guard that
//   failed on it would redden `main` over an act only the owner may perform.
//   [pipeline C-6]: an owner-gated gap PRINTS on every run rather than failing
//   the build. Raising limb B to a failure is not a tightening — it is a merge
//   block on somebody else's inbox.
//
//   Open-while-green and open-while-red are OPPOSITE states and the guard must
//   not average them. Which one it is, is decided by the SOURCE'S OWN run
//   history, never by anything on the issue:
//     open + source GREEN → a gap. The condition cleared, nobody acknowledged it.
//     open + source RED   → correctly open. A live alarm is not an ignored one.
//   Both were observed in the SAME run on 2026-08-07 — the e2e thread open 11
//   days across three consecutive scheduled `success` runs (08-05/06/07), and
//   the ops-watch thread open against a source whose run 31162205780 had failed
//   that morning. Both were closed by the owner on 2026-08-09. That sentence
//   names neither thread by issue number, on purpose; see the DECISION below.
//
// ⚠️ WHAT THIS GUARD DELIBERATELY DOES NOT DO
//   · NO COMMENT-COUNT HEURISTIC. Measured 2026-08-07: the then-open e2e thread
//     carried seven comments and every single one was `github-actions[bot]` —
//     the alerting job manufacturing its own evidence of attention — while all
//     seventeen GlitchTip issues sat at zero. Comment count correlates with
//     nothing and would score the bot's own noise as human disposition.
//     Re-measured 2026-08-12, and the re-measurement makes the point harder:
//     that thread ended at nine comments, EIGHT of them the bot, and the single
//     human comment was the close. A comment heuristic would have ranked it
//     "attended to" from day one and then scored the actual disposition — the
//     only human act in the whole thread — as one more tick.
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
// ── 🔴 NO ISSUE NUMBER APPEARS IN THIS FILE AS A POINTER · DECIDED 2026-08-12 ──
//   Two citations here, and four in tooling/ops/register.json, named issues by
//   NUMBER. Every one of them had rotted and nothing said so, because the
//   mechanism joins on TITLE and never on number: ops-watch.yml files with
//   `gh issue create --title "$TITLE"`, matches with `select(.title == env.TITLE)`,
//   and this guard DERIVES that title from the register's declaration clause.
//   NO CODE IN THIS TREE HAS EVER READ AN ISSUE NUMBER. Every number printed
//   below is resolved from the API at run time and stored nowhere.
//
//   The choice was (a) re-point at the live number and add a limb that fails
//   when a cited number closes, or (b) delete the numbers and cite the mechanism
//   the guard actually matches on. TOOK (b). The deciding measurement is that a
//   number's lifetime here IS the disposition interval, so it goes stale exactly
//   when the system is working. Enumerated 2026-08-12 over the repository's
//   entire issue history (7 non-PR issues):
//     'Scheduled duty is not reporting healthy'          → #151, #264, #307
//        three numbers in eight days; #151 closed 08-09, #264 closed 08-10.
//     'Nightly E2E (live) is failing against production' → #24, #295
//        #295 was opened 08-11T04:46Z and closed 08-11T12:41Z — alive 7h55m.
//     'Weekly ops digest'                                → #140, and only #140
//        never closed, therefore never recycled.
//   The one title that never took a second number is the one nobody ever
//   dispositions. Re-pointing at the live number would buy a citation with an
//   expected life of about two days, which is why (a) needs a new limb to stay
//   honest and (b) needs none.
//
//   WHAT REPLACED THE NUMBERS is a citation to the register ROW that declares
//   the thread. That is not a softer reference, it is a HARDER one: limb A
//   already fails the build in BOTH directions when a declaring row drops its
//   clause or the workflow stops filing that title. NEGATIVE-TESTED 2026-08-12,
//   and the trees are named because "all fixtures passed" is not proof:
//     · declaration clause deleted from the LIVE tooling/ops/register.json →
//       EXIT 1, "files the durable issue … but NO row … declares it"; restored
//       and confirmed byte-identical.
//     · `TITLE:` in ops-watch.yml changed to a title no row declares, on an
//       isolated `git archive HEAD` copy of the committed tree (not a
//       hand-written fixture, and not the live file — another agent owns it) →
//       EXIT 1 in BOTH directions at once.
//     · every `the reused issue titled` clause removed → COVERAGE LOST, EXIT 1.
//   The replacement citation is guarded; the numbers never were.
//
//   THE ONE SURVIVING NUMBER, and why it is not an exception to the rule.
//   register.json's `duty.platform-cron.absenceWatcher.downTransitionDrill.evidence`
//   still says #151. There the number is a DATED PRIMARY EVIDENCE RECORD — an
//   immutable identifier for one specific past object — and that IS information
//   the title cannot carry, because the title is a class with three members and
//   "the issue titled X" no longer resolves to one thing. It is stamped with its
//   closure date so it cannot be misread as live, and it is now the only GitHub
//   ISSUE number left anywhere in the register. One archival anchor, no live
//   pointers.
//   The register's other `#N` tokens were checked on 2026-08-12 and are NOT this
//   class, which is why they were left alone: #189/#203/#256 are MERGED PULL
//   REQUESTS (immutable, and #189 is carried beside its commit 5dc6b67), and
//   #21/#25/#54 are decision-record and research-section numbers in a different
//   namespace entirely. A merged PR cannot rot; a reused issue number is rotting
//   already.
//
//   A LIMB WAS CONSIDERED AND DECLINED — recorded so nobody re-derives its
//   absence as an oversight. "FAIL when a declared title has NEVER been filed"
//   would close the one hole (b) leaves: the register and the workflow drifting
//   TOGETHER onto a title nothing files, after which limb A agrees with itself
//   forever and limb B reports every firing dispositioned over an empty set. It
//   needs a `state=all` enumeration, which changes the `--probe-file` contract
//   that tooling/ci/test/alert-disposition.test.mjs builds all its fixtures
//   against — a file outside this change's remit. Named as the next increment
//   rather than half-built.
//   The limb option (a) called for — "fail when a cited issue number is closed"
//   — was NOT built and must not be: under (b) the only number left is archival
//   and CORRECTLY closed, so that limb would be permanently red or would have to
//   exempt the sole citation it could see. An assertion that cannot fail is
//   worse than none.
//
// FAILS CLOSED with no token. "I could not look" must never read as "it is
// fine" — that is how the original claim became unfalsifiable. Locally, with no
// GH_TOKEN, this exits non-zero by design, identically to
// assert-e2e-proof-fresh.mjs. In CI it uses the ambient GITHUB_TOKEN.
//
// EXIT CODES — and the distinction that was missing until 2026-09-09:
//   0  every declared firing has a disposition (limb B may still PRINT gaps).
//   1  an ANSWERED negative: the declaration is structurally wrong, or a
//      declared source has no readable declaration behind it.
//   2  COVERAGE LOST — the firing history was not read at all (no token, a
//      non-200 such as a 403 rate limit, a timeout, a truncated page walk).
//      Non-zero, so nothing is waived; distinct, so a transient outage cannot be
//      reported as a finding about the alerting. See `unreadable()` below.
//
// LIMB C (2026-09-30) makes CodeQL a declared source: every open code-scanning
// alert is fixed in code or carries an entry in tooling/ci/codeql-dispositions.json,
// and an undispositioned one FAILS (exit 1). Its rules are at the end of the file.
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
import { PLATFORM_REPO_SLUG } from '../generated/codehost.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTER_REL = 'tooling/ops/register.json';
const GH_API = 'https://api.github.com';
// 🔴 REPOINTED 2026-08-20. This read `Nikatru_Android_Apps_Public`, which
// `gh repo list` shows is NOT A LIVE REPOSITORY — the owner renamed it again after
// the 2026-08-19 pass that put it here. A RENAME FREES THE OLD NAME. GitHub follows
// rename redirects, so a read against the freed name answers 200 and this looked
// fine; the day somebody re-claims it, this guard reads a STRANGER'S repository and
// reports on it as if it were ours. Verify a repo name with `gh repo list`, never
// with `gh api repos/<owner>/<name>` — the redirect makes the dead name answer.
const DEFAULT_REPO = PLATFORM_REPO_SLUG;
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
 *  so its weekly digest thread sitting open forever is its design and not an
 *  ignored alarm. The exclusion is COMPUTED and PRINTED, never a name in a
 *  skip-list — and the thread is named by its filing job, not by an issue
 *  number, for the reason in the DECISION note in the header. */
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
 *                           acknowledged it.
 *    open + source red    → ACTIVE. Correctly open. NOT a gap.
 *    open + indeterminate → reported as such, claimed as neither.
 *
 *  NO WORKED EXAMPLE BY ISSUE NUMBER, deliberately: `issue.number` is read off
 *  the API argument on the line that prints it and is never written down. A
 *  number in this comment would be a pointer with no backlink to the object it
 *  names — see the DECISION note in the header.
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

/** 🔴 "I COULD NOT LOOK" IS ITS OWN EXIT CODE, AND IT IS **2**.
 *
 *  Limb A has always refused to pass when the firing history is unreadable —
 *  that half was right and is not being weakened here. What it got WRONG was the
 *  CODE it refused with: every readability failure exited **1**, the same code
 *  this file uses for "a declared source is genuinely broken". A caller reading
 *  the exit code therefore could not tell an ANSWERED negative from an
 *  UNANSWERED query, and graded the second as the first.
 *
 *  That cost a real outage. On 2026-09-09 the GitHub API answered
 *  `403 API rate limit exceeded for installation` to CI's ambient token. The
 *  history was not bad — it was not READ. `assert-ops-register.mjs`, asked the
 *  same question by the same runner, printed its unreadable rows and carried on;
 *  this guard exited 1 and the disposition step read as a definite negative, so
 *  the `Guards` job called the repository non-compliant over a transient rate
 *  limit. #604 fixed the identical confusion in `check-pages-deployments.mjs`,
 *  where `git merge-base --is-ancestor` exit 128 ("the object is not here") was
 *  being read as its exit 1 ("not an ancestor").
 *
 *  The platform rule is `C-COVERAGE-LOST-IS-NOT-PASS` in
 *  `platform-state/constraints.json`: a guard exits 2 when it did not check
 *  enough to be evidence, so "I compared nothing" can share a code with neither
 *  "every floor holds" (0) nor "a floor broke" (1).
 *
 *  ⚠️ THIS IS NOT A WAIVER AND MUST NEVER BECOME ONE. 2 is non-zero; the step
 *  still fails. Nothing here lets an unread history report clean — the ONLY
 *  thing that changes is that a reader of the code can now tell which of the two
 *  refusals happened. "Never a pass, and never a definite negative either."
 *
 *  ⚠️ THE FILE'S OTHER EXIT-1 CALL SITES ARE LEFT ALONE ON PURPOSE, for the
 *  reason `assert-ops-register.mjs` records beside its own `coverageLost`:
 *  `reconcile()`'s structural verdicts are STATEMENTS ABOUT THIS REPOSITORY'S
 *  OWN CONTENT — a register that declares no source, a workflow directory that
 *  is gone — which a query DID answer. Those are negatives, not silences, and
 *  they keep code 1. The split this helper draws is answered-vs-unanswered, not
 *  severity. */
const unreadable = (lines) => {
  console.error(`\n✗ COVERAGE LOST (exit 2) — limb A did not read the firing history, so it is claiming NOTHING about it.`);
  for (const l of lines) console.error(`  ${l}`);
  console.error(
    '  This is NOT "the alerting is fine" and NOT "the alerting is broken". It is "the question went ' +
      'unanswered on this runner". A transient GitHub 403 (rate limit) is the common cause and it clears ' +
      'by itself; re-run the job rather than editing anything.',
  );
  process.exit(2);
};

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

// ⏱ 2026-10-01 — `event=schedule` IN THE QUERY. Limb A grades only scheduled runs (`sourceHealth`), but the page was
// the newest RUN_SAMPLE runs of ANY event. On 2026-10-01 the landers' E2E-on-the-PR-head dispatches (v16) filled
// e2e.yml's newest 30 with workflow_dispatch runs, the nightly scheduled run fell off the page, and every PR read
// "COVERAGE LOST — no scheduled run in the sampled history" (#1107, run 36839022640). The more a workflow is
// dispatched by hand, the sooner that happens; filtering on the server makes the page hold ONLY what is graded.
// run-page-anchor.mjs applies `event=` to its cross-read and second source (`runQueryPredicate`).
/** PURE. The firing-history query of one source: SCHEDULED runs only (see above). Exported for its red test. */
export function firingHistoryUrl(repo, workflowFile) {
  return `${GH_API}/repos/${repo}/actions/workflows/${workflowFile}/runs?event=schedule&per_page=${RUN_SAMPLE}`;
}
async function fetchRuns(repo, workflowFile) {
  const read = await anchoredRunRead({ workflow: workflowFile, url: firingHistoryUrl(repo, workflowFile), token: ghToken(), label: `${workflowFile} runs`, userAgent: 'nikatru-alert-disposition' });
  console.log(`   ·  ${workflowFile}: ${describeRead(read, newestScheduled)}`);
  return read.union; // ⏱ 2026-09-28 — anchored like every freshness reader; see the file end
}

async function main() {
  const probeFile = flag('--probe-file');
  // `--limb C` runs limb C alone: the last step of codeql.yml's `analyze` job, after
  // each analysis of main. That job holds `security-events: write` (which includes
  // the read limb C needs) and none of the scopes limb A reads.
  const only = flag('--limb');
  if (only !== null) {
    if (only !== 'C') {
      console.error(`FAIL  --limb ${only}: only limb C runs alone (limbs A and B share one read)`);
      process.exit(1);
    }
    await limbC(probeFile);
    return;
  }
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
      unreadable([`limb A — the firing history is NOT readable: ${probe.issuesError}`]);
    }
    issues = probe.issues;
    for (const s of sources) runsByWorkflow.set(s.workflow, probe.runs?.[s.workflow.split('/').pop()]);
  } else {
    if (!ghToken()) {
      unreadable([
        'limb A — neither GITHUB_TOKEN nor GH_TOKEN is in the environment, so no declared firing history could be read.',
        'This FAILS CLOSED on purpose: an unreadable source is the state O-5 exists to catch, and reporting ok here would',
        'mean the guard passes hardest exactly when it can see least.',
      ]);
    }
    try {
      issues = await fetchOpenIssues(repo);
      for (const s of sources) runsByWorkflow.set(s.workflow, await fetchRuns(repo, s.workflow.split('/').pop()));
    } catch (e) {
      // 🔴 THE CALL SITE THIS WHOLE CHANGE IS FOR. Every network failure lands
      // here — 403 rate limit, 5xx, DNS, the AbortSignal timeout, a truncated
      // page walk. Not one of them is an observation about the alerting.
      unreadable([`limb A — a declared firing history could not be enumerated: ${e.message}`]);
    }
  }

  if (!Array.isArray(issues)) {
    unreadable(['limb A — the open-issue enumeration did not return a list, so no firing can be shown to have a disposition.']);
  }

  const verdicts = [];
  for (const s of sources) {
    const health = sourceHealth(runsByWorkflow.get(s.workflow));
    if (health.state === 'unreadable') {
      unreadable([`limb A — ${s.id} declares ${s.workflow} as its firing history and it could not be read: ${health.why}.`]);
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
  } else {
    printGaps(gaps);
  }

  await limbC(probeFile);
}

function printGaps(gaps) {
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-28 · THE RUN HISTORY IS READ THROUGH THE SHARED ANCHORED READER.
// `sourceHealth` grades the NEWEST scheduled run, which is a freshness question:
// a stale page (GitHub served ops-watch.yml and ci.yml pages days old on
// 2026-09-28, main CI 36409128416 attempt 2) would grade a source by a run that
// is no longer its newest — reading a cleared alarm as ACTIVE, or a live one as
// UNDISPOSITIONED. So `fetchRuns` reads through tooling/ci/anchored-run-read.mjs:
// the same bounded page, the creation-date cross-read and the unfiltered
// repository-wide list, and the UNION of them is graded. A read that could not
// be made throws `CouldNotLook`, which lands in main's catch as COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { anchoredRunRead, describeRead } from './anchored-run-read.mjs';

/** PURE. The newest scheduled run of a list, for the read line. */
function newestScheduled(runs) {
  return (runs ?? []).filter((r) => r && r.event === 'schedule' && r.created_at).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── LIMB C · CODEQL — EVERY OPEN CODE-SCANNING ALERT CARRIES A DISPOSITION ────
// Added 2026-09-30. Measured that morning: 160 open CodeQL alerts (35 high, 79
// medium, 8 warning, 38 note), growing about 7 a day, and nothing in the tree
// graded them — codeql.yml is an alert sink by design, and this guard did not
// list code scanning as a source. The ops-watch reader
// (tooling/ops/check-code-scanning-age.mjs) pages only a high alert past a week,
// once a week, and never fails a merge, so a medium or a note aged forever.
//
// THE RULE. Every OPEN alert on the default branch is either FIXED IN CODE, or
// has one entry in tooling/ci/codeql-dispositions.json that says why it stays:
//   · `by-design`     — the flagged flow is the script's purpose. For the two
//                       flow rules (js/file-access-to-http, js/http-to-file-access)
//                       the entry must name the HOST, because "it sends a
//                       credential to its own issuer" is only true for one host.
//   · `fixed-in-tree` — the code is fixed on this branch, and the alert is still
//                       open only because CodeQL has not yet analysed a default-
//                       branch commit carrying the fix. Without this kind the PR
//                       that fixes an alert could never pass: the guard reads
//                       main's alerts, and main still has it open.
// A DISMISSED alert is dispositioned by GitHub itself when it carries a reason,
// and is graded exactly like an open one when it does not (the same rule as
// check-code-scanning-age.mjs's isTriaged).
//
// WHAT FAILS (exit 1):
//   · an open alert, or a dismissed-with-no-reason alert, with no entry;
//   · an entry whose rule or path is not the live alert's — it dispositions a
//     DIFFERENT alert than the one its number now names;
//   · a `fixed-in-tree` claim that CodeQL already disproved: the commit main's
//     analysis last saw the alert at CONTAINS the claim (read with `git show`),
//     and the alert is still open. A claim is falsifiable, or it is not a claim.
//   · a `by-design` entry for any rule but the two flow rules (lead ruling
//     2026-09-30: everything else is fixed in code);
//   · a malformed file (answered negatives about this tree's own content).
// WHAT PRINTS (exit 0) — a STALE entry, naming an alert that is neither open nor
//   dismissed (fixed, or gone). It cannot fail: the fixing PR must KEEP its entry
//   until main's analysis marks the alert fixed, so the entry goes stale only
//   after the merge — failing on it would redden main over the fix working.
//   Delete stale entries when they print.
// COVERAGE LOST (exit 2): no token, the API refused (the job needs
//   `security-events: read`), a truncated page walk, an alert of the wrong shape.
//
// The lead applies GitHub dismissals FROM this file, after review; nothing here
// writes to the API. `--probe-file` answers limb C through `codeql: { open,
// dismissed }` (or `codeqlError`), and `codeqlClaims: { "<sha>": [n, ...] }`
// stands in for `git show`; a probe with no `codeql` key is COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { readAlerts, shapeProblem, isTriaged, CouldNotLook, GITHUB_API } from '../ops/check-code-scanning-age.mjs';
import { fetchWithBoundedRetry } from '../ops/bounded-retry.mjs';
import { SUPABASE_HOSTED_HOST_SHA256 } from '../ops/credential-origin.mjs';

export const CODEQL_DISPOSITIONS_REL = 'tooling/ci/codeql-dispositions.json';
export const DISPOSITION_KINDS = Object.freeze(['by-design', 'fixed-in-tree']);
/** The flow rules whose by-design reason holds for ONE host only. */
export const HOST_RULES = Object.freeze(['js/file-access-to-http', 'js/http-to-file-access']);
/** A bare hostname. No wildcard: ⏱ 2026-10-01 (review 2, finding 7) — `*.supabase.co` named
 *  every tenant of the zone while the code admits exactly one project. */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** OUR hosted Supabase project, named by the sha256 of its hostname: the project ref
 *  is deliberately not in the public tree, and this is the one hash
 *  tooling/ops/credential-origin.mjs pins the service-role key to. Any other hash is
 *  refused, so an entry cannot name a host the code does not admit. */
export const PINNED_SUPABASE_HOST = `sha256:${SUPABASE_HOSTED_HOST_SHA256}`;

const nonEmptyText = (v) => typeof v === 'string' && v.trim().length > 0;

/** PURE. The dispositions file, validated. Returns { entries, problems }. */
export function parseDispositions(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { entries: [], problems: [`${CODEQL_DISPOSITIONS_REL} is not JSON (${e.message}). An unreadable disposition file is not an empty one.`] };
  }
  if (!doc || !Array.isArray(doc.dispositions)) {
    return { entries: [], problems: [`${CODEQL_DISPOSITIONS_REL} has no \`dispositions\` array.`] };
  }
  const problems = [];
  const seen = new Set();
  for (const [i, e] of doc.dispositions.entries()) {
    const at = `${CODEQL_DISPOSITIONS_REL} entry ${i}${Number.isInteger(e?.alert) ? ` (alert #${e.alert})` : ''}`;
    if (!e || typeof e !== 'object') {
      problems.push(`${at} is not an object.`);
      continue;
    }
    if (!Number.isInteger(e.alert) || e.alert < 1) problems.push(`${at} has no positive integer \`alert\`.`);
    else if (seen.has(e.alert)) problems.push(`${at} repeats an alert number — one alert, one disposition.`);
    else seen.add(e.alert);
    if (!nonEmptyText(e.rule)) problems.push(`${at} has no \`rule\`.`);
    if (!nonEmptyText(e.path)) problems.push(`${at} has no \`path\`.`);
    if (!DISPOSITION_KINDS.includes(e.disposition)) problems.push(`${at} has disposition ${JSON.stringify(e.disposition)}, not one of ${DISPOSITION_KINDS.join(' / ')}.`);
    if (!nonEmptyText(e.reason)) problems.push(`${at} has no \`reason\` — a disposition with no reason is a click, not a decision.`);
    // Lead ruling 2026-09-30 (owner: "Security and quality, fix everything"): a
    // disposition is allowed ONLY for the two flow rules, with a verified host.
    // Every other rule is fixed in code.
    if (e.disposition === 'by-design' && nonEmptyText(e.rule) && !HOST_RULES.includes(e.rule)) {
      problems.push(`${at} is a by-design ${e.rule}. Only ${HOST_RULES.join(' and ')} may be kept by design; fix this one in code.`);
    }
    if (e.disposition === 'by-design' && HOST_RULES.includes(e.rule)) {
      const hosts = Array.isArray(e.host) ? e.host : [e.host];
      if (hosts.length === 0 || !hosts.every((h) => typeof h === 'string' && (HOSTNAME.test(h) || h === PINNED_SUPABASE_HOST))) {
        problems.push(`${at} is a by-design ${e.rule} with no bare \`host\` (got ${JSON.stringify(e.host)}). The reason holds for one provider's host; name it.`);
      }
    }
  }
  return { entries: doc.dispositions.filter((e) => e && Number.isInteger(e.alert)), problems };
}

const alertPath = (a) => a?.most_recent_instance?.location?.path ?? null;
const alertWhere = (a) => {
  const l = a?.most_recent_instance?.location;
  return l?.path ? `${l.path}${Number.isInteger(l.start_line) ? `:${l.start_line}` : ''}` : '(no location)';
};

/** PURE. Why this alert cannot be graded by limb C, or null. */
export function codeqlShapeProblem(a) {
  const p = shapeProblem(a);
  if (p) return p;
  if (!nonEmptyText(a.rule.id)) return `alert #${a.number} has no rule.id`;
  if (!nonEmptyText(alertPath(a))) return `alert #${a.number} has no most_recent_instance.location.path`;
  return null;
}

/** PURE. The limb C verdict. `claimAt(sha, number)` answers "does the dispositions
 *  file at commit `sha` carry a fixed-in-tree claim for this alert?" with true,
 *  false, or null (that commit is not readable here). */
export function judgeCodeql({ open, dismissed, entries, claimAt = () => null, fixed = null }) {
  const byNumber = new Map(entries.map((e) => [e.alert, e]));
  const out = { undispositioned: [], mismatched: [], disproved: [], pending: [], byDesign: [], stale: [], notOnMain: [] };
  const matches = (a, e) => {
    if (e.rule === a.rule.id && e.path === alertPath(a)) return true;
    out.mismatched.push({ alert: a, entry: e });
    return false;
  };
  for (const a of open) {
    const e = byNumber.get(a.number);
    if (!e) {
      out.undispositioned.push(a);
      continue;
    }
    if (!matches(a, e)) continue;
    if (e.disposition === 'by-design') {
      out.byDesign.push(a);
      continue;
    }
    const sha = a.most_recent_instance?.commit_sha ?? null;
    if (claimAt(sha, a.number) === true) out.disproved.push({ alert: a, entry: e, sha });
    else out.pending.push({ alert: a, entry: e, sha });
  }
  for (const a of dismissed) {
    const e = byNumber.get(a.number);
    if (e) matches(a, e);
    else if (!isTriaged(a)) out.undispositioned.push(a);
  }
  // ⏱ 2026-10-01 (review 2, finding 4): an entry whose alert main does not list is
  // STALE only when main lists it as FIXED. An alert main has never seen — a PR's
  // own new by-design entry, before main's analysis reads it — is NOT ON MAIN YET,
  // and deleting its entry would redden main the moment the PR merged. `fixed` is
  // main's fixed alerts; without it (an older probe) every such entry is stale.
  const live = new Set([...open, ...dismissed].map((a) => a.number));
  const fixedOnMain = fixed === null ? null : new Set(fixed.map((a) => a.number));
  for (const e of entries) {
    if (live.has(e.alert)) continue;
    if (fixedOnMain === null || fixedOnMain.has(e.alert)) out.stale.push(e);
    else out.notOnMain.push(e);
  }
  out.failed = out.undispositioned.length + out.mismatched.length + out.disproved.length > 0;
  return out;
}

/** PURE. On a pull request, the limb C findings the PR cannot have caused: those
 *  about an alert in a path the PR does not change move to `debt` (printed, not
 *  failed). `touched` is the set of changed paths, or null = grade everything
 *  (a push, a schedule, or a PR whose diff could not be read). */
//
// ⏱ 2026-10-01 (review of #1097, finding 1, MAJOR): the first version judged an
// alert "mine" only by its OWN file, so a PR that deleted or edited a LIVE entry in
// the dispositions file turned its own breakage into MAIN DEBT, exit 0, and main went
// red on the merge. MAIN DEBT now means ONLY an undispositioned alert whose file the
// PR does not change AND whose entry the PR did not add, remove or edit. A mismatched
// entry and a disproved claim always fail. `changed` is the set of alert numbers whose
// entry differs between the PR's base and its head; null when the base file could not
// be read, and then a PR that touches the dispositions file is graded strictly.
export function scopeToPr(v, touched, changed = new Set()) {
  const out = { ...v, debt: [] };
  if (touched === null) return out;
  if (touched.has(CODEQL_DISPOSITIONS_REL) && changed === null) return out;
  const mine = (a) => touched.has(alertPath(a)) || changed.has(a.number);
  out.debt = v.undispositioned.filter((a) => !mine(a)).map((a) => ({ alert: a, why: 'has NO disposition' }));
  out.undispositioned = v.undispositioned.filter(mine);
  out.failed = out.undispositioned.length + out.mismatched.length + out.disproved.length > 0;
  return out;
}

/** PURE. The alert numbers whose disposition entry differs between two entry lists:
 *  added, removed, or changed in any field. */
export function changedEntries(baseEntries, headEntries) {
  const canon = (e) => JSON.stringify(Object.keys(e).sort().map((k) => [k, e[k]]));
  const base = new Map(baseEntries.map((e) => [e.alert, canon(e)]));
  const head = new Map(headEntries.map((e) => [e.alert, canon(e)]));
  const out = new Set();
  for (const [n, c] of base) if (head.get(n) !== c) out.add(n);
  for (const n of head.keys()) if (!base.has(n)) out.add(n);
  return out;
}

/** The CodeQL analyses listed for `ref` (newest first, one page of 20). Throws
 *  CouldNotLook on any failed read, which limb C turns into COVERAGE LOST. */
async function readAnalyses({ repository, token, ref, note }) {
  const url = `${GITHUB_API}/repos/${repository}/code-scanning/analyses?ref=${encodeURIComponent(ref)}&tool_name=CodeQL&per_page=20`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const res = await fetchWithBoundedRetry(({ signal }) => fetch(url, { headers, signal }), { note, describe: (why) => `GET ${url}: ${why}` });
  const text = await res.text();
  if (!res.ok) throw new CouldNotLook(`GET ${url} answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CouldNotLook(`GET ${url} answered unparseable JSON`);
  }
  if (!Array.isArray(body)) throw new CouldNotLook(`GET ${url} answered ${text.slice(0, 200)}, not a list of analyses`);
  return body;
}

/** The PR base's dispositions entries (`git show <base>:…`), or null when the base
 *  commit or the file cannot be read there. */
function prBaseEntries(root) {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']);
  const two = parents.status === 0 && parents.stdout.trim().split(/\s+/).length === 3;
  const base = process.env.GITHUB_BASE_REF;
  const ref = two ? 'HEAD^1' : base ? `origin/${base}` : null;
  if (!ref) return null;
  const r = git(['show', `${ref}:${CODEQL_DISPOSITIONS_REL}`]);
  if (r.status !== 0) return null;
  return baseEntriesOf(r.stdout);
}

/** PURE. The entries of a BASE dispositions file, read only to diff against the
 *  head: never validated, because the base may predate a rule the head enforces
 *  (on 2026-10-01 main's file still held `*.supabase.co` hosts, which this PR
 *  refuses, and validating it made every PR that touched the file "unreadable").
 *  null when the text is not a dispositions document. */
export function baseEntriesOf(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(doc?.dispositions)) return null;
  return doc.dispositions.filter((e) => e && Number.isInteger(e.alert));
}

/** The paths this pull request changes, or null when the event is not a pull
 *  request or the diff cannot be read (then limb C grades everything: strict). */
function prTouchedPaths(root) {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']);
  const two = parents.status === 0 && parents.stdout.trim().split(/\s+/).length === 3;
  const base = process.env.GITHUB_BASE_REF;
  const diff = two ? git(['diff', '--name-only', 'HEAD^1', 'HEAD']) : base ? git(['diff', '--name-only', `origin/${base}...HEAD`]) : null;
  if (!diff || diff.status !== 0) {
    console.log('   ⬜ the pull request\'s changed paths could not be read, so every alert is graded as if it were this PR\'s (strict).');
    return null;
  }
  return new Set(diff.stdout.split('\n').map((l) => l.trim()).filter(Boolean));
}

/** `git show <sha>:<dispositions>` — the fixed-in-tree claims a commit carried.
 *  null when the commit is not in this clone (a shallow or older checkout), so
 *  an unreadable commit is "pending", never "disproved". */
function gitClaimAt(root) {
  const cache = new Map();
  return (sha, number) => {
    if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return null;
    if (!cache.has(sha)) {
      let claims = null;
      const commit = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, encoding: 'utf8' });
      if (commit.status === 0) {
        const r = spawnSync('git', ['show', `${sha}:${CODEQL_DISPOSITIONS_REL}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        claims = new Set();
        if (r.status === 0) {
          try {
            claims = new Set((JSON.parse(r.stdout).dispositions ?? []).filter((e) => e?.disposition === 'fixed-in-tree').map((e) => e.alert));
          } catch {
            claims = null;
          }
        }
      }
      cache.set(sha, claims);
    }
    const claims = cache.get(sha);
    return claims === null ? null : claims.has(number);
  };
}

async function limbC(probeFile) {
  console.log('\n[limb C] CodeQL — every open code-scanning alert is fixed in code or carries a disposition.');
  const file = join(ROOT, CODEQL_DISPOSITIONS_REL);
  if (!existsSync(file)) {
    console.error(`\n✗ limb C — ${CODEQL_DISPOSITIONS_REL} does not exist, so no alert can be shown to have a disposition.`);
    process.exitCode = 1;
    return;
  }
  const { entries, problems } = parseDispositions(readFileSync(file, 'utf8'));
  if (problems.length) {
    console.error(`\n✗ limb C — ${problems.length} problem(s) in ${CODEQL_DISPOSITIONS_REL}:`);
    for (const p of problems) console.error(`    ${p}`);
    process.exitCode = 1;
    return;
  }

  let open;
  let dismissed;
  let fixed = null;
  let claimAt;
  let touched = null;
  let baseEntries = null;
  let analyses = null;
  const analysisOf = flag('--analysis-of');
  if (probeFile) {
    const probe = JSON.parse(readFileSync(probeFile, 'utf8'));
    if (probe.codeqlError) unreadable([`limb C — the code-scanning alerts are NOT readable: ${probe.codeqlError}`]);
    if (!probe.codeql) unreadable(['limb C — the probe carries no `codeql` answer, so no code-scanning alert was read.']);
    ({ open, dismissed } = probe.codeql);
    fixed = probe.codeql.fixed ?? null;
    analyses = probe.codeql.analyses ?? null;
    const claims = probe.codeqlClaims ?? {};
    claimAt = (sha, n) => (sha in claims ? claims[sha].includes(n) : null);
    touched = Array.isArray(probe.prTouched) ? new Set(probe.prTouched) : null;
    baseEntries = Array.isArray(probe.prBaseDispositions) ? baseEntriesOf(JSON.stringify({ dispositions: probe.prBaseDispositions })) : null;
  } else {
    const token = ghToken();
    if (!token) unreadable(['limb C — neither GITHUB_TOKEN nor GH_TOKEN is in the environment, so no code-scanning alert was read.']);
    const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
    const note = (l) => console.error(`    ${l}`);
    try {
      open = await readAlerts({ repository, token, state: 'open', note });
      dismissed = await readAlerts({ repository, token, state: 'dismissed', note });
      fixed = await readAlerts({ repository, token, state: 'fixed', note });
      if (analysisOf) analyses = await readAnalyses({ repository, token, ref: process.env.GITHUB_REF || 'refs/heads/main', note });
    } catch (e) {
      unreadable([`limb C — the code-scanning alerts could not be read: ${e.message}`]);
    }
    claimAt = gitClaimAt(ROOT);
    touched = prTouchedPaths(ROOT);
    if (touched?.has(CODEQL_DISPOSITIONS_REL)) baseEntries = prBaseEntries(ROOT);
  }
  if (!Array.isArray(open) || !Array.isArray(dismissed)) unreadable(['limb C — the alert enumeration did not return two lists.']);
  // ⏱ 2026-10-01 (review of #1097, finding 4): an EMPTY read is never a pass. With
  // no alert in any state nothing can fail, so a reset of code scanning, a deleted
  // analysis or an API answering [] for every state graded nothing and said ✓.
  // `--analysis-of <sha>` (codeql.yml, after each analysis of main) also proves the
  // read follows THIS commit's analysis, and says which of the two happened.
  let analysis = null;
  if (analysisOf) {
    if (!Array.isArray(analyses)) unreadable([`limb C — the analysis list for ${analysisOf.slice(0, 12)} could not be read.`]);
    analysis = analyses.find((a) => a?.commit_sha === analysisOf) ?? null;
    if (!analysis) {
      unreadable([`limb C — NO ANALYSIS FOUND: no CodeQL analysis of ${analysisOf.slice(0, 12)} is listed (${analyses.length} read), so these alerts are not this commit's.`]);
    }
  }
  if (open.length === 0 && dismissed.length === 0 && (fixed ?? []).length === 0) {
    unreadable([
      analysis
        ? `limb C — ZERO ALERTS WHILE THE ANALYSIS EXISTS: analysis ${analysis.id} of ${analysisOf.slice(0, 12)} (results ${analysis.results_count}) is listed, and the API returned no alert in any state (open, dismissed, fixed). Nothing was graded.`
        : 'limb C — EMPTY READ: the API returned no alert in any state (open, dismissed, fixed), so nothing was graded. Code scanning may be reset or its analyses deleted.',
    ]);
  }
  if (analysis) console.log(`   graded after analysis ${analysis.id} of ${analysisOf.slice(0, 12)} (results ${analysis.results_count})`);
  for (const a of [...open, ...dismissed]) {
    const p = codeqlShapeProblem(a);
    if (p) unreadable([`limb C — ${p}. The response shape changed; grading what parsed would be a partial count.`]);
  }

  const changed = baseEntries === null ? null : changedEntries(baseEntries, entries);
  const v = scopeToPr(judgeCodeql({ open, dismissed, entries, claimAt, fixed }), touched, changed ?? (touched?.has(CODEQL_DISPOSITIONS_REL) ? null : new Set()));
  console.log(
    `   ${open.length} open and ${dismissed.length} dismissed alert(s) read · ${entries.length} disposition(s) · ` +
      `${v.byDesign.length} by design · ${v.pending.length} fixed in tree, awaiting main's analysis` +
      (touched === null
        ? ''
        : ` · pull request: graded on the ${touched.size} path(s) it changes` +
          (touched.has(CODEQL_DISPOSITIONS_REL) ? (changed === null ? ', and STRICTLY (it changes the dispositions file and its base could not be read)' : `, and on the ${changed.size} entr(ies) it adds, removes or edits`) : '')),
  );
  for (const e of v.stale) {
    console.log(`   ⬜ STALE — #${e.alert} ${e.rule} ${e.path} is FIXED on main. Delete its entry (this prints, never fails).`);
  }
  for (const e of v.notOnMain) {
    console.log(`   ⬜ NOT ON MAIN YET — #${e.alert} ${e.rule} ${e.path} is not an alert main has read. KEEP the entry: it is a new alert's disposition, and main needs it the moment it merges.`);
  }
  for (const { alert: a, why } of v.debt) {
    console.log(`   ⬜ MAIN DEBT — #${a.number} ${a.rule.id} ${alertWhere(a)} ${why}, in a path this pull request does not change and with an entry it did not touch. It blocks nothing here; main's own run and the limb C step of codeql.yml's analyze job fail on it.`);
  }
  if (!v.failed) {
    console.log(
      v.debt.length === 0
        ? '✓ limb C — every open code-scanning alert is fixed in code or carries a disposition.'
        : `✓ limb C — every alert in a path this pull request changes carries a disposition; ${v.debt.length} main-debt alert(s) printed above.`,
    );
    return;
  }
  if (v.undispositioned.length) {
    console.error(`\n✗ limb C — ${v.undispositioned.length} code-scanning alert(s) with NO disposition:`);
    for (const a of v.undispositioned) {
      console.error(`    #${a.number}  ${a.rule.id}  ${a.rule.security_severity_level ?? a.rule.severity ?? ''}  ${alertWhere(a)}${a.state === 'dismissed' ? '  (dismissed WITHOUT a reason)' : ''}`);
    }
    console.error(
      '    Fix it in code (with a `fixed-in-tree` entry until main\'s analysis sees the fix), or add a `by-design`\n' +
        `    entry to ${CODEQL_DISPOSITIONS_REL} with the reason — and the host, for a flow rule.`,
    );
  }
  for (const { alert: a, entry: e } of v.mismatched) {
    console.error(`\n✗ limb C — entry #${e.alert} says ${e.rule} at ${e.path}, but alert #${a.number} is ${a.rule.id} at ${alertWhere(a)}. It dispositions a different alert.`);
  }
  for (const { alert: a, sha } of v.disproved) {
    console.error(
      `\n✗ limb C — #${a.number} ${a.rule.id} ${alertWhere(a)} is claimed \`fixed-in-tree\`, and main's analysis of ${sha.slice(0, 12)} — a ` +
        'commit that already carries that claim — still finds it. The fix did not fix it.',
    );
  }
  process.exitCode = 1;
}

// Only run when executed directly, so the pure halves can be imported by tests. LAST in
// the file: limb C's constants are declared above it, and a top-level await placed
// before them reads them in their temporal dead zone.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main().catch((e) => {
    console.error(`FAIL  ${e.stack || e.message}`);
    process.exit(1);
  });
}
