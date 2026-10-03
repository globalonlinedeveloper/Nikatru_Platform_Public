# CI — how the workflows are shaped, and the rules they have to obey

This is where the prose that used to live inside `.github/workflows/*.yml` now
lives. Those files carried 5,840 comment lines against 2,895 lines of executable
YAML (65%), including one 2,400-character comment inside a single YAML scalar.
The workflows keep a one-line `# why:` on each non-obvious decision; everything
that explains, retracts or records a measurement is here.

---

## 1. One run per pull request

`ci.yml` triggers on `push` to `main` **only**, plus `pull_request` on every
branch. It used to trigger on `push` to `main, feat/**, fix/**, chore/**` as
well, so a commit on a branch with an open PR fired two identical runs.

Measured over 2026-09-03 → 2026-09-05: 237 CI runs, **116 `push` + 121
`pull_request`**, about **31.6 runner-minutes per PR commit** for 15.8 minutes
of work.

This also retires the branch-prefix list instead of widening it. Of the last 300
merged PRs, only 208 (69%) used `feat|fix|chore/<slug>`; `chip/`, `refactor/`,
`docs/`, `test/`, `guard/`, `wave*/` and about 79 bare slugs were never on the
push filter and were covered only because `pull_request:` has no branch filter.
**A prefix list cannot cover a branch nobody has named yet.** The convention is
still `feat|fix|chore/<slug>` (see `.github/PULL_REQUEST_TEMPLATE.md`) — it is
now a convention rather than a gate, which is what it always actually was.

### 1.1 A draft pull request runs nothing (2026-10-03)

A stacked pull request (body `STACKED ON: #a, #b`) cannot merge until its bases
do, and every base merge re-ran its whole ~40-job CI: runner time spent on a PR
that could not land, shown as red or cancelled runs. Stacked PRs are now opened
as **drafts** and marked ready (`gh pr ready`) once every base has merged, and a
draft runs no CI at all:

- every `ci.yml` job with no `needs` carries
  `if: github.event.pull_request.draft != true`; a job that needs one inherits
  the skip. `ci-gate` carries `if: always() && github.event.pull_request.draft != true`,
  so on a draft it is skipped **with** its lanes instead of reading them skipped,
  and on every other event (a push, a dispatch, a ready PR) the predicate is true
  and nothing changes. GitHub refuses to merge a draft, so no gate is owed.
- `ready_for_review` is in the `pull_request` `types:`: readying the PR is the
  event that gives it its one full run.
- `codeql.yml`'s `analyze` skips drafts on the same predicate and also hears
  `ready_for_review`, because `security-scan`'s CodeQL PR rule waits for the
  analysis of the run that readies the PR.

`assert-green-means-ran.mjs` holds all of it (A1, A6, A10, A11): the predicates
byte for byte, a draft run that starts **zero** jobs on the parsed graph, a
ready_for_review run and a push to main that start every constituent and the
gate, and `ready_for_review` in every draft-skipping workflow's `types:`.

⚠️ The skipped `ci-gate` of a draft run satisfies branch protection, and the
ready run's `ci-gate` check exists only once its needs finish (about five
minutes in). In that window GitHub alone would allow a merge. The lander does
not: `land-rules.mjs` `gateVerdict` reads only SUCCESS as green, and a newer run
on the head makes the older gate STALE. A hand merge waits for the ready run's
`ci-gate` the same way.

## 2. `concurrency` — why `cancel-in-progress` is an expression

```yaml
cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

False on `main`, true everywhere else. Every push to `main` resolves to the same
concurrency group, so a plain `true` lets a later push kill the run in flight —
and a cancelled run notifies nobody and blocks nothing, which is how the deploy
gate was left waiting on a run that no longer existed. PR events resolve to
`refs/pull/N/merge`, so a superseded PR push *is* cancelled, which is what you
want.

`tooling/ops/safe-rerun.mjs` parses this key by name and refuses a re-run that
would evict a live run for the branch tip. A `false` mutant of this line is
caught by `safe-rerun`'s own suite; an **expression** mutant is not — the parser
collapses any `${{ … }}` to "cancelling". That gap is recorded, not closed: put
a bare `true` back and nothing in the tree goes red.

### 2.1 A red job cancels its own run, and stays red (FF-1, FF-2)

A gate run with one red job is already a red run: `ci-gate` needs every job and
reads `cancelled` as red, and `deploy-web` / `deploy-workers` need `ci-gate`. So
the first red job cancels the rest of the run (FF-1, #1010). **FF-2 moves the
cancel out of the red job.** FF-1 ran it as the red job's own last step, while
that job was still in progress, so GitHub cancelled the red job too: on six PR
runs measured 2026-09-28 (36385207366, 36385190242, 36385455698, 36384843524,
36381560476, 36383273759) every job read `cancelled` except the aggregators,
the red job was found only in the annotations, and `gh run view --log-failed`
printed nothing. Now every gate job `<lane>` has a follow-up job right after it:

```yaml
ff-<lane>:
  name: fail-fast · <lane>
  needs: <lane>
  if: failure() && needs.<lane>.result == 'failure'
  runs-on: ubuntu-24.04
  timeout-minutes: 2
  permissions:
    actions: write
  steps:
    - name: <lane> is red, so the rest of this run is cancelled (FF-2)
      env:
        GH_TOKEN: ${{ github.token }}
        RED_JOB: <lane>
      run: |
        echo "::notice title=FF-2 fail-fast::job '${RED_JOB}' is red and keeps its failure; …"
        gh run cancel "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" || true
```

GitHub starts a job only after every job it `needs` has concluded, so the
lane's `failure` is recorded before the cancel is sent. **The red job reads
`failure`; only the jobs still running read `cancelled`**, and the follow-up's
`::notice` names the red job in the run summary. It is still one API call, made
only on failure, and never a polling watcher: the `GITHUB_TOKEN` API limit is per
repository and the guards already spend it. The cost is a runner start (seconds)
between the red job ending and the cancel, and one skipped `fail-fast · <lane>`
line per lane on a green run. After the cancel `ci-gate` still runs (`always()`)
and goes red, and the deploys skip. The cancel fires on `main` too. By the time
any deploy starts, every gate job has finished, so no follow-up can fire.

- **Why not one fail-fast job over every lane:** a job starts only after ALL of
  its `needs` have concluded, so `needs: [every lane]` would start when the
  slowest lane ends, which is exactly the time the cancel exists to save.
- **Why not a delayed cancel from the red job:** the runner kills a job's orphan
  processes and the hosted VM is discarded after the job, so a cancel sent after
  the job ends is a race with a deadline nobody has measured.
- **`needs.<lane>.result == 'failure'`:** `failure()` alone is true when any
  ANCESTOR failed, so when `prepare` is red every follow-up downstream of it would
  fire as well, naming a lane that was only skipped.
- **Matrix lanes run `fail-fast: true`** (`${{ github.event_name ==
  'pull_request' }}` in `extensions.yml`). The follow-up needs the whole matrix,
  so with fail-fast off the siblings of a red leg would run to the end before
  anything cancels. FF-1 cancelled them at once, and so does this: GitHub's own
  matrix fail-fast keeps the red leg `failure` and cancels its siblings.
- **In scope:** `ci.yml` and its callees `lane-workers.yml` and
  `extensions-ci.yml`, on every event. `build-platforms.yml` and `extensions.yml`
  publish on push, tag and dispatch, so there the follow-up's condition adds
  `&& github.event_name == 'pull_request'`. `build-platforms.yml` has no
  `pull_request` trigger today, so none of its jobs has a follow-up.
- **Never:** any job that deploys, publishes, releases, submits, migrates or
  uploads (derived from its id, its callee, its `environment:` or its steps), any
  aggregator (`ci-gate`, `ci-required`, `lane-verdict`,
  `extensions-lane-accounting`), and every workflow outside that list (ops-watch,
  e2e, deploy-\*, submit-\*, redeploy-stranded, renovate among them).
  `codeql.yml` is a **sole-job** exception: its one job has no sibling to cancel.
  No job cancels from inside itself.
- **Permissions:** only the follow-ups grant `actions: write`, and nothing else.
  They check nothing out. A call job grants it too, because a callee job cannot
  hold more than its caller grants, and GitHub refuses the whole run at startup
  when one asks. ⚠️ `actions: write` also authorises `workflow_dispatch`; it now
  sits on a two-line job, not on every gate job.
- **Not a constituent:** a follow-up is skipped on every green run and decides
  nothing. `assert-green-means-ran` exempts the class from `ci-gate`'s and the
  callee verdicts' `needs`. The class is `failFastLane` in
  `tooling/ci/workflow-scan.mjs`, and it is narrow on purpose: one step, and that
  step only the notice and the cancel.
- **Not covered:** a job that hits `timeout-minutes` is marked cancelled, so its
  follow-up does not fire (`ci-gate` still reads it red).
  `tooling/ops/triage-failed-runs.mjs` files a cancelled run under the job whose
  failing step concluded `failure`. That still holds for FF-1-era runs, where the
  red job itself read `cancelled`.

`tooling/ci/assert-failfast-coverage.mjs` grades all of it.

## 3. The lane map

<!-- BEGIN GENERATED: gen-ci-map lane-map -->
<!-- why: GENERATED by node tooling/ci/gen-ci-map.mjs --write. Never hand-edit. -->
`ci.yml` runs **44** jobs, and **21** of them are in `ci-gate`'s `needs`.

| job | its `name:` | its `needs` | job-level `if:` | in `ci-gate`'s `needs` |
|---|---|---|---|---|
| `lane-workers` | lane-workers | — | yes | yes |
| `guard-tests` | Guards — the guards can still fail (shard ${{ matrix.shard }}) | — | yes | yes |
| `ff-guard-tests` | fail-fast · guard-tests | `guard-tests` | yes | **no** |
| `guard-tests-floor` | Guards — every shard ran, and ran at least the floor | `guard-tests` | — | yes |
| `ff-guard-tests-floor` | fail-fast · guard-tests-floor | `guard-tests-floor` | yes | **no** |
| `guard-meta` | Guards — the guards can still fail | — | yes | yes |
| `ff-guard-meta` | fail-fast · guard-meta | `guard-meta` | yes | **no** |
| `guards-platform` | Guards — platform, data and ops | — | yes | yes |
| `ff-guards-platform` | fail-fast · guards-platform | `guards-platform` | yes | **no** |
| `guards-legal` | Guards — privacy, legal and money | — | yes | yes |
| `ff-guards-legal` | fail-fast · guards-legal | `guards-legal` | yes | **no** |
| `guards-store` | Guards — store, release and versioning | — | yes | yes |
| `ff-guards-store` | fail-fast · guards-store | `guards-store` | yes | **no** |
| `guards-chassis` | Guards — chassis, app surface and packages | — | yes | yes |
| `ff-guards-chassis` | fail-fast · guards-chassis | `guards-chassis` | yes | **no** |
| `security-scan` | Security — secret and workflow scanners | — | yes | yes |
| `ff-security-scan` | fail-fast · security-scan | `security-scan` | yes | **no** |
| `site-tokens` | Design tokens (build + drift, all three outputs) | — | yes | yes |
| `ff-site-tokens` | fail-fast · site-tokens | `site-tokens` | yes | **no** |
| `site-shared` | Shared site build | — | yes | yes |
| `ff-site-shared` | fail-fast · site-shared | `site-shared` | yes | **no** |
| `content-gate` | Content pipeline (recipe -> pack -> sign -> gate) | — | yes | yes |
| `ff-content-gate` | fail-fast · content-gate | `content-gate` | yes | **no** |
| `app-brick` | App brick (stamp both variants + analyze + validate the clone contract) | — | yes | yes |
| `ff-app-brick` | fail-fast · app-brick | `app-brick` | yes | **no** |
| `sites` | Static sites (functions parse + required files) | — | yes | yes |
| `ff-sites` | fail-fast · sites | `sites` | yes | **no** |
| `workspace-gate` | Workspace gate (melos analyze + test) · ${{ matrix.part }} | — | yes | yes |
| `ff-workspace-gate` | fail-fast · workspace-gate | `workspace-gate` | yes | **no** |
| `prepare` | Derive the app set from the pub workspace | — | yes | yes |
| `ff-prepare` | fail-fast · prepare | `prepare` | yes | **no** |
| `app-dryrun` | Store submission dry runs | `prepare` | — | yes |
| `ff-app-dryrun` | fail-fast · app-dryrun | `app-dryrun` | yes | **no** |
| `android-artifacts` | Android artifacts (built, inspected, discarded) | `prepare` | — | yes |
| `ff-android-artifacts` | fail-fast · android-artifacts | `android-artifacts` | yes | **no** |
| `web-artifacts` | Web artifacts (built, booted, discarded) | `prepare` | — | yes |
| `ff-web-artifacts` | fail-fast · web-artifacts | `web-artifacts` | yes | **no** |
| `linux-artifacts` | Linux artifacts (built, inspected, discarded) | `prepare` | — | yes |
| `ff-linux-artifacts` | fail-fast · linux-artifacts | `linux-artifacts` | yes | **no** |
| `extensions` | extensions | — | yes | yes |
| `ci-gate` | ci-gate | `lane-workers`, `guard-meta`, `guard-tests`, `guard-tests-floor`, `guards-platform`, `guards-legal`, `guards-store`, `guards-chassis`, `security-scan`, `site-tokens`, `site-shared`, `content-gate`, `app-brick`, `sites`, `workspace-gate`, `prepare`, `app-dryrun`, `android-artifacts`, `web-artifacts`, `linux-artifacts`, `extensions` | yes | — (the aggregate: the single required status check on `main`) |
| `platform-db-migrate` | platform-db-migrate | `ci-gate` | yes | **no** |
| `deploy-web` | deploy-web | `ci-gate`, `platform-db-migrate`, `deploy-workers` | yes | **no** |
| `deploy-workers` | deploy-workers | `ci-gate`, `platform-db-migrate` | yes | **no** |
<!-- END GENERATED: gen-ci-map lane-map -->

Two security lanes live in their **own** workflow files and are deliberately
**not** in `ci-gate`'s `needs` — `codeql.yml` and `trufflehog.yml`. They are
alert sinks rather than merge gates; §7.3 says why, and each has a duty row in
`tooling/ops/register.json` that carries its cadence.

### Lane callees and `tooling/ci/lane-map.json` (ADR 095)

A lane is moving out of `ci.yml` into its own `on: workflow_call` file, one PR
per lane (row O-CI-LANES-NOT-CALLABLE-UNITS). **The workers lane is the first:**
`lane-workers.yml`, called by `ci.yml`'s `lane-workers` job with no `if:`. Every
callee has the same three parts:

- **`detect`** runs `node tooling/ci/lane-detect.mjs --lane <name>`. It reads
  **`tooling/ci/lane-map.json`**, the one register of which paths each lane
  answers to, and says `affected=true` on a push to `main`, on any event that is
  not a pull request, on a changed path the map does not name at all (unmapped
  runs every lane), and whenever the diff cannot be read. Otherwise it is true
  only when a changed path matches the lane's globs.
- **the work jobs** carry `if: needs.detect.outputs.affected == 'true'`.
- **`lane-verdict`** needs every other job, runs `always()`, and runs
  `tooling/ci/lane-verdict.mjs` over `toJSON(needs)`: red on a failure, a
  cancellation, a `detect` that did not succeed, or a skip `detect` did not
  license. `ci-gate` sees one call job whose result is the callee's conclusion,
  so this job is where "skipped is not green" holds inside a callee
  (`assert-green-means-ran.mjs` A8 checks its shape).

A lane's globs name everything its jobs **read**, not just the directory they
build: the Worker tests read every workflow file, the ops register and one Dart
source, so those paths are in `workers`. `lane-detect.mjs --check` runs in
`guard-meta` and fails on a tracked file the map does not place and on a glob
that matches no tracked file. The other lanes' globs are already in the map, so
"unmapped" means a path new to the tree, not a lane that has not moved yet.

### Why the platform job was split

`platform` was **1,818 of `ci.yml`'s 2,696 lines — 67%** — and ran **105 of the
128 guards** under the display name *"platform Worker (typecheck + test +
dry-run)"*. Its four actual Worker steps took 15 s of its 265 s. The name was
load-bearing in the wrong direction: it is what appeared in branch-protection
reasoning and in every failure notification, and it described 6% of what the job
did.

Within it, **"The guards must be able to fail" was 199 s of 263 s (76%)** while
all 108 real guard assertions together took 64 s — CI spent three times longer
proving the guards *can* fail than running them.

Splitting by domain also ends the case where a red store guard hides a red money
guard: each shard reports its own verdict.

### Why `guard-meta` is not change-filtered

The obvious next move is to run the 199 s mutation suite only when
`tooling/ci/**` changes. Two things block it, and both are worth writing down:

1. **A job-level `if:` on any lane inside the gate is refused.**
   `tooling/ci/assert-green-means-ran.mjs` fails the build for it: whenever the
   condition is false the lane resolves to `skipped`, and a skipped required
   check *satisfies* branch protection. A lane that opts out of the gate on some
   events is a gate that means different things on different events.
2. **A step-level filter would be dishonest here.** Several suites under
   `tooling/ci/test/` read the *real* tree rather than fixtures — `safe-rerun`
   drives against the real `.github/workflows`, `ops-register` against
   `tooling/ops/`, and the render-payload and apps-data suites compare the tree
   byte-for-byte. "Only prose changed" therefore does not imply "this suite
   cannot go red", and a filter that is wrong about that is a green tick over
   nothing.

The wall-clock cost is paid instead by putting it on **its own job**, so it runs
beside the four guard shards rather than in front of them.

⏱ 2026-10-01: the suite is now `guard-tests`, a matrix of shards balanced on measured
per-file seconds (`tooling/ci/guard-test-shards.mjs`, weights in
`tooling/ci/test/guard-test-durations.json`), and `guard-tests-floor` merges their junits,
refuses unless every suite ran exactly once, uploads `guard-tests-junit` and grades the
executed floor. One job it measured 737 s; `guard-meta` keeps the checks about the guards and
no longer waits on the suite. Still not change-filtered, for the two reasons above.

### Why the Android artifacts are built on every PR

*Added 2026-09-23 · closes `O-BUILT-ARTIFACT-GUARDS-RUN-ONLY-AFTER-MERGE`.*

The guards that read a built Android binary — artifact shape, 16 KB page
alignment, the apps.gov.in VAPT manifest items and the apps.gov.in `.apk` check —
ran only in `build-platforms.yml`, which runs on tag, schedule and dispatch. A
change that broke a built binary therefore merged green and went red on `main`
afterwards: build apps run 35822768347 is that case, the apps.gov.in `.apk`
refused for a Play Billing permission a merged change had pulled in.

- `android-artifacts` builds the same three Android targets with the same flags
  on every pull request, with no path filter, and runs those guards over them.
  Both jobs are in `ci-gate`'s `needs` and carry no job-level `if:` (§4).
- Nothing leaves the runner: no upload, no symbols, no signing script. No
  signing secret is in reach, so Gradle signs with its debug fallback.
- The cost is about 5 minutes on the pull request's critical path, and $0: a
  public repository on GitHub-hosted runners.
- `docs/ci/build-platforms.md` §PR lane says what runs, what stays main-only and
  why, and which test holds the two copies of the build steps equal.

### Why the web and Linux artifacts are built on every PR

*Added 2026-09-25 · closes `O-PR-LANE-BUILDS-ONLY-ANDROID-ARTIFACTS`.*

The same held for the other two platforms `ubuntu` can build. The web bundle was
built only by `deploy-web.yml`, on a push to `main`, and the Linux bundle only by
`build-platforms.yml`. A change that broke the web build, its fallback fonts or
its first launch, or the Linux bundle's snapcraft input, merged green.

- `web-artifacts` and `linux-artifacts` build those two targets on every pull
  request with their main twin's flags, run the guards main runs over them, and
  discard them. Both need `prepare`, both are in `ci-gate`'s `needs`, and
  neither carries a job-level `if:` (§4).
- Nothing leaves the runner and nothing is signed: no upload, no GlitchTip
  release, no source-map upload, no `appimage-signing.mjs`, and no secret.
- They run beside `android-artifacts`, which is longer, so they add billed
  minutes and no wall-clock time; $0 on a public repository.
- `docs/ci/build-platforms.md` §PR lane — web and Linux says what runs and what
  stays on main.

## 4. Rules any change to these files must keep

Each is enforced by a guard that will fail the build, named so you can read it:

- **`ci-gate` is the only required check on `main`**, it carries `if: always()`,
  it `needs:` **every** other job in `ci.yml`, it echoes each
  `needs.<job>.result`, and it treats `failure`, `cancelled` **and `skipped`**
  as not-green — `tooling/ci/assert-green-means-ran.mjs`.
- **No lane inside the gate carries a job-level `if:`** — same guard. The one
  exception is the draft predicate of §1.1, admitted only while `ci-gate`
  skips on the same predicate.
- **A step that branches on whether a secret is set must `exit 1`**, never skip
  the real work and report success — same guard. This is why the store
  submission workflows fail closed on a missing credential instead of passing
  vacuously.
- **A drift check deletes its artifact before rebuilding it**, so an empty diff
  cannot mean "the generator emitted nothing" — same guard.
- **Every `uses:` is SHA-pinned, every job declares `permissions:`, and every
  job carries `timeout-minutes`** — `tooling/ci/assert-workflow-hardening.mjs`.
  GitHub's `allowed_actions: selected` backs the allowlist half natively; its
  `sha_pinning_required` half **cannot be turned on here** and §7.1 says why.
- **Every gate job has an FF-2 follow-up `ff-<job>`, no job cancels from
  inside itself, and no deploy-type job cancels at all** (§2.1) —
  `tooling/ci/assert-failfast-coverage.mjs`. A new job in `ci.yml`,
  `lane-workers.yml` or `extensions-ci.yml` fails the build until its follow-up
  exists. The guard also simulates the run in which each lane goes red: the lane
  must conclude `failure`, and the rest must be cancelled.
- **Every workflow file has a `duty` row in `tooling/ops/register.json`** and an
  owner in `tooling/ci/assert-release-lane-generic.mjs` — a new workflow file
  fails the build until both exist. Adding a *job* to an existing workflow does
  not need either.
- **Every guard in `tooling/ci/` is invoked by some workflow** and the scan is
  flat: a `tooling/ci/<sub>/<x>.mjs` path anywhere in a workflow line that is
  not a whole-line comment turns `assert-guard-coverage.mjs` red. Write nested
  paths split, or not at all.
- **`tooling/enforcement-index.json` is regenerated, never edited.** After
  moving a step between jobs run `node tooling/ci/build-enforcement-index.mjs
  --write` and commit the diff.

## 5. Versions have one home

`tooling/versions.json` is the single source for the Flutter SDK, the Node
major, Java, Melos, mason_cli, wrangler, glitchtip-cli, the four security
scanners (gitleaks, zizmor, OSV-Scanner, Trivy — moved in from `ci.yml` on
2026-09-06, see §7.2) and the runner image labels. Renovate has a
`customManager` per key, and `tooling/ci/assert-update-coverage.mjs` fails if a
pin gains no manager and no written exemption.

The workflows reach it through two composite actions:

- `.github/actions/setup-flutter` — reads `versions.json.flutter` at run time,
  then `subosito/flutter-action` with the SDK and pub cache restored.
- `.github/actions/setup-node` — reads `versions.json.node`, then
  `actions/setup-node`.

These replaced **18 copies of the setup-node block and 14 of the
flutter-action block**, and five separate `FLUTTER_VERSION: '3.47.2'` env
declarations.

⏱ 2026-09-27: they are the only route. The extension workflows carried 18
direct `actions/setup-node` steps of their own, at a different major from
the composite, until the change that moved every action to its current
major. `assert-workflow-hardening.mjs` limb 14 now refuses `actions/setup-node`
or `subosito/flutter-action` in any workflow, and any action repository
pinned at two SHAs. A matrix that tests several Node majors passes one as
the composite's `node-version` input.

### 5.1 Moving a version: one command, and one thing it does not do

Renovate's `customManager` moves the value in `tooling/versions.json` and
nothing else — that is the whole design — so
`tooling/ci/assert-version-consistency.mjs` then refuses the build until every
call site follows. It names each one, with file, line, current value and wanted
value. To move all of them:

```bash
node tooling/scripts/propagate-versions.mjs          # dry run: what would move
node tooling/scripts/propagate-versions.mjs --write  # move it
```

It imports the guard's own rule table and target discovery rather than carrying
a second copy, so it can only ever write sites the guard reads, and the two
cannot drift apart. It **refuses the whole run (exit 2) and writes nothing** at
any site that cannot hold the declared value — the `java` and `node` floors that
`renovate.json` explains at length, where five of java's eight sites are enum
constants, an apt package name and a JVM directory with no patch spelling.
`17 -> 21` is expressible and it will write all eight; `17 -> 17.0.20+8` is not,
and refusing is the design rather than a gap (PR #316 is what that proposal
looks like when nothing refuses: red forever, closable only by hand). It also
refuses to touch the gitleaks constant in `tooling/ci/scan-secrets.mjs`, which
records the release its byte-volume parser was *measured* against and moves with
the canary lines beside it.

**It does not touch `pubspec.lock`, and a `melos` bump needs that too.** The
workspace gate runs `flutter pub get --enforce-lockfile`, so moving the
`melos:` dev_dependency without the lock's `melos` entry fails the resolve. That
entry is two lines — the version and the `sha256` from
`https://pub.dev/api/packages/melos` — and it is the *only* line that may move:
a plain `flutter pub get` on a machine whose Flutter is not the pinned one
re-resolves the SDK-pinned packages and downgrades `intl`, `vector_math` and the
`test` trio in the root lockfile, which is the trap CLAUDE.md records.

**Why this is a command and not a Renovate `postUpgradeTask`.** Self-hosted
Renovate can run one (`.github/workflows/renovate.yml` uses
`renovatebot/github-action`, and `allowedCommands` would have to be added there
as `RENOVATE_ALLOWED_COMMANDS`), and the token demonstrably can push workflow
files — PR #131 and #268 are Renovate commits under `.github/workflows/`. Three
things stop it being an improvement today:

1. **A refusal would suppress the proposal instead of surfacing it.** This
   script exits non-zero exactly where `renovate.json` wants a PR *surfaced and
   red* — `gitleaks`, `glitchtip_cli`, the floor class. A `postUpgradeTask` that
   fails does not leave a red PR behind in any version this repo has run, and
   turning a loud red into a missing PR is the failure mode §8 exists to prevent.
2. **It would not make a `melos` bump green anyway**, because of the lockfile
   above — so the claim "the PR arrives in sync" would be false for the very
   bump that motivated this.
3. **It could not be proven here.** Renovate runs daily at 03:00 and the option
   name changed in Renovate 39; a claim about an unattended write path that
   nothing in the tree can re-derive is the kind this repo does not keep.

Re-open it when the failure semantics are measured against the pinned Renovate
image rather than reasoned about.

## 6. Secrets the owner still has to add

Which secrets exist is a repository setting, and no file in this tree records
it, so this section no longer carries a count of them. Where each secret CI
reads is classified is `tooling/channel-register.json` `ciSecretRegister` (its
`_why` says how). The names the workflows read, from the workflows:

<!-- BEGIN GENERATED: gen-ci-map secrets -->
<!-- why: GENERATED by node tooling/ci/gen-ci-map.mjs --write. Never hand-edit. -->
The workflows read **50** secret names (`GITHUB_TOKEN` is not counted: GitHub issues it to every run).

| secret | read by |
|---|---|
| `AMO_JWT_ISSUER` | `extensions.yml` |
| `AMO_JWT_SECRET` | `extensions.yml` |
| `ANDROID_KEYSTORE_BASE64` | `build-platforms.yml`, `submit-play.yml` |
| `ANDROID_KEYSTORE_PASSWORD` | `build-platforms.yml`, `submit-play.yml` |
| `ANDROID_KEY_ALIAS` | `build-platforms.yml`, `submit-play.yml` |
| `ANDROID_KEY_PASSWORD` | `build-platforms.yml`, `submit-play.yml` |
| `APPIMAGE_SIGNING_KEY_B64` | `build-platforms.yml` |
| `APPLE_DIST_CERT_P12_BASE64` | `build-platforms.yml` |
| `APPLE_DIST_CERT_PASSWORD` | `build-platforms.yml` |
| `APPLE_INSTALLER_CERT_P12_BASE64` | `build-platforms.yml` |
| `APPLE_PROVISIONING_PROFILES_BASE64` | `build-platforms.yml` |
| `APPLE_TEAM_ID` | `build-platforms.yml` |
| `APPSGOVIN_KEYSTORE_BASE64` | `build-platforms.yml` |
| `APPSGOVIN_KEYSTORE_PASSWORD` | `build-platforms.yml` |
| `APPSGOVIN_KEY_ALIAS` | `build-platforms.yml` |
| `APPSGOVIN_KEY_PASSWORD` | `build-platforms.yml` |
| `APP_STORE_CONNECT_ISSUER_ID` | `apple-expiry-write.yml`, `ops-watch.yml`, `submit-appstore.yml` |
| `APP_STORE_CONNECT_KEY_ID` | `apple-expiry-write.yml`, `ops-watch.yml`, `submit-appstore.yml` |
| `APP_STORE_CONNECT_PRIVATE_KEY` | `apple-expiry-write.yml`, `ops-watch.yml`, `submit-appstore.yml` |
| `CLOUDFLARE_ACCOUNT_ID` | `ci.yml`, `deploy-sandbox.yml`, `deploy-web.yml`, `deploy-workers.yml`, `e2e.yml`, `migrate-platform-db.yml`, `native-auth-proof.yml`, `ops-watch.yml`, `rollback.yml`, `store-screenshots.yml` |
| `CLOUDFLARE_API_TOKEN` | `ci.yml`, `deploy-sandbox.yml`, `deploy-web.yml`, `deploy-workers.yml`, `e2e.yml`, `migrate-platform-db.yml`, `native-auth-proof.yml`, `ops-watch.yml`, `rollback.yml`, `store-screenshots.yml` |
| `CLOUDFLARE_D1_TOKEN` | `e2e.yml`, `native-auth-proof.yml`, `ops-watch.yml`, `store-screenshots.yml` |
| `CLOUDFLARE_READ_TOKEN` | `ops-watch.yml` |
| `CWS_PUBLISHER_ID` | `extensions.yml` |
| `CWS_SERVICE_ACCOUNT_JSON` | `extensions.yml` |
| `EDGE_API_KEY` | `extensions.yml` |
| `EDGE_CLIENT_ID` | `extensions.yml` |
| `GH_BILLING_TOKEN` | `ops-watch.yml` |
| `GLITCHTIP_DSN` | `build-platforms.yml`, `ci.yml`, `deploy-web.yml`, `deploy-workers.yml`, `submit-appstore.yml`, `submit-play.yml`, `submit-snap.yml`, `submit-windows-store.yml`, `symbolication-proof.yml` |
| `GLITCHTIP_TOKEN` | `build-platforms.yml`, `ci.yml`, `deploy-web.yml`, `ops-watch.yml`, `submit-appstore.yml`, `submit-play.yml`, `submit-snap.yml`, `submit-windows-store.yml`, `symbolication-proof.yml` |
| `MS_STORE_CLIENT_ID` | `submit-windows-store.yml` |
| `MS_STORE_CLIENT_SECRET` | `submit-windows-store.yml` |
| `MS_STORE_SELLER_ID` | `submit-windows-store.yml` |
| `MS_STORE_TENANT_ID` | `submit-windows-store.yml` |
| `PLAY_SERVICE_ACCOUNT_JSON` | `ops-watch.yml`, `submit-play.yml` |
| `RENOVATE_TOKEN` | `name-clearance.yml`, `renovate.yml` |
| `REVENUECAT_PUBLIC_KEY_APPLE` | `build-platforms.yml`, `submit-appstore.yml` |
| `REVENUECAT_PUBLIC_KEY_GOOGLE` | `build-platforms.yml`, `ci.yml`, `submit-play.yml` |
| `SECRETS_READ_TOKEN` | `ops-watch.yml` |
| `SELFHOSTED_SUPABASE_ANON_KEY` | `e2e.yml` |
| `SELFHOSTED_SUPABASE_SERVICE_ROLE_KEY` | `e2e.yml` |
| `SELFHOSTED_SUPABASE_URL` | `e2e.yml` |
| `SNAPCRAFT_STORE_CREDENTIALS` | `submit-snap.yml` |
| `SNAPCRAFT_STORE_CREDENTIALS_EXPIRES` | `submit-snap.yml` |
| `SUBSCRIBE_RATE_LIMIT_SALT` | `ci.yml`, `deploy-web.yml` |
| `SUPABASE_ANON_KEY` | `build-platforms.yml`, `ci.yml`, `deploy-web.yml`, `deploy-workers.yml`, `e2e.yml`, `native-auth-proof.yml`, `ops-watch.yml`, `store-screenshots.yml`, `submit-appstore.yml`, `submit-play.yml`, `submit-snap.yml`, `submit-windows-store.yml` |
| `SUPABASE_PAT` | `ops-watch.yml` |
| `SUPABASE_PROJECT_REF` | `ops-watch.yml` |
| `SUPABASE_SERVICE_ROLE_KEY` | `e2e.yml`, `native-auth-proof.yml`, `store-screenshots.yml` |
| `SUPABASE_URL` | `build-platforms.yml`, `ci.yml`, `deploy-web.yml`, `e2e.yml`, `native-auth-proof.yml`, `ops-watch.yml`, `store-screenshots.yml`, `submit-appstore.yml`, `submit-play.yml`, `submit-snap.yml`, `submit-windows-store.yml` |
<!-- END GENERATED: gen-ci-map secrets -->

The owner's list is below: secrets a workflow reads that did not exist when the
list was last measured, and what each one blocks. Every path that needs one
fails closed with a named secret rather than skipping — see §4 — so nothing here
is a silent pass; it is a lane that cannot run until the credential is created.

⏱ 2026-09-26 — the four `APPLE_*` signing secrets (`APPLE_DIST_CERT_P12_BASE64`,
`APPLE_DIST_CERT_PASSWORD`, `APPLE_PROVISIONING_PROFILES_BASE64`, `APPLE_TEAM_ID`) left this list:
`tooling/channel-register.json` records the distribution certificate as existing since 2026-09-09
(the `custody` of the `ios-appstore` and `macos-appstore` rows).

| secret | referenced by | what is blocked |
|---|---|---|
| `APP_STORE_CONNECT_ISSUER_ID` | `submit-appstore.yml` | Apple submission (dry run has no credential) |
| `APP_STORE_CONNECT_KEY_ID` | `submit-appstore.yml` | as above |
| `APP_STORE_CONNECT_PRIVATE_KEY` | `submit-appstore.yml` | as above |
| `MS_STORE_TENANT_ID` | `submit-windows-store.yml` | Microsoft Store submission |
| `MS_STORE_CLIENT_ID` | `submit-windows-store.yml` | as above |
| `MS_STORE_CLIENT_SECRET` | `submit-windows-store.yml` | as above |
| `WINDOWS_CODESIGN_PFX_BASE64` | `build-platforms.yml` | Windows artifacts unsigned |
| `WINDOWS_CODESIGN_PFX_PASSWORD` | `build-platforms.yml` | as above |
| `SNAPCRAFT_STORE_CREDENTIALS` | `submit-snap.yml` | the Snap live upload path |
| `APPIMAGE_SIGNING_KEY_B64` | `build-platforms.yml` | AppImage unsigned |
| `SNAPCRAFT_STORE_CREDENTIALS_EXPIRES` | `submit-snap.yml` | the Snap lane refuses a credential whose expiry it cannot read — the date passed to `snapcraft export-login --expires`, recorded because the exported blob's format is documented nowhere |
| `AMO_JWT_ISSUER` | `extensions.yml` | the Firefox (AMO) submission — the ONE store whose API can make a first submission |
| `AMO_JWT_SECRET` | `extensions.yml` | as above |
| `CWS_SERVICE_ACCOUNT_JSON` | `extensions.yml` | the Chrome Web Store upload+publish pair, and the daily `cws-token-keepalive` job — a Google service-account key, minted into an access token by the JWT-bearer grant. **Replaced `CWS_CLIENT_ID` + `CWS_CLIENT_SECRET` + `CWS_REFRESH_TOKEN` on 2026-09-09**, when [developer.chrome.com's service-account page](https://developer.chrome.com/docs/webstore/service-accounts) turned the refresh-token shape from a requirement into a stale assumption |
| `CWS_PUBLISHER_ID` | `extensions.yml` | as above; the v2 API path carries a publisher segment the older v1.1 path did not |
| `EDGE_CLIENT_ID` | `extensions.yml` | the Edge Add-ons v1.1 four-call submission |
| `EDGE_API_KEY` | `extensions.yml` | as above |

⏱ 2026-09-26 (O-STORE-RECORDS-ARE-ONE-PER-CHANNEL): `APP_STORE_CONNECT_IOS_APP_ID`, `APP_STORE_CONNECT_MACOS_APP_ID` and
`MS_STORE_PRODUCT_ID` left this table: no workflow reads them. Each app's App Store Connect record and
Partner Center Store ID are its own `apps/<id>/app.yaml` `stores` record, read by the submit scripts. Deleting
the three secrets is owner step O-A3, after one green dispatched dry run.

**The two listing ids are NOT secrets, and stopped being repository ones on 2026-09-07.** `CWS_ITEM_ID` and
`EDGE_PRODUCT_ID` were rows in this table until then. They identify a listing and authenticate nothing, and the
extensions release lane is multi-tool by construction — `.github/workflows/extensions.yml` derives the tool from the
tag `<tool>-v<semver>` — so one repository-wide value meant a second extension's tag would upload its package to the
FIRST tool's listing and print `SUBMITTED` naming the second: a wrong success in the one act this repository treats as
irreversible. Each tool now declares its own destination at `extensions/Extension/<tool>/tool.json`
`storeMetadata.stores.chrome.listingId` / `.edge.listingId`, and `extensions/scripts/publish-cws.mjs` /
`publish-edge.mjs` REFUSE while it is `null` rather than falling back to anything.

The Apple items are gated on hardware, not on money: there is no web enrolment
in India, so the developer account cannot be created from this machine.

⏱ CORRECTED 2026-09-26: that was true when written. The Apple developer account is active, and its
distribution certificate exists since 2026-09-09 (the register rows above).

There are also **zero repository variables**. Non-secret values such as
`SUPABASE_URL` and `SUPABASE_PROJECT_REF` are stored as secrets (`API_BASE_URL` is not
a secret: `tooling/ci/flutter-release-build.mjs` composes it from the app's rule), which is why deploy logs are masked and hard to read. Moving them to variables
is a follow-up, not done here.

⏱ CORRECTED 2026-09-26: "zero" no longer holds. Which repository variables exist is a repository
setting that no file in this tree records, so this page states no count of them.

## 7. Repository settings CI depends on

Recorded so a change to any of them is a deliberate act:

| setting | value | why |
|---|---|---|
| repository visibility | **public** | GitHub bills standard runners at 100% discount on public repositories. 31,674 minutes in 2026-08 cost **$0.00**. The whole economics of the factory rests on this one setting. |
| self-hosted runners | **none, ever** | ADR 067 decision 4. |
| required status checks on `main` | exactly `ci-gate`, strict | one aggregate, forever. |
| `enforce_admins` | true | |
| `allowed_actions` | `selected` + a named allowlist | GitHub now enforces natively what `assert-workflow-hardening.mjs` enforced alone. The allowlist is GitHub-owned + verified creators + named third-party actions. The third-party actions the tree uses are listed, from the workflows, under this table. |
| `sha_pinning_required` | **false, and it cannot be true** | GitHub applies it to actions nested inside an action you use, and `subosito/flutter-action` references `actions/cache@v5`. See §7.1 — this is measured, twice, not a preference. |
| `delete_branch_on_merge` | true | |
| `allow_auto_merge` | **true** (was `false` until 2026-09-07) | `site-drift-repair.yml` arms `gh pr merge --auto --squash` on the repair pull request it opens, which is the half that stops main sitting red until a human merges it. `--auto` queues *behind* `ci-gate`, so this grants nothing branch protection did not already gate. Renovate's `automergeType: "pr"` uses the same setting. |
| `Allow GitHub Actions to create and approve pull requests` | true | `can_approve_pull_request_reviews`. Necessary for `site-drift-repair.yml` and **not sufficient** — see §7.4. |

<!-- BEGIN GENERATED: gen-ci-map actions -->
<!-- why: GENERATED by node tooling/ci/gen-ci-map.mjs --write. Never hand-edit. -->
The tree uses **4** third-party actions and **10** GitHub-owned ones, read from every `uses:` in `.github/workflows` and in the composite actions under `.github/actions`. Each third-party one runs only while the `allowed_actions` setting allows it: named on its allowlist, or published by a verified creator.

| action | owner | used by |
|---|---|---|
| `cloudflare/wrangler-action` | third-party | `deploy-sandbox.yml`, `deploy-web.yml`, `deploy-workers.yml`, `migrate-platform-db.yml` |
| `nanasess/setup-chromedriver` | third-party | `e2e.yml`, `store-screenshots.yml` |
| `renovatebot/github-action` | third-party | `renovate.yml` |
| `subosito/flutter-action` | third-party | `.github/actions/setup-flutter/action.yml` |
| `actions/cache` | GitHub | `.github/actions/setup-flutter/action.yml`, `ci.yml`, `ops-watch.yml` |
| `actions/cache/restore` | GitHub | `ci.yml` |
| `actions/cache/save` | GitHub | `ci.yml` |
| `actions/checkout` | GitHub | `apple-expiry-write.yml`, `autopilot-watch.yml`, `build-platforms.yml`, `ci.yml`, `codeql.yml`, `deploy-sandbox.yml`, `deploy-web.yml`, `deploy-workers.yml`, `e2e.yml`, `extensions-ci.yml`, `extensions.yml`, `land.yml`, `lane-workers.yml`, `main-healthy.yml`, `migrate-platform-db.yml`, `mutation-proofs.yml`, `name-clearance.yml`, `native-auth-proof.yml`, `ops-watch.yml`, `redeploy-stranded.yml`, `regen-gradle-verify.yml`, `review-gate.yml`, `rollback.yml`, `store-screenshots.yml`, `submit-appstore.yml`, `submit-play.yml`, `submit-snap.yml`, `submit-windows-store.yml`, `symbolication-proof.yml`, `time-travel.yml`, `trufflehog.yml`, `update-goldens.yml` |
| `actions/download-artifact` | GitHub | `build-platforms.yml`, `ci.yml`, `submit-play.yml`, `submit-windows-store.yml`, `update-goldens.yml` |
| `actions/setup-java` | GitHub | `build-platforms.yml`, `ci.yml`, `regen-gradle-verify.yml`, `submit-play.yml` |
| `actions/setup-node` | GitHub | `.github/actions/setup-node/action.yml` |
| `actions/upload-artifact` | GitHub | `build-platforms.yml`, `ci.yml`, `e2e.yml`, `extensions-ci.yml`, `extensions.yml`, `name-clearance.yml`, `native-auth-proof.yml`, `regen-gradle-verify.yml`, `store-screenshots.yml`, `submit-appstore.yml`, `submit-play.yml`, `submit-snap.yml`, `submit-windows-store.yml`, `symbolication-proof.yml`, `update-goldens.yml` |
| `github/codeql-action/analyze` | GitHub | `codeql.yml` |
| `github/codeql-action/init` | GitHub | `codeql.yml` |
<!-- END GENERATED: gen-ci-map actions -->

### 7.1 `sha_pinning_required` cannot be turned on while flutter-action is used

`subosito/flutter-action` is a **composite** action and it references `actions/cache@v5` — a
floating tag, inside an action this repository does not control. With `sha_pinning_required: true`
GitHub refuses every job that uses it:

> `The action actions/cache@v5 is not allowed in globalonlinedeveloper/Nikatru_Platform_Public …
> All actions must also be pinned to a full-length commit SHA.`

**Measured twice, and the first reading was wrong.** Run **33960420609** failed `workspace-gate` and
`app-brick` on it, and the obvious inference — *"the cache is what pulls `actions/cache` in, so turn
the cache off"* — was made and shipped. It is false. GitHub validates **every `uses:` in a composite
action, whether or not its `if:` would run it**, so the reference is refused with the cache already
off. Proven by re-running CI on `main` under the setting: run **33961320034 attempt 2**, same two
jobs, same error, `cache: false` already in the tree.

⚠️ The reason the intervening runs looked like the fix had worked is worse than the mistake: the
setting had **silently gone back to `false`** between those runs. A `PUT` to
`repos/{o}/{r}/actions/permissions` is a **REPLACE** — omit `sha_pinning_required` from the body
and it resets to `false` — so anything else that sets `allowed_actions` without re-sending the flag
turns it off. The green runs in between were green because the setting was off, not because the
cache was.

So: **`sha_pinning_required` stays `false`** until `flutter-action` pins its own dependencies, and
`.github/actions/setup-flutter` keeps `cache: true`, which is worth about 130 runner-seconds a run.
`allowed_actions: selected` **is** on and does work — it is what produced the error message above,
naming the offending action precisely.

`assert-workflow-hardening.mjs` remains the enforcement for what this repository actually writes,
which is where it always was. Three other allowed third-party actions were read at their pinned
SHAs (`gh api repos/<o>/<r>/git/trees/<sha>` → `git/blobs`): `cloudflare/wrangler-action` (node20),
`nanasess/setup-chromedriver` (node24) and `dorny/paths-filter` (node20) are JavaScript actions with
no nested `uses:` at all, so of the four read, flutter-action is the only blocker.
`renovatebot/github-action` and `trufflesecurity/trufflehog` were not read in that measurement.

To try it again after a flutter-action release that pins `actions/cache`:

```
echo '{"enabled":true,"allowed_actions":"selected","sha_pinning_required":true}' > perm.json
gh api -X PUT repos/globalonlinedeveloper/Nikatru_Platform_Public/actions/permissions --input perm.json
```

…and then re-run CI on `main` and read it, because the branch cannot show you this.

### 7.2 Scanners, and what an acknowledged finding looks like

`security-scan` runs four pinned, checksum-verified binaries — gitleaks, zizmor,
OSV-Scanner and Trivy — never a vendor action (`gitleaks-action` v2+ is a
commercial licence for organization accounts).

OSV-Scanner's very first run found four fixable vulnerabilities, all dev
dependencies of `packages/tokens`. They are **dated, not waived**, in
`osv-scanner.toml` at the repository root: each entry carries an `ignoreUntil`,
so the finding reddens the lane again if Renovate has not closed it. An entry
with no expiry does not belong in that file.

✅ **CLOSED 2026-09-06.** This paragraph read: *"The four scanner versions are
pinned inline in `ci.yml`, not in `tooling/versions.json`, so
`assert-update-coverage.mjs` cannot see them and Renovate does not advance them.
That is a pre-existing gap and it is the next thing to fix here."* It is
corrected rather than deleted, because the shape of the gap is the useful part: a
pin written inside a workflow is outside **both** mechanisms this repository has
for a pinned input — F-2's single declaration and [pipeline 14]O-9's update
coverage — so those four were advanced by nobody and no guard could say so.

All eight values (four versions + four `sha256` digests) now live in
`tooling/versions.json`, `ci.yml` reads them at run time with the `node -p` idiom
`deploy-web.yml` already used for `glitchtip_cli`, and each version has a
`customManagers` entry in `renovate.json` against the `github-releases`
datasource. `tooling/ci/test/update-coverage.test.mjs` U13 mutates the **real**
committed pair of files — dropping each pin, and each digest's exemption — and
requires exit 1 every time, with a green control first. **U14** does the harder
half: it deletes each *customManager* and requires the guard to go red **and its
covered count to fall by one**. That case exists because the first version of
this change asserted membership with `assert.match(stdout, /gitleaks/)` under a
comment claiming it proved the four were covered — and the guard never prints a
covered key's name, so the only thing satisfying the match was the neighbouring
`EXEMPT gitleaks_sha256` line. A reviewer built the excluded state by hand
(manager deleted, waiver added instead) and the guard exited 0 with the assertion
still passing. An assertion that cannot fail for its stated reason is worse than
none, because it inflates apparent coverage.

🔴 **The `gitleaks` pin has a second copy, and it is now guarded.**
`tooling/ci/scan-secrets.mjs` declares `const VALIDATED_AGAINST = '<version>'` —
the gitleaks release its `scanned ~N bytes` volume parser was measured against.
While the pin lived in `ci.yml` nothing advanced either copy, so they could only
move by the same hand; giving `gitleaks` a customManager is what made drift
possible by machine. `assert-version-consistency.mjs` now carries a
`gitleaks (scan-secrets VALIDATED_AGAINST)` rule with that file as a **required**
target. ⛔ Do **not** "fix" a red bump by making the constant read
`versions.json`: `scan-secrets.mjs` compares the *installed* gitleaks against it,
so reading the pin at run time would make it compare a value with itself. It must
stay a literal and move together with the captured canary lines beside it.

🔴 **A Renovate bump of any of the four arrives RED**, at `ci.yml`'s
`sha256sum -c` step, until a human downloads the new asset and writes its digest
in `versions.json`. That red is the mechanism, not a gap in it — the same
deliberate arrangement `glitchtip_cli` carries. ⛔ Do **not** "fix" it by
deleting a checksum step.

### 7.3 CodeQL and TruffleHog — the two lanes that are not merge gates

Added 2026-09-06 ([ADR 067] decision 4). Neither is in `ci-gate`'s `needs`, and
that is deliberate: a scanner whose first false positive blocks every merge is a
scanner somebody switches off, which is worse than no scanner. Both are alert
sinks with a duty row in `tooling/ops/register.json`.

| workflow | what it reads that nothing else does | trigger |
|---|---|---|
| `codeql.yml` | this repository's **own JS/TS as code** — 583 tracked `.ts`/`.js`/`.mjs` files. gitleaks reads bytes, zizmor reads workflows, OSV-Scanner and Trivy read what we *depend on*; none of them can answer "does attacker-controlled input reach a dangerous sink in code we wrote". | PR, push to `main`, daily 05:23 UTC |
| `trufflehog.yml` | the **full git history**, with each candidate credential checked against its issuing provider (`--results=verified`). A working-tree scan cannot see a secret that was committed and then removed — which stays fetchable forever in a public repository. | daily 13:41 UTC |

Three things about these that are easy to get wrong:

- **A SHA on `trufflesecurity/trufflehog` pins the wrapper, not the scanner.**
  That action is a *composite* whose real step is
  `docker run "${IMAGE}:${VERSION}"`, and its `version` input **defaults to
  `latest`**. The first version of this lane passed only `path` and
  `extra_args`, so the executable actually scanning a public repository's whole
  history was `ghcr.io/trufflesecurity/trufflehog:latest` — the repository's only
  floating image tag, introduced by the very change that moved four other
  scanners *out* of that state. The version now comes from
  `tooling/versions.json` (`trufflehog`), has its own `customManagers` entry, and
  is passed as `version:`. The registry tag carries no leading `v` even though
  the git tag does. ⚠️ There is no sibling `sha256`: the action exposes only
  `image` and `version`, joined by a colon, so a digest cannot be passed and one
  written down would be a pin nothing verifies.
- **`--json` must never go in `extra_args`.** The action already passes
  `--github-actions`, whose printer emits file, line and detector name only.
  `--json` *replaces* it with one that emits `Raw` and `RawV2` — the raw secret —
  and there is no `--redact` flag to put back. This repository is public, so that
  prints a live credential in cleartext into a world-readable Actions log: a
  second public copy, made by the lane that exists to find the first (TRAPS
  ci-09; `scan-secrets.mjs` states the rule as *"Report WHERE, never WHAT."*).
- **`fetch-depth: 0` is the TruffleHog workflow**, not a detail. The default
  shallow clone fetches one commit, and a scan of one commit is the working-tree
  scan gitleaks already does — it would run green over a history it never opened.
- **The crons fire daily against a duty declared weekly.** That is TRAPS ci-19
  applied on purpose: the freshness window is `7d × 1.5 = 252h`, and GitHub
  delivers this repository's scheduled runs **10.1% on time**, so a weekly cron
  gives that window one or two chances at a run and a daily cron gives it about
  ten. The margin is given to the *evidence*, not to the duty. Both slots were
  **computed, not chosen** — including the wrap past midnight, which a sorted
  list never shows: `05:23` and `13:41` split two of the three joint-worst 3.00h
  gaps in the repository's daily schedule.

⚠️ CodeQL covers **no Dart**. The `javascript-typescript` pack does not read
Flutter code and CodeQL ships no Dart support, so `apps/` and `packages/` are
outside that lane by construction — not by an omission anyone can close by adding
a language to the matrix. Dart is covered by `melos run analyze` and the
`apps/subscriptiontracker` format gate in `workspace-gate`.

### 7.4 A pull request opened with `GITHUB_TOKEN` starts no checks, so it cannot self-merge

Added 2026-09-07, and it is the rule any future "let the workflow open the fix" lane has to obey.

`site-drift-repair.yml` is the only workflow here that opens a pull request meant to **merge**
rather than be read. Turning *"Allow GitHub Actions to create and approve pull requests"* on
(2026-09-06) made it open one — **#513** — and main stayed red anyway, because of a GitHub property
that no permission changes:

> *When you use the repository's `GITHUB_TOKEN` to perform tasks, events triggered by the
> `GITHUB_TOKEN` will not create a new workflow run.*

So #513's checks never started, `ci-gate` sat *Expected*, and the required check could only be
satisfied by a human pressing *Approve and run* — measured at 19:58:00Z (opened by
`app/github-actions`) → 20:05:46Z (run triggered by `globalonlinedeveloper`).

**The fix is the actor, not the scope.** That workflow's `gh` calls now authenticate as
`RENOVATE_TOKEN`, the classic PAT `renovate.yml` already uses, so the `pull_request` event is
attributed to a real account and `ci.yml` runs on it unprompted. Its `GITHUB_TOKEN` correspondingly
**gave up `pull-requests: write`** — it pushes the branch and nothing else.

Three things that follow, and are easy to get wrong:

- **`--auto` is not a bypass.** It queues the squash behind the required check. Branch protection is
  untouched (`ci-gate`, strict, `enforce_admins: true`), so a red gate leaves the pull request open
  for a person, which is the same ending the manual arrangement had.
- **The secret is checked where it is used and its absence is RED.** The step branches on
  `RENOVATE_TOKEN` being empty and `exit 1`s with the secret's name, printing and uploading the
  computed patch first — §4's rule, and `assert-green-means-ran.mjs` section B is what enforces it.
- **An automatic merge loop needs a ceiling in the shell, not only in an argument.** The repair is
  provably a fixed point after at most two rounds; the step counts consecutive
  `sites: regenerate the discovery surface` commits at the tip of `main` and refuses to open a third,
  because a generator that does not converge must go red rather than merge for ever.
  `docs/ci/site-drift-repair.md` carries the measurement and why a plain self-skip would be the
  wrong guard.

## 8. Dependency updates

`renovate.json` is the config; `.github/workflows/renovate.yml` runs it daily
against this public repository (`RENOVATE_REPOSITORIES` names one) with a PAT.

Renovate stopped opening PRs on 2026-09-03 because the config carried a key
called `_scheduleWhy` — prose smuggled in as a config option. Renovate rejects
unknown options outright and refuses to open anything until the config is valid,
**while the workflow that runs it goes on reporting 100% success**, because the
workflow genuinely ran; it was the service that refused. Issue #420 was the only
signal. The prose is now here, in §8.1, where it cannot break a config.

Patch, digest and dev-dependency updates automerge with `ci-gate` as the gate.
Majors never automerge.

### 8.1 Why the schedule is `on monday`, not `before 6am on monday`

The window is evaluated in `Asia/Kolkata`. "before 6am on monday" is Sunday
18:30 UTC to Monday 00:30 UTC — and the only thing that runs Renovate is a
GitHub Actions cron, which GitHub delivers on time about 10% of the time. A
six-hour window against a scheduler like that meant Renovate could go weeks
without ever opening a pull request, and nothing would say so. The workflow
fires **daily** and `renovate.json`'s own schedule decides when it does work:
give the *evidence* margin, not the duty.

---

## 9. One page per workflow

`ci.yml`'s prose moved here first. On 2026-09-06 the other twelve followed, and
`deploy-workers.yml` — the thirteenth, and the one workflow that twelve did not
cover because another unit owned it that day — followed the same afternoon with
the `worker-shared-chassis` unit: **242 comment lines became 56**, and its parsed
document changed only in the two places that unit deliberately changed it (the
`services/_shared/**` globs), shown as a canonical-JSON diff in that unit's
report. The twelve: they
carried **5,179 comment lines against 9,322 lines of file** and now carry
**500** — the `# why:` lines this repository keeps in a workflow, plus the 336
shell comments inside `run:` bodies, which are executable context and were not
touched. Nothing was summarised: every paragraph moved verbatim, under a heading
naming the job it belonged to and the line it sat above.

<!-- BEGIN GENERATED: gen-ci-map workflows -->
<!-- why: GENERATED by node tooling/ci/gen-ci-map.mjs --write. Never hand-edit. -->
**33** workflows. A workflow's page is `docs/ci/<workflow>.md`; `ci.yml`'s is this one.

| page | workflow | its `name:` | triggers | jobs |
|---|---|---|---|---|
| none | `.github/workflows/apple-expiry-write.yml` | Apple signing expiry write | `workflow_dispatch` | 1 |
| none | `.github/workflows/autopilot-watch.yml` | Autopilot watch | `schedule`, `workflow_run`, `workflow_dispatch` | 2 |
| [`build-platforms.md`](build-platforms.md) | `.github/workflows/build-platforms.yml` | Build apps | `workflow_dispatch`, `push`, `schedule` | 7 |
| this page | `.github/workflows/ci.yml` | CI | `push`, `workflow_dispatch`, `pull_request` | 44 |
| none | `.github/workflows/codeql.yml` | CodeQL | `pull_request`, `push`, `schedule`, `workflow_dispatch` | 1 |
| none | `.github/workflows/deploy-sandbox.yml` | Deploy sandbox | `workflow_dispatch` | 3 |
| [`deploy-web.md`](deploy-web.md) | `.github/workflows/deploy-web.yml` | Deploy web | `workflow_call` | 4 |
| [`deploy-workers.md`](deploy-workers.md) | `.github/workflows/deploy-workers.yml` | Deploy workers | `workflow_call` | 4 |
| [`e2e.md`](e2e.md) | `.github/workflows/e2e.yml` | E2E live | `workflow_dispatch`, `schedule` | 5 |
| [`extensions-ci.md`](extensions-ci.md) | `.github/workflows/extensions-ci.yml` | Extensions CI | `workflow_call` | 29 |
| [`extensions.md`](extensions.md) | `.github/workflows/extensions.yml` | Extensions | `push`, `pull_request`, `schedule`, `workflow_dispatch` | 12 |
| [`land.md`](land.md) | `.github/workflows/land.yml` | Land | `schedule`, `workflow_run`, `pull_request_target`, `workflow_dispatch` | 1 |
| none | `.github/workflows/lane-workers.yml` | Lane — workers | `workflow_call` | 5 |
| [`main-healthy.md`](main-healthy.md) | `.github/workflows/main-healthy.yml` | Main health status (posts CI's verdict) | `workflow_run` | 1 |
| none | `.github/workflows/migrate-platform-db.yml` | Migrate PLATFORM_DB | `workflow_call` | 1 |
| none | `.github/workflows/mutation-proofs.yml` | Mutation proofs | `workflow_dispatch`, `schedule` | 1 |
| none | `.github/workflows/name-clearance.yml` | Name clearance | `workflow_dispatch`, `schedule` | 1 |
| none | `.github/workflows/native-auth-proof.yml` | Native auth proof | `workflow_dispatch` | 11 |
| [`ops-watch.md`](ops-watch.md) | `.github/workflows/ops-watch.yml` | Ops watch | `workflow_dispatch`, `schedule` | 14 |
| [`redeploy-stranded.md`](redeploy-stranded.md) | `.github/workflows/redeploy-stranded.yml` | Redeploy stranded lanes | `workflow_run`, `workflow_dispatch` | 1 |
| none | `.github/workflows/regen-gradle-verify.yml` | Regenerate Gradle verification | `workflow_dispatch` | 2 |
| [`renovate.md`](renovate.md) | `.github/workflows/renovate.yml` | Renovate | `workflow_dispatch`, `schedule` | 1 |
| none | `.github/workflows/review-gate.yml` | Review gate | `pull_request_target` | 1 |
| [`rollback.md`](rollback.md) | `.github/workflows/rollback.yml` | Rollback | `workflow_dispatch` | 1 |
| [`store-screenshots.md`](store-screenshots.md) | `.github/workflows/store-screenshots.yml` | Store screenshots | `workflow_dispatch` | 5 |
| [`submit-appstore.md`](submit-appstore.md) | `.github/workflows/submit-appstore.yml` | Store submit: Apple App Store | `workflow_dispatch` | 2 |
| [`submit-play.md`](submit-play.md) | `.github/workflows/submit-play.yml` | Store submit: Google Play | `workflow_dispatch` | 3 |
| [`submit-snap.md`](submit-snap.md) | `.github/workflows/submit-snap.yml` | Store submit: Snap Store | `workflow_dispatch` | 3 |
| [`submit-windows-store.md`](submit-windows-store.md) | `.github/workflows/submit-windows-store.yml` | Store submit: Microsoft Store | `workflow_dispatch` | 3 |
| [`symbolication-proof.md`](symbolication-proof.md) | `.github/workflows/symbolication-proof.yml` | Symbolication proof | `workflow_dispatch` | 2 |
| none | `.github/workflows/time-travel.yml` | Time travel | `workflow_dispatch`, `schedule` | 5 |
| none | `.github/workflows/trufflehog.yml` | TruffleHog | `schedule`, `workflow_dispatch` | 1 |
| [`update-goldens.md`](update-goldens.md) | `.github/workflows/update-goldens.yml` | Update goldens | `workflow_dispatch` | 2 |
<!-- END GENERATED: gen-ci-map workflows -->

**The parsed YAML did not change.** Each of the twelve was loaded before and
after with a duplicate-key-rejecting loader and the two documents compared: all
twelve are byte-identical as parsed. Only prose moved. `zizmor` reports the same
424 findings on the same 16 files as it did before.

### 9.1 What this did to every `<workflow>.yml:NNN` citation

Moving 4,843 YAML comment lines out of twelve files (164 `# why:` lines were
written back) shifts every line below them, and
**most shifted pointers land on some other real line and are accepted in
silence** — TRAPS `git-08`, and `ci-22`'s rule that *a citation is re-measured,
never offset*. So every pointer into these twelve was re-derived with `grep -n`
on the **cited text**, after the last edit to the cited file, in that order.
Three outcomes, and which one applies is stated at each site:

- **The text is still in the workflow** — the number is the one `grep -n`
  returned. Nothing here was computed by adding a delta to a previous number.
- **The text moved to this directory** — the pointer now names the page and the
  line here (for example `assert-release-provenance.mjs` quotes GitHub's
  environments documentation, which is now `docs/ci/submit-play.md:41-44`).
- **The text names a state that no longer exists anywhere** — the dated record
  is kept, exactly as measured, and stamped as historical. Line 352 of
  `submit-snap.yml` AS IT STOOD ON 2026-08-26 is the worked example: it recorded a one-brace `flutter-version:` typo on
  2026-08-26, and that workflow no longer carries a `flutter-version:` key at
  all, so there is no live line to re-measure onto and inventing one would be
  the exact failure the rule exists to stop.

Pointers into `ci.yml` and `deploy-workers.yml` from inside the moved prose were
re-measured the same way, because a dead pointer republished into a brand-new
file is a fresh-looking stale citation — the failure mode `ADR 053` rule 2 names.
