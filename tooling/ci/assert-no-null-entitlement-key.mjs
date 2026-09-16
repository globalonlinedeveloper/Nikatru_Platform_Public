#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-no-null-entitlement-key.mjs — invariant G4. NO WRITER MAY INSERT A NULL
// INTO A KEY COLUMN OF THE MONEY SCHEMA, and SQLite will not stop it.
//
// 🔴 THE MEASUREMENT THIS GUARD EXISTS FOR, made by [ADR 057] against the real
// 0001 DDL under node:sqlite 3.53.1:
//
//     3 identical inserts with app_id NULL   ->  rows after: 3
//     the same insert with app_id 'subly'    ->  UNIQUE constraint failed
//
// THREE ROWS, NO ERROR, NO WARNING. A rowid table's `PRIMARY KEY` does not imply
// NOT NULL in SQLite, and NULLs compare as DISTINCT — so the uniqueness the whole
// money rail rests on simply stops applying. An upsert silently becomes an
// append, and a webhook that retries multiplies a paying customer's grant rows
// forever while every response stays 200.
//
// It is recorded, and guarded, because it is ATTRACTIVE. Representing a
// subject-wide grant as one `entitlements` row with `app_id = NULL` needs no
// migration, reads as tidy, and nothing in this repository would have failed.
//
// ── WHY THIS IS A SEPARATE GUARD FROM assert-entitlement-contract.mjs ────────
// That file grades the SCHEMA — what the migrations declare. This one grades the
// WRITERS — what the TypeScript actually binds — and then PROVES the consequence
// by replaying the real DDL through a real SQL engine. They are two different
// subjects with two different failing inputs, and folding them together would
// mean a schema failure and a writer failure sharing one exit code and one
// message. `entitlements` also cannot be repaired by schema at all — migrations
// are additive-only (INV-505) and SQLite has no `ALTER TABLE … ALTER PRIMARY
// KEY` — so for that table a writer-side guard is the ONLY available defence.
//
// ── THREE LIMBS ──────────────────────────────────────────────────────────────
//   A · THE PROOF. Replay the REAL migrations into node:sqlite and demonstrate,
//       on this run, that a NULL key column still appends rather than conflicts.
//       Without this the guard is a rule with no evidence, and a future SQLite
//       that fixed the behaviour would leave it enforcing nothing anybody could
//       still explain.
//   B · THE WRITERS. Every `INSERT INTO <money table>` under services/ binds a
//       value to each key column that is not a literal NULL.
//   C · THE SCHEMA'S OWN DEFENCE. `bundle_grants` — the table that is NEW enough
//       to carry NOT NULL — must actually carry it. (Also asserted by limb 8 of
//       assert-entitlement-contract.mjs, deliberately: this is the one invariant
//       where two guards looking from two directions is cheaper than one.)
//
// Usage:  node tooling/ci/assert-no-null-entitlement-key.mjs [repoRoot]
// Exit 0 = no writer can strand a NULL in a key column, 1 = one can.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { stripSourceComments } from './text-reductions.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const MIGRATIONS = 'services/platform/migrations';
const WRITER_ROOT = 'services';

/**
 * The key columns, per table. A NULL in one of these is not a missing value — it
 * is a row that can never be found again, updated, revoked or erased, and that
 * one more identical insert will silently duplicate.
 */
const KEY_COLUMNS = [
  ['entitlements', ['user_id', 'app_id', 'entitlement'], 'the composite PRIMARY KEY the upsert targets. [ADR 057] measured a NULL `app_id` producing three rows from three identical inserts'],
  ['bundle_grants', ['grant_id', 'user_id', 'feature_set_name', 'feature_set_version'], 'the surrogate key, the subject, and the PIN. A NULL pin resolves against the register instead of against what was sold'],
  ['feature_set_members', ['name', 'version', 'product_slug'], 'the membership triple the union read JOINS on. A NULL here silently removes a product from a bundle somebody already bought'],
  ['provider_accounts', ['provider', 'provider_subscription_id', 'user_id'], 'the attribution link. A NULL leg means a renewal cannot be matched to the person who is paying for it'],
];

/** Tables whose DDL must SPELL `NOT NULL` on the columns above. Only the new one can. */
const MUST_DECLARE_NOT_NULL = ['bundle_grants', 'feature_set_members'];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const coverageLost = (m) => problems.push(`COVERAGE LOST — ${m}`);
const ok = (m) => notes.push(m);

function done() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n✗ assert-no-null-entitlement-key: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  · ${p}`);
    console.error('');
    console.error('  SQLite enforces none of this. A rowid PRIMARY KEY does not imply NOT NULL and NULLs compare');
    console.error('  as distinct, so the failure is SILENT: an upsert becomes an append and every response stays 200.');
    // ⏱ 2026-09-16 — O-EXIT2-CONVENTION-GAP. Exit 2 when EVERY problem is a COVERAGE LOST: the run did
    // not check enough to be evidence. Exit 1 when any is a finding — a proven defect outranks a blind
    // limb. This exited 1 for both until today. assert-guard-coverage.mjs reads this exact idiom.
    process.exit(problems.every((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1);
  }
  console.log('✓ assert-no-null-entitlement-key: no writer can strand a NULL in a money-schema key column.');
  process.exit(0);
}

// ── the migration set ────────────────────────────────────────────────────────
const migDir = join(ROOT, MIGRATIONS);
if (!existsSync(migDir)) {
  coverageLost(`${MIGRATIONS} does not exist, so there is no DDL to replay and no key column to check. Every limb below would range over nothing.`);
  done();
}
const migFiles = listDir(migDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();
if (migFiles.length === 0) {
  coverageLost(`${MIGRATIONS} contains no .sql file, so the schema under test is empty.`);
  done();
}
const migrationSql = migFiles.map((f) => readFileSync(join(migDir, f), 'utf8'));

// ═════════════════════════════════════════════════════════════════════════════
// LIMB A · THE PROOF — replay the REAL DDL and show the trap is still open.
// ═════════════════════════════════════════════════════════════════════════════
{
  // `node:sqlite` through getBuiltinModule, the same access the platform test
  // harness uses. A node without it is COVERAGE LOST, never a pass: the guard's
  // whole authority is that it re-derived the measurement on this run.
  let DatabaseSync = null;
  try {
    DatabaseSync = process.getBuiltinModule('node:sqlite').DatabaseSync;
  } catch {
    DatabaseSync = null;
  }
  if (DatabaseSync === null) {
    coverageLost(
      'node:sqlite is not available in this runtime, so the NULL-key behaviour could not be re-derived. ' +
        'The rule below would then rest on a sentence in a comment rather than on a measurement.',
    );
  } else {
    const db = new DatabaseSync(':memory:');
    for (const sql of migrationSql) db.exec(sql);

    // 1 · THE TRAP, DEMONSTRATED. Three identical inserts with a NULL key column.
    const ins = `INSERT INTO entitlements (user_id, app_id, entitlement, is_active) VALUES (?,?,?,1)`;
    for (let i = 0; i < 3; i++) db.prepare(ins).run('probe-user', null, 'pro');
    const nullRows = db
      .prepare(`SELECT COUNT(*) AS n FROM entitlements WHERE user_id = 'probe-user' AND app_id IS NULL`)
      .get().n;

    // 2 · THE CONTROL. The same statement with a non-null key must be REFUSED,
    //     or the demonstration above says nothing about NULLs — it would just be
    //     a table with no uniqueness at all.
    db.prepare(ins).run('probe-user2', 'subscriptiontracker', 'pro');
    let refused = false;
    try {
      db.prepare(ins).run('probe-user2', 'subscriptiontracker', 'pro');
    } catch {
      refused = true;
    }

    if (!refused) {
      coverageLost(
        'the CONTROL failed: a duplicate insert with a NON-NULL key was accepted too, so `entitlements` has no ' +
          'working uniqueness constraint at all and the NULL demonstration below proves nothing about NULLs.',
      );
    } else if (Number(nullRows) === 3) {
      ok(
        `the NULL trap is REAL on this runtime, re-derived not recalled: 3 identical inserts with a NULL ` +
          `\`app_id\` produced ${nullRows} rows and no error, while the same statement with a non-null key was ` +
          'refused. Every rule below is enforcing a measured failure.',
      );
    } else {
      // A future SQLite that fixed this would land here. That is NOT a pass and
      // NOT a failure of the tree — it is the guard's premise having changed, and
      // it must be read by a human rather than silently absorbed.
      fail(
        `THE PREMISE MOVED — 3 identical inserts with a NULL \`app_id\` produced ${nullRows} row(s), not 3. ` +
          'This runtime does not reproduce the [ADR 057] measurement. Either SQLite changed its NULL/PRIMARY KEY ' +
          'behaviour or the DDL did. Re-derive the measurement and rewrite this guard around what is true now; ' +
          'do not delete it, and do not adjust the number to match.',
      );
    }

    // 3 · THE NEW TABLE MUST REFUSE IT OUTRIGHT. `bundle_grants` was created after
    //     the trap was known, so its NOT NULLs are testable rather than merely
    //     declared — and this is the half `entitlements` can never have.
    let bundleRefused = false;
    try {
      db.prepare(
        `INSERT INTO bundle_grants (grant_id, user_id, source, feature_set_name, feature_set_version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run('g1', null, 'promo_code', 'nikatru_all', 1, 'now', 'now');
    } catch {
      bundleRefused = true;
    }
    if (!bundleRefused) {
      fail(
        'THE ENGINE ACCEPTED A NULL `bundle_grants.user_id`. The NOT NULL is not doing what the migration says ' +
          'it does, so the one table that could refuse the trap does not — and a grant with no subject is an ' +
          'append nothing can revoke or erase.',
      );
    } else {
      ok('`bundle_grants` REFUSES a NULL `user_id` at the engine, not merely in prose — the trap is closed on the table that could close it');
    }
    db.close();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// LIMB B · THE WRITERS — no INSERT binds a literal NULL to a key column.
// ═════════════════════════════════════════════════════════════════════════════
{
  const scanRoot = join(ROOT, WRITER_ROOT);
  if (!existsSync(scanRoot)) {
    coverageLost(
      `${WRITER_ROOT}/ does not exist, so limb B swept ZERO writers. "No writer binds a NULL key" would be ` +
        'asserted over an empty tree, which is exactly the shape of a check that has stopped checking.',
    );
  } else {
    const files = [];
    const walk = (dir) => {
      for (const e of listDir(dir)) {
        if (e === 'node_modules' || e === '.wrangler' || e === 'dist') continue;
        const p = join(dir, e);
        const st = statSync(p);
        if (st.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) files.push(p);
      }
    };
    walk(scanRoot);

    let inserts = 0;
    for (const abs of files) {
      const rel = abs.replace(ROOT, '').replace(/^[\\/]/, '').replaceAll('\\', '/');
      const src = stripSourceComments(readFileSync(abs, 'utf8'), '.ts');
      for (const [table, keys, why] of KEY_COLUMNS) {
        const re = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([\\s\\S]*?)\\)\\s*VALUES\\s*\\(([\\s\\S]*?)\\)`, 'gi');
        for (const m of src.matchAll(re)) {
          inserts += 1;
          const cols = m[1].split(',').map((c) => c.trim().replace(/["'`[\]]/g, ''));
          const vals = m[2].split(',').map((v) => v.trim());
          for (const k of keys) {
            const i = cols.indexOf(k);
            if (i === -1) {
              // A key column the INSERT does not name at all defaults to NULL,
              // which is the same failure written differently.
              fail(
                `${rel} — an INSERT INTO \`${table}\` does not name the key column \`${k}\`, so it defaults to ` +
                  `NULL. ${why}.`,
              );
              continue;
            }
            if (/^NULL$/i.test(vals[i] ?? '')) {
              fail(
                `${rel} — an INSERT INTO \`${table}\` binds a LITERAL NULL to the key column \`${k}\`. ${why}. ` +
                  'SQLite accepts it, the row can never be found again, and one more identical insert silently ' +
                  'duplicates it.',
              );
            }
          }
        }
      }
    }
    if (files.length === 0) {
      coverageLost(`limb B found ZERO .ts sources under ${WRITER_ROOT}/, so no writer was read.`);
    } else if (inserts === 0) {
      // Not a failure — the writers may legitimately not exist yet — but it
      // PRINTS, so "no writer binds a NULL" can never quietly mean "no writer
      // was found".
      ok(`limb B read ${files.length} source(s) under ${WRITER_ROOT}/ and found NO INSERT into a money-schema table. The rule holds vacuously and says so.`);
    } else {
      ok(`limb B graded ${inserts} INSERT(s) into money-schema tables across ${files.length} source(s) under ${WRITER_ROOT}/`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// LIMB C · THE SCHEMA'S OWN DEFENCE, where it is still expressible.
// ═════════════════════════════════════════════════════════════════════════════
{
  // 🔴 COMMENTS OUT, AND THE BODY BALANCED. Two defects the guard's own first run
  // produced, both false REDS — which is the harmless direction and still wrong:
  //
  //   · the CREATE body was taken as "everything after the paren", so it ran to
  //     the end of the file and swept in `CREATE INDEX … ON feature_set_members
  //     (product_slug)` as if it were a column declaration;
  //   · splitting on `,` made `PRIMARY KEY (name, version, product_slug)` yield a
  //     piece reading `product_slug)`, which matched the column name and of
  //     course carried no `NOT NULL`.
  //
  // A column DECLARATION is now required to name a type, which is what separates
  // it from a constraint clause that merely mentions the same identifier.
  const allSql = stripSourceComments(migrationSql.join('\n'), '.sql');
  /** The text between the paren at `from` and its match. */
  const balancedBody = (text, from) => {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) return text.slice(from + 1, i);
      }
    }
    return '';
  };
  const TYPE = '(?:TEXT|INTEGER|REAL|BLOB|NUMERIC)';
  let graded = 0;
  for (const table of MUST_DECLARE_NOT_NULL) {
    const spec = KEY_COLUMNS.find(([t]) => t === table);
    if (spec === undefined) continue;
    const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${table}\\s*\\(`, 'i').exec(allSql);
    if (create === null) {
      fail(`\`${table}\` is not created by any migration, so the NOT NULLs limb C exists to require are on nothing.`);
      continue;
    }
    graded += 1;
    const body = balancedBody(allSql, create.index + create[0].length - 1);
    let checked = 0;
    for (const k of spec[1]) {
      // The column's OWN declaration. A body-wide search for `NOT NULL` passes as
      // long as ANY column carries one.
      const decl = body
        .split(',')
        .map((s) => s.trim())
        .find((s) => new RegExp(`^${k}\\s+${TYPE}\\b`, 'i').test(s));
      if (decl === undefined) continue;
      checked += 1;
      if (!/NOT\s+NULL/i.test(decl)) {
        fail(
          `${table}.${k} is declared NULLABLE. This table is NEW, so unlike \`entitlements\` it CAN carry the ` +
            'constraint — and a constraint that was available and not taken is the one the next migration cannot add.',
        );
      }
    }
    if (checked === 0) {
      fail(
        `COVERAGE LOST — limb C found no COLUMN DECLARATION for any key column of \`${table}\` inside its ` +
          'CREATE body. The parser has stopped reading, which looks identical to a table with nothing wrong.',
      );
    }
  }
  if (graded === 0) {
    coverageLost(`limb C graded ZERO of its ${MUST_DECLARE_NOT_NULL.length} table(s), so the schema-side defence was checked on nothing.`);
  } else {
    ok(`limb C checked NOT NULL on the key columns of ${graded} table(s) that are new enough to carry it`);
  }
}

done();
