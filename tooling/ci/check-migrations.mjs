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
// Not banned: DROP INDEX (indexes carry no data and are rebuildable), and
// DROP … IF EXISTS on a *temporary* object inside an explicit expand-contract
// migration — which must be reviewed by a human, not waved through by a regex.
//
// Usage:  node tooling/ci/check-migrations.mjs
// Exit 0 = clean, 1 = violations (printed with file:line).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';

/** Migration sets under guard. The brick's is included: it is the schema every
 *  future stamped app starts from, so a violation there scales to 50 apps. */
const PATTERNS = [
  'services/*/migrations/*.sql',
  'tooling/bricks/app/__brick__/services/*/migrations/*.sql',
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
    // Match a single ADD COLUMN clause up to its terminating ';'.
    re: /\bADD\s+(?:COLUMN\s+)?[^;]*?\bNOT\s+NULL\b[^;]*?;/gi,
    why: 'SQLite cannot add a NOT NULL column without a constant DEFAULT',
    skip: (m) => /\bDEFAULT\b/i.test(m),
  },
];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

let violations = 0;
const files = [];
for (const pattern of PATTERNS) {
  for await (const f of glob(pattern)) files.push(f);
}
files.sort();

if (files.length === 0) {
  console.error('check-migrations: no migration files matched — is the guard pointed at the right paths?');
  process.exit(1);
}

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const code = stripNonCode(raw);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(code)) !== null) {
      if (rule.skip?.(m[0])) continue;
      const line = lineOf(code, m.index);
      console.error(
        `${file}:${line}  BANNED ${rule.name} — ${rule.why}\n` +
          `    ${raw.split('\n')[line - 1]?.trim() ?? ''}`,
      );
      violations++;
    }
  }
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
