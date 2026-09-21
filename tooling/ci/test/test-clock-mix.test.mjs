// ─────────────────────────────────────────────────────────────────────────────
// test-clock-mix.test.mjs — assert-test-clock-mix.mjs must be able to FAIL, must
// stay silent on every SAFE pinned instant, and must refuse when its own
// matchers stop matching.
//
// Register row: O-TEST-CLOCK-LITERAL-THE-WALL-CLOCK-REACHES, the CLASS half.
//
// ⚠️ The guard was mutated against the REAL tree before this file existed:
// restoring `const NOW_MS = Date.parse('2026-09-20T06:00:00.000Z')` in
// services/platform/test/signup-erasure.test.ts turned it RED on both affected
// cases and naming both; restoring the derived clock byte-exact (same sha256)
// turned it green again, with the other eleven pinned instants in
// services/*/test untouched in either direction.
//
// 🔴 THE THREE CASES THAT CARRY THIS FILE are the ones marked below: a literal
// that exists ONLY IN A COMMENT must not fire (the fixed file still spells the
// old literal in the comment explaining why it went, so a raw grep reports the
// FIXED file as the broken one); a pinned instant and a real route drive in
// DIFFERENT cases of one file must not fire (that is the revenuecat-money and
// error-sink shape, and a guard that reddened it would be deleted); and a
// matcher edited into something that can never fire must exit 2, because the
// failure that costs everything here is not the guard being wrong — it is the
// guard reading every file clean and printing ok forever.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-test-clock-mix.mjs');

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-clockmix-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A minimal service tree: `files` maps a repo-relative path to its bytes. */
function tree(files) {
  const root = join(TMP, `r${seq++}`);
  const all = {
    'services/platform/src/scheduled.ts': 'export const erasureRetry = async (_e: unknown, _n: number) => {};\n',
    'services/platform/src/routes/account.ts': 'export default {} as unknown;\n',
    ...files,
  };
  for (const [rel, body] of Object.entries(all)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return root;
}

function run(root, guard = GUARD) {
  const r = spawnSync(process.execPath, [guard, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// The fixture bodies. `clockLine` is the ONLY thing that differs between the
// broken shape and the fix, exactly as it did in the real commit (#843).
// ─────────────────────────────────────────────────────────────────────────────
const IMPORTS =
  "import { describe, it, expect } from 'vitest';\n" +
  "import { Hono } from 'hono';\n" +
  "import { erasureRetry } from '../src/scheduled';\n" +
  "import account from '../src/routes/account';\n";

const DRIVER =
  'async function deleteAccount(db: unknown) {\n' +
  '  const app = new Hono();\n' +
  "  app.route('/v1', account);\n" +
  "  return app.request('/v1/account', { method: 'DELETE' }, db);\n" +
  '}\n';

/** The #842 case: the route stamps its own rows, the retry is handed a pin. */
const mixedCase = (clockLine) =>
  `${IMPORTS}${clockLine}\n${DRIVER}\n` +
  "describe('the retry', () => {\n" +
  "  it('finishes the purge on the night after', async () => {\n" +
  '    const db = {};\n' +
  '    expect((await deleteAccount(db)).status).toBe(202);\n' +
  '    await erasureRetry({ db }, NOW_MS);\n' +
  '    expect(db).toBeTruthy();\n' +
  '  });\n' +
  '});\n';

const PINNED = "const NOW_MS = Date.parse('2026-09-20T06:00:00.000Z');";
const DERIVED = 'const NOW_MS = Date.now() + 24 * 60 * 60 * 1000;';

/** A file with a pinned instant and NO route in it at all — the safe majority
 *  (backup-export, erasure-retry, events-rollup, insights-*, money-rederive,
 *  ops-watchdog, retention-sweep all have this shape). */
const PINNED_ONLY =
  "import { describe, it, expect } from 'vitest';\n" +
  "import { erasureRetry } from '../src/scheduled';\n" +
  `${PINNED}\n` +
  "describe('the retry alone', () => {\n" +
  "  it('is due when the order was seeded from the same constant', async () => {\n" +
  '    await erasureRetry({}, NOW_MS);\n' +
  '    expect(1).toBe(1);\n' +
  '  });\n' +
  '});\n';

/** A file that drives the real route and pins nothing. */
const DRIVE_ONLY =
  `${IMPORTS}${DRIVER}\n` +
  "describe('the route alone', () => {\n" +
  "  it('answers', async () => {\n" +
  '    expect((await deleteAccount({})).status).toBe(200);\n' +
  '  });\n' +
  '});\n';

/** Pinned instant and route drive in the SAME FILE but DIFFERENT cases — this
 *  is revenuecat-money.test.ts and error-sink.test.ts, and both are correct. */
const BOTH_APART =
  `${IMPORTS}${PINNED}\n${DRIVER}\n` +
  "describe('two clocks, never in one case', () => {\n" +
  "  it('the pinned half', async () => {\n" +
  '    await erasureRetry({}, NOW_MS);\n' +
  '    expect(1).toBe(1);\n' +
  '  });\n' +
  "  it('the route half', async () => {\n" +
  '    expect((await deleteAccount({})).status).toBe(200);\n' +
  '  });\n' +
  '});\n';

/** Enough population that C2, C3 and C4 are all satisfied, so a case measuring
 *  L1 is never answered by a coverage floor instead. */
const POPULATION = {
  'services/platform/test/both-apart.test.ts': BOTH_APART,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('the passing path', () => {
  test('the REAL repository is clean, and the ok line reports a real population', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}no test case mixes a pinned clock with a real route/);
    const pinned = Number(out.match(/(\d+) pinned instant\(s\)/)?.[1] ?? 0);
    const drives = Number(out.match(/(\d+) real route drive\(s\)/)?.[1] ?? 0);
    assert.ok(pinned >= 10, `only ${pinned} pinned instant(s) found in the real tree: ${out}`);
    assert.ok(drives >= 1, `only ${drives} real route drive(s) found in the real tree: ${out}`);
  });

  test('the real signup-erasure.test.ts — the file the row is about — is green as fixed', () => {
    const src = readFileSync(join(REPO, 'services/platform/test/signup-erasure.test.ts'), 'utf8');
    assert.match(src, /const NOW_MS = Date\.now\(\)/, 'the instance fix is not in the tree; this case would prove nothing');
    const { code, out } = run(REPO);
    assert.equal(code, 0, out);
  });
});

describe('limb 1 — the MIX', () => {
  test('fails when one case hands a pinned instant to src code AND drives the real route', () => {
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/signup.test.ts': mixedCase(PINNED) }));
    assert.equal(code, 1, out);
    assert.match(out, /services\/platform\/test\/signup\.test\.ts:/);
    assert.match(out, /PINNED instant '2026-09-20T06:00:00\.000Z'/);
    assert.match(out, /erasureRetry\(…\)/);
    assert.match(out, /drives the real route/);
  });

  test('the recorded FIX — a clock derived from the one the route used — is green', () => {
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/signup.test.ts': mixedCase(DERIVED) }));
    assert.equal(code, 0, out);
  });

  test('🔴 MOVING THE LITERAL FORWARD is still red — a later date is the same defect', () => {
    const later = "const NOW_MS = Date.parse('2027-12-31T06:00:00.000Z');";
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/signup.test.ts': mixedCase(later) }));
    assert.equal(code, 1, out);
    assert.match(out, /2027-12-31T06:00:00\.000Z/);
    assert.match(out, /a later date is the same defect with a longer fuse/);
  });

  test('an inline pinned instant, never bound to a name, is caught too', () => {
    const inline = mixedCase(DERIVED).replace(
      'await erasureRetry({ db }, NOW_MS);',
      "await erasureRetry({ db }, Date.parse('2026-09-20T06:00:00.000Z'));",
    );
    assert.match(inline, /Date\.parse/, 'the inline mutation did not apply — this case would test nothing');
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/signup.test.ts': inline }));
    assert.equal(code, 1, out);
  });

  // A table-driven case is ONE declaration running many cases. The head and its
  // body are two consecutive argument groups, so a reader that stopped at the
  // first would see the TABLE and never the body — and every `it.each` in the
  // suite would be invisible to this guard while looking covered.
  test('a table-driven `it.each(TABLE)(name, fn)` case is read to its BODY, not its table', () => {
    const each =
      `${IMPORTS}${PINNED}\n${DRIVER}\n` +
      "describe('each', () => {\n" +
      "  it.each([[1], [2]])('case %i', async (n) => {\n" +
      '    await deleteAccount({ n });\n' +
      '    await erasureRetry({}, NOW_MS);\n' +
      '    expect(n).toBeGreaterThan(0);\n' +
      '  });\n' +
      '});\n';
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/each.test.ts': each }));
    assert.equal(code, 1, out);
    assert.match(out, /services\/platform\/test\/each\.test\.ts:/);
  });

  test('a pinned instant reached through a route driven INLINE, not via a helper, is caught', () => {
    const inlineDrive =
      `${IMPORTS}${PINNED}\n` +
      "describe('inline', () => {\n" +
      "  it('drives the route in the case body', async () => {\n" +
      '    const app = new Hono();\n' +
      "    app.route('/v1', account);\n" +
      "    await app.request('/v1/account', { method: 'DELETE' }, {});\n" +
      '    await erasureRetry({}, NOW_MS);\n' +
      '  });\n' +
      '});\n';
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/inline.test.ts': inlineDrive }));
    assert.equal(code, 1, out);
    assert.match(out, /drives the real route \(:\d+\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE POSITIVE CONTROL, AND IT IS NOT A SHAPE ANYBODY INVENTED.
//
// Every fixture above is a MODEL of the #842 defect, written by the same hand
// that wrote the detector — so the two can agree with each other and both be
// wrong about the real file. A sibling lane produced exactly that today: its
// detector read `process.cwd()` while the pre-fix code read
// `resolve(args.find(…) ?? '.')`, so it found nothing, reported clean, and
// looked like coverage.
//
// This case removes that degree of freedom. It takes the REAL
// services/platform/test/signup-erasure.test.ts off disk and applies the REAL
// one-line revert of #843 — the two lines below are the `-` and `+` of that
// commit's diff, nothing else — and requires the guard to go red on the file
// that actually froze the merge queue. Both lines are asserted to be present /
// absent before the mutation, so if that file is ever rewritten this case fails
// LOUDLY rather than quietly testing a file that no longer has the shape.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 the real file, reverted by the real commit', () => {
  const REAL = 'services/platform/test/signup-erasure.test.ts';
  const FIXED_LINE = 'const NOW_MS = Date.now() + 24 * 60 * 60 * 1000;';
  const BROKEN_LINE = "const NOW_MS = Date.parse('2026-09-20T06:00:00.000Z');";

  test('goes RED on signup-erasure.test.ts with #843 reverted, and GREEN as it stands', () => {
    const real = readFileSync(join(REPO, REAL), 'utf8');
    assert.ok(
      real.includes(FIXED_LINE),
      `${REAL} no longer contains the derived clock this case reverts — the premise is gone, so this case would prove nothing.`,
    );
    assert.equal(
      real.split(FIXED_LINE).length - 1,
      1,
      'the derived clock line is not unique in the real file; the revert below would be ambiguous.',
    );

    // GREEN as it stands today.
    const asIs = run(tree({ ...POPULATION, [REAL]: real }));
    assert.equal(asIs.code, 0, `the real file as fixed must be clean: ${asIs.out}`);

    // RED with the real commit reverted — one line, byte for byte.
    const reverted = real.replace(FIXED_LINE, BROKEN_LINE);
    assert.notEqual(reverted, real, 'the revert did not apply');
    const { code, out } = run(tree({ ...POPULATION, [REAL]: reverted }));
    assert.equal(code, 1, `the real pre-#843 file must be caught: ${out}`);
    assert.match(out, /signup-erasure\.test\.ts:/);
    assert.match(out, /2026-09-20T06:00:00\.000Z/);
    assert.match(out, /erasureRetry\(…\)/);
    assert.match(out, /drives the real route/);
  });

  // The file still SPELLS the old literal in the comment that explains why it
  // went. This is the same claim as the invented `only in a comment` case above,
  // made against the real bytes: a raw grep for that literal reports the FIXED
  // file, and the guard must not.
  test('🔴 the real FIXED file still spells the old literal in prose, and is still GREEN', () => {
    const real = readFileSync(join(REPO, REAL), 'utf8');
    assert.ok(
      real.includes("Date.parse('2026-09-20T06:00:00.000Z')"),
      `${REAL} no longer quotes the retired literal in its comment — this case is what stops a prose match.`,
    );
    const { code, out } = run(tree({ ...POPULATION, [REAL]: real }));
    assert.equal(code, 0, out);
  });
});

describe('limb 1 — the SAFE shapes it must stay silent on', () => {
  test('🔴 a literal that exists ONLY IN A COMMENT does not fire — a raw grep reports the FIXED file', () => {
    const commented = mixedCase(DERIVED).replace(
      DERIVED,
      `/// The pinned literal this replaced — Date.parse('2026-09-20T06:00:00.000Z') —\n` +
        '/// was only ever correct while the wall clock stood BEFORE it.\n' +
        `${DERIVED}`,
    );
    assert.match(commented, /\/\/\/ The pinned literal/, 'the comment mutation did not apply');
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/signup.test.ts': commented }));
    assert.equal(code, 0, out);
  });

  test('a pinned instant inside a STRING does not fire either', () => {
    const inString = mixedCase(DERIVED).replace(
      'const db = {};',
      "const db = { note: \"Date.parse('2026-09-20T06:00:00.000Z')\" };",
    );
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/signup.test.ts': inString }));
    assert.equal(code, 0, out);
  });

  test('🔴 a pinned instant and a route drive in DIFFERENT cases of one file is SAFE', () => {
    const { code, out } = run(tree({ 'services/platform/test/both-apart.test.ts': BOTH_APART }));
    assert.equal(code, 0, out);
    assert.match(out, /both present, in different cases, in 1 file\(s\)/);
  });

  test('a pinned instant with no route anywhere in the file is SAFE', () => {
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/pinned-only.test.ts': PINNED_ONLY }));
    assert.equal(code, 0, out);
  });

  test('a case that RE-DECLARES the pinned name from the real clock shadows the pin', () => {
    const shadowed = mixedCase(PINNED).replace('const db = {};', 'const db = {};\n    const NOW_MS = Date.now();');
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/shadow.test.ts': shadowed }));
    assert.equal(code, 0, out);
  });

  test('a pinned name from a DIFFERENT case does not leak into the route case', () => {
    const scoped =
      `${IMPORTS}${DRIVER}\n` +
      "describe('scoped', () => {\n" +
      "  it('pins locally', async () => {\n" +
      `    ${PINNED}\n` +
      '    await erasureRetry({}, NOW_MS);\n' +
      '  });\n' +
      "  it('drives the route', async () => {\n" +
      '    await deleteAccount({});\n' +
      '  });\n' +
      '});\n';
    const { code, out } = run(tree({ ...POPULATION, 'services/platform/test/scoped.test.ts': scoped }));
    assert.equal(code, 0, out);
  });
});

describe('the coverage floors — every one of them exits 2, never 0', () => {
  test('C1 — a tree with no services/ refuses', () => {
    const root = join(TMP, `empty${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /C1/);
  });

  test('C1 — services/ with no *.test.ts refuses', () => {
    const root = join(TMP, `notests${seq++}`);
    mkdirSync(join(root, 'services', 'platform', 'test'), { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2, out);
    assert.match(out, /C1/);
  });

  test('C2 — a corpus with zero pinned instants refuses', () => {
    const { code, out } = run(tree({ 'services/platform/test/drive-only.test.ts': DRIVE_ONLY }));
    assert.equal(code, 2, out);
    assert.match(out, /C2 .*ZERO pinned instants/s);
  });

  test('C3 — a corpus with zero real route drives refuses', () => {
    const { code, out } = run(tree({ 'services/platform/test/pinned-only.test.ts': PINNED_ONLY }));
    assert.equal(code, 2, out);
    assert.match(out, /C3 .*ZERO real route drives/s);
  });

  test('🔴 C4 — pins and drives that never share a file refuses: the co-location limb is idle', () => {
    const { code, out } = run(
      tree({
        'services/platform/test/pinned-only.test.ts': PINNED_ONLY,
        'services/platform/test/drive-only.test.ts': DRIVE_ONLY,
      }),
    );
    assert.equal(code, 2, out);
    assert.match(out, /C4/);
    assert.match(out, /a ban on date literals/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE MUTATIONS THAT MATTER. A guard is not most dangerous when it is wrong;
// it is most dangerous when somebody edits its matcher into something that can
// never fire, after which every file reads clean and this limb prints ok for the
// rest of the repository's life. Each mutation below leaves the guard running,
// exiting, and printing — and each must come out as 2, never 0.
// ─────────────────────────────────────────────────────────────────────────────
describe('🔴 a matcher edited into something that never fires', () => {
  /** The guard, plus the two modules it imports, copied into a temp tooling/ci
   *  so a mutated copy resolves its own dependencies. */
  function mutantOf(needle, replacement) {
    const ciRoot = join(TMP, `mut${seq++}`, 'tooling', 'ci');
    mkdirSync(ciRoot, { recursive: true });
    writeFileSync(join(ciRoot, 'tree-walk.mjs'), readFileSync(join(CI_DIR, 'tree-walk.mjs'), 'utf8'));
    writeFileSync(join(ciRoot, 'text-reductions.mjs'), readFileSync(join(CI_DIR, 'text-reductions.mjs'), 'utf8'));
    const src = readFileSync(GUARD, 'utf8');
    const mutated = src.replace(needle, replacement);
    assert.notEqual(mutated, src, `the needle was not found — this mutation would have tested nothing:\n${needle}`);
    const p = join(ciRoot, 'assert-test-clock-mix.mjs');
    writeFileSync(p, mutated);
    return p;
  }

  test('the pinned-instant matcher neutered is COVERAGE LOST, not a quiet pass', () => {
    // String.raw, because the needle IS a regex literal: in an ordinary quoted
    // string its escapes would collapse and the replace would match nothing.
    const needle = String.raw`/(?:Date\s*\.\s*parse|new\s+Date)\s*\(\s*/g`;
    const mutant = mutantOf(needle, '/zzz_this_can_never_match/g');
    const clean = run(REPO);
    assert.equal(clean.code, 0, clean.out);
    const { code, out } = run(REPO, mutant);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /C2/);
  });

  test('the route-drive matcher neutered is COVERAGE LOST, not a quiet pass', () => {
    const needle = String.raw`/([A-Za-z_$][\w$]*)\s*\.\s*(?:request|fetch)\s*\(/g`;
    const mutant = mutantOf(needle, '/(zzz_this_can_never_match)/g');
    const { code, out } = run(REPO, mutant);
    assert.equal(code, 2, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /C3/);
  });

  test('the ISO-literal reader neutered is COVERAGE LOST, not a quiet pass', () => {
    const needle = String.raw`const ISO_LITERAL = /^['"`+'`'+String.raw`]\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}|['"`+'`'+String.raw`])/;`;
    const mutant = mutantOf(needle, 'const ISO_LITERAL = /^zzz_this_can_never_match/;');
    const { code, out } = run(REPO, mutant);
    assert.equal(code, 2, out);
    assert.match(out, /C2/);
  });

  // The counters above cannot see a guard that still MEASURES both halves and
  // simply stops reporting the overlap, because the population is unchanged and
  // every floor stays satisfied. What stands between that edit and a permanent
  // green is the broken-shape fixture in `limb 1 — the MIX`. This case proves
  // that fixture is load-bearing rather than decorative: silence the report and
  // the fixture is the only thing that goes from red to green.
  test('🔴 silencing the L1 report leaves every floor satisfied — the broken fixture is what catches it', () => {
    const mutant = mutantOf('if (handed.length === 0) continue;', 'if (handed.length >= 0) continue;');
    const broken = tree({ ...POPULATION, 'services/platform/test/signup.test.ts': mixedCase(PINNED) });
    const honest = run(broken);
    assert.equal(honest.code, 1, honest.out);
    const silenced = run(broken, mutant);
    assert.equal(silenced.code, 0, `the silenced mutant must slip past every coverage floor: ${silenced.out}`);
  });
});
