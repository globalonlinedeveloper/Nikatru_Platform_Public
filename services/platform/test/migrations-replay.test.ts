import { describe, it, expect } from 'vitest';
import {
  PLATFORM_MIGRATIONS,
  REPLAY_SAFE_MIGRATIONS,
  RealDb,
  realPlatformDb,
} from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline B-8] "a migration set is safe to re-apply".
//
// 🔴 THIS TEST WAS UNWRITABLE UNTIL 2026-08-01. Not hard — unwritable. Every
// Worker test in this repo ran against a hand-written double, and "applies
// twice" is not a claim about a SQL string. It is a claim about what a SQL
// engine does when it is handed the same DDL a second time, which nothing in
// this project ever did. `check-migrations.mjs` reads the files and bans
// destructive statements; it cannot execute one.
//
// WHY IT MATTERS HERE SPECIFICALLY. `d1_migrations` records file NAMES, not
// content, and platform_db is the ONE database every app in the portfolio
// shares. A migration that is not replay-safe is not a local inconvenience: it
// is a failed `wrangler d1 migrations apply` against the database that answers
// every paywall check, mid-deploy, with the ledger and the schema disagreeing
// about what has happened.
//
// 🔴 REWRITTEN 2026-08-01 WHEN 0004_money_rail.sql LANDED — AND DELIBERATELY NOT
// WEAKENED. `ALTER TABLE … ADD COLUMN` has no `IF NOT EXISTS` form in SQLite, so
// [5]M-3's entitlement contract cannot be replay-safe and no amount of rewriting
// makes it so. The tempting move was to drop the whole-set assertion and keep a
// vacuous one. What replaced it instead is STRICTER in the dimension that
// matters: every statement in the WHOLE set is now CLASSIFIED, and the test
// asserts that `ALTER TABLE … ADD COLUMN` is the ONLY non-replay-safe form
// present ANYWHERE. A `DROP TABLE`, a bare `CREATE TABLE` without IF NOT EXISTS,
// or an `INSERT` without a conflict clause fails here — none of which the old
// whole-set replay could distinguish from each other, because it only ever said
// "something threw".
//
// The exception is then PROVEN rather than assumed: re-applying the ledger-
// protected file must throw LOUDLY (a `duplicate column name` error), because a
// once-only migration that silently succeeded twice would mean SQLite had
// accepted a second copy of a column and the schema had diverged from the file.
//
// ⚠️ SCOPE, stated so it is not mistaken for more than it is. This covers
// services/platform's set only. services/subly-api/migrations/0002_schema_debt.sql
// contains two bare `ALTER TABLE … ADD COLUMN` and does NOT replay
// (`duplicate column name: id`); baselining it and deriving the covered set from
// every `migrations_dir` in the tree is [4] increment 4's work, and editing 0002
// to "fix" it would put a file in the tree that nothing has ever compared against
// the live database.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blank comments and string literals, preserving offsets — the same treatment
 * tooling/ci/check-migrations.mjs applies, and for the same reason: this file's
 * own header says "DROP TABLE" and "CREATE TABLE" in prose, and 0004 seeds a
 * lookup table whose descriptions are English sentences containing the word
 * "cancelling". A scanner that reads prose grades the comments.
 */
function stripNonCode(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (; i < stop; i++) out += sql[i] === '\n' ? '\n' : ' ';
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      out += ' ';
      i++;
      while (i < sql.length && sql[i] !== quote) { out += sql[i] === '\n' ? '\n' : ' '; i++; }
      if (i < sql.length) { out += ' '; i++; }
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

/** Statements, split on `;`, with comments and literals already blanked. */
function statements(sql: string): string[] {
  return stripNonCode(sql)
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);
}

/**
 * Forms that can be executed a second time with no effect. Everything else is
 * either non-replay-safe or a statement class this set has never contained — and
 * both must be looked at by a human, which is what an unclassified statement
 * failing this test forces.
 */
const REPLAY_SAFE_FORMS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'CREATE TABLE IF NOT EXISTS', re: /^CREATE TABLE IF NOT EXISTS\b/i },
  { label: 'CREATE INDEX IF NOT EXISTS', re: /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\b/i },
  // A seed whose conflict clause makes the second run a no-op. `DO NOTHING`
  // specifically — `INSERT OR IGNORE` would also swallow NOT NULL / CHECK / FK
  // violations, which 0002_analytics.sql:12-19 already records as the reason it
  // is banned here.
  { label: 'INSERT … ON CONFLICT … DO NOTHING', re: /^INSERT INTO\b[\s\S]*\bON CONFLICT\b[\s\S]*\bDO NOTHING$/i },
];

/** The one form that is LEDGER-PROTECTED rather than replay-safe. */
const LEDGER_PROTECTED = /^ALTER TABLE \S+ ADD COLUMN\b/i;

describe('platform_db migrations re-apply cleanly', () => {
  it('every statement in the whole set is replay-safe, or is a ledger-protected ADD COLUMN', () => {
    const unclassified: string[] = [];
    let replaySafe = 0;
    let ledgerProtected = 0;
    for (const [i, sql] of PLATFORM_MIGRATIONS.entries()) {
      for (const stmt of statements(sql)) {
        if (REPLAY_SAFE_FORMS.some((f) => f.re.test(stmt))) { replaySafe++; continue; }
        if (LEDGER_PROTECTED.test(stmt)) { ledgerProtected++; continue; }
        unclassified.push(`migration #${i}: ${stmt.slice(0, 120)}`);
      }
    }
    expect(
      unclassified,
      'a statement that is neither a replay-safe IF NOT EXISTS / DO NOTHING form nor an ' +
        'ALTER TABLE … ADD COLUMN. Re-applying this set would do something, and D1 applies ' +
        'each FILE once — so whatever this is, a human has to decide whether it is safe.',
    ).toEqual([]);
    // COVERAGE: a parser that split nothing would classify nothing and agree with
    // everything. Both buckets must be non-empty — the set genuinely contains
    // both kinds today, and if it ever stops containing ADD COLUMN the exception
    // below is dead code that should be removed rather than left looking alive.
    expect(replaySafe).toBeGreaterThan(10);
    expect(ledgerProtected).toBeGreaterThan(0);
  });

  it('the replay-safe subset applied TWICE IN A ROW does not throw', () => {
    expect(() => new RealDb([...REPLAY_SAFE_MIGRATIONS, ...REPLAY_SAFE_MIGRATIONS])).not.toThrow();
  });

  it('the replay-safe subset applied twice changes nothing — same tables, columns, indexes', () => {
    const once = new RealDb(REPLAY_SAFE_MIGRATIONS);
    const twice = new RealDb([...REPLAY_SAFE_MIGRATIONS, ...REPLAY_SAFE_MIGRATIONS]);
    const shape = (db: RealDb) =>
      db
        .rows("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
        .map((r) => `${r.type} ${r.name} :: ${String(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
    expect(shape(twice)).toEqual(shape(once));
  });

  it('re-applying the LEDGER-PROTECTED migration fails LOUDLY rather than diverging', () => {
    // The exception is proven, not assumed. If SQLite ever accepted this twice it
    // would mean a duplicate column had been created and the schema no longer
    // matched the file — a silent divergence on the table that answers every
    // paywall check. It must throw, and the message must name the reason.
    expect(() => new RealDb([...PLATFORM_MIGRATIONS, ...PLATFORM_MIGRATIONS])).toThrow(
      /duplicate column name/i,
    );
  });

  it('the seeded revocation-reason set survives a second application of its own file', () => {
    // The seed is the one statement in the set that writes ROWS, so "replays
    // cleanly" has to mean row counts as well as schema. Applying the money-rail
    // seed twice must leave exactly one row per reason.
    const db = realPlatformDb();
    const before = db.count('revocation_reasons');
    db.db.exec(
      "INSERT INTO revocation_reasons (reason, restores_access, description) VALUES " +
        "('refund_approved', 0, 'x') ON CONFLICT(reason) DO NOTHING",
    );
    expect(db.count('revocation_reasons')).toBe(before);
    // …and the conflicting row was NOT overwritten: DO NOTHING keeps the seed.
    const row = db.rows("SELECT description FROM revocation_reasons WHERE reason = 'refund_approved'")[0];
    expect(String(row.description)).not.toBe('x');
  });

  it('COVERAGE LOST when the migration set stops being read from the tree', () => {
    // The assertions above are vacuously true against an empty array, and an
    // empty array is exactly what a broken `?raw` import produces. The floor is a
    // RELATIONSHIP, not a tuned number: one entry per .sql file the applier would
    // apply, and every entry non-empty DDL.
    expect(PLATFORM_MIGRATIONS.length).toBeGreaterThanOrEqual(4);
    for (const [i, sql] of PLATFORM_MIGRATIONS.entries()) {
      expect(sql.length, `migration #${i} is empty — the ?raw import resolved to nothing`).toBeGreaterThan(100);
    }
    // Every migration but the ALTER-only sections must still create a table, and
    // 0004 does both — so the CREATE TABLE floor is over the whole set rather than
    // per file, and the table list below is the real assertion.
    expect(PLATFORM_MIGRATIONS.filter((s) => /CREATE TABLE/i.test(s)).length).toBeGreaterThanOrEqual(4);
    // …and the set really does create the tables platform_db holds, so a migration
    // silently dropped from the list is visible here and not only in a count.
    // Enumerated from services/platform/migrations/, which is the applier's own input.
    const tables = realPlatformDb()
      .rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((r) => String(r.name));
    expect(tables).toEqual([
      'consent_artifacts',
      'cron_heartbeat',
      'entitlements',
      'events',
      'provider_accounts',
      'provider_notifications',
      'revocation_reasons',
      'unclaimed_payments',
    ]);
  });
});
