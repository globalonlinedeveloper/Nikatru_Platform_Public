# Auth sessions — "log out of all devices", the session list, and refusing a revoked token at the Workers

**Status: DESIGN (AUTH-LOGOUT-ALL, 2026-09-24).** Items 3 and 4 of the brief are designed here and not
built. Items 1 and 2 shipped in the same change (see §0). Item 6 is a next step (§7).

The owner's rule, 2026-09-24: *"Sign in user we will kept login until they reset password or logout from
all devices."* Staying signed in and ending the other sessions on a password reset already worked. This
change adds the "all devices" control. This document designs the two pieces that make it complete: a
list of sessions with a revoke button on each, and Workers that stop accepting a revoked session's token
before that token expires.

---

## 0. What shipped beside this document

| Piece | Where |
|---|---|
| `signOut({SignOutScope scope = SignOutScope.local})` on the seam. The default is unchanged. | `packages/core/lib/src/auth/auth_repository.dart:166` |
| The adapter maps the scope to gotrue's own type, and **before a global revoke it makes sure it holds a live token** (see below) | `packages/auth_supabase/lib/src/supabase_auth_repository.dart:353` |
| `signOutAndForgetUser(ref, {scope})`, still the only place allowed to call `.signOut(` | `apps/subscriptiontracker/lib/state/providers/auth.dart:7` and the brick's `providers.dart` |
| "Log out of all devices" (Subly) and "Sign out of all devices" (the chassis `SettingsView`, so every stamped app) | the two `settings_screen.dart` files |

🔴 **gotrue does not refresh before a global sign-out, and it swallows the 401 it gets instead.**
gotrue 2.26.0 `_signOut` (`gotrue_client.dart:984-1008` in the pub cache) sends the access token held in
memory, and it ignores a 401, 403 or 404 from `POST /logout`. An app resumed after an hour in the
background still holds an expired token. Without the adapter's pre-check, that revoke would be refused,
the refusal swallowed, this device signed out, and every other device left signed in, while the control
reported success. `supabase_auth_repository_test.dart`'s `signOut scope` group holds this: remove the
pre-check and three named tests go red.

---

## 1. Where the session id comes from, at BASE

**The token carries it and nothing reads it.** GoTrue mints every access token with a `session_id` claim,
the id of the caller's row in `auth.sessions`. That claim is how its logout handler knows which single
session `scope=local` ends. gotrue-dart sends only the bearer and `?scope=` (`gotrue_admin_api.dart:63-79`),
so the server can take that session from nowhere else.
⚠️ Confirm this on a live token before step 1: decode the payload and print its claim **names**, never
the token.

Every Worker verifies ES256 locally, against a JWKS cached in KV, and then reads three things. None of
them is the session:

- `services/_shared/src/auth.ts:87-91` — `verifyOptions`: `issuer`, `audience: 'authenticated'`,
  `algorithms: ['ES256']`. `:52` `JWKS_KV_KEY = 'supabase_jwks'`, `:70` `JWKS_TTL_SECONDS = 600`.
- `services/platform/src/middleware/auth.ts:179` `jwtVerify(token, jwks(…), opts)`, with the KV fallback
  at `:190`. After that, `:196` requires a string `payload.sub`, `:199` sets `userId`, `:200-201` set
  `userEmail`, and `:202` sets `authRecency` from `amr`.
- `services/subscriptiontracker-api/src/middleware/auth.ts:241-249` and `:295-303`: the same three reads,
  `sub`, `email` and `authRecencyOf(payload)`.

Nothing anywhere reads `payload.session_id` or `payload.iat`. The `session_id` that does appear in
`services/` (`services/platform/src/routes/events.ts:269`, `services/platform/src/types.ts:725`) is the
analytics envelope's own field and is unrelated.

**No Worker can reach Postgres.** The bindings are D1, KV, R2, a service binding and rate limits. A grep for
`hyperdrive` over every `wrangler.jsonc` in `services/` and the brick exits 1 (no match). The Workers
`platform` and `subscriptiontracker-api` share the `JWKS_CACHE` namespace
(`services/platform/wrangler.jsonc:173`, `services/subscriptiontracker-api/wrangler.jsonc:83`).

---

## 2. The window being closed

A global sign-out, and a password reset, delete the other sessions' rows at once, so those devices can
never refresh again. An access token those devices already hold is a stateless JWT. It keeps passing
`jwtVerify` until its `exp`. The lifetime is `supabaseAuth.jwt_exp` in `tooling/mail-transport.json`,
recorded there by this change. **The worst case is one full `jwt_exp`**, and the average is about half of
that, because a token is refreshed shortly before it expires. Every figure below that mentions the gap
reads it from that register, not from this page.

---

## 3. Two ways to refuse a revoked session

### (a) A KV revoke record

One KV key per **user**, not per session, so a request costs one read however many sessions the user
has revoked:

```
key    rev:<sub>
value  { "before": <epoch seconds> | null, "sids": [["<session uuid>", <revokedAt>], …] }
ttl    jwt_exp + CLOCK_SKEW_SECONDS   (KV's own floor for expirationTtl is 60 s)
```

The decision is **refuse** when `payload.session_id` is in `sids`, or when `before` is set and
`payload.iat < before`. `before` serves "all devices": every token minted before the moment of the
revoke is refused, and so is any session created between listing the sessions and revoking them. `sids`
serves a single session and "every session except mine" (the password reset), where a time cut-off
would also refuse the caller's own token. Entries older than `jwt_exp` are pruned on each write, because
none of the tokens they refused can still be alive.

- **Added cost per request: one KV `get`.** Note what already happens: `platformAuth` calls
  `void warmCache(c.env)` (`services/platform/src/middleware/auth.ts:175`), which does a
  `JWKS_CACHE.get` (`:147`) on **every** authenticated request. `subscriptiontracker-api`'s
  `warmJwksCache` (`:89-91`, called at `:205` and `:285`) does the same. So this is a second read per request, not the first. Against
  `kv.readsPerDay` in `tooling/ceilings.json` (Free: 100,000 per account per day), two reads per request
  caps authenticated requests at roughly half that before KV reads run out, shared with `CONFIG_KV`.
  That is the real price of this option. Measure it with the dashboard reading `ceilings.json` already
  names, and do it before shipping, not after.
- **Gap to revocation: at most KV's propagation delay**, instead of up to a whole `jwt_exp`. Cloudflare
  documents that a write is visible at once in the location that made it and "may take up to 60 seconds
  or more" elsewhere (https://developers.cloudflare.com/kv/concepts/how-kv-works/).
- **Writes:** one per revoke action, against `kv.writesPerDay` (Free: 1,000/day, account-wide, and "the
  TIGHT one" per `ceilings.json`). Each revoke route goes behind the platform Worker's existing
  `ratelimits` binding, so no single user can spend that budget.
- **Failure mode:** if the KV read throws, **admit the token and log it.** The worst case is then exactly
  today's behaviour, a revoked token living until `exp`. Failing closed would turn a KV incident into a
  401 for every user of every app, and a 401 is what the client's REST layer reads as a dead session.
  `platformAuth`'s own header records why a portfolio-wide 401 is the outage to avoid.
- **Secrets:** none. The decision reads a public KV document by the token's own `sub`. The auth
  middleware keeps the property `tooling/ci/assert-erasure-reach.mjs` limb 3 walks: nothing reachable
  from it can read a secret.

### (b) A lookup in `auth.sessions`

The token is admitted only while `SELECT 1 FROM auth.sessions WHERE id = payload.session_id` returns a
row.

- **Added cost per request: one Postgres round trip** from the edge to the identity project's region. It
  can go through Hyperdrive (which caches, but this answer must never be cached, because a cached "row
  exists" is the very gap being closed) or through a PostgREST RPC over HTTPS. Either way, the latency
  is set by the distance from the colo to the database, on every authenticated request of every app.
- **Gap to revocation: none.** The row is gone the moment GoTrue deletes it.
- **What else it costs, and this is what decides it:**
  1. **A database credential enters the auth middleware's scope** on every Worker. That undoes the
     property named above: `platformAuth` is designed so that nothing it can reach holds a secret
     (see that file's header, "WHY THERE IS NO HS256 FALLBACK").
  2. **The auth boundary starts depending on Postgres being up.** A database blip becomes a
     portfolio-wide 401, which is the failure the KV JWKS fallback was built to remove. Failing open
     instead only brings back the gap from §2 during the outage, at a far higher cost the rest of the
     time.
  3. **There is no binding to use.** A Hyperdrive configuration would need a row in
     `tooling/ops/hyperdrive.json` and a cap inside its `origin.budget`
     (`tooling/ci/assert-hyperdrive-cap.mjs`). That register describes Box A's Postgres, while
     production identity is still the **hosted** project (see the `captchaToken` note in
     `auth_repository.dart`). So its origin would be a second one with no budget recorded anywhere.

### Side by side

| | (a) KV revoke record | (b) `auth.sessions` lookup |
|---|---|---|
| Added work per authenticated request | 1 KV read (on top of `warmCache`'s 1) | 1 Postgres round trip |
| Gap to revocation | ≤ KV propagation delay (Cloudflare documents up to ~60 s) | 0 |
| Gap today, for comparison | up to `jwt_exp` | up to `jwt_exp` |
| Binding needed | one KV namespace, on all three Worker configs | Hyperdrive or a service key, on all three |
| Secret in the auth middleware | no | yes |
| When the store is down | admit and log, which is today's gap | 401 for everyone, or today's gap |
| Budget it spends | `kv.readsPerDay`, `kv.writesPerDay` | origin connections, plus latency on every request |

### Recommendation: (a)

It closes the gap from up to one `jwt_exp` down to KV's propagation delay. It adds no secret and no
new dependency to the auth boundary, and its worst failure is today's behaviour. What it costs is a
second KV read on every authenticated request, which halves the headroom under `kv.readsPerDay`.
Measure that before shipping, and if it binds, the answer is the Workers Paid plan, where KV reads are
not capped (`ceilings.json` records `paidValue: null` for that row), not option (b).

---

## 4. The endpoints: listing and revoking sessions

This is ADR 059 lock 7 and S-9, built once. All of it lives on the **platform Worker**, behind
`platformAuth`, so the caller is the signed-in user and **the only sessions anyone can see or revoke are
their own**. There is no admin surface. The service-role key never leaves the Worker, and it is read in
the route module, never in the middleware (limb 3 again). `routes/account.ts:218` already reads it the
same way.

Reading `auth.sessions` goes through two SQL functions in the identity project. PostgREST does not expose
the `auth` schema, and there is no Hyperdrive (§3b):

```
public.nikatru_sessions_of(p_user uuid)
  → id, created_at, refreshed_at, user_agent, aal, not_after   -- no IP: nothing on screen needs it
public.nikatru_revoke_session(p_user uuid, p_session uuid)
  → DELETE FROM auth.sessions WHERE id = p_session AND user_id = p_user RETURNING id
    (auth.refresh_tokens rows go with it: in GoTrue's schema their session_id references
     auth.sessions ON DELETE CASCADE, which step 4's probe confirms rather than assumes)
both: SECURITY DEFINER, SET search_path = '', REVOKE ALL FROM PUBLIC, anon, authenticated,
      GRANT EXECUTE TO service_role
```

| Route | Does | Answers |
|---|---|---|
| `GET /v1/sessions` | `nikatru_sessions_of(sub)`, marks the row whose id is the caller's `session_id` as `current` | `200 {"sessions":[{"id","current","createdAt","lastActiveAt","device"}]}`, where `device` is a label parsed from the user agent |
| `DELETE /v1/sessions/:id` | `nikatru_revoke_session(sub, id)`, then appends `id` to `rev:<sub>.sids` | `204`. `404` when the id is not the caller's (never says whose it is). `409` when it is the caller's own, because that is a sign-out and the app has a control for it |
| `POST /v1/sessions/revoke-all` | sets `rev:<sub>.before = now`. The app then calls `signOut(scope: global)` as it does today | `204` |
| `POST /v1/sessions/revoke-others` | appends every session id except the caller's to `sids`. Called by the app right after `updatePassword` succeeds, because GoTrue has already ended those sessions' refresh tokens | `204` |

The client reaches these the way deletion does. `SupabaseAuthRepository` gains an injected
`requestSessionRevocation` beside `requestServerDeletion`, wired by each app to its platform REST
client, and it is awaited **before** the gotrue call. If it cannot be reached, the global sign-out
refuses before touching anything, exactly as the Part A pre-check does today.

---

## 5. What "all devices" means on the web

- **A session on the web is one browser profile's storage for one origin.** `SecureSessionStorage` is
  backed by ordinary web storage there (its own header says so: there is no keychain a page can reach).
  A private window, a second profile and a second browser are each a separate row in `auth.sessions`,
  and a global sign-out ends every one of them.
- **Tabs of the same profile are "this device".** gotrue broadcasts its auth events to the origin's
  other tabs over a `BroadcastChannel` named from the identity project's host
  (`gotrue_client.dart:1378-1386`). ⚠️ Since [ADR 075], every app is served under `https://nikatru.com/<app>`,
  so every app's tabs share one origin **and** that channel name. Whether app B acts on a sign-out app A
  broadcasts is not established here. Measure it before promising anything about other apps' open
  tabs.
- **A closed tab holds nothing.** The next time it opens, it loads the stored session, fails to
  refresh, and is signed out. An open tab on another profile or machine keeps working **against the
  Workers** until its access token expires, the same as on every other target. That is the gap §3 closes.
- **Every portfolio app shares one identity project**, so "all devices" also means every app. The chassis
  copy says so without naming a count: "Ends every session of this account, on every device, including
  this one."

---

## 6. Steps, each with its test and red control

A **red control** is a mutation of the real tree that must turn the named test red, followed by the
revert. A test that cannot be turned red this way does not count.

1. **The decision, in one place.** `revocationRefusal(payload, record)` goes in
   `services/_shared/src/auth.ts`: pure, no bare import, like `deletionRecencyRefusal`.
   *Test* (`services/_shared/test`): a token whose sid is listed is refused; `iat < before` is refused;
   `iat ≥ before` is admitted; no record is admitted; an unreadable record is admitted.
   *Red:* make it return `null` → the listed-sid case goes red.
2. **Every carrier reads it.** `platformAuth`, `subscriptiontracker-api`'s `supabaseAuth` and
   `erasureAuth`, and the brick's Worker template read `rev:<sub>` after `jwtVerify` and before
   `c.set('userId')`, from a new `SESSION_REVOKED` namespace. It is not `JWKS_CACHE`: a cache may be
   flushed, a revoke list may not.
   *Test:* each carrier's `auth.test.ts` with a fake KV: a revoked sid → 401; KV throws → admitted, and
   the log line is asserted.
   *Red:* delete the check line → the 401 case goes red. *Guard:* a limb in
   `assert-erasure-reach.mjs` (or a sibling) fails when a carrier's middleware does not import
   `revocationRefusal`, so a fourth Worker cannot forget it.
   *Budget:* the new read site is recorded against `kv.readsPerDay` in `tooling/ceilings.json`.
3. **The TTL is the register's.** A constant `REVOCATION_TTL_SECONDS` must equal
   `mail-transport.json` `jwt_exp` plus `CLOCK_SKEW_SECONDS`, enforced by a node guard, because a
   Worker cannot read `tooling/` at runtime.
   *Red:* change `jwt_exp` in the register → the guard exits 1.
4. **The SQL.** The two functions of §4, as a migration for the identity project.
   *Test:* a live probe in `tooling/ops/`, in the shape of `verify-password-reset-revokes.mjs` (throwaway
   user, cleanup in `finally`, a control leg). A user token calling the RPC directly is **refused**, and
   the service key listing another user's sessions returns only that user's.
   *Red:* `GRANT EXECUTE … TO authenticated` → the refusal leg exits 1.
5. **The routes.** The four routes of §4, with a fake RPC and a fake KV.
   *Test:* user A cannot list or revoke user B's session (404); revoking one's own current session is
   409; `revoke-all` writes `before`; each route is rate-limited.
   *Red:* drop `AND user_id = p_user` from the fake's contract → the cross-user case goes red.
6. **The client.** `requestSessionRevocation` is injected and awaited before the gotrue call. The
   sessions list is a chassis view plus an adapter, like `SettingsView`.
   *Test:* extend the Part A tests. With the revocation call failing, a global sign-out refuses and signs
   nothing out. Tapping revoke on a row calls `DELETE /v1/sessions/:id` with that id.
   *Red:* skip the injected call → the refusal case goes red.

---

## 7. Next step, not built here: item 6

The brief asks for `tooling/ops/verify-password-reset-revokes.mjs` to be wired into a scheduled workflow.
**This is not small**, and the tree says why in three places:

- The script's own header says it creates a real user on the live project and is "a LAPTOP AND RUNBOOK
  STEP … wired into no workflow: a probe that provisions an account is not something to run on a
  schedule."
- `tooling/ci/test/ops-bounded-retry.test.mjs` (B11) asserts that it is **not** converted to
  `bounded-retry.mjs`. Its POSTs (a sign-up and a reset) are non-idempotent, so retrying blind can create
  a second account. That test also exempts it from the per-request ceiling ("NO_CEILING_YET"), on the
  grounds that no workflow runs it.
- A schedule needs the service-role key in a workflow's environment, scoped the way `e2e.yml`'s
  provisioning steps scope theirs (per step, never job-wide).

So the work is: decide per call which requests are safe to retry (`isSafeMethod`); give every fetch the
signal; turn both B11 assertions into the converted state; add a step to `e2e.yml`'s nightly, which
already owns a throwaway-user lifecycle, with its secrets bound per step; and, once §6 step 2 ships,
extend the probe with an access-token leg: the pre-reset access token must get a 401 from a
`platformAuth` route within the KV propagation window. That leg is the scheduled proof that §3 works.

---

## 8. Open questions for the owner

1. Should the session list show an approximate location? §4 leaves the IP out on purpose, for privacy.
2. When `kv.readsPerDay` becomes the binding limit, is the answer Workers Paid (recommended in §3), or a
   per-isolate memo of "no record for this user" that trades up to its lifetime of extra gap?
3. After a password reset, should the other devices be refused at the Workers immediately
   (`revoke-others`, §4), or only when they next refresh (today)?
