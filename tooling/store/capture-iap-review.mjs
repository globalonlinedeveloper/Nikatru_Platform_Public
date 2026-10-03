#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// capture-iap-review.mjs — the PRODUCER of the App Store IAP review screenshots
// that tooling/ci/assert-iap-review-screenshots.mjs grades.
//
// ⏱ ADDED 2026-10-03 (release lane apple-ready). The register's iapReview limb
// named its producer "integration_test/iap_review_screenshot_test.dart (UNBUILT
// as of 2026-09-22)", so the reader's --for-submission step in submit-appstore.yml
// could only ever fail: an auto-renewable subscription sits in "Missing Metadata"
// until it carries a review screenshot, and App Store Connect will not send a
// version that references it for review.
//
// ── WHAT IS DERIVED, AND FROM WHERE (nothing about a product is typed here) ──
//   · the channel       submit-preconditions.mjs IAP_REVIEW_CHANNELS, the reader's own;
//   · the rule          tooling/channel-register.json storeMetadataContract
//                       .perChannel[<channel>].graphicAssets.iapReview — dir, sizes, alpha;
//   · the simulator     the ONE screenshot set of that channel whose acceptedSizes equal
//                       the rule's: the frame is the listing set's frame (the rule says so);
//   · the products      services/platform/src/app-config-data.json apps.<app>.paywall
//                       .offerings[] whose term is not one_time — the reader's derivation;
//   · each price        prices.apps.<app>.<product>.store.readBack.apple: the price App Store
//                       Connect ACCEPTED, never the web price (a store paywall shows the store's);
//   · the feature lists apps.<app>.paywall.pro_features / free_features, as served.
//
// ── WHY THE PAYWALL'S RAIL IS A FIXTURE ─────────────────────────────────────
// StoreKit returns no product still in "Missing Metadata", and this screenshot is
// what takes the product out of it. The suite (integration_test/
// iap_review_screenshot_test.dart) therefore hosts the REAL PaywallScreen with the
// app's theme and strings and a rail serving exactly one product per frame at the
// accepted price. CAPTURE.json says so in `rail`, so no reader mistakes it for a
// photograph of a StoreKit answer.
//
// Usage:
//   node tooling/store/capture-iap-review.mjs --app <app> --print     the plan, no drive
//   node tooling/store/capture-iap-review.mjs --app <app>             drive, flatten, verify, record
//        [--flutter <path>] [--repo-root <dir>]
// Runs on a macOS runner with the simulator already booted (store-screenshots.yml
// capture-ios boots every device the register names).
//
// Exit 0 = every product has its frame at an accepted size, opaque, with CAPTURE.json.
//      1 = a finding (the drive failed, a frame is missing or the wrong size, a price unread).
//      2 = COVERAGE LOST (a register limb, the product file or the app is absent).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { decodeRgba, encodeRgba, PngUnreadable } from './png-codec.mjs';
import { pngHeader } from './chrome-raster.mjs';
import { captureProvenance } from './capture-provenance.mjs';
import { IAP_REVIEW_CHANNELS } from '../ci/submit-preconditions.mjs';

export const SUITE_FILE = 'integration_test/iap_review_screenshot_test.dart';
export const DRIVER_FILE = 'test_driver/store_screenshots.dart';
const REGISTER = 'tooling/channel-register.json';
const PRODUCTS = 'services/platform/src/app-config-data.json';

class CoverageLost extends Error {}
class Finding extends Error {}

const readJson = (root, rel) => {
  const p = join(root, rel);
  if (!existsSync(p)) throw new CoverageLost(`${rel} does not exist.`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new CoverageLost(`${rel} is not valid JSON (${e.message}).`);
  }
};

/**
 * The capture, as data: what is photographed, on which simulator, into which
 * directory, with which defines. Pure apart from two reads; the tests read it.
 */
export function planIapReview({ root, app }) {
  if (IAP_REVIEW_CHANNELS.length !== 1) {
    throw new CoverageLost(`submit-preconditions.mjs IAP_REVIEW_CHANNELS names ${IAP_REVIEW_CHANNELS.length} channel(s); this producer serves exactly one, as its reader does.`);
  }
  const channel = IAP_REVIEW_CHANNELS[0];
  const register = readJson(root, REGISTER);
  const assets = register?.storeMetadataContract?.perChannel?.[channel]?.graphicAssets;
  const rule = assets?.iapReview;
  if (!rule || typeof rule.dir !== 'string' || !Array.isArray(rule.acceptedSizes) || rule.acceptedSizes.length === 0) {
    throw new CoverageLost(`${REGISTER} perChannel["${channel}"].graphicAssets.iapReview declares no dir or acceptedSizes.`);
  }
  const sets = Object.entries(assets?.screenshots?.deviceTypeCoverage?.sets ?? {});
  const same = sets.filter(([, s]) => Array.isArray(s?.acceptedSizes) && s.acceptedSizes.join() === rule.acceptedSizes.join() && s?.capture?.flutterDevice);
  if (same.length !== 1) {
    throw new CoverageLost(
      `the iapReview rule accepts ${rule.acceptedSizes.join(', ')} and ${same.length} screenshot set(s) of ${channel} capture that size — exactly one names the simulator this frame is taken on.`,
    );
  }
  const [setName, set] = same[0];

  const config = readJson(root, PRODUCTS);
  const appConfig = config?.apps?.[app];
  if (!appConfig) throw new CoverageLost(`${PRODUCTS} declares no app "${app}".`);
  const offerings = appConfig?.paywall?.offerings;
  if (!Array.isArray(offerings)) throw new CoverageLost(`${PRODUCTS} apps.${app}.paywall.offerings is absent.`);
  const renewable = offerings.filter((o) => o && o.term !== 'one_time' && o.product_id);
  if (renewable.length === 0) throw new CoverageLost(`apps.${app} declares no auto-renewable offering; there is nothing Apple asks a review screenshot of.`);

  const problems = [];
  const products = renewable.map((o) => {
    const accepted = config?.prices?.apps?.[app]?.[o.product_id]?.store?.readBack?.apple;
    const currency = 'USD';
    const amountMinor = accepted?.[currency];
    if (!Number.isInteger(amountMinor) || amountMinor < 1) {
      problems.push(
        `${o.product_id}: ${PRODUCTS} prices.apps.${app}.${o.product_id}.store.readBack.apple.${currency} is ${JSON.stringify(amountMinor ?? null)}. ` +
          'The frame shows the price App Store Connect accepted, read back; a product whose price was never read back is not photographed at a guessed one.',
      );
    }
    if (!/^[a-z0-9_.]+$/.test(o.product_id)) problems.push(`${o.product_id}: a product id this capture will not put in a file name or a define`);
    return { productId: o.product_id, term: o.term, amountMinor, currency, readAt: accepted?.readAt ?? null };
  });
  if (problems.length) throw new Finding(problems.join('\n'));

  const codes = (v) => (Array.isArray(v) ? v.filter((c) => typeof c === 'string' && /^[a-z0-9_-]+$/.test(c)) : []);
  const defines = {
    IAP_REVIEW_OFFERINGS: products.map((p) => `${p.productId}|${p.amountMinor}|${p.currency}|${p.term}`).join(';'),
    IAP_REVIEW_PRO_FEATURES: codes(appConfig.paywall.pro_features).join(','),
    IAP_REVIEW_FREE_FEATURES: codes(appConfig.paywall.free_features).join(','),
  };
  return {
    channel,
    rule,
    set: setName,
    device: set.capture.flutterDevice,
    outDir: `apps/${app}/store/${channel}/${rule.dir}`,
    products,
    defines,
  };
}

/** Re-emit a PNG without its alpha channel (colour type 2), pixels unchanged
 *  where they were opaque. The platform shutter hands back RGBA; the rule says
 *  `alpha: false`. Returns null when the bytes carry no alpha already. */
export function flattenIfAlpha(bytes) {
  const h = pngHeader(bytes);
  if (!h) throw new Finding('not a readable PNG (no IHDR)');
  if (!h.hasAlpha) return null;
  const img = decodeRgba(bytes);
  return encodeRgba(img, { opaque: true });
}

function main(argv) {
  const opt = (k) => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const app = opt('app');
  if (!app || !/^[a-z][a-z0-9-]*$/.test(app)) throw new CoverageLost('--app <app id> is required.');
  const root = resolve(opt('repo-root') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const plan = planIapReview({ root, app });
  console.log(`capture-iap-review — ${app} · ${plan.channel} · ${plan.products.length} auto-renewable product(s) on "${plan.device}" (the ${plan.set} set's simulator)`);
  for (const p of plan.products) console.log(`   ${p.productId}: ${p.term}, ${p.currency} ${(p.amountMinor / 100).toFixed(2)} (App Store Connect read-back ${p.readAt ?? 'undated'}) → ${plan.outDir}/${p.productId}.png`);
  if (argv.includes('--print')) {
    for (const [k, v] of Object.entries(plan.defines)) console.log(`   --dart-define=${k}=${v}`);
    return 0;
  }

  const outDir = join(root, plan.outDir);
  mkdirSync(outDir, { recursive: true });
  const flutter = opt('flutter') ?? 'flutter';
  const args = [
    'drive',
    `--driver=${DRIVER_FILE}`,
    `--target=${SUITE_FILE}`,
    '-d', plan.device,
    ...Object.entries(plan.defines).map(([k, v]) => `--dart-define=${k}=${v}`),
  ];
  console.log(`\n→ ${flutter} ${args.join(' ')}`);
  const r = spawnSync(flutter, args, {
    cwd: join(root, 'apps', app),
    stdio: 'inherit',
    env: { ...process.env, STORE_SHOT_DIR: outDir },
    timeout: 30 * 60 * 1000,
  });
  if (r.status !== 0) throw new Finding(`flutter drive exited ${r.status ?? `with no status (${r.error?.message ?? r.signal})`}; no review screenshot is recorded from a failed drive.`);

  const frames = [];
  const problems = [];
  for (const p of plan.products) {
    const file = join(outDir, `${p.productId}.png`);
    if (!existsSync(file)) {
      problems.push(`${plan.outDir}/${p.productId}.png was not written by the drive`);
      continue;
    }
    let bytes = readFileSync(file);
    try {
      const flat = flattenIfAlpha(bytes);
      if (flat) {
        writeFileSync(file, flat);
        bytes = flat;
      }
    } catch (e) {
      problems.push(`${plan.outDir}/${p.productId}.png could not be flattened: ${e instanceof PngUnreadable ? e.lines.join(' ') : e.message}`);
      continue;
    }
    const h = pngHeader(bytes);
    const size = `${h.width}x${h.height}`;
    if (!plan.rule.acceptedSizes.includes(size)) problems.push(`${plan.outDir}/${p.productId}.png is ${size}; the rule accepts ${plan.rule.acceptedSizes.join(', ')}`);
    if (h.hasAlpha) problems.push(`${plan.outDir}/${p.productId}.png still carries alpha (colour type ${h.colourType})`);
    frames.push({ file: `${p.productId}.png`, pixels: size });
  }
  if (problems.length) throw new Finding(problems.join('\n'));

  const provenance = captureProvenance({
    root,
    watched: [`apps/${app}/lib/features/monetization`, 'packages/chassis_screens/lib/monetization', `apps/${app}/${SUITE_FILE}`],
  });
  writeFileSync(
    join(outDir, plan.rule.provenanceFile ?? 'CAPTURE.json'),
    `${JSON.stringify(
      {
        capturedBy: 'tooling/store/capture-iap-review.mjs',
        ...provenance,
        posture: 'live-widget',
        rail: 'fixture: one auto-renewable product per frame at the price App Store Connect accepted (prices.apps.<app>.<product>.store.readBack.apple); StoreKit returns no product in "Missing Metadata", which is what this screenshot clears',
        device: plan.device,
        frames,
        products: plan.products,
        count: frames.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\ncapture-iap-review: ok — ${frames.length} review screenshot(s) in ${plan.outDir}, with CAPTURE.json`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    if (e instanceof CoverageLost) {
      console.error(`✗ COVERAGE LOST — ${e.message}`);
      process.exitCode = 2;
    } else if (e instanceof Finding) {
      for (const l of e.message.split('\n')) console.error(`✗ ${l}`);
      console.error('capture-iap-review: FAILED');
      process.exitCode = 1;
    } else {
      throw e;
    }
  }
}
