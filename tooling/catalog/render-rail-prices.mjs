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
//   E · ONE HOME — no TypeScript file under services/platform/src but the
//       rendered one carries a `pri_…` or `plan_…` rail id or declares one of
//       the rendered map names. A hand map re-added to checkout.ts is red here,
//       where tooling/ci/assert-no-price-literals.mjs (Dart and listing text)
//       cannot see it.
//   F · RENDERED (--check) — rail-price-ids.ts is byte-for-byte this renderer's
//       output. A hand edit to it is exit 1 (the row's own red control).
//   COVERAGE LOST (exit 2) — the register missing or unparseable, no `prices`
//   section, zero served offerings or zero price-book entries read, no
//   TypeScript source to sweep, or catalog/bundles.json unreadable.
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
// Exit:   0 ok · 1 a finding (nothing written) · 2 COVERAGE LOST
// Tests:  tooling/ci/test/rail-prices.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCatalogFile, BUNDLES_REGISTER } from './read.mjs';
import { readDeclaration } from '../app-yaml/render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The price register, repo-relative ([pipeline 5]M-11). */
export const REGISTER = 'services/platform/src/app-config-data.json';
/** The rendered module checkout.ts imports. */
export const RENDERED = 'services/platform/src/routes/rail-price-ids.ts';
/** Where limb E looks for a second home of a rail id. */
export const SOURCE_DIR = 'services/platform/src';
/** The rails an entry must declare, each a read-back or pending. */
export const RAILS = ['paddle', 'razorpay'];
/** The served `term` → the plan an app offering is. */
export const APP_PLANS = Object.freeze({ month: 'single-monthly', year: 'single-yearly', one_time: 'single-lifetime' });
/** The served `term` → the plan a bundle offering is. A bundle has no lifetime plan. */
export const BUNDLE_PLANS = Object.freeze({ month: 'bundle-monthly', year: 'bundle-yearly' });
/** [ADR 093] §2: the store column carries these currencies and no other. */
export const STORE_CURRENCIES = ['USD', 'INR'];
/** The stores whose accepted value a `readBack` records. */
export const STORE_READERS = ['apple', 'google'];
/** [ADR 093] §2: store ≥ web × 1.20, in integer percent so no float rounds a cent. */
export const MARKUP_PERCENT = 120;
/** The map names limb E refuses anywhere but the rendered module. */
export const MAP_NAMES = [
  'PADDLE_PRICE_IDS',
  'RAIL_PRICE_AMOUNTS_MINOR',
  'RAIL_PRICE_PENDING',
  'RAZORPAY_PLAN_IDS',
  'RAZORPAY_PRICE_PENDING',
];

const MIN_REASON = 20;
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
function gradeStore(where, entry, web, lifetime, problems) {
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
      problems.push(`${where}.store.readBack.${who} is ${JSON.stringify(got)}; it is null or { USD, INR } as the store accepted them.`);
      continue;
    }
    for (const [cur, v] of Object.entries(got)) {
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
    if ('pending' in r) {
      const extra = Object.keys(r).filter((k) => k !== 'pending');
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
  const counts = { served: 0, entries: 0, bundles: 0, razorpayPending: 0, razorpayTotal: 0, sources: 0 };
  const prices = isObj(data?.prices) ? data.prices : null;
  if (!prices) {
    lost.push(`${REGISTER} has no \`prices\` section, so there is nothing to render and nothing to grade.`);
    return { lost, problems, book, counts };
  }
  const servedApps = isObj(data.apps) ? data.apps : {};
  const bookApps = isObj(prices.apps) ? prices.apps : {};
  const seenIds = new Map();

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
      gradeStore(where, entry, web, o.term === 'one_time', problems);
      rows.push({ id, entry });
    }
    book.push({ app, offerings: rows });
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

  if (counts.served === 0) lost.push(`${REGISTER} serves zero offerings, so no rail map has anything to render.`);
  if (counts.entries === 0) lost.push(`${REGISTER} prices zero served offerings: the price book read as empty.`);
  if (counts.sources === 0) lost.push(`${SOURCE_DIR} yielded no TypeScript file, so limb E swept nothing.`);
  return { lost, problems, book, counts };
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

/** One run. Returns the exit code and the lines to print; writes only in render mode with no finding. */
export function run(root, { check = false, sheet = null } = {}) {
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
  if (p.problems.length) {
    for (const x of p.problems) err.push(`✗ ${x}`);
    err.push(`\nrender-rail-prices: ${p.problems.length} problem(s) in ${REGISTER} \`prices\` — nothing was written.`);
    return { code: 1, out, err };
  }
  out.push(
    `⬜ razorpay: ${p.counts.razorpayPending} of ${p.counts.razorpayTotal} offering(s) pending — no Razorpay plan exists ` +
      'until Razorpay PR B (designed, not briefed) and the owner\'s plans; RAZORPAY_PLAN_IDS renders empty for them',
  );
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
  const have = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const summary =
    `${p.counts.entries} offering(s) across ${p.book.length} app(s), ${p.counts.bundles} bundle plan(s); ` +
    `[ADR 093] store column holds; ${p.counts.sources} TypeScript file(s) swept for a second home`;
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
  const si = args.indexOf('--store-sheet');
  const sheet = si >= 0 ? args[si + 1] ?? '' : null;
  const positional = args.filter((a, i) => !a.startsWith('--') && !(si >= 0 && i === si + 1));
  const root = resolve(positional[0] ?? join(HERE, '..', '..'));
  if (sheet === '' || (sheet !== null && !/^[a-z][a-z0-9-]*$/.test(sheet))) {
    console.error(`FAIL COVERAGE LOST — --store-sheet needs an app id, got ${JSON.stringify(sheet)}`);
    process.exit(2);
  }
  const r = run(root, { check, sheet });
  for (const l of r.out) console.log(l);
  for (const l of r.err) console.error(l);
  process.exit(r.code);
}
