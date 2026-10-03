#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// listing-locales.mjs — every store listing an app has, per channel and per
// language, and what each one still owes. [lane aso-listings]
// Rows: O-STORE-LISTINGS-ENGLISH-ONLY, O-STORE-SCREENSHOTS (per-locale capture).
//
// ── THE LAYOUT (the lead's ruling R1, 2026-10-03, keeping #1164's) ───────────
//   apps/<app>/store/<channel>/            the register's sourceLocale (en)
//   apps/<app>/store/<channel>/<code>/     every other locale, <code> the
//                                          tooling/i18n/locales.json code
//   apps/<app>/store/listing-locales.json  dated exemptions (assert-bundle-locales limb B)
//   apps/<app>/aso/pending/<code>.json     agent-drafted listing text not yet
//                                          reviewed: it lives OUTSIDE store/ until
//                                          its review sheet passes and the owner
//                                          row lifts the exemption (--promote)
//   apps/<app>/aso/review/<code>.tsv       the review sheet, translation-qa's columns
//
// A language has one name here, the register code. The store's own spelling of
// it (Play `hi-IN`, Microsoft `hi-in`) is tooling/store/listing-languages.json,
// read through storeLanguage() and ONLY at the submit edge.
//
// Usage:
//   node tooling/store/listing-locales.mjs [--app <id>] [--json]   the plan, per channel x locale
// Exit 0 always for the plan (it is a report); the guard that fails is
// tooling/ci/assert-store-listings.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LANGUAGES = 'tooling/store/listing-languages.json';
export const LOCALE_REGISTER = 'tooling/i18n/locales.json';
export const CHANNEL_REGISTER = 'tooling/channel-register.json';
export const EXEMPTIONS = 'listing-locales.json';
/** The columns translation-qa.mjs `sheet()` writes; a listing sheet uses the same ones. */
export const SHEET_HEAD = ['surface', 'key', 'source_en', 'translation', 'back_translation', 'flags', 'filled_by', 'checked_by', 'verdict'];

const readJson = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

/** The app-surface store channels the register declares, in register order. */
export function storeChannels(root = DEFAULT_ROOT) {
  return readJson(root, CHANNEL_REGISTER).channels.filter((c) => c.kind === 'store' && c.surface === 'app').map((c) => c.id);
}

/** The register: { sourceLocale, codes (every non-pseudo row, supported or pending) }. */
export function registerLocales(root = DEFAULT_ROOT) {
  const reg = readJson(root, LOCALE_REGISTER);
  return { sourceLocale: reg.sourceLocale, codes: reg.locales.map((l) => l.code), rows: reg.locales };
}

export function loadLanguages(root = DEFAULT_ROOT) {
  return readJson(root, LANGUAGES);
}

/**
 * The code `channel` spells register locale `code` with. Throws, naming the
 * table, when the channel has no block, the locale is skipped there, or the
 * locale is unmapped: a submit tool must never guess a language.
 */
export function storeLanguage(channel, code, { root = DEFAULT_ROOT, table = loadLanguages(root) } = {}) {
  const block = table.channels?.[channel];
  if (!block) throw new Error(`${LANGUAGES} has no block for channel "${channel}".`);
  if (typeof block.codes?.[code] === 'string' && block.codes[code] !== '') return block.codes[code];
  if (typeof block.skip?.[code] === 'string') throw new Error(`${LANGUAGES} skips "${code}" on "${channel}": ${block.skip[code]}`);
  throw new Error(`${LANGUAGES} maps no store code for "${code}" on "${channel}".`);
}

/** Parse a review sheet. Returns { rows, passing, why }: passing only when every
 *  row has a verdict of `pass`, a checker, and a checker who is not the filler. */
export function readSheet(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l !== '');
  if (lines.length === 0) return { rows: [], passing: false, why: 'the sheet is empty' };
  const head = lines[0].split('\t');
  if (head.join('\t') !== SHEET_HEAD.join('\t')) return { rows: [], passing: false, why: `the header is not translation-qa's (${SHEET_HEAD.join(', ')})` };
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v ?? ''])));
  if (rows.length === 0) return { rows, passing: false, why: 'the sheet has no rows' };
  const unchecked = rows.filter((r) => !r.checked_by || r.checked_by.trim() === '');
  if (unchecked.length) return { rows, passing: false, why: `${unchecked.length} row(s) carry no checked_by: the independent review has not run` };
  const self = rows.filter((r) => r.checked_by.trim() === (r.filled_by ?? '').trim());
  if (self.length) return { rows, passing: false, why: `${self.length} row(s) were checked by the lane that filled them, which is not an independent review` };
  const failed = rows.filter((r) => r.verdict.trim().toLowerCase() !== 'pass');
  if (failed.length) return { rows, passing: false, why: `${failed.length} row(s) have a verdict other than pass` };
  return { rows, passing: true, why: null };
}

/** The CAPTURE.json manifests under a listing folder's screenshot sets, with the locale each one records. */
export function screenshotManifests(absDir) {
  if (!existsSync(absDir)) return [];
  const out = [];
  for (const de of readdirSync(absDir, { withFileTypes: true })) {
    if (!de.isDirectory() || !de.name.startsWith('screenshots')) continue;
    const m = join(absDir, de.name, 'CAPTURE.json');
    if (!existsSync(m)) continue;
    let locale = null;
    try {
      locale = JSON.parse(readFileSync(m, 'utf8')).locale ?? null;
    } catch {
      locale = null;
    }
    out.push({ set: de.name, locale });
  }
  return out;
}

/**
 * One row per (channel, register locale):
 *   { channel, locale, source, storeCode, skip, text, review, reviewWhy, screenshots, folder }
 * text: listing | pending-draft | exempt | missing | skipped
 * review: source | pass | pending | none
 * screenshots: manifest | pending | n/a — a non-source locale's set is ITS OWN
 *   folder's CAPTURE.json recording that locale; the English set never stands in.
 */
export function listingPlan(root = DEFAULT_ROOT, app = 'subscriptiontracker') {
  const { sourceLocale, codes } = registerLocales(root);
  const table = loadLanguages(root);
  const storeRel = `apps/${app}/store`;
  const exemptRel = `${storeRel}/${EXEMPTIONS}`;
  const exemptions = existsSync(join(root, exemptRel)) ? readJson(root, exemptRel).exemptions ?? [] : [];
  const pending = {};
  for (const code of codes) {
    const rel = `apps/${app}/aso/pending/${code}.json`;
    if (existsSync(join(root, rel))) pending[code] = readJson(root, rel);
  }
  const plan = [];
  for (const channel of storeChannels(root)) {
    const block = table.channels?.[channel] ?? {};
    for (const locale of codes) {
      const source = locale === sourceLocale;
      const folder = source ? `${storeRel}/${channel}` : `${storeRel}/${channel}/${locale}`;
      const storeCode = typeof block.codes?.[locale] === 'string' ? block.codes[locale] : null;
      const skip = typeof block.skip?.[locale] === 'string' ? block.skip[locale] : null;
      let text;
      if (existsSync(join(root, folder, 'title.txt'))) text = 'listing';
      else if (skip) text = 'skipped';
      else if (pending[locale]?.fields && Object.keys(pending[locale].fields).some((k) => k.startsWith(`${channel}/`))) text = 'pending-draft';
      else if (exemptions.some((e) => e.channel === channel && e.locale === locale)) text = 'exempt';
      else text = 'missing';
      let review = 'source';
      let reviewWhy = null;
      if (!source) {
        const sheetRel = `apps/${app}/aso/review/${locale}.tsv`;
        if (!existsSync(join(root, sheetRel))) {
          review = 'none';
          reviewWhy = `${sheetRel} does not exist`;
        } else {
          const s = readSheet(readFileSync(join(root, sheetRel), 'utf8'));
          review = s.passing ? 'pass' : 'pending';
          reviewWhy = s.why;
        }
      }
      let screenshots = 'n/a';
      if (text === 'listing' || text === 'pending-draft') {
        const sets = screenshotManifests(join(root, folder)).filter((m) => (source ? m.locale === null || m.locale === locale : m.locale === locale));
        screenshots = sets.length ? 'manifest' : 'pending';
      }
      plan.push({ channel, locale, source, storeCode, skip, text, review, reviewWhy, screenshots, folder });
    }
  }
  return plan;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const app = argv.includes('--app') ? argv[argv.indexOf('--app') + 1] : 'subscriptiontracker';
  const plan = listingPlan(DEFAULT_ROOT, app);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`listing-locales: ${app} — ${plan.length} (channel, locale) pair(s)`);
    for (const p of plan) {
      const code = p.storeCode ?? (p.skip ? 'skip' : '?');
      console.log(`  ${p.channel.padEnd(15)} ${p.locale.padEnd(4)} ${String(code).padEnd(6)} text=${p.text.padEnd(13)} review=${p.review.padEnd(7)} screenshots=${p.screenshots}${p.skip ? `  — ${p.skip}` : ''}`);
    }
  }
}
