// ─────────────────────────────────────────────────────────────────────────────
// entitlement-contract.test.mjs — assert-entitlement-contract.mjs must be able
// to FAIL.
//
// [pipeline 5]M-3 the entitlement record is complete BEFORE the first payment
// lands · [5]M-2 the verbatim notification store and its exactly-once
// constraint · [5]M-7 the attribution tables.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-01, ten, on a
// scratch COPY of the repo; each one restored and the restore re-verified green
// by the harness itself). A fixture you wrote encodes the same misunderstanding
// as the guard you wrote — assert-seams-wired.mjs shipped with ALL SIX of its
// fixture tests passing against a version whose caller check matched the
// function's own declaration.
//
//   EC1  `ALTER TABLE entitlements ADD COLUMN occurred_at`   -> caught: "entitlements
//        deleted from the real migration                        .occurred_at — MISSING"
//   EC2  the same for `provider_status`                      -> caught: same shape
//   EC3  `chargeback_reversed` removed from the seed —       -> caught: "revocation reason
//        the ONLY member that restores access                   'chargeback_reversed' is NOT seeded"
//   EC4  `provider_notifications` renamed away               -> caught: "table
//                                                              `provider_notifications` — MISSING"
//   EC5  its UNIQUE INDEX downgraded to a plain INDEX —      -> caught: "no UNIQUE INDEX on
//        the table still exists, dedup does not                 (provider, provider_event_id)"
//   EC6  the TS set says `chargeback_reversed` does NOT      -> caught: "disagrees about
//        restore access, contradicting the seed                 RESTORING ACCESS"
//   EC7  a reason added to TS that the DB never heard of     -> caught: "is NOT seeded in
//                                                                the migration"
//   EC8  `REVOCATION_REASONS` renamed in contract.ts         -> caught: "COVERAGE LOST —
//                                                                parsed zero entries"
//   EC9  the seed INSERT retargeted at another table         -> caught: "no `INSERT INTO
//                                                                revocation_reasons"
//   EC10 `unclaimed_payments` renamed away                   -> caught: "table
//                                                              `unclaimed_payments` — MISSING"
//   None crashed; every one exited 1 with the intended message; every restore
//   was verified green by the harness before the next mutation ran.
//
// 🔴 AND ONE DEFECT THE MUTATION RUN FOUND IN THE GUARD ITSELF, before any test
// existed: the VALUES-tuple scanner read `ON CONFLICT(reason) DO NOTHING` as one
// more tuple and reported a seeded reason called `reason`. It failed LOUDLY
// rather than passing wrongly — but a parser that miscounts parentheses can just
// as easily fail in the other direction, and no fixture anyone would think to
// write exercises a bug in the parser rather than in the thing parsed. The
// statement is now truncated at the conflict clause; `does not read ON CONFLICT
// as a values tuple` below is that case, permanently.
//
// ─────────────────────────────────────────────────────────────────────────────
// LIMB 5 (the two-writer ordering clause) — REAL-TREE MUTATIONS, 2026-08-09,
// EIGHT, run against THIS worktree before any fixture below existed. Each was
// applied to the real file, the guard run, the file restored with `git checkout
// --`, and the restore re-verified green before the next one.
//
//   O1  `>` → `>=` in webhooks.ts's SQL    -> caught: "the UPSERT's ordering clause is
//                                              not the shared one", printing found vs required
//   O2  the whole WHERE tail deleted        -> caught: "the UPSERT into `entitlements` is
//        from store.ts                         UNCONDITIONAL: `DO UPDATE SET` with no trailing WHERE"
//   O3  `toISOString` → `toUTCString`       -> caught, TWICE: "never produces `new Date(…)
//        in validate.ts                        .toISOString()`" AND the per-return rule
//   O4  a bypass `return { ok: true,        -> caught by the per-return rule ALONE — the canonical
//        iso: v }` ADDED to normalizeInstant   expression was still sitting untouched below it,
//                                              so the "contains toISOString" check stayed green
//   O5  paddle.ts's three `normalizeInstant`-> caught: "declared in … but CALLED from nowhere
//        call-sites renamed away               else under services/"
//   O6  the SQL clause deleted from         -> caught: UNCONDITIONAL. The `// ORDERING` header
//        webhooks.ts, LEAVING the prose        comment still contains the clause verbatim, and a
//        copy in its header comment            text scan of that file would have passed
//   O7  `export function isoFromEpochMs`    -> caught: "COVERAGE LOST — no `export function
//        renamed, callers left alone           isoFromEpochMs`"
//   O8  the entire `ON CONFLICT … DO UPDATE -> caught: "COVERAGE LOST — no conditional UPSERT
//        SET … WHERE` cut from webhooks.ts     … was parsed out of …"
//
// ⚠️ AND THE ONE THAT DID NOT COUNT, recorded because it is the failure mode of
// mutation testing itself: O8's first attempt anchored its end-of-cut on the
// FIRST occurrence of `OR excluded.occurred_at > …`, which is in the file's
// header COMMENT ~450 lines above the SQL. The splice duplicated half the file
// instead of removing the clause, the guard printed ok, and for a moment that
// read as a hole in the guard. It was a hole in the mutation. A mutation that
// produces a tree you did not intend proves nothing in either direction — so the
// anchor now searches FROM the start of the cut, and the mutation script prints
// the resulting `ON CONFLICT` count (0) rather than assuming it.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-entitlement-contract.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-entc-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

/** The eight columns 0001 declares, unchanged. */
const MIGRATION_0001 = `
-- A header comment that NAMES columns that are NOT here, on purpose:
--   provider, provider_status, revocation_reason, revoked_at
-- A guard that grepped for column names would find all four in this comment.
CREATE TABLE IF NOT EXISTS entitlements (
  user_id     TEXT,
  app_id      TEXT,
  entitlement TEXT,
  product_id  TEXT,
  store       TEXT,
  is_active   INTEGER DEFAULT 0,
  expires_at  TEXT,
  updated_at  TEXT,
  PRIMARY KEY (user_id, app_id, entitlement)
);
`;

const ALL_COLUMNS = [
  'provider',
  'provider_environment',
  'provider_subscription_id',
  'provider_transaction_id',
  'provider_status',
  'last_event_id',
  'occurred_at',
  'current_period_end',
  'trial_end',
  'revoked_at',
  'revocation_reason',
];

const ALL_REASONS = [
  ['refund_approved', 0],
  ['chargeback', 0],
  ['chargeback_reversed', 1],
  ['subscription_expired', 0],
  ['trial_expired', 0],
  ['payment_failed_final', 0],
  ['cancelled_at_period_end', 0],
];

function migration0004(o = {}) {
  const columns = (o.columns ?? ALL_COLUMNS).map((c) => `ALTER TABLE entitlements ADD COLUMN ${c} TEXT;`).join('\n');
  const uniqueKeyword = o.plainIndex ? '' : 'UNIQUE ';
  const notificationsTable = o.notificationsTable ?? 'provider_notifications';
  const reasons = (o.reasons ?? ALL_REASONS)
    // A description containing BOTH a comma and a parenthesised aside, because
    // the real seed does and the tuple scanner has to survive it.
    .map(([r, restores]) => `  ('${r}', ${restores}, 'why this happens (stage 13), in one sentence')`)
    .join(',\n');
  const seedTable = o.seedTable ?? 'revocation_reasons';
  return `
${columns}

CREATE TABLE IF NOT EXISTS ${notificationsTable} (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_notification_id TEXT,
  event_type TEXT,
  occurred_at TEXT,
  environment TEXT,
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  derived_at TEXT,
  derive_error TEXT
);
CREATE ${uniqueKeyword}INDEX IF NOT EXISTS idx_provider_notifications_event
  ON ${notificationsTable} (provider, provider_event_id);

CREATE TABLE IF NOT EXISTS provider_accounts (
  provider TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  linked_from_event_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_accounts_sub
  ON provider_accounts (provider, provider_subscription_id);

CREATE TABLE IF NOT EXISTS ${o.unclaimedTable ?? 'unclaimed_payments'} (
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  claimed_at TEXT,
  claimed_user_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unclaimed_event
  ON ${o.unclaimedTable ?? 'unclaimed_payments'} (provider, provider_event_id);

CREATE TABLE IF NOT EXISTS revocation_reasons (
  reason TEXT PRIMARY KEY,
  restores_access INTEGER NOT NULL DEFAULT 0,
  description TEXT
);

INSERT INTO ${seedTable} (reason, restores_access, description) VALUES
${reasons}
ON CONFLICT(reason) DO NOTHING;
`;
}

/** The ordering tail both writers must carry, whitespace notwithstanding. */
const CLAUSE = `WHERE entitlements.occurred_at IS NULL
        OR excluded.occurred_at > entitlements.occurred_at`;

/** The MoR half of limb 4, plus limb 5's `normalizeInstant`. */
function contractTs(entries = ALL_REASONS, o = {}) {
  const body = entries.map(([r, restores]) => `  { reason: '${r}', restores: ${restores === 1} },`).join('\n');
  const bypass = o.morBypass ? "  if (typeof v === 'string' && v.endsWith('Z')) return { ok: true, iso: v };\n" : '';
  const canonical = o.morCanonical ?? 'new Date(ms).toISOString()';
  const fn = o.morFnName ?? 'normalizeInstant';
  return `
// A doc comment that names a reason nobody seeds: 'wibble'.
export interface RevocationReason { readonly reason: string; readonly restores: boolean; }
export const ${'REVOCATION_REASONS'}: readonly RevocationReason[] = [
${body}
];

// A prose copy of the instant rule, so a text scan for toISOString() finds one
// even in the fixtures where the code no longer has it:
//   return { ok: true, iso: new Date(ms).toISOString() };
export function ${fn}(v: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (v === null || v === undefined) return { ok: true, iso: null };
${bypass}  if (typeof v !== 'string') return { ok: false };
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return { ok: false };
  return { ok: true, iso: ${canonical} };
}
`;
}

/** The RevenueCat half's canonicaliser. */
function validateTs(o = {}) {
  const bypass = o.rcBypass ? '  if (typeof ms === \'string\') return ms;\n' : '';
  const canonical = o.rcCanonical ?? 'new Date(ms).toISOString()';
  const fn = o.rcFnName ?? 'isoFromEpochMs';
  return `
export function ${fn}(ms: unknown): string | null {
${bypass}  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  if (Math.abs(ms) > 8.64e15) return null;
  return ${canonical};
}
`;
}

/**
 * One conditional UPSERT into `entitlements`, parameterised so a test can break
 * exactly one thing about it.
 *   tail === null  -> `DO UPDATE SET` with no trailing WHERE (unconditional)
 *   upsert false   -> a plain INSERT, no ON CONFLICT at all
 */
function upsertSql({ tail = CLAUSE, upsert = true, indent = '     ' } = {}) {
  const head = `INSERT INTO entitlements (user_id, app_id, entitlement, is_active, occurred_at)
${indent}VALUES (?,?,?,?,?)`;
  if (!upsert) return head;
  const set = `${indent}ON CONFLICT(user_id, app_id, entitlement) DO UPDATE SET
${indent}  is_active   = excluded.is_active,
${indent}  occurred_at = excluded.occurred_at`;
  return tail === null ? `${head}\n${set}` : `${head}\n${set}\n${indent}${tail}`;
}

/** services/platform/src/lib/mor/store.ts — the HMAC-gated MoR writer. */
function storeTs(o = {}) {
  const call = o.morUncalled ? 'parseLocally(n.occurredAt)' : 'normalizeInstant(n.occurredAt)';
  return `
import { normalizeInstant } from './contract';

export async function upsertEntitlement(db: D1Database, n: { userId: string; appId: string; occurredAt: string }) {
  const occurred = ${call};
  return db
    .prepare(
      \`${upsertSql({ tail: o.storeTail === undefined ? CLAUSE : o.storeTail, upsert: o.storeUpsert !== false, indent: '       ' })}\`,
    )
    .bind(n.userId, n.appId, 'money', 1, occurred);
}
`;
}

/**
 * services/subly-api/src/routes/webhooks.ts — the bearer-gated legacy writer.
 *
 * ⚠️ ITS HEADER COMMENT CARRIES THE CLAUSE VERBATIM, exactly as the real file
 * does. That is the fixture's whole point in the `only in a comment` case below:
 * a text scan of this file finds the clause with the SQL deleted.
 */
function webhooksTs(o = {}) {
  const call = o.rcUncalled ? 'Number(ev.event_timestamp_ms)' : 'isoFromEpochMs(ev.event_timestamp_ms)';
  return `
import { isoFromEpochMs } from '../lib/validate';

// ORDERING — the same defence services/platform/src/lib/mor/store.ts applies:
//   \`DO UPDATE … WHERE entitlements.occurred_at IS NULL
//                   OR excluded.occurred_at > entitlements.occurred_at\`
export async function revenuecat(db: D1Database, ev: { event_timestamp_ms: number }) {
  const occurredAt = ${call};
  return db
    .prepare(
      \`${upsertSql({ tail: o.rcTail === undefined ? CLAUSE : o.rcTail, upsert: o.rcUpsert !== false })}\`,
    )
    .bind('u', 'a', 'money', 1, occurredAt);
}
`;
}

/** Build a fixture root and run the guard against it. */
function run(o = {}) {
  const root = join(TMP, `case-${(seq += 1)}`);
  const migrations = join(root, 'services', 'platform', 'migrations');
  const mor = join(root, 'services', 'platform', 'src', 'lib', 'mor');
  const routes = join(root, 'services', 'subly-api', 'src', 'routes');
  const lib = join(root, 'services', 'subly-api', 'src', 'lib');
  mkdirSync(migrations, { recursive: true });
  mkdirSync(mor, { recursive: true });
  mkdirSync(routes, { recursive: true });
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(migrations, '0001_entitlements.sql'), o.m0001 ?? MIGRATION_0001);
  if (o.m0004 !== null) writeFileSync(join(migrations, '0004_money_rail.sql'), o.m0004 ?? migration0004(o));
  if (o.contract !== null) writeFileSync(join(mor, 'contract.ts'), o.contract ?? contractTs(o.tsReasons, o));
  if (o.store !== null) writeFileSync(join(mor, 'store.ts'), o.store ?? storeTs(o));
  if (o.webhooks !== null) writeFileSync(join(routes, 'webhooks.ts'), o.webhooks ?? webhooksTs(o));
  if (o.validate !== null) writeFileSync(join(lib, 'validate.ts'), o.validate ?? validateTs(o));
  // An extra production file under services/, for the tests that prove the
  // sweep is derived from the tree rather than from the two named writers.
  if (o.extraFile) {
    const dir = join(root, ...o.extraFile.dir.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, o.extraFile.name), o.extraFile.body);
  }
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, root };
}

describe('assert-entitlement-contract — the money rail schema is complete before the first payment', () => {
  test('PASSES on a complete contract', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ok {2}entitlement contract/);
  });

  test('FAILS when a required entitlement column is missing — and names WHY it matters', () => {
    const r = run({ columns: ALL_COLUMNS.filter((c) => c !== 'occurred_at') });
    assert.equal(r.code, 1);
    assert.match(r.out, /entitlements\.occurred_at — MISSING/);
    assert.match(r.out, /ORDERING authority/);
  });

  test('FAILS for EVERY required column, one at a time — no column is decorative', () => {
    for (const drop of ALL_COLUMNS) {
      const r = run({ columns: ALL_COLUMNS.filter((c) => c !== drop) });
      assert.equal(r.code, 1, `dropping ${drop} did not fail:\n${r.out}`);
      assert.ok(r.out.includes(`entitlements.${drop} — MISSING`), `dropping ${drop} produced:\n${r.out}`);
    }
  });

  test('a column named ONLY IN A COMMENT does not satisfy the check', () => {
    // The 0001 fixture's header comment names provider, provider_status,
    // revocation_reason and revoked_at. A grep-based guard would pass.
    const r = run({ columns: ALL_COLUMNS.filter((c) => c !== 'provider_status') });
    assert.equal(r.code, 1);
    assert.match(r.out, /entitlements\.provider_status — MISSING/);
  });

  test('FAILS when the verbatim notification store is gone', () => {
    const r = run({ notificationsTable: 'provider_notifications_renamed' });
    assert.equal(r.code, 1);
    assert.match(r.out, /table `provider_notifications` — MISSING/);
    assert.match(r.out, /recorded VERBATIM, exactly once/);
  });

  test("FAILS when the store's UNIQUE index is downgraded to a plain index — the table survives, exactly-once does not", () => {
    const r = run({ plainIndex: true });
    assert.equal(r.code, 1);
    assert.match(r.out, /no UNIQUE INDEX on \(provider, provider_event_id\)/);
  });

  test("FAILS when unclaimed_payments is gone — [5]M-7's evidence table", () => {
    const r = run({ unclaimedTable: 'unclaimed_payments_gone' });
    assert.equal(r.code, 1);
    assert.match(r.out, /table `unclaimed_payments` — MISSING/);
  });

  test('FAILS when a required revocation reason is not seeded', () => {
    const r = run({ reasons: ALL_REASONS.filter(([r2]) => r2 !== 'trial_expired'), tsReasons: ALL_REASONS.filter(([r2]) => r2 !== 'trial_expired') });
    assert.equal(r.code, 1);
    assert.match(r.out, /revocation reason 'trial_expired' is NOT seeded/);
  });

  test('FAILS when the ONLY restoring reason is dropped — nothing would ever give access back', () => {
    const без = ALL_REASONS.filter(([r2]) => r2 !== 'chargeback_reversed');
    const r = run({ reasons: без, tsReasons: без });
    assert.equal(r.code, 1);
    assert.match(r.out, /revocation reason 'chargeback_reversed' is NOT seeded/);
    assert.match(r.out, /stays locked out forever/);
  });

  test('FAILS when every seeded reason has restores_access = 0', () => {
    const flat = ALL_REASONS.map(([r2]) => [r2, 0]);
    const r = run({ reasons: flat, tsReasons: flat });
    assert.equal(r.code, 1);
    assert.match(r.out, /Nothing in this rail would ever give access back/);
  });

  test('FAILS when the seed INSERT targets a different table — the enum becomes prose', () => {
    const r = run({ seedTable: 'some_other_table' });
    assert.equal(r.code, 1);
    assert.match(r.out, /no `INSERT INTO revocation_reasons/);
  });

  test('FAILS when SQL and TypeScript disagree about which reason RESTORES access', () => {
    const r = run({ tsReasons: ALL_REASONS.map(([r2, v]) => (r2 === 'chargeback_reversed' ? [r2, 0] : [r2, v])) });
    assert.equal(r.code, 1);
    assert.match(r.out, /disagrees about RESTORING ACCESS/);
  });

  test('FAILS when TypeScript can write a reason the database has never heard of', () => {
    const r = run({ tsReasons: [...ALL_REASONS, ['vibes', 0]] });
    assert.equal(r.code, 1);
    assert.match(r.out, /'vibes' exists in .* but is NOT seeded/);
  });

  test('FAILS when the database seeds a reason no code can ever write', () => {
    const r = run({ reasons: [...ALL_REASONS, ['ghost', 0]] });
    assert.equal(r.code, 1);
    assert.match(r.out, /'ghost' is seeded in the migration but absent/);
  });

  test('does NOT read `ON CONFLICT(reason)` as a values tuple', () => {
    // The real guard bug, found by mutating the real tree before this file
    // existed: the conflict clause is a parenthesised column list at the end of
    // the statement, and a tuple scanner that counts every `(` reads it as one
    // more seeded reason called `reason`. The fixture's seed carries the same
    // clause, so a regression re-reports a phantom reason.
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /'reason' is seeded/);
  });

  test('survives a description containing a comma AND a parenthesised aside', () => {
    // The real seed's descriptions are English sentences with "(stage 13)" in
    // one of them. A paren counter that ignores string literals desynchronises
    // on exactly that.
    const r = run();
    assert.equal(r.code, 0, r.out);
  });

  test('COVERAGE LOST when the migrations directory has no .sql at all', () => {
    const r = run({ m0004: null, m0001: '' });
    // An empty 0001 still leaves a file, so blank it AND remove 0004: the
    // entitlements table then parses out of nothing.
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST/);
  });

  test('COVERAGE LOST when the entitlements table is never CREATEd, only ALTERed', () => {
    // 🔴 THIS TEST FOUND A REAL HOLE IN THE GUARD. With 0001 reduced to a
    // comment, the eleven `ALTER TABLE entitlements ADD COLUMN` statements in
    // 0004 synthesised an `entitlements` entry carrying all eleven required
    // columns — and every assertion passed over a table the migration set never
    // creates. A column list assembled purely from ALTERs describes nothing.
    const r = run({ m0001: '-- nothing here but a comment about entitlements\n' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no CREATE TABLE for `entitlements`/);
    assert.match(r.out, /ALTER … ADD COLUMN alone does not count/);
  });

  test('COVERAGE LOST when the parse yields fewer columns than 0001 alone declares', () => {
    const r = run({
      m0001: 'CREATE TABLE IF NOT EXISTS entitlements (\n  user_id TEXT,\n  app_id TEXT\n);\n',
      columns: [],
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — parsed only \d+ column\(s\)/);
  });

  test('COVERAGE LOST when the TypeScript half of the set is gone', () => {
    const r = run({ contract: 'export const NOTHING_HERE = [];\n' });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — parsed zero entries from REVOCATION_REASONS/);
  });

  test('COVERAGE LOST when contract.ts does not exist — one half of a two-place set checks nothing', () => {
    const r = run({ contract: null });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — services\/platform\/src\/lib\/mor\/contract\.ts does not exist/);
  });

  test('a REVOCATION_REASONS mentioned only in a comment does not count', () => {
    const r = run({
      contract: "// export const REVOCATION_REASONS: readonly RevocationReason[] = [\n//   { reason: 'refund_approved', restores: false },\n// ];\nexport const X = 1;\n",
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /COVERAGE LOST — parsed zero entries/);
  });
});

describe('assert-entitlement-contract limb 5 — the two writers of the shared row agree on what "older" means', () => {
  test('PASSES when both writers carry the clause and both instants are canonicalised', () => {
    const r = run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 conditional UPSERT\(s\) into entitlements/);
  });

  test('FAILS when ONE writer flips `>` to `>=` — the parity case, and it prints found vs required', () => {
    // The whole defect in one character: `>=` re-applies a redelivery of the
    // SAME event, and the two writers now disagree about what a tie means.
    const r = run({ rcTail: CLAUSE.replace('> entitlements', '>= entitlements') });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /services\/subly-api\/src\/routes\/webhooks\.ts — the UPSERT's ordering clause is not the shared one/);
    assert.match(r.out, /found: +WHERE entitlements\.occurred_at IS NULL OR excluded\.occurred_at >= entitlements\.occurred_at/);
    assert.match(r.out, /required: +WHERE entitlements\.occurred_at IS NULL OR excluded\.occurred_at > entitlements\.occurred_at/);
  });

  test('FAILS for the OTHER writer too — neither side is the privileged one', () => {
    const r = run({ storeTail: 'WHERE excluded.occurred_at > entitlements.occurred_at' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /services\/platform\/src\/lib\/mor\/store\.ts — the UPSERT's ordering clause is not the shared one/);
  });

  test('FAILS when the tail is dropped and the UPSERT becomes last-write-wins', () => {
    const r = run({ storeTail: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /is UNCONDITIONAL: `DO UPDATE SET` with no trailing WHERE/);
    assert.match(r.out, /silently overwrites a newer truth/);
  });

  test('the clause present ONLY IN A COMMENT does not satisfy the check', () => {
    // webhooksTs()'s header comment carries the clause verbatim, exactly as the
    // real file does — this fixture passes a text scan and must fail this guard.
    // The real-tree form of this is mutation O6 in the header.
    const r = run({ rcTail: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /services\/subly-api\/src\/routes\/webhooks\.ts — the UPSERT into `entitlements` is UNCONDITIONAL/);
  });

  test('COVERAGE LOST when a required writer loses its ON CONFLICT entirely', () => {
    const r = run({ rcUpsert: false });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no conditional UPSERT into `entitlements` was parsed out of services\/subly-api\/src\/routes\/webhooks\.ts/);
  });

  test('COVERAGE LOST when a required writer file is gone — a missing writer is not a compliant one', () => {
    const r = run({ store: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — services\/platform\/src\/lib\/mor\/store\.ts does not exist/);
  });

  test('a THIRD writer anywhere under services/ is swept in, not just the two named ones', () => {
    // The sweep is derived from the tree; the named list only stops it finding
    // nothing. A new Worker that upserts the shared table is in scope the day it
    // is written, with no edit here.
    const r = run({
      extraFile: {
        dir: 'services/platform/src/routes',
        name: 'money.ts',
        body: `export const q = \`${upsertSql({ tail: null })}\`;\n`,
      },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /services\/platform\/src\/routes\/money\.ts — the UPSERT into `entitlements` is UNCONDITIONAL/);
  });

  test('a plain INSERT with no ON CONFLICT is NOT flagged — the check is about upserts, not about writing', () => {
    // The negative control. Without it, "everything fails" would look like
    // "everything is checked".
    const r = run({
      extraFile: {
        dir: 'services/platform/src/routes',
        name: 'seed.ts',
        body: `export const q = \`${upsertSql({ upsert: false })}\`;\n`,
      },
    });
    assert.equal(r.code, 0, r.out);
  });

  test('a test-directory fixture is not treated as a writer of production truth', () => {
    const r = run({
      extraFile: {
        dir: 'services/subly-api/test',
        name: 'webhooks.test.ts',
        body: `const q = \`${upsertSql({ tail: null })}\`;\n`,
      },
    });
    assert.equal(r.code, 0, r.out);
  });

  test('FAILS when a canonicaliser stops ending in toISOString()', () => {
    const r = run({ rcCanonical: 'new Date(ms).toUTCString()' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /isoFromEpochMs in services\/subly-api\/src\/lib\/validate\.ts never produces `new Date\(…\)\.toISOString\(\)`/);
    assert.match(r.out, /sorts lexicographically/);
  });

  test('FAILS when a canonicaliser stores the raw epoch-ms instead', () => {
    const r = run({ rcCanonical: 'String(ms)' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /never produces `new Date\(…\)\.toISOString\(\)`/);
  });

  test('FAILS on an ADDED bypass return, with the canonical expression left untouched', () => {
    // Mutation O4. The "contains new Date(…).toISOString()" check still passes
    // here — this is the input that makes the per-return rule fail ALONE, which
    // is what stops it being an assertion that cannot fail.
    const r = run({ rcBypass: true });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /returns `ms` — an instant that did not go through `\.toISOString\(\)`/);
    assert.doesNotMatch(r.out, /never produces/);
  });

  test('FAILS on a bypass in the MoR canonicaliser too', () => {
    const r = run({ morBypass: true });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /normalizeInstant in .*contract\.ts returns `\{ ok: true, iso: v \}`/);
  });

  test('a constant refusal is NOT a bypass — `return null` and `return { ok: false }` are fine', () => {
    // Both fixtures are full of those returns and the default case passes, which
    // is what makes the rule above usable rather than merely strict.
    const r = run();
    assert.equal(r.code, 0, r.out);
  });

  test('COVERAGE LOST when a canonicaliser is renamed', () => {
    const r = run({ rcFnName: 'toIsoInstant' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — no `export function isoFromEpochMs` in services\/subly-api\/src\/lib\/validate\.ts/);
  });

  test('COVERAGE LOST when a canonicaliser file is gone', () => {
    const r = run({ validate: null });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /COVERAGE LOST — services\/subly-api\/src\/lib\/validate\.ts does not exist/);
  });

  test('FAILS when a canonicaliser is called from nowhere else — a dead seam reports healthy', () => {
    const r = run({ rcUncalled: true });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /isoFromEpochMs is declared in .* but CALLED from nowhere else under services\//);
  });

  test('FAILS when the MoR canonicaliser is called from nowhere else', () => {
    const r = run({ morUncalled: true });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /normalizeInstant is declared in .* but CALLED from nowhere else under services\//);
  });

  test('a NAME is not a call — an import and a re-export do not exercise the seam', () => {
    // storeTs keeps `import { normalizeInstant } from './contract'` even in the
    // morUncalled case, and this adds a third file that re-exports the symbol.
    // Both MENTION it; neither CALLS it. This is assert-seams-wired.mjs's scar
    // in its other direction: that guard matched a function's own declaration
    // and passed with every real caller deleted.
    const r = run({
      morUncalled: true,
      extraFile: {
        dir: 'services/platform/src/lib',
        name: 'index.ts',
        body: "export { normalizeInstant } from './mor/contract';\nexport type Instant = ReturnType<typeof normalizeInstant>;\n",
      },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /normalizeInstant is declared in .* but CALLED from nowhere else/);
  });

  test('a FORKED COPY of the canonicaliser does not count as a caller', () => {
    // The dangerous near-miss: someone copies the function into another Worker
    // instead of importing it. A naive `NAME(` match is satisfied by the copy's
    // own declaration, the seam stays dead, and the guard prints ok. The forked
    // copy here is even correct on its own terms — it ends in toISOString() —
    // which is exactly why only the CALL can settle the question.
    const r = run({
      rcUncalled: true,
      extraFile: {
        dir: 'services/subly-api/src/lib',
        name: 'time.ts',
        body: 'export function isoFromEpochMs(ms: number): string {\n  return new Date(ms).toISOString();\n}\n',
      },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /isoFromEpochMs is declared in .* but CALLED from nowhere else/);
  });
});
