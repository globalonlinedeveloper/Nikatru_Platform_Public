// ─────────────────────────────────────────────────────────────────────────────
// token-encryption.test.ts — THE PROVIDER REFRESH TOKENS ARE ENCRYPTED AT REST
// (⏱ 2026-09-30, review round 2, security: "provider refresh tokens are plain
// text in D1 and in every R2 backup").
//
// Against the REAL SQL engine with the REAL migrations (0023 included) and the
// real WebCrypto. WHAT IS BEING PROVEN, each the shape of a way this could be
// wrong:
//   · ROUND TRIP — a token stored is the token read, and the row holds
//     ciphertext, not the token; the same token written twice never stores the
//     same bytes (a fresh IV per write);
//   · 🔴 A WRONG KEY FAILS CLOSED — `unreadable`, a revoke `blocked`, the
//     provider never called, the row kept; an ABSENT key refuses the store;
//   · 🔴 A TAMPERED CIPHERTEXT FAILS — a flipped character, a truncation, and a
//     ciphertext moved to another row or relabelled (the row is the AAD);
//   · THE BACKFILL IS IDEMPOTENT AND RESUMABLE — bounded per run, a third run
//     changes no byte, a concurrent write is never overwritten, and the retired
//     0012 copies are copied before they are emptied;
//   · THE WINDOW DEFAULTS OFF — absent, malformed, past or too far ahead is
//     closed; and 🔴 THE GUARD: closed, no statement that reads the plain-text
//     column is ever prepared, and every SQL literal in src/ naming it is one
//     the store lists;
//   · 🔴 NO PLAIN TEXT IN A D1 DUMP — the backup dumper's output, for a database
//     holding tokens in every state, carries none, and its ciphertext decrypts.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, vi } from 'vitest';
import wranglerRaw from '../wrangler.jsonc?raw';
import {
  MAX_TOKEN_BACKFILL_PER_RUN,
  PLAINTEXT_WINDOW_MAX_DAYS,
  backfillProviderTokens,
  plaintextReadsOpen,
  putProviderToken,
  revokeAppleToken,
  revokeGoogleToken,
  storedProviderToken,
} from '../src/lib/provider-revoke';
import { CURRENT_TOKEN_KEY_ID, TOKEN_KEY_SECRETS, decryptToken, encryptToken, tokenKey } from '../src/lib/token-crypto';
import { CREDENTIAL_COLUMNS, dumpD1Database } from '../src/backup/dump';
import type { Env } from '../src/types';
import { realPlatformDb, TEST_TOKEN_ENC_KEY, type RealDb } from './harness';

const DAY_MS = 86_400_000;
/** `YYYY-MM-DD`, UTC, `days` from the real clock — the store reads Date.now(). */
const dayFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
/** A window that is open for every case in this file, whatever day it runs. */
const OPEN = dayFromNow(10);
/** A DIFFERENT valid key: 32 bytes of 0xAB. */
const OTHER_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 0xab)));

function envOf(db: RealDb, over: Record<string, unknown> = {}): Env {
  return {
    PLATFORM_DB: db,
    TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY,
    ...over,
  } as unknown as Env;
}

/** A row as a Worker older than 0023 left it: the token in clear, no ciphertext. */
function seedPlain(db: RealDb, subject: string, provider: 'apple' | 'google', token: string) {
  db.db
    .prepare('INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at) VALUES (?,?,?,?,?)')
    .run(subject, provider, 'subscriptiontracker', token, '2026-09-20T00:00:00.000Z');
}

/** A retired 0012 row (apple_provider_tokens), in clear as it always was. */
function seedLegacy(db: RealDb, subject: string, token: string) {
  db.db
    .prepare('INSERT INTO apple_provider_tokens (subject_ref, app_id, refresh_token, stored_at) VALUES (?,?,?,?)')
    .run(subject, 'subscriptiontracker', token, '2026-09-16T00:00:00.000Z');
}

const rowOf = (db: RealDb, subject: string, provider: string) =>
  db.rows('SELECT refresh_token, token_ct, token_key_id FROM provider_tokens WHERE subject_ref = ? AND provider = ?', subject, provider)[0];

/** Decrypt a stored row with the TEST key, independently of the store's read. */
async function decryptRow(db: RealDb, subject: string, provider: string): Promise<string | null> {
  const row = rowOf(db, subject, provider);
  const key = await tokenKey({ TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY }, String(row.token_key_id));
  if ('refused' in key) throw new Error(key.refused);
  return decryptToken(key.key, String(row.token_key_id), { subjectRef: subject, provider }, String(row.token_ct));
}

let googleCalls: URLSearchParams[] = [];
function stubGoogle(status = 200) {
  googleCalls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/revoke') {
      googleCalls.push(new URLSearchParams(String(init?.body ?? '')));
      return new Response(null, { status });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

function quiet() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 1. ROUND TRIP ───────────────────────────────────────────────────────────
describe('round trip — AES-256-GCM, a fresh IV per write, the row as authenticated data', () => {
  it('a token put is the token read, and the row holds ciphertext under key v1, never the token', async () => {
    const db = realPlatformDb();
    const env = envOf(db);
    await putProviderToken(env, 'user-1', 'google', 'subscriptiontracker', 'g-token-for-user-1', '2026-10-01T00:00:00.000Z');
    await putProviderToken(env, 'user-1', 'apple', 'subscriptiontracker', 'a-token-for-user-1', '2026-10-01T00:00:00.000Z');

    expect(await storedProviderToken(env, 'user-1', 'google')).toEqual({ kind: 'token', token: 'g-token-for-user-1', clientId: null });
    expect(await storedProviderToken(env, 'user-1', 'apple')).toEqual({ kind: 'token', token: 'a-token-for-user-1', clientId: null });
    expect(await storedProviderToken(env, 'user-2', 'google')).toEqual({ kind: 'none' });

    const row = rowOf(db, 'user-1', 'google');
    expect(row.refresh_token).toBe('');
    expect(row.token_key_id).toBe(CURRENT_TOKEN_KEY_ID);
    expect(String(row.token_ct)).not.toContain('g-token-for-user-1');
    // Decrypted independently of the store: the ciphertext IS the token under this key.
    expect(await decryptRow(db, 'user-1', 'google')).toBe('g-token-for-user-1');
  });

  it('the same token written twice, or for two subjects, never stores the same bytes', async () => {
    const db = realPlatformDb();
    const env = envOf(db);
    await putProviderToken(env, 'user-1', 'google', 'subscriptiontracker', 'same-token-value', '2026-10-01T00:00:00.000Z');
    const first = String(rowOf(db, 'user-1', 'google').token_ct);
    await putProviderToken(env, 'user-1', 'google', 'subscriptiontracker', 'same-token-value', '2026-10-02T00:00:00.000Z');
    const second = String(rowOf(db, 'user-1', 'google').token_ct);
    await putProviderToken(env, 'user-2', 'google', 'subscriptiontracker', 'same-token-value', '2026-10-01T00:00:00.000Z');
    const third = String(rowOf(db, 'user-2', 'google').token_ct);

    expect(new Set([first, second, third]).size).toBe(3);
    // The IV is the first 12 bytes — 16 base64url characters — and it differs too.
    expect(new Set([first, second, third].map((ct) => ct.slice(0, 16))).size).toBe(3);
    expect(await decryptRow(db, 'user-1', 'google')).toBe('same-token-value');
    expect(await decryptRow(db, 'user-2', 'google')).toBe('same-token-value');
  });

  it('the envelope carries any token the route accepts: 4096 characters, and non-ASCII', async () => {
    const got = await tokenKey({ TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY }, 'v1');
    if ('refused' in got) throw new Error(got.refused);
    const row = { subjectRef: 's', provider: 'google' };
    for (const token of ['x'.repeat(4096), 'tök€n-🔑-value']) {
      const sealed = await encryptToken(got.key, 'v1', row, token);
      expect(await decryptToken(got.key, 'v1', row, sealed)).toBe(token);
    }
  });

  it('the key is 32 bytes of STANDARD base64 — the shape `openssl rand -base64 32` prints — and nothing else', async () => {
    expect(TOKEN_KEY_SECRETS[CURRENT_TOKEN_KEY_ID]).toBe('TOKEN_ENC_KEY_V1');
    expect(TEST_TOKEN_ENC_KEY).toHaveLength(44);
    expect('key' in (await tokenKey({ TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY }, 'v1'))).toBe(true);
    expect('key' in (await tokenKey({ TOKEN_ENC_KEY_V1: ` ${TEST_TOKEN_ENC_KEY}\n` }, 'v1')), 'surrounding whitespace is tolerated').toBe(true);
    for (const bad of [undefined, '', btoa('sixteen-byte-key'), btoa('x'.repeat(48)), TEST_TOKEN_ENC_KEY.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '!']) {
      expect('refused' in (await tokenKey({ TOKEN_ENC_KEY_V1: bad }, 'v1')), `key ${JSON.stringify(bad)}`).toBe(true);
    }
    expect(await tokenKey({ TOKEN_ENC_KEY_V1: undefined }, 'v1')).toMatchObject({ refused: 'the Worker secret TOKEN_ENC_KEY_V1 is not set', absent: true });
  });
});

// ── 2. A WRONG KEY FAILS CLOSED ─────────────────────────────────────────────
describe('🔴 a wrong or absent key fails CLOSED', () => {
  it('another valid key reads `unreadable`, and the revoke is blocked: Google is never called and the row is kept', async () => {
    quiet();
    const db = realPlatformDb();
    await putProviderToken(envOf(db), 'user-g', 'google', 'subscriptiontracker', 'g-live-token-value', '2026-10-01T00:00:00.000Z');
    const wrong = envOf(db, { TOKEN_ENC_KEY_V1: OTHER_KEY });

    const read = await storedProviderToken(wrong, 'user-g', 'google');
    expect(read.kind).toBe('unreadable');

    stubGoogle();
    const outcome = await revokeGoogleToken(wrong, 'user-g', 'rid-wrong');
    expect(outcome.kind).toBe('blocked');
    expect(googleCalls, 'nothing is revoked with a value nobody authenticated').toEqual([]);
    expect(db.count('provider_tokens', 'subject_ref = ?', 'user-g'), 'the row is kept for the right key').toBe(1);

    // GREEN CONTROL: the same row, the right key — it is the key that decided.
    expect(await storedProviderToken(envOf(db), 'user-g', 'google')).toEqual({ kind: 'token', token: 'g-live-token-value', clientId: null });
    expect(await revokeGoogleToken(envOf(db), 'user-g', 'rid-right')).toEqual({ kind: 'revoked' });
    expect(googleCalls.map((b) => b.get('token'))).toEqual(['g-live-token-value']);
  });

  it('an ABSENT key: the read names the secret, the Apple revoke is blocked before any credential is looked at, and a store throws', async () => {
    quiet();
    const db = realPlatformDb();
    await putProviderToken(envOf(db), 'user-a', 'apple', 'subscriptiontracker', 'a-live-token-value', '2026-10-01T00:00:00.000Z');
    const keyless = envOf(db, { TOKEN_ENC_KEY_V1: undefined });

    expect(await storedProviderToken(keyless, 'user-a', 'apple')).toEqual({
      kind: 'unreadable',
      why: 'the Worker secret TOKEN_ENC_KEY_V1 is not set',
    });
    stubGoogle();
    expect(await revokeAppleToken(keyless, 'user-a', 'rid-keyless')).toEqual({
      kind: 'blocked',
      why: 'stored token unreadable: the Worker secret TOKEN_ENC_KEY_V1 is not set',
    });
    await expect(
      putProviderToken(keyless, 'user-b', 'google', 'subscriptiontracker', 'g-token-value', '2026-10-01T00:00:00.000Z'),
    ).rejects.toThrow(/refusing to store a google token: the Worker secret TOKEN_ENC_KEY_V1 is not set/);
    expect(db.count('provider_tokens', 'subject_ref = ?', 'user-b'), 'refused means NO row, not a plain-text one').toBe(0);
  });

  it('the refusal never logs the token, the ciphertext or the key', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')));
    const db = realPlatformDb();
    await putProviderToken(envOf(db), 'user-g', 'google', 'subscriptiontracker', 'g-secret-token-value', '2026-10-01T00:00:00.000Z');
    stubGoogle();
    await revokeGoogleToken(envOf(db, { TOKEN_ENC_KEY_V1: OTHER_KEY }), 'user-g', 'rid-log');
    const logged = lines.join('\n');
    expect(logged).toContain('REFUSING to revoke');
    for (const secret of ['g-secret-token-value', String(rowOf(db, 'user-g', 'google').token_ct), TEST_TOKEN_ENC_KEY, OTHER_KEY]) {
      expect(logged).not.toContain(secret);
    }
  });
});

// ── 3. A TAMPERED CIPHERTEXT FAILS ──────────────────────────────────────────
describe('🔴 a tampered ciphertext fails', () => {
  async function sealedPair() {
    const db = realPlatformDb();
    const env = envOf(db);
    await putProviderToken(env, 'user-1', 'google', 'subscriptiontracker', 'g-token-one', '2026-10-01T00:00:00.000Z');
    await putProviderToken(env, 'user-2', 'google', 'subscriptiontracker', 'g-token-two', '2026-10-01T00:00:00.000Z');
    await putProviderToken(env, 'user-1', 'apple', 'subscriptiontracker', 'a-token-one', '2026-10-01T00:00:00.000Z');
    return { db, env };
  }
  const setCt = (db: RealDb, subject: string, provider: string, ct: string, keyId = 'v1') =>
    db.db.prepare('UPDATE provider_tokens SET token_ct = ?, token_key_id = ? WHERE subject_ref = ? AND provider = ?').run(ct, keyId, subject, provider);

  it('one changed character — in the IV, the body or the tag — reads `unreadable`', async () => {
    const { db, env } = await sealedPair();
    const ct = String(rowOf(db, 'user-1', 'google').token_ct);
    for (const at of [0, 5, 16, Math.floor(ct.length / 2), ct.length - 2]) {
      const flipped = ct.slice(0, at) + (ct[at] === 'A' ? 'B' : 'A') + ct.slice(at + 1);
      setCt(db, 'user-1', 'google', flipped);
      const read = await storedProviderToken(env, 'user-1', 'google');
      expect(read.kind, `character ${at} changed`).toBe('unreadable');
    }
    // GREEN CONTROL: the original bytes put back read again.
    setCt(db, 'user-1', 'google', ct);
    expect(await storedProviderToken(env, 'user-1', 'google')).toEqual({ kind: 'token', token: 'g-token-one', clientId: null });
  });

  it('a truncated value, an empty one and one that is not base64url read `unreadable`', async () => {
    const { db, env } = await sealedPair();
    const ct = String(rowOf(db, 'user-1', 'google').token_ct);
    for (const bad of [ct.slice(0, -4), ct.slice(0, 20), '', 'not base64url!', `${ct}AA`]) {
      setCt(db, 'user-1', 'google', bad);
      expect((await storedProviderToken(env, 'user-1', 'google')).kind, JSON.stringify(bad.slice(0, 24))).toBe('unreadable');
    }
  });

  it('a ciphertext MOVED to another subject\'s row, or to another provider\'s, does not decrypt — the row is the AAD', async () => {
    const { db, env } = await sealedPair();
    const userTwos = String(rowOf(db, 'user-2', 'google').token_ct);
    const userOnesGoogle = String(rowOf(db, 'user-1', 'google').token_ct);
    setCt(db, 'user-1', 'google', userTwos);
    expect((await storedProviderToken(env, 'user-1', 'google')).kind, "user-2's token under user-1").toBe('unreadable');
    setCt(db, 'user-1', 'apple', userOnesGoogle);
    expect((await storedProviderToken(env, 'user-1', 'apple')).kind, 'a Google token relabelled Apple').toBe('unreadable');
    // And user-2's own row, untouched, still reads: the refusal is the move, not the bytes.
    expect(await storedProviderToken(env, 'user-2', 'google')).toEqual({ kind: 'token', token: 'g-token-two', clientId: null });
  });

  it('a relabelled key id reads `unreadable`: an unknown id names no secret, and never falls back to v1', async () => {
    const { db, env } = await sealedPair();
    const ct = String(rowOf(db, 'user-1', 'google').token_ct);
    setCt(db, 'user-1', 'google', ct, 'v2');
    expect(await storedProviderToken(env, 'user-1', 'google')).toEqual({
      kind: 'unreadable',
      why: 'no secret is declared for token key id "v2"',
    });
  });
});

// ── 4. THE BACKFILL ─────────────────────────────────────────────────────────
describe('the backfill — idempotent, resumable, bounded, window-bound', () => {
  const snapshot = (db: RealDb) => ({
    live: db.rows('SELECT * FROM provider_tokens ORDER BY subject_ref, provider'),
    legacy: db.rows('SELECT * FROM apple_provider_tokens ORDER BY subject_ref'),
  });

  it('seals every plain-text row at most MAX_TOKEN_BACKFILL_PER_RUN a run, and a third run changes NO byte', async () => {
    const db = realPlatformDb();
    const env = envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN });
    const total = MAX_TOKEN_BACKFILL_PER_RUN + 5;
    for (let i = 0; i < total; i++) seedPlain(db, `user-${String(i).padStart(3, '0')}`, i % 2 ? 'apple' : 'google', `token-value-${i}`);

    const first = await backfillProviderTokens(env);
    expect(first.ok, 'rows are left: the run is not done').toBe(false);
    expect(first.detail).toContain(`sealed=${MAX_TOKEN_BACKFILL_PER_RUN} `);
    expect(first.detail).toContain('plaintext_left=5 ');
    expect(db.count('provider_tokens', "refresh_token <> ''")).toBe(5);

    const second = await backfillProviderTokens(env);
    expect(second).toMatchObject({ ok: true, target: 'provider_tokens' });
    expect(second.detail).toContain('sealed=5 ');
    expect(second.detail).toContain('plaintext_left=0 plaintext_left_0012=0 unsealed=0');

    const settled = snapshot(db);
    const third = await backfillProviderTokens(env);
    expect(third.ok).toBe(true);
    expect(third.detail).toContain('sealed=0 raced=0 copied_0012=0 emptied_0012=0');
    expect(snapshot(db), 'IDEMPOTENT: not one byte of any row moved').toEqual(settled);

    for (let i = 0; i < total; i++) {
      const subject = `user-${String(i).padStart(3, '0')}`;
      const provider = i % 2 ? 'apple' : 'google';
      expect(rowOf(db, subject, provider).refresh_token).toBe('');
      expect(await decryptRow(db, subject, provider), subject).toBe(`token-value-${i}`);
    }
  });

  it('the retired 0012 rows: a row with no copy is COPIED, then every 0012 row is emptied; nothing is lost', async () => {
    const db = realPlatformDb();
    const env = envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN });
    // The state 0016 left: user-a copied into provider_tokens, and user-late
    // stored by the OLD Worker in the deploy window, so present in 0012 only.
    seedLegacy(db, 'user-a', 'a-copied-token');
    seedPlain(db, 'user-a', 'apple', 'a-copied-token');
    seedLegacy(db, 'user-late', 'a-late-token');

    const run = await backfillProviderTokens(env);
    expect(run.ok).toBe(true);
    expect(run.detail).toContain('sealed=2 raced=0 copied_0012=1 emptied_0012=2');
    expect(await decryptRow(db, 'user-late', 'apple'), 'the 0012-only token survives, sealed').toBe('a-late-token');
    expect(await decryptRow(db, 'user-a', 'apple')).toBe('a-copied-token');
    expect(db.rows('SELECT subject_ref, refresh_token FROM apple_provider_tokens ORDER BY subject_ref')).toEqual([
      { subject_ref: 'user-a', refresh_token: '' },
      { subject_ref: 'user-late', refresh_token: '' },
    ]);
  });

  it('a row sealed by a NEWER write between the read and the seal is not overwritten (the seal is conditional)', async () => {
    const db = realPlatformDb();
    const env = envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN });
    seedPlain(db, 'user-r', 'google', 'g-old-plain-token');
    // The engine as the backfill sees it, except that a sign-in lands the moment
    // the backfill asks to seal: the route stores a NEWER token, encrypted.
    let raced = false;
    const racing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== 'prepare') return Reflect.get(target, prop, receiver);
        return (sql: string) => {
          if (!raced && /^UPDATE provider_tokens SET token_ct/.test(sql)) {
            raced = true;
            return {
              bind: (...args: unknown[]) => ({
                run: async () => {
                  await putProviderToken(envOf(db), 'user-r', 'google', 'subscriptiontracker', 'g-new-sealed-token', '2026-10-01T00:00:00.000Z');
                  return target.prepare(sql).bind(...args).run();
                },
              }),
            };
          }
          return target.prepare(sql);
        };
      },
    });
    const run = await backfillProviderTokens(envOf(racing as RealDb, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN }));
    expect(raced).toBe(true);
    expect(run.detail).toContain('sealed=0 raced=1 ');
    expect(await decryptRow(db, 'user-r', 'google'), 'the newer token stands').toBe('g-new-sealed-token');
    expect(run.ok).toBe(true);
    expect(await storedProviderToken(env, 'user-r', 'google')).toEqual({ kind: 'token', token: 'g-new-sealed-token', clientId: null });
  });

  it('🔴 NO KEY: REFUSED, red, naming the secret — and not one row touched', async () => {
    const db = realPlatformDb();
    seedPlain(db, 'user-1', 'google', 'g-plain-token');
    seedLegacy(db, 'user-2', 'a-legacy-token');
    const before = snapshot(db);
    for (const key of [undefined, 'malformed']) {
      const run = await backfillProviderTokens(envOf(db, { TOKEN_ENC_KEY_V1: key, PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN }));
      expect(run.ok).toBe(false);
      expect(run.detail).toMatch(/^REFUSED, nothing touched: the Worker secret TOKEN_ENC_KEY_V1 is not/);
    }
    expect(snapshot(db)).toEqual(before);
  });

  it('WINDOW CLOSED: nothing is sealed, and the row is red while any token row has no ciphertext, green once none has', async () => {
    const db = realPlatformDb();
    seedPlain(db, 'user-1', 'google', 'g-plain-token');
    const closed = envOf(db);
    const before = snapshot(db);
    const red = await backfillProviderTokens(closed);
    expect(red.ok).toBe(false);
    expect(red.detail).toContain('plain-text window closed with 1 row(s) never sealed');
    expect(snapshot(db), 'closed means the plain text is not even read, so not sealed').toEqual(before);

    await backfillProviderTokens(envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN }));
    expect(await backfillProviderTokens(closed)).toEqual({
      target: 'provider_tokens',
      ok: true,
      detail: 'plain-text window closed; every token row is sealed',
    });
  });

  it('inside the window a row the backfill has not reached is still revocable — and after it, revoked from ciphertext', async () => {
    quiet();
    const db = realPlatformDb();
    const env = envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN });
    seedPlain(db, 'user-1', 'google', 'g-plain-token-1');
    seedPlain(db, 'user-2', 'google', 'g-plain-token-2');
    stubGoogle();
    expect(await revokeGoogleToken(env, 'user-1', 'rid-1')).toEqual({ kind: 'revoked' });
    await backfillProviderTokens(env);
    expect(rowOf(db, 'user-2', 'google').refresh_token).toBe('');
    // …and with the window CLOSED, the sealed row still revokes: nothing needs the plain text now.
    expect(await revokeGoogleToken(envOf(db), 'user-2', 'rid-2')).toEqual({ kind: 'revoked' });
    expect(googleCalls.map((b) => b.get('token'))).toEqual(['g-plain-token-1', 'g-plain-token-2']);
  });

  it('WINDOW CLOSED and a row never sealed: the revoke is BLOCKED, never revoked from plain text', async () => {
    quiet();
    const db = realPlatformDb();
    seedPlain(db, 'user-1', 'google', 'g-plain-token');
    stubGoogle();
    expect(await revokeGoogleToken(envOf(db), 'user-1', 'rid')).toEqual({
      kind: 'blocked',
      why: 'stored token unreadable: the stored google token is not encrypted yet and the plain-text read window is closed',
    });
    expect(googleCalls).toEqual([]);
  });
});

// ── 5. THE WINDOW, AND THE GUARD THAT NOTHING READS PLAIN TEXT ONCE IT CLOSES ─
describe('the plain-text read window defaults OFF', () => {
  const at = Date.parse('2026-10-10T12:00:00Z');
  const open = (v: unknown) => plaintextReadsOpen({ PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: v as string }, at);

  it('absent, empty, malformed, past, today and too far ahead are CLOSED; a near date is open', () => {
    for (const closed of [undefined, '', 'yes', 'true', '2026-10-10T23:00:00Z', '2026/10/20', '2026-13-01', '2026-10-10', '2026-10-01', '2099-01-01']) {
      expect(open(closed), JSON.stringify(closed)).toBe(false);
    }
    expect(open('2026-10-11')).toBe(true);
    expect(open('2026-11-01')).toBe(true);
    // The cap is PLAINTEXT_WINDOW_MAX_DAYS from NOW: one day past it is closed.
    const edge = new Date(at + PLAINTEXT_WINDOW_MAX_DAYS * DAY_MS).toISOString().slice(0, 10);
    const past = new Date(at + (PLAINTEXT_WINDOW_MAX_DAYS + 1) * DAY_MS).toISOString().slice(0, 10);
    expect(open(edge)).toBe(true);
    expect(open(past)).toBe(false);
  });

  it('the committed value is a date the window can read — a malformed one would close it before the first backfill', () => {
    const declared = [...wranglerRaw.matchAll(/"PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL":\s*"([^"]*)"/g)].map((m) => m[1]);
    // ONE declaration: the top level's. The sandbox's database never held plain text.
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isFinite(Date.parse(`${declared[0]}T00:00:00Z`))).toBe(true);
  });
});

/** Every string literal in a TypeScript source, with its line. Throws — which
 *  fails the census as COVERAGE LOST — the moment the scan is out of step: a
 *  quoted string may not cross a line in TypeScript, so one that seems to has
 *  been mis-read (a regex literal holding a quote is the known way). */
function stringLiterals(src: string, file: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let i = 0;
  let line = 1;
  const lost = (why: string): never => {
    throw new Error(`COVERAGE LOST — ${file}:${line}: ${why}; the census cannot vouch for this file`);
  };
  function code(untilBrace: boolean): void {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '\n') { line++; i++; continue; }
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) lost('an unterminated block comment');
        line += (src.slice(i, end).match(/\n/g) ?? []).length;
        i = end + 2;
        continue;
      }
      if (c === "'" || c === '"') { quoted(c); continue; }
      if (c === '`') { template(); continue; }
      if (c === '/' && startsRegex()) { regex(); continue; }
      if (untilBrace && c === '{') depth++;
      if (untilBrace && c === '}') {
        if (depth === 0) { i++; return; }
        depth--;
      }
      i++;
    }
    if (untilBrace) lost('an unterminated ${…}');
  }
  /** A `/` opens a regex literal, not a division, where an expression is
   *  expected: after an operator or opening punctuation, a keyword that takes
   *  an expression, or at the start of the source. */
  function startsRegex(): boolean {
    let j = i - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0) return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(src[j])) return true;
    const word = /[A-Za-z_$]+$/.exec(src.slice(Math.max(0, j - 10), j + 1))?.[0];
    return word !== undefined && ['return', 'typeof', 'case', 'in', 'of', 'void', 'throw', 'delete', 'new'].includes(word);
  }
  /** Skip a regex literal: to the `/` outside a character class, then its flags. */
  function regex(): void {
    let inClass = false;
    i++;
    for (;;) {
      if (i >= src.length || src[i] === '\n') lost('a regex literal that crosses a line');
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { i++; break; }
      i++;
    }
    while (i < src.length && /[a-z]/.test(src[i])) i++;
  }
  function quoted(q: string): void {
    const start = line;
    let text = '';
    i++;
    for (;;) {
      if (i >= src.length) lost(`an unterminated ${q}-string`);
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '\n') lost(`a ${q}-string that crosses a line`);
      if (c === q) { i++; break; }
      text += c;
      i++;
    }
    out.push({ text, line: start });
  }
  function template(): void {
    const start = line;
    let text = '';
    i++;
    for (;;) {
      if (i >= src.length) lost('an unterminated template literal');
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') { text += '${…}'; i += 2; code(true); continue; }
      if (c === '\n') line++;
      text += c;
      i++;
    }
    out.push({ text, line: start });
  }
  code(false);
  return out;
}

const SOURCES = import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true });
const SHARED_SOURCES = import.meta.glob('../../_shared/src/**/*.ts', { query: '?raw', import: 'default', eager: true });
const NAMES_COLUMN = /(?<![A-Za-z0-9_])refresh_token(?![A-Za-z0-9_])/;
const IS_SQL = /\b(SELECT|INSERT|UPDATE|DELETE|WHERE)\b/i;
/** Whitespace-normalised: a reflowed template literal is not a new statement. */
const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();

/**
 * 🔴 PINNED HERE, NOT EXPORTED BY THE STORE: every statement in src/ that READS
 * the plain-text column (selects it, or filters on it). Each must be prepared
 * only while the window is open — the runtime cases below prove it for every
 * one. A NEW statement naming the column fails the census until it is added to
 * one of these two lists, which is the moment a reviewer asks "is it gated?".
 * (The store inlines its SQL at each `.prepare(` because assert-d1-sql-inventory
 * must read it there, so this list is the one other copy — and the census fails
 * the moment the two disagree.)
 */
const READING_SQL = [
  'SELECT token_ct, token_key_id, client_id, refresh_token FROM provider_tokens WHERE subject_ref = ? AND provider = ?',
  "INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, stored_at) SELECT subject_ref, 'apple', app_id, refresh_token, stored_at FROM apple_provider_tokens WHERE refresh_token <> '' ON CONFLICT (subject_ref, provider) DO NOTHING",
  "UPDATE apple_provider_tokens SET refresh_token = '' WHERE refresh_token <> '' AND EXISTS (SELECT 1 FROM provider_tokens p WHERE p.subject_ref = apple_provider_tokens.subject_ref AND p.provider = 'apple')",
  "SELECT subject_ref, provider, refresh_token FROM provider_tokens WHERE refresh_token <> '' ORDER BY subject_ref, provider LIMIT ?",
  "UPDATE provider_tokens SET token_ct = ?, token_key_id = ?, refresh_token = '' WHERE subject_ref = ? AND provider = ? AND refresh_token = ?",
  "SELECT (SELECT COUNT(*) FROM provider_tokens WHERE refresh_token <> '') AS live, (SELECT COUNT(*) FROM apple_provider_tokens WHERE refresh_token <> '') AS legacy, (SELECT COUNT(*) FROM provider_tokens WHERE token_ct IS NULL) AS unsealed",
];
/** PINNED: the one other statement naming it — a write of the literal ''. */
const EMPTYING_SQL = [
  "INSERT INTO provider_tokens (subject_ref, provider, app_id, refresh_token, token_ct, token_key_id, client_id, stored_at) VALUES (?,?,?,'',?,?,?,?) ON CONFLICT (subject_ref, provider) DO UPDATE SET app_id = excluded.app_id, refresh_token = '', token_ct = excluded.token_ct, token_key_id = excluded.token_key_id, client_id = excluded.client_id, stored_at = excluded.stored_at",
];

describe('🔴 THE GUARD — once the window is closed, no plain-text column is read', () => {
  /** Drive every code path that touches a token, then return the SQL prepared. */
  async function everyPath(windowUntil: string | undefined): Promise<string[]> {
    quiet();
    const db = realPlatformDb();
    seedPlain(db, 'user-plain', 'google', 'g-plain-token');
    seedLegacy(db, 'user-legacy', 'a-legacy-token');
    const env = envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: windowUntil });
    db.sql.length = 0;
    await putProviderToken(env, 'user-sealed', 'google', 'subscriptiontracker', 'g-sealed-token', '2026-10-01T00:00:00.000Z');
    await storedProviderToken(env, 'user-sealed', 'google');
    await storedProviderToken(env, 'user-plain', 'google');
    stubGoogle();
    await revokeGoogleToken(env, 'user-plain', 'rid');
    await revokeGoogleToken(env, 'user-sealed', 'rid');
    await revokeAppleToken(env, 'user-legacy', 'rid');
    await backfillProviderTokens(env);
    return [...db.sql];
  }

  it('CLOSED: across put, read, both revokes and the backfill, no statement that reads `refresh_token` is prepared', async () => {
    const prepared = await everyPath(undefined);
    expect(prepared.length, 'COVERAGE: the paths ran and the engine logged them').toBeGreaterThan(5);
    expect(prepared.filter((sql) => READING_SQL.includes(norm(sql)))).toEqual([]);
    // Stronger than the list: every statement naming the column at all is the one that EMPTIES it.
    expect(prepared.filter((sql) => NAMES_COLUMN.test(sql) && !EMPTYING_SQL.includes(norm(sql)))).toEqual([]);
    expect(prepared.some((sql) => EMPTYING_SQL.includes(norm(sql))), 'COVERAGE: the put ran and was logged').toBe(true);
  });

  it('RED CONTROL: OPEN, the same paths DO prepare the reading statements — so the closed case is not vacuous', async () => {
    const prepared = await everyPath(OPEN);
    const reading = new Set(prepared.map(norm).filter((sql) => READING_SQL.includes(sql)));
    expect([...reading].sort(), 'every pinned reading statement is reachable, and was reached').toEqual([...READING_SQL].sort());
  });

  it('CENSUS: every SQL literal in src/ that names `refresh_token` is one the store lists — reading (window-gated) or emptying', () => {
    const files = { ...SOURCES, ...SHARED_SOURCES };
    // COVERAGE: the glob reached the tree, and reached the store itself.
    expect(Object.keys(files).length).toBeGreaterThan(40);
    expect(Object.keys(files).some((f) => f.endsWith('/src/lib/provider-revoke.ts'))).toBe(true);
    const listed = new Set([...READING_SQL, ...EMPTYING_SQL]);
    const found = new Set<string>();
    const offenders: string[] = [];
    let literals = 0;
    for (const [file, src] of Object.entries(files)) {
      for (const lit of stringLiterals(src, file)) {
        literals++;
        if (!NAMES_COLUMN.test(lit.text) || !IS_SQL.test(lit.text)) continue;
        const text = norm(lit.text);
        // ONE HOME: the store module is the only file allowed to name the column in SQL at all.
        if (listed.has(text) && file.endsWith('/src/lib/provider-revoke.ts')) found.add(text);
        else offenders.push(`${file}:${lit.line} ${text.slice(0, 140)}`);
      }
    }
    expect(literals, 'COVERAGE: the scan read string literals').toBeGreaterThan(1000);
    expect(
      offenders,
      'SQL naming the plain-text column that the store does not list. Every read of it must be in ' +
        'PLAINTEXT_READING_SQL and prepared only while plaintextReadsOpen; every write must empty it.',
    ).toEqual([]);
    // COVERAGE, the other direction: every listed statement was found in the
    // source as a literal, so the scan really read the store (and no entry is dead).
    expect([...found].sort()).toEqual([...listed].sort());
  });

  it('the pinned emptying write really writes the literal \'\' — never a bound value — on insert and on conflict', () => {
    for (const sql of EMPTYING_SQL) {
      const m = /^INSERT INTO \w+ \(([^)]*)\) VALUES \(([^)]*)\)/.exec(sql);
      expect(m, 'an INSERT … VALUES the check can read').not.toBeNull();
      const cols = (m as RegExpExecArray)[1].split(',').map((t) => t.trim());
      const vals = (m as RegExpExecArray)[2].split(',').map((t) => t.trim());
      expect(cols).toHaveLength(vals.length);
      expect(vals[cols.indexOf('refresh_token')]).toBe("''");
      const rest = sql.slice((m as RegExpExecArray)[0].length).replace(/refresh_token = ''/g, '');
      expect(rest, 'no other mention: the conflict branch empties it too').not.toMatch(NAMES_COLUMN);
    }
  });

  it('the census scanner REDS on an unlisted read — its own red control, over a fixture', () => {
    const fixture = [
      "const ok = 'refresh_token';  // a form-field value, not SQL",
      "const bad = db.prepare('SELECT refresh_token FROM provider_tokens WHERE subject_ref = ?');",
      '// SELECT refresh_token FROM provider_tokens  (prose in a comment is not code)',
      'const tpl = `UPDATE provider_tokens SET refresh_token = ${x} WHERE subject_ref = ?`;',
    ].join('\n');
    const hits = stringLiterals(fixture, 'fixture.ts').filter((l) => NAMES_COLUMN.test(l.text) && IS_SQL.test(l.text));
    expect(hits.map((h) => h.line)).toEqual([2, 4]);
    // A regex literal holding a quote is skipped as a regex, and a division is not
    // mistaken for one; a string that still seems to cross a line is COVERAGE LOST.
    expect(stringLiterals("const r = /'/;\nconst s = 'x';", 'regex.ts').map((l) => l.text)).toEqual(['x']);
    expect(stringLiterals("const h = a / 2; const q = b / c; const s = 'y';", 'div.ts').map((l) => l.text)).toEqual(['y']);
    expect(() => stringLiterals("const s = 'x\nconst t = 1;", 'broken.ts')).toThrow(/COVERAGE LOST/);
  });
});

// ── 6. R2 BACKUPS CARRY CIPHERTEXT ONLY ─────────────────────────────────────
describe('🔴 no plain text in a D1 dump — the nightly R2 backup carries ciphertext only', () => {
  const PLAIN = ['a-plain-token-BBBB', 'a-legacy-only-CCCC'];

  async function fixture() {
    const db = realPlatformDb();
    // Every state a token can be in on the night after this deploys:
    await putProviderToken(envOf(db), 'user-A', 'google', 'subscriptiontracker', 'g-sealed-token-AAAA', '2026-10-01T00:00:00.000Z');
    seedPlain(db, 'user-B', 'apple', 'a-plain-token-BBBB'); // stored before 0023
    seedLegacy(db, 'user-B', 'a-plain-token-BBBB'); // its retired 0012 copy
    seedLegacy(db, 'user-C', 'a-legacy-only-CCCC'); // 0012 only
    return db;
  }

  it('BEFORE the backfill: the dump withholds every plain-text value, and carries the sealed token as ciphertext that decrypts', async () => {
    const db = await fixture();
    const dump = await dumpD1Database(db as unknown as D1Database, 'platform_db', 1000, '2026-10-02T02:30:00.000Z');
    for (const token of [...PLAIN, 'g-sealed-token-AAAA']) expect(dump.jsonl, token).not.toContain(token);
    expect(dump.withheld).toBe(3);
    const lines = dump.jsonl.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.find((l) => l.kind === 'table-end' && l.table === 'provider_tokens')).toMatchObject({ withheld: 1 });
    expect(lines.find((l) => l.kind === 'table-end' && l.table === 'apple_provider_tokens')).toMatchObject({ withheld: 2 });
    // A RESTORE STILL WORKS: the sealed row's ciphertext is in the dump, and decrypts with the key.
    const sealed = lines.find((l) => l.kind === 'row' && (l.data as Record<string, unknown>).subject_ref === 'user-A') as {
      data: Record<string, string>;
    };
    expect(sealed.data.refresh_token).toBe('');
    const key = await tokenKey({ TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY }, sealed.data.token_key_id);
    if ('refused' in key) throw new Error(key.refused);
    expect(await decryptToken(key.key, sealed.data.token_key_id, { subjectRef: 'user-A', provider: 'google' }, sealed.data.token_ct)).toBe(
      'g-sealed-token-AAAA',
    );
  });

  it('AFTER the backfill: the database itself holds no plain text, nothing is withheld, and every token is in the dump as ciphertext', async () => {
    const db = await fixture();
    expect((await backfillProviderTokens(envOf(db, { PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL: OPEN }))).ok).toBe(true);
    const everything = JSON.stringify([db.rows('SELECT * FROM provider_tokens'), db.rows('SELECT * FROM apple_provider_tokens')]);
    for (const token of PLAIN) expect(everything, `${token} is gone from D1`).not.toContain(token);

    const dump = await dumpD1Database(db as unknown as D1Database, 'platform_db', 1000, '2026-10-03T02:30:00.000Z');
    expect(dump.withheld, 'the source is clean: nothing needs withholding').toBe(0);
    for (const token of [...PLAIN, 'g-sealed-token-AAAA']) expect(dump.jsonl).not.toContain(token);
    const rows = dump.jsonl
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { kind: string; table?: string; data?: Record<string, string> })
      .filter((l) => l.kind === 'row' && l.table === 'provider_tokens')
      .map((l) => l.data as Record<string, string>);
    const key = await tokenKey({ TOKEN_ENC_KEY_V1: TEST_TOKEN_ENC_KEY }, 'v1');
    if ('refused' in key) throw new Error(key.refused);
    const restored = await Promise.all(
      rows.map(async (r) => [r.subject_ref, await decryptToken(key.key, r.token_key_id, { subjectRef: r.subject_ref, provider: r.provider }, r.token_ct)]),
    );
    expect(restored.sort()).toEqual([
      ['user-A', 'g-sealed-token-AAAA'],
      ['user-B', 'a-plain-token-BBBB'],
      ['user-C', 'a-legacy-only-CCCC'],
    ]);
  });

  it('every column CREDENTIAL_COLUMNS withholds EXISTS — a rename would leave it withholding nothing', () => {
    const db = realPlatformDb();
    const tables = Object.entries(CREDENTIAL_COLUMNS);
    expect(tables.length).toBeGreaterThan(0);
    for (const [table, columns] of tables) {
      const have = db.rows(`SELECT name FROM pragma_table_info('${table}')`).map((r) => String(r.name));
      expect(have.length, `${table} exists`).toBeGreaterThan(0);
      for (const column of columns) expect(have, `${table}.${column}`).toContain(column);
    }
  });
});
