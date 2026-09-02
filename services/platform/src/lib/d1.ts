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
