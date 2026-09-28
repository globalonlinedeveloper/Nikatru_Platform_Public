# Screenshots — {{{short_name}}} · `android-play`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

Google requires **at least two** screenshots to publish at all, recommends at
least four at 1080px minimum, and caps the long side at twice the short one.

🔴 **AND "AT LEAST TWO" IS A COUNT OF DEVICE TYPES, NOT OF FILES IN THIS
DIRECTORY.** Filling this directory with four phone frames does not make the
listing publishable: the verbatim sentence is *"a minimum of two screenshots
across different device types"*, and everything here is one type. The second
type is `../screenshots-tablet/`, stamped beside this one with its own numbers
and its own README, and `tooling/ci/assert-play-device-coverage.mjs` counts the
directories that carry pixels. Read that README before deciding this one is
done.

Every one of those numbers is in `tooling/channel-register.json` →
`storeMetadataContract.perChannel["android-play"].graphicAssets.screenshots`
with the primary-source URL and fetch date, and
`tooling/ci/assert-listing-assets.mjs` measures the PNGs against them.

The capture script REFUSES to write demo output here, and the guard decodes each
frame looking for the demo banner rather than trusting `CAPTURE.json`.

## How to fill it

1. Dispatch **Store screenshots** (`.github/workflows/store-screenshots.yml`) for
   this app, channel `android-play`.
2. `tooling/store/capture-play-screenshots.mjs` captures the frames against a
   live build and writes `CAPTURE.json` recording which build was photographed —
   a screenshot with no provenance is evidence about nothing. This README never
   repeats what that record holds (`tooling/ci/assert-derived-sets.mjs` refuses
   it). `tooling/ci/assert-listing-assets.mjs` measures the frames against the
   numbers in `tooling/channel-register.json`, every one of which carries the
   primary-source URL it was read from.
3. The job runs `tooling/store/finish-capture.mjs --app {{app_id}} --channel android-play`,
   which re-derives every set declared `derivedFrom` this channel (the
   apps.gov.in set among them), then `tooling/ci/assert-derived-sets.mjs`, and
   proposes the capture directories and every derived path in one pull request.
   The frames are never committed by hand.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
