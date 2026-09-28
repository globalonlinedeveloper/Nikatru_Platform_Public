# Tablet screenshots — Google Play (`android-play`)

This file is the PROCEDURE for the Play tablet screenshot set. What the set holds
today — its frames, their size, the viewport, the count, the device type, the
posture — is recorded by the capture in `CAPTURE.json` beside this file and
measured by the guards below; this file restates none of it
(`tooling/ci/assert-derived-sets.mjs` refuses a README that repeats a value
`CAPTURE.json` records). The history of this directory is in
`git log -- apps/subscriptiontracker/store/android-play/screenshots-tablet`.

## Why the set exists

Play's minimum is **two device types**, not two files. This set is the second type.
Its row sits in `tooling/channel-register.json` under
`storeMetadataContract.perChannel["android-play"].graphicAssets.screenshots.deviceTypeCoverage.sets.tablet`,
carrying its dimension rule, the viewport it is captured at, and the page it was
fetched from, quoted verbatim.

## How it is made — NOT by hand

The Play capture drives **both** viewports and writes each set to its own
directory, so the procedure is the phone set's, in `../screenshots/README.md`:
dispatch **Store screenshots** for app `subscriptiontracker`, channel `android-play`;
the job captures, runs the listing and device-coverage guards, runs
`tooling/store/finish-capture.mjs --app subscriptiontracker --channel android-play`
and `tooling/ci/assert-derived-sets.mjs`, and proposes both capture directories
and every derived path in one pull request.

The live capture cannot run on a machine without chromedriver and the CI-only
secrets; it runs in CI and lands as that pull request.

## What grades it

`tooling/ci/assert-play-device-coverage.mjs` opens each frame and applies the
`tablet` row's own numbers, so these frames are graded by the tablet rule and not by
the phone one. On the shared lane an empty set prints its shortfall; with
`--for-submission=android-play` the same shortfall refuses the Play upload.
`tooling/ci/test/play-device-coverage.test.mjs` holds both directions.

⚠️ **Do not drop a hand-made frame in here.** A frame that did not come through the
guarded shutter in `apps/subscriptiontracker/integration_test/store_capture_guard.dart`
has not been through the check that stops a real account appearing in a store listing.
