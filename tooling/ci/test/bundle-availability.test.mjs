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
  // R-3 · the two catalogue readers and the floor limb G counts against.
  'tooling/catalog/read.mjs',
  'services/platform/src/lib/catalog.ts',
  'tooling/catalog/reader-floor.json',
  // R-4 · the minted-membership lock limb H reads.
  'catalog/bundle-membership.lock.json',
  // EXM-05 · limb I: the entitlement host, and the one extension member's contract.
  'services/platform/src/app-config-data.json',
  'extensions/Extension/Full_Screen_Shot/tool.json',
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

function run(dir, ...flags) {
  const r = spawnSync(process.execPath, [GUARD, dir, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Import a fixture tree's OWN copy of the derivation, so a mutated register is what it reads. */
async function derivationIn(dir) {
  return import(`${pathToFileURL(join(dir, 'tooling/bundle-availability.mjs')).href}?t=${seq++}`);
}

/** The reader count limb G prints for a tree. */
function readerCount(out) {
  const m = /limb G: (\d+) direct catalog\/\*\.json reader\(s\)/.exec(out);
  return m === null ? null : Number(m[1]);
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

// ── R-1 · EVERY BUNDLE IS SEEN — THE TWO-BUNDLE FIXTURE ─────────────────────
describe('every bundle is seen — O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST', () => {
  /** A second bundle row that differs from the first: one member, priced on paddle. */
  const addSecond = (d) =>
    editJson(d, 'catalog/bundles.json', (doc) => [
      ...doc,
      {
        featureSet: 'second_bundle',
        version: 1,
        status: 'draft',
        members: [{ slug: 'subscriptiontracker', kind: 'app' }],
        priceIds: { paddle: { monthly: 'pri_fixture_second' } },
      },
    ]);

  test('TB1 — the derivation returns BOTH rows of a two-bundle register, each with its own verdict', async () => {
    const dir = tree(addSecond);
    const { bundleAvailability } = await derivationIn(dir);
    const all = bundleAvailability(dir);
    assert.deepEqual(all.problems, []);
    assert.deepEqual([...all.byFeatureSet.keys()], ['nikatru_all', 'second_bundle']);
    // The second row's own facts, not the first's: one member, all live, priced.
    const second = all.byFeatureSet.get('second_bundle');
    assert.deepEqual(second.why.members, ['subscriptiontracker']);
    assert.equal(second.why.membersAllLive, true);
    assert.equal(second.why.priced, true);
    assert.equal(all.byFeatureSet.get('nikatru_all').why.priced, false);
  });

  test('a featureSet carried twice is a problem, never a silent first-row win', async () => {
    const dir = tree((d) => editJson(d, 'catalog/bundles.json', (doc) => [...doc, { ...doc[0], version: 2 }]));
    const { bundleAvailability } = await derivationIn(dir);
    const all = bundleAvailability(dir);
    assert.ok(all.problems.some((p) => /carries featureSet `nikatru_all` twice/.test(p)), JSON.stringify(all.problems));
  });

  test('RC1 — the node twin with its first-row read restored turns the guard red', () => {
    const r = run(
      tree((d) =>
        editText(d, 'tooling/bundle-availability.mjs', (s) => {
          const loop = 'for (const [i, bundle] of bundles.entries()) {';
          assert.ok(s.includes(loop), 'the mutation site moved; re-measure it');
          return s.replace(loop, 'for (const [i, bundle] of bundles.slice(0, 1).entries()) {');
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /EVERY BUNDLE IS SEEN, AND THE SECOND ONE WAS NOT/);
    assert.match(r.out, /tooling\/bundle-availability\.mjs \(the node derivation\) reads a first element/);
  });

  test('RC1 — the Worker twin with its first-row read restored turns the guard red', () => {
    const r = run(
      tree((d) =>
        editText(d, 'services/platform/src/lib/bundle/availability.ts', (s) => {
          const loop = 'for (const bundle of rows) {';
          assert.ok(s.includes(loop), 'the mutation site moved; re-measure it');
          return s.replace(loop, 'for (const bundle of rows.slice(0, 1)) {');
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /availability\.ts \(the Worker twin\) reads a first element \(`\.slice\(0, 1\)`\)/);
  });

  test('RC1 — the Worker catalogue reader serving one row turns the guard red', () => {
    // The Worker twin and the mint both take their rows from catalog.ts's
    // BUNDLE_ROWS, so a first-element read there starves both while the twin's
    // own loop still iterates every row it is handed.
    const r = run(
      tree((d) =>
        editText(d, 'services/platform/src/lib/catalog.ts', (s) => {
          const rows = "  .filter((r): r is BundleRegisterRow => r !== null && typeof r === 'object');";
          assert.ok(s.includes(rows), 'the mutation site moved; re-measure it');
          return s.replace(rows, `${rows.slice(0, -1)}.slice(0, 1);`);
        }),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /catalog\.ts \(the Worker catalogue reader\) reads a first element/);
  });
});

// ── R-2 · A BUNDLE IS A PRODUCT, AND IT NEVER COUNTS TOWARD ITSELF ───────────
describe('the bundle kind — O-BUNDLE-AVAILABILITY-TAKES-THE-FIRST', () => {
  test('readProducts names the bundle by its featureSet, with kind `bundle`', async () => {
    const dir = tree();
    const { readProducts } = await derivationIn(dir);
    const { products, problems } = readProducts(dir);
    assert.deepEqual(problems, []);
    const bundle = products.find((p) => p.kind === 'bundle');
    assert.ok(bundle !== undefined, JSON.stringify(products));
    assert.equal(bundle.slug, 'nikatru_all');
    assert.equal(bundle.register, 'catalog/bundles.json');
  });

  test('HARD — a bundle row spelling `live` is still not counted live', async () => {
    // A third spelling on a bundle row is exactly the edit that would let a
    // bundle count toward the floor that decides whether it may be sold.
    // MUTATION PROOF: drop `&& p.kind !== BUNDLE_KIND` from liveSlugs — RED here.
    const dir = tree((d) =>
      editJson(d, 'catalog/bundles.json', (doc) => {
        doc[0].status = 'live';
        return doc;
      }),
    );
    const { bundleAvailability } = await derivationIn(dir);
    const a = bundleAvailability(dir).byFeatureSet.get('nikatru_all');
    assert.equal(a.why.liveProductCount, 1, JSON.stringify(a.why));
    assert.deepEqual(a.why.liveProducts, ['subscriptiontracker']);
  });

  test('the register list declares bundle, service and site; only bundle has a register', async () => {
    const { PRODUCT_KINDS, PRODUCT_REGISTERS, MEMBER_KINDS } = await import(
      pathToFileURL(join(REPO, 'contracts/entitlement/bundle.js')).href
    );
    assert.deepEqual([...PRODUCT_KINDS], ['app', 'extension', 'script', 'bundle', 'service', 'site']);
    assert.deepEqual(
      PRODUCT_REGISTERS.filter((r) => ['bundle', 'service', 'site'].includes(r.kind)),
      [
        { kind: 'bundle', register: 'catalog/bundles.json', slugField: 'featureSet' },
        { kind: 'service', register: null },
        { kind: 'site', register: null },
      ],
    );
    assert.equal(MEMBER_KINDS.includes('bundle'), false);
  });
});

// ── G · THE DIRECT READERS, AGAINST A FLOOR THAT ONLY FALLS ─────────────────
describe('limb G — the direct catalog/*.json readers', () => {
  test('GREEN CONTROL — the fixture tree is at or under the committed floor, and the count prints', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.ok(readerCount(r.out) !== null, r.out);
  });

  test('G1 — a NEW direct reader above the floor is refused', () => {
    const base = tree();
    const count = readerCount(run(base).out);
    const r = run(
      tree((d) => {
        editJson(d, 'tooling/catalog/reader-floor.json', (doc) => ({ ...doc, floor: count }));
        mkdirSync(join(d, 'tooling/ops'), { recursive: true });
        writeFileSync(
          join(d, 'tooling/ops/new-reader.mjs'),
          "import { readFileSync } from 'node:fs';\nexport const apps = JSON.parse(readFileSync('catalog/apps.json', 'utf8'));\n",
        );
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, new RegExp(`${count + 1} source file\\(s\\) read catalog/\\*\\.json directly, above the floor of ${count}`));
  });

  test('G2 — a path named only in a comment, or through the reader, is not a direct reader', () => {
    const base = tree();
    const count = readerCount(run(base).out);
    const r = run(
      tree((d) => {
        editJson(d, 'tooling/catalog/reader-floor.json', (doc) => ({ ...doc, floor: count }));
        mkdirSync(join(d, 'tooling/ops'), { recursive: true });
        writeFileSync(
          join(d, 'tooling/ops/through-reader.mjs'),
          "// reads catalog/apps.json, through the one reader\nimport { BUNDLES_REGISTER } from '../catalog/read.mjs';\nexport const p = BUNDLES_REGISTER;\n",
        );
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.equal(readerCount(r.out), count);
  });

  test('G3 — a floor raised above the base branch floor is refused', () => {
    const baseDir = tree();
    const r = run(
      tree((d) => editJson(d, 'tooling/catalog/reader-floor.json', (doc) => ({ ...doc, floor: doc.floor + 1 }))),
      `--base-root=${baseDir}`,
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /raises the floor from \d+ \(--base-root tooling\/catalog\/reader-floor\.json\) to \d+\. The floor only falls/);
  });

  test('a floor file with no integer floor is COVERAGE LOST, never a clean count', () => {
    const r = run(tree((d) => editJson(d, 'tooling/catalog/reader-floor.json', (doc) => ({ ...doc, floor: 'many' }))));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/catalog\/reader-floor\.json carries no non-negative integer `floor`/);
  });
});

// ── H · A VERSION'S MEMBERSHIP IS LOCKED, AND THE LOCK ONLY GROWS ───────────
describe('limb H — O-BUNDLE-MEMBER-INSERT-UNLOCKED', () => {
  const LOCK = 'catalog/bundle-membership.lock.json';

  test('GREEN CONTROL — the real register equals its lock, compared against an identical base', () => {
    const baseDir = tree();
    const r = run(tree(), `--base-root=${baseDir}`);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /limb H: 1 bundle row\(s\) equal their lock entries; 1 lock entry, 0 new/);
  });

  test('RC2 — a member added to nikatru_all@1 without a version bump exits 1', () => {
    // The row's own red control. Also added to extensions.json so limb F stays
    // green and the red is limb H's alone.
    const r = run(
      tree((d) => {
        editJson(d, 'extensions/catalog/extensions.json', (doc) => [...doc, { ...doc[0], slug: 'newext', status: 'live' }]);
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].members.push({ slug: 'newext', kind: 'extension' });
          return doc;
        });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the members of nikatru_all@1 in catalog\/bundles\.json \(fullshot, newext, subscriptiontracker\) differ from its lock entry/);
  });

  test('RC3 — a lock entry edited against the base branch exits 1', () => {
    const baseDir = tree();
    const r = run(
      tree((d) =>
        editJson(d, LOCK, (doc) => ({ ...doc, 'nikatru_all@1': ['subscriptiontracker'] })),
      ),
      `--base-root=${baseDir}`,
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /edits nikatru_all@1 from \(fullshot, subscriptiontracker\) to \(subscriptiontracker\)\. The lock only grows/);
  });

  test('RC3 — a lock entry removed against the base branch exits 1', () => {
    const baseDir = tree();
    const r = run(
      tree((d) =>
        editJson(d, LOCK, (doc) => {
          const { 'nikatru_all@1': _gone, ...rest } = doc;
          return { ...rest, 'nikatru_all@2': ['fullshot', 'subscriptiontracker'] };
        }),
      ),
      `--base-root=${baseDir}`,
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no longer carries nikatru_all@1\. The lock only grows/);
  });

  test('RC4 — a NEW version whose member is not live exits 1', () => {
    // v2 keeps fullshot, which is `preview`: the parent's HARD rule, "a product
    // joins a bundle only after it is live", graded at the commit that adds it.
    const baseDir = tree();
    const r = run(
      tree((d) => {
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].version = 2;
          return doc;
        });
        editJson(d, LOCK, (doc) => ({ ...doc, 'nikatru_all@2': ['fullshot', 'subscriptiontracker'] }));
      }),
      `--base-root=${baseDir}`,
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /the NEW lock entry nikatru_all@2 names fullshot, which is not `live`/);
  });

  test('a NEW version whose members are all live passes — the bump is the way through', () => {
    const baseDir = tree();
    const r = run(
      tree((d) => {
        editJson(d, 'catalog/bundles.json', (doc) => {
          doc[0].version = 2;
          doc[0].members = [{ slug: 'subscriptiontracker', kind: 'app' }];
          doc[0].excluded = [{ slug: 'fullshot', why: 'preview; joins in the version after it is live' }];
          return doc;
        });
        editJson(d, LOCK, (doc) => ({ ...doc, 'nikatru_all@2': ['subscriptiontracker'] }));
      }),
      `--base-root=${baseDir}`,
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /limb H: 1 bundle row\(s\) equal their lock entries; 2 lock entries, 1 new, every new one all-live/);
  });

  test('a register row with NO lock entry exits 1', () => {
    const r = run(tree((d) => writeFileSync(join(d, LOCK), JSON.stringify({ _why: ['x'] }))));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /carries nikatru_all@1 and catalog\/bundle-membership\.lock\.json has no entry for it/);
  });
});

describe('tooling/bundle-availability.mjs — the derivation itself', () => {
  test('today: one live product, so the bundle is visible and NOT purchasable', async () => {
    const { bundleAvailability } = await import(
      pathToFileURL(join(REPO, 'tooling/bundle-availability.mjs')).href
    );
    const all = bundleAvailability(REPO);
    assert.deepEqual(all.problems, []);
    const a = all.byFeatureSet.get('nikatru_all');
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
    const a = bundleAvailability(REPO, { channel: 'not-a-channel' }).byFeatureSet.get('nikatru_all');
    assert.equal(a.why.rail, null);
    assert.equal(a.steerable, false);
    // A channel nobody decided is a PROBLEM, not a quiet false — the caller has
    // to be able to tell "not steerable" from "this derivation stopped reading".
    assert.ok(a.problems.length > 0, JSON.stringify(a.problems));
  });
});

// ── EXM-05 · LIMB I — A LIVE MEMBER CAN READ ITS ENTITLEMENT ────────────────
describe('limb I — a live member can read its entitlement (EXM-05)', () => {
  const TOOL = 'extensions/Extension/Full_Screen_Shot/tool.json';
  const EXTS = 'extensions/catalog/extensions.json';
  const goLive = (d) => editJson(d, EXTS, (rows) => rows.map((r) => (r.slug === 'fullshot' ? { ...r, status: 'live' } : r)));

  test('GREEN CONTROL — today fullshot is not live, so its empty allowlist is printed, not failed', () => {
    const r = run(tree());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /⬜ limb I \[nikatru_all\]: `fullshot` is not live yet and cannot read its entitlement/);
  });

  test('RED CONTROL — a scratch catalog with FullShot live and an empty networkAllowlist reports the bundle NOT PURCHASABLE (exit 1)', () => {
    const r = run(tree((d) => goLive(d)));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /\[nikatru_all\] NOT PURCHASABLE: member `fullshot` is live and cannot read its entitlement/);
    assert.match(r.out, /does not name platform\.nikatru\.com/);
  });

  test('FullShot live WITH the entitlement host in its allowlist clears limb I', () => {
    const r = run(
      tree((d) => {
        goLive(d);
        editJson(d, TOOL, (t) => {
          t.policy.networkAllowlist = ['platform.nikatru.com'];
        });
      }),
    );
    // Limb C still refuses a live second product with no bundle price; limb I is what is under test.
    assert.doesNotMatch(r.out, /NOT PURCHASABLE: member `fullshot`/);
    assert.match(r.out, /limb I: every live bundle member can read its entitlement from platform\.nikatru\.com/);
  });

  test('an allowlist naming some OTHER host is still unreadable', () => {
    const r = run(
      tree((d) => {
        goLive(d);
        editJson(d, TOOL, (t) => {
          t.policy.networkAllowlist = ['api.example.test'];
        });
      }),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /NOT PURCHASABLE: member `fullshot`/);
  });

  test('an extension member with no tool.json is COVERAGE LOST, never readable', () => {
    const r = run(tree((d) => rmSync(join(d, TOOL))));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — limb I \[nikatru_all\]: no extensions\/Extension\/\*\/tool\.json declares id "fullshot"/);
  });

  test('a served config with no sharedApiBaseUrl is COVERAGE LOST', () => {
    const r = run(
      tree((d) =>
        editJson(d, 'services/platform/src/app-config-data.json', (c) => {
          delete c.sharedApiBaseUrl;
        }),
      ),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — limb I .*sharedApiBaseUrl is undefined/);
  });

  test('the derivation reports the unreadable member with its reason', async () => {
    const dir = tree();
    const { memberEntitlementReach } = await derivationIn(dir);
    const reach = memberEntitlementReach(dir, [
      { slug: 'subscriptiontracker', kind: 'app' },
      { slug: 'fullshot', kind: 'extension' },
    ]);
    assert.deepEqual(reach.problems, []);
    assert.equal(reach.entitlementHost, 'platform.nikatru.com');
    assert.deepEqual(reach.unreadable.map((u) => u.slug), ['fullshot']);
  });
});
