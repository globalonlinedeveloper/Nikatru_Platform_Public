// ─────────────────────────────────────────────────────────────────────────────
// facts.mjs — the ONE loader and renderer of the entity source.
//
// THE SOURCE is tooling/house-identity.json (`entity`, `people`, `supportEmail`).
// Every business fact a surface prints is rendered from it here, in one of three
// shapes declared in tooling/entity/surfaces.json:
//
//   1. A FACT REGION — `<!-- FACT:<name> -->…<!-- /FACT:<name> -->` in an HTML or
//      Markdown file. The body is the rendering of `facts.<name>.template`. The
//      markers are comments, so a page's visible text is exactly the rendering.
//   2. AN ANCHORED FIELD — `anchored[]`: a file, a regex with a named group `v`,
//      the exact number of matches, and a template. For places a comment cannot
//      sit: an HTML attribute, JSON-LD, a JSON value, a plain-text licence line.
//   3. A GENERATED FILE — `files[]`: the whole file is the rendering.
//
// The site footer is the fourth reader: tooling/sites/chrome.mjs renders it from
// `entityContext()` below, and the Worker module is the fifth
// (tooling/ports/render-entity.mjs).
//
// `node tooling/entity/render.mjs` writes all of them; tooling/scripts/
// assert-business-facts.mjs checks that each is what the source renders and that
// no guarded value is typed anywhere else.
//
// A template names context paths as `{{path}}`. A path the source leaves null is
// a REFUSAL naming the template, never an empty string: a page that loses a
// clause silently is the failure this file exists to prevent. That is also how a
// future entity form announces the sentences it has no wording for yet.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENTITY_SOURCE = 'tooling/house-identity.json';
export const SURFACES = 'tooling/entity/surfaces.json';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const val = (leaf) => (isObj(leaf) ? leaf.value ?? null : leaf ?? null);

export function readJson(root, rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'));
}

/** The build year, for the copyright range. ENTITY_BUILD_YEAR pins it (tests, reproducible builds). */
export function buildYear() {
  const pinned = process.env.ENTITY_BUILD_YEAR;
  if (pinned && /^\d{4}$/.test(pinned)) return Number(pinned);
  return new Date().getUTCFullYear();
}

/** `2026` while the build year is the first year, `2026–2027` after. */
export function copyrightYears(first, year = buildYear()) {
  if (!Number.isInteger(first)) return null;
  return year > first ? `${first}–${year}` : String(first);
}

/** The phone as a `tel:` target and as printed: `+CC NNNNN NNNNN` for a ten-digit number. */
export function phoneForms(cc, digits) {
  if (typeof cc !== 'string' || typeof digits !== 'string' || !/^\d+$/.test(digits)) return { href: null, display: null };
  const display = digits.length === 10 ? `${cc} ${digits.slice(0, 5)} ${digits.slice(5)}` : `${cc} ${digits}`;
  return { href: `${cc}${digits}`, display };
}

/** The render context: every value a template may name, read from the source document. */
export function entityContext(doc, { year = buildYear() } = {}) {
  const e = doc?.entity ?? {};
  const o = e.registeredOffice ?? {};
  const w = e.form?.wording ?? {};
  const founder = doc?.people?.founder ?? {};
  const store = {};
  for (const [k, v] of Object.entries(e.storeAccounts ?? {})) if (!k.startsWith('_')) store[k] = v?.type ?? null;
  const g = e.contacts?.grievanceOfficer ?? {};
  return {
    legalName: val(e.legalName),
    tradeName: val(e.tradeName),
    form: { value: e.form?.value ?? null, label: e.form?.label ?? null, noun: w.noun ?? null, longNoun: w.longNoun ?? null, roleNoun: w.roleNoun ?? null, roleTitle: w.roleTitle ?? null },
    udyam: val(e.registrations?.udyam),
    cin: val(e.registrations?.cin),
    office: Object.fromEntries(['floor', 'building', 'street', 'area', 'locality', 'city', 'state', 'postalCode', 'country'].map((k) => [k, val(o[k])])),
    phone: phoneForms(e.phone?.countryCode, e.phone?.value),
    founder: { name: val(founder.name), url: val(founder.url) },
    grievance: { name: g.nameFrom === 'people.founder.name' ? val(founder.name) : val(g.name), title: g.title ?? null },
    jurisdiction: { law: val(e.jurisdiction?.law), courts: val(e.jurisdiction?.courts) },
    copyright: { holder: val(e.copyright?.holder), years: copyrightYears(val(e.copyright?.firstYear), year) },
    established: val(e.established),
    storeSellerName: val(e.storeSellerName),
    storeAccounts: store,
    supportEmail: val(doc?.supportEmail),
  };
}

/** The context for the source under `root` (the repository, by default). */
export function loadContext(root = REPO_ROOT, opts) {
  return entityContext(readJson(root, ENTITY_SOURCE), opts);
}

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escJson = (s) => JSON.stringify(s).slice(1, -1);
export const ESCAPES = { html: escHtml, json: escJson, none: (s) => s };

/** The escape a FACT region in `file` takes: HTML for .html, none for Markdown. */
export const regionEscape = (file) => (/\.html?$/i.test(file) ? 'html' : 'none');

/**
 * Render `template` against `ctx`. Every `{{path}}` must resolve to a string or a
 * number; anything else throws, naming `where` and the path.
 */
export function renderTemplate(template, ctx, { escape = 'none', where = 'a template' } = {}) {
  const esc = ESCAPES[escape];
  if (!esc) throw new Error(`${where}: unknown escape "${escape}"`);
  const text = Array.isArray(template) ? template.join('\n') : template;
  if (typeof text !== 'string') throw new Error(`${where}: the template is not a string`);
  return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9.]*)\s*\}\}/g, (_, path) => {
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);
    if (typeof v === 'number') return String(v);
    if (typeof v !== 'string' || !v) {
      throw new Error(`${where}: {{${path}}} has no value in the entity source (${ENTITY_SOURCE}). Record it there, or re-word the template in ${SURFACES}.`);
    }
    return esc(v);
  });
}

/**
 * The template an entry renders under the source's form: `template`, or
 * `byForm[<form>]`. A form with no wording throws, naming the entry, so a form
 * change lists the sentences it has not re-worded instead of printing a blank.
 */
export function templateFor(entry, ctx, where) {
  if (entry?.template !== undefined) return entry.template;
  if (isObj(entry?.byForm)) {
    const t = entry.byForm[ctx.form?.value];
    if (t === undefined) throw new Error(`${where}: has no wording for the entity form "${ctx.form?.value}" (byForm declares ${Object.keys(entry.byForm).join(', ')}). Word it in ${SURFACES}.`);
    return t;
  }
  throw new Error(`${where}: declares neither \`template\` nor \`byForm\``);
}

// ── FACT REGIONS ─────────────────────────────────────────────────────────────

export const factOpen = (name) => `<!-- FACT:${name} -->`;
export const factClose = (name) => `<!-- /FACT:${name} -->`;
const RE_ANY_MARKER = /<!-- (\/?)FACT:([a-z0-9-]+) -->/g;

/**
 * Every FACT region in `text`, in order, as {name, bodyStart, bodyEnd, line}.
 * Malformed markers (an unmatched open or close, a nested region) are returned in
 * `errors` rather than skipped: a marker the splice cannot pair is a page that
 * would quietly keep whatever it last said.
 */
export function factRegions(text) {
  const regions = [];
  const errors = [];
  let open = null;
  for (const m of text.matchAll(RE_ANY_MARKER)) {
    const line = text.slice(0, m.index).split('\n').length;
    const [, slash, name] = m;
    if (!slash) {
      if (open) errors.push({ line, what: `FACT:${name} opens inside FACT:${open.name} (opened on line ${open.line}); regions do not nest` });
      open = { name, line, bodyStart: m.index + m[0].length };
    } else if (!open) {
      errors.push({ line, what: `/FACT:${name} closes a region that was never opened` });
    } else if (open.name !== name) {
      errors.push({ line, what: `/FACT:${name} closes FACT:${open.name} (opened on line ${open.line})` });
      open = null;
    } else {
      regions.push({ name, line: open.line, bodyStart: open.bodyStart, bodyEnd: m.index });
      open = null;
    }
  }
  if (open) errors.push({ line: open.line, what: `FACT:${open.name} is never closed` });
  return { regions, errors };
}

/** `text` with every FACT region's body replaced by its rendering. Throws on an unknown fact. */
export function applyFactRegions(text, file, facts, ctx) {
  const { regions, errors } = factRegions(text);
  if (errors.length) throw new Error(`${file}:${errors[0].line}: ${errors[0].what}`);
  let out = '';
  let at = 0;
  for (const r of regions) {
    const fact = facts[r.name];
    if (!fact) throw new Error(`${file}:${r.line}: FACT:${r.name} names no fact in ${SURFACES} \`facts\``);
    const where = `${file}:${r.line} FACT:${r.name}`;
    out += text.slice(at, r.bodyStart) + renderTemplate(templateFor(fact, ctx, where), ctx, { escape: regionEscape(file), where });
    at = r.bodyEnd;
  }
  return out + text.slice(at);
}

// ── ANCHORED FIELDS ──────────────────────────────────────────────────────────

/** The matches of one anchored entry in `text`: the spans of group `v`. */
export function anchoredSpans(text, entry) {
  const re = new RegExp(entry.pattern, `${(entry.flags ?? '').replace(/[gd]/g, '')}gd`);
  const spans = [];
  for (const m of text.matchAll(re)) {
    const g = m.indices?.groups?.v;
    if (!g) throw new Error(`${entry.file}: anchored pattern ${JSON.stringify(entry.pattern)} has no named group \`v\``);
    spans.push({ start: g[0], end: g[1], line: text.slice(0, g[0]).split('\n').length });
  }
  return spans;
}

/** `text` with every anchored entry for its file applied. Throws when a count differs from the declared one. */
export function applyAnchored(text, entries, ctx) {
  let out = text;
  for (const entry of entries) {
    const spans = anchoredSpans(out, entry);
    const want = entry.count ?? 1;
    if (spans.length !== want) {
      throw new Error(`${entry.file}: anchored pattern ${JSON.stringify(entry.pattern)} matched ${spans.length} time(s), and ${SURFACES} declares ${want}. The anchor moved; fix the entry, never the count alone.`);
    }
    const where = `${entry.file} anchored ${JSON.stringify(entry.pattern)}`;
    const rendered = renderTemplate(templateFor(entry, ctx, where), ctx, { escape: entry.escape ?? 'none', where });
    for (const s of [...spans].reverse()) out = out.slice(0, s.start) + rendered + out.slice(s.end);
  }
  return out;
}

/** The whole text of a generated file. */
export function renderFile(entry, ctx) {
  const where = `${entry.file} (generated file)`;
  const body = renderTemplate(templateFor(entry, ctx, where), ctx, { escape: entry.escape ?? 'none', where });
  return body.endsWith('\n') ? body : `${body}\n`;
}
