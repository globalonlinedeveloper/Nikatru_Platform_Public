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
// ── 2026-08-18 · [ADR 055]'s `listings` limb, same method, new pin ───────────
// The catalogue moved from 235 bytes / 4c5f555bc24d145bbc9ac2ec05d8ab8f26d446df
// to 410 bytes / 5dc57476fde7043d66cd4f7a5ec69341795fd3e8 when every row gained
// a `listings` block. The earlier pin above is left standing: it is the dated
// record of what the 2026-07 run mutated against, and rewriting it would make
// that record describe bytes it never saw. Mutations run against the REAL tree
// at the new pin:
//   N14 `listings` deleted from the row       -> named `listings`, exit 1
//   N15 `listings.play` set to a real Play URL while platforms stays ["web"]
//                                             -> named "android", exit 1
//   N16 `listings.web` changed to a different https origin than `url`
//                                             -> named both spellings, exit 1
//   N17 the `linux` key deleted from listings -> named the MISSING key, exit 1
//   N18 a `flathub` key added to listings     -> named it as unknown, exit 1
//   N19 `listings.play` set to ""             -> named "neither null nor", exit 1
//   N20 `storefrontKey` deleted from the register's android-play row
//                                             -> COVERAGE LOST, exit 1
// Restored after each: hash back to 5dc57476…, guard exit 0.
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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs';
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

/** The storefront key set, READ FROM THE REAL REGISTER rather than typed here.
 *  A literal `['web','play',…]` in this file would be a third declaration of the
 *  same fact (the register, post_gen.dart, and this) and the first to drift: add
 *  a store to the register and every fixture below would silently become an
 *  INVALID row that the suite still expected to pass, turning the positive
 *  controls red for a reason that has nothing to do with what they test. */
const REGISTER_CHANNELS = JSON.parse(readFileSync(join(REPO, REGISTER_REL), 'utf8')).channels;
const STOREFRONT_KEYS = REGISTER_CHANNELS.map((c) => c.storefrontKey).filter((k) => typeof k === 'string');
const WEB_KEY = REGISTER_CHANNELS.find((c) => c.kind === 'web')?.storefrontKey;

/** A valid row, so that each case below can break exactly ONE thing. A fixture
 *  that differs from the real catalogue in several ways at once cannot tell you
 *  which difference the guard reacted to. */
const ROW = () => ({
  slug: 'subly',
  name: 'Subly',
  tagline: 'Track every subscription in one place',
  url: 'https://subly.nikatru.com',
  api: 'https://api.nikatru.com',
  // [ADR 055] every key null except our own site, which IS `url`.
  listings: Object.fromEntries(
    STOREFRONT_KEYS.map((k) => [k, k === WEB_KEY ? 'https://subly.nikatru.com' : null]),
  ),
  platforms: ['web'],
  status: 'live',
});

/** A second valid row for the multi-row cases. It exists so no case has to keep
 *  `url` and `listings[web]` in step BY HAND: they are one fact, the guard now
 *  says so, and a fixture that spread `{...ROW(), url}` would carry the first
 *  app's web listing under the second app's slug — a fixture bug that reads
 *  exactly like a guard bug. */
const ROW_FOR = (slug) => {
  const url = `https://${slug}.nikatru.com`;
  return { ...ROW(), slug, url, listings: { ...ROW().listings, [WEB_KEY]: url } };
};

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
    const { code, out } = run(tree([ROW(), ROW_FOR('lingo')]));
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
    listings: 'has no `listings`',
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

// ── [ADR 055] the `listings` block ───────────────────────────────────────────
// The decision's ONE data change. Every URL it locks — the product page's store
// buttons, `/<store>/apps`, `/get/<store>/<slug>` — reads this field, so the
// ways it can be wrong are the ways those surfaces go wrong.
describe('assert-catalog-contract.mjs — `listings` [ADR 055]', () => {
  const listings = (over) => ({ ...ROW(), listings: { ...ROW().listings, ...over } });

  test('the derived key set is not empty — otherwise every case here is vacuous', () => {
    assert.ok(STOREFRONT_KEYS.length > 0, 'the register must declare storefront keys');
    assert.ok(WEB_KEY, 'the register must have exactly one channel of kind "web"');
  });

  test('all-null EXCEPT our own site is the shape shipped today, and it passes', () => {
    const { code, out } = run(tree([ROW()]));
    assert.equal(code, 0, out);
    assert.match(out, /listings=1\/\d+ live/, 'the split must be printed, so a shrink is visible');
  });

  test('a `listings` that is not an object is refused', () => {
    for (const bad of [null, [], 'https://subly.nikatru.com']) {
      const { code, out } = run(tree([{ ...ROW(), listings: bad }]));
      assert.equal(code, 1, `${JSON.stringify(bad)} must be refused:\n${out}`);
      assert.match(out, /keyed by storefront/);
    }
  });

  test('a MISSING storefront key is refused — absent and null are different answers', () => {
    const row = ROW();
    const dropped = STOREFRONT_KEYS.find((k) => k !== WEB_KEY);
    delete row.listings[dropped];
    const { code, out } = run(tree([row]));
    assert.equal(code, 1, out);
    assert.ok(out.includes(`"${dropped}"`), `the missing key must be NAMED:\n${out}`);
    assert.match(out, /missing key/);
  });

  test('an UNKNOWN storefront key is refused and the real vocabulary is printed', () => {
    const { code, out } = run(tree([listings({ flathub: null })]));
    assert.equal(code, 1, out);
    assert.match(out, /flathub/);
    assert.match(out, /channel-register/);
  });

  test('an empty string is NOT the "no listing" spelling — null is', () => {
    const { code, out } = run(tree([listings({ play: '' })]));
    assert.equal(code, 1, out);
    assert.match(out, /neither null nor/);
  });

  test('a non-https listing URL is refused — every entry here is a link somebody follows', () => {
    const { code, out } = run(tree([listings({ play: 'http://play.google.com/store/apps/details?id=x' })]));
    assert.equal(code, 1, out);
    assert.match(out, /neither null nor/);
  });

  // 🔴 the anti-duplication limb. `listings[web]` and `url` are one fact with two
  // spellings and two disjoint sets of readers.
  test('a `listings` web entry that disagrees with `url` is refused', () => {
    const { code, out } = run(tree([listings({ [WEB_KEY]: 'https://subly-old.nikatru.com' })]));
    assert.equal(code, 1, out);
    assert.match(out, /subly-old\.nikatru\.com/);
    assert.match(out, /SAME fact/);
  });

  test('…and the agreeing case passes, so the limb is not simply rejecting everything', () => {
    const { code, out } = run(tree([ROW_FOR('lingo')]));
    assert.equal(code, 0, out);
  });

  // A listing is a promise a stranger can install from that store.
  test('a store listing the row has no platform for is refused', () => {
    const { code, out } = run(tree([listings({ play: 'https://play.google.com/store/apps/details?id=x' })]));
    assert.equal(code, 1, out);
    assert.match(out, /android/, 'the unclaimed platform must be named');
    assert.match(out, /promise made to a stranger/);
  });

  test('…and the SAME listing passes once the row declares that platform', () => {
    // Without this mirror, the limb above could be rejecting every non-null
    // store listing and the negative case would look identical.
    const row = listings({ play: 'https://play.google.com/store/apps/details?id=x' });
    row.platforms = ['web', 'android'];
    const { code, out } = run(tree([row]));
    assert.equal(code, 0, `a listing backed by a declared platform must pass:\n${out}`);
    assert.match(out, /listings=2\/\d+ live/);
  });

  test('a register channel with NO `storefrontKey` refuses as COVERAGE LOST', () => {
    // The vocabulary's own coverage floor: a channel that does not answer would
    // be read as "not a storefront", so a new store could join the register and
    // never appear in any catalogue row with every limb still reporting clean.
    const channels = JSON.parse(JSON.stringify(REGISTER_CHANNELS));
    delete channels.find((c) => c.id === 'android-play').storefrontKey;
    const { code, out } = run(tree([ROW()], { register: { channels } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /storefrontKey/);
  });

  test('a register where NO channel is a storefront refuses as COVERAGE LOST', () => {
    const channels = JSON.parse(JSON.stringify(REGISTER_CHANNELS));
    for (const c of channels) c.storefrontKey = null;
    const { code, out } = run(tree([ROW()], { register: { channels } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /no storefront keys/);
  });

  test('two channels sharing one storefront key is refused', () => {
    const channels = JSON.parse(JSON.stringify(REGISTER_CHANNELS));
    channels.find((c) => c.id === 'ios-appstore').storefrontKey = 'play';
    const { code, out } = run(tree([ROW()], { register: { channels } }));
    assert.equal(code, 1, out);
    assert.match(out, /reuses storefront key/);
  });
});
