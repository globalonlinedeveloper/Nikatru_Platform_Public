// ─────────────────────────────────────────────────────────────────────────────
// Tiny typed helpers over D1 prepared statements + a couple of util functions.
//
// ⚠️ A DELIBERATE DUPLICATE of services/platform/src/lib/d1.ts — same reasoning as
// error-sink.ts in this directory, which carries it in full.
// `services/platform/test/twinned-worker-modules.test.ts` holds `allRows`,
// `uuid`, `nowIso` and `todayYmd` identical across both copies, and declares
// `firstRow` + `run` as belonging to THIS copy only: they have callers here
// (routes/budget.ts, routes/subscriptions.ts) and none there. If platform ever
// grows its own copy of either, that test goes red rather than letting two
// versions of the same helper drift apart unnoticed.
//
// ⚠️ "BOTH COPIES" IS TODAY'S COUNT, NOT A CEILING. The brick's backend template
// carries this file as a four-line stub holding `nowIso` alone, so a Worker
// stamped for app #2 joins the comparison without `allRows`, `uuid` or
// `todayYmd`. Those three are declared in that test as sole-owned by platform +
// subly-api, so the stamp is green on day one and a stamped copy that later
// diverges is not.
// ─────────────────────────────────────────────────────────────────────────────

/** Return all rows of a prepared statement, typed as T[]. */
export async function allRows<T = Record<string, unknown>>(
  stmt: D1PreparedStatement,
): Promise<T[]> {
  const { results } = await stmt.all<T>();
  return results ?? [];
}

/** Return the first row of a prepared statement or null. */
export async function firstRow<T = Record<string, unknown>>(
  stmt: D1PreparedStatement,
): Promise<T | null> {
  return (await stmt.first<T>()) ?? null;
}

/** Execute a write statement; returns the D1 result meta. */
export async function run(stmt: D1PreparedStatement): Promise<D1Result> {
  return stmt.run();
}

/** RFC 4122 v4 UUID (available on the Workers runtime). */
export function uuid(): string {
  return crypto.randomUUID();
}

/** Current time as an ISO-8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Today as 'YYYY-MM-DD' (UTC). */
export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
