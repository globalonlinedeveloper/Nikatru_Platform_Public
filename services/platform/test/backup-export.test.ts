// ─────────────────────────────────────────────────────────────────────────────
// THE NIGHTLY EXPORT, GRADED ON WHAT LANDS — not on which methods were called.
//
// 🔴 THE CLAIM THIS SUITE HAS TO BE ABLE TO FALSIFY: "D1 and KV are backed up."
// A suite that asserted `bucket.put` was called would pass against a dump that
// wrote a header and no rows, and that is precisely the backup this repo already
// had a name for — `recovery.worker-d1-export`, status NEVER. So every test here
// runs the export against the REAL sqlite engine with the REAL migrations, then
// DECOMPRESSES what was handed to R2 and reads the rows back out of it.
//
// The round-trip test is the drill in miniature: rows in -> gzip -> JSONL ->
// rows out, with the count compared. The live drill against a scratch D1 is
// recorded in runbooks/backup-restore.md; this is the half that runs on every PR.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest';
import CEILINGS_RAW from '../../../tooling/ceilings.json?raw';
import { RealDb, realPlatformDb } from './harness';
import appInit0001 from '../../subscriptiontracker-api/migrations/0001_init.sql?raw';
import appSchemaDebt0002 from '../../subscriptiontracker-api/migrations/0002_schema_debt.sql?raw';
import { runBackup, isExpired, backupDate, BACKUP_RETENTION_DAYS, MAX_D1_QUERIES_PER_RUN } from '../src/backup';
import { dumpD1Database, EPHEMERAL_TABLES, D1_PAGE_ROWS, TABLES_PER_READ, SQL_FUNCTION_ARGS } from '../src/backup/dump';
import { scheduled, BACKUP_CRON, BACKUP_RERUN_KEY, OPS_HOURLY_CRON } from '../src/scheduled';
import type { BackupEnv } from '../src/backup';
import type { Env } from '../src/types';

const NOW = Date.parse('2026-09-06T02:30:00Z');

/** An R2 double that keeps the bytes, so assertions can read them back. */
class FakeBucket {
  readonly objects = new Map<string, { body: Uint8Array; custom: Record<string, string> }>();
  readonly deleted: string[] = [];

  async put(
    key: string,
    body: ArrayBuffer | string,
    opts?: { customMetadata?: Record<string, string> },
  ): Promise<void> {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
    this.objects.set(key, { body: bytes, custom: opts?.customMetadata ?? {} });
  }

  async list(): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }> {
    return { objects: [...this.objects.keys()].map((key) => ({ key })), truncated: false };
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

/** A KV double. `list` pages, because the exporter's loop depends on it. */
class FakeKv {
  constructor(private readonly data: Record<string, string>) {}
  async list(): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
    return { keys: Object.keys(this.data).map((name) => ({ name })), list_complete: true };
  }
  async get(name: string): Promise<string | null> {
    return this.data[name] ?? null;
  }
  async delete(name: string): Promise<void> {
    delete this.data[name];
  }
}

// 🔴 SUBSCRIPTIONTRACKER_DB IS ITS OWN DATABASE, BUILT FROM ITS OWN MIGRATIONS.
// It used to be `db` — a SECOND COPY OF platform_db — so every platform table was
// counted twice against MAX_D1_QUERIES_PER_RUN. ⏱ 2026-09-25 (O-EXTENSION-ACCOUNT-CHECK-UNBUILT):
// 0017 took platform_db to 22 tables, the fixture spent 2 + 2 × 22 = 46 of 45
// queries and the second dump truncated — while the real estate costs 2 + 23 + 5
// (d1_migrations included). A fixture that doubles the platform cannot tell the
// budget running out from its own shape; this one spends what production spends.
function appDb(): RealDb {
  return new RealDb([appInit0001, appSchemaDebt0002]);
}

function envWith(bucket: FakeBucket | undefined, db = realPlatformDb(), trackerDb: RealDb = appDb()) {
  return {
    env: {
      PLATFORM_DB: db as unknown as D1Database,
      SUBSCRIPTIONTRACKER_DB: trackerDb as unknown as D1Database,
      CONFIG_KV: new FakeKv({ 'config:subscriptiontracker': '{"flags":{}}' }) as unknown as KVNamespace,
      JWKS_CACHE: new FakeKv({ jwks: '{"keys":[]}' }) as unknown as KVNamespace,
      SIGNUPS: new FakeKv({}) as unknown as KVNamespace,
      BACKUPS_R2: bucket as unknown as R2Bucket | undefined,
    } as BackupEnv,
    db,
  };
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Response(bytes as unknown as BodyInit).body;
  return await new Response(stream!.pipeThrough(new DecompressionStream('gzip'))).text();
}

function linesOf(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** `n` one-column tables, one row each. They cost NO query of their own: up to
 *  TABLES_PER_READ tables share one read statement. */
function padTables(n: number): string[] {
  return Array.from(
    { length: n },
    (_, i) => `CREATE TABLE pad_${i} (id INTEGER PRIMARY KEY); INSERT INTO pad_${i} (id) VALUES (${i})`,
  );
}

/**
 * One table holding `n` rows. ⏱ 2026-10-01 · ROW VOLUME IS NOW THE ONLY THING THAT
 * SPENDS THE POOL, so it is what these fixtures turn: a database costs its
 * catalogue, its column read, its size read and one read per round, and a round
 * ends when no table returned a full page — floor(n / D1_PAGE_ROWS) + 1 rounds
 * for a table whose rows are a few bytes wide.
 */
function padRows(n: number): string[] {
  return [
    'CREATE TABLE pad_rows (id INTEGER PRIMARY KEY)',
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${n}) INSERT INTO pad_rows (id) SELECT x FROM c`,
  ];
}

/** What one database of at most TABLES_PER_READ tables, the largest holding `n` rows, spends. */
const spendFor = (n: number): number => 3 + Math.floor(n / D1_PAGE_ROWS) + 1;

/** D1's "Maximum string, BLOB or table row size", which node:sqlite does not impose. */
const D1_MAX_VALUE_BYTES = 2_000_000;

/**
 * The real engine behind D1's value cap: a read that answers a string past
 * D1_MAX_VALUE_BYTES throws, as D1 does (SQLITE_TOOBIG), instead of handing the
 * export a value production would never have returned.
 */
function withD1ValueCap(real: RealDb): D1Database {
  const check = <T>(rows: T[]): T[] => {
    for (const row of rows) {
      for (const value of Object.values(row as Record<string, unknown>)) {
        if (typeof value === 'string' && value.length > D1_MAX_VALUE_BYTES) {
          throw new Error(`string or blob too big: SQLITE_TOOBIG (${value.length} bytes)`);
        }
      }
    }
    return rows;
  };
  return {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      return {
        all: async () => ({ results: check((await statement.all()).results) }),
        first: async () => check([await statement.first()])[0],
      };
    },
  } as unknown as D1Database;
}

/** The most arguments any one function call in `sql` takes. Quoted runs are skipped. */
function widestCall(sql: string): number {
  let widest = 0;
  for (const m of sql.matchAll(/\b[A-Za-z_]+\s*\(/g)) {
    let depth = 0;
    let commas = 0;
    let empty = true;
    for (let i = m.index + m[0].length - 1; i < sql.length; i++) {
      const c = sql[i];
      if (c === "'" || c === '"') {
        i = sql.indexOf(c, i + 1);
        empty = false;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
      else if (depth === 1 && c === ',') commas++;
      else if (depth >= 1 && !/\s/.test(c)) empty = false;
    }
    widest = Math.max(widest, empty ? 0 : commas + 1);
  }
  return widest;
}

/**
 * A D1 whose catalogue names one table more than the database holds — a table
 * dropped between the two reads, or a catalogue that lies. Every other
 * statement goes to the real engine.
 */
function withGhostTable(real: RealDb, ghost: string): D1Database {
  return {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      if (!sql.includes('sqlite_master')) return statement;
      return {
        all: async () => {
          const listed = await statement.all();
          const entry = { type: 'table', name: ghost, tbl_name: ghost, sql: `CREATE TABLE ${ghost} (id INTEGER)` };
          return { results: [...listed.results, entry] };
        },
      };
    },
  } as unknown as D1Database;
}

function latestManifest(bucket: FakeBucket): { complete: boolean; objects: { key: string; queries?: number }[] } {
  return JSON.parse(new TextDecoder().decode(bucket.objects.get('manifests/latest.json')!.body)) as {
    complete: boolean;
    objects: { key: string; queries?: number }[];
  };
}

describe('the nightly export writes something a restore can actually use', () => {
  it('🔴 ROUND-TRIPS: rows written to D1 come back out of the gzipped object, and the counts match', async () => {
    const { env, db } = envWith(new FakeBucket());
    db.db.exec(
      "INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES " +
        "('supabase_keepalive','a',1,'x','2026-09-05T06:00:00Z')," +
        "('supabase_keepalive','b',1,'y','2026-09-05T06:00:00Z')," +
        "('renewals','subscriptiontracker',0,'z','2026-09-05T06:00:00Z')",
    );
    const before = db.count('cron_heartbeat');
    expect(before).toBe(3);

    const out = await runBackup(env, NOW);
    const bucket = env.BACKUPS_R2 as unknown as FakeBucket;
    const key = `d1/platform_db/${backupDate(NOW)}.jsonl.gz`;
    expect([...bucket.objects.keys()]).toContain(key);

    const lines = linesOf(await gunzip(bucket.objects.get(key)!.body));
    const heartbeatRows = lines.filter((l) => l.kind === 'row' && l.table === 'cron_heartbeat');
    // THE ASSERTION THAT MATTERS: the dump holds every row the database holds.
    expect(heartbeatRows).toHaveLength(before);
    expect((heartbeatRows[0].data as Record<string, unknown>).job).toBe('supabase_keepalive');

    // The schema travels too — a dump of rows with no DDL is not restorable.
    // Asserted against the database's OWN catalogue rather than a hand-written
    // list, so a migration that adds a table cannot quietly fall out of the
    // backup while this test stays green.
    const ddl = (lines.filter((l) => l.kind === 'schema').map((l) => l.table) as string[]).sort();
    const actual = db
      .rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .map((r) => r.name as string);
    expect(ddl).toEqual(actual);
    expect(ddl).toContain('cron_heartbeat');

    expect(out.find((o) => o.target === 'd1:platform_db')?.ok).toBe(true);
  });

  // ⏱ 2026-09-30 · ADR no.NNN — EPHEMERAL_TABLES (src/backup/dump.ts).
  it('ephemeral tables travel as SCHEMA only: their rows are not dumped and cost no query; every other table\'s rows still are', async () => {
    const { env, db } = envWith(new FakeBucket());
    db.db.exec(
      "INSERT INTO native_attest_redeemed (nonce, app_id, expires_at) VALUES ('n1','subscriptiontracker','2026-09-05T06:02:00Z');" +
        "INSERT INTO native_attest_counters (day, scope, calls) VALUES ('2026-09-05','play-integrity:decode',3);" +
        "INSERT INTO native_attest_keys (app_id, key_id, kind, public_key, sign_count, created_at, last_used_at) VALUES ('subscriptiontracker','k','app-attest','pk',0,'2026-09-05T06:00:00Z','2026-09-05T06:00:00Z')",
    );
    await runBackup(env, NOW);
    const bucket = env.BACKUPS_R2 as unknown as FakeBucket;
    const lines = linesOf(await gunzip(bucket.objects.get(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)!.body));
    const schema = lines.filter((l) => l.kind === 'schema').map((l) => l.table);
    for (const t of EPHEMERAL_TABLES) {
      expect(schema, t).toContain(t);
      expect(lines.filter((l) => l.kind === 'row' && l.table === t), t).toHaveLength(0);
      expect(lines.find((l) => l.kind === 'table-end' && l.table === t)).toMatchObject({ rows: 0, ephemeral: true });
      expect(db.sql.some((q) => q.includes(`FROM "${t}"`)), `${t} is never paged`).toBe(false);
    }
    // Red control: the key table is NOT ephemeral — its row is in the dump.
    expect(lines.filter((l) => l.kind === 'row' && l.table === 'native_attest_keys')).toHaveLength(1);
    expect([...EPHEMERAL_TABLES].sort()).toEqual(['native_attest_counters', 'native_attest_redeemed']);
  });

  it('the digest recorded in the manifest is the digest of the bytes that landed', async () => {
    const { env } = envWith(new FakeBucket());
    await runBackup(env, NOW);
    const bucket = env.BACKUPS_R2 as unknown as FakeBucket;
    const manifest = JSON.parse(new TextDecoder().decode(bucket.objects.get('manifests/latest.json')!.body)) as {
      date: string;
      complete: boolean;
      objects: { key: string; sha256: string; bytes: number }[];
    };
    expect(manifest.date).toBe(backupDate(NOW));
    expect(manifest.complete).toBe(true);
    for (const entry of manifest.objects) {
      const stored = bucket.objects.get(entry.key);
      expect(stored, `${entry.key} is in the manifest but not in the bucket`).toBeDefined();
      expect(stored!.body.byteLength).toBe(entry.bytes);
      const digest = await crypto.subtle.digest('SHA-256', stored!.body as unknown as ArrayBuffer);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(hex, `${entry.key} digest`).toBe(entry.sha256);
    }
    // Box B pulls by manifest, so a manifest that lists nothing is a green run
    // that backed up nothing. Six objects: two D1, three KV, and no more.
    expect(manifest.objects.map((o) => o.key).sort()).toEqual([
      `d1/platform_db/${backupDate(NOW)}.jsonl.gz`,
      `d1/subscriptiontracker_db/${backupDate(NOW)}.jsonl.gz`,
      `kv/nikatru-signups/${backupDate(NOW)}.json.gz`,
      `kv/platform-config/${backupDate(NOW)}.json.gz`,
      `kv/platform-jwks/${backupDate(NOW)}.json.gz`,
    ]);
  });

  it('KV values are exported, not just KV key names', async () => {
    const { env } = envWith(new FakeBucket());
    await runBackup(env, NOW);
    const bucket = env.BACKUPS_R2 as unknown as FakeBucket;
    const doc = JSON.parse(
      await gunzip(bucket.objects.get(`kv/platform-config/${backupDate(NOW)}.json.gz`)!.body),
    ) as { entries: { key: string; value: string }[] };
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0].key).toBe('config:subscriptiontracker');
    expect(doc.entries[0].value).toBe('{"flags":{}}');
  });
});

describe('a backup that did not fully happen must never look like one that did', () => {
  it('🔴 a TRUNCATED dump is RED, and says so in the row', async () => {
    const db = realPlatformDb();
    // A budget of 2 buys the catalogue query and exactly one table page, so the
    // remaining tables cannot be read.
    const dump = await dumpD1Database(db as unknown as D1Database, 'platform_db', 2, '2026-09-06T02:30:00Z');
    expect(dump.truncated).toBe(true);
    const end = linesOf(dump.jsonl).find((l) => l.kind === 'end');
    expect(end!.truncated).toBe(true);
  });

  it('🔴 a database given 0 budget spends 0 queries and is truncated', async () => {
    // The catalogue query used to run before the budget was ever read, so a
    // database handed nothing still spent one query. Counted on the DATABASE,
    // not taken from the dump's own report of itself.
    const db = realPlatformDb();
    const dump = await dumpD1Database(db as unknown as D1Database, 'platform_db', 0, '2026-09-06T02:30:00Z');
    expect(db.sql).toEqual([]);
    expect(dump.queries).toBe(0);
    expect(dump.truncated).toBe(true);
    const end = linesOf(dump.jsonl).find((l) => l.kind === 'end');
    expect(end!.truncated).toBe(true);
  });

  it('🔴 a MISSING bucket binding is RED — it does not skip quietly', async () => {
    const { env } = envWith(undefined);
    const out = await runBackup(env, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].ok).toBe(false);
    expect(out[0].detail).toContain('BACKUPS_R2 binding absent');
  });

  it('a KV namespace with no binding is RED for that namespace and green for the rest', async () => {
    const { env } = envWith(new FakeBucket());
    (env as { SIGNUPS?: KVNamespace }).SIGNUPS = undefined;
    const out = await runBackup(env, NOW);
    expect(out.find((o) => o.target === 'kv:nikatru-signups')?.ok).toBe(false);
    expect(out.find((o) => o.target === 'kv:platform-config')?.ok).toBe(true);
    const bucket = env.BACKUPS_R2 as unknown as FakeBucket;
    const manifest = JSON.parse(new TextDecoder().decode(bucket.objects.get('manifests/latest.json')!.body)) as {
      complete: boolean;
    };
    // And the manifest Box B reads says the night was incomplete.
    expect(manifest.complete).toBe(false);
  });
});

describe('the D1 query budget is ONE pool, spent honestly and measured every night', () => {
  it('🔴 the WHOLE 02:30 invocation, export pool AND heartbeat batch, fits d1.queriesPerInvocation, counted on the databases', async () => {
    const ceilings = JSON.parse(CEILINGS_RAW) as { ceilings: { id: string; value: number | null }[] };
    const ceiling = ceilings.ceilings.find((c) => c.id === 'd1.queriesPerInvocation')?.value;
    expect(typeof ceiling).toBe('number');

    // More rows than the pool has rounds, so the pool is spent to its last
    // query: the worst night this firing can have, through the REAL handler.
    const platform = realPlatformDb(padRows(MAX_D1_QUERIES_PER_RUN * D1_PAGE_ROWS));
    const tracker = realPlatformDb();
    const { env } = envWith(new FakeBucket(), platform, tracker);
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
    await scheduled({ cron: BACKUP_CRON } as never, env as unknown as Env, ctx as never);
    await Promise.all(pending);

    const rows = platform.rows("SELECT target, ok, detail FROM cron_heartbeat WHERE job = 'backup_export'");
    // Preconditions: the pool really ran out, and the next database was left nothing.
    expect(rows.find((r) => r.target === 'd1:platform_db')?.ok).toBe(0);
    expect(rows.find((r) => r.target === 'd1:subscriptiontracker_db')?.ok).toBe(0);
    expect(tracker.sql).toEqual([]);
    // The export spent exactly the pool, and the heartbeat one statement per row.
    expect(platform.sql).toHaveLength(MAX_D1_QUERIES_PER_RUN + rows.length);
    expect(platform.sql.length + tracker.sql.length).toBeLessThanOrEqual(ceiling as number);
  }, 30_000);

  it('spend under the warn line: d1-budget ok=true, and it names the measured spend of the pool', async () => {
    const platform = realPlatformDb();
    const tracker = new RealDb(padRows(4 * D1_PAGE_ROWS));
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform, tracker);
    const out = await runBackup(env, NOW);
    const spent = platform.sql.length + tracker.sql.length;
    expect(spent * 100).toBeLessThanOrEqual(MAX_D1_QUERIES_PER_RUN * 80);

    const budget = out.find((o) => o.target === 'd1-budget');
    expect(budget?.ok).toBe(true);
    expect(budget?.detail).toContain(`${spent} of ${MAX_D1_QUERIES_PER_RUN} D1 queries`);
    expect(budget?.detail).toContain(`platform_db ${platform.sql.length}`);
    expect(budget?.detail).toContain(`subscriptiontracker_db ${tracker.sql.length}`);
    // And the manifest records each database's share, as counted on it.
    const objects = latestManifest(bucket).objects;
    expect(objects.find((o) => o.key.startsWith('d1/platform_db/'))?.queries).toBe(platform.sql.length);
    expect(objects.find((o) => o.key.startsWith('d1/subscriptiontracker_db/'))?.queries).toBe(tracker.sql.length);
  });

  it('🔴 spend over warnAt but complete: d1-budget ok=false AND complete=true', async () => {
    // Sized from the pool: ~86% of it, past the 80% line this case pins and
    // short of truncation, so every object is whole and only the budget is red.
    const perDb = Math.floor((MAX_D1_QUERIES_PER_RUN * 0.9) / 2) - 1;
    const rows = (perDb - spendFor(0)) * D1_PAGE_ROWS;
    expect(spendFor(rows)).toBe(perDb);
    const platform = new RealDb(padRows(rows));
    const tracker = new RealDb(padRows(rows));
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform, tracker);
    const out = await runBackup(env, NOW);
    const spent = platform.sql.length + tracker.sql.length;
    expect(spent * 100).toBeGreaterThan(MAX_D1_QUERIES_PER_RUN * 80);
    expect(spent).toBeLessThanOrEqual(MAX_D1_QUERIES_PER_RUN);
    expect(out.filter((o) => o.target.startsWith('d1:')).map((o) => o.ok)).toEqual([true, true]);

    const budget = out.find((o) => o.target === 'd1-budget');
    expect(budget?.ok).toBe(false);
    expect(budget?.detail).toContain('OVER THE WARN LINE');
    // Box B refuses a manifest that is not complete; a warm pool must not cost the night's copy.
    expect(latestManifest(bucket).complete).toBe(true);
  }, 30_000);
});

// ⏱ 2026-10-01 · ops-watch run 36810231743: `d1-budget` RED at 37 of 42, one query
// a table. The cost is now FLAT in the table count; these are the cases that hold it there.
describe('the export costs the same whatever the table count', () => {
  const tableCount = (db: RealDb): number =>
    db.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
      .length;

  it('🔴 a SIXTY-table schema spends under HALF the pool, and every pad table still lands', async () => {
    const platform = realPlatformDb(padTables(60));
    const tracker = appDb();
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform, tracker);
    const out = await runBackup(env, NOW);

    const spent = platform.sql.length + tracker.sql.length;
    expect(spent * 100).toBeLessThan(MAX_D1_QUERIES_PER_RUN * 50);
    // Exactly: catalogue, columns, then a size read and one round of reads, each one
    // statement per TABLES_PER_READ tables (nothing here is past a page).
    expect(platform.sql).toHaveLength(2 + 2 * Math.ceil(tableCount(platform) / TABLES_PER_READ));
    expect(out.find((o) => o.target === 'd1-budget')?.ok).toBe(true);
    expect(out.find((o) => o.target === 'd1:platform_db')?.ok).toBe(true);
    // D1 refuses a statement past 100,000 bytes; node:sqlite does not, so it is asserted here.
    for (const sql of [...platform.sql, ...tracker.sql]) expect(sql.length).toBeLessThan(100_000);

    const lines = linesOf(await gunzip(bucket.objects.get(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)!.body));
    for (const i of [0, 59]) {
      expect(lines.filter((l) => l.kind === 'row' && l.table === `pad_${i}`).map((l) => l.data)).toEqual([{ id: i }]);
    }
  });

  it('🔴 a table added inside a read adds ZERO queries', async () => {
    const before = realPlatformDb();
    await runBackup(envWith(new FakeBucket(), before, appDb()).env, NOW);
    const grown = realPlatformDb(padTables(10));
    // Precondition: the ten still fit the read the schema already makes.
    expect(Math.ceil(tableCount(grown) / TABLES_PER_READ)).toBe(Math.ceil(tableCount(before) / TABLES_PER_READ));
    await runBackup(envWith(new FakeBucket(), grown, appDb()).env, NOW);
    // Counted on the export's statements only: the heartbeat is not written by runBackup.
    expect(grown.sql).toHaveLength(before.sql.length);
  });

  it('🔴 a table the catalogue names and the database does not hold fails LOUDLY: red row, no object, incomplete manifest', async () => {
    const bucket = new FakeBucket();
    const { env } = envWith(bucket);
    env.PLATFORM_DB = withGhostTable(realPlatformDb(), 'ghost_table');
    const out = await runBackup(env, NOW);
    const row = out.find((o) => o.target === 'd1:platform_db');
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('ghost_table');
    expect(bucket.objects.has(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)).toBe(false);
    // The other database is untouched by it, and the night is not "complete".
    expect(out.find((o) => o.target === 'd1:subscriptiontracker_db')?.ok).toBe(true);
    expect(latestManifest(bucket).complete).toBe(false);
  });

  it('🔴 rows as wide as production\'s widest page by BYTES: every row lands and no value passes D1\'s 2 MB cap', async () => {
    // Rows run to 4,749 bytes in production (provider_notifications, 2026-10-01), and
    // a page sized in ROWS cannot know that. 45 rows of 50 KB is 2.25 MB: a page of
    // D1_PAGE_ROWS rows would be one value past the cap — refused.
    const count = 45;
    const platform = realPlatformDb([
      'CREATE TABLE wide_rows (id INTEGER PRIMARY KEY, body TEXT NOT NULL)',
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${count}) INSERT INTO wide_rows SELECT x, printf('%.50000c', 'x') FROM c`,
    ]);
    expect(count * 50_000).toBeGreaterThan(D1_MAX_VALUE_BYTES);
    expect(count).toBeLessThan(D1_PAGE_ROWS);
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform);
    env.PLATFORM_DB = withD1ValueCap(platform);
    const out = await runBackup(env, NOW);

    expect(out.find((o) => o.target === 'd1:platform_db')).toMatchObject({ ok: true });
    const lines = linesOf(await gunzip(bucket.objects.get(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)!.body));
    const ids = lines.filter((l) => l.kind === 'row' && l.table === 'wide_rows').map((l) => (l.data as { id: number }).id);
    expect(ids).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(lines.find((l) => l.kind === 'table-end' && l.table === 'wide_rows')).toMatchObject({ rows: count, truncated: false });
  }, 30_000);

  it('🔴 a 100-column table round-trips value for value — past the 32-argument groups D1 imposes', async () => {
    const width = 100;
    const names = Array.from({ length: width }, (_, i) => `c${i}`);
    const platform = realPlatformDb([
      `CREATE TABLE wide (${names.map((n) => `${n} ANY`).join(', ')}) STRICT`,
    ]);
    const values: (string | number | null)[] = names.map((_, i) => i);
    values[0] = null;
    values[31] = 'it\'s "quoted", ünïcode, and {"looks":"like json"}';
    values[32] = 1.5;
    values[63] = 9_007_199_254_740_991;
    values[64] = '';
    values[99] = -0.25;
    const stmt = platform.db.prepare(`INSERT INTO wide VALUES (${names.map(() => '?').join(', ')})`);
    stmt.run(...values);
    stmt.run(...values.map((v) => (typeof v === 'number' ? v + 1 : v)));
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform);
    await runBackup(env, NOW);

    const lines = linesOf(await gunzip(bucket.objects.get(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)!.body));
    const dumped = lines.filter((l) => l.kind === 'row' && l.table === 'wide').map((l) => l.data);
    expect(dumped).toEqual(JSON.parse(JSON.stringify(platform.rows('SELECT * FROM wide'))));
    expect(Object.keys(dumped[0] as object)).toEqual(names);
    // node:sqlite takes far more than D1's 32 arguments a function, so the engine
    // above cannot see a call D1 would refuse — the statements are read for it.
    // 32 is the vendor's number, written here rather than read from the constant it checks.
    expect(SQL_FUNCTION_ARGS).toBeLessThanOrEqual(32);
    expect(Math.max(...platform.sql.map(widestCall))).toBeLessThanOrEqual(32);
    expect(Math.max(...platform.sql.map(widestCall))).toBeGreaterThan(1);
  });
});

describe('retention deletes old exports and nothing else', () => {
  it('deletes past the window, keeps inside it, and NEVER deletes an undated key', () => {
    const day = 86_400_000;
    expect(isExpired('d1/platform_db/2026-08-01.jsonl.gz', NOW, BACKUP_RETENTION_DAYS)).toBe(true);
    expect(isExpired(`d1/platform_db/${backupDate(NOW - 29 * day)}.jsonl.gz`, NOW, BACKUP_RETENTION_DAYS)).toBe(false);
    expect(isExpired('manifests/latest.json', NOW, BACKUP_RETENTION_DAYS)).toBe(false);
    // 🔴 THE CASE THAT MATTERS MOST. An unrecognised key is not "old", it is
    // UNDATABLE, and a sweep that treats those alike deletes whatever anyone else
    // ever puts in this bucket. Never delete what you cannot date.
    expect(isExpired('something-nobody-here-wrote', 0, 0)).toBe(false);
  });

  it('the sweep removes the expired object and leaves latest.json alone', async () => {
    const bucket = new FakeBucket();
    await bucket.put('d1/platform_db/2026-07-01.jsonl.gz', 'stale');
    await bucket.put('manifests/latest.json', '{}');
    const { env } = envWith(bucket);
    const out = await runBackup(env, NOW);
    expect(bucket.deleted).toContain('d1/platform_db/2026-07-01.jsonl.gz');
    expect(bucket.deleted).not.toContain('manifests/latest.json');
    expect(out.find((o) => o.target === 'retention')?.ok).toBe(true);
  });
});

// ⏱ 2026-10-01 · the lead's one-shot re-run (scheduled.ts BACKUP_RERUN_KEY) is
// EXPORT ONLY. It lands after the 06:00 sweep, so it must not replace the night's
// pre-sweep objects, must not move Box B's latest.json, and must not sweep.
describe('a one-shot re-run exports, and deletes or replaces nothing', () => {
  const LATER = Date.parse('2026-09-06T13:15:00Z');

  it('🔴 writes only under reruns/<stamp>/: the night\'s objects and latest.json stay byte-identical, and nothing is deleted', async () => {
    const bucket = new FakeBucket();
    const { env } = envWith(bucket);
    await runBackup(env, NOW);
    await bucket.put('d1/platform_db/2026-07-01.jsonl.gz', 'stale, and past the window');
    const night = new Map([...bucket.objects].map(([k, v]) => [k, Buffer.from(v.body).toString('base64')]));

    const out = await runBackup(env, LATER, { rerun: true });

    expect(bucket.deleted).toEqual([]);
    for (const [k, b64] of night) {
      expect(Buffer.from(bucket.objects.get(k)!.body).toString('base64'), k).toBe(b64);
    }
    const added = [...bucket.objects.keys()].filter((k) => !night.has(k));
    expect(added.length).toBeGreaterThan(0);
    for (const k of added) expect(k.startsWith('reruns/2026-09-06T131500Z/'), k).toBe(true);
    expect(added).toContain('reruns/2026-09-06T131500Z/manifest.json');
    // No retention row: the night's verdict on the sweep stays the newest one.
    expect(out.map((o) => o.target)).not.toContain('retention');
    expect(out.every((o) => o.ok)).toBe(true);
    // And its objects are dated, so the nightly sweep ages them out like the rest.
    for (const k of added) expect(isExpired(k, LATER + 31 * 86_400_000, BACKUP_RETENTION_DAYS), k).toBe(true);
  });

  it('the nightly sweep is age-based: a second run the same UTC day deletes nothing', async () => {
    const bucket = new FakeBucket();
    for (const d of ['2026-08-06', '2026-08-07', '2026-08-08']) await bucket.put(`d1/platform_db/${d}.jsonl.gz`, 'x');
    const { env } = envWith(bucket);
    // On day T everything dated T-30 or earlier is expired from 00:00 to 23:59, and T-29 is not.
    const doomed = ['d1/platform_db/2026-08-06.jsonl.gz', 'd1/platform_db/2026-08-07.jsonl.gz'];
    await runBackup(env, NOW);
    expect(bucket.deleted).toEqual(doomed);
    await runBackup(env, Date.parse('2026-09-06T23:59:59Z'));
    expect(bucket.deleted).toEqual(doomed);
    expect(bucket.objects.has('d1/platform_db/2026-08-08.jsonl.gz')).toBe(true);
  });

  it('🔴 the WHOLE hourly invocation with a re-run flag, stuck-run row + export pool + heartbeat batch, fits d1.queriesPerInvocation', async () => {
    const ceilings = JSON.parse(CEILINGS_RAW) as { ceilings: { id: string; value: number | null }[] };
    const ceiling = ceilings.ceilings.find((c) => c.id === 'd1.queriesPerInvocation')?.value;
    expect(typeof ceiling).toBe('number');

    const platform = realPlatformDb(padRows(MAX_D1_QUERIES_PER_RUN * D1_PAGE_ROWS));
    const tracker = realPlatformDb();
    const { env } = envWith(new FakeBucket(), platform, tracker);
    (env as unknown as { CONFIG_KV: KVNamespace }).CONFIG_KV = new FakeKv({
      [BACKUP_RERUN_KEY]: JSON.stringify({ requestedAt: '2026-10-01T12:20:00Z', by: 'lead', reason: 'test', expiresAt: '2999-01-01T00:00:00Z' }),
    }) as unknown as KVNamespace;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await scheduled({ cron: OPS_HOURLY_CRON } as never, env as unknown as Env, ctx as never);
      await Promise.all(pending);
    } finally {
      log.mockRestore();
    }

    const rows = platform.rows('SELECT job, target FROM cron_heartbeat');
    // Preconditions: both jobs wrote, and the pool really ran out.
    expect(rows.filter((r) => r.job === 'ops_stuck_runs')).toHaveLength(1);
    expect(rows.filter((r) => r.job === 'backup_export')).toHaveLength(7);
    expect(tracker.sql).toEqual([]);
    expect(platform.sql).toHaveLength(MAX_D1_QUERIES_PER_RUN + rows.length);
    expect(platform.sql.length + tracker.sql.length).toBeLessThanOrEqual(ceiling as number);
  }, 30_000);
});
