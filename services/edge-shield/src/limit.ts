// ─────────────────────────────────────────────────────────────────────────────
// ADMIT OR REFUSE ONE REQUEST OF A COUNTED CLASS — AND FAIL OPEN, ALWAYS.
//
// LEAD RULING SHIELD-R1 §3: the shield must never be the reason auth is down. So
// every path out of here that is not an explicit `{ success: false }` from the
// limiter ADMITS the request: an absent binding, a limiter that throws or
// rejects, an answer without a boolean. Each of those is LOGGED as one
// `shield_fail_open` line carrying this isolate's running count, so the count is
// a Workers Logs query (`event = shield_fail_open`) rather than a silence that
// reads exactly like a limiter that allowed everything.
//
// ONE LIMITER PER CLASS, keyed `global:<class>` (LEAD RULING SHIELD-R3): this
// Worker reads nothing that identifies the client — no address header, no
// `Origin` — so nothing it logs or answers can carry one. The per-IP limit on the
// credential paths is the zone's own rate-limiting rule, in front of this Worker
// (tooling/edge-ratelimit-rule.json).
//
// ⚠️ HONEST LIMIT, the one services/platform/src/lib/edge-ceiling.ts records:
// Workers Rate Limiting counts PER CLOUDFLARE LOCATION and is eventually
// consistent ("not designed to be used as an accurate accounting system"). A
// `global:<class>` key is global to one colo, so a spike spread over N colos
// reaches the box as up to N × the cap. It is a burst bound, not accounting.
// ─────────────────────────────────────────────────────────────────────────────
import { CLASSES, type ShieldClass } from './classify';
import type { Env, RateLimiterBinding } from './types';

export const SHIELD_HEADER = 'x-nikatru-shield';

/** Fail-open events seen by THIS isolate. Logged with every event, never reset. */
let failOpenCount = 0;
export function failOpenSeen(): number {
  return failOpenCount;
}

function failOpen(cls: ShieldClass, reason: string): void {
  failOpenCount++;
  console.error(JSON.stringify({ event: 'shield_fail_open', class: cls, reason, isolateCount: failOpenCount }));
}

/** `true` = admit. Never throws, never rejects. */
async function ask(binding: RateLimiterBinding | undefined, cls: ShieldClass): Promise<boolean> {
  if (!binding) {
    failOpen(cls, 'binding absent');
    return true;
  }
  try {
    const out = await binding.limit({ key: `global:${cls}` });
    if (out && out.success === false) return false;
    if (!out || out.success !== true) failOpen(cls, 'limiter answered without a boolean success');
    return true;
  } catch (err) {
    failOpen(cls, `limiter threw: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    return true;
  }
}

/**
 * The answer a refused request gets (429, or 503 for the refresh grant — see
 * CLASSES in src/classify.ts). Its shape is what the client behind that host
 * already understands from the origin itself:
 *   · auth: GoTrue's own versioned error shape — `code` AND `error_code`
 *     `over_request_rate_limit`, `x-supabase-api-version: 2024-01-01` and
 *     `x-sb-error-code`. gotrue-dart reads `code` when the version header is
 *     echoed and `error_code` otherwise, and the app maps that code to "Too many
 *     attempts" (packages/chassis_screens/lib/auth/auth_error_text.dart); an
 *     empty or plain-text body would read "Something went wrong";
 *   · intake: `X-Sentry-Rate-Limits: <seconds>::organization`, the Sentry
 *     protocol's all-categories back-off, beside an integer `Retry-After` >= 1
 *     (a `0` means 0 s to sentry-dart and 60 s to sentry-cocoa).
 * `Access-Control-Allow-Origin: *` so a browser client can READ the refusal —
 * without it the browser reports an opaque network failure, which clients retry
 * at once. `*`, never an echoed `Origin` (rv-c21 SHIELD-F2): a refusal carries no
 * secret, the auth and intake clients send no credentials, and the request's
 * `Origin` is not read at all (tooling/ci/assert-no-origin-authz.mjs). Every
 * PASSED-THROUGH answer keeps the origin's own CORS headers untouched
 * (tooling/ci/assert-cors-allowlist.mjs, the edge pass-through policy).
 */
/**
 * ⏱ 2026-10-02 · `mark` is the shield header's value (src/index.ts shieldMark):
 * the deployed RELEASE, so a refusal names its commit exactly as a pass-through
 * does. It was a literal `1` here, and the SHA-joined deploy and rollback smoke
 * (check-edge-shield.mjs --expect-release) read a refused probe during a crash
 * storm as an OLD shield in path (review of #1115, finding 1). Required, never
 * defaulted: a caller that forgets it does not compile.
 */
export function refusal(cls: ShieldClass, mark: string): Response {
  const { period, refusal: status } = CLASSES[cls];
  const headers = new Headers({
    'Retry-After': String(period),
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Retry-After, X-Sentry-Rate-Limits, x-sb-error-code, x-supabase-api-version',
    [SHIELD_HEADER]: mark,
  });
  let body: string;
  if (cls === 'intake') {
    headers.set('X-Sentry-Rate-Limits', `${period}::organization`);
    body = JSON.stringify({ detail: 'rate limited', retry_after: period });
  } else {
    const msg = 'Request rate limit reached';
    headers.set('x-sb-error-code', 'over_request_rate_limit');
    headers.set('x-supabase-api-version', '2024-01-01');
    body = JSON.stringify({ code: 'over_request_rate_limit', error_code: 'over_request_rate_limit', msg, message: msg });
  }
  return new Response(body, { status, headers });
}

/** `null` = admitted; a Response = the refusal to return. */
export async function admit(cls: ShieldClass, env: Env, mark: string): Promise<Response | null> {
  if (!(await ask(CLASSES[cls].global(env), cls))) return refusal(cls, mark);
  return null;
}
