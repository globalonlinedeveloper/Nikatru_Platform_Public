#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-personal-site.mjs — the generated spans of sites/rajasekarselvam, the
// founder's own site, and the page contract that site is held to.
//
//   sites/_shared/_data/apps.json ─┐
//   tooling/channel-register.json ─┼─▶ index.html  <!-- PS:status --> <!-- PS:work -->
//   tooling/house-identity.json ───┘               <!-- PS:jsonld -->
//                                  └─▶ llms.txt     `## Work`
//                                  └─▶ sitemap.xml  the homepage's <lastmod>, only when
//                                                   this run changes the homepage
//
// ── WHY (the rajasekarselvam.com audit, 2026-10-02) ──────────────────────────
// The site was technically clean and partly untrue. Its Projects section was
// rendered in the browser from `var PROJECTS=[]` — EMPTY, so it never showed —
// while nikatru.com had a live app; it was the defect nikatru.com fixed in #564
// ("built its app list in the browser"), one site over. And its copy claimed
// published games, "download links for all six platforms" and "a live listing
// on every store" over a catalogue holding one web app live on 1 of 6 channels.
//
// So the work list is a FUNCTION of the catalogue, rendered at build time, and
// every product claim this generator prints is a list length or a register
// verdict. The hand-written prose around it is held by the blocking claims limb
// of tooling/ci/assert-channel-claims.mjs (PERSONAL_ROOTS).
//
// ── WHAT IT LINKS TO, AND WHY OUT (gate row R12-05) ─────────────────────────
// Each entry links OUT to its page on nikatru.com (`/apps/<slug>`). This root
// carries no `apps/` directory and no same-site legal link, so it stays
// non-app-facing (check-site-integrity.mjs `legalDuties`, INV-805) and owes no
// privacy, terms, refund or delete-account page. The app's legal pages live once,
// on the storefront that sells it.
//
// ── THE PERSON, NOT THE COMPANY (JSON-LD) ────────────────────────────────────
// `sameAs` asserts IDENTITY: "this node is that thing". The old page said the
// person `sameAs` https://nikatru.com/, i.e. that he IS the company site. The
// relation is `worksFor` (Person → Organization) and `founder` (Organization →
// Person). `sameAs` carries only the person's own profiles, read from
// tooling/house-identity.json `people.founder.sameAs`; none is recorded today, so
// none is printed. A sameAs naming the company's host is REFUSED here.
//
// ── THE PAGE CONTRACT (`pageContract`) ──────────────────────────────────────
// Run in both modes over the homepage as it will be written:
//   · CASCADE    no colour-scheme override loses to a later same-selector rule
//                (tooling/sites/css-cascade.mjs `deadDeclarations`)
//   · CONTRAST   the declared text pairs reach 4.5:1 and the focus ring 3:1 on
//                every surface, in both schemes, resolved through the cascade
//   · MENU       the collapsed mobile menu's links take no focus
//   · SKIP       the skip link carries the shared `skip-link` class
//   · NO-CLIENT  no list is rendered in the browser from a script array
//   · LD         ProfilePage → Person, a WebSite, the portrait as the image, no
//                sameAs naming the company
//
// Usage:  node tooling/sites/generate-personal-site.mjs [repoRoot]          write
//         node tooling/sites/generate-personal-site.mjs [repoRoot] --check  compare
// Exit 0 = current (or written) and the contract holds. 1 = stale, a region is
//          missing, or a contract limb failed. 2 = an input could not be read.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availabilityRow, availabilitySummary } from './availability.mjs';
import { APEX_ORIGIN, APEX_HOST } from './apex.mjs';
import { esc } from '../app-yaml/render-privacy.mjs';
import { entityContext } from '../entity/facts.mjs';
import { lastmodFor } from './lastmod.mjs';
import { contrastFindings, deadDeclarations, inlineCss, mediaMatches, parseRules, winning } from './css-cascade.mjs';

export const ROOT_DIR = 'sites/rajasekarselvam';
export const PAGE = `${ROOT_DIR}/index.html`;
export const LLMS = `${ROOT_DIR}/llms.txt`;
export const SITEMAP = `${ROOT_DIR}/sitemap.xml`;
export const REGISTRY = 'sites/_shared/_data/apps.json';
export const CHANNELS = 'tooling/channel-register.json';
export const IDENTITY = 'tooling/house-identity.json';

/** The regions this generator owns on the homepage. */
export const REGIONS = ['status', 'work', 'jsonld'];
export const regionOpen = (name) => `<!-- PS:${name} -->`;
export const regionClose = (name) => `<!-- /PS:${name} -->`;

/** The app's page on the storefront. Never a same-site path: see the header. */
export const appPageUrl = (slug) => `${APEX_ORIGIN}apps/${slug}`;

// ── INPUTS ───────────────────────────────────────────────────────────────────

function readJson(root, rel, problems, lost) {
  try {
    return JSON.parse(readFileSync(join(root, ...rel.split('/')), 'utf8'));
  } catch (e) {
    lost.push(`${rel} could not be read (${e.code ?? e.message}); the personal site's work list and claims are rendered from it`);
    return null;
  }
}

/** The live apps, the register's channels and the entity context, or the reasons they are missing. */
export function readInputs(root) {
  const problems = [];
  const lost = [];
  const registry = readJson(root, REGISTRY, problems, lost);
  const register = readJson(root, CHANNELS, problems, lost);
  const identity = readJson(root, IDENTITY, problems, lost);
  if (registry !== null && !Array.isArray(registry)) problems.push(`${REGISTRY} is not an array`);
  const channels = Array.isArray(register?.channels) ? register.channels : [];
  if (register !== null && channels.length === 0) lost.push(`${CHANNELS} declares no channels, so no availability could be stated`);
  const live = (Array.isArray(registry) ? registry : []).filter((a) => a && a.status === 'live');
  for (const a of live) {
    if (!/^[a-z0-9-]+$/.test(a.slug ?? '')) problems.push(`${REGISTRY}: a live entry has slug ${JSON.stringify(a.slug)}, which is not a URL segment`);
    if (typeof a.name !== 'string' || !a.name.trim()) problems.push(`${REGISTRY}: live entry "${a.slug}" has no name`);
  }
  const ctx = identity ? entityContext(identity) : null;
  const sameAs = identity?.people?.founder?.sameAs?.value ?? [];
  return { live, channels, ctx, sameAs: Array.isArray(sameAs) ? sameAs : [], problems, lost };
}

// ── RENDERERS (pure) ─────────────────────────────────────────────────────────

/** The hero's one-line status: what is live, counted. */
export function statusLine(live, channels) {
  if (!live.length) {
    return '      <p class="status">My first app is on its way. It will be listed here, and on Nikatru, the day it ships.</p>';
  }
  if (live.length === 1) {
    const a = live[0];
    const row = availabilityRow(channels, a.listings ?? {});
    return `      <p class="status">Live now: <a href="${esc(appPageUrl(a.slug))}">${esc(a.name)}</a> (${esc(availabilitySummary(row))}).</p>`;
  }
  return `      <p class="status">Live now: ${live.length} apps, listed under <a href="#work">Work</a>.</p>`;
}

/** The work list, as static markup. An empty catalogue renders one true line, never a blank list. */
export function workGrid(live, channels) {
  if (!live.length) {
    return '    <p class="lead work-empty">The first app is coming. It will appear here, with a link to its page on Nikatru, the day it ships.</p>';
  }
  const cards = live.map((a) => {
    const row = availabilityRow(channels, a.listings ?? {});
    return `      <li class="card work-item">
        <h3><a href="${esc(appPageUrl(a.slug))}">${esc(a.name)}<span class="sr-only"> on nikatru.com</span></a></h3>
        <p>${esc(a.tagline ?? '')}</p>
        <p class="work-state">${esc(availabilitySummary(row))}</p>
      </li>`;
  });
  return `    <ul class="grid3 work-list">\n${cards.join('\n')}\n    </ul>`;
}

/** The llms.txt `## Work` section body. */
export function llmsWork(live, channels) {
  if (!live.length) return '- The first app is coming; it will be listed here and at https://nikatru.com/apps/ when it ships.';
  const sentence = (t) => { const s = String(t ?? '').trim(); return !s || /[.!?]$/.test(s) ? s : `${s}.`; };
  return live
    .map((a) => `- ${a.name} (${appPageUrl(a.slug)}): ${sentence(a.tagline)} ${availabilitySummary(availabilityRow(channels, a.listings ?? {}))}.`.replace(/: {2}/, ': '))
    .join('\n');
}

/** The person's own site origin, from the entity source. */
export const originOf = (ctx) => `${String(ctx?.founder?.url ?? '').replace(/\/+$/, '')}/`;

/**
 * The JSON-LD graph: ProfilePage → Person, WebSite, and the Organization stub
 * the person works for and founded. Throws on a sameAs naming the company.
 */
export function personGraph(ctx, sameAs = []) {
  if (!ctx?.founder?.name || !ctx?.founder?.url) throw new Error(`${IDENTITY}: people.founder.name and .url are required to render the person`);
  const origin = originOf(ctx);
  for (const u of sameAs) {
    let host = '';
    try { host = new URL(u).hostname; } catch { throw new Error(`${IDENTITY}: people.founder.sameAs entry ${JSON.stringify(u)} is not a URL`); }
    if (host === APEX_HOST || host.endsWith(`.${APEX_HOST}`) || `${new URL(u).origin}/` === origin) {
      throw new Error(`${IDENTITY}: people.founder.sameAs names ${u}. sameAs asserts identity; the company is worksFor/founder, and this site is the person's own url. List only the person's own profiles.`);
    }
  }
  const person = {
    '@type': 'Person',
    '@id': `${origin}#person`,
    name: ctx.founder.name,
    url: origin,
    image: `${origin}rajasekar-v4.jpg`,
    jobTitle: 'Independent Software Developer',
    description: 'Independent software developer in Chennai, India, building cross-platform apps with Flutter. Founder of Nikatru.',
    email: ctx.supportEmail,
    knowsAbout: ['Cross-platform app development', 'Flutter', 'Dart', 'Web development', 'UI/UX design'],
    address: { '@type': 'PostalAddress', addressLocality: 'Chennai', addressRegion: 'Tamil Nadu', addressCountry: 'IN' },
    worksFor: { '@id': `${APEX_ORIGIN}#org` },
  };
  if (sameAs.length) person.sameAs = [...sameAs];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${origin}#profilepage`,
        url: origin,
        name: `${ctx.founder.name} — Independent software developer`,
        inLanguage: 'en',
        isPartOf: { '@id': `${origin}#website` },
        mainEntity: { '@id': `${origin}#person` },
      },
      { '@type': 'WebSite', '@id': `${origin}#website`, url: origin, name: ctx.founder.name, inLanguage: 'en', publisher: { '@id': `${origin}#person` } },
      person,
      { '@type': 'Organization', '@id': `${APEX_ORIGIN}#org`, name: 'Nikatru', url: APEX_ORIGIN, founder: { '@id': `${origin}#person` } },
    ],
  };
}

/** The JSON-LD region body. The address in it is wrapped like the visible one (email_off). */
export function jsonLdBlock(ctx, sameAs) {
  const json = JSON.stringify(personGraph(ctx, sameAs), null, 2).replace(/</g, '\\u003c');
  return `<!--email_off-->\n<script type="application/ld+json">\n${json}\n</script>\n<!--/email_off-->`;
}

/** Replace one region's body. Refuses unless exactly one ordered pair exists. */
export function applyRegion(text, name, body, file = PAGE) {
  const open = regionOpen(name);
  const close = regionClose(name);
  const opens = text.split(open).length - 1;
  const closes = text.split(close).length - 1;
  if (opens !== 1 || closes !== 1) {
    throw new Error(`${file}: expected exactly one ${open} … ${close} pair, found ${opens} opening and ${closes} closing. The span is generated; without it the page keeps whatever it last said while this generator counts it as written.`);
  }
  const a = text.indexOf(open);
  const b = text.indexOf(close);
  if (b < a) throw new Error(`${file}: the PS:${name} sentinels are reversed`);
  return `${text.slice(0, a + open.length)}\n${body}\n${text.slice(b)}`;
}

/** Replace the `## Work` section of llms.txt (heading to the next `## ` or the end). */
export function applyLlmsWork(text, body) {
  const heads = [...text.matchAll(/^## Work[ \t]*$/gm)];
  if (heads.length !== 1) throw new Error(`${LLMS}: expected exactly one "## Work" heading, found ${heads.length}`);
  const start = heads[0].index + heads[0][0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  const tail = next < 0 ? '' : rest.slice(next);
  return `${text.slice(0, start)}\n${body}\n${tail ? `\n${tail}` : ''}`;
}

/** The sitemap with the homepage's <lastmod> set to `date`. */
export function withLastmod(xml, origin, date) {
  const re = new RegExp(`(<loc>${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>)(\\d{4}-\\d{2}-\\d{2})(</lastmod>)`);
  if (!re.test(xml)) throw new Error(`${SITEMAP}: no <loc>${origin}</loc> entry with a <lastmod> to date`);
  return xml.replace(re, `$1${date}$3`);
}

// ── THE PAGE CONTRACT ────────────────────────────────────────────────────────

/** The pairs graded on the homepage, by the selector that paints them. */
export const CONTRAST_PAIRS = [
  { label: 'contact button (.mail)', fg: { selector: '.mail', prop: 'color' }, bg: { selector: '.mail', prop: 'background' }, backdrop: 'var(--bg)', min: 4.5 },
  { label: 'contact button, hovered (.mail:hover)', fg: { selector: '.mail', prop: 'color' }, bg: { selector: '.mail:hover', prop: 'background' }, backdrop: 'var(--bg)', min: 4.5 },
  { label: 'primary button (.btn-p)', fg: { selector: '.btn-p', prop: 'color' }, bg: { selector: '.btn-p', prop: 'background' }, backdrop: 'var(--ink)', min: 4.5 },
  { label: 'skip link (.skip-link)', fg: { selector: '.skip-link', prop: 'color' }, bg: { selector: '.skip-link', prop: 'background' }, backdrop: 'var(--bg)', min: 4.5 },
  { label: 'focus ring on the page background', fg: { selector: ':focus-visible', prop: 'outline' }, bg: { value: 'var(--bg)' }, min: 3 },
  { label: 'focus ring on a card', fg: { selector: ':focus-visible', prop: 'outline' }, bg: { value: 'var(--card)' }, min: 3 },
  { label: 'focus ring on the hero and footer', fg: { selector: ':focus-visible', prop: 'outline' }, bg: { value: 'var(--ink)' }, min: 3 },
  // The sticky nav is translucent (rgba .92) over whatever scrolls under it: over the light page
  // it composites to #1E2432, where light --primary measured 2.99:1 (audit 2026-10-02 §2.9).
  { label: 'focus ring on the sticky nav over the page', fg: { selector: ':focus-visible', prop: 'outline' }, bg: { value: 'rgba(11,18,32,.92)' }, backdrop: 'var(--bg)', min: 3 },
  { label: 'focus ring on the hero gradient top', fg: { selector: ':focus-visible', prop: 'outline' }, bg: { value: '#0E1830' }, min: 3 },
];

/** The collapsed mobile menu: its container must resolve to visibility:hidden (or carry inert/hidden). */
export function closedMenuFindings(html, rules, { width = 375 } = {}) {
  const out = [];
  const m = /<(\w+)[^>]*\bid="navLinks"[^>]*>([\s\S]*?)<\/\1>/.exec(html);
  if (!m) return [`${PAGE}: no element with id="navLinks", so the mobile menu cannot be graded`];
  const links = (m[2].match(/<a\b/g) ?? []).length;
  if (!links) return [`${PAGE}: #navLinks holds no link, so the menu contract graded nothing`];
  const tag = m[0].slice(0, m[0].indexOf('>') + 1);
  if (/\s(inert|hidden)(\s|=|>)/.test(tag)) return out;
  const cls = /class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
  const sel = cls.length ? `.${cls[0]}` : '#navLinks';
  const closed = winning(rules, sel, 'visibility', { scheme: 'light', width });
  if (!closed || closed.value !== 'hidden') {
    out.push(`${PAGE}: at ${width}px the collapsed menu (${sel}) resolves visibility to ${closed ? closed.value : 'its default'}, so its ${links} link(s) stay in the tab order while invisible (WCAG 2.4.7, 2.4.11). Give it visibility:hidden (or inert) while closed.`);
  }
  const open = winning(rules, `${sel}.open`, 'visibility', { scheme: 'light', width });
  if (!open || open.value !== 'visible') {
    out.push(`${PAGE}: at ${width}px the OPEN menu (${sel}.open) does not resolve visibility:visible, so the menu would never show its links`);
  }
  const wide = winning(rules, sel, 'visibility', { scheme: 'light', width: 1280 });
  if (wide && wide.value === 'hidden' && mediaMatches(wide.media, { width: 1280 }) === true) {
    out.push(`${PAGE}: at 1280px ${sel} resolves visibility:hidden, so the desktop nav is gone`);
  }
  return out;
}

/** Every node of every JSON-LD block in `html`, flattened through `@graph`. */
export function jsonLdNodes(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    const doc = JSON.parse(m[1]);
    for (const d of Array.isArray(doc) ? doc : [doc]) nodes.push(...(Array.isArray(d['@graph']) ? d['@graph'] : [d]));
  }
  return nodes;
}

/** The structured-data limb: ProfilePage → Person, a WebSite, the portrait, and no sameAs to the company. */
export function structuredDataFindings(html) {
  let nodes;
  try { nodes = jsonLdNodes(html); } catch (e) { return [`${PAGE}: a JSON-LD block does not parse (${e.message})`]; }
  const out = [];
  const typed = (t) => nodes.filter((n) => n['@type'] === t);
  for (const n of nodes) {
    for (const u of [].concat(n.sameAs ?? [])) {
      let host = '';
      try { host = new URL(u).hostname; } catch { /* not a URL: reported below */ }
      if (host === APEX_HOST || host.endsWith(`.${APEX_HOST}`)) {
        out.push(`${PAGE}: the ${n['@type']} node says sameAs ${u}. sameAs asserts IDENTITY — that this ${n['@type']} IS the company's site. The relation is worksFor (Person) / founder (Organization).`);
      } else if (!host) out.push(`${PAGE}: the ${n['@type']} node carries a sameAs that is not a URL: ${JSON.stringify(u)}`);
    }
  }
  const person = typed('Person')[0];
  if (!person) out.push(`${PAGE}: no Person node in the JSON-LD`);
  if (!typed('ProfilePage').some((p) => p.mainEntity?.['@id'] && p.mainEntity['@id'] === person?.['@id'])) out.push(`${PAGE}: no ProfilePage whose mainEntity is the Person`);
  if (!typed('WebSite').length) out.push(`${PAGE}: no WebSite node in the JSON-LD`);
  if (person && !/\.(jpe?g|webp|png)$/i.test(person.image ?? '')) out.push(`${PAGE}: the Person has no image`);
  if (person && /og-image/i.test(person.image ?? '')) out.push(`${PAGE}: the Person's image is the social card (${person.image}), not the portrait`);
  if (person && person.worksFor?.['@id'] !== `${APEX_ORIGIN}#org`) out.push(`${PAGE}: the Person does not work for ${APEX_ORIGIN}#org`);
  return out;
}

/**
 * Every contract finding on a homepage, as strings. Pure: no file is read.
 */
export function pageContract(html) {
  const findings = [...structuredDataFindings(html)];
  const rules = parseRules(inlineCss(html));
  for (const d of deadDeclarations(rules)) {
    findings.push(`${PAGE}: in ${d.scheme} mode \`${d.selector}{${d.prop}}\` inside @media ${d.media} never applies — a later \`${d.selector}\` rule sets ${d.prop}: ${d.lostTo}. Same selector, same specificity: source order decides, and the override is above the rule it overrides.`);
  }
  for (const f of contrastFindings(rules, CONTRAST_PAIRS).findings) findings.push(`${PAGE}: ${f}`);
  findings.push(...closedMenuFindings(html, rules));
  if (!/<a\b[^>]*class="[^"]*\bskip-link\b[^"]*"[^>]*href="#main"/.test(html)) {
    findings.push(`${PAGE}: no skip link with the shared class \`skip-link\` pointing at #main`);
  }
  if (/\bvar\s+PROJECTS\s*=|\binnerHTML\s*=/.test(html)) {
    findings.push(`${PAGE}: a list is rendered in the browser from a script (\`var PROJECTS\` / innerHTML). Content that exists only after JavaScript is content a crawler and a no-JS reader never see; render it here, at build time.`);
  }
  return findings;
}

// ── THE PLAN ─────────────────────────────────────────────────────────────────

/**
 * What the three files should contain. `files` maps rel → contents for every
 * file whose planned bytes are known; `problems` are refusals; `lost` are inputs
 * that could not be read (exit 2).
 */
export function planPersonalSite(root) {
  const { live, channels, ctx, sameAs, problems, lost } = readInputs(root);
  const files = new Map();
  const current = new Map();
  if (lost.length) return { files, current, problems, lost, live };
  for (const rel of [PAGE, LLMS, SITEMAP]) {
    try { current.set(rel, readFileSync(join(root, ...rel.split('/')), 'utf8')); } catch (e) { lost.push(`${rel} could not be read (${e.code ?? e.message})`); }
  }
  if (lost.length) return { files, current, problems, lost, live };
  try {
    let page = current.get(PAGE);
    page = applyRegion(page, 'status', statusLine(live, channels));
    page = applyRegion(page, 'work', workGrid(live, channels));
    page = applyRegion(page, 'jsonld', jsonLdBlock(ctx, sameAs));
    files.set(PAGE, page);
    files.set(LLMS, applyLlmsWork(current.get(LLMS), llmsWork(live, channels)));
    // The homepage's <lastmod> moves only when this run changes the homepage, and then to the
    // date tooling/sites/lastmod.mjs gives a page being changed — the one function the sitemap
    // limb of check-site-integrity.mjs evaluates. Unchanged, the sitemap is left as it is.
    const sm = current.get(SITEMAP);
    files.set(SITEMAP, page === current.get(PAGE) ? sm : withLastmod(sm, originOf(ctx), lastmodFor(root, PAGE, page)));
  } catch (e) {
    problems.push(e.message);
  }
  return { files, current, problems, lost, live };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => a.startsWith('--') && a !== '--check');
  if (unknown.length) {
    console.error(`generate-personal-site: unknown flag(s) ${unknown.join(', ')}`);
    process.exit(2);
  }
  const check = argv.includes('--check');
  const root = resolve(argv.find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const plan = planPersonalSite(root);
  if (plan.lost.length) {
    for (const l of plan.lost) console.error(`✗ COVERAGE LOST — ${l}`);
    process.exit(2);
  }
  if (plan.problems.length) {
    for (const p of plan.problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  const stale = [...plan.files].filter(([rel, text]) => plan.current.get(rel) !== text).map(([rel]) => rel);
  const contract = pageContract(plan.files.get(PAGE));
  let code = 0;
  if (check) {
    for (const rel of stale) console.error(`✗ STALE ${rel} — not what this generator renders from ${REGISTRY}, ${CHANNELS} and ${IDENTITY}. Run: node tooling/sites/generate-personal-site.mjs`);
    if (stale.length) code = 1;
  } else {
    for (const rel of stale) {
      writeFileSync(join(root, ...rel.split('/')), plan.files.get(rel));
      console.log(`    wrote ${rel}`);
    }
  }
  for (const f of contract) console.error(`✗ CONTRACT ${f}`);
  if (contract.length) code = 1;
  if (code === 0) {
    console.log(`ok  ${ROOT_DIR}: ${plan.live.length} live app(s) rendered, ${REGIONS.length} region(s) + llms.txt ${check ? 'current' : `(${stale.length} file(s) written)`}, page contract holds (${CONTRAST_PAIRS.length} pair(s) × 2 schemes)`);
  }
  process.exit(code);
}
