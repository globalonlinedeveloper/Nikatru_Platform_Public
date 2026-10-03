#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// itemised-notice.mjs — the DPDP Rules 2025 rule 3 itemised notice, RENDERED from
// tooling/legal/data-inventory.json (lane dpdp-rights, Do 5;
// O-DPDP-ITEMISED-NOTICE-MISSING).
//
// Rule 3 asks a notice to itemise the personal data and the purpose of each. The
// inventory already enumerates every store that holds personal data — derived from
// the migrations and the bindings, so a new table cannot be missed — and each row
// now carries a public `notice: { item, purpose, kept? }`. This file groups the
// rows by `item` and renders one table:
//
//     What we hold · Why · How long we keep it
//
// where "how long" is COMPUTED from the row's own `retention` (a `swept` row's
// `periodDays`, "while your account exists" for `keep`), never typed twice, unless
// the row's `notice.kept` says it in words because the kind cannot (`ttl`,
// `undecided`, a `keep` that is not about an account).
//
// WHERE IT LANDS:
//   · sites/nikatru/privacy.html, between <!-- ITEMISED-NOTICE --> and
//     <!-- /ITEMISED-NOTICE --> — every row, the portfolio notice;
//   · each app's notice (tooling/app-yaml/render-privacy.mjs, section 6) — the
//     shared rows plus that app's own database's rows (`rowsForApp`).
//
// WHO HOLDS IT: tooling/ci/assert-data-inventory.mjs fails a personal-data row with
// no `notice`, and fails privacy.html when its region is not exactly this render
// (a hand edit inside the region, or an inventory row added without re-rendering);
// render-privacy.mjs --check holds the app pages the same way.
//
// Usage:  node tooling/legal/itemised-notice.mjs [--write] [repoRoot]
//   default: check, exit 1 naming the page whose region differs; --write re-renders.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPEN = '<!-- ITEMISED-NOTICE -->';
export const CLOSE = '<!-- /ITEMISED-NOTICE -->';
export const INVENTORY = 'tooling/legal/data-inventory.json';
export const PORTFOLIO_NOTICE = 'sites/nikatru/privacy.html';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The words the table is written in, per notice locale. English is the binding
 * text; a translated notice (sites/nikatru/legal/<version>/<locale>/) carries the
 * same table in its locale, from each row's `notice.<locale>`.
 */
export const WORDS = Object.freeze({
  en: { head: ['What we hold', 'Why', 'How long we keep it'], days: (n) => (n === 1 ? '1 day' : `${n} days`), account: 'while your account exists' },
  ta: { head: ['நாங்கள் வைத்திருப்பது', 'ஏன்', 'எவ்வளவு காலம் வைத்திருக்கிறோம்'], days: (n) => (n === 1 ? '1 நாள்' : `${n} நாட்கள்`), account: 'உங்கள் கணக்கு இருக்கும் வரை' },
  hi: { head: ['हम क्या रखते हैं', 'क्यों', 'कितने समय तक रखते हैं'], days: (n) => `${n} दिन`, account: 'जब तक आपका खाता है' },
});
export const LOCALES = Object.freeze(Object.keys(WORDS));

/** A row's notice text in `locale` (`item`, `purpose`, `kept?`), or null. */
const textOf = (store, locale) => (locale === 'en' ? store?.notice : store?.notice?.[locale]) ?? null;

/** How long one row is kept, in words, from its own retention declaration. */
export function keptOf(store, locale = 'en') {
  const t = textOf(store, locale);
  if (typeof t?.kept === 'string' && t.kept.trim() !== '') return t.kept.trim();
  if (locale !== 'en' && typeof store?.notice?.kept === 'string') return null; // an override with no translation
  const r = store?.retention ?? {};
  if (r.kind === 'swept' && Number.isInteger(r.periodDays)) return WORDS[locale].days(r.periodDays);
  if (r.kind === 'keep') return WORDS[locale].account;
  return null;
}

/** Personal-data rows with no usable `notice` (or no computable retention): each is a finding. */
export function missingNotice(inventory) {
  const out = [];
  for (const s of inventory?.stores ?? []) {
    if (s?.personalData !== true) continue;
    const n = s.notice;
    for (const locale of LOCALES) {
      const t = textOf(s, locale);
      const at = locale === 'en' ? 'notice' : `notice.${locale}`;
      if (!t || typeof t.item !== 'string' || !t.item.trim() || typeof t.purpose !== 'string' || !t.purpose.trim()) {
        out.push(`${s.id}: no ${at}.item / ${at}.purpose`);
      } else if (keptOf(s, locale) === null) {
        out.push(`${s.id}: retention kind \`${s.retention?.kind}\` cannot be said in words; give ${at}.kept`);
      }
    }
  }
  return out;
}

/** The rows an app's notice carries: shared stores and its own database, never another app's. */
export function rowsForApp(store, appId) {
  const m = /^table:([a-z0-9_]+)_db\./.exec(store.id ?? '');
  return !m || m[1] === 'platform' || m[1] === appId;
}

/** The itemised lines, grouped by `item` in inventory order. */
export function noticeLines(inventory, { appId = null, locale = 'en' } = {}) {
  const lines = new Map();
  for (const s of inventory?.stores ?? []) {
    const t = textOf(s, locale);
    if (s?.personalData !== true || !t?.item) continue;
    if (appId !== null && !rowsForApp(s, appId)) continue;
    const key = t.item.trim();
    const line = lines.get(key) ?? { item: key, purposes: [], kept: [] };
    if (!line.purposes.includes(t.purpose.trim())) line.purposes.push(t.purpose.trim());
    const kept = keptOf(s, locale);
    if (kept && !line.kept.includes(kept)) line.kept.push(kept);
    lines.set(key, line);
  }
  return [...lines.values()];
}

/** The table, one line per item. `indent` prefixes every line. */
export function renderTable(inventory, { appId = null, indent = '  ', locale = 'en' } = {}) {
  const rows = noticeLines(inventory, { appId, locale });
  const [h1, h2, h3] = WORDS[locale].head;
  const out = [`${indent}<table class="itemised">`, `${indent}  <tr><th>${esc(h1)}</th><th>${esc(h2)}</th><th>${esc(h3)}</th></tr>`];
  for (const r of rows) {
    out.push(`${indent}  <tr><td>${esc(r.item)}</td><td>${esc(r.purposes.join(' '))}</td><td>${esc(r.kept.join('; '))}</td></tr>`);
  }
  out.push(`${indent}</table>`);
  return out.join('\n');
}

/** `html` with its region re-rendered, or null when the page carries no region. */
export function withRegion(html, inventory, locale = 'en') {
  const a = html.indexOf(OPEN);
  const b = html.indexOf(CLOSE);
  if (a < 0 || b < a || html.indexOf(OPEN, a + 1) >= 0) return null;
  return `${html.slice(0, a + OPEN.length)}\n${renderTable(inventory, { locale })}\n  ${html.slice(b)}`;
}

/**
 * The pages the render owns: the live English notice, and every translation filed
 * under the version that notice declares (the in-force translations; superseded
 * versions are frozen and never re-rendered).
 */
export function ownedPages(root) {
  const live = readFileSync(join(root, PORTFOLIO_NOTICE), 'utf8');
  const version = live.match(/data-policy-version="(\d{4}-\d{2}-\d{2})"/)?.[1];
  const pages = [{ rel: PORTFOLIO_NOTICE, locale: 'en' }];
  if (version) {
    for (const locale of LOCALES) {
      if (locale === 'en') continue;
      const rel = `sites/nikatru/legal/${version}/${locale}/privacy.html`;
      if (existsSync(join(root, rel))) pages.push({ rel, locale });
    }
  }
  return pages;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const root = resolve(args.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const inventory = JSON.parse(readFileSync(join(root, INVENTORY), 'utf8'));
  const missing = missingNotice(inventory);
  if (missing.length) {
    console.error(`✗ itemised notice — ${missing.length} personal-data row(s) cannot be itemised:`);
    for (const m of missing) console.error(`    ${m}`);
    process.exit(1);
  }
  let stale = 0;
  for (const { rel, locale } of ownedPages(root)) {
    const html = readFileSync(join(root, rel), 'utf8');
    const next = withRegion(html, inventory, locale);
    if (next === null) {
      console.error(`✗ COVERAGE LOST — ${rel} carries no single ${OPEN} … ${CLOSE} region.`);
      process.exit(2);
    }
    if (next === html) {
      console.log(`ok  itemised notice — ${rel} carries ${noticeLines(inventory, { locale }).length} item(s) rendered from ${INVENTORY}`);
    } else if (write) {
      writeFileSync(join(root, rel), next);
      console.log(`wrote ${rel}`);
    } else {
      console.error(`✗ itemised notice — ${rel}'s region is not the render of ${INVENTORY}. Run node tooling/legal/itemised-notice.mjs --write.`);
      stale++;
    }
  }
  if (stale) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
