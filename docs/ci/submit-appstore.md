# `submit-appstore.yml`

The prose that used to live inside `.github/workflows/submit-appstore.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

[pipeline D-10] limb (i) — "a submission script exists AND RESOLVES TO A STEP
IN A WORKFLOW, parsed not grepped". This workflow is the step it resolves to.
tooling/channel-register.json's ios-appstore and macos-appstore rows both name
this file and this job in their `submission` block, so deleting either is a
register that points at nothing rather than an unnoticed loss.

🔴 DISPATCH-ONLY, AND THAT IS THE CORRECT SHAPE WHILE `served: false`.
CORRECTED 2026-09-08: both rows were owner-deferred behind OWNER_QUEUE A-4 (Apple
Developer Program,
$99/yr, plus an Apple device). That row CLOSED on 2026-08-31 and the
membership is ACTIVE - App Store Connect answered HTTP 200 on 2026-09-08. There IS an
account to submit to. The dispatch-only shape is still correct, for two different
reasons: nothing here emits a signed `.ipa` or `.pkg`, and `--submit` refuses by
design (`tooling/release/submit-appstore.mjs:158-160`).

⚠️ IT BUILDS WHAT CAN BE BUILT WITHOUT A CERTIFICATE, AND SAYS SO.
This is the one place this workflow deliberately differs from
submit-windows-store.yml. Microsoft re-signs the MSIX, so that job packages a
real, submittable artifact. Apple does not: a `.ipa` and a Mac App Store `.pkg`
require a distribution certificate and a provisioning profile that have never been
issued - GET /v1/certificates returned an EMPTY set on 2026-09-08, though OWNER_QUEUE
A-4 no longer gates them. So the job builds UNSIGNED — `flutter build ios --no-codesign` and
`flutter build macos` — which proves the Apple toolchain path still compiles
this app, and then runs the dry run with `--allow-missing-artifact`, which
makes the script SAY it validated the listing and the bundle identifier and
NOT the package. A job that claimed to validate an artifact it cannot produce
would be the more dangerous shape.
⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the reason above stopped being
true on 2026-09-09, when a distribution certificate and an App Store profile
were issued and build-platforms.yml began signing with them. The measured
reason: this lane builds unsigned by choice until the signing seam lands here,
and `--submit` refuses. `--allow-missing-artifact` stays until
submit-appstore.mjs resolves the artifact the way build-platforms.yml does.

### above `app:`

⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP). The app is a dispatch input,
`required: true`, with NO `default:` and no `type: choice`: either one is an
app id written into this file, and this lane used to carry that id on ten
lines. A dispatch now names it: `gh workflow run submit-appstore.yml -f
app=<id>`, where `<id>` is one of
`node tooling/ci/assert-release-lane-generic.mjs --emit-apps`. Only the `gate`
job reads the raw input, and only through `env:`; every other job reads the
gate's checked `app` output. `run-name` shows the input, which is safe there:
it is not a shell. assert-release-lane-generic.mjs limb I grades this shape,
and refuses an app id written on any line of the file.

The script's `--submit` mode refuses with UNVERIFIED rather than guessing at
App Store Connect's endpoints.

🔴 SOURCED FLOOR, AND THE RUNNER LABEL DOES NOT PIN IT: uploads to App Store
Connect "must be built with Xcode 26 or later" (developer.apple.com/news/upcoming-requirements/,
in force 28 April 2026). `macos-26` names an image family; on run 32947213393
it carried Xcode 26.6 / macOS 26.5.2 / arm64. tooling/versions.json declares
`xcode: "26"`, so submit-appstore.mjs prints no floor warning here —
build-platforms.yml's assert-xcode-floor.mjs is what compares runner to key.

## job `gate`

### above `gate:`

Same shape and same reason as build-platforms.yml's gate job: this workflow
runs `flutter build --release`, and a release build from an ungated commit is
[pipeline R-6]'s whole subject. assert-release-provenance.mjs walks the
`needs` graph, so gating once here covers the job below.

### above `timeout-minutes: 25`

25, not 10, and the number comes from the script rather than from the clock:
assert-gate-passed.mjs POLLS for up to its own 1200 s default (this call
leaves `--timeout-seconds` unset), so any bound at or under 20 kills it
mid-poll and replaces "timed out waiting for ci-gate" with an opaque
cancellation. Kept byte-identical in all five `gate:` jobs. [pipeline F-5b]

### before step **The app input names one app of the workspace**

⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP). The one reader of
`inputs.app`, through `env: APP_INPUT`, never as `${{ inputs.app }}` inside
`run:` (an input interpolated into a shell is an injection).
`assert-release-lane-generic.mjs --emit-apps --app "$APP_INPUT"` refuses a
value off `^[a-z][a-z0-9-]*$` before it reads anything else, then refuses an
id the workspace does not declare, naming the set. Only after it exits 0 is
the id written to `$GITHUB_OUTPUT` as the job's `app` output.

## job `dry-run`

### above `env:`

`APP` is the gate's checked output. Every `run:` reads `$APP`; the fields no
shell expands (the symbols artifact's `name:` and `path:`) read
`${{ needs.gate.outputs.app }}` itself.

### above `timeout-minutes: 45`

⏱ 2026-10-01 (review AA-18): 45, not 30. The job now signs in-lane, so it
adds a signed archive and export and a `productbuild` to the two compiles that
run 32947213393 (2026-08-26) measured at 12m04s. No signed run of this job has
been measured yet; build-platforms.yml's apple job, which does the same work,
runs under its own 30-minute bound. Re-measure on the first green run.

### before step **Toolchain under test**

When an Apple build breaks the first question is "what toolchain was
this?" — unrecoverable after the fact without this.

### before step **Prepare the Apple distribution identity**

⏱ 2026-10-01 (review AA-18 and C-07, O-APPLE-LANE-VALIDATES-NO-SIGNED-ARTIFACT).
Until this date both builds were UNSIGNED BY CHOICE and both dry runs passed
`--allow-missing-artifact`, so this lane validated a listing and never a package,
and the owner's manual first upload had no validated signed .ipa or .pkg to take.
The lane now signs with `tooling/ci/apple-signing.mjs`, the seam build-platforms.yml's
apple job uses, packages the .pkg with `productbuild`, PROVES both with
`assert-artifact-signed-apple.mjs`, drops the flag, and publishes the two files and
their `SHA256SUMS` as `store-<app>-apple-release-signed`. This workflow is a declared
submission workflow of both Apple rows, so an absent or partial secret set FAILS
the run (signing-seam limb b); a non-release posture fails the step after it.
`--submit` still refuses: nothing here uploads to App Store Connect.

### before step **Build iOS (signed archive + export)**

🔴 SIGNED IS NOT THE SAME AS CONFIGURED, and until 2026-08-04 both
steps were unconfigured. `AppConfig.isBackendLive` compares each define below
against a PLACEHOLDER constant, so a build passing none of them resolves
`MockAuthRepository` and `SeedApiClient` — the artifact this submission
path validated was the DEMO build, with mock sign-in and seeded data, and
no crash sink either. That was found on the Google Play lane and is the
same defect on every store lane; deploy-web.yml had been passing all three
from secrets that already existed. Graded by
tooling/ci/assert-store-build-config.mjs, which derives the required set
from `isBackendLive` and the lanes from each store row's own declaration.

### before step **Dry-run the App Store submission (iOS)**

The App Store Connect API key EXISTS and is a repository secret; the SIGNING
credentials do not exist yet. OWNER_QUEUE A-4, which was to create the Apple
Developer account, CLOSED on 2026-08-31; that account already issued the API key, and
GET /v1/certificates returned an EMPTY set on 2026-09-08 — so what is absent is a
distribution certificate an agent can now issue, not an account. The
script reports their ABSENCE as a printed gap rather than a failure.
`secrets` are empty strings when unset, which is what the script's
presence check reads. The .p8 key is never read by the script, only
tested for presence.
⏱ 2026-09-26 (O-STORE-LANES-HARD-WIRE-ONE-APP): the certificate was issued on
2026-09-09 (the header's dated line), and the job still builds unsigned by
choice. The script now also refuses, before anything else, an app whose bundle
id (`tooling/apple-provisioning.json`, read by apple-provisioning.mjs
`bundleIdOf`) is not the channel row's `bundleIdentifier`: the
`APP_STORE_CONNECT_*_APP_ID` secret is ONE record, the first app's, and a
second app's dry run would otherwise validate against it and pass. Per-app App
Store records are O-STORE-RECORDS-ARE-ONE-PER-CHANNEL's.
⏱ 2026-10-01 (review AA-18): no `--allow-missing-artifact`. The job signs and
packages first, so the script reads the .ipa and the .pkg at the row's
`signing.seam.artifactGlob`, and an absent one FAILS the dry run.

### before step **Dry-run the App Store submission (macOS)**

A SEPARATE step and a SEPARATE secret for the app id, because these are
two App Store Connect records with independent review outcomes. Running
them as one step would make one failure look like two channels broken,
and one pass look like two channels validated.


---

## ⏱ 2026-09-26 — this lane records every run (O-APPLE-SUBMISSION-UNRECORDED, O-SUBMISSION-LANE-WITHOUT-RECORDER)

**Appended, not rewritten.** Until this date this lane wrote no [10]D-9 record at all. It is never
declared dry-run-only (parent decision): every run records itself, with its mode
(`tooling/ci/record-deployment.mjs --mode`).

* The `dry-run` job now carries job-level `permissions: { contents: read, deployments: write }`, and
  ends with two steps, one per channel it rehearsed: **Record the iOS dry run in the [10]D-9 ledger
  (mode dry-run)** and **Record the macOS dry run …**, each running
  `record-deployment.mjs "${APP}-<channel>" --mode dry-run`. They write
  `subscriptiontracker-ios-appstore-dry-run` and `subscriptiontracker-macos-appstore-dry-run`, with
  `production_environment: false` and `payload.mode: "dry-run"`. No reader of the production ledger
  opens either environment, and check-prod-provenance also refuses a record whose payload says `dry-run`.
* The PRODUCTION record of an App Store upload comes with the upload job, the day it exists:
  assert-publish-records.mjs rules 2 and 3b make that job record `--mode production`. The per-app
  `recordId` belongs to O-STORE-RECORDS-ARE-ONE-PER-CHANNEL, not to this change.

GitHub creates the two `-dry-run` environments the first time a Deployment names them, with no
protection rules. UNVERIFIED on this repository until the first dry run after the merge.
