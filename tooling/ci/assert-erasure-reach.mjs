#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-erasure-reach.mjs — EVERY DATABASE A PERSON'S ROWS CAN LAND IN IS
// REACHED BY "DELETE MY ACCOUNT", AND NEVER THROUGH A SHARED SECRET.
//
// ── THE DEFECT THIS EXISTS FOR, AND WHY EVERY EXISTING CHECK PRINTED "ok" ────
// 🔴 A ROUTE READS THE DATABASES IT READS, NOT THE ONES ITS WORKER BINDS.
// `services/platform`'s DELETE /v1/account sweeps PLATFORM_DB and deletes the
// identity record. It also BINDS `SUBLY_DB` (for the nightly renewals fan-out) —
// and bound is not swept. So for months the ONLY app in the field was the one app
// account deletion did not reach: a Subly user could press Delete account, watch
// it succeed, lose their login, and leave every subscription, budget, budget
// category and payment they had ever entered sitting in subly_db, behind an
// account that no longer existed.
//
// Nothing failed. `assert-deletion-control.mjs` was green, because it asks
// whether the APP ships an in-app control — and it did. `assert-data-inventory
// .mjs` was green, because four rows honestly declared `erasure: no-route`, and
// `no-route` PRINTS rather than fails (correctly: some stores really are
// unreachable, and a guard that reddens main over work only the owner can do is a
// guard somebody switches off). Between "the button exists" and "the gap is
// disclosed" there was no assertion that the button REACHES anything.
//
// ── WHY `no-route` IS NOT AN ACCEPTABLE ANSWER FOR A TABLE WITH A `user_id` ──
// The SHIPPED erasure routes carry no table list: they ask the schema which
// tables are user-owned. So for a table that HAS a `user_id`, "no route reaches
// it" never describes a hard problem — the sweep would cover it the moment a
// route existed. It describes a route somebody has not written. That is exactly
// the shape of gap that becomes permanent by being disclosed, so here it FAILS
// instead of printing. A store with genuinely nothing to address it (the Pages KV
// keyed by email address, which no code in this repository can delete) has no
// columns at all and is not in this guard's domain — the distinction is derived,
// not listed.
//
// ⚠️ "THE ERASURE ROUTES CARRY NO TABLE LIST" IS TRUE OF THE TWO SHIPPED ROUTES
// AND FALSE OF THE TEMPLATE, AND THAT SENTENCE USED TO BE WRITTEN HERE WITHOUT
// THE QUALIFIER. The brick's `src/routes/account.ts` still carries
// `const appTables = ['records'];` — a hand-maintained list — which is why the
// TEMPLATE ROOT below cannot ask limb 1's question through the register and asks
// a different one instead: does the route's table set COVER the template's own
// schema. Both shipped routes say so in their own headers; nothing enforced it.
//
// ── WHAT IS CHECKED ─────────────────────────────────────────────────────────
//   1. NO USER-OWNED TABLE IS ORPHANED. Every table whose migrations give it a
//      `user_id` column must declare a reachable erasure kind in
//      tooling/legal/data-inventory.json. `no-route` on such a table is a fail.
//   2. EVERY NAMED ROUTE IS ACTUALLY MOUNTED. A route file that exists and that
//      no `index.ts` imports and routes is a dead seam that reports healthy —
//      this repository's most repeated failure, and the reason
//      assert-seams-wired.mjs exists. (assert-data-inventory proves the FILE is
//      there; only this proves the Worker serves it.)
//   3. 🔴 THE ERASURE ROUTE IS NOT REACHABLE THROUGH A SYMMETRIC SECRET. This is
//      the limb that let the route be written at all. `services/subly-api`'s
//      default auth middleware falls back to verifying with the shared
//      `SUPABASE_JWT_SECRET`; putting an irreversible route behind that would
//      mean one leaked environment variable can erase anybody's account. So, for
//      any service whose auth middleware CAN fall back (derived by following the
//      calls, not by grepping the file — the file is full of prose about the
//      secret, and comments and string literals are stripped first):
//        (a) the middleware guarding the erasure path must not reach
//            `SUPABASE_JWT_SECRET`, transitively;
//        (b) the route must ALSO refuse on its own, on a token-assurance check
//            that fails closed — because (a) is one line in an index file that a
//            tidy-up can move, and a refusal inside the handler is not.
//   4. THE ENTRY POINT REACHES EVERY APP. The client makes ONE erasure call, to
//      the shared Worker. Every other service that owns a database and ships an
//      erasure route must be named in that Worker's `APP_ERASURE_ENDPOINTS`, and
//      every name in that list must be a service that exists. Both directions, so
//      binding app #2's database cannot silently skip its erasure.
//
// ── THE TEMPLATE ROOT, AND WHY LIMBS 1–4 COULD NOT SEE IT ───────────────────
// 🔴 THE SUBJECT WAS `services/` AND THE REGISTER, AND THAT IS ONE OF TWO ROOTS.
// The brick stamps a WHOLE WORKER — `tooling/bricks/app/__brick__/{{#needs_
// backend}}services{{/needs_backend}}/{{app_id}}-api` — with its own
// wrangler.jsonc (APP_DB + a `migrations_dir`), its own `migrations/0001_init
// .sql` creating a `records` table with a `user_id`, its own `src/index.ts`
// mounting `/v1/account`, its own `src/middleware/auth.ts` carrying the
// SUPABASE_JWT_SECRET fallback, and its own `src/routes/account.ts`. Every limb
// above has an exact structural twin in there, and none of them read a byte of
// it: measured 2026-09-05, this guard read 9 migration files (7 platform +
// 2 subly-api) and the template's was not one.
//
// So SIX brick-shaped defects were all EXIT 0 on the unwidened guard — see the
// dated mutation table at the foot of this header. Each one stamps into every
// backend app the factory ever produces, which is the multiplier that makes the
// template root worth more than the live one: a defect here is not one app's
// orphaned rows, it is app #2 through app #50's.
//
// ── THE DOMAIN, DERIVED — TWO ROOTS, TWO FLOORS, NEVER A UNION ──────────────
//   LIVE ROOT      every `services/*/wrangler.jsonc` that declares a
//                  `migrations_dir`, i.e. every Worker that OWNS a database.
//                  FLOOR: at least TWO (the shared Worker and at least one app
//                  Worker). A domain that has collapsed to one is the blind spot
//                  this guard was written to close.
//   TEMPLATE ROOT  every `tooling/bricks/**/wrangler.jsonc` that declares a
//                  `migrations_dir`. FLOOR: at least ONE, owning at least one
//                  database, with at least one migration file read and at least
//                  one user-owned table found in it.
//
// The floors are SEPARATE. A union floor of three stays satisfied while the
// template root is emptied — `assert-workspace-coverage.mjs:130-136` is the
// recorded case of exactly that, a union floor holding over an emptied `apps/`.
//
// 🔴 AND A ROOT NEVER DERIVED IS NEVER EMPTY. Two named roots would still be a
// LIST, so the enumeration is the whole tree: every `wrangler.jsonc` reachable
// through `boundedGlob`, cross-checked against `git ls-files`. A config that is
// in neither root is COVERAGE LOST, not a silent skip — otherwise a Worker that
// lands under `packages/` or at the repo root joins the portfolio with an
// unswept database and this guard never mentions it.
//
// ⚠️ THE MUSTACHE PATH IS NOT A GLOB PATTERN. The `/` inside `{{/needs_backend}}`
// IS A PATH SEPARATOR: on disk that is a directory named
// `{{#needs_backend}}services{{` containing one named `needs_backend}}`, and
// braces are glob syntax. So every template path here is used LITERALLY after
// enumeration and never fed back to a matcher — the same answer
// assert-no-do-alarms.mjs reached for the same directory.
//
// ⚠️ THE TEMPLATE FLOOR IS APPLIED ONLY OVER A FULL CHECKOUT, detected by this
// guard's OWN file under ROOT — a sentinel that sits OUTSIDE both subject trees
// (`services/` and `tooling/bricks/`) and therefore survives any mutation of
// either, which a sentinel inside one of them would not. The unit tests
// legitimately model one root at a time. WHICH BRANCH WAS TAKEN IS PRINTED ON
// EVERY RUN rather than implied.
//
// ── WHAT IS CHECKED ON THE TEMPLATE ROOT ────────────────────────────────────
//   T1. THE ROUTE'S TABLE SET COVERS THE TEMPLATE'S OWN SCHEMA. Limb 1's
//       question cannot be asked through the register — `{{app_id}}_db` is not a
//       database and has no inventory row — so it is asked against the two
//       template files instead: every table the template's migrations give a
//       `user_id` must be reachable by the template's erasure route, either
//       because the route DERIVES its set from `sqlite_master` (what both
//       shipped routes do) or because the table is named in the list it carries.
//   T2. THE TEMPLATE MOUNTS ITS ERASURE ROUTE. Derived from the `.route('…
//       account…', X)` call in the template's index.ts and resolved back to the
//       import — a stamped Worker whose account route is imported and not
//       mounted ships a dead seam in every app.
//   T3. THE SAME LIMB 3, ON THE TEMPLATE. The brick's auth.ts carries the
//       SUPABASE_JWT_SECRET fallback, so the mounting and the handler's own
//       `tokenAssurance !== 'asymmetric'` refusal are both required there for
//       the same reason they are required in `services/`.
//   T4. THE TEMPLATE DECLARES `vars.APP_ID`. Without it every stamped backend
//       fails limb 4 on the day it is stamped, because nothing can match it to
//       the shared Worker's APP_ERASURE_ENDPOINTS.
//
//   NOT CHECKED, AND SAID RATHER THAN IMPLIED: limb 4's own relation. A stamped
//   app's presence in APP_ERASURE_ENDPOINTS is a PROVISIONING act
//   (tooling/scripts/provision-backend.mjs), not a fact the template can carry —
//   the template has no app id yet. T4 checks only that the hook exists.
//
// ── MEASURED BY MUTATION ON THE REAL TREE, 2026-09-05 ───────────────────────
// `before` = main@a9b04696's version of this file, run in place under
// tooling/ci/ so its relative imports resolve. THE GREEN CONTROL IS THE FIRST
// ROW AND IT IS NOT DECORATION: without a 0 on the unmutated tree, a 1 anywhere
// below is just as likely to be a guard that cannot load.
//
//   mutation                                    before  after  caught by
//   (none — GREEN CONTROL)                        0       0     —
//   brick migration grows a `user_id` table       0       1     T1
//     the route's `appTables` does not name
//   brick index mounts /v1/account behind         0       1     T3(a)
//     `supabaseAuth` instead of `erasureAuth`
//   brick index stops `.route(…)`-ing account     0       1     T2
//   brick route loses `tokenAssurance`            0       1     T3(b)
//   brick route spelled `!== 'symmetric'`         0       1     T3(b)
//   brick route file emptied to a stub            0       1     T1 + T3(b)
//   brick wrangler drops `vars.APP_ID`            0       1     T4
//   brick wrangler drops `migrations_dir`         0       1     template floor
//   a wrangler.jsonc under `packages/`            0       1     COVERAGE LOST
//   a wrangler.jsonc nested under `services/`     0       1     COVERAGE LOST
//   subly-api route spelled `!== 'symmetric'`     1       1     live limb 3(b)
//                                                                (positive
//                                                                 control: the
//                                                                 harness bites)
//   subly-api `tokenAssurance` SUFFIX-renamed     0       1     live limb 3(b),
//     to `tokenAssuranceXX`                                      after the fix
//                                                                below
//
// 🔴 THE LAST ROW IS A DEFECT THIS WIDENING FOUND IN THE EXISTING LIMB, not in
// the new one. `/tokenAssurance/` unanchored is satisfied by
// `tokenAssuranceXX`, so a find-and-replace that SUFFIXES the identifier left
// the handler with no refusal and limb 3(b) green — on the live root, since
// 3(b) was written. Both spellings are `\btokenAssurance\b` now. It was found by
// running the mutation, not by reading the line; the existing test only ever
// renamed the identifier to a different word, which the unanchored regex caught.
//
// Usage:  node tooling/ci/assert-erasure-reach.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir, boundedGlob } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const SERVICES = join(ROOT, 'services');
const REGISTER = join(ROOT, 'tooling', 'legal', 'data-inventory.json');

/** 🔴 THE SENTINEL FOR THE TEMPLATE FLOOR, AND IT IS DELIBERATELY THIS FILE.
 *  The floor below is a measurement of THIS repository and means nothing over a
 *  synthetic root — erasure-reach.test.mjs legitimately models the live root
 *  alone, with three files in it. `tooling/ci/assert-erasure-reach.mjs` sits
 *  OUTSIDE both subject trees (`services/` and `tooling/bricks/`), so it
 *  survives every mutation OF a subject; a sentinel inside either tree would
 *  vanish with the thing it was vouching for. Same shape as
 *  assert-no-tls-pinning.mjs's IS_FULL_CHECKOUT. */
const IS_FULL_CHECKOUT = existsSync(join(ROOT, 'tooling', 'ci', 'assert-erasure-reach.mjs'));

/** Vendored code and build output are not part of the tree under test. (Nested
 *  checkouts and `.claude` are already excluded inside tree-walk.mjs.) */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules', '.git', '.dart_tool', '.wrangler', 'build', 'dist', 'coverage', '.next', 'out',
]);

const problems = [];
const notes = [];

/** Structural failure — the scan itself is broken, so nothing below it means
 *  anything. Exits immediately rather than joining the problem list. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

const jsoncParse = (text) => JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));
const readCode = (p) => stripSourceComments(readFileSync(p, 'utf8'), '.ts');

// ── the domain ──────────────────────────────────────────────────────────────
if (!existsSync(SERVICES)) {
  coverageLost([
    `${SERVICES} does not exist, so the service walk ranged over nothing.`,
    'Every limb below quantifies over the Workers that own a database. With none found, "every database',
    'is reached by delete-my-account" is vacuously true and this guard prints ok over the exact gap it',
    'was written to close.',
  ]);
}

// ── EVERY WRANGLER CONFIG IN THE TREE, CLASSIFIED INTO A ROOT ───────────────
// 🔴 THIS IS WHAT STOPS THE ROOTS BEING A LIST. Two named roots are still two
// names, and a Worker that lands anywhere else joins the portfolio with an
// unswept database while both floors stay satisfied. So the enumeration is the
// whole tree and the classification is exhaustive: a config in neither root is
// COVERAGE LOST. Paths are used LITERALLY after this point — see the mustache
// note in the header.
// NOT named `rel`: limbs 2 and 3 both bind a loop variable of that name, and a
// module-level `rel` silently shadowed inside them is a trap in a file this
// careful. Repo-relative paths are compared as POSIX throughout.
const toPosix = (p) => String(p).replaceAll('\\', '/');
const allConfigs = new Set();
for (const pattern of ['**/wrangler.jsonc', 'wrangler.jsonc']) {
  for await (const match of boundedGlob(pattern, { cwd: ROOT })) {
    const r = toPosix(match);
    if (r.split('/').some((seg) => EXCLUDED_SEGMENTS.has(seg))) continue;
    allConfigs.add(r);
  }
}
const LIVE_PREFIX = 'services/';
const TEMPLATE_PREFIX = 'tooling/bricks/';
const liveConfigs = [...allConfigs].filter((r) => r.startsWith(LIVE_PREFIX)).sort();
const templateConfigs = [...allConfigs].filter((r) => r.startsWith(TEMPLATE_PREFIX)).sort();
const unclassified = [...allConfigs]
  .filter((r) => !r.startsWith(LIVE_PREFIX) && !r.startsWith(TEMPLATE_PREFIX))
  .sort();
if (unclassified.length) {
  coverageLost([
    `${unclassified.length} wrangler config(s) belong to neither root: ${unclassified.join(', ')}.`,
    'Both floors below quantify over `services/*` and `tooling/bricks/**`. A Worker outside both is a Worker',
    'whose bindings, migrations and erasure route this scan never reads — and both floors stay satisfied while',
    'it does, which is a root that is never derived and therefore never empty. Put it under one of the two',
    'roots, or widen this classification deliberately and say why.',
  ]);
}
// The DERIVED cross-check: whatever git tracks must be among what this scan
// enumerated. Not "at least N" — a number somebody eventually lowers — but a
// relationship between two independent observations of the same tree. Only over
// a real checkout; a temp fixture is not a repository.
// ⚠️ `.git` MUST EXIST AT ROOT, AND THE TEST IS EXISTENCE RATHER THAN
// `isDirectory()`: it is a directory in a clone and a FILE (`gitdir: …`) in a
// worktree, which is what this repository's agents actually run in. Without the
// test, `git -C <tmp> ls-files` walks UP to whatever repository encloses the
// temp directory and reports ITS files as unseen — a COVERAGE LOST naming files
// that were never in scope.
if (IS_FULL_CHECKOUT && existsSync(join(ROOT, '.git'))) {
  const ls = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const tracked =
    ls.status === 0
      ? ls.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /(?:^|\/)wrangler\.jsonc$/.test(l))
          .sort()
      : [];
  const unseen = tracked.filter((t) => !allConfigs.has(t));
  if (unseen.length) {
    coverageLost([
      `git tracks ${tracked.length} wrangler.jsonc and this scan enumerated ${allConfigs.size}; it never saw: ${unseen.join(', ')}.`,
      'Every unseen config takes its databases, its migrations and its erasure route with it, and this guard',
      'would print ok over exactly the Worker it could not open.',
    ]);
  }
}

/** { dir, name (worker name), appId, owns: [dbName], binds: [dbName], vars } */
const services = [];
for (const entry of listDir(SERVICES, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = join(SERVICES, entry.name);
  const cfgPath = join(dir, 'wrangler.jsonc');
  if (!existsSync(cfgPath)) continue;
  let cfg;
  try {
    cfg = jsoncParse(readFileSync(cfgPath, 'utf8'));
  } catch (err) {
    problems.push(
      `services/${entry.name}/wrangler.jsonc could not be parsed as JSONC (${err.message}), so its bindings ` +
        'could not be enumerated and every question below about that Worker is unanswerable.',
    );
    continue;
  }
  const dbs = Array.isArray(cfg.d1_databases) ? cfg.d1_databases : [];
  services.push({
    id: entry.name,
    dir,
    vars: cfg.vars ?? {},
    appId: typeof cfg.vars?.APP_ID === 'string' ? cfg.vars.APP_ID : null,
    owns: dbs.filter((d) => typeof d?.migrations_dir === 'string').map((d) => d.database_name),
    binds: dbs.map((d) => d?.database_name).filter((n) => typeof n === 'string'),
    migrationDirs: dbs
      .filter((d) => typeof d?.migrations_dir === 'string')
      .map((d) => ({ db: d.database_name, dir: join(dir, d.migrations_dir) })),
  });
}

// The live walk above takes DIRECT children of `services/`; the glob takes every
// depth. They must agree, or a Worker nested one level deeper is a live config
// this scan enumerated and never opened — the same silent skip the
// classification above refuses, one level in.
{
  const opened = new Set(services.map((s) => `services/${s.id}/wrangler.jsonc`));
  const missed = liveConfigs.filter((c) => !opened.has(c));
  if (missed.length) {
    coverageLost([
      `the live walk opened ${opened.size} config(s) under services/ and the tree contains ${liveConfigs.length}; it never opened: ${missed.join(', ')}.`,
      'The walk takes direct children of `services/`. A Worker nested deeper owns databases that no limb below',
      'ranges over, while the two-owner floor stays satisfied by the two above it.',
    ]);
  }
}

const owners = services.filter((s) => s.owns.length > 0);
if (owners.length < 2) {
  coverageLost([
    `only ${owners.length} service(s) own a database (${owners.map((s) => s.id).join(', ') || 'none'}).`,
    'Expected the shared Worker AND at least one app Worker. A domain that has collapsed to one re-creates',
    'the blind spot this guard closes: the shared Worker alone always looks complete, because the database',
    'it does not sweep belongs to the service that just left the scan.',
  ]);
}

// ── the register ────────────────────────────────────────────────────────────
if (!existsSync(REGISTER)) {
  coverageLost([
    'tooling/legal/data-inventory.json does not exist.',
    'It is the left-hand side of limbs 1 and 2 — the declaration each table makes about how erasure',
    'reaches it. Absent, both limbs compare the tree to nothing.',
  ]);
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  coverageLost([`tooling/legal/data-inventory.json is not valid JSON (${err.message}).`]);
}
const rows = new Map(
  (register.stores ?? []).filter((s) => s.kind === 'd1-table').map((s) => [s.id, s]),
);

// ── walk the migrations: which tables carry a `user_id` ─────────────────────
// Comments AND string literals stripped first. A table name inside a rollback
// note is not a table, and this repository has already shipped a guard that
// matched the comment explaining why a binding did NOT exist.
const userOwned = new Map(); // `table:<db>.<name>` → { db, table }
let migrationFilesRead = 0;
for (const svc of services) {
  for (const { db, dir } of svc.migrationDirs) {
    if (!existsSync(dir)) {
      problems.push(
        `services/${svc.id}/wrangler.jsonc points ${db} at a migrations_dir that does not exist (${dir.slice(ROOT.length + 1)}). ` +
          'The schema cannot be read, so no table of that database can be checked for a `user_id`.',
      );
      continue;
    }
    for (const f of listDir(dir).filter((n) => n.toLowerCase().endsWith('.sql')).sort()) {
      migrationFilesRead++;
      const sql = stripStringLiterals(stripSourceComments(readFileSync(join(dir, f), 'utf8'), '.sql'));
      for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)[^;]*/gi)) {
        if (/\buser_id\b/i.test(m[0])) userOwned.set(`table:${db}.${m[1]}`, { db, table: m[1] });
      }
      for (const m of sql.matchAll(
        /ALTER\s+TABLE\s+["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s+ADD\s+(?:COLUMN\s+)?["'`[]?([A-Za-z_][\w$]*)/gi,
      )) {
        if (/^user_id$/i.test(m[2])) userOwned.set(`table:${db}.${m[1]}`, { db, table: m[1] });
      }
    }
  }
}
if (migrationFilesRead === 0) {
  coverageLost([
    'not one migration file was read across every service that owns a database.',
    'Limb 1 asks which tables carry a `user_id`, and over an empty schema the answer is "none" — so',
    '"no user-owned table is orphaned" would be true of a repository with no erasure anywhere.',
  ]);
}
if (userOwned.size === 0) {
  coverageLost([
    `${migrationFilesRead} migration file(s) were read and NOT ONE user-owned table was found in them.`,
    'The CREATE TABLE / ADD COLUMN patterns stopped matching, so limb 1 ranged over an empty set. Every',
    'app in this factory keys its rows on `user_id`; zero is a broken parse, not a schema.',
  ]);
}

// ── LIMB 1 · no user-owned table is orphaned ────────────────────────────────
for (const [id, { table }] of userOwned) {
  const row = rows.get(id);
  if (!row) {
    problems.push(
      `${id} has a \`user_id\` column and NO row in tooling/legal/data-inventory.json, so nothing declares how ` +
        'an erasure request reaches it. (assert-data-inventory.mjs owns the both-directions store comparison; ' +
        'this limb is here so limb 1 cannot pass by the row simply being absent.)',
    );
    continue;
  }
  const kind = row.erasure?.kind;
  if (kind === 'no-route') {
    problems.push(
      `${id} declares \`erasure: no-route\` and its schema gives it a \`user_id\`. The erasure routes carry no ` +
        'table list — they ask the schema — so "no route reaches it" here never describes a hard problem, only a ' +
        'route nobody has written. That is the gap that becomes permanent by being disclosed: ' +
        `\`no-route\` PRINTS rather than fails in assert-data-inventory.mjs, which is right for a store nothing ` +
        'can address and wrong for this one. Write the route, or drop the column.',
    );
  } else if (kind !== 'purge') {
    problems.push(
      `${id} has a \`user_id\` column and declares erasure kind ${JSON.stringify(kind)}. A table the sweep ` +
        'DELETEs from is `purge`; any other kind is a claim about this table that its own schema contradicts.',
    );
  }
}

// ── LIMB 2 · every named route is actually mounted ──────────────────────────
const routeFiles = new Set(
  [...rows.values()].map((r) => r.erasure?.route).filter((r) => typeof r === 'string' && r),
);
if (routeFiles.size === 0) {
  coverageLost([
    'no inventory row names an `erasure.route`, so limbs 2 and 3 had nothing to range over.',
    'Every `purge` row names the route that performs it. None means the field was renamed or the rows lost',
    'their declarations — and a guard about erasure routes that finds no erasure route prints ok.',
  ]);
}
/** route file (repo-relative) → the service that serves it */
const routeService = new Map();
for (const rel of [...routeFiles].sort()) {
  const abs = join(ROOT, ...rel.split('/'));
  if (!existsSync(abs)) {
    problems.push(`the inventory names erasure route ${rel}, which does not exist.`);
    continue;
  }
  const svc = services.find((s) => abs.startsWith(s.dir + sep));
  if (!svc) {
    problems.push(
      `erasure route ${rel} does not live under any services/* Worker this scan found, so nothing can be said ` +
        'about which auth boundary guards it — which is the entire subject of limb 3.',
    );
    continue;
  }
  routeService.set(rel, svc);

  const indexPath = join(svc.dir, 'src', 'index.ts');
  if (!existsSync(indexPath)) {
    problems.push(`services/${svc.id} has no src/index.ts, so its erasure route ${rel} is served by nothing.`);
    continue;
  }
  const index = readCode(indexPath);
  // A route file that exists and that nothing mounts is a dead seam reporting
  // healthy. Both halves are required: the import binds a name, the `route(`
  // call is what makes the Worker answer on it.
  const moduleName = rel.split('/').pop().replace(/\.ts$/, '');
  const importMatch = new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+['"][^'"]*routes/${moduleName}['"]`).exec(
    index,
  );
  if (!importMatch) {
    problems.push(
      `services/${svc.id}/src/index.ts never imports its erasure route (${rel}). The file exists and the Worker ` +
        'does not serve it — a dead seam that every file-existence check reports as healthy.',
    );
    continue;
  }
  const bound = importMatch[1];
  if (!new RegExp(`\\.route\\([^)]*,\\s*${bound}\\s*\\)`).test(index)) {
    problems.push(
      `services/${svc.id}/src/index.ts imports ${bound} from its erasure route and never mounts it with ` +
        '`.route(...)`. An import is not a surface.',
    );
  }
}

// ── LIMB 3 · the erasure route is not reachable through a symmetric secret ──
/**
 * Top-level declarations of a module, name → body text, with comments and string
 * literals already gone. Crude by design: these middleware files are flat, and a
 * real parser here would be a second thing to be wrong.
 *
 * 🔴 ANCHORED TO COLUMN ZERO (`^` with `m`), AND THAT ANCHOR IS THE WHOLE THING.
 * Without it, an INNER `const issuer = …` is read as a top-level declaration and
 * SPLITS the enclosing function's body — so `verifySupabaseToken` appeared not to
 * contain `SUPABASE_JWT_SECRET` (the reference had fallen into the slice
 * attributed to `issuer`), `supabaseAuth` therefore did not reach it, and the
 * guard PASSED on a tree where the erasure route was mounted behind the
 * shared-secret middleware. Found by mutation, not by reading: the count was
 * non-zero the whole time, because a junk inner name was carrying the hit.
 */
function declarations(code) {
  const decl = /^(?:export\s+)?(?:const|let|async\s+function|function)\s+([A-Za-z_$][\w$]*)/gm;
  const out = new Map();
  const hits = [...code.matchAll(decl)];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : code.length;
    out.set(hits[i][1], code.slice(start, end));
  }
  return out;
}

/** Does `name` reach `needle`, following calls to other declarations in the same
 *  module? The transitive step is the whole point: `supabaseAuth` never spells
 *  `SUPABASE_JWT_SECRET` itself — it calls the function that does. */
function reaches(decls, name, needle, seen = new Set()) {
  if (seen.has(name)) return false;
  seen.add(name);
  const body = decls.get(name);
  if (body === undefined) return false;
  if (body.includes(needle)) return true;
  for (const other of decls.keys()) {
    if (other === name) continue;
    if (new RegExp(`\\b${other}\\s*\\(`).test(body) && reaches(decls, other, needle, seen)) return true;
  }
  return false;
}

// 🔴 THE SELF-TEST FOR THE TRANSITIVE STEP, ON AN INPUT THIS FILE CONSTRUCTS.
// Limb 3's whole question is answered by call-following: `supabaseAuth` never
// spells `SUPABASE_JWT_SECRET` itself, it calls the function that does. A regex
// that stopped resolving calls would report every Worker fallback-free and pass.
// That cannot be self-checked against the real tree — "no middleware reaches the
// secret" is also what a repository that removed the fallback looks like, and a
// check that fails on the cure is one somebody deletes. So the algorithm is
// exercised directly, with a recorded failing input: break either the anchor or
// the call regex and this fires before any tree is read.
{
  const probe = declarations(
    'function inner() {\n  return env.NEEDLE_XYZ;\n}\nconst outer = () => {\n  const local = 1;\n  return inner();\n};\n',
  );
  if (!probe.has('outer') || !probe.has('inner')) {
    coverageLost([
      'the top-level declaration parse did not find both names in a two-declaration probe.',
      'Limb 3 resolves which middleware can reach the shared secret by walking these declarations; with the',
      'parse broken it finds none, reports every Worker fallback-free, and passes on a route that is behind',
      'the secret.',
    ]);
  }
  if (!reaches(probe, 'outer', 'NEEDLE_XYZ')) {
    coverageLost([
      'the reachability walk did not follow `outer` → `inner` to a needle in the callee.',
      'That transitive step IS limb 3: a middleware verifies with the shared secret through a helper, never',
      'inline. Without it the guard answers "no middleware reaches SUPABASE_JWT_SECRET" for every Worker and',
      'prints ok over the exact mounting it exists to refuse.',
    ]);
  }
  if (reaches(probe, 'inner', 'NOT_PRESENT_ANYWHERE')) {
    coverageLost([
      'the reachability walk claims to find a needle that is in no declaration.',
      'An always-true walk marks every middleware fallback-capable, which fails the build on correct code —',
      'and the fix somebody reaches for is deleting the limb.',
    ]);
  }
}

let strictBoundariesChecked = 0;
for (const [rel, svc] of routeService) {
  const authPath = join(svc.dir, 'src', 'middleware', 'auth.ts');
  if (!existsSync(authPath)) {
    problems.push(
      `services/${svc.id} serves an erasure route and has no src/middleware/auth.ts, so this scan cannot tell ` +
        'what authenticates it. An unreadable auth boundary is not a passing one.',
    );
    continue;
  }
  const authCode = stripStringLiterals(readCode(authPath));
  const decls = declarations(authCode);
  if (decls.size === 0) {
    coverageLost([
      `no top-level declaration was parsed out of services/${svc.id}/src/middleware/auth.ts.`,
      'Limb 3 decides which middleware can fall back to a shared secret by following the calls between those',
      'declarations. With none parsed, every erasure route is judged fallback-free — which is the answer a',
      'broken parse gives and the answer a safe repository gives, and they must not print the same.',
    ]);
  }
  // ⚠️ NO "every export was parsed" CHECK HERE, DELIBERATELY. It would use the
  // same regex as `declarations`, so no input could make one find a name the
  // other missed — an assertion that cannot fail, inflating apparent coverage.
  // The parse is pinned instead by the constructed probe above (which has three
  // recorded failing inputs, all of them mutations of this file's own regexes)
  // and by the `decls.size === 0` refusal directly above.
  const fallbackCapable = [...decls.keys()].filter((n) => reaches(decls, n, 'SUPABASE_JWT_SECRET'));
  if (fallbackCapable.length === 0) {
    // A Worker with no symmetric path at all owes nothing here. PRINTED, so a
    // service judged fallback-free is visible rather than silently skipped.
    notes.push(
      `⬜ services/${svc.id} — src/middleware/auth.ts never uses SUPABASE_JWT_SECRET, so there is no symmetric ` +
        'fallback for the erasure route to be exposed to.',
    );
    continue;
  }
  strictBoundariesChecked++;

  const index = readCode(join(svc.dir, 'src', 'index.ts'));
  // Which middleware guards the erasure path? Derived from the `use(` calls whose
  // path names /account, not from a name this guard expects to find.
  const guards = [...index.matchAll(/\.use\(\s*['"]([^'"]*account[^'"]*)['"]\s*,\s*([A-Za-z_$][\w$]*)/g)];
  if (guards.length === 0) {
    problems.push(
      `services/${svc.id}/src/index.ts mounts an erasure route and no path-scoped \`use('…account…', …)\` ` +
        'guards it. On a Worker whose default middleware accepts a shared HS256 secret, an erasure route with no ' +
        'boundary of its own is either unauthenticated or behind that secret; neither is acceptable for an ' +
        'irreversible route.',
    );
  }
  for (const [, path, mw] of guards) {
    if (fallbackCapable.includes(mw)) {
      problems.push(
        `services/${svc.id}: DELETE ${path} is guarded by \`${mw}\`, which reaches SUPABASE_JWT_SECRET — so a token ` +
          'signed with the shared secret can erase an account. One leaked environment variable then mints a ' +
          'deletion for any user. Guard it with a middleware that verifies asymmetrically and has no secret in ' +
          `scope (the fallback-capable middleware here: ${fallbackCapable.join(', ')}).`,
      );
    }
  }

  // (b) …and the route refuses on its own, because (a) is a line in another file.
  //
  // ⚠️ COMMENTS STRIPPED, STRING LITERALS KEPT — the opposite of everywhere else
  // in this file, and deliberately. The thing being asserted here IS a string
  // literal (`'asymmetric'`), so stripping literals would leave `!== ` and the
  // check could never pass; it failed exactly that way when first run. Comments
  // still go, which is what stops this matching the paragraph above the line.
  const routeCode = readCode(join(ROOT, ...rel.split('/')));
  // ⚠️ WORD-ANCHORED. An unanchored /tokenAssurance/ is satisfied by
  // `tokenAssuranceXX`, so a rename that SUFFIXES the identifier — the shape a
  // find-and-replace produces — left the route with no refusal and this limb
  // green. Found by mutation on 2026-09-05 while widening the same check onto
  // the template root, where it fired the same way.
  if (!/\btokenAssurance\b/.test(routeCode)) {
    problems.push(
      `${rel} does not check \`tokenAssurance\`. The mounting above is one line in an index file that a tidy-up ` +
        'can move; without a refusal inside the handler, moving it puts account deletion behind the shared secret ' +
        'with every test still green.',
    );
  } else if (!/!==\s*'asymmetric'/.test(routeCode)) {
    problems.push(
      `${rel} reads \`tokenAssurance\` and does not refuse on \`!== 'asymmetric'\`. A check spelled ` +
        "`!== 'symmetric'` admits `undefined` — a route reached with no auth middleware at all — which is the " +
        'fail-OPEN spelling of the same line.',
    );
  }
}
// ⚠️ THERE IS DELIBERATELY NO `strictBoundariesChecked === 0` COVERAGE LOST HERE.
// Zero would be the state a repository reaches by REMOVING every shared-secret
// fallback — the outcome this guard exists to push towards — and a self-check
// that fails on the fix is a self-check somebody deletes. The parse is instead
// self-checked per service, above, as a consistency between two independent reads
// of the same file; that catches the broken walk without punishing the cure.

// ── LIMB 4 · the entry point reaches every app ──────────────────────────────
const entry = owners.find((s) => s.owns.includes('platform_db'));
if (!entry) {
  coverageLost([
    'no service owns `platform_db`, so the portfolio erasure ENTRY POINT could not be identified.',
    'The client makes one erasure call, to the shared Worker. Without knowing which Worker that is, "every',
    'app is reached from it" ranges over nothing.',
  ]);
}
/** appId → origin, parsed the same way the route parses it. */
const declaredEndpoints = new Map();
for (const raw of String(entry.vars.APP_ERASURE_ENDPOINTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  const at = raw.indexOf('=');
  if (at <= 0) {
    problems.push(
      `services/${entry.id}/wrangler.jsonc APP_ERASURE_ENDPOINTS entry ${JSON.stringify(raw)} is not ` +
        '`<appId>=<https origin>`. The route refuses to serve on a malformed list, so this is a deployment that ' +
        'cannot delete an account at all.',
    );
    continue;
  }
  const appId = raw.slice(0, at).trim();
  const origin = raw.slice(at + 1).trim().replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(origin)) {
    problems.push(
      `services/${entry.id}/wrangler.jsonc declares erasure endpoint ${JSON.stringify(origin)} for ${appId}, which ` +
        'is not a bare https origin. The relay forwards the caller\'s own bearer token, so a plaintext or ' +
        'path-carrying value puts a live session token somewhere nobody chose.',
    );
    continue;
  }
  declaredEndpoints.set(appId, origin);
}

/** Every OTHER service that owns a database and serves an erasure route. */
const appsWithRoutes = [...new Set([...routeService.values()])].filter((s) => s !== entry);
for (const svc of appsWithRoutes) {
  if (!svc.appId) {
    problems.push(
      `services/${svc.id}/wrangler.jsonc declares no \`vars.APP_ID\`, so its erasure endpoint cannot be matched to ` +
        `the shared Worker's APP_ERASURE_ENDPOINTS list.`,
    );
    continue;
  }
  if (!declaredEndpoints.has(svc.appId)) {
    problems.push(
      `services/${svc.id} owns ${svc.owns.join(', ')} and serves an erasure route, and services/${entry.id}'s ` +
        `APP_ERASURE_ENDPOINTS does not name "${svc.appId}". The client makes ONE erasure call, to the shared ` +
        "Worker; an app missing from that list is an app whose rows survive every account deletion — silently, " +
        'because the shared route has nothing to fail on.',
    );
  }
}
// …and the other direction, so the list cannot outlive the service it names.
for (const appId of declaredEndpoints.keys()) {
  if (!appsWithRoutes.some((s) => s.appId === appId)) {
    problems.push(
      `services/${entry.id}'s APP_ERASURE_ENDPOINTS names "${appId}", and no services/* Worker with an erasure ` +
        'route declares that APP_ID. Either the service was renamed on one side only, or the entry describes a ' +
        'Worker that is gone — and every deletion would then 502 on a route that is not there.',
    );
  }
}
if (appsWithRoutes.length === 0 && problems.length === 0) {
  coverageLost([
    'no service OTHER than the entry point serves an erasure route.',
    'Limb 4 exists because the shared Worker cannot reach an app\'s own database. With no app route found, the',
    'relation it checks is empty — which is indistinguishable from the state this whole guard was written',
    'about, in which the only app in the field had no erasure route at all.',
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TEMPLATE ROOT — the Worker every future backend app is stamped from.
//
// Its own floor, never added to the live one. See the header for why the roots
// are separate and why the enumeration is the whole tree rather than two names.
// ═══════════════════════════════════════════════════════════════════════════
const templateOwners = [];
for (const cfgRel of templateConfigs) {
  const dirRel = cfgRel.slice(0, cfgRel.lastIndexOf('/'));
  const dir = join(ROOT, ...dirRel.split('/'));
  let cfg;
  try {
    cfg = jsoncParse(readFileSync(join(ROOT, ...cfgRel.split('/')), 'utf8'));
  } catch (err) {
    problems.push(
      `${cfgRel} could not be parsed as JSONC (${err.message}). It is the template every stamped backend is ` +
        'born from, so an unreadable one is every future app\'s bindings unreadable at once.',
    );
    continue;
  }
  const dbs = Array.isArray(cfg.d1_databases) ? cfg.d1_databases : [];
  const owns = dbs.filter((d) => typeof d?.migrations_dir === 'string');
  if (owns.length === 0) continue;
  templateOwners.push({
    cfgRel,
    dirRel,
    dir,
    vars: cfg.vars ?? {},
    appId: typeof cfg.vars?.APP_ID === 'string' ? cfg.vars.APP_ID : null,
    migrationDirs: owns.map((d) => ({ db: d.database_name, dir: join(dir, d.migrations_dir) })),
  });
}

// 🔴 THE TEMPLATE FLOOR, SEPARATE FROM THE LIVE ONE. A union floor of three
// stays satisfied while this root is emptied — assert-workspace-coverage.mjs
// :130-136 is the recorded case of a union floor holding over an emptied tree.
if (IS_FULL_CHECKOUT && templateOwners.length === 0) {
  coverageLost([
    `no wrangler config under ${TEMPLATE_PREFIX} declares a \`migrations_dir\` (${templateConfigs.length} template config(s) found).`,
    'The brick stamps a Worker with its own D1, its own migrations and its own erasure route, and every limb of',
    'this guard has a structural twin in it. With the template root empty, T1–T4 range over nothing and print',
    'ok — while a defect stamped here reaches app #2 through app #50 at once, which is the whole reason this',
    'root is worth more than the live one.',
  ]);
}

let templateTablesChecked = 0;
let templateMigrationFilesRead = 0;
for (const tpl of templateOwners) {
  // ── the template's own schema: which tables carry a `user_id` ─────────────
  const tplUserOwned = new Set();
  for (const { dir: mdir } of tpl.migrationDirs) {
    if (!existsSync(mdir)) {
      problems.push(
        `${tpl.cfgRel} points a database at a migrations_dir that does not exist. Every app stamped from this ` +
          'template is stamped with a schema that cannot be applied.',
      );
      continue;
    }
    for (const f of listDir(mdir).filter((n) => n.toLowerCase().endsWith('.sql')).sort()) {
      templateMigrationFilesRead++;
      const sql = stripStringLiterals(stripSourceComments(readFileSync(join(mdir, f), 'utf8'), '.sql'));
      for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)[^;]*/gi)) {
        if (/\buser_id\b/i.test(m[0])) tplUserOwned.add(m[1]);
      }
      for (const m of sql.matchAll(
        /ALTER\s+TABLE\s+["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s+ADD\s+(?:COLUMN\s+)?["'`[]?([A-Za-z_][\w$]*)/gi,
      )) {
        if (/^user_id$/i.test(m[2])) tplUserOwned.add(m[1]);
      }
    }
  }
  // The floor for THIS root's schema read, on the same reasoning as the live
  // one: zero is a broken parse, not a template.
  if (IS_FULL_CHECKOUT && tplUserOwned.size === 0) {
    coverageLost([
      `${tpl.dirRel} owns a database and NOT ONE user-owned table was found in its ${templateMigrationFilesRead} migration file(s).`,
      'T1 asks whether the template\'s erasure route covers the template\'s schema. Over an empty schema the',
      'answer is yes for a route that sweeps nothing, which is the vacuous pass this guard refuses everywhere',
      'else. The starter migration creates a user-owned table on purpose — every stamped app inherits it.',
    ]);
  }

  // ── T2 · the template mounts its erasure route ────────────────────────────
  const indexPath = join(tpl.dir, 'src', 'index.ts');
  if (!existsSync(indexPath)) {
    problems.push(`${tpl.dirRel} has no src/index.ts, so nothing in the stamped Worker serves an erasure route.`);
    continue;
  }
  const tplIndex = readCode(indexPath);
  // Derived from the tree, not from a filename this guard expects: the mount
  // whose PATH names /account, then resolved back through its import.
  const mount = /\.route\(\s*['"]([^'"]*account[^'"]*)['"]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/.exec(tplIndex);
  if (!mount) {
    problems.push(
      `${tpl.dirRel}/src/index.ts mounts no \`.route('…account…', …)\`. Every app stamped from this template ` +
        'ships a Worker that owns a database and answers nothing on account deletion — a dead seam multiplied by ' +
        'the number of apps the factory produces.',
    );
    continue;
  }
  const [, mountPath, bound] = mount;
  const imp = new RegExp(`import\\s+${bound}\\s+from\\s+['"]([^'"]+)['"]`).exec(tplIndex);
  if (!imp) {
    problems.push(
      `${tpl.dirRel}/src/index.ts mounts \`${bound}\` at ${mountPath} and never imports it. An unbound mount is a ` +
        'Worker that does not build, stamped into every future app.',
    );
    continue;
  }
  const routeRel = `${tpl.dirRel}/src/${imp[1].replace(/^\.\//, '')}.ts`;
  const routeAbs = join(tpl.dir, 'src', `${imp[1].replace(/^\.\//, '')}.ts`);
  if (!existsSync(routeAbs)) {
    problems.push(`${tpl.dirRel}/src/index.ts mounts an erasure route from ${imp[1]}, and ${routeRel} does not exist.`);
    continue;
  }
  // ⚠️ COMMENTS STRIPPED, STRING LITERALS KEPT — the same deliberate inversion
  // as limb 3(b) below the live loop, and for the same reason: the things
  // asserted here ARE string literals (`'asymmetric'`, and the table names in
  // whatever list the route carries). Stripping them would make T1 and T3(b)
  // unfailable. Comments still go, so the paragraph explaining a rule cannot be
  // mistaken for the rule being kept.
  const tplRoute = readCode(routeAbs);

  // ── T1 · the route's table set covers the template's own schema ───────────
  // 🔴 THIS IS LIMB 1'S QUESTION, ASKED WITHOUT THE REGISTER. `{{app_id}}_db` is
  // not a database and has no inventory row, so the two template files are
  // compared to each other instead. Two acceptable answers, and the first is the
  // one both shipped routes give:
  //   · the route DERIVES its set from the schema (`sqlite_master`), in which
  //     case a new table is covered by its migration alone; or
  //   · the route carries a list, in which case every user-owned table in the
  //     template's migrations must be IN it.
  const derivesFromSchema = /\bsqlite_master\b|\bsqlite_schema\b/.test(tplRoute);
  for (const table of [...tplUserOwned].sort()) {
    templateTablesChecked++;
    if (derivesFromSchema) continue;
    if (new RegExp(`['"\`]${table}['"\`]`).test(tplRoute)) continue;
    problems.push(
      `${routeRel} does not reach \`${table}\`, which the template's own migrations give a \`user_id\`. The route ` +
        'carries a hand-maintained table list rather than deriving the set from `sqlite_master` the way both ' +
        'shipped routes do, so a table added to the starter schema without the SAME diff editing this list is ' +
        'orphaned PII in every app stamped from here — and the failure is silent: the route answers `{ ok: true }` ' +
        'and the rows stay. Add the table to the list, or derive the set from the schema.',
    );
  }

  // ── T3 · the same limb 3, on the template ─────────────────────────────────
  const tplAuthPath = join(tpl.dir, 'src', 'middleware', 'auth.ts');
  if (!existsSync(tplAuthPath)) {
    problems.push(
      `${tpl.dirRel} mounts an erasure route and has no src/middleware/auth.ts, so this scan cannot tell what ` +
        'authenticates it in any app stamped from here. An unreadable auth boundary is not a passing one.',
    );
  } else {
    const tplDecls = declarations(stripStringLiterals(readCode(tplAuthPath)));
    if (tplDecls.size === 0) {
      coverageLost([
        `no top-level declaration was parsed out of ${tpl.dirRel}/src/middleware/auth.ts.`,
        'T3 decides which middleware can fall back to a shared secret by following the calls between those',
        'declarations. With none parsed the template is judged fallback-free — the same answer a broken parse',
        'gives and a safe template gives, and they must not print the same.',
      ]);
    }
    const tplFallback = [...tplDecls.keys()].filter((n) => reaches(tplDecls, n, 'SUPABASE_JWT_SECRET'));
    if (tplFallback.length === 0) {
      // PRINTED, never silently skipped — and NOT a coverage failure: a template
      // with no symmetric path at all is the end state this guard pushes towards.
      notes.push(
        `⬜ ${tpl.dirRel} — src/middleware/auth.ts never uses SUPABASE_JWT_SECRET, so the stamped erasure route ` +
          'has no symmetric fallback to be exposed to.',
      );
    } else {
      const tplGuards = [...tplIndex.matchAll(/\.use\(\s*['"]([^'"]*account[^'"]*)['"]\s*,\s*([A-Za-z_$][\w$]*)/g)];
      if (tplGuards.length === 0) {
        problems.push(
          `${tpl.dirRel}/src/index.ts mounts an erasure route and no path-scoped \`use('…account…', …)\` guards ` +
            'it. Every app stamped from this template would serve account deletion either unauthenticated or ' +
            `behind the shared HS256 secret (fallback-capable here: ${tplFallback.join(', ')}).`,
        );
      }
      for (const [, path, mw] of tplGuards) {
        if (tplFallback.includes(mw)) {
          problems.push(
            `${tpl.dirRel}: the template guards DELETE ${path} with \`${mw}\`, which reaches SUPABASE_JWT_SECRET. ` +
              'One leaked environment variable would then mint a deletion for any user of any app ever stamped ' +
              'from this brick. Guard it with a middleware that verifies asymmetrically and has no secret in scope.',
          );
        }
      }
    }
  }
  // (b) …and the stamped handler refuses on its own, because (a) is one line in
  // an index file a tidy-up can move — in fifty repositories at once, here.
  if (!/\btokenAssurance\b/.test(tplRoute)) {
    problems.push(
      `${routeRel} does not check \`tokenAssurance\`. The mounting is one line in an index file; without a ` +
        'refusal inside the stamped handler, moving it puts account deletion behind the shared secret in every ' +
        'app born from this template, with every test still green.',
    );
  } else if (!/!==\s*'asymmetric'/.test(tplRoute)) {
    problems.push(
      `${routeRel} reads \`tokenAssurance\` and does not refuse on \`!== 'asymmetric'\`. A check spelled ` +
        "`!== 'symmetric'` admits `undefined` — a route reached with no auth middleware at all — which is the " +
        'fail-OPEN spelling, stamped.',
    );
  }

  // ── T4 · the template declares the hook limb 4 matches on ─────────────────
  // NOT limb 4's relation: a stamped app's presence in APP_ERASURE_ENDPOINTS is
  // a provisioning act, and the template has no app id yet. What IS checkable is
  // that the hook exists — without `vars.APP_ID` every stamped backend fails
  // limb 4 on the day it lands, and the fix is a template edit either way.
  if (!tpl.appId) {
    problems.push(
      `${tpl.cfgRel} declares no \`vars.APP_ID\`, so no app stamped from it can be matched to the shared ` +
        "Worker's APP_ERASURE_ENDPOINTS — limb 4 fails on arrival for every one of them.",
    );
  }
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ erasure reach — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  A delete route that silently misses rows is worse than no delete route: the user is told');
  console.error('  their data is gone and stops asking. [pipeline K-7] · [ADR 027] · DPDP + both app stores.');
  process.exit(1);
}

for (const n of notes) console.log(n);
console.log(
  `ok  erasure reach — LIVE ROOT: ${userOwned.size} user-owned table(s) across ${owners.length} database-owning service(s), ` +
    `every one declaring a route that is really mounted (${routeFiles.size} route(s), ${migrationFilesRead} migration file(s) read)`,
);
console.log(
  `    ${strictBoundariesChecked} erasure route(s) sit on a Worker whose default middleware CAN fall back to ` +
    'SUPABASE_JWT_SECRET, and none of them is guarded by it — each also refusing on its own `tokenAssurance` check',
);
console.log(
  `    the entry point (services/${entry.id}) declares an erasure endpoint for every one of the ${appsWithRoutes.length} ` +
    `app Worker(s) that own a database, and names no app that is not there`,
);
// 🔴 THE TEMPLATE ROOT IS REPORTED SEPARATELY AND ITS BRANCH IS PRINTED. A
// second root folded into the counts above would be a union, and the reader
// could not tell an emptied template from a covered one.
console.log(
  `    TEMPLATE ROOT: ${templateOwners.length} stamped-Worker template(s) owning a database ` +
    `(${templateMigrationFilesRead} migration file(s) read, ${templateTablesChecked} user-owned table(s) proven reachable ` +
    'by the erasure route each stamp ships) — a defect here reaches every app the factory produces',
);
console.log(
  `    ${allConfigs.size} wrangler.jsonc enumerated across the whole tree, every one classified into a root ` +
    `(${liveConfigs.length} live, ${templateConfigs.length} template, 0 unclassified)` +
    (IS_FULL_CHECKOUT
      ? `; FULL CHECKOUT — the template floor was APPLIED, and the git ls-files cross-check ${
          existsSync(join(ROOT, '.git')) ? 'was APPLIED' : 'was SKIPPED (no .git at the root)'
        }`
      : '; NOT a full checkout (this guard\'s own file is absent under the root) — the template floor and the ' +
        'git cross-check were SKIPPED, and only the live root above was proven'),
);
