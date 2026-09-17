// ─────────────────────────────────────────────────────────────────────────────
// erasure.ts — WHICH TABLES AND COLUMNS NAME A USER. THE ONE HOME.
//
// "Delete my account" is only as complete as the list of places the person's rows
// live. Every Worker that erases needs that list, and the correctness property is
// harsh: a table left out is ORPHANED PERSONAL DATA behind a login that no longer
// exists, the route still answers `ok: true`, and nothing surfaces. There is no
// second chance to notice — the identity record is gone by then.
//
// 🔴 SO THE SCHEMA ANSWERS, NOT A LIST IN A FILE. Every table carrying a
// `user_id` column is user-owned BY DEFINITION, so a migration that adds one is
// covered by that migration alone. The alternative — a hand-kept array — rests on
// somebody remembering to edit two files in one change, and fails silently and
// permanently when they do not.
//
// Two rules, for the two spellings, disjoint BY CONSTRUCTION rather than by a
// subtraction somebody could forget:
//     ·  user_id   → the row IS this person's        → DELETE the row
//     · *_user_id  → the row REFERENCES this person  → NULL the column
//
// ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────────
// ⏱ 2026-09-12. These four declarations were private to TWO route files, one per
// live Worker, byte-identical. The app template had none of it: its erasure route
// carried `const appTables = ['records'];` and a comment warning that missing a
// table there means orphaned personal data. So the SAFE derivation reached both
// live Workers and not the factory, and every app stamped from it would have been
// born with the hand-kept list and the silent failure. Found by the
// factory-vs-app drift audit (research/factory-drift-2026-09-12/) and fixed the
// way [ADR 067] decision 2 says to — one home, re-exported — rather than by
// copying a correctness argument into a third file.
//
// ⚠️ NO BARE IMPORT HERE. See the header of health.ts for the measurement behind
// that rule; this module imports one sibling, by relative path, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
import { allRows, withD1Retry } from './d1';

/** Tables SQLite/D1 own, which must never be a delete target even if some future
 *  column there were named `user_id`. */
const RESERVED = /^(sqlite_|d1_|_cf_)/;

/** A plain SQL identifier. The table and column names below are INTERPOLATED
 *  into statements — D1 cannot bind an identifier — so anything that is not one
 *  of these is refused rather than quoted. Nothing caller-controlled reaches
 *  here; it comes from `sqlite_master`. A schema is still not a trust boundary
 *  anyone audits, and the string gets built either way. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * 🔴 THE TWO-STEP WALK EXISTS BECAUSE D1 REFUSES THE ONE-STEP FORM.
 *
 * Both derivations here used to be a single correlated join:
 *
 *     FROM sqlite_master m JOIN pragma_table_info(m.name) p
 *
 * D1 rejects that with `not authorized: SQLITE_AUTH` (error 7500), and the rule
 * is about the STATEMENT rather than about where the pragma's argument came
 * from: any single statement that names sqlite_master/sqlite_schema AND calls a
 * pragma_* table-valued function is rejected — join, subquery, CTE and correlated
 * scalar subquery alike (measured 2026-08-09 against both production databases).
 * The same pragma fed a literal, a bound parameter or a VALUES list is accepted,
 * and so is a plain sqlite_master read. So: read the tables, then ask each one.
 *
 * ⚠️ IT IS STILL THE NARROW RETRY, AND THAT MATTERS MORE THAN THE RETRY. The
 * SQLITE_AUTH rejection is DETERMINISTIC, so `isTransientD1Error` refuses it and
 * the second attempt `allRows` allows is never spent re-asking a question D1 has
 * already answered.
 *
 * ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. "ASK EACH ONE" NOW MEANS ONE CALL,
 * NOT ONE CALL PER TABLE. The walk above issued `1 + N` sequential round trips,
 * and `userOwnedTables` + `userReferencingColumns` each ran it, so erasing a
 * person from platform_db (18 tables) cost 38 schema reads before a row moved.
 * At D1's ~100-300 ms that is the ten seconds that pushed DELETE /v1/account past
 * the app's 15 s client timeout on 09-16 and 09-17 (17291 and 16800 ms, both
 * measured in Workers observability) while the server went on to finish.
 * MEASURED against both production databases before this shape was chosen:
 *   · ONE `UNION ALL` over every `pragma_table_info` — the obvious fix — is
 *     REFUSED at 18 terms: `too many terms in compound SELECT` (SQLITE_ERROR,
 *     not SQLITE_AUTH). D1 accepted at most 5. Chunking it would still grow with
 *     the table count, so it was not built.
 *   · ONE call carrying 18 SEPARATE pragma statements — the `db.batch()` shape —
 *     is accepted: 18 result sets, 146 columns on platform_db.
 * So the table list is read once and every table is asked in ONE batch: two
 * round trips, whatever the table count. The SQLITE_AUTH rule is per STATEMENT,
 * and no batched statement names sqlite_master.
 */
async function everyColumn(db: D1Database): Promise<Array<{ table: string; column: string }>> {
  const listed = await allRows<{ name: string }>(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`),
  );

  const tables = listed
    .map((r) => r.name)
    .filter((n) => typeof n === 'string' && !RESERVED.test(n) && PLAIN_IDENTIFIER.test(n));
  if (tables.length === 0) return [];

  // A read, so a transient reset is retried exactly as `allRows` retries one.
  const sets = await withD1Retry(() =>
    db.batch<{ name: string }>(tables.map((table) => db.prepare(`SELECT name FROM pragma_table_info('${table}')`))),
  );
  // 🔴 FAIL CLOSED ON A SHORT ANSWER. Columns are attributed to a table BY
  // POSITION, so a batch that returned fewer sets than it was sent would pin
  // every column after the gap on the wrong table — and a DELETE aimed at the
  // wrong table is the one failure this file cannot let through quietly.
  if (!Array.isArray(sets) || sets.length !== tables.length) {
    throw new Error(
      `schema batch answered ${Array.isArray(sets) ? sets.length : 'nothing'} result set(s) for ${tables.length} table(s)`,
    );
  }

  const out: Array<{ table: string; column: string }> = [];
  sets.forEach((set, i) => {
    for (const row of set.results ?? []) {
      if (typeof row.name === 'string') out.push({ table: tables[i], column: row.name });
    }
  });
  return out;
}

/** The two rules, each written ONCE so the reads and the writes cannot disagree. */
const OWNS = (column: string): boolean => column === 'user_id';
const REFERENCES = (column: string): boolean =>
  column.endsWith('_user_id') && column.length > '_user_id'.length && PLAIN_IDENTIFIER.test(column);

export async function columnsMatching(
  db: D1Database,
  match: (column: string) => boolean,
): Promise<Array<{ table: string; column: string }>> {
  return (await everyColumn(db)).filter((hit) => match(hit.column));
}

/**
 * Every table in the bound database that carries a `user_id` column — the rows
 * that ARE this person's, and must be deleted.
 */
export async function userOwnedTables(db: D1Database): Promise<string[]> {
  const hits = await columnsMatching(db, OWNS);
  return hits.map((h) => h.table);
}

/**
 * Every (table, column) where the column NAMES a user without making the row
 * theirs — the `*_user_id` form, which must be NULLed rather than deleted.
 *
 * `user_id` itself cannot match: something must precede the `_user_id` suffix. So
 * this set and [userOwnedTables] are disjoint by construction, not by a
 * subtraction somebody could forget.
 */
export async function userReferencingColumns(
  db: D1Database,
): Promise<Array<{ table: string; column: string }>> {
  return columnsMatching(db, REFERENCES);
}

export type ErasureTargets = {
  /** Tables whose rows ARE the person's — DELETE. */
  tables: string[];
  /** Columns that merely NAME the person — NULL. */
  references: Array<{ table: string; column: string }>;
};

/**
 * ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. BOTH SETS FROM ONE SCHEMA READ.
 *
 * `userOwnedTables` and `userReferencingColumns` are the same walk filtered two
 * ways, and every erasure called both — so it paid for the walk twice. This reads
 * it once (two round trips) and classifies it with the same two rules. The
 * deletion path calls THIS; the two single-set functions stay for their other
 * readers.
 */
export async function erasureTargets(db: D1Database): Promise<ErasureTargets> {
  const all = await everyColumn(db);
  return {
    tables: all.filter((hit) => OWNS(hit.column)).map((hit) => hit.table),
    references: all.filter((hit) => REFERENCES(hit.column)),
  };
}

/**
 * ⏱ 2026-09-18 · O-ERASURE-WALK-ROUND-TRIPS. EVERY DELETE AND EVERY UPDATE IN
 * ONE `db.batch()` — ONE ROUND TRIP, AND ONE TRANSACTION.
 *
 * The three copies of this loop (platform, the app Worker, the app brick) issued
 * one call per table and one per column, and had already DRIFTED: the brick
 * wrapped each write in `run()`, both live Workers did not. So the write lives
 * here, once.
 *
 * 🔴 ALL-OR-NOTHING IS NEW AND IT IS THE POINT. D1 runs a batch as a single
 * transaction, so a failure on the fourth table now rolls back the first three
 * instead of leaving a half-erased person whose identity still logs in.
 *
 * ⚠️ WHY A PLAIN `withD1Retry` IS SAFE HERE, stated as a property of the
 * statements rather than hoped: the batch holds only `DELETE … WHERE user_id = ?`
 * and `UPDATE … SET col = NULL WHERE col = ?`. A reset BEFORE the commit rolls
 * the whole batch back, so the retry is a first attempt. A reset AFTER it re-runs
 * statements whose rows are already gone — zero changes, no error. There is no
 * INSERT, so the UNIQUE ambiguity `run()` exists for cannot arise. On that second
 * path the counts read 0, which is the honest number for a call that changed
 * nothing (the same reasoning as `run()`'s synthesized meta).
 *
 * 🔴 AN EMPTY TABLE SET IS REFUSED HERE TOO. Every caller already refuses it in
 * its own words; this is the line a future caller that forgets cannot get past.
 */
export async function eraseTargets(
  db: D1Database,
  userId: string,
  targets: ErasureTargets,
): Promise<{ deleted: Record<string, number>; unlinked: Record<string, number> }> {
  if (targets.tables.length === 0) {
    throw new Error('no user-owned table to erase from; refusing to report an erasure that erased nothing');
  }
  // The identifiers came from `everyColumn`, but they are interpolated HERE, so
  // they are checked here — a hand-built `targets` gets no pass.
  for (const name of [...targets.tables, ...targets.references.flatMap((r) => [r.table, r.column])]) {
    if (!PLAIN_IDENTIFIER.test(name)) throw new Error(`refusing to interpolate a non-identifier: ${JSON.stringify(name)}`);
  }

  const statements = [
    ...targets.tables.map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId)),
    ...targets.references.map(({ table, column }) =>
      db.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`).bind(userId),
    ),
  ];
  const results = await withD1Retry(() => db.batch(statements));
  if (!Array.isArray(results) || results.length !== statements.length) {
    throw new Error(
      `erasure batch answered ${Array.isArray(results) ? results.length : 'nothing'} result(s) for ${statements.length} statement(s)`,
    );
  }

  const deleted: Record<string, number> = {};
  const unlinked: Record<string, number> = {};
  targets.tables.forEach((table, i) => {
    deleted[table] = results[i]?.meta?.changes ?? 0;
  });
  targets.references.forEach(({ table, column }, j) => {
    unlinked[`${table}.${column}`] = results[targets.tables.length + j]?.meta?.changes ?? 0;
  });
  return { deleted, unlinked };
}
