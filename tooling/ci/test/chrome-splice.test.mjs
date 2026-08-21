// ─────────────────────────────────────────────────────────────────────────────
// tooling/sites/chrome.mjs — the shared-chrome splice.
//
// The mechanism replaced six hand-maintained footers (plus one page with none)
// with a single emitted one. Its whole safety property is that it CANNOT quietly
// do nothing: a page whose sentinels are gone must fail the build, not silently
// keep serving whatever chrome it last had while every count still includes it.
//
// Every refusal in `spliceRegion` therefore has a case here, and so does the
// happy path — an assertion that only ever sees valid input is not evidence that
// the invalid input is rejected.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROME_EXCLUDED,
  CHROME_ROOT,
  REGIONS,
  SNAPSHOT_PREFIX,
  applyChrome,
  closeMarker,
  footer,
  footerCss,
  isChromePage,
  isCssRegion,
  openMarker,
  spliceRegion,
} from '../../sites/chrome.mjs';

/** A page carrying one valid pair for every region this module knows. */
const page = (body = 'content') => {
  let head = '<html><head><style>\n';
  head += `${openMarker('footer-css', true)}\n  /* old css */\n${closeMarker('footer-css', true)}\n`;
  head += '</style></head><body>\n';
  head += `${body}\n`;
  head += `${openMarker('footer', false)}\n<footer>old</footer>\n${closeMarker('footer', false)}\n`;
  return `${head}</body></html>\n`;
};

describe('chrome.mjs · spliceRegion', () => {
  test('replaces only what sits between the markers, and keeps the markers', () => {
    const out = spliceRegion(page(), 'footer', '<footer>NEW</footer>');
    assert.match(out, /<footer>NEW<\/footer>/);
    assert.doesNotMatch(out, /<footer>old<\/footer>/);
    assert.ok(out.includes(openMarker('footer', false)));
    assert.ok(out.includes(closeMarker('footer', false)));
  });

  test('🔴 leaves every byte outside the region untouched — that is the whole bargain', () => {
    // Page content stays hand-written; chrome stops being. If the splice could
    // disturb the body, the mechanism would be a whole-page generator wearing a
    // smaller hat, and `index.html`'s 33 KB would be at risk on every run.
    const body = '<h1>Hand written</h1>\n<p>Thirty-three kilobytes of it.</p>';
    const out = spliceRegion(page(body), 'footer', '<footer>NEW</footer>');
    assert.ok(out.includes(body), 'the body must survive the splice byte-for-byte');
    assert.ok(out.startsWith('<html><head><style>'));
    assert.ok(out.endsWith('</body></html>\n'));
  });

  test('is idempotent — a second splice of the same body changes nothing', () => {
    // CI regenerates and byte-compares. If the splice were not a fixed point the
    // drift limb would fire on every push and would have to be turned off.
    const once = spliceRegion(page(), 'footer', '<footer>NEW</footer>');
    assert.equal(spliceRegion(once, 'footer', '<footer>NEW</footer>'), once);
  });

  test('🔴 REFUSES a page with no opening sentinel, rather than skipping it', () => {
    const broken = page().replace(openMarker('footer', false), '');
    assert.throws(() => spliceRegion(broken, 'footer', 'x'), /no opening sentinel/);
  });

  test('🔴 REFUSES a page with no closing sentinel', () => {
    const broken = page().replace(closeMarker('footer', false), '');
    assert.throws(() => spliceRegion(broken, 'footer', 'x'), /no closing sentinel/);
  });

  test('🔴 REFUSES a duplicated pair — the second copy would be left stale and served', () => {
    const doubled = page() + page();
    assert.throws(() => spliceRegion(doubled, 'footer', 'x'), /appears 2 times/);
  });

  test('🔴 REFUSES reversed markers, which would eat the rest of the document', () => {
    const open = openMarker('footer', false);
    const close = closeMarker('footer', false);
    const reversed = page().replace(`${open}\n<footer>old</footer>\n${close}`, `${close}\n<footer>old</footer>\n${open}`);
    assert.throws(() => spliceRegion(reversed, 'footer', 'x'), /BEFORE its opening one/);
  });

  test('the CSS region uses CSS comment syntax — an HTML comment inside <style> is literal text', () => {
    assert.ok(isCssRegion('footer-css'));
    assert.match(openMarker('footer-css', true), /\/\* CHROME:footer-css \*\//);
    assert.doesNotMatch(openMarker('footer-css', true), /<!--/);
    assert.ok(!isCssRegion('footer'));
    assert.match(openMarker('footer', false), /<!-- CHROME:footer -->/);
  });
});

describe('chrome.mjs · applyChrome', () => {
  test('applies every known region in one pass', () => {
    const out = applyChrome(page());
    assert.ok(out.includes(footer()), 'the footer markup must be present verbatim');
    assert.ok(out.includes(footerCss()), 'the footer CSS must be present verbatim');
  });

  test('🔴 a page missing ANY one region refuses — regions are not optional', () => {
    const noCss = page().replace(openMarker('footer-css', true), '');
    assert.throws(() => applyChrome(noCss), /footer-css/);
  });

  test('REGIONS is the single list both the generator and the guard iterate', () => {
    // Adding a region must not require editing three files. If this set is ever
    // read from somewhere else, the two readers can disagree about what chrome is.
    assert.deepEqual([...REGIONS.keys()].sort(), ['footer', 'footer-css']);
    for (const produce of REGIONS.values()) assert.equal(typeof produce(), 'string');
  });
});

describe('chrome.mjs · isChromePage', () => {
  test('every served .html under the root is IN the contract by default', () => {
    // Derived, not listed. A page added tomorrow is covered the moment it exists,
    // which is the property a hardcoded list could not give.
    assert.ok(isChromePage(`${CHROME_ROOT}/index.html`));
    assert.ok(isChromePage(`${CHROME_ROOT}/some/page/added/tomorrow.html`));
  });

  test('the dated snapshots are out — they are records, not pages', () => {
    assert.ok(!isChromePage(`${SNAPSHOT_PREFIX}2026-08-10/en/privacy.html`));
  });

  test('the named exclusions are out, and each one carries a written reason', () => {
    assert.ok(CHROME_EXCLUDED.size > 0);
    for (const [rel, why] of CHROME_EXCLUDED) {
      assert.ok(!isChromePage(rel), `${rel} must be excluded`);
      assert.ok(why.length > 60, `${rel} needs a real reason, not a label`);
    }
  });

  test('the other deploy root is not this root', () => {
    // sites/rajasekarselvam is a different legal person's shop window. Chrome
    // that leaked across would put Nikatru's MSME number on someone else's site.
    assert.ok(!isChromePage('sites/rajasekarselvam/index.html'));
  });

  test('non-HTML under the root is not a page', () => {
    assert.ok(!isChromePage(`${CHROME_ROOT}/sitemap.xml`));
    assert.ok(!isChromePage(`${CHROME_ROOT}/_headers`));
  });
});

describe('chrome.mjs · the footer itself', () => {
  test('🔴 links /delete-account — the link privacy.html had lost', () => {
    // The measured defect this whole mechanism was built on top of: privacy.html
    // was the ONE page whose footer omitted it, and it is the page a Play reviewer
    // opens to verify the deletion route data-safety.json declares.
    assert.match(footer(), /href="\/delete-account"/);
  });

  test('carries the union link set, so no page lost a route in the merge', () => {
    for (const href of ['/', '/apps/', '/pricing', '/privacy', '/terms', '/refund', '/delete-account', '/contact']) {
      assert.ok(footer().includes(`href="${href}"`), `the one footer must link ${href}`);
    }
  });

  test('carries the legal identity the four apps/* footers had lost', () => {
    assert.match(footer(), /UDYAM-TN-02-0487004/);
    assert.match(footer(), /Chennai, Tamil Nadu, India/);
  });

  test('every internal link is root-relative and extension-less', () => {
    // check-site-integrity inverted the canonical form on 2026-08-21: `.html` now
    // costs a 308. A footer on every page is the worst place to spend one.
    const hrefs = [...footer().matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    for (const h of hrefs.filter((x) => !/^https?:/.test(x))) {
      assert.ok(h.startsWith('/'), `${h} must be root-relative`);
      assert.doesNotMatch(h, /\.html$/, `${h} must not carry .html`);
    }
  });

  test('the CSS uses the token, never the literal that happens to equal it', () => {
    // `--ink` and `#0B1220` are the same colour today, so assert-palette-consistent
    // cannot tell them apart — which is exactly why the literal must not ship.
    assert.match(footerCss(), /background:var\(--ink\)/);
    assert.doesNotMatch(footerCss(), /background:#0B1220/i);
  });

  test('the external credit link is safe-rel', () => {
    assert.match(footer(), /target="_blank" rel="noopener"/);
  });
});
