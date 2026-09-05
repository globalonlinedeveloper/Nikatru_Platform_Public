// ─────────────────────────────────────────────────────────────────────────────
// THE NIGHTLY OFF-VENDOR EXPORT — D1 + KV into R2, 02:30 UTC.
//
// 🔴 WHAT THIS CLOSES. `research/revamp-2026-09-05/06-infrastructure-live.md`
// §4.2, measured 2026-09-05: "D1, KV and R2 are in NO backup, and
// `recovery.worker-d1-export` has NEVER been drilled." `platform_db` served
// 26,938 read queries and 324,066 rows read in seven days and holds
// ENTITLEMENTS — who has paid for what — while Box A's Postgres, with ZERO
// users, was dumped four times a day to two encrypted destinations. The backup
// effort was inversely proportional to the data's importance.
//
// 🔴 D1 TIME TRAVEL IS NOT A BACKUP AND IS NOT A SUBSTITUTE FOR THIS. 30 days of
// point-in-time restore on Workers Paid is real and worth having, but it lives
// INSIDE the vendor: it does not survive account loss, it is not an artefact
// anyone can hold, and it had never been exercised here. This is the off-vendor
// half, and it only counts once Box B pulls it down (runbooks/backup-restore.md).
//
// ⚠️ WHY 02:30 AND NOT THE 06:00 NIGHTLY HANDLER. Two reasons, both measured.
// Box B's own chain runs `backup.sh` at 02:00 and the Drive sync at 02:30
// (`06 §2.5`), so an export written at 02:30 is pulled and riding the existing
// Drive/Box B chain within the hour; written at 06:00 it would wait ~20h for the
// next Drive sync. And `retentionSweep` DELETES at 06:00 — taking the copy
// BEFORE the sweep means the archive holds the night the sweep is about to prune.
// ─────────────────────────────────────────────────────────────────────────────
import { dumpD1Database, dumpKvNamespace, gzipAndDigest } from './dump';

/**
 * The per-invocation D1 query budget this export may spend.
 *
 * @ceiling d1.queriesPerInvocation lte
 *
 * 🔴 THE HEADROOM IS DELIBERATE AND SMALL. The recorded value is the FREE number
 * (50) even though the plan of record is Workers Paid (1,000) — tooling/ceilings.json
 * keeps free numbers on purpose, so a cap derived here is needlessly tight rather
 * than dangerously loose. 45 leaves five queries for the heartbeat write and any
 * limb that runs alongside this one on the same firing. Today's cost is ~2 + one
 * page per table across two databases, well under it.
 */
export const MAX_D1_QUERIES_PER_RUN = 45;

/**
 * Keys read per KV namespace per run.
 *
 * @ceiling workers.subrequestsToCloudflareServices lte
 *
 * Each `get` is one subrequest to a Cloudflare service. Three namespaces at this
 * cap is 750, plus 45 D1 queries and under a dozen R2 operations — inside the
 * 1,000 the recorded (Free) value allows, with the paid value ten times that.
 * Measured today: `platform-config` and `platform-jwks` hold a handful of keys
 * each and `nikatru-signups` took 0 writes in seven days (`06 §3.4`).
 */
export const MAX_KV_KEYS_PER_NS = 250;

/**
 * How many days of exports R2 keeps.
 *
 * @ceiling none — a RETENTION POLICY, not a platform resource. Its right-hand
 *   side is D1 Time Travel's own 30-day window: shorter would leave a gap where
 *   neither mechanism can reach a given day, and longer buys little while
 *   Time Travel still covers the same period from the other direction. R2 is at
 *   1.3% of the free 10 GB and a day's export is under half a megabyte, so cost
 *   did not decide this.
 */
export const BACKUP_RETENTION_DAYS = 30;

/**
 * Objects the retention sweep may delete in one run.
 *
 * @ceiling workers.subrequestsToCloudflareServices lte
 *
 * At four objects a day a 30-day window sheds four a night; 200 is two months of
 * catch-up after an outage and still cannot monopolise the subrequest budget.
 */
export const MAX_R2_DELETES_PER_RUN = 200;

/** The bindings this export needs. A subset of `Env`, named so it can be faked. */
export interface BackupEnv {
  PLATFORM_DB: D1Database;
  SUBLY_DB: D1Database;
  CONFIG_KV: KVNamespace;
  JWKS_CACHE?: KVNamespace;
  SIGNUPS?: KVNamespace;
  BACKUPS_R2?: R2Bucket;
}

/** One line of the heartbeat this run writes. Same shape the other limbs use. */
export interface BackupOutcome {
  target: string;
  ok: boolean;
  detail: string;
}

interface ManifestEntry {
  key: string;
  bytes: number;
  sha256: string;
  rows?: number;
  keys?: number;
  tables?: number;
  truncated: boolean;
}

/** `YYYY-MM-DD` in UTC — the only timezone any of this estate's schedules use. */
export function backupDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Is `key` an export older than the retention window?
 *
 * Exported for its own test: a date comparison done on strings is exactly the
 * kind of thing that is right for eleven months of the year.
 */
export function isExpired(key: string, nowMs: number, retentionDays: number): boolean {
  const stamp = /(\d{4}-\d{2}-\d{2})/.exec(key);
  if (stamp === null) return false; // Unrecognised key: never delete what you cannot date.
  const at = Date.parse(`${stamp[1]}T00:00:00Z`);
  if (Number.isNaN(at)) return false;
  return nowMs - at > retentionDays * 86_400_000;
}

/**
 * Run the export. Returns one heartbeat row per target; NEVER throws, because a
 * limb that throws writes no row and a missing row is the one signal
 * check-heartbeats.mjs reads as "the timer did not fire".
 *
 * 🔴 A TRUNCATED EXPORT IS RED, NOT GREEN. `truncated` means the query or key
 * budget ran out before the data did, so the object in R2 is a PARTIAL copy that
 * would restore cleanly and silently lose rows. That is the precise failure a
 * backup exists to prevent, so it sets `ok = false` and the manifest records it.
 */
export async function runBackup(env: BackupEnv, nowMs: number = Date.now()): Promise<BackupOutcome[]> {
  const out: BackupOutcome[] = [];
  const bucket = env.BACKUPS_R2;
  const date = backupDate(nowMs);
  const nowIso = new Date(nowMs).toISOString();

  if (!bucket) {
    return [
      {
        target: 'r2:nikatru-backups',
        ok: false,
        detail: 'BACKUPS_R2 binding absent — nothing was exported',
      },
    ];
  }

  const manifest: ManifestEntry[] = [];
  let queriesSpent = 0;

  // ── D1 ────────────────────────────────────────────────────────────────────
  const databases: { name: string; db: D1Database }[] = [
    { name: 'platform_db', db: env.PLATFORM_DB },
    { name: 'subly_db', db: env.SUBLY_DB },
  ];
  for (const { name, db } of databases) {
    const key = `d1/${name}/${date}.jsonl.gz`;
    try {
      const dump = await dumpD1Database(db, name, MAX_D1_QUERIES_PER_RUN - queriesSpent, nowIso);
      queriesSpent += dump.queries;
      const blob = await gzipAndDigest(dump.jsonl);
      await bucket.put(key, blob.body, {
        httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
        customMetadata: { sha256: blob.sha256, rows: String(dump.rows), truncated: String(dump.truncated) },
      });
      manifest.push({
        key,
        bytes: blob.bytes,
        sha256: blob.sha256,
        rows: dump.rows,
        tables: dump.tables.length,
        truncated: dump.truncated,
      });
      out.push({
        target: `d1:${name}`,
        ok: !dump.truncated,
        detail: dump.truncated
          ? `TRUNCATED at ${dump.queries} queries — ${dump.rows} rows of ${dump.tables.length} tables written, the export is PARTIAL`
          : `${dump.rows} rows, ${dump.tables.length} tables, ${blob.bytes}B gz`,
      });
    } catch (err) {
      out.push({ target: `d1:${name}`, ok: false, detail: `export failed: ${String(err)}` });
    }
  }

  // ── KV ────────────────────────────────────────────────────────────────────
  const namespaces: { name: string; ns: KVNamespace | undefined }[] = [
    { name: 'platform-config', ns: env.CONFIG_KV },
    { name: 'platform-jwks', ns: env.JWKS_CACHE },
    { name: 'nikatru-signups', ns: env.SIGNUPS },
  ];
  for (const { name, ns } of namespaces) {
    const key = `kv/${name}/${date}.json.gz`;
    if (!ns) {
      out.push({ target: `kv:${name}`, ok: false, detail: 'binding absent — nothing was exported' });
      continue;
    }
    try {
      const dump = await dumpKvNamespace(ns, name, MAX_KV_KEYS_PER_NS, nowIso);
      const blob = await gzipAndDigest(dump.json);
      await bucket.put(key, blob.body, {
        httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
        customMetadata: { sha256: blob.sha256, keys: String(dump.keys), truncated: String(dump.truncated) },
      });
      manifest.push({ key, bytes: blob.bytes, sha256: blob.sha256, keys: dump.keys, truncated: dump.truncated });
      out.push({
        target: `kv:${name}`,
        ok: !dump.truncated,
        detail: dump.truncated
          ? `TRUNCATED at ${dump.keys} keys — the export is PARTIAL`
          : `${dump.keys} keys, ${blob.bytes}B gz`,
      });
    } catch (err) {
      out.push({ target: `kv:${name}`, ok: false, detail: `export failed: ${String(err)}` });
    }
  }

  // ── The manifest, and `latest.json` ───────────────────────────────────────
  //
  // 🔴 `latest.json` IS THE CONTRACT WITH BOX B. The puller does not guess at
  // today's key names or trust its own clock: it reads this document, refuses it
  // if `date` is not today's, downloads exactly the objects it lists, and
  // verifies each SHA-256 before the file joins the backup tree. A silent
  // half-transfer therefore cannot become a green backup.
  const complete = out.every((o) => o.ok);
  const doc = JSON.stringify(
    { date, exportedAt: nowIso, generator: 'platform-worker-backup/1', complete, objects: manifest },
    null,
    1,
  );
  try {
    await bucket.put(`manifests/${date}.json`, doc, { httpMetadata: { contentType: 'application/json' } });
    await bucket.put('manifests/latest.json', doc, { httpMetadata: { contentType: 'application/json' } });
    out.push({ target: 'manifest', ok: true, detail: `${manifest.length} objects, complete=${complete}` });
  } catch (err) {
    out.push({ target: 'manifest', ok: false, detail: `manifest write failed: ${String(err)}` });
  }

  // ── Retention ─────────────────────────────────────────────────────────────
  try {
    let deleted = 0;
    let cursor: string | undefined;
    const doomed: string[] = [];
    for (;;) {
      const listed: R2Objects = await bucket.list({ cursor, limit: 1000 });
      for (const o of listed.objects) {
        if (o.key === 'manifests/latest.json') continue;
        if (doomed.length >= MAX_R2_DELETES_PER_RUN) break;
        if (isExpired(o.key, nowMs, BACKUP_RETENTION_DAYS)) doomed.push(o.key);
      }
      if (doomed.length >= MAX_R2_DELETES_PER_RUN) break;
      if (!listed.truncated) break;
      cursor = listed.cursor;
      if (!cursor) break;
    }
    for (const key of doomed) {
      await bucket.delete(key);
      deleted += 1;
    }
    out.push({ target: 'retention', ok: true, detail: `${deleted} object(s) older than ${BACKUP_RETENTION_DAYS}d deleted` });
  } catch (err) {
    out.push({ target: 'retention', ok: false, detail: `retention sweep failed: ${String(err)}` });
  }

  return out;
}
