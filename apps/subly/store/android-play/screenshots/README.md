# Screenshot slot — Google Play (`android-play`)

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

## ⬜ Why this directory is still empty

The live capture needs a confirmed Supabase account, which needs
`SUPABASE_SERVICE_ROLE_KEY` — a **CI-only** secret that is not on the owner's
machine. Run **`store-screenshots.yml`** (`workflow_dispatch`); it provisions a
throwaway confirmed user, captures the set, checks it against the guard, uploads
it as an artifact and purges the user again.

It **uploads rather than commits** on purpose: the guard can prove size, format,
count and posture, and cannot prove the set is worth showing. Google requires
screenshots to *"demonstrate the actual in-app or in-game experience"* — a human
call.

`assert-listing-assets.mjs` PRINTS this gap on every run rather than failing,
because it is blocked on a workflow run. It does **not** extend that leniency to
the feature graphic or the store icon: those are produced from brand art already
in this tree by one command with no account and no secret, so a missing one is a
build failure.

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
