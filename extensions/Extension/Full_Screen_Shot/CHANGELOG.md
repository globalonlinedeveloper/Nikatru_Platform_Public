# Changelog

All notable changes to FullShot.
Keep-a-Changelog format, newest first. The version here must always equal the one in
`manifest.json` — `node scripts/check-version.mjs fullshot` is the gate that says so.

**Nothing below has ever been published.** FullShot is listed in no store: `tool.json` carries
`status: "wip"` and `listings.chrome`/`edge`/`firefox` all `null`. Every entry is therefore a
**build** milestone, not a release to users — the manifest was stamped at that version, the test
tiers were run, and for five of them both packages were built into `publish/`. No user has ever
received any of these versions, and no version below has ever been tagged.

**This file was backfilled on 2026-08-15**, which is late and is the reason the entries are terse:
they were reconstructed rather than written while the work was fresh. The sources are named per
entry and all three are in this repo — `HANDOFF.md`'s dated per-session status entries, the
`v1.9.x` / `v1.10.x` markers in the source files themselves, and the packages sitting in
`publish/`. Where a version's changes could not be attributed to one of those, it is not described
here rather than described from memory.

**The record starts at 1.9.7, and the versions before it are deliberately absent.** `HANDOFF.md`'s
dated entries begin at session 12 (16 July 2026); the source carries `v1.9.1`–`v1.9.6` markers and
one reference to `v1.6.1`, but nothing in this repo dates them or says what shipped in each. An
invented stanza is worse than a missing one, so they are left out and named here instead.

## [1.10.2] — 2026-08-15

Clears the last thing the 1.10.1 entry below named as standing between this tree and a submission:
the store metadata was over Chrome's limits in most locales.

### Fixed

- **The store `description` is within Chrome's 132-code-point limit in all 55 locales, and `name`
  within 45.** It was over in 41 locales, and `name` was over in `ca`, `es` and `es_419`. The English
  source went from 137 code points to 111 by dropping one trailing clause; 35 translations were
  shortened the same way, each keeping its own reviewed wording. Nothing was added — the only claim
  that moved was one that was removed. Measured on disk after the change: longest description 132
  (`el`, already compliant and untouched), longest name 44.
- The catalogues under `_locales/` were not hand-edited to achieve this. They are generated from
  `_locales/en/messages.json` plus the translation memory in `i18n/tm/` by
  `node _locales/make-locales.mjs`, and `--check` fails on any drift, so a hand-edit would have been
  reverted by the next generator run. The sources were edited and the catalogues regenerated.

*Appended 2026-08-26. Two privacy fixes landed in the source at this same version eleven days after
the entry above was written. They are recorded here rather than folded into a later version because
the manifest still reads 1.10.2 and nothing has been published at it. Everything written on
2026-08-15 is left standing; where it is now wrong it is corrected beneath itself, not rewritten.*

- **The redaction stats line reported a whole match count over text the pass had not read.** `scan()`
  writes a counter the moment it meets an `<iframe>` whose `contentDocument` it could have read and
  returns without descending — a door counted, openable, and not walked through. That counter was
  written and never read: the pass observed itself declining to read a document and then sealed the
  count as complete, so a capture containing such a frame put a whole-count sentence beside a
  delivered PNG in which an address, a phone number and a card number were still legible. The AI
  handoff payload said `(PARTIAL count)` about that same capture all along — two surfaces describing
  one capture and disagreeing, and the silent one was the one with the picture next to it. The seal
  in `content/capture.js` now also requires that every same-origin frame the pass counted was
  walked, and `pages/result.js` and `pages/history.js` append the new `redactActsCountPartial`
  string beside the counts whenever it is false: "This count may be short: FullShot did not read
  some of the text in this capture." It is appended, never an arm, so it composes even with the zero
  arm — "matched nothing" over text the pass never read is the sentence that most needs it beside
  it. It carries no numbers deliberately: the gaps that can be counted have their own sentences and
  this one covers the gaps that cannot. And it is a statement about what FullShot did, not about the
  picture. The string's own description forbids *safe*, *clean*, *secure*, *protected* and *done*, in
  every language, because FullShot cannot see the image and the reader can. No screen in this product
  tells a reader that a capture is fit to share, and this entry does not either. All 55 catalogues
  carry the key with an `AWAITING-TRANSLATION` marker and render the English until it is translated;
  `test/i18n-sim` reddens if a translation memory carries the key while the marker is still there,
  so the marker cannot outlive its translation.
- **A redaction block was painted over text that never held the match.** The measurement in
  `collectPIIBoxes` had no liveness test, and Chrome *lays out* a leaf inside a
  `content-visibility: hidden` subtree and never paints it: the leaf still reports a full-size rect,
  `visibility: visible`, `opacity: 1` and a font size that agrees with that rect, so every clause of
  the box test passed and a block was emitted at coordinates belonging to text that is not in the
  image. Where an inactive tab panel is absolutely positioned over the active one, the unpainted
  text and the visible line share a rect to the pixel — so the ink landed on readable text that held
  no match, destroyed it, and `marks` and `kinds` then pointed a reader at a rectangle where no
  email had ever been. This is the opposite sign to the item above: each act was true, something
  really was matched and really was painted, so it was not fixed by weakening a coverage assertion.
  No ancestor walk could have found half of it either — for a collapsed `<details>` the declaration
  lives on the `::details-content` **pseudo-element**, and not one node in the composed chain
  carries it. The engine is asked instead, via `el.checkVisibility()`, and a subtree it did not draw
  is now skipped before the detector: no box, no mark, no `kinds` entry, and the match is not moved
  to the uncovered side either, which would have traded the over-paint for a false "1 match is not
  covered in this image" about a closed accordion. Eight lines of code in `content/capture.js`, set
  after the degenerate-rect clause so a 0×0 leaf keeps its seat in the deferred re-measure; the rest
  of that diff is the comment explaining why the stylesheet is not consulted. The places skipped and
  the characters in them are recorded as `notRendered` and `notRenderedChars`, so that "FullShot did
  not look at that" is a fact a reader can check rather than a silence.

### Changed

- **The version number moved because the package did.** No source behaviour changed between 1.10.1
  and 1.10.2 beyond the metadata above; the bump exists so that the new byte set gets its own number
  rather than becoming the fourth distinct package to be labelled 1.10.1. `docs/RELEASING.md` §2:
  "Bump before you rebuild, always." The 1.10.1 packages are left in `publish/` unmodified as the
  record of what that number was.

*Appended 2026-08-26: the sentence above — "No source behaviour changed between 1.10.1 and 1.10.2
beyond the metadata above" — was true when it was written and is no longer. It stands as the record
of what 1.10.2 was on 2026-08-15. Two source fixes have since landed at this same version, both
reaching `content/capture.js`, and they are the two items added under **Fixed** above. The version
was not bumped again for them because there is no byte set left for a new number to distinguish
this one from: all twelve packages were deleted on 2026-08-20, recorded in
`publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`, and none has been rebuilt since.*

### Security

*Appended 2026-08-26, at this same version and for the same reason as the two items under **Fixed**
above: `manifest.json` still reads 1.10.2, nothing has been published at it, and there is no byte set
left for a new number to distinguish this one from. Everything written on 2026-08-15 stands.*

- **The manifest now declares a content security policy for extension pages.**
  `content_security_policy.extension_pages` was absent, so the MV3 default applied — and that default
  constrains `script-src` and `object-src` and says nothing about `img-src`, `connect-src`, `frame-src`,
  `base-uri` or `form-action`. The 8 extension pages and the service worker are now declared under
  `script-src 'self'; object-src 'none'; img-src 'self' data: blob:; connect-src 'none'; frame-src
  'none'; base-uri 'none'; form-action 'none'`. What this changes is who checks: a `fetch()` or an
  injected `<img src=https://…>` from an extension page is now refused by the browser, where before it
  was only absent from the source. That is the barrier 1.9.12's redaction fix assumed and that nothing
  in the shipped package actually held. `node scripts/policy-check.mjs fullshot` went from
  `15 passed · 1 warning(s)` to `16 passed`, EXIT 0 both ways — the warning it closed is
  `no CSP connect-src to back the zero-network claim`.
- 🔴 **What this entry does not cover, measured, because the line above is the kind that gets read as
  more than it says.** (1) **Chromium only.** `publish/manifest.firefox.json` deletes the key again for
  Gecko with an RFC 7386 `null` member, deliberately, so the AMO build keeps the strict MV3 default and
  the Firefox package carries no `connect-src` at all. Counting the surface x browser grid — the 8
  extension pages, `background.js`, and `content/capture.js` + `content/region.js` +
  `content/frame-expand.js`, across Chromium and Firefox — two of the six cells are backed by the
  browser. Under Firefox the zero-network claim rests on the source scan alone. (2) **This repo verifies
  one of the seven declared directives.** `scripts/policy-check.mjs:589-607` reads `connect-src` and
  nothing else, so `img-src` — the directive that answers 1.9.12's `<img src=https://evil…>` — can be
  deleted, or set to `*`, and the gate still prints `16 passed` at EXIT 0. The browser honours all
  seven; this project checks one. (3) `extension_pages` does not govern content scripts, so
  `content/capture.js`, `content/region.js` and `content/frame-expand.js` are covered by neither limb
  in either browser.

### Known limitations at this version

- Everything under the same heading in 1.10.1 still applies except the store-metadata item, which is
  what this version fixes. The placeholder `browser_specific_settings.gecko.id` in particular remains
  an owner decision that blocks any Firefox upload.
- `el` sits at exactly 132 of 132. The next edit to the Greek description, or any English change that
  makes Greek stale and falls back to English, fails `node scripts/policy-check.mjs fullshot` on the
  spot.

*Appended 2026-08-26: the first bullet above no longer holds in full. Of 1.10.1's limitations, the
one recorded as "content that is laid out but not painted (a closed `<details>`, an inactive tab
panel) is treated as visible text" is fixed by the second item under **Fixed** above — and it was
never only the recall gap it was recorded as, because the boxes measured from that text were then
painted onto the image. The rest of 1.10.1's list still applies, the placeholder
`browser_specific_settings.gecko.id` included.*

*Packages: `publish/fullshot-1.10.2.zip` and `-firefox.zip`, 85 entries each, 55 locale catalogues.*

## [1.10.1] — 2026-08-12

The user interface itself became localised. 1.10.0 shipped 55 message catalogues that the product
never read; this is the version that reads them.

### Added

- **The UI renders in the user's language in all 55 locales.** Every string on the eight shipped
  pages resolves through `chrome.i18n` at runtime — text via `data-i18n`, tooltips and labels via
  `data-i18n-attr`. Before this, the store listing translated and every pixel of the product was
  English.
- Right-to-left languages mirror physically, not just attributively — Arabic was measured moving
  controls to the other side of the page, not merely setting `dir="rtl"`.

### Fixed

- **Batch capture reported "done" for screenshots that did not exist.** A job was settled on the
  last message of a capture rather than on the artifact; fifty URLs produced fifty green ticks,
  fifty dead "open" links and an empty History. A job now completes only when the `shots` row it
  links to is actually in the database.
- The orphan sweep reported success when every delete inside it had failed. It now returns what it
  found, what it freed and what failed.

### Changed

- **The redaction report says what was measured instead of grading itself.** The eight-state verdict
  ladder is gone; the product now reports how many matches it found, how many it painted over and
  how many it verified opaque, in one sentence, in all 55 locales.

### Known limitations at this version

- Redaction **under-covers and says so** rather than over-claiming, which is the point of the change
  above — but it does under-cover: an element mixing its own text with child elements is not fed to
  the detector, and content that is laid out but not painted (a closed `<details>`, an inactive tab
  panel) is treated as visible text. These are recall gaps in a feature that now reports its own
  recall honestly, not false claims.
- The Firefox package still carries a placeholder `browser_specific_settings.gecko.id`. AMO fixes an
  add-on's identity at first signing, so this is an owner decision that must be made before any
  Firefox upload, and `publish/verify-firefox-package.node.js` refuses to pass until it is.
- The store metadata is over Chrome's limits in most locales, which is what stands between this tree
  and a submission (`node scripts/policy-check.mjs fullshot`).

*Packages: `publish/fullshot-1.10.1.zip` and `-firefox.zip`, 85 entries each, 55 locale catalogues.*
*Note that this version number has been rebuilt more than once — `publish/COMPLIANCE-CHECKLIST.md`
records the Chrome zip at md5 `c601e5ed…` and the file on disk today is `c040e827…`, 940,316 bytes.
That is harmless only because nothing has been published; the moment 1.10.1 is uploaded anywhere,
the next change bumps the version rather than rebuilding this one.*

## [1.10.0] — 2026-08-12

### Added

- **All 55 Chrome Web Store locales.** Message catalogues, a localised manifest (the store listing's
  name and description translate), and text-direction handling.

### Changed

- The package grew from 133.6 KB to 581.5 KB — 87% of the uncompressed package is now message
  files. Recorded because it is the per-tool cost of doing this across a fleet, not because it is a
  defect.

### Known limitations at this version

- **The product still rendered entirely in English.** Localisation has four independent layers —
  message files, manifest, direction, packaging — and three of them were complete, correct and fully
  tested here while every visible string stayed English. The runtime lookup was not wired until
  1.10.1. It is recorded rather than quietly folded into the next entry because the manifest layer is
  the one visible from outside: a reviewer checking the store listing would have concluded the work
  was finished.

*Packages: `publish/fullshot-1.10.0.zip` and `-firefox.zip`.*

## [1.9.13] — 2026-08-12

### Added

- **A failed capture now leaves a note instead of vanishing.** The reason is parked in
  `chrome.storage.session` — never `local`, never `sync` — and the popup shows it and can dismiss
  it. The note carries scheme and host only, never a path or query.
- **A capture that would photograph the wrong page is refused.** The active tab is re-checked
  against the window frozen at capture start before every visible-area grab, and the capture aborts
  in plain English rather than silently stitching in a frame of whatever the user switched to.

### Security

- **A password could survive into the failure note.** The origin reducer captured the whole URL
  authority, and user info is part of the authority — so `https://ada:hunter2@intranet.example/hr`
  reduced to `https://ada:hunter2@intranet.example`, keeping the credential, inside a function whose
  contract is "scheme and host only". It now drops everything up to and including the last `@`
  inside the authority.
- **The failure note quoted whole URLs back.** The browser's own refusal wording repeats the entire
  URL, path and query included, and that text reached the popup verbatim — a token and an email
  address were proven to land in storage and render. Two attempts at filtering the text lost; the
  fix replaced filtering with recognition, so every sentence either gate can return is now a fixed
  string literal and no substring of the input is ever echoed.
- **The wrong-page guard could still be beaten**, because it checked before the capture and stored
  whatever came back — and the capture call is itself a window a tab switch can land inside. Each
  frame is now bracketed and a frame that fails the check on the way out is discarded.
- **Every aborted capture orphaned its frames in local storage.** Full-resolution images were left
  in IndexedDB, absent from History, deletable from no screen, and with `unlimitedStorage` nothing
  ever evicted them — which also made the privacy policy's "screenshots live in local storage until
  you remove them" untrue. All five abort paths now drop their frames.

*Packages: `publish/fullshot-1.9.13.zip` and `-firefox.zip`, 30 entries each. The security fixes
above landed after the packages were first built and both were rebuilt afterwards, verified against
the source rather than against the build log.*

## [1.9.12] — 2026-08-12

### Security

- **A pasted batch URL list was treated as trusted input, and it is not** — it comes from a QA
  sheet, a colleague or a crawl export. The list was canonicalised with a regular expression whose
  trailing capture passed the path, query and fragment through raw, and both progress renderers then
  concatenated that string into `innerHTML`. MV3's content security policy blocks the script half,
  but images are unrestricted, so a crafted entry produced **a real network request from an
  extension page** — breaking the zero-network claim the listing, the privacy policy and the
  compliance checklist all make. Hosts are now rejected on an unsafe character, paths are
  percent-encoded, and both renderers build DOM nodes with `textContent` instead of markup.

*Stamped in `manifest.json` only; no package was built at this version.*

## [1.9.11] — 2026-07-17

### Fixed

- **A redaction block could land above the text it was meant to cover, leaving the personal data
  visible.** For content in the band immediately below an inline-unrolled list embedded in an
  app-shell pane, the box was tested for membership in the wrong coordinate frame, so the growth
  shift was skipped and the block was painted too high on the final image. One line in the
  stitcher; the capture side was already correct.

*Packages: `publish/fullshot-1.9.11.zip` and `-firefox.zip`. Four later sessions (19–22) added
capture-simulation coverage at this same version with the extension byte-unchanged, which is why
they have no entry of their own.*

## [1.9.10] — 2026-07-17

### Added

- **Full-page capture now unrolls a virtualized list that lives inside an app-shell pane.** Such a
  list was previously captured exactly as rendered — roughly one screen of it — and everything
  below the render window was simply absent from the screenshot.

## [1.9.9] — 2026-07-17

### Fixed

- **An embedded virtualized list was never unrolled on any page that also had a fixed side rail** —
  the Reddit-style layout, which is precisely where long virtualized lists live. The two subsystems
  draw in separate columns and never interact; the guard that separated them was caution, not a real
  incompatibility.

## [1.9.8] — 2026-07-17

### Security

- **Whenever an embedded virtualized list unrolled, redaction was skipped for the entire page** —
  not just inside the list. Every match on the page went unpainted. Personal data inside such a list
  is now collected in the list's own coordinate space and painted over with the rest.

## [1.9.7] — 2026-07-16

### Added

- **Batch URL capture** — the first workflow feature beyond a single shot. A list of addresses is
  queued and captured in turn, with the queue and parser living in the service worker.

*Packages: `publish/fullshot-1.9.7.zip` and `-firefox.zip`.*
