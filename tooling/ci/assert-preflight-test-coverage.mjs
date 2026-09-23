#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-preflight-test-coverage.mjs — every Worker that answers browser
// preflights runs the SHARED preflight test, which derives the method list from
// the routes the Worker really mounts.
//
// ⏱ 2026-09-22 · O-PREFLIGHT-TEST-HAND-WRITTEN-WORKERS.
//
// 🔴 THE SAME DEFECT SHIPPED TWICE, AND BOTH TIMES THE WORKER'S OWN CORS TEST
// WAS GREEN. services/platform answered preflights with `GET, POST, DELETE,
// OPTIONS` while `PUT /v1/account/apple-token` was live, so no browser ever sent
// that PUT, the Apple refresh token never reached the server, and an account
// deleting itself had nothing to revoke at Apple. services/subscriptiontracker-api
// had already done it with `PUT /v1/budget`. In both Workers the cors test
// asserted a HAND-TYPED list of methods — the list the author remembered — so a
// route mounted with a new method could never make it fail.
//
// services/_shared/test/preflight.ts ends that by deriving the methods from
// Hono's own `app.routes`. But a shared helper only helps the suites that IMPORT
// it, and nothing made the next Worker import it. The third Worker would have
// been written the same way as the first two, and its cors test would have been
// green on the day it was wrong. This guard is what makes importing it the only
// way to pass.
//
// WHAT IT ASKS, per Worker that mounts a CORS middleware:
//   1. some file under its `test/` imports services/_shared/test/preflight, and
//   2. that file actually CALLS one of the derived helpers.
// (2) is not pedantry: an unused import is exactly what a suite is left with
// when somebody deletes the assertion that was failing them.
//
// ⚠️ THE IMPORT IS MATCHED BY RESOLVED PATH, NEVER BY ITS TEXT. A relative
// specifier is resolved against the importing file and compared to where
// preflight.ts actually is, so moving the shared module — or moving a Worker one
// directory deeper — keeps this guard true. A string match on
// `'../../_shared/test/preflight'` would go quietly green on a moved file that
// no longer exists, which is the failure mode this whole row is about.
//
// Exit codes, per AGENTS.md: 0 green, 1 a finding, 2 COVERAGE LOST.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const SERVICES = 'services';
const SHARED_DIR = '_shared';
const PREFLIGHT = 'services/_shared/test/preflight.ts';
// The helpers that DERIVE. `probePath` and `allowedMethods` are string plumbing
// a hand-written test could also call, so they do not count as proof.
const DERIVING_HELPERS = ['mountedEndpoints', 'unansweredMethods', 'refusedPreflights'];
// Two Workers serve browser routes today (platform, subscriptiontracker-api).
const MIN_WORKERS = 2;
const BRICK = 'tooling/bricks/app/__brick__';

let failed = false;
const fail = (m) => { console.error(`FAIL ${m}`); failed = true; };
const ok = (m) => console.log(`ok   ${m}`);
const coverageLost = (m) => {
  console.error(`✗ COVERAGE LOST — ${m}`);
  process.exit(2);
};

const rel = (p) => join(ROOT, ...p.split('/'));
const read = (p) => readFileSync(rel(p), 'utf8');

// ── the scan can see the tree ────────────────────────────────────────────────
if (!existsSync(rel(SERVICES))) {
  coverageLost(`no ${SERVICES}/ directory under ${ROOT}. The scan is broken, not the tree.`);
}
if (!existsSync(rel(PREFLIGHT))) {
  coverageLost(
    `${PREFLIGHT} is gone. Every limb below asks whether a suite imports THAT file; with it missing ` +
      'this guard would fail every Worker for the wrong reason, or — worse — be deleted as noise.',
  );
}

const sharedSource = read(PREFLIGHT);
const missingHelpers = DERIVING_HELPERS.filter(
  (h) => !new RegExp(`export\\s+(?:async\\s+)?function\\s+${h}\\b`).test(sharedSource),
);
if (missingHelpers.length > 0) {
  coverageLost(
    `${PREFLIGHT} no longer exports ${missingHelpers.join(', ')}. This guard grades suites by which of ` +
      'those they call, so a renamed export makes it grade nothing and say ok.',
  );
}

const sharedAbs = resolve(rel(PREFLIGHT));

/** Every directory under services/ that is a Worker: has its own src/index.ts. */
const workers = listDir(rel(SERVICES), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== SHARED_DIR)
  .map((e) => e.name)
  .filter((name) => existsSync(rel(`${SERVICES}/${name}/src/index.ts`)))
  .sort();

if (workers.length < MIN_WORKERS) {
  coverageLost(
    `${workers.length} Worker entrypoint(s) found under ${SERVICES}/*/src/index.ts, fewer than the ` +
      `${MIN_WORKERS} that exist today. Every limb below quantifies over that set, so a shrunken one ` +
      'certifies the Workers it can still see and says nothing at all about the rest.',
  );
}

/**
 * Does this entrypoint answer preflights? It mounts a middleware whose name
 * carries `cors` — which is how BOTH Workers do it today
 * (`app.use('*', corsMiddleware)`), in their own file and not in a shared one.
 * Comments are stripped first: every one of these files DISCUSSES cors at
 * length, and the prose must not be what makes the guard pass.
 */
function servesBrowserRoutes(indexSource) {
  const code = stripSourceComments(indexSource, '.ts');
  return /\.use\(\s*[^)]*\bcors/i.test(code);
}

/** Every `test/`-tree file, recursively, that could hold the import. */
function testFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of listDir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(full));
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The RESOLVED targets of every relative import in a source file. Extensionless
 * specifiers are the norm in this tree, so each candidate is tried with the
 * suffixes a bundler would try. Bare specifiers are skipped: a bare import of
 * the shared home resolves for nobody here (services/_shared/test/shared-home.test.ts
 * is the measurement of that) and would be a different defect.
 */
function resolvedImports(file, source) {
  const code = stripSourceComments(source, '.ts');
  const out = [];
  for (const m of code.matchAll(/(?:from|import)\s*['"](\.[^'"]*)['"]/g)) {
    const base = resolve(dirname(file), m[1]);
    for (const suffix of ['', '.ts', '.tsx', '.mts', '/index.ts']) out.push(base + suffix);
  }
  return out;
}

/**
 * ⚠️ THE TEMPLATE IS THE ONE PLACE A RESOLVED PATH CANNOT BE USED, and it is an
 * exception with a reason rather than a weakening. The brick's Worker lives
 * under `__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/`,
 * and there is no `_shared` beside it — that directory only exists in the
 * STAMPED tree, where `../../_shared/test/preflight` is the same file every
 * other suite imports. So the template is graded on the specifier's tail, which
 * is the strongest thing true before stamping.
 */
const SPECIFIER_TAIL = '/_shared/test/preflight';

function importsShared(file, source, byText) {
  if (!byText) return resolvedImports(file, source).includes(sharedAbs);
  const code = stripSourceComments(source, '.ts');
  return [...code.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)].some(
    (m) => m[1].endsWith(SPECIFIER_TAIL) || m[1].endsWith(`${SPECIFIER_TAIL}.ts`),
  );
}

let browserServing = 0;

function grade(label, entryPath, testDir, byText = false) {
  const indexSource = readFileSync(entryPath, 'utf8');
  if (!servesBrowserRoutes(indexSource)) {
    ok(`${label} mounts no CORS middleware — no preflight to get wrong`);
    return;
  }
  browserServing++;

  const importers = testFiles(testDir).filter((f) =>
    importsShared(f, readFileSync(f, 'utf8'), byText),
  );

  if (importers.length === 0) {
    fail(
      `${label} answers browser preflights and no file under ${relative(ROOT, testDir) || testDir} imports ` +
        `${PREFLIGHT}. Its CORS method list is therefore whatever somebody typed, and a route mounted with ` +
        'a method that list forgets will be refused in a browser while the suite stays green — twice now, ' +
        'the second time costing every Apple account its revoke-on-delete.',
    );
    return;
  }

  const using = importers.filter((f) => {
    const code = stripSourceComments(readFileSync(f, 'utf8'), '.ts');
    return DERIVING_HELPERS.some((h) => new RegExp(`\\b${h}\\s*\\(`).test(code));
  });

  if (using.length === 0) {
    fail(
      `${label} imports ${PREFLIGHT} but calls none of ${DERIVING_HELPERS.join(', ')}. An import that ` +
        'nothing calls is what a suite is left with when the assertion that was failing somebody got ' +
        'deleted, and it reads exactly like coverage.',
    );
    return;
  }

  ok(`${label} derives its preflight methods from its own routes (${using.map((f) => relative(ROOT, f)).join(', ')})`);
}

for (const name of workers) {
  grade(`services/${name}`, rel(`${SERVICES}/${name}/src/index.ts`), rel(`${SERVICES}/${name}/test`));
}

// ── the TEMPLATE, because a stamped Worker inherits its suite ────────────────
// The brick's services directory is wrapped in a mustache section
// (`{{#needs_backend}}services{{/needs_backend}}`), so it is found by walking,
// never by a literal path.
/**
 * ⚠️ THE BRICK'S WORKER IS NOT WHERE ITS PATH SAYS IT IS, and hard-coding that
 * path is how this limb would silently grade nothing. The source path is
 * `__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/`, and
 * the `/` inside the closing mustache is a REAL path separator on disk — so the
 * checkout is `{{#needs_backend}}services{{` / `needs_backend}}` /
 * `{{app_id}}-api`, three directories where the template reads as one. Anything
 * that walks by name is wrong the moment the section tag is renamed, so this
 * looks for the SHAPE instead: a directory holding `src/index.ts`.
 */
function brickWorkers(dir, depth = 0) {
  if (depth > 6 || !existsSync(dir)) return [];
  const out = [];
  if (existsSync(join(dir, 'src', 'index.ts'))) out.push(dir);
  for (const entry of listDir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...brickWorkers(join(dir, entry.name), depth + 1));
  }
  return out;
}

let templates = 0;
if (existsSync(rel(BRICK))) {
  // `apps/` under the brick is the Flutter app, not a Worker; it has no
  // `src/index.ts`, so the shape test excludes it without naming it.
  for (const worker of brickWorkers(rel(BRICK))) {
    templates++;
    grade(
      `template ${relative(ROOT, worker)}`,
      join(worker, 'src', 'index.ts'),
      join(worker, 'test'),
      true,
    );
  }
}

if (existsSync(rel(BRICK)) && templates === 0) {
  coverageLost(
    `${BRICK} exists but no Worker template was found under it. The template is where every FUTURE ` +
      'app\'s suite comes from, so a walk that stops finding it grades only the two Workers that ' +
      'already exist — which is the exact hole this guard was written to close.',
  );
}

if (browserServing === 0) {
  coverageLost(
    'not one Worker was seen to mount a CORS middleware. Either every Worker stopped serving browsers ' +
      'on the same day, or the detection above no longer matches how they are mounted — and in the ' +
      'second case this guard passes every Worker it is supposed to grade.',
  );
}

if (failed) {
  console.error(
    `✗ ${browserServing} Worker(s)/template(s) answer browser preflights; the failures above do not derive ` +
      `their method list from their own routes. The seam is ${PREFLIGHT}.`,
  );
  process.exit(1);
}

console.log(
  `✓ all ${browserServing} browser-serving Worker(s)/template(s) run the shared preflight test (of ` +
    `${workers.length} Worker(s) under ${SERVICES}/)`,
);
