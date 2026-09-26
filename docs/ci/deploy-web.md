# `deploy-web.yml`

The prose that used to live inside `.github/workflows/deploy-web.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## ⏱ 2026-09-25 — a post-gate call job of ci.yml ([ADR 095] §4)

This file is now only a `workflow_call` callee. It runs as ci.yml's `deploy-web` call job,
which has `needs: [ci-gate]` and the post-gate `if:`
(`github.event_name == 'push' && github.ref == 'refs/heads/main'`), so a red or skipped gate
never starts it. The push trigger, the `paths:` list and the `workflow_dispatch` button are
gone. Which changes publish is `deployUnits["<app>-web"]` in `tooling/ci/lane-map.json`, read by
`plan-deploy.mjs`. A run is listed as `deploy-web / <job>` inside a CI run, so a build stamp
`<line>.<run_number>+<sha7>` carries CI's run number. check-prod-provenance resolves it through
`laneRunHost` (the lane's run workflows are `deploy-web.yml,ci.yml`). The ops register reads the lane there
(`duty.workflow.deploy-web.yml`, unit `{jobs: [deploy-web]}`). The sections below keep the
file's earlier prose as it was written. Where they describe `paths:`, they describe the file
before this change.

## File header

### above `on:`

Builds EVERY app in the pub workspace for web with the real Flutter SDK on
GitHub's runners, then uploads each built site to its own Cloudflare Pages
project (Direct Upload) via wrangler.

── [10]D-2b · THE WEB DELIVERY PATH TAKES ANY APP ID FROM THE SPEC ──────────
🔴 UNTIL 2026-08-07 THIS FILE NAMED ONE APP SIX TIMES ON THE EXECUTABLE PATH:
the `paths:` filter, `defaults.run.working-directory`, `--emit apps/subscriptiontracker`,
the launch smoke's bundle path, wrangler's `workingDirectory` and
`--project-name=`, the post-deploy smoke's URL and the deployment record's
environment. Shipping app #2's web build therefore meant COPYING THIS FILE and
editing eight lines — the per-app workflow authoring D-2b exists to abolish,
on the one lane that reaches users.

Every one of those is now a matrix leg over
`assert-release-lane-generic.mjs --emit-apps` — the same emitter
`build-platforms.yml` and `e2e.yml` already iterate, and the same emitter that
GRADES this lane. One function, one file: this lane cannot drift from the
workspace without the guard's own reading drifting with it. A second pubspec
reader inlined here would be the copy that quietly stops reading what it
thinks it reads, which is this repository's most repeated failure.

⚠️ `${{ matrix.app }}` IS ONLY SAFE BECAUSE `strategy.matrix.app` IS DECLARED
BELOW. GitHub expands an UNDECLARED matrix context to the EMPTY STRING rather
than erroring, so a bare `apps/${{ matrix.app }}` with no matrix builds
`apps/` on every run while reading as fully generic. That exact stand-in is
what limb A′ of assert-release-lane-generic.mjs checks, and deleting the
`matrix:` block below is its recorded failing case.

### was above `paths:` (gone since #947, which made this file a post-gate call job of ci.yml)

🔴 A PATH FILTER IS A CLAIM ABOUT WHAT CHANGES THE ARTIFACT, and this list
named only the SOURCE (2026-08-01 full-corpus review, #30). The build step
is `flutter pub get --enforce-lockfile` inside a Melos 8 workspace: the
root pubspec.yaml (the `workspace:` list) and the single root pubspec.lock
are what decide every dependency version that ends up in build/web. So a
dependency bump — including a security patch landing in the lockfile with
no source change at all — produced a main commit that built differently
and deployed nothing, silently, with CI green. tooling/versions.json is on
the list for the same reason one level up: it is the single declaration
the Flutter and wrangler pins below are held to.

`apps/**` rather than `apps/<id>/**` is [10]D-2b: the filter is the FIRST
place a lane names one app, and a filter naming app #1 means app #2 ships
only when somebody remembers to edit this line. A path filter is evaluated
before any job exists, so it is the one field on the deploy path that
cannot be a matrix expression — the generic form is the wildcard.

The tooling/ci scripts are here because the steps below EXECUTE them and
none of their behaviour is visible in the source tree this filters on:
assert-release-lane-generic.mjs --emit-apps produces the MATRIX, so it
decides which apps this lane ships at all;
assert-app-versioning.mjs --emit produces the release line that becomes
--build-name AND the APP_VERSION stamped on every analytics row;
assert-gate-passed.mjs decides whether the deploy happens at all;
assert-catalog-reachable.mjs --emit-url resolves the app's published
origin, which is both what the post-deploy smoke probes and what the
deployment record names;
record-deployment.mjs writes the marker that answers "what is live". They
are listed INDIVIDUALLY rather than as tooling/ci/** on purpose — guard
work is frequent and unrelated to this artifact, and a filter that
redeploys production on every guard edit is one that gets narrowed back in
a hurry.

Enforced by tooling/ci/assert-deploy-triggers.mjs, which derives the script
list from this file's own steps — so adding a step adds its path or fails
the build. A list nobody checks drifts back the moment a new input appears.

### was above `- 'tooling/smoke/smoke-web-artifact.mjs'` (gone since #947, which made this file a post-gate call job of ci.yml)

[pipeline 9]R-13's launch smoke. Listed for the same reason as the ones
above — this lane EXECUTES it, and it is the one step that can stop a
publish. assert-deploy-triggers.mjs derives its requirement from
`tooling/ci/**` only, so this entry is deliberate rather than enforced:
a smoke that changed and never ran again would be a gate that quietly
stopped gating, which is this repository's most repeated failure.

### was above `- 'tooling/ops/post-deploy-smoke.mjs'` (gone since #947, which made this file a post-gate call job of ci.yml)

[pipeline 14]O-7's post-deploy smoke, listed for the same reason and
subject to the same non-enforcement: it is the step that decides whether
this lane goes green. (Until 2026-08-09 it also decided whether the
deployment record got written; it no longer does — the record follows
the DEPLOY step, see the block on it at the bottom of this file.)

### was above `- 'tooling/ops/create-glitchtip-release.mjs'` (gone since #947, which made this file a post-gate call job of ci.yml)

⏱ APPENDED 2026-09-23 (row O-GLITCHTIP-CALLS-HAVE-NO-RETRY). The two
GlitchTip writes this lane runs, listed under the rule in the `# why:`
above `paths:` — the list names every script this lane RUNS.
`create-glitchtip-release.mjs` creates and finalizes the release;
`upload-web-sourcemaps.mjs` uploads the maps and reads them back. Both are
node scripts since this date, because each now retries a transient
origin error, and a change to that behaviour must redeploy like any other
script this lane executes. Like the two entries above, they are
deliberate rather than enforced: assert-deploy-triggers.mjs derives its
requirement from `tooling/ci/**` only.

⚠️ NOT LISTED, AND LEFT FOR A DECISION: `tooling/ops/bounded-retry.mjs`
(the retry plan both scripts import) and `tooling/ops/glitchtip-project.json`
(the declaration the create and upload steps read). Each changes what this
lane does with no edit to a file on the list. The PR that added the two
lines above names the gap without closing it.

### above `permissions:`

Least privilege. It deploys via a Cloudflare token, not GITHUB_TOKEN. [pipeline F-5b]

🔴 SCOPED DOWN 2026-08-07, AND THE REASON IS THE [10]D-2b REFACTOR ITSELF.
This block used to carry `checks: read` and `deployments: write` too, which was
correct while this lane was ONE job: workflow-level and job-level were the same
grant. Splitting it into `prepare` + `deploy-web` silently widened both — a job
that only emits an app list inherited the right to write GitHub Deployments.
`zizmor` caught it as `excessive-permissions` (high confidence) on the first CI
run after the merge, and it is a real finding, not noise: `prepare` runs a node
script whose input is repository content, on a lane that holds
CLOUDFLARE_API_TOKEN.

📌 The generalisable point: SPLITTING A JOB WIDENS EVERY WORKFLOW-LEVEL GRANT,
and nothing about the diff looks like a permissions change. The grants now sit
on the job that uses them — `checks: read` for assert-gate-passed, and
`deployments: write` for record-deployment.mjs — so the next split cannot
repeat this.

## job `prepare`

### above `prepare:`

── which apps does this factory hold? ──────────────────────────────────────
[10]D-2b, and identical to `prepare` in build-platforms.yml and e2e.yml on
purpose — deliberately reading through the SAME emitter, because
assert-release-lane-generic.mjs is the guard that grades all three lanes, so
the set they iterate and the set they are graded against cannot diverge.

It emits nothing on an empty workspace — it exits 1 — because a matrix of
`[]` runs zero legs and REPORTS SUCCESS. On a lane that deploys, that shape
is worse than a red build: it is a green tick over a production deploy that
never happened, which is the exact absence assert-deploy-triggers.mjs was
written against one level up.

## job `deploy-web`

### above `timeout-minutes: 35`

35 because this job carries BOTH halves: assert-gate-passed.mjs polls for up
to its own 1200 s default before the build starts (a shorter bound would kill
the poll and hide why the gate never arrived), and the build+deploy behind it
has been observed at 9m03s. 20 + 9 with a little air. [pipeline F-5b]

### key `permissions:`

### above `permissions:`

The two grants the workflow level no longer makes, held by the only job
that uses them: `checks: read` for assert-gate-passed.mjs (it reads
ci-gate's verdict) and `deployments: write` for record-deployment.mjs.
`contents: read` is restated because naming any permission here replaces
the workflow-level set outright rather than adding to it.

### key `strategy:`

### above `strategy:`

`fail-fast: false` because each leg is an independent DELIVERY, not a
stage of one: app #2 failing to build is no reason to cancel a deploy of
app #1 that has already uploaded and is waiting to be smoked and recorded.
With one app in the workspace this changes nothing.

### key `concurrency:`

### above `concurrency:`

⚠️ PER-APP, AND IT MOVED FROM THE WORKFLOW LEVEL TO GET THERE. A single
workflow-level `group: deploy-web` puts every matrix leg in ONE group with
`cancel-in-progress`, so app #2's leg would cancel app #1's mid-upload —
a half-published Pages project with a green-ish log. The group has to
carry the dimension the matrix iterates, and only a job-level
`concurrency:` can read `matrix`.

### key `with:`

### above `with:`

persist-credentials: false — actions/checkout otherwise writes GITHUB_TOKEN
into .git/config and LEAVES it there for the whole job. Any later step that
packages the workspace (or anything containing .git/) ships the token inside
the artifact, and on a PUBLIC repo artifacts are downloadable. Nothing here
does git push/tag/commit, so none of these checkouts need the credential.
[zizmor artipacked] Verified 2026-07-27: no current artifact path includes
.git/ — so this closes a FUTURE mistake, not a live leak.

## job `deploy-web`

### before step **Require ci-gate to have passed for this commit**

MUST be first. This workflow triggers on push to main with no dependency
on CI, so without this the deploy and the tests race — and the deploy
(~3 min) finishes first (~6 min). Also gates the manual redeploy button,
which previously consulted nothing at all. Fails closed. [pipeline F-5b]

### before step **The build's connect origins must equal the app's connect-src, before it is built**

⏱ 2026-09-25 — row O-WEB-CSP-HAND-LIST-UNSMOKED, the derivation half. Until
today `connect-src` in `apps/<id>/web/_headers` was a hand list of hosts, and
the launch smoke probed three origins passed to it by hand. Nothing compared
either list with what the build is configured to call.

`tooling/web/connect-origins.mjs --check` computes the set of origins the
build calls and requires it to EQUAL `connect-src` minus `'self'`:

- **the URL-valued defines** of the web build (`SUPABASE_URL`,
  `API_BASE_URL`, `GLITCHTIP_DSN`). Only the origin is kept; the DSN's key and
  path are dropped before anything is printed. ⏱ 2026-09-26 (lead ruling
  W37-R1): the build step types no `flutter build web` line any more, so the
  module finds the step's one `tooling/ci/flutter-release-build.mjs` call and
  reads the defines from that composer's `--print` for the same app, target and
  channel. A define composed as `$NAME` (`SUPABASE_URL`, `GLITCHTIP_DSN`) is
  read from this step's `env:`; `API_BASE_URL` is composed from the app's rule,
  so this step maps no `API_BASE_URL` and no secret holds it. A failing
  `--print`, or any count of composer web calls but one, is COVERAGE LOST.
- **`CONNECT_KEYS`**: the `app_config.dart` constants the app fetches from
  (`platformBaseUrl`, `configBaseUrl`). A key the file no longer declares is
  COVERAGE LOST (exit 2).
- **`DECLARED`**: origins `connect-src` carries ahead of the configuration.
  Today there is one `prestage` entry, `https://auth-api.nikatru.com` (#920).
  Once a define derives it, the step is red until the entry is deleted. The
  Phase 5 switch PR deletes it and adds the hosted Supabase origin as a
  `rollback` entry, which stays until Phase 6.

Either direction fails the step: a derived origin `connect-src` does not name
(the browser would refuse it), or a listed origin nothing derives. So does an
`app_config.dart` constant naming an https origin that is in neither
`CONNECT_KEYS` nor `LINK_KEYS`, a build define in neither `URL_DEFINES` nor
`VALUE_DEFINES`, an empty URL define, and a placeholder (`YOUR_…`) host.

It runs before the Flutter toolchain is even set up, so a mismatch costs
seconds, and nothing is built or published. On a pass it appends
`connect=--connect <origin> …` to `$GITHUB_OUTPUT`, and the launch smoke
probes exactly that set. It prints origins and define names, never a value.

### before step **Derive the release line from pubspec**

The version is DERIVED, never typed. `apps/<id>/pubspec.yaml` declares
the release line (`major.minor`) — the part a human owns — and this step
reads it with the SAME parser the guard uses, so the number that gets
built and the number that gets asserted cannot disagree. Before this
existed the workflow carried its own copy of "1.0.0", free to drift from
pubspec.

### before step **Build web (release, no service worker)**

🟢 **`TURNSTILE_SITE_KEY`, ADDED 2026-09-07, AND IT IS A REPOSITORY VARIABLE
RATHER THAN A SECRET ON PURPOSE** ([ADR 067] decision 6, unit
`cutover-blockers`; `runbooks/auth-cutover.md` §4 row 5 and §4.6). A Cloudflare
Turnstile SITE key is the public half of a pair — it only works by being IN the
page, and it is meaningless without the secret half, which lives on the auth box
as `CAPTCHA_SECRET` and never reaches this repository. Reading it from
`vars.` rather than `secrets.` is that fact written down where the next reader
will see it.

**WHY IT IS HERE BEFORE ANYTHING NEEDS IT.** The Phase 5 window already has to
carry three acts that must land together — the Workers' `SUPABASE_URL`, a web
deploy, and the `supabase_jwks` KV purge. A workflow edit inside that window
would be a fourth, made under time pressure, on the one lane that decides whether
anybody can sign in. With the line already merged, turning the app-side captcha
on is a repository VARIABLE being set: no code change, no workflow change, and it
can be done and undone in seconds.

**AND IT IS INERT UNTIL THEN, BY CONSTRUCTION.** `vars.TURNSTILE_SITE_KEY` is
unset today, so the define arrives EMPTY;
`apps/subscriptiontracker/lib/features/auth/turnstile_gate.dart` reads it as a
`String.fromEnvironment` with an empty default, `isConfigured` is false, the gate
renders `SizedBox.shrink()` and every caller's token stays null — byte-for-byte
today's deployed behaviour.

⏱ **2026-09-09 — THE PARAGRAPH ABOVE IS NO LONGER TRUE AND IS LEFT STANDING
BECAUSE THE SEQUENCE IS THE RECORD.** `vars.TURNSTILE_SITE_KEY` IS SET. Measured
with `gh variable list`: `TURNSTILE_SITE_KEY = 0x4AAAAAAEmJbm3bI8bk4wno`, set
`2026-09-07T06:09:24Z`. And it is not merely set in the repository — it is
COMPILED INTO THE LIVE BUNDLE: that literal appears in
`https://nikatru.com/subly/main.dart.js` fetched today, inside the `TurnstileGate`
widget constructor. The gate is live on the four gated auth screens.

🔴 **AND THAT MAKES THE WIDGET'S DOMAIN ALLOWLIST A LIVE DEFECT, NOT A TIDY-UP.**
`tooling/publishable-inputs.json` records the allowlist as `subly.nikatru.com +
localhost`. [ADR 075] moved the app's published address to `nikatru.com/subly/`.
A Turnstile widget validates the HOSTNAME the challenge is requested from against
that list, so on the address the app is actually served at, the challenge is
refused — sign-in, sign-up, forgot-password and resend-verification with it. The
allowlist was written when the app owned a whole origin and nothing re-read it
when the origin moved.

👤 **OWNER STEP — THIS IS A CLOUDFLARE DASHBOARD SETTING AND NO REPOSITORY EDIT
REACHES IT.** The site key is a `--dart-define` this workflow passes; the widget's
*domain list* lives only in the Turnstile console. Steps: Cloudflare dashboard →
account `nikatru` → **Turnstile** → the widget whose site key is
`0x4AAAAAAEmJbm3bI8bk4wno` → **Settings** → **Domains** → ADD `nikatru.com`.
⚠️ KEEP `subly.nikatru.com` — it is not dead: it is the 301 source and the apex
router's proxy origin (`tooling/monitor-register.json` records both), and removing
it would break the widget for anyone arriving through a legacy link before the
redirect completes. Keep `localhost` for `flutter run`. Net change: one domain
ADDED, none removed. No key rotation is required, so no redeploy is required.

⚠️ **THE ONE THING THAT MADE THIS SAFE WAS A MEASUREMENT, NOT AN ARGUMENT.** The
claim underneath it is that a hosted GoTrue IGNORES a captcha token it was never
configured to want, so a build carrying the key keeps working against the CURRENT
auth project. §4.6 recorded that as *"expected, not yet measured"*.
`tooling/e2e/captcha_posture.mjs` now measures it on every `E2E live` run and
fails the run if hosted ever starts enforcing a gate — which would be the
warning that a deploy is about to ship a build nobody can sign in to.

⚫ **THIS IS NOT THE CUTOVER.** Adding the define moves no Worker secret, purges
no KV key and points nothing at Box A.

VERSIONING. `github.run_number` supplies BOTH the patch and the build
number, because it is the only monotonic value the lane has. Re-running a
run does not bump it, so the same commit rebuilds to the same version.

⚠️ IT IS PER-WORKFLOW-FILE AND SHARED ACROSS MATRIX LEGS. Every app
deployed by one run therefore carries the same build number. That is
correct for the two things it feeds — the kill-switch floor compares
`major.minor.patch` per app against that app's own `min_supported_
version`, and version.json is per Pages project — and it is why the
post-deploy smoke below can join on it. It also means renaming this FILE
restarts the counter at 1 for every app at once; see the note in
assert-app-versioning.mjs before ever doing that.

Why the PATCH and not just the build number: version_gate.dart:32 splits
the running version on `+` and compares only `major.minor.patch` against
`min_supported_version`. While the patch was frozen at 0 there was no
floor the owner could set that separated an old client from a new one —
the CFG-1 force-update kill-switch was inert on the only live channel.
--build-number is the same value, and is what Play reads as versionCode;
it must strictly increase or a second upload is rejected outright.

APP_VERSION is not decoration: it is the `app_version` field on every
analytics row and every consent artifact. Without it the build defaults
to 'dev', so production data would be indistinguishable from a developer
laptop and no regression could ever be attributed to a release. It keeps
the short SHA in the build metadata after `+` — a SHA is traceable but
NOT ORDERED, so it can identify a build and never rank two of them. Its
version core is the same string as --build-name on purpose: the number the
store shows and the number the kill-switch compares must be one number.

RELEASE_CHANNEL is [pipeline 9]R-10's third limb and it stays COMPILE-TIME
on purpose, unlike `update_url` which owner decision #19 moved to runtime.
The two look alike and are opposites: an update DESTINATION baked into a
binary means shipping an update to change where updates come from, while
the CHANNEL is a fact about the binary — the same commit built for `web`
and for `windows-store` differs in nothing else, so a runtime value could
not tell the two artifacts apart. Every value passed here must resolve to
a row id in tooling/channel-register.json; assert-channel-register.mjs
fails the build on `webb`, which is the one failure mode a free-text
string has. It is the CHANNEL, not the app, so it is a literal here and
correctly so: this whole file is the web channel.

⬜ `--pwa-strategy=none` is [ADR 023] (LOCKED 2026-07-31), not an
oversight: no service worker, no offline support, and the HTTP cache is
therefore the whole update mechanism on this channel — which is why
`apps/<id>/web/_headers` exists and why assert-web-cache-policy.mjs
asserts it. ADR 023 explicitly REJECTS guarding this flag in CI as
over-encoding; this citation is the consequence it did ask for.

⏱ **2026-09-09 — THE BOOT PATH FETCHES FIVE EXTERNAL ORIGINS, AND THE APP SAYS IT
FETCHES NONE.** [ADR 075]'s CSP work named three; a live read names five. This is
the measurement, not a build log — a green build is not evidence of what a browser
asks for. `https://nikatru.com/subly/` was loaded in a real browser and
`performance.getEntriesByType('resource')` read back, which is the only source
that sees a cross-origin fetch a same-origin network log misses (that is how the
fourth origin below stayed invisible):

| origin | what it fetched | why |
|---|---|---|
| `https://www.gstatic.com` | `/flutter-canvaskit/<engineRevision>/chromium/canvaskit.js` + `.wasm` | the CanvasKit engine |
| `https://fonts.gstatic.com` | `/s/roboto/v32/…woff2`, `/s/notosanssymbols2/v24/…woff2` | the engine's font FALLBACK |
| `https://browser.sentry-cdn.com` | `/10.38.0/bundle.tracing.min.js` | `sentry_flutter`'s web JS SDK |
| `https://static.cloudflareinsights.com` | `/beacon.min.js/…` (twice) | Cloudflare Web Analytics, injected at the EDGE |
| `https://config.nikatru.com` | `/config/subly` | first-party, expected |

🔴 **`static.cloudflareinsights.com` IS THE ONE NOBODY DECLARED, AND IT IS BEING
BLOCKED RIGHT NOW.** It is in no build output and no source file — Cloudflare
injects it into the HTML response, so it cannot be found by reading this
repository. The browser console on the live page reports it BLOCKED by the app's
own `script-src`. So the state today is a third-party analytics beacon that the
zone is trying to add and the app is refusing: the refusal is the right outcome,
but it is an accident rather than a decision, and it is not written down anywhere
until this line. Either turn Web Analytics OFF for this zone (owner, dashboard) or
declare it — silently failing on every page load is the one option that should not
stand.

**THE LEVERS, EACH ESTABLISHED FROM SOURCE RATHER THAN ASSUMED:**

* **CanvasKit** — `flutter build web --no-web-resources-cdn`. VERIFIED in the SDK
  on this machine: `flutter_command.dart:1479` sets `useLocalCanvasKit` from the
  flag, `build_info.dart:378` turns it into `kUseLocalCanvasKitFlag`, and
  `web.dart:691` emits `'useLocalCanvasKit': true` into `_flutter.buildConfig`.
  The deployed `flutter_bootstrap.js` carries NO such key today, which is why its
  `canvasKitBaseUrl` falls through to `https://www.gstatic.com/flutter-canvaskit`.
  `/canvaskit/*` already ships in this bundle and is already declared in
  `apps/<id>/web/_headers`. This one is a one-flag change.
* 🔴 **THE FONT FALLBACK IS NOT COVERED BY THAT FLAG, AND ASSUMING IT WAS IS THE
  EASY MISTAKE HERE.** `--no-web-resources-cdn` sets `useLocalCanvasKit` and
  nothing else. The fallback base is a SEPARATE engine setting,
  `FlutterConfiguration.fontFallbackBaseUrl`, defaulting to
  `https://fonts.gstatic.com/s/` — visible in the deployed `main.dart.js` as
  `s.fontFallbackBaseUrl … return s==null?"https://fonts.gstatic.com/s/":s`.
  Closing it means self-hosting the Noto fallback set in the engine's own `/s/`
  layout and passing `fontFallbackBaseUrl` through the bootstrap's `config`. It is
  a real hosting decision, not a flag.
* 🔴 **SENTRY HAS NO SUPPORTED FIX, AND THE OBVIOUS ONE SILENTLY DELETES CRASH
  REPORTING.** `sentry_flutter-9.27.0` hard-codes the URL: `productionScripts` in
  `lib/src/web/sentry_js_bundle.dart` is a `const`, so it cannot be re-pointed at a
  self-hosted copy. The only public switch is
  `options.autoInitializeNativeSdk = false`, which does stop
  `WebSdkIntegration` injecting the script — **and it must not be used on its own.**
  `sentry_flutter.dart:139-141` installs `JavascriptTransport` on web whenever the
  binding supports capture-envelope, BEFORE the user's options callback runs and
  WITHOUT consulting that flag. So the transport would keep handing envelopes to a
  JS SDK that was never loaded: no script, no events, no error. Restoring the Dart
  HTTP transport from app code is not possible either — `SentryClient` only
  installs `HttpTransport` when `options.transport is NoOpTransport`, and neither
  `NoOpTransport` nor `HttpTransport` is exported from `package:sentry/sentry.dart`
  (only the abstract `Transport` is). The honest options are: (a) drop
  `sentry_flutter` on the web target and initialise pure-Dart `package:sentry`
  behind the existing `packages/telemetry` facade, which has no CDN dependency at
  all — the architecturally clean answer and the one worth costing; (b) vendor or
  patch the package; (c) keep the CDN and say so. What must NOT happen is (a')
  flipping the flag and shipping it, which reads as a fix and is an outage.

**OWED, AND NOT LANDED HERE ON PURPOSE.** The three edits this needs —
`--no-web-resources-cdn` on the build line below, the `script-src`/`connect-src`
trim in `apps/<id>/web/_headers`, and the paragraph in `apps/<id>/web/index.html`
that claims "no third party on the boot path" — all sit in files the in-flight
slug rename (PR #567, `apps/subly` → `apps/subscriptiontracker`, currently DIRTY)
is rewriting, including this workflow. Landing them now would collide in files
that PR is already rebasing. They are written up here rather than attempted, and
the measurement above is what makes them a one-sitting change afterwards.

⏱ **2026-09-12 — CANVASKIT AND THE FONT FALLBACK ARE CLOSED (W5); SENTRY IS NOT YET.**
The build line now carries `--no-web-resources-cdn`. `apps/<id>/web/flutter_bootstrap.js`
(Flutter's documented bootstrap template) passes `fontFallbackBaseUrl: "fallback-fonts/"`,
relative so it resolves under `<base href>`. The step after `setup-node`,
`tooling/web/self-host-fallback-fonts.mjs`, reads the engine's fallback list OUT OF THE
BUILT `main.dart.js` (725 files, 21,803,256 B on Flutter 3.47.2), copies each file into
`build/web/fallback-fonts/` pinned by `tooling/web/fallback-fonts.lock.json`, and refuses the
bundle if either setting is missing. It runs BEFORE the launch smoke on purpose: the engine
fetches Roboto from that base on every boot, so a missing copy is a 404 the smoke already
fails on. A missing copy must never reach production, because the apex router answers an
unknown app path with the SPA shell (200, `text/html`), and the engine would silently draw
empty boxes. `www.gstatic.com` and `fonts.gstatic.com` are out of the app CSP. The fonts are
fetched from Google by the RUNNER at build time, and no visitor request goes there. A Flutter
upgrade that rolls the list fails that step by name, and the fix is `--write-lock` plus a
reviewed diff. `browser.sentry-cdn.com` is the remaining boot-path third party.

⏱ **2026-09-12 — SENTRY'S CDN IS CLOSED TOO (W5).** Option (a) above, in its smallest
form: `packages/telemetry` keeps `sentry_flutter` (every Flutter integration stays) and,
on web only, sets `autoInitializeNativeSdk = false` AND replaces the transport with the
SDK's own `HttpTransport` (`useHttpTransportOnWeb`). The second half is what prevents
the (a') outage described above. Events POST to the DSN host, which is already in
`connect-src`, and GlitchTip answers the CORS preflight for `x-sentry-auth`. The browser
no longer loads `bundle.tracing.min.js`, and the app CSP names no third-party CDN.

### in step **Build web (release, no service worker)**, above `- uses: ./.github/actions/setup-node`

── [pipeline 9]R-13 · THE ARTIFACT IS STARTED ONCE, BEFORE PUBLICATION ──
Every other gate in this repository proves a build COMPLETES and stops
there. Until this step existed nothing in the tree had EVER run a built
artifact: build-platforms.yml uploads six builds without launching one,
ci.yml analyzes and unit-tests a stamped app without starting it, and
e2e.yml drives a DEBUG `web-server` target — not the released bundle. So
a build producing a non-starting artifact was green everywhere: a wrong
`base href`, an asset declared in pubspec and missing from build/web, an
exception thrown in main() before the first frame. Each fails at first
launch and NOWHERE EARLIER.

⚠️ IT SITS HERE, BETWEEN THE BUILD AND THE DEPLOY, AND THAT PLACEMENT IS
THE REQUIREMENT. R-13's subject is the artifact BEFORE publication, where
there is nothing to roll back because nothing has shipped; smoking after
the deploy is `[14]O-7`'s question, asked of users. Duplicate D-14 was
re-confirmed on that distinction, and assert-launch-smoke.mjs fails the
build if this step ever moves below the deploy.

The signal is `flutter-first-frame`, dispatched by the engine once the
first frame has been RASTERIZED — so it is true only after main() ran to
completion and runApp produced a frame. Not a zero exit code (headless
Chrome exits 0 on a page that rendered nothing) and not a DOM node the
engine creates during bootstrap (those exist even when the app's first
build throws).

No new action and no chromedriver: the script speaks the DevTools
Protocol over Node's built-in WebSocket and finds the Chrome the runner
image already ships — the same binary e2e.yml drives nightly. `setup-node`
is explicit because that WebSocket needs Node >= 22 and the smoke must
never fail for the harness's own reasons.

⏱ 2026-09-24 — THE SMOKE BOOTS THE BUNDLE UNDER ITS OWN CONTENT-SECURITY-POLICY
(row O-WEB-CSP-HAND-LIST-UNSMOKED). The local server now answers every file
with the headers the bundle's `_headers` gives it, so the app starts under the
same policy Cloudflare Pages will serve. Two things then fail the step:

- **A violation while it boots.** A `securitypolicyviolation` listener is
  installed before the page loads; any refusal before the first frame is
  exit 1, naming the directive and the blocked URI.
- **A `--connect` origin the policy refuses.** The step passes three:
  `SUPABASE_URL`, `API_BASE_URL` and `GLITCHTIP_DSN` (only its origin is
  kept; the key part is dropped). After the first frame, the page fetches
  each origin. A `connect-src` refusal is exit 1, naming the directive and
  the origin.

Exit 2 is COVERAGE LOST: the bundle carries no `_headers`, the `_headers`
puts no Content-Security-Policy on `/`, or it holds a line the parser does
not model. None of those is a pass.

The probe requests never leave the browser. Each probe origin is paused by
DevTools `Fetch` interception and answered locally with a 204. The smoke
also fails if a probe was NOT paused, so an interception pattern that stops
matching is red rather than a request to production. `--connect` accepts
https origins only: `upgrade-insecure-requests` would rewrite an http probe
to https, past the pattern. What this does not cover:

- Chrome's own background traffic to Google hosts still leaves the runner,
  as it did before.
- The log shows the Supabase origin as `***`, because GitHub masks any value
  equal to a secret.
- Until E1b, every app is probed with the repository-wide `API_BASE_URL`, so
  a stamped app with no backend stops here on that origin.

⏱ 2026-09-25 — E1b. The three hand-passed `--connect` flags are gone. The
smoke now probes the set the connect-src compare emitted (the step before the
Flutter setup, above), so it needs no secret in its own `env:`. The
repository-wide `API_BASE_URL` is still one of the derived defines, so a
stamped app with no backend now stops at that compare, before its build.

⏱ 2026-09-26 — O-FLUTTER-BUILD-TYPED-PER-LINE. `API_BASE_URL` is no longer a
repository secret: `tooling/ci/flutter-release-build.mjs` composes it from the
app's `hosts.api` in its `app.yaml`, else the shared platform API. The compare
reads that composed value through the composer's `--print`, and the step before
the build writes the same rule's value to `$GITHUB_ENV` with `--emit-env`. For
a stamped app with no API host of its own, the derived API origin is the
platform API's.

### before step **Install glitchtip-cli (pinned by version AND by digest)**

⏱ 2026-09-25 (O-GLITCHTIP-CLI-INSTALLED-BY-HAND) — the step is ONE call now,
`node tooling/ci/install-pinned-tool.mjs glitchtip-cli --out "$RUNNER_TEMP"`, as it is
on every other lane that installs the client (ten steps, seven workflows, three runner
OSes). The version and the linux digest are read from tooling/versions.json exactly as
before; the installer adds a bounded retry and holds the binary's `--version` to the
pin. `tooling/ci/install-pinned-tool.mjs` joined `deployUnits["<app>-web"]` in
tooling/ci/lane-map.json, because this lane now runs it. P7 of
install-pinned-tool.test.mjs refuses a hand install of any TOOLS member.

── SOURCE MAPS · INSTALL AND INJECT, BEFORE THE ARTIFACT IS SMOKED ─────
🔴 WHAT THIS PAIR OF STEPS BUYS, MEASURED 2026-09-03 AND NOT INFERRED.
`GET /api/0/organizations/nikatru/releases/{version}/files/` answered 200
with a ZERO-LENGTH list for ALL TWELVE releases GlitchTip holds for
`subscriptiontracker`, and `dsyms` was `[]`. Nothing had ever been uploaded, and
nothing could have been: `flutter build web --release` emits no source
maps at all. Two OPEN, UNRESOLVED production issues are the bill —
`minified:a0X: GoError: There is nothing to pop` (4 occurrences, level
fatal) and `minified:ng: AuthException(...)` — whose frames read
`main.dart.js k7.er 63099`, `aQU.$0 130674`, `JY.hG 116903`. That is a
crash sink that receives everything and explains nothing.

⚠️ THEY SIT ABOVE THE SMOKE ON PURPOSE, AND THAT IS [pipeline 9]R-13's
RULE, NOT A PREFERENCE. `sourcemaps inject` REWRITES `main.dart.js` —
it prepends a debug-id snippet and adds a `//# debugId=` trailer — so
running it after the smoke would publish an artifact that was never
launched. R-13's subject is the bytes that ship; anything that edits
them belongs above it. The upload and the deletion below edit nothing
the browser executes, so they sit under it.

### before step **Inject debug ids into the web bundle**

Debug ids are the STRONGEST key GlitchTip has: `DebugSymbolBundle` is
unique on `(organization, debug_id)`, and unlike a release string a
debug id cannot drift from what the SDK reports — it is derived from the
bytes. Without one the server falls back to `(release, file name)`,
which still works and is why the upload below passes `--release`
regardless. This is the one part of glitchtip-cli's source-map support
that is purely local and provably correct; see the header of
tooling/ops/upload-web-sourcemaps.mjs for why `sourcemaps upload` is not
used and what it does instead of uploading.

### before step **Create and finalize the GlitchTip release**

── SOURCE MAPS · THE RELEASE EXISTS BEFORE ANY FILE IS HUNG OFF IT ─────
glitchtip-backend#299 ("release not found error on sourcemap file
upload") is the failure this closes. The assemble endpoint does
`Release.objects.get_or_create`, so this is belt AND braces rather than
strictly required — but a release created as a side effect of an upload
has no `dateReleased`, and the deploys/finalize path is what puts one
there. It is idempotent: creating a release that exists is a no-op.

⚠️ THE SERVER ADDRESS IS DERIVED FROM THE DSN, NEVER TYPED. The maps have
to land on the SAME instance the shipped bundle reports to; a second
literal is a second thing to drift, and the drift would be silent —
uploads succeeding against a server that never sees the events. The DSN
already reaches this job (the build step passes it as a --dart-define),
and its origin is exactly that server.

🔴 AND IT GOES IN AS `SENTRY_URL`, NOT AS `--url`. Measured by running
the binary on 2026-09-03: `glitchtip-cli releases new --url` is
"Optional URL for this release" and SHADOWS the global server flag, so
passing the address there posts the release to sentry.io instead. The
environment variable is not shadowed by anything.

⏱ APPENDED 2026-09-23 — THE CLI NO LONGER CREATES THE RELEASE; A NODE
SCRIPT DOES, AND IT RETRIES. The paragraphs above are kept as written.
deploy-web run 35831511489 (main f64cd921) went red at this step on one
line and nothing else:

    error: Failed to create release: POST https://glitchtip.nikatru.com/api/0/organizations/nikatru/releases/ returned 522 <unknown status code>: error code: 522

A 522 is Cloudflare reporting that the origin did not answer in time — a
blip on the path, not an answer about the release — and
`glitchtip-cli releases new` has no retry, so one dropped request failed
the deploy. The step now runs `tooling/ops/create-glitchtip-release.mjs`,
which sends the CLI's own request (the body read from the pinned v1.0.0
`releases.rs`: version, projects, dateStarted and dateReleased, stamped
ONCE per run) through `fetchWithBoundedRetry` in
`tooling/ops/bounded-retry.mjs` — 3 attempts, gaps of 1 s then 2 s, a
15 s ceiling per attempt, no per-call override. The server still arrives
as `SENTRY_URL`, derived from the DSN exactly as above; the `--url`
trap no longer applies because the CLI is not called here.

"It is idempotent" above was a reading of the server; it is now a
measurement. Re-POSTing an existing release on the live instance on
2026-09-23 (the parent session's probe, `idempotency-measured.md`):

    POST again 201 body.version subscriptiontracker@1.0.439+d90dbfc body.dateCreated 2026-09-23T08:30:42.841Z
    GET after 200 dateCreated 2026-09-23T08:30:42.841Z dateReleased 2026-09-23T08:30:41.942Z
    rows with this version after 1 list n 50
    VERDICT IDEMPOTENT (2xx, one row, dates unchanged)

So a retry after a request the origin DID act on makes no second row and
moves no date. ⚠️ Not measured: a re-POST carrying a NEWER dateReleased
(what a whole-job re-run sends, since the stamp is per run), and that
probe's body omitted dateStarted. A retry inside one run re-sends the
same bytes, so neither gap reaches the retry itself.

The guard that keeps it this way: refusal 5 of
tooling/ci/assert-glitchtip-project.mjs refuses a GlitchTip network call
(`releases`, a `debug-files`/`sourcemaps` upload, or an HTTP client on
`/api/0/`) run bare from any workflow step.

### before step **Upload the source maps to GlitchTip**

── SOURCE MAPS · UPLOADED, AND PROVEN UPLOADED ─────────────────────────
⛔ DO NOT REPLACE THIS WITH `glitchtip-cli sourcemaps upload`. It was
tried first and it does not work against this server: it POSTs a gzipped
single file where the backend expects a zip artifact bundle, the
assemble endpoint answers `{"state":"created"}` before the async task
runs, and the task then logs "not a valid zip archive" and deletes
everything — a green step that stores nothing, which is the same defect
as the sentry-cli reports (glitchtip#38, backend#299) that sent us to
the CLI in the first place. The full citation, read from both projects'
sources and reproduced against a protocol stub, is in the header of
tooling/ops/upload-web-sourcemaps.mjs.

THE SCRIPT ENDS BY READING BACK `GET .../releases/{version}/files/` —
the exact call whose empty answer is the defect — and exits non-zero
while it stays empty. So this step cannot be green over an empty sink.

⏱ APPENDED 2026-09-23 (row O-GLITCHTIP-CALLS-HAVE-NO-RETRY). Every
request this script makes — the chunk-upload options GET, the chunk
POST, the assemble POST and the read-back — now goes through
`fetchWithBoundedRetry` (tooling/ops/bounded-retry.mjs, the same plan the
create step uses). The 522 that failed run 35831511489 one step earlier
is a 5xx, and this step talks to the same origin. The two POSTs are safe
to re-send: a chunk is stored under the sha1 of its own bytes, assemble
is keyed by the same `{checksum, chunks}` on every attempt, and the
read-back judges what the server HOLDS, so a re-send that stored nothing
still fails. ⚠️ What the server does with a SECOND assemble of the same
checksum was not measured live. The last green run of this step took
5 s (deploy-web run 35836688646) against a 15 s ceiling per attempt.

### before step **Delete the source maps from the bundle that gets published**

── ⛔ THE MAPS ARE UPLOADED, THEY ARE NOT PUBLISHED ─────────────────────
`wrangler pages deploy build/web` uploads EVERY file in that directory,
so without this step `main.dart.js.map` would be served from
https://<app>.nikatru.com/main.dart.js.map to anyone who asks. A Dart
source map carries `sourcesContent` — the ORIGINAL SOURCE of every
compiled library, this app's `lib/` included. That is a publication
decision nobody made, and it is not covered by `_headers`, which sets
cache policy and cannot remove a file from a deploy.

DELETION, NOT AN IGNORE FILE, AND THE DIFFERENCE IS THE POINT. Pages
honours no `.gitignore`, and whether a given wrangler honours an
`.assetsignore` for a Direct Upload project is a property of the version
the action installs. A file that is not on disk cannot be uploaded by
any version of anything, so this is the only form of the rule that
cannot quietly stop applying.

It runs AFTER the upload and BEFORE the deploy, which is the only window
where both are true. The `//# sourceMappingURL=` comment stays in
main.dart.js and will 404 for anyone who opens devtools against
production; that is deliberate and harmless — the map is meant to be
readable by GlitchTip, not by the page.

### before step **Ensure the Pages project exists (Direct Upload, idempotent)**

── [10]D-2b limb (b) · THE PAGES PROJECT IS CREATED, NOT ASSUMED ────────
🔴 THE PREVIOUS VERSION OF THIS FILE SAID "uploads the built site to the
EXISTING Cloudflare Pages project" — and that word was the whole gap.
`wrangler pages deploy --project-name=<id>` against a project that does
not exist fails at the API, so app #2's very first deploy died on a
console step nothing in this repository named. A delivery path that
"takes any app id" has to be able to run TWICE for a NEW id: once to
make the target, once to fill it.

⚠️ DIRECT UPLOAD, NEVER GIT-CONNECTED, and this is an architectural cap
rather than a preference: Cloudflare allows a limited number of
Git-connected Pages projects per repository, and this monorepo already
spends them on the static sites. A Git-connected project per app does
not reach app #6. `pages project create` with no `--github`/`--gitlab`
flag creates exactly a Direct Upload project, which is what the deploy
step below uploads into.

IDEMPOTENT BY CONSTRUCTION. `create` on an existing project answers with
a "already exists" error, which on every run after the first is the
CORRECT state and must not fail the job. Any OTHER non-zero exit —
a bad token, a quota, an account id typo — still fails, so this is not a
`continue-on-error` in disguise: the tolerated case is enumerated and
everything else is red.

TWO STRANDS, EITHER ONE SUFFICIENT. The `|` in the match below is the
design, not an accident. The English substring goes stale the day
Cloudflare rewords or localises the message; the numeric code goes stale
the day the API renumbers it. Neither is trusted to outlive the other,
so each alternative is written to carry the whole tolerance ALONE — an
"already exists" line with the code absent still passes, and the code
with a completely reworded message still passes.

🔴 WHERE 8000002 COMES FROM, AND WHY IT IS THE ONLY CODE HERE.
SOURCE: observed run 32962146010, job "Build & deploy web to Cloudflare
Pages (subscriptiontracker)", THIS step's log —
    A project with this name already exists. Choose a different project
    name. [code: 8000002]
That run is the ONLY source. Cloudflare publishes no error-code table
for Pages — the developers.cloudflare.com "API error codes" reference
covers AI Search, and the Pages docs enumerate nothing — so this literal
is grounded in an observation, not a document. That is precisely why the
message strand above has to keep standing on its own: if a later API
version renumbers this, the reworded-message case is what survives.

8000007 WAS REMOVED, AND IT WAS NOT FICTION — IT IS A REAL PAGES CODE
FOR THE OPPOSITE CONDITION: "Project not found. The specified project
name does not match any of your existing projects." (reported against
`pages deploy` in cloudflare/workers-sdk #12203). Tolerating it HERE
would have turned a genuinely ABSENT project green. It never did harm
only because `project create` cannot raise it — which is also why
nothing in this repo ever cited it: `grep -rn 8000007` found this line
and nothing else. A code that can only ever mis-fire is not spare
coverage, it is a trap for the next reader.

8000000 IS DELIBERATELY NOT ENUMERATED. Older wrangler surfaced this
same already-exists conflict as 8000000 (workers-sdk #3527), so a reader
who searches will be tempted to add it as a second tolerated code. Do
not. 8000000 is Cloudflare's generic "an unknown error occurred" bucket
— it is also what control-plane 500s and Pages outages return. Adding
it would swallow exactly the failures the paragraph above promises stay
red. If a future run shows the conflict arriving as 8000000 again, the
answer is the message strand, not a wider code list.

⚠️ THE APP ID GOES THROUGH `env:`, NOT INTO THE SCRIPT BODY. A
`${{ }}` interpolated straight into a `run:` block is the template
injection zizmor flags; the value is ours today, and the habit is what
survives the day it is not.

The wrangler version is READ FROM tooling/versions.json rather than
written here. A second literal would be a second thing to drift, and
assert-version-consistency.mjs only polices `wranglerVersion:` inputs —
an `npx wrangler@<literal>` would sit outside its rules entirely, which
is how production ended up on 3.90.0 while the repo declared 4.114.0.

### before step **Resolve this app's published origin from the catalogue**

── the published origin, RESOLVED from the catalogue ────────────────────
`sites/_shared/_data/apps.json` is the stamp's own output ([3]S-7) and is
already the SSoT `tooling/monitor-register.json` derives every watched
hostname from (`_derivation.appCatalogue`). So it is where "where does
app <id> live" is answered, and the emitter is the guard that ASSERTS
those URLs answer — assert-catalog-reachable.mjs. Same discipline as the
matrix above: the reader that grades the fact and the reader that uses it
are one function in one file.

It runs BEFORE the deploy on purpose. If the catalogue does not know this
app's origin, the run must stop while nothing has shipped — resolving it
afterwards would leave a published bundle that cannot be smoked and
cannot be recorded, which is precisely the un-probed publish [14]O-7
exists to end.

### before step **Deploy to Cloudflare Pages**

`id:` IS LOAD-BEARING, NOT DECORATION. The record step at the bottom of
this job keys off `steps.deploy.outcome`, so the bytes reaching
Cloudflare is the fact that decides whether a provenance record gets
written. Renaming or removing this id silently turns that condition into
`steps..outcome == 'success'` — an expression GitHub evaluates to false
rather than erroring — so the record would stop being written and the run
would still be green. tooling/ci/assert-publish-records.mjs refuses a
record step whose `if:` names a step id that this job does not declare.

### in step **Deploy to Cloudflare Pages**, above `wranglerVersion: '4.120.0'`

PINNED 2026-07-28. Without this the action resolves wrangler from the
package.json in workingDirectory — and a Flutter app has none, so it
installed the version baked into the action's own bundle
(3.90.0, live-proven in run 30292045671) while both Workers locked 4.114.0.
Must equal tooling/versions.json "wrangler"; assert-version-consistency
fails the build if it drifts, or if this line disappears. [pipeline F-2, F-11]

### before step **Smoke — the live site serves THIS build**

── [pipeline 14]O-7 · THE DEPLOY IS NOT TRUSTED UNTIL THE SITE AGREES ──
🔴 BEFORE THIS STEP, THE LAST THING EVERY DEPLOY JOB DID WAS WRITE A
CLAIM. `record-deployment.mjs` below records "<app>-web is live at
<sha>" — and no workflow in this repository had ever performed a single
request against a surface it had just deployed. An upload that went to
the wrong project, shipped nothing, or was rolled back by the platform
produced a green tick AND a deployment record naming the new SHA.

IT STILL RUNS BEFORE THE RECORD, BUT IT NO LONGER GATES IT — AMENDED
2026-08-09. This note used to read "recording first and verifying second
would leave a marker asserting a state that was never true", and the
ordering is unchanged. What changed is the CONDITION on the record step
below: it now keys off the DEPLOY step's outcome, so a smoke that fails
after the bytes shipped no longer erases the ledger entry for them. Run
144 (2026-08-08) is why — see the long block on that step. The two
questions are genuinely different: this one asks "does the live surface
answer with this build YET", the record answers "which bytes are on that
origin". A propagation race can make the first false while the second
stays true, and the marker that goes missing in that window is the one
an incident needs.

⚠️ THE JOIN KEY IS THE RUN NUMBER, NOT THE SHA. `version.json` carries
`build_number`; the SHA appears only inside `main.dart.js`. The build
step above passes `--build-number=${{ github.run_number }}`, so this
asserts against the field that is actually there rather than the one it
would be tidier to have.

⚠️ THIS IS NOT A SECOND COPY OF [9]R-13's LAUNCH SMOKE, and the two must
not be merged. R-13 serves `build/web` on loopback BEFORE the deploy and
requires `flutter-first-frame` — it answers "do these bytes RUN?". This
answers "did those bytes REACH PRODUCTION?", over the network, after the
upload. Each is green in the exact situation the other catches: a bundle
that starts perfectly and was uploaded to the wrong project, and a
correct upload of a bundle that throws in `main()`. They compose, and
the order — launch smoke, deploy, post-deploy smoke — is the composition.

### before step **Record the deployed SHA**

"What is live right now?" must be answerable without inference.
CLAUDE.md: never assert done/live/working from memory. [pipeline F-5b]

`<app>-web` is the channel register's `deploymentEnvironment` template
(`{app}-web`) expanded over this leg — the same expansion
assert-publish-records.mjs performs to decide which environments a served
channel's lane MUST record. The `-web` half is a literal because this
file IS the web channel; the `{app}` half never is.

── 🔴 THE RECORD FOLLOWS THE DEPLOY, NOT THE SMOKE (2026-08-09) ─────────
MEASURED FAILURE, run 144 (2026-08-08): `Deploy to Cloudflare Pages`
SUCCEEDED at 16:08:58Z, the post-deploy smoke above gave up 51 s later
while the CDN was still propagating, and this step — on the default
`success()` condition every step inherits — was therefore SKIPPED. The
bundle was live and served real users (a consent artifact and two events
carrying 1.0.144+40c0787 arrived 42 minutes later), and nothing in the
ledger said so. Runs 145/146 were concurrency-cancelled, so that
unrecorded build stayed live, and the daily provenance monitor correctly
reported real people's rows as unattributable. Repairing it took a
retroactive attestation (PR #266) — a hand-written entry standing in for
a machine record that a five-word condition would have produced.

📌 THE GENERALISABLE POINT: A PROVENANCE RECORD MUST BE CONDITIONED ON
THE ACT IT DESCRIBES, NEVER ON A LATER VERDICT ABOUT THAT ACT. This step
answers "which bytes are on that origin" — a question the wrangler upload
settles by itself. The smoke answers a different question ("do those
bytes ANSWER yet") and may be wrong about the first one, because a smoke
can fail for reasons that have nothing to do with what was uploaded:
propagation, a flaky DNS hop, an edge cache. Making the record wait on it
meant every such failure produced the one state this whole ledger exists
to abolish — something live that nothing can name.

⚠️ IT DOES NOT SOFTEN THE SMOKE. A failed step still fails the job; an
`if: always()` step running afterwards cannot rescue it. So the run is
still RED and still demands a human, and the difference is only that the
red run now leaves a traceable deploy behind instead of an orphan.

⚠️ IT IS A STRICT WIDENING, WHICH IS WHY IT IS SAFE. The default
condition is `success()` — every preceding step green, WHICH INCLUDES
`deploy`. So every run that recorded before still records, plus the runs
that deployed and then failed later. There is no input on which this
records LESS. `steps.deploy.outcome` (not `conclusion`) is the raw result
before any `continue-on-error` rewriting; the two are identical here
because that step carries none, and `outcome` is the form e2e.yml's purge
steps already use.

⚠️ `always()` INCLUDES CANCELLATION, and that is wanted here rather than
tolerated. The job-level `concurrency: cancel-in-progress` above means a
newer push can cancel this leg mid-run — and runs 145 and 146 were
cancelled exactly that way on 2026-08-08 while 144's bundle stayed live.
A leg cancelled AFTER its upload succeeded has still published something,
so it must still say what. `!cancelled()` would re-open the hole.

## job `site` — ⏱ 2026-09-25 (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE, D3a)

The apex site `sites/nikatru` publishes through this file too, by Direct Upload, to a NEW Pages
project `nikatru-apex`. It is proven on `https://nikatru-apex.pages.dev` while `nikatru.com` stays
on the Git-connected project `nikatru`. The owner moves the domain after the first green smoke,
and D3b then points the smoke and the record at `nikatru.com`. ⏱ 2026-09-26 · D3b: the job
smokes and records `https://nikatru.com`; `sitemap.xml` is generated here and no longer committed
(ci.yml's `sites` job generates it before grading), and site-drift-repair.yml is retired. The unit is
`deployUnits["nikatru-site"]`, recorded under the ledger environment `nikatru-site`, a
`siteEnvironments` row in `tooling/channel-register.json` (`kind: "site"`: no published-id flag,
and `rollback.mjs` does not re-promote it).

Steps: ref check → plan → `generate-discovery.mjs` → `check-site-integrity.mjs . sites/nikatru` →
stage `sites/nikatru` into `build/nikatru-apex` and write `version.json` = `{sha, build_number}` there →
`assert-site-bindings.mjs --fill-kv-id --out build/nikatru-apex` → ensure the project →
`wrangler pages secret put SUBSCRIBE_RATE_LIMIT_SALT` through stdin → deploy from `build/nikatru-apex` →
`tooling/sites/smoke-site-deploy.mjs` → record.

### 🔴 the config is NOT in sites/nikatru, and the deploy runs from a staged copy

`sites/nikatru` is the ROOT directory of the Git-connected project `nikatru` that serves
`nikatru.com` (README: root `sites/nikatru`, output `/`). Cloudflare Pages reads a wrangler
config that carries `pages_build_output_dir` in a project's root as that project's configuration
(Cloudflare's documentation; not measured here). The D3a design put `sites/nikatru/wrangler.toml`
there. The next Git build of `nikatru.com` would then have read a placeholder KV id and the name
`nikatru-apex` as its own. So the config is `tooling/sites/nikatru-apex/wrangler.jsonc`. The job
copies `sites/nikatru` into `build/nikatru-apex` (gitignored by `**/build/`), writes the
filled config and `version.json` into the copy, and deploys the copy. `assert-site-bindings.mjs`
refuses any wrangler config in `sites/nikatru`.

Read in the pinned wrangler 4.135.0 (`tooling/wrangler/node_modules/wrangler/wrangler-dist/cli.js`,
installed from the island's lockfile; not run):

- `pages deploy` resolves Functions as
  `customFunctionsDirectory || path.join(process.cwd(), "functions")`: the WORKING directory,
  never the directory argument. So `pages deploy sites/nikatru` from the repo root would upload
  the pages and ship no Function, and nothing would fail. The smoke's POST limb is the check on
  that outcome: a host with no Function answers the POST 405 or 404.
- The Pages config is `findWranglerConfig(process.cwd())`: `wrangler.json`, then `wrangler.jsonc`,
  then `wrangler.toml`, in the working directory. It is a Pages config when it carries
  `pages_build_output_dir`. Its bindings travel in the Functions bundle
  (`createUploadWorkerBundleContents(workerBundle, config)`).
- JSONC, not the TOML the D3a brief named. Three guards walk every wrangler config in the tree and
  parse it as JSONC: `assert-ops-register.mjs` and `assert-retention-coverage.mjs` exit 2 on a
  `.toml`, and `assert-data-inventory.mjs` refuses one by name ("Convert it, or teach this guard
  TOML"). `assert-erasure-reach.mjs` classifies `tooling/sites/*/wrangler.jsonc` as a config that
  binds a database and never owns one.
- The upload skips `_worker.js`, `_redirects`, `_headers`, `_routes.json`, `functions`,
  `**/.DS_Store`, `**/node_modules`, `**/.git` and `.wrangler`. `wrangler.jsonc` is NOT on that list,
  so `nikatru-apex` serves the filled copy as `/wrangler.jsonc`. It holds identifiers only: the D1
  id is already public in `services/platform/wrangler.jsonc`, and the KV namespace id is an
  identifier, not a credential.
- `pages secret put` reads the value from stdin when not interactive, and PATCHes the project's
  `deployment_configs.production.env_vars`. A deployment sees the secrets set before it, so the
  put runs before the deploy.

### the KV namespace id is an Actions VARIABLE

`tooling/sites/nikatru-apex/wrangler.jsonc` commits the placeholder `__NIKATRU_SIGNUPS_KV_ID__`.
`assert-site-bindings.mjs --fill-kv-id --out build/nikatru-apex` grades the committed file, then
writes it into the staged copy with the value of `vars.NIKATRU_SIGNUPS_KV_ID` in the placeholder's
place, refusing a value that is not 32 hex characters. An unset variable fails the job before the
project is created. The committed file is never rewritten.

### the smoke writes nothing

`POST /api/subscribe` with an EMPTY body and `content-type: application/json`: `subscribe.js`
cannot parse it and answers `400 { ok: false, "Could not read your submission." }` from its
catch, before the binding check and before any write. `tooling/ci/test/smoke-site-deploy.test.mjs`
runs the shipping `onRequestPost` on that request with an `env` that throws on any read, and
asserts that 400 and an untouched `env`. The same fact bounds the limb: it cannot show the
bindings are present, because only a valid address reaches that check, and a valid address
would write a row. `assert-site-bindings.mjs` grades the bindings before the deploy instead.

