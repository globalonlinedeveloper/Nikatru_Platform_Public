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

/** 🔴 THE TRANSIENT-D1 RETRY, AND WHY IT EXISTS AT ALL.
 *
 *  `E2E (live)` was red on roughly half its nights — 08-29 fail, 08-30 pass,
 *  08-31 fail, 09-01 fail, 09-02 pass — and the failure was a real production
 *  500, not a test defect. Root-caused 2026-09-02 from three independent
 *  sources (the CI logs, GlitchTip issues 24 and 25 tagged `service=subly-api`
 *  with two events 10 ms apart, and Supabase auth logs):
 *
 *      D1_ERROR: D1 DB storage operation exceeded timeout which caused
 *      object to be reset.
 *        at D1DatabaseSessionAlwaysPrimary._sendOrThrow
 *
 *  D1 runs inside a Durable Object; the DO is occasionally reset and every
 *  statement in flight fails at once. `src/index.ts` maps any unhandled throw
 *  to `internal_error`/500, so one reset out of ~20 D1-backed calls in a run
 *  was a red night — because NOTHING retried, not this Worker and not the Dart
 *  client.
 *
 *  ⚠️ THE TEST'S OWN DIAGNOSIS WAS WRONG AND COST SEVERAL INVESTIGATIONS.
 *  It reported "Scan never finished … sign-in likely failed", which points at
 *  auth. Supabase returned 200 on that sign-in 25 s earlier, every time.
 *
 *  🔴 NARROW BY CONSTRUCTION, BECAUSE A BROAD RETRY IS WORSE THAN NONE. Only
 *  the messages Cloudflare documents as transient are retried. A constraint
 *  violation, a SQL error, a type error and an authorization failure are all
 *  DETERMINISTIC: retrying them burns the request's time budget and turns a
 *  clear error into a slow one. `isTransientD1Error` is exported so the list is
 *  testable on its own, and its negative cases are asserted, not assumed.
 */
const TRANSIENT_D1_MESSAGES = [
  // The one measured in production on 2026-08-29 and 2026-09-01.
  'storage operation exceeded timeout which caused object to be reset',
  // The DO was evicted or its code was redeployed under an in-flight request.
  'reset because its code was updated',
  'durable object reset',
  // Cloudflare's generic transient-transport wording.
  'network connection lost',
  'internal error in durable object storage',
];

/** True only for the errors Cloudflare documents as retryable. Everything else
 *  — constraint failures included — is deterministic and must surface. */
export function isTransientD1Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  // A constraint failure can co-occur with the word "reset" in a longer
  // message; it is never transient, so it is refused FIRST and explicitly.
  if (lower.includes('unique constraint') || lower.includes('constraint failed')) return false;
  return TRANSIENT_D1_MESSAGES.some((m) => lower.includes(m));
}

/** A UNIQUE/PRIMARY-KEY collision, which is what a RETRIED insert sees when the
 *  first attempt actually committed before the object was reset. */
export function isUniqueViolation(err: unknown): boolean {
  const lower = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return lower.includes('unique constraint') || lower.includes('constraint failed: subscriptions.id');
}

/** Run a D1 operation, retrying ONLY the documented-transient failures.
 *
 *  Two attempts total by default, not more: a DO reset resolves in milliseconds
 *  or it does not resolve at all, and a Worker has a wall-clock budget that a
 *  retry ladder would spend on a database that is already gone. The delay is
 *  small and fixed for the same reason — this is not congestion backoff.
 *
 *  ⚠️ `attempts` is the TOTAL, so 1 disables retrying. Passing 0 or a
 *  non-integer is refused rather than silently treated as "no retry", because a
 *  retry helper that quietly stops retrying is exactly the kind of guard this
 *  repository keeps finding: green, and doing nothing. */
export async function withD1Retry<T>(
  op: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError(`withD1Retry: attempts must be an integer >= 1, got ${String(opts.attempts)}`);
  }
  const delayMs = opts.delayMs ?? 25;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      last = err;
      // 🔴 THE LAST ATTEMPT RETHROWS THE ORIGINAL ERROR, NOT A WRAPPER. The
      // message is what GlitchTip groups on and what named this defect; losing
      // it would have made this bug harder to find, not easier.
      if (attempt === attempts || !isTransientD1Error(err)) throw err;
      opts.onRetry?.(err, attempt);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

/** Return all rows of a prepared statement, typed as T[].
 *  A read is idempotent, so a transient D1 reset is retried unconditionally. */
export async function allRows<T = Record<string, unknown>>(
  stmt: D1PreparedStatement,
): Promise<T[]> {
  const { results } = await withD1Retry(() => stmt.all<T>());
  return results ?? [];
}

/** Return the first row of a prepared statement or null. Read, so retried. */
export async function firstRow<T = Record<string, unknown>>(
  stmt: D1PreparedStatement,
): Promise<T | null> {
  return (await withD1Retry(() => stmt.first<T>())) ?? null;
}

/** Execute a write statement; returns the D1 result meta.
 *
 *  🔴 RETRYING A WRITE IS ONLY SAFE BECAUSE OF A PROPERTY OF THE CALLERS, AND
 *  THE PROPERTY IS STATED HERE RATHER THAN ASSUMED. Every insert this Worker
 *  makes carries a PRIMARY KEY the REQUEST generated before the statement ran —
 *  `routes/subscriptions.ts` calls `uuid()` on its own line, then binds it —
 *  and `subscriptions.id` is `TEXT PRIMARY KEY` in migrations/0001_init.sql. So
 *  a retry re-sends the SAME id, and SQLite can only accept it once. The insert
 *  is idempotent by construction, not by hope.
 *
 *  That leaves exactly one ambiguity, which is the whole reason this wrapper is
 *  not a plain `withD1Retry`: when the object is reset AFTER the write committed
 *  but BEFORE the acknowledgement returns, the retry hits a UNIQUE violation.
 *  Surfacing that would turn a SUCCESSFUL write into a 500 — the same red night,
 *  one layer down. Since the only writer of that id is this request, a conflict
 *  ON A RETRY means "the first attempt committed", and that is a success.
 *
 *  ⚠️ AND IT IS SCOPED TO THE RETRY, DELIBERATELY. A UNIQUE violation on the
 *  FIRST attempt is a genuine duplicate and still throws — swallowing that would
 *  hide a real collision behind a helper nobody reads. The distinction is the
 *  entire correctness argument, so it is asserted in test/d1-retry.test.ts with
 *  a case for each side.
 *
 *  The synthesized meta reports `changes: 0` because this call changed nothing;
 *  the earlier attempt did. Reporting 1 would claim a write this invocation did
 *  not perform. No caller reads `meta` today, and if one starts, 0 is the
 *  honest number. */
export async function run(stmt: D1PreparedStatement): Promise<D1Result> {
  let sawTransient = false;
  try {
    return await withD1Retry(() => stmt.run(), { onRetry: () => { sawTransient = true; } });
  } catch (err) {
    if (sawTransient && isUniqueViolation(err)) {
      return {
        success: true,
        results: [],
        meta: { changes: 0, duplicate_of_committed_attempt: true },
      } as unknown as D1Result;
    }
    throw err;
  }
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
