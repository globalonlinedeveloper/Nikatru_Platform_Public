// ─────────────────────────────────────────────────────────────────────────────
// vendor-portability.test.mjs — assert-vendor-portability.mjs must be able to FAIL.
//
// [pipeline C-8] Every vendor satisfies the portability checklist, not "behind a
// seam" alone.
//
// ⚠️ SECOND LINE OF EVIDENCE. Nine mutations were run against the REAL repository
// first, all caught. Three of them exist because the lock named exactly which
// blind spot each derivation source covers, and every one checked out:
//   · a new vendor as a MULTILINE dart-define — a line-based grep finds 2 of the
//     11 defines that exist, so this is the source that hides UPDATE_URL
//   · a new vendor only in a Worker `Env` — REVENUECAT_WEBHOOK_SECRET lives only
//     there, so without it RevenueCat is invisible
//   · a new `ratelimits[].name` — that block keys on `name`, not `binding`, so a
//     binding-only scan cannot see EVENTS_LIMITER
// plus: the UPDATE_URL runtime fix reverted in core; the same fix reverted in the
// app; a seam symbol that is not really there; an export path that does not
// exist; an exit plan with no swap cost; a vendor missing a whole part.
//
// 🔬 THE GUARD'S FIRST RUN FAILED ON THE REAL TREE, unprompted, on exactly what
// the lock predicted (UPDATE_URL) — and on two surfaces nobody had listed
// (E2E_EMAIL / E2E_PASSWORD). UPDATE_URL was then fixed: it is now a runtime
// config key, so the force-update wall can be repointed without a release.
//
// The RUNTIME_MIGRATIONS anchor exists because asking "what mutation beats this?"
// found one: the register RECORDS that UPDATE_URL was fixed, but a register entry
// is a claim about code and nothing re-read the code. Reverting the fix left the
// guard printing ok. Both halves are now anchored — parsed in core, and read by
// the app.
//
// These fixtures `git init`, because source (a) uses `git ls-files` — which is
// also what keeps the gitignored apps/probe stamp out of the derivation.
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
const GUARD = join(CI_DIR, 'assert-vendor-portability.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-vendor-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;

const VENDOR = (over = {}) => ({
  surface: 'x',
  surfaces: [],
  openProtocol: 'YES — speaks a standard',
  seam: { file: 'packages/core/lib/seam.dart', symbol: 'AuthRepository' },
  configKeyed: { kind: 'runtime', detail: 'config, not code' },
  ownTheRecord: 'YES — our table',
  exportPath: { path: 'runbooks/ops.md', detail: 'pg_dump' },
  exitPlan: { alternative: 'something else', swapCost: 'Medium' },
  ...over,
});

/**
 * A tree mirroring the real one closely enough that the three per-source
 * coverage floors (10 dart-defines / 15 Env keys / 5 wrangler surfaces) clear.
 * Those floors exist precisely so a source cannot die silently, so a fixture
 * thinner than the floors would fail for the wrong reason.
 */
function tree({ mutate = (r) => r, dart = '', env = '', wrangler = '', core = null, app = null } = {}) {
  const root = join(TMP, `r${seq++}`);

  const DART_KEYS = ['API_BASE_URL', 'APP_ENV', 'APP_VERSION', 'CONFIG_BASE_URL', 'PLATFORM_BASE_URL', 'SKIP_REMOTE_CONFIG', 'APP_ID', 'API_VERSION'];
  // Deliberately MULTILINE — `dart format` wraps these, and a line-based scan
  // silently drops every one of them.
  const dartDefines = DART_KEYS.map((k) => `static const String v${k} = String.fromEnvironment(\n  '${k}',\n);`).join('\n');

  let register = {
    vendors: {
      _why: ['fixture'],
      supabase: VENDOR({ surfaces: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_JWT_SECRET'] }),
      glitchtip: VENDOR({ surfaces: ['GLITCHTIP_DSN'], configKeyed: { kind: 'compile-time', reason: 'a build reports as itself' } }),
      cloudflare: VENDOR({ surfaces: ['PLATFORM_DB', 'CONFIG_KV', 'EXPORTS', 'EVENTS_LIMITER', 'triggers.crons'] }),
      revenuecat: VENDOR({ surfaces: ['REVENUECAT_KEY', 'REVENUECAT_WEBHOOK_SECRET'] }),
    },
    nonVendorSurfaces: {
      _why: ['fixture'],
      UPDATE_URL: 'fixed — runtime now',
      ...Object.fromEntries(DART_KEYS.map((k) => [k, 'ours'])),
      ALLOWED_ORIGINS: 'our domains',
    },
  };
  register = mutate(register);

  const files = {
    'tooling/capability-register.json': JSON.stringify(register, null, 2),
    'packages/core/lib/seam.dart': 'abstract interface class AuthRepository {}\n',
    'runbooks/ops.md': '# ops\n',
    'app/defines.dart': `${dartDefines}\nstatic const String u = String.fromEnvironment(\n  'UPDATE_URL',\n);\nstatic const String s = String.fromEnvironment(\n  'SUPABASE_URL',\n);\nstatic const String a = String.fromEnvironment(\n  'SUPABASE_ANON_KEY',\n);\nstatic const String g = String.fromEnvironment(\n  'GLITCHTIP_DSN',\n);\nstatic const String r = String.fromEnvironment(\n  'REVENUECAT_KEY',\n);\n${dart}`,
    'services/platform/src/types.ts': `export interface Env {\n  PLATFORM_DB: D1Database;\n  CONFIG_KV: KVNamespace;\n  EVENTS_LIMITER: RateLimit;\n  EXPORTS: R2Bucket;\n  APP_ID: string;\n  API_VERSION: string;\n  ALLOWED_ORIGINS: string;\n  SUPABASE_URL: string;\n  SUPABASE_JWT_SECRET: string;\n  SUPABASE_ANON_KEY: string;\n  GLITCHTIP_DSN: string;\n  REVENUECAT_WEBHOOK_SECRET: string;\n  APP_ENV: string;\n  APP_VERSION: string;\n  API_BASE_URL: string;\n${env}}\n`,
    // NOTE: `wrangler` injects an EXTRA ENTRY into the existing ratelimits
    // array, not a second array. The first version of this fixture appended a
    // whole second "ratelimits" key and the case failed — correctly, because a
    // real wrangler.jsonc has exactly one. Fixing the fixture rather than
    // loosening the guard: a duplicate JSON key is not a scenario worth
    // defending against, and pretending it is would have widened the guard to
    // pass a situation that cannot happen.
    'services/platform/wrangler.jsonc': `{\n  "d1_databases": [{ "binding": "PLATFORM_DB" }],\n  "kv_namespaces": [{ "binding": "CONFIG_KV" }],\n  "r2_buckets": [{ "binding": "EXPORTS" }],\n  "ratelimits": [\n    {\n      "name": "EVENTS_LIMITER"\n    }${wrangler}\n  ],\n  "triggers": {\n    "crons": ["0 6 * * *"]\n  }\n}\n`,
    // The two RUNTIME_MIGRATIONS anchors, at the paths the guard hard-codes.
    'packages/core/lib/src/config/app_config.dart':
      core ?? "final x = AppConfig(\n  updateUrl: json['update_url'] is String ? json['update_url'] as String : null,\n);\n",
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/app.dart':
      app ?? 'final String updateUrl = ref.watch(appConfigProvider).valueOrNull?.updateUrl ?? AppConfig.updateUrl;\n',
  };

  for (const [f, body] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  // git ls-files is source (a)'s file list — and is what excludes the gitignored
  // apps/probe stamp from the real repository's derivation.
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('add', '-A');
  return root;
}

const run = (cwd) => {
  const r = spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

describe('assert-vendor-portability', () => {
  test('passes on a tree shaped like the real repository', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0);
    assert.match(out, /4 vendor\(s\) carry all six checklist parts/);
    // The two judgement parts are PRINTED, never pretended-checked.
    assert.match(out, /judgement parts, printed rather than pretended-checked/);
  });

  // ── the three derivation sources, each proving what the others cannot see ──
  describe('a new vendor cannot arrive unnoticed', () => {
    test('catches one that appears only as a MULTILINE dart-define', () => {
      const { code, out } = run(tree({ dart: "static const String k = String.fromEnvironment(\n  'STRIPE_PUBLISHABLE_KEY',\n);\n" }));
      assert.equal(code, 1);
      assert.match(out, /`STRIPE_PUBLISHABLE_KEY` \(found in dart-define\) is claimed by NO vendor/);
    });

    test('catches one that appears only in a Worker Env', () => {
      const { code, out } = run(tree({ env: '  TWILIO_AUTH_TOKEN: string;\n' }));
      assert.equal(code, 1);
      assert.match(out, /`TWILIO_AUTH_TOKEN` \(found in worker-env:platform\) is claimed by NO vendor/);
    });

    // ratelimits keys on `name`, not `binding` — a binding-only scan is blind.
    test('catches one that appears only as a ratelimits name', () => {
      const { code, out } = run(tree({ wrangler: ',\n    {\n      "name": "SIGNUP_LIMITER"\n    }' }));
      assert.equal(code, 1);
      assert.match(out, /`SIGNUP_LIMITER` \(found in wrangler-ratelimit:platform\) is claimed by NO vendor/);
    });

    test('FAILS on a claim for a surface that no longer exists', () => {
      const { code, out } = run(tree({
        mutate: (r) => { r.vendors.supabase.surfaces.push('DELETED_KEY'); return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /claims surface `DELETED_KEY`, which no longer exists/);
    });

    test('FAILS when two vendors claim the same surface', () => {
      const { code, out } = run(tree({
        mutate: (r) => { r.vendors.glitchtip.surfaces.push('SUPABASE_URL'); return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /claimed by BOTH/);
    });
  });

  // ── the four checked parts ────────────────────────────────────────────────
  describe('the checklist parts are checked, not just recorded', () => {
    test('FAILS when a seam symbol is not really there', () => {
      const { code, out } = run(tree({
        mutate: (r) => { r.vendors.supabase.seam.symbol = 'AuthRepo'; return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /names seam symbol `AuthRepo`.*which does not declare it/s);
    });

    test('FAILS when the export path does not exist', () => {
      const { code, out } = run(tree({
        mutate: (r) => { r.vendors.glitchtip.exportPath.path = 'runbooks/gone.md'; return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /An untested exit is not an exit/);
    });

    test('FAILS when an exit plan names no swap cost', () => {
      const { code, out } = run(tree({
        mutate: (r) => { r.vendors.glitchtip.exitPlan.swapCost = ''; return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /must name an alternative AND its swap cost/);
    });

    test('FAILS when a whole checklist part is missing', () => {
      const { code, out } = run(tree({
        mutate: (r) => { delete r.vendors.supabase.ownTheRecord; return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /records nothing for checklist part `ownTheRecord`/);
    });

    // compile-time is allowed, but it has to argue for itself.
    test('FAILS on compile-time config with no reason given', () => {
      const { code, out } = run(tree({
        mutate: (r) => { r.vendors.glitchtip.configKeyed = { kind: 'compile-time' }; return r; },
      }));
      assert.equal(code, 1);
      assert.match(out, /is `compile-time` config-keyed with no `reason`/);
    });
  });

  // ── the migration anchors — a register entry is a claim about code ─────────
  describe('a recorded runtime migration must still be implemented', () => {
    test('FAILS when core stops parsing the runtime key', () => {
      const { code, out } = run(tree({ core: 'final x = AppConfig();\n' }));
      assert.equal(code, 1);
      assert.match(out, /must PARSE `update_url`/);
    });

    test('FAILS when the app stops reading it and falls back to compile-time', () => {
      const { code, out } = run(tree({ app: 'final String updateUrl = AppConfig.updateUrl;\n' }));
      assert.equal(code, 1);
      assert.match(out, /must READ the runtime value/);
    });
  });

  // ── coverage self-checks: a source that dies must not read as clean ───────
  describe('a dead derivation source fails rather than passing everything', () => {
    test('FAILS when the Worker Env source finds almost nothing', () => {
      const root = tree();
      writeFileSync(join(root, 'services/platform/src/types.ts'), 'export interface Env {\n  APP_ID: string;\n}\n');
      const { code, out } = run(root);
      assert.equal(code, 1);
      assert.match(out, /COVERAGE LOST — source \(b\)/);
    });

    test('FAILS when the register declares no vendors at all', () => {
      const { code, out } = run(tree({ mutate: (r) => ({ ...r, vendors: { _why: ['x'] } }) }));
      assert.equal(code, 1);
      assert.match(out, /declares no vendors at all/);
    });
  });
});
