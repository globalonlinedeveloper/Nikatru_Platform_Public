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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The deploy root this generator owns. The mirror (`sites/rajasekarselvam`) is
 *  deliberately NOT generated into — see the note in assert-discovery-surface.mjs
 *  for the measured reason (an `apps/` directory there makes the root app-facing
 *  and immediately owes four legal pages it does not have). */
export const DEPLOY_ROOT = 'sites/nikatru';
export const APPS_DIR = `${DEPLOY_ROOT}/apps`;
export const REGISTRY = 'sites/_shared/_data/apps.json';
export const SITEMAP = `${DEPLOY_ROOT}/sitemap.xml`;
export const ORIGIN = 'https://nikatru.com/';

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
      <span>NIKATRU</span>
    </a>
    <a class="back" href="${backHref}">&larr; ${backLabel}</a>
  </div>
</nav>`;

const FOOTER = `<footer>
  <a href="/">Home</a> &middot; <a href="/apps/">Apps</a> &middot; <a href="/privacy.html">Privacy</a> &middot; <a href="/terms.html">Terms</a> &middot; <a href="/refund.html">Refunds</a> &middot; <a href="/delete-account.html">Delete account</a> &middot; <a href="/contact.html">Contact</a><br><br>
  &copy; 2026 NIKATRU&trade; &middot; Chennai, Tamil Nadu, India
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
    publisher: { '@type': 'Organization', name: 'NIKATRU', url: ORIGIN },
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
${robots}<title>${esc(app.name)} &mdash; NIKATRU</title>
<meta name="description" content="${esc(app.tagline)}">
${selfRefs}${HEAD_CHROME}
<meta property="og:title" content="${esc(app.name)} &mdash; NIKATRU">
<meta property="og:description" content="${esc(app.tagline)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NIKATRU">
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
      <p>${esc(app.name)} is an app by NIKATRU, an independent studio in Chennai, Tamil Nadu, India. ${esc(app.tagline)}.</p>
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
  const url = `${ORIGIN}apps/`;
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
    : `      <p>No app is released yet. This page lists every released NIKATRU app the moment its registry entry says so.</p>
`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'NIKATRU apps',
    description: 'Every released NIKATRU app, with a page for each.',
    url,
    publisher: { '@type': 'Organization', name: 'NIKATRU', url: ORIGIN },
  };

  return `<!DOCTYPE html>
${BANNER}
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Apps &mdash; NIKATRU</title>
<meta name="description" content="Every released NIKATRU app, with a page for each.">
<link rel="canonical" href="${url}">
<meta property="og:url" content="${url}">
${HEAD_CHROME}
<meta property="og:title" content="Apps &mdash; NIKATRU">
<meta property="og:description" content="Every released NIKATRU app, with a page for each.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="NIKATRU">
<meta property="og:image" content="${ORIGIN}og-image.png">
${STYLE}
<script type="application/ld+json">
${jsonLd(ld)}
</script>
</head>
<body>
${NAV('/', 'NIKATRU home')}

<header>
  <div class="wrap">
    <h1>Apps</h1>
    <p class="tagline">Every released NIKATRU app, with a page for each.</p>
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
// Only the `<url>` blocks under /apps/ are owned here. The rest of the file is
// carried through BYTE-FOR-BYTE, because the policy pages' `<lastmod>` is pinned
// to their `data-policy-version` by check-site-integrity.mjs:501-516 and
// rewriting it from here would put two owners on one value.
//
// 🔴 THE GENERATED BLOCKS CARRY `<loc>` AND NOTHING ELSE. A `<lastmod>` would
// have to be derived from something, and every candidate is either wrong or
// unstable: `git log` on the file is empty on the commit that CREATES it (so the
// committed bytes and the regenerated bytes would differ, failing the drift diff
// forever), and today's date changes every run. Google uses `lastmod` only where
// it is verifiably accurate and ignores `changefreq`/`priority` entirely, so
// omitting it is both honest and deterministic.
const APPS_PREFIX = `${ORIGIN}apps/`;

export function rewriteSitemap(existing, generatedUrls) {
  const blocks = [...existing.matchAll(/[ \t]*<url\b[^>]*>[\s\S]*?<\/url\s*>\n?/gi)].map((m) => m[0]);
  const kept = blocks.filter((b) => {
    const loc = b.match(/<loc\s*>\s*([^<\s]+)\s*<\/loc\s*>/i);
    return !(loc && loc[1].trim().startsWith(APPS_PREFIX));
  });
  const generated = generatedUrls.map((u) => `  <url>\n    <loc>${u}</loc>\n  </url>\n`);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    kept.join('') +
    generated.join('') +
    '</urlset>\n'
  );
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
          `segment (expected ${SLUG_RE}). A slug becomes sites/nikatru/apps/<slug>.html and ${APPS_PREFIX}<slug>.html.`,
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

  const sitemapPath = join(repoRoot, ...SITEMAP.split('/'));
  if (!existsSync(sitemapPath)) {
    problems.push(`${SITEMAP} does not exist, so the generated landings have nowhere to be listed.`);
  } else {
    const urls = [`${ORIGIN}apps/`, ...live.map((a) => `${ORIGIN}apps/${a.slug}.html`)];
    files.set(SITEMAP, rewriteSitemap(readFileSync(sitemapPath, 'utf8'), urls));
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
