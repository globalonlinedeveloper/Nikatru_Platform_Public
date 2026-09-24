#!/usr/bin/env node
/* SPDX-License-Identifier: MPL-2.0
   core/test/entitlement-contract.node.js — the sim for core/v1/entitlement-contract.js.

   Loads the REAL shipped bytes of v1/entitlement-contract.js on bare Node and
   grades them. Nothing here re-states the vocabulary: a test that lists the
   eight reasons back is the fourth transcription this whole arrangement exists
   to prevent, and it passes forever after the subject is wrong. What is graded
   is SHAPE and the one member with consequences.

   WHY THIS SIM DOES NOT CALL H.loadCore(). loadCore runs its argument through
   vm.runInContext, which parses a CLASSIC SCRIPT — and this module is the one
   file on the vendored surface that is an ES module, because it is the
   byte-identical copy of contracts/entitlement/contract.js and the Cloudflare
   Worker imports those same bytes. Running it as a classic script would fail on
   `export` and the sim would be grading a SyntaxError. So it is loaded the way
   its consumers load it — as a module, from the real bytes read off disk. The
   mutation sections load a mutant of those same bytes the same way.

   ⚠️ THE ONE DEVIATION FROM docs/CORE-POLICY.md §2 rule 4, stated rather than
   hidden: the shared files on this surface are classic scripts attaching to a
   namespace, and this one is a module with named exports. It is on the surface
   anyway because the alternative — a hand-rewritten classic-script version —
   would be a SECOND copy of the money vocabulary, which is the exact failure
   contracts/ exists to prevent. Byte-identity is worth more here than
   uniformity of module system, and it is checked twice:
   extensions/scripts/check-contracts-sync.mjs (extensions-ci.yml, core) and
   tooling/ci/assert-entitlement-contract.mjs limb 4 (ci.yml).

   Run: node core/test/entitlement-contract.node.js      (cwd-independent) */

'use strict';

const H = require('./harness.js');
const { check, section, note } = H;

const MODULE = 'v1/entitlement-contract.js';
const SRC = H.readCore(MODULE);

/* The real bytes, loaded as a module. `source` overrides them — that is how the
   teeth sections load a mutant of the same file. */
function load(source) {
  const bytes = source === undefined ? SRC : source;
  return import('data:text/javascript;base64,' + Buffer.from(bytes, 'utf8').toString('base64'));
}

async function main() {
  /* ---------------------------------------------------------------- */
  section('it loads at all, on bare Node, from the shipped bytes');
  /* ---------------------------------------------------------------- */
  const M = await load();
  check('the module loads with no globals, no DOM and no chrome', !!M);
  check('it exports the six names its consumers import',
    ['MONEY_ENVIRONMENTS', 'REVOCATION_REASONS', 'isMoneyEnvironment', 'isRevocationReason',
      'restoresAccess', 'CONTRACT_TABLE'].every((n) => M[n] !== undefined),
    Object.keys(M).join(', '));

  /* ---------------------------------------------------------------- */
  section('CORE-POLICY §1.3 — shared code makes no network call, ever');
  /* ---------------------------------------------------------------- */
  {
    const banned = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource'];
    const hits = banned.filter((b) => SRC.indexOf(b) >= 0);
    check('no network API appears anywhere in the shipped source', hits.length === 0, hits.join(', '));
    check('no top-level side effect beyond the exports — nothing is scheduled at load',
      !/\bset(Timeout|Interval)\s*\(/.test(SRC));
  }

  /* ---------------------------------------------------------------- */
  section('the money environments');
  /* ---------------------------------------------------------------- */
  {
    const envs = M.MONEY_ENVIRONMENTS;
    check('there are at least two, and they are unique',
      Array.isArray(envs) && envs.length >= 2 && new Set(envs).size === envs.length,
      JSON.stringify(envs));
    check('every declared environment is recognised by the predicate',
      envs.every((e) => M.isMoneyEnvironment(e) === true));
    check('a value that is not declared is refused', M.isMoneyEnvironment('production') === false);
    check('a non-string is refused rather than coerced',
      M.isMoneyEnvironment(0) === false && M.isMoneyEnvironment(null) === false &&
      M.isMoneyEnvironment(undefined) === false);
  }

  /* ---------------------------------------------------------------- */
  section('the revocation-reason set — shape, not a re-listing');
  /* ---------------------------------------------------------------- */
  {
    const rs = M.REVOCATION_REASONS;
    check('the table is non-empty. An empty table would make every check below vacuous',
      Array.isArray(rs) && rs.length > 0, rs && rs.length);
    check('every row is {reason: string, restores: boolean}',
      rs.every((r) => typeof r.reason === 'string' && r.reason && typeof r.restores === 'boolean'));
    check('no reason is declared twice', new Set(rs.map((r) => r.reason)).size === rs.length);

    const restoring = rs.filter((r) => r.restores);
    check('EXACTLY ONE member restores access — the field a second copy gets wrong',
      restoring.length === 1, restoring.map((r) => r.reason).join(', '));
    note('the member that restores access: ' + (restoring[0] ? restoring[0].reason : '(none)'));

    check('every declared reason is recognised by the predicate',
      rs.every((r) => M.isRevocationReason(r.reason) === true));
    check('a reason the contract never declared is refused',
      M.isRevocationReason('vibes') === false);
    check('a non-string is refused rather than coerced',
      M.isRevocationReason(null) === false && M.isRevocationReason(7) === false);

    check('restoresAccess() agrees with the table for every row, resolved not remembered',
      rs.every((r) => M.restoresAccess(r.reason) === r.restores));
    check('restoresAccess() on an unknown reason is false, not undefined',
      M.restoresAccess('vibes') === false);
  }

  /* ---------------------------------------------------------------- */
  section('CONTRACT_TABLE is the same data, not a second copy of it');
  /* ---------------------------------------------------------------- */
  {
    const t = M.CONTRACT_TABLE;
    check('CONTRACT_TABLE.moneyEnvironments IS the exported array (identity, not equality)',
      t.moneyEnvironments === M.MONEY_ENVIRONMENTS);
    check('CONTRACT_TABLE.revocationReasons IS the exported array (identity, not equality)',
      t.revocationReasons === M.REVOCATION_REASONS);
  }

  /* ---------------------------------------------------------------- */
  section('TEETH — the recorded failing cases (docs/CORE-POLICY.md §2 rule 3)');
  /* ---------------------------------------------------------------- */

  /* 1. Lose the one flag that gives access back. This is the real-world defect:
        a copy that drops it leaves a customer who raised a dispute in error,
        and lost it, locked out forever. */
  await H.expectBroken('the exactly-one-restores check depends on the `restores: true` flag', async () => {
    const mutant = H.mutate(SRC,
      "  { reason: 'chargeback_reversed', restores: true },",
      "  { reason: 'chargeback_reversed', restores: false },");
    const B = await load(mutant);
    return B.REVOCATION_REASONS.filter((r) => r.restores).length === 1;
  });

  /* 2. Make the membership predicate fail open. A predicate that says yes to
        everything is how an invented reason reaches an entitlements row. */
  await H.expectBroken('the unknown-reason-is-refused check depends on the set lookup', async () => {
    const mutant = H.mutate(SRC,
      "  return typeof v === 'string' && REASON_SET.has(v);",
      "  return typeof v === 'string';");
    const B = await load(mutant);
    return B.isRevocationReason('vibes') === false;
  });

  /* 3. Make restoresAccess() ignore the flag and answer from membership alone.
        Every row would then restore access, including a chargeback. */
  await H.expectBroken('the restoresAccess-agrees-with-the-table check depends on the `r.restores` term', async () => {
    const mutant = H.mutate(SRC,
      '  return REVOCATION_REASONS.some((r) => r.reason === reason && r.restores);',
      '  return REVOCATION_REASONS.some((r) => r.reason === reason);');
    const B = await load(mutant);
    return B.REVOCATION_REASONS.every((r) => B.restoresAccess(r.reason) === r.restores);
  });
}

main().then(() => process.exit(H.finish()), (e) => {
  console.error('\nSIM CRASHED — this is a failure, not a skip:\n', e);
  process.exit(1);
});
