// ─────────────────────────────────────────────────────────────────────────────
// identity-port.test.ts — THE `IdentityAdmin` PORT (tooling/ports/auth.json, the
// Worker half; port-auth, row O-IDENTITY-CALLS-VENDOR-SHAPED).
//
//   1. The GoTrue adapter sends, per verb, exactly the request its old call site
//      sent: the method, the URL, the credential headers and the redirect mode.
//   2. Outcomes, never throws: a transport failure is `{ ok: false }` carrying
//      the runtime's error, and a missing service key refuses BEFORE anything
//      is sent (fail closed).
//   3. The same answers read the same through the adapter and the fake.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';

import { gotrueIdentityAdmin } from '../src/adapters/identity/gotrue';
import { fakeIdentityAdmin } from '../../_shared/src/ports/fakes/identity';
import type { IdentityAdmin } from '../../_shared/src/ports/identity';
import { readAccount } from '../src/lib/platform-erasure';
import { identityFor } from '../src/ports';

const BASE = 'https://identity.test';
const USER = '11111111-2222-4333-8444-555555555555';

type Seen = { url: string; init: RequestInit };

function recording(answer: (url: string) => Response | Error) {
  const seen: Seen[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init: init ?? {} });
    const a = answer(url);
    if (a instanceof Error) throw a;
    return a;
  }) as typeof fetch;
  return { seen, impl };
}

const header = (s: Seen, name: string) => new Headers(s.init.headers).get(name);

describe('the GoTrue adapter sends what each call site sent', () => {
  const net = recording(() => new Response('{}', { status: 200 }));
  const g = gotrueIdentityAdmin({ base: BASE, serviceKey: 'srk', publicKey: 'pub', fetchImpl: net.impl });

  it('credential: POST <base>/auth/v1/<op> with the op query, the caller headers and our key, redirect manual', async () => {
    const headers = new Headers({ 'user-agent': 'ua/1', 'x-supabase-api-version': '2024-01-01' });
    const r = await g.credential('token', { email: 'a@b.test', password: 'p' }, { headers, query: { grant_type: 'password' } });
    expect(r.ok).toBe(true);
    const s = net.seen.at(-1)!;
    expect(s.url).toBe(`${BASE}/auth/v1/token?grant_type=password`);
    expect(s.init.method).toBe('POST');
    expect(s.init.redirect).toBe('manual');
    expect(header(s, 'user-agent')).toBe('ua/1');
    expect(header(s, 'apikey')).toBe('srk');
    expect(header(s, 'authorization')).toBe('Bearer srk');
    expect(header(s, 'content-type')).toBe('application/json');
    expect(JSON.parse(String(s.init.body))).toEqual({ email: 'a@b.test', password: 'p' });
  });

  it('readUser and deleteUser: the admin user path, id encoded, key headers only', async () => {
    await g.readUser('a/b');
    expect(net.seen.at(-1)!.url).toBe(`${BASE}/auth/v1/admin/users/a%2Fb`);
    expect(net.seen.at(-1)!.init.method).toBe('GET');
    await g.deleteUser(USER);
    const s = net.seen.at(-1)!;
    expect(s.url).toBe(`${BASE}/auth/v1/admin/users/${USER}`);
    expect(s.init.method).toBe('DELETE');
    expect(s.init.headers).toEqual({ apikey: 'srk', Authorization: 'Bearer srk' });
  });

  it('mintSignInLink and redeemSignInLink: generate_link (magiclink, no mail) then verify, redirect manual', async () => {
    await g.mintSignInLink('a@b.test');
    let s = net.seen.at(-1)!;
    expect(s.url).toBe(`${BASE}/auth/v1/admin/generate_link`);
    expect(JSON.parse(String(s.init.body))).toEqual({ type: 'magiclink', email: 'a@b.test' });
    expect(s.init.redirect).toBe('manual');
    await g.redeemSignInLink('ab'.repeat(20));
    s = net.seen.at(-1)!;
    expect(s.url).toBe(`${BASE}/auth/v1/verify`);
    expect(JSON.parse(String(s.init.body))).toEqual({ type: 'magiclink', token_hash: 'ab'.repeat(20) });
  });

  it('sessions: POST <base>/rest/v1/rpc/<fn> with the args as JSON', async () => {
    await g.sessions('list_user_sessions', { p_user_id: USER });
    const s = net.seen.at(-1)!;
    expect(s.url).toBe(`${BASE}/rest/v1/rpc/list_user_sessions`);
    expect(JSON.parse(String(s.init.body))).toEqual({ p_user_id: USER });
  });

  it('health: <base>/auth/v1/health on the PUBLIC key, and with none it still goes out', async () => {
    await g.health();
    expect(net.seen.at(-1)!.url).toBe(`${BASE}/auth/v1/health`);
    expect(net.seen.at(-1)!.init.headers).toEqual({ apikey: 'pub', Authorization: 'Bearer pub' });
    await gotrueIdentityAdmin({ base: BASE, serviceKey: undefined, publicKey: undefined, fetchImpl: net.impl }).health();
    expect(net.seen.at(-1)!.init.headers).toEqual({});
  });
});

describe('outcomes, never throws', () => {
  it('🔴 no service key: every credentialled verb is REFUSED and nothing is sent', async () => {
    const net = recording(() => new Response('{}'));
    const g = gotrueIdentityAdmin({ base: BASE, serviceKey: undefined, publicKey: 'pub', fetchImpl: net.impl });
    const outcomes = await Promise.all([
      g.credential('signup', {}, { headers: new Headers(), query: {} }),
      g.readUser(USER),
      g.deleteUser(USER),
      g.mintSignInLink('a@b.test'),
      g.redeemSignInLink('x'),
      g.sessions('f', {}),
    ]);
    for (const o of outcomes) expect(o).toMatchObject({ ok: false, kind: 'refused', retryable: false, detail: 'SUPABASE_SERVICE_ROLE_KEY is not set' });
    expect(net.seen).toHaveLength(0);
  });

  it('a transport failure is { ok: false } carrying the runtime error; a timeout is `timeout`', async () => {
    const down = recording(() => new TypeError('fetch failed'));
    const r = await gotrueIdentityAdmin({ base: BASE, serviceKey: 'srk', publicKey: undefined, fetchImpl: down.impl }).readUser(USER);
    expect(r).toMatchObject({ ok: false, kind: 'unavailable', retryable: true, detail: 'TypeError' });
    expect(r.ok ? null : r.cause).toBeInstanceOf(TypeError);
    const slow = recording(() => new DOMException('timed out', 'TimeoutError'));
    expect(await gotrueIdentityAdmin({ base: BASE, serviceKey: 'srk', publicKey: undefined, fetchImpl: slow.impl }).deleteUser(USER)).toMatchObject({ ok: false, kind: 'timeout' });
  });

  it('identityFor builds the GoTrue adapter on SUPABASE_URL, or on the base it is given', async () => {
    const net = recording(() => new Response('{}'));
    const env = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'srk', SUPABASE_ANON_KEY: undefined };
    expect(identityFor(env).id).toBe('gotrue');
    await identityFor(env, { fetchImpl: net.impl }).readUser(USER);
    await identityFor(env, { base: 'https://other.test', fetchImpl: net.impl }).health();
    expect(net.seen.map((s) => s.url)).toEqual([`${BASE}/auth/v1/admin/users/${USER}`, 'https://other.test/auth/v1/health']);
  });
});

describe('the adapter and the fake read the same through readAccount', () => {
  const gotrueWith = (accounts: Record<string, { email: string; email_confirmed_at: string | null }>, down = false): IdentityAdmin =>
    gotrueIdentityAdmin({
      base: BASE,
      serviceKey: 'srk',
      publicKey: undefined,
      fetchImpl: recording((url) => {
        if (down) return new TypeError('fetch failed');
        const id = decodeURIComponent(url.split('/').at(-1)!);
        const a = accounts[id];
        return a ? new Response(JSON.stringify({ id, ...a }), { status: 200 }) : new Response('{}', { status: 404 });
      }).impl,
    });
  const seed = { [USER]: { email: ' person@example.org ', email_confirmed_at: '2026-10-01T00:00:00Z' } };

  for (const [name, make] of [
    ['gotrue', (down: boolean) => gotrueWith(seed, down)],
    ['fake-identity', (down: boolean) => Object.assign(fakeIdentityAdmin(seed), { down })],
  ] as const) {
    it(`${name}: found, gone, and unreachable`, async () => {
      expect(await readAccount(make(false), USER, 20)).toEqual({ kind: 'found', email: 'person@example.org', email_confirmed_at: '2026-10-01T00:00:00Z' });
      expect(await readAccount(make(false), 'nobody', 20)).toEqual({ kind: 'no_account' });
      expect(await readAccount(make(true), USER, 20)).toEqual({ kind: 'transient', why: 'the identity provider could not be reached' });
    });
  }

  it('the fake refuses without its key, deletes once, and redeems a minted link once', async () => {
    const f = fakeIdentityAdmin(seed);
    const link = await f.mintSignInLink('person@example.org');
    const hash = link.ok ? ((await link.res.json()) as { hashed_token: string }).hashed_token : '';
    expect((await f.redeemSignInLink(hash)).ok && true).toBe(true);
    const again = await f.redeemSignInLink(hash);
    expect(again.ok ? again.res.status : 0).toBe(403);
    const first = await f.deleteUser(USER);
    const second = await f.deleteUser(USER);
    expect([first.ok ? first.res.status : 0, second.ok ? second.res.status : 0]).toEqual([200, 404]);
    f.keyed = false;
    expect(await f.readUser(USER)).toMatchObject({ ok: false, kind: 'refused' });
    expect(f.calls).toEqual(['mintSignInLink', 'redeemSignInLink', 'redeemSignInLink', 'deleteUser', 'deleteUser', 'readUser']);
  });
});
