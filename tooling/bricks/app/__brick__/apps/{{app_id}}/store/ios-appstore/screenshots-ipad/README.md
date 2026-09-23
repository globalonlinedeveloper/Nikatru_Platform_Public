# Screenshots — {{{short_name}}} · `ios-appstore`, iPad set

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

**The iPad set is a SECOND required set, not a copy of the iPhone one.** Apple
grades iPhone and iPad screenshots separately on the same version record, and
`tooling/ci/assert-play-device-coverage.mjs` enforces that here: the register
declares `minDistinctTypes: 2` for this channel, so an app stamped with only
`../screenshots/` is born unpublishable and nothing would say so until the
upload was rejected. This file is what holds the second slot open — git cannot
commit an empty directory.

The sizes and counts are declared in `tooling/channel-register.json` under
`storeMetadataContract.perChannel["ios-appstore"].graphicAssets.screenshots.deviceTypeCoverage.sets["ipad"]`,
each beside a dated `source`. Read them there rather than here. Apple's required
size classes move with the hardware line-up, so re-fetch the specification
before a submission and record the URL and the date in the same change.

## How to fill it

1. Build and run the app for this platform.
2. Capture the frames. `tooling/store/capture-play-screenshots.mjs --channel
   ios-appstore` does it against a live build on the simulator the register
   names, for BOTH sets in one run, and writes `CAPTURE.json` recording which
   build was photographed — a screenshot with no provenance is evidence about
   nothing. Dispatch `.github/workflows/store-screenshots.yml` with `channel:
   ios-appstore` to run it on a machine that has Xcode.
3. Commit the PNGs here. `tooling/ci/assert-listing-assets.mjs` measures them
   against the numbers in `tooling/channel-register.json`.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.

An iPhone frame scaled up. It is the classic iPad rejection, and it is also not
what the app renders at tablet width.
