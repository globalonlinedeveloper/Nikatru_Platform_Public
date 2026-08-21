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
//     ae6331b0  apps/index.html · apps/subly.html
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
//      deletion route that `apps/subly/store/android-play/data-safety.json`
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
    'a MIRRORED LEGAL DOCUMENT whose source of truth is Nikatru_Extensions_Public/Extension/' +
      'Full_Screen_Shot/publish/PRIVACY-POLICY.html. Its <footer> is not site chrome — it is the ' +
      "document's own publisher identification, part of the text a store reviewer is reading. Splicing " +
      'site navigation over it would both edit a legal document and widen a cross-repo divergence that ' +
      'no guard in either repository can see. The cost is that this page carries no site navigation; ' +
      'that is recorded as a known gap, not an oversight.',
  ],
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
 * Deliberately class-light. The homepage version used `.wrap`, `.foot-links` and
 * `.foot-dev`, none of which the other ten pages define — emitting those classes
 * site-wide would have rendered unstyled everywhere they were absent, which is
 * exactly the kind of "it looked fine on the page I tested" failure that produced
 * six footers in the first place.
 */
export function footer() {
  return `<footer>
  <a href="/">Home</a> &middot; <a href="/apps/">Apps</a> &middot; <a href="/pricing">Pricing</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/refund">Refunds</a> &middot; <a href="/delete-account">Delete account</a> &middot; <a href="/contact">Contact</a><br><br>
  <b>Nikatru&trade;</b> &middot; Chennai, Tamil Nadu, India &middot; Registered MSME UDYAM-TN-02-0487004<br>
  Developed by <a href="https://rajasekarselvam.com" target="_blank" rel="noopener"><b>Rajasekar Selvam</b></a><br>
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
  footer b{color:#fff}
  footer a{color:#B6C2D9;text-decoration:none;margin:0 7px;display:inline-block;padding:4px 0}
  footer a:hover{color:#fff}`;
}

// ── THE SPLICE ───────────────────────────────────────────────────────────────

/** Region names this module knows how to emit, mapped to their producer. Adding a
 *  region means adding it here and nowhere else; the generator and the guard both
 *  iterate this map rather than naming regions of their own. */
export const REGIONS = new Map([
  ['footer', footer],
  ['footer-css', footerCss],
]);

/** The marker forms. `footer-css` sits inside a `<style>` element where an HTML
 *  comment would be literal text, so it takes CSS comment syntax. Both are one
 *  line, both name the region, and both are greppable. */
export const openMarker = (region, css) => (css ? `  /* CHROME:${region} */` : `<!-- CHROME:${region} -->`);
export const closeMarker = (region, css) => (css ? `  /* /CHROME:${region} */` : `<!-- /CHROME:${region} -->`);

/** Regions written in CSS comment syntax because they live inside `<style>`. */
const CSS_REGIONS = new Set(['footer-css']);
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
