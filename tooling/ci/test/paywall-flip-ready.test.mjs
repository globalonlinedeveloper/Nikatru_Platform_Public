// ─────────────────────────────────────────────────────────────────────────────
// paywall-flip-ready.test.mjs — assert-paywall-flip-ready.mjs must be able to FAIL.
//
// ⏱ 2026-09-29 · AB-M2-01. The red control the finding named: a fixture that sets
// `paywall.enabled: true` while the T-11 precondition is open exits 1; the same
// tree with the paywall off exits 0.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-paywall-flip-ready.mjs');
const REAL_CHECKLIST = JSON.parse(readFileSync(join(REPO, 'tooling', 'paywall-flip.json'), 'utf8'));

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-flip-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

function write(root, rel, body) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

/** Every precondition closed on one evidence file the fixture writes, except those named open. */
function checklist(openIds = []) {
  return {
    preconditions: REAL_CHECKLIST.preconditions.map((r) =>
      openIds.includes(r.id)
        ? { id: r.id, what: r.what, apps: r.apps, open: true }
        : { id: r.id, what: r.what, apps: r.apps, open: false, verify: ['evidence.txt'] },
    ),
  };
}

function config(enabled) {
  return {
    defaults: { paywall: { enabled: false, offerings: [] } },
    apps: { subscriptiontracker: { paywall: { enabled, offerings: [] } } },
  };
}

/** The channel register limb 4 reads for EXT-SIGN-IN: one extension row, which can sign in unless `signIn` is false. */
function register(signIn = true) {
  return {
    channels: [
      { id: 'web', surface: 'app' },
      { id: 'amo', surface: 'extension', extensionRedirectUri: signIn ? 'https://0123456789abcdef0123456789abcdef01234567.extensions.allizom.org/' : null },
    ],
  };
}

function run({ list = checklist(), cfg = config(false), evidence = true, reg = register() } = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  if (list !== null) write(root, 'tooling/paywall-flip.json', JSON.stringify(list));
  if (reg !== null) write(root, 'tooling/channel-register.json', JSON.stringify(reg));
  if (cfg !== null) write(root, 'services/platform/src/app-config-data.json', JSON.stringify(cfg));
  if (evidence) write(root, 'evidence.txt', 'proof');
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('assert-paywall-flip-ready', () => {
  test('the REAL tree passes: every paywall is off', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });

  test('PASSES with the paywall OFF while T-11 is open', () => {
    const r = run({ list: checklist(['T-11']) });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 open \(T-11\)/);
  });

  test('🔴 FAILS with paywall.enabled=true while T-11 is open', () => {
    const r = run({ list: checklist(['T-11']), cfg: config(true) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /turns the paywall ON for subscriptiontracker while the precondition T-11 is OPEN/);
  });

  test('a paywall turned on through `defaults` is caught too', () => {
    const cfg = { defaults: { paywall: { enabled: true } }, apps: { subscriptiontracker: {} } };
    const r = run({ list: checklist(['T-11']), cfg });
    assert.equal(r.code, 1, r.out);
  });

  test('PASSES with the paywall on once every precondition is closed with evidence', () => {
    const r = run({ cfg: config(true) });
    assert.equal(r.code, 0, r.out);
  });

  test('FAILS a closed precondition whose evidence does not exist', () => {
    const r = run({ evidence: false });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /closed on evidence that does not exist/);
  });

  test('FAILS a checklist that DELETED a precondition instead of closing it', () => {
    const list = checklist();
    list.preconditions = list.preconditions.filter((r) => r.id !== 'T-11');
    const r = run({ list });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has lost the precondition T-11/);
  });

  // ⏱ 2026-10-01 · #1117 review 1: what an extension needs before it is sold.
  test('🔴 FAILS with the FullShot paywall on while EXT-SIGN-IN is open, and only for FullShot', () => {
    const cfg = { defaults: { paywall: { enabled: false } }, apps: { subscriptiontracker: { paywall: { enabled: true } }, fullshot: { paywall: { enabled: true } } } };
    const r = run({ list: checklist(['EXT-SIGN-IN']), cfg });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /turns the paywall ON for fullshot while the precondition EXT-SIGN-IN is OPEN/);
    assert.doesNotMatch(r.out, /for subscriptiontracker while the precondition EXT-SIGN-IN/);
  });

  test('🔴 FAILS EXT-SIGN-IN closed while every extension channel has a null extensionRedirectUri', () => {
    const r = run({ reg: register(false) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /EXT-SIGN-IN is closed, but every extension channel in tooling\/channel-register\.json \(amo\) has a null extensionRedirectUri/);
  });

  test('COVERAGE LOST (exit 2) when EXT-SIGN-IN is closed and the register names no extension channel', () => {
    const r = run({ reg: { channels: [{ id: 'web', surface: 'app' }] } });
    assert.equal(r.code, 2, r.out);
  });

  test('FAILS a checklist that DELETED EXT-CANCEL instead of closing it', () => {
    const list = checklist();
    list.preconditions = list.preconditions.filter((p) => p.id !== 'EXT-CANCEL');
    const r = run({ list });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has lost the precondition EXT-CANCEL/);
  });

  test('COVERAGE LOST (exit 2) when the checklist is absent', () => {
    const r = run({ list: null });
    assert.equal(r.code, 2, r.out);
  });

  test('COVERAGE LOST (exit 2) when the config declares no app', () => {
    const r = run({ cfg: { defaults: { paywall: { enabled: false } }, apps: {} } });
    assert.equal(r.code, 2, r.out);
  });
});
