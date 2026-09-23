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

On every completion of `CI`, `Deploy web` or `Deploy workers` on main,
`tooling/ops/redeploy-stranded.mjs` reads main's head and its `ci-gate`
check-run. If that is green, for each deploy lane it reads the lane's **newest**
push or dispatch run on main and:

| the newest run | action |
|---|---|
| failed, every failed job failing FIRST on the gate step, at head, attempt 1 | re-run its failed jobs through `tooling/ops/safe-rerun.mjs --failed` |
| the same, at an ancestor of head | dispatch the lane on main |
| anything else | nothing |

Dispatching on main deploys exactly what was stranded: every commit between the
stranded one and head matched none of the lane's `push: paths:` (else the lane
would have a newer run, and that run would be the one read). `deploy-workers.yml`
deploys both Workers on a dispatch; redeploying an unchanged Worker is
idempotent, and it is what the hand remedy did on 2026-09-22.

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

## The lane set is derived, never listed

A deploy lane is any workflow with `push` on `main`, `workflow_dispatch`, and a
**named** step running `tooling/ci/assert-gate-passed.mjs`. The tool exits 2
(could not look) if any of these holds:

- the recovery workflow's `workflow_run.workflows` differs from `CI` plus the
  derived lanes' names, in either direction;
- a gate step has no name;
- no lane derives at all.

The test holds the list against the real tree. It also checks two mutations: a
lane dropped from the trigger, and a third gated lane that nobody added to it.

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
- `2`: it could not look. That covers a missing token, an unreadable answer, a
  derivation problem, or a trigger/lane mismatch.
