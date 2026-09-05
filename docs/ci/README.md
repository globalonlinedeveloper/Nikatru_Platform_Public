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
| `worker-subly-api` | the subly-api Worker: `npm ci`, `tsc --noEmit`, `npm test`, `wrangler deploy --dry-run` | yes |
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
  job carries `timeout-minutes`** — `tooling/ci/assert-workflow-hardening.mjs`,
  and now also enforced natively by GitHub (`sha_pinning_required`,
  `allowed_actions: selected`).
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
major, Java, Melos, mason_cli, wrangler and the runner image labels. Renovate
has a `customManager` per key, and `tooling/ci/assert-update-coverage.mjs`
fails if a pin gains no manager and no written exemption.

The workflows reach it through two composite actions:

- `.github/actions/setup-flutter` — reads `versions.json.flutter` at run time,
  then `subosito/flutter-action` with the SDK and pub cache restored.
- `.github/actions/setup-node` — reads `versions.json.node`, then
  `actions/setup-node`.

These replaced **18 copies of the setup-node block and 14 of the
flutter-action block**, and five separate `FLUTTER_VERSION: '3.47.2'` env
declarations.

## 6. Secrets the owner still has to add

17 secrets exist. **15 are referenced by a workflow and do not exist**, at
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
| `allowed_actions` | `selected` + a named allowlist | GitHub now enforces natively what `assert-workflow-hardening.mjs` enforced alone. |
| `sha_pinning_required` | true | as above. |
| `delete_branch_on_merge` | true | |

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
