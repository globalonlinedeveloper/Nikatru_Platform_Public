# Screenshot slots — Microsoft Store (`windows-store`)

The listing images for this channel go in **this directory**. Nothing here is
drawn by hand: since 2026-09-22 the frames are CAPTURED, by
`.github/workflows/store-screenshots.yml` dispatched with `channel:
windows-store`, which drives the REAL Windows binary on a hosted Windows runner
and opens a pull request with the pixels in it. A human still looks at the
images before they merge — that is the whole point of the pull request.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty. It deliberately does **not** require image files: there are none yet,
the channel is `served: false`, and failing CI on artwork nobody has captured
would block every build on `OWNER_QUEUE A-2`. The gap is PRINTED on every guard
run instead.

⚠️ **These cannot be borrowed from another channel.** A Windows listing shows
Windows window chrome and Segoe UI; a macOS or Linux capture dropped here shows
the wrong chrome and the wrong system fonts, and a reviewer sees it immediately.

## The rules — in `tooling/channel-register.json`, not here

This file used to carry a table of `UNVERIFIED` rows, because in 2026-08 no
Microsoft image-requirements page had been read. The numbers now live in one
place:
`storeMetadataContract.perChannel["windows-store"].graphicAssets.screenshots` in
`tooling/channel-register.json`, each beside a dated `source` saying where it
came from and which of them are this repository's own HOUSE RULES rather than
the store's. `tooling/ci/assert-listing-assets.mjs` grades the pixels against
the register — never against this page — so a number copied into this README
would be a second copy that drifts.

Two things worth knowing before you look at a frame:

- **There is no maximum dimension in the register, on purpose.** Microsoft
  publishes a minimum (and a generous per-file byte cap); no upper bound was
  read from a Microsoft page, and an invented ceiling fires on *correct* input.
  If a run ever needs one, fetch the page, record the URL and the date, and add
  it in that same change.
- **The capture is never resized or cropped afterwards.** The register names
  the exact accepted size; if a frame misses it, the answer is to capture again
  at the right geometry, not to re-encode a captured frame.

## One language, deliberately

The Store lets a listing carry a different screenshot set per language. This
listing ships **one English set** and that is a decision, not an omission: a
second language means a second captured set, a second review and a second thing
to keep true, and nothing in the current plan sells into a market that needs it.
Revisit it when a market does — and when you do, revisit the *store listing
text* at the same time, because a translated gallery over English copy reads
worse than neither.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. Partner Center shows
them in upload order and the order is part of the listing, so the number is the
listing's, not the filesystem's.

## Where these are uploaded

By hand, into the Partner Center submission's **Store listings → Screenshots**
section, in the order their filenames give. No API call in this repository
uploads them; the packaging workflow ships the `.msix`, which is a different
filing from the listing page.

## ⬜ Also missing, and it is not a screenshot

There is **no app-specific icon**. `apps/subscriptiontracker/pubspec.yaml`'s
`msix_config` has no `logo_path`, so `dart run msix:create` falls back to the
`msix` package's own default icons. That is fine for a build proof and **not**
fine for a submission: `[10]D-6` requires a distinct visual identity per app,
precisely so fifty apps stamped from one brick do not reach the store looking
identical.
