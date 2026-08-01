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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
