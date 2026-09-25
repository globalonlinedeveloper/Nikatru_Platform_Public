#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-iap-review-screenshots.mjs — App Store Connect will not let an
// auto-renewable subscription leave "Missing Metadata" without a REVIEW
// SCREENSHOT, and the screenshot is per PRODUCT, not per app.
//
// ── WHY THIS IS NOT A ROW IN assert-listing-assets.mjs ──────────────────────
// That guard grades a LISTING: a set of frames whose count and size the register
// names outright. This one grades a RELATION — one file per auto-renewable
// product, whatever those products happen to be today. The expected file list is
// therefore DERIVED from the paywall offerings and never typed anywhere; the day
// a third subscription term is added, the obligation appears here on its own,
// which is the entire reason this is a separate reader.
//
// It is also the reason the register limb below declares no filenames. A list of
// filenames in the register would be a second declaration of the product set,
// and the first of the two to drift.
//
// ── WHAT IS AND IS NOT AUTO-RENEWABLE ───────────────────────────────────────
// `term: "one_time"` is a non-consumable purchase. Apple does not ask for a
// review screenshot for one, and asking for one here would invent an obligation
// — the failure mode this whole contract exists to avoid. So the domain is
// every offering whose `term` is NOT `one_time`, and a product set that is
// entirely one-time is a legitimately empty domain, reported as such rather
// than silently passing.
//
// ── THE PRINT/FAIL SPLIT IS THE SAME RELATIONSHIP THE OTHER READERS USE ─────
//   product declared, screenshot missing, channel DEFERRED  -> PRINT (exit 0)
//   product declared, screenshot missing, channel SERVED    -> FAIL
//   ...the same, with --for-submission                      -> FAIL
//   screenshot present but wrong size / format / has alpha  -> FAIL
//   screenshot present with no CAPTURE.json beside it       -> FAIL
//   a file in the directory that no product accounts for    -> FAIL
//   a declared dimension with no `source`                   -> FAIL
//   the register limb, the product file or the app set gone -> COVERAGE LOST (2)
//
// COVERAGE LOST is exit 2 and is not a finding about screenshots: it is the
// reader saying it could not see the thing it grades. An empty domain prints ok,
// so every way the domain can silently become empty has to be a refusal.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { IAP_REVIEW_CHANNELS } from './submit-preconditions.mjs';

const FOR_SUBMISSION = process.argv.includes('--for-submission');
const REGISTER = join('tooling', 'channel-register.json');
const PRODUCTS = join('services', 'platform', 'src', 'app-config-data.json');

const notes = [];
const fails = [];
// COVERAGE LOST stops the run where it happens rather than accumulating. Two
// reasons, and the second is the one that matters: a coverage loss is not a
// finding about screenshots, it is this reader saying it cannot see the thing it
// grades, so every line printed after one would be a claim about a domain that
// was never read. It also keeps the exit reachable by a plain read of this file
// — tooling/ci/assert-guard-coverage.mjs traces a helper to its exit, and an
// accumulator that only becomes exit 2 three hundred lines later reads as
// unreachable, which is a guard nobody can prove fails.
const lost = (why) => {
  console.error(`✗ COVERAGE LOST — ${why}`);
  console.error(
    '    This reader grades one file per auto-renewable product; it could not see one of the two.',
  );
  console.error('assert-iap-review-screenshots: FAILED');
  process.exit(2);
};

// The channel is the one entry of IAP_REVIEW_CHANNELS in submit-preconditions.mjs,
// the table limb 3 of assert-publish-steps-guarded.mjs reads to put this reader in
// a submit lane (O-SUBMIT-LANES-SKIP-PRECONDITION-GATES). This reader grades ONE
// channel's tree, so a second entry would be a lane running it over a channel it
// never reads: refused here rather than graded as the first.
if (IAP_REVIEW_CHANNELS.length !== 1) {
  lost(
    `submit-preconditions.mjs IAP_REVIEW_CHANNELS names ${IAP_REVIEW_CHANNELS.length} channel(s) [${IAP_REVIEW_CHANNELS.join(', ')}]; this reader grades exactly one channel's tree.`,
  );
}
const CHANNEL = IAP_REVIEW_CHANNELS[0];

// ── a THIRD copy of the PNG header reader, and that is a debt, not a design ──
// `tooling/store/chrome-raster.mjs` exports one and `tooling/ci/assert-listing-
// assets.mjs` keeps a private copy of it. This is the third. It is copied rather
// than imported because chrome-raster.mjs is a CAPTURE module: importing it puts
// a browser-driving dependency on the critical path of a guard that only reads
// bytes off disk, and a guard that cannot run without a browser stack is a guard
// that gets skipped. The right fix is one `tooling/store/png.mjs` that all three
// import; that is a separate change because it edits a file this lane does not
// own. Until then: three copies, one behaviour, and this comment so the next
// person fixing a PNG bug knows to fix it three times.
function pngHeader(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 26 || !SIG.every((v, i) => buf[i] === v)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  const h = {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colourType: buf[25],
    bytes: buf.length,
  };
  if (h.width === 0 || h.height === 0) return null;
  let off = 8;
  let tRNS = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'tRNS') tRNS = true;
    if (type === 'IEND') break;
    off += 12 + len;
  }
  h.hasAlpha = h.colourType === 4 || h.colourType === 6 || tRNS;
  return h;
}

const readJson = (p) => {
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// ── limb 1 — the rule, and it must be the register's ────────────────────────
const register = readJson(REGISTER);
if (!register) lost(`${REGISTER} does not exist or is not readable JSON.`);

const channelRow = register?.channels?.[CHANNEL] ?? null;
const rule =
  register?.storeMetadataContract?.perChannel?.[CHANNEL]?.graphicAssets?.iapReview ?? null;

if (register && !rule) {
  lost(
    `storeMetadataContract.perChannel["${CHANNEL}"].graphicAssets.iapReview is absent. ` +
      'With no rule there is no expected size, no directory and nothing to grade — this reader ' +
      'would pass every tree including one with no review screenshots at all.',
  );
}
if (rule && !rule.source) {
  fails.push(
    `the iapReview rule declares dimensions with no \`source\`. An invented limit fires on CORRECT ` +
      `input; a dimension without a citation is refused rather than enforced.`,
  );
}

const served = channelRow?.served === true;

// ── limb 2 — the products, DERIVED, never typed ─────────────────────────────
const config = readJson(PRODUCTS);
if (!config) lost(`${PRODUCTS} does not exist or is not readable JSON — the product set is its.`);

const apps = config?.apps && typeof config.apps === 'object' ? Object.entries(config.apps) : [];
if (config && apps.length === 0) {
  lost(
    `${PRODUCTS} declares no \`apps\`. The set of apps whose products are checked would then be ` +
      'empty, and an empty domain prints ok.',
  );
}

let productsSeen = 0;
let appsGraded = 0;

for (const [appId, app] of apps) {
  const storeDir = join('apps', appId, 'store', CHANNEL);
  // An app with no Apple listing tree owes no Apple review screenshot. That is a
  // fact about the app, not a gap, so it is skipped rather than reported.
  if (!existsSync(storeDir)) continue;
  appsGraded += 1;

  const offerings = Array.isArray(app?.paywall?.offerings) ? app.paywall.offerings : null;
  if (!offerings) {
    lost(
      `apps["${appId}"].paywall.offerings is absent from ${PRODUCTS}, and ${appId} has an ` +
        `${CHANNEL} listing tree. The obligation is derived from that list; with no list there is ` +
        'nothing to derive and this app would pass by having no products at all.',
    );
  }

  const renewable = offerings.filter((o) => o && o.term !== 'one_time' && o.product_id);
  productsSeen += renewable.length;

  const dir = join(storeDir, rule?.dir ?? 'iap-review');
  const expected = new Map(renewable.map((o) => [`${o.product_id}.png`, o]));

  if (!existsSync(dir)) {
    fails.push(
      `${dir} does not exist, and ${appId} declares ${renewable.length} auto-renewable ` +
        `product(s) (${renewable.map((o) => o.product_id).join(', ')}). Every one of them needs a ` +
        'review screenshot before App Store Connect will take the subscription out of "Missing ' +
        'Metadata". Stamp the directory with a README.md stating the obligation — git cannot ' +
        'commit an empty one.',
    );
    continue;
  }

  const present = listDir(dir).filter((f) => f.toLowerCase().endsWith('.png'));

  // ── unaccounted files: a screenshot for a product nobody sells ────────────
  for (const f of present) {
    if (!expected.has(f)) {
      fails.push(
        `${join(dir, f)} is a review screenshot for a product that is not an auto-renewable ` +
          `offering of "${appId}". Either the product was renamed or removed and this file is a ` +
          'stale answer to a question nobody asks any more, or it was captured for a one-time ' +
          'purchase, which Apple does not ask for.',
      );
    }
  }

  const provenance = join(dir, rule?.provenanceFile ?? 'CAPTURE.json');
  const hasProvenance = existsSync(provenance);

  for (const [file, offering] of expected) {
    const path = join(dir, file);
    if (!existsSync(path)) {
      const line =
        `${path} is missing, and "${offering.product_id}" is an auto-renewable subscription of ` +
        `"${appId}" (term: ${offering.term}). App Store Connect holds an auto-renewable product in ` +
        '"Missing Metadata" until it has a review screenshot, and a version cannot ship with one ' +
        'there. This is captured, never drawn: it must show the real paywall on a real build.';
      if (served || FOR_SUBMISSION) fails.push(line);
      else
        notes.push(
          `⬜ NO REVIEW SCREENSHOT (channel not served yet): ${line} This PRINTS here and is FATAL ` +
            'on the submission lane, which runs this guard with --for-submission.',
        );
      continue;
    }

    if (!hasProvenance) {
      fails.push(
        `${path} exists and ${provenance} does not. A screenshot with no provenance is evidence ` +
          'about nothing: nobody can tell afterwards whether it photographed a LIVE build or a ' +
          'demo one, and a demo build paints a "Demo data" banner over the paywall.',
      );
    }

    const buf = readFileSync(path);
    const h = pngHeader(buf);
    if (!h) {
      fails.push(`${path} is not a readable PNG (the IHDR header could not be parsed).`);
      continue;
    }
    const size = `${h.width}x${h.height}`;
    if (rule?.acceptedSizes && !rule.acceptedSizes.includes(size)) {
      fails.push(
        `${path} is ${size} and the register accepts ${rule.acceptedSizes.join(', ')}. Source: ` +
          `${rule.source}. Capture again at the right geometry — a rescaled screenshot shows it.`,
      );
    }
    if (rule?.alpha === false && h.hasAlpha) {
      fails.push(
        `${path} carries transparency (colour type ${h.colourType}${h.hasAlpha && h.colourType !== 4 && h.colourType !== 6 ? ' plus a tRNS chunk' : ''}), and the register declares \`alpha: false\`. ` +
          'Apple composites an alpha channel against an unpredictable background.',
      );
    }
    if (rule?.maxBytes && statSync(path).size > rule.maxBytes) {
      fails.push(
        `${path} is ${statSync(path).size} bytes and the register caps it at ${rule.maxBytes}.`,
      );
    }
  }
}

// ── limb 3 — an empty domain is a refusal, not a pass ───────────────────────
if (appsGraded === 0) {
  lost(
    `no app in ${PRODUCTS} has an apps/<app>/store/${CHANNEL}/ tree. The domain is empty and an ` +
      'empty domain prints ok, so this reader would report success about nothing.',
  );
}
if (productsSeen === 0) {
  lost(
    'no app declares an auto-renewable offering (every `term` is `one_time`). That may be true, ' +
      'and it is also exactly what a broken read of the offerings list looks like — so it is ' +
      'refused rather than assumed. Delete this reader in the same change that removes the last ' +
      'subscription.',
  );
}

// ── report ──────────────────────────────────────────────────────────────────
for (const n of notes) console.log(`   ${n}`);
for (const f of fails) console.error(`FAIL ${f}`);

if (fails.length > 0) {
  console.error(`assert-iap-review-screenshots: ${fails.length} problem(s)`);
  process.exit(1);
}

console.log(
  `ok  IAP review screenshots — ${appsGraded} app(s) with an ${CHANNEL} tree, ${productsSeen} ` +
    `auto-renewable product(s), ${notes.length} deferred${FOR_SUBMISSION ? ' (--for-submission: deferrals are fatal)' : ''}`,
);
