BASE: 2c17bca90042b8e19ce4b305f961b9ad761c7c46
HEAD: 9949840ce207e64c3a3298cee0559ac35b9f947c (4 local `wip:` commits, never pushed)

The patch is complete, not PARTIAL; it took about 55 of the 100 minutes. All three Workers and the hand-stamped brick Worker type-check with every D1 binding typed `SqlDb`. Every suite matches BASE except for the new tests. The final affected-guards run had 0 findings, and `assert-guard-coverage` (run last) was green. `assert-ports` prints `sql L2 L2 L3` and names the 10 pending `sql/d1` scenarios; it is not 3/3.

| # | Check | Command | Exit | Expected / reading |
|---|---|---|---|---|
| 1 | tsc at BASE (platform, subscriptiontracker-api, edge-shield) | `npx tsc --noEmit` in each | 0 / 0 / 0 | green control |
| 2 | Suites at BASE | `npx vitest run` in each | 1 / 0 / 0 | platform 1711/1712 at BASE. The one red is `backup-export.test.ts` "a 100-column table round-trips": `…740991` reads back as `…740990` under node:sqlite on node 22.22 here (CI uses node 24). subscriptiontracker-api 751/751, edge-shield 66/66. |
| 3 | tsc on the final tree, all three Workers | `npx tsc --noEmit` | 0 / 0 / 0 | green. With every `Env` D1 member typed `SqlDb`, this proves the port covers every call site, and `cloudflareD1` proves `D1Database` satisfies `SqlDb`. |
| 4 | platform suite, final | `npx vitest run` | 1 | 1734/1735: the same single BASE red, nothing new |
| 5 | subscriptiontracker-api suite, final | `npx vitest run` | 0 | 768/768 |
| 6 | edge-shield suite, final | `npx vitest run` | 0 | 66/66 |
| 7 | Brick Worker, hand-stamped as `services/probeapi-api` (mustache vars replaced with sed, since mason needs Dart), then deleted | `npm ci`, `npx tsc --noEmit`, `npx vitest run` | 0 / 0 / 0 | 227/227 |
| 8 | SQL conformance suite plus its red controls | `npx vitest run ../_shared/test/ports-sql.test.ts` | 0 | 17/17: 10 scenarios on the sqlite engine and 7 runner checks. Each of the 6 red controls fails its named scenario: non-atomic batch (only `batch-is-atomic` fails), `undefined` bound as NULL, `bind` mutating in place, every error worded as a reset, UNIQUE reworded, no-database fixture. |
| 9 | Export replay on the shipped `dumpD1Database` output | `npx vitest run test/sql-export-replay.test.ts` | 0 | 6/6, 4 of them red controls: a table missing from the export, a table no migration creates, a row short of its `table-end`, a cut-off export |
| 10 | assert-ports tests | `node --test tooling/ci/test/ports.test.mjs` | 0 | 53/53, including a real-tree `erasure-ledger.ts` retyped `D1Database` (limb 9) and `sql.json` claiming L3 (limb 6) |
| 11 | **Red control:** D1 types removed from the limb-9 pattern | same command | 1 | Exactly the two D1 tests went red. The file was restored and `cmp` confirmed it identical. |
| 12 | port-switch tests | `node --test tooling/ci/test/port-switch.test.mjs` | 0 | 27/27: C9 PASS on gzip and plain exports, a missing table FAILs (exit 1), no `--export` is LOST (exit 2), `--to sqlite` in live FAILs C1 |
| 13 | **Red control:** the missing-table comparison removed from `sql-export-replay.mjs` | same command | 1 | The missing-table test went red. The file was restored and `cmp` confirmed it identical. |
| 14 | d1-sql-inventory tests | `node --test tooling/ci/test/d1-sql-inventory.test.mjs` | 0 | 59/59, including the red: the same file registered `built` instead of `fake` is scanned and its hidden `.prepare` is reported |
| 15 | d1-fanout and chassis-ledger tests | `node --test tooling/ci/test/{d1-fanout,chassis-ledger}.test.mjs` | 0 / 0 | 12/12, 37/37 |
| 16 | assert-ports | `node tooling/ci/assert-ports.mjs` | 0 | `sql L2 L2 L3`, with the 10 `PENDING sql/d1: …` lines printed |
| 17 | Individual guards | `assert-d1-sql-inventory`, `assert-chassis-ledger`, `assert-ceiling-budget`, `assert-mechanism-claims` | 0 each | green |
| 18 | affected-guards, first run | `node tooling/scripts/affected-guards.mjs --base 2c17bca9 --no-budget` | 1 | 7 findings, all from this change and all fixed: d1-sql-inventory saw the fake engine; a mechanism-claim phrase; the fan-out test's text anchor; chassis-ledger line counts; an import landing between a `@ceiling` docblock and its constant |
| 19 | affected-guards, final run | same command | 0 | 183 checks: 177 green, 0 findings, 6 environmental (red at BASE with the same exit): worker:platform, assert-ops-register, provision-backend, assert-app-dod#2, assert-launcher-icons, lane-verdict. 52/52 changed paths mapped. |
| 20 | assert-guard-coverage (last) | `node tooling/ci/assert-guard-coverage.mjs` | 0 | Tree unchanged after the run |

**Not run:**
- `spec-guards.mjs` and `preflight.mjs`: they need the Private corpus.
- `check-d1-accepts-live-sql.mjs`: it needs a credential.
- A real R2 export through the dry run: none was available here.
- The brief has no Dart parts.

**Deviations and decisions**
1. **`Env` declares `SqlDb`, not `D1Database`.** This follows README §3 and how port-storage did KV. `D1Database` now appears only in `ports/adapters/cloudflare.ts` (`cloudflareD1`). Limb 9 still allows it in `types.ts` and a composition root, but no Worker has a composition root.
2. **The error classification was not moved.** `isTransientD1Error`, `isUniqueViolation`, `withD1Retry` and `batchIdempotent` stay in `d1.ts`, retyped over `SqlDb`/`SqlStatement`. `ports/sql.ts` re-exports them. The port's methods are exactly what the code calls: `prepare`, `bind`, `first()`, `all`, `run`, `batch`.
3. **The engine is promoted as `SqliteDb` / `sqliteDb`.** The platform harness keeps `RealDb extends SqliteDb`, with its old default schema. The subscriptiontracker-api harness re-exports it as `SqliteD1`.
   - `run()` and `all()` now also return `results` and `meta`, as D1 does.
   - `batch` refuses a statement from another engine with a TypeError; before, that crashed.
   - The subscriptiontracker-api engine now also records the SQL and binds it runs, as the platform one did.
4. **`kind: live`, not `live-readonly`.** `check-d1-accepts-live-sql.mjs` is not read-only: it sends real `DELETE`/`UPDATE` statements bound to a fresh UUID and asserts `meta.changes === 0`. `port.schema.json` gains an optional `conformance.kind` (`suite` | `live`).
5. **The sql port claims L2, not L3.** L3 is not earned: all 10 D1 scenarios are pending. The repo does not run Miniflare or `@cloudflare/vitest-pool-workers`, so the brief's "otherwise" branch applied.
6. **The Cloudflare C-8 seam was not re-seated; the lead needs to decide.**
   - `kv.json`, `objects.json` and `ratelimit.json` (port-storage files) say `c8Seam … until: port-sql`. I left them untouched, so that `until` is now stale.
   - `sql/d1` and Cloudflare's leftover `_non-port.json` row both point at `until: port-c8-cloudflare`, a train name I invented.
   - Everything left of Cloudflare (Workers, Pages, the nikatru.com zone) is a README §7 non-port. The schema requires `until` beside `remaining`, so there was no honest train to name.
7. **The export dry run is a new check C9** in `port-switch.mjs`, implemented in the new `tooling/ops/sql-export-replay.mjs`, with an `--export <file>` flag.
   - The brief's literal command (`sql --to sqlite --dry-run`, default env live) FAILs C1, because sqlite is a fake. The rehearsal command is `--env sandbox --export <file>`.
   - No export fixture is committed. Tests build the export at run time: from the real `dumpD1Database` in the platform suite, and from the migrations in `port-switch.test.mjs`. A committed export would go red on every new migration.
8. **A guard's scope changed and needs review.** `d1-sql-inventory.mjs` now leaves out of its D1 scan only files a `tooling/ports/*.json` registry declares as a `status: fake` adapter's impl. It prints them. Limb 4 already proves no Worker imports them.
9. **Edits beyond the brief, forced by guards:**
   - `chassis-ledger.json`: re-measured brick `types.ts` (90→95) and `erase-subject.ts` (51→52).
   - `d1-fanout.test.mjs`: its quoted `scheduled.ts` text follows the retype.
   - `coverage-manifest.json`: three test-count floors raised (ports 51→53, port-switch 21→27, d1-sql-inventory 57→59).
10. **Brief numbers re-measured at BASE:** 183 `.prepare(` sites in 30 files (the brief measured 178 in 30 at 630dcce4). edge-shield binds no D1 and imports nothing from `_shared`, so only platform and subscriptiontracker-api redeploy. One PR, no split: the type swap is about 60 changed lines over 28 files.
11. **`--no-verify` on the first sandbox wip commit.** No hooks are installed in this sandbox, so it skipped nothing. Nothing was pushed.

**Symbols this depends on, for the apply lane to check survived review**
- From worker-kit:
  - The `services/_shared/package.json` exports `./ports/*` and `./ports/fakes/*`.
  - From `d1.ts`: `withD1Retry`, `isTransientD1Error`, `isUniqueViolation`, `batchIdempotent`, `allRows`, `firstRow`, `run`.
- From port-storage:
  - `ports/adapters/cloudflare.ts`: `cloudflareKv`, `cloudflareR2`, `cloudflareRateLimiter` (this patch adds `cloudflareD1` there).
  - `test/conformance/check.ts`: `same`, `missingFixture`, `Register`.
  - `assert-ports.mjs`: `BINDING_TYPE_RE`, `workerSourceShapes`, `PORTS_HOME`, limb 8's `remaining`/`until` rule.
  - `port.schema.json` `c8Seam`.
  - The `KvStore` imports in the three `types.ts`.
  - The port-storage note on the `chassis-ledger.json` `types.ts` row.
  - `coverage-manifest.json` `ports.test.mjs: 51`.

**Files edited that a parallel train also touches**
- Introduced by port-kv: `ports/adapters/cloudflare.ts` (the brief's patch 1 requires the edit).
- Also modified by port-kv or worker-kit:
  - `assert-ports.mjs` and `ports.test.mjs`
  - `tooling/ports/README.md`, `_non-port.json`, `port.schema.json`
  - `chassis-ledger.json`, `coverage-manifest.json`, `affected-guards`-selected files
  - the three `types.ts`
  - `backup/dump.ts`, `backup/index.ts`
  - `services/_shared/src/d1.ts`
- `kv.json`, `objects.json` and `ratelimit.json` were not touched.

**Draft PR body** (no Rows/Deploys header lines here; they are in the body itself):

~~~markdown
## D1 to L2 of 3: every handler types against a D1-shaped `SqlDb` port, and the node:sqlite test engine becomes the port's second adapter

**HELD for review (user data).** Every D1 read and write in both Workers is retyped, the test engine is moved, and the nightly export gains a replay. The SQL text and query behaviour are unchanged.

Rows: O-CLOUDFLARE-BINDINGS-SCATTERED (this closes the D1 limb)
Deploys: `platform`, `subscriptiontracker-api`. Behaviour is unchanged, so this merges alone. `edge-shield` is not redeployed: it binds no D1 and imports nothing from `services/_shared`.

| # | Patch | Red control |
|---|---|---|
| 1 | `services/_shared/src/ports/sql.ts`: `SqlDb`, `SqlStatement`, `SqlResult`, `SqlMeta`, the methods every `.prepare(` site uses (`prepare`, `bind`, `first()`, `all`, `run`, `batch`). It re-exports `isTransientD1Error`, `isUniqueViolation`, `withD1Retry` and `batchIdempotent`, which stay in `d1.ts`. `cloudflareD1(binding: D1Database): SqlDb` is an identity function proving at compile time that the binding is the port. | `tsc --noEmit` on all three Workers and the stamped brick Worker, with every `Env` D1 member typed `SqlDb` |
| 2 | The `RealDb`/`SqliteD1` test engine is promoted to `ports/fakes/sql.ts` (`SqliteDb`, `sqliteDb`) as adapter `sqlite`. Both harnesses import it and keep the old names for one PR. | Every Worker suite stays green on it: platform 1734 + 1 known red, subscriptiontracker-api 768/768, edge-shield 66/66, brick 227/227 |
| 3 | Type swap over 26 `src` files plus the brick; `D1Database` remains only in `adapters/cloudflare.ts`. Limb 9's pattern gains the D1 types. | `ports.test.mjs`: a fixture handler and the real `lib/erasure-ledger.ts` retyped `D1Database` both exit 1 on limb 9. Removing the D1 types from the pattern turns exactly those two tests red. |
| 4 | Conformance suite `test/conformance/sql.ts` (`runSqlConformance`, 10 scenarios), run on the sqlite engine in every Worker's `npm test`. | `ports-sql.test.ts`: a non-atomic batch fails `batch-is-atomic` and only that; also reds for `undefined` bound as NULL, `bind` mutating in place, every error worded as a reset, UNIQUE reworded, and a fixture with no database |
| 5 | `tooling/ports/sql.json`: `d1` (live; conformance is the credentialled live check, `kind: live`, all 10 scenarios `pending`) and `sqlite` (fake; test and sandbox). Claims L2, target L3. Export duty: the nightly R2 export plus the migrations; only the D1 limits cannot move. | `sql.json` claiming L3 exits 1 on limb 6 |
| 6 | `port-switch.mjs sql --to sqlite --dry-run --env sandbox --export <file>`, new check C9 (`tooling/ops/sql-export-replay.mjs`). It reads one local export, replays the migrations into a node:sqlite file, and compares the table list and row counts; it prints counts only. | An export missing a table FAILs and names it, on the shipped `dumpD1Database` output and via the CLI. Also red: a table no migration creates, a row short of its `table-end`, a cut-off export. |
| 7 | Guards kept honest. `d1-sql-inventory` leaves out only files a registry declares as a `fake` adapter's impl, and prints them. `chassis-ledger` re-measures the brick's `types.ts` (90→95) and `erase-subject.ts` (51→52). The `d1-fanout` test's quoted text follows the retype. Three manifest floors are raised. | The same file registered `built` instead of `fake` is back in the scan and its `.prepare` is reported |
| 8 | This body: `runbooks/switch-vendor.md#sql`. | — |

`assert-ports` prints `sql L2 L2 L3`. L3 is blocked by 10 pending `sql/d1` cases (row O-CLOUDFLARE-BINDINGS-SCATTERED): prepare-bind-first, all-returns-rows, run-reports-changes, bind-returns-a-new-statement, batch-answers-in-order, undefined-bind-is-refused, unique-violation-is-classified, transient-error-is-retried, deterministic-error-is-not-retried, batch-is-atomic. No Worker suite runs on workerd. Running the same suite on workerd (Miniflare or the vitest pool) would earn L3.

### For the Private pass: `runbooks/switch-vendor.md#sql`
1. **Decide.** An ADR names the target (e.g. Postgres/Neon), the reason and the cost delta, and what replaces each D1 ceiling below.
2. **Build.** The target adapter goes behind `SqlDb` with its `runSqlConformance` fixture, no pending cases, and `status: built`.
3. **Dry run.** Download one nightly export from R2 by hand (never in CI) and run `port-switch.mjs sql --to <target> --dry-run --env sandbox --export <file>`. C9 must PASS for `platform_db` and `subscriptiontracker_db`.
4. **Dual run.** Shadow-write to the target; D1 still serves reads; compare outcomes per route.
5. **Cutover.** Move `selection.default.live` to the target and keep `d1` as `standby`. Rollback is one config change.
6. **Retire.** After the run-off, `d1` becomes `retired`, its last export is archived, and the databases are deleted (owner-gated).

Dialect counts, measured 2026-10-02 over comment-stripped `services/*/src` and `services/*/migrations`:

| Construct | src | migrations |
|---|---|---|
| `INSERT OR IGNORE` | 0 | 2 in 1 file |
| `INSERT OR REPLACE` | 1 (the backup restore) | 0 |
| `ON CONFLICT … DO UPDATE` | 15 in 10 files (`excluded.<col>`: 73 in 9) | 0 |
| `ON CONFLICT … DO NOTHING` | 12 in 7 files | 5 in 5 files |
| `strftime(` | 0 | 2 in 1 file (subscriptiontracker-api 0005) |
| JSON functions (`json_array`, `json_group_array`, `json_each`, `json_extract`, `json_valid`) | 15 in 4 files | 0 |
| `rowid` (keyset paging `fix-backup-rowid-paging`, dedup) | 44 in 6 files | 0 |
| `RETURNING` | 4 in 3 files | 0 |
| `pragma_table_info` / `sqlite_master` | 6 in 3 files | 0 |
| `COLLATE NOCASE` | 0 | 1 |

D1 ceilings a new host must match or exceed (`tooling/ceilings.json`):

| Ceiling | Plan of record | Paid |
|---|---|---|
| `d1.queriesPerInvocation` | 50 | 1,000 |
| `d1.maxBoundParametersPerQuery` | 100 | 100 |
| `d1.maxDatabaseSize` | 500 MB | 10 GB |
| `d1.storagePerAccount` | 5 GB | 1 TB |
| `d1.databasesPerAccount` | 10 | 50,000 |
| `d1.rowsWrittenPerDay` | 100,000 | — |

D1's authorizer also refuses some statements; a new host needs a sibling of `check-d1-accepts-live-sql.mjs`.

### Findings recorded, not acted on
- Cloudflare's C-8 seam was not re-seated. `kv`/`objects`/`ratelimit` still say `c8Seam until: port-sql`; `sql/d1` and Cloudflare's leftover `_non-port.json` row point at `port-c8-cloudflare`. Everything left is a README §7 non-port.
- `check-d1-accepts-live-sql.mjs` is not read-only: its writes are bound to a fresh UUID and asserted to change 0 rows. Hence `kind: live`.
- `backup-export.test.ts` "a 100-column table round-trips" is red at BASE on node 22.22 (node:sqlite float precision) and unchanged here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01PqyhSjdaDh9zH7oxnJtWZp
~~~

```
 services/_shared/src/d1.ts                         |  24 ++-
 services/_shared/src/entitlement-read.ts           |   5 +-
 services/_shared/src/erasure.ts                    |  13 +-
 services/_shared/src/ports/adapters/cloudflare.ts  |   9 +
 services/_shared/src/ports/fakes/sql.ts            | 203 ++++++++++++++++++
 services/_shared/src/ports/sql.ts                  |  75 +++++++
 services/_shared/test/conformance/sql.ts           | 226 +++++++++++++++++++++
 services/_shared/test/ports-sql.test.ts            | 137 +++++++++++++
 services/platform/src/backup/dump.ts               |   3 +-
 services/platform/src/backup/index.ts              |   9 +-
 services/platform/src/lib/erasure-ledger.ts        |  17 +-
 services/platform/src/lib/ext-links.ts             |   5 +-
 services/platform/src/lib/mor/bundle-store.ts      |   3 +-
 services/platform/src/lib/mor/cancel-on-delete.ts  |   3 +-
 services/platform/src/lib/mor/store.ts             |  11 +-
 services/platform/src/lib/native-attest/index.ts   |  11 +-
 services/platform/src/lib/platform-erasure.ts      |   5 +-
 services/platform/src/lib/provider-revoke.ts       |   5 +-
 services/platform/src/lib/reminders.ts             |   9 +-
 services/platform/src/lib/report-notify.ts         |   5 +-
 services/platform/src/renewals.ts                  |   5 +-
 services/platform/src/routes/entitlements.ts       |   3 +-
 services/platform/src/routes/money.ts              |   3 +-
 services/platform/src/routes/receipts.ts           |   9 +-
 services/platform/src/routes/reminders.ts          |   3 +-
 services/platform/src/scheduled.ts                 |   3 +-
 services/platform/src/types.ts                     |  11 +-
 services/platform/test/harness.ts                  | 160 ++-------------
 .../platform/test/sql-export-replay-module.d.ts    |  13 ++
 services/platform/test/sql-export-replay.test.ts   |  82 ++++++++
 .../src/lib/erase-subject.ts                       |   3 +-
 .../src/routes/categories.ts                       |   5 +-
 .../src/routes/subscriptions.ts                    |   5 +-
 services/subscriptiontracker-api/src/types.ts      |   9 +-
 services/subscriptiontracker-api/test/harness.ts   | 127 ++----------
 .../{{app_id}}-api/src/lib/erase-subject.ts        |   3 +-
 .../needs_backend}}/{{app_id}}-api/src/types.ts    |   9 +-
 tooling/chassis-ledger.json                        |   8 +-
 tooling/ci/assert-d1-sql-inventory.mjs             |  13 +-
 tooling/ci/assert-ports.mjs                        |  13 +-
 tooling/ci/d1-sql-inventory.mjs                    |  40 +++-
 tooling/ci/test/coverage-manifest.json             |   6 +-
 tooling/ci/test/d1-fanout.test.mjs                 |   4 +-
 tooling/ci/test/d1-sql-inventory.test.mjs          |  42 ++++
 tooling/ci/test/port-switch.test.mjs               |  69 ++++++-
 tooling/ci/test/ports.test.mjs                     |  37 +++-
 tooling/ops/port-switch.mjs                        |  37 +++-
 tooling/ops/sql-export-replay.mjs                  | 167 +++++++++++++++
 tooling/ports/README.md                            |  15 +-
 tooling/ports/_non-port.json                       |   2 +-
 tooling/ports/port.schema.json                     |   5 +-
 tooling/ports/sql.json                             | 170 ++++++++++++++++
 52 files changed, 1491 insertions(+), 368 deletions(-)
```

The patch is also in the sandbox at `/tmp/claude-0/-home-user-repo/9fd71799-7729-5101-befe-f331fab76939/scratchpad/port-sql.patch` (3053 lines). Every blank-looking line inside it is a single-space context line.

