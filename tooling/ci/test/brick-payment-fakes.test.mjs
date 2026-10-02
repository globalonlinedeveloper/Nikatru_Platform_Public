// ─────────────────────────────────────────────────────────────────────────────
// brick-payment-fakes.test.mjs — app #2 is BORN with the shared payment fakes
// and the client conformance suite (port-pay-client, pipeline-first).
//
// The brick's stamped test template (tooling/bricks/app/__brick__/apps/
// {{app_id}}/test/) must import `package:nikatru_purchases/testing.dart` — the
// FakePurchaseRail / FakeIapBridge / FakeCheckoutLauncher every rail and the
// conformance suite share — and USE one of its fakes, and must declare no hand
// fake of a client money seam: a stamped app that restates the seam in its own
// tests is how the eighteen hand fakes this train retired came to exist. The
// stamped pubspec must depend on nikatru_purchases, or the import cannot
// resolve in the app it stamps.
//
// Red control, observed red and reverted (the PR records the exit): the
// `testing.dart` import removed from the brick's chassis_properties_test.dart
// → "the stamped test template imports …" goes red.
//
// Run:  node --test tooling/ci/test/brick-payment-fakes.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from '../text-reductions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
const IMPORT = /^\s*import\s+'package:nikatru_purchases\/testing\.dart'\s*;/m;
const USES = /(?<![\w.])(?:FakePurchaseRail|FakeIapBridge|FakeCheckoutLauncher)\s*\(/;
const HAND_FAKE = /\bclass\s+(\w+)\b[^{;]*?\bimplements\b[^{;]*\b(PurchaseRail|IapBridge|CheckoutLauncher)\b[^{;]*\{/;

/** What is wrong with the brick at `root`, as sentences; empty when it is born with the suite. */
function brickProblems(root) {
  const problems = [];
  const testDir = join(root, BRICK_APP, 'test');
  const tests = readdirSync(testDir).filter((f) => f.endsWith('_test.dart')).sort();
  if (!tests.length) return [`no *_test.dart under ${BRICK_APP}/test — nothing was checked`];
  const importing = [];
  for (const f of tests) {
    const src = stripSourceComments(readFileSync(join(testDir, f), 'utf8'), '.dart');
    const fake = HAND_FAKE.exec(src);
    if (fake) problems.push(`${f} declares a hand fake \`${fake[1]}\` of \`${fake[2]}\`; use package:nikatru_purchases/testing.dart`);
    if (IMPORT.test(src) && USES.test(src)) importing.push(f);
  }
  if (!importing.length) problems.push(`no stamped test template imports package:nikatru_purchases/testing.dart and uses its fakes`);
  const pubspec = readFileSync(join(root, BRICK_APP, 'pubspec.yaml'), 'utf8');
  if (!/^\s+nikatru_purchases:\s*$/m.test(pubspec)) problems.push('the stamped pubspec does not depend on nikatru_purchases');
  return problems;
}

/** A scratch copy of the brick's app template, mutated by `fn(rel, text)`. */
function mutatedCopy(rel, fn) {
  const root = mkdtempSync(join(tmpdir(), 'brick-fakes-'));
  cpSync(join(REPO, BRICK_APP, 'test'), join(root, BRICK_APP, 'test'), { recursive: true });
  cpSync(join(REPO, BRICK_APP, 'pubspec.yaml'), join(root, BRICK_APP, 'pubspec.yaml'));
  const abs = join(root, BRICK_APP, rel);
  const before = readFileSync(abs, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, 'the mutation was a NO-OP, so the case would test the passing input');
  writeFileSync(abs, after);
  return root;
}

describe('the brick stamps the shared payment fakes and the conformance suite', () => {
  test('green control: the stamped test template imports package:nikatru_purchases/testing.dart and uses its fakes', () => {
    assert.deepEqual(brickProblems(REPO), []);
  });

  test('red: the stamped test template imports nothing from testing.dart', () => {
    const root = mutatedCopy('test/chassis_properties_test.dart', (s) => s.replace("import 'package:nikatru_purchases/testing.dart';\n", ''));
    assert.match(brickProblems(root).join('\n'), /no stamped test template imports package:nikatru_purchases\/testing\.dart/);
  });

  test('red: a hand fake of a money seam comes back into the template', () => {
    const root = mutatedCopy('test/chassis_properties_test.dart', (s) => `${s}\nclass _HandRail implements PurchaseRail {\n}\n`);
    assert.match(brickProblems(root).join('\n'), /declares a hand fake `_HandRail` of `PurchaseRail`/);
  });

  test('red: the stamped pubspec drops nikatru_purchases', () => {
    const root = mutatedCopy('pubspec.yaml', (s) => s.replace(/^(\s+)nikatru_purchases:\s*$/m, '$1nikatru_purchases_gone:'));
    assert.match(brickProblems(root).join('\n'), /does not depend on nikatru_purchases/);
  });
});
