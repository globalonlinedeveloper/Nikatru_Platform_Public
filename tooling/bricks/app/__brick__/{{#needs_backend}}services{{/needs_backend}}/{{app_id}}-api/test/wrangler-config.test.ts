import { describe, it, expect } from 'vitest';
// `?raw` rather than node:fs — a Workers tsconfig has no node types on purpose.
import raw from '../wrangler.jsonc?raw';

// ─────────────────────────────────────────────────────────────────────────────
// wrangler-config.test.ts — A STAMPED WORKER IS BORN WITH ITS SANDBOX.
//
// ⏱ 2026-10-01 · O-BRICK-WORKER-HAS-NO-SANDBOX-ENV (rv2-services-011). The
// template declared no `env.sandbox`, and deploy-sandbox dropped such a Worker
// without a word, so app #2 would have had no sandbox at all. This file holds the
// block the template now stamps, on PARSED STRUCTURE (the config is mostly
// comments, several of which name the strings looked for), in the stamped
// Worker's own lane. services/subscriptiontracker-api/test/wrangler-config.test.ts
// holds app #1's; tooling/ci/assert-platform-register.mjs limb 8 holds every
// config's twins across the repository.
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
interface Block {
  name?: string;
  routes?: unknown[];
  workers_dev?: boolean;
  triggers?: { crons?: unknown[] };
  vars?: Record<string, unknown>;
  d1_databases?: D1Entry[];
  kv_namespaces?: KvEntry[];
  r2_buckets?: unknown[];
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
  ...Object.keys(b?.vars ?? {}).map((v) => `var:${v}`),
];

describe('the parse itself reached the config', () => {
  it('self-check — the top level binds APP_DB, PLATFORM_DB, JWKS_CACHE and SESSION_REVOKED', () => {
    expect(cfg.name).toBe('{{app_id}}-api');
    expect(bindingNames(cfg).sort()).toEqual(
      expect.arrayContaining(['d1:APP_DB', 'd1:PLATFORM_DB', 'kv:JWKS_CACHE', 'kv:SESSION_REVOKED']),
    );
  });
});

describe('env.sandbox — declared, and off production', () => {
  it('🔴 the template declares an `env.sandbox` block', () => {
    expect(sandbox).toBeTypeOf('object');
  });

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

  it('🔴 APP_DB is the sandbox database, migrated from the same directory', () => {
    expect(d1(sandbox, 'APP_DB')).toMatchObject({
      database_name: '{{app_id}}_db_sandbox',
      migrations_dir: d1(cfg, 'APP_DB')?.migrations_dir,
    });
  });

  it('🔴 PLATFORM_DB is the SHARED sandbox database, which this Worker never migrates', () => {
    const p = d1(sandbox, 'PLATFORM_DB');
    expect(p?.database_name).toBe('platform_db_sandbox');
    expect(p?.migrations_dir).toBeUndefined();
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

  it('the identity project, the app id and the API version are production’s — the sandbox moves the stores, not the contract', () => {
    for (const k of ['APP_ID', 'SUPABASE_URL', 'API_VERSION']) expect(sandbox?.vars?.[k]).toBe(cfg.vars?.[k]);
  });

  it('no R2 bucket and no service binding, at either level — the clone contract stamps neither', () => {
    expect(cfg.r2_buckets).toBeUndefined();
    expect(sandbox?.r2_buckets).toBeUndefined();
    expect(cfg.services).toBeUndefined();
    expect(sandbox?.services).toBeUndefined();
  });
});
