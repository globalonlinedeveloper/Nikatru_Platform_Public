# Screenshot slots — Google Play (`android-play`)

Drop the listing images for this channel in **this directory**. Nothing here is
generated: screenshots are the one listing field that cannot be derived from a
spec var, so the tree carries the SLOT and the rules, and a human fills it.

`tooling/ci/assert-store-metadata.mjs` requires this README to exist and be
non-empty — that is the "the slot is still declared" half. It deliberately does
**not** require image files: there are none yet, the channel is `served: false`,
and failing CI on artwork only the owner can produce would block every build on
`OWNER_QUEUE A-3`. The gap is PRINTED on every guard run instead.

## ⚠️ Required dimensions: UNVERIFIED — do not fill a number in from memory

| Field | Value | Status |
|---|---|---|
| Phone screenshot pixel dimensions (min/max) | — | ⚠️ **UNVERIFIED** — not fetched from a Google page |
| Number of screenshots (min/max) per form factor | — | ⚠️ **UNVERIFIED** |
| Which form factors are MANDATORY (phone / 7" tablet / 10" tablet / Wear / TV) | — | ⚠️ **UNVERIFIED** |
| App icon dimensions and format | — | ⚠️ **UNVERIFIED** |
| Feature graphic dimensions | — | ⚠️ **UNVERIFIED** |
| Accepted file formats | — | ⚠️ **UNVERIFIED** |

🔴 **Why this table is empty rather than helpful.** An invented limit fires on
**correct** input. This repo has already rejected its own fixture at 129
characters against a made-up "120 or fewer".
`company/pipeline/10-distribution-store.md` D-5 records screenshot dimensions for
**every** store as `COULD-NOT-ESTABLISH — not fetched; do not write a number here
from memory`, and that is still true. Fill this table in the same increment that
fetches Google's graphic-assets page, **with the URL and the date**, or leave it
marked UNVERIFIED.

⚠️ **Play differs from Microsoft in a way that matters here:** the Play Console
blocks a release on missing *required* graphic assets rather than accepting the
draft and rejecting it in review, and the feature graphic is a separate asset
from the screenshots. So the cost of guessing wrong is a submission that will not
save — which is loud, and still cheaper than a number in the repo that everyone
trusts and nobody sourced.

## Naming, once real files land

`NN-<slug>.png`, ordered — e.g. `01-subscription-list.png`. Play shows them in
upload order and the order is part of the listing, so the number is the
listing's, not the filesystem's.

## ⬜ Also missing, and it is not a screenshot

There is **no Subly-specific app icon**. `apps/subly/android/app/src/main/res/`
carries the stock `flutter create` launcher icon, so a Play submission today
would ship the default Flutter mark. That is fine for a build proof and **not**
fine for a submission: `[10]D-6` requires a distinct visual identity per app,
precisely so fifty apps stamped from one brick do not reach the store looking
identical — and Play enforces against **related accounts**, so a clone tell on
app #7 is not an app #7 problem.
