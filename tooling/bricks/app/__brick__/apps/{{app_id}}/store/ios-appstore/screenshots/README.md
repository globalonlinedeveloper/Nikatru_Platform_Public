# Screenshots — {{{short_name}}} · `ios-appstore`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

Apple requires screenshots per DEVICE SIZE CLASS, and the required sizes
change with the hardware line-up. No size for this channel has been fetched from
a primary source, so `tooling/channel-register.json` declares none and none is
enforced — **UNVERIFIED**. Read App Store Connect's current media
specifications and record the sizes with their URL and date before capturing.

## How to fill it

1. Build and run the app for this platform.
2. Capture the frames. `tooling/store/capture-play-screenshots.mjs` does it
   for Play against a live build and writes `CAPTURE.json` recording which
   build was photographed — a screenshot with no provenance is evidence about
   nothing.
3. Commit the PNGs here. `tooling/ci/assert-listing-assets.mjs` measures them
   against the numbers in `tooling/channel-register.json`, every one of which
   carries the primary-source URL it was read from.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
