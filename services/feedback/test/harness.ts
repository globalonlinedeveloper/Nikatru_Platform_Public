// ─────────────────────────────────────────────────────────────────────────────
// harness.ts — the feedback Worker under test, over the SHIPPED schema.
//
// The tables are platform_db's, so the schema is services/platform's own
// migrations imported `?raw` (0003 the heartbeat table this Worker's cron writes,
// 0025 the intake's), run on the SQL port's node:sqlite engine; the bucket is the
// object port's memory fake. Nothing here is a copy of a schema.
// ─────────────────────────────────────────────────────────────────────────────
import { SqliteDb } from '../../_shared/src/ports/fakes/sql';
import { memoryObjects, type MemoryObjects } from '../../_shared/src/ports/fakes/objects';
import { memoryRateLimiter } from '../../_shared/src/ports/fakes/ratelimit';
import cronHeartbeat0003 from '../../platform/migrations/0003_cron_heartbeat.sql?raw';
import feedback0025 from '../../platform/migrations/0025_feedback.sql?raw';
import type { Env } from '../src/types';

export const FEEDBACK_SCHEMA: readonly string[] = [cronHeartbeat0003, feedback0025];

export interface Harness {
  env: Env;
  db: SqliteDb;
  bucket: MemoryObjects;
}

export function harness(over: Partial<Env> = {}): Harness {
  const db = new SqliteDb(FEEDBACK_SCHEMA);
  const bucket = memoryObjects();
  const env = {
    PLATFORM_DB: db,
    SCREENSHOTS: bucket,
    FEEDBACK_EDGE_LIMITER: memoryRateLimiter({ budget: 1000 }),
    JWKS_CACHE: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) },
    APP_ID: 'feedback',
    SUPABASE_URL: 'https://id.example.test',
    API_VERSION: 'v1',
    ALLOWED_ORIGINS: 'https://nikatru.com',
    INTAKE_OPEN: 'true',
    ...over,
  } as unknown as Env;
  return { env, db, bucket };
}

export const CTX = { waitUntil: (p: Promise<unknown>) => void p, passThroughOnException: () => {} };

/** A report body every check accepts; override one field to break one rule. */
export function validReport(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idempotencyKey: `key-${Math.random().toString(36).slice(2, 12)}`,
    appId: 'subscriptiontracker',
    surface: 'app',
    category: 'bug',
    description: 'The add button does nothing on the second tap.',
    steps: 'Open the app, tap add twice.',
    diagnostics: {
      appVersion: '1.4.0',
      build: '42',
      channel: 'web',
      platform: 'web',
      osVersion: 'Linux',
      deviceClass: 'desktop',
      locale: 'en-IN',
      textScale: 1,
      theme: 'dark',
      errorCodes: ['net.timeout', 'auth.refresh_failed'],
    },
    consent: { reply: false, notifyFixed: false },
    elapsedMs: 15_000,
    ...over,
  };
}

/** One PNG chunk: length, type, data, and a CRC the stripper does not read. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/** A 1×1 PNG carrying a tEXt chunk and an eXIf chunk that name the device. */
export function pngWithMetadata(): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const text = new TextEncoder().encode('Author\u0000Pixel 9 Pro of Asha');
  const exif = new TextEncoder().encode('MM\u0000*device-serial-XYZ');
  const idat = new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('tEXt', text), chunk('eXIf', exif), chunk('IDAT', idat), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function multipart(report: Record<string, unknown>, image?: Uint8Array, type = 'image/png'): FormData {
  const form = new FormData();
  form.set('report', JSON.stringify(report));
  if (image) form.set('screenshot', new Blob([image], { type }), 'screen.png');
  return form;
}
