# Screenshot slots — Snap Store (`linux-snap`)

Drop the listing images for this channel in **this directory**. Nothing here is
generated: screenshots are the one listing field that cannot be derived from a
spec var, so the tree carries the SLOT and the rules, and a human fills it.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty. It deliberately does **not** require image files: there are none yet,
the channel is `served: false`, and failing CI on artwork only the owner can
produce would block every build on `OWNER_QUEUE A-6`. The gap is PRINTED on every
guard run instead.

⚠️ **These cannot be borrowed from another channel.** Snap screenshots show a
Linux desktop; a Windows or macOS capture submitted here shows the wrong window
chrome and the wrong system fonts. There is also nothing to capture yet — no
`snapcraft.yaml` exists, so no `.snap` has ever been built.

## ⚠️ Required dimensions: COULD-NOT-ESTABLISH — do not fill a number in from memory

| Field | Value | Status |
|---|---|---|
| Screenshot pixel dimensions (min/max) | — | ⚠️ **COULD-NOT-ESTABLISH** — not fetched from a Snap Store page |
| Number of screenshots (min/max) | — | ⚠️ **COULD-NOT-ESTABLISH** |
| Icon / banner image sizes | — | ⚠️ **COULD-NOT-ESTABLISH** |
| Video specs, if supported at all | — | ⚠️ **COULD-NOT-ESTABLISH** |
| Accepted file formats | — | ⚠️ **COULD-NOT-ESTABLISH** |

🔴 An invented limit fires on **correct** input — this repo has already rejected
its own fixture at 129 characters against a made-up "120 or fewer".
`Private/company/pipeline/10-distribution-store.md` D-5 records screenshot dimensions for
**every** store as *"COULD-NOT-ESTABLISH — not fetched; do not write a number
here from memory"*. Fill this table in the same increment that fetches the Snap
Store's media-requirements page, **with the URL and the date**.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. Upload order is part
of the listing, so the number is the listing's, not the filesystem's.

## ⬜ Also missing, and it is not a screenshot

There is **no Subly-specific app icon**. `[10]D-6` requires a distinct visual
identity per app so fifty apps stamped from one brick do not reach the store
looking identical.
