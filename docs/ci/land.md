# `land.yml` — the merge orchestrator

Added 2026-10-02 (row O-MERGES-DEPEND-ON-THE-LAPTOP). The workflow carries only `# why:`
lines; every decision is `tooling/ci/land-next.mjs`, held by
`tooling/ci/test/land-next.test.mjs`.

## What it closes

Every merge used to be made by a laptop script (`land-vNN.sh`) run by local daemons. When the
laptop was off, rebooting, out of memory or switching accounts, nothing landed. This workflow
is the merge actor on GitHub: on a 10-minute schedule, on every `CI` or `E2E live`
completion and on a `land-ok` label, with the run's own `GITHUB_TOKEN`. **No secret, no PAT,
no GitHub App.**

## The constraint, and the measurement that settled it

A push made with `GITHUB_TOKEN` starts no workflow run, so a squash merge made here would
start neither `CI on main` nor its deploy call jobs nor CodeQL. GitHub's documented exception
is `workflow_dispatch` (and `repository_dispatch`): a dispatch made with that token **does**
start a run. Measured in this repository: run 35829064154, `Deploy workers`, event
`workflow_dispatch`, actor and triggering actor `github-actions[bot]` — dispatched by
`redeploy-stranded.yml` with `GITHUB_TOKEN` — ran and concluded `success`.

So, after its merge, the lander dispatches `ci.yml`, `codeql.yml` and `ops-watch.yml` on
`main` (the last one is the laptop lander's own post-merge dispatch, kept). `ci.yml`'s run is
then the same pipeline a push would have started, because every reader that keyed on a push
to main now takes a dispatch of main too:

| What keyed on `push` | Now |
|---|---|
| `ci.yml` `on:` | `workflow_dispatch:` (no inputs), beside `push: [main]` |
| the three post-gate call jobs (`platform-db-migrate`, `deploy-workers`, `deploy-web`) | `POST_GATE_IF` = `(push \|\| workflow_dispatch) && ref == main`, one export in `workflow-scan.mjs`; A9 in `assert-green-means-ran.mjs` still demands it byte for byte |
| the Gradle cache save on main | the same predicate |
| `security-scan`'s range (`event.before..event.after`) | a dispatch scans `<first parent>..<sha>`: for a squash merge that is exactly the push's range |
| `extensions-ci.yml` `discover` base (`event.before`) | the first parent, when the caller is ci.yml on main |
| `plan-deploy.mjs`, `record-deployment.mjs`, `assert-deploy-ref.mjs`, `lane-detect.mjs` | already event-blind on main (the ledger, `GITHUB_SHA`, `push`/`workflow_dispatch` both allowed, non-PR = every lane) |
| ops-watch's provenance check (`check-prod-provenance.mjs`) | the caller filter is `branch=main`, no longer `branch=main&event=push`, so a build a dispatch deployed is attributable |
| `main-healthy.yml` (`land-rules.mjs` `statusForRun`) | posts for a dispatch of main too |
| `assert-ops-register.mjs` neutral arm (b) | a dispatch of main can run the call, so it is not excused |
| `assert-ops-register.mjs` dispatchable set | the GATE workflow is never "dispatchable": its dispatch re-runs the same commit, so it is no non-merge exit |
| `refresh-executed-floor.mjs`, `land-gate.mjs timing` | accept a dispatch of main |

`dispatchParityProblems` in `land-next.mjs` reads `ci.yml` and every workflow it calls, and is
red on any `github.event_name == 'push'` that does not also admit `workflow_dispatch`, on any
`github.event.before/after` read whose step says nothing for a dispatch, and on a post-merge
dispatch target with a required input. Against `origin/main` before this change it lists all
nine pre-change lines; on the tree, nothing.

A person who dispatches `CI` on main by hand gets the same thing: main's pipeline on main's
head, with every deploy planned from the ledger (an already-live SHA publishes nothing).

## What it decides (one write per run)

1. **Main first.** Main's newest `ci.yml` run at its head (push or dispatch):
   running → no merge; none and the commit older than 3 minutes → dispatch `ci.yml` (a merge
   whose dispatch was lost, or a push by this token); cancelled **with no failed job** →
   re-dispatch, at most twice; red — including a run that ended `cancelled` with any failed
   job (fail-fast cancels a red run), or one whose jobs could not be read (fail closed) — →
   the failing jobs are compared with the parent's run, and a job **new** against it opens
   a `land-freeze` issue naming the run and the job (once per run id, open or closed). A red
   that was already red on the parent does not freeze. Only `ci.yml` and `codeql.yml` are
   judged, so Rollback, Native auth proof and Store submit runs never count. Each is read
   from its own workflow's listing (`workflows/ci.yml/runs?head_sha=<sha>&branch=main`),
   every row held to that sha: a page of all runs on the sha can be flooded by land.yml's own.
2. **An open `land-freeze` issue stops every merge.** The lead closes it.
3. **The queue**, in `land-ok` label time, then PR number. A PR is eligible when it is open,
   not a draft, based on main, labelled `land-ok`, its **newest** `ci-gate` run green
   (`land-rules.mjs` rule a), and mergeable. Then:
   - **bound to the reviewed head** → `land-ok` approves the head it was APPLIED at: the
     head of the newest `pull_request` run of the PR's branch created at or before the label
     (a push starts that run within seconds). A head that moved after the label WAITS, with
     the reason, until the lead re-applies the label — unless its diff against `main` is the
     reviewed diff exactly (every file's status, name and patch), which is what a person's
     merge-from-main or this lander's own update-branch produces. No run before the label,
     or a diff that cannot be compared, waits (fail closed);
   - **behind main** → `skewVerdict`: DISJOINT merges as it is; OVERLAP or UNKNOWN fails
     closed (main changed `.github/` or a root lockfile, either side changed
     `services/_shared`, the same path on both sides, a `packages/` change against an
     `apps/`/`packages/` change, or one deploy unit reached from both): a same-repository
     head is update-branched; a fork's is SKIPPED for a person, because this token could
     not start its CI;
   - **re-tested** → an update-branch made with `GITHUB_TOKEN` starts no CI, so a head with
     no `ci-gate` and no CI run that will report one (none, or the newest cancelled) gets
     `ci.yml` **dispatched on its branch** once the head is 3 minutes old. At 2 CI runs on
     that head that never reported, it is SKIPPED with the reason for a person (or the
     laptop) to re-run — never a wait without end. A dispatched run on a branch skips the
     pull-request-only step (`assert-pr-rows`), which the reviewed head's PR run already
     passed, and runs every lane;
   - **E2E paths** (`apps/*/(lib|integration_test|web|assets)`, `packages/*/lib`) → a green
     `E2E live` run on that exact head; none → it dispatches `e2e.yml` on the PR's branch
     (same repository only; a fork waits). ⚠️ That dispatch is BARE: `pending_flows` takes its
     default `skip`, so the **parked flows** (row O-E2E-CORE-FLOW-LEGS-PENDING,
     `tooling/e2e-leg-register.json` `flows`) are skipped and said, not walked. A PR that
     changes a parked flow needs a person's `pending_flows=run` dispatch;
   - **merge**: squash, with `sha` = the head it read (GitHub's `--match-head-commit`), then
     the post-merge dispatches.

The first PR whose decision is a write gets it; a waiting PR does not block the next, and
neither does a REFUSED write: that PR is skipped with GitHub's answer printed and the next
write is tried (the run still exits 1). A refused main write (the freeze issue, a dispatch of
main) stops the run — nothing may pass it.

**API budget.** A run reads `GET /rate_limit` first (it costs nothing) and refuses to start
below 200 requests left (COULD NOT LOOK, exit 2); a run reads about 8 + 12 per `land-ok` pull
request against `GITHUB_TOKEN`'s 1,000 an hour. It prints what it spent on its last line.

## Dry run

The default. Every run is dry until the repository variable `LAND_DRY_RUN` is `false`. A
dispatch's own `dry_run` input (default `true`) can only make a run drier: a `dry_run=false`
dispatch while the variable is not `false` is **refused** — the run prints its decisions dry
and exits 1 saying so. A dry run prints every open PR's decision and reason and the write it
would make, and writes nothing.

`node tooling/ci/land-next.mjs --snapshot <file>` decides from a recorded snapshot offline.

## Cut-over (the lead's, after merge)

1. Leave `LAND_DRY_RUN` unset for one day: `land.yml` runs dry every 10 minutes beside the
   laptop landers. Compare its printed decisions with what the landers did.
2. Stop the laptop landers.
3. `gh variable set LAND_DRY_RUN --body false`. The next slot acts.

The row O-MERGES-DEPEND-ON-THE-LAPTOP closes at step 3, not at this merge.

**What a landed merge deploys.** The post-merge `ci.yml` dispatch is main's whole pipeline: a
merge that reaches a web app or the site republishes `<app>-web` and `nikatru-site` through
`deploy-web`, exactly as a push to main would. A PR's `Deploys:` line names them.

## Not verified here

- Branch protection is not readable from this workflow's token. If `main` requires a review
  or an up-to-date branch that `GITHUB_TOKEN` cannot satisfy, the merge answers 405 and the
  run is red with that reason; the dry-run day shows no such refusal, because it never merges.
- Whether a `workflow_run` fires for a CI run that this token dispatched is not measured. The
  design does not depend on it: `main-healthy.yml` may not post for such a run, and the
  lander reads the run itself, on its 10-minute floor.
