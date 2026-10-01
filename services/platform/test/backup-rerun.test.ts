// ─────────────────────────────────────────────────────────────────────────────
// THE LEAD'S ONE-SHOT BACKUP RE-RUN, through the REAL `scheduled` handler.
//
// ⏱ 2026-10-01. A fix to backup_export (#1108, merged 04:27Z) could not be
// proven before the next 02:30Z: Cloudflare cannot fire a production cron on
// demand. So the hourly `15 * * * *` firing runs the real export ONCE when the
// lead sets CONFIG_KV `ops:rerun:backup_export`, and these cases are what keep
// it ONE-SHOT: the key is deleted before the export starts, and a firing that
// finds no live flag runs nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, vi } from 'vitest';
import { scheduled, backupRerunJob, BACKUP_RERUN_KEY, BACKUP_JOB, OPS_HOURLY_CRON } from '../src/scheduled';
import { RealDb, realPlatformDb } from './harness';
import appInit0001 from '../../subscriptiontracker-api/migrations/0001_init.sql?raw';
import appSchemaDebt0002 from '../../subscriptiontracker-api/migrations/0002_schema_debt.sql?raw';
import type { Env } from '../src/types';

const NOW = Date.parse('2026-10-01T13:15:00Z');

/** One ordered log every double writes to, so "deleted BEFORE the export" is a fact about order. */
type Event = string;

class FakeKv {
  constructor(readonly data: Record<string, string>, private readonly events: Event[], private readonly name: string) {}
  async get(key: string): Promise<string | null> {
    this.events.push(`${this.name}.get ${key}`);
    return this.data[key] ?? null;
  }
  async delete(key: string): Promise<void> {
    this.events.push(`${this.name}.delete ${key}`);
    delete this.data[key];
  }
  async list(): Promise<{ keys: { name: string }[]; list_complete: boolean }> {
    this.events.push(`${this.name}.list`);
    return { keys: Object.keys(this.data).map((name) => ({ name })), list_complete: true };
  }
}

class FakeBucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];
  constructor(private readonly events: Event[]) {}
  async put(key: string, body: ArrayBuffer | string): Promise<void> {
    this.events.push(`r2.put ${key}`);
    this.objects.set(key, typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body));
  }
  async list(): Promise<{ objects: { key: string }[]; truncated: boolean }> {
    this.events.push('r2.list');
    return { objects: [...this.objects.keys()].map((key) => ({ key })), truncated: false };
  }
  async delete(key: string): Promise<void> {
    this.events.push(`r2.delete ${key}`);
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

const flag = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    requestedAt: '2026-10-01T12:20:00Z',
    by: 'lead db0cc7',
    reason: 're-prove #1108 the same day',
    expiresAt: '2026-10-01T23:59:00Z',
    ...over,
  });

function world(config: Record<string, string>) {
  const events: Event[] = [];
  const db = realPlatformDb();
  const kv = new FakeKv({ 'config:subscriptiontracker': '{"flags":{}}', ...config }, events, 'config');
  const bucket = new FakeBucket(events);
  const env = {
    PLATFORM_DB: db,
    SUBSCRIPTIONTRACKER_DB: new RealDb([appInit0001, appSchemaDebt0002]),
    CONFIG_KV: kv,
    JWKS_CACHE: new FakeKv({}, events, 'jwks'),
    SIGNUPS: new FakeKv({}, events, 'signups'),
    BACKUPS_R2: bucket,
    GITHUB_DISPATCH_TOKEN: 'tok',
  } as unknown as Env;
  return { events, db, kv, bucket, env };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

/** Fire `15 * * * *` through the real handler at NOW; the Actions lists are empty. */
async function fireHourly(env: Env): Promise<string[]> {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  globalThis.fetch = ((input: RequestInfo | URL) => {
    if (String(input).includes('/actions/runs?status=')) {
      return Promise.resolve(new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), { status: 200 }));
    }
    return Promise.resolve(new Response('', { status: 200 }));
  }) as unknown as typeof fetch;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {} };
    await scheduled({ cron: OPS_HOURLY_CRON } as never, env, ctx as never);
    await Promise.all(pending);
    return log.mock.calls.map((c) => c.map(String).join(' '));
  } finally {
    log.mockRestore();
  }
}

const jobs = (db: RealDb) => db.rows('SELECT DISTINCT job FROM cron_heartbeat ORDER BY job').map((r) => r.job);
const backupRows = (db: RealDb) =>
  db.rows(`SELECT target, ok, detail FROM cron_heartbeat WHERE job = '${BACKUP_JOB}' ORDER BY target`);

describe('the hourly firing re-runs backup_export once, and only on a live flag', () => {
  it('the key is the allowlist of one: `ops:rerun:backup_export`', () => {
    expect(BACKUP_JOB).toBe('backup_export');
    expect(BACKUP_RERUN_KEY).toBe('ops:rerun:backup_export');
  });

  it('no flag: the hourly firing records only ops_stuck_runs and exports nothing', async () => {
    const w = world({});
    await fireHourly(w.env);
    expect(jobs(w.db)).toEqual(['ops_stuck_runs']);
    expect(w.events.filter((e) => e.startsWith('r2.'))).toEqual([]);
  });

  it('🔴 a live flag: exactly one export, the key DELETED BEFORE it starts, and the heartbeat recorded', async () => {
    const w = world({ [BACKUP_RERUN_KEY]: flag() });
    const logs = await fireHourly(w.env);

    expect(jobs(w.db)).toEqual(['backup_export', 'ops_stuck_runs']);
    // The delete is the first thing after the read, ahead of every export read and write.
    const del = w.events.indexOf(`config.delete ${BACKUP_RERUN_KEY}`);
    expect(del).toBeGreaterThan(w.events.indexOf(`config.get ${BACKUP_RERUN_KEY}`));
    const firstExport = w.events.findIndex((e) => e.startsWith('r2.') || e.endsWith('.list'));
    expect(firstExport).toBeGreaterThan(del);
    expect(w.kv.data[BACKUP_RERUN_KEY]).toBeUndefined();

    // ONE export: one manifest, and one row per target.
    const manifests = [...w.bucket.objects.keys()].filter((k) => k.endsWith('manifest.json'));
    expect(manifests).toEqual(['reruns/2026-10-01T131500Z/manifest.json']);
    const rows = backupRows(w.db);
    expect(rows.map((r) => r.target)).toEqual(
      ['d1-budget', 'd1:platform_db', 'd1:subscriptiontracker_db', 'kv:nikatru-signups', 'kv:platform-config', 'kv:platform-jwks', 'manifest'].sort(),
    );
    expect(rows.every((r) => r.ok === 1)).toBe(true);

    // The one log line names who asked and when, and nothing else of the flag.
    const line = logs.filter((l) => l.startsWith('[ops] rerun backup_export'));
    expect(line).toEqual(['[ops] rerun backup_export requestedAt=2026-10-01T12:20:00.000Z by=lead db0cc7']);
    expect(logs.join('\n')).not.toContain('re-prove #1108');
  });

  it('🔴 a second hourly firing after the run exports nothing', async () => {
    const w = world({ [BACKUP_RERUN_KEY]: flag() });
    await fireHourly(w.env);
    const rowsAfterFirst = backupRows(w.db).length;
    const putsAfterFirst = w.events.filter((e) => e.startsWith('r2.put')).length;
    expect(rowsAfterFirst).toBeGreaterThan(0);

    await fireHourly(w.env);
    expect(backupRows(w.db)).toHaveLength(rowsAfterFirst);
    expect(w.events.filter((e) => e.startsWith('r2.put'))).toHaveLength(putsAfterFirst);
  });

  it('🔴 the key is gone even when the export throws — one-shot whatever happens next', async () => {
    const w = world({ [BACKUP_RERUN_KEY]: flag() });
    const seen: (string | undefined)[] = [];
    const boom = async () => {
      seen.push(w.kv.data[BACKUP_RERUN_KEY]);
      throw new Error('export blew up');
    };
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await backupRerunJob(w.env, NOW, boom as never)).toBe('failed');
    } finally {
      log.mockRestore();
    }
    expect(seen).toEqual([undefined]);
    expect(w.kv.data[BACKUP_RERUN_KEY]).toBeUndefined();
    expect(backupRows(w.db)).toEqual([]);
  });

  it('a flag whose delete fails runs nothing', async () => {
    const w = world({ [BACKUP_RERUN_KEY]: flag() });
    w.kv.delete = () => Promise.reject(new Error('kv down'));
    const backup = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await backupRerunJob(w.env, NOW, backup as never)).toBe('failed');
    } finally {
      log.mockRestore();
    }
    expect(backup).not.toHaveBeenCalled();
  });

  it('🔴 an expired flag is deleted, and nothing runs', async () => {
    const w = world({ [BACKUP_RERUN_KEY]: flag({ expiresAt: '2026-10-01T13:00:00Z' }) });
    const logs = await fireHourly(w.env);
    expect(w.kv.data[BACKUP_RERUN_KEY]).toBeUndefined();
    expect(jobs(w.db)).toEqual(['ops_stuck_runs']);
    expect(w.events.filter((e) => e.startsWith('r2.'))).toEqual([]);
    expect(logs.some((l) => l.includes('flag expired at 2026-10-01T13:00:00.000Z, deleted, nothing ran'))).toBe(true);
  });

  it('a malformed flag runs nothing, and is left for the lead to read', async () => {
    for (const raw of [
      'not json',
      '[]',
      'null',
      flag({ by: '' }),
      flag({ reason: undefined }),
      flag({ expiresAt: 'tomorrow-ish' }),
      flag({ requestedAt: 42 }),
      flag({ by: 'lead\nINJECTED' }),
    ]) {
      const w = world({ [BACKUP_RERUN_KEY]: raw });
      const logs = await fireHourly(w.env);
      expect(jobs(w.db), raw).toEqual(['ops_stuck_runs']);
      expect(w.events.filter((e) => e.startsWith('r2.')), raw).toEqual([]);
      expect(w.kv.data[BACKUP_RERUN_KEY], raw).toBe(raw);
      expect(logs, raw).toContain('[ops] rerun backup_export: flag malformed, nothing ran');
    }
  });

  it('any other `ops:rerun:*` key is never read, run or deleted', async () => {
    const w = world({ 'ops:rerun:retention_sweep': flag(), 'ops:rerun:renewals': flag() });
    await fireHourly(w.env);
    expect(jobs(w.db)).toEqual(['ops_stuck_runs']);
    expect(w.events.filter((e) => e.startsWith('config.') && !e.endsWith(BACKUP_RERUN_KEY))).toEqual([]);
    expect(Object.keys(w.kv.data)).toEqual(expect.arrayContaining(['ops:rerun:retention_sweep', 'ops:rerun:renewals']));
  });
});
