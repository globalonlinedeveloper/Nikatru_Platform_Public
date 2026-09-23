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

## 3. The lane map

| job | what it is | in `ci-gate`'s `needs` |
|---|---|---|
| `worker-subscriptiontracker-api` | the subscriptiontracker-api Worker: `npm ci`, `tsc --noEmit`, `npm test`, `wrangler deploy --dry-run` | yes |
| `worker-platform` | the platform Worker, the same four steps | yes |
| `guard-meta` | the guards' own mutation suite plus the guards-about-guards | yes |
| `guards-platform` | platform, data, ops and registry assertions | yes |
| `guards-legal` | privacy, legal, consent and money assertions | yes |
| `guards-store` | store, release, signing and versioning assertions, and the five submission dry-runs | yes |
| `guards-chassis` | chassis, app-surface, package-boundary and accessibility assertions | yes |
| `security-scan` | gitleaks + `scan-secrets.mjs`, zizmor + `scan-workflows.mjs` | yes |
| `site-tokens` | design tokens build + drift | yes |
| `site-shared` | shared site build | yes |
| `content-gate` | content pipeline: recipe → pack → sign → gate | yes |
| `app-brick` | stamps both probe variants, analyzes, validates the clone contract | yes |
| `sites` | static sites: functions parse, generated feeds, discovery surface | yes |
| `workspace-gate` | `melos analyze` + `melos test` over the whole workspace | yes |
| `ci-gate` | the aggregate — the single required status check on `main` | — |

Two security lanes live in their **own** workflow files and are deliberately
**not** in `ci-gate`'s `needs` — `codeql.yml` and `trufflehog.yml`. They are
alert sinks rather than merge gates; §7.3 says why, and each has a duty row in
`tooling/ops/register.json` that carries its cadence.

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

## 4. Rules any change to these files must keep

Each is enforced by a guard that will fail the build, named so you can read it:

- **`ci-gate` is the only required check on `main`**, it carries `if: always()`,
  it `needs:` **every** other job in `ci.yml`, it echoes each
  `needs.<job>.result`, and it treats `failure`, `cancelled` **and `skipped`**
  as not-green — `tooling/ci/assert-green-means-ran.mjs`.
- **No lane inside the gate carries a job-level `if:`** — same guard.
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

17 secrets exist. **26 are referenced by a workflow and do not exist**, at
repository or environment level. Every path that needs one fails closed with a
named secret rather than skipping — see §4 — so nothing here is a silent pass;
it is a lane that cannot run until the credential is created.

| secret | referenced by | what is blocked |
|---|---|---|
| `APP_STORE_CONNECT_ISSUER_ID` | `submit-appstore.yml` | Apple submission (dry run has no credential) |
| `APP_STORE_CONNECT_KEY_ID` | `submit-appstore.yml` | as above |
| `APP_STORE_CONNECT_PRIVATE_KEY` | `submit-appstore.yml` | as above |
| `APP_STORE_CONNECT_IOS_APP_ID` | `submit-appstore.yml` | as above |
| `APP_STORE_CONNECT_MACOS_APP_ID` | `submit-appstore.yml` | as above |
| `APPLE_DIST_CERT_P12_BASE64` | `build-platforms.yml` | Apple builds are unsigned |
| `APPLE_DIST_CERT_PASSWORD` | `build-platforms.yml` | as above |
| `APPLE_PROVISIONING_PROFILES_BASE64` | `build-platforms.yml` | as above |
| `APPLE_TEAM_ID` | `build-platforms.yml` | as above |
| `MS_STORE_TENANT_ID` | `submit-windows-store.yml` | Microsoft Store submission |
| `MS_STORE_CLIENT_ID` | `submit-windows-store.yml` | as above |
| `MS_STORE_CLIENT_SECRET` | `submit-windows-store.yml` | as above |
| `MS_STORE_PRODUCT_ID` | `submit-windows-store.yml` | as above |
| `WINDOWS_CODESIGN_PFX_BASE64` | `build-platforms.yml` | Windows artifacts unsigned |
| `WINDOWS_CODESIGN_PASSWORD` | `build-platforms.yml` | as above |
| `SNAPCRAFT_STORE_CREDENTIALS` | `submit-snap.yml` | the Snap live upload path |
| `APPIMAGE_SIGNING_KEY_B64` | `build-platforms.yml` | AppImage unsigned |
| `SNAPCRAFT_STORE_CREDENTIALS_EXPIRES` | `submit-snap.yml` | the Snap lane refuses a credential whose expiry it cannot read — the date passed to `snapcraft export-login --expires`, recorded because the exported blob's format is documented nowhere |
| `AMO_JWT_ISSUER` | `extensions.yml` | the Firefox (AMO) submission — the ONE store whose API can make a first submission |
| `AMO_JWT_SECRET` | `extensions.yml` | as above |
| `CWS_SERVICE_ACCOUNT_JSON` | `extensions.yml` | the Chrome Web Store upload+publish pair, and the daily `cws-token-keepalive` job — a Google service-account key, minted into an access token by the JWT-bearer grant. **Replaced `CWS_CLIENT_ID` + `CWS_CLIENT_SECRET` + `CWS_REFRESH_TOKEN` on 2026-09-09**, when [developer.chrome.com's service-account page](https://developer.chrome.com/docs/webstore/service-accounts) turned the refresh-token shape from a requirement into a stale assumption |
| `CWS_PUBLISHER_ID` | `extensions.yml` | as above; the v2 API path carries a publisher segment the older v1.1 path did not |
| `EDGE_CLIENT_ID` | `extensions.yml` | the Edge Add-ons v1.1 four-call submission |
| `EDGE_API_KEY` | `extensions.yml` | as above |

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

There are also **zero repository variables**. Non-secret values such as
`API_BASE_URL`, `SUPABASE_URL` and `SUPABASE_PROJECT_REF` are stored as secrets,
which is why deploy logs are masked and hard to read. Moving them to variables
is a follow-up, not done here.

## 7. Repository settings CI depends on

Recorded so a change to any of them is a deliberate act:

| setting | value | why |
|---|---|---|
| repository visibility | **public** | GitHub bills standard runners at 100% discount on public repositories. 31,674 minutes in 2026-08 cost **$0.00**. The whole economics of the factory rests on this one setting. |
| self-hosted runners | **none, ever** | ADR 067 decision 4. |
| required status checks on `main` | exactly `ci-gate`, strict | one aggregate, forever. |
| `enforce_admins` | true | |
| `allowed_actions` | `selected` + a named allowlist | GitHub now enforces natively what `assert-workflow-hardening.mjs` enforced alone. The allowlist is GitHub-owned + verified creators + `subosito/flutter-action`, `cloudflare/wrangler-action`, `nanasess/setup-chromedriver`, `dorny/paths-filter`, `renovatebot/github-action` — the five third-party actions the tree actually uses. |
| `sha_pinning_required` | **false, and it cannot be true** | GitHub applies it to actions nested inside an action you use, and `subosito/flutter-action` references `actions/cache@v5`. See §7.1 — this is measured, twice, not a preference. |
| `delete_branch_on_merge` | true | |
| `allow_auto_merge` | **true** (was `false` until 2026-09-07) | `site-drift-repair.yml` arms `gh pr merge --auto --squash` on the repair pull request it opens, which is the half that stops main sitting red until a human merges it. `--auto` queues *behind* `ci-gate`, so this grants nothing branch protection did not already gate. Renovate's `automergeType: "pr"` uses the same setting. |
| `Allow GitHub Actions to create and approve pull requests` | true | `can_approve_pull_request_reviews`. Necessary for `site-drift-repair.yml` and **not sufficient** — see §7.4. |

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
which is where it always was. The other four allowed third-party actions were read at their pinned
SHAs (`gh api repos/<o>/<r>/git/trees/<sha>` → `git/blobs`): `cloudflare/wrangler-action` (node20),
`nanasess/setup-chromedriver` (node24) and `dorny/paths-filter` (node20) are JavaScript actions with
no nested `uses:` at all, so flutter-action is the only blocker.

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
against both public repositories with a PAT.

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

| page | workflow | what it covers |
| [`build-platforms.md`](build-platforms.md) | `.github/workflows/build-platforms.yml` | the six-platform build, and the durable release artifacts |
| [`deploy-web.md`](deploy-web.md) | `.github/workflows/deploy-web.yml` | the Pages deploy, the source maps, and why a 200 proves nothing here |
| [`deploy-workers.md`](deploy-workers.md) | `.github/workflows/deploy-workers.yml` | the two Worker deploys, migrations-before-deploy, and the path filters #155 is about |
| [`e2e.md`](e2e.md) | `.github/workflows/e2e.yml` | the nightly run against live Supabase, the live Worker and live D1 |
| [`extensions.md`](extensions.md) | `.github/workflows/extensions.yml` | the build-free extensions subtree: gates, sims, packaging, e2e |
| [`ops-watch.md`](ops-watch.md) | `.github/workflows/ops-watch.yml` | the alarm clock, twelve cron slots and one durable issue |
| [`redeploy-stranded.md`](redeploy-stranded.md) | `.github/workflows/redeploy-stranded.yml` | re-entering a deploy lane its own red ci-gate stranded, and never one that really failed |
| [`renovate.md`](renovate.md) | `.github/workflows/renovate.yml` | dependency updates, and why the cron is daily against a weekly duty |
| [`site-drift-repair.md`](site-drift-repair.md) | `.github/workflows/site-drift-repair.yml` | the post-merge sitemap repair no pre-merge lane can do |
| [`store-screenshots.md`](store-screenshots.md) | `.github/workflows/store-screenshots.yml` | the live Play capture, proposed for review rather than pushed |
| [`submit-appstore.md`](submit-appstore.md) | `.github/workflows/submit-appstore.yml` | the Apple dry run, unsigned until a distribution certificate is issued (the account is active) |
| [`submit-play.md`](submit-play.md) | `.github/workflows/submit-play.yml` | the only lane in the tree that uploads to a public store |
| [`submit-snap.md`](submit-snap.md) | `.github/workflows/submit-snap.yml` | the Snap upload, and the read-after-upload it cannot have |
| [`submit-windows-store.md`](submit-windows-store.md) | `.github/workflows/submit-windows-store.yml` | the Microsoft Store path, dispatch-only while `served: false` |
| [`symbolication-proof.md`](symbolication-proof.md) | `.github/workflows/symbolication-proof.yml` | dispatch-only: an obfuscated Android crash, read back from GlitchTip and from `flutter symbolize` against its known line |

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
