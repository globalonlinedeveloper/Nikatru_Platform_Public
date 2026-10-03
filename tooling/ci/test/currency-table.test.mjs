// ─────────────────────────────────────────────────────────────────────────────
// currency-table.test.mjs — THE ONE ISO 4217 TABLE STAYS ONE TABLE.
//
// ⏱ 2026-10-01 · lane fix-st-api-bounds (rv2-services-030, #1118 review
// finding 3). contracts/currency/iso4217.js is read by subscriptiontracker-api
// (a code not in it is a 400; `price_minor` is checked against its digits) and
// by services/platform's reminder formatter, both by import; packages/core
// reads the GENERATED Dart view. This holds the three together:
//   · the committed .g.dart is exactly what generate-dart.mjs writes (green
//     control on the REAL tree), and a hand-edit to it reds (red control);
//   · each Worker imports the table and carries no digit map of its own — the
//     platform's own map is how the two halves disagreed in the first place.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINOR_UNIT_DIGITS, isIso4217, minorUnitDigits, toMinorUnits } from '../../../contracts/currency/iso4217.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GEN = join(ROOT, 'contracts', 'currency', 'generate-dart.mjs');
const DART = join(ROOT, 'packages', 'core', 'lib', 'src', 'money', 'iso4217.g.dart');

const check = () => spawnSync(process.execPath, [GEN, '--check'], { encoding: 'utf8' });

test('green control: the committed Dart table is what iso4217.js generates', () => {
  const r = check();
  assert.equal(r.status, 0, r.stderr);
});

test('red control: a hand-edited Dart table is refused by --check', () => {
  const original = readFileSync(DART, 'utf8');
  try {
    writeFileSync(DART, original.replace("'KRW': 0,", "'KRW': 2,"));
    assert.notEqual(readFileSync(DART, 'utf8'), original, 'the mutation did not land: this control proves nothing');
    const r = check();
    assert.equal(r.status, 1, 'a drifted Dart table must red');
  } finally {
    writeFileSync(DART, original);
  }
});

test('the table is ISO’s, with the exponents the round trips depend on', () => {
  assert.ok(Object.keys(MINOR_UNIT_DIGITS).length > 150);
  assert.equal(minorUnitDigits('KRW'), 0);
  assert.equal(minorUnitDigits('BHD'), 3);
  assert.equal(minorUnitDigits('CLF'), 4);
  assert.equal(minorUnitDigits('USD'), 2);
  assert.equal(isIso4217('ZZZ'), false);
  assert.equal(isIso4217('XAU'), false, 'a code with no minor unit is not a price currency');
  assert.equal(toMinorUnits(6.49, 'JPY'), 6);
  assert.equal(toMinorUnits(19.99, 'USD'), 1999);
  assert.equal(toMinorUnits(2.5, 'BHD'), 2500);
});

test('both Workers import the table and carry no digit map of their own', () => {
  for (const rel of [
    'services/subscriptiontracker-api/src/routes/subscriptions.ts',
    'services/platform/src/lib/reminders.ts',
  ]) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(src, /from '(\.\.\/)+contracts\/currency\/iso4217\.js'/, `${rel} does not import the table`);
    assert.doesNotMatch(src, /\bKWD\s*:\s*3\b/, `${rel} restates a minor-digit row`);
  }
  const dart = readFileSync(join(ROOT, 'packages', 'core', 'lib', 'src', 'money', 'money.dart'), 'utf8');
  assert.match(dart, /iso4217MinorUnitDigits\[code\]/, 'money.dart does not read the generated table');
  assert.doesNotMatch(dart, /'KWD'\s*:\s*3/, 'money.dart restates a minor-digit row');
});
