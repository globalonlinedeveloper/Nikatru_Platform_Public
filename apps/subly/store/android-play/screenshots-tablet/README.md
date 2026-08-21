# Tablet screenshots — the set that is DECLARED and NOT YET CAPTURED

This directory is empty of PNGs on purpose, and this file exists because **git cannot carry an
empty directory** while `tooling/ci/assert-play-device-coverage.mjs` refuses a declared set whose
directory is missing — "a claim over nothing". Every guard here filters to `.png`, so a `.md`
alongside the eventual frames is inert.

## Why the row was declared before the pixels existed

Play's minimum is **two device types**, not two files. Subly declared one — phone — and four
1080×1920 phone frames satisfied a *count* while failing the *type* requirement. The register's own
note calls that "the single most likely cause of a first-submission bounce".

The `tablet` row now sits in `tooling/channel-register.json` under
`android-play → …deviceTypeCoverage.sets`, carrying its dimension rule and a fetched source. The
house rule that governs this — recorded in that same file — is that a form-factor row arrives **with**
its dimension rule and a re-fetched source, and that a limit with no artefact behind it is refused.

## What the guard does in each state, measured 2026-08-21

| state | `assert-play-device-coverage.mjs` | `--for-submission` |
|---|---|---|
| row declared, directory MISSING | **EXIT 1** — "does not exist … capture the set or remove the row" | EXIT 1 |
| row declared, directory present, no PNGs (**today**) | **EXIT 0**, shortfall PRINTED | **EXIT 1** — correct, submission is blocked |
| row declared, 4+ PNGs present | EXIT 0 | EXIT 0 |

That middle row is the designed state: the shared lane stays green so unrelated work is not blocked,
and the submission lane stays red so the listing cannot go out one device type short.

## What has to land here

**Four or more portrait frames**, per the sourced requirement quoted in the register:

> "For Chromebook and tablets, you can add a minimum of 4 screenshots to demonstrate your in-app
> experience. Upload screenshots between 1,080 and 7,680px Use a 16:9 aspect ratio for landscape and
> a 9:16 aspect ratio for portrait"
> — support.google.com/googleplay/android-developer/answer/9866151, fetched 2026-08-21

## How to produce them — NOT by hand

`node tooling/store/capture-play-screenshots.mjs --app subly` now drives **both** viewports and
writes each set to its own directory.

🔴 **It cannot run on the owner's machine**: chromedriver is not on PATH and `CHROMEDRIVER` is unset
(measured 2026-08-21). It runs in CI, through the same `flutter drive` + `integration_test` harness
`e2e.yml` drives nightly.

⚠️ **Do not drop a hand-made frame in here.** The capture path goes through the guarded shutter at
`apps/subly/integration_test/store_capture_guard.dart`, which exists because of the account-leak
repair recorded in `../screenshots/README.md`. A screenshot that did not come through that shutter
has not been through the check that stops a real account appearing in a store listing.
