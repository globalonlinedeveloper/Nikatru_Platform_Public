// ─────────────────────────────────────────────────────────────────────────────
// github-rate-limit.test.mjs — a GitHub rate limit is "could not ask", never
// "refused", in the deploy recorder AND in the deploy gate.
//
// 🔴 RUN 34570837376 (deploy-web on main, 68589a95): the gate passed, the Pages
// deploy succeeded, the post-deploy smoke passed, and record-deployment.mjs then
// went red on
//   POST deployments → 403 {"message": "API rate limit exceeded for installation. …"
// because it filed every 4xx as a REAL ANSWER. A successful deploy read as a
// failed deploy, and the Deployment record for that SHA is missing.
//
// The end-to-end cases drive the REAL scripts over their REAL transport against
// a loopback GitHub (GITHUB_API_URL, loopback-only — see `githubApiBase`), so
// what is proven is what the job does, not what a helper returns:
//   (a) 403 + x-ratelimit-remaining: 0, then 201      → waits for the reset, records, exit 0
//   (b) 429 + retry-after: 1, then 201                → waits what it says, records, exit 0
//   (c) rate-limited past the bound                   → exit 2, "the DEPLOY SUCCEEDED …"
//   (d) 403 "Resource not accessible by integration"  → exit 1 on the FIRST response
//   (e) gate: rate-limited, then a green ci-gate      → proceeds, exit 0
//   (f) gate: rate-limited past the bound             → exit 2, never 0
// plus the pure classification, the planner, the loopback seam, and the bound
// pinned against the workflow jobs that actually run the recorder.
//
// 🔴 ASYNC SPAWN, NEVER spawnSync. The fake API lives in THIS process; a
// synchronous child blocks the event loop that has to answer it, and the suite
// hangs instead of failing (the trap play-submission.test.mjs records).
//
// Run:  node --test tooling/ci/test/github-rate-limit.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyRefusal,
  planRateLimitWait,
  githubApiBase,
  GITHUB_API_ORIGIN,
  RATE_LIMIT_BUDGET_MS,
  RATE_LIMIT_MAX_RETRIES,
  SECONDARY_MIN_WAIT_MS,
  RESET_SKEW_MS,
} from '../record-deployment.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CI_DIR, '../..');
const RECORDER = join(CI_DIR, 'record-deployment.mjs');
const GATE = join(CI_DIR, 'assert-gate-passed.mjs');

const SHA = 'abc12345deadbeefabc12345deadbeefabc12345';
const REPO = 'x/y';
const DEPLOYMENTS = `POST /repos/${REPO}/deployments`;
const STATUSES = `POST /repos/${REPO}/deployments/42/statuses`;
const CHECK_RUNS = `GET /repos/${REPO}/commits/${SHA}/check-runs`;

/** Inherited CI variables would decide outcomes here (a real GITHUB_STEP_SUMMARY
 *  would even be written to), so every one the scripts read is cleared. */
const CLEARED = ['GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_API_URL', 'GITHUB_STEP_SUMMARY', 'GITHUB_OUTPUT'];
// ⏱ 2026-09-23 — and the run identity record-deployment.mjs writes into the
// Deployment payload: set in CI, absent on a laptop, so it is cleared here and
// every case that needs it passes it.
CLEARED.push('GITHUB_WORKFLOW_REF', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_RUN_NUMBER');
const cleanEnv = (env) => {
  const base = { ...process.env };
  for (const k of CLEARED) delete base[k];
  return { ...base, ...env };
};

/** A script still waiting after this long is a RED, not a hung suite: a mutation
 *  that retries a permission answer would otherwise sleep for minutes. */
const KILL_AFTER_MS = 30_000;

function runAsync(script, args, env, nodeArgs = []) {
  return new Promise((res) => {
    const p = spawn(process.execPath, [...nodeArgs, script, ...args], { env: cleanEnv(env) });
    let out = '';
    const timer = setTimeout(() => {
      out += `\n[test harness] killed after ${KILL_AFTER_MS} ms — the script was still waiting`;
      p.kill();
    }, KILL_AFTER_MS);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(timer); res({ code, out }); });
  });
}

/** A loopback GitHub. `script` maps "METHOD /path" to a queue of responses; the
 *  last response in a queue repeats. A response may be a function, so a reset
 *  header is computed when the request arrives rather than when the test starts. */
async function fakeGitHub(script) {
  const calls = [];
  const queues = new Map(Object.entries(script).map(([k, v]) => [k, [...v]]));
  const server = createServer((req, res) => {
    const key = `${req.method} ${new URL(req.url, 'http://127.0.0.1').pathname}`;
    req.resume();
    req.on('end', () => {
      // ⏱ 2026-09-14 — the QUERY is recorded and handed to a response function.
      // The key stays the pathname, so every case written before today is
      // unchanged; but a reader that must filter or page server-side can only be
      // graded on the query it sent, and until today this harness threw it away.
      const url = new URL(req.url, 'http://127.0.0.1');
      calls.push({ key, url: req.url, query: url.searchParams, at: Date.now(), auth: req.headers.authorization ?? '' });
      const q = queues.get(key);
      if (!q || q.length === 0) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: `no handler for ${key}` }));
        return;
      }
      const next = q.length > 1 ? q.shift() : q[0];
      const r = typeof next === 'function' ? next(url) : next;
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

const epoch = () => Math.floor(Date.now() / 1000);
/** GitHub's primary refusal: the message it actually sends, and the documented headers. */
const PRIMARY_BODY = { message: 'API rate limit exceeded for installation ID 1234567.', documentation_url: 'https://docs.github.com/rest/overview/rate-limits-for-the-rest-api' };
const primary = (secondsToReset, status = 403) => () => ({
  status,
  headers: {
    'x-ratelimit-limit': '5000',
    'x-ratelimit-remaining': '0',
    'x-ratelimit-used': '5000',
    'x-ratelimit-reset': String(epoch() + secondsToReset),
    'x-ratelimit-resource': 'core',
  },
  body: PRIMARY_BODY,
});
const NOT_ACCESSIBLE = { status: 403, headers: { 'x-ratelimit-remaining': '4990' }, body: { message: 'Resource not accessible by integration' } };
const CREATED = { status: 201, body: { id: 42 } };
const STATUS_OK = { status: 201, body: { id: 7, state: 'success' } };
const GREEN_GATE = { status: 200, body: { total_count: 1, check_runs: [{ name: 'ci-gate', status: 'completed', conclusion: 'success' }] } };

const count = (calls, key) => calls.filter((c) => c.key === key).length;
const gap = (calls, key) => {
  const at = calls.filter((c) => c.key === key).map((c) => c.at);
  return at[1] - at[0];
};

async function recordAgainst(script, env = {}) {
  const gh = await fakeGitHub(script);
  try {
    const r = await runAsync(RECORDER, ['platform', 'https://platform.nikatru.com'], {
      GITHUB_REPOSITORY: REPO, GITHUB_SHA: SHA, GH_TOKEN: 'ghs-test', GITHUB_API_URL: gh.origin, ...env,
    });
    return { ...r, calls: gh.calls };
  } finally {
    await gh.close();
  }
}

async function gateAgainst(script, extraArgs = []) {
  const gh = await fakeGitHub(script);
  try {
    const r = await runAsync(GATE, [SHA, ...extraArgs], { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'ghs-test', GITHUB_API_URL: gh.origin });
    return { ...r, calls: gh.calls };
  } finally {
    await gh.close();
  }
}

/** A crash is not a verdict. */
const noCrash = (out) => assert.doesNotMatch(out, /TypeError|ReferenceError|SyntaxError|node:internal/, out);

// ═════════════════════════════════════════════════════════════════════════════
describe('record-deployment — a rate limit is waited out, within the bound', () => {
  test('(a) 403 + x-ratelimit-remaining: 0, then 201 — waits for x-ratelimit-reset, records, exit 0', async () => {
    const r = await recordAgainst({ [DEPLOYMENTS]: [primary(1), CREATED], [STATUSES]: [STATUS_OK] });
    noCrash(r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}recorded platform live at abc12345/, r.out);
    assert.match(r.out, /installation rate limit \(x-ratelimit-remaining: 0, x-ratelimit-reset: \d+\)/, r.out);
    assert.equal(count(r.calls, DEPLOYMENTS), 2, r.out);
    assert.equal(count(r.calls, STATUSES), 1, r.out);
    // The wait was the RESET's, not the 500 ms transient backoff.
    assert.ok(gap(r.calls, DEPLOYMENTS) >= 900, `re-asked after ${gap(r.calls, DEPLOYMENTS)} ms — the reset was not honoured\n${r.out}`);
  });

  test('(b) 429 + retry-after: 1, then 201 — waits what GitHub says, records, exit 0', async () => {
    const r = await recordAgainst({
      [DEPLOYMENTS]: [{ status: 429, headers: { 'retry-after': '1' }, body: { message: 'You have exceeded a secondary rate limit.' } }, CREATED],
      [STATUSES]: [STATUS_OK],
    });
    noCrash(r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}recorded platform live at abc12345/, r.out);
    assert.match(r.out, /retry-after: 1/, r.out);
    assert.equal(count(r.calls, DEPLOYMENTS), 2, r.out);
    assert.ok(gap(r.calls, DEPLOYMENTS) >= 900, `re-asked after ${gap(r.calls, DEPLOYMENTS)} ms — retry-after was not honoured\n${r.out}`);
  });

  test('(c) rate-limited past the bound — non-zero, and it says the DEPLOY SUCCEEDED', async () => {
    // The reset is an hour away: the bound cannot outwait it, so it must not try.
    const r = await recordAgainst({ [DEPLOYMENTS]: [primary(3600)], [STATUSES]: [STATUS_OK] });
    noCrash(r.out);
    assert.equal(r.code, 2, r.out);
    const minutes = RATE_LIMIT_BUDGET_MS / 60_000;
    assert.match(
      r.out,
      new RegExp(`the DEPLOY SUCCEEDED; the GitHub Deployment record for ${SHA} could not be written because the installation rate limit did not reset within ${minutes} minutes`),
      r.out,
    );
    assert.match(r.out, /NOT a failed deploy/, r.out);
    assert.doesNotMatch(r.out, /ok {2}recorded/, r.out);
    assert.equal(count(r.calls, DEPLOYMENTS), 1, 'gave up at once rather than sleeping into the job timeout');
    assert.equal(count(r.calls, STATUSES), 0, r.out);
  });

  test('(c) …and when the limit lands on the STATUS write, it names the deployment that WAS created', async () => {
    const r = await recordAgainst({ [DEPLOYMENTS]: [CREATED], [STATUSES]: [primary(3600)] });
    noCrash(r.out);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /the DEPLOY SUCCEEDED; the GitHub Deployment record for abc12345/, r.out);
    assert.match(r.out, /Deployment 42 WAS created/, r.out);
  });

  // ⏱ 2026-09-23 — the recovery record is written by hand, outside the run, and
  // a submitted build is accepted only on a Deployment whose payload names its
  // run. So the hint prints the run's identity as the exact assignments to pass.
  test('(c) the recovery hint prints THIS run\'s identity, exactly as the recovery must pass it', async () => {
    const r = await recordAgainst(
      { [DEPLOYMENTS]: [primary(3600)], [STATUSES]: [STATUS_OK] },
      {
        GITHUB_WORKFLOW_REF: 'x/y/.github/workflows/submit-play.yml@refs/heads/main',
        GITHUB_RUN_ID: '35787897094',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_NUMBER: '5',
      },
    );
    noCrash(r.out);
    assert.equal(r.code, 2, r.out);
    assert.match(
      r.out,
      new RegExp(
        `Pass this run's identity too, exactly: GITHUB_SHA=${SHA} ` +
          'GITHUB_WORKFLOW_REF=x/y/\\.github/workflows/submit-play\\.yml@refs/heads/main GITHUB_RUN_ID=35787897094 ' +
          'GITHUB_RUN_ATTEMPT=1 GITHUB_RUN_NUMBER=5',
      ),
      r.out,
    );
  });

  test('(c) a rate-limited run with NO identity says its recovery record will name no run', async () => {
    const r = await recordAgainst({ [DEPLOYMENTS]: [primary(3600)], [STATUSES]: [STATUS_OK] });
    noCrash(r.out);
    assert.equal(r.code, 2, r.out);
    assert.match(
      r.out,
      /carried no readable identity \(GITHUB_WORKFLOW_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_RUN_NUMBER\), so the recovery record will carry no run payload/,
      r.out,
    );
  });

  test('(d) 403 "Resource not accessible by integration" — a permission ANSWER, exit 1 on the first response', async () => {
    const r = await recordAgainst({ [DEPLOYMENTS]: [NOT_ACCESSIBLE, CREATED], [STATUSES]: [STATUS_OK] });
    noCrash(r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /could not record the deployment: POST deployments → 403 .*Resource not accessible by integration/, r.out);
    assert.doesNotMatch(r.out, /DEPLOY SUCCEEDED|waiting/, r.out);
    assert.equal(count(r.calls, DEPLOYMENTS), 1, 'a permission answer was re-asked');
  });

  test('(d) 401 Bad credentials — an answer, exit 1, no retry', async () => {
    const r = await recordAgainst({ [DEPLOYMENTS]: [{ status: 401, body: { message: 'Bad credentials' } }, CREATED] });
    noCrash(r.out);
    assert.equal(r.code, 1, r.out);
    assert.equal(count(r.calls, DEPLOYMENTS), 1, r.out);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('assert-gate-passed — FAIL-CLOSED, and "could not read" is not "failed"', () => {
  test('(e) rate-limited, then a readable green ci-gate — proceeds, exit 0', async () => {
    const r = await gateAgainst({ [CHECK_RUNS]: [primary(1), GREEN_GATE] });
    noCrash(r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}ci-gate passed for abc12345/, r.out);
    assert.match(r.out, /installation rate limit/, r.out);
    assert.equal(count(r.calls, CHECK_RUNS), 2, r.out);
    assert.ok(gap(r.calls, CHECK_RUNS) >= 900, `re-asked after ${gap(r.calls, CHECK_RUNS)} ms\n${r.out}`);
  });

  test('(f) rate-limited past the bound — exit 2 with "could not read ci-gate", NEVER 0', async () => {
    const r = await gateAgainst({ [CHECK_RUNS]: [primary(3600)] });
    noCrash(r.out);
    assert.notEqual(r.code, 0, r.out);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /could not read ci-gate: installation rate limit/, r.out);
    assert.doesNotMatch(r.out, /ok {2}ci-gate passed|timed out after/, r.out);
    assert.equal(count(r.calls, CHECK_RUNS), 1, 'gave up at once rather than sleeping into the job timeout');
  });

  test('(f) the check\'s own timeout running out WHILE rate-limited is exit 2, not a "timed out" exit 1', async () => {
    const r = await gateAgainst({ [CHECK_RUNS]: [{ status: 429, headers: { 'retry-after': '1' }, body: { message: 'too many' } }] }, ['--timeout-seconds', '3']);
    noCrash(r.out);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /could not read ci-gate/, r.out);
    assert.doesNotMatch(r.out, /ok {2}ci-gate passed|timed out after/, r.out);
  });

  test('a 403 permission answer fails at once (exit 1) instead of polling out the deadline', async () => {
    const r = await gateAgainst({ [CHECK_RUNS]: [NOT_ACCESSIBLE, GREEN_GATE] });
    noCrash(r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /a permission answer, not a rate limit; refusing to deploy/, r.out);
    assert.equal(count(r.calls, CHECK_RUNS), 1, r.out);
  });

  test('a readable red ci-gate is still exit 1 — the answer "no" did not become "could not read"', async () => {
    const r = await gateAgainst({
      [CHECK_RUNS]: [primary(1), { status: 200, body: { check_runs: [{ name: 'ci-gate', status: 'completed', conclusion: 'failure' }] } }],
    });
    noCrash(r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ci-gate concluded "failure"/, r.out);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════════
// ⏱ 2026-09-14 · ci-gate IS NOT ON THE FIRST PAGE OF CHECK RUNS ANY MORE.
//
// 🔴 RUN 34841097649 — the SCHEDULED six-platform build on main, 8fef6b2c. Its
// gate step reported `timed out after 1200s waiting for "ci-gate" on 8fef6b2c
// (last seen: not started)` and the lane failed closed. ci-gate had PASSED on
// that exact SHA 7 hours earlier (check run, conclusion `success`, 04:59:20Z,
// from CI run 34738938178). Measured the same day, paging the live API by hand:
// the SHA carries 246 check runs and ci-gate is at index 25 OF PAGE 3.
// `fetchGate` asked for `?per_page=100` and read `body.check_runs` — page one of
// three — so the gate it was waiting for was never in the answer it read, and
// the script correctly reported what it saw: not started, eighty times.
//
// That is a CLASS bug with a growth trigger rather than a flake: it bites every
// self-gated lane (build-platforms, deploy-web, deploy-workers, extensions and
// the four submit-* lanes) on every SHA whose check-run count crossed 100, and
// it can only get worse as shards are added. `tooling/ops/await-pr-checks.mjs`
// already had the house answer at its `checkRuns` — page until `total_count` is
// accounted for, and throw loudly rather than silently short.
//
// THE TWO CASES BELOW ARE THE FIX'S WHOLE CONTRACT:
//   (g) the reader asks GitHub for the ONE check by name — `check_name=ci-gate`
//       — so a 246-check SHA costs one request, not three.
//   (h) and if that filter is ever ignored (a proxy, a seam, an API change) it
//       PAGES until it finds the gate rather than believing page one. This case
//       is the regression control: a server that answers the old unfiltered
//       shape makes the pre-2026-09-14 script report "not started" and exit 1.
// ─────────────────────────────────────────────────────────────────────────────
/** `n` check runs that are NOT the gate — the other 245 on a real main SHA. */
const filler = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    name: `shard-${from + i}`,
    status: 'completed',
    conclusion: 'success',
  }));
const GATE_RUN = { name: 'ci-gate', status: 'completed', conclusion: 'success' };

describe('assert-gate-passed — a gate past the first page of check runs is still READ', () => {
  test('(g) asks for the check BY NAME, so 246 check runs cost one request', async () => {
    // A server that HONOURS check_name, as GitHub documents it: only the match
    // comes back, and total_count counts the filtered set.
    const r = await gateAgainst({
      [CHECK_RUNS]: [
        (url) =>
          url.searchParams.get('check_name') === 'ci-gate'
            ? { status: 200, body: { total_count: 1, check_runs: [GATE_RUN] } }
            : { status: 200, body: { total_count: 246, check_runs: filler(100) } },
      ],
    });
    noCrash(r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}ci-gate passed for abc12345/, r.out);
    assert.equal(count(r.calls, CHECK_RUNS), 1, `spent ${count(r.calls, CHECK_RUNS)} request(s)\n${r.out}`);
    const q = r.calls.find((c) => c.key === CHECK_RUNS).query;
    assert.equal(q.get('check_name'), 'ci-gate', `the name filter was not sent: ${r.calls[0].url}`);
  });

  test('(h) REGRESSION CONTROL — a server that IGNORES the filter is paged, not believed', async () => {
    // The shape run 34841097649 actually met: 246 check runs, ci-gate on page 3.
    const pages = {
      1: { total_count: 246, check_runs: filler(100, 0) },
      2: { total_count: 246, check_runs: filler(100, 100) },
      3: { total_count: 246, check_runs: [...filler(45, 200), GATE_RUN] },
    };
    const r = await gateAgainst({
      [CHECK_RUNS]: [
        (url) => ({ status: 200, body: pages[Number(url.searchParams.get('page') ?? 1)] ?? { total_count: 246, check_runs: [] } }),
      ],
    });
    noCrash(r.out);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}ci-gate passed for abc12345/, r.out);
    assert.doesNotMatch(r.out, /timed out after|not started/, r.out);
    assert.equal(count(r.calls, CHECK_RUNS), 3, `paged in ${count(r.calls, CHECK_RUNS)} request(s)\n${r.out}`);
  });

  test('an absent gate on a 246-check SHA is still "not started" — paging did not invent one', async () => {
    const r = await gateAgainst(
      {
        [CHECK_RUNS]: [
          (url) => ({
            status: 200,
            body:
              Number(url.searchParams.get('page') ?? 1) <= 2
                ? { total_count: 246, check_runs: filler(100) }
                : { total_count: 246, check_runs: filler(46) },
          }),
        ],
      },
      ['--timeout-seconds', '1'],
    );
    noCrash(r.out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /timed out after 1s waiting for "ci-gate".*last seen: not started/s, r.out);
  });
});

// ⏱ 2026-09-11 · THE REQUESTS SPENT BEFORE ci-gate CAN EXIST.
//
// 🔴 A deploy lane starts at push time, beside CI, and ci-gate's check run is not
// created until every job it needs has finished. deploy-web's gate step polled
// every 15 s from the first second, and 19 of its 20 polls on 2026-09-11 answered
// "no ci-gate check on this commit yet" — 20-24 requests per lane, per push, on
// the one installation quota every CI run also spends.
//
// These cases run the REAL gate under a VIRTUAL CLOCK. A preload replaces `fetch`
// with a check-run list scripted on elapsed seconds, and makes `setTimeout`
// advance the clock instead of waiting, so a twenty-minute watch finishes in
// milliseconds and every request is recorded with the second it was made. The
// gate has no test mode of its own; what runs here is the script CI runs.
// ─────────────────────────────────────────────────────────────────────────────
function clockStub(writeFileSync) {
  const S = JSON.parse(process.env.GATE_CLOCK_SCRIPT);
  const T0 = Date.parse('2026-09-11T08:00:00Z');
  let now = T0;
  Date.now = () => now;
  const immediate = setImmediate;
  globalThis.setTimeout = (fn, ms = 0, ...args) => {
    now += Math.max(0, Number(ms) || 0);
    immediate(() => fn(...args));
    return 0;
  };
  const at = [];
  process.on('exit', () => writeFileSync(process.env.GATE_CLOCK_OUT, JSON.stringify({ at, end: (now - T0) / 1000 })));
  globalThis.fetch = async () => {
    const t = (now - T0) / 1000;
    at.push(t);
    const exists = S.appearsAt !== null && t >= S.appearsAt;
    const done = exists && S.completesAt !== null && t >= S.completesAt;
    const runs = exists ? [{ name: 'ci-gate', status: done ? 'completed' : 'in_progress', conclusion: done ? S.conclusion : null }] : [];
    return new Response(JSON.stringify({ total_count: runs.length, check_runs: runs }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

describe('assert-gate-passed — no request is spent faster than ci-gate can appear', () => {
  let dir;
  let stubHref;
  let n = 0;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'nikatru-gate-clock-'));
    const p = join(dir, 'clock-stub.mjs');
    writeFileSync(p, `import { writeFileSync } from 'node:fs';\n(${clockStub.toString()})(writeFileSync);\n`);
    stubHref = pathToFileURL(p).href;
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  /** `appearsAt` / `completesAt` are seconds after the gate starts; null = never. */
  const onClock = async ({ appearsAt, completesAt, conclusion = 'success' }, extraArgs = []) => {
    const out = join(dir, `clock-${n++}.json`);
    const r = await runAsync(
      GATE,
      [SHA, ...extraArgs],
      { GITHUB_REPOSITORY: REPO, GITHUB_TOKEN: 'ghs-test', GATE_CLOCK_SCRIPT: JSON.stringify({ appearsAt, completesAt, conclusion }), GATE_CLOCK_OUT: out },
      ['--import', stubHref],
    );
    const clock = JSON.parse(readFileSync(out, 'utf8'));
    return { ...r, ...clock, trace: `requests at t=${clock.at.join(', ')} s; ended at ${clock.end} s\n${r.out}` };
  };

  test('a push-time deploy — ci-gate appears at 290 s and passes at 320 s — proceeds on at most 9 requests (15-second polling made 23)', async () => {
    const r = await onClock({ appearsAt: 290, completesAt: 320 });
    noCrash(r.out);
    assert.equal(r.code, 0, r.trace);
    assert.match(r.out, /ok {2}ci-gate passed for abc12345/, r.trace);
    assert.ok(r.at.length <= 9, `${r.at.length} requests — the absent-check back-off is not in effect\n${r.trace}`);
    // The back-off may slow the watch, never blind it: no gap is longer than a minute.
    const gaps = r.at.slice(1).map((t, i) => t - r.at[i]);
    assert.ok(Math.max(...gaps) <= 60, `a ${Math.max(...gaps)} s gap between polls\n${r.trace}`);
  });

  test('the redeploy button — ci-gate already green — is answered by the FIRST request, with no wait before it', async () => {
    const r = await onClock({ appearsAt: 0, completesAt: 0 });
    noCrash(r.out);
    assert.equal(r.code, 0, r.trace);
    assert.deepEqual(r.at, [0], r.trace);
  });

  test('once ci-gate exists it is polled every 15 s again — the back-off applies only while there is nothing to see', async () => {
    const r = await onClock({ appearsAt: 40, completesAt: 100 });
    noCrash(r.out);
    assert.equal(r.code, 0, r.trace);
    const seen = r.at.findIndex((t) => t >= 40);
    assert.ok(seen > 0, r.trace);
    const after = r.at.slice(seen);
    assert.ok(after.slice(1).every((t, i) => t - after[i] === 15), `polls after ci-gate appeared are not 15 s apart\n${r.trace}`);
  });

  test('ci-gate never appears — exit 1 "timed out" AT the timeout, never after it, still looking in its last minute', async () => {
    const r = await onClock({ appearsAt: null, completesAt: null });
    noCrash(r.out);
    assert.equal(r.code, 1, r.trace);
    assert.match(r.out, /timed out after 1200s waiting for "ci-gate" on abc12345 \(last seen: not started\)/, r.trace);
    assert.ok(r.end <= 1200, `the watch ran ${r.end} s against a 1200 s timeout\n${r.trace}`);
    assert.ok(r.at[r.at.length - 1] >= 1185, `the last look was at ${r.at[r.at.length - 1]} s — the back-off shortened the watch\n${r.trace}`);
    assert.ok(r.at.length <= 25, `${r.at.length} requests for a ci-gate that never came (15-second polling made 80)\n${r.trace}`);
  });

  test('a short --timeout-seconds is honoured to the second — the clamp, not the back-off step, ends the watch', async () => {
    const r = await onClock({ appearsAt: null, completesAt: null }, ['--timeout-seconds', '100']);
    noCrash(r.out);
    assert.equal(r.code, 1, r.trace);
    assert.ok(r.end <= 100, r.trace);
    assert.equal(r.at[r.at.length - 1], 100, `the final look must land on the deadline\n${r.trace}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('classifyRefusal — a signal, never a bare 403', () => {
  const NOW = 1_800_000_000_000;

  test('403 + x-ratelimit-remaining: 0 waits until x-ratelimit-reset, plus the clock skew', () => {
    const r = classifyRefusal({ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 120) }, bodyText: JSON.stringify(PRIMARY_BODY), now: NOW });
    assert.deepEqual([r.kind, r.limit, r.waitMs], ['rate-limit', 'primary', 120_000 + RESET_SKEW_MS]);
  });

  test('retry-after is read FIRST, as GitHub documents', () => {
    const r = classifyRefusal({ status: 403, headers: { 'retry-after': '30', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 3000) }, now: NOW });
    assert.deepEqual([r.kind, r.waitMs], ['rate-limit', 30_000]);
  });

  test('a fetch Headers object reads the same as a plain object, case-insensitively', () => {
    const r = classifyRefusal({ status: 429, headers: new Headers({ 'Retry-After': '5' }), now: NOW });
    assert.deepEqual([r.kind, r.waitMs], ['rate-limit', 5_000]);
  });

  test('a secondary-limit message with no wait header: one minute, then exponentially longer', () => {
    const body = JSON.stringify({ message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' });
    const first = classifyRefusal({ status: 403, bodyText: body, now: NOW, secondaryStrikes: 0 });
    const second = classifyRefusal({ status: 403, bodyText: body, now: NOW, secondaryStrikes: 1 });
    assert.deepEqual([first.kind, first.limit, first.waitMs], ['rate-limit', 'secondary', SECONDARY_MIN_WAIT_MS]);
    assert.equal(second.waitMs, 2 * SECONDARY_MIN_WAIT_MS);
  });

  test('the primary refusal\'s own words are a rate limit even when the headers were lost', () => {
    const r = classifyRefusal({ status: 403, bodyText: JSON.stringify(PRIMARY_BODY), now: NOW });
    assert.deepEqual([r.kind, r.limit, r.waitMs], ['rate-limit', 'primary', SECONDARY_MIN_WAIT_MS]);
  });

  test('a bare 429 is a rate limit by definition, with the documented one-minute floor', () => {
    const r = classifyRefusal({ status: 429, now: NOW });
    assert.deepEqual([r.kind, r.waitMs], ['rate-limit', SECONDARY_MIN_WAIT_MS]);
  });

  test('401, and a 403 with no rate-limit signal, are ANSWERS', () => {
    for (const [status, message, headers] of [
      [401, 'Bad credentials', {}],
      [403, 'Resource not accessible by integration', { 'x-ratelimit-remaining': '4990' }],
      [403, 'Must have admin rights to Repository.', {}],
      [403, '', null],
    ]) {
      assert.equal(classifyRefusal({ status, headers, bodyText: JSON.stringify({ message }), now: NOW }).kind, 'answer', `${status} ${message}`);
    }
  });

  test('other 4xx are answers, 5xx transient, and a non-number is not a rate limit', () => {
    for (const status of [400, 404, 409, 422]) assert.equal(classifyRefusal({ status }).kind, 'answer', String(status));
    for (const status of [500, 502, 503]) assert.equal(classifyRefusal({ status }).kind, 'transient', String(status));
    for (const status of [undefined, null, '403']) assert.equal(classifyRefusal({ status }).kind, 'answer', String(status));
  });
});

describe('planRateLimitWait — bounded, and gives up at once when the wait cannot fit', () => {
  const refusal = (waitMs) => ({ kind: 'rate-limit', limit: 'primary', waitMs, signal: 'test' });

  test('a wait inside the bound is taken', () => {
    assert.deepEqual(planRateLimitWait({ refusal: refusal(5_000), now: 0, deadline: 60_000, retriesSoFar: 0 }), { giveUp: false, waitMs: 5_000 });
  });

  test('a wait past the bound gives up NOW rather than sleeping into the job timeout', () => {
    const p = planRateLimitWait({ refusal: refusal(3_600_000), now: 0, deadline: RATE_LIMIT_BUDGET_MS, retriesSoFar: 0 });
    assert.equal(p.giveUp, true);
    assert.match(p.why, /60 min away/);
  });

  test('the number of rate-limit retries is capped too', () => {
    const p = planRateLimitWait({ refusal: refusal(1_000), now: 0, deadline: RATE_LIMIT_BUDGET_MS, retriesSoFar: RATE_LIMIT_MAX_RETRIES });
    assert.equal(p.giveUp, true);
  });
});

describe('githubApiBase — the real origin or loopback, nothing else', () => {
  test('unset and the value GitHub Actions sets both mean the real API', () => {
    assert.deepEqual(githubApiBase({}), { base: GITHUB_API_ORIGIN, override: false });
    assert.deepEqual(githubApiBase({ GITHUB_API_URL: 'https://api.github.com/' }), { base: GITHUB_API_ORIGIN, override: false });
  });

  test('loopback is a test seam', () => {
    assert.deepEqual(githubApiBase({ GITHUB_API_URL: 'http://127.0.0.1:4010' }), { base: 'http://127.0.0.1:4010', override: true });
  });

  test('any other host is REFUSED — it would receive the job token', () => {
    for (const v of ['https://evil.example.com', 'http://10.0.0.5', 'https://127.0.0.1:4010', 'not a url']) {
      assert.ok(githubApiBase({ GITHUB_API_URL: v }).error, v);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 🔴 THE BOUND IS A MEASUREMENT AGAINST THE JOBS, SO THE JOBS ARE READ, NOT
// REMEMBERED. A recording job whose timeout-minutes shrinks below the bound
// would be killed mid-wait and read "cancelled" — worse than the red this
// change removes.
describe('the rate-limit bound fits every job that records a deployment', () => {
  test('each job invoking record-deployment.mjs keeps >= 3 minutes beside RATE_LIMIT_BUDGET_MS', () => {
    const dir = join(ROOT, '.github', 'workflows');
    const found = [];
    for (const f of readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
      let job = null;
      const timeouts = new Map();
      const callers = new Set();
      for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
        if (/^\s*#/.test(line)) continue;
        const j = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
        if (j) { job = j[1]; continue; }
        const t = line.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/);
        if (t && job) timeouts.set(job, Number(t[1]));
        if (job && /node\s+\S*record-deployment\.mjs/.test(line)) callers.add(job);
      }
      for (const j of callers) found.push({ where: `${f} → ${j}`, minutes: timeouts.get(j) ?? null });
    }
    assert.ok(found.length >= 1, 'no workflow job invokes record-deployment.mjs — this bound was checked against nothing');
    for (const { where, minutes } of found) {
      assert.ok(Number.isInteger(minutes), `${where} has no job-level timeout-minutes`);
      assert.ok(
        minutes * 60_000 - RATE_LIMIT_BUDGET_MS >= 3 * 60_000,
        `${where}: timeout-minutes ${minutes} leaves under 3 minutes beside a ${RATE_LIMIT_BUDGET_MS / 60_000}-minute rate-limit bound`,
      );
    }
  });
});
