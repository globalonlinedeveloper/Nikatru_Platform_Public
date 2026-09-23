# Screenshots — {{{short_name}}} · `linux-snap`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

The Snap Store's rules for this gallery ARE declared, in
`tooling/channel-register.json` under
`storeMetadataContract.perChannel["linux-snap"].graphicAssets.screenshots`, and
they are enforced against the pixels by `tooling/ci/assert-listing-assets.mjs`.
Read them there rather than here: each number carries a dated `source` saying
which page it came from, and which of them are this repository's own HOUSE
RULES rather than the store's — a distinction a copy in prose loses.

## How to fill it

1. Build and run the app for this platform.
2. Capture the frames. `tooling/store/capture-play-screenshots.mjs --channel
   linux-snap` does it against a live build of the REAL Linux binary and
   writes `CAPTURE.json` recording which build was photographed — a screenshot
   with no provenance is evidence about nothing. Dispatch
   `.github/workflows/store-screenshots.yml` with `channel: linux-snap` to run
   it on a machine that has the toolchain and an X server.
3. Commit the PNGs here. `tooling/ci/assert-listing-assets.mjs` measures them
   against the numbers in `tooling/channel-register.json`, every one of which
   carries the primary-source URL it was read from.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
