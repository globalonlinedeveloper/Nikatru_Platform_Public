// ─────────────────────────────────────────────────────────────────────────────
// d1.ts — TYPED HELPERS OVER D1, AND THE TRANSIENT RETRY. THE ONE HOME.
//
// 🔴 THE MEASURED DEFECT THIS EXISTS FOR. `E2E (live)` was red on roughly half
// its nights — 08-29 fail, 08-30 pass, 08-31 fail, 09-01 fail, 09-02 pass — and
// the failure was a real production 500, not a test defect. Root-caused
// 2026-09-02 from three independent sources (the CI logs, two GlitchTip events
// 10 ms apart, and the auth logs that ruled out sign-in):
//
//     D1_ERROR: D1 DB storage operation exceeded timeout which caused
//     object to be reset.
//       at D1DatabaseSessionAlwaysPrimary._sendOrThrow
//
// D1 runs inside a Durable Object; the object is occasionally reset and every
// statement in flight fails at once. A Worker's `onError` maps any unhandled
// throw to `internal_error`/500, so ONE reset out of ~20 D1-backed calls in a
// run was a red night — because nothing retried, not the Worker and not the
// client.
//
// ⚠️ THE TEST'S OWN DIAGNOSIS WAS WRONG AND COST SEVERAL INVESTIGATIONS. It
// reported "Scan never finished … sign-in likely failed", which points at auth.
// Sign-in had returned 200 twenty-five seconds earlier, every time.
//
// ── WHY THIS FILE IS HERE AND NOT COPIED THREE TIMES ─────────────────────────
// ⏱ 2026-09-12. This lived as two deliberate copies — one per Worker — held
// equal declaration by declaration by services/platform/test/twinned-worker-modules.test.ts,
// while the app template shipped a FOUR-LINE stub carrying `nowIso` alone. So the
// retry above, and the night it cost to find, reached both live Workers and NOT
// the template every future app is stamped from: app #2 would have been born with
// the defect already diagnosed and fixed twice. Found by the factory-vs-app drift
// audit (research/factory-drift-2026-09-12/), and fixed the way [ADR 067]
// decision 2 says to fix it — ONE home that every carrier re-exports, the same
// shape health.ts already uses — rather than by adding a third copy to keep in
// step.
//
// 🔴 services/_shared MAY HOLD NO BARE IMPORT. Its header states the measured
// reason in full; this file obeys it by importing nothing at all.
// ─────────────────────────────────────────────────────────────────────────────

/** 🔴 NARROW BY CONSTRUCTION, BECAUSE A BROAD RETRY IS WORSE THAN NONE. Only the
 *  messages Cloudflare documents as transient are retried. A constraint
 *  violation, a SQL error, a type error and an authorization failure are all
 *  DETERMINISTIC: retrying them burns the request's time budget and turns a clear
 *  error into a slow one. */
const TRANSIENT_D1_MESSAGES = [
  // The one measured in production on 2026-08-29 and 2026-09-01.
  'storage operation exceeded timeout which caused object to be reset',
  // The object was evicted, or its code was redeployed under an in-flight request.
  'reset because its code was updated',
  'durable object reset',
  // Cloudflare's generic transient-transport wording.
  'network connection lost',
  'internal error in durable object storage',
];

/** True only for the errors Cloudflare documents as retryable. Everything else —
 *  constraint failures included — is deterministic and must surface.
 *
 *  Exported so the list is testable on its own, and its NEGATIVE cases are
 *  asserted rather than assumed. */
export function isTransientD1Error(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const lower = msg.toLowerCase();
  // A constraint failure can co-occur with the word "reset" in a longer message;
  // it is never transient, so it is refused FIRST and explicitly.
  if (lower.includes('unique constraint') || lower.includes('constraint failed')) return false;
  return TRANSIENT_D1_MESSAGES.some((m) => lower.includes(m));
}

/** A UNIQUE/PRIMARY-KEY collision — what a RETRIED insert sees when the first
 *  attempt actually committed before the object was reset.
 *
 *  ⏱ 2026-09-12: both copies of this function also matched a literal table
 *  column by name. That was a clone tell in shared code, and it was redundant:
 *  the wording SQLite emits for a primary-key collision is
 *  `UNIQUE constraint failed: <table>.<column>`, which the first clause already
 *  covers, and the older `PRIMARY KEY must be unique` phrasing is covered by the
 *  second. Matching a bare `constraint failed:` instead would have been WIDER
 *  than the truth: a FOREIGN KEY failure is not evidence that anything
 *  committed, and `run` below treats this predicate as exactly that evidence. */
export function isUniqueViolation(err: unknown): boolean {
  const lower = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  return lower.includes('unique constraint') || lower.includes('primary key must be unique');
}

/** Run a D1 operation, retrying ONLY the documented-transient failures.
 *
 *  Two attempts total by default, not more: a reset resolves in milliseconds or
 *  it does not resolve at all, and a Worker has a wall-clock budget that a retry
 *  ladder would spend on a database that is already gone. The delay is small and
 *  fixed for the same reason — this is not congestion backoff.
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
      // message is what the error tracker groups on and what named this defect;
      // losing it would have made this bug harder to find, not easier.
      if (attempt === attempts || !isTransientD1Error(err)) throw err;
      opts.onRetry?.(err, attempt);
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last;
}

/** Return all rows of a prepared statement, typed as T[].
 *  A read is idempotent, so a transient reset is retried unconditionally. */
export async function allRows<T = Record<string, unknown>>(stmt: D1PreparedStatement): Promise<T[]> {
  const { results } = await withD1Retry(() => stmt.all<T>());
  return results ?? [];
}

/** Return the first row of a prepared statement, or null. A read, so retried. */
export async function firstRow<T = Record<string, unknown>>(stmt: D1PreparedStatement): Promise<T | null> {
  return (await withD1Retry(() => stmt.first<T>())) ?? null;
}

/** Execute a write statement; returns the D1 result meta.
 *
 *  🔴 RETRYING A WRITE IS SAFE ONLY BECAUSE OF A PROPERTY OF THE CALLER, AND THE
 *  PROPERTY IS A CONTRACT STATED HERE RATHER THAN A HOPE. Every insert that goes
 *  through this helper must carry a PRIMARY KEY THE REQUEST GENERATED BEFORE THE
 *  STATEMENT RAN — `uuid()` on its own line, then bound — against a column
 *  declared unique. A retry then re-sends the SAME id, and SQLite can accept it
 *  once. The insert is idempotent by construction, not by luck. A caller that
 *  lets the DATABASE mint the key (AUTOINCREMENT, a default, a value derived
 *  inside SQL) breaks that contract and must not use this helper.
 *
 *  That leaves exactly one ambiguity, and it is the whole reason this is not a
 *  plain `withD1Retry`: when the object is reset AFTER the write committed but
 *  BEFORE the acknowledgement returns, the retry hits a UNIQUE violation.
 *  Surfacing it would turn a SUCCESSFUL write into a 500 — the same red night,
 *  one layer down. Since the only writer of that id is this request, a conflict
 *  ON A RETRY means "the first attempt committed", and that is a success.
 *
 *  ⚠️ AND IT IS SCOPED TO THE RETRY, DELIBERATELY. A UNIQUE violation on the
 *  FIRST attempt is a genuine duplicate and still throws — swallowing that would
 *  hide a real collision behind a helper nobody reads. The distinction is the
 *  entire correctness argument, so each side of it is asserted in the tests.
 *
 *  The synthesized meta reports `changes: 0` because this call changed nothing;
 *  the earlier attempt did. Reporting 1 would claim a write this invocation did
 *  not perform. No caller reads `meta` today, and if one starts, 0 is the honest
 *  number. */
export async function run(stmt: D1PreparedStatement): Promise<D1Result> {
  let sawTransient = false;
  try {
    return await withD1Retry(() => stmt.run(), {
      onRetry: () => {
        sawTransient = true;
      },
    });
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

/** Execute statements as ONE `db.batch()` — one round trip, one implicit
 *  transaction — retrying a transient reset.
 *
 *  ⏱ 2026-10-01 · rv2 SYN-S2 (services-027).
 *  `PUT /v1/budget` sent its replace as a bare `APP_DB.batch()`, so the one
 *  reset `run` above exists for was still a 500 on the write a user makes when
 *  they save their budget.
 *
 *  🔴 RETRYING A BATCH IS SAFE ONLY BECAUSE OF A PROPERTY OF THE CALLER, STATED
 *  HERE AS `run`'s IS. A batch is one transaction, so a reset either rolled ALL of
 *  it back or committed ALL of it. The retry is therefore correct only when
 *  running the WHOLE batch twice leaves the same rows as running it once: every
 *  statement is an upsert, a DELETE, an UPDATE to absolute values, or an INSERT of
 *  a key the request generated before the batch ran — and an INSERT of such a key
 *  is preceded, IN THE SAME BATCH, by the DELETE that clears it (the budget's
 *  delete-then-insert replace), so the second run meets no row from the first. A
 *  caller that appends, counts or lets the database mint a key breaks that
 *  contract and must not use this helper.
 *
 *  ⚠️ NO UNIQUE-ON-RETRY ALLOWANCE, unlike `run`. A batch that meets its own
 *  committed rows has broken the contract above, and surfacing that is the honest
 *  answer: the conflict names a caller to fix, not a write that succeeded. */
export async function batchIdempotent<T = unknown>(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  return withD1Retry(() => db.batch<T>(statements));
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
