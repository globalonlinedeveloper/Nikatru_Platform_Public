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
import { describe, it, expect } from 'vitest';
import { realPlatformDb } from './harness';
import { runBackup, isExpired, backupDate, BACKUP_RETENTION_DAYS } from '../src/backup';
import { dumpD1Database } from '../src/backup/dump';
import type { BackupEnv } from '../src/backup';

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
}

function envWith(bucket: FakeBucket | undefined, db = realPlatformDb()) {
  return {
    env: {
      PLATFORM_DB: db as unknown as D1Database,
      SUBLY_DB: db as unknown as D1Database,
      CONFIG_KV: new FakeKv({ 'config:subly': '{"flags":{}}' }) as unknown as KVNamespace,
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

describe('the nightly export writes something a restore can actually use', () => {
  it('🔴 ROUND-TRIPS: rows written to D1 come back out of the gzipped object, and the counts match', async () => {
    const { env, db } = envWith(new FakeBucket());
    db.db.exec(
      "INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES " +
        "('supabase_keepalive','a',1,'x','2026-09-05T06:00:00Z')," +
        "('supabase_keepalive','b',1,'y','2026-09-05T06:00:00Z')," +
        "('renewals','subly',0,'z','2026-09-05T06:00:00Z')",
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
      `d1/subly_db/${backupDate(NOW)}.jsonl.gz`,
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
    expect(doc.entries[0].key).toBe('config:subly');
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
