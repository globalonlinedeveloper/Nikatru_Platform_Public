// ─────────────────────────────────────────────────────────────────────────────
// d1-stores.mjs — THE D1 walk: which live wrangler configs exist, and which D1
// databases each one OWNS (the config that declares `migrations_dir`), with the
// tables its migrations create.
//
// ⏱ 2026-09-26 (O-SERVICE-KIT-UNBUILT, E-b2). MOVED, not copied, out of
// tooling/ci/assert-retention-coverage.mjs, which imports it and re-exports
// `parseJsonc`, `findWranglerConfigs` and `tablesIn` so its importers are
// unchanged. Its readers:
//   · assert-retention-coverage.mjs — every owned table is a store that needs a
//     retention rule;
//   · tooling/scripts/provision-backend.mjs `--check` — each registered Worker's
//     owned databases must carry a tooling/legal/data-inventory.json row.
// One walk for both. assert-prod-provenance.mjs reads the register's Workers
// instead (tooling/ci/migration-tables.mjs `registeredD1Databases`, pg1): the
// two agree while every services/ Worker has a register row, which
// provision-backend.mjs --check and worker-set.mjs --for-deploy require.
//
// NOT A GUARD. It sets no exit code and prints nothing: a caller passes `lost`,
// which it calls with the lines of a COVERAGE LOST (and which is expected to
// end the run), exactly as assert-retention-coverage.mjs's walk always did.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { listDir } from './tree-walk.mjs';

export function parseJsonc(text) {
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
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Live wrangler configs. `bricks/` is a mustache TEMPLATE, not a deployed
 *  surface — excluded by name, and the exclusion is REPORTED rather than
 *  silent, because a silent exclusion is how a domain shrinks unnoticed. */
export function findWranglerConfigs(root) {
  const found = [];
  const excluded = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = listDir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'build') continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else if (/^wrangler\.(jsonc|json|toml)$/.test(e.name)) (r.includes('bricks/') ? excluded : found).push(r);
    }
  };
  walk(root, '');
  return { found: found.sort(), excluded: excluded.sort() };
}

/**
 * SQL is stripped of comments AND string literals before the CREATE TABLE scan.
 * A `-- CREATE TABLE …` in a header comment, or a table name inside a quoted
 * string, would otherwise enter the domain as a store that does not exist — the
 * same class as the grep that matched the comment explaining why there is no
 * r2_buckets.
 */
export function tablesIn(sql) {
  let s = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return [...s.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?(\w+)["'`]?/gi)].map((m) => m[1]);
}

/**
 * The D1 databases ONE parsed config owns. `rel` is the config's path from
 * `root`. Returns `{ bindings, owned }`: `bindings` counts every d1_databases
 * entry (owned or not), and each `owned` entry is
 * `{ config, binding, databaseName, migrationsDir, files: [{ file, tables }] }`,
 * `migrationsDir` being the directory's path from `root` (posix).
 */
export function ownedD1(root, rel, cfg, lost) {
  const owned = [];
  let bindings = 0;
  for (const db of cfg?.d1_databases ?? []) {
    bindings++;
    // Only the config that OWNS the migrations enumerates the tables. A DB
    // bound read/write elsewhere for a fan-out is the same store, not a second
    // one — counting it twice would inflate coverage with duplicates.
    if (!db?.migrations_dir || !db?.database_name) continue;
    const migDir = join(root, dirname(rel), db.migrations_dir);
    if (!existsSync(migDir)) {
      lost([
        `${rel} declares \`migrations_dir: ${db.migrations_dir}\` for ${db.database_name} and that directory does not exist.`,
        'Every table in that database would silently leave the domain.',
      ]);
    }
    const sqls = listDir(migDir).filter((f) => f.endsWith('.sql'));
    if (sqls.length === 0) {
      lost([`${rel}'s migrations directory ${db.migrations_dir} contains no .sql file, so ${db.database_name} contributes no tables.`]);
    }
    const files = [];
    for (const f of sqls) {
      files.push({ file: f, tables: tablesIn(readFileSync(join(migDir, f), 'utf8')) });
    }
    owned.push({
      config: rel,
      binding: db.binding,
      databaseName: db.database_name,
      migrationsDir: posix.normalize(posix.join(posix.dirname(rel), db.migrations_dir)),
      migrationsDirDeclared: db.migrations_dir,
      files,
    });
  }
  return { bindings, owned };
}

/**
 * Every owned D1 across every live config under `root`. `lost` as above; a
 * config that does not parse is a COVERAGE LOST, never a skip.
 */
export function ownedD1Stores(root, lost) {
  const { found, excluded } = findWranglerConfigs(root);
  const owned = [];
  let bindings = 0;
  for (const rel of found) {
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(root, rel), 'utf8'));
    } catch (e) {
      lost([`${rel} could not be parsed (${e.message}), so its bindings are invisible to this scan.`]);
    }
    const r = ownedD1(root, rel, cfg, lost);
    bindings += r.bindings;
    owned.push(...r.owned);
  }
  return { configs: found, excluded, bindings, owned };
}
