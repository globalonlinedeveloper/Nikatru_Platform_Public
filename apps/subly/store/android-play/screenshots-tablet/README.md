# Tablet screenshots — Google Play (`android-play`)

## 🟢 THE SET IS HERE — landed 2026-08-27 from run `33030877470`

This file read *"the set that is DECLARED and NOT YET CAPTURED"* until that run, the first whose
capture drove both viewports. Four frames now sit beside it (every guard here filters to `.png`, so
this file stays inert):

| file | pixels | colour type | bytes |
| --- | --- | --- | --- |
| `01-home.png` | 1800×3200 | 2 (24-bit, no alpha) | 605,658 |
| `02-calendar.png` | 1800×3200 | 2 | 125,806 |
| `03-insights.png` | 1800×3200 | 2 | 101,608 |
| `04-budget.png` | 1800×3200 | 2 | 124,475 |

`CAPTURE.json` came with them and records `deviceType: "tablet"`, `posture: "live"`, `count: 4`,
`pixels: "1800x3200"`, `viewport: "900x1600@2"` — written by the capture script on the run, not by
hand afterwards.

**No Settings frame on this viewport either, and nothing here can photograph the account.** Every
frame is released by the guarded shutter in `apps/subly/integration_test/store_capture_guard.dart`,
which reads the live widget tree one instruction before the capture; the account-leak repair that put
it there is recorded in `../screenshots/README.md`.

## Why the row was declared before the pixels existed

Play's minimum is **two device types**, not two files. Subly declared one — phone — and four
1080×1920 phone frames satisfied a *count* while failing the *type* requirement. The register's own
note calls that "the single most likely cause of a first-submission bounce".

The `tablet` row sits in `tooling/channel-register.json` under
`android-play → …deviceTypeCoverage.sets`, carrying its dimension rule and a fetched source. The
house rule that governs this — recorded in that same file — is that a form-factor row arrives **with**
its dimension rule and a re-fetched source, and that a limit with no artefact behind it is refused.

## What the guard does in each state — rows 1–2 measured 2026-08-21, row 3 on 2026-08-27

| state | `assert-play-device-coverage.mjs` | `--for-submission` |
|---|---|---|
| row declared, directory MISSING | **EXIT 1** — "does not exist … capture the set or remove the row" | EXIT 1 |
| row declared, directory present, no PNGs | **EXIT 0**, shortfall PRINTED | **EXIT 1** — submission blocked |
| row declared, 4+ PNGs present (**today**) | **EXIT 0** | **EXIT 0** |

That middle row was this tree from 2026-08-21 to 2026-08-27: the shared lane green so unrelated work
was not blocked, the submission lane red so the listing could not go out one device type short.
**Emptying this directory returns the tree to it** — which is what `tooling/ci/test/play-device-coverage.test.mjs`
turns red on.

## The rule these four are graded against

> "For Chromebook and tablets, you can add a minimum of 4 screenshots to demonstrate your in-app
> experience. Upload screenshots between 1,080 and 7,680px Use a 16:9 aspect ratio for landscape and
> a 9:16 aspect ratio for portrait"
> — support.google.com/googleplay/android-developer/answer/9866151, fetched 2026-08-21

1800×3200 is exactly 9:16, with both sides inside `[1080, 3840]` — 3840 being the stricter of the two
maxima that page states. `assert-play-device-coverage.mjs` opens each frame and applies **that row's
own** numbers, so these are graded by the tablet rule and not by the phone one.

## How to refresh them — NOT by hand

`node tooling/store/capture-play-screenshots.mjs --app subly` drives **both** viewports and writes
each set to its own directory.

🔴 **It cannot run on the owner's machine**: chromedriver is not on PATH and `CHROMEDRIVER` is unset
(measured 2026-08-21). It runs in CI, through the same `flutter drive` + `integration_test` harness
`e2e.yml` drives nightly, and lands as a pull request from `.github/workflows/store-screenshots.yml`.

⚠️ **Do not drop a hand-made frame in here.** A screenshot that did not come through the shutter above
has not been through the check that stops a real account appearing in a store listing.
