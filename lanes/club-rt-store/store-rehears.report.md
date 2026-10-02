BASE: 31b0e65d413639259026ccc28253733f1dd9ddf4
HEAD: 9a814b6e6db8a9d7c2db43675688a6b5cfd2c598

The patch is done and tested: 0 findings on the final affected-guards pass. Three items are only partly done; they are listed first under Deviations. The brief has no Dart parts, so I didn't clone Flutter. The sandbox has no remote, so nothing was pushed or dispatched.

## Tests, guards and red controls

| # | What | Command | Exit | Expected | Result |
|---|---|---|---|---|---|
| 1 | Baseline full suite at BASE | `node --test tooling/ci/test/*.test.mjs` | 0 (14817 tests) | green | ✅ |
| 2 | Full suite, odd-numbered files | `node --test $(cat half1)` (186 files) | 0 (7235 tests) | green | ✅ |
| 3 | Full suite, even-numbered files | `node --test $(cat half2)` (185 files) | 1 → fixed | green | 3 failures, all in `guards.test.mjs` (the two seams floor messages and the snap deps count); fixed. Only that file was re-run (#4), not the whole half |
| 4 | | `node --test tooling/ci/test/guards.test.mjs` | 0 (516/516) | green | ✅ |
| 5 | Per-file test runs | android-vapt-manifest · submit-lanes-take-dry-run-bytes · snap-submission · update-coverage · platform-proof-fresh · signing-seam · android-signing · apple-signing · appimage-signing · signing-seam-census · appstore-submission · play-submission · glitchtip-project · built-artifact-pr-lane | 0 each | green | ✅ |
| 6 | Final affected-guards pass | `node tooling/scripts/affected-guards.mjs` (with a local `origin/main` ref set to BASE, deleted afterwards) | 0 | green | 159 green, 0 findings. 10 red here and red at BASE with the same exit (platform-proof-fresh ×2, e2e-proof-fresh ×2, app-dod#2, alert-disposition, codeql, ops-register, lane-verdict, worker:platform). 60 over its time budget; those are covered by #2–#4 |
| 7 | Workflow guards, run one by one | release-lane-generic, publish-steps-guarded, workflow-hardening, publish-records, release-provenance, green-means-ran, seams-wired, channel-register, lane-coverage, signing-inputs-pinned, obfuscation-coupled, glitchtip-project, store-build-config, no-seam-forks, `artifact-signed-apple --static`, deploy-triggers-deploy, walks-bounded, update-coverage, versions, guard-coverage, enforcement-index, gen-ci-map | 0 each | green | ✅ |
| 8 | Same machine, also red at BASE | assert-xcode-floor / assert-apple-privacy-manifest / assert-ops-register | 2 / 2 / 2 | — | no xcodebuild here, an unbuilt tree, no token |
| RC1 | Unpinned snapcraft (real tree: `--channel "$track"` removed from build-platforms.yml) | `node tooling/ci/assert-update-coverage.mjs` | **1** (reverted → 0) | red | ✅ Also red (1) on the real tree before the pin existed |
| RC2 | 15-day-old dry run (fixture) | `assert-platform-proof-fresh.mjs --store-lanes --store-runs-file stale.json --now 2026-10-25T12:00:00Z` | **1** (fresh fixture → 0) | red | ✅ |
| RC3 | `schedule:` removed from the real submit-snap.yml | same, with the fresh fixture | **1** (reverted → 0) | red | ✅ |
| RC4 | Built manifest at targetSdk 35 | test V7 in android-vapt-manifest.test | asserts 1 | red | ✅ |
| RC5 | Play dry run with the secret absent | play-submission.test, "THE RED CONTROL" | asserts 1, zero requests sent | red | ✅ |
| RC6 | Apple dry run with the artifact missing | appstore-submission.test, absent-artifact refusal | asserts 1 | red | ✅ |
| RC7 | build-platforms run with the Apple env block removed | apple-signing.test, "RED CONTROL" (run as a process) | asserts 1 | red | ✅ |
| RC8 | Mutation: proof limb removed from android-signing.mjs | `node --test android-signing.test.mjs` | **1** (reverted → 0) | red | ✅ |
| RC9 | Snap submit job packs again, or skips its sha256 check | take-dry-run-bytes.test RC-SNAP / RC-SNAP-SHA | asserts a finding | red | ✅ |

## Deviations, seams that didn't match, and what I couldn't do

**Partly done or not done:**
- **Patch 2, probes for Windows and Snap — not done.** Only a job in the `store-publish` environment can read those secrets, and that environment has a required reviewer. An ops-watch job there would wait for approval on every run, and ops-watch runs 12 times a day. This needs a lead decision, for example an environment with no reviewer just for the probe. The Play half is done.
- **Patch 4, the AppImage signing step is still in build-platforms.** Dropping it turns `assert-guard-coverage` red, because that step is the only thing that runs `appimage-signing.mjs`. The Linux build is now stamped `linux-snap`. The step signs nothing because the AppImage channel is not armed.
- **Patch 7, proof dispatch — not done.** There is no remote. Runbook §16 text for the next Private pass is below.

**Choices I made, each tested:**
- **Scheduled runs pick one app.** A scheduled run has no input, so the gate uses the workspace set's only app (read from `--emit-apps`, never written in the file). With more than one app it fails and says to give the dry-run job a matrix. I kept the dry-run job single-app because the per-app guard requires every job to read `needs.gate.outputs.app`.
- **The store freshness check has a dated start.** It is `assert-platform-proof-fresh.mjs --store-lanes`, a new step in ci.yml with a 6-minute timeout. Three of the four lanes are already past 14 days, so the check prints instead of failing until `STORE_LANE_DEADLINE = 2026-10-21`. Without that, ci-gate would go red on merge. Any green run counts, whether scheduled or dispatched.
- **The submit jobs now name the event.** Each submit job's `if:` now also requires `github.event_name == 'workflow_dispatch'`. Without it, `assert-publish-steps-guarded` limb (a) fails the new schedule.
- **Play uses a flag.** The store touch is `--dry-run --touch-store`: it opens an edit, lists its tracks and deletes it, and never commits. An absent secret fails only with this flag; a plain `--dry-run` still sends nothing, so local runs and existing tests stay offline. A test checks that the workflow passes the flag.
- **Apple:**
  - The dry-run job now signs in-lane with apple-signing.mjs and fails unless the posture is release-signed.
  - It packages the .pkg with productbuild and proves both files with assert-artifact-signed-apple.
  - It runs `assert-xcode-floor` and the flutter#188060 patch step, and drops `--allow-missing-artifact`.
  - It uploads `store-<app>-apple-release-signed` with a SHA256SUMS file, plus the two hashes as job outputs. It is kept 90 days.
  - The 45-minute timeout is not measured yet.
- **Snap:**
  - snapcraft is pinned to `snapcraft_track: 9.x/stable`. Today `stable` is 9.1.3, so this keeps what the lanes already installed.
  - Renovate has no source for a snap track, so the pin carries an `$updateExemptions` reason.
  - The submit job now takes the dry-run job's .snap by sha256. `submit-snap.mjs` PG-5 accepts a needed dry-run job that grades the recipe and packs, as long as the submit job runs `sha256sum --check` before it submits.
  - The old snap exception in take-dry-run-bytes.test is removed.
- **Unsigned armed channels (AA-28).** I added a third condition to the signing seam: a run of the register's `aggregatingJob.workflow` (build-platforms.yml) counts as a release lane. All three signing scripts pass it. An armed row with missing secrets now fails build-platforms. Artifact names already carry the posture, so I added no separate name check.
- **Linux stamp.** The PR lane's Linux build (ci.yml `linux-artifacts`) is stamped `linux-snap` too; its twin test demands it. channel-register gets a stamp exemption for build-platforms#linux_web_android, linux-snap.
- **Floors re-based, each in its own commit with the measurement at the changed line:**
  - seams-wired `MIN_GRADED` 16→15
  - glitchtip-project test call-site floor 11→10
  - guards.test `CENSUS_FILL` 12→11
  - Each drop is exactly the build or symbol upload removed from `submit-snap.yml#submit`.
- **Regenerated files:** enforcement-index (`--write`), docs/ci/README.md (gen-ci-map `--write`), coverage-manifest.json (written by the guards).

**Not updated:** `docs/ci/build-platforms.md` still describes the Linux build as stamped linux-appimage, and one sentence in `submit-play.md` still says a dry run only prints when the secret is absent. gen-ci-map is green either way.

**Files shared with fix-submit-native-auth-gate:** all four `submit-*.yml` dry-run jobs and `build-platforms.yml`. The local writer will need to rebase onto that train.

**PR body draft:**
- **Rows:** O-STORE-LANES-HARD-WIRE-ONE-APP, O-LINUX-BUILD-STAMPED-AS-APPIMAGE; NEW O-STORE-DRY-RUNS-HAVE-NO-CADENCE (folds O-SNAP-PACK-PROVEN-ONLY-BY-A-BLOCKED-DISPATCH, O-SUBMIT-DRY-RUNS-NEVER-TOUCH-THE-STORE, O-APPLE-LANE-VALIDATES-NO-SIGNED-ARTIFACT, O-TARGET-SDK-GRADED-ON-SOURCE-ONLY, O-APPS-GOV-IN-APK-UNALIGNED-UNCHECKED, O-WEEKLY-PROOF-ACCEPTS-UNSIGNED-ARMED-CHANNELS)
- **Deploys:** none (workflows)
- **P1 (AA-03):** weekly schedule on four lanes + `--store-lanes` freshness check · red RC2
- **P2 (AA-17):** Play `--touch-store` · red RC5 · Windows and Snap probes deferred
- **P3 (AA-18, C-07):** Apple signs in-lane, signed artifact + SHA256SUMS · red RC6
- **P4 (AA-04, AA-23):** snap stamped, pinned and packed weekly; submit takes the dry-run bytes · red RC1
- **P5 (AA-28):** the platform proof is a release lane · red RC7
- **P6 (AA-22, AA-23):** built-targetSdk check (V7) + 16 KB check on the apps.gov.in apk · red RC4

**Runbook §16 text (for the next Private pass):** "The first App Store upload is manual. Dispatch submit-appstore.yml on main with `app=<id>`. Download the artifact `store-<id>-apple-release-signed`, run `shasum -a 256 -c SHA256SUMS` in it, and upload exactly that .ipa (Transporter or Xcode Organizer) and that .pkg. Do not build on a Mac."

## Diff stat

```
 .github/workflows/build-platforms.yml              |  52 +++++-
 .github/workflows/ci.yml                           |  17 +-
 .github/workflows/submit-appstore.yml              | 169 +++++++++++++++---
 .github/workflows/submit-play.yml                  |  26 ++-
 .github/workflows/submit-snap.yml                  | 169 +++++++++---------
 .github/workflows/submit-windows-store.yml         |  19 ++-
 docs/ci/README.md                                  |  20 +--
 docs/ci/submit-appstore.md                         |  37 ++--
 docs/ci/submit-play.md                             |  11 +-
 docs/ci/submit-snap.md                             | 126 +++-----------
 tooling/ci/android-signing.mjs                     |   2 +
 tooling/ci/appimage-signing.mjs                    |   2 +
 tooling/ci/apple-signing.mjs                       |   7 +-
 tooling/ci/assert-android-vapt-manifest.mjs        |  37 +++-
 tooling/ci/assert-channel-register.mjs             |  12 ++
 tooling/ci/assert-platform-proof-fresh.mjs         | 190 +++++++++++++++++++++
 tooling/ci/assert-seams-wired.mjs                  |   8 +-
 tooling/ci/assert-update-coverage.mjs              | Bin 16294 -> 18857 bytes
 tooling/ci/signing-seam.mjs                        |  24 ++-
 tooling/ci/test/android-signing.test.mjs           |  27 +++
 tooling/ci/test/android-vapt-manifest.test.mjs     |  29 +++-
 tooling/ci/test/apple-signing.test.mjs             |  25 +++
 tooling/ci/test/appstore-submission.test.mjs       |   8 +-
 tooling/ci/test/coverage-manifest.json             |  18 +-
 tooling/ci/test/glitchtip-project.test.mjs         |   5 +-
 tooling/ci/test/guards.test.mjs                    |  19 ++-
 tooling/ci/test/platform-proof-fresh.test.mjs      | 109 ++++++++++++
 tooling/ci/test/play-submission.test.mjs           |  50 ++++++
 tooling/ci/test/signing-seam.test.mjs              |  28 +++
 tooling/ci/test/snap-submission.test.mjs           |  36 ++++
 .../test/submit-lanes-take-dry-run-bytes.test.mjs  |  46 ++---
 tooling/ci/test/update-coverage.test.mjs           |  50 +++++-
 tooling/enforcement-index.json                     |  19 +--
 tooling/release/submit-appstore.mjs                |   4 +-
 tooling/release/submit-play.mjs                    |  78 +++++++--
 tooling/release/submit-snap.mjs                    |  24 ++-
 tooling/versions.json                              |   5 +
 37 files changed, 1174 insertions(+), 334 deletions(-)
```
(The final one-line comment fix in build-platforms.yml leaves these counts unchanged.)

