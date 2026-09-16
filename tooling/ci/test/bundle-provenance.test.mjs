// ─────────────────────────────────────────────────────────────────────────────
// bundle-provenance.test.mjs — assert-bundle-provenance.mjs (invariant G7) must
// be able to FAIL, and it must fail on the RIGHT input.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-09, on the real
// worktree; every restore re-verified green, each exit code captured on its own
// line rather than beside a pipe):
//
//   BP0  green control, real tree                                  -> exit 0
//   BP1  the route takes `featureSetName` from the request body    -> exit 1
//   BP2  the verification seam removed from the writing route      -> exit 1
//   BP3  the guard run in a tree with no services/ at all          -> exit 1
//
// 🔴 WHY BP1 IS THE CASE THAT MATTERS. It is four characters of diff, it type-
// checks, every signature check upstream stays green, and it turns a route that
// verifies purchases into one that mints access from a JSON body — on the two
// platforms where the resulting unlock cannot be reversed. Nothing else in CI
// looks at the shape of that argument.
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
const GUARD = join(CI_DIR, 'assert-bundle-provenance.mjs');

const ROUTE = 'services/platform/src/routes/receipts.ts';
const WRITER = 'services/platform/src/lib/mor/bundle-store.ts';
const CONTRACT = 'contracts/entitlement/bundle.js';

/**
 * ⚠️ NARROWED to the Worker source trees rather than all of `services/`: copying
 * that root drags in node_modules and makes every case take a minute. The guard
 * still sweeps the whole root on the real tree; what is narrowed is the FIXTURE,
 * and a `services/` directory still exists in it so the coverage limb is exercised
 * rather than short-circuited.
 */
const DIRS = [
  'services/platform/src',
  'services/subscriptiontracker-api/src',
  'contracts/entitlement',
];

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-g7-'));
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

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function editText(dir, rel, fn) {
  const p = join(dir, rel);
  writeFileSync(p, fn(readFileSync(p, 'utf8')));
}

describe('assert-bundle-provenance.mjs — no entitlement without a verified receipt', () => {
  test('BP0 GREEN CONTROL — the real tree passes, and says what it graded', () => {
    const r = run(tree(DIRS));
    assert.equal(r.code, 0, r.out);
    // The exempt list was READ, not restated — the property that stops this
    // guard from drifting away from the seed it is meant to be enforcing.
    assert.match(r.out, /are exempt, read from contracts\/entitlement\/bundle\.js rather than restated here/);
    assert.match(r.out, /writer file\(s\) into bundle_grants/);
    assert.match(r.out, /call site\(s\) of the writer were graded/);
  });

  test('BP1 — a route that takes the FEATURE SET from a client body goes RED', () => {
    const r = run(
      tree(DIRS, (d) =>
        editText(d, ROUTE, (s) =>
          s.replace('    featureSetName: fs.name,', '    featureSetName: body.feature_set as string,'),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /CLIENT-SUPPLIED BODY/);
    assert.match(r.out, /featureSetName/);
  });

  test('BP1b — a route that takes the EXPIRY from a client body goes RED', () => {
    const r = run(
      tree(DIRS, (d) =>
        editText(d, ROUTE, (s) =>
          s.replace(
            '    expiresAt: extendExpiry(receipt.expiresAt, credit),',
            '    expiresAt: body.expires_at as string,',
          ),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /passes `expiresAt`/);
  });

  test('BP2 — removing the verification seam from the writing route goes RED', () => {
    const r = run(
      tree(DIRS, (d) =>
        editText(d, ROUTE, (s) =>
          s
            .replace(
              "import { receiptVerifierFor } from '../lib/receipts/registry';",
              "import { receiptVerifierFor as pick } from '../lib/receipts/reg' + 'istry';",
            )
            .replace('receiptVerifierFor(storeId)', 'pick(storeId)')
            .replace('await verifier.verify(', 'await answerFor('),
        ),
      ),
    );
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never reaches a verification seam/);
  });

  test('BP3 — a tree with no services/ at all is COVERAGE LOST, never a clean run', () => {
    const r = run(tree(['contracts/entitlement']));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /services\/ does not exist/);
  });

  test('BP4 — a writer with NO caller is COVERAGE LOST, not a pass over nothing', () => {
    const r = run(
      tree(DIRS, (d) => {
        rmSync(join(d, ROUTE));
      }),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /graded zero call sites/);
  });

  test('BP5 — an unreadable exemption table is COVERAGE LOST, because G7 IS the difference between the two kinds', () => {
    const r = run(
      tree(DIRS, (d) =>
        editText(d, CONTRACT, (s) => s.replace('export const BUNDLE_SOURCES = [', 'export const BUNDLE_SOURCES_RENAMED = [')),
      ),
    );
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /parsed to ZERO bundle sources/);
  });

  test('BP6 — the one writer is still the one this guard found, by name', () => {
    const r = run(tree(DIRS));
    assert.equal(r.code, 0, r.out);
    // If the writer moves, this line is the diff that says so — the guard locates
    // it by scanning rather than by a path constant, and a scan that quietly found
    // a DIFFERENT file would otherwise look identical.
    assert.match(r.out, new RegExp(WRITER.replaceAll('/', '\\/')));
  });
});
