#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-discovery.mjs — the per-app landing pages and the portfolio hub,
// generated from the one registry (`sites/_shared/_data/apps.json`).
//
// [pipeline 12]W-1 (a landing per registry entry) · [12]W-2a/W-2c (the hub, at
// one named URL) · consumed by [12]W-9's drift guard
// (`tooling/ci/assert-discovery-surface.mjs`).
//
// 🔴 THE OUTPUT IS COMMITTED, AND THAT IS NOT A STYLE CHOICE.
// `sites/nikatru` is deployed by CLOUDFLARE'S OWN GIT INTEGRATION, with NO build
// step (`tooling/ci/check-site-integrity.mjs:1-15`). A generator whose output
// only exists inside a CI job therefore produces bytes nobody serves — which is
// exactly the `sites/_shared/_site/**` mistake that made an `apps.json` write
// look "consumed" for a month while the page users see showed nothing. So this
// script WRITES INTO THE TREE and CI's job is to re-run it and DIFF.
// `sites/_shared/_site/**` is explicitly NOT an acceptable subject for any
// assertion about these surfaces.
//
// ── WHAT IT REFUSES TO INVENT ────────────────────────────────────────────────
// Everything on a generated page comes from the registry entry or is fixed
// chrome. Specifically NOT emitted, each with its reason:
//
//   · `offers` / any price. [OWNER_QUEUE D-1] locks $4.99/month and $19.99/year,
//     but `sites/nikatru/apps/_template.html:76` says `"priceCurrency": "INR"`
//     and the two cannot both be right. Which currency the Paddle listing
//     actually charges is UNVERIFIED from this repository, and
//     `tooling/ci/assert-no-price-literals.mjs` bans a price literal in shipping
//     source for exactly the reason that a hardcoded price is consistent with
//     itself forever. So no price is written here at all. The guard PRINTS the
//     gap every run.
//   · `aggregateRating`. Forbidden outright: synthesising one is the fastest
//     route to a structured-data manual action on the host that also serves the
//     store-required privacy/terms/refund/delete-account pages.
//   · store buttons. The registry carries ONE url per entry (the app itself). A
//     Play/App Store/Microsoft Store button would be a promise to a stranger
//     with no listing behind it, and `assert-channel-claims.mjs` would fail the
//     build for it. When store URLs enter the registry, they render from there.
//     [ADR 015] permanently disqualifies FLATHUB — no code path here can emit it
//     because no code path here emits any store domain at all.
//   · screenshots. Owner-supplied art that does not exist. The layout degrades
//     to no screenshot block rather than shipping three broken <img> tags — the
//     defect `_template.html:120-122` would have handed straight to every app.
//   · `operatingSystem` is the entry's OWN `platforms` array, never the
//     hardcoded six of `_template.html:71`.
//
// ── THE ONE THING IT DELIBERATELY DOES NOT TOUCH ─────────────────────────────
// 🔴 `sites/nikatru/index.html`'s `const APPS = [` ARRAY. Whether a `live` app
// is named on the public HOMEPAGE is an OWNER decision (soft launch vs
// launched), which `check-site-integrity.mjs:574-660` deliberately refuses to
// take and PRINTS every run instead. Making the homepage a function of the
// registry would settle that question silently. It stays open, the PRINT stays
// firing, and the hub this script generates is not linked from the homepage —
// which the drift guard also prints, so the gap cannot become permanent by being
// invisible.
//
// Usage:  node tooling/sites/generate-discovery.mjs [repoRoot]   (writes)
//         planDiscovery(repoRoot)                                (pure, for CI)
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';
import { lastmodFor } from './lastmod.mjs';

/** The deploy root this generator owns. The mirror (`sites/rajasekarselvam`) is
 *  deliberately NOT generated into — see the note in assert-discovery-surface.mjs
 *  for the measured reason (an `apps/` directory there makes the root app-facing
 *  and immediately owes four legal pages it does not have). */
export const DEPLOY_ROOT = 'sites/nikatru';
export const APPS_DIR = `${DEPLOY_ROOT}/apps`;
export const REGISTRY = 'sites/_shared/_data/apps.json';
export const SITEMAP = `${DEPLOY_ROOT}/sitemap.xml`;
export const LLMS = `${DEPLOY_ROOT}/llms.txt`;
export const ORIGIN = 'https://nikatru.com/';

/** 🔴 THE CANONICAL HUB URL, DECLARED EXACTLY ONCE IN THIS REPOSITORY.
 *
 *  [12]W-2a/W-2c name ONE hub URL (knowledge/decisions/026-canonical-hub-url.md)
 *  and three things now depend on the same bytes: the `<link rel="canonical">`
 *  and JSON-LD `url` this generator writes into the hub page, the UNLINKED HUB
 *  print in assert-discovery-surface.mjs, and [10]D-11 limb 3 in
 *  assert-catalog-reachable.mjs, which requires that URL to answer 200 in
 *  production.
 *
 *  It is a CONSTANT rather than a second literal in each of those places for the
 *  reason this repository keeps paying for: a hostname written twice is a
 *  hostname that can be changed once. A reachability guard probing a URL the
 *  generator no longer publishes would go on printing ok about a page nobody
 *  serves — the exact shape of `sites/_shared/_site/**`, where a write looked
 *  "consumed" for a month. Import it; do not retype it. */
export const CANONICAL_HUB_URL = `${ORIGIN}apps/`;

/** The one file under `sites/nikatru/apps/` that is NOT generated. It is served
 *  in production right now — `nikatru.com/apps/_template` resolves, because the
 *  directory sits inside the Cloudflare deploy root — and it is correctly
 *  `noindex`, which is what exempts it from the canonical and sitemap limbs of
 *  check-site-integrity.mjs. Classified BY NAME here so that it reads as neither
 *  drift nor a legitimate landing; both readings are wrong. */
export const NOT_GENERATED = '_template.html';

/** A slug becomes a filename AND a URL path segment, so it is validated rather
 *  than trusted: `../` or a space in a registry slug would write outside the
 *  apps directory or emit a URL that cannot be linked. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Registry platform id → the human name schema.org's `operatingSystem` wants.
 *  Unknown ids are NOT guessed — they fail, because a platform this map has
 *  never heard of is a registry change that needs a decision, not a silent
 *  passthrough that publishes a word nobody chose. */
const PLATFORM_NAMES = new Map([
  ['ios', 'iOS'],
  ['android', 'Android'],
  ['windows', 'Windows'],
  ['macos', 'macOS'],
  ['linux', 'Linux'],
  ['web', 'Web'],
]);

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON-LD is emitted through JSON.stringify and then `<` escaped, so a registry
 *  value containing `</script>` cannot close the block it sits in. */
const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

const HEAD_CHROME = `<meta name="theme-color" content="#0B1220">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="manifest" href="/site.webmanifest">`;

const STYLE = `<style>
  :root{--ink:#0B1220;--primary:#2E6FF2;--teal:#17C3A2;--bg:#F6F8FC;--card:#FFFFFF;--text:#1E293B;--strong:#0B1220;--muted:#586275;--line:#E2E8F0;--soft:#F6F8FC;--radius:16px}
  @media (prefers-color-scheme: dark){
    :root{--bg:#0B1220;--card:#111C33;--text:#C7D2E3;--strong:#F1F5F9;--muted:#93A1BC;--line:#22304D;--soft:#0E1830}
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
  .wrap{max-width:880px;margin:0 auto;padding:0 24px}
  :focus-visible{outline:2px solid var(--primary);outline-offset:2px;border-radius:6px}
  nav{background:rgba(11,18,32,.96);position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(255,255,255,.06)}
  .nav-in{max-width:880px;margin:0 auto;padding:0 24px;height:60px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:10px;text-decoration:none}
  .brand svg{width:30px;height:30px}
  .brand span{color:#fff;font-weight:800;letter-spacing:.14em;font-size:15px}
  a.back{color:#B6C2D9;text-decoration:none;font-size:14px}
  a.back:hover{color:#fff}
  header{background:linear-gradient(180deg,#0E1830 0%,#0B1220 100%);color:#fff;padding:64px 0}
  h1{font-size:clamp(28px,4.5vw,40px);font-weight:800;letter-spacing:-.02em}
  .tagline{color:#A9B7CE;font-size:17.5px;margin-top:8px;max-width:560px}
  .stores{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
  .store{display:inline-flex;align-items:center;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:11px;background:linear-gradient(90deg,var(--primary),var(--teal));color:#fff;border:0}
  .store:hover{filter:brightness(1.08)}
  section{padding:56px 0}
  h2{font-size:24px;font-weight:800;color:var(--strong);letter-spacing:-.01em;margin-bottom:14px}
  p{margin-bottom:12px;font-size:16px}
  ul.feat{margin:0 0 12px 20px}
  ul.feat li{margin-bottom:8px;font-size:16px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:10px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px}
  .card h3{font-size:19px;color:var(--strong);margin-bottom:6px}
  .card p{color:var(--muted);font-size:15px;margin-bottom:10px}
  .privacy{background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px;margin-top:8px}
  .privacy b{color:var(--strong)}
  .privacy p{color:var(--muted);font-size:15px;margin:6px 0 0}
  footer{background:#0B1220;color:#8FA0BC;text-align:center;padding:28px 24px;font-size:13px}
  footer a{color:#B6C2D9;text-decoration:none;margin:0 7px}
  footer a:hover{color:#fff}
</style>`;

const NAV = (backHref, backLabel) => `<nav>
  <div class="nav-in">
    <a class="brand" href="/">
      <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="nm" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2E6FF2"/><stop offset="0.55" stop-color="#2AA0D8"/><stop offset="1" stop-color="#17C3A2"/></linearGradient></defs>
        <rect width="1024" height="1024" rx="244" fill="#111C33"/>
        <path d="M 292 720 L 292 304 L 656 720 L 656 304 M 580 380 L 656 304 L 732 380" fill="none" stroke="url(#nm)" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Nikatru</span>
    </a>
    <a class="back" href="${backHref}">&larr; ${backLabel}</a>
  </div>
</nav>`;

const FOOTER = `<footer>
  <a href="/">Home</a> &middot; <a href="/apps/">Apps</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/refund.html">Refunds</a> &middot; <a href="/delete-account.html">Delete account</a> &middot; <a href="/contact.html">Contact</a><br><br>
  &copy; 2026 Nikatru&trade; &middot; Chennai, Tamil Nadu, India
</footer>`;

const BANNER = `<!-- GENERATED FILE — do not hand-edit.
     Written by tooling/sites/generate-discovery.mjs from sites/_shared/_data/apps.json.
     tooling/ci/assert-discovery-surface.mjs regenerates it in CI and fails the
     build on any difference, so an edit here is reverted by the next run at best
     and turns the sites lane red at worst. Change the registry, or the generator. -->`;

/** The platform names for an entry, in registry order. Throws (via `problems`)
 *  on an id this generator has never been taught. */
function platformNames(app, problems) {
  const out = [];
  for (const p of Array.isArray(app.platforms) ? app.platforms : []) {
    const name = PLATFORM_NAMES.get(String(p).toLowerCase());
    if (name === undefined) {
      problems.push(
        `${REGISTRY}: entry "${app.slug}" lists platform ${JSON.stringify(p)}, which this generator has ` +
          `no name for. Add it to PLATFORM_NAMES in ${'tooling/sites/generate-discovery.mjs'} — publishing a ` +
          'platform word nobody chose is how a landing starts claiming a channel the factory does not serve.',
      );
      continue;
    }
    out.push(name);
  }
  return out;
}

function landingHtml(app, problems) {
  const live = app.status === 'live';
  const url = `${ORIGIN}apps/${app.slug}.html`;
  const names = platformNames(app, problems);
  const platformSentence = names.length
    ? `Available on ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}.`
    : 'No platform is listed for this app yet.';

  // 🔴 The JSON-LD carries `name`, `description`, `url`, `operatingSystem` and
  // the publisher only. `offers` and `aggregateRating` are absent by decision —
  // see the header. Google's SoftwareApplication rich result requires
  // name + offers.price + aggregateRating|review, so this block is deliberately
  // NOT rich-result eligible; it is honest structured data, which is the half we
  // can actually assert is true.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: app.name,
    description: app.tagline,
    url,
    ...(names.length ? { operatingSystem: names.join(', ') } : {}),
    ...(live && app.url ? { installUrl: app.url } : {}),
    publisher: { '@type': 'Organization', name: 'Nikatru', url: ORIGIN },
  };

  const robots = live
    ? ''
    : '<meta name="robots" content="noindex, nofollow"><!-- registry status is not "live" -->\n';
  const selfRefs = live
    ? `<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
`
    : '';

  const openButton =
    live && typeof app.url === 'string' && app.url
      ? `    <div class="stores">
      <a class="store" href="${esc(app.url)}">Open ${esc(app.name)}</a>
    </div>
`
      : '';

  const statusNote = live
    ? ''
    : `      <p>This app is not released yet. Its registry status is <b>${esc(app.status ?? 'unknown')}</b>, so this page is not indexed and there is nothing to open.</p>
`;

  return `<!DOCTYPE html>
${BANNER}
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${robots}<title>${esc(app.name)} &mdash; Nikatru</title>
<meta name="description" content="${esc(app.tagline)}">
${selfRefs}${HEAD_CHROME}
<meta property="og:title" content="${esc(app.name)} &mdash; Nikatru">
<meta property="og:description" content="${esc(app.tagline)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nikatru">
<meta property="og:image" content="${ORIGIN}og-image.png">
${STYLE}
<script type="application/ld+json">
${jsonLd(ld)}
</script>
</head>
<body>
${NAV('/apps/', 'All apps')}

<header>
  <div class="wrap">
    <h1>${esc(app.name)}</h1>
    <p class="tagline">${esc(app.tagline)}</p>
${openButton}  </div>
</header>

<main>
  <section>
    <div class="wrap">
      <h2>About ${esc(app.name)}</h2>
      <p>${esc(app.name)} is an app by Nikatru, an independent studio in Chennai, Tamil Nadu, India. ${esc(app.tagline)}.</p>
      <p>${platformSentence}</p>
${statusNote}      <div class="privacy">
        <b>Privacy</b>
        <p>What ${esc(app.name)} collects, why, and how to have it deleted is set out in the
        <a href="/privacy.html">Privacy Policy</a> and the
        <a href="/delete-account.html">account deletion page</a>.</p>
      </div>
    </div>
  </section>
</main>

${FOOTER}
</body>
</html>
`;
}

function hubHtml(liveApps) {
  const url = CANONICAL_HUB_URL;
  const cards = liveApps.length
    ? `      <div class="cards">
${liveApps
  .map(
    (a) => `        <div class="card">
          <h3><a href="/apps/${a.slug}.html">${esc(a.name)}</a></h3>
          <p>${esc(a.tagline)}</p>
        </div>`,
  )
  .join('\n')}
      </div>
`
    : `      <p>No app is released yet. This page lists every released Nikatru app the moment its registry entry says so.</p>
`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Nikatru apps',
    description: 'Every released Nikatru app, with a page for each.',
    url,
    publisher: { '@type': 'Organization', name: 'Nikatru', url: ORIGIN },
  };

  return `<!DOCTYPE html>
${BANNER}
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Apps &mdash; Nikatru</title>
<meta name="description" content="Every released Nikatru app, with a page for each.">
<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
${HEAD_CHROME}
<meta property="og:title" content="Apps &mdash; Nikatru">
<meta property="og:description" content="Every released Nikatru app, with a page for each.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Nikatru">
<meta property="og:image" content="${ORIGIN}og-image.png">
${STYLE}
<script type="application/ld+json">
${jsonLd(ld)}
</script>
</head>
<body>
${NAV('/', 'Nikatru home')}

<header>
  <div class="wrap">
    <h1>Apps</h1>
    <p class="tagline">Every released Nikatru app, with a page for each.</p>
  </div>
</header>

<main>
  <section>
    <div class="wrap">
${cards}    </div>
  </section>
</main>

${FOOTER}
</body>
</html>
`;
}

// ── the sitemap ──────────────────────────────────────────────────────────────
// 🔴 THE WHOLE FILE IS GENERATED NOW — it used to carry every non-/apps/ block
// through byte-for-byte, and that half was hand-maintained inside a requirement
// whose first sentence is "never hand-maintained". It had already drifted: on
// 2026-08-06 six URLs claimed `lastmod` 2026-08-01/2026-08-03 while every page
// on this root last changed 2026-08-04 (`6605cc1`, the brand-display-name
// commit). Nothing could notice, because the only `lastmod` limb in the repo
// compared ONE page's date to its `data-policy-version`.
//
// ── `<loc>` + `<lastmod>`, AND NOTHING ELSE ─────────────────────────────────
// `changefreq` and `priority` are dropped, on Google's own published statement
// that it ignores both entirely and uses `lastmod` only when it is verifiably
// accurate (developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
// Emitting a field the consumer discards, and which nothing in the repo can
// check, is a value that can only ever be wrong.
//
// ── WHERE `<lastmod>` COMES FROM ────────────────────────────────────────────
// `./lastmod.mjs`, which `tooling/ci/check-site-integrity.mjs` also calls to
// ASSERT the same value on every deploy root — including the mirror, which no
// generator writes. Read that file's header for why `git log` alone is not the
// answer and how the generate → commit → regenerate → diff cycle closes.
//
// ── WHICH URLs ──────────────────────────────────────────────────────────────
// The relationship, not a list: every `.html` under the deploy root that does
// not declare `noindex`, keyed by the one canonical URL form this site uses.
// That set is computed a SECOND time, independently, by
// check-site-integrity.mjs (which asserts sitemap ≡ indexable pages in both
// directions), so a disagreement between the two is loud on the next run rather
// than silent. `_template.html`, `404.html` and the archived policy copies under
// `legal/` are excluded BY THEIR OWN `noindex` declaration, never by name.

/** A page asking not to be indexed belongs in no sitemap. Same reading as
 *  check-site-integrity.mjs's `isNoindex` — deliberately the page's own
 *  declaration rather than a filename list, which would rot. */
const isNoindex = (html) => /<meta[^>]+name\s*=\s*["']robots["'][^>]*>/i.test(html)
  && /<meta[^>]+name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(html);

/** The one URL a page is allowed to call itself. Must stay identical to
 *  check-site-integrity.mjs's `expectedUrl`, and the two are cross-checked by
 *  that guard's sitemap↔pages set equality on every run. */
export function urlForPage(page) {
  if (page === 'index.html') return ORIGIN;
  if (page.endsWith('/index.html')) return ORIGIN + page.slice(0, -'index.html'.length);
  return ORIGIN + page;
}

/** Every `.html` under the deploy root, repo-relative and POSIX-separated. */
function htmlUnder(repoRoot, relDir) {
  const out = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = listDir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith('.html')) out.push(relative(repoRoot, p).split(sep).join('/'));
    }
  };
  const start = join(repoRoot, ...relDir.split('/'));
  if (existsSync(start) && statSync(start).isDirectory()) walk(start);
  return out;
}

export function renderSitemap(entries) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries
      .map((e) => `  <url>\n    <loc>${e.loc}</loc>\n    <lastmod>${e.lastmod}</lastmod>\n  </url>\n`)
      .join('') +
    '</urlset>\n'
  );
}

// ── llms.txt ─────────────────────────────────────────────────────────────────
// 🔴 ONLY THE `## Apps` SECTION IS GENERATED, and the rest is left byte-for-byte
// on purpose rather than for lack of ambition. The other sections state facts
// that DO NOT EXIST IN THIS REPOSITORY — the Udyam registration number, the
// founding year, the founder's biography — because they live in `company/`,
// which is gitignored and invisible here. A generator could only produce them by
// carrying owner prose inside a script, which moves a second source of truth
// from a file a human can read and edit into one only a machine reads. That is
// strictly worse than the hand-maintenance it would claim to remove.
//
// `## Key pages` is likewise not generated, for a measured reason and not a
// preference: it is NOT the page set. It omits `delete-account.html` (indexable,
// in the sitemap) and includes `rajasekarselvam.com` (a different deploy root),
// so "generating" it would mean shipping a hand-written include/exclude list —
// the same hand maintenance, one indirection deeper, and harder to audit.
//
// What the `## Apps` block IS is a pure function of the registry, and it is the
// section that measurably lied: it named no app while `subly` was live and
// answering (`check-site-integrity.mjs`'s W-3c limb caught the resulting
// contradiction). Generating it means a registry entry that is deleted, renamed,
// re-tagged or taken off `live` moves this file on the next run, and the drift
// guard fails a hand edit to it — which is the property W-3 asks for.
const LLMS_SECTION = 'Apps';

export function rewriteLlms(existing, liveApps) {
  const body = liveApps.length
    ? liveApps
        .map((a) => {
          const plats = (Array.isArray(a.platforms) ? a.platforms : []).join(', ');
          return `- ${a.name} — ${a.tagline} — ${a.url}${plats ? ` (${plats})` : ''}`;
        })
        .join('\n')
    : '- No app is released yet. This section lists every released Nikatru app the moment its registry entry says so.';
  // 🔴 SPLICED BY INDEX, NOT BY REGEX, and that is a recorded bug and not taste.
  // The first version used `/^## Apps\n[\s\S]*?(?=\n## |$)/m` and shipped a
  // DOUBLE blank line before the next heading on its first real run: under the
  // `m` flag `$` matches at the end of every LINE, so the lazy body stopped at
  // the end of the first entry and left the section's own trailing newline
  // behind for the replacement to add again. Caught by reading the diff of the
  // real file; a fixture asserting "the Subly line is present" would have passed.
  const heading = `## ${LLMS_SECTION}\n`;
  const start = existing.startsWith(heading) ? 0 : existing.indexOf(`\n${heading}`) + 1;
  if (start === 0 && !existing.startsWith(heading)) return null; // the anchor is gone
  const rest = existing.slice(start + heading.length);
  const next = rest.search(/\n## /);
  const tail = next === -1 ? '' : rest.slice(next);
  return `${existing.slice(0, start)}${heading}${body}\n${tail}`;
}

/**
 * The whole plan, as bytes, without touching the disk. `assert-discovery-surface.mjs`
 * calls this and compares; the CLI below calls it and writes.
 *
 * @returns {{files: Map<string,string>, registry: object[], live: object[], problems: string[]}}
 */
export function planDiscovery(repoRoot) {
  const problems = [];
  const files = new Map();

  const registryPath = join(repoRoot, ...REGISTRY.split('/'));
  if (!existsSync(registryPath)) {
    problems.push(`${REGISTRY} does not exist — there is nothing to generate a discovery surface from.`);
    return { files, registry: [], live: [], problems };
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (e) {
    problems.push(`${REGISTRY} is not valid JSON — ${e.message}`);
    return { files, registry: [], live: [], problems };
  }
  if (!Array.isArray(registry) || registry.length === 0) {
    problems.push(`${REGISTRY} carries no entries, so every generated surface below would be empty.`);
    return { files, registry: [], live: [], problems };
  }

  const seen = new Set();
  const usable = [];
  for (const app of registry) {
    const slug = app && typeof app.slug === 'string' ? app.slug : '';
    if (!SLUG_RE.test(slug)) {
      problems.push(
        `${REGISTRY}: entry with slug ${JSON.stringify(app?.slug)} is not usable as a filename or a URL ` +
          `segment (expected ${SLUG_RE}). A slug becomes ${APPS_DIR}/<slug>.html and ${ORIGIN}apps/<slug>.html.`,
      );
      continue;
    }
    if (seen.has(slug)) {
      problems.push(`${REGISTRY}: slug "${slug}" appears more than once — two entries would write one landing.`);
      continue;
    }
    seen.add(slug);
    if (typeof app.name !== 'string' || app.name.trim() === '') {
      problems.push(`${REGISTRY}: entry "${slug}" has no name, and the landing's <title>, <h1> and JSON-LD all use it.`);
      continue;
    }
    if (typeof app.tagline !== 'string' || app.tagline.trim() === '') {
      problems.push(
        `${REGISTRY}: entry "${slug}" has no tagline, and the landing's meta description and JSON-LD description ` +
          'both come from it. An empty description is a page a crawler cannot summarise.',
      );
      continue;
    }
    usable.push(app);
  }

  const live = usable.filter((a) => a.status === 'live');
  for (const app of usable) {
    files.set(`${APPS_DIR}/${app.slug}.html`, landingHtml(app, problems));
  }
  files.set(`${APPS_DIR}/index.html`, hubHtml(live));

  // ── the sitemap: every indexable page on this root, with a git-derived date ─
  // The page set is the UNION of what is on disk and what this run plans, so a
  // brand-new landing joins the sitemap in the same run that creates it, and a
  // stale landing that no registry entry owns stays listed for exactly as long
  // as it is served. (That stale page is limb B of assert-discovery-surface.mjs
  // — reported once, there, naming the file.)
  const sitemapPath = join(repoRoot, ...SITEMAP.split('/'));
  if (!existsSync(sitemapPath)) {
    problems.push(`${SITEMAP} does not exist, so the generated landings have nowhere to be listed.`);
  } else {
    const pages = new Set(htmlUnder(repoRoot, DEPLOY_ROOT));
    for (const rel of files.keys()) if (rel.endsWith('.html')) pages.add(rel);

    const entries = [];
    for (const rel of pages) {
      // The PLANNED bytes win over the on-disk bytes: a registry status flipped
      // to `live` must move the sitemap in the run that regenerates the landing,
      // not in a second run nobody makes.
      const planned = files.get(rel);
      const abs = join(repoRoot, ...rel.split('/'));
      const html = planned ?? (existsSync(abs) ? readFileSync(abs, 'utf8') : '');
      if (isNoindex(html)) continue;
      entries.push({
        loc: urlForPage(rel.slice(`${DEPLOY_ROOT}/`.length)),
        lastmod: lastmodFor(repoRoot, rel, planned),
      });
    }
    entries.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
    files.set(SITEMAP, renderSitemap(entries));
  }

  // ── llms.txt: the `## Apps` section, and only that section ─────────────────
  // Absent is NOT this generator's complaint — `llms.txt` is in
  // check-site-integrity.mjs's REQUIRED_FILES, which reports it once.
  const llmsPath = join(repoRoot, ...LLMS.split('/'));
  if (existsSync(llmsPath)) {
    const next = rewriteLlms(readFileSync(llmsPath, 'utf8'), live);
    if (next === null) {
      problems.push(
        `${LLMS} has no \`## ${LLMS_SECTION}\` heading, and that section is the one this generator owns. ` +
          'Renaming it would silently return the app catalogue to hand maintenance — the state in which it ' +
          'named no app while subly was live and answering.',
      );
    } else {
      files.set(LLMS, next);
    }
  }

  return { files, registry, live, problems };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
  const { files, problems, live, registry } = planDiscovery(root);
  if (problems.length) {
    console.error(`✗ ${problems.length} problem(s) in the registry:`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  let written = 0;
  for (const [rel, contents] of files) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    if (!existsSync(abs) || readFileSync(abs, 'utf8') !== contents) {
      writeFileSync(abs, contents);
      written++;
      console.log(`    wrote ${rel}`);
    }
  }
  console.log(
    `ok  discovery surface — ${registry.length} registry entr(ies), ${live.length} live, ` +
      `${files.size} file(s) planned, ${written} changed`,
  );
}
