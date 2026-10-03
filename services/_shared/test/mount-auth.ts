// ─────────────────────────────────────────────────────────────────────────────
// mount-auth.ts — THE DERIVED "every route that is not public refuses an
// anonymous caller" check, and the tokens to prove an admitted one gets through.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-012,
// services-024). The brick's stamped Worker mounted `supabaseAuth` and
// `erasureAuth` and NO test in its suite ever ran either: the auth plumbing every
// future app's API rests on was exercised only in the live Workers' own suites.
// This module lets a Worker's suite drive its REAL app through its REAL
// middleware, with the route set read from `app.routes` (preflight.ts's
// `mountedEndpoints`), so a route added later is covered by existing.
//
// Not a `.test.ts`: it asserts nothing by itself. A Worker's own
// test/mount-auth.test.ts calls it with its app and its public routes.
//
// No `jose` and no `hono` (a test under services/_shared resolves bare imports
// from services/_shared/node_modules, which holds only what the kit declares):
// the tokens are minted with WebCrypto, which is what ES256 and HS256 are.
//
// ⏱ 2026-10-03 (review of #1152, minor 1): `revokedNotRefused` runs a SIGNED-OUT
// session through both boundaries, so a boundary whose `sessionRevoked(` call is
// present but neutered (`false && await sessionRevoked(…)`) is red in every
// Worker suite that calls it — the mutation assert-session-revocation.mjs cannot see.
// ─────────────────────────────────────────────────────────────────────────────
import { revocationKey, withRevokedSessions } from '../src/auth';
import { mountedEndpoints, probePath, type Endpoint, type MountedRoute } from './preflight';

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const enc = new TextEncoder();
const segment = (o: unknown): string => b64url(enc.encode(JSON.stringify(o)));

/** The claims GoTrue puts on an access token, for `supabaseUrl`'s project. */
export function goTrueClaims(supabaseUrl: string, sub: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: `${supabaseUrl}/auth/v1`,
    aud: 'authenticated',
    sub,
    iat: now,
    exp: now + 600,
    session_id: 'session-mount-auth',
    amr: [{ method: 'password', timestamp: now }],
    app_metadata: { providers: ['email'] },
    ...over,
  };
}

/** An ES256 signer and the PUBLIC JWKS document that verifies it. */
export async function es256Issuer(kid = 'mount-auth-key') {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const jwks = { keys: [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig' }] };
  const sign = async (claims: Record<string, unknown>): Promise<string> => {
    const input = `${segment({ alg: 'ES256', typ: 'JWT', kid })}.${segment(claims)}`;
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, enc.encode(input));
    return `${input}.${b64url(new Uint8Array(sig))}`;
  };
  return { jwks, sign };
}

/** An HS256 token signed with a shared secret — the legacy shape only the
 *  permissive boundary may accept, and only labelled `symmetric`. */
export async function hs256Token(secret: string, claims: Record<string, unknown>): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const input = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment(claims)}`;
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

/** A `fetch` that serves `jwks` at `supabaseUrl`'s JWKS URL and rejects the rest. */
export function jwksFetch(supabaseUrl: string, jwks: unknown) {
  const url = `${supabaseUrl}/auth/v1/.well-known/jwks.json`;
  return async (input: RequestInfo | URL): Promise<Response> => {
    const asked = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (asked === url) return Response.json(jwks);
    throw new TypeError(`mount-auth: no stub for ${asked}`);
  };
}

/** Issue one request through the Worker's own app. */
export type Through = (path: string, init: { method: string; headers?: Record<string, string> }) => Response | Promise<Response>;

/**
 * Every mounted endpoint that is not listed as public, requested with NO
 * credential: one line per endpoint that did not answer 401. Empty is the pass.
 * The endpoint set is DERIVED from `routes`; `minimum` is its floor, so a table
 * that stopped being read cannot pass by being empty.
 */
export async function anonymousNotRefused(
  routes: ReadonlyArray<MountedRoute>,
  through: Through,
  publicEndpoints: ReadonlyArray<Endpoint>,
  minimum: number,
): Promise<string[]> {
  const isPublic = (e: Endpoint) => publicEndpoints.some((p) => p.method === e.method && p.path === e.path);
  const guarded = mountedEndpoints(routes).filter((e) => !isPublic(e) && e.method !== 'OPTIONS');
  if (guarded.length < minimum) {
    return [`only ${guarded.length} guarded endpoint(s) were read from the route table (floor ${minimum}) — the derivation is broken`];
  }
  const out: string[] = [];
  for (const e of guarded) {
    const res = await through(probePath(e.path), { method: e.method });
    if (res.status !== 401) out.push(`${e.method} ${e.path} answered ${res.status} to a caller with no credential`);
  }
  return out;
}

/** A SESSION_REVOKED binding holding one record, in the writer's own shape
 *  (`withRevokedSessions`), and counting the reads `sessionRevoked` makes. */
export function revokedSessionKv(sub: string, sessionId: string) {
  const record = withRevokedSessions(null, [sessionId], Math.floor(Date.now() / 1000));
  const kv = {
    reads: 0,
    async get(key: string): Promise<unknown> {
      kv.reads += 1;
      return key === revocationKey(sub) ? record : null;
    },
  };
  return kv;
}
export type RevokedSessionKv = ReturnType<typeof revokedSessionKv>;

/**
 * A token whose session was signed out, through the permissive boundary
 * (`permissive`, an endpoint it admits a live token to) and the erasure boundary
 * (`erasure`): one line per boundary that did not refuse it. Empty is the pass.
 * `through(kv)` must bind `kv` as SESSION_REVOKED (`undefined`: no binding), and
 * the JWKS that verifies `sign` must already be served.
 *
 * A control runs first — the same token with no record must NOT be a 401 — or a
 * refusal below would prove nothing. The erasure limb also requires the record to
 * have been READ by that request: a 401 for another reason is not a revocation.
 */
export async function revokedNotRefused(
  through: (revoked: RevokedSessionKv | undefined) => Through,
  sign: (claims: Record<string, unknown>) => Promise<string>,
  supabaseUrl: string,
  permissive: Endpoint,
  erasure: Endpoint,
): Promise<string[]> {
  const sub = 'user-signed-out';
  const claims = goTrueClaims(supabaseUrl, sub);
  const headers = { Authorization: `Bearer ${await sign(claims)}` };
  const out: string[] = [];
  const control = await through(undefined)(probePath(permissive.path), { method: permissive.method, headers });
  if (control.status === 401) {
    return [`control: ${permissive.method} ${permissive.path} refused the token with NO revocation record (401), so a refusal below would prove nothing`];
  }
  const kv = revokedSessionKv(sub, String(claims.session_id));
  const p = await through(kv)(probePath(permissive.path), { method: permissive.method, headers });
  if (p.status !== 401) out.push(`${permissive.method} ${permissive.path} answered ${p.status} to a signed-out session's token`);
  const readsBefore = kv.reads;
  const e = await through(kv)(probePath(erasure.path), { method: erasure.method, headers });
  if (e.status !== 401) out.push(`${erasure.method} ${erasure.path} answered ${e.status} to a signed-out session's token`);
  if (kv.reads === readsBefore) out.push(`${erasure.method} ${erasure.path} never read SESSION_REVOKED, so its boundary did not consult the revocation list`);
  return out;
}
