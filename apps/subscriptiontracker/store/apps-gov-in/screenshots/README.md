# Screenshots — Nikatru Subscription Tracker · `apps-gov-in`

This file is the PROCEDURE for the apps.gov.in screenshot set. Nothing here was
captured for this channel: every image is DERIVED from the `android-play` phone
set, and the store icon one level up (`../store-icon-512.png`) is a byte copy of
the Play store icon. What the set holds today — its files, their size, the count,
each source and its SHA-256 — is recorded in `CAPTURE.json` beside this file; this
file restates none of it (`tooling/ci/assert-derived-sets.mjs` refuses a README
that repeats a value `CAPTURE.json` records).

## Where the derivation is declared

`tooling/channel-register.json` →
`storeMetadataContract.perChannel["apps-gov-in"].graphicAssets`: the
`derivedScreenshots` block (this directory) and the `store-icon-512.png` asset each
carry `derivedFrom: { channel: "android-play", set, deriver }`, and the deriver is
`tooling/ci/assert-apps-gov-in-media.mjs`. Its header states the derivation step by
step (pad to the portal's aspect ratio by repeating edge rows, then an exact area
average, then a 24-bit PNG with no alpha), so a reader can repeat it by hand.

## How the set is made — after every Play capture

1. **Store screenshots** captures the Play set (`../../android-play/screenshots/README.md`).
2. The same job runs
   `node --single-threaded tooling/store/finish-capture.mjs --app subscriptiontracker --channel android-play`,
   which runs this channel's deriver and prints this directory and the icon path.
3. `tooling/ci/assert-derived-sets.mjs` checks, in that job, that every source hash
   recorded in `CAPTURE.json` (`derivation.sources`) matches the Play files.
4. The job's pull request adds the capture directories and every printed path, so
   the Play frames and this set arrive together.

To re-derive locally after a Play set landed any other way:

```
node --single-threaded tooling/store/finish-capture.mjs --app subscriptiontracker --channel android-play
```

## What checks it

- `tooling/ci/assert-derived-sets.mjs` (ci.yml, and Store screenshots before its
  pull request opens): the recorded source hashes against the Play files. It
  decodes no image.
- `tooling/ci/assert-apps-gov-in-media.mjs` (ci.yml, `node --single-threaded`):
  re-derives every file and compares the pixels, so a hand-edited image fails too.
- `tooling/ci/assert-store-metadata.mjs`: the portal's own rules, from
  `contracts/store/vocabulary.js` `STORE_FORM_RULES["apps-gov-in"]` (read from the
  upload form's script; the Private runbook
  `runbooks/store-submission-apps-gov-in.md`, Step 2, records the reading).

Never hand-place an image here, and never edit `CAPTURE.json` by hand.
