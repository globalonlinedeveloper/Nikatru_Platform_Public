# FullShot — Chrome Web Store listing copy

Paste-ready copy for the Chrome Web Store developer dashboard. Chrome Web Store
description fields render as **plain text** (no Markdown), so the copy blocks
below are written as plain text — copy the text inside each block verbatim.
Owner-action placeholders are marked `⟨LIKE THIS⟩`.

Grounded in the shipped **v1.10.1** code (see COMPLIANCE-CHECKLIST.md for the
audit) and the Chrome Web Store Developer Program Policies, whose Aug 1, 2026
update is now in force.

**The redaction bullet is governed copy.** It used to promise that FullShot
"finds emails, phone numbers, credit-card numbers, SSNs, and API keys **on the
page**" and "bakes a solid block over **each**" — two completeness claims about
a page FullShot never reads whole. `REDACTION-CLAIM-SPEC.md` §7 replaced it with
an act, its limit, and the review, and that is the wording now under "MAKE IT
USEFUL". Do not restore a completeness claim, and do not let the words
*protect*, *secure*, *safe*, *clean* or *guarantee* appear near this feature
anywhere in the listing: the product no longer states a verdict about the image,
so a listing that states one is a claim the code cannot answer for. The matching
product string is `optionsRedactPIIDesc`, the matching policy text is
`PRIVACY-POLICY.html` §3d, and `COMPLIANCE-CHECKLIST.md` §C12 / §D3-note records
why. Every field these blocks feed into is listed in SUBMISSION-PACKET.md.

---

## Product name
```
FullShot - Full Page Screen Capture
```
(Matches `manifest.json` `name`. 35 chars — within the 75-char store limit.)

## Category
Recommended: **Productivity** (screenshot/utility tools list here). Alternative: **Tools**.

## Summary (short description — 132-char hard limit)
```
Full-page, region & element screenshots. Annotate, auto-redact PII, export PNG/JPEG/WebP/PDF. 100% local — no account, no cloud.
```
(128 characters — verified under the 132 limit.)

---

## Detailed description (paste-ready plain text)
```
FullShot captures any web page the way you actually see it — the whole thing, seam-free.

Capture the FULL page (not just the visible screen), the VISIBLE area, a REGION you drag, or a single ELEMENT you click. Then annotate, redact, beautify, and export — all on your own device. No account. No cloud. No tracking. Works offline.

── CAPTURE ANYTHING ──
• Full page, visible area, drag-to-select region, or click-to-pick element
• Seam-free stitching at any zoom or display scale (125% / 150% / Retina)
• App-shell pages captured correctly — Gmail, ChatGPT, dashboards and other inner-scroll layouts (competing tools grab the wrong scroller)
• Fixed side navigation unrolled to its full content (Reddit-style rails)
• Wide tables, boards and code blocks captured across, not cut off
• Smart multi-part splitting never cuts through a post, image, or line of text
• Handles lazy images, "load more" buttons, infinite scroll, and skeleton loaders (optional)
• Optionally hides cookie banners and modal pop-ups before capturing

── MAKE IT USEFUL ──
• Built-in editor: crop, arrows, boxes, text, highlighter, blur, and numbered step badges
• Auto-redact PII (opt-in): scans the text a page exposes for emails, phone numbers, credit-card numbers, SSNs and API keys, and bakes a SOLID block over what it matches — not a blur, so it can't be reversed. It reads text, not pictures: anything drawn as pixels (canvas editors, images, PDFs, video) is never read. FullShot tells you what it covered and shows you the marked image before you hand it to an AI — it does not tell you the image is clean. 100% on-device.
• Beautify: drop the shot on a gradient or solid background with padding, rounded corners, a shadow, and an optional window frame — perfect for docs, decks, and social.
• Scroll clip: export an animated scroll-through of the capture as a GIF or WebM — great for bug reports and demos.
• Batch capture: paste a list of URLs and FullShot captures each full page into your history, unattended.

── EXPORT & KEEP ──
• Save as PNG, JPEG, or WebP
• Export to PDF with smart page splitting (no cut text lines) and an optional URL + date stamp
• Copy straight to the clipboard
• Local history you can search, reopen, re-edit, and re-export — stored only on your device

── PRIVACY BY DESIGN ──
• Everything runs locally. Your screenshots never leave your computer.
• No sign-in, no analytics, no telemetry, no ads, no data sold — ever.
• No remotely hosted code (Manifest V3).
• Core single-tab capture needs only the "active tab" permission. Broad site access is OPTIONAL and requested at the moment you turn on a feature that needs it (cross-site frame expansion or batch URL capture) — decline and everything else keeps working.

── KEYBOARD SHORTCUTS ──
• Alt+Shift+P — capture full page
• Alt+Shift+V — capture visible area
(Region and element capture shortcuts can be assigned at chrome://extensions/shortcuts.)

Everything the other tools charge for — free, private, and pixel-perfect.
```

---

## Single-purpose description (dashboard field)
```
FullShot's single purpose is to capture screenshots of web pages — the full page, the visible area, a user-selected region, or a user-chosen element — and let the user annotate, redact, and export those screenshots. Every feature (the editor, opt-in PII redaction, Beautify backgrounds, scroll-to-GIF/WebM, batch URL capture, PDF export, and local history) exists to produce or work with screenshots of pages the user chooses to capture. All processing happens locally on the user's device.
```

---

## Permission justifications (one per dashboard field)

Each is written to satisfy the "minimum permission" requirement: narrowest scope
for the feature, least-privileged option chosen, tied to the single purpose.

**activeTab**
```
FullShot captures only the tab the user explicitly acts on. activeTab grants temporary access to that one tab at the moment the user clicks the FullShot toolbar button or presses a capture shortcut. It is the least-privileged way to read the current page for capture and gives the extension no standing access to any site.
```

**scripting**
```
The capture engine runs as a content script that measures the page, scrolls it to load and stitch the full length, and (for region and element modes) lets the user pick a target. chrome.scripting.executeScript injects this engine into the active tab on demand — only when the user starts a capture — instead of declaring a persistent content script on every page.
```

**downloads**
```
Used only to save a finished screenshot (PNG, JPEG, WebP, or PDF) or an exported GIF/WebM to the user's Downloads folder when the user chooses to save it. FullShot initiates no downloads on its own.
```

**storage**
```
Stores the user's own preferences — image format, capture options, filename template, PDF options, and theme — via chrome.storage.sync so settings persist across sessions. Only these preference values are stored; no page content, screenshots, or personal data are placed in chrome.storage.
```

**unlimitedStorage**
```
Finished screenshots are kept in a local IndexedDB history on the user's device so they can be reopened, edited, and exported later. Screenshots are often large; unlimitedStorage prevents the small default storage quota from silently dropping the user's own capture history. This data is stored only on the device and is never transmitted.
```

**Host permission — <all_urls> (declared as OPTIONAL, requested at runtime)**
```
<all_urls> is declared as an OPTIONAL host permission, never requested at install time. FullShot requests it through chrome.permissions.request only when the user turns on one of two optional features: (1) expanding scrollable content inside cross-origin iframes so those frames are captured in full, and (2) Batch URL capture, which opens and captures a user-provided list of URLs. Chrome shows its own grant prompt at that moment; if the user declines, every other feature keeps working. Core single-tab capture uses only activeTab and requires no host permission.
```

**Remote code**
```
None. FullShot contains no remotely hosted code. All JavaScript and WASM-free logic ship inside the package; the Manifest V3 service worker and every extension page load only local scripts. Nothing is fetched, imported from a CDN, or evaluated at runtime.
```

---

## Privacy practices tab — data collection & Limited Use certification

FullShot processes **website content** (the screenshot is an image of the page)
entirely on the user's device and transmits nothing. Per Chrome Web Store User
Data FAQ Q2–Q3, taking a screenshot is "handling user data" and local-only
handling still must be disclosed — so this is disclosed honestly below.

Data collection disclosures (dashboard checkboxes):
- Website content — **handled locally only** (the captured screenshot). Not transmitted, not sold, not shared. ⟨See owner-decision note in COMPLIANCE-CHECKLIST.md §Data-disclosure.⟩
- Personally identifiable info / financial info / health / authentication / location / web history / user activity / personal communications — **NOT collected.** (A screenshot may incidentally contain whatever the user points it at, but FullShot does not extract, index, or transmit any such category; the opt-in redaction feature exists to cover matched patterns in the image, not to gather them.)

Limited Use certification (all three must be affirmed — FullShot qualifies):
- ☑ I do not sell user data to third parties (FullShot transmits no data at all).
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending.

Privacy policy URL (required — item handles user data):
```
https://nikatru.com/fullshot/privacy
```
**FILLED 2026-08-22.** Until then this cell read `⟨PASTE HOSTED URL of PRIVACY-POLICY.html⟩` and
was the only substantive owner placeholder left in this document. It is no longer an owner decision:
the value is `publish/identity.json` `privacyPolicyUrl`, and it was **re-verified before being written
here** — `GET https://nikatru.com/fullshot/privacy` answered **HTTP 200 with 0 redirect hops**,
`content-type: text/html; charset=utf-8`. Direct-200 matters because a store listing URL is the one
URL a reviewer opens by hand and an automated re-check months later is what finds a dead one.
Paste the **same** URL into all three dashboards (Chrome, Edge, AMO) — divergent policy URLs invite a
policy-mismatch finding. ⚠️ The SOURCE OF TRUTH for the text is `publish/PRIVACY-POLICY.html` in THIS
repo; the page actually served is a copy in the storefront repo and no guard can see across that
boundary, so edit here first and re-copy.

📌 **A placeholder scan of this file does NOT come back zero, and that is correct — measured
2026-08-22, after this note was written.** `grep -o '⟨' STORE-LISTING.md | wc -l` returns **4**, on
**4** lines, and not one of them is an outstanding owner action:

1. the legend near the top that *defines* the marker;
2. the Website-content bullet in Privacy practices, using it for a see-also into
   `COMPLIANCE-CHECKLIST.md`;
3. the paragraph directly above, quoting the retired placeholder verbatim so the record still says
   what it used to say;
4. and **one in this note itself**, inside the `grep` command quoted above.

Item 4 is not padding, it is the point: the first draft of this note said "returns 3", counted
before the note existed, and the note's own use of the marker falsified it the moment it was saved
— twice, because the draft after that said "returns 5" and then lost a mention in an edit. **A
count of a pattern, written into the file the count is over, must be taken after the writing, never
before.** That is the same order-of-operations trap as reporting `$?` from inside a command
substitution — the measurement runs before the thing it claims to measure.

Recorded because `publish/` is exactly where a placeholder scanner would be pointed, and one keyed
on the bare character will go red on this file forever: a legend, a cross-reference, a quotation and
a note about scanning are not unfilled fields. Key such a check on the paste-ready FIELD BLOCKS, not
on the whole document.

---

## Assets still needed from the owner (not agent-producible)
- Screenshots / promo tiles: 1280×800 (or 640×400) screenshots ×1–5; small promo tile 440×280. (The `Reference/` PNGs are a starting point but are not store-sized.)
- Store icon 128×128 — already in the package (`icons/icon128.png`); confirm it is the final art.
- ~~A support contact email and (optional) a homepage URL for the listing.~~ **SETTLED — not owner work.**
  `publish/identity.json` carries `supportEmail` `support@nikatru.com` and `homepageUrl`
  `https://nikatru.com/`. Read them from there; do not re-decide them here.
- ~~The hosted Privacy Policy URL (host `PRIVACY-POLICY.html` anywhere public — e.g. GitHub Pages).~~
  **DONE 2026-08-21, verified live again 2026-08-22** — it is hosted at
  `https://nikatru.com/fullshot/privacy` (200, 0 redirects) and is written into the Privacy-practices
  section above. GitHub Pages was never used.
