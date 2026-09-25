# `submit-play.yml`

The prose that used to live inside `.github/workflows/submit-play.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

[pipeline D-10] limb (i) — "a submission script exists AND RESOLVES TO A STEP
IN A WORKFLOW, parsed not grepped". This workflow is the step it resolves to.
tooling/channel-register.json's android-play row names this file and the
`dry-run` job in its `submission` block, so deleting either is a register that
points at nothing rather than an unnoticed loss.

── WHAT CHANGED 2026-08-09: THERE IS NOW A REAL UPLOAD PATH ─────────────────
`submit-play.mjs --submit` performs the Google Play Developer API edit
lifecycle for real (insert → upload → tracks.update → validate → commit).
Every endpoint it uses was fetched from a primary source; the URLs are in that
script's `PRIMARY_SOURCES` block. Until 2026-08-09 `--submit` refused with a
list of `UNVERIFIED:` facts, and it stopped refusing because the verification
happened — not because the refusal was deleted.

The `dry-run` job is unchanged and still runs on every dispatch: it is the
"does the path walk" proof and it is what ci.yml exercises. The `submit` job is
new, is OFF unless a human types the confirmation, and is gated on an
environment with a required reviewer.

═════════════════════════════════════════════════════════════════════════════
THE PUBLISH GATE — [ADR 031:117-124], AND WHY IT IS TWO MECHANISMS NOT ONE
═════════════════════════════════════════════════════════════════════════════
ADR 031 records the boundary between what the agent may do alone and what only
the owner may do. "Promoting any release to the production track" is class A —
owner-only, per instance. "Testing-track uploads" are explicitly NOT gated. The
ADR also states the enforcement mechanism was UNBUILT, names it — "a GitHub
environment with a required reviewer" — and says to build it WITH the upload
path rather than after. This is that.

🔴 `environment:` ON ITS OWN FAILS OPEN. THIS IS DOCUMENTED GITHUB BEHAVIOUR.
  docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
  VERBATIM: "Running a workflow that references an environment that does not
  exist will create an environment with the referenced name."
So if `store-publish` is missing — never created, or renamed, or simply typo'd
on the line below — GitHub does not fail the job and does not pause it. It
creates the environment, with NO protection rules, and runs the job
immediately. The run history then shows a deployment to an environment, which
reads exactly like an approval that happened.

⚠️ MEASURED IN THIS REPOSITORY, 2026-08-09, not assumed: the three environments
that already exist here (`platform`, `subscriptiontracker-api`, `subscriptiontracker-web` — all
auto-created by deploy lanes) each return `"protection_rules": []`. That is the
fail-open state, observed, on this repo.

Therefore the gate is TWO mechanisms and each covers the other's failure:
  (1) `environment: store-publish` on the submit job — what makes GitHub pause
      for an approval and record who gave it, WHEN the environment is
      configured;
  (2) `submit-play.mjs`'s PG-5, which GETs
      /repos/{owner}/{repo}/environments/store-publish and REFUSES unless a
      protection rule carries at least one reviewer — what makes (1)'s absence
      loud instead of invisible. It runs inside the gated job, so the very
      first thing an unapproved run does is fail.
Plus PG-4, which reads THIS FILE and refuses if the job that runs `--submit`
has lost its `environment:` line or stopped reading the .aab's signature first.
A gate whose only evidence is a line of YAML is a gate one edit from gone.

─────────────────────────────────────────────────────────────────────────────
✅ THE ENVIRONMENT EXISTS. Verified live 2026-08-21:
     gh api repos/globalonlinedeveloper/Nikatru_Platform_Public/environments
     -> store-publish  protection: required_reviewers, branch_policy
   which is exactly what submit-play.mjs's PG-5 requires. THE COMMANDS BELOW
   ARE KEPT as the record of how it was created and how to recreate it.

   🔴 THIS HEADER SAID "DOES NOT EXIST YET" UNTIL 2026-08-21 AND WAS FALSE.
   A 49-agent audit run that day read this comment, trusted it, and reported
   "create the store-publish environment" as an OWNER BLOCKER for the Play
   submission. It was one `gh api` call away from being disproved. A comment
   that describes MUTABLE EXTERNAL STATE is a claim with an expiry date, and
   this repository's own rule applies to it: verify against the thing, not
   against the note about the thing.

   THE ORIGINAL COMMANDS, unchanged: They are a repo-admin act (ADR 031 class D — "account-level permission
   changes"), so they are written here for a human to run rather than executed
   by an agent. Source for the endpoint and its body:
   docs.github.com/en/rest/deployments/environments — "PUT /repos/{owner}/{repo}/
   environments/{environment_name}", parameters wait_timer, prevent_self_review,
   reviewers[{type,id}], deployment_branch_policy.

  🔴 REPOINTED TWICE — 2026-08-19 and again 2026-08-20, AND THE SECOND TIME
  PROVES THE WARNING BELOW IS NOT THEORETICAL. These lines named
  `Project_Cross_Platform_Apps`, were repointed to `Nikatru_Android_Apps_Public`
  on 2026-08-19, and that name is now itself DEAD: `gh repo list` does not
  return it. The live name is `Nikatru_Platform_Public`. So for a day these
  were `--method PUT` commands aimed at a FREED name — the exact hazard the
  paragraph below describes, sitting inside the paragraph that describes it. These are commands somebody TYPES, so a
  stale name here is not prose. They would still have appeared to work: GitHub
  follows rename redirects, so `gh api repos/<owner>/<old-name>/…` answers 200 —
  which is exactly why the old name must not be left standing. A rename FREES the
  old name, and a `--method PUT` against a name someone else has re-claimed writes
  an environment with a required reviewer into a stranger's repository.

  # 1 · the reviewer's NUMERIC id — the API takes ids, never logins.
  gh api users/globalonlinedeveloper --jq '.id'      # → 55662283 (read 2026-08-09)

  # 2 · create the environment WITH the required reviewer, in one call.
  gh api --method PUT \
    repos/globalonlinedeveloper/Nikatru_Platform_Public/environments/store-publish \
    --input - <<'JSON'
  {
    "wait_timer": 0,
    "prevent_self_review": false,
    "reviewers": [ { "type": "User", "id": 55662283 } ],
    "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
  }
  JSON

  # 3 · restrict which branch may reach the gate at all (the custom policy
  #     declared above is inert until a pattern is added).
  gh api --method POST \
    repos/globalonlinedeveloper/Nikatru_Platform_Public/environments/store-publish/deployment-branch-policies \
    -f name='main'

  # 4 · prove it took. This is the EXACT read PG-5 makes, so a non-empty
  #     `reviewers` here is a submit job that can pass, and `[]` is one that
  #     cannot.
  gh api repos/globalonlinedeveloper/Nikatru_Platform_Public/environments/store-publish \
    --jq '.protection_rules'

⚠️ `prevent_self_review` IS DELIBERATELY false, AND THE HONEST REASON MATTERS.
NIKATRU is a sole proprietorship: there is one human. With prevent_self_review
true, the person who dispatches the run is barred from approving it and the
gate is unpassable — a control that cannot be satisfied is a control that gets
deleted. So what this gate actually buys is NOT a second pair of eyes. It is:
a deliberate second act, separated in time from the dispatch, recorded in the
run history with a name and a timestamp, on a job that cannot start without it.
That is a real control and it is smaller than "peer review"; saying so is the
point of this paragraph. When there is a second person, set it to true.
─────────────────────────────────────────────────────────────────────────────

⚠️ IT RUNS THE REAL THING, NOT A DOUBLE. Neither job is given
--allow-missing-artifact: each builds the app bundle first, so the script
validates (and the submit job uploads) a bundle that exists on disk. A dry run
that skipped the artifact would report the path healthy while never touching
the one output the channel actually accepts — which is precisely the .apk-shaped
hole this channel spent months in. `--submit` refuses that flag outright.

The `dry-run` job contacts nothing. Only the `submit` job has a network path to
Google, and only when a human typed the confirmation AND a reviewer approved.

### above `listing_url:`

── 🔴 [10]D-9 · THE ADDRESS THE LEDGER ROW WILL CARRY ──────────────────
A store record whose listing nobody can open says something shipped and
gives no way to look at it. record-deployment.mjs REFUSES a store
environment with no `--listing-url`, and this input is where that value
comes from — asked of the same human, in the same act, as `confirm`.

⚠️ IT IS NOT DERIVED, AND THE HONEST REASON IS THAT NOTHING IN THIS REPO
KNOWS IT YET. catalog/apps.json carries `listings.play: null` — the
listing does not exist until somebody creates it in the console (that is
OWNER_QUEUE A-2), and inventing `play.google.com/store/apps/details?id=…`
here would put a SECOND copy of the package name in a workflow file, in a
repository whose whole store layer exists to keep one copy of each fact.
The day catalog/apps.json holds a real listing URL, this input becomes a
default read from there and the record stops asking.

The submit job REFUSES an empty or non-https value BEFORE it uploads —
see "A real submission must name the listing it creates" below.

## job `gate`

### above `gate:`

Same shape and same reason as build-platforms.yml's gate job: this workflow
runs a `flutter build --release`, and a release build from an ungated commit
is [pipeline R-6]'s whole subject. assert-release-provenance.mjs walks the
`needs` graph, so gating once here covers the jobs below.

### above `timeout-minutes: 25`

25, not 10, and the number comes from the script rather than from the clock:
assert-gate-passed.mjs POLLS for up to its own 1200 s default (this call
leaves `--timeout-seconds` unset), so any bound at or under 20 kills it
mid-poll and replaces "timed out waiting for ci-gate" with an opaque
cancellation. Kept byte-identical in all five `gate:` jobs. [pipeline F-5b]

## job `dry-run`

### before step **Prepare the Android upload key**

── SIGNING IS REQUIRED HERE, unlike build-platforms.yml ─────────────────
🔴 THIS WORKFLOW'S ONLY CLAIM IS THAT THE SUBMISSION PATH WALKS, and a
debug-signed .aab is one Google Play refuses at upload — so a dry run over
one validates a path that ends in rejection while printing DRY RUN OK.
That is exactly the shape the whole workflow exists to prevent
("submission #2 costs minutes, not archaeology"), and it was the real state
of this lane until 2026-08-04: the Gradle signingConfig was correct, no
workflow supplied its four values, and the fallback to the debug key fired
on every run.

🔴 NOTHING BELOW SAYS "signing is required here" AND THAT IS THE POINT.
The script derives it: tooling/channel-register.json's `android-play` row
declares THIS FILE as the channel's `submission.workflow`, and a workflow
whose declared job is to submit may not produce a bundle that cannot be
submitted. A YAML flag would have been one deletable line standing between
this lane and the exact defect being repaired — the failure mode here is
already "a correct mechanism that nothing switched on".

So: with the four secrets absent this step FAILS and names them, rather
than validating a bundle nobody can upload. build-platforms.yml uses the
same script and is NOT required to sign, because it is not the submission
workflow and most of its runs are not tag pushes.

### before step **The versionCode lies above what Play consumed**

── 🔴 PLAY'S versionCode IS A ONE-WAY DOOR ─────────────────────────────
⏱ ADDED 2026-09-23 (O-PLAY-VERSIONCODE-HIGH-WATER-UNRECORDED). Play refuses
any upload whose versionCode is at or below one it has already consumed,
and nothing lowers that high-water mark again: the only way past it is a
permanent jump. The build below takes its versionCode from
`github.run_number`, which counts runs of THIS FILE and restarts at 1 when
the file is renamed or replaced.

So before building, this step runs
`assert-app-versioning.mjs --play-floor "$RUN_NUMBER" --app subscriptiontracker`.
It reads `tooling/channel-register.json` →
`android-play.versionCodeHighWater.consumed.subscriptiontracker` and fails
the job when this run's number is at or below the recorded value. The run
number comes through `env:`, never interpolated. The step sits in both
jobs, under the same name: the dry run meets the refusal before anyone
dispatches a real submission, and the submit job checks the very run that
will upload.

⏱ 2026-09-24 — the step first runs
`tooling/ci/read-ledger-version-code.mjs subscriptiontracker-android-play`,
which prints the largest `payload.version_code` on that environment's
[10]D-9 ledger Deployments (or `none`), and passes it to `--play-floor` as
`--recorded-upload`. `set -euo pipefail` fails the step when the reader
exits 2 (it could not read the ledger), so the check fails closed.

The same script's verify mode holds the files: every android-play-stamped
release build outside `releaseBuildsNeverShipped` (the ci.yml artifact
builds never ship) must stamp `--build-number=${{ github.run_number }}`, its
workflow must carry a `runNumberFloors` entry at or above every consumed
value, and every job that runs `submit-play.mjs --submit` must build its
own bundle.

⚠️ THE CHECK IS ONLY AS GOOD AS THE RECORDED MARK. The readback step
prints a `Play versionCode high-water` notice with the versionCode each
upload consumed. After every real upload, write that value into
`consumed.subscriptiontracker`, with its `asOf` and run id, and raise
this file's `runNumberFloors` entry in the same commit: verify mode fails
once a consumed value passes a floor. A mark nobody refreshed sits below
Play's real one, and this step then passes a number Play may still
refuse.

⏱ 2026-09-24 — the mark no longer goes stale silently: every upload now
writes the versionCode it consumed into its own ledger Deployment
(`payload.version_code`, `record-deployment.mjs --version-code`), with no
human commit and no CI write to `main`. This step reads the largest one
back and exits 1 while `consumed.subscriptiontracker` is below it, so the
next dispatch stops at the dry run until someone commits the value and
raises the floor. The dry-run job reads the ledger, so it now declares its
own `permissions:` block with `deployments: read` beside `contents: read`
(a job-level block replaces the workflow's).

### before step **Build the app bundle**

🔴 THE DEFINES ARE WHAT MAKE THIS A REAL BUNDLE RATHER THAN THE DEMO.
`AppConfig.isBackendLive` compares each of these against a PLACEHOLDER;
left unpassed, the .aab this lane validated shipped `MockAuthRepository`
and `SeedApiClient`. This step passed NO defines at all until 2026-08-04 —
not even the crash sink — so the artifact a human would have uploaded from
the console was a demo build with no telemetry, and every check was green.
Graded by tooling/ci/assert-store-build-config.mjs, which derives the set
from `isBackendLive` and the lane from this row's `submission` block.

### before step **The .aab must be signed by the upload key, not the debug key**

Reads the signature out of the bundle rather than out of the config — the
question nothing in this tree was asking. Placed BEFORE the dry run on
purpose: submit-play.mjs reports the signing POSTURE from the environment,
which is a claim about what was arranged, and this is the only step that
can contradict it with what actually happened.

### before step **The Play screenshot set spans enough device types**

── THE LISTING GATE THAT IS ONLY FATAL HERE ───────────────────────────
🔴 THE LIKELIEST FIRST-SUBMISSION BOUNCE IN THIS REPOSITORY, and every
other listing check is green. Play wants "a minimum of two screenshots
across different device types"; the set is four phone screenshots.
ci.yml runs this same guard plain, where it prints; here it runs with
--for-submission, where it refuses. It is placed BEFORE the dry run so
the refusal names the listing rather than arriving as a Play API error.

── 🔴 WHAT CHANGED 2026-08-27: THE GAP IS CLOSED, AND THE SENTENCE ABOVE
   ("the set is four phone screenshots") HAS BEEN FALSE SINCE THAT DATE ─
The paragraph is kept as written — it is why this step exists — and this
correction sits beside it because two later review passes read it as a
live blocker and re-derived a defect that no longer exists.
`tooling/channel-register.json` grew its `sets.tablet` row on 2026-08-21
and the four tablet frames landed on 2026-08-27 (#393). The listing now
covers TWO device types, which is Play's stated minimum:

  phone   apps/subscriptiontracker/store/android-play/screenshots/         4 × 1080×1920
  tablet  apps/subscriptiontracker/store/android-play/screenshots-tablet/  4 × 1800×3200

Measured on `main` @ `d7586e3e`, 2026-09-08 —
`node tooling/ci/assert-play-device-coverage.mjs --for-submission` exits
0: "2 declared device-type set(s) measured … --for-submission, so a
shortfall would have been fatal". The tablet frames are 9:16 with both
sides inside [1,080, 3,840], which is the rule Google states for
"Chromebook and tablets" verbatim.

── ⏱ 2026-09-23: THE FLAG NOW NAMES ITS CHANNEL ────────────────────────
The quote above is kept as measured. The step now runs
`--for-submission=android-play`: once the iOS, macOS, Windows and Snap
channels declared their own (still empty) device-type sets, the bare flag
made every declared channel's gap fatal, so an empty iPad set would have
refused a PLAY upload. Only the named channel's gaps are fatal now; a bare
`--for-submission` is COVERAGE LOST (exit 2). The OK line reads
"--for-submission=android-play, so a shortfall on that channel would have
been fatal".

⚠️ RUN 32451812894 IS NOT EVIDENCE ABOUT THIS TREE. It is the last
dispatch of this workflow, it failed on exactly this step, and it ran on
2026-08-21 — hours BEFORE the register row that fixes it. A red run that
predates its own fix stays red in the run list forever. Re-dispatch with
`confirm: dry-run-only` to replace it; nothing in the tree needs changing
first.

⚠️ WHAT IS STILL NOT DECLARED, DELIBERATELY: which console slot the
tablet set is uploaded to. The Play Developer API has NO generic tablet
image type — `AppImageType` is `phoneScreenshots · sevenInchScreenshots ·
tenInchScreenshots · tvScreenshots · wearScreenshots · icon ·
featureGraphic · tvBanner`
(developers.google.com/android-publisher/api-ref/rest/v3/AppImageType,
fetched 2026-09-08) — so choosing between the seven-inch and the ten-inch
slot is a real human step at upload. `submit-play.mjs` never calls
`edits.images`, so no automation depends on the answer and nothing here
guesses it; `tooling/store/capture-play-screenshots.mjs` records why the
capture does not claim an inch count either.

⚠️ AND WHY A THIRD SET IS NOT ADDED. Google makes a Chromebook, Wear OS,
Android TV, XR or Automotive set mandatory only for an app DISTRIBUTED to
that form factor ("If you distribute an app to Android TV devices, you
need to add at least one Android TV screenshot before you can publish
your app" — support.google.com/googleplay/android-developer/answer/9866151,
fetched 2026-09-08), and Subly declares none of them. The 2026-04-10
adaptive app quality guidelines that replaced the large-screen ones ask
for tablet and foldable screenshots for VISIBILITY, not to publish. A set
declared without frames captured on it would buy device-type coverage
from pixels nobody photographed — the exact failure
`assert-play-device-coverage.mjs`'s header says a 1×1 PNG once bought.

### before step **Every native library is aligned for a 16 KB memory page**

── THE PLAY STORE GATE, ON THE BUNDLE THAT WOULD BE UPLOADED ──────────
PG-4 requires assert-artifact-signed.mjs to run BEFORE the submit step;
it requires ORDER, not adjacency, so this sits between them without
disturbing that. The signature answers "who signed this?"; this answers
"will Play take it?" — a 64-bit LOAD segment under 16 KB is refused at
upload, and this is the last point before the upload where the answer is
a fact about bytes rather than a claim about configuration.

### before step **Dry-run the Google Play submission**

⚠️ PLAY_SERVICE_ACCOUNT_JSON is a PRIVATE KEY. The script parses it to
check its shape and never prints any part of it, including in the
failure messages for a malformed value. In `--dry-run` its absence is a
printed gap; in `--submit` it is a hard stop, because nothing can
authenticate without it.

### in step **Dry-run the Google Play submission**, above `- uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4`

The posture is in the NAME so a downloaded bundle carries its own answer
to "could this have been uploaded?". On this lane it is always
`release-signed` — the step above refuses anything else — which makes the
label redundant here and identical to build-platforms.yml's, where it is
not. One convention, read the same way in both places.

## job `submit`

### above `submit:`

═══════════════════════════════════════════════════════════════════════════
THE REAL UPLOAD. Two switches and a reviewer stand in front of it.

`if:` is switch one — the dispatch input a human types. `environment:` is
switch two — the reviewer gate, whose fail-open behaviour is covered by the
script's PG-5 (see the header). `needs: dry-run` means the path has already
been proven to walk on this very commit before anything is uploaded.

🔴 IT REBUILDS RATHER THAN DOWNLOADING THE dry-run JOB'S ARTIFACT, on
purpose. The chain that matters is build → read this bundle's signature →
upload THIS bundle, unbroken inside one job. Fetching an artifact across a
job boundary inserts a step at which a different file could arrive, and the
thing it would be inserted into is the one action here that cannot be undone
(Play fixes the upload certificate at the first upload). Six minutes of CPU
against that is not a trade worth thinking about.
═══════════════════════════════════════════════════════════════════════════

### above `timeout-minutes: 30`

⬜ NEVER RUN — it needs `confirm: SUBMIT-TO-PLAY` and nobody has typed it.
It REBUILDS the bundle rather than downloading dry-run's (see the note
above), so it repeats that job's measured 8m06s and then uploads; 30 is
dry-run's bound, which is the closest thing to a measurement this job has.

## job `permissions`

### above `permissions:`

── [pipeline F-11] · the scopes THIS job needs, at JOB level ─────────────
The workflow block above grants `contents: read` + `checks: read` and no
more, which is right for the gate and the dry run. This job additionally
writes the [10]D-9 record at the end, and record-deployment.mjs POSTs a
GitHub Deployment — `deployments: write`. Declared here so no other job in
this file holds it, the same shape build-platforms.yml's release job uses.

⚠️ NAMED IN FULL-LINE COMMENTS, NEVER TRAILING ONES. deployment-record.test.mjs
scans every workflow for `record-deployment.mjs <environment>` and strips only
comments that START a line, while its `\s+` crosses newlines — so an inline
`deployments: write # …record-deployment.mjs` makes it read the NEXT key as an
environment name. Recorded in build-platforms.yml on 2026-08-06; repeated here
because the trap is invisible at the call site.

## job `submit`

### before step **A real submission must name the listing it will be recorded against**

── 🔴 [10]D-9 · REFUSE BEFORE SPENDING, NOT AFTER UPLOADING ────────────
The last step of this job writes the ledger row, and record-deployment.mjs
REFUSES a store environment with no `--listing-url`. If that refusal were
allowed to happen at the end, its cost would be a red job standing over a
submission that already reached Google and that nothing in the ledger
names — the precise state D-9 exists to abolish, produced by the check for
it. So the question is asked FIRST, before the 8-minute build and before
any network path to Play is opened: a run that cannot record must not
upload.

The value is read from `env:` and dereferenced as "$LISTING_URL" rather
than interpolated into the shell — same rule as the dispatch inputs below.

⚠️ THE ECHOES BELOW SAY "the [10]D-9 recorder" RATHER THAN NAMING THE
SCRIPT, AND THAT IS NOT PROSE STYLE. `RECORD_CALL` in workflow-scan.mjs
reads `record-deployment.mjs <next-word>` as a CALL SITE and takes that
next word as an environment name, out of any `run:` body — so an echo
containing "record-deployment.mjs refuses …" invents a record call for an
environment named "refuses", in a step that records nothing. Measured
here on 2026-08-26: it produced two phantom rule-4/rule-5 problems, and
deployment-record.test.mjs would have failed the same way. A guard cannot
tell a mention from a call, so do not write one.

### before step **The .aab must be signed by the upload key, not the debug key**

🔴 THIS STEP IS LOAD-BEARING AND submit-play.mjs KNOWS IT. PG-4 parses
this file, finds the job that runs `--submit`, and REFUSES if this step
is missing or sits after it. Play binds the upload certificate at the
first upload and never accepts another; a signature nobody read before
that is a one-way door taken blind.

### before step **The Play screenshot set spans enough device types**

The listing gate again, for the same reason the alignment gate below is
repeated: this job is the one that uploads, and a gate that ran in a
different job proved something about a different run of the checkout.

### before step **Every native library is aligned for a 16 KB memory page**

The same store gate as the dry-run job, on the bundle this job is about
to hand to Play. It is repeated rather than inherited because the two
jobs build their own bundles: the dry run proved a bundle passed, not
that THIS bundle does, and a gate that grades a different artifact from
the one being uploaded is the "green means ran" failure with extra steps.

### before step **Upload to Google Play**

⚠️ THE DISPATCH INPUTS REACH THE SCRIPT AS ENVIRONMENT VARIABLES, NEVER
INTERPOLATED INTO THE SHELL. `${{ inputs.track }}` written inside a `run:`
is a template-injection sink: the value is pasted into the command line
before bash sees it, so a crafted input becomes a command. Passing it
through `env:` and dereferencing with "$VAR" leaves it data throughout.
tooling/ci/scan-workflows.mjs (zizmor) is the guard that says so.

GITHUB_TOKEN is here for PG-5, which GETs this repository's
`store-publish` environment and refuses unless it carries a required
reviewer. It is a READ (ADR 031: "Reading is never gated") and needs only
the `contents: read` this workflow already grants.

### in step **Upload to Google Play**, above `id: upload`

🔴 THE `id:` IS LOAD-BEARING — the record step below is conditioned on
`steps.upload.outcome`, and GitHub resolves `steps.<unknown>.outcome`
to null instead of erroring. Renaming or deleting this id would make
the record silently never run while the job stayed green, which is why
assert-publish-records.mjs rule 6b fails on a dangling reference.

### before step **The Play track must carry the bundle this job just uploaded**

── 🔴 [14]O-7 · THE READ THIS JOB DID NOT HAVE UNTIL 2026-08-26 ────────
The step above WRITES to Google and the step below WRITES a claim about
what it wrote. Between 2026-08-26 and this step landing, nothing read
either back — which is how "an upload that shipped nothing produces a
green tick and a deployment record naming the new SHA".

🔴 IT IS NOT THE LISTING, AND THAT DISTINCTION IS THE WHOLE DECISION.
A Play submission enters a review queue: `listing_url` is not live for
hours or days and answers 200 with the PREVIOUS build the entire time,
so probing it here would be green over precisely the failure it exists
to catch — the `Ping` finding tooling/monitor-register.json records,
repeated on a store. What IS readable in this job, in seconds, and
independent of any reviewer is the Play Developer API's own TRACK state:
the edit committed or it did not. `edits.tracks.list` names the
versionCodes each track carries, and after an upload that shipped
nothing NO track carries this build's.

⚠️ THE EXPECTATION IS THE SAME EXPRESSION THE BUILD WAS GIVEN.
`apps/subscriptiontracker/android/app/build.gradle.kts` sets
`versionCode = flutter.versionCode`, and since 2026-09-23 the build step
above passes `--build-number=${{ github.run_number }}` — so the versionCode
Play receives is this workflow's run number, and this step expects exactly
that, read from the same `github.run_number` through `RUN_NUMBER` (and
refused if it is not all digits). The application id comes through the
shared identity reader, as before.

⏱ SUPERSEDED 2026-09-23 (lane `version-stamp`). Until then the build
passed NO `--build-number`, so the versionCode was pubspec's `+1` and this
step read it through the versioning guard's parser. That is exactly how
the 2026-09-22 21:27Z and 21:38Z uploads went out as versionCode 1 twice,
with no build name and no APP_VERSION — Play's pre-launch robots then
wrote 22+ production D1 rows as `dev` (ops watch #443, prod-provenance).
The paragraph that stood here predicted the switch: "this expectation
goes STALE and this step goes RED on a good submission". It was changed
in the same commit as the build so that never happened.

⏱ 2026-09-24 — corrected by the upload log of run 35787897094: ONE edit
was committed (log :1691), versionCode 1, built without --build-number.
The high-water mark is recorded in channel-register.json
android-play.versionCodeHighWater.

🔴 MONOTONICITY. `github.run_number` is counted per workflow FILE and
only ever grows, so every new run of this workflow uploads a versionCode
above the last (runs 3–5 have run; the next is ≥ 6 > 1). A RE-RUN of a
failed run reuses its run number; if that run already reached Google,
Play refuses the duplicate versionCode and the job goes red — loud, and
the fix is a new run, never a hand-bumped number.

⚠️ IT RUNS BEFORE THE LEDGER STEP AND DOES NOT GUARD IT. That step is
`always() && steps.upload.outcome == 'success'`, so a red here still
records the submission and still fails the job. An upload cannot be
un-sent: a run that reached Google must say what it sent even when the
probe disagrees about where it landed.

### before step **Record the submission in the [10]D-9 ledger**

── 🔴 [10]D-9 · THE RECORD THIS JOB DID NOT WRITE UNTIL 2026-08-26 ──────
D-9: "a submission or upload workflow that ends without writing one
fails." This job ended without writing one, from the day it landed, and
assert-publish-records.mjs did not say so — its census ranged over the
register's `submission.job` ("dry-run") and never opened this job at all,
so it reported that the publish branch had NO INSTANCES. It had one. It
was here.

`--state in_review` and nothing else: SUBMIT_TIME_STATES in
deployment-record.mjs is `['in_review']` because an upload finishing means
WE SUBMITTED, never THE STORE APPROVED. Play decides `live` hours-to-weeks
later, after this run has ended; a separate act writes that transition.

⏱ 2026-09-24 — `--version-code "$RUN_NUMBER"` writes the versionCode this
upload consumed into the Deployment's payload as `version_code`, beside the
run identity. The recorder REQUIRES it on a row whose register entry
carries `versionCodeHighWater` (android-play) and refuses it on every
other row; the expectation is `github.run_number` because the build stamps
`--build-number=${{ github.run_number }}`. The `--play-floor` step reads it
back before the next build.

⚠️ THE CONDITION IS A STRICT WIDENING OF THE INHERITED `success()`, which
is what makes it safe and why rule 6 accepts exactly this form. `success()`
already required the upload step to be green, so every run that would have
recorded still records — plus the runs where something after the upload
fails or the job is CANCELLED. A store upload cannot be un-sent: a leg
cancelled after Play accepted the bundle has still submitted something, so
it must still say what. This is deploy-web run 144's lesson (2026-08-08),
applied to a channel where the act is irreversible rather than merely
published.

### in step **Record the submission in the [10]D-9 ledger**, above `run: node tooling/ci/record-deployment.mjs subscriptiontracker-android-play --state in_review --listi…`

ONE LINE, NOT A `run: >` FOLD, AND THAT IS NOT STYLE. The flat half of
assert-publish-records.mjs's accounting identity matches PHYSICAL lines;
the structured half reports a folded block at the line of its `run:` key.
A folded record call therefore appears at two different line numbers to
the two readers and is reported as UNATTRIBUTED — COVERAGE LOST. Every
other record call in this repository is written on one line for the same
reason (deploy-web.yml:391, deploy-workers.yml:135, :225 — re-measured 2026-09-25, after each publishing job gained its ref-check first step and each record step the id it published).

