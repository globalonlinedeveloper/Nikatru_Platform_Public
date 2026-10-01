// ─────────────────────────────────────────────────────────────────────────────
// e2e-purge-retry.test.mjs — the E2E/proof purge survives a dropped connection,
// and still fails, naming what it could not purge, when the drop is an outage.
//
// Measured 2026-09-30 (native-auth-proof run 36739638735, main 0008ed54): all
// five targets PROVED sign-in, then the Windows leg's purge died after
// "purged budgets: 0 row(s)" on `TypeError: fetch failed [cause]: SocketError:
// other side closed`, uncaught, and the leg went red. So:
//
//   · tooling/e2e/purge_requests.mjs is IMPORTED and driven through a fake
//     transport that closes the socket exactly the way undici does;
//   · purge.mjs itself is SPAWNED with `fetch` replaced by a preload, so the
//     exit code the workflow reads is the thing asserted, not a helper's return;
//   · purge.mjs's source is held to "no request of its own".
//
// No case touches a network. E2E_PURGE_RETRY_BASE_MS=0 and an injected `sleep`
// keep the backoff out of the wall clock.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { purgeClient, purgeUserTables, purgeAuthUser, purgeRetryBaseMs } from '../../e2e/purge_requests.mjs';
import { RETRY_BASE_MS, READ_ATTEMPTS } from '../../ops/bounded-retry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STEP = join(REPO, 'tooling', 'e2e', 'purge.mjs');
const TABLES = ['payment_history', 'subscriptions', 'budget_categories', 'budgets'];

/** Exactly what undici throws when the peer closes the socket. */
function socketClosed() {
  const cause = Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
  return new TypeError('fetch failed', { cause });
}

const d1Ok = () => new Response(JSON.stringify({ success: true, result: [{ meta: { changes: 1 } }] }), { status: 200 });

/** A recording fake transport. `answer(call)` returns a Response or throws. */
function transport(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { url, init, body: init.body ? JSON.parse(init.body) : null, n: calls.length + 1 };
    calls.push(call);
    return answer(call, calls);
  };
  return { calls, fetchImpl };
}

function client(fetchImpl) {
  return purgeClient({
    acct: 'acct',
    token: 'tok',
    supaUrl: 'https://auth.example.invalid',
    serviceKey: 'svc',
    fetchImpl,
    sleep: async () => {},
    note: () => {},
    env: {},
  });
}

function capture() {
  const out = [];
  const err = [];
  return { out, err, log: (l) => out.push(l), warn: (l) => err.push(l) };
}

describe('a closed socket is asked again, and the purge completes', () => {
  test('🔴 the D1 delete for ONE table closes once, then answers — every table is purged', async () => {
    let closed = false;
    const t = transport((call) => {
      if (!closed && call.body.sql.includes('FROM budgets ')) {
        closed = true;
        throw socketClosed();
      }
      return d1Ok();
    });
    const io = capture();
    const failures = await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: TABLES, userId: 'u1', ...io });
    assert.equal(failures, 0, io.err.join('\n'));
    assert.equal(t.calls.length, TABLES.length + 1, 'the closed request is sent exactly once more');
    assert.deepEqual(io.out, TABLES.map((x) => `purged ${x}: 1 row(s)`));
  });

  test('🔴 the incident: the identity DELETE closes once, then answers 200', async () => {
    const t = transport((call) => {
      if (call.n === 1) throw socketClosed();
      return new Response('{}', { status: 200 });
    });
    const io = capture();
    assert.equal(await purgeAuthUser(client(t.fetchImpl), 'u1', io), 0, io.err.join('\n'));
    assert.equal(t.calls.length, 2);
    assert.equal(t.calls[1].init.method, 'DELETE');
    assert.deepEqual(io.out, ['auth user delete: HTTP 200']);
  });

  test('a connection that closes MID-BODY is retried like one that closed before the headers', async () => {
    const t = transport((call) =>
      call.n === 1
        ? { status: 200, ok: true, headers: new Headers(), text: async () => { throw new TypeError('terminated'); } }
        : d1Ok(),
    );
    const io = capture();
    assert.equal(await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: ['budgets'], userId: 'u1', ...io }), 0);
    assert.equal(t.calls.length, 2);
  });

  test('HTTP 503 and HTTP 429 are "not now", and are asked again', async () => {
    for (const status of [503, 429]) {
      const t = transport((call) => (call.n === 1 ? new Response('busy', { status }) : d1Ok()));
      const io = capture();
      assert.equal(await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: ['budgets'], userId: 'u1', ...io }), 0, `HTTP ${status}`);
      assert.equal(t.calls.length, 2, `HTTP ${status} is retried once`);
    }
  });
});

describe('an outage is still a failure, naming what was not purged', () => {
  test('🔴 every request closes: each table fails BY NAME, after the whole plan and no more', async () => {
    const t = transport(() => {
      throw socketClosed();
    });
    const io = capture();
    const failures = await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: TABLES, userId: 'u1', ...io });
    assert.equal(failures, TABLES.length);
    assert.equal(t.calls.length, TABLES.length * READ_ATTEMPTS, 'bounded: READ_ATTEMPTS per table, never more');
    for (const [i, table] of TABLES.entries()) {
      assert.match(io.err[i], new RegExp(`^WARN: failed to purge ${table}: purge ${table}: the request did not answer`));
      assert.match(io.err[i], new RegExp(`all ${READ_ATTEMPTS} attempt\\(s\\)`));
    }
  });

  test('every request closes: the identity delete fails, and says so, without throwing', async () => {
    const t = transport(() => {
      throw socketClosed();
    });
    const io = capture();
    assert.equal(await purgeAuthUser(client(t.fetchImpl), 'u1', io), 1);
    assert.equal(t.calls.length, READ_ATTEMPTS);
    assert.match(io.err[0], /^WARN: failed to delete the auth user u1: auth user delete: the request did not answer/);
  });

  test('a 4xx is an ANSWER: failed on first sight, never re-sent', async () => {
    const t = transport(() => new Response(JSON.stringify({ success: false, errors: [{ message: 'no such table' }] }), { status: 400 }));
    const io = capture();
    assert.equal(await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: ['budgets'], userId: 'u1', ...io }), 1);
    assert.equal(t.calls.length, 1);
    assert.match(io.err[0], /^WARN: failed to purge budgets: HTTP 400 .*no such table/);

    const a = transport(() => new Response('bad token', { status: 401 }));
    const aio = capture();
    assert.equal(await purgeAuthUser(client(a.fetchImpl), 'u1', aio), 1);
    assert.equal(a.calls.length, 1);
    assert.match(aio.err[0], /user delete returned 401/);
  });

  test('a table name that is not a plain identifier is refused, and no DELETE is sent for it', async () => {
    const t = transport(() => d1Ok());
    const io = capture();
    const failures = await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: ['budgets', 'x; DROP TABLE y'], userId: 'u1', ...io });
    assert.equal(failures, 1);
    assert.equal(t.calls.length, 1, 'only the plain table was sent');
    assert.match(io.err[0], /refused to purge "x; DROP TABLE y"/);
  });

  test('a 404 identity is the already-gone success path, and is not re-sent', async () => {
    const t = transport(() => new Response('', { status: 404 }));
    const io = capture();
    assert.equal(await purgeAuthUser(client(t.fetchImpl), 'u1', io), 0);
    assert.equal(t.calls.length, 1);
    assert.match(io.out[0], /HTTP 404 — the identity was already gone/);
  });
});

describe('every request carries a per-request ceiling', () => {
  test('each attempt hands its fetch an AbortSignal', async () => {
    const t = transport(() => d1Ok());
    await purgeUserTables(client(t.fetchImpl), { dbId: 'db', userTables: ['budgets'], userId: 'u1', ...capture() });
    await purgeAuthUser(client(transport(() => new Response('{}')).fetchImpl), 'u1', capture());
    assert.ok(t.calls[0].init.signal instanceof AbortSignal);
  });

  test('🔴 a request that never answers ends at the ceiling, is retried, and then fails', async () => {
    const saved = process.env.OPS_REQUEST_TIMEOUT_MS;
    process.env.OPS_REQUEST_TIMEOUT_MS = '20';
    try {
      const t = transport(
        (call) =>
          new Promise((_, reject) => call.init.signal.addEventListener('abort', () => reject(call.init.signal.reason), { once: true })),
      );
      const io = capture();
      assert.equal(await purgeAuthUser(client(t.fetchImpl), 'u1', io), 1);
      assert.equal(t.calls.length, READ_ATTEMPTS);
      assert.match(io.err[0], /failed to delete the auth user u1/);
    } finally {
      if (saved === undefined) delete process.env.OPS_REQUEST_TIMEOUT_MS;
      else process.env.OPS_REQUEST_TIMEOUT_MS = saved;
    }
  });

  test('E2E_PURGE_RETRY_BASE_MS may only SHORTEN the backoff', () => {
    assert.equal(purgeRetryBaseMs({}), RETRY_BASE_MS);
    assert.equal(purgeRetryBaseMs({ E2E_PURGE_RETRY_BASE_MS: '0' }), 0);
    assert.equal(purgeRetryBaseMs({ E2E_PURGE_RETRY_BASE_MS: '60000' }), RETRY_BASE_MS);
    assert.equal(purgeRetryBaseMs({ E2E_PURGE_RETRY_BASE_MS: 'soon' }), RETRY_BASE_MS);
  });
});

describe('purge.mjs, spawned: the exit code the workflow reads', () => {
  let dir;
  let preload;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-purge-retry-'));
    preload = join(dir, 'fake-fetch.mjs');
    // FAKE_FETCH=close-first: every distinct request closes on its first send.
    // FAKE_FETCH=close-always: every send closes.
    writeFileSync(
      preload,
      `const seen = new Set();
globalThis.__fakeCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  globalThis.__fakeCalls++;
  const key = String(url) + ' ' + (init.body ?? '');
  if (process.env.FAKE_FETCH === 'close-always' || !seen.has(key)) {
    seen.add(key);
    const cause = Object.assign(new Error('other side closed'), { name: 'SocketError', code: 'UND_ERR_SOCKET' });
    throw new TypeError('fetch failed', { cause });
  }
  if (String(url).includes('/auth/v1/admin/users/')) return new Response('{}', { status: 200 });
  return new Response(JSON.stringify({ success: true, result: [{ meta: { changes: 1 } }] }), { status: 200 });
};
`,
    );
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  function run(mode) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !/^(E2E_|PLATFORM_|CLOUDFLARE_|SUPABASE_|OPS_)/.test(k)),
    );
    Object.assign(env, {
      FAKE_FETCH: mode,
      E2E_PURGE_RETRY_BASE_MS: '0',
      E2E_USER_ID: '00000000-0000-4000-8000-000000000001',
      E2E_APP_ID: 'subscriptiontracker',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_API_TOKEN: 'tok',
      SUPABASE_URL: 'http://127.0.0.1:9', // loopback: the origin credential-origin.mjs admits; FAKE_FETCH answers
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
    });
    return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, STEP], {
      cwd: REPO,
      env,
      encoding: 'utf8',
      timeout: 60_000,
    });
  }

  test('🔴 every request closes once: the purge completes and exits 0', () => {
    const r = run('close-first');
    assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    for (const table of TABLES) assert.match(r.stdout, new RegExp(`purged ${table}: 1 row\\(s\\)`));
    assert.match(r.stdout, /auth user delete: HTTP 200/);
    assert.match(r.stdout, /Purge complete\./);
    assert.doesNotMatch(r.stderr, /WARN/);
  });

  test('🔴 every request closes every time: exit 1, naming each table and the identity', () => {
    const r = run('close-always');
    assert.equal(r.status, 1, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    for (const table of TABLES) assert.match(r.stderr, new RegExp(`WARN: failed to purge ${table}: `));
    assert.match(r.stderr, /WARN: failed to delete the auth user /);
    assert.match(r.stderr, /Purge finished with warnings/);
    assert.doesNotMatch(r.stderr, /Uncaught|at .*purge\.mjs:\d+/, 'no exception escapes');
  });
});

test('purge.mjs makes no request of its own — every one goes through purge_requests.mjs', () => {
  const src = readFileSync(STEP, 'utf8');
  assert.match(src, /from '\.\/purge_requests\.mjs'/);
  assert.doesNotMatch(src, /\bfetch\s*\(/, 'a bare fetch in purge.mjs is un-retried and un-ceilinged');
  const helper = readFileSync(join(REPO, 'tooling', 'e2e', 'purge_requests.mjs'), 'utf8');
  assert.match(helper, /from '\.\.\/ops\/bounded-retry\.mjs'/);
});
