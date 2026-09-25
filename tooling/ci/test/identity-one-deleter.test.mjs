// ─────────────────────────────────────────────────────────────────────────────
// identity-one-deleter.test.mjs — assert-erasure-reach.mjs LIMB 6 and its
// `--stamped <dir>` mode. ⏱ 2026-09-24 · O-BRICK-ERASURE-DESTROYS-THE-IDENTITY.
//
// THE PROPERTY: exactly ONE Worker source file references the identity-delete
// endpoint (`auth/v1/admin/users`), it lies inside the entry Worker (the owner of
// platform_db), and no template references it. Until this date the brick
// template REQUIRED its stamped route to call that endpoint, so every stamped
// app was born a second identity deleter beside the platform's.
//
// 🔴 EVERY CASE MUTATES A COPY OF THE REAL TREE, the way erasure-reach.test.mjs
// does, and for its reason: a fixture you write encodes the misunderstanding of
// the guard you write. The copy carries the real services/platform, the real
// services/subscriptiontracker-api, the real shared home and the register — and,
// where a case needs the template, the real brick Worker plus the guard's own
// file (the sentinel that turns the template root on).
//
// Its own file rather than erasure-reach.test.mjs, so that file's pinned count is
// untouched; and never guards.test.mjs, which other lanes edit.
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GUARD = join(REPO, 'tooling', 'ci', 'assert-erasure-reach.mjs');

const REGISTER = 'tooling/legal/data-inventory.json';
const SUBLY = 'services/subscriptiontracker-api';
const PLATFORM = 'services/platform';
const PLATFORM_ERASURE = `${PLATFORM}/src/lib/platform-erasure.ts`;

// ⚠️ THE MUSTACHE DIRECTORY IS TWO SEGMENTS ON DISK: `{{/needs_backend}}` holds a
// `/`. Spelled as segments and joined, never handed to a matcher.
const BRICK_SEGMENTS = [
  'tooling', 'bricks', 'app', '__brick__', '{{#needs_backend}}services{{', 'needs_backend}}', '{{app_id}}-api',
];
const BRICK = BRICK_SEGMENTS.join('/');
const BRICK_ROUTE = `${BRICK}/src/routes/account.ts`;
/** Where app-brick stamps the probe backend, relative to the repo root. */
const STAMP = 'services/probeapi-api';

/** The line every mutation of a route inserts its call in front of. */
const ROUTE_RETURN = '  return c.json(walked);\n';
const IDENTITY_FETCH =
  "  await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });\n";

/** The live root: both Workers' src + migrations + config, the shared home and
 *  the register. No `tooling/ci`, so the template root is skipped. */
function liveTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-one-deleter-'));
  mkdirSync(join(root, 'tooling', 'legal'), { recursive: true });
  cpSync(join(REPO, REGISTER), join(root, REGISTER));
  mkdirSync(join(root, 'services', '_shared', 'src'), { recursive: true });
  cpSync(join(REPO, 'services', '_shared', 'src'), join(root, 'services', '_shared', 'src'), { recursive: true });
  for (const svc of [PLATFORM, SUBLY]) {
    mkdirSync(join(root, svc), { recursive: true });
    cpSync(join(REPO, svc, 'src'), join(root, svc, 'src'), { recursive: true });
    cpSync(join(REPO, svc, 'migrations'), join(root, svc, 'migrations'), { recursive: true });
    cpSync(join(REPO, svc, 'wrangler.jsonc'), join(root, svc, 'wrangler.jsonc'));
  }
  return root;
}

/** The live root PLUS the brick's stamped Worker PLUS the guard's own file. */
function templateTree() {
  const root = liveTree();
  cpSync(join(REPO, ...BRICK_SEGMENTS), join(root, ...BRICK_SEGMENTS), { recursive: true });
  mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
  cpSync(GUARD, join(root, 'tooling', 'ci', 'assert-erasure-reach.mjs'));
  return root;
}

/** A stamped backend as app-brick leaves it: the brick Worker at services/probeapi-api. */
function stampTree() {
  const root = mkdtempSync(join(tmpdir(), 'nikatru-one-deleter-stamp-'));
  cpSync(join(REPO, ...BRICK_SEGMENTS), join(root, STAMP), { recursive: true });
  return root;
}

function runIn(root, extraArgs = []) {
  try {
    return spawnSync(process.execPath, [GUARD, ...extraArgs, root], { cwd: REPO, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Write `rel` under `root` through `fn`; a mutation that changes nothing FAILS. */
const edit = (root, rel, fn) => {
  const p = join(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  assert.notEqual(after, before, `mutation of ${rel} changed nothing — the test would assert about the real tree`);
  writeFileSync(p, after);
};

const put = (root, rel, body) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** The platform's one deleter, with the endpoint spelled some other way — in
 *  code AND in its header, so no reference is left behind in either. */
const withoutPlatformDeleter = (root) =>
  edit(root, PLATFORM_ERASURE, (t) => t.replaceAll('/auth/v1/admin/users/', '/auth/v1/some/other/'));

describe('limb 6 — ONE identity deleter, inside the entry Worker', () => {
  test('green on the real tree names the one deleter', () => {
    const r = runIn(templateTree());
    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /limb 6: ONE identity deleter — services\/platform\/src\/lib\/platform-erasure\.ts, inside the entry Worker; 0 anywhere else across \d+ Worker src file\(s\) in 4 tree\(s\) \(1 template\(s\)\)/,
    );
  });

  test('re-adding the fetch to the brick route exits 1 naming the file', () => {
    // THE ROW'S RED CONTROL: the brick's route as it stood until 2026-09-24.
    const root = templateTree();
    edit(root, BRICK_ROUTE, (s) => {
      assert.ok(s.includes(ROUTE_RETURN), `the mutation target is gone from ${BRICK_ROUTE}`);
      return s.replace(ROUTE_RETURN, IDENTITY_FETCH + ROUTE_RETURN);
    });
    const r = runIn(root);
    assert.equal(r.status, 1, r.stdout);
    assert.match(
      r.stderr,
      /\{\{app_id\}\}-api\/src\/routes\/account\.ts references `auth\/v1\/admin\/users`, and it is a TEMPLATE/,
    );
  });

  test('a second live Worker file exits 1', () => {
    const root = liveTree();
    put(
      root,
      `${SUBLY}/src/lib/identity.ts`,
      "export const drop = (url: string, id: string) => fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE' });\n",
    );
    const r = runIn(root);
    assert.equal(r.status, 1, r.stdout);
    assert.match(
      r.stderr,
      /services\/subscriptiontracker-api\/src\/lib\/identity\.ts references `auth\/v1\/admin\/users` and is outside the entry Worker \(services\/platform\)/,
    );
  });

  test('the one deleter outside the entry Worker exits 1', () => {
    // Exactly one file still — but in the shared home, which every Worker carries.
    const root = liveTree();
    withoutPlatformDeleter(root);
    put(
      root,
      'services/_shared/src/identity.ts',
      "export const drop = (url: string, id: string) => fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE' });\n",
    );
    const r = runIn(root);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /services\/_shared\/src\/identity\.ts references `auth\/v1\/admin\/users` and is outside the entry Worker/);
    assert.match(r.stderr, /the entry Worker \(services\/platform\) references `auth\/v1\/admin\/users` in no src file/);
  });

  test('a comment mention is not a caller', () => {
    // Pairs with the RC6 real-tree control: a sentence ABOUT the endpoint is not a call.
    const root = templateTree();
    edit(root, BRICK_ROUTE, (s) =>
      s.replace(ROUTE_RETURN, `  // the route used to call \${c.env.SUPABASE_URL}/auth/v1/admin/users/<id> here\n${ROUTE_RETURN}`),
    );
    const r = runIn(root);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /limb 6: ONE identity deleter — services\/platform\/src\/lib\/platform-erasure\.ts/);
  });

  test('no deleter found is COVERAGE LOST (exit 2)', () => {
    const root = liveTree();
    withoutPlatformDeleter(root);
    const r = runIn(root);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COVERAGE LOST — no Worker src file references `auth\/v1\/admin\/users`/);
  });
});

describe('--stamped <dir> — limb 6 alone, over one stamped Worker', () => {
  test('--stamped over a stamp carrying the fetch exits 1', () => {
    // GREEN CONTROL FIRST, on an identical stamp: without it the red below is
    // equally consistent with a mode that cannot load.
    const clean = runIn(stampTree(), ['--stamped', STAMP]);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /ok {2}erasure reach --stamped services\/probeapi-api — 0 caller\(s\) of `auth\/v1\/admin\/users`/);

    const root = stampTree();
    edit(root, `${STAMP}/src/routes/account.ts`, (s) => s.replace(ROUTE_RETURN, IDENTITY_FETCH + ROUTE_RETURN));
    const r = runIn(root, ['--stamped', STAMP]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /services\/probeapi-api\/src\/routes\/account\.ts calls `auth\/v1\/admin\/users`/);
  });

  test('--stamped over a directory with no route exits 2', () => {
    const root = stampTree();
    rmSync(join(root, STAMP, 'src', 'routes', 'account.ts'));
    const r = runIn(root, ['--stamped', STAMP]);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /COVERAGE LOST — services\/probeapi-api\/src\/routes\/account\.ts does not exist/);
  });
});
