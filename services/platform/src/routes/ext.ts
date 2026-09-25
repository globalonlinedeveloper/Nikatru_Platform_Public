// ─────────────────────────────────────────────────────────────────────────────
// THE BROWSER EXTENSION'S ACCOUNT CHECK — three routes, one credential.
//
// ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT (design §3.2 flow, §3.4
// server). ADR 059 D10 names one route the extension calls (GET
// /v1/entitlements); D7 sets revocation per session. The extension never holds a
// Supabase session. Instead:
//
//   POST /v1/ext/codes   JWT (platformAuth). The signed-in page
//                        https://nikatru.com/ext/connect mints a 120-second,
//                        single-use code bound to {product, channel,
//                        redirect_uri, code_challenge}. Answers {code,
//                        redirect_uri}, where redirect_uri is the REGISTER's
//                        value (lib/ext-redirects.ts) — the page navigates only
//                        there, never to a URL read from its own query string.
//   POST /v1/ext/token   NO AUTH, behind EXT_TOKEN_CEILING_LIMITER. The
//                        extension exchanges {code, code_verifier, redirect_uri}
//                        for {token, link_id}. The token (`nkx1_…`) is
//                        returned ONCE and only its SHA-256 is stored.
//   POST /v1/ext/revoke  the device credential (extDeviceAuth). Revokes the
//                        CALLING device only.
//
// 🔴 EACH ROUTE CARRIES ITS AUTH AT THE HANDLER, NOT THROUGH `app.use`. A
// handler-level middleware cannot leak onto a sibling path — which is exactly how
// /v1/entitlements/subject was once left unauthenticated (index.ts records it).
//
// ── THE CODE (every rule has a test in test/ext-auth.test.ts) ────────────────
//   · 128 random bits, base64url; stored as SHA-256 (`code_hash`), never itself.
//   · Single-use by ONE atomic statement — the UPDATE below succeeds for exactly
//     one caller, so two concurrent exchanges yield exactly one credential.
//   · Valid iff now < expires_at, with expires_at = created_at + 120 000 ms from
//     ONE clock read, both ISO-8601 TEXT (the ext_devices migration's header: an
//     integer here would be swept alive and never be exchangeable).
//   · PKCE S256 only; `plain` is refused; the verifier is 43-128 characters of
//     the RFC 7636 §4.1 unreserved set.
//   · redirect_uri must equal the stored value BYTE FOR BYTE — no normalisation,
//     no prefix match, no trailing-slash leniency.
//   · Every exchange failure answers the SAME body, so nothing tells expired
//     from reused from mismatched.
//
// ── NOTHING SECRET IS EVER PRINTED ───────────────────────────────────────────
// No code, verifier or credential reaches a log line, an error body, a URL or
// the error sink: the only values logged are the request id and a fixed reason.
// test/ext-auth.test.ts captures every console call across a full mint,
// exchange, read, revoke and re-read and fails if one appears.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { platformAuth } from '../middleware/auth';
import { EXT_TOKEN_PREFIX, deviceBearer, extDeviceAuth, sha256Hex } from '../middleware/ext-device-auth';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { readBoundedBody } from '../lib/body';
import { extensionRedirectUri, isExtChannel } from '../lib/ext-redirects';

const ext = new Hono<AppEnv>();

/** The one product whose extension this account check serves (ADR 059 D10). */
export const EXT_PRODUCTS = ['fullshot'] as const;

/**
 * A code lives two minutes: long enough for the browser to hand the redirect
 * back to the extension, short enough that a code seen in a history entry is
 * dead by the time anyone reads it.
 *
 * @ceiling none — a credential lifetime we chose (design §3.4), not a platform resource.
 */
export const EXT_CODE_TTL_MS = 120000;

/**
 * Three short strings and a URL; 4 KiB holds them with room for the JSON.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_EXT_BODY_BYTES = 4096;

/** The one body every failed exchange gets — no oracle. */
const INVALID_GRANT = { error: 'invalid_grant' } as const;

/** RFC 7636 §4.1: 43-128 characters of [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~". */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** An S256 challenge is base64url(SHA-256(verifier)) without padding: 43 characters. */
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
/** A code as this file mints it: base64url of 16 bytes, 22 characters. */
const CODE_RE = /^[A-Za-z0-9_-]{22}$/;

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(nBytes: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(nBytes)));
}

/** base64url(SHA-256(verifier)) — the S256 transform, RFC 7636 §4.2. */
async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The JSON object body, or null for anything else (bad JSON, an array, oversize). */
async function objectBody(req: Request): Promise<Record<string, unknown> | null> {
  const read = await readBoundedBody(req, MAX_EXT_BODY_BYTES);
  if (!read.ok) return null;
  try {
    const v: unknown = JSON.parse(read.text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ext/codes — the signed-in page mints a code.
// ─────────────────────────────────────────────────────────────────────────────
ext.post('/ext/codes', platformAuth, async (c) => {
  c.header('Cache-Control', 'no-store');
  const b = await objectBody(c.req.raw);
  if (b === null) return c.json({ error: 'invalid_body' }, 400);

  if (typeof b.product !== 'string' || !(EXT_PRODUCTS as readonly string[]).includes(b.product)) {
    return c.json({ error: 'unknown_product' }, 400);
  }
  if (!isExtChannel(b.channel)) return c.json({ error: 'unknown_channel' }, 400);
  // 🔴 NULL REFUSES THE CHANNEL — the dark launch (lib/ext-redirects.ts).
  const registered = extensionRedirectUri(b.channel);
  if (registered === null) return c.json({ error: 'channel_not_enabled' }, 400);
  // Byte-for-byte: `===` on the two strings, nothing normalised first.
  if (typeof b.redirect_uri !== 'string' || b.redirect_uri !== registered) {
    return c.json({ error: 'redirect_uri_mismatch' }, 400);
  }
  // S256 only. The method field is optional; when present it must say S256.
  if (b.code_challenge_method !== undefined && b.code_challenge_method !== 'S256') {
    return c.json({ error: 'unsupported_code_challenge_method' }, 400);
  }
  if (typeof b.code_challenge !== 'string' || !CHALLENGE_RE.test(b.code_challenge)) {
    return c.json({ error: 'invalid_code_challenge' }, 400);
  }

  const code = randomToken(16);
  // ONE clock read for both instants, both ISO-8601 TEXT.
  const createdMs = Date.now();
  const createdAt = new Date(createdMs).toISOString();
  const expiresAt = new Date(createdMs + EXT_CODE_TTL_MS).toISOString();
  try {
    await c.env.PLATFORM_DB.prepare(
      'INSERT INTO ext_codes (code_hash, user_id, product, channel, redirect_uri, code_challenge, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(await sha256Hex(code), c.get('userId'), b.product, b.channel, registered, b.code_challenge, createdAt, expiresAt)
      .run();
  } catch {
    console.warn(`[ext] rid=${c.get('requestId') ?? '-'} code mint failed — 503`);
    return c.json({ error: 'service_unavailable' }, 503);
  }
  return c.json({ code, redirect_uri: registered });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ext/token — the extension exchanges the code for its credential.
// ─────────────────────────────────────────────────────────────────────────────
ext.post('/ext/token', async (c) => {
  c.header('Cache-Control', 'no-store');
  // The server-derived ceiling FIRST, before any parse or D1 read: this route has
  // no session, so the burst bound is the edge key (colo+asn), never an IP.
  if (!(await withinEdgeCeiling(c.env.EXT_TOKEN_CEILING_LIMITER, c, 'EXT_TOKEN_CEILING_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  const b = await objectBody(c.req.raw);
  if (
    b === null ||
    typeof b.code !== 'string' ||
    !CODE_RE.test(b.code) ||
    typeof b.code_verifier !== 'string' ||
    !VERIFIER_RE.test(b.code_verifier) ||
    typeof b.redirect_uri !== 'string'
  ) {
    return c.json(INVALID_GRANT, 400);
  }

  const codeHash = await sha256Hex(b.code);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  try {
    // 🔴 SINGLE USE BY ONE ATOMIC STATEMENT. It succeeds for exactly one caller
    // and only while the code is unexpired; everything after it compares a row
    // that can no longer be exchanged by anybody. A mismatched attempt therefore
    // BURNS the code — a stolen code without its verifier is worth one refusal.
    const claimed = await c.env.PLATFORM_DB.prepare(
      'UPDATE ext_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',
    )
      .bind(now, codeHash, now)
      .run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) return c.json(INVALID_GRANT, 400);

    const row = await c.env.PLATFORM_DB.prepare(
      'SELECT user_id, product, channel, redirect_uri, code_challenge FROM ext_codes WHERE code_hash = ?',
    )
      .bind(codeHash)
      .first<{ user_id: string; product: string; channel: string; redirect_uri: string; code_challenge: string }>();
    if (row === null) return c.json(INVALID_GRANT, 400);
    // Byte-for-byte, and the S256 transform of the verifier against the stored
    // challenge. Same body as every other failure.
    if (b.redirect_uri !== row.redirect_uri) return c.json(INVALID_GRANT, 400);
    if ((await s256(b.code_verifier)) !== row.code_challenge) return c.json(INVALID_GRANT, 400);

    const token = EXT_TOKEN_PREFIX + randomToken(32);
    const linkId = crypto.randomUUID();
    await c.env.PLATFORM_DB.prepare(
      'INSERT INTO ext_devices (link_id, user_id, product, channel, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
      .bind(linkId, row.user_id, row.product, row.channel, await sha256Hex(token), now)
      .run();
    return c.json({ token, link_id: linkId });
  } catch {
    console.warn(`[ext] rid=${c.get('requestId') ?? '-'} code exchange failed — 503`);
    return c.json({ error: 'service_unavailable' }, 503);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ext/revoke — the device revokes ITSELF, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
ext.post('/ext/revoke', extDeviceAuth, async (c) => {
  c.header('Cache-Control', 'no-store');
  // extDeviceAuth sets `userId` only, by design; the CALLING device is the one
  // whose credential this is, so it is named by that credential's hash.
  const token = deviceBearer(c);
  if (token === null) return c.json({ error: 'unauthorized' }, 401);
  try {
    await c.env.PLATFORM_DB.prepare(
      'UPDATE ext_devices SET revoked_at = ? WHERE token_hash = ? AND user_id = ? AND revoked_at IS NULL',
    )
      .bind(new Date().toISOString(), await sha256Hex(token), c.get('userId'))
      .run();
  } catch {
    console.warn(`[ext] rid=${c.get('requestId') ?? '-'} revoke failed — 503`);
    return c.json({ error: 'service_unavailable' }, 503);
  }
  return c.json({ revoked: true });
});

export default ext;
