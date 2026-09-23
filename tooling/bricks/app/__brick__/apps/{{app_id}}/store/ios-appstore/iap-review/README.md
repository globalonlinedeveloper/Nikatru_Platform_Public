# IAP review screenshots — {{{short_name}}} · `ios-appstore`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.**

These are **not** listing screenshots. `../screenshots/` and
`../screenshots-ipad/` are what shoppers see. The files here are what App Store
Connect attaches to each **auto-renewable subscription product**, and only
Apple's reviewer ever sees one — but a subscription without one stays in
**"Missing Metadata"**, and a version referencing it cannot be submitted. Every
app stamped from this brick that sells a subscription owes these files, so the
brick carries the slot rather than leaving app #2 to discover the rule at
submission time.

## One file per product, and the list is DERIVED

`<product_id>.png`, named after the product id exactly.

Nothing here lists the products. `tooling/ci/assert-iap-review-screenshots.mjs`
derives them from `services/platform/src/app-config-data.json` →
`apps.{{app_id}}.paywall.offerings[]`, taking every offering whose `term` is not
`one_time` (a one-time purchase is non-consumable and Apple asks for no review
screenshot for one). Add a subscription term there and the obligation appears
here on its own.

## The rules

`tooling/channel-register.json`, under
`storeMetadataContract.perChannel["ios-appstore"].graphicAssets.iapReview`, each
value beside a dated `source`. The declared size is what THIS repository's
capture produces, not a fetched Apple limit — re-read the specification before a
submission and record the URL and the date in the same change.

## How to fill it

The frames are captured from a **live** build showing the real paywall with the
real product on it, and `CAPTURE.json` records which build was photographed. A
screenshot with no provenance is evidence about nothing, and a DEMO build is a
different app on screen — seeded data and, in this chassis, a banner saying so.

The capture step itself (`integration_test/iap_review_screenshot_test.dart`) is
UNBUILT as of 2026-09-22; it needs a machine with Xcode. Until it lands the guard
PRINTS the gap and is FATAL on the submission lane (`--for-submission`).

**Uploading these to App Store Connect is an owner action.** Nothing in this
repository uploads them.
