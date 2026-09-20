# Listing material every store accepts

Kept once, on purpose. Two builds, three stores — and these are the fields where all three
stores agree, so a per-store copy would be three places for one fact to go stale.

| File | Why it is shared |
|---|---|
| `screenshots/` | **1280x800 is the only screenshot size Chrome, Edge and AMO all accept.** Chrome requires 1-5 and treats them as mandatory; Edge allows up to 6 and treats them as optional; AMO recommends 1280x800 as its maximum display size. |
| `icon-128.png` | **128x128, colour type 6 (with alpha).** Chrome *requires* it — "The image must be in PNG format", artwork 96x96 inside 16px of transparent padding. AMO recommends an icon and resizes whatever it is given, so the same file serves it. Edge asks for a 1:1 logo at a different size and gets its own. |
| `privacy-policy-url.txt` | All three require a reachable policy for an item that handles user data. |
| `support-url.txt` | All three ask for it. |

Sizes, formats and counts are enforced by `extensions/scripts/check-listing-assets.mjs` against
`extensions/scripts/store-graphics.json`, where every number carries the URL it was read from and
the date it was read.

## The promo tiles, and a correction to what this file used to say

🔴 **This file used to say the 440x280 and 1400x560 tiles "belong here when they exist". They do
not, and the reason is the one this directory is named for.** `_shared/` is material *all three*
stores accept. The 440x280 tile is **required by Chrome**, **optional on Edge** and has **no
equivalent on AMO** — so it lives in `../chrome/`, beside the store that cannot be submitted
without it, and `store-graphics.json` records the Edge row as optional rather than declaring it
here and implying Edge needs one. The 1400x560 marquee tile is optional on both and is not
produced at all: without it an extension cannot be *featured*, which is a discovery consequence
and not a submission blocker.

Edge's 300x300 extension logo is in `../edge/` for the same reason: no other store asks for that
size.

## How the graphics are produced

```
node ../../scripts/render-extension-graphics.mjs fullshot            # write them
node ../../scripts/render-extension-graphics.mjs fullshot --check    # prove the committed files are its output
```

Every pixel comes from two places and nowhere else: the extension's own committed
`icons/icon128.png`, read at the path the manifest names and composited at its native size, and
the `--accent` custom properties parsed out of the extension's own shipped stylesheets. No text is
drawn — there is no font file in this repository, and a CSS font stack would paint a different
face on every host — so the tiles are geometry only and identical wherever they are rendered.

## What is still missing before a listing can go up

**Not the pictures.** The screenshot set and all three required graphics are in the tree and
graded. What remains is owner work that no script can do: the **first manual publish** on each
store (ADR 067 decision 8 — no store API accepts a first submission except AMO's), and the
**on-device QA pass** on Batch URL capture, Beautify and Scroll to Clip, which is why those three
screens are absent from the capture set. See `screenshots/README.md`.
