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

/** The payments registry limb 5 reads: razorpay declares checkout with nothing pending unless told otherwise. */
function payments({ checkout = true, pending = [] } = {}) {
  return {
    adapters: [{ id: 'razorpay', capabilities: checkout ? ['verify', 'parse', 'checkout', 'cancel'] : ['verify'] }],
    conformance: { pending: pending.map((c) => ({ adapter: 'razorpay', case: c, row: 'O-RAZORPAY-CHECKOUT-ADAPTER' })) },
  };
}

/** The duty matrix limb 5 reads: the GST invoice duty, owner-gated when `gate` is set. */
function duties(gate = null) {
  return { duties: [{ id: 'india-seller-issues-gst-tax-invoice', status: gate ? 'owner-gated' : 'implemented', ...(gate ? { ownerItem: gate } : {}) }] };
}

function run({ list = checklist(), cfg = config(false), evidence = true, reg = register(), pay = payments(), duty = duties() } = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  if (list !== null) write(root, 'tooling/paywall-flip.json', JSON.stringify(list));
  if (pay !== null) write(root, 'tooling/ports/payments.json', JSON.stringify(pay));
  if (duty !== null) write(root, 'tooling/legal/duty-matrix.json', JSON.stringify(duty));
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

  // ⏱ 2026-10-01 · fix-india-rail-tax-data (AB-M1-02, train P45): the India rail is a flip precondition.
  test('the REAL checklist names the Razorpay adapter as an OPEN precondition for every app', () => {
    const row = REAL_CHECKLIST.preconditions.find((p) => p.id === 'RAZORPAY-CHECKOUT-ADAPTER');
    assert.ok(row, 'RAZORPAY-CHECKOUT-ADAPTER is missing from tooling/paywall-flip.json');
    assert.equal(row.open, true);
    assert.deepEqual(row.apps, ['*']);
  });

  test('🔴 FAILS with the paywall on while RAZORPAY-CHECKOUT-ADAPTER is open', () => {
    const r = run({ list: checklist(['RAZORPAY-CHECKOUT-ADAPTER']), cfg: config(true) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /turns the paywall ON for subscriptiontracker while the precondition RAZORPAY-CHECKOUT-ADAPTER is OPEN/);
  });

  test('FAILS a checklist that DELETED RAZORPAY-CHECKOUT-ADAPTER instead of closing it', () => {
    const list = checklist();
    list.preconditions = list.preconditions.filter((p) => p.id !== 'RAZORPAY-CHECKOUT-ADAPTER');
    const r = run({ list });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has lost the precondition RAZORPAY-CHECKOUT-ADAPTER/);
  });

  test('🔴 FAILS RAZORPAY-CHECKOUT-ADAPTER closed while razorpay declares no checkout', () => {
    const r = run({ pay: payments({ checkout: false }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /razorpay declares no `checkout`/);
  });

  test('🔴 FAILS RAZORPAY-CHECKOUT-ADAPTER closed while a razorpay conformance case is pending', () => {
    const r = run({ pay: payments({ pending: ['refund revokes'] }) });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries 1 pending razorpay case\(s\): refund revokes/);
  });

  // ⏱ 2026-10-02 · PR #1149 ruling item 2: the REAL registry keeps the refund's payment → subscription
  // link pending until a real test-mode refund proves it, so closing the row on today's tree is red even
  // with the GST duty implemented. Deleting that pending entry from payments.json reddens THIS test.
  test('🔴 the REAL payments registry keeps limb 5 red: razorpay `refund revokes` is pending on O-RAZORPAY-CHECKOUT-ADAPTER', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'ports', 'payments.json'), 'utf8'));
    const r = run({ pay: real });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /RAZORPAY-CHECKOUT-ADAPTER is closed, but tooling\/ports\/payments\.json carries 1 pending razorpay case\(s\): refund revokes/);
  });

  test('the REAL duty matrix holds the GST invoice duty owner-gated on Q13', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'tooling', 'legal', 'duty-matrix.json'), 'utf8'));
    const row = real.duties.find((d) => d.id === 'india-seller-issues-gst-tax-invoice');
    assert.ok(row, 'tooling/legal/duty-matrix.json has no india-seller-issues-gst-tax-invoice row');
    assert.equal(row.status, 'owner-gated');
    assert.equal(row.ownerItem, 'Q13');
  });

  test('🔴 FAILS RAZORPAY-CHECKOUT-ADAPTER closed while the GST invoice duty is owner-gated (Q13)', () => {
    const r = run({ duty: duties('Q13') });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /india-seller-issues-gst-tax-invoice is still owner-gated \(Q13\)/);
  });

  test('🔴 FAILS RAZORPAY-CHECKOUT-ADAPTER closed while the duty matrix has no GST invoice row', () => {
    const r = run({ duty: { duties: [] } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no india-seller-issues-gst-tax-invoice row/);
  });

  test('COVERAGE LOST (exit 2) when RAZORPAY-CHECKOUT-ADAPTER is closed and the registry has no razorpay adapter', () => {
    const r = run({ pay: { adapters: [], conformance: { pending: [] } } });
    assert.equal(r.code, 2, r.out);
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
