// a11y-statement.test.mjs — lane a11y-statement: the exceptions register, the
// generated /accessibility page, the guard that holds the two equal, the scan's
// verdict and its path handling (Windows included), and the footer link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, pageIds, run as runStatementGuard } from '../assert-a11y-statement.mjs';
import { registerProblems, renderStatement } from '../../sites/gen-accessibility-statement.mjs';
import { covers, judge, toPosix, urlPathFor } from '../../a11y/scan.mjs';
import { a11yCss, footer } from '../../sites/chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const REGISTER = JSON.parse(read('tooling/a11y/exceptions.json'));
const PAGE = read('sites/nikatru/accessibility.html');
const minus = (doc, id) => ({ ...doc, exceptions: doc.exceptions.filter((r) => r.id !== id) });

// ── Do 1: the register and the published page agree, both ways ──────────────

test('the real tree: every register row is published once, and nothing else', () => {
  const r = runStatementGuard(ROOT);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(pageIds(PAGE).length, REGISTER.exceptions.length);
});

test('🔴 AS-1: a register row the page does not publish is a finding', () => {
  const html = PAGE.replace('data-exception="A11Y-EX-PRICING-HEADINGS"', 'data-x="gone"');
  const r = compare(REGISTER, html);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /^AS-1 A11Y-EX-PRICING-HEADINGS/);
});

test('🔴 AS-2: a page that still publishes a row the register dropped is a finding', () => {
  const r = compare(minus(REGISTER, 'A11Y-EX-APPS-DARK-LINK-CONTRAST'), PAGE);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /^AS-2 .*A11Y-EX-APPS-DARK-LINK-CONTRAST/);
});

test('🔴 AS-3: a row published twice is a finding', () => {
  const html = PAGE.replace('<ul class="gaps">', '<ul class="gaps"><li data-exception="A11Y-EX-PRICING-HEADINGS">again</li>');
  assert.equal(compare(REGISTER, html).code, 1);
});

test('an empty register is COVERAGE LOST, never a pass', () => {
  assert.equal(compare({ exceptions: [] }, PAGE).code, 2);
});

// ── Do 2: the page is generated from the register, and says only that ──────

test('the committed page is a fresh render of the register', () => {
  assert.equal(PAGE.replace(/\r\n/g, '\n'), renderStatement(REGISTER));
});

test('🔴 a row deleted from the register leaves the rendered page', () => {
  const html = renderStatement(minus(REGISTER, 'A11Y-EX-ST-PRIVACY-NOTICE'));
  assert.ok(!html.includes('A11Y-EX-ST-PRIVACY-NOTICE'));
  assert.ok(PAGE.includes('A11Y-EX-ST-PRIVACY-NOTICE'));
});

test('the page says plainly that no Apple screen-reader pass has been done', () => {
  assert.match(PAGE, /No one has yet tested the apps with a screen reader on an Apple device/);
});

test('the page claims no conformance, only the standard worked to', () => {
  assert.ok(!/\bconforms?\b|\bfully (accessible|compliant)\b/i.test(PAGE.replace(/<!--[\s\S]*?-->/g, '')));
});

test('the page links the report form with its accessibility category', () => {
  assert.match(PAGE, /href="\/support#report-a-problem"/);
  assert.match(read('sites/nikatru/support.html'), /<option value="accessibility">/);
});

test('🔴 a register row with no `until` is COVERAGE LOST for the generator', () => {
  const bad = { ...REGISTER, exceptions: [{ ...REGISTER.exceptions[0], until: undefined }] };
  delete bad.exceptions[0].until;
  assert.ok(registerProblems(bad).some((p) => /no "until"/.test(p)));
  assert.deepEqual(registerProblems(REGISTER), []);
});

test('the shared footer links /accessibility', () => {
  assert.match(footer(), /<a href="\/accessibility">Accessibility<\/a>/);
});

// ── Do 3: the scan's verdict ────────────────────────────────────────────────

const f = (rule, page, impact = 'serious') => ({ rule, page, impact, width: 375, scheme: 'dark', targets: ['a'] });

test('a serious violation the register names on that page is tolerated', () => {
  const v = judge([f('color-contrast', 'sites/nikatru/apps/index.html')], REGISTER, ['sites/nikatru/apps/index.html']);
  assert.equal(v.failing.length, 0);
  assert.equal(v.tolerated[0].exception, 'A11Y-EX-APPS-DARK-LINK-CONTRAST');
});

test('🔴 the same violation after its register row is deleted fails', () => {
  const v = judge([f('color-contrast', 'sites/nikatru/apps/index.html')], minus(REGISTER, 'A11Y-EX-APPS-DARK-LINK-CONTRAST'), ['sites/nikatru/apps/index.html']);
  assert.equal(v.failing.length, 1);
});

test('🔴 a row on another page does not cover this one', () => {
  assert.equal(covers(REGISTER.exceptions[0], 'color-contrast', 'sites/nikatru/index.html'), false);
  assert.equal(judge([f('color-contrast', 'sites/nikatru/index.html')], REGISTER, []).failing.length, 1);
});

test('moderate and minor findings never fail', () => {
  const v = judge([f('region', 'sites/nikatru/x.html', 'moderate'), f('y', 'sites/nikatru/x.html', 'minor')], REGISTER, []);
  assert.equal(v.failing.length, 0);
  assert.equal(v.advisory.length, 2);
});

test('🔴 a row whose rule fired nowhere on its scanned pages is STALE', () => {
  const pages = REGISTER.exceptions[0].pages;
  assert.equal(judge([], REGISTER, pages).stale.map((r) => r.id).includes('A11Y-EX-APPS-DARK-LINK-CONTRAST'), true);
  // Not stale when its pages were not scanned (a fixture run).
  assert.equal(judge([], REGISTER, ['tooling/a11y/fixtures/x.html']).stale.length, 0);
});

// ── paths: POSIX in the register, whatever the host ─────────────────────────

test('toPosix turns a Windows relative path into the register spelling', () => {
  assert.equal(toPosix(path.win32.join('sites', 'nikatru', 'apps', 'index.html')), 'sites/nikatru/apps/index.html');
  assert.equal(toPosix('sites/nikatru/index.html'), 'sites/nikatru/index.html');
});

test('urlPathFor serves clean URLs, with a POSIX or a Windows site dir', () => {
  assert.equal(urlPathFor('sites/nikatru', 'sites/nikatru/index.html'), '/');
  assert.equal(urlPathFor('sites/nikatru', 'sites/nikatru/apps/index.html'), '/apps/');
  assert.equal(urlPathFor('sites/nikatru', 'sites/nikatru/fullshot/privacy.html'), '/fullshot/privacy');
  assert.equal(urlPathFor('sites\\nikatru', 'sites\\nikatru\\fullshot\\privacy.html'), '/fullshot/privacy');
  assert.equal(urlPathFor('sites/nikatru/', 'sites/nikatru/accessibility.html'), '/accessibility');
});

// ── Do 4: the 375px nav ─────────────────────────────────────────────────────

test('below 720px the nav is not sticky and the scroll padding is zero (SC 2.4.11)', () => {
  assert.match(a11yCss(), /@media\(max-width:720px\)\{nav\{position:static!important\}html\{scroll-padding-top:0\}/);
});

test('the homepage platforms label sits on an element with a role', () => {
  assert.match(read('sites/nikatru/index.html'), /<div class="plat-row" role="group" aria-label="Platforms we build for">/);
});
