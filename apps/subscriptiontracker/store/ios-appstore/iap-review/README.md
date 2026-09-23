# IAP review screenshots — Apple App Store (`ios-appstore`)

**These are not listing screenshots.** `../screenshots/` and `../screenshots-ipad/`
are what shoppers see. The files in *this* directory are what App Store Connect
attaches to each **auto-renewable subscription product**, and nobody but Apple's
reviewer ever looks at one.

They are also the difference between a version that can be submitted and one that
cannot. A subscription with no review screenshot stays in **"Missing Metadata"**,
and a version that references a product in that state cannot be sent for review —
so this is the cheapest thing in the whole listing to forget and the most
expensive place to find out.

## One file per product, and the list is DERIVED

`<product_id>.png` — one per auto-renewable subscription, named after the product
id exactly.

The list of products is **not written down here, and not in the register
either**. `tooling/ci/assert-iap-review-screenshots.mjs` derives it from
`services/platform/src/app-config-data.json` →
`apps.subscriptiontracker.paywall.offerings[]`, taking every offering whose
`term` is not `one_time`. Add a subscription term there and the obligation shows
up here on its own; a file here for a product that no longer exists is a finding.

A `one_time` offering is a non-consumable purchase. Apple asks for no review
screenshot for one, so it is excluded — and that exclusion also keeps the
one-time product's name out of every store-facing path and CI line, which is a
rule of its own.

## What the frame must be

Declared in `tooling/channel-register.json` under
`storeMetadataContract.perChannel["ios-appstore"].graphicAssets.iapReview`, with
a dated `source` beside it. Read it there, not here.

One thing about it is worth repeating: the size is a claim about **what this
repository captures** (the same simulator and geometry as the iPhone listing
set), not a claim about what Apple accepts. Apple's own range for a review
screenshot has not been fetched. Replace the rule with the real range the day
someone reads the page, and record the URL and the date in the same change.

## What the screenshot has to SHOW

The paywall, with **this product** on it, on a real build — its price, its term,
and the purchase control a reviewer would tap. The reviewer is checking that the
product being sold is the product described, so a screenshot of a settings page,
a splash screen or a generic upsell answers a question nobody asked.

`CAPTURE.json` records which build was photographed. A screenshot with no
provenance is evidence about nothing: nobody can tell afterwards whether it
showed a LIVE build or a DEMO one, and a demo build paints a "Demo data" banner
across the screen.

## ⬜ The capture is UNBUILT, and this directory is empty on purpose

`integration_test/iap_review_screenshot_test.dart` does not exist yet. It needs a
machine with Xcode and a paywall rendering real StoreKit products, and it is
blocked upstream. Two routes were considered and neither is chosen here:

- a **StoreKit configuration file**, which renders the real paywall against local
  product definitions — no App Store Connect round trip, but the prices are the
  configuration file's, so the file has to be generated from the same offerings
  list or the screenshot shows a price nobody charges;
- the **real `PaywallScreen` against a stubbed purchase bridge**, which shows the
  real UI with the real copy and is honest about where the numbers came from,
  provided `CAPTURE.json` says so.

Whichever lands, the guard above already grades its output, so the capture lane
does not need to touch the rules.

Until then the guard **prints** the gap rather than failing CI — the channel is
`served: false` — and is **fatal** on the submission lane, which runs it with
`--for-submission`. That is the same split every other deferred rule here uses.

**Uploading these to App Store Connect is an owner action.** Nothing in this
repository uploads them.
