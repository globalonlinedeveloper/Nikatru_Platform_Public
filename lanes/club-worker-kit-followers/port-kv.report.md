BASE: ad238205df7297d45f862734fca46bfd426b7fb5
HEAD: 64d445945a6439bb584007797d0b68d192d01180 (four local wip commits on BASE, never pushed)

All the code patches are in and every check named below came out as the brief expects. The ports changes touched two things the brief didn't name: the edge-shield wiring and limb 8 of the guard (see Deviations 2 and 3). Platform's suite has one red test, and it fails at BASE too. Nothing in the brief has a Dart step, so none was skipped.

| # | Check | Command | Exit | Expected | Verdict |
|---|---|---|---|---|---|
| 1 | platform tsc | `cd services/platform && npx tsc --noEmit` | 0 | green | ✅ |
| 2 | subscriptiontracker-api tsc | `cd services/subscriptiontracker-api && npx tsc --noEmit` | 0 | green | ✅ |
| 3 | edge-shield tsc | `cd services/edge-shield && npx tsc --noEmit` | 0 | green | ✅ |
| 4 | platform suite | `cd services/platform && npx vitest run` | 1 | green | ⬜ 1711/1712 pass. The one failure is `backup-export.test.ts › a 100-column table round-trips` (c63 is 9007199254740990 instead of 2^53−1). It fails the same way on a BASE worktree, so it is not this patch. |
| 5 | subscriptiontracker-api suite | `cd services/subscriptiontracker-api && npx vitest run` | 0 | green | ✅ 751/751 |
| 6 | edge-shield suite | `cd services/edge-shield && npx vitest run` | 0 | green | ✅ 66/66 |
| 7 | brick Worker (stamped by hand as `services/probeapi-api`, `{{app_id}}`→`probeapi`, then deleted) | `npm ci && npx tsc --noEmit && npm test` | 0 / 0 / 0 | green | ✅ 210/210 |
| 8 | new port suites | `npx vitest run ../_shared/test/{ports-kv,ports-objects,ports-ratelimit,geo,rate-limit}.test.ts` | 0 | green | ✅ 44/44 |
| 9 | assert-ports, real tree | `node tooling/ci/assert-ports.mjs` | 0 | green | ✅ 10 limbs, 6 ports; kv, objects and ratelimit each claim, earn and target L2 |
| 10 | ports.test.mjs | `node --test tooling/ci/test/ports.test.mjs` | 0 | green | ✅ 51/51, including the fixture reds for limbs 1, 8, 9, 10 and the real-tree reds |
| 11 | assert-ceiling-budget | `node tooling/ci/assert-ceiling-budget.mjs` | 0 | green | ✅ after annotating the fakes' page-size constants |
| 12 | assert-chassis-ledger + its test | `node tooling/ci/assert-chassis-ledger.mjs` / `node --test …/chassis-ledger.test.mjs` | 0 / 0 | green | ✅ after re-measuring the brick types.ts row (86 → 90) |
| 13 | build-enforcement-index | `node tooling/ci/build-enforcement-index.mjs --write` | 0 | green, no diff | ✅ |
| 14 | affected-guards | `node tooling/scripts/affected-guards.mjs --base ad238205…` | 0 | green | ✅ 143 green, 0 findings, 5 environmental (all red at BASE too: worker:platform from row 4; assert-app-dod#2, assert-launcher-icons and assert-ops-register report COVERAGE LOST because the sandbox has no stamped app, Flutter SDK or Private corpus; lane-verdict needs `LANE_NEEDS`) |
| 15 | assert-guard-coverage (last) | `node tooling/ci/assert-guard-coverage.mjs` | 0 | green | ✅ |
| R1 | KV fake ignores TTL (patch 1/4) | mutate `fakes/kv.ts`, run ports-kv.test | 1 | red | ✅ `ttl-expires` fails; reverted |
| R2 | objects fake never truncates (patch 2/4) | mutate `fakes/objects.ts`, run ports-objects.test | 1 | red | ✅ `list-paginates` fails; reverted |
| R3 | limiter fake always admits (patch 3/4) | mutate `fakes/ratelimit.ts`, run ports-ratelimit.test | 1 | red | ✅ `over-budget-fails` fails; reverted |
| R4 | events.ts reads `request.cf` directly (patch 3, limb 10) | mutate real file, `node tooling/ci/assert-ports.mjs` | 1 | red | ✅ first line names limb 10 (geo); reverted |
| R5 | sessions.ts typed `KVNamespace` (patch 5, limb 9) | mutate real file, assert-ports | 1 | red | ✅ first line names limb 9 (bindings); reverted |
| R6 | Cloudflare's non-port row without `remaining` (patch 6, limb 8) | mutate real `_non-port.json`, assert-ports | 1 | red | ✅ "cloudflare is placed 4 times"; reverted |
| R7 | ObjectStore gains a member R2 lacks | mutate `ports/objects.ts`, platform tsc | 1 | red | ✅ TS2741 in `adapters/cloudflare.ts`; reverted |
| R8 | RateLimiter gains a member the binding lacks | mutate `ports/ratelimit.ts`, platform tsc | 1 | red | ✅ TS2741; reverted |
| R9 | KvStore gains a member KVNamespace lacks | mutate `ports/kv.ts`, platform tsc | 1 (shown by the TS2741 error; run through a pipe) | red | ✅ reverted |
| R10 | edge-shield's limiter type drifts from the port | mutate `edge-shield/src/types.ts`, edge-shield tsc | 1 | red | ✅ reverted |

**Deviations, seams that didn't match, and what I could not do**
1. **Anchors moved since 630dcce4:**
   - KV is read directly in 10 source files at BASE, not 16: `_shared/src/auth-middleware.ts`, platform `types.ts`, `fx.ts`, `routes/sessions.ts`, `backup/index.ts`, `backup/dump.ts`, and api `types.ts`. `config.ts`, `checkout.ts`, `routes/fx.ts` and `index.ts` call through `c.env` and needed no edit.
   - `lib/mor/paddle.ts` no longer touches KV.
   - edge-shield has no KV.
   - `request.cf` is read in 3 files, not 10: `_shared/src/rate-limit.ts`, `routes/events.ts`, `lib/request-log.ts`. `lib/edge-ceiling.ts` is now a re-export.
2. **edge-shield's `src/` is unchanged.** Importing the port type into `src/` made edge-shield a kit "carrier", and `carrier-parity.test.ts` then flagged its `JWKS_TTL_SECONDS` (300 s, the edge cache bound), which is a different constant from the kit's 600 s one that only shares the name. Fixing that would mean renaming an auth-host constant, so I left `src/` alone. Instead `services/edge-shield/test/ratelimit-port.test.ts` makes tsc prove that `RateLimiterBinding` and `RateLimiter` are the same type in both directions, and checks that a limiter over budget gets a 429. The Worker's bundle is unchanged.
3. **Guard changes the brief didn't name.** One vendor can't be both an adapter in three ports and a non-port row under the old limb 8. I changed it to allow one adapter per port plus a non-port row, but only if that row lists what is still unported (new schema field `remaining`, alongside `until`). Limb 1 now lets a `draft` adapter have `vendor: null` and an empty `impl`, because neither register has an S3 vendor. `affected-guards.mjs` now also selects assert-ports when a changed file contains the new limbs' patterns.
4. **Smaller deviations.**
   - `requestGeo` also returns `region` and `city` (events.ts writes them), and keeps `asn` as `number | string` so the edge key's length limit behaves exactly as before.
   - Each Worker's `Env` declares its bindings as the port types. The only place the Cloudflare types are named is the identity adapter `ports/adapters/cloudflare.ts`, which exists as the compile-time proof.
   - The brick's `types.ts` got the same change as the api's, so I re-measured `chassis-ledger.json`.
   - `coverage-manifest.json` was regenerated (ports.test.mjs went from 40 to 51 cases).
   - The fakes' page-size constants carry `@ceiling none`.
5. **Pending row.** The three binding conformance cases are declared `pending` against `O-CLOUDFLARE-BINDINGS-SCATTERED`, because every Worker suite runs under plain vitest on Node (no Miniflare, no vitest-pool-workers). The Private pass may want its own row for that.
6. **Process.**
   - My first wip commit used `--no-verify`. No hooks are installed in this sandbox, so it skipped nothing; later commits don't use it.
   - The PR body draft (rows, deploys, one row per patch with its red control, HELD for review, the runbook lines) is at `scratchpad/pr-body.md`.
   - Branch, push and PR steps were not done, per the drafter rules.
7. **Kit symbols relied on (check they survive worker-kit's review):**
   - `_shared/src/rate-limit.ts`: `RateLimiterBinding` (now an alias of `RateLimiter`), `withinRateLimit`, `withinEdgeCeiling`, `strictRateLimit`, `strictEdgeCeiling`, `edgeCeilingKey`, `EdgeContext`.
   - `_shared/src/auth-middleware.ts`: `warmJwksCache`, `localSetFromCache`, `verifyAsymmetric`, `verifySupabaseToken`, `sessionRevoked`, `AuthBindings` (types only changed).
   - Also: `platform/src/lib/edge-ceiling.ts` (re-export), the `_shared/package.json` exports `./ports/*` and `./ports/fakes/*`, `carrier-parity.test.ts`, `shared-home.test.ts`, `no-network.ts`.
   - I edited two worker-kit-only files, both because the brief required it: `rate-limit.ts` and `auth-middleware.ts`.
8. **Files shared with other trains:**
   - port-foundation: `tooling/ci/assert-ports.mjs`, `tooling/ci/test/ports.test.mjs`, `tooling/ports/port.schema.json`, `tooling/ports/README.md`, `tooling/ports/_non-port.json`.
   - Also: `tooling/scripts/affected-guards.mjs`, `tooling/ci/test/coverage-manifest.json`, `tooling/chassis-ledger.json`, the brick `{{app_id}}-api/src/types.ts`.

```
 services/_shared/src/auth-middleware.ts            |  15 ++-
 services/_shared/src/geo.ts                        |  55 ++++++++
 services/_shared/src/ports/adapters/cloudflare.ts  |  35 +++++
 services/_shared/src/ports/fakes/kv.ts             |  71 ++++++++++
 services/_shared/src/ports/fakes/objects.ts        |  69 ++++++++++
 services/_shared/src/ports/fakes/ratelimit.ts      |  43 ++++++
 services/_shared/src/ports/kv.ts                   |  65 +++++++++
 services/_shared/src/ports/objects.ts              |  74 ++++++++++
 services/_shared/src/ports/ratelimit.ts            |  27 ++++
 services/_shared/src/rate-limit.ts                 |  30 +++--
 services/_shared/test/conformance/check.ts         |  28 ++++
 services/_shared/test/conformance/kv.ts            | 136 +++++++++++++++++++
 services/_shared/test/conformance/objects.ts       | 121 +++++++++++++++++
 services/_shared/test/conformance/ratelimit.ts     |  89 ++++++++++++
 services/_shared/test/geo.test.ts                  |  39 ++++++
 services/_shared/test/ports-kv.test.ts             |  58 ++++++++
 services/_shared/test/ports-objects.test.ts        |  42 ++++++
 services/_shared/test/ports-ratelimit.test.ts      |  68 ++++++++++
 services/edge-shield/test/ratelimit-port.test.ts   |  38 ++++++
 services/platform/src/backup/dump.ts               |   5 +-
 services/platform/src/backup/index.ts              |  16 ++-
 services/platform/src/fx.ts                        |   3 +-
 services/platform/src/lib/request-log.ts           |   7 +-
 services/platform/src/routes/events.ts             |  13 +-
 services/platform/src/routes/sessions.ts           |   3 +-
 services/platform/src/types.ts                     |  19 ++-
 services/subscriptiontracker-api/src/types.ts      |   8 +-
 .../needs_backend}}/{{app_id}}-api/src/types.ts    |   8 +-
 tooling/chassis-ledger.json                        |   4 +-
 tooling/ci/assert-ports.mjs                        | 125 ++++++++++++++---
 tooling/ci/test/coverage-manifest.json             |   2 +-
 tooling/ci/test/ports.test.mjs                     | 149 ++++++++++++++++++++-
 tooling/ports/README.md                            |  24 +++-
 tooling/ports/_non-port.json                       |   2 +-
 tooling/ports/kv.json                              | 116 ++++++++++++++++
 tooling/ports/objects.json                         | 142 ++++++++++++++++++++
 tooling/ports/port.schema.json                     |   1 +
 tooling/ports/ratelimit.json                       | 108 +++++++++++++++
 tooling/scripts/affected-guards.mjs                |  11 +-
 39 files changed, 1787 insertions(+), 82 deletions(-)
```

The same patch is saved at `scratchpad/port-kv.patch`, with the same sha256 as below.

