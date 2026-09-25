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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
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
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — extensions\/Extension\/Full_Screen_Shot\/publish\/PRIVACY-POLICY\.html does not exist/);
  });

  test('COVERAGE LOST when BOTH published copies are missing — one copy is not parity', () => {
    const r = run({ ext: null, site: null });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /only 0 readable published copy\/copies/);
  });

  test('COVERAGE LOST when the Markdown source is missing', () => {
    const r = run({ md: null });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — contracts\/legal\/fullshot-privacy\.md does not exist/);
  });

  test('COVERAGE LOST when the source is below the character floor', () => {
    // Two nearly-empty documents agree with each other and with anything else.
    const r = run({ md: '# Tiny\n\nnothing much.\n' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /below the 2000 floor/);
  });

  test('COVERAGE LOST when a published copy has no <body>', () => {
    const r = run({ ext: '<html><head><title>x</title></head></html>\n' });
    assert.equal(r.code, 2, r.out);
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

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 `--!>` CLOSES AN HTML COMMENT, AND A SCANNER THAT ONLY KNOWS `-->` READS
  // EVERYTHING AFTER IT AS STILL INSIDE THE COMMENT (CodeQL js/bad-tag-filter,
  // raised on contracts/legal/render-fullshot-privacy.mjs, 2026-09-06). Both
  // ends of this pair — the renderer's block scan and this guard's Markdown
  // reduction — now accept it, and the two cases below pin BOTH directions:
  // the note is still dropped, and the published text after it is still read.
  //
  // ⚠️ HONEST ABOUT WHICH HALF WAS BROKEN, because it was MEASURED rather than
  // assumed. Reverting THIS guard's two patterns and re-running these two cases
  // leaves both GREEN: the generic `<[^>]*>` tag strip further down happens to
  // eat a `--!>`-closed comment as one long tag, so the reduction survived by
  // accident. The RENDERER was genuinely broken, and that was measured too — on
  // the real tree, with the real Markdown's head note closed `--!>`:
  //     node contracts/legal/render-fullshot-privacy.mjs --check   (pre-fix)
  //     EXIT 1 — "fullshot-privacy.md has no level-1 heading, so neither page
  //               would have a title": the scan ran to end of file and swallowed
  //               the ENTIRE document
  //     the same command, fixed                                     EXIT 0
  // So these two cases are a PIN on behaviour that must not regress, not a
  // red/green pair for the guard edit; the pair for the edit is above.
  //
  // ⏱ APPENDED 2026-09-06 — the paragraph above stands exactly as written, and
  // the gap it discloses is now CLOSED rather than only recorded: the third case
  // at the end of this block is a red/green pair for the GUARD half, and it was
  // measured both ways. See its own comment.
  // ───────────────────────────────────────────────────────────────────────────
  const closedWithBang = () =>
    markdown().replace(
      '  as text: a commented-out sentence that changed would otherwise fail this.\n-->',
      '  as text: a commented-out sentence that changed would otherwise fail this.\n--!>',
    );

  test("a reader note closed with `--!>` is still a comment, not published text", () => {
    const md = closedWithBang();
    assert.ok(md.includes('--!>'), 'the fixture no longer carries the --!> ending');
    const r = run({ md });
    assert.equal(r.code, 0, r.out);
  });

  test("...and a sentence AFTER a `--!>`-closed note is still COMPARED, not swallowed", () => {
    const md = closedWithBang().replace(
      'FullShot collects no personal information from anyone.',
      'FullShot collects some personal information from everyone.',
    );
    assert.ok(md.includes('--!>'));
    const r = run({ md });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /fullshot-privacy\.md/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⏱ THE GUARD HALF, PINNED 2026-09-06. The two cases above were honest about
  // being a PIN rather than a red/green pair: revert this guard's two `--!?>`
  // patterns and both stay green, because the generic `<[^>]*>` strip further
  // down eats a `--!>`-closed comment as one long tag and the reduction survives
  // by accident. That accident has ONE condition — the comment must contain no
  // `>` of its own. Put one inside it and the generic strip stops there, leaving
  // the REST of an unpublished note in the compared text.
  //
  // MEASURED both ways on this fixture, `--!?>` reverted to `-->` in both
  // patterns of tooling/ci/assert-legal-text-parity.mjs:
  //     the pair above          EXIT 0   (green either way — the honest gap)
  //     the pair below          EXIT 1   ("- 4 is true, and a commented-out …")
  //     patterns restored, both EXIT 0
  // So this is the red/green pair the guard edit was missing, and the two cases
  // above stay as the behaviour pin they were always described as.
  // ───────────────────────────────────────────────────────────────────────────
  const closedWithBangHoldingAngle = () =>
    markdown().replace(
      '  as text: a commented-out sentence that changed would otherwise fail this.\n-->',
      '  as text: 5 > 4, and a commented-out sentence that changed would otherwise fail this.\n--!>',
    );

  test("🔴 a `--!>`-closed note CONTAINING a `>` is still dropped whole", () => {
    const md = closedWithBangHoldingAngle();
    assert.ok(md.includes('--!>'), 'the fixture no longer carries the --!> ending');
    assert.ok(md.includes('5 > 4'), 'the fixture no longer carries a `>` inside the comment');
    const r = run({ md });
    assert.equal(
      r.code,
      0,
      'the comment pattern is what drops this note; the generic tag strip cannot, ' +
        `because it stops at the > inside it:\n${r.out}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 — ASSERTION 3, THE BYTES (REVIEW-stores-2026-09-10 #5). These cases run
// against COPIES OF THE REAL FILES — the renderer, the Markdown and both published copies —
// because the property under test is "the served page is what THIS renderer emits", and a
// fixture renderer written for the test would only prove the guard agrees with its author.
const REPO = resolve(CI_DIR, '..', '..');
const REAL = {
  renderer: 'contracts/legal/render-fullshot-privacy.mjs',
  source: 'contracts/legal/fullshot-privacy.md',
  site: 'sites/nikatru/fullshot/privacy.html',
  ext: 'extensions/Extension/Full_Screen_Shot/publish/PRIVACY-POLICY.html',
  // ⏱ 2026-09-25 (EXT-4, Q2) — what the renderer reads to decide whether its
  // `when=pro` paragraphs are published: the gate module and the two facts.
  gate: 'contracts/legal/pro-gate.mjs',
  tool: 'extensions/Extension/Full_Screen_Shot/tool.json',
  offerings: 'services/platform/src/app-config-data.json',
};

function runReal({ site = (t) => t, ext = (t) => t } = {}) {
  const root = join(TMP, `real-${(seq += 1)}`);
  for (const rel of Object.values(REAL)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  writeFileSync(join(root, REAL.site), site(readFileSync(join(root, REAL.site), 'utf8')));
  writeFileSync(join(root, REAL.ext), ext(readFileSync(join(root, REAL.ext), 'utf8')));
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, root };
}

describe('assert-legal-text-parity — assertion 3: the published BYTES are the renderer\'s', () => {
  // ⏱ 2026-09-11 — the renderer emits the <!--email_off--> markers itself, so the
  // real files are byte-identical to it and the residue print is RETIRED. It used
  // to be asserted here as present; that case is inverted, not deleted.
  test('PASSES on the real files, with NO email_off residue — the renderer emits the markers', () => {
    const r = runReal();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 copy\/copies equal their renderer's bytes/);
    assert.doesNotMatch(r.out, /ONLY by <!--email_off--> markers/);
  });

  test('the renderer\'s own --check exits 0 on the real files', () => {
    const r = runReal();
    const c = spawnSync(process.execPath, [join(r.root, REAL.renderer), '--check'], { encoding: 'utf8' });
    assert.equal(c.status, 0, `${c.stdout ?? ''}${c.stderr ?? ''}`);
  });

  test('Q2: FullShot neither transmits nor sells, so no Pro paragraph is published', () => {
    const r = runReal();
    const c = spawnSync(process.execPath, [join(r.root, REAL.renderer), '--stdout'], { encoding: 'utf8' });
    assert.equal(c.status, 0, c.stderr);
    assert.doesNotMatch(c.stdout, /FullShot Pro is optional/);
    assert.match(c.stdout, /It does not have accounts/);
  });

  test('Q2: a tool.json that TRANSMITS publishes the Pro paragraph and retires the no-accounts lead', () => {
    const r = runReal();
    const t = JSON.parse(readFileSync(join(r.root, REAL.tool), 'utf8'));
    t.policy.networkAllowlist = ['api.example.test'];
    const alt = join(r.root, 'tool-transmits.json');
    writeFileSync(alt, JSON.stringify(t, null, 2));
    const c = spawnSync(process.execPath, [join(r.root, REAL.renderer), '--stdout', '--tool', alt], { encoding: 'utf8' });
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stdout, /FullShot Pro is optional/);
    assert.doesNotMatch(c.stdout, /It does not have accounts/);
    assert.doesNotMatch(c.stdout, /api\.example\.test/, 'the privacy text never names a host');
  });

  test('a fresh render wraps EVERY mailto anchor WHOLE in the served copy, and leaves the store copy unmarked', () => {
    const r = runReal();
    const w = spawnSync(process.execPath, [join(r.root, REAL.renderer)], { encoding: 'utf8' });
    assert.equal(w.status, 0, `${w.stdout ?? ''}${w.stderr ?? ''}`);
    const site = readFileSync(join(r.root, REAL.site), 'utf8');
    const ext = readFileSync(join(r.root, REAL.ext), 'utf8');
    const mailtos = site.split('mailto:').length - 1;
    assert.ok(mailtos >= 2, `the served copy should carry the contact address at least twice, found ${mailtos}`);
    const wrapped = site.split('<!--email_off--><a href="mailto:').length - 1;
    const closed = site.split('</a><!--/email_off-->').length - 1;
    assert.equal(wrapped, mailtos, 'every mailto: must open inside <!--email_off--> immediately before its <a>');
    assert.equal(closed, mailtos, 'every wrapped anchor must close with <!--/email_off--> immediately after its </a>');
    assert.equal(ext.includes('email_off'), false, 'the store copy is never served by Cloudflare and carries no markers');
  });

  test('a served copy MISSING the markers still passes parity but PRINTS the residue', () => {
    const r = runReal({ site: (t) => t.replace(/<!--\s*\/?\s*email_off\s*-->/gi, '') });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /differs from contracts\/legal\/render-fullshot-privacy\.mjs's output ONLY by <!--email_off--> markers/);
  });

  test('🔴 FAILS on drift the TEXT assertions cannot see — a changed meta description', () => {
    const r = runReal({ site: (t) => t.replace(/<meta name="description" content="/, '<meta name="description" content="Edited by hand. ') });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /sites\/nikatru\/fullshot\/privacy\.html is not what contracts\/legal\/render-fullshot-privacy\.mjs renders from contracts\/legal\/fullshot-privacy\.md — BYTES, not words/);
    assert.doesNotMatch(r.out, /PUBLISH DIFFERENT TEXT/, 'the visible text did not change, so assertions 1 and 2 must stay quiet');
  });

  test('FAILS on byte drift in the STORE copy too', () => {
    const r = runReal({ ext: (t) => t.replace('</style>', '  /* hand edit */\n</style>') });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PRIVACY-POLICY\.html is not what contracts\/legal\/render-fullshot-privacy\.mjs renders/);
  });

  test('an email_off marker is the ONLY thing set aside — moving the address is still drift', () => {
    const r = runReal({ site: (t) => t.replace('support@nikatru.com</a>', 'help@nikatru.com</a>') });
    assert.equal(r.code, 1, r.out);
  });

  test('COVERAGE LOST when the renderer cannot run', () => {
    const r = runReal();
    writeFileSync(join(r.root, REAL.renderer), 'process.exit(3);\n');
    const again = spawnSync(process.execPath, [GUARD, r.root], { encoding: 'utf8' });
    const out = `${again.stdout ?? ''}${again.stderr ?? ''}`;
    assert.equal(again.status, 2, out);
    assert.match(out, /COVERAGE LOST — contracts\/legal\/render-fullshot-privacy\.mjs exited 3/);
  });
});
