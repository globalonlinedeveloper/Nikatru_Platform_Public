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
import {
  dumpD1Database,
  d1RestoreStatements,
  decodeD1DumpValue,
  EPHEMERAL_TABLES,
  D1_DUMP_GENERATOR,
  D1_PAGE_BYTES,
  D1_PAGE_ROWS,
  PAGE_RETRY_SHRINK,
  TABLES_PER_READ,
  SQL_FUNCTION_ARGS,
} from '../src/backup/dump';
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
 * catalogue, its column read and one read per round, and a round ends when no
 * table returned a full page — floor(n / D1_PAGE_ROWS) + 1 rounds for a table
 * whose rows are a few bytes wide (a page of them is far under D1_PAGE_BYTES).
 */
function padRows(n: number): string[] {
  return [
    'CREATE TABLE pad_rows (id INTEGER PRIMARY KEY)',
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${n}) INSERT INTO pad_rows (id) SELECT x FROM c`,
  ];
}

/** What one database of at most TABLES_PER_READ tables, the largest holding `n` rows, spends. */
const spendFor = (n: number): number => 2 + Math.floor(n / D1_PAGE_ROWS) + 1;

/** D1's "Maximum string, BLOB or table row size", which node:sqlite does not impose. */
const D1_MAX_VALUE_BYTES = 2_000_000;

/** The real engine behind D1's value cap, and what it saw. */
interface CappedD1 {
  db: D1Database;
  /** Reads refused for a value past D1_MAX_VALUE_BYTES. Zero on a healthy night. */
  refused: number;
  /** The widest value any read answered, in UTF-8 bytes. */
  widest: number;
}

/**
 * The real engine behind D1's value cap: a read that answers a string past
 * D1_MAX_VALUE_BYTES throws, as D1 does (SQLITE_TOOBIG), instead of handing the
 * export a value production would never have returned. Counted in UTF-8 BYTES,
 * as D1 counts it — a JS string's `.length` is UTF-16 code units, and a cap
 * measured that way passes a page of three-byte characters at three times the size.
 */
function withD1ValueCap(real: RealDb): CappedD1 {
  const capped: CappedD1 = { db: undefined as unknown as D1Database, refused: 0, widest: 0 };
  const check = <T>(rows: T[]): T[] => {
    for (const row of rows) {
      for (const value of Object.values(row as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        const bytes = new TextEncoder().encode(value).byteLength;
        if (bytes > D1_MAX_VALUE_BYTES) {
          capped.refused += 1;
          throw new Error(`string or blob too big: SQLITE_TOOBIG (${bytes} bytes)`);
        }
        capped.widest = Math.max(capped.widest, bytes);
      }
    }
    return rows;
  };
  capped.db = {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      return {
        all: async () => ({ results: check((await statement.all()).results) }),
        first: async () => check([await statement.first()])[0],
      };
    },
  } as unknown as D1Database;
  return capped;
}

/**
 * SQL keywords a `(` follows without being a call: a subquery or VALUES row
 * (`FROM (VALUES ('a'), ('b'))`) or a column list. D1's 32 is a FUNCTION's
 * argument cap, so the table list the column read is fed is not one.
 */
const NOT_A_CALL = new Set(['from', 'join', 'values', 'in', 'as', 'on', 'into', 'using', 'exists', 'and', 'or', 'not', 'where', 'select']);

/** The most arguments any one function call in `sql` takes. Quoted runs are skipped. */
function widestCall(sql: string): number {
  let widest = 0;
  for (const m of sql.matchAll(/\b([A-Za-z_]+)\s*\(/g)) {
    if (NOT_A_CALL.has(m[1].toLowerCase())) continue;
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

/**
 * A D1 that runs `write` against the real engine the moment the first PAGE of
 * `table` has been answered — a webhook landing between two rounds of the 02:30
 * export. A page is the one read that aggregates rows (`json_group_array`).
 */
function writingAfterFirstPage(real: RealDb, table: string, write: string): D1Database {
  let fired = false;
  return {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      if (fired || !sql.includes('json_group_array') || !sql.includes(`"${table}"`)) return statement;
      return {
        all: () => statement.all(),
        first: async () => {
          const answer = await statement.first();
          fired = true;
          real.db.exec(write);
          return answer;
        },
      };
    },
  } as unknown as D1Database;
}

/**
 * A D1 that refuses its first `times` page reads with SQLITE_TOOBIG, as D1
 * refuses a value past its cap — or with `message`, as D1 refuses a read it
 * dropped (a reset, a timeout). Each refused read is still a statement the real
 * engine recorded — a query spent, as on D1.
 */
function refusingPages(real: RealDb, times: number, message = 'string or blob too big: SQLITE_TOOBIG'): D1Database {
  let left = times;
  return {
    prepare(sql: string) {
      const statement = real.prepare(sql);
      if (left === 0 || !sql.includes('json_group_array')) return statement;
      return {
        first: async () => {
          left -= 1;
          throw new Error(message);
        },
      };
    },
  } as unknown as D1Database;
}

/** The byte targets every page read in `sql` asked for, in order. */
const pageTargets = (sql: readonly string[]): number[][] =>
  sql.filter((q) => q.includes('json_group_array')).map((q) => [...q.matchAll(/run <= (\d+)/g)].map((m) => Number(m[1])));

/**
 * THE RESTORE, IN MINIATURE: a dump replayed through d1RestoreStatements into an
 * EMPTY engine. Foreign keys are off while rows load table by table and checked
 * after, as a restore into D1 has to do it.
 */
function restored(jsonl: string): RealDb {
  const target = new RealDb([]);
  target.db.exec('PRAGMA foreign_keys = OFF');
  for (const { sql, params } of d1RestoreStatements(jsonl)) target.db.prepare(sql).run(...params);
  target.db.exec('PRAGMA foreign_keys = ON');
  expect(target.rows('PRAGMA foreign_key_check'), 'the restored rows satisfy every foreign key').toEqual([]);
  return target;
}

/** Every user table of `db` and its rows in rowid order — BLOBs as their bytes. */
function contentsOf(db: RealDb): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const tables = db.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
  for (const { name } of tables) out[String(name)] = db.rows(`SELECT * FROM "${String(name)}" ORDER BY rowid`);
  return out;
}

/** The catalogue a restore must rebuild: every table and index, by its own SQL. */
const catalogueOf = (db: RealDb): unknown[] =>
  db.rows("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name");

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

  // ⏱ 2026-10-01 · review of #1108: "port the round-trip into CI". The test above
  // reads rows back out of the object; this one RESTORES it — every statement the
  // restore runs, into an empty engine — and compares the two databases whole.
  it('🔴 RESTORES: both databases rebuilt from their objects equal their sources, table for table, BLOBs byte for byte', async () => {
    const platform = realPlatformDb(['CREATE TABLE blob_vault (id INTEGER PRIMARY KEY, payload BLOB, note TEXT)']);
    const every = new Uint8Array(256).map((_, i) => i);
    const vault = platform.db.prepare('INSERT INTO blob_vault (payload, note) VALUES (?, ?)');
    vault.run(every, 'every byte value, 0x00 first');
    vault.run(new Uint8Array(0), 'an EMPTY blob is not NULL');
    vault.run(null, '{"$blob":"AAAA"}'); // TEXT shaped like the marker stays TEXT
    vault.run(new Uint8Array([0xe2, 0x82, 0xac]), '€ — the bytes of this very sign, as a BLOB');
    platform.db.exec(
      "INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES ('renewals','a',1,'ünïcode ✓','2026-09-05T06:00:00Z');" +
        "INSERT INTO native_attest_counters (day, scope, calls) VALUES ('2026-09-05','play-integrity:decode',3)",
    );
    const tracker = appDb();
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform, tracker);
    const out = await runBackup(env, NOW);
    expect(out.filter((o) => o.target.startsWith('d1:')).map((o) => o.ok)).toEqual([true, true]);

    for (const [name, source] of [['platform_db', platform], ['subscriptiontracker_db', tracker]] as const) {
      const jsonl = await gunzip(bucket.objects.get(`d1/${name}/${backupDate(NOW)}.jsonl.gz`)!.body);
      expect(linesOf(jsonl)[0]).toMatchObject({ kind: 'meta', generator: D1_DUMP_GENERATOR });
      const copy = restored(jsonl);
      expect(catalogueOf(copy), name).toEqual(catalogueOf(source));
      const want = contentsOf(source);
      // Ephemeral tables come back EMPTY by design (EPHEMERAL_TABLES).
      for (const t of EPHEMERAL_TABLES) if (t in want) want[t] = [];
      expect(contentsOf(copy), name).toEqual(want);
    }
    // Preconditions, so the comparison above compared something: the BLOBs went through.
    const vaultRows = contentsOf(platform).blob_vault as { payload: unknown }[];
    expect(vaultRows[0].payload).toBeInstanceOf(Uint8Array);
    expect((vaultRows[0].payload as Uint8Array).byteLength).toBe(256);
  });

  it('a BLOB travels as base64 under a type marker — never coerced to text, never dropped', async () => {
    const platform = realPlatformDb(['CREATE TABLE blob_vault (id INTEGER PRIMARY KEY, payload BLOB)']);
    platform.db.prepare('INSERT INTO blob_vault (payload) VALUES (?)').run(new Uint8Array([0, 1, 254, 255]));
    const dump = await dumpD1Database(platform as unknown as D1Database, 'platform_db', 1000, '2026-10-01T02:30:00Z');
    const row = linesOf(dump.jsonl).find((l) => l.kind === 'row' && l.table === 'blob_vault');
    expect(row?.data).toEqual({ id: 1, payload: { $blob: 'AAH+/w==' } });
    expect(decodeD1DumpValue({ $blob: 'AAH+/w==' })).toEqual(new Uint8Array([0, 1, 254, 255]));
    // Red control: an object that is not exactly the marker is not guessed at.
    expect(() => decodeD1DumpValue({ $blob: 'AA==', extra: 1 })).toThrow(/neither/);
    expect(() => decodeD1DumpValue(true)).toThrow(/neither/);
  });

  it('🔴 the restore REFUSES a dump that is not whole: cut off, short a row, truncated, or of a format it does not read', async () => {
    const { env } = envWith(new FakeBucket());
    const whole = (await dumpD1Database(env.PLATFORM_DB, 'platform_db', 1000, '2026-10-01T02:30:00Z')).jsonl;
    expect(d1RestoreStatements(whole).length).toBeGreaterThan(0);
    const lines = whole.trimEnd().split('\n');

    expect(() => d1RestoreStatements(lines.slice(0, -1).join('\n'))).toThrow(/no end line/);
    const heartbeat = realPlatformDb();
    heartbeat.db.exec("INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES ('j','t',1,'d','2026-09-05T06:00:00Z')");
    const one = (await dumpD1Database(heartbeat as unknown as D1Database, 'platform_db', 1000, '2026-10-01T02:30:00Z')).jsonl;
    const short = one.split('\n').filter((l) => !(l.includes('"kind":"row"') && l.includes('"table":"cron_heartbeat"'))).join('\n');
    expect(() => d1RestoreStatements(short)).toThrow(/cron_heartbeat ends at 1 rows and the dump holds 0/);
    const partial = (await dumpD1Database(realPlatformDb() as unknown as D1Database, 'platform_db', 2, '2026-10-01T02:30:00Z')).jsonl;
    expect(() => d1RestoreStatements(partial)).toThrow(/TRUNCATED/);
    expect(() => d1RestoreStatements(partial, { allowPartial: true })).not.toThrow();
    expect(() => d1RestoreStatements(whole.replace(D1_DUMP_GENERATOR, 'platform-worker-backup/9'))).toThrow(/not a D1 dump this restore reads/);
    // A /1 dump — the 30 nights already in R2 when this lands — still restores.
    expect(d1RestoreStatements(whole.replace(D1_DUMP_GENERATOR, 'platform-worker-backup/1'))).toEqual(d1RestoreStatements(whole));
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
    // A budget of 2 buys the catalogue and the column read, and not one page, so
    // no table's rows can be read.
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
    // Exactly: catalogue, columns, then one round of reads, one statement per
    // TABLES_PER_READ tables (nothing here is past a page).
    expect(platform.sql).toHaveLength(2 + Math.ceil(tableCount(platform) / TABLES_PER_READ));
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
    const real = realPlatformDb();
    env.PLATFORM_DB = withGhostTable(real, 'ghost_table');
    const out = await runBackup(env, NOW);
    const row = out.find((o) => o.target === 'd1:platform_db');
    expect(row?.ok).toBe(false);
    // 🔴 THE GUARD'S OWN WORDS, AND NOT MERELY THE TABLE'S NAME. Without the guard
    // the ghost is paged, the engine answers "no such table: ghost_table", and a
    // test that only looked for the name stayed green with the guard deleted.
    expect(row?.detail).toContain('"ghost_table" is in the catalogue and has no columns');
    // It refused BEFORE reading a page — the ghost was never named in a read.
    expect(real.sql.some((q) => q.includes('"ghost_table"'))).toBe(false);
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
    const capped = withD1ValueCap(platform);
    env.PLATFORM_DB = capped.db;
    const out = await runBackup(env, NOW);

    expect(out.find((o) => o.target === 'd1:platform_db')).toMatchObject({ ok: true });
    expect(capped.refused).toBe(0);
    expect(capped.widest).toBeLessThanOrEqual(D1_PAGE_BYTES);
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

  // ⏱ 2026-10-03 · club-rt-support (ci-gate on 545b1678): the four feedback tables
  // took the column read's VALUES list to 35 rows, and widestCall read `FROM (` as a
  // 35-argument call. A VALUES row list is not a function's arguments.
  it('🔴 widestCall counts a function\'s arguments, never a FROM (VALUES …) row list', () => {
    const rows = Array.from({ length: 40 }, (_, i) => `('t${i}')`).join(', ');
    expect(widestCall(`SELECT v.column1 FROM (VALUES ${rows}) AS v JOIN pragma_table_info(v.column1) AS p`)).toBe(1);
    const args = Array.from({ length: 33 }, (_, i) => `c${i}`).join(', ');
    expect(widestCall(`SELECT json_array(${args}) FROM (VALUES ${rows}) AS v`)).toBe(33);
  });
});

// ⏱ 2026-10-01 · review of #1108 (fix-backup-d1-budget): OFFSET paging lost a row
// to a delete between rounds, and widest-row sizing made one wide table cost a
// round per ~210 rows. These are the cases that hold the keyset and the byte cap.
describe('paging never skips a row, and a page is sized by its rows\' BYTES', () => {
  it('🔴 a row DELETED between two rounds costs no OTHER row: every row that existed all night lands (the reviewer\'s row 5001)', async () => {
    const count = 2 * D1_PAGE_ROWS;
    const platform = realPlatformDb(padRows(count));
    const dump = await dumpD1Database(
      writingAfterFirstPage(platform, 'pad_rows', 'DELETE FROM pad_rows WHERE id = 1'),
      'platform_db',
      1000,
      '2026-10-01T02:30:00Z',
    );
    // Precondition: the write landed between rounds — row 1 is gone from the database.
    expect(platform.count('pad_rows')).toBe(count - 1);
    const ids = linesOf(dump.jsonl)
      .filter((l) => l.kind === 'row' && l.table === 'pad_rows')
      .map((l) => (l.data as { id: number }).id);
    // Row 1 was read before it was deleted; row D1_PAGE_ROWS + 1 is the one an
    // OFFSET page skipped, while the dump said complete.
    expect(ids).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    expect(linesOf(dump.jsonl).find((l) => l.kind === 'table-end' && l.table === 'pad_rows')).toMatchObject({ rows: count, truncated: false });
    expect(dump.truncated).toBe(false);
  }, 30_000);

  it('a row INSERTED between rounds, past the cursor, is picked up; nothing that was there is lost', async () => {
    const count = D1_PAGE_ROWS + 10;
    const platform = realPlatformDb(padRows(count));
    const dump = await dumpD1Database(
      writingAfterFirstPage(platform, 'pad_rows', `INSERT INTO pad_rows (id) VALUES (${count + 1})`),
      'platform_db',
      1000,
      '2026-10-01T02:30:00Z',
    );
    const ids = linesOf(dump.jsonl)
      .filter((l) => l.kind === 'row' && l.table === 'pad_rows')
      .map((l) => (l.data as { id: number }).id);
    expect(ids).toEqual(Array.from({ length: count + 1 }, (_, i) => i + 1));
  }, 30_000);

  // ⏱ 2026-10-01 · review of #1118, finding 1 — the reviewer's probe, ported.
  it('🔴 a row DELETED AND RE-INSERTED under the same key between rounds is dumped twice, and the restore keeps ONE row, the newer', async () => {
    const count = D1_PAGE_ROWS + 10;
    const fill = (table: string): string =>
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${count}) INSERT INTO ${table} (k, v) SELECT 'k' || x, 'old' FROM c`;
    const platform = realPlatformDb([
      'CREATE TABLE probe_kv (k TEXT PRIMARY KEY, v TEXT)',
      fill('probe_kv'),
      // The same key declared by a UNIQUE INDEX instead of the table.
      'CREATE TABLE probe_ux (k TEXT, v TEXT)',
      'CREATE UNIQUE INDEX probe_ux_k ON probe_ux (k)',
      fill('probe_ux'),
    ]);
    const move =
      "DELETE FROM probe_kv WHERE k = 'k1'; INSERT INTO probe_kv (k, v) VALUES ('k1', 'new');" +
      "DELETE FROM probe_ux WHERE k = 'k1'; INSERT INTO probe_ux (k, v) VALUES ('k1', 'new')";
    const dump = await dumpD1Database(writingAfterFirstPage(platform, 'probe_kv', move), 'platform_db', 1000, '2026-10-01T02:30:00Z');
    expect(dump.truncated).toBe(false);
    for (const table of ['probe_kv', 'probe_ux']) {
      // Precondition: the move landed between rounds, so the dump holds k1 twice, old then new.
      const k1 = linesOf(dump.jsonl)
        .filter((l) => l.kind === 'row' && l.table === table && (l.data as { k: string }).k === 'k1')
        .map((l) => (l.data as { v: string }).v);
      expect(k1, table).toEqual(['old', 'new']);
    }
    const copy = restored(dump.jsonl);
    for (const table of ['probe_kv', 'probe_ux']) {
      expect(copy.count(table), table).toBe(count);
      expect(copy.rows(`SELECT v FROM ${table} WHERE k = 'k1'`), table).toEqual([{ v: 'new' }]);
      expect(copy.rows(`SELECT k, v FROM ${table} ORDER BY k`), table).toEqual(platform.rows(`SELECT k, v FROM ${table} ORDER BY k`));
    }
  }, 30_000);

  it('🔴 a 10,000-row provider_notifications, its widest body production\'s 4,749 bytes, spends under HALF the pool and lands whole', async () => {
    // ⏱ 2026-10-01: sized by its WIDEST row, every page of this table was ~210 rows,
    // so 10,000 rows cost ~48 rounds — past the whole pool of 42, a truncated night.
    // Sized by bytes, it costs what its rows weigh: a few rounds.
    const count = 10_000;
    const platform = realPlatformDb([
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${count}) ` +
        'INSERT INTO provider_notifications (provider, provider_event_id, received_at, payload) ' +
        "SELECT 'paddle', 'evt_' || x, '2026-09-30T02:00:00Z', printf('%.*c', CASE WHEN x % 50 = 0 THEN 4670 ELSE 400 END, 'x') FROM c",
    ]);
    // Precondition: the fixture's widest row is production's widest, as the old sizing read it.
    const widest = platform.rows(
      "SELECT max(length(json_array(provider, provider_event_id, provider_notification_id, event_type, occurred_at, environment, received_at, payload, derived_at, derive_error))) AS w FROM provider_notifications",
    )[0].w as number;
    expect(widest).toBeGreaterThanOrEqual(4_700);
    expect(Math.floor(D1_PAGE_BYTES / widest) * 40).toBeLessThan(count); // the old page: 40 rounds would not cover it
    const tracker = appDb();
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform, tracker);
    const capped = withD1ValueCap(platform);
    env.PLATFORM_DB = capped.db;
    const out = await runBackup(env, NOW);

    const spent = platform.sql.length + tracker.sql.length;
    expect(spent * 100).toBeLessThan(MAX_D1_QUERIES_PER_RUN * 50);
    expect(out.find((o) => o.target === 'd1:platform_db')).toMatchObject({ ok: true });
    expect(out.find((o) => o.target === 'd1-budget')?.ok).toBe(true);
    expect(capped.refused).toBe(0);
    expect(capped.widest).toBeLessThanOrEqual(D1_PAGE_BYTES);
    const lines = linesOf(await gunzip(bucket.objects.get(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)!.body));
    const events = lines.filter((l) => l.kind === 'row' && l.table === 'provider_notifications').map((l) => (l.data as { provider_event_id: string }).provider_event_id);
    expect(events).toHaveLength(count);
    expect(new Set(events).size).toBe(count);
    expect(lines.find((l) => l.kind === 'table-end' && l.table === 'provider_notifications')).toMatchObject({ rows: count, truncated: false });
  }, 60_000);

  it('🔴 a page is capped in UTF-8 BYTES, not characters: three-byte rows never pass D1_PAGE_BYTES nor draw a refusal', async () => {
    // 45 rows of 50,000 '€' are 2.25M characters and 6.75 MB. Counted in characters
    // (SQLite's length() of TEXT), a page holds ~19 of them — 2.85 MB, past D1's cap.
    const count = 45;
    const platform = realPlatformDb([
      'CREATE TABLE utf8_rows (id INTEGER PRIMARY KEY, body TEXT NOT NULL)',
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${count}) INSERT INTO utf8_rows SELECT x, replace(printf('%.50000c', 'x'), 'x', '€') FROM c`,
    ]);
    expect(Math.floor(D1_PAGE_BYTES / 50_000) * 150_000).toBeGreaterThan(D1_MAX_VALUE_BYTES);
    const capped = withD1ValueCap(platform);
    const dump = await dumpD1Database(capped.db, 'platform_db', 1000, '2026-10-01T02:30:00Z');
    expect(capped.refused).toBe(0);
    expect(capped.widest).toBeLessThanOrEqual(D1_PAGE_BYTES);
    const bodies = linesOf(dump.jsonl).filter((l) => l.kind === 'row' && l.table === 'utf8_rows').map((l) => (l.data as { body: string }).body);
    expect(bodies).toHaveLength(count);
    expect(bodies.every((b) => b === '€'.repeat(50_000))).toBe(true);
  }, 30_000);

  it('🔴 a page D1 refuses is retried ONCE, a quarter the size, and every row still lands — one query more, counted', async () => {
    const control = realPlatformDb(padRows(10));
    await dumpD1Database(control as unknown as D1Database, 'platform_db', 1000, '2026-10-01T02:30:00Z');
    const platform = realPlatformDb(padRows(10));
    const dump = await dumpD1Database(refusingPages(platform, 1), 'platform_db', 1000, '2026-10-01T02:30:00Z');
    expect(dump.truncated).toBe(false);
    expect(linesOf(dump.jsonl).filter((l) => l.kind === 'row' && l.table === 'pad_rows')).toHaveLength(10);
    expect(platform.sql).toHaveLength(control.sql.length + 1);
    expect(dump.queries).toBe(platform.sql.length);
    // The retry asked for a quarter of every target the refused read asked for.
    const [first, retry] = pageTargets(platform.sql);
    expect(retry).toEqual(first.map((t) => Math.floor(t / PAGE_RETRY_SHRINK)));
  });

  it('🔴 refused AGAIN after the retry: the night is RED, names the table, and writes no object', async () => {
    const bucket = new FakeBucket();
    const { env } = envWith(bucket);
    const real = realPlatformDb();
    env.PLATFORM_DB = refusingPages(real, 2);
    const out = await runBackup(env, NOW);
    const row = out.find((o) => o.target === 'd1:platform_db');
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('failed again after every page in it was cut');
    expect(row?.detail).toContain('SQLITE_TOOBIG');
    expect(bucket.objects.has(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)).toBe(false);
    expect(pageTargets(real.sql)).toHaveLength(2); // the read and its ONE retry, no third
    expect(latestManifest(bucket).complete).toBe(false);
  });

  // ⏱ 2026-10-01 · review of #1118, finding 5.
  it('🔴 once a cut page LANDS, the next page asks for the full target again — one refusal never quarters the rest of the night', async () => {
    const platform = realPlatformDb(padRows(D1_PAGE_ROWS + 10));
    const dump = await dumpD1Database(refusingPages(platform, 1), 'platform_db', 1000, '2026-10-01T02:30:00Z');
    expect(dump.truncated).toBe(false);
    expect(linesOf(dump.jsonl).filter((l) => l.kind === 'row' && l.table === 'pad_rows')).toHaveLength(D1_PAGE_ROWS + 10);
    const [first, cut, next] = pageTargets(platform.sql);
    // Every table's first page asks for the same full target, just under D1_PAGE_BYTES.
    const full = first[0];
    expect(first.every((t) => t === full) && full > D1_PAGE_BYTES / 2 && full <= D1_PAGE_BYTES).toBe(true);
    expect(cut).toEqual(first.map((t) => Math.floor(t / PAGE_RETRY_SHRINK)));
    // Round two reads only pad_rows' second page, at the FULL target.
    expect(next).toEqual([full]);
  }, 30_000);

  it('🔴 a refusal that is NOT about size is retried ONCE at the SAME size; refused again, the night is RED', async () => {
    const platform = realPlatformDb(padRows(10));
    const dump = await dumpD1Database(refusingPages(platform, 1, 'D1_ERROR: Network connection lost.'), 'platform_db', 1000, '2026-10-01T02:30:00Z');
    expect(dump.truncated).toBe(false);
    expect(linesOf(dump.jsonl).filter((l) => l.kind === 'row' && l.table === 'pad_rows')).toHaveLength(10);
    const [first, retry] = pageTargets(platform.sql);
    expect(retry).toEqual(first);

    const twice = realPlatformDb(padRows(10));
    await expect(
      dumpD1Database(refusingPages(twice, 2, 'D1_ERROR: Network connection lost.'), 'platform_db', 1000, '2026-10-01T02:30:00Z'),
    ).rejects.toThrow(/failed again at the same size — .*Network connection lost/);
    expect(pageTargets(twice.sql)).toHaveLength(2); // the read and its ONE retry, no third
  });

  it('🔴 ONE row wider than D1_PAGE_BYTES is retried once and then fails LOUDLY — never skipped, never a quiet partial', async () => {
    const platform = realPlatformDb([
      'CREATE TABLE one_wide (id INTEGER PRIMARY KEY, body TEXT NOT NULL)',
      `INSERT INTO one_wide VALUES (1, printf('%.${D1_PAGE_BYTES + 200_000}c', 'x'))`,
    ]);
    const bucket = new FakeBucket();
    const { env } = envWith(bucket, platform);
    const out = await runBackup(env, NOW);
    const row = out.find((o) => o.target === 'd1:platform_db');
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('one_wide');
    expect(row?.detail).toContain(`past D1_PAGE_BYTES (${D1_PAGE_BYTES})`);
    expect(bucket.objects.has(`d1/platform_db/${backupDate(NOW)}.jsonl.gz`)).toBe(false);
  }, 30_000);

  it('a column NAMED rowid does not hide the keyset: the table pages by _rowid_ and every row lands, in order', async () => {
    const count = D1_PAGE_ROWS + 5;
    const platform = realPlatformDb([
      'CREATE TABLE shadowed (rowid TEXT, v INTEGER)',
      `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ${count}) INSERT INTO shadowed SELECT 'r' || (${count} - x), x FROM c`,
    ]);
    const dump = await dumpD1Database(platform as unknown as D1Database, 'platform_db', 1000, '2026-10-01T02:30:00Z');
    expect(platform.sql.some((q) => q.includes('"shadowed"') && q.includes('CAST(_rowid_ AS TEXT)'))).toBe(true);
    const vs = linesOf(dump.jsonl).filter((l) => l.kind === 'row' && l.table === 'shadowed').map((l) => (l.data as { v: number }).v);
    expect(vs).toEqual(Array.from({ length: count }, (_, i) => i + 1));
  }, 30_000);

  it('🔴 a WITHOUT ROWID table is refused LOUDLY before any page is read — it has no rowid to page after', async () => {
    const platform = realPlatformDb(['CREATE TABLE no_rowid (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID', "INSERT INTO no_rowid VALUES ('a', 'b')"]);
    await expect(dumpD1Database(platform as unknown as D1Database, 'platform_db', 1000, '2026-10-01T02:30:00Z')).rejects.toThrow(
      /no_rowid is WITHOUT ROWID/,
    );
    expect(platform.sql.some((q) => q.includes('json_group_array'))).toBe(false);
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
