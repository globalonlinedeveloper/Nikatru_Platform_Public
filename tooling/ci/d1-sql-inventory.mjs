// ─────────────────────────────────────────────────────────────────────────────
// d1-sql-inventory.mjs — ONE reading of "what SQL does this repository send to
// D1, and what shape is it".
//
// (Written as LINE comments, not a block one, for the reason text-reductions.mjs
// gives: the delimiters are part of the subject here too.)
//
// 🔴 THIS IS NOT A GUARD. It is the shared extraction two guards depend on —
// tooling/ci/assert-d1-sql-inventory.mjs (static, secretless, ci.yml) and
// tooling/ops/check-d1-accepts-live-sql.mjs (live, credentialled, the deploy
// jobs + ops-watch). Two copies of a SQL reader drift in the one way that
// reports "clean", which is WHICH STATEMENTS THEY CAN SEE, so there is one.
//
// ── THE DEFECT IT EXISTS FOR ────────────────────────────────────────────────
// 🔴 EVERY IN-APP ACCOUNT DELETION IN PRODUCTION FAILED FOR MONTHS AND NO CHECK
// COULD SEE IT. Both erasure routes derived their table set from a single
// correlated join, `FROM sqlite_master m JOIN pragma_table_info(m.name) p`. D1's
// authorizer rejects that at RUNTIME — error 7500, `not authorized:
// SQLITE_AUTH` — so the route threw before reading a row and answered
// 503 `account_deletion_failed`. The local suite could not reproduce it
// (`node:sqlite` has no D1 authorizer and accepts the join), and
// assert-erasure-reach.mjs proves reachability by parsing MIGRATION FILES, so a
// query D1 refuses to run looks perfectly reachable to it. Nothing in CI ever
// executed a statement.
//
// ── WHY COMMENTS COME OFF FIRST, AND IT IS NOT HYGIENE ──────────────────────
// 🔴 BOTH FIXED ROUTE FILES STILL CONTAIN THE REJECTED JOIN IN PROSE — it is the
// header paragraph explaining what was removed. A raw grep for the outage finds
// it in the FILE THAT NO LONGER HAS IT, which is the r2_buckets mistake exactly:
// a comment explaining that something never happens matching a pattern looking
// for it happening. stripSourceComments runs before a single literal is read.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { stripSourceComments } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// THE PROHIBITION, AS MEASURED RATHER THAN AS REMEMBERED.
//
// 🔬 Measured 2026-08-09 against BOTH production databases over the D1 HTTP API,
// ten statement shapes each, identical verdicts on both:
//
//   REJECTED (7500 SQLITE_AUTH)   direct join · EXISTS subquery · CTE ·
//                                 correlated scalar subquery · the same join
//                                 spelled `sqlite_schema`
//   ACCEPTED                      pragma fed a LITERAL · pragma fed a BOUND
//                                 parameter · pragma fed a VALUES list ·
//                                 a plain sqlite_master read ·
//                                 EXPLAIN of the rejected join
//
// So the rule is about ONE STATEMENT NAMING BOTH THINGS, not about where the
// pragma's argument comes from. The three files that shipped with this change
// said "a table-valued function whose argument is a COLUMN of another table is
// not allowed" — which the VALUES case and the bound-parameter case both
// falsify, and which would have licensed the CTE rewrite as a fix. Corrected in
// all three, and pinned by [R4] so the prose and this constant cannot drift.
//
// ⚠️ `EXPLAIN` IS ACCEPTED, WHICH IS WHY THE LIVE HALF EXECUTES. EXPLAIN returns
// bytecode without running the authorizer, so a checker built on it would have
// reported the outage query healthy.
// ─────────────────────────────────────────────────────────────────────────────

/** Names of the schema table, both spellings SQLite answers to. */
const SCHEMA_TABLE = /\bsqlite_(?:master|schema)\b/i;
/** A `pragma_*` table-valued function CALL (not the `PRAGMA x` statement form). */
const PRAGMA_TVF = /\bpragma_[A-Za-z_]+\s*\(/i;
/** The statement form, which reads the same schema by another route. */
const PRAGMA_STATEMENT = /^\s*PRAGMA\b/i;

/**
 * The measured prohibition, applied to one statement.
 *
 * ⚠️ CONSERVATIVE IN ONE NAMED DIRECTION: it treats a literal as one statement.
 * A literal holding two `;`-separated statements, one naming sqlite_master and
 * the other calling a pragma, would be refused here and accepted by D1. No such
 * literal exists in this repository (the inventory prints the count, so a first
 * one would be visible), and the alternative — splitting SQL on `;` — is wrong
 * inside string literals, which is a worse failure than a visible false
 * positive. Stated rather than discovered later.
 */
export function violatesD1Authorizer(sql) {
  return SCHEMA_TABLE.test(sql) && PRAGMA_TVF.test(sql);
}

/** True when a statement asks the database about its own schema. */
export function isIntrospective(sql) {
  return SCHEMA_TABLE.test(sql) || PRAGMA_TVF.test(sql) || PRAGMA_STATEMENT.test(sql);
}

/** A statement that can change rows — the set the live half must run with a key
 *  that matches nothing and then assert `changes === 0` over. */
export function isMutating(sql) {
  return /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i.test(sql);
}

/**
 * THE STATEMENT THE LIVE HALF SENDS AS ITS NEGATIVE CONTROL, verbatim, before
 * it believes anything else it is told.
 *
 * 🔴 A HARNESS THAT IS NOT TALKING TO A REAL AUTHORIZER MUST NEVER WAVE
 * ANYTHING THROUGH. Every "accepted" verdict below is evidence only if a
 * statement KNOWN to be refused is refused on the same connection, in the same
 * run, against the same database. Without it, a token scoped to the wrong
 * account, a stubbed endpoint or a D1 that stopped enforcing would all report
 * a clean bill of health over statements it never judged.
 *
 * This is the outage query as it stood in both routes before #256.
 */
export const REJECTED_FIXTURE =
  "SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'";

/**
 * What D1 answers for it.
 *
 * 🔴 `7500` IS D1's GENERIC QUERY-ERROR CODE AND MATCHING ON IT ALONE IS WRONG.
 * Measured 2026-08-09 against subly_db, same code, three different meanings:
 *
 *   7500  not authorized: SQLITE_AUTH                     ← the authorizer
 *   7500  near "WHERE": syntax error at offset 33: SQLITE_ERROR
 *   7500  no such column: nope at offset 7: SQLITE_ERROR
 *
 * The live half matched on the code first and reported a statement it had
 * mis-instantiated (its own bug, a syntax error) as "D1's authorizer will not
 * run this" — the loudest possible false positive, on the one guard whose worth
 * depends on being believed. The MESSAGE is what distinguishes them.
 */
export const REJECTION_CODE = 7500;
export const REJECTION_MESSAGE = 'not authorized: SQLITE_AUTH';

/**
 * THE CAUSE SENTENCE, WRITTEN ONCE.
 *
 * [R4] requires it, normalised, inside every source file that explains this
 * rejection to a reader. Prose that is not pinned drifts — the sentence it
 * replaces was wrong in all three files simultaneously, and each copy made the
 * other two look corroborated.
 */
export const MEASURED_CAUSE =
  'any single statement that names sqlite_master/sqlite_schema AND calls a pragma_* ' +
  'table-valued function is rejected — join, subquery, CTE and correlated scalar ' +
  // (chunked so no fragment of this constant OPENS with a SQL keyword: the scan
  // below reads string literals, and a piece starting `pragma fed a literal …`
  // read as a statement in this very file on its first run.)
  'subquery alike (measured 2026-08-09 against both production databases). ' +
  'The same pragma fed a literal, a bound parameter or a VALUES list is accepted, ' +
  'and so is a plain sqlite_master read.';

/** Comment markers and wrapping removed, whitespace collapsed. [R4] compares on
 *  this reduction so the sentence may be re-wrapped to each file's column width
 *  without the pin becoming a fight about line breaks. */
export function normaliseProse(text) {
  return String(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(/(?:^|\s)(?:\/\/+|\*+|#+)\s?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SCAN
//
// Two walks over the SAME comment-stripped source, because they answer different
// questions and neither subsumes the other:
//
//   scanSqlLiterals     every string/template literal that IS a SQL statement.
//                       Wider than the call-anchored walk on purpose: the e2e
//                       and ops harnesses pass SQL to their own local helpers
//                       (`d1(sql, params)`, `queryD1(dbId, sql)`), so anchoring
//                       on `.prepare(` would have scanned the Workers and missed
//                       every statement the harnesses send to the same databases.
//
//   scanPreparedCalls   every `.prepare(` / `.exec(` / `.batch(` call, INCLUDING
//                       the ones whose argument is not a literal this file can
//                       read. That is the only walk that can know a statement
//                       exists which the first walk cannot see — wrap a
//                       `.prepare` in a helper and the literal walk simply finds
//                       less, silently. Those are `unparsed`, and they are
//                       REPORTED, never dropped.
// ─────────────────────────────────────────────────────────────────────────────

// A statement, not a word. The trailing `\s` requirement is load-bearing: both
// route files pass the HTTP method `'DELETE'` to fetch(), and a bare opener
// matched it — three phantom statements in the first run of this scan, one of
// them inside the very erasure route the inventory is about.
const SQL_OPENER =
  /^(?:WITH|SELECT|INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|EXPLAIN|VACUUM|ANALYZE|BEGIN|COMMIT)\s+\S/i;

// …AND A SECOND STRUCTURAL KEYWORD, because an opener alone is an English word.
// Measured on the first full run of this scan: `with {n} d1 binding(s). Every
// check below…` (another guard's coverage-loss message), `with a bare directory
// […]` (a workflow explanation) and three `DELETE /androidpublisher/v3/…` HTTP
// request lines all read as SQL. Prose that opens with a verb is common; prose
// that also contains FROM/INTO/SET/VALUES in the same breath is not.
//
// ⚠️ THE PHRASE THIS FILE MUST NOT CONTAIN, spelled around rather than quoted:
// assert-guard-coverage.mjs reads this file's RAW source for the marker every
// scanning guard uses, and a module listed in its NOT_A_SCANNER map that
// contains that marker is a contradiction it fails on — which is right, and
// which the sentence above triggered by describing the marker instead of using
// it. Prose satisfying a check, in the direction that cries wolf.
const SQL_CORROBORATION = /\b(?:FROM|INTO|SET|VALUES|TABLE|WHERE|COLUMN|INDEX|VIEW|TRIGGER|DATABASE|SELECT)\b/i;

const looksLikeStatement = (sql) => SQL_OPENER.test(sql) && SQL_CORROBORATION.test(sql);

/** Identifiers after which a `/` opens a REGEX rather than dividing. Same
 *  question text-reductions.mjs answers, asked again because that module's
 *  tokenizer is private and this walk needs the literal's contents, which that
 *  one blanks. `/['"`[]?/` in a guard file would otherwise open a template
 *  literal and swallow the rest of the file. */
const REGEX_MAY_FOLLOW = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case',
  'do', 'else', 'yield', 'await', 'throw',
]);

/** A `${…}` hole rendered into the SQL. `{{` cannot occur in SQL, so the
 *  placeholder cannot collide with a statement's own text. */
export const holePlaceholder = (i) => `{{${i}}}`;

/**
 * Read the literal starting at `start`. Returns `null` when it does not
 * terminate — ERRING TOWARDS NOT-A-LITERAL, the same direction
 * text-reductions.mjs chose: the worst case is a statement this walk does not
 * see, and the prepared-call walk reports exactly that class as `unparsed`.
 */
function readLiteral(code, start) {
  const quote = code[start];
  const template = quote === '`';
  const n = code.length;
  let i = start + 1;
  let text = '';
  const holes = [];
  while (i < n) {
    const c = code[i];
    if (c === '\\') {
      text += code.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === quote) return { text, holes, end: i + 1 };
    if (!template && c === '\n') return null; // an unterminated quote
    if (template && c === '$' && code[i + 1] === '{') {
      const close = matchBrace(code, i + 1);
      if (close === -1) return null;
      text += holePlaceholder(holes.length);
      holes.push(code.slice(i + 2, close - 1).trim());
      i = close;
      continue;
    }
    text += c;
    i++;
  }
  return null;
}

/** End of the `{…}` run starting at `open` (one past the closing brace), or -1.
 *  Quoted runs inside are skipped so a `}` in a string does not close it. */
function matchBrace(code, open) {
  const n = code.length;
  let depth = 0;
  let i = open;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const lit = readLiteral(code, i);
      if (!lit) return -1;
      i = lit.end;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/** End of a regex literal (flags included), or -1 if that `/` was division. */
function skipRegex(code, start) {
  const n = code.length;
  let i = start + 1;
  let inClass = false;
  while (i < n) {
    const c = code[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '\n') return -1;
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < n && /[a-z]/i.test(code[i])) i++;
      return i;
    }
    i++;
  }
  return -1;
}

/** 1-based line number of a byte offset. */
export function lineOf(code, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < code.length; i++) if (code[i] === '\n') line++;
  return line;
}

/**
 * Every SQL statement written as a string or template literal in `code`
 * (comments already stripped). `holes` are the `${…}` expressions, IN ORDER, so
 * the live half can instantiate the statement the route really sends.
 */
export function scanSqlLiterals(code) {
  const out = [];
  const n = code.length;
  let i = 0;
  let prev = 'operator';
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const lit = readLiteral(code, i);
      prev = 'value';
      if (!lit) { i++; continue; }
      const sql = lit.text.trim();
      if (looksLikeStatement(sql)) out.push({ sql, holes: lit.holes, offset: i });
      i = lit.end;
      continue;
    }
    if (c === '/' && prev !== 'value') {
      const e = skipRegex(code, i);
      if (e !== -1) { prev = 'value'; i = e; continue; }
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      prev = REGEX_MAY_FOLLOW.has(code.slice(i, j)) ? 'operator' : 'value';
      i = j;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoO._]/.test(code[j])) j++;
      prev = 'value';
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prev = c === ')' || c === ']' ? 'value' : 'operator';
    i++;
  }
  return out;
}

const D1_CALL = /\.(prepare|exec|batch)\s*\(/g;

/** A receiver that is a D1 handle. `.exec(` is the one method name this repo
 *  also uses on something else — `/^Bearer\s+(.+)$/i.exec(header)` and
 *  `/^(\d{4})-/.exec(date)` are REGEX calls, and counting them as unreadable D1
 *  statements would have put two permanent entries in the `unparsed` list, which
 *  is the number [R2](iii) refuses to let drift above zero. Qualified by the
 *  receiver's last segment: `db`, `deps.db`, `c.env.PLATFORM_DB`, `APP_DB`. */
const D1_RECEIVER = /([A-Za-z_$][\w$]*)\s*$/;
const looksLikeD1Handle = (segment) => /^(?:[A-Za-z_$][\w$]*_)?(?:db|database)$/i.test(segment);

/**
 * Every `.prepare(` / `.exec(` / `.batch(` call, with its BALANCED argument text
 * and whether that argument is a single string/template literal this file could
 * read. `parsed: false` is the whole reason this walk exists: wrap a `.prepare`
 * in a helper and the literal walk simply finds less, silently.
 *
 * ⚠️ `.batch(` IS A COMPOSITION, NOT A STATEMENT. `db.batch(ops)` and
 * `db.batch([a, b])` carry statements that were `.prepare`d elsewhere and are
 * therefore already in the scan. Reporting them as unreadable would make
 * `unparsed` permanently non-zero and the floor meaningless — so they are
 * counted as compositions and named, never as a gap.
 */
export function scanPreparedCalls(code) {
  const out = [];
  D1_CALL.lastIndex = 0;
  for (const m of code.matchAll(D1_CALL)) {
    const method = m[1];
    if (method === 'exec') {
      const recv = D1_RECEIVER.exec(code.slice(Math.max(0, m.index - 64), m.index));
      if (!recv || !looksLikeD1Handle(recv[1])) continue;
    }
    const open = m.index + m[0].length - 1;
    const close = matchParen(code, open);
    if (close === -1) {
      out.push({ method, argText: '', parsed: false, why: 'the argument list never closes', offset: m.index });
      continue;
    }
    // A TRAILING COMMA IS NOT A SECOND ARGUMENT. `prepare(\n  \`…\`,\n)` is the
    // house style in every Worker here; without this the walk called 24 readable
    // statements unreadable and the real gap would have been invisible in the
    // noise.
    const argText = code.slice(open + 1, close - 1).trim().replace(/,\s*$/, '');
    if (method === 'batch') {
      out.push({ method, argText: argText.slice(0, 120), parsed: true, composition: true, offset: m.index });
      continue;
    }
    const first = argText[0];
    if (first === '"' || first === "'" || first === '`') {
      const lit = readLiteral(argText, 0);
      if (lit && lit.end === argText.length) {
        out.push({ method, argText, parsed: true, sql: lit.text.trim(), holes: lit.holes, offset: m.index });
        continue;
      }
    }
    out.push({
      method,
      argText,
      parsed: false,
      why:
        argText === ''
          ? 'it is called with no argument'
          : 'its argument is not a single string or template literal',
      offset: m.index,
    });
  }
  return out;
}

/** One past the `)` matching the `(` at `open`, or -1. */
function matchParen(code, open) {
  const n = code.length;
  let depth = 0;
  let i = open;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      const lit = readLiteral(code, i);
      if (!lit) return -1;
      i = lit.end;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return -1;
}

/**
 * The four kinds, in precedence order.
 *
 *   introspective       asks the database about its own schema. The class the
 *                       authorizer judges, and the class the live half must run.
 *   dynamic-identifier  interpolates a `${…}` hole. D1 cannot bind an
 *                       identifier, so this shape is unavoidable — which is why
 *                       [R3] asks what constrains the value rather than
 *                       forbidding it.
 *   static              a fixed statement with bound parameters only.
 *
 * `unparsed` is not produced here: it is a property of a CALL whose argument no
 * literal walk could read, so it is carried separately by [inventoryFile].
 */
export function classify(sql, holes) {
  if (isIntrospective(sql)) return 'introspective';
  if ((holes ?? []).length > 0) return 'dynamic-identifier';
  return 'static';
}

/**
 * What an interpolated hole is standing in for, derived from the SQL around it
 * rather than from the expression's name (a variable called `t` is still a table
 * if it follows `DELETE FROM`).
 *
 * Returns 'table', 'column' or null. `null` is not a failure — it is this
 * reader declining to guess, and the live half prints the statement as
 * not-instantiable instead of sending an invented one.
 */
export function identifierRole(sql, index) {
  const at = sql.indexOf(holePlaceholder(index));
  if (at === -1) return null;
  const before = sql.slice(0, at);
  const after = sql.slice(at + holePlaceholder(index).length);
  // A pragma's argument names a TABLE, and it is quoted, so the `FROM …` rule
  // below never sees it. Without this the two-step walk's second step — the
  // statement whose absence IS half the outage — was reported as "a hole this
  // reader will not guess a role for" and silently never executed live.
  if (/\bpragma_[A-Za-z_]+\s*\(\s*['"]?$/i.test(before)) return 'table';
  if (/\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+["'`[]?$/i.test(before)) return 'table';
  if (/\b(?:SET|WHERE|AND|OR|SELECT|BY|,)\s+["'`[]?$/i.test(before) && /^["'`\]]?\s*(?:=|IS|IN|<|>|!)/i.test(after)) return 'column';
  if (/\bSET\s+["'`[]?$/i.test(before)) return 'column';
  return null;
}

/**
 * Can this hole be replaced by a real identifier and sent verbatim?
 *
 * 🔴 A ROLE IS NOT ENOUGH, AND THE LIVE RUN PROVED IT. `UPDATE subscriptions SET
 * ${sets.join(', ')} WHERE …` has a hole in a column POSITION whose expression
 * is a whole assignment list — substituting a bare column name produced
 * `SET user_id WHERE`, a syntax error, which the live half then reported as an
 * authorizer refusal. A statement this reader cannot reproduce exactly must be
 * PRINTED as not-executed, never approximated: an invented variant proves
 * nothing about the statement that is deployed.
 */
export function isBareIdentifierExpression(expr) {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(String(expr).trim());
}

const SOURCE_EXT = /\.(?:ts|tsx|js|mjs|cjs)$/;

/**
 * One file's inventory. `source` is RAW — comments are stripped here so no
 * caller can forget, which is the mistake that would let the fixed route files
 * fail on their own header.
 */
export function inventoryFile(rel, source) {
  const ext = `.${rel.split('.').pop()}`;
  const code = stripSourceComments(source, ext);
  const statements = scanSqlLiterals(code).map((s) => ({
    file: rel,
    line: lineOf(code, s.offset),
    sql: s.sql,
    holes: s.holes,
    kind: classify(s.sql, s.holes),
    mutating: isMutating(s.sql),
    violates: violatesD1Authorizer(s.sql),
  }));
  const calls = scanPreparedCalls(code);
  const unparsed = calls
    .filter((c) => !c.parsed)
    .map((c) => ({ file: rel, line: lineOf(code, c.offset), method: c.method, why: c.why, argText: c.argText.slice(0, 120) }));
  const compositions = calls.filter((c) => c.composition).length;
  return { rel, code, statements, unparsed, compositions };
}

/** Every source file under `dir`, repo-relative, sorted. */
export function sourceFilesUnder(root, relDir) {
  const abs = join(root, ...relDir.split('/'));
  const out = [];
  if (!existsSync(abs)) return out;
  const walk = (d, rel) => {
    for (const e of listDir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, `${rel}/${e.name}`);
      else if (SOURCE_EXT.test(e.name)) out.push(`${rel}/${e.name}`);
    }
  };
  walk(abs, relDir);
  return out.sort();
}

/** wrangler.jsonc → JSON, the same reduction assert-erasure-reach.mjs uses. */
export function parseJsonc(text) {
  return JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * THE DOMAIN, DERIVED FROM THE DEPLOYABLE CONFIGS.
 *
 * Every `services/*` directory with a wrangler.jsonc, its D1 bindings (ALL of
 * them, not only the one it migrates — a Worker can send any of its statements
 * to any database it binds, and the shared Worker binding subly_db is exactly
 * how a route reached a database its author was not thinking about), and the
 * SQL its `src/` sends. No database id, name or binding is written down twice.
 */
export function inventoryServices(root) {
  const servicesDir = join(root, 'services');
  const out = [];
  if (!existsSync(servicesDir)) return out;
  for (const e of listDir(servicesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const cfgPath = join(servicesDir, e.name, 'wrangler.jsonc');
    if (!existsSync(cfgPath)) continue;
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(cfgPath, 'utf8'));
    } catch (err) {
      out.push({ id: e.name, configError: err.message, databases: [], files: [], statements: [], unparsed: [] });
      continue;
    }
    const databases = (Array.isArray(cfg.d1_databases) ? cfg.d1_databases : [])
      .filter((d) => typeof d?.database_id === 'string' && typeof d?.database_name === 'string')
      .map((d) => ({
        binding: d.binding,
        name: d.database_name,
        id: d.database_id,
        owns: typeof d.migrations_dir === 'string',
      }));
    const files = sourceFilesUnder(root, `services/${e.name}/src`);
    const statements = [];
    const unparsed = [];
    let compositions = 0;
    for (const rel of files) {
      const inv = inventoryFile(rel, readFileSync(join(root, ...rel.split('/')), 'utf8'));
      statements.push(...inv.statements);
      unparsed.push(...inv.unparsed);
      compositions += inv.compositions;
    }
    out.push({ id: e.name, configPath: `services/${e.name}/wrangler.jsonc`, databases, files, statements, unparsed, compositions });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
