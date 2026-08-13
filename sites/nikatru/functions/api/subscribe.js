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

// ── SIGNUP RETENTION — ~~365 DAYS (OWNER, 2026-08-09)~~ → 400 DAYS ───────────
//
// 🔴 CORRECTED IN PLACE 2026-08-13, AND THE CORRECTION IS NOT A PREFERENCE — IT
// IS A LEAP YEAR. Read this before touching the number, and do NOT "optimise" it
// back to 365: 365 is the number that is wrong, and it is wrong by one day.
//
//   DPDP Rules 2025 **Rule 8(3)** requires personal data to be retained "for a
//   minimum period of one year from the date of such processing"; Rule 6(1)(e)
//   adds a second one-year floor for security logs. Rule 8(3) is UNQUALIFIED as
//   to class — unlike Rule 8(1), which is limited to Third-Schedule fiduciaries
//   — so it reaches this store. "One year" is an ANNIVERSARY, not 365 sleeps.
//   A key written on date D and expired by a 365-day TTL dies at D+365 days,
//   but its one-year anniversary is D+366 days whenever the interval [D, D+1yr)
//   contains a 29 February. Concretely: **every signup written between
//   1 Mar 2027 and 29 Feb 2028 would be deleted ONE DAY SHORT of the floor** —
//   and all of those are written AFTER the 13 May 2027 phase-in, so all of them
//   are inside the period when the floor actually bites. A TTL is fixed at write
//   time and cannot be lengthened afterwards, so the day this is noticed is
//   already the day the affected keys are unrecoverable.
//
//   400 = 365 + 35 days of margin, DELIBERATELY THE SAME SHAPE as the `events`
//   period in [ADR 045] §2: clear the floor, never sit on it. It clears 366 by
//   34 days, which absorbs a late sweep, a clock-skewed comparison and the leap
//   day at once.
//
// ⚠️ THE 400 IS AGENT-RAISED AND OWNER-REVIEWABLE. THE 365 WAS THE OWNER'S.
// The paragraph below is preserved verbatim because it is still the reason this
// line is safe to trust — and it argues that an agent picking a number here is
// writing policy. That argument is not retired by this edit; it is why this edit
// is FLAGGED rather than quiet. What changed is the KIND of number: 365 was a
// free policy choice among defensible values, and it has since acquired a legal
// FLOOR that it fails by one day. Raising it to clear a floor is a different act
// from choosing it. 👤 **OWNER: the direction of this change costs privacy.**
// This is the only store in the repository holding a plain email address, its
// erasure route is `no-route` (operator-only, tooling/legal/data-inventory.json
// → `kv:nikatru-signups`), so 35 extra days is 35 more days of un-erasable
// contactable identity. Any number ≥ 366 satisfies the floor; 400 is the one
// chosen for margin, and moving it costs one value here plus the register's
// `ttlSource`.
//
// 🔑 THE NUMBER ON THE `SIGNUP_RETENTION_DAYS` LINE IS THE OWNER'S POLICY CALL,
// NOT AN ENGINEERING ONE — and it has now been made. Why it shipped as `null`
// until 2026-08-09 stays written down, because it is the reason this line is
// safe to trust: the published privacy policy says information is kept "only
// for as long as necessary", no number is derivable from anything in this tree,
// and an agent picking 180 or 365 would have been WRITING POLICY under the
// appearance of fixing a bug — while silently deleting the owner's real launch
// list once the period passed. So the engineering half was built dormant and
// the policy half was left as ONE VALUE. This is that value, and the decision
// behind it is recorded in company/decisions/decisions-log.md (2026-08-09).
//
// WHAT HOLDS THIS NUMBER TO THE REST OF THE SYSTEM — change it and all of these
// move with it, or the build goes red rather than the claim going stale:
//   · tooling/ops/register.json → retention.kv.nikatru-signups.signup carries
//     `rule: "ttl"` and a `mechanism.ttlSource` that must appear VERBATIM in
//     this file, so the register's declared period is READ OFF THIS LINE rather
//     than asserted beside it (tooling/ci/assert-retention-coverage.mjs).
//   · tooling/ci/test/signup-retention.test.mjs loads THIS module and asserts
//     the put really carries `expirationTtl: days × 86400`, and that the
//     register row and this constant agree that a period exists.
//   · tooling/legal/data-inventory.json → `kv:nikatru-signups` declares
//     retention `ttl` and names this file as the code that sets the expiry.
//
// ⚠️ IT APPLIES TO SUBSEQUENT WRITES ONLY, AND THAT IS NOT A DETAIL. Workers KV
// fixes a key's expiry at WRITE time, so every signup stored BEFORE this line
// changed still carries no expiry and will never acquire one by itself. Ageing
// those out is an operator action against the namespace (re-put or delete by
// key), not something this code path does — and until it happens the store
// still holds contactable addresses with no bound, which is exactly the fact
// docs/runbooks/breach-response.md's notifiable-population step turns on.
//
// 📌 THE SAME SENTENCE NOW CUTS A SECOND WAY, ADDED 2026-08-13. Keys written
// between 2026-08-09 and this edit carry a 365-day TTL that CANNOT BE EXTENDED
// in place — the 400 reaches subsequent writes only. Those keys expire between
// ~2027-08-09 and ~2027-08-13; each spans a non-leap window (Feb 2027 has 28
// days), so 365 days IS one year for exactly that cohort and none of them is
// short. The defect this edit prevents opens for writes from 1 Mar 2027 only.
// No re-put is therefore required to fix a breach of the floor; a re-put would
// be an operator choice about uniformity, not a repair.
const SIGNUP_RETENTION_DAYS = 400;

const SECONDS_PER_DAY = 86400;

/** KV put options for a signup record, or `undefined` if no period is declared.
 *
 *  ⚠️ RETURNS `undefined` RATHER THAN `{ expirationTtl: undefined }`, and the
 *  call site spreads it away entirely, so a period of `null` is a plain two-arg
 *  `put(key, value)` — byte for byte the call this site made before a period
 *  existed. That branch is dormant now that 365 days are declared, and it is
 *  kept (and tested) because it is what makes REVERTING the period a one-value
 *  change too: if the inert state were an options object with an undefined
 *  field, "no declared period changes nothing" would be a claim resting on how
 *  KV treats that field rather than a property of this file.
 *
 *  🔴 `0`, negatives and non-numbers fall to `undefined` DELIBERATELY. KV reads
 *  a tiny or absent TTL as "expire almost immediately", so a fat-fingered `0`
 *  must mean NO EXPIRY — never "delete the launch list now". */
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
      // With the declared period this is a three-argument put carrying
      // `expirationTtl`; with none it collapses back to `put(key, value)` and
      // nothing more. See SIGNUP_RETENTION_DAYS above — the period is the only
      // thing that decides which, and both shapes are held by
      // tooling/ci/test/signup-retention.test.mjs.
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
