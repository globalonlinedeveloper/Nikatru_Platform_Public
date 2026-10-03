// ─────────────────────────────────────────────────────────────────────────────
// box-manifest.ts — POST /v1/ops/box-manifest: a box reports the HASHES of its
// live config, so drift from the vendored copies is read, not guessed.
//
// PB-27 (O-JWKS-FALLBACK-LIVES-TEN-MINUTES folds O-BOX-CONFIG-OUTSIDE-THE-LANE).
// Box B and Box C have their compose, override and tunnel config applied over
// SSH and re-vendored by hand, and nothing compared the live files with the
// vendored copies. The box pushes; CI never SSHes in:
//   box cron (tooling/ops/boxes/post-config-manifest.sh)
//     → this route (one row per box, migrations/0025_box_config_manifest.sql)
//     → tooling/ops/check-box-config-drift.mjs in ops-watch, against the
//       vendored hashes in tooling/ops/box-config-vendored.json.
//
// ── 🔴 AUTHENTICATED BY A SECRET SCOPED TO ONE BOX ───────────────────────────
// `Authorization: Bearer <secret>`, compared with the secret of the box the
// body NAMES (BOX_MANIFEST_SECRET_BOXB / _BOXC, `wrangler secret put`). Box B's
// secret cannot write Box C's row: a box that is compromised can lie about its
// own config, which is the limit of any self-report, and nothing else. The
// comparison is over SHA-256 digests with `timingSafeEqual`, so neither the
// length nor a prefix of the secret is timed out of it. A box whose secret is
// not configured answers 503 BEFORE the body is read, as the money webhooks do.
//
// ── WHAT IT ACCEPTS ──────────────────────────────────────────────────────────
//   { "box": "boxc", "files": { "<logical name>": "<64 lowercase hex>", … } }
// Logical names are short slugs ("compose", "override", "tunnel"), never a
// path; a hash is a sha256. Nothing else is stored, and a file's content never
// leaves the box. NO CORS: a browser has no business here, so
// middleware/cors.ts refuses `Origin` on the `/v1/ops/` prefix.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { nowIso, run } from '../lib/d1';
import { readBoundedBody } from '../lib/body';
import { bearer } from '../../../_shared/src/auth';
import { isPlainObject } from '../../../_shared/src/validate';

const boxManifest = new Hono<AppEnv>();

/** The boxes that report, and the Worker secret each one authenticates with.
 *  A box not named here has no row to write. */
export const BOX_SECRET_ENV = {
  boxb: 'BOX_MANIFEST_SECRET_BOXB',
  boxc: 'BOX_MANIFEST_SECRET_BOXC',
} as const;
export type BoxId = keyof typeof BOX_SECRET_ENV;

/**
 * @ceiling none — a request-shape bound on a box's self-report, not a platform
 * resource. 32 files × (64-char name + 64-char hash + JSON punctuation) is well
 * under it; anything larger is not a manifest.
 */
export const BOX_MANIFEST_MAX_BYTES = 8_192;
/** @ceiling none — a request-shape bound, the file count one manifest may carry. */
export const BOX_MANIFEST_MAX_FILES = 32;

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isBox = (v: unknown): v is BoxId => typeof v === 'string' && Object.hasOwn(BOX_SECRET_ENV, v);

/** The manifest's `files`, validated and key-sorted, or null. */
export function parseBoxFiles(v: unknown): Record<string, string> | null {
  if (!isPlainObject(v)) return null;
  const entries = Object.entries(v);
  if (entries.length === 0 || entries.length > BOX_MANIFEST_MAX_FILES) return null;
  for (const [name, hash] of entries) {
    if (!NAME.test(name) || typeof hash !== 'string' || !SHA256.test(hash)) return null;
  }
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as Record<string, string>;
}

/** Constant-time equality of two secrets, over their SHA-256 digests so the
 *  compared buffers are always the same length. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

boxManifest.post('/ops/box-manifest', async (c) => {
  const log = `[box-manifest] rid=${c.get('requestId') ?? '-'}`;
  const read = await readBoundedBody(c.req.raw, BOX_MANIFEST_MAX_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }
  if (!isPlainObject(body) || !isBox(body.box)) return c.json({ error: 'unknown_box' }, 400);
  const box = body.box;

  const expected = c.env[BOX_SECRET_ENV[box]];
  if (typeof expected !== 'string' || expected === '') {
    console.error(`${log} box=${box} refused: ${BOX_SECRET_ENV[box]} is not configured`);
    return c.json({ error: 'not_configured' }, 503);
  }
  const given = bearer(c.req.header('Authorization') ?? '');
  if (given === null || !(await sameSecret(given, expected))) {
    console.warn(`${log} box=${box} refused: the bearer is not this box's secret`);
    return c.json({ error: 'unauthorized' }, 401);
  }

  const files = parseBoxFiles(body.files);
  if (files === null) return c.json({ error: 'bad_manifest' }, 400);

  // An upsert of the whole row: re-sending the same post changes nothing, so the
  // kit's transient retry is safe here.
  await run(
    c.env.PLATFORM_DB.prepare(
      `INSERT INTO box_config_manifest (box, manifest, posted_at) VALUES (?, ?, ?)
       ON CONFLICT(box) DO UPDATE SET manifest = excluded.manifest, posted_at = excluded.posted_at`,
    ).bind(box, JSON.stringify(files), nowIso()),
  );
  console.log(`${log} box=${box} files=${Object.keys(files).length} recorded`);
  return c.body(null, 204);
});

export default boxManifest;
