// ─────────────────────────────────────────────────────────────────────────────
// small-business-program.test.mjs — assert-small-business-program.mjs must be able to FAIL.
//
// AB-M5-02: a real App Store submission is refused while
// tooling/catalog/fee-register.json `apple-small-business-enrolment` carries no
// owner-attested date (owner queue A-18). Each case copies the two registers the
// gate reads from the real tree into os.tmpdir() (ADR 072) and mutates only the copy.
//
// Run:  node --test tooling/ci/test/small-business-program.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SUBMIT_PRECONDITIONS, REAL_SUBMISSION_FLAG } from '../submit-preconditions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD_REL = 'tooling/ci/assert-small-business-program.mjs';
const GUARD = join(REPO, GUARD_REL);
const FEES = 'tooling/catalog/fee-register.json';
const CHANNELS = 'tooling/channel-register.json';
const CELL = 'apple-small-business-enrolment';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-sbp-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

function fixture(mutateCell = null) {
  const root = join(TMP, `f${++seq}`);
  for (const rel of [FEES, CHANNELS]) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  if (mutateCell) {
    const p = join(root, FEES);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    mutateCell(doc.cells[CELL], doc);
    writeFileSync(p, JSON.stringify(doc, null, 2));
  }
  return root;
}

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GUARD, ...args, ...(root ? [root] : [])], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}

const readRealCell = () => JSON.parse(readFileSync(join(REPO, FEES), 'utf8')).cells[CELL];

describe('the real tree', () => {
  test('a dry run exits 0 and says the enrolment is not recorded, naming A-18', () => {
    const r = run(null, '--for-submission=ios-appstore');
    assert.equal(r.code, 0, r.all);
    if (readRealCell().value === null) assert.match(r.out, /⬜ NOT YET ENROLLED {2}ios-appstore — .*owner step A-18/);
    else assert.match(r.out, /Small Business Program enrolled \d{4}-\d{2}-\d{2}/);
  });

  test('a bare run grades every apple-iap channel of the register', () => {
    const r = run(null);
    assert.equal(r.code, 0, r.all);
    if (readRealCell().value === null) {
      assert.match(r.out, /NOT YET ENROLLED {2}ios-appstore/);
      assert.match(r.out, /NOT YET ENROLLED {2}macos-appstore/);
    }
  });
});

describe('the gate (AB-M5-02)', () => {
  test('RED CONTROL: a real ios-appstore submission with no enrolment date is refused (exit 1)', () => {
    const root = fixture((c) => {
      c.value = null;
    });
    const r = run(root, '--for-submission=ios-appstore', '--real-submission');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /REFUSED {2}a real ios-appstore submission: .*owner step A-18/);
  });

  test('a real macos-appstore submission with no enrolment date is refused too', () => {
    const root = fixture((c) => {
      c.value = null;
    });
    const r = run(root, '--for-submission=macos-appstore', '--real-submission');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /REFUSED {2}a real macos-appstore submission/);
  });

  test('GREEN CONTROL: with the owner-attested enrolment date, the real submission passes', () => {
    const root = fixture((c) => {
      c.value = '2026-09-28';
    });
    const r = run(root, '--for-submission=ios-appstore', '--real-submission');
    assert.equal(r.code, 0, r.all);
    assert.match(r.out, /enrolled 2026-09-28: ios-appstore sell at the 15% rate/);
  });

  test('an enrolment dated in the future is exit 1', () => {
    const root = fixture((c) => {
      c.value = '2999-01-01';
    });
    const r = run(root, '--for-submission=ios-appstore');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /after today/);
  });

  test('a value that is not a date is exit 1, even on a dry run', () => {
    const root = fixture((c) => {
      c.value = true;
    });
    const r = run(root, '--for-submission=ios-appstore');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /it is null, or the enrolment date/);
  });

  test('a cell with no verify is exit 1', () => {
    const root = fixture((c) => {
      delete c.verify;
    });
    const r = run(root);
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /has no `verify`/);
  });
});

describe('COVERAGE LOST', () => {
  test('a missing cell is exit 2', () => {
    const root = fixture((c, doc) => {
      delete doc.cells[CELL];
    });
    const r = run(root, '--for-submission=ios-appstore', '--real-submission');
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COVERAGE LOST — .*carries no cells\.apple-small-business-enrolment/);
  });

  test('an absent fee register is exit 2', () => {
    const root = fixture();
    rmSync(join(root, FEES));
    const r = run(root);
    assert.equal(r.code, 2, r.all);
  });

  test('a channel that is not apple-iap is exit 2, never a pass', () => {
    const r = run(fixture(), '--for-submission=android-play', '--real-submission');
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /its purchaseRail is "play-billing", not apple-iap/);
  });

  test('an undeclared channel, or a bare --for-submission, is exit 2', () => {
    assert.equal(run(fixture(), '--for-submission=ios-nowhere').code, 2);
    assert.equal(run(fixture(), '--for-submission').code, 2);
  });

  test('a register with no apple-iap channel is exit 2', () => {
    const root = fixture();
    const p = join(root, CHANNELS);
    const reg = JSON.parse(readFileSync(p, 'utf8'));
    for (const c of reg.channels) if (c?.purchaseRail?.rail === 'apple-iap') c.purchaseRail.rail = 'none';
    writeFileSync(p, JSON.stringify(reg));
    const r = run(root);
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /declares no channel whose purchaseRail is apple-iap/);
  });
});

describe('submit-preconditions.mjs carries the gate', () => {
  test('one entry, applied by rail to every submitting apple-iap row, with the real-submission flag', () => {
    const e = SUBMIT_PRECONDITIONS.find((x) => x.guard === GUARD_REL);
    assert.ok(e, 'no SUBMIT_PRECONDITIONS entry names the gate');
    assert.equal(e.realFlag, REAL_SUBMISSION_FLAG);
    assert.notEqual(e.declaresConsole, true, 'the gate is not a console-declaration gate');
    const register = JSON.parse(readFileSync(join(REPO, CHANNELS), 'utf8'));
    const applied = register.channels.filter((row) => e.appliesTo(row, register)).map((row) => row.id).sort();
    assert.deepEqual(applied, ['ios-appstore', 'macos-appstore']);
    assert.equal(e.arg({ id: 'ios-appstore' }), '--for-submission=ios-appstore');
  });
});
