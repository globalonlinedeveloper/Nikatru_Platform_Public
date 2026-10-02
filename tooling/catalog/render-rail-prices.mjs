#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// render-rail-prices.mjs — the rail price ids render from the one price register
// (O-RAIL-PRICE-IDS-HAND-KEPT), and the store column is graded by [ADR 093] §2.
//
// ── WHY ──────────────────────────────────────────────────────────────────────
// services/platform/src/routes/checkout.ts held three hand maps — our offering id
// to Paddle's price id, what that price costs on Paddle, and the offerings the
// rail cannot sell yet — beside a register, services/platform/src/app-config-data.json,
// that already names every offering and its web price ([pipeline 5]M-11). A new
// product meant a hand TypeScript edit in the shared checkout route before it
// could sell on the web, and a Razorpay price id had no home at all. The maps
// now RENDER from the register's `prices` section into
// services/platform/src/routes/rail-price-ids.ts, which checkout.ts imports, the
// way tooling/app-yaml/render.mjs renders revenuecat-app-ids.ts and store-skus.ts.
//
// ── THE REGISTER WAS EXTENDED, NOT MOVED ─────────────────────────────────────
// app-config-data.json is the file M-11 names as the one place a price lives,
// and a dozen readers already parse it. A second price file would be the drift
// M-11 forbids; re-pointing every reader gains nothing. `prices` is a NEW
// top-level section, and it is not SERVED: config.ts reads `sharedApiBaseUrl`,
// `defaults` and `apps` only, so the rail handles, the India web price and the
// store column never reach a client or a KV-override merge. An entry is keyed
// by the served offering's `product_id`, and limb A holds that join both ways.
//
// ── LIMBS (each one exit 1 unless marked) ────────────────────────────────────
//   A · JOIN — every served offering has a price-book entry, and every entry
//       names a served offering of a served app.
//   B · PLAN — an entry's `plan` is the one its served `term` implies
//       (month → single-monthly, year → single-yearly, one_time → single-lifetime;
//       bundle-monthly / bundle-yearly in `bundles`), the enum app.yaml's
//       `billing.mobileIap.storeProducts[].plan` uses.
//   C · RAILS — every entry declares every rail (paddle, razorpay), each either a
//       READ-BACK {priceId | planId, amountMinor, readAt} or {pending: <reason of
//       20+ characters>}; a read-back's amount equals the web price it sells
//       (paddle: `amount_minor`, USD; razorpay: `webInrMinor`, INR), and no rail
//       id sells two offerings. A bundle entry carries no `rails`: a bundle's
//       rail handles live in catalog/bundles.json `priceIds`.
//   D · STORE ([ADR 093] §2) — a store price is web × 1.20 snapped UP, the same
//       number on Apple and on Google: `store.<CUR>` × 100 ≥ web × 120, for USD
//       and INR, and no other currency key ("Other currencies follow each
//       store's own equalisation ... None is set by hand"). A `readBack` (the
//       value a store accepted) is never BELOW `store`. The lifetime plan has no
//       `store`: [ADR 093] keeps it web-only.
//       The break-even floor (× 1.176) is not a separate check: × 1.20 implies
//       it, so a limb for it could never fail on its own. "The nearest valid
//       store point" is a vendor list the ADR records as unread; nothing here
//       encodes one, which is why a read-back may sit above `store`.
//       ⏱ 2026-10-01 (EXM-04): a product in extensions/catalog/extensions.json has no
//       `store` either, and carrying one is exit 1. A browser store sells no
//       in-extension product; FullShot Pro is sold on the nikatru.com checkout only
//       (decisions/ext/015), at [ADR 093]'s single-app web tier.
//   E · ONE HOME — no TypeScript file under services/platform/src but the
//       rendered one carries a `pri_…` or `plan_…` rail id or declares one of
//       the rendered map names. A hand map re-added to checkout.ts is red here,
//       where tooling/ci/assert-no-price-literals.mjs (Dart and listing text)
//       cannot see it.
//   F · RENDERED (--check) — rail-price-ids.ts is byte-for-byte this renderer's
//       output. A hand edit to it is exit 1 (the row's own red control).
//   G · NET (AB-M5-01, AB-M5-03) — every plan's NET on every app channel of
//       tooling/channel-register.json, derived from tooling/catalog/fee-register.json
//       (dated reads of each vendor's published fee), never typed. A fee cell the
//       sheet needs is {value, asOf, verify} with a non-null value, or exit 1: a
//       null Paddle sub-$10 cell is a net nobody measured. Its `asOf` is a day that
//       has happened and at most 90 days old (30 for a LIMITED-TIME offer, read
//       off the cell's `offer` or `quote`), or exit 1: nothing runs `verify`, so
//       the age is the only thing that makes a cell get re-read. A fixed part of a
//       fee (`fixedMinor`) applies only to a price in its `fixedCurrency`, or
//       exit 1. A channel that can sell
//       and nets below the `web` row of the same plan is exit 1 — [ADR 093] §2's
//       ×1.20 exists so a store sale nets at least a web sale, and this is the
//       limb that checks the outcome instead of the ratio. ONE EXCEPTION, printed
//       on every run and never silent: an `apple-iap` channel while
//       `apple-small-business-enrolment` carries no approval date (judged by
//       tooling/catalog/sbp-enrolment.mjs, the gate's own check) nets at the standard rate
//       (below web) and is GATED rather than failed, because
//       tooling/ci/assert-small-business-program.mjs refuses a real App Store
//       submission until the owner records the enrolment (A-18, AB-M5-02).
//       `--net-sheet` prints the whole table; the India web book (Razorpay, INR,
//       GST out of the price, [ADR 076] §10.1) is printed beside it.
//   H · STORE READ-BACK (AB-M5-05) — a plan an app declares live on a store
//       (apps/<id>/app.yaml `billing.mobileIap.state: live`, its
//       `storeProducts`, one store per `revenuecatAppIds` key) carries that
//       store's `store.readBack.<apple|google>` as { USD, INR, readAt }: the
//       store accepted a price, so the register records what it accepted rather
//       than leaving the target to stand in for the fact.
//   I · TAX MODE (O-TAX-TREATMENT-STATED-TWO-WAYS) — every rail entry, a read-back
//       or pending, carries `taxMode`: `inclusive`, `exclusive`, or `unread`, and
//       `unread` only on a rail whose mode is a vendor READ-BACK (TAX_MODE_READ_BACK:
//       Paddle reports `tax_mode` on the read that fetches the price). Every entry of
//       one rail states the same mode: the buyer reads ONE tax sentence per rail, and
//       tooling/sites/generate-discovery.mjs renders it from `railTaxModes` below. A
//       rail with no taxMode is the row's red control.
//   J · THE INDIA BOOK (⏱ 2026-10-02, PR #1149 ruling item 5) — `webInrMinor` is the
//       India web book config.ts serves under `?market=IN` and the `PRICING:india` block
//       quotes, so it prices exactly what the India rail can SELL: every recurring
//       offering carries an integer `webInrMinor` (a Razorpay subscription PLAN sells
//       it), and a one-time (lifetime) offering carries NONE while
//       RAZORPAY_ORDER_PATH_BUILT is false — the order path (POST /v1/orders) that
//       would sell it as a Razorpay ITEM is not built (razorpay-rail.ts), so an India
//       buyer shown it would meet a 503 for a price the page advertised.
//   COVERAGE LOST (exit 2) — the register missing or unparseable, no `prices`
//   section, zero served offerings or zero price-book entries read, no
//   TypeScript source to sweep, or catalog/bundles.json unreadable; the fee
//   register or the channel register unreadable, no `web` channel row, or zero
//   net rows derived; an app.yaml that limb H needs unreadable.
//
// ⬜ RAZORPAY IS PENDING ON EVERY PLAN, AND EVERY RUN SAYS SO. Razorpay PR B (the
// creator registry and rail resolution in the door) is designed, not briefed,
// and no Razorpay plan exists until the owner creates it ([ADR 094]). So
// RAZORPAY_PLAN_IDS renders empty and RAZORPAY_PRICE_PENDING carries each
// reason; PR B imports both from the rendered file instead of hand-writing a
// map of its own. The `⬜ razorpay` line below counts them on every run.
//
// ── THE OWNER'S STORE SHEET ──────────────────────────────────────────────────
// `--store-sheet <app>` prints, per store, each product id (app.yaml
// `billing.mobileIap.storeProducts`, 12a; bundle SKUs from catalog/bundles.json
// `storeProducts`) with its store price in USD and INR. It is the input to owner
// step O-B3. It prints and writes nothing.
//
// ── WHY EACH MAP EXISTS (moved verbatim) ─────────────────────────────────────
// The three doc comments below were the JSDoc of PADDLE_PRICE_IDS,
// RAIL_PRICE_AMOUNTS_MINOR and RAIL_PRICE_PENDING in
// services/platform/src/routes/checkout.ts until this renderer took the maps
// over (moved verbatim from the NP-Db draft 190ded6f's text). Where one says
// "this file" or "here", it meant checkout.ts; the maps now live in the rendered
// file and their values in the register's `rails`.
// ⏱ 2026-09-27 (D-c): the first block's "⬜ AND IT BELONGS IN
// `src/app-config-data.json`" is done — the ids live in that file's `prices`.
// /**
//  * OUR offering id → PADDLE's price id, per app. Measured live by API on
//  * 2026-09-22 09:20:50Z, under the owner's standing delegation of 2026-09-15:
//  *   `pri_01m346p0fjtaffk6waj5x5vz1c` — Pro Monthly, 599 minor units USD / month
//  *   `pri_01m346p0v8103kqy1zb8zmmj7y` — Pro Yearly, 3499 minor units USD / year
//  * both under product `pro_01kzew6de0nhqncmgxj1qtfg0q`, whose NAME now reads
//  * "Nikatru Subscription Tracker Pro" — the catalogue carries the product name a
//  * buyer sees on the receipt, so it is renamed with everything else.
//  *
//  * ⏱ 2026-09-27 · `pro_lifetime` → `pri_01m346p14yzeqjjwj153thx8p2`, READ BACK by
//  * `GET /prices/pri_01m346p14yzeqjjwj153thx8p2` at 2026-09-26T23:43:12Z (one
//  * read-only call with the live API key): `status` active, `unit_price` 8900 USD,
//  * `billing_cycle` null (one-time), `trial_period` null, product
//  * `pro_01kzew6de0nhqncmgxj1qtfg0q`, `custom_data { app_id: "subscriptiontracker",
//  * offering_id: "pro_lifetime", adr093: "pro_lifetime" }`. It left
//  * RAIL_PRICE_PENDING in the change that built its grant path: a completed
//  * one-time transaction for it is granted through src/lib/mor/grant.ts with no end
//  * date (O-ONE-TIME-GRANT-UNBUILT).
//  *
//  * 🔄 THESE TWO IDS REPLACED A PAIR MEASURED 2026-08-11 ([ADR 044] §7:
//  * `pri_01kzew6dqmtv3jg33dy9m23g31` at 499/month and `pri_01kzew6e0yec2rfvk561hmzbbz`
//  * at 1999/year). A Paddle price is IMMUTABLE in its amount: moving a price means
//  * creating a new one and archiving the old, which is what happened — the two
//  * 2026-08-11 prices were archived on 2026-09-22, so nothing can transact on them
//  * and the old ids are dead rather than merely unused. They are written out here
//  * because a dead id in a log line is otherwise unidentifiable.
//  *
//  * 🔴 THE JOIN IS `custom_data.offering_id` ON PADDLE'S OWN PRICE, not a
//  * coincidence of naming: both live prices carry `custom_data { app_id: "subscriptiontracker",
//  * offering_id: "pro_monthly" | "pro_yearly", adr093: ... }`, which is what makes
//  * these two lines checkable against the rail rather than asserted. The archived
//  * pair carried the retired product name in that same field, so the custom_data
//  * is also what tells the two generations apart in a webhook.
//  *
//  * ⬜ WHAT IS NOT RECORDED HERE: the `trial_period` on the new prices. The
//  * 2026-08-11 pair carried 30 days with `requires_payment_method: true`; this
//  * file does not claim the same of the new pair, because that was not part of the
//  * 2026-09-22 measurement and a trial is a term a buyer is owed. Read it from
//  * Paddle and record it here before `paywall.enabled` goes true.
//  *
//  * ⚠️ A CALLER NEVER NAMES A PRICE. The body carries our offering id and the
//  * server resolves it here, so no request can create a transaction for an
//  * arbitrary price on the account — which is the difference between an endpoint
//  * that sells two SKUs and one that sells whatever the client typed.
//  *
//  * ⬜ AND IT BELONGS IN `src/app-config-data.json`, BESIDE THE OFFERINGS IT MAPS.
//  * It is here because that document is [pipeline 4]B-2's served-config data with
//  * its own three readers and its own registry guard, and adding a vendor id to it
//  * is a change to a shared file, not to this route. The cost of the split is that
//  * two lists can disagree — so they are compared: `test/checkout.test.ts` asserts
//  * this map covers EVERY offering the served config declares for every app it
//  * names, and fails the moment a third SKU is added to one and not the other.
//  */
//
// /**
//  * WHAT EACH MAPPED PRICE ACTUALLY COSTS **ON PADDLE**, in minor units of the
//  * currency the Paddle price carries. Measured live by API on 2026-09-22
//  * 09:20:50Z, in the same read that recorded the ids above; NOT re-derived from
//  * `app-config-data.json`.
//  *
//  * 🔴 IT IS A SECOND COPY OF A PRICE ON PURPOSE, WHICH THIS REPOSITORY OTHERWISE
//  * FORBIDS. The rule that a price lives in exactly one place
//  * (`assert-no-price-literals.mjs`, [pipeline 5]M-11) is about OUR price. This is
//  * not ours — it is a fact about a row in a vendor's catalogue that we cannot
//  * read at build time and cannot change from this repository. The choice is
//  * between recording it here where it can be compared, and not recording it at
//  * all, in which case `app-config-data.json` can be moved to any number while
//  * `POST /v1/checkout` goes on resolving a `pri_` that charges the old one. The
//  * page would quote $34.99 and the transaction would bill $19.99, and NOTHING in
//  * this repository could see it — the same shape as the defect M-11 is named
//  * after, one layer further out.
//  *
//  * ⚠️ SO THE ONLY LEGITIMATE WAY TO EDIT THIS MAP IS TO READ PADDLE. Never edit
//  * it to match `app-config-data.json`. The two disagreeing is the signal.
//  */
//
// /**
//  * OFFERINGS THE SERVED CONFIG DECLARES THAT THE RAIL CANNOT SELL AT THAT PRICE
//  * TODAY, each with the reason and the owner action that clears it.
//  *
//  * 🔴 THIS IS NOT AN EXEMPTION LIST AND IT MUST NOT BECOME ONE. The invariant it
//  * encodes is narrow and is the honest one: **a price may be DECIDED before the
//  * rail carries it, but nothing may be SOLD at a price the rail does not carry.**
//  * `test/checkout.test.ts` enforces both halves — an entry here is required to
//  * carry a non-empty reason, and this map must be EMPTY for any app whose
//  * `paywall.enabled` is true. Flipping that switch with an entry standing is the
//  * failure, not the entry.
//  *
//  * The runtime already refuses safely either way: an offering with no `pri_` id
//  * answers **503 `offering_not_available`** in the `PADDLE_PRICE_IDS` lookup
//  * below and logs the drift by name. What this map adds is that the drift is
//  * DECLARED rather than discovered.
//  *
//  * ⚠️ CLEARING AN ENTRY IS A CATALOGUE ACT, NOT AN EDIT TO THIS FILE. The
//  * catalogue row has to exist first, and the two maps above then get the values
//  * READ BACK from it. The write itself is the agent's, by API, under the owner's
//  * standing delegation of 2026-09-15 — what is never the agent's is deciding the
//  * number: that is the ADR's, and the owner's.
//  */
//
// Usage:  node tooling/catalog/render-rail-prices.mjs [root]                 render (write)
//         node tooling/catalog/render-rail-prices.mjs [root] --check         compare, write nothing
//         node tooling/catalog/render-rail-prices.mjs [root] --store-sheet <app>
//         node tooling/catalog/render-rail-prices.mjs [root] --net-sheet [--check]   print net per channel
//         [--now=<ISO instant ending Z>]   the clock limb G grades fee-cell ages and the enrolment date
//                                          against; default the real one. Tests pass it so no case
//                                          depends on the day it runs (#1088 review, minor 2).
// Exit:   0 ok · 1 a finding (nothing written) · 2 COVERAGE LOST
// Tests:  tooling/ci/test/rail-prices.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogFile, BUNDLES_REGISTER } from './read.mjs';
import { readDeclaration } from '../app-yaml/render.mjs';
import { SBP_ENROLMENT_CELL, readEnrolment } from './sbp-enrolment.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The price register, repo-relative ([pipeline 5]M-11). */
export const REGISTER = 'services/platform/src/app-config-data.json';
/** The rendered module checkout.ts imports. */
export const RENDERED = 'services/platform/src/routes/rail-price-ids.ts';
/** Where limb E looks for a second home of a rail id. */
export const SOURCE_DIR = 'services/platform/src';
/** The rails an entry must declare, each a read-back or pending. */
export const RAILS = ['paddle', 'razorpay'];

/**
 * Each rail's rendered sellable-id map, BY NAME. One explicit row per rail (#1127 money
 * review, nit 5): before, every rail but Paddle was bound to Razorpay's plan ids, so a third
 * rail added to RAILS (Cashfree, say) would have sold Razorpay's plans. A rail with no row
 * here throws, so the render fails instead of guessing.
 */
export const RAIL_PRICE_MAP = Object.freeze({ paddle: 'PADDLE_PRICE_IDS', razorpay: 'RAZORPAY_PLAN_IDS' });

/** The map name RAIL_PRICE_IDS binds `rail` to; throws on a rail with no explicit row. */
export function railPriceMapFor(rail) {
  if (!Object.hasOwn(RAIL_PRICE_MAP, rail)) {
    throw new Error(`render-rail-prices: rail ${JSON.stringify(rail)} has no row in RAIL_PRICE_MAP; add its own sellable-id map, never another rail's`);
  }
  return RAIL_PRICE_MAP[rail];
}

/** The served `term` → the plan an app offering is. */
export const APP_PLANS = Object.freeze({ month: 'single-monthly', year: 'single-yearly', one_time: 'single-lifetime' });
/** ⏱ 2026-10-02 · PR #1149 ruling item 5 (limb J). Whether the Razorpay ONE-TIME ORDER path (POST /v1/orders,
 *  a Razorpay ITEM) exists. Until it does, the India rail sells subscription PLANS only, and a one-time offering is
 *  out of the India book: no `webInrMinor`, so neither config.ts nor the `PRICING:india` block shows it. */
export const RAZORPAY_ORDER_PATH_BUILT = false;
/** Is an offering of this served `term` in the India web book? Read by limb J, generate-discovery.mjs's India
 *  block and assert-discovery-surface.mjs limb T — one answer, three readers. */
export const inIndiaBook = (term) => term !== 'one_time' || RAZORPAY_ORDER_PATH_BUILT;
/** The served `term` → the plan a bundle offering is. A bundle has no lifetime plan. */
export const BUNDLE_PLANS = Object.freeze({ month: 'bundle-monthly', year: 'bundle-yearly' });
/** [ADR 093] §2: the store column carries these currencies and no other. */
export const STORE_CURRENCIES = ['USD', 'INR'];
/** The stores whose accepted value a `readBack` records. */
export const STORE_READERS = ['apple', 'google'];
/** [ADR 093] §2: store ≥ web × 1.20, in integer percent so no float rounds a cent. */
export const MARKUP_PERCENT = 120;
/** Limb G's fee cells: dated reads of each vendor's published fee (AB-M5-01). */
export const FEE_REGISTER = 'tooling/catalog/fee-register.json';
/** Limb G's channels: every `surface: app` row and its `purchaseRail`. */
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
/** The extension register: a product named there is sold on the web checkout only, so it has no store column. */
export const EXTENSION_REGISTER = 'extensions/catalog/extensions.json';
/** The row every other channel's net is compared to. */
export const WEB_CHANNEL = 'web';
/** The fee cells limb G applies, by what they price. */
export const FEE_CELLS = Object.freeze({
  paddle: 'paddle-checkout',
  paddleUnderThreshold: 'paddle-under-10',
  appleStandard: 'apple-iap-standard',
  appleSmallBusiness: 'apple-iap-small-business',
  playSubscription: 'play-billing-subscription',
  razorpayPlatform: 'razorpay-platform',
  razorpaySubscription: 'razorpay-subscription-add-on',
  indiaGst: 'india-gst',
});
/** The owner-attested Small Business Program approval date (A-18): it selects the Apple cell. */
export { SBP_ENROLMENT_CELL };
/** A fee cell's `asOf` may be at most this old (days); a limited-time offer's, the shorter. */
export const MAX_FEE_AGE_DAYS = 90;
export const MAX_OFFER_AGE_DAYS = 30;
const DAY_MS = 86400000;
/** A cell whose rate is a vendor's time-limited offer, read off its own `offer` or quoted words. */
const isLimitedTime = (c) => /limited[\s-]time/i.test(`${c?.value?.offer ?? ''} ${c?.quote ?? ''}`);
/** app.yaml `revenuecatAppIds` key → the store whose read-back limb H requires. */
const STORE_OF_RC_KEY = Object.freeze({ ios: 'apple', android: 'google' });
const ISO_DAY_OR_INSTANT = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/;
const BPS = 10000;
/** The map names limb E refuses anywhere but the rendered module. */
export const MAP_NAMES = [
  'PADDLE_PRICE_IDS',
  'RAIL_PRICE_AMOUNTS_MINOR',
  'RAIL_PRICE_PENDING',
  'RAZORPAY_PLAN_IDS',
  'RAZORPAY_PRICE_PENDING',
  'RAIL_PRICE_IDS',
];

const MIN_REASON = 20;
/** Limb I: whether a rail's price already includes the tax due on it. */
export const TAX_MODES = Object.freeze(['inclusive', 'exclusive', 'unread']);
/** Limb I: the rails whose tax mode is a VENDOR READ-BACK, so `unread` is honest until the next read. */
export const TAX_MODE_READ_BACK = Object.freeze(['paddle']);
const RAIL_ID = Object.freeze({
  paddle: { key: 'priceId', re: /^pri_[a-z0-9]{26}$/, currency: 'USD' },
  razorpay: { key: 'planId', re: /^plan_[A-Za-z0-9]{14}$/, currency: 'INR' },
});
const ID_ANYWHERE = /\b(?:pri_[a-z0-9]{26}|plan_[A-Za-z0-9]{14})\b/g;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const dataKeys = (o) => Object.keys(o).filter((k) => !k.startsWith('_'));

/**
 * Read the register.
 * @returns {{ ok: true, data: any, why: null } | { ok: false, data: null, why: string }}
 */
export function readRegister(root) {
  const p = join(root, REGISTER);
  if (!existsSync(p)) return { ok: false, data: null, why: `${REGISTER} does not exist` };
  try {
    return { ok: true, data: JSON.parse(readFileSync(p, 'utf8')), why: null };
  } catch (e) {
    return { ok: false, data: null, why: `${REGISTER} is not valid JSON (${e.message})` };
  }
}

/** Limb D for one entry. `web` is { USD, INR } in minor units. */
function gradeStore(where, entry, web, lifetime, problems, extension = false) {
  if (extension) {
    if (entry.store !== undefined) {
      problems.push(
        `${where} prices an extension (${EXTENSION_REGISTER}) and carries a \`store\` price. A browser store sells ` +
          'no in-extension product: FullShot Pro is bought on the nikatru.com checkout only (decisions/ext/015), so ' +
          '[ADR 093] §2\'s store column has nothing to price; delete `store`.',
      );
    }
    return;
  }
  if (lifetime) {
    if (entry.store !== undefined) {
      problems.push(
        `${where} is the lifetime plan and carries a \`store\` price. [ADR 093] §2 keeps the lifetime plan on the web ` +
          'checkout only ("never sold in-app"); delete `store`.',
      );
    }
    return;
  }
  const store = entry.store;
  if (!isObj(store)) {
    problems.push(`${where} has no \`store\` object. Every plan a store sells carries [ADR 093] §2's store column.`);
    return;
  }
  for (const k of Object.keys(store)) {
    if (!STORE_CURRENCIES.includes(k) && k !== 'readBack') {
      problems.push(
        `${where}.store carries "${k}". The register holds ${STORE_CURRENCIES.join(' and ')} only: [ADR 093] §2 ` +
          '"Other currencies follow each store\'s own equalisation ... None is set by hand."',
      );
    }
  }
  for (const cur of STORE_CURRENCIES) {
    const s = store[cur];
    const w = web[cur];
    if (!Number.isInteger(s) || s <= 0) {
      problems.push(`${where}.store.${cur} is ${JSON.stringify(s)}, not a positive integer of minor units.`);
      continue;
    }
    if (!Number.isInteger(w) || w <= 0) {
      problems.push(`${where}: the web ${cur} price is ${JSON.stringify(w)}, so the store rule has nothing to grade against.`);
      continue;
    }
    if (s * 100 < w * MARKUP_PERCENT) {
      problems.push(
        `${where}.store.${cur} is ${s}, below the web price ${w} × 1.20 = ${(w * MARKUP_PERCENT) / 100}. [ADR 093] §2: a ` +
          'store price is web × 1.20 rounded UP to a valid store point, never down.',
      );
    }
  }
  const rb = store.readBack;
  if (!isObj(rb)) {
    problems.push(`${where}.store.readBack is ${JSON.stringify(rb)}; it is { apple, google }, each null until a store accepts a price.`);
    return;
  }
  for (const k of Object.keys(rb)) {
    if (!STORE_READERS.includes(k)) problems.push(`${where}.store.readBack carries "${k}"; only ${STORE_READERS.join(', ')}.`);
  }
  for (const who of STORE_READERS) {
    const got = rb[who];
    if (got === null || got === undefined) continue;
    if (!isObj(got)) {
      problems.push(`${where}.store.readBack.${who} is ${JSON.stringify(got)}; it is null or { USD, INR, readAt } as the store accepted them.`);
      continue;
    }
    if (typeof got.readAt !== 'string' || !ISO_DAY_OR_INSTANT.test(got.readAt)) {
      problems.push(
        `${where}.store.readBack.${who}.readAt is ${JSON.stringify(got.readAt)}; a read-back says when the store console ` +
          'was read (YYYY-MM-DD, or an ISO instant ending Z).',
      );
    }
    for (const cur of STORE_CURRENCIES) {
      if (!(cur in got)) problems.push(`${where}.store.readBack.${who} carries no ${cur}; a read-back records every currency the store column sets.`);
    }
    for (const [cur, v] of Object.entries(got)) {
      if (cur === 'readAt') continue;
      if (!STORE_CURRENCIES.includes(cur)) {
        problems.push(`${where}.store.readBack.${who} carries "${cur}"; only ${STORE_CURRENCIES.join(', ')}.`);
      } else if (!Number.isInteger(v) || v < store[cur]) {
        problems.push(
          `${where}.store.readBack.${who}.${cur} is ${JSON.stringify(v)}, below the store price ${store[cur]}. A store ` +
            'point that is not valid moves UP to the next valid one ([ADR 093] §2), never below the target.',
        );
      }
    }
  }
}

/** Limb I: one rail entry's `taxMode`. */
function gradeTaxMode(where, rail, r, problems) {
  if (!('taxMode' in r)) {
    problems.push(
      `${where}.rails.${rail} has no \`taxMode\`. Every rail entry says whether its price includes the tax due on it ` +
        `(${TAX_MODES.join(' | ')}): the published tax sentence is rendered from it, so a rail without one has no sentence.`,
    );
    return;
  }
  if (!TAX_MODES.includes(r.taxMode)) {
    problems.push(`${where}.rails.${rail}.taxMode is ${JSON.stringify(r.taxMode)}; it is one of ${TAX_MODES.join(', ')}.`);
    return;
  }
  if (r.taxMode === 'unread' && !TAX_MODE_READ_BACK.includes(rail)) {
    problems.push(
      `${where}.rails.${rail}.taxMode is "unread", but ${rail}'s mode is decided, not read back from a vendor ` +
        `(read-back rails: ${TAX_MODE_READ_BACK.join(', ')}). State it.`,
    );
  }
}

/**
 * Limb I's answer: the ONE tax mode each rail states across every app entry, or a problem per
 * rail whose entries disagree or carry none. generate-discovery.mjs renders the tax sentences
 * from `modes`; a rail missing from it has no sentence and the generator refuses.
 * @returns {{ modes: Record<string, string>, problems: string[] }}
 */
export function railTaxModes(data) {
  const problems = [];
  const seen = new Map(RAILS.map((rail) => [rail, new Map()]));
  const bookApps = isObj(data?.prices?.apps) ? data.prices.apps : {};
  for (const app of dataKeys(bookApps)) {
    const entries = isObj(bookApps[app]) ? bookApps[app] : {};
    for (const id of dataKeys(entries)) {
      for (const rail of RAILS) {
        const mode = entries[id]?.rails?.[rail]?.taxMode;
        if (typeof mode !== 'string') continue;
        const at = seen.get(rail);
        if (!at.has(mode)) at.set(mode, []);
        at.get(mode).push(`prices.apps.${app}.${id}`);
      }
    }
  }
  const modes = {};
  for (const [rail, at] of seen) {
    if (at.size === 1) modes[rail] = [...at.keys()][0];
    else if (at.size === 0) problems.push(`no price-book entry states a taxMode for ${rail}, so ${rail} has no tax sentence.`);
    else {
      problems.push(
        `${rail} states ${at.size} tax modes (${[...at].map(([m, w]) => `${m}: ${w.join(', ')}`).join('; ')}). ` +
          'A buyer reads one tax sentence per rail; read the vendor and state one.',
      );
    }
  }
  return { modes, problems };
}

/** Limb C for one app entry. Returns the read-back ids it declares, for the duplicate check. */
function gradeRails(where, entry, web, problems) {
  const rails = entry.rails;
  const ids = [];
  if (!isObj(rails)) {
    problems.push(`${where} has no \`rails\` object; it declares ${RAILS.join(' and ')}, each a read-back or pending.`);
    return ids;
  }
  for (const k of Object.keys(rails)) {
    if (!RAILS.includes(k)) problems.push(`${where}.rails carries "${k}"; the rails are ${RAILS.join(', ')}.`);
  }
  for (const rail of RAILS) {
    const r = rails[rail];
    const spec = RAIL_ID[rail];
    if (!isObj(r)) {
      problems.push(`${where}.rails.${rail} is missing. Declare it: a read-back, or { "pending": "<why>" }.`);
      continue;
    }
    gradeTaxMode(where, rail, r, problems);
    if ('pending' in r) {
      // `taxMode` is a fact about the RAIL, not the price, so a pending entry carries it too (limb I).
      const extra = Object.keys(r).filter((k) => k !== 'pending' && k !== 'taxMode');
      if (typeof r.pending !== 'string' || r.pending.trim().length < MIN_REASON) {
        problems.push(
          `${where}.rails.${rail}.pending is ${JSON.stringify(r.pending)}. A pending rail carries its reason ` +
            `(${MIN_REASON}+ characters): a price may be DECIDED before the rail carries it, never sold without one.`,
        );
      }
      if (extra.length) problems.push(`${where}.rails.${rail} is pending and also carries ${extra.join(', ')}; it is one or the other.`);
      continue;
    }
    const id = r[spec.key];
    if (typeof id !== 'string' || !spec.re.test(id)) {
      problems.push(`${where}.rails.${rail}.${spec.key} is ${JSON.stringify(id)}, not a ${rail} id (${spec.re.source}).`);
    } else {
      ids.push({ rail, id, where });
    }
    if (typeof r.readAt !== 'string' || !ISO_INSTANT.test(r.readAt)) {
      problems.push(`${where}.rails.${rail}.readAt is ${JSON.stringify(r.readAt)}; a read-back says when the vendor was read (ISO instant, Z).`);
    }
    const want = web[spec.currency];
    if (!Number.isInteger(r.amountMinor) || r.amountMinor !== want) {
      problems.push(
        `${where}.rails.${rail}.amountMinor is ${JSON.stringify(r.amountMinor)} while the web ${spec.currency} price it ` +
          `sells is ${JSON.stringify(want)}. The two disagreeing is the signal: read the vendor, never edit the ` +
          'amount to match.',
      );
    }
  }
  return ids;
}

/**
 * Grade the register and plan the rendering.
 * @returns {{ lost: string[], problems: string[], book: {app: string, offerings: object[]}[], counts: object }}
 */
export function plan(root, data) {
  const lost = [];
  const problems = [];
  const book = [];
  const counts = { served: 0, entries: 0, bundles: 0, razorpayPending: 0, razorpayTotal: 0, sources: 0, readBacks: 0 };
  const prices = isObj(data?.prices) ? data.prices : null;
  if (!prices) {
    lost.push(`${REGISTER} has no \`prices\` section, so there is nothing to render and nothing to grade.`);
    return { lost, problems, book, counts };
  }
  const servedApps = isObj(data.apps) ? data.apps : {};
  const bookApps = isObj(prices.apps) ? prices.apps : {};
  const seenIds = new Map();
  const extensions = extensionSlugs(root, servedApps, bookApps, lost);

  // A · the join, from the served side.
  for (const app of dataKeys(servedApps).sort()) {
    const offerings = servedApps[app]?.paywall?.offerings;
    if (!Array.isArray(offerings) || offerings.length === 0) continue;
    const entries = isObj(bookApps[app]) ? bookApps[app] : {};
    const rows = [];
    for (const o of offerings) {
      counts.served++;
      const id = o?.product_id;
      const where = `${REGISTER} prices.apps.${app}.${id}`;
      const entry = entries[id];
      if (!isObj(entry)) {
        problems.push(
          `apps.${app} serves offering "${id}" and prices.apps.${app} has no entry for it. A served offering is ` +
            'priced on every rail and store here, or declared pending here, before it is sold.',
        );
        continue;
      }
      counts.entries++;
      // B · the plan its term implies.
      const want = APP_PLANS[o.term];
      if (!want) problems.push(`apps.${app} offering "${id}" has term ${JSON.stringify(o.term)}, which maps to no plan.`);
      else if (entry.plan !== want) {
        problems.push(`${where}.plan is ${JSON.stringify(entry.plan)}; its served term "${o.term}" makes it "${want}".`);
      }
      if (o.currency_code !== 'USD') {
        problems.push(`apps.${app} offering "${id}" is served in ${JSON.stringify(o.currency_code)}; the web column here is USD.`);
      }
      const web = { USD: o.amount_minor, INR: entry.webInrMinor };
      // J · the India book prices exactly what the India rail can sell.
      if (inIndiaBook(o.term) && !(Number.isInteger(entry.webInrMinor) && entry.webInrMinor > 0)) {
        problems.push(`${where} has no integer webInrMinor: a recurring offering is sold in India as a Razorpay plan, and the India book (config.ts ?market=IN, the PRICING:india block) needs its rupee price.`);
      } else if (!inIndiaBook(o.term) && entry.webInrMinor !== undefined) {
        problems.push(
          `${where} is a one-time offering and carries webInrMinor, so India buyers would be shown it; the Razorpay order path ` +
            '(POST /v1/orders) that would sell it is not built (RAZORPAY_ORDER_PATH_BUILT). Leave it out of the India book until it is.',
        );
      }
      // C · the rails.
      for (const hit of gradeRails(where, entry, web, problems)) {
        const prior = seenIds.get(hit.id);
        if (prior) problems.push(`${hit.where}.rails.${hit.rail} and ${prior} both name ${hit.id}. One rail id sells one offering.`);
        else seenIds.set(hit.id, `${hit.where}.rails.${hit.rail}`);
      }
      const rz = entry.rails?.razorpay;
      counts.razorpayTotal++;
      if (isObj(rz) && 'pending' in rz) counts.razorpayPending++;
      // D · the store column.
      gradeStore(where, entry, web, o.term === 'one_time', problems, extensions.has(app));
      rows.push({ id, entry, webUsd: o.amount_minor, term: o.term });
    }
    book.push({ app, offerings: rows, extension: extensions.has(app) });
  }
  // A · the join, from the book side.
  for (const app of dataKeys(bookApps)) {
    const served = servedApps[app]?.paywall?.offerings;
    const ids = new Set(Array.isArray(served) ? served.map((o) => o?.product_id) : []);
    for (const id of dataKeys(isObj(bookApps[app]) ? bookApps[app] : {})) {
      if (!ids.has(id)) {
        problems.push(
          `prices.apps.${app}.${id} prices an offering apps.${app} does not serve. A price with nothing to sell is ` +
            'dead data that reads as a live one; delete it, or serve the offering.',
        );
      }
    }
  }

  // The bundle plans: B, C (none), D. Keyed by PLAN, as [ADR 093] §2 prices "the bundle" per
  // plan. Not by feature set: this file is read as served copy by assert-no-store-bundle-copy,
  // which refuses a feature-set identifier in it.
  const bundles = isObj(prices.bundles) ? prices.bundles : {};
  for (const key of dataKeys(bundles)) {
    counts.bundles++;
    const entry = bundles[key];
    const where = `${REGISTER} prices.bundles.${key}`;
    if (!isObj(entry)) {
      problems.push(`${where} is not an object.`);
      continue;
    }
    const want = BUNDLE_PLANS[entry.term];
    if (!want || entry.plan !== want || key !== want) {
      problems.push(`${where}: key "${key}", plan ${JSON.stringify(entry.plan)} and term ${JSON.stringify(entry.term)} must agree (month → bundle-monthly, year → bundle-yearly).`);
    }
    if (entry.currency_code !== 'USD' || !Number.isInteger(entry.amount_minor)) {
      problems.push(`${where} needs an integer amount_minor in USD, the bundle's web price.`);
    }
    if (entry.rails !== undefined) {
      problems.push(
        `${where} carries \`rails\`. A bundle's rail handles live in ${BUNDLES_REGISTER} \`priceIds\`; a copy here is ` +
          'a second home for the same id.',
      );
    }
    gradeStore(where, entry, { USD: entry.amount_minor, INR: entry.webInrMinor }, false, problems);
  }

  // E · one home for a rail id.
  const srcRoot = join(root, SOURCE_DIR);
  const tsFiles = existsSync(srcRoot) ? walkTs(srcRoot) : [];
  counts.sources = tsFiles.length;
  const renderedAbs = resolve(root, RENDERED);
  const declares = new RegExp(`\\b(?:const|let|var)\\s+(${MAP_NAMES.join('|')})\\b`, 'g');
  for (const abs of tsFiles) {
    if (resolve(abs) === renderedAbs) continue;
    const rel = relative(root, abs).split('\\').join('/');
    const text = readFileSync(abs, 'utf8');
    const ids = [...new Set(text.match(ID_ANYWHERE) ?? [])];
    if (ids.length) {
      problems.push(
        `${rel} carries the rail id(s) ${ids.join(', ')}. A rail id lives in ${REGISTER} \`prices\` and reaches the ` +
          `Worker through ${RENDERED} only; import it from there.`,
      );
    }
    for (const m of text.matchAll(declares)) {
      problems.push(`${rel} declares ${m[1]}, a map ${RENDERED} renders. Import it; a hand copy is the map this row retired.`);
    }
  }

  // H · a plan live on a store records what the store accepted.
  counts.readBacks = gradeReadBacks(root, book, problems, lost);

  // I · one tax mode per rail (each entry's own taxMode was graded with its rail, above).
  const tax = railTaxModes(data);
  problems.push(...tax.problems.filter((p) => !p.startsWith('no price-book entry')));
  counts.taxModes = tax.modes;

  if (counts.served === 0) lost.push(`${REGISTER} serves zero offerings, so no rail map has anything to render.`);
  if (counts.entries === 0) lost.push(`${REGISTER} prices zero served offerings: the price book read as empty.`);
  if (counts.sources === 0) lost.push(`${SOURCE_DIR} yielded no TypeScript file, so limb E swept nothing.`);
  return { lost, problems, book, counts };
}

/**
 * ⏱ 2026-10-01 (EXM-04). The ids in the extension register, read only when the register prices one: the
 * store column is an app-store fact, and an extension is sold on the web checkout alone (limb D). An
 * unreadable register while an extension may be priced is COVERAGE LOST, never "no extension".
 */
function extensionSlugs(root, servedApps, bookApps, lost) {
  const out = new Set();
  const reg = readCatalogFile(root, EXTENSION_REGISTER);
  if (!reg.ok) {
    const named = [...dataKeys(servedApps), ...dataKeys(bookApps)];
    if (named.length) lost.push(`${reg.why}, so limb D cannot tell an extension (web only) from an app (store column).`);
    return out;
  }
  for (const row of Array.isArray(reg.value) ? reg.value : []) {
    if (isObj(row) && typeof row.slug === 'string') out.add(row.slug);
  }
  return out;
}

function walkTs(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkTs(p));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

/**
 * Limb H (AB-M5-05). A plan an app declares live on a store carries that store's read-back. The store is
 * named by app.yaml `billing.mobileIap.revenuecatAppIds` (ios → apple, android → google): a RevenueCat app
 * exists for a store only once its console holds the products. Returns how many read-backs were required.
 */
function gradeReadBacks(root, book, problems, lost) {
  let required = 0;
  for (const { app, offerings, extension } of book) {
    if (extension) continue; // no app.yaml and no store: limb D refuses a store column on an extension
    if (!offerings.some(({ entry }) => isObj(entry.store))) continue;
    let decl;
    try {
      decl = readDeclaration(root, app);
    } catch (e) {
      lost.push(`apps/${app}/app.yaml could not be read (${e.message}), so limb H cannot tell which plan a store sells.`);
      continue;
    }
    const iap = decl?.billing?.mobileIap;
    if (iap?.state !== 'live') continue;
    const stores = Object.keys(isObj(iap.revenuecatAppIds) ? iap.revenuecatAppIds : {})
      .map((k) => STORE_OF_RC_KEY[k])
      .filter(Boolean);
    const byPlan = new Map(offerings.map(({ id, entry }) => [entry.plan, { id, entry }]));
    for (const p of Array.isArray(iap.storeProducts) ? iap.storeProducts : []) {
      const hit = byPlan.get(p?.plan);
      if (!hit || !isObj(hit.entry.store)) continue; // limb D and the store sheet own a plan with no store column
      for (const who of stores) {
        required++;
        const rb = hit.entry.store.readBack;
        if (!isObj(rb) || rb[who] === null || rb[who] === undefined) {
          problems.push(
            `${REGISTER} prices.apps.${app}.${hit.id}.store.readBack.${who} is null while apps/${app}/app.yaml declares ` +
              `${p.productId} live on the ${who === 'apple' ? 'App Store' : 'Play'} console (billing.mobileIap.state: live). ` +
              'The store accepted a price, so record what it accepted — { USD, INR, readAt } from the console read — ' +
              'rather than leaving the target to stand in for the fact.',
          );
        }
      }
    }
  }
  return required;
}

/** The fee register, parsed. */
export function readFees(root) {
  const p = join(root, FEE_REGISTER);
  if (!existsSync(p)) return { ok: false, cells: null, why: `${FEE_REGISTER} does not exist` };
  try {
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    if (!isObj(doc?.cells)) return { ok: false, cells: null, why: `${FEE_REGISTER} has no \`cells\` object` };
    return { ok: true, cells: doc.cells, why: null };
  } catch (e) {
    return { ok: false, cells: null, why: `${FEE_REGISTER} is not valid JSON (${e.message})` };
  }
}

/** Net of a sale after a percent-and-fixed fee, in minor units, rounded to the nearest one. */
export function netAfterFee(priceMinor, { percentBps, fixedMinor = 0 }) {
  return Math.round((priceMinor * (BPS - percentBps) - fixedMinor * BPS) / BPS);
}

/**
 * Why a fee cannot be applied to a price in `currency`, or null. A fixed part is minor units of ONE currency: 50
 * cents subtracted from an INR price is 50 paise, a different fee, and the net would print as if it were right.
 */
export function feeCurrencyProblem({ fixedMinor = 0, fixedCurrency }, currency) {
  if (!fixedMinor) return null;
  if (typeof fixedCurrency !== 'string') return `carries a fixed ${fixedMinor} minor with no fixedCurrency, so it cannot be applied to a ${currency} price.`;
  if (fixedCurrency !== currency) return `carries a fixed ${fixedMinor} minor ${fixedCurrency}, applied to a ${currency} price. Read the vendor's ${currency} fee; never convert.`;
  return null;
}

/**
 * Net of an India web sale ([ADR 076] §10.1): Nikatru is the seller of record, so the GST inside the price is
 * remitted, and the rail's fee is charged on the whole price while the GST on that fee returns as input tax credit.
 */
export function netOfIndiaSale(priceMinor, gstBps, feeBps) {
  return Math.round((priceMinor * BPS * BPS - priceMinor * feeBps * (BPS + gstBps)) / ((BPS + gstBps) * BPS));
}

const money = (minor) => `${minor < 0 ? '-' : ''}${Math.trunc(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;
const pct = (bps) => `${bps / 100}%`;

/**
 * Limb G. Every plan's net on every app channel, and the India web book beside it.
 * @returns {{ lost: string[], problems: string[], gated: string[], lines: string[], rows: object[] }}
 */
export function netSheet(root, data, book, now = Date.now()) {
  const lost = [];
  const problems = [];
  const gated = [];
  const lines = [];
  const rows = [];
  const fees = readFees(root);
  if (!fees.ok) return { lost: [`${fees.why}, so no net can be derived.`], problems, gated, lines, rows };
  let register;
  try {
    register = JSON.parse(readFileSync(join(root, CHANNEL_REGISTER), 'utf8'));
  } catch (e) {
    return { lost: [`${CHANNEL_REGISTER} could not be read (${e.message}), so there is no channel to net.`], problems, gated, lines, rows };
  }
  const channels = (Array.isArray(register?.channels) ? register.channels : []).filter((c) => c?.surface === 'app');
  if (!channels.some((c) => c.id === WEB_CHANNEL)) {
    return { lost: [`${CHANNEL_REGISTER} has no \`${WEB_CHANNEL}\` app row, so no net has a row to be compared to.`], problems, gated, lines, rows };
  }

  // A cell the sheet applies is {value, asOf, verify} with a value; a missing or null one is a finding, named once.
  const flagged = new Set();
  const cell = (id, { nullable = false } = {}) => {
    const c = fees.cells[id];
    const bad = (why) => {
      if (!flagged.has(id)) problems.push(`${FEE_REGISTER} cells.${id} ${why}`);
      flagged.add(id);
      return null;
    };
    if (!isObj(c)) return bad('is missing. Every fee the net sheet applies is a dated read: {value, asOf, verify}.');
    if (typeof c.asOf !== 'string' || !ISO_DAY_OR_INSTANT.test(c.asOf)) return bad(`has asOf ${JSON.stringify(c.asOf)}; it is the day or instant the source was read.`);
    if (typeof c.verify !== 'string' || c.verify.trim().length < MIN_REASON) return bad('has no `verify`: the command that re-reads it.');
    if (c.value === null || c.value === undefined) {
      if (nullable) return { value: null };
      return bad(
        'has a null value, so every sale it prices has a net nobody measured. Read the vendor and record the value ' +
          'with its asOf and verify; never type a figure to make a net come out right.',
      );
    }
    if (!nullable && (!isObj(c.value) || !Number.isInteger(c.value.percentBps) || c.value.percentBps < 0 || c.value.percentBps >= BPS)) {
      return bad(`has value ${JSON.stringify(c.value)}; a fee is { percentBps (integer basis points), fixedMinor? }.`);
    }
    // A fee's read has an age limit: nothing runs `verify`, so a cell nobody re-reads prices every sale at a rate
    // the vendor may have moved. A stale cell is a finding, and still applied, so the sheet shows what it nets.
    const t = Date.parse(c.asOf);
    if (!Number.isFinite(t) || t > now) return bad(`has asOf ${JSON.stringify(c.asOf)}, which is not a day that has happened.`);
    if (!nullable && !flagged.has(`${id}#age`)) {
      const limited = isLimitedTime(c);
      const max = limited ? MAX_OFFER_AGE_DAYS : MAX_FEE_AGE_DAYS;
      const age = Math.floor((now - t) / DAY_MS);
      if (age > max) {
        flagged.add(`${id}#age`);
        problems.push(
          `${FEE_REGISTER} cells.${id} was read ${c.asOf}, ${age} days ago; a ${limited ? 'LIMITED-TIME offer' : 'fee'} cell is ` +
            `re-read within ${max} days. Run its \`verify\`, and record the value it shows with a new asOf.`,
        );
      }
    }
    return c;
  };
  const enrolmentCell = cell(SBP_ENROLMENT_CELL, { nullable: true });
  const enrolment = enrolmentCell === null ? { enrolled: false, problem: null } : readEnrolment(enrolmentCell.value, new Date(now).toISOString().slice(0, 10));
  const enrolled = enrolment.enrolled;
  if (enrolment.problem !== null) problems.push(`${FEE_REGISTER} cells.${SBP_ENROLMENT_CELL}.value ${enrolment.problem}`);

  // The plans: every priced app offering, then every bundle plan.
  const plans = [];
  for (const { app, offerings } of book) {
    for (const { id, entry, webUsd, term } of offerings) {
      plans.push({ label: `${app} ${id}`, plan: entry.plan, webUsd, store: entry.store, webInr: entry.webInrMinor, recurring: term !== 'one_time' });
    }
  }
  const bundles = isObj(data?.prices?.bundles) ? data.prices.bundles : {};
  for (const key of dataKeys(bundles)) {
    const b = bundles[key];
    if (isObj(b)) plans.push({ label: `bundle ${key}`, plan: b.plan, webUsd: b.amount_minor, store: b.store, webInr: b.webInrMinor, recurring: true });
  }

  const feeOf = (rail, price, plan) => {
    if (rail === 'paddle') {
      const under = fees.cells[FEE_CELLS.paddleUnderThreshold];
      const threshold = Number.isInteger(under?.thresholdMinor) ? under.thresholdMinor : null;
      if (threshold === null) {
        cell(FEE_CELLS.paddleUnderThreshold);
        if (!flagged.has(`${FEE_CELLS.paddleUnderThreshold}#t`)) {
          problems.push(`${FEE_REGISTER} cells.${FEE_CELLS.paddleUnderThreshold} carries no integer thresholdMinor, so no sale can be placed above or below it.`);
          flagged.add(`${FEE_CELLS.paddleUnderThreshold}#t`);
        }
        return null;
      }
      const id = price < threshold ? FEE_CELLS.paddleUnderThreshold : FEE_CELLS.paddle;
      const c = cell(id);
      return c && { id, fee: c.value };
    }
    if (rail === 'play-billing') {
      const c = cell(FEE_CELLS.playSubscription);
      return c && { id: FEE_CELLS.playSubscription, fee: c.value };
    }
    if (rail === 'apple-iap') {
      const id = enrolled ? FEE_CELLS.appleSmallBusiness : FEE_CELLS.appleStandard;
      const c = cell(id);
      return c && { id, fee: c.value };
    }
    problems.push(`${plan.label}: the net sheet has no fee model for rail "${rail}". Add its cells to ${FEE_REGISTER} and its arm here.`);
    return null;
  };

  lines.push(`net sheet — every plan on every app channel, from ${FEE_REGISTER} × ${REGISTER} \`prices\` (minor units shown as decimals)`);
  for (const plan of plans) {
    lines.push(`  ${plan.label} (${plan.plan})`);
    const byChannel = new Map();
    for (const ch of channels) {
      const rail = ch?.purchaseRail?.rail;
      if (rail === 'none') {
        lines.push(`    ${ch.id.padEnd(16)} none          sells nothing (purchaseRail none)`);
        continue;
      }
      const onStore = rail === 'play-billing' || rail === 'apple-iap';
      if (onStore && !isObj(plan.store)) {
        lines.push(`    ${ch.id.padEnd(16)} ${rail.padEnd(13)} not sold in-app ([ADR 093] §2: web only)`);
        continue;
      }
      const price = onStore ? plan.store.USD : plan.webUsd;
      if (!Number.isInteger(price)) continue; // limbs A and D name a price that is not an integer
      const f = feeOf(rail, price, plan);
      if (f === null) continue;
      const currencyProblem = feeCurrencyProblem(f.fee, 'USD');
      if (currencyProblem !== null) {
        if (!flagged.has(`${f.id}#currency`)) problems.push(`${FEE_REGISTER} cells.${f.id} ${currencyProblem}`);
        flagged.add(`${f.id}#currency`);
        continue;
      }
      const net = netAfterFee(price, f.fee);
      const row = { plan: plan.label, channel: ch.id, rail, currency: 'USD', priceMinor: price, netMinor: net, cell: f.id };
      rows.push(row);
      byChannel.set(ch.id, row);
    }
    const web = byChannel.get(WEB_CHANNEL);
    for (const row of byChannel.values()) {
      let mark = '';
      if (web && row.channel !== WEB_CHANNEL && row.netMinor < web.netMinor) {
        if (row.rail === 'apple-iap' && !enrolled) {
          mark = `  ⬜ below web ${money(web.netMinor)} until A-18 (Small Business Program); a real App Store submission is refused`;
          gated.push(`${plan.label} on ${row.channel}`);
        } else {
          mark = `  ✗ below web ${money(web.netMinor)}`;
          problems.push(
            `${plan.label} nets ${money(row.netMinor)} on ${row.channel} (${row.rail}, ${row.currency} ${money(row.priceMinor)} after ` +
              `${FEE_REGISTER} ${row.cell}) and ${money(web.netMinor)} on ${WEB_CHANNEL}. A channel that sells a plan nets at ` +
              'least its web sale ([ADR 093] §2); raise the store price or re-read the fee, never lower the web row to match.',
          );
        }
      }
      const f = fees.cells[row.cell].value;
      const feeText = `${pct(f.percentBps)}${f.fixedMinor ? ` + ${f.fixedMinor} minor` : ''}`;
      lines.push(
        `    ${row.channel.padEnd(16)} ${row.rail.padEnd(13)} ${row.currency} ${money(row.priceMinor).padStart(7)} → net ${money(row.netMinor).padStart(7)}  (${row.cell}: ${feeText})${mark}`,
      );
    }
    // The India web book: one row per plan, Razorpay, for every channel whose regionRails carry IN.
    const inChannels = channels.filter((c) => (c?.purchaseRail?.regionRails ?? []).some((r) => r?.region === 'IN' && r?.rail === 'razorpay'));
    if (inChannels.length && Number.isInteger(plan.webInr)) {
      const gst = cell(FEE_CELLS.indiaGst);
      const platform = cell(FEE_CELLS.razorpayPlatform);
      const addOn = plan.recurring ? cell(FEE_CELLS.razorpaySubscription) : { value: { percentBps: 0 } };
      if (gst && platform && addOn) {
        const feeBps = platform.value.percentBps + addOn.value.percentBps;
        const net = netOfIndiaSale(plan.webInr, gst.value.percentBps, feeBps);
        rows.push({ plan: plan.label, channel: `${WEB_CHANNEL}·IN`, rail: 'razorpay', currency: 'INR', priceMinor: plan.webInr, netMinor: net, cell: FEE_CELLS.razorpayPlatform });
        lines.push(
          `    ${`${WEB_CHANNEL}·IN`.padEnd(16)} ${'razorpay'.padEnd(13)} INR ${money(plan.webInr).padStart(7)} → net ${money(net).padStart(7)}  ` +
            `(${FEE_CELLS.indiaGst} ${pct(gst.value.percentBps)} out of the price; ${pct(feeBps)} fee${plan.recurring ? ' incl. the subscription add-on' : ''}; ` +
            `every IN regionRails channel: ${inChannels.map((c) => c.id).join(', ')})`,
        );
      }
    }
  }
  if (rows.length === 0) lost.push(`limb G derived zero net rows from ${plans.length} plan(s) and ${channels.length} channel(s).`);
  if (gated.length) {
    lines.push(
      `⬜ ${gated.length} Apple row(s) net below web at the standard rate until ${FEE_REGISTER} cells.${SBP_ENROLMENT_CELL} ` +
        'carries the day Apple approved the owner\'s enrolment (A-18); tooling/ci/assert-small-business-program.mjs refuses a real App Store submission meanwhile',
    );
  }
  return { lost, problems, gated, lines, rows };
}

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** The rendered module's bytes. Apps sorted; offerings in served order. */
export function renderRailPriceIds(book) {
  const L = [];
  const map = (name, doc, valueOf, type) => {
    L.push(...doc.map((d) => `// ${d}`.trimEnd()));
    L.push(`export const ${name}: Readonly<Record<string, Readonly<Record<string, ${type}>>>> = {`);
    for (const { app, offerings } of book) {
      const rows = offerings.map(({ id, entry }) => valueOf(id, entry)).filter(Boolean);
      if (rows.length === 0) {
        L.push(`  ${app}: {},`);
        continue;
      }
      L.push(`  ${app}: {`);
      for (const r of rows) L.push(`    ${r}`);
      L.push('  },');
    }
    L.push('};', '');
  };
  const readBack = (rail) => (id, e) => {
    const r = e.rails?.[rail];
    return isObj(r) && !('pending' in r) ? r : null;
  };
  const pending = (rail) => (id, e) => {
    const r = e.rails?.[rail];
    return isObj(r) && 'pending' in r ? r.pending : null;
  };
  L.push(
    '// GENERATED by tooling/catalog/render-rail-prices.mjs from services/platform/src/app-config-data.json `prices`.',
    '// Do not edit: `render-rail-prices.mjs --check` re-renders this file and fails on any difference.',
    '// Change a rail id or its amount only after a read of the vendor\'s own catalogue, in the register\'s',
    '// `rails`, then re-render. Why each map exists is the renderer\'s header (O-RAIL-PRICE-IDS-HAND-KEPT).',
    '',
  );
  map(
    'PADDLE_PRICE_IDS',
    ['OUR offering id → PADDLE\'s price id, per app. A caller never names a price; checkout.ts resolves it here.'],
    (id, e) => {
      const r = readBack('paddle')(id, e);
      return r ? `${id}: ${q(r.priceId)},` : null;
    },
    'string',
  );
  map(
    'RAIL_PRICE_AMOUNTS_MINOR',
    ['What each mapped Paddle price costs ON PADDLE, in minor units, as read back (the time is the register\'s `readAt`).'],
    (id, e) => {
      const r = readBack('paddle')(id, e);
      return r ? `${id}: ${r.amountMinor}, // read back ${r.readAt}` : null;
    },
    'number',
  );
  map(
    'RAIL_PRICE_PENDING',
    ['Served offerings Paddle cannot sell at that price today, each with its reason. Empty for an app whose paywall is on.'],
    (id, e) => {
      const p = pending('paddle')(id, e);
      return p === null ? null : `${id}: ${q(p)},`;
    },
    'string',
  );
  map(
    'RAZORPAY_PLAN_IDS',
    ['OUR offering id → RAZORPAY\'s plan id, per app. Empty until Razorpay PR B and the owner\'s plans ([ADR 094]).'],
    (id, e) => {
      const r = readBack('razorpay')(id, e);
      return r ? `${id}: ${q(r.planId)},` : null;
    },
    'string',
  );
  map(
    'RAZORPAY_PRICE_PENDING',
    ['Served offerings Razorpay cannot sell today, each with its reason. Razorpay PR B reads this map.'],
    (id, e) => {
      const p = pending('razorpay')(id, e);
      return p === null ? null : `${id}: ${q(p)},`;
    },
    'string',
  );
  // ⏱ 2026-10-01 · port-pay-core: the payments port's ONE price map, keyed by the registry's adapter id
  // (tooling/ports/payments.json), so an adapter resolves its own id and no route names a rail's map.
  L.push(
    '// RAIL → OUR offering id → that rail\'s sellable id, per app: the map the payments port reads',
    '// (RAIL_PRICE_IDS[railId][appId][offeringId]). Keyed by tooling/ports/payments.json adapter ids.',
    'export const RAIL_PRICE_IDS: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>> = {',
    ...RAILS.map((r) => `  ${r}: ${railPriceMapFor(r)},`),
    '};',
    '',
  );
  return `${L.join('\n').trimEnd()}\n`;
}

/** The owner's store sheet (O-B3). Lines to print; never writes. */
export function storeSheet(root, data, app, book) {
  const problems = [];
  const lines = [];
  let decl;
  try {
    decl = readDeclaration(root, app);
  } catch (e) {
    return { lost: [`apps/${app}/app.yaml could not be read (${e.message}), so there is no store product to list.`], problems, lines };
  }
  const products = decl?.billing?.mobileIap?.storeProducts;
  if (!Array.isArray(products) || products.length === 0) {
    return { lost: [`apps/${app}/app.yaml declares no billing.mobileIap.storeProducts, so the sheet has no row.`], problems, lines };
  }
  const entries = book.find((b) => b.app === app)?.offerings ?? [];
  const byPlan = new Map(entries.map(({ id, entry }) => [entry.plan, { id, entry }]));
  lines.push(`store sheet — ${app} (owner step O-B3; [ADR 093] §2: the same number on Apple and on Google)`);
  for (const store of ['apple-iap', 'play-billing']) {
    lines.push(`  ${store}`);
    for (const p of products) {
      const hit = byPlan.get(p?.plan);
      if (!hit || !isObj(hit.entry.store)) {
        problems.push(`apps/${app}/app.yaml storeProducts plan ${JSON.stringify(p?.plan)} has no store price in ${REGISTER} prices.apps.${app}.`);
        continue;
      }
      const s = hit.entry.store;
      lines.push(`    ${p.productId}  plan ${p.plan}  USD ${s.USD} minor  INR ${s.INR} minor  (offering ${hit.id})`);
    }
  }
  const reg = readCatalogFile(root, BUNDLES_REGISTER);
  if (!reg.ok) return { lost: [`${reg.why}, so the sheet cannot list the bundle's store SKUs.`], problems, lines };
  const skus = (Array.isArray(reg.value) ? reg.value : []).flatMap((r) =>
    (Array.isArray(r?.storeProducts) ? r.storeProducts : []).filter((s) => s?.app === app).map((s) => ({ ...s, featureSet: r.featureSet })),
  );
  if (skus.length === 0) {
    lines.push(`  bundle: no store SKU for ${app} in ${BUNDLES_REGISTER} yet (owner step O-D3 creates them)`);
  } else {
    for (const s of skus) {
      const e = data?.prices?.bundles?.[s.plan];
      if (!isObj(e?.store)) {
        problems.push(`${BUNDLES_REGISTER} ${s.featureSet} storeProducts ${s.productId} has no store price in prices.bundles.`);
        continue;
      }
      lines.push(`  bundle ${s.store}  ${s.productId}  plan ${s.plan}  USD ${e.store.USD} minor  INR ${e.store.INR} minor`);
    }
  }
  return { lost: [], problems, lines };
}

/**
 * The rendered file's text, or null when it does not exist. Read without an existsSync first: a check and then a
 * write of the same path is a race (CodeQL js/file-system-race). Anything but ENOENT is re-thrown, so an unreadable
 * file is never mistaken for a missing one.
 */
function readRendered(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

/** One run. Returns the exit code and the lines to print; writes only in render mode with no finding. */
export function run(root, { check = false, sheet = null, net = false, now = Date.now() } = {}) {
  const out = [];
  const err = [];
  const reg = readRegister(root);
  if (!reg.ok) {
    err.push(`FAIL COVERAGE LOST — ${reg.why}`);
    return { code: 2, out, err };
  }
  const p = plan(root, reg.data);
  if (p.lost.length) {
    for (const l of p.lost) err.push(`FAIL COVERAGE LOST — ${l}`);
    return { code: 2, out, err };
  }
  // G · the net of every plan on every channel, graded on every run.
  const n = netSheet(root, reg.data, p.book, now);
  if (n.lost.length) {
    for (const l of n.lost) err.push(`FAIL COVERAGE LOST — ${l}`);
    return { code: 2, out, err };
  }
  if (net) out.push(...n.lines);
  const problems = [...p.problems, ...n.problems];
  if (problems.length) {
    for (const x of problems) err.push(`✗ ${x}`);
    err.push(`\nrender-rail-prices: ${problems.length} problem(s) in ${REGISTER} \`prices\` and ${FEE_REGISTER} — nothing was written.`);
    return { code: 1, out, err };
  }
  if (net) return { code: 0, out, err };
  out.push(
    `⬜ razorpay: ${p.counts.razorpayPending} of ${p.counts.razorpayTotal} offering(s) pending — no Razorpay plan exists ` +
      'until Razorpay PR B (designed, not briefed) and the owner\'s plans; RAZORPAY_PLAN_IDS renders empty for them',
  );
  // I · each rail's one tax mode, printed on every run; `unread` stays visible until the vendor read records it.
  for (const [rail, mode] of Object.entries(p.counts.taxModes ?? {})) {
    out.push(`${mode === 'unread' ? '⬜' : '✓'} tax mode ${rail}: ${mode}${mode === 'unread' ? ' — the next vendor price read records it' : ''}`);
  }
  if (sheet !== null) {
    const s = storeSheet(root, reg.data, sheet, p.book);
    if (s.lost.length) {
      for (const l of s.lost) err.push(`FAIL COVERAGE LOST — ${l}`);
      return { code: 2, out, err };
    }
    if (s.problems.length) {
      for (const x of s.problems) err.push(`✗ ${x}`);
      return { code: 1, out, err };
    }
    out.push(...s.lines);
    return { code: 0, out, err };
  }
  const want = renderRailPriceIds(p.book);
  const abs = join(root, RENDERED);
  const have = readRendered(abs);
  const summary =
    `${p.counts.entries} offering(s) across ${p.book.length} app(s), ${p.counts.bundles} bundle plan(s); ` +
    `[ADR 093] store column holds; ${p.counts.readBacks} store read-back(s) recorded; ` +
    `${n.rows.length} net row(s) derived, none below web${n.gated.length ? ` but ${n.gated.length} Apple row(s) gated on A-18` : ''}; ` +
    `${p.counts.sources} TypeScript file(s) swept for a second home`;
  if (check) {
    if (have !== want) {
      err.push(
        `✗ ${RENDERED} is not what ${REGISTER} \`prices\` renders${have === null ? ' (it does not exist)' : ''}.`,
        '  Change the register, not the rendering, then:  node tooling/catalog/render-rail-prices.mjs',
      );
      return { code: 1, out, err };
    }
    out.push(`ok   render-rail-prices --check — ${RENDERED} matches; ${summary}`);
    return { code: 0, out, err };
  }
  if (have !== want) writeFileSync(abs, want);
  out.push(`ok   render-rail-prices — ${have === want ? 'unchanged' : `wrote ${RENDERED}`}; ${summary}`);
  return { code: 0, out, err };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const net = args.includes('--net-sheet');
  const si = args.indexOf('--store-sheet');
  const sheet = si >= 0 ? args[si + 1] ?? '' : null;
  const nowArg = args.find((a) => a === '--now' || a.startsWith('--now='));
  const now = nowArg === undefined ? Date.now() : Date.parse(nowArg.slice('--now='.length));
  if (nowArg !== undefined && (!ISO_INSTANT.test(nowArg.slice('--now='.length)) || !Number.isFinite(now))) {
    console.error(`FAIL COVERAGE LOST — --now needs an ISO instant ending Z, got ${JSON.stringify(nowArg)}`);
    process.exit(2);
  }
  const positional = args.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1));
  const root = resolve(positional[0] ?? join(HERE, '..', '..'));
  if (sheet === '' || (sheet !== null && !/^[a-z][a-z0-9-]*$/.test(sheet))) {
    console.error(`FAIL COVERAGE LOST — --store-sheet needs an app id, got ${JSON.stringify(sheet)}`);
    process.exit(2);
  }
  if (net && sheet !== null) {
    console.error('FAIL COVERAGE LOST — --net-sheet and --store-sheet are two reports; ask for one.');
    process.exit(2);
  }
  const r = run(root, { check, sheet, net, now });
  for (const l of r.out) console.log(l);
  for (const l of r.err) console.error(l);
  process.exit(r.code);
}
