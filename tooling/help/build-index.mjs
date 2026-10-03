#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// build-index.mjs — the help centre, built from content/help/ (lane help-search;
// rows O-HELP-CENTRE-UNBUILT, O-HELP-SEARCH-RECALL-UNGUARDED).
//
//   node tooling/help/build-index.mjs [repoRoot]           write every output
//   node tooling/help/build-index.mjs [repoRoot] --check   compare, write nothing
//
// tooling/sites/gen-help-centre.mjs runs this from tooling/sites/regen.mjs ORDER,
// so the site chain, the stamp and ci.yml's `--check` all reach it.
//
// THE SOURCE. content/help/<scope>/<locale>/<slug>.md, one article each:
//     ---
//     title: …            summary: …
//     platforms: [web, android, …]
//     minVersion: 1.0.0   updated: YYYY-MM-DD
//     gate:               (at least one; EVERY gate must be on — below)
//       - <kind>:<what>
//     asked:              (at least five ways people ask for this)
//       - a question
//     ---
//     a body in a small Markdown subset: paragraphs, `- ` lists, **bold**,
//     [links](https://nikatru.com/…). Anything else is refused, never guessed.
// scope = `platform`, an app id, or an extension id (SCOPES below). Locales are
// the SUPPORTED rows of tooling/i18n/locales.json; a locale with no article of
// its own is served the source locale's, and the apps say so.
// content/known-issues/ (tooling/ci/assert-known-issues.mjs) joins the index.
//
// 🔴 THE GATES — an article describes only what has shipped. Each `gate:` line
// names a fact in the tree, and the build refuses an article any of whose gates
// is off:
//   config:<app>.features.<name>   services/platform/src/app-config-data.json
//                                  apps.<app>.features.<name> === true
//   config:<app>.paywall.enabled   … apps.<app>.paywall.enabled === true
//   dod:<app>:<feature name>       apps/<app>/dod.json carries that feature row
//   l10n:<app>:<key>               apps/<app>/lib/l10n/app_en.arb has the key
//   l10n:chassis:<key>             packages/design_system/…/chassis_en.arb has it
//   ext:<dir>:<key>                extensions/Extension/<dir>/_locales/en/
//                                  messages.json has the key
//   page:/<path>[#id]              sites/nikatru serves the page (and the id)
//   site:<dir>                     sites/<dir>/index.html exists (another deploy
//                                  root, e.g. the status page)
// 🔴 NO PRICE. A price literal (a currency sign or code beside a number) is
// refused: prices live on /pricing, and terms and refund wording is the owner's
// — an article links those pages, never restates them.
//
// THE OUTPUTS, each compared byte for byte by --check:
//   apps/<id>/lib/help/help_index.g.dart        that app's index (its scope +
//                                               platform), every locale
//   tooling/bricks/…/lib/help/help_index.g.dart the brick's (platform only), so a
//                                               fresh stamp equals a regeneration
//   sites/nikatru/help/index.<locale>.json      the same index, for the site
//   sites/nikatru/js/help-search.mjs            tooling/help/search.mjs, served
//   sites/nikatru/help/index.html               every article, every scope
//   sites/nikatru/help/fullshot/index.html      FullShot's own support page
//   sites/nikatru/help/known-issues.html        content/known-issues/, rendered
//   extensions/Extension/Full_Screen_Shot/pages/help-search.js + help-index.js
//   extensions/templates/tool/lib/help-search.js + help-index.js
//                                               the options-page Help panel's
//                                               ranker and bundled index
//   content/help/_eval/conformance.json         the JS ranking of every eval
//                                               query: the fixture the Dart
//                                               search (packages/help) reproduces
//
// THE MEASURES (--check, and every write refuses on them):
//   budget    an index over INDEX_BUDGET_BYTES, or a body over BODY_BUDGET_CHARS.
//   recall    every locale with articles of its own carries content/help/_eval/
//             <locale>.json: at least MIN_EVAL_PAIRS {query, expect} pairs in
//             users' words (a query equal to an `asked` line is refused), top-3
//             recall at least RECALL_FLOOR overall AND for every article the set
//             names — so one article that can no longer be found is red even
//             when the average hides it.
//
// No model, no network, no paid API; no child process. Paths are joined per
// segment, so a Windows checkout writes the same files.
//
// Exit 0 current / written · 1 a finding (stale output, a refused article, a
// measure) · 2 COVERAGE LOST (no content/help, no article, an unreadable register).
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChrome } from '../sites/chrome.mjs';
import { frontMatter as knownIssueFrontMatter } from '../ci/assert-known-issues.mjs';
import { search, tokenize, weightedTerms } from './search.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CONTENT = 'content/help';
export const KNOWN = 'content/known-issues';
export const EVAL_DIR = 'content/help/_eval';
export const SYNONYM_DIR = 'content/help/_synonyms';
export const CONFORMANCE = 'content/help/_eval/conformance.json';
export const SEARCH_SERVED = 'sites/nikatru/js/help-search.mjs';
/** Each app's own Dart index (its scope plus `platform`), and the brick's (platform only).
 *  Generated INTO the app, never into packages/help: shared code carries no app's
 *  articles (assert-no-clone-tells, [pipeline C-10]). */
export const DART_INDEX_REL = 'lib/help/help_index.g.dart';
export const BRICK_APP = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
export const SITE_DIR = 'sites/nikatru/help';
/** The extension bundles: where each writes its ranker and its index, and which scopes it carries. */
export const EXTENSION_BUNDLES = [
  { dir: 'extensions/Extension/Full_Screen_Shot/pages', scopes: ['fullshot'] },
  { dir: 'extensions/templates/tool/lib', scopes: ['platform'] },
];
/** @ceiling none — our own bundle budget: the apps and extensions ship the index. */
export const INDEX_BUDGET_BYTES = 300 * 1024;
/** @ceiling none — our own reading budget for one article. */
export const BODY_BUDGET_CHARS = 4000;
export const MIN_EVAL_PAIRS = 50;
export const RECALL_FLOOR = 0.9;
export const MIN_ASKED = 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION = /^\d{1,5}(\.\d{1,5}){0,3}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const ORIGIN = 'https://nikatru.com';
/** A price: a currency sign or code beside a number, either order. */
export const PRICE = /(?:[₹$€£¥]\s?\d|\b(?:Rs\.?|INR|USD|EUR|GBP)\s?\d|\d[\d,.]*\s?(?:₹|\$|€|£|rupees?|dollars?|euros?|INR|USD|EUR)\b|\/-)/i;

/** The scopes and their public names. A directory under content/help/ that is
 *  not one of these is refused, so a new scope is a decision made here. */
export const SCOPES = {
  subscriptiontracker: 'Subscription Tracker',
  platform: 'Your Nikatru account and support',
  fullshot: 'FullShot',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
/** A repo-relative POSIX path joined onto `root` one segment at a time. */
const abs = (root, rel) => path.join(root, ...rel.split('/'));
const readJson = (root, rel) => JSON.parse(readFileSync(abs(root, rel), 'utf8'));

/** An article's front matter and body, or { error }. */
export function parseArticle(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return { error: 'no front matter' };
  const fm = {};
  let list = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && list) {
      fm[list].push(item[1].trim());
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) return { error: `front matter line not understood: ${JSON.stringify(line)}` };
    const [, k, v] = kv;
    list = null;
    if (v === '') {
      fm[k] = [];
      list = k;
    } else if (/^\[.*\]$/.test(v)) fm[k] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else fm[k] = v.replace(/^["']|["']$/g, '');
  }
  return { fm, body: text.slice(m[0].length) };
}

/** Problems with one parsed article's shape (the gates are checked separately). */
export function checkArticle(rel, fm, body) {
  const out = [];
  for (const k of ['title', 'summary', 'minVersion', 'updated']) if (typeof fm[k] !== 'string' || fm[k] === '') out.push(`${rel}: no ${k}`);
  if (!Array.isArray(fm.platforms) || fm.platforms.length === 0) out.push(`${rel}: platforms must be a non-empty list`);
  if (typeof fm.minVersion === 'string' && !VERSION.test(fm.minVersion)) out.push(`${rel}: minVersion ${JSON.stringify(fm.minVersion)} is not a version`);
  if (typeof fm.updated === 'string' && !DATE.test(fm.updated)) out.push(`${rel}: updated must be YYYY-MM-DD`);
  if (!Array.isArray(fm.asked) || fm.asked.length < MIN_ASKED) out.push(`${rel}: asked needs at least ${MIN_ASKED} questions`);
  if (!Array.isArray(fm.gate) || fm.gate.length === 0) out.push(`${rel}: no gate — an article names the shipped feature it describes`);
  if (body.trim() === '') out.push(`${rel}: no body`);
  if (body.length > BODY_BUDGET_CHARS) out.push(`${rel}: body is ${body.length} characters, over the ${BODY_BUDGET_CHARS} budget`);
  const all = [fm.title, fm.summary, ...(Array.isArray(fm.asked) ? fm.asked : []), body].join('\n');
  const price = PRICE.exec(all);
  if (price) out.push(`${rel}: a price (${JSON.stringify(price[0])}) — prices live on /pricing; link it`);
  return out;
}

/**
 * Whether one gate is on in the tree under `root`: { on, why }. `cache` holds
 * each file read once per build.
 */
export function gateState(root, gate, cache = new Map()) {
  const load = (rel, parse) => {
    if (!cache.has(rel)) {
      let v = null;
      try {
        v = parse(readFileSync(abs(root, rel), 'utf8'));
      } catch {
        v = null;
      }
      cache.set(rel, v);
    }
    return cache.get(rel);
  };
  const m = /^([a-z0-9]+):(.+)$/.exec(gate);
  if (!m) return { on: false, why: `gate ${JSON.stringify(gate)} is not <kind>:<what>` };
  const [, kind, what] = m;
  if (kind === 'config') {
    const cfg = load('services/platform/src/app-config-data.json', JSON.parse);
    const [app, ...keys] = what.split('.');
    let v = cfg?.apps?.[app];
    for (const k of keys) v = v?.[k];
    return v === true ? { on: true } : { on: false, why: `app-config-data.json apps.${what} is ${JSON.stringify(v ?? null)}, not true` };
  }
  if (kind === 'dod') {
    const i = what.indexOf(':');
    const app = what.slice(0, i);
    const feature = what.slice(i + 1);
    const dod = load(`apps/${app}/dod.json`, JSON.parse);
    const ok = Array.isArray(dod?.features) && dod.features.some((f) => f?.name === feature);
    return ok ? { on: true } : { on: false, why: `apps/${app}/dod.json has no feature row "${feature}"` };
  }
  if (kind === 'l10n') {
    const i = what.indexOf(':');
    const app = what.slice(0, i);
    const key = what.slice(i + 1);
    const rel = app === 'chassis' ? 'packages/design_system/lib/src/l10n/chassis_en.arb' : `apps/${app}/lib/l10n/app_en.arb`;
    const arb = load(rel, JSON.parse);
    return arb && typeof arb[key] === 'string' ? { on: true } : { on: false, why: `${rel} has no key ${key}` };
  }
  if (kind === 'ext') {
    const i = what.indexOf(':');
    const dir = what.slice(0, i);
    const key = what.slice(i + 1);
    const rel = `extensions/Extension/${dir}/_locales/en/messages.json`;
    const msgs = load(rel, JSON.parse);
    return msgs && msgs[key] ? { on: true } : { on: false, why: `${rel} has no message ${key}` };
  }
  if (kind === 'site') {
    // ⏱ 2026-10-03 · lane status-page: another deploy root serves a page (sites/<dir>/index.html).
    const rel = `sites/${what.replace(/[^a-z0-9-]/g, '')}/index.html`;
    return load(rel, (t) => t) === null ? { on: false, why: `${rel} does not exist` } : { on: true };
  }
  if (kind === 'page') {
    const [p, id] = what.split('#');
    const clean = p.replace(/^\/+|\/+$/g, '');
    const candidates = [`${clean}.html`, `${clean}/index.html`].map((c) => `sites/nikatru/${c}`);
    const html = candidates.map((c) => load(c, (t) => t)).find((t) => typeof t === 'string');
    if (typeof html !== 'string') return { on: false, why: `sites/nikatru serves no page at ${p}` };
    if (id && !new RegExp(`\\bid="${id.replace(/[^a-z0-9-]/gi, '')}"`).test(html)) return { on: false, why: `${p} has no id="${id}"` };
    return { on: true };
  }
  return { on: false, why: `gate kind ${JSON.stringify(kind)} is not config, dod, l10n, ext, page or site` };
}

/** Inline Markdown: **bold**, [text](url). Links to nikatru.com or a site path only. */
function inline(text, problems, where) {
  let out = '';
  let rest = text;
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/;
  for (;;) {
    const m = re.exec(rest);
    if (!m) {
      out += esc(rest);
      break;
    }
    out += esc(rest.slice(0, m.index));
    if (m[1] !== undefined) out += `<b>${esc(m[1])}</b>`;
    else {
      const url = m[3];
      if (!(url.startsWith('/') || /^https:\/\/(?:[a-z0-9-]+\.)?nikatru\.com(?:\/|$)/.test(url))) problems.push(`${where}: a link off nikatru.com (${url})`);
      const own = URL.canParse(url) ? new URL(url) : null; // a relative or malformed link is kept as written
      out += `<a href="${esc(own?.origin === ORIGIN ? `${own.pathname}${own.search}${own.hash}` : url)}">${esc(m[2])}</a>`;
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

/** The body as { html, text }: paragraphs and `- ` lists only. */
export function renderBody(body, problems = [], where = 'body') {
  const html = [];
  const text = [];
  for (const block of body.trim().split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/);
    if (lines.every((l) => /^- /.test(l))) {
      html.push(`<ul>${lines.map((l) => `<li>${inline(l.slice(2), problems, where)}</li>`).join('')}</ul>`);
      text.push(lines.map((l) => `• ${l.slice(2).replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')}`).join('\n'));
    } else if (lines.some((l) => /^(#|>|```|\d+\.\s|\|)/.test(l))) {
      problems.push(`${where}: a construct outside the subset (headings, quotes, code, numbered lists, tables are refused)`);
    } else {
      const joined = lines.join(' ');
      html.push(`<p>${inline(joined, problems, where)}</p>`);
      text.push(joined.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
    }
  }
  return { html: html.join('\n'), text: text.join('\n\n') };
}

function readRegister(root) {
  const reg = readJson(root, 'tooling/i18n/locales.json');
  const codes = reg.locales.filter((l) => l.status === 'supported').map((l) => l.code);
  return { source: reg.sourceLocale, codes };
}

const dirs = (p) => readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

/** Every article, every known issue, and every problem. */
export function collect(root) {
  const problems = [];
  const lost = [];
  let reg;
  try {
    reg = readRegister(root);
  } catch (e) {
    return { lost: [`tooling/i18n/locales.json could not be read (${e.code ?? e.message})`] };
  }
  const contentAbs = abs(root, CONTENT);
  if (!existsSync(contentAbs)) return { lost: [`${CONTENT}/ does not exist`] };
  const cache = new Map();
  const articles = [];
  for (const scope of dirs(contentAbs).filter((d) => !d.startsWith('_'))) {
    if (!Object.hasOwn(SCOPES, scope)) {
      problems.push(`${CONTENT}/${scope}/ is not a scope (build-index.mjs SCOPES)`);
      continue;
    }
    for (const locale of dirs(path.join(contentAbs, scope))) {
      if (!reg.codes.includes(locale)) {
        problems.push(`${CONTENT}/${scope}/${locale}/ is not a supported locale of tooling/i18n/locales.json`);
        continue;
      }
      for (const file of readdirSync(path.join(contentAbs, scope, locale)).filter((f) => f.endsWith('.md')).sort()) {
        const rel = `${CONTENT}/${scope}/${locale}/${file}`;
        const slug = file.slice(0, -3);
        if (!SLUG.test(slug)) problems.push(`${rel}: the slug is not lower-case-with-hyphens`);
        const parsed = parseArticle(readFileSync(abs(root, rel), 'utf8'));
        if (parsed.error) {
          problems.push(`${rel}: ${parsed.error}`);
          continue;
        }
        problems.push(...checkArticle(rel, parsed.fm, parsed.body));
        for (const g of Array.isArray(parsed.fm.gate) ? parsed.fm.gate : []) {
          const s = gateState(root, g, cache);
          if (!s.on) problems.push(`${rel}: gate ${g} is OFF (${s.why}) — an article describes only what has shipped`);
        }
        const { html, text } = renderBody(parsed.body, problems, rel);
        articles.push({ scope, locale, slug, id: `${scope}/${slug}`, rel, fm: parsed.fm, html, text });
      }
    }
  }
  if (articles.length === 0) lost.push(`no article under ${CONTENT}/`);
  const known = [];
  const kdir = abs(root, KNOWN);
  if (existsSync(kdir)) {
    for (const f of readdirSync(kdir).filter((x) => x.endsWith('.md') && x !== 'README.md').sort()) {
      const p = knownIssueFrontMatter(readFileSync(path.join(kdir, f), 'utf8'));
      if (!p) continue; // assert-known-issues.mjs refuses it; the index carries only what it accepts
      known.push({
        slug: f.slice(0, -3),
        title: p.fm.title,
        apps: p.fm.apps,
        versions: p.fm.versions,
        status: p.fm.status,
        ...(p.fm.fixedIn ? { fixedIn: p.fm.fixedIn } : {}),
        text: renderBody(p.body, problems, `${KNOWN}/${f}`).text,
      });
    }
  }
  return { reg, articles, known, problems, lost };
}

/** The articles a locale is served: its own, else the source locale's. */
export function articlesFor(articles, locale, source) {
  const own = new Map(articles.filter((a) => a.locale === locale).map((a) => [a.id, a]));
  for (const a of articles) if (a.locale === source && !own.has(a.id)) own.set(a.id, a);
  return [...own.values()].sort(byId);
}

/** A locale's synonym table, stemmed: { term: [terms] }, keys sorted. */
export function readSynonyms(root, locale, problems = []) {
  const rel = `${SYNONYM_DIR}/${locale}.json`;
  if (!existsSync(abs(root, rel))) return {};
  let doc;
  try {
    doc = readJson(root, rel);
  } catch (e) {
    problems.push(`${rel}: not JSON (${e.message})`);
    return {};
  }
  const out = {};
  for (const [word, list] of Object.entries(doc.synonyms ?? {})) {
    const [k] = tokenize(word);
    if (!k || !Array.isArray(list)) {
      problems.push(`${rel}: ${JSON.stringify(word)} is not a searchable word with a list`);
      continue;
    }
    const terms = [...new Set(list.flatMap((w) => tokenize(w)))].filter((t) => t !== k).sort();
    out[k] = [...new Set([...(out[k] ?? []), ...terms])].sort();
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

const urlOf = (a) => (a.scope === 'fullshot' ? `/help/fullshot/#${a.scope}-${a.slug}` : `/help/#${a.scope}-${a.slug}`);

/** One locale's index object over `list`. */
export function buildIndex(locale, list, known, synonyms = {}) {
  const docs = [];
  const postings = {};
  let total = 0;
  list.forEach((a, i) => {
    const { tf, len } = weightedTerms({ title: a.fm.title, asked: a.fm.asked, summary: a.fm.summary, body: a.text });
    docs.push({ id: a.id, scope: a.scope, slug: a.slug, title: a.fm.title, summary: a.fm.summary, url: urlOf(a), len, text: a.text });
    total += len;
    for (const [t, f] of [...tf.entries()].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) (postings[t] ??= []).push([i, f]);
  });
  const sorted = Object.fromEntries(Object.keys(postings).sort().map((k) => [k, postings[k]]));
  return { version: 1, locale, avgdl: docs.length ? total / docs.length : 0, docs, postings: sorted, synonyms, knownIssues: known };
}

/** The budget finding for one locale's serialised index, or null. */
export function indexBudgetProblem(locale, json, budget = INDEX_BUDGET_BYTES) {
  const bytes = Buffer.byteLength(json);
  return bytes > budget ? `the ${locale} index is ${bytes} bytes, over the ${budget} budget` : null;
}

function readEval(root, locale) {
  const rel = `${EVAL_DIR}/${locale}.json`;
  if (!existsSync(abs(root, rel))) return null;
  const doc = readJson(root, rel);
  return Array.isArray(doc.pairs) ? doc.pairs : null;
}

/** top-3 recall of `pairs` against `index`: { recall, hits, misses[], perArticle: Map<id,[hits,total]> }. */
export function recallAt3(index, pairs) {
  let hits = 0;
  const misses = [];
  const perArticle = new Map();
  for (const { query, expect } of pairs) {
    const top = search(index, query, { limit: 3 }).map((h) => h.id);
    const ok = top.includes(expect);
    const row = perArticle.get(expect) ?? [0, 0];
    row[1]++;
    if (ok) {
      hits++;
      row[0]++;
    } else misses.push({ query, expect, got: top });
    perArticle.set(expect, row);
  }
  return { recall: pairs.length ? hits / pairs.length : 0, hits, misses, perArticle };
}

/** The recall measure's problems for one locale. */
export function recallProblems(locale, index, pairs, articles) {
  const out = [];
  const rel = `${EVAL_DIR}/${locale}.json`;
  if (pairs.length < MIN_EVAL_PAIRS) out.push(`${rel} has ${pairs.length} pair(s); at least ${MIN_EVAL_PAIRS} are required`);
  const asked = new Set(articles.flatMap((a) => a.fm.asked ?? []).map((q) => q.trim().toLowerCase()));
  for (const p of pairs) {
    if (!index.docs.some((d) => d.id === p.expect)) out.push(`${rel} expects ${p.expect}, which is no article`);
    if (asked.has(String(p.query).trim().toLowerCase())) out.push(`${rel}: ${JSON.stringify(p.query)} is an article's own \`asked\` line — eval queries are users' words, not the answer key`);
  }
  const r = recallAt3(index, pairs);
  if (r.recall < RECALL_FLOOR) {
    out.push(`${locale}: recall@3 is ${r.recall.toFixed(3)}, under the ${RECALL_FLOOR} floor; misses: ${r.misses.map((m) => `${JSON.stringify(m.query)}→${m.expect}`).join('; ')}`);
  }
  for (const [id, [h, t]] of [...r.perArticle.entries()].sort()) {
    if (h / t < RECALL_FLOOR) out.push(`${locale}: ${id} is found in the top 3 for ${h} of its ${t} eval question(s), under the ${RECALL_FLOOR} floor`);
  }
  return { problems: out, recall: r };
}

const NAV = `<nav>
  <div class="nav-in">
    <a class="brand" href="/">
      <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="nm" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2E6FF2"/><stop offset="0.55" stop-color="#2AA0D8"/><stop offset="1" stop-color="#17C3A2"/></linearGradient></defs>
        <rect width="1024" height="1024" rx="244" fill="#111C33"/>
        <path d="M 292 720 L 292 304 L 656 720 L 656 304 M 580 380 L 656 304 L 732 380" fill="none" stroke="url(#nm)" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Nikatru</span>
    </a>
    <a class="back" href="/">&larr; Back to site</a>
  </div>
</nav>`;

const knownList = (known) =>
  known.length
    ? `<ul class="known">${known
        .map((k) => `<li><b>${esc(k.title)}</b> &mdash; ${esc(k.versions)}${k.status === 'fixed' ? ` &middot; fixed in ${esc(k.fixedIn)}` : ''}<br>${esc(k.text)}</li>`)
        .join('')}</ul>`
    : '<p class="known-none">No known issues.</p>';

/** One generated page: the shell, the site's chrome regions, and `main`. */
function shell({ title, description, canonical, main, script }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} &mdash; Nikatru</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#0B1220">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="manifest" href="/site.webmanifest">
<!-- GENERATED by tooling/help/build-index.mjs from content/help/ and content/known-issues/. Edit those; never this file. -->
<style>
  :root{
  /* CHROME:scale-css */
  /* /CHROME:scale-css */
  }
  /* CHROME:marks-css */
  /* /CHROME:marks-css */
  :root{--ink:#0B1220;--primary:#2563EB;--teal:#0F766E;--on-accent:#FFFFFF;--bg:#F6F8FC;--card:#FFFFFF;--text:#1E293B;--strong:#0B1220;--muted:#586275;--line:#E2E8F0;--soft:#F6F8FC}
  @media (prefers-color-scheme: dark){
    :root{--bg:#0B1220;--card:#111C33;--text:#C7D2E3;--strong:#F1F5F9;--muted:#93A1BC;--line:#22304D;--soft:#0E1830;--primary:#6E9BFF;--teal:#17C3A2;--on-accent:#0B1220}
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.7}
  nav{background:rgba(11,18,32,.96);position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(255,255,255,.06)}
  .nav-in{max-width:820px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:10px;text-decoration:none}
  .brand svg{width:30px;height:30px}
  .brand span{color:#fff;font-weight:800;letter-spacing:.14em;font-size:15px}
  a.back{color:#B6C2D9;text-decoration:none;font-size:14px}
  a.back:hover{color:#fff}
  main{background:var(--card);max-width:820px;margin:32px auto;padding:44px 48px;border:1px solid var(--line);border-radius:16px}
  h1{font-size:32px;color:var(--strong);letter-spacing:-.01em}
  .lead{color:var(--muted);margin:8px 0 22px}
  h2{font-size:21px;color:var(--strong);margin:30px 0 8px}
  h3{font-size:17px;color:var(--strong);margin:18px 0 4px}
  .summary{color:var(--muted)}
  p,li{font-size:15.5px;margin-bottom:11px}
  ul{margin:0 0 12px 22px}
  a{color:var(--primary)}
  .help-search{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 8px}
  .help-search label{font-weight:600;color:var(--strong)}
  .help-search input{flex:1 1 220px;min-height:44px;padding:8px 12px;font:inherit;color:var(--text);background:var(--soft);border:1px solid var(--line);border-radius:10px}
  .help-count{color:var(--muted);font-size:14px;min-height:1.7em}
  .help-article[hidden],.help-scope[hidden]{display:none}
  .ask{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:28px 0 0}
  .ask-inline{font-size:14.5px}
  a.button{display:inline-block;margin-top:6px;padding:10px 18px;min-height:44px;border-radius:10px;background:var(--primary);color:var(--on-accent);text-decoration:none;font-weight:600}
  /* CHROME:a11y-css */
  /* /CHROME:a11y-css */
  /* CHROME:footer-css */
  /* /CHROME:footer-css */
  @media(max-width:640px){main{padding:28px 22px;margin:16px}}
</style>
</head>
<body>
<!-- CHROME:skiplink -->
<!-- /CHROME:skiplink -->
${NAV}

${main}

<!-- CHROME:footer -->
<!-- /CHROME:footer -->
${script ? '<script type="module" src="/js/help.js"></script>\n' : ''}</body>
</html>
`;
}

const ASK_HREF = '/support?category=question#report-a-problem';

function helpMain({ title, lead, articles, known, scopeNames, searchScopes }) {
  const sections = Object.keys(scopeNames)
    .map((scope) => {
      const mine = articles.filter((a) => a.scope === scope);
      if (!mine.length) return '';
      return `  <section class="help-scope" aria-labelledby="scope-${scope}">
    <h2 id="scope-${scope}">${esc(scopeNames[scope])}</h2>
${mine
  .map(
    (a) => `    <article class="help-article" id="${a.scope}-${a.slug}" data-id="${esc(a.id)}">
      <h3>${esc(a.fm.title)}</h3>
      <p class="summary">${esc(a.fm.summary)}</p>
${a.html.split('\n').map((l) => `      ${l}`).join('\n')}
      <p class="ask-inline">Still stuck? <a class="ask-link" href="${ASK_HREF}">Ask us</a></p>
    </article>`,
  )
  .join('\n')}
  </section>`;
    })
    .filter(Boolean)
    .join('\n');
  return `<main id="main">
  <h1>${esc(title)}</h1>
  <p class="lead">${lead}</p>
  <form class="help-search" role="search" action="#" data-scopes="${esc(searchScopes.join(','))}">
    <label for="help-q">Search help</label>
    <input id="help-q" name="q" type="search" autocomplete="off">
  </form>
  <p class="help-count" id="help-count" aria-live="polite"></p>
${sections}
  <section aria-labelledby="known-issues">
    <h2 id="known-issues">Known issues</h2>
    ${knownList(known)}
    <p><a href="/help/known-issues">Every known issue</a> &middot; <a href="/accessibility">Accessibility statement</a></p>
  </section>
  <div class="ask">
    <p><b>Still stuck?</b> Ask us, and we reply within 2 business days.</p>
    <a class="button" id="help-ask" href="${ASK_HREF}">Ask us</a>
  </div>
</main>`;
}

/** A JS module exporting `value` as its default. */
const jsModule = (why, value) => `// GENERATED by tooling/help/build-index.mjs — ${why}. Never edit; run the generator.\nexport default ${JSON.stringify(value)};\n`;

/** The Dart table: every locale's index JSON, as a raw string per locale. */
function dartIndex(source, perLocale) {
  const rows = Object.keys(perLocale)
    .sort()
    .map((code) => {
      const json = perLocale[code];
      if (json.includes("'''")) throw new Error(`the ${code} index contains ''' and cannot be a Dart raw string`);
      const one = `  '${code}': r'''${json}''',`;
      // dart format (ci.yml's apps/ format gate) moves a value past 80 columns
      // onto its own line, indented four more than the key.
      return one.length <= 80 ? one : `  '${code}':\n      r'''${json}''',`;
    })
    .join('\n');
  return `// GENERATED by \`node tooling/help/build-index.mjs\` from content/help/ and
// content/known-issues/: this app's articles and the platform's, per locale.
// NEVER HAND-EDIT: \`--check\` (in tooling/sites/regen.mjs ORDER, run by ci.yml's
// sites job) fails CI when this file is stale.

/// The locale the articles are written in; any other falls back to it.
const String kHelpSourceLocale = '${source}';

/// Each locale's help index, as the JSON tooling/help/build-index.mjs writes.
const Map<String, String> kHelpIndexJson = <String, String>{
${rows}
};
`;
}

/** Every output path and its wanted bytes, or { problems, lost }. */
export function plan(root) {
  const c = collect(root);
  if (c.lost?.length) return { files: new Map(), problems: c.problems ?? [], lost: c.lost, notes: [] };
  const files = new Map();
  const problems = [...c.problems];
  const notes = [];
  const indexes = {};
  for (const locale of c.reg.codes) {
    const own = c.articles.filter((a) => a.locale === locale);
    if (locale !== c.reg.source && own.length === 0) {
      notes.push(`${locale}: no article of its own — the apps serve the ${c.reg.source} index and say so (pending translation)`);
      continue;
    }
    const list = articlesFor(c.articles, locale, c.reg.source);
    const index = buildIndex(locale, list, c.known, readSynonyms(root, locale, problems));
    indexes[locale] = index;
    const json = JSON.stringify(index);
    const over = indexBudgetProblem(locale, json);
    if (over) problems.push(over);
    files.set(`${SITE_DIR}/index.${locale}.json`, `${json}\n`);
    const pairs = readEval(root, locale);
    if (pairs === null) problems.push(`${EVAL_DIR}/${locale}.json is missing: a locale with articles of its own carries its eval set`);
    else {
      const r = recallProblems(locale, index, pairs, own);
      problems.push(...r.problems);
      notes.push(`${locale}: recall@3 ${r.recall.recall.toFixed(3)} (${r.recall.hits}/${pairs.length}) over ${index.docs.length} article(s); ${Buffer.byteLength(json)} bytes`);
    }
  }
  const source = indexes[c.reg.source];
  if (!source) return { files, problems, lost: [`no ${c.reg.source} article — the source locale has nothing to fall back to`], notes };
  // One Dart table per app: its own articles and the platform's, per locale.
  const appIds = existsSync(abs(root, 'apps')) ? dirs(abs(root, 'apps')).filter((id) => existsSync(abs(root, `apps/${id}/pubspec.yaml`))) : [];
  const dartFor = (scopes) => {
    const perLocale = {};
    for (const locale of Object.keys(indexes)) {
      const list = articlesFor(c.articles, locale, c.reg.source).filter((a) => scopes.includes(a.scope));
      perLocale[locale] = JSON.stringify(buildIndex(locale, list, c.known.filter((k) => k.apps.some((x) => scopes.includes(x))), indexes[locale].synonyms));
    }
    return dartIndex(c.reg.source, perLocale);
  };
  try {
    for (const id of appIds) files.set(`apps/${id}/${DART_INDEX_REL}`, dartFor([id, 'platform']));
    files.set(`${BRICK_APP}/${DART_INDEX_REL}`, dartFor(['platform']));
  } catch (e) {
    problems.push(e.message);
  }
  const searchSrc = readFileSync(path.join(HERE, 'search.mjs'), 'utf8');
  files.set(SEARCH_SERVED, searchSrc);
  const sourceArticles = articlesFor(c.articles, c.reg.source, c.reg.source);
  for (const b of EXTENSION_BUNDLES) {
    const list = sourceArticles.filter((a) => b.scopes.includes(a.scope));
    const index = buildIndex(c.reg.source, list, c.known.filter((k) => k.apps.some((x) => b.scopes.includes(x))), source.synonyms);
    files.set(`${b.dir}/help-search.js`, searchSrc);
    files.set(`${b.dir}/help-index.js`, jsModule(`the options-page Help panel's index (scopes: ${b.scopes.join(', ')})`, index));
  }
  const pairs = readEval(root, c.reg.source) ?? [];
  files.set(
    CONFORMANCE,
    `${JSON.stringify(
      {
        _why: 'GENERATED by tooling/help/build-index.mjs: the JavaScript search (tooling/help/search.mjs) ranking of every eval query over the source-locale index. packages/help/test/search_test.dart reproduces every id, in order, and every score within 1e-9.',
        locale: c.reg.source,
        cases: pairs.map(({ query }) => ({ query, hits: search(source, query, { limit: 5 }).map((h) => ({ id: h.id, score: h.score })) })),
        // Every file the indexes were built from, by path: the help corpus is
        // found by a directory walk, so this is the one place that names each
        // file (assert-no-dead-files reaches them through it).
        sources: [
          ...c.articles.map((a) => a.rel),
          ...c.reg.codes.map((code) => `${SYNONYM_DIR}/${code}.json`).filter((rel) => existsSync(abs(root, rel))),
        ].sort(),
      },
      null,
      2,
    )}\n`,
  );
  files.set(
    `${SITE_DIR}/index.html`,
    applyChrome(
      shell({
        title: 'Help centre',
        description: 'Answers for Nikatru Subscription Tracker, FullShot and your Nikatru account, with known issues and a way to ask us.',
        canonical: `${ORIGIN}/help/`,
        script: true,
        main: helpMain({
          title: 'Help centre',
          lead: 'Answers for every Nikatru app and your account. Search, or read on.',
          articles: sourceArticles,
          known: c.known,
          scopeNames: SCOPES,
          searchScopes: Object.keys(SCOPES),
        }),
      }),
    ),
  );
  files.set(
    `${SITE_DIR}/fullshot/index.html`,
    applyChrome(
      shell({
        title: 'FullShot help',
        description: 'Answers for FullShot, the full page screen capture extension, with known issues and a way to ask us.',
        canonical: `${ORIGIN}/help/fullshot/`,
        script: true,
        main: helpMain({
          title: 'FullShot help',
          lead: 'Answers for FullShot, the full page screen capture extension. Search, or read on.',
          articles: sourceArticles.filter((a) => a.scope === 'fullshot'),
          known: c.known.filter((k) => k.apps.includes('fullshot')),
          scopeNames: { fullshot: SCOPES.fullshot },
          searchScopes: ['fullshot'],
        }),
      }),
    ),
  );
  files.set(
    `${SITE_DIR}/known-issues.html`,
    applyChrome(
      shell({
        title: 'Known issues',
        description: 'Problems we know about in Nikatru apps and extensions, the versions they affect, and what to do meanwhile.',
        canonical: `${ORIGIN}/help/known-issues`,
        script: false,
        main: `<main id="main">
  <h1>Known issues</h1>
  <p class="lead">Problems we know about, the versions they affect, and what to do meanwhile.</p>
  ${knownList(c.known)}
  <p><a href="/help/">Help centre</a> &middot; <a href="${ASK_HREF}">Ask us</a></p>
</main>`,
      }),
    ),
  );
  return { files, problems, lost: [], notes };
}

export function main(argv, log = console.log) {
  const check = argv.includes('--check');
  const rootArg = argv.find((a) => !a.startsWith('--'));
  const root = rootArg ? path.resolve(rootArg) : path.resolve(HERE, '..', '..');
  const p = plan(root);
  for (const n of p.notes) log(`  ${n}`);
  if (p.lost.length) {
    for (const l of p.lost) log(`build-index: COVERAGE LOST — ${l}`);
    return 2;
  }
  if (p.problems.length) {
    for (const x of p.problems) log(`✗ ${x}`);
    log(`build-index: ${p.problems.length} problem(s); nothing ${check ? 'compared' : 'written'}`);
    return 1;
  }
  const stale = [];
  for (const [rel, want] of p.files) {
    const file = abs(root, rel);
    let have = null;
    try {
      have = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (have === want) continue;
    if (check) stale.push(rel);
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, want);
    }
  }
  if (check && stale.length) {
    for (const s of stale) log(`✗ stale ${s} — run node tooling/help/build-index.mjs`);
    return 1;
  }
  log(`build-index: ${check ? 'current' : 'written'} — ${p.files.size} output(s)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
