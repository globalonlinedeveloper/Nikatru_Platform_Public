#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// SHARED SITE CHROME — the parts that are supposed to be the same on every page,
// written once here and spliced into the tree by tooling/sites/generate-discovery.mjs.
//
// ── WHAT WENT WRONG WITHOUT IT, MEASURED 2026-08-21 ──────────────────────────
//
// The footer had drifted into SIX distinct blocks across the twelve non-snapshot
// pages, and a thirteenth page (`404.html`) had none at all. `md5` of the
// `<footer>` element, before this file existed:
//
//     e98b2a71  apps/_template.html
//     ae6331b0  apps/index.html · apps/subscriptiontracker.html
//     19aceea8  checkout-return.html · contact.html · delete-account.html · pricing.html
//     e8fb5136  index.html
//     ce153a78  privacy.html
//     f9143f84  refund.html · terms.html
//     (none)    404.html
//
// 🔴 AND THE DRIFT WAS NOT COSMETIC. Three axes had come apart, and each one had
// already produced a real defect:
//
//   1. THE LINK SET. `privacy.html` was the ONE page whose footer did not link
//      `/delete-account` — and it is the page a Play reviewer opens to verify the
//      deletion route that `apps/subscriptiontracker/store/android-play/data-safety.json`
//      declares as `webDeletionUrl`. The claim and the way to reach it had been
//      separated by nothing more than a footer someone edited in isolation.
//   2. THE LEGAL IDENTITY LINE. The four `apps/*` footers carried no UDYAM
//      registration number while the other seven did.
//   3. THE CSS. `padding` was 34px on the homepage and 28px elsewhere, font-size
//      13.5px vs 13px, `background` written as `var(--ink)` on some pages and the
//      literal `#0B1220` on others. A palette guard cannot see that last one —
//      the literal IS the token's value, so it compares equal.
//
// A single footer emitted from one place closes all three at once, which is the
// whole argument for this file. It is not tidiness: it is that a hand-maintained
// copy is a copy that will differ, and the difference is discovered by a store
// reviewer rather than by a guard.
//
// ── HOW IT REACHES THE PAGES ─────────────────────────────────────────────────
//
// By SPLICING between sentinels, not by regenerating whole pages, and that choice
// is deliberate. `sites/nikatru/index.html` alone is 32 KB of hand-written body
// copy; moving every page's content into a generator to get one shared footer
// would trade a small duplication for a large one. The research brief that asked
// for this called it "the lightest fix" and named the constraint directly: no
// Cloudflare build step, and no Eleventy layer revived.
//
// Each participating page carries a matched pair of sentinel comments. The
// generator replaces what is BETWEEN them and leaves the rest of the file exactly
// as it found it, so page content stays hand-maintained and chrome does not.
// `tooling/ci/assert-discovery-surface.mjs` then re-runs the splice in CI and
// byte-compares, which is the same guarantee the two fully-generated app pages
// already had.
//
// 🔴 A MISSING SENTINEL PAIR IS A HARD FAILURE, NEVER A SKIP. That is the one way
// this design can rot silently: delete the markers and the page quietly stops
// receiving chrome while every guard goes on printing a count. `spliceRegion`
// refuses, and `chrome-splice.test.mjs` has the failing case recorded.
// ─────────────────────────────────────────────────────────────────────────────
import { AUTH_MAIL_SERVED_DIR, AUTH_MAIL_TEMPLATES } from './gen-auth-mail.mjs';

/** The deploy root this chrome belongs to. `sites/rajasekarselvam` is a separate
 *  brochure site with its own identity and is deliberately NOT a member — it is
 *  a different legal person's shop window, not a second Nikatru page. */
export const CHROME_ROOT = 'sites/nikatru';

/** The three dated policy snapshots under `legal/`. Frozen consent records — the
 *  same set `assert-palette-consistent.mjs` excludes, for the same reason: a
 *  dated archive that gets edited is no longer a record of what was served. */
export const SNAPSHOT_PREFIX = 'sites/nikatru/legal/';


/**
 * Every served `.html` under `CHROME_ROOT` that must NOT receive shared chrome,
 * with the reason. NAMED, not matched by pattern — each of these is a decision
 * somebody made, and a reader who finds one of these files carrying a footer of
 * its own is owed the reason rather than left to assume drift.
 *
 * This is the ONLY way out of the chrome contract, and it costs a written reason.
 * `assert-discovery-surface.mjs` fails if an entry here names a page that is no
 * longer served, so an exemption cannot outlive its subject unexamined.
 */
export const CHROME_EXCLUDED = new Map([
  [
    'sites/nikatru/apps/_template.html',
    'the placeholder CANARY that assert-discovery-surface.mjs allowlists BY NAME. It is served, it is ' +
      'correctly noindex, and the owner has ruled explicitly that this arrangement is deliberate and is ' +
      'not to be "fixed". Splicing chrome into it would edit a file whose whole job is to sit still, so ' +
      'its footer remains a variant ON PURPOSE. Reversible: delete this entry.',
  ],
  [
    'sites/nikatru/fullshot/privacy.html',
    'a MIRRORED LEGAL DOCUMENT whose source of truth is extensions/Extension/' +
      'Full_Screen_Shot/publish/PRIVACY-POLICY.html. Its <footer> is not site chrome — it is the ' +
      "document's own publisher identification, part of the text a store reviewer is reading. Splicing " +
      'site navigation over it would both edit a legal document and widen a divergence between the two ' +
      'copies. (Repointed 2026-09-06: the source used to live in the separate repository ' +
      'Nikatru_Extensions_Public, which was merged into this one on 2026-09-05 under [ADR 067] ' +
      'decision 1 and then DELETED on GitHub. The divergence is therefore no longer CROSS-REPO ' +
      'and is now something a guard in this repository can see.) The cost is that this page carries no site navigation; ' +
      'that is recorded as a known gap, not an oversight.',
  ],
  // One entry per served auth mail template, NAMED (each key is a real file),
  // derived from the one list in gen-auth-mail.mjs so a fourth template cannot
  // be served without its exemption, or keep an exemption after it is gone.
  ...AUTH_MAIL_TEMPLATES.map((t) => [
    `${AUTH_MAIL_SERVED_DIR}/${t.file}`,
    'a MAIL BODY, not a page: self-hosted GoTrue fetches it from this URL (GOTRUE_MAILER_TEMPLATES_*) and ' +
      'sends its bytes as the email. It is a byte copy of docs/platform/supabase/email-templates/' +
      `${t.file}, written by tooling/sites/gen-auth-mail.mjs and held equal by ` +
      'tooling/ci/assert-supabase-templates.mjs. Splicing site chrome into it would change the mail every ' +
      'user receives and break that equality. It is a fragment (no <head>), so it cannot carry a robots ' +
      'meta: sites/nikatru/_headers sends X-Robots-Tag: noindex for /auth-mail/*, and the sitemap and ' +
      'check-site-integrity.mjs leave the path out by the same prefix.',
  ]),
]);


/**
 * Is this served page one that receives shared chrome?
 *
 * 🔴 DERIVED FROM THE TREE, NOT A HARDCODED LIST, and the first version of this
 * file got that wrong. A literal `CHROME_PAGES = [...]` has to be kept in step by
 * hand, which is the same failure mode as the six hand-maintained footers it was
 * written to replace — and it made every fixture in the test suite responsible for
 * reproducing an eleven-entry list it had no other reason to know about (40 tests
 * went red proving it).
 *
 * Derived, the property is stronger, not weaker: a page added to the deploy root
 * tomorrow is IN the contract the moment it exists, so it must either carry the
 * sentinels or be named in CHROME_EXCLUDED with a reason. There is no third state
 * in which a new page quietly grows a footer of its own.
 *
 * @param {string} rel repo-relative, POSIX-separated, under CHROME_ROOT
 */
export function isChromePage(rel) {
  if (!rel.startsWith(`${CHROME_ROOT}/`) || !rel.toLowerCase().endsWith('.html')) return false;
  if (rel.startsWith(SNAPSHOT_PREFIX)) return false;
  return !CHROME_EXCLUDED.has(rel);
}

// ── THE CHROME ITSELF ────────────────────────────────────────────────────────

/**
 * The one footer.
 *
 * The link set is the UNION of the six that existed, which is how `/pricing`
 * reaches the pages that had lost it and `/delete-account` reaches `privacy.html`.
 * The identity line is the LONGEST of the six, so no page loses a claim it used
 * to make: `index.html` was the only page carrying the developer credit and the
 * "Registered MSME" wording, and both now appear everywhere rather than being
 * dropped to reach a lowest common denominator.
 *
 * 🔴 NO `<b>` IN THE FOOTER, and that is a correctness constraint rather than a
 * style choice. `assert-policy-claims.mjs` reads every `<b>`/`<strong>` span in
 * the visible text of a LEGAL page as a published CLAIM that owes a row in
 * tooling/legal/policy-claims.json — reasonably, because an emphasised sentence
 * on a policy page is a promise. The first version of this footer bolded the
 * company and developer names for colour alone, and immediately registered EIGHT
 * false claims across the four legal pages. `.foot-em` gets the identical white
 * from the shared CSS below without asserting anything.
 *
 * Deliberately otherwise class-light. The homepage version used `.wrap`, `.foot-links` and
 * `.foot-dev`, none of which the other ten pages define — emitting those classes
 * site-wide would have rendered unstyled everywhere they were absent, which is
 * exactly the kind of "it looked fine on the page I tested" failure that produced
 * six footers in the first place.
 */
export function footer() {
  return `<footer>
  <a href="/">Home</a> &middot; <a href="/apps/">Apps</a> &middot; <a href="/pricing">Pricing</a> &middot; <a href="/about">About</a> &middot; <a href="/support">Support</a> &middot; <a href="/contact">Contact</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/refund">Refunds</a> &middot; <a href="/shipping">Shipping</a> &middot; <a href="/delete-account">Delete account</a><br><br>
  <span class="foot-em">Nikatru&trade;</span> &middot; Chennai, Tamil Nadu, India &middot; Registered MSME UDYAM-TN-02-0487004<br>
  Developed by <a href="https://rajasekarselvam.com" target="_blank" rel="noopener"><span class="foot-em">Rajasekar Selvam</span></a><br>
  &copy; 2026 Nikatru. All rights reserved.
</footer>`;
}

/**
 * The footer's styling, emitted with it.
 *
 * 🔴 THE CSS IS CHROME TOO, and leaving it behind was the third axis of the drift
 * above. A shared footer with eleven private stylesheets is still eleven footers
 * to a reader; it only looks unified in the markup.
 *
 * `display:inline-block;padding:4px 0` on the links is a TARGET-SIZE fix, not
 * spacing taste. Measured in a 375px viewport with the first version of this
 * footer: all nine links rendered 18px tall, under the 24x24 CSS px minimum
 * WCAG 2.2 SC 2.5.8 (Level AA) sets. The padding takes them to 26px. It is one
 * line and it reaches eleven pages, which is the argument for this file stated
 * as concretely as it can be — the same repair against six hand-maintained
 * footers would have been six edits, and the seventh page had no footer to fix.
 *
 * `var(--ink)` and not the literal `#0B1220`: they are the same colour today, and
 * `assert-palette-consistent.mjs` therefore cannot tell them apart — which is
 * precisely why the literal must not be the thing that ships. Every page in
 * CHROME_PAGES was measured to declare `--ink` before this was written.
 */
export function footerCss() {
  return `  footer{background:var(--ink);color:#8FA0BC;text-align:center;padding:28px 24px;font-size:13px;line-height:1.9}
  footer .foot-em{color:#fff}
  footer a{color:#B6C2D9;text-decoration:none;margin:0 7px;display:inline-block;padding:4px 0}
  footer a:hover{color:#fff}`;
}

/**
 * The skip link, and it is the FIRST thing in the body for a reason.
 *
 * WCAG 2.2 SC 2.4.1 (Bypass Blocks, Level A). Every page on this site opens with
 * the same sticky nav, so a keyboard or screen-reader user tabs through the whole
 * of it before reaching a word of content, on every page, every time.
 *
 * Measured before this existed: ONE of the eleven pages had a skip link
 * (`index.html`), and it is the page a visitor is least likely to be deep-linked
 * into. The other ten — including all four legal pages a store reviewer opens —
 * had none.
 *
 * `href="#main"` is a contract with the page: the target id must exist, or the
 * link is worse than absent because it silently does nothing. Limb G of
 * assert-discovery-surface.mjs resolves it per page.
 */
export function skipLink() {
  return '<a class="skip-link" href="#main">Skip to content</a>';
}

/**
 * THE NON-COLOUR SCALE TOKENS, on every page, read out of the ONE file that
 * emits them.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────────
 * The colour palette has been one language since PR #322 — thirteen tokens, an
 * inline `:root` per page, and `assert-palette-consistent.mjs` holding the copies
 * equal. Everything that is NOT a colour had no such treatment: measured
 * 2026-09-09 across the served pages, NINE distinct corner radii were in use
 * (8, 10, 11, 12, 13, 14, 16, 18, 999), spacing was a per-page literal, and the
 * type sizes existed only as numbers inside rules. A palette guard is structurally
 * blind to all of it, because a literal is not a custom property — so the drift
 * could not be seen, let alone measured.
 *
 * `contracts/tokens/dtcg/scale.json` gives those values names. This function is
 * what puts the names on the pages, which is the half that makes them real: a
 * token nothing declares is a token nothing can use.
 *
 * ── WHY IT IS A CONSTANT AND NOT A READ OF tokens.css ────────────────────────
 * 🔴 BECAUSE THIS MODULE GETS COPIED, AND A COPY LOSES ITS DATA. The first
 * version read `contracts/tokens/dtcg/scale.json` and
 * `sites/_shared/assets/tokens.css` off disk, resolved from this file's own
 * location. That is correct in the repository and WRONG the moment the module is
 * copied — and it is copied routinely: render-payload.test.mjs materialises the
 * whole tooling closure into a temp root to mutate one of its members, and
 * assert-guards-refuse-empty.mjs copies its subjects for the same reason (a guard
 * pointed at a fixture root re-scanned the real repository instead; twenty of
 * them did). In a copied tree the reads throw ENOENT, and the failure surfaces as
 * a module error inside a case that was testing something else entirely.
 *
 * So the values live here, as bytes, and the emitter stays the authority a GUARD
 * compares them to rather than one they are fetched from.
 *
 * ── WHAT KEEPS IT HONEST, AND IT IS NOT A COMMENT ────────────────────────────
 * `tooling/ci/assert-palette-consistent.mjs` compares every CSS custom property
 * declared by two or more sources across the whole site, and BOTH sides of this
 * are in its subject: `sites/_shared/assets/tokens.css` (a named member of
 * MUST_COMPARE) and the 15 pages that carry this region spliced into their
 * `:root`. So a value that drifts from the build is 15 sources against 1 and the
 * guard names the property, the two values and every file — which is exactly the
 * mechanism that already keeps the colour palette in step, applied to the scales.
 *
 * Negative-tested, not assumed: `--space-5` changed here from 24px to 25px,
 * regenerated, and assert-palette-consistent exits 1 with "--space-5 is declared
 * 2 different ways in the light palette". Restored and re-verified clean.
 *
 * TO CHANGE A VALUE: edit contracts/tokens/dtcg/scale.json, run
 * `cd packages/tokens && npm run build`, copy the emitted `--group-name` lines
 * from sites/_shared/assets/tokens.css into the constant below, and re-run
 * tooling/sites/generate-discovery.mjs. The guard fails if you do only some of it.
 */
const SCALE_CSS = `  --space-1:4px;
  --space-2:8px;
  --space-3:12px;
  --space-4:16px;
  --space-5:24px;
  --space-6:32px;
  --space-7:48px;
  --space-gutter-sm:18px;
  --space-gutter:24px;
  --space-gutter-lg:32px;
  --radius-sm:8px;
  --radius-md:12px;
  --radius-xl:22px;
  --radius-pill:999px;
  --type-xs:12.5px;
  --type-sm:13.5px;
  --type-body:16px;
  --type-lead:18px;
  --type-h3:24px;
  --type-h2:31px;
  --type-display:clamp(34px, 5.5vw, 58px);
  --shadow-sm:0 6px 16px rgba(11, 18, 32, .06);
  --shadow-base:0 12px 32px rgba(11, 18, 32, .10);
  --shadow-lg:0 16px 40px rgba(11, 18, 32, .14);
  --motion-fast:120ms;
  --motion-base:220ms;
  --motion-ease:cubic-bezier(.2, .6, .3, 1);
  --focus-ring:3px;
  --focus-offset:3px;
  --focus-scroll-margin:84px;
  --container-max:1080px;
  --container-gutter:24px;`;

export function scaleCss() {
  return SCALE_CSS;
}

/**
 * The status mark, on every page, from the ONE string that declares it.
 *
 * See `MARK_CSS` in tooling/sites/availability.mjs for why it is emitted as
 * chrome rather than declared beside each of its two uses: the mark appears
 * labelled inside an availability tile and bare in the homepage register row,
 * and two rule sets for one mark would drift with nothing able to see it — a CSS
 * rule is not a custom property, so the palette guard is blind to it.
 */
/**
 * THE STATUS MARK. It lives HERE, in the shared-chrome module, and not beside
 * the availability tiles that were its first use.
 *
 * A filled teal square means LIVE; a dashed muted outline means COMING SOON.
 * That is the whole visual state device this design uses in place of a row of
 * coloured store badges — and it appears at two densities: labelled, inside an
 * availability tile on an app landing, and bare, in the homepage register row
 * beside the sentence "1 of 6 channels live".
 *
 * 🔴 TWO DENSITIES OF ONE MARK MUST NOT BE TWO RULE SETS. If the homepage
 * declared its own `.mark`, the two would drift — by a pixel, by a radius, by a
 * colour — and NOTHING in this repository could see it: `assert-palette-
 * consistent.mjs` compares CSS CUSTOM PROPERTIES, and `width:9px` is not one.
 * That is the same blind spot that let nine different corner radii accumulate
 * across the served pages. So the mark is emitted ONCE, as the shared
 * `marks-css` chrome region, onto every page — the identical mechanism that
 * replaced six hand-maintained footers.
 *
 * ⚠️ EVERY VALUE IS A TOKEN OR A LITERAL THAT IS SCHEME-INDEPENDENT. `--teal`
 * and `--muted` both fork under `prefers-color-scheme`, so the mark follows the
 * scheme without this string knowing anything about schemes. A hex here would be
 * the light-mode-hex-in-dark defect the design canvas was corrected for.
 *
 * ⚠️ AND THE MARK NEVER CARRIES THE MEANING ALONE. WCAG 1.4.1: on a tile the
 * word "Coming soon" sits beside it, and in the compact homepage row the marks
 * are `aria-hidden` and the count sentence carries the fact in words. A reader
 * who cannot distinguish a filled square from a dashed one loses nothing.
 */
const MARK_CSS = `  .mark{width:9px;height:9px;flex:0 0 auto;border-radius:2px;display:inline-block}
  .mark-served{background:var(--teal)}
  .mark-soon{background:transparent;border:1.5px dashed var(--muted)}
  .marks{display:inline-flex;gap:5px;align-items:center}`;

export function marksCss() {
  return MARK_CSS;
}

/**
 * The accessibility chrome that has to be present on every page to be worth
 * anything: a visible focus ring, and the skip link's own styling.
 *
 * 🔴 `:focus-visible` WAS ON FOUR OF ELEVEN PAGES. A focus indicator is not a
 * nicety on a site whose primary CTA on seven pages is a link — without it a
 * keyboard user cannot tell where they are, which is WCAG 2.2 SC 2.4.7 (Focus
 * Visible, Level AA). It was present on the two generated app pages and two
 * others, and absent from every legal page.
 *
 * The skip link is positioned off-screen and returns on focus, rather than being
 * `display:none` — a hidden element is not focusable, so `display:none` is the
 * one way to write a skip link that cannot be used at all.
 */
export function a11yCss() {
  return `  :focus-visible{outline:var(--focus-ring,3px) solid var(--primary,#2563EB);outline-offset:var(--focus-offset,3px);border-radius:6px}
  .skip-link{position:absolute;left:-9999px;top:0;z-index:100;background:var(--primary,#2563EB);color:var(--on-accent,#fff);
    padding:10px 18px;border-radius:0 0 8px 0;text-decoration:none;font-weight:600}
  .skip-link:focus{left:0}
  /* WCAG 2.2 SC 2.4.11 (Focus Not Obscured, Level AA). Every page on this site
     opens with the same STICKY nav, so following an in-page link lands the
     target underneath it — the focused element is on screen and cannot be seen,
     which is the failure the criterion names. One page (the homepage) carried a
     scroll-padding of its own; the other twelve carried nothing.

     scroll-padding-top ON THE SCROLL CONTAINER, not scroll-margin-top on
     every target. The margin form needs a selector reaching every anchorable
     element, and that selector is read by assert-discovery-surface.mjs's
     unfilled-slot limb as a bracketed template placeholder a visitor would see.
     It is right to: a generated page carrying square brackets is nearly always a
     slot the generator could not fill. The padding form is one declaration,
     needs no selector at all, and is the property actually designed for a fixed
     header — so the two limbs never have to be traded off against each other. */
  html{scroll-padding-top:var(--focus-scroll-margin,84px)}
  :target{scroll-margin-top:var(--focus-scroll-margin,84px)}`;
}

// ── THE SPLICE ───────────────────────────────────────────────────────────────

/** Region names this module knows how to emit, mapped to their producer. Adding a
 *  region means adding it here and nowhere else; the generator and the guard both
 *  iterate this map rather than naming regions of their own. */
export const REGIONS = new Map([
  ['scale-css', scaleCss],
  ['marks-css', marksCss],
  ['a11y-css', a11yCss],
  ['skiplink', skipLink],
  ['footer', footer],
  ['footer-css', footerCss],
]);

/** The marker forms. `footer-css` sits inside a `<style>` element where an HTML
 *  comment would be literal text, so it takes CSS comment syntax. Both are one
 *  line, both name the region, and both are greppable. */
export const openMarker = (region, css) => (css ? `  /* CHROME:${region} */` : `<!-- CHROME:${region} -->`);
export const closeMarker = (region, css) => (css ? `  /* /CHROME:${region} */` : `<!-- /CHROME:${region} -->`);

/** Regions written in CSS comment syntax because they live inside `<style>`. */
const CSS_REGIONS = new Set(['footer-css', 'a11y-css', 'scale-css', 'marks-css']);
export const isCssRegion = (region) => CSS_REGIONS.has(region);

/**
 * Replace the body of one sentinel-delimited region, returning the new source.
 *
 * 🔴 REFUSES rather than skipping when the pair is absent, malformed or reversed.
 * A splice that silently does nothing is the failure mode this whole file exists
 * to prevent: the page keeps serving whatever it had, the generator reports a
 * file count that includes it, and the byte-diff compares the stale page against
 * itself and agrees. Every refusal below has a recorded failing case in
 * tooling/ci/test/chrome-splice.test.mjs.
 *
 * @param {string} html   the page as it is on disk
 * @param {string} region a key of REGIONS
 * @param {string} body   the replacement content, without the markers
 * @returns {string}
 * @throws {Error} when the region cannot be located exactly once
 */
export function spliceRegion(html, region, body) {
  const css = isCssRegion(region);
  const open = openMarker(region, css);
  const close = closeMarker(region, css);

  const opens = html.split(open).length - 1;
  const closes = html.split(close).length - 1;

  // The `close` marker contains the `open` marker as a substring for the HTML
  // form (`<!-- CHROME:x -->` vs `<!-- /CHROME:x -->`)? It does not — the slash
  // sits inside the delimiter — but counting is done on the exact strings either
  // way, so a page carrying one of each is the only shape that proceeds.
  if (opens === 0 || closes === 0) {
    throw new Error(
      `chrome region "${region}" has no ${opens === 0 ? 'opening' : 'closing'} sentinel. ` +
        `Expected the line ${JSON.stringify(opens === 0 ? open : close)} in the page. A page in CHROME_PAGES ` +
        'without its markers would silently keep whatever chrome it last had, while every count above still ' +
        'included it — so this refuses instead of skipping.',
    );
  }
  if (opens > 1 || closes > 1) {
    throw new Error(
      `chrome region "${region}" appears ${Math.max(opens, closes)} times in one page. The splice replaces ` +
        'exactly one span; more than one pair means the second copy would be left stale and served.',
    );
  }

  const start = html.indexOf(open);
  const end = html.indexOf(close);
  if (end < start) {
    throw new Error(
      `chrome region "${region}" has its closing sentinel BEFORE its opening one. Reversed markers would ` +
        'make the splice replace the whole rest of the document.',
    );
  }

  return html.slice(0, start + open.length) + '\n' + body + '\n' + html.slice(end);
}

/**
 * Apply every known region to one page's source.
 * Regions the page does not carry are an ERROR, not a skip — see `spliceRegion`.
 */
export function applyChrome(html) {
  let out = html;
  for (const [region, produce] of REGIONS) out = spliceRegion(out, region, produce());
  return out;
}
