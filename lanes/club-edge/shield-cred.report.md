BASE: 31b0e65d413639259026ccc28253733f1dd9ddf4
HEAD: 81c193a597f5618e08ea0e935db009d9f84f5eb9 (two local wip commits, not pushed; the patch is `git diff --binary BASE`)

Patches 1–4 are drafted, tested and green, and every red control fired. Patch 3's live apply and patch 5 (Box C) could not be done here: there is no token or box access in this sandbox. One thing for the reviewer to decide first: the refresh trade-off is worse than the brief's "1,800 sessions" line says (see the first bullet under Deviations).

| # | Check | Command | Exit | Expected | Result |
|---|---|---|---|---|---|
| 1 | Green control at BASE | `cd services/edge-shield && npx vitest run` | 0 | green | 64/64 |
| 2 | Typecheck at BASE | `npx tsc --noEmit` | 0 | green | ✓ |
| 3 | Zone-rule test at BASE | `node --test tooling/ci/test/edge-ratelimit-rule.test.mjs` | 0 | green | 16/16 |
| 4 | Edge-shield tests, final | `npx vitest run` | 0 | green | 73/73 |
| 5 | Typecheck, final | `npx tsc --noEmit` | 0 | green | ✓ |
| 6 | Wrangler dry run | `npx wrangler deploy --dry-run` | 0 | green | lists all 6 rate-limit bindings |
| 7 | Zone-rule test, final | `node --test tooling/ci/test/edge-ratelimit-rule.test.mjs` | 0 | green | 17/17 |
| 8 | **Red control, patch 2** (patch 1 put back to BASE: `classify.ts`, `types.ts`, `wrangler.jsonc`) | `npx vitest run test/shield.test.ts -t "one client cannot starve"` | 1 | red | 4 fail, each `expected 429 to be 200`; reverted |
| 9 | Red control, patch 3 (rule file at BASE) | rule test | 1 | red | `/auth/v1/token is not in the rule`; reverted |
| 10 | Red control, patch 4 (trade-off and residual headings removed from `_why`) | rule test | 1 | red | "not written down"; reverted |
| 11 | Red control: rule evaluator meets an `ends_with` term | rule test | 1 | red | 2 fail, "cannot read"; reverted |
| 12 | Red control: residual guard (factor cap set to 200) | `npx vitest run test/wrangler-config.test.ts` | 1 | red | "lockable by 6.67"; reverted |
| 13 | Red control: two credential classes share namespace 1110 | same | 1 | red | 2 fail; reverted |
| 14 | Coverage ratchet | `node tooling/ci/assert-guard-coverage.mjs` | 0 | green | wrote 16→17 for the rule test |
| 15 | Affected guards | `node tooling/scripts/affected-guards.mjs --base <BASE> --jobs 8` | 0 | green | 119 green, 0 findings; 7 environmental, all red at BASE too; 1 not runnable here (`services/probeapi-api` exists only in CI) |
| 16 | Shield posture guards | `assert-glitchtip-no-ip`, `assert-no-origin-authz`, `assert-platform-register`, `assert-vendor-portability`, `build-enforcement-index` (check only) | 0 each | green | ✓, no index diff |
| 17 | Platform Worker tests | `cd services/platform && npx vitest run` | 1 | n/a | 1 unrelated `backup-export` failure, also red at BASE |

The 7 environmental reds in row 15 are `assert-app-dod#2`, `assert-ops-register`, `provision-backend`, `assert-clone-contract#1` and `#2`, `lane-verdict` and `worker:platform`.

**Deviations, unknowns and what was not done**
- **Refresh trade-off (reviewer decision).** I read gotrue-dart 2.26.0 `_refreshAccessToken` and package:retry 3.1.2 `delay()`; both versions match `pubspec.lock`.
  - When the origin returns a 5xx (Box C, the tunnel, or the shield's own 503), the SDK re-asks a refresh at 0, 0.4, 1.2, 2.8 and 6.0 s. That is 5 in 10 s, exactly the rule's limit.
  - So one session stays under the limit, but two sessions behind the same address push it over. The 429 that follows signs that user out.
  - 5 password posts from an address also block every refresh from it for 10 s, including other users behind the same NAT.
  - "About 1,800 sessions" holds only as an hourly average; the rule counts in 10-second windows.
  - All of this is written in the rule's `_why`. I also corrected the old "6 per 10 s tick" note in `wrangler.jsonc`: it is 6 attempts over about 12.4 s.
- **Class names** are `auth-password`, `auth-signup-recover` and `auth-factor`, prefixed to match the existing `auth-refresh` and `auth-other`. Limiter keys are `global:<class>`.
- **Caps** are 300/min each; the brief gave no numbers. A smaller share of 300 would let 3–4 addresses lock a class. The cost is that the bcrypt worst case doubles: five colos at both caps fit under the ~57/s estimate, down from ten. This is written down. Namespace ids are 1110, 1112 and 1114; 1102 is retired, and the platform Worker uses 1001–1026.
- **Factor paths in the zone rule** use `starts_with "/auth/v1/factors/"`, an operator the live rule already uses; `matches` needs Business. That prefix also counts factor unenrolment (`DELETE /factors/<id>`), which is harmless.
- **Native sign-in, unknown.** The platform Worker's native-auth forwards token, signup, recover and resend to GoTrue from inside the zone. `tooling/monitor-register.json` says such calls skip the shield. Whether the zone rule counts them, and under whose address, can't be checked here. If it counts them under a Cloudflare address, all native sign-ins in a colo share one 5-per-10 s bucket. That exposure already existed for signup, recover and resend; this change adds `/token`. Verify on the live zone.
- **Not done:**
  - Patch 3's dry run, `--apply` and read-back, and the drift guard against live: there is no `CLOUDFLARE_API_TOKEN` here.
  - Patch 5: there is no Box C access, and this BASE has no vendored override copy in Public, so there was nothing to copy into.
  - Rows and the runbook note: they live in Private.
  - Spec guards: there is no Private corpus here. `preflight.mjs` needs Flutter.
  - The brief has no Dart parts.
- **Shared files:** the brief names none as shared with another train. Expect rebase contention in `tooling/platform-register.json`, `tooling/capability-register.json` (its entries stay on one line, so no line citations move), `tooling/ci/test/coverage-manifest.json` and `docs/ci/deploy-workers.md`.
- I used `--no-verify` once, on the first local wip commit. No hooks are installed here, so it skipped nothing, and nothing was pushed.

```
 docs/ci/deploy-workers.md                         |   6 +-
 services/edge-shield/README.md                    |  16 ++-
 services/edge-shield/src/classify.ts              |  59 +++++++---
 services/edge-shield/src/index.ts                 |   2 +-
 services/edge-shield/src/types.ts                 |   4 +-
 services/edge-shield/test/shield.test.ts          | 137 ++++++++++++++++++++--
 services/edge-shield/test/wrangler-config.test.ts |  24 +++-
 services/edge-shield/wrangler.jsonc               |  55 +++++++--
 tooling/capability-register.json                  |   2 +-
 tooling/ci/test/coverage-manifest.json            |   2 +-
 tooling/ci/test/edge-ratelimit-rule.test.mjs      |  66 ++++++++++-
 tooling/edge-ratelimit-rule.json                  |  48 ++++++--
 tooling/ops/edge-ratelimit-rule.mjs               |   7 +-
 tooling/platform-register.json                    |  24 +++-
 14 files changed, 381 insertions(+), 71 deletions(-)
```

The byte-exact patch file is attached above; check it against the sha256 at the end.

