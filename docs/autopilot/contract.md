# The autopilot failover contract

The data is `tooling/autopilot/contract.json`; this page is its prose.
`tooling/ci/test/autopilot-contract.test.mjs` fails when this page names a value the JSON does
not hold, and when any `tooling/autopilot/*.mjs` hard-codes a label or threshold instead of
importing it. The lane queue half of the same file is described in [`queue.md`](queue.md).

## The design in one paragraph

The laptop stays **primary**. It writes a heartbeat every 10 minutes. Four claude.ai routines
in the cloud (reviewer, two runners, fixer) act **only** when that heartbeat is older than
`HEARTBEAT_STALE_MIN`, and stand down when it is fresh. Merges are always made by `land.yml`.
While the laptop is provably off, its scheduled duties are graded DEGRADED rather than red
(`assert-ops-register.mjs`, through `outageGrade` in `tooling/autopilot/heartbeat.mjs`).

## The heartbeat

- Ref `lead/heartbeat` in the Public repo, holding one parentless commit whose tree is one file,
  `beat.json`:
  `{"v":1,"at":"<ISO UTC>","seq":<int>,"mode":"primary|handover|drill","host":"laptop"}`.
- Written by `node tooling/autopilot/heartbeat.mjs write --loop 600 --mode primary` on the
  laptop (its own `gh` auth; git data API: tree, parentless commit, forced ref).
- Read by `node tooling/autopilot/heartbeat.mjs read` from anywhere: a shallow fetch of the ref,
  or the REST contents API with an optional token.

| Threshold | Value | Meaning |
|---|---|---|
| `HEARTBEAT_STALE_MIN` = 30 | minutes | STALE_MIN: a beat older than this is an outage |
| `FUTURE_SKEW_MIN` = 5 | minutes | a beat further in the future than this is `unknown` |
| `DEGRADED_MAX_H` = 72 | hours | past this, the offsite backup duty is red again |
| `CALL_CEILING_S` = 60 | seconds | each `gh` / `git` call the heartbeat makes |
| `LOOP_S` = 600 | seconds | the writer's default loop |

The states, read by `laptopState(beat, now)`:

| Reading | State |
|---|---|
| `mode=handover` | `handover` |
| age > STALE_MIN, `mode=drill` | `drill-stale` |
| age > STALE_MIN | `stale` |
| age ≤ STALE_MIN | `fresh` |
| missing, garbled, or `at` more than `FUTURE_SKEW_MIN` in the future | `unknown` |

`unknown` is never an outage: every consumer does what it does with the laptop up.
`drill-stale` makes the routines DRY (they comment on the Private-repo `drill` issue and change
nothing else). `read` exits 0 fresh, 10 stale, 11 handover, 12 drill-stale, 2 unknown.

## Claim staleness

| Threshold | Value | Whose claim |
|---|---|---|
| `CLAIM_STALE_H` = 6 | hours | a lane claim on a Private queue issue |
| `REVIEW_CLAIM_STALE_H` = 2 | hours | a `REVIEWING` comment on a PR |
| `FIX_CLAIM_STALE_H` = 3 | hours | a `FIXING` comment on a `land-freeze` issue |
| `CLAIM_SETTLE_S` = 90 | seconds | the wait before a lane claim is re-read |
| `RUNNER_INFLIGHT_MAX` = 3 | lanes | fresh cloud-runner claims in flight at once |
| `HOUSEKEEPING_MAX_OPS` = 20 | writes | the queue's housekeeping cap (queue.md) |

## Labels

Public pull requests: `land-ok`, `land-hold`, `needs-review`, `review:approve`,
`review:changes`, `fix-first`.

Public issues: `land-freeze`, `laptop-off`, `e2e-hold` (a known E2E red being fixed: the
watch dispatches no E2E run while one is open).

Private queue issues (see queue.md): `cloud-lane`, `ready`, `blocked`, `claimed:<id>`,
`pr-open`, `done`, `failed`, `prio:<p>`, `acct:<n>`, `drill`.

## The watch (`.github/workflows/autopilot-watch.yml`)

| Threshold | Value | Meaning |
|---|---|---|
| `STALL_H` = 6 | hours | an open, green, ready PR with no `land-ok` this old is a STALL |
| `LEDGER_WINDOW_H` = 12 | hours | the run ledger lists every run that ended red in this window |
| `LEDGER_BODY_CAP` = 60000 | characters | the ledger issue body; the oldest rows are dropped first |
| `E2E_DISPATCH_MIN_GAP_MIN` = 30 | minutes | at most one E2E-after-deploy dispatch per this gap |

## Routines

| id | account | minute past the hour |
|---|---|---|
| `reviewer` | Acct1 | :05 |
| `runner-a` | Acct3 | :20 |
| `fixer` | Acct3 | :35 |
| `runner-b` | Acct1 | :50 |

Each routine's bootstrap reads its prompt from `docs/autopilot/` at origin/main on every run, so
a merged prompt change takes effect at the next slot.

`pipelineDriverFallback`: false — the runners never pick pipeline work from the Private
platform-state on their own.

## The outage rule (ops grading)

A `duty.laptop.*` row that the record-query limb grades FAILING is DEGRADED — a `::warning`, a
summary line `laptop off since <at> (<h> h): <row> degraded`, and not a problem — only when:

1. the heartbeat state is `stale` or `handover` (positive evidence), and
2. the row's staleness began (its newest success plus its window) no earlier than the beat's
   `at` minus one row cadence: an outage does not excuse an older failure.

`duty.laptop.nikatru-daily-backup` is red again past `DEGRADED_MAX_H` of outage. Every other
state, and every non-laptop row, is graded exactly as before. Every scheduled `duty.laptop.*`
row names its outage home in `outage: { cloudTwin, laptopOnly }`.
