// ─────────────────────────────────────────────────────────────────────────────
// sql-export-replay.mjs — THE SQL PORT'S EXPORT DUTY, REHEARSED: one nightly
// D1 export, loaded into a node:sqlite file built from the migrations alone.
//
// ⏱ 2026-10-02 · port-sql (O-CLOUDFLARE-BINDINGS-SCATTERED). tooling/ports/
// sql.json says what leaves with us is "the nightly R2 export plus the
// migrations". This is the check that the two together ARE the database:
//
//   1. read ONE export a person was given locally — the gzipped JSON lines
//      services/platform/src/backup/dump.ts writes (`meta`, `schema`, `index`,
//      `row`, `table-end`, `end`). Never fetched: no network, no credential, no
//      R2 call. A cut-off or truncated export is refused before anything runs;
//   2. find the migrations of the database it names — the wrangler config that
//      OWNS it (`migrations_dir`, tooling/ci/d1-stores.mjs) — and replay them,
//      in file order, into a FRESH node:sqlite file in the OS temp directory,
//      deleted afterwards;
//   3. compare the TABLE LIST — every table the export carries must be one the
//      migrations create, and every table the migrations create must be in the
//      export — and load every row into the replayed schema;
//   4. compare the ROW COUNTS — each table's `table-end` against COUNT(*) of
//      what loaded.
//
// Every mismatch is a FAIL line, naming the table and the two numbers. It is
// READ-ONLY with respect to the repository and the export, and it prints counts
// and table names only — never a row (they are users').
//
// Rows load as the restore loads them (dump.ts d1RestoreStatements): INSERT OR
// REPLACE in rowid order with foreign keys OFF, `{"$blob": base64}` back to
// bytes. So a row dumped twice under a re-inserted TEXT key loads ONCE, and its
// table counts one short of its `table-end` — reported as a FAIL with that
// reason named, because a replay that cannot tell it from a lost row must not
// call it a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ownedD1Stores } from '../ci/d1-stores.mjs';

/** The dump formats this replay reads: services/platform/src/backup/dump.ts
 *  RESTORABLE_GENERATORS (D1_DUMP_GENERATOR is the newest). */
export const EXPORT_GENERATORS = new Set(['platform-worker-backup/1', 'platform-worker-backup/2']);
/** Tables the engine or the platform keeps for itself; never part of either side. */
const INTERNAL = (name) => name.startsWith('sqlite_') || name.startsWith('_cf_') || name === 'd1_migrations';
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The export's text: gunzipped when it carries the gzip magic, else as written. */
export function readExportFile(path) {
  const buf = readFileSync(path);
  return (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
}

/** One dumped value as SQLite binds it — dump.ts decodeD1DumpValue. */
function decode(value) {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof value.$blob === 'string') {
    return new Uint8Array(Buffer.from(value.$blob, 'base64'));
  }
  throw new Error(`a dumped value is neither a string, a number, null nor a {"$blob"} marker: ${typeof value}`);
}

function sqliteCtor() {
  const mod = process.getBuiltinModule?.('node:sqlite');
  if (!mod?.DatabaseSync) throw new Error(`node:sqlite is not available in node ${process.version}`);
  return mod.DatabaseSync;
}

/**
 * Replay one export. Returns `{verdict: 'PASS'|'FAIL'|'LOST', detail, lines}`:
 * `lines` holds one `FAIL …` per mismatch and one count line per table.
 */
export function replayExport({ root, jsonl }) {
  const lines = [];
  let parsed;
  try {
    parsed = jsonl.split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l));
  } catch (e) {
    return { verdict: 'LOST', detail: `the export is not JSON lines (${e.message})`, lines };
  }
  const meta = parsed[0];
  if (meta?.kind !== 'meta' || !EXPORT_GENERATORS.has(meta.generator)) {
    return { verdict: 'LOST', detail: `not a D1 export this replay reads: its first line is ${JSON.stringify(meta?.kind === 'meta' ? meta.generator : meta?.kind)}`, lines };
  }
  const end = parsed[parsed.length - 1];
  if (end?.kind !== 'end') return { verdict: 'FAIL', detail: `${meta.database}: the export has no end line — it was cut off`, lines };
  if (end.truncated) return { verdict: 'FAIL', detail: `${meta.database}: the export says it was TRUNCATED — it is missing rows by its own account`, lines };

  let owned;
  try {
    owned = ownedD1Stores(root, (msg) => { throw new Error(msg.join(' ')); }).owned.filter((o) => o.databaseName === meta.database);
  } catch (e) {
    return { verdict: 'LOST', detail: `the wrangler configs could not be read (${e.message})`, lines };
  }
  if (owned.length !== 1) {
    return { verdict: 'LOST', detail: `${owned.length} wrangler config(s) own \`${meta.database}\` (a d1_databases entry with migrations_dir); the replay needs exactly one`, lines };
  }
  const { migrationsDir, files } = owned[0];
  const migrations = files.map((f) => f.file).sort();

  const exported = new Map(); // table -> { rows (row lines), ended (table-end rows) }
  for (const l of parsed) {
    if (l.kind === 'schema' && !INTERNAL(l.table)) exported.set(l.table, { rows: 0, ended: null });
  }
  for (const l of parsed) {
    if (l.kind === 'row' && exported.has(l.table)) exported.get(l.table).rows++;
    if (l.kind === 'table-end' && exported.has(l.table)) exported.get(l.table).ended = l.rows;
  }

  const dir = mkdtempSync(join(tmpdir(), 'sql-export-replay-'));
  const DatabaseSync = sqliteCtor();
  const db = new DatabaseSync(join(dir, 'replay.sqlite'));
  try {
    for (const f of migrations) {
      try {
        db.exec(readFileSync(join(root, migrationsDir, f), 'utf8'));
      } catch (e) {
        return { verdict: 'FAIL', detail: `${migrationsDir}/${f} does not replay on a fresh database (${e.message})`, lines };
      }
    }
    const replayed = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name).filter((n) => !INTERNAL(n)),
    );
    const fails = [];
    for (const t of [...exported.keys()].sort()) {
      if (!replayed.has(t)) fails.push(`table \`${t}\` is in the export and no migration in ${migrationsDir} creates it`);
    }
    for (const t of [...replayed].sort()) {
      if (!exported.has(t)) fails.push(`table \`${t}\` is created by the migrations and is missing from the export`);
    }
    db.exec('PRAGMA foreign_keys = OFF');
    const loadFailed = new Set();
    for (const l of parsed) {
      if (l.kind !== 'row' || !replayed.has(l.table) || loadFailed.has(l.table)) continue;
      const names = Object.keys(l.data ?? {});
      const bad = [l.table, ...names].find((n) => !SAFE_IDENTIFIER.test(n));
      if (bad) { fails.push(`table \`${l.table}\`: ${JSON.stringify(bad)} is not a plain identifier`); loadFailed.add(l.table); continue; }
      try {
        db.prepare(`INSERT OR REPLACE INTO "${l.table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
          .run(...names.map((n) => decode(l.data[n])));
      } catch (e) {
        fails.push(`table \`${l.table}\`: a row does not load into the replayed schema (${e.message})`);
        loadFailed.add(l.table);
      }
    }
    let rows = 0;
    for (const t of [...exported.keys()].sort()) {
      const x = exported.get(t);
      if (x.ended === null) { fails.push(`table \`${t}\` has no table-end line in the export`); continue; }
      if (x.ended !== x.rows) { fails.push(`table \`${t}\` ends at ${x.ended} row(s) and the export holds ${x.rows}`); continue; }
      if (!replayed.has(t) || loadFailed.has(t)) continue;
      const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n);
      rows += n;
      if (n !== x.ended) fails.push(`table \`${t}\`: the export counts ${x.ended} row(s) and ${n} loaded (a row dumped twice under a re-inserted key loads once; anything else is a lost row)`);
      else lines.push(`    ${t.padEnd(36)} ${String(n).padStart(8)} row(s)`);
    }
    for (const f of fails) lines.push(`    FAIL ${f}`);
    if (fails.length) return { verdict: 'FAIL', detail: `${meta.database}: ${fails.length} mismatch(es) — first: ${fails[0]}`, lines };
    return {
      verdict: 'PASS',
      detail: `${meta.database}: ${migrations.length} migration(s) of ${migrationsDir} replayed; ${exported.size} table(s) and ${rows} row(s) match the export (read-only; nothing was switched)`,
      lines,
    };
  } finally {
    db.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
}
