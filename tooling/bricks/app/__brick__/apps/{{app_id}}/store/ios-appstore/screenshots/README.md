# Screenshots — {{{short_name}}} · `ios-appstore`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

Apple requires screenshots per DEVICE SIZE CLASS. This directory is the
**iPhone** set; `../screenshots-ipad/` is the iPad one, and a submission needs
both — `tooling/ci/assert-play-device-coverage.mjs` holds the register's
`minDistinctTypes: 2` for this channel over every app stamped from this brick.

The sizes and counts are declared in `tooling/channel-register.json` under
`storeMetadataContract.perChannel["ios-appstore"].graphicAssets.screenshots`,
each beside a dated `source`. Read them there rather than here. Note what is
NOT declared at channel level: an `acceptedSizes` list, because what was
recorded is the size Apple currently REQUIRES per class rather than the full
list it accepts, and an incomplete exact list refuses a correct frame. Apple's
required classes move with the hardware line-up — re-fetch the specification
before a submission and record the URL and the date in the same change.

## How to fill it

1. Build and run the app for this platform.
2. Capture the frames. `tooling/store/capture-play-screenshots.mjs --channel
   ios-appstore` does it against a live build on the simulators the register
   names, for BOTH size classes in one run, and writes `CAPTURE.json` recording
   which build was photographed — a screenshot with no provenance is evidence
   about nothing. Dispatch `.github/workflows/store-screenshots.yml` with
   `channel: ios-appstore` to run it on a machine that has Xcode.
3. Commit the PNGs here. `tooling/ci/assert-listing-assets.mjs` measures them
   against the numbers in `tooling/channel-register.json`, every one of which
   carries the primary-source URL it was read from.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
