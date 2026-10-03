// ─────────────────────────────────────────────────────────────────────────────
// e2e-provision-leak.test.mjs — a throwaway E2E user whose magic-link mint fails
// is still handed to the always() purge, an edge 5xx on the mint is asked once
// more, and the stale sweep can reach only the provisioner's own addresses.
//
// Measured 2026-10-03: E2E run 37076032926 (job 111066194562) died at "Provision
// the throwaway user the delete leg destroys" on `generate_link failed: HTTP 520`
// (a Cloudflare "Web server is returning an unknown error" page for
// auth-api.nikatru.com). provision_user.mjs wrote `user_id=` only after the
// mint, so both always() purges got an empty E2E_USER_ID and the user stayed in
// production auth; run 37081275953 left a second one the same way.
//
//   · tooling/e2e/magic_link.mjs is IMPORTED and driven through a fake transport;
//   · tooling/e2e/provision_user.mjs is SPAWNED against a loopback GoTrue, so the
//     $GITHUB_OUTPUT file the workflow reads is the thing asserted;
//   · tooling/e2e/purge_stale.mjs's selection and sweep are IMPORTED.
// No case touches a network beyond 127.0.0.1.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { mintMagicLinkTokenHash, MagicLinkRefused, EDGE_RETRY_STATUSES, RETRY_GAP_MS } from '../../e2e/magic_link.mjs';
import { E2E_EMAIL_SHAPE, e2eEmail, e2eEmailTagMs } from '../../e2e/e2e_email.mjs';
import { selectStale, sweepStale, STALE_AFTER_MS, SWEEP_CAP, LIST_PER_PAGE, LIST_MAX_PAGES } from '../../e2e/purge_stale.mjs';
import { purgeClient } from '../../e2e/purge_requests.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PROVISION = join(REPO, 'tooling', 'e2e', 'provision_user.mjs');
const HEX56 = 'a1'.repeat(28);
const UUID_A = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const AUTH = 'https://auth-api.nikatru.com';
// The verbatim body run 37076032926 printed, abridged.
const CF_520 = '<!DOCTYPE html><title>auth-api.nikatru.com | 520: Web server is returning an unknown error</title>';

/** A fake transport answering with `statuses` in order (the last repeats). */
function answers(...statuses) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    const ok = status >= 200 && status < 300;
    return { ok, status, json: async () => ({ hashed_token: HEX56 }), text: async () => (ok ? '' : status === 520 ? CF_520 : '{"msg":"no"}') };
  };
  return { f, calls };
}

function sleeper() {
  const slept = [];
  return { slept, sleep: async (ms) => void slept.push(ms) };
}

describe('magic_link: one bounded retry on an edge 5xx, and only there', () => {
  test('🔴 the incident: 520 then 200 — the mint succeeds after ONE gap of RETRY_GAP_MS', async () => {
    const { f, calls } = answers(520, 200);
    const s = sleeper();
    assert.equal(await mintMagicLinkTokenHash({ url: AUTH, serviceKey: 'k', email: 'e', fetchImpl: f, sleep: s.sleep }), HEX56);
    assert.equal(calls.length, 2);
    assert.deepEqual(s.slept, [RETRY_GAP_MS]);
    assert.ok(RETRY_GAP_MS >= 4_000 && RETRY_GAP_MS <= 6_000, `the gap is ~5 s, got ${RETRY_GAP_MS}`);
  });

  test('🔴 520 twice — fails naming BOTH statuses, after exactly two requests', async () => {
    const { f, calls } = answers(520, 520, 200);
    const s = sleeper();
    await assert.rejects(
      mintMagicLinkTokenHash({ url: AUTH, serviceKey: 'k', email: 'e', fetchImpl: f, sleep: s.sleep }),
      (e) => e instanceof MagicLinkRefused && /generate_link failed: HTTP 520, then HTTP 520 on the one retry/.test(e.message),
    );
    assert.equal(calls.length, 2, 'retried more than once');
  });

  test('every edge status is retried once; a different second failure is named too', async () => {
    for (const status of EDGE_RETRY_STATUSES) {
      const ok = answers(status, 200);
      assert.equal(await mintMagicLinkTokenHash({ url: AUTH, serviceKey: 'k', email: 'e', fetchImpl: ok.f, sleep: async () => {} }), HEX56);
      assert.equal(ok.calls.length, 2, `HTTP ${status}`);
    }
    const { f } = answers(503, 401);
    await assert.rejects(
      mintMagicLinkTokenHash({ url: AUTH, serviceKey: 'k', email: 'e', fetchImpl: f, sleep: async () => {} }),
      (e) => e instanceof MagicLinkRefused && /HTTP 503, then HTTP 401/.test(e.message),
    );
  });

  test('🔴 a 4xx, a 500 and a 501 are answers: refused on first sight, no retry, no sleep', async () => {
    for (const status of [400, 401, 403, 404, 422, 429, 500, 501]) {
      const { f, calls } = answers(status, 200);
      const s = sleeper();
      await assert.rejects(
        mintMagicLinkTokenHash({ url: AUTH, serviceKey: 'k', email: 'e', fetchImpl: f, sleep: s.sleep }),
        (e) => e instanceof MagicLinkRefused && new RegExp(`generate_link failed: HTTP ${status}\\n`).test(e.message),
        `HTTP ${status}`,
      );
      assert.equal(calls.length, 1, `HTTP ${status} was retried`);
      assert.deepEqual(s.slept, [], `HTTP ${status} slept`);
    }
  });

  test('each attempt carries a timeout ceiling; one that never answers is MagicLinkRefused', async () => {
    const seen = [];
    const hang = (url, init) => {
      seen.push(init.signal);
      // AbortSignal.timeout's timer is unref'd; this one holds the loop open
      // until the ceiling fires, as a real socket would.
      const hold = setTimeout(() => {}, 5_000);
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => {
          clearTimeout(hold);
          reject(init.signal.reason);
        }),
      );
    };
    await assert.rejects(
      mintMagicLinkTokenHash({ url: AUTH, serviceKey: 'k', email: 'e', fetchImpl: hang, timeoutMs: 20 }),
      (e) => e instanceof MagicLinkRefused && /did not answer within 20 ms/.test(e.message),
    );
    assert.equal(seen.length, 1);
    assert.ok(seen[0] instanceof AbortSignal);
  });
});

/** A loopback GoTrue: admin/users answers a user, generate_link answers `mintStatus`. */
async function fakeGoTrue({ mintStatus }) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      if (req.url === '/auth/v1/admin/users') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ id: UUID_A, email: JSON.parse(body).email }));
      }
      if (req.url === '/auth/v1/admin/generate_link') {
        res.writeHead(mintStatus, { 'content-type': 'application/json' });
        return res.end(mintStatus === 200 ? JSON.stringify({ hashed_token: HEX56 }) : '{"msg":"refused"}');
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

/** Spawns provision_user.mjs; resolves { code, outputs, raw, stderr }. */
async function provision(env) {
  const dir = mkdtempSync(join(tmpdir(), 'nk-provision-'));
  const out = join(dir, 'github-output.txt');
  writeFileSync(out, '');
  const childEnv = { PATH: process.env.PATH, SUPABASE_SERVICE_ROLE_KEY: 'svc', ...env };
  if (env.GITHUB_OUTPUT === undefined) childEnv.GITHUB_OUTPUT = out;
  if (env.GITHUB_OUTPUT === null) delete childEnv.GITHUB_OUTPUT;
  try {
    const child = spawn(process.execPath, [PROVISION], { env: childEnv });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.stdout.resume();
    const code = await new Promise((r) => child.on('close', r));
    const raw = readFileSync(out, 'utf8');
    const outputs = new Map(raw.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return { code, outputs, raw, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('provision_user: the id reaches $GITHUB_OUTPUT before the mint can fail', () => {
  test('🔴 RED CONTROL — the user is created, the mint is refused: exit 1, and the output ALREADY holds user_id and email', async () => {
    const g = await fakeGoTrue({ mintStatus: 400 });
    try {
      const r = await provision({ SUPABASE_URL: g.url });
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /generate_link failed: HTTP 400/);
      assert.equal(r.outputs.get('user_id'), UUID_A, `the always() purge would get an empty E2E_USER_ID; output was:\n${r.raw}`);
      assert.match(r.outputs.get('email'), E2E_EMAIL_SHAPE);
      assert.equal(r.outputs.has('token_hash'), false, 'a token was written for a failed mint');
      assert.equal(r.outputs.has('password'), false);
      assert.deepEqual(g.seen.map((s) => s.url), ['/auth/v1/admin/users', '/auth/v1/admin/generate_link']);
    } finally {
      await g.close();
    }
  });

  test('green control — a good mint writes all four outputs, each once, and the address has the sweep\'s shape', async () => {
    const g = await fakeGoTrue({ mintStatus: 200 });
    try {
      const r = await provision({ SUPABASE_URL: g.url });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual([...r.outputs.keys()].sort(), ['email', 'password', 'token_hash', 'user_id']);
      assert.equal(r.raw.split('\n').filter((l) => l.startsWith('user_id=')).length, 1);
      assert.equal(r.outputs.get('user_id'), UUID_A);
      assert.equal(r.outputs.get('token_hash'), HEX56);
      assert.match(r.outputs.get('email'), E2E_EMAIL_SHAPE);
    } finally {
      await g.close();
    }
  });

  test('🔴 GITHUB_OUTPUT unset: exit 1 BEFORE any user is created', async () => {
    const g = await fakeGoTrue({ mintStatus: 200 });
    try {
      const r = await provision({ SUPABASE_URL: g.url, GITHUB_OUTPUT: null });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /GITHUB_OUTPUT is not set/);
      assert.deepEqual(g.seen, [], 'a user was created with nowhere to write its id');
    } finally {
      await g.close();
    }
  });
});

const NOW = Date.parse('2026-10-03T06:00:00Z');
const H = 3_600_000;
let n = 0;
/** A GoTrue user row: [email] created [ageH] hours before NOW. */
function user(email, ageH, extra = {}) {
  n++;
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, email, created_at: new Date(NOW - ageH * H).toISOString(), ...extra };
}
const e2eAt = (ageH) => e2eEmail(NOW - ageH * H);

describe('purge_stale: selection — only the provisioner\'s own addresses, only when old', () => {
  test('the shape the provisioner mints is the shape the sweep matches', () => {
    const now = Date.now();
    assert.match(e2eEmail(now), E2E_EMAIL_SHAPE);
    assert.equal(e2eEmailTagMs(e2eEmail(now)), now);
    assert.ok(STALE_AFTER_MS >= 2 * H, 'the age floor dropped below 2 h');
    assert.equal(SWEEP_CAP, 20);
  });

  test('green control — an E2E user 3 h old IS selected', () => {
    const u = user(e2eAt(3), 3);
    assert.deepEqual(selectStale([u], { nowMs: NOW }).ids, [u.id]);
  });

  test('🔴 RED CONTROL — a real-looking address is NEVER selected, however old', () => {
    const users = [
      user('selvam.kumar@gmail.com', 5000),
      user('support@nikatru.com', 5000),
      user('owner+e2e@nikatru.com', 5000),
    ];
    assert.deepEqual(selectStale(users, { nowMs: NOW }).ids, []);
  });

  test('🔴 RED CONTROL — near-miss addresses are NEVER selected', () => {
    const tag = NOW - 10 * H;
    const near = [
      `subscriptiontracker-e2e+${tag}@nikatru.com.evil.com`,
      `x-subscriptiontracker-e2e+${tag}@nikatru.com`,
      `subscriptiontracker-e2e+${tag}@nikatru.co`,
      `subscriptiontracker-e2e+${tag}@gmail.com`,
      `subscriptiontracker-e2e+${tag}@sub.nikatru.com`,
      `subscriptiontracker-e2e@nikatru.com`,
      `subscriptiontracker-e2e+${String(tag).slice(0, 12)}@nikatru.com`,
      `subscriptiontracker-e2e+${tag}0@nikatru.com`,
      `subscriptiontracker-e2e+${tag}x@nikatru.com`,
      `subscriptiontracker-e2e+fixture@nikatru.com`,
      `SUBSCRIPTIONTRACKER-E2E+${tag}@NIKATRU.COM`,
      `subscriptiontracker-e2e+${tag}@nikatru.com\n`,
      ` subscriptiontracker-e2e+${tag}@nikatru.com`,
      `othertracker-e2e+${tag}@nikatru.com`,
    ];
    const users = near.map((e) => user(e, 10));
    const r = selectStale(users, { nowMs: NOW });
    assert.deepEqual(r.ids, []);
    assert.equal(r.matched, 0);
  });

  test('🔴 RED CONTROL — an E2E user younger than 2 h is NEVER selected (a run may still hold it)', () => {
    const users = [user(e2eAt(1), 1), user(e2eAt(1.99), 1.99), user(e2eAt(0), 0)];
    const r = selectStale(users, { nowMs: NOW });
    assert.deepEqual(r.ids, []);
    assert.equal(r.young, 3);
  });

  test('🔴 BOTH witnesses of age must agree, and a missing one keeps the user', () => {
    const users = [
      user(e2eAt(1), 10), // created long ago, tag young
      user(e2eAt(10), 1), // tag old, created recently
      user(e2eAt(10), 10, { created_at: undefined }),
      user(e2eAt(10), 10, { created_at: 'not a date' }),
      user(e2eAt(-5), 10), // a tag from the future
    ];
    assert.deepEqual(selectStale(users, { nowMs: NOW }).ids, []);
  });

  test('a row whose id is not a UUID is never selected (the id goes into the DELETE path)', () => {
    const users = [user(e2eAt(5), 5, { id: '../../admin' }), user(e2eAt(5), 5, { id: `${UUID_A}\n` }), user(e2eAt(5), 5, { id: 7 })];
    assert.deepEqual(selectStale(users, { nowMs: NOW }).ids, []);
  });

  test('at most SWEEP_CAP per run, oldest first', () => {
    const users = Array.from({ length: 30 }, (_, i) => user(e2eAt(3 + i), 3 + i));
    const r = selectStale(users, { nowMs: NOW });
    assert.equal(r.ids.length, SWEEP_CAP);
    assert.equal(r.stale, 30);
    assert.deepEqual(r.ids, [...users].reverse().slice(0, SWEEP_CAP).map((u) => u.id));
  });
});

/** A recording fake of the purge transport: the list answers `pages`, D1 and DELETE answer 200. */
function sweepTransport(pages, { listStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    if (url.includes('/auth/v1/admin/users?')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return new Response(JSON.stringify({ users: pages[page - 1] ?? [] }), { status: listStatus });
    }
    if (url.includes('/d1/database/')) {
      return new Response(JSON.stringify({ success: true, result: [{ meta: { changes: 0 } }] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  const client = purgeClient({ acct: 'acct', token: 'tok', supaUrl: AUTH, serviceKey: 'svc', fetchImpl, sleep: async () => {}, note: () => {}, env: {} });
  return { calls, client };
}

function io() {
  const out = [];
  const err = [];
  return { out, err, log: (l) => out.push(l), warn: (l) => err.push(l) };
}

describe('purge_stale: the sweep deletes only what it selected, through the purge\'s own requests', () => {
  test('🔴 RED CONTROL — among a real address, a near miss and a young E2E user, only the stale E2E user is deleted', async () => {
    const stale = user(e2eAt(4), 4);
    const keep = [user('selvam.kumar@gmail.com', 400), user(`subscriptiontracker-e2e+${NOW - 4 * H}@nikatru.com.evil.com`, 4), user(e2eAt(0.5), 0.5)];
    const t = sweepTransport([[...keep, stale]]);
    const o = io();
    const r = await sweepStale(t.client, { dbId: 'db', userTables: ['budgets', 'subscriptions'], nowMs: NOW, ...o });
    assert.deepEqual(r, { listFailed: false, failures: 0, purged: 1, selected: 1 });
    const deletes = t.calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    assert.deepEqual(deletes, [`${AUTH}/auth/v1/admin/users/${stale.id}`]);
    for (const k of keep) assert.ok(!t.calls.some((c) => c.url.includes(k.id)), `touched ${k.email}`);
    assert.equal(t.calls.filter((c) => c.url.includes('/d1/database/db/query')).length, 2);
    // Counts and ids, never an address.
    for (const line of [...o.out, ...o.err]) assert.ok(!/@/.test(line), `printed an address: ${line}`);
    assert.match(o.out[0], /2 throwaway E2E user\(s\) listed, 1 younger than 2 h kept, 1 stale, 1 selected \(cap 20\)/);
  });

  test('the list asks GoTrue to narrow by the prefix, and pages until a short page', async () => {
    const full = Array.from({ length: LIST_PER_PAGE }, () => user('someone@else.invalid', 10));
    const t = sweepTransport([full, [user(e2eAt(3), 3)]]);
    const r = await sweepStale(t.client, { dbId: 'db', userTables: ['budgets'], nowMs: NOW, ...io() });
    assert.equal(r.selected, 1);
    const lists = t.calls.filter((c) => c.method === 'GET').map((c) => new URL(c.url).searchParams);
    assert.deepEqual(lists.map((q) => q.get('page')), ['1', '2']);
    assert.ok(lists.every((q) => q.get('filter') === 'subscriptiontracker-e2e'));
  });

  test('the list stops at LIST_MAX_PAGES and says so', async () => {
    const full = Array.from({ length: LIST_PER_PAGE }, () => user('someone@else.invalid', 10));
    const t = sweepTransport(Array.from({ length: LIST_MAX_PAGES + 2 }, () => full));
    const o = io();
    await sweepStale(t.client, { dbId: 'db', userTables: ['budgets'], nowMs: NOW, ...o });
    assert.equal(t.calls.filter((c) => c.method === 'GET').length, LIST_MAX_PAGES);
    assert.match(o.out[0], /stopped at 10 pages/);
  });

  test('🔴 a list that cannot be read deletes nothing and is a failure', async () => {
    const t = sweepTransport([[user(e2eAt(3), 3)]], { listStatus: 401 });
    const o = io();
    const r = await sweepStale(t.client, { dbId: 'db', userTables: ['budgets'], nowMs: NOW, ...o });
    assert.equal(r.listFailed, true);
    assert.equal(r.failures, 1);
    assert.equal(t.calls.filter((c) => c.method !== 'GET').length, 0);
  });
});

describe('e2e.yml runs the sweep before it provisions', () => {
  test('the sweep step precedes the first provisioning step in the web job', () => {
    const yml = readFileSync(join(REPO, '.github', 'workflows', 'e2e.yml'), 'utf8');
    const sweep = yml.indexOf('run: node tooling/e2e/purge_stale.mjs');
    const firstProvision = yml.indexOf('run: node tooling/e2e/provision_user.mjs');
    assert.ok(sweep > 0, 'e2e.yml no longer runs tooling/e2e/purge_stale.mjs');
    assert.ok(sweep < firstProvision, 'the sweep runs after a user is provisioned');
  });
});
