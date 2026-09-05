<!--
BRANCH NAME — `feat|fix|chore/<slug>`.

`ci.yml` no longer keys on the prefix: it triggers on `push` to `main` and on
`pull_request` for every branch, so a branch called anything at all still gets
one full run. That is deliberate — the old push filter listed three prefixes and
missed `chip/`, `refactor/`, `docs/`, `test/`, `guard/`, `wave*/` and about 79
bare slugs, which is what a list that has to be remembered always does.

So the convention is a convention now. Keep it anyway; it is what makes
`gh pr list --json headRefName` readable.

TITLE — name the DEFECT that was closed, in the present tense, not the change
that was made. This repo's best documentation is its PR titles:

  Subly silently stopped sending reminders past 64 subscriptions on iOS
  The seam-forks guard could not fail at all if packages/ went missing
  CI was reading aloud three false statements about its own state
-->

## What was wrong

<!-- The defect, not the diff. If there was no defect — a new capability — say
     what could not be done before. -->

## What this changes

<!-- The diff, in one or two sentences per file group. -->

## How it was verified

<!-- REAL OUTPUT, not intent. Which guards you ran, against what, and what they
     said. "Should work" is not a verification, and a guard that went green
     after a refactor is evidence of nothing until it has been run against a
     mutation with a green control first. -->

```
# the whole guard set, with the token exported or four guards fail closed
GITHUB_TOKEN="$(gh auth token)" node tooling/scripts/guard-sweep.mjs

# everything ci-gate would run, on the machine that will not be a runner
GITHUB_TOKEN="$(gh auth token)" node tooling/scripts/preflight.mjs
```

- [ ] `git diff --name-only origin/main..HEAD` matches what this body claims.
- [ ] Any `<file>:NNN` citation to a file this change touched was **re-measured**
      after the last edit, not offset.
- [ ] If a `tooling/` file gained an `ADR NNN` in its header, the enforcement
      index was regenerated: `node tooling/ci/build-enforcement-index.mjs --write`.
- [ ] If this adds a workflow FILE, it carries a `duty` row in
      `tooling/ops/register.json` and an owner in
      `tooling/ci/assert-release-lane-generic.mjs` — both, or the build is red.

## What is still open

<!-- Anything this deliberately does not do, and who it is waiting on. -->
