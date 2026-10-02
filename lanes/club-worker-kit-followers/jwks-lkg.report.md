BASE: `ad238205df7297d45f862734fca46bfd426b7fb5`
HEAD: `3ccb74618c27060b62f7bfaee02eea3415c355c8` (local sandbox commits only, nothing pushed)

Patches 1 and 3 are written and tested. Patch 2 (the outage contract) is drafted below, outside the patch. Patch 4 (the restore drill) was not run: this sandbox has no box access.

## Tests, guards and red controls

| Check | Command | Exit | Expected | Verdict |
|---|---|---|---|---|
| LKG tests (platform + kit) | `cd services/platform && npx vitest run test/auth.test.ts ../_shared/test/auth-core.test.ts` | 0 (111 passed) | green | ✅ |
| Red control A: LKG read removed from `verifyAsymmetric` | same, platform `test/auth.test.ts` | 1 (3 failed: RED case, tunnel case, rotation case) | red | ✅ red, reverted |
| Red control B: LKG write removed from `warmJwksCache` | same | 1 (2 failed: write case, rotation case) | red | ✅ red, reverted |
| Red control C: LKG read removed | `cd services/subscriptiontracker-api && npx vitest run test/auth.test.ts` | 1 (3 failed: RED, HS256-path, erasure) | red | ✅ red, reverted |
| platform suite | `cd services/platform && npx vitest run` | 1 (1700 passed, 1 failed) | green | ⚠️ only `backup-export.test.ts › a 100-column table round-trips…` fails, and it also fails on BASE (re-run with my changes stashed: exit 1) |
| platform types | `cd services/platform && npx tsc --noEmit` | 0 | green | ✅ |
| subscriptiontracker-api suite | `cd services/subscriptiontracker-api && npx vitest run` | 0 (724 passed) | green | ✅ |
| subscriptiontracker-api types | `npx tsc --noEmit` | 0 | green | ✅ |
| Drift green control | `node tooling/ops/check-box-config-drift.mjs --register tooling/ops/fixtures/box-config-drift/register.json --manifest …/manifest-clean.json --now 2026-10-01T12:00:00Z` | 0 | 0 | ✅ |
| **Drift red control** (one changed hash) | same with `…/manifest-one-changed.json` | **1** | 1 | ✅ |
| Shipped register (no vendored hashes yet) | `node tooling/ops/check-box-config-drift.mjs --manifest …/manifest-clean.json --now …` | 2 | 2 (COVERAGE LOST) | ✅ by design |
| Drift reader + box script tests | `node --test tooling/ci/test/box-config-drift.test.mjs` | 0 (16 passed) | green | ✅ |
| Affected guards (final run, tree untouched) | `node tooling/scripts/affected-guards.mjs --base ad238205… --budget-s 400` | 0 | 0 | ✅ 221 green, 0 findings, 37 over budget (next row). 13 red here are red on BASE with the same exit: worker:platform, assert-alert-disposition, assert-e2e-proof-fresh ×2, assert-ops-register, provision-backend, assert-app-dod#2, assert-codeql-pr-no-new-high, assert-platform-proof-fresh, assert-clone-contract ×2, lane-verdict, new-product |
| The 37 over-budget tests | `node --test tooling/ci/test/<each>.test.mjs` | all 0 | green | ✅ |
| Guards re-run after their fixes | `assert-prod-provenance`, `assert-enforcement-index`, `assert-vendor-portability`, `assert-platform-register`, `assert-analytics-contract`, `assert-no-dead-files` | all 0 | green | ✅ |
| Tests re-run after their pins moved | `analytics-contract`, `ops-register`, `prod-provenance`, `prod-provenance-databases`, `retention-coverage`, `platform-register` | all 0 | green | ✅ |
| Regenerated artefacts | `node tooling/ci/build-enforcement-index.mjs --write`, `node tooling/ops/guard-yield.mjs --sync` | 0, 0 | — | ✅ diffs committed. `coverage-manifest.json` gained `box-config-drift.test.mjs: 16` |
| `assert-public-citations` | `node tooling/scripts/assert-public-citations.mjs` | 2 | — | ⬜ needs the Private corpus, which is not here |
| Spec guards | `spec-guards.mjs --fast` | NOT RUN | — | Private corpus not here |

## Deviations, unmatched seams, and what I could not do

**Patch 1, the last-known-good key set**
- **Where the code went.** On BASE the brief's seams (`services/_shared/src/auth.ts:70` and `services/platform/src/middleware/auth.ts:146-157,241-244`) have moved into the worker kit. So the change is in the kit:
  - `services/_shared/src/auth.ts` gains `JWKS_LKG_KV_KEY = 'supabase_jwks_lkg'` and `lastKnownGoodNeedsWrite`.
  - `services/_shared/src/auth-middleware.ts` (a file the worker-kit patch introduced) gets the write in `warmJwksCache` and the fallback in `localSetFromCache`/`verifyAsymmetric`.
  - Neither Worker's `middleware/auth.ts` changed.
- **"Written on every successful fetch".** The warm path compares first and puts the LKG only when the fetched set differs from the stored one. The LKG still always equals the last fetched set, but a steady key set costs no KV write. The cost is one extra KV read per fetch.
  - "Read ONLY on the outage path" holds for verification. The warm path does read the LKG key to decide whether to write.
- **Read order.** On a key-set-unavailable error the 10-minute copy is tried first; the LKG only when that copy is unusable. A usable 10-minute copy is never retried against the LKG, so a rotated-out kid stays a 401 (tested).
- **Rotation.** Only the kit's warm fetch writes KV (jose's own fetches never did), and it runs only when the 10-minute copy is absent. So a rotation reaches the LKG within about 10 minutes of traffic, the same latency the short copy already had.
- **Empty and malformed sets.** A fetched empty `{"keys":[]}` replaces the LKG, so a misconfigured server fails closed. A 200 body that isn't a key-set document leaves the LKG alone.
- **`erasureAuth` is also covered.** It uses the same `verifyAsymmetric` (tested on subscriptiontracker-api).
- **After deploy** the LKG key stays empty until the first warm fetch, within 10 minutes.
- **Follow-up, not done:** `tooling/ops/auth-cutover-preflight.mjs` check C10 reads only `supabase_jwks`, not `supabase_jwks_lkg`. A future cutover that keeps the same issuer URL would leave old kids in the LKG, used only during an outage and bounded by token `exp`.

**Patch 2, the outage contract.** The target path `research/session-2026-09-23/lead-1m/reviews/` isn't in the Public tree, so the contract is not in the patch. Its text is at the end of this report.

**Patch 3, the drift reader**
- **What landed:**
  - Route `POST /v1/ops/box-manifest`: a separate secret per box, compared via SHA-256 digests with `timingSafeEqual`; 503 when that box's secret is unset; no CORS on `/v1/ops/`.
  - Migration `0024_box_config_manifest.sql`.
  - Box cron script `tooling/ops/boxes/post-config-manifest.sh` (file mode 644 per repo convention; its install line uses `install -m 0755`).
  - Reader `tooling/ops/check-box-config-drift.mjs`, wired into ops-watch's daily `heartbeats` job.
  - Rows in every register the guards demanded: `prod-provenance`, `capability-register` (non-vendor surfaces), `platform-register` (with a `noLimiterReason`), `legal/data-inventory`, the `ops/register` retention row, the analytics-contract gap pin, plus the pinned counts in four tests.
- **Vendored hashes are unknown.** The vendored copies are in Private. `tooling/ops/box-config-vendored.json` ships with `vendored: null` and `sha256: null` for compose/override/tunnel on both boxes. Drop any file a box doesn't have; the Box B logical names are a guess.
- **ops-watch `heartbeats` will be red until the box work is done.** It exits 2 until the writer fills the `vendored` paths and runs `node tooling/ops/check-box-config-drift.mjs --refresh-vendored <Private dir>`. It then exits 1 (NO ROW) until each box's cron has posted.
- **Not done (no remote or box access):**
  - `wrangler secret put BOX_MANIFEST_SECRET_BOXB` and `…_BOXC`, plus the matching root-only secret file on each box.
  - Applying D1 migration 0024.
  - Installing the crons on Box C and Box B and reading back the first post.

**Patch 4, the drill: NOT RUN**
- **`register.json` cadence deliberately not edited.** Switching `recovery.glitchtip-postgres` to `"30d"` now makes `assert-ops-register` fail on BASE data: `lastDrill` 2026-08-05 is 57 days old, and that check is a blocking `bad()` that gates ci-gate. After the drill, set on both rows (`recovery.supabase-auth-postgres`, `recovery.glitchtip-postgres`; now about lines 3532/3556, the brief's 3379-3380 is stale):
  - `"cadence": "30d"`
  - `lastDrill` = the drill date
  - counts in `drillEvidence`, which must carry a durable id such as an `HH:MM:SS` time
- Box C's 2026-09-03 drill expires under a 30-day cadence on 2026-10-03.

**Other**
- **Citations re-measured after the last edit:**
  - `docs/design/auth-sessions.md`: `auth.ts:124-128` and `:125`; `auth-middleware.ts:184/:200/:340-355/:396-411/:120/:234/:390`; `types.ts:996`.
  - `services/subscriptiontracker-api/wrangler.jsonc`: `auth-middleware.ts:119`.
  - `tooling/platform-register.json`: `index.ts:151-197`.
  - `tooling/ci/test/e2e-auth-target.test.mjs`: `auth.ts:125`.
- Three citations were already stale on BASE and I left them: `index.ts:114` and `:287` (history in `platform-register.test.mjs` and `worker-routes.mjs`), and `ops-watch.yml:235` in `monitor-register.json`.
- The brief has no Dart parts, so I didn't fetch Flutter.
- My first `affected-guards` run overlapped my own edits; I discarded it and the final run is the one in the table.
- Rows `O-BOXC-RESTORE-REDRILL` and `O-JWKS-FALLBACK-LIVES-TEN-MINUTES`: Private, not edited.
- **Kit symbols this patch depends on** (check they survive worker-kit review):
  - `auth.ts`: `JWKS_KV_KEY`, `JWKS_TTL_SECONDS`, `usableJwksDocument`, `isKeySetUnavailable`, `verifyOptions`, `bearer`
  - `auth-middleware.ts`: `warmJwksCache`, `localSetFromCache`, `verifyAsymmetric`, `verifySupabaseToken`, `supabaseAuthWith`, `erasureAuth`
  - `validate.ts`: `isPlainObject`
  - `body.ts`: `readBoundedBody` (through `platform/src/lib/body`)
  - `d1.ts`: `run`, `nowIso` (through `platform/src/lib/d1`)
- **Files touched that another train shares:** `services/_shared/src/auth-middleware.ts`, `services/_shared/src/auth.ts`, `services/_shared/test/auth-core.test.ts`.

**Patch 2 text** (for `runbooks/boxes/boxc.md`, cited from ADR no.062; name it in the PR body):

> # Box C down: what users see
>
> Box C runs GoTrue and its Postgres, the one identity stack for the whole portfolio. The Workers check access tokens offline, against the public key set (JWKS). They never call GoTrue to check a session.
>
> - **Sign-in, sign-up, password reset, email confirmation:** stop at once. Each one is a call to GoTrue.
> - **Signed-in API calls (platform and the app Workers):** keep working while the user's access token lives. That is at most `jwt_exp` (3600 s, in `tooling/mail-transport.json`) after the token was issued, and about half that on average. Each Worker checks the token against the live key set, then the 10-minute KV copy, then the last-known-good copy `supabase_jwks_lkg`. The last copy has no expiry and is read only when the key set can't be fetched and the 10-minute copy is gone.
> - **Session refresh:** fails. Each user is signed out when their access token expires.
> - **Account deletion:** `erasureAuth` admits the request through the same path while the token lives and the recent-sign-in rule passes. The identity row can't be deleted while GoTrue is down, so the route's existing handling of a failed identity delete applies.
> - **Session revocation (`SESSION_REVOKED`):** keeps working. It is a KV read and doesn't depend on Box C.
>
> **In one line:** new sign-ins stop at once; signed-in calls continue while their access token lives, at most one `jwt_exp`; refresh fails.
>
> **What did not get wider:**
> - The last-known-good copy is checked with the same rules: ES256 only, issuer, audience, expiry.
> - A token whose key id is in neither copy is refused. So is a token signed by a foreign key.
> - A usable 10-minute copy wins over the last-known-good one.
> - The next successful fetch replaces the last-known-good copy after a key rotation.
> - On the app Workers it also keeps a long outage off the legacy HS256 shared-secret path.
>
> **What operators see:**
> - Monitors 11 and 2 (the `supabase_jwks` health check) go degraded as soon as the live fetch fails.
> - About one `jwt_exp` after the outage starts, authenticated traffic falls to near zero.
> - The first successful fetch afterwards refreshes both copies.

## `git diff --stat ad238205df7297d45f862734fca46bfd426b7fb5`

```
 .github/workflows/ops-watch.yml                    |  24 ++
 docs/design/auth-sessions.md                       |  14 +-
 services/_shared/src/auth-middleware.ts            |  35 ++-
 services/_shared/src/auth.ts                       |  55 +++++
 services/_shared/test/auth-core.test.ts            |  44 ++++
 services/platform/.dev.vars.example                |   8 +
 services/platform/README.md                        |   1 +
 .../migrations/0024_box_config_manifest.sql        |  29 +++
 services/platform/src/index.ts                     |   6 +
 services/platform/src/middleware/cors.ts           |   4 +-
 services/platform/src/routes/box-manifest.ts       | 122 ++++++++++
 services/platform/src/types.ts                     |  11 +
 services/platform/test/auth.test.ts                | 158 ++++++++++++-
 services/platform/test/box-manifest.test.ts        | 155 ++++++++++++
 services/platform/test/cors.test.ts                |   7 +
 services/platform/test/harness.ts                  |   6 +
 services/platform/test/migrations-replay.test.ts   |   2 +
 services/subscriptiontracker-api/test/auth.test.ts |  61 +++++
 services/subscriptiontracker-api/wrangler.jsonc    |   2 +-
 tooling/capability-register.json                   |   2 +
 tooling/ceilings.json                              |   2 +-
 tooling/ci/assert-analytics-contract.mjs           |   8 +
 tooling/ci/test/analytics-contract.test.mjs        |   7 +-
 tooling/ci/test/box-config-drift.test.mjs          | 192 +++++++++++++++
 tooling/ci/test/coverage-manifest.json             |   3 +
 tooling/ci/test/e2e-auth-target.test.mjs           |   2 +-
 tooling/ci/test/ops-register.test.mjs              |  11 +-
 tooling/ci/test/prod-provenance-databases.test.mjs |   6 +-
 tooling/ci/test/prod-provenance.test.mjs           |   6 +-
 tooling/enforcement-index.json                     |  10 +
 tooling/guard-yield.json                           |   5 +
 tooling/legal/data-inventory.json                  |  19 ++
 tooling/ops/box-config-vendored.json               |  28 +++
 tooling/ops/boxes/post-config-manifest.sh          |  92 ++++++++
 tooling/ops/check-box-config-drift.mjs             | 259 +++++++++++++++++++++
 .../fixtures/box-config-drift/manifest-clean.json  |  12 +
 .../box-config-drift/manifest-one-changed.json     |  12 +
 .../ops/fixtures/box-config-drift/register.json    |  32 +++
 tooling/ops/register.json                          |  22 ++
 tooling/platform-register.json                     |  12 +-
 tooling/prod-provenance.json                       |   4 +
 41 files changed, 1458 insertions(+), 32 deletions(-)
```

