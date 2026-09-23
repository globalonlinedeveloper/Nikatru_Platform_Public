// ─────────────────────────────────────────────────────────────────────────────
// preflight-test-coverage.test.mjs — the grader for
// tooling/ci/assert-preflight-test-coverage.mjs.
//
// ⏱ 2026-09-22 · O-PREFLIGHT-TEST-HAND-WRITTEN-WORKERS.
//
// 🔴 EVERY CASE HERE IS A RED CONTROL OR THE GREEN IT IS MEASURED AGAINST. A
// guard is only worth its exit code if a tree that SHOULD fail does fail, so
// each fixture below is the real tree with exactly one thing taken away.
//
// The fixtures are written to a temp directory and the guard is run against it
// with its ROOT argument, because that argument exists for this.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), '..', 'assert-preflight-test-coverage.mjs');

const PREFLIGHT_SOURCE = `
export interface MountedRoute { method: string; path: string }
export function mountedEndpoints(routes) { return routes; }
export function probePath(p) { return p; }
export function allowedMethods(h) { return (h ?? '').split(','); }
export async function refusedPreflights(a, b) { return []; }
export function unansweredMethods(h, e) { return []; }
`;

const INDEX_WITH_CORS = `
import { Hono } from 'hono';
import { corsMiddleware } from './middleware/cors';
export const app = new Hono();
app.use('*', corsMiddleware);
export default app;
`;

const CORS_TEST = `
import { describe, it, expect } from 'vitest';
import { app } from '../src/index';
import { mountedEndpoints, refusedPreflights } from '../../_shared/test/preflight';
describe('cors', () => { it('derives', () => { expect(mountedEndpoints(app.routes)).toBeTruthy(); }); });
`;

const put = (root, path, body) => {
  const full = join(root, ...path.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
};

/** The tree as it stands today: two Workers, both importing the shared module. */
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'preflight-cov-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'services/_shared/test/preflight.ts', PREFLIGHT_SOURCE);
  for (const name of ['platform', 'thing-api']) {
    put(root, `services/${name}/src/index.ts`, INDEX_WITH_CORS);
    put(root, `services/${name}/src/middleware/cors.ts`, 'export const corsMiddleware = () => {};');
    put(root, `services/${name}/test/cors.test.ts`, CORS_TEST);
  }
  return root;
}

const run = (root) => spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });

test('green: every browser-serving Worker imports and CALLS the shared preflight', (t) => {
  const r = run(fixture(t));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /all 2 browser-serving/);
});

test('🔴 a new Worker with no preflight test is a finding, not a pass', (t) => {
  const root = fixture(t);
  put(root, 'services/newthing-api/src/index.ts', INDEX_WITH_CORS);
  put(root, 'services/newthing-api/src/middleware/cors.ts', 'export const corsMiddleware = () => {};');
  const r = run(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /services\/newthing-api answers browser preflights/);
});

test('🔴 an import nobody calls does not count as coverage', (t) => {
  const root = fixture(t);
  put(
    root,
    'services/thing-api/test/cors.test.ts',
    "import { mountedEndpoints } from '../../_shared/test/preflight';\n// and never calls it\n",
  );
  const r = run(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /imports .* but calls none of/);
});

test('a Worker that mounts no CORS middleware is not asked for one', (t) => {
  const root = fixture(t);
  put(root, 'services/cron-only/src/index.ts', "import { Hono } from 'hono';\nexport const app = new Hono();\n");
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cron-only mounts no CORS middleware/);
});

test('the prose is not what passes it: a commented-out mount still fails', (t) => {
  const root = fixture(t);
  put(
    root,
    'services/newthing-api/src/index.ts',
    "import { Hono } from 'hono';\n// app.use('*', corsMiddleware) — see the cors note\nexport const app = new Hono();\n",
  );
  const r = run(root);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /newthing-api mounts no CORS middleware/);
});

test('🔴 the import is matched by RESOLVED path: a moved shared module is caught', (t) => {
  const root = fixture(t);
  // The suite still says `../../_shared/test/preflight`, but from one directory
  // deeper that specifier resolves somewhere else entirely.
  put(root, 'services/thing-api/test/deep/cors.test.ts', CORS_TEST);
  put(root, 'services/thing-api/test/cors.test.ts', '// moved away\n');
  const r = run(root);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /thing-api answers browser preflights/);
});

test('✗ COVERAGE LOST exits 2 when the shared module is gone', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-cov-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'services/platform/src/index.ts', INDEX_WITH_CORS);
  const r = run(root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /COVERAGE LOST/);
});

test('✗ COVERAGE LOST exits 2 when a deriving export is renamed away', (t) => {
  const root = fixture(t);
  put(root, 'services/_shared/test/preflight.ts', PREFLIGHT_SOURCE.replace('unansweredMethods', 'gone'));
  const r = run(root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no longer exports/);
});

test('✗ COVERAGE LOST exits 2 when the Worker set shrinks below what exists', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-cov-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'services/_shared/test/preflight.ts', PREFLIGHT_SOURCE);
  put(root, 'services/platform/src/index.ts', INDEX_WITH_CORS);
  put(root, 'services/platform/test/cors.test.ts', CORS_TEST);
  const r = run(root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /fewer than the 2 that exist today/);
});

test('✗ COVERAGE LOST exits 2 when the brick exists but holds no Worker template', (t) => {
  const root = fixture(t);
  put(root, 'tooling/bricks/app/__brick__/apps/x/pubspec.yaml', 'name: x\n');
  const r = run(root);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no Worker template was found/);
});

test('the TEMPLATE is graded on the specifier, because its tree is unresolvable', (t) => {
  const root = fixture(t);
  const brick = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
  put(root, `${brick}/src/index.ts`, INDEX_WITH_CORS);
  put(root, `${brick}/test/cors.test.ts`, CORS_TEST);
  const green = run(root);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /all 3 browser-serving/);

  // 🔴 and the red control for that limb: drop the import from the template.
  put(root, `${brick}/test/cors.test.ts`, "import { app } from '../src/index';\n");
  const red = run(root);
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stderr, /template .* answers browser preflights/);
});
