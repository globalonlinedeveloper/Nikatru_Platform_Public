# Name clearance — the decision, and where it is enforced

**Landed 2026-09-09.** This is the public half of the record. The ADR that locks
it belongs in `Private/decisions/`, and the row that owes the owner ruling
belongs in `Private/platform-state/open.json`; both are **owed** and named at the
bottom of this page, because the branch that landed this mechanism had the
private corpus read-only.

⏱ **2026-09-24:** neither is owed now. Both are retired in § 8, and the owner's
trademark ruling is in the record itself.

---

## 1. What happened, and why a person cannot be the check

On 2026-09-09 the Microsoft Partner Center **reserve a name** dialog was open on
**Subly**, one click from starting a three-month submit-or-lose clock.

Subly is a name iOS and macOS **can never ship under**. App Store names are
**globally unique**, and the iTunes Search API returns two live listings carrying
that exact name — one of them in **Finance**, the same category:

```
"Subly" — Kaizhi Liu            — Lifestyle — apps.apple.com/us/app/id6471869381
"Subly" — MAXENCE GUY H. LANONE — Finance   — apps.apple.com/us/app/id6760964796
+ 27 near-miss listings containing the word
```

`subscriptiontracker.app` also resolves to a live commercial site selling a same-category
product on Windows, macOS and Linux.

Reserving the name would have committed half the platforms to a name the other
half refuses. Nothing in the factory would have noticed. **The owner asked for
this to be handled by the pipeline rather than by someone remembering.**

## 2. The rule: three answers, never two

`PROVEN-TAKEN` · `PROVEN-FREE` · `UNDETERMINED`. **"Not found" is not "free."** A
store search page that renders in JavaScript returns an empty body to a `fetch`;
an unauthenticated 404 can mean free, reserved-but-unpublished, rate-limited or
down. Collapsing those into "clear" is worse than no check, because it also
carries the belief that something was checked.

**Every probe declares a RED CONTROL** — a query with a known non-empty answer,
same transport, same run. If the control does not go green the probe downgrades
**itself** to `UNDETERMINED`. The five controls, each verified live on
2026-09-09, are listed in `tooling/store/name-probes.mjs`.

Three answers this design refuses to fake:

- **Apple has no name-availability endpoint.** The only authority is the App
  Store Connect New App dialog, and asking it means *creating a record*, which is
  forbidden. A no-hit is `UNDETERMINED` with the manual step named.
- **Microsoft's only authority is the reservation itself.** Owner-only, manual,
  and cancelled without reserving.
- **A snap name registered-but-unpublished 404s identically to a free one.**
  `UNDETERMINED`, with `snapcraft register --dry-run` named.

## 3. The split: a slow tool, a fast guard

| Unit | Measured on this machine, 2026-09-09, wall clock | Network |
|---|---|---|
| `tooling/store/name-clearance.mjs` (the 12-channel probe) | 15,365 ms / 13,726 ms, two samples, warm | ~20 external calls |
| `tooling/ci/assert-name-clearance.mjs` (reads the record) | 297 / 285 / 269 ms, three samples, warm | **none** |

Fourteen seconds of network on every commit gets bypassed inside a week, and a
guard that is skipped is worth less than no guard. **So the probe is a tool you
run and the guard is the thing that blocks the build.** The guard is wired into
`ci.yml#guards-store` *and* into the pre-commit spec-guard runner — it is the
first entry in that array with `needsPrivate: false`, because its subject is
public.

## 4. Where each piece lives

| File | What it is |
|---|---|
| `tooling/store/name-clearance.mjs` | the probe; walks `tooling/channel-register.json`, calls `tooling/ci/read-identity.mjs`, writes the record under `--execute` |
| `tooling/store/name-probes.mjs` | the per-channel probe table and its red controls |
| `contracts/name-clearance.schema.json` | the record shape |
| `apps/<app>/name-clearance.json` | the record — a measurement with a date |
| `tooling/ci/assert-name-clearance.mjs` | the offline guard |
| `tooling/ops/name-clearance-sweep.mjs` | the re-verification routine |

**The identity readers are reused, not rewritten.** `read-identity.mjs` already
resolves the *file* for each identity from the register — which is why it reads
the macOS xcconfig rather than the pbxproj that carries only the **test** bundle's
id — and already answers `{value} / {missing} / {lost}`, where `lost` means
COVERAGE LOST. A second reader would inherit none of its tests and would report
agreement between two things it read wrongly.

## 5. Why `main` is green while the record says BLOCKED

The record for Subly is honestly `overall: "BLOCKED"`. The build is not red, and
the reason is **derived, not waived**:

- The guard weighs every wall against `tooling/ci/channel-arming.mjs`, the
  existing single reading of *"can this channel reach a user today?"*
  (`served: true`, or `submittable: true` with a real lane). When Subly was
  measured, `ios-appstore` and `macos-appstore` were `served: false` with
  `lane: null`, so the finding was **printed on every run** as
  `⬜ NOT BLOCKING TODAY` and did not block. ⏱ 2026-09-24: that was the arming
  on the day of the Subly run, and this section describes that record. Which
  channels are armed now is not restated here: `channel-arming.mjs` reads it
  off the register on every run, and the guard prints what it weighed.
- **It arms itself.** Flip `served` on that channel and the same unchanged record
  turns the guard red. That is asserted by mutation in
  `tooling/ci/test/assert-name-clearance.test.mjs` case **M3**: exit `0 → 1`.
- `trademark.ruling: null` reads as **QUALIFIED, never a pass**, and prints as
  FAILING every run. Only its *block* is lifted, and only while a named owner
  item and a dated `gatedUntil` both stand — **2026-10-09**, after which it
  blocks. `--execute` **preserves** that date rather than rewriting it, so a
  re-probe can never extend its own gate.
- ⏱ **2026-09-24:** the owner's ruling is recorded — `PROCEED`, 2026-09-09,
  `basis: "ADR 074"` — so the record carries no gate. That gate had held on
  `O-NAME-SUBLY-TRADEMARK`, a row that was never opened (§ 8, item 2).
  `tooling/scripts/assert-public-citations.mjs` now refuses a hold on a row that
  does not exist, and limb 7 refuses a ruling without `ruledBy`, a dated
  `ruledOn` and a `basis`.

## 6. Staleness

Not a second mechanism: `assert-platform-state.mjs`'s, verbatim — every fact is a
`{value, asOf, verify, verifyKind}` triple, `verifyKind: "remote"` (which is
precisely what tells a hook not to dial out), and a **30-day** ceiling. Age is a
**warning in the hook** and a **finding under `--execute`**, because every record
shares a birthday and a hook that refuses every commit on the day the window
closes is a hook this corpus has recorded itself skipping.

## 7. What this does not do

- It cannot prove a name is free on Apple. No software can, short of creating a
  record.
- It cannot clear a trademark. It gathers signals and demands a dated owner
  ruling. **It is not legal advice.**
- It cannot see drafts in anyone's Play Console, Partner Center or App Store
  Connect — including a reservation a competitor made this morning.

The value is not that it answers everything. It is that **it never claims to have
answered something it did not**, and it makes the difference visible on every
build.

## 8. Still owed

1. ~~**`Private/decisions/074-name-clearance-is-a-pipeline-step.md`** (does not exist yet — owed 2026-09-09, and the next free number was 074 on that day) — the ADR, with its row in `Private/decisions/index.json`.~~
   **(retired 2026-09-24, never written.)** Number 074 went to the owner's
   store-name decision of 2026-09-09, and the mechanism's reasoning lives on this
   page, in the guard's header and in the probe's. Retired by the parent under the
   owner's 2026-09-23 delegation.
2. ~~**`Private/platform-state/open.json`** — one row:~~
   **(retired 2026-09-24, never opened.)** The ruling this row would have owed is
   recorded in `apps/subscriptiontracker/name-clearance.json`: `PROCEED`, by the
   owner, 2026-09-09, `basis: "ADR 074"`. ADR 074 is read as the ruling by the
   parent (2026-09-24, under the owner's 2026-09-23 delegation). The record held
   its gate on this id for fifteen days while the row did not exist — apps-review
   F1. The proposal is kept below as it was written:
   ```json
   {
     "id": "O-NAME-SUBLY-TRADEMARK",
     "owner": "owner",
     "state": "open",
     "closedOn": null,
     "severity": "red",
     "what": "Rule on the Subly name. MEASURED 2026-09-09 by tooling/store/name-clearance.mjs: two live iOS listings carry the exact name (one in Finance, the same category) and App Store names are globally unique, so iOS and macOS can never ship under it; subscriptiontracker.app resolves to a live commercial site selling a same-category product on Windows/macOS/Linux. Software cannot clear a trademark — this needs a dated owner ruling.",
     "blocks": "reserving the name on any store, and the first iOS/macOS submission",
     "due": "2026-10-09",
     "closes": "apps/subscriptiontracker/name-clearance.json carries trademark.ruling PROCEED or DO-NOT-PROCEED with ruledBy and ruledOn set",
     "source": "docs/name-clearance.md; the clearance record apps/subscriptiontracker/name-clearance.json",
     "note": "tooling/ci/assert-name-clearance.mjs PRINTS this as FAILING on every run and lifts the block only until trademark.gatedUntil (2026-10-09), after which the build fails."
   }
   ```
3. **The weekly routine's workflow.** `tooling/ops/name-clearance-sweep.mjs` is
   landed and tested; `.github/workflows/name-clearance.yml` is **not**, because
   `assert-ops-register.mjs` holds `watched workflows ≡ .github/workflows/*.yml`
   in both directions and the duty row it would need lives in
   `tooling/ops/register.json`, which carried another writer's uncommitted edit
   when this landed. The workflow and its duty row must land **together**, in one
   commit:
   ```yaml
   # .github/workflows/name-clearance.yml — weekly, 07:10 UTC Mondays
   on: { workflow_dispatch: {}, schedule: [{ cron: '10 7 * * 1' }] }
   permissions: {}
   jobs:
     sweep:
       runs-on: ubuntu-24.04
       timeout-minutes: 15
       permissions: { contents: read }
       steps:
         - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
           with: { persist-credentials: false }
         - uses: ./.github/actions/setup-node
         - run: node tooling/ops/name-clearance-sweep.mjs
   ```
   with a `kind: "duty"` row in `tooling/ops/register.json` anchored at
   `.github/workflows/name-clearance.yml`, `cadence: "7d"`, whose `detector` is
   the flip report this script prints and whose `absenceWatcher` is `ops-watch`.

   ⏱ **2026-09-24: still owed, and not retired with items 1 and 2.** Neither
   `.github/workflows/name-clearance.yml` nor a name-clearance row in
   `tooling/ops/register.json` exists, and no workflow calls
   `tooling/ops/name-clearance-sweep.mjs`, so the weekly re-verification runs
   only when somebody runs it.

   **LANDED 2026-09-24**, in #923, which added
   `.github/workflows/name-clearance.yml` (O-NAME-CLEARANCE-SWEEP-RUN-BY-NOTHING).
   **Where the records go:** the workflow runs the sweep every Monday at 07:10
   UTC and lands the rewritten `apps/*/name-clearance.json` on `main` by pull
   request, the `site-drift-repair.yml` pattern: branch
   `chore/name-clearance-<run_id>` pushed with the job's own token, the patch
   uploaded as the run's artifact before the proposal, the pull request opened as
   the `RENOVATE_TOKEN` actor so `ci-gate` runs on it, and any changed path outside
   those records refusing the proposal. **When it merges itself:** only when no
   verdict flipped; a flip opens the pull request without auto-merge, its body
   leading with the flip lines, and turns the run red, COVERAGE LOST proposes
   nothing and exits 2, and `writeRecord` carries the owner's five trademark
   fields over every rewrite (`tooling/ci/test/name-clearance.test.mjs` D6).
   **The duty row:** `duty.workflow.name-clearance.yml`, a 7d `github-run-history`
   read of the scheduled runs on `main`, with a `firstDue` bootstrap until the
   first Monday run succeeds; the cron is weekly rather than TRAPS ci-19's daily
   because every run with a changed record opens a pull request, so one missed or
   red Monday puts that row past its 252h window. **The ceiling, daily:**
   `ops-watch.yml` runs `assert-name-clearance.mjs --execute` as a step of its
   `heartbeats` job, a step and not a job because a new job joins a duty row's
   unit and every earlier run lacks it; `ci.yml` still runs the guard without
   `--execute`.

⏱ **2026-09-24 — HELD, `--for-submission` and a generated `_why`.** **HELD** is the
owner's record that the name is reserved in a store's own console, which no probe can
see. Only the owner sets it, offline: `node tooling/store/name-clearance.mjs --hold
<channel> --record <store record id> --app <slug>`, and `--execute` carries it
forward. A submit lane runs `assert-name-clearance.mjs --for-submission=<channel>`
(limb 10): only PROVEN-FREE, or HELD with its store record id, passes there, and an
unruled trademark is fatal. `_why` is generated by `name-clearance-why.mjs` on every
write, limb 11 refuses any other text, and `--why --app <slug>` regenerates it offline.
