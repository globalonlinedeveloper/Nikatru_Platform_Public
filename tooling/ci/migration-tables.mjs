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
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
