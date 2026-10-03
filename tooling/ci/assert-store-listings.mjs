#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-store-listings.mjs — every store listing, in every language, is within
// its store's documented limits, makes no claim the product cannot keep, and
// reaches a store only after an independent review. [lane aso-listings]
// Rows: O-STORE-LISTINGS-ENGLISH-ONLY, O-ASO-RESEARCH-NEVER-RUN, O-STORE-SCREENSHOTS.
//
// ── WHY A SECOND LISTING GUARD ──────────────────────────────────────────────
// assert-store-metadata.mjs grades the FLAT tree, the source locale, and nothing
// else: it was written when a listing had no language axis. #1164 gave the tree
// one (store/<channel>/<code>/, R1 kept it) and this lane adds the agent-drafted
// text for it (apps/<app>/aso/pending/<code>.json). Every limb below reads ALL
// of them — the flat folder, each locale folder and each pending draft — so a
// Hindi keyword field is held to the same number an English one is.
//
// ── THE LIMBS ───────────────────────────────────────────────────────────────
//   L · LANGUAGES. tooling/store/listing-languages.json has a block for every
//       app-surface store channel in tooling/channel-register.json, and each
//       block maps or skips (with a reason) every locale in tooling/i18n/
//       locales.json, supported or pending; every block cites its source and
//       readAt. No submit tool spells a listing language as a literal
//       (`const LISTING_LANGUAGE = 'en-US'` was submit-play.mjs's): the code is
//       read from the table at the edge.
//   M · LIMITS. The register's sourced `maxChars` / `maxLines` apply to every
//       locale folder and every draft (the flat folder is store-metadata's), and
//       `maxBytes` (Apple's keywords field is a BYTE limit) to every folder,
//       flat included. A limit with no `source` is a finding, never enforced.
//   C · CLAIMS ([ADR 078], [ADR 068], the customer-pays lock). In every listing
//       text, draft, custom listing and promotional-text entry:
//         - no store commission, and no steer to a cheaper web price ([ADR 078]:
//           a store listing mentioning the web price is "never");
//         - no price figure in a locale folder or draft (the flat folder's is
//           assert-no-price-literals.mjs limb C, with the same PRICE matcher);
//         - never "free AI", and no AI claim at all until a feature in
//           tooling/ports/ai.json has a model wired (T17's customer-pays meter);
//         - no competitor's name in an Apple keywords field (apps/<app>/aso/
//           competitors.json, each entry with its listing URL and readAt).
//       Every matcher is proven against known wording and innocent wording before
//       it is used; a matcher that matches nothing is COVERAGE LOST.
//   R · REVIEW. A locale folder (store/<channel>/<code>/title.txt) needs a PASSING
//       review sheet at apps/<app>/aso/review/<code>.tsv: translation-qa.mjs's
//       columns, every row checked by someone other than its filler, every
//       verdict `pass`. A pending draft needs a sheet (it may be unchecked: that
//       is what pending means) and must say it is machine-assisted.
//   S · SCREENSHOTS. A locale with listing text and no CAPTURE.json of its own
//       (one recording THAT locale) is PRINTED as pending — the English set never
//       stands in for it.
//   A · ASO DATA. Every app with a store tree carries aso/custom-listings.json and
//       aso/promo-calendar.json (the brick emits both), each entry naming a
//       channel that has custom listings, a register locale and, for a
//       promotional-text entry, dates in order. A publish-flagged entry is
//       printed: tooling/store/custom-listings.mjs refuses it without --publish.
//       No research file (aso/research-<date>.md) is PRINTED, not failed.
//
// ⚠️ STATED LIMITS. Word matches per field, not meaning. Screenshot PIXELS are
// not read for a price: the capture runs on the seeded board
// (tooling/store/capture-play-screenshots.mjs), which holds no web price.
//
// Tests: tooling/ci/test/store-listings.test.mjs.
// Usage: node tooling/ci/assert-store-listings.mjs [repoRoot]
// Exit:  0 clean · 1 findings · 2 COVERAGE LOST
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICE } from './price-figure.mjs';
import { listDir } from './tree-walk.mjs';
import { LANGUAGES, listingPlan, readSheet, registerLocales, storeChannels } from '../store/listing-locales.mjs';

const ROOT_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHANNEL_REGISTER = 'tooling/channel-register.json';
const AI_PORT = 'tooling/ports/ai.json';
const BRICK_ASO = 'tooling/bricks/app/__brick__/apps/{{app_id}}/aso';
/** Listing files that are an address, a vocabulary choice or an identifier, not copy. */
const NOT_COPY = new Set(['privacy-policy-url.txt', 'support-url.txt', 'terms-of-use-url.txt', 'category.txt', 'license.txt', 'snap-name.txt']);
/** The channels whose stores have a custom-listing surface: Play custom store listings, Apple custom product pages. */
export const CUSTOM_LISTING_CHANNELS = Object.freeze(['android-play', 'ios-appstore']);
const APPLE_KEYWORDS = new Set(['ios-appstore/keywords.txt', 'macos-appstore/keywords.txt']);

const read = (root, rel) => {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch {
    return null;
  }
};
const readJson = (root, rel) => {
  const t = read(root, rel);
  if (t === null) return { missing: true };
  try {
    return { value: JSON.parse(t) };
  } catch (e) {
    return { error: e.message };
  }
};
export const charCount = (s) => [...String(s).replace(/\r\n/g, '\n').replace(/\n+$/, '')].length;
export const byteCount = (s) => Buffer.byteLength(String(s).replace(/\r\n/g, '\n').replace(/\n+$/, ''), 'utf8');

// ── the matchers, each with the wording it must catch and the wording it must not ──
export const MATCHERS = Object.freeze({
  commission: {
    re: /\bcommissions?\b|\bstore fees?\b|\b(?:apple|google|play)\s+(?:tax|cut)\b/i,
    known: ['Skip the 30% store commission', 'no app store fees', 'avoid the Apple tax'],
    innocent: ['a commissioned illustration', 'Track every subscription in one place'],
    rule: '[ADR 078]: a store listing never mentions the store commission.',
  },
  webSteer: {
    re: /\b(?:cheaper|lower price|less|save|discount)\b[^.\n]{0,40}\b(?:on|at|via|from)\s+(?:the\s+|our\s+)?(?:web(?:site)?|nikatru\.com)\b|\bbuy\b[^.\n]{0,30}\b(?:on|at)\s+(?:the\s+|our\s+)?(?:web(?:site)?|nikatru\.com)\b/i,
    known: ['It is cheaper on the web', 'Save 20% at nikatru.com', 'Buy Pro on our website'],
    innocent: ['Full policy: https://nikatru.com/privacy', 'Works offline. Your list is stored on your device'],
    rule: '[ADR 078] §11.2: a store listing never points the buyer at the web price ("never").',
  },
  freeAi: {
    re: /\bfree\b[^.\n]{0,20}\bAI\b|\bAI\b[^.\n]{0,20}\bfor free\b|\bfree\s+(?:artificial intelligence|GPT)\b/i,
    known: ['Free AI import', 'AI import, for free', 'free GPT summaries'],
    innocent: ['AI import with your own key', 'Track every subscription for free'],
    rule: 'The owner lock (2026-10-01): AI is paid only and is never advertised free.',
  },
  ai: {
    re: /\bAI\b|\bartificial intelligence\b|\bGPT\b|\bLLM\b|\bmachine learning\b/i,
    known: ['AI import', 'powered by artificial intelligence', 'GPT summaries'],
    innocent: ['Track every subscription', 'said it plainly'],
    rule: 'No AI claim until a customer-pays row exists: a feature in tooling/ports/ai.json with a model wired (train-st-ai-customer-pays, T17).',
  },
});

/** Every matcher catches its known wording and spares its innocent wording; else the matcher is lost. */
export function proveMatchers(matchers = MATCHERS) {
  const lost = [];
  for (const [id, m] of Object.entries(matchers)) {
    const missed = m.known.filter((w) => !m.re.test(w));
    const wolves = m.innocent.filter((w) => m.re.test(w));
    if (missed.length) lost.push(`matcher "${id}" no longer matches ${missed.map((w) => JSON.stringify(w)).join(', ')}`);
    if (wolves.length) lost.push(`matcher "${id}" fires on ${wolves.map((w) => JSON.stringify(w)).join(', ')}`);
  }
  return lost;
}

/** True when some AI feature has a model wired, i.e. the customer-pays meter exists. */
export function aiCustomerPays(root) {
  const j = readJson(root, AI_PORT);
  if (!j.value) return { lost: `${AI_PORT} ${j.missing ? 'does not exist' : `is not valid JSON (${j.error})`}` };
  const features = j.value.features;
  if (!features || typeof features !== 'object') return { lost: `${AI_PORT} declares no \`features\`` };
  return { paid: Object.values(features).some((f) => f && typeof f.model === 'string' && f.model !== '') };
}

// ── L ──────────────────────────────────────────────────────────────────────
export function gradeLanguages(root) {
  const problems = [];
  const t = readJson(root, LANGUAGES);
  if (!t.value) return { lost: [`${LANGUAGES} ${t.missing ? 'does not exist' : `is not valid JSON (${t.error})`}`], problems };
  const channels = storeChannels(root);
  if (channels.length === 0) return { lost: [`${CHANNEL_REGISTER} declares no app-surface store channel`], problems };
  const { codes } = registerLocales(root);
  if (codes.length === 0) return { lost: ['tooling/i18n/locales.json declares no locale'], problems };
  const blocks = t.value.channels ?? {};
  let pairs = 0;
  for (const ch of channels) {
    const b = blocks[ch];
    if (!b) {
      problems.push(`L: ${LANGUAGES} has no block for "${ch}", which ${CHANNEL_REGISTER} declares. Its listing language cannot be named at the submit edge.`);
      continue;
    }
    if (typeof b.source?.url !== 'string' || b.source.url.trim() === '' || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.source?.readAt ?? ''))) {
      problems.push(`L: ${LANGUAGES} "${ch}" cites no source.url and source.readAt (YYYY-MM-DD). A store code nobody read is a guess.`);
    }
    for (const code of codes) {
      pairs++;
      const mapped = typeof b.codes?.[code] === 'string' && b.codes[code].trim() !== '';
      const skipped = typeof b.skip?.[code] === 'string' && b.skip[code].trim().length >= 10;
      if (mapped && skipped) problems.push(`L: ${LANGUAGES} "${ch}" both maps and skips "${code}". Say one.`);
      if (!mapped && !skipped) problems.push(`L: ${LANGUAGES} "${ch}" neither maps nor skips register locale "${code}". A language the register declares needs this store's code for it, or the reason this store has no listing in it.`);
    }
  }
  for (const ch of Object.keys(blocks)) {
    if (!channels.includes(ch)) problems.push(`L: ${LANGUAGES} has a block for "${ch}", which ${CHANNEL_REGISTER} does not declare as an app-surface store channel.`);
  }
  return { lost: [], problems, pairs };
}

/** A listing language spelled as a literal in a submit tool. */
export const LANGUAGE_LITERAL = /\b[A-Z_]*LANGUAGE\s*=\s*['"`][a-z]{2,3}(?:[-_][A-Za-z]{2,4})?['"`]/;
export function gradeLiterals(root) {
  const problems = [];
  const dir = join(root, 'tooling', 'release');
  if (!existsSync(dir)) return { lost: ['tooling/release/ does not exist, so no submit tool was read for a language literal'], problems };
  const files = listDir(dir).filter((f) => /^submit-.*\.mjs$/.test(f));
  if (files.length === 0) return { lost: ['tooling/release/ holds no submit-*.mjs, so no submit tool was read for a language literal'], problems };
  for (const f of files) {
    const lines = read(root, `tooling/release/${f}`).split('\n');
    lines.forEach((l, i) => {
      if (LANGUAGE_LITERAL.test(l)) problems.push(`L: tooling/release/${f}:${i + 1} spells a listing language as a literal (${l.trim()}). Read it from ${LANGUAGES} through storeLanguage() (tooling/store/listing-locales.mjs).`);
    });
  }
  return { lost: [], problems, files: files.length };
}

// ── the listing texts: flat, locale folders, drafts ─────────────────────────
/** Every listing text this guard reads: [{ app, channel, locale, origin, file, rel, text }]. */
export function listingTexts(root, app) {
  const { sourceLocale, codes } = registerLocales(root);
  const out = [];
  const storeRel = `apps/${app}/store`;
  for (const channel of storeChannels(root)) {
    const flat = `${storeRel}/${channel}`;
    if (!existsSync(join(root, flat))) continue;
    for (const locale of codes) {
      const folder = locale === sourceLocale ? flat : `${flat}/${locale}`;
      if (!existsSync(join(root, folder, 'title.txt'))) continue;
      for (const f of listDir(join(root, folder)).filter((n) => n.endsWith('.txt') && !NOT_COPY.has(n))) {
        out.push({ app, channel, locale, origin: locale === sourceLocale ? 'flat' : 'folder', file: f, rel: `${folder}/${f}`, text: read(root, `${folder}/${f}`) });
      }
    }
  }
  for (const locale of codes) {
    const rel = `apps/${app}/aso/pending/${locale}.json`;
    const j = readJson(root, rel);
    if (!j.value) continue;
    for (const [key, v] of Object.entries(j.value.fields ?? {})) {
      const [channel, file] = key.split('/');
      out.push({ app, channel, locale, origin: 'draft', file, rel: `${rel}#${key}`, text: String(v?.text ?? '') });
    }
  }
  return out;
}

// ── M ──────────────────────────────────────────────────────────────────────
export function gradeLimits(root, texts) {
  const problems = [];
  const reg = readJson(root, CHANNEL_REGISTER);
  const per = reg.value?.storeMetadataContract?.perChannel ?? {};
  let measured = 0;
  for (const t of texts) {
    const c = per[t.channel] ?? {};
    const blocks = [];
    if (t.origin !== 'flat') blocks.push(['maxChars', c.maxChars?.[t.file], charCount], ['maxLines', c.maxLines?.[t.file], (s) => String(s).split('\n').map((l) => l.trim()).filter(Boolean).length]);
    blocks.push(['maxBytes', c.maxBytes?.[t.file], byteCount]);
    for (const [kind, lim, count] of blocks) {
      if (!lim || (!Number.isInteger(lim.max) && !Number.isInteger(lim.min))) continue;
      if (typeof lim.source !== 'string' || lim.source.trim() === '') {
        problems.push(`M: ${CHANNEL_REGISTER} storeMetadataContract.perChannel["${t.channel}"].${kind}["${t.file}"] has no \`source\`; an unsourced limit is reported, never enforced.`);
        continue;
      }
      measured++;
      const n = count(t.text);
      if (Number.isInteger(lim.max) && n > lim.max) problems.push(`M: ${t.rel} is ${n} (${kind}) and the limit is ${lim.max}. Source: ${lim.source}`);
      if (Number.isInteger(lim.min) && n < lim.min) problems.push(`M: ${t.rel} is ${n} (${kind}) and the minimum is ${lim.min}. Source: ${lim.source}`);
    }
  }
  return { problems, measured };
}

// ── C ──────────────────────────────────────────────────────────────────────
export function gradeClaims(root, texts, { paid, competitors = [] }) {
  const problems = [];
  for (const t of texts) {
    if (MATCHERS.commission.re.test(t.text)) problems.push(`C: ${t.rel} names the store commission or its fees. ${MATCHERS.commission.rule}`);
    if (MATCHERS.webSteer.re.test(t.text)) problems.push(`C: ${t.rel} steers the buyer to the web price. ${MATCHERS.webSteer.rule}`);
    if (t.origin !== 'flat') {
      const p = PRICE.exec(t.text);
      if (p) problems.push(`C: ${t.rel} names a price (${JSON.stringify(p[0].trim())}). A store listing states no price; the rail charges it.`);
    }
    if (MATCHERS.freeAi.re.test(t.text)) problems.push(`C: ${t.rel} advertises free AI. ${MATCHERS.freeAi.rule}`);
    else if (!paid && MATCHERS.ai.re.test(t.text)) problems.push(`C: ${t.rel} makes an AI claim and no customer-pays row exists. ${MATCHERS.ai.rule}`);
    if (APPLE_KEYWORDS.has(`${t.channel}/${t.file}`)) {
      const words = String(t.text).toLowerCase();
      for (const c of competitors) {
        for (const term of c.terms ?? []) {
          if (new RegExp(`(^|[,\\s])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[,\\s])`).test(words)) {
            problems.push(`C: ${t.rel} carries "${term}", the name of ${c.name} (${c.url}, read ${c.readAt}). App Store Review Guideline 2.3.7: keywords never name another app.`);
          }
        }
      }
    }
  }
  return { problems };
}

// ── R ──────────────────────────────────────────────────────────────────────
export function gradeReview(root, app, texts) {
  const problems = [];
  const { sourceLocale, codes } = registerLocales(root);
  for (const locale of codes.filter((c) => c !== sourceLocale)) {
    const sheetRel = `apps/${app}/aso/review/${locale}.tsv`;
    const sheetText = read(root, sheetRel);
    const sheet = sheetText === null ? null : readSheet(sheetText);
    const folders = [...new Set(texts.filter((t) => t.locale === locale && t.origin === 'folder').map((t) => t.rel.split('/').slice(0, -1).join('/')))];
    for (const f of folders) {
      if (!sheet) problems.push(`R: ${f}/ is a ${locale} listing and ${sheetRel} does not exist. A listing in a language reaches a store only after an independent review (back-translation, fluency, placeholders, length).`);
      else if (!sheet.passing) problems.push(`R: ${f}/ is a ${locale} listing and its review sheet ${sheetRel} does not pass: ${sheet.why}. Keep it a pending draft (apps/${app}/aso/pending/${locale}.json) until it does.`);
    }
    const draftRel = `apps/${app}/aso/pending/${locale}.json`;
    const draft = readJson(root, draftRel);
    if (draft.value) {
      if (draft.value.machineAssisted !== true) problems.push(`R: ${draftRel} does not say \`machineAssisted: true\`. An agent-drafted translation is marked as one.`);
      if (!sheet) problems.push(`R: ${draftRel} is a ${locale} draft with no review sheet at ${sheetRel}. Write it: node tooling/store/listing-qa.mjs ${locale} --app ${app} --sheet.`);
    } else if (draft.error) problems.push(`R: ${draftRel} is not valid JSON (${draft.error}).`);
  }
  return { problems };
}

// ── A ──────────────────────────────────────────────────────────────────────
export function gradeAsoData(root, app, { codes }) {
  const problems = [];
  const prints = [];
  const texts = [];
  const cl = readJson(root, `apps/${app}/aso/custom-listings.json`);
  const pc = readJson(root, `apps/${app}/aso/promo-calendar.json`);
  if (!cl.value) problems.push(`A: apps/${app}/aso/custom-listings.json ${cl.missing ? 'does not exist' : `is not valid JSON (${cl.error})`}. The brick emits it; an app without it has no custom listings as data.`);
  if (!pc.value) problems.push(`A: apps/${app}/aso/promo-calendar.json ${pc.missing ? 'does not exist' : `is not valid JSON (${pc.error})`}. The brick emits it; an app without it has no promotional-text cadence.`);
  for (const [i, e] of (cl.value?.listings ?? []).entries()) {
    const at = `apps/${app}/aso/custom-listings.json listings[${i}]`;
    if (!CUSTOM_LISTING_CHANNELS.includes(e.channel)) problems.push(`A: ${at} names channel ${JSON.stringify(e.channel)}; only ${CUSTOM_LISTING_CHANNELS.join(' and ')} have custom listings.`);
    if (!codes.includes(e.locale)) problems.push(`A: ${at} names locale ${JSON.stringify(e.locale)}, which tooling/i18n/locales.json does not declare.`);
    if (typeof e.id !== 'string' || !/^[a-z0-9-]+$/.test(e.id)) problems.push(`A: ${at} has no lower-kebab \`id\`.`);
    if (typeof e.audience !== 'string' || e.audience.trim().length < 10) problems.push(`A: ${at} names no audience.`);
    if (e.publish === true) prints.push(`PUBLISH-FLAGGED: ${at} (${e.id}) — custom-listings.mjs refuses it without --publish, which is the owner's approval at the publish sitting.`);
    for (const [file, text] of Object.entries(e.fields ?? {})) texts.push({ app, channel: e.channel, locale: e.locale, origin: 'custom', file, rel: `${at}.fields["${file}"]`, text: String(text) });
  }
  for (const [i, e] of (pc.value?.entries ?? []).entries()) {
    const at = `apps/${app}/aso/promo-calendar.json entries[${i}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.to)) || e.from > e.to) problems.push(`A: ${at} needs \`from\` <= \`to\`, both YYYY-MM-DD.`);
    for (const ch of e.channels ?? []) {
      for (const [locale, text] of Object.entries(e.text ?? {})) {
        if (!codes.includes(locale)) problems.push(`A: ${at} has text for ${JSON.stringify(locale)}, which tooling/i18n/locales.json does not declare.`);
        texts.push({ app, channel: ch, locale, origin: 'promo', file: 'promotional-text.txt', rel: `${at}.text.${locale}`, text: String(text) });
      }
    }
  }
  const asoDir = join(root, 'apps', app, 'aso');
  const research = existsSync(asoDir) ? listDir(asoDir).filter((f) => /^research-\d{4}-\d{2}-\d{2}\.md$/.test(f)) : [];
  if (research.length === 0) prints.push(`NO ASO RESEARCH: apps/${app}/aso/research-<date>.md does not exist. Keywords and titles are then chosen without a cited pass.`);
  return { problems, prints, texts, research };
}

export function competitorsOf(root, app) {
  const j = readJson(root, `apps/${app}/aso/competitors.json`);
  return j.value?.competitors ?? [];
}

/** Store apps: every apps/<id>/ with a store/ tree. */
export function storeApps(root) {
  const dir = join(root, 'apps');
  if (!existsSync(dir)) return [];
  return listDir(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'store')))
    .map((d) => d.name)
    .sort();
}

export function grade(root = ROOT_DEFAULT) {
  const lost = [];
  const problems = [];
  const prints = [];
  const oks = [];
  lost.push(...proveMatchers().map((m) => `${m}. Every clean result would come from a matcher that is wrong.`));
  const ai = aiCustomerPays(root);
  if (ai.lost) lost.push(`${ai.lost}, so whether an AI claim is allowed is undecidable.`);
  const L = gradeLanguages(root);
  lost.push(...L.lost);
  problems.push(...L.problems);
  const Lit = gradeLiterals(root);
  lost.push(...Lit.lost);
  problems.push(...Lit.problems);
  if (L.pairs) oks.push(`L: ${L.pairs} (channel, locale) pair(s) mapped or skipped with a reason; ${Lit.files ?? 0} submit tool(s) carry no language literal`);
  for (const b of ['custom-listings.json', 'promo-calendar.json']) {
    if (!existsSync(join(root, BRICK_ASO, b))) problems.push(`A: ${BRICK_ASO}/${b} does not exist. A new app gets its custom listings and promotional cadence by stamping, or not at all.`);
  }
  const apps = storeApps(root);
  if (apps.length === 0) lost.push('no apps/<id>/store/ tree exists, so no listing was read');
  const { codes } = registerLocales(root);
  let textCount = 0;
  let measured = 0;
  for (const app of apps) {
    const texts = listingTexts(root, app);
    const A = gradeAsoData(root, app, { codes });
    problems.push(...A.problems);
    prints.push(...A.prints);
    const all = [...texts, ...A.texts];
    textCount += all.length;
    const M = gradeLimits(root, all);
    problems.push(...M.problems);
    measured += M.measured;
    if (!ai.lost) problems.push(...gradeClaims(root, all, { paid: ai.paid, competitors: competitorsOf(root, app) }).problems);
    problems.push(...gradeReview(root, app, texts).problems);
    for (const p of listingPlan(root, app)) {
      if (!p.source && p.screenshots === 'pending') prints.push(`PENDING SCREENSHOTS: ${p.channel} ${p.locale} has listing text (${p.text}) and no CAPTURE.json recording locale "${p.locale}" under ${p.folder}/screenshots*/ — the English set does not stand in for it. Lead step: dispatch the capture with --locale ${p.locale}.`);
      if (!p.source && p.text === 'pending-draft') prints.push(`PENDING TEXT: ${p.channel} ${p.locale} is an agent draft (review: ${p.review}${p.reviewWhy ? ` — ${p.reviewWhy}` : ''}).`);
    }
  }
  if (apps.length && textCount === 0) lost.push('store trees exist and not one listing text was read');
  if (textCount && measured === 0) lost.push(`${textCount} listing text(s) were read and not one was measured against a sourced limit`);
  oks.push(`M/C: ${textCount} listing text(s) over ${apps.length} app(s), ${measured} measurement(s) against a sourced limit; AI claims ${ai.paid ? 'allowed (a customer-pays feature is wired)' : 'refused (no customer-pays feature is wired)'}`);
  return { lost, problems, prints, oks };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : ROOT_DEFAULT;
  const r = grade(root);
  if (r.lost.length) {
    console.error('assert-store-listings: COVERAGE LOST');
    for (const l of r.lost) console.error(`  - ${l}`);
    process.exit(2);
  }
  for (const p of r.prints) console.log(`⬜ ${p}`);
  for (const o of r.oks) console.log(`✅ ${o}`);
  if (r.problems.length) {
    console.error(`assert-store-listings: ${r.problems.length} finding(s)`);
    for (const p of r.problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('assert-store-listings: OK');
}
