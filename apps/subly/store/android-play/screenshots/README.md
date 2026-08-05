# Screenshot slot — Google Play (`android-play`)

> ## 🔴 FOUR FRAMES ARE PUBLISHED, NOT FIVE — `05-settings.png` WAS REMOVED 2026-08-05
>
> The capture produced five. The Settings frame renders the signed-in account at the top of the card in
> large legible type, and CI captures signed in as the end-to-end test account, so it read
> **`subly-e2e+…@nikatru.com`** — an internal test address on a public marketing asset. It is not the
> owner's PII, but it is a test artefact on a store listing, and it is the first thing a reader's eye lands
> on in that frame. **Removed rather than published.**
>
> **Re-running the workflow does NOT fix this.** The capture signs in as that same account, so any frame
> showing the account card carries the address. 🔴 **This is a defect in
> `tooling/store/capture-play-screenshots.mjs`, not in the curation** — either that frame should not be
> captured, or the capture needs a display-safe account. Until then, every future run reproduces it.
>
> **Cost of removal: none.** `tooling/channel-register.json` sets `minCount: 2` and
> `recommendedCount: 4`; four frames satisfy both. `CAPTURE.json` records BOTH numbers — five captured,
> four published — because `assert-listing-assets.mjs` compares its `count` to the bytes beside it, and
> editing that count alone would have produced provenance that passes the guard and lies about the run.
>
> ⚠️ **The guard passed on all five.** It measures size, colour type, decodability and the demo-banner
> band — it cannot read text. Everything below was found by a human opening the images, and that is the
> gap: **no assertion here can see what a screenshot SAYS.**

The Play phone screenshot set for Subly. **Nothing here is drawn by hand and
nothing here is dropped in from a phone** — the set is an OUTPUT:

```
node tooling/store/capture-play-screenshots.mjs --app subly     # live → here
node tooling/store/capture-play-screenshots.mjs --proof         # demo → temp
```

A screenshot set nobody can regenerate is stale the first time the UI changes,
and it goes stale **silently**: the store keeps showing last year's design and
nothing in this repository knows. That is the same drift `[pipeline D-5]` removed
from the listing text, applied to the pictures.

## ✅ Required dimensions — FETCHED 2026-08-04, no longer UNVERIFIED

This table used to have six rows all reading *"⚠️ UNVERIFIED"* under the correct
instruction *"do not fill a number in from memory"*. Every number below now comes
from **one** primary page, read in full on **2026-08-04**:

> `https://support.google.com/googleplay/android-developer/answer/9866151`
> — *Add preview assets to showcase your app*, Play Console Help

| Field | Value | Verbatim from that page |
|---|---|---|
| Phone screenshot count | **min 2 to publish, max 8** per device type | *"You must provide a minimum of two screenshots across different device types to publish your store listing"* · *"You can add up to 8 screenshots for each supported device type."* |
| Phone screenshot dimensions | **min side 320px, max side 3840px** | *"Minimum dimension: 320px"* · *"Maximum dimension: 3840px"* |
| Aspect ratio ceiling | **max side ≤ 2 × min side** | *"The maximum dimension of your screenshot can't be more than twice as long as the minimum dimension."* |
| Accepted formats | **JPEG or 24-bit PNG, no alpha** | *"JPEG or 24-bit PNG (no alpha)"* |
| Recommended portrait | **≥ 4 shots at ≥ 1080px, 9:16, min 1080×1920** | *"For apps, you must provide at least four screenshots with minimum 1080px resolution. These should be … 9:16 for portrait screenshots (minimum 1080x1920px)."* |
| Feature graphic | **1024×500, JPEG or 24-bit PNG (no alpha)** — `../feature-graphic.png` | *"Dimensions: 1024px by 500px"* |
| App icon | **512×512, 32-bit PNG (with alpha), ≤ 1024KB** — `../store-icon-512.png` | *"32-bit PNG (with alpha)"* · *"Dimensions: 512px by 512px"* · *"Maximum file size: 1024KB"* |

These live in `tooling/channel-register.json` → `storeMetadataContract
.perChannel["android-play"].graphicAssets`, **not** in this file, and
`tooling/ci/assert-listing-assets.mjs` enforces them from there. A limit declared
without a `source` **fails the build** rather than being applied.

### ⚠️ Still UNVERIFIED, and therefore NOT enforced

- **Maximum file size for a phone screenshot.** The page states one for the app
  icon (1024KB) and for Android XR (*"up to 8 MB each"*) and **none** for phone
  screenshots. The widely-repeated "8MB" is the XR number wearing a phone's
  clothes, so no limit is enforced and none is written down.
- **Whether phone screenshots alone satisfy *"across different device types"*.**
  The strict reading (≥ 2 in this set) is enforced, because the loose one can
  only accept a listing Play might refuse.
- **Tablet / Chromebook / Wear / TV / Automotive / XR sets.** Documented on the
  same page; this app declares none of those form factors, so no expectation is
  recorded. Add the row in the same increment that adds the form factor.

🔴 The rule that keeps this table honest: **an invented limit fires on correct
input.** A made-up *"120 characters or fewer"* once rejected this repo's own
fixture at 129.

## 🔴 The capture must be a LIVE build, and that is a policy matter

Measured **2026-08-04** by capturing a demo build and looking at the result:

1. `app_shell.dart` paints an orange banner across **every** screen —
   *"Demo data - sample subscriptions, not your account"* — whenever
   `!AppConfig.isApiConfigured`.
2. `lib/data/seed/demo_data.dart` fills the board with **twelve third-party
   trademarks**: Netflix, Spotify, ChatGPT Plus, iCloud+, GitHub Copilot, Adobe
   CC, Disney+, Notion, NYTimes, Equinox, YouTube Premium, 1Password.

Both are visible in the first frame. A listing built from that advertises the
product as a demo **and** puts other companies' marks on a public store page —
which Google's own preview-asset page tells developers to avoid (*"Third-party
trademarked characters or logos without proper permission"*) and which
`[ADR 019]`'s NO-IP rule forbids for anything we produce. Until **#150** every
store build of this app was a demo build, so this is a mistake already made once.

So the capture suite **refuses** to run against a demo build unless
`STORE_CAPTURE_ALLOW_DEMO` is passed, the runner sends `--proof` output to a
throwaway directory and refuses to point it here, and the guard rejects any
screenshot in this directory that is not accompanied by `CAPTURE.json` recording
`posture: "live"`. A demo capture is exactly the right **size** — size checks
alone would pass it.

The illustrative rows the live capture creates are generic by construction
(*"Video streaming"*, *"Cloud storage"*, …) and are typed into the app's **own**
"Add subscription" sheet, so nothing in the picture is a capability the shipping
app does not have.

## 🟢 THE SET IS HERE — landed 2026-08-05 from run `30922349590`

This heading read *"Why this directory is still empty"* until 2026-08-05. The
frames the run produced are listed below; **four of them sit next to this file** (see the banner above):

| file | pixels | colour type | bytes |
| --- | --- | --- | --- |
| `01-home.png` | 1080×1920 | 2 (24-bit, no alpha) | 472,046 |
| `02-calendar.png` | 1080×1920 | 2 | 158,488 |
| `03-insights.png` | 1080×1920 | 2 | 134,426 |
| `04-budget.png` | 1080×1920 | 2 | 133,497 |
| `05-settings.png` | 1080×1920 | 2 | 203,988 |

`CAPTURE.json` came with them and records `posture: "live"`, `count: 5`,
`pixels: "1080x1920"`, `viewport: "360x640@3"` — written by the capture script on
the live run, not by hand afterwards.

**They were retrieved from the artifact, not re-captured.** The artifact
`play-screenshots-subly` was still live (checked via `gh api`: `expired: false`,
`expires_at 2026-11-02T15:05:41Z`), so the bytes that landed are the exact bytes
that run produced. Re-running the workflow would have produced a *different*
five, at a different date, for no gain.

⚠️ **The last section of this file used to end "this repository's agents do not
download", and an agent downloaded it anyway** — under an explicit instruction,
into the working tree only, leaving the commit to the owner. That sentence was a
policy written into a README where nothing enforced it; it is recorded here
rather than quietly deleted. If it is a real rule it belongs in a guard, and if
it is not, it should not have been phrased as one.

The live capture needs a confirmed Supabase account, which needs
`SUPABASE_SERVICE_ROLE_KEY` — a **CI-only** secret that is not on the owner's
machine. To refresh the set, run **`store-screenshots.yml`**
(`workflow_dispatch`); it provisions a throwaway confirmed user, captures the
set, checks it against the guard, opens a pull request, and purges the user
again.

### 🔴 The set now arrives as a PULL REQUEST, not only as an artifact

This section used to say the workflow *"uploads rather than commits, on
purpose"* — the guard can prove size, format, count and posture and cannot prove
the set is worth showing, so nothing should push pictures onto a store page that
nobody chose. **That reasoning was right and the conclusion was wrong.**

Measured **2026-08-04**: the workflow ran successfully (run `30922349590`), the
five 1080×1920 frames were produced, and they went into an artifact that
**expires 2026-11-02**. Not one pixel of it reached this repository. So the only
copy of what would go on the store sat in a bucket with a 90-day timer, nobody
had looked at it, and this file explained why the directory was empty. *"Do not
publish unreviewed"* had quietly become *"do not review"*.

**An artifact is not a review; it is a deadline.** A pull request *is* the
review: GitHub renders PNGs in a diff, so the owner sees exactly what would be
uploaded, in the place where approving it is one click and declining it leaves a
record. Merging is still a human act, and nothing in the workflow contacts
Google — `tooling/release/submit-play.mjs` remains the only path to a store. The
artifact upload is kept as well; it costs nothing and the run log links to it.

### What is machine-checked once the frames land

`tooling/ci/assert-listing-assets.mjs` proves count, dimensions **against the
set's own `CAPTURE.json`**, aspect, format, recorded posture — and the **absence
of the demo banner in the actual pixels**, by decoding each frame and looking for
a full-width band of `AppColors.warn` across the top. The colour is read from
`packages/design_system/lib/src/tokens/app_colors.dart` at scan time, never
pinned, so a palette change moves the detector with it instead of leaving it
hunting a colour nothing draws.

The detector **self-tests on every run** against two frames built in memory — one
banded, one clean — because a check that ranges over nothing prints `ok` forever.
That is the failure this repository has paid for more than any other. It was
written while this directory was empty and it is **not retired now that it is
not**: the set can be deleted, and the day it is, the self-test is again the only
thing standing between an empty directory and a green banner limb.

Measured on the landed set (2026-08-05): synthetic banded frame `0.969`, clean
frame `0.000`, threshold `0.60` — and the worst top-band row across all five real
frames was **`0.009`**, two orders of magnitude below the threshold. The margin is
printed rather than asserted so a near-miss cannot hide inside a pass.

The **DEBUG ribbon** is a separate, static limb: `flutter drive` builds in debug,
so `debugShowCheckedModeBanner: false` in `lib/app.dart` is the only thing
keeping a red ribbon out of every captured frame, and until 2026-08-04 nothing
was holding it.

What none of that can judge is whether these are the screens **worth showing**.
Google requires screenshots to *"demonstrate the actual in-app or in-game
experience"* — a human call, and the whole reason the PR exists.

`assert-listing-assets.mjs` PRINTS the empty-directory gap rather than failing,
because it is blocked on a workflow run. It does **not** extend that leniency to
the feature graphic or the store icon: those are produced from brand art already
in this tree by one command with no account and no secret, so a missing one is a
build failure. **That print is now silent, because the gap is closed** — the
guard reports `5 screenshot(s) measured` and `5 screenshot(s) DECODED`.

### 🔴 What a human still has to decide — the guard says so itself

Four things were read out of the pixels by eye on 2026-08-05 that **no assertion
here covers**, listed so the owner reviews the images rather than the checkmark:

1. **`05-settings.png` shows the throwaway E2E account's address**,
   `subly-e2e+…@nikatru.com`, legible at full size. It is a CI account and not
   the owner's, so it is not a privacy leak — but it is a **test artefact on a
   public marketing asset**, and it is the one frame that would look wrong to a
   reviewer who noticed it.
2. **The floating `+` button overlaps a price in three frames** — `01-home`
   (`$1▮.99`), `02-calendar` (a bare `$`), `04-budget` (`$93 / $1▮2`). The
   capture is a real screen, so this is what the app looks like; it still reads
   as a cropped number on a store page.
3. **The bottom nav bar sits over the third row** in `01-home` and `02-calendar`,
   so the last item is half-visible. Same cause, same "real but unflattering".
4. **`03-insights` and `04-budget` are sparse** — one `Other` category at `$93`,
   *"Nothing flagged — nice."*, `$0 Budget`, and `0% over budget` rendered in
   red. Accurate for a five-minute-old account; thin as an advertisement.

None of these is a publish blocker and none is a bug. They are the *"demonstrate
the actual in-app or in-game experience"* judgement Google asks for, which is
exactly what the guard's own header says it cannot make.

## Naming

`NN-<slug>.png`, ordered — `01-home.png`, `02-calendar.png`, … Play shows them in
**upload order** and the order is part of the listing, so the number is the
listing's, not the filesystem's. Google: *"prioritize UI in the first three
screenshots as much as possible"*.

## ✅ No longer missing: the app icon

This file used to end with *"There is **no** Subly-specific app icon … a Play
submission today would ship the default Flutter mark."* **#149** fixed that on
all six platforms, and `tooling/ci/assert-launcher-icons.mjs` now fails the build
if any launcher icon is byte-identical to Flutter's.

⚠️ **What is still open is `[10]D-6`, and it is the opposite problem.** Subly's
icon is the *Nikatru* brand mark, so app #2 stamped from the same brick inherits
the same picture — which is the clone tell D-6 exists to prevent, and Play
enforces against **related accounts**. Not this directory's fix, but this is
where somebody looking at listing art will think of it.
