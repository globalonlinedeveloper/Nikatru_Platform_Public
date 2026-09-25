/* render-listing.mjs — a tool's store listing copy, rendered from ONE file.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node scripts/render-listing.mjs fullshot            write the listing files
     node scripts/render-listing.mjs fullshot --check    compare, write nothing
     node scripts/render-listing.mjs --all [--check]

   ⏱ 2026-09-25 (EXT-4, O-EXTENSION-LISTING-COPY-HAND-KEPT). FullShot's three
   long descriptions were three hand-typed files that differed in one line (the
   shortcuts page each browser has), and the copy they shared had to be edited
   three times, plus once more in publish/STORE-LISTING.md, to change a word.
   `store/listing.json` is now the source, and every `store/<store>/*.txt` the
   stores receive is rendered from it: title, short and long description,
   category, and Edge's search terms, AMO's tags and AMO's reviewer notes.
   `store/_shared/` is not rendered here (URLs and screenshots have their own
   limbs in check-store-metadata.mjs). The permission justifications in
   publish/STORE-LISTING.md (§4, between its GENERATED markers) are rendered
   from tool.json policy.permissions and policy.optionalHostPermissions.

   THE PRO TEXT RENDERS ONLY BEHIND A FACT. A listing line marked `"when": "pro"`
   renders only when the tool TRANSMITS (tool.json policy.networkAllowlist is
   non-empty) or SELLS (services/platform/src/app-config-data.json holds a
   recurring offering for its id); a line marked `"when": "sells"` renders only
   when it SELLS; a line marked `"when": "free"` renders only when it does
   neither. The seller is read from LICENSE's Required Notice (lib/licence.mjs),
   and the price range from the RECURRING offerings only — a `one_time` offering
   is never read (ADR 093) — as one range per currency, joined with "; ". The
   range goes to the Edge listing only (ADR 069); the Chrome and Firefox
   listings carry the seller line. A tool that sells with an empty allowlist is
   a finding (the account check is a network call), and a tool that transmits
   or sells with no readable seller cannot render at all (exit 2).

   check-store-metadata.mjs imports planListing() and fails a listing file that
   is not what this renders — a hand edit to a .txt is caught there as well as
   by --check here.

   Exit codes: 0 fresh (or written) · 1 drift or a finding · 2 could not run. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Report, parseArgs, die } from './lib/report.mjs';
import { repoRoot, resolveTool, loadAllTools, readText } from './lib/toolinfo.mjs';
import { requiredNotice } from './lib/licence.mjs';
import { transmits, recurringOfferings } from '../../contracts/legal/pro-gate.mjs';

/** The file's text, or null if it is not there. One read answers both questions, so nothing can change
 *  between a check and a use. Anything else still throws: a permissions error is not "absent". */
function readTextOrNull(abs) {
  try {
    return readText(abs);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export const LISTING_REL = 'store/listing.json';
/* Resolved from the extensions root, which is what repoRoot() returns. */
export const APP_CONFIG_REL = '../services/platform/src/app-config-data.json';
const RECURRING = new Set(['month', 'year']);

/* transmits() and recurringOfferings() have ONE definition, in
   contracts/legal/pro-gate.mjs, because the privacy page opens its Pro text on
   the same two facts (EXT-4, Q2). */
export { transmits, recurringOfferings };

/** "Copyright A B, trading as C (https://x)" -> "A B, trading as C". */
export function sellerName(licenceText) {
  const n = requiredNotice(licenceText);
  if (!n.ok) return { ok: false, why: n.why };
  const name = n.line.replace(/^Required Notice:\s*/, '').replace(/^Copyright\s+(?:\(c\)\s*|©\s*)?/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '').trim();
  return name ? { ok: true, name } : { ok: false, why: 'its Required Notice names no licensor: ' + JSON.stringify(n.line) };
}

const TERM_WORD = { month: 'a month', year: 'a year' };
/** "INR 499.00 a month to INR 3499.00 a year; USD 5.99 a month to USD 34.99 a year"
 *  — recurring only, one range per currency (currencies in code order), each
 *  cheapest to dearest. Amounts in two currencies are never compared. */
export function priceRange(offerings) {
  const fmt = (o) => o.currency_code + ' ' + (o.amount_minor / 100).toFixed(2) + ' ' + TERM_WORD[o.term];
  const byCurrency = new Map();
  for (const o of offerings) {
    if (!RECURRING.has(o.term) || !Number.isInteger(o.amount_minor) || typeof o.currency_code !== 'string') continue;
    if (!byCurrency.has(o.currency_code)) byCurrency.set(o.currency_code, []);
    byCurrency.get(o.currency_code).push(o);
  }
  if (!byCurrency.size) return null;
  return [...byCurrency.keys()].sort().map((c) => {
    const sorted = byCurrency.get(c).sort((a, b) => a.amount_minor - b.amount_minor);
    return sorted.length === 1 ? fmt(sorted[0]) : fmt(sorted[0]) + ' to ' + fmt(sorted[sorted.length - 1]);
  }).join('; ');
}

const lines = (v) => (Array.isArray(v) ? v : [v]);

/**
 * Plan every listing file for one tool. Never writes.
 * @returns {{ files: Map<string,string>, problems: string[], lost: string[], pro: boolean, source: boolean }}
 *   `files` maps a tool-relative path to its full content.
 */
export function planListing(root, tool, { appConfigPath } = {}) {
  const files = new Map();
  const problems = [];
  const lost = [];
  const abs = path.join(tool.dirAbs, LISTING_REL);
  if (!fs.existsSync(abs)) return { files, problems, lost, pro: false, source: false };
  let src;
  try { src = JSON.parse(readText(abs)); } catch (e) {
    lost.push(tool.rel + '/' + LISTING_REL + ' is not valid JSON (' + e.message + '), so no listing file can be rendered from it.');
    return { files, problems, lost, pro: false, source: true };
  }
  const raw = tool.raw ?? tool;
  const rows = raw?.storeMetadata?.stores ?? {};

  /* ── the Pro facts ── */
  const doesTransmit = transmits(raw);
  const cfgAbs = path.resolve(appConfigPath || path.join(root, APP_CONFIG_REL));
  const wantsPro = /"(?:pro|sells)"/.test(JSON.stringify(src));
  let offers = [];
  if (fs.existsSync(cfgAbs)) {
    try { offers = recurringOfferings(JSON.parse(fs.readFileSync(cfgAbs, 'utf8')), raw.id); } catch (e) {
      lost.push(cfgAbs + ' is not valid JSON (' + e.message + '), so whether ' + raw.id + ' sells cannot be decided.');
    }
  } else if (wantsPro) {
    lost.push(tool.rel + '/' + LISTING_REL + ' carries Pro lines and ' + cfgAbs + ' does not exist, so whether ' +
      raw.id + ' sells — and whether those lines render — cannot be decided.');
  }
  const sells = offers.length > 0;
  const pro = doesTransmit || sells;
  const vars = { seller: null, priceRange: priceRange(offers) };
  if (sells && !doesTransmit) {
    problems.push(tool.rel + ': app-config-data holds ' + offers.length + ' recurring offering(s) for "' + raw.id +
      '", but tool.json policy.networkAllowlist is empty. Selling Pro needs the account check, which is a network call; ' +
      'the allowlist and the offerings describe two different tools.');
  }
  if (pro) {
    const licAbs = path.join(tool.dirAbs, 'LICENSE');
    const s = fs.existsSync(licAbs) ? sellerName(readText(licAbs)) : { ok: false, why: 'LICENSE does not exist' };
    if (s.ok) vars.seller = s.name;
    else lost.push(tool.rel + ': the Pro text names its seller from LICENSE, and ' + s.why);
  }
  if (lost.length) return { files, problems, lost, pro, sells, source: true };

  const when = (l) => (typeof l === 'string' ? true
    : l.when === 'pro' ? pro : l.when === 'sells' ? sells : l.when === 'free' ? !pro : true);
  const text = (l) => (typeof l === 'string' ? l : String(l.text ?? ''));
  const fill = (t, store) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = k in vars ? vars[k] : store[k];
    if (v === null || v === undefined) {
      problems.push(tool.rel + '/' + LISTING_REL + ': "' + t.slice(0, 60) + '" uses {{' + k + '}}, which has no value here.');
      return m;
    }
    return String(v);
  });
  const block = (arr, store) => arr.filter(when)
    .filter((l) => typeof l === 'string' || !l.stores || l.stores.includes(store.id))
    .filter((l) => typeof l === 'string' || !l.requires || (vars[l.requires] !== null && vars[l.requires] !== undefined))
    .map((l) => fill(text(l), store)).join('\n') + '\n';

  for (const [id, row] of Object.entries(rows)) {
    if (!row || typeof row.dir !== 'string') continue;
    if (!fs.existsSync(path.join(tool.dirAbs, row.dir))) continue;
    const st = src.stores?.[id];
    if (!st || typeof st !== 'object') {
      lost.push(tool.rel + '/' + row.dir + ' is a listing tree and ' + LISTING_REL + ' has no stores.' + id +
        ', so nothing renders that store\'s copy — it would be graded as hand-kept text nobody can diff.');
      continue;
    }
    const store = { id, ...st };
    const put = (f, body) => files.set(row.dir + '/' + f, body);
    put('title.txt', fill(String(src.title), store) + '\n');
    put('short-description.txt', block(lines(src.short), store));
    put('long-description.txt', block(lines(src.long), store));
    put('category.txt', lines(st.category).join('\n') + '\n');
    if (st.searchTerms) put('search-terms.txt', lines(st.searchTerms).join('\n') + '\n');
    if (st.tags) put('tags.txt', lines(st.tags).join('\n') + '\n');
    if (st.reviewerNotes) put('reviewer-notes.txt', block(lines(st.reviewerNotes), store));
  }

  /* §4 of publish/STORE-LISTING.md — the dashboard's permission justifications —
     rendered from tool.json policy.permissions and policy.optionalHostPermissions
     between the GENERATED markers, in the tool.json order. policy-check grades
     that every manifest permission HAS a justification there; this is what makes
     the text the dashboard receives the same text. */
  const docRel = 'publish/STORE-LISTING.md';
  const docAbs = path.join(tool.dirAbs, docRel);
  if (fs.existsSync(docAbs)) {
    const md = readText(docAbs);
    const a = md.indexOf(JUSTIFICATIONS_OPEN);
    if (a >= 0) {
      const openEnd = md.indexOf('-->', a) + 3;
      const b = md.indexOf(JUSTIFICATIONS_CLOSE, openEnd);
      if (b < 0) {
        problems.push(tool.rel + '/' + docRel + ': carries the opening permission-justifications marker and not the closing one.');
      } else {
        const perms = Object.entries(raw?.policy?.permissions ?? {});
        const hosts = Object.entries(raw?.policy?.optionalHostPermissions ?? {});
        const one = (head, why) => '**' + head + '**\n```\n' + why + '\n```\n\n';
        const body = '\n\n' + perms.map(([k, v]) => one(k, v)).join('') +
          hosts.map(([k, v]) => one('Host permission — ' + k + ' (declared as OPTIONAL, requested at runtime)', v)).join('');
        files.set(docRel, md.slice(0, openEnd) + body + md.slice(b));
      }
    }
  }
  return { files, problems, lost, pro, sells, source: true, vars };
}

const JUSTIFICATIONS_OPEN = '<!-- GENERATED:permission-justifications';
const JUSTIFICATIONS_CLOSE = '<!-- /GENERATED:permission-justifications -->';

/* ---------------- CLI ---------------- */
function main() {
  const BOOLEAN_FLAGS = ['all', 'check'];
  const args = parseArgs(process.argv.slice(2)
    .map((a) => (a.startsWith('--') && BOOLEAN_FLAGS.includes(a.slice(2)) ? a + '=true' : a)));
  args.rejectUnknown(['all', 'check', 'repo-root', 'app-config']);
  const root = repoRoot(args);
  const check = args.bool('check');
  let tools;
  if (args.bool('all')) {
    const all = loadAllTools(root);
    if (all.errors.length) die('tool.json problems:\n' + all.errors.map((e) => '  - ' + e).join('\n'));
    tools = all.tools;
  } else {
    tools = [resolveTool(root, args.positional[0])];
  }
  const r = new Report('render-listing · ' + tools.map((t) => t.id).join(', ') + (check ? ' (--check)' : ''));
  let rendered = 0;
  for (const tool of tools) {
    const plan = planListing(root, tool, { appConfigPath: args.get('app-config') });
    if (plan.lost.length) die(plan.lost.join('\n'));
    for (const p of plan.problems) r.fail(tool.rel + ' listing renders', p);
    if (!plan.source) { r.note(tool.rel + ': no ' + LISTING_REL + ' — nothing to render.'); continue; }
    for (const [rel, body] of plan.files) {
      rendered++;
      const abs = path.join(tool.dirAbs, rel);
      const cur = readTextOrNull(abs);
      if (cur === body) { r.pass(tool.rel + '/' + rel, 'fresh'); continue; }
      if (check) {
        r.fail(tool.rel + '/' + rel + ' is what ' + LISTING_REL + ' renders',
          (cur === null ? 'the file is absent' : 'the file differs from the rendering') + '.\n' +
          'The listing copy has one home, ' + tool.rel + '/' + LISTING_REL + '. Edit it there, then run\n' +
          '  node scripts/render-listing.mjs ' + tool.id);
      } else {
        fs.writeFileSync(abs, body);
        r.pass(tool.rel + '/' + rel, 'written');
      }
    }
    r.note(tool.rel + ': Pro text ' + (plan.pro
      ? 'RENDERS (the tool transmits or sells) · sells: ' + (plan.sells ? 'yes' : 'no — the "sells" lines stay dark') +
        ' · seller: ' + plan.vars.seller + ' · price range: ' + (plan.vars.priceRange ?? 'none (no recurring offering)')
      : 'does not render (the tool neither transmits nor sells)'));
  }
  if (!rendered && !r.fails.length) die('no listing file was rendered across ' + tools.length + ' tool(s); a pass here would mean nothing.');
  process.exit(r.finish());
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
