// ─────────────────────────────────────────────────────────────────────────────
// ensure-monitors.test.mjs — the GlitchTip monitor WRITERS and the canary's list
// (O-SERVICE-KIT-UNBUILT, E-b2), each able to FAIL:
//
//   · tooling/ops/glitchtip-monitor-api.mjs, through set-monitor-thresholds.mjs,
//     which moved its request code there: the same lines, the same PUT body, a
//     read retried, a write sent once;
//   · tooling/ops/ensure-monitors.mjs: the dry run prints the POST and sends
//     nothing; --apply creates, RE-READS, and records the id only when the monitor
//     reads back as sent;
//   · tooling/ops/monitor-register.mjs: the canary's id list is the host rows plus
//     `expectedMonitors`, one place per id, and a row is written as text;
//   · tooling/ops/verify-alarm-chains.mjs, run on a copy of the ops files: a host
//     row with no id is named EXPECTED BUT ABSENT, an id in both lists is exit 1.
//
// ⚠️ NOTHING HERE TOUCHES A LIVE INSTANCE. Every script is pointed at a GlitchTip
// served from THIS process (or at a closed port) with a made-up token, and
// GLITCHTIP_URL is set in every case, so a mistake cannot reach the real host.
// Each script runs in a CHILD process: when it exits its keep-alive sockets close,
// which is what lets the fixture server close (ops-verifiers.test.mjs, header).
// Fixture trees live under os.tmpdir() ([ADR 072]).
//
// Run:  node --test tooling/ci/test/ensure-monitors.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendHostRow, expectedMonitors, replaceHostRow } from '../../ops/monitor-register.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OPS = join(REPO, 'tooling', 'ops');
const REGISTER = 'tooling/monitor-register.json';
const LEDGER = 'tooling/ops/alarm-chains.json';
const CLOSED = 'http://127.0.0.1:1';
const TODAY = new Date().toISOString().slice(0, 10);

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ensure-monitors-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

const realRegister = () => readFileSync(join(REPO, REGISTER), 'utf8');
const realLedger = () => JSON.parse(readFileSync(join(REPO, LEDGER), 'utf8'));

/** A GlitchTip served from this process. `answer(method, url, body)` → [status, json]. */
async function serve(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      const [status, json] = answer(req.method, req.url, body);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }),
  };
}

/** Run a script in a child with a CONTROLLED environment: the token and the URL are always set. */
const runScript = (file, args, env) =>
  new Promise((ok) => {
    const child = spawn(process.execPath, [file, ...args], {
      cwd: REPO,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, OPS_SECOND_LOOK_GAP_MS: '0', GLITCHTIP_ORG: 'nikatru', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const kill = setTimeout(() => child.kill(), 60_000);
    child.on('close', (code) => { clearTimeout(kill); ok({ code, out }); });
  });

/** A tree holding only the monitor register, for ensure-monitors --root. */
function registerTree(text) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, REGISTER), text);
  return root;
}
const PENDING = {
  hostname: 'x-api.nikatru.com',
  what: 'the x-api Worker',
  derivedFrom: 'appCatalogue',
  monitor: null,
  gap: {
    why: 'x-api.nikatru.com is provisioned, and GlitchTip has no monitor for it yet.',
    action: 'node tooling/ops/ensure-monitors.mjs',
    create: { name: 'x-api health', type: 'GET', path: '/v1/health', expectedStatus: 200, expectedBody: '"ok":true', intervalSeconds: 60, project: 'x' },
  },
};
const withPending = (row = PENDING) => appendHostRow(realRegister(), row);
const ensure = (root, args, env) => runScript(join(OPS, 'ensure-monitors.mjs'), ['--root', root, ...args], env);
const posts = (g) => g.seen.filter((r) => r.method === 'POST');

/** What GlitchTip answers for the monitor ensure-monitors just created, as it would read back. */
const readBack = (body, over = {}) => ({
  id: 501, monitorType: body.monitorType, name: body.name, url: body.url, expectedStatus: body.expectedStatus,
  expectedBody: body.expectedBody, interval: body.interval, timeout: 30, projectID: body.project,
  confirmationThreshold: body.confirmationThreshold, isUp: null, ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
describe('monitor-register.mjs — the canary list is the host rows plus `expectedMonitors`, one place per id', () => {
  test('R1 GREEN CONTROL: the real register and ledger give every id once, and no problem', () => {
    const reg = JSON.parse(realRegister());
    const r = expectedMonitors(reg, realLedger());
    assert.deepEqual(r.problems, []);
    const hostIds = new Set(reg.hosts.filter((h) => h.monitor).map((h) => String(h.monitor.id)));
    assert.ok(hostIds.size >= 10, `only ${hostIds.size} host monitor ids — the host half stopped reading`);
    assert.equal(r.expected.length, hostIds.size + realLedger().expectedMonitors.length);
    assert.ok(r.expected.some((e) => e.id === '2' && e.from.some((f) => f.includes('subscriptiontracker-api.nikatru.com'))));
    assert.ok(r.expected.some((e) => e.id === '39' && e.from.length === 2), 'monitor 39 watches two hosts and is one id');
  });

  test('R2 (RC11) an id in both lists is refused, naming it', () => {
    const ledger = realLedger();
    ledger.expectedMonitors.push({ id: 2, name: 'Subscription Tracker API health' });
    const r = expectedMonitors(JSON.parse(realRegister()), ledger);
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /^ONE PLACE PER ID: monitor id 2 is in alarm-chains\.json `expectedMonitors` AND in tooling\/monitor-register\.json subscriptiontracker-api\.nikatru\.com/);
  });

  test('R3 a host monitor with no numeric id is COVERAGE LOST, not skipped', () => {
    const reg = JSON.parse(realRegister());
    delete reg.hosts[0].monitor.id;
    const r = expectedMonitors(reg, realLedger());
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /COVERAGE LOST: .*claims a monitor with no numeric `id`/);
  });

  test('R4 a register with no hosts, and a ledger with no list, are each COVERAGE LOST', () => {
    const r = expectedMonitors({}, {});
    assert.equal(r.problems.length, 2, r.problems.join('\n'));
    assert.match(r.problems[0], /has no `hosts`/);
    assert.match(r.problems[1], /`expectedMonitors` is missing or empty/);
  });

  test('R5 a host row with `monitor: null` is pending, never an expected id', () => {
    const r = expectedMonitors(JSON.parse(withPending()), realLedger());
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.pending.map((p) => [p.hostname, p.name]), [['x-api.nikatru.com', 'x-api health']]);
  });

  test('R6 a row is written as TEXT: every other line of the hand-formatted file survives', () => {
    const before = realRegister();
    const appended = withPending();
    assert.ok(appended.startsWith(before.slice(0, before.lastIndexOf('"hostname"'))), 'text before the last row moved');
    const replaced = replaceHostRow(appended, JSON.parse(appended).hosts.length - 1, { hostname: 'x-api.nikatru.com', monitor: { id: 1 } });
    assert.equal(JSON.parse(replaced).hosts.at(-1).monitor.id, 1);
    assert.throws(() => replaceHostRow(before, 999, {}), /has no hosts\[999\]/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ensure-monitors.mjs — dry run by default, and a create that is read back before it is recorded', () => {
  test('E1 (RC10) a host row with no id: the dry run prints ONE POST, sends nothing, writes nothing', async () => {
    const root = registerTree(withPending());
    const before = readFileSync(join(root, REGISTER), 'utf8');
    const { code, out } = await ensure(root, [], { GLITCHTIP_TOKEN: '', GLITCHTIP_URL: CLOSED });
    assert.equal(code, 0, out);
    assert.equal((out.match(/^POST /gm) ?? []).length, 1, out);
    assert.match(out, /^POST http:\/\/127\.0\.0\.1:1\/api\/0\/organizations\/nikatru\/monitors\/ {3}\(for x-api\.nikatru\.com\)$/m);
    assert.match(out, /"url": "https:\/\/x-api\.nikatru\.com\/v1\/health"/);
    assert.match(out, /"project": "<the id of GlitchTip project \\"x\\", read by --apply>"/);
    assert.match(out, /"confirmationThreshold": 2/, 'the [ADR 043] threshold for GET, never GlitchTip\'s default of 1');
    assert.match(out, /DRY RUN — nothing was sent and nothing was written\. 1 POST\(s\) planned/);
    assert.equal(readFileSync(join(root, REGISTER), 'utf8'), before);
  });

  test('E2 GREEN CONTROL: the real register asks for nothing', async () => {
    const { code, out } = await ensure(registerTree(realRegister()), [], { GLITCHTIP_TOKEN: '', GLITCHTIP_URL: CLOSED });
    assert.equal(code, 0, out);
    assert.match(out, /0 ask for one/);
    assert.doesNotMatch(out, /^POST /m);
  });

  test('E3 --apply: resolves the project, POSTs once, re-reads, and records the id over the gap', async () => {
    const g = await serve((method, url, body) => {
      if (method === 'GET' && url === '/api/0/organizations/nikatru/projects/') return [200, [{ id: 7, slug: 'x' }, { id: 1, slug: 'ops' }]];
      if (method === 'POST' && url === '/api/0/organizations/nikatru/monitors/') return [201, readBack(body)];
      if (method === 'GET' && url === '/api/0/organizations/nikatru/monitors/501/') return [200, readBack(posts(g)[0].body)];
      return [404, { detail: 'Not found.' }];
    });
    try {
      const root = registerTree(withPending());
      const before = readFileSync(join(root, REGISTER), 'utf8');
      const { code, out } = await ensure(root, ['--apply'], { GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: g.url });
      assert.equal(code, 0, out);
      assert.equal(posts(g).length, 1);
      const sent = posts(g)[0];
      assert.equal(sent.auth, 'Bearer fixture-token');
      assert.deepEqual(Object.keys(sent.body), ['monitorType', 'name', 'url', 'expectedStatus', 'expectedBody', 'interval', 'timeout', 'project', 'confirmationThreshold']);
      assert.equal(sent.body.project, '7', '`project` is the REQUEST key, and a STRING (the 422 trap)');
      assert.equal(sent.body.confirmationThreshold, 2);
      assert.ok(g.seen.some((r) => r.method === 'GET' && r.url.endsWith('/monitors/501/')), 'the monitor was never re-read');
      const row = JSON.parse(readFileSync(join(root, REGISTER), 'utf8')).hosts.at(-1);
      assert.equal(Object.hasOwn(row, 'gap'), false, 'the gap closed');
      assert.deepEqual(row.monitor, {
        id: 501, name: 'x-api health', type: 'GET', path: '/v1/health', expectedStatus: 200, expectedBody: '"ok":true',
        confirmationThreshold: 2, intervalSeconds: 60, verifiedOn: TODAY,
      });
      const after = readFileSync(join(root, REGISTER), 'utf8');
      assert.ok(after.startsWith(before.slice(0, before.lastIndexOf('"hostname"'))), 'lines outside the row moved');
    } finally {
      await g.close();
    }
  });

  test('E4 --apply: a monitor that reads back WITHOUT its project is not recorded (the monitor-6 defect)', async () => {
    const g = await serve((method, url, body) => {
      if (url === '/api/0/organizations/nikatru/projects/') return [200, [{ id: 7, slug: 'x' }]];
      if (method === 'POST') return [201, readBack(body)];
      if (url.endsWith('/monitors/501/')) return [200, readBack(posts(g)[0].body, { projectID: null })];
      return [404, {}];
    });
    try {
      const root = registerTree(withPending());
      const before = readFileSync(join(root, REGISTER), 'utf8');
      const { code, out } = await ensure(root, ['--apply'], { GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: g.url });
      assert.equal(code, 1, out);
      assert.match(out, /created monitor 501, and it does not read back as sent — project: sent "7", reads back null/);
      assert.match(out, /The register was NOT written; fix or delete monitor 501 by hand/);
      assert.equal(readFileSync(join(root, REGISTER), 'utf8'), before);
    } finally {
      await g.close();
    }
  });

  test('E5 --apply: a project the instance does not have is refused before any POST', async () => {
    const g = await serve((method, url) => (url === '/api/0/organizations/nikatru/projects/' ? [200, [{ id: 1, slug: 'ops' }]] : [500, {}]));
    try {
      const root = registerTree(withPending());
      const { code, out } = await ensure(root, ['--apply'], { GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: g.url });
      assert.equal(code, 1, out);
      assert.match(out, /GlitchTip has no project "x" in nikatru/);
      assert.equal(posts(g).length, 0);
    } finally {
      await g.close();
    }
  });

  test('E6 --apply with no token: exit 2, and nothing is asked', async () => {
    const g = await serve(() => [500, {}]);
    try {
      const { code, out } = await ensure(registerTree(withPending()), ['--apply'], { GLITCHTIP_TOKEN: '', GLITCHTIP_URL: g.url });
      assert.equal(code, 2, out);
      assert.match(out, /GLITCHTIP_TOKEN is not set, so nothing was sent/);
      assert.equal(g.seen.length, 0);
    } finally {
      await g.close();
    }
  });

  test('E7 a register with no host rows is COVERAGE LOST, exit 2', async () => {
    const { code, out } = await ensure(registerTree('{ "hosts": [] }\n'), [], { GLITCHTIP_TOKEN: '', GLITCHTIP_URL: CLOSED });
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/monitor-register\.json declares no host rows/);
  });

  test('E8 an incomplete create spec: exit 1 naming the field, and no POST is planned', async () => {
    const { path: _gone, ...create } = PENDING.gap.create;
    const { code, out } = await ensure(registerTree(withPending({ ...PENDING, gap: { ...PENDING.gap, create } })), [], { GLITCHTIP_TOKEN: '', GLITCHTIP_URL: CLOSED });
    assert.equal(code, 1, out);
    assert.match(out, /x-api\.nikatru\.com: its `gap\.create` cannot become a monitor — fix `path`/);
    assert.doesNotMatch(out, /^POST /m);
  });

  test('E9 --apply: a refused POST is sent ONCE, never retried, and nothing is written', async () => {
    const g = await serve((method, url) => {
      if (url === '/api/0/organizations/nikatru/projects/') return [200, [{ id: 7, slug: 'x' }]];
      if (method === 'POST') return [503, { detail: 'unavailable' }];
      return [404, {}];
    });
    try {
      const root = registerTree(withPending());
      const before = readFileSync(join(root, REGISTER), 'utf8');
      const { code, out } = await ensure(root, ['--apply'], { GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: g.url });
      assert.equal(code, 1, out);
      assert.match(out, /POST returned HTTP 503/);
      assert.equal(posts(g).length, 1, 'a write whose answer was "not now" was sent again');
      assert.equal(readFileSync(join(root, REGISTER), 'utf8'), before);
    } finally {
      await g.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('set-monitor-thresholds.mjs — the request code moved to glitchtip-monitor-api.mjs, and nothing it prints or sends moved', () => {
  const smt = (args, url) => runScript(join(OPS, 'set-monitor-thresholds.mjs'), args, { GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: url });
  const MON2 = { id: 2, name: 'API health', monitorType: 'GET', url: 'https://a.example/v1/health', expectedStatus: 200, expectedBody: '"ok":true', interval: 60, timeout: 30, projectID: '1', confirmationThreshold: 1 };
  const LIST = [MON2, { id: 6, name: 'Laptop daily backup', monitorType: 'Heartbeat', interval: 43200, confirmationThreshold: 1, projectID: '2' }, { ...MON2, id: 11, name: 'platform', confirmationThreshold: 2 }];

  test('M1 the dry run prints the lines it always printed', async () => {
    const g = await serve((method, url) => (url === '/api/0/organizations/nikatru/monitors/' ? [200, LIST] : [404, {}]));
    try {
      const { code, out } = await smt([], g.url);
      assert.equal(code, 0, out);
      assert.equal(
        out,
        'DRY  #2 "API health" (GET, every 60s): confirmationThreshold 1 → 2\n' +
          '--   #6 "Laptop daily backup" — type "Heartbeat" has no policy; left alone\n' +
          'ok   #11 "platform" (GET) already at threshold 2\n' +
          '\nDRY RUN — nothing was written. 1 monitor(s) already match the policy. Re-run with --apply to perform the changes above.\n',
      );
      assert.ok(g.seen.every((r) => r.method === 'GET' && r.auth === 'Bearer fixture-token'));
    } finally {
      await g.close();
    }
  });

  test('M2 --apply PUTs the whole monitor back with `project` as a string, and reads it back', async () => {
    let current = { ...MON2 };
    const g = await serve((method, url, body) => {
      if (url === '/api/0/organizations/nikatru/monitors/') return [200, LIST];
      if (url === '/api/0/organizations/nikatru/monitors/2/' && method === 'GET') return [200, current];
      if (url === '/api/0/organizations/nikatru/monitors/2/' && method === 'PUT') {
        current = { ...current, confirmationThreshold: body.confirmationThreshold };
        return [200, current];
      }
      return [404, {}];
    });
    try {
      const { code, out } = await smt(['--apply'], g.url);
      assert.equal(code, 0, out);
      assert.match(out, /^SET {2}#2 "API health" \(GET, every 60s\): confirmationThreshold 1 → 2 {2}✓ read back, no other field moved$/m);
      const puts = g.seen.filter((r) => r.method === 'PUT');
      assert.equal(puts.length, 1);
      assert.deepEqual(puts[0].body, {
        monitorType: 'GET', name: 'API health', url: 'https://a.example/v1/health', expectedStatus: 200, expectedBody: '"ok":true',
        interval: 60, timeout: 30, project: '1', confirmationThreshold: 2,
      });
      assert.deepEqual(Object.keys(puts[0].body), ['monitorType', 'name', 'url', 'expectedStatus', 'expectedBody', 'interval', 'timeout', 'project', 'confirmationThreshold']);
    } finally {
      await g.close();
    }
  });

  test('M3 --apply: a PUT that moved another field is the full-replace hazard, exit 1', async () => {
    const g = await serve((method, url, body) => {
      if (url === '/api/0/organizations/nikatru/monitors/') return [200, [MON2]];
      if (url.endsWith('/monitors/2/') && method === 'GET') return [200, g.seen.some((r) => r.method === 'PUT') ? { ...MON2, confirmationThreshold: 2, projectID: null } : MON2];
      if (method === 'PUT') return [200, body];
      return [404, {}];
    });
    try {
      const { code, out } = await smt(['--apply'], g.url);
      assert.equal(code, 1, out);
      assert.match(out, /the PUT changed fields it was not meant to — projectID: "1" → null\. This is the full-replace hazard/);
    } finally {
      await g.close();
    }
  });

  test('M4 a list that answers 503 is asked again, then still COULD NOT LOOK, exit 2', async () => {
    const g = await serve(() => [503, { detail: 'unavailable' }]);
    try {
      const { code, out } = await smt([], g.url);
      assert.equal(code, 2, out);
      assert.match(out, /GET monitors returned HTTP 503\. I COULD NOT LOOK\./);
      assert.equal(g.seen.length, 3, 'a read that says "not now" is asked on bounded-retry.mjs\'s plan (3 attempts)');
    } finally {
      await g.close();
    }
  });

  test('M5 a PUT that answers 503 is sent once, never again', async () => {
    const g = await serve((method, url) => {
      if (url === '/api/0/organizations/nikatru/monitors/') return [200, [MON2]];
      if (method === 'GET') return [200, MON2];
      return [503, { detail: 'unavailable' }];
    });
    try {
      const { code, out } = await smt(['--apply'], g.url);
      assert.equal(code, 1, out);
      assert.match(out, /#2 "API health": PUT returned HTTP 503/);
      assert.equal(g.seen.filter((r) => r.method === 'PUT').length, 1);
    } finally {
      await g.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('verify-alarm-chains.mjs — the canary reads the monitor register', () => {
  /** The ops files the canary reads, copied into a temp tree so a register or a
   *  ledger can be changed without touching the real ones. */
  function opsTree({ register = realRegister(), ledger = realLedger() } = {}) {
    const root = join(TMP, `o${seq++}`);
    mkdirSync(join(root, 'tooling', 'ops'), { recursive: true });
    for (const f of ['verify-alarm-chains.mjs', 'bounded-retry.mjs', 'monitor-register.mjs']) cpSync(join(OPS, f), join(root, 'tooling', 'ops', f));
    writeFileSync(join(root, LEDGER), JSON.stringify(ledger, null, 2));
    writeFileSync(join(root, REGISTER), register);
    return root;
  }
  /** A healthy instance holding every id `expectedMonitors()` names, all in one observed project. */
  async function healthy({ drop = [] } = {}) {
    const ledger = realLedger();
    const slug = Object.entries(ledger.chainsObserved).find(([, o]) => o?.date && o?.evidence)[0];
    const ids = expectedMonitors(JSON.parse(realRegister()), ledger).expected.map((e) => e.id).filter((id) => !drop.includes(id));
    return serve((method, url) => {
      if (url === '/api/0/organizations/nikatru/monitors/') return [200, ids.map((id) => ({ id: Number(id), name: `m${id}`, projectID: '1' }))];
      if (url === '/api/0/organizations/nikatru/projects/') return [200, [{ id: 1, slug }]];
      if (url === `/api/0/projects/nikatru/${slug}/alerts/`) return [200, [{ uptime: true, quantity: 1, timespanMinutes: 1, alertRecipients: [{ recipientType: 'email' }] }]];
      return [404, {}];
    });
  }
  const canary = (root, url) => runScript(join(root, 'tooling', 'ops', 'verify-alarm-chains.mjs'), [], { GLITCHTIP_TOKEN: 'fixture-token', GLITCHTIP_URL: url });

  test('V1 GREEN CONTROL: every host id and every listed id live — exit 0', async () => {
    const g = await healthy();
    try {
      const { code, out } = await canary(opsTree(), g.url);
      assert.equal(code, 0, out);
      assert.doesNotMatch(out, /COVERAGE LOST|ONE PLACE PER ID|EXPECTED BUT ABSENT/);
    } finally {
      await g.close();
    }
  });

  test('V2 (RC10) a host row with no id is named EXPECTED BUT ABSENT, and does not fail', async () => {
    const g = await healthy();
    try {
      const { code, out } = await canary(opsTree({ register: withPending() }), g.url);
      assert.equal(code, 0, out);
      assert.match(out, /⬜ EXPECTED BUT ABSENT: x-api\.nikatru\.com is a host row in tooling\/monitor-register\.json with no monitor id yet \(its gap asks for "x-api health"/);
    } finally {
      await g.close();
    }
  });

  test('V3 (RC11) id 2 in both lists: exit 1, ONE PLACE PER ID', async () => {
    const ledger = realLedger();
    ledger.expectedMonitors.push({ id: 2, name: 'Subscription Tracker API health' });
    const g = await healthy();
    try {
      const { code, out } = await canary(opsTree({ ledger }), g.url);
      assert.equal(code, 1, out);
      assert.match(out, /✗ ONE PLACE PER ID: monitor id 2 is in alarm-chains\.json `expectedMonitors` AND in tooling\/monitor-register\.json subscriptiontracker-api\.nikatru\.com/);
    } finally {
      await g.close();
    }
  });

  test('V4 a HOST monitor gone from the live list is COVERAGE LOST, exit 1, naming the row it came from', async () => {
    const g = await healthy({ drop: ['2'] });
    try {
      const { code, out } = await canary(opsTree(), g.url);
      assert.equal(code, 1, out);
      assert.match(out, /COVERAGE LOST: expected monitor id 2 \("Subscription Tracker API health", from tooling\/monitor-register\.json subscriptiontracker-api\.nikatru\.com\) is not in the live list/);
    } finally {
      await g.close();
    }
  });
});
