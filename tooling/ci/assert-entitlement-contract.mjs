#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-entitlement-contract.mjs — the money rail's schema is COMPLETE, and it
// is complete BEFORE the first payment lands.
//
// [pipeline 5]M-3 · M-2 · M-7. `company/requirements/schema-evolution.md` makes
// migrations ADDITIVE-ONLY, and `entitlements` is the one table in this
// portfolio whose rows are a stranger's money. The instant the first payment
// lands, every column missing from it is missing FOREVER for that row: there is
// no back-fill for a fact the provider only ever sent once, in a notification we
// had no column to keep.
//
// 🔴 WHY check-migrations.mjs IS NOT THIS REQUIREMENT'S ENFORCER, stated where
// it matters. That guard is a DESTRUCTIVE-CHANGE scanner. It has no concept of a
// required column, and it passes precisely when nobody has changed anything — so
// the way to satisfy it is to leave the schema wrong. Citing it here would be
// citing an assertion that cannot fail for this property. The two are
// complementary and neither substitutes for the other.
//
// FOUR LIMBS, each with a constructible failing input:
//   1 REQUIRED COLUMNS on `entitlements`, computed from the CREATE plus every
//     ALTER … ADD COLUMN across the whole migration set.
//   2 REQUIRED TABLES + their columns + their UNIQUENESS constraints. A
//     verbatim notification store with no unique index is not "exactly once".
//   3 THE REVOCATION REASON SET, parsed from the seed INSERT's VALUES tuples.
//     The enum is decided in that migration or never — rows written before a
//     value exists are unclassifiable forever.
//   4 THE SET IN SQL EQUALS THE SET IN CODE. `REVOCATION_REASONS` in
//     services/platform/src/lib/mor/contract.ts must match the seeded rows
//     exactly, including which member RESTORES access. A set that lives in two
//     places drifts in one of them, and the drift is invisible until a refund
//     lands. (This is not hypothetical: the two were written minutes apart and
//     were already out of step by one member.)
//
// ⚠️ EVERYTHING IS PARSED, NOTHING IS GREPPED. Comments AND string literals are
// blanked before the structural scan, because this repo has already shipped a
// guard whose `grep '"r2_buckets"'` matched the template comment EXPLAINING why
// there is no r2_buckets. The reason names ARE string literals, so limb 3 uses a
// second view with comments blanked and strings kept — and it reads them out of
// the INSERT statement's own VALUES tuples, never out of the file at large.
//
// Usage:  node tooling/ci/assert-entitlement-contract.mjs [repoRoot]
// Exit 0 = the contract holds, 1 = it does not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

/** The migration sets this guard reads. A fragment missing = COVERAGE LOST. */
const REQUIRED_COVERAGE = [
  { dir: 'services/platform/migrations', label: 'the shared platform_db migrations — where the entitlement lives' },
];

/** The TypeScript half of limb 4. */
const CONTRACT_TS = 'services/platform/src/lib/mor/contract.ts';

/**
 * [5]M-3's column set. LARGER than the requirement's own sentence, because D-1
 * closed on a subscription WITH A 30-DAY TRIAL and the trial is a separate date
 * with separate consequences. Each entry names the question that is
 * unanswerable without it — a column list with no reasons is a list nobody can
 * argue with, and every one of these is permanent the moment a stranger pays.
 */
const REQUIRED_ENTITLEMENT_COLUMNS = [
  ['provider', 'which rail wrote this row — a refund on one rail cannot be matched to a grant on another without it'],
  ['provider_environment', 'live or sandbox — [5]M-12, so sandbox money can never grant a production unlock'],
  ['provider_subscription_id', 'the stable handle across grant → renewal → cancel → refund'],
  ['provider_transaction_id', 'the single payment that last moved; a refund names a transaction, not a subscription'],
  ['provider_status', "the provider's status VERBATIM — a boolean cannot represent trialing / past_due / paused, and a flattened value cannot be un-flattened later"],
  ['last_event_id', 'which notification last wrote this row — "why is this row like this" needs one answer'],
  ['occurred_at', "the provider's own clock, which is the ORDERING authority; updated_at is receipt time and orders the retries instead"],
  ['current_period_end', 'the paid-through date, distinct from a trial end'],
  ['trial_end', 'when the free part ends — the path regulators scrutinise hardest'],
  ['revoked_at', 'when access was taken away'],
  ['revocation_reason', 'WHY — the difference between a support reply, a fraud signal and a win-back'],
];

/** The tables [5]M-2 and [5]M-7 need, with the columns that make them useful. */
const REQUIRED_TABLES = [
  {
    table: 'provider_notifications',
    why: '[5]M-2 — a notification recorded VERBATIM, exactly once, before it is interpreted',
    columns: ['provider', 'provider_event_id', 'event_type', 'occurred_at', 'environment', 'received_at', 'payload', 'derived_at', 'derive_error'],
    unique: ['provider', 'provider_event_id'],
    uniqueWhy: 'without it, "exactly once" is a hope. A retried delivery becomes a second event and the derivation runs twice.',
  },
  {
    table: 'provider_accounts',
    why: "[5]M-7 — the (provider, subscription) → account link, written once, so a RENEWAL is attributable without depending on whether the rail propagates checkout metadata",
    columns: ['provider', 'provider_subscription_id', 'app_id', 'user_id', 'linked_at'],
    unique: ['provider', 'provider_subscription_id'],
    uniqueWhy: 'two links for one subscription means two accounts could each be told they own the same payment.',
  },
  {
    table: 'unclaimed_payments',
    why: '[5]M-7 — money arrived and no account could be resolved. A row here is the difference between a resolvable support ticket and none',
    columns: ['provider', 'provider_event_id', 'received_at', 'claimed_at'],
    unique: ['provider', 'provider_event_id'],
    uniqueWhy: 'a retried unresolvable notification would otherwise pile up one row per delivery attempt.',
  },
  {
    table: 'revocation_reasons',
    why: '[5]M-3 — the enum as a machine-readable artifact rather than a comment or a CHECK constraint that could never be extended',
    columns: ['reason', 'restores_access'],
    unique: null,
    uniqueWhy: null,
  },
];

/**
 * [5]M-3's minimum reason set. `chargeback_reversed` is the one member that
 * RESTORES access — without it a customer who raised a dispute in error, and
 * lost it, stays locked out forever, because nothing else in this rail gives
 * access back.
 */
const REQUIRED_REASONS = [
  'refund_approved',
  'chargeback',
  'chargeback_reversed',
  'subscription_expired',
  'trial_expired',
  'payment_failed_final',
  'cancelled_at_period_end',
];

const problems = [];
const fail = (m) => problems.push(m);

/** Blank comments, and optionally string literals, preserving offsets. */
function strip(sql, { strings = true } = {}) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      for (; i < stop; i++) out += sql[i] === '\n' ? '\n' : ' ';
    } else if (strings && (sql[i] === "'" || sql[i] === '"')) {
      const quote = sql[i];
      out += ' ';
      i++;
      while (i < sql.length && sql[i] !== quote) { out += sql[i] === '\n' ? '\n' : ' '; i++; }
      if (i < sql.length) { out += ' '; i++; }
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

/** The balanced `(...)` beginning at the first `(` at or after `from`. */
function balanced(text, from) {
  const open = text.indexOf('(', from);
  if (open === -1) return '';
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === '(') depth++;
    else if (text[k] === ')') { depth--; if (depth === 0) return text.slice(open + 1, k); }
  }
  return '';
}

/** Column names declared in a CREATE TABLE body: the first token of each
 *  top-level comma-separated item that is not a table constraint. */
function columnsOfCreateBody(body) {
  const out = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    const t = current.trim();
    current = '';
    if (t === '') return;
    const first = t.split(/\s+/)[0].toUpperCase();
    if (['PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'CONSTRAINT'].includes(first)) return;
    out.push(t.split(/\s+/)[0].replace(/["'`[\]]/g, ''));
  };
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { flush(); continue; }
    current += ch;
  }
  flush();
  return out;
}

// ── read the migration set ───────────────────────────────────────────────────
const files = [];
for (const { dir, label } of REQUIRED_COVERAGE) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) {
    console.error(`✗ COVERAGE LOST — ${dir} does not exist (${label}). The files did not become correct; the guard stopped looking at them.`);
    process.exit(1);
  }
  const found = listDir(abs).filter((f) => f.endsWith('.sql')).sort();
  if (found.length === 0) {
    console.error(`✗ COVERAGE LOST — no .sql files under ${dir} (${label}).`);
    process.exit(1);
  }
  for (const f of found) files.push({ rel: `${dir}/${f}`, raw: readFileSync(join(abs, f), 'utf8') });
}

const code = files.map((f) => strip(f.raw)).join('\n');
const codeWithStrings = files.map((f) => strip(f.raw, { strings: false })).join('\n');

// ── LIMB 1 · the entitlement contract ────────────────────────────────────────
const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w]*)/gi;
const tables = new Map(); // name -> Set(columns)
/** Tables that were CREATEd, as opposed to merely ALTERed. See below. */
const createdTables = new Set();
for (const m of code.matchAll(createRe)) {
  const name = m[1];
  const body = balanced(code, m.index + m[0].length);
  if (!tables.has(name)) tables.set(name, new Set());
  createdTables.add(name);
  for (const c of columnsOfCreateBody(body)) tables.get(name).add(c);
}
for (const m of code.matchAll(/ALTER\s+TABLE\s+([A-Za-z_][\w]*)\s+ADD\s+(?:COLUMN\s+)?([A-Za-z_][\w]*)/gi)) {
  if (!tables.has(m[1])) tables.set(m[1], new Set());
  tables.get(m[1]).add(m[2]);
}

const ent = tables.get('entitlements');
// 🔴 THE `CREATE` IS REQUIRED, NOT JUST THE COLUMN SET. Found by the guard's own
// negative test: with 0001 blanked, the eleven `ALTER TABLE entitlements ADD
// COLUMN` statements in 0004 were enough to synthesise an `entitlements` entry
// with eleven columns, so every required-column assertion passed over a table
// the migration set never creates. A column list assembled purely from ALTERs
// describes a table that does not exist.
if (!ent || !createdTables.has('entitlements')) {
  console.error('✗ COVERAGE LOST — no CREATE TABLE for `entitlements` was parsed out of the migration set.');
  console.error('  The parser found nothing, so every column assertion below would pass over an empty set.');
  console.error('  (ALTER … ADD COLUMN alone does not count: it describes a table nothing creates.)');
  process.exit(1);
}
// A parser liveness floor, not a coverage number: 0001 declares eight columns,
// so a parse that produced fewer has broken rather than the schema having shrunk
// (schema-evolution.md forbids removing one).
if (ent.size < 8) {
  console.error(`✗ COVERAGE LOST — parsed only ${ent.size} column(s) for \`entitlements\`; 0001 alone declares 8. The parser is broken, not the tree.`);
  process.exit(1);
}
for (const [col, why] of REQUIRED_ENTITLEMENT_COLUMNS) {
  if (!ent.has(col)) {
    fail(`entitlements.${col} — MISSING. ${why}. [5]M-3: this column is free today and permanent the instant a stranger pays.`);
  }
}

// ── LIMB 2 · the tables the rail cannot work without ─────────────────────────
/** UNIQUE INDEX column lists, keyed by table. */
const uniqueIndexes = new Map();
for (const m of code.matchAll(/CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[A-Za-z_][\w]*\s+ON\s+([A-Za-z_][\w]*)/gi)) {
  const cols = balanced(code, m.index + m[0].length)
    .split(',')
    .map((c) => c.trim().replace(/["'`[\]]/g, ''))
    .filter(Boolean);
  if (!uniqueIndexes.has(m[1])) uniqueIndexes.set(m[1], []);
  uniqueIndexes.get(m[1]).push(cols);
}

for (const spec of REQUIRED_TABLES) {
  const cols = tables.get(spec.table);
  if (!cols) {
    fail(`table \`${spec.table}\` — MISSING. ${spec.why}.`);
    continue;
  }
  for (const c of spec.columns) {
    if (!cols.has(c)) fail(`${spec.table}.${c} — MISSING. ${spec.why}.`);
  }
  if (spec.unique) {
    const sets = uniqueIndexes.get(spec.table) ?? [];
    const want = spec.unique.join(',');
    if (!sets.some((s) => s.join(',') === want)) {
      fail(
        `${spec.table} — no UNIQUE INDEX on (${spec.unique.join(', ')}). ${spec.uniqueWhy} ` +
          'A uniqueness guarantee that lives only in the INSERT statement is a guarantee two concurrent deliveries can both pass.',
      );
    }
  }
}

// ── LIMB 3 · the revocation reason set, parsed from the seed's VALUES ────────
const insertMatch = /INSERT\s+INTO\s+revocation_reasons\s*\(([^)]*)\)\s*VALUES/i.exec(codeWithStrings);
let seeded = new Map(); // reason -> restores(boolean)
if (!insertMatch) {
  fail(
    'no `INSERT INTO revocation_reasons (…) VALUES …` seed found. [5]M-3: the reason set is decided in the ' +
      'migration or never — rows written before a value exists are unclassifiable forever, and there is no back-fill.',
  );
} else {
  const header = insertMatch[1].split(',').map((s) => s.trim().replace(/["'`[\]]/g, ''));
  const reasonIdx = header.indexOf('reason');
  const restoresIdx = header.indexOf('restores_access');
  if (reasonIdx === -1 || restoresIdx === -1) {
    fail('the revocation_reasons seed does not name both `reason` and `restores_access` columns.');
  } else {
    // Everything from VALUES to the statement terminator, split into tuples.
    //
    // ⚠️ STRING LITERALS ARE TRACKED WHILE COUNTING PARENTHESES, and that is not
    // fussiness. This view of the SQL keeps strings (limb 3 is ABOUT the string
    // values), and the seeded descriptions are English sentences that contain
    // both parentheses — "(stage 13)" — and commas. The first version of this
    // scanner counted every `(` including the ones inside a description, which
    // desynchronised the depth counter and made it read the COLUMN NAME `reason`
    // as a seeded value. It failed loudly rather than passing wrongly, which is
    // the right direction, but a parser that miscounts can fail in the other
    // direction just as easily.
    const after = codeWithStrings.slice(insertMatch.index + insertMatch[0].length);
    const semi = (() => {
      let inStr = false;
      for (let i = 0; i < after.length; i++) {
        if (after[i] === "'") {
          if (inStr && after[i + 1] === "'") { i++; continue; }
          inStr = !inStr;
        } else if (after[i] === ';' && !inStr) return i;
      }
      return after.length;
    })();
    // …and stop at the conflict clause. `ON CONFLICT(reason) DO NOTHING` ends
    // the statement with a PARENTHESISED COLUMN LIST, which a tuple scanner
    // reads as one more VALUES tuple — so the guard "found" a seeded reason
    // called `reason` and reported it as drift against the TypeScript set.
    // Caught by running the guard against the real tree before writing a line of
    // its tests: the fixture that would have exercised this is the fixture
    // nobody thinks to write, because the bug is in the parser rather than in
    // the thing being parsed.
    const stmt = (() => {
      const body = after.slice(0, semi);
      let inStr = false;
      for (let i = 0; i < body.length; i++) {
        if (body[i] === "'") {
          if (inStr && body[i + 1] === "'") { i++; continue; }
          inStr = !inStr;
          continue;
        }
        if (!inStr && /^ON\s+CONFLICT\b/i.test(body.slice(i, i + 20))) return body.slice(0, i);
      }
      return body;
    })();

    /** Top-level tuples, and within each, top-level comma-separated parts. */
    const tuples = [];
    {
      let depth = 0;
      let inStr = false;
      let cur = '';
      for (let i = 0; i < stmt.length; i++) {
        const ch = stmt[i];
        if (ch === "'") {
          if (inStr && stmt[i + 1] === "'") { cur += "''"; i++; continue; }
          inStr = !inStr;
          if (depth >= 1) cur += ch;
          continue;
        }
        if (!inStr && ch === '(') {
          depth++;
          if (depth === 1) { cur = ''; continue; }
        }
        if (!inStr && ch === ')') {
          depth--;
          if (depth === 0) { tuples.push(cur); continue; }
        }
        if (depth >= 1) cur += ch;
      }
    }
    for (const t of tuples) {
      const parts = [];
      let inStr = false;
      let piece = '';
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === "'") {
          if (inStr && t[i + 1] === "'") { piece += "''"; i++; continue; }
          inStr = !inStr;
          piece += ch;
          continue;
        }
        if (ch === ',' && !inStr) { parts.push(piece); piece = ''; continue; }
        piece += ch;
      }
      parts.push(piece);
      const reason = (parts[reasonIdx] ?? '').trim().replace(/^'|'$/g, '');
      const restores = (parts[restoresIdx] ?? '').trim() === '1';
      if (reason) seeded.set(reason, restores);
    }
    if (seeded.size === 0) {
      fail('COVERAGE LOST — the revocation_reasons seed was found but no VALUES tuple could be parsed out of it.');
    }
    for (const r of REQUIRED_REASONS) {
      if (!seeded.has(r)) {
        fail(
          `revocation reason '${r}' is NOT seeded. [5]M-3: the set is permanent once rows exist. ` +
            (r === 'chargeback_reversed'
              ? 'This is the one member that RESTORES access — without it a customer who lost a dispute they raised in error stays locked out forever.'
              : ''),
        );
      }
    }
    const restoring = [...seeded].filter(([, v]) => v).map(([k]) => k);
    if (restoring.length === 0) {
      fail('no seeded revocation reason has `restores_access = 1`. Nothing in this rail would ever give access back.');
    }
  }
}

// ── LIMB 4 · the set in SQL equals the set in CODE ───────────────────────────
const tsPath = join(ROOT, CONTRACT_TS);
if (!existsSync(tsPath)) {
  fail(
    `COVERAGE LOST — ${CONTRACT_TS} does not exist, so the SQL set is compared against nothing. ` +
      'A guard that checks one half of a two-place set has stopped checking the property it names.',
  );
} else {
  const ts = readFileSync(tsPath, 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
    .join('\n');
  const arr = /REVOCATION_REASONS\s*:\s*readonly\s+RevocationReason\[\]\s*=\s*\[([\s\S]*?)\n\]/.exec(ts);
  const inCode = new Map();
  if (arr) {
    for (const m of arr[1].matchAll(/reason:\s*'([^']+)'\s*,\s*restores:\s*(true|false)/g)) {
      inCode.set(m[1], m[2] === 'true');
    }
  }
  if (inCode.size === 0) {
    fail(
      `COVERAGE LOST — parsed zero entries from REVOCATION_REASONS in ${CONTRACT_TS}. ` +
        'An empty right-hand side agrees with any left-hand side.',
    );
  } else if (seeded.size > 0) {
    for (const [reason, restores] of inCode) {
      if (!seeded.has(reason)) {
        fail(
          `revocation reason '${reason}' exists in ${CONTRACT_TS} but is NOT seeded in the migration. ` +
            'The rail can write a value the database has never heard of, and nothing downstream can classify it.',
        );
      } else if (seeded.get(reason) !== restores) {
        fail(
          `revocation reason '${reason}' disagrees about RESTORING ACCESS — code says ${restores}, the seed says ${seeded.get(reason)}. ` +
            'One of the two is wrong about whether a customer gets their subscription back.',
        );
      }
    }
    for (const reason of seeded.keys()) {
      if (!inCode.has(reason)) {
        fail(
          `revocation reason '${reason}' is seeded in the migration but absent from ${CONTRACT_TS}. ` +
            'A reason no code can write is a column value that will never appear — and the set was supposed to be decided once.',
        );
      }
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ entitlement contract — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 5]M-3 The entitlement record is complete BEFORE the first payment lands.');
  console.error('  company/requirements/schema-evolution.md makes migrations ADDITIVE-ONLY, so every');
  console.error('  column above is free today and permanent the instant a stranger pays.');
  process.exit(1);
}

console.log(
  `ok  entitlement contract — ${files.length} migration file(s); entitlements carries ${ent.size} column(s) ` +
    `including all ${REQUIRED_ENTITLEMENT_COLUMNS.length} the money rail requires; ${REQUIRED_TABLES.length} rail table(s) ` +
    `present with their uniqueness constraints; ${seeded.size} revocation reason(s) seeded and matching ${CONTRACT_TS}`,
);
