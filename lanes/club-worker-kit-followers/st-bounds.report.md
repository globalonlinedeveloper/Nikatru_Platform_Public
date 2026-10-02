BASE: `ad238205df7297d45f862734fca46bfd426b7fb5` (present; seed = c89cb4fa + worker-kit draft)
HEAD: `f6499f51d5555024ebc2aa2c888adcbf44d6de13` (local sandbox commits only, nothing pushed)

The patch is finished and every test, guard and red control the brief names that runs here was run. The ST and platform suites, both `tsc` runs and the Dart tests all pass. The only failure is one platform test that also fails at BASE. All 19 red controls went red and were reverted. The patch applies cleanly to BASE (`git apply --check`, exit 0).

| # | What | Command (cwd) | Exit | Expected |
|---|---|---|---|---|
| 0 | ST suite at BASE (baseline) | `npx vitest run` (services/subscriptiontracker-api) | 0 (41 files / 713) | green ✓ |
| 1 | ST typecheck | `npx tsc --noEmit` (ST) | 0 | green ✓ |
| 2 | ST suite | `npx vitest run` (ST) | 0 (43 files / 750) | green ✓ |
| 3 | platform typecheck | `npx tsc --noEmit` (services/platform) | 0 | green ✓ |
| 4 | platform suite | `npx vitest run` (platform) | 1: one failure, `backup-export.test.ts` "100-column table" | fails at BASE too (environmental, see deviations) |
| 5 | platform currency + reminder tests | `npx vitest run test/currency-table.test.ts test/reminder-mail.test.ts` | 0 (32) | green ✓ |
| 6 | Dart table drift check | `node contracts/currency/generate-dart.mjs --check` | 0 | green ✓ |
| 7 | node guard tests | `node --test` currency-table, platform-register, d1-sql-inventory, vendor-portability, money-config, ceiling-budget | 0 (337) | green ✓ |
| 8 | guards | `node tooling/ci/assert-{ceiling-budget,deploy-triggers-deploy,vendor-portability,platform-register,d1-sql-inventory,money-config,guard-coverage,signing-inputs-pinned}.mjs` | all 0 | green ✓ |
| 9 | dead files | `node tooling/scripts/assert-no-dead-files.mjs` | 0 | green ✓ |
| 10 | START-HERE card | `node tooling/scripts/gen-start-here.mjs --check` | 0 | green ✓ |
| 11 | affected-guards | `NIKATRU_FLUTTER_ROOT=/tmp/flutter node tooling/scripts/affected-guards.mjs --base ad238205… --budget-s 560` | 2: 190 green, **0 findings**, 8 environmental (same exit at base), 4 coverage lost (no melos) | see deviations |
| 12 | coverage manifest | `node tooling/ci/assert-guard-coverage.mjs` (writes it) | 0, added `currency-table.test.mjs (4)` | ✓ |
| 13 | core Dart suite | `dart test` (packages/core) | 0 (764) | green ✓ |
| 14 | core money tests, final | `dart test test/money_test.dart` | 0 (30) | green ✓ |
| 15 | app Dart suite | `flutter test` (apps/subscriptiontracker) | 0 (1745), run before the last formatting fix | green ✓ |
| 16 | app client tests, final | `flutter test test/api_client_test.dart test/old_server_compat_test.dart` | 0 (14) | green ✓ |
| 17 | Dart analyze, touched files | `dart analyze --fatal-infos …` | 0 | green ✓ |
| 18 | Dart format, touched files | `dart format --output=none --set-exit-if-changed …` | 0 | green ✓ |
| R1 | -024: data route mounted on `app` instead of `api` | `vitest run test/mount-auth.test.ts` | 1 | red ✓ (reverted) |
| R2 | -008: `api.use('*', writeLimit)` removed | `vitest run test/write-limit.test.ts` | 1 | red ✓ |
| R3 | -031: date bound back to "any calendar date" | bounds.test.ts | 1 | red ✓ |
| R4 | -030: any three letters accepted (ZZZ) | bounds.test.ts | 1 | red ✓ |
| R5 | -030: `price_minor` check disabled | bounds.test.ts | 1 | red ✓ |
| R6 | -008: row cap +1000000 | bounds.test.ts | 1 | red ✓ |
| R7 | -008: unpaged LIMIT removed | bounds.test.ts | 1 | red ✓ |
| R8 | -025: body cap set to 10 MB | bounds.test.ts | 1 | red ✓ |
| R9 | -029: POST read-back by id alone | bounds.test.ts | 1 | red ✓ |
| R10 | -026: another account's id not filtered | tenancy.test.ts | 1 | red ✓ |
| R11 | -025: budget body cap set to 10 MB | budget.test.ts | 1 | red ✓ |
| R12 | -030: budget currency is any three letters | budget.test.ts | 1 | red ✓ |
| R13 | #1121 nit 1: back to `scope === CREATE_SCOPE` | idempotency.test.ts | 1 | red ✓ |
| R14 | #1121 nit 2 (mutation R3c): `parent_id == null` limb removed | payment-idempotency.test.ts | 1 | red ✓ |
| R15 | sandbox `WRITE_LIMITER` renamed away | wrangler-config.test.ts | 1 | red ✓ |
| R16 | top-level `WRITE_LIMITER` renamed away | wrangler-config.test.ts | 1 | red ✓ |
| R17 | platform formatter back to JPY/KWD only | platform currency-table.test.ts | 1 | red ✓ |
| R18 | `money.dart` back to the two-entry map | `dart test test/money_test.dart` | 1 (KRW and BHD red) | red ✓ |
| R19 | client stops after page 1 | `flutter test test/api_client_test.dart` | 1 | red ✓ |

**Items already fixed at BASE, or changed in scope:**
- **-029, PATCH half:** already fixed at BASE. `answerRow` already selected `AND user_id = ?` and answered 404 on a miss. The test exists, but it cannot go red against BASE. Only the POST read-back (by id alone, a 201 carrying `{error}`) was still broken; that is fixed.
- **-026:** still present at BASE (the budget read only looked at the caller's own rows). I could not check #1063 itself; the code at BASE is what I checked. Fixed with a third `json_each` arm on the existing UNION, so it is still one statement.

**Deviations and things to check:**
- **Row cap = 500, not measured.** I had no production access. The reasoning in the code: people track tens of subscriptions, 500 is 5× a generous 100, and the worst-case row size keeps one account to about 4 MB. Removed rows count until they are purged. Before merge, run `SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM subscriptions GROUP BY user_id)` and re-base the cap if the result is within 5× of it.
- **Limiter is 120 writes a minute per account, and it fails open** (the kit's `withinRateLimit`). It answers 429 with `Retry-After: 60`. Namespace ids are 1027 (top level) and 1028 (sandbox); platform holds 1001–1026.
- **Paging has two response shapes, so old clients keep working.**
  - With no `limit`: the bare array, with `LIMIT` set to the cap, so it can never cut short a list the cap admitted.
  - With `?limit=N&after=<cursor>`: keyset paging, returning `{items, next}`.
  - The Dart client reads both shapes.
  - The client needed no change for 409/429/413: `read_through_cache` already retries 429, retries only the in-progress 409, and treats any other 409 and 413 as permanent. So the web deploy is needed for paging only.
- **The body helper is `src/lib/json-body.ts`, not `body.ts`.** The twin-modules test requires any `lib/body.ts` to be exactly a re-export of the kit. `idempotentCreate` now reads the bounded body through `jsonBody(c)`; without that, the claim would have read the body unbounded first. Caps also cover the categories POST/PATCH (≈1.5 KB) and payments (1 KB), not only the three routes the brief named.
- **ISO 4217 list:** List One codes that have a minor unit; ANG, CUC and SLL are kept so a device still set to one isn't refused. XAU and the other "N.A." codes are refused.
- **Platform `backup-export` failure** comes from this sandbox's node:sqlite (a number read back as MAX_SAFE_INTEGER). It fails with BASE's `reminders.ts` too, and affected-guards classified the platform suite as environmental.
- **affected-guards:**
  - The 8 environmental reds (app-dod, ops-register, provision-backend, clone-contract ×2, lane-verdict, new-product, worker:platform) give the same exit at BASE.
  - The 4 coverage-lost are the melos-driven Dart checks; I ran `dart test` and `dart analyze` directly instead (rows 13–18).
  - Its last full run came before the final formatting, brace and comment fixes; I re-ran the affected guards and suites afterwards (rows 1–10, 16–18).
- **Process slips:**
  - My first local wip commit used `--no-verify`. No hooks are installed here, so nothing was skipped, but it breaks the house rule.
  - Two commands were auto-moved to the background because I left off the Bash timeout (the full app `flutter test` and the first affected-guards run). Both finished and their results are used above.
  - I ran `flutter test` inside `apps/subscriptiontracker`. `pubspec.lock` is unchanged. I reverted the `analysis_options.yaml` rewrites Flutter made and deleted its gitignored `flutter/ephemeral` dirs.
- **Citations re-measured:**
  - The `src/types.ts:13/14/17` citations in wrangler.jsonc are kept stable by placing the new import below them.
  - The sandbox `src/index.ts:156` citation pointed at the wrong line at BASE too; it now points at `src/index.ts:158`, the `APP_ID` line.
  - Old narrative mentions of renewals in the README and tooling are left as history.
- **Not done (outside this drafter's job):** the ADR, the Private register row (O-ST-API-NO-PER-USER-WRITE-BOUND), the PR body, and deploys.
- **Files shared with other trains:**
  - Worker-kit draft also touches: `tooling/ci/lane-map.json`, `tooling/platform-register.json`, ST `src/index.ts`, `src/types.ts`, `wrangler.jsonc`, `routes/budget.ts`.
  - fix-platform-route-edges reads the new table: `services/platform/src/lib/reminders.ts`.
  - Also touched: `packages/core/lib/src/money/money.dart`.
- **Kit symbols this patch depends on:**
  - `readBoundedBody` (`_shared/src/body.ts`)
  - `withinRateLimit`, `RateLimiterBinding` (`_shared/src/rate-limit.ts`)
  - `run` and its `meta.duplicate_of_committed_attempt` (`_shared/src/d1.ts`)
  - `isCalendarDateBetween`, `isBoundedString`, `isFiniteNumber` (`_shared/src/validate.ts`)
  - `anonymousNotRefused`, `es256Issuer`, `goTrueClaims`, `jwksFetch`, `Through` (`_shared/test/mount-auth.ts`)
  - `mountedEndpoints`, `probePath` (`_shared/test/preflight.ts`)
  - `supabaseAuthWith` and `erasureAuth`, through `middleware/auth.ts`

```
 .../lib/data/api/dio_api_client.dart               |  68 ++++-
 apps/subscriptiontracker/test/api_client_test.dart |  81 +++++
 .../test/old_server_compat_test.dart               |   6 +-
 contracts/README.md                                |   2 +
 contracts/currency/generate-dart.mjs               |  72 +++++
 contracts/currency/iso4217.d.ts                    |  12 +
 contracts/currency/iso4217.js                      |  83 +++++
 packages/core/lib/nikatru_core.dart                |   1 +
 .../core/lib/src/content/service_catalogue.dart    |  12 +-
 packages/core/lib/src/money/iso4217.g.dart         | 176 +++++++++++
 packages/core/lib/src/money/money.dart             |  25 +-
 packages/core/test/money_test.dart                 |  32 ++
 services/platform/src/lib/reminders.ts             |  24 +-
 services/platform/test/currency-table.test.ts      |  42 +++
 services/subscriptiontracker-api/README.md         |  25 +-
 services/subscriptiontracker-api/src/index.ts      |  15 +-
 .../subscriptiontracker-api/src/lib/idempotency.ts |  19 +-
 .../subscriptiontracker-api/src/lib/json-body.ts   |  69 +++++
 .../src/middleware/write-limit.ts                  |  50 +++
 .../subscriptiontracker-api/src/routes/budget.ts   |  71 +++--
 .../src/routes/categories.ts                       |  26 +-
 .../subscriptiontracker-api/src/routes/renewals.ts | 107 -------
 .../src/routes/subscriptions.ts                    | 316 +++++++++++++++----
 services/subscriptiontracker-api/src/types.ts      |   7 +
 .../subscriptiontracker-api/test/bounds.test.ts    | 338 +++++++++++++++++++++
 .../subscriptiontracker-api/test/budget.test.ts    |  40 ++-
 .../test/idempotency.test.ts                       |  48 ++-
 .../subscriptiontracker-api/test/lifecycle.test.ts |  30 +-
 .../test/mount-auth.test.ts                        |  93 ++++++
 .../test/payment-idempotency.test.ts               |  17 ++
 .../subscriptiontracker-api/test/renewals.test.ts  | 133 --------
 .../test/subscription-model.test.ts                |  13 +-
 .../subscriptiontracker-api/test/tenancy.test.ts   |  53 +++-
 .../test/wrangler-config.test.ts                   |  47 +++
 .../test/write-limit.test.ts                       | 115 +++++++
 services/subscriptiontracker-api/wrangler.jsonc    |  40 ++-
 tooling/capability-register.json                   |   1 +
 tooling/ci/lane-map.json                           |   4 +
 tooling/ci/test/coverage-manifest.json             |   3 +
 tooling/ci/test/currency-table.test.mjs            |  70 +++++
 tooling/platform-register.json                     |  25 +-
 41 files changed, 1974 insertions(+), 437 deletions(-)
```

The patch is 3284 lines and 167,124 bytes; the sandbox copy is `/tmp/claude-0/st-bounds.patch`. I transcribed the text below by hand from that file. In a diff, every blank-looking line inside a hunk is a single space. **Check the sha256 below before applying.** If it does not match, regenerate with `git diff --binary ad238205… ` from HEAD `f6499f51`.

