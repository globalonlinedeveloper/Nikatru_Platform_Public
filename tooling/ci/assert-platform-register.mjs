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
//      (`EXPORTS` → `subscriptiontracker-exports`, created 2026-07-17) whose only occurrence
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
 *  sense that both are exported by services/platform/src/lib/edge-ceiling.ts;
 *  named here because a guard cannot guess which function means "bounded". */
const LIMITER_CALLS = ['withinRateLimit', 'withinEdgeCeiling'];

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

/**
 * Blank comments in TS/Dart source, preserving offsets. Strings are KEPT because
 * every route path and every client URL IS a string literal — the thing being
 * matched. That is why the client rule additionally requires the expression to
 * live outside the serving Worker: keeping strings means a doc comment is the
 * only false positive available, and comments are what this strips.
 */
export function stripComments(src, { alsoStrings = false } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  const blank = (ch) => (ch === '\n' ? '\n' : ' ');
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2; out += '  ';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += blank(src[i]); i++; }
      i += 2; out += '  ';
      continue;
    }
    // ── 🔴 STRINGS ARE ALWAYS *TRACKED*; `alsoStrings` ONLY DECIDES WHETHER THEY
    // ARE BLANKED. CORRECTED 2026-08-05, AND IT HAD SILENTLY BLINDED THE GUARD.
    //
    // This branch used to be gated entirely on `alsoStrings`, so with it false
    // the scanner walked straight THROUGH string literals — and
    // `services/platform/src/index.ts:114` is:
    //
    //     app.use('/v1/plan/*', platformAuth);
    //
    // The `/*` inside that path opened a block comment that never closed, so
    // EVERY LINE AFTER IT WAS BLANKED — including `:115 app.route('/v1',
    // cancellation);`. The guard then reported "7 mounted route(s) reconciled
    // with 7 register entry(ies)" and exited 0, while `POST /v1/plan/cancel`
    // was mounted, deployed and answering 401 in production, and appeared in
    // `tooling/platform-register.json` exactly ZERO times. Real mount count: 12.
    //
    // The parser-liveness self-check could not catch it: it fires on
    // `mounted.length === 0`, and this was a PARTIAL loss — 7 of 12 — which
    // looks exactly like a healthy read.
    //
    // 📌 This is the same family as the 2026-08-04 finding that
    // `stripSourceComments` returned its input unchanged for unknown
    // extensions, and it arrived the same way: the docstring above already
    // said strings are kept because a route path IS a string literal. The
    // INTENT was right and the implementation only honoured it in one of two
    // modes.
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        if (q !== '`' && src[j] === '\n') break;
        j++;
      }
      // Blank the literal when asked, otherwise copy it through verbatim — but
      // either way, SKIP PAST IT so its contents can never be read as syntax.
      if (alsoStrings) for (const ch of src.slice(i, j)) out += blank(ch);
      else out += src.slice(i, j);
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The balanced `(...)` starting at `open`, or '' — used to scope a check to ONE
 *  route handler instead of to the whole file. Without it, a new unlimited route
 *  added beside a limited one in the same file passes on its sibling's limiter. */
function balanced(src, open) {
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')') { depth--; if (depth === 0) return src.slice(open, k + 1); }
  }
  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MOUNT PARSER — structural, following app.route() into each sub-router.
// Grepping for a path string would match the header comment at the top of
// index.ts, which lists three of these routes in prose.
// ─────────────────────────────────────────────────────────────────────────────
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];

/** EVERY `new Hono` instance a file declares, in source order. The first is the
 *  file's own router; the rest are IN-FILE GROUPS, and missing them is not a
 *  cosmetic gap — see the block above `mountedRoutes`. */
function honoIdents(code) {
  return [...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+Hono\b/g)].map((m) => m[1]);
}

/** Mount prefix + leaf path, joined the way Hono's own `mergePath` joins them.
 *
 *  🔴 THE TRAILING SLASH IS NOT COSMETIC AND IT IS NOT GUESSED. `posix.join`
 *  turns ('/v1/subscriptions', '/') into '/v1/subscriptions/', and a register
 *  entry written against that string would describe a path the Worker does not
 *  serve. Measured against hono 4.12.34 before this line was written: mounting a
 *  sub-router whose leaf is '/' answers 200 on '/v1/subscriptions' and 404 on
 *  '/v1/subscriptions/'. Five of subscriptiontracker-api's twelve routes declare their leaf as
 *  '/', so without this the register and the Worker would disagree on five paths
 *  while limb 1 reported perfect agreement with the register it was handed. */
function joinPath(prefix, p) {
  const j = rel(posix.join(prefix || '/', p));
  return j.length > 1 ? j.replace(/\/+$/, '') : j;
}

/** `import <ident> from '<spec>'` → repo-relative .ts path, resolved from `from`. */
function resolveDefaultImport(code, ident, fromFileRel) {
  const re = new RegExp(`import\\s+${ident}\\s+from\\s+['"]([^'"]+)['"]`);
  const m = re.exec(code);
  if (!m) return null;
  const spec = m[1];
  if (!spec.startsWith('.')) return null;
  return rel(posix.join(posix.dirname(fromFileRel), `${spec}.ts`));
}

const parseNotes = [];

/** Walk ONE Hono identifier inside an already-stripped file, at `prefix`.
 *
 *  🔴 THE SUB-ROUTER A FILE DECLARES ITSELF IS STILL A SUB-ROUTER. The walk used
 *  to follow `app.route(prefix, ident)` ONLY when `ident` resolved to a default
 *  import, and pushed a parse note otherwise. services/platform/src/index.ts
 *  happens to mount every group from an import, so nothing was lost there — but
 *  services/subscriptiontracker-api/src/index.ts builds its authenticated group in the file:
 *
 *      const api = new Hono<AppEnv>();
 *      api.use('*', supabaseAuth);
 *      api.route('/subscriptions', subscriptions);
 *      …
 *      app.route('/v1', api);
 *
 *  `api` is not imported, so the old walk stopped at that line and reported
 *  THREE mounted routes for a Worker that mounts TWELVE. That is the same
 *  PARTIAL loss as the 2026-08-05 `/*`-in-a-string defect recorded below — 7 of
 *  12 then, 3 of 12 here — and the liveness self-check cannot see either,
 *  because it fires on zero. */
function walkHono(code, fileRel, id, prefix, localIdents, seenFiles, out, seenLocal) {
  const localKey = `${id}@${prefix}`;
  if (seenLocal.has(localKey)) return;
  seenLocal.add(localKey);

  const methodRe = new RegExp(`\\b${id}\\s*\\.\\s*(${METHODS.join('|')})\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`, 'g');
  for (const m of code.matchAll(methodRe)) {
    const openParen = code.indexOf('(', m.index + id.length);
    out.push({
      method: m[1].toUpperCase(),
      path: joinPath(prefix, m[3]),
      owningFile: fileRel,
      handler: balanced(code, openParen),
    });
  }

  const routeRe = new RegExp(`\\b${id}\\s*\\.\\s*route\\s*\\(\\s*(['"\`])([^'"\`]*)\\1\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'g');
  for (const m of code.matchAll(routeRe)) {
    const target = m[3];
    const nextPrefix = joinPath(prefix, m[2]);
    if (localIdents.includes(target)) {
      walkHono(code, fileRel, target, nextPrefix, localIdents, seenFiles, out, seenLocal);
      continue;
    }
    const sub = resolveDefaultImport(code, target, fileRel);
    if (!sub) {
      parseNotes.push(`${fileRel} mounts \`${target}\` at ${m[2]} but no default import and no in-file \`new Hono\` resolves it`);
      continue;
    }
    out.push(...mountedRoutes(sub, nextPrefix, seenFiles));
  }
}

/** Returns [{ method, path, owningFile, handler }] mounted at `prefix`. */
function mountedRoutes(fileRel, prefix, seen = new Set()) {
  if (seen.has(fileRel)) return [];
  seen.add(fileRel);
  const abs = join(ROOT, fileRel);
  if (!existsSync(abs)) {
    parseNotes.push(`route file ${fileRel} does not exist`);
    return [];
  }
  const code = stripComments(readFileSync(abs, 'utf8'));
  const idents = honoIdents(code);
  if (idents.length === 0) {
    parseNotes.push(`${fileRel} declares no \`new Hono\` instance — the parser found nothing to walk`);
    return [];
  }
  const out = [];
  walkHono(code, fileRel, idents[0], prefix, idents, seen, out, new Set());
  return out;
}

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
  const derivedWorkers = deployableWorkers();
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

  const allMounted = [];
  let mountedInServing = 0;
  for (const w of declaredWorkers) {
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

    const mounted = mountedRoutes(entrypoint, '');
    allMounted.push(...mounted);
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
          `${k} — MOUNTED by ${r.owningFile} and absent from the register. [B-1] An unregistered shared ` +
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
    if (typeof cfg.main !== 'string' || cfg.main === '') continue;
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
      if (!new RegExp(`\\benv\\s*\\.\\s*${name}\\b`).test(code)) {
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
      `time(s) across those configs, all agreeing; ${printed.length} declared gap(s) printed above`,
  );
}

/** The scan could not look, so this run is not evidence either way — exit 2,
 *  never 1, which would read as a finding (AGENTS.md exit-code convention,
 *  O-EXIT2-CONVENTION-GAP). Declared LAST (hoisted) so every `assert-platform-register.mjs:NNN`
 *  citation above keeps pointing at the line it names. */
function coverageLost(lines) {
  for (const l of lines) console.error(l);
  process.exit(2);
}
