// ─────────────────────────────────────────────────────────────────────────────
// palette-consistent.test.mjs — assert-palette-consistent.mjs must be able to
// FAIL, and must be able to fail on each limb SEPARATELY.
//
// 🔴 THE REAL-TREE RUN CAME FIRST, AND IT FOUND TWO DEFECTS IN THE GUARD BEFORE
// A SINGLE FIXTURE EXISTED. Nine mutations against the actual repository on
// 2026-08-17 at dcff9fb, each restored and re-verified (sha256 on the file, or
// `git diff --stat` over `sites/` and `tooling/sites/`):
//
//    1. sites/nikatru/pricing.html  `--text:#1E293B` → `#334155`
//         ⇒ exit 1. "--text is declared 2 different ways in the light palette",
//           #1e293b from 13 sources, #334155 from one, every citation file:line.
//    2. tooling/sites/generate-discovery.mjs  STYLE `--primary` → `#2E6FF3`
//         ⇒ exit 1, naming `generate-discovery.mjs (STYLE):234` alone against 16
//           agreeing sources. This is the limb that catches a palette edit BEFORE
//           anyone re-runs the generator that would spread it.
//    3. `const STYLE` renamed to `const PAGE_STYLE`
//         ⇒ exit 2, COVERAGE LOST. The subject cannot be renamed out from under
//           the guard quietly.
//    4. a page hidden from the tracked set ⇒ exit 2, "16 page(s) … expected at
//           least 17".
//    5. the LIVE POLICY page hidden ⇒ exit 2, but the NAMED message, not the
//           count one: "1 named source(s) are not in the compared set".
//    6. two of the three dated snapshots hidden ⇒ exit 2, "the dated-snapshot
//           exclusion matched 1 file(s), expected at least 3".
//    7. `sites/nikatru/legal/draft/privacy.html` tracked ⇒ exit 2, "do not match
//           the dated <YYYY-MM-DD>/<locale>/ schema … it must not guess".
//    8. sites/_shared/assets/tokens.css `:root {` → `html body {`
//         ⇒ exit 2, "in the compared set but declare no `:root` block at all".
//    9. sites/nikatru/404.html `:root{` → `html{` ⇒ exit 2, "30 `:root` block(s)
//           … expected at least 31".
//
//   And two mutations of the GUARD'S OWN SOURCE, because the two SLACK floors
//   (MIN_DECLARATIONS 200, MIN_COMPARED 15) cannot be reached by editing the
//   corpus without tripping an exact floor first — and a floor that cannot be
//   reached is a floor that is not there:
//
//   10. `flush()` made to record nothing ⇒ exit 2, "0 custom-property
//           declaration(s) read from 31 `:root` block(s)". Blocks counted by one
//           scanner, declarations by another, which is why one can survive the
//           other and why they are two separate functions.
//   11. the aggregation key given the source name, making every property unique
//           ⇒ exit 2, "only 0 propert(ies) are declared by two or more sources".
//
//   Mutations 4–7 were done against a COPY of `.git/index` selected with
//   `GIT_INDEX_FILE`, never the real one: the guard derives its subject from
//   `git ls-files`, so a copied index is a real mutation of the real subject,
//   and staging a deletion in a repository three other agents are committing to
//   is a risk with no compensating gain. The real index was re-checked after
//   each: `git ls-files sites/nikatru/legal` still lists all three snapshots.
//
// ── THE TWO DEFECTS THE REAL-TREE RUN FOUND, BOTH INVISIBLE TO A FIXTURE ─────
//   · EVERY LINE NUMBER WAS WRONG. The reducer blanked discarded characters to
//     spaces, which keeps byte offsets and destroys newlines: tokens.css's
//     seven-line header comment collapsed onto one line and the `--text`
//     declaration on line 17 was cited as `tokens.css:10`. Every citation was
//     short by the newlines it had eaten and every one still pointed at a real
//     line of a real file. A fixture written by the same author would have had
//     the same one-line header and the same blind spot.
//   · THE `MUST_COMPARE` LIMB COULD NOT FIRE. It sat behind MIN_PAGES, and every
//     way of losing a named file also drops the page count — so the specific
//     message was unreachable and the generic "16 < 17" was always printed
//     instead. Both are now proven reachable, separately, below.
//
// ── HOW THE FIXTURES ARE BUILT, AND WHY NOT BY HAND ──────────────────────────
// The guard carries five coverage floors — 17 pages, 3 snapshots, 31 `:root`
// blocks, 200 declarations, 15 compared properties — so a hand-written fixture
// would either be a corpus large enough to clear all five (which is a rewrite of
// the sites) or a fixture that only ever exercises the floors. So each fixture
// is MATERIALISED FROM `HEAD`: every tracked `.html`/`.css` under `sites/` plus
// the generator, written into a fresh temp git repository. The subject is the
// real corpus; only the mutation is synthetic. Nothing is copied from the
// WORKING tree, so a fixture is unaffected by whatever else is uncommitted.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, unlinkSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');

/** Written as a repo-relative path, not assembled from a bare basename: this is
 *  the string that makes the guard a REACHED file for
 *  `tooling/scripts/assert-no-dead-files.mjs`, and a `join(CI_DIR, '…')` alone
 *  would leave the suite asserting on a file the dead-file scan calls orphaned. */
const GUARD_REL = 'tooling/ci/assert-palette-consistent.mjs';
const GUARD = join(REPO, GUARD_REL);

const GENERATOR_REL = 'tooling/sites/generate-discovery.mjs';
const LIVE_POLICY = 'sites/nikatru/privacy.html';
const A_SNAPSHOT = 'sites/nikatru/legal/2026-08-10/en/privacy.html';
const TOKENS = 'sites/_shared/assets/tokens.css';

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-palette-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** The set the guard reads: every tracked stylesheet-bearing file under sites/,
 *  plus the generator whose constant is in the subject. Derived from HEAD rather
 *  than listed, so a page added to the sites joins the fixtures too. */
function subjectPaths() {
  const r = git(REPO, ['ls-tree', '-r', 'HEAD', '--name-only', '--', 'sites', 'tooling/sites']);
  assert.equal(r.status, 0, `git ls-tree failed: ${r.stderr}`);
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((p) => /^sites\/.+\.(?:html|css)$/.test(p) || p === GENERATOR_REL);
}

/** Built ONCE — a git repository holding the real corpus at HEAD, indexed and
 *  ready — and then COPIED per test, `.git` and all. Thirty fixtures each
 *  spawning `git show` twenty times is six hundred process launches and a
 *  seventy-second test file; a directory copy is milliseconds. `git add` only,
 *  never a commit: `git ls-files` reads the INDEX, and committing would buy
 *  nothing but a user.name requirement on whatever machine runs the suite. */
let TEMPLATE;
before(() => {
  const paths = subjectPaths();
  assert.ok(paths.length > 15, `expected the real corpus, got ${paths.length} path(s)`);
  assert.ok(paths.includes(GENERATOR_REL), 'the generator must be materialised into every fixture');

  TEMPLATE = join(TMP, 'template');
  mkdirSync(TEMPLATE, { recursive: true });
  assert.equal(git(TEMPLATE, ['init', '-q']).status, 0, 'git init failed');
  for (const rel of paths) {
    const show = spawnSync('git', ['show', `HEAD:${rel}`], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(show.status, 0, `git show HEAD:${rel} failed: ${show.stderr}`);
    const abs = join(TEMPLATE, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, show.stdout);
  }
  assert.equal(git(TEMPLATE, ['add', '-A']).status, 0, 'git add failed');
});

function fixture() {
  const root = join(TMP, `f${seq++}`);
  cpSync(TEMPLATE, root, { recursive: true });
  return root;
}

/** Edit a file in a fixture and ASSERT THE EDIT LANDED. A mutation test whose
 *  mutation silently did not apply reports the guard as passing, which is the
 *  same false green the guard itself exists to prevent — one level up. */
function patch(root, rel, from, to) {
  const abs = join(root, rel);
  const before = readFileSync(abs, 'utf8');
  const after = before.replace(from, to);
  assert.notEqual(after, before, `mutation did not apply: ${from} not found in ${rel}`);
  writeFileSync(abs, after);
  return root;
}

/** Add a file to the fixture's tracked set. */
function add(root, rel, contents) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
  assert.equal(git(root, ['add', '--', rel]).status, 0, `git add ${rel} failed`);
  return root;
}

/** Remove a file from the tracked set, leaving it on disk. */
function untrack(root, rel) {
  assert.equal(git(root, ['rm', '--cached', '-q', '--', rel]).status, 0, `git rm --cached ${rel} failed`);
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8', cwd: root });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** A page whose light `:root` carries the palette, for the "added page" cases. */
const AGREEING_PAGE = `<!DOCTYPE html><html><head><style>
  :root{--primary:#2E6FF2;--teal:#17C3A2}
</style></head><body></body></html>
`;

/* ═══════════════════════════════════════════════════════════════════════════ */

describe('the repository it ships in', () => {
  test('the real tree has one palette', () => {
    const r = run(REPO);
    assert.equal(r.code, 0, `expected the live repository to be green:\n${r.all}`);
    assert.match(r.out, /^ok {2}one palette —/m);
  });

  test('the ok line states how many pages and how many properties were compared', () => {
    const r = run(REPO);
    assert.match(r.out, /\d+ page\(s\) \+ the STYLE constant/);
    assert.match(r.out, /agree on \d+ shared propert\(ies\) across \d+ scope\(s\)/);
    assert.match(r.out, /\d+ `:root` block\(s\), \d+ declaration\(s\)/);
    assert.match(r.out, /\d+ dated snapshot\(s\) excluded/);
  });

  test('it names the three dated snapshots it excluded, on a PASSING run', () => {
    const r = run(REPO);
    assert.match(r.out, /dated legal snapshot\(s\) excluded from the comparison/);
    assert.match(r.out, /sites\/nikatru\/legal\/2026-08-10\/en\/privacy\.html/);
  });

  test('the unmutated fixture reproduces that green run', () => {
    const r = run(fixture());
    assert.equal(r.code, 0, `the fixture must start clean:\n${r.all}`);
  });
});

describe('a disagreement is found and located', () => {
  test('one page changing --text fails, naming the property and both values', () => {
    const r = run(patch(fixture(), 'sites/nikatru/pricing.html', '--text:#1E293B', '--text:#334155'));
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /--text is declared 2 different ways in the light palette/);
    assert.match(r.err, /#1e293b/);
    assert.match(r.err, /#334155/);
  });

  test('it names the OUTLIER file, with a line number', () => {
    const r = run(patch(fixture(), 'sites/nikatru/pricing.html', '--text:#1E293B', '--text:#334155'));
    assert.match(r.err, /sites\/nikatru\/pricing\.html:\d+/);
  });

  test('it names every file on the MAJORITY side too, not just the outlier', () => {
    const r = run(patch(fixture(), 'sites/nikatru/pricing.html', '--text:#1E293B', '--text:#334155'));
    assert.match(r.err, /sites\/nikatru\/terms\.html:\d+/);
    assert.match(r.err, /sites\/_shared\/assets\/tokens\.css:\d+/);
  });

  test('the reported line number is the line the declaration is actually on', () => {
    const root = patch(fixture(), 'sites/nikatru/pricing.html', '--text:#1E293B', '--text:#334155');
    const r = run(root);
    const m = r.err.match(/sites\/nikatru\/pricing\.html:(\d+)/);
    assert.ok(m, `no citation for the mutated page:\n${r.all}`);
    const line = readFileSync(join(root, 'sites/nikatru/pricing.html'), 'utf8').split('\n')[Number(m[1]) - 1];
    assert.match(line, /--text:#334155/);
  });

  test('a multi-line comment above a declaration does not shift its citation', () => {
    const root = patch(fixture(), TOKENS, '--text: #1E293B', '--text: #334155');
    const r = run(root);
    const m = r.err.match(/sites\/_shared\/assets\/tokens\.css:(\d+)/);
    assert.ok(m, `no citation for tokens.css:\n${r.all}`);
    const line = readFileSync(join(root, TOKENS), 'utf8').split('\n')[Number(m[1]) - 1];
    assert.match(line, /--text: #334155/);
  });

  test('the dark palette is compared as its own scope', () => {
    const r = run(patch(fixture(), 'sites/nikatru/terms.html', '--card:#111C33', '--card:#101010'));
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /--card is declared 2 different ways in the dark palette/);
  });

  test('light and dark are NOT conflated — the same property legitimately differs', () => {
    // --bg is #F6F8FC in light and #0B1220 in dark on every page. A guard that
    // ignored the enclosing at-rule would report that as a conflict on every run.
    const r = run(fixture());
    assert.equal(r.code, 0, r.all);
    assert.doesNotMatch(r.all, /--bg is declared/);
  });

  test('an unrelated at-rule gets its own scope rather than joining the light palette', () => {
    const root = patch(
      fixture(),
      'sites/nikatru/terms.html',
      '</style>',
      '@media print{:root{--bg:#123456}}\n</style>',
    );
    const r = run(root);
    assert.equal(r.code, 0, `a single declarer under @media print is not a conflict:\n${r.all}`);
  });

  test('…and two pages disagreeing under that at-rule DO fail, named by its scope', () => {
    let root = patch(fixture(), 'sites/nikatru/terms.html', '</style>', '@media print{:root{--bg:#123456}}\n</style>');
    root = patch(root, 'sites/nikatru/refund.html', '</style>', '@media print{:root{--bg:#654321}}\n</style>');
    const r = run(root);
    assert.equal(r.code, 1, r.all);
    // `@media print`, with the space — a media TYPE is two words and the scope
    // key keeps word gaps while dropping the whitespace around punctuation. The
    // first version of this assertion expected `@media(print)` because the guard
    // stripped all whitespace and printed `@mediaprint`; both were wrong.
    assert.match(r.err, /--bg is declared 2 different ways in the @media print palette/);
  });

  test('hex case and the short form are the same colour, not a disagreement', () => {
    const r = run(patch(fixture(), 'sites/nikatru/terms.html', '--card:#FFFFFF', '--card:#ffffff'));
    assert.equal(r.code, 0, `case folding on a hex colour must not redden:\n${r.all}`);
  });

  test('#fff and #FFFFFF are the same colour', () => {
    const r = run(patch(fixture(), 'sites/nikatru/terms.html', '--card:#FFFFFF', '--card:#fff'));
    assert.equal(r.code, 0, `the 3-digit form must not redden:\n${r.all}`);
  });

  test('a property only ONE source declares is not a disagreement', () => {
    // --ico-bg is declared by sites/rajasekarselvam/index.html alone.
    const r = run(fixture());
    assert.doesNotMatch(r.all, /--ico-bg is declared/);
  });
});

describe('the generator constant is in the subject', () => {
  test('editing the STYLE constant alone fails, before anything is regenerated', () => {
    const r = run(patch(fixture(), GENERATOR_REL, '--primary:#2E6FF2', '--primary:#2E6FF3'));
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /--primary is declared 2 different ways in the light palette/);
    assert.match(r.err, /generate-discovery\.mjs \(STYLE\):\d+/);
  });

  test('its citation is a line number in the generator, not in the template', () => {
    const root = patch(fixture(), GENERATOR_REL, '--primary:#2E6FF2', '--primary:#2E6FF3');
    const r = run(root);
    const m = r.err.match(/generate-discovery\.mjs \(STYLE\):(\d+)/);
    assert.ok(m, `no citation for the generator:\n${r.all}`);
    const line = readFileSync(join(root, GENERATOR_REL), 'utf8').split('\n')[Number(m[1]) - 1];
    assert.match(line, /--primary:#2E6FF3/);
  });

  test('renaming the constant is COVERAGE LOST, not a quietly smaller subject', () => {
    const r = run(patch(fixture(), GENERATOR_REL, 'const STYLE = `<style>', 'const PAGE_STYLE = `<style>'));
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /COVERAGE LOST/);
    assert.match(r.err, /no longer declares/);
  });

  test('deleting the generator is COVERAGE LOST', () => {
    const root = fixture();
    unlinkSync(join(root, GENERATOR_REL));
    const r = run(root);
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /is not on disk/);
  });
});

describe('the dated-snapshot exclusion', () => {
  test('a snapshot that DISAGREES does not fail the run — that is the whole point', () => {
    const r = run(patch(fixture(), A_SNAPSHOT, '--text:#1E293B', '--text:#334155'));
    assert.equal(r.code, 0, `a frozen legal record must not be dragged into the palette:\n${r.all}`);
  });

  test('…and the identical edit on a LIVE page does fail — so the exclusion is a real distinction', () => {
    const r = run(patch(fixture(), LIVE_POLICY, '--text:#1E293B', '--text:#334155'));
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, new RegExp(LIVE_POLICY.replace(/[/.]/g, '\\$&')));
  });

  test('an exclusion that matches too few files is COVERAGE LOST, not a pass', () => {
    let root = untrack(fixture(), 'sites/nikatru/legal/2026-07-26/en/privacy.html');
    root = untrack(root, 'sites/nikatru/legal/2026-08-01/en/privacy.html');
    const r = run(root);
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /exclusion matched 1 file\(s\), expected at least 3/);
  });

  test('an archive root that is not there at all is COVERAGE LOST', () => {
    const root = fixture();
    rmSync(join(root, 'sites/nikatru/legal'), { recursive: true, force: true });
    const r = run(root);
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /that directory is not on disk/);
  });

  test('a file under the archive root that is not dated is COVERAGE LOST, never a guess', () => {
    const r = run(add(fixture(), 'sites/nikatru/legal/draft/privacy.html', AGREEING_PAGE));
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /do not match the dated <YYYY-MM-DD>\/<locale>\/ schema/);
    assert.match(r.err, /sites\/nikatru\/legal\/draft\/privacy\.html/);
  });

  test('a NEW dated snapshot is excluded automatically, by schema and not by a list', () => {
    const r = run(add(fixture(), 'sites/nikatru/legal/2026-09-01/en/privacy.html', '<style>:root{--text:#BADBAD}</style>'));
    assert.equal(r.code, 0, `the schema, not a hardcoded list of three:\n${r.all}`);
    assert.match(r.out, /4 dated snapshot\(s\) excluded/);
  });
});

describe('it refuses rather than reporting on a subject it did not read', () => {
  test('a subject-free tree refuses', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    assert.equal(git(root, ['init', '-q']).status, 0);
    const r = run(root);
    assert.notEqual(r.code, 0, `a guard handed nothing must refuse:\n${r.all}`);
    assert.match(r.err, /COVERAGE LOST/);
  });

  test('a directory that is not a git repository refuses', () => {
    const root = join(TMP, `nogit${seq++}`);
    mkdirSync(join(root, 'sites'), { recursive: true });
    const r = run(root);
    assert.notEqual(r.code, 0, r.all);
    assert.match(r.err, /COVERAGE LOST/);
  });

  test('losing one page trips the page floor', () => {
    const r = run(untrack(fixture(), 'sites/nikatru/pricing.html'));
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /16 page\(s\) in the subject, expected at least 17/);
  });

  test('losing a NAMED source gives the named message, not the count one', () => {
    const r = run(untrack(fixture(), LIVE_POLICY));
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /named source\(s\) are not in the compared set/);
    assert.match(r.err, new RegExp(LIVE_POLICY.replace(/[/.]/g, '\\$&')));
    assert.doesNotMatch(r.err, /page\(s\) in the subject/);
  });

  test('a named source that declares no :root at all is COVERAGE LOST', () => {
    // BOTH of tokens.css's blocks — the light one and the dark override. Removing
    // one leaves the file still declaring a palette, which is correctly NOT this
    // limb: it is the block floor, and the test below covers that case.
    const r = run(patch(fixture(), TOKENS, /:root \{/g, 'html body {'));
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /declare no `:root` block at all/);
    assert.match(r.err, /tokens\.css/);
  });

  test('an ordinary page losing its :root trips the block floor', () => {
    const r = run(patch(fixture(), 'sites/nikatru/404.html', ':root{', 'html{'));
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /`:root` block\(s\) parsed across .* expected at least 31/);
  });

  test('a file that is tracked but missing from disk is COVERAGE LOST', () => {
    const root = fixture();
    unlinkSync(join(root, 'sites/nikatru/terms.html'));
    const r = run(root);
    assert.equal(r.code, 2, r.all);
    assert.match(r.err, /tracked but not on disk/);
  });
});

describe('what is NOT in the subject', () => {
  test('an untracked page under sites/ is ignored — this is the _site/ case', () => {
    const root = fixture();
    const abs = join(root, 'sites/_shared/_site/index.html');
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '<style>:root{--text:#BADBAD;--primary:#BADBAD}</style>');
    const r = run(root);
    assert.equal(r.code, 0, `a gitignored Eleventy build deploys nowhere and must not be compared:\n${r.all}`);
  });

  test('…and the SAME bytes tracked DO fail, so the exclusion is the tracking and not the path', () => {
    const r = run(add(fixture(), 'sites/_shared/_site/index.html', '<style>:root{--text:#BADBAD;--primary:#BADBAD}</style>'));
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /--text is declared 2 different ways/);
  });

  test('a :root inside an HTML comment contributes nothing', () => {
    const r = run(
      add(fixture(), 'sites/nikatru/commented.html', `<!-- <style>:root{--text:#BADBAD}</style> -->\n${AGREEING_PAGE}`),
    );
    assert.equal(r.code, 0, `a commented-out palette is not a palette:\n${r.all}`);
  });

  test('a :root inside a CSS comment contributes nothing', () => {
    const r = run(add(fixture(), 'sites/nikatru/commented.css', '/* :root{--text:#BADBAD} */\n:root{--teal:#17C3A2}\n'));
    assert.equal(r.code, 0, `a commented-out palette is not a palette:\n${r.all}`);
  });

  test('…and uncommenting the same bytes DOES fail', () => {
    const r = run(add(fixture(), 'sites/nikatru/commented.css', ':root{--text:#BADBAD}\n'));
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, /--text is declared 2 different ways/);
  });

  test('a non-stylesheet tracked file under sites/ is not read as CSS', () => {
    // sites/nikatru/llms.txt and the _headers files are tracked and contain no
    // stylesheet. If the subject filter widened to "every tracked file", robots
    // and sitemaps would start contributing whatever text happened to parse.
    const r = run(add(fixture(), 'sites/nikatru/notes.txt', ':root{--text:#BADBAD}'));
    assert.equal(r.code, 0, `only .html and .css are stylesheets:\n${r.all}`);
  });
});
