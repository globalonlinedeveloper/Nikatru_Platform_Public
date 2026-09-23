# Screenshot slots — Apple App Store, iOS (`ios-appstore`)

Drop the listing images for this channel in **this directory**. Nothing here is
generated: screenshots are the one listing field that cannot be derived from a
spec var, so the tree carries the SLOT and the rules, and a human fills it.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty — that is the "the slot is still declared" half. It deliberately does
**not** require image files: there are none yet, the channel is `served: false`,
and failing CI on artwork only the owner can produce would block every build on
artwork nobody has produced. (It used to say `OWNER_QUEUE A-4`; that row closed
2026-08-31 and screenshots were never gated on it.) The gap is PRINTED on every
guard run instead.

## 🔴 This directory is only HALF the listing

The **iPad** set lives in `../screenshots-ipad/`, and App Store Connect requires
both: it grades the iPhone and the iPad sets separately on the same version
record. `tooling/ci/assert-play-device-coverage.mjs` enforces that here —
`minDistinctTypes: 2` — so a submission with this directory full and the other
empty is a finding on the lane rather than a rejection at Apple.

The iPad frames are not these frames scaled up. Capturing them is the same one
workflow run; see below.

## The rules — in `tooling/channel-register.json`, not here

This file used to carry a table of `COULD-NOT-ESTABLISH` rows, because in 2026-08
no Apple specification page had been read. The sizes and counts now live in one
place:
`storeMetadataContract.perChannel["ios-appstore"].graphicAssets.screenshots` in
`tooling/channel-register.json`, each beside a dated `source`.
`tooling/ci/assert-listing-assets.mjs` grades the pixels against the register —
never against this page.

Two things about the shape of those rules, because they are not the same shape
as the other channels':

- **The exact sizes live on the SETS, not on the channel.** What was recorded is
  the size Apple currently REQUIRES per device class, not the full list it
  accepts, and an exact list that is missing an accepted size refuses a
  **correct** frame. So the channel declares no `acceptedSizes` and each set
  declares the one size this repository actually captures — a claim about this
  repository, not about Apple. Promote them to the channel on the day someone
  fetches the full list, with the URL and the date.
- **This row has a known expiry.** Apple's required size classes move with the
  hardware line-up. Re-fetch before a submission; the capture workflow will also
  go red on its own the year the simulator names age out, which is the cheap way
  to find out.

## How these are captured

Since 2026-09-22 the frames are CAPTURED, not drawn: dispatch
`.github/workflows/store-screenshots.yml` with `channel: ios-appstore`. One run
boots the simulators the register names, drives the REAL iOS build with the real
backend defines, fills **both** directories from that one build and one
signed-in account, and opens a pull request with the pixels in it. A human still
looks at the images before they merge — that is the whole point of the pull
request, and the iPad frames are the ones to look hardest at.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. App Store Connect
shows them in upload order and the order is part of the listing, so the number is
the listing's, not the filesystem's. If more than one device class turns out to
be required, add one subdirectory per class **named after whatever Apple's own
page calls it** — not after a name invented here.

## ⬜ Also missing, and it is not a screenshot

There is **no Subly-specific app icon**. `[10]D-6` requires a distinct visual
identity per app, precisely so fifty apps stamped from one brick do not reach the
store looking identical. That is unbuilt for every channel, not just this one.
