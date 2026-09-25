// ─────────────────────────────────────────────────────────────────────────────
// bundle-availability.test.mjs — assert-bundle-availability.mjs must be able to
// FAIL, and the derivation it grades must move in BOTH directions.
//
// The property under test: the bundle's "coming soon" state is DERIVED from the
// product registers, never declared. Today the answer is `purchasable: false`
// because exactly one product is `live`; the day a second one is promoted the
// answer must become `true` with no code change.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-09, three, on
// the real worktree; every restore re-verified green). The fixtures below encode
// the same failing inputs, but the fixtures are NOT the evidence — a fixture I
// wrote encodes the same misunderstanding as the guard I wrote.
//
//   BA1  `"purchasable": true` written into catalog/bundles.json  -> exit 1
//   BA2  the derivation replaced with `const purchasable = false;` -> exit 1
//   BA3  MIN_LIVE_PRODUCTS_FOR_BUNDLE retyped as the literal 2     -> exit 1
//   (revert)                                                       -> exit 0
//
// 🔴 THE DEFECT THE MUTATION RUN FOUND IN THE GUARD ITSELF. Limb E compared the
// two derivations' conjunct sets and the Worker twin had INLINED one of them
// (`priceIdCount > 0` instead of a named `priced`). The guard was right and the
// twin was wrong — the two copies really could have drifted on whether a bundle
// with no price id is buyable. Fixed in the twin, not waived in the guard.
//
// 🔴 AND THE LIMB THAT MATTERS IS BA2's INVERSE. Every other limb of this guard
// is satisfied forever by a derivation that answers `false` unconditionally —
// which is the shape the gate would silently become, and then the day the owner
// promotes FullShot to `live` nothing happens and nothing is red. The guard
// builds a fixture tree with a second live product and REQUIRES `true`.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const GUARD = join(CI_DIR, 'assert-bundle-availability.mjs');

/** Everything assert-bundle-availability.mjs reads. A tree missing any of these must REFUSE. */
const SUBJECT_FILES = [
  'tooling/bundle-availability.mjs',
  'services/platform/src/lib/bundle/availability.ts',
  'catalog/bundles.json',
  'contracts/entitlement/bundle.js',
  'catalog/apps.json',
  'extensions/catalog/extensions.json',
  'tooling/channel-register.json',
];

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-ba-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/**
 * A throwaway copy of the real subject files, optionally mutated.
 *
 * 🔴 COPIED FROM THE REAL TREE, NOT HAND-WRITTEN. A fixture I author encodes my
 * own reading of the registers; a copy of the shipping ones encodes theirs. The
 * mutation is then the ONLY difference between a green run and a red one, which
 * is what makes the red attributable.
 */
function tree(mutate = () => {}) {
  const dir = join(TMP, `t${seq++}`);
  for (const rel of SUBJECT_FILES) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(REPO, rel), dest);
  }
  mutate(dir);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function editJson(dir, rel, fn) {
  const p = join(dir, rel);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  writeFileSync(p, JSON.stringify(fn(doc) ?? doc, null, 2));
}

function editText(dir, rel, fn) {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

describe('assert-bundle-availability — the coming-soon gate is derived', () => {
  // ── THE GREEN CONTROL, FIRST ───────────────────────────────────────────────
  // Without it every red below is unattributable: a guard that fails on
  // everything "catches" every mutation and proves nothing.
  test('GREEN CONTROL — the real tree passes', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /purchasable=false because 1 live product\(s\) < 2/);
    assert.match(r.out, /the gate moves in BOTH directions/);
  });

  test('BA1 — a `purchasable` boolean literal in the register is refused', () => {
    const r = run(
      tree((d) =>
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].purchasable = true;
          return doc;
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /assigns the boolean literal `true` to `purchasable`/);
  });

  test('BA2 — a derivation that always answers false is refused', () => {
    const r = run(
      tree((d) =>
        editText(d, 'tooling/bundle-availability.mjs', (s) =>
          s.replace(
            'const purchasable = visible && enoughLive && membersAllLive && priced;',
            'const purchasable = false;',
          ),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /A SECOND LIVE PRODUCT DID NOT OPEN THE GATE/);
  });

  test('BA3 — retyping the live-product floor instead of importing it is refused', () => {
    const r = run(
      tree((d) =>
        editText(d, 'tooling/bundle-availability.mjs', (s) =>
          s.split('MIN_LIVE_PRODUCTS_FOR_BUNDLE').join('2 /*floor*/'),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /does not use MIN_LIVE_PRODUCTS_FOR_BUNDLE/);
  });

  test('BA4 — the two derivations drifting on one conjunct is refused', () => {
    const r = run(
      tree((d) =>
        editText(d, 'services/platform/src/lib/bundle/availability.ts', (s) =>
          // The exact real defect this guard caught while it was being written:
          // the twin inlined the price conjunct instead of naming it.
          s
            .replace('const priced = priceIdCount > 0;', '')
            .replace('&& priced;', '&& priceIdCount > 0;'),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /disagree about `priced`/);
  });

  // ── F · O-BUNDLE-MEMBERSHIP-UNGRADED — every catalogue product is placed ────
  test('BA5 — a catalogue product neither a member nor excluded is refused', () => {
    const r = run(
      tree((d) =>
        editJson(d, 'extensions/catalog/extensions.json', (doc) => {
          doc.push({ ...doc[0], slug: 'newext', status: 'preview' });
          return doc;
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /`newext` is a catalogue product and catalog\/bundles\.json neither lists it/);
  });

  test('BA6 — an excluded catalogue product with a `why` passes', () => {
    const r = run(
      tree((d) => {
        editJson(d, 'extensions/catalog/extensions.json', (doc) => {
          doc.push({ ...doc[0], slug: 'newext', status: 'preview' });
          return doc;
        });
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].excluded = [{ slug: 'newext', why: 'a free utility, not sold in the bundle' }];
          return doc;
        });
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /equal members ∪ excluded .*excluded: newext/);
  });

  test('BA7 — an excluded catalogue product with no `why` is refused', () => {
    const r = run(
      tree((d) => {
        editJson(d, 'extensions/catalog/extensions.json', (doc) => {
          doc.push({ ...doc[0], slug: 'newext', status: 'preview' });
          return doc;
        });
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].excluded = [{ slug: 'newext', why: ' ' }];
          return doc;
        });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /excludes `newext` with no `why`/);
  });

  test('BA8 — a member no catalogue carries is refused', () => {
    const r = run(
      tree((d) =>
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].members.push({ slug: 'ghost', kind: 'app' });
          return doc;
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lists member `ghost`, which neither catalog\/apps\.json nor extensions\/catalog\/extensions\.json carries/);
  });

  test('limb F reading zero catalogue slugs is COVERAGE LOST, never a clean membership', () => {
    const r = run(
      tree((d) => {
        writeFileSync(join(d, 'catalog/apps.json'), '[]');
        writeFileSync(join(d, 'extensions/catalog/extensions.json'), '[]');
      }),
    );
    // Limb D also goes red (no product can go live), and a finding outranks a blind limb.
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — limb F read ZERO product slugs/);
  });

  test('limb C prints all four conjuncts with their values', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /limb C conjuncts: enoughLive=false \(1 live, floor 2\), missingMembers=\[fullshot\], membersAllLive=false, priced=false/);
  });

  // ── THE EMPTY SUBJECT ──────────────────────────────────────────────────────
  // assert-guards-refuse-empty.mjs runs this guard with NO argv against a tree
  // that carries only tooling/, so the registers are gone. Asserted here too,
  // because a guard that prints ok over an absent subject is the failure this
  // whole directory exists to reject.
  test('an absent register is COVERAGE LOST, never a clean run', () => {
    const empty = mkdtempSync(join(TMP, 'empty-'));
    const r = run(empty);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('a register that is present but unparseable refuses rather than reading false', () => {
    const r = run(tree((d) => writeFileSync(join(d, 'catalog/apps.json'), '{not json')));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

describe('tooling/bundle-availability.mjs — the derivation itself', () => {
  test('today: one live product, so the bundle is visible and NOT purchasable', async () => {
    const { bundleAvailability } = await import(
      pathToFileURL(join(REPO, 'tooling/bundle-availability.mjs')).href
    );
    const a = bundleAvailability(REPO);
    assert.deepEqual(a.problems, []);
    // Visible and not purchasable is the WHOLE coming-soon state: the site may
    // name the bundle, with no price and no checkout control.
    assert.equal(a.visible, true);
    assert.equal(a.purchasable, false);
    assert.equal(a.why.liveProductCount, 1);
    assert.equal(a.why.minLiveProducts, 2);
  });

  test('an unknown channel has no rail, and an unknown rail is refused rather than defaulted', async () => {
    const { bundleAvailability } = await import(
      pathToFileURL(join(REPO, 'tooling/bundle-availability.mjs')).href
    );
    const a = bundleAvailability(REPO, { channel: 'not-a-channel' });
    assert.equal(a.why.rail, null);
    assert.equal(a.steerable, false);
    // A channel nobody decided is a PROBLEM, not a quiet false — the caller has
    // to be able to tell "not steerable" from "this derivation stopped reading".
    assert.ok(a.problems.length > 0, JSON.stringify(a.problems));
  });
});
