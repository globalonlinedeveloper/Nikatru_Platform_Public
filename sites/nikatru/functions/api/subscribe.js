// Cloudflare Pages Function: POST /api/subscribe
// Stores launch-notify signups in a Cloudflare KV namespace.
//
// SITE PROMISE: "We store your email address and the time you signed up, and nothing else."
//
// That marker is load-bearing, not decoration: check-site-integrity.mjs requires the
// quoted sentence to appear VERBATIM on a page of the same deploy root. Change what
// this file stores and the site copy has to move with it, or the build fails — the
// promise and the code cannot drift apart quietly.
//
// ── WHY THE RATE-LIMIT KEY IS AN HMAC AND NOT sha256(ip) ─────────────────────
// This endpoint used to key its per-IP counter on a bare `sha256(ip)`. An unsalted
// hash of an IP address is NOT pseudonymisation: the whole IPv4 space is 2^32
// values, so an attacker (or anyone who obtains a KV export) recovers the exact
// address by hashing all of them — minutes on a laptop, and the search space for a
// /24 is 256. On a page whose own privacy policy promises we do not retain network
// identifiers, a reversible one is a re-identification risk, not an abuse guard.
//
// The key is now HMAC-SHA-256 over the address under a secret the attacker does not
// have, so the exhaustive search is not available. See SETUP step 4.
//
// ── WHY THE COUNTER IS A KEY SET AND NOT AN INTEGER ──────────────────────────
// Workers KV has no compare-and-swap and no atomic increment. The previous
// read-parse-increment-write was a LOST-UPDATE race with an unbounded consequence:
// under sustained concurrency every in-flight request reads the same `h` and writes
// `h+1`, so the stored count can sit at `h+1` forever while thousands of requests
// pass — the limit never actually engages.
//
// Instead each attempt writes its OWN key under a per-fingerprint prefix and the
// count is the size of that prefix. Nothing is read-modify-written, so no attempt
// can erase another's, and every attempt is counted exactly once.
//
// ACCEPTED, BOUNDED RACE: requests already in flight when the threshold is crossed
// can still get through, so the effective ceiling is RATE_LIMIT + (concurrent
// in-flight requests for that one fingerprint) rather than exactly RATE_LIMIT.
// KV list is also eventually consistent (up to ~60s), which widens that window.
// The consequence is bounded and cheap: the overshoot is per-fingerprint, every
// key expires within the hour, and a repeated signup for an address already on the
// list writes nothing at all (see the dedup below). Removing the race entirely
// needs a Durable Object — a coordination primitive this site does not otherwise
// need, for a soft anti-spam counter.
//
// SETUP (one time, in the Cloudflare dashboard):
//   1. Workers & Pages -> KV -> Create namespace, e.g. "nikatru-signups".
//   2. Pages project "nikatru" -> Settings -> Functions ->
//      KV namespace bindings -> Add binding:
//         Variable name: SIGNUPS
//         KV namespace:  nikatru-signups
//      (Add it for Production, and Preview if you want.)
//   3. Redeploy (any push) so the binding takes effect.
//   4. 🔑 OWNER ACTION — Settings -> Environment variables and secrets -> Add,
//      as an ENCRYPTED secret (not a plaintext variable):
//         Variable name: SUBSCRIBE_RATE_LIMIT_SALT
//         Value:         32+ random bytes, e.g. `openssl rand -hex 32`
//      Add it for Production AND Preview. Rotating it simply resets the live
//      counters (every key expires within an hour anyway).
//      🔴 WITHOUT THIS SECRET THE PER-IP RATE LIMIT IS OFF — deliberately.
//      The alternative is storing a reversible fingerprint of a visitor's network
//      address, and a weaker anti-spam guard is a smaller harm than that. The
//      honeypot, the address validation and the per-address dedup all still apply.
//
// Read signups later: dashboard KV browser (keys prefixed "sub:"), or
//   `wrangler kv key list --binding SIGNUPS`.

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const isEmail = (e) =>
  typeof e === "string" &&
  e.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Keyed one-way fingerprint of `text` under `secret`.
 *
 *  HMAC-SHA-256, not a bare digest: the input (an IP address) is drawn from a
 *  space small enough to enumerate, so without a secret the "hash" is a lookup
 *  table away from the plaintext. Truncated to 128 bits because this value is
 *  only ever a KV key prefix — collision resistance at that width is far beyond
 *  what a per-hour abuse counter needs, and a shorter key is a smaller thing to
 *  leak. */
async function fingerprint(secret, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(text));
  return [...new Uint8Array(mac)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const RATE_LIMIT = 12; // max signups per fingerprint per hour
const RATE_WINDOW_SECONDS = 3600;

// ── SIGNUP RETENTION — THE WIRING IS BUILT, THE VALUE IS NOT ─────────────────
// 🔑 THE NUMBER ON THE `SIGNUP_RETENTION_DAYS` LINE IS THE OWNER'S POLICY CALL,
// NOT AN ENGINEERING ONE. tooling/ops/register.json →
// retention.kv.nikatru-signups.signup records why, and it is the reason this
// ships dormant rather than filled in: the published privacy policy says
// information is kept "only for as long as necessary", no number is derivable
// from anything in this tree, and an agent picking 180 or 365 would be WRITING
// POLICY under the appearance of fixing a bug — while silently deleting the
// owner's real launch list once the period passed.
//
// So the half that IS engineering is done here, and the half that is policy is
// left as one value. `null` means no expiry, which is exactly what ships today.
//
// TO ACTIVATE: change `null` on the next line to a positive number of days.
// That is the entire change — one value, in one place. Every signup written
// afterwards carries the TTL, and the register row's `rule` moves from
// `period-undeclared` to `ttl` (assert-retention-coverage.mjs then verifies the
// TTL by reading THIS file, so the claim stays checked against the code).
//
// ⚠️ IT APPLIES TO SUBSEQUENT WRITES ONLY. Workers KV fixes a key's expiry at
// write time, so keys already stored keep no expiry; ageing those out is an
// operator action against the namespace, not something this code path does.
const SIGNUP_RETENTION_DAYS = null;

const SECONDS_PER_DAY = 86400;

/** KV put options for a signup record, or `undefined` while no period is declared.
 *
 *  ⚠️ RETURNS `undefined` RATHER THAN `{ expirationTtl: undefined }`, and the
 *  call site spreads it away entirely, so the dormant path is the SAME TWO-ARG
 *  `put(key, value)` the site makes today. If the inert state were an options
 *  object with an undefined field, "leaving the period undeclared changes
 *  nothing" would be a claim resting on how KV treats that field rather than a
 *  property of this file — and the whole point of the seam is that switching it
 *  on is the only thing that changes behaviour. */
export function signupPutOptions(days = SIGNUP_RETENTION_DAYS) {
  return typeof days === "number" && Number.isFinite(days) && days > 0
    ? { expirationTtl: Math.round(days * SECONDS_PER_DAY) }
    : undefined;
}

export async function onRequestPost({ request, env }) {
  let email = "";
  let honeypot = "";

  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await request.json();
      email = (body.email || "").toString().trim();
      honeypot = (body.company || "").toString().trim();
    } else {
      const form = await request.formData();
      email = (form.get("email") || "").toString().trim();
      honeypot = (form.get("company") || "").toString().trim();
    }
  } catch (_) {
    return json({ ok: false, error: "Could not read your submission. Please try again." }, 400);
  }

  // Honeypot: a bot filled the hidden field. Pretend success, store nothing.
  if (honeypot) return json({ ok: true });

  if (!isEmail(email)) {
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  }

  // KV not bound yet -> fail gracefully (see SETUP above).
  if (!env || !env.SIGNUPS) {
    return json(
      { ok: false, error: "Signups aren't switched on yet. Please try again soon." },
      503
    );
  }

  // --- Abuse guard: soft per-fingerprint rate limit. -------------------------
  // The address is never stored, hashed or otherwise, without the secret; see the
  // header for why an unsalted digest of an IP is not pseudonymous, and why this
  // limb switches OFF rather than degrade to one.
  const ip = request.headers.get("cf-connecting-ip") || "";
  const salt = (env.SUBSCRIBE_RATE_LIMIT_SALT || "").toString();
  if (ip && salt) {
    try {
      const bucket = "rl:" + (await fingerprint(salt, ip)) + ":";
      // `limit` caps the read: we only ever need to know whether the count has
      // reached the ceiling, never how far past it a flood went.
      const seen = await env.SIGNUPS.list({ prefix: bucket, limit: RATE_LIMIT + 1 });
      if (seen.keys.length >= RATE_LIMIT) {
        return json({ ok: false, error: "Too many attempts. Please try again later." }, 429);
      }
      // One key per attempt: an independent write, so no attempt can overwrite
      // another's. Expires within the window, so nothing lingers.
      await env.SIGNUPS.put(bucket + crypto.randomUUID(), "1", {
        expirationTtl: RATE_WINDOW_SECONDS,
      });
    } catch (_) {
      // If the rate-limit check fails, don't block a real signup.
    }
  }

  // --- Store the signup: email + timestamp ONLY. ---
  const key = "sub:" + email.toLowerCase();
  try {
    const existing = await env.SIGNUPS.get(key);
    if (!existing) {
      const record = { email, ts: new Date().toISOString() };
      // The spread is what keeps the dormant seam inert: with no declared
      // period this is `put(key, value)` and nothing more. See
      // SIGNUP_RETENTION_DAYS above — one value turns it into a TTL'd write.
      const ttl = signupPutOptions();
      await env.SIGNUPS.put(key, JSON.stringify(record), ...(ttl ? [ttl] : []));
    }
    return json({ ok: true });
  } catch (_) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}

// GET (or a curious visitor) -> 405, so the endpoint never leaks a stack trace.
export async function onRequestGet() {
  return json({ ok: false, error: "Method not allowed. POST an { email } payload." }, 405);
}
