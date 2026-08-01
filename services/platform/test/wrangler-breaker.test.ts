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

describe('wrangler.jsonc declares BOTH halves of the cost circuit breaker', () => {
  it('the parse itself reached the ratelimits block', () => {
    // Self-check: if the file moves or the parser breaks, every assertion below
    // would range over an empty set and pass vacuously.
    expect(raw).toContain('ratelimits');
    expect(rl.length).toBeGreaterThanOrEqual(2);
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

  it('the two limiters have DISTINCT namespace ids, so they do not share a budget', () => {
    const ids = rl.map((e) => String(e.namespace_id));
    expect(new Set(ids).size, `namespace_id collision among ${ids.join(', ')}`).toBe(ids.length);
    for (const id of ids) expect(id, 'namespace_id must be a non-empty string').toMatch(/^\d+$/);
  });
});
