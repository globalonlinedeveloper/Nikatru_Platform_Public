// ─────────────────────────────────────────────────────────────────────────────
// fakes/identity.ts — AN IN-MEMORY `IdentityAdmin` (tooling/ports/auth.json
// adapter `fake-identity`). Never selectable in live: the composition root
// builds the GoTrue adapter, and this is reached only from tests.
//
// It answers with the provider's wire shapes (a JSON account, a 404 for an
// unknown one, a session for a redeemed link), so a caller's decision about an
// answer is exercised exactly as against the real adapter. `down` makes every
// call a transport failure; `calls` records each verb in order.
// ─────────────────────────────────────────────────────────────────────────────
import {
  missingCredential,
  transportFailure,
  type CredentialOp,
  type IdentityAdmin,
  type IdentityAnswer,
} from '../identity';

export interface FakeAccount {
  email: string;
  email_confirmed_at?: string | null;
  sessions?: string[];
}

export interface FakeIdentityAdmin extends IdentityAdmin {
  readonly accounts: Map<string, FakeAccount>;
  readonly calls: string[];
  /** True: every call fails as an unreachable provider would. */
  down: boolean;
  /** False: every credentialled call is refused as a missing key is. */
  keyed: boolean;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function fakeIdentityAdmin(seed: Record<string, FakeAccount> = {}): FakeIdentityAdmin {
  const accounts = new Map(Object.entries(seed));
  const links = new Map<string, string>();
  const calls: string[] = [];
  const fake: FakeIdentityAdmin = {
    id: 'fake-identity',
    accounts,
    calls,
    down: false,
    keyed: true,
    async credential(op: CredentialOp, body: Record<string, unknown>) {
      return answer(`credential ${op}`, true, () => {
        const known = [...accounts.values()].some((a) => a.email === body.email);
        if (op === 'token' && !known) return json(400, { code: 'invalid_credentials', message: 'Invalid login credentials' });
        return json(200, {});
      });
    },
    async readUser(userId: string) {
      return answer('readUser', true, () => {
        const a = accounts.get(userId);
        return a ? json(200, { id: userId, email: a.email, email_confirmed_at: a.email_confirmed_at ?? null }) : json(404, { code: 'user_not_found' });
      });
    },
    async deleteUser(userId: string) {
      return answer('deleteUser', true, () => (accounts.delete(userId) ? new Response(null, { status: 200 }) : json(404, { code: 'user_not_found' })));
    },
    async mintSignInLink(email: string) {
      return answer('mintSignInLink', true, () => {
        const id = [...accounts.entries()].find(([, a]) => a.email === email)?.[0];
        if (id === undefined) return json(404, { code: 'user_not_found' });
        const hash = `${'ab'.repeat(20)}${links.size}`;
        links.set(hash, id);
        return json(200, { hashed_token: hash });
      });
    },
    async redeemSignInLink(tokenHash: string) {
      return answer('redeemSignInLink', true, () => {
        const id = links.get(tokenHash);
        if (id === undefined) return json(403, { code: 'otp_expired' });
        links.delete(tokenHash);
        return json(200, { access_token: `fake-access-${id}`, refresh_token: `fake-refresh-${id}`, user: { id } });
      });
    },
    async sessions(fn: string, args: Record<string, string>) {
      return answer(`sessions ${fn}`, true, () => {
        const a = accounts.get(args.p_user_id ?? args.user_id ?? '');
        return json(200, (a?.sessions ?? []).map((id) => ({ id })));
      });
    },
    async health() {
      return answer('health', false, () => json(200, { name: 'fake-identity' }));
    },
  };
  function answer(verb: string, credentialled: boolean, make: () => Response): IdentityAnswer {
    calls.push(verb);
    if (credentialled && !fake.keyed) return missingCredential('SUPABASE_SERVICE_ROLE_KEY');
    if (fake.down) return transportFailure(new TypeError('fetch failed'));
    return { ok: true, res: make() };
  }
  return fake;
}
