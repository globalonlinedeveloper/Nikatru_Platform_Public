# `main-healthy.yml` — main's health as a commit status

Added 2026-09-29 (rv2-pipe-a P-1). The workflow itself carries only `# why:` lines.

## What it does

On every completed `CI` run of a push to `main`, it posts the commit status
`main-healthy` on the commit that run ran on: `success` or `failure`, with the run's URL
as `target_url`. It posts **nothing** for a cancelled run (a newer push superseded it, and
that push's own run verifies the commit too), for a pull-request run, for a fork's branch
called `main`, or for any other workflow. The event is read from `GITHUB_EVENT_PATH` by
`tooling/ops/land-gate.mjs publish-main-health`; no expression reads it.

## The three landing rules, and where they live

`tooling/ops/land-rules.mjs` holds them; `tooling/ci/test/land-rules.test.mjs` holds them
against recorded rollups (`tooling/ci/test/fixtures/land-rollup/`).

- **(a) The gate** is the `ci-gate` check-run of the **newest run** of its workflow on the
  head. A gate from an older run than the workflow's newest is **STALE** — pending, never a
  verdict. A failed check of a superseded run is history, not red. This is the class the
  laptop lander relearned four times (land-v12 → v15.1: #1031, #1029, #1030, #1040).
- **(b) Main is healthy** when the `main-healthy` status of the **newest run** (by the run id
  in `target_url`, not by post time) on main's **newest sha** is `success`. No status yet is
  PENDING. Two single-object reads, no run listing.
- **(c) The freeze**: any freeze file freezes (its first line is the reason); a lander that
  already holds the lock finishes; every other lander waits; a fix-first PR may merge under
  it; at most two merges may await core CI on main.

A lander asks, and waits on exit 2:

```
gh pr view <n> --json headRefOid,statusCheckRollup | node tooling/ops/land-gate.mjs pr
node tooling/ops/land-gate.mjs main
node tooling/ops/land-gate.mjs freeze --file <path to land.freeze>
```

Exit `0` GREEN/OPEN, `1` RED/FROZEN, `2` not a verdict (PENDING, STALE, NONE, unreadable).

## The merge itself squashes with the PR body

Then the lander merges through one command, never a bare `gh pr merge --squash`:

```
node tooling/ops/land-merge.mjs <n> --head <the head whose gate was read> [--dry-run]
```

It reads the PR's title, body and head in one `gh pr view`, rewrites the body's `Rows:` line
bare, and runs `gh pr merge <n> --squash --match-head-commit <head> --subject "<title> (#<n>)"
--body-file <body>`. A bare `--squash` takes the repository's squash default, which writes
the branch's commit messages and drops the PR body. Exit `0` merged, `1` refused (no `Rows:` line
main can read, or gh failed), `2` not a verdict (the head moved, the PR is not open, unreadable).

On every push to `main`, guard-meta runs `tooling/ci/assert-main-rows.mjs`: the newest commit
whose subject ends `(#<n>)` must hold a line matching `^Rows:`. If it does not, that push's
`ci-gate` is red, so that commit does not deploy and `main-healthy` is `failure`. A squashed commit
cannot be re-squashed, so the next PR merge (one that carries its line) is the fix: land it as
fix-first under rule (c).

A run object's `name` is ci.yml's `run-name` ("CI on main by @…"), never `CI`, so runs are
matched on `path` (`.github/workflows/ci.yml`), not on name.

`node tooling/ops/land-gate.mjs timing --last 30` measures what one landing costs serially:
p50/p90 of ci-gate green → merge and merge → main CI green, and `serialMinutesPerPr=<n>`
(the two p50s summed). Measured 2026-09-30 over the 30 merges to #1067: 5.8 + 16.3 = 22.1
minutes (gate → merge p90 86.6, freezes included; merge → main green p90 30.1, n 26 of 30).

## Proposed to the owner (A-4), not applied

The laptop lander exists because a merge needs someone to press it after `ci-gate` goes green
on an up-to-date branch. GitHub can do that natively:

1. Keep `ci-gate` the **only** required check. `main-healthy` is posted on main commits,
   never on a PR head, so requiring it would block every merge.
2. Turn **auto-merge** on per PR (`gh pr merge <n> --auto --squash --match-head-commit <sha> --subject "<title> (#<n>)" --body-file <body>`;
   without the last two the squash takes the repository default and drops the `Rows:` line).
   `allow_auto_merge` is already true (§7 of `README.md`). GitHub then merges on the
   **native** evaluation of the required check, which reads the newest run's `ci-gate` —
   rule (a) with no reader at all.
3. Optionally a **merge queue** instead of "require up to date": it tests each PR on top of
   the ones ahead of it and removes the BEHIND/update-branch churn entirely.

What stays on a laptop after that: the post-merge watch and the freeze (rules b and c),
which `land-gate.mjs main` and `freeze` answer from the repository.
