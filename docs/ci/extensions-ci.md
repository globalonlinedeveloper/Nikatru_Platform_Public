# `extensions-ci.yml`

The CI lane of the extensions subtree, as a reusable workflow (`on: workflow_call`
only). Its jobs are documented where they were measured, in
[`extensions.md`](extensions.md); this page says why the lane is a separate file
and how it is required. Read [`README.md`](README.md) first.

## Why a separate file (2026-09-24, O-EXTENSIONS-CI-REQUIRED-GATES-NOTHING)

Branch protection requires exactly one check, `ci-gate`, from ci.yml. Until this
change no ci.yml job ran anything in extensions.yml, so every extension CI result
was advisory: a red `ci-required` blocked no merge. Worse, a Renovate pull request
gets an `opened` run and a `labeled` run in one concurrency group; the labeled run
cancelled the opened one and then skipped the whole CI lane (measured on #861 at
`7dc3ea62`: run 35577917685 cancelled, run 35577917859 green in 49 s). `build-free`
and `contracts` sat outside `ci-required` altogether.

Requiring `ci-required` as a second check would not have closed it: a skipped job
reports Success, and the lane was skipped on exactly the labeled runs. So the lane
moved into this file, and ci.yml calls it:

```yaml
  extensions:
    name: extensions
    uses: ./.github/workflows/extensions-ci.yml
    permissions:
      contents: read
      actions: read
```

ci-gate needs `extensions`, and ci.yml's pull_request trigger has no `labeled`
type, so the lane runs on every pull request and every push to main. The call job
has no `if:` (green-means-ran A6) and no `timeout-minutes` (GitHub rejects one on a
call; every job here bounds itself).

## Who calls it

| caller | job | when | gates a merge |
|---|---|---|---|
| `ci.yml` | `extensions` | every pull request, every push to main | yes, through ci-gate |
| `extensions.yml` | `ci` | `workflow_dispatch` with `lane=ci` | no; its `if:` is legitimate there |

## What changed inside the lane

- **No lane guards.** Every job carried `github.event_name != 'schedule' && … inputs.lane == 'ci'`;
  the file runs only as CI, so the guard is gone. `gates`, `sims` and `package` keep
  `needs.discover.outputs.count != '0'`.
- **`ci-required`** needs `build-free` and `contracts` too, runs under `if: always()`, and
  its self-inventory reads EVERY job of this file (built-in case 10 plants one it does not
  name). A skip is licensed only for gates, sims and package under a zero matrix (case 11).
- **`gate-inventory`** greps both this file and extensions.yml, so a script named only by the
  release job must still exist.
- **Workflow-level `env: NODE_VERSION`** is restated here: a caller's env does not reach a callee.
- **No `concurrency:` key.** The caller's group governs.

## The guards that learned about call jobs

`tooling/ci/workflow-scan.mjs` `resolveLocalCalls` follows a local call one level and
returns a refusal (`missing` or `nested`) instead of exiting; each caller below turns a
refusal into its own COVERAGE LOST, exit 2.

- `assert-workflow-hardening.mjs` limb 4: a local call is bounded iff every callee job is.
- `assert-workflow-timeouts.mjs`: one anchor, ci-gate, and its closure followed through the
  call, so every job here is capped at 30 minutes.
- `assert-green-means-ran.mjs` A7: a workflow only `workflow_call` can start must be called
  by a constituent of an aggregator.
- `assert-channel-register.mjs` grader-is-run: every `storeMetadataGradedBy` script runs in a
  job ci-gate waits on, walked through the call into this file's `ci-required` needs.
- `release-grades-legs.test.mjs`: the release job's leg query asks ci.yml (and extensions.yml),
  and a queried workflow defines the legs itself or through its call.

## What is not measured yet

The check-run names of callee jobs (expected `extensions / <job name>`), whether a call makes
a separate run in the Actions API, and `needs.extensions.result` when a callee job fails are
measured by the PR's first run (RC1), not asserted here. The release job's `grade()` strips
exactly one known prefix, `extensions / ` or `ci / `, and any other prefix grades nothing,
which is RED.
