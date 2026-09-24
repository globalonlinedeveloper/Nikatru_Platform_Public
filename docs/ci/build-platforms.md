# `build-platforms.yml`

The prose that used to live inside `.github/workflows/build-platforms.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

Proves the portfolio's core claim — ONE codebase, SIX platforms — on real
runners. Deliberately NOT on every push: six builds is minutes of runner time
and the per-push signal is already covered by `ci.yml`. Run it on demand, and
before any release.

WHY THIS EXISTS AT ALL: three of the six cannot be built on the owner's
Windows box.
  • macOS + iOS  — impossible on Windows, full stop. Needs Apple toolchain.
  • Android      — BROKEN locally: `java.io.IOException: Unable to establish
                   loopback connection`, fails at Gradle startup in ~4s and
                   persists with the daemon disabled. Environmental.
  • Windows      — blocked locally until the VS ATL component is installed
                   (`atlstr.h` missing → flutter_secure_storage_windows won't
                   compile). Green here because GitHub's runner ships ATL.
Web and Linux do build locally; they run here too so one green run answers
"does it build everywhere" without caveats.

### above `push:`

Also gate release tags, where "it built on my machine" is not good enough.

`<app>-v*`, not `subscriptiontracker-v*` — widened 2026-08-06 with the matrix refactor for
[9]R-1. The old glob was the last app-specific string left in this file after
every path became a matrix value, and it is the half nobody would notice:
tagging `probe-v1.0.0` would have produced NO six-platform proof and no
error, because a tag that matches no filter is simply not a trigger. The
widening is strictly additive — every `subscriptiontracker-v*` tag still matches — and
`android-signing.mjs` derives "this is a release" from the `refs/tags/`
PREFIX, never from the app slug, so the signing posture is unchanged.

### above `schedule:`

WEEKLY, added 2026-07-27 for [pipeline F-4]. Until this existed the workflow
ran only when a human clicked it, so the "all 6 platforms build" claim was
true but UNDATED — found eight commits stale, and green again only because
someone dispatched it by hand. An undated proof is a requirement that cannot
fail, which is the exact defect this stage exists to remove.

The timer alone is NOT the fix. GitHub disables scheduled workflows in public
repos after a long inactive stretch, and a renamed branch or quota change does
the same — so a dead cron looks identical to a healthy one. tooling/ci/
assert-platform-proof-fresh.mjs reads the AGE of the newest green run on every
build and fails past 14 days, which is what turns this silence into a signal.

### above `- cron: '0 6 * * 4'   # Thursdays 06:00 UTC`

SECOND CHANCE, added 2026-08-26. ONE weekly slot gives the 14-day ceiling
in assert-platform-proof-fresh.mjs exactly ONE chance per fortnight to be
renewed, and a miss reddens `ci-gate` REPO-WIDE until a SCHEDULED run
succeeds — `gh workflow run` cannot clear it, because the guard counts only
`event === 'schedule'`. Measured on this very workflow: the anchor run
32003607931 landed 2026-08-17T06:55:35Z, so the ceiling expires
2026-08-31T06:55:35Z and the Monday slot fires 06:00Z — 55 minutes of
margin. GitHub's measured queue drift HERE was +56, +59, +102 and +226
minutes on the last four scheduled runs: THREE OF FOUR WOULD HAVE MISSED.
A second weekday costs one extra build a week and turns a single point of
failure into two independent ones. It does NOT touch MAX_AGE_DAYS, which
stays 14 — raising the ceiling would hide rot, whereas firing more often
proves the timer more often. That is the whole difference.

### above `permissions:`

Least privilege. These jobs only read the repo — they publish nothing through
GITHUB_TOKEN. Without this every job ran at the repository-default scope, which
on a public repo is a standing hand-out to any compromised action. [pipeline F-11]
`checks: read` is the one addition the gate job below needs: it asks the API
for ci-gate's verdict and reads nothing else.

## job `gate`

### above `gate:`

── the gate, once, for all three platform jobs ────────────────────────────
This workflow produces the ONLY 6-platform proof this factory has, and
`assert-platform-proof-fresh.mjs` feeds that proof back into `ci-gate` as
evidence. Ungated, it would build from any dispatched ref — including one
whose gate is RED — and the resulting green run would be consumed as proof
that the six platforms build at a commit that never passed its own tests.
It also triggers on `push: tags: <app>-v*`, which is a release trigger by
any reading.

ONE job rather than a first step in each of the three: the verdict is the
same for all of them, `assert-gate-passed.mjs` POLLS (ci-gate is often still
running), and three parallel polls of one API for one answer is waste. The
cost is one extra runner-minute; the benefit is that a red gate skips all
three builds instead of racing them.

Since the matrix refactor the three build jobs reach this gate THROUGH
`prepare` (`gate → prepare → builds`) instead of naming it directly. A red
gate skips `prepare`, and a skipped `prepare` skips all three — the same
outcome by the same mechanism, one edge further along. See the note on
`prepare` for why the edge is written that way.

⚠️ `all_platforms` must `needs:` this job too — `assert-channel-register.mjs`
asserts the aggregator covers every other job, so forgetting it fails CI
rather than silently narrowing what "all platforms green" means.
[pipeline R-6, F-5b]

### above `timeout-minutes: 25`

25, not 10, and the number comes from the script rather than from the clock:
assert-gate-passed.mjs POLLS for up to its own 1200 s default (this call
leaves `--timeout-seconds` unset), so any bound at or under 20 kills it
mid-poll and replaces "timed out waiting for ci-gate" with an opaque
cancellation. Kept byte-identical in all five `gate:` jobs. [pipeline F-5b]

## job `prepare`

### above `prepare:`

── which apps does this factory hold? ──────────────────────────────────────
[pipeline 9]R-1: "adding an app requires no new or edited workflow file."
Every build job below is a MATRIX over this job's output, so the answer to
"which apps get built" is the root pubspec's `workspace:` list and nothing
else — the same list `melos run gate` resolves and `assert-workspace-
coverage.mjs` already polices. Adding an app to that list adds three matrix
legs here; no line in this file mentions any app by name.

🔴 THE EMITTER IS assert-release-lane-generic.mjs ITSELF, and that is the
point rather than a shortcut. That guard grades this workflow by comparing
the apps it covers against the workspace, and it now PRODUCES the set the
matrix iterates. One function, one file: a lane cannot drift from the
workspace without the guard's own reading drifting with it. Two readers of
one pubspec is the copy that quietly stops reading what it thinks it reads,
which is this repository's single most repeated failure.

It fails loudly on an empty answer. A `matrix: []` runs ZERO jobs and reports
success, and `all_platforms` below would then aggregate nothing and print
"All 6 platforms built" — green over an empty set, exactly the shape
assert-green-means-ran.mjs exists for.

⚠️ IT SITS BETWEEN `gate` AND THE BUILDS, and the chain is `gate → prepare →
{linux_web_android, windows, apple}` rather than each build job needing both.
Two reasons, and the second one is not cosmetic:
  · a matrix job can only read `needs.<job>.outputs`, so `prepare` HAS to be
    a direct dependency of every job that iterates it;
  · `assert-platform-proof-fresh.mjs` reads the aggregator's `needs:` with a
    whole-file `/needs:\s*\[([^\]]+)\]/` — the FIRST flow-form list in the
    file. Giving the platform jobs `needs: [gate, prepare]` puts a flow list
    above the aggregator's and that guard then reports the platform jobs as
    unwired: a false COVERAGE LOST on a correctly wired workflow. Keeping the
    scalar form leaves its reading untouched. (The fragility is that guard's,
    not this file's, and it is recorded here because the next person to add a
    second dependency to a build job will hit it again.)
The gating posture is unchanged: a red ci-gate skips `prepare`, which skips
all three build jobs, which is what it did when they named `gate` directly.

### above `GITHUB_SHA_SHORT: ${{ steps.workspace.outputs.GITHUB_SHA_SHORT }}`

── the release line's build metadata, derived ONCE for the whole run ────
[9]R-2. Every lane's APP_VERSION ends `+<short sha>`, because a version
has to be ORDERED (the run number) *and* TRACEABLE (the commit), and one
number cannot be both — a SHA identifies a build and can never rank two.

⚠️ IT IS DERIVED HERE, IN THE ONE JOB THAT RUNS ON UBUNTU, AND THAT IS
THE POINT. `${GITHUB_SHA::7}` is bash parameter expansion. deploy-web.yml
writes it inline because every step of that lane is bash; the `windows`
job below runs pwsh, where the same characters are a syntax error, and
`${{ github.sha }}` is the full 40 chars — 54 rendered, past the 32 the
platform Worker stores app_version in (assert-app-versioning.mjs
APP_VERSION_MAX). One derivation on the one shell that has the expansion,
consumed by both platform jobs as an expression, is what makes the three
lanes carry the SAME string rather than three spellings of it.

The output is NAMED `GITHUB_SHA_SHORT` rather than `sha7`: assert-app-
versioning.mjs asserts APP_VERSION's build metadata is derived from the
commit by looking for `GITHUB_SHA` or `github.sha` in it, and a name that
hides the provenance from the guard would be a version that reads as
untraceable the day one of these rows flips to `served: true`.

### before step **The tag must name the version the app declares**

── the tag is read BEFORE six platforms are built ───────────────────────
`--tag` compares the version the tag NAMES against the build name
apps/<slug>/pubspec.yaml DECLARES. Here that is an EARLY FAIL and nothing
more: a tag naming a version the app does not carry stops in the FIRST
job after `gate`, instead of after three build jobs declaring
`timeout-minutes` of 30 to 45. The AUTHORITATIVE copy is in `release`, on the
exact string that renames the installers.

⚠️ NO `--app` ON PURPOSE. Without it the guard derives `apps/<slug>` from
the tag itself, which is what keeps its app-existence and exact-leaf
(casefold) limbs live — `--app` would answer that question for it.

`github.ref_name` goes through `env:`: a ref name is attacker-influenced
text and `${{ }}` inside a `run:` is substituted before bash ever sees it.
[zizmor template-injection]

## job `strategy`

### above `strategy:`

`fail-fast: false` because each leg is an independent PROOF, not a stage of
one build: app #2 failing to compile says nothing about app #1, and
cancelling app #1's run destroys the evidence that would have told them
apart. With one app in the workspace this changes nothing.

## job `with`

### above `with:`

persist-credentials: false — actions/checkout otherwise writes GITHUB_TOKEN
into .git/config and LEAVES it there for the whole job. Any later step that
packages the workspace (or anything containing .git/) ships the token inside
the artifact, and on a PUBLIC repo artifacts are downloadable. Nothing here
does git push/tag/commit, so none of these checkouts need the credential.
[zizmor artipacked] Verified 2026-07-27: no current artifact path includes
.git/ — so this closes a FUTURE mistake, not a live leak.

## job `linux_web_android`

### before step **Linux build deps**

GTK + ninja are the Linux desktop toolchain.

libsecret-1-dev + libjsoncpp-dev are NOT optional: flutter_secure_storage
(our SecureStore impl, ADR 005) binds a NATIVE secure-storage library on
every desktop platform, and the runner image ships none of them. Without
it CMake fails with `libsecret-1>=0.18.4 not found` from
flutter_secure_storage_linux/linux/CMakeLists.txt:15.

Same root cause as the Windows failure on the owner's box, where the
equivalent dependency is the VS ATL component (atlstr.h). One package
choice, two platform-native prerequisites.

libmpv/libasound are NOT needed today (ADR 013 keeps media_kit off
Linux) — add them the moment a Linux media build is attempted, or CMake
fails on PkgConfig::mpv with an equally misleading message.
libcurl4-openssl-dev is the THIRD instance of the same lesson, found
2026-07-31 by dispatching this workflow after touching it: `sentry_flutter`
(packages/telemetry, [pipeline G3]) vendors **sentry-native**, which is C
and does its own `find_package(CURL)`. Without the dev headers CMake dies
with `Could NOT find CURL (missing: CURL_LIBRARY CURL_INCLUDE_DIR)` from
`_deps/sentry-native-src/CMakeLists.txt:501`, and the failure names sentry,
not Flutter, so it reads as a telemetry bug rather than a missing package.

🔴 THE LANE HAD BEEN RED SINCE THE TELEMETRY WORK LANDED AND NOTHING SAID
SO: this workflow runs only on dispatch, a release tag, and a weekly cron,
so a break here is invisible until someone looks. Last green was 2026-07-26.
`assert-platform-proof-fresh.mjs` would have turned it into a ci-gate
failure around 2026-08-09 — 14 days after that green — which is precisely
the "silence is not a signal" job it was built for, working as designed but
nine days slower than a human dispatching the workflow once.

### before step **Resolve the workspace**

apps/subscriptiontracker is a pub WORKSPACE member: resolution happens at the repo
root, not in the app directory.

### before step **Derive the release line from pubspec**

── [9]R-2 · THE RELEASE LINE, DERIVED, NEVER TYPED ─────────────────────
The same step deploy-web.yml runs, reading the same pubspec with the same
parser the guard uses — so the number that gets BUILT and the number that
gets ASSERTED cannot disagree. Until this existed, this workflow had no
release line at all, which is why the two notes below used to say a
`--build-name` here would have to be a literal: a literal would be a
second copy of the version, free to drift from pubspec, and that is the
defect [9]R-2 exists for rather than a step toward fixing it.

The step `id:` is load-bearing: assert-app-versioning.mjs finds the emit
line, walks back for an `id:`, and then requires `steps.<id>.outputs.
release_line` to appear somewhere in the file — a lane that derives the
version and then versions itself from somewhere else is the shape it
exists to catch.

### before step **Build web**

── every artifact this job produces carries the crash sink ─────────────
[pipeline 11]E-7. TelemetryBootstrap falls back to a NoOp client when the
DSN is empty — correct behaviour, and INDISTINGUISHABLE FROM WORKING. So
until this line existed, every artifact this workflow uploaded shipped
with crashes reaching nobody, while assert-seams-wired.mjs printed ok:
that guard read the filename `deploy-web.yml` and nothing else, so it
answered "does the WEB deploy supply the DSN" rather than the question
the requirement asks. It now derives the set of jobs that must supply it
from the `lane` of every row in tooling/channel-register.json — this job
is the lane of `android-play` — so a new channel acquires the obligation
by being given a lane.

⚠️ On a fork PR `secrets.GLITCHTIP_DSN` is empty and the build falls back
to the NoOp client. That is the correct outcome for an untrusted build,
and it is why the guard checks the DEFINE rather than a non-empty value:
a check on the value could only ever run where the secret exists.

✅ RELEASE ATTRIBUTION IS SUPPLIED FROM HERE ON — [9]R-2, closed 2026-08-08.
This note used to read "⬜ RELEASE ATTRIBUTION IS NOT SUPPLIED HERE",
because `release: 'subly@${AppConfig.appVersion}'` (apps/subscriptiontracker/lib/
main.dart:25) needs an APP_VERSION and this workflow had no release line
to derive one from — so every crash from every artifact it produced
reached GlitchTip under the compiled-in default. The `ver` step above is
that release line, and each STORE-lane build below now carries it.

⬜ THE WEB BUILD IN THIS JOB IS THE ONE EXCEPTION, and it is deliberate.
It uploads nothing (see the `path:` list at the end of this job) and it
is not the web CHANNEL — deploy-web.yml is, and it stamps its own
APP_VERSION and `RELEASE_CHANNEL=web`. Stamping a channel here would put
a second lane's identity on an artifact nobody receives. What this build
proves is that web COMPILES, which needs no release id.

### before step **Build linux**

⬜ `RELEASE_CHANNEL=linux-appimage` IS THE CLOSEST TRUE ANSWER, NOT AN
EXACT ONE, and it is written down rather than left to be inferred. What
this step produces is a DESKTOP BUNDLE, and no `.AppImage` is packaged
anywhere in this repository today: `linux-appimage` is `kind: direct`,
`served: false`, and its `lane` is null. The stamp says which
distribution channel this binary is FOR — and for a Linux desktop build
from this factory the register names exactly one direct download channel.
The alternative is the compiled-in default `dev`, which makes a crash
from a released Linux bundle indistinguishable from one on a developer's
laptop, and that is the defect the define exists to remove. When an
AppImage lane lands it inherits this row and this line unchanged; if a
different Linux channel ever ships first, this value moves with it.

No `--build-number`: it is Play's versionCode and nothing else reads it,
and adding it here would put a monotonic counter on a lane no store
consumes. APP_VERSION — the string version_gate.dart and every analytics
row actually read — is identical to the store lanes'.

### before step **Prepare the AppImage signing key**

── the linux-appimage channel's SIGNING KEY ─────────────────────────────
The Linux half of the pair `android-signing.mjs` forms for Play, wired in
the same shape and for the same reason. The `linux-appimage` row of
tooling/channel-register.json has declared `APPIMAGE_SIGNING_KEY_B64`
since PR #202 and a tree-wide grep for that name returned THE REGISTER
AND NOTHING ELSE — a correct declaration with no consumer, which is the
Android state of 2026-08-04 exactly, and on the Android side it meant
every .aab this factory produced was debug-signed while every
configuration check stayed green.

⬜ NO .AppImage IS PACKAGED IN THIS REPOSITORY TODAY, and this step says
that out loud rather than implying otherwise. What it decides is the
POSTURE: with the secret absent it exports `unsigned-build-proof` and
PRINTS the gap in capitals (the row wants a detached Ed25519 signature
and no key has been generated); with the secret supplied it materialises
the key, self-verifies a sign/verify round trip, and exports
`release-signed`. Wiring it before the packaging step exists is the
point — the day an AppImage is packaged, the key already arrives through
a path somebody reviewed rather than one added in the release commit.

Key material is written to $RUNNER_TEMP, never the workspace, for the
reason recorded on the Android key step below: every `upload-artifact`
path in this file is workspace-relative and this repo is PUBLIC, so a
private key inside the tree is one broad `path:` away from publication.

### before step **Generate the snapcraft recipe**

── the snapcraft recipe, DERIVED from the bundle just built ─────────────
[pipeline D-10] / [ADR 015] §3. `tooling/release/submit-snap.mjs` §4 has
printed "NO SNAPCRAFT RECIPE — nothing in this repo can build a .snap
today" on every run since it was written, and nothing could fail on it.

The recipe is GENERATED rather than committed because a committed one is
a SECOND COPY of five facts that already have one home each — the snap
name, the summary, the description, the licence and the Linux binary
identity — and a second copy is the copy that goes stale. [10]D-5's whole
claim is "the listing lives in the repo and the dashboard is a copy of
it"; a hand-written snapcraft.yaml would make the recipe a third party to
that agreement, free to disagree with both.

`--version` is the SAME string the linux build above carries, from the
same `ver` step. The Snap Store orders revisions by it, and a recipe
versioned differently from the binary it packages is two release lines
wearing one name.

⬜ NO .snap IS BUILT HERE, AND THAT IS NOW A CHOICE RATHER THAN A LIMIT.
⚠️ This said "snapcraft IS NOT INSTALLED — on this runner or on the
owner's box … packing a real .snap is the follow-up". As of 2026-08-09
submit-snap.yml installs it and packs one with `--destructive-mode`.
It is not done HERE because this job is the weekly six-platform proof,
and a snap no lane consumes would charge every run for it. What this
step proves is that the recipe is DERIVABLE from the tree.

### before step **The generated recipe is complete and still derived from the tree**

A GENERATOR THAT HAS STOPPED READING THE TREE STILL WRITES A FILE. It
writes a shorter one, or one carrying its own idea of the values, and
with no committed recipe to diff against and no snapcraft anywhere to
reject the result, nothing downstream could tell. So the file that was
just emitted is read back and graded: it parses, its `name` is the one
apps/*/store/linux-snap/snap-name.txt claims, it carries no absolute host
paths, `confinement` is `strict` (`classic` needs a manual store review
nobody has argued for), and `stage-packages` EQUALS the apt list the
"Linux build deps" step above installs — a retyped list, a list truncated
at the first line continuation, and a workflow that grew a package the
recipe did not are one failure: the snap builds and the app does not
start.

### before step **Prepare the Android upload key**

── the Android UPLOAD KEY ───────────────────────────────────────────────
🔴 THIS STEP IS THE FIX FOR THE DEFECT THAT WOULD HAVE FAILED THE FIRST
PLAY SUBMISSION. apps/subscriptiontracker/android/app/build.gradle.kts has read a real
keystore from `android/key.properties` or from four environment variables
for weeks, falling back to the debug signing config when none is supplied.
NOTHING IN CI SUPPLIED THEM — the comment that used to sit here said so in
its last sentence — so every .aab this workflow has ever produced was
DEBUG-SIGNED, which Google Play rejects. Every check stayed green because
every check was reading the configuration, and the configuration was right.

⚠️ THERE IS NO "this is a release" FLAG HERE, ON PURPOSE. The script
DERIVES it from `GITHUB_REF` (a tag push) and from the submission workflow
tooling/channel-register.json declares — because a hand-written flag in a
workflow is precisely the kind of switch this whole change exists to stop
relying on. Deleting a YAML line must not be able to turn a release lane
back into a build proof.

For THIS workflow the answer is: a `push: tags: <app>-v*` run requires
signing, and the weekly/dispatch runs do not. That scoping is deliberate
rather than cautious — those runs produce the six-platform proof that
assert-platform-proof-fresh.mjs feeds back into ci-gate, and it FAILS the
gate once the proof is 14 days old, so demanding secrets there would let
one missing secret take out every merge in the repository.

The step exports the four variables Gradle reads (plus the posture the
signature check below compares against) into $GITHUB_ENV, so both build
steps and tooling/release/submit-play.mjs all see one complete, consistent
set. The keystore itself is written to $RUNNER_TEMP — outside the
workspace, where none of the `upload-artifact` paths in this file can
reach it, which matters more here than usual because this repo is PUBLIC
and its artifacts are downloadable.

### before step **Build android (apk — sideloadable build proof)**

The APK is built from the same `release` buildType and therefore carries
the same signature as the bundle. It is NOT checked below — see the note
on the signature step: this repo's checker reads JAR (v1) signatures, and
an .apk can legitimately carry a v2/v3-only block instead.

⚠️ THE .apk IS NOT THE PLAY ARTIFACT AND IS KEPT ANYWAY. An .aab is a
publishing format — Google re-splits it per device and you cannot install
one on a handset. The .apk is the only artifact a human can sideload to
look at the build, and Android cannot be built on the owner's box at all
(CLAUDE.md: java.nio Selector.open() is broken Windows-socket-wide), so
this upload is the ONLY way an Android build gets touched today.
── 🔴 THE BACKEND DEFINES ARE NOT OPTIONAL ON A STORE LANE ──────────────
Found 2026-08-04 alongside the debug-signing defect and it is the same
failure wearing different clothes. `AppConfig.isBackendLive` is
`isSupabaseConfigured && isApiConfigured`, and both compare a dart-define
against a PLACEHOLDER constant (app_config.dart). Passing only
GLITCHTIP_DSN left all three at their placeholders, so the artifact
intended for Google Play resolved `MockAuthRepository()` and
`SeedApiClient()` — mock sign-in, seeded data, inert analytics. The .aab
was debug-signed AND a demo build; signing was half the reason that upload
would have been wrong.

Demo mode is the CORRECT default — it is what lets a stranger clone this
repo and see every screen with no backend — which is exactly why nothing
noticed. The secrets already existed; deploy-web.yml has passed all three
since it was written. tooling/ci/assert-store-build-config.mjs now derives
the required set from `isBackendLive` itself and grades every build step a
`kind: store` row declares, so a fourth requirement added to that getter
cannot silently escape any store lane.

✅ `--build-number` IS ON THE .apk NOW — 2026-09-23, lane `version-stamp`.
The note here used to read "NO `--build-number` ON THE .apk, ON PURPOSE",
because the .apk is never uploaded to Play. But the apps.gov.in .apk DOES
ship, and Android refuses to install an update whose versionCode is not
above the installed one, so a counter every shipped .apk lacks is an
update path that breaks on the second release. assert-app-versioning.mjs
now asks every release build in every workflow for the stamp, and an
Android target without a number fails. APP_VERSION still matches the
bundle character for character: both come from the same `ver` step and
the same run number.

### before step **Build android (aab — the Google Play artifact)**

── the android-play channel's artifact ─────────────────────────────────
THIS JOB IS THE `lane` OF tooling/channel-register.json's `android-play`
row, and this step is why. Before it, the register printed a FORMAT GAP
on every guard run — the row accepts ".aab" and the only Android artifact
the tree produced was a ".apk", so the green "Android builds" tick was a
proof about an artifact Google Play does not take.
developer.android.com/guide/app-bundle: "From August 2021, new apps are
required to publish with the Android App Bundle on Google Play."

The register recorded that contradiction IN PROSE from the day it was
written; it became something a build could fail on when [pipeline F-2]'s
hardening taught assert-channel-register.mjs to compare a row's
artifactFormats to what its lane emits, and it is closed here.

🔴 `--build-number` COSTS ONE LINE AND REMOVES THE ONLY IRREVERSIBLE
FAILURE IN STAGE 9. Play reads it as `versionCode`. A versionCode must
strictly increase and CAN NEVER BE REUSED — so the first .aab uploaded
under the pubspec default of `+1` burns `1` forever, and the second
upload is rejected with nothing in the app to explain it. Passing
`github.run_number` here while nothing ships is free; retrofitting it
after the first upload is not possible at all.

⚠️ `github.run_number` COUNTS RUNS OF THIS WORKFLOW FILE. Rename or
replace build-platforms.yml and the counter restarts at 1, below a code
Play has already consumed. If this file is ever renamed, the number has
to be offset past the old file's high-water mark in the same commit.
Recorded in tooling/ci/assert-app-versioning.mjs beside MAX_RUN_DIGITS.

✅ `--build-name` IS HERE NOW — [9]R-2, closed 2026-08-08. This note used
to read "⬜ NO `--build-name` HERE, deliberately", and its reasoning was
right for the tree it was written against: `--build-name` is the number
version_gate.dart compares, a literal would be a second copy of pubspec's
version free to drift from it, and this workflow had no release-line step
to derive one from. It has one now — `ver`, above — so the value is
DERIVED by the same script and the same parser that assert it, and the
objection the note recorded does not apply to a derived value.

The version core here is the same string as APP_VERSION's, on purpose:
the number Play shows and the number the kill-switch compares must be one
number. `--build-number` is UNCHANGED and must stay that way — see the
versionCode note above.

### before step **The .aab must be signed by the upload key, not the debug key**

── READ THE SIGNATURE OUT OF THE BUNDLE, not out of the config ──────────
The step above says what was ARRANGED. This one says what HAPPENED, and
the whole reason the debug-signing defect survived is that nothing in the
tree asked the second question: submit-play.mjs, the channel register and
the Gradle header all described a correct configuration while every built
artifact was debug-signed.

It fails when the signer is the Android debug key, when the bundle is
unsigned, when the certificate is not the fingerprint pinned in
tooling/channel-register.json, or when the real signature disagrees with
the posture the step above exported — that last one is what catches Gradle
silently not using secrets that were supplied.

⚠️ THE .aab AND NOT THE .apk. An app bundle always carries a JAR (v1)
signature, which is what `keytool -printcert -jarfile` reads. An .apk may
carry a v2/v3-only APK Signing Block and no v1 block at all, which this
checker would report as UNSIGNED — a false red on a correct artifact.
Reading v2 needs `apksigner`; that branch is deliberately unwritten rather
than written and never exercised.

### before step **Every artifact this lane claims exists, and is not empty**

── 🔴 THE UPLOAD BELOW CANNOT TELL YOU WHAT IT IS CARRYING ─────────────
`if-no-files-found: error` fails the step when the WHOLE `path:` set
matches nothing. The set below is a union of two globs and a DIRECTORY,
so the directory alone satisfies it: the .aab could be absent, the .apk
could be absent, both could be zero bytes, and the upload is green, the
job is green, and the artifact downloads with a hole in it. Every guard
in this repository that reads this file reads its TEXT — and the text
still names all three paths, which is exactly why none of them caught it.

This step asserts each path ON ITS OWN, on the runner, against the disk,
AFTER the builds and BEFORE the upload — the only position where the
answer is a fact rather than a promise. The extensions it expects are
derived from tooling/channel-register.json through the same
`installableExtensions()` the release lane stages with, so a channel that
gains a format gains an assertion here or the guard reports COVERAGE LOST.

### before step **Every native library is aligned for a 16 KB memory page**

── THE PLAY STORE GATE FOR THIS ENVIRONMENT ────────────────────────────
🔴 IT RUNS HERE AND NOWHERE ELSE, BECAUSE ONLY HERE DOES THE SUBJECT
EXIST. `ci.yml` never builds Android, so this guard in that workflow
could only ever report COVERAGE LOST. This is what "one job per
environment, each carrying its own store gates on top of the shared
ones" means in practice: the shared gates ran at `gate`, and the gates
that need a built artifact run in the lane that built it.

It reads the ELF program headers of every 64-bit `.so` inside the bundle
and refuses a LOAD segment under 16 KB. Nothing in this repository had
ever opened a `.so`, and the alignment is set by the NDK and by linker
flags Flutter passes — there is no line in this tree to review, which is
why a toolchain move can change it with no diff. Placed AFTER the shape
check, so a missing or empty .aab is reported as a missing .aab rather
than as an unreadable archive.

### before step **The built .apk passes the static apps.gov.in VAPT items**

§vapt — ADDED 2026-09-14, register row O-APPS-GOV-IN-VAPT-CHECKLIST.
apps.gov.in runs a real VAPT (MobSF, Frida, Jadx, Burp, apktool) against a
17-item static and 3-item dynamic checklist, and only High findings block.
Six static items are properties of the build: debuggable, allowBackup,
usesCleartextTraffic, credential-shaped values in the manifest, exported
components with no permission, and logging. The guard decodes the binary
AndroidManifest.xml inside the built .apk — the MERGED manifest, with every
plugin's and AndroidX library's components in it, which exists nowhere else
— and checks logging where it is decided (the inherited analyzer config and
the app's own Kotlin/Java).

⏱ 2026-09-23, row O-VAPT-V5-FOREIGN-PERMISSION: V5 also judges WHICH
permission guards an exported component. It counts only if no stranger can
hold it: an `android.permission.*`, or one the same merged manifest declares
at protectionLevel signature or signatureOrSystem (`level & 0xf` is 2 or 3).
Any other is FOREIGN and fails, because any app installed first can declare
it, hold it, and reach the component; MobSF prints that as "protected by a
permission which is not defined in the analysed application". The rule reads
the component's own `android:permission`, the `<application>` fallback, and a
provider's read and write permissions each, and an unreadable protectionLevel
fails closed. There is no list of vendor permissions to exempt. The first
instance measured was the Amazon IAP receiver that purchases_flutter merges
in; the app manifest removes it with `tools:node="remove"`, and
`android-vapt-manifest.test.mjs` C1 goes red if an Amazon purchase rail is
ever declared beside that removal.

It reads the .apk rather than the .aab because an .aab carries a protobuf
manifest, not AXML; both come from the same manifest merge in this job.

MEASURED BEFORE IT LANDED: `aapt2 link` (build-tools 36.0.0) over the app's
own source manifest produced an .apk the guard failed on V2 — allowBackup
ABSENT, which Android reads as true. The manifest now sets it false. A
stamped app whose android/ tree comes from stock `flutter create` has the
same gap, and this step is where it will show.

The VAPT report the store returns is not in this repository yet; when it
arrives it is transcribed into the runbook as the checklist this guard
tracks, and any item it raises that is statically decidable joins the guard.

### in step **Every native library is aligned for a 16 KB memory page**, above `- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4`

🔴 THE POSTURE IS IN THE ARTIFACT NAME, and that is the "labelled, not
indistinguishable" half of the fix. A downloaded `subscriptiontracker-linux-web-android`
said nothing about whether its .aab could be uploaded anywhere; a
`…-debug-signed-build-proof` cannot be mistaken for a release by anyone
reading the run's artifact list.

THE APP PREFIX IS NOT COSMETIC EITHER. `upload-artifact@v4` rejects a
second upload under a name that already exists in the run, so a matrix
over two apps with a fixed artifact name is not "two artifacts, confusing
names" — it is a HARD FAILURE on the second leg. Parameterising the name
is what makes the matrix run at all.

## job `windows`

### before step **Derive the release line from pubspec**

── [9]R-2 · the same derivation as the Android lane, same script ────────
⚠️ `shell: bash` ON THIS STEP AND ONLY THIS STEP. This runner's default
shell is pwsh, and `>> "$GITHUB_OUTPUT"` is bash syntax — in PowerShell
`$GITHUB_OUTPUT` is an unset variable, so the redirect writes the emitted
lines to a file called nothing and `steps.ver.outputs.release_line`
resolves to the empty string. The build would then take `--build-name=
.<run>`, which is a version with no release line and NO ERROR ANYWHERE.

The step runs `node` and nothing else. `node` is a real .exe on PATH, so
Git Bash resolves it exactly as pwsh does — no flutter, no Gradle, no
msix, nothing whose Windows path handling is worth arguing about. The
build steps below stay on the default shell for the same reason.

### before step **Build windows**

── the windows-direct channel's CODE-SIGNING CERTIFICATE ───────────────
The Windows half of the pair `android-signing.mjs` forms for Play, wired
in exactly the same shape: a step that ARRANGES the credential, exports a
POSTURE, and leaves reading the signature back out of the binary to a
separate check. The `windows-direct` row of
tooling/channel-register.json has declared WINDOWS_CODESIGN_PFX_BASE64
and WINDOWS_CODESIGN_PFX_PASSWORD since PR #202 with no consumer anywhere
in the tree — the same silence that let every .aab this factory produced
be debug-signed for weeks while every configuration check stayed green.

⚠️ IT ARMS THE DIRECT-DOWNLOAD CHANNEL, NOT THE STORE ONE, and the two
must not be conflated. `windows-store` is `keyKind: "none"` — Microsoft
re-signs what it accepts, `msix_config` sets `store: true`, and the .msix
packaged below is deliberately unsigned. What Microsoft Store Policies
§10.2.9 needs a trusted-root certificate for is the DIRECT download, and
that is the row this step reads.

⬜ NO CERTIFICATE HAS BEEN PURCHASED (the row's pin is a sentinel that
cannot be mistaken for a thumbprint), so every run today exports
`unsigned-build-proof` and PRINTS the gap in capitals. Wiring it before
the purchase is the point: the day the .pfx arrives it flows through a
path that already exists and has already been reviewed, instead of being
written in the same commit as the first release.

Key material goes to $RUNNER_TEMP for the reason recorded on the Android
key step in the job above — this repo is PUBLIC and its artifacts are
downloadable by anyone.
[pipeline 11]E-7, and this job is the lane of the `windows-store` row.
⚠️ WINDOWS GETS THE DART LAYER ONLY. sentry_flutter's Windows support is
the Dart error handler; a native crash in the C++ runner or in a plugin's
native half is NOT captured, so "Windows crashes reach GlitchTip" is true
of Dart exceptions and false of access violations. Written here and in
tooling/channel-register.json so nobody reads the six green ticks as six
covered platforms. Same fork-PR and release-attribution caveats as the
linux_web_android job above.
`--build-number` for the same reason as the .aab lane below-left: the
MSIX packaged from this build carries the version, and the Microsoft
Store rejects a submission whose version is not higher than the last
accepted one. `dart run msix:create` reads what `flutter build` produced,
so the number has to arrive here rather than at packaging time.

✅ `--build-name` IS HERE NOW — [9]R-2, closed 2026-08-08. The note that
used to sit on this line said "No `--build-name` — see the note on the
appbundle step for why a literal would be a second copy of pubspec's
version", and that was correct while the only option was a literal. The
`ver` step above derives it from pubspec with the guard's own parser, so
the Store version and the version version_gate.dart compares are the same
string arrived at the same way.

The backend defines, for the reason recorded on the android apk step
above: this job is the `windows-store` row's declared LANE, the .msix
below is packaged from exactly these binaries, and without them the
package Microsoft would receive is the demo build.

### before step **Package MSIX (Microsoft Store)**

── the windows-store channel's artifact ────────────────────────────────
THIS JOB IS THE `lane` OF tooling/channel-register.json's `windows-store`
row, and this step is why. Before it, the register printed a FORMAT GAP
on every guard run — the row accepts ".msix" and the only Windows artifact
the tree produced was a ".exe" bundle directory, so the green "Windows
builds" tick was a proof about an artifact the Microsoft Store does not
take. Same shape as the .apk/.aab gap recorded one row up for Play.

`msix_config` in apps/subscriptiontracker/pubspec.yaml sets `store: true`, so this
produces an UNSIGNED store package: the register's keyKind for this row is
"none" because the Store re-signs. Nothing here holds a certificate and
nothing here needs one — which is what makes this the cheapest real store
channel we have.

⬜ THE ONE THING THE MATRIX CANNOT CARRY, recorded rather than forced.
`msix_config` lives in each app's OWN pubspec — identity_name, publisher,
and `output_name`, which is what the produced file is called. There is no
workflow-level expression that can name it, because the fact is not in
this file and not in the matrix; it is in the app. So the upload below
globs `*.msix` under the app's msix output_path instead of naming
`subscriptiontracker.msix`. That is generic AND honest: `if-no-files-found: error`
still fails the leg if an app's msix_config produced nothing. What stays
app-specific is the CONTENT of msix_config, and `assert-store-metadata.mjs`
already compares the identity a channel row declares against what each
apps/*/pubspec.yaml packages with — the right place for it.

⬜ The package identity is still `PARTNER-CENTER-PENDING` (OWNER_QUEUE
A-2). The .msix therefore BUILDS and is NOT SUBMITTABLE; that is the
point of building it anyway — the packaging path is proven before the
account exists, so registration day is minutes rather than archaeology.
`build_windows: false` keeps msix from rebuilding: this packages the
exact binaries the step above produced and the upload below proves.

⏱ 2026-09-22 — the paragraph above is superseded for subscriptiontracker.
The account is verified and the register row and the pubspec carry the
real Partner Center identity (identityName
`60210NIKATRU.NikatruSubscriptionTracker`), so the .msix this leg builds is
now the identity a submission would use. `assert-artifact-signed-msix.mjs`
compares the packaged manifest to those values exactly as it compared the
sentinel. Still NOT submitted: the row is `served: false`, and a submission
is the owner's word.

### before step **Keep the .msix even if what follows refuses it**

── WHAT msix:create ACTUALLY WROTE ────────────────────────────
🔴 TWO GUARDS ALREADY COMPARE THIS IDENTITY AND NEITHER HAS EVER OPENED
THE PACKAGE. assert-store-metadata.mjs compares channel-register.json's
`packageIdentity` against the pubspec's `msix_config` — declaration
against declaration. Between that and the shipped bytes sits the step
above, and nothing has ever asked what it wrote.

Partner Center binds the identity to the PRODUCT, not to the upload, so
a package built under the wrong one submits cleanly and is
UNRECOVERABLE once published. It also asserts the package carries NO
AppxSignature.p7x, which is the positive evidence that `store: true`
took effect — `store: false` silently re-introduces a test certificate
nobody owns.
🔴 UPLOAD THE PACKAGE BEFORE ANYTHING JUDGES IT, AND UPLOAD IT EVEN WHEN
THE JUDGEMENT FAILS. The artifact upload at the end of this job carries
no `if:`, so it defaults to `success()` — meaning on 2026-08-25, three
consecutive runs failed at the guard below and NOT ONE of them left the
.msix anywhere a human could fetch it. The bytes that would explain the
failure are destroyed by the failure. Two of those runs were spent
inferring the package's shape from a stack trace because of it.

`if: always()` rather than `success()`, and a SEPARATE upload from the
one at the end of the job, so this cannot be broken by someone changing
what that one collects. `if-no-files-found: warn` is deliberate HERE and
would be wrong there: if `msix:create` produced nothing, the step above
already failed and this upload has nothing to add — turning that into a
second red would report one defect twice.

### before step **Prepare the Windows code-signing certificate, and read the signature back**

── THE CERTIFICATE, AND THE READ-BACK IT EXISTS FOR ────────────────
🔴 THIS STEP RAN BEFORE `Build windows` UNTIL 2026-08-20, AND WAS NEVER
GIVEN `--artifact`. Both halves of that were defects and the second is
the one that mattered: with no `--artifact`, windows-signing.mjs:804
falls back to a SAMPLE path, prints the `signtool sign` and `signtool
verify /pa` commands it WOULD run, and reports at :829
`READ-BACK NOT PERFORMED`. The lane has therefore never read a signature
out of a real Windows binary — it printed a plausible command about a
file it never opened, on every run, in green.

It now runs AFTER the build and the packaging, where the binaries exist.
Verified safe to move rather than assumed:
  · NOTHING consumes `WINDOWS_SIGNING_POSTURE` — no workflow, no guard.
    (Its Apple counterpart IS consumed, by assert-artifact-signed-apple,
    which is why that one must stay ahead of its builds.)
  · NOTHING consumes `WINDOWS_CODESIGN_PFX_PATH` between the old and new
    positions.
  · `msix:create` SKIPS SIGNING ENTIRELY in this repo — the Store
    re-signs, so apps/*/pubspec.yaml holds no certificate and needs none.
    Had it signed, moving the cert materialisation after it would have
    produced an unsigned package with every check still green.

⚠️ `shell: bash` IS LOAD-BEARING, for the reason written out on the
`Derive the release line` step above: this job's default shell is pwsh,
which does not expand a wildcard into a native executable's arguments.
Under pwsh `node … --artifact 'Release/*.exe'` hands node the literal
string, and windows-signing.mjs does not glob — `optAll('artifact')`
takes argv values as paths. The read-back would then fail to find a file
whose name contains an asterisk, which reads as a missing artifact
rather than as a shell that never expanded. It runs `node` and nothing
else, so bash is safe here on the same grounds as that step.

### before step **Every artifact this lane claims exists, and is not empty**

── 🔴 THIS IS THE LANE THE UNION TRAP WAS FOUND ON ─────────────────────
The upload below sets `if-no-files-found: error` and it does NOT do what
that name suggests on a multi-path set: it fails only when the WHOLE set
matches nothing. `…/runner/Release` is a directory and `flutter build
windows` has already made it, so the .msix glob matching NOTHING is
accepted — silently, on the only Microsoft Store package this factory
produces, on the lane the `windows-store` row points at. `msix:create`
writing no file, `output_path` moving in an app's pubspec, or the whole
step being deleted all land in exactly the same green.

This step asks the disk instead, before the upload, and names the path
that is missing. Its recorded failing case is that exact tree: Release/
populated, .msix deleted (tooling/ci/test/artifact-shape.test.mjs).

## job `apple`

### before step **Toolchain under test**

KEPT, not temporary. `tooling/versions.json` pins the runner LABEL, the
Flutter version and — since the `xcode` key landed — an Xcode floor of
"26". A label names an image FAMILY, not an immutable image, so the image
can move its default Xcode without this repo noticing. When the macOS
build breaks, the first question is "what toolchain was this?", and
without these three lines the answer is unrecoverable after the fact.
It cost one CI cycle to learn that on 2026-07-31; it costs 2 seconds here.

🔴 THIS COMMENT SAID "NOTHING pins Xcode" UNTIL 2026-08-20, AND THE PIN
HAD ALREADY LANDED. Worse, the pin is still not ENFORCED: nothing
compares the runner's actual Xcode to versions.json's, and
submit-appstore.mjs decides whether to warn about it with
`hasOwnProperty('xcode')` — the KEY'S PRESENCE, nothing more. Adding the
key silenced the warning and left the risk it described exactly where it
was. `xcodebuild -version` below PRINTS the answer and asserts nothing.
A guard that compares them is the next change.

### before step **The Xcode floor is met, not just declared**

── AND THE FLOOR IS ASSERTED, NOT MERELY PRINTED ──────────────────
The step above PRINTS the toolchain and asserts nothing about it, which
is exactly right for a forensic record and useless as a gate. This
compares what `xcodebuild` just reported against versions.json's `xcode`
floor. Absent xcodebuild is COVERAGE LOST, never a pass — which is why
this is here, on the macOS runner, and deliberately NOT in ci.yml.

### before step **Patch the SDK for flutter/flutter#188060 (macOS AOT abort)**

⚠️ If this ever aborts with `AOT snapshotter exited with code -6` again,
add --verbose BEFORE diagnosing anything: gen_snapshot's stderr is not in
the step log and not in `gh run view --log-failed`. That flag is the only
thing that turns "exit -6" into an actual error message.
See $flutter_comment in tooling/versions.json for the 3.44.9 case.

The patch step is the flutter/flutter#188060 workaround: gen_snapshot
SIGABRTs because the tree shaker drops _window_macos.dart's private FFI
structs while instances survive in the snapshot. @pragma('vm:entry-point')
on those five classes keeps them. PROVEN on probe run 30645902458 — the
first fully green 6-platform run since 2026-07-26, ConsentGate intact.
The script fails LOUDLY if the SDK layout moves; drop it when upstream
fixes #188060.

### before step **Prepare the Apple distribution identity**

── the APPLE DISTRIBUTION IDENTITY, arranged before anything is built ───
The macOS/iOS half of the pair `android-signing.mjs` forms for Play.
PR #202 declared four Apple secrets on the `ios-appstore` and
`macos-appstore` rows of tooling/channel-register.json; a tree-wide grep
for APPLE_DIST_CERT_P12_BASE64 on 2026-08-08 returned THE REGISTER AND
NOTHING ELSE. That is the Android state of 2026-08-04 exactly, and the
Apple version of the silence is worse in one respect: the iOS build below
passes `--no-codesign`, so this lane's UNSIGNED-ness is real and correct
today, and the day somebody removes that flag there would be nothing
anywhere to notice the secrets were never wired.

All four supplied → a per-run keychain, the decoded provisioning
profiles and an ExportOptions.plist, posture `release-signed`. None
supplied → posture `unsigned-build-proof` with the gap PRINTED in
capitals and named (the Apple distribution certificate; the ACCOUNT is
active, OWNER_QUEUE A-4 closed 2026-08-31, and holds no certificate). SOME
supplied → FAIL, on every lane: three of four is an artifact nobody can
explain, and Apple's version of "correctly signed but wrong identity" is
rejected at upload, after the account is spent.

⚠️ THERE IS NO "this is a release" FLAG HERE, ON PURPOSE. The script
derives that from GITHUB_REF and from the submission workflow the
register declares, for the reason recorded on the Android key step:
deleting a YAML line must not be able to turn a release lane back into a
build proof.

### before step **The macOS bundle is signed by the identity this lane intended**

── READ THE SIGNATURE OUT OF THE BUNDLE, not out of the config ──────────
The step above says what was ARRANGED. This one says what HAPPENED, and
the Android pair is two files for exactly this reason: a step that
arranges a credential and then reports its own success is the "green
means ran" failure with extra stages. `codesign -dvv` is run against the
.app that was just produced and the verdict is the PARSED output, never
the exit status — the Android guard shipped after discovering `keytool`
exits 0 on an unsigned archive.

It fails when the posture says `release-signed` and the bundle is
unsigned or AD-HOC (a real, locally-valid signature with no identity and
no team behind it — the Apple equivalent of the Android debug key, and
the reason a check that merely asked "is it signed" would have passed the
defect), when the leaf is a development or Developer-ID certificate
rather than a distribution one, when the team is not the one the register
pins, and — in the other direction — when an identity reached an
`unsigned-build-proof` build through a path this lane never arranged.

⚠️ THE .app AND NOT AN .ipa. `flutter build ios --no-codesign` below
produces no .ipa at all, and `codesign` could not read one anyway: it is
a ZIP, and pointing this guard at one would report UNSIGNED for a
correctly signed app. Such a path is REFUSED BY NAME rather than read as
unsigned — "the tool cannot read this" and "this file is not signed" must
never share an exit code. The iOS half of this lane closes when something
produces an artifact, not when somebody edits this line away.

### before step **Build ios (no codesign)**

--no-codesign: this proves the code COMPILES for iOS without needing an
Apple Developer account or provisioning profile. Signing is a separate,
owner-gated step and must not block build verification.

### before step **The iOS bundle is signed by the identity this lane intended**

── READ THE SIGNATURE OUT OF THE iOS BUNDLE TOO ───────────────────
The macOS half above has had this since it existed; the iOS half could
not, because nothing it could read outlived the job. It does now.

⚠️ A .app, NEVER AN .ipa. `UNREADABLE_SUFFIXES` in that guard is
['.ipa','.pkg','.zip','.dmg'] — an .ipa is a ZIP, and `codesign` pointed
at one reports UNSIGNED for a correctly signed app. The guard REFUSES
such a path BY NAME rather than reading it as unsigned, because "the
tool cannot read this" and "this is not signed" must never share an exit
code. A `.app` is readable, which is why this step is possible at all.

WHAT IT ASSERTS TODAY, under posture `unsigned-build-proof`: that the
bundle is unsigned, LOUDLY and on purpose — and, in the other direction,
that NO identity reached this build through a path the lane never
arranged (a leftover keychain, an inherited environment). That second
direction is the whole value of running it before an Apple account
exists: an artifact nobody can attribute is the thing that must never
reach a store, and it is exactly what an unwatched lane accumulates.
When the four Apple secrets land, the posture flips to `release-signed`
and the same step starts demanding a distribution identity and the
pinned team — no edit here.

### before step **Every artifact this lane claims exists, and is not empty**

── the same question, asked of the macOS bundle ──────────────────────
The macOS upload's `path:` is a SINGLE directory, so `if-no-files-found:
error` is not being fooled by a union there — but a `Release/` holding a
.plist and no .app satisfies it just as happily, and a macOS .app is a
DIRECTORY whose size on disk says nothing about whether it can launch.
The guard checks that a `*.app` bundle exists and has contents.

⬜ IT ASSERTS NOTHING ABOUT iOS, and the guard PRINTS that gap on every
run of this lane rather than passing over it. `flutter build ios
--no-codesign` produces an unsigned .app and no `.ipa`; the
`ios-appstore` row accepts ".ipa" and has no lane at all.

🔴 THE REASON FOR THAT GAP CHANGED TODAY (2026-08-20) and the sentence
that used to sit here — "and no step uploads it" — is gone with it. Until
this commit an assertion over the iOS bundle would have ranged over an
artifact that did not outlive the job: it could never fail, and a check
that cannot fail adds apparent coverage and no coverage. The step below
now retains that bundle for 90 days, so there IS something to look at.
What is missing is the assertion, and that is the next change. The gap
closes when somebody writes it — not when somebody edits the line away.

### in step **Every artifact this lane claims exists, and is not empty**, above `- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4`

── THE iOS BUNDLE, RETAINED — the artifact this lane has never had ─────
`flutter build ios --release --no-codesign` above writes
build/ios/iphoneos/*.app and, until this step, NOTHING UPLOADED IT. The
runner is ephemeral, so the bundle's retention was zero seconds: it was
compiled, proven to compile, and destroyed. 33 guards in this repository
name ios or macos and not one of them could ever see an iOS artifact,
because none existed for longer than the job.

🔴 THIS IS THE UNBLOCKER, NOT THE FEATURE. Six of the nine stages the
ios-appstore channel is measured on — SIGN, VERIFY-SIGNATURE, the shape
assertion, PACKAGE, SUBMIT, RELEASE — cannot be worked on at all while
the thing they operate on does not outlive the job. Every one of them is
reachable from here; none was before.

THE POSTURE IS IN THE NAME, for the reason recorded on the Android
upload above: `subscriptiontracker-ios-unsigned-build-proof` cannot be mistaken for a
submittable build by anyone reading the run's artifact list, and today
it is exactly what it says — apple-signing.mjs exports
`unsigned-build-proof` when the four Apple secrets are absent, which
they are. The app prefix is not cosmetic either: upload-artifact@v4
rejects a second upload under a name already used in the run, so a
matrix over two apps with a fixed name is a hard failure on the second
leg, not a naming inconvenience.

⚠️ AN UNSIGNED .app IS NOT AN .ipa AND MUST NEVER BE READ AS ONE. The
ios-appstore row accepts `.ipa` and its artifactGlob names
build/ios/ipa/*.ipa, which this does not produce and does not claim to.
What is retained here is a BUILD PROOF. It becomes a release candidate
when a distribution certificate is issued and something signs and packages it -
the Apple account already exists and is active — not
when somebody widens this path.

## job `all_platforms`

### above `needs: [gate, prepare, linux_web_android, windows, apple, release]`

`release` is in this list for the same reason every other job is:
assert-channel-register.mjs asserts the aggregator `needs` EVERY other job
in the file, so a durable-release job outside it could fail while "All 6
platforms built" still printed. It is also why `release` carries NO
job-level `if:` — a conditional job resolves to `skipped`, and this
aggregator (correctly) treats `skipped` as not-green. The tag-only part of
that job is therefore a STEP-level condition, which leaves the job itself
running on every trigger and its result meaningful. [pipeline R-5, 9]R-4

### before step **Require every platform green**

A matrix job's `result` is the ROLL-UP of every leg: one red leg makes
the whole `needs.linux_web_android.result` a failure, so "all 6 platforms
built" keeps meaning all six FOR EVERY APP without this step learning
what a matrix is. `prepare` is in `needs` for the same reason the others
are — assert-channel-register.mjs asserts the aggregator covers every
other job in the file, and a `prepare` that failed to emit an app set is
precisely the run that must not print success.

## job `release`

### above `release:`

── THE DURABLE HALF — [pipeline 9]R-4 ──────────────────────────────────────
"A release artifact outlives the run that made it. Every artifact intended
for a user is published to a durable, addressable location with an integrity
record, not left as a workflow-scoped artifact."

🔴 WHAT THIS JOB REPLACES, MEASURED 2026-08-06 BEFORE IT EXISTED: `git tag`
returned 0, `git ls-remote --tags origin` returned 0, no `gh release create`
appeared anywhere in the repository, and FIVE jobs ended at
`actions/upload-artifact` with `retention-days: 7`. A release artifact
outlived its run by SEVEN DAYS, which is the requirement's negation rather
than a weak form of it.

THE MECHANISM IS THREE THINGS, because the acceptance names three properties
and no single artefact carries all three:
  · DURABLE      — a GitHub Release. Not a preference: Private/requirements/
                   zero-cost-stack.md:46-47 is LOCKED ("GitHub Releases =
                   artifact origin for every installer/APK"). A release asset
                   has no retention clock; an upload-artifact has a 7-day one.
  · ADDRESSABLE  — the git TAG this workflow ALREADY triggers on
                   (`push: tags:`, above). One trigger now does two
                   jobs: it demands the six-platform proof AND names the
                   release. Nothing app-specific is hand-written — the tag
                   list is one `<app>-v*` line per app, GENERATED from the
                   product registers by tooling/ci/tag-owner.mjs --write
                   (since 2026-09-22; before it was `*-v*`, which also
                   caught every extension tag), and nothing below names an app.
  · INTEGRITY    — SHA256SUMS, written and re-verified by
                   tooling/ci/release-manifest.mjs, carrying the GATED
                   COMMIT SHA in its own header. `sha256sum -c` skips
                   `#`-prefixed lines (verified on GNU coreutils 8.32), so
                   the provenance rides inside the file a downloader already
                   knows how to check.

⚠️ THE JOB RUNS ON EVERY TRIGGER; ONLY THE PUBLISH IS TAG-ONLY. Two reasons,
and the first is not stylistic:
  · a job-level `if:` resolves to `skipped`, and `all_platforms` above
    (correctly) fails on `skipped` — a conditional job here would turn every
    weekly cron and every dispatch red.
  · staging, checksumming and RE-VERIFYING on every run is what stops this
    lane's first exercise being release day. The half that can fail today
    fails today; only `gh release create` waits for a tag.

⬜ UNPROVEN UNTIL SOMETHING IS PUBLISHED, stated rather than implied: no tag
has ever been pushed and no release has ever been created, so the `gh release
create` step and the deployment records below have NEVER RUN. What IS proven
is everything up to them — staging, the manifest and `--verify` — which is
exactly the part a dry run can prove. Creating a real release is a public,
outward-facing act and belongs to the owner.

### above `timeout-minutes: 20`

Only the staging + manifest half has ever run (max 1m41s). Everything from
`gh release create` down is tag-only and has NEVER executed — see the ⬜ in
the header — so 20 is headroom for an unmeasured publish, not an estimate.

## job `needs`

### above `needs:`

Block form deliberately. tooling/ci/assert-platform-proof-fresh.mjs reads
the aggregator's dependencies with a WHOLE-FILE `needs:\s*\[([^\]]+)\]` —
the first FLOW-form list in the file — so a second flow list here would be
read as the aggregator's and report the platform jobs unwired. Same trap
the `prepare` note above records; block form sidesteps it, and this job
sitting AFTER `all_platforms` is the belt to that braces.

## job `release`

### above `contents: write`

The three scopes this lane needs, at JOB level so no other job in the
file holds them. [pipeline F-11]
  contents    — create the release and upload its assets
  deployments — write the [10]D-9 record at the end of this job
  actions     — download this run's own artifacts

⚠️ NAMED IN FULL-LINE COMMENTS, NOT TRAILING ONES. deployment-record.test.mjs
scans every workflow for `record-deployment.mjs <environment>` and strips
only comments that START a line, while its `\s+` crosses newlines — so an
inline `deployments: write # …record-deployment.mjs` made it read the NEXT
key as an environment name and fail with `environment: 'actions'`. Found
2026-08-06 by running that suite; recorded here because the trap is
invisible at the call site and the failure names a key nobody wrote.

### above `- uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0`

This run's own artifacts, by the per-app names the build jobs uploaded
under. `pattern` keeps a matrix leg to its own app: with two apps in the
workspace, leg #1 must not publish app #2's binaries under app #1's tag.

### before step **Stage the installers and archive the rest**

── assemble ────────────────────────────────────────────────────────────
`--stage` MOVES every installable file (extensions derived from
tooling/channel-register.json, never typed) out of the download tree into
`dist/`, under a name that survives a year in a downloads folder. What
REMAINS is then archived whole, one .tar.gz per platform artifact —
desktop bundles, the web build, anything else the run produced — so
"outlives the run" covers the artifact SET rather than just the
installers. Moving first is what stops the .apk existing twice.

⏱ 2026-09-24 — `--stage` now COLLECTS every installer, JUDGES them, and
only then moves any. On a release tag it refuses, and moves nothing, when
a native installer serves a channel row whose `nativeAuth` is not true in
tooling/channel-register.json: that build cannot complete email sign-in,
sign-up and recovery against the backend its release points at
(O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN). On the `<app>-untagged-<sha>`
value a non-tag run synthesises, the same finding prints as "would refuse"
and the run stages as before. A ref neither shape reads is judged as a
release. assert-channel-register.mjs is the register half: no native row
is `served` while its `nativeAuth` is false. The row stays open, and a row
flips to `nativeAuth: true` only on observed evidence of a native build
signing in.

Expressions go through `env:` rather than into the shell body: a ref name
is attacker-influenced text and `${{ }}` in a `run:` is substituted before
bash ever sees it. [zizmor template-injection]

### before step **Write the checksum manifest, naming the gated commit**

── the integrity record, and the proof it describes THIS directory ──────
`--write` then `--verify`, always in that order and always both. `--write`
alone would be a claim; `--verify` re-hashes every file and fails in BOTH
directions — a named file that is absent, and a file in dist/ the manifest
does not name. The second is the one the acceptance's wording turns on.

### before step **Re-verify every asset against the manifest**

`--expect-formats` is the COMPLETENESS half, and it is a DIFFERENT
question from the one above. `--verify` alone asks whether dist/ and
SHA256SUMS agree, so a dist missing a whole platform verifies clean —
measured 2026-08-27 on a fixture holding the .apk and .aab and no .msix:
plain `--verify` exits 0 printing `ok  2 asset(s) verified`.

🔴 `--for-workflow` IS NOT DECORATION HERE. Unnarrowed, the expected set
is derived from EVERY lane-bearing channel row and so includes `.snap`,
which `submit-snap.yml` emits and this workflow never does; measured
2026-08-27, that spelling exits 1 naming `.snap` even on a dist carrying
all three formats this lane produces. Narrowed to this file the set is
`.aab .apk .msix` — exactly the three the upload-artifact steps above
carry with `if-no-files-found: error`, on every run and not only on tags.

🔴 ON `--verify`, NEVER ON THE `--write` STEP ABOVE — `--verify` is the
only mode that reads these flags, so on `--write` they would run the
named mode and ask nothing. release-manifest.mjs refuses that spelling
outright today ("--expect-formats is read by --verify alone", exit 1,
measured 2026-08-27), so the misplacement is loud rather than silent —
but the placement is the reason it works, not that refusal.

### before step **Publish the GitHub Release (tag pushes only)**

── publish ─────────────────────────────────────────────────────────────
🔴 `gh release create` IS WRITTEN HERE, IN THE WORKFLOW, ON PURPOSE.
assert-release-provenance.mjs classifies a publish from the workflow TEXT
and then demands the publishing job be gated and record what shipped.
Moving this line into release-manifest.mjs would make a real publish
invisible to the guard that exists to hold it — a helper that disarms a
check is worse than no helper. The gate is satisfied through `needs: gate`
(walked transitively by that guard); the record is the step below.

The asset list comes from `--emit-assets`, which puts SHA256SUMS FIRST and
refuses an empty set, so a release cannot be created without the one file
that makes it verifiable.

### before step **The release must carry the assets this job just uploaded**

── the read-back — [14]O-7, IN THIS JOB, ON WHAT THIS JOB UPLOADED ─────
🔴 THE FINDING THAT PUT IT HERE, 2026-08-26. This job was INVISIBLE to
[14]O-7 until today. The shared workflow reader could not match a QUOTED
SHELL VARIABLE, so the ledger call at the end of this job matched nothing,
the job dropped out of that limb's domain in silence, and the census
printed "7 deploy job(s)" without it. Widening the reader made the job
appear — and it failed the rule immediately, because it published a
GitHub Release and read NOTHING back.

WHAT THE PROBE JOINS ON, and it is deliberately not "a release exists at
this tag": the GitHub API reports every release asset's `digest` as
`sha256:<hex>`, MEASURED 2026-08-26 to be exactly the sha256 of the bytes
the release serves — cli/cli v2.92.0's checksums asset read back through
the API and hashed with `sha256sum` agreed to the character. dist/SHA256SUMS
already carries that same number for every asset this run staged, so the
probe asserts THE RELEASE CARRIES THESE FILES WITH THESE HASHES, in both
directions. A release published last month answers "does a release exist"
exactly as well as one published ten seconds ago, which is why that is not
the question being asked.

⬜ NOT YET LOAD-BEARING, WHICH IS PRECISELY WHY IT IS BEING CLOSED NOW:
with a staged `dist`, `release-manifest.mjs --emit-environments` omits
`subscriptiontracker-windows-direct` while that channel's signing posture is SENTINEL, so
the loop in the step below iterates over nothing and no ledger row is
written today — the blind spot arms itself the day the code-signing pin is
filled in, and closing it then costs a release.

⚠️ IT RUNS BEFORE THE LEDGER STEP AND DOES NOT GUARD IT — the ordering
submit-play.yml:submit uses, for the same reason. A red here still fails
the job; a release that IS published must still be recorded as published.

### before step **Record what shipped, per channel this release is the origin for**

── record what shipped — [10]D-9, through the script that already does it ─
🔴 EXTENDED, NOT DUPLICATED. tooling/ci/record-deployment.mjs already
writes the [10]D-9 ledger entry and already resolves an environment
against the channel register; nothing about that was rewritten here. What
is new is the SET it is called over, and that set is DERIVED at run time:
every `kind: "direct"` row whose declared artifactFormats this release
actually carries. Today it resolves to `<app>-windows-direct` and nothing
else — store rows are excluded because a GitHub Release is a download
ORIGIN and not a store submission ([ADR 015] §4), and record-deployment
would rightly refuse a store row with no --state and no --listing-url.
⚠️ SCOPED TO THE `app` SURFACE, said out loud since 2026-09-06: the
emitter asks which surface `--app <id>` is on before it reads `kind`, so
the browser-store rows added for the extension surface can never reach
THIS loop (`--emit-environments dist --app subscriptiontracker` over a stray `.zip`
refuses, naming the surface). The extension lane in extensions.yml runs
its own loop, over rows that ARE `kind: "store"`, and records them with
`--state pending_manual_publish` — the release is their artifact's origin
and nothing was submitted. That is a different sentence from this one, not
a widening of it.
Nothing is hardcoded, so an AppImage lane joins this loop by being given a
register row, not by anybody editing this file.


## apps-gov-in — the no-checkout .apk for apps.gov.in (Mobile Seva)

*Added 2026-09-22 · register row O-APPS-GOV-IN-CHANNEL-APK · `tooling/channel-register.json`
`apps-gov-in`.* Every `§apps-gov-in` pointer in `build-platforms.yml` lands here.

### What the job builds, and where it goes

`linux_web_android` builds a FOURTH Android artifact, after the Play .apk and .aab: an .apk built
with `--dart-define=RELEASE_CHANNEL=apps-gov-in`. That channel's `purchaseRail` is `none`, and a
`none` rail sells nothing and opens no checkout
(`packages/purchases/test/chassis_billing_test.dart`, *"a `rail: none` channel is a rail that sells
nothing"*). The file is `<app>-apps-gov-in-<release_line>.<run_number>.apk`. It is uploaded as its
own artifact, retained 90 days, `if-no-files-found: error`. Its name starts `apps-gov-in-`, so the
release job's `<app>-*` download never matches it: a store-side build is never a public release
asset. The owner downloads it from the run page and uploads it to the portal by hand. Nothing in CI
uploads to apps.gov.in.

Its symbols are obfuscated like every other release build (`--split-debug-info=build/symbols/android-apk-apps-gov-in`).
They ride in the same `symbols-*` artifact as the Play ones, and GlitchTip gets them through the
same loop (lane `android-apk-apps-gov-in`).

### Why it has its own key, and how that key reaches only one step

The portal takes a SELF-SIGNED .apk. Its form asks for a key store only when the file is an AAB.
Nothing re-signs the upload, so whichever key signs it is the key that every install from that store
is bound to. On 2026-09-22 the owner decided that this key is its own, alias `nikatru-appsgovin`,
and never the Play upload key `nikatru-upload`. The register records that as `keyKind:
app-signing-key`.

The route, step by step:

1. **Prepare the apps.gov.in signing key.** `tooling/ci/android-signing.mjs` (the script the Play
   key already uses) runs with the four `APPSGOVIN_*` secrets mapped onto its input names. It gets
   its own `--out` directory (`$RUNNER_TEMP/apps-gov-in-key`) and a scratch `--github-env` file,
   which the step reads and then deletes. So it keeps every check it makes for Play: all four
   values or none, base64 that round-trips, and bytes that really are a keystore. What changes is
   that nothing it writes lands in `$GITHUB_ENV`.
   - Why that matters: the Play upload key is in `$GITHUB_ENV` for every later step, and the Play
     artifact's name reads `ANDROID_SIGNING_POSTURE` from there.
   - Only two values leave the step, as step outputs: the keystore path and the posture (`release`
     or `debug`).
   - `GITHUB_REF` and `GITHUB_WORKFLOW_REF` are dropped for this one call. They are how the script
     recognises a PLAY release lane (a tag push). If the apps.gov.in key is absent on a tag push,
     the result is the labelled build described below, not a failed release.
   - The script names the keystore file `<app>-upload.keystore` even here. That name is the
     script's own, and the file sits in its own directory, apart from the Play keystore.
2. **Set the Play .apk aside.** Flutter writes every .apk to one path, `flutter-apk/app-release.apk`.
3. **Build android (apk — apps.gov.in).** The four Gradle variables (`ANDROID_KEYSTORE_PATH`,
   `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) are set in this step's
   own `env:`, which beats `$GITHUB_ENV`. Blank values count as "not supplied" to
   `build.gradle.kts`, so when the secrets are absent this build gets the debug signer.
   `gradleContract.mapsOnto` in the register records this mapping, and `assert-channel-register.mjs`
   §9 compares it to the Gradle file.
4. **Take the apps.gov.in .apk out, and put the Play .apk back.** The apps.gov.in file moves to
   `apps/<app>/build/apps-gov-in/`, outside `flutter-apk/`. The step fails if the restored Play .apk
   is byte-identical to the new one.

Why these are three steps and not one: `tooling/ci/workflow-scan.mjs` joins a literal `run: |`
block's lines with ` ; `, so a backslash-continued `flutter build` inside one reads as several
commands. `assert-obfuscation-coupled.mjs` and `assert-channel-register.mjs` then find no
`--obfuscate` and no `RELEASE_CHANNEL`. Every `flutter build` in this workflow is a folded
`run: >` for that reason. This one is too.

### The artifact name comes from the signer the job READS

`tooling/ci/assert-apps-gov-in-apk.mjs` runs `apksigner verify --print-certs` against the built .apk
and compares the signer with `signing.signingCertificate.sha256` for `apps-gov-in` in the register.
That is the pin, and it is null until the key is minted.
2026-09-22: the guard reads the three shapes apksigner is known to print (`Signer #N`, `Signer
(minSdkVersion=…)`, and the `V2 Signer:` that build-tools 37.0.0 prints under the same `--version`
0.9), and any other label is COVERAGE LOST. It prints the shape it
read or, on COVERAGE LOST, the path, `--version` and the first 20 lines of stdout and stderr, and was
proven on dispatch run 35737416404.

| what CI finds | artifact name | job |
|---|---|---|
| the pin is null; secrets absent; debug signer | `apps-gov-in-<app>-apk-NOT-FOR-UPLOAD-debug-signed-build-proof` | green; the summary says why IN CAPITALS |
| the pin is null; secrets present; our own signer | `apps-gov-in-<app>-apk-NOT-FOR-UPLOAD-release-signed-unpinned` | green; the summary says why IN CAPITALS |
| the pin is set and the signer matches it | `apps-gov-in-<app>-apk` (the ONLY name the owner may upload) | green |
| the pin is set and the signer does not match it | none | **FAILS** |
| the signer is the Play upload key (whatever the pin) | none | **FAILS** |
| the signer contradicts the posture from the prepare step | none | **FAILS** |

The same guard reads `aapt2 dump badging`. It prints the .apk's `minSdkVersion` (with the portal's
label for it, `24 = Nougat 7.0`) and its `versionName` into the step summary. It then grades
`store/apps-gov-in/form-answers.json` against both, and against the permissions the .apk requests.

**The weekly keyless proof stays green.** The scheduled run has no `APPSGOVIN_*` secrets and the
pin is null, so the first row applies: the build is labelled, and nothing fails. When the owner
mints the key, pastes the four secrets and records the fingerprint in the register, the pin-set
rows apply with no change to the workflow.

### The read-back steps are last in the job

The apps.gov.in VAPT check, the media check, the signer/minSdk check and the upload all sit AFTER
every Play artifact and the GlitchTip symbol upload. A finding there fails the job, but it cannot
cost the artifacts above it.

- **VAPT.** `assert-android-vapt-manifest.mjs` runs on the apps.gov.in .apk as well as the Play
  one: MobSF is run over the file the owner uploads. ⏱ 2026-09-23: its V5 also fails an exported
  component guarded only by a FOREIGN permission (§vapt).
- **Media.** `assert-apps-gov-in-media.mjs` checks that the 155x290 screenshots and the 512 icon
  are still the derivation of the Play set, and that nobody edited one by hand. Its `--write` mode
  re-derives them.
  2026-09-22: it also runs as the last step of `ci.yml`'s `guards-store` job. This workflow runs
  only on a dispatch, a tag or the Monday/Thursday cron, so until then a pull request that
  re-captured the Play set merged green and the next scheduled build went red. Now that pull
  request fails. The step here stays as the read-back beside the artifact. Both steps run it as
  `node --single-threaded`, because it decodes and re-derives every image and has adopted the
  shared relaunch (`tooling/ci/single-threaded-relaunch.mjs`).

### Two changes the new steps forced on the Play half of the job

- **`if: ${{ !cancelled() }}` on the symbols upload.** The apps.gov.in prepare and build steps now
  sit between the Play builds and that upload. Without the condition, one failure there (half the
  secrets set, say) would lose the linux, apk and aab mappings as well. A lane directory that was
  never written is skipped. Zero files across all of them is still an error.
- **`timeout-minutes: 45` (was 30).** A fourth Android build adds several minutes. A timeout
  CANCELS the job, and a cancelled job skips even the `!cancelled()` step, so the ceiling has to
  fit the whole job.

### The channel manifest overlay: what one channel's build strips

Added 2026-09-23. Build apps run 35822768347 failed on the apps.gov.in .apk. Verbatim: "the built
.apk requests com.android.vending.BILLING, and tooling/channel-register.json "apps-gov-in" forbids
the "play-billing" rail on this channel". #890 had linked RevenueCat, and with it the Play Billing
Library, into every Android build. That library's manifest merges BILLING into the Play .aab, where
it belongs, and into the apps.gov.in .apk, where it cannot work: Play Billing completes a purchase
only against a Play install.

- **The overlay.** `apps/<app>/android/app/src/channel/<id>/AndroidManifest.xml`. For apps-gov-in
  it holds one `<uses-permission android:name="com.android.vending.BILLING" tools:node="remove"/>`.
- **The hook.** The CHANNEL MANIFEST block in `android/app/build.gradle.kts`. It decodes
  `RELEASE_CHANNEL` out of the `-Pdart-defines` Flutter passes to Gradle. If that channel has an
  overlay, the hook makes it the release build type's manifest. A build-type manifest outranks main
  and every library, so its removal wins. It keeps only the channel id and logs only the overlay's
  path, because the other defines carry keys. With no channel or no overlay, nothing changes.
- **Before merge.** `tooling/ci/test/android-channel-manifest.test.mjs` checks the following on
  every pull request. This matters because this workflow never runs on one.
  - Every Android row whose `forbids` names a rail with a permission has an overlay that removes
    that permission. The permissions come from `RAIL_PERMISSIONS`, the map the built-.apk guard uses.
  - No overlay removes the permission its own channel's rail needs.
  - No overlay names a channel that is not an Android row.
  - This workflow passes `--dart-define=RELEASE_CHANNEL=<id>` for each overlay.
  - The hook is present in code, not only in its comment.
- **After build.** `assert-apps-gov-in-apk.mjs` still reads the permissions of the built .apk. Only
  a build can prove the merged manifest.
- **Play declarations.** `assert-play-declarations.mjs` now skips two things:
  - another channel's overlay, which never reaches the Play artefact;
  - `tools:node="remove"` lines, because a removal is not a permission.

  An `android-play` overlay would still be read like any other manifest.

### PR lane — the Android artifacts every PR builds

*Added 2026-09-23 · closes `O-BUILT-ARTIFACT-GUARDS-RUN-ONLY-AFTER-MERGE`.*

This workflow never runs on a pull request. Its three Android builds now also run on every pull
request, as `ci.yml` `android-artifacts`: one matrix leg per app, from `ci.yml` `android-apps`,
which runs the same `assert-release-lane-generic.mjs --emit-apps` as `prepare` here. Both jobs are
in `ci-gate`'s `needs`. The overlay above gets its first build proof on a pull request there.

- **What is built.** The Play `.apk`, the `.aab` and the apps.gov.in `.apk`, with
  `linux_web_android`'s flags: `--obfuscate --split-debug-info`, the same `RELEASE_CHANNEL` stamps
  and the same define names. Three things differ:
  - `APP_VERSION` ends in `+pr`, not the commit. That is legal only because
    `tooling/channel-register.json` lists `ci.yml#android-artifacts` in `releaseBuildsNeverShipped`,
    which `assert-app-versioning.mjs`, the channel census and the obfuscation guard read. The
    obfuscation guard waives a failing COUPLING or SINK for those builds, prints each waiver, and
    still grades FLOOR: every one of them must carry `--obfuscate`.
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_BASE_URL` and `GLITCHTIP_DSN` are empty.
  - No signing secret is in reach, so Gradle signs all three with its debug fallback. The
    apps.gov.in build has no step `env:`.
- **The one secret: R-KEY, option A.** The Play `.apk` and `.aab` pass
  `--dart-define=REVENUECAT_KEY=${{ secrets.REVENUECAT_PUBLIC_KEY_GOOGLE }}`, exactly as here.
  `assert-channel-register.mjs` 6b-iii grades an `android-play` stamp's key before it consults any
  exemption, so an empty value or a missing define is red on the PR lane as on main. The value is
  the public RevenueCat SDK key, which ships inside every Play binary. `ci.yml` runs on
  `pull_request`, so a fork's pull request gets an empty value; its build is discarded like every
  other. The apps.gov.in `.apk` passes no key, as here. The register's `storeKeyDefine` rule text
  now says an exempt build stamped with a store-rail channel still carries its key.
- **What reads the artifacts, and what stays on main.**

  | guard | on the PR | why |
  |---|---|---|
  | `assert-artifact-shape.mjs` | yes, `--platform android-artifacts` | its own `LANE_OUTPUTS` key: the `.aab`, the Play `.apk`, `build/apps-gov-in/*.apk`. No channel names this lane job, so the guard prints a note and grades the files |
  | `assert-elf-page-alignment.mjs` | yes, on the `.aab` | it reads the binary and needs no key |
  | `assert-android-vapt-manifest.mjs` | yes, both `.apk`s | the merged manifest exists only inside the built `.apk` |
  | `assert-apps-gov-in-apk.mjs` | yes, `--posture debug` | the posture that requires the debug signer. The permission, form and minSdk checks run in every posture; run 35822768347 failed on exactly those |
  | `assert-artifact-signed.mjs` | main only | it asks "the upload key, not debug". A pull request holds no key, so its only answer there is "debug". The PR-time analogue is `android-signing.test.mjs`, with `android-signing.mjs`'s refusal of a partial secret set |
  | `assert-artifact-signed-msix.mjs`, `assert-artifact-signed-apple.mjs` | main only | desktop and Apple lanes, which need certificates; not built on a PR |
  | `assert-release-json.mjs` | main only | it reads the `dist/` the `release` job writes from every platform's artifacts; an Android-only lane has none. The PR-time analogue is `assert-release-json.test.mjs` |

- **Nothing leaves the runner.** No `upload-artifact`, no symbols upload, no GlitchTip release, no
  `record-deployment`, no `gh release`, and no `android-signing.mjs`.
- **The test that holds the copies equal.** `tooling/ci/test/built-artifact-pr-lane.test.mjs` reads
  both workflows through `workflow-scan.mjs` and goes red on any of these:
  - a target, a channel stamp, a flag or a define name that differs between the two jobs, from
    either side;
  - a secret in the PR lane other than the key `storeKeyDefine` maps for a store-rail stamp;
  - an upload step or the signing script in the PR lane;
  - an `assert-*.mjs` step here over an `.apk`, an `.aab` or a `--platform` that is neither in the
    PR lane nor in the test's `MAIN_ONLY` table with a reason, and a `MAIN_ONLY` entry this job no
    longer runs;
  - a posture other than `debug`, a `ci-gate` that does not need both jobs, a job-level `if:`, or
    a `--platform` value `assert-artifact-shape.mjs` does not know.

  The comment above the Play `.apk` step here names the test.
- **Cost.** The Android part of `linux_web_android` measured 11.5 and 11.7 min per app (runs
  35741818599 and 35737416404), hence `timeout-minutes: 30`. It adds about 5 minutes to the pull
  request's critical path, and to `main`'s `ci-gate`, which the deploy lanes wait on. It costs $0:
  a public repository on GitHub-hosted runners. There is no Gradle cache yet.

## Obfuscation and native symbols

*Added 2026-09-07 · [ADR 067] decision 6 · closes GAP G2 of the end-to-end audit ·
`programme.json` P1-11.*

### What was measured, and what it cost

The audit of 2026-09-07 counted **15 release `flutter build` commands across 7 workflows and
0 carrying `--obfuscate` or `--split-debug-info`**, with the only symbol upload anywhere being
`deploy-web.yml`'s **web source maps**, which is web's own separate obligation. The guard that
exists for this, `tooling/ci/assert-obfuscation-coupled.mjs`, printed
`ok … 16 flutter build command(s), 0 obfuscating` and exited 0 — every word of that true, and the
obligation entirely unmet, because the guard only ever asked *"did an obfuscating build keep its
mapping"* and nothing obfuscated. That is `C-COVERAGE-LOST-IS-NOT-PASS` in its purest form, and it
is why the guard now carries a **floor** as well as the **coupling** limb. See its header.

### What every release build now does

`--obfuscate --split-debug-info=build/symbols/<lane>`, on **13** release builds:

| workflow · job | build | `--split-debug-info` |
|---|---|---|
| `build-platforms.yml` · `linux_web_android` | linux | `build/symbols/linux` |
| `build-platforms.yml` · `linux_web_android` | apk | `build/symbols/android-apk` |
| `build-platforms.yml` · `linux_web_android` | appbundle | `build/symbols/android-aab` |
| `build-platforms.yml` · `windows` | windows | `build/symbols/windows` |
| `build-platforms.yml` · `apple` | macos | `build/symbols/macos` |
| `build-platforms.yml` · `apple` | ios | `build/symbols/ios` |
| `submit-play.yml` · `dry-run`, `submit` | appbundle | `build/symbols/android-aab` |
| `submit-appstore.yml` · `dry-run` | ios, macos | `build/symbols/{ios,macos}` |
| `submit-snap.yml` · `dry-run`, `submit` | linux | `build/symbols/linux` |
| `submit-windows-store.yml` · `dry-run` | windows | `build/symbols/windows` |

The apk and the aab write to **separate** directories on purpose. They are two AOT compilations and
nothing guarantees they produce the same mapping; one directory for both would leave whichever
build ran second silently overwriting the other's symbols.

### Why web is not in that table, and why that is not an exemption anybody chose

Flutter's own documentation (docs.flutter.dev/deployment/obfuscate) lists the targets obfuscation
applies to — `aar, apk, appbundle, ios, ios-framework, ipa, linux, macos, macos-framework,
windows` — and states *"Web apps don't support obfuscation. A web app can be minified…"*. So the
two web release builds (`build-platforms.yml`'s build proof and `deploy-web.yml`'s deploy) are
outside the floor's **domain**, not excused from it. The guard holds both lists and treats a target
in **neither** as COVERAGE LOST, so a Flutter release that adds a target cannot fall out of the
floor in silence. Web's own symbolication path is `--source-maps` plus
`tooling/ops/upload-web-sourcemaps.mjs`, in `deploy-web.yml`, and it is untouched by this.

### The two destinations, and why there are two

A `--split-debug-info` directory is the **only** thing that turns `_x12a` back into
`SubscriptionRepository.refresh`, it exists for as long as the runner does, and **a rebuild
produces a different mapping**. There is no recovery from losing it, only a re-release.

1. **The crash sink**, on the `ubuntu-24.04` lane: `glitchtip-cli debug-files upload`, wrapped by
   `tooling/ops/upload-native-symbols.mjs`. GlitchTip implements the DIF path for ELF/Mach-O/PDB
   (`chunk-upload` → `files/difs/assemble/`), and CHANGELOG 6.1.5 *"Fix: Symbolicate obfuscated
   Flutter Android stack traces"* is the maintainers saying so. **This is where symbols are read.**
2. **A 90-day workflow artefact**, on every lane: `symbols-<app>-<platform>`. **This is what
   survives the sink losing them.**

The artefact is named `symbols-*` and **not** `<app>-*` deliberately: `build-platforms.yml`'s
`release` job downloads `pattern: <app>-*` and publishes it, and an obfuscation mapping attached to
a public GitHub Release un-obfuscates the build for everyone who downloads it.

### Why the crash-sink upload is wrapped instead of called directly

`glitchtip-cli debug-files upload` **exits 0 in three states that are not "the symbols are
stored"**, all three read from `src/commands/debug_files.rs` at the pinned v1.0.0:

* `found.is_empty()` prints *"No debug information files found."* and returns `Ok(())` — an empty
  or mis-named directory is a green upload of nothing;
* the per-file loop counts failures into `errors` and prints
  `Upload complete: N chunk(s) uploaded, M error(s).` without failing;
* `poll_assembly` gives up after 60 polls with *"Assembly did not complete within timeout."* and
  returns `Ok(())`, and a per-file `"error"` state prints `Error: <name>: <detail>` and likewise
  returns `Ok(())`. Assemble is asynchronous, so a 200 means **queued**, never **stored**.

The wrapper counts the files itself and asserts the CLI's own output against that count, requires
`0 error(s)`, and requires `Assembly completed.` — which `poll_assembly` prints only when the
server has answered ok/created for every checksum. It **fails closed** naming `GLITCHTIP_TOKEN` if
the credential is absent; it never skips. Negative test:
`tooling/ci/test/native-symbol-upload.test.mjs`.

This is the same lesson `tooling/ops/upload-web-sourcemaps.mjs` was written for, on a different
endpoint — and note the difference: that one had to **replace** `glitchtip-cli sourcemaps upload`,
because the release-files path stores nothing from a gzipped JS file. The **DIF** path this one
uses is one GlitchTip really implements, so the CLI is used, and only its exit code is distrusted.

### What is deliberately NOT uploaded

`build/app/obfuscation.map.json` (from `--save-obfuscation-map`), through
`glitchtip-cli dart-symbol-map upload`. That map fixes the **issue title**, not the stack trace,
and GlitchTip cannot consume one: the assemble path is `Archive.open(file)` over what is a JSON
array of strings, and grepping `apps/difs/*` and `apps/event_ingest/process_event.py` for `dart`,
`symbol_map` and `obfuscat` returns nothing. Measured in the corpus at
`research/68-GLITCHTIP-CAPABILITY-INVENTORY.md` §3.2. **Expect readable stack traces and mangled
issue titles.** Wiring an upload the server discards would be coverage that is not, so
`dart-symbol-map` is explicitly *not* in the guard's `SYMBOL_UPLOAD` accept list and a lane doing
only that fails the coupling limb. Mitigate at the SDK — a stable `fingerprint` or `transaction` —
not here.

### Open residues, named rather than left to be discovered

* **The `windows` and `apple` jobs retain their symbols but do not upload them to the sink.**
  `tooling/versions.json` pins ONE `glitchtip-cli` binary and it is `linux-x86_64`; arming those
  runners means a second and third pinned binary each with its own digest. Until then the 90-day
  artefact is each mapping's only copy. Same for `submit-appstore.yml` and
  `submit-windows-store.yml`.
* **The store lanes (`submit-*.yml`) retain but do not upload**, for the same reason on Windows and
  macOS, and on `submit-play.yml`/`submit-snap.yml` because those jobs run at the owner's manual
  submission moment and an untested upload step between the build and a real store push is a risk
  taken on the owner's behalf. The build flags and the retention are there; the sink wiring is a
  later increment.
* **`assert-obfuscation-coupled.mjs` cannot see whether the crash sink actually symbolicated
  anything.** It reads workflow text. The end-to-end proof is
  `research/58-SENTRY-VS-GLITCHTIP-AND-THE-ORACLE-BOX.md`'s standing action: ship a deliberate
  crash in an obfuscated Android release build and read the frame back. That remains open.


### ⏱ APPENDED 2026-09-07 (fix pass) — three things above are now WRONG, and this is what supersedes them

Two adversarial reviews of the change described above found three defects. The wording above is
left standing rather than rewritten; read this section as the correction.

**1. The table says 13 release builds. It is 14.** [#518] landed a real `submit:` job in
`submit-windows-store.yml` after this unit's last merge of `main`, carrying a
`flutter build windows --release` this unit had never seen. It now obfuscates into
`build/symbols/windows` and retains `symbols-subscriptiontracker-windows-store` for 90 days, placed **before** the
store submission for the reason the Play and Snap lanes already state. So the row
`submit-windows-store.yml · dry-run` reads **`dry-run`, `submit`**, and the guard prints
`14 release build(s) on an obfuscatable target, 14 obfuscating`.

**2. The floor no longer decides "is this a release build" by looking for `--release`.**
`flutter build <target>` **defaults to release mode**; `--debug` and `--profile` are the documented
opt-outs. Keying the floor's domain on the presence of `--release` therefore left a silent escape
hatch, and the guard-integrity reviewer proved it on the real tree: delete `--release` and
`--obfuscate` from `flutter build linux`, and the guard printed
`ok … 12 release build(s), 12 obfuscating`, exit **0**. A shipping, un-obfuscated Linux release had
left the floor and nothing named the build that left — the same vacuity, one layer down, that this
whole change exists to remove. **The rule is inverted:** a build on an obfuscatable target is inside
the floor **unless** it carries an explicit `--debug` or `--profile`, those opt-outs are **counted
and printed by file, line, job and target**, and a command naming two modes at once is COVERAGE LOST
rather than a guess. The same mutation now exits **1**. `bundle` was also dropped from
`NON_OBFUSCATABLE_TARGETS`: the doc line cited for that set covers only web, `bundle` was an
unsourced entry in an exemption set, and it exempted nothing in this tree — an unsourced target now
gets the COVERAGE LOST verdict it deserves.

**3. In `build-platforms.yml` the `symbols-*` retention step was the LAST step of every job**, behind
`Install glitchtip-cli` (a `curl --fail` against gitlab.com) and `Upload the native debug symbols to
GlitchTip` (fails closed on a missing token). Any earlier failure — a GitLab 404, a GlitchTip outage,
a rotated token, an unrelated assertion — took the mapping with it. Not hypothetical: in this unit's
own dispatch run `34093704881`, `Build linux` succeeded **with the flags**, a later step failed, and
the symbols artefact was `skipped`. The obfuscated build's only mapping was written and destroyed
with the runner. In all three jobs the retention step now sits **immediately after the last
`flutter build`**, ahead of every assertion and every network call — the rule this unit already
stated for the store lanes, finally applied to the lane it was written about.

**Residual, stated rather than hidden.** A build step that fails *before* the retention step still
takes the symbols of any build that succeeded before it, because GitHub skips the remaining steps of
a failed job. That is the same property the installable `upload-artifact` step beside it has always
had, and closing it means `if: always()` on both — which turns "the build failed, so there are no
symbols" into a second, louder failure under `if-no-files-found: error`. Left as it is, deliberately,
and recorded here.

### ⏱ APPENDED 2026-09-07 (unit `symbols-everywhere`) — THE UPLOAD HALF IS NOW DONE, AND THE "OPEN RESIDUES" LIST ABOVE IS SUPERSEDED

*[ADR 067] decision 6 · `programme.json` P1-11 · `open.json` O-NATIVE-SYMBOL-UPLOAD-LINUX-ONLY ·
end-to-end audit of 2026-09-07 §4 gap N9.* The wording above is left standing; read this as the
correction.

**The two "open residues" bullets were true and one of them was over-broad.** The sentence
*"`tooling/versions.json` pins ONE `glitchtip-cli` binary and it is `linux-x86_64`"* appeared here,
in `open.json`'s own row, in `post-audit-99-closeout.md:230` and in a `# why:` comment on four
workflow steps. It excused **seven** lanes — windows ×3, macOS ×2, iOS ×2. It never excused the
other **four**: `submit-play.yml`'s `dry-run` and `submit` jobs and `submit-snap.yml`'s `dry-run` and
`submit` jobs all run on `ubuntu-24.04`, the runner the pinned Linux binary was always for. Those
four uploaded nothing for no reason anybody had written down, and the over-broad sentence is what
made the gap look larger and harder than it was.

**What changed.** All fourteen release builds now upload:

| workflow · job | runner | binary | pin read |
|---|---|---|---|
| `build-platforms.yml` · `linux_web_android` | `ubuntu-24.04` | `glitchtip-cli-linux-x86_64` | `glitchtip_cli` + `glitchtip_cli_sha256` |
| `build-platforms.yml` · `windows` | `windows-2025` | `glitchtip-cli-windows-x86_64.exe` | `glitchtip_cli` + `glitchtip_cli_windows_x86_64_sha256` |
| `build-platforms.yml` · `apple` | `macos-26` | `glitchtip-cli-macos-arm64` | `glitchtip_cli` + `glitchtip_cli_macos_arm64_sha256` |
| `submit-play.yml` · `dry-run`, `submit` | `ubuntu-24.04` | linux | nothing new pinned |
| `submit-snap.yml` · `dry-run`, `submit` | `ubuntu-24.04` | linux | nothing new pinned |
| `submit-appstore.yml` · `dry-run` | `macos-26` | macOS | `glitchtip_cli_macos_arm64_sha256` |
| `submit-windows-store.yml` · `dry-run`, `submit` | `windows-2025` | Windows | `glitchtip_cli_windows_x86_64_sha256` |

**There is still ONE version and three sets of bytes.** `glitchtip_cli` stays the only version key
and the only one Renovate advances; the two new keys are digests of the *other two artifacts of that
same release*, in the shape `glitchtip_cli_sha256` already had, each with its own written
`$updateExemptions` entry. A second *version* key would be exactly the drift `tooling/versions.json`
exists to refuse. The asset names come from the project's own `.gitlab-ci.yml` at tag `v1.0.0`
(`build-windows-x86_64` → `glitchtip-cli-windows-x86_64.exe`, `build-macos-arm64` →
`glitchtip-cli-macos-arm64`), and all three digests were measured by downloading all three in one
pass **with the Linux one as the control** — it re-derived the committed `de1c035a…82dfef` byte for
byte, which is what makes the two new digests evidence rather than assertion.

**Two platform differences, both deliberate, neither cosmetic.** The Windows install step is `pwsh`
with `Invoke-WebRequest` + `Get-FileHash`, because `$RUNNER_TEMP` on a Windows runner is a backslash
path and handing one to MSYS coreutils inside `shell: bash` is a bug class this repository has
already paid for; it is the same shape `submit-windows-store.yml`'s msstore-cli install uses. The
macOS step is `bash` like the Linux one but checks with `shasum -a 256`, because macOS does not ship
coreutils' `sha256sum`. The macOS binary is `aarch64-apple-darwin` and carries an
`LC_CODE_SIGNATURE` (read off the Mach-O load commands, `0x1d`), so Gatekeeper is not an ambush
waiting on the first dispatch — and if it ever were, the `--version` check in the install step is
what says so, loudly, rather than an upload that skips itself.

**Ordering, everywhere, in one rule.** In all ten jobs the order is now: **build → retain the
`symbols-*` artifact → install the CLI → upload to the sink → everything else**. Two of those moves
close the §9.3 defect in lanes it had not yet been applied to: `submit-play.yml`'s and
`submit-snap.yml`'s `dry-run` jobs kept their symbols as the **last step of the job**, behind
`snapcraft pack` and a store dry run, and `submit-windows-store.yml`'s `dry-run` job kept them
behind `dart run msix:create`. The `submit` jobs' retention steps moved earlier too, ahead of the
packaging rather than merely ahead of the store call.

**A tradeoff worth naming rather than discovering.** On the two real `submit:` jobs the sink upload
now sits **before** the store push, so a GlitchTip outage **fails the submission**. That is
deliberate: the 90-day artefact is already written when the upload runs, so nothing is lost either
way, and the alternative — uploading after the push — ships a release whose symbols reach no sink at
exactly the moment they matter most. It is the same fail-closed posture
`tooling/ops/upload-native-symbols.mjs` takes on a missing `GLITCHTIP_TOKEN`.

**And the guard gained a third limb, because retaining is not sending.** `assert-obfuscation-coupled.mjs`
now grades **SINK** as well as FLOOR and COUPLING: every obfuscating release build must upload its
symbols to the crash sink from a **later step of its own job**. An `actions/upload-artifact` no
longer settles it for a release build — that acceptance is what let the guard print *"every
obfuscating build retains its symbol mapping in its own job"* over 11 lanes that sent their mappings
nowhere a symbolicator can read. A job that genuinely cannot upload must be named in the guard's
`SINK_UPLOAD_EXEMPT` table with a written reason, and that table is graded in **both** directions:
an entry for a job that does upload, or for a job that has no obfuscating release build, fails the
build as a stale excuse. **It is empty today.** Mutation record, green control first: deleting one
upload step ⇒ exit 1; moving one upload step *before* its build while leaving its text in the job ⇒
exit 1; a stale exemption ⇒ exit 1; an exemption for a job that does not exist ⇒ exit 1.

**What is still open.** The third residue bullet above stands unchanged: this guard reads workflow
text and cannot see whether the crash sink actually symbolicated anything. That is
`O-GLITCHTIP-FLUTTER-SYMBOLICATION-UNPROVEN`, and it is a different question from this one.

### ⏱ APPENDED 2026-09-09 — `glitchtip-project`: the telemetry sink was standing between an artifact and its own proof

**What happened, measured twice.** The Apple lane's step 17, *Upload the native debug symbols to
GlitchTip*, POSTed to
`https://glitchtip.nikatru.com/api/0/projects/nikatru/subscriptiontracker/files/difs/assemble/` and
got **404**. GitHub then skipped every step after it — which is *Package the macOS .pkg* and *PROVE
the .ipa and .pkg are real and signed*. So no `.pkg` was produced, and no signature was ever read
back. **A monitoring outage decided whether a shippable artifact was proven signed.**

**The 404 itself.** `--project` was `"$APP"` — `matrix.app`, the name of a *directory in this
repository*. The app slug moved to `subscriptiontracker`; the GlitchTip project did not, because a
project slug lives on a remote server and moves by `PUT /api/0/projects/nikatru/<slug>/`, not by a
commit. Deriving one from the other asserts they move together, and on 2026-09-09 they did not.

**What was done to the live instance.** The existing project was **renamed**, not replaced —
`PUT {"name":"subscriptiontracker","slug":"subscriptiontracker"}` returned the same row, `id 1`.
Read back afterwards: **all 14 issues survive with their ids and event counts unchanged**, and the
DSN is byte-identical (same key id, same public key, same `projectId`), so `GLITCHTIP_DSN` needed no
rotation. The short-id **prefix is rendered from the slug, not stored**, so the suffix is stable and
every corpus reference re-resolves by adding the new prefix: `SUBLY-9` is `SUBSCRIPTIONTRACKER-9`,
issue id 21, 4 events. `SUBLY-1`…`SUBLY-E` map likewise, one for one. Creating a new project instead
would have split the history *and* minted a new DSN; that is why it was not done.

**The ordering, which is the real defect.** The linux lane already ran its signing and shape
assertions *before* the symbol upload. The windows and apple lanes did not. Both now match linux:
the `upload-artifact` step that *retains* the mappings for 90 days still runs immediately after the
last `flutter build` — nothing about symbol preservation changed — and only the **network call**
moved, to the end of the lane, after every proof.

**The rule, now held by a guard.** `tooling/ci/assert-glitchtip-project.mjs` refuses (1) two call
sites naming different projects, (2) any `--project` argument that is an expression rather than a
literal, and (3) zero call sites found. It carries no project name of its own, so the next rename
does not touch it. `--project-name=` (Cloudflare Pages) is deliberately outside its boundary: that
one *is* one-per-app and *is* correctly derived. Mutation record, green control first, each exit code
captured on its own line: real tree ⇒ **exit 0, 12 call sites**; `origin/main`'s pre-fix workflows ⇒
**exit 1**, naming all five derived sites; one file reverted to `--project subly` ⇒ **exit 1**,
printing both spellings; the flag renamed away ⇒ **exit 1 COVERAGE LOST**; `--live` with no token ⇒
**exit 1** naming the secret. With the token, `--live` reads `"subscriptiontracker" (id 1)` back off
the live instance. CI runs it **offline** — ci.yml's standing objection to a CI limb depending on the
GlitchTip box stands, and the half that was false today is knowable from the tree alone.

#### ⏱ APPENDED the same day — the first repair spelled the project out, and the lane guard refused it

The paragraph above says the project is written out at each call site. **That was true for
about an hour and it is now wrong**, and the correction is worth more than the edit would be.
`assert-release-lane-generic.mjs` failed the change on `deploy-web.yml`: **[pipeline 10]D-2b**
abolishes per-app workflow authoring, and an app id typed into a graded lane's `run` is exactly
that — shipping app #2 would mean finding and editing every copy on the one lane that reaches
users. The guard also states the remedy: an app id belongs to the matrix leg, *or to a file the
lane reads at run time*.

So the value lives in **`tooling/ops/glitchtip-project.json`** and every lane reads it at run
time. It is not the matrix leg, because the value is not per-app: it is one crash sink for the
whole portfolio. The two forms now in the tree are both accepted and both graded:

| lane | form | why |
| --- | --- | --- |
| `build-platforms.yml`, `deploy-web.yml` | `gt_project="$(node -p "require('./tooling/ops/glitchtip-project.json').project")"` (bash) / `Get-Content \| ConvertFrom-Json` (pwsh) | graded by D-2b; the id may not appear in `run` |
| `submit-*.yml` | the literal | not graded by D-2b, and PR #567 is editing these same lines — a second form here would be a merge conflict for no gain |

`assert-glitchtip-project.mjs` holds both: a **variable-form** call site must read the
declaration **in its own step** (a variable assigned somewhere else can hold anything), a
**literal-form** call site must equal the declared project, and **no** call site may be derived
from the app — `$APP`, `${env:APP}`, `${{ matrix.app }}`. Mutation record, green control first,
each exit code on its own line: real tree ⇒ **exit 0, 12 call sites, 5 reading the declaration**;
`--project "$APP"` ⇒ **exit 1**; `${{ matrix.app }}` ⇒ **exit 1**; `${env:APP}` ⇒ **exit 1**; a
lane spelling a different project ⇒ **exit 1**; the read line deleted and the variable left ⇒
**exit 1**; the flag renamed away ⇒ **exit 1 COVERAGE LOST**; the declaration file absent ⇒
**exit 1**; a declaration with no `project` ⇒ **exit 1**. 17/17 in
`tooling/ci/test/glitchtip-project.test.mjs`.

🔴 **Case R1b paid for itself.** The first regex was `--project\s+(\S+)`, which stops at the
space inside `${{ matrix.app }}` and captures `${{`. That is a variable but not recognisably
app-derived, so the single expression this guard exists to refuse would have been graded by the
weaker of its two rules. The test caught it; the regex now matches the whole `${{ … }}` form.

### ⏱ APPENDED 2026-09-23 — the crash-sink upload re-asks a transient origin error

**Why, measured on the web lane.** deploy-web run 35831511489 (main f64cd921) went red on one
line, `error: Failed to create release: POST https://glitchtip.nikatru.com/api/0/organizations/nikatru/releases/ returned 522 <unknown status code>: error code: 522`.
A 522 is Cloudflare saying the origin did not answer in time. The native uploads talk to the same
origin through the same CLI, and the CLI has no retry: read at the pinned v1.0.0,
`src/api/client.rs` builds a reqwest client with a 30 s connect timeout, no total timeout and no
retry, and bails on any non-2xx. Row `O-GLITCHTIP-CALLS-HAVE-NO-RETRY`.

**What changed.** The steps in this file are unchanged. `tooling/ops/upload-native-symbols.mjs`
(the wrapper described in *Why the crash-sink upload is wrapped instead of called directly*
above) now runs the whole `glitchtip-cli debug-files upload --wait` as ONE attempt of
`readWithBoundedRetry` from `tooling/ops/bounded-retry.mjs` — the shared plan, 3 attempts, gaps of
1 s then 2 s. It re-asks only what the CLI's own pinned error strings call a failed request: a
`returned <status>` that is 429 or 5xx, or a `<METHOD> <url> failed` / `Chunk upload to <url>
failed`. Any other status in the same output (a 401, a 400) is final on attempt 1, and the
found-count and assembly refusals above are answers, never re-asked. A debug file goes up as one
chunk named by the SHA-1 of its bytes and assemble is keyed by those checksums, so an attempt
re-sends the same bytes under the same names — the sequence a whole-job re-run already sends.
⚠️ What the server does with a second assemble was not measured live.

**The ceiling is the spawn's: 120 s per attempt.** The last green uploads took 5 s, 11 s and 22 s
(build-platforms run 35851949126), and `--wait` alone may poll for 60 s. Worst case per step is
3 × 120 s plus the 1 s and 2 s gaps = 363 s, inside this file's 30 and 45 minute job timeouts.

**When it first runs live.** This workflow has no push-to-main trigger (tags
`subscriptiontracker-v*`, the Monday and Thursday schedule, and dispatch), and neither have
`submit-*.yml` or `symbolication-proof.yml`, which call the same wrapper. The retry is proven by
`tooling/ci/test/native-symbol-upload.test.mjs` against an injected spawn, and first runs against
the live instance on the next tagged, scheduled or dispatched run.

**The guard.** `tooling/ci/assert-glitchtip-project.mjs` gains refusal 5: a GlitchTip network
call run bare from any workflow step — `glitchtip-cli releases|deploys|send-event`,
`debug-files|sourcemaps|dart-symbol-map … upload`, or curl/wget/`Invoke-RestMethod` on `/api/0/`
— is exit 1. A continued line is joined by the step's own shell (`\` for bash, a backtick for
pwsh) before it is split. It cannot see a pwsh variable that holds the CLI's path; no workflow
does that today.
