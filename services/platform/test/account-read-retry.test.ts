// ─────────────────────────────────────────────────────────────────────────────
// account-read-retry.test.ts — the admin-user read tries a TRANSIENT outcome once
// more, inside the same ten-second budget, and never retries a definite answer.
//
// Why (E2E live #204, run 36837985672, 2026-10-01 08:51Z): `DELETE /v1/account`
// answered 202 after 17.9 s with the signup purge pending. The platform's read
// never reached Box C, so one lost request spent the whole single 10 s attempt and
// a real user would have waited for the nightly retry to be erased.
//
// Each case is the shape of a way this could be wrong:
//   · the first attempt times out and the second answers → `found`, so the signup
//     purge is `purged`, not `transient` (the case #204 needed);
//   · both attempts time out → `transient`, so the ledger path is unchanged;
//   · a 404 / 401 / 403 is the answer: ONE request, no second;
//   · the worst case stays at ten seconds: two attempts of five.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, vi } from 'vitest';
import { gotrueIdentityAdmin } from '../src/adapters/identity/gotrue';
import {
  ACCOUNT_READ_ATTEMPTS,
  ACCOUNT_READ_ATTEMPT_MS,
  ACCOUNT_READ_TIMEOUT_MS,
  purgeVerifiedSignups,
  readAccount,
} from '../src/lib/platform-erasure';

const URL_ = 'https://auth.test';
/** The identity port's GoTrue adapter at URL_ (port-auth): the request it sends is the one this file always read. */
const gotrue = (fetchImpl?: typeof fetch) => gotrueIdentityAdmin({ base: URL_, serviceKey: 'srk', publicKey: undefined, fetchImpl });
const USER = '00000000-0000-4000-8000-000000000001';

/** A fetch that plays `script` in order, one entry per call, and counts calls.
 *  'hang' never answers and rejects when the attempt's signal aborts — what a
 *  request lost between the Worker and the origin looks like from the Worker. */
function scripted(script: Array<'hang' | 'throw' | Response>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    const step = script[calls.length - 1];
    if (step === undefined) throw new Error(`unexpected call ${calls.length}`);
    if (step === 'throw') throw new TypeError('network connection lost');
    if (step === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      });
    }
    return step;
  }) as typeof fetch;
  return { impl, calls };
}

const found = () =>
  new Response(JSON.stringify({ email: 'person@example.org', email_confirmed_at: '2026-09-30T10:00:00Z' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** The smallest D1 stand-in purgeVerifiedSignups touches: one DELETE. */
function fakeDb(changes = 1) {
  const run: string[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: () => ({
        run: async () => {
          run.push(sql);
          return { meta: { changes } };
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, run };
}

describe('the account read retries a TRANSIENT outcome once, inside the same budget', () => {
  it('two attempts of five seconds: the worst case is still ten', () => {
    expect(ACCOUNT_READ_ATTEMPTS).toBe(2);
    expect(ACCOUNT_READ_ATTEMPT_MS).toBe(5_000);
    expect(ACCOUNT_READ_TIMEOUT_MS).toBe(10_000);
  });

  it('first attempt times out, second answers → found', async () => {
    const { impl, calls } = scripted(['hang', found()]);
    expect(await readAccount(gotrue(impl), USER, 20)).toMatchObject({ kind: 'found', email: 'person@example.org' });
    expect(calls).toHaveLength(2);
  });

  it('through the caller #204 ran: a lost first read still ends PURGED, not transient', async () => {
    // purgeVerifiedSignups reads through the global fetch with the real 5 s attempt
    // bound, so the lost request is a transport failure here rather than a hang.
    const { impl, calls } = scripted(['throw', found()]);
    vi.stubGlobal('fetch', impl);
    try {
      const { db, run } = fakeDb();
      expect(await purgeVerifiedSignups(db, gotrue(), USER)).toEqual({ kind: 'purged', deleted: 1 });
      expect(calls).toHaveLength(2);
      expect(run).toEqual(['DELETE FROM signups WHERE email = ?']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('both attempts time out → transient, so the erasure ledger path is unchanged', async () => {
    const { impl, calls } = scripted(['hang', 'hang']);
    expect(await readAccount(gotrue(impl), USER, 20)).toEqual({
      kind: 'transient',
      why: 'the identity provider could not be reached',
    });
    expect(calls).toHaveLength(2);
  });

  it('a transport error, a 5xx or a 429 on the first attempt is retried', async () => {
    for (const first of ['throw', new Response('busy', { status: 503 }), new Response('slow down', { status: 429 })] as const) {
      const { impl, calls } = scripted([first, found()]);
      expect((await readAccount(gotrue(impl), USER, 20)).kind).toBe('found');
      expect(calls).toHaveLength(2);
    }
  });

  it('a 404 is the answer: no_account after ONE request, never a second', async () => {
    const { impl, calls } = scripted([new Response('', { status: 404 }), found()]);
    expect(await readAccount(gotrue(impl), USER, 20)).toEqual({ kind: 'no_account' });
    expect(calls).toHaveLength(1);
  });

  it('a 401 or 403 is the answer: failed after ONE request, never a second', async () => {
    for (const status of [401, 403]) {
      const { impl, calls } = scripted([new Response('', { status }), found()]);
      expect(await readAccount(gotrue(impl), USER, 20)).toEqual({
        kind: 'failed',
        why: `the identity provider answered ${status}`,
      });
      expect(calls).toHaveLength(1);
    }
  });
});
