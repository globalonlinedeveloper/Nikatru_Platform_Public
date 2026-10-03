// ─────────────────────────────────────────────────────────────────────────────
// adapters/identity/gotrue.ts — THE GOTRUE ADAPTER OF `IdentityAdmin`
// (services/_shared/src/ports/identity.ts; tooling/ports/auth.json `gotrue`).
//
// ⏱ 2026-10-03 · port-auth. Every request below was MOVED here verbatim from
// the call site named on it; the call sites now ask the port (`identityFor`,
// services/platform/src/ports.ts) and decide what each answer means exactly as
// they did. This is the ONE module in services/*/src that builds a GoTrue or
// PostgREST URL (assert-ports limb 4), and the one identity deleter
// (`admin/users` — assert-erasure-reach.mjs limb 6, which requires it inside
// the entry Worker: that is why this adapter is here and not in _shared).
//
// The base is the identity origin (`SUPABASE_URL`, or one keep-alive target).
// A service-role call with no service key is refused before anything is sent.
//
// 🔴 EVERY SERVICE-ROLE CALL IS `redirect: 'manual'`, AND A 3xx IS A REFUSAL
// (`serviceSend`). The key rides in `apikey`, a custom header fetch does NOT
// strip on a cross-origin redirect (it strips only `Authorization`), so a proxy
// that answered 3xx to another origin would otherwise be handed the service-role
// key. ⏱ 2026-10-03 · review of #1182, finding 1: the account read and the
// identity delete (and the session RPC) followed redirects; the hand-off's admin
// calls and the credential relay never did. Real GoTrue answers none of these
// with a redirect, so against it nothing changes. The keep-alive is on the
// PUBLIC key and keeps the default.
// ─────────────────────────────────────────────────────────────────────────────
import {
  missingCredential,
  redirectRefused,
  transportFailure,
  type CredentialOp,
  type IdentityAdmin,
  type IdentityAnswer,
  type IdentityCallInit,
} from '../../../../_shared/src/ports/identity';

export interface GotrueConfig {
  /** The identity origin, e.g. `SUPABASE_URL`. */
  readonly base: string | undefined;
  /** `SUPABASE_SERVICE_ROLE_KEY`: every admin, credential and session call. */
  readonly serviceKey: string | undefined;
  /** `SUPABASE_ANON_KEY`: the keep-alive only. */
  readonly publicKey: string | undefined;
  /** Injectable for tests; resolved at CALL time, so a stubbed global is seen. */
  readonly fetchImpl?: typeof fetch;
}

const SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY';

export function gotrueIdentityAdmin(cfg: GotrueConfig): IdentityAdmin {
  const send = async (url: string, init: RequestInit): Promise<IdentityAnswer> => {
    try {
      return { ok: true, res: await (cfg.fetchImpl ?? fetch)(url, init) };
    } catch (err) {
      return transportFailure(err);
    }
  };
  const key = cfg.serviceKey;

  /** A service-role request: never follows a redirect, and a 3xx answer is refused
   *  (`opaqueredirect` is the browser's shape of the same answer). */
  const serviceSend = async (url: string, init: RequestInit): Promise<IdentityAnswer> => {
    const answer = await send(url, { ...init, redirect: 'manual' });
    if (answer.ok && (answer.res.type === 'opaqueredirect' || (answer.res.status >= 300 && answer.res.status < 400))) {
      return redirectRefused(answer.res.status);
    }
    return answer;
  };

  /** From routes/native-auth.ts `gotrueAdmin` (the desktop hand-off's admin calls). */
  const handoffCall = (path: string, method: 'GET' | 'POST', body: unknown, init?: IdentityCallInit): Promise<IdentityAnswer> => {
    if (!key) return Promise.resolve(missingCredential(SERVICE_KEY));
    return serviceSend(`${cfg.base}/auth/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: init?.signal,
    });
  };

  return {
    id: 'gotrue',

    /** From routes/native-auth.ts `relay`: the four captcha-gated calls, on our key. */
    credential(op: CredentialOp, body: Record<string, unknown>, init) {
      if (!key) return Promise.resolve(missingCredential(SERVICE_KEY));
      const url = new URL(`${cfg.base}/auth/v1/${op}`);
      for (const [name, value] of Object.entries(init.query)) url.searchParams.set(name, value);
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('apikey', key);
      headers.set('Authorization', `Bearer ${key}`);
      return serviceSend(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: init.signal,
      });
    },

    /** From lib/platform-erasure.ts `readAccountOnce`. */
    readUser(userId: string, init?: IdentityCallInit) {
      if (!key) return Promise.resolve(missingCredential(SERVICE_KEY));
      return serviceSend(`${cfg.base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: init?.signal,
      });
    },

    /** From lib/platform-erasure.ts `deleteIdentity`. */
    deleteUser(userId: string, init?: IdentityCallInit) {
      if (!key) return Promise.resolve(missingCredential(SERVICE_KEY));
      return serviceSend(`${cfg.base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: init?.signal,
      });
    },

    /** From routes/native-auth.ts `handoffSession`: `admin/generate_link`, type magiclink — it SENDS NO MAIL. */
    mintSignInLink(email: string, init?: IdentityCallInit) {
      return handoffCall('/admin/generate_link', 'POST', { type: 'magiclink', email }, init);
    },

    /** From routes/native-auth.ts `handoffSession`: `/verify` with the link's token hash. */
    redeemSignInLink(tokenHash: string, init?: IdentityCallInit) {
      return handoffCall('/verify', 'POST', { type: 'magiclink', token_hash: tokenHash }, init);
    },

    /** From routes/sessions.ts `rpc`: one PostgREST procedure on the service key. */
    sessions(fn: string, args: Record<string, string>, init?: IdentityCallInit) {
      if (!key) return Promise.resolve(missingCredential(SERVICE_KEY));
      return serviceSend(`${cfg.base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: init?.signal,
      });
    },

    /** From scheduled.ts `supabaseKeepAlive`: GoTrue's health on the PUBLIC key; with none it still goes out. */
    health(init?: IdentityCallInit) {
      const pub = cfg.publicKey;
      return send(`${cfg.base}/auth/v1/health`, {
        signal: init?.signal,
        headers: pub ? { apikey: pub, Authorization: `Bearer ${pub}` } : {},
      });
    },
  };
}
