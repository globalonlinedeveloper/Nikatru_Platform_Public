// ─────────────────────────────────────────────────────────────────────────────
// no-origin-authz.test.mjs — assert-no-origin-authz.mjs must be able to FAIL.
//
// The guard's subject: after the web app moves from `subly.nikatru.com` to
// `nikatru.com/<app>` (owner decision 2026-09-09), EVERY app's browser tab sends
// the SAME `Origin`. So `Origin` stops being a per-app boundary, and a branch
// that reads it to decide access can no longer tell one app's tab from
// another's — and fails by GRANTING, silently. `Origin` may pick a CORS response
// header and nothing else; authorization rests on the bearer token and the
// Worker's own `APP_ID`.
//
// ⚠️ REAL-TREE PROOFS FIRST, on the live worktree, each exit code captured on its
// own line (a `$?` printed beside anything else is that thing's status — this
// repo has read `EXIT 0` off a guard that exited 1):
//   G  unmodified tree                                          -> EXIT 0
//        "43 .ts file(s) … 2 Origin read(s)/CORS import(s), all 2 inside the 2
//         declared CORS module(s), each still CORS-only; 0 elsewhere."
//   R1 `if (c.req.header('origin') === 'https://nikatru.com') { return … }`
//      inserted into the REAL `services/subscriptiontracker-api/src/routes/budget.ts` GET
//      handler                                                  -> EXIT 1,
//        naming `services/subscriptiontracker-api/src/routes/budget.ts:162`.
//        Reverted with `git checkout --` on that ONE file; `git hash-object`
//        e18389dc… before and after.
//   R2 `c.set('trustedOrigin', allowed)` added to the REAL
//      `services/platform/src/middleware/cors.ts` — the ALLOWLISTED file, to
//      prove the exemption is for CORS and not for the path -> EXIT 1,
//        "it writes context state, which is how an origin reaches a later
//         handler's decision". Reverted; hash 03757843… before and after.
//   C1 an empty directory as the root                           -> EXIT 2,
//        `✗ COVERAGE LOST [SERVICES-DIR]`.
//   C2 a root with `services/platform/src` and no files         -> EXIT 2,
//        `✗ COVERAGE LOST [FILE-FLOOR]`.
//   C3 CORS_MODULES pointed at `…/cors-moved.ts`                -> EXIT 2,
//        `✗ COVERAGE LOST [ALLOWLIST-PATHS]`.
//   C4 BOTH real CORS middlewares rewritten so the matcher sees nothing in
//      them (platform reading a computed header key, subscriptiontracker importing a local
//      wrapper instead of `hono/cors`)                          -> EXIT 2,
//        `✗ COVERAGE LOST [ORIGIN-SIGHTING] — not one Origin read or hono/cors
//         import was found in ANY declared CORS module.` Both reverted; hashes
//        03757843… and d9a07cfa… before and after.
//   ⏱ 2026-09-27 (O-SERVICE-KIT-UNBUILT, E-b1): CORS has ONE home,
//   services/_shared/src/cors.ts, and CORS_MODULES names it alone; each Worker's
//   src/middleware/cors.ts only binds it. Re-proven on the real tree:
//   G′ unmodified tree -> EXIT 0, "1 Origin read(s)/CORS import(s), all 1 inside
//      the 1 declared CORS module(s)".
//   R3 app #1's old `hono/cors` middleware put back in its
//      services/subscriptiontracker-api/src/middleware/cors.ts -> EXIT 1, naming
//      that file's `hono/cors` import as outside the declared modules.
//
// The cases below are the FIXTURE half — the shapes that must not need a live
// defect in the repository to be exercised, and the matcher's own edges. A
// fixture you wrote encodes the same misunderstanding as the guard you wrote,
// which is why it is the second half and not the first.
//
// Run:  node --test "tooling/ci/test/no-origin-authz.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { originReads, CORS_MODULES, MIN_TS_FILES, MIN_SERVICES_WITH_SRC } from '../assert-no-origin-authz.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-no-origin-authz.mjs');

let TMP;
let seq = 0;

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-origin-authz-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** The shape of the one real CORS middleware (services/_shared/src/cors.ts),
 *  reduced to the properties the guard actually asks about: it reads Origin,
 *  and it is recognisably CORS. */
const PLATFORM_CORS = `import type { MiddlewareHandler } from 'hono';
export const corsMiddleware: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin') ?? '';
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
};
`;

/** App #1's middleware as it was before E-b1: `hono/cors` in the Worker's own
 *  file. Since that file only binds the shared module, this shape is the input
 *  that must red — a Worker growing its own CORS policy again. */
const SUBLY_CORS = `import { cors } from 'hono/cors';
export const corsMiddleware = (c, next) => cors({ origin: (o) => o })(c, next);
`;

/** What each Worker's src/middleware/cors.ts is now: a binding, no Origin read. */
const BINDING = `import { cors } from '../../../_shared/src/cors';
export * from '../../../_shared/src/cors';
export const corsMiddleware = cors({ scope: 'own-app', appId: 'x', methods: ['GET', 'OPTIONS'] });
`;

/** The Worker source trees the fixture carries, whichever modules are declared. */
const WORKER_TREES = ['services/platform', 'services/subscriptiontracker-api'];

/**
 * A throwaway repo carrying the two declared CORS modules and enough filler
 * `.ts` files to clear the coverage floor, so that every case below fails for
 * the reason it is named after rather than for being too small to scan.
 *
 * `extra` maps a repo-relative path to its content; `omit` drops a declared
 * CORS module; `corsBody` overrides one of them.
 */
function tree({ extra = {}, omit = [], corsBody = {} } = {}) {
  const root = join(TMP, `r${seq++}`);
  const write = (rel, body) => {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };

  const declared = [...CORS_MODULES.keys()];
  const bodies = { [declared[0]]: PLATFORM_CORS, ...corsBody };
  for (const rel of declared) {
    if (omit.includes(rel)) continue;
    write(rel, bodies[rel]);
  }
  // Each Worker binds the shared module, as the real ones do.
  for (const t of WORKER_TREES) write(`${t}/src/middleware/cors.ts`, BINDING);

  // Filler across the Worker trees and the tree the declared module lives in,
  // so both floors (MIN_TS_FILES, MIN_SERVICES_WITH_SRC) are cleared honestly.
  const trees = [...new Set([...WORKER_TREES, ...declared.map((r) => r.split('/').slice(0, 2).join('/'))])];
  assert.ok(trees.length >= MIN_SERVICES_WITH_SRC, 'fixture must span both service trees');
  let n = 0;
  while (n < MIN_TS_FILES + 4) {
    for (const t of trees) {
      write(`${t}/src/routes/filler${n}.ts`, `export const filler${n} = ${n};\n`);
      n++;
    }
  }
  for (const t of WORKER_TREES) write(`${t}/src/index.ts`, "export default { fetch: () => new Response('ok') };\n");

  for (const [rel, body] of Object.entries(extra)) write(rel, body);
  return root;
}

function run(root) {
  const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ── the matcher, on its own ──────────────────────────────────────────────────
describe('originReads', () => {
  test('sees a hono request read and a raw Headers read', () => {
    assert.equal(originReads("const o = c.req.header('Origin');").length, 1);
    assert.equal(originReads('const r = request.headers.get("referer");').length, 1);
    assert.equal(originReads("c.req.raw.headers.get('Referrer')").length, 1);
  });

  // 🔴 THE CRY-WOLF DIRECTION. A pattern that looked anywhere on the line would
  // call every correct CORS middleware a violation, and a guard that reds the
  // correct tree is deleted within the week. The header NAME must be the
  // argument — `'Origin'`, never `'Access-Control-Allow-Origin'`, never `'Vary'`.
  test('does NOT see a RESPONSE header write that merely mentions Origin', () => {
    assert.equal(originReads("c.header('Vary', 'Origin');").length, 0);
    assert.equal(originReads("c.header('Access-Control-Allow-Origin', allowed);").length, 0);
    assert.equal(originReads("res.headers.set('Access-Control-Allow-Origin', '*');").length, 0);
  });

  // Prose satisfying a check is the defect text-reductions.mjs exists for, and
  // this repository has shipped it twice.
  test('does NOT see an Origin read that exists only in a comment', () => {
    assert.equal(originReads("// const o = c.req.header('Origin');").length, 0);
    assert.equal(originReads("/* c.req.header('Origin') is never read here */").length, 0);
  });

  test('sees a per-module hono/cors policy import', () => {
    assert.equal(originReads("import { cors } from 'hono/cors';").length, 1);
    assert.equal(originReads('import { cors } from "hono/cors";').length, 1);
  });

  test('reports the 1-based line of each hit', () => {
    const hits = originReads(`const a = 1;\nconst o = c.req.header('Origin');\n`);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 2);
  });
});

// ── the guard, spawned the way CI spawns it ──────────────────────────────────
describe('assert-no-origin-authz', () => {
  test('passes on the live shape: every read inside a declared CORS module', () => {
    const { code, out } = run(tree());
    assert.equal(code, 0, out);
    assert.match(out, /all 1 inside the 1 declared CORS module\(s\), each still CORS-only; 0 elsewhere/);
  });

  // E-b1: a Worker's own cors.ts only BINDS the shared module. Putting a local
  // `hono/cors` policy back in it is an Origin policy outside the one home.
  test('FAILS when a Worker\'s own cors.ts grows its own CORS policy again', () => {
    const root = tree({ extra: { 'services/subscriptiontracker-api/src/middleware/cors.ts': SUBLY_CORS } });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(
      out,
      /services\/subscriptiontracker-api\/src\/middleware\/cors\.ts:1 — imports `hono\/cors`, which is a per-module Origin policy/,
    );
  });

  // 🔴 THE defect this guard exists for. One origin now serves every app.
  test('FAILS on an Origin-dependent grant in a route handler', () => {
    const root = tree({
      extra: {
        'services/subscriptiontracker-api/src/routes/admin.ts':
          "export const handler = (c) => {\n" +
          "  if (c.req.header('origin') === 'https://nikatru.com') return c.json({ admin: true });\n" +
          '  return c.json({ admin: false });\n' +
          '};\n',
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /services\/subscriptiontracker-api\/src\/routes\/admin\.ts:2 — reads the request/);
    assert.match(out, /every app shares ONE browser origin/);
    assert.match(out, /it fails by GRANTING/);
  });

  test('FAILS on a Referer-dependent branch', () => {
    const root = tree({
      extra: {
        'services/platform/src/routes/gate.ts':
          'export const handler = (req) => {\n' +
          '  const from = req.headers.get("referer");\n' +
          '  return from.startsWith("https://nikatru.com") ? allow() : deny();\n' +
          '};\n',
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /services\/platform\/src\/routes\/gate\.ts:2 — reads the request/);
  });

  test('FAILS on a per-route hono/cors policy outside the declared modules', () => {
    const root = tree({
      extra: { 'services/platform/src/routes/wide.ts': "import { cors } from 'hono/cors';\n" },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /wide\.ts:1 — imports `hono\/cors`, which is a per-module Origin policy/);
  });

  // The allowlist is BY PATH, and the exemption is for being a CORS middleware.
  // A cors.ts that grew a database call is not what the allowlist vouches for.
  test('FAILS when a DECLARED CORS module reaches beyond CORS', () => {
    const [platform] = [...CORS_MODULES.keys()];
    const root = tree({
      corsBody: { [platform]: PLATFORM_CORS.replace('if (origin) {', "if (origin) {\n    c.set('trustedOrigin', origin);") },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /exempted to read Origin because it is a CORS middleware/);
    assert.match(out, /it writes context state/);
  });

  test('FAILS when a declared CORS module issues a D1 statement', () => {
    const [platform] = [...CORS_MODULES.keys()];
    const root = tree({
      corsBody: { [platform]: `${PLATFORM_CORS}const q = (env) => env.DB.prepare('SELECT 1');\n` },
    });
    const { code, out } = run(root);
    assert.equal(code, 1);
    assert.match(out, /it issues a D1 statement/);
  });

  // Both real middlewares name Authorization as an ALLOWED REQUEST HEADER, so a
  // tell matching it would red the correct tree on the day the guard landed.
  test('does NOT fail a CORS module that names Authorization as an allowed header', () => {
    const [platform] = [...CORS_MODULES.keys()];
    const root = tree({
      corsBody: {
        [platform]: PLATFORM_CORS.replace(
          "c.header('Vary', 'Origin');",
          "c.header('Vary', 'Origin');\n    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');",
        ),
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  test('a comment about reading Origin is not a read', () => {
    const root = tree({
      extra: {
        'services/platform/src/routes/prose.ts':
          "// This route deliberately does NOT read c.req.header('Origin') — see ADR.\nexport const x = 1;\n",
      },
    });
    const { code, out } = run(root);
    assert.equal(code, 0, out);
  });

  // ── anti-vacuity [pipeline F-10]: 2 is COVERAGE LOST, and is NOT a pass ────
  test('COVERAGE LOST [SERVICES-DIR] when there is no services/ directory', () => {
    const root = join(TMP, `bare${seq++}`);
    mkdirSync(root, { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /^✗ COVERAGE LOST \[SERVICES-DIR\]/);
  });

  test('COVERAGE LOST [FILE-FLOOR] when the scan collects too few files', () => {
    const root = join(TMP, `thin${seq++}`);
    mkdirSync(join(root, 'services', 'platform', 'src'), { recursive: true });
    const { code, out } = run(root);
    assert.equal(code, 2);
    assert.match(out, /^✗ COVERAGE LOST \[FILE-FLOOR\]/);
    assert.match(out, /0 \.ts file\(s\) across 1 service source tree\(s\)/);
  });

  test('COVERAGE LOST [ALLOWLIST-PATHS] when a declared CORS module is absent', () => {
    const [platform] = [...CORS_MODULES.keys()];
    const { code, out } = run(tree({ omit: [platform] }));
    assert.equal(code, 2);
    assert.match(out, /^✗ COVERAGE LOST \[ALLOWLIST-PATHS\]/);
    assert.match(out, /Either the middleware moved/);
  });

  test('COVERAGE LOST [CORS-TELL] when a declared module stops looking like CORS', () => {
    const [platform] = [...CORS_MODULES.keys()];
    const { code, out } = run(tree({ corsBody: { [platform]: 'export const corsMiddleware = null;\n' } }));
    assert.equal(code, 2);
    assert.match(out, /^✗ COVERAGE LOST \[CORS-TELL\]/);
  });

  // If the known-positive control stops matching, every clean result over the
  // rest of the tree is an artefact of the scan rather than a fact about it.
  test('COVERAGE LOST [ORIGIN-SIGHTING] when no declared CORS module matches', () => {
    const corsBody = Object.fromEntries(
      [...CORS_MODULES.keys()].map((rel) => [rel, "export const m = (c) => c.header('Access-Control-Allow-Origin', '*');\n"]),
    );
    const { code, out } = run(tree({ corsBody }));
    assert.equal(code, 2);
    assert.match(out, /^✗ COVERAGE LOST \[ORIGIN-SIGHTING\]/);
    assert.match(out, /known-positive control/);
  });

  // The canary is what stops the matcher rotting into silence. It runs on EVERY
  // invocation, so it is exercised by every case above; this asserts the shape
  // of its refusal exists rather than re-deriving it.
  test('the matcher self-canary answers every fixed shape correctly', () => {
    assert.equal(originReads("const o = c.req.header('Origin') ?? '';").length, 1);
    assert.equal(originReads("c.header('Access-Control-Allow-Origin', allowed);").length, 0);
  });
});
