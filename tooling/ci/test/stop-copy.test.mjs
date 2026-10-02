// ─────────────────────────────────────────────────────────────────────────────
// stop-copy.test.mjs — assert-stop-copy.mjs must be able to FAIL.
//
// Train ST-detail-stop (DE-07/DE-08, design rule R3): the stop-a-charge copy
// never claims the app cancels anything and never prints a debit time. Every
// red case below runs the guard against a COPY of the real arbs with one value
// mutated, so the green control and each red differ by exactly that value.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-stop-copy.mjs');
const L10N = 'apps/subscriptiontracker/lib/l10n';

const realArb = (locale) => JSON.parse(readFileSync(join(REPO, L10N, `app_${locale}.arb`), 'utf8'));

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-stop-copy-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

/** A repo root holding the two arbs, each passed through [mutate]. */
function tree({ en = (a) => a, ta = (a) => a, skip = [] } = {}) {
  const root = join(TMP, `r${++seq}`);
  mkdirSync(join(root, L10N), { recursive: true });
  for (const [locale, mutate] of [
    ['en', en],
    ['ta', ta],
  ]) {
    if (skip.includes(locale)) continue;
    writeFileSync(join(root, L10N, `app_${locale}.arb`), JSON.stringify(mutate(realArb(locale)), null, 2));
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const set = (key, value) => (arb) => ({ ...arb, [key]: value });

describe('assert-stop-copy', () => {
  test('GREEN CONTROL — the real arbs, copied verbatim, exit 0', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /app_en\.arb: \d+ stop-copy value\(s\), none forbidden/);
    assert.match(out, /app_ta\.arb: \d+ stop-copy value\(s\), none forbidden/);
  });

  test('the real repository is green', () => {
    const r = spawnSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: REPO });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });

  test('RED · the rail panel claims the app cancels the mandate', () => {
    const { code, out } = run(
      tree({ en: set('railPanelUpiWhere', "We'll cancel the mandate for you in your UPI app.") }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /FAIL .*app_en\.arb · railPanelUpiWhere claims the app cancels/);
  });

  test('RED · the walkthrough prints a debit time', () => {
    const { code, out } = run(tree({ en: set('stopUpiStep2', 'Your bank debits at 9:30 AM, so revoke it before then.') }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL .*app_en\.arb · stopUpiStep2 prints a debit time of day: "9:30 AM"/);
  });

  test('RED · a TRANSLATION can say what the English does not — the Tamil arb is read too', () => {
    const { code, out } = run(tree({ ta: set('railPanelNachWhere', 'மேண்டேட் 10:00 மணிக்கு டெபிட் ஆகும்.') }));
    assert.equal(code, 1, out);
    assert.match(out, /FAIL .*app_ta\.arb · railPanelNachWhere prints a clock time: "10:00"/);
  });

  test('RED · "will be debited on" names when a debit happens', () => {
    const { code, out } = run(tree({ en: set('railPanelCardWhat', 'The amount will be debited on the 5th.') }));
    assert.equal(code, 1, out);
    assert.match(out, /railPanelCardWhat (?:names when a debit happens|predicts a debit)/);
  });

  test('a forbidden phrase OUTSIDE the namespace is not this guard\'s subject', () => {
    const { code, out } = run(tree({ en: set('appTitle', 'We cancel at 9:00 AM') }));
    assert.equal(code, 0, out);
  });

  test('COVERAGE LOST · the namespace shrank (keys renamed away) — exit 2, never a pass', () => {
    const rename = (arb) =>
      Object.fromEntries(Object.entries(arb).map(([k, v]) => [k.replace(/^railPanel/, 'mandatePanel'), v]));
    const { code, out } = run(tree({ en: rename }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*app_en\.arb holds \d+ stop-copy key\(s\), under the floor/);
  });

  test('COVERAGE LOST · the template arb is missing — exit 2', () => {
    const { code, out } = run(tree({ skip: ['en'] }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .*app_en\.arb \(the template\) is missing/);
  });

  test('COVERAGE LOST · no l10n directory at all — exit 2', () => {
    const root = join(TMP, `r${++seq}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — .* does not exist/);
  });
});
