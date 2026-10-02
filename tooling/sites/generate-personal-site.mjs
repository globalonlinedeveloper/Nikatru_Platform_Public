#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-personal-site.mjs — the generated spans of sites/rajasekarselvam, the
// founder's own site, and the page contract that site is held to.
//
//   sites/rajasekarselvam/profile.json ─┐
//   sites/_shared/_data/apps.json ──────┤
//   tooling/channel-register.json ──────┼─▶ index.html  <!-- PS:head --> <!-- PS:hero -->
//   tooling/house-identity.json ────────┤   <!-- PS:about --> <!-- PS:status --> <!-- PS:work -->
//   tooling/entity/surfaces.json ───────┘   <!-- PS:contact --> <!-- PS:footer --> <!-- PS:jsonld -->
//                                       ├─▶ cv.html          the whole file (the one-page CV)
//                                       ├─▶ llms.txt         the whole file
//                                       ├─▶ site.webmanifest its "description"
//                                       └─▶ sitemap.xml      a page's <lastmod>, only when this
//                                                            run changes that page; the CV's
//                                                            entry is added when it is missing
//
// ── THE OWNER'S OWN FACTS, IN ONE PLACE (site-rs-wave2, 2026-10-02) ─────────
// Every PERSONAL fact the site prints — role, employer, location, experience,
// education, the LinkedIn profile, the one-line description — is read from
// sites/rajasekarselvam/profile.json and nothing else. The experience is a
// LABEL ("7+ years"), never a number derived from a date: the owner asked that no
// start year or date ever show, so the profile is refused if any value carries a
// year, and nothing here reads a date to compute it. Company facts (the MSME
// registration, the year established) stay FACT regions rendered from
// tooling/house-identity.json, inside the generated spans.
//
// `typedFactFindings` is the red control: every served .html under the root, with
// the PS regions cut out, must not carry a profile value. A fact typed into the
// page by hand is a fact the profile cannot change, so it is refused, by file.
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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availabilityRow, availabilitySummary } from './availability.mjs';
import { APEX_ORIGIN, APEX_HOST } from './apex.mjs';
import { esc } from '../app-yaml/render-privacy.mjs';
import { entityContext, factClose, factOpen, renderTemplate } from '../entity/facts.mjs';
import { lastmodFor } from './lastmod.mjs';
import { contrastFindings, deadDeclarations, inlineCss, mediaMatches, parseRules, winning } from './css-cascade.mjs';

export const ROOT_DIR = 'sites/rajasekarselvam';
export const PAGE = `${ROOT_DIR}/index.html`;
export const LLMS = `${ROOT_DIR}/llms.txt`;
export const SITEMAP = `${ROOT_DIR}/sitemap.xml`;
export const REGISTRY = 'sites/_shared/_data/apps.json';
export const CHANNELS = 'tooling/channel-register.json';
export const IDENTITY = 'tooling/house-identity.json';
export const PROFILE = `${ROOT_DIR}/profile.json`;
export const CV_PAGE = `${ROOT_DIR}/cv.html`;
export const MANIFEST = `${ROOT_DIR}/site.webmanifest`;
export const ENTITY_SURFACES = 'tooling/entity/surfaces.json';

/** The regions this generator owns on the homepage. */
export const REGIONS = ['head', 'hero', 'about', 'status', 'work', 'contact', 'footer', 'jsonld'];
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
  const profile = readJson(root, PROFILE, problems, lost);
  const surfaces = readJson(root, ENTITY_SURFACES, problems, lost);
  if (profile !== null) problems.push(...profileProblems(profile, ctx));
  const msme = surfaces?.facts?.['msme-established']?.template;
  if (surfaces !== null && typeof msme !== 'string') problems.push(`${ENTITY_SURFACES}: facts["msme-established"].template is missing; the founder line names the business through it`);
  return { live, channels, ctx, sameAs: Array.isArray(sameAs) ? sameAs : [], profile, msme, problems, lost };
}

// ── THE PROFILE ──────────────────────────────────────────────────────────────

/** The profile fields every page renders, as [path, value] pairs. */
export const PROFILE_FIELDS = [
  'name', 'headline', 'role.title', 'role.employer', 'location.locality', 'location.region', 'location.country',
  'location.countryCode', 'experience.label', 'education.degree', 'education.field', 'links.linkedin',
];
const at = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);

/** Refusals for a profile that cannot be rendered as the owner asked. Pure. */
export function profileProblems(profile, ctx) {
  const out = [];
  for (const path of PROFILE_FIELDS) {
    const v = at(profile, path);
    if (typeof v !== 'string' || !v.trim()) out.push(`${PROFILE}: "${path}" is missing or empty; every page renders it`);
  }
  // No start year, no start date, anywhere: the owner's rule. A year in any value is how one would leak.
  const walk = (v, path) => {
    if (typeof v === 'string') {
      if (!path.endsWith('why') && !path.startsWith('_readme') && /\b(19|20)\d{2}\b/.test(v)) {
        out.push(`${PROFILE}: "${path}" carries a year (${JSON.stringify(v)}). The site shows no start year or date; experience is a label the lead bumps, never a date.`);
      }
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(profile, '');
  const exp = at(profile, 'experience.label');
  if (typeof exp === 'string' && !/^\d{1,2}\+ years$/.test(exp)) out.push(`${PROFILE}: experience.label is ${JSON.stringify(exp)}; it is shown as "<N>+ years" and nothing else`);
  const li = at(profile, 'links.linkedin');
  if (typeof li === 'string') {
    let host = '';
    try { host = new URL(li).hostname; } catch { /* reported below */ }
    if (host !== 'www.linkedin.com' && host !== 'linkedin.com') out.push(`${PROFILE}: links.linkedin is not a linkedin.com URL (${JSON.stringify(li)})`);
  }
  if (ctx?.founder?.name && typeof profile?.name === 'string' && profile.name !== ctx.founder.name) {
    out.push(`${PROFILE}: name ${JSON.stringify(profile.name)} is not people.founder.name in ${IDENTITY} (${JSON.stringify(ctx.founder.name)}); one person, one spelling`);
  }
  return out;
}

/** The profile values a hand-typed page must not carry, longest first. */
export function profileValues(profile) {
  return ['headline', 'role.title', 'role.employer', 'location.locality', 'location.region', 'experience.label', 'education.degree', 'education.field', 'links.linkedin']
    .map((p) => ({ path: p, value: at(profile, p) }))
    .filter((f) => typeof f.value === 'string' && f.value.trim());
}

/** `text` with every PS region (markers and body) removed. */
export function withoutRegions(text) {
  // Split on the markers rather than replace a `<!--…-->` span (CodeQL
  // js/incomplete-multi-character-sanitization): the even pieces lie outside every region.
  return text.split(/<!-- \/?PS:[a-z-]+ -->/).filter((_, i) => i % 2 === 0).join('');
}

/**
 * THE RED CONTROL for "every personal fact renders from the profile": a profile
 * value found in a page OUTSIDE the generated regions is a typed fact. Pure.
 * `pages` maps rel → text; a fully generated page is not passed.
 */
export function typedFactFindings(pages, profile) {
  const out = [];
  const vals = profileValues(profile);
  for (const [rel, text] of pages) {
    const rest = withoutRegions(text);
    for (const { path, value } of vals) {
      for (const form of new Set([value, esc(value)])) {
        if (rest.includes(form)) {
          out.push(`${rel}: "${value}" (profile ${path}) is typed outside a generated region. Every personal fact renders from ${PROFILE}; put it in a PS region, or let the generator say it.`);
          break;
        }
      }
    }
  }
  return out;
}

/** The one-sentence description: who, where, and the founder line. */
export function describe(profile) {
  return `${profile.name} works at ${profile.role.employer} as ${profile.role.title} in ${profile.location.locality}, ${profile.location.country}, and is the founder of Nikatru. ${profile.headline}`;
}

/** The page title. */
export const pageTitle = (profile) => `${profile.name} — ${profile.role.title} at ${profile.role.employer}, founder of Nikatru`;

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

/** The homepage's text metas: title, description, Open Graph and Twitter. */
export function headBlock(profile) {
  const t = esc(pageTitle(profile));
  const d = esc(describe(profile));
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}">`,
    `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`,
    `<meta name="twitter:title" content="${t}">`,
    `<meta name="twitter:description" content="${d}">`,
  ].join('\n');
}

/** The hero's eyebrow and lines: role, the owner's one line, and the founder line. */
export function heroBlock(profile) {
  const loc = `${profile.location.locality}, ${profile.location.region}, ${profile.location.country}`;
  return [
    `      <div class="eyebrow">${esc(profile.role.title)} · ${esc(profile.role.employer)}</div>`,
    `      <h1>${esc(profile.name.split(' ')[0])} <span class="grad">${esc(profile.name.split(' ').slice(1).join(' '))}</span></h1>`,
    `      <p class="sub">${esc(profile.headline)}</p>`,
    `      <p class="status">Founder of <a href="https://nikatru.com">Nikatru</a>, based in ${esc(loc)}.</p>`,
  ].join('\n');
}

/** The founder line's company half, a FACT region rendered from the entity source. */
export function msmeRegion(template, ctx) {
  return `${factOpen('msme-established')}${renderTemplate(template, ctx, { escape: 'html', where: `${ENTITY_SURFACES} facts["msme-established"]` })}${factClose('msme-established')}`;
}

/** The about paragraphs: ONLY the profile's facts and the founder line. */
export function aboutBlock(profile, ctx, msme) {
  const p = profile;
  return [
    `    <p>I work at <b>${esc(p.role.employer)}</b> as <b>${esc(p.role.title)}</b>, with <b>${esc(p.experience.label)}</b> of experience there.`,
    `    I hold a <b>${esc(p.education.degree)}</b> in <b>${esc(p.education.field)}</b>, and I live in ${esc(p.location.locality)}, ${esc(p.location.region)}, ${esc(p.location.country)}.</p>`,
    `    <p>${esc(p.headline)} That is why I founded <b>Nikatru</b>, ${msmeRegion(msme, ctx)}.</p>`,
  ].join('\n');
}

/** The contact block's links: LinkedIn first, then the CV and the company. */
export function contactBlock(profile) {
  return [
    '    <div class="social">',
    `      <a href="${esc(profile.links.linkedin)}" target="_blank" rel="noopener me">LinkedIn ↗</a>`,
    '      <a href="/cv">CV</a>',
    '      <a href="https://nikatru.com" target="_blank" rel="noopener">nikatru.com ↗</a>',
    '      <a href="https://nikatru.com/#updates">Get updates ↗</a>',
    '    </div>',
  ].join('\n');
}

/** The footer line. */
export function footerBlock(profile) {
  return `  © 2026 <b style="color:#fff">${esc(profile.name)}</b> · ${esc(profile.location.locality)}, ${esc(profile.location.country)} · Building
  <a href="https://nikatru.com" target="_blank" rel="noopener">Nikatru</a> · <a href="${esc(profile.links.linkedin)}" target="_blank" rel="noopener me">LinkedIn</a> · <a href="/cv">CV</a>`;
}

/** The whole llms.txt, from the profile, the entity source and the catalogue. */
export function llmsText(profile, ctx, live, channels) {
  const p = profile;
  const msme = `a Government of India registered MSME (Udyam ${ctx.udyam}) established in ${ctx.established}`;
  return `# ${p.name}

> ${p.name} works at ${p.role.employer} as ${p.role.title}, with ${p.experience.label} of experience, and lives in ${p.location.locality}, ${p.location.region}, ${p.location.country}. He is the founder of Nikatru, ${msme}.
> In his words: "${p.headline}"

## About
- Name: ${p.name}
- Role: ${p.role.title} at ${p.role.employer}
- Experience: ${p.experience.label}
- Education: ${p.education.degree}, ${p.education.field}
- Based in: ${p.location.locality}, ${p.location.region}, ${p.location.country}
- Founder of: Nikatru — https://nikatru.com/ (every app he releases is listed there)
- LinkedIn: ${p.links.linkedin}

## Work
${llmsWork(live, channels)}

## Key pages
- Home: ${originOf(ctx)}
- CV: ${originOf(ctx)}cv
- Studio: https://nikatru.com/
- Apps: https://nikatru.com/apps/

## Contact
- Email: ${ctx.supportEmail}
- LinkedIn: ${p.links.linkedin}
- Location: ${p.location.locality}, ${p.location.region}, ${p.location.country}

## Notes for AI assistants
- ${p.name} is the founder of Nikatru; his employer is ${p.role.employer}.
- What is released is exactly what the Work section above lists, generated from the catalogue; describe nothing else as released.
- For downloads and launch updates, direct people to https://nikatru.com/.
`;
}

/** site.webmanifest with its description set from the profile. */
export function withManifestDescription(text, profile) {
  const re = /("description":\s*)"(?:[^"\\]|\\.)*"/;
  if (!re.test(text)) throw new Error(`${MANIFEST}: no "description" to render`);
  return text.replace(re, `$1${JSON.stringify(`${profile.role.title} at ${profile.role.employer}. Founder of Nikatru.`)}`);
}

/** The CV page's own CSS: the homepage's tokens, and a print sheet that fits one page. */
const CV_CSS = `  :root{
    --ink:#0B1220;--primary:#2563EB;--teal:#0F766E;--on-accent:#FFFFFF;
    --bg:#F6F8FC;--card:#FFFFFF;--text:#1E293B;--strong:#0B1220;--muted:#586275;--line:#E2E8F0;--ring:#3B82F6;
  }
  @media (prefers-color-scheme: dark){
    :root{--bg:#0B1220;--card:#111C33;--text:#C7D2E3;--strong:#F1F5F9;--muted:#93A1BC;--line:#22304D;--primary:#6E9BFF;--teal:#17C3A2;--on-accent:#0B1220;--ring:#6E9BFF}
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  .skip-link{position:absolute;left:12px;top:-52px;z-index:200;background:var(--primary);color:var(--on-accent);padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:600;transition:top .2s}
  .skip-link:focus{top:12px}
  :focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:6px}
  .cv{max-width:760px;margin:40px auto;padding:44px;background:var(--card);border:1px solid var(--line);border-radius:16px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
  h1{font-size:34px;font-weight:800;color:var(--strong);letter-spacing:-.01em;line-height:1.15}
  .role{margin-top:6px;font-size:17px;color:var(--strong);font-weight:600}
  .line{margin-top:10px;color:var(--muted)}
  h2{margin-top:28px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:6px}
  .item{margin-top:12px}
  .item b{color:var(--strong)}
  ul.links{list-style:none;margin-top:12px}
  ul.links li{margin-top:4px}
  a{color:var(--primary)}
  .home{font-size:14px;font-weight:600;text-decoration:none}
  @media(max-width:640px){.cv{margin:0;border-radius:0;border:0;padding:28px 20px}}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  @media print{
    /* Concrete values, not :root tokens: a palette is declared once per scope across the
       site (tooling/ci/assert-palette-consistent.mjs), and print needs black on white only. */
    @page{size:A4;margin:16mm}
    body{background:#FFFFFF;color:#000000}
    .cv{margin:0;padding:0;border:0;max-width:none;background:#FFFFFF}
    h1,.role,.item b{color:#000000}
    .line,h2{color:#333333}
    a{color:#000000}
    .skip-link,.home{display:none}
    a{text-decoration:none}
    ul.links a::after{content:" (" attr(href) ")";font-size:12px}
  }`;

/** The one-page CV, the WHOLE file, from the profile and the entity source. */
export function cvPage(profile, ctx, msme) {
  const p = profile;
  const origin = originOf(ctx);
  const title = esc(`CV — ${p.name}`);
  const desc = esc(`${p.name}: ${p.role.title} at ${p.role.employer}, ${p.experience.label} of experience, ${p.education.degree} in ${p.education.field}. Founder of Nikatru.`);
  return `<!DOCTYPE html>
<!-- GENERATED by tooling/sites/generate-personal-site.mjs from ${PROFILE} and ${IDENTITY}. Never hand-edit: --check fails on a diff. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${origin}cv">
<meta name="author" content="${esc(p.name)}">
<meta name="theme-color" content="#0B1220">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icon-16.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<style>
${CV_CSS}
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<main id="main" tabindex="-1" class="cv">
  <div class="top">
    <div>
      <h1>${esc(p.name)}</h1>
      <p class="role">${esc(p.role.title)}, ${esc(p.role.employer)}</p>
      <p class="line">${esc(p.headline)}</p>
    </div>
    <a class="home" href="/">← ${esc(origin.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a>
  </div>

  <h2>Experience</h2>
  <p class="item"><b>${esc(p.role.title)}</b> — ${esc(p.role.employer)} · ${esc(p.experience.label)}</p>
  <p class="item"><b>Founder</b> — Nikatru, ${msmeRegion(msme, ctx)}</p>

  <h2>Education</h2>
  <p class="item"><b>${esc(p.education.degree)}</b>, ${esc(p.education.field)}</p>

  <h2>Location</h2>
  <p class="item">${esc(p.location.locality)}, ${esc(p.location.region)}, ${esc(p.location.country)}</p>

  <h2>Links</h2>
  <ul class="links">
    <li>LinkedIn: <a href="${esc(p.links.linkedin)}" rel="me">${esc(p.links.linkedin.replace(/^https:\/\//, ''))}</a></li>
    <li>Website: <a href="${origin}">${esc(origin.replace(/^https:\/\//, '').replace(/\/$/, ''))}</a></li>
    <li>Nikatru: <a href="https://nikatru.com/">nikatru.com</a></li>
  </ul>
</main>
</body>
</html>
`;
}

/** The person's own site origin, from the entity source. */
export const originOf = (ctx) => `${String(ctx?.founder?.url ?? '').replace(/\/+$/, '')}/`;

/**
 * The JSON-LD graph: ProfilePage → Person, WebSite, and the Organization stub
 * the person works for and founded. Throws on a sameAs naming the company.
 */
export function personGraph(ctx, sameAs = [], profile = null) {
  if (!ctx?.founder?.name || !ctx?.founder?.url) throw new Error(`${IDENTITY}: people.founder.name and .url are required to render the person`);
  if (!profile) throw new Error(`${PROFILE}: the profile is required to render the person`);
  const origin = originOf(ctx);
  sameAs = [...new Set([profile.links.linkedin, ...sameAs])];
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
    jobTitle: profile.role.title,
    description: profile.headline,
    email: ctx.supportEmail,
    address: { '@type': 'PostalAddress', addressLocality: profile.location.locality, addressRegion: profile.location.region, addressCountry: profile.location.countryCode },
    worksFor: { '@type': 'Organization', name: profile.role.employer },
    // No institution name: the owner gave none, so the node carries the credential alone.
    alumniOf: { '@type': 'EducationalOrganization', hasCredential: { '@type': 'EducationalOccupationalCredential', credentialCategory: 'degree', name: `${profile.education.degree}, ${profile.education.field}` } },
    hasCredential: { '@type': 'EducationalOccupationalCredential', credentialCategory: 'degree', name: `${profile.education.degree}, ${profile.education.field}` },
  };
  if (sameAs.length) person.sameAs = [...sameAs];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${origin}#profilepage`,
        url: origin,
        name: pageTitle(profile),
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
export function jsonLdBlock(ctx, sameAs, profile) {
  const json = JSON.stringify(personGraph(ctx, sameAs, profile), null, 2).replace(/</g, '\\u003c');
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

/** The sitemap with the homepage's <lastmod> set to `date`. */
export function withLastmod(xml, origin, date) {
  const re = new RegExp(`(<loc>${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>)(\\d{4}-\\d{2}-\\d{2})(</lastmod>)`);
  if (!re.test(xml)) throw new Error(`${SITEMAP}: no <loc>${origin}</loc> entry with a <lastmod> to date`);
  return xml.replace(re, `$1${date}$3`);
}

/**
 * The sitemap with an entry for `loc`: added (dated `fresh()`) when missing, re-dated to
 * `date` when one is given, else left as it is.
 */
export function withSitemapEntry(xml, loc, date, fresh) {
  if (!xml.includes(`<loc>${loc}</loc>`)) {
    if (!xml.includes('</urlset>')) throw new Error(`${SITEMAP}: no </urlset> to add ${loc} before`);
    return xml.replace('</urlset>', `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${fresh()}</lastmod>\n  </url>\n</urlset>`);
  }
  return date ? withLastmod(xml, loc, date) : xml;
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
  const org = typed('Organization').find((o) => o['@id'] === `${APEX_ORIGIN}#org`);
  if (person && org?.founder?.['@id'] !== person['@id']) out.push(`${PAGE}: the Organization ${APEX_ORIGIN}#org does not name the Person as its founder`);
  return out;
}

/** The Person node against the profile: job title, employer, education, address, LinkedIn. Pure. */
export function profileGraphFindings(html, profile) {
  let nodes;
  try { nodes = jsonLdNodes(html); } catch (e) { return [`${PAGE}: a JSON-LD block does not parse (${e.message})`]; }
  const person = nodes.find((n) => n['@type'] === 'Person');
  if (!person) return [`${PAGE}: no Person node to grade against ${PROFILE}`];
  const out = [];
  const want = (cond, what) => { if (!cond) out.push(`${PAGE}: the Person's ${what} is not what ${PROFILE} says`); };
  want(person.jobTitle === profile.role.title, 'jobTitle');
  want(person.worksFor?.name === profile.role.employer, 'worksFor');
  want(JSON.stringify(person.alumniOf ?? '').includes(`${profile.education.degree}, ${profile.education.field}`), 'alumniOf (the degree)');
  want(person.address?.addressLocality === profile.location.locality && person.address?.addressRegion === profile.location.region, 'address locality and region');
  want([].concat(person.sameAs ?? []).includes(profile.links.linkedin), 'sameAs (the LinkedIn profile)');
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
  const { live, channels, ctx, sameAs, profile, msme, problems, lost } = readInputs(root);
  const files = new Map();
  const current = new Map();
  if (lost.length) return { files, current, problems, lost, live };
  if (problems.length) return { files, current, problems, lost, live };
  for (const rel of [PAGE, LLMS, SITEMAP, MANIFEST]) {
    try { current.set(rel, readFileSync(join(root, ...rel.split('/')), 'utf8')); } catch (e) { lost.push(`${rel} could not be read (${e.code ?? e.message})`); }
  }
  // The CV is generated whole, so a missing one is simply written; it is never an input.
  try { current.set(CV_PAGE, readFileSync(join(root, ...CV_PAGE.split('/')), 'utf8')); } catch { current.set(CV_PAGE, null); }
  if (lost.length) return { files, current, problems, lost, live };
  try {
    let page = current.get(PAGE);
    page = applyRegion(page, 'head', headBlock(profile));
    page = applyRegion(page, 'hero', heroBlock(profile));
    page = applyRegion(page, 'about', aboutBlock(profile, ctx, msme));
    page = applyRegion(page, 'status', statusLine(live, channels));
    page = applyRegion(page, 'work', workGrid(live, channels));
    page = applyRegion(page, 'contact', contactBlock(profile));
    page = applyRegion(page, 'footer', footerBlock(profile));
    page = applyRegion(page, 'jsonld', jsonLdBlock(ctx, sameAs, profile));
    files.set(PAGE, page);
    const cv = cvPage(profile, ctx, msme);
    files.set(CV_PAGE, cv);
    files.set(LLMS, llmsText(profile, ctx, live, channels));
    files.set(MANIFEST, withManifestDescription(current.get(MANIFEST), profile));
    // A page's <lastmod> moves only when this run changes that page, and then to the date
    // tooling/sites/lastmod.mjs gives a page being changed — the one function the sitemap
    // limb of check-site-integrity.mjs evaluates. Unchanged, its entry is left as it is.
    const origin = originOf(ctx);
    let sm = current.get(SITEMAP);
    if (page !== current.get(PAGE)) sm = withLastmod(sm, origin, lastmodFor(root, PAGE, page));
    sm = withSitemapEntry(sm, `${origin}cv`, cv === current.get(CV_PAGE) ? null : lastmodFor(root, CV_PAGE, cv), () => lastmodFor(root, CV_PAGE, cv));
    files.set(SITEMAP, sm);
  } catch (e) {
    problems.push(e.message);
  }
  return { files, current, problems, lost, live, profile };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

/** Every served .html under the root that is not generated whole, as rel → planned text. */
export function handPages(root, files) {
  const out = new Map();
  for (const name of readdirSync(join(root, ...ROOT_DIR.split('/')))) {
    if (!name.endsWith('.html')) continue;
    const rel = `${ROOT_DIR}/${name}`;
    if (rel === CV_PAGE) continue;
    out.set(rel, files.get(rel) ?? readFileSync(join(root, ...rel.split('/')), 'utf8'));
  }
  return out;
}

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
  const contract = [
    ...pageContract(plan.files.get(PAGE)),
    ...profileGraphFindings(plan.files.get(PAGE), plan.profile),
    ...typedFactFindings(handPages(root, plan.files), plan.profile),
  ];
  let code = 0;
  if (check) {
    for (const rel of stale) console.error(`✗ STALE ${rel} — not what this generator renders from ${PROFILE}, ${REGISTRY}, ${CHANNELS} and ${IDENTITY}. Run: node tooling/sites/generate-personal-site.mjs`);
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
    console.log(`ok  ${ROOT_DIR}: ${plan.live.length} live app(s) rendered, ${REGIONS.length} region(s) + cv.html + llms.txt + site.webmanifest ${check ? 'current' : `(${stale.length} file(s) written)`}, page contract holds (${CONTRAST_PAIRS.length} pair(s) × 2 schemes)`);
  }
  process.exit(code);
}
