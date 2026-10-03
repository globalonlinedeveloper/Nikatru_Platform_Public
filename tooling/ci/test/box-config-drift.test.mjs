// ─────────────────────────────────────────────────────────────────────────────
// box-config-drift.test.mjs — tooling/ops/check-box-config-drift.mjs (PB-27) and
// the box-side half that feeds it, tooling/ops/boxes/post-config-manifest.sh.
//
// 🔴 THE RED CONTROL THE BRIEF NAMES: a fixture manifest with ONE changed hash
// exits 1. Its green control — the same fixture with no change — exits 0, so the
// red is the change and not the harness. Then each other limb on the pure judge,
// and the box script driven against a stub `curl` so what it SENDS is asserted
// without a network.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { d1QueryUrl, FIRST_DUE_MAX_DAYS, firstDueVerdict, judgeDrift, readRegister, readRows, REGISTER_REL } from '../../ops/check-box-config-drift.mjs';
import { CouldNotLook } from '../../ops/bounded-retry.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(REPO, 'tooling/ops/check-box-config-drift.mjs');
// Each fixture by its full path, so assert-no-dead-files resolves every one of them.
const FIX_REGISTER = join(REPO, 'tooling/ops/fixtures/box-config-drift/register.json');
const FIX_CLEAN = join(REPO, 'tooling/ops/fixtures/box-config-drift/manifest-clean.json');
const FIX_ONE_CHANGED = join(REPO, 'tooling/ops/fixtures/box-config-drift/manifest-one-changed.json');
const FIX_ABSENT = join(REPO, 'tooling/ops/fixtures/box-config-drift/does-not-exist.json');
const NOW = '2026-10-01T12:00:00Z';

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60_000 });
const H = (c) => c.repeat(64);

describe('check-box-config-drift.mjs — the CLI over fixtures', () => {
  test('GREEN CONTROL: the clean fixture manifest exits 0', () => {
    const r = run('--register', FIX_REGISTER, '--manifest', FIX_CLEAN, '--now', NOW);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /live config is the vendored config/);
  });

  test('🔴 RED CONTROL: a fixture manifest with ONE changed hash exits 1, naming the file', () => {
    const r = run('--register', FIX_REGISTER, '--manifest', FIX_ONE_CHANGED, '--now', NOW);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /boxc\/override: DRIFT/);
    assert.doesNotMatch(r.stderr, /boxc\/compose|boxc\/tunnel|boxb/);
  });

  test('the SHIPPED register with no vendored hash yet is COVERAGE LOST (2), never a pass', () => {
    const reg = JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8'));
    // Read past every box's firstDue (⏱ 2026-10-03), where a null hash is no longer pending.
    const dues = Object.values(reg.boxes).map((b) => Date.parse(b.firstDue ?? '')).filter(Number.isFinite);
    const past = dues.length ? new Date(Math.max(...dues) + 3_600_000).toISOString() : NOW;
    const r = run('--manifest', FIX_CLEAN, '--now', past);
    const unmeasured = Object.values(reg.boxes).some((b) => Object.values(b.files).some((f) => f.sha256 === null));
    // Once every hash is refreshed from the corpus the shipped register stops being
    // LOST; this case then asserts what it should: the fixture's hashes are not the
    // real ones, so the real register reads the fixture as drift.
    assert.equal(r.status, unmeasured ? 2 : 1, r.stderr);
  });

  test('an unreadable manifest source is COVERAGE LOST (2)', () => {
    const r = run('--register', FIX_REGISTER, '--manifest', FIX_ABSENT, '--now', NOW);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /COVERAGE LOST — box_config_manifest could not be read/);
  });

  test('with no fixture and no Cloudflare credentials, D1 is not read and it exits 2', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--register', FIX_REGISTER, '--now', NOW], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /CLOUDFLARE_API_TOKEN/);
  });
});

// CodeQL alert 584 (js/file-access-to-http) is dispositioned by-design in
// tooling/ci/codeql-dispositions.json on the ground that the host is a literal
// and the file supplies only a UUID. These cases are what make that reason true.
describe('the D1 read — a database_id from the file is refused unless it is a UUID', () => {
  const ENV = { CLOUDFLARE_API_TOKEN: 'test-token', CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef' };
  const GOOD = '0a36d6a0-c909-40aa-853e-970de3482321';
  const stubFetch = () => {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ success: true, result: [{ results: [] }] }) };
    };
    return { calls, impl };
  };

  test('GREEN CONTROL: a UUID id reaches api.cloudflare.com exactly once, as a SELECT', async () => {
    const { calls, impl } = stubFetch();
    const rows = await readRows({ env: ENV, dbId: GOOD, fetchImpl: impl });
    assert.deepEqual(rows, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${ENV.CLOUDFLARE_ACCOUNT_ID}/d1/database/${GOOD}/query`);
    assert.match(JSON.parse(calls[0].init.body).sql, /^SELECT /);
  });

  test('🔴 RED CONTROL: a non-UUID id (x/../../user) is refused as CouldNotLook and NO fetch is made', async () => {
    const { calls, impl } = stubFetch();
    await assert.rejects(readRows({ env: ENV, dbId: 'x/../../user', fetchImpl: impl }), (e) => {
      assert.ok(e instanceof CouldNotLook, String(e));
      assert.match(e.message, /is not a UUID/);
      return true;
    });
    assert.equal(calls.length, 0);
  });

  test('d1QueryUrl refuses every non-UUID shape, and accepts the id the real wrangler config carries', () => {
    for (const bad of ['x/../../user', '', null, 42, `${GOOD}/../x`, `${GOOD}?q=1`, GOOD.replace(/-/g, '')]) {
      assert.throws(() => d1QueryUrl(ENV.CLOUDFLARE_ACCOUNT_ID, bad), CouldNotLook, String(bad));
    }
    const wrangler = readFileSync(join(REPO, 'services/platform/wrangler.jsonc'), 'utf8');
    const ids = [...wrangler.matchAll(/"database_id":\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(ids.length > 0, 'the real wrangler config carries no database_id');
    for (const id of ids) assert.match(d1QueryUrl(ENV.CLOUDFLARE_ACCOUNT_ID, id), /^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\//);
  });
});

describe('judgeDrift — every limb', () => {
  const register = { maxPostAgeHours: 50, boxes: { boxc: { files: { compose: { sha256: H('a') }, tunnel: { sha256: H('b') } } } } };
  const nowMs = Date.parse(NOW);
  const row = (manifest, posted_at = '2026-10-01T05:00:00Z') => ({ box: 'boxc', manifest: JSON.stringify(manifest), posted_at });

  test('clean', () => {
    assert.deepEqual(judgeDrift(register, [row({ compose: H('a'), tunnel: H('b') })], nowMs).findings, []);
  });
  test('NO ROW — the box never posted', () => {
    assert.match(judgeDrift(register, [], nowMs).findings.join('\n'), /boxc: NO ROW/);
  });
  test('STALE — the cron stopped', () => {
    const f = judgeDrift(register, [row({ compose: H('a'), tunnel: H('b') }, '2026-09-28T00:00:00Z')], nowMs).findings;
    assert.match(f.join('\n'), /boxc: STALE — the newest post is 84\.0h old/);
  });
  test('MISSING — a declared file the box no longer sends', () => {
    assert.match(judgeDrift(register, [row({ compose: H('a') })], nowMs).findings.join('\n'), /boxc\/tunnel: MISSING/);
  });
  test('UNDECLARED — a file the box sends that nobody vendored', () => {
    const f = judgeDrift(register, [row({ compose: H('a'), tunnel: H('b'), extra: H('c') })], nowMs).findings;
    assert.match(f.join('\n'), /boxc\/extra: UNDECLARED/);
  });
  test('a manifest that is not a JSON object is a finding, not a crash', () => {
    const f = judgeDrift(register, [{ box: 'boxc', manifest: '{nope', posted_at: '2026-10-01T05:00:00Z' }], nowMs).findings;
    assert.match(f.join('\n'), /not a JSON object/);
  });
});

describe('readRegister', () => {
  test('a box with no declared file, and a null hash, are each LOST', () => {
    const dir = mkdtempSync(join(tmpdir(), 'box-reg-'));
    try {
      const p = join(dir, 'r.json');
      writeFileSync(p, JSON.stringify({ maxPostAgeHours: 50, boxes: { boxb: { files: {} }, boxc: { files: { compose: { sha256: null } } } } }));
      const lost = readRegister(p).lost.join('\n');
      assert.match(lost, /boxb declares no file/);
      assert.match(lost, /boxc\/compose carries no vendored sha256/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('no box at all is LOST', () => {
    const dir = mkdtempSync(join(tmpdir(), 'box-reg-'));
    try {
      const p = join(dir, 'r.json');
      writeFileSync(p, JSON.stringify({ maxPostAgeHours: 50, boxes: {} }));
      assert.match(readRegister(p).lost.join('\n'), /declares no box/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ⏱ 2026-10-03 · ops-watch 37103985999. Both boxes read NO ROW on main because
// their cron needs a box-scoped secret, an owner step. `firstDue` lifts NO ROW
// alone, until a date, and nothing else: each case below has its red beside it.
describe('firstDue — the NO ROW bootstrap, and nothing else', () => {
  const DUE = '2026-10-10T00:00:00Z';
  const BEFORE = '2026-10-03T12:00:00Z';
  const WHY = 'the owner creates the box-scoped secret and installs the box cron';
  const reg = (files = { compose: { vendored: 'c.yml', sha256: H('a') } }, extra = {}) => ({
    maxPostAgeHours: 50,
    boxes: { boxc: { firstDue: DUE, firstDueWhy: WHY, files, ...extra } },
  });
  function cli(register, rows, now) {
    const dir = mkdtempSync(join(tmpdir(), 'box-due-'));
    try {
      writeFileSync(join(dir, 'r.json'), JSON.stringify(register));
      writeFileSync(join(dir, 'm.json'), JSON.stringify(rows));
      return run('--register', join(dir, 'r.json'), '--manifest', join(dir, 'm.json'), '--now', now);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const NO_ROW_LINE = 'boxc: NO ROW — the box has never posted its config hashes (is the cron installed, and can it reach the Worker?)';

  test('no row + firstDue in the FUTURE exits 0, the NO ROW line printed in full as KNOWN-PENDING', () => {
    const r = cli(reg(), [], BEFORE);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`⬜ KNOWN-PENDING — ${NO_ROW_LINE} NOT YET DUE: firstDue is ${DUE}, 156.0h from now — ${WHY}`), r.stdout);
    assert.match(r.stdout, /no finding — 1 line\(s\) KNOWN-PENDING, NOT YET DUE/);
    assert.doesNotMatch(r.stdout, /every declared box posted/, 'a pending box was compared with nothing, so the all-clear line must not print');
    assert.doesNotMatch(r.stderr, /✗/);
  });

  test('🔴 RED CONTROL: no row + firstDue PASSED exits 1 — the same line, now a finding that says why', () => {
    const r = cli(reg(), [], '2026-10-10T00:00:01Z');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`✗ ${NO_ROW_LINE}; its firstDue (${DUE}) has PASSED, so it gates nothing`), r.stderr);
    assert.doesNotMatch(r.stdout, /KNOWN-PENDING/);
  });

  test('🔴 a box that HAS posted is graded in full before firstDue: a drifted hash exits 1', () => {
    const posted = (compose) => [{ box: 'boxc', manifest: { compose }, posted_at: '2026-10-03T05:00:00Z' }];
    const red = cli(reg(), posted(H('f')), BEFORE);
    assert.equal(red.status, 1, red.stdout + red.stderr);
    assert.match(red.stderr, /boxc\/compose: DRIFT — live ffffffffffff… ≠ vendored aaaaaaaaaaaa…/);
    assert.match(red.stdout, /boxc: has posted and every entry carries a hash, so its firstDue \("2026-10-10T00:00:00Z"\) gates nothing — delete the field/);
    // Green control: the same post with the vendored hash is clean, so the red above is the drift.
    const green = cli(reg(), posted(H('a')), BEFORE);
    assert.equal(green.status, 0, green.stdout + green.stderr);
    assert.match(green.stdout, /every declared box posted within 50h/);
  });

  // ⏱ 2026-10-03 (lead 7185eb): Box C's override in the corpus is stale and its
  // compose was never vendored, so both stay null until a Private re-vendor —
  // and the box's firstDue holds them, on the same four bounds as NO ROW.
  const LOST_LINE = 'COVERAGE LOST — boxc/override carries no vendored sha256 yet (refresh it with --refresh-vendored from the corpus)';
  const half = { compose: { vendored: 'c.yml', sha256: H('a') }, override: { vendored: 'o.yml', sha256: null } };
  const postedC = (files) => [{ box: 'boxc', manifest: files, posted_at: '2026-10-03T05:00:00Z' }];

  test('a null vendored hash on a box INSIDE its firstDue is KNOWN-PENDING, printed in full, exit 0; the hashed entry is still compared', () => {
    const r = cli(reg(half), postedC({ compose: H('a'), override: H('9') }), BEFORE);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`⬜ KNOWN-PENDING — ${LOST_LINE} NOT YET DUE: boxc's firstDue is ${DUE}, 156.0h from now — ${WHY}`), r.stdout);
    assert.match(r.stdout, /✓ boxc\/compose: live = vendored aaaaaaaaaaaa…/);
    assert.doesNotMatch(r.stdout, /has posted and every entry carries a hash/, 'the firstDue still holds the null entry, so it must not be called spent');
    assert.doesNotMatch(r.stderr, /✗/);
  });

  test('🔴 the same null hash once firstDue has PASSED is COVERAGE LOST again, exit 2', () => {
    const r = cli(reg(half), postedC({ compose: H('a'), override: H('9') }), '2026-10-10T00:00:00Z');
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`✗ ${LOST_LINE}; boxc: its firstDue (${DUE}) has PASSED, so it gates nothing`), r.stderr);
    assert.doesNotMatch(r.stdout, /KNOWN-PENDING/);
  });

  test('🔴 a null hash on a box with NO firstDue is COVERAGE LOST, exit 2 — the bootstrap is per box, never global', () => {
    const register = { maxPostAgeHours: 50, boxes: { boxc: { files: half }, boxb: { firstDue: DUE, firstDueWhy: WHY, files: { tunnel: { vendored: 't', sha256: H('b') } } } } };
    const r = cli(register, [...postedC({ compose: H('a'), override: H('9') }), { box: 'boxb', manifest: { tunnel: H('b') }, posted_at: '2026-10-03T05:00:00Z' }], BEFORE);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(`✗ ${LOST_LINE}`), r.stderr);
    assert.doesNotMatch(r.stdout, /KNOWN-PENDING — COVERAGE LOST/);
  });

  test('🔴 inside firstDue, a HASHED entry that drifted beside a pending null one still exits 1', () => {
    const r = cli(reg(half), postedC({ compose: H('f'), override: H('9') }), BEFORE);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /boxc\/compose: DRIFT/);
    assert.match(r.stdout, /KNOWN-PENDING — COVERAGE LOST — boxc\/override/);
  });

  test('🔴 a register-level LOST (a box that declares no file) is never pending, inside firstDue or not', () => {
    const r = cli({ maxPostAgeHours: 50, boxes: { boxc: { firstDue: DUE, firstDueWhy: WHY, files: {} } } }, [], BEFORE);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /✗ COVERAGE LOST — boxc declares no file/);
  });

  test('firstDueVerdict — bounded four ways, and a malformed date gates nothing', () => {
    const at = (iso) => Date.parse(iso);
    assert.deepEqual(firstDueVerdict({ files: {} }, at(BEFORE)), {}, 'no firstDue, no bootstrap');
    assert.equal(firstDueVerdict({ firstDue: DUE, firstDueWhy: WHY }, at(DUE) - 3_600_000).notYetDue, true);
    assert.match(firstDueVerdict({ firstDue: DUE, firstDueWhy: WHY }, at(DUE)).problem, /has PASSED/, 'from THAT instant, not after it');
    assert.match(firstDueVerdict({ firstDue: '2026-10-10', firstDueWhy: WHY }, at(BEFORE)).problem, /not an ISO instant/);
    assert.match(firstDueVerdict({ firstDue: 'soon', firstDueWhy: WHY }, at(BEFORE)).problem, /not an ISO instant/);
    assert.match(firstDueVerdict({ firstDue: DUE }, at(BEFORE)).problem, /carries no firstDueWhy/);
    assert.match(firstDueVerdict({ firstDue: DUE, firstDueWhy: 'later' }, at(BEFORE)).problem, /carries no firstDueWhy/);
    const far = new Date(at(BEFORE) + (FIRST_DUE_MAX_DAYS + 1) * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z');
    assert.match(firstDueVerdict({ firstDue: far, firstDueWhy: WHY }, at(BEFORE)).problem, new RegExp(`past the ${FIRST_DUE_MAX_DAYS}-day bound`));
    // And a refused firstDue leaves NO ROW red, with the reason on the line.
    const f = judgeDrift({ maxPostAgeHours: 50, boxes: { boxc: { firstDue: far, firstDueWhy: WHY, files: { compose: { sha256: H('a') } } } } }, [], at(BEFORE));
    assert.equal(f.pending.length, 0);
    assert.match(f.findings.join('\n'), /boxc: NO ROW .*past the 14-day bound/);
  });

  test('the SHIPPED register: each firstDue is an owner-step bootstrap, and every hash came from a vendored path', () => {
    const shipped = JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8'));
    for (const [box, decl] of Object.entries(shipped.boxes)) {
      if (decl.firstDue !== undefined) {
        assert.equal(firstDueVerdict(decl, Date.parse(decl.firstDue) - 3_600_000).notYetDue, true, `${box}: its firstDue must lift NO ROW before its instant`);
        assert.match(decl.firstDueWhy, /OWNER/, `${box}: the why names the owner step`);
        assert.ok(decl.firstDueWhy.includes(`BOX_MANIFEST_SECRET_${box.toUpperCase()}`), `${box}: the why names the box's own secret`);
      }
      for (const [name, f] of Object.entries(decl.files)) {
        // A hash with no vendored path was typed, not refreshed. A null hash is a
        // bootstrap state, so only a box with a firstDue may carry one.
        if (f.vendored === null) assert.equal(f.sha256, null, `${box}/${name}: a hash with no vendored path stands in for a file the corpus does not hold`);
        if (f.sha256 === null) assert.ok(decl.firstDue !== undefined, `${box}/${name}: a null hash on a box with no firstDue — run --refresh-vendored against the corpus`);
        else assert.match(f.sha256, /^[0-9a-f]{64}$/, `${box}/${name}`);
      }
    }
  });
});

describe('--refresh-vendored — writes what the corpus holds, nulls what it does not', () => {
  function world(files, corpus) {
    const dir = mkdtempSync(join(tmpdir(), 'box-refresh-'));
    const reg = join(dir, 'r.json');
    const corpusDir = join(dir, 'corpus');
    mkdirSync(corpusDir);
    for (const [rel, body] of Object.entries(corpus)) writeFileSync(join(corpusDir, rel), body);
    writeFileSync(reg, JSON.stringify({ maxPostAgeHours: 50, boxes: { boxc: { files } } }));
    const go = () => run('--register', reg, '--refresh-vendored', corpusDir);
    return { reg, go, read: () => JSON.parse(readFileSync(reg, 'utf8')).boxes.boxc.files, raw: () => readFileSync(reg, 'utf8'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }
  const sha = (s) => createHash('sha256').update(s).digest('hex');

  test('GREEN CONTROL: every vendored file present writes every hash, exit 0', () => {
    const w = world({ override: { vendored: 'o.yml', sha256: null } }, { 'o.yml': 'services: {}\n' });
    try {
      const r = w.go();
      assert.equal(r.status, 0, r.stderr);
      assert.equal(w.read().override.sha256, sha('services: {}\n'));
    } finally {
      w.cleanup();
    }
  });

  test('🔴 a file the corpus does not hold is written NULL (never a stale hash) and named, exit 2; the rest are written', () => {
    const w = world(
      { override: { vendored: 'o.yml', sha256: null }, tunnel: { vendored: 'gone.yml', sha256: H('e') }, compose: { vendored: null, sha256: null } },
      { 'o.yml': 'x: 1\n' },
    );
    try {
      const r = w.go();
      assert.equal(r.status, 2, r.stdout + r.stderr);
      const f = w.read();
      assert.equal(f.override.sha256, sha('x: 1\n'));
      assert.equal(f.tunnel.sha256, null, 'the old hash of a file that is gone must not survive the refresh');
      assert.equal(f.compose.sha256, null);
      assert.match(r.stderr, /boxc\/tunnel: vendored path "gone\.yml" does not exist/);
      assert.match(r.stderr, /boxc\/compose: vendored path null does not exist/);
      assert.match(r.stderr, /1 hash\(es\) written, 2 entr\(ies\) the corpus does not hold/);
    } finally {
      w.cleanup();
    }
  });

  test('🔴 a corpus dir where NOTHING resolves writes nothing — the dir is wrong, not the register', () => {
    const w = world({ override: { vendored: 'o.yml', sha256: H('d') } }, {});
    try {
      const before = w.raw();
      const r = w.go();
      assert.equal(r.status, 2);
      assert.match(r.stderr, /NOT WRITTEN — no declared entry resolved/);
      assert.equal(w.raw(), before);
    } finally {
      w.cleanup();
    }
  });
});

describe('post-config-manifest.sh — what the box SENDS (a stub curl, no network)', { skip: process.platform === 'win32' }, () => {
  const BOX_SCRIPT = join(REPO, 'tooling/ops/boxes/post-config-manifest.sh');

  function world({ status = '204', listExtra = '' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'box-sh-'));
    const compose = join(dir, 'docker-compose.yml');
    writeFileSync(compose, 'services: {}\n');
    const secret = join(dir, 'secret');
    writeFileSync(secret, 'the-box-secret');
    writeFileSync(join(dir, 'conf'), `BOX=boxc\nENDPOINT=https://platform.example.test/v1/ops/box-manifest\nSECRET_FILE=${secret}\n`);
    writeFileSync(join(dir, 'list'), `# logical path\ncompose ${compose}\n${listExtra}`);
    // The stub records its argv and the header file's content, then prints the status.
    const bin = join(dir, 'bin');
    spawnSync('mkdir', [bin]);
    writeFileSync(
      join(bin, 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv"\nfor a in "$@"; do case "$a" in @*) cat "\${a#@}" > "${dir}/hdr";; esac; done\nprintf '${status}'\n`,
    );
    chmodSync(join(bin, 'curl'), 0o755);
    const go = () =>
      spawnSync('sh', [BOX_SCRIPT], {
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BOX_MANIFEST_CONF: join(dir, 'conf'), BOX_MANIFEST_FILES: join(dir, 'list') },
      });
    return { dir, compose, go, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  test('posts {box, files:{name: sha256}} with the secret in a HEADER FILE, never in argv', () => {
    const w = world();
    try {
      const r = w.go();
      assert.equal(r.status, 0, r.stderr);
      const argv = readFileSync(join(w.dir, 'argv'), 'utf8');
      const sum = createHash('sha256').update(readFileSync(w.compose)).digest('hex');
      assert.ok(argv.includes(JSON.stringify({ box: 'boxc', files: { compose: sum } })), argv);
      assert.ok(!argv.includes('the-box-secret'), 'the secret reached curl argv');
      assert.equal(readFileSync(join(w.dir, 'hdr'), 'utf8'), 'Authorization: Bearer the-box-secret\n');
    } finally {
      w.cleanup();
    }
  });

  test('a refusal from the Worker exits 1', () => {
    const w = world({ status: '401' });
    try {
      assert.equal(w.go().status, 1);
    } finally {
      w.cleanup();
    }
  });

  test('a LISTED file that is missing exits 2 and sends nothing — never a silently shorter manifest', () => {
    const w = world({ listExtra: 'tunnel /nonexistent/cloudflared/config.yml\n' });
    try {
      const r = w.go();
      assert.equal(r.status, 2);
      assert.match(r.stderr, /listed file 'tunnel' is missing/);
      assert.throws(() => readFileSync(join(w.dir, 'argv')));
    } finally {
      w.cleanup();
    }
  });
});
