// ─────────────────────────────────────────────────────────────────────────────
// ports/identity.ts — THE WORKER HALF OF THE AUTH PORT: every call a Worker makes
// TO the identity provider on its own credential. The standard is
// tooling/ports/README.md §3; the registry is tooling/ports/auth.json, which
// names the adapters behind `IdentityAdmin` and the level the half earns.
//
// ⏱ 2026-10-03 · port-auth · row O-IDENTITY-CALLS-VENDOR-SHAPED. Until today the
// GoTrue URLs were built where they were used — the native sign-in relay and the
// desktop hand-off (routes/native-auth.ts), the session list and revoke
// (routes/sessions.ts), the account read and the identity delete
// (lib/platform-erasure.ts) and the keep-alive (scheduled.ts). The verbs below
// are exactly those call sites, derived from them, and nothing more.
//
// TYPES ONLY. No vendor import and no `fetch`: the GoTrue adapter lives in
// services/platform/src/adapters/identity/gotrue.ts — INSIDE the entry Worker,
// because tooling/ci/assert-erasure-reach.mjs limb 6 holds the one identity
// deleter there — the fake in ./fakes/identity.ts, and the only module that
// imports the adapter is the composition root, services/platform/src/ports.ts
// (`identityFor`; assert-ports limb 4). No module under services/*/src outside
// the adapter builds an identity-provider URL (assert-ports limb 4, its URL half).
//
// OUTCOMES, NEVER THROWS ACROSS THE PORT. A transport failure is
// `{ ok: false, kind: 'unavailable' | 'timeout' }` carrying the runtime's own
// error as `cause`, so a caller that logged `err.name` still can; a missing
// service credential is `{ ok: false, kind: 'refused' }` before anything is sent
// (fail closed). Any ANSWER the provider gives — a 2xx, a 404, a 5xx — is
// `{ ok: true, res }`: what an answer MEANS (gone, transient, refused) is each
// caller's decision, and stays where it was decided before this port existed.
//
// 🔴 THIS PORT CHANGES WHERE A CALL IS BUILT, NEVER WHAT IT SENDS. Every request
// leaves byte-for-byte as it did from its call site: the same method, path,
// query, headers, body, `redirect` and `signal`.
// ─────────────────────────────────────────────────────────────────────────────

/** Why a call produced no answer. `retryable`: the same call could succeed later. */
export type IdentityFailureKind = 'refused' | 'unavailable' | 'invalid' | 'timeout';

export type IdentityFailure = {
  ok: false;
  kind: IdentityFailureKind;
  retryable: boolean;
  detail: string;
  /** The runtime's own error, when one was thrown — never a credential. */
  cause?: unknown;
};

/** The provider's answer, verbatim, or why there was none. */
export type IdentityAnswer = { ok: true; res: Response } | IdentityFailure;

/** The credential calls an app's native sign-in forwards on our credential
 *  (the provider's captcha-gated four). */
export type CredentialOp = 'token' | 'signup' | 'recover' | 'resend';

/** What every call may carry: the abort signal its caller already bounded it by. */
export interface IdentityCallInit {
  signal?: AbortSignal;
}

export interface IdentityAdmin {
  /** The adapter's wire id (tooling/ports/auth.json). */
  readonly id: string;

  /**
   * Forward one credential call, answered verbatim (status, headers, body). The
   * `headers` are the caller's allowlisted request headers; the adapter adds the
   * content type and our credential. `query` is the op's own (the grant type, or
   * the redirect the caller already checked).
   */
  credential(op: CredentialOp, body: Record<string, unknown>, init: IdentityCallInit & { headers: Headers; query: Record<string, string> }): Promise<IdentityAnswer>;

  /** Read one account by its id. */
  readUser(userId: string, init?: IdentityCallInit): Promise<IdentityAnswer>;

  /** Delete one account by its id. */
  deleteUser(userId: string, init?: IdentityCallInit): Promise<IdentityAnswer>;

  /** Mint a one-time sign-in link for an account's address. It SENDS NO MAIL. */
  mintSignInLink(email: string, init?: IdentityCallInit): Promise<IdentityAnswer>;

  /** Redeem a sign-in link's token hash; the answer is a session. */
  redeemSignInLink(tokenHash: string, init?: IdentityCallInit): Promise<IdentityAnswer>;

  /** One session-store procedure (list or revoke an account's sessions). */
  sessions(fn: string, args: Record<string, string>, init?: IdentityCallInit): Promise<IdentityAnswer>;

  /** The provider's health endpoint on its PUBLIC key: the keep-alive. Goes out
   *  even with no key configured — some activity is better than none. */
  health(init?: IdentityCallInit): Promise<IdentityAnswer>;
}

/** The failure for a call that cannot be made because a credential is not set. */
export const missingCredential = (name: string): IdentityFailure => ({
  ok: false,
  kind: 'refused',
  retryable: false,
  detail: `${name} is not set`,
});

/** The failure for a call the runtime could not complete. */
export function transportFailure(err: unknown): IdentityFailure {
  const name = err instanceof Error ? err.name : typeof err;
  const timeout = name === 'TimeoutError' || name === 'AbortError';
  return { ok: false, kind: timeout ? 'timeout' : 'unavailable', retryable: true, detail: name, cause: err };
}
