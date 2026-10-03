// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ops/box-manifest — PB-27. A box reports the hashes of its live
// config; the row it writes is what tooling/ops/check-box-config-drift.mjs reads.
//
// What must hold, each asserted against the REAL migrated schema (harness.ts
// applies migrations/0024_box_config_manifest.sql):
//   · a box's own secret writes that box's row, and only that box's row;
//   · Box B's secret cannot write Box C's row (the secret is BOX-scoped);
//   · an unconfigured box answers 503 before anything is read or written;
//   · a malformed manifest writes nothing;
//   · a re-post REPLACES the row whole, so a file the box stopped sending is gone;
//   · it is mounted on the real app, and a browser gets no CORS there.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { app as realApp } from '../src/index';
import { BOX_MANIFEST_MAX_FILES, parseBoxFiles } from '../src/routes/box-manifest';
import type { AppEnv } from '../src/types';
import { realPlatformDb, type RealDb } from './harness';

const SECRET_B = 'box-b-secret-for-tests-only';
const SECRET_C = 'box-c-secret-for-tests-only';
const H = (c: string) => c.repeat(64);

function env(db: RealDb, extra: Record<string, unknown> = {}) {
  return {
    PLATFORM_DB: db,
    BOX_MANIFEST_SECRET_BOXB: SECRET_B,
    BOX_MANIFEST_SECRET_BOXC: SECRET_C,
    ...extra,
  } as unknown as AppEnv['Bindings'];
}

async function post(db: RealDb, body: unknown, { secret = SECRET_C as string | null, envExtra = {}, headers = {} } = {}) {
  const res = await realApp.request(
    'http://x/v1/ops/box-manifest',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret === null ? {} : { Authorization: `Bearer ${secret}` }),
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env(db, envExtra),
  );
  return res;
}

const rows = (db: RealDb) =>
  db.db.prepare('SELECT box, manifest, posted_at FROM box_config_manifest ORDER BY box').all() as Array<{
    box: string;
    manifest: string;
    posted_at: string;
  }>;

const GOOD_C = { box: 'boxc', files: { tunnel: H('c'), compose: H('a'), override: H('b') } };

describe('POST /v1/ops/box-manifest', () => {
  it("records a box's manifest under its own secret, key-sorted, stamped with the server's time", async () => {
    const db = realPlatformDb();
    const res = await post(db, GOOD_C);
    expect(res.status).toBe(204);
    const [row] = rows(db);
    expect(row.box).toBe('boxc');
    expect(row.manifest).toBe(JSON.stringify({ compose: H('a'), override: H('b'), tunnel: H('c') }));
    expect(Number.isNaN(Date.parse(row.posted_at))).toBe(false);
  });

  it("🔴 Box B's secret cannot write Box C's row — the secret is scoped to ONE box", async () => {
    const db = realPlatformDb();
    const res = await post(db, GOOD_C, { secret: SECRET_B });
    expect(res.status).toBe(401);
    expect(rows(db)).toEqual([]);
  });

  it('a missing or wrong bearer is 401 and writes nothing', async () => {
    const db = realPlatformDb();
    expect((await post(db, GOOD_C, { secret: null })).status).toBe(401);
    expect((await post(db, GOOD_C, { secret: 'nope' })).status).toBe(401);
    expect((await post(db, GOOD_C, { secret: `${SECRET_C}x` })).status).toBe(401);
    expect(rows(db)).toEqual([]);
  });

  it('a box whose secret is not configured answers 503 and writes nothing', async () => {
    const db = realPlatformDb();
    const res = await post(db, GOOD_C, { envExtra: { BOX_MANIFEST_SECRET_BOXC: undefined } });
    expect(res.status).toBe(503);
    expect(rows(db)).toEqual([]);
  });

  it('a box outside the closed set is refused before any secret is consulted', async () => {
    const db = realPlatformDb();
    for (const box of ['boxa', 'BOXC', '', 'constructor', 'toString', null]) {
      expect((await post(db, { ...GOOD_C, box })).status, String(box)).toBe(400);
    }
    expect(rows(db)).toEqual([]);
  });

  it('a malformed manifest is 400 and writes nothing', async () => {
    const db = realPlatformDb();
    const bad: unknown[] = [
      { box: 'boxc' },
      { box: 'boxc', files: {} },
      { box: 'boxc', files: [] },
      { box: 'boxc', files: { compose: 'abc' } },
      { box: 'boxc', files: { compose: H('A') } },
      { box: 'boxc', files: { '../etc/passwd': H('a') } },
      { box: 'boxc', files: { 'Compose File': H('a') } },
      '{not json',
    ];
    for (const b of bad) expect((await post(db, b)).status, JSON.stringify(b)).toBe(400);
    expect(rows(db)).toEqual([]);
  });

  it('a re-post REPLACES the row whole — a file the box stopped sending is gone from it', async () => {
    const db = realPlatformDb();
    expect((await post(db, GOOD_C)).status).toBe(204);
    expect((await post(db, { box: 'boxc', files: { compose: H('d') } })).status).toBe(204);
    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0].manifest)).toEqual({ compose: H('d') });
  });

  it('both boxes keep their own rows', async () => {
    const db = realPlatformDb();
    expect((await post(db, GOOD_C)).status).toBe(204);
    expect((await post(db, { box: 'boxb', files: { compose: H('e') } }, { secret: SECRET_B })).status).toBe(204);
    expect(rows(db).map((r) => r.box)).toEqual(['boxb', 'boxc']);
  });

  it('an over-size body is 413', async () => {
    const db = realPlatformDb();
    const res = await post(db, JSON.stringify({ box: 'boxc', files: { compose: H('a') }, pad: 'x'.repeat(9_000) }));
    expect(res.status).toBe(413);
    expect(rows(db)).toEqual([]);
  });

  it('a browser request (one carrying Origin) is refused with no CORS grant', async () => {
    const db = realPlatformDb();
    const res = await post(db, GOOD_C, { headers: { Origin: 'https://nikatru.com' } });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(rows(db)).toEqual([]);
  });
});

describe('parseBoxFiles', () => {
  it('caps the file count', () => {
    const many = Object.fromEntries(Array.from({ length: BOX_MANIFEST_MAX_FILES + 1 }, (_, i) => [`f${i}`, H('a')]));
    expect(parseBoxFiles(many)).toBeNull();
    const max = Object.fromEntries(Array.from({ length: BOX_MANIFEST_MAX_FILES }, (_, i) => [`f${i}`, H('a')]));
    expect(parseBoxFiles(max)).not.toBeNull();
  });
});
