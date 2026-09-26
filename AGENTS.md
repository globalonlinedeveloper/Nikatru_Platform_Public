# AGENTS.md — how to work in `Nikatru_Platform_Public`

> Auto-loaded every session (`CLAUDE.md` is one line, `@AGENTS.md`, plus machine-local paths that
> have no business in a public repo). **What this repo IS, what is in it and what the gate enforces
> are in [`START-HERE.md`](START-HERE.md)** — GENERATED, every number measured off the tree.
> This file is the standing RULES only; both are capped by `check-agent-docs` limb A-SIZE, which
> owns the caps. Anything dated belongs in git history, not here.

## Read order (each session)

1. **`START-HERE.md`** — this repo's card, and the whole orientation for work inside this repo.
2. **`Private/START-HERE.md`** + **`Private/platform-state/brief.md`** — the corpus's two cards:
   what the platform is, what is in flight, what to pick up. GENERATED, so neither goes stale.
   (`Private/NOW.md` was retired 2026-09-08; it is a stub kept so citations resolve.)
3. The ADR you are about to touch, from `Private/decisions/`.

🔴 **Never read a `Private/platform-state/` register whole.** Each is far larger than the few
lines a question needs. Query by id instead — one row, with its `verify`:

```
node ../Nikatru_Platform_Private/requirements/tooling/state.mjs O-STORE-SCREENSHOTS
node ../Nikatru_Platform_Private/requirements/tooling/state.mjs --next   # what to pick up
node ../Nikatru_Platform_Private/requirements/tooling/state.mjs --traps ci
```

On demand only: `Private/requirements/` (the spec) · `Private/runbooks/` · `Private/README.md` (the
corpus index). Never read the corpus to orient yourself, and never re-litigate an ADR.

## Gotchas

- **The host, the checkout and what it can build**: [`docs/environment.md`](docs/environment.md) —
  long paths, LF, WSL, and why the Windows host cannot build Android (a JVM defect, not a Gradle
  one; do not re-diagnose it).
- 🔴 **Capture an exit code on its own line.** `$?` after a pipe is the LAST stage's status, and one
  printed beside `$(basename …)` is basename's — a sweep has read `EXIT 0` while a guard exited 1:

  ```
  node tooling/ci/<guard>.mjs
  code=$?
  echo "EXIT"
  echo "$code"
  ```

- 🔴 **Exit codes mean three things.** `0` green. `1` a finding. **`2` COVERAGE LOST** — the guard
  did not check enough to be evidence, which is deliberately *not* a pass. Exiting on a COVERAGE
  LOST limb is the guard **working**: its first line names the limb that refused. Never
  `git checkout` around it and never `--no-verify` past it.
- 🔴 **Any edit to a cited file shifts every `<file>:NNNN` citation below it**, and most land on
  another real line and are accepted silently. Re-measure with `grep -n` for the cited text, AFTER
  the last edit; never offset a citation by an insert size.
- 🔴 **Every other environment trap lives in ONE place — `Private/TRAPS.md` — and you QUERY it
  by class (`--traps`, above; the class names are in `docs/environment.md`).** Reading it whole,
  or its generated `traps.json` (the same rows again), costs far more than a query. `TRAPS.md` is
  the SOURCE, so add a trap only there. **Quote the rows into any subagent brief** — auto-memory
  does not reach subagents, so a trap a subagent was not handed does not exist for it.

## How I want Claude to work here

**Plan → Act (edit real files) → Verify (run/test) → Record (an ADR, or the knowledge set).**

- **Edit directly, then verify.** Demand the real signal — tests, `ci-gate`, the live endpoint, the
  deploy marker. **Merging is not shipping; deploying is not verifying.**
- **Increment = the unit of work:** the smallest change that passes the FULL gate alone, with its
  tests and its record. Ship it green or revert; **never leave half-states.**
- **Persist knowledge to disk the moment it is made** — context can compact at any time, and a
  finding that exists only in a session does not exist. A locked choice gets an **ADR**; a
  mechanically preventable mistake gets a CI guard, never a note.
- **Ask before destructive actions** (delete, overwrite, force) unless pre-approved; routine git is
  pre-authorised. **Spend, legal exposure, anything irreversible and every store publish are
  owner-gated.**
- **One worktree and one scratch directory per agent**, and partition parallel writers by
  **exclusive file ownership**, never by task — tasks overlap on files, files do not. **Commit a
  `wip` safety point early and often**: it is the one thing that has survived a worktree swept
  while an agent was still running.
- ⚠️ **The pre-commit spec-guard runner RUNS from a git worktree**, which has no gitignored
  `.claude/` vault and no `CLAUDE.md`; it resolves both from the MAIN checkout via
  `git rev-parse --git-common-dir` and still refuses if that checkout lacks them. Never
  `--no-verify` past it — that is how a change once landed unguarded.

## Verification discipline

**The recurring failure here is not a broken check; it is a check that silently stopped checking** —
it still prints "clean" until the guarded thing is broken. The eleven rules that follow from that
are [`docs/verification-discipline.md`](docs/verification-discipline.md); the two skipped most
often under time pressure:

- **An assertion that cannot fail is worse than none** — if you cannot write the input that reds
  it, delete it. And **a fixture passing is not a guard working: MUTATE THE REAL TREE**, green
  control first.
- ⚠️ **A green guard after a refactor is evidence of nothing.** Moved code leaves a guard's domain
  by moving house. After a move, run the OLD guard against a mutation.

## The guards

- `node tooling/scripts/preflight.mjs` reproduces CI locally — verifying a subset, or outside CI's
  environment, passes while CI fails. `START-HERE.md` says what the gate needs.
- The **spec guards** run from the git hooks (`node tooling/scripts/install-hooks.mjs`): their
  subject is the private corpus, which no CI job can read, so the hook is the only enforcement
  surface — `node tooling/scripts/spec-guards.mjs --fast`.
- **The guard that went red is rarely the only guard that would have.** After touching a file, run
  every guard whose subject includes it — CI reports only the FIRST failure in a job.
- After citing an ADR in a `tooling/` file, run `node tooling/ci/build-enforcement-index.mjs
  --write` and commit the diff — a guard's header comment feeds a derived artefact.
- **A register earns JSON only when a guard READS it** — land the two in one commit, both ways.
- **Never lower a floor or waive a guard to get green.** Re-base a floor ALONE, in its own commit,
  with the measurement at the line that moved.

## Git & GitHub

- `origin` is the **public** repo and **stays public** — the free CI minutes depend on it, and every
  build runs on GitHub-hosted runners. No self-hosted runner.
- Feature branch → one CI-gated change → merge. `git checkout -b` branches from wherever you are
  standing, so cut every branch from an up-to-date `main`.
- **Never run a `flutter` command in a subdirectory** — it re-resolves the workspace and rewrites
  the root `pubspec.lock`, which `git add -A` commits as an unreviewed pin change.
- The rest of what git and `gh` lie about here — `git branch --merged` in a squash-merge repo,
  `gh api repos/<owner>/<name>` following a rename redirect — is the `git` trap class: `--traps git`.

## Update-routing

**a locked choice and why** → an ADR in `Private/decisions/` · **a durable requirement** →
`Private/requirements/`, JSON not prose · **an ops procedure** → `Private/runbooks/` · **a trap** →
`Private/TRAPS.md`, in its class · **a fact with a number** → `Private/platform-state/`, as
`{value, asOf, verify}`, nowhere else · **narrative** → nowhere; if dated, it is git history.

## Secrets

Build and resolve commands per toolchain are in [`docs/environment.md`](docs/environment.md).
Every credential lives in the gitignored vault under `.claude/`. Never commit one, never paste one
into chat and never print one — compute a length and a short hash instead. `.gitleaks.toml` blocks
the PII shapes on every push: the control is the public boundary.
