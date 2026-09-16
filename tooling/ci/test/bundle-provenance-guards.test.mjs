// ─────────────────────────────────────────────────────────────────────────────
// bundle-provenance-guards.test.mjs — assert-no-null-entitlement-key.mjs and
// assert-no-store-bundle-copy.mjs must be able to FAIL, and the second one must
// also be able to STAND DOWN.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-09, six, on the
// real worktree; every restore re-verified green).
//
//   NK1  `feature_set_members.product_slug` made nullable      -> exit 1
//   NK2  a writer binding a LITERAL NULL to `entitlements.app_id` -> exit 1
//   NK3  `bundle_grants.user_id` made nullable                 -> exit 1
//   SB1  a Play long-description advertising the bundle        -> exit 1
//   SB2  the SERVED paywall config naming the bundle           -> exit 1
//   SB3  a tree with no store/ directory                       -> exit 1 (COVERAGE LOST)
//
// 🔴 A DEFECT THE FIRST RUN FOUND IN assert-no-null-entitlement-key ITSELF, and it
// was a false RED — the harmless direction, and still wrong. Limb C took the
// CREATE body as "everything after the opening paren", so it ran to the end of
// the file and swept in `CREATE INDEX … ON feature_set_members (product_slug)`;
// and splitting on commas made `PRIMARY KEY (name, version, product_slug)` yield
// a piece reading `product_slug)`, which matched the column name and naturally
// carried no NOT NULL. The body is balanced now and a column DECLARATION must
// name a type, which is what separates it from a constraint clause mentioning the
// same identifier.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const NULL_KEY_GUARD = join(CI_DIR, 'assert-no-null-entitlement-key.mjs');
const STORE_COPY_GUARD = join(CI_DIR, 'assert-no-store-bundle-copy.mjs');

const MIGRATION = 'services/platform/migrations/0009_bundle_grants.sql';
const STORE = 'services/platform/src/lib/mor/store.ts';
const LONG_DESC = 'apps/subscriptiontracker/store/android-play/long-description.txt';
const SERVED = 'services/platform/src/app-config-data.json';
const APPS = 'catalog/apps.json';
const EXTS = 'extensions/catalog/extensions.json';
const BUNDLES = 'catalog/bundles.json';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-bp-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

let seq = 0;

/** A throwaway copy of the real subject trees. Copied, never authored. */
function tree(dirs, mutate = () => {}) {
  const dir = join(TMP, `t${seq++}`);
  for (const rel of dirs) {
    const from = join(REPO, rel);
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    cpSync(from, join(dir, rel), { recursive: true });
  }
  mutate(dir);
  return dir;
}

function run(guard, dir) {
  const r = spawnSync(process.execPath, [guard, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function editText(dir, rel, fn) {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

// ═════════════════════════════════════════════════════════════════════════════
// ⚠️ NARROWED to the two Worker source trees rather than all of `services/`:
// copying that root drags in node_modules and made each case take ~60s. The guard
// itself still sweeps the whole root on the real tree; what is narrowed is the
// FIXTURE, and the coverage limb still sees a services/ directory.
const NULL_KEY_DIRS = [
  'services/platform/migrations',
  'services/platform/src',
  'services/subscriptiontracker-api/src',
];

describe('assert-no-null-entitlement-key — the trap SQLite will not close', () => {
  test('GREEN CONTROL — the real tree passes, and re-derives the measurement', () => {
    const r = run(NULL_KEY_GUARD, tree(NULL_KEY_DIRS));
    assert.equal(r.code, 0, r.out);
    // 🔴 THE GUARD'S AUTHORITY IS THAT IT MEASURED, not that it remembers. If this
    // line ever stops appearing, the rule below it has become a sentence.
    assert.match(r.out, /the NULL trap is REAL on this runtime, re-derived not recalled/);
    assert.match(r.out, /`bundle_grants` REFUSES a NULL `user_id` at the engine/);
  });

  test('NK1 — a nullable key column on a table new enough to refuse it is refused', () => {
    const r = run(
      NULL_KEY_GUARD,
      tree(NULL_KEY_DIRS, (d) =>
        editText(d, MIGRATION, (s) => s.replace('  product_slug TEXT NOT NULL,', '  product_slug TEXT,')),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /feature_set_members\.product_slug is declared NULLABLE/);
  });

  test('NK2 — a writer binding a LITERAL NULL to a key column is refused', () => {
    const r = run(
      NULL_KEY_GUARD,
      tree(NULL_KEY_DIRS, (d) =>
        editText(d, STORE, (s) =>
          s.replace(
            '       ) VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            '       ) VALUES (?,NULL,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /binds a LITERAL NULL to the key column `app_id`/);
  });

  test('NK3 — `bundle_grants.user_id` made nullable is refused by BOTH the engine and the schema limb', () => {
    const r = run(
      NULL_KEY_GUARD,
      tree(NULL_KEY_DIRS, (d) =>
        editText(d, MIGRATION, (s) =>
          s.replace('  user_id                  TEXT NOT NULL,', '  user_id                  TEXT,'),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    // The ENGINE limb is the one that matters: it proves the constraint is gone in
    // fact, not just in text.
    assert.match(r.out, /THE ENGINE ACCEPTED A NULL `bundle_grants.user_id`/);
  });

  test('a tree with no migrations is COVERAGE LOST, never a clean run', () => {
    const r = run(NULL_KEY_GUARD, mkdtempSync(join(TMP, 'empty-')));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
const STORE_DIRS = [
  'tooling/bundle-availability.mjs',
  'contracts/entitlement/bundle.js',
  'catalog/apps.json',
  'catalog/bundles.json',
  'extensions/catalog/extensions.json',
  'tooling/channel-register.json',
  'apps/subscriptiontracker/store',
  'services/platform/src/app-config-data.json',
];

describe('assert-no-store-bundle-copy — no promise of what cannot be delivered', () => {
  test('GREEN CONTROL — the real tree passes, and says how much it read', () => {
    const r = run(STORE_COPY_GUARD, tree(STORE_DIRS));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /textual file\(s\) across 1 store tree\(s\)/);
    assert.match(r.out, /while the bundle is not purchasable/);
  });

  test('SB1 — a store listing advertising the bundle is refused', () => {
    const r = run(
      STORE_COPY_GUARD,
      tree(STORE_DIRS, (d) =>
        editText(d, LONG_DESC, (s) => `${s}\nGet the Nikatru bundle — one subscription for all our apps.\n`),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /long-description\.txt contains/);
  });

  test('SB2 — the SERVED paywall config naming the bundle is refused', () => {
    // A different file with the same exposure: this one reaches a store build's
    // SCREEN with no listing change at all.
    const r = run(
      STORE_COPY_GUARD,
      tree(STORE_DIRS, (d) =>
        editText(d, SERVED, (s) => s.replace('"defaults"', '"_promo": "Nikatru bundle",\n  "defaults"')),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /reaches a store screen without any listing change/);
  });

  test('SB3 — a tree with no store/ directory is COVERAGE LOST, not a clean run', () => {
    const r = run(
      STORE_COPY_GUARD,
      tree(STORE_DIRS.filter((d) => !d.startsWith('apps/'))),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('🔴 SB4 — the ban STANDS DOWN when the derivation says the bundle is purchasable', () => {
    // Without this case the guard is indistinguishable from an unconditional ban,
    // and on the day the second product goes live somebody would delete it — which
    // is how a repository learns that guards are things you delete. The condition
    // is DERIVED, so the stand-down needs no edit to this guard.
    const r = run(
      STORE_COPY_GUARD,
      tree(STORE_DIRS, (d) => {
        // The enable trigger, exactly as stated: a second product's status flips
        // to "live" in its own catalogue.
        const exts = JSON.parse(readFileSync(join(d, EXTS), 'utf8')).map((x) => ({ ...x, status: 'live' }));
        writeFileSync(join(d, EXTS), JSON.stringify(exts, null, 2));
        const bundles = JSON.parse(readFileSync(join(d, BUNDLES), 'utf8')).map((b) => ({
          ...b,
          priceIds: { paddle: { monthly: 'pri_fixture', yearly: 'pri_fixture_y' } },
        }));
        writeFileSync(join(d, BUNDLES), JSON.stringify(bundles, null, 2));
        // …and the copy that WOULD have been banned a moment ago.
        editText(d, LONG_DESC, (s) => `${s}\nGet the Nikatru bundle — one subscription for all our apps.\n`);
      }),
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /the ban does not apply — the bundle can be bought/);
  });

  test('an unreadable register is COVERAGE LOST — never "assume banned", never "assume allowed"', () => {
    const r = run(
      STORE_COPY_GUARD,
      tree(STORE_DIRS, (d) => writeFileSync(join(d, APPS), '{not json')),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
  });
});
