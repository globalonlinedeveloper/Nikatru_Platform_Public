#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-entitlement-contract.mjs — the money rail's schema is COMPLETE, and it
// is complete BEFORE the first payment lands.
//
// [pipeline 5]M-3 · M-2 · M-7. `Private/requirements/` makes migrations
// ADDITIVE-ONLY — the prose `schema-evolution.md` this line used to name was
// folded into that JSON spec on 2026-08-16 in commit e88fdcf, and the rule is
// now INV-505 (these migrations) + INV-S3-10 (the brick's starter schema) in
// invariants.json, with the client-side half kept as a ledger entry under origin
// `[REQ]schema-evolution §what-this-buys`. The deleted page reads back with
// `git -C Private show e88fdcf^:requirements/schema-evolution.md`.
// And `entitlements` is the one table in this
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
// FIVE LIMBS, each with a constructible failing input:
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
//   5 THE TWO WRITERS ORDER BY THE SAME CLOCK, WITH THE SAME CLAUSE — [5]M-2's
//     ordering defence, which limbs 1–4 do not touch. See below.
//
// ⚠️ EVERYTHING IS PARSED, NOTHING IS GREPPED. Comments AND string literals are
// blanked before the structural scan, because this repo has already shipped a
// guard whose `grep '"r2_buckets"'` matched the template comment EXPLAINING why
// there is no r2_buckets. The reason names ARE string literals, so limb 3 uses a
// second view with comments blanked and strings kept — and it reads them out of
// the INSERT statement's own VALUES tuples, never out of the file at large.
//
// ─────────────────────────────────────────────────────────────────────────────
// LIMB 5 · TWO WORKERS UPSERT THE SAME `entitlements` ROW, AND THEY MUST NOT
// DISAGREE ABOUT WHAT "OLDER" MEANS.
//
// Limbs 1–4 make the row COMPLETE. They say nothing about which write WINS when
// two arrive out of order, and that is a separate way to lose a stranger's
// money: neither RevenueCat nor a MoR gives an ordering guarantee, so a delayed
// retry of an OLDER event lands after a NEWER one and — under a plain
// `DO UPDATE SET` — silently overwrites the truth. A refunded customer regains
// access; a paying one loses it. Nothing errors, and every response is 200.
//
// The defence both writers implement is the same three lines, and it only works
// if it is LITERALLY the same:
//
//     WHERE entitlements.occurred_at IS NULL
//        OR excluded.occurred_at > entitlements.occurred_at
//
// `occurred_at` is the PROVIDER's clock (limb 1 requires the column for exactly
// this reason). Two writers with two different comparisons is worse than one
// writer with none: each is individually defensible and together they interleave
// — services/platform/src/lib/mor/store.ts (the MoR rail, HMAC-gated) and
// services/subly-api/src/routes/webhooks.ts (the LEGACY RevenueCat route, bearer
// -gated) write the SAME table for the SAME (user_id, app_id, entitlement) key.
//
// THREE THINGS ARE CHECKED, and each has an input that makes it fail ALONE:
//   (i)   every conditional UPSERT into `entitlements` anywhere under services/
//         carries that tail VERBATIM (whitespace-normalised). A DO UPDATE SET
//         with NO trailing WHERE is last-write-wins and fails loudest of all.
//   (ii)  the instant that feeds it is CANONICALISED — services/platform's
//         `normalizeInstant` and services/subly-api's `isoFromEpochMs` must each
//         let an instant out only through `new Date(…).toISOString()`. The
//         comparison is a STRING comparison in SQLite: ISO-8601 UTC sorts
//         lexicographically, `1754697600000` does not, and `2026-08-09T00:00:00
//         +05:30` sorts as if it were a different day. One writer storing
//         epoch-ms would make EVERY comparison against the other's rows garbage
//         while both files still contain the correct-looking clause.
//   (iii) each canonicaliser is CALLED from a file other than the one declaring
//         it. A canonicaliser nobody calls is a dead seam that reports healthy —
//         this repo has shipped four of those.
//
// 🔴 WHY THE CLAUSE IS PINNED HERE RATHER THAN THE TWO FILES BEING COMPARED TO
// EACH OTHER. "Extract both and assert equality" is the obvious shape and it is
// STRICTLY WEAKER: it passes when both drift the same way — a `>` flipped to
// `>=` in both files re-applies a duplicate delivery and the equality check says
// nothing. And once each file is pinned to the canonical text, a pairwise check
// between them CANNOT FAIL, which this repo deletes on sight (an assertion that
// cannot fail inflates apparent coverage). So: one constant, both files measured
// against it, and the parity is a consequence rather than a second assertion.
//
// 🔴 AND WHY COMMENTS ARE BLANKED FIRST, MEASURED NOT ASSUMED. webhooks.ts
// contains the clause TWICE: once as SQL, once inside the `// ORDERING` header
// comment that explains it. A text scan of that file finds the clause with the
// SQL deleted. (Measured on the real tree while writing this limb: 2 raw hits, 1
// after `stripSourceComments`.) The same trap as the `"r2_buckets"` grep above,
// in a file whose prose is unusually thorough — which is what made it reachable.
//
// SCOPE, STATED RATHER THAN LEFT TO INFERENCE: the sweep is `services/`, minus
// test directories (a test fixture seeding a row is not a writer of production
// truth). `tooling/bricks/app/__brick__` is NOT swept here — [ADR 020]:18 says a
// stamped app's Worker must never see a webhook, and assert-mor-adapters.mjs
// limb 1 already FAILS on any undeclared entitlement writer in the brick. The
// residual gap is honest and small: a brick writer DECLARED in that guard would
// escape this one, and declaring one is a reviewed line in a diff.
// ─────────────────────────────────────────────────────────────────────────────
//
// Usage:  node tooling/ci/assert-entitlement-contract.mjs [repoRoot]
// Exit 0 = the contract holds, 1 = it does not.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

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

// ── limb 5's constants ───────────────────────────────────────────────────────

/**
 * The ordering tail, VERBATIM after whitespace normalisation. Every part of it
 * is load-bearing:
 *   `entitlements.occurred_at IS NULL` — the FIRST write to a key has no clock
 *     to beat, and a clock-less row can still be upgraded by a clocked event.
 *   `excluded.occurred_at > entitlements.occurred_at` — strictly greater, so a
 *     re-delivery of the SAME event (same clock) is a no-op rather than a
 *     re-application. A clock-less event can never overwrite a clocked row,
 *     because `NULL > x` is NULL and NULL is not true.
 */
const ORDERING_CLAUSE =
  'WHERE entitlements.occurred_at IS NULL OR excluded.occurred_at > entitlements.occurred_at';

/** The tree limb 5 sweeps. Absent = COVERAGE LOST, never a clean run. */
const WRITER_SCAN = { dir: 'services', label: 'every deployed Worker — the sweep is not scoped to the rail that owns the table, because the rail that does NOT own it is the one that got missed' };

/**
 * The files that MUST each contain a conditional UPSERT into `entitlements`.
 * Derived-set-plus-required-members, the same shape as REQUIRED_COVERAGE above:
 * the sweep finds writers wherever they are, and this list is what stops the
 * sweep from silently finding NONE and printing ok.
 */
const REQUIRED_UPSERT_WRITERS = [
  {
    file: 'services/platform/src/lib/mor/store.ts',
    why: 'the MoR rail. Reached only after MoRWebhookVerifier.verify has checked an HMAC over the raw body',
  },
  {
    file: 'services/subly-api/src/routes/webhooks.ts',
    why: 'the LEGACY RevenueCat route — live, deployed, bearer-gated, and writing the SAME shared table. A guard scoped to services/platform prints clean standing right next to it',
  },
];

/**
 * The two instant canonicalisers. Named with the file that declares them so a
 * rename is a diff rather than a silent COVERAGE LOST.
 */
const INSTANT_PATHS = [
  {
    file: 'services/platform/src/lib/mor/contract.ts',
    fn: 'normalizeInstant',
    why: "the MoR side. Providers send instants as strings in whatever shape they like; this is the one place that turns them into the UTC ISO-8601 the clause compares",
  },
  {
    file: 'services/subly-api/src/lib/validate.ts',
    fn: 'isoFromEpochMs',
    why: "the RevenueCat side. `event_timestamp_ms` is epoch MILLISECONDS — stored raw it would sort as a number-shaped string against the other writer's ISO strings, and every comparison between the two would be nonsense",
  },
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

// ── LIMB 5 · the two writers agree on what "older" means ─────────────────────

/** Every `.ts` under `dir` that is production source. */
function tsSourcesUnder(dir, out = []) {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    // node_modules/dist/.wrangler are build output, not source. `test`/`tests`
    // are excluded because a fixture seeding a row is not a writer of
    // production truth — services/subly-api/test/webhooks.test.ts alone holds
    // three `INSERT INTO entitlements` that exist to SET UP a stale row.
    if (['node_modules', 'dist', '.wrangler', 'test', 'tests'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) tsSourcesUnder(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * Every string/template literal in `src`, as {start, end, text}. Run over a
 * COMMENT-BLANKED view, so a backtick or an apostrophe inside a comment cannot
 * open a phantom literal. An unterminated single/double-quoted literal is closed
 * at the newline for the same reason assert-mor-adapters does it: one stray
 * apostrophe must not swallow the rest of the file.
 */
function stringSpans(src) {
  const spans = [];
  let i = 0;
  while (i < src.length) {
    const q = src[i];
    if (q !== "'" && q !== '"' && q !== '`') {
      i++;
      continue;
    }
    const start = i;
    i++;
    while (i < src.length) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === q) { i++; break; }
      if (q !== '`' && src[i] === '\n') break;
      i++;
    }
    spans.push({ start, end: i, text: src.slice(start + 1, Math.max(start + 1, i - 1)) });
  }
  return spans;
}

/** `src` with every string literal's interior blanked, offsets preserved. */
function blankSpans(src) {
  const out = src.split('');
  for (const s of stringSpans(src)) {
    for (let k = s.start + 1; k < s.end - 1 && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  }
  return out.join('');
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

const scanRoot = join(ROOT, WRITER_SCAN.dir);
/** rel path -> array of {conditional, tail} for each entitlements write found. */
const entitlementWrites = new Map();
let upsertsScanned = 0;

if (!existsSync(scanRoot)) {
  fail(
    `COVERAGE LOST — ${WRITER_SCAN.dir}/ does not exist (${WRITER_SCAN.label}), so limb 5 compared no writers at all. ` +
      'A parity check over zero writers is unanimous.',
  );
} else {
  for (const abs of tsSourcesUnder(scanRoot)) {
    const rel = abs.replace(ROOT, '').replace(/^[\\/]/, '').replaceAll('\\', '/');
    const src = stripSourceComments(readFileSync(abs, 'utf8'), '.ts');
    for (const span of stringSpans(src)) {
      if (!/INSERT\s+INTO\s+entitlements\b/i.test(span.text)) continue;
      const sql = span.text;
      const doUpdate = /ON\s+CONFLICT[\s\S]*?DO\s+UPDATE\s+SET/i.exec(sql);
      if (!doUpdate) {
        // An INSERT with no ON CONFLICT is not an upsert and cannot silently
        // lose to a stale retry — it raises. Recorded (so the required-writer
        // check below can tell "no upsert here" from "file not scanned") and
        // otherwise left alone.
        if (!entitlementWrites.has(rel)) entitlementWrites.set(rel, []);
        entitlementWrites.get(rel).push({ conditional: false, tail: null });
        continue;
      }
      upsertsScanned += 1;
      const after = doUpdate.index + doUpdate[0].length;
      let whereAt = -1;
      for (const w of sql.matchAll(/\bWHERE\b/gi)) if (w.index >= after) whereAt = w.index;
      const tail = whereAt === -1 ? null : norm(sql.slice(whereAt));
      if (!entitlementWrites.has(rel)) entitlementWrites.set(rel, []);
      entitlementWrites.get(rel).push({ conditional: true, tail });
      if (tail === null) {
        fail(
          `${rel} — the UPSERT into \`entitlements\` is UNCONDITIONAL: \`DO UPDATE SET\` with no trailing WHERE. ` +
            'That is last-write-wins, and neither rail guarantees ordering — a delayed retry of an OLDER event ' +
            `silently overwrites a newer truth, 200 all the way. Expected: ${ORDERING_CLAUSE}`,
        );
      } else if (tail !== ORDERING_CLAUSE) {
        fail(
          `${rel} — the UPSERT's ordering clause is not the shared one. Two writers of the SAME row with two ` +
            'different comparisons interleave, and each one reads as defensible on its own.\n' +
            `      found:    ${tail}\n` +
            `      required: ${ORDERING_CLAUSE}`,
        );
      }
    }
  }

  for (const { file, why } of REQUIRED_UPSERT_WRITERS) {
    const found = entitlementWrites.get(file) ?? [];
    if (!existsSync(join(ROOT, file))) {
      fail(`COVERAGE LOST — ${file} does not exist (${why}), so its ordering clause was compared against nothing.`);
    } else if (!found.some((w) => w.conditional)) {
      fail(
        `COVERAGE LOST — no conditional UPSERT into \`entitlements\` was parsed out of ${file} (${why}). ` +
          'Either the writer lost its `ON CONFLICT … DO UPDATE SET`, or the scan stopped reaching it — ' +
          'and the two are indistinguishable from a clean run.',
      );
    }
  }
}

// (ii) the instant that feeds the clause is canonicalised, and (iii) something
// calls the thing that canonicalises it.
const instantSources = existsSync(scanRoot)
  ? tsSourcesUnder(scanRoot).map((abs) => ({
      rel: abs.replace(ROOT, '').replace(/^[\\/]/, '').replaceAll('\\', '/'),
      src: stripSourceComments(readFileSync(abs, 'utf8'), '.ts'),
    }))
  : [];

for (const { file, fn, why } of INSTANT_PATHS) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) {
    fail(`COVERAGE LOST — ${file} does not exist, so \`${fn}\` (${why}) was checked against nothing.`);
    continue;
  }
  const src = stripSourceComments(readFileSync(abs, 'utf8'), '.ts');
  const decl = new RegExp(String.raw`export\s+function\s+${fn}\s*\(`).exec(src);
  if (!decl) {
    fail(
      `COVERAGE LOST — no \`export function ${fn}\` in ${file}. ${why}. ` +
        'A renamed canonicaliser is not a checked one, and the rename is invisible from here.',
    );
    continue;
  }
  // The declaration through its top-level closing brace. `}` at column 0 ends a
  // top-level function; the brace-balance check below is what turns that from an
  // assumption into a measurement — a region truncated early does not balance,
  // and an unbalanced region would under-count the returns silently.
  const endRel = src.slice(decl.index).search(/\n\}/);
  if (endRel === -1) {
    fail(`COVERAGE LOST — could not find the end of \`${fn}\` in ${file}; nothing below was measured.`);
    continue;
  }
  const region = src.slice(decl.index, decl.index + endRel + 2);
  const regionCode = blankSpans(region);
  const opens = (regionCode.match(/\{/g) ?? []).length;
  const closes = (regionCode.match(/\}/g) ?? []).length;
  if (opens !== closes) {
    fail(
      `COVERAGE LOST — the parsed body of \`${fn}\` in ${file} does not brace-balance (${opens} open, ${closes} close). ` +
        'The region is truncated, so every assertion over it is over a fragment.',
    );
    continue;
  }

  if (!/new\s+Date\s*\([^()]*\)\s*\.\s*toISOString\s*\(\s*\)/.test(region)) {
    fail(
      `${fn} in ${file} never produces \`new Date(…).toISOString()\`. ${why}. ` +
        'The ordering clause is a STRING comparison in SQLite: ISO-8601 UTC sorts lexicographically, epoch-ms ' +
        'does not, and an offset like +05:30 sorts as a different day. A non-canonical instant makes the clause ' +
        'in both files correct-looking and the comparison between them meaningless.',
    );
  }
  // Every return is either a constant refusal or a canonicalised instant. This
  // is the limb that catches an ADDED bypass — `if (typeof v === 'string')
  // return v;` — which leaves the canonical expression sitting untouched a few
  // lines below, so the check above still passes.
  for (const m of region.matchAll(/\breturn\b([^;]*);/g)) {
    const expr = m[1].trim();
    if (/\.\s*toISOString\s*\(\s*\)/.test(expr)) continue;
    const residue = expr.replace(/\b(null|true|false|ok|iso)\b/g, '').replace(/[{}:,;\s]/g, '');
    if (residue !== '') {
      fail(
        `${fn} in ${file} returns \`${norm(expr)}\` — an instant that did not go through \`.toISOString()\`. ` +
          'The only two things this function may hand back are a constant "not an instant" answer and a ' +
          'canonicalised one; anything else is a raw provider value reaching the ordering comparison.',
      );
    }
  }

  // 🔴 A DECLARATION IS NOT A CALL, and the other file's declaration is not
  // either. assert-seams-wired.mjs shipped with its caller check matching the
  // function's OWN declaration and passed with every real caller deleted; the
  // same shape one file over is a FORK — someone copied the canonicaliser rather
  // than importing it — which would satisfy a naive `NAME(` match while leaving
  // the seam dead. So declarations are blanked before the call test, in both
  // their `function NAME(` and `const NAME = (` spellings.
  const declShapes = new RegExp(String.raw`\b(?:function\s+${fn}|(?:const|let|var)\s+${fn}\s*=)\s*\(`, 'g');
  const callRe = new RegExp(String.raw`\b${fn}\s*\(`);
  const callers = instantSources.filter((f) => f.rel !== file && callRe.test(f.src.replace(declShapes, ' ')));
  if (callers.length === 0) {
    fail(
      `${fn} is declared in ${file} but CALLED from nowhere else under ${WRITER_SCAN.dir}/. ` +
        'A canonicaliser nobody calls is a dead seam that reports healthy — the writer is canonicalising ' +
        'somewhere else, or not at all, and this whole limb would keep printing ok.',
    );
  }
}

// ── report ───────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ entitlement contract — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline 5]M-3 The entitlement record is complete BEFORE the first payment lands.');
  console.error('  Private/requirements/ makes migrations ADDITIVE-ONLY (INV-505, INV-S3-10), so every');
  console.error('  column above is free today and permanent the instant a stranger pays.');
  // [5]M-2, matching the citation the code itself carries at
  // services/subly-api/src/routes/webhooks.ts:505 ("the conditional DO UPDATE is
  // [5]M-2's ordering defence"). M-8 is the neighbouring rule about NOT revoking
  // on cancel-at-period-end and is a different requirement.
  console.error("  [5]M-2 Ordering is the provider's clock, and it is the SAME clause in both writers.");
  process.exit(1);
}

console.log(
  `ok  entitlement contract — ${files.length} migration file(s); entitlements carries ${ent.size} column(s) ` +
    `including all ${REQUIRED_ENTITLEMENT_COLUMNS.length} the money rail requires; ${REQUIRED_TABLES.length} rail table(s) ` +
    `present with their uniqueness constraints; ${seeded.size} revocation reason(s) seeded and matching ${CONTRACT_TS}; ` +
    `${upsertsScanned} conditional UPSERT(s) into entitlements across ${entitlementWrites.size} file(s) under ` +
    `${WRITER_SCAN.dir}/ carry the one ordering clause, fed by ${INSTANT_PATHS.length} canonicaliser(s) that emit ` +
    'nothing but new Date(…).toISOString()',
);
