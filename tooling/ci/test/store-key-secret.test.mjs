// ─────────────────────────────────────────────────────────────────────────────
// store-key-secret.test.mjs — tooling/ci/store-key-secret.mjs prints one app's
// store SDK key secret NAME for one rail, and refuses everything else by exit code.
//
// O-BRICK-SELLS-NOTHING-IN-A-STORE (12a). The name is per app (app.yaml
// billing.mobileIap.publicKeySecrets) because a RevenueCat key belongs to ONE
// RevenueCat app. Each case is written out (assert-no-loop-cases).
//
// Run:  node --test tooling/ci/test/store-key-secret.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ci', 'store-key-secret.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-store-key-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;
/** A root with the REAL channel register and the given app declarations. */
function tree(apps) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'tooling'), { recursive: true });
  writeFileSync(join(root, 'tooling', 'channel-register.json'), readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  for (const [id, body] of Object.entries(apps)) {
    mkdirSync(join(root, 'apps', id), { recursive: true });
    writeFileSync(join(root, 'apps', id, 'app.yaml'), body);
  }
  return root;
}
const run = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const IAP = (android, ios) =>
  `id: second\nbilling:\n  mobileIap:\n    provider: revenuecat\n    entitlementId: pro\n    state: pending\n    publicKeySecrets:\n      android: ${android}\n      ios: ${ios}\n    storeProducts:\n      - plan: single-monthly\n        productId: second_pro_monthly\n`;

describe('store-key-secret — the NAME of one app\'s store SDK key secret, never a value', () => {
  test('app #1, play-billing: prints its Google key NAME as a step output (the real tree)', () => {
    const { code, stdout } = run(['--app', 'subscriptiontracker', '--rail', 'play-billing']);
    assert.equal(code, 0, stdout);
    assert.equal(stdout, 'name=REVENUECAT_PUBLIC_KEY_GOOGLE\n');
  });

  test('app #1, apple-iap: prints its Apple key NAME (the real tree)', () => {
    const { code, stdout } = run(['--app', 'subscriptiontracker', '--rail', 'apple-iap']);
    assert.equal(code, 0, stdout);
    assert.equal(stdout, 'name=REVENUECAT_PUBLIC_KEY_APPLE\n');
  });

  test('a second app gets ITS OWN name, even while pending', () => {
    const root = tree({ second: IAP('REVENUECAT_PUBLIC_KEY_GOOGLE_SECOND', 'REVENUECAT_PUBLIC_KEY_APPLE_SECOND') });
    const { code, stdout } = run(['--app', 'second', '--rail', 'play-billing', '--root', root]);
    assert.equal(code, 0, stdout);
    assert.equal(stdout, 'name=REVENUECAT_PUBLIC_KEY_GOOGLE_SECOND\n');
  });

  test('exit 1 when the app declares no billing.mobileIap — no key to build with', () => {
    const root = tree({ second: 'id: second\n' });
    const { code, out, stdout } = run(['--app', 'second', '--rail', 'play-billing', '--root', root]);
    assert.equal(code, 1, out);
    assert.equal(stdout, '', 'a refusal prints no step output');
    assert.match(out, /apps\/second\/app\.yaml declares no billing\.mobileIap/);
  });

  test('exit 2 when the app is not in the workspace', () => {
    const { code, out } = run(['--app', 'nosuchapp', '--rail', 'play-billing']);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — apps\/nosuchapp\/app\.yaml does not exist/);
  });

  test('exit 2 on a rail the register does not key — paddle has no store SDK key', () => {
    const { code, out } = run(['--app', 'subscriptiontracker', '--rail', 'paddle']);
    assert.equal(code, 2, out);
    assert.match(out, /--rail "paddle" is not a rail tooling\/channel-register\.json keys \(play-billing, apple-iap\)/);
  });

  test('exit 2 with no --app', () => {
    const { code, out } = run(['--rail', 'play-billing']);
    assert.equal(code, 2, out);
    assert.match(out, /--app null is not an app id/);
  });

  test('exit 2 when the declared name is not a secret name', () => {
    const root = tree({ second: IAP('lower-case', 'REVENUECAT_PUBLIC_KEY_APPLE_SECOND') });
    const { code, out } = run(['--app', 'second', '--rail', 'play-billing', '--root', root]);
    assert.equal(code, 2, out);
    assert.match(out, /publicKeySecrets\.android is "lower-case", not a secret name/);
  });
});
