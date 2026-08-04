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
// The erasure routes carry no table list: they ask the schema which tables are
// user-owned. So for a table that HAS a `user_id`, "no route reaches it" never
// describes a hard problem — the sweep would cover it the moment a route existed.
// It describes a route somebody has not written. That is exactly the shape of gap
// that becomes permanent by being disclosed, so here it FAILS instead of printing.
// A store with genuinely nothing to address it (the Pages KV keyed by email
// address, which no code in this repository can delete) has no columns at all and
// is not in this guard's domain — the distinction is derived, not listed.
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
// ── THE DOMAIN, DERIVED ─────────────────────────────────────────────────────
// Services = every `services/*/wrangler.jsonc` that declares a `migrations_dir`,
// i.e. every Worker that OWNS a database. Nothing is exempt and nothing is
// listed. COVERAGE LOST if fewer than two are found (the shared Worker and at
// least one app Worker): a domain that has collapsed to one is the blind spot
// this guard was written to close, and an empty-domain scan prints ok.
//
// Usage:  node tooling/ci/assert-erasure-reach.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const SERVICES = join(ROOT, 'services');
const REGISTER = join(ROOT, 'tooling', 'legal', 'data-inventory.json');

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
  if (!/tokenAssurance/.test(routeCode)) {
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
  `ok  erasure reach — ${userOwned.size} user-owned table(s) across ${owners.length} database-owning service(s), ` +
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
