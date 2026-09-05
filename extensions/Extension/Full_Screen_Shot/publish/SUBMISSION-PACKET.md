# SUBMISSION-PACKET.md — every field the three stores ask for, in one place

One document, three stores. Every field either has an answer written out ready
to paste, or is marked **OWNER** because no agent can supply it.

Nothing here is a substitute for `STORE-LISTING.md` (the long-form marketing
copy), `PRIVACY-POLICY-HOSTING.md` (getting the policy live and answering the
data questions), `CROSS-BROWSER-PUBLISHING.md` (the per-store runbook), or
`COMPLIANCE-CHECKLIST.md` (the code-vs-policy audit). This is the **field list**
those four feed into, so nothing is discovered missing at 11pm in a dashboard.

**Legend**
- **✍️ DRAFTED** — text below is final; copy it verbatim.
- **⚙️ DERIVED** — comes from the package or another file; do not retype it.
- **🔴 OWNER** — only you can supply this. Six of them, listed first.
- **🚧 BLOCKER** — submission cannot proceed until resolved.

Package under discussion: **v1.10.1**, built and verified.
`publish/fullshot-1.10.1.zip` (Chrome + Edge) · `publish/fullshot-1.10.1-firefox.zip` (AMO).
85 entries each: 30 shipping files + 55 locales. No test, Reference, `.md`, or
`node_modules` entries in either.

⚠️ **RETIRED 2026-08-26** — see **§A.2** in APPENDIX A, row *Header, lines 18–22*: the tree
is **1.10.2** and **neither zip exists** — all twelve packages in `publish/` were deleted
2026-08-20 (`publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md` is the surviving record).
Packages are built on demand with `scripts/pack.mjs`. The 85-entry count still holds.

---

## 0. The 🔴 OWNER list — start here, everything else waits on these

| # | Item | Where it lands | Notes |
|---|---|---|---|
| O1 | **Legal name** (person or company) | Chrome trader details · Edge publisher · AMO account · `LICENSE` Required Notice · `PRIVACY-POLICY.html` §1 and footer | Must be **identical in all five**. This is the single most-repeated OWNER value in the project; decide it once and write it down. |
| O2 | **Trader address + phone + email** for the EU DSA | Chrome dashboard → **Account → Trader status** | If you declare **Trader**, Google **publishes your legal name, physical address, email and phone to EEA users on the listing**. That is the law's intent, not an oversight. A home address becomes public — if that is not acceptable, the usual answers are a registered business address, a company formation with a registered office, or a virtual-office/agent address you are entitled to use. Google verifies the details; **budget days, not minutes**, and do it before you need to publish. Non-trader status is only correct if the extension is genuinely outside any trade, business or profession — that is a call for you, not an agent. |
| O3 | **A domain you control** → the Firefox `gecko.id` | `publish/manifest.firefox.json` | 🚧 **BLOCKER for AMO.** Currently `fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. Format `^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$`, ≤80 chars. **Permanent once AMO signs it** — changing it later publishes a *different* add-on, not an update. `node publish/verify-firefox-package.node.js` refuses to pass while the placeholder stands, by design. **This is the same domain decision as hosting the privacy policy** (`PRIVACY-POLICY-HOSTING.md` §3d) — one purchase settles both. ⚠️ **RETIRED 2026-08-26** — see **§A.2** in APPENDIX A: `gecko.id` is **`fullshot@nikatru.com`** (derived from `publish/identity.json`, domain chosen 2026-08-18) and `node publish/verify-firefox-package.node.js` exits **0**, re-measured 2026-08-26. The AMO-permanence warning above is still a true fact; it just no longer names an open item. |
| O4 | **Store developer accounts** | ×3 | Chrome: Google account + **US$5 one-time** registration. Edge: Microsoft account, Partner Center, free. Firefox: Firefox account, free. Register all three before you need them; each has its own verification step. |
| O5 | **Screenshots and promo tiles** | All three listings | 🚧 **BLOCKER — no store accepts a listing without at least one screenshot.** Specs in §5. `Reference/*.png` are development comparison shots at the wrong dimensions; they are a starting point, not assets. |
| O6 | **Support email** (and optional homepage/support URL) | All three listings + `PRIVACY-POLICY.html` | Becomes public. A role address (`support@…`) ages better than a personal one. Chrome additionally requires a **verified** contact email at account level. |

Two more that are owner-gated but are work rather than facts:

| | | |
|---|---|---|
| O7 | **On-device QA pass** | 🚧 Batch capture, Beautify, Scroll→Clip, and the `test/redact-e2e.html` fixture are implemented and pass the sandbox sims but have not been exercised by hand in a real browser. Every store penalises description-vs-behaviour mismatch, and your screenshots have to show something true. Do this before you write the listing copy, not after. |
| O8 | **Rebuild the Firefox zip after setting the gecko id** | The zip in `publish/` was built with the placeholder id inside it. Setting O3 changes `manifest.firefox.json`, so the package must be rebuilt (`node publish/package.node.js`) and re-verified before upload. ⚠️ **RETIRED 2026-08-26** — see **§A.2**: moot as written. O3 is set, no zip survives in `publish/` to go stale, and CI builds with `scripts/pack.mjs`, not `publish/package.node.js`. |

---

## 1. Facts that are the same in all three stores

| Field | Value | |
|---|---|---|
| Product name | `FullShot - Full Page Screen Capture` | ⚙️ matches `_locales/en/messages.json` → `appName`. 35 chars. |
| Short name | `FullShot` | ⚙️ `appShortName`. |
| Version | `1.10.1` | ⚙️ `manifest.json` **and** `publish/manifest.firefox.json` — the gate fails on drift. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row *§1, Version row*: the tree is **1.10.2**, and `publish/manifest.firefox.json` is an overlay that restates no version, so the two cannot drift. |
| Price | Free | ✍️ |
| In-app purchases | None | ✍️ |
| Ads | None | ✍️ |
| Analytics / telemetry | None | ✍️ Audited: no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or `EventSource` anywhere in shipped code. |
| Remote code | None | ✍️ Every `importScripts` / `<script src>` is a local relative path. No `eval`, no `new Function`, no CDN, no WASM. |
| Mature / sensitive content | No | ✍️ |
| Account required | No | ✍️ |
| Works offline | Yes | ✍️ |
| Languages | 55 | ⚙️ `_locales/`. `default_locale: "en"`. |
| Privacy policy URL | 🔴 OWNER — same URL in all three | See `PRIVACY-POLICY-HOSTING.md`. |
| Category | **Productivity** (alternate: Tools) | ✍️ |

**Long-form copy** — product name, 128-char summary, and the full detailed
description are already paste-ready in `STORE-LISTING.md`. Do not rewrite them
per store; divergent claims across three public listings is a finding waiting to
happen.

---

## 2. Chrome Web Store — field by field

### 2a. Account level (once, not per item)

| Field | Answer |
|---|---|
| Developer account | 🔴 O4 — Google account, US$5 one-time |
| Publisher display name ("Offered by") | 🔴 O1 |
| Contact email | 🔴 O6 — **must be verified**; unverified blocks publishing |
| Physical address | 🔴 O2 |
| **Trader status** | 🔴 O2 — Trader or Non-trader. If Trader: legal name, address, phone, email, **published to EEA users**. Verification takes time. |

### 2b. Store listing tab

| Field | Limit | Answer |
|---|---|---|
| Product name | 75 | ✍️ `FullShot - Full Page Screen Capture` (35) |
| Summary / short description | 132 | ✍️ `STORE-LISTING.md` § Summary — 128 chars, verified under the limit |
| Detailed description | 16,000 | ✍️ `STORE-LISTING.md` § Detailed description — plain text, no Markdown |
| Category | one | ✍️ Productivity |
| Language | one | ✍️ English (the item ships 55 locales; this field is the listing language) |
| Store icon | 128×128 PNG | ⚙️ `icons/icon128.png` — 🔴 confirm it is final art |
| Screenshots | 1–5 | 🔴 O5 — see §5 |
| Small promo tile | 440×280 | 🔴 O5 — optional to publish, required to be considered for featuring |
| Marquee promo tile | 1400×560 | 🔴 O5 — optional |
| YouTube video | — | Optional; skip |
| Official / homepage URL | — | 🔴 O6, optional |
| Support URL | — | 🔴 O6, optional |
| Mature content | — | ✍️ No |
| Google Analytics ID | — | ✍️ Leave empty — the item ships no analytics and adding a listing-analytics ID would contradict the privacy copy |

### 2c. Privacy practices tab

Every answer here is worked out in `PRIVACY-POLICY-HOSTING.md` §4, including
*why* "no data collected" is the wrong answer for a screenshot tool.

| Field | Answer |
|---|---|
| Single purpose | ✍️ `STORE-LISTING.md` § Single-purpose description |
| Justification: `activeTab` | ✍️ `STORE-LISTING.md` |
| Justification: `scripting` | ✍️ `STORE-LISTING.md` |
| Justification: `downloads` | ✍️ `STORE-LISTING.md` |
| Justification: `storage` | ✍️ `STORE-LISTING.md` |
| Justification: `unlimitedStorage` | ✍️ `STORE-LISTING.md` |
| Justification: host permission `<all_urls>` | ✍️ `STORE-LISTING.md` — stress that it is **optional** and requested at runtime |
| Are you using remote code? | ✍️ **No, I am not using remote code** |
| Data usage → Website content | ✍️ **YES** |
| Data usage → the other eight categories | ✍️ **NO** (each reasoned in `PRIVACY-POLICY-HOSTING.md` §4c) |
| Limited Use certifications ×3 | ✍️ Tick all three — FullShot qualifies for each |
| Privacy policy URL | 🔴 O6 / hosting |

### 2d. Distribution tab

| Field | Answer |
|---|---|
| Visibility | ✍️ Public (consider **Unlisted** for a first submission — you get a real review and a real install without a public launch) |
| Distribution regions | ✍️ All regions — **but EEA distribution depends on the trader declaration (O2)** |
| Pricing | ✍️ Free |

### 2e. Reviewer notes — ✍️ DRAFTED, paste as-is

```
FullShot is a screenshot utility that runs entirely on-device. There are no
accounts, no servers, and no test credentials to provide.

To exercise the item: open any web page, click the FullShot toolbar icon, and
choose Full page / Visible / Region / Element. The capture opens in the
extension's own result page, where it can be annotated, redacted, beautified,
and exported as PNG / JPEG / WebP / PDF.

Notes for review:
- No remotely hosted code. Every script is a local relative path inside the
  package; there is no eval, no new Function, no CDN, and no WASM.
- No network activity of any kind. The package contains no fetch,
  XMLHttpRequest, WebSocket, sendBeacon, or EventSource call.
- Broad host access is declared as an OPTIONAL host permission and is never
  requested at install. It is requested at runtime, from a user gesture, only
  when the user enables cross-origin frame expansion (Options) or Batch URL
  capture. Declining leaves all other functionality working.
- "Website content" is disclosed under Data usage because a screenshot is
  website content under User Data FAQ Q2, and Q3 requires disclosure even for
  purely local handling. Nothing is transmitted.
- The optional PII redaction feature scans page text locally and paints opaque
  blocks over matches. Detected values are never stored, indexed, or sent.
- Code is unminified and readable as shipped.
```

---

## 3. Microsoft Edge Add-ons (Partner Center) — field by field

Edge runs the **identical Chromium package**. No manifest change, no code change.

| Field | Answer |
|---|---|
| Developer account | 🔴 O4 — Microsoft account, Partner Center, **free** |
| Publisher display name | 🔴 O1 |
| Package | ⚙️ `publish/fullshot-1.10.1.zip` — the same file Chrome gets ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row *Header, lines 18–22*: no zip exists in `publish/`; build one with `scripts/pack.mjs`. Still the same file Chrome gets. |
| Display name | ✍️ `FullShot - Full Page Screen Capture` |
| Short description | ✍️ `STORE-LISTING.md` § Summary |
| Description | ✍️ `STORE-LISTING.md` § Detailed description |
| Category | ✍️ Productivity |
| Search terms / keywords | ✍️ `screenshot`, `full page screenshot`, `screen capture`, `webpage capture`, `annotate`, `redact PII`, `screenshot to PDF` — factual, no competitor names, no stuffing |
| Store logo | 300×300 | 🔴 O5 (Edge asks for a larger logo than Chrome's 128) |
| Screenshots | 1–10, 1280×800 or 640×400 | 🔴 O5 |
| Small promo tile | 440×280 | 🔴 O5, optional |
| YouTube URL | Optional; skip |
| Website | 🔴 O6, optional |
| Support contact details | 🔴 O6 |
| **Privacy policy URL** | 🔴 — same URL as Chrome. Required. |
| Does this extension collect user data? | ✍️ **Yes — website content, handled locally, never transmitted.** Keep this consistent with the Chrome answer; both listings are public and comparable. |
| Markets / availability | ✍️ All markets |
| Visibility | ✍️ Public (or hidden-from-search for a soft launch) |
| Publisher / trader identity | 🔴 O2 — Partner Center verifies publisher identity at account level and collects the EU-facing details there. Same legal name and address as Chrome. Confirm the current form at submission. |
| Certification notes | ✍️ Reuse the Chrome reviewer notes in §2e verbatim |

---

## 4. Firefox AMO — field by field

Different manifest, different package, and Mozilla asks the data question **in
the manifest** rather than a dashboard.

### 4a. Blockers before upload

| | |
|---|---|
| 🚧 O3 | Real `gecko.id` on a domain you control. Permanent once signed. ⚠️ **RETIRED 2026-08-26** — see **§A.2**: the id is **`fullshot@nikatru.com`**. |
| 🚧 | `node publish/verify-firefox-package.node.js` must exit **green**. It is red today on purpose and names each blocker. ⚠️ **RETIRED 2026-08-26** — see **§A.2**: it exits **0** bare and **0** with `--zip` against a fresh build, re-measured 2026-08-26. |
| ⚠️ BUILD | Source `background.js` still calls `importScripts` unguarded. `publish/package.node.js` applies the guard when it writes the Firefox zip and refuses to write an unguarded one — so **build with the packager, never by hand-zipping the source folder**. ⚠️ **RETIRED 2026-08-26** — see **§A.2**: `background.js` line 24 guards `importScripts` in the **source**. The build-with-the-packager rule under it still stands. |

### 4b. Listing fields

| Field | Answer |
|---|---|
| Developer account | 🔴 O4 — Firefox account, free |
| Distribution | ✍️ *On this site* (listed on AMO). Self-hosted signing is the alternative if you would rather distribute the `.xpi` yourself. |
| Package | ⚙️ `publish/fullshot-<ver>-firefox.zip`, rebuilt after O3 |
| Add-on name | ⚙️ from the manifest |
| Add-on URL slug | ✍️ `fullshot` if free, otherwise `fullshot-screen-capture` |
| Summary | 250 char max | ✍️ `STORE-LISTING.md` § Summary (128 chars) fits comfortably |
| Description | ✍️ `STORE-LISTING.md` § Detailed description |
| Categories | ✍️ *Photos, Music & Videos* and/or *Other* — AMO's category list has no direct "Productivity" equivalent for this shape of tool; pick at submission from what is offered |
| Tags | ✍️ `screenshot`, `capture`, `full page`, `annotate`, `privacy` |
| **License of your source code** | ✍️ **Custom License** → paste the contents of `LICENSE`, or link to it. **PolyForm Shield 1.0.0 is not in AMO's dropdown** (which lists MPL, GPL, MIT, BSD, Creative Commons, All Rights Reserved). Do **not** settle for a near-miss from the list to save a click — picking MIT here would publicly license the code under terms you did not choose. This field is why `LICENSE` had to exist before submission, not after. |
| Privacy Policy | 🔴 O6 / hosting — paste the URL. Since Aug 2025 Mozilla accepts a link to a self-hosted policy; older guidance required the full text pasted here. If the form insists on text, paste the rendered prose of `PRIVACY-POLICY.html`. Confirm which you get. |
| Data collection declaration | ⚙️ **Already in the manifest** — `data_collection_permissions.required: ["none"]`. Accurate because Mozilla's question is about data going *outside the add-on or the local browser*. Keep any dashboard answer consistent with it. |
| Support email / support site | 🔴 O6 |
| Icon | ⚙️ from the manifest |
| Screenshots | up to 10 | 🔴 O5 |
| Experimental? | ✍️ No |
| Requires payment / contributions? | ✍️ No |
| Notes for reviewers | ✍️ Chrome notes from §2e, **plus** the Firefox-specific paragraph below |

### 4c. Firefox-specific reviewer note — ✍️ DRAFTED, append to the §2e text

```
Firefox-specific notes:

- The manifest declares BOTH background.service_worker and background.scripts.
  This is deliberate and follows MDN's cross-browser recipe: Firefox runs the
  scripts array, and the addons-linter raises
  BACKGROUND_SERVICE_WORKER_NOFALLBACK (an error) for a service_worker with no
  scripts beside it. The BACKGROUND_SERVICE_WORKER_IGNORED warning is expected.

- background.js guards its importScripts calls behind a typeof check, because
  importScripts exists only in a service worker. In Firefox, pages/db.js and
  pages/batch.js load via background.scripts instead. One codebase, both
  browsers.

- data_collection_permissions is declared as {"required": ["none"]}. FullShot
  makes zero network calls; every byte it touches stays in the add-on's own
  storage on the user's machine. If the linter notes that this key postdates
  strict_min_version 128.0, that is expected — AMO enforces the key regardless
  of minimum version, and removing it would make the add-on unsubmittable.

- chrome.permissions.request is called only from user gestures (the Options
  toggle, the popup capture click, and Batch "start"), as Firefox requires.

- The code ships unminified and unobfuscated; no build step or source archive
  is needed for review.
```

### 4d. Test with `web-ext` before submitting

```bash
node publish/verify-firefox-package.node.js   # in-repo gate first — free and instant
npm i -g web-ext
web-ext lint     # static AMO checks
web-ext run      # launches Firefox with the add-on loaded — this is the O7 QA pass
web-ext build    # produces the submittable .zip
```

---

## 5. Visual assets — the exact specs (🔴 O5)

| Asset | Chrome | Edge | AMO |
|---|---|---|---|
| Screenshots | 1–5 · **1280×800** or 640×400 · PNG or JPEG · **24-bit, no alpha channel** · full-bleed, no padding | 1–10 · 1280×800 or 640×400 | up to 10 · PNG/JPEG |
| Store icon | 128×128 PNG (⚙️ already packaged) | **300×300** PNG | from the manifest |
| Small promo tile | 440×280 PNG/JPEG | 440×280 | — |
| Marquee tile | 1400×560 (optional) | — | — |

Practical notes:

- **A transparent PNG is the most common rejection** on the Chrome screenshot
  upload. Flatten onto an opaque background.
- Shoot the screenshots **after** the O7 QA pass, from the real product. A shot
  of a feature that misbehaves on device is a description-vs-behaviour finding
  with a picture attached.
- The obvious five: (1) the popup with the four capture modes, (2) a long page
  captured seam-free, (3) the editor with annotations, (4) redaction with visible
  opaque blocks, (5) Beautify output. Each carrying one short caption.
- Do not put a competitor's name or logo in a screenshot.
- **Screenshot your own screenshots carefully.** These images will be public
  forever. Use a throwaway profile and a page with no real data in it — a
  privacy tool whose store listing leaks the developer's inbox is a bad first
  impression and an avoidable one.

---

## 6. Open items that are not OWNER decisions

| # | Item | Status |
|---|---|---|
| N1 | Manifest description is **137 chars**, over the 132 the store displays | Cosmetic, not a submission blocker. **No longer a one-line manifest edit** — since the i18n phase the string lives at `_locales/en/messages.json` → `appDescription`, and changing it means changing it in 55 locales. `_locales/make-locales.mjs` has a guard that refuses to replace real translations with English fallback, with `--adopt` as the remedy. Read that file before touching `_locales`. Fold into a version bump, not into submission week. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row *§6 **N1***: fixed in 1.10.2. The en `appDescription` is **111 chars** and `policy-check.mjs` PASSES the store-limit check across all 55 locales (EXIT **0**, re-measured 2026-08-26). |
| N2 | `shipprobe-DELETE-ME.txt` (0 bytes) at the repo root | Not in either zip (the packager uses an allowlist). Delete it — `GIT-SETUP.md` step 0c. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row *§6 **N2***: already gone; `find . -name shipprobe*` over the repository returns nothing. |
| N3 | `verify-firefox-package.node.js` red | By design, and correctly red: one OWNER blocker (O3) and one BUILD note. Not one of the eleven test tiers; do not add it to the all-green set. |

---

## 7. Order of operations

1. 🔴 Settle **O1** (legal name) and **O3** (domain). They unblock the most.
2. Register the three developer accounts (**O4**). Start Chrome's **trader
   verification (O2)** immediately — it is the longest pole and it is a hard gate
   on EEA distribution.
3. Fill the placeholders in `PRIVACY-POLICY.html`, host it, note the URL
   (`PRIVACY-POLICY-HOSTING.md`).
4. Fill the LICENSE Required Notice with O1.
5. Do the **on-device QA pass (O7)** — batch, Beautify, Clip, redaction fixture.
6. Take the **screenshots (O5)** from the QA'd build.
7. Set `gecko.id` from O3, rebuild both packages
   (`node publish/package.node.js`), and get
   `node publish/verify-firefox-package.node.js` **green** (**O8**).
   ⚠️ **RETIRED 2026-08-26** — see **§A.2** (**O3**, **O8**, and the §4a row):
   this step is already done. `gecko.id` is `fullshot@nikatru.com`, the gate exits
   **0**, and packages are built on demand with `scripts/pack.mjs`.
8. Submit **Chrome** first — it has the strictest data disclosure, so anything
   it questions is worth knowing before the other two.
9. Submit **Edge** with the same package and the same answers.
10. `web-ext lint` / `run` / `build`, then submit **AMO**.
11. Tag the release in git (`GIT-SETUP.md` step 12) so the submitted tree is
    permanently identifiable.

---

## 8. The day a store approves — the four edits, in order

*Added 2026-08-27. This is an ADDITION, not an edit: nothing in §§0–7 changed, so
Appendix A's "everything above this line is left exactly as written" still holds
of the sections it was written about.*

§7 ends at *submitted*. Four things move when a store answers **approved**, and
they are declared in four places — `tool.json` `listings.<store>`, `tool.json`
`storeMetadata.stores.<store>.served`, `tool.json` `status`, and the two
**generated** files (`catalog/extensions.json`, the `README.md` catalog table).
Do this **once per store**, on the day that store's listing is public — not the
day it was submitted.

**Step 0 is an ordering fact, not a courtesy.** `served: true` is what ARMS the
screenshot, directory and URL limbs of `check-store-metadata`. Flip it with
`store/_shared/screenshots/` still empty and that guard turns from an owner
action into **EXIT 1** — *"the directory holds no .png/.jpg, and a store row is
`served: true`"*. **O5** is therefore a precondition of this section.

0. Commit the screenshot set you uploaded (**O5**, §5).
1. Paste the public listing URL into `tool.json` → `listings.<store>`.
2. Set `storeMetadata.stores.<store>.served` to `true` on that same store's row.
3. Set `tool.json` → `status` to `"shipping"` — once, at the first live listing.
4. Regenerate both derived files and commit the regenerated bytes:
   `node scripts/publish-catalog.mjs` **and** `node scripts/gen-catalog.mjs`.

Then, each exit code read on its own line:

| command | EXIT |
|---|---|
| `node scripts/publish-catalog.mjs --check` | **0** |
| `node scripts/gen-catalog.mjs --check` | **0** |
| `node scripts/check-catalog.mjs` | **0** |
| `node scripts/check-store-metadata.mjs fullshot` | **0** |

Executed end to end on 2026-08-27 on a scratch copy of this tree, with
`listings.chrome` set to a real `/detail/<slug>/<32-char-id>` URL and one image in
`store/_shared/screenshots/`: all four **0**. **Each step omitted in turn goes
red**, which is the only reason to trust the four zeros — step 2 omitted →
`check-store-metadata` **1** (*"listings.chrome is live, so
storeMetadata.stores.chrome.served is true"*); step 3 omitted → `check-catalog`
**1** (*"every tool.json status agrees with its own listings"*); step 4 omitted →
`publish-catalog --check` **1**.

🔴 **STEP 4 IS THE ONE THAT FAILS SILENTLY.** With the catalogue left stale,
`check-catalog` still exits **0** and prints the owner action *"no row … carries a
store listing … Unlisted: fullshot"* — a sentence that is false about a live
extension. `check-catalog` grades what the catalogue **says**; only
`publish-catalog --check` grades whether it is **current**. Run both. And
`gen-catalog` is graded by **nothing on CI** — `grep -rn 'gen-catalog' .github/`
returns no lines — so the `README.md` table is the one derived file no runner will
catch for you.

**There is no `itemId` / `productId` field, and that is deliberate.** The Chrome
item id is the last path segment of the Chrome listing URL —
`https://chromewebstore.google.com/detail/<slug>/<32-char-id>`, this corpus's own
record at `Private/extensions/DISTRIBUTION.md:172` and `Private/extensions/NAMING.md:27`
(both moved there 2026-09-05 when Extensions_Private folded into the platform
corpus, ADR 067 decision 1). A separate
slot would be a second declaration of a fact `listings.chrome` already carries,
free to drift in the direction that reports clean. Do not add one.

---

# APPENDIX A — DATED CORRECTION, 2026-08-22

**Everything above this line is left exactly as written.** It is a dated snapshot and it was
true of the tree it described. This appendix does not rewrite it; it records, item by item,
which of its claims are **false today**, what the claim said, and **what was measured instead**
— by running the thing, on 2026-08-22, with the exit code captured on its own line. Where a
claim is **still true it is not listed here**, because marking real owner work "done" is the
more expensive mistake of the two.

Read order: this appendix wins over the body on any point it names. On every point it does
not name, the body stands.

## A.1 What was re-run, and what it exited

| Command | Exit | What it printed |
|---|---|---|
| `node scripts/policy-check.mjs fullshot` | **0** | `15 passed` — including `name/short_name/description within store limits — checked across all 55 locale(s)` and `the Firefox add-on id is set — fullshot@nikatru.com`. It also prints warning(s); **the count is deliberately not recorded**, because `policy-check.mjs` is mid-edit to retire a false-positive locale warning and the same command can honestly print a different number depending on merge order. `EXIT 0` is the stable fact. ⚠️ **UPDATED 2026-08-26** — the cell above stands as the 2026-08-22 record. The count is no longer withheld and no longer 15: this command prints `16 passed` with **no warnings**, EXIT **0**, re-measured 2026-08-26. `manifest.json` gained `content_security_policy.extension_pages`, which closed the CSP `connect-src` warning; the locale false positive the cell anticipates was already closed by then. See the appended note below this table before repeating the number to a reviewer. |
| `node scripts/check-version.mjs fullshot` | **0** | `3 passed` — `manifest.json declares v1.10.2`, `CHANGELOG top entry is [1.10.2]`, `publish/manifest.firefox.json is an overlay` |
| `node scripts/check-store-metadata.mjs fullshot` | **0** | `25 passed · 1 owner action(s)`; `3 store row(s) graded, 15 listing file(s) read, across 1 tool(s)`. ⚠️ The owner action is A.4's **O5**, the empty `store/_shared/screenshots/` — a 0 beside a bare pass-count would hide it. |
| `node scripts/check-core-sync.mjs fullshot` | **0** | `1 passed` |
| `node scripts/pack.mjs fullshot --target firefox --out <scratch> --release` | **0** | `85 file(s) to pack`, `firefox manifest — publish/manifest.firefox.json applied as a merge patch — gecko.id fullshot@nikatru.com` |
| `node publish/verify-firefox-package.node.js` (bare, exactly as `ci.yml` invokes it) | **0** | `SOURCE PASSES — NO PACKAGE WAS GRADED` |
| `node publish/verify-firefox-package.node.js --zip <scratch>/fullshot-firefox.zip` | **0** | `ALL PASS` — 85 entries, packaged manifest === merged Firefox manifest at 1.10.2 |
| all eleven declared sims, each run separately on Node v24.18.0 | **0** each | ten `test/*.node.js` plus `test/pixel-sim/run.js` |
| `node scripts/check-store-packages.mjs fullshot` | 0 | ⚠️ **read the print, not the code:** `ZERO PACKAGES WERE PRESENT, so this run proved nothing about any artifact.` **That print is conditional on the subject being absent, which is the state of a fresh checkout** — the script searches `publish/` and `dist/` (`DEFAULT_DIRS`), both of which are empty here. Run it on a machine that has just built, and it opens and grades whatever it finds; `ci.yml`'s `package` job relies on exactly that, invoking it as `--dir dist` four steps after the build. So the *structural* claim — bare, on a clean tree, this gate proves nothing about any artifact — is the durable one; the printed line is what a clean tree makes it say. |

⚠️ **APPENDED 2026-08-26 — §A.1 above stands as written and is left verbatim as the 2026-08-22
record.** One row is stale and is corrected here rather than in place: `node scripts/policy-check.mjs
fullshot` now prints **`16 passed`, no warnings, EXIT 0** (it printed `15 passed · 1 warning(s)` at the
2026-08-26 baseline, before `manifest.json` was touched). `manifest.json` now declares
`content_security_policy.extension_pages` with `connect-src none`, which the browser enforces on
extension pages rather than this repo merely asserting it.

🔴 **THIS IS THE STORE-SUBMISSION DOCUMENT, so the limits ship with the claim.** A reviewer asking
"does the browser enforce your zero-network claim?" must get both of these in the same breath, or the
answer overclaims:

- **CHROMIUM ONLY.** `publish/manifest.firefox.json` deletes the key again for Gecko with an RFC 7386
  `null` member, deliberately: the AMO build stays on the strict MV3 default, and the Firefox package
  carries no `connect-src` at all. Counting the surface x browser grid — the 8 extension pages,
  `background.js`, and `content/capture.js` + `content/region.js` + `content/frame-expand.js`, across
  Chromium and Firefox — **two of the six cells** are backed by the browser. Firefox users rely on the
  source scan alone.
- **SIX OF THE SEVEN DECLARED DIRECTIVES ARE GATED BY NOTHING HERE.** The policy declares `script-src`,
  `object-src`, `img-src`, `connect-src`, `frame-src`, `base-uri` and `form-action`.
  `scripts/policy-check.mjs:589-607` is the only site in this repo that reads a directive off this
  manifest, and it reads `connect-src` only — deleting `img-src`, or setting it to `*`, leaves the gate
  at `16 passed` EXIT 0. The browser honours all seven; this repo verifies one. And `extension_pages`
  does not govern content scripts in either browser.

**What can honestly be told to a reviewer:** FullShot declares `connect-src none` on extension pages in the
Chromium package, and the packaged sources contain no network call in either package. What must not be
said is that the browser blocks network access for every FullShot surface, or in Firefox.


## A.2 Claims in this document that are FALSE today

| Where | What it says | What was measured 2026-08-22 |
|---|---|---|
| Header, lines 18–22 | "Package under discussion: **v1.10.1**, built and verified. `publish/fullshot-1.10.1.zip` · `publish/fullshot-1.10.1-firefox.zip`" | The tree is **1.10.2** (`manifest.json` line 5). **Neither zip exists.** All twelve packages in `publish/` were deleted 2026-08-20 — the record is `publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`, kept deliberately as the only survivor. `git ls-files \| grep '\.zip$'` returns exactly **one tracked** file and it is `templates/tool/publish/skeleton-0.0.1.zip` (measured 2026-08-22). ⚠️ **Say *tracked*, and mean it.** This sentence first said "a repo-wide `find . -name '*.zip'` returns exactly one" — which is true only on a tree nobody has built in. `find` also sees build output, and `.gitignore` covers `dist/` but not the `dist2/` the determinism check writes, so on a machine that has just built, the same `find` returns the tracked one PLUS one zip per built target in `dist/` and again in `dist2/`. That is not a number this document can pin, which is the point: the tracked count is the one that does not depend on who ran what. It was measured **1** on 2026-08-22 by both commands, on a checkout with no build output present. Packages are built on demand by `scripts/pack.mjs`. |
| §1, Version row | `1.10.1` | **1.10.2**, in `manifest.json`. `publish/manifest.firefox.json` no longer restates the version at all — it is an RFC 7386 merge patch (511 bytes, five keys) since 2026-08-18, so the two *cannot* drift and `check-version` says so by name. |
| **O2** — trader status, and §7 step 2 "start Chrome's trader verification immediately — **it is the longest pole** and a hard gate on EEA distribution" | open OWNER work | **DONE for Chrome, and done for over a week.** `nikatru/vendors/google.md` line 32: Chrome Web Store **publisher account LIVE 2026-08-12**, display name **NIKATRU**, publisher id `9e8074da-d51a-4406-a1b2-dd492338415a`, US$5 fee paid, **TRADER declared *and* VERIFIED** through the Google payments profile. The longest pole was pulled on 2026-08-12. ⚠️ One nuance the body could not have known and that is **not** closed: `nikatru/vendors/mozilla.md` records AMO as **not asking** for a trader declaration at signup and records that as *not found in AMO's published policies*, **explicitly not as "not required"** — an obligation could live in the Mozilla Add-on Distribution Agreement, which has not been read. So AMO holds no legal-entity identity for NIKATRU. That is an open **question**, not an open task. |
| **O3** — "🚧 BLOCKER for AMO. Currently `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` … `verify-firefox-package.node.js` refuses to pass while the placeholder stands" | 🚧 BLOCKER | **DONE.** `gecko.id` is **`fullshot@nikatru.com`**, derived from `publish/identity.json` (`slug` + `ownerDomain`, domain chosen 2026-08-18). `verify-firefox-package.node.js` **PASSES** `gecko.id is NOT the placeholder`, plus the Mozilla email-format limb and the ≤80-character limb (it is 20). `policy-check` and `pack.mjs` assert it independently. The permanence warning in the body is still a true fact about AMO — it just no longer describes an open item. |
| **O4** — "Store developer accounts ×3 … Register all three" | open OWNER work ×3 | **Two of three are LIVE, both since 2026-08-12.** Chrome: live, fee paid, trader-verified (above). Firefox/AMO: account **created 2026-08-12** on `rajasekar@nikatru.com`, free (`nikatru/vendors/mozilla.md`). **Edge/Microsoft Partner Center is the one genuinely pending account** — see A.4. |
| **O8** — "Rebuild the Firefox zip after setting the gecko id … `node publish/package.node.js`" | pending on O3 | **Moot as written.** O3 is set, no zip in `publish/` survives to be stale, and every zip is now built fresh. Also the command has moved: `ci.yml` and `release.yml` build with **`scripts/pack.mjs`**; `publish/package.node.js` is still present and still authoritative for its own ALLOW list, but it is not what CI runs. |
| §2b, Detailed description row | limit **`16,000`** | **Do not restate this number.** `tool.json` `storeMetadata._unverified` and `store/chrome/README.md` both record that the widely-repeated 16,000 appears **nowhere on developer.chrome.com** — `cws-dashboard-listing`, `best-listing`, `prepare` and `program-policies` all describe the field with no number. The gate deliberately refuses to enforce it (`check-store-metadata` prints `2990 chars, no sourced limit`). An invented limit fires on correct input; this factory has already rejected its own fixture that way once. |
| §4a, BUILD row | "Source `background.js` **still calls `importScripts` unguarded**" | **False.** `background.js` line 24 reads `if (typeof importScripts === 'function') {`. `verify-firefox-package.node.js` PASSES `source background.js guards importScripts` in the *build prerequisite* section. The standing rule under it — build with the packager, never by hand-zipping — is still correct and still worth keeping. |
| §4a and §6 **N3** — "`verify-firefox-package.node.js` must exit **green**. **It is red today on purpose** and names each blocker" / "red … By design, and correctly red: one OWNER blocker (O3) and one BUILD note" | 🚧 red by design | **EXIT 0, both ways.** Run bare — exactly as `ci.yml` invokes it — it exits 0 with `SOURCE PASSES — NO PACKAGE WAS GRADED`. Run `--zip` against a freshly built package it exits 0 with `ALL PASS` and adds seven assertions the source limb cannot make. Both named blockers are gone: O3 is filled, and the BUILD note is the guard that already passes. |
| §6 **N1** — "Manifest description is **137 chars**, over the 132 the store displays" | open, cosmetic | **Fixed in 1.10.2.** `policy-check` PASSES `name/short_name/description within store limits — checked across all 55 locale(s)`. `CHANGELOG.md` records the fix: en `appDescription` 137 → 111, longest catalogue now 132, longest locale name 44. The three over-length locale **names** (`ca`, `es`, `es_419`) came down with it. |
| §6 **N2** — "`shipprobe-DELETE-ME.txt` (0 bytes) at the repo root … Delete it" | housekeeping owed | **Already gone.** `find . -name 'shipprobe*'` over the whole repository returns nothing. |
| §7 step 3 — "Host the privacy policy … paste that one URL into all three dashboards" | open | **Hosted and live.** `publish/identity.json` carries `https://nikatru.com/fullshot/privacy` (filled 2026-08-21). A GET on 2026-08-22 answered **200 with 0 redirect hops**. `publish/PRIVACY-POLICY.html` has **zero** remaining placeholders and names *Rajasekar Selvam, trading as NIKATRU* and `support@nikatru.com`. The one act left is pasting it into dashboards, which is part of submission itself. |

## A.3 One correction to §7 step 4 and O1 — the LICENSE line, so nobody edits the wrong one

§7 step 4 says *"Fill the LICENSE Required Notice with O1"* and O1 lists `LICENSE` Required Notice
among five places. **That is still genuinely open and still owner-only.** But `Extension/Full_Screen_Shot/LICENSE`
has **five** lines matching `Required Notice`, and **four** of them must not be touched. Run it
yourself — `grep -n 'Required Notice' Extension/Full_Screen_Shot/LICENSE` prints `35, 38, 168, 173, 180`
(counted 2026-08-22; the file was read, never edited):

- **`:35` and `:38`** sit **above** the horizontal rule at `:166`, inside PolyForm Shield 1.0.0's own
  §Notices **worked example**. `:38` is the `Copyright Yoyodyne, Inc. (http://example.com)` example
  text. Lines `:172-173` of that same file say the text above the rule is *"the PolyForm Shield License
  1.0.0, verbatim and unmodified; do not edit it."*
- **`:173`** is the tail of that very sentence — *"…do not edit it. The Required Notice line is the one
  thing this"* — so it **matches the grep while being prose inside the warning itself**. It is a
  non-editable line, not a fifth candidate.
- **`:180`** is this repo's explanatory echo of the same example.
- ✅ **`:168` IS THE ONE FILLABLE SLOT:**
  `Required Notice: Copyright <OWNER LEGAL NAME OR COMPANY> (<OPTIONAL URL>)`
  flagged directly beneath at `:170` with `>>> OWNER ACTION — replace the line above BEFORE the first commit. <<<`

The **value** is already settled and already public — `publish/PRIVACY-POLICY.html` line 132 and the
served page both say *"published by Rajasekar Selvam, trading as NIKATRU"*, and `vendors/google.md`
records that same name as the Chrome trader-**verified** legal identity. So this is a signature on a
decided value, not a decision. `templates/tool/LICENSE:1` carries the same slot as
`⟨LICENSOR⟩ (⟨LICENSOR_URL⟩)` and needs the same line. §4b's requirement to paste `LICENSE` into AMO
as a **Custom License** (PolyForm Shield is not in AMO's dropdown) is what makes this reach a store.

## A.4 What of this document is STILL OPEN — deliberately left standing above

Not corrected, because measurement says they are real:

- **O1 — legal name.** The *value* is settled and public. The remaining act is the owner writing it
  onto `LICENSE:168` and `templates/tool/LICENSE:1`. Owner-only: it is a licence grant.
- **O5 — screenshots and promo tiles.** `store/_shared/screenshots/` holds **`README.md` and nothing
  else** — zero `.png`/`.jpg`. `check-store-metadata` prints this as an owner action rather than
  failing, precisely because no store row is served. Still needed: 1–5 shots at 1280×800 (or 640×400,
  **opaque**), the 440×280 promo tile, the optional 1400×560 marquee, and the **300×300 Edge logo**,
  which cannot honestly be produced by upscaling a 128px icon. Plus confirmation that
  `icons/icon128.png` is final art.
- **O6 — support email.** `support@nikatru.com` is asserted in `publish/identity.json`, in
  `PRIVACY-POLICY.html` and on the served page, and `store/_shared/support-url.txt` holds the issues
  URL. What is **not** verifiable from inside this repo is Chrome's account-level requirement that the
  contact email be **verified** in the dashboard. Leave the row standing until someone looks.
- **O7 — the on-device QA pass.** Batch capture, Beautify, Scroll→Clip and the `redact-e2e.html`
  fixture pass the sandbox sims (all eleven EXIT 0 above) and have still never been exercised by hand
  in a real browser. This gates O5, not the other way round: a screenshot taken before the pass
  advertises behaviour nobody has watched work, and every store penalises description-vs-behaviour
  mismatch while the long description names all three features.
- **§2c Privacy practices tab.** Every answer is drafted and internally consistent. What remains is a
  human ticking three Limited-Use certification boxes — a legal attestation, not a text field.
- **Edge / Microsoft Partner Center.** `nikatru/vendors/microsoft.md`: business verification
  **submitted 2026-08-05**, support case `2608120060000032`, and the last dated observation
  (2026-08-13 23:47 IST, screenshot) still reads *"Your documents are under review (typically takes 5
  business days)"* with **`Finish account setup` greyed**. Five business days elapsed **2026-08-20**,
  so the dashboard is worth re-reading. This blocks **Edge only** — Chrome and AMO are both live.
- **§7 step 11 — tag the release.** Unchanged and correct. Note for whoever does it: both repos are
  public and `release.yml` fires on a version tag with a bare `gh release create` and no `--draft`.
  There is no throwaway tag.
