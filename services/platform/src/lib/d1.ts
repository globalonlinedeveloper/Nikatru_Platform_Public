// ─────────────────────────────────────────────────────────────────────────────
// Tiny typed helpers over D1 + time/uuid utils (shared with the app workers).
//
// ⚠️ "SHARED" MEANS DUPLICATED, NOT IMPORTED — services/subly-api carries its own
// copy, because the two Workers are separate npm packages with separate deploys
// (see that copy's error-sink.ts header for the measurement behind the choice).
// `test/twinned-worker-modules.test.ts` holds the four functions below identical
// across every copy THAT CARRIES THEM. It also records why this copy is SHORTER:
// subly-api adds `firstRow` and `run`, which nothing here calls — platform uses
// `stmt.first<T>()` and `stmt.run()` directly — so adding them would ship two
// exported functions with zero callers rather than close a gap.
//
// ⚠️ "THAT CARRIES THEM" IS LOAD-BEARING FROM APP #2 ONWARD. The brick's backend
// template ships its `src/lib/d1.ts` as a four-line stub holding `nowIso` alone
// (the only helper a stamped Worker imports), so a Worker stamped from it starts
// without `allRows`, `uuid` and `todayYmd`. Those three are declared in that
// test's DECLARED_SOLE_OWNERS so stamp day is not a red build; the moment a
// stamped Worker grows its own copy of one, the row stops matching the tree and
// the test demands it be deleted so all copies are held equal again.
// ─────────────────────────────────────────────────────────────────────────────

/** Return all rows of a prepared statement, typed as T[]. */
export async function allRows<T = Record<string, unknown>>(
  stmt: D1PreparedStatement,
): Promise<T[]> {
  const { results } = await stmt.all<T>();
  return results ?? [];
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
