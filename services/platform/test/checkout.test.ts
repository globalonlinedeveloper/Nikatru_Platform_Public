// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/checkout — the Paddle create-transaction server half. [ADR 044].
//
// 🔴 THE TEST THIS FILE EXISTS FOR IS THE BILLED-STATUS ONE, and it has TWO
// halves because the guard has two halves:
//
//   · COMPILE — `@ts-expect-error` on an object literal carrying `status`. If
//     someone deletes `status?: never` from `PaddleCreateTransactionBody`, that
//     line starts compiling, the expect-error becomes UNUSED, and
//     `npx tsc --noEmit` FAILS. That is the negative test: the assertion goes
//     red when the thing it guards is removed, which is the property a comment
//     saying "don't pass status" can never have. (tsconfig.json includes
//     `test/**/*.ts`, so this file is typechecked by the same command CI runs.)
//   · RUNTIME — types are erased, so `serializeCreateTransactionBody` is handed
//     a cast object that really does carry the key, and must throw. Exercised
//     for every member of FORBIDDEN_CREATE_KEYS, not just `status`.
//
// ── AND ONE ASSERTION ABOUT THE BYTES ON THE WIRE, PARSED NOT GREPPED ────────
// The happy path parses the outbound request body and asserts `'status' in body`
// is FALSE. Asserting the SQL/JSON a route chose by substring is the mistake
// this repo's harness note records; here the body is JSON, so it is parsed and
// the key set is compared as structure.
//
// ── WHY THE OPEN PATH NEEDS A FIXTURE AT ALL ─────────────────────────────────
// `paywall.enabled` is `false` for every app in the shipped config ([ADR 044]
// §5(4) — [T-11] blocks the flip), so the route refuses everything today. A
// suite that only exercised today's tree would prove the refusal and nothing
// else, which is [pipeline C-6]'s dead-seam-reporting-healthy shape exactly. The
// harness therefore supplies the KV override an owner would set, so both the
// closed and the open path are real assertions.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';
import { platformAuth } from '../src/middleware/auth';
import checkout, {
  FORBIDDEN_CREATE_KEYS,
  MAX_CHECKOUT_BODY_BYTES,
  PADDLE_PRICE_IDS,
  buildCreateTransactionBody,
  serializeCreateTransactionBody,
  type PaddleCreateTransactionBody,
} from '../src/routes/checkout';
import { DEFAULT_CONFIGS, baseConfig } from '../src/config';
import {
  PADDLE_CUSTOM_DATA_APP_ID,
  PADDLE_CUSTOM_DATA_USER_ID,
  paddleVerifier,
} from '../src/lib/mor/paddle';
import type { AppEnv, RateLimiterBinding } from '../src/types';

const SUPABASE_URL = 'https://project-a.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const USER = '11111111-1111-4111-8111-111111111111';

/** A live-shaped key. NOT a credential: 24 arbitrary characters after the
 *  documented prefix, well clear of anything `.gitleaks.toml` would call a key
 *  (its rules require 20+ chars, so this shape is deliberately checked in the
 *  same way the guard's own fixtures are — see tooling/ci/scan-secrets.mjs). */
const LIVE_KEY = `pdl_live_apikey_${'t'.repeat(24)}`;
const SANDBOX_KEY = `pdl_sdbx_apikey_${'t'.repeat(24)}`;

let signingKey: KeyLike;
let publicJwk: JWK;

/** Every request the route made to Paddle, in order. */
interface PaddleCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}
let paddleCalls: PaddleCall[] = [];
/** What the stubbed Paddle answers next. Replaced per test. */
let paddleResponder: (call: PaddleCall) => Response | Promise<Response> = () => okCreate();

/** The measured 201 envelope ([ADR 044] §3), with the fields under test. */
function okCreate(
  over: {
    id?: string | null;
    status?: string;
    url?: unknown;
    customData?: unknown;
  } = {},
): Response {
  const data: Record<string, unknown> = {
    id: over.id === undefined ? 'txn_01kzs3qcvryq785t7shpq5d7wj' : over.id,
    status: over.status ?? 'draft',
    customer_id: null,
    address_id: null,
    invoice_number: null,
    collection_mode: 'automatic',
    origin: 'api',
    custom_data:
      over.customData === undefined
        ? { [PADDLE_CUSTOM_DATA_USER_ID]: USER, [PADDLE_CUSTOM_DATA_APP_ID]: 'subly' }
        : over.customData,
    checkout: {
      url:
        over.url === undefined
          ? 'https://nikatru.com/pricing.html?_ptxn=txn_01kzs3qcvryq785t7shpq5d7wj'
          : over.url,
    },
    details: { totals: { grand_total: '0' } },
  };
  return new Response(JSON.stringify({ data, meta: { request_id: 'x' } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), alg: 'ES256', kid: 'test-key-1' };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('paddle.com')) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
      let body: unknown = null;
      try {
        body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      } catch {
        body = init?.body ?? null;
      }
      const call: PaddleCall = { url, method: init?.method ?? 'GET', headers, body };
      paddleCalls.push(call);
      return paddleResponder(call);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  paddleCalls = [];
  paddleResponder = () => okCreate();
});

async function token(sub: string) {
  return new SignJWT({ sub })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setAudience('authenticated')
    .setIssuer(ISSUER)
    .sign(signingKey);
}

/** The KV override an owner flips to open the paywall. `null` = shipped state. */
const PAYWALL_ON = JSON.stringify({ paywall: { enabled: true } });

/**
 * ⚠️ `null` means NO money environment / NO api key, never `undefined` — an
 * `undefined` argument is swallowed by the parameter default and the test would
 * assert the configured path while claiming to assert the unconfigured one.
 * (Same trap, same fix, as test/cancellation.test.ts:61.)
 */
function harness({
  environment = 'live' as string | null,
  apiKey = LIVE_KEY as string | null,
  kv = PAYWALL_ON as string | null,
  limiter = undefined as RateLimiterBinding | undefined,
} = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'rid-test');
    await next();
  });
  app.use('/v1/checkout', platformAuth);
  app.route('/v1', checkout);

  const kvReads: string[] = [];
  const CONFIG_KV = {
    get: async (key: string) => {
      kvReads.push(key);
      return kv;
    },
    put: async () => undefined,
  } as unknown as KVNamespace;

  const env = {
    CONFIG_KV,
    JWKS_CACHE: { get: async () => null, put: async () => undefined } as unknown as KVNamespace,
    SUPABASE_URL,
    APP_ID: 'platform',
    API_VERSION: 'v1',
    MONEY_ENVIRONMENT: environment ?? undefined,
    PADDLE_API_KEY: apiKey ?? undefined,
    CHECKOUT_CEILING_LIMITER: limiter,
  } as unknown as AppEnv['Bindings'];

  return {
    kvReads,
    post: (body: unknown, authz?: string) =>
      app.request(
        '/v1/checkout',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(authz === undefined ? {} : { Authorization: authz }),
          },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        },
        env,
      ),
  };
}

const BUY = { app_id: 'subly', offering_id: 'pro_monthly' };

// ═════════════════════════════════════════════════════════════════════════════
describe('🔴 status:"billed" is STRUCTURALLY IMPOSSIBLE on the create path', () => {
  it('the COMPILE half — `status` is unassignable, and deleting the guard FAILS tsc', () => {
    // 🔴 THE OBJECT IS BUILT SEPARATELY AND ASSIGNED, WHICH IS THE WHOLE POINT.
    // The first version of this test used a fresh object literal, and the
    // mutation run exposed it as worthless: deleting `status?: never` left the
    // `@ts-expect-error` SATISFIED, because TypeScript's excess-property check
    // rejects an unknown key on a fresh literal all by itself. tsc stayed green
    // through the mutation — the assertion was grading a different rule.
    //
    // A variable is not "fresh", so excess-property checking does not apply and
    // `status?: never` is the ONLY thing that can reject this assignment. Delete
    // it and this line compiles, the directive goes unused, and `tsc --noEmit`
    // errors with "Unused '@ts-expect-error' directive". Mutation-verified.
    const smuggled = {
      items: [{ price_id: 'pri_01kzew6dqmtv3jg33dy9m23g31', quantity: 1 }],
      custom_data: { [PADDLE_CUSTOM_DATA_USER_ID]: USER, [PADDLE_CUSTOM_DATA_APP_ID]: 'subly' },
      status: 'billed',
    };
    // @ts-expect-error — `status?: never` admits only `undefined`. [ADR 044] §4.
    const forbidden: PaddleCreateTransactionBody = smuggled;

    // …and the RUNTIME half refuses the same object, because a cast or a spread
    // of parsed JSON reaches here with the key intact and the compiler gone.
    expect(() => serializeCreateTransactionBody(forbidden)).toThrow(/carries 'status'/);
  });

  it('the same holds for the three keys that would make the create `ready`', () => {
    // customer_id / address_id / collection_mode change the CREATED STATUS away
    // from `draft`, which is why they are `?: never` too. Same non-fresh shape,
    // so each directive is load-bearing rather than satisfied by excess-property
    // checking. [ADR 044] §4.
    const withCustomer = { items: [], custom_data: {}, customer_id: 'ctm_1' };
    const withAddress = { items: [], custom_data: {}, address_id: 'add_1' };
    const withMode = { items: [], custom_data: {}, collection_mode: 'manual' };
    // @ts-expect-error — customer_id is `?: never`.
    const a: PaddleCreateTransactionBody = withCustomer;
    // @ts-expect-error — address_id is `?: never`.
    const b: PaddleCreateTransactionBody = withAddress;
    // @ts-expect-error — collection_mode is `?: never`.
    const c: PaddleCreateTransactionBody = withMode;
    for (const body of [a, b, c]) {
      expect(() => serializeCreateTransactionBody(body)).toThrow(/never sends/);
    }
  });

  it('the RUNTIME half refuses EVERY forbidden key, not only `status`', () => {
    const base = buildCreateTransactionBody({ priceId: 'pri_x', userId: USER, appId: 'subly' });
    expect(FORBIDDEN_CREATE_KEYS.length).toBeGreaterThan(0); // an empty set proves nothing
    for (const key of FORBIDDEN_CREATE_KEYS) {
      const tampered = { ...base, [key]: 'anything' } as unknown as PaddleCreateTransactionBody;
      expect(() => serializeCreateTransactionBody(tampered)).toThrow(new RegExp(`carries '${key}'`));
    }
  });

  it('the constructor produces the SAFE SHAPE and nothing else — items + custom_data', () => {
    const body = buildCreateTransactionBody({ priceId: 'pri_x', userId: USER, appId: 'subly' });
    // Parsed structure, not a substring of the serialised text.
    expect(Object.keys(JSON.parse(serializeCreateTransactionBody(body)) as object).sort()).toEqual([
      'custom_data',
      'items',
    ]);
    expect(body.items).toEqual([{ price_id: 'pri_x', quantity: 1 }]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the wire request — what actually leaves the Worker', () => {
  it('POSTs the measured contract to api.paddle.com and returns the checkout url', async () => {
    const h = harness();
    const res = await h.post(BUY, `Bearer ${await token(USER)}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: 'paddle',
      app_id: 'subly',
      offering_id: 'pro_monthly',
      transaction_id: 'txn_01kzs3qcvryq785t7shpq5d7wj',
      checkout_url: 'https://nikatru.com/pricing.html?_ptxn=txn_01kzs3qcvryq785t7shpq5d7wj',
    });

    expect(paddleCalls).toHaveLength(1);
    const call = paddleCalls[0];
    expect(call.url).toBe('https://api.paddle.com/transactions');
    expect(call.method).toBe('POST');
    expect(call.headers.authorization).toBe(`Bearer ${LIVE_KEY}`);
    expect(call.headers['content-type']).toBe('application/json');

    // 🔴 THE KEY SET IS COMPARED AS STRUCTURE. `status` is not merely absent from
    // the value — the key does not exist on the body at all.
    const sent = call.body as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['custom_data', 'items']);
    expect('status' in sent).toBe(false);
    expect(sent.items).toEqual([{ price_id: 'pri_01kzew6dqmtv3jg33dy9m23g31', quantity: 1 }]);
  });

  it('resolves the PRICE ID server-side — a caller can never name a Paddle price', async () => {
    const h = harness();
    // A body that tries to smuggle a price id and a status past the route.
    const res = await h.post(
      { ...BUY, offering_id: 'pro_yearly', price_id: 'pri_someone_elses', status: 'billed' },
      `Bearer ${await token(USER)}`,
    );

    expect(res.status).toBe(200);
    const sent = paddleCalls[0].body as Record<string, unknown>;
    expect(sent.items).toEqual([{ price_id: 'pri_01kzew6e0yec2rfvk561hmzbbz', quantity: 1 }]);
    expect('status' in sent).toBe(false);
    expect('price_id' in sent).toBe(false);
  });

  it('the user id comes from the JWT, never from the body', async () => {
    const h = harness();
    await h.post(
      { ...BUY, user_id: '99999999-9999-4999-8999-999999999999' },
      `Bearer ${await token(USER)}`,
    );
    const sent = paddleCalls[0].body as { custom_data: Record<string, string> };
    expect(sent.custom_data[PADDLE_CUSTOM_DATA_USER_ID]).toBe(USER);
    expect(sent.custom_data[PADDLE_CUSTOM_DATA_APP_ID]).toBe('subly');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('[ADR 044] §6 — the attribution this endpoint exists for', () => {
  it('the custom_data it SENDS is the custom_data the WEBHOOK ADAPTER READS', () => {
    // The defect on file is a notification nobody could attribute. The two ends
    // are two files, so agreement is proven by running one through the other
    // rather than by two string literals that happen to match today.
    const body = buildCreateTransactionBody({ priceId: 'pri_x', userId: USER, appId: 'subly' });

    const parsed = paddleVerifier.parse(
      JSON.stringify({
        event_id: 'evt_01',
        event_type: 'subscription.created',
        occurred_at: '2026-08-12T00:00:00.000Z',
        notification_id: 'ntf_01',
        data: {
          id: 'sub_01kzs3qcvryq785t7shpq5d7wj',
          status: 'trialing',
          transaction_id: 'txn_01kzs3qcvryq785t7shpq5d7wj',
          // ⬅ verbatim, exactly as the create sent it
          custom_data: body.custom_data,
        },
      }),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.notification.subject.kind).toBe('subscription');
    if (parsed.notification.subject.kind !== 'subscription') return;
    expect(parsed.notification.subject.accountUserId).toBe(USER);
    expect(parsed.notification.subject.accountAppId).toBe('subly');
  });

  it('a transaction that comes back WITHOUT our custom_data is REFUSED, not returned', async () => {
    const h = harness();
    paddleResponder = () => okCreate({ customData: {} });

    const res = await h.post(BUY, `Bearer ${await token(USER)}`);

    // Returning the URL anyway would ship §6's defect again while looking green:
    // every subscription event for that transaction would be unattributable.
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'checkout_unavailable' });
  });

  it('custom_data echoed for ANOTHER user is refused too', async () => {
    const h = harness();
    paddleResponder = () =>
      okCreate({
        customData: {
          [PADDLE_CUSTOM_DATA_USER_ID]: '99999999-9999-4999-8999-999999999999',
          [PADDLE_CUSTOM_DATA_APP_ID]: 'subly',
        },
      });

    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(502);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('fail CLOSED on everything upstream — never a partial success', () => {
  const upstreamFailures: Array<[string, () => Response | Promise<Response>]> = [
    ['400 with a vendor error envelope', () =>
      new Response(JSON.stringify({ error: { code: 'invalid_field', detail: 'nope' } }), { status: 400 })],
    ['401 (the key was revoked)', () => new Response('{}', { status: 401 })],
    ['429', () => new Response('{}', { status: 429 })],
    ['500', () => new Response('{}', { status: 500 })],
    ['a 2xx body that is not JSON', () => new Response('<html>maintenance</html>', { status: 201 })],
    ['a 2xx body with no `data`', () => new Response(JSON.stringify({ meta: {} }), { status: 201 })],
    ['a created transaction with NO checkout url', () => okCreate({ url: null })],
    ['a checkout url that is not https', () => okCreate({ url: 'javascript:alert(1)' })],
    ['a transaction id that is not a txn_ handle', () => okCreate({ id: 'not-a-transaction' })],
  ];

  for (const [name, responder] of upstreamFailures) {
    it(`${name} ⇒ 502 checkout_unavailable, and no upstream detail leaks`, async () => {
      const h = harness();
      paddleResponder = responder;

      const res = await h.post(BUY, `Bearer ${await token(USER)}`);

      expect(res.status).toBe(502);
      // The whole body, compared: no `detail`, no vendor code, no transaction id
      // that a client could mistake for a usable one.
      expect(await res.json()).toEqual({ error: 'checkout_unavailable' });
    });
  }

  it('🔴 a status that is NOT `draft` is refused — `billed` above all', async () => {
    const h = harness();
    paddleResponder = () => okCreate({ status: 'billed' });

    const res = await h.post(BUY, `Bearer ${await token(USER)}`);

    // Reaching here means the request that left the Worker was not the request
    // the route describes. Refusing does not undo the invoice — the log is what
    // surfaces it — but handing back a checkout url would hide it completely.
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'checkout_unavailable' });
  });

  it('`ready` is refused too — it is not the shape this create produces', async () => {
    const h = harness();
    paddleResponder = () => okCreate({ status: 'ready' });
    expect((await h.post(BUY, `Bearer ${await token(USER)}`)).status).toBe(502);
  });

  it('a REJECTED fetch ⇒ 502, and the transaction may exist unseen', async () => {
    // ⬜ SAY WHAT THIS DOES AND DOES NOT PROVE. It fires the `catch` a timeout
    // would take, with the error a timeout produces — it does NOT exercise
    // `AbortSignal.timeout` itself, because `fetch` is stubbed and the signal is
    // never consulted. The wiring of that signal is unverified here and could
    // only be verified against a real slow upstream.
    const h = harness();
    paddleResponder = () => {
      throw new Error('The operation was aborted due to timeout');
    };

    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'checkout_unavailable' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('the refusals that happen BEFORE any transaction is created', () => {
  const noCall = () => expect(paddleCalls).toHaveLength(0);

  it('UNAUTHENTICATED is 401 specifically, and Paddle is never called', async () => {
    const h = harness();
    const res = await h.post(BUY);
    expect(res.status).toBe(401);
    noCall();
  });

  it('the SHIPPED state — paywall.enabled=false — is 403 and creates nothing', async () => {
    // No KV override: exactly what production serves today. [ADR 044] §5(4).
    const h = harness({ kv: null });
    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'paywall_disabled' });
    noCall();
  });

  it('an UNKNOWN app is 404 and creates nothing', async () => {
    const h = harness();
    const res = await h.post({ ...BUY, app_id: 'not_an_app' }, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_app' });
    noCall();
  });

  it('an offering the app does NOT sell is 404 and creates nothing', async () => {
    const h = harness();
    const res = await h.post({ ...BUY, offering_id: 'pro_lifetime' }, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'unknown_offering' });
    noCall();
  });

  it('an offering SERVED but not priced on the rail is 503 — our fault, not theirs', async () => {
    // The drift this branch exists for, constructed: the config offers a third
    // SKU and PADDLE_PRICE_IDS has no price for it.
    const h = harness({
      kv: JSON.stringify({
        paywall: { enabled: true, offerings: [{ product_id: 'pro_lifetime' }] },
      }),
    });
    const res = await h.post({ ...BUY, offering_id: 'pro_lifetime' }, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'offering_not_available' });
    noCall();
  });

  it('an UNDECLARED money environment is 503 — no default in either direction', async () => {
    const h = harness({ environment: null });
    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'money_rail_not_configured' });
    noCall();
  });

  it('an UNRECOGNISED money environment is 503 too', async () => {
    const h = harness({ environment: 'staging' });
    expect((await h.post(BUY, `Bearer ${await token(USER)}`)).status).toBe(503);
    noCall();
  });

  it('NO api key is 503 checkout_not_configured', async () => {
    const h = harness({ apiKey: null });
    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'checkout_not_configured' });
    noCall();
  });

  it('🔴 a SANDBOX key on a LIVE deploy is 503 — the credential must match the world', async () => {
    // [5]M-12's constructible input for this route: the two API-key prefixes ARE
    // documented (V11), unlike the destination secret, so this is the one place
    // the worlds can be told apart — and a live deploy holding a sandbox key
    // would otherwise create transactions in a world nobody is watching.
    const h = harness({ environment: 'live', apiKey: SANDBOX_KEY });
    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'checkout_not_configured' });
    noCall();
  });

  it('a LIVE key on a SANDBOX deploy is refused in the same direction', async () => {
    const h = harness({ environment: 'sandbox', apiKey: LIVE_KEY });
    expect((await h.post(BUY, `Bearer ${await token(USER)}`)).status).toBe(503);
    noCall();
  });

  it('a body that is not JSON is 400 and creates nothing', async () => {
    const h = harness();
    const res = await h.post('not json at all', `Bearer ${await token(USER)}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
    noCall();
  });

  it('an over-cap body is 413 and creates nothing', async () => {
    const h = harness();
    const res = await h.post(
      { ...BUY, pad: 'x'.repeat(MAX_CHECKOUT_BODY_BYTES + 100) },
      `Bearer ${await token(USER)}`,
    );
    expect(res.status).toBe(413);
    noCall();
  });

  it('the ceiling refuses BEFORE the subrequest — an accepted request is undeletable', async () => {
    const h = harness({
      limiter: { limit: async () => ({ success: false }) } as RateLimiterBinding,
    });
    const res = await h.post(BUY, `Bearer ${await token(USER)}`);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    noCall();
  });

  it('a limiter that ALLOWS lets the create through — the 429 above is not a constant', async () => {
    const h = harness({
      limiter: { limit: async () => ({ success: true }) } as RateLimiterBinding,
    });
    expect((await h.post(BUY, `Bearer ${await token(USER)}`)).status).toBe(200);
    expect(paddleCalls).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe('REQUIRED_COVERAGE — the price map and the served offerings cannot drift apart', () => {
  it('the map is not empty (an empty map makes every unknown_offering test vacuous)', () => {
    expect(Object.keys(PADDLE_PRICE_IDS).length).toBeGreaterThan(0);
  });

  it('every app in the price map is an app this Worker serves', () => {
    for (const appId of Object.keys(PADDLE_PRICE_IDS)) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_CONFIGS, appId)).toBe(true);
    }
  });

  it('every SERVED offering has a price id, and every price id has a served offering', () => {
    // 🔴 BOTH DIRECTIONS, and the second is the one that catches the real drift:
    // adding a third SKU to src/app-config-data.json without a `pri_` id here
    // would otherwise ship an offering the paywall shows and the rail refuses.
    let compared = 0;
    for (const appId of Object.keys(DEFAULT_CONFIGS)) {
      const cfg = baseConfig(appId);
      if (cfg === null) continue;
      const offerings = (cfg.paywall.offerings ?? []) as Array<{ product_id?: unknown }>;
      const served = offerings
        .map((o) => o.product_id)
        .filter((p): p is string => typeof p === 'string')
        .sort();
      const priced = Object.keys(PADDLE_PRICE_IDS[appId] ?? {}).sort();
      if (served.length === 0 && priced.length === 0) continue;
      expect(priced, `price ids for ${appId}`).toEqual(served);
      compared += served.length;
    }
    // The self-check: a scan that reached nothing must not report a pass.
    expect(compared, 'offerings compared').toBeGreaterThan(0);
  });

  it('every mapped price id has the documented `pri_` shape', () => {
    for (const byOffering of Object.values(PADDLE_PRICE_IDS)) {
      for (const priceId of Object.values(byOffering)) {
        expect(priceId).toMatch(/^pri_[A-Za-z0-9]{20,}$/);
      }
    }
  });
});
