# Screenshot slot — Google Play (`android-play`), phone set

This file is the PROCEDURE for the Play phone screenshot set. What the set holds
today — its frames, their size, the viewport, the count, the posture — is recorded
by the capture in `CAPTURE.json` beside this file and measured by the guards below.
Read those; this file restates none of it (`tooling/ci/assert-derived-sets.mjs`
refuses a README that repeats a value `CAPTURE.json` records). The history of this
directory is in `git log -- apps/subscriptiontracker/store/android-play/screenshots`.

## How the set is made

Nothing here is drawn by hand or dropped in from a phone. The set is an OUTPUT of
one workflow, and a change to it arrives as a pull request:

1. **Capture.** Dispatch **Store screenshots** (`.github/workflows/store-screenshots.yml`,
   `workflow_dispatch`, app `subscriptiontracker`, channel `android-play`). It
   provisions a throwaway confirmed user against the sandbox Workers, drives a LIVE
   build through `tooling/store/capture-play-screenshots.mjs --app subscriptiontracker`,
   and writes the frames and `CAPTURE.json` here and in `../screenshots-tablet/`.
   A `dry_run: true` dispatch does all of it and opens no pull request.
2. **Check.** The same job runs `tooling/ci/assert-listing-assets.mjs` (count,
   dimensions against `CAPTURE.json`, aspect, format, recorded posture, the demo
   banner and the ink of every frame) and `tooling/ci/assert-play-device-coverage.mjs`.
3. **Finish.** The job runs
   `node --single-threaded tooling/store/finish-capture.mjs --app subscriptiontracker --channel android-play`,
   which re-derives every set whose register entry declares `derivedFrom` on this
   channel (today the apps.gov.in screenshots and icon, `../../apps-gov-in/`) and
   prints each path, then `tooling/ci/assert-derived-sets.mjs`, which compares every
   derived set's recorded source hashes with these files.
4. **Propose.** The job's pull request adds both capture directories and every path
   the finish step printed. Merging it is the human review: open the images in the
   Files changed tab. No guard can judge whether these are the screens worth
   showing, and Google requires screenshots to *"demonstrate the actual in-app or
   in-game experience"*.
5. **Purge.** The throwaway user is deleted whatever happened above.

To re-derive locally after a merge that changed these frames:

```
node --single-threaded tooling/store/finish-capture.mjs --app subscriptiontracker --channel android-play
```

## Rules this set is graded against

The Play screenshot rules (count, dimensions, aspect, format, device types), each
with its source quoted verbatim, live in `tooling/channel-register.json` →
`storeMetadataContract.perChannel["android-play"].graphicAssets.screenshots`.
`tooling/ci/assert-listing-assets.mjs` enforces them from there, and refuses a
limit declared without a `source`: an invented limit fires on correct input.

## Rules for editing this directory

- **Never commit a frame by hand**, and never edit `CAPTURE.json` by hand: it is
  the capture's record, and the guards compare the frames to it.
- **A demo build is never captured into this directory.** The capture suite refuses
  to run against a demo build unless `STORE_CAPTURE_ALLOW_DEMO` is passed, the
  runner sends `--proof` output to a throwaway directory, and the listing guard
  rejects a frame whose `CAPTURE.json` does not record a live posture.
- **Naming is `NN-<slug>.png`, ordered.** Play shows frames in upload order and
  the order is part of the listing. Google: *"prioritize UI in the first three
  screenshots as much as possible"*.
- **A proof capture** (`node tooling/store/capture-play-screenshots.mjs --proof`)
  writes to a temporary directory, never here.

## ⏱ 2026-10-02 — not captured, and why

Dispatched three times from branch `fix/store-screenshots-all-channels` (row O-STORE-SCREENSHOTS); the committed set predates the redesign trains (ST-D0..D10 and #1130) and its CAPTURE.json names no commit, so `node tooling/ci/assert-listing-assets.mjs --for-submission --channel android-play` refuses it. Two of the three runs (36952954410 and 36955795858) stopped at the preflight: the sandbox platform Worker answered `ok:false` with `supabase_jwks: probe_timeout`, and healthy a minute later. The other, 36953158433, stopped on the terms interstitial because the web drive served on a random localhost port the platform Worker refuses (fixed on this branch: `--web-port=3000`). The re-capture, and the apps.gov.in set derived from it, also wait on the seeding fix every native channel hit: since #1130 the add FAB opens the catalogue pick step, and the suite types into a name field behind it. No frame is made by hand in its place.
