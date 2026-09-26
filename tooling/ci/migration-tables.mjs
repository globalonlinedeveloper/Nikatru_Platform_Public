#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// migration-tables.mjs — THE ONE READING OF "what tables does this database
// have, and what columns does each one carry".
//
// It exists because [pipeline B-17] has two limbs that must range over the SAME
// table set or the pair is worthless: a secretless GATE
// (tooling/ci/assert-prod-provenance.mjs) that every table declares a provenance
// rule, and a credentialled MONITOR (tooling/ops/check-prod-provenance.mjs) that
// counts the rows in production which do not satisfy it. Two copies of "the
// tables" drift in the one way that reports clean — the monitor checks four
// tables, the gate demands rules for ten, and the six with rules nobody applies
// look exactly like six tables with nothing wrong.
//
// 🔴 THE NUMBER IS THE POINT. B-17's own prose names FOUR shared tables
// (`events`, `consent_artifacts`, `entitlements`, `cron_heartbeat`) and says
// "enumerated from services/platform/migrations/". Those two clauses stopped
// agreeing on 2026-08-01: 0004_money_rail.sql added four, 0005 added one, and
// the migrations now create NINE. A hardcoded list of four would have gone stale
// three days after it was written and printed "ok" the whole time. So the list
// is derived, every time, and a table with no rule is a build failure.
//
// ── WHY A REAL PARSE AND NOT A GREP ─────────────────────────────────────────
// Comments are stripped before the DDL scan, because this repository has already
// shipped a guard that matched the comment explaining why a thing did NOT exist
// (`grep '"r2_buckets"'` against the template comment saying there are none).
// 0004_money_rail.sql contains the literal text `CREATE TABLE` inside a comment
// at :52 — a grep-based enumerator reads that comment as a table.
//
// String literals are stripped for the DDL pass and KEPT for the seed pass. The
// seeded reference rows in `revocation_reasons` ARE string literals: stripping
// them for that pass would leave the allowed set empty, which is the empty
// predicate B-17's original acceptance criterion was rejected for.
//
// Callers own the COVERAGE LOST decision — this module reports what it read
// (`filesRead`, `tables.size`) and never exits. Its own failing cases are in
// tooling/ci/test/prod-provenance.test.mjs.
//
// ⏱ 2026-09-26 · O-PROVENANCE-WALKS-ONE-DATABASE. The table set is per
// database, and WHICH databases is read here too (`registeredD1Databases`,
// below), for the same reason: the gate and the monitor must walk one set.
// Until today both read one hard-coded wrangler path, so a table added to
// subscriptiontracker_db was seen by neither limb.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

/** Words that begin a table CONSTRAINT rather than a column definition. */
const CONSTRAINT_HEADS = new Set([
  'primary', 'unique', 'foreign', 'check', 'constraint', 'exclude',
]);

/** Split on commas that sit at nesting depth 0. `NUMERIC(10, 2)` is one column. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** From `text`, starting at the index of an opening `(`, return the balanced
 *  body and the index just past its `)`. Returns null on an unbalanced paren —
 *  which is a broken parse, never an empty table. */
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return { body: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Tokenise a SQL VALUES list into tuples of raw cell text. Handles `''` as an
 *  escaped quote inside a literal; the seeded descriptions in 0004 contain
 *  commas, parentheses and double quotes, all of which a regex would split on. */
function valueTuples(text) {
  const tuples = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (text[i] !== '(') break;
    let depth = 0;
    let inStr = false;
    const start = i;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "'") {
          if (text[i + 1] === "'") i++;
          else inStr = false;
        }
        continue;
      }
      if (c === "'") inStr = true;
      else if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    const inner = text.slice(start + 1, i - 1);
    tuples.push(splitSqlCells(inner));
  }
  return tuples;
}

/** Split one tuple's inner text into cells, respecting quotes and nesting. */
function splitSqlCells(inner) {
  const cells = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      if (c === "'") {
        if (inner[i + 1] === "'") i++;
        else inStr = false;
      }
      continue;
    }
    if (c === "'") inStr = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      cells.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  cells.push(inner.slice(start).trim());
  return cells;
}

/** `'refund_approved'` → `refund_approved`; a non-literal cell → null, so a
 *  seeded value computed by an expression is reported as unknown rather than
 *  silently admitted. */
export function sqlLiteral(cell) {
  const t = cell.trim();
  if (!t.startsWith("'") || !t.endsWith("'") || t.length < 2) return null;
  return t.slice(1, -1).replace(/''/g, "'");
}

/**
 * Enumerate every table a migrations directory creates.
 *
 * @param {string} dir absolute path to a `migrations_dir`
 * @returns {{tables: Map<string, {columns: Set<string>, createdIn: string, seeds: Map<string, Set<string>>}>,
 *            filesRead: number, problems: string[]}}
 */
export function enumerateMigrationTables(dir) {
  const tables = new Map();
  const problems = [];
  let filesRead = 0;

  if (!existsSync(dir)) return { tables, filesRead, problems: [`${dir} does not exist`] };

  for (const f of listDir(dir).filter((n) => n.toLowerCase().endsWith('.sql')).sort()) {
    filesRead++;
    const raw = readFileSync(join(dir, f), 'utf8');
    const bare = stripSourceComments(raw, '.sql'); // literals KEPT — the seed pass needs them
    const ddl = stripStringLiterals(bare); //         literals GONE — a table name in a string is not a table

    // ── CREATE TABLE ────────────────────────────────────────────────────────
    const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s*\(/gi;
    for (let m = create.exec(ddl); m !== null; m = create.exec(ddl)) {
      const name = m[1];
      const b = balanced(ddl, create.lastIndex - 1);
      if (b === null) {
        problems.push(`${f}: the CREATE TABLE body for \`${name}\` has unbalanced parentheses, so its columns could not be read`);
        continue;
      }
      const columns = new Set();
      for (const part of splitTopLevel(b.body)) {
        const tok = part.trim().split(/[\s(]/)[0].replace(/^["'`[]|["'`\]]$/g, '');
        if (!tok) continue;
        if (CONSTRAINT_HEADS.has(tok.toLowerCase())) continue;
        if (!/^[A-Za-z_][\w$]*$/.test(tok)) continue;
        columns.add(tok);
      }
      if (!tables.has(name)) tables.set(name, { columns, createdIn: f, seeds: new Map() });
      else for (const c of columns) tables.get(name).columns.add(c);
    }

    // ── ALTER TABLE … ADD COLUMN ────────────────────────────────────────────
    // 0006 reaches `provider_notifications.user_id` this way and 0004 gives
    // `entitlements` its whole provider half. A scan that only read CREATE TABLE
    // would declare `entitlements` has no `provider_environment` column and
    // reject the rule that names it.
    for (const m of ddl.matchAll(
      /ALTER\s+TABLE\s+["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s+ADD\s+(?:COLUMN\s+)?["'`[]?([A-Za-z_][\w$]*)/gi,
    )) {
      const t = tables.get(m[1]);
      if (t) t.columns.add(m[2]);
      else problems.push(`${f}: ALTER TABLE \`${m[1]}\` ADD COLUMN \`${m[2]}\` — no migration in this directory creates that table`);
    }

    // ── INSERT … VALUES (the seeded reference rows) ─────────────────────────
    for (const m of bare.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s*\(([^)]*)\)\s*VALUES/gi)) {
      const t = tables.get(m[1]);
      if (!t) continue;
      const cols = m[2].split(',').map((c) => c.trim().replace(/^["'`[]|["'`\]]$/g, ''));
      const rest = bare.slice(m.index + m[0].length);
      for (const tuple of valueTuples(rest)) {
        cols.forEach((col, idx) => {
          const lit = sqlLiteral(tuple[idx] ?? '');
          if (lit === null) return;
          if (!t.seeds.has(col)) t.seeds.set(col, new Set());
          t.seeds.get(col).add(lit);
        });
      }
    }
  }

  return { tables, filesRead, problems };
}

// ── ⏱ 2026-09-26 · WHICH DATABASES ──────────────────────────────────────────
// The Workers are tooling/platform-register.json's `servingWorker`, then each of
// its `appWorkers`, in that order. In each Worker's wrangler config, a database
// is every TOP-LEVEL `d1_databases` binding that carries `migrations_dir`: the
// Worker that applies a database's migrations owns it, and a binding without one
// is a reader of a database another Worker owns (the app Worker's PLATFORM_DB),
// so each database is counted once.
//
// 🔴 `env.<name>.d1_databases` IS NEVER READ. An environment block is not
// production: `env.sandbox` holds the store capture's throwaway databases, and
// B-17 is a walk of production. tooling/ci/test/prod-provenance-databases.test.mjs
// holds that exclusion to a failing case.
//
// A glob over services/*/wrangler.jsonc was rejected: the register is the
// declared Worker set (assert-platform-register.mjs holds it to every config
// that declares `main`), and a glob would admit a scratch Worker.

/** Where the Worker set is declared. */
export const PLATFORM_REGISTER_REL = 'tooling/platform-register.json';
/** The rule kind for a table whose columns carry no marker any resolver reads. */
export const EXEMPT = 'exempt';
/** The shortest reason an exemption may carry (it must also name every column). */
export const MIN_EXEMPTION_REASON = 20;

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** `// comment` and trailing commas — wrangler.jsonc is JSONC. */
const parseJsonc = (text) => JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));

/**
 * The D1 databases the platform register's Workers own.
 *
 * @param {string} root the repository root
 * @returns {{databases: Array<{name: string, id: string, binding: string, worker: string, serving: boolean,
 *            wrangler: string, migrationsDir: string, migrationsTable: string}>, problems: string[]}}
 *   `problems` non-empty means the set could not be read whole; callers own
 *   that verdict, exactly as for `enumerateMigrationTables`.
 */
export function registeredD1Databases(root) {
  const databases = [];
  const problems = [];
  let reg;
  try {
    reg = JSON.parse(readFileSync(join(root, PLATFORM_REGISTER_REL), 'utf8'));
  } catch (e) {
    return { databases, problems: [`${PLATFORM_REGISTER_REL} is unreadable (${e.message}), so which Workers own a database cannot be said`] };
  }
  if (!reg?.servingWorker) problems.push(`${PLATFORM_REGISTER_REL} names no \`servingWorker\``);
  if (reg?.appWorkers !== undefined && !Array.isArray(reg.appWorkers)) problems.push(`${PLATFORM_REGISTER_REL} \`appWorkers\` is not an array`);
  const workers = [reg?.servingWorker, ...(Array.isArray(reg?.appWorkers) ? reg.appWorkers : [])].filter(Boolean);
  for (const w of workers) {
    const rel = w?.config;
    if (typeof rel !== 'string' || rel.length === 0) {
      problems.push(`${PLATFORM_REGISTER_REL}: Worker \`${w?.name ?? '?'}\` names no \`config\``);
      continue;
    }
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(join(root, rel), 'utf8'));
    } catch (e) {
      problems.push(`${rel} could not be read or parsed (${e.message})`);
      continue;
    }
    for (const d of Array.isArray(cfg?.d1_databases) ? cfg.d1_databases : []) {
      if (!d?.migrations_dir) continue;
      const where = `${rel} binding \`${d.binding ?? '?'}\``;
      if (typeof d.database_name !== 'string' || typeof d.database_id !== 'string' || !d.database_name || !d.database_id) {
        problems.push(`${where} carries \`migrations_dir\` and no \`database_name\`/\`database_id\``);
        continue;
      }
      const migrationsTable = d.migrations_table ?? 'd1_migrations';
      if (typeof migrationsTable !== 'string' || !SAFE_IDENTIFIER.test(migrationsTable)) {
        problems.push(`${where} names \`migrations_table\` ${JSON.stringify(migrationsTable)}, which no reader will quote into SQL`);
        continue;
      }
      const twin = databases.find((x) => x.name === d.database_name);
      if (twin) {
        problems.push(`\`${d.database_name}\` carries \`migrations_dir\` in both ${twin.wrangler} and ${rel}, so two Workers claim to apply its migrations`);
        continue;
      }
      databases.push({
        name: d.database_name,
        id: d.database_id,
        binding: String(d.binding ?? ''),
        worker: String(w.name ?? ''),
        serving: w === reg.servingWorker,
        wrangler: rel,
        migrationsDir: posix.normalize(posix.join(posix.dirname(rel), String(d.migrations_dir))),
        migrationsTable,
      });
    }
  }
  if (databases.length === 0 && problems.length === 0) {
    problems.push(`no Worker ${PLATFORM_REGISTER_REL} names declares a top-level D1 binding carrying \`migrations_dir\``);
  }
  return { databases, problems };
}

/**
 * PURE. The derived set against tooling/prod-provenance.json's `databases`, both
 * ways: `unregistered` (derived, no entry — its tables would go unread),
 * `stale` (an entry nothing derives) and `mismatched` (an entry whose
 * `wrangler` or `migrationsDir` is not the owning config's).
 */
export function databaseLock(derived, registered) {
  const reg = registered !== null && typeof registered === 'object' && !Array.isArray(registered) ? registered : {};
  const has = (n) => Object.prototype.hasOwnProperty.call(reg, n);
  const unregistered = derived.filter((d) => !has(d.name)).map((d) => `${d.name} (${d.wrangler} binding \`${d.binding}\`)`);
  const stale = Object.keys(reg).filter((n) => !derived.some((d) => d.name === n));
  const mismatched = [];
  for (const d of derived.filter((x) => has(x.name))) {
    for (const key of ['wrangler', 'migrationsDir']) {
      if (reg[d.name]?.[key] !== d[key]) mismatched.push(`${d.name}.${key} is ${JSON.stringify(reg[d.name]?.[key])}, and the owning config gives ${JSON.stringify(d[key])}`);
    }
  }
  return { unregistered, stale, mismatched };
}

/**
 * PURE. Why an `exempt` rule is not an exemption, or null when it is one: no
 * marker (it reads no column), a reason of MIN_EXEMPTION_REASON+ characters,
 * and every column the migrations give the table named in that reason — so the
 * argument is about this column set, and a column added later re-opens it.
 */
export function exemptionProblem(table, rule, columns) {
  if (rule?.resolver !== EXEMPT) return null;
  if (rule.marker !== undefined) return `\`${table}\` is ${EXEMPT} and declares marker \`${rule.marker}\`: an exempt table reads no column, so the marker is a rule nobody applies`;
  const reason = typeof rule.reason === 'string' ? rule.reason.trim() : '';
  if (reason.length < MIN_EXEMPTION_REASON) {
    return `\`${table}\` is ${EXEMPT} with a reason of ${reason.length} character(s); an exemption needs ${MIN_EXEMPTION_REASON}+, naming the columns that carry no marker`;
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const unnamed = [...columns].filter((c) => !new RegExp(`(^|[^A-Za-z0-9_])${esc(c)}([^A-Za-z0-9_]|$)`).test(reason));
  if (unnamed.length) {
    return `\`${table}\` is ${EXEMPT} and its reason never names ${unnamed.map((c) => `\`${c}\``).join(', ')}: an exemption names every column the migrations give the table`;
  }
  return null;
}

/** The files `registeredD1Databases` and the enumeration read, relative to
 *  `root`: the platform register, each owning config, each migrations dir. For
 *  a test that copies the real tree into a fixture root. */
export function databaseSources(root) {
  const { databases } = registeredD1Databases(root);
  return [...new Set([PLATFORM_REGISTER_REL, ...databases.flatMap((d) => [d.wrangler, d.migrationsDir])])];
}
