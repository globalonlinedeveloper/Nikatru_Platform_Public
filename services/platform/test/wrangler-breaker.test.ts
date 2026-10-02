import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import raw from '../wrangler.jsonc?raw';

// ─────────────────────────────────────────────────────────────────────────────
// The DEPLOYED half of the cost circuit breaker.
//
// events.ts fails OPEN when a limiter binding is absent — deliberately, because
// dropping real analytics over a missing binding is worse than the burst it
// would have stopped. The cost of that choice is that DELETING a binding from
// wrangler.jsonc disables the breaker in production while every unit test in
// this suite stays green, because the tests inject the bindings themselves.
// That is the exact shape this repo keeps getting bitten by: a guard that stops
// guarding and still prints healthy.
//
// So the deployed config is asserted here, on PARSED STRUCTURE — never by
// grepping the file's prose, which is full of the words being looked for.
// ─────────────────────────────────────────────────────────────────────────────

/** JSONC → JSON. Comments stripped (string literals respected, so a `//` inside
 *  a url survives) and trailing commas removed. Same discipline as
 *  tooling/ci/assert-d1-bindings.mjs. */
function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') {
        out += c + (c2 ?? '');
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

interface RateLimitEntry {
  name?: unknown;
  namespace_id?: unknown;
  simple?: { limit?: unknown; period?: unknown };
}

const cfg = parseJsonc(raw) as { ratelimits?: RateLimitEntry[] };
const rl = cfg.ratelimits ?? [];
const byName = new Map(rl.map((e) => [String(e.name), e]));
/** env.sandbox's own `ratelimits` (wrangler inherits none of them). */
const sandboxRl = () =>
  ((parseJsonc(raw) as { env?: { sandbox?: { ratelimits?: RateLimitEntry[] } } }).env?.sandbox?.ratelimits ?? []);

describe('wrangler.jsonc declares BOTH halves of the cost circuit breaker', () => {
  it('the parse itself reached the ratelimits block', () => {
    // Self-check: if the file moves or the parser breaks, every assertion below
    // would range over an empty set and pass vacuously.
    expect(raw).toContain('ratelimits');
    expect(rl.length).toBeGreaterThanOrEqual(3);
  });

  it('declares the client-keyed FAIRNESS bucket', () => {
    const e = byName.get('EVENTS_LIMITER');
    expect(e, 'EVENTS_LIMITER missing from wrangler.jsonc').toBeDefined();
    expect(e!.simple?.limit).toBe(120);
    expect(e!.simple?.period).toBe(60);
  });

  it('declares the SERVER-DERIVED ceiling, without which the breaker fails open', () => {
    // events.ts is written so that an absent EVENTS_CEILING_LIMITER allows every
    // request. Deleting this entry therefore restores the original defect —
    // an unauthenticated write path with no ceiling a caller cannot rotate out
    // of — and no other test in this suite would notice.
    const e = byName.get('EVENTS_CEILING_LIMITER');
    expect(e, 'EVENTS_CEILING_LIMITER missing — the breaker silently fails OPEN').toBeDefined();
    expect(e!.simple?.limit).toBe(600);
    expect(e!.simple?.period).toBe(60);
  });

  it('declares the ceiling for GET /config/:app, the OTHER public route that does I/O', () => {
    // routes/config.ts fails OPEN without it, for the same reason and with the
    // same cost: deleting this entry silently removes the only bound on how many
    // free-tier KV reads an anonymous caller can spend, because `s-maxage=300`
    // does not collapse requests that carry a cache-busting query string. No
    // unit test can see that — they inject the binding themselves.
    const e = byName.get('CONFIG_CEILING_LIMITER');
    expect(e, 'CONFIG_CEILING_LIMITER missing — /config has no ceiling again').toBeDefined();
    expect(e!.simple?.limit).toBe(1200);
    expect(e!.simple?.period).toBe(60);
  });

  it('declares the ceiling for GET /v1/fx/latest, the public rate table', () => {
    // ⏱ 2026-09-28 · ST-I3. routes/fx.ts fails OPEN without it, so deleting this
    // entry removes the only bound on how many KV reads a cache-busting caller
    // can spend — and no runtime test can see that, because the limiter fails
    // open. Its own namespace: config resolution's budget is not its to spend.
    const e = byName.get('FX_CEILING_LIMITER');
    expect(e, 'FX_CEILING_LIMITER missing — /v1/fx/latest has no ceiling').toBeDefined();
    expect(String(e!.namespace_id)).toBe('1015');
    expect(e!.simple?.limit).toBe(1200);
    expect(e!.simple?.period).toBe(60);
  });

  it('declares the ceiling for POST /v1/ext/token, the extension code exchange', () => {
    // ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT. routes/ext.ts fails OPEN
    // without it (src/lib/edge-ceiling.ts), so deleting this entry removes the
    // only burst bound on an unauthenticated route that burns a D1 write per
    // guess — and no runtime test can see that, because the limiter fails open.
    const e = byName.get('EXT_TOKEN_CEILING_LIMITER');
    expect(e, 'EXT_TOKEN_CEILING_LIMITER missing — /v1/ext/token has no ceiling').toBeDefined();
    expect(String(e!.namespace_id)).toBe('1005');
    expect(e!.simple?.limit).toBe(60);
    expect(e!.simple?.period).toBe(60);
  });

  it('declares the per-account bucket for the /v1/sessions routes', () => {
    // ⏱ 2026-09-25 · AUTH-REVOKE-AT-WORKERS. routes/sessions.ts fails OPEN without
    // it, so deleting this entry removes the only bound on the revocation list's
    // KV writes (kv.writesPerDay) and on the service-role RPC behind every route.
    const e = byName.get('SESSIONS_LIMITER');
    expect(e, 'SESSIONS_LIMITER missing — /v1/sessions has no bound').toBeDefined();
    expect(String(e!.namespace_id)).toBe('1011');
    expect(e!.simple?.limit).toBe(5);
    expect(e!.simple?.period).toBe(60);
  });

  it('declares BOTH native sign-in limiters, at the top level AND in env.sandbox, each in its own namespace', () => {
    // ⏱ 2026-09-28 · ST-N1. routes/native-auth.ts FAILS CLOSED without these
    // (lib/edge-ceiling.ts strictRateLimit), so a deleted entry is not a silent
    // open door the way it is for the limiters above — it is every native
    // sign-in answering 503 in that deploy. Asserted here because the unit tests
    // inject the bindings themselves and cannot see the deployed config.
    const top = { NATIVE_AUTH_ACCOUNT_LIMITER: ['1017', 5], NATIVE_AUTH_EDGE_LIMITER: ['1018', 60] } as const;
    const sandbox = { NATIVE_AUTH_ACCOUNT_LIMITER: ['1019', 5], NATIVE_AUTH_EDGE_LIMITER: ['1020', 60] } as const;
    const sbRl = sandboxRl();
    const sbByName = new Map(sbRl.map((e) => [String(e.name), e]));
    for (const [where, map, want] of [
      ['top level', byName, top],
      ['env.sandbox', sbByName, sandbox],
    ] as const) {
      for (const [name, [id, limit]] of Object.entries(want)) {
        const e = map.get(name);
        expect(e, `${name} missing from ${where} — every native sign-in there answers 503`).toBeDefined();
        expect(String(e!.namespace_id), `${where} ${name}`).toBe(id);
        expect(e!.simple?.limit, `${where} ${name}`).toBe(limit);
        expect(e!.simple?.period, `${where} ${name}`).toBe(60);
      }
    }
    // A namespace id is ACCOUNT-WIDE: no sandbox id may be a top-level one.
    const topIds = new Set(rl.map((e) => String(e.namespace_id)));
    for (const e of sbRl) expect(topIds.has(String(e.namespace_id)), `env.sandbox ${String(e.name)} reuses ${String(e.namespace_id)}`).toBe(false);
  });

  // ⏱ 2026-10-01 · rv2-services-016. Two limiters the deployed config carries in
  // BOTH places and no test held: deleting either entry from either block left
  // this file green. Both fail OPEN (lib/edge-ceiling.ts), so a deleted entry is
  // a silent open door — the unit tests inject the bindings themselves.
  //   · REMINDERS_CEILING_LIMITER — the public calendar feed and the one-click
  //     unsubscribe (routes/calendar.ts, routes/reminders.ts), a D1 read per
  //     token guess with no other bound;
  //   · MONEY_CEILING_LIMITER — POST /v1/money/:provider and the store-receipt
  //     route, where a forged flood costs a signature check and a D1 read each.
  for (const [name, [topId, sandboxId, limit]] of Object.entries({
    REMINDERS_CEILING_LIMITER: ['1013', '1014', 300],
    MONEY_CEILING_LIMITER: ['1004', '1006', 120],
  } as const)) {
    it(`declares ${name} at the top level (${topId}) AND in env.sandbox (${sandboxId})`, () => {
      const sbByName = new Map(sandboxRl().map((e) => [String(e.name), e]));
      for (const [where, e, id] of [
        ['top level', byName.get(name), topId],
        ['env.sandbox', sbByName.get(name), sandboxId],
      ] as const) {
        expect(e, `${name} missing from ${where} — that deploy's breaker silently fails OPEN`).toBeDefined();
        expect(String(e!.namespace_id), `${where} ${name}`).toBe(id);
        expect(e!.simple?.limit, `${where} ${name}`).toBe(limit);
        expect(e!.simple?.period, `${where} ${name}`).toBe(60);
      }
    });
  }

  it('declares BOTH checkout limiters, at the top level AND in env.sandbox, each in its own namespace', () => {
    // ⏱ 2026-10-01 · O-ST-CHECKOUT-UNBOUNDED. routes/checkout.ts read
    // CHECKOUT_CEILING_LIMITER while no wrangler.jsonc bound it ("HONEST GAP"), so
    // POST /v1/checkout — every accepted call an undeletable Paddle transaction —
    // was bounded by auth alone. The edge ceiling fails OPEN and the per-user
    // bucket fails CLOSED; the unit tests inject both, so only this sees a deletion.
    const top = { CHECKOUT_CEILING_LIMITER: ['1027', 60], CHECKOUT_USER_LIMITER: ['1029', 5] } as const;
    const sandbox = { CHECKOUT_CEILING_LIMITER: ['1028', 60], CHECKOUT_USER_LIMITER: ['1030', 5] } as const;
    const sbRl = sandboxRl();
    const sbByName = new Map(sbRl.map((e) => [String(e.name), e]));
    for (const [where, map, want] of [
      ['top level', byName, top],
      ['env.sandbox', sbByName, sandbox],
    ] as const) {
      for (const [name, [id, limit]] of Object.entries(want)) {
        const e = map.get(name);
        expect(e, `${name} missing from ${where} — POST /v1/checkout is unbounded there`).toBeDefined();
        expect(String(e!.namespace_id), `${where} ${name}`).toBe(id);
        expect(e!.simple?.limit, `${where} ${name}`).toBe(limit);
        expect(e!.simple?.period, `${where} ${name}`).toBe(60);
      }
    }
    const sbIds = sbRl.map((e) => String(e.namespace_id));
    expect(new Set(sbIds).size, `env.sandbox namespace_id collision among ${sbIds.join(', ')}`).toBe(sbIds.length);
  });

  it('the three limiters have DISTINCT namespace ids, so they do not share a budget', () => {
    const ids = rl.map((e) => String(e.namespace_id));
    expect(new Set(ids).size, `namespace_id collision among ${ids.join(', ')}`).toBe(ids.length);
    for (const id of ids) expect(id, 'namespace_id must be a non-empty string').toMatch(/^\d+$/);
  });
});

// ⏱ 2026-09-30 · O-CALENDAR-TOKEN-SHIPPED-TO-ERROR-SINK. Workers Logs' invocation
// log records the full request URL, and two of this Worker's URLs carry a
// capability token (the calendar feed's path, the unsubscribe link's `?t=`).
// Nothing redacts a field of that log, so it must stay off.
describe('Workers Logs keep no request URL', () => {
  const obs = (parseJsonc(raw) as { observability?: { enabled?: unknown; logs?: { invocation_logs?: unknown } } })
    .observability;
  it('invocation logs are OFF, while observability itself stays on', () => {
    expect(obs?.enabled).toBe(true);
    expect(obs?.logs?.invocation_logs).toBe(false);
  });
  it('env.sandbox does not switch them back on', () => {
    const sandbox = (parseJsonc(raw) as { env?: { sandbox?: { observability?: { logs?: { invocation_logs?: unknown } } } } })
      .env?.sandbox?.observability;
    // wrangler REPLACES `observability` per environment, it does not merge it: a
    // sandbox block that omits `invocation_logs` gets Cloudflare's default, ON.
    // So the sandbox either inherits the top-level block whole, or says false itself.
    expect(sandbox === undefined || sandbox.logs?.invocation_logs === false).toBe(true);
  });
});
