// ─────────────────────────────────────────────────────────────────────────────
// catalog-contract.test.mjs — assert-catalog-contract.mjs must be able to FAIL.
//
// The guard's whole job is to refuse a catalogue that would otherwise reach the
// public website malformed, so the only thing worth testing is the set of
// inputs it must REJECT. A guard tested exclusively against the real repository
// has only ever seen valid input — which is by definition valid — and that is
// the [pipeline F-10] defect this file exists to close.
//
// ⚠️ REAL-TREE NEGATIVE TESTS FIRST. Every case below was first produced by
// MUTATING THE ACTUAL catalog/apps.json in this working tree and running the
// guard, then restoring the file and re-checking its hash against the pin
// 4c5f555bc24d145bbc9ac2ec05d8ab8f26d446df. A fixture the test author wrote
// encodes the same misunderstanding as the guard the test author wrote; only
// breaking the real tree proves the guard reaches the real tree. Results:
//   N1  `[]`                                  -> COVERAGE LOST, exit 1
//   N2  `tagline` deleted                     -> named `tagline`, exit 1
//   N3  `api` KEY deleted (empty is legal)    -> named `api`, exit 1
//   N4  slug "Sub-ly"                         -> named the app-id shape, exit 1
//   N5  the row duplicated                    -> named both indices, exit 1
//   N6  platforms ["blackberry"]              -> named the register, exit 1
//   N7  platforms []                          -> exit 1
//   N8  status "shipped"                      -> named live/preview, exit 1
//   N9  url http:// (not https)               -> exit 1
//   N10 top level `{…}`                       -> exit 1
//   N11 unparseable bytes                     -> exit 1
//   N12 `[1, 2]`                              -> per-row + rowsChecked==0, exit 1
//   N13 the catalogue deleted outright        -> COVERAGE LOST, exit 1
// Restored: hash back to the pin, guard exit 0.
//
// 🔴 THE POSITIVE CONTROL IS NOT OPTIONAL. Without a case that runs the guard
// against the REAL repository and demands exit 0, every negative result above
// is equally consistent with a guard that refuses everything it is ever shown —
// which would pass all thirteen and be worthless.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-catalog-contract.mjs');
const REGISTER_REL = join('tooling', 'channel-register.json');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-catalog-contract-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};

/** A valid row, so that each case below can break exactly ONE thing. A fixture
 *  that differs from the real catalogue in several ways at once cannot tell you
 *  which difference the guard reacted to. */
const ROW = () => ({
  slug: 'subly',
  name: 'Subly',
  tagline: 'Track every subscription in one place',
  url: 'https://subly.nikatru.com',
  api: 'https://api.nikatru.com',
  platforms: ['web'],
  status: 'live',
});

/** Builds a root with a catalogue and a channel register. `catalogue === null`
 *  writes no catalogue at all; a string is written verbatim so that
 *  unparseable bytes can be tested. */
function tree(catalogue, { register = 'real' } = {}) {
  const root = join(TMP, `r${seq++}`);
  mkdirSync(join(root, 'catalog'), { recursive: true });
  mkdirSync(join(root, 'tooling'), { recursive: true });
  if (catalogue !== null) {
    writeFileSync(
      join(root, 'catalog', 'apps.json'),
      typeof catalogue === 'string' ? catalogue : `${JSON.stringify(catalogue, null, 2)}\n`,
    );
  }
  if (register === 'real') cpSync(join(REPO, REGISTER_REL), join(root, REGISTER_REL));
  else if (register !== 'absent') writeFileSync(join(root, REGISTER_REL), JSON.stringify(register));
  return root;
}

describe('assert-catalog-contract.mjs — the positive controls', () => {
  test('the REAL repository catalogue passes', () => {
    const { code, out } = run(REPO);
    assert.equal(code, 0, `the real catalogue must pass, got:\n${out}`);
  });

  test('a minimal valid fixture passes', () => {
    const { code, out } = run(tree([ROW()]));
    assert.equal(code, 0, out);
  });

  test('an EMPTY `api` is legal — it declares "calls the shared platform Worker"', () => {
    const { code, out } = run(tree([{ ...ROW(), api: '' }]));
    assert.equal(code, 0, `an empty api must not be confused with a missing one:\n${out}`);
  });

  test('`markets`/`audience` are NOT required — the real subly row carries neither', () => {
    const { code, out } = run(tree([ROW()]));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /markets/, 'absent markets must not even be mentioned as a problem');
  });

  test('`markets`/`audience` are accepted when the stamp does write them', () => {
    const { code, out } = run(tree([{ ...ROW(), markets: ['IN', 'US'], audience: 'consumers' }]));
    assert.equal(code, 0, out);
    assert.match(out, /markets=IN\/US/, 'they are printed, so a reader can see them');
  });

  test('the ok line states the ROW COUNT', () => {
    const { code, out } = run(tree([ROW(), { ...ROW(), slug: 'lingo', url: 'https://lingo.nikatru.com' }]));
    assert.equal(code, 0, out);
    assert.match(out, /2 row\(s\)/, 'the count must be printed, so a shrink is visible to a reader');
  });
});

describe('assert-catalog-contract.mjs — the coverage floor', () => {
  test('an EMPTY catalogue refuses as COVERAGE LOST, not as a pass', () => {
    // The cheapest way for this guard to stop checking: `[]` is valid JSON, is
    // an array, and satisfies every per-row assertion vacuously.
    const { code, out } = run(tree([]));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /zero rows/);
  });

  test('an ABSENT catalogue refuses as COVERAGE LOST', () => {
    const { code, out } = run(tree(null));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no catalogue/);
  });

  test('rows that are all unusable refuse even though each row was reported', () => {
    const { code, out } = run(tree([1, 2]));
    assert.equal(code, 1, out);
    assert.match(out, /not an object/);
    assert.match(out, /COVERAGE LOST/, 'nothing was actually field-checked, which must not read as clean');
  });

  test('an absent channel register refuses rather than checking against an empty vocabulary', () => {
    const { code, out } = run(tree([ROW()], { register: 'absent' }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /channel-register/);
  });

  test('a register with no channels refuses — an empty vocabulary accepts anything', () => {
    const { code, out } = run(tree([ROW()], { register: { channels: [] } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });
});

describe('assert-catalog-contract.mjs — the file shape', () => {
  test('unparseable bytes refuse', () => {
    const { code, out } = run(tree('not json\n'));
    assert.equal(code, 1, out);
    assert.match(out, /not valid JSON/);
  });

  test('a top-level object refuses', () => {
    const { code, out } = run(tree({ slug: 'subly' }));
    assert.equal(code, 1, out);
    assert.match(out, /not a JSON array/);
  });
});

describe('assert-catalog-contract.mjs — the row contract', () => {
  // Each case deletes or corrupts exactly one field of an otherwise valid row,
  // and asserts the guard NAMES that field. A guard that merely exits 1 without
  // saying which field is wrong sends a reader to read the whole file.
  //
  // 🔴 THESE ASSERT THE *ABSENT-SPECIFIC* WORDING, NOT MERELY THAT THE FIELD IS
  // NAMED, AND THAT IS THE WHOLE POINT OF THE CASE. The first version of this
  // loop asserted only `new RegExp('`' + field + '`')`. Mutation testing broke
  // it: deleting every `Object.hasOwn` branch from the guard left all thirty
  // cases GREEN, because a deleted key makes `row[field]` undefined and the
  // type-check branch below it fires anyway and names the same field. So the
  // presence checks were untested — an entire limb of the guard could have been
  // removed with the suite reporting success, which is precisely the defect
  // this repository keeps paying for. Pinning the wording makes the branch
  // load-bearing, and the mutation now goes red.
  const ABSENT = {
    slug: 'has no `slug`',
    name: 'has no `name`',
    tagline: 'has no `tagline`',
    url: 'has no `url`',
    api: 'has no `api` key',
    platforms: 'has no `platforms`',
    status: 'has no `status`',
  };
  for (const [field, message] of Object.entries(ABSENT)) {
    test(`a missing \`${field}\` is refused, named, and reported as ABSENT`, () => {
      const row = ROW();
      delete row[field];
      const { code, out } = run(tree([row]));
      assert.equal(code, 1, out);
      assert.ok(out.includes(message), `expected "${message}" in:\n${out}`);
    });
  }

  test('an ABSENT field is distinguished from an EMPTY one — different bugs, different repairs', () => {
    // A missing key is an unanswered question; an empty value is an answer that
    // happens to be blank. Collapsing the two sends whoever reads the failure
    // to look for the wrong thing.
    const missing = (() => { const r = ROW(); delete r.name; return r; })();
    const a = run(tree([missing]));
    const b = run(tree([{ ...ROW(), name: '' }]));
    assert.equal(a.code, 1, a.out);
    assert.equal(b.code, 1, b.out);
    assert.ok(a.out.includes('has no `name`'), a.out);
    assert.ok(b.out.includes('empty or non-string `name`'), b.out);
  });

  test('a slug that the stamper could not have produced is refused', () => {
    const { code, out } = run(tree([{ ...ROW(), slug: 'Sub-ly' }]));
    assert.equal(code, 1, out);
    assert.match(out, /app-id shape/);
  });

  test('a duplicate slug is refused and BOTH indices are named', () => {
    const { code, out } = run(tree([ROW(), ROW()]));
    assert.equal(code, 1, out);
    assert.match(out, /repeats slug "subly"/);
    assert.match(out, /\[0\]/);
  });

  test('an empty `platforms` is refused — an app shipped nowhere is not shipped', () => {
    const { code, out } = run(tree([{ ...ROW(), platforms: [] }]));
    assert.equal(code, 1, out);
    assert.match(out, /platforms/);
  });

  test('a platform no channel serves is refused', () => {
    const { code, out } = run(tree([{ ...ROW(), platforms: ['blackberry'] }]));
    assert.equal(code, 1, out);
    assert.match(out, /blackberry/);
    assert.match(out, /channel-register/);
  });

  test('every platform the register DOES serve is accepted', () => {
    // The mirror of the case above. Without it, the vocabulary check could be
    // rejecting everything and the negative case would still pass.
    const platforms = ['web', 'android', 'ios', 'macos', 'windows', 'linux'];
    const { code, out } = run(tree([{ ...ROW(), platforms }]));
    assert.equal(code, 0, `the register serves all six, so all six must pass:\n${out}`);
  });

  test('a status outside {live, preview} is refused', () => {
    const { code, out } = run(tree([{ ...ROW(), status: 'shipped' }]));
    assert.equal(code, 1, out);
    assert.match(out, /"live" and "preview"/);
  });

  test('both real statuses are accepted', () => {
    for (const status of ['live', 'preview']) {
      const { code, out } = run(tree([{ ...ROW(), status }]));
      assert.equal(code, 0, `${status} must be accepted:\n${out}`);
    }
  });

  test('a non-https url is refused — this file is public', () => {
    const { code, out } = run(tree([{ ...ROW(), url: 'http://subly.nikatru.com' }]));
    assert.equal(code, 1, out);
    assert.match(out, /https:\/\//);
  });

  test('a non-empty `api` that is not an https origin is refused', () => {
    const { code, out } = run(tree([{ ...ROW(), api: 'api.nikatru.com' }]));
    assert.equal(code, 1, out);
    assert.match(out, /api/);
  });

  test('a row that is not an object is refused', () => {
    const { code, out } = run(tree([ROW(), 'subly']));
    assert.equal(code, 1, out);
    assert.match(out, /not an object/);
  });
});
