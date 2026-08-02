#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-data-inventory.mjs — one declared inventory behind every disclosure.
//
// [pipeline K-8] "One declared personal-data inventory behind every disclosure."
//
// A privacy policy is a claim about where data goes. Until this guard existed
// nothing in the repository could answer "where does data go" at all: the
// answer was spread across five migration files, three wrangler configs and one
// Pages Function whose KV binding is declared in a dashboard and appears in no
// file here. A disclosure written against a system nobody enumerated is a
// disclosure that goes stale the first time somebody adds a table.
//
// 🔴 THE ROW SET MUST EQUAL THE DERIVED STORE SET, IN BOTH DIRECTIONS.
//     a store with no row  → FAIL. Data arrived and nothing disclosed it.
//     a row with no store  → FAIL. This is the direction that stops the file
//                            becoming a wish-list: without it, renaming a table
//                            leaves a row describing a schema that is gone, and
//                            the inventory goes on looking complete.
//
// HOW THE RIGHT-HAND SIDE IS DERIVED — three walks, none of them a grep:
//   1. every CREATE TABLE in services/*/migrations/*.sql, with COMMENTS AND
//      STRING LITERALS STRIPPED FIRST. A table name in a comment is not a table.
//      (This repo has already shipped a guard that matched the comment
//      explaining why a binding did NOT exist, and reported the opposite of the
//      truth.)
//   2. every d1_databases / kv_namespaces / r2_buckets entry in EVERY wrangler
//      config in the repo, PARSED as JSONC. ⚠️ Repo-wide deliberately:
//      assert-clone-contract.mjs reads only services/<app>-api/wrangler.jsonc,
//      so services/subly-api is invisible to it — borrowing that walk would have
//      inherited the blind spot and reported full coverage of a subset.
//   3. every KV binding a Cloudflare Pages Function calls. These are bound in
//      the dashboard, not in any config here, and one of them holds the only
//      plain email address in this repository.
//
// ⚠️ WHAT THIS GUARD REFUSES TO DO: invent a retention period. Every row must
// DECLARE one; `undecided` is a legitimate declaration that carries an owner
// item and PRINTS every run. An agent choosing "90 days" for a real signup list
// would be writing a number that then looks authoritative and silently deletes
// somebody's data. A missing declaration fails; a declared "nobody has decided"
// does not.
//
// ⚠️ AND IT IS NOT A `grep cf-connecting-ip` CHECK. subscribe.js hashes the
// address under a secret and expires it within the hour and never persists it
// raw — a naive guard would flag correct code and be switched off within a week.
// check-site-integrity.mjs owns the keyed-fingerprint property; this file owns
// what is STORED.
//
// Usage:  node tooling/ci/assert-data-inventory.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { visibleText, normaliseForMatch, stripSourceComments, stripStringLiterals } from './text-reductions.mjs';
import { listDir } from './tree-walk.mjs';

const repoRoot = resolve(process.argv[2] ?? process.cwd());
const REGISTER = join(repoRoot, 'tooling', 'legal', 'data-inventory.json');
const SITE_ROOT = join(repoRoot, 'sites', 'nikatru');

const problems = [];
const prints = [];
const rel = (p) => relative(repoRoot, p).split(sep).join('/');

const coverageLost = (msg, ...detail) => {
  console.error(`✗ COVERAGE LOST — ${msg}`);
  for (const d of detail) console.error(`  ${d}`);
  process.exit(1);
};

if (!existsSync(REGISTER)) {
  coverageLost(
    `${rel(REGISTER)} does not exist.`,
    'The inventory is the left-hand side of every comparison below. Absent, this guard compares the',
    'tree to nothing and prints ok — see tooling/legal/README.md for why it lives in-tree and not',
    'under company/, which is gitignored and invisible to CI.',
  );
}
let register;
try {
  register = JSON.parse(readFileSync(REGISTER, 'utf8'));
} catch (err) {
  coverageLost(`${rel(REGISTER)} is not valid JSON (${err.message}).`);
}

const D = register.derivation ?? {};
const walk = (dir, out = []) => {
  let entries;
  try {
    entries = listDir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'build' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const under = (roots) => (roots ?? []).flatMap((r) => walk(join(repoRoot, ...r.split('/'))));

/** id → { id, kind, name, where } — the DERIVED set. */
const derived = new Map();
const add = (id, kind, name, where) => {
  if (!derived.has(id)) derived.set(id, { id, kind, name, where: [] });
  derived.get(id).where.push(where);
};

// ── walk 1 · tables ─────────────────────────────────────────────────────────
const migrationFiles = under(D.migrationRoots).filter((f) => /[/\\]migrations[/\\].*\.sql$/i.test(f));
if (migrationFiles.length < Number(D.minMigrationFiles ?? 0)) {
  coverageLost(
    `found ${migrationFiles.length} migration file(s) under ${(D.migrationRoots ?? []).join(', ')}, floor ${D.minMigrationFiles}.`,
    'A migration walk that under-reaches makes every "is this table declared?" question vacuously',
    'true — the schema that scales to the whole portfolio would simply stop being covered, and this',
    'guard would report a complete inventory over a subset. That has happened here before, to',
    'check-migrations.mjs, which silently dropped from 5 files to 4 and reported PASS.',
  );
}

/** Which database a migrations directory applies to, read from the wrangler
 *  config beside it — the binding that declares `migrations_dir`. Derived
 *  rather than hardcoded: a second copy of "which db is this" in a guard is the
 *  first one to be wrong after a rename. */
const jsoncParse = (text) => JSON.parse(stripSourceComments(text, '.ts').replace(/,(\s*[}\]])/g, '$1'));
const wranglerFiles = under(D.wranglerRoots).filter((f) => /wrangler\.(jsonc|json)$/i.test(f));
const wranglerToml = under(D.wranglerRoots).filter((f) => /wrangler\.toml$/i.test(f));
if (wranglerToml.length) {
  coverageLost(
    `${wranglerToml.map(rel).join(', ')} is a TOML wrangler config and this walk only parses JSON/JSONC.`,
    'A config format this guard cannot read is a set of bindings it cannot enumerate, which is',
    'silent under-coverage rather than an error. Convert it, or teach this guard TOML.',
  );
}
if (wranglerFiles.length < Number(D.minWranglerConfigs ?? 0)) {
  coverageLost(
    `found ${wranglerFiles.length} wrangler config(s), floor ${D.minWranglerConfigs}.`,
    'Every binding limb below ranges over these files.',
  );
}

const dbForMigrationsDir = new Map();
for (const f of wranglerFiles) {
  let cfg;
  try {
    cfg = jsoncParse(readFileSync(f, 'utf8'));
  } catch (err) {
    problems.push(`${rel(f)} could not be parsed as JSONC (${err.message}), so its bindings were not enumerated.`);
    continue;
  }
  const dir = f.slice(0, f.lastIndexOf(sep));
  for (const d of cfg.d1_databases ?? []) {
    if (!d || typeof d.database_name !== 'string') continue;
    add(`d1:${d.database_name}`, 'd1-database', d.database_name, rel(f));
    if (typeof d.migrations_dir === 'string') dbForMigrationsDir.set(join(dir, d.migrations_dir), d.database_name);
  }
  for (const k of cfg.kv_namespaces ?? []) {
    if (!k || typeof k.id !== 'string') continue;
    add(`kv:${k.id}`, 'kv-namespace', k.binding ?? k.id, rel(f));
  }
  for (const r of cfg.r2_buckets ?? []) {
    if (!r || typeof r.bucket_name !== 'string') continue;
    add(`r2:${r.bucket_name}`, 'r2-bucket', r.bucket_name, rel(f));
  }
}

/** `table:<db>.<name>` → Set of column names, accumulated across every migration
 *  that touches the table. `ALTER TABLE … ADD COLUMN` counts: 0006 is the whole
 *  reason the erasure limb below can be true of `provider_notifications`, and a
 *  parser that only read CREATE TABLE would report the column absent and fail a
 *  correct declaration. */
const columnsByTable = new Map();
const noteColumn = (db, table, col) => {
  const id = `table:${db}.${table}`;
  if (!columnsByTable.has(id)) columnsByTable.set(id, new Set());
  columnsByTable.get(id).add(col.toLowerCase());
};

/** The balanced `( … )` that starts at or after `from`. Returns null when the
 *  parens do not close — an unbalanced body is a parse failure, not an empty
 *  column list, and the two must not be confused. */
function balanced(text, from) {
  const open = text.indexOf('(', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Column names in a CREATE TABLE body. Split on TOP-LEVEL commas only, so
 *  `CHECK (cycle IN ('monthly','yearly'))` and a composite `PRIMARY KEY (a, b)`
 *  do not each contribute phantom columns — the first token of `yearly'))` would
 *  otherwise be read as a column and a `user_id` inside a CHECK would be read as
 *  a real one. Table-level constraints are dropped by keyword. */
const TABLE_CONSTRAINT = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)$/i;
function columnsIn(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const out = [];
  for (const p of parts) {
    const m = p.trim().match(/^["'`[]?([A-Za-z_][\w$]*)/);
    if (!m || TABLE_CONSTRAINT.test(m[1])) continue;
    out.push(m[1]);
  }
  return out;
}

let tablesFound = 0;
for (const f of migrationFiles) {
  const dir = f.slice(0, f.lastIndexOf(sep));
  const db = dbForMigrationsDir.get(dir);
  if (!db) {
    problems.push(
      `${rel(f)} lives in a migrations directory no wrangler config claims with a \`migrations_dir\`. The database ` +
        'it applies to cannot be derived, so its tables cannot be filed against one — and an unfiled table is an ' +
        'undisclosed store.',
    );
    continue;
  }
  // Comments AND string literals out before scanning. `-- CREATE TABLE …` in a
  // rollback note is not a table, and neither is one inside a quoted string.
  const sql = stripStringLiterals(stripSourceComments(readFileSync(f, 'utf8'), '.sql'));
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([A-Za-z_][\w$]*)/gi)) {
    tablesFound++;
    add(`table:${db}.${m[1]}`, 'd1-table', m[1], rel(f));
    const body = balanced(sql, m.index + m[0].length);
    if (body === null) {
      problems.push(
        `${rel(f)} declares CREATE TABLE ${m[1]} and its column list has no closing parenthesis, so its columns ` +
          'could not be read. The erasure limb below decides whether that table is reachable BY ITS COLUMNS; an ' +
          'unreadable body would make every declaration about it vacuously satisfiable.',
      );
      continue;
    }
    for (const col of columnsIn(body)) noteColumn(db, m[1], col);
  }
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+["'`[]?([A-Za-z_][\w$]*)["'`\]]?\s+ADD\s+(?:COLUMN\s+)?["'`[]?([A-Za-z_][\w$]*)/gi,
  )) {
    noteColumn(db, m[1], m[2]);
  }
}
// ⚠️ ONLY WHEN NOTHING MORE SPECIFIC IS ALREADY WRONG. A migrations directory
// that no wrangler config claims is skipped above WITH ITS OWN MESSAGE, and
// coverageLost exits immediately — so raising it here would replace "this
// directory is unclaimed" with "the statement pattern stopped matching" and send
// the fix to the wrong file. Reporting the wrong fault is the failure mode this
// repository keeps recording. (Found by its own regression test.)
if (tablesFound === 0 && problems.length === 0) {
  coverageLost(
    'ZERO CREATE TABLE statements were found across every migration file.',
    'The statement pattern stopped matching, so "every table has a row" ranged over an empty set.',
  );
}

// ── walk 3 · Pages Function KV bindings ─────────────────────────────────────
// Bound in the Cloudflare dashboard, present in no config in this repository.
// A wrangler-only walk reports full coverage while missing the one store that
// holds a plain email address.
const pagesFiles = under(D.pagesFunctionRoots).filter((f) => f.endsWith('.js'));
if (pagesFiles.length < Number(D.minPagesFunctionFiles ?? 0)) {
  coverageLost(
    `found ${pagesFiles.length} Pages Function file(s) under ${(D.pagesFunctionRoots ?? []).join(', ')}, floor ${D.minPagesFunctionFiles}.`,
    'The dashboard-bound KV stores are only visible through these files. If the walk stops reaching',
    'them, the store holding the signup emails simply disappears from the inventory.',
  );
}
const pagesBindings = new Map(
  (register.stores ?? [])
    .filter((s) => s.kind === 'kv-namespace-pages' && typeof s.name === 'string')
    .map((s) => [s.name, s.id]),
);
let pagesKv = 0;
const seenPagesBindings = new Set();
for (const f of pagesFiles) {
  const src = stripSourceComments(readFileSync(f, 'utf8'), '.js');
  for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\s*\.\s*(?:get|put|list|delete)\s*\(/g)) {
    seenPagesBindings.add(m[1]);
    pagesKv++;
    const id = pagesBindings.get(m[1]);
    // The id cannot be derived from the code — it lives in the dashboard — so
    // the register supplies it and this walk supplies the EXISTENCE. A binding
    // the register has never heard of gets a synthetic id so it lands in the
    // derived set and fails the both-directions comparison by name.
    add(id ?? `kv:pages:${m[1]}`, 'kv-namespace-pages', m[1], rel(f));
  }
}
if (seenPagesBindings.size < Number(D.minPagesKvBindings ?? 0)) {
  coverageLost(
    `found ${seenPagesBindings.size} KV binding(s) called from a Pages Function, floor ${D.minPagesKvBindings}.`,
    'sites/nikatru/functions/api/subscribe.js calls env.SIGNUPS. If that stopped being found, the only',
    'store in this repository holding a plain email address would silently leave the inventory.',
  );
}

// ── the both-directions comparison ──────────────────────────────────────────
const stores = Array.isArray(register.stores) ? register.stores : [];
if (stores.length === 0) {
  coverageLost('the inventory declares no `stores`, so the comparison had nothing on its left side.');
}
const byId = new Map();
for (const s of stores) {
  if (byId.has(s.id)) {
    problems.push(`the inventory declares TWO rows with id ${JSON.stringify(s.id)}. One store, one row.`);
    continue;
  }
  byId.set(s.id, s);
}

for (const [id, d] of derived) {
  if (!byId.has(id)) {
    problems.push(
      `${d.kind} ${JSON.stringify(d.name)} exists (${[...new Set(d.where)].join(', ')}) and ` +
        'tooling/legal/data-inventory.json has NO row for it. A place data can go, that no disclosure describes ' +
        'and no retention decision covers. Add the row — including when the answer is "holds nothing about a person".',
    );
  }
}
for (const [id, s] of byId) {
  if (!derived.has(id)) {
    problems.push(
      `the inventory carries a row for ${JSON.stringify(s.id)} (${s.name}) and NO such store exists in the tree. ` +
        'Either it was renamed and this row still describes the old schema, or it was removed and the row outlived ' +
        'it. This direction is what stops the inventory becoming a wish-list that always looks complete.',
    );
  }
}

// ── per-row obligations ─────────────────────────────────────────────────────
const KINDS = register.retentionKinds && typeof register.retentionKinds === 'object' ? register.retentionKinds : {};
const ERASURE_KINDS =
  register.erasureKinds && typeof register.erasureKinds === 'object' ? register.erasureKinds : {};
let disclosuresChecked = 0;
let writersChecked = 0;
/** How many erasure declarations were actually compared to the schema. The one
 *  counter that can silently empty out: a row-shape change, a renamed `kind`
 *  field or a walk that stops filing tables would make "every table has an
 *  erasure story" range over nothing while printing ok. */
let erasureRowsChecked = 0;
for (const s of stores) {
  const where = `inventory row ${JSON.stringify(s.id)}`;
  if (!s.retention || typeof s.retention !== 'object') {
    problems.push(
      `${where} carries no \`retention\`. Every store declares how long it keeps what it holds — including "kept ` +
        'until deleted" and "nobody has decided". A row with no declaration is the one state that cannot be reviewed.',
    );
  } else {
    const kind = s.retention.kind;
    if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) {
      problems.push(
        `${where} declares retention kind ${JSON.stringify(kind)}, which is not in the register's own ` +
          '`retentionKinds` dictionary. The vocabulary lives in the register so renaming a kind out from under the ' +
          'rows using it fails instead of quietly meaning nothing.',
      );
    }
    if ((kind === 'keep' || kind === 'derived') && (typeof s.retention.reason !== 'string' || s.retention.reason.trim() === '')) {
      problems.push(
        `${where} declares retention \`${kind}\` with no \`reason\`. Keeping data forever is a decision; it gets a ` +
          'written justification, not a default.',
      );
    }
    if (kind === 'undecided') {
      if (typeof s.retention.ownerItem !== 'string' || s.retention.ownerItem.trim() === '') {
        problems.push(
          `${where} declares retention \`undecided\` and names no \`ownerItem\`. An undecided retention with nobody ` +
            'to decide it is a permanent exemption with a polite label.',
        );
      } else {
        prints.push(
          `RETENTION UNDECIDED (${s.retention.ownerItem}) · ${s.id} (${s.name}) — ${s.retention.reason ?? 'no reason recorded'}`,
        );
      }
    }
  }

  // A row holding personal data must QUOTE the sentence that discloses it, and
  // that sentence must still be on the page. This is the relationship that
  // makes the inventory and the published notice one system rather than two
  // documents that happen to agree today.
  if (s.personalData === true) {
    const d = s.disclosure;
    if (!d || typeof d.page !== 'string' || typeof d.quote !== 'string' || d.quote.trim() === '') {
      problems.push(
        `${where} holds personal data and carries no \`disclosure\` (a page and a quote from it). A store holding ` +
          'something about a person that no published sentence describes is the exact gap K-8 exists to close.',
      );
    } else {
      const abs = join(SITE_ROOT, d.page);
      if (!existsSync(abs)) {
        problems.push(`${where} quotes ${d.page}, which does not exist under sites/nikatru/.`);
      } else {
        disclosuresChecked++;
        const text = normaliseForMatch(visibleText(readFileSync(abs, 'utf8')));
        if (!text.includes(normaliseForMatch(d.quote))) {
          problems.push(
            `${where} claims ${d.page} discloses it with ${JSON.stringify(d.quote)}, and that text does not appear ` +
              'in the visible text of that page. Either the notice was rewritten and this store is now undisclosed, ' +
              'or the quote was typed from memory. The page is what a user read; it is what is right.',
          );
        }
      }
    }
  }

  // ── THE ERASURE RELATION ──────────────────────────────────────────────────
  // 🔴 A DELETE ROUTE THAT SILENTLY MISSES ROWS IS WORSE THAN NO DELETE ROUTE,
  // because the user is told their data is gone and stops asking. The route
  // derives the tables it empties from the schema (every table with a `user_id`
  // column), which is right — and means a table holding personal data WITHOUT
  // one is invisible to it while the route still answers ok:true.
  // `provider_notifications` was exactly that, holding the buyer's name and
  // email verbatim, until migration 0006.
  //
  // So: every table, and every store holding personal data, declares HOW an
  // erasure request reaches it — and the declaration is CHECKED AGAINST THE
  // PARSED SCHEMA rather than believed. That is what makes this a relationship:
  // `purge` asserts the column the route derives from is really there, and
  // `pseudonymous` / `no-personal-data` assert that no user-shaped column is, so
  // adding `user_id` to `events` tomorrow makes its declaration FALSE and fails
  // the build instead of leaving a row that says "unreachable" about a table
  // that has just become reachable.
  const needsErasure = s.kind === 'd1-table' || s.personalData === true;
  if (needsErasure) {
    const e = s.erasure;
    if (!e || typeof e !== 'object') {
      problems.push(
        `${where} declares no \`erasure\`. Every table, and every store that holds personal data, states how a ` +
          'deletion request reaches it — including when the honest answer is "nothing reaches it, and here is ' +
          'what blocks that". A store with no erasure story is the row that makes "your data has been deleted" ' +
          'a sentence nobody can check.',
      );
    } else if (!Object.prototype.hasOwnProperty.call(ERASURE_KINDS, e.kind)) {
      problems.push(
        `${where} declares erasure kind ${JSON.stringify(e.kind)}, which is not in the register's own ` +
          '`erasureKinds` dictionary. The vocabulary lives in the register so renaming a kind out from under the ' +
          'rows using it fails instead of quietly meaning nothing.',
      );
    } else {
      erasureRowsChecked++;
      // The schema is only knowable for tables; a KV namespace has no columns.
      const cols = columnsByTable.get(s.id);
      const userOwned = cols ? cols.has('user_id') : null;
      const refs = cols ? [...cols].filter((c) => c !== 'user_id' && c.endsWith('_user_id')) : [];

      if (e.kind === 'purge') {
        if (cols && !userOwned) {
          problems.push(
            `${where} declares erasure \`purge\`, and no migration gives ${JSON.stringify(s.name)} a \`user_id\` ` +
              'column. The route does not carry a table list — it derives one from the schema — so a table with no ' +
              '`user_id` is one the sweep never sees, and this row is claiming an erasure that does not happen.',
          );
        }
      } else if (e.kind === 'unlink') {
        if (typeof e.column !== 'string' || !e.column) {
          problems.push(`${where} declares erasure \`unlink\` and names no \`column\` to null.`);
        } else if (!/_user_id$/.test(e.column)) {
          problems.push(
            `${where} declares erasure \`unlink\` on column ${JSON.stringify(e.column)}, which does not end in ` +
              '`_user_id`. The route\'s unlink set is derived from that spelling; a column outside it is nulled by ' +
              'nothing, and this row would be describing a behaviour the route does not have.',
          );
        } else if (cols && !cols.has(e.column.toLowerCase())) {
          problems.push(
            `${where} declares erasure \`unlink\` on ${JSON.stringify(e.column)} and no migration gives ` +
              `${JSON.stringify(s.name)} that column. Either it was renamed on one side only, or the row was ` +
              'written from memory.',
          );
        }
      } else if (e.kind === 'pseudonymous' || e.kind === 'no-personal-data') {
        if (userOwned === true || refs.length > 0) {
          problems.push(
            `${where} declares erasure ${JSON.stringify(e.kind)} — "no erasure request can address this table" — ` +
              `and the schema now gives it ${[userOwned ? 'user_id' : null, ...refs].filter(Boolean).join(', ')}. ` +
              'The declaration has become FALSE: the table IS addressable now. This is the direction that matters ' +
              'most, because a row saying "unreachable" about a reachable table is how a real erasure gap gets a ' +
              'clean bill of health.',
          );
        }
        if (e.kind === 'no-personal-data' && s.personalData === true) {
          problems.push(
            `${where} declares erasure \`no-personal-data\` while the row itself says \`personalData: true\`. One ` +
              'of the two is wrong, and both are in this file.',
          );
        }
      } else if (e.kind === 'no-route') {
        if (typeof e.blockedBy !== 'string' || e.blockedBy.trim() === '') {
          problems.push(
            `${where} declares erasure \`no-route\` and names no \`blockedBy\`. An unreachable store with nothing ` +
              'recorded about what would make it reachable is a permanent exemption with a polite label.',
          );
        } else {
          prints.push(`ERASURE UNREACHABLE · ${s.id} (${s.name}) — ${e.blockedBy}`);
        }
      }

      // `purge` and `unlink` both name the route that performs them, and it has
      // to still be a file. A row pointing at a deleted route is a row claiming
      // an erasure nothing runs.
      if (e.kind === 'purge' || e.kind === 'unlink') {
        if (typeof e.route !== 'string' || e.route.trim() === '') {
          problems.push(`${where} declares erasure \`${e.kind}\` and names no \`route\` that performs it.`);
        } else if (!existsSync(join(repoRoot, ...e.route.split('/')))) {
          problems.push(
            `${where} names erasure route ${e.route}, which does not exist. ⚠️ This limb proves the file is THERE, ` +
              'not that it works — the behaviour is proven by services/platform/test/erasure-reach.test.ts, which ' +
              'plants a row in every table this register names and runs the real route against the real migrations.',
          );
        }
      }

      // An UNVERIFIED legal question attached to an erasure decision prints
      // every run. Never invent a retention period, a statute or a regulator:
      // an unsourced number in a compliance rule fires on correct input while
      // looking authoritative.
      if (e.unverified && typeof e.unverified === 'object') {
        if (typeof e.unverified.ownerItem !== 'string' || !e.unverified.ownerItem) {
          problems.push(
            `${where} attaches an \`unverified\` erasure question with no \`ownerItem\`. A question nobody owns is ` +
              'one nobody answers.',
          );
        } else {
          prints.push(
            `ERASURE UNVERIFIED (${e.unverified.ownerItem}) · ${s.id} — ${e.unverified.question ?? '(no question recorded)'} ` +
              `${e.unverified.status ?? ''}`.trim(),
          );
        }
      }
    }
  }

  // A row must name the code that writes it, and that code must still exist and
  // still mention the store. Without this a row drifts off its implementation
  // and keeps describing a system nobody maintains.
  const writers = Array.isArray(s.writtenBy) ? s.writtenBy : [];
  if (writers.length === 0) {
    problems.push(
      `${where} names no \`writtenBy\`. A store nobody can point at the code for is a store nobody can reason about ` +
        'when a deletion request arrives.',
    );
  }
  for (const w of writers) {
    const abs = join(repoRoot, ...w.split('/'));
    if (!existsSync(abs)) {
      problems.push(
        `${where} names a writer ${w} that does not exist. The row is pointing at a file that was moved or deleted, ` +
          'so nothing connects the declared store to the code that fills it.',
      );
      continue;
    }
    writersChecked++;
    const src = readFileSync(abs, 'utf8');
    const needle = s.kind === 'd1-table' ? s.name : s.name;
    if (!src.includes(needle)) {
      problems.push(
        `${where} names ${w} as a writer and that file never mentions ${JSON.stringify(needle)}. Either the store ` +
          'was renamed on one side only, or the writer moved and this row still points at the old one.',
      );
    }
  }
}

// Gated on `problems.length === 0` for the reason spelled out at the tablesFound
// check above: coverageLost exits immediately, so firing it while a specific
// fault is already recorded replaces the precise message with a vague one.
if (disclosuresChecked === 0 && problems.length === 0) {
  coverageLost(
    'NOT ONE personal-data row was checked against a published page.',
    'Either no row is marked personalData, or every disclosure was skipped by a shape error. Both make',
    'the "every disclosure has an inventory behind it" relation vacuous.',
  );
}
if (writersChecked === 0 && problems.length === 0) {
  coverageLost('NOT ONE `writtenBy` file was read, so no row was connected to the code that fills it.');
}
const erasureFloor = Number(D.minErasureRowsChecked ?? 0);
if (erasureRowsChecked < erasureFloor && problems.length === 0) {
  coverageLost(
    `only ${erasureRowsChecked} erasure declaration(s) were compared to the schema, floor ${erasureFloor}.`,
    'Every table, and every store holding personal data, owes one. A run that checks fewer has stopped',
    'reaching rows — and "every table has an erasure story" would then range over a subset while printing',
    'ok, which is precisely how check-migrations.mjs once dropped from 5 files to 4 and reported PASS.',
  );
}
if (columnsByTable.size === 0 && problems.length === 0) {
  coverageLost(
    'NOT ONE table\'s columns were parsed out of the migrations.',
    'Every erasure declaration is checked against those columns, so with none of them read a `purge` row',
    'claiming a `user_id` that does not exist, and a `pseudonymous` row about a table that has grown one,',
    'would both pass.',
  );
}

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`✗ data inventory — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error('');
  console.error('  [pipeline K-8] A privacy notice is a claim about where data goes. It is worth what the');
  console.error('  enumeration behind it is worth.');
  process.exit(1);
}

const personal = stores.filter((s) => s.personalData === true).length;
console.log(
  `ok  data inventory — ${derived.size} store(s) derived from ${migrationFiles.length} migration file(s), ` +
    `${wranglerFiles.length} wrangler config(s) and ${pagesFiles.length} Pages Function(s); every one has a row and ` +
    'every row has a store',
);
console.log(
  `    ${personal} row(s) hold personal data, each quoting a sentence still published on the notice ` +
    `(${disclosuresChecked} checked); ${writersChecked} writer file(s) still mention the store they fill`,
);
console.log(
  `    ${erasureRowsChecked} erasure declaration(s) checked against the columns of ${columnsByTable.size} table(s): ` +
    'every `purge` names a table that really has a `user_id`, every `unlink` a column that really ends in ' +
    '`_user_id`, and every "unreachable" a table that really has neither',
);
if (prints.length) {
  console.log('');
  console.log('   ── printed, not failed (a retention period is an OWNER decision; an agent inventing one is worse) ──');
  for (const p of prints) console.log(`   ⬜ ${p}`);
}
