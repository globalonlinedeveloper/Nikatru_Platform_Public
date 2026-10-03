import { describe, it, expect } from 'vitest';
import { realPlatformDb } from './harness';
import { D1_DUMP_GENERATOR, dumpD1Database } from '../src/backup/dump';
import { EXPORT_GENERATORS, replayExport } from '../../../tooling/ops/sql-export-replay.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// sql-export-replay.test.ts — THE SQL PORT'S EXPORT DUTY, ON THE REAL DUMP.
//
// ⏱ 2026-10-02 · port-sql. `node tooling/ops/port-switch.mjs sql --to sqlite
// --dry-run --export <file>` (check C9) loads one nightly export into a
// node:sqlite file built from the migrations and compares the table list and
// the row counts. This file feeds it what the nightly job WRITES — the shipped
// `dumpD1Database` over platform_db's real migrations — rather than a
// hand-made export: a change to the dump's format meets this test. Then it
// reddens it: a table missing from the export, a table no migration
// creates, and a row short of its table's count each FAIL.
//
// Seeded rows are synthetic heartbeat rows; nothing here is a user's.
// ─────────────────────────────────────────────────────────────────────────────

// `import.meta.url` is Vite's at run time; this Worker's types (workers-types alone) do not declare it.
const REPO = decodeURIComponent(new URL('../../../', (import.meta as unknown as { url: string }).url).pathname);

type Line = { kind: string; table?: string; rows?: number; tables?: number; [k: string]: unknown };

async function realExport(): Promise<Line[]> {
  const db = realPlatformDb();
  db.db.exec(
    "INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES ('nightly-export', 'platform_db', 1, NULL, '2026-10-01T02:30:00Z'), ('nightly-export', 'platform_db', 0, 'x', '2026-10-02T02:30:00Z')",
  );
  const dump = await dumpD1Database(db, 'platform_db', 1000, '2026-10-02T02:30:00Z');
  expect(dump.truncated).toBe(false);
  return dump.jsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
}

const text = (lines: Line[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

describe('sql export dry run — one export, the migrations, a node:sqlite file', () => {
  it('reads the format the nightly job writes', () => {
    expect(EXPORT_GENERATORS.has(D1_DUMP_GENERATOR)).toBe(true);
  });

  it('green: the real dump of the migrated database replays, table for table and row for row', async () => {
    const r = replayExport({ root: REPO, jsonl: text(await realExport()) });
    expect(r.verdict, r.lines.join('\n')).toBe('PASS');
    expect(r.detail).toMatch(/platform_db: \d+ migration\(s\) of services\/platform\/migrations replayed; \d+ table\(s\) and \d+ row\(s\) match the export/);
    expect(r.lines.some((l) => /cron_heartbeat\s+2 row\(s\)/.test(l))).toBe(true);
  });

  it('🔴 an export MISSING a table the migrations create FAILS, naming it', async () => {
    const lines = (await realExport()).filter((l) => l.table !== 'signups');
    const end = lines[lines.length - 1];
    end.tables = (end.tables ?? 0) - 1;
    const r = replayExport({ root: REPO, jsonl: text(lines) });
    expect(r.verdict).toBe('FAIL');
    expect(r.lines).toContain('    FAIL table `signups` is created by the migrations and is missing from the export');
  });

  it('🔴 an export carrying a table NO migration creates FAILS, naming it', async () => {
    const lines = await realExport();
    lines.splice(1, 0, { kind: 'schema', table: 'ghost_rows', sql: 'CREATE TABLE ghost_rows (id TEXT)' }, { kind: 'table-end', table: 'ghost_rows', rows: 0, truncated: false });
    const r = replayExport({ root: REPO, jsonl: text(lines) });
    expect(r.verdict).toBe('FAIL');
    expect(r.detail).toMatch(/table `ghost_rows` is in the export and no migration in services\/platform\/migrations creates it/);
  });

  it('🔴 a row short of its table-end FAILS with both numbers', async () => {
    const lines = await realExport();
    const i = lines.findIndex((l) => l.kind === 'row' && l.table === 'cron_heartbeat');
    lines.splice(i, 1);
    const r = replayExport({ root: REPO, jsonl: text(lines) });
    expect(r.verdict).toBe('FAIL');
    expect(r.lines).toContain('    FAIL table `cron_heartbeat` ends at 2 row(s) and the export holds 1');
  });

  it('🔴 a cut-off export (no end line) is refused before anything replays', async () => {
    const lines = (await realExport()).slice(0, -1);
    const r = replayExport({ root: REPO, jsonl: text(lines) });
    expect(r.verdict).toBe('FAIL');
    expect(r.detail).toMatch(/no end line/);
  });
});
