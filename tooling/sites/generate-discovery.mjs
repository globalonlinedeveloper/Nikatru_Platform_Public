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
// ── THE THREE SOURCES, AND WHY EACH ONE IS A FILE AND NOT PROSE HERE ─────────
// Everything on a generated page comes from one of these or is fixed chrome:
//
//   1. `sites/_shared/_data/apps.json`             — name, tagline, url, platforms, status
//   2. `services/platform/src/app-config-data.json` — `apps.<slug>.features` and
//      `apps.<slug>.paywall` (the offerings AND the on/off switch)
//   3. `apps/<slug>/store/<channel>/long-description.txt` — the listing lede
//
// 🔴 SOURCE 2 IS THE RAIL CONFIG THE APP ITSELF IS SERVED, and that is the whole
// reason the price may be written here now when the header used to say it may
// not. [5]M-11's rule is *prices come from the rail config, never from app
// code*; `sites/nikatru/pricing.html` already extends it to the marketing
// surface (PR #196 — "PRICES ARE COPIED FROM THE RAIL CONFIG, NOT INVENTED"),
// and this generator reads the same bytes rather than a second copy of them. So
// a landing cannot say $4.99 while the checkout charges something else: there is
// exactly one number, in one file, and both surfaces are functions of it.
//
// The old objection is answered rather than ignored. It was that
// `sites/nikatru/apps/_template.html`'s JSON-LD says `"priceCurrency": "INR"`
// (cited as `:76` until 2026-08-21; that line is a `.privacy p` CSS rule) while
// [OWNER_QUEUE D-1] locks USD, "and the two cannot both be right". They are not
// two sources: `_template.html` is the hand-written placeholder file that this
// same directory's guard scans for UNFILLED SLOTS — `[0 or price]` sits four
// lines from that INR — so it is a fill-in-the-blank sheet, not a claim about
// what anything charges. The config says `"currency_code": "USD"`, per offering,
// as data.
//
// ── WHAT IT STILL REFUSES TO INVENT ──────────────────────────────────────────
//   · a JSON-LD `offers` block. The VISIBLE price is derived; the STRUCTURED one
//     stays out, and `assert-discovery-surface.mjs` limb D fails the build for
//     it. Google's SoftwareApplication rich result needs `offers.price` AND
//     `aggregateRating|review` together, so emitting `offers` buys a rich result
//     only alongside a rating this factory must never synthesise — it would put
//     a fabricated field on the host that also serves the store-required legal
//     pages. The honest half is the half that ships.
//   · what a FREE tier contains once `paywall.enabled` is true. While the switch
//     is off the app is free in full, and the page says exactly that because it
//     is derivable. Flip the switch and the free tier's contents become a
//     product decision nothing in this repository declares, so the free card
//     stops being emitted rather than start describing a plan nobody wrote.
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
//     defect that `_template.html`'s three `/apps/shots/[SLUG]-N.webp` tags
//     would have handed straight to every app. (Anchored, not numbered: this read
//     `_template.html:120-122` until 2026-08-21, and those lines are the store
//     buttons — the screenshot tags are 15 lines further down.)
//   · `operatingSystem` is the entry's OWN `platforms` array, never the
//     hardcoded six of `_template.html`'s JSON-LD line
//     `"operatingSystem": "iOS, Android, Windows, macOS, Linux, Web"`. (Same
//     correction, same day: this read `:71`, which is a `.shots img` CSS rule.)
//
// ── THE SUPPORT AND ABOUT PAGES: ONE GENERATED SPAN EACH ─────────────────────
// `sites/nikatru/support.html`'s per-app list (`<!-- SUPPORT-APPS -->`) and
// `sites/nikatru/about.html`'s app section (`<!-- ABOUT-APPS -->`) are spliced
// by `applyAppsBlock` below from the same `live` list as the homepage grid. Until
// 2026-09-25 both were hand-written for app #1; see the block above
// `supportAppsBlock` for what that cost.
//
// ── THE HOMEPAGE GRID: GENERATED HERE, ANNOUNCED BY THE OWNER ────────────────
// 🔴 `sites/nikatru/index.html`'s app grid, between `<!-- APPS-GRID -->` and
// `<!-- /APPS-GRID -->`, is written by `applyHomeGrid` below (#564, 2026-09-09)
// from the registry's `live` rows. Whether a `live` app is announced on the
// public HOMEPAGE stays an OWNER decision (soft launch vs launched), and it is
// taken in the registry — an app's `status`, declared in `apps/<id>/app.yaml`
// and rendered into `catalog/apps.json` — never here. `check-site-integrity.mjs`
// reads the rendered cards against `catalog/apps.json` and PRINTS, every run,
// any `live` app the grid does not carry, as UNANNOUNCED.
//   ⏱ Until 2026-09-25 this paragraph was headed "THE ONE THING IT DELIBERATELY
//   DOES NOT TOUCH" and said the homepage's hand-written app array stayed out of
//   this generator so that the announcement question stayed open. #564 deleted
//   that array on 2026-09-09 and made the grid a function of the registry. The
//   paragraph is corrected rather than deleted, as the one below is.
//
// ⚠️ THE TAIL OF THIS PARAGRAPH WAS STALE AND IS CORRECTED, NOT DELETED, so the
// next reader knows the claim was retired rather than lost. It said "the hub
// this script generates is not linked from the homepage — which the drift guard
// also prints, so the gap cannot become permanent by being invisible." BOTH
// HALVES MEASURED FALSE 2026-08-21: sites/nikatru/index.html:442 links /apps/
// from the shared footer (tooling/sites/chrome.mjs emits it on all 11 CHROME
// pages — 11 of the 16 served .html under sites/nikatru; the other five are the
// three dated legal snapshots plus the two CHROME_EXCLUDED entries,
// apps/_template.html and fullshot/privacy.html), and
// assert-discovery-surface.mjs prints NOTHING of the kind — 0 lines of its full
// output this run mention the homepage at all. A header sentence that describes
// a gap somebody closed sends the next reader to fix a live surface.
//   ⚠️ THAT PARENTHESIS ITSELF OVERREACHED WHEN FIRST WRITTEN THE SAME DAY and
//   is corrected above rather than left: it said "so every page reaches the hub,
//   not just the homepage". Re-measured 2026-08-21 by walking sites/nikatru and
//   testing each file with `isChromePage` — 16 served .html, 11 chrome, 11
//   carrying the footer marker. So EVERY CHROME PAGE reaches the hub; five pages
//   do not, by the exclusions chrome.mjs names with a reason. Retiring one
//   overclaim by writing a smaller one is how the next reader inherits the
//   original mistake in a form that is harder to spot.
//
// Usage:  node tooling/sites/generate-discovery.mjs [repoRoot]   (writes)
//         planDiscovery(repoRoot)                                (pure, for CI)
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from '../ci/tree-walk.mjs';
import {
  isChromePage,
  applyChrome,
  footer as chromeFooter,
  footerCss as chromeFooterCss,
  skipLink as chromeSkipLink,
  a11yCss as chromeA11yCss,
  scaleCss as chromeScaleCss,
  marksCss as chromeMarksCss,
  openMarker,
  closeMarker,
} from './chrome.mjs';
import { lastmodFor } from './lastmod.mjs';
import { APEX_ORIGIN, publicAppUrl, appBaseHref } from './apex.mjs';
import { isAuthMailPath } from './gen-auth-mail.mjs';
import { parseYaml } from '../app-yaml/yaml.mjs';
import { renderAvailability, AVAILABILITY_CSS, availabilitySummary, availabilityRow } from './availability.mjs';

/** The deploy root this generator owns. The mirror (`sites/rajasekarselvam`) is
 *  deliberately NOT generated into — see the note in assert-discovery-surface.mjs
 *  for the measured reason (an `apps/` directory there makes the root app-facing
 *  and immediately owes four legal pages it does not have). */
export const DEPLOY_ROOT = 'sites/nikatru';
export const APPS_DIR = `${DEPLOY_ROOT}/apps`;
export const REGISTRY = 'sites/_shared/_data/apps.json';
export const SITEMAP = `${DEPLOY_ROOT}/sitemap.xml`;
export const LLMS = `${DEPLOY_ROOT}/llms.txt`;

/** The apex router's route table — see the block that writes it in
 *  `planDiscovery`. Named here so `assert-app-address-shape.mjs` and
 *  `assert-discovery-surface.mjs` can import the path instead of retyping it. */
export const APP_ROUTES = `${DEPLOY_ROOT}/app-routes.json`;

/** An inline `<script>` — one with no `src`. The negative lookahead is what keeps
 *  `<script src="…">` out: an external script is covered by `'self'`, and hashing
 *  its (empty) body would add a hash that matches nothing. */
export const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

/** The two script shapes a hash CANNOT cover: an inline event-handler attribute
 *  and a `javascript:` URL. Both need `'unsafe-hashes'`, which is a keyword this
 *  root must never acquire, so their presence is a build problem rather than
 *  something the header quietly accommodates. */
export const INLINE_HANDLER_RE = /(\son[a-z]+\s*=\s*["'])|(["']javascript:)/i;

/** The `_headers` line this generator splices. It matches the DIRECTIVE LINE, not
 *  the file, so every other rule and every one of that file's several hundred
 *  lines of recorded reasoning is untouched. */
export const CSP_LINE_RE = /^ *Content-Security-Policy:.*$/m;
/** RE-EXPORTED, not declared. The literal moved to `apex.mjs` on 2026-09-09 so
 *  that `render.mjs` and `assert-app-address-shape.mjs` could import the apex
 *  without importing this generator — see that file's header for the four
 *  readers that now have to agree. Every existing importer of `ORIGIN` keeps
 *  working unchanged, which is why the name stays. */
export const ORIGIN = APEX_ORIGIN;

/** 🔴 THE ONE PLACE A PRICE EXISTS IN THIS REPOSITORY. `services/platform/src/
 *  config.ts` serves these bytes to the app, `tooling/ci/assert-purchase-path.mjs`
 *  reads the same offerings for [5]M-8/T-11's term and trial bounds, and
 *  `sites/nikatru/pricing.html`'s numbers were copied out of it. Read it; never
 *  retype a number out of it. */
export const RAIL_CONFIG = 'services/platform/src/app-config-data.json';

/** The owner-written price list. The generated landing links to it with the
 *  visiting app's id attached (`?app=<slug>`) and carries a SUMMARY, not a
 *  second copy of the page — one full price list, at one URL, is what a payment
 *  processor's verification and a buyer both want. Linked only when the file is
 *  actually on this deploy root, because check-site-integrity.mjs fails a link
 *  to a page the root does not ship, and rightly. */
export const PRICING_PAGE = `${DEPLOY_ROOT}/pricing.html`;
export const PRICING_HREF = '/pricing';

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

/** Registry feature flag → the two strings a reader sees. Same shape and same
 *  reason as PLATFORM_NAMES: a flag this map has never heard of FAILS rather
 *  than being title-cased onto a public page, because `"reminders_v2": true` is
 *  an internal switch name and printing it is how a landing starts describing a
 *  capability in words nobody chose. Teaching the map is a one-line change made
 *  by whoever turned the flag on — the only moment anyone knows what it means.
 *
 *  The wording is deliberately APP-NEUTRAL ("Set a budget", not "across all your
 *  subscriptions"): one template serves every app in the factory, and copy that
 *  reads well for Subly is copy that lies about app #2. */
const FEATURE_NAMES = new Map([
  ['renewals', ['Renewal reminders', 'You are told what renews, and when, before you are charged.']],
  ['budgets', ['Budgets', 'Set a budget and see where you stand against it.']],
  ['exports', ['Export your data', 'Take what you entered with you, whenever you want.']],
]);

/** The billing periods the rail sells, in the vocabulary the config already
 *  uses. `assert-purchase-path.mjs`'s `PERIOD_DAYS` map (cited as `:271` until
 *  2026-08-21; that line is a COVERAGE LOST push) maps the SAME three ids to
 *  day counts for [5]M-8's revocation bound, so this is not a second
 *  vocabulary — it is the human rendering of the one that exists. An unknown
 *  term FAILS: "term": "quarter" rendered as "/ quarter" would be a
 *  billing-frequency claim made by a fallback branch. */
const TERM_NAMES = new Map([
  ['month', { unit: 'month', heading: 'Monthly', renews: 'Renews every month until you cancel.' }],
  ['year', { unit: 'year', heading: 'Yearly', renews: 'Renews every year until you cancel.' }],
  ['one_time', { unit: null, heading: 'One-time', renews: 'A single payment. Nothing renews.' }],
]);

/** Currency code → symbol. Absent ⇒ the page prints the ISO CODE next to the
 *  amount (`AUD 4.99`), which is correct and readable — never a guessed glyph,
 *  and never a bare number whose currency the reader has to assume. Only the two
 *  codes this repository actually carries are mapped: USD in the rail config,
 *  INR in `_template.html`'s placeholder sheet. */
const CURRENCY_SYMBOLS = new Map([
  ['USD', '$'],
  ['INR', '₹'],
]);

/** The store channels a listing lede may come from, in the order they are tried.
 *  NAMED and ordered rather than "whichever the directory walk hits first": the
 *  generated bytes must be a function of the tree, and a filesystem's ordering
 *  is not one. */
const STORE_CHANNELS = ['android-play', 'ios-appstore', 'linux-snap', 'macos-appstore', 'windows-store'];

/** A store listing's section heading, recognised by SHAPE and not by keyword.
 *  Both the real listing and the brick template write their sections as a line
 *  with no lower-case letters (`WHAT IT DOES`, `PRIVACY`, `WHAT YOU GET`), and
 *  matching the shape means the rule survives a section this generator has never
 *  seen. A keyword list would silently pass the whole listing through the day
 *  someone writes `HOW IT WORKS`. */
const STORE_HEADING = /^[^a-z]*[A-Z][^a-z]*$/;

/** How many leading paragraphs of a listing the landing shows. A BOUND, not a
 *  parse: a listing with no heading at all would otherwise put its sign-off line
 *  and a bare support URL into the About section. Two is what both the real
 *  Subly listing and the brick template put before their first heading. */
const STORE_LEDE_PARAGRAPHS = 2;

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JSON-LD is emitted through JSON.stringify and then `<` escaped, so a registry
 *  value containing `</script>` cannot close the block it sits in. */
const jsonLd = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');

const HEAD_CHROME = `<meta name="theme-color" content="#0B1220">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="manifest" href="/site.webmanifest">`;

/** THE og:image BLOCK — ONE constant, both page templates below, so a page
 *  cannot ship three of four ([pipeline 12]W step 14).
 *
 *  THE DEFECT, measured 2026-08-21: both templates emitted `og:image` and
 *  nothing else, while the two HAND-WRITTEN homepages carried all four —
 *  sites/nikatru/index.html:15-18 and sites/rajasekarselvam/index.html:17-20.
 *  So the two short pages were exactly the two GENERATED ones, which is the
 *  direction that matters: a hand-written page is fixed once, a template is the
 *  shape every future app landing inherits. LATENT, NOT LIVE — nothing renders
 *  wrongly and no link is broken; what was missing is what a scraper that will
 *  not fetch the image bytes is handed (no box to reserve) and what a reader who
 *  cannot see the card is handed (no alternative text).
 *
 *  THE NUMBERS ARE THE ASSET'S OWN, measured 2026-08-21 by reading the IHDR of
 *  sites/nikatru/og-image.png — 1200 x 630, 118,197 bytes — the exact file the
 *  URL on the line above resolves to. They are TYPED here and CHECKED against
 *  that file by assert-discovery-surface.mjs limb H, which parses the PNG header
 *  itself rather than importing anything from here. That separation is the M12
 *  lesson recorded in tooling/ci/test/discovery-surface.test.mjs: a comparison
 *  whose two sides were both computed by the generator agrees with a mutant.
 *
 *  THE ALT DESCRIBES THE IMAGE, NOT THE PAGE — that is what og:image:alt is for,
 *  and every generated landing points at the same site-wide card — so it is the
 *  sentence sites/nikatru/index.html:18 already publishes for this same file,
 *  checked against the artwork this run (wordmark, "Apps for every screen.", the
 *  six platform names, "Independent app studio · Chennai, India").
 *
 *  WHAT THIS DOES NOT CATCH: that the URL resolves at all (no limb anywhere
 *  fetches it), that the card is per-app rather than site-wide (it is not — one
 *  image serves every landing), and anything about twitter:* tags, which the
 *  hand-written homepages carry and these templates deliberately still do not. */
const OG_IMAGE = `<meta property="og:image" content="${ORIGIN}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Nikatru &mdash; Apps for every screen. iOS, Android, Windows, macOS, Linux and Web.">`;

const STYLE = `<style>
  :root{--ink:#0B1220;--primary:#2563EB;--teal:#0F766E;--on-accent:#FFFFFF;--bg:#F6F8FC;--card:#FFFFFF;--text:#1E293B;--strong:#0B1220;--muted:#586275;--line:#E2E8F0;--soft:#F6F8FC;--radius:16px}
  @media (prefers-color-scheme: dark){
    :root{--bg:#0B1220;--card:#111C33;--text:#C7D2E3;--strong:#F1F5F9;--muted:#93A1BC;--line:#22304D;--soft:#0E1830;--primary:#6E9BFF;--teal:#17C3A2;--on-accent:#0B1220}
  }
  :root{
${openMarker('scale-css', true)}
${chromeScaleCss()}
${closeMarker('scale-css', true)}
  }
${openMarker('marks-css', true)}
${chromeMarksCss()}
${closeMarker('marks-css', true)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
  .wrap{max-width:880px;margin:0 auto;padding:0 24px}
${openMarker('a11y-css', true)}
${chromeA11yCss()}
${closeMarker('a11y-css', true)}
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
  .store{display:inline-flex;align-items:center;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:11px;background:linear-gradient(90deg,var(--primary),var(--teal));color:var(--on-accent);border:0}
  .store:hover{filter:brightness(1.08)}
  .store.ghost{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.20)}
  .store.ghost:hover{background:rgba(255,255,255,.16);filter:none}
  section{padding:56px 0}
  section+section{padding-top:0}
  h2{font-size:24px;font-weight:800;color:var(--strong);letter-spacing:-.01em;margin-bottom:14px}
  p{margin-bottom:12px;font-size:16px}
  ul.feat{margin:0 0 12px 20px}
  ul.feat li{margin-bottom:8px;font-size:16px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:10px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px}
  .card h3{font-size:19px;color:var(--strong);margin-bottom:6px}
  .card p{color:var(--muted);font-size:15px;margin-bottom:10px}
  .card .amount{color:var(--strong);font-size:27px;font-weight:800;letter-spacing:-.02em;margin-bottom:2px}
  .card .amount small{font-size:14.5px;font-weight:600;color:var(--muted);letter-spacing:0}
  .shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:10px}
  .shots img{width:100%;height:auto;border-radius:12px;border:1px solid var(--line);background:var(--soft)}
  .trial{display:inline-block;background:var(--teal);color:var(--on-accent);font-size:11px;font-weight:800;letter-spacing:.06em;padding:3px 9px;border-radius:99px;margin-bottom:8px}
  .note{background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);padding:16px 20px;color:var(--muted);font-size:15px;margin-top:16px}
  .note p{margin:0;font-size:15px}
  .note p+p{margin-top:8px}
  .privacy{background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px;margin-top:8px}
  .privacy b{color:var(--strong)}
  .privacy p{color:var(--muted);font-size:15px;margin:6px 0 0}
  .privacy ul{margin:10px 0 0 20px}
  .privacy li{color:var(--muted);font-size:15px;margin-bottom:6px}
  .fig{font-family:var(--font-display,inherit);font-variant-numeric:tabular-nums}
${AVAILABILITY_CSS.replace(/\n$/, '')}
${openMarker('footer-css', true)}
${chromeFooterCss()}
${closeMarker('footer-css', true)}
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

// 🔴 THE GENERATED PAGES CARRY THE SENTINELS TOO, and that is not decoration.
// Without them these two pages would be the only ones whose footer came from a
// different literal, which is precisely the shape that produced six footers. With
// them, all eleven pages in CHROME_PAGES hold byte-identical chrome between
// byte-identical markers, and a reader who greps `CHROME:footer` finds every copy.
const FOOTER = [openMarker('footer', false), chromeFooter(), closeMarker('footer', false)].join('\n');

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

// ── source 2 · the rail config ───────────────────────────────────────────────

/** Parse `RAIL_CONFIG` once per run, or null when this tree has no rail.
 *
 *  🔴 ABSENT IS NOT A PROBLEM; UNPARSEABLE IS. The generator's one REQUIRED
 *  input is the registry — a tree carrying `sites/` and nothing else (every
 *  guard fixture) must still generate — so a missing file degrades to a page
 *  with no commerce sections. A file that is PRESENT and cannot be read is the
 *  opposite case and it fails, because it is the one shape where the pricing
 *  silently vanishes from a tree that has prices.
 *
 *  Neither branch is the real protection against the sections quietly going
 *  away, and this comment must not be read as if it were: that is
 *  `assert-discovery-surface.mjs` limb G, which requires the SERVED page to
 *  carry a `data-offering` for every offering the config declares, and reports
 *  COVERAGE LOST when it finds no offering at all to compare in this repository. */
export function readRailConfig(repoRoot, problems) {
  const p = join(repoRoot, ...RAIL_CONFIG.split('/'));
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    problems.push(
      `${RAIL_CONFIG} exists but is not valid JSON — ${e.message}. It is the ONE place a price lives in this ` +
        'repository, so an unreadable one takes the price off every generated landing while leaving the ' +
        'pages themselves looking finished.',
    );
    return null;
  }
}

const money = (amountMinor, code) => {
  const amount = (amountMinor / 100).toFixed(2);
  const symbol = CURRENCY_SYMBOLS.get(code);
  return symbol ? `${symbol}${amount}` : `${code} ${amount}`;
};

/** Zero, in the same currency, without the minor units — there are none to show
 *  and `$0.00` reads as a rounding, not as free. */
export const zero = (code) => {
  const symbol = CURRENCY_SYMBOLS.get(code);
  return symbol ? `${symbol}0` : `${code} 0`;
};

/**
 * The commerce facts for one app: its enabled features, its offerings, and
 * whether the paywall switch is on.
 *
 * An app with no key under `apps` is SERVED the defaults — `RAIL_CONFIG`'s own
 * `_readme` says so — and the defaults declare no features and no offerings, so
 * "absent" and "present but empty" render identically. Neither invents a plan.
 *
 * @returns {{features: {flag: string, title: string, blurb: string}[],
 *            offerings: {id: string, amount: string, code: string, term: object, trialDays: number}[],
 *            paywallEnabled: boolean}}
 */
export function commerceFor(rail, slug, problems) {
  const empty = { features: [], offerings: [], paywallEnabled: false };
  if (!rail) return empty;
  const entry = rail.apps && typeof rail.apps === 'object' ? rail.apps[slug] : undefined;
  const defaults = rail.defaults ?? {};
  const flags = entry?.features ?? defaults.features ?? {};
  const paywall = entry?.paywall ?? defaults.paywall ?? {};
  const where = `${RAIL_CONFIG}: apps.${slug}`;

  const features = [];
  for (const [flag, on] of Object.entries(flags)) {
    if (on !== true) continue;
    const named = FEATURE_NAMES.get(flag);
    if (named === undefined) {
      problems.push(
        `${where}.features enables ${JSON.stringify(flag)}, and this generator has no reader-facing name for ` +
          'it. Add one to FEATURE_NAMES in tooling/sites/generate-discovery.mjs — the alternative is a public ' +
          'page describing the product with an internal switch name, which is the same defect PLATFORM_NAMES ' +
          'exists to prevent one field over.',
      );
      continue;
    }
    features.push({ flag, title: named[0], blurb: named[1] });
  }

  const offerings = [];
  for (const o of Array.isArray(paywall.offerings) ? paywall.offerings : []) {
    const id = typeof o?.product_id === 'string' && o.product_id ? o.product_id : null;
    const code = typeof o?.currency_code === 'string' && o.currency_code ? o.currency_code : null;
    const term = TERM_NAMES.get(o?.term);
    const ok =
      id !== null && code !== null && term !== undefined && Number.isInteger(o.amount_minor) && o.amount_minor >= 0;
    if (!ok) {
      problems.push(
        `${where}.paywall.offerings carries an entry this generator will not put a price on: ` +
          `${JSON.stringify({ product_id: o?.product_id, amount_minor: o?.amount_minor, currency_code: o?.currency_code, term: o?.term })}. ` +
          'It needs a non-empty `product_id`, a non-empty `currency_code`, an integer `amount_minor` >= 0, and a ' +
          `\`term\` among ${[...TERM_NAMES.keys()].join(', ')} (the same three assert-purchase-path.mjs maps to ` +
          'day counts for [5]M-8). A rendered price is a number a stranger is asked to pay; there is no ' +
          'best-effort branch for it.',
      );
      continue;
    }
    offerings.push({
      id,
      code,
      amount: money(o.amount_minor, code),
      term,
      trialDays: Number.isInteger(o.trial_days) && o.trial_days > 0 ? o.trial_days : 0,
    });
  }
  return { features, offerings, paywallEnabled: paywall.enabled === true };
}

// ── source 3 · the store listing lede ────────────────────────────────────────

/**
 * The opening paragraphs of an app's store listing — the copy that answers
 * "what does this thing do" in the app's own published words, written once for
 * a store reviewer and reused rather than rewritten for the web.
 *
 * ⚠️ NOTHING HERE SANITISES THE COPY, and that is deliberate. A listing that
 * still carries a `[bracketed slot]` will land it on the page and
 * `assert-discovery-surface.mjs` limb C fails the build naming the page — which
 * is the correct outcome and one that already has a guard. A skip-if-bracketed
 * branch here would swallow that signal and quietly publish a shorter page.
 *
 * @returns {{source: string, paragraphs: string[]}|null}
 */
export function storeLede(repoRoot, slug) {
  for (const channel of STORE_CHANNELS) {
    const rel = `apps/${slug}/store/${channel}/long-description.txt`;
    const p = join(repoRoot, ...rel.split('/'));
    if (!existsSync(p)) continue;
    const paragraphs = [];
    let current = [];
    const flush = () => {
      if (current.length) paragraphs.push(current.join(' '));
      current = [];
    };
    for (const raw of readFileSync(p, 'utf8').split('\n')) {
      const line = raw.trim();
      if (STORE_HEADING.test(line)) break; // a section heading: the lede is over
      if (line === '') {
        flush();
        if (paragraphs.length >= STORE_LEDE_PARAGRAPHS) break;
        continue;
      }
      current.push(line);
    }
    flush();
    const out = paragraphs.slice(0, STORE_LEDE_PARAGRAPHS).filter((s) => s !== '');
    if (out.length) return { source: rel, paragraphs: out };
  }
  return null;
}

// ── source 4 · the web-sized screenshots ─────────────────────────────────────
//
// Two directories, and the split is the point:
//
//   apps/<slug>/store/android-play/screenshots/NN-<screen>.png  THE MASTERS.
//     1080x1920 store art, captured by tooling/store/capture-play-screenshots.mjs,
//     submitted to Play. Never served — 889 KB for four images.
//   sites/nikatru/apps/shots/<slug>-N-vV.webp                    THE WEB COPIES.
//     540px wide (2x the ~260 CSS px the .shots grid gives them), WebP q72,
//     69.5 KB for the same four. Committed, because Cloudflare serves this repo
//     with no build step.
//
// 🔴 THE `-vV` IN THE WEB NAME IS LOAD-BEARING, AND IT IS NOT A STYLE CHOICE.
// `sites/nikatru/_headers` gives `/*.webp` a one-year `immutable`, which
// suppresses revalidation even on an explicit reload. A stable name under that
// rule means re-cutting a screenshot would not reach a returning visitor for a
// YEAR. `assert-web-cache-policy.mjs` prints exactly that finding, and its test
// asserts the REAL repository leaves no stable name declared immutable — these
// four files failed it on their first CI run. `founder-v4.jpg` is the convention
// they now follow: the version lives IN THE NAME, so a new cut is a new URL.
// Re-cutting means writing `<slug>-N-v2.webp` and DELETING the v1; the version
// is never typed into this generator, which reads whatever is on disk.
//
// 🔴 THE LABEL COMES FROM THE MASTER'S FILENAME, and that is deliberate. `01-home`
// and `03-insights` are names the OWNER gave the screens when the captures were
// scripted; deriving alt text from them reuses an owner-authored word instead of
// inventing a description of a picture this generator cannot see. When the master
// is missing the web copy still renders, with the ordinal alone — an image with a
// weaker alt is better than an image the generator refuses to show, and a WRONG
// description is worse than both.
const SHOTS_DIR = `${APPS_DIR}/shots`;
const SHOTS_HREF = '/apps/shots';
/** The masters' directory, per app. One channel: Play is the only one with art. */
const SHOT_MASTERS = (slug) => `apps/${slug}/store/android-play/screenshots`;
/** `<slug>-<index>-v<version>.webp`. The index orders the set and lines it up
 *  with the masters' labels; the version is what makes `immutable` honest. A
 *  file that does not match is not a screenshot this generator will publish —
 *  which is how an unversioned name fails to appear rather than appearing under
 *  a cache header that would freeze it for a year. */
const SHOT_NAME = /^([a-z0-9-]+?)-(\d+)-v\d+\.webp$/i;
/** The intrinsic size every web copy is written at. Emitted as width/height on
 *  every <img> so the grid reserves its box before the bytes arrive (CLS). */
const SHOT_W = 540;
const SHOT_H = 960;

function screenshotsFor(repoRoot, slug) {
  const labels = [];
  const mastersDir = join(repoRoot, ...SHOT_MASTERS(slug).split('/'));
  if (existsSync(mastersDir)) {
    for (const name of listDir(mastersDir).filter((n) => n.toLowerCase().endsWith('.png')).sort()) {
      // `01-home.png` -> `home`; `02-my-calendar.png` -> `my calendar`.
      labels.push(name.replace(/\.png$/i, '').replace(/^\d+[-_]?/, '').replace(/[-_]+/g, ' ').trim());
    }
  }
  const dir = join(repoRoot, ...SHOTS_DIR.split('/'));
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of listDir(dir)) {
    const m = SHOT_NAME.exec(name);
    if (m && m[1] === slug) found.push({ file: name, index: Number(m[2]) });
  }
  found.sort((a, b) => a.index - b.index);
  return found.map(({ file, index }) => ({
    file,
    width: SHOT_W,
    height: SHOT_H,
    label: labels[index - 1] || `screenshot ${index}`,
  }));
}

/**
 * The served-channel register, read ONCE for the whole run.
 *
 * 🔴 A MISSING OR EMPTY REGISTER IS A PROBLEM, NOT AN EMPTY AVAILABILITY BLOCK.
 * `renderAvailability` over zero channels emits a section reading "No channel is
 * published for this app yet" — which is a TRUE sentence about an empty list and
 * a FALSE one about this app, and it would ship silently the day someone moved
 * the file. Every other reader in this generator refuses the same way, so this
 * one does too.
 */
function readChannelRegister(repoRoot, problems) {
  const rel = 'tooling/channel-register.json';
  const abs = join(repoRoot, ...rel.split('/'));
  if (!existsSync(abs)) {
    problems.push(
      `${rel} does not exist, so the availability row on every app landing would render over an empty ` +
        'register and print "no channel is published" about an app that is live on the web.',
    );
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    problems.push(`${rel} is not valid JSON — ${e.message}`);
    return [];
  }
  const channels = Array.isArray(parsed?.channels) ? parsed.channels : [];
  if (channels.length === 0) {
    problems.push(`${rel} declares no \`channels\`, so no landing could say where its app can be got.`);
  }
  return channels;
}

function landingHtml(app, ctx, problems) {
  const live = app.status === 'live';
  const url = urlForPage(`apps/${app.slug}.html`);
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

  // 🔴 EVERY DERIVED SECTION BELOW IS GATED ON `live`, AND THE GATE IS THE
  // SAME ONE THE HUB AND llms.txt ALREADY USE. A page for an app that has not
  // been released describes something a reader cannot get; a price on it is a
  // promise to a stranger with no checkout behind it. Status changes what the
  // page SAYS, never whether the page exists — the property the existing
  // noindex/canonical/sitemap treatment already has, extended to the commerce
  // half rather than given a second rule of its own.
  const { features, offerings, paywallEnabled } = live
    ? commerceFor(ctx.rail, app.slug, problems)
    : { features: [], offerings: [], paywallEnabled: false };
  const lede = live ? storeLede(ctx.repoRoot, app.slug) : null;

  // The app id travels on the query string so the price list can attribute a
  // checkout back to the landing it came from. `pricing.html` reads it, validates
  // it, and stamps it; nothing here depends on that happening.
  const pricingHref = `${PRICING_HREF}?app=${app.slug}`;
  const pricingLink = offerings.length > 0 && ctx.pricingPage;

  const buttons = [];
  if (live && typeof app.url === 'string' && app.url) {
    buttons.push(`<a class="store" href="${esc(app.url)}">Open ${esc(app.name)}</a>`);
  }
  if (pricingLink) buttons.push(`<a class="store ghost" href="${esc(pricingHref)}">See pricing</a>`);
  const openButton = buttons.length
    ? `    <div class="stores">
${buttons.map((b) => `      ${b}`).join('\n')}
    </div>
`
    : '';

  const statusNote = live
    ? ''
    : `      <p>This app is not released yet. Its registry status is <b>${esc(app.status ?? 'unknown')}</b>, so this page is not indexed and there is nothing to open.</p>
`;

  // The tagline already sits under the <h1>. Repeating it as prose is only worth
  // the line when there is nothing else to say about the app.
  const ledeParagraphs = lede ? lede.paragraphs.map((t) => `      <p>${esc(t)}</p>\n`).join('') : '';
  const studioLine = lede
    ? `${esc(app.name)} is an app by Nikatru, an independent studio in Chennai, Tamil Nadu, India.`
    : `${esc(app.name)} is an app by Nikatru, an independent studio in Chennai, Tamil Nadu, India. ${esc(app.tagline)}.`;

  // ── WHERE YOU CAN ACTUALLY GET IT ─────────────────────────────────────────
  //
  // 🔴 THIS IS THE BLOCK THE DESIGN CANVAS SPECIFIED AND THE SITE NEVER GREW.
  // `tooling/sites/availability.mjs` has existed since #568 and, until this
  // change, ZERO served pages rendered it — `assert-availability.mjs` said so on
  // every run ("0 generated availability block(s) found"). A renderer nothing
  // renders is a renderer that proves nothing; the guard's A and B limbs ranged
  // over an empty set and could only ever report clean.
  //
  // Nothing about the row is typed here. The ORDER comes from the register, the
  // STATE from `catalog/apps.json → listings`, and the count is the length of a
  // list — so this same call renders one tile or seven with no edit, which is
  // the property the hand-written badge row it replaces did not have.
  //
  // ⚠️ `facts` IS DELIBERATELY NOT PASSED. Version, download size and minimum OS
  // are the credible "boring facts under the button", and NO file in this
  // repository holds any of them today. The renderer omits the line entirely
  // when they are absent rather than printing a bracketed placeholder; passing
  // an invented value here would defeat that on the first page that uses it.
  //
  // ⚠️ AND `lost` IS RAISED, NOT LOGGED. A renderable register row the catalogue
  // has no opinion about is coverage lost — the tile would silently not render
  // and the count would silently be one lower. `renderAvailability` cannot
  // exit (it is a pure renderer); this is the caller that refuses.
  const avail = renderAvailability(ctx.channels, app.listings ?? {}, {
    heading: `Where you can get ${app.name}`,
    headingId: `availability-${app.slug}`,
  });
  for (const lost of avail.lost) {
    problems.push(
      `${REGISTRY}: entry "${app.slug}" — COVERAGE LOST rendering its availability row. ${lost}`,
    );
  }
  const availSection = avail.shown
    ? `
  <section>
    <div class="wrap">
${avail.html}
    </div>
  </section>
`
    : '';

  // ── SCREENSHOTS ────────────────────────────────────────────────────────────
  // The header's refusal is UNCHANGED and is the reason this reads the disk
  // rather than a flag: "screenshots — owner-supplied art that does not exist.
  // The layout degrades to no screenshot block rather than shipping three broken
  // <img> tags." So the block is emitted for the files that ARE there and for no
  // others, and an app with none still gets no section. What changed on
  // 2026-09-09 is only that the art now exists: `apps/subscriptiontracker/store/android-play/
  // screenshots/` had carried four real captures since 2026-08-04 and not one of
  // them appeared anywhere on the site.
  const shots = screenshotsFor(ctx.repoRoot, app.slug);
  const shotSection = shots.length
    ? `
  <section>
    <div class="wrap">
      <h2>Screenshots</h2>
      <div class="shots">
${shots
  .map(
    (s) =>
      `        <img src="${SHOTS_HREF}/${esc(s.file)}" width="${s.width}" height="${s.height}" loading="lazy" decoding="async" alt="${esc(app.name)} &mdash; ${esc(s.label)}">`,
  )
  .join('\n')}
      </div>
    </div>
  </section>
`
    : '';

  const featureSection = features.length
    ? `
  <section>
    <div class="wrap">
      <h2>What you get</h2>
      <ul class="feat">
${features.map((f) => `        <li><b>${esc(f.title)}.</b> ${esc(f.blurb)}</li>`).join('\n')}
      </ul>
    </div>
  </section>
`
    : '';

  // The free card exists only while the paywall switch is OFF, when "free" is a
  // fact about the whole app rather than a description of a tier nobody wrote.
  // See the header. The currency is the first offering's, because that is the
  // currency the reader is about to see beside it.
  //
  // ⚠️ `offerings.length` IS PART OF THE CONDITION, NOT AN ACCIDENT OF THE CALLER.
  // This string is built eagerly and only USED inside the pricing section, so
  // relying on that section's own `offerings.length` guard left
  // `offerings[0].code` dereferencing undefined. Found by emptying subscriptiontracker's
  // `offerings` array in the rail config, which crashed the generator outright
  // (TypeError, no page written) — a configuration a live app can be in the day
  // its paywall entry is edited.
  const freeCard = paywallEnabled || offerings.length === 0
    ? ''
    : `        <div class="card">
          <h3>Free</h3>
          <div class="amount">${zero(offerings[0].code)}</div>
          <p>Paid plans are not open yet, so every part of ${esc(app.name)} is free to use today.</p>
        </div>
`;
  // 🔴 THE TRIAL BADGE IS GATED ON THE PAYWALL, ADDED 2026-09-09, AND IT WAS
  // SHIPPING FALSE. The rail config declares `trial_days: 30` on both offerings,
  // so `apps/subly.html` rendered "30-DAY FREE TRIAL" on two cards — three
  // paragraphs above its own sentence "Paid checkout is not open yet … nothing
  // can be bought today", which the same function emits from the same flag.
  //
  // The page was therefore telling a reader, in its loudest type, that they
  // could start a 30-day trial, and then telling them in smaller type that they
  // could not. A trial is not a price: a price is a fact about what the thing
  // will cost and stays true while the till is shut, whereas a trial is an OFFER
  // — a thing the reader is invited to start, today, by clicking. Printing one
  // over a closed checkout is a promise made to a stranger with nothing behind
  // it, and it is the exact class of copy the availability renderer exists to
  // stop appearing one section further up the same page.
  //
  // `trial_days` stays in the rail config and the badge returns the day
  // `paywall.enabled` flips. Nothing is deleted; it is simply not claimed early.
  const currencies = [...new Set(offerings.map((o) => o.code))];
  const pricingSection = offerings.length
    ? `
  <section>
    <div class="wrap">
      <h2>Pricing</h2>
      <div class="cards">
${freeCard}${offerings
        .map(
          (o) => `        <div class="card" data-offering="${esc(o.id)}">
          <h3>${esc(o.term.heading)}</h3>
${paywallEnabled && o.trialDays ? `          <span class="trial">${o.trialDays}-DAY FREE TRIAL</span>\n` : ''}          <div class="amount">${o.amount}${o.term.unit ? ` <small>/ ${esc(o.term.unit)}</small>` : ''}</div>
          <p>${esc(o.term.renews)}</p>
        </div>`,
        )
        .join('\n')}
      </div>
      <div class="note">
        <p>${currencies.length === 1 ? `Prices are shown in ${esc(currencies[0])}.` : `Prices are shown in ${esc(currencies.join(', '))}.`} Tax is added at checkout where your country requires it.</p>
${paywallEnabled ? '' : `        <p>Paid checkout is not open yet. These are the plans ${esc(app.name)} will charge for; nothing can be bought today.</p>\n`}      </div>
${pricingLink ? `      <p><a href="${esc(pricingHref)}">See the full price list</a></p>\n` : ''}    </div>
  </section>
`
    : '';

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
${OG_IMAGE}
${STYLE}
<script type="application/ld+json">
${jsonLd(ld)}
</script>
</head>
<body>
${[openMarker('skiplink', false), chromeSkipLink(), closeMarker('skiplink', false)].join('\n')}
${NAV('/apps/', 'All apps')}

<header>
  <div class="wrap">
    <h1>${esc(app.name)}</h1>
    <p class="tagline">${esc(app.tagline)}</p>
${openButton}  </div>
</header>

<main id="main">
  <section>
    <div class="wrap">
      <h2>About ${esc(app.name)}</h2>
${ledeParagraphs}      <p>${studioLine}</p>
      <p>${platformSentence}</p>
${statusNote}    </div>
  </section>
${availSection}${shotSection}${featureSection}${pricingSection}
  <section>
    <div class="wrap">
      <h2>Privacy, terms and refunds</h2>
      <div class="privacy">
        <b>The four pages that govern using and buying ${esc(app.name)}</b>
        <p>These apply to every purchase, and they are the same documents a store reviewer opens.</p>
        <ul>
          <li><a href="/privacy">Privacy Policy</a> &mdash; what ${esc(app.name)} collects and why.</li>
          <li><a href="/terms">Terms of Service</a> &mdash; who you are contracting with.</li>
          <li><a href="/refund">Refund &amp; Cancellation Policy</a> &mdash; cancelling, and what is refundable.</li>
          <li><a href="/delete-account">Delete your account</a> &mdash; how to have your data removed.</li>
        </ul>
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
          <h3><a href="/apps/${a.slug}">${esc(a.name)}</a></h3>
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
${OG_IMAGE}
${STYLE}
<script type="application/ld+json">
${jsonLd(ld)}
</script>
</head>
<body>
${[openMarker('skiplink', false), chromeSkipLink(), closeMarker('skiplink', false)].join('\n')}
${NAV('/', 'Nikatru home')}

<header>
  <div class="wrap">
    <h1>Apps</h1>
    <p class="tagline">Every released Nikatru app, with a page for each.</p>
  </div>
</header>

<main id="main">
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
  return ORIGIN + page.replace(/\.html$/i, '');
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
// founding year, the founder's biography — because they live in the shared
// business brain `nikatru/business/`, a SEPARATE private repo that is not on this
// checkout at all. (Said "`Private/company/` (deleted 2026-08-15), which is gitignored" until 2026-08-14; the
// reasoning is unchanged and the conclusion is now stronger — this is not a
// directory a build could opt into reading, it is a different repository.)
// A generator could only produce them by
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
// section that measurably lied: it named no app while `subscriptiontracker` was live and
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

// ── the HOMEPAGE app grid ────────────────────────────────────────────────────
//
// 🔴 WHY THIS EXISTS: THE HOMEPAGE USED TO BUILD ITS APP LIST IN THE BROWSER.
// `sites/nikatru/index.html` carried `const APPS = [...]` inside a `<script>`
// and, on load, hid the three "what we're building" value cards and injected the
// app cards with `innerHTML`. Measured on the served bytes 2026-09-09, with every
// `<script>` element removed — which is exactly what a crawler or an AI fetcher
// that does not execute JavaScript is handed:
//
//     class="app-name"                 0 occurrences
//     https://subly.nikatru.com        0 occurrences
//     >Web App<                        0 occurrences
//     id="apps-grid" hidden            1  (the empty container, still hidden)
//     "In development"                 1  (the placeholder copy, still showing)
//
// So the one page most likely to be fetched said Nikatru ships nothing. The
// hand-maintained array was GUARDED — `check-site-integrity.mjs` compared it to
// the registry by name in both directions — but being guarded is not being in
// the DOM, and no guard on a JS literal can put it there.
//
// The array is now gone and this function renders the same grid AT BUILD TIME
// from the same registry, spliced between the page's own sentinel pair by
// `applyHomeGrid` below. The client script that injected cards is deleted; there
// is nothing left to enhance because there is nothing left to wait for.
//
// ── WHAT IT REFUSES TO INVENT, ON THE SAME RULE AS EVERY OTHER LIMB HERE ─────
//   · an icon per app. The registry has no `icon` field, and the emoji the old
//     array carried (`&#128179;`, a credit card) existed only in that literal.
//     A generator cannot read a field that does not exist, so the tile renders
//     the SITE's brand mark — chrome, not a claim about the app. When the
//     registry gains an icon, it renders from there.
//   · a store button for a listing that is null. `listings` is read key by key;
//     an absent channel draws nothing, which is the same rule
//     `assert-channel-claims.mjs` enforces for the landings.
//   · the "coming soon" state for an app with no listing at all — that is the
//     old array's fallback and it is kept, because an app in the registry with
//     no reachable channel is exactly what it says.
//
// ── THE FALLBACK IS INSIDE THE REGION ON PURPOSE ─────────────────────────────
// The three value cards ("In development" / "Core principle" / "Our commitment")
// were the thing the old script HID once apps existed. They are emitted here for
// the empty-registry case so the page degrades to the honest pre-launch shape by
// regeneration rather than by a browser, and so that state is reachable from the
// tree instead of only from a code path nobody runs.
const HOME_PAGE = `${DEPLOY_ROOT}/index.html`;

/** The homepage's own sentinel pair. DELIBERATELY NOT a `CHROME:` marker and not
 *  a member of `chrome.mjs`'s REGIONS: `applyChrome` applies every region to
 *  every chrome page and refuses when one is missing, so a homepage-only region
 *  added there would fail the other twelve pages on the next run. Same refusal
 *  semantics, different owner. */
export const HOME_GRID_OPEN = '<!-- APPS-GRID -->';
export const HOME_GRID_CLOSE = '<!-- /APPS-GRID -->';

// 🔴 `LISTING_LABELS` IS GONE, DELETED 2026-09-09, AND THIS NOTE IS ITS RECORD.
// It was a hand-written `listings` key -> store name table living in this file,
// which is the SAME defect as a hand-written badge row one level down: it goes
// stale in silence, it lets a channel be renamed on the page without being
// renamed in the register, and its key set (`appstore`, `mac`, `microsoft`,
// `linux`) was already a THIRD vocabulary — neither the register's channel ids
// (`ios-appstore`, `macos-appstore`, `windows-store`, `linux-snap`) nor anything
// a guard compared it against. A key the table did not know simply rendered
// nothing, so a real published listing could disappear from the homepage and
// every count in this generator would still be right.
//
// The register is now the only source of channel identity on this page too:
// `availabilityRow(ctx.channels, app.listings)` decides which channels exist,
// which are live, and how many there are — and the count printed beside each row
// is the length of that list. See tooling/sites/availability.mjs.

/** The site's own mark, as the app tile. Not the app's icon — see above. */
const HOME_APP_MARK = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <defs><linearGradient id="am" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2563EB"/><stop offset="0.55" stop-color="#2A8FB8"/><stop offset="1" stop-color="#0F766E"/></linearGradient></defs>
            <path d="M 292 720 L 292 304 L 656 720 L 656 304 M 580 380 L 656 304 L 732 380" fill="none" stroke="url(#am)" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`;

/** The three honest value cards, shown while no app is live. Byte-for-byte the
 *  block `sites/nikatru/index.html` shipped before the grid was generated. */
const HOME_VALUE_CARDS = `    <div class="bento">
      <div class="card b-a">
        <div class="card-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 13l9 5 9-5"/></svg>
        </div>
        <h3>Cross-platform apps</h3>
        <p>Everyday tools and games that feel native on your phone, your computer and the web &mdash;
        not watered-down ports.</p>
        <span class="tag">In development</span>
      </div>
      <div class="card b-b">
        <div class="card-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>
        </div>
        <h3>Privacy-first by design</h3>
        <p>No tracking, no ads, no selling your data. Apps that do their job and respect your information.</p>
        <span class="tag">Core principle</span>
      </div>
      <div class="card wide b-c">
        <div class="card-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3l2.2 5.4L20 10l-5.8 1.6L12 17l-2.2-5.4L4 10l5.8-1.6z"/></svg>
        </div>
        <div class="card-body">
          <h3>Built for the long run</h3>
          <p>Careful design and steady updates. Software we intend to support &mdash; not abandon after launch.</p>
          <span class="tag">Our commitment</span>
        </div>
      </div>
    </div>`;

/**
 * The homepage grid, as static markup. Pure; no DOM, no timing, no `hidden`.
 *
 * @param {object[]} liveApps registry entries whose status is `live`
 * @returns {string}
 */
export function homeAppsGrid(liveApps, channels = []) {
  if (!liveApps.length) return HOME_VALUE_CARDS;
  const rows = liveApps.map((app) => {
    const row = availabilityRow(channels, app.listings ?? {});
    // The marks are DECORATION and are hidden from assistive technology; the
    // sentence beside them carries the same fact in words. WCAG 1.4.1: a row
    // whose state lived only in the number of filled squares would convey its
    // meaning by colour and shape alone, and the compact form has no room for
    // per-channel labels. The labelled form is on the landing this row links to.
    const marks = row.tiles
      .map((t) => `<span class="mark mark-${t.state === 'live' ? 'served' : 'soon'}"></span>`)
      .join('');
    // 🔴 TWO LINKS, NOT ONE ROW-SIZED ANCHOR. The first draft wrapped the whole
    // row in a single `<a>`, which is worse in both directions: it makes one
    // link whose accessible name is the icon, the product name, the tagline, six
    // status marks and a count read end to end, and it makes a SECOND link
    // impossible, because anchors cannot nest. The second link is the one that
    // matters — it is the app's own address, and it is the only direct route
    // from this page to the running product.
    //
    // ⚠️ `app.url` COMES FROM THE CATALOGUE AND IS NEVER TYPED HERE. The app's
    // public path is moving, and a literal in this generator would survive the
    // rename silently while pointing at a 404. The open link exists only when
    // the catalogue supplies a URL; an entry without one renders the row and no
    // button rather than a button to nowhere.
    const open =
      typeof app.url === 'string' && app.url !== ''
        ? `\n          <a class="reg-open" href="${esc(app.url)}">Open<span class="sr-only"> ${esc(app.name)}</span> &rarr;</a>`
        : '';
    return `      <li class="reg-row">
        <span class="reg-icon" aria-hidden="true">
          ${HOME_APP_MARK}
        </span>
        <span class="reg-main">
          <a class="app-name" href="/apps/${esc(app.slug)}">${esc(app.name)}</a>
          <span class="app-tag">${esc(app.tagline ?? '')}</span>
        </span>
        <span class="reg-state">
          <span class="marks" aria-hidden="true">${marks}</span>
          <span class="reg-count fig">${esc(availabilitySummary(row))}</span>
        </span>${open}
      </li>`;
  });
  return `    <ul class="reg">\n${rows.join('\n')}\n    </ul>`;
}

/**
 * Splice the grid into the homepage between its sentinels.
 *
 * 🔴 REFUSES when the pair is missing, exactly as `spliceRegion` does for shared
 * chrome, and for the identical reason: a splice that quietly does nothing leaves
 * the page serving whatever it last had while every count still includes it. That
 * is the failure this whole change was made to end, so it may not be reintroduced
 * by the fix.
 *
 * @param {string} html the homepage as it is on disk
 * @param {object[]} liveApps
 * @returns {string}
 */
export function applyHomeGrid(html, liveApps, channels = []) {
  const opens = html.split(HOME_GRID_OPEN).length - 1;
  const closes = html.split(HOME_GRID_CLOSE).length - 1;
  if (opens !== 1 || closes !== 1) {
    throw new Error(
      `${HOME_PAGE}: expected exactly one ${HOME_GRID_OPEN} … ${HOME_GRID_CLOSE} pair, found ` +
        `${opens} opening and ${closes} closing sentinel(s). The homepage app grid is generated into that span; ` +
        'without it the page would silently keep whatever grid it last had while this generator still counted ' +
        'the file as written — which is the client-rendered failure this limb exists to end.',
    );
  }
  const start = html.indexOf(HOME_GRID_OPEN);
  const end = html.indexOf(HOME_GRID_CLOSE);
  if (end < start) {
    throw new Error(`${HOME_PAGE}: the APPS-GRID sentinels are reversed, which would replace the rest of the document.`);
  }
  return `${html.slice(0, start + HOME_GRID_OPEN.length)}\n${homeAppsGrid(liveApps, channels)}\n${html.slice(end)}`;
}

// -----------------------------------------------------------------------------
// THE PRICE LIST - sites/nikatru/pricing.html's numbers, spliced from RAIL_CONFIG
//
// 🔴 UNTIL 2026-09-09 THIS PAGE WAS THE SECOND HOME OF EVERY PRICE, AND NOTHING
// COULD SEE IT. `RAIL_CONFIG`'s own comment above calls itself "the ONE place a
// price exists in this repository", and then says, three lines later, that
// "`sites/nikatru/pricing.html`'s numbers were copied out of it". Both halves
// were true, and the second one is the defect: a copy is a copy.
//
// It survived every guard, each for its own reason:
//   - `assert-no-price-literals.mjs` scans `apps/`, `packages/` and
//     `tooling/bricks`. `sites/` was never in its roots.
//   - `assert-render-payload.mjs` and `assert-discovery-surface.mjs` re-derive
//     the prices on the GENERATED landing page. This page is hand-written, so
//     they compared it against nothing.
//   - `assert-policy-archive.mjs` version-gates `privacy.html`, not this one.
// So moving `amount_minor` moved the app, the served config, the landing page
// and the render payload - and left the page a buyer actually reads, and the one
// Paddle carries as its default payment link, quoting the old number. That is
// the [pipeline 5]M-11 defect exactly, one surface further out.
//
// ⚠️ IT IS SPLICED, NOT REGENERATED, for the reason chrome.mjs is spliced: the
// page is hand-written argument - refunds, taxes, what renewal means - and
// moving all of it into a generator to derive four numbers would trade a small
// duplication for a large one. Three regions, each the smallest span holding a
// price.
// -----------------------------------------------------------------------------

/** The three spliced spans on `pricing.html`. Same sentinel discipline as
 *  `HOME_GRID_OPEN`: exactly one pair each, and a missing pair REFUSES. */
export const PRICING_REGIONS = ['meta', 'plans', 'table'];
export const pricingOpen = (region) => `<!-- PRICING:${region} -->`;
export const pricingClose = (region) => `<!-- /PRICING:${region} -->`;

/**
 * The offerings the price list is FOR.
 *
 * 🔴 ONE PAGE, ONE PRICED APP, AND IT IS ASSERTED RATHER THAN ASSUMED.
 * `/pricing` is a single site-wide URL - the one a merchant of record verifies,
 * and the one every generated landing links to with `?app=<slug>` attached. It
 * can render exactly one SKU set. Today `subscriptiontracker` is the only app
 * whose paywall declares offerings, so the question does not arise; the moment a
 * second one does, this REFUSES rather than silently rendering whichever came
 * first out of the catalogue. The fix then is a per-app price list, and that is
 * a decision - not something this function may take on a reader's behalf.
 *
 * @returns {{slug: string, offerings: object[], paywallEnabled: boolean}|null}
 */
export function pricedApp(ctx, liveApps, problems) {
  const priced = [];
  for (const app of liveApps) {
    const { offerings, paywallEnabled } = commerceFor(ctx.rail, app.slug, problems);
    if (offerings.length > 0) priced.push({ slug: app.slug, offerings, paywallEnabled });
  }
  if (priced.length > 1) {
    problems.push(
      `${PRICING_PAGE} is ONE page and ${priced.length} live apps declare offerings ` +
        `(${priced.map((p) => p.slug).join(', ')}). A single price list cannot carry two SKU sets, and ` +
        'picking one would show the other app\u2019s buyers a price that is not theirs. Split the price ' +
        'list per app, or leave the second app with no offerings until it has its own page.',
    );
    return null;
  }
  return priced[0] ?? null;
}

/**
 * The trial this page may OFFER for one offering: its `trialDays` while the
 * paywall is open, and 0 while it is shut.
 *
 * 🔴 GATED 2026-09-22, THIRTEEN DAYS AFTER THE LANDING BADGE. The landing
 * page's badge was gated on `paywallEnabled` on 2026-09-09 (see the comment
 * above `pricingSection`: a trial is an OFFER, not a price, and an offer over a
 * shut till is a promise with nothing behind it). The price list was never
 * given the same gate, so `/pricing` promised a 30-day trial on all three plans
 * while checkout was closed — the one-time plan included. All three price-list
 * regions read the trial through this one function, so they cannot disagree
 * with each other or with the landing page again. The case "applyPricing —
 * a trial is offered only while the paywall is open" in
 * tooling/ci/test/discovery-surface.test.mjs holds it.
 */
export function offeredTrial(app, o) {
  return app?.paywallEnabled === true && (o.trialDays ?? 0) > 0 ? o.trialDays : 0;
}

/** `<meta name="description">`, carrying the headline prices and, while checkout is open, the trial. */
export function pricingMeta(app) {
  if (app === null || app.offerings.length === 0) {
    return '<meta name="description" content="Pricing for Nikatru apps. Nothing is sold from this website today.">';
  }
  const trial = Math.max(...app.offerings.map((o) => offeredTrial(app, o)));
  const parts = app.offerings.map((o) => (o.term.unit ? `${o.amount}/${o.term.unit}` : `${o.amount} once`));
  const trialWords = trial > 0 ? ` with a ${trial}-day free trial` : '';
  return `<meta name="description" content="Pricing for Nikatru apps. Free plan, and Pro at ${esc(parts.join(' or '))}${trialWords}.">`;
}

/** The plan cards: one Free card, then one card per offering. */
export function pricingPlans(app) {
  if (app === null || app.offerings.length === 0) {
    return '    <p>No plan is on sale from this website today.</p>';
  }
  const code = app.offerings[0].code;
  const free = `    <div class="plan">
      <h3>Free</h3>
      <div class="price">${esc(zero(code))}</div>
      <div class="sub">No card required</div>
      <ul>
        <li>Track your subscriptions</li>
        <li>See monthly and yearly totals</li>
        <li>Renewal dates at a glance</li>
        <li>Sign in on any device</li>
      </ul>
    </div>`;
  const cards = app.offerings.map((o) => {
    const days = offeredTrial(app, o);
    const trial = days > 0 ? ` <span class="tag">${days}-DAY TRIAL</span>` : '';
    const per = o.term.unit ? ` <small>/ ${esc(o.term.unit)}</small>` : ' <small>once</small>';
    // The highlight follows the TERM, never a position in the list. `year` is
    // the plan every surface leads with, and deriving it from `o.term` means
    // reordering the offerings cannot silently move the emphasis onto a SKU
    // nobody chose to lead with.
    const hi = o.term.heading === TERM_NAMES.get('year').heading ? ' hi' : '';
    return `    <div class="plan${hi}">
      <h3>${esc(o.term.heading)}${trial}</h3>
      <div class="price">${esc(o.amount)}${per}</div>
      <div class="sub">${esc(o.term.renews)}</div>
      <ul>
        <li>Everything in Free</li>
        <li>Renewal reminders before you are charged</li>
        <li>Budgets across all your subscriptions</li>
        <li>Export your data</li>
      </ul>
    </div>`;
  });
  return [free, ...cards].join('\n');
}

/** The plan-details table. */
export function pricingTable(app) {
  const head = '    <tr><th>Plan</th><th>Price</th><th>Billing</th><th>Free trial</th></tr>';
  if (app === null || app.offerings.length === 0) return head;
  const code = app.offerings[0].code;
  const rows = [`    <tr><td>Free</td><td>${esc(zero(code))}</td><td>&mdash;</td><td>&mdash;</td></tr>`];
  for (const o of app.offerings) {
    const billing = o.term.unit ? `Every ${esc(o.term.unit)}` : 'One-time payment';
    const days = offeredTrial(app, o);
    const trial = days > 0 ? `${days} days` : '&mdash;';
    rows.push(
      `    <tr><td>Pro ${esc(o.term.heading)}</td><td>${esc(o.amount)}</td><td>${billing}</td><td>${trial}</td></tr>`,
    );
  }
  return [head, ...rows].join('\n');
}

/**
 * Splice all three regions into the price list.
 *
 * 🔴 REFUSES on a missing or duplicated sentinel pair, exactly as `applyHomeGrid`
 * and `spliceRegion` do, and for the same reason: a splice that quietly does
 * nothing leaves a PRICE on a served page while every count still includes the
 * file. Deleting a marker must not become the way back to hand-maintaining a
 * number.
 *
 * @param {string} html `pricing.html` as it is on disk
 * @param {{slug: string, offerings: object[]}|null} app
 * @returns {string}
 */
export function applyPricing(html, app) {
  const bodies = new Map([
    ['meta', pricingMeta(app)],
    ['plans', pricingPlans(app)],
    ['table', pricingTable(app)],
  ]);
  let out = html;
  for (const region of PRICING_REGIONS) {
    const open = pricingOpen(region);
    const close = pricingClose(region);
    const opens = out.split(open).length - 1;
    const closes = out.split(close).length - 1;
    if (opens !== 1 || closes !== 1) {
      throw new Error(
        `${PRICING_PAGE}: expected exactly one ${open} ... ${close} pair, found ${opens} opening and ` +
          `${closes} closing sentinel(s). The price list's numbers are generated into that span from ` +
          `${RAIL_CONFIG}; without the pair the page would keep whatever price it last had while this ` +
          'generator still counted the file as written - which is the second-home defect this splice ends.',
      );
    }
    const start = out.indexOf(open);
    const end = out.indexOf(close);
    if (end < start) {
      throw new Error(
        `${PRICING_PAGE}: the PRICING:${region} sentinels are reversed, which would replace the rest of the document.`,
      );
    }
    out = `${out.slice(0, start + open.length)}\n${bodies.get(region)}\n${out.slice(end)}`;
  }
  return out;
}

// -----------------------------------------------------------------------------
// THE PER-APP BLOCKS - support.html's "Help for each app" list and about.html's
// app section, spliced from the registry
//
// 🔴 UNTIL 2026-09-25 BOTH WERE HAND-WRITTEN FOR ONE APP, AND NOTHING READ THEM.
// support.html named app #1's address, landing and privacy notice under "Help for
// each app"; about.html headed its section "Our first app" and called it "the only
// app we have published so far". Each is true of a catalogue with one live row and
// false the day a second row goes live, and no guard compared either page with the
// catalogue: check-site-integrity.mjs reads the HOMEPAGE grid against
// catalog/apps.json and nothing else. App #2 would have gone live with a support
// page that could not help its users.
//
// ⚠️ SPLICED, NOT REGENERATED, for the reason pricing.html is: the rest of each
// page is hand-written argument, and the smallest span that names an app is the
// only part a catalogue can know.
//
// ── WHICH APPS: THE ONE LIST THIS GENERATOR ALREADY LISTS ────────────────────
// `live` in `planDiscovery` - the usable registry entries whose status is `live`.
// The homepage grid, the hub, the sitemap, llms.txt and the route table read the
// same list. A second rule here would be a second answer to "which apps does this
// site list", and the two would disagree the first time they could.
//
// ── WHAT A ROW IS MADE OF ────────────────────────────────────────────────────
//   · `name`, `tagline`, `slug`, `url` - the catalogue row, verbatim. The tagline
//     REPLACES the sentence each page had typed for app #1: the catalogue carries
//     no longer description, and a per-slug sentence kept in this file would be
//     the hand-written table `LISTING_LABELS` was deleted for being.
//   · the open link - only when the row carries a `url`, the grid's rule. An apex
//     app path (`publicAppUrl(slug)`) is linked in its SLASHED form: the apex
//     router 301s `/<id>` to `/<id>/` (sites/nikatru/functions/_middleware.js),
//     and the hand-written pages already linked the form that answers first time.
//   · the privacy link - `privacyLinkFor` below.
//
// ── WHAT IT REFUSES TO INVENT ────────────────────────────────────────────────
//   · a count in words. The about heading is "Our first app" while the list has
//     one row and "Our apps" otherwise, and "the only app we have published so
//     far" is said only while one is the list's length. No number is typed.
//   · a privacy link to nothing. A live app with neither a per-app notice nor a
//     declared policy URL is a PROBLEM, not a row without the link: the support
//     page is where a user and a store reviewer look for it.
// -----------------------------------------------------------------------------
const SUPPORT_PAGE = `${DEPLOY_ROOT}/support.html`;
const ABOUT_PAGE = `${DEPLOY_ROOT}/about.html`;

/** The two pages' sentinel pairs. Same discipline as `HOME_GRID_OPEN`: exactly
 *  one pair per page, and a missing pair REFUSES. */
export const SUPPORT_APPS_OPEN = '<!-- SUPPORT-APPS -->';
export const SUPPORT_APPS_CLOSE = '<!-- /SUPPORT-APPS -->';
export const ABOUT_APPS_OPEN = '<!-- ABOUT-APPS -->';
export const ABOUT_APPS_CLOSE = '<!-- /ABOUT-APPS -->';

/** Where tooling/app-yaml/render-privacy.mjs writes an app's own notice, and the
 *  address the apex router serves it at (the static site wins where it HAS a
 *  file - sites/nikatru/functions/_middleware.js). */
export const appNoticeRel = (slug) => `${DEPLOY_ROOT}/${slug}/privacy.html`;
const appNoticeHref = (slug) => `/${slug}/privacy`;

/** The site's own brand where it leads an app's name, dropped from the notice
 *  label so it reads "Subscription Tracker privacy notice" as the page always has. */
const BRAND_LEAD = /^Nikatru\s+(?=\S)/;

/** The address the open link sends a visitor to. */
export function openHref(app) {
  return app.url === publicAppUrl(app.slug) ? new URL(appBaseHref(app.slug), APEX_ORIGIN).href : app.url;
}

/** The address as a reader sees it: no scheme, no trailing slash. */
const shownUrl = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** A tagline as a sentence: its own words, closed with a full stop when it has none. */
const asSentence = (s) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

const hasUrl = (app) => typeof app.url === 'string' && app.url !== '';

/**
 * The privacy link for one live app, or null after pushing the reason.
 *
 * 🔴 THE APP'S OWN NOTICE FIRST, AND THAT ORDER IS MEASURED. `app.yaml`'s
 * `legal.privacyPolicyUrl` is the STORE LISTING's privacy URL, and for app #1 it
 * is the portfolio policy (`https://nikatru.com/privacy`), not the per-app notice
 * the support page has always linked as "What this app collects".
 * render-privacy.mjs's header keeps the two apart on purpose. So an app the site
 * ships a notice for links that notice; an app it does not links the URL its
 * app.yaml declares; an app with neither is a problem.
 *
 * @returns {{href: string, label: string}|null}
 */
export function privacyLinkFor(repoRoot, app, problems) {
  if (existsSync(join(repoRoot, ...appNoticeRel(app.slug).split('/')))) {
    return { href: appNoticeHref(app.slug), label: `${app.name.replace(BRAND_LEAD, '')} privacy notice` };
  }
  const rel = `apps/${app.slug}/app.yaml`;
  let declared = null;
  try {
    declared = parseYaml(readFileSync(join(repoRoot, ...rel.split('/')), 'utf8'))?.legal?.privacyPolicyUrl ?? null;
  } catch (e) {
    if (e?.code !== 'ENOENT') {
      problems.push(`${rel} could not be read for its legal.privacyPolicyUrl (${e.message}), so ${SUPPORT_PAGE} has no privacy link for "${app.slug}".`);
      return null;
    }
  }
  if (typeof declared !== 'string' || !declared.startsWith('https://')) {
    problems.push(
      `${SUPPORT_PAGE} lists the live app "${app.slug}" and has no privacy link for it: ${appNoticeRel(app.slug)} ` +
        `does not exist and ${rel} declares no https legal.privacyPolicyUrl. Render the app's notice ` +
        '(node tooling/app-yaml/render-privacy.mjs) or declare the URL, then re-run this generator.',
    );
    return null;
  }
  const href = declared.startsWith(APEX_ORIGIN) ? `/${declared.slice(APEX_ORIGIN.length)}` : declared;
  return { href, label: 'Privacy Policy' };
}

/**
 * support.html's per-app list. Pure.
 *
 * @param {object[]} liveApps
 * @param {Map<string, {href: string, label: string}|null>} privacy by slug
 */
export function supportAppsBlock(liveApps, privacy = new Map()) {
  if (!liveApps.length) return '  <p>No app is published yet.</p>';
  return liveApps
    .map((app) => {
      const items = [];
      if (hasUrl(app)) {
        items.push(`Open the app: <a href="${esc(openHref(app))}" target="_blank" rel="noopener">${esc(shownUrl(app.url))}</a>`);
      }
      items.push(`What it does and how it works: <a href="/apps/${esc(app.slug)}">${esc(app.name)}</a>`);
      const link = privacy.get(app.slug);
      if (link) items.push(`What this app collects: <a href="${esc(link.href)}">${esc(link.label)}</a>`);
      return [
        `  <h3>${esc(app.name)}</h3>`,
        `  <p>${esc(asSentence(app.tagline))}</p>`,
        '  <ul>',
        ...items.map((i) => `    <li>${i}</li>`),
        '  </ul>',
      ].join('\n');
    })
    .join('\n');
}

/** about.html's app section, heading included - the heading is the part that
 *  depends on the list's length. Pure. */
export function aboutAppsBlock(liveApps) {
  const heading = `  <h2>${liveApps.length === 1 ? 'Our first app' : 'Our apps'}</h2>`;
  if (!liveApps.length) return `${heading}\n  <p>No app is published yet.</p>`;
  const paras = liveApps.map((app) => {
    const lines = [`  <p><b>${esc(app.name)}</b> &mdash; ${esc(asSentence(app.tagline))}`];
    if (hasUrl(app)) {
      lines.push(
        `  It is live on the web now at <a href="${esc(openHref(app))}" target="_blank" rel="noopener">${esc(shownUrl(app.url))}</a>.`,
      );
    }
    if (liveApps.length === 1) lines.push('  It is the only app we have published so far.');
    return `${lines.join('\n')}</p>`;
  });
  return [heading, ...paras].join('\n');
}

/**
 * Splice `body` into `html` between one sentinel pair.
 *
 * 🔴 REFUSES on a missing, duplicated or reversed pair, exactly as
 * `applyHomeGrid` does: a splice that quietly does nothing leaves the page naming
 * whichever apps it last named while this generator counts the file as written.
 */
export function applyAppsBlock(html, page, open, close, body) {
  const opens = html.split(open).length - 1;
  const closes = html.split(close).length - 1;
  if (opens !== 1 || closes !== 1) {
    throw new Error(
      `${page}: expected exactly one ${open} … ${close} pair, found ${opens} opening and ${closes} closing ` +
        "sentinel(s). The page's per-app block is generated into that span from the registry; without it the " +
        'page would keep naming whichever apps it last named while this generator counted the file as written.',
    );
  }
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (end < start) {
    throw new Error(`${page}: the ${open} sentinels are reversed, which would replace the rest of the document.`);
  }
  return `${html.slice(0, start + open.length)}\n${body}\n${html.slice(end)}`;
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

  // The two sources beyond the registry, read ONCE for the whole run: the rail
  // config every landing prices itself from, and whether this deploy root
  // actually ships the price list a landing would otherwise link into a 404.
  const ctx = {
    repoRoot,
    rail: readRailConfig(repoRoot, problems),
    pricingPage: existsSync(join(repoRoot, ...PRICING_PAGE.split('/'))),
    channels: readChannelRegister(repoRoot, problems),
  };

  const live = usable.filter((a) => a.status === 'live');
  for (const app of usable) {
    files.set(`${APPS_DIR}/${app.slug}.html`, landingHtml(app, ctx, problems));
  }
  files.set(`${APPS_DIR}/index.html`, hubHtml(live));

  // ── SHARED CHROME ON THE HAND-MAINTAINED PAGES ────────────────────────────
  //
  // The two landings above are written whole by this generator. The other pages
  // under the deploy root are hand-maintained 3-33 KB documents, and moving their
  // bodies in here to obtain one shared footer would trade a small duplication
  // for a very large one. They are SPLICED instead: this reads each page, replaces
  // only what sits between the chrome sentinels, and puts the result in `files` —
  // where limb A of assert-discovery-surface.mjs byte-compares it exactly as it
  // already does for the generated pair. Page content stays hand-written; chrome
  // stops being.
  //
  // The set is DERIVED from the same `htmlUnder` walk the sitemap uses, so a page
  // added to the deploy root is in the chrome contract the moment it exists.
  // `chrome.mjs`'s CHROME_EXCLUDED is the only way out, and it costs a written
  // reason.
  //
  // 🔴 A PAGE THAT CANNOT BE SPLICED IS A PROBLEM, NOT A SKIP. `applyChrome`
  // throws when a sentinel pair is missing, duplicated or reversed; catching it
  // into `problems` turns it into a named build failure. Silently passing over
  // such a page is the one way this design rots without anything going red —
  // the page keeps serving stale chrome while the file count still includes it.
  // ── THE APEX ROUTE TABLE ──────────────────────────────────────────────────
  // 🔴 `sites/nikatru/app-routes.json` IS THE ROUTER'S ONLY INPUT. Since
  // [ADR 075] an app is published at `nikatru.com/<id>`, and
  // `sites/nikatru/functions/_middleware.js` proxies that prefix to the app's own
  // Cloudflare Pages project. This table is what tells it which prefix and which
  // project — one row per LIVE catalogue entry, both halves read verbatim from
  // `catalog/apps.json` (`slug` and `origin`), so app #2 becomes routable by
  // existing in the catalogue and by nothing else. No workflow edit, no DNS
  // record, no Cloudflare console step, no hand-maintained list.
  //
  // ⚠️ IT IS COMMITTED, and it has to be: the `nikatru` Pages project is
  // Git-connected with NO BUILD STEP (`sites/nikatru/README.md`), so a file that
  // is not in the repository is a file that is not deployed. What keeps a
  // committed generated file honest is the lane that already exists —
  // `site-drift-repair.yml` regenerates this surface on every merge to `main` and
  // opens a self-merging PR when the committed bytes drift.
  //
  // ⚠️ ONLY `live` ENTRIES. A `preview` app has no Pages project attached yet, so
  // routing its prefix would proxy the apex to a host that answers 522 — and it
  // would do it on the same origin that serves /pricing and the legal archive.
  // The same filter the hub and the sitemap already apply, for a sharper reason.
  //
  // The bytes use this repository's catalogue house style (see `serialise` in
  // tooling/app-yaml/render.mjs and the note in generate-apps-data.mjs) so a
  // byte-comparison in CI is comparing formatting nobody has to think about.
  {
    const routes = live
      .filter((app) => typeof app.origin === 'string' && app.origin.startsWith('https://'))
      .map((app) => ({ path: `/${app.slug}`, origin: app.origin }));
    const missing = live.filter((app) => typeof app.origin !== 'string' || !app.origin.startsWith('https://'));
    for (const app of missing) {
      problems.push(
        `${REGISTRY}: live entry "${app.slug}" has no https \`origin\`, so the apex router has nowhere to ` +
          'proxy `/' + app.slug + '` and the app would 404 into the marketing 404. `origin` is rendered from ' +
          '`hosts.pagesOrigin` (or `hosts.web`) by tooling/app-yaml/render.mjs.',
      );
    }
    const body = routes.length === 0
      ? '[]'
      : `[\n${routes
          .map((r) => `  { "path": ${JSON.stringify(r.path)}, "origin": ${JSON.stringify(r.origin)} }`)
          .join(',\n')}\n]`;
    files.set(APP_ROUTES, `${body}\n`);
  }

  const chromeOnly = new Set();
  for (const rel of htmlUnder(repoRoot, DEPLOY_ROOT)) {
    if (!isChromePage(rel) || files.has(rel)) continue; // the generated pair already carries the regions
    try {
      let out = applyChrome(readFileSync(join(repoRoot, ...rel.split('/')), 'utf8'));
      // The homepage takes ONE more spliced region than the rest: its app grid,
      // which used to be built in the browser. See `applyHomeGrid` above.
      if (rel === HOME_PAGE) out = applyHomeGrid(out, live, ctx.channels);
      // ... and the price list takes THREE more, for the prices themselves. See
      // `applyPricing` above for why a hand-written page is spliced rather than
      // generated, and why leaving those four numbers hand-maintained was a
      // defect no guard in this repository could see.
      if (rel === PRICING_PAGE) out = applyPricing(out, pricedApp(ctx, live, problems));
      // ... and the support and about pages take one each, for the apps they
      // name. See `supportAppsBlock` above for why the list is `live`.
      if (rel === SUPPORT_PAGE) {
        const privacy = new Map(live.map((app) => [app.slug, privacyLinkFor(repoRoot, app, problems)]));
        out = applyAppsBlock(out, rel, SUPPORT_APPS_OPEN, SUPPORT_APPS_CLOSE, supportAppsBlock(live, privacy));
      }
      if (rel === ABOUT_PAGE) out = applyAppsBlock(out, rel, ABOUT_APPS_OPEN, ABOUT_APPS_CLOSE, aboutAppsBlock(live));
      files.set(rel, out);
      chromeOnly.add(rel);
    } catch (e) {
      problems.push(`${rel}: ${e.message}`);
    }
  }

  // ── script-src: HASHES, NOT `'unsafe-inline'` ─────────────────────────────
  // 🔴 THE HIGHEST-PRIORITY SECURITY ITEM OF [ADR 075], AND IT IS ONLY URGENT
  // BECAUSE OF [ADR 075]. `script-src 'unsafe-inline'` was a survivable weakness
  // while this origin served nothing but marketing copy. It is not one now: the
  // app is published at `nikatru.com/<id>`, its Supabase bearer token lives in
  // origin-shared web storage, and `'unsafe-inline'` means any injected `<script>`
  // on ANY page of this origin executes — including on the pages that have never
  // had a script of their own. One XSS anywhere on the apex reads every app's
  // session. Under the old subdomain layout that same XSS was contained to one app.
  //
  // The replacement is a `'sha256-…'` per inline block. Hashes also make the
  // directive SELF-ENFORCING in a way a keyword never is: a CSP that carries any
  // hash makes browsers IGNORE `'unsafe-inline'`, so the two cannot quietly
  // coexist, and an inline block whose bytes change without this generator
  // running simply stops executing.
  //
  // ⚠️ IT IS GENERATED, AND IT HAS TO BE. Three of the inline blocks on this root
  // live in pages this file WRITES (`apps/index.html`, `apps/<slug>.html`) and the
  // rest are chrome-spliced by the block above, so a hand-maintained hash list
  // would go stale on the next generator change — silently, because a stale hash
  // does not error, it just refuses to run the script. Computing it HERE, from the
  // planned bytes rather than the bytes on disk, is what keeps the header and the
  // pages in the same commit. `site-drift-repair.yml` diffs the result.
  //
  // ⚠️ ORDER MATTERS: this runs AFTER the chrome splice, because splicing can move
  // an inline block. Hashing the on-disk bytes would produce a header that is
  // correct for the previous deploy.
  //
  // Inline EVENT HANDLERS (`onclick=`) and `javascript:` URLs are NOT covered by
  // hashes — they need `'unsafe-hashes'`, which this root must never acquire.
  // Measured 2026-09-09: this deploy root has ZERO of either. The `problems` push
  // below is what keeps that a measurement rather than a memory.
  {
    const headersRel = `${DEPLOY_ROOT}/_headers`;
    const headersPath = join(repoRoot, ...headersRel.split('/'));
    // ⚠️ AN ABSENT `_headers` IS NOT THIS GENERATOR'S FINDING, and that is a
    // scoping decision rather than a shrug. This block SPLICES one directive
    // line into a file it does not own — it has no business creating the file,
    // and a root with no header policy at all is a different, larger defect with
    // a guard of its own: `assert-web-cache-policy.mjs` floors every static-site
    // bundle on its entry-point rules and goes RED when `_headers` is gone
    // (MEASURED 2026-09-09 by deleting it: exit 1, naming `/` and `/*.html`).
    // Claiming it here as well would make every fixture root in
    // `tooling/ci/test/discovery-surface.test.mjs` fail for a reason that test is
    // not about, which is how a generator acquires opinions nobody asked it for.
    if (existsSync(headersPath)) {
      const pages = new Set([...htmlUnder(repoRoot, DEPLOY_ROOT), ...[...files.keys()].filter((k) => k.endsWith('.html'))]);
      const hashes = new Set();
      for (const rel of [...pages].sort()) {
        const html = files.has(rel)
          ? files.get(rel)
          : (existsSync(join(repoRoot, ...rel.split('/'))) ? readFileSync(join(repoRoot, ...rel.split('/')), 'utf8') : null);
        if (html === null) continue;
        if (INLINE_HANDLER_RE.test(html)) {
          problems.push(
            `${rel} carries an inline event handler or a javascript: URL. A CSP hash cannot cover either, so ` +
              "this page would need `'unsafe-hashes'` — which reopens the hole this directive exists to close. " +
              'Move the handler into one of the page\'s <script> blocks.',
          );
        }
        for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
          if (m[1].trim() !== '') hashes.add(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
        }
      }
      const scriptSrc = `script-src 'self'${[...hashes].sort().map((h) => ` ${h}`).join('')}`;
      const current = files.get(headersRel) ?? readFileSync(headersPath, 'utf8');
      const next = current.replace(CSP_LINE_RE, (line) => line.replace(/script-src [^;]*/, scriptSrc));
      if (next === current && !current.includes(scriptSrc)) {
        problems.push(
          `${headersRel}: no Content-Security-Policy line with a script-src directive was found, so the hash ` +
            'list this run computed has nowhere to go. The header is spliced, not written whole — see the block ' +
            'in generate-discovery.mjs that computes it.',
        );
      }
      files.set(headersRel, next);
    }
  }

  // The page set is the UNION of what is on disk and what this run plans, so a
  // brand-new landing joins the sitemap in the same run that creates it, and a
  // stale landing that no registry entry owns stays listed for exactly as long
  // as it is served. (That stale page is limb B of assert-discovery-surface.mjs
  // — reported once, there, naming the file.)
  //
  // ⏱ 2026-09-26 · D3b (ADR 028 §3 as amended by ADR no.098): the sitemap is
  // GENERATED IN THE JOB AND NEVER COMMITTED, so a fresh checkout has none. It is rendered
  // WHOLE from the page set below — no byte of a previous copy is read — so it is written
  // whether or not one is on disk. Until today a missing sitemap was a problem here,
  // which was only true while the file was committed.
  {
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
      // The served auth mail bodies are fragments that cannot carry a robots
      // meta (their bytes must equal the template source); their noindex is the
      // `/auth-mail/*` X-Robots-Tag in _headers. Left out by the one prefix
      // gen-auth-mail.mjs owns, which check-site-integrity.mjs reads too.
      if (isAuthMailPath(rel)) continue;
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
          'named no app while subscriptiontracker was live and answering.',
      );
    } else {
      files.set(LLMS, next);
    }
  }

  // `chromeOnly` is the set this generator SPLICES rather than writes whole. The
  // distinction is load-bearing for assert-discovery-surface.mjs: limbs C and D
  // assert properties of a page this generator AUTHORED (no unfilled slots, a
  // JSON-LD block on every page). A hand-written 33 KB document that merely
  // receives a shared footer owes neither, and grading it against them reported
  // twelve problems about pages that were entirely correct.
  return { files, registry, live, problems, chromeOnly };
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
    // READ ONCE (CodeQL #90): the write is decided on the bytes read, not on a separate
    // existence check. The directory was just created, so ENOENT is the only "absent".
    let prior = null;
    try {
      prior = readFileSync(abs, 'utf8');
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
    }
    if (prior !== contents) {
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
