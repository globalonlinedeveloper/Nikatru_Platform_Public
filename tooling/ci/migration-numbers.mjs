// ─────────────────────────────────────────────────────────────────────────────
// migration-numbers.mjs — ONE migration number per migrations directory.
//
// ⏱ 2026-09-30 · ADR no.NNN, third review of #1070 (finding 3, the class fix).
// Two open PRs each added `services/platform/migrations/0021_*.sql`. Wrangler
// tracks applied migrations by FILE NAME, so both would apply and nothing would
// say so: the duplicate lands silently, the order between the two is the
// alphabetical accident of their names, and every citation of "0021" is now
// ambiguous. The PR that lands second must renumber — this is what tells it to.
//
// Not a guard: a pure function over paths. tooling/ci/check-migrations.mjs, the
// schema guard, runs it over exactly the files it scans.
// ─────────────────────────────────────────────────────────────────────────────

/** `NNNN_` at the start of a migration's file name. */
const NUMBER = /^(\d+)_/;

/**
 * Every (directory, number) that more than one migration file claims, as
 * `[{ dir, number, files }]`, sorted. Paths may use either separator. A file
 * whose name carries no number is not this function's business.
 */
export function duplicateMigrationNumbers(paths) {
  const byKey = new Map();
  for (const raw of paths) {
    const p = String(raw).replaceAll('\\', '/');
    const cut = p.lastIndexOf('/');
    const dir = cut === -1 ? '.' : p.slice(0, cut);
    const name = p.slice(cut + 1);
    const m = NUMBER.exec(name);
    if (!m) continue;
    const key = `${dir}\u0000${m[1]}`;
    if (!byKey.has(key)) byKey.set(key, { dir, number: m[1], files: [] });
    byKey.get(key).files.push(name);
  }
  return [...byKey.values()]
    .filter((g) => g.files.length > 1)
    .map((g) => ({ ...g, files: g.files.sort() }))
    .sort((a, b) => (a.dir === b.dir ? a.number.localeCompare(b.number) : a.dir.localeCompare(b.dir)));
}
