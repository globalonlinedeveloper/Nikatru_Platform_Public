#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-migrations.mjs — the ADDITIVE-ONLY schema guard.
//
// One shared `platform_db` serves the whole portfolio, and every stamped app
// ships clients we cannot recall. That makes ONE destructive migration a
// portfolio-wide outage, and a column dropped under a released client an
// unrecoverable data loss. So: migrations may only ADD.
//
// Banned outright — see company/requirements/schema-evolution.md:
//   DROP TABLE · DROP COLUMN · RENAME (table or column) · ALTER/MODIFY COLUMN
//   ADD COLUMN … NOT NULL with no DEFAULT (SQLite refuses it at runtime anyway;
//   failing here names the reason instead of a wrangler stack trace)
//
// 🔴 AND THE DESTRUCTIVE **DML** CLASS, added 2026-08-01. The rule list was five
// patterns, ALL DDL — so `DELETE FROM entitlements;` in a committed migration was
// scanned, found clean, and printed "additive-only holds". That is not a corner
// case: deploy-workers.yml runs `d1 migrations apply … --remote` on every deploy
// with no human in the loop, so a one-line unfiltered DELETE destroys production
// rows portfolio-wide with ci-gate green. A DELETE is not an ADD; the guard was
// under-enforcing its own stated invariant.
//   DELETE FROM … with no WHERE · UPDATE … SET … with no WHERE (that is how a
//   column gets nulled out wholesale) · TRUNCATE · DROP DATABASE/SCHEMA ·
//   INSERT OR REPLACE / REPLACE INTO (a silent delete + re-insert that drops
//   every column the statement does not name)
//
// ⚠️ SCOPED TO *UNFILTERED* STATEMENTS ON PURPOSE. Backfills are existing,
// legitimate practice here — services/subly-api/migrations/0002_schema_debt.sql
// carries two `UPDATE … SET … WHERE …` backfills that were applied --remote — so
// a blanket ban would fail HEAD and be weakened within a week. A WHERE clause is
// the difference between "repair these rows" and "wipe this column".
//
// Not banned: DROP INDEX (indexes carry no data and are rebuildable), and
// DROP … IF EXISTS on a *temporary* object inside an explicit expand-contract
// migration — which must be reviewed by a human, not waved through by a regex.
//
// THE ONE ESCAPE HATCH, and it is a reviewed marker rather than the guard's
// silence: a statement genuinely needing an unfiltered destructive form must
// carry `-- migration:destructive-approved <ADR or reason>` on its own line or on
// the contiguous comment block directly above it. It shows up in the diff, it
// needs a justification, and every approved statement is PRINTED on every run —
// an exception nobody sees is how a ban becomes a formality.
//
// Usage:  node tooling/ci/check-migrations.mjs
// Exit 0 = clean, 1 = violations (printed with file:line).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { boundedGlob } from './tree-walk.mjs';

/** Migration sets under guard. The brick's is included: it is the schema every
 *  future stamped app starts from, so a violation there scales to 50 apps.
 *  The brick pattern is deliberately loose (`**`) because the service subtree
 *  sits under a Mustache conditional directory whose on-disk spelling is not
 *  stable — a tighter glob silently stopped matching it once. */
const PATTERNS = [
  'services/*/migrations/*.sql',
  'tooling/bricks/**/migrations/*.sql',
];

/** Path fragments that MUST appear among the matched files. A guard whose
 *  coverage quietly shrinks is worse than no guard: it still reports "clean".
 *
 *  🔴 THE LIST IS WRITTEN OUT, NOT DERIVED FROM `services/*` ON DISK, and that is
 *  the whole point: a derived list loses an entry at exactly the moment the
 *  directory it names disappears, which is the failure this check exists to
 *  catch. `services/subly-api` was MISSING here until 2026-08-01 — mutation-proven
 *  by renaming `services/subly-api/migrations`, after which the guard scanned 4
 *  files instead of 6 and still printed "clean". Its schema holds real user rows. */
const REQUIRED_COVERAGE = [
  { fragment: 'services/platform', label: 'the shared platform_db migrations' },
  { fragment: 'services/subly-api', label: "subly_db's own migrations — the flagship app's real user rows" },
  { fragment: 'tooling/bricks', label: "the brick's starter schema" },
];

/**
 * Blank out comments and string literals so prose like "no DROP, no RENAME" in a
 * header comment cannot trip the scanner. Replaces with spaces rather than
 * deleting, to keep byte offsets (and therefore line numbers) exact.
 */
function stripNonCode(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') out += ' ', i++;
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (; i < stop; i++) out += sql[i] === '\n' ? '\n' : ' ';
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      out += ' ';
      i++;
      while (i < sql.length && sql[i] !== quote) out += sql[i] === '\n' ? '\n' : ' ', i++;
      if (i < sql.length) out += ' ', i++;
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

/**
 * The statement a match belongs to: from the match to its terminating `;`, or to
 * end-of-file if there is none. Computed on the STRIPPED source, so neither a `;`
 * inside a string literal nor one inside a comment can end a statement early and
 * hide the rest of it from the WHERE test.
 */
function statementSpan(code, index) {
  const end = code.indexOf(';', index);
  return code.slice(index, end === -1 ? code.length : end + 1);
}

/** A destructive DML statement is banned only when NOTHING narrows it. */
const noWhereClause = (code, m) => !/\bWHERE\b/i.test(statementSpan(code, m.index));

/** `-- migration:destructive-approved <justification>` — the reviewed opt-in. */
const APPROVAL_RE = /--\s*migration:destructive-approved\s+(\S.*)$/;

/**
 * Is this statement explicitly approved? The marker must sit on the statement's
 * own first line, or in the contiguous run of comment/blank lines directly above
 * it — so it reads as annotating THIS statement and cannot be parked once at the
 * top of the file to bless everything below.
 *
 * Read from the RAW source deliberately: the marker IS a comment, so the stripped
 * view the scanner uses has already blanked it.
 */
function approvalFor(rawLines, line) {
  const own = rawLines[line - 1]?.match(APPROVAL_RE);
  if (own) return own[1].trim();
  for (let i = line - 2; i >= 0; i--) {
    const text = rawLines[i] ?? '';
    if (text.trim() === '') continue;
    if (!text.trimStart().startsWith('--')) return null; // hit real SQL — stop
    const m = text.match(APPROVAL_RE);
    if (m) return m[1].trim();
  }
  return null;
}

const RULES = [
  {
    name: 'DROP TABLE',
    re: /\bDROP\s+TABLE\b/gi,
    why: 'destroys data for every client still writing to it',
  },
  {
    name: 'DROP COLUMN',
    re: /\bDROP\s+COLUMN\b/gi,
    why: 'a released client still reads it — expand, then contract only after the last such build is gone',
  },
  {
    name: 'RENAME',
    re: /\bRENAME\s+(?:TO|COLUMN)\b/gi,
    why: 'a rename is a drop + an add to every already-shipped client',
  },
  {
    name: 'ALTER/MODIFY COLUMN',
    re: /\bALTER\s+TABLE\s+\S+\s+(?:ALTER|MODIFY)\s+(?:COLUMN\b)?/gi,
    why: "SQLite's dynamic typing accepts type changes silently, so this corrupts rather than errors",
  },
  {
    name: 'ADD COLUMN … NOT NULL without DEFAULT',
    // Match a single ADD COLUMN clause up to its terminating ';' — OR to the end
    // of the file.
    //
    // 🔴 THE `;` USED TO BE MANDATORY, and that made the LAST statement in every
    // migration unscannable (2026-08-01 corpus triage). Mutation-proven:
    // `ALTER TABLE events ADD COLUMN tenant TEXT NOT NULL` with no trailing
    // semicolon printed "7 migration file(s) clean"; add the `;` and the same
    // statement failed the build. A trailing semicolon is optional in SQL and
    // every migration has a final statement, so the one place a hand-written
    // file most often omits it was the one place this rule could not look.
    // wrangler applies the statement either way — the guard was the only thing
    // that cared about the punctuation.
    re: /\bADD\s+(?:COLUMN\s+)?[^;]*?\bNOT\s+NULL\b[^;]*?(?:;|$)/gi,
    why: 'SQLite cannot add a NOT NULL column without a constant DEFAULT',
    skip: (m) => /\bDEFAULT\b/i.test(m),
  },

  // ── the destructive DML class ─────────────────────────────────────────────
  // Everything below is `approvable`: it has a legitimate — rare — use, so it
  // gets the reviewed marker rather than a flat prohibition. The DDL rules above
  // deliberately do NOT, because there is no additive reading of a DROP COLUMN.
  {
    name: 'DELETE without WHERE',
    re: /\bDELETE\s+FROM\b/gi,
    why: 'an unfiltered DELETE empties the table for every client still reading it — and deploy-workers.yml applies migrations --remote with no human in the loop',
    when: noWhereClause,
    approvable: true,
  },
  {
    name: 'UPDATE … SET without WHERE',
    re: /\bUPDATE\s+(?:OR\s+\w+\s+)?[\w."`[\]]+\s+SET\b/gi,
    why: 'rewrites every row in the table — this is how a column gets nulled out wholesale; a backfill narrows itself with WHERE (see 0002_schema_debt.sql)',
    when: noWhereClause,
    approvable: true,
  },
  {
    name: 'TRUNCATE',
    re: /\bTRUNCATE\b/gi,
    why: 'discards the whole table with no filter and no undo',
    approvable: true,
  },
  {
    name: 'DROP DATABASE/SCHEMA',
    re: /\bDROP\s+(?:DATABASE|SCHEMA)\b/gi,
    why: 'destroys the shared store every stamped app writes to',
    approvable: true,
  },
  {
    name: 'INSERT OR REPLACE / REPLACE INTO',
    re: /\b(?:INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/gi,
    why: 'a silent DELETE + re-INSERT: every column the statement does not name is reset to its default, so a released client\'s data disappears without an error',
    approvable: true,
  },
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

let violations = 0;
const files = [];
for (const pattern of PATTERNS) {
  for await (const f of boundedGlob(pattern)) files.push(f);
}
files.sort();

if (files.length === 0) {
  console.error('check-migrations: no migration files matched — is the guard pointed at the right paths?');
  process.exit(1);
}

// Coverage check BEFORE the content scan, so a moved directory fails loudly
// instead of reporting "clean" over a set that no longer includes it.
const normalised = files.map((f) => f.replaceAll('\\', '/'));
let coverageMissing = 0;
for (const { fragment, label } of REQUIRED_COVERAGE) {
  if (!normalised.some((f) => f.includes(fragment))) {
    console.error(
      `check-migrations: COVERAGE LOST — no migration matched under "${fragment}" (${label}).\n` +
        '    The files did not become safe; the guard stopped looking at them. Fix PATTERNS.',
    );
    coverageMissing++;
  }
}
if (coverageMissing > 0) process.exit(1);

const approved = [];
for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const rawLines = raw.split('\n');
  const code = stripNonCode(raw);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code)) !== null) {
      if (rule.skip?.(m[0])) continue;
      if (rule.when && !rule.when(code, m)) continue;
      const line = lineOf(code, m.index);
      // The reviewed opt-in, and ONLY for the rules that declare one. An
      // approved statement is not silently waved through: it is collected and
      // printed on every run, pass or fail, so the exception stays visible.
      if (rule.approvable) {
        const why = approvalFor(rawLines, line);
        if (why) {
          approved.push(`${file}:${line}  ${rule.name} — approved: ${why}`);
          continue;
        }
      }
      console.error(
        `${file}:${line}  BANNED ${rule.name} — ${rule.why}\n` +
          `    ${rawLines[line - 1]?.trim() ?? ''}` +
          (rule.approvable
            ? '\n    If this is genuinely required, annotate the statement with' +
              ' `-- migration:destructive-approved <ADR or reason>` so the exception is reviewed in the diff.'
            : ''),
      );
      violations++;
    }
  }
}

if (approved.length) {
  console.log('⚠  destructive statements running under an explicit approval marker:');
  for (const a of approved) console.log(`    ${a}`);
}

if (violations > 0) {
  console.error(
    `\ncheck-migrations: ${violations} violation(s) across ${files.length} migration file(s).\n` +
      'Schema evolution is ADDITIVE-ONLY — see company/requirements/schema-evolution.md.\n' +
      'If a contraction is genuinely required it needs an owner decision + an ADR, not a bypass.',
  );
  process.exit(1);
}

console.log(`check-migrations: ${files.length} migration file(s) clean — additive-only holds.`);
