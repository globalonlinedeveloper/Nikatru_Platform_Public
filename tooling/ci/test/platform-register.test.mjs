// ─────────────────────────────────────────────────────────────────────────────
// platform-register.test.mjs — assert-platform-register.mjs must be able to FAIL.
//
// [pipeline B-1] the shared server declares its capability set, and every
// capability has a real client · [B-18] every bound bucket has a reader ·
// [B-13] a public route is bounded, or says why not.
//
// ⚠️ REAL-TREE MUTATIONS FIRST, BEFORE THIS FILE EXISTED (2026-08-01, nine, on a
// scratch copy of the repo, each restored and re-verified green afterwards).
// A fixture you wrote encodes the same misunderstanding as the guard you wrote;
// only breaking the actual tree can show otherwise (assert-seams-wired.mjs
// shipped with all six of its fixture tests passing against a broken version).
//
//   MR1 `app.route('/v1', events)` deleted from index.ts   -> caught: "registered
//                                                             but NOT mounted"
//   MR2 a new `app.get('/v1/whoami')` added, unregistered  -> caught: "MOUNTED by"
//   MR3 the client `file` re-pointed INTO services/platform-> caught: "is inside
//                                                             the serving Worker"
//   MR4 the real `'$_base/v1/events'` call site deleted,   -> caught: "does not
//       leaving the doc comment three lines up that says      appear … once
//       exactly the same thing                                comments are stripped"
//   MR5 `withinEdgeCeiling` removed from GET /config/:app  -> caught: "auth: public
//                                                             … no noLimiterReason"
//   MR6 a new `PACKS` r2_bucket added to platform's config -> caught: "declared as
//                                                             a `r2_buckets`
//                                                             binding"
//   MR7 a register `owningFile` re-pointed at another REAL -> caught: "the parser
//       file                                                  found it declared in"
//   MR8 a binding reader re-pointed at src/types.ts        -> caught: "a types.ts
//                                                             declares the
//                                                             binding's TYPE"
//   MR9 a real wrangler config dropped from                -> caught: "a wrangler
//       bindingSources.configs                                config on disk that
//                                                             … does not name"
//   None crashed; every one exited 1 with the intended message; every restore
//   was verified green.
//
// 🔴 AND THE RED THIS GUARD WAS BUILT TO RECORD, on the tree as it stood:
//   services/subly-api bound `EXPORTS` -> `subly-exports` (created 2026-07-17)
//   whose ONLY occurrence in the whole TypeScript tree was its own declaration
//   in src/types.ts. Run against that tree the guard said, verbatim:
//     "EXPORTS — declared as a `r2_buckets` binding in
//      services/subly-api/wrangler.jsonc and absent from the register."
//   and, once EXPORTS was registered honestly:
//     "EXPORTS — bound by services/subly-api/wrangler.jsonc and read by NOTHING."
//   and, when types.ts was offered as its reader:
//     "A types.ts declares the binding's TYPE; it never reads it."
//   The binding and its type line were then removed, which is what turned the
//   guard green. Deleting the BUCKET is destructive and stays with the owner.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-platform-register.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-preg-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const BRICK_CFG =
  'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/wrangler.jsonc';

/** The fixture Worker, mirroring the real one's SHAPE: one route declared inline
 *  in the entrypoint and two sub-routers mounted with `app.route()`. A fixture
 *  with everything inline would never exercise the mount walk, which is the half
 *  that silently drops three of four routes when it breaks. */
const INDEX_TS = `
import { Hono } from 'hono';
import config from './routes/config';
import events from './routes/events';

// A header comment that NAMES the routes in prose, on purpose:
//   GET /v1/health · GET /config/:app · POST /v1/events · POST /v1/ghost
// A guard that grepped for path strings would find /v1/ghost here and believe
// the Worker mounts it. This one parses.
const app = new Hono();
app.use('*', async (c, next) => { await next(); });
app.get('/v1/health', (c) => c.json({ ok: true }));
app.route('/config', config);
app.route('/v1', events);
export default { fetch: app.fetch };
`;

const CONFIG_TS = `
import { Hono } from 'hono';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
const app = new Hono();
app.get('/:app', async (c) => {
  if (!(await withinEdgeCeiling(c.env.CONFIG_CEILING_LIMITER, c))) return c.json({}, 429);
  return c.json(await c.env.CONFIG_KV.get('config:x'));
});
export default app;
`;

const EVENTS_TS = `
import { Hono } from 'hono';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
const events = new Hono();
events.post('/events', async (c) => {
  if (!(await withinEdgeCeiling(c.env.EVENTS_CEILING_LIMITER, c))) return c.json({}, 429);
  await c.env.PLATFORM_DB.prepare('INSERT INTO events DEFAULT VALUES').run();
  return c.json({ ok: true });
});
export default events;
`;

const CLIENT_DART = `
/// dio-backed transport. \`POST {platformBaseUrl}/v1/events\` -> the Worker.
/// This doc comment contains the exact expression below and MUST NOT satisfy the
/// client check: '\$_base/v1/events'
class DioEventTransport {
  Future<void> send() async {
    await _dio.post<dynamic>(
      '\$_base/v1/events',
      data: <String, Object?>{},
    );
  }
}
`;

const CONFIG_CLIENT_DART = `
/// dio-backed CFG-1 transport.
class DioConfigTransport {
  Future<void> fetch(String appId) async {
    final String url = '\$_base/config/\$appId';
    await _dio.get<dynamic>(url);
  }
}
`;

const PLATFORM_CFG = `{
  // A comment mentioning "r2_buckets" so comment-stripping is exercised by the
  // PASSING case rather than assumed — this repo has shipped a guard whose grep
  // matched the comment explaining why there was no r2_buckets.
  "name": "platform",
  "main": "src/index.ts",
  "d1_databases": [{ "binding": "PLATFORM_DB", "database_name": "platform_db" }],
  "kv_namespaces": [{ "binding": "CONFIG_KV", "id": "k1" }],
  "ratelimits": [
    { "name": "EVENTS_CEILING_LIMITER", "namespace_id": "1002" },
    { "name": "CONFIG_CEILING_LIMITER", "namespace_id": "1003" },
  ],
  // [pipeline B-15] A Worker that declares \`main\` answers requests, so it must
  // declare the host it answers on. Present in the PASSING fixture because the
  // real services/platform/wrangler.jsonc has always had it — a fixture missing
  // what the real tree has cannot notice the omission, which is the exact defect
  // that let check-migrations' own fixture bless a tree with no subly-api.
  "routes": [{ "pattern": "platform.nikatru.com", "custom_domain": true }],
}`;

const baseRegister = () => ({
  servingWorker: {
    name: 'platform',
    entrypoint: 'services/platform/src/index.ts',
    config: 'services/platform/wrangler.jsonc',
  },
  bindingSources: { configs: ['services/platform/wrangler.jsonc'] },
  routes: [
    {
      id: 'health',
      method: 'GET',
      path: '/v1/health',
      auth: 'public',
      owningFile: 'services/platform/src/index.ts',
      purpose: 'Deploy verification.',
      unconsumedReason: 'Human/monitor endpoint; no programmatic caller today.',
      noLimiterReason: 'Does no I/O at all.',
    },
    {
      id: 'config',
      method: 'GET',
      path: '/config/:app',
      auth: 'public',
      owningFile: 'services/platform/src/routes/config.ts',
      purpose: 'CFG-1 runtime config.',
      client: { file: 'packages/api_client/lib/src/dio_config_transport.dart', expression: "'$_base/config/$appId'" },
    },
    {
      id: 'events',
      method: 'POST',
      path: '/v1/events',
      auth: 'public',
      owningFile: 'services/platform/src/routes/events.ts',
      purpose: 'Analytics ingest.',
      client: { file: 'packages/api_client/lib/src/dio_event_transport.dart', expression: "'$_base/v1/events'" },
    },
  ],
  bindings: [
    {
      binding: 'PLATFORM_DB',
      kind: 'd1_databases',
      purpose: 'Shared portfolio database.',
      readers: ['services/platform/src/routes/events.ts'],
    },
    {
      binding: 'CONFIG_KV',
      kind: 'kv_namespaces',
      purpose: 'Per-app config overrides.',
      readers: ['services/platform/src/routes/config.ts'],
    },
    {
      binding: 'EVENTS_CEILING_LIMITER',
      kind: 'ratelimits',
      purpose: 'Server-derived ceiling for the ingest route.',
      readers: ['services/platform/src/routes/events.ts'],
    },
    {
      binding: 'CONFIG_CEILING_LIMITER',
      kind: 'ratelimits',
      purpose: 'Server-derived ceiling for the config route.',
      readers: ['services/platform/src/routes/config.ts'],
    },
  ],
});

/** A repo fixture. `edit` mutates the register and/or the files before writing. */
function tree({ register = baseRegister(), files = {} } = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (relPath, body) => {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const all = {
    'services/platform/src/index.ts': INDEX_TS,
    'services/platform/src/routes/config.ts': CONFIG_TS,
    'services/platform/src/routes/events.ts': EVENTS_TS,
    'services/platform/src/types.ts':
      'export interface Env {\n  PLATFORM_DB: D1Database;\n  CONFIG_KV: KVNamespace;\n}\n',
    'services/platform/wrangler.jsonc': PLATFORM_CFG,
    'packages/api_client/lib/src/dio_event_transport.dart': CLIENT_DART,
    'packages/api_client/lib/src/dio_config_transport.dart': CONFIG_CLIENT_DART,
    ...files,
  };
  for (const [p, body] of Object.entries(all)) if (body !== null) write(p, body);
  write('tooling/platform-register.json', JSON.stringify(register, null, 2));
  return root;
}

const run = (root) => {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-platform-register', () => {
  test('passes when the register, the mounts, the callers and the bindings all agree', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /3 mounted route\(s\) reconciled with 3 register entry\(ies\)/);
    assert.match(out, /4 binding\(s\) across 1 wrangler config\(s\)/);
  });

  // ── LIMB 1 · route set == what the entrypoint mounts, both directions ──────
  test('FAILS on a route that is mounted and not registered  [MR2]', () => {
    const reg = baseRegister();
    reg.routes = reg.routes.filter((r) => r.id !== 'events');
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /POST \/v1\/events — MOUNTED by services\/platform\/src\/routes\/events\.ts/);
  });

  test('FAILS on a route that is registered and not mounted  [MR1]', () => {
    const { code, out } = run(
      tree({ files: { 'services/platform/src/index.ts': INDEX_TS.replace("app.route('/v1', events);", '') } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /POST \/v1\/events .* registered but NOT mounted/);
  });

  test('a path named ONLY in a header comment is not a mounted route', () => {
    // The fixture's index.ts comment lists `/v1/ghost`. A grep-based parser would
    // report it as mounted and then fail the register for not carrying it.
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /ghost/);
  });

  test('FAILS when owningFile names a real file that does not declare the route  [MR7]', () => {
    const reg = baseRegister();
    reg.routes.find((r) => r.id === 'config').owningFile = 'services/platform/src/index.ts';
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /the parser found it declared in `services\/platform\/src\/routes\/config\.ts`/);
  });

  test('FAILS on an auth value that is neither "required" nor "public"', () => {
    const reg = baseRegister();
    reg.routes.find((r) => r.id === 'events').auth = 'maybe';
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /`auth` must be exactly "required" or "public"/);
  });

  // ── LIMB 2 · the client RESOLVES, or the gap PRINTS ────────────────────────
  test('FAILS on a route with no client and no unconsumedReason', () => {
    const reg = baseRegister();
    delete reg.routes.find((r) => r.id === 'health').unconsumedReason;
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no `client` and no `unconsumedReason`/);
  });

  test('a declared unconsumedReason PRINTS and does NOT fail the build', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /⚠ {2}GET \/v1\/health — NO CLIENT\./);
  });

  test('FAILS on the "TBD" defect — a client that is a bare string', () => {
    const reg = baseRegister();
    reg.routes.find((r) => r.id === 'events').client = 'TBD';
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /needs both a `file` and an `expression`/);
  });

  test('FAILS when the client expression lives inside the serving Worker  [MR3]', () => {
    const reg = baseRegister();
    reg.routes.find((r) => r.id === 'events').client = {
      file: 'services/platform/src/routes/events.ts',
      expression: "'/events'",
    };
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /is inside the serving Worker/);
  });

  test('🔴 a DOC COMMENT containing the exact expression does not resolve it  [MR4]', () => {
    // The fixture's Dart doc comment carries `'$_base/v1/events'` verbatim. This
    // is the single most repeated failure in this repo — a rename that survived
    // because one house-style comment still said the old name.
    const stripped = CLIENT_DART.replace("      '$_base/v1/events',\n", '      _endpoint,\n');
    assert.ok(stripped.includes("'$_base/v1/events'"), 'the doc comment must still carry the expression');
    const { code, out } = run(
      tree({ files: { 'packages/api_client/lib/src/dio_event_transport.dart': stripped } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /does not appear in `packages\/api_client.*` once comments are stripped/);
  });

  test('FAILS when the client expression does not contain the route it claims', () => {
    const reg = baseRegister();
    // A perfectly real call site in a real file — for a DIFFERENT route.
    reg.routes.find((r) => r.id === 'config').client = {
      file: 'packages/api_client/lib/src/dio_event_transport.dart',
      expression: "'$_base/v1/events'",
    };
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /does not contain the route's own path `\/config`/);
  });

  // ── LIMB 3 · bindings, both directions, each with a REAL reader ────────────
  test('FAILS on a binding declared in a config and absent from the register  [MR6]', () => {
    const cfg = PLATFORM_CFG.replace(
      '"kv_namespaces": [',
      '"r2_buckets": [{ "binding": "PACKS", "bucket_name": "nikatru-packs" }],\n  "kv_namespaces": [',
    );
    const { code, out } = run(tree({ files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 1, out);
    assert.match(out, /PACKS — declared as a `r2_buckets` binding/);
  });

  test('🔴 FAILS on a bound resource with NO READER — the live EXPORTS defect', () => {
    const cfg = PLATFORM_CFG.replace(
      '"kv_namespaces": [',
      '"r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "app-exports" }],\n  "kv_namespaces": [',
    );
    const reg = baseRegister();
    reg.bindings.push({ binding: 'EXPORTS', kind: 'r2_buckets', purpose: 'CSV exports.', readers: [] });
    const { code, out } = run(tree({ register: reg, files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 1, out);
    assert.match(out, /EXPORTS — bound by .* and read by NOTHING/);
  });

  test('🔴 a types.ts is NOT a reader, even though the token is right there  [MR8]', () => {
    const cfg = PLATFORM_CFG.replace(
      '"kv_namespaces": [',
      '"r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "app-exports" }],\n  "kv_namespaces": [',
    );
    const reg = baseRegister();
    reg.bindings.push({
      binding: 'EXPORTS',
      kind: 'r2_buckets',
      purpose: 'CSV exports.',
      readers: ['services/platform/src/types.ts'],
    });
    const { code, out } = run(
      tree({
        register: reg,
        files: {
          'services/platform/wrangler.jsonc': cfg,
          'services/platform/src/types.ts':
            'export interface Env {\n  PLATFORM_DB: D1Database;\n  CONFIG_KV: KVNamespace;\n  EXPORTS: R2Bucket;\n}\n',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /A types\.ts declares the binding's TYPE; it never reads it/);
  });

  test('an unreadReason PRINTS the gap instead of failing, and only when declared', () => {
    const cfg = PLATFORM_CFG.replace(
      '"kv_namespaces": [',
      '"r2_buckets": [{ "binding": "PACKS", "bucket_name": "nikatru-packs" }],\n  "kv_namespaces": [',
    );
    const reg = baseRegister();
    reg.bindings.push({
      binding: 'PACKS',
      kind: 'r2_buckets',
      purpose: 'The one portfolio bucket.',
      readers: [],
      unreadReason: 'Provisioned ahead of [7]P-13; the reader lands with the pack delivery route.',
    });
    const { code, out } = run(tree({ register: reg, files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 0, out);
    assert.match(out, /⚠ {2}PACKS — BOUND WITH NO READER\./);
  });

  test('FAILS on a claimed reader that does not contain env.<BINDING>', () => {
    const reg = baseRegister();
    reg.bindings.find((b) => b.binding === 'PLATFORM_DB').readers = [
      'services/platform/src/routes/config.ts',
    ];
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /contains no `env\.PLATFORM_DB` once comments and string literals are stripped/);
  });

  test('FAILS on a register binding no config declares (a stale entry)', () => {
    const reg = baseRegister();
    reg.bindings.push({
      binding: 'GONE_DB',
      kind: 'd1_databases',
      purpose: 'Deleted last month.',
      readers: ['services/platform/src/routes/events.ts'],
    });
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /GONE_DB — in the register but no wrangler config declares it/);
  });

  // ── [pipeline B-15] the host limb ─────────────────────────────────────────
  // Mutation-proven against the REAL tree 2026-08-03, both directions:
  //   · brick template `"routes": []`            -> exit 1 naming the brick config
  //   · subly-api `{ "pattern": "…" }` (no       -> exit 1 naming subly-api
  //     custom_domain)
  // Both restored from memory and byte-compared; the guard returned to exit 0.
  test('FAILS when a Worker declaring `main` has NO routes at all', () => {
    const cfg = PLATFORM_CFG.replace(
      /"routes": \[\{ "pattern": "platform\.nikatru\.com", "custom_domain": true \}\],/,
      '',
    );
    const { code, out } = run(tree({ files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 1, out);
    assert.match(out, /NO `routes` entry with `custom_domain: true`/);
  });

  test('FAILS on an EMPTY routes array — a key that exists is not the property', () => {
    // The failure this excludes: asserting `routes` is present. `[]` satisfies
    // that and binds nothing, and this repo has shipped a check a template
    // COMMENT satisfied.
    const cfg = PLATFORM_CFG.replace(
      /"routes": \[\{ "pattern": "platform\.nikatru\.com", "custom_domain": true \}\],/,
      '"routes": [],',
    );
    const { code, out } = run(tree({ files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 1, out);
    assert.match(out, /NO `routes` entry with `custom_domain: true`/);
  });

  test('FAILS on a pattern route with no custom_domain — that needs a DNS record somebody remembered', () => {
    const cfg = PLATFORM_CFG.replace(
      /"routes": \[\{ "pattern": "platform\.nikatru\.com", "custom_domain": true \}\],/,
      '"routes": [{ "pattern": "platform.nikatru.com" }],',
    );
    const { code, out } = run(tree({ files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 1, out);
    assert.match(out, /NO `routes` entry with `custom_domain: true`/);
  });

  test('a config with NO `main` is not a request-answering Worker and is not flagged', () => {
    // Requiring a host of a config that serves nothing would be noise, and noise
    // is how a real signal gets muted.
    const { code } = run(
      tree({
        register: {
          ...baseRegister(),
          bindingSources: {
            configs: ['services/platform/wrangler.jsonc', 'services/nomain/wrangler.jsonc'],
          },
        },
        files: { 'services/nomain/wrangler.jsonc': '{ "name": "nomain" }' },
      }),
    );
    assert.equal(code, 0);
  });

  test('COVERAGE LOST when NOT ONE config declares `main`', () => {
    // The empty-domain failure: with no Workers the host limb ranges over
    // nothing and cannot fail.
    const cfg = PLATFORM_CFG.replace('"main": "src/index.ts",', '');
    const { code, out } = run(tree({ files: { 'services/platform/wrangler.jsonc': cfg } }));
    assert.equal(code, 1, out);
    assert.match(out, /NOT ONE declares `main`/);
  });

  test('FAILS when a config on disk is missing from bindingSources.configs  [MR9]', () => {
    const { code, out } = run(
      tree({
        files: {
          'services/other-api/wrangler.jsonc': '{ "name": "other", "d1_databases": [{ "binding": "OTHER_DB" }] }',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /services\/other-api\/wrangler\.jsonc — a wrangler config on disk that/);
  });

  test('THE BRICK TEMPLATE IS IN SCOPE — a binding stamped into every future app counts', () => {
    // assert-clone-contract.mjs inspects only the throwaway CI probe stamp, so
    // the template itself is invisible to it. A per-app bucket reintroduced HERE
    // would be reproduced by every stamp forever.
    const { code, out } = run(
      tree({
        files: {
          [BRICK_CFG]: '{ "name": "x-api", "r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "x-exports" }] }',
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /EXPORTS — declared as a `r2_buckets` binding in tooling\/bricks/);
  });

  // ── LIMB 4 · a public route is bounded, or SAYS why not  [B-13 residual] ───
  test('FAILS on a public route whose handler reaches no limiter and gives no reason  [MR5]', () => {
    const reg = baseRegister();
    delete reg.routes.find((r) => r.id === 'health').noLimiterReason;
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /reaches neither withinRateLimit nor withinEdgeCeiling/);
  });

  test('a declared noLimiterReason PRINTS and does NOT fail the build', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /⚠ {2}GET \/v1\/health — PUBLIC AND UNLIMITED\./);
  });

  test('🔴 the limiter check is scoped to THE HANDLER, not to the file', () => {
    // A second public route added beside a limited one must not inherit its
    // sibling's protection. Checking the file would pass this; checking the
    // handler body does not.
    const events = EVENTS_TS.replace(
      'export default events;',
      "events.post('/consent', async (c) => c.json({ ok: true }));\nexport default events;",
    );
    const reg = baseRegister();
    reg.routes.push({
      id: 'consent',
      method: 'POST',
      path: '/v1/consent',
      auth: 'public',
      owningFile: 'services/platform/src/routes/events.ts',
      purpose: 'Consent artifact.',
      unconsumedReason: 'not the subject of this test',
    });
    const { code, out } = run(tree({ register: reg, files: { 'services/platform/src/routes/events.ts': events } }));
    assert.equal(code, 1, out);
    assert.match(out, /POST \/v1\/consent — `auth: public`/);
  });

  test('an auth:required route is NOT asked for a limiter reason', () => {
    // The whole point of limb 4 is that UNAUTHENTICATED reachability is what
    // makes a route expensive. A rule that also fired on authenticated routes
    // would fire on correct input, and rules that do that get switched off.
    const reg = baseRegister();
    const r = reg.routes.find((x) => x.id === 'events');
    r.auth = 'required';
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /PUBLIC AND UNLIMITED[\s\S]*\/v1\/events/);
  });

  // ── coverage self-checks: the parse must still reach the tree ──────────────
  test('COVERAGE LOST when the entrypoint does not exist', () => {
    const reg = baseRegister();
    reg.servingWorker.entrypoint = 'services/platform/src/nowhere.ts';
    const { code, out } = run(tree({ register: reg }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — servingWorker\.entrypoint/);
  });

  test('COVERAGE LOST when the entrypoint mounts nothing the parser can see', () => {
    const { code, out } = run(
      tree({ files: { 'services/platform/src/index.ts': 'export default { fetch: () => new Response() };\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST/);
  });

  test('🔴 COVERAGE LOST when the parser stops following app.route() into sub-routers', () => {
    // The failure mode with teeth: an entrypoint-only parse still finds
    // /v1/health, still prints a route count, and silently drops three of four.
    const inlineOnly = INDEX_TS.replace("app.route('/config', config);", '').replace(
      "app.route('/v1', events);",
      '',
    );
    const reg = baseRegister();
    reg.routes = reg.routes.filter((r) => r.id === 'health');
    const { code, out } = run(tree({ register: reg, files: { 'services/platform/src/index.ts': inlineOnly } }));
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — every route the parser found is declared inline/);
  });

  test('COVERAGE LOST when no wrangler config is found at all', () => {
    const reg = baseRegister();
    reg.bindingSources.configs = [];
    const { code, out } = run(tree({ register: reg, files: { 'services/platform/wrangler.jsonc': null } }));
    assert.equal(code, 1, out);
    assert.match(out, /declares no `bindingSources\.configs`|COVERAGE LOST/);
  });

  test('COVERAGE LOST when the register itself is missing', () => {
    const root = join(TMP, `r${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — no platform register/);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE SECOND WORKER — the conditions commit 6d67631 added, none of which had
// a test until this block. That commit grew the guard by 359 lines and turned
// its subject from ONE Worker into EVERY deployable Worker; every predicate it
// introduced reddened only because somebody hand-mutated it once. A green that
// nothing pins is a green a later softening cannot disturb, which is the whole
// failure this file exists to stop.
//
// Every case names the offending thing in its assertion. "exit 1" alone passes
// against a guard that failed for an unrelated reason, and this guard has 45
// distinct problem messages — so that is not a hypothetical.
//
// The app-Worker fixture mirrors the SHAPE of services/subly-api, the Worker
// whose twelve mounts were invisible before 6d67631:
//   · a route declared inline in the entrypoint             (GET /v1/health)
//   · an IN-FILE `new Hono` group mounted with app.route()   (GET /v1/whoami)
//   · an imported sub-router whose leaf is '/'               (GET /v1/subscriptions)
//     — five of subly-api's twelve declare their leaf that way, and that is the
//       case `joinPath`'s trailing-slash strip exists for
//   · a second leaf under the same sub-router                (POST …/cancel)
// ─────────────────────────────────────────────────────────────────────────────

const SUBLY_INDEX_TS = `
import { Hono } from 'hono';
import subscriptions from './routes/subscriptions';
import { supabaseAuth } from './lib/auth';
const app = new Hono();
app.get('/v1/health', async (c) => c.json({ ok: true }));
app.route('/v1/subscriptions', subscriptions);
// \`api\` is NEVER imported — it is declared right here. A walk that follows
// app.route() only into default imports stops dead on the last line below.
const api = new Hono();
api.use('*', supabaseAuth);
api.get('/whoami', async (c) => c.json({ id: 1 }));
app.route('/v1', api);
export default { fetch: app.fetch };
`;

const SUBLY_SUBSCRIPTIONS_TS = `
import { Hono } from 'hono';
const subscriptions = new Hono();
subscriptions.get('/', async (c) => c.json(await c.env.SUBLY_DB.prepare('SELECT 1').all()));
subscriptions.post('/cancel', async (c) => c.json({ ok: true }));
export default subscriptions;
`;

const SUBLY_CFG = `{
  "name": "subly-api",
  "main": "src/index.ts",
  "d1_databases": [{ "binding": "SUBLY_DB", "database_name": "subly_db" }],
  "routes": [{ "pattern": "api.nikatru.com", "custom_domain": true }],
}`;

/** The app Worker's caller tree, deliberately OUTSIDE services/subly-api. Two of
 *  the three expressions carry only the path BELOW `/v1` — that is what
 *  `clientBasePath` buys, and it is why the prefix constraint on it is
 *  load-bearing rather than decorative. */
const SUBLY_CLIENT_DART = `
class DioSublyTransport {
  Future<void> whoami() async => _dio.get<dynamic>('\$_base/whoami');
  Future<void> list() async => _dio.get<dynamic>('\$_base/subscriptions');
  Future<void> cancel() async => _dio.post<dynamic>('\$_base/subscriptions/cancel');
}
`;

/** The same three calls written against the FULL paths, for the cases that must
 *  break `clientBasePath` without also breaking limb 2. */
const SUBLY_CLIENT_DART_FULL = `
class DioSublyTransport {
  Future<void> whoami() async => _dio.get<dynamic>('\$_base/v1/whoami');
  Future<void> list() async => _dio.get<dynamic>('\$_base/v1/subscriptions');
  Future<void> cancel() async => _dio.post<dynamic>('\$_base/v1/subscriptions/cancel');
}
`;

const SUBLY_FILES = {
  'services/subly-api/src/index.ts': SUBLY_INDEX_TS,
  'services/subly-api/src/routes/subscriptions.ts': SUBLY_SUBSCRIPTIONS_TS,
  'services/subly-api/src/lib/auth.ts': 'export const supabaseAuth = async (c, next) => next();\n',
  'services/subly-api/wrangler.jsonc': SUBLY_CFG,
  'packages/api_client/lib/src/dio_subly_transport.dart': SUBLY_CLIENT_DART,
};

const SUBLY_CLIENT = 'packages/api_client/lib/src/dio_subly_transport.dart';

const sublyRoutes = () => [
  {
    id: 'subly-health',
    method: 'GET',
    path: '/v1/health',
    auth: 'required',
    owningFile: 'services/subly-api/src/index.ts',
    purpose: 'Deploy verification for the app backend.',
    unconsumedReason: 'Human/monitor endpoint; no programmatic caller today.',
  },
  {
    id: 'subly-whoami',
    method: 'GET',
    path: '/v1/whoami',
    auth: 'required',
    owningFile: 'services/subly-api/src/index.ts',
    purpose: 'Echoes the authenticated identity.',
    client: { file: SUBLY_CLIENT, expression: "'$_base/whoami'" },
  },
  {
    id: 'subly-list',
    method: 'GET',
    path: '/v1/subscriptions',
    auth: 'required',
    owningFile: 'services/subly-api/src/routes/subscriptions.ts',
    purpose: 'Lists the caller’s subscriptions.',
    client: { file: SUBLY_CLIENT, expression: "'$_base/subscriptions'" },
  },
  {
    id: 'subly-cancel',
    method: 'POST',
    path: '/v1/subscriptions/cancel',
    auth: 'required',
    owningFile: 'services/subly-api/src/routes/subscriptions.ts',
    purpose: 'Cancels one subscription.',
    client: { file: SUBLY_CLIENT, expression: "'$_base/subscriptions/cancel'" },
  },
];

const sublyWorker = () => ({
  name: 'subly-api',
  config: 'services/subly-api/wrangler.jsonc',
  entrypoint: 'services/subly-api/src/index.ts',
  clientBasePath: '/v1',
  routes: sublyRoutes(),
});

/** baseRegister() + the app Worker, its config and its binding. `edit` runs last
 *  so a case can break exactly one thing. */
function appRegister(edit = () => {}) {
  const reg = baseRegister();
  reg.appWorkers = [sublyWorker()];
  reg.bindingSources.configs.push('services/subly-api/wrangler.jsonc');
  reg.bindings.push({
    binding: 'SUBLY_DB',
    kind: 'd1_databases',
    purpose: 'The app backend database.',
    readers: ['services/subly-api/src/routes/subscriptions.ts'],
  });
  edit(reg);
  return reg;
}

/** The same tree as `tree()`, plus the whole second Worker. */
const appTree = ({ register, files = {} } = {}) =>
  tree({ register: register ?? appRegister(), files: { ...SUBLY_FILES, ...files } });

/** Every route rewritten onto its full path, so a clientBasePath case breaks the
 *  base path and NOTHING else. */
const fullPathClients = (r) => {
  for (const rt of r.appWorkers[0].routes) {
    if (rt.client) rt.client.expression = `'$_base${rt.path}'`;
  }
};

describe('assert-platform-register — every deployable Worker is the subject [6d67631]', () => {
  // ── the positive control for this whole block ─────────────────────────────
  // Without it, every RED below is equally consistent with a guard that rejects
  // any tree carrying a second Worker at all.
  test('passes on a tree with a SECOND Worker whose register entry is honest', () => {
    const { code, out } = run(appTree());
    assert.equal(code, 0, out);
    assert.match(out, /3 mounted route\(s\) reconciled with 3 register entry\(ies\)/);
    assert.match(out, /plus 4 across 1 app Worker\(s\) reconciled with 4/);
    assert.match(out, /5 binding\(s\) across 2 wrangler config\(s\)/);
  });

  // ── THE WORKER SET, BOTH DIRECTIONS ───────────────────────────────────────
  // A set check pinned in one direction only is half a check: it would still
  // catch a register naming a Worker the tree lost, and miss the failure this
  // block exists for — a third backend arriving unseen.
  test('🔴 FAILS on a Worker that declares `main` on disk and is in NO register entry (tree → register)', () => {
    // Its config and its binding ARE declared, so the only thing wrong is that
    // no register entry claims the Worker itself.
    const { code, out } = run(appTree({ register: appRegister((r) => { delete r.appWorkers; }) }));
    assert.equal(code, 1, out);
    assert.match(
      out,
      /services\/subly-api\/wrangler\.jsonc — declares `main`, so it is a Worker that answers requests, and the register declares/,
    );
    assert.match(out, /✗ platform register — 1 problem\(s\)/, 'the missing Worker must be the only complaint');
  });

  test('🔴 FAILS on a register entry naming a config the tree does not deploy (register → tree)', () => {
    // `main` removed: the config is still on disk, so its bindings and its host
    // are still read. It is simply not a Worker that answers requests, and the
    // register says it is.
    const { code, out } = run(
      appTree({
        files: { 'services/subly-api/wrangler.jsonc': SUBLY_CFG.replace('"main": "src/index.ts",\n  ', '') },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /appWorkers\[0\] names `services\/subly-api\/wrangler\.jsonc`, which is not a `services\/\*` wrangler config declaring `main`/,
    );
    assert.match(out, /✗ platform register — 1 problem\(s\)/);
  });

  test('FAILS when the declared entrypoint is not what the config `main` resolves to', () => {
    const { code, out } = run(
      appTree({
        files: {
          'services/subly-api/wrangler.jsonc': SUBLY_CFG.replace('"main": "src/index.ts"', '"main": "src/worker.ts"'),
          'services/subly-api/src/worker.ts': SUBLY_INDEX_TS,
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /appWorkers\[0\] — declares entrypoint `services\/subly-api\/src\/index\.ts`, but `services\/subly-api\/wrangler\.jsonc`'s `main` resolves to `services\/subly-api\/src\/worker\.ts`/,
    );
  });

  test('FAILS when the register calls the Worker something the config does not deploy it as', () => {
    const { code, out } = run(
      appTree({ files: { 'services/subly-api/wrangler.jsonc': SUBLY_CFG.replace('"subly-api"', '"subly-backend"') } }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /appWorkers\[0\] — calls this Worker `subly-api`; `services\/subly-api\/wrangler\.jsonc` deploys it as `subly-backend`/,
    );
  });

  // ── the register's own shape, now that there is more than one Worker ──────
  test('FAILS when an appWorkers entry has no `routes` array — its mounts would be enforced by nothing', () => {
    const { code, out } = run(
      appTree({ register: appRegister((r) => { delete r.appWorkers[0].routes; }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /appWorkers\[0\] has no `routes` array; its Worker's mounts would be enforced by nothing/);
  });

  test('FAILS when two declared Workers share a `name` — one subject swallowing two', () => {
    const { code, out } = run(
      appTree({ register: appRegister((r) => { r.appWorkers[0].name = 'platform'; }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /two declared Workers share a `name` \(platform, platform\)/);
  });

  test('FAILS on two register entries sharing a (method, path) — one shadows the other forever', () => {
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes.push({ ...sublyRoutes()[1], id: 'subly-whoami-dup', purpose: 'A duplicate.' });
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /appWorkers\[0\] — two entries share a \(method, path\); one is shadowing the other/);
  });

  // ── owningFile, now checked per Worker ────────────────────────────────────
  // [MR7] above pins this for servingWorker. 6d67631 moved the loop inside the
  // per-Worker walk, and a loop that silently ranged over one Worker would look
  // identical from the servingWorker test.
  test('🔴 FAILS when an app Worker route names a REAL file that does not declare it  [owningFile]', () => {
    // A real file, in the right Worker, that really does declare routes — just
    // not this one. Field presence and existsSync both pass.
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes.find((x) => x.id === 'subly-list').owningFile = 'services/subly-api/src/index.ts';
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /GET \/v1\/subscriptions — register says `services\/subly-api\/src\/index\.ts` owns it; the parser found it declared in `services\/subly-api\/src\/routes\/subscriptions\.ts`/,
    );
    assert.match(out, /✗ platform register — 1 problem\(s\)/, 'a wrong owningFile must be the only complaint');
  });

  test('🔴 FAILS when an app Worker route claims an owningFile in the OTHER Worker', () => {
    // services/platform/src/index.ts really does declare a GET /v1/health — for
    // a different Worker. Nothing but the per-Worker parse can tell them apart.
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes.find((x) => x.id === 'subly-health').owningFile = 'services/platform/src/index.ts';
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /GET \/v1\/health — register says `services\/platform\/src\/index\.ts` owns it; the parser found it declared in `services\/subly-api\/src\/index\.ts`/,
    );
  });

  // ── clientBasePath — THE PREFIX CONSTRAINT ────────────────────────────────
  // The dangerous direction is the permissive one: a base path that swallows a
  // discriminating segment turns the rename check into a tautology. The shape
  // rule and the "is a real prefix of EVERY mount" rule are pinned separately,
  // and each assertion names the base path rather than settling for exit 1.
  test('🔴 FAILS on a clientBasePath that is not a prefix of every route the Worker mounts', () => {
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].clientBasePath = '/v2';
          fullPathClients(r);
        }),
        files: { [SUBLY_CLIENT]: SUBLY_CLIENT_DART_FULL },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /appWorkers\[0\] — `clientBasePath` `\/v2` is not a prefix of /);
    assert.match(out, /GET \/v1\/health/, 'the message must NAME the routes it does not front');
    assert.match(out, /POST \/v1\/subscriptions\/cancel/);
    assert.match(out, /✗ platform register — 1 problem\(s\)/, 'the base path must be the only complaint');
  });

  test('🔴 a clientBasePath that swallows the discriminating segment is rejected outright', () => {
    // `/v1/subscriptions` IS a real prefix of two of the four mounts. Accepting
    // it would let POST /v1/subscriptions/cancel resolve on a bare `/cancel`.
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].clientBasePath = '/v1/subscriptions';
          fullPathClients(r);
        }),
        files: { [SUBLY_CLIENT]: SUBLY_CLIENT_DART_FULL },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`clientBasePath` `\/v1\/subscriptions` is not a prefix of GET \/v1\/health, GET \/v1\/subscriptions/);
    assert.match(out, /✗ platform register — 1 problem\(s\)/);
  });

  test('FAILS on a clientBasePath with a trailing slash — a shape a prefix test alone would accept', () => {
    const { code, out } = run(
      appTree({ register: appRegister((r) => { r.appWorkers[0].clientBasePath = '/v1/'; }) }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /appWorkers\[0\] — `clientBasePath` must be an absolute path with no trailing slash \(got "\/v1\/"\)/,
    );
  });

  test('FAILS on a relative clientBasePath', () => {
    const { code, out } = run(
      appTree({ register: appRegister((r) => { r.appWorkers[0].clientBasePath = 'v1'; }) }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /`clientBasePath` must be an absolute path with no trailing slash \(got "v1"\)/);
  });

  test('🔴 the residual below clientBasePath is the ONLY reason the short expressions resolve', () => {
    // The positive control passes on expressions carrying only `/whoami` and
    // `/subscriptions`. Take the base path away and those same expressions must
    // stop resolving — otherwise the rename check is satisfied by anything and
    // clientBasePath costs nothing to declare.
    const { code, out } = run(
      appTree({ register: appRegister((r) => { delete r.appWorkers[0].clientBasePath; }) }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /GET \/v1\/whoami — client expression `'\$_base\/whoami'` does not contain the route's own path `\/v1\/whoami`/,
    );
  });

  // ── the parser changes 6d67631 made, pinned by fixture ────────────────────
  test('🔴 an IN-FILE `new Hono` group is still a sub-router — its routes are MOUNTED', () => {
    // `api` is declared in the entrypoint and never imported. A walk that only
    // follows default imports sees three of this Worker's four routes and agrees
    // perfectly with a register that omits the fourth.
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes = r.appWorkers[0].routes.filter((x) => x.id !== 'subly-whoami');
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /GET \/v1\/whoami — MOUNTED by services\/subly-api\/src\/index\.ts and absent from the register/);
    assert.match(out, /✗ platform register — 1 problem\(s\)/);
  });

  test('🔴 a sub-router whose leaf is `/` mounts at the prefix WITHOUT a trailing slash', () => {
    // hono answers 200 on '/v1/subscriptions' and 404 on '/v1/subscriptions/'.
    // A register written against the slashed form describes a path the Worker
    // does not serve, and BOTH directions of limb 1 have to say so.
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes.find((x) => x.id === 'subly-list').path = '/v1/subscriptions/';
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /GET \/v1\/subscriptions\/ \(register id `subly-list`\) — registered but NOT mounted/);
    assert.match(out, /GET \/v1\/subscriptions — MOUNTED by services\/subly-api\/src\/routes\/subscriptions\.ts/);
  });

  // ── limbs 1, 2 and 4 now range over the app Worker too ────────────────────
  test('an app Worker route registered and NOT mounted is caught  [limb 1, second Worker]', () => {
    const { code, out } = run(
      appTree({
        files: {
          'services/subly-api/src/routes/subscriptions.ts': SUBLY_SUBSCRIPTIONS_TS.replace(
            "subscriptions.get('/', async (c) => c.json(await c.env.SUBLY_DB.prepare('SELECT 1').all()));",
            "const _unused = async (c) => c.json(await c.env.SUBLY_DB.prepare('SELECT 1').all());",
          ),
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /GET \/v1\/subscriptions \(register id `subly-list`\) — registered but NOT mounted by services\/subly-api\/src\/index\.ts/,
    );
  });

  test('🔴 an app Worker client inside its OWN Worker is the declaration, not a caller  [limb 2, second Worker]', () => {
    // `servingDir` is derived per Worker now. One still pinned to
    // services/platform would wave this through.
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes.find((x) => x.id === 'subly-list').client = {
            file: 'services/subly-api/src/routes/subscriptions.ts',
            expression: "'/v1/subscriptions'",
          };
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /GET \/v1\/subscriptions — client file `services\/subly-api\/src\/routes\/subscriptions\.ts` is inside the serving Worker \(services\/subly-api\)/,
    );
  });

  test('a PUBLIC app Worker route with no limiter and no reason FAILS  [limb 4, second Worker]', () => {
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          r.appWorkers[0].routes.find((x) => x.id === 'subly-health').auth = 'public';
        }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /GET \/v1\/health — `auth: public` and its handler reaches neither withinRateLimit nor withinEdgeCeiling/,
    );
  });

  test('a declared noLimiterReason on an app Worker PRINTS with the Worker name attached', () => {
    const { code, out } = run(
      appTree({
        register: appRegister((r) => {
          const rt = r.appWorkers[0].routes.find((x) => x.id === 'subly-health');
          rt.auth = 'public';
          rt.noLimiterReason = 'Static 200; does no I/O at all.';
        }),
      }),
    );
    assert.equal(code, 0, out);
    assert.match(out, /⚠ {2}GET \/v1\/health — PUBLIC AND UNLIMITED\. · subly-api Static 200/);
  });

  test('🔴 the printed gaps are attributed to the right Worker — two Workers mount GET /v1/health', () => {
    const { code, out } = run(appTree());
    assert.equal(code, 0, out);
    assert.match(out, /⚠ {2}GET \/v1\/health — NO CLIENT\. · subly-api /);
    assert.match(out, /⚠ {2}GET \/v1\/health — NO CLIENT\. · platform /);
  });

  // ── the per-Worker coverage self-checks ───────────────────────────────────
  test('COVERAGE LOST names the FIELD when an app Worker entrypoint does not exist', () => {
    const { code, out } = run(
      appTree({
        register: appRegister((r) => { r.appWorkers[0].entrypoint = 'services/subly-api/src/nowhere.ts'; }),
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /COVERAGE LOST — servingWorker\.entrypoint `services\/subly-api\/src\/nowhere\.ts` \(appWorkers\[0\]\) does not exist/,
    );
  });

  test('COVERAGE LOST when the APP Worker entrypoint mounts nothing the parser can see', () => {
    const { code, out } = run(
      appTree({ files: { 'services/subly-api/src/index.ts': 'export default { fetch: () => new Response() };\n' } }),
    );
    assert.equal(code, 1, out);
    assert.match(out, /COVERAGE LOST — parsed services\/subly-api\/src\/index\.ts and found ZERO mounted routes/);
  });

  test('COVERAGE LOST when the APP Worker parse follows no app.route() into a sub-router file', () => {
    // Both surviving routes — including the in-file group's — have the
    // entrypoint as their owningFile, which is exactly the partial loss the
    // zero-check cannot see.
    const { code, out } = run(
      appTree({
        files: {
          'services/subly-api/src/index.ts': SUBLY_INDEX_TS.replace(
            "app.route('/v1/subscriptions', subscriptions);",
            '',
          ),
        },
      }),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /COVERAGE LOST — every route the parser found is declared inline in services\/subly-api\/src\/index\.ts/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ NOT PINNED BY FIXTURE, AND SAID SO RATHER THAN FAKED. An assertion that
// cannot fail is worse than none.
//
//   · `deployableWorkers()`'s `if (!cfgRel.startsWith('services/')) continue;`
//     — the ONLY non-`services/` config the scan can reach is the brick
//     template, and the brick template carries no `main`, so the `main` test on
//     the next line already excludes it on every tree that can exist. No fixture
//     separates the guard from a mutant here.
//     THE SOURCE MUTATION THAT MAKES IT FIRE: delete that line AND give
//     tooling/bricks/app/__brick__/…/wrangler.jsonc a `"main"`. The guard then
//     reports the brick config as an undeclared Worker — and would go on to
//     demand a client tree for a mustache template, which is why the line is
//     there. The exclusion is deliberate and documented in the guard's header;
//     it is recorded here so nobody adds a test that looks like it pins it.
//
//   · the `· ${workerName}` suffix on the two `printed` lines is output text,
//     not a condition — there is no exit code to disagree about. The two tests
//     above assert the exact string, which is the whole of what it does.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// 🔴 REGRESSION: A ROUTE PATH CONTAINING `/*` BLINDED THE WHOLE SCANNER.
//
// Found 2026-08-05 by audit, not by CI. `stripComments` only TRACKED string
// literals when `alsoStrings` was true. The route scan calls it WITHOUT that
// flag (correctly — route paths are the string literals it needs to read), so
// the scanner walked straight through `app.use('/v1/plan/*', platformAuth);`
// at services/platform/src/index.ts:114, treated the `/*` inside that path as a
// block-comment opener, and blanked EVERY LINE AFTER IT — including line 115,
// `app.route('/v1', cancellation);`.
//
// The guard then printed "7 mounted route(s) reconciled with 7 register
// entry(ies)" and exited 0, while POST /v1/plan/cancel was mounted, deployed,
// and answering 401 in production, with ZERO occurrences in the register. The
// real mount count was 12.
//
// The parser-liveness self-check could not see it: it fires on
// `mounted.length === 0`, and this was a PARTIAL loss — 7 of 12 — which is
// indistinguishable from a healthy read.
// ─────────────────────────────────────────────────────────────────────────────
import { stripComments } from '../assert-platform-register.mjs';

describe('stripComments — strings are tracked even when they are not blanked', () => {
  test('🔴 a `/*` INSIDE a string literal does not swallow the rest of the file', () => {
    const src = [
      "app.use('/v1/plan/*', platformAuth);",
      "app.route('/v1', cancellation);",
    ].join('\n');
    const out = stripComments(src);
    assert.match(out, /app\.route\('\/v1', cancellation\);/, 'the line AFTER the /* path was blanked');
    assert.match(out, /'\/v1\/plan\/\*'/, 'the route path itself must survive — it is what gets matched');
  });

  test('the same holds for a `//` inside a string — a URL must not become a line comment', () => {
    const src = ["const base = 'https://api.nikatru.com';", 'app.route(x);'].join('\n');
    const out = stripComments(src);
    assert.match(out, /app\.route\(x\);/);
    assert.match(out, /https:\/\/api\.nikatru\.com/);
  });

  test('real comments are STILL removed — the fix must not disable comment stripping', () => {
    assert.doesNotMatch(stripComments('/* app.route(ghost); */ real();'), /ghost/);
    assert.doesNotMatch(stripComments('// app.route(ghost);\nreal();'), /ghost/);
    assert.match(stripComments('// app.route(ghost);\nreal();'), /real\(\);/);
  });

  test('alsoStrings:true still blanks literal CONTENTS, and offsets are preserved', () => {
    const src = "post('/v1/plan/cancel', h);";
    const out = stripComments(src, { alsoStrings: true });
    assert.doesNotMatch(out, /plan\/cancel/, 'alsoStrings must still blank the contents');
    assert.equal(out.length, src.length, 'stripComments must preserve offsets');
  });

  test('🔴 the REAL index.ts still yields every mount — not a fixture', () => {
    // A fixture encodes the same misunderstanding as the guard. This asserts
    // against the actual serving Worker: the count the scanner sees must match
    // the count present in the file.
    const real = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'services', 'platform', 'src', 'index.ts'),
      'utf8',
    );
    const raw = (real.match(/^app\.(use|route|get|post|all)\(/gm) ?? []).length;
    const seen = (stripComments(real).match(/^app\.(use|route|get|post|all)\(/gm) ?? []).length;
    assert.ok(raw >= 8, `expected the real index.ts to mount >= 8 routes, found ${raw}`);
    assert.equal(seen, raw, `stripComments lost ${raw - seen} mount call(s) from the real index.ts`);
  });
});
