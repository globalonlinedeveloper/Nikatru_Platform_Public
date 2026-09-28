# Screenshots — {{{short_name}}} · `apps-gov-in`

**This directory is stamped EMPTY on purpose.** Every other field in this tree
is derived from the app spec by `tooling/bricks/app`. Screenshots cannot be:
they are pictures of a build that does not exist at stamp time.

## What the portal accepts

The rules come from the upload form's own script (`/Developer/chunk-ZVEOEZCZ.js`),
read on 2026-09-22, and live in `contracts/store/vocabulary.js`
`STORE_FORM_RULES["apps-gov-in"]`: the one exact screenshot size the form
accepts, the count, the formats, the per-file byte cap, and the icon
(`../store-icon-512.png`). `tooling/ci/assert-store-metadata.mjs` applies every
one. While the app is `preview` in the catalogue, an empty directory here is
printed; once it is `live`, an empty directory fails the build. This README does
not repeat those numbers: once the set is derived, `CAPTURE.json` beside it
records them, and `tooling/ci/assert-derived-sets.mjs` refuses a README that
restates a value its `CAPTURE.json` records.

## How to fill it

Do not capture for this channel. The set is DERIVED from the app's `android-play`
phone screenshots, which must be a LIVE capture (their `CAPTURE.json` says posture
`live`). `tooling/channel-register.json` declares it: the apps-gov-in
`derivedScreenshots` block and `store-icon-512.png` asset carry `derivedFrom`,
naming `tooling/ci/assert-apps-gov-in-media.mjs` as the deriver.

1. Dispatch **Store screenshots** for this app, channel `android-play`.
2. The job runs `tooling/store/finish-capture.mjs --app {{app_id}} --channel android-play`,
   which pads each Play screenshot to the portal's shape, shrinks it to the
   portal's size, copies the Play store icon beside this directory, and writes
   `CAPTURE.json` recording every source and its SHA-256.
3. `tooling/ci/assert-derived-sets.mjs` checks those source hashes in the same job,
   and the pull request carries the Play frames and this set together.

To derive locally once the Play set exists:

```
node --single-threaded tooling/store/finish-capture.mjs --app {{app_id}} --channel android-play
```

In CI, `tooling/ci/assert-derived-sets.mjs` fails when a Play screenshot changed
and this set was not re-derived, and `tooling/ci/assert-apps-gov-in-media.mjs`
re-derives every file and fails when one was edited by hand.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen: seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
