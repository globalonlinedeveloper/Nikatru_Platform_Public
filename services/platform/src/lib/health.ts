// ─────────────────────────────────────────────────────────────────────────────
// health.ts — THE MACHINERY THAT LETS `/v1/health` SAY NO.
//
// 🔴 THE MEASURED STATE THIS REPLACES. Both Workers answered `/v1/health` with
// `ok: true` as a LITERAL. Two live probes rest on that field and neither could
// ever fail:
//   · `tooling/ops/post-deploy-smoke.mjs --require-ok` reads `ok` and asserts a
//     constant — `judgeOk` parsed a body whose answer was decided at compile time;
//   · GlitchTip monitor 11 asserts the body `"ok":true` — the same constant.
// So `platform.nikatru.com` could have PLATFORM_DB unreachable, CONFIG_KV
// refusing reads, or the Supabase JWKS fetch failing (every `DELETE /v1/account`
// 401s) and BOTH stayed green. That is the `Ping` monitor shape at the deepest
// point in the stack: it proves a socket opened and nothing else.
//
// ── ⚠️ "SHARED" MEANS DUPLICATED, NOT IMPORTED ───────────────────────────────
// services/subly-api carries a BYTE-IDENTICAL copy of this file, for the same
// reason d1.ts and error-sink.ts do: the two Workers are separate npm packages
// with separate deploys and no module boundary between them. That duplication is
// not on trust — `services/platform/test/twinned-worker-modules.test.ts` derives
// its subject set from `services/*/src/lib/*.ts` and holds every declaration
// below identical across every carrier. A fix applied to one and not the other
// is a RED BUILD, not a discovery. Nothing Worker-specific may live here: the
// dependency LIST is assembled in each Worker's `src/index.ts`, which is where
// the two legitimately differ.
//
// ── THREE STATES, BECAUSE A BOOLEAN HAS TO LIE ───────────────────────────────
// A check that cannot distinguish "healthy" from "I did not look" is the defect
// being fixed, so a reading is one of:
//
//   ok        — we looked, and the dependency answered.
//   degraded  — we looked, and it did not. A definite negative.
//   unknown   — we did NOT get a reading: the probe timed out, or the binding is
//               absent, or the dependency is not configured. An ABSENCE of
//               evidence, which is a different fact from either of the above.
//
// 🔴 `unknown` IS NOT `ok`, AND THAT IS THE WHOLE POINT. `ok` is true only when
// EVERY reading is `ok`; a timeout or a missing binding makes the endpoint say
// no. The alternative — falling back to `ok: true` when a probe could not run —
// is the exact defect this file exists to remove, wearing a timestamp.
//
// The cost of that choice is a transient probe failure showing as a red health
// check, and it is paid for by machinery that already exists: the deploy smoke
// makes 6 attempts 10s apart, and GlitchTip monitor 11 carries
// `confirmationThreshold: 2`. A false red costs a retry; a false green costs an
// outage nobody sees.
//
// ── THE CACHE, AND WHY EVERY READING CARRIES ITS AGE ─────────────────────────
// A health check that queries every dependency on every request is a DoS
// amplifier: one unauthenticated GET becomes a D1 query plus a KV read plus an
// external fetch, against a FREE tier whose ceilings `tooling/ceilings.json`
// records. So a reading is memoised per isolate for a short TTL.
//
// ⚠️ A CACHED `ok` WITH NO AGE IS THE SAME DEFECT WEARING A TIMESTAMP. Every
// reading therefore carries `ageMs` — 0 when it was just taken, otherwise how
// old the reading is. A consumer can always tell a fresh answer from a
// remembered one, which is precisely what `ok: true` never let anyone do.
//
// ⚠️ THE MEMO IS PER-ISOLATE AND BOUNDS PER-ISOLATE FAN-OUT ONLY. It is a plain
// `Map` in module scope, not KV: KV is the thing being probed, and a shared memo
// would need a WRITE — spending the 1,000-writes/day budget
// (`tooling/ceilings.json` → `kv.writesPerDay`) that this very check exists to
// report on. Cloudflare may hold many isolates, so the global fan-out under a
// flood is bounded by (isolates × 1 per TTL), not by 1 per TTL. Stating the
// bound honestly is the point; claiming a global one would be inventing it.
// ─────────────────────────────────────────────────────────────────────────────

/** The three states a dependency reading can be in. See the header. */
export type ProbeStatus = 'ok' | 'degraded' | 'unknown';

/** What one probe concluded, before it is aged and named. */
export interface ProbeOutcome {
  status: ProbeStatus;
  /** A STABLE, NON-REVEALING code — never an exception message, a connection
   *  string, a key name, a table name or a stack frame. `/v1/health` is PUBLIC:
   *  "PLATFORM_DB unreachable" is fine, the exception text is not. `null` when
   *  the status is `ok` and there is nothing to say. */
  reason: string | null;
}

/** One dependency's reading as it appears on the wire. */
export interface ProbeReading {
  name: string;
  status: ProbeStatus;
  reason: string | null;
  /** How old this reading is, in milliseconds. 0 means it was taken on THIS
   *  request. Non-zero means it came from the memo — see the header. */
  ageMs: number;
}

/** The verdict over every dependency of one Worker. */
export interface HealthReport {
  ok: boolean;
  status: ProbeStatus;
  checks: ProbeReading[];
}

/** One dependency to look at: what to call it, how long a reading of it stays
 *  usable, and how to take one. */
export interface ProbeSpec {
  name: string;
  ttlMs: number;
  run: () => Promise<ProbeOutcome>;
}

/** A remembered reading plus the instant it was taken. */
export interface CachedReading {
  at: number;
  status: ProbeStatus;
  reason: string | null;
}

/** The per-isolate memo. A plain Map, deliberately — see the header. */
export type ProbeCache = Map<string, CachedReading>;

/**
 * How long a dependency reading stays usable.
 *
 * @ceiling none — a CACHE LIFETIME, not a platform resource. No row in
 * `tooling/ceilings.json` bounds how long a reading may be reused, and the
 * relation to every row that does exist is INVERSE (a longer TTL spends FEWER
 * reads), so an `lte` comparison would be arithmetic that cannot fail.
 *
 * THE DERIVATION, written out because it is the whole justification for the
 * value. Two consumers set the floor, and the number must sit BELOW both or it
 * silently weakens them:
 *   · `tooling/ops/post-deploy-smoke.mjs` retries with `GAP_MS = 10_000`. A TTL
 *     of 10s or more would let two consecutive smoke attempts read ONE reading,
 *     turning a 6-attempt ceiling into fewer real looks than it advertises.
 *   · GlitchTip monitor 11 polls at `intervalSeconds: 60` with
 *     `confirmationThreshold: 2`. A TTL at or above 60s would let the two checks
 *     that CONFIRM an outage rest on a single probe — a confirmation threshold
 *     confirming itself.
 * 5s is below both with room to spare, and still collapses a burst: an
 * unauthenticated flood costs at most one dependency fan-out per 5s per isolate
 * instead of one per request.
 */
export const READING_TTL_MS = 5000;

/**
 * How long a JWKS reading stays usable. Longer than [READING_TTL_MS], and the
 * asymmetry is derived rather than chosen for convenience.
 *
 * @ceiling none — a CACHE LIFETIME, same class as [READING_TTL_MS] above.
 *
 * THE DERIVATION. This is the ONE probe that leaves Cloudflare's network: it is
 * an EXTERNAL subrequest to the identity provider, so its cost is paid by a
 * third party as well as by us. It is matched to `JWKS_TTL_SECONDS = 600` in
 * `src/middleware/auth.ts` — the TTL the auth path itself caches the JWKS for.
 * That is the property worth having: for as long as a health reading may be
 * stale, the thing it reports on is ALSO being served from a cache of the same
 * age, so the reading is not stale relative to the behaviour it describes. A
 * shorter TTL here would report a JWKS outage that authentication has not yet
 * begun to feel, and would hammer the provider from every isolate to do it.
 *
 * The cost of the choice, stated rather than hidden: a JWKS outage takes up to
 * 600s to reach `ok: false`. The response carries `ageMs`, so a consumer can see
 * exactly how old the reading it is being given is — which is the difference
 * between a bounded delay and a lie.
 */
export const JWKS_READING_TTL_MS = 600000;

/**
 * How long any single probe may take before the reading is `unknown`.
 *
 * @ceiling none — a LATENCY BUDGET for one subrequest, not a platform resource.
 * Nothing in `tooling/ceilings.json` bounds how long a probe may block.
 *
 * `/v1/health` must answer even when a dependency hangs, because "the health
 * check timed out" is indistinguishable from "the Worker is down" to every
 * consumer, and the two want different responses. 2s is below the smoke's own
 * `TIMEOUT_MS = 15_000` by enough that all probes together cannot exhaust it.
 */
const PROBE_TIMEOUT_MS = 2000;

/** A fresh, empty memo. One per isolate; see the header for why not KV. */
export function newProbeCache(): ProbeCache {
  return new Map<string, CachedReading>();
}

/** The reading for a dependency whose binding is not present. `unknown`, NEVER
 *  `ok`: an absent binding means we could not look, which is the one thing a
 *  boolean health check could never say. */
export function bindingAbsent(): ProbeOutcome {
  return { status: 'unknown', reason: 'binding_absent' };
}

/** The reading for a dependency that is not configured on this deploy. Same
 *  three-state reasoning as [bindingAbsent]. */
export function notConfigured(): ProbeOutcome {
  return { status: 'unknown', reason: 'not_configured' };
}

/** Run a read and call it healthy if it RESOLVES. The value is discarded on
 *  purpose: a KV `get` of an absent key resolves `null`, and a `SELECT ... LIMIT
 *  1` over an empty table resolves `null` too — both are successful reads. What
 *  is being measured is whether the dependency ANSWERED. */
export async function probeRead(read: () => Promise<unknown>): Promise<ProbeOutcome> {
  await read();
  return { status: 'ok', reason: null };
}

/** [probeRead], but `unknown` rather than `degraded` when the binding itself is
 *  missing — the difference between "it is broken" and "it was never wired". */
export function probeBinding(
  binding: unknown,
  read: () => Promise<unknown>,
): Promise<ProbeOutcome> {
  if (binding === undefined || binding === null) return Promise.resolve(bindingAbsent());
  return probeRead(read);
}

/**
 * The identity provider's JWKS document, which every ES256 verification rests
 * on. A failure here is the failure the brief for this change names: the fetch
 * breaks and every `DELETE /v1/account` answers 401, while the Worker itself is
 * perfectly well and a `Ping` is perfectly green.
 *
 * Three outcomes, kept distinct because they are three different faults:
 *   · not configured           → `unknown`  (no SUPABASE_URL on this deploy)
 *   · a non-2xx answer         → `degraded` (the provider is reachable and wrong)
 *   · a 2xx with no keys       → `degraded` (an error page served as a document —
 *     the shape a status-only check cannot see, which is this whole exercise)
 *
 * ⛔ The reason codes are FIXED STRINGS. Neither the URL, the status text nor
 * the response body reaches the caller: this endpoint is public.
 */
export async function probeJwks(supabaseUrl: string | undefined): Promise<ProbeOutcome> {
  if (supabaseUrl === undefined || supabaseUrl === '') return notConfigured();
  const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) return { status: 'degraded', reason: 'jwks_unavailable' };
  const doc = (await res.json()) as { keys?: unknown };
  if (!Array.isArray(doc.keys) || doc.keys.length === 0) {
    return { status: 'degraded', reason: 'jwks_empty' };
  }
  return { status: 'ok', reason: null };
}

/**
 * Race a probe against a deadline. A probe that has not answered inside `ms` is
 * `unknown` — we did not get a reading — rather than `ok` or `degraded`, because
 * a hang is evidence of neither health nor failure.
 *
 * The timer is cleared in a `finally` so a fast probe does not hold the isolate
 * open, and `Promise.race` has already attached a handler to `work`, so a
 * rejection arriving after the deadline is handled rather than unhandled.
 */
export async function timeBox(work: Promise<ProbeOutcome>, ms: number): Promise<ProbeOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ProbeOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'unknown', reason: 'probe_timeout' }), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * One dependency's reading, from the memo when it is young enough and from the
 * dependency itself otherwise.
 *
 * A THROW IS `degraded`, NOT AN EXCEPTION THAT ESCAPES. The probe looked and the
 * dependency refused; that is a definite negative and the most common shape of
 * one (an unreachable D1, a KV namespace that errors). The thrown value is
 * DISCARDED rather than reported — see [ProbeOutcome.reason] for why.
 *
 * `now` is passed in rather than read here so the whole verdict is computed
 * against ONE instant and a test can drive the clock without faking timers.
 */
export async function runProbe(
  cache: ProbeCache,
  spec: ProbeSpec,
  now: number,
): Promise<ProbeReading> {
  const held = cache.get(spec.name);
  if (held !== undefined) {
    const ageMs = now - held.at;
    // `ageMs >= 0` guards a clock that went backwards: a negative age is not a
    // young reading, it is an unusable one, so it re-probes rather than serving
    // a reading from the future.
    if (ageMs >= 0 && ageMs < spec.ttlMs) {
      return { name: spec.name, status: held.status, reason: held.reason, ageMs };
    }
  }
  let outcome: ProbeOutcome;
  try {
    // `spec.run()` is INSIDE the try: a probe that throws synchronously, before
    // it ever returns a promise, is caught here too.
    outcome = await timeBox(spec.run(), PROBE_TIMEOUT_MS);
  } catch {
    outcome = { status: 'degraded', reason: 'unreachable' };
  }
  cache.set(spec.name, { at: now, status: outcome.status, reason: outcome.reason });
  return { name: spec.name, status: outcome.status, reason: outcome.reason, ageMs: 0 };
}

/** The worst state present, most definite first: a `degraded` reading is a
 *  measured failure and outranks an `unknown`, which is only an absence of
 *  evidence. An EMPTY set is `unknown` — never `ok` — because a verdict over no
 *  dependencies is the "scan that reached nothing and printed ok" failure this
 *  repository finds more often than any other. */
export function worstOf(checks: ProbeReading[]): ProbeStatus {
  if (checks.length === 0) return 'unknown';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  if (checks.some((c) => c.status === 'unknown')) return 'unknown';
  return 'ok';
}

/**
 * Look at every dependency and return the verdict.
 *
 * 🔴 `ok` REQUIRES A NON-EMPTY SET AND UNANIMITY. `[].every(...)` is `true`, so
 * a spec list that was emptied by a bad refactor would report the healthiest
 * possible answer while looking at nothing at all — the literal `ok: true` this
 * module replaces, rebuilt by accident. The length check is what stops that.
 *
 * Probes run CONCURRENTLY: they are independent, and running them in series
 * would make the endpoint's latency the sum of every dependency's worst case
 * rather than the maximum.
 */
export async function inspect(
  cache: ProbeCache,
  specs: ProbeSpec[],
  now: number,
): Promise<HealthReport> {
  const checks = await Promise.all(specs.map((spec) => runProbe(cache, spec, now)));
  return {
    ok: checks.length > 0 && checks.every((c) => c.status === 'ok'),
    status: worstOf(checks),
    checks,
  };
}
