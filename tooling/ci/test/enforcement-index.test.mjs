// ─────────────────────────────────────────────────────────────────────────────
// enforcement-index.test.mjs — assert-enforcement-index.mjs must be able to FAIL.
//
// Pipeline requirement: Private/requirements/ → F-10.
//
// The Enforcement Index is the JOIN between a requirement and the thing that
// actually enforces it. It is REGENERATED FROM THE TREE and DIFFED against the
// committed file. That property is what this suite keeps true, because the
// alternative — a checked-in digest — was already broken by a challenger who
// recomputed the checksum, pasted it in, and watched the guard go green.
//
// REAL-TREE MUTATIONS PERFORMED, AND THEIR OBSERVED VERDICTS. Run against a
// full copy of this repository (tooling/ + .github/workflows/ mirrored to a
// scratch root), not against the fixtures below. A fixture passing is not a
// guard working — assert-seams-wired shipped broken with all six fixture tests
// green.
//
//   M1  delete one WIRED row from the committed index      exit 1 — reported BOTH
//                                                          as a `−` diff and as a
//                                                          missing-row population
//                                                          failure
//   M2  add a fabricated row for a file not on disk        exit 1 — `+` diff, plus
//                                                          "does not exist", plus
//                                                          "that job never names it"
//   M3  rewrite one row's `claims` to an uncited id        exit 1 — `≠ .claims`
//   M5  retype the ci.yml LANE row as kind `none`          exit 1 — `≠ .kind` AND
//                                                          "declares 1 LANE-enforced
//                                                          item(s) and the index
//                                                          carries no `lane` row"
//   M6  flip an ORPHAN row to WIRED with a real job name   exit 1 — `≠` ×2 and
//                                                          "that job never names it"
//   M7  add a `digest` field to a row                      exit 1 — digest refused
//   M8  delete the committed index                         exit 1 — COVERAGE LOST
//   M9  🔴 UNDER-COLLECT: patch the GENERATOR to drop 20   exit 1 — the byte diff is
//       guards, regenerate, and commit BOTH halves so the  CLEAN and the population
//       comparison is byte-clean                           identity still names all
//                                                          20 missing enforcers
//   M10 leave the tree correct                             exit 0, 2 orphans PRINTED
//   M11 (R1) drop one ref from tooling/guard-yield.json    exit 1 — the ref named,
//                                                          with the --sync command.
//                                                          The guard BEFORE section 8
//                                                          exited 0 on the same tree:
//                                                          the gap was invisible
//   M12 (R3) delete tooling/guard-yield.json               exit 2 — COVERAGE LOST
//
// M9 is the one that matters. Regeneration alone proves only that the committed
// file was not hand-edited; a generator that under-collects under-collects in
// both halves and the diff is empty. The population identity in section 4 —
// tooling/ci listed by the GUARD, through tree-walk — is the claim the
// generator cannot define away, and M9 is its negative test.
//
// ⚠️ EVERY FIXTURE FILENAME HERE IS INVENTED (assert-alpha/beta/orphan, ids
// Z-1…Z-9). assert-guard-coverage decides a guard HAS a negative test by asking
// whether its filename appears in EXECUTABLE code anywhere in this directory —
// including this file. Writing a real guard's name into a fixture would hand it
// a recorded failing case it does not have. The one real name below is the
// guard under test, which is the point.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { YIELD_REL, buildYield, serialiseYield } from '../../ops/guard-yield.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-enforcement-index.mjs');
const GENERATOR = join(CI_DIR, 'build-enforcement-index.mjs');
const INDEX_REL = 'tooling/enforcement-index.json';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-enfidx-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });
let seq = 0;

// ── the fixture tree ─────────────────────────────────────────────────────────
// Small on purpose: every property under test is visible in one screen, and no
// number here has to be ratcheted as the real tree grows.

/** WIRED by a plain `run:`. Cites Z-1 in its header and mentions Z-7 inside a
 *  STRING LITERAL, which must NOT become a claim — four real guards name their
 *  requirement only in their own failure text and claim nothing. */
const ALPHA = [
  '#!/usr/bin/env node',
  '// assert-alpha.mjs — fixture stand-in. [pipeline Z-1]',  // (never existed) — invented fixture id
  "import { helper } from './helper-lib.mjs';",
  "console.error('COVERAGE LOST — fixture stand-in with no subject');",
  "console.error('  the rule it obeys is [pipeline Z-7]');",  // (never existed) — invented fixture id
  'if (helper()) process.exit(1);',
  '',
].join('\n');

/** WIRED only from inside a multi-line `run: |` through a command substitution
 *  — the ops-watch digest shape. A line-anchored `run: node …` matcher reports
 *  this file ORPHAN, so the count-pinned passing case catches that class. */
const BETA = [
  '#!/usr/bin/env node',
  '// assert-beta.mjs — fixture stand-in.',
  '// [pipeline 3]Z-2 · Z-3 (two ids, stage prefix on the first only)',
  "console.error('COVERAGE LOST — fixture stand-in with no subject');",
  'process.exit(1);',
  '',
].join('\n');

/** Named by ci.yml ONLY in a `#` comment and in an `on.push.paths` filter — the
 *  two shapes that read as invocations to a matcher that does not strip
 *  comments and does not know a trigger filter from a step. Neither runs it. */
const ORPHAN = [
  '#!/usr/bin/env node',
  '// assert-orphan.mjs — fixture stand-in. [pipeline Z-4]',  // (never existed) — invented fixture id
  "console.error('COVERAGE LOST — fixture stand-in with no subject');",
  'process.exit(1);',
  '',
].join('\n');

/** No process.exit, no process.argv, imported by an invoked guard. LIBRARY. */
const HELPER = ['// helper-lib.mjs — reached only through the import graph.', 'export const helper = () => true;', ''].join('\n');

/** The generator reads NOT_CI_RUNNABLE out of this declaration rather than
 *  keeping a second copy of the names. The fixture supplies the real shape. */
const COVERAGE = [
  '#!/usr/bin/env node',
  '// assert-guard-coverage.mjs — fixture stand-in.',
  'const NOT_CI_RUNNABLE = new Map([',
  '  [',
  "    'assert-refuses.mjs',",
  '    { since: "2026-01-01", probe: [], why: "fixture" },',
  '  ],',
  ']);',
  "console.error('COVERAGE LOST — fixture stand-in');",
  'process.exit(NOT_CI_RUNNABLE.size ? 1 : 1);',
  '',
].join('\n');

/** In NOT_CI_RUNNABLE above: unreached, and unreached ON PURPOSE. */
const REFUSES = [
  '#!/usr/bin/env node',
  '// assert-refuses.mjs — fixture stand-in. [pipeline Z-5]',  // (never existed) — invented fixture id
  "console.error('COVERAGE LOST — fixture stand-in');",
  'process.exit(2);',
  '',
].join('\n');

/** The window fixture. Its ONE citation sits ~85 lines down, far past the
 *  60-line cap this reader carried until 2026-09-07, and an equally deep STRING
 *  LITERAL names a second id that must still never be compiled. Before the
 *  widening the row for this file claimed nothing at all: 30 real guards in
 *  tooling/ci were in exactly that state, including four whose headers had been
 *  rearranged by hand to keep a citation inside the window. */
const DEEP = [
  '#!/usr/bin/env node',
  '// assert-deep.mjs — fixture stand-in with a LONG header.',
  ...Array.from({ length: 80 }, (_, i) => `// paragraph ${i + 1} of a header that grew, as real guard headers do`),
  '// [pipeline Z-6] — the claim, ~83 lines down.',  // (never existed) — invented fixture id
  "console.error('COVERAGE LOST — fixture stand-in with no subject');",
  "console.error('  the rule it obeys is [pipeline Z-8]');",  // (never existed) — invented fixture id
  'process.exit(1);',
  '',
].join('\n');

const WORKFLOW = [
  'name: fixture',
  'on:',
  '  push:',
  '    paths:',
  "      - 'tooling/ci/assert-orphan.mjs'",
  'jobs:',
  '  platform:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: node tooling/ci/assert-alpha.mjs',
  '      - run: node tooling/ci/assert-deep.mjs',
  '      - name: the folded form, with the enforcer off the run: line',
  '        run: |',
  '          out="$(node tooling/ci/assert-beta.mjs 2>&1)"',
  '          echo "$out"',
  '      - run: node --test "tooling/ci/test/*.test.mjs"',
  '      # - run: node tooling/ci/assert-orphan.mjs   <- COMMENTED OUT, never runs',
  '  app_brick:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - run: echo brick',
  '',
].join('\n');

const DOD = JSON.stringify(
  {
    humanReviewRows: ['four-states'],
    items: [
      { id: 'A', title: 'a guard-enforced item', enforcedBy: 'guard', check: 'assert-alpha.mjs' },
      { id: 'B', title: 'a human-enforced item', enforcedBy: 'human', check: 'four-states' },
      { id: 'H', title: 'a lane-enforced item', enforcedBy: 'lane', check: 'app_brick' },
    ],
  },
  null,
  2,
);

const DEFAULTS = {
  'tooling/ci/assert-alpha.mjs': ALPHA,
  'tooling/ci/assert-beta.mjs': BETA,
  'tooling/ci/assert-deep.mjs': DEEP,
  'tooling/ci/assert-orphan.mjs': ORPHAN,
  'tooling/ci/assert-refuses.mjs': REFUSES,
  'tooling/ci/assert-guard-coverage.mjs': COVERAGE,
  'tooling/ci/helper-lib.mjs': HELPER,
  'tooling/ci/test/fixture.test.mjs': "test('x', () => {});\n",
  'tooling/dod-register.json': DOD,
};

/**
 * @param opts.files    extra or replacement files; a body of `null` means the
 *                      file is ABSENT — the only way to fixture COVERAGE LOST.
 * @param opts.workflow `null` writes no workflow at all.
 * @param opts.index    `null` writes no index; a function receives the
 *                      generated rows and returns the rows to commit.
 * @param opts.breakAfter files to remove or replace AFTER the index has been
 *                      generated. Breaking a dependency BEFORE generation only
 *                      proves the guard notices a missing index; the limb under
 *                      test is what it does with a VALID index and a tree that
 *                      can no longer be re-derived.
 * @param opts.yieldDoc tooling/guard-yield.json, keyed by the COMMITTED rows so
 *                      every other case isolates its own limb. `null` writes no
 *                      file; a function receives the valid document and returns
 *                      the one to commit.
 */
function fixture({ files = {}, workflow = WORKFLOW, index = (r) => r, breakAfter = {}, yieldDoc = (d) => d } = {}) {
  const root = join(TMP, `f${seq++}`);
  const write = (rel, body) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  for (const [rel, body] of Object.entries({ ...DEFAULTS, ...files })) {
    if (body === null) continue;
    write(rel, body);
  }
  if (workflow !== null) write('.github/workflows/ci.yml', workflow);
  if (index !== null) {
    const gen = spawnSync(process.execPath, [GENERATOR, root], { encoding: 'utf8' });
    if (gen.status === 0) {
      const rows = index(JSON.parse(gen.stdout));
      if (rows !== null) write(INDEX_REL, `${JSON.stringify(rows, null, 2)}\n`);
      if (rows !== null && yieldDoc !== null) {
        const valid = buildYield({ records: [], indexRows: rows, merged: new Set(), since: '2026-09-01T00:00:00Z', until: '2026-09-20T00:00:00Z' });
        write(YIELD_REL, serialiseYield(yieldDoc(valid)));
      }
    }
  }
  for (const [rel, body] of Object.entries(breakAfter)) {
    if (body === null) rmSync(join(root, rel), { force: true });
    else write(rel, body);
  }
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const rowFor = (rows, ref) => {
  const r = rows.find((x) => x.ref === ref);
  assert.ok(r, `the generated index has no row for ${ref} — the mutation would test nothing`);
  return r;
};

describe('assert-enforcement-index — the index is regenerated and compared, never authored', () => {
  // ── the passing case, count-pinned ────────────────────────────────────────
  // Four near-misses ride on this one assertion: beta must be found inside the
  // folded `run: |`; orphan must NOT be found in a comment or a paths: filter;
  // the lane and human rows must exist; and helper-lib must be LIBRARY.
  test('PASSES on a well-formed fixture, and the counts prove it compared something', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /byte-for-byte the index regenerated/);
    assert.match(out, /1 human/);
    assert.match(out, /1 lane/);
    assert.match(out, /all 7 enforcer\(s\) in tooling\/ci carry a row/);
  });

  test('the passing case did NOT lift a requirement id out of a string literal', () => {
    const root = fixture();
    const rows = JSON.parse(readFileSync(join(root, INDEX_REL), 'utf8'));
    assert.deepEqual(rowFor(rows, 'tooling/ci/assert-alpha.mjs').claims, ['DoD A', 'Z-1']);
  });

  test('an enforcer invoked only from inside a folded `run: |` is WIRED, not ORPHAN', () => {
    const root = fixture();
    const rows = JSON.parse(readFileSync(join(root, INDEX_REL), 'utf8'));
    assert.equal(rowFor(rows, 'tooling/ci/assert-beta.mjs').state, 'WIRED');
    assert.deepEqual(rowFor(rows, 'tooling/ci/assert-beta.mjs').claims, ['Z-2', 'Z-3']);
  });

  test('a guard named only in a `#` comment and a paths: filter is ORPHAN', () => {
    const root = fixture();
    const rows = JSON.parse(readFileSync(join(root, INDEX_REL), 'utf8'));
    assert.equal(rowFor(rows, 'tooling/ci/assert-orphan.mjs').state, 'ORPHAN');
    assert.deepEqual(rowFor(rows, 'tooling/ci/assert-orphan.mjs').invokedBy, []);
  });

  // ── the tree disagrees ────────────────────────────────────────────────────
  test('FAILS when the committed index carries a row the tree does not produce', () => {
    const root = fixture({
      index: (rows) => [...rows, { claims: ['Z-8'], invokedBy: [], kind: 'guard', ref: 'tooling/ci/assert-ghost.mjs', references: [], state: 'ORPHAN' }],
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /DISAGREES with the index regenerated/);
    // `−` is committed-only, `+` is tree-only: the diff reads FROM the
    // committed file TO the tree, because the tree is the authority.
    assert.match(out, /− "tooling\/ci\/assert-ghost\.mjs"/);
  });

  test('FAILS when the tree produces a row the committed index does not carry', () => {
    const root = fixture({ index: (rows) => rows.filter((r) => r.ref !== 'tooling/ci/assert-beta.mjs') });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /\+ "tooling\/ci\/assert-beta\.mjs"/);
  });

  test('FAILS when a row is CHANGED, and names the field that disagrees', () => {
    const root = fixture({
      index: (rows) => rows.map((r) => (r.ref === 'tooling/ci/assert-alpha.mjs' ? { ...r, claims: ['Z-9'] } : r)),
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /≠ "tooling\/ci\/assert-alpha\.mjs"\.claims/);
  });

  // 🔴 TYPED ENFORCEMENT. A DoD item enforced by a ci.yml LANE is not enforced
  // by nothing, and an index saying `none` publishes a FALSE NEGATIVE — the
  // most expensive kind of wrong, because it reads as honesty.
  test('FAILS when the LANE enforcer is retyped as `none`', () => {
    const root = fixture({ index: (rows) => rows.map((r) => (r.kind === 'lane' ? { ...r, kind: 'none' } : r)) });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /LANE-enforced item\(s\) and the index carries no `lane` row/);
  });

  test('FAILS when the HUMAN enforcer is dropped from the index', () => {
    const root = fixture({ index: (rows) => rows.filter((r) => r.kind !== 'human') });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /HUMAN-enforced item\(s\) and the index carries no `human` row/);
  });

  test('a LANE ref is resolved as a JOB, never as a file path', () => {
    const root = fixture({ index: (rows) => rows.map((r) => (r.kind === 'lane' ? { ...r, ref: '.github/workflows/ci.yml#no_such_job' } : r)) });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /is a LANE enforcer and no workflow declares that job/);
  });

  // ── the forged WIRED ──────────────────────────────────────────────────────
  test('FAILS when a WIRED row names a job that does not actually invoke it', () => {
    const root = fixture({
      index: (rows) =>
        rows.map((r) => (r.ref === 'tooling/ci/assert-orphan.mjs' ? { ...r, state: 'WIRED', invokedBy: ['.github/workflows/ci.yml#platform'] } : r)),
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /that job never names it/);
  });

  // ── the orphan PRINTS ─────────────────────────────────────────────────────
  test('an ORPHAN row is PRINTED, not failed — the index reports it, it does not police it', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
    assert.match(out, /⬜ ORPHAN — "tooling\/ci\/assert-orphan\.mjs"/);
  });

  // ── 🔴 THE FORGERY ────────────────────────────────────────────────────────
  // The committed file below is INTERNALLY PERFECT: the ORPHAN row is gone, its
  // claim moved onto a WIRED row so no id is lost, rows still sorted, every ref
  // still resolvable, no digest to recompute because there is none. A reviewer
  // reading the FILE finds nothing. Only regenerating from the TREE finds it.
  test('🔴 FORGERY: a self-consistent hand-edited index is STILL caught', () => {
    let forged;
    const root = fixture({
      index: (rows) => {
        const out = rows
          .filter((r) => r.ref !== 'tooling/ci/assert-orphan.mjs')
          .map((r) => (r.ref === 'tooling/ci/assert-alpha.mjs' ? { ...r, claims: [...r.claims, 'Z-4'].sort() } : r));
        forged = out;
        return out;
      },
    });
    const refs = forged.map((r) => r.ref);
    assert.deepEqual(refs, [...refs].sort(), 'the forgery must be sorted, or sorting alone would catch it');
    assert.equal(JSON.stringify(forged).includes('digest'), false);
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /\+ "tooling\/ci\/assert-orphan\.mjs"/);
    assert.match(out, /have NO ROW in the index/);
  });

  test('🔴 FORGERY: a digest field anywhere in the document is REFUSED, not ignored', () => {
    const root = fixture({ index: (rows) => rows.map((r, i) => (i === 0 ? { ...r, sha256: 'deadbeef' } : r)) });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /carries a stored digest/);
  });

  test('🔴 FORGERY: the guard reads NO digest, checksum or timestamp out of the committed file', () => {
    const code = readFileSync(GUARD, 'utf8')
      .split(/\r?\n/)
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
      })
      .join('\n');
    assert.doesNotMatch(
      code,
      /\bcreateHash\b|\bcrypto\b/,
      'a field a forger can recompute is a field that has already been recomputed — a challenger did exactly that',
    );
  });

  // ── coverage self-checks ──────────────────────────────────────────────────
  test('COVERAGE LOST when the committed index is absent', () => {
    const { code, out } = run(fixture({ index: null }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /enforcement-index\.json/);
  });

  test('COVERAGE LOST when the committed index is not valid JSON', () => {
    const root = fixture();
    writeFileSync(join(root, INDEX_REL), '{ "rows": [ }\n');
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the committed index has ZERO rows', () => {
    const root = fixture({ index: () => [] });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /ZERO rows/);
  });

  test('COVERAGE LOST when there is no workflow to read invocations from', () => {
    // Without workflows every enforcer reads ORPHAN and an index regenerated in
    // that state compares clean — the exact shape of a scan that stopped.
    const { code, out } = run(fixture({ workflow: null }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when tooling/dod-register.json is absent', () => {
    // It is the only public statement that a DoD item is enforced by a job or a
    // person. Without it both would be published as enforced by nothing.
    const { code, out } = run(fixture({ breakAfter: { 'tooling/dod-register.json': null } }));
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /dod-register/);
  });

  test('COVERAGE LOST when the NOT_CI_RUNNABLE declaration cannot be read', () => {
    // Unread, every deliberately-unreached guard is published as an ORPHAN — a
    // finding about a decision somebody already made.
    const { code, out } = run(
      fixture({ breakAfter: { 'tooling/ci/assert-guard-coverage.mjs': '#!/usr/bin/env node\nprocess.exit(1);\n' } }),
    );
    assert.equal(code, 2);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /NOT_CI_RUNNABLE/);
  });

  test('COVERAGE LOST on a subject-free tree — the shape assert-guards-refuse-empty spawns', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.notEqual(code, 0);
    assert.match(out, /COVERAGE LOST/);
  });

  // ── THE CITATION WINDOW ───────────────────────────────────────────────────
  // Until 2026-09-07 the generator read the first 60 lines of a guard and
  // stopped. Measured on the tree at ec404f0d: 156 enforcers in tooling/ci, 65
  // citing an ADR on a comment line, and 30 of them citing one ONLY below line
  // 60 — so the index recorded no claim for any of those 30, and two guards
  // carried a hand-written paragraph saying their citation had been MOVED to
  // survive the cap. These three cases hold both halves of the widening: a deep
  // COMMENT citation is compiled, a deep STRING LITERAL is not, and the guard
  // still fails when the committed index disagrees about either.
  test('GREEN CONTROL — a citation ~83 lines down is a claim, and the literal beside it is not', () => {
    const root = fixture();
    const rows = JSON.parse(readFileSync(join(root, INDEX_REL), 'utf8'));
    assert.deepEqual(rowFor(rows, 'tooling/ci/assert-deep.mjs').claims, ['Z-6']);
    assert.equal(rowFor(rows, 'tooling/ci/assert-deep.mjs').state, 'WIRED');
  });

  test('FAILS when the committed index drops the deep claim the tree still states', () => {
    const root = fixture({
      index: (rows) => rows.map((r) => (r.ref === 'tooling/ci/assert-deep.mjs' ? { ...r, claims: [] } : r)),
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /≠ "tooling\/ci\/assert-deep\.mjs"\.claims/);
  });

  // 🔴 THE NEGATIVE TEST FOR THE WINDOW ITSELF. The two cases above would pass
  // just as happily against a generator that had quietly stopped reading at
  // line 60 AND a committed index regenerated from it — that is M9's shape, an
  // under-collection agreeing with itself. So this one mutates the GENERATOR,
  // puts the cap back, and requires the canary inside it to refuse rather than
  // to produce a smaller index. The green control is the line above it: the
  // unmutated generator over the same fixture exits 0.
  test('🔴 putting the 60-line cap back is COVERAGE LOST, not a quieter index', () => {
    const root = fixture();
    const clean = spawnSync(process.execPath, [GENERATOR, root], { encoding: 'utf8' });
    assert.equal(clean.status, 0, `${clean.stdout}${clean.stderr}`);

    const genRoot = join(TMP, `gen${seq++}`, 'tooling', 'ci');
    mkdirSync(genRoot, { recursive: true });
    for (const dep of ['tree-walk.mjs', 'workflow-scan.mjs']) {
      writeFileSync(join(genRoot, dep), readFileSync(join(CI_DIR, dep), 'utf8'));
    }
    const src = readFileSync(GENERATOR, 'utf8');
    // String.raw, because the needle is a REGEX LITERAL: written as an ordinary
    // quoted string its escapes would become a carriage return and a newline and
    // the mutation would silently match nothing.
    const WINDOW = String.raw`const lines = source.split(/\r?\n/);`;
    const capped = src.replace(WINDOW, `${WINDOW.slice(0, -1)}.slice(0, 60);`);
    assert.notEqual(capped, src, 'the window line was not found — this mutation would have tested nothing');
    const mutant = join(genRoot, 'build-enforcement-index.mjs');
    writeFileSync(mutant, capped);

    const r = spawnSync(process.execPath, [mutant, root], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /COVERAGE LOST/);
    assert.match(`${r.stdout}${r.stderr}`, /a line cap is back/);
  });

  // 🔴 THE ONE THAT MATTERS. Regeneration proves the file was not hand-edited;
  // it proves nothing about whether the generator's rule is right. Here BOTH
  // halves agree — and the population identity, derived by the guard from
  // tooling/ci itself, still catches it.
  test('🔴 an UNDER-COLLECTING generator is caught even though the byte diff is CLEAN', () => {
    const root = fixture({ index: (rows) => rows.filter((r) => r.ref !== 'tooling/ci/assert-refuses.mjs') });
    // Prove the premise: the ONLY thing wrong is that a real enforcer has no
    // row. Every remaining row is exactly what the tree produces.
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /have NO ROW in the index/);
    assert.match(out, /assert-refuses\.mjs/);
  });
});

// ── SECTION 8: EVERY INDEX REF HAS A YIELD ENTRY (row O-GUARD-YIELD-UNMEASURED) ──
// tooling/guard-yield.json records each enforcer's catches over PR runs, keyed
// by every index ref. Before section 8 this guard read nothing of it: dropping a
// ref, or the whole file, left it at exit 0 (M11/M12 in the header). The fixture
// writes a valid file keyed by the committed rows; each case below breaks it.
describe('assert-enforcement-index — section 8, the yield file keys every index ref', () => {
  test('GREEN CONTROL — a yield file keying every committed ref passes, and the ok line counts them', () => {
    const root = fixture();
    const rows = JSON.parse(readFileSync(join(root, INDEX_REL), 'utf8'));
    const { code, out } = run(root);
    assert.equal(code, 0, out);
    assert.match(out, new RegExp(`${rows.length} ref\\(s\\) keyed in tooling/guard-yield\\.json`));
  });

  test('R1: one index ref dropped from the yield file is exit 1, naming the ref and the --sync command', () => {
    const root = fixture({
      yieldDoc: (d) => {
        assert.ok(Object.hasOwn(d.perRef, 'tooling/ci/assert-alpha.mjs'), 'the ref this mutation drops is not keyed — it would test nothing');
        delete d.perRef['tooling/ci/assert-alpha.mjs'];
        return d;
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /"tooling\/ci\/assert-alpha\.mjs" is an index ref and tooling\/guard-yield\.json has no entry for it/);
    assert.match(out, /node tooling\/ops\/guard-yield\.mjs --sync/);
  });

  test('a yield key the index does not carry is exit 1 — a removed enforcer still carrying a yield', () => {
    const root = fixture({
      yieldDoc: (d) => {
        d.perRef['tooling/ci/assert-ghost.mjs'] = { catches: 0, firstSeen: '2026-09-01', evidence: [] };
        return d;
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /keys "tooling\/ci\/assert-ghost\.mjs", which is not an index ref/);
  });

  test('R3: the yield file ABSENT is COVERAGE LOST, exit 2 — deleting it is never the way to green', () => {
    const { code, out } = run(fixture({ yieldDoc: null }));
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/guard-yield\.json does not exist/);
  });

  test('the yield file UNPARSEABLE is COVERAGE LOST, exit 2', () => {
    const root = fixture();
    writeFileSync(join(root, YIELD_REL), '{ "perRef": ');
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST — tooling\/guard-yield\.json is not valid JSON/);
  });
});
