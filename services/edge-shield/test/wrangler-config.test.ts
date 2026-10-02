import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import raw from '../wrangler.jsonc?raw';
import platformRaw from '../../platform/wrangler.jsonc?raw';
import zoneRuleRaw from '../../../tooling/edge-ratelimit-rule.json?raw';
import { AUTH_HOST, CLASSES, INTAKE_HOST, type ShieldClass } from '../src/classify';
import { failOpenSeen } from '../src/limit';

// ─────────────────────────────────────────────────────────────────────────────
// The DEPLOYED half of the shield. Every limiter binding is optional in
// src/types.ts and FAILS OPEN when absent (src/limit.ts) — deliberately — so
// deleting one from wrangler.jsonc would switch that limit off in production
// while every test in shield.test.ts, which injects its own bindings, stayed
// green. The config is therefore asserted here on PARSED STRUCTURE, the same
// discipline services/platform/test/wrangler-breaker.test.ts applies.
// ─────────────────────────────────────────────────────────────────────────────

/** JSONC → JSON: comments stripped (string literals respected), trailing commas removed. */
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
interface Config {
  name?: unknown;
  main?: unknown;
  workers_dev?: unknown;
  routes?: Array<{ pattern?: unknown; zone_name?: unknown; custom_domain?: unknown }>;
  ratelimits?: RateLimitEntry[];
  vars?: unknown;
  env?: Record<string, { ratelimits?: RateLimitEntry[] }>;
}

const cfg = parseJsonc(raw) as Config;
const rl = cfg.ratelimits ?? [];
const byName = new Map(rl.map((e) => [String(e.name), e]));

/** The binding name a class reads, recovered from the class table's own accessor. */
function bindingOf(cls: ShieldClass): string {
  let read = '';
  const env = new Proxy({}, { get: (_t, p) => ((read = String(p)), undefined) });
  CLASSES[cls].global(env);
  return read;
}

describe('the deployed edge-shield config', () => {
  it('is bound by exactly two ZONE routes — never a custom domain, which would take the tunnel host’s DNS record', () => {
    expect(cfg.name).toBe('edge-shield');
    expect(cfg.main).toBe('src/index.ts');
    expect(cfg.routes).toEqual([
      { pattern: `${AUTH_HOST}/auth/v1/*`, zone_name: 'nikatru.com' },
      { pattern: `${INTAKE_HOST}/api/*`, zone_name: 'nikatru.com' },
    ]);
    for (const r of cfg.routes ?? []) expect(r.custom_domain).toBeUndefined();
  });

  it('has no *.workers.dev door and no vars', () => {
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.vars).toBeUndefined();
  });

  it('declares the global limiter of EVERY class, with the period the refusal’s Retry-After promises', () => {
    const classes = Object.keys(CLASSES) as ShieldClass[];
    expect(classes.length).toBe(6);
    const wanted = new Set<string>();
    for (const cls of classes) {
      const name = bindingOf(cls);
      expect(name, `${cls}: the class table reads no binding`).toMatch(/^[A-Z_]+_GLOBAL_LIMITER$/);
      wanted.add(name);
      const e = byName.get(name);
      expect(e, `${cls}: ${name} is not declared, so it fails open in production`).toBeDefined();
      expect(e!.simple?.period, `${name}'s period`).toBe(CLASSES[cls].period);
      expect(Number.isInteger(e!.simple?.limit) && (e!.simple!.limit as number) > 0, `${name}'s limit`).toBe(true);
    }
    // …and nothing is declared that no class reads.
    expect(new Set(byName.keys())).toEqual(wanted);
  });

  it('🔴 declares NO per-client limiter: the Worker never reads a client address (LEAD RULING SHIELD-R3)', () => {
    // The per-IP limit on the credential paths is the zone's rate-limiting rule
    // (tooling/edge-ratelimit-rule.json), never a binding here.
    for (const name of byName.keys()) expect(name).not.toMatch(/_IP_|CLIENT/);
    expect(rl.length).toBe(Object.keys(CLASSES).length);
  });

  it('🔴 each credential class has its OWN cap, and none the zone rule covers is fillable by fewer than 10 addresses at its per-IP rate (SYN-A2 / PB-01)', () => {
    // A global cap is lockable by about cap ÷ the per-IP rate. The per-IP rate is
    // the zone's one rate-limiting rule (tooling/edge-ratelimit-rule.json), which
    // covers the sign-up/recover and factor paths, so this is the residual its
    // _why records: 300/min ÷ 30/min = 10 addresses per colo, per covered class.
    // auth-password is NOT covered: /auth/v1/token stays out of the zone rule
    // (lead ruling on PR #1147, item 1 — a per-IP 429 on the refresh grant signs
    // native users behind carrier-grade NAT out), so it only needs its own bucket.
    const zone = JSON.parse(zoneRuleRaw) as { rules: Array<{ expression: string; ratelimit: { period: number; requests_per_period: number } }> };
    expect(zone.rules).toHaveLength(1);
    expect(zone.rules[0].expression).not.toContain('/auth/v1/token');
    const { period, requests_per_period } = zone.rules[0].ratelimit;
    const perIpPerMinute = (requests_per_period * 60) / period;
    expect(perIpPerMinute).toBe(30);
    const credential: ShieldClass[] = ['auth-password', 'auth-signup-recover', 'auth-factor'];
    const names = credential.map(bindingOf);
    expect(new Set(names).size, 'two credential classes read one binding').toBe(3);
    expect(new Set(names.map((n) => String(byName.get(n)?.namespace_id))).size, 'two credential bindings share a namespace').toBe(3);
    const covered: ShieldClass[] = ['auth-signup-recover', 'auth-factor'];
    for (const n of covered.map(bindingOf)) {
      const simple = byName.get(n)?.simple;
      const perMinute = ((simple?.limit as number) * 60) / (simple?.period as number);
      expect(perMinute / perIpPerMinute, `${n} is lockable by ${perMinute / perIpPerMinute} addresses per colo`).toBeGreaterThanOrEqual(10);
    }
  });

  it('owns its namespace_ids: unique here, and used by no limiter of services/platform (they are account-wide)', () => {
    const ids = rl.map((e) => String(e.namespace_id));
    for (const id of ids) expect(id).toMatch(/^\d+$/);
    expect(new Set(ids).size).toBe(ids.length);
    const platform = parseJsonc(platformRaw) as Config;
    const taken = new Set<string>();
    for (const e of platform.ratelimits ?? []) taken.add(String(e.namespace_id));
    for (const env of Object.values(platform.env ?? {})) for (const e of env.ratelimits ?? []) taken.add(String(e.namespace_id));
    expect(taken.size).toBeGreaterThan(0);
    for (const id of ids) expect(taken.has(id), `namespace_id ${id} is already services/platform's`).toBe(false);
  });

  it('the fail-open counter is live in this isolate (a number, never reset)', () => {
    expect(Number.isInteger(failOpenSeen())).toBe(true);
  });
});
