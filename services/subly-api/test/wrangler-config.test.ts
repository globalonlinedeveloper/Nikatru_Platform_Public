import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import raw from '../wrangler.jsonc?raw';

// ─────────────────────────────────────────────────────────────────────────────
// The DEPLOYED half of this Worker's configuration.
//
// cors.test.ts proves the MIDDLEWARE denies an origin that is not listed. That
// is now a fail-closed rule, so the config it reads became load-bearing in the
// other direction: clearing `vars.ALLOWED_ORIGINS` takes the live web app
// offline, and `tsc --noEmit` and `wrangler deploy --dry-run` — the only two
// checks this Worker had — never inspect a var's contents. The unit tests inject
// their own bindings, so they cannot see it either.
//
// Asserted on PARSED STRUCTURE, never by grepping the file's prose: a
// wrangler.jsonc here is mostly comments, several of which name the very
// strings being looked for. Same discipline as
// services/platform/test/wrangler-breaker.test.ts and
// tooling/ci/assert-d1-bindings.mjs.
//
// tooling/ci/assert-cors-allowlist.mjs asserts the same allowlist across EVERY
// Worker; this file is the per-Worker copy that runs in this Worker's own lane.
// ─────────────────────────────────────────────────────────────────────────────

/** JSONC → JSON. Comments stripped (string literals respected, so a `//` inside
 *  a url survives) and trailing commas removed. */
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

interface D1Entry {
  binding?: string;
  database_name?: string;
  database_id?: string;
  migrations_dir?: string;
}
const cfg = parseJsonc(raw) as {
  name?: string;
  vars?: Record<string, unknown>;
  d1_databases?: D1Entry[];
};

describe('the parse itself reached the config', () => {
  it('self-check — every assertion below would pass vacuously over an empty parse', () => {
    expect(raw).toContain('ALLOWED_ORIGINS');
    expect(cfg.name).toBe('subly-api');
    expect(Object.keys(cfg.vars ?? {}).length).toBeGreaterThanOrEqual(4);
    expect((cfg.d1_databases ?? []).length).toBe(2);
  });
});

describe('vars.MONEY_ENVIRONMENT — load-bearing since both money doors 503 without it', () => {
  // [5]M-12: the RevenueCat webhook and /v1/entitlements each answer 503 when
  // this var is absent or unrecognised. A deploy that lost it would not fail a
  // health check — it would fail every entitlement read. Production is 'live'
  // by definition; a sandbox deploy edits this knowingly.
  it("is declared and is exactly 'live'", () => {
    expect(cfg.vars?.MONEY_ENVIRONMENT).toBe('live');
  });
});

describe('vars.ALLOWED_ORIGINS — load-bearing since CORS fails closed', () => {
  const listed = String(cfg.vars?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  it('is a non-empty exact allowlist', () => {
    expect(typeof cfg.vars?.ALLOWED_ORIGINS).toBe('string');
    expect(
      listed.length,
      'an empty list denies every non-localhost browser origin — the web app goes dark',
    ).toBeGreaterThan(0);
  });

  it('lists the live web origin and the Pages preview origin', () => {
    for (const origin of ['https://subly.nikatru.com', 'https://subly-9cp.pages.dev']) {
      expect(listed, `missing ${origin}`).toContain(origin);
    }
  });

  it('carries no wildcard and no scheme-less or trailing-slash entry', () => {
    for (const o of listed) {
      expect(o, 'wildcards are not an allowlist').not.toContain('*');
      expect(o, `${o} must be a full origin`).toMatch(/^https?:\/\/[^/]+$/);
    }
  });

  it('does NOT list localhost — that is handled by the middleware regex', () => {
    // Listing it would imply the config must carry something it does not, and
    // the CI harness's port is unknowable in advance anyway.
    expect(listed.some((o) => o.includes('localhost'))).toBe(false);
  });
});

describe('the clone contract this Worker is the template for', () => {
  const byBinding = new Map((cfg.d1_databases ?? []).map((d) => [d.binding, d]));

  it('binds the PER-APP database with its own migrations dir', () => {
    const app = byBinding.get('APP_DB');
    expect(app).toBeDefined();
    expect(app!.database_name).toBe('subly_db');
    expect(app!.migrations_dir).toBe('migrations');
  });

  it('binds the SHARED platform database and does NOT claim to migrate it', () => {
    // services/platform is the sole applier. A second migrations_dir pointed at
    // platform_db is a portfolio-wide outage waiting for a `wrangler d1
    // migrations apply`.
    const platform = byBinding.get('PLATFORM_DB');
    expect(platform).toBeDefined();
    expect(platform!.database_name).toBe('platform_db');
    expect(platform!.migrations_dir).toBeUndefined();
  });

  it('every D1 binding carries a real database_id, not the brick placeholder', () => {
    for (const d of cfg.d1_databases ?? []) {
      expect(d.database_id, `${d.binding} has no id`).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(d.database_id, `${d.binding} still holds the all-zeros placeholder`).not.toMatch(
        /^0{8}-/,
      );
    }
  });
});
