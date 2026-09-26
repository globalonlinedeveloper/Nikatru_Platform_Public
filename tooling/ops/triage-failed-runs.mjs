#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// triage-failed-runs.mjs — EVERY non-green Actions run, accounted for, with the
// count that could NOT be accounted for printed as its own final line.
//
// 🔴 THE QUESTION IT ANSWERS, VERBATIM FROM THE OWNER ON 2026-09-10: "I have
// seen more than 50+ workflow failed, how we can check everything covered and
// we did not missed anything?" The sweeps of the two days before had read the
// last 60–100 runs and grouped what they saw. That is a SAMPLE. A sample can
// only say "the ones I looked at are explained"; it cannot say "nothing was
// missed", because the runs it did not look at are exactly the ones it cannot
// speak for. The answer to "did we miss anything" is a LEDGER — every non-green
// run the API will hand over, each one assigned to a group with a cited root
// cause, a cited fix, and a cited later-green — and the number of runs that
// could NOT be assigned, printed last, on its own line, driving the exit code.
//
// ── WHAT ONE ROW IS ─────────────────────────────────────────────────────────
//   run id · workflow · branch · conclusion · the FAILING JOB · the FAILING STEP
//   · the FIRST ERROR LINE of that step's log · a SIGNATURE derived from the
//   error (never from the job name — see below) · the verdict of the NEWEST
//   COMPLETED run of that same workflow on that same branch · whether the
//   branch still exists.
//
// ── WHAT "EXPLAINED" MEANS, AND IT IS A CONJUNCTION ─────────────────────────
//   (a) the row's signature has an entry in tooling/ops/failed-run-causes.json
//       naming a root cause and a fix (a merged SHA/PR, "infrastructure,
//       self-cleared", "superseded: branch merged/deleted", or "lost race
//       under strict protection"), AND
//   (b) the newest COMPLETED run of that workflow on that branch is GREEN
//       (cited by run id and timestamp) — never a run still in flight, and
//       never the run executing this ledger (GITHUB_RUN_ID), which inside
//       ops-watch IS ops-watch's newest run — OR the branch no longer exists
//       (cited, with its PR when one can be found).
//   Either half missing = UNEXPLAINED. A cause with no later green is an OPEN
//   defect; a later green with no cause is a fix nobody can name.
//
// ── 🔴 SIGNATURE FROM THE LOG, NEVER FROM THE JOB NAME ───────────────────────
//   `ci-gate`'s "Require all lanes green" was red 95 times in the first 160
//   runs read while writing this. It is red because SOMETHING ELSE was red. A
//   ledger keyed on the aggregator would have one group called "CI failed" and
//   explain nothing; so aggregator jobs (GATE_STEP below) are dropped whenever
//   another job in the same run failed, and only when they are the ONLY red job
//   does the row carry the `gate-only` signature ("a lane was cancelled or
//   never ran").
//
//   Likewise a `✗ tooling/ops/register.json — 2 problem(s):` header is not a
//   signature — the problem is on the NEXT indented line. So the error block
//   handed to the classifier is the first error line PLUS the lines after it,
//   and the patterns in SIGNATURES read the block, most specific first.
//
// ── CANCELLED RUNS ──────────────────────────────────────────────────────────
//   GitHub's job log for a cancelled run says only `##[error]The operation was
//   canceled.` — it never says by whom. The one thing the API does show is
//   WHETHER A NEWER RUN OF THE SAME WORKFLOW ON THE SAME REF WAS CREATED WHILE
//   THIS ONE WAS STILL RUNNING. That is what `cancel-in-progress` does, so it is
//   the signature `cancelled:superseded-in-group`; a cancelled run with no such
//   successor is `cancelled:by-hand-or-unknown`.
//
// ── EXIT CONTRACT ───────────────────────────────────────────────────────────
//   0 = every non-green run enumerated is explained (UNEXPLAINED: 0).
//   1 = UNEXPLAINED: N with N > 0 — the individual rows are printed above it.
//   2 = COVERAGE LOST — a 403 (the shared installation quota, measured
//       exhausted on 2026-09-09), a paged list that stopped short of
//       `total_count`, a job log that could not be read, no credential, the
//       quota floor refusing to start, or the request ceiling reached (both
//       below). NEVER readable as a pass: a ledger over a subset says nothing
//       about the rest.
//
// ⚠️ A READER, NOT A GATE. This does not run in ci.yml and must not: it costs
// one API call per run plus one per failed job, and the shared quota is the
// very thing that made 2026-09-09 red. It runs WEEKLY as the `failure-ledger`
// job of ops-watch.yml (the Monday slot, `--since` eight days back). Its exit
// reaches the digest and the durable issue; it gates no merge. It still runs
// from a workstation by hand, where `gh`'s identity is separate from the
// installation token.
//
// ── THE QUOTA FLOOR, AND WHY IT REPLACES A DEDICATED TOKEN ──────────────────
// ⏱ 2026-09-25, ruling D1. The job runs under its own workflow token
// (`GH_TOKEN: ${{ github.token }}`, job permissions contents, actions and
// pull-requests read), not a personal access token. A PAT is a long-lived
// credential with a 366-day expiry and an owner step to mint and renew it, and
// an expired one fails the Monday slot with nothing watching for the expiry.
// The ledger reads only this repository, which the job token can. What a PAT
// bought was a quota of its own; the floor protects the shared one instead:
//   · before its first counted request the reader asks GET /rate_limit, which
//     GitHub does not count, and refuses to start — exit 2, COVERAGE LOST,
//     naming "quota floor" — unless `remaining - ceiling >= QUOTA_FLOOR` (400).
//     A walk that spends its whole ceiling still leaves 400 requests for every
//     other reader of that quota;
//   · `--max-requests` (default 300) is a HARD ceiling: every request SENT
//     counts, a bounded retry included, and the one past it is refused unsent —
//     exit 2, COVERAGE LOST, never a partial pass. A 403 is still COVERAGE LOST.
//
// ── THE TYPED FIX, AND THE MERGE IT NAMES ───────────────────────────────────
// Every cause in failed-run-causes.json carries `fixedBy` beside its prose
// `fix` (`validateCauses`, below). A `merge` names the commit that fixed it,
// and on the live path — before the first request — every such commit is held
// to `git merge-base --is-ancestor <sha> origin/main`: a cause whose fix never
// reached main is not a fix, so that is exit 1, naming the row. A shallow
// clone or a missing origin/main cannot answer, so that is exit 2, never a pass.
//
// ⚠️ NO `process.exit()` ONCE A `fetch` HAS BEEN MADE — an open undici handle
// crashes libuv on Windows and returns 127 for BOTH outcomes. `process.exitCode`
// + return, as await-pr-checks.mjs does.
//
// ── USAGE ───────────────────────────────────────────────────────────────────
//   node tooling/ops/triage-failed-runs.mjs [--repo owner/name] [--since ISO]
//        [--until ISO] [--cache-dir DIR] [--fixture-dir DIR] [--no-prs]
//        [--branch NAME] [--max-requests N] [--json FILE]
//
//   --since ISO      only runs created at/after this instant. Without it, ALL
//                    of them — and if GitHub's per-list ceiling (1000) cuts the
//                    enumeration short, that is exit 2, printed.
//   --until ISO      only runs created at/before this instant — a bounded
//                    window is what makes a ledger reproducible tomorrow, when
//                    today's in-flight PRs have added runs the report never saw.
//   --cache-dir DIR  cache the answers that can never change: a COMPLETED run
//                    attempt's jobs (keyed by attempt, because a re-run keeps
//                    the run id), a job's log, the successor window of a
//                    cancelled run, and the PR of a DELETED branch. Never
//                    caches the run LIST or a branch's NEWEST run: both move
//                    with every push, and a cached newest run is yesterday's
//                    proof read as today's. Measured 2026-09-11: 72 of 88
//                    UNEXPLAINED rows cited a newest run cached the day before
//                    (ops-watch on main 'in flight' at 2026-09-10T06:03Z).
//   --fixture-dir DIR offline: `runs.json` (REST shape), `<id>.jobs.json`,
//                    `<id>.job-<jobId>.log`, `newest.json` ({"<path>|<branch>":
//                    run}), `between-<id>.json` (runs of the same workflow+ref
//                    created while <id> lived), `branches.json` ([names]),
//                    `prs.json` ({"<branch>": pr}), `capped.json` ([notes]).
//                    No network path at all.
//   --no-prs         skip the per-deleted-branch PR lookup (saves one call per
//                    branch; the proof line then says "branch deleted" only).
//   --branch NAME    only runs whose head branch is NAME: the run lists ask
//                    GitHub for `branch=NAME`, and a fixture keeps only runs
//                    whose `head_branch` is NAME. Default: every branch.
//   --max-requests N the hard request ceiling, default 300 (see THE QUOTA
//                    FLOOR above); the floor is computed against it. Live
//                    transport only.
//   --json FILE      also write every row and group to FILE.
//
//   Credential: GH_TOKEN / GITHUB_TOKEN, else the local vault key
//   `Project_Cross_Platform_Apps_GITHUB_PAT` via safe-rerun.mjs's `token()`.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { token } from './safe-rerun.mjs';
import { fetchWithBoundedRetry } from './bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const API = 'https://api.github.com';
export const CAUSES_REL = 'tooling/ops/failed-run-causes.json';

/** Conclusions this ledger ranges over. `skipped`, `neutral`, `success` and a
 *  null (still running) are not failures; `action_required` and `stale` are
 *  not produced by this repository's workflows and would surface as
 *  `other:*` rows if they ever were — unexplained, which is the safe reading. */
export const NON_GREEN = new Set(['failure', 'timed_out', 'startup_failure', 'cancelled']);

/** Aggregator steps whose red is DOWNSTREAM of another job's red. Dropped from
 *  a run's failing set whenever a non-aggregator job in that run also failed. */
export const GATE_STEP =
  /^(Require all lanes green|Require every platform green|Every job in this workflow is accounted for, and every outcome is graded|A skipped lane is only correct if the event selected another one)$/;

// ═══════════════════════════════════════════════════════════════════════════
// LOG READING — pure functions, text in, text out
// ═══════════════════════════════════════════════════════════════════════════

/** `gh run view --log-failed` prefixes every line with `job\tstep\t`; the jobs
 *  API log does not. Both carry an ISO timestamp next. Strip both. */
const PREFIX = /^(?:[^\t\n]*\t[^\t\n]*\t)?\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
export const stripPrefix = (line) => String(line).replace(PREFIX, '');

const tsOf = (line) => {
  const m = /^(?:[^\t\n]*\t[^\t\n]*\t)?(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(String(line));
  return m ? Date.parse(m[1]) : NaN;
};

/** Restrict a job's log to ONE step. The jobs API log carries every step of
 *  the job, so a `✗` printed by an earlier PASSING step (a negative test
 *  printing what it expects) would otherwise be read as the failure. Steps
 *  carry `started_at`/`completed_at`; log lines carry timestamps; the
 *  intersection is the step. The gh-format prefix, when present, is used
 *  instead. A step with no timestamps (never started) scopes to nothing. */
export function scopeToStep(lines, step) {
  const named = lines.filter((l) => {
    const parts = String(l).split('\t');
    return parts.length >= 3 && parts[1] === step?.name;
  });
  if (named.length) return named;
  const a = Date.parse(step?.started_at ?? '');
  const b = Date.parse(step?.completed_at ?? '');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  return lines.filter((l) => {
    const t = tsOf(l);
    return Number.isFinite(t) && t >= a - 1500 && t <= b + 1500;
  });
}

const GENERIC_ERROR = /Process completed with exit code|The operation was canceled|The job was canceled/;
/** `assert-x: FAILED` — the verdict line this repository's guards print LAST. */
const VERDICT_LINE = /^\s*[\w./-]+: FAILED\s*$/;
const FAILED_WORD =
  /(?:^|\s)(?:FAILED|FAIL)\b|BUILD FAILED|Build process failed|error TS\d+|\bAssertionError\b|^\s*error:|^\s*fatal:|Failed to (?:update|resolve|load)/;
/** A printed-not-blocking note (⬜) or a printed warning (⚠). Never the error
 *  line, whatever word it carries — "it stays FAIL-CLOSED" is a ⚠ sentence
 *  from a guard that PASSED (measured on run 34429437969). */
const NOTE_LINE = /^\s*[⬜⚠]/;

/**
 * The first error line of a step, plus the lines after it — the BLOCK the
 * classifier reads. Preference order, each searched over the whole scope
 * before falling to the next:
 *   · a `✖` line — node:test's failing case, which is THE fact of a test job
 *     (the `✗` lines in that job are negative tests printing what they expect);
 *   · a `✗` line at line start (this repository's guards all speak that way;
 *     `✔ … drops every ✗ line` is a ✔ line and does not qualify);
 *   · a `##[error]` that says something (not the generic exit-code one);
 *   · the `<guard>: FAILED` verdict line;
 *   · a line that says FAILED / BUILD FAILED / a TS error / an assertion —
 *     never a ⬜ note, whatever word the note carries;
 *   · the generic cancel line;
 *   · the generic exit line WITH the three lines before it as context (that is
 *     where `dart format` and `flutter pub get` say what went wrong);
 *   · nothing.
 * The block runs `after` lines past the error line — THE REST OF THE STEP, in
 * effect. 🔴 NOT TEN, NOT EIGHTY: the ops register prints its ⬜ notes —
 * multi-line prose — BEFORE the indented `duty.… — RED SINCE` line that is
 * the actual problem. Measured on run 34391007805: the `✗` header sat at
 * scoped line 15, a ⬜ note mentioning RED SINCE at 72, and the real
 * `duty.workflow.deploy-workers.yml — RED SINCE` line beyond 96. A block cut
 * at 80 read that run as `ops-register:other`, which no cause may claim.
 */
export function errorBlock(scopedLines, after = 400) {
  const lines = scopedLines.map(stripPrefix);
  const pick = (test, before = 0) => {
    const i = lines.findIndex(test);
    if (i < 0) return null;
    const from = Math.max(0, i - before);
    return { line: lines[i].trim(), block: lines.slice(from, i + 1 + after).join('\n').trim(), index: i };
  };
  return (
    pick((l) => /^\s*✖/.test(l)) ||
    pick((l) => /^\s*✗/.test(l)) ||
    pick((l) => l.includes('##[error]') && !GENERIC_ERROR.test(l)) ||
    pick((l) => VERDICT_LINE.test(l)) ||
    pick((l) => !NOTE_LINE.test(l) && FAILED_WORD.test(l)) ||
    pick((l) => /##\[error\]The operation was canceled/.test(l)) ||
    pick((l) => /##\[error\]Process completed with exit code/.test(l), 3) || {
      line: '(no error line)',
      block: '',
      index: -1,
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNATURES — the stable part of the message. MOST SPECIFIC FIRST.
// ═══════════════════════════════════════════════════════════════════════════
/** Each entry: id, a pattern tested against `<step>\n<block>`, and an optional
 *  `key` group index that is appended to the id so one pattern yields one
 *  group per subject (per duty, per route, per platform). The FIRST match
 *  wins, so a narrower reading must sit above the wider one it refines. */
export const SIGNATURES = [
  // ── this ledger's own verdict: FIRST, above everything ────────────────────
  // A red ledger prints the error lines of the runs it could not explain, so
  // its block quotes other runs' failures verbatim (a simulator refusal, a
  // register duty); any pattern below would take the quote for the fault.
  // Measured on runs 36206110356 and 36206329284 (2026-09-26), filed as
  // `ops-register:problem:signature: …` before this entry existed.
  { id: 'failure-ledger:unexplained', re: /^Every failed run of the last eight days, and the recorded cause it maps to\n[\s\S]*(?:^UNEXPLAINED: [1-9]|\(\d+ UNEXPLAINED\) \|)/m },
  { id: 'failure-ledger:credential-unshaped', re: /COVERAGE LOST — the GitHub credential does not have the shape of a GitHub token/ },
  // ── a test job: the failing CASE is the fact ──────────────────────────────
  { id: 'guard-test', re: /^\s*✖ (.+?) \(\d/m, key: 1 },
  // ── the ops register ([14]O-3 reader) ──────────────────────────────────────
  { id: 'ops-register:red-since', re: /(duty\.workflow\.[\w.-]+) — RED SINCE/, key: 1 },
  { id: 'ops-register:duty-stale', re: /(duty\.[\w.-]+) — its record IS reachable and the newest SUCCESSFUL run is .* outside its own window/, key: 1 },
  { id: 'ops-register:duty-dark', re: /(duty\.[\w.-]+) — (?:its record (?:could not be|is not) |the reader (?:could not|cannot) )/, key: 1 },
  { id: 'ops-register:max-delete', re: /--max-delete threshold reached/ },
  { id: 'ops-register:alert-disposition-403', re: /Every alerting firing has a recorded disposition[\s\S]*GitHub API returned 403/ },
  { id: 'ops-register:firing-history-403', re: /limb A — a declared firing history could not be enumerated: GitHub API returned 403/ },
  // The header says "N problem(s)"; the problem is the first INDENTED line that
  // is neither a ⬜ note nor a `·` sub-bullet nor a `[..]` legend. Keyed on it.
  { id: 'ops-register:problem', re: /✗ tooling\/ops\/register\.json[^\n]*\n(?:[^\n]*\n)*?[ \t]{2,}(?![⬜·[])(\S[^\n]{0,90})/, key: 1, normaliseKey: true },
  { id: 'ops-register:other', re: /✗ tooling\/ops\/register\.json/ },
  // ── the shared quota ──────────────────────────────────────────────────────
  { id: 'github-api:403-installation-quota', re: /API rate limit exceeded for installation|GitHub API returned 403|returned 403 listing runs|HTTP 403/ },
  // ── freshness / provenance readers ────────────────────────────────────────
  { id: 'pages-freshness:strict-equality', re: /succeeded, but it is serving commit .* while the newest commit on `main` touching/ },
  // The three refinements sit above `no-deployment`, which is the step name
  // and so matches every red of that step. Measured on runs 35422355154 (a
  // build still running, read as failed), 35478397730 (one read dropped) and
  // 35981313508 (a Git build Cloudflare failed at `initialize`).
  { id: 'pages-freshness:in-flight-read-as-failure', re: /stopped at stage `\w+` with status `(?:active|idle)`/ },
  { id: 'pages-freshness:read-dropped', re: /^\s*\?\s+[\w.-]+ \(\w+\) — TypeError: fetch failed/m },
  { id: 'pages-freshness:git-build-failed', re: /— the newest production deployment \S+ stopped at stage `(\w+)` with status `failure`/, key: 1 },
  { id: 'pages-freshness:no-deployment', re: /Every Pages project's newest PRODUCTION deployment succeeded/ },
  { id: 'provenance:unresolved-rows', re: /group\(s\) of rows in production cannot be traced to a released build/ },
  { id: 'provenance:d1-api-unreadable', re: /COULD NOT LOOK — the D1 API returned (\d{3})/, key: 1 },
  { id: 'provenance:github-api-unreadable', re: /COULD NOT LOOK — the GitHub API returned (\d{3})/, key: 1 },
  { id: 'provenance:run-listing-capped', re: /COULD NOT LOOK — listing runs of [\w.-]+ \([^)\n]*\): all \d+ pages of \d+ came back full/ },
  { id: 'proof-fresh:no-green-scheduled', re: /NO GREEN SCHEDULED RUN in the newest/ },
  { id: 'proof-fresh:other', re: /must be RECENT, SCHEDULED and GREEN/ },
  // ── registers and generated files ─────────────────────────────────────────
  { id: 'platform-register:unregistered-route', re: /((?:GET|POST|PUT|PATCH|DELETE) \S+) — MOUNTED by .* and absent from the register/, key: 1 },
  { id: 'platform-register:other', re: /✗ platform register/ },
  { id: 'policy-claims:unclaimed-route-segment', re: /registers a route segment .* that is neither a provider's tell/ },
  { id: 'policy-claims:unrowed-emphasis', re: /emphasises .* has no row for it/ },
  { id: 'policy-claims:other', re: /✗ policy claims/ },
  { id: 'start-here:drift', re: /^START-HERE\.md is what the tree generates/ },
  { id: 'enforcement-index:drift', re: /enforcement-index\.json DISAGREES|^The enforcement index is what the tree says/ },
  { id: 'monitor-register:drift', re: /is pointed at .* live and the register records/ },
  { id: 'monitor-register:no-project', re: /NO PROJECT: monitor/ },
  { id: 'monitor-register:other', re: /^The register still matches the live GlitchTip monitors/ },
  { id: 'retention-coverage', re: /✗ (?:retention coverage|COVERAGE LOST — retention\.)/ },
  // The verifier exits 1 on ANY non-OK API status, so ops-watch's "DRIFTED" error can
  // stand FIRST, with no `✗ … DIFFERS` line before it: nothing was compared.
  // Measured on run 34511747076 (Supabase answered 504).
  { id: 'supabase-auth:unreadable-read-as-drift', re: /^Compare the live Supabase auth config[^\n]*\n##\[error\]The live project no longer matches what the repo recorded/ },
  { id: 'supabase-templates:drift', re: /DIFFERS from live `mailer_templates/ },
  // GoTrue reads unset and 0 alike ("no limit"); the comparator did not. Run 36097413255.
  { id: 'supabase-auth:session-limit-null-read-as-drift', re: /✗ auth `sessions_(?:timebox|inactivity_timeout)`: register says null, live says 0\./ },
  { id: 'catalogue:reachability', re: /✗ catalogue reachability/ },
  { id: 'privacy-notice:drift', re: /notice surface\(s\) no longer match the privacy declaration/ },
  { id: 'site-integrity', re: /✗ \d+ site problem\(s\)/ },
  { id: 'deploy-triggers:unreachable', re: /A TRIGGER PATH CANNOT REACH THE JOBS IT TRIGGERS/ },
  { id: 'surfaces:unhealthy', re: /probed surface\(s\) are NOT healthy/ },
  { id: 'surfaces:never-answered', re: /probed surface\(s\) NEVER ANSWERED, on any of the \d+ attempts/ },
  // ── downstream refusals ───────────────────────────────────────────────────
  { id: 'ci-gate:refused-downstream', re: /ci-gate concluded "(?:failure|cancelled)" for|waiting for "ci-gate"/ },
  { id: 'smoke:stale-build', re: /POST-DEPLOY SMOKE FAILED/ },
  { id: 'web-smoke:first-frame-timeout', re: /never reached the ready signal `flutter-first-frame`/ },
  { id: 'bundle-launch:404', re: /^Launch the built bundle once/ },
  // ── builds and toolchains ─────────────────────────────────────────────────
  { id: 'windows:max-path', re: /Unable to generate build files|cannot write keep file|Filename too long/ },
  { id: 'zizmor:install-failed', re: /^Install zizmor/ },
  { id: 'macos:build-failed', re: /^Build macos[\s\S]*BUILD FAILED/ },
  { id: 'apple:signing-failed', re: /apple-signing: FAILED|assert-artifact-signed-apple: FAILED|find: build\/ios\/ipa: No such file/ },
  { id: 'glitchtip:symbol-upload', re: /debug-files upload exited|difs\/assemble/ },
  { id: 'glitchtip:release-create-5xx', re: /Failed to create release: POST https:\/\/glitchtip\.\S+ returned 5\d\d/ },
  { id: 'dart:format', re: /dart format-clean[\s\S]*(?:Changed |Formatted \d+ files)/ },
  { id: 'dart:package-uri-unresolved', re: /Failed to resolve package URI/ },
  { id: 'dart:pub-resolve', re: /incompatible with dependency constraints|Failed to update packages/ },
  { id: 'node:import-attribute-missing', re: /ERR_IMPORT_ATTRIBUTE_MISSING/ },
  // money-dry-run.mjs crashed with an uncaught Node error: the dump ends in a lone
  // `}`, which is the first line the error block sees, so the step name is the only
  // stable key. Measured on run 34429437969 (ERR_IMPORT_ATTRIBUTE_MISSING above it).
  { id: 'money-dry-run:uncaught-throw', re: /^A stored notification replayed in any order reaches the same entitlement\n\}\n/ },
  { id: 'osv:known-vulnerable', re: /^Known-vulnerable dependencies/ },
  { id: 'hang-guard:ceiling', re: /hang-guard: all \d+ attempt\(s\) exceeded/ },
  { id: 'tsc:error', re: /error TS\d+/ },
  { id: 'npm-test:assertion', re: /AssertionError/ },
  // ── the nightly live e2e and its preflights ───────────────────────────────
  { id: 'e2e:consent-artifact-mismatch', re: /the newest artifact says granted=\d, but the suite tapped/ },
  { id: 'e2e:frames-wrong-size', re: /screenshots\/[\w.-]+\.png is \d+x\d+; the floor in tooling\/e2e-leg-register\.json framesCarryText was measured on frames \d+ wide/ },
  { id: 'e2e:rehearsal-refused-on-main', re: /auth_target=\w+ is a REHEARSAL against a stack the deployed Workers deliberately refuse, and this dispatch is on main/ },
  { id: 'e2e:leg-failed', re: /##\[error\]Failure in method: ([^\n]+)/, key: 1 },
  { id: 'e2e:preflight-variable-unset', re: /repository VARIABLE (\w+) is unset/, key: 1 },
  { id: 'e2e:preflight-secrets-missing', re: /auth_target=\w+ needs \w+/ },
  { id: 'e2e:integration-tests-failed', re: /^Run integration tests \(headless Chrome\)/ },
  // ── readers on main that answer for live systems ──────────────────────────
  { id: 'analytics:silence-judged-fault', re: /THE ANALYTICS RAIL IS SILENT WHILE/ },
  { id: 'heartbeat-table:unhealthy', re: /scheduled duty is not reporting healthy/ },
  { id: 'alarm-chains:monitor-missing', re: /expected monitor "[^"]*" is not in the live list/ },
  { id: 'actions-usage:over-ceiling', re: /net-billed Actions spend is over the declared ceiling/ },
  { id: 'gcp-scope:store-account-holds-a-role', re: /can now read project state on GCP, so it has been granted an IAM role/ },
  { id: 'supabase-config:no-credential', re: /found no SUPABASE_PAT/ },
  { id: 'd1-live-sql:refused', re: /D1 REFUSES A STATEMENT THIS REPOSITORY DEPLOYS/ },
  { id: 'd1-live-sql:could-not-complete', re: /This check COULD NOT COMPLETE, so nothing above may be read as proof/ },
  { id: 'deployment-record:no-environment-row', re: /no row in tooling\/channel-register\.json has a `deploymentEnvironment` template/ },
  { id: 'deployment-record:github-5xx', re: /could not record the deployment: POST deployments → 5\d\d/ },
  { id: 'ci-gate:no-sha-given', re: /✗ no commit SHA given/ },
  // ── deploy and release lanes ──────────────────────────────────────────────
  { id: 'wrangler:npx-failed', re: /The process '[^']*npx' failed with exit code/ },
  { id: 'pages:ensure-project', re: /^Ensure the Pages project exists/ },
  { id: 'android:gradle-failed', re: /Gradle task assembleRelease failed|^Build android/ },
  { id: 'msix:identity-guard', re: /assert-artifact-signed-msix|^The MSIX carries the identity the register declares/ },
  { id: 'play:device-coverage', re: /✗ play device coverage/ },
  { id: 'snap:pack-failed', re: /Cannot pack snap|^Pack the snap/ },
  { id: 'store-screenshots:simulator-aged-out', re: /The register names "[^"\n]+" and this runner image has no available simulator by that name/ },
  { id: 'store-screenshots:capture', re: /^(?:Capture the set|Propose the set for human review)/ },
  { id: 'site-drift-repair:pr-setting', re: /Allow GitHub Actions to create and approve pull requests/ },
  { id: 'renovate:docker-failed', re: /^Run Renovate/ },
  // ── scanners and toolchain plumbing ───────────────────────────────────────
  { id: 'versions:drift', re: /version drift problem\(s\)|^Build versions all match versions\.json/ },
  { id: 'secret-scan:found', re: /✗ secret scan found something/ },
  { id: 'secret-scan:canary-coverage', re: /declares \d+ rule\(s\) but \d+ canar/ },
  { id: 'workflow-static-analysis:finding', re: /workflow static analysis found/ },
  { id: 'guard-coverage:orphan-guard', re: /neither invoked by a workflow nor imported by one that is/ },
  { id: 'actions-cache:not-allowed', re: /actions\/cache@v\d+ is not allowed/ },
  { id: 'setup-node:cache-paths', re: /Some specified paths were not resolved, unable to cache dependencies/ },
  { id: 'upload-artifact:no-files', re: /No files were found with the provided path/ },
  { id: 'flutter:analyze', re: /^Run flutter analyze/ },
  { id: 'melos:test', re: /^melos run test/ },
  { id: 'workspace:missing-member', re: /workspace member\(s\) listed but missing from disk/ },
  { id: 'tokens-css:drift', re: /^Site tokens\.css must equal a fresh build/ },
  { id: 'site-feed:drift', re: /^Site feed must equal a fresh generation/ },
  { id: 'l10n:drift', re: /^Regenerating the chassis localisations moved no tracked byte/ },
  { id: 'clone-tells', re: /✗ clone tells/ },
  { id: 'launcher-icons:vacuous-compare', re: /^No shipped app carries Flutter's default launcher icon/ },
  { id: 'brand-assets:no-platform-claim', re: /no platform claim found for/ },
  { id: 'wrangler-jsonc:missing', re: /carries no wrangler\.jsonc/ },
  { id: 'extensions:gate-mutation-proof', re: /^Every gate must be proven to fail on a real mutation/ },
  { id: 'extensions:tag-reachable', re: /^Tag must be reachable from main/ },
  { id: 'stamped-service:typecheck', re: /^Typecheck \+ dry-run the stamped service/ },
  { id: 'pipeline-tests', re: /^The pipeline's own tests/ },
  { id: 'actions:unresolvable-pin', re: /Unable to resolve action `[^`]+`, unable to find version/ },
  { id: 'stamp:backend-r2-claim', re: /backend stamp declared a per-app R\d bucket/ },
  { id: 'media-probe:clip-generation', re: /^Generate VP\d\/Opus test clip/ },
  { id: 'flutter:analyze-stamped', re: /^Analyze \+ test the stamped app/ },
  { id: 'web:build-failed', re: /^Build web \(release/ },
  // ── named guards that print `<guard>: FAILED` ─────────────────────────────
  { id: 'guard-failed', re: /(assert-[\w-]+): FAILED/, key: 1 },
  // ── the house refusal shape, `✗ <subject> — N problem(s):`, keyed on subject
  { id: 'guard-refused', re: /^\s*✗ ([^\n—:]{1,60}?)(?: —|:) \d+ (?:problem|finding)\(s\)/m, key: 1 },
  // ── cancellation (refined by timing in classifyRun) ──────────────────────
  { id: 'cancelled', re: /The operation was canceled|The job was canceled/ },
];

/** Non-signature text that varies per run, folded so a fallback signature
 *  groups instead of fragmenting: SHAs, timestamps, durations, counts, paths. */
export const normalise = (s) =>
  String(s)
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, '<ts>')
    // A SHA has at least one hex LETTER; an 11-digit run id has none and is a <n>.
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, '<sha>')
    .replace(/\d+(?:\.\d+)?\s*(?:ms|s|h|m)\b/g, '<dur>')
    .replace(/\/home\/runner\/work\/\S+/g, '<path>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

/** step + error block → signature id. Never the job name. */
export function signatureOf({ step, block, conclusion }, signatures = SIGNATURES) {
  const text = `${step ?? ''}\n${block ?? ''}`;
  for (const s of signatures) {
    const m = s.re.exec(text);
    if (m) {
      if (!s.key) return s.id;
      const k = String(m[s.key]).trim();
      return `${s.id}:${s.normaliseKey ? normalise(k) : k}`;
    }
  }
  if (conclusion === 'cancelled') return 'cancelled';
  // A failed step whose log carries nothing at all (the API served an empty or
  // 404 log — measured on 2026-08-25 main runs older than a fortnight). The
  // step name is the only fact; the id says so rather than pretending to a
  // message it never read.
  if (!String(block ?? '').trim()) return `no-log:${String(step ?? '(no step)').trim()}`;
  const first = String(block ?? '').split('\n')[0];
  return `other:${normalise(step ?? '(no step)')}:${normalise(first || '(no error line)')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROWS
// ═══════════════════════════════════════════════════════════════════════════

export const failingJobs = (jobs) => (jobs ?? []).filter((j) => NON_GREEN.has(String(j?.conclusion)));
export const failingStep = (job) => (job?.steps ?? []).find((s) => NON_GREEN.has(String(s?.conclusion))) ?? null;

/**
 * One run → one row (the run's PRIMARY failing job). When several non-gate
 * jobs failed, the first in job order carries the row and the others are
 * listed in `alsoFailed`, so a matrix failing five ways is one run in the
 * count, as it is one run in the owner's list.
 */
export function classifyRun(run, jobs, logFor, { newerRunExists = false, signatures = SIGNATURES } = {}) {
  const failing = failingJobs(jobs);
  const nonGate = failing.filter((j) => !GATE_STEP.test(failingStep(j)?.name ?? ''));
  const primary = nonGate[0] ?? failing[0] ?? null;
  const base = {
    id: run.id,
    workflow: String(run.path ?? '').replace(/^\.github\/workflows\//, ''),
    branch: run.head_branch,
    sha: String(run.head_sha ?? '').slice(0, 8),
    event: run.event,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    attempt: run.run_attempt ?? 1,
  };
  if (!primary) {
    // Every job green or skipped, run still non-green: a startup failure, a
    // cancellation before any job ran, or a run whose jobs the API withheld.
    const sig = run.conclusion === 'cancelled'
      ? newerRunExists ? 'cancelled:superseded-in-group' : 'cancelled:by-hand-or-unknown'
      : `startup:${run.conclusion}`;
    return { ...base, job: '(no failing job)', step: '(none)', error: '(no job ran or none failed)', signature: sig, alsoFailed: [] };
  }
  const step = failingStep(primary);
  const scoped = scopeToStep(logFor(primary) ?? [], step);
  const eb = errorBlock(scoped);
  let signature;
  if (nonGate.length === 0) {
    signature = 'gate-only';
  } else {
    signature = signatureOf({ step: step?.name, block: eb.block, conclusion: primary.conclusion }, signatures);
    if (signature === 'cancelled' || (primary.conclusion === 'cancelled' && run.conclusion === 'cancelled')) {
      signature = newerRunExists ? 'cancelled:superseded-in-group' : 'cancelled:by-hand-or-unknown';
    }
  }
  return {
    ...base,
    job: primary.name,
    step: step?.name ?? '(job-level)',
    error: eb.line,
    signature,
    alsoFailed: nonGate.slice(1).map((j) => `${j.name} › ${failingStep(j)?.name ?? '(job-level)'}`),
  };
}

/** Did a newer run of the same workflow on the same ref start while this one
 *  was still running? That is `cancel-in-progress`'s footprint. */
export function newerRunDuring(run, allRuns) {
  const a = Date.parse(run.created_at);
  const b = Date.parse(run.updated_at);
  return allRuns.some(
    (r) =>
      r.id !== run.id &&
      r.path === run.path &&
      r.head_branch === run.head_branch &&
      Date.parse(r.created_at) > a &&
      Date.parse(r.created_at) <= b + 60_000,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CAUSES — the register this ledger consumes
// ═══════════════════════════════════════════════════════════════════════════

/** The kinds a cause's `fixedBy` may take, each with the fields it must carry.
 *  `fix` stays the prose a person reads; `fixedBy` is the part a machine holds:
 *   · merge          — a commit on main fixed it: `sha` (7-40 hex) and `pr`, the
 *                      pull request's number, or null for a direct push that
 *                      had none. `also` lists further merges when one was not
 *                      enough, each `{ sha, pr }`.
 *   · superseded     — fixed on a branch before its merge, or made moot by a
 *                      later rewrite: `by` names what superseded it.
 *   · infrastructure — GitHub's runners, a vendor or the network; no commit.
 *   · not-a-defect   — no fault to fix (a cancelled run, a guard doing its
 *                      job): `reason` says why.
 *   · live-action    — fixed by an act on a live system, not a commit: `what`.
 *   · lost-race      — a race this repository lost to another writer. */
export const FIXED_BY_FIELDS = new Map([
  ['merge', { required: ['sha', 'pr'], optional: ['also'] }],
  ['superseded', { required: ['by'], optional: [] }],
  ['infrastructure', { required: [], optional: [] }],
  ['not-a-defect', { required: ['reason'], optional: [] }],
  ['live-action', { required: ['what'], optional: [] }],
  ['lost-race', { required: [], optional: [] }],
]);

const MERGE_SHA = /^[0-9a-f]{7,40}$/;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

/** One `{ sha, pr }` of a `merge`, as problems. `pr: null` is a direct push. */
function mergeProblems(m, where) {
  const out = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${where} is not an object`];
  if (typeof m.sha !== 'string' || !MERGE_SHA.test(m.sha)) out.push(`${where}.sha ${JSON.stringify(m.sha)} is not 7-40 lowercase hex`);
  if (m.pr !== null && !(Number.isInteger(m.pr) && m.pr > 0)) out.push(`${where}.pr ${JSON.stringify(m.pr)} is not a pull request number (or null for a direct push)`);
  return out;
}

/** PURE. Every shape problem in the causes register, one line each, naming the
 *  row by its signature. An empty list is a register this ledger can read. */
export function validateCauses(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return ['the register carries no causes'];
  const problems = [];
  rows.forEach((c, i) => {
    const id = nonEmpty(c?.signature) ? c.signature : `causes[${i}]`;
    for (const k of ['signature', 'rootCause', 'fix']) {
      if (!nonEmpty(c?.[k])) problems.push(`${id} — lacks \`${k}\``);
    }
    if (c?.scope !== undefined && c.scope !== 'main' && c.scope !== 'feature-branches') {
      problems.push(`${id} — scope \`${c.scope}\`; only "main" or "feature-branches" are readable`);
    }
    const f = c?.fixedBy;
    if (f === undefined) {
      problems.push(`${id} — lacks \`fixedBy\`; the prose \`fix\` is not a kind a machine can hold`);
      return;
    }
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      problems.push(`${id} — \`fixedBy\` is not an object`);
      return;
    }
    const spec = FIXED_BY_FIELDS.get(f.kind);
    if (!spec) {
      problems.push(`${id} — \`fixedBy.kind\` ${JSON.stringify(f.kind)} is not one of ${[...FIXED_BY_FIELDS.keys()].join(' · ')}`);
      return;
    }
    const allowed = new Set(['kind', ...spec.required, ...spec.optional]);
    for (const k of Object.keys(f)) if (!allowed.has(k)) problems.push(`${id} — \`fixedBy.${k}\` is not a field of kind "${f.kind}"`);
    if (f.kind === 'merge') {
      problems.push(...mergeProblems(f, 'fixedBy').map((p) => `${id} — ${p}`));
      if (f.also !== undefined) {
        if (!Array.isArray(f.also) || f.also.length === 0) problems.push(`${id} — \`fixedBy.also\` is not a non-empty array`);
        else f.also.forEach((m, j) => problems.push(...mergeProblems(m, `fixedBy.also[${j}]`).map((p) => `${id} — ${p}`)));
      }
    } else {
      for (const k of spec.required) if (!nonEmpty(f[k])) problems.push(`${id} — \`fixedBy.${k}\` is empty`);
    }
  });
  return problems;
}

export function loadCauses(path = join(ROOT, CAUSES_REL)) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(doc.causes) || doc.causes.length === 0) {
    throw new Error(`${CAUSES_REL} carries no \`causes\` array — a ledger against an empty register explains nothing`);
  }
  const problems = validateCauses(doc.causes);
  if (problems.length) {
    throw new Error(`${CAUSES_REL}: ${problems.length} problem(s) in ${doc.causes.length} cause(s):\n  ${problems.join('\n  ')}`);
  }
  return doc.causes;
}

/** Every commit a `merge` names, with the row that names it. */
export function mergeShas(causes) {
  const out = [];
  for (const c of causes) {
    if (c?.fixedBy?.kind !== 'merge') continue;
    for (const m of [c.fixedBy, ...(c.fixedBy.also ?? [])]) out.push({ signature: c.signature, sha: m.sha, pr: m.pr });
  }
  return out;
}

const gitIn = (cwd) => (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 });
  return { code: r.status, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() };
};

/** Holds every `merge` commit to `git merge-base --is-ancestor <sha> <ref>`.
 *  Offline: it reads the local clone and nothing else, so it runs before the
 *  first request. Returns `{ lost }` when the clone cannot answer (shallow, or
 *  no `ref`) — COVERAGE LOST — else `{ lost: null, missing }`, one entry per
 *  commit that is not on `ref` (exit 1 in main, naming the row). `git` is a
 *  seam; the test drives the real one against a fixture repository. */
export function checkFixesOnMain(causes, { cwd = ROOT, ref = 'origin/main', git = gitIn(cwd) } = {}) {
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.code !== 0) return { lost: `\`git rev-parse\` exited ${shallow.code} in ${cwd}: ${shallow.err.slice(0, 200)}` };
  if (shallow.out === 'true') {
    return { lost: 'the clone is SHALLOW, so a fix commit missing from it proves nothing. The ops-watch job checks out with fetch-depth: 0.' };
  }
  const tip = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (tip.code !== 0) return { lost: `${ref} does not resolve in this clone, so no fix can be held to it` };
  const missing = [];
  for (const m of mergeShas(causes)) {
    const r = git(['merge-base', '--is-ancestor', m.sha, ref]);
    if (r.code === 0) continue;
    if (r.code === 1) missing.push({ ...m, why: `not an ancestor of ${ref}` });
    else missing.push({ ...m, why: `unknown to this clone (git exited ${r.code}), and the clone is complete` });
  }
  return { lost: null, missing, checked: mergeShas(causes).length };
}

/** Exact id first; then a trailing-`*` prefix, longest prefix wins. A cause
 *  with `scope: "feature-branches"` never applies to main and one with
 *  `scope: "main"` applies only there — "fixed on the branch before merge" is
 *  not a sentence that can be true of a red run ON main. */
export function causeFor(signature, causes, branch = null) {
  const inScope = (c) =>
    !c.scope || (c.scope === 'main' ? branch === 'main' : c.scope === 'feature-branches' ? branch !== 'main' : false);
  let best = null;
  for (const c of causes) {
    if (!inScope(c)) continue;
    if (c.signature === signature) return c;
    if (c.signature.endsWith('*')) {
      const p = c.signature.slice(0, -1);
      if (signature.startsWith(p) && (!best || p.length > best.signature.length - 1)) best = c;
    }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROOF OF CLOSURE, AND THE GROUPING
// ═══════════════════════════════════════════════════════════════════════════

/** newest: Map "<path>|<branch>" → newest COMPLETED run of that workflow on that
 *  branch, any conclusion, never the run executing this ledger (newestCompleted,
 *  below). branches: Set of live branch names. prs: Map branch → pr. */
export function proofFor(row, { newest, branches, prs }) {
  const key = `${row.workflowPath}|${row.branch}`;
  const n = newest.get(key) ?? null;
  const alive = branches.has(row.branch);
  if (n && n.conclusion === 'success') {
    return { kind: 'later-green', runId: n.id, at: n.created_at, text: `later green: run ${n.id} @ ${n.created_at}` };
  }
  if (!alive) {
    const pr = prs.get(row.branch);
    if (pr?.merged_at) return { kind: 'branch-gone', pr: pr.number, sha: String(pr.merge_commit_sha ?? '').slice(0, 8), text: `branch deleted; PR #${pr.number} merged ${String(pr.merge_commit_sha ?? '').slice(0, 8)} @ ${pr.merged_at}` };
    if (pr) return { kind: 'branch-gone', pr: pr.number, text: `branch deleted; PR #${pr.number} closed unmerged` };
    return { kind: 'branch-gone', text: 'branch deleted; no PR found' };
  }
  if (n) return { kind: 'none', text: `OPEN — newest ${row.workflow} on ${row.branch} is run ${n.id} (${n.conclusion}) @ ${n.created_at}` };
  return { kind: 'none', text: `OPEN — no newer run of ${row.workflow} on live branch ${row.branch}` };
}

export const isExplained = (cause, proof) => Boolean(cause) && proof.kind !== 'none';

export function groupRows(rows, causes, ctx) {
  const groups = new Map();
  const unexplained = [];
  for (const row of rows) {
    const cause = causeFor(row.signature, causes, row.branch);
    const proof = proofFor(row, ctx);
    const explained = isExplained(cause, proof);
    const g = groups.get(row.signature) ?? { signature: row.signature, count: 0, cause, rows: [], proofs: new Map(), unexplained: 0 };
    g.count++;
    g.rows.push({ ...row, proof: proof.text, explained });
    if (!g.proofs.has(proof.text)) g.proofs.set(proof.text, 0);
    g.proofs.set(proof.text, g.proofs.get(proof.text) + 1);
    if (!explained) {
      g.unexplained++;
      unexplained.push({ ...row, proof: proof.text, why: !cause ? 'no cause in register' : 'no later green and branch still alive' });
    }
    groups.set(row.signature, g);
  }
  return { groups: [...groups.values()].sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature)), unexplained };
}

const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

export function renderTable(groups) {
  const out = [];
  out.push('signature | count | root cause | fix | proof of later green / closure');
  out.push('--- | --- | --- | --- | ---');
  for (const g of groups) {
    const proofs = [...g.proofs.entries()].sort((a, b) => b[1] - a[1]);
    const shown = proofs.slice(0, 3).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t));
    if (proofs.length > 3) shown.push(`+${proofs.length - 3} more`);
    out.push(
      [
        g.signature,
        g.count + (g.unexplained ? ` (${g.unexplained} UNEXPLAINED)` : ''),
        g.cause ? clip(g.cause.rootCause, 220) : '— NO CAUSE IN REGISTER —',
        g.cause ? clip(g.cause.fix, 160) : '—',
        shown.join('; '),
      ].join(' | '),
    );
  }
  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — live (with an optional immutable cache), or a fixture with NO
// NETWORK PATH AT ALL
// ═══════════════════════════════════════════════════════════════════════════

const PER_PAGE = 100;
/** GitHub stops paging this endpoint at 1000 results per query. */
const LIST_CEILING = 1000;

/** D1: the requests a walk must leave unspent in the quota it shares with every
 *  other reader of the same token (THE QUOTA FLOOR, in the header). */
export const QUOTA_FLOOR = 400;
/** D1: the default hard ceiling on the requests one walk may send. D1's number,
 *  not a measurement: a live run prints `REQUESTS: n sent` beside it. */
export const DEFAULT_MAX_REQUESTS = 300;

/** PURE. The quota-floor verdict on GET /rate_limit's `resources.core` bucket:
 *  the walk may start only when `remaining - ceiling >= floor`. A bucket with no
 *  integer `remaining` is a refusal, never a start. */
export function quotaFloor(core, ceiling, floor = QUOTA_FLOOR) {
  const remaining = core?.remaining;
  if (!Number.isInteger(remaining)) {
    return { ok: false, line: 'quota floor — GET /rate_limit carried no integer resources.core.remaining, so what this walk would leave is unknown and it did not start' };
  }
  const left = remaining - ceiling;
  if (left >= floor) return { ok: true, line: `quota floor: ${remaining} remaining - ceiling ${ceiling} = ${left} >= ${floor}; the walk may start` };
  const reset = Number.isInteger(core.reset) ? ` The quota resets at ${new Date(core.reset * 1000).toISOString()}.` : '';
  return {
    ok: false,
    line: `quota floor — ${remaining} remaining - ceiling ${ceiling} = ${left}, under the floor of ${floor}, so the walk did not start: spending its ceiling could leave the other readers of this quota fewer than ${floor} requests.${reset}`,
  };
}

export class CoverageLost extends Error {
  constructor(msg) {
    super(msg);
    this.name = 'COVERAGE LOST';
  }
}

// ── WHAT MAY REACH THE NETWORK, AND HOW THE CACHE IS TOUCHED ────────────────
// ⏱ 2026-09-11 · Three CodeQL alerts on this file, answered in code rather than
// dismissed:
//   · js/file-access-to-http — the flow CodeQL traced runs from the local vault
//     FILE (safe-rerun.mjs `fromVault`) into the `authorization` header. The
//     credential and the repository slug are now held to the shapes GitHub
//     issues before either is placed in a request, and every request path is
//     held to the shapes this reader builds, numeric ids only — so nothing
//     read from a file (the vault, a git remote, a cached run) reaches `fetch`
//     unless it has one of those shapes.
//   · js/file-system-race — the cache was `existsSync(p)` then `readFileSync(p)`;
//     a file removed between the two crashed the run. It is now read ONCE, with
//     ENOENT as the only "not cached" answer, and written to a unique temporary
//     name and RENAMED into place, so no reader ever sees a half-written file.

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The shapes of a GitHub credential: `ghp_` `gho_` `ghu_` `ghs_` `ghr_` tokens,
 *  a fine-grained `github_pat_`, and a legacy 40-hex token. Anything else — a
 *  pasted `Bearer …`, a trailing newline, a second header after CR/LF — is
 *  refused before it can be sent. */
// ⏱ 2026-09-26 · the Actions job token failed this shape on its FIRST live run (ops-watch #526, run 36203215773,
// job 108294094867, the day #959 wired GH_TOKEN: ${{ github.token }}): "does not have the shape of a GitHub
// token", exit 2, while every fixture and the laptop's gho_ token passed. GitHub's issued tokens are longer than
// 251 characters, or carry `_`/`-`/`.`, so the body is now any run of header-safe token characters up to 2048,
// still prefix-anchored. What the check exists to refuse is unchanged: a `Bearer ` paste, whitespace, CR/LF
// (a second header), and anything that is not one of these shapes. On a refusal, credentialShape() says why in
// words that carry no part of the value, so the next miss is diagnosable from the log.
const GITHUB_TOKEN_SHAPE = /^(?:gh[pousr]_[A-Za-z0-9_.-]{30,2048}|github_pat_[A-Za-z0-9_]{22,2048}|[0-9a-f]{40})$/;
export const isValidGithubToken = (tok) => typeof tok === 'string' && GITHUB_TOKEN_SHAPE.test(tok);

/** PURE. A description of a credential's SHAPE that holds no part of its value: its length, whether it starts
 *  with a known prefix (named only by its family), and which character classes occur. Safe to print. */
export function credentialShape(tok) {
  if (typeof tok !== 'string') return `not a string (${typeof tok})`;
  const family = /^gh[pousr]_/.test(tok) ? 'a gh?_ prefix' : tok.startsWith('github_pat_') ? 'a github_pat_ prefix' : /^[0-9a-f]+$/.test(tok) ? 'hex only' : 'no known prefix';
  const classes = [[/[A-Za-z]/, 'letters'], [/[0-9]/, 'digits'], [/_/, 'underscore'], [/-/, 'hyphen'], [/\./, 'dot'], [/\s/, 'WHITESPACE'], [/[^A-Za-z0-9_.\s-]/, 'OTHER symbols']]
    .filter(([re]) => re.test(tok)).map(([, n]) => n);
  return `length ${tok.length}, ${family}, characters: ${classes.join(', ') || 'none'}`;
}

/** `owner/name` by GitHub's character rules; a name may not start with `.`, so
 *  `..` can never climb out of `/repos/`. */
const REPO_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;
export const isValidRepoSlug = (repo) => typeof repo === 'string' && REPO_SHAPE.test(repo);

/** A query string exactly as this reader builds one: `encodeURIComponent` output
 *  joined by `=` and `&`. No `/`, no `#`, no `..` segment can appear in it. */
const QUERY = String.raw`\?[A-Za-z0-9_.!~*'()%&=-]*`;
const NUMERIC_ID = '[0-9]{1,20}';

/** The seven request paths this reader issues, and nothing else: the six
 *  repository reads, and the quota read the floor asks before them. */
export function isAllowedApiPath(repo, path) {
  if (!isValidRepoSlug(repo) || typeof path !== 'string') return false;
  const R = `/repos/${reEscape(repo)}`;
  return [
    `${R}/actions/runs${QUERY}`,
    `${R}/actions/runs/${NUMERIC_ID}/jobs${QUERY}`,
    `${R}/actions/jobs/${NUMERIC_ID}/logs`,
    `${R}/actions/workflows/${NUMERIC_ID}/runs${QUERY}`,
    `${R}/branches${QUERY}`,
    `${R}/pulls${QUERY}`,
    '/rate_limit',
  ].some((shape) => new RegExp(`^${shape}$`).test(path));
}

/** A cache entry is one flat file name inside the cache directory — never a path. */
const CACHE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,200}$/;

const REAL_FS = { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync };

/** Read `name` from `cacheDir`, or fetch it and cache it. No check precedes the
 *  read (ENOENT is the only miss), and the write lands by rename. `fs` is a seam
 *  for the test that removes the file between a would-be check and the read. */
export async function readThroughCache(cacheDir, name, fetcher, { text = false, fs = REAL_FS } = {}) {
  if (!cacheDir) return fetcher();
  if (!CACHE_NAME.test(name) || name.includes('..')) {
    throw new CoverageLost(`refusing cache entry ${JSON.stringify(String(name)).slice(0, 120)} — not a flat file name`);
  }
  const p = join(cacheDir, name);
  let raw = null;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (raw !== null) return text ? raw : JSON.parse(raw);
  const v = await fetcher();
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tmp, text ? v : JSON.stringify(v), { flag: 'wx' });
    fs.renameSync(tmp, p);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the original error is the one worth reporting */
    }
    throw e;
  }
  return v;
}

/** PURE. The run the later-green proof reads, from a workflow's run list as
 *  GitHub orders it (newest first): the first COMPLETED run that is not
 *  `selfRunId`, the run executing this ledger. ⏱ 2026-09-26
 *  (O-FAILURE-LEDGER-CANNOT-CLEAR-OPS-WATCH): the ledger runs INSIDE ops-watch,
 *  and the unfiltered `per_page=1` query answered the executing run itself,
 *  still in progress (conclusion null), so every failed ops-watch.yml run read
 *  OPEN whatever cause was recorded. The query now asks `status=completed`;
 *  this holds the same line on whatever the API answers. */
export function newestCompleted(runs, { selfRunId = null } = {}) {
  if (!Array.isArray(runs)) return null;
  const self = selfRunId === null ? null : String(selfRunId);
  return runs.find((r) => r?.status === 'completed' && String(r.id) !== self) ?? null;
}

/** GITHUB_RUN_ID as a run id, or null when it is absent or not numeric. */
export const selfRunIdFrom = (env) => (/^[0-9]{1,20}$/.test(String(env?.GITHUB_RUN_ID ?? '')) ? env.GITHUB_RUN_ID : null);

export function liveApi(repo, tok, cacheDir, { maxRequests = DEFAULT_MAX_REQUESTS, selfRunId = null } = {}) {
  // Held HERE, where the header is built, as well as in main(): a caller that
  // skips main() must not be able to send an unshaped credential either.
  if (!isValidGithubToken(tok)) {
    throw new CoverageLost('the GitHub credential does not have the shape of a GitHub token, so it was not sent');
  }
  if (!isValidRepoSlug(repo)) {
    throw new CoverageLost(`${JSON.stringify(String(repo)).slice(0, 120)} is not an owner/name repository slug`);
  }
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new CoverageLost(`the request ceiling ${JSON.stringify(maxRequests)} is not a positive whole number, so no request was sent`);
  }
  const headers = {
    authorization: `Bearer ${tok}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nikatru-triage-failed-runs',
  };
  // THE HARD CEILING (D1). The count is taken inside the fetch the retry plan
  // calls, once per ATTEMPT, so a retried request counts every time it is sent
  // and the quota spent can never pass the ceiling the floor was computed
  // against. The request past it is refused unsent. GET /rate_limit is not
  // counted, because GitHub does not count it.
  let sent = 0;
  const ceilingReached = (path) =>
    new CoverageLost(
      `request ceiling — ${sent} of ${maxRequests} request(s) sent, and GET ${path} would be one more, so it was not sent and nothing after this point was read. Raise --max-requests only with the quota floor in view.`,
    );
  // ⏱ 2026-09-26 — THE BODY IS READ INSIDE THE ATTEMPT. bounded-retry arms its
  // per-request ceiling when an attempt starts and, on success, only unrefs it
  // (attemptWithCeiling), so a body read after the helper returned was still
  // under that signal: a job log still arriving 15 s after its request began was
  // aborted with the bare "no answer within 15s", OUTSIDE the retry loop, and the
  // walk exited 2 (train W30's first live fetch, at 358 requests). Read here, a
  // slow body is a slow attempt — a transient look, re-asked under a fresh
  // ceiling like a slow header. A non-2xx answer is handed back unread, as before.
  const bodyInAttempt = async (res) => {
    if (!res.ok) return res;
    const body = await res.text();
    return { ok: true, status: res.status, headers: res.headers, text: async () => body, json: async () => JSON.parse(body) };
  };
  const send = async (path, { counted }) => {
    if (!isAllowedApiPath(repo, path)) {
      throw new CoverageLost(
        `refusing to request ${JSON.stringify(String(path)).slice(0, 160)} — not one of the seven GitHub API paths this reader builds (numeric ids only)`,
      );
    }
    const url = new URL(`${API}${path}`);
    if (url.origin !== API) throw new CoverageLost(`refusing a request that resolved off ${API} (${url.origin})`);
    // The shared plan (bounded-retry.mjs): a dropped wire, a 429 or a 5xx is
    // re-asked a bounded number of times, each attempt under the per-request
    // ceiling, and one that outlives the plan throws — COVERAGE LOST in main().
    // Since 2026-09-25 this is an ops-watch reader, and one silent socket would
    // otherwise hold the job until its timeout-minutes.
    let refused = false;
    try {
      return await fetchWithBoundedRetry(
        ({ signal }) => {
          if (counted) {
            if (sent >= maxRequests) {
              refused = true;
              throw ceilingReached(path);
            }
            sent += 1;
          }
          return fetch(url, { headers, redirect: 'follow', signal }).then(bodyInAttempt);
        },
        { describe: (s) => `GET ${path} — ${s}` },
      );
    } catch (e) {
      // The plan re-wraps whatever the fetch threw; the ceiling is said plainly.
      if (refused) throw ceilingReached(path);
      throw e;
    }
  };
  const get = async (path, { text = false } = {}) => {
    const res = await send(path, { counted: true });
    if (res.status === 403 || res.status === 429) {
      throw new CoverageLost(`GET ${path} → HTTP ${res.status} — the quota or the credential refused; nothing after this point was read`);
    }
    if (!res.ok) {
      const e = new Error(`GET ${path} → HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return text ? res.text() : res.json();
  };
  const cached = (name, fetcher, { text = false } = {}) => readThroughCache(cacheDir, name, fetcher, { text });
  /** A branch's newest COMPLETED run (newestCompleted, above). NEVER cached —
   *  see --cache-dir in the header. */
  const fetchNewest = async (workflowId, branch) => {
    const body = await get(`/repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=2`);
    return newestCompleted(body.workflow_runs, { selfRunId });
  };
  return {
    live: true,
    /** GET /rate_limit's `resources.core` bucket, read before the first counted
     *  request (THE QUOTA FLOOR). Not counted. Anything but a 200 throws. */
    rateLimit: async () => {
      const res = await send('/rate_limit', { counted: false });
      if (!res.ok) throw new CoverageLost(`GET /rate_limit → HTTP ${res.status}`);
      const body = await res.json();
      return body?.resources?.core ?? null;
    },
    requestsSent: () => sent,
    /** Every run with one of the non-green conclusions. Never cached: the
     *  list is the enumeration, and yesterday's list is the sample this tool
     *  exists to replace. */
    listNonGreen: async (since, until, branch = null) => {
      const out = [];
      const capped = [];
      const created = since && until ? `${since}..${until}` : since ? `>=${since}` : until ? `<=${until}` : null;
      for (const status of NON_GREEN) {
        const q =
          `status=${status}&per_page=${PER_PAGE}` +
          (branch ? `&branch=${encodeURIComponent(branch)}` : '') +
          (created ? `&created=${encodeURIComponent(created)}` : '');
        let total = null;
        for (let page = 1; page <= LIST_CEILING / PER_PAGE; page++) {
          const body = await get(`/repos/${repo}/actions/runs?${q}&page=${page}`);
          total = Number(body.total_count ?? 0);
          const batch = body.workflow_runs ?? [];
          out.push(...batch);
          if (batch.length < PER_PAGE) break;
        }
        const got = out.filter((r) => r.conclusion === status).length;
        if (total !== null && got < total) capped.push(`${status}: ${got} of ${total}`);
      }
      return { runs: out, capped };
    },
    // Keyed by ATTEMPT: `gh run rerun` keeps the run id, so attempt 1's cached
    // jobs would otherwise be served for attempt 2. Attempt 1 keeps the old name.
    listJobs: (id, attempt = 1) =>
      cached(Number(attempt) > 1 ? `${id}.attempt-${Number(attempt)}.jobs.json` : `${id}.jobs.json`, () =>
        get(`/repos/${repo}/actions/runs/${id}/jobs?per_page=${PER_PAGE}&filter=all`),
      ),
    // 404 is an ANSWER here — a job cancelled before its first step ran has no
    // log (measured 2026-08-04, run 30874929577: eight lanes cancelled at +6s,
    // every log 404). It is the ONLY status turned into an empty log; a 403
    // still throws COVERAGE LOST above, so the quota cannot read as "no log".
    jobLog: (id, jobId) =>
      cached(
        `${id}.job-${jobId}.log`,
        async () => {
          try {
            return await get(`/repos/${repo}/actions/jobs/${jobId}/logs`, { text: true });
          } catch (e) {
            if (e.status === 404) return '';
            throw e;
          }
        },
        { text: true },
      ),
    newestRun: (workflowId, branch) => fetchNewest(workflowId, branch),
    /** Every run of one workflow on one ref created inside [from, to] — the
     *  window in which a `cancel-in-progress` successor must have started. */
    runsBetween: (workflowId, branch, id, from, to) =>
      cached(`between-${id}.json`, async () => {
        const body = await get(
          `/repos/${repo}/actions/workflows/${workflowId}/runs?branch=${encodeURIComponent(branch)}&created=${encodeURIComponent(`${from}..${to}`)}&per_page=${PER_PAGE}`,
        );
        return body.workflow_runs ?? [];
      }),
    branches: async () => {
      const names = new Set();
      for (let page = 1; page <= 20; page++) {
        const body = await get(`/repos/${repo}/branches?per_page=${PER_PAGE}&page=${page}`);
        for (const b of body) names.add(b.name);
        if (body.length < PER_PAGE) break;
      }
      return names;
    },
    prFor: (branch) =>
      cached(`pr-${branch.replace(/[^\w.-]+/g, '_')}.json`, async () => {
        const owner = repo.split('/')[0];
        const body = await get(`/repos/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=all&per_page=5`);
        const merged = body.find((p) => p.merged_at) ?? body[0] ?? null;
        return merged ? { number: merged.number, merged_at: merged.merged_at, merge_commit_sha: merged.merge_commit_sha, state: merged.state } : null;
      }),
  };
}

export function fixtureApi(dir) {
  const read = (name, fallback) => {
    const p = join(dir, name);
    if (!existsSync(p)) {
      if (fallback !== undefined) return fallback;
      throw new CoverageLost(`fixture ${name} is missing from ${dir}`);
    }
    return name.endsWith('.log') ? readFileSync(p, 'utf8') : JSON.parse(readFileSync(p, 'utf8'));
  };
  return {
    live: false,
    repo: read('repo.json', { repo: 'fixture/fixture' }).repo,
    listNonGreen: async (_since, _until, branch = null) => ({
      runs: read('runs.json').filter((r) => !branch || r.head_branch === branch),
      capped: read('capped.json', []),
    }),
    listJobs: async (id) => read(`${id}.jobs.json`),
    // A missing log reads as EMPTY, never as a throw: the row then classifies
    // as `other:…:(no error line)`, which has no cause and is UNEXPLAINED —
    // the safe direction for a fixture that forgot a file.
    jobLog: async (id, jobId) => read(`${id}.job-${jobId}.log`, ''),
    newestRun: async (_wf, _branch, key) => read('newest.json', {})[key] ?? null,
    runsBetween: async (_wf, _branch, id) => read(`between-${id}.json`, []),
    branches: async () => new Set(read('branches.json', [])),
    prFor: async (branch) => read('prs.json', {})[branch] ?? null,
  };
}

function repoFromGit() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
export function parseArgs(argv) {
  const a = { repo: null, since: null, until: null, cacheDir: null, fixtureDir: null, prs: true, json: null, causes: null, maxRequests: DEFAULT_MAX_REQUESTS, branch: null };
  let branchGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--repo') a.repo = argv[++i] ?? null;
    else if (x === '--since') a.since = argv[++i] ?? null;
    else if (x === '--until') a.until = argv[++i] ?? null;
    else if (x === '--cache-dir') a.cacheDir = argv[++i] ?? null;
    else if (x === '--fixture-dir') a.fixtureDir = argv[++i] ?? null;
    else if (x === '--causes') a.causes = argv[++i] ?? null;
    else if (x === '--json') a.json = argv[++i] ?? null;
    else if (x === '--max-requests') a.maxRequests = argv[++i] ?? null;
    else if (x === '--branch') {
      branchGiven = true;
      a.branch = argv[++i] ?? null;
    } else if (x === '--no-prs') a.prs = false;
    else return { error: `unrecognised argument \`${x}\`` };
  }
  if (a.since && !Number.isFinite(Date.parse(a.since))) return { error: `--since must be an ISO instant, got \`${a.since}\`` };
  if (a.until && !Number.isFinite(Date.parse(a.until))) return { error: `--until must be an ISO instant, got \`${a.until}\`` };
  if (!/^[1-9][0-9]{0,5}$/.test(String(a.maxRequests))) return { error: `--max-requests must be a whole number from 1, got \`${a.maxRequests}\`` };
  a.maxRequests = Number(a.maxRequests);
  if (branchGiven && !/^\S+$/.test(String(a.branch ?? ''))) return { error: `--branch must be a branch name without whitespace, got \`${a.branch}\`` };
  return a;
}

/** The whole ledger, given a transport. Exported so the test can drive it
 *  with a mutated signature table and watch UNEXPLAINED move. */
export async function ledger(api, { since = null, until = null, branch = null, prs = true, causes, signatures = SIGNATURES, log = () => {} } = {}) {
  const { runs: all, capped } = await api.listNonGreen(since, until, branch);
  const inWindow = (r) => (!since || Date.parse(r.created_at) >= Date.parse(since)) && (!until || Date.parse(r.created_at) <= Date.parse(until));
  const runs = all.filter((r) => NON_GREEN.has(String(r.conclusion)) && inWindow(r));
  runs.sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));
  const range = runs.length ? `${runs[runs.length - 1].created_at} .. ${runs[0].created_at}` : '(none)';
  log(`enumerated ${runs.length} non-green run(s), ${range}${since ? ` (since ${since})` : ''}${until ? ` (until ${until})` : ''}`);
  for (const c of capped) log(`✗ COVERAGE LOST — the run list was CAPPED by the API: ${c}`);

  const rows = [];
  let n = 0;
  for (const run of runs) {
    n++;
    const jobsBody = await api.listJobs(run.id, run.run_attempt ?? 1);
    const jobs = jobsBody?.jobs ?? [];
    if (typeof jobsBody?.total_count === 'number' && jobsBody.total_count > jobs.length) {
      throw new CoverageLost(`run ${run.id} reports ${jobsBody.total_count} job(s) but one page carried ${jobs.length}`);
    }
    const logs = new Map();
    const failing = failingJobs(jobs).filter((j) => !GATE_STEP.test(failingStep(j)?.name ?? ''));
    const primary = failing[0] ?? failingJobs(jobs)[0];
    if (primary) {
      const text = await api.jobLog(run.id, primary.id);
      logs.set(primary.id, String(text ?? '').split(/\r?\n/));
    }
    // 🔴 THE SUCCESSOR THAT EVICTED A CANCELLED RUN IS USUALLY GREEN, so it is
    // NOT in the non-green list this ledger enumerates. Ask the API for every
    // run of the same workflow on the same ref created while this one lived.
    let newerRunExists = false;
    if (run.conclusion === 'cancelled' || failingJobs(jobs).some((j) => j.conclusion === 'cancelled')) {
      const to = new Date(Date.parse(run.updated_at) + 60_000).toISOString();
      const between = await api.runsBetween(run.workflow_id, run.head_branch, run.id, run.created_at, to);
      newerRunExists = newerRunDuring(run, [...(between ?? []), ...all]);
    }
    const row = classifyRun(run, jobs, (j) => logs.get(j.id) ?? [], { newerRunExists, signatures });
    row.workflowPath = run.path;
    row.workflowId = run.workflow_id;
    rows.push(row);
    if (n % 50 === 0) log(`  … ${n}/${runs.length} classified`);
  }

  const newest = new Map();
  const pairs = new Map();
  for (const r of rows) pairs.set(`${r.workflowPath}|${r.branch}`, r);
  for (const [key, r] of pairs) newest.set(key, await api.newestRun(r.workflowId, r.branch, key));
  const branches = await api.branches();
  const prMap = new Map();
  if (prs) {
    for (const b of new Set(rows.map((r) => r.branch))) {
      if (!branches.has(b)) prMap.set(b, await api.prFor(b));
    }
  }
  const { groups, unexplained } = groupRows(rows, causes, { newest, branches, prs: prMap });
  return { runs, rows, groups, unexplained, capped, range, newest, branches, prs: prMap };
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`✗ COVERAGE LOST — ${args.error}`);
    return 2;
  }
  let causes;
  try {
    causes = loadCauses(args.causes ? resolve(args.causes) : undefined);
  } catch (e) {
    console.error(`✗ COVERAGE LOST — ${e.message}`);
    return 2;
  }
  let api;
  if (args.fixtureDir) {
    if (!existsSync(args.fixtureDir)) {
      console.error(`✗ COVERAGE LOST — --fixture-dir ${args.fixtureDir} does not exist`);
      return 2;
    }
    api = fixtureApi(resolve(args.fixtureDir));
    console.log(`⚠️  FIXTURE TRANSPORT — no network. Reading ${args.fixtureDir}`);
  } else {
    const repo = args.repo ?? (process.env.GITHUB_REPOSITORY?.trim() || repoFromGit());
    if (!repo) {
      console.error('✗ COVERAGE LOST — no repository. Pass --repo owner/name or set GITHUB_REPOSITORY.');
      return 2;
    }
    const tok = token();
    if (!tok) {
      console.error('✗ COVERAGE LOST — no GitHub credential. Set GH_TOKEN/GITHUB_TOKEN, or make the vault key Project_Cross_Platform_Apps_GITHUB_PAT readable.');
      return 2;
    }
    if (!isValidGithubToken(tok)) {
      // The value is never printed: a mis-pasted vault line is still a secret.
      console.error(
        `✗ COVERAGE LOST — the GitHub credential does not have the shape of a GitHub token (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_/40-hex), so it was not sent. Its value is not printed; its shape: ${credentialShape(tok)}.`,
      );
      return 2;
    }
    if (!isValidRepoSlug(repo)) {
      console.error(`✗ COVERAGE LOST — ${JSON.stringify(String(repo)).slice(0, 120)} is not an owner/name repository slug, so no request path can be built from it.`);
      return 2;
    }
    // Before the first request: a ledger that explains a failure by a fix main
    // never received is explaining nothing. Live path only — a fixture run
    // reads no clone, and a test checkout may be shallow.
    const onMain = checkFixesOnMain(causes);
    if (onMain.lost) {
      console.error(`✗ COVERAGE LOST — the merge-base check could not run: ${onMain.lost}`);
      return 2;
    }
    if (onMain.missing.length) {
      console.error(`✗ ${onMain.missing.length} fix commit(s) named in ${CAUSES_REL} are not on main — a cause whose fix never reached main is not a fix:`);
      for (const m of onMain.missing) console.error(`    ${m.signature} — fixedBy ${m.sha}${m.pr ? ` (PR #${m.pr})` : ''}: ${m.why}`);
      return 1;
    }
    console.log(`merge-base: ${onMain.checked} fix commit(s) named by the causes register are all on origin/main`);
    api = liveApi(repo, tok, args.cacheDir ? resolve(args.cacheDir) : null, { maxRequests: args.maxRequests, selfRunId: selfRunIdFrom(process.env) });
    // THE QUOTA FLOOR (D1, in the header), before the first counted request.
    let floor;
    try {
      floor = quotaFloor(await api.rateLimit(), args.maxRequests);
    } catch (e) {
      console.error(`✗ COVERAGE LOST — quota floor — GET /rate_limit could not be read (${e.message}), so what this walk would leave is unknown and it did not start`);
      return 2;
    }
    if (!floor.ok) {
      console.error(`✗ COVERAGE LOST — ${floor.line}`);
      return 2;
    }
    console.log(floor.line);
    console.log(`triage-failed-runs — ${repo}${args.cacheDir ? ` (cache ${args.cacheDir})` : ''}`);
  }

  let result;
  try {
    result = await ledger(api, { since: args.since, until: args.until, branch: args.branch, prs: args.prs, causes, log: (m) => console.log(m) });
  } catch (e) {
    if (e instanceof CoverageLost) {
      console.error(`✗ COVERAGE LOST — ${e.message}`);
      return 2;
    }
    console.error(`✗ COVERAGE LOST — ${e.message}`);
    return 2;
  }
  const { rows, groups, unexplained, capped, range } = result;
  console.log('');
  if (api.live) console.log(`REQUESTS: ${api.requestsSent()} sent, ceiling ${args.maxRequests}`);
  console.log(`COVERAGE: ${rows.length} non-green run(s), ${range}${capped.length ? ` — CAPPED (${capped.join('; ')})` : ' — the API returned every run it holds'}`);
  console.log('');
  console.log(renderTable(groups));
  console.log('');
  const explained = rows.length - unexplained.length;
  console.log(`ARITHMETIC: ${rows.length} total = ${explained} explained across ${groups.length} group(s) + ${unexplained.length} unexplained`);
  if (unexplained.length) {
    console.log('');
    console.log('UNEXPLAINED RUNS, individually:');
    for (const u of unexplained) {
      console.log(`  · run ${u.id} · ${u.workflow} · ${u.branch} @ ${u.sha} · ${u.conclusion} · ${u.createdAt}`);
      console.log(`      job: ${u.job} › step: ${u.step}`);
      console.log(`      error: ${clip(u.error, 200)}`);
      console.log(`      signature: ${u.signature} · ${u.why} · ${u.proof}`);
    }
  }
  if (args.json) {
    writeFileSync(resolve(args.json), JSON.stringify({ range, capped, rows: result.rows, groups: groups.map((g) => ({ ...g, proofs: [...g.proofs] })), unexplained }, null, 1));
    console.log(`wrote ${args.json}`);
  }
  console.log('');
  console.log(`UNEXPLAINED: ${unexplained.length}`);
  if (capped.length) {
    console.error('✗ COVERAGE LOST — the enumeration was capped; the count above is over a SUBSET. Pass --since to bound it.');
    return 2;
  }
  return unexplained.length > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`✗ COVERAGE LOST — ${e?.stack ?? e}`);
      process.exitCode = 2;
    },
  );
}
