# Screenshot slots — Microsoft Store (`windows-store`)

Drop the listing images for this channel in **this directory**. Nothing here is
generated: screenshots are the one listing field that cannot be derived from a
spec var, so the tree carries the SLOT and the rules, and a human fills it.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty — that is the "the slot is still declared" half. It deliberately does
**not** require image files: there are none yet, the channel is `served: false`,
and failing CI on artwork only the owner can produce would block every build on
`OWNER_QUEUE A-2`. The gap is PRINTED on every guard run instead.

## ⚠️ Required dimensions: UNVERIFIED — do not fill a number in from memory

| Field | Value | Status |
|---|---|---|
| Screenshot pixel dimensions (min/max) | — | ⚠️ **UNVERIFIED** — not fetched from a Microsoft page |
| Number of screenshots (min/max) | — | ⚠️ **UNVERIFIED** |
| Store logo / tile image sizes | — | ⚠️ **UNVERIFIED** |
| Trailer / video specs | — | ⚠️ **UNVERIFIED** |
| Accepted file formats | — | ⚠️ **UNVERIFIED** |

🔴 **Why this table is empty rather than helpful.** An invented limit fires on
**correct** input. This repo has already rejected its own fixture at 129
characters against a made-up "120 or fewer". `Private/company/pipeline/10-distribution-store.md`
D-5 records screenshot dimensions for **every** store as
`COULD-NOT-ESTABLISH — not fetched; do not write a number here from memory`, and
that is still true. Fill this table in the same increment that fetches the
Partner Center image-requirements page, **with the URL and the date**, or leave
it marked UNVERIFIED.

Partner Center rejects a submission with the wrong image sizes and tells you the
right ones, so the cost of not guessing is one rejected draft — cheaper than a
number in the repo that everyone trusts and nobody sourced.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. Partner Center shows
them in upload order and the order is part of the listing, so the number is the
listing's, not the filesystem's.

## ⬜ Also missing, and it is not a screenshot

There is **no Subly-specific app icon**. `apps/subly/pubspec.yaml`'s `msix_config`
has no `logo_path`, so `dart run msix:create` falls back to the `msix` package's
own default icons. That is fine for a build proof and **not** fine for a
submission: `[10]D-6` requires a distinct visual identity per app, precisely so
fifty apps stamped from one brick do not reach the store looking identical.
