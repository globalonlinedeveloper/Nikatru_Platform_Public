import { describe, it, expect } from 'vitest';
import { PLATFORM_MIGRATIONS, RealDb, realPlatformDb } from './harness';

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
// ⚠️ SCOPE, stated so it is not mistaken for more than it is. This covers
// services/platform's set only. services/subly-api/migrations/0002_schema_debt.sql
// contains two bare `ALTER TABLE … ADD COLUMN` and does NOT replay
// (`duplicate column name: id`); baselining it and deriving the covered set from
// every `migrations_dir` in the tree is [4] increment 4's work, and editing 0002
// to "fix" it would put a file in the tree that nothing has ever compared against
// the live database.
// ─────────────────────────────────────────────────────────────────────────────
describe('platform_db migrations re-apply cleanly', () => {
  it('applying the whole set TWICE IN A ROW does not throw', () => {
    expect(() => new RealDb([...PLATFORM_MIGRATIONS, ...PLATFORM_MIGRATIONS])).not.toThrow();
  });

  it('the second application changes nothing — same tables, same columns, same indexes', () => {
    const once = realPlatformDb();
    const twice = new RealDb([...PLATFORM_MIGRATIONS, ...PLATFORM_MIGRATIONS]);
    const shape = (db: RealDb) =>
      db
        .rows("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
        .map((r) => `${r.type} ${r.name} :: ${String(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
    expect(shape(twice)).toEqual(shape(once));
  });

  it('COVERAGE LOST when the migration set stops being read from the tree', () => {
    // The two assertions above are vacuously true against an empty array, and an
    // empty array is exactly what a broken `?raw` import produces. The floor is a
    // RELATIONSHIP, not a tuned number: one entry per .sql file the applier would
    // apply, and every entry non-empty DDL.
    expect(PLATFORM_MIGRATIONS.length).toBeGreaterThanOrEqual(3);
    for (const [i, sql] of PLATFORM_MIGRATIONS.entries()) {
      expect(sql.length, `migration #${i} is empty — the ?raw import resolved to nothing`).toBeGreaterThan(100);
      expect(sql, `migration #${i}`).toMatch(/CREATE TABLE/i);
    }
    // …and the set really does create the four tables platform_db holds, so a
    // migration silently dropped from the list is visible here and not only in a
    // count. Enumerated from services/platform/migrations/, which is the applier's
    // own input.
    const tables = realPlatformDb()
      .rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((r) => String(r.name));
    expect(tables).toEqual(['consent_artifacts', 'cron_heartbeat', 'entitlements', 'events']);
  });
});
