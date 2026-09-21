// ─────────────────────────────────────────────────────────────────────────────
// bounded-retry.mjs — THE ONE READING OF "IS THIS FAILURE A BLIP OR AN OUTAGE?"
// FOR EVERY READER UNDER tooling/ops/.
//
// NOT A GUARD. It scans nothing, reads no file, makes no request and never sets
// an exit code. Pure classification plus one injectable sleep. The COVERAGE LOST
// decision stays with the caller, exactly as it does for text-reductions.mjs and
// capture-suite-scan.mjs: this module answers "ask again?", never "is it fine?".
//
// ── WHY IT EXISTS ───────────────────────────────────────────────────────────
// 🔴 ONE DROPPED TCP CONNECTION TURNED A WHOLE ops-watch RUN RED (row
// O-PAGES-FETCH-TRANSIENT-NOT-RETRIED). Run 35478397730 read
// `✗ nikatru (git) — TypeError: fetch failed`: 0 RED, 1 NOT JUDGED, exit 2, while
// the other two projects read fine in the SAME run and a dispatch sixteen minutes
// later was green. A red ops-watch reddens `ci-gate` on `main`, so that blip froze
// the merge queue — and it teaches every reader to shrug at an ops-watch red,
// which is how a genuinely red one (eight missed heartbeats) sat unnoticed for
// eight hours the same day.
//
// #852 fixed that ONE reader and said, in its own header, that the class sweep
// wanted a shared `tooling/ops/` retry module. This is that module, and the
// primitives below are #852's, MOVED rather than rewritten: same names, same
// numbers, same semantics. check-pages-deployments.mjs now imports them and
// re-exports them, so the 82 cases it already shipped are the green control for
// the move (MOVED CODE SILENCES GUARDS — the move was proved before the sweep
// that follows it, not assumed).
//
// ── THE MEASURED CLASS, SWEPT 2026-09-21 ────────────────────────────────────
// ELEVEN readers under tooling/ops/ turned a single un-retried `fetch` into a
// run-level verdict with NO retry of any kind — check-heartbeats,
// check-analytics-liveness, status, verify-supabase-templates,
// check-prod-provenance, verify-monitors, verify-alarm-chains,
// verify-auth-providers, check-wildcard-dns, check-turnstile-hosts,
// check-retired-names-live. Two more had a private one:
// check-d1-accepts-live-sql retried ONCE with no gap and only on a transport
// throw (a 429 was final), and verify-free-api-scope had a module-local
// `fetchWithRetry` on a LINEAR gap. record-deployment.mjs exports the policy
// primitives (`RETRY_ATTEMPTS`, `isRetryable`, `retryDelayMs`) but no wrapper,
// and its policy is GitHub-shaped: it deliberately EXCLUDES 429, which for the
// Cloudflare API is exactly the "ask again" case. So it is not the home for this,
// and this module does not shadow its exports with different meanings.
//
// 🔴 `status.mjs` WAS THE WORST SHAPED, AND ITS DEFECT WAS THE VERDICT, NOT THE
// RETRY. `probeLive` turned EVERY transport failure into `{ error }`, which
// `evaluateSurface` reds as `unreachable`, which exits 1 — "I LOOKED, IT IS
// BROKEN". A DNS blip on the runner therefore accused a healthy surface of being
// down. Un-reached is not the same claim as broken, and this repo already spends
// a whole exit code on the difference.
//
// ── THE THREE-VALUED CONTRACT THIS MODULE SERVES ────────────────────────────
//   0  green       · 1  a finding (it really is wrong) · 2  COVERAGE LOST
// A failure that outlives the plan STAYS at the caller's COVERAGE LOST. The
// retry distinguishes a blip from an outage; it forgives neither. Swallowing a
// persistent failure into a pass would turn a real vendor outage into a green
// sweep, which is strictly worse than the false red this module exists to remove.
//
// ── THE NUMBERS, AND WHY EACH ONE IS THAT NUMBER ────────────────────────────
// Every constant here is JUDGEMENT recorded as judgement. None is a vendor SLA
// and none may be cited as one.
//
//   READ_ATTEMPTS = 3, RETRY_BASE_MS = 1000  →  gaps of 1 s then 2 s, so
//   RETRY_CEILING_MS = 3 s of waiting per read. The measured defect is ONE
//   dropped connection, which needs one more try and not six. #852's numbers,
//   unchanged, so adopting this module cannot move the behaviour that row proved.
//
//   RETRY_AFTER_CEILING_MS = 5000. A server that sends `Retry-After` has told us
//   when it will answer; asking sooner burns an attempt on a refusal it already
//   announced. But an honoured header is an UNBOUNDED wait unless it is clamped,
//   and the arithmetic has to fit the smallest job in ops-watch.yml, which is
//   `timeout-minutes: 5` (300 s). The widest fan-out on this lane is status.mjs,
//   which probes one surface per declared hostname at PROBE_TIMEOUT_MS = 10 s
//   each. At ten surfaces the worst case is 10 × 2 gaps × 5 s = 100 s of waiting
//   plus 10 × 10 s = 100 s of probing = 200 s, inside 300 s with margin. At 8 s
//   the same arithmetic reaches 260 s, which is inside the timeout but not inside
//   it with room to be wrong about the surface count.
//
//   RETRY_WALL_CEILING_MS is DERIVED, never typed: (attempts − 1) ×
//   RETRY_AFTER_CEILING_MS — the most wall-clock ONE read may spend waiting even
//   when the server asks for longer on every gap. A hand-copied ceiling is the
//   number that drifts away from the loop it claims to describe, which is why
//   RETRY_CEILING_MS is SUMMED from backoffPlan() too.
//
// ── WHAT IS RE-ASKED, AND WHAT IS AN ANSWER ─────────────────────────────────
// RETRYABLE: the transport failing outright (`TypeError: fetch failed`,
// ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN, ECONNREFUSED, EPIPE, an aborted
// request), HTTP 429, HTTP 5xx.
// AN ANSWER, failed on first sight: every other 4xx — a 401/403 is a revoked
// token and does not improve in two seconds, and re-asking a 404 only spends the
// ceiling — plus unparseable JSON, `success: false`, a missing credential, and
// every programming error a reader could throw. Three identical lines in the log
// are not evidence of anything.
//
// 🔴 CLASSIFICATION IS MARKED AT THE THROW SITE, NEVER INFERRED FROM A MESSAGE.
// `transientLook()` sets the flag; `isTransientLook()` reads it. A future branch
// therefore has to DECIDE which of the two a new failure is, rather than having
// a substring match decide for it — and a message this module never wrote can
// never be mistaken for a promise to retry.
//
// 🔴 ONLY SAFE METHODS ARE RE-ASKED BY DEFAULT. `isSafeMethod` exists because
// verify-alarm-chains.mjs shares one `api()` between its GET reads and the PUT
// its --self-test uses to break and restore a live alert. Re-sending a write
// whose response was lost is a different decision from re-asking a read, and it
// is not this module's to make silently.
//
// Imported by: check-pages-deployments, status, check-heartbeats,
// check-analytics-liveness, check-d1-accepts-live-sql, verify-supabase-templates,
// check-prod-provenance, verify-monitors, verify-alarm-chains,
// verify-auth-providers, verify-free-api-scope, check-wildcard-dns,
// check-turnstile-hosts, check-retired-names-live.
// Failing cases: tooling/ci/test/ops-bounded-retry.test.mjs (this module and the
// adoption, both directions) and tooling/ci/test/pages-deployments.test.mjs (the
// green control for the move).
// ─────────────────────────────────────────────────────────────────────────────

/** Raised where the answer is "nothing was judged", never "it is fine".
 *
 *  ONE class for the whole lane. Each reader used to declare its own, so
 *  `err instanceof CouldNotLook` was only ever true inside the file that threw —
 *  which is survivable while every throw and every catch sit in one file, and is
 *  exactly the thing that breaks the first time a helper moves. */
export class CouldNotLook extends Error {}

/** A `CouldNotLook` that is worth ASKING AGAIN: the transport failed, or the API
 *  answered with a shape that says "not now" rather than "no".
 *
 *  `retryAfterMs` carries a server-stated wait, already clamped by
 *  `retryAfterMs(res)`. It is a FLOOR-AND-CAP on the next gap, not a replacement
 *  for the plan: the loop waits the LONGER of the plan's gap and the server's
 *  request, so honouring a polite header can never make the reader ask FASTER
 *  than its own backoff. */
export function transientLook(message, { retryAfterMs: after } = {}) {
  const e = new CouldNotLook(message);
  e.retryable = true;
  if (Number.isFinite(after) && after > 0) e.retryAfterMs = after;
  return e;
}

/** PURE. Only a failure MARKED transient is re-asked. Anything else — a missing
 *  credential, a 403, a body that is not JSON, and every programming error a
 *  reader could throw — is final. */
export function isTransientLook(err) {
  return err instanceof CouldNotLook && err.retryable === true;
}

/** PURE. The HTTP statuses that mean "not now" rather than "no": 429 (the vendor
 *  is rate-limiting us, which is transient BY DEFINITION) and 5xx (the vendor is
 *  unwell). Every other 4xx is an ANSWER. */
export function isTransientStatus(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

/** The error codes and names a dropped connection arrives as. Listed rather than
 *  pattern-matched so that adding one is a reviewed diff, and so a message this
 *  module never wrote cannot accidentally read as retryable. */
const TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** PURE. Did this thrown value come from the WIRE rather than from the answer?
 *
 *  `fetch` rejects with `TypeError: fetch failed` and hangs the real reason on
 *  `.cause`, so the cause chain is walked — one level is enough for undici and a
 *  bounded walk costs nothing. `AbortError`/`TimeoutError` are here because
 *  every reader on this lane arms an `AbortSignal.timeout`, and a probe the
 *  runner gave up on is the same evidence as a probe the network dropped: none.
 *
 *  🔴 IT IS DELIBERATELY NOT "anything that is a TypeError". A reader with a bug
 *  that reads a property of undefined also throws TypeError, and re-asking a
 *  programming error three times only makes the log longer. The name is checked
 *  together with the message `fetch` actually produces. */
export function isTransportFailure(err) {
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth += 1) {
    if (typeof e !== 'object') break;
    if (TRANSPORT_CODES.has(e.code)) return true;
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    if (e.name === 'TypeError' && /fetch failed|network|socket|terminated/i.test(String(e.message ?? ''))) return true;
  }
  return false;
}

/** PURE. HTTP methods a lost response may be re-sent for without asking anyone.
 *  A GET that never answered has changed nothing; a POST that never answered may
 *  have changed everything, and the reader has to say so deliberately.
 *
 *  ⚠️ The D1 and GlitchTip READS on this lane are POSTs carrying SQL or a query
 *  body. They are reads in every sense but the verb, so those callers pass
 *  `safeMethods` explicitly — which is the point of the parameter: the decision
 *  is recorded at the call site rather than guessed here. */
export function isSafeMethod(method, safeMethods = ['GET', 'HEAD', 'OPTIONS']) {
  return safeMethods.includes(String(method ?? 'GET').toUpperCase());
}

/** How many times one read is attempted, and the first gap. #852's numbers,
 *  unchanged. Named constants rather than literals in a branch, so a test pins
 *  them and a change to either is a reviewed diff. */
export const READ_ATTEMPTS = 3;
export const RETRY_BASE_MS = 1000;

/** The longest single server-stated wait this module will honour, and the most
 *  wall clock ONE read may therefore spend waiting. Both defended in the header
 *  ("THE NUMBERS"); the wall ceiling is DERIVED from the other two. */
export const RETRY_AFTER_CEILING_MS = 5000;

/** PURE. The gaps BETWEEN attempts, doubling: 3 attempts at 1000 ms give
 *  [1000, 2000]. `attempts - 1` gaps, because nothing is waited for after the
 *  last attempt — a run that sleeps after its final failure has bought nothing
 *  and spent the time. */
export function backoffPlan(attempts = READ_ATTEMPTS, baseMs = RETRY_BASE_MS) {
  if (!Number.isInteger(attempts) || attempts < 1) return [];
  if (!Number.isFinite(baseMs) || baseMs < 0) return [];
  return Array.from({ length: attempts - 1 }, (_, i) => baseMs * 2 ** i);
}

/** The most wall-clock one read may spend waiting on the PLAN alone. SUMMED from
 *  the plan, never written down a second time. */
export const RETRY_CEILING_MS = backoffPlan().reduce((a, b) => a + b, 0);

/** The most wall-clock one read may spend waiting at ALL — every gap stretched to
 *  the longest `Retry-After` this module honours. DERIVED, for the same reason
 *  RETRY_CEILING_MS is summed. */
export const RETRY_WALL_CEILING_MS = Math.max(0, READ_ATTEMPTS - 1) * RETRY_AFTER_CEILING_MS;

/** PURE. A response's `Retry-After` in milliseconds, CLAMPED, or `null`.
 *
 *  RFC 9110 allows two forms and vendors send both: delta-seconds ("30") and an
 *  HTTP-date. Both are read; anything else, a negative delta and a date already
 *  in the past all answer `null` rather than 0, so an unreadable header leaves
 *  the plan's own gap in charge instead of collapsing it.
 *
 *  `now` is injected so the HTTP-date branch is testable without a clock.
 *  `headers` is anything with a `.get()`, so a test passes a `Headers` or a
 *  two-line stub and neither needs a network. */
export function retryAfterMs(res, { ceilingMs = RETRY_AFTER_CEILING_MS, now = Date.now() } = {}) {
  const raw = res?.headers?.get?.('retry-after');
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw).trim();
  let ms = null;
  if (/^\d+$/.test(text)) {
    ms = Number(text) * 1000;
  } else {
    const at = Date.parse(text);
    if (!Number.isNaN(at)) ms = at - now;
  }
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, ceilingMs);
}

/** IMPURE ONLY IN ITS CLOCK. The default sleep, replaced in every test. */
const nap = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `read` until it succeeds or the bounded plan is exhausted.
 *
 * `read(attempt)` is called with the 1-based attempt number so a caller can say
 * which try a line came from. It must throw a `transientLook()` for anything
 * worth re-asking and anything else for an answer.
 *
 * `sleep` is injected so a test can prove BOTH directions — a transient failure
 * followed by a success, and a failure that persists — without waiting for a real
 * second; `note` is where the retry is said out loud, so a run that needed one is
 * visible in the log rather than silently clean.
 *
 * 🔴 A PERSISTENT FAILURE STILL THROWS `CouldNotLook`, so it is still the
 * caller's exit 2. The caller cannot tell it from the un-retried version except
 * by the attempt count in the message, which is the point: this distinguishes a
 * blip from an outage, it does not forgive the outage. The rethrown error is a
 * PLAIN `CouldNotLook` with `retryable` unset — a caller that re-wraps must not
 * be able to send an already-exhausted failure round a second loop.
 */
export async function readWithBoundedRetry(
  read,
  { attempts = READ_ATTEMPTS, baseMs = RETRY_BASE_MS, sleep = nap, note = () => {} } = {},
) {
  const gaps = backoffPlan(attempts, baseMs);
  let last = null;
  let waited = 0;
  for (let i = 0; i < Math.max(1, attempts); i += 1) {
    try {
      return await read(i + 1);
    } catch (e) {
      if (!isTransientLook(e)) throw e;
      last = e;
      if (i < gaps.length) {
        // The LONGER of our plan and the server's request, then clamped: an
        // honoured header may slow us down, never speed us up, and may never
        // take one read past RETRY_WALL_CEILING_MS.
        const asked = Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : 0;
        const gap = Math.min(Math.max(gaps[i], asked), RETRY_AFTER_CEILING_MS);
        waited += gap;
        note(
          `attempt ${i + 1}/${attempts} failed (${e.message}); re-asking in ${gap / 1000}s` +
            (asked > gaps[i] ? ' (the server asked for the wait, and it was honoured)' : ''),
        );
        await sleep(gap);
      }
    }
  }
  throw new CouldNotLook(
    `${last.message} — and the same on all ${attempts} attempt(s) over ${waited / 1000}s. A failure that ` +
      `outlives the retry is an OUTAGE, not a blip, so this is COULD NOT LOOK and not a pass.`,
  );
}

/**
 * The classification half, for a reader that already has its own `fetch`
 * wrapper and only needs to know which of the two a failure is.
 *
 * Returns the error to throw: a `transientLook` when the wire dropped, a plain
 * `CouldNotLook` when a bug or an answer produced it. Callers that classify a
 * RESPONSE (rather than a thrown value) use `isTransientStatus` + `retryAfterMs`
 * instead — those two together are the response-shaped half of the same rule.
 */
export function classifyThrown(err, message) {
  return isTransportFailure(err) ? transientLook(message) : new CouldNotLook(message);
}

/**
 * The whole rule in one call, for the eleven readers whose fetch wrapper is the
 * same five lines.
 *
 * `doFetch()` performs ONE request and resolves to a Response. Everything below
 * is the shared judgement: a dropped wire is transient, 429/5xx is transient and
 * honours `Retry-After`, any other non-OK status is an ANSWER, and the caller
 * still owns what a returned Response means.
 *
 * `describe(what)` builds the message, so each reader keeps its own wording —
 * the lines this lane's operators read have not moved.
 */
export async function fetchWithBoundedRetry(doFetch, { describe = (s) => s, ...opts } = {}) {
  return readWithBoundedRetry(async () => {
    let res;
    try {
      res = await doFetch();
    } catch (err) {
      throw classifyThrown(err, describe(`the request did not answer (${err?.name ?? 'error'}: ${err?.message ?? err})`));
    }
    if (isTransientStatus(res.status)) {
      throw transientLook(describe(`the request answered HTTP ${res.status}`), { retryAfterMs: retryAfterMs(res) });
    }
    return res;
  }, opts);
}
