// ─────────────────────────────────────────────────────────────────────────────
// brick-drivers.test.mjs — the brick's two `flutter drive` drivers are app #1's,
// byte for byte (O-SCREENSHOT-DRIVER-IS-ONE-APPS, O-BRICK-STAMPS-NO-E2E-SUITE; 10b).
//
// A driver names no app: `test_driver/integration_test.dart` (the e2e run) and
// `test_driver/store_screenshots.dart` (the store capture) only write what the
// suite hands them. So the brick stamps copies, under a header, and this file
// fails the moment a copy and its source differ — in either direction, because
// a fix made to one and not the other is a fix app #2 never gets.
//
// Every case is written out by hand (assert-no-loop-cases).
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP1 = join(REPO, 'apps', 'subscriptiontracker', 'test_driver');
const BRICK = join(REPO, 'tooling', 'bricks', 'app', '__brick__', 'apps', '{{app_id}}', 'test_driver');
const HEADER_END = '// ── end of the stamp header ──\n';

/** The stamped copy's body below its header, or null when the header is missing. */
function body(text) {
  const at = text.indexOf(HEADER_END);
  return at === -1 ? null : text.slice(at + HEADER_END.length);
}

/** Whether `copy` (a stamped driver) is `source` byte for byte below its header. */
function sameDriver(copy, source) {
  const b = body(copy);
  return b !== null && b === source;
}

describe('the brick stamps app #1\'s drivers, byte for byte below a header', () => {
  test('test_driver/integration_test.dart is app #1\'s', () => {
    const copy = readFileSync(join(BRICK, 'integration_test.dart'), 'utf8');
    const source = readFileSync(join(APP1, 'integration_test.dart'), 'utf8');
    assert.ok(body(copy) !== null, 'the stamped driver has no stamp header');
    assert.equal(body(copy), source, 'the brick\'s integration_test.dart drifted from apps/subscriptiontracker\'s');
  });

  test('test_driver/store_screenshots.dart is app #1\'s', () => {
    const copy = readFileSync(join(BRICK, 'store_screenshots.dart'), 'utf8');
    const source = readFileSync(join(APP1, 'store_screenshots.dart'), 'utf8');
    assert.ok(body(copy) !== null, 'the stamped driver has no stamp header');
    assert.equal(body(copy), source, 'the brick\'s store_screenshots.dart drifted from apps/subscriptiontracker\'s');
  });
});

describe('the comparison can fail (red controls on copies, never on the tree)', () => {
  test('RED CONTROL — one changed byte in the copy is a drift', () => {
    const source = readFileSync(join(APP1, 'integration_test.dart'), 'utf8');
    const copy = readFileSync(join(BRICK, 'integration_test.dart'), 'utf8');
    assert.equal(sameDriver(copy, source), true, 'green control: the real copy matches');
    assert.equal(sameDriver(copy.replace('writeResponseOnFailure: true', 'writeResponseOnFailure: false'), source), false);
  });

  test('RED CONTROL — a fix made only in app #1 is a drift', () => {
    const source = readFileSync(join(APP1, 'store_screenshots.dart'), 'utf8');
    const copy = readFileSync(join(BRICK, 'store_screenshots.dart'), 'utf8');
    assert.equal(sameDriver(copy, `${source}// a later fix\n`), false);
  });

  test('RED CONTROL — a copy without its header is not graded as a match', () => {
    const source = readFileSync(join(APP1, 'integration_test.dart'), 'utf8');
    assert.equal(sameDriver(source, source), false);
  });
});
