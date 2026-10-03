// ─────────────────────────────────────────────────────────────────────────────
// capture-iap-review.test.mjs — the producer of the App Store IAP review
// screenshots derives every product, price and simulator, and refuses to guess.
//
// ⏱ ADDED 2026-10-03 (release lane apple-ready), with tooling/store/capture-iap-review.mjs
// and apps/subscriptiontracker/integration_test/iap_review_screenshot_test.dart. No drive
// runs here (there is no simulator); `--print` is the whole plan, and the flatten is
// exercised on real PNG bytes.
//
// Run:  node --test tooling/ci/test/capture-iap-review.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { planIapReview, flattenIfAlpha, SUITE_FILE } from '../../store/capture-iap-review.mjs';
import { encodeRgba } from '../../store/png-codec.mjs';
import { pngHeader } from '../../store/chrome-raster.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'store', 'capture-iap-review.mjs');
const REGISTER = 'tooling/channel-register.json';
const PRODUCTS = 'services/platform/src/app-config-data.json';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-iapreview-'));
});
after(() => rmSync(TMP, { recursive: true, force: true }));

/** A copy of the two files the plan reads, from the real tree, each mutable. */
function fixture({ register = (r) => r, products = (p) => p } = {}) {
  const root = join(TMP, `f${seq++}`);
  for (const [rel, edit] of [[REGISTER, register], [PRODUCTS, products]]) {
    const doc = JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(edit(doc) ?? doc));
  }
  return root;
}
const run = (root, args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--repo-root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

describe('capture-iap-review — the plan is derived, never typed', () => {
  test('the real tree: one frame per auto-renewable product, at the price App Store Connect accepted, on the iphone set\'s simulator', () => {
    const plan = planIapReview({ root: REPO, app: 'subscriptiontracker' });
    const config = JSON.parse(readFileSync(join(REPO, PRODUCTS), 'utf8'));
    const renewable = config.apps.subscriptiontracker.paywall.offerings.filter((o) => o.term !== 'one_time').map((o) => o.product_id);
    assert.deepEqual(plan.products.map((p) => p.productId), renewable);
    for (const p of plan.products) {
      assert.equal(p.amountMinor, config.prices.apps.subscriptiontracker[p.productId].store.readBack.apple.USD, `${p.productId}: the accepted store price`);
    }
    assert.equal(plan.outDir, 'apps/subscriptiontracker/store/ios-appstore/iap-review');
    const register = JSON.parse(readFileSync(join(REPO, REGISTER), 'utf8'));
    assert.equal(plan.device, register.storeMetadataContract.perChannel['ios-appstore'].graphicAssets.screenshots.deviceTypeCoverage.sets.iphone.capture.flutterDevice);
    assert.doesNotMatch(plan.defines.IAP_REVIEW_OFFERINGS, /one_time|lifetime/, 'a one-time product is never photographed');
  });

  test('--print shows the plan and drives nothing', () => {
    const { code, out } = run(REPO, ['--app', 'subscriptiontracker', '--print']);
    assert.equal(code, 0, out);
    assert.match(out, /--dart-define=IAP_REVIEW_OFFERINGS=pro_monthly\|\d+\|USD\|month;pro_yearly\|\d+\|USD\|year/);
    assert.doesNotMatch(out, /flutter drive|→ flutter/);
  });

  test('RED CONTROL: a product whose store price was never read back is a FINDING (exit 1), not a guessed price', () => {
    const root = fixture({ products: (p) => (delete p.prices.apps.subscriptiontracker.pro_yearly.store.readBack.apple, p) });
    const { code, out } = run(root, ['--app', 'subscriptiontracker', '--print']);
    assert.equal(code, 1, out);
    assert.match(out, /pro_yearly: .*readBack\.apple\.USD is null/);
  });

  test('COVERAGE LOST (exit 2): no iapReview limb, no matching simulator set, an unknown app', () => {
    const noRule = fixture({ register: (r) => (delete r.storeMetadataContract.perChannel['ios-appstore'].graphicAssets.iapReview, r) });
    assert.equal(run(noRule, ['--app', 'subscriptiontracker', '--print']).code, 2);
    const noSet = fixture({ register: (r) => ((r.storeMetadataContract.perChannel['ios-appstore'].graphicAssets.iapReview.acceptedSizes = ['1x1']), r) });
    const r2 = run(noSet, ['--app', 'subscriptiontracker', '--print']);
    assert.equal(r2.code, 2, r2.out);
    assert.match(r2.out, /0 screenshot set\(s\) of ios-appstore capture that size/);
    assert.equal(run(REPO, ['--app', 'nope', '--print']).code, 2);
  });

  test('the suite the runner drives exists and reads the three defines it is given', () => {
    const suite = readFileSync(join(REPO, 'apps', 'subscriptiontracker', SUITE_FILE), 'utf8');
    for (const k of ['IAP_REVIEW_OFFERINGS', 'IAP_REVIEW_PRO_FEATURES', 'IAP_REVIEW_FREE_FEATURES']) {
      assert.match(suite, new RegExp(`String\\.fromEnvironment\\('${k}'\\)`), k);
    }
    assert.match(suite, /binding\.takeScreenshot\(product\.productId\)/, 'each frame is filed under its product id');
  });
});

describe('capture-iap-review — the flatten', () => {
  test('an RGBA frame comes back opaque (colour type 2), same size; an opaque one is left alone', () => {
    const width = 4;
    const height = 3;
    const rgba = Buffer.alloc(width * height * 4, 200);
    const withAlpha = encodeRgba({ width, height, rgba });
    assert.equal(pngHeader(withAlpha).hasAlpha, true);
    const flat = flattenIfAlpha(withAlpha);
    const h = pngHeader(flat);
    assert.equal(h.hasAlpha, false);
    assert.equal(h.colourType, 2);
    assert.deepEqual([h.width, h.height], [width, height]);
    assert.equal(flattenIfAlpha(flat), null);
  });
});
