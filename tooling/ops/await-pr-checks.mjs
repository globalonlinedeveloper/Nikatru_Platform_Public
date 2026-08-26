#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// await-pr-checks.mjs — poll a PR's HEAD check-runs and answer pass / fail /
// I could not tell. A LOCAL tool: run it from a workstation before merging.
//
// 🔴 THE TRAP IT EXISTS TO PREVENT. `[].every()` is TRUE. On 2026-08-26 an
// ad-hoc wait loop graded PR #384 with `all(.bucket != "pending")`, reported
// `pass: 2`, and called it settled — "no checks have registered yet" was
// indistinguishable from "every check passed". Branch protection stopped that
// merge; the poll did not. So the floor below is `length > 0 && every(...)`,
// and an empty list is NO CHECKS REGISTERED — its own sentence, exit 2.
//
// ⚠️ NOT A CI STEP, ON PURPOSE. A check that runs inside CI cannot detect the
// absence of CI: when zero runs happen it does not execute, so it would be
// green by not running, in exactly the failure it targets.
//
// ── EXIT CONTRACT ────────────────────────────────────────────────────────────
//   0 = ALL CHECKS PASSED   — at least one check ran and every one concluded
//                             success / skipped / neutral.
//   1 = A CHECK FAILED      — decided, and the answer is no.
//   2 = I COULD NOT TELL    — NO CHECKS REGISTERED, STILL PENDING AT TIMEOUT,
//                             or no credential / repo / readable API. Never
//                             readable as "it is fine", and never as "it
//                             failed": those are the other two codes.
//
// ⚠️ NO `process.exit()` ONCE A `fetch` HAS BEEN MADE — an open undici handle
// crashes libuv on Windows and returns 127 for BOTH outcomes, collapsing the
// distinction the codes above exist to draw. `process.exitCode` + return.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//   node tooling/ops/await-pr-checks.mjs <prNumber> [--repo owner/name]
//        [--timeout-seconds N] [--poll-seconds N] [--any-app] [--app <slug>]
//
//   --any-app     count EVERY check-run app, not just GitHub Actions. Default
//                 is Actions-only: `cloudflare-workers-and-pages` posts two
//                 passing checks per commit here, and two green Pages checks
//                 are not CI having graded anything.
//   --app <slug>  restrict the graded set to these apps (repeatable).
//
//   Credential: GH_TOKEN / GITHUB_TOKEN, else the local vault key
//   `Project_Cross_Platform_Apps_GITHUB_PAT`, read through safe-rerun.mjs's
//   `token()` — the same reader, so the vault's mixed quoting is handled once.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { token } from './safe-rerun.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const API = 'https://api.github.com';

/** The app that means "Actions graded this". Measured 2026-08-26 on this
 *  repository: PR #386's head carries 18 `github-actions` check-runs and 2
 *  `cloudflare-workers-and-pages` ones. */
export const ACTIONS_APP = 'github-actions';

/** Completed conclusions that are NOT a failure. Anything else that has
 *  completed — failure, cancelled, timed_out, action_required, stale,
 *  startup_failure, or a conclusion GitHub adds tomorrow — counts as failed.
 *  Fail closed: an unrecognised verdict must not be read as a pass. */
export const PASSING = new Set(['success', 'skipped', 'neutral']);

export const appOf = (c) => String(c?.app?.slug ?? '');
export const isCompleted = (c) => String(c?.status) === 'completed';
export const isPassed = (c) => isCompleted(c) && PASSING.has(String(c?.conclusion));
export const isFailed = (c) => isCompleted(c) && !PASSING.has(String(c?.conclusion));

/**
 * 🔴 THE FLOOR, AND THE ONE LINE THIS WHOLE FILE IS FOR.
 * `checks.every(...)` alone returns TRUE for an empty list, so "nothing has
 * registered" would grade identically to "everything passed". The `length > 0`
 * conjunct is what makes those two different answers.
 */
export const settledGreen = (checks) => checks.length > 0 && checks.every(isPassed);

/** Restrict to the apps the caller is asking about. `null` means every app. */
export const gradedSet = (checks, requiredApps) =>
  requiredApps === null ? checks : checks.filter((c) => requiredApps.has(appOf(c)));

/**
 * The judgement, pure — no network, no clock — so every outcome has a failing
 * case that needs neither.
 *
 * @returns { state, code, headline, reason }
 *   state `pending` carries code `null`: not an answer, keep polling.
 */
export function classify(checks, requiredApps = new Set([ACTIONS_APP])) {
  const graded = gradedSet(checks, requiredApps);
  const scope = requiredApps === null ? 'any app' : `app(s) ${[...requiredApps].join(', ')}`;

  const failed = graded.filter(isFailed);
  if (failed.length) {
    return {
      state: 'fail',
      code: 1,
      headline: 'A CHECK FAILED',
      reason:
        `${failed.length} of ${graded.length} check-run(s) concluded badly: ` +
        failed.map((c) => `${c.name} → ${c.conclusion}`).join('; '),
    };
  }

  if (settledGreen(graded)) {
    return {
      state: 'pass',
      code: 0,
      headline: 'ALL CHECKS PASSED',
      reason: `${graded.length} check-run(s) from ${scope} all completed and none failed.`,
    };
  }

  if (graded.length === 0) {
    return {
      state: 'no-checks',
      code: 2,
      headline: 'NO CHECKS REGISTERED',
      reason:
        `NOT ONE check-run from ${scope} exists on this commit` +
        (checks.length
          ? ` (${checks.length} check-run(s) from other apps are present and were NOT counted)`
          : '') +
        '. That is "I could not tell" — it is not "it is fine", and it is not "it failed". ' +
        'An empty list is what a bare `.every()` grades as a clean pass; this refuses to.',
    };
  }

  const running = graded.filter((c) => !isCompleted(c)).length;
  return {
    state: 'pending',
    code: null,
    headline: 'STILL RUNNING',
    reason: `${running} of ${graded.length} check-run(s) have not completed.`,
  };
}

/** Per-app tally, printed on every poll: the caller's own evidence for whether
 *  Actions graded this commit or only an integration did. */
export function tally(checks) {
  const byApp = new Map();
  for (const c of checks) byApp.set(appOf(c), (byApp.get(appOf(c)) ?? 0) + 1);
  return (
    [...byApp.entries()]
      .sort()
      .map(([a, n]) => `${a || '(no app)'}=${n}`)
      .join(' · ') || '(none)'
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — live, or a fixture with NO NETWORK PATH AT ALL
// ═══════════════════════════════════════════════════════════════════════════

/** ⚠️ `per_page=100` — GitHub's maximum, and the value the sibling
 *  `assert-gate-passed.mjs` already uses on this endpoint. Chosen rather than
 *  inherited: a smaller page is a saturation cliff that silently truncates the
 *  set being graded, and a truncated set is a smaller `.every()` that passes
 *  more easily. Pagination IS followed, to `total_count`; if the pages run out
 *  before the count is reached that is exit 2, never a short answer. */
const PER_PAGE = 100;
const MAX_PAGES = 10;

function liveApi(repo, tok) {
  const headers = {
    authorization: `Bearer ${tok}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'nikatru-await-pr-checks',
  };
  const get = async (path) => {
    const res = await fetch(`${API}${path}`, { headers });
    if (!res.ok) {
      const e = new Error(`GET ${path} → HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  };
  return {
    live: true,
    headSha: async (pr) => (await get(`/repos/${repo}/pulls/${pr}`)).head?.sha ?? null,
    // 🔴 CHECK-RUNS, NOT COMMIT STATUSES. Measured 2026-08-26: this repository's
    // PR heads carry 20 check-runs and ZERO statuses, and `/status` answers
    // `state: "pending"` with `total_count: 0` for that empty set. Reading that
    // `pending` as "something is pending" is a false positive with no subject.
    checkRuns: async (sha) => {
      const out = [];
      let expected = null;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const body = await get(
          `/repos/${repo}/commits/${sha}/check-runs?per_page=${PER_PAGE}&page=${page}`,
        );
        expected = Number(body.total_count ?? 0);
        const batch = body.check_runs ?? [];
        out.push(...batch);
        if (out.length >= expected || batch.length === 0) break;
      }
      if (expected !== null && out.length < expected) {
        const e = new Error(
          `only ${out.length} of ${expected} check-run(s) could be paged in ${MAX_PAGES} page(s)`,
        );
        e.truncated = true;
        throw e;
      }
      return out;
    },
  };
}

/** The injection point. A JSON file stands in for every API answer, ONE ENTRY
 *  PER POLL, so a test can drive the timeout and the mid-poll force-push. There
 *  is deliberately no `fetch` in this object.
 *
 *  { repo, polls: [ { headSha, checkRuns, error, status } ], repeatLast } */
function fixtureApi(path) {
  const fx = JSON.parse(readFileSync(path, 'utf8'));
  let i = 0;
  let current = null;
  const next = () => {
    const polls = fx.polls ?? [];
    const p = i < polls.length ? polls[i] : fx.repeatLast ? polls[polls.length - 1] : null;
    i++;
    if (!p) throw new Error(`fixture ran out of polls after ${polls.length}`);
    if (p.error) {
      const e = new Error(p.error);
      e.status = p.status ?? 500;
      throw e;
    }
    return p;
  };
  return {
    live: false,
    repo: fx.repo,
    headSha: async () => {
      current = next();
      return current.headSha ?? null;
    },
    checkRuns: async () => current?.checkRuns ?? [],
  };
}

/** Same derivation as safe-rerun.mjs's private `repoFromGit`. Duplicated rather
 *  than imported because that one is not exported and this change does not own
 *  that file; exporting it there is the tidier end state. */
function repoFromGit() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
export function parseArgs(argv) {
  const args = {
    pr: null,
    repo: null,
    timeoutSeconds: 900,
    pollSeconds: 15,
    apps: [],
    anyApp: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') args.repo = argv[++i] ?? null;
    else if (a === '--timeout-seconds') args.timeoutSeconds = Number(argv[++i]);
    else if (a === '--poll-seconds') args.pollSeconds = Number(argv[++i]);
    else if (a === '--app') args.apps.push(String(argv[++i] ?? ''));
    else if (a === '--any-app') args.anyApp = true;
    else if (/^#?\d+$/.test(a)) args.pr = a.replace('#', '');
    else return { error: `unrecognised argument \`${a}\`` };
  }
  if (!args.pr) {
    return { error: 'no PR number given. Usage: await-pr-checks.mjs <prNumber> [--repo owner/name]' };
  }
  if (!Number.isFinite(args.timeoutSeconds) || args.timeoutSeconds <= 0) {
    return { error: '--timeout-seconds must be a positive number' };
  }
  if (!Number.isFinite(args.pollSeconds) || args.pollSeconds < 0) {
    return { error: '--poll-seconds must be zero or a positive number' };
  }
  if (args.anyApp && args.apps.length) {
    return { error: '--any-app and --app are contradictory; pass one or the other' };
  }
  args.requiredApps = args.anyApp ? null : new Set(args.apps.length ? args.apps : [ACTIONS_APP]);
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (sha) => String(sha ?? '').slice(0, 8);

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`✗ I COULD NOT TELL — ${args.error}`);
    return 2;
  }

  const fixture = process.env.AWAIT_PR_CHECKS_FIXTURE;
  let api;
  let repo;
  if (fixture) {
    if (!existsSync(fixture)) {
      console.error(
        `✗ I COULD NOT TELL — AWAIT_PR_CHECKS_FIXTURE points at ${fixture}, which does not exist.`,
      );
      return 2;
    }
    api = fixtureApi(fixture);
    repo = args.repo ?? api.repo ?? 'fixture/fixture';
    console.log(`⚠️  FIXTURE TRANSPORT — no network. Reading ${fixture}`);
  } else {
    repo = args.repo ?? (process.env.GITHUB_REPOSITORY?.trim() || repoFromGit());
    if (!repo) {
      console.error(
        '✗ I COULD NOT TELL — no repository. Pass --repo owner/name or set GITHUB_REPOSITORY.',
      );
      return 2;
    }
    const tok = token();
    if (!tok) {
      console.error(
        '✗ I COULD NOT TELL — no GitHub credential. Set GH_TOKEN/GITHUB_TOKEN, or make ' +
          '`Project_Cross_Platform_Apps_GITHUB_PAT` readable in the local vault. Exit 2, not a pass.',
      );
      return 2;
    }
    api = liveApi(repo, tok);
  }

  const scope = args.requiredApps === null ? 'any app' : [...args.requiredApps].join(', ');
  console.log(
    `waiting on PR #${args.pr} in ${repo} — grading check-runs from ${scope}, timeout ${args.timeoutSeconds}s`,
  );

  const deadline = Date.now() + args.timeoutSeconds * 1000;
  let last = { state: 'no-checks', headline: 'NO CHECKS REGISTERED', reason: 'no poll completed' };
  let sha = null;

  while (Date.now() < deadline) {
    let checks;
    try {
      // 🔴 RE-RESOLVED EVERY POLL. A force-push mid-poll otherwise settles this
      // against a stale commit — a green verdict for code nobody is merging.
      const seen = await api.headSha(args.pr);
      if (!seen) throw new Error('the PR reports no head SHA');
      if (sha && seen !== sha) {
        console.log(`  ⚠️  head moved ${short(sha)} → ${short(seen)} — regrading against the new commit`);
      }
      sha = seen;
      checks = await api.checkRuns(sha);
    } catch (e) {
      console.log(`  … could not read PR #${args.pr}: ${e.message} — retrying`);
      if (Date.now() + args.pollSeconds * 1000 >= deadline) break;
      await sleep(args.pollSeconds * 1000);
      continue;
    }

    last = classify(checks, args.requiredApps);
    console.log(`  … ${short(sha)}  ${last.headline}  [${tally(checks)}]`);

    if (last.code === 0) {
      console.log('');
      console.log(`ok  ALL CHECKS PASSED — ${last.reason}`);
      return 0;
    }
    if (last.code === 1) {
      console.error('');
      console.error(`✗ A CHECK FAILED — ${last.reason}`);
      console.error('  Decided, and the answer is no. Do not merge this head.');
      return 1;
    }

    if (Date.now() + args.pollSeconds * 1000 >= deadline) break;
    await sleep(args.pollSeconds * 1000);
  }

  console.error('');
  if (last.state === 'no-checks') {
    console.error(`✗ NO CHECKS REGISTERED — ${last.reason}`);
  } else {
    console.error(
      `✗ STILL PENDING AT TIMEOUT — after ${args.timeoutSeconds}s on ${short(sha)}: ${last.reason}`,
    );
  }
  console.error(
    '  I COULD NOT TELL. Exit 2 and not exit 0 on purpose: an unanswered poll is not a pass.',
  );
  return 2;
}

// Only when EXECUTED. A test importing `classify` must not fire a live API call
// as a side effect and silently set the suite's exit code.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
