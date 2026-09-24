# Prune plan — `Nikatru_Platform_Public`, 2026-09-08

> **This is a PLAN. Nothing in this pass was deleted, nothing was pushed, no PR was opened.**
>
> Method copied from the sister repo `Nikatru_Platform_Private`, which went 897 → 260 tracked files
> on 2026-09-08 (`docs/areas/history.md` there, and its `AGENTS.md` § *2026-09-08*). Its four rules
> bind this plan too:
>
> 1. a citation to a removed file is **pinned to a tag**, not deleted;
> 2. **a pin is a citation, not a command** — a `verify` string rewritten into `<tag>:<path>` stops
>    being runnable;
> 3. **a guard retires in the SAME commit as its only subject**, because a guard whose subject is
>    gone passes vacuously;
> 4. **anchors and floors re-base ALONE, in their own green commit, BEFORE** the files they name go.
>
> 🔴 **The difference that governs everything below: the Private repo is a docs corpus; this is the
> LIVE code + CI repo.** Its CI runs on GitHub-hosted runners and `ci-gate` is the single required
> check on `main`. Deleting live code, a workflow, a guard or a test **breaks the pipeline**. So the
> deliverable here is analysis, and the deletable set is *small on the evidence*, not small by
> caution.

---

## 0 · The headline measurement

| | |
|---|---|
| Tracked files **before** | **2063** (`git ls-files \| wc -l`) |
| Projected **after** (DEAD only) | **2059** — 4 files |
| Projected **after** (DEAD + ARCHIVE-THEN-DELETE) | **2055** — 8 files |
| Projected **after** (+ every UNCERTAIN resolved as delete) | **2049** — 14 files, upper bound |

**0.4 % of the tree, against the Private repo's 71 %.** That is the finding, not a shortfall.

### The whole deletion set, ranked by size

There is no "top 10" to pick from — **the entire proposed set is eight files**, so here it is in full.

| # | Path | Bytes | Class | Why it can go |
|---|---|---:|---|---|
| 1 | `extensions/MIGRATION.md` | 31 640 | ARCHIVE | completed 2026-08-14 rename record; its own §STATUS says four of its six sections describe a state that no longer exists |
| 2 | `extensions/.githooks/pre-commit` | 28 190 | ARCHIVE | inert — one `core.hooksPath` per repo, and it points at the root `.githooks/` |
| 3 | `extensions/.github/pull_request_template.md` | 6 904 | ARCHIVE | inert as a template (GitHub reads root only); **fold its "No network" clause into the root template first** |
| 4 | `extensions/SECURITY.md` | 5 881 | ARCHIVE | inert **and contradicts** the live, guarded root policy |
| 5 | `extensions/renovate.json` | 3 176 | DEAD | inert — Renovate reads config at the repo root only; and its own prose is now false |
| 6 | `extensions/.github/ISSUE_TEMPLATE/new-tool.yml` | 2 674 | DEAD | inert — GitHub reads issue forms at the repo root only; not grepped by CI |
| 7 | `extensions/.github/ISSUE_TEMPLATE/feature.yml` | 2 627 | DEAD | same |
| 8 | `extensions/.github/ISSUE_TEMPLATE/config.yml` | 1 093 | DEAD | same — and it is purely the GitHub issue *chooser*, which no non-root path can produce |
| | **total** | **82 185 B** (~80 KB) | | |

*Not in the set, and deliberately:* `apps/subscriptiontracker/dod-flip-draft.json` (44 231 B) would have been the
single largest file removed. It was retracted — §1.5 and Q7.

### Why the numbers are this small, proven rather than asserted

This repository **already carries a merge-gated dead-file guard**, and it is green:

```
node tooling/scripts/assert-no-dead-files.mjs
# ok  no dead tracked files — 2063 path(s) checked, 2061 reached by 8 resolver(s),
#     2 waived by name (3 row(s) in the table); 1962 file(s) read as text for references
EXIT 0
```

`tooling/scripts/assert-no-dead-files.mjs` walks the **whole tracked manifest** with eight resolvers
(`path-reference`, `module-import`, `sibling-name`, `unique-name`, `runner-walk`, `tool-convention`,
`package-entry`, …) and is wired as the **`No dead tracked files` step in `.github/workflows/ci.yml`'s
`platform:` job**, which is in `ci-gate`'s `needs`. Exactly **two** tracked paths in the entire repo
are waived by name:

```
node tooling/scripts/assert-no-dead-files.mjs --list | grep -E '^(EXEMPT|🔴)'
# EXEMPT   services/platform/.dev.vars.example
# EXEMPT   tooling/ops/set-monitor-thresholds.mjs
```

So **"orphaned scripts nothing invokes" is a class this repo has already closed.** The same holds for
the guard layer:

```
node tooling/ci/assert-guard-coverage.mjs
# ok  guard coverage — 158 file(s) in tooling/ci, all accounted for: 144 invoked by 16 workflow(s),
#     12 imported by one that is, and 2 recorded not CI-runnable ...; all named in 171 test file(s);
#     ... ratchet holds at 6873 test case(s) across 171 file(s)
EXIT 0

node tooling/scripts/guard-sweep.mjs
# ⬜ guard sweep — 158 file(s) in tooling/ci, 134 executed ... 10 MUTATES · 120 ok · 10 RED ·
#    3 NEEDS-CI · 2 NOT-CI-RUNNABLE · 1 IMPORTED · 12 LIBRARY
EXIT 0
```

And `tooling/enforcement-index.json` states the wiring for all 195 enforcement points: **180 WIRED**,
12 LIBRARY (imported, not executed), 2 NOT-CI-RUNNABLE, 1 IMPORTED, 1 HELD. **Zero orphans.**

### What the guard structurally cannot see, and that is where the plan lives

`assert-no-dead-files.mjs` says so itself in its own header: it "errs HARD toward reachable", whole
trees are conceded to a named runner, and **prose in a tracked file counts as a reference**. Two
classes therefore survive it:

- **(A) Files that are INERT BY PLATFORM SEMANTICS.** GitHub reads `.github/` only at the repository
  ROOT. Renovate reads its config only at the repository ROOT. Git honours exactly one
  `core.hooksPath`. A file that is a perfect, referenced, *inert* copy one directory deep is
  "reached" by every resolver and does nothing. **Every one of these arrived in the
  `git subtree add` of 2026-09-05.**
- **(B) A completed record whose own text says it describes a state that no longer exists.**

That is the whole deletable surface, and it is enumerated below.

---

## 1 · DEAD — safe to delete

**Four files**, all four artefacts of one event (§7). Each row carries the command that **proves** it
is unreferenced or inert. *A file being old is not evidence and no row below rests on a date.*
A fifth candidate was retracted mid-pass — §1.5.

### 1.1 `extensions/renovate.json` — 3 176 bytes

**Inert.** Renovate reads its configuration from the repository ROOT only; the live config is
`renovate.json` at the root (19 packageRules + 14 customManagers, and the one Renovate actually
loads). The subtree copy is never read by anything.

```bash
# nothing in this repo reads it
git grep -n "extensions/renovate" -- tooling .github
# → (no output)

# and it is not in any guard's scan set
node tooling/ci/assert-no-dead-repo-names.mjs
#   scan set: .github/workflows/**/*.yml  tooling/**/*.json  renovate.json  **/package.json
#             catalog/**/*.json  extensions/catalog/**/*.json         ← `renovate.json` is ROOT-anchored
```

🔴 **Its own prose is now false, which is the second reason to remove rather than keep.** It says
*"Nikatru_Platform_Public's `.github/workflows/renovate.yml` names both repos in
RENOVATE_REPOSITORIES"*. It names one:

```bash
grep -n "RENOVATE_REPOSITORIES" .github/workflows/renovate.yml
# 38:  RENOVATE_REPOSITORIES: globalonlinedeveloper/Nikatru_Platform_Public
```

**No coverage is lost.** The root config has no `ignorePaths` entry for `extensions/`, so
`config:recommended` already reaches the subtree's real npm tree
(`extensions/Extension/Full_Screen_Shot/test/e2e/package.json`) and its action pins.

### 1.2 `extensions/.github/ISSUE_TEMPLATE/config.yml` — 1 093 bytes
### 1.3 `extensions/.github/ISSUE_TEMPLATE/feature.yml` — 2 627 bytes
### 1.4 `extensions/.github/ISSUE_TEMPLATE/new-tool.yml` — 2 674 bytes

**Inert.** GitHub resolves issue forms only from `<root>/.github/ISSUE_TEMPLATE/`, `<root>/ISSUE_TEMPLATE/`
or `<root>/docs/ISSUE_TEMPLATE/`. This repo's root carries **no** `ISSUE_TEMPLATE` directory at all:

```bash
git ls-files .github
# .github/CODEOWNERS
# .github/PULL_REQUEST_TEMPLATE.md
# .github/actions/... .github/workflows/...     ← no ISSUE_TEMPLATE
```

Only **two** of the six files under `extensions/.github/` are read by anything in this repo, and
these three are not among them:

```bash
git grep -n "ISSUE_TEMPLATE" -- .github/workflows
# .github/workflows/extensions.yml:331:  for t in .github/ISSUE_TEMPLATE/bad-page.yml .github/ISSUE_TEMPLATE/bug.yml; do
```

> ⏱ Appended 2026-09-24; the record above is unchanged. That loop now lives in the `discover` job of
> `.github/workflows/extensions-ci.yml` (`:294`). Since 2026-09-08 it reads the ROOT forms through
> `$GITHUB_WORKSPACE/.github/ISSUE_TEMPLATE/`, so the working-directory point below no longer applies to it.

⚠️ **That line is repo-root-relative *in appearance only*** — `extensions.yml:80` sets
`defaults.run.working-directory: extensions`, so it reads `extensions/.github/ISSUE_TEMPLATE/{bad-page,bug}.yml`.
Those two are **live CI subjects and are KEPT** (§3.4); `config.yml`, `feature.yml` and `new-tool.yml`
are not grepped by that step or by any other.

`config.yml`'s only content is the GitHub issue *chooser* (`blank_issues_enabled: false` + two
`contact_links`), which no non-root path can produce.

### ~~1.5 `apps/subscriptiontracker/dod-flip-draft.json`~~ — RETRACTED IN THIS PASS, see Q7

🔴 **This was classified DEAD on the first reading and the classification was WRONG.** It is recorded
here rather than quietly dropped, because the mistake is the instructive part: *a file that says
"NOTHING READS IT" and carries its own deletion instruction is still not dead if the instruction is
conditional and the condition has not been met.*

What was true: nothing machine-reads it —

```bash
grep -c "dod-flip" tooling/dod-register.json                 # → 0
grep -n  "dod-flip" tooling/scripts/check-dod-sync.mjs       # → (no output)
grep -n  "REGISTER_REL\|/dod\.json" tooling/ci/assert-app-dod.mjs
# 174: const REGISTER_REL = 'tooling/dod-register.json'
# 683:   const recRel = `${appDir}/dod.json`;      ← a FIXED path; a sibling file is invisible
sed -n '5,6p' apps/subscriptiontracker/dod-flip-draft.json
# "🔴 THIS FILE IS NOT A DONE-RECORD AND NOTHING READS IT."
```

What was missed: its step 9 (*"DELETE THIS FILE … in the same commit"*) is **step 9 of 9**, and steps
1–8 have not run. The file is the owner's drafted-and-measured input to a **DoD flip that has not
happened**:

```bash
grep -n '"status"' apps/subscriptiontracker/dod.json          # → 66:  "status": "stamped"     (not "claiming-done")
grep -n "apps/subscriptiontracker" tooling/ci/assert-app-dod.mjs | grep -i exempt   # → still exempt
```

Deleting it now destroys 44 KB of measured draft strings the owner is supposed to sign, and the two
`EXEMPT` sets it instructs the flip to edit are still in place. **HOLD. → Owner question Q7.**

### 1.6 A DEAD *row*, not a file — and the guard asks for it on every run

`tooling/scripts/assert-no-dead-files.mjs` lines 323-331: the `human-entry-point` waiver for
`tooling/release/RELEASE-RUNBOOK.md` is **stale**, and the guard says so itself, every time:

```bash
node tooling/scripts/assert-no-dead-files.mjs
#   note  tooling/release/RELEASE-RUNBOOK.md is waived but `path-reference` now reaches it
#         — a real consumer exists, so the row can go.
```

That note exists, in the guard's own words, *"precisely so a row cannot quietly outlive its reason"*.
Deleting the row is a **9-line diff, no file removed, and the guard stays green** — it drops the
exemption table from 3 rows to 2, which is the direction the header says it should move
(*"It starts large and shrinks"*). **Take it in the anchors commit (§6 step 1).**

---

## 2 · ARCHIVE-THEN-DELETE — pin at a tag first

Four files. Each is a **record or a policy** rather than a mechanism, and each is worth reading back.

### Proposed tag: `pre-prune-2026-09-08`

Annotated, on the commit that is `main` immediately before the first prune commit, mirroring the
sister repo's `pre-prune-2026-09-08` / `pre-minimal-2026-09-08` pair so one recovery idiom covers both
repositories:

```bash
git show pre-prune-2026-09-08:<path>            # one file
git checkout pre-prune-2026-09-08 -- <dir>      # a whole directory
```

⚠️ **This repo has no archive-tag convention yet.** Its only two tags are wip handoffs —
`ref/app-shell-2026-09-07`, `ref/cutover-blockers-wip-2026-09-07` — so `pre-prune-2026-09-08` either
adopts the sister repo's idiom or becomes `ref/pre-prune-2026-09-08`. **Owner question Q5.**

✅ **Unlike the Private repo, this one has a remote** (`github.com/globalonlinedeveloper/Nikatru_Platform_Public`),
so a pushed tag is a second copy. The Private repo's single-disk caveat does not apply here.

### 2.1 `extensions/MIGRATION.md` — 31 640 bytes, 501 lines

The `_skeleton/` → `templates/tool/` rename record, landed **2026-08-14**, before the subtree merge.
Its own §STATUS says: *"§0, §1, §2 and §5 describe a state that no longer exists; they are kept as the
record of the window, not as instructions."* §3 (the reasoning) is the only timeless half.

```bash
git log -1 --format='%ad %h %s' --date=short -- extensions/MIGRATION.md
# 2026-09-05 15b7faa5 Add 'extensions/' from commit 'bb4453d9...'   ← untouched since import
```

Nothing machine-reads it; every reference is prose in sibling extension docs.

### 2.2 `extensions/SECURITY.md` — 5 881 bytes

🔴 **This is not merely inert, it CONTRADICTS the live policy.** GitHub surfaces only the root
`SECURITY.md`, and `tooling/ci/assert-repo-posture.mjs` binds that one to the published contact page
and to `AppConfig.supportEmail`:

```bash
grep -an "SECURITY.md names no email" tooling/ci/assert-repo-posture.mjs
# 139:  problems.push('SECURITY.md names no email address at all. It describes a process with no way to start it.');
```

| | root `SECURITY.md` (live, guarded) | `extensions/SECURITY.md` (inert) |
|---|---|---|
| Channel | **Email `support@nikatru.com`** | GitHub private vulnerability reporting |
| Email alias | required by the guard | *"No security email address is published, **deliberately**."* |

Two policies, one repository, one of them unreachable. **Owner question Q2** decides whether the
extensions-specific *content* (per-extension version, `chrome://extensions`, browser+OS) is folded into
the root file before this goes.

### 2.3 `extensions/.github/pull_request_template.md` — 6 904 bytes

**Inert as a template** (GitHub reads only `<root>/.github/PULL_REQUEST_TEMPLATE.md`, which exists and
is 56 lines), **but load-bearing as a record**: line 62 is the *"No network"* compliance claim, cited
by name:

```bash
git grep -n "pull_request_template" -- . ':!extensions/.github'
# extensions/Extension/Full_Screen_Shot/publish/COMPLIANCE-CHECKLIST.md:723:
#   **`.github/pull_request_template.md`, the "No network" checkbox (~line 62)** — describes the claim as ...
```

The root template carries no network clause:

```bash
grep -ni "network" .github/PULL_REQUEST_TEMPLATE.md    # → (no output)
```

**Fold the extension-specific checkboxes into the root template first, then delete.** Deleting it
alone silently drops a stated store-compliance control.

### 2.4 `extensions/.githooks/pre-commit` — 28 190 bytes, 484 lines

**Inert.** Git honours exactly one `core.hooksPath` per repository, and
`tooling/scripts/install-hooks.mjs` points it at the ROOT `.githooks/`:

```bash
sed -n '52,55p' tooling/scripts/install-hooks.mjs
# const REPO  = resolve(HERE, '..', '..');
# const HOOKS = join(REPO, '.githooks');

ls .githooks/            # pre-commit  pre-push   ← the live pair
```

Every install instruction that names it (`extensions/README.md:85`, `extensions/CONTRIBUTING.md:82`)
is therefore **wrong today**: `git config core.hooksPath .githooks` from the repo root selects the root
hook, not this one.

⚠️ **One real dependency, and it is why this is archive-then-delete and not DEAD.**
`extensions/scripts/secret-scan.mjs:194` declares itself *"Kept at parity with `CONTENT_RE` and
`PATHS_RE` in `.githooks/pre-commit`"*, and the root hook is 70 lines of spec-guard runner that carries
neither pattern. **The parity partner disappears with this file.** Either promote the two regex blocks
into `secret-scan.mjs` (or the root hook) in the same commit, or keep it. **Owner question Q3.**

---

## 3 · KEEP — the load-bearing set

One line each on *why*, so a later reader does not re-litigate it.

| Path | Files | Why it stays |
|---|---|---|
| `sites/` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` | 64 + 2 | 🔴 **LIVE DEPLOY SOURCE AND THE ONLY COPY.** Cloudflare Pages builds both domains from this tree via a Git integration held in the Cloudflare dashboard, not in any file. `assert-lane-coverage.mjs` also cross-checks the workspace members. Removing anything here takes a domain dark. |
| `.github/workflows/**` | 16 | The whole pipeline. `assert-guard-coverage.mjs` derives its subject set *from* these files. |
| `tooling/ci/**` | 343 | 158 guards, **all 158 accounted for** by `assert-guard-coverage.mjs`; 184 tests under a **ratchet at 6873 cases / 171 files** (`tooling/ci/test/coverage-manifest.json`). Deleting one test file trips the ratchet RED. |
| `tooling/ci/test/fixtures/**` | — | Fixtures that deliberately name dead repos exist to prove the guards catch them; `tooling/dead-repos.json` declares `tooling/ci/test/` as an `excludedPath` for exactly that reason. |
| `tooling/bricks/**` | 124 | Mason brick templates — the app stamper's source. Walked by `mason`, so no reference to a member will ever exist. |
| `extensions/core/v1/*`, `extensions/templates/tool/lib/*`, `.../test/pixel-sim/*` | — | **NOT duplicates.** Core is *vendored, not linked*, by design (`extensions/scripts/sync-core.mjs` header, spec §2.3), and `check-core-sync.mjs` / `check-contracts-sync.mjs` fail the moment a vendored copy is hand-edited. `diff` shows them differing because they are per-tool pins, which is the intended state. |
| `extensions/Extension/Full_Screen_Shot/i18n/tm/**` (55) and `i18n/backtranslations/**` (54) | 109 | **The translation SOURCE, not output.** `_locales/make-locales.mjs:80-81` reads both directories to build `_locales/`. My first mechanical sweep flagged all 109 as unreferenced — they are read by directory walk. A worked example of why "nothing greps it" is not evidence. |
| `extensions/.github/ISSUE_TEMPLATE/bad-page.yml`, `bug.yml` | 2 | **Live CI subjects.** `.github/workflows/extensions.yml:331` greps both for every tool id under `defaults.run.working-directory: extensions`; a missing file makes the step exit 1. |
| `extensions/.gitignore` (222 lines), `extensions/.gitattributes` (92) | 2 | **Nested ignore/attribute files ARE live git behaviour** at any depth — unlike `.github/`, `renovate.json` and `.githooks/`. The ignore file blanket-ignores `.claude/` for the subtree; the attributes file governs `*.webm`/`*.ps1`/`*.cmd` line endings. |
| `extensions/docs/PUBLIC-PRIVATE.md` | 1 | **Current**, repointed 2026-09-06 for the merge and the repo deletions. Not a stale record. |
| `docs/legal/privacy-direct-marketing-draft.md` | 1 | "draft" in the filename, **signed diff in fact** — cited as the signed artefact by `tooling/legal/duty-matrix.json:188`. |
| `extensions/scripts/{sync-core,sync-contracts,gen-catalog,publish-cws-token}.mjs` | 4 | No workflow invokes them, **by design**: they are the *authoring* half whose CI half is `check-core-sync` / `check-contracts-sync` / `check-catalog`, plus a one-shot OAuth token minter. Reached by `assert-no-dead-files`. |
| `tooling/ops/set-monitor-thresholds.mjs`, `services/platform/.dev.vars.example` | 2 | The repo's only two named waivers, each with a dated reason in the `EXEMPTIONS` table. `set-monitor-thresholds.mjs` is `kind: 'operator-tool'` (dated 2026-08-17), and the guard **excludes itself as a reference source** (`const SELF`, line 817), so the waiver is not self-satisfying. |
| `tooling/ops/await-pr-checks.mjs` | 1 | Looks orphaned; is not. Header lines 13-15: *"**NOT A CI STEP, ON PURPOSE** — a check that runs inside CI cannot detect the absence of CI."* Carries a 19 KB test. |
| `tooling/scripts/check-agent-docs.mjs` | 1 | **Unwired — and it landed hours ago.** No workflow, no hook, no `enforcement-index` row, no test (`git grep -n -F check-agent-docs` returns only the baseline file it writes itself). Commit `9b4cd308`, **2026-09-08**, *"a doc-hygiene guard that warns before it bites"*; all five limbs are `warnLimbs` with `promoteOn: 2026-09-22`. **The repair is a CI step and a test, not a deletion.** |
| The 12 LIBRARY / IMPORTED / NOT-CI-RUNNABLE modules in `enforcement-index.json` | 12 | Each verified to have ≥1 non-test importer. The thinnest are `worker-shared-modules.mjs` (2) and `build-enforcement-index.mjs` (1, imported by `assert-enforcement-index.mjs`); both are real. |
| `tooling/ci/test/fixtures/**` | 12 | All read. The `dirty-strings/` `.dart` files are reached by **directory walk** — the test points the guard at the directory, not at each file. The two `README.md` are reached by the `tool-convention` resolver (`assert-no-dead-files.mjs:455`). |
| Every JSON register under `tooling/` | 34 | All 34 have ≥1 real reader, verified by `grep -n "REGISTER_REL\|DECL_REL\|LEDGER_REL" tooling/ci/*.mjs` plus `tooling/ops/check-prod-provenance.mjs:558` and `tooling/content_pipeline/src/sign.mjs:71`. |
| `tooling/scripts/install-hooks.mjs:162`, `tooling/ops/safe-rerun.mjs:267` | — | Both name a dead repo **deliberately**: `install-hooks.mjs` keeps `PRIVATE_WAS` as evidence for its leftover test and installs nothing into it (lines 155-159); `safe-rerun.mjs` reads the **live vault key** `Project_Cross_Platform_Apps_GITHUB_PAT`, protected by `dead-repos.json → allowedSuffixes`. Renaming either breaks `gh` auth or a test. |
| `.ignore` (207 lines) | 1 | ripgrep-only overrides. 205 lines are dated narrative and one line (`!CLAUDE.md`) is active — but see Q6. |
| `packages/**` + `services/**` Dart/TS source | 262 + 135 | **Zero unimported files.** Every basename with no static importer resolves: four are conditional-import arms (`grep -n "if (dart.library" packages/notifications/lib/src/local_notification_service.dart`), `nikatru_lints.dart` is a package entry whose payload is `lib/analysis_options.yaml` (10 `package:nikatru_lints/analysis_options.yaml` hits), `gen_pack_keypair.dart` is cited by `pack_verifier.dart:24`, `c6_consent_live_probe.dart` by `assert-no-gate-weakening.mjs:189`. Minimum inbound-import count across `apps/subscriptiontracker/lib` is **1**, never 0. |
| `apps/subscriptiontracker/store/**` | 66 | All 66 covered. The nine files with no by-path reference (the eight Play screenshots + `screenshots-tablet/CAPTURE.json`) are reached **per directory** by `store-screenshots.yml:89,105` and `assert-play-device-coverage.mjs`; `assert-listing-assets.mjs` additionally reads their **pixels**. Deleting one turns the device-coverage guard red. |
| The twinned Worker modules and forked screens | — | **Every apparent duplicate in `services/`, `packages/` and `apps/` is an ENFORCED copy**, each with its own guard: `services/platform/test/twinned-worker-modules.test.ts` (shared-home + compared-twin limbs, with floors), `assert-lint-inheritance.mjs` (nine identical `analysis_options.yaml`), `assert-no-seam-forks.mjs` (*"3 accepted fork(s) at parity, 9 watched"*, `MIN_ACCOUNTED_PAIRS = 12`), `assert-entitlement-contract.mjs:228,1073` (`contracts/entitlement/contract.js` ≡ `extensions/core/v1/entitlement-contract.js`, mutation-tested). |
| `packages/chassis_screens/**` | 32 | 🔴 **No app imports it** (`grep -c nikatru_chassis_screens apps/subscriptiontracker/pubspec.yaml` → 0) — and that is **by design**: it ships to every app stamped from `tooling/bricks/app`, while subscriptiontracker predates the chassis and carries *declared forks* held at parity. Listed here so nobody later reads "no app imports it" as a deletion licence. |
| `contracts/**`, `catalog/**` | 17 + 4 | All three consumer families verified: Workers (`services/platform/src/lib/mor/contract.ts:69`), Dart (`generate-dart.mjs` → `entitlement_contract.g.dart`, drift-checked `--check`), extensions (byte-identical mirror). `contracts/tokens/dtcg/*.json` are consumed by a **glob** — `packages/tokens/style-dictionary.config.mjs:392` `source: ['../../contracts/tokens/dtcg/**/*.json']` — with the emitted artefacts diff-gated at `ci.yml:518-550`. |
| Fixtures under `packages/core/test/`, `services/*/test/` | — | Every one is glob-loaded with a **COVERAGE-LOST assertion if the glob empties** — e.g. `services/platform/test/insights-equivalence.test.ts:77` + `:388`, `insights-queries.test.ts:91` + `:371`. Deleting a fixture is caught, not silently absorbed. |

### 3.1 The "references the deleted extension repos" class is already CLOSED

```bash
node tooling/ci/assert-no-dead-repo-names.mjs
# assert-no-dead-repo-names: 61 machine-read file(s) scanned against 11 dead repository name(s)
# ✓ no live surface names a dead repository.
EXIT 0
```

18 tracked files still contain `Nikatru_Extensions_Public` / `_Private`, and **every one is a dated
record, a guard comment, a fixture or a declared exclusion** — `tooling/dead-repos.json` (13, the
register itself), `tooling/ci/test/dead-repo-names.test.mjs` (12, the guard's own mutation fixtures),
`catalog/store-matrix.json` (a declared `excludedPath` holding `deletionRecord20260819`), and prose in
`extensions/README.md`, `docs/ci/extensions.md`, `.github/workflows/renovate.yml`. **Nothing to prune;
the class is handled structurally by the register plus its one guard**, which is the pattern this plan
should imitate rather than replace. The floor (`files: 8`, `repos: 11`) has ample headroom at 61.

---

## 4 · UNCERTAIN — needs an owner decision

| # | Subject | The specific question |
|---|---|---|
| **Q1** | `extensions/.github/ISSUE_TEMPLATE/` (6 files, incl. the two CI-live ones) | **This repository currently offers its users NO issue forms** — the root `.github/` has no `ISSUE_TEMPLATE` directory, so all six imported forms are invisible on GitHub while two of them are still graded by `extensions.yml:331`. Do we **(a)** promote the set to `<root>/.github/ISSUE_TEMPLATE/` and repoint the workflow's `working-directory` for that step, restoring the forms; or **(b)** delete all six and delete the *"Issue templates list every tool id"* step **in the same commit** (Private rule 3 — a guard whose subject is gone passes vacuously)? Option (b) removes a real control; (a) costs one workflow edit. |
| **Q2** | `extensions/SECURITY.md` vs root `SECURITY.md` | The two state **opposite** vulnerability-reporting policies (published email vs deliberately no email). Only the root one is reachable and guarded. Which policy is correct — and if the extensions' GitHub-private-reporting channel is preferred, does `assert-repo-posture.mjs`'s "must name an email" limb change with it? |
| **Q3** | `extensions/.githooks/pre-commit` | It is inert (one `core.hooksPath`, root wins), but it is the declared parity partner for `extensions/scripts/secret-scan.mjs`'s `CONTENT_RE`/`PATHS_RE`. Promote the two pattern blocks into `secret-scan.mjs` or the root hook first, or keep the file as the reference implementation? |
| **Q4** | `extensions/README.md:85`, `extensions/CONTRIBUTING.md:82` | Both instruct `git config core.hooksPath .githooks`, which from the repo root now selects the **root** hook. Correct the instruction, or delete it? (Independent of Q3.) |
| **Q5** | Tag naming | `pre-prune-2026-09-08` (matches the sister repo, one idiom across both) or `ref/pre-prune-2026-09-08` (matches this repo's existing two tags)? |
| **Q6** | `.ignore` | 207 lines, of which **one** (`!CLAUDE.md`) is active; the rest is a dated narrative of five superseded negations. It is a working config file whose own text argues that an inert rule left in place is worse than none. Trim to the active line plus a pointer, or keep the record inline? (No file-count change either way.) |
| **Q7** | `apps/subscriptiontracker/dod-flip-draft.json` (44 KB) | **Has the subscriptiontracker DoD flip happened?** `dod.json` still reads `"status": "stamped"` and both `EXEMPT` sets still name `apps/subscriptiontracker`, so **no** — steps 1–8 of the file's own checklist are outstanding and step 9 (delete) is not yet due. Does the owner still intend to run the flip (→ KEEP until then, and the file is doing its job), or is the flip abandoned (→ delete the draft **and** say so in `dod.json`, so the record does not silently keep pointing at a plan nobody will execute)? <br><br>✅ **ANSWERED 2026-09-08 — OWNER RULING: KEEP THE FLIP, TO BE DATED LATER.** The first branch: the flip is *intended*, not abandoned, and the date is the owner's to set. So `apps/subscriptiontracker/dod-flip-draft.json` and `apps/subscriptiontracker/dod.json` are both **KEEP, untouched** — the draft is a live input to work that has not run, not a leftover, and neither file may be edited to "tidy" the open state. Steps 1–8 remain outstanding and step 9 (delete) is still not due. Q7 is **CLOSED**; it needs no further owner input, and the retraction in §1.5 stands as correct. |
| **Q8** | `apps/subscriptiontracker/assets/icon/app_icon_maskable.svg` | Its two siblings are consumed by `tooling/store/render-play-graphics.mjs:124-125`; this one is not. `flutter_launcher_icons` reads only `app_icon_1024.png`, and `web:` is `generate: false` (`pubspec.yaml:235-242`), stating the web maskable master lives at `nikatru/logo/nikatru-icon-maskable.svg` — **outside this repository**. Is this the hand-regenerated vector master for `apps/subscriptiontracker/web/icons/Icon-maskable-{192,512}.png` (→ KEEP; no automated consumer is correct for a design source), or a stray copy of the brand-corpus master? ⚠️ It is also enumerated in a **WCAG 1.4.9 evidence record** at `tooling/dod-register.json:615`, so removing it edits an accessibility claim. |
| **Q9** | `contracts/entitlement/contract.schema.json` | `contracts/entitlement/README.md` says it *grades* `contract.json`, but **no validator ever loads it** — the only two occurrences of the name are the `$schema` string `generate.mjs:33` writes into the output and the same string in a test fixture; `grep -n schema tooling/ci/assert-entitlement-contract.mjs` returns prose only. Is it an editor/IDE affordance (→ KEEP as-is, and correct the README's claim), or was a validation limb intended and never wired (→ the repair is a **validation step, not a deletion**)? |
| **Q10** | `tooling/dead-repos.json → scan.globs` | The scan set is `.github/workflows/**/*.yml`, `**/*.yaml`, `tooling/**/*.json`, `renovate.json`, `**/package.json`, `catalog/**/*.json`, `extensions/catalog/**/*.json`. **`.mjs` is not in it** — so a dead repo name hard-coded on a live executable line (exactly the `install-hooks.mjs:162` shape) is invisible to the guard, while `_globsWhy` argues *"every one of these is READ BY A MACHINE"* and a `.mjs` is **executed** by one. Was `.mjs` excluded deliberately, or is this the same hole the guard was written to close? *(Widening it needs an allowlist for the two deliberate cases first — see §3.)* |
| **Q11** | `tooling/ci/assert-app-dod.mjs:276`, `tooling/ci/assert-green-means-ran.mjs:117` | Both hand-roll `parseWorkflow` beside `tooling/ci/workflow-scan.mjs`, whose header says it exists to abolish exactly that: *"the alternative is four copies that drift, and the FIRST thing that drifts in a workflow parser is which lines it can see at all — a failure that reports 'clean'."* 21 guards + 3 release scripts already import it; these two are the holdouts, and both carry the *same* comment about a past divergence. **This is a consolidation, not a deletion** — approve it as its own unit, re-running `walks-bounded` and `guard-coverage` after. *(`safe-rerun.mjs:449` also exports a `parseWorkflow`, but it parses top-level `concurrency:`/`name:` — a different subject, not a duplicate.)* |
| **Q12** | `tooling/scripts/check-agent-docs.mjs` | Landed 2026-09-08, warn-only, `promoteOn: 2026-09-22`, and **nothing invokes it**. Wire it into `ci.yml`'s `platform:` job with a test now, or leave it unwired until the promote date? Leaving it unwired means the promote date arrives on a guard that has never run in CI. |

---

## 5 · Which guards would go RED if the deletion landed

Measured, not predicted. **Green control first**, per the sister repo's method.

| Guard | Verdict for the §1 + §2 set | Why |
|---|---|---|
| `tooling/scripts/assert-no-dead-files.mjs` | 🟢 **stays green** | Its subject is *unreached* files. Deleting a reached file lowers the tracked count; it never creates a finding. Re-run after each commit — the summary line is a claim like any other. |
| `tooling/ci/assert-guard-coverage.mjs` | 🟢 **green** for §1+§2 — 🔴 **RED for any test-file deletion** | The ratchet in `tooling/ci/test/coverage-manifest.json` holds at **6873 cases across 171 files** and *may fall only in a commit that says why*. **Nothing in §1 or §2 is a test file.** This is the single largest tripwire in the repo: it is why `tooling/ci/test/` is out of scope. |
| `tooling/scripts/guard-sweep.mjs` | 🟢 green — 🔴 **RED if `extensions.yml`'s issue-template step is deleted without its subject, or vice versa** | It asserts COMPLETENESS over `tooling/ci`. Q1(b) must move both halves in one commit (Private rule 3). |
| `tooling/ci/assert-no-dead-repo-names.mjs` | 🟢 green | 61 files scanned against a floor of 8. Removing `extensions/renovate.json` removes nothing from the scan set — the `renovate.json` glob is root-anchored. |
| `.github/workflows/extensions.yml` → *"Issue templates list every tool id"* | 🔴 **RED** if `bad-page.yml` **or** `bug.yml` goes | `grep -qF` on a missing file exits non-zero → `fail=1` → step exit 1. This is why those two are in KEEP and the other three are in DEAD. |
| `extensions/scripts/discover.mjs` | 🟢 green, **one widened run** | `WIDENS_TO_ALL` names `.github/`, `.githooks/`, `.gitattributes`, `.gitignore`. Deleting inside them widens the matrix to **all** tools for that PR — slower, never red. |
| `tooling/ci/assert-update-coverage.mjs` | 🟢 green | It quantifies over the keys of `tooling/versions.json` against the **root** `renovate.json` customManagers. `extensions/renovate.json` contributes no key. |
| `tooling/ci/assert-repo-posture.mjs` | 🟢 green | Binds `<root>/SECURITY.md` only (`SECURITY_MD = join(repoRoot, 'SECURITY.md')`, line 63). Deleting `extensions/SECURITY.md` is invisible to it — which is the point of Q2. |
| `tooling/scripts/assert-public-citations.mjs` | 🟢 green — ⚠️ **and that is a GAP, not a pass** | See §5.1. |
| `tooling/scripts/check-agent-docs.mjs` | 🟢 green | Baseline `.agentdocs.baseline.json` carries exactly one frozen finding (`AGENTS.md` A-SIZE, 13623 B vs 12288 cap). Untouched by this plan — and nothing runs it anyway (§3). |
| `tooling/ci/assert-enforcement-index.mjs` | 🟢 green for §1+§2 — 🔴 **RED for any `tooling/ci/*.mjs` deletion** | It re-derives all 195 rows and compares **byte-for-byte**. Removing a guard requires `node tooling/ci/build-enforcement-index.mjs --write` **in the same commit** — this is Private rule 3 with a mechanical enforcer. |
| `tooling/ci/assert-case-count-honest.mjs` | 🔴 **RED for any test-file deletion** | `coverage-manifest.json`'s 171 keys are an **exact bijection** with `tooling/ci/test/*.test.mjs`. Deleting a test without deleting its key → `unarbitrated` → `coverageLost(…)` → exit 1. |

### 5.2 Every floor a deletion could trip, with its margin

| Register / constant | Now | Floor | Margin | What happens |
|---|---:|---:|---:|---|
| `tooling/dead-repos.json → floors.repos` | **11** | **11** | **ZERO** | `assert-no-dead-repo-names.mjs:214` → **exit 2 COVERAGE LOST** if any row goes. Consistent by design — `_theRule` says a name is *never* removed — but it is **the tightest floor in the tree**. |
| `tooling/dead-repos.json → floors.files` | 61 | 8 | 53 | `:213` exit 2 |
| `tooling/ci/test/coverage-manifest.json` | 171 files / 6873 cases | bijection | 0 | exit 1 (above) |
| `tooling/enforcement-index.json` | 195 rows | equality | 0 | exit 1 (above) |
| `assert-guards-refuse-empty.mjs:159 → MIN_EXECUTABLES['tooling/scripts']` | 12 | 8 | **4** | exit 2 — deleting 5 of the 12 `tooling/scripts/*.mjs` breaks it |
| `assert-guards-refuse-empty.mjs:159 → MIN_EXECUTABLES['tooling/ci']` | 158 | 120 | 38 | exit 2 |
| `assert-guards-refuse-empty.mjs:165 → MIN_PROBED` | 150 | 110 | 40 | exit 2 |
| `assert-no-dead-files.mjs:601 → MIN_TRACKED` | 2063 | 900 | large | exit 2 |
| `tooling/chassis-ledger.json → totals` | `{files:117, lines:16687, unclassified:0}` | equality | 0 | any brick-tree file change must move these |
| `tooling/legal/data-inventory.json → minErasureRowsChecked` | — | 14 | — | `assert-erasure-reach.mjs` |
| `tooling/legal/asset-register.json → minPubspecs` | — | 10 | — | `assert-content-licences.mjs` |
| `tooling/legal/policy-claims.json → claims[19/29/30].assert.walk.minFiles` | — | 5 / 10 / 10 | — | `assert-policy-claims.mjs` |

**None of the §1 or §2 files touches any of these.** Every one of them sits under `tooling/`, which
this plan leaves alone — and that is the reason it leaves it alone.

### 5.1 🔴 The one structural gap this plan uncovers

The Private repo's **rule 1** — *a citation to a removed file is PINNED, not deleted* — **cannot be
executed in this repository today.**

`tooling/scripts/assert-public-citations.mjs` grew a tag-pin limb on 2026-09-08 (commit `89dc3aa6`),
but it resolves **only** citations carrying the `Private/` logical prefix, and **only** against the
private corpus:

```
tooling/scripts/assert-public-citations.mjs:511  const LOGICAL_PREFIX = 'Private/';
tooling/scripts/assert-public-citations.mjs:604  r = repoGitRaw(PRIVATE, ['cat-file', '-e', key]);
```

A path *inside this repo* that appears in tracked prose is checked by **no guard at all**. So:

- deleting `apps/subscriptiontracker/dod-flip-draft.json` leaves `apps/subscriptiontracker/dod.json:46,143` naming a path that no
  longer exists, and **nothing goes red** — the failure the Private repo's rule 1 exists to prevent,
  arriving through the door of a *missing* guard rather than a broken one;
- the same applies to every prose mention of `extensions/MIGRATION.md`, `extensions/SECURITY.md` and
  `extensions/.githooks/pre-commit`.

**Recommendation, and it should land BEFORE any deletion:** give `assert-public-citations.mjs` a
PUBLIC limb — a repo-local path in tracked prose must either exist on disk or be written
`<tag>:<path>` and resolve with `git cat-file -e` against **this** repo — with its own negative test,
exactly as the private limb got one. This is the mirror of the ⚠️ the sister repo's
`docs/areas/history.md` records against itself ("nothing PRIVATE resolves a corpus-path citation yet"),
and it is cheap here because the tag will be **pushed to a remote**, which the private tags are not.

---

## 6 · Execution order, if the owner says go

Each step is one green commit. Private rules 3 and 4 are what fix the order.

1. **Anchors and guards re-base ALONE, while every file is still on disk.**
   `assert-public-citations.mjs` gains its public tag-pin limb + negative test (§5.1). Green.
2. **Tag.** `git tag -a pre-prune-2026-09-08 -m '…'` on that commit, and **push it** — the remote is
   the second copy this repo has and the sister repo does not.
3. **`extensions/renovate.json`** deleted alone. Green.
4. **The three inert issue forms** (`config.yml`, `feature.yml`, `new-tool.yml`) deleted alone —
   *after* Q1 resolves the fate of `bad-page.yml`/`bug.yml`, and if Q1 chooses (b), the
   `extensions.yml` step retires **in the same commit** as its subject.
5. **`apps/subscriptiontracker/dod-flip-draft.json` is NOT in this sequence.** It leaves the tree only as step 9 of
   its own flip checklist, in the flip's own commit — Q7.
6. **The four archive-then-delete files**, each with its fold-forward done first: Q2 for
   `SECURITY.md`, Q3 for the hook's regex blocks, the network checkbox into the root PR template for
   `pull_request_template.md`.
7. **Re-run and read the artefact, not the exit line** — `assert-no-dead-files`, `guard-sweep`,
   `assert-guard-coverage`, `assert-no-dead-repo-names`, and capture each exit code **on its own
   line** (a `$?` printed beside `$(basename …)` is basename's status).
8. **Record it.** One dated section in `AGENTS.md`, the before/after counts, and the recovery command
   — the sister repo's `docs/areas/history.md` is the shape.

---

## 7 · The honest conclusion

**`Nikatru_Platform_Public` is already pruned.** It was pruned continuously, by construction, by a
merge-gated guard that walks the entire tracked manifest and by a guard-coverage ratchet that refuses
to let a test quietly disappear. There is no `research/`, no `plans/`, no `notes/`, no `archive/` here
— the analogous material lives in the sibling private corpus, which is exactly why that repo could
lose 71 % of its files today and this one cannot.

The four genuinely dead files are all **artefacts of one event**: the `git subtree add` of 2026-09-05
(`15b7faa5`, importing `bb4453d9` from the now-deleted `Nikatru_Extensions_Public`). **522 of the 554
files under `extensions/` are byte-for-byte as imported** —

```bash
comm -23 <(git ls-files extensions | sort) <(git diff --name-only 15b7faa5 HEAD -- extensions | sort) | wc -l
# 522
```

— and the merge correctly rewired the *mechanisms* (three workflows folded into `extensions.yml`,
Renovate repointed, dead repo names registered and guarded) while leaving the *root-only artefacts*
behind, because nothing in the tree can tell that a file GitHub reads at the root has stopped being
read one directory down. **That is the class this pass found, and it is the only one.**

The real value in this plan is therefore not the eight files. It is §5.1: **this repository cannot yet
pin a citation to its own deleted path**, and until it can, every deletion here silently degrades the
prose that points at it.

### 7.1 The one methodological warning this pass earned

Three separate mechanical sweeps run for this plan produced **false positives that a careless reader
would have deleted**, and they are worth stating because they are the failure mode of any prune:

| The sweep said | The truth |
|---|---|
| 109 files under `Full_Screen_Shot/i18n/{tm,backtranslations}/` are unreferenced | They are the translation **source**, read by directory walk at `_locales/make-locales.mjs:80-81` |
| `test/pixel-sim/history-harness.js` is referenced by nothing | `pixel-sim/run.js:28` does `require('./history-harness')` — **extensionless**, so it matches no tracked path |
| 48 Flutter/Dart tests and all of `apps/subscriptiontracker/{ios,android,macos,windows}` are unreferenced | Discovered by `flutter test` / Gradle / Xcode **by convention**; no reference will ever exist |
| `chassis_localizations.dart` is a broken import | Deliberately **gitignored gen-l10n output** (`.gitignore:226`), regenerated and byte-compared in `ci.yml`'s `workspace-gate` |
| `apps/subscriptiontracker/dod-flip-draft.json` says *"NOTHING READS IT"* and orders its own deletion | Step **9 of 9**; steps 1–8 have not run |

**"Nothing greps this file" is not evidence.** In this repository the only sound evidence of death is
either a resolver-level answer from `assert-no-dead-files.mjs --why`, or a demonstration that the
platform reading the file (GitHub, Renovate, git) does not read it at that path. Every DEAD row in §1
rests on the second kind.

---

### Appendix — commands used, so any claim above can be re-run

```bash
git ls-files | wc -l                                        # 2063
node tooling/scripts/assert-no-dead-files.mjs               # EXIT 0, 2 waived
node tooling/scripts/assert-no-dead-files.mjs --list        # per-file resolver tags
node tooling/scripts/assert-no-dead-files.mjs --why <path>  # why one path is reached
node tooling/ci/assert-guard-coverage.mjs                   # EXIT 0, ratchet 6873/171
node tooling/scripts/guard-sweep.mjs                        # EXIT 0, 158 accounted for
node tooling/ci/assert-no-dead-repo-names.mjs               # EXIT 0, 61 files vs floor 8
node -e "const j=require('./tooling/enforcement-index.json'); \
  const s={}; j.forEach(e=>s[e.state]=(s[e.state]||0)+1); console.log(j.length, s)"
# 195 { WIRED: 180, 'NOT-CI-RUNNABLE': 2, IMPORTED: 1, LIBRARY: 11, HELD: 1 }
```

🔴 Capture every exit code on its own line. `$?` after a pipe is the last stage's status, and a script
ending in `grep -c` exits 1 on **zero** matches — read the artefact before reporting a failure.
