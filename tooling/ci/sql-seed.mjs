// ─────────────────────────────────────────────────────────────────────────────
// sql-seed.mjs — read the rows a migration SEEDS out of its own `INSERT … VALUES`.
//
// A LIBRARY. It parses and returns; it prints nothing and exits nothing.
//
// 🔴 WHY THIS IS A SHARED MODULE AND NOT A SECOND COPY OF THE SCANNER. This
// repository now has TWO seeded enums whose whole safety property is "the SQL set
// equals the runtime set" — `revocation_reasons` (0004 section E) and
// `bundle_sources` (0009 section B) — and both are read by
// tooling/ci/assert-entitlement-contract.mjs. A second transcription of this
// parser is the same failure the contracts/ directory exists to stop, one level
// up: the copy nobody edits keeps reading the old shape and its limb goes quietly
// vacuous.
//
// ⚠️ MOVED CODE SILENCES GUARDS, so this extraction was proved rather than
// assumed: limb 3 was rewired onto this function and the 79 cases in
// tooling/ci/test/entitlement-contract.test.mjs — which include EC3, EC6, EC7 and
// EC9, the mutations that make limb 3 bite — were run GREEN first, then re-run
// with each mutation, and each still went RED.
//
// ── THE THREE TRAPS THIS PARSER SURVIVES, every one measured on the real tree ──
//
//  1 · PARENTHESES AND COMMAS INSIDE STRING LITERALS. The seeded descriptions are
//      English sentences containing "(stage 13)". A scanner that counts every `(`
//      desynchronises its depth counter and starts reading the COLUMN NAME as a
//      seeded value.
//
//  2 · THE `ON CONFLICT(reason) DO NOTHING` TAIL. It ends the statement with a
//      PARENTHESISED COLUMN LIST, which a naive tuple scanner reads as one more
//      VALUES tuple — so the guard "finds" a seeded member called `reason` and
//      reports it as drift against the runtime set.
//
//  3 · DOUBLED QUOTES. `Apple''s cert chain` is one string, not the end of one.
//
// Every one of these fails LOUDLY rather than silently, which is the right
// direction — but a parser that miscounts can fail in the other direction just as
// easily, which is why they are handled rather than tolerated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The rows a migration set seeds into `table`, as an array of column→value maps.
 *
 * @param {string} sqlWithStrings the migration text WITH string literals intact
 *   (a strings-removed view cannot answer a question about string VALUES)
 * @param {string} table the table whose `INSERT … VALUES` to read
 * @returns {{ ok: true, columns: string[], rows: Record<string,string>[] }
 *          | { ok: false, why: string }}
 */
export function parseSeededRows(sqlWithStrings, table) {
  const insertRe = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(([^)]*)\\)\\s*VALUES`, 'i');
  const insertMatch = insertRe.exec(sqlWithStrings);
  if (!insertMatch) {
    return { ok: false, why: `no \`INSERT INTO ${table} (…) VALUES …\` seed was found` };
  }
  const columns = insertMatch[1].split(',').map((s) => s.trim().replace(/["'`[\]]/g, ''));

  const after = sqlWithStrings.slice(insertMatch.index + insertMatch[0].length);

  // TRAP 1 + 3 — the statement terminator, found while tracking string state.
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

  // TRAP 2 — stop at the conflict clause.
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

  /** Top-level tuples. */
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

  const rows = [];
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
    /** @type {Record<string,string>} */
    const row = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = (parts[i] ?? '').trim().replace(/^'|'$/g, '');
    }
    rows.push(row);
  }

  return { ok: true, columns, rows };
}

/**
 * EVERY seed a migration set writes into `table`, in file order: the rows of
 * each `INSERT INTO <table> (…) VALUES …` statement, concatenated.
 *
 * ⏱ 2026-09-27 · O-ONE-TIME-GRANT-UNBUILT. `parseSeededRows` reads the FIRST
 * statement only, which was the whole set while 0009 was the only migration to
 * seed `bundle_sources`. Migration 0019 seeds `paddle_one_time` in a second
 * statement, and a reader of the first one would never see it: the runtime copy
 * that names it would read as an invented source, and a copy that left it out
 * would read as complete. `columns` is the union, in first-seen order; a row
 * carries only the columns its own statement names.
 *
 * @param {string} sqlWithStrings the migration text WITH string literals intact
 * @param {string} table the table whose seeds to read
 * @returns {{ ok: true, columns: string[], rows: Record<string,string>[], statements: number }
 *          | { ok: false, why: string }}
 */
export function parseAllSeededRows(sqlWithStrings, table) {
  const startRe = new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\(`, 'gi');
  const columns = [];
  const rows = [];
  let statements = 0;
  for (const m of sqlWithStrings.matchAll(startRe)) {
    const one = parseSeededRows(sqlWithStrings.slice(m.index), table);
    if (!one.ok) continue;
    statements += 1;
    for (const c of one.columns) if (!columns.includes(c)) columns.push(c);
    rows.push(...one.rows);
  }
  if (statements === 0) return { ok: false, why: `no \`INSERT INTO ${table} (…) VALUES …\` seed was found` };
  return { ok: true, columns, rows, statements };
}
