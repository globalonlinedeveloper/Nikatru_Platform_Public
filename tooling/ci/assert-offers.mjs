#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-offers.mjs — NEVER BELOW COST, AND NEVER FREE AI (lane growth-codes,
// O-DISCOUNT-FLOOR-UNGUARDED). The subject is tooling/catalog/offers.json.
//
// 🔴 THE DEFECT, NAMED. A discount is typed as a percentage, and a percentage
// reads as harmless in a diff: "50% off" looks the same on a $42 yearly plan as
// on a $5.99 monthly one, where the rail's fixed 50¢ and the buyer's tax already
// take a third of the price. A code that sells a month for less than that month
// costs us is a loss on every redemption, and one that hands out a free month
// WITH an AI allowance is a bill on our key for every holder. Neither is visible
// in the offer row; both are arithmetic, so this guard does the arithmetic.
//
// LIMBS
//   1 · COVERAGE: the register, the prices (services/platform/src/app-config-data.json
//       `prices`), the fee cells and tax regions (tooling/catalog/fee-register.json),
//       the AI port's model prices (tooling/ports/ai.json) and the allowance
//       (services/platform/src/lib/ai/meter.ts PRO_MONTHLY_ALLOWANCE) are all read,
//       and at least one discount is floored — else exit 2, COVERAGE LOST.
//   2 · FLOOR: every `discount` and `winback` offer, on EVERY rail it names, nets
//       at least one Pro month's cost after the rail's HIGHEST commission cell and
//       the HIGHEST tax region (the safe side, as port-switch.mjs creditFloor).
//       The cost is `cost.infraUsdPerUserMonth`, plus — when the plan carries AI —
//       the allowance priced at the dearest candidate model of the AI feature
//       (with its fallback chain, port-switch.mjs chainCallCostUsd).
//   3 · NO FREE AI: every `free-month` and `invite` offer has `aiAllowance` 0, and
//       the source its grant is written under (`promo_code`) is one the bundle
//       contract marks requiresReceipt: false — the AI meter's "not paid".
//   4 · CHANNELS: every channel of tooling/channel-register.json has exactly one
//       row, no row names an unknown channel, and a store-billed rail
//       (apple-iap, play-billing) NEVER has an own-code field.
//   5 · CLIENT PARITY: packages/purchases/lib/src/redeem_code.dart maps every
//       channel to the mechanism its row names — an App Store build renders no
//       own-code field because this file says so, not because someone remembered.
//   6 · CODE POLICY: the code alphabet and length carry at least
//       `minEntropyBits` (≥ 80) of entropy, since only a code's unsalted hash is stored.
//
// Usage:  node tooling/ci/assert-offers.mjs [repoRoot]
// Exit 0 green · 1 a finding · 2 COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainCallCostUsd } from '../ops/port-switch.mjs';

export const OFFERS = 'tooling/catalog/offers.json';
export const PRICES = 'services/platform/src/app-config-data.json';
export const FEES = 'tooling/catalog/fee-register.json';
export const AI_PORT = 'tooling/ports/ai.json';
export const METER = 'services/platform/src/lib/ai/meter.ts';
export const CHANNELS = 'tooling/channel-register.json';
export const BUNDLE_CONTRACT = 'contracts/entitlement/bundle.json';
export const DART_MECHANISMS = 'packages/purchases/lib/src/redeem_code.dart';

/** The rails a store bills itself: our own code there is steering (3.1.1, Play payments policy). */
export const STORE_BILLED = new Set(['apple-iap', 'play-billing']);
/** The source a free month or an invite reward is granted under. */
export const FREE_GRANT_SOURCE = 'promo_code';
const DISCOUNT_KINDS = new Set(['discount', 'winback']);
const FREE_KINDS = new Set(['free-month', 'invite']);
/** register mechanism → the Dart enum value naming it. */
export const DART_NAME = Object.freeze({
  'own-code': 'ownCode',
  'apple-offer-code': 'appleOfferCode',
  'play-promo-code': 'playPromoCode',
  none: 'none',
});

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The USD price of `plan` on `rail`, read from the price register: a Paddle
 * price's read-back amount, a store's USD price (the stores read back the same
 * figure). Null when the rail carries no USD price yet.
 */
export function usdPriceOf(prices, app, plan, rail) {
  const row = prices?.apps?.[app]?.[plan];
  if (!isObj(row)) return null;
  if (rail === 'paddle') return Number.isInteger(row.rails?.paddle?.amountMinor) ? row.rails.paddle.amountMinor / 100 : null;
  if (STORE_BILLED.has(rail)) return Number.isInteger(row.store?.USD) ? row.store.USD / 100 : null;
  return null;
}

/** The highest commission on `rail` (percent as a fraction, fixed USD), from the fee cells. */
export function worstFee(cells, rail) {
  const rows = Object.entries(isObj(cells) ? cells : {}).filter(([id, c]) => isObj(c) && c.rail === rail && id !== 'india-gst' && isObj(c.value) && Number.isInteger(c.value.percentBps));
  if (!rows.length) return null;
  const pct = Math.max(...rows.map(([, c]) => c.value.percentBps)) / 10_000;
  const fixed = Math.max(0, ...rows.map(([, c]) => (Number.isInteger(c.value.fixedMinor) && c.value.fixedCurrency === 'USD' ? c.value.fixedMinor : 0))) / 100;
  return { pct, fixed };
}

/** The highest tax rate a buyer's price can carry, as a fraction. */
export function topTax(taxRows) {
  const rates = Object.values(isObj(taxRows) ? taxRows : {}).map((r) => r?.value?.percentBps).filter(Number.isInteger);
  return rates.length ? Math.max(...rates) / 10_000 : null;
}

/** What one month at `priceUsd` leaves us on a rail: tax out of the price first, then the cut. */
export function netUsd(priceUsd, fee, tax) {
  return priceUsd / (1 + tax) - fee.pct * priceUsd - fee.fixed;
}

/** The AI allowance's worst-case monthly cost: allowance × the dearest candidate's call, with its chain. */
export function aiMonthCostUsd(aiPort, allowance, feature) {
  const adapter = (aiPort?.adapters ?? []).find((a) => a?.id === aiPort?.features?.[feature]?.adapter);
  const priced = adapter?.cost?.models;
  const f = aiPort?.features?.[feature];
  if (!isObj(priced) || !isObj(f) || !isObj(f.tokensPerCall) || !Array.isArray(f.candidates) || !f.candidates.length) return { lost: `${AI_PORT} feature \`${feature}\` has no priced candidates or tokensPerCall` };
  let worst = 0;
  for (const m of f.candidates) {
    const c = chainCallCostUsd(priced, m, f.tokensPerCall);
    if (c?.unpriced) return { lost: `${AI_PORT}: candidate chain model \`${c.unpriced}\` is not priced` };
    worst = Math.max(worst, c.cost);
  }
  return { usd: worst * allowance };
}

/** PRO_MONTHLY_ALLOWANCE, read from the meter's source text. */
export function allowanceOf(meterText) {
  const m = /export const PRO_MONTHLY_ALLOWANCE = (\d+);/.exec(meterText ?? '');
  return m ? Number(m[1]) : null;
}

/** `'<channel>': RedeemMechanism.<name>` pairs from the Dart mapping. */
export function dartMechanisms(dartText) {
  const out = new Map();
  for (const m of (dartText ?? '').matchAll(/'([a-z0-9-]+)':\s*RedeemMechanism\.(\w+),/g)) out.set(m[1], m[2]);
  return out;
}

/**
 * Every finding over the inputs. `inputs` is what main() reads; tests pass their own.
 * Returns { problems, lost, notes }.
 */
export function check(inputs) {
  const { offers, prices, fees, aiPort, meterText, channelRegister, bundle, dartText } = inputs;
  const problems = [];
  const lost = [];
  const notes = [];
  if (!isObj(offers) || !Array.isArray(offers.offers) || !Array.isArray(offers.channels)) {
    lost.push(`${OFFERS} has no \`offers\` / \`channels\` arrays`);
    return { problems, lost, notes };
  }
  // ── LIMB 2 · the floor.
  const infra = offers.cost?.infraUsdPerUserMonth?.value;
  const allowance = allowanceOf(meterText);
  const ai = allowance === null ? { lost: `${METER} declares no PRO_MONTHLY_ALLOWANCE` } : aiMonthCostUsd(aiPort, allowance, offers.cost?.aiFeature);
  const tax = topTax(fees?.taxRegions?.rows);
  if (typeof infra !== 'number' || !(infra >= 0)) lost.push(`${OFFERS} cost.infraUsdPerUserMonth.value is not a number`);
  if (ai.lost) lost.push(ai.lost);
  if (tax === null) lost.push(`${FEES} carries no taxRegions.rows`);
  let floored = 0;
  if (!lost.length) {
    for (const o of offers.offers) {
      if (!DISCOUNT_KINDS.has(o?.kind)) continue;
      const cost = infra + (o.carriesAi === false ? 0 : ai.usd);
      if (!(o.percentOff > 0 && o.percentOff < 100)) {
        problems.push(`${o.id}: percentOff ${o.percentOff} is not a discount (0 < percentOff < 100); a free month is kind free-month`);
        continue;
      }
      if (!Array.isArray(o.rails) || !o.rails.length) {
        problems.push(`${o.id}: names no rail, so its floor cannot be checked`);
        continue;
      }
      for (const rail of o.rails) {
        const price = usdPriceOf(prices, o.app, o.plan, rail);
        const fee = worstFee(fees?.cells, rail);
        if (price === null || fee === null) {
          problems.push(`${o.id}: ${o.app} ${o.plan} has no USD price or fee cell on \`${rail}\`, so a discount there cannot be shown above cost`);
          continue;
        }
        const net = netUsd(price * (1 - o.percentOff / 100), fee, tax);
        floored++;
        if (net < cost) {
          problems.push(
            `${o.id}: BELOW COST on \`${rail}\` — ${o.percentOff}% off ${price.toFixed(2)} USD nets ${net.toFixed(2)} after ${(tax * 100).toFixed(0)}% tax and ${(fee.pct * 100).toFixed(0)}% + ${fee.fixed.toFixed(2)} fee, under the ${cost.toFixed(2)} USD a Pro month costs (infra ${infra.toFixed(2)}${o.carriesAi === false ? '' : ` + AI ${ai.usd.toFixed(2)}`})`,
          );
        } else {
          notes.push(`${o.id} on ${rail}: nets ${net.toFixed(2)} ≥ cost ${cost.toFixed(2)} USD`);
        }
      }
    }
    if (floored === 0) lost.push('no discount offer was floored on any rail: the floor limb checked nothing');
  }
  // ── LIMB 3 · no free AI.
  const promo = (bundle?.bundleSources ?? []).find((s) => s?.source === FREE_GRANT_SOURCE);
  if (!promo) lost.push(`${BUNDLE_CONTRACT} has no \`${FREE_GRANT_SOURCE}\` source`);
  else if (promo.requiresReceipt !== false) problems.push(`${BUNDLE_CONTRACT}: \`${FREE_GRANT_SOURCE}\` requires a receipt, so a free grant could count as PAID and buy an AI allowance`);
  for (const o of offers.offers) {
    if (!FREE_KINDS.has(o?.kind)) continue;
    if (o.aiAllowance !== 0) problems.push(`${o.id}: a ${o.kind} carries an AI allowance (${JSON.stringify(o.aiAllowance)}); free never includes AI`);
    if (!(Number.isInteger(o.months) && o.months >= 1)) problems.push(`${o.id}: months must be a whole number ≥ 1`);
  }
  // ── LIMB 4 · channels.
  const registered = (channelRegister?.channels ?? []).map((c) => c?.id).filter(Boolean);
  if (!registered.length) lost.push(`${CHANNELS} lists no channels`);
  const rows = new Map();
  for (const r of offers.channels) {
    if (rows.has(r?.channel)) problems.push(`channel \`${r?.channel}\` has two capability rows`);
    rows.set(r?.channel, r);
    if (!registered.includes(r?.channel)) problems.push(`channel row \`${r?.channel}\` names no channel of ${CHANNELS}`);
    if (!(r?.mechanism in DART_NAME)) problems.push(`channel \`${r?.channel}\`: unknown mechanism ${JSON.stringify(r?.mechanism)}`);
    if (STORE_BILLED.has(r?.rail) && r?.ownCodeField !== false) problems.push(`channel \`${r.channel}\` is billed by ${r.rail}; an own-code field there is steering — ownCodeField must be false`);
    if ((r?.mechanism === 'own-code') !== (r?.ownCodeField === true)) problems.push(`channel \`${r?.channel}\`: ownCodeField ${r?.ownCodeField} disagrees with mechanism ${r?.mechanism}`);
    const regRail = (channelRegister?.channels ?? []).find((c) => c?.id === r?.channel)?.purchaseRail?.rail;
    if (regRail !== undefined && regRail !== r?.rail) problems.push(`channel \`${r?.channel}\`: rail ${r?.rail} disagrees with ${CHANNELS} (${regRail})`);
  }
  for (const id of registered) if (!rows.has(id)) problems.push(`channel \`${id}\` has NO capability row in ${OFFERS}: which code mechanism it takes is undecided`);
  // ── LIMB 5 · client parity (app channels only: the Dart enum covers the app channels).
  const dart = dartMechanisms(dartText);
  if (!dart.size) lost.push(`${DART_MECHANISMS} maps no channel (no \`'<id>': RedeemMechanism.<name>,\` entry)`);
  for (const [id, name] of dart) {
    const row = rows.get(id);
    if (!row) problems.push(`${DART_MECHANISMS} maps \`${id}\`, which has no capability row`);
    else if (DART_NAME[row.mechanism] !== name) problems.push(`${DART_MECHANISMS}: \`${id}\` is RedeemMechanism.${name}, the register says ${row.mechanism}`);
  }
  // ── LIMB 6 · code policy.
  const p = offers.codePolicy ?? {};
  const alphabet = typeof p.alphabet === 'string' ? new Set(p.alphabet).size : 0;
  const bits = alphabet > 1 && Number.isInteger(p.length) ? p.length * Math.log2(alphabet) : 0;
  if (!(p.minEntropyBits >= 80)) problems.push(`codePolicy.minEntropyBits ${p.minEntropyBits} is under 80`);
  if (bits < (p.minEntropyBits ?? 80)) problems.push(`codePolicy: ${p.length} characters of a ${alphabet}-symbol alphabet carry ${bits.toFixed(1)} bits, under ${p.minEntropyBits}`);
  if (!(Number.isInteger(p.redeemPerMinute) && p.redeemPerMinute >= 1 && p.redeemPerMinute <= 10)) problems.push(`codePolicy.redeemPerMinute ${p.redeemPerMinute} is not 1..10`);
  notes.push(`${rows.size} channel row(s) over ${registered.length} registered channel(s); ${dart.size} app channel(s) mapped in Dart; ${floored} discount/rail pair(s) floored`);
  return { problems, lost, notes };
}

const readJson = (root, rel) => {
  try {
    return JSON.parse(readFileSync(join(root, rel), 'utf8'));
  } catch {
    return null;
  }
};
const readText = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);

export function inputsAt(root) {
  return {
    offers: readJson(root, OFFERS),
    prices: readJson(root, PRICES)?.prices ?? null,
    fees: readJson(root, FEES),
    aiPort: readJson(root, AI_PORT),
    meterText: readText(root, METER),
    channelRegister: readJson(root, CHANNELS),
    bundle: readJson(root, BUNDLE_CONTRACT),
    dartText: readText(root, DART_MECHANISMS),
  };
}

function main() {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const { problems, lost, notes } = check(inputsAt(root));
  if (lost.length) {
    console.error(`✗ COVERAGE LOST — assert-offers: ${lost.join('; ')}`);
    process.exit(2);
  }
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-offers: ${problems.length} problem(s) — never below cost, never free AI`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log('✓ assert-offers: every discount is above cost on every rail, no free offer carries AI, every channel has a code mechanism');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
