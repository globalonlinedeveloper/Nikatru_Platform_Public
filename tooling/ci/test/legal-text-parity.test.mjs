// ─────────────────────────────────────────────────────────────────────────────
// legal-text-parity.test.mjs — assert-legal-text-parity.mjs must be able to FAIL.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-05, five, on
// this worktree; each applied to the real file, the guard run, the file
// restored, and the restore re-verified green before the next one). A fixture
// you wrote encodes the same misunderstanding as the guard you wrote.
//
//   L1  one sentence changed in PRIVACY-POLICY.html  -> exit 1, naming the pair
//       ("collects no personal information" ->            AND the first differing
//        "collects some personal information")            character
//   L2  a different sentence changed in the SERVED   -> exit 1 — neither copy is
//       copy ("makes no network requests")                the privileged one
//   L3  BOTH copies changed IN STEP, the Markdown    -> exit 1 — assertion 2, the
//       left alone ("No cookies" -> "Some cookies")       one that is easy to
//                                                         leave out
//   L4  PRIVACY-POLICY.html deleted                  -> exit 1, COVERAGE LOST
//   L5  the MARKDOWN changed and the copies not      -> exit 1, and the renderer's
//       re-rendered                                       own --check exits 1 too
//   Green controls before and after: exit 0. `git status` clean afterwards.
//
// 🔴 AND TWO DEFECTS THE FIRST RUN FOUND IN THE GUARD ITSELF, both recorded
// because each would have made its FIRST red an artefact rather than a finding —
// and a guard whose first red is an artefact is a guard somebody switches off:
//   · comparing the WHOLE file put the `<title>` in the HTML side's text, so the
//     `<h1>` appeared twice there and once in the Markdown. The comparison is now
//     scoped to `<body>`.
//   · `visibleText` turns every tag into a SPACE, so `…<a>x@y</a>.` reduced to
//     "x@y ." against the Markdown's "x@y." — a difference produced entirely by
//     the reduction. Both sides are now tightened before closing punctuation.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-legal-text-parity.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ltp-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** Long enough to clear the guard's 2,000-character floor, because the floor is
 *  one of the things under test and a short fixture would only ever exercise it. */
const FILLER = Array.from(
  { length: 26 },
  (_, i) => `Paragraph ${i + 1}. FullShot processes everything on your own device and transmits nothing to us or to anyone else, ever.`,
);

/** The shared text, as Markdown. `o.sentence` is the one line a case moves. */
function markdown(o = {}) {
  const sentence = o.sentence ?? 'FullShot collects no personal information from anyone.';
  const callout = o.callout ?? 'In one line';
  return [
    '<!--',
    '  A note to readers of the Markdown. It is NOT published and must not count',
    '  as text: a commented-out sentence that changed would otherwise fail this.',
    '-->',
    '',
    '# Example — Privacy Policy',
    '',
    `<!-- render: callout=${callout} -->`,
    'Your data stays on your device.',
    '',
    '## 1. What it does',
    '',
    sentence,
    '',
    // A code span holding angle brackets, and a number with spaces round it —
    // the two inputs that broke the first draft of the Markdown reduction.
    'The optional permission is `<all_urls>`, requested at stage 13 and no earlier.',
    '',
    ...FILLER.flatMap((p) => [p, '']),
    '---',
    '',
    'Published by Rajasekar Selvam, trading as NIKATRU.',
    '',
  ].join('\n');
}

/** The same text, as one of the published HTML copies. */
function html(o = {}) {
  const sentence = o.sentence ?? 'FullShot collects no personal information from anyone.';
  const callout = o.callout ?? 'In one line';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<title>Example — Privacy Policy</title>',
    // The title repeats the h1 on purpose: the guard must read the BODY only.
    '<!-- A head comment naming a sentence that is not in the body. -->',
    '</head>',
    '<body>',
    '<h1>Example — Privacy Policy</h1>',
    '',
    '<div class="callout">',
    `<span class="tag">${callout}</span>`,
    '<p style="margin:8px 0 0">Your data stays on your device.</p>',
    '</div>',
    '',
    '<h2>1. What it does</h2>',
    `<p>${sentence}</p>`,
    '<p>The optional permission is <code>&lt;all_urls&gt;</code>, requested at stage 13 and no earlier.</p>',
    ...FILLER.map((p) => `<p>${p}</p>`),
    '',
    '<footer>',
    'Published by Rajasekar Selvam, trading as NIKATRU.',
    '</footer>',
    '',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * Build a fixture root and run the guard against it.
 *
 * The guard's DOCUMENTS table names real repository paths, so the fixture
 * recreates those exact paths under a temp root — the same technique the
 * entitlement-contract suite uses.
 */
function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  const legal = join(root, 'contracts', 'legal');
  const site = join(root, 'sites', 'nikatru', 'fullshot');
  const ext = join(root, 'extensions', 'Extension', 'Full_Screen_Shot', 'publish');
  mkdirSync(legal, { recursive: true });
  mkdirSync(site, { recursive: true });
  mkdirSync(ext, { recursive: true });

  if (o.md !== null) writeFileSync(join(legal, 'fullshot-privacy.md'), o.md ?? markdown(o.source ?? {}));
  if (o.extraLegalMd) writeFileSync(join(legal, o.extraLegalMd), '# Another policy\n\nnot covered\n');
  if (o.site !== null) writeFileSync(join(site, 'privacy.html'), o.site ?? html(o.siteText ?? {}));
  if (o.ext !== null) writeFileSync(join(ext, 'PRIVACY-POLICY.html'), o.ext ?? html(o.extText ?? {}));

  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, root };
}

describe('assert-legal-text-parity — a document published twice says the same thing in both places', () => {
  test('PASSES when both copies render the source', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}legal text parity/);
  });

  test('the passing line PRINTS how many copies it compared', () => {
    // "0 copies, clean" must not read like "2 clean".
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 published copy\/copies compared/);
    assert.match(r.out, /3 comparison\(s\)/);
  });

  test('FAILS when the STORE copy alone is hand-edited', () => {
    const r = run({ extText: { sentence: 'FullShot collects some personal information from anyone.' } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PUBLISH DIFFERENT TEXT/);
    assert.match(r.out, /PRIVACY-POLICY\.html/);
    assert.match(r.out, /first difference at character \d+/);
  });

  test('FAILS when the SERVED copy alone is hand-edited — neither side is privileged', () => {
    const r = run({ siteText: { sentence: 'FullShot collects some personal information from anyone.' } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PUBLISH DIFFERENT TEXT/);
  });

  test('FAILS when BOTH copies are edited IN STEP — the assertion that is easy to leave out', () => {
    // The pair agrees with itself perfectly. Without assertion 2 the Markdown
    // becomes a third, stale copy and this run is green.
    const edited = { sentence: 'FullShot collects some personal information from anyone.' };
    const r = run({ siteText: edited, extText: edited });
    assert.equal(r.code, 1, r.out);
    assert.doesNotMatch(r.out, /PUBLISH DIFFERENT TEXT/);
    assert.match(r.out, /has DRIFTED FROM contracts\/legal\/fullshot-privacy\.md/);
  });

  test('FAILS when the MARKDOWN moves and the copies are not re-rendered', () => {
    const r = run({ source: { sentence: 'FullShot collects some personal information from anyone.' } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has DRIFTED FROM/);
    assert.match(r.out, /edit the Markdown and run node contracts\/legal\/render-fullshot-privacy\.mjs/);
  });

  test('FAILS when the CALLOUT TAG moves in one copy — a directive can carry published text', () => {
    // "In one line" is published as a visible span. It lives in the Markdown's
    // render directive, so a reduction that treated every directive as metadata
    // would let it change unnoticed.
    const r = run({ extText: { callout: 'In summary' } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PUBLISH DIFFERENT TEXT/);
  });

  test('FAILS when the callout tag moves in the MARKDOWN alone', () => {
    const r = run({ source: { callout: 'In summary' } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has DRIFTED FROM/);
  });

  test('COVERAGE LOST when one published copy is missing', () => {
    const r = run({ ext: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — extensions\/Extension\/Full_Screen_Shot\/publish\/PRIVACY-POLICY\.html does not exist/);
  });

  test('COVERAGE LOST when BOTH published copies are missing — one copy is not parity', () => {
    const r = run({ ext: null, site: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /only 0 readable published copy\/copies/);
  });

  test('COVERAGE LOST when the Markdown source is missing', () => {
    const r = run({ md: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — contracts\/legal\/fullshot-privacy\.md does not exist/);
  });

  test('COVERAGE LOST when the source is below the character floor', () => {
    // Two nearly-empty documents agree with each other and with anything else.
    const r = run({ md: '# Tiny\n\nnothing much.\n' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /below the 2000 floor/);
  });

  test('COVERAGE LOST when a published copy has no <body>', () => {
    const r = run({ ext: '<html><head><title>x</title></head></html>\n' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /has no <body>/);
  });

  test('FAILS when a NEW legal document is added that no row covers', () => {
    // The sweep is what stops a second published policy being ungraded.
    const r = run({ extraLegalMd: 'another-privacy.md' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /another-privacy\.md is shared legal text that NO row in this guard covers/);
  });

  test('a sentence that differs only in a HEAD COMMENT is not a difference', () => {
    // Comments are inert. A commented-out claim must not bind a page, and must
    // not fail a comparison either.
    const withComment = html().replace('<body>', '<body>\n<!-- FullShot collects some personal information. -->');
    const r = run({ ext: withComment });
    assert.equal(r.code, 0, r.out);
  });

  test('an em dash written as an ENTITY is not a legal difference', () => {
    // `&mdash;` and a literal em dash are the same claim. The reduction decodes
    // the entity and folds both onto `-`, so one copy switching to entities is
    // not a divergence — while the WORDS changing still is (every case above).
    const asEntities = html().replace(/—/g, '&mdash;');
    assert.notEqual(asEntities, html(), 'the fixture no longer contains an em dash');
    const r = run({ ext: asEntities });
    assert.equal(r.code, 0, r.out);
  });
});
