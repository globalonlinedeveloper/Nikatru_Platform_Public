# The weekly self-review — what it measures, from where, and how each number lies

Row `O-NO-WEEKLY-SELF-REVIEW`. The script is `tooling/review/self-review.mjs`; its tests are
`tooling/ci/test/self-review.test.mjs`, which hold this file to the script's `METRICS` list (one
`## <id>` section per metric, each with a **Definition**, a **Source** and a **How it lies**).

The lead runs it weekly from the laptop; nothing in CI or ops-watch schedules it.

```
node tooling/review/self-review.mjs --out <dir> [--since ISO] [--until ISO] [--budget N]
     [--rate-floor N] [--lanes <ledger.json>] [--reviews <dir>] [--cache-dir <dir>] [--repo owner/name]
```

## Ground rules

- **UTC only.** Every window, bucket and duration is computed on GitHub's UTC timestamps. An evening
  IST merge is the next UTC day's or the same UTC day's, never "today" by the laptop's clock.
- **The window** is `[--since, --until)`; `--until` defaults to now and `--since` to seven days
  before it. **The trend** is the four seven-day buckets ending at `--until`.
- **Runs are picked by commit SHA, never "latest".** ci-gate is read from
  `commits/<sha>/check-runs?check_name=ci-gate&filter=all`, and every answer's `head_sha` is
  asserted equal to the SHA asked for.
- **Read-only.** `gh api -i` GETs only. The script writes `report.md`, `report.json`,
  `proposals.json` and its ETag cache under `--out` (or `--cache-dir`), and its one write seam
  refuses any other path. It never edits a queue, a brief, a register, guard-yield or the
  failed-run ledger.
- **Privacy-minimal.** The report names PRs, jobs, workflows (by path) and lanes. It records no
  login, no name and no e-mail; a lane ledger carrying an e-mail address is refused. Every API
  answer is cut to the fields the report reads **the moment it is parsed** (`trimBody`), before it
  is cached or kept: a runs page's `head_commit` (author and committer e-mails), `actor`,
  `triggering_actor` and run **name** (`CI on PR #… by @…`), a PR's `user`, and a review comment's
  author and text never reach `--out`, the cache or the report. A workflow is keyed by its `path`,
  never a run name. A test plants all of these and scans every file under `--out`.

## first-push-green

**Definition.** Over the PRs **opened** in the window: a PR counts green when the **first
completed `ci-gate` check run** on its **first pushed head** concluded `success`, and red when it
concluded anything else. A `cancelled` or `skipped` gate gave no verdict (a second push or an
`edited` re-trigger cancels the first, ci.yml's `cancel-in-progress`): the first gate that did
conclude is read, and a head whose every gate was cancelled or skipped is `superseded`. Rate =
green / (green + red). A PR whose first gate went red and a later gate **of the same workflow run**
(a re-run; the run id is read from the check run's `details_url`) went green is red here and also
listed in `redThenGreenSameSha`, so the proposals price it once, as a flake. A green from another
run on that SHA (an `edited` re-trigger) leaves the red on the change. A PR with no ci.yml run,
whose gate has not completed, or whose gate was superseded is listed under `excluded` and is in
neither count.

**Source.** The pulls list (opened time); the Actions runs list (the PR's earliest ci.yml
`pull_request` run gives the first head SHA — the run's PR is `pull_requests[0]`, else the one PR
whose head branch matches and whose open span covers the run); `commits/<sha>/check-runs` for
`ci-gate`.

**How it lies.** A head pushed with no CI run (a skipped workflow, a force-push before the run
was created) is invisible, so "first" means first **run**. A PR opened in the window from a
branch already pushed counts its earliest run in the fetched range only. A non-required job may be
red while ci-gate is green: this metric reads the gate, not the run.

## time-to-merge

**Definition.** Over the PRs **merged** in the window: hours from opened to merged, and hours from
**first green** to merged, each as a median and a p90 (nearest rank). First green is the
completion time of the PR's earliest ci.yml `pull_request` run that concluded `success` at or
before the merge.

**Source.** The pulls list (`created_at`, `merged_at`); the runs list.

**How it lies.** A run concluding `success` implies ci-gate passed, but a run red only on a
non-gate job is skipped, so first green can read late. A PR whose first green fell before the
fetched range (`--since` minus the trend) is counted under `noGreenInWindow`, not guessed. A PR
closed unmerged is not counted.

## review-findings

**Definition.** Findings from independent reviews in the window, grouped by class. One finding is
(a) one inline PR review comment that is not a reply, or (b) one ruling from `--reviews <dir>`.
The class is `class: <tag>` in the text, else a leading `[tag]`, else the review bot's circle
(🔴 `blocking`, 🟡 `nit`, 🟣 `pre-existing`), else `untagged` — counted, never dropped.

`--reviews <dir>` holds `*.json` (`{"findings": [{"class": "...", "pr": 123}]}` or a bare list)
and `*.md` (one finding per list item carrying a `[tag]` or `class: tag`; an untagged list item is
prose, not a finding).

**Source.** `pulls/comments?since=<window start>`; the lead's rulings folder.

**How it lies.** A review given as one summary comment with no inline comment is invisible here
unless a ruling records it. A reviewer that does not tag lands in `untagged`; the proposals never
rank `untagged`, `nit` or `pre-existing`.

## flaky

**Definition.** The same job failing then passing **on rerun**: a run re-run (`run_attempt > 1`)
in which one job name has a `failure`/`timed_out` attempt followed by a `success` attempt of the
**same run**, on its one head SHA. The `ci-gate` aggregator is never the flake itself, and a run
started by `schedule` or `workflow_dispatch` is a watcher: its red→green is the watched state
recovering, never a flake. Two separate runs on one SHA are never a flake: measured on the week to
2026-10-02, 13 of 14 such pairs were ops-watch's cron and dispatches (and an E2E dispatch) on an
unchanged main SHA, and on a PR an `edited` re-trigger re-runs CI on the same head against a newer
merge with main. `reruns` is the sum of `run_attempt - 1` over the window's runs. Minutes lost are
the wall minutes of the attempts before the last. Instances are keyed by job name, and name their
workflow by path.

**Source.** The runs list; `actions/runs/<id>/jobs?filter=all` for every re-run in the window.

**How it lies.** Per **job**, not per test: test names live in logs this script does not read
(guard-yield and the failed-run ledger read them). A re-run that also failed and was abandoned
for a new push is a red, not a flake. A deterministic failure "fixed" by a re-run after a base
change reads as a flake (a re-run re-tests the same merge ref, so this needs main to change state
under it, such as a red main going green). A flaky job in a cron or dispatch workflow is not counted
(the watcher exclusion above); ops-watch's reds are priced under `mttr` instead.

## mttr

**Definition.** Per incident, for ci.yml on `main` and for ops-watch on `main`: an incident opens
at the completion of the first red (`failure`/`timed_out`) completed run after a green one, and
closes at the completion of the next `success`. MTTR is the median closed incident in hours;
`redHours` is their sum, an incident still open at `--until` counted to `--until` and flagged
open. Cancelled runs neither open nor close an incident.

**Source.** The runs list, filtered to the workflow path and `head_branch == main`.

**How it lies.** Main is red from the moment the red run completed, not from the push that broke
it; a green run that started before the fix landed can close an incident early. ops-watch runs on
a schedule, so its MTTR has the schedule's granularity.

## cost-per-lane

**Definition.** Per lane in the lead's ledger: the window's completed runs on the lane's branch or
PRs — runs, wall CI minutes, minutes on red/cancelled runs, re-runs — beside the ledger's own
`costUsd`, `tokens` and `agentMinutes`. Plus wall CI minutes per workflow, and the minutes of its
red/cancelled runs.

The ledger (`--lanes <file>`), validated before any request is sent:

```json
{ "lanes": [ { "lane": "self-review", "branch": "tooling/self-review", "prs": [1152],
               "costUsd": 3.1, "tokens": 900000, "agentMinutes": 95 } ] }
```

`lane` is required; the rest are optional; numbers are non-negative. No Private path is written in
code: the lead passes the file.

**Source.** The runs list; the lane ledger.

**How it lies.** Wall-clock minutes, not billable minutes (the public repository's runners are
free; queue time is included). A lane whose branch was renamed mid-week loses the runs on the old
name unless its PRs are listed.

## The request budget, the cache and the rate limit

`--budget N` (default 1500) is a hard ceiling on requests **sent**, a 304 and a retry included;
the request past it is not sent. The default is sized from a **measured** real week
(`MEASURED_WEEK` in the script: the requests one full run at the defaults sent for the week to
its `asOf`), with at least 1.5× headroom; the test holds the two together and holds this paragraph
to the script's number. Re-measure when the factory's volume moves.

The order is fixed — PRs, runs (a week per request; a week whose first page reports more than
GitHub's 1000-result list ceiling is not paged further but read a day at a time), re-run jobs,
review comments, then ci-gate per first head for the window and then the trend weeks — so a stop
is reproducible. Every GET carries the cached ETag; a 304 is served from the cache. A `5xx` is
retried twice, each retry a request against the budget, before the walk stops with `http`.
`x-ratelimit-remaining` under `--rate-floor` (default 100), a 429, or a 403 whose quota is spent
(`x-ratelimit-remaining: 0`) or that carries `retry-after`, stops the walk with `rate-limit`; any
other 403 (a permission refusal) is `http`. The script never sleeps a quota out.

**The trend's ci-gate reads are best-effort.** A stop while reading a trend week's gates leaves
the window whole: the report stays complete and still proposes, `trendStop` names the reason, and
the trend weeks it did not reach show first-push-green `n/a`.

Any other stop (an unexpected error included) writes an **INCOMPLETE** report: `status:
"INCOMPLETE"`, `partial: true` and `stopReason` (`budget`, `rate-limit`, `http`, `transport`,
`error`, `list-ceiling`, or `workflow-moved` — ci.yml or ops-watch.yml has no run in the window,
so it was renamed or moved and its metrics would be computed on nothing) in `report.json`, an
INCOMPLETE banner on the first line of `report.md`, every number that was measured, an empty
`proposals.json`, exit 2. Never a silent full one, and never silently nothing.

**The cache** (`<out>/.cache` unless `--cache-dir`) holds only trimmed bodies, never a raw
answer; it is still a cache, so keep `.cache/` out of any commit.

## The proposals

Every candidate is priced in **minutes lost**, so one ranking compares them. One CI cycle is the
median wall minutes of the window's completed ci.yml `pull_request` runs.

| candidate | cost |
|---|---|
| flake | flaky minutes lost + re-runs × one CI cycle |
| first push red on the change itself (flakes excluded) | its red run minutes + PRs × one CI cycle |
| main / ops-watch MTTR | red hours × 60 |
| costliest lane | its lost minutes + its re-runs × one CI cycle |
| review class (not `untagged`/`nit`/`pre-existing`) | findings × one CI cycle |

The top three become queue-item-shaped objects in `proposals.json`: `lane`, `brief` (a
one-paragraph stub carrying the metric that justifies it), `priority` (1 is first), `deps: []`,
`note: "self-review <until date>"`, plus `kind` and `costMinutes`. They are proposals: queuing one
is the lead's decision.

## What it consumes and never rewrites

`tooling/guard-yield.json` (as of, zero-catch guards, unattributed runs) and
`tooling/ops/failed-run-causes.json` (causes by fix kind) are summarised in the report as they
stand. Refreshing them is `tooling/ops/triage-failed-runs.mjs --yield` and the weekly
failure-ledger slot of ops-watch.

## Exit

`0` the report covers the whole window. `2` COVERAGE LOST: an INCOMPLETE report (written, and marked),
or a refused input (an argument, a lane ledger off its schema or carrying an e-mail address, an
unreadable reviews folder).
