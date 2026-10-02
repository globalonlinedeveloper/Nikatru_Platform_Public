I finished the full patch for all four findings, but CI can't go green until the local writer does one step with the vault. The new sandbox-binding check is deliberately red on the real tree until `node tooling/scripts/provision-sandbox-twins.mjs --apply` creates three Cloudflare resources and writes their ids in. The sandbox has no vault and no Cloudflare access, so nothing was created here.

BASE: `ad238205df7297d45f862734fca46bfd426b7fb5`
HEAD: `3ad63d743891c0d010347c6306b41aa7397ab3cf` (local wip commits only; nothing pushed)

## Tests, guards and red controls

| # | What | Command | Exit | Expected? |
|---|---|---|---|---|
| 1 | Migration guard, final tree | `node tooling/ci/check-migrations.mjs` | 0 | green ✓ |
| 2 | **Red control -034**: BASE brick, `idx_records_user` still present | same | 1 | red ✓ (names the line and both covering indexes) |
| 3 | Brick Worker, stamped by a node render (`{{app_id}}`→`probeapi`) into `services/probeapi-api` | `npm ci --no-audit --no-fund` | 0 | green ✓ |
| 4 | same | `npx tsc --noEmit` | 0 | green ✓ |
| 5 | same: the step "A stamped Worker typechecks and passes the suite it inherits" | `npm test` | 0 | green ✓ (22 files, 184 tests) |
| 6 | same | `npx wrangler deploy --dry-run` / `--env sandbox` | 0 / 0 | green ✓ |
| 7 | **Red control -010/-011**: BASE `src/index.ts` + `wrangler.jsonc` in the stamp | `npx vitest run test/health.test.ts test/wrangler-config.test.ts` | 1 | red ✓ (10 failed) |
| 8 | Analytics guard on a simulated stamped tree (probe registered with `--register-only`) | `node tooling/ci/assert-analytics-contract.mjs` | 0 | green ✓ (`{build, ok}` answered by all 3 health handlers) |
| 9 | **Red control -010**: BASE brick `index.ts` in that tree | same | 1 | red ✓ (`services/probeapi-api/src/index.ts does not answer … build`) |
| 10 | Analytics guard on the stamped tree **without** a register row | same | 2 | finding (see deviation 2) |
| 11 | worker-set on the real tree | `node tooling/ci/worker-set.mjs --for-deploy --json --app-workers --env sandbox` | 0 | green ✓ |
| 12 | worker-set tests | `node --test tooling/ci/test/worker-set.test.mjs` | 0 | green ✓ (40/40) |
| 13 | **Red control -011**: CLI refusal removed | same | 1 | red ✓ (2 failed, incl. the two-app case) |
| 14 | Platform register guard, real tree | `node tooling/ci/assert-platform-register.mjs` | 1 | **red until `--apply` runs**: exactly 3 placeholder findings |
| 15 | **Red control -022**: BASE platform + subscriptiontracker-api configs under the new check | `node …/assert-platform-register.mjs <tree>` | 1 | red ✓ (8 missing-twin findings) |
| 16 | Same guard after a fake-Cloudflare `provision()` apply | same | 0 | green ✓ (3 env blocks, 45 bindings checked); second run wrote nothing |
| 17 | Provisioner self-check on the stamp | `node tooling/scripts/provision-backend.mjs probeapi --self-check` | 0 | green ✓ |
| 18 | Platform per-app block renderer | `node tooling/scripts/render-platform-app-block.mjs --check` | 0 | green ✓ |
| 19 | Twins script, offline / no credentials | `provision-sandbox-twins.mjs --list` / no flag | 0 / 1 | ✓ / refusal as designed |
| 20 | Changed and new test files | `node --test` on platform-register (118), provision-backend (34), capture-backend (15), d1-fanout (12), migration-prefix-index (12), sandbox-twins (18), d1-sql-inventory (57), prod-provenance-databases (26) | 0 each | green ✓ |
| 21 | Mutations of the new code: never-overwrite rule removed; surgery depth check removed | `node --test tooling/ci/test/sandbox-twins.test.mjs` | 1 / 1 | red ✓ |
| 22 | Full suite | `node --test --test-concurrency=8 "tooling/ci/test/*.test.mjs"` | 1 | 14870 tests, 14860 pass, 1 fail: T19 in `renovate-reach`, which fails identically at BASE |
| 23 | Affected guards | `node tooling/scripts/affected-guards.mjs --base ad238205… --jobs 8` | 1 | 4 findings fixed afterwards; the platform register stays red (row 14); 15 environmental, red at BASE too |
| 24 | After those fixes | assert-enforcement-index, assert-no-loop-cases, assert-guard-coverage, check-agent-docs, `gen-start-here --check`, assert-chassis-ledger, assert-d1-bindings, assert-vendor-portability, assert-data-inventory | 0 each | green ✓ |
| 25 | The 41 checks that ran over the affected-guards budget | `node --test …` | 1 → 0 | one case fixed (`prod-provenance-databases`, sandbox DB name count), then green |
| 26 | Platform Worker | `npx tsc --noEmit` / `npx vitest run` | 0 / 1 | 1 fail (`backup-export` 100-column case), identical at BASE |
| 27 | Wrangler on the changed configs | `npx wrangler deploy --dry-run [--env sandbox]` in platform and subscriptiontracker-api | 0 ×4 | green ✓; wrangler's missing-binding warning shrank from many names at BASE to the one exempt var |

## Deviations, mismatched seams, and what I could not do

1. **-022 resources not created.** `tooling/scripts/provision-sandbox-twins.mjs` is new. It only creates, is idempotent, refuses any name not ending in `-sandbox`, and reads the token in-process from the main checkout's vault without printing it. It also refuses to overwrite an id that is already recorded. The configs carry all-zero placeholders, and the new check refuses those in deployable configs, so the gate stays red until the script runs. Sandbox resource names for the PR body (none exist yet): `session-revoked-sandbox`, `signups-sandbox` (KV) and `nikatru-backups-sandbox` (R2). After `--apply`, commit the two config diffs and re-run the platform register guard and `capture-backend.test.mjs`.
2. **The ci.yml class fix needed a new `--register-only` flag on `provision-backend.mjs`.** It runs step [6] alone, offline. Without a register row, worker-set refuses the stamped directory, so the analytics guard exits 2 instead of grading the Worker (row 10). The new step registers the probe, runs the guard, requires an `apps=3` line, and restores the register. Everything in CI after the mason stamp was simulated here (no Flutter or mason in the sandbox).
3. **`provision-backend.mjs` does not create per-app sandbox KV.** The clone contract makes JWKS_CACHE and SESSION_REVOKED shared, so the new step [5s] creates `<app>_db_sandbox` (`--location apac`), migrates it with `--env sandbox`, and copies the shared sandbox ids from the platform's `env.sandbox`.
4. **The platform's per-app sandbox twins are generated, not hand-written.** I added three sandbox regions to `render-platform-app-block.mjs` (erasure endpoints, service bindings, app databases). It now refuses an app Worker with no `env.sandbox`.
5. **The provisioner's APP_DB regex now only sees the top level.** Its existing self-check test found that once the brick stamps `env.sandbox`, a padded APP_DB block made the regex match the sandbox entry. A live run would then have written the production id into the sandbox binding.
6. **Other decisions:**
   - `PROVIDER_TOKEN_PLAINTEXT_READS_UNTIL` is exempted in the platform sandbox. The reason cites the decision already recorded in the config by #1104; I withdrew an earlier argument of mine about dates because it was wrong.
   - `capture-backend` now also refuses reuse of a production R2 bucket or service name.
   - `captureBackendDefines` is still specific to app #1 (out of scope).
7. **Kept redundant indexes.** As the brief asks: subscriptiontracker-api's redundant index stays, because dropping it is a separate decision under the additive-only rule. The new check also found two in the platform database (`idx_entitlements_user`, `idx_bundle_grants_user`). All three are listed as kept with reasons and printed on every run.
8. **Seams whose line numbers had moved (text matched):** brick `index.ts` 58-62 → 55-59 and 102-103 → 95-102; `ci.yml` 1294-1297 → 1447-1449; `assert-analytics-contract.mjs` 2132-2139 → about 2143-2175; `capture-backend.mjs` 64-67 → 61-67; platform `wrangler.jsonc` 500 and 537 → 558-617. No item was already fixed.
9. **Not run:** Dart (the brief has no Dart changes, so I didn't clone Flutter), the Private spec guards, `preflight.mjs`, and the CI mason stamp.
10. **Files shared with the syn-p41/p43/p44 lanes** under `tooling/bricks/app/`: brick `src/index.ts`, `wrangler.jsonc`, `migrations/0001_init.sql`, new `test/health.test.ts`, `test/wrangler-config.test.ts`, `test/raw-modules.d.ts`, and `route-clients.json`. Also changed: `tooling/chassis-ledger.json`.
11. **Kit symbols depended on:**
    - From `services/_shared`: `health.ts` (`inspect`, `probeBinding`, `probeJwks`, `newProbeCache`, `READING_TTL_MS`, `JWKS_READING_TTL_MS`, through brick `lib/health`); the stale-JWKS fallback in `auth.ts` (cited in a comment); `test/no-network.ts`.
    - From `tooling/ci`: `worker-set.mjs` (`workerSet`, `deploySet`, `appWorkerEntries`, `envEntries`, `registerRows`); `worker-routes.mjs` `mountedRoutes`; `d1-stores.mjs` `parseJsonc` and `ownedD1`; `text-reductions.mjs` `stripSourceComments`.

## Diff stat

```
 .github/workflows/ci.yml                           |  19 ++
 services/platform/wrangler.jsonc                   |  81 +++++-
 services/subscriptiontracker-api/wrangler.jsonc    |   9 +-
 .../{{app_id}}-api/migrations/0001_init.sql        |   5 +-
 .../needs_backend}}/{{app_id}}-api/src/index.ts    |  36 ++-
 .../{{app_id}}-api/test/health.test.ts             |  66 +++++
 .../{{app_id}}-api/test/raw-modules.d.ts           |  12 +
 .../{{app_id}}-api/test/wrangler-config.test.ts    | 154 +++++++++++
 .../needs_backend}}/{{app_id}}-api/wrangler.jsonc  |  69 ++++-
 tooling/bricks/app/route-clients.json              |   2 +-
 tooling/chassis-ledger.json                        |  27 +-
 tooling/ci/assert-platform-register.mjs            | 122 +++++++++
 tooling/ci/check-migrations.mjs                    |  73 ++++-
 tooling/ci/migration-tables.mjs                    | 142 ++++++++++
 tooling/ci/test/capture-backend.test.mjs           |  78 +++++-
 tooling/ci/test/coverage-manifest.json             |  14 +-
 tooling/ci/test/d1-fanout.test.mjs                 |  30 +-
 tooling/ci/test/migration-prefix-index.test.mjs    | 184 +++++++++++++
 tooling/ci/test/platform-register.test.mjs         | 123 +++++++++
 tooling/ci/test/prod-provenance-databases.test.mjs |   4 +-
 tooling/ci/test/provision-backend.test.mjs         | 122 ++++++++-
 tooling/ci/test/sandbox-twins.test.mjs             | 287 ++++++++++++++++++++
 tooling/ci/test/worker-set.test.mjs                |  53 +++-
 tooling/ci/worker-set.mjs                          |  48 +++-
 tooling/enforcement-index.json                     |   1 +
 tooling/platform-register.json                     |  20 ++
 tooling/scripts/provision-backend.mjs              | 291 +++++++++++++++-----
 tooling/scripts/provision-sandbox-twins.mjs        | 302 +++++++++++++++++++++
 tooling/scripts/render-platform-app-block.mjs      |  59 +++-
 tooling/scripts/wrangler-surgery.mjs               | 174 ++++++++++++
 tooling/store/capture-backend.mjs                  |  87 ++++--
 31 files changed, 2564 insertions(+), 132 deletions(-)
```

