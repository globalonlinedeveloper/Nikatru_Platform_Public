# Screenshot slots — Apple App Store, macOS (`macos-appstore`)

The listing images for this channel go in **this directory**. Nothing here is
drawn by hand: since 2026-09-22 the frames are CAPTURED, by
`.github/workflows/store-screenshots.yml` dispatched with `channel:
macos-appstore`, which drives the REAL macOS binary on a hosted macOS runner and
opens a pull request with the pixels in it. A human still looks at the images
before they merge — that is the whole point of the pull request.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty. It deliberately does **not** require image files: there are none yet,
the channel is `served: false`, and failing CI on artwork nobody has captured
would block every build on `OWNER_QUEUE A-4`. The gap is PRINTED on every guard
run instead.

⚠️ **macOS screenshots are their own set.** They are not the iOS images at a
different size — the window chrome, the aspect ratio and the content density are
all different, and an iOS screenshot submitted for macOS looks exactly like what
it is. This directory stays separate from `../../ios-appstore/screenshots/` on
purpose.

## The rules — in `tooling/channel-register.json`, not here

This file used to carry a table of `COULD-NOT-ESTABLISH` rows, because in
2026-08 no Apple specification page had been read. The numbers now live in one
place:
`storeMetadataContract.perChannel["macos-appstore"].graphicAssets.screenshots`
in `tooling/channel-register.json`, each beside a dated `source`.
`tooling/ci/assert-listing-assets.mjs` grades the pixels against the register —
never against this page.

The one shape worth understanding before you capture:

- **Apple accepts an EXACT LIST of sizes, not a range.** The register therefore
  names `acceptedSizes` rather than a `minWidth`, and that is the stronger
  check: a minimum would happily pass a frame that is above it and still not one
  of the sizes Apple takes, which is a rejection you would only find out about
  from App Store Connect.
- **The capture set narrows further.** The register's device-type set names the
  single size this repository actually captures, so the guard refuses a mixed
  set. A listing whose frames are half one size and half another is a listing
  assembled from two different runs.
- **Never resize a captured frame** to reach an accepted size. Capture again at
  the right geometry; a rescaled screenshot shows it in the text.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. Upload order is part
of the listing, so the number is the listing's, not the filesystem's.

## Where these are uploaded

By hand, into the App Store Connect version's **App Previews and Screenshots**
section for the macOS platform, in the order their filenames give. No API call
in this repository uploads them.

## ⬜ Also missing, and it is not a screenshot

There is **no app-specific icon**. `[10]D-6` requires a distinct visual identity
per app so that fifty apps stamped from one brick do not reach the store looking
identical.

## ⏱ 2026-10-02 — not captured, and why

Dispatched twice from branch `fix/store-screenshots-all-channels` (row O-STORE-SCREENSHOTS); run 36952983438 stopped on the new after-sign-in setup ("Step 1 of 3 | Your home currency"; the suite now skips it). Run 36955811141 got past it to Home. On the second run every drive that got past sign-in signed in, skipped the after-sign-in setup, reached Home, and stopped in `addThroughSheet` (integration_test/store_screenshots_test.dart): "The add sheet did not open". Since #1130 the add FAB opens the catalogue pick step ("Search services | POPULAR | Netflix …") and the name field the suite types into is behind it, so the suite cannot seed the rows its frames show. The fix is in the suite (choose the custom entry from the pick step before typing), not in this directory. No frame is made by hand in its place.
