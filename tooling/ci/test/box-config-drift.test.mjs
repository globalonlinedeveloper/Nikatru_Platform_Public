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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { judgeDrift, readRegister, REGISTER_REL } from '../../ops/check-box-config-drift.mjs';

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
    const r = run('--manifest', FIX_CLEAN, '--now', NOW);
    const reg = JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8'));
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
