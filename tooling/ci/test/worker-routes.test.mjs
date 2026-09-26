// ─────────────────────────────────────────────────────────────────────────────
// worker-routes.test.mjs — the cases for worker-routes.mjs, the ONE reader of
// what a Hono Worker mounts (moved out of assert-platform-register.mjs on
// 2026-09-26 so provision-backend.mjs step [6] derives a new Worker's routes
// with the parser the guard holds them to).
//
// The module scans nothing and owns no coverage claim: assert-platform-register
// carries the COVERAGE LOST over what it parsed (zero mounts; no sub-router
// followed) and step [6] refuses a Worker it found no mount in. What THIS file
// is for is the parser's own behaviour, each shape that once cost a PARTIAL read
// written as a case: the `/*` inside a string that blanked the rest of a file
// (7 of 12 routes), the in-file group the walk did not follow (3 of 12), the
// trailing slash Hono does not serve. A partial read passes a liveness check that
// fires on zero, so each of these asserts the WHOLE set, not a count.
//
// GREEN CONTROL FIRST (case A1). Without it every note below is equally
// consistent with a parser that reads nothing.
//
// Run:  node --test tooling/ci/test/worker-routes.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { mountedRoutes, stripComments } from '../worker-routes.mjs';
import { stripComments as reExported } from '../assert-platform-register.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BRICK_API = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-wroutes-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
/** A scratch root holding exactly `files` ({ relPath: body }). */
function root(files) {
  const r = join(TMP, `r${seq++}`);
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(r, p)), { recursive: true });
    writeFileSync(join(r, p), body);
  }
  return r;
}
/** The mounts as `METHOD path @ owningFile`, in the parser's order. */
const shape = (routes) => routes.map((x) => `${x.method} ${x.path} @ ${x.owningFile}`);

const ENTRY = 'services/w/src/index.ts';
const INDEX_TS = `
import { Hono } from 'hono';
import things from './routes/things';
// app.get('/v1/commented-out', h) is prose, not a mount.
const app = new Hono();
app.get('/v1/health', (c) => c.json({ ok: true }));
app.use('/v1/plan/*', auth);
app.route('/v1/things', things);
const api = new Hono();
api.use('*', auth);
api.post('/notes', (c) => c.json({}));
app.route('/v1', api);
export default app;
`;
const THINGS_TS = `
import { Hono } from 'hono';
const things = new Hono();
things.get('/', (c) => c.json([]));
things.delete('/:id', (c) => c.body(null, 204));
export default things;
`;

describe('worker-routes — mountedRoutes', () => {
  test('A1 green control: inline, imported sub-router and in-file group, the whole set', () => {
    const notes = [];
    const got = mountedRoutes(root({ [ENTRY]: INDEX_TS, 'services/w/src/routes/things.ts': THINGS_TS }), ENTRY, '', notes);
    // A router's own methods first, then each `.route()` in source order.
    assert.deepEqual(shape(got), [
      'GET /v1/health @ services/w/src/index.ts',
      'GET /v1/things @ services/w/src/routes/things.ts',
      'DELETE /v1/things/:id @ services/w/src/routes/things.ts',
      'POST /v1/notes @ services/w/src/index.ts',
    ]);
    assert.deepEqual(notes, []);
    assert.match(got[0].handler, /^\(\s*'\/v1\/health', \(c\) => c\.json\(\{ ok: true \}\)\)$/);
  });

  test('A2 a sub-router leaf of "/" joins with NO trailing slash, the path Hono serves', () => {
    const got = mountedRoutes(root({ [ENTRY]: INDEX_TS, 'services/w/src/routes/things.ts': THINGS_TS }), ENTRY, '', []);
    assert.ok(shape(got).includes('GET /v1/things @ services/w/src/routes/things.ts'));
    assert.ok(!got.some((x) => x.path === '/v1/things/'), 'a trailing slash names a path the Worker answers 404 on');
  });

  test('A3 a `/*` inside a string literal does not open a comment that swallows the next mount', () => {
    const got = mountedRoutes(root({ [ENTRY]: INDEX_TS, 'services/w/src/routes/things.ts': THINGS_TS }), ENTRY, '', []);
    // `app.use('/v1/plan/*', auth)` sits directly above `app.route('/v1/things', things)`.
    assert.ok(got.some((x) => x.path === '/v1/things/:id'), 'the mount after the `/*` string was lost');
  });

  test('A4 a mount the walk cannot resolve is a note, and the resolvable mounts are still read', () => {
    const notes = [];
    const src = INDEX_TS.replace("import things from './routes/things';\n", '');
    const got = mountedRoutes(root({ [ENTRY]: src }), ENTRY, '', notes);
    assert.deepEqual(shape(got), ['GET /v1/health @ services/w/src/index.ts', 'POST /v1/notes @ services/w/src/index.ts']);
    assert.deepEqual(notes, ['services/w/src/index.ts mounts `things` at /v1/things but no default import and no in-file `new Hono` resolves it']);
  });

  test('A5 an imported sub-router file that is not on disk is a note naming it', () => {
    const notes = [];
    const got = mountedRoutes(root({ [ENTRY]: INDEX_TS }), ENTRY, '', notes);
    assert.equal(got.some((x) => x.owningFile === 'services/w/src/routes/things.ts'), false);
    assert.deepEqual(notes, ['route file services/w/src/routes/things.ts does not exist']);
  });

  test('A6 an entrypoint with no `new Hono` is a note and no routes', () => {
    const notes = [];
    const got = mountedRoutes(root({ [ENTRY]: "export default { fetch: () => new Response('x') };\n" }), ENTRY, '', notes);
    assert.deepEqual(got, []);
    assert.deepEqual(notes, ['services/w/src/index.ts declares no `new Hono` instance — the parser found nothing to walk']);
  });

  test('A7 it reads under the root it is HANDED, never the working directory', () => {
    const one = mountedRoutes(root({ [ENTRY]: "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/v1/one', h);\n" }), ENTRY, '', []);
    const two = mountedRoutes(root({ [ENTRY]: "import { Hono } from 'hono';\nconst app = new Hono();\napp.put('/v1/two', h);\n" }), ENTRY, '', []);
    assert.deepEqual(shape(one), ['GET /v1/one @ services/w/src/index.ts']);
    assert.deepEqual(shape(two), ['PUT /v1/two @ services/w/src/index.ts']);
  });

  test('A8 the real brick Worker template: exactly its health route and its erasure route', () => {
    const notes = [];
    const got = mountedRoutes(REPO, `${BRICK_API}/src/index.ts`, '', notes);
    assert.deepEqual(shape(got), [
      `GET /v1/health @ ${BRICK_API}/src/index.ts`,
      `DELETE /v1/account @ ${BRICK_API}/src/routes/account.ts`,
    ]);
    assert.deepEqual(notes, []);
  });
});

describe('worker-routes — stripComments', () => {
  test('B1 comments are blanked with offsets kept; strings, including a `//` inside one, are kept', () => {
    const src = "const u = 'https://x.test/v1'; // a comment\n/* block\n */ app.get('/v1/a', h);\n";
    const out = stripComments(src);
    assert.equal(out.length, src.length);
    assert.ok(out.includes("'https://x.test/v1'"));
    assert.ok(!out.includes('a comment'));
    assert.ok(!out.includes('block'));
    assert.ok(out.includes("app.get('/v1/a', h);"));
  });

  test('B2 alsoStrings blanks the literals too, still offset-preserving', () => {
    const src = "call('/v1/a'); // x\n";
    const out = stripComments(src, { alsoStrings: true });
    assert.equal(out.length, src.length);
    assert.ok(!out.includes('/v1/a'));
    assert.ok(out.startsWith('call('));
  });

  test('B3 assert-platform-register re-exports this very function, for its two existing importers', () => {
    assert.equal(reExported, stripComments);
  });
});
