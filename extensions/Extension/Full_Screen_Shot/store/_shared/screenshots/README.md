# Store screenshots — 1280x800

**One capture set, three listings.** 1280x800 is the only size Chrome, Edge and AMO all
accept, so one directory serves all three rather than three directories serving one each.

## The specification, with the page each number came from

Every limit below was read from the vendor's own page on **2026-09-20**, and the machine-readable
copy — the one a guard actually enforces — is `extensions/scripts/store-graphics.json`. This file
is the prose beside it, not a second declaration to go stale.

| | Chrome Web Store | Edge Add-ons | AMO (Firefox) |
|---|---|---|---|
| required? | **yes, at least one** | optional | not documented as required |
| sizes | 1280x800 **or** 640x400 | 1280x800 **or** 640x480 | 1280x800 recommended (1.6:1) |
| count | min 1, max 5 | max 6 | "no practical limit" |
| other | "Square corners, no padding (full bleed)" | — | one set only; descriptions localise |

- Chrome: <https://developer.chrome.com/docs/webstore/images> — *"at least 1—and preferably the
  maximum allowed 5—screenshots"*, *"1280x800 or 640x400 pixels"*.
- Edge: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension> —
  *"a maximum of 6 screenshots"*, *"must be either 640 x 480 pixels or 1280 x 800 pixels"*.
- AMO: <https://extensionworkshop.com/documentation/develop/create-an-appealing-listing/> —
  *"capture images that are 1280x800px (the maximum image display size)"*.

⚠️ **Edge's small size is 640x480 and Chrome's is 640x400.** One digit apart, and the reason only
1280x800 is captured: it is the one size that can be shared.

🔴 **The previous version of this file asserted "24-bit PNG, no alpha" with no URL beside it.**
None of the three pages states a bit depth, an alpha rule or a maximum file size for a
*screenshot*. By this repository's own rule — *a limit with no source is refused, not enforced* —
that line is removed rather than kept as correct-sounding prose, and no colour-type check is
applied to the files in this directory. (The 128x128 store icon's transparency **is** sourced and
**is** enforced; see `../icon-128.png`.)

## How they are taken

```
node publish/shots.mjs          # writes this directory
HEADFUL=1 node publish/shots.mjs  # watch it happen
node ../../scripts/check-listing-assets.mjs fullshot   # grade what it wrote
```

`publish/shots.mjs` reuses the e2e harness — `prepareTestExtension`, `serve` and `setSettings`
from `test/e2e/claim-lib.mjs`, the same three functions every suite uses — and launches the same
persistent Chromium with the extension loaded unpacked at the same `1280x800` viewport. The
pixels are painted by the shipped `popup/`, `pages/` and `background.js`; only the manifest
differs, and only in that `activeTab` is promoted to a static `tabs` + `<all_urls>` because a
script driver has no user gesture. Every frame is read back and refused if its IHDR does not say
exactly 1280x800.

## What each frame shows

| file | what is in the picture |
|---|---|
| `01-popup-1280x800.png` | The toolbar popup: the five capture modes and their keyboard shortcuts, centred on the extension's own accent colour. |
| `02-full-page-capture-1280x800.png` | The result page after a real full-page capture of `publish/shots-demo.html` — the whole document stitched into one image, with the summary line naming the page and its pixel size. |
| `03-redaction-review-1280x800.png` | The "Before you copy" review dialog raised by the Copy button on that same capture: FullShot's own count of what it matched, painted and read back opaque, over the image that is about to leave the machine. |
| `04-options-1280x800.png` | The Options page — every capture, privacy and export setting the extension has. |

**The page being captured is ours.** `publish/shots-demo.html` is written for this purpose and is
on the packaging never-list. It carries no logo, wordmark or trademark belonging to anyone else;
its one email address is at `example.com` (reserved by RFC 2606) and its one telephone number is
in the `+1 555-01xx` block reserved for fiction. They are there so the redaction frames show the
feature finding something real, and so that what it finds harms nobody.

**No clock and no hostname is in any frame.** The dates on the demo page are literal text rather
than a `new Date()`, and the result page's summary line renders the captured page's *title* —
which is why that page has one, and why `localhost:<port>` never reaches a listing.

⚠️ **Three blocks, not two, and the third one is left in the picture on purpose.** The demo page
carries one email address and one telephone number, and the frames report *"Redaction on. 3
matched, 3 painted, 3 confirmed opaque in this image."* The third is the reference `SP-2026-0417`:
`content/capture.js` matches it as a telephone shape (eight digits with a separator), so part of it
is painted over. That is the shipped detector's real behaviour on real text. Rewording the fixture
to dodge it would be designing the demo to hide what the product does, which is the opposite of
what these frames are for.

## Three screens that are deliberately NOT here

**Batch URL capture, Beautify and Scroll to Clip** pass the sandbox sims and have never been
exercised by hand in a real browser. A screenshot of one would advertise behaviour nobody has
watched work, so `pages/batch.html`, `pages/beautify.html` and `pages/scrollclip.html` have no
entry in `publish/shots.mjs` and must not get one until that QA pass is done. Four frames is
above Chrome's minimum of one and below its maximum of five, so nothing is blocked by their
absence.

**The history page** is left out for a different and simpler reason: it renders
`new Date(createdAt).toLocaleString()` beside every card and the captured page's URL under it, so
its pixels carry both a clock and a hostname and cannot be reproduced.
