// ─────────────────────────────────────────────────────────────────────────────
// store-vitals.test.mjs — tooling/ops/check-store-vitals.mjs and
// tooling/ops/vitals/* (crash-rates; O-STORE-VITALS-UNREAD; gate R11-05).
//
// The fixtures in tooling/ops/fixtures/vitals/ are DOC-SHAPED, not recorded
// from a live store (no store credential reaches this lane): Play's from the
// Reporting API's discovery document, Apple's from the xcodeMetrics reference,
// both read 2026-10-02. The first real reading replaces them (Lead steps).
//
// Red controls, each a case below:
//   · every adapter's fixture parses to the SAME normalised shape; a body with an
//     unknown field fails loudly (exit 1), never reads as zero;
//   · an empty answer grades `no-data`, never green;
//   · 0.6 % crash is red; 0.42 % ANR (inside 80 % of 0.47 %) amber; removing a
//     register row exits 1;
//   · a missing credential grades `unreadable` with its secret's NAME;
//   · two identical runs page ZERO times; a worsening pages ONCE;
//   · Windows: `node c:\…\check-store-vitals.mjs` in any case is this module.
//
// Run:  node --test tooling/ci/test/store-vitals.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isThisModule, main } from '../../ops/check-store-vitals.mjs';
import { VitalsShapeError, parseAscMetrics, parsePlayRows } from '../../ops/vitals/readers.mjs';
import { gradeReading, worsened } from '../../ops/vitals/grade.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIX = join(REPO, 'tooling', 'ops', 'fixtures', 'vitals');
const fixture = (n) => JSON.parse(readFileSync(join(FIX, n), 'utf8'));
const REGISTER = JSON.parse(readFileSync(join(REPO, 'tooling', 'ops', 'vitals', 'thresholds.json'), 'utf8'));
const NOW = Date.parse('2026-10-02T06:00:00Z');

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const CREDS = {
  PLAY_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'vitals@example.iam.gserviceaccount.com', private_key: rsa }),
  APP_STORE_CONNECT_ISSUER_ID: 'issuer',
  APP_STORE_CONNECT_KEY_ID: 'KEYID12345',
  APP_STORE_CONNECT_PRIVATE_KEY: ec,
};

/** A fake network: the token endpoint, the three Play sets and ASC, each answered from a named fixture. */
function store({ crash = 'play-crash-red.json', anr = 'play-anr-amber.json', slow = 'play-slowstart.json', asc = 'asc-perfpower.json' } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    calls.push(u);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u === 'https://oauth2.googleapis.com/token') return json({ access_token: 'ya29.test' });
    if (u.includes('/crashRateMetricSet:query')) return json(fixture(crash));
    if (u.includes('/anrRateMetricSet:query')) return json(fixture(anr));
    if (u.includes('/slowStartRateMetricSet:query')) return json(fixture(slow));
    if (u.includes('/perfPowerMetrics')) return json(fixture(asc));
    throw new Error(`unexpected fetch ${u}`);
  };
  return { calls, fetchImpl };
}

async function run(argv, { env = CREDS, net = store(), root = REPO } = {}) {
  const lines = [];
  const errs = [];
  const code = await main(argv, { root, env, fetchImpl: net.fetchImpl, now: () => NOW, log: (s) => lines.push(s), error: (s) => errs.push(s) });
  return { code, out: lines.join('\n'), err: errs.join('\n'), calls: net.calls };
}

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-vitals-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

describe('the readers: one normalised shape, loud on the unknown', () => {
  test('Play and App Store fixtures parse to readings of the same keys', async () => {
    const r = await run([]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /subscriptiontracker · android-play · crash · rate 0\.60% · threshold 0\.50% · red · 2026-09-29/);
    assert.match(r.out, /subscriptiontracker · android-play · anr · rate 0\.42% · threshold 0\.47% · amber/);
    assert.match(r.out, /subscriptiontracker · android-play · slow-start · rate 2\.10% · threshold - · no-threshold/);
    assert.match(r.out, /subscriptiontracker · ios-appstore · hang:hangRate · rate 0\.5 s\/hr · threshold - · no-threshold · version 1\.1\.0/);
    const play = parsePlayRows(fixture('play-crash-red.json'), 'userPerceivedCrashRate28dUserWeighted');
    assert.deepEqual(play, { period: '2026-09-29', value: 0.006 });
    const keys = Object.keys(parseAscMetrics(fixture('asc-perfpower.json'))[0]).sort();
    assert.deepEqual(keys, ['channel', 'detail', 'metric', 'period', 'status', 'unit', 'value']);
  });

  test('every app channel appears — a store with no source says so, nothing is silently missing', async () => {
    const r = await run([]);
    for (const ch of ['web', 'android-play', 'ios-appstore', 'macos-appstore', 'windows-store', 'windows-direct', 'linux-snap', 'linux-appimage', 'apps-gov-in']) {
      assert.match(r.out, new RegExp(`subscriptiontracker · ${ch} · `), ch);
    }
    assert.match(r.out, /macos-appstore · \* · rate - · threshold - · no-source — App Store Connect perfPowerMetrics filters by platform IOS only/);
  });

  test('🔴 a body with an unknown field fails LOUDLY (exit 1), never as a zero', async () => {
    assert.throws(() => parsePlayRows(fixture('play-unknown-metric.json'), 'userPerceivedCrashRate28dUserWeighted'), VitalsShapeError);
    assert.throws(() => parsePlayRows({ rows: [], surprise: 1 }, 'x'), /unknown field `surprise`/);
    assert.throws(() => parsePlayRows({ rows: [{ startTime: { year: 2026, month: 9, day: 1 }, metrics: [{ metric: 'c', decimalValue: { value: '1.09' } }] }] }, 'c'), /above 1 — not a fraction/);
    const r = await run([], { net: store({ crash: 'play-unknown-metric.json' }) });
    assert.equal(r.code, 1);
    assert.match(r.err, /unknown metric `crashRateSomethingNew`/);
  });

  test('🔴 an empty answer is no-data (grey), never green', async () => {
    const r = await run([], { net: store({ crash: 'play-empty.json', asc: 'asc-empty.json' }) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /⬜ subscriptiontracker · android-play · crash · rate - · threshold 0\.50% · no-data/);
    assert.match(r.out, /⬜ subscriptiontracker · ios-appstore · perf-power · .*no-data/);
    assert.doesNotMatch(r.out, /android-play · crash · .*green/);
  });

  test('🔴 a missing credential is unreadable with its secret NAME — never red, never green', async () => {
    const r = await run(['--read-pending-until', '2026-10-31'], { env: {} });
    assert.equal(r.code, 0);
    assert.match(r.out, /❔ subscriptiontracker · android-play · crash · rate - · threshold 0\.50% · unreadable — PLAY_SERVICE_ACCOUNT_JSON is not set/);
    assert.match(r.out, /ios-appstore · perf-power · .*unreadable — APP_STORE_CONNECT_ISSUER_ID, APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_PRIVATE_KEY not set/);
    assert.doesNotMatch(r.out, /· (red|green|amber)/);
    assert.equal(r.calls.length, 0);
  });

  test('nothing read past the pending date is COVERAGE LOST (exit 2)', async () => {
    const r = await run(['--read-pending-until', '2026-10-01'], { env: {} });
    assert.equal(r.code, 2);
    assert.match(r.err, /COVERAGE LOST/);
  });
});

describe('the grade, from the register', () => {
  const g = (metric, value) => gradeReading({ metric, value, status: 'ok' }, REGISTER);
  test('🔴 0.6 % crash is red; 0.42 % (inside 80 % of 0.5 %) amber; 0.3 % green; 0.5 % exactly still inside', () => {
    assert.equal(g('crash', 0.006), 'red');
    assert.equal(g('crash', 0.0042), 'amber');
    assert.equal(g('crash', 0.003), 'green');
    assert.equal(g('crash', 0.005), 'amber');
  });
  test('ANR: at 0.47 % is red ("below 0.47 %"), 0.38 % amber, 0.3 % green', () => {
    assert.equal(g('anr', 0.0047), 'red');
    assert.equal(g('anr', 0.0038), 'amber');
    assert.equal(g('anr', 0.003), 'green');
  });
  test('🔴 removing the register row exits 1', async () => {
    const root = join(TMP, 'no-row');
    mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
    mkdirSync(join(root, 'tooling', 'ops', 'vitals'), { recursive: true });
    cpSync(join(REPO, 'apps', 'subscriptiontracker', 'app.yaml'), join(root, 'apps', 'subscriptiontracker', 'app.yaml'));
    cpSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
    const reg = structuredClone(REGISTER);
    delete reg.metrics.crash;
    writeFileSync(join(root, 'tooling', 'ops', 'vitals', 'thresholds.json'), JSON.stringify(reg));
    const r = await run([], { root });
    assert.equal(r.code, 1);
    assert.match(r.err, /no row for `crash`/);
    assert.equal(r.calls.length, 0);
    assert.throws(() => gradeReading({ metric: 'crash', value: 0.001, status: 'ok' }, reg), /no row for the graded metric `crash`/);
  });
  test('🔴 an ABSENT register (read, ENOENT, never exists-then-read) exits 1 as missing; an app dir with no app.yaml is skipped', async () => {
    const root = join(TMP, 'no-register');
    mkdirSync(join(root, 'apps', 'subscriptiontracker'), { recursive: true });
    mkdirSync(join(root, 'apps', 'half-made'), { recursive: true });
    mkdirSync(join(root, 'tooling', 'ops', 'vitals'), { recursive: true });
    cpSync(join(REPO, 'apps', 'subscriptiontracker', 'app.yaml'), join(root, 'apps', 'subscriptiontracker', 'app.yaml'));
    cpSync(join(REPO, 'tooling', 'channel-register.json'), join(root, 'tooling', 'channel-register.json'));
    let r = await run([], { root });
    assert.equal(r.code, 1);
    assert.match(r.err, /thresholds\.json is missing/);
    assert.equal(r.calls.length, 0);
    // With the register back, the app.yaml-less dir is skipped, never a crash.
    writeFileSync(join(root, 'tooling', 'ops', 'vitals', 'thresholds.json'), JSON.stringify(REGISTER));
    r = await run([], { root });
    assert.notEqual(r.code, 2, r.err);
    assert.doesNotMatch(r.out, /half-made/);
  });
});

describe('the regression alert', () => {
  test('🔴 two identical runs page ZERO times; a worsening pages ONCE; staying worse pages no more', async () => {
    const state = join(TMP, 'state.json');
    const green = { crash: 'play-empty.json', anr: 'play-empty.json' };
    writeFileSync(state, JSON.stringify({ grades: { 'subscriptiontracker|android-play|crash': 'green', 'subscriptiontracker|android-play|anr': 'green' } }));
    let r = await run(['--state', state], { net: store(green) });
    assert.equal(r.code, 0, r.out);
    r = await run(['--state', state], { net: store(green) });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /PAGE:/);
    // crash goes red, anr amber: ONE run pages (exit 1), naming both.
    r = await run(['--state', state]);
    assert.equal(r.code, 1);
    assert.equal(r.out.match(/^PAGE:/gm)?.length, 2);
    assert.match(r.out, /PAGE: subscriptiontracker · android-play · crash worsened green → red/);
    // The same again: no page.
    r = await run(['--state', state]);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /PAGE:/);
    // An unreadable run does not erase what was known: red → unreadable → red pages nothing.
    r = await run(['--state', state, '--read-pending-until', '2026-10-31'], { env: {} });
    assert.equal(r.code, 0);
    r = await run(['--state', state]);
    assert.equal(r.code, 0);
  });

  test('🔴 an ABSENT state file (ENOENT) is no known grades: a red reading pages from `unknown`, and the file is written', async () => {
    const state = join(TMP, 'fresh', 'state.json');
    mkdirSync(dirname(state), { recursive: true });
    const r = await run(['--state', state]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PAGE: subscriptiontracker · android-play · crash worsened unknown → red/);
    assert.equal(JSON.parse(readFileSync(state, 'utf8')).grades['subscriptiontracker|android-play|crash'], 'red');
  });

  test('the comparison itself: only green < amber < red are compared', () => {
    assert.deepEqual(worsened({ a: 'red' }, { a: 'unreadable' }), []);
    assert.deepEqual(worsened({}, { a: 'amber' }), [{ key: 'a', from: 'unknown', to: 'amber' }]);
    assert.deepEqual(worsened({ a: 'amber' }, { a: 'green' }), []);
  });
});

describe('Windows', () => {
  test('`node c:\\…\\check-store-vitals.mjs` in any case and either slash is this module', () => {
    assert.equal(isThisModule('c:\\r\\tooling\\ops\\check-store-vitals.mjs', 'C:\\r\\tooling\\ops\\check-store-vitals.mjs', 'win32'), true);
    assert.equal(isThisModule('C:/r/tooling/ops/check-store-vitals.mjs', 'C:\\r\\tooling\\ops\\check-store-vitals.mjs', 'win32'), true);
    assert.equal(isThisModule('/r/tooling/ops/Check-store-vitals.mjs', '/r/tooling/ops/check-store-vitals.mjs', 'linux'), false);
  });
});
