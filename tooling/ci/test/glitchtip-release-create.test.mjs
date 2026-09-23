// ─────────────────────────────────────────────────────────────────────────────
// glitchtip-release-create.test.mjs — tooling/ops/create-glitchtip-release.mjs
// must survive ONE transient origin error, and must still FAIL on an answer.
//
// Row O-GLITCHTIP-CALLS-HAVE-NO-RETRY, 2026-09-23. [pipeline F-10] Every guard
// carries a recorded failing case.
//
// ── THE CASE THIS FILE EXISTS FOR ────────────────────────────────────────────
// deploy-web run 35831511489 (main f64cd921) went red on
//   `POST https://glitchtip.nikatru.com/api/0/organizations/nikatru/releases/ returned 522`
// — one blip from the origin, and the whole deploy of that app was lost. The
// first block drives `createRelease` through an INJECTED fetch, so no case here
// reaches a live GlitchTip and no case waits a real second. The second block
// SPAWNS the script against a local stub, once green and once refused, so the
// direct-run wiring (arguments, environment, exit code, what reaches the log)
// is proven too — not only the function.
//
// 🔴 What a green run of this file does NOT prove: that the live server treats
// a re-POST as idempotent. That was MEASURED once, live, by the parent session
// (quoted at the call site in the script), and is not re-measured by a test.
//
// Run:  node --single-threaded --test tooling/ci/test/glitchtip-release-create.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'create-glitchtip-release.mjs');
const { createRelease, releaseBody } = await import(`file://${SCRIPT.split('\\').join('/')}`);

const SERVER = 'https://glitchtip.example.com';
const ORG = 'nikatru';
const PROJECT = 'subscriptiontracker';
const RELEASE = 'subscriptiontracker@1.0.439+d90dbfc';
const URL_ = `${SERVER}/api/0/organizations/${ORG}/releases/`;
const STAMP = '2026-09-23T08:30:41.942Z';

const row = (over = {}) => ({ version: RELEASE, dateCreated: '2026-09-23T08:30:42.841Z', dateReleased: STAMP, ...over });
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain' } });
const e522 = () => text(522, 'error code: 522');

/** A fetch that answers from a script, one entry per call (the last repeats),
 *  and records every request it was given. Each entry is called with the
 *  request's init, so a case can answer, throw, or hang on the signal. */
const scripted = (answers) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return answers[Math.min(calls.length - 1, answers.length - 1)](init);
  };
  return { fetchImpl, calls };
};
const recorder = () => {
  const slept = [];
  return { slept, sleep: async (ms) => { slept.push(ms); } };
};
const create = (fetchImpl, sleep) =>
  createRelease({
    server: SERVER,
    token: 'stub-token',
    org: ORG,
    project: PROJECT,
    release: RELEASE,
    fetchImpl,
    sleep,
    note: () => {},
    now: () => new Date(STAMP),
  });

describe('create-glitchtip-release — a transient origin error is re-asked, an answer is not', () => {
  test('GREEN CONTROL — a 201 on the first attempt is one request and no wait', async () => {
    const { fetchImpl, calls } = scripted([() => json(201, row())]);
    const { slept, sleep } = recorder();
    const r = await create(fetchImpl, sleep);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.attempts, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(slept, []);
  });

  test('🔴 THE MEASURED FAILURE — a 522 then a 201 is GREEN on attempt 2, after the plan\'s 1 s', async () => {
    const { fetchImpl, calls } = scripted([e522, () => json(201, row())]);
    const { slept, sleep } = recorder();
    const r = await create(fetchImpl, sleep);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.attempts, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(slept, [1000]);
  });

  test('🔴 the re-sent request is BYTE-IDENTICAL to the first — the measured idempotent case', async () => {
    const { fetchImpl, calls } = scripted([e522, e522, () => json(201, row())]);
    let tick = 0;
    // A clock that MOVES on every read: a body rebuilt per attempt would differ.
    const now = () => new Date(Date.parse(STAMP) + 1000 * (tick += 1));
    const r = await createRelease({
      server: SERVER, token: 'stub-token', org: ORG, project: PROJECT, release: RELEASE,
      fetchImpl, sleep: recorder().sleep, note: () => {}, now,
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[1].init.body, calls[0].init.body, 'attempt 2 sent a different body from attempt 1');
    assert.equal(calls[2].init.body, calls[0].init.body, 'attempt 3 sent a different body from attempt 1');
  });

  test('the body is the CLI\'s: version, projects, and ONE stamp as both dateStarted and dateReleased', () => {
    const body = JSON.parse(releaseBody({ release: RELEASE, project: PROJECT, stamp: STAMP }));
    assert.deepEqual(Object.keys(body), ['version', 'projects', 'dateStarted', 'dateReleased']);
    assert.deepEqual(body, { version: RELEASE, projects: [PROJECT], dateStarted: STAMP, dateReleased: STAMP });
  });

  test('the request is a POST to the org\'s releases/ with a Bearer token and a signal', async () => {
    const { fetchImpl, calls } = scripted([() => json(201, row())]);
    await create(fetchImpl, recorder().sleep);
    assert.equal(calls[0].url, URL_);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.authorization, 'Bearer stub-token');
    assert.equal(calls[0].init.headers['content-type'], 'application/json');
    assert.ok(calls[0].init.signal instanceof AbortSignal, 'no signal: one silent socket would hold the job');
  });

  test('🔴 a 401 is FINAL on attempt 1 — a revoked token does not improve in two seconds', async () => {
    const { fetchImpl, calls } = scripted([() => json(401, { detail: 'Invalid token' }), () => json(201, row())]);
    const { slept, sleep } = recorder();
    const r = await create(fetchImpl, sleep);
    assert.equal(r.ok, false);
    assert.equal(calls.length, 1, 'a 401 was re-sent');
    assert.deepEqual(slept, []);
    assert.match(r.lines[0], /returned 401/);
  });

  test('🔴 a 522 that persists is still RED, after exactly 3 attempts and the 1 s + 2 s plan', async () => {
    const { fetchImpl, calls } = scripted([e522]);
    const { slept, sleep } = recorder();
    const r = await create(fetchImpl, sleep);
    assert.equal(r.ok, false);
    assert.equal(r.attempts, 3);
    assert.equal(calls.length, 3);
    assert.deepEqual(slept, [1000, 2000]);
    assert.match(r.lines[0], /HTTP 522/);
    assert.match(r.lines[0], /the same on all 3 attempt\(s\)/);
  });

  test('a dropped connection (`TypeError: fetch failed`) then a 201 is GREEN on attempt 2', async () => {
    const dropped = () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) });
    };
    const { fetchImpl, calls } = scripted([dropped, () => json(201, row())]);
    const r = await create(fetchImpl, recorder().sleep);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(calls.length, 2);
  });

  test('🔴 an origin that NEVER answers ends at the per-attempt ceiling, 3 times, and is RED', { timeout: 5000 }, async () => {
    const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const { fetchImpl, calls } = scripted([hang]);
    const before = process.env.OPS_REQUEST_TIMEOUT_MS;
    process.env.OPS_REQUEST_TIMEOUT_MS = '20';
    try {
      const r = await create(fetchImpl, recorder().sleep);
      assert.equal(r.ok, false);
      assert.equal(calls.length, 3);
      assert.match(r.lines[0], /all 3 attempt\(s\)/);
    } finally {
      if (before === undefined) delete process.env.OPS_REQUEST_TIMEOUT_MS;
      else process.env.OPS_REQUEST_TIMEOUT_MS = before;
    }
  });

  test('THE MEASURED IDEMPOTENCY — an EXISTING release answering 201 with its old row is GREEN', async () => {
    // The live answer, 2026-09-23: POST again → 201, the same dateCreated.
    const { fetchImpl } = scripted([() => json(201, row({ dateCreated: '2026-09-23T08:30:42.841Z' }))]);
    const r = await create(fetchImpl, recorder().sleep);
    assert.equal(r.ok, true);
    assert.equal(r.row.dateCreated, '2026-09-23T08:30:42.841Z');
  });

  test('🔴 a 2xx naming ANOTHER version is refused — the maps would sit under a release nobody reports', async () => {
    const { fetchImpl } = scripted([() => json(201, row({ version: 'subscriptiontracker@1.0.438+0000000' }))]);
    const r = await create(fetchImpl, recorder().sleep);
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /not "subscriptiontracker@1\.0\.439\+d90dbfc"/);
  });

  test('a 2xx carrying a non-JSON body is refused — an HTML page is not a release row', async () => {
    const { fetchImpl } = scripted([() => text(200, '<html>login</html>')]);
    const r = await create(fetchImpl, recorder().sleep);
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /non-JSON body/);
  });
});

// ── the direct run, against a local stub ─────────────────────────────────────
// spawnSync would block this loop, and the stub answers ON this loop.
const run = (args, env) =>
  new Promise((res) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: REPO,
      env: { ...process.env, SENTRY_URL: '', SENTRY_AUTH_TOKEN: '', ...env },
    });
    let all = '';
    child.stdout.on('data', (d) => { all += d; });
    child.stderr.on('data', (d) => { all += d; });
    child.on('close', (code) => res({ code, all }));
  });

const startStub = (statuses) =>
  new Promise((res) => {
    const seen = [];
    const server = createServer((req, out) => {
      const body = [];
      req.on('data', (d) => body.push(d));
      req.on('end', () => {
        seen.push({ method: req.method, path: req.url, auth: req.headers.authorization, body: Buffer.concat(body).toString('utf8') });
        const status = statuses[Math.min(seen.length - 1, statuses.length - 1)];
        if (status >= 500) {
          out.writeHead(status, { 'content-type': 'text/plain' });
          out.end(`error code: ${status}`);
          return;
        }
        out.writeHead(status, { 'content-type': 'application/json' });
        out.end(JSON.stringify(status < 300 ? { version: JSON.parse(seen.at(-1).body).version } : { detail: 'no' }));
      });
    });
    server.listen(0, '127.0.0.1', () =>
      res({
        origin: `http://127.0.0.1:${server.address().port}`,
        seen,
        close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }),
      }));
  });

const ARGS = ['--release', RELEASE, '--org', ORG, '--project', PROJECT];
const SECRET = 'stub-token-9f1c';

describe('create-glitchtip-release — the direct run', () => {
  test('🔴 a 522 from the stub, then a 201: exit 0, "on attempt 2", and the token never reaches the log', { timeout: 20000 }, async () => {
    const stub = await startStub([522, 201]);
    try {
      const r = await run(ARGS, { SENTRY_URL: stub.origin, SENTRY_AUTH_TOKEN: SECRET });
      assert.equal(r.code, 0, r.all);
      assert.equal(stub.seen.length, 2);
      assert.equal(stub.seen[0].path, `/api/0/organizations/${ORG}/releases/`);
      assert.equal(stub.seen[0].auth, `Bearer ${SECRET}`);
      assert.equal(stub.seen[1].body, stub.seen[0].body);
      assert.match(r.all, /ok {2}release "subscriptiontracker@1\.0\.439\+d90dbfc" created and finalized on 127\.0\.0\.1:\d+ \(HTTP 201 on attempt 2\)/);
      assert.match(r.all, /retry: attempt 1\/3 failed/);
      assert.equal(r.all.includes(SECRET), false, 'the token was printed');
    } finally {
      await stub.close();
    }
  });

  test('🔴 a 403 from the stub: exit 1 after ONE request, with the status in the ::error line', { timeout: 20000 }, async () => {
    const stub = await startStub([403]);
    try {
      const r = await run(ARGS, { SENTRY_URL: stub.origin, SENTRY_AUTH_TOKEN: SECRET });
      assert.equal(r.code, 1, r.all);
      assert.equal(stub.seen.length, 1);
      assert.match(r.all, /::error title=GlitchTip release::POST \S+ returned 403/);
    } finally {
      await stub.close();
    }
  });

  test('an empty SENTRY_AUTH_TOKEN fails BEFORE any request, naming the key', async () => {
    const r = await run(ARGS, { SENTRY_URL: 'https://glitchtip.invalid', SENTRY_AUTH_TOKEN: '' });
    assert.equal(r.code, 1);
    assert.match(r.all, /SENTRY_AUTH_TOKEN is empty/);
  });

  test('a SENTRY_URL carrying a path is refused, and is not echoed', async () => {
    const r = await run(ARGS, { SENTRY_URL: 'https://glitchtip.invalid/api/0', SENTRY_AUTH_TOKEN: SECRET });
    assert.equal(r.code, 1);
    assert.match(r.all, /must be a bare server origin/);
    assert.equal(r.all.includes('glitchtip.invalid/api/0'), false);
  });

  test('a flag given no value does not eat the next flag (TRAPS shell-13)', async () => {
    const r = await run(['--release', '--org', ORG, '--project', PROJECT], { SENTRY_URL: 'https://glitchtip.invalid', SENTRY_AUTH_TOKEN: SECRET });
    assert.equal(r.code, 1);
    assert.match(r.all, /--release needs a value/);
  });

  test('🔴 WIRED — the script CALLS the shared plan and states the idempotency measurement at the call', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    assert.match(src, /from '\.\/bounded-retry\.mjs'/);
    assert.match(src, /await fetchWithBoundedRetry\(/);
    assert.match(src, /VERDICT IDEMPOTENT \(2xx, one row, dates unchanged\)/);
  });
});
