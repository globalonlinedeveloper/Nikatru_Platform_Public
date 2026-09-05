/* contracts-sync.test.mjs — sync-contracts.mjs and check-contracts-sync.mjs
   must be able to FAIL.
   =====================================================================

   BUILD-TIME MODULE. NEVER SHIPPED.

     node --test extensions/scripts/test/contracts-sync.test.mjs

   ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-09-05, on this
   worktree; green control, mutate, run, restore, re-verify green):

     C1  `chargeback_reversed.restores` flipped in     -> check-contracts-sync exit 1,
         extensions/core/entitlement-contract.js           "MODIFIED … a COPY, not a fork"
     C2  the same flip, re-synced from contracts/     -> exit 0 again

   ⚠️ AND THE GAP THIS FILE DOES NOT CLOSE, said here rather than left implied:
   no workflow invokes `check-contracts-sync.mjs` yet — `.github/workflows/
   extensions.yml` is outside the unit that added these scripts. What DOES gate
   the property in CI is `tooling/ci/assert-entitlement-contract.mjs` limb 4,
   which byte-compares `extensions/core/entitlement-contract.js` against
   `contracts/entitlement/contract.js` on every run of ci.yml's guards-legal
   lane. These two scripts are the authoring path and its faster, sharper
   message.

   Exit codes under test: 0 in sync · 1 drifted · 2 could not run. */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SYNC = join(SCRIPTS, 'sync-contracts.mjs');
const CHECK = join(SCRIPTS, 'check-contracts-sync.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-csync-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const CONTRACT = `// @ts-check
export const MONEY_ENVIRONMENTS = ['live', 'sandbox'];
export const REVOCATION_REASONS = [
  { reason: 'refund_approved', restores: false },
  { reason: 'chargeback_reversed', restores: true },
];
export const CONTRACT_TABLE = { moneyEnvironments: MONEY_ENVIRONMENTS, revocationReasons: REVOCATION_REASONS };
`;

/**
 * A synthetic monorepo: `<root>/contracts/entitlement/contract.js` beside
 * `<root>/extensions/`, which is the real layout. The scripts take
 * `--repo-root` (the extensions subtree) and `--contracts-root` (the monorepo
 * root) precisely so this fixture is possible — a gate you can only run against
 * the real repository is a gate you can only negative-test by breaking it.
 */
function fixture(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  const ext = join(root, 'extensions');
  const core = join(ext, 'core');
  const contracts = join(root, 'contracts', 'entitlement');
  mkdirSync(core, { recursive: true });
  mkdirSync(contracts, { recursive: true });
  if (o.source !== null) writeFileSync(join(contracts, 'contract.js'), o.source ?? CONTRACT);
  if (o.vendored !== undefined && o.vendored !== null) {
    writeFileSync(join(core, 'entitlement-contract.js'), o.vendored);
  }
  return { root, ext, vendoredPath: join(core, 'entitlement-contract.js'), sourcePath: join(contracts, 'contract.js') };
}

function run(script, f, extra = []) {
  const r = spawnSync(
    process.execPath,
    [script, '--repo-root', f.ext, '--contracts-root', f.root, ...extra],
    { encoding: 'utf8' },
  );
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('sync-contracts — the extension runtime carries the authored bytes', () => {
  test('writes the vendored copy byte-for-byte', () => {
    const f = fixture();
    const s = run(SYNC, f);
    assert.equal(s.code, 0, s.out);
    assert.equal(readFileSync(f.vendoredPath, 'utf8'), CONTRACT);
  });

  test('stamps NOTHING onto the copy — byte-identical is the claim being made', () => {
    // A generated banner would make the cheapest possible verification — a hash —
    // impossible, and the whole arrangement rests on "the same bytes".
    const f = fixture();
    run(SYNC, f);
    assert.equal(readFileSync(f.vendoredPath, 'utf8'), readFileSync(f.sourcePath, 'utf8'));
  });

  test('--dry-run writes nothing', () => {
    const f = fixture();
    const s = run(SYNC, f, ['--dry-run']);
    assert.equal(s.code, 0, s.out);
    assert.equal(existsSync(f.vendoredPath), false);
  });

  test('--check exits 1 when the copy would change, and 0 when it would not', () => {
    const f = fixture({ vendored: CONTRACT.replace('restores: true', 'restores: false') });
    const drifted = run(SYNC, f, ['--check']);
    assert.equal(drifted.code, 1, drifted.out);
    run(SYNC, f);
    const clean = run(SYNC, f, ['--check']);
    assert.equal(clean.code, 0, clean.out);
  });

  test('CANNOT RUN (2) when there is no contracts/ directory to read', () => {
    const f = fixture();
    const s = spawnSync(process.execPath, [SYNC, '--repo-root', f.ext, '--contracts-root', join(TMP, 'nowhere')], { encoding: 'utf8' });
    assert.equal(s.status, 2, `${s.stdout}${s.stderr}`);
  });

  test('CANNOT RUN (2) when the authored contract is EMPTY — zero bytes satisfies every later hash', () => {
    const f = fixture({ source: '' });
    const s = run(SYNC, f);
    assert.equal(s.code, 2, s.out);
    assert.match(s.out, /is EMPTY/);
  });
});

describe('check-contracts-sync — a vendored contract that drifted is loud', () => {
  test('PASSES on a copy the sync just wrote', () => {
    const f = fixture();
    run(SYNC, f);
    const c = run(CHECK, f);
    assert.equal(c.code, 0, c.out);
    assert.match(c.out, /byte-identical to the authored copy/);
  });

  test('FAILS when the vendored copy is hand-edited — the restoring flag flipped', () => {
    const f = fixture({ vendored: CONTRACT.replace('restores: true', 'restores: false') });
    const c = run(CHECK, f);
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /MODIFIED/);
    assert.match(c.out, /a COPY, not a fork/);
  });

  test('FAILS when only the LINE ENDINGS differ, and says so rather than printing two hashes', () => {
    const f = fixture({ vendored: CONTRACT.replace(/\n/g, '\r\n') });
    const c = run(CHECK, f);
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /LINE ENDINGS/);
    assert.match(c.out, /the content is identical/);
  });

  test('FAILS when the vendored copy is missing entirely', () => {
    const f = fixture();
    const c = run(CHECK, f);
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /MISSING/);
  });

  test('CANNOT RUN (2) when contracts/ is absent — a gate that cannot look must not pass', () => {
    const f = fixture();
    run(SYNC, f);
    const s = spawnSync(process.execPath, [CHECK, '--repo-root', f.ext, '--contracts-root', join(TMP, 'nowhere')], { encoding: 'utf8' });
    assert.equal(s.status, 2, `${s.stdout}${s.stderr}`);
    assert.match(`${s.stdout}${s.stderr}`, /CANNOT RUN/);
  });

  test('a typo in a flag is refused, not ignored', () => {
    // `--strickt` must not read as "strict mode off".
    const f = fixture();
    const s = spawnSync(process.execPath, [CHECK, '--repo-root', f.ext, '--contracts-root', f.root, '--strickt'], { encoding: 'utf8' });
    assert.equal(s.status, 2, `${s.stdout}${s.stderr}`);
    assert.match(`${s.stdout}${s.stderr}`, /unknown option/);
  });
});
