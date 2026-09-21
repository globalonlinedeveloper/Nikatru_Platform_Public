#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// stamp-identity.test.mjs — NO GUARD UNDER tooling/ci MAY TAKE AN IDENTITY FROM
// THE NAME OF THE DIRECTORY IT HAPPENS TO BE RUNNING IN.
//
// [O-STAMP-GUARD-READS-THE-DIRECTORY-NAME-AS-AN-APP-ID]
//
// ── WHAT HAPPENED ───────────────────────────────────────────────────────────
// assert-stamp-brand-assets.mjs resolved the app it was grading from the last
// segment of the working directory. Run with no argument from a linked git
// worktree — which is how guard-sweep.mjs runs it, and how every lane on this
// machine runs it — it graded THE FOLDER THE LANE WAS SITTING IN:
//
//     .worktrees/donut           COVERAGE LOST, no platform claim for "donut"
//     .worktrees/replay-fixture  COVERAGE LOST, … for "replay-fixture"
//
// observed 2026-09-20 by two independent lanes. Those are branch workspaces.
// No catalogue entry for them exists or ever should, and adding one would be
// the wrong repair: a directory name is not an app id.
//
// 🔴 THE COST WAS NEVER THE RED. preflight.mjs files it ENVIRONMENTAL because
// the merge-base reproduces it, so it blocks nothing. What it costs is that a
// guard which cannot run where the work happens carries a PERMANENT coverage
// loss that every lane is trained to scroll past — which is exactly how a real
// finding from that guard would be waved through.
//
// ── WHY THIS FILE IS A CLASS TEST AND NOT A SEVENTH CASE IN ANOTHER SUITE ───
// stamp-brand-assets.test.mjs already pins the BEHAVIOUR of the one guard that
// was caught: run from a checkout named after no app, it must grade the real
// apps. That case is not repeated here. What nothing held was the CLASS. The
// defect is not specific to that guard, it is a shape any guard can regrow in
// an afternoon, and it regrows invisibly: the guard still exits, still prints a
// verdict, and is wrong only on the machines where the work is actually done.
//
// So the subject here is all 160-odd `tooling/ci/assert-*.mjs` at once, and the
// question asked of each is the one the row turns on: does any value derived
// from THIS PROCESS'S WORKING DIRECTORY reach a last-path-segment extraction?
// Taking the working directory as a ROOT is correct and 69 of today's 162
// guards do it — a root is a place. Taking its NAME is the defect — a name is
// an identity, and the filesystem cannot answer a question only the catalogue
// can.
//
// ── WHAT THIS DOES NOT COVER, SAID OUT LOUD ─────────────────────────────────
// A root reached from `import.meta.url` rather than from the working directory.
// In a linked worktree that also yields the worktree's own name, so
// `basename(<module-relative root>)` is the same defect by another road, and
// three files under tooling/scripts take it today — measured 2026-09-21, and
// reported rather than flagged because all three are MITIGATED at the point of
// use: spec-guards.mjs elects the corpus from the MAIN checkout (HOST_ROOT, not
// the worktree — see its 2026-09-08 note) and hands it down in the environment,
// which is the repair this detector would otherwise ask for a second time.
// Widening to that root source without fixing those three first would red main
// over a hazard that is already held. It is a boundary, not an oversight, and
// it is written here so the next reader inherits the measurement instead of
// the silence.
//
// ── HOW IT IS READ, AND WHY NOT WITH A GREP ─────────────────────────────────
// Through `codeMask`, this repository's one answer to which bytes are code:
// comments, string literals and template literals are blanked, substitutions
// inside a template are code again. A plain grep for `basename` matches the
// paragraph you are reading right now, and would match an error message quoting
// the defect it just refused. Both would be prose satisfying a code check, the
// failure this repo has on record more than once.
//
// The detector is a two-step read, not a name list. Step one finds the bindings
// whose initialiser is the working directory; step two asks whether any of them
// — or `process.cwd()` written inline — reaches `basename(…)`, `.split(…).pop()`
// or `.split(…).at(-1)`. A name list would have to be kept in step with 162
// files and would go stale the first time a guard called its root something new.
//
// 🔴 AND STEP ONE ALMOST SHIPPED BLIND TO THE VERY BUG IT IS NAMED AFTER.
// Seeded from `process.cwd()` alone, this detector was run against the REAL
// pre-fix source (a69d7405^) and found NOTHING. That guard never wrote
// `process.cwd()`. It wrote the working directory the way most argv-defaulting
// code in this corpus writes it — a resolve with a dot for the no-argument case:
//
//     const appDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');
//     const appId = basename(appDir);                        // ← the whole row
//
// A dot is the working directory spelled without naming it, and a detector that
// only knows one spelling of its subject is the scanner that quietly stopped
// scanning. Both spellings seed now, and the two lines above are a fixture below
// so this can never be re-narrowed without a red.
//
// ⚠️ THE SEEDS ARE READ WITH COMMENTS STRIPPED AND LITERALS KEPT; the hits are
// read from `codeMask` with both gone. That asymmetry is deliberate and is
// forced by the dot: `codeMask` blanks the INSIDE of every literal, so `'.'` and
// `'x'` are the same three bytes to it, and a seed step reading the mask cannot
// see the dot at all. A literal is part of the VALUE being assigned, so the seed
// step keeps it; a hit is a CALL, so the hit step does not.
//
// ⚠️ AND IT IS PROVED TO STILL FIRE. A detector over a corpus that is already
// clean is an assertion that cannot fail, which is this repository's single most
// repeated defect — the guard that quietly stopped scanning. So six positive
// controls carry the exact shapes and MUST be found — including the two real
// pre-fix lines, and one placed after a block comment so a wrong line number is
// a red — five negative controls carry the near misses (a basename of a child
// path, of a file, of a comment, of a string literal, and a default-to-empty
// -string that is not a path) and MUST NOT be, and the corpus scan refuses unless
// it saw a floor of files AND actually bound working-directory roots in them.
// Delete the resolution in step one and the corpus limb goes vacuously green —
// the floor is what reds it.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The one implementation of "which bytes are code". Blanking comments and
// literals with a local regex would be a second reader of the same question,
// and two readers of one question eventually disagree in silence.
import { codeMask, NON_CODE, stripSourceComments } from '../text-reductions.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CI = join(HERE, '..');

/** The row's two named subjects, pinned BY NAME as well as by the corpus sweep.
 *  The sweep enumerates a directory; if a rename or a move ever took one of
 *  these out of that enumeration, the class limb would go on passing over a
 *  smaller corpus and say nothing. Named here, their disappearance is a red. */
const SUBJECTS = ['assert-stamp-brand-assets.mjs', 'assert-apple-privacy-manifest.mjs'];

/** Floors for the corpus limb. Both are well under today's measurement
 *  (162 files, 69 of them binding a working-directory root; measured
 *  2026-09-21) and exist only to red a scan that stopped reaching its subject —
 *  not to be a ratchet. */
const MIN_GUARDS_SCANNED = 120;
const MIN_FILES_BINDING_A_RUN_DIR_ROOT = 25;

// ── the detector ────────────────────────────────────────────────────────────

/** `source` with every non-code byte replaced by a space — EXCEPT a newline,
 *  which is kept as itself.
 *
 *  Same length either way, so offsets survive; replacement never deletion, so
 *  nothing joins across a removed comment. The newline exception is not
 *  cosmetic and was measured: `codeMask` blanks every byte of a block comment
 *  INCLUDING its line breaks, so flattening them made a hit inside
 *  assert-ops-register.mjs report line 1476 for code that lives on line 1580 —
 *  a finding pointing 104 lines away from itself, drifting further down the
 *  file the more JSDoc it had passed. A guard whose line number is wrong sends
 *  its reader to the wrong repair, which is most of what a finding is for. */
function codeOnly(source) {
  const mask = codeMask(source);
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i++) {
    out[i] = mask[i] !== NON_CODE ? source[i] : source[i] === '\n' ? '\n' : ' ';
  }
  return out.join('');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ID = '[A-Za-z_$][A-Za-z0-9_$]*';
/** `process.cwd()` with any spacing. Written as a pattern rather than a literal
 *  because the spacing is not part of the meaning. */
const CWD_CALL = 'process\\s*\\.\\s*cwd\\s*\\(\\s*\\)';

/** THE WORKING DIRECTORY, IN EVERY SPELLING THIS CORPUS USES. Naming it
 *  (`process.cwd()`), resolving nothing (`resolve()`), or resolving a dot —
 *  bare, or as the fallback an argument beats, which is the argv-defaulting
 *  idiom and is what the real defect was written in. An empty string counts
 *  wherever a dot does: resolving it is also the working directory, and this
 *  repo has paid for that once already in the signing helpers.
 *
 *  🔴 THE FALLBACK FORM MUST BE INSIDE A `resolve(…)` AND THAT IS NOT A
 *  TIGHTENING FOR NEATNESS. Written as a bare `?? ''`, this matched
 *  `String(row?.mechanism?.anchor ?? '')` in assert-ops-register.mjs and filed
 *  four findings against a workflow anchor that has nothing to do with any
 *  directory — a default-to-empty-string is not a path at all. A detector that
 *  cries wolf on the largest guard in the tree is a detector the next reader
 *  turns off. */
const WORKING_DIR = (init) =>
  new RegExp(CWD_CALL).test(init) ||
  /\bresolve\s*\(\s*\)/.test(init) ||
  /\bresolve\s*\(\s*['"]\.?['"]\s*\)/.test(init) ||
  (/\bresolve\s*\(/.test(init) && /(?:\?\?|\|\|)\s*['"]\.?['"]/.test(init));

/**
 * The identifiers in `source` that hold THIS PROCESS'S WORKING DIRECTORY.
 *
 * Seeded from any binding whose initialiser IS the working directory in any of
 * the spellings above. Then up to three alias hops, so a root copied or
 * re-resolved into a second name is still a root; beyond that a path has almost
 * always been joined with something and is a child rather than the run
 * directory itself.
 *
 * Takes COMMENT-STRIPPED source with literals intact — see the header: the dot
 * that makes `?? '.'` the working directory is invisible under the code mask.
 */
function runDirIdentifiers(source) {
  const code = stripSourceComments(source, '.mjs');
  const roots = new Set();
  const decl = new RegExp(`(?:const|let|var)\\s+(${ID})\\s*=\\s*([^;\\n]*)`, 'g');
  for (const m of code.matchAll(decl)) {
    if (WORKING_DIR(m[2])) roots.add(m[1]);
  }
  const alias = new RegExp(
    `(?:const|let|var)\\s+(${ID})\\s*=\\s*(?:resolve|normalize)?\\s*\\(?\\s*(${ID})\\s*\\)?\\s*;`,
    'g',
  );
  for (let pass = 0; pass < 3; pass++) {
    for (const m of code.matchAll(alias)) if (roots.has(m[2])) roots.add(m[1]);
  }
  return roots;
}

/**
 * Every place in `source` where the run directory's own NAME is taken.
 *
 * Returns `{ roots, hits }` so a caller can tell "nothing was found" from
 * "nothing was looked at" — the distinction the whole row is about.
 *
 * `basename(join(ROOT, 'apps', slug))` is deliberately NOT a hit: that is the
 * name of a child the tree was asked for, not the name of the folder the
 * process was started in. Only the root itself, bare or re-resolved.
 */
function identityFromRunDir(source) {
  const code = codeOnly(source);
  const roots = runDirIdentifiers(source);
  const rootExpr = `(?:${[CWD_CALL, ...[...roots].map(esc)].join('|')})`;
  const patterns = [
    new RegExp(`\\bbasename\\s*\\(\\s*(?:resolve\\s*\\(\\s*)?${rootExpr}\\s*\\)?\\s*\\)`, 'g'),
    new RegExp(
      `${rootExpr}\\s*\\.\\s*split\\s*\\([^)]*\\)\\s*\\.\\s*(?:pop\\s*\\(\\s*\\)|at\\s*\\(\\s*-\\s*1\\s*\\))`,
      'g',
    ),
  ];
  const hits = [];
  for (const p of patterns) {
    for (const m of code.matchAll(p)) {
      hits.push({ line: code.slice(0, m.index).split('\n').length, text: m[0].replace(/\s+/g, ' ') });
    }
  }
  return { roots: [...roots], hits };
}

// ── the fixtures the detector is graded against ─────────────────────────────
// Spelled as code in a template literal so `codeMask` sees them as the string
// they are; the detector is handed the text, never this file.

const POSITIVE_BASENAME_OF_ROOT = [
  'const ROOT = process.cwd();',
  'const appId = basename(ROOT);',
].join('\n');

const POSITIVE_BASENAME_INLINE = ['const appId = basename(process.cwd());'].join('\n');

const POSITIVE_SPLIT_POP = [
  'const repoRoot = resolve(process.argv[2] ?? process.cwd());',
  'const slug = repoRoot.split(sep).pop();',
].join('\n');

const POSITIVE_THROUGH_AN_ALIAS = [
  'const ROOT = process.cwd();',
  'const here = resolve(ROOT);',
  'const name = basename(here);',
].join('\n');

/** VERBATIM from assert-stamp-brand-assets.mjs at a69d7405^ — the two lines the
 *  row was filed over, kept here as the detector's hardest control. Seeded from
 *  `process.cwd()` alone this fixture is invisible, which is exactly what the
 *  first draft of this file measured. */
const POSITIVE_THE_REAL_DEFECT = [
  "const appDir = resolve(args.find((a) => !a.startsWith('--')) ?? '.');",
  'const appId = basename(appDir);',
].join('\n');

const NEGATIVE_CHILD_PATH = [
  'const ROOT = process.cwd();',
  "const name = basename(join(ROOT, 'apps', slug));",
].join('\n');

const NEGATIVE_FILE_PATH = [
  "const p = join(dir, 'Icon-192.png');",
  'const file = basename(p);',
].join('\n');

/** VERBATIM in shape from assert-ops-register.mjs — a default-to-empty-string
 *  that is not a path. The first widening of the seed matched this four times
 *  in that one file. */
const NEGATIVE_EMPTY_STRING_DEFAULT = [
  "const anchor = String(row?.mechanism?.anchor ?? '');",
  "const wfFile = anchor.split('/').pop();",
].join('\n');

/** A hit AFTER a block comment. `codeMask` blanks a block comment's newlines
 *  too, so a reader that does not put them back reports a line number that
 *  drifts further from the truth the more prose it has walked past. */
const POSITIVE_AFTER_A_BLOCK_COMMENT = [
  'const ROOT = process.cwd();',
  '/*',
  ' * four',
  ' * lines',
  ' */',
  'const appId = basename(ROOT);',
].join('\n');

const NEGATIVE_IN_A_COMMENT = [
  'const ROOT = process.cwd();',
  '// until today this read basename(ROOT), which graded the folder',
].join('\n');

const NEGATIVE_IN_A_LITERAL = [
  'const ROOT = process.cwd();',
  "fail('this guard must never call basename(ROOT) to name an app');",
].join('\n');

// ── a checkout whose directory name is no app ───────────────────────────────

const TMP = mkdtempSync(join(tmpdir(), 'stamp-identity-'));
process.on('exit', () => {
  try {
    rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* a temp directory that will not delete is not a test result */
  }
});

/** A checkout at `<tmp>/.worktrees/<name>` — the real shape the defect was seen
 *  in — holding one app directory whose name is NOT the folder's. */
function worktreeCheckout(name) {
  const root = join(TMP, `w${Math.random().toString(36).slice(2)}`, '.worktrees', name);
  mkdirSync(join(root, 'apps', 'probe'), { recursive: true });
  return root;
}

/** The guard, bounded. An unbounded spawn in a test is the same silent hang the
 *  guards themselves are bounded against. */
function runGuard(guard, argv) {
  const r = spawnSync(process.execPath, [join(CI, guard), ...argv], {
    encoding: 'utf8',
    timeout: 120_000,
    killSignal: 'SIGKILL',
  });
  assert.equal(r.error?.code, undefined, `${guard} did not answer: ${r.error?.message}`);
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('no guard takes an identity from the directory it runs in', () => {
  // ── the detector's own controls ───────────────────────────────────────────
  // Without these four, the corpus limb below is an assertion that cannot fail.

  test('detector FIRES on basename() of a root bound from the working directory', () => {
    const { roots, hits } = identityFromRunDir(POSITIVE_BASENAME_OF_ROOT);
    assert.deepEqual(roots, ['ROOT']);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].text, /basename\(ROOT\)/);
  });

  test('detector FIRES on basename(process.cwd()) written inline', () => {
    const { hits } = identityFromRunDir(POSITIVE_BASENAME_INLINE);
    assert.equal(hits.length, 1, JSON.stringify(hits));
  });

  test('detector FIRES on the split/pop spelling of the same theft', () => {
    const { roots, hits } = identityFromRunDir(POSITIVE_SPLIT_POP);
    assert.deepEqual(roots, ['repoRoot']);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].text, /repoRoot\.split\(sep\)\.pop\(\)/);
  });

  test('detector FIRES through an alias of the root', () => {
    const { roots, hits } = identityFromRunDir(POSITIVE_THROUGH_AN_ALIAS);
    assert.ok(roots.includes('here'), `alias not resolved: ${roots}`);
    assert.equal(hits.length, 1, JSON.stringify(hits));
  });

  test('detector FIRES on the REAL pre-fix source, where the dot is the only cwd', () => {
    const { roots, hits } = identityFromRunDir(POSITIVE_THE_REAL_DEFECT);
    assert.deepEqual(roots, ['appDir'], 'a resolved dot IS the working directory');
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.match(hits[0].text, /basename\(appDir\)/);
  });

  test('detector is SILENT on basename() of a child path under the root', () => {
    const { roots, hits } = identityFromRunDir(NEGATIVE_CHILD_PATH);
    assert.deepEqual(roots, ['ROOT'], 'the root must still be bound, or this proves nothing');
    assert.deepEqual(hits, []);
  });

  test('detector is SILENT on basename() of an ordinary file path', () => {
    const { hits } = identityFromRunDir(NEGATIVE_FILE_PATH);
    assert.deepEqual(hits, []);
  });

  test('detector is SILENT on a default-to-empty-string that is not a path', () => {
    const { roots, hits } = identityFromRunDir(NEGATIVE_EMPTY_STRING_DEFAULT);
    assert.deepEqual(roots, [], 'a `?? \'\'` outside a resolve() is not the working directory');
    assert.deepEqual(hits, []);
  });

  test('a hit after a block comment reports its OWN line', () => {
    const { hits } = identityFromRunDir(POSITIVE_AFTER_A_BLOCK_COMMENT);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].line, 6, 'the block comment\'s newlines were eaten');
  });

  test('detector is SILENT on the shape written in a comment', () => {
    const { roots, hits } = identityFromRunDir(NEGATIVE_IN_A_COMMENT);
    assert.deepEqual(roots, ['ROOT'], 'the root must still be bound, or this proves nothing');
    assert.deepEqual(hits, [], 'a comment is prose, not code');
  });

  test('detector is SILENT on the shape quoted inside a string literal', () => {
    const { roots, hits } = identityFromRunDir(NEGATIVE_IN_A_LITERAL);
    assert.deepEqual(roots, ['ROOT'], 'the root must still be bound, or this proves nothing');
    assert.deepEqual(hits, [], 'an error message quoting the defect is not the defect');
  });

  // ── the class ─────────────────────────────────────────────────────────────

  test('every tooling/ci/assert-*.mjs is clean, over a corpus proved to be reached', () => {
    const guards = readdirSync(CI)
      .filter((n) => n.startsWith('assert-') && n.endsWith('.mjs'))
      .sort();

    let boundARoot = 0;
    const flagged = [];
    for (const g of guards) {
      const { roots, hits } = identityFromRunDir(readFileSync(join(CI, g), 'utf8'));
      if (roots.length) boundARoot++;
      for (const h of hits) flagged.push(`${g}:${h.line} — ${h.text}`);
    }

    // The two floors, BEFORE the verdict. A scan that stopped reaching the tree
    // finds nothing wrong, and that must never share an outcome with a clean one.
    assert.ok(
      guards.length >= MIN_GUARDS_SCANNED,
      `only ${guards.length} guard(s) enumerated under ${CI} — the scan lost its subject.`,
    );
    assert.ok(
      boundARoot >= MIN_FILES_BINDING_A_RUN_DIR_ROOT,
      `only ${boundARoot} of ${guards.length} guard(s) bound a working-directory root. ` +
        'The corpus has not stopped taking process.cwd() as a root, so the resolution step ' +
        'has stopped resolving and every verdict below is vacuous.',
    );

    assert.deepEqual(
      flagged,
      [],
      'a guard takes its identity from the name of the directory it runs in:\n  ' +
        `${flagged.join('\n  ')}\n` +
        '  A directory name is not an app id. Resolve the subject from the TREE being graded — ' +
        'its own catalog/apps.json, or the directory the guard was pointed at.',
    );
  });

  test("the row's two named subjects are in that corpus and clean", () => {
    const present = readdirSync(CI);
    for (const s of SUBJECTS) {
      assert.ok(present.includes(s), `${s} is no longer under ${CI}; the sweep above lost a subject.`);
      const { hits } = identityFromRunDir(readFileSync(join(CI, s), 'utf8'));
      assert.deepEqual(hits, [], `${s}: ${JSON.stringify(hits)}`);
    }
  });

  // ── behaviour, from a path named after no app ─────────────────────────────
  // The static limb proves the shape is gone. This proves the consequence: the
  // guard grades the tree it was handed, and the folder's name never becomes a
  // subject. assert-apple-privacy-manifest.mjs is the subject here because it
  // needs no SDK; stamp-brand-assets.test.mjs owns the same case for the other.

  test('assert-apple-privacy-manifest grades the tree it was given, not the folder holding it', () => {
    const root = worktreeCheckout('donut');
    const { code, out } = runGuard('assert-apple-privacy-manifest.mjs', [root]);

    // COVERAGE LOST, because a checkout with one app and no Apple audit has
    // nothing to grade — and that is the verdict this case wants: it names the
    // app directory it COUNTED, out of the tree it was handed.
    assert.equal(code, 2, out);
    assert.match(out, /1 app director(?:y|ies) under apps\//, out);
    assert.doesNotMatch(out, /"donut"/, 'a worktree folder is not an app');
    assert.doesNotMatch(out, /for donut\b/, 'a worktree folder is not an app');
  });

  test('the same guard reports over a DIFFERENT folder name identically', () => {
    const rootA = worktreeCheckout('donut');
    const rootB = worktreeCheckout('replay-fixture');
    const a = runGuard('assert-apple-privacy-manifest.mjs', [rootA]);
    const b = runGuard('assert-apple-privacy-manifest.mjs', [rootB]);

    // The property the row is actually about: RENAME INVARIANCE. Two checkouts
    // that differ only in the name of the folder holding them must produce the
    // same verdict. Any reading of the directory name breaks this, whatever
    // spelling it is written in — which is why this case is here beside the
    // static one rather than instead of it.
    //
    // ⚠️ EACH RUN'S OWN ROOT IS BLANKED WHOLE, not just the folder name. A guard
    // is entitled to PRINT the path it was given — that is naming its subject,
    // not taking an identity from it — and these two fixtures sit under
    // different random temp directories, so comparing the raw text would red on
    // the parent segments and say "rename-sensitive" about something else.
    const norm = (out, root) => out.split(root).join('<ROOT>').replace(/\\/g, '/');
    assert.equal(a.code, b.code, `${a.out}\n---\n${b.out}`);
    assert.equal(norm(a.out, rootA), norm(b.out, rootB));

    // …and the blanking must not be what makes them equal: the folder name has
    // to be gone from the normalised text, or this case would pass over a guard
    // that printed nothing at all.
    assert.doesNotMatch(norm(a.out, rootA), /donut/);
    assert.doesNotMatch(norm(b.out, rootB), /replay-fixture/);
    assert.ok(norm(a.out, rootA).trim().length > 0, 'a guard that printed nothing proves nothing');
  });
});
