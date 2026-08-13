#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-rollup-lossless.mjs — [11]E-11, [ADR 045]. THE GUARD TWO SHIPPED
// COMMENTS ALREADY CITED BEFORE IT EXISTED.
//
// 🔴 WHY IT EXISTS AT ALL, AND THE DEFECT ITS ABSENCE WAS. Two comments in
// shipped code named this file as build-failing while nothing of the sort was in
// the tree:
//   · services/platform/migrations/0007_events_rollup.sql — "[R2] fails the
//     build if this column stops being NOT NULL or leaves the unique index"
//   · services/platform/src/scheduled.ts — the `rollupBoundedCutoff` watermark
//     link, cited as `assert-rollup-lossless.mjs [R3]`
// Both were corrected to say the guard was OWED. A citation to a guard that was
// never written is worse than no citation: it retires the reader's suspicion
// without retiring the risk — the same defect [8]K-12 recorded, where a
// requirement's only citation was a guard that had never been in the tree. This
// file is that debt paid, and the two comments may cite it again.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ACCEPTANCE SENTENCE, ENFORCED IN THREE LIMBS:
//
//   "Every column each shipped insights query reads exists in events_daily; the
//    rollup's five grain columns are all NOT NULL and all five appear in
//    ux_events_daily_grain; and the retention sweep's `events` cutoff passes
//    through the rollup watermark rather than age alone."
//
//   [R1] EVERY COLUMN THE FIVE QUERIES READ EXISTS WHERE THEY READ IT.
//        events_daily's column set is PARSED out of the CREATE TABLE body in
//        0007 — the paren-matched body, split on top-level commas — never
//        grepped. Each queries/insights/*.sql is parsed for the columns it reads
//        off its base table, and WHICH QUESTION R1 ASKS DEPENDS ON WHICH TABLE
//        THAT IS:
//          · reads `events_daily` (the shipped state since the PR-2 cutover) —
//            every column must be a real column of the shipped DDL. This is the
//            exact question; there is no map in the way of it.
//          · reads raw `events` — every column must have a counterpart in the
//            rollup through the declared GRAIN_COVERAGE map below, whose TARGET
//            must exist in the DDL. This is the pre-cutover question, kept alive
//            because a NEW query is likely to be drafted against the raw table.
//
//        🔴 AND READING RAW `events` IS NOW A FAILURE, NOT A PRINT. Until the
//        PR-2 cutover this limb deliberately did not fail on it — the queries
//        had not moved yet, and the honest thing was to print the deferral. They
//        have moved. A query back on the raw table is a number the 400-day sweep
//        DESTROYS ([ADR 045]), and it does not destroy it loudly: the query
//        keeps returning a smaller answer every night. That is the whole reason
//        0007 exists, so silently reverting it must not be a green run.
//
//   [R2] THE IDEMPOTENCY THE WHOLE TABLE RESTS ON.
//        `feature` is NOT NULL with DEFAULT '', every grain column is NOT NULL,
//        and the grain is the SAME LIST in three independent places: the
//        `ON CONFLICT (…)` target inside the rollup's own INSERT in scheduled.ts,
//        the `ux_events_daily_grain` UNIQUE index, and the DDL's columns.
//        MEASURED FAILURE, not a hypothetical: SQLite treats NULLs as DISTINCT
//        in a unique index, so a nullable `feature` makes ON CONFLICT never fire
//        for the ~90% of rows that are not `feature_used` — three identical runs
//        produced THREE rows with a NULL sentinel and ONE with ''. A rollup that
//        duplicates on every run silently multiplies every count it feeds.
//
//        The grain is read from the CODE's conflict target rather than from the
//        index, deliberately. Deriving it from the index would make "all five
//        appear in the index" an assertion that cannot fail.
//
//   [R3] THE FAIL-CLOSED WATERMARK — AND IT IS A TRIPWIRE, NOT THE PROOF.
//        `rollupBoundedCutoff` is declared in scheduled.ts, is CALLED inside
//        `retentionSweep` (a symbol that only ever matches its own declaration
//        proves nothing — the `_registerInWorkspace` lesson), the watermark is
//        actually read there via `rolledThrough(`, and the value handed to
//        `deleteOlderThan` as the `events` cutoff is derived from
//        `rollupBoundedCutoff(…)` rather than straight from `retentionCutoff`.
//
//        🔴 THIS LIMB CANNOT PROVE THE ROWS SURVIVE. It proves the call is still
//        wired. The BEHAVIOURAL proof — seed 30 days, sweep with no rollup, watch
//        all 30 rows survive, then remove the bound and watch all 30 die — is
//        services/platform/test/events-rollup.test.ts, and R3 prints that on
//        every run so a green R3 is never mistaken for the guarantee.
//
// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE SELF-CHECK (every "COVERAGE LOST" below exits 1 immediately):
//   · 0007 must exist, and its CREATE TABLE events_daily must yield columns.
//   · queries/insights must yield at least one .sql, and the count must match the
//     machine-read list in its README.md — the same list test/insights-queries.test.ts
//     parses. FEWER files than the README documents names the missing count,
//     because that is exactly how check-migrations.mjs went from 5 files to 4
//     and reported PASS.
//   · every query file must yield at least one column reference; a file that
//     parses to nothing means the parse stopped working, not that the query is
//     simple.
//   · scheduled.ts must yield a retentionSweep body containing a
//     `deleteOlderThan(` call with at least three arguments.
//
// ─────────────────────────────────────────────────────────────────────────────
// RECORDED MUTATIONS (tooling/ci/test/rollup-lossless.test.mjs). Every tree case
// runs against a BYTE-IDENTICAL COPY of the shipped files — 0007, scheduled.ts,
// the five queries and their README — never a hand-written fixture, because a
// fixture you write encodes the same misunderstanding as the guard you write
// (assert-seams-wired.mjs shipped broken with all six fixtures green). The guard
// takes no different code path on a copy: there is no `scanningRealRepo` branch
// here, and the first test runs it against the true repository root unmodified.
//
//   M1 `feature` deleted from the DDL                  -> exit 1 (grain column absent)
//   M2 `feature TEXT NOT NULL DEFAULT ''` -> `TEXT`    -> exit 1 (nullable + no default)
//   M3 `feature` removed from ux_events_daily_grain    -> exit 1 (index ≠ ON CONFLICT)
//   M4 `rollupBoundedCutoff` removed from scheduled.ts -> exit 1 (undeclared)
//   M5 the cutoff reverted to bare `ageCutoff`         -> exit 1 (age alone)
//   M6 the query directory emptied                     -> exit 1 COVERAGE LOST
//   M7 a query reading a column events_daily does not have -> exit 1 (R1's
//      post-cutover failing case)
//   M8 a query reverted to raw `events`                -> exit 1 (the cutover
//      undone — the case that was a PRINT until PR-2 and is a failure now)
//   M8b a raw-reverted query ALSO reading an uncovered column -> exit 1 through
//      GRAIN_COVERAGE (without it, that branch has no reachable failing input
//      now that no shipped query reads the raw table, and an assertion that
//      cannot fail is worse than none)
//
// Usage:  node tooling/ci/assert-rollup-lossless.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const MIGRATION_REL = 'services/platform/migrations/0007_events_rollup.sql';
const SCHEDULED_REL = 'services/platform/src/scheduled.ts';
const QUERIES_REL = 'services/platform/queries/insights';
const BEHAVIOURAL_PROOF_REL = 'services/platform/test/events-rollup.test.ts';

export const ROLLUP_TABLE = 'events_daily';
export const RAW_TABLE = 'events';
export const GRAIN_INDEX = 'ux_events_daily_grain';

/**
 * THE GRAIN, DECLARED — not derived from the index it is checked against.
 *
 * Each entry is load-bearing per 0007's header: `anon_id` because every one of
 * the five numbers is an install-level DISTINCT count and three are per-install
 * joins across different event types; `feature` because it is the '' sentinel
 * ON CONFLICT depends on; `day`/`app_id`/`event` because they are the axes every
 * query filters and groups on. Losing one destroys a number while the rollup
 * still reports healthy, so a SHRINKING grain fails here. Growing is fine.
 */
export const REQUIRED_GRAIN = ['day', 'app_id', 'anon_id', 'event', 'feature'];

/**
 * RAW `events` COLUMN → THE events_daily COLUMN THAT CARRIES ITS INFORMATION.
 *
 * ⚠️ THIS MAP IS FOR QUERIES THAT STILL READ THE RAW TABLE, AND SINCE THE PR-2
 * CUTOVER NO SHIPPED QUERY DOES. It is deliberately NOT extended with identity
 * entries (`day → day`, `feature → feature`, `n_rows → n_rows`) to make the
 * post-cutover queries pass through it: a query reading `events_daily` is
 * checked DIRECTLY against the shipped DDL, which is the exact question, while
 * identity entries would also have made `SELECT server_ts FROM events_daily` —
 * a statement that fails at runtime — read as covered.
 *
 *   server_ts → day      the documented fidelity loss. A DAY-ALIGNED window is
 *                        exact; a sub-day window is FLOORED AT BOTH ENDS, so the
 *                        start widens and the end NARROWS and a window inside
 *                        one day returns nothing. (This comment said "silently
 *                        widened", copied from 0007's header, until PR-2
 *                        measured both directions — see
 *                        services/platform/test/insights-equivalence.test.ts
 *                        § "the day window is a REAL loss".)
 *   params    → feature  the rollup precomputes `params.$.name` into `feature`
 *                        with CAST(… AS TEXT); no other param survives, and that
 *                        is the point — nine identifying/contextual columns go.
 *   COUNT(*)  → n_rows   asserted through the INSERT column list in R2 rather
 *                        than here, because it is not a column a query names.
 *
 * A raw column absent from this map is a genuine gap: the grain cannot serve
 * that query after the cutover, and the guard says so rather than inventing a
 * counterpart.
 */
export const GRAIN_COVERAGE = new Map([
  ['app_id', 'app_id'],
  ['anon_id', 'anon_id'],
  ['event', 'event'],
  ['server_ts', 'day'],
  ['params', 'feature'],
]);

/** SQL keywords, types and functions the five queries use. NOT a column list —
 *  anything left over after these, the CTE names, the table names and the `AS`
 *  aliases are removed is treated as a base-table column reference. An unknown
 *  new function therefore fails LOUDLY here rather than silently widening the
 *  column set, which is the only direction that matters: the alternative — a
 *  narrow vocabulary that lets a real column slip past unnoticed — reports more
 *  coverage than exists. */
export const SQL_VOCABULARY = new Set(
  (
    'select from where and or not null is in as on join left right inner outer full cross ' +
    'group by order having limit offset distinct with recursive case when then else end ' +
    'union all except intersect exists between like glob regexp escape cast collate asc desc ' +
    'nulls first last over partition values insert into update set delete conflict do nothing ' +
    'true false default using natural filter window returning excluded ' +
    'integer text real blob numeric boolean date datetime ' +
    'count sum avg min max total round coalesce ifnull nullif substr substring length ' +
    'lower upper trim ltrim rtrim abs julianday unixepoch strftime time timediff ' +
    'json_extract json_valid json_type json_array json_object json_each json_quote ' +
    'group_concat row_number rank dense_rank ntile lag lead iif printf format replace instr typeof ' +
    'random randomblob hex quote char unicode ifnull likelihood likely unlikely'
  ).split(/\s+/),
);

const problems = [];
const prints = [];

/** Structural failure — the scan itself stopped reaching its subject, so nothing
 *  below it means anything. Exits immediately rather than joining `problems`. */
const coverageLost = (lines) => {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
};

// ─────────────────────────────────────────────────────────────────────────────
// SQL reductions. Comments are removed by a scanner that knows about string
// literals, and string literals are removed by a scanner that knows about
// comments — the two cannot be done independently, because 0007's own column
// comments contain apostrophe-quoted text (`-- 'YYYY-MM-DD' UTC`) and the
// queries' comments contain SQL.
// ─────────────────────────────────────────────────────────────────────────────

/** `--` and block comments out; string literals PRESERVED (the DDL scan needs
 *  `DEFAULT ''` intact, and that is the whole subject of R2's first limb). */
export function stripSqlComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "'") {
      out += c;
      i++;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '-' && d === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Comments out AND string literals collapsed to `''`. Used for the identifier
 *  scan only: without it `'first_launch'` and `'$.name'` enter the column set. */
export function reduceSqlToCode(sql) {
  return stripSqlComments(sql).replace(/'(?:[^']|'')*'/g, "''");
}

/** Index of the `)` matching the `(` at `openIdx`, string-aware. */
function matchSqlParen(s, openIdx) {
  let depth = 0;
  let i = openIdx;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      i++;
      while (i < s.length) {
        if (s[i] === "'") { if (s[i + 1] === "'") { i++; } else break; }
        i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split on commas at paren depth 0, string-aware. */
export function splitTopLevel(s) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      cur += c;
      i++;
      while (i < s.length) {
        cur += s[i];
        if (s[i] === "'") { if (s[i + 1] === "'") { cur += s[i + 1]; i++; } else break; }
        i++;
      }
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/**
 * The columns of `table`, PARSED: locate the CREATE TABLE, paren-match its body,
 * split on top-level commas, take the first identifier of each definition and
 * keep the rest as the constraint text. Table-level constraints (PRIMARY KEY(…),
 * UNIQUE(…), CHECK(…)) are dropped rather than read as columns.
 *
 * Returns a Map<column, constraintText>, or null if no such CREATE TABLE.
 */
export function tableColumns(sql, table) {
  const clean = stripSqlComments(sql);
  const re = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?${table}["'\`]?\\s*\\(`, 'i');
  const m = re.exec(clean);
  if (!m) return null;
  const open = clean.indexOf('(', m.index + m[0].length - 1);
  const close = matchSqlParen(clean, open);
  if (close < 0) return null;
  const cols = new Map();
  for (const def of splitTopLevel(clean.slice(open + 1, close))) {
    const parts = /^["'`]?([A-Za-z_][A-Za-z0-9_]*)["'`]?\s+([\s\S]*)$/.exec(def);
    if (!parts) continue;
    if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i.test(parts[1])) continue;
    cols.set(parts[1], parts[2].replace(/\s+/g, ' ').trim());
  }
  return cols;
}

/** Every `CREATE [UNIQUE] INDEX … ON <table> (…)`, parsed to name + uniqueness +
 *  ordered column list. */
export function indexesOn(sql, table) {
  const clean = stripSqlComments(sql);
  const out = [];
  const re = new RegExp(
    `CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?["'\`]?([A-Za-z_][A-Za-z0-9_]*)["'\`]?\\s+ON\\s+["'\`]?${table}["'\`]?\\s*\\(`,
    'gi',
  );
  let m;
  while ((m = re.exec(clean)) !== null) {
    const open = clean.indexOf('(', m.index + m[0].length - 1);
    const close = matchSqlParen(clean, open);
    if (close < 0) continue;
    out.push({
      name: m[2],
      unique: Boolean(m[1]),
      columns: splitTopLevel(clean.slice(open + 1, close)).map((c) =>
        c.replace(/^["'`]|["'`]$/g, '').split(/\s+/)[0],
      ),
    });
  }
  return out;
}

/**
 * The base-table columns a query READS, derived by elimination rather than by a
 * column allow-list: strip comments and string literals, drop `alias.` prefixes,
 * then remove the CTE names, the table names after FROM/JOIN, every `AS <name>`
 * output alias and the SQL vocabulary. What is left is a column reference.
 *
 * ASSERTING ON STRUCTURE, NOT ON PROSE: every comment in these files is SQL-
 * shaped (they quote fragments of the very queries they explain), so a scan that
 * did not strip them would read the explanation as the query.
 */
export function queryColumnRefs(sql) {
  const code = reduceSqlToCode(sql);
  const ctes = new Set();
  for (const m of code.matchAll(/(?:\bWITH\b|,)\s*([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) ctes.add(m[1].toLowerCase());

  const tables = new Set();
  const aliases = new Set();
  for (const m of code.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/gi)) {
    tables.add(m[1].toLowerCase());
    if (m[2] && !SQL_VOCABULARY.has(m[2].toLowerCase())) aliases.add(m[2].toLowerCase());
  }
  for (const m of code.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) aliases.add(m[1].toLowerCase());

  // Qualifiers go before the bare scan, so `e.server_ts` contributes the COLUMN
  // and not the alias. Numeric literals (`100.0`) cannot match: the qualifier
  // pattern requires an identifier start.
  const unqualified = code.replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*\./g, '');

  const columns = new Set();
  for (const m of unqualified.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const id = m[0].toLowerCase();
    if (SQL_VOCABULARY.has(id) || ctes.has(id) || tables.has(id) || aliases.has(id)) continue;
    columns.add(id);
  }
  // A CTE is a table for the purpose of "does this read the raw table".
  const baseTables = new Set([...tables].filter((t) => !ctes.has(t)));
  return { columns, ctes, aliases, tables, baseTables };
}

/** The numbered list in queries/insights/README.md, whose trailing
 *  `` → `file` (`id`) `` shape is already machine-read by
 *  test/insights-queries.test.ts. Parsed here for the SAME reason it is parsed
 *  there: the floor on how many queries must exist has to come from somewhere
 *  other than a directory listing of the very files being counted. */
export function readmeQueries(md) {
  return [...md.matchAll(/→\s*`([0-9A-Za-z._-]+\.sql)`\s*\(`([A-Za-z0-9_]+)`\)/g)].map((m) => ({
    file: m[1],
    id: m[2],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// TypeScript reductions for R2's ON CONFLICT target and R3's wiring.
// ─────────────────────────────────────────────────────────────────────────────

/** `//` and `/* *\/` out; string and template literals preserved. Written as a
 *  scanner rather than a regex because scheduled.ts is ~1000 lines of prose
 *  comments quoting the code they describe — a regex reduction that got the
 *  string boundaries wrong would delete real code (this repo has the scar:
 *  assert-guard-coverage.mjs's block-comment regex once ate its own imports). */
export function stripTsComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === c) { i++; break; }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The contents of every string/template literal in already-comment-stripped
 *  source. This is how the rollup's INSERT is located: as a STATEMENT LITERAL,
 *  not as text matched anywhere in the file. */
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i++;
      let buf = '';
      while (i < src.length) {
        if (src[i] === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === c) { i++; break; }
        buf += src[i];
        i++;
      }
      out.push(buf);
      continue;
    }
    i++;
  }
  return out;
}

/** String contents replaced by spaces, LENGTH AND NEWLINES PRESERVED, so brace
 *  matching cannot be thrown by a `{` inside a template interpolation or by a
 *  quote inside a message. */
export function blankTsStrings(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (src[i] === c) { out += c; i++; break; }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function matchBracket(s, openIdx, open, close) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * The body of `function <name>(…)`, brace-matched.
 *
 * ⚠️ THE SIGNATURE'S PARENS ARE MATCHED FIRST, and that is not tidiness:
 * `retentionSweep` has a DEFAULT PARAMETER that is an object literal, so the
 * first `{` after the function name opens the DEFAULT, not the body. Taking it
 * would return the three retention constants and nothing else — a body that
 * parses, contains no `deleteOlderThan`, and would have made this limb read as
 * COVERAGE LOST forever.
 */
export function functionBody(blanked, name) {
  const m = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(blanked);
  if (!m) return null;
  const openParen = blanked.indexOf('(', m.index);
  const closeParen = matchBracket(blanked, openParen, '(', ')');
  if (closeParen < 0) return null;
  const open = blanked.indexOf('{', closeParen);
  if (open < 0) return null;
  const close = matchBracket(blanked, open, '{', '}');
  if (close < 0) return null;
  return blanked.slice(open + 1, close);
}

/** Split a JS argument list on top-level commas. */
export function splitJsArgs(s) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const c of s) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** The arguments of the first `<fn>(` call in `body`. */
export function callArgs(body, fn) {
  const idx = body.indexOf(`${fn}(`);
  if (idx < 0) return null;
  const open = body.indexOf('(', idx);
  const close = matchBracket(body, open, '(', ')');
  if (close < 0) return null;
  return splitJsArgs(body.slice(open + 1, close));
}

/** The initializer of `const|let <id> = …` up to the top-level `;`. */
export function declInitializer(body, id) {
  const m = new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*(?::[^=;]*)?=`).exec(body);
  if (!m) return null;
  let depth = 0;
  let out = '';
  for (let i = m.index + m[0].length; i < body.length; i++) {
    const c = body[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) break;
    out += c;
  }
  return out.trim();
}

/** Base identifiers in an expression — property accesses (`x.slice`) excluded,
 *  so `bounded.slice(0, 10)` contributes `bounded`, not `slice`. */
export function baseIdentifiers(expr) {
  const out = new Set();
  for (const m of expr.matchAll(/(\.?)\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) {
    if (m[1] === '.') continue;
    out.add(m[2]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const migPath = join(ROOT, MIGRATION_REL);
  const schedPath = join(ROOT, SCHEDULED_REL);
  const queriesDir = join(ROOT, QUERIES_REL);

  if (!existsSync(migPath)) {
    coverageLost([
      `${MIGRATION_REL} does not exist, so events_daily's shape was read from nothing.`,
      'Every limb below compares something against that DDL; without it this guard would print ok while',
      'checking three claims against an empty column set.',
    ]);
  }
  if (!existsSync(schedPath)) {
    coverageLost([`${SCHEDULED_REL} does not exist, so neither the rollup INSERT nor the sweep wiring can be read.`]);
  }
  if (!existsSync(queriesDir) || !statSync(queriesDir).isDirectory()) {
    coverageLost([`${QUERIES_REL} does not exist, so R1 would range over zero queries and report the grain sufficient for nothing.`]);
  }

  const migSql = readFileSync(migPath, 'utf8');
  const schedSrc = readFileSync(schedPath, 'utf8');

  // ── R2 (a) THE DDL ────────────────────────────────────────────────────────
  const dailyCols = tableColumns(migSql, ROLLUP_TABLE);
  if (dailyCols === null || dailyCols.size === 0) {
    coverageLost([
      `no \`CREATE TABLE ${ROLLUP_TABLE}\` body could be parsed out of ${MIGRATION_REL}.`,
      'The column set is the subject of R1 and R2 both. An empty one makes every containment check',
      'below vacuously interesting and none of them true.',
    ]);
  }

  // ── R2 (b) THE ON CONFLICT TARGET, FROM THE CODE ──────────────────────────
  const schedCode = stripTsComments(schedSrc);
  const insertLiteral = stringLiterals(schedCode).find((s) =>
    new RegExp(`INSERT\\s+INTO\\s+${ROLLUP_TABLE}\\b`, 'i').test(s),
  );
  if (!insertLiteral) {
    coverageLost([
      `no string literal in ${SCHEDULED_REL} contains \`INSERT INTO ${ROLLUP_TABLE}\`.`,
      "The rollup's own statement is where the grain is DECLARED by the code; without it R2 would have to",
      'derive the grain from the index it is supposed to be checking, which is an assertion that cannot fail.',
    ]);
  }
  const insertColsM = new RegExp(`INSERT\\s+INTO\\s+${ROLLUP_TABLE}\\s*\\(([^)]*)\\)`, 'i').exec(insertLiteral);
  const conflictM = /ON\s+CONFLICT\s*\(([^)]*)\)/i.exec(insertLiteral);
  if (!insertColsM || !conflictM) {
    coverageLost([
      `the ${ROLLUP_TABLE} INSERT in ${SCHEDULED_REL} has no readable column list or no \`ON CONFLICT (…)\` target.`,
      'R2 compares three independent statements of the grain; with one of them unreadable it would compare two.',
    ]);
  }
  const insertCols = insertColsM[1].split(',').map((s) => s.trim()).filter(Boolean);
  const conflictCols = conflictM[1].split(',').map((s) => s.trim()).filter(Boolean);

  // ── R2 (c) THE INDEX ──────────────────────────────────────────────────────
  const indexes = indexesOn(migSql, ROLLUP_TABLE);
  if (indexes.length === 0) {
    coverageLost([`${MIGRATION_REL} declares no index on ${ROLLUP_TABLE}, so the grain's uniqueness could not be read at all.`]);
  }
  const grainIndex = indexes.find((ix) => ix.name === GRAIN_INDEX);

  if (!grainIndex) {
    problems.push(
      `[R2] ${MIGRATION_REL} declares no index named \`${GRAIN_INDEX}\`. That index IS the ON CONFLICT target — ` +
        'it is what makes the rollup re-runnable, not a lookup index that happens to be unique.',
    );
  } else {
    if (!grainIndex.unique) {
      problems.push(
        `[R2] \`${GRAIN_INDEX}\` is not UNIQUE. \`ON CONFLICT (…)\` needs a unique index or constraint on exactly ` +
          'those columns; without one the upsert does not fire and every re-run appends a duplicate set of rows.',
      );
    }
    const ixCols = grainIndex.columns.join(', ');
    const ccCols = conflictCols.join(', ');
    if (ixCols !== ccCols) {
      problems.push(
        `[R2] the grain is stated twice and the two disagree: \`${GRAIN_INDEX}\` is (${ixCols}) and the rollup's ` +
          `\`ON CONFLICT\` target in ${SCHEDULED_REL} is (${ccCols}). ON CONFLICT resolves against a unique index over ` +
          'EXACTLY its column list; a mismatch is not a near-miss, it is an upsert that never fires.',
      );
    }
  }

  for (const col of REQUIRED_GRAIN) {
    if (!conflictCols.includes(col)) {
      problems.push(
        `[R2] \`${col}\` is not in the rollup's ON CONFLICT target (${conflictCols.join(', ')}). ` +
          "0007's header records why each grain column is load-bearing; a grain that loses one destroys a number " +
          'while the rollup still reports healthy.',
      );
    }
    const def = dailyCols.get(col);
    if (def === undefined) {
      problems.push(
        `[R2] grain column \`${col}\` is not a column of ${ROLLUP_TABLE} in ${MIGRATION_REL}. ` +
          'The index and the INSERT both name it, so this is a table that cannot accept its own rollup.',
      );
      continue;
    }
    if (!/\bNOT\s+NULL\b/i.test(def)) {
      problems.push(
        `[R2] \`${col} ${def}\` is NULLABLE. SQLite treats NULLs as DISTINCT in a unique index, so a NULL in any ` +
          'grain column makes ON CONFLICT never fire for that row — measured: three identical runs produced THREE ' +
          "rows with a NULL sentinel and ONE with ''.",
      );
    }
  }

  const featureDef = dailyCols.get('feature');
  if (featureDef !== undefined && !/\bDEFAULT\s+''/.test(featureDef)) {
    problems.push(
      `[R2] \`feature ${featureDef}\` has no \`DEFAULT ''\`. The '' sentinel is what makes ON CONFLICT fire for the ` +
        '~90% of rows that are not `feature_used`; NOT NULL without a default only moves the failure from a silent ' +
        'duplicate to a rejected INSERT.',
    );
  }

  for (const col of insertCols) {
    if (!dailyCols.has(col)) {
      problems.push(
        `[R2] the rollup INSERT writes \`${col}\`, which is not a column of ${ROLLUP_TABLE}. ` +
          'The statement and the table have drifted; this fails at runtime inside a cron limb that swallows its own errors.',
      );
    }
  }

  // ── R1 THE GRAIN COVERS WHAT THE QUERIES READ ─────────────────────────────
  const sqlFiles = listDir(queriesDir).filter((f) => f.endsWith('.sql')).sort();
  if (sqlFiles.length === 0) {
    coverageLost([
      `${QUERIES_REL} contains no .sql file, so R1 scanned ZERO queries and would have reported the grain sufficient.`,
      'This is the check-migrations.mjs shape exactly — a scanner that silently dropped from 5 files to 4 and printed',
      'PASS. A scan that reaches nothing is a failure, never a smaller amount of work.',
    ]);
  }

  const readmePath = join(queriesDir, 'README.md');
  let documented = [];
  if (existsSync(readmePath)) {
    documented = readmeQueries(readFileSync(readmePath, 'utf8'));
    if (documented.length === 0) {
      coverageLost([
        `${QUERIES_REL}/README.md is present and its machine-read list parsed to ZERO entries.`,
        'That list is the only floor on how many queries must exist that does not come from a listing of the very',
        'files being counted. Unparseable means the floor is gone while the scan still prints a number.',
      ]);
    }
    if (sqlFiles.length < documented.length) {
      const missing = documented.filter((d) => !sqlFiles.includes(d.file));
      coverageLost([
        `${QUERIES_REL}/README.md documents ${documented.length} quer(ies) and only ${sqlFiles.length} .sql file(s) are present — ` +
          `${documented.length - sqlFiles.length} MISSING: ${missing.map((m) => m.file).join(', ') || '(names could not be resolved)'}.`,
        'A shrinking set of questions is COVERAGE LOST, not a smaller green run: the queries are what define which',
        'columns the grain has to carry, so a deleted query silently removes a requirement from this guard.',
      ]);
    }
    for (const d of documented) {
      if (!sqlFiles.includes(d.file)) {
        problems.push(`[R1] README.md names \`${d.file}\` (\`${d.id}\`) and no such file is in ${QUERIES_REL}.`);
      }
    }
    for (const f of sqlFiles) {
      if (!documented.some((d) => d.file === f)) {
        problems.push(
          `[R1] ${QUERIES_REL}/${f} is not in README.md's numbered list. An undocumented query is one this guard's ` +
            'coverage floor cannot see, so deleting it later would be invisible.',
        );
      }
    }
  } else {
    prints.push(`${QUERIES_REL}/README.md is absent — the query count is anchored only by the directory listing.`);
  }

  const stillRaw = [];
  const onRollup = [];
  for (const f of sqlFiles) {
    const { columns, baseTables } = queryColumnRefs(readFileSync(join(queriesDir, f), 'utf8'));
    if (columns.size === 0) {
      coverageLost([
        `${QUERIES_REL}/${f} parsed to ZERO column references.`,
        'Every one of these queries reads at least app_id, event and a day. Zero means the parse stopped',
        'working, and an empty reference set satisfies every containment check below without checking anything.',
      ]);
    }

    const readsRaw = baseTables.has(RAW_TABLE);
    const readsRollup = baseTables.has(ROLLUP_TABLE);
    if (readsRaw) stillRaw.push(f);
    if (readsRollup) onRollup.push(f);

    // WHICH TABLE THE QUERY READS DECIDES WHICH QUESTION R1 ASKS, so a file that
    // reads NEITHER would be asked nothing at all while the run still printed a
    // column count — the silent-scan shape this repo keeps paying for.
    if (!readsRaw && !readsRollup) {
      coverageLost([
        `${QUERIES_REL}/${f} names neither \`${ROLLUP_TABLE}\` nor \`${RAW_TABLE}\` after FROM/JOIN ` +
          `(it reads: ${[...baseTables].sort().join(', ') || '(nothing)'}).`,
        "R1 picks its question from the table the query reads. With neither present it would ask neither question and",
        'report the grain sufficient for a query it never checked.',
      ]);
    }

    if (readsRaw) {
      problems.push(
        `[R1] ${QUERIES_REL}/${f} READS THE RAW \`${RAW_TABLE}\` TABLE. The shipped query set moved to ` +
          `\`${ROLLUP_TABLE}\` (PR-2); a query back on the raw table is a number the 400-day \`${RAW_TABLE}\` sweep ` +
          'DESTROYS ([ADR 045]) — and destroys quietly, because the query keeps answering, with less history every ' +
          'night, rather than failing. That is the entire reason 0007 exists, so undoing it must not be a green run.',
      );
    }

    for (const col of [...columns].sort()) {
      if (readsRaw) {
        // THE PRE-CUTOVER QUESTION, kept because a new query is likely to be
        // drafted against the raw table: is there a counterpart at all?
        const target = GRAIN_COVERAGE.get(col);
        if (target === undefined) {
          problems.push(
            `[R1] ${QUERIES_REL}/${f} reads \`${col}\` off the raw \`${RAW_TABLE}\` table and the rollup grain carries ` +
              `no counterpart. Either ${ROLLUP_TABLE} must grow a column for it (and 0007's privacy argument re-made — ` +
              'the grain drops nine identifying/contextual columns on purpose), or the query must stop reading it. ' +
              'Left as-is, this number cannot survive the cutover at all. (If it is a SQL function this scan has not ' +
              'met, add it to SQL_VOCABULARY — that is a vocabulary gap, not a grain gap.)',
          );
          continue;
        }
        if (!dailyCols.has(target)) {
          problems.push(
            `[R1] ${QUERIES_REL}/${f} reads \`${col}\`, which GRAIN_COVERAGE says is carried by ${ROLLUP_TABLE}.\`${target}\` — ` +
              `and \`${target}\` is not in the shipped DDL. The map is describing a table that no longer has that column.`,
          );
        }
        continue;
      }

      // THE POST-CUTOVER QUESTION, and it is the exact one — no map in the way.
      if (!dailyCols.has(col)) {
        problems.push(
          `[R1] ${QUERIES_REL}/${f} reads \`${col}\` off \`${ROLLUP_TABLE}\` and the shipped DDL in ${MIGRATION_REL} ` +
            `has no such column (it has: ${[...dailyCols.keys()].join(', ')}). This does not degrade at runtime — D1 ` +
            'rejects the statement — so the number simply stops existing. (If it is a SQL function this scan has not ' +
            'met, add it to SQL_VOCABULARY — that is a vocabulary gap, not a schema gap.)',
        );
      }
    }
  }

  // ── R3 THE WATERMARK WIRING ───────────────────────────────────────────────
  const blanked = blankTsStrings(schedCode);
  const declaresBound = /\bfunction\s+rollupBoundedCutoff\s*\(/.test(blanked);
  if (!declaresBound) {
    problems.push(
      `[R3] ${SCHEDULED_REL} declares no \`rollupBoundedCutoff\`. That function IS the fail-closed interlock: ` +
        'without it the `events` sweep deletes on age alone and destroys history the rollup has not consumed. ' +
        `The behavioural proof of that is ${BEHAVIOURAL_PROOF_REL}, which drives exactly this mutation.`,
    );
  }
  const sweepBody = functionBody(blanked, 'retentionSweep');
  if (sweepBody === null || sweepBody.trim() === '') {
    coverageLost([
      `\`retentionSweep\` could not be located in ${SCHEDULED_REL}, so R3 checked the wiring of nothing.`,
      'The sweep is the only limb in this portfolio that destroys data; a limb this guard cannot find is a limb',
      'it cannot say anything about, and saying nothing must not read as saying ok.',
    ]);
  }
  const delArgs = callArgs(sweepBody, 'deleteOlderThan');
  if (delArgs === null || delArgs.length < 3) {
    coverageLost([
      `no \`deleteOlderThan(env, store, cutoff)\` call with three arguments was found inside \`retentionSweep\` in ${SCHEDULED_REL}.`,
      'The cutoff argument is the whole subject of R3. Without it this limb has nothing to trace back to the watermark.',
    ]);
  }
  if (!sweepBody.includes('rolledThrough(')) {
    problems.push(
      `[R3] \`retentionSweep\` never calls \`rolledThrough(\`. The watermark has to be READ inside the sweep; ` +
        'a bound computed from a stale or absent watermark is not a bound.',
    );
  }
  const cutoffArg = delArgs[2];
  // For the MESSAGE only: string contents were blanked to keep brace matching
  // aligned, so `'events_daily'` reads as a run of spaces. Collapsed to `'…'`
  // rather than restored — the guard's verdict must not depend on a literal it
  // deliberately does not read.
  const shownArg = cutoffArg.replace(/(['"`])\s*\1/g, "$1…$1").replace(/\s+/g, ' ');
  let boundedVia = cutoffArg.includes('rollupBoundedCutoff(') ? '(inline)' : null;
  const traced = [];
  if (boundedVia === null) {
    for (const id of baseIdentifiers(cutoffArg)) {
      const init = declInitializer(sweepBody, id);
      if (init === null) continue;
      traced.push(id);
      if (init.includes('rollupBoundedCutoff(')) { boundedVia = id; break; }
    }
  }
  if (boundedVia === null) {
    if (traced.length === 0) {
      coverageLost([
        `the cutoff handed to \`deleteOlderThan\` is \`${shownArg}\` and no local declaration for any name in it was found in \`retentionSweep\`.`,
        'R3 traces the cutoff back to its source; with nothing to trace it would have to assume the wiring it exists to check.',
      ]);
    }
    problems.push(
      `[R3] the \`events\` cutoff handed to \`deleteOlderThan\` (\`${shownArg}\`, traced through ${traced.join(', ')}) ` +
        'is never produced by `rollupBoundedCutoff(…)`. It is therefore an AGE cutoff, and the sweep will delete rows ' +
        `the rollup has not consumed — irreversibly, because ${ROLLUP_TABLE} is the only surviving copy of their contribution. ` +
        `${BEHAVIOURAL_PROOF_REL} drives this exact mutation: with the bound removed, all 30 seeded rows are deleted.`,
    );
  }

  // ── OUTPUT ────────────────────────────────────────────────────────────────
  console.log(
    `⬜  ${ROLLUP_TABLE}: ${dailyCols.size} column(s), grain (${conflictCols.join(', ')}) agreed by the DDL, ` +
      `\`${GRAIN_INDEX}\` and the rollup's ON CONFLICT target`,
  );
  console.log(
    `⬜  R1 scanned ${sqlFiles.length} quer(ies) in ${QUERIES_REL}` +
      (documented.length ? ` (README.md documents ${documented.length})` : ''),
  );
  console.log(
    `⬜  ${onRollup.length} of ${sqlFiles.length} quer(ies) READ \`${ROLLUP_TABLE}\` — THE CUTOVER HAS LANDED, and ` +
      `${stillRaw.length} still read raw \`${RAW_TABLE}\`. This line used to report the reverse and call it a ` +
      'deliberate deferral; that is no longer true, and a stale reassurance is the thing this repo pays for most. ' +
      'The queries answer over a DAY window now: both bounds FLOOR, so the start widens and the end NARROWS — the ' +
      'equivalence and both directions of that loss are measured in ' +
      'services/platform/test/insights-equivalence.test.ts.',
  );
  console.log(
    '⬜  R3 IS A TRIPWIRE, NOT THE PROOF. It shows the call is still wired; it cannot show a row survives. ' +
      `The behavioural proof is ${BEHAVIOURAL_PROOF_REL} — seed 30 days, sweep with no rollup, all 30 survive; ` +
      'remove the bound and all 30 die. A green R3 is not that guarantee.',
  );
  for (const p of prints) console.log(`⬜  ${p}`);

  if (problems.length) {
    console.error(`✗ rollup losslessness — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }

  console.log(
    `ok  the grain covers every column ${sqlFiles.length} shipped quer(ies) read, all ${REQUIRED_GRAIN.length} grain ` +
      `columns are NOT NULL and in \`${GRAIN_INDEX}\`, and the \`${RAW_TABLE}\` cutoff passes through ` +
      `\`rollupBoundedCutoff\`${boundedVia && boundedVia !== '(inline)' ? ` via \`${boundedVia}\`` : ''} [11]E-11 [ADR 045]`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
