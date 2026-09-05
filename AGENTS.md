# AGENTS.md — how to work in `Nikatru_Platform_Public`

> Auto-loaded every session in this folder: `CLAUDE.md` is one line, `@AGENTS.md`, plus a short
> block of machine-local paths that have no business in a public repo. Standing rules, so a fresh
> or context-wiped session knows how to work here without reading the whole corpus. Keep it short
> and current (< 200 lines).
>
> This is the PUBLIC half, and the split is deliberate: every machine path, every credential and
> every business fact lives outside this file. See "Read order for context" for where.

## What this repo is

- **NIKATRU** — a **Flutter app factory** publishing to six platforms (iOS, Android, Windows,
  macOS, Linux, Web), plus a browser-extension factory and two static sites.
- **This repo is ONE PRODUCT, NOT THE WHOLE BUSINESS.** The code lives here. The decisions, the
  spec, the runbooks and the agent knowledge set live in the SIBLING private corpus, cited
  throughout the tree as the stable logical prefix `Private/...`. The business identity lives in a
  third repo this one has no path to at all, which is a stronger control than a gitignore line.
- **One code repo, one pipeline** ([ADR 067]): `extensions/` is a sovereign, **build-free** subtree
  — no bundler, no transpile step, the source is what is submitted — and top-level `contracts/`
  holds what Dart, the Workers and the extensions must agree on.

## Repo layout

- `apps/` — Flutter apps. `packages/` — the shared Dart layer (`core`, `api_client`,
  `design_system`, `telemetry`, `analysis`, `notifications`, `platform_storage`, `tokens`).
- `services/` — Cloudflare Workers. `contracts/` — the cross-surface contracts (entitlement, legal
  text, tokens, store vocabulary). `extensions/` — the build-free extension subtree.
- `sites/` — the static sites. `tooling/` — Mason bricks, the `ci/` guards, `e2e/`, release and ops
  scripts. `catalog/` — machine-readable registers. `docs/` — design and architecture notes.
- 🔴 **`sites/` IS THE LIVE DEPLOY SOURCE AND THE ONLY COPY.** Cloudflare Pages builds both domains
  from **this** repo through its own Git integration, and **that binding lives in the Cloudflare
  dashboard, not in any file in any repo** — so nothing you can edit here moves it, and nothing
  here reports it moving. **Do not delete, move, rename or "de-duplicate" anything under `sites/`,
  `pnpm-workspace.yaml` or `pnpm-lock.yaml`.** Two independent measured reasons: the domains go
  dark the moment the tree leaves while the binding still points at it; and
  `assert-lane-coverage.mjs` cross-checks `pnpm-workspace.yaml` members against the units it
  enumerates, so removing `sites/_shared` while the member line stays exits 1 with `COVERAGE LOST`.
- `.claude/` — the local harness config and the local credential vault. **Gitignored in full**, so
  it carries no version history and no PR review. That is a fact about version control, not about
  durability.

## Environment gotchas

- **OS:** Windows 11 Pro. Shell: **PowerShell** (primary; a Bash tool is available for POSIX
  scripts). Local-first, **no sandbox** — the guardrail is permission prompts, not isolation, so
  mistakes hit real files.
- **Long paths:** `git config --global core.longpaths true` is required; the Mason brick templates
  under `tooling/bricks/` exceed 260 characters. Keep the checkout at a short base path.
- **Line endings:** the repo stores **LF** (`.gitattributes` `* text=auto eol=lf`). Don't fight it.
- 🔴 **Capture an exit code on its own line.** `$?` after a pipe is the LAST stage's status, and one
  printed beside `$(basename …)` is basename's status — a sweep has already read `EXIT 0` while a
  guard was exiting 1. Write:

  ```
  node tooling/ci/<guard>.mjs
  code=$?
  echo "EXIT"
  echo "$code"
  ```

- 🔴 **Exit codes mean three different things.** `0` = green. `1` = a finding. **`2` = COVERAGE
  LOST** — the guard did not check enough to be evidence, which is deliberately *not* a pass. A
  guard exiting on a COVERAGE LOST limb is the guard **working**: read the first line, which always
  names which limb refused. Never `git checkout` around it and never `--no-verify` past it.
- 🔴 **Any edit to a cited file shifts every `<file>:NNNN` citation below it**, and most of them
  land on some other real line and are accepted silently. Re-measure with `grep -n` for the cited
  text; never offset a citation by an insert size, and re-measure AFTER the last edit to the file.
- 🐧 **Local build capability is 4 of 6** — web · windows (host) · linux · android. Android and
  Linux build **in WSL, never on the Windows host**; setup is `tooling/wsl-setup.sh`, which already
  encodes the SDK, JDK and heap gotchas. **macOS and iOS are CI-only, permanently** — Apple's
  toolchain runs only on Apple hardware, which is a property of the platform, not a gap to close.
  - 🔴 **The Windows host genuinely cannot, and it is NOT a Flutter/Gradle problem.**
    `java.nio.channels.Selector.open()` fails for **all Java** there (`SocketException: Invalid
    argument: connect`), proven with a six-line program and no Gradle. Gradle dies in 3.7 s; the
    same build ran 192 s of real work in WSL. **Do not re-diagnose this as Gradle/Flutter/SDK.**
- 🔴 **Every other environment trap lives in ONE place: `Private/TRAPS.md`.** Read it before running
  anything, and quote the relevant rows into any subagent brief you write — **auto-memory is not
  loaded into subagents**, so a trap a subagent has not been handed does not exist for it. Do not
  re-inline a trap here; add it there. Traps scoped to one tree also load via `.claude/rules/`.

## How I want Claude to work here

- **Edit directly, then verify.** Plan non-trivial work first, run the change, report real results —
  never claim success unverified.
- **Persist knowledge to disk.** Context is scratch memory; a finding that exists only in a session
  does not exist. A locked choice gets a numbered **ADR** in `Private/decisions/`.
- **When a mistake is mechanically preventable, encode it as a CI guard instead of a note** — a
  gotcha that lives only in prose will be repeated.
- **Ask before destructive actions** (delete, overwrite, force) unless pre-approved. Routine git —
  commit, push, merge, deploy — is pre-authorised; irreversible operations still get a confirm.
- **Spend, legal exposure, anything irreversible and every store publish are owner-gated.**
- **One worktree per agent, one scratch directory per agent.** Partition parallel writers by
  **exclusive file ownership**, never by task — tasks overlap on files, files do not.
- **Commit a `wip` safety point early and often** (`git commit -am wip --no-verify`). It is the one
  thing that has survived a worktree being swept while an agent was still running.
- ⚠️ **The pre-commit spec-guard runner refuses to run from a git worktree.** It searches upward for
  the workspace anchor, which a temporary worktree does not have, so it exits 2 before reading a
  guard. Edit in the worktree if you like, then apply and commit in the real checkout, where every
  guard runs. Never `--no-verify` past it — that is how a change once landed unguarded.

## Workflow loop

**Plan → Act (edit real files) → Verify (run/test) → Record (an ADR, or the knowledge set).**

## Session discipline

- **Increment = the unit of work:** the smallest change that passes the FULL gate alone — the change,
  its tests, and its record. Ship it green or revert; **never leave half-states.**
- **Verify before claiming "done".** Demand the real signal — tests, CI `ci-gate`, the live endpoint,
  the deploy marker — never assert done/live/working from memory. Merging is not shipping and
  deploying is not verifying.
- **Write as you go:** land each decision the moment it is made. Disk is memory; context can compact
  at any time, and a clean handoff beats a compressed session.

## Verification discipline — the eleven rules (worked examples: `Private/notes/verification-discipline.md`)

**The recurring failure here is not a broken check. It's a check that silently stopped checking.** It
still prints "clean", CI still goes green, and nothing surfaces until the guarded thing is broken.

- **Every scanner needs a test that it is still scanning what it thinks** — guards carry `REQUIRED_COVERAGE`.
- **Assert on parsed structure, never by grepping prose.** Strip comments AND string literals first.
- **An assertion that cannot fail is worse than none.** If you can't write the failing input, delete it.
- **Silence is not success.** Before waiting on a signal, confirm the signal *can* arrive.
- **Live-verify the real thing, not the test double.**
- **Negative-test every guard before trusting it.** Each guard has a recorded failing case.
- **A fixture passing is not a guard working — MUTATE THE REAL TREE.** A fixture you wrote encodes the
  same misunderstanding as the guard you wrote.
- **Run `analyze`/`tsc` before believing a mutation was caught** — a compile error looks identical.
- **Mutation testing is also how you find DEAD code.** If deleting it changes no outcome, it is redundant.
- **A fail-closed seam with no proven open path is a dead feature that reports healthy.** When the
  on-switch is owner-gated, the guard must PRINT the gap every run rather than fail the build.
- **Prefer a build-failing guard over a note.** Encode the lesson when it's encodable.

⚠️ **A green guard after a refactor is evidence of nothing.** Moved code leaves a guard's domain by
moving house. After a move, run the OLD guard against a mutation, with a green control first.

## The guards, and how to run them

- CI runs the whole `tooling/ci/` set; `.github/workflows/ci.yml` decides which lane runs what, and
  `ci-gate` is the one required check. `node tooling/scripts/preflight.mjs` reproduces CI locally —
  verifying a subset, or outside CI's environment, passes while CI fails.
- The **spec guards** run from the git hooks (`node tooling/scripts/install-hooks.mjs` installs
  them). Their subject is the private corpus, so no CI job can read it and the local hook is the
  enforcement surface: `node tooling/scripts/spec-guards.mjs --fast`.
- **The guard that went red is rarely the only guard that would have.** After touching a file, run
  every guard whose subject includes it — CI reports the FIRST failure in a job, never the set.
- After citing an ADR in any `tooling/` file, run `node tooling/ci/build-enforcement-index.mjs
  --write` and commit the diff: a guard's header comment is an input to a derived artefact.
- **A register earns JSON only when a guard READS it.** Add a register, add its guard in the same
  commit; delete a guard, delete its register in the same commit.

## Git & GitHub

- `origin` is the **public** repo and it **stays public** — the free CI minutes depend on it.
  **CI and every build run on GitHub-hosted runners.** No self-hosted runner.
- Feature branch → one CI-gated change → merge. `git checkout -b <new>` branches from wherever you
  are standing, so cut every branch from an up-to-date `main` or the new PR silently carries the
  previous branch's commits.
- **Verify a repo name with `gh repo list`, never `gh api repos/<owner>/<name>`** — GitHub follows
  rename redirects, so an old name still answers 200 and that is a false positive.
- `git branch --merged` lies in a squash-merge repo; the authoritative test is the PR state.
- **Never run a `flutter` command in a subdirectory** — it re-resolves the workspace and rewrites the
  root `pubspec.lock`, which `git add -A` then commits as an unreviewed pin change.

## Read order for context (each session)

1. **`Private/platform-state/`** — the cold-start knowledge set: what the platform IS, what may not
   change and who may change it, the traps, the programme, and what is open. Its
   `Private/platform-state/README.md` gives the order inside it. Every number there carries the
   command that re-derives it, so a claim without a command is not a claim.
2. **`Private/NOW.md` — the STATE block only**, not the whole file.
3. The ADR you are about to touch, from `Private/decisions/`.

Everything else is on demand: `Private/requirements/` (the JSON spec) · `Private/runbooks/` ·
`Private/README.md` (the corpus index). Do not read the corpus to orient yourself, and do not
re-litigate anything already decided in an ADR.

## Update-routing (where new knowledge goes)

- **a locked choice and why** → a numbered ADR in `Private/decisions/`
- **a durable requirement or policy** → `Private/requirements/`, as JSON, not prose
- **an ops or deploy procedure** → `Private/runbooks/`
- **an environment trap** → `Private/TRAPS.md`, in its existing class
- **a fact with a number** → `Private/platform-state/`, as `{value, asOf, verify}`. Nowhere else.
- **narrative** → nowhere. If it is dated, it belongs in git history.

## Useful commands

- **Dart/Flutter (Melos workspace):** `melos run gate` = analyze + test the whole tree in one
  resolution. Resolve with `flutter pub get` (Flutter members need the Flutter tool); `dart analyze`
  and `dart test` work for the pure-Dart packages.
- **JS/TS (pnpm):** `pnpm install` at the root.
- **Workers:** deployed by `wrangler` from CI; see `services/*`.
- **Secrets:** every credential lives locally in the gitignored vault under `.claude/`. Never commit
  one, never paste one into chat and never print one — compute a length and a short hash instead.
  `.gitleaks.toml` blocks the PII shapes on every push: the control is the public boundary.
