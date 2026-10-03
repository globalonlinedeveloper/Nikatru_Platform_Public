// ─────────────────────────────────────────────────────────────────────────────
// fullshot-chrome.mjs — the two pieces of SITE chrome the served FullShot
// privacy policy carries that are not the policy's text (lane a11y-statement,
// Do 4; the 2026-10-02 audit §2k: "/fullshot/privacy has no nav, no main and no
// skip link").
//
// ONE definition, read by two files: contracts/legal/render-fullshot-privacy.mjs
// emits these exact strings into the served copy, and
// tooling/ci/assert-legal-text-parity.mjs removes these exact strings, and only
// these, before it compares the copy's visible text with the Markdown. A word
// added to the nav here changes both sides at once; a word added to the nav in
// the served file and not here survives the removal and reds the parity guard.
// ─────────────────────────────────────────────────────────────────────────────

/** WCAG 2.2 SC 2.4.1: the first focusable thing in the body. */
export const FULLSHOT_SKIP_LINK = '<a class="skip-link" href="#main">Skip to content</a>';

/** The served copy's one navigation landmark: the way back to the site. */
export const FULLSHOT_SITE_NAV = '<nav aria-label="Site"><a href="/">Nikatru home</a> &middot; <a href="/accessibility">Accessibility</a></nav>';

/** The served body with the chrome above removed, for a text comparison. */
export const withoutFullshotChrome = (body) => body.split(FULLSHOT_SKIP_LINK).join('').split(FULLSHOT_SITE_NAV).join('');
