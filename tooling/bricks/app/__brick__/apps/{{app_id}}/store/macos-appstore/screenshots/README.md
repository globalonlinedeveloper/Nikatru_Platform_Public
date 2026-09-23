# Screenshots — {{{short_name}}} · `macos-appstore`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

Apple accepts an EXACT LIST of sizes for this platform rather than a range, and
that list is declared in `tooling/channel-register.json` under
`storeMetadataContract.perChannel["macos-appstore"].graphicAssets.screenshots`,
each entry beside a dated `source`. `tooling/ci/assert-listing-assets.mjs`
enforces it against the pixels. Read it there rather than here: an exact list is
a stronger check than a minimum, because a minimum passes frames that are above
it and still not a size Apple takes.

## How to fill it

1. Build and run the app for this platform.
2. Capture the frames. `tooling/store/capture-play-screenshots.mjs --channel
   macos-appstore` does it against a live build of the REAL macOS binary and
   writes `CAPTURE.json` recording which build was photographed — a screenshot
   with no provenance is evidence about nothing. Dispatch
   `.github/workflows/store-screenshots.yml` with `channel: macos-appstore` to
   run it on a machine that has the toolchain and a desktop.
3. Commit the PNGs here. `tooling/ci/assert-listing-assets.mjs` measures them
   against the numbers in `tooling/channel-register.json`, every one of which
   carries the primary-source URL it was read from.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
