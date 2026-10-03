#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-platform-register.mjs — the SHARED SERVER must know what it provides.
//
// [pipeline B-1] Private/requirements/ (was pipeline/04-backend-platform.md, folded
// into that JSON spec 2026-08-15) — "the factory declares,
// in one machine-readable place, every capability the shared server provides …
// and a capability with no client is not counted as delivered."
// [pipeline B-18] — "one shared bucket, and every bound bucket has a reader."
// [pipeline B-13] — the residual limb: an unauthenticated route with no limiter
//                   must SAY why, rather than simply not having one.
//
// WHY. This is assert-capability-register.mjs pointed at the server instead of at
// packages/. Six other stage-4 requirements quantify over "the shared capability
// set" or "every binding", and an undefined right-hand side rejects nothing — so
// all six were green over the empty set.
//
// 🔴 THE THREE WAYS THE ORIGINAL ACCEPTANCE CRITERION COULD NOT FAIL, and what
// replaced each:
//
//   1. "…or a register entry declares no client" is FIELD PRESENCE. `"client":
//      "TBD"` satisfies it, which is precisely the condition B-1 exists to
//      detect. Replaced by RESOLUTION: every `client.expression` must appear in
//      comment-stripped source, in a file outside the serving Worker, and must
//      itself contain the route's own static path — so it cannot be satisfied by
//      the server's declaration of the route and cannot outlive a rename.
//   2. It ranged over ROUTES ONLY, so it could not see the violation that was
//      live in production: `services/subscriptiontracker-api` bound a per-app R2 bucket
//      (`EXPORTS` → `subly-exports`, created 2026-07-17 — its name then; see the
//      rename note in services/subscriptiontracker-api/wrangler.jsonc) whose only occurrence
//      anywhere in `services/**/*.ts` was its own type declaration. Limb 3 makes
//      bindings first-class, and requires a READER that is not the Env type.
//   3. Its coverage was implicit. Here both floors are RELATIONSHIPS derived from
//      files CI already parses: the route set EQUALS what index.ts mounts, and
//      the binding set EQUALS what the wrangler configs declare. There is no
//      tuned integer to lower — the only integers are self-checks that the
//      PARSER still finds anything at all.
//
// ⚠️ A ROUTE WITH NO CLIENT DOES NOT FAIL THE BUILD; IT PRINTS, ON EVERY RUN.
// Same shape as assert-capability-register.mjs:412-424 and assert-seams-wired's
// owner-gated posture. `GET /v1/health` genuinely has no programmatic caller
// today, and failing the build on a gap that a different stage closes would
// block all CI on work this increment may not do. An UNDECLARED gap still fails.
//
// ⏱ LIMB 5 ADDED 2026-09-08 — THE VALUES COPIED INTO EVERY CONFIG NOW HAVE ONE
// SOURCE. Limbs 1-4 asked which routes and which BINDING NAMES each config
// declares, and never once compared a VALUE. Four of them — the Supabase
// project, the API-contract version, the shared entitlements database id and the
// JWKS namespace id — were typed identically into all three wrangler configs by
// hand, and mutation-measured that day, three of the four could be changed in
// the brick template with the full 134-guard sweep reporting the same RED set as
// the clean tree. The values now live once in the register's `sharedValues`
// block, with a reason each, and this limb compares every config against it.
//
// Usage:  node tooling/ci/assert-platform-register.mjs [repoRoot]
// Exit 0 = the register and the tree agree, 1 = they do not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';
import { stripComments, mountedRoutes } from './worker-routes.mjs';

// The comment stripper and the Hono mount parser live in worker-routes.mjs since
// 2026-09-26, moved there verbatim so provision-backend.mjs step [6] derives a
// new Worker's routes with the same parser this guard holds them to. The two
// modules that import `stripComments` from here still do.
export { stripComments };

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER = join(ROOT, 'tooling', 'platform-register.json');
const SERVICES_DIR = join(ROOT, 'services');
const BRICK_SERVICES_GLOB = join(ROOT, 'tooling', 'bricks', 'app', '__brick__');

/** Bindings live under these keys. `ratelimits` uses `name`, not `binding` — a
 *  binding-only scan cannot see EVENTS_LIMITER, which is exactly the blind spot
 *  assert-vendor-portability.mjs's _why paragraph already records. */
const BINDING_KEYS = [
  ['d1_databases', 'binding'],
  ['kv_namespaces', 'binding'],
  ['r2_buckets', 'binding'],
  ['ratelimits', 'name'],
];

/** The limiter helpers a public route must reach. Derived from the tree in the
 *  sense that all four are exported by services/platform/src/lib/edge-ceiling.ts;
 *  named here because a guard cannot guess which function means "bounded".
 *  ⏱ 2026-09-28 · ST-N1: `strictRateLimit` / `strictEdgeCeiling` are the
 *  FAIL-CLOSED pair (POST /v1/auth/native/*), a stronger bound than the two
 *  fail-open helpers, never a weaker one. */
const LIMITER_CALLS = ['withinRateLimit', 'withinEdgeCeiling', 'strictRateLimit', 'strictEdgeCeiling'];

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

const rel = (p) => posix.normalize(p.replace(/\\/g, '/'));

// ── JSONC → JSON ─────────────────────────────────────────────────────────────
// Comments are STRIPPED before parsing, never scanned: this repo has already
// shipped a guard whose `grep '"r2_buckets"'` matched the template comment
// EXPLAINING why there is no r2_buckets. String literals are respected so a `//`
// inside a url is not mistaken for a comment.
function parseJsonc(text, where) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (err) {
    fail([`✗ ${where} — could not be parsed after stripping comments: ${err.message}`]);
  }
}

/** What the mount parser could not follow, printed with a COVERAGE LOST below. */
const parseNotes = [];

// ── MAIN GUARD ─────────────────────────────────────────────────────────
// EVERYTHING BELOW IS THE CHECK, AND IT RUNS ONLY WHEN THIS FILE IS THE
// PROCESS ENTRYPOINT.
//
// 🔴 WHY (2026-08-25). The whole check used to run at MODULE SCOPE, so merely
// IMPORTING this file ran it and could `process.exit(1)`. That import is real:
// tooling/ci/test/platform-register.test.mjs imports `stripComments` from here.
// MEASURED before the fix, on a scratch copy with `app.route('/v1', events)`
// deleted from services/platform/src/index.ts:
//   node --test tooling/ci/test/platform-register.test.mjs
//     -> ℹ tests 1 / ℹ pass 0 / ℹ fail 1, and `test at <file>:1:1 'test failed'`
// One line of attribution for 1200+ lines of cases — the suite would go dark
// exactly when the tree went red, which is the only moment it is worth reading.
// It has never been hit because the guard exits 0 on the tree as it stands.
//
// The comparison is `import.meta.url` against `pathToFileURL(process.argv[1])`
// and NOT a string compare, for two reasons, both measured on this machine
// (Node v24.18.0, win32): argv[1] is a Windows path with backslashes while
// import.meta.url is a `file:///C:/…` URL, so a bare compare is never equal; and
// under `node --test` argv[1] is the TEST FILE while argv[2] — this guard's ROOT
// override — is undefined, so `?? ''` keeps pathToFileURL from throwing on the
// `node -e` shape, where argv[1] does not exist at all.
//
// ⚠️ The SPAWNED path must be unchanged: platform-register.test.mjs runs
// `node tooling/ci/assert-platform-register.mjs <root>` through spawnSync for
// every one of its failing cases, and those must still exit 1 with their
// messages. That is what the whole describe() block above the import asserts.
// ─────────────────────────────────────────────────────────────────────
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // ── 0. the register ──────────────────────────────────────────────────────────
  if (!existsSync(REGISTER)) {
    coverageLost([
      `✗ COVERAGE LOST — no platform register at ${REGISTER}.`,
      '  [pipeline B-1] requires a machine-readable register of every shared-server capability.',
    ]);
  }
  let register;
  try {
    register = JSON.parse(readFileSync(REGISTER, 'utf8'));
  } catch (err) {
    fail([`✗ platform register is not valid JSON: ${err.message}`]);
  }

  const serving = register.servingWorker ?? {};
  if (!serving.entrypoint) fail(['✗ platform register declares no `servingWorker.entrypoint` — limb 1 has no subject.']);
  const routes = Array.isArray(register.routes) ? register.routes : null;
  if (!routes) fail(['✗ platform register has no `routes` array — nothing to enforce.']);
  const bindings = Array.isArray(register.bindings) ? register.bindings : null;
  if (!bindings) fail(['✗ platform register has no `bindings` array — [B-18] could never fail.']);
  const declaredConfigs = (register.bindingSources?.configs ?? []).map(rel);
  if (declaredConfigs.length === 0) {
    fail(['✗ platform register declares no `bindingSources.configs` — the binding scan has no coverage assertion.']);
  }

  const problems = [];
  const printed = [];

  // ─────────────────────────────────────────────────────────────────────────────
  // THE SUBJECT IS EVERY DEPLOYABLE WORKER, AND THE LIST OF THEM IS DERIVED.
  //
  // 🔴 UNTIL THIS BLOCK, LIMB 1'S WHOLE SUBJECT WAS `servingWorker` — ONE Worker.
  // `services/subscriptiontracker-api` mounts TWELVE routes and not one of them was in any
  // register, so limb 2's rule ("a capability with no client is not delivered")
  // covered zero of them, and a route deleted from that Worker was
  // indistinguishable from a route that had never existed. That is how
  // `GET /v1/renewals` — 108 lines, mounted behind supabaseAuth, with its own test
  // file and no caller anywhere — stayed invisible.
  //
  // ⚠️ THE WORKER LIST IS NOT HAND-KEPT. A hand-kept list covers what somebody
  // remembered, which is the failure this register exists to stop. A wrangler
  // config under `services/` that declares `main` IS a Worker that answers
  // requests — that is already the predicate the [B-15] host limb below uses — so
  // the deployable set is read off the same configs, and the register's declared
  // set must EQUAL it in both directions. A third backend cannot arrive unseen.
  //
  // ⚠️ THE BRICK TEMPLATE IS DELIBERATELY NOT IN THIS SET, and the exclusion is a
  // path predicate rather than a sentence: it is a mustache TEMPLATE, not a
  // deployed Worker, and it has no client tree of its own to resolve a caller in.
  // It stays fully in scope for the binding limb and the host limb, which is where
  // the per-app-bucket defect it once carried would show up.
  // ─────────────────────────────────────────────────────────────────────────────
  const onDiskConfigs = wranglerConfigsOnDisk();
  if (onDiskConfigs.length === 0) {
    coverageLost([
      '✗ COVERAGE LOST — found ZERO wrangler configs on disk. The scan is broken, not the tree.',
      `  looked under ${SERVICES_DIR} and ${BRICK_SERVICES_GLOB}`,
    ]);
  }

  /** Every `services/*` wrangler config that declares `main`, with the entrypoint
   *  that `main` resolves to. This is the right-hand side of the worker-set
   *  equality below — read off the tree, never off the register. */
  function deployableWorkers() {
    const out = [];
    for (const cfgRel of onDiskConfigs) {
      if (!cfgRel.startsWith('services/')) continue;
      const cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel);
      if (typeof cfg.main !== 'string' || cfg.main === '') continue;
      out.push({
        config: cfgRel,
        name: typeof cfg.name === 'string' ? cfg.name : '',
        entrypoint: rel(posix.join(posix.dirname(cfgRel), cfg.main)),
      });
    }
    return out;
  }
  const derivedWorkers = deployableWorkers().filter((w) => !edgeConfigRels(register).has(w.config)); // limb 7
  const derivedByConfig = new Map(derivedWorkers.map((w) => [w.config, w]));

  const appWorkers = Array.isArray(register.appWorkers) ? register.appWorkers : [];
  const declaredWorkers = [
    { spec: serving, field: 'servingWorker', routes },
    ...appWorkers.map((w, i) => ({ spec: w, field: `appWorkers[${i}]`, routes: w?.routes })),
  ];

  for (const w of declaredWorkers) {
    if (!Array.isArray(w.routes)) {
      fail([`✗ platform register — ${w.field} has no \`routes\` array; its Worker's mounts would be enforced by nothing.`]);
    }
  }

  const declaredNames = declaredWorkers.map((w) => String(w.spec?.name ?? ''));
  if (new Set(declaredNames).size !== declaredNames.length) {
    fail([
      `✗ platform register — two declared Workers share a \`name\` (${declaredNames.join(', ')}).`,
      '  The route key is (worker, method, path); duplicate names collapse two Workers into one subject,',
      '  and both of these Workers mount GET /v1/health and DELETE /v1/account.',
    ]);
  }

  // The worker set, in BOTH directions, against the tree.
  const declaredConfigSet = new Set(declaredWorkers.map((w) => rel(String(w.spec?.config ?? ''))));
  for (const d of derivedWorkers) {
    if (!declaredConfigSet.has(d.config)) {
      problems.push(
        `${d.config} — declares \`main\`, so it is a Worker that answers requests, and the register declares ` +
          'neither it nor its routes. [B-1] Every route it mounts is outside the subject of limbs 1, 2 and 4: ' +
          'nothing can tell a handler that was deleted from one that was never there.',
      );
    }
  }
  for (const w of declaredWorkers) {
    const cfgRel = rel(String(w.spec?.config ?? ''));
    if (!derivedByConfig.has(cfgRel)) {
      problems.push(
        `${w.field} names \`${cfgRel}\`, which is not a \`services/*\` wrangler config declaring \`main\`. ` +
          'The register is describing a Worker the tree does not deploy.',
      );
    }
  }

  const key = (m, p) => `${m} ${p}`;

  /** Route entries whose `client` may name a path with the Worker's base prefix
   *  removed — the Dart seam builds its URLs on a baseUrl that already carries it.
   *  Constrained rather than trusted: the prefix must be a real prefix of EVERY
   *  path this Worker mounts, and the residual it leaves must still be a non-empty
   *  path. A `clientBasePath` that swallowed the discriminating segment would turn
   *  the rename check into a tautology, which is the dangerous direction. */
  function clientPathCandidates(routePath, basePath) {
    const staticPrefix = rel(String(routePath)).split('/:')[0];
    const out = [staticPrefix];
    if (basePath && staticPrefix.startsWith(`${basePath}/`)) {
      const residual = staticPrefix.slice(basePath.length);
      if (residual.length > 1) out.push(residual);
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── LIMB 6 · THE BRICK'S ROUTE-CLIENT MAP IS A ROW FOR THE TEMPLATE ──────────
  //
  // ⏱ 2026-09-26 (O-SERVICE-KIT-UNBUILT, E-a1). tooling/scripts/provision-backend.mjs
  // step [6] writes a stamped Worker's `appWorkers` row: its routes DERIVED from the
  // stamped entrypoint (worker-routes.mjs, the parser above), and each route's auth,
  // purpose, client and noLimiterReason copied from tooling/bricks/app/route-clients.json.
  // The template was out of limb 1's subject because it had no client tree to resolve a
  // caller in (the block above `deployableWorkers`); the map is that client tree. So the
  // map is checked HERE, before any app is stamped, as if it were a register row for the
  // template: its entries EQUAL the template entrypoint's mounts, both ways, and each one
  // passes limbs 1, 2 and 4 in the loop below. A template route with no entry, or an
  // entry whose client no longer resolves, is red on the template's own PR instead of
  // stopping step [6] on the day somebody stamps an app.
  //
  // A client `file` holding `<<app_id>>` names a file the brick STAMPS; it resolves
  // inside the brick's `__brick__/` tree with `{{app_id}}` in its place, as mason
  // renders it. An entry may carry no `unconsumedReason`: step [6] would copy it into
  // every stamped row, and a waiver copied by a script is a waiver nobody decided.
  //
  // Scoped to a template config that declares `main`, the predicate the host limb and
  // limb 5 use. The template's route files and every `purpose` are the map's; its
  // `owningFile`s are the parser's, since a stamped row takes them from the same parse.
  // ─────────────────────────────────────────────────────────────────────────────
  const BRICK_ROOT = 'tooling/bricks/app/__brick__';
  const ROUTE_CLIENTS = 'tooling/bricks/app/route-clients.json';
  function templateRow() {
    const tpl = onDiskConfigs.find((c) => c.startsWith(`${BRICK_ROOT}/`));
    if (!tpl) return null;
    const cfg = parseJsonc(readFileSync(join(ROOT, tpl), 'utf8'), tpl);
    if (typeof cfg.main !== 'string' || cfg.main === '') return null;
    let map;
    try {
      map = JSON.parse(readFileSync(join(ROOT, ROUTE_CLIENTS), 'utf8'));
    } catch (err) {
      problems.push(
        `${ROUTE_CLIENTS} — ${err.code === 'ENOENT' ? 'missing' : `not valid JSON (${err.message})`}. The brick stamps ` +
          `a Worker (${tpl}), and provision-backend.mjs step [6] takes each of its routes' clients from this map.`,
      );
      return null;
    }
    if (!Array.isArray(map?.routes)) {
      problems.push(`${ROUTE_CLIENTS} — has no \`routes\` array, so it names no client for any route the template mounts.`);
      return null;
    }
    const entrypoint = rel(posix.join(posix.dirname(tpl), cfg.main));
    const owners = new Map(mountedRoutes(ROOT, entrypoint, '', []).map((m) => [key(m.method, m.path), m.owningFile]));
    const asTemplate = (s) => String(s ?? '').replaceAll('<<app_id>>', '{{app_id}}');
    const routes = map.routes.map((r) => {
      if (r && Object.hasOwn(r, 'unconsumedReason')) {
        problems.push(
          `${ROUTE_CLIENTS} — ${r.method} ${r.path} carries an \`unconsumedReason\`. Step [6] copies each entry into every ` +
            'stamped row, so this would be a waiver written by a script; name the caller, or leave the route out of the template.',
        );
      }
      const file = String(r?.client?.file ?? '');
      return {
        ...r,
        id: asTemplate(r?.id),
        owningFile: owners.get(key(String(r?.method).toUpperCase(), rel(String(r?.path)))) ?? '',
        client: r?.client && {
          ...r.client,
          file: file.includes('<<app_id>>') ? `${BRICK_ROOT}/${asTemplate(file)}` : file,
          expression: asTemplate(r.client.expression),
        },
      };
    });
    return {
      spec: { name: cfg.name, entrypoint, config: tpl, clientBasePath: map.clientBasePath },
      field: ROUTE_CLIENTS,
      routes,
      registerName: ROUTE_CLIENTS,
      template: true,
    };
  }
  const brickRow = templateRow();

  const allMounted = [];
  let mountedInServing = 0;
  for (const w of brickRow ? [...declaredWorkers, brickRow] : declaredWorkers) {
    const workerName = String(w.spec?.name ?? w.field);

    // ── LIMB 1 · route set == what the entrypoint mounts, both directions ──────
    const entrypoint = rel(String(w.spec?.entrypoint ?? ''));
    if (!entrypoint || !existsSync(join(ROOT, entrypoint))) {
      coverageLost([
        `✗ COVERAGE LOST — servingWorker.entrypoint \`${entrypoint}\` (${w.field}) does not exist.`,
        '  The register names a Worker this scan cannot read; every route claim below would pass over nothing.',
      ]);
    }
    const derived = derivedByConfig.get(rel(String(w.spec?.config ?? '')));
    if (derived) {
      if (derived.entrypoint !== entrypoint) {
        problems.push(
          `${w.field} — declares entrypoint \`${entrypoint}\`, but \`${derived.config}\`'s \`main\` resolves to ` +
            `\`${derived.entrypoint}\`. The scan would parse a file the deploy does not run.`,
        );
      }
      if (derived.name && derived.name !== workerName) {
        problems.push(
          `${w.field} — calls this Worker \`${workerName}\`; \`${derived.config}\` deploys it as \`${derived.name}\`.`,
        );
      }
    }

    const mounted = mountedRoutes(ROOT, entrypoint, '', parseNotes);
    if (!w.template) allMounted.push(...mounted);
    if (w.field === 'servingWorker') mountedInServing = mounted.length;

    // Self-check: a parser that matches nothing agrees perfectly with any register.
    // This is the ONLY integer in the guard and it is a parser liveness floor, not a
    // coverage number — the coverage floor is the set equality immediately below.
    if (mounted.length === 0) {
      coverageLost([
        `✗ COVERAGE LOST — parsed ${entrypoint} and found ZERO mounted routes.`,
        '  The parser is broken, not the Worker. Notes:',
        ...parseNotes.map((n) => `    · ${n}`),
      ]);
    }
    // …and it must have followed at least one `app.route()` into a sub-router, or it
    // is only seeing the routes declared inline in the entrypoint. Today that would
    // silently drop three of four.
    if (!mounted.some((r) => r.owningFile !== entrypoint)) {
      coverageLost([
        `✗ COVERAGE LOST — every route the parser found is declared inline in ${entrypoint};`,
        '  it followed no \`app.route(prefix, subRouter)\` into a sub-router file. Notes:',
        ...parseNotes.map((n) => `    · ${n}`),
      ]);
    }

    const mountedByKey = new Map(mounted.map((r) => [key(r.method, r.path), r]));
    const registeredByKey = new Map(
      w.routes.map((r) => [key(String(r.method).toUpperCase(), rel(String(r.path))), r]),
    );
    if (registeredByKey.size !== w.routes.length) {
      problems.push(
        `${w.field} — two entries share a (method, path); one is shadowing the other and can never be checked.`,
      );
    }

    for (const [k, r] of mountedByKey) {
      if (!registeredByKey.has(k)) {
        problems.push(
          `${k} — MOUNTED by ${r.owningFile} and absent from ${w.registerName ?? 'the register'}. [B-1] An unregistered shared ` +
            'route is one no other requirement can quantify over: B-13 cannot ask whether it is limited, ' +
            'B-14 cannot ask whether its wire shape is pinned, B-4a cannot ask whether it validates app_id.',
        );
      }
    }
    for (const [k, entry] of registeredByKey) {
      if (!mountedByKey.has(k)) {
        problems.push(
          `${k} (register id \`${entry.id ?? '?'}\`) — registered but NOT mounted by ${entrypoint}. ` +
            'The register is describing a capability the shared server does not provide.',
        );
      }
    }

    // owningFile must be where the route is really declared, not merely a real file.
    for (const [k, entry] of registeredByKey) {
      const m = mountedByKey.get(k);
      if (!m) continue;
      if (rel(String(entry.owningFile ?? '')) !== m.owningFile) {
        problems.push(
          `${k} — register says \`${entry.owningFile}\` owns it; the parser found it declared in ` +
            `\`${m.owningFile}\`. A wrong owningFile silently re-points limb 4 at a different file's limiters.`,
        );
      }
      if (!['required', 'public'].includes(entry.auth)) {
        problems.push(`${k} — \`auth\` must be exactly "required" or "public" (got ${JSON.stringify(entry.auth)}).`);
      }
      if (!String(entry.purpose ?? '').trim()) {
        problems.push(`${k} — no \`purpose\`. A register that says only that a route exists is a routing table.`);
      }
    }

    // ── the client base path, checked against this Worker's own mounts ─────────
    const rawBase = w.spec?.clientBasePath;
    let basePath = '';
    if (rawBase !== undefined) {
      const bp = rel(String(rawBase));
      if (!/^\/[^/](?:.*[^/])?$/.test(bp)) {
        problems.push(
          `${w.field} — \`clientBasePath\` must be an absolute path with no trailing slash (got ${JSON.stringify(rawBase)}).`,
        );
      } else {
        const notPrefixed = mounted.filter((r) => !r.path.startsWith(`${bp}/`));
        if (notPrefixed.length) {
          problems.push(
            `${w.field} — \`clientBasePath\` \`${bp}\` is not a prefix of ` +
              `${notPrefixed.map((r) => key(r.method, r.path)).join(', ')}. A base path that does not front every ` +
              'mounted route is not a base path; it is a way to delete a segment from the rename check.',
          );
        } else {
          basePath = bp;
        }
      }
    }

    // ── LIMB 2 · every client RESOLVES to a real call site, or PRINTS its reason ──
    const servingDir = posix.dirname(posix.dirname(entrypoint)); // services/<worker>
    for (const entry of w.routes) {
      const k = key(String(entry.method).toUpperCase(), rel(String(entry.path)));
      const where = ` · ${workerName}`;
      const c = entry.client;
      if (!c) {
        if (String(entry.unconsumedReason ?? '').trim()) {
          printed.push(`⚠  ${k} — NO CLIENT.${where} ${entry.unconsumedReason}`);
        } else {
          problems.push(
            `${k} — declares no \`client\` and no \`unconsumedReason\`. [B-1] A capability with no client is ` +
              'not delivered; say who calls it, or say in writing why nothing does.',
          );
        }
        continue;
      }
      if (!c.file || !c.expression) {
        problems.push(`${k} — \`client\` needs both a \`file\` and an \`expression\`. A bare string is the "TBD" defect.`);
        continue;
      }
      const cf = rel(c.file);
      // 🔴 The expression may not come from the Worker that SERVES the route. This is
      // the HTTP analogue of "matched as a usage, never as the symbol's own
      // declaration" — the server declaring `POST /v1/events` is not evidence that
      // anything calls it.
      if (cf.startsWith(`${servingDir}/`)) {
        problems.push(
          `${k} — client file \`${cf}\` is inside the serving Worker (${servingDir}). That is the route's own ` +
            'declaration, not a caller. [B-1]',
        );
        continue;
      }
      if (!existsSync(join(ROOT, cf))) {
        problems.push(`${k} — client file \`${cf}\` does not exist on disk.`);
        continue;
      }
      // 🔴 STRIP IN THE LANGUAGE OF THE FILE. CORRECTED 2026-09-06, AND IT HAD
      // BEEN GREEN FOR THE WRONG REASON.
      //
      // `stripComments` above is a TS/Dart stripper: it blanks from `//` to the
      // end of the line. A client file may be a WORKFLOW, and a workflow's
      // comment marker is `#` — while `//` appears inside every `https://` URL
      // it names. The only thing that kept `https://api.nikatru.com/v1/health`
      // readable in `.github/workflows/deploy-workers.yml` was the file's QUOTE
      // PARITY: an odd number of `'` before that line made the stripper believe
      // it was inside a string literal and copy it through.
      //
      // MEASURED, not deduced. On 2026-09-06 this unit stripped that workflow's
      // prose into `docs/ci/deploy-workers.md`, which changed the quote parity
      // and nothing else that matters here. The same `--url` argument, on the
      // same step, in the same job:
      //     stripComments(origin/main copy)  → contains the URL: true
      //     stripComments(this branch)       → contains the URL: false
      // The guard reported "client expression … does not appear once comments
      // are stripped" on a workflow that plainly calls the route. The evidence
      // for "something calls this route" was resting on an accident.
      //
      // `stripSourceComments` from text-reductions.mjs is the ONE reduction that
      // knows extensions; it blanks `#` comments for `.yml`/`.yaml` and leaves
      // `//` alone there. Nothing is weakened: a `#` comment in a workflow is
      // still not evidence, which is the whole point of stripping at all.
      const clientText = readFileSync(join(ROOT, cf), 'utf8');
      const src = /\.ya?ml$/.test(cf) ? stripSourceComments(clientText, '.yml') : stripComments(clientText);
      if (!src.includes(c.expression)) {
        problems.push(
          `${k} — client expression \`${c.expression}\` does not appear in \`${cf}\` once comments are stripped. ` +
            'Either the call site moved or the only occurrence was a doc comment — this repo has shipped ' +
            'exactly that bug before (assert-capability-register.mjs, 2026-08-01).',
        );
        continue;
      }
      // …and the expression must be about THIS route. Without this, one correct
      // client expression would satisfy every entry that named the same file.
      const candidates = clientPathCandidates(entry.path, basePath);
      if (!candidates.some((p) => c.expression.includes(p))) {
        problems.push(
          `${k} — client expression \`${c.expression}\` does not contain the route's own path \`${candidates[0]}\`` +
            `${candidates[1] ? ` (nor \`${candidates[1]}\`, its path below \`${basePath}\`)` : ''}, ` +
            'so it would keep resolving after the route was renamed.',
        );
      }
    }

    // ── LIMB 4 · a public route is bounded, or SAYS why it is not ──────────────
    // (Numbered 4 in the register's _readme; run here because it needs limb 1's
    // parse and nothing from limb 3.)
    for (const entry of w.routes) {
      if (entry.auth !== 'public') continue;
      const k = key(String(entry.method).toUpperCase(), rel(String(entry.path)));
      const m = mountedByKey.get(k);
      if (!m) continue; // already reported by limb 1
      const handler = stripComments(m.handler, { alsoStrings: true });
      const bounded = LIMITER_CALLS.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(handler));
      if (bounded) continue;
      if (String(entry.noLimiterReason ?? '').trim()) {
        // ── 4b · A "NO I/O" JUSTIFICATION IS GRADED AGAINST THE HANDLER ────
        // CORRECTED 2026-09-10. Both Workers' /v1/health rows said "It does NO
        // I/O — no D1 query, no KV read, no subrequest" while their handlers
        // probed D1, KV and the Supabase JWKS (services/platform/src/index.ts
        // :115-144), and this limb printed them green every run because it only
        // checked that a reason was PRESENT. A reason is the licence for leaving
        // a public route unlimited; a licence describing code that no longer
        // exists is no licence. The one claim that was wrong is the one claim
        // grep can check: a reason that says "no I/O" over a handler that reaches
        // a binding or the network FAILS, naming what it found.
        const reason = String(entry.noLimiterReason);
        const claimsNoIo = /\bno\s+I\/O\b/i.test(reason);
        const io = handler.match(/\.prepare\s*\(|\bprobeBinding\s*\(|\bprobeJwks\s*\(|\bfetch\s*\(|c\.env\.\w+\.(?:get|put|list|delete)\s*\(/g);
        if (claimsNoIo && io !== null) {
          problems.push(
            `${k} — \`noLimiterReason\` claims NO I/O, but the handler in \`${m.owningFile}\` reaches ` +
              `${[...new Set(io.map((s) => s.trim()))].join(', ')}. [B-13] The reason a public route may stay ` +
              'unlimited must describe the code beside it; say what the I/O is and what bounds it (a ' +
              'per-isolate memo, a TTL), or bound the route.',
          );
          continue;
        }
        printed.push(`⚠  ${k} — PUBLIC AND UNLIMITED. · ${workerName} ${entry.noLimiterReason}`);
      } else {
        problems.push(
          `${k} — \`auth: public\` and its handler reaches neither ${LIMITER_CALLS.join(' nor ')}, and it ` +
            'declares no \`noLimiterReason\`. [B-13] An unauthenticated route that can be made expensive is a ' +
            'bill anyone can run up; one that genuinely cannot must say so in writing.',
        );
      }
    }
  }

  // ── LIMB 3 · bindings, in both directions, each with a REAL reader ───────────
  function wranglerConfigsOnDisk() {
    const found = [];
    if (existsSync(SERVICES_DIR)) {
      for (const e of listDir(SERVICES_DIR, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        for (const f of ['wrangler.jsonc', 'wrangler.json']) {
          const p = join(SERVICES_DIR, e.name, f);
          if (existsSync(p)) found.push(rel(`services/${e.name}/${f}`));
        }
      }
    }
    // The brick's service template — invisible to assert-clone-contract.mjs, which
    // only ever inspects the throwaway CI probe stamp.
    const walk = (dir, base) => {
      let entries;
      try { entries = listDir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(join(dir, e.name), `${base}/${e.name}`);
        else if (e.name === 'wrangler.jsonc' || e.name === 'wrangler.json') found.push(rel(`${base}/${e.name}`));
      }
    };
    walk(BRICK_SERVICES_GLOB, 'tooling/bricks/app/__brick__');
    return found.sort();
  }

  // The coverage assertion, in both directions: the declared list and the glob
  // must be the SAME SET. A config that appears on disk and not in the register's
  // list would otherwise be scanned silently — or, worse, a config removed from the
  // list would shrink the subject while every binding claim stayed green.
  for (const c of onDiskConfigs) {
    if (!declaredConfigs.includes(c)) {
      problems.push(
        `${c} — a wrangler config on disk that \`bindingSources.configs\` does not name. Every binding it ` +
          'declares is outside the subject of [B-1] limb 3 until it is listed.',
      );
    }
  }
  for (const c of declaredConfigs) {
    if (!onDiskConfigs.includes(c)) {
      problems.push(`${c} — named in \`bindingSources.configs\` but not found on disk. The scan and the tree disagree.`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // [pipeline B-15] EVERY DEPLOYABLE WORKER DECLARES THE HOST IT ANSWERS ON.
  //
  // 🔴 TWO OF THE THREE CONFIGS DECLARED NO `routes` AT ALL UNTIL 2026-08-03, AND
  // BOTH FAILURES WERE INVISIBLE FOR OPPOSITE REASONS:
  //   · the BRICK template had none, so a stamped backend deployed to a
  //     `*.workers.dev` name and `api-<app>.nikatru.com` bound to nothing — the
  //     "no manual step" half of B-15 was a manual dashboard step nobody wrote
  //     down, and it would have been repeated for every app that ever stamps one;
  //   · `services/subscriptiontracker-api` had none while `api.nikatru.com` SERVED LIVE TRAFFIC
  //     as a dashboard-created Custom Domain. The deployable config and the
  //     deployed reality disagreed, exactly like the `EXPORTS` bucket that was
  //     bound for two weeks with every guard green.
  //
  // ⚠️ ASSERTED ON PARSED STRUCTURE, and on `custom_domain` specifically. A
  // `routes` key that exists is not the property — an empty array satisfies "has
  // routes" while binding nothing, and this repo has already shipped one check
  // that a template COMMENT satisfied. `custom_domain: true` is what
  // auto-provisions the DNS record and the certificate; a pattern route without it
  // needs a DNS record somebody remembered to create.
  //
  // ⚠️ Scoped to configs that declare a `main` entrypoint. A wrangler config with
  // no `main` is not a Worker that answers requests, and requiring a host of it
  // would be noise — and noise is how a real signal gets muted.
  // ─────────────────────────────────────────────────────────────────────────────
  const hostless = [];
  let hostBearing = 0;
  for (const cfgRel of onDiskConfigs) {
    const cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel);
    // An EDGE Worker answers on zone routes by design and is held to that by limb 7 below.
    if (typeof cfg.main !== 'string' || cfg.main === '' || edgeConfigRels(register).has(cfgRel)) continue;
    hostBearing++;
    const routes = Array.isArray(cfg.routes) ? cfg.routes : [];
    const custom = routes.filter((r) => r?.custom_domain === true && typeof r?.pattern === 'string' && r.pattern);
    if (custom.length === 0) {
      hostless.push(
        `${cfgRel} — declares \`main\` (it is a Worker that answers requests) and NO \`routes\` entry with ` +
          '`custom_domain: true`. It will deploy to a *.workers.dev name, and whatever host it is supposed to ' +
          'answer on is bound in a dashboard where no diff can review it and no stamp can reproduce it.',
      );
    }
  }
  if (hostBearing === 0) {
    coverageLost([
      `✗ COVERAGE LOST — parsed ${onDiskConfigs.length} wrangler config(s) and NOT ONE declares \`main\`.`,
      '  The host limb ranges over zero Workers and cannot fail.',
    ]);
  }
  for (const h of hostless) problems.push(h);

  /** binding -> Set(config paths declaring it), derived from the parsed configs. */
  const declaredBindings = new Map();
  for (const cfgRel of onDiskConfigs) {
    const cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel);
    for (const [section, field] of BINDING_KEYS) {
      for (const item of cfg[section] ?? []) {
        const name = item?.[field];
        if (typeof name !== 'string' || !name) continue;
        if (!declaredBindings.has(name)) declaredBindings.set(name, { kind: section, configs: new Set() });
        declaredBindings.get(name).configs.add(cfgRel);
      }
    }
  }
  if (declaredBindings.size === 0) {
    coverageLost([
      `✗ COVERAGE LOST — parsed ${onDiskConfigs.length} wrangler config(s) and found ZERO bindings.`,
      `  Sections scanned: ${BINDING_KEYS.map(([s]) => s).join(', ')}.`,
    ]);
  }

  const registeredBindings = new Map(bindings.map((b) => [b.binding, b]));
  for (const [name, info] of declaredBindings) {
    if (!registeredBindings.has(name)) {
      problems.push(
        `${name} — declared as a \`${info.kind}\` binding in ${[...info.configs].join(', ')} and absent from the ` +
          'register. [B-1, B-18] An unregistered binding is a live resource nobody has to justify — which is ' +
          'how a per-app R2 bucket stayed bound with no reader from 2026-07-17 with every guard green.',
      );
    }
  }
  for (const [name, entry] of registeredBindings) {
    const info = declaredBindings.get(name);
    if (!info) {
      problems.push(
        `${name} — in the register but no wrangler config declares it. Remove it: a stale entry inflates ` +
          'apparent coverage and its "reader" claim can never fail.',
      );
      continue;
    }
    if (entry.kind !== info.kind) {
      problems.push(`${name} — register says \`${entry.kind}\`, the config declares it under \`${info.kind}\`.`);
    }
    if (!String(entry.purpose ?? '').trim()) {
      problems.push(`${name} — no \`purpose\`. Say what the binding is FOR; a name is not a justification.`);
    }

    // THE READER LIMB. `env.<BINDING>` in comment- AND string-stripped code, in a
    // file that is NOT an Env type declaration.
    //
    // ⚠️ WHY types.ts CANNOT COUNT, stated where it is enforced:
    // assert-vendor-portability.mjs derives its surface set from the UNION of
    // `interface Env` and the wrangler configs, so an optional field in types.ts
    // keeps a surface "alive" after its binding is gone — mutation-proven
    // 2026-07-29 and still true. A type declaration is a promise about a binding,
    // never a use of one.
    const readers = (entry.readers ?? []).map(rel);
    const resolved = [];
    for (const r of readers) {
      if (/(^|\/)types\.ts$/.test(r)) {
        problems.push(
          `${name} — claims \`${r}\` as a reader. A types.ts declares the binding's TYPE; it never reads it. ` +
            'That is the exact shape that kept EXPORTS looking alive.',
        );
        continue;
      }
      if (!existsSync(join(ROOT, r))) {
        problems.push(`${name} — claimed reader \`${r}\` does not exist on disk.`);
        continue;
      }
      const code = stripComments(readFileSync(join(ROOT, r), 'utf8'), { alsoStrings: true });
      if (!new RegExp(`\\benv\\s*\\.\\s*${name}\\b`).test(code) && !readsGeneratedBinding(code, name)) {
        problems.push(
          `${name} — claimed reader \`${r}\` contains no \`env.${name}\` once comments and string literals ` +
            'are stripped. The register is describing a use that no longer exists.',
        );
        continue;
      }
      resolved.push(r);
    }
    if (resolved.length === 0) {
      if (String(entry.unreadReason ?? '').trim()) {
        printed.push(`⚠  ${name} — BOUND WITH NO READER. ${entry.unreadReason}`);
      } else {
        problems.push(
          `${name} — bound by ${[...info.configs].join(', ')} and read by NOTHING. [B-18] A binding with no ` +
            'reader is a live resource with a lifecycle, a quota and an attack surface, bought for nothing. ' +
            'Give it a reader, delete the binding, or record an `unreadReason` that will be printed every run.',
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── LIMB 5 · the values COPIED INTO EVERY CONFIG HAVE ONE SOURCE ─────────────
  //
  // 🔴 FOUR VALUES WERE TYPED INTO ALL THREE WRANGLER CONFIGS AND COMPARED BY
  // NOTHING. `vars.SUPABASE_URL`, `vars.API_VERSION`,
  // `d1_databases[PLATFORM_DB].database_id` and `kv_namespaces[JWKS_CACHE].id`
  // are portfolio-wide agreements — one identity project, one API-contract
  // version, one entitlements database, one JWKS cache — held in three files by
  // hand. MEASURED 2026-09-08 by mutating each one on its own in the brick
  // template and running the FULL sweep (tooling/scripts/guard-sweep.mjs, 134
  // guards executed) against clean and against mutated: three of the four moved
  // NOTHING, and the fourth was caught only by assert-data-inventory.mjs, which
  // pins the KV namespace id for a legal reason and not for this one. The same
  // two var mutations in the LIVE services/subscriptiontracker-api config also passed.
  //
  // ⚠️ WHY HERE AND NOT IN A NEW GUARD. This file already owns exactly the right
  // subject: `bindingSources.configs` IS the three-config set, and limb 3 above
  // has already asserted — in both directions — that the declared set equals the
  // globbed one. A new guard would need that same coverage assertion a second
  // time, and two copies of a coverage assertion drift in the one way that
  // reports clean. `grep-for-the-existing-helper` applies to subjects too.
  //
  // ⚠️ WHY THE REGISTER DECLARES THE VALUE RATHER THAN THIS FILE. A literal here
  // is the same hand-copy one directory further from the config, which is the
  // mistake assert-cors-allowlist.mjs made and had mutation-proven against it on
  // 2026-08-07 ("it hardcoded the origins"). The register is data with a written
  // reason per value; this file only compares.
  //
  // ABSENCE IS A FAILURE, and an exemption has to stay TRUE: a config that does
  // not carry an entry fails unless the entry's `absentFrom` names it with a
  // reason, and an `absentFrom` row naming a config that DOES carry the value is
  // itself a failure — so an exemption cannot outlive the state it describes.
  // ─────────────────────────────────────────────────────────────────────────────
  const sharedBlock = register.sharedValues ?? null;
  const sharedValues = Array.isArray(sharedBlock?.values) ? sharedBlock.values : null;
  if (!sharedValues || sharedValues.length === 0) {
    coverageLost([
      '✗ COVERAGE LOST — the register declares no `sharedValues.values`.',
      '  Limb 5 is the only thing comparing the values hand-copied into every wrangler config;',
      '  with an empty list it ranges over nothing and reports agreement it never checked.',
    ]);
  }

  /** `vars.<NAME>` or `<section>[<BINDING>].<field>`. Returns `null` for an `at`
   *  this grammar cannot read — which the caller treats as COVERAGE LOST rather
   *  than as an absent value, because "I could not tell" must never read as
   *  "it is fine". */
  const AT_VAR = /^vars\.([A-Za-z_][A-Za-z0-9_]*)$/;
  const AT_BINDING = /^([a-z0-9_]+)\[([A-Za-z_][A-Za-z0-9_]*)\]\.([a-z0-9_]+)$/;
  function resolveAt(cfg, at) {
    let m = AT_VAR.exec(at);
    if (m) {
      const vars = cfg?.vars;
      const has = !!vars && Object.prototype.hasOwnProperty.call(vars, m[1]);
      return { has, value: has ? vars[m[1]] : undefined };
    }
    m = AT_BINDING.exec(at);
    if (m) {
      const [, section, binding, field] = m;
      const items = Array.isArray(cfg?.[section]) ? cfg[section] : [];
      const hit = items.find((i) => i?.binding === binding);
      if (!hit) return { has: false, value: undefined };
      const has = Object.prototype.hasOwnProperty.call(hit, field);
      return { has, value: has ? hit[field] : undefined };
    }
    return null;
  }

  /** The configs are parsed once more here rather than threaded down from limb 3
   *  because limb 3 parses inside its own loops; re-reading the same paths costs
   *  three file reads and keeps this limb readable on its own.
   *
   *  ⚠️ SCOPED TO CONFIGS THAT DECLARE `main`, the SAME predicate the [B-15] host
   *  limb above uses and for the same stated reason: a wrangler config with no
   *  `main` is not a Worker that answers requests, so asking it for the identity
   *  project or the API-contract version would be noise — and noise is how a real
   *  signal gets muted. All three configs in this repository declare `main`
   *  today, and `hostBearing` above already fails if none does. */
  const parsedConfigs = onDiskConfigs
    .map((cfgRel) => ({ cfgRel, cfg: parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel) }))
    .filter(({ cfg }) => typeof cfg?.main === 'string' && cfg.main !== '');

  let sharedComparisons = 0;
  for (const entry of sharedValues) {
    const at = entry?.at;
    const want = entry?.value;
    if (typeof at !== 'string' || at === '') {
      problems.push('a `sharedValues.values` entry has no `at`, so it addresses nothing and can never fail.');
      continue;
    }
    if (typeof want !== 'string' || want === '') {
      problems.push(`\`${at}\` declares no non-empty \`value\`. An entry with nothing to compare against is dead policy.`);
      continue;
    }
    if (typeof entry?.why !== 'string' || entry.why.trim() === '') {
      problems.push(
        `\`${at}\` carries no \`why\`. Every entry here is a portfolio-wide agreement, and an agreement ` +
          'nobody wrote a reason for is one the next reader will "tidy up".',
      );
    }
    const absentFrom = Array.isArray(entry?.absentFrom) ? entry.absentFrom : [];
    const exempt = new Map();
    for (const row of absentFrom) {
      if (typeof row?.config !== 'string' || typeof row?.why !== 'string' || row.why.trim() === '') {
        problems.push(
          `\`${at}\` has an \`absentFrom\` row with no \`config\` or no \`why\`. An exemption without a reason ` +
            'is a waiver, and this register does not take waivers.',
        );
        continue;
      }
      exempt.set(rel(row.config), row.why);
    }

    let resolvedIn = 0;
    for (const { cfgRel, cfg } of parsedConfigs) {
      const got = resolveAt(cfg, at);
      if (got === null) {
        coverageLost([
          `✗ COVERAGE LOST — \`sharedValues\` entry \`${at}\` is not addressable by this limb's grammar.`,
          '  Expected `vars.<NAME>` or `<section>[<BINDING>].<field>`.',
          '  An address the guard cannot read is a value the guard is not checking, and it would otherwise',
          '  have been counted as agreement.',
        ]);
      }
      if (!got.has) {
        if (exempt.has(cfgRel)) {
          printed.push(`⚠  ${at} — ABSENT FROM ${cfgRel}. ${exempt.get(cfgRel)}`);
        } else {
          problems.push(
            `${cfgRel} — declares no \`${at}\`, which tooling/platform-register.json holds as a value every ` +
              'Worker config carries. Either restore it, or add an `absentFrom` row for this config with the ' +
              'reason it does not apply here — which will then be printed on every run.',
          );
        }
        continue;
      }
      if (exempt.has(cfgRel)) {
        problems.push(
          `${cfgRel} — \`${at}\` is declared here, but the register's \`absentFrom\` says it is not. An ` +
            'exemption that outlived the state it described is a written excuse standing in front of a real ' +
            'value, and it silently removes this config from the comparison below.',
        );
        continue;
      }
      resolvedIn++;
      sharedComparisons++;
      if (got.value !== want) {
        problems.push(
          `${cfgRel} — \`${at}\` is ${JSON.stringify(got.value)}; tooling/platform-register.json declares ` +
            `${JSON.stringify(want)}. ${entry.why ?? ''}`.trim() +
            '\n      This is a portfolio-wide agreement held in three files by hand. A config that disagrees ' +
            'deploys, runs, and is wrong SILENTLY — no error, no failing request log, nothing.',
        );
      }
    }
    if (resolvedIn === 0) {
      coverageLost([
        `✗ COVERAGE LOST — \`${at}\` resolved in ZERO of the ${parsedConfigs.length} wrangler config(s).`,
        '  Either the key was renamed everywhere or the address is stale. Both leave this entry comparing',
        '  nothing while the run still prints ok.',
      ]);
    }
  }
  if (sharedComparisons === 0) {
    coverageLost([
      '✗ COVERAGE LOST — limb 5 made ZERO comparisons.',
      '  Every shared value is exempt, unaddressable or absent, so the limb cannot fail.',
    ]);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── LIMB 7 · an EDGE Worker is a PASS-THROUGH, bound by ZONE ROUTES ─────────
  //
  // ⏱ 2026-09-26 · LEAD RULING SHIELD-R1, row O-BOXES-UNSHIELDED-FROM-SPIKES.
  // services/edge-shield mounts no route of its own: it sits on two ZONE routes in
  // front of Box C's auth and Box B's crash intake and passes every request to the
  // origin. Limbs 1, 2 and 4 are about routes a Worker MOUNTS, and would read it
  // as a parser that found nothing (COVERAGE LOST); the [B-15] host limb requires
  // a custom domain, which on a Cloudflare Tunnel host would take over the
  // hostname's DNS record and pull the box off its tunnel. So the register names
  // such a Worker in `edgeWorkers`, the two limbs skip it (the filter on
  // `derivedWorkers` and the `continue` in the host limb), and THIS limb holds
  // the exemption TRUE rather than trusting it:
  //   a · the config is a `services/*` wrangler config declaring `main`, whose
  //       `name` and `main` match the entry — a stale entry is a Worker the tree
  //       does not deploy;
  //   b · it is not ALSO a route-mounting Worker (servingWorker / appWorkers);
  //   c · its `routes` are ZONE routes (`pattern` + `zone_name`), none a
  //       `custom_domain`, and they EQUAL the entry's `zoneRoutes` in both
  //       directions — never empty;
  //   d · its entrypoint, comment-stripped, is a pass-through: it creates no Hono
  //       app (a Worker that mounts routes cannot hide here from limbs 1, 2 and
  //       4), it forwards with `fetch(request)`, and it calls
  //       `passThroughOnException(` so an exception hands the request to the
  //       origin instead of failing it.
  // Its bindings stay fully in limb 3's subject: every limiter it declares needs a
  // register row and a real reader like any other.
  // ─────────────────────────────────────────────────────────────────────────────
  const edgeList = register.edgeWorkers;
  if (edgeList !== undefined && !Array.isArray(edgeList)) {
    problems.push('`edgeWorkers` is not an array, so no edge Worker can be held to limb 7.');
  }
  const allDeployable = deployableWorkers();
  let edgeChecked = 0;
  for (const [i, e] of (Array.isArray(edgeList) ? edgeList : []).entries()) {
    const field = `edgeWorkers[${i}]`;
    const cfgRel = rel(String(e?.config ?? ''));
    if (!String((Array.isArray(e?._why) ? e._why.join(' ') : e?._why) ?? '').trim()) {
      problems.push(`${field} — no \`_why\`. An exemption from limbs 1, 2 and 4 must say why the Worker mounts nothing.`);
    }
    const onDisk = allDeployable.find((d) => d.config === cfgRel);
    if (!onDisk) {
      problems.push(
        `${field} names \`${cfgRel}\`, which is not a \`services/*\` wrangler config declaring \`main\`. ([7a]) ` +
          'The register would exempt a Worker the tree does not deploy.',
      );
      continue;
    }
    if (onDisk.name !== String(e?.name ?? '')) {
      problems.push(`${field} — calls this Worker \`${e?.name}\`; \`${cfgRel}\` deploys it as \`${onDisk.name}\`. ([7a])`);
    }
    if (onDisk.entrypoint !== rel(String(e?.entrypoint ?? ''))) {
      problems.push(
        `${field} — declares entrypoint \`${e?.entrypoint}\`, but \`${cfgRel}\`'s \`main\` resolves to \`${onDisk.entrypoint}\`. ([7a])`,
      );
    }
    if (declaredConfigSet.has(cfgRel)) {
      problems.push(
        `${field} — \`${cfgRel}\` is ALSO a servingWorker/appWorkers entry. ([7b]) A Worker is either a route-mounting ` +
          'backend held to limbs 1, 2 and 4, or an edge pass-through held to this limb; never both.',
      );
    }
    const cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel);
    const onRoutes = Array.isArray(cfg.routes) ? cfg.routes : [];
    const declared = Array.isArray(e?.zoneRoutes) ? e.zoneRoutes : [];
    const rk = (r) => `${r?.pattern ?? ''} @ ${r?.zone_name ?? ''}`;
    if (onRoutes.length === 0 || declared.length === 0) {
      problems.push(
        `${field} — \`${cfgRel}\` declares ${onRoutes.length} route(s) and the entry ${declared.length} \`zoneRoutes\`. ([7c]) ` +
          'An edge Worker with no route is in front of nothing, and every request it exists to shield reaches the box.',
      );
    }
    for (const r of onRoutes) {
      if (r?.custom_domain === true) {
        problems.push(
          `${field} — \`${cfgRel}\` binds \`${r?.pattern}\` as a custom_domain. ([7c]) A Custom Domain takes the ` +
            "hostname's DNS record; on a Cloudflare Tunnel host that pulls the box off its tunnel. Use a zone route.",
        );
      } else if (typeof r?.pattern !== 'string' || !r.pattern || typeof r?.zone_name !== 'string' || !r.zone_name) {
        problems.push(`${field} — \`${cfgRel}\` has a route that is not \`{ pattern, zone_name }\`: ${JSON.stringify(r)}. ([7c])`);
      }
    }
    const onSet = new Set(onRoutes.map(rk));
    const declaredSet = new Set(declared.map(rk));
    for (const k of onSet) if (!declaredSet.has(k)) problems.push(`${field} — \`${cfgRel}\` routes \`${k}\`, which \`zoneRoutes\` does not name. ([7c])`);
    for (const k of declaredSet) if (!onSet.has(k)) problems.push(`${field} — \`zoneRoutes\` names \`${k}\`, which \`${cfgRel}\` does not route. ([7c])`);
    const entry = stripComments(readFileSync(join(ROOT, onDisk.entrypoint), 'utf8'));
    if (/\bnew\s+Hono\s*[(<]/.test(entry)) {
      problems.push(
        `${field} — \`${onDisk.entrypoint}\` creates a Hono app. ([7d]) A Worker that mounts routes is held to limbs 1, 2 ` +
          'and 4 as an appWorkers entry; declaring it an edge Worker would hide every route it mounts.',
      );
    }
    if (!/\bfetch\s*\(\s*request\s*\)/.test(entry)) {
      problems.push(`${field} — \`${onDisk.entrypoint}\` never forwards with \`fetch(request)\`, so it is not a pass-through. ([7d])`);
    }
    if (!/\.passThroughOnException\s*\(/.test(entry)) {
      problems.push(
        `${field} — \`${onDisk.entrypoint}\` does not call \`passThroughOnException(\`. ([7d]) Without it an exception in the ` +
          'shield fails the request instead of handing it to the origin, and the shield becomes the reason the box is down.',
      );
    }
    edgeChecked++;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ── LIMB 8 · every ENVIRONMENT twins every top-level binding, or says why not ──
  //
  // ⏱ 2026-10-01 · rv2-services-022, row O-SANDBOX-ENV-DROPS-PRODUCTION-BINDINGS.
  // Wrangler does NOT inherit a binding into an environment: `vars`, `d1_databases`,
  // `kv_namespaces`, `r2_buckets`, `services` and `ratelimits` each start empty in an
  // `env.<name>` block. So a binding the top level declares and an environment omits
  // is simply ABSENT in that deploy, and every binding here is optional in code, so
  // the absence fails open with no error. That is how the platform's sandbox ran with
  // no SESSION_REVOKED, no SIGNUPS, no BACKUPS_R2, no app database, no erasure binding
  // and no APP_ERASURE_ENDPOINTS — a sandbox in which an E2E could catch neither a
  // revocation defect nor an erasure defect — and subscriptiontracker-api's sandbox
  // with no SESSION_REVOKED, every guard green.
  //
  // THE RULE: for every config in `bindingSources.configs` and every block under its
  // `env`, every top-level binding NAME (the BINDING_KEYS sections, `services` and
  // each `vars` key) appears in that block's same section, or the register's
  // `envBindingParity.exempt` names it with a reason. An exemption must stay TRUE:
  // one naming a binding the block DOES declare, or one the top level does not, is
  // itself a finding. And in a DEPLOYABLE config (under services/) an environment's
  // D1 or KV id may not be the all-zeros placeholder: a twin in name only binds
  // nothing, and `wrangler deploy --dry-run` passes on it. The brick template's
  // placeholders are correct (tooling/scripts/provision-backend.mjs step [5s] writes
  // them), so it is held to the names and not the ids.
  // ─────────────────────────────────────────────────────────────────────────────
  const parity = register.envBindingParity ?? null;
  const parityExempt = new Map();
  for (const row of Array.isArray(parity?.exempt) ? parity.exempt : []) {
    if (typeof row?.config !== 'string' || typeof row?.env !== 'string' || typeof row?.section !== 'string' ||
        typeof row?.name !== 'string' || typeof row?.why !== 'string' || row.why.trim().length < 20) {
      problems.push(
        `envBindingParity.exempt row ${JSON.stringify(row)} needs \`config\`, \`env\`, \`section\`, \`name\` and a \`why\` of a sentence. ` +
          '[limb 8] An exemption without a reason is a waiver, and this register does not take waivers.',
      );
      continue;
    }
    parityExempt.set(`${rel(row.config)}\u0000${row.env}\u0000${row.section}\u0000${row.name}`, { row, used: false });
  }
  const PARITY_SECTIONS = [...BINDING_KEYS, ['services', 'binding']];
  const bindingNamesOf = (block) => {
    const out = [];
    for (const [section, field] of PARITY_SECTIONS) {
      for (const item of Array.isArray(block?.[section]) ? block[section] : []) {
        if (typeof item?.[field] === 'string' && item[field]) out.push({ section, name: item[field] });
      }
    }
    const vars = block?.vars;
    if (vars && typeof vars === 'object' && !Array.isArray(vars)) for (const name of Object.keys(vars)) out.push({ section: 'vars', name });
    return out;
  };
  const isZeroId = (id) => typeof id === 'string' && id !== '' && /^0+$/.test(id.replace(/-/g, ''));
  // ⏱ 2026-10-02 · A PLACEHOLDER THAT WAITS ON A VAULT STEP IS DECLARED, NOT HIDDEN. Creating a
  // sandbox twin needs the Cloudflare token, which no CI job and no cloud lane holds, so the twins
  // tooling/scripts/provision-sandbox-twins.mjs owns land in the configs with the all-zeros id and
  // one `envBindingParity.pendingTwins` row each ({config, env, section, binding, why}). Such a
  // placeholder is PRINTED on every run instead of refused. The row must stay TRUE: one naming a
  // binding that no longer carries the placeholder (the script wrote its id) is itself a finding,
  // so the row is deleted in the same change that records the id. A placeholder no row names is
  // still refused below, and the brick template is never named here (its placeholders are correct).
  const pendingTwins = new Map();
  for (const row of Array.isArray(parity?.pendingTwins) ? parity.pendingTwins : []) {
    if (typeof row?.config !== 'string' || !row.config.startsWith('services/') || typeof row?.env !== 'string' ||
        (row?.section !== 'kv_namespaces' && row?.section !== 'd1_databases') || typeof row?.binding !== 'string' ||
        typeof row?.why !== 'string' || row.why.trim().length < 20) {
      problems.push(
        `envBindingParity.pendingTwins row ${JSON.stringify(row)} needs a \`config\` under services/, \`env\`, a \`section\` of ` +
          'kv_namespaces or d1_databases, \`binding\` and a \`why\` of a sentence. [limb 8]',
      );
      continue;
    }
    pendingTwins.set(`${rel(row.config)}\u0000${row.env}\u0000${row.section}\u0000${row.binding}`, { row, used: false });
  }
  /** A placeholder a pendingTwins row names: printed, and the row marked as still true. */
  const pendingPlaceholder = (cfgRel, envName, section, binding) => {
    const hit = pendingTwins.get(`${cfgRel}\u0000${envName}\u0000${section}\u0000${binding}`);
    if (!hit) return false;
    hit.used = true;
    printed.push(`⚠  ${cfgRel} env.${envName} — \`${section}\` ${binding} is a PLACEHOLDER, PENDING. ${hit.row.why}`);
    return true;
  };
  let envBlocks = 0;
  let twinsChecked = 0;
  for (const cfgRel of onDiskConfigs) {
    const cfg = parseJsonc(readFileSync(join(ROOT, cfgRel), 'utf8'), cfgRel);
    const envs = cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env) ? Object.entries(cfg.env) : [];
    const top = bindingNamesOf(cfg);
    for (const [envName, block] of envs) {
      envBlocks++;
      const have = new Set(bindingNamesOf(block).map((b) => `${b.section}\u0000${b.name}`));
      for (const b of top) {
        const key = `${cfgRel}\u0000${envName}\u0000${b.section}\u0000${b.name}`;
        const ex = parityExempt.get(key);
        if (have.has(`${b.section}\u0000${b.name}`)) {
          twinsChecked++;
          if (ex) {
            ex.used = true;
            problems.push(
              `${cfgRel} env.${envName} — \`${b.section}\` ${b.name} is declared there, and envBindingParity.exempt says it is not. ` +
                '[limb 8] An exemption that outlived the state it described hides the next omission behind its name.',
            );
          }
          continue;
        }
        if (ex) {
          ex.used = true;
          printed.push(`⚠  ${cfgRel} env.${envName} — \`${b.section}\` ${b.name} NOT TWINNED. ${ex.row.why}`);
          continue;
        }
        problems.push(
          `${cfgRel} env.${envName} — declares no \`${b.section}\` ${b.name}, which the top level binds. Wrangler does not inherit ` +
            'a binding into an environment, and every binding fails open when absent, so this deploy runs without it and nothing ' +
            'says so. [limb 8] Twin it on a resource of that environment, or add an envBindingParity.exempt row with the reason.',
        );
      }
      if (cfgRel.startsWith('services/')) {
        for (const d of Array.isArray(block?.d1_databases) ? block.d1_databases : []) {
          if (isZeroId(d?.database_id) && !pendingPlaceholder(cfgRel, envName, 'd1_databases', d.binding)) {
            problems.push(
              `${cfgRel} env.${envName} — D1 ${d.binding} still carries the all-zeros placeholder. [limb 8] A twin in name only binds ` +
                'nothing, and a dry run passes on it. tooling/scripts/provision-backend.mjs writes a stamped Worker\'s sandbox database id.',
            );
          }
        }
        for (const k of Array.isArray(block?.kv_namespaces) ? block.kv_namespaces : []) {
          if (isZeroId(k?.id) && !pendingPlaceholder(cfgRel, envName, 'kv_namespaces', k.binding)) {
            problems.push(
              `${cfgRel} env.${envName} — KV ${k.binding} still carries the all-zeros placeholder. [limb 8] A twin in name only binds ` +
                'nothing. Run `node tooling/scripts/provision-sandbox-twins.mjs --apply` (create only, idempotent): it creates the ' +
                'sandbox namespace and writes its id here.',
            );
          }
        }
      }
    }
  }
  for (const { row, used } of pendingTwins.values()) {
    if (!used) {
      problems.push(
        `envBindingParity.pendingTwins names ${row.config} env.${row.env} \`${row.section}\` ${row.binding}, and that entry carries no ` +
          'all-zeros placeholder (its id was recorded, or the binding is gone). [limb 8] Delete the row in the change that recorded the id: ' +
          'a pending row that outlived its placeholder would excuse the next one.',
      );
    }
  }
  for (const { row, used } of parityExempt.values()) {
    if (!used) {
      problems.push(
        `envBindingParity.exempt names ${row.config} env.${row.env} \`${row.section}\` ${row.name}, and that config's top level does not ` +
          'bind it (or the environment does not exist). [limb 8] Delete the row: it exempts nothing.',
      );
    }
  }
  if (parity !== null && envBlocks === 0) {
    coverageLost([
      `✗ COVERAGE LOST — the register declares envBindingParity, and none of the ${onDiskConfigs.length} wrangler config(s) declares an \`env\` block.`,
      '  Limb 8 ranges over zero environments and cannot fail.',
    ]);
  }

  if (problems.length) {
    console.error(`✗ platform register — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error('');
    console.error('  [B-1] one declared home per shared capability · [B-18] every binding has a reader ·');
    console.error('  [B-13] a public route is bounded, or says why not.');
    console.error('  Register: tooling/platform-register.json');
    process.exit(1);
  }

  // ── the gaps print whether or not the build passes ───────────────────────────
  for (const line of printed) console.log(line);

  const appMountCount = allMounted.length - mountedInServing;
  const appEntryCount = declaredWorkers.slice(1).reduce((n, w) => n + w.routes.length, 0);
  console.log(
    `ok  platform register — ${mountedInServing} mounted route(s) reconciled with ${routes.length} register ` +
      `entry(ies)` +
      (declaredWorkers.length > 1
        ? `, plus ${appMountCount} across ${declaredWorkers.length - 1} app Worker(s) reconciled with ${appEntryCount}`
        : '') +
      `; ${declaredBindings.size} binding(s) across ${onDiskConfigs.length} wrangler config(s), ` +
      `each with a resolved reader; ${sharedValues.length} shared value(s) compared ${sharedComparisons} ` +
      `time(s) across those configs, all agreeing; ${edgeChecked} edge Worker(s) held to limb 7; ` +
      `${envBlocks} environment block(s) twinning ${twinsChecked} top-level binding(s) (limb 8); ` +
      `${printed.length} declared gap(s) printed above`,
  );
  if (brickRow) {
    console.log(
      `ok  brick route clients — ${ROUTE_CLIENTS} names a resolving client for each of the ${brickRow.routes.length} ` +
        `route(s) ${brickRow.spec.entrypoint} mounts, and for no other`,
    );
  }
}

/** The scan could not look, so this run is not evidence either way — exit 2,
 *  never 1, which would read as a finding (AGENTS.md exit-code convention,
 *  O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-platform-register.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
}

/** ⏱ 2026-09-26 (O-BACKUP-AND-FANOUT-SETS-HAND-LISTED, service kit E-c) — THE READER LIMB, THROUGH THE
 *  GENERATED PER-APP BLOCK. The platform Worker reads each app database by the binding name
 *  services/platform/src/generated/app-targets.ts carries (`dbBinding`), rendered from the register by
 *  tooling/scripts/render-platform-app-block.mjs: `bound[t.dbBinding]` over `APP_TARGETS`, never
 *  `env.<APP>_DB`. So a claimed reader that reads `APP_TARGETS` (in code, comments and strings stripped)
 *  reads every binding that module names. The module is read raw: the names ARE its string literals. A
 *  missing module answers no. Declared here, after every limb, so no citation above moved. */
function readsGeneratedBinding(code, name) {
  if (!/\bAPP_TARGETS\b/.test(code)) return false;
  const moduleAbs = join(ROOT, 'services', 'platform', 'src', 'generated', 'app-targets.ts');
  if (!existsSync(moduleAbs)) return false;
  return new RegExp(`dbBinding:\\s*'${name}'`).test(readFileSync(moduleAbs, 'utf8'));
}

/** The configs the register declares as EDGE Workers (limb 7), which limbs 1, 2
 *  and 4 and the [B-15] host limb do not apply to. Declared LAST (hoisted), like
 *  coverageLost above, so no citation into this file moves. */
function edgeConfigRels(register) {
  const list = Array.isArray(register?.edgeWorkers) ? register.edgeWorkers : [];
  return new Set(list.map((e) => rel(String(e?.config ?? ''))).filter((c) => c !== '.' && c !== ''));
}
