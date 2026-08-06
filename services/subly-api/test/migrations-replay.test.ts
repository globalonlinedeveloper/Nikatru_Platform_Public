import { describe, it, expect } from 'vitest';
import { SUBLY_MIGRATIONS, SqliteD1, realAppDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline B-8] "a migration set is safe to re-apply" — subly_db's half.
//
// Ported from services/platform/test/migrations-replay.test.ts, whose ⚠️ SCOPE
// note names THIS set as the gap it deliberately left open. It became writable
// when [pipeline B-9] landed the real-SQLite harness here on 2026-08-05: "applies
// twice" is not a claim about a SQL string, it is a claim about what a SQL engine
// does when handed the same DDL a second time. tooling/ci/check-migrations.mjs
// reads these files and bans destructive statements; it cannot execute one.
//
// 🔴 THE SET DOES NOT REPLAY WHOLE, AND THAT IS NOT FIXABLE FROM A LATER FILE.
// 0002_schema_debt.sql:23 and :37 are bare `ALTER TABLE … ADD COLUMN`. SQLite has
// no `ADD COLUMN IF NOT EXISTS` — verified against the engine these tests run on
// (3.53.1) rather than taken from documentation: the `IF NOT EXISTS` spelling is a
// PARSE error ('near "EXISTS": syntax error'), not a condition that evaluates
// false. So no migration numbered 0003-or-later can make 0002 idempotent, and a
// 0003 that re-added `id` "defensively" would throw `duplicate column name: id` on
// its FIRST application against production — turning a non-issue into the exact
// mid-deploy failure this requirement exists to prevent. 0002 itself is untouchable
// for the same reason it is untouchable everywhere else: it is applied in
// production D1, and editing an applied migration IS the ledger drift being
// guarded against.
//
// WHY THAT IS SAFE, STATED SO IT IS NOT MISTAKEN FOR A SHRUG. `d1_migrations`
// records file NAMES, not content, so wrangler applies each file exactly once and
// the second pass never happens in production. The hazard the requirement actually
// targets is a migration that would do SOMETHING on a second application —
// re-seeding rows, rebuilding a table, re-randomising an id — because that is the
// one that diverges silently. A statement that THROWS is loud, and loud is
// recoverable.
//
// So this file makes the same trade the platform one did, and is STRICTER in the
// dimension that matters: every statement in the whole set is CLASSIFIED, and the
// test asserts `ALTER TABLE … ADD COLUMN` is the ONLY non-replay-safe form present
// ANYWHERE. A `DROP TABLE`, a bare `CREATE TABLE` without IF NOT EXISTS, or a
// widened backfill fails here — none of which a whole-set replay could tell apart,
// because it only ever said "something threw".
//
// ⚠️ ONE DELIBERATE DIVERGENCE FROM THE PLATFORM MIRROR. That file replays a
// hand-maintained list of whole FILES (`REPLAY_SAFE_MIGRATIONS`). Subly's unsafe
// statements sit in the middle of 0002, between statements that depend on them —
// the backfill and the unique index both reference the `id` column the ADD COLUMN
// creates — so a file-granular subset here would be "0001 only" and would never
// execute 0002's replay-safe half at all. This replays at STATEMENT granularity
// against an already-migrated DB instead, which is both closer to the real
// question (what would wrangler re-running this file actually do?) and free of a
// second list to forget to extend.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Blank comments and string literals, PRESERVING OFFSETS AND LENGTH — the same
 * treatment tooling/ci/check-migrations.mjs applies, and for the same reason: this
 * file's own header says "DROP TABLE" and "CREATE TABLE" in prose, and 0002's
 * comments discuss the very statements being classified. A scanner that reads
 * prose grades the comments.
 *
 * Length-preservation is load-bearing here in a way it is not in the platform
 * copy: the stripped text is used only to FIND statement boundaries and to match
 * forms, while the statements actually executed are sliced from the RAW source at
 * the same offsets. Executing the stripped text would run a backfill whose string
 * literals had been blanked away.
 */
function stripNonCode(sql: string): string {
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
    } else if (sql[i] === "'" || sql[i] === '"') {
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

/**
 * Statements, split on `;` found in the STRIPPED view so neither a `;` inside a
 * string literal nor one inside a comment ends a statement early.
 *
 * `code` is the comment-free, whitespace-collapsed form used for classification.
 * `raw` is the executable original at the same offsets.
 */
function splitStatements(sql: string): Array<{ raw: string; code: string }> {
  const stripped = stripNonCode(sql);
  const spans: Array<{ raw: string; code: string }> = [];
  let start = 0;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === ';') {
      spans.push({ raw: sql.slice(start, i + 1), code: stripped.slice(start, i + 1) });
      start = i + 1;
    }
  }
  // A trailing statement with no `;` is still a statement — wrangler applies it
  // either way. check-migrations.mjs learned this the hard way (see its
  // "ADD COLUMN … NOT NULL" rule, where a mandatory `;` made the last statement in
  // every migration unscannable).
  if (start < sql.length) spans.push({ raw: sql.slice(start), code: stripped.slice(start) });
  return spans
    .map(({ raw, code }) => ({
      raw,
      code: code.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(({ code }) => code.length > 0);
}

/**
 * Forms that can be executed a second time with no effect. Everything else is
 * either non-replay-safe or a statement class this set has never contained — and
 * both must be looked at by a human, which is what an unclassified statement
 * failing this test forces.
 */
const REPLAY_SAFE_FORMS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'CREATE TABLE IF NOT EXISTS', re: /^CREATE TABLE IF NOT EXISTS\b/i },
  { label: 'CREATE INDEX IF NOT EXISTS', re: /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\b/i },
  // A backfill NARROWED BY A WHERE CLAUSE. ⚠️ The regex proves only the FORM —
  // that something limits the statement — and a form check genuinely cannot
  // settle idempotency: `UPDATE t SET n = n + 1 WHERE x = 1` carries a WHERE and
  // is not idempotent. The PROPERTY is proven by execution below, against seeded
  // rows, which is the only thing that can distinguish a self-limiting backfill
  // (`WHERE id IS NULL` — the SET falsifies the WHERE) from a churning one.
  // An unfiltered UPDATE is separately banned outright by check-migrations.mjs.
  { label: 'UPDATE … WHERE (self-limiting backfill)', re: /^UPDATE\s+\S+\s+SET\b[\s\S]*\bWHERE\b/i },
];

/** The one form that is LEDGER-PROTECTED rather than replay-safe. */
const LEDGER_PROTECTED = /^ALTER TABLE \S+ ADD COLUMN\b/i;

/** Every statement in the set, tagged. Order is application order. */
const ALL_STATEMENTS = SUBLY_MIGRATIONS.flatMap((sql, i) =>
  splitStatements(sql).map((s) => ({ ...s, migration: i })),
);

/** The replay-safe statements, in application order — what a second `wrangler
 *  d1 migrations apply` would re-execute if the ADD COLUMNs were not there. */
const REPLAY_SAFE_STATEMENTS = ALL_STATEMENTS.filter(({ code }) =>
  REPLAY_SAFE_FORMS.some((f) => f.re.test(code)),
).map(({ raw }) => raw);

/** Tables subly_db owns, from services/subly-api/migrations/ — the applier's own
 *  input. Used for the shape/row snapshots and as a coverage assertion. */
const TABLES = ['budget_categories', 'budgets', 'payment_history', 'subscriptions'];

const schemaOf = (db: SqliteD1) =>
  db
    .rows("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .map((r) => `${r.type} ${r.name} :: ${String(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);

const rowsOf = (db: SqliteD1) =>
  TABLES.map((t) => `${t}: ${JSON.stringify(db.rows(`SELECT * FROM ${t} ORDER BY rowid`))}`);

/**
 * A DB with the real set applied once, then seeded with a LEGACY-SHAPED row —
 * `budget_categories` with no `id`, `payment_history` with no `updated_at`. This
 * is what 0002's backfills exist for, and seeding it AFTER the migration is what
 * makes the replay assertions non-vacuous: against empty tables the backfills
 * match zero rows, so "replaying changed nothing" would be trivially true while
 * proving nothing about the backfill at all.
 */
function seededDb(): SqliteD1 {
  const db = realAppDb();
  db.db.exec(
    "INSERT INTO budget_categories (user_id, name, cap) VALUES ('u1', 'food', 100.0)",
  );
  db.db.exec(
    "INSERT INTO payment_history (id, subscription_id, user_id, amount, paid_at) " +
      "VALUES ('p1', 's1', 'u1', 9.99, '2026-08-01T00:00:00Z')",
  );
  return db;
}

describe('subly_db migrations re-apply cleanly', () => {
  it('every statement in the whole set is replay-safe, or is a ledger-protected ADD COLUMN', () => {
    const unclassified: string[] = [];
    let replaySafe = 0;
    let ledgerProtected = 0;
    for (const { code, migration } of ALL_STATEMENTS) {
      if (REPLAY_SAFE_FORMS.some((f) => f.re.test(code))) { replaySafe++; continue; }
      if (LEDGER_PROTECTED.test(code)) { ledgerProtected++; continue; }
      unclassified.push(`migration #${migration}: ${code.slice(0, 120)}`);
    }
    expect(
      unclassified,
      'a statement that is neither a replay-safe IF NOT EXISTS / narrowed-backfill form nor an ' +
        'ALTER TABLE … ADD COLUMN. Re-applying this set would do something, and D1 applies ' +
        'each FILE once — so whatever this is, a human has to decide whether it is safe.',
    ).toEqual([]);
    // COVERAGE: a parser that split nothing would classify nothing and agree with
    // everything. Both buckets must be non-empty — the set genuinely contains both
    // kinds today, and if it ever stops containing ADD COLUMN the exception proven
    // below is dead code that should be removed rather than left looking alive.
    expect(replaySafe).toBeGreaterThan(8);
    expect(ledgerProtected).toBeGreaterThan(0);
  });

  it('the replay-safe statements re-applied to a migrated DB do not throw', () => {
    const db = seededDb();
    expect(() => {
      for (const sql of REPLAY_SAFE_STATEMENTS) db.db.exec(sql);
    }).not.toThrow();
  });

  it('the backfills are SELF-LIMITING — the second pass re-randomises nothing', () => {
    const db = seededDb();
    // Pass one: the backfill fires, because the seeded rows are legacy-shaped.
    for (const sql of REPLAY_SAFE_STATEMENTS) db.db.exec(sql);
    const assignedId = db.rows('SELECT id FROM budget_categories')[0]?.id;
    const assignedAt = db.rows('SELECT updated_at FROM payment_history')[0]?.updated_at;
    // …which is the assertion that keeps the next one from being vacuous. If the
    // backfill did nothing here, "unchanged by the second pass" would prove nothing.
    expect(assignedId, 'the id backfill did not fire — the replay assertion below would be vacuous').toBeTruthy();
    expect(assignedAt).toBe('2026-08-01T00:00:00Z');

    const schema = schemaOf(db);
    const rows = rowsOf(db);

    // Pass two: must be a no-op. `lower(hex(randomblob(16)))` is NON-DETERMINISTIC,
    // so this is a real test of the WHERE clause and not of SQLite: widening
    // `WHERE id IS NULL OR id = ''` to something that still matches a filled row
    // would issue a NEW random id here and break the client's stable addressing —
    // which is the entire reason 0002 added the column. That failure is invisible
    // to a schema-only comparison, so the rows are compared too.
    for (const sql of REPLAY_SAFE_STATEMENTS) db.db.exec(sql);
    expect(rowsOf(db), 'a replay-safe statement rewrote data on its second run').toEqual(rows);
    expect(schemaOf(db)).toEqual(schema);
    expect(db.rows('SELECT id FROM budget_categories')[0]?.id).toBe(assignedId);
  });

  it('re-applying the LEDGER-PROTECTED set fails LOUDLY rather than diverging', () => {
    // The exception is proven, not assumed — and this is the assertion that was
    // RED before this file existed. If SQLite ever accepted 0002 twice it would
    // mean a duplicate column had been created and the schema no longer matched
    // the file: a silent divergence on the table the sync layer addresses rows by.
    // It must throw, and the message must name the reason.
    expect(() => new SqliteD1([...SUBLY_MIGRATIONS, ...SUBLY_MIGRATIONS])).toThrow(
      /duplicate column name/i,
    );
  });

  it('COVERAGE LOST when the migration set stops being read from the tree', () => {
    // The assertions above are vacuously true against an empty array, and an empty
    // array is exactly what a broken `?raw` import produces. The floor is a
    // RELATIONSHIP, not a tuned number: one entry per .sql file the applier would
    // apply, and every entry non-empty DDL.
    expect(SUBLY_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
    for (const [i, sql] of SUBLY_MIGRATIONS.entries()) {
      expect(sql.length, `migration #${i} is empty — the ?raw import resolved to nothing`).toBeGreaterThan(100);
    }
    expect(REPLAY_SAFE_STATEMENTS.length, 'the splitter returned nothing to replay').toBeGreaterThan(8);
    // …and the set really does build subly_db, so a migration silently dropped
    // from the list is visible here and not only in a count.
    const db = realAppDb();
    expect(
      db
        .rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map((r) => String(r.name)),
    ).toEqual(TABLES);
    // The ledger-protected columns are the ones that cannot be re-added. Assert
    // they LANDED: if 0002 stopped being applied, every replay assertion above
    // would still pass — against a schema missing the columns they are about.
    const cols = (t: string) => db.rows(`PRAGMA table_info(${t})`).map((r) => String(r.name));
    expect(cols('budget_categories')).toContain('id');
    expect(cols('payment_history')).toContain('updated_at');
  });
});
