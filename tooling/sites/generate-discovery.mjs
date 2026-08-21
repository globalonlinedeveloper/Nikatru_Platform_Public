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
// `sites/nikatru/apps/_template.html:76` says `"priceCurrency": "INR"` while
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
 *  uses. `assert-purchase-path.mjs:271` maps the SAME three ids to day counts
 *  for [5]M-8's revocation bound, so this is not a second vocabulary — it is the
 *  human rendering of the one that exists. An unknown term FAILS: "term":
 *  "quarter" rendered as "/ quarter" would be a billing-frequency claim made by
 *  a fallback branch. */
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
  .trial{display:inline-block;background:var(--teal);color:#04231C;font-size:11px;font-weight:800;letter-spacing:.06em;padding:3px 9px;border-radius:99px;margin-bottom:8px}
  .note{background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);padding:16px 20px;color:var(--muted);font-size:15px;margin-top:16px}
  .note p{margin:0;font-size:15px}
  .note p+p{margin-top:8px}
  .privacy{background:var(--soft);border:1px solid var(--line);border-radius:var(--radius);padding:22px 24px;margin-top:8px}
  .privacy b{color:var(--strong)}
  .privacy p{color:var(--muted);font-size:15px;margin:6px 0 0}
  .privacy ul{margin:10px 0 0 20px}
  .privacy li{color:var(--muted);font-size:15px;margin-bottom:6px}
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
  <a href="/">Home</a> &middot; <a href="/apps/">Apps</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/refund">Refunds</a> &middot; <a href="/delete-account">Delete account</a> &middot; <a href="/contact">Contact</a><br><br>
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
  // `offerings[0].code` dereferencing undefined. Found by emptying subly's
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
${o.trialDays ? `          <span class="trial">${o.trialDays}-DAY FREE TRIAL</span>\n` : ''}          <div class="amount">${o.amount}${o.term.unit ? ` <small>/ ${esc(o.term.unit)}</small>` : ''}</div>
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
${ledeParagraphs}      <p>${studioLine}</p>
      <p>${platformSentence}</p>
${statusNote}    </div>
  </section>
${featureSection}${pricingSection}
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

  // The two sources beyond the registry, read ONCE for the whole run: the rail
  // config every landing prices itself from, and whether this deploy root
  // actually ships the price list a landing would otherwise link into a 404.
  const ctx = {
    repoRoot,
    rail: readRailConfig(repoRoot, problems),
    pricingPage: existsSync(join(repoRoot, ...PRICING_PAGE.split('/'))),
  };

  const live = usable.filter((a) => a.status === 'live');
  for (const app of usable) {
    files.set(`${APPS_DIR}/${app.slug}.html`, landingHtml(app, ctx, problems));
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
