import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import raw from '../wrangler.jsonc?raw';

// ─────────────────────────────────────────────────────────────────────────────
// wrangler-config.test.ts — THE DEPLOYED CONFIG, on parsed structure: the
// bindings the intake's privacy and abuse claims rest on, and the sandbox twin
// the brick stamps (tooling/ci/assert-platform-register.mjs limb 8 holds every
// config's twins across the repository).
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
interface KvEntry {
  binding?: string;
  id?: string;
}
interface R2Entry {
  binding?: string;
  bucket_name?: string;
}
interface RlEntry {
  name?: string;
  namespace_id?: string;
  simple?: { limit?: number; period?: number };
}
interface Block {
  name?: string;
  routes?: unknown[];
  workers_dev?: boolean;
  triggers?: { crons?: unknown[] };
  vars?: Record<string, unknown>;
  d1_databases?: D1Entry[];
  kv_namespaces?: KvEntry[];
  r2_buckets?: R2Entry[];
  ratelimits?: RlEntry[];
  services?: unknown[];
  env?: Record<string, Block>;
}
const cfg = parseJsonc(raw) as Block;
const sandbox = cfg.env?.sandbox;

const d1 = (b: Block | undefined, binding: string) => (b?.d1_databases ?? []).find((d) => d.binding === binding);
const kv = (b: Block | undefined, binding: string) => (b?.kv_namespaces ?? []).find((k) => k.binding === binding);
const bindingNames = (b: Block | undefined) => [
  ...(b?.d1_databases ?? []).map((d) => `d1:${d.binding}`),
  ...(b?.kv_namespaces ?? []).map((k) => `kv:${k.binding}`),
  ...(b?.r2_buckets ?? []).map((r) => `r2:${r.binding}`),
  ...(b?.ratelimits ?? []).map((r) => `rl:${r.name}`),
  ...Object.keys(b?.vars ?? {}).map((v) => `var:${v}`),
];

describe('the parse itself reached the config', () => {
  it('self-check — the top level binds PLATFORM_DB, SCREENSHOTS, JWKS_CACHE and SESSION_REVOKED', () => {
    expect(cfg.name).toBe('feedback');
    expect(bindingNames(cfg).sort()).toEqual(
      expect.arrayContaining(['d1:PLATFORM_DB', 'r2:SCREENSHOTS', 'kv:JWKS_CACHE', 'kv:SESSION_REVOKED', 'rl:FEEDBACK_EDGE_LIMITER']),
    );
  });
});

describe('the intake binds what its claims rest on', () => {
  it('🔴 PLATFORM_DB is platform_db (APAC) and is NEVER migrated from here', () => {
    expect(d1(cfg, 'PLATFORM_DB')).toMatchObject({ database_name: 'platform_db' });
    expect(d1(cfg, 'PLATFORM_DB')?.migrations_dir).toBeUndefined();
    expect(cfg.d1_databases).toHaveLength(1);
  });

  it('🔴 the screenshots go to their OWN private bucket, never the backup bucket', () => {
    expect(cfg.r2_buckets).toEqual([{ binding: 'SCREENSHOTS', bucket_name: 'nikatru-feedback' }]);
  });

  it('🔴 the go-live flag ships CLOSED', () => {
    expect(cfg.vars?.INTAKE_OPEN).toBe('false');
    expect(sandbox?.vars?.INTAKE_OPEN).toBe('false');
  });

  it('🔴 the burst limiter is bound in both environments, on namespaces of its own', () => {
    expect(cfg.ratelimits?.find((r) => r.name === 'FEEDBACK_EDGE_LIMITER')?.namespace_id).toBe('1201');
    expect(sandbox?.ratelimits?.find((r) => r.name === 'FEEDBACK_EDGE_LIMITER')?.namespace_id).toBe('1202');
  });

  it('one label deep (ADR 080), and the nightly purge is scheduled', () => {
    expect(cfg.routes).toEqual([{ pattern: 'feedback.nikatru.com', custom_domain: true }]);
    expect((cfg.triggers?.crons ?? []).length).toBe(1);
  });
});

describe('env.sandbox — declared, and off production', () => {
  it('🔴 it declares routes: [], workers_dev: true and no crons — wrangler would INHERIT each', () => {
    expect(sandbox?.routes).toEqual([]);
    expect(sandbox?.workers_dev).toBe(true);
    expect(sandbox?.triggers?.crons).toEqual([]);
  });

  it('🔴 every top-level binding and var is twinned in it, by name', () => {
    const twinned = new Set(bindingNames(sandbox));
    const missing = bindingNames(cfg).filter((n) => !twinned.has(n));
    expect(missing).toEqual([]);
  });

  it('🔴 PLATFORM_DB is the SHARED sandbox database, which this Worker never migrates', () => {
    const p = d1(sandbox, 'PLATFORM_DB');
    expect(p?.database_name).toBe('platform_db_sandbox');
    expect(p?.migrations_dir).toBeUndefined();
    expect(sandbox?.r2_buckets).toEqual([{ binding: 'SCREENSHOTS', bucket_name: 'nikatru-feedback-sandbox' }]);
  });

  it('🔴 no sandbox id is a production id — a sandbox binding on a production store writes production', () => {
    const top = new Set(
      [...(cfg.d1_databases ?? []).map((d) => d.database_id), ...(cfg.kv_namespaces ?? []).map((k) => k.id)].filter(
        (id) => typeof id === 'string' && !/^0+$/.test(id.replace(/-/g, '')),
      ),
    );
    const sbx = [...(sandbox?.d1_databases ?? []).map((d) => d.database_id), ...(sandbox?.kv_namespaces ?? []).map((k) => k.id)];
    expect(sbx.filter((id) => top.has(id))).toEqual([]);
    expect(kv(sandbox, 'JWKS_CACHE')).toBeDefined();
    expect(kv(sandbox, 'SESSION_REVOKED')).toBeDefined();
  });

  it('the identity project, the app id and the API version are production’s', () => {
    for (const k of ['APP_ID', 'SUPABASE_URL', 'API_VERSION', 'ALLOWED_ORIGINS']) expect(sandbox?.vars?.[k]).toBe(cfg.vars?.[k]);
  });
});
