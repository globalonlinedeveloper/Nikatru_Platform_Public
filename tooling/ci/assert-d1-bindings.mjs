#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-d1-bindings.mjs — a deployable Worker may not point at a database that
// does not exist, and two Workers naming one database must mean the same one.
//
// [pipeline S-12] Private/company/pipeline/03-stamper.md — limb 1 of the replacement
// acceptance ("no stamped or committed config contains the all-zeros
// placeholder"), plus a consistency check the spec did not ask for and the tree
// needed.
//
// ⚠️ WHY LIMB 1 IS NOT IMPLEMENTED AS WRITTEN. Taken literally — "no committed
// config contains the placeholder" — this guard would fail on
// `tooling/bricks/.../{{app_id}}-api/wrangler.jsonc`, which contains
// `00000000-0000-0000-0000-000000000000` **correctly**: it is a TEMPLATE, and
// the real id does not exist until an app is stamped and provisioned. A rule
// that fires on correct input is the defect CLAUDE.md records as "an invented
// limit fires on CORRECT input" — it gets switched off, and then it guards
// nothing. So the subject is DEPLOYABLE configs under `services/`, and the brick
// template is out of scope by construction rather than by an allowlist entry
// somebody could extend.
//
// ── THE SECOND CHECK, WHICH IS THE ONE WITH TEETH TODAY ─────────────────────
// `subly_db` is declared in BOTH `services/subly-api` and `services/platform`;
// so is `platform_db`. Nothing verified the uuids agreed. A copy-paste slip
// there does not error — the Worker deploys, runs, and reads and writes the
// WRONG DATABASE, silently. That is the same shape as every other defect this
// repo has paid for: correct-looking config, no error, wrong data. Both
// directions are checked, because a name pointing at two ids and an id
// answering to two names are different mistakes.
//
// ── WHAT THIS GUARD DELIBERATELY DOES NOT DO ────────────────────────────────
// It does not call Cloudflare. Putting a live API call here would make CI need a
// secret, which forks and PRs do not have — so the lane would fail for people
// rather than for defects. The live half (does this uuid really exist, with this
// name?) was verified by hand on 2026-07-29 against the account: platform_db =
// 9d1c5c63-97fe-4f82-bc7d-f3fd22e9b351, subly_db = 88da9026-f72a-4cda-823d-
// 431148fa8112, both present, both matching. That is recorded in [3]S-12 rather
// than automated, and the automation that WOULD need it is the provisioning
// script, which runs with the owner's token by design.
//
// Usage:  node tooling/ci/assert-d1-bindings.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? process.cwd());
const SERVICES = join(ROOT, 'services');

/** The value the brick stamps so a human notices it. Deployable config must not
 *  keep it — that is the whole of limb 1. */
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A scan finding no service, or no binding, has stopped scanning. Both are
 *  relationships to the tree rather than tuned numbers: services are counted
 *  from disk, and a service with a d1 binding must yield at least one. */
const MIN_SERVICES = 1;

function fail(lines) {
  for (const l of lines) console.error(l);
  process.exit(1);
}

if (!existsSync(SERVICES)) {
  fail([`✗ COVERAGE LOST — no services/ directory at ${SERVICES}. The scan is broken, not the tree.`]);
}

/** JSONC → JSON. Comments are STRIPPED before parsing, never scanned: this repo
 *  has already shipped a guard that matched the template comment explaining why
 *  there is no `r2_buckets`. String literals are respected so a `//` inside a
 *  url is not mistaken for a comment. */
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
  // trailing commas are legal in jsonc and fatal to JSON.parse
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try {
    return JSON.parse(out);
  } catch (err) {
    fail([`✗ ${where} — could not be parsed after stripping comments: ${err.message}`]);
  }
}

const services = listDir(SERVICES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)
  .sort();

if (services.length < MIN_SERVICES) {
  fail([`✗ COVERAGE LOST — found ${services.length} service(s) under services/, expected at least ${MIN_SERVICES}.`]);
}

const problems = [];
const byName = new Map(); // database_name -> [{id, where}]
const byId = new Map(); // database_id   -> [{name, where}]
let bindingCount = 0;
let configCount = 0;

for (const svc of services) {
  const candidates = ['wrangler.jsonc', 'wrangler.json'].map((f) => join(SERVICES, svc, f));
  const cfgPath = candidates.find((p) => existsSync(p));
  if (!cfgPath) continue;
  configCount++;
  const where = posix.join('services', svc, cfgPath.endsWith('.jsonc') ? 'wrangler.jsonc' : 'wrangler.json');
  const cfg = parseJsonc(readFileSync(cfgPath, 'utf8'), where);
  for (const b of cfg.d1_databases ?? []) {
    bindingCount++;
    const name = b.database_name;
    const id = b.database_id;
    const label = `${where} → ${b.binding ?? '<no binding>'}`;

    if (!id) {
      problems.push(`${label} — declares database "${name ?? '?'}" with NO \`database_id\`.`);
      continue;
    }
    if (id === PLACEHOLDER) {
      problems.push(
        `${label} — still carries the all-zeros placeholder \`${PLACEHOLDER}\`. [S-12] This is a ` +
          'DEPLOYABLE config, not the brick template: a Worker deployed like this reaches production ' +
          'pointing at nothing, and `wrangler deploy --dry-run` passes on it because a dry run never ' +
          'contacts D1 — which is exactly why the criterion that asked for a dry run could not fail.',
      );
      continue;
    }
    if (!UUID.test(id)) {
      problems.push(`${label} — \`database_id\` "${id}" is not a uuid.`);
      continue;
    }
    if (name) {
      byName.set(name, [...(byName.get(name) ?? []), { id, where: label }]);
      byId.set(id, [...(byId.get(id) ?? []), { name, where: label }]);
    }
  }
}

if (configCount === 0 || bindingCount === 0) {
  fail([
    `✗ COVERAGE LOST — scanned ${services.length} service(s) and found ${configCount} wrangler config(s)`,
    `  with ${bindingCount} d1 binding(s). Every check below would range over nothing and report success.`,
  ]);
}

// ── the consistency half: one name, one database — in both directions ────────
for (const [name, uses] of byName) {
  const ids = [...new Set(uses.map((u) => u.id))];
  if (ids.length > 1) {
    problems.push(
      `database "${name}" is declared with ${ids.length} DIFFERENT ids across configs — ` +
        `${uses.map((u) => `${u.where}=${u.id}`).join(', ')}. One of these Workers is talking to the ` +
        'wrong database, and nothing about that fails loudly: it deploys, it runs, and it reads and ' +
        'writes the wrong data.',
    );
  }
}
for (const [id, uses] of byId) {
  const names = [...new Set(uses.map((u) => u.name))];
  if (names.length > 1) {
    problems.push(
      `database id ${id} is declared under ${names.length} DIFFERENT names (${names.join(', ')}) — ` +
        `${uses.map((u) => u.where).join(', ')}. A rename that only half landed looks exactly like this.`,
    );
  }
}

if (problems.length) {
  console.error(`✗ d1 bindings — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline S-12] a deployable Worker points at a real database, and two Workers');
  console.error('  naming one database mean the same one.');
  process.exit(1);
}

for (const [name, uses] of byName) {
  console.log(`    ${name} → ${uses[0].id} (${uses.length} binding(s))`);
}
console.log(
  `ok  d1 bindings — ${bindingCount} binding(s) across ${configCount} deployable config(s); ` +
    `${byName.size} distinct database(s), every id a uuid, none placeholder, names and ids agree`,
);
