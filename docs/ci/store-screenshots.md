# `store-screenshots.yml`

The prose that used to live inside `.github/workflows/store-screenshots.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

Captures the Google Play phone AND tablet screenshot sets from a LIVE build of
Subly, uploads them as an artifact and opens a pull request proposing the set.

── WHY THIS IS A WORKFLOW AND NOT A LOCAL SCRIPT ────────────────────────────
It is the one listing asset that cannot be produced on the owner's machine.
The feature graphic and the store icon are rendered from brand art in the tree
by `node tooling/store/render-play-graphics.mjs` in seconds, with no account
and no secret. Screenshots need a LIVE build, and a live build needs a
confirmed Supabase account, which needs SUPABASE_SERVICE_ROLE_KEY — a secret
that exists here and nowhere else.

🔴 AND "JUST USE THE DEMO BUILD" IS THE THING THIS EXISTS TO PREVENT. Measured
2026-08-04 by capturing one and looking at the result: a demo build paints
"Demo data - sample subscriptions, not your account" across every screen
(app_shell.dart) and fills the board with Netflix, Spotify, Disney+, Adobe CC
and eight more real companies (demo_data.dart). Both are legible in the first
frame. A listing built from that advertises the product as a demo AND puts
third-party trademarks on a public store page, which Google's own preview-asset
page tells developers to avoid and which [ADR 019] forbids for any asset we
produce. Until #150 every store build of this app WAS a demo build, so this is
a mistake the repo has already made once.

The illustrative rows the capture creates are generic by construction
("Video streaming", "Cloud storage", …) and are typed into the app's own "Add
subscription" sheet, so nothing in the picture is a capability the shipping app
does not have.

🔴 ANDROID CANNOT BE BUILT ON THE OWNER'S MACHINE and that is not a Flutter
problem — `java.nio.channels.Selector.open()` fails for ALL Java there, a
Windows socket-layer defect root-caused 2026-07-25. The web target renders the
same widget tree, which is what makes this capture possible at all.

⚠️ IT UPLOADS *AND* OPENS A PULL REQUEST. It used to only upload, and the
reasoning was right while the conclusion was wrong: the screenshots are a
listing asset a human should look at before it represents the product — the
guard can prove size, format, count and posture, and cannot prove the set is
worth showing — so nothing should push them onto a store page unreviewed.

🔴 BUT AN ARTIFACT IS NOT A REVIEW, IT IS A DEADLINE. Measured 2026-08-04: this
workflow ran successfully (run 30922349590), produced the five 1080x1920
frames, and left them in an artifact that EXPIRES 2026-11-02. Nothing in the
repository carried a single pixel of it. So the only copy of the assets that
would go on the store lived in a bucket with a 90-day timer, no human had
looked at them, and `apps/subscriptiontracker/store/android-play/screenshots/` held one
README explaining why it was empty. "Do not publish unreviewed" had quietly
become "do not review".

A PULL REQUEST IS THE REVIEW STEP, and it is the one thing an artifact cannot
be: GitHub renders PNGs in a diff, so the owner SEES exactly what would be
uploaded, in the place where approving it is one click and where declining it
leaves a record. Merging is still a human act; nothing here contacts Google,
and `submit-play.mjs` remains the only path to a store. The artifact upload is
kept as well — it costs nothing and it is what the run's own log links to.

### above `on:`

The submission path this feeds is still gated elsewhere; opening a PR is the
most this workflow may do on its own.

Required repo secrets — ALL of them, on every run:
  SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE_URL, SUPABASE_SERVICE_ROLE_KEY

A MISSING SECRET IS A FAILED RUN, NOT A SKIPPED ONE — the same rule e2e.yml
records at length. A green tick over an `echo` is how a capability goes dark
reporting success. tooling/ci/assert-green-means-ran.mjs enforces the shape:
the preflight exits non-zero and no step is `if:`-gated on its output.

🔴 THAT LAST SENTENCE IS PROSE CARRYING A CHECK, AND THE CHECK IS NOT THERE
FOR THIS FILE. Measured 2026-08-22, not read off the guard's name.
assert-green-means-ran.mjs section B finds a preflight by matching
`-z "$SECRET_NAME"` against the step's own `env:` bindings
(`testsEmptiness`). This preflight reads its four secrets through a loop and
tests `$v`, never a secret's own name, so the detector matches NOTHING here
and this workflow is not one of its subjects at all. PROVEN against a
scratchpad copy of the tree rather than argued, exit code on its own line:
with the `exit 1` DELETED from the preflight below, the guard still printed
`ok … 1 secret-presence check(s) fail closed` and EXIT 0. The one it counts
is e2e.yml, the only entry in its REQUIRED_SECRET_GATES.

THE REPAIR IS TWO EDITS AND ONLY ONE OF THEM IS IN THIS FILE, WHICH IS WHY IT
IS NOT MADE HERE. Rewriting the loop as four tests by name does put this file
under section B — measured: the guard then reports `2 secret-presence
check(s)`, and deleting the `exit 1` FAILS it at EXIT 1 naming this file, this
job and all four secrets. But the same measurement turns
tooling/ci/test/green-means-ran.test.mjs:225 RED: that test asserts
`/1 secret-presence check\(s\) fail closed/` against the real workflow
directory, so it pins the count AT reality and forbids any second workflow
from ever gaining a fail-closed preflight. Measured with the rewrite in place:
the full suite went to tests 5308 / pass 5307 / FAIL 1, the one failure being
that assertion. The rewrite was therefore REVERTED rather than landed with a
red suite, and the count assertion was NOT weakened to accommodate it — that
file is not owned by this change, and a count pinned at reality is a finding
about the test, not a licence to edit it.

⚠️ SO, PLAINLY: THE PREFLIGHT BELOW IS CORRECT AND IS GUARDED BY NOTHING.
Its behaviour was measured directly instead. `[ … ] && …` under `set -e` is a
known footgun and GitHub runs a `run:` body as
`bash --noprofile --norc -eo pipefail {0}`, so it was executed under exactly
those flags 2026-08-22, each exit code captured on its own line: all four
secrets present -> EXIT 0 and the LIVE line; the FIRST absent -> EXIT 1 naming
SUPABASE_URL; the LAST absent -> EXIT 1 naming SUPABASE_SERVICE_ROLE_KEY. A
failing `[` inside an `&&` list does not trip errexit, which is why the loop
does not abort on the first secret that IS set.

RE-TAKEN 2026-08-24, FIFTH PASS, BECAUSE A BEHAVIOUR HELD BY MEASUREMENT ALONE
HAS TO BE RE-MEASURED OR IT IS HELD BY MEMORY. The `run:` body below was
extracted from this file verbatim (not retyped) and executed under
`env -i bash --noprofile --norc -eo pipefail`, exit code on its own line:
  · all four present   -> EXIT 0, "All four secrets present — the build will be LIVE."
  · FIRST absent       -> EXIT 1, "Missing secret(s): SUPABASE_URL"
  · LAST absent        -> EXIT 1, "Missing secret(s): SUPABASE_SERVICE_ROLE_KEY"
  · ALL FOUR absent    -> EXIT 1, all four named in order — a fourth case the
    2026-08-22 record did not take, added because "the loop does not abort on
    the first secret that IS set" is only half-shown by a run where three are.

### above `permissions:`

Least privilege, and the DEFAULT for every job that does not override it.
[pipeline F-11]

## job `capture`

### above `name: Capture the Play phone and tablet screenshot sets (live)`

RENAMED 2026-08-21, and the header line at the top of this file with it.
Both read "the Play PHONE screenshot set" while this job has driven TWO
viewports since d9cc366 — the `Upload the screenshot set` step below says
"BOTH device-type sets" in its own comment and lists two directories, and
the pull-request step lists the same two. The file contradicted itself
about the one thing a reader comes here to check, twenty-odd lines apart.

LATENT, NOT LIVE, AND THE DIFFERENCE MATTERS. A job `name:` is display
text; nothing resolves through it. Measured 2026-08-21: the job ID is
still `capture`, and the ID is what every reference anchors on — FOUR rows
in tooling/enforcement-index.json read
`.github/workflows/store-screenshots.yml#capture`, and
tooling/ops/register.json anchors the FILE, not the name. Also `gh run list
--workflow store-screenshots.yml` prints the WORKFLOW name ("Store
screenshots (live capture)"), never this one. So the stale name misled a
human opening the run to decide whether the tablet set had been captured,
which is the single remaining Play gate; it never changed what ran, and
renaming it changes nothing that executes.

APPENDED 2026-08-21, SAME SESSION, SECOND PASS — the rewrite above fixed
one half of lines 3-4 and left the other half stale. The sentence still
ended "uploads them as an artifact for the owner to commit", which the
⚠️ note beginning "IT UPLOADS *AND* OPENS A PULL REQUEST" and the step
named "Propose the set for human review (pull request)" have both
contradicted since that step landed. Line 4 now names the pull request as
well. A summary line is the one line a reader trusts without reading
further, so it is the worst place in the file to half-correct a sentence.
The same pass corrected "Nothing here pushes" on the checkout step, which
was false for the same reason.

APPENDED 2026-08-21, THIRD PASS — A RENAME MUST NOT LAND ON TOP OF A RUN
THAT IS IN FLIGHT, so it was checked rather than assumed:
`gh run list --workflow store-screenshots.yml --limit 10` returns exactly
ONE row, run 30922349590 of 2026-08-04, completed/success. Nothing is
dispatched, and the tablet capture the owner may dispatch has not been run
yet — that single run predates d9cc366 (2026-08-21), the commit that added
the second viewport, which is why it produced the five phone frames the
note above records and no tablet set at all.

RE-CHECKED 2026-08-22, FOURTH PASS, BECAUSE "NOTHING IS DISPATCHED" IS A
CLAIM WITH A CLOCK ON IT: `gh run list --workflow=store-screenshots.yml
--limit 10` still returns exactly ONE row — run 30922349590, 2026-08-04,
completed/success. The rename above still lands on no run in flight, and
the tablet capture the owner may dispatch is still un-run.

RE-CHECKED 2026-08-24, FIFTH PASS, FOR THE SAME REASON THE FOURTH DID:
`gh run list --workflow=store-screenshots.yml --limit 10` returns exactly
ONE row — `completed  success  Store screenshots (live capture)  main
workflow_dispatch  30922349590  4m9s  2026-08-04T15:05:35Z`. Nothing is
dispatched, the rename landed on no run in flight, and the tablet capture
is still un-run. Nothing in this file changed this pass except this note.

## job `permissions`

### above `permissions:`

🔴 THE NARROWEST SET THAT LETS THE CAPTURE OUTLIVE ITS RUN, and both halves
are needed by exactly one step. `contents: write` pushes the review branch;
`pull-requests: write` opens the PR. Nothing here deploys, releases or
touches a store — [pipeline F-11] is about scope, not about refusing to
write, and the alternative on offer was an artifact with a 90-day timer
that no human ever opened.

## job `with`

### above `with:`

persist-credentials: false — actions/checkout otherwise writes
GITHUB_TOKEN into .git/config and LEAVES it there for the whole job.
This job uploads an artifact, so a credential left in the workspace is
one `actions/upload-artifact` glob away from being downloadable on a
public repo. NOTHING USES THAT CREDENTIAL: the one step that pushes
(`Propose the set for human review`) builds its own remote URL from
`github.token` for that single command, so nothing needs the copy
checkout would have left in .git/config. CORRECTED 2026-08-21 — this
line read "Nothing here pushes", which stopped being true when the
pull-request step landed and which the step's own comment below has
contradicted since. [zizmor artipacked]

## job `capture`

### before step **Preflight — every secret the live capture needs must be present**

THE RUN IS EITHER POSSIBLE OR IT IS RED. Nothing downstream is gated on
this step's output — the job simply stops here.

### before step **Set up ChromeDriver**

Must MATCH the installed Chrome major version or the WebDriver handshake
fails with a version mismatch that reads like a Flutter error.
🔴 REPINNED 2026-09-03, AND THE OLD PIN WAS FROZEN RATHER THAN MERELY OLD.
It read `@ef5c64a9 # v2` — a real commit, but an UNTAGGED one (16 minutes
past v2.4.0, i.e. what the floating `v2` tag pointed at), and upstream has
since DELETED the `v2` tag entirely. Renovate cannot resolve a tag that no
longer exists, so it reported `Could not determine new digest for update`
and proposed nothing: this action had been receiving no updates at all
since March, silently, with the pin looking perfectly healthy in the diff.
⚠️ THAT IS THE FAILURE MODE SHA-PINNING BUYS AND `helpers:pinGitHubActionDigests`
is supposed to pay for — and it went unnoticed because nothing in this tree
checks that the `# vN` comment names a tag that still exists. The detector
is Renovate itself, which found it in its FIRST self-hosted run.
v3.0.0 is a TypeScript rewrite that states behavioural parity (same install
locations, same PATH resolution) and this repo passes it no inputs at all,
so the depended-on surface is unchanged. It also carries the download
retry/backoff and the `qs` DoS fix.

### before step **Provision throwaway confirmed user**

The same throwaway, pre-confirmed user the nightly e2e provisions, and
purged again below whatever happens. Prod is left as it was found.

## 🔴 THE CAPTURED APP WAS TELLING USERS IT WAS OFFLINE — found 2026-09-20

Every frame this lane had produced up to 2026-09-20 carries a full-width
`#ffdad6` band across the top reading **"Could not reach the network. Some
things may be out of date."** with a `Retry` button. All EIGHT committed frames
— four phone, four tablet, from run `34202461387` (PR #542, merged 2026-09-09)
and its predecessor `#393` — measured with `tooling/store/png-codec.mjs`:

| file | pixels | top colour | solid rows | max row fraction | max `warn` row |
| --- | --- | --- | --- | --- | --- |
| `screenshots/01-home.png` | 1080×1920 | `#ffdad6` | 70 | 1.000 | 0.000 |
| `screenshots/02-calendar.png` | 1080×1920 | `#ffdad6` | 70 | 1.000 | 0.000 |
| `screenshots/03-insights.png` | 1080×1920 | `#ffdad6` | 70 | 1.000 | 0.000 |
| `screenshots/04-budget.png` | 1080×1920 | `#ffdad6` | 70 | 1.000 | 0.000 |
| `screenshots-tablet/01-home.png` | 1800×3200 | `#ffdad6` | 63 | 1.000 | 0.003 |
| `screenshots-tablet/02-calendar.png` | 1800×3200 | `#ffdad6` | 63 | 1.000 | 0.000 |
| `screenshots-tablet/03-insights.png` | 1800×3200 | `#ffdad6` | 63 | 1.000 | 0.000 |
| `screenshots-tablet/04-budget.png` | 1800×3200 | `#ffdad6` | 63 | 1.000 | 0.000 |

### ⚠️ IT IS NOT AN ANDROID STATUS BAR, AND THE OBVIOUS FIX IS THE WRONG ONE

Read as "the phone had no signal", the remedy looks like Android's SystemUI demo
mode (`adb shell settings put global sysui_demo_allowed 1`, then
`am broadcast -a com.android.systemui.demo …`) and the emulator flags
`-netdelay none -netspeed full`. **None of it applies.** This lane runs no
emulator and no Android image at all: `capture-play-screenshots.mjs` drives
`flutter drive -d web-server --browser-name=chrome`, so the frames are a
headless Chrome viewport. There is no system status bar in them — row 0 of every
frame above is the app's own first pixel — so there is no clock, battery or
signal to pin, and no radio to bring up.

### The cause: a cross-origin config fetch that cannot succeed

The banner is driven by a **failed request**, never by a connectivity plugin.
`NetworkReachabilityController` starts `false` and flips only when one really
fails, and the app makes exactly one at launch:
`GET {CONFIG_BASE_URL}/config/subscriptiontracker` against
`https://config.nikatru.com`, the `platform` Worker.

`flutter drive -d web-server` serves the app from `http://localhost:<RANDOM
PORT>`, so that fetch is cross-origin. `tooling/ci/assert-cors-allowlist.mjs`
already records why the two Workers behave differently here:

- `subscriptiontracker-api` "allows localhost by regex (a recorded trade — the
  `flutter drive -d web-server` harness picks a random port)" → the API calls
  succeed, which is why the frames are **populated** ($93.47/mo, 6 active,
  "Video streaming") rather than empty.
- `platform` "has NO localhost regex, so the origin must be listed explicitly",
  and the only explicit entry is `http://localhost:3000` → the config fetch is
  refused on every run, because a random port can never be 3000.

So the app was online, signed in and populated, and was told by its own launch
fetch that the network was unreachable. **The banner was right about what it
observed and wrong about the product.**

### The fix: do not make the doomed request

`apps/subscriptiontracker/lib/core/app_config.dart` already carried the lever
and already described this exact situation — "`--dart-define=SKIP_REMOTE_CONFIG=
true`, which an `integration_test` run wants: it supplies identity defines but
has no reason to reach the config host". Measured 2026-09-20: **nothing passed
it.** The define was designed for this caller and wired to nothing.

`tooling/store/capture-network-posture.mjs` now declares it and
`capture-play-screenshots.mjs` pushes it onto every drive. Config then resolves
to `kAppDefaultConfig`, which `apps/subscriptiontracker/test/config_default_test.dart`
pins **against the server's own values** — so the captured app renders the
configuration it would have fetched. Nothing is staged or masked: this removes a
false statement from the frame, it does not hide a true one.

⚠️ **Widening the `platform` Worker's CORS allowlist was considered and
rejected.** It would clear the banner by loosening a *production* allowlist for
a screenshot lane, and against a random port it could only be done with a regex.
Not making a request is strictly narrower than permitting one.

### Why no guard caught it

`tooling/ci/assert-listing-assets.mjs` decoded all eight frames and passed them.
Its banner limb hunts a full-width band of `AppColors.warn` (`#f59e0b`) — the
*demo* banner — and this band is `ColorScheme.fromSeed(...).errorContainer`
(`#ffdad6`). The measured `warn` fraction is `0.000` on seven of eight frames.
The limb was working exactly as written and was aimed at one banner out of two.

The new detector is aimed at the **property** instead of a hex: a full-width
band (≥60% of a row) in the top tenth whose red channel leads the others by ≥16.
Measured `r − max(g, b)`: offline `+37`, demo `+87`, danger `+32`, app
background `−4`, white `0`, hero card `−21`. It cannot be pinned to a colour,
because `errorContainer` is a Material 3 tonal-palette computation in Dart that
no Node guard can recompute — a pinned hex would stop matching the day the seed
moved.

🔴 **THE COMMITTED FRAMES ARE STILL THE BAD ONES.** They can only be replaced by
a run of this workflow: the live capture needs `SUPABASE_SERVICE_ROLE_KEY`, a
CI-only secret. So the refusal lives at **capture time**, where it stops a bad
set being produced; a guard over the committed bytes has to land in the same
change as the re-captured bytes, which is this repo's standing rule for a floor
and its subject. Wiring the same detector into `assert-listing-assets.mjs` is
the follow-up that belongs in that commit.

### before step **The captured set satisfies the listing-asset guard**

The capture script already checks Play's rules on what it produced; this
runs the GUARD over the result too, so the artifact that leaves this job
has passed the same check CI will apply once the files are committed. A
release path that trusts a check it did not run is not a release path.

### in step **Upload the screenshot set**, above `path: |`

BOTH device-type sets. The capture drives two viewports since
2026-08-21 (Play's minimum is two device TYPES, not two files), and a
path pinned to the phone directory alone would have uploaded half of
what the run produced while `if-no-files-found: error` stayed happy —
a silent half-capture is the shape this file's own header warns about.

### before step **Propose the set for human review (pull request)**

🔴 THE STEP THAT MAKES THE CAPTURE OUTLIVE ITS RUN. Everything above is
unchanged; without this the set expires in 90 days having been seen by
nobody, which is what happened to run 30922349590.

`gh` rather than a create-pull-request action: it is preinstalled on the
runner, so this adds no third-party dependency to pin — and a pin is a
40-hex SHA that has to be looked up correctly, which
assert-workflow-hardening.mjs is right to demand and which is one more
thing to get wrong for no gain here.

The push URL carries the token explicitly BECAUSE checkout above sets
`persist-credentials: false` — that is deliberate (a credential left in
.git/config on a job that uploads artifacts is one glob away from being
downloadable on a public repo), so the credential is supplied for exactly
this one command instead of for the whole job.

NO `if:` GATE. `assert-green-means-ran.mjs`'s rule: a step that can be
skipped is a capability that can go dark under a green tick. If the set
is byte-identical to what is already committed there is genuinely nothing
to propose, and that is reported rather than skipped.

### before step **Purge the throwaway user**

`always()` — a capture that failed halfway may still have created rows in
live D1, and a throwaway user that outlives its run is exactly the kind of
residue the nightly was built to avoid.

### in step **Purge the throwaway user**, above `SUBSCRIPTIONTRACKER_D1_DATABASE_ID: 0a36d6a0-c909-40aa-853e-970de3482321`

The same literal e2e.yml passes. It is a database ID, not a
credential — the CLOUDFLARE_API_TOKEN above is what authorises
anything — and purge.mjs `need()`s it, so omitting it turns the
cleanup into a hard failure AFTER the rows exist.

## How to rehearse locally

🔴 **ADDED 2026-09-20, ON AN OWNER RULING, AND THE RULING IS THE POINT.** This lane failed three
dispatches in a row — 35483690951, 35488534460 and one before — on causes that were only visible in
CI. Each fix cost a dispatch to test. The ruling: **a change must pass LOCALLY TWICE before it is
pushed, and a lane that cannot run locally must not be dispatched once per fix.**

So what was fixed on 2026-09-20 is not another capture bug. It is the **absence of a local
rehearsal**, which had three causes, none of them about the capture:

| blocker | why it stopped the run | what closed it |
|---|---|---|
| no `chromedriver` | the capture's own probe refuses before it destroys anything; CI installs it with `nanasess/setup-chromedriver`, which is **Linux-only** | `tooling/store/local-chromedriver.mjs` |
| no `SUPABASE_SERVICE_ROLE_KEY` in the vault | `tooling/e2e/provision_user.mjs` cannot create the throwaway confirmed account, so there is nothing to sign in as | read from the Supabase **management API** with the `SUPABASE_PAT` the vault already held, and written to the vault under **the name CI uses** |
| the laptop's Flutter was **not the pin** | `pub get --enforce-lockfile` refuses under it, and dropping the flag writes the OLD pins into `pubspec.lock` | the pinned SDK, installed **isolated**; `rehearse-capture-locally.mjs` version-checks it and refuses otherwise |

### 🔴 The SDK gap, because it was the one that could have damaged the tree

Measured 2026-09-20: `tooling/versions.json` pins Flutter **3.47.4** and `pubspec.lock` was resolved
on that pin, while the laptop's own `flutter` was **3.44.9**. Under it:

```
Would change 7 dependencies …
Unable to satisfy `..\..\pubspec.yaml` using `..\..\pubspec.lock`
```

— the seven SDK-constrained packages `versions.json` names (`intl`, `matcher`, `meta`, `test`,
`test_api`, `test_core`, `vector_math`). **Dropping `--enforce-lockfile` is not the workaround**: a
plain `pub get` on the older SDK writes the OLD pins back, and twelve release lanes enforce that
lock on merge, on tag and on every store submission — so the damage would surface on a RELEASE lane,
not on the PR that caused it. A rehearsal on the wrong SDK therefore either cannot start or breaks
the tree; neither is a rehearsal, and the runner refuses rather than choosing between them.

Install it beside the chromedriver, **never over the machine's own Flutter** — other lanes drive that
one at the same time. The SDK archive's `sha256` is published in Google's own
`releases_windows.json` next to the `archive` path; verify against it, extract to
`%LOCALAPPDATA%\nikatru\flutter\<pin>\`, and the runner finds it. `NIKATRU_FLUTTER` overrides the
lookup with an explicit path.

⚠️ **Every `pub get` on 3.47 rewrites every `analysis_options.yaml` in the workspace** (an
`analyzer: exclude:` block) — **nine** of them when measured on 2026-09-20, where
`tooling/versions.json` recorded seven in 2026-08: the count is the workspace's, so it moves, and
nothing should assert it. Committing the rewrite fails `assert-no-gate-weakening.mjs`. CI never notices because its pub get
and that guard run in different jobs on different runners; locally they are one tree, so
`rehearse-capture-locally.mjs` reverts exactly those files after each pub get — including the
implicit one inside `flutter drive`.

### Where the two local tools live

Both are per-version directories under `%LOCALAPPDATA%\nikatru\` — beside the heavy-run lock, and
**never on `PATH`**, so nothing else on the machine changes. As installed on 2026-09-20:

- `…\nikatru\chromedriver\<chromedriver version>\chromedriver.exe`, from
  `https://storage.googleapis.com/chrome-for-testing-public/<version>/win64/chromedriver-win64.zip`,
  verified against the **size and MD5 the Cloud Storage JSON API publishes for that object** — the
  Chrome-for-Testing catalogue itself carries urls and no hashes. That check detects a truncated or
  corrupted download; it is not a signature, and the script says so rather than implying more.
- `…\nikatru\flutter\<pin>\flutter\bin\flutter.bat`, from Google's `releases_windows.json`, verified
  against the **`sha256` that file publishes beside the archive path**.

### The two commands

Once, to prove the machine is ready — it resolves every input, prints each credential as a **name,
a length and a short sha256**, and runs nothing:

```
node tooling/store/rehearse-capture-locally.mjs --print-plan
code=$?
echo "EXIT"
echo "$code"
```

Then the rehearsal itself:

```
node tooling/scripts/heavy.mjs -- node tooling/store/rehearse-capture-locally.mjs
code=$?
echo "EXIT"
echo "$code"
```

and then **the same command again**. `--keep-user` skips the purge for diagnosis and says so loudly.

`heavy.mjs` is not optional here: this drives a browser on the same laptop that runs the offsite
backup, and an unwrapped heavy run has already starved a backup into being killed.

⚠️ **A FAILED RUN LEAVES THE COMMITTED SET DELETED, AND THAT IS BY DESIGN.** The capture empties each
device-type directory of `*.png` before it drives, so that a stale frame of a screen the app no
longer has cannot survive into a set the guard then certifies. A run that fails *before* the first
`captureFrame` — which is what a sign-in failure is — therefore leaves those directories empty in the
working tree. Nothing is lost (the frames are in git), but **restore them before you read
`git status`**:

```
git checkout -- apps/subscriptiontracker/store/android-play/screenshots apps/subscriptiontracker/store/android-play/screenshots-tablet
```

### What "twice, green" means, exactly

**Two separate invocations of the command, each exiting 0, one after the other, with no edit
between them.** It is deliberately not a `--twice` flag: each invocation provisions its **own**
throwaway account and purges it in a `finally`, so two invocations are two independent runs against
two accounts — which is the property being proven. One process looping twice would share a
chromedriver, a resolved pub cache and a warm browser profile, and would prove less while looking
like more.

A run that exits **2** is not a failed capture — it is a rehearsal that could not be **set up** (no
vault, no repository variable, no chromedriver, an SDK that is not the pin). That distinction is the same one
`verify-monitors.mjs` draws, and for the same reason: *"I could not look"* must never be readable as
*"I looked and it was fine"*.

### The credential NAMES, and where each legitimately comes from

⚠️ **Names only. Never a value — not in a commit, not in a transcript, not in a log.** Compute a
length and a short sha256 instead; `rehearse-capture-locally.mjs` prints exactly that for every
input it resolves, which is enough to tell two keys apart and not enough to use one.

🔴 **`::add-mask::` MASKS NOTHING ON A LAPTOP, AND THAT IS A LEAK, NOT A COSMETIC DIFFERENCE.**
`tooling/e2e/provision_user.mjs` prints two of those lines — the generated password and the
single-use magic-link token. Inside GitHub Actions the runner reads them and redacts the values from
every later log line. **Nothing reads them locally**, so on this machine the line *is* the secret, in
clear, in whatever file the run was redirected to. Measured on the first local rehearsal,
2026-09-20. The provisioner is CI's script and its behaviour there is correct, so the fix is on the
caller's side: `rehearse-capture-locally.mjs` pipes that one step, honours the directive itself and
redacts those values from everything it prints. **If you run `provision_user.mjs` by hand, redirect
it somewhere you will scrub.**

| name | CI reads it from | the rehearsal reads it from |
|---|---|---|
| `SUPABASE_URL` | `secrets.` | `.claude/secrets.env` — already held |
| `SUPABASE_ANON_KEY` | `secrets.` | `.claude/secrets.env` — **added 2026-09-20**, the legacy `anon` JWT from `GET /v1/projects/{ref}/api-keys` |
| `SUPABASE_SERVICE_ROLE_KEY` | `secrets.` | `.claude/secrets.env` — **added 2026-09-20**, the legacy `service_role` JWT from the same call |
| `API_BASE_URL` | `secrets.` | `.claude/secrets.env` — **added 2026-09-20**; a public Worker hostname, the value the repo's own `apps/subscriptiontracker/config/defaults.example.json` declares |
| `TURNSTILE_SITE_KEY` | `vars.` | **the repository variable itself**, via `gh variable get` — not a vault copy |
| `CHROMEDRIVER` | `nanasess/setup-chromedriver` | `tooling/store/local-chromedriver.mjs` |
| the Flutter SDK | `./.github/actions/setup-flutter`, at the `tooling/versions.json` pin | the same pin, installed isolated; `NIKATRU_FLUTTER` overrides |

**Why the management API is the honest route for the two keys.** The vault already held
`SUPABASE_PAT`, a Supabase **management** personal access token, and
`GET /v1/projects/{ref}/api-keys` returns that project's keys to the holder of it. Nothing was
weakened, nothing new was granted, and no key was rotated or created: the same key CI holds was read
from the project that issues it, by a token that was already authorised to read it. The vault also
held `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_Secret_key` — the **modern** key pair for the same
project — but those are different strings under different names, and a rehearsal that fed the app a
different key from the one CI feeds it would be proving something about a configuration nobody
ships.

**Why `TURNSTILE_SITE_KEY` is read from the repository and not copied into the vault.** It is a
repository **variable**, not a secret, because a Turnstile *site* key is public by construction — it
ships inside every web bundle, and only the secret half lives on the auth box. Reading the variable
is reading the single declaration `deploy-web.yml` ships and `e2e.yml` drives with; a second copy in
the vault would be a second declaration, free to drift from what production actually renders.

### What is still NOT the same as CI

Stated rather than talked away, because a rehearsal that oversells itself is worse than none:

- **Host and browser.** CI is `ubuntu-24.04` with a Linux Chrome; this is Windows with the
  laptop's own Chrome. `local-chromedriver.mjs` matches the **major** version, which is all
  chromedriver enforces — Chrome-for-Testing does not publish a build per Chrome patch, so the
  patch levels differ and the script prints both rather than implying they match.
- **The steps after the capture.** `assert-listing-assets.mjs`, the artifact upload and the
  `gh pr create` proposal are not rehearsed here; run the guard by hand
  (`node --single-threaded tooling/ci/assert-listing-assets.mjs`) and read
  *"🔴 `gh pr create` CAN BE REFUSED"* in the workflow for the rest.
- **The SDK patch, if the pin has moved.** The runner refuses anything that is not the pin, so this
  difference cannot be silent — but it can make the rehearsal unavailable until the new pin is
  installed, which is the honest trade for never running on the wrong one.
- **`CI` is never set locally**, and nothing here should set it.

### 🔴 WHAT THE FIRST REHEARSAL FOUND, BEFORE ANY DISPATCH — 2026-09-20

The rehearsal paid for itself on its first run, and the finding is worth recording because it is the
exact shape the owner's ruling exists to stop: **a failure that the fix for the PREVIOUS failure
created.**

Supplying `TURNSTILE_SITE_KEY` was right (ADR 084, and the workflow now fails closed without it).
But `TurnstileGate.build` returns `SizedBox.shrink()` when no site key is compiled in, and when one
is, a `CloudflareTurnstile` at `TurnstileSize.flexible` — **height 65**, per the comment citing
Cloudflare — inside a `Padding(bottom: 16)`: **81 px** that was not there before. And
`login_screen.dart` puts it *directly above* the submit button, under the comment "Renders NOTHING
when no site key is compiled in, which is every build today". That sentence stopped being true the
moment this lane started passing the key.

At the phone viewport the form no longer fits. Measured identically on two consecutive local runs:

```
A call to tap() with finder "… [<'e2e_login_submit'>] …"
derived an Offset (Offset(180.0, 644.0)) that would not hit test on the specified widget.
Indeed, Offset(180.0, 644.0) is outside the bounds of the root of the render tree, Size(360.0, 640.0).
  at store_screenshots_test.dart 572:17
```

The button's centre lands **4 px below a 640 px viewport**; subtract the gate's 81 px and it sits at
563, comfortably inside — which is where it was on every earlier run. The run therefore now dies at
**sign-in**, *earlier* than the two failed dispatches did: 35483690951 and 35488534460 both got four
phone frames out before failing, and a local run gets **zero**, because nothing is photographed
before login completes.

⚠️ **THE BENIGN CLASSIFIER IS WORKING, AND THIS IS THE PROOF.** The run's own timeline separates the
two exceptions exactly as intended:

```
 4235ms  EXCEPTION (known-benign: focus-traversal-inactive-element)  widgets library: …
 9804ms  EXCEPTION (unmatched — this run FAILS)  Flutter test framework: Finder specifies a widget …
```

**The fix is not in this lane.** `tester.tap` does not scroll, the form *is* inside a
`SingleChildScrollView` (login_screen.dart:360), and the suite already uses `ensureVisible` before
the add-sheet submit for precisely this reason — so the shape of the repair is known and it belongs
to `integration_test/store_screenshots_test.dart`, not to `tooling/store/`. Recorded here, not
patched here.

### The guard this wants, PROPOSED not invented

The thing that can rot is the **table above**: a name added to the workflow's env that nobody adds
to the rehearsal makes the rehearsal quietly prove less, and it will still print ok. A guard could
parse `.github/workflows/store-screenshots.yml`'s `capture` step env block and
`rehearse-capture-locally.mjs`'s `baseEnv`, and fail on a name present in one and absent from the
other. That is a real, mechanical, non-vacuous check — but a guard lands with its register and its
mutation proof, in its own increment, and inventing one inside a documentation change is how a
repository acquires a check nobody can defend. **Filed as a proposal here; not written.**

