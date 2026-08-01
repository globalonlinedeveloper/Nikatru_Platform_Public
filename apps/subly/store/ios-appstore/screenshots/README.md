# Screenshot slots — Apple App Store, iOS (`ios-appstore`)

Drop the listing images for this channel in **this directory**. Nothing here is
generated: screenshots are the one listing field that cannot be derived from a
spec var, so the tree carries the SLOT and the rules, and a human fills it.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty — that is the "the slot is still declared" half. It deliberately does
**not** require image files: there are none yet, the channel is `served: false`,
and failing CI on artwork only the owner can produce would block every build on
`OWNER_QUEUE A-4`. The gap is PRINTED on every guard run instead.

## ⚠️ Required dimensions: COULD-NOT-ESTABLISH — do not fill a number in from memory

| Field | Value | Status |
|---|---|---|
| Screenshot pixel dimensions, per required device class | — | ⚠️ **COULD-NOT-ESTABLISH** — not fetched from an Apple page |
| Which device classes are mandatory for a submission | — | ⚠️ **COULD-NOT-ESTABLISH** |
| Number of screenshots (min/max) per class | — | ⚠️ **COULD-NOT-ESTABLISH** |
| App preview (video) duration, resolution, format | — | ⚠️ **COULD-NOT-ESTABLISH** |
| App icon size for App Store Connect | — | ⚠️ **COULD-NOT-ESTABLISH** |
| Accepted file formats | — | ⚠️ **COULD-NOT-ESTABLISH** |

🔴 **Why this table is empty rather than helpful.** An invented limit fires on
**correct** input. This repo has already rejected its own fixture at 129
characters against a made-up "120 or fewer".
`company/pipeline/10-distribution-store.md` D-5 records screenshot dimensions for
**every** store as *"COULD-NOT-ESTABLISH — not fetched; do not write a number
here from memory"*, and that is still true. Fill this table in the same increment
that fetches Apple's screenshot-specifications page, **with the URL and the
date**, or leave it marked UNVERIFIED.

App Store Connect rejects an upload with the wrong image sizes and tells you the
accepted ones, so the cost of not guessing is one rejected upload — cheaper than
a number in the repo that everyone trusts and nobody sourced.

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
