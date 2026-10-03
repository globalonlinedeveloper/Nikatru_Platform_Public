// ─────────────────────────────────────────────────────────────────────────────
// offers.test.mjs — assert-offers.mjs must be able to FAIL (lane growth-codes,
// O-DISCOUNT-FLOOR-UNGUARDED). Every red case MUTATES THE REAL INPUTS (the real
// register, prices, fee cells, AI port, meter, channel register and Dart map,
// read by `inputsAt`) one field at a time, after a green control on the same
// inputs — a fixture written for the test would agree with whatever
// misunderstanding wrote it.
//
// Run:  node --test tooling/ci/test/offers.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, inputsAt, netUsd, OFFERS, DART_MECHANISMS } from '../assert-offers.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-offers.mjs');

const real = () => structuredClone(inputsAt(REPO));
const offerOf = (inputs, id) => inputs.offers.offers.find((o) => o.id === id);

describe('assert-offers — never below cost, never free AI, every channel decided', () => {
  test('GREEN CONTROL — the real inputs pass, and the floor actually compared something', () => {
    const r = check(real());
    assert.deepEqual(r.lost, []);
    assert.deepEqual(r.problems, []);
    assert.ok(r.notes.some((n) => /discount\/rail pair\(s\) floored/.test(n) && !/ 0 discount/.test(n)), r.notes.join('\n'));
  });

  test('🔴 a discount below cost FAILS — 90% off the monthly plan', () => {
    const i = real();
    offerOf(i, 'st-monthly-20-off-3').percentOff = 90;
    const r = check(i);
    assert.ok(r.problems.some((p) => /st-monthly-20-off-3: BELOW COST on `paddle`/.test(p)), r.problems.join('\n'));
  });

  test('🔴 a win-back below the floor FAILS', () => {
    const i = real();
    offerOf(i, 'st-winback-monthly-40-off-2').percentOff = 85;
    const r = check(i);
    assert.ok(r.problems.some((p) => /st-winback-monthly-40-off-2: BELOW COST/.test(p)), r.problems.join('\n'));
  });

  test('🔴 the AI allowance is part of the cost: a discount that clears infra alone fails once AI is counted', () => {
    const i = real();
    const o = offerOf(i, 'st-monthly-20-off-3');
    o.rails = ['paddle'];
    // Find a discount that nets between the infra cost and infra + AI.
    const infra = i.offers.cost.infraUsdPerUserMonth.value;
    let pct = 99;
    while (pct > 1 && netUsd(5.99 * (1 - pct / 100), { pct: 0.05, fixed: 0.5 }, 0.27) < infra + 0.05) pct--;
    o.percentOff = pct;
    o.carriesAi = false;
    assert.deepEqual(check(i).problems, [], 'green without AI');
    o.carriesAi = true;
    assert.ok(check(i).problems.some((p) => /BELOW COST/.test(p) && /\+ AI /.test(p)));
  });

  test('🔴 a free month carrying an AI allowance FAILS', () => {
    const i = real();
    offerOf(i, 'st-free-month').aiAllowance = 5;
    const r = check(i);
    assert.ok(r.problems.some((p) => /st-free-month: a free-month carries an AI allowance/.test(p)), r.problems.join('\n'));
  });

  test('🔴 an invite reward carrying an AI allowance FAILS', () => {
    const i = real();
    offerOf(i, 'st-invite').aiAllowance = 1;
    assert.ok(check(i).problems.some((p) => /st-invite: a invite carries an AI allowance/.test(p)));
  });

  test('🔴 `promo_code` counted as a receipt source FAILS — a free grant could then buy AI', () => {
    const i = real();
    i.bundle.bundleSources.find((s) => s.source === 'promo_code').requiresReceipt = true;
    assert.ok(check(i).problems.some((p) => /promo_code` requires a receipt/.test(p)));
  });

  test('🔴 a MISSING channel capability row FAILS', () => {
    const i = real();
    i.offers.channels = i.offers.channels.filter((c) => c.channel !== 'linux-snap');
    assert.ok(check(i).problems.some((p) => /channel `linux-snap` has NO capability row/.test(p)));
  });

  test('🔴 an own-code field on an App Store channel FAILS', () => {
    const i = real();
    Object.assign(i.offers.channels.find((c) => c.channel === 'ios-appstore'), { mechanism: 'own-code', ownCodeField: true });
    assert.ok(check(i).problems.some((p) => /`ios-appstore` is billed by apple-iap; an own-code field there is steering/.test(p)));
  });

  test('🔴 the Dart map disagreeing with the register FAILS (an App Store build would render the field)', () => {
    const i = real();
    i.dartText = i.dartText.replace("'ios-appstore': RedeemMechanism.appleOfferCode,", "'ios-appstore': RedeemMechanism.ownCode,");
    assert.ok(check(i).problems.some((p) => /`ios-appstore` is RedeemMechanism\.ownCode, the register says apple-offer-code/.test(p)));
  });

  test('🔴 a code policy under 80 bits FAILS', () => {
    const i = real();
    i.offers.codePolicy.length = 10;
    assert.ok(check(i).problems.some((p) => /carry 50\.0 bits, under 80/.test(p)));
  });

  test('COVERAGE LOST (exit 2) when the prices cannot be read — never a pass over nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'nikatru-offers-'));
    for (const rel of [OFFERS, 'tooling/catalog/fee-register.json', 'tooling/ports/ai.json', 'services/platform/src/lib/ai/meter.ts', 'tooling/channel-register.json', 'contracts/entitlement/bundle.json', DART_MECHANISMS]) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      cpSync(join(REPO, rel), join(root, rel));
    }
    const prices = 'services/platform/src/app-config-data.json';
    mkdirSync(join(root, dirname(prices)), { recursive: true });
    const cfg = JSON.parse(readFileSync(join(REPO, prices), 'utf8'));
    writeFileSync(join(root, prices), JSON.stringify(cfg));
    const green = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(green.status, 0, green.stdout + green.stderr);
    delete cfg.prices;
    writeFileSync(join(root, prices), JSON.stringify(cfg));
    const lost = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(lost.status, 2, lost.stdout + lost.stderr);
    assert.match(lost.stderr, /COVERAGE LOST — assert-offers: .*no discount offer was floored/);
  });
});
