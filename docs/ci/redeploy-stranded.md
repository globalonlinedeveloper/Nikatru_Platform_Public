# `redeploy-stranded.yml`

The prose behind `.github/workflows/redeploy-stranded.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains or
records a measurement is here. Read `docs/ci/README.md` first — it carries the
rules every workflow in this repository has to obey.

## What it closes

**O-CI-GATE-CASCADE-STRANDS-THE-DEPLOY-LANES.** `deploy-web.yml` and
`deploy-workers.yml` each start on a push to main and, before deploying, run
`tooling/ci/assert-gate-passed.mjs`, which fails the run when `ci-gate` for the
same commit is red. That is correct: a red gate must not deploy. The defect was
what happened next.

On 2026-09-22 PR #875 merged as `2c4540fa`. `CI on main` #3667 went red on a
sitemap `<lastmod>` date; `Deploy web` #426 and `Deploy workers` #168 both failed
on their gate step. The site-drift repair then merged `35147514`, which changed
only `sites/nikatru/sitemap.xml`, and `CI on main` #3669 was green. That path
matches neither lane's `push: paths:`, and neither lane had any other trigger, so
**nothing re-entered them**. The app bundle and both Workers stayed on the
previous build while every merge-path check read green, until a scheduled Ops
watch noticed.

⚠️ **It was not a same-SHA case.** `ci-gate` never went green on `2c4540fa`; it
went green on the next commit. "Re-run the deploy for the SHA CI just passed"
would have done nothing that night.

## How it re-enters a lane

On every completion of `CI`, `Deploy web`, `Deploy workers` or `Build apps` on
main, `tooling/ops/redeploy-stranded.mjs` reads main's head and its `ci-gate`
check-run. If that is green, for each lane it reads the lane's **newest** push,
dispatch or schedule run on main and:

| the newest run | action |
|---|---|
| failed, at least one job failing FIRST on the gate step, every other failed job either doing the same or a **consequence job**, at head, attempt 1 | re-run its failed jobs through `tooling/ops/safe-rerun.mjs --failed` |
| the same, at an ancestor of head | dispatch the lane on main |
| anything else | nothing |

A **consequence job** has a job-level `if:` holding `always()` and needs the
gate job, directly or through other jobs. It runs after a red gate and fails
because the gate did, so it is never read as a second fault. Build apps has one,
`all-platforms`, the aggregate the channel register names as `aggregatingJob`.
The deploy lanes have none: their `always()` conditions are on steps.

Why a dispatch at head is safe depends on what starts the lane:

- **A push lane** (`deploy-web.yml`, `deploy-workers.yml`). Dispatching on main
  deploys exactly what was stranded: every commit between the stranded one and
  head matched none of the lane's `push: paths:` (else the lane would have a
  newer run, and that run would be the one read). `deploy-workers.yml` deploys
  both Workers on a dispatch; redeploying an unchanged Worker is idempotent, and
  it is what the hand remedy did on 2026-09-22.
- **A cadence lane** (`build-platforms.yml`: GitHub's Mon/Thu schedule and the
  Worker's 84-hour dispatch). It has no push trigger, so the paths argument does
  not exist, and it is not needed. The lane's job is to build main's head each
  slot, so the dispatch at head is exactly what the next slot would do. Nothing at
  the stranded SHA can be recovered: `ci-gate` there stays red, so a re-run fails
  its gate again. And on a branch ref the lane publishes nothing, because every
  publish step is tag-only (`CANONICAL_PUBLISH_IF` in
  `tooling/ci/assert-release-durable.mjs`).

`schedule` is in the newest-run set so that a cron run which went green after a
failed Worker dispatch supersedes it. Without it the old failure would read as
the newest run, and an old run would be re-entered.

The lanes' own completions are in the trigger because of a race: if a lane's gate
step fails *after* CI at a later commit already went green, CI's completion has
already been heard. The lane's failure is then what fires the check.

## What it never does

Each of these is a red control in `tooling/ci/test/redeploy-stranded.test.mjs`.
Each is asserted through the pure decision **and** through the CLI, where the
fixture action log must not exist:

- It never re-enters a run that failed on a real deploy step, or on no step at
  all (runner loss, timeout).
- It never acts while `ci-gate` at head is red, running or absent.
- It never re-runs an old run once a newer one exists. That would roll
  production back.
- It never re-runs a same-SHA run already on attempt 2 or later. A gate step
  that fails twice over a green `ci-gate` is a fault for someone to read, not a
  cascade.
- It never acts on a run whose SHA is not an ancestor of head.
- It never treats a consequence job's failure alone as a strand. At least one
  job must have failed on the gate step itself.
- It never re-enters a workflow whose dispatch takes inputs, or one the channel
  register names as a store-submission workflow (below).

## The lane set is derived, never listed

A workflow with a **named** step running `tooling/ci/assert-gate-passed.mjs` is a
lane when all four of these hold:

| limb | the rule | why |
|---|---|---|
| L1 | `workflow_dispatch`, and a `push` listing `main` or a `schedule` | it runs on main without anyone asking, so a strand goes unnoticed |
| L2 | `workflow_dispatch:` declares no `inputs:` | the re-entry POSTs `{ref:'main'}` and nothing else, so a lane with inputs is never reproduced by it. Inputs are how every store publish takes the owner's word (`assert-publish-steps-guarded.mjs`), so this limb alone keeps every publisher out |
| L3 | no job holding the gate step has a job-level `if:` | a conditional gate means a strand on one event says nothing about another |
| L4 | no `channels[].submission.workflow` in `tooling/channel-register.json` names it | closes the one hole L2 leaves: an input-less dry-run submitter, such as `submit-appstore.yml`, that someone gives a schedule |

On today's tree that is `build-platforms.yml`, `deploy-web.yml` and
`deploy-workers.yml`. `extensions.yml` fails L2, L3 and L4; every `submit-*.yml`
fails L1 and L4; `symbolication-proof.yml` fails L1 alone, and a test pins that
giving it a schedule derives it, so that change is seen.

The tool exits 2 (could not look) if any of these holds:

- the recovery workflow's `workflow_run.workflows` differs from `CI` plus the
  derived lanes' names, in either direction;
- a gate step has no name;
- `tooling/channel-register.json` cannot be read, so L4 cannot be applied;
- no lane derives at all.

The test holds the list against the real tree. Its mutations drop a lane from the
trigger, add a gated lane that nobody added to it, and break each of L1–L4 on
its own.

## Scheduled and Worker-dispatched lanes

**O-REDEPLOY-STRANDED-MISSES-THE-BUILD-LANE, 2026-09-23.** Build apps #102 (run
`35800063831`, the Worker's 00:00Z dispatch at `c1cdb241`) failed on its gate
step and nothing re-entered it. Two things stopped the tool, and both had to be
fixed:

1. The derivation took only lanes that push on main, and Build apps has no push
   on main (its push trigger is tags only).
2. The run had a second failed job, `all-platforms`, which failed on "Require
   every platform green" because the gate did. The old rule refused any run with
   a failed job that did not fail on the gate step.

`extensions.yml` stays out, and that is correct. Its scheduled run and its
default dispatch (`lane=ci`) never reach its gate. The only run on main that
can strand is an owner's `lane=release` dispatch, whose inputs a bare
re-dispatch would drop. Its register row heals at the next daily 20:53 run.

⚠️ **A recovery dispatch does not refresh the platform proof.**
`assert-platform-proof-fresh.mjs` wants a SCHEDULED green within 14 days. A
dispatch clears the RED-SINCE alarm, but only a same-SHA re-run of a `schedule`
run, which keeps `event=schedule`, or the next cron refreshes the proof. That is
by design.

## `workflow_run`, and the zizmor acknowledgement

zizmor's `dangerous-triggers` audit flags every `workflow_run`. The danger is
checking out or evaluating the triggering run's untrusted head. None of that
happens here:

- no expression reads `github.event`;
- the checkout is the default branch, with `persist-credentials: false`;
- the only code run is this repository's own script, from main.

The `# zizmor: ignore[dangerous-triggers]` sits on the trigger itself, where it
applies.

## Exit contract

- `0`: every lane was read, and each one was re-entered or had nothing stranded.
- `1`: a stranded lane's re-entry was refused, or GitHub rejected it.
- `2`: it could not look. That covers a missing token, an unreadable answer, an
  unreadable channel register, a derivation problem, or a trigger/lane mismatch.
