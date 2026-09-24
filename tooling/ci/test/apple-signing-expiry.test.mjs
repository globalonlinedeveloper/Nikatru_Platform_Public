// ─────────────────────────────────────────────────────────────────────────────
// apple-signing-expiry.test.mjs — the Apple certificates and App Store profiles
// are held against App Store Connect's own dates, "I could not look" is never a
// pass, and the machine write is all or nothing.
//
// tooling/ops/check-apple-signing-expiry.mjs, row O-APPLE-SIGNING-EXPIRY-UNWATCHED.
// Every App Store Connect answer below is a FIXTURE served through the `doFetch`
// seam: no case touches the network, and every id is INVENTED (FX…), never a real
// certificate or profile id. The signing key is generated in the test.
//
//   A1  GREEN CONTROL — four resources match four rows, exit 0, four row lines
//   A2  a date differs: exit 1, naming the row and both dates
//   A3  a 404 on a certificate: exit 1, "revoked or deleted"
//   A4  a profile whose profileState is INVALID: exit 1
//   A5  a re-minted profile id, and the ids in another order, are followed with
//       no register edit — rows are matched by TYPE, never by position
//   A6  two ids of one type: exit 1
//   A7  an unknown type: exit 1
//   A8  no credential: exit 2 BEFORE any request (the fetch counter is 0)
//   A9  a 403: exit 2, Apple's body quoted
//   A10 a persistent 5xx: exit 2 after the bounded retry
//   A11 --write creates the four rows, the written register passes the guard's
//       own `evaluate`, and a check run over it is then green
//   A12 --write rewrites one date and every other byte of the file is identical
//   A13 --write with one resource unreadable writes NOTHING and exits 2
//   A14 --write with GITHUB_REF_NAME=main refuses before any request
//   A15 --write with CI unset refuses before any request
//   A16 the checker imports only `ascJwt` and names no non-GET method
//   A18 apple-expiry-write.yml is dispatch-only, never runs on main, and holds
//       `contents: write` on its job only
//   A19 readAll requests only an id path; any other is COULD NOT LOOK, never fetched
//   (A17 — ops-watch runs the checker — lands with the rows, in the second PR.)
//
// Red controls run against the checker, each restored byte-identical:
//   R1 `profileState` ignored             → A4 RED
//   R2 rows mapped by array position      → A5 RED
//   R3 --write writes what it could read  → A13 RED
//   R4 the GITHUB_REF_NAME=main refusal dropped → A14 RED
//   R5 readAll's request-path check dropped      → A19 RED
//
// Run:  node --test tooling/ci/test/apple-signing-expiry.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { run, readAll, ROW_TEMPLATES, CouldNotLook } from '../../ops/check-apple-signing-expiry.mjs';
import { evaluate } from '../assert-ops-register.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const CHECKER = join(REPO, 'tooling', 'ops', 'check-apple-signing-expiry.mjs');
const WRITE_WF = join(REPO, '.github', 'workflows', 'apple-expiry-write.yml');

const NOW = Date.parse('2026-09-24T06:00:00Z');
const PEM = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const CREDS = { APP_STORE_CONNECT_ISSUER_ID: 'fx-issuer', APP_STORE_CONNECT_KEY_ID: 'FXKEY00001', APP_STORE_CONNECT_PRIVATE_KEY: PEM };

// ── the invented account ─────────────────────────────────────────────────────
const IDS = { certificates: ['FXDIST0001', 'FXINST0001'], profiles: ['FXPIOS0001', 'FXPMAC0001'] };
const world = () => ({
  FXDIST0001: { resource: 'certificates', attributes: { certificateType: 'DISTRIBUTION', expirationDate: '2027-09-09T10:11:12.000+0000' } },
  FXINST0001: { resource: 'certificates', attributes: { certificateType: 'MAC_INSTALLER_DISTRIBUTION', expirationDate: '2027-09-09T10:15:00.000+0000' } },
  FXPIOS0001: { resource: 'profiles', attributes: { profileType: 'IOS_APP_STORE', profileState: 'ACTIVE', expirationDate: '2027-09-09T10:20:00.000+0000' } },
  FXPMAC0001: { resource: 'profiles', attributes: { profileType: 'MAC_APP_STORE', profileState: 'ACTIVE', expirationDate: '2027-09-10T01:00:00.000+0000' } },
});
const DATES = {
  'expiring.cert.apple-distribution': '2027-09-09',
  'expiring.cert.apple-installer': '2027-09-09',
  'expiring.profile.apple-appstore-ios': '2027-09-09',
  'expiring.profile.apple-appstore-macos': '2027-09-10',
};

/** A fake App Store Connect over `doFetch`. `status[id]` overrides the answer;
 *  `calls` counts every request, so "before any request" is a number. */
function fakeAsc(w = world(), status = {}) {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push(url);
    assert.ok(init?.signal, 'every request must carry the per-request ceiling signal');
    const m = /\/v1\/(certificates|profiles)\/([A-Za-z0-9]+)$/.exec(new URL(url).pathname);
    const id = m?.[2];
    const s = status[id];
    if (s) return { ok: false, status: s, headers: { get: () => null }, text: async () => `{"errors":[{"status":"${s}","code":"FX"}]}` };
    const e = w[id];
    if (!e || e.resource !== m[1]) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{"errors":[{"status":"404"}]}' };
    const body = { data: { type: e.resource, id, attributes: e.attributes } };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  return { doFetch, calls };
}

// ── the fixture tree ─────────────────────────────────────────────────────────
let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-apple-expiry-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

/** The anchor row a new row is inserted after, in the register's own shape. */
const ANCHOR_ROW = {
  id: 'expiring.store-enrolment.appstore',
  kind: 'expiring',
  what: 'The Apple Developer Program membership (annual).',
  detector: 'This row.',
  response: 'Confirm the membership is current before a submission depends on it.',
  cadence: '180d',
  expires: null,
  leadDays: 30,
  mechanism: { substrate: 'external-registry', anchor: 'tooling/apple-provisioning.json', record: 'App Store Connect', failingValue: 'membership lapsed', readBy: 'nothing yet' },
  accessProviders: ['apple'],
  ownerGated: true,
  ownerGap: 'Console-only. Owner action.',
  source: 'verified',
  expiryKnownAt: 'Apple Developer -> Membership -> Expiration Date. Console-only.',
};

/** The smallest register `evaluate` passes — ops-register.test.mjs's
 *  `baseRegister`, whose own comment says each of these rows is load-bearing,
 *  plus `apple` and the rows this file is about. */
function passingRegister(extraRows = []) {
  return {
    _readme: ['A fixture.'],
    _kinds: ['surface', 'duty', 'expiring', 'recovery-path', 'revert', 'retention', 'review', 'failure-mode'],
    _providers: ['github', 'google', 'cloudflare', 'laptop', 'oci', 'apple'],
    _substrateHosts: { 'github-actions': 'github', 'windows-task-scheduler': 'laptop', 'glitchtip-heartbeat': 'oci' },
    _maxCadenceDays: { surface: 7, duty: 31, expiring: 180, 'recovery-path': 180, revert: 365, retention: 365, review: 120, 'failure-mode': 365 },
    _expiryCoverage: { _maxNull: 1 },
    _requiredCoverage: { ids: ['recovery.bundles'] },
    rows: [
      {
        id: 'duty.workflow.ci.yml', kind: 'duty', what: 'the gate', detector: 'a red check', response: 'fix before merge', cadence: 'trigger', trigger: 'every push',
        mechanism: { substrate: 'github-actions', anchor: '.github/workflows/ci.yml', record: 'run history', failingValue: 'conclusion = failure', readBy: 'branch protection' },
        accessProviders: ['github'], source: 'verified',
      },
      {
        id: 'recovery.bundles', kind: 'recovery-path', what: 'restore from the offsite bundles', detector: 'this row', response: 'follow the runbook', cadence: '120d', lastDrill: '2026-09-01',
        mechanism: { substrate: 'google-drive', anchor: 'Private/runbooks/backup-liveness.md', record: 'a dated file', failingValue: 'a stale date', readBy: 'the backup script' },
        accessProviders: ['google'], source: 'verified',
      },
      {
        id: 'failure.laptop', kind: 'failure-mode', what: 'the laptop is gone', detector: 'self-evident', response: 'recovery.bundles', cadence: '365d', lastDone: '2026-09-01',
        takesDown: ['laptop'], respondsVia: 'recovery.bundles',
        mechanism: { substrate: 'google-drive', anchor: 'nikatru/OWNER_QUEUE.md', record: 'a dated file', failingValue: 'an intersection', readBy: 'this guard' },
        accessProviders: ['google'], source: 'verified',
      },
      {
        id: 'duty.laptop.backup', kind: 'duty', what: 'the 8-hourly offsite bundle push', detector: 'a heartbeat monitor on another host', response: 'run it by hand and read its log', cadence: '8h',
        mechanism: { substrate: 'windows-task-scheduler', anchor: 'renovate.json', record: 'LastTaskResult + the heartbeat monitor', failingValue: 'the heartbeat not arriving inside its grace window', readBy: 'the monitor, from outside the laptop' },
        absenceWatcher: {
          substrate: 'glitchtip-heartbeat', what: 'heartbeat monitor 6, on a host the laptop cannot take down', signal: 'no POST inside the interval -> Down -> the alert rule -> email',
          margin: 'interval 12h against an 8h cadence = 1.5x, so one late run is not an alarm',
          downTransitionDrill: { date: '2026-09-01', how: 'shrank the window and enqueued the check task, then restored it', evidence: 'delivery record 00000000-0000-4000-8000-00000000f001 at 08:56:23Z' },
        },
        accessProviders: ['laptop'], source: 'verified',
      },
      {
        // The duty row the write workflow itself needs: assert-ops-register holds
        // every workflow file to a duty row anchored at it (U2, measured).
        id: 'duty.workflow.apple-expiry-write.yml', kind: 'duty', what: 'the machine write of the Apple expiry dates', detector: 'the dispatching agent reads the run', response: 'read the run', cadence: 'on-demand',
        why: 'written when a certificate or profile changes, not on a clock',
        mechanism: { substrate: 'github-actions', anchor: '.github/workflows/apple-expiry-write.yml', record: 'run history', failingValue: 'conclusion = failure', readBy: 'the dispatching agent' },
        accessProviders: ['github'], source: 'verified',
      },
      ANCHOR_ROW,
      ...extraRows,
    ],
  };
}
const EVAL_TREE = {
  workflows: ['ci.yml', 'apple-expiry-write.yml'],
  paths: new Set(['.github/workflows/ci.yml', '.github/workflows/apple-expiry-write.yml', 'renovate.json', 'tooling/apple-provisioning.json', 'tooling/ops/check-apple-signing-expiry.mjs', 'tooling/ci/assert-ops-register.mjs', 'tooling/ops/provision-apple.mjs']),
};

/** The id each row was last read from, in the shape `expiryKnownAt` records it. */
const READ_FROM = {
  'expiring.cert.apple-distribution': 'certificates/FXDIST0001',
  'expiring.cert.apple-installer': 'certificates/FXINST0001',
  'expiring.profile.apple-appstore-ios': 'profiles/FXPIOS0001',
  'expiring.profile.apple-appstore-macos': 'profiles/FXPMAC0001',
};
/** A row the check mode reads: only `id` and `expires` matter to it. */
const datedRow = (id, expires) => ({ id, kind: 'expiring', expires, leadDays: 30, expiryKnownAt: `fixture: App Store Connect \`GET v1/${READ_FROM[id]}\`` });

/** The register as TEXT, deliberately NOT what JSON.stringify(_, null, 2) writes
 *  (the real file is not either): the `_readme` array is indented irregularly,
 *  so an edit that re-serialises the whole file cannot pass A12. */
function registerText(reg) {
  return JSON.stringify(reg, null, 2).replace('"_readme": [\n    "A fixture."\n  ]', '"_readme": [\n      "A fixture."\n  ]') + '\n';
}

function fixtureRoot({ rows = null, reg = null, ids = IDS } = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'tooling', 'ops'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'apple-provisioning.json'), `${JSON.stringify({ protected: { bundleIds: ['com.fixture.app'], ...ids } }, null, 2)}\n`);
  const register = reg ?? { _readme: ['A fixture.'], rows: [ANCHOR_ROW, ...(rows ?? Object.entries(DATES).map(([id, d]) => datedRow(id, d)))] };
  writeFileSync(join(root, 'tooling', 'ops', 'register.json'), registerText(register));
  return root;
}
const readRegisterText = (root) => readFileSync(join(root, 'tooling', 'ops', 'register.json'), 'utf8');

/** One run of the checker, in process, every outside input injected. */
async function check(root, { w, status, env = {}, write = false } = {}) {
  const asc = fakeAsc(w, status);
  const out = [];
  const code = await run([...(write ? ['--write'] : []), '--root', root], {
    env: { ...CREDS, ...env },
    doFetch: asc.doFetch,
    sleep: async () => {},
    now: () => NOW,
    log: (l) => out.push(l),
    error: (l) => out.push(l),
  });
  return { code, out: out.join('\n'), calls: asc.calls };
}
const WRITE_ENV = { CI: 'true', GITHUB_REF_NAME: 'chore/apple-expiry-rows', GITHUB_RUN_ID: '4242' };

// ─────────────────────────────────────────────────────────────────────────────
describe('check-apple-signing-expiry — the check', () => {
  test('A1 · GREEN CONTROL — four resources match four rows: exit 0, one line per row, four GETs', async () => {
    const r = await check(fixtureRoot());
    assert.equal(r.code, 0, r.out);
    assert.equal(r.calls.length, 4);
    assert.match(r.out, /ok {2}expiring\.cert\.apple-distribution · FXDIST0001 · DISTRIBUTION · expires 2027-09-09 · no state/);
    assert.match(r.out, /ok {2}expiring\.cert\.apple-installer · FXINST0001 · MAC_INSTALLER_DISTRIBUTION · expires 2027-09-09/);
    assert.match(r.out, /ok {2}expiring\.profile\.apple-appstore-ios · FXPIOS0001 · IOS_APP_STORE · expires 2027-09-09 · ACTIVE/);
    assert.match(r.out, /ok {2}expiring\.profile\.apple-appstore-macos · FXPMAC0001 · MAC_APP_STORE · expires 2027-09-10 · ACTIVE/);
    assert.match(r.out, /4 row\(s\) match App Store Connect · 0 finding\(s\) · 0 NOT JUDGED · exit 0/);
  });

  test('🔴 A2 · a date that differs from Apple\'s is exit 1, naming the row and BOTH dates', async () => {
    const w = world();
    w.FXDIST0001.attributes.expirationDate = '2028-01-02T00:00:00.000+0000';
    const r = await check(fixtureRoot(), { w });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /expiring\.cert\.apple-distribution · FXDIST0001 · DISTRIBUTION · expires 2028-01-02 · .* says `expires: "2027-09-09"`, App Store Connect says 2028-01-02/);
    assert.match(r.out, /dispatch \.github\/workflows\/apple-expiry-write\.yml/);
  });

  test('🔴 A3 · a certificate that answers 404 is exit 1 — revoked or deleted, not "could not look"', async () => {
    const w = world();
    delete w.FXINST0001;
    const r = await check(fixtureRoot(), { w });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /certificates FXINST0001 answered 404 — revoked or deleted/);
  });

  test('🔴 A4 · a profile whose profileState is INVALID is exit 1 whatever its date — the 2026-09-16 failure', async () => {
    const w = world();
    w.FXPIOS0001.attributes.profileState = 'INVALID';
    const r = await check(fixtureRoot(), { w });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /expiring\.profile\.apple-appstore-ios · FXPIOS0001 · IOS_APP_STORE · profileState INVALID/);
  });

  test('🔴 A5 · a RE-MINTED profile id, declared in another order, is followed with no register edit', async () => {
    // The macOS profile is listed FIRST and the iOS one has a new id: a mapping
    // by array position would hand the iOS row the macOS date.
    const w = world();
    w.FXPIOS0002 = w.FXPIOS0001;
    delete w.FXPIOS0001;
    const root = fixtureRoot({ ids: { certificates: ['FXINST0001', 'FXDIST0001'], profiles: ['FXPMAC0001', 'FXPIOS0002'] } });
    const before = readRegisterText(root);
    const r = await check(root, { w });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}expiring\.profile\.apple-appstore-ios · FXPIOS0002 · IOS_APP_STORE · expires 2027-09-09/);
    assert.match(r.out, /ok {2}expiring\.profile\.apple-appstore-macos · FXPMAC0001 · MAC_APP_STORE · expires 2027-09-10/);
    assert.equal(readRegisterText(root), before, 'a check run never writes');
  });

  test('🔴 A6 · two ids answering one type is exit 1 — exactly one may claim a row', async () => {
    const w = world();
    w.FXDIST0002 = { resource: 'certificates', attributes: { certificateType: 'DISTRIBUTION', expirationDate: '2027-10-01T00:00:00.000+0000' } };
    const r = await check(fixtureRoot({ ids: { certificates: ['FXDIST0001', 'FXINST0001', 'FXDIST0002'], profiles: IDS.profiles } }), { w });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /expiring\.cert\.apple-distribution — 2 ids answered DISTRIBUTION \(FXDIST0001, FXDIST0002\)/);
  });

  test('🔴 A7 · a type no row claims is exit 1', async () => {
    const w = world();
    w.FXINST0001.attributes.certificateType = 'IOS_DEVELOPMENT';
    const r = await check(fixtureRoot(), { w });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /certificates FXINST0001 answered certificateType IOS_DEVELOPMENT, which no row claims/);
  });

  test('🔴 A8 · no credential is exit 2 BEFORE any request', async () => {
    const asc = fakeAsc();
    const out = [];
    const code = await run(['--root', fixtureRoot()], {
      env: { APP_STORE_CONNECT_ISSUER_ID: 'fx-issuer', APP_STORE_CONNECT_KEY_ID: 'FXKEY00001' },
      doFetch: asc.doFetch,
      sleep: async () => {},
      now: () => NOW,
      log: (l) => out.push(l),
      error: (l) => out.push(l),
    });
    assert.equal(code, 2, out.join('\n'));
    assert.equal(asc.calls.length, 0, 'a missing credential must stop the run before the first request');
    assert.match(out.join('\n'), /APP_STORE_CONNECT_PRIVATE_KEY is not in the environment/);
  });

  test('🔴 A9 · a 403 is exit 2, with Apple\'s own body quoted and no retry', async () => {
    const r = await check(fixtureRoot(), { status: { FXPMAC0001: 403 } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /profiles FXPMAC0001 — COULD NOT LOOK: GET \/v1\/profiles\/FXPMAC0001 answered HTTP 403: \{"errors":\[\{"status":"403"/);
    assert.equal(r.calls.filter((u) => u.endsWith('/FXPMAC0001')).length, 1, 'a refusal is an answer, asked once');
  });

  test('🔴 A10 · a persistent 5xx is exit 2 after the bounded retry, never a pass', async () => {
    const r = await check(fixtureRoot(), { status: { FXDIST0001: 503 } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /certificates FXDIST0001 — COULD NOT LOOK: .*all 3 attempt\(s\)/);
    assert.equal(r.calls.filter((u) => u.endsWith('/FXDIST0001')).length, 3);
  });

  test('🔴 A19 · readAll requests only an id path — anything else is COULD NOT LOOK and never reaches fetch', async () => {
    const { doFetch, calls } = fakeAsc();
    const reads = await readAll({ certificates: ['FXDIST0001', '../apps'], profiles: ['FXPIOS0001'] }, 'fx-jwt', { doFetch, sleep: async () => {} });
    assert.deepEqual(reads.map((r) => r.status), ['ok', 'could-not-look', 'ok']);
    assert.match(reads[1].reason, /is not a path this checker sends/);
    assert.deepEqual(calls.map((u) => new URL(u).pathname), ['/v1/certificates/FXDIST0001', '/v1/profiles/FXPIOS0001']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-apple-signing-expiry — --write', () => {
  test('A11 · --write creates the four rows, the guard\'s own `evaluate` passes them, and a check run is then green', async () => {
    const root = fixtureRoot({ reg: passingRegister() });
    const w = await check(root, { write: true, env: WRITE_ENV });
    assert.equal(w.code, 0, w.out);
    assert.match(w.out, /4 row\(s\) created \(expiring\.cert\.apple-distribution, expiring\.cert\.apple-installer, expiring\.profile\.apple-appstore-ios, expiring\.profile\.apple-appstore-macos\)/);
    const reg = JSON.parse(readRegisterText(root));
    const at = reg.rows.findIndex((r) => r.id === 'expiring.store-enrolment.appstore');
    assert.deepEqual(reg.rows.slice(at + 1, at + 5).map((r) => [r.id, r.expires, r.leadDays]), [
      ['expiring.cert.apple-distribution', '2027-09-09', 45],
      ['expiring.cert.apple-installer', '2027-09-09', 45],
      ['expiring.profile.apple-appstore-ios', '2027-09-09', 30],
      ['expiring.profile.apple-appstore-macos', '2027-09-10', 30],
    ]);
    assert.match(reg.rows[at + 1].expiryKnownAt, /GET v1\/certificates\/FXDIST0001.*apple-expiry-write\.yml run 4242 at 2026-09-24T06:00:00\.000Z/);
    // The guard's pure half — the whole expiring limb, the ratchet and the dated print.
    const v = evaluate(reg, EVAL_TREE, NOW);
    assert.deepEqual(v.errors, [], v.errors.join('\n'));
    const dated = v.prints.filter((p) => /^\[14\]O-11 · expiring\.(cert|profile)\.apple-/.test(p));
    assert.equal(dated.length, 4, v.prints.join('\n'));
    assert.match(dated.join('\n'), /\[14\]O-11 · expiring\.cert\.apple-distribution · expires 2027-09-09 · 350 day\(s\) left · lead 45/);
    const c = await check(root);
    assert.equal(c.code, 0, `a write must converge: the check right after it is green\n${c.out}`);
  });

  test('🔴 A12 · --write rewrites ONE date and every other byte of the file is identical', async () => {
    const root = fixtureRoot();
    const before = readRegisterText(root);
    assert.notEqual(JSON.stringify(JSON.parse(before), null, 2) + '\n', before, 'the fixture must not round-trip, or this case proves nothing');
    const w = world();
    w.FXPMAC0001.attributes.expirationDate = '2028-02-03T04:05:06.000+0000';
    const r = await check(root, { w, write: true, env: WRITE_ENV });
    assert.equal(r.code, 0, r.out);
    const after = readRegisterText(root);
    const a = before.split('\n');
    const b = after.split('\n');
    assert.equal(b.length, a.length, 'a rewrite of an existing row adds and removes no line');
    const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
    assert.equal(changed.length, 2, `only the row's expires and expiryKnownAt lines may change:\n${changed.map((i) => `${a[i]}\n${b[i]}`).join('\n')}`);
    assert.match(b[changed[0]], /^ {6}"expires": "2028-02-03",$/);
    assert.match(b[changed[1]], /"expiryKnownAt": "App Store Connect `GET v1\/profiles\/FXPMAC0001`/);
  });

  test('🔴 A13 · --write with ONE resource unreadable writes NOTHING and exits 2', async () => {
    const root = fixtureRoot({ rows: [] });
    const before = readRegisterText(root);
    const r = await check(root, { status: { FXPIOS0001: 503 }, write: true, env: WRITE_ENV });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /NOTHING WRITTEN/);
    assert.equal(readRegisterText(root), before, 'three readable rows must not be written beside one unreadable one');
  });

  test('🔴 A14 · --write on main REFUSES before any request', async () => {
    const root = fixtureRoot({ rows: [] });
    const before = readRegisterText(root);
    const r = await check(root, { write: true, env: { ...WRITE_ENV, GITHUB_REF_NAME: 'main' } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /REFUSED — --write never runs on main/);
    assert.equal(r.calls.length, 0);
    assert.equal(readRegisterText(root), before);
  });

  test('🔴 A15 · --write with CI unset REFUSES before any request — never from a laptop', async () => {
    const root = fixtureRoot({ rows: [] });
    const before = readRegisterText(root);
    const r = await check(root, { write: true, env: { GITHUB_REF_NAME: 'chore/x' } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /REFUSED — --write runs only inside CI/);
    assert.equal(r.calls.length, 0);
    assert.equal(readRegisterText(root), before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-apple-signing-expiry — what the key can do, and where the write runs', () => {
  test('🔴 A16 · the checker imports ONLY `ascJwt` from provision-apple.mjs and names no non-GET method', () => {
    const code = stripSourceComments(readFileSync(CHECKER, 'utf8'), '.mjs');
    const imports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/provision-apple\.mjs['"]/g)].map((m) => m[1].trim());
    assert.deepEqual(imports, ['ascJwt']);
    assert.doesNotMatch(code, /\bascClient\b/, 'the client that sends POST and DELETE must be unreachable from a process holding the key');
    assert.doesNotMatch(code, /\b(POST|PUT|PATCH|DELETE)\b/);
    assert.doesNotMatch(code, /\bmethod\s*:/, 'no request in this file names a method, so every one is a GET');
    assert.equal(typeof CouldNotLook, 'function');
    assert.deepEqual(ROW_TEMPLATES.map((t) => [t.id, t.type, t.leadDays]), [
      ['expiring.cert.apple-distribution', 'DISTRIBUTION', 45],
      ['expiring.cert.apple-installer', 'MAC_INSTALLER_DISTRIBUTION', 45],
      ['expiring.profile.apple-appstore-ios', 'IOS_APP_STORE', 30],
      ['expiring.profile.apple-appstore-macos', 'MAC_APP_STORE', 30],
    ]);
  });

  test('🔴 A18 · apple-expiry-write.yml is dispatch-only, never runs on main, and holds `contents: write` on its job alone', () => {
    const wf = readFileSync(WRITE_WF, 'utf8');
    const on = /^on:\n((?:[ #].*\n|\n)*)/m.exec(wf);
    assert.ok(on, 'no `on:` block');
    const events = [...on[1].matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
    assert.deepEqual(events, ['workflow_dispatch'], 'a push or a schedule would write dates nobody dispatched');
    assert.match(wf, /^ {4}if: github\.ref_name != 'main'$/m);
    const top = /^permissions:(.*)\n((?: {2}.*\n)*)/m.exec(wf);
    assert.ok(top, 'no workflow-level permissions');
    assert.ok(top[1].trim() === '{}' || /^ {2}contents: read\n$/.test(top[2]), `workflow-level permissions must be {} or contents: read, got:${top[1]}\n${top[2]}`);
    const writes = [...wf.matchAll(/^( *)contents: write$/gm)];
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1], ' '.repeat(6), '`contents: write` must sit under the job, never at workflow level');
    assert.match(wf, /node tooling\/ops\/check-apple-signing-expiry\.mjs --write/);
    assert.match(wf, /persist-credentials: false/);
    // A guard host ENFORCES live verdicts on a dispatch, so a red ops-watch would
    // fail the run that repairs it. Measured: the gate-topology ratchet in
    // ops-register.test.mjs went red when this workflow ran the guard.
    assert.doesNotMatch(wf, /^\s*run: .*node tooling\/ci\/assert-ops-register\.mjs/m, 'the write workflow must not become a guard host');
  });
});
