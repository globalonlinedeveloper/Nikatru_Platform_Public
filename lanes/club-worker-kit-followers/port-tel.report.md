BASE: `ad238205df7297d45f862734fca46bfd426b7fb5`
HEAD: `099c66b1e5df465deeb998578d791f5b037db9c1` (one local commit in the sandbox; nothing was pushed)

The patch builds and its tests pass, apart from failures that are environmental or were already red at BASE. Three things for the local writer before applying:
- **New behaviour on the crash-report path:** I added a rate bound of 30 events a minute in the app's `beforeSend`, so the PII path changes, not just its tests.
- **Box B alerts stay unsent until the owner sets three new Worker secrets:** `NTFY_ALERT_URL`, `NTFY_ALERT_TOKEN`, `ALERT_WEBHOOK_URL`. Until then each outage logs "NOT SENT".
- **No dedicated Box B alarm exists yet:** this patch adds a webhook fallback that survives Box B going down, but it only exists once `ALERT_WEBHOOK_URL` points somewhere off Box B.

**Runs** (every exit code was captured on its own line)

| # | What | Command | Exit | Expected |
|---|---|---|---|---|
| 1 | Worker deps ×3 | `npm ci` in platform, subscriptiontracker-api, edge-shield | 0, 0, 0 | — |
| 2 | Pinned Flutter 3.47.5 | `git clone --depth 1 --branch 3.47.5 …`, `flutter --version`, `flutter pub get --enforce-lockfile` | 0, 0, 0 | `pubspec.lock` unchanged |
| 3 | platform suite | `npx vitest run` | 1 | One failure, `backup-export` 100-column test. It also fails at BASE (checked in a BASE worktree), so it is environmental. 1711 other tests pass, including the new ones. |
| 4 | subscriptiontracker-api suite | `npx vitest run` | 0 | green (748 tests) |
| 5 | edge-shield suite | `npx vitest run` | 0 | green (64 tests) |
| 6 | tsc ×3 | `npx tsc --noEmit` in each Worker | 0, 0, 0 | green |
| 7 | `_shared` sink + notifier tests | `vitest run ../_shared/test/notifier.test.ts ../_shared/test/error-sink.test.ts` | 0 | green |
| 8 | **Red:** `withFallback` never tries the fallback | `vitest run ../_shared/test/notifier.test.ts test/scheduled.test.ts` | 1 | red, 5 failures including "ntfy answers 503 and the fallback receives the alert ONCE"; reverted |
| 9 | **Red:** sentry-envelope answers ok with no DSN | `vitest run ../_shared/test/error-sink.test.ts` | 1 | red (`sentry-envelope · unconfigured`); reverted |
| 10 | **Red:** `services/platform/src/index.ts` imports the adapter | `node tooling/ci/assert-ports.mjs` | 1 | red, limb 4; `telemetry.ts` drops to L1; reverted |
| 11 | **Red:** `verify-monitors.mjs` restored to BASE (calls `fetch` itself) | `node tooling/ci/assert-ports.mjs` | 1 → 0 after revert | red, limb 9 (monitor-api) |
| 12 | **Red:** sink guard before the chain-following fix | `node tooling/ci/assert-worker-error-sink.mjs` | 1 | red, 4 FAILs; then fixed |
| 13 | Dart conformance (sentry + noop) | `flutter test test/sentry_telemetry_client_conformance_test.dart test/noop_telemetry_client_conformance_test.dart` | 0 | green (14 tests) |
| 14 | **Red:** scrubber's e-mail regex matches nothing | `flutter test test/sentry_telemetry_client_conformance_test.dart` | 1 | red: "the email sample … left the device"; reverted |
| 15 | Dart via melos | `melos exec --scope=nikatru_telemetry -- dart analyze`, then `-- flutter test` | 0, 0 | green (70 tests) |
| 16 | Ports guard | `node tooling/ci/assert-ports.mjs` | 0 | telemetry.dart L3/L3, telemetry.ts L2/L2, port L2 |
| 17 | Guard tests | `node --test` on ports (58), port-switch (24), ensure-monitors (26), worker-shared-modules (17) | 0 each | green |
| 18 | No-IP guard test | `node --test tooling/ci/test/glitchtip-no-ip.test.mjs` | 1, then 0 | Its R10/R11 mutations pointed at the old `beforeSend` text, so they stopped mutating anything. Re-anchored, and they now throw if their target text disappears. |
| 19 | Sink guard | `node tooling/ci/assert-worker-error-sink.mjs` | 0 | green |
| 20 | Dry run | `port-switch.mjs telemetry --to sentry --env sandbox --from noop --dry-run` | 0 | C9 plan passes |
| 21 | Dry run, live | `port-switch.mjs telemetry --to sentry --env live --dry-run` | 1 | expected: C7, no standby adapter |
| 22 | Signing-inputs guard | `node tooling/ci/assert-signing-inputs-pinned.mjs` | 1 → 0 | `flutter pub get` created `ephemeral/` dirs in the sandbox; deleted them, then green |
| 23 | Affected guards | `node tooling/scripts/affected-guards.mjs --base ad238205… --budget-s 900` | 0 | 133 green, 0 findings. 5 failed here and also at BASE: worker:platform, assert-ops-register, smoke, assert-app-dod#2, lane-verdict. |
| 24 | Guard coverage (run last) | `node tooling/ci/assert-guard-coverage.mjs` | 0 | green |
| 25 | Secret scan | `node tooling/ci/scan-secrets.mjs .` | 1 | **NOT RUN**: no gitleaks binary here. The PII samples are the allowlisted PAN placeholder and an Aadhaar starting with 1; I grepped the added lines for PAN and Aadhaar shapes and found none. |

**Deviations from the brief, and seams that didn't match**
1. **`_non-port.json` had no `glitchtip` row to drop.** GlitchTip was already the vendor of the `sentry` adapter. Instead, the `sentry-cdn` row (marked "until port-telemetry") now becomes `nonPort: true`, because that egress is closed.
2. **The registry schema and `assert-ports` had to change.** A port had one level and one selection, so "Dart claims 3, the Worker half claims 2" couldn't be expressed.
   - Added `level.byInterface` and `selection.byInterface`; each half is graded over its own adapters, and the port claims and earns the lower half.
   - Limb 8 forbade one vendor across two adapters even in one port. It now places a vendor once per port, and a `draft` adapter places nothing (but the pairing is printed).
   - The "a script calling GlitchTip directly" check is a new limb 9 in `assert-ports`, not a separate guard.
   - Every change has fixture mutations in `ports.test.mjs`, and the README standard is updated.
3. **Callers still reach the sink through a shim.** The body of `_shared/src/error-sink.ts` moved to `_shared/src/adapters/telemetry/sentry-envelope.ts`, and `error-sink.ts` now just re-exports it.
   - Callers still call `reportWorkerError(` through that re-export, because the sink guard's limb 2 reads that call.
   - The re-export is the port's one printed exception (`handTables`, until `port-telemetry-callers`).
   - `worker-shared-modules.mjs` now follows a re-export chain inside `_shared/src`; a cycle or more than 4 hops counts as coverage lost.
4. **No ops script was moved to `notifierFor`.** At BASE no ops script sends an owner alert (no ntfy call in `tooling/ops/*.mjs`). Only `scheduled.ts` `boxbReachability` now pages, through `notifierFor('critical')`.
5. **The monitor-API writer stayed where it was.** Its path is pinned by `credential-origin-exempt.json`, the CodeQL disposition and the credential-origin tests.
   - `tooling/ops/monitor-api/glitchtip.mjs` re-exports it and adds `listMonitors`, moved verbatim out of `verify-monitors.mjs`. Its line citations in `monitor-register.json` (lines 28–34, 31, 106) don't move.
   - `verify-alarm-chains.mjs` is a declared limb-9 exception.
6. **`mail` is declared pending.** port-mail hasn't landed, so the adapter is a `draft`, has a `pending` conformance case, and always refuses.
7. **New vendors and secrets.** The capability register gains `ntfy` and `alert-webhook`, and platform's `Env` gains `NTFY_ALERT_URL`, `NTFY_ALERT_TOKEN` and `ALERT_WEBHOOK_URL`.
8. **Not done:**
   - edge-shield has no code change.
   - No `sentry-saas` adapter row exists, so the dry run is shown against existing adapters.
   - The Worker-side suite is vitest helpers, not the port's registered suite. That is why the TS half honestly earns L2.
9. **Other edits the run forced:** `coverage-manifest.json` floors rose (affected-guards rewrote them); the no-IP test was re-anchored (row 18). The sandbox's Flutter rewrote `analysis_options.yaml` files and created `ephemeral/` directories; I reverted and deleted those, and none are in the patch.
10. **Files shared with other trains:**
    - port-foundation: `tooling/ports/*`, `assert-ports.mjs`, `port-switch.mjs` and their tests.
    - worker-kit: `services/_shared/src/error-sink.ts`, `services/_shared/test/error-sink.test.ts`, `tooling/ci/worker-shared-modules.mjs`.
    - Also: `tooling/capability-register.json`, `services/platform/src/{scheduled,types}.ts`, `assert-worker-error-sink.mjs`, `ensure-monitors.test.mjs`, `glitchtip-no-ip.test.mjs`.
11. **Kit pieces this patch depends on:**
    - `_shared/src/error-sink.ts` and its exports: `reportWorkerError`, `buildEnvelope`, `parseDsn`, `scrubPath`, `reportablePath`, `requestSinkContext`, `SinkContext`, `MatchedRoute`, `SinkRequest`.
    - The `_shared/package.json` exports `./ports/*` and `./ports/fakes/*`.
    - Each Worker's vitest `include` of `../_shared/test/**`, and the `setupFiles` entry `../_shared/test/no-network.ts`.
    - Each Worker's tsconfig include of `../_shared/src/**`.
    - `sharedHomeOf` and `workerModuleSource` in `worker-shared-modules.mjs`.
    - `carrier-parity.test.ts` and `shared-home.test.ts`, which both pass.
12. The PR body draft is in the scratchpad at `pr-body.md`, along with a copy of the patch, `port-telemetry.patch`. In the patch, blank context lines are a single space.

```
 packages/telemetry/lib/nikatru_telemetry.dart      |   1 +
 .../telemetry/lib/src/telemetry_bootstrap.dart     |  71 ++--
 .../telemetry/lib/src/telemetry_rate_bound.dart    |  58 ++++
 packages/telemetry/lib/testing.dart                | 371 +++++++++++++++++++++
 .../noop_telemetry_client_conformance_test.dart    |  26 ++
 .../sentry_telemetry_client_conformance_test.dart  | 108 ++++++
 .../_shared/src/adapters/telemetry/notify-mail.ts  |  24 ++
 .../_shared/src/adapters/telemetry/notify-ntfy.ts  |  53 +++
 .../src/adapters/telemetry/notify-webhook.ts       |  47 +++
 .../src/adapters/telemetry/sentry-envelope.ts      | 300 +++++++++++++++++
 services/_shared/src/error-sink.ts                 | 307 +----------------
 services/_shared/src/ports/fakes/telemetry.ts      |  39 +++
 services/_shared/src/ports/telemetry.ts            | 152 +++++++++
 services/_shared/test/error-sink.test.ts           |  62 +++-
 services/_shared/test/notifier.test.ts             | 178 ++++++++++
 services/_shared/test/telemetry-conformance.ts     |  75 +++++
 services/platform/src/ports.ts                     |  47 +++
 services/platform/src/scheduled.ts                 |  25 +-
 services/platform/src/types.ts                     |  13 +
 services/platform/test/scheduled.test.ts           |  45 +++
 tooling/capability-register.json                   |  52 +++
 tooling/ci/assert-ports.mjs                        | 197 +++++++++--
 tooling/ci/assert-worker-error-sink.mjs            |   7 +-
 tooling/ci/test/coverage-manifest.json             |   8 +-
 tooling/ci/test/ensure-monitors.test.mjs           |  63 ++--
 tooling/ci/test/glitchtip-no-ip.test.mjs           |  16 +-
 tooling/ci/test/port-switch.test.mjs               |  38 +++
 tooling/ci/test/ports.test.mjs                     | 172 +++++++++-
 tooling/ci/test/worker-shared-modules.test.mjs     |  39 +++
 tooling/ci/worker-shared-modules.mjs               |  31 +-
 tooling/ops/ensure-monitors.mjs                    |   2 +-
 tooling/ops/monitor-api/fake.mjs                   |  72 ++++
 tooling/ops/monitor-api/glitchtip.mjs              |  48 +++
 tooling/ops/monitor-api/index.mjs                  |  16 +
 tooling/ops/port-switch.mjs                        |  94 +++++-
 tooling/ops/set-monitor-thresholds.mjs             |   2 +-
 tooling/ops/verify-monitors.mjs                    |  22 +-
 tooling/ports/README.md                            |  25 +-
 tooling/ports/_non-port.json                       |   2 +-
 tooling/ports/port.schema.json                     |  53 ++-
 tooling/ports/telemetry.json                       | 300 +++++++++++++++--
 41 files changed, 2845 insertions(+), 416 deletions(-)
```

