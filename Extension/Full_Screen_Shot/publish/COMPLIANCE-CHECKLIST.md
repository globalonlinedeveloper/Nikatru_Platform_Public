# FullShot — Manifest V3 + Data-Minimization Compliance Checklist

Prepared for Chrome Web Store submission. The Aug 1, 2026 policy update is
**now in force**, not upcoming — these rules are live at the time of writing.
§C-FF covers the separate Firefox/AMO disclosure.
Every line is graded against the **shipped code**, not the trackers. The A–E
audit was performed at v1.9.11 and re-checked at **1.10.1** — root
`manifest.json` and `publish/manifest.firefox.json` both read 1.10.1, and both
packages in this folder are built from that source.

⚠️ **RETIRED 2026-08-26** — see **APPENDIX A §A.1** at the foot of this file: the basis has
moved to **1.10.2**, `publish/manifest.firefox.json` is now a version-less RFC 7386 merge
patch, and there are **no packages in this folder** (all twelve deleted 2026-08-20).

Legend: ✅ PASS · ⚠️ OWNER ACTION · ➖ N/A.

Companion documents added since the last revision:
`SUBMISSION-PACKET.md` (every field all three stores ask for, drafted or marked
OWNER) and `PRIVACY-POLICY-HOSTING.md` (getting the policy live, plus the exact
Chrome data-declaration answers). The consolidated owner list at the foot of
this file is the short version; those two are the working documents.

**Code audit basis (what was scanned):** all shipped JS/HTML/CSS in
`background.js`, `content/`, `pages/`, `popup/`, plus `manifest.json` and — since
the i18n phase — the 55 `_locales/<lang>/messages.json` files, which are now
part of the package (the `test/`, `Reference/`, `i18n/` and `*.md` trees are
excluded from the package and from these claims). Findings:
- **Zero network calls** — no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, or `EventSource` anywhere. (The only "fetch" strings are code comments.)
- **Zero remote code** — every `importScripts(...)` and `<script src>` is a local relative path (`pages/db.js`, `pages/batch.js`, `common.js`, etc.). No CDN, no `eval`, no `new Function`, no WASM.
- **Zero analytics / telemetry / ads.**
- **Only external URLs in code** are two string guards in `popup.js` (`chromewebstore.google.com` / `chrome.google.com/webstore`, used to detect uncapturable protected pages) and placeholder text — none are network endpoints.
- **Storage:** three areas, all on-device. `chrome.storage.sync` (settings only; 4 files) · IndexedDB `fullshot` (local capture history: `frames`, `captures`, `shots` stores) · `chrome.storage.session` (since 1.9.12, 2 files: a single `fsLastError` note so the popup can explain a failed capture — **scheme + host only, never a full URL**, never `local`, never `sync`, and gone when the browser closes). Nothing transmitted.
- **Localisation:** 55 locales ship in the package. They are static message catalogues — text only, no logic, no data collection surface. Re-verified for this revision.

---

## A. Manifest V3 technical compliance

| # | Requirement | Status | Evidence |
|---|---|---|---|
| A1 | `manifest_version: 3` | ✅ | `manifest.json` line 2 |
| A2 | Background is a service worker (no persistent page) | ✅ | `"background": { "service_worker": "background.js" }` |
| A3 | **No remotely hosted code** (the core MV3 rule) | ✅ | Audit: all scripts local; no remote import/fetch/eval/WASM |
| A4 | Default MV3 Content Security Policy (no `unsafe-eval`, no remote script) | ✅ | No `content_security_policy` override in `manifest.json` → strict MV3 default applies |
| A5 | No developer `key` or self-hosted `update_url` in manifest | ✅ | Neither field present — clean for CWS upload |
| A6 | Icons 16/32/48/128 all present and packaged | ✅ | `icons/` has all four; referenced in `icons` + `action.default_icon` |
| A7 | `minimum_chrome_version` declared | ✅ | `"116"` (optional but good practice; MV3 + optional host perms supported). Chrome/Edge only — deliberately **absent** from `publish/manifest.firefox.json`, where Gecko's `strict_min_version: "128.0"` does the job |
| A8 | Package excludes tests/dev/scratch files | ✅ | Zip = **85 entries** (30 shipping files + 55 `_locales/<lang>/messages.json`), leak check clean (no `test/`, `Reference/`, `i18n/`, `*.md`, `node_modules`, `*.node.js`, `DELETE`). Re-read from both 1.10.1 zips for this revision. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row *A8 / E1*: the 1.10.1 zips this cell was re-read from are gone (deleted 2026-08-20). The count is still **85**; it now rests on a fresh `scripts/pack.mjs` build, not on those files. |
| A9 | All in-package references resolve (self-contained) | ✅ | Reference-integrity script: every `<script src>`, `<link href>`, icon, `importScripts` target resolves inside the zip |
| A10 | `description` ≤ 132 chars (store display limit) | ⚠️ | **137 chars → Chrome truncates.** Cosmetic, not a blocker. **Where it lives has changed** — see A10-fix. ⚠️ **RETIRED 2026-08-26** — the en `appDescription` is **111 chars** today and `node scripts/policy-check.mjs fullshot` PASSES `name/short_name/description within store limits — checked across all 55 locale(s)` (EXIT **0**, measured 2026-08-26). This file has no appendix row for A10; the retirement is recorded in `SUBMISSION-PACKET.md` **§A.2**, row §6 **N1**. |
| A11 | `default_locale` set ⇒ `_locales/` present in the package | ✅ | `"default_locale": "en"` with all 55 catalogues packaged. Chrome **rejects** a package that names a `default_locale` it cannot find, so this is a hard upload gate, not a nicety. `publish/package.node.js` enumerates `_locales` through a dedicated path that bypasses the allowlist pattern language entirely, precisely so no future pattern edit can silently un-ship it. |

**A10-fix (drop-in replacement, 123 chars — verified):**
```
Full-page, region & element screenshots. Annotate, auto-redact PII, and export as PNG, JPEG, WebP, or PDF — 100% on-device.
```
⚠️ **Correction to the previous revision, which called this "a one-line edit to
`manifest.json`".** That is no longer true. Since the i18n phase, `manifest.json`
reads `"description": "__MSG_appDescription__"`, and the actual string lives at
`_locales/en/messages.json` → `appDescription` — with a translation in each of
the other 54 locales. Changing the English alone would leave 54 catalogues
describing a product feature set that no longer matches, and regenerating them
runs into `_locales/make-locales.mjs`'s guard, which **refuses any build that
would replace real translated text with an English fallback** (remedy:
`node _locales/make-locales.mjs --adopt`, which transcribes what is already on
disk into the translation memory first). **Read `_locales/make-locales.mjs`
before touching `_locales`.** This is now a small i18n task, not a one-liner —
fold it into a version bump, not into submission week.

---

## B. Permissions & minimum-permission (data minimization)

| # | Requirement | Status | Evidence |
|---|---|---|---|
| B1 | Every declared permission is actually used | ✅ | `activeTab`→`captureVisibleTab`; `scripting`→`executeScript`; `downloads`→`downloads.download`; `storage`→`storage.sync` (4 files) + `storage.session` (the last-failure note); `unlimitedStorage`→IndexedDB (`db.js`). None unused, and no new permission was needed for the session note. |
| B2 | No "future-proofing" / speculative permissions | ✅ | Each maps to a live feature (Minimum-Permission FAQ §5) |
| B3 | Least-privileged option chosen | ✅ | `activeTab` instead of a broad static host permission; `tabs` **not** declared (query/create work without it) |
| B4 | Broad host access (`<all_urls>`) is **optional**, not required | ✅ | `"optional_host_permissions": ["<all_urls>"]`; **no** static `host_permissions` |
| B5 | Optional host permission requested at runtime, feature-gated | ✅ | `chrome.permissions.request({origins:['<all_urls>']})` in `pages/options.js` (frame-expand toggle), `pages/batch.js` (batch), `popup/popup.js`; guarded by `permissions.contains` |
| B6 | Minimum-permission applies to optional perms too | ✅ | The single optional perm gates exactly two opt-in features (cross-origin frame expansion, batch capture) |
| B7 | Each permission is justified in the listing | ✅ | Justification text drafted in `STORE-LISTING.md` (paste into dashboard fields) |

Note on `unlimitedStorage` (B1): justified by the local capture History (screenshots are large; the default quota would silently evict the user's own history). It stores nothing off-device. Defensible and disclosed; if the owner ever wanted to be maximally minimal they could drop it and accept the default quota, at the cost of history reliability — not recommended.

---

## C. User Data policy & privacy (2026 rules)

| # | Requirement | Status | Evidence / Action |
|---|---|---|---|
| C1 | A privacy policy is posted (required — the item handles user data) | ⚠️ | Written and ready: `PRIVACY-POLICY.html`. **Owner must fill six placeholders, host it publicly, and paste the URL** into all three dashboards. Step-by-step, with five hosting options compared: **`PRIVACY-POLICY-HOSTING.md`**. Per FAQ Q14, local-only/Storage-Sync items still need one. |
| C2 | Local-only handling is still disclosed | ✅ | Privacy policy §3 discloses screenshots = website content handled locally (FAQ Q3). Also reflected in the dashboard disclosure (C4). |
| C3 | Data is strictly necessary to the single purpose (Aug 2026 Limited Use) | ✅ | Only website content (the screenshot), used only for the capture/edit/export feature; no unrelated collection |
| C4 | Privacy-practices tab: data-collection disclosure completed | ⚠️ | **Owner action** (data entry only — the answers are decided). Disclose "Website content"; all eight other categories NO. Each of the nine is answered with its reasoning in `PRIVACY-POLICY-HOSTING.md` §4c. See *Data-disclosure decision* below. |
| C5 | Limited-Use certification (3 affirmations) | ⚠️ | **Owner action** in dashboard — FullShot qualifies for all three (no sale, no unrelated use, no credit/lending). Pre-filled in `STORE-LISTING.md` and `PRIVACY-POLICY-HOSTING.md` §4c. |
| C6 | Limited-Use disclosure present ≤1 click from homepage | ✅ | Privacy policy §10 (host it and the requirement is met) |
| C7 | Secure transmission / encryption of user data | ➖ | No transmission occurs (FAQ Q16: local-only handling has no transmission-security obligation) |
| C8 | No collection of browsing activity beyond a user-facing feature | ✅ | No browsing activity collected at all; a page is read only on an explicit capture |
| C9 | No analytics, telemetry, ads, or data sale | ✅ | Audit: none present |
| C10 | Prominent disclosure + consent for data collection (FAQ Q10) | ✅ | Capture is user-initiated per action (click/shortcut); redaction is opt-in in Options; the optional broad-access grant shows Chrome's own consent prompt. No silent background collection to consent to. |
| C11 | **EU DSA trader / non-trader declaration** | ⚠️ | **OWNER ACTION — was missing from this checklist entirely, and it is a hard gate on EEA distribution, not a formality.** Every Chrome Web Store developer must declare trader status at **account** level. Declaring *Trader* means Google **publishes the legal name, physical address, email and phone to EEA users**; Google verifies the details, so it takes days, not minutes. Undeclared or unverified ⇒ the item is not distributed in the EEA. Edge collects the equivalent through Partner Center publisher verification. Detail and the privacy implications of using a home address: `SUBMISSION-PACKET.md` §O2. |
| C12 | Claims made to the user match what the code can deliver | ✅ | The listing, the policy **and the product string** all describe opt-in PII redaction the same way. `PRIVACY-POLICY.html` §3d carries an explicit **"What it cannot do"** paragraph: the scan reads only text the page exposes *as text*, so canvas-rendered pages, embedded images and scanned documents get no blocks even with the feature on. All three were rewritten to `REDACTION-CLAIM-SPEC.md` §7 when the claim was reduced: the product states what it did (matched / painted / confirmed opaque), shows the user the marked image before an AI hand-off, and says in every place that it cannot tell them the image is clean. The Options row — `optionsRedactPIIDesc`, the sentence a user actually reads before switching the feature on, in 55 languages — was the last carrier of the old *"scans the page … over each"* wording and now matches the other two; `test/i18n-sim` grades the redaction strings by shape rather than by key prefix so a fourth carrier cannot appear unnoticed. §3d also discloses the one new thing stored locally — the positions of the blocks it confirmed. A protection claimed but not delivered is the most damaging thing a privacy product can ship, and the copy a user reads inside the product is the version they will hold you to. |

### Data-disclosure decision (the one real judgment call) — needs owner sign-off
Google's User Data FAQ (Q2) explicitly lists "taking screenshots or capturing
data from a web page" as **handling user data**, and (Q3) says local-only
handling **must still be disclosed**. Therefore the honest, defensible posture is:
- In the **Privacy practices → Data usage** tab, disclose **"Website content"** as data the extension collects/uses, and rely on the privacy policy to make clear it is processed **locally only and never transmitted**.
- Do **not** mark "no data collected." Even though FullShot sends nothing, a screenshot is website content under Google's definition; "no data" risks a policy-mismatch strike (dashboard vs. behavior, FAQ Q3/§Simplifying-privacy #3).
- Certify all three Limited-Use boxes (FullShot qualifies).

This is a compliance judgment, not a code fact — recommended above, but the owner (or their counsel) makes the final dashboard selection.

---

## C-FF. Firefox / AMO data disclosure (different question, different answer)

Mozilla asks its version of the question **in the manifest**, not in a dashboard.
Since **2025-11-03** every new add-on must declare
`browser_specific_settings.gecko.data_collection_permissions`, and a submission
without it is rejected at upload.

| # | Requirement | Status | Evidence / Action |
|---|---|---|---|
| F1 | `data_collection_permissions` declared | ✅ | `publish/manifest.firefox.json` → `{ "required": ["none"] }` |
| F2 | The declaration is honest | ✅ | Zero network calls; every byte stays in the add-on's own storage on the machine |
| F3 | `"none"` used correctly (exclusive — never alongside a data type) | ✅ | `required` is exactly `["none"]`; no `optional` array |
| F4 | An add-on id the owner controls | ⚠️ | **OWNER ACTION** — `gecko.id` is still `fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. AMO checks the id for uniqueness at first signing and the listing *is* that id afterwards; changing it later publishes a different add-on, not an update. `node publish/verify-firefox-package.node.js` refuses to pass until it is replaced. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row **F4**: the id is **`fullshot@nikatru.com`** and `node publish/verify-firefox-package.node.js` exits **0**. AMO permanence is still true; it no longer names an open item. |
| F5 | Firefox background fallback present | ✅ | `background.scripts` beside `service_worker` — required by the AMO linter (`BACKGROUND_SERVICE_WORKER_NOFALLBACK`, an error) |
| F6 | Packaged `background.js` guards `importScripts` | ✅ (with a standing rule) | Source `background.js` is **still unguarded** — `node publish/verify-firefox-package.node.js` reports that, correctly, as a build prerequisite. It is no longer a manual step: `publish/package.node.js` applies the guard while writing the Firefox zip and **refuses to write an unguarded one at all**. Confirmed by the gate reading `fullshot-1.10.1-firefox.zip`. **The standing rule: build the Firefox package with the packager, never by hand-zipping the source folder.** ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row **F6**: the **source** is guarded — `background.js` line 24. The standing rule under this row is unaffected and still stands. |
| F7 | Manifest versions in step | ✅ | `publish/manifest.firefox.json` **1.10.1** = root `manifest.json` **1.10.1**; the gate fails on drift ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row **F7**, and **§A.1**: still ✅, by a stronger mechanism — the overlay states no version at all to compare, and the tree is **1.10.2**. |

### Why Chrome gets "Website content" and Firefox gets "none"
Both answers are honest, because the two stores are asking different questions.

- **Google** counts *handling* — its User Data FAQ (Q2) lists "taking screenshots or capturing data from a web page" as handling user data, and Q3 requires local-only handling to be disclosed anyway. Hence "Website content" (§C above).
- **Mozilla** counts *leaving the machine* — it defines the declaration as covering data "collected, used, transferred, shared, or handled **outside the add-on or the local browser**". Nothing FullShot touches goes outside the add-on or the local browser, so the correct value is `none`; declaring `websiteContent` here would over-warn users about a transmission that does not exist.

Sources: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ ·
https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/ ·
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings

Full Firefox runbook, including the two blockers above: `CROSS-BROWSER-PUBLISHING.md` §Firefox.

---

## D. Single purpose, content & prohibited categories

| # | Requirement | Status | Evidence |
|---|---|---|---|
| D1 | A single purpose is declared | ✅ | Drafted in `STORE-LISTING.md`: capture + work with screenshots of chosen pages |
| D2 | All features fit that purpose | ✅ | Editor, redaction, Beautify, scroll-clip, batch, PDF, history all serve screenshot capture/handling |
| D3 | Description matches actual behavior (no deceptive claims) | ⚠️ | Listing copy is grounded in shipped features. The redaction bullet — the one claim that did not match the code — has been rewritten to `REDACTION-CLAIM-SPEC.md` §7, and the ⚠️ owner-edit gate at the top of `STORE-LISTING.md` is removed with it (D3-note second part, C12). What is still open is not a claim but a **check**: three features have never been exercised on-device, so the copy is true as written and unverified by eye — see D3-note. |
| D4 | No prohibited categories | ➖ | Not a predictive-market, AI-safety-circumvention, or malware product (2026 additions N/A) |
| D5 | No affiliate/keyword spam, no misleading metadata | ✅ | Copy is factual; no keyword stuffing |

**D3-note (owner QA gate):** Batch URL capture (1.9.7), Beautify (1.8.0), and
Scroll→GIF/WebM (1.9.0) are implemented and pass the sandbox sims, but their
**browser UI is still "eyeball-pending"** per HANDOFF.md — no on-device run yet.
Nothing in the listing claims anything unshipped, but before submitting the owner
should do one on-device pass of these three plus the redaction end-to-end fixture,
so the store screenshots and claims are demonstrably true (CWS penalizes
description-vs-behavior mismatches). Store screenshots should be taken **after**
this pass, from the QA'd build — asset specs in `SUBMISSION-PACKET.md` §5.

**D3-note, second part — the redaction claim (RESOLVED this revision).**
The listing bullet used to promise that redaction *"finds … on the page and
bakes a SOLID block over each"* — two completeness claims about the page, from a
product that reads the DOM and cannot see the picture the compositor produced.
It has been rewritten to `REDACTION-CLAIM-SPEC.md` §7's wording: an act, its
limit, and the review. The bullet now says what FullShot scans, says plainly
that it reads text and not pictures, and says that it shows the user the marked
image before a hand-off rather than telling them the image is clean. The ⚠️
owner-edit gate that used to head `STORE-LISTING.md` is gone, because the
rewrite is what it asked for; a pointer to the governing spec stands in its
place so the bullet is not re-loosened by someone editing the listing alone.

**The product string moved with the documents, and that is the half that
matters.** The Options page carried the same two completeness claims —
*"Scans the page for … and paints a solid block over each"* — in the one place a
user decides whether to trust the feature, and in 55 languages. It now reads:
scans the text a page exposes, paints a block over what it matches, cannot read
text drawn as pixels, detection on your device, nothing ever sent, and review
the result yourself. All 54 translations were redone from each language's own
existing vocabulary rather than dropped to English fallback, and the
back-translation negation check regrades clean (432 graded, 0 flagged), so the
privacy claims inside that sentence are still verifiably intact in every locale.
`test/i18n-sim` now selects the strings it grades **by shape** — any key that
names redaction, plus any message that says the word — instead of by the two
key prefixes that let this sentence through; it additionally refuses "the page"
as the object of a FullShot verb and refuses *each* / *every* / *all* anywhere
in the set.

`PRIVACY-POLICY.html` §3d moves with it: "over each match **it finds**", a
longer "What it cannot do" listing the standing limits (form fields, attributes,
text split across styled fragments, frames it did not enter, five shapes and no
others), and the plain replacement for "lowers the chance … is not a guarantee":
**FullShot reports what it covered; it cannot tell you whether the image is
clean, because it never sees the image as a picture.**

**One new disclosure, and it is a real one.** §3d now discloses that FullShot
stores, locally and on the device only, the position and size of each block it
confirmed to be solid in the finished image, so it can mark those blocks when
the user reviews an image before handing it to an AI. It stores no coordinates
for anything it did not cover, never the matched text, and drops the positions
on any derivation. That storage is new in this revision and had to be disclosed
before it shipped, not after.

The data-disclosure line in `STORE-LISTING.md` — the one an auditor reads most
closely — has also moved: *"exists to remove PII, not gather it"* was the same
completeness claim in the worst possible place, and now reads *"exists to cover
matched patterns in the image, not to gather them."*

---

## E. Packaging integrity

| # | Requirement | Status | Evidence |
|---|---|---|---|
| E1 | Zip contains only shipping files | ✅ | **85 entries**, not 30 — the previous revision predated i18n. 30 shipping files (`manifest.json`, `background.js`, `content/`×3, `icons/`×4, `pages/`×18, `popup/`×3) **+ 55 `_locales/<lang>/messages.json`**. Re-confirmed by reading the central directory of both 1.10.1 zips: no `test/`, `Reference/`, `i18n/`, `*.md`, `*.node.js`, `node_modules/` or `DELETE` entries in either. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row *A8 / E1*: the 1.10.1 zips whose central directories this cell was read from are gone (deleted 2026-08-20). The **85** count survives, re-verified against a fresh `scripts/pack.mjs` build. |
| E2 | Package version matches manifest | ✅ | **No longer stale.** Both zips are `1.10.1`, matching root `manifest.json` and `publish/manifest.firefox.json`. `fullshot-1.10.1.zip` md5 `c601e5ed7396cf6a078cc64c273e5a8e` · `fullshot-1.10.1-firefox.zip` md5 `fb0c019994d9ca0d59f801583fc29146`. The packager writes fixed DOS timestamps, so these md5s are reproducible from the same tree — see `GIT-SETUP.md` step 11, which uses exactly that property to prove a clone is byte-faithful. Older zips (1.9.7, 1.9.11, 1.9.13, 1.10.0) are still in this folder as history; **do not upload one by mistake.** ⚠️ **RETIRED 2026-08-26** — see **§A.1**: there are **no packages in this folder**, and no older zips either — all twelve went on 2026-08-20. 🔴 The two md5 hashes are deliberately **not** re-derived: they describe files that no longer exist. The tree is **1.10.2**. |
| E3 | Service worker present in package | ✅ | `background.js` present (caught + fixed a first-build omission) |
| E4 | No leftover scratch in the source folder that could get re-zipped | ⚠️ | `shipprobe-DELETE-ME.txt` (0 bytes) still in the working folder. **Not** in either zip — the packager works from an allowlist, so an unexpected file cannot ride along. Now also matched by the new root `.gitignore`, so it cannot reach the repository either. Still worth deleting: `GIT-SETUP.md` step 0c. ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row **E4**, and **§A.3 item 13**: already gone. |
| E5 | The Firefox package is a *different build*, not a copy | ✅ | Its zipped `manifest.json` must equal `publish/manifest.firefox.json` and its `background.js` must carry the `importScripts` guard — both enforced by `verify-firefox-package.node.js`, which reads the zip, and both produced automatically by `package.node.js` |
| E6 | Build artifacts are excluded from version control | ✅ | The new root `.gitignore` excludes `*.zip`, `node_modules/`, `Reference/`, the two test `out/` directories, OS droppings — and, four different ways, `.claude/secrets.env`, which holds a live token inside the tree. Verification commands: `GIT-SETUP.md` steps 6, 8 and 10. **No git command has been run; there is no repository yet.** |

---

## Consolidated OWNER-ACTION list (do before "Publish")

Ordered by what unblocks the most. The full field-by-field version, with every
answer that can be drafted already drafted, is `SUBMISSION-PACKET.md`.

1. **Settle your legal name and a domain you control.** One decision each,
   feeding five places: the EU DSA trader details, the `LICENSE` Required Notice,
   `PRIVACY-POLICY.html` §1 and its footer, the store publisher name, and (the
   domain) the Firefox `gecko.id`. *(C11, F4)*
   ⚠️ **RETIRED 2026-08-26**, the domain half — see **§A.3 item 1** and **§A.2 F4**:
   the domain is `nikatru.com` (chosen 2026-08-18) and `gecko.id` is
   `fullshot@nikatru.com`. The legal-name half is still open; §A.5 carries the exact
   `LICENSE` line, because four of the five lines a grep returns must not be touched.
2. **Declare EU DSA trader status** in the Chrome dashboard → Account. If
   Trader, your legal name, address, email and phone are **published to EEA
   users**, and Google verifies them — start this early; it is the longest pole
   and a hard gate on EEA distribution. *(C11 — this item was missing from
   previous revisions of this checklist.)*
3. **Host the privacy policy.** Fill the six placeholders in
   `PRIVACY-POLICY.html`, delete the instruction comment, put it on a public
   HTTPS URL, and paste that one URL into all three dashboards. Five hosting
   options compared, plus a done-check: `PRIVACY-POLICY-HOSTING.md`. *(C1)*
4. **Fill the Privacy practices tab.** Website content = YES, the other eight
   categories = NO, remote code = No, three Limited-Use boxes ticked. Every
   answer with its reasoning: `PRIVACY-POLICY-HOSTING.md` §4. *(C4, C5)*
5. **Paste the dashboard text fields** from `STORE-LISTING.md`: single-purpose
   description + one justification per permission (incl. the optional
   `<all_urls>`). Reviewer notes are drafted in `SUBMISSION-PACKET.md` §2e. *(B7)*
6. **On-device QA pass** before submit: batch capture, Beautify, Clip, and the
   `redact-e2e.html` fixture — the eyeball-pending items. Do this **before** the
   screenshots. *(D3-note)*
7. **Create store visual assets** (agent can't produce these): 1–5 screenshots
   at 1280×800 (or 640×400, opaque — a transparent PNG is the most common
   rejection), a 440×280 small promo tile, and a **300×300 logo for Edge**.
   Confirm `icons/icon128.png` is final art. Full spec table:
   `SUBMISSION-PACKET.md` §5.
8. **Provide a support email** (Chrome additionally requires it **verified** at
   account level) and an optional homepage URL.
9. ~~**Bring the redaction claim into line** in `STORE-LISTING.md`~~ — **done.**
   The listing, `PRIVACY-POLICY.html` §3d **and the Options page string** now
   carry `REDACTION-CLAIM-SPEC.md` §7's wording, including the new local-storage
   disclosure for the confirmed-block positions; the ⚠️ gate at the head of the
   listing is removed because the rewrite is what it asked for. What is left for
   the owner is a read-through of the three, not an edit. *(C12, D3)*
10. **Firefox — choose the add-on id**, then **rebuild**. Replace `gecko.id` in
    `publish/manifest.firefox.json` with an email-style id on the domain from
    item 1, run `node publish/package.node.js`, then
    `node publish/verify-firefox-package.node.js` until green. The id is
    permanent once AMO signs it. *(F4)*
    ⚠️ **RETIRED 2026-08-26** — see **§A.2 F4** and **§A.3 item 1**: the id already
    reads `fullshot@nikatru.com` and `node publish/verify-firefox-package.node.js`
    exits **0**. The build command has also moved to `scripts/pack.mjs`.
11. **Register the three developer accounts** — Chrome (Google, **US$5
    one-time**), Edge (Microsoft Partner Center, free), Firefox (free).
12. **Pick a category** — Productivity for Chrome/Edge; AMO's list has no exact
    equivalent, pick from what it offers.
13. *(Housekeeping)* Delete `shipprobe-DELETE-ME.txt` from the working folder.
    *(E4)*
    ⚠️ **RETIRED 2026-08-26** — see **§A.2**, row **E4**, and **§A.3 item 13**: already
    gone; `find . -name shipprobe*` over the repository returns nothing.
14. *(Optional, low priority — and no longer a one-liner)* Apply the 123-char
    `description` fix. It now lives in `_locales/en/messages.json` and 54 sibling
    catalogues, behind the locale generator's guard — see A10-fix. Fold into a
    version bump, not into submission week.

**Removed from this list since the last revision:** *"rebuild both zips at the
current version"* — done. Both `publish/fullshot-1.10.1*.zip` are built from
1.10.1 source and verified. *(E2)*

⚠️ **RETIRED 2026-08-26** — see **§A.1**: those zips no longer exist. The rebuild was
genuinely done, but its output was deleted 2026-08-20 along with the other ten;
packages are built on demand now.

## What is already compliant (no action needed)
Manifest V3 structure, no remote code, strict default CSP, minimum/least-privilege
permissions, optional broad host access requested at runtime, no analytics/ads/tracking,
no data transmission, single-purpose alignment, a clean self-contained package
layout at the current version, 55 packaged locales behind a `default_locale`
declaration, and — for Firefox — the mandatory `data_collection_permissions`
declaration plus an automatically guarded background script. The hard parts
pass. What remains is owner identity (name, address, domain), dashboard data
entry, hosting, visual assets, an on-device QA pass, one listing-copy correction,
and the Firefox add-on id.

---

# APPENDIX A — DATED CORRECTION, 2026-08-22

**Nothing above this line has been rewritten.** This file is a dated audit and its findings were
true of the tree they graded. What follows records which of its rows are **false today**, what each
one said, and what was **measured instead on 2026-08-22** by running the gate rather than reading a
note. Rows that are **still true are not listed** — parking finished work is expensive, but marking
real owner work "done" is worse, so the untouched rows are untouched on purpose.

Where this appendix and the body disagree, this appendix wins. Everywhere else the body stands.

## A.1 The version basis has moved: 1.10.1 → 1.10.2, and there are no packages in this folder

The header says the audit was *"re-checked at **1.10.1** — root `manifest.json` and
`publish/manifest.firefox.json` both read 1.10.1, and both packages in this folder are built from
that source."* Measured:

- `manifest.json` line 5 declares **`"version": "1.10.2"`**.
- `publish/manifest.firefox.json` **no longer reads a version at all.** It was converted on
  2026-08-18 into an **RFC 7386 merge patch** — 511 bytes, five keys (`background`,
  `browser_specific_settings`, `options_ui`, `minimum_chrome_version`, `options_page`) — so it does
  not restate `version`, `description` or the permissions and therefore *cannot* drift from the
  root. `node scripts/check-version.mjs fullshot` → **EXIT 0**, and its third limb says exactly
  that: `publish/manifest.firefox.json is an overlay — it does not restate the version, so it cannot
  drift from it`.
- **There are no packages in this folder.** All twelve were deleted 2026-08-20; the surviving record
  is `publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`. `git ls-files | grep '\.zip$'` returns one
  **tracked** file, `templates/tool/publish/skeleton-0.0.1.zip` (measured 2026-08-22).
  ⚠️ This line first said "a repo-wide `find . -name '*.zip'` returns one file". `find` also sees
  build output — `.gitignore` covers `dist/` but not the `dist2/` the determinism check writes — so on
  a machine that has just built, the same `find` returns the tracked one plus a zip per built target
  in `dist/` and again in `dist2/`, a number this file cannot pin. The tracked count does not depend
  on who ran what, and it was **1** on 2026-08-22 by both commands, with no build output present.
  `node scripts/check-store-packages.mjs fullshot` exits 0 but prints `ZERO PACKAGES WERE PRESENT, so
  this run proved nothing about any artifact` — read the print, not the code. **That print is
  conditional on an empty subject:** the script searches `publish/` and `dist/` (`DEFAULT_DIRS`), and
  on a tree that has just built it opens and grades what it finds. `ci.yml`'s `package` job depends on
  that, calling it `--dir dist` after the build. The durable claim is structural — *bare, on a clean
  checkout, this gate proves nothing about any artifact* — not the sentence a clean checkout prints.

## A.2 Rows that are FALSE today

| Row | What it says | Measured 2026-08-22 |
|---|---|---|
| **C11** — EU DSA trader / non-trader declaration, ⚠️ OWNER ACTION, *"a hard gate on EEA distribution … Google verifies the details, so it takes days"* | open owner work | **DONE, and done since 2026-08-12.** `nikatru/vendors/google.md` line 32: Chrome Web Store **publisher account LIVE 2026-08-12**, display name **NIKATRU**, publisher id `9e8074da-d51a-4406-a1b2-dd492338415a`, US$5 fee paid, **TRADER declared *and* VERIFIED** through the Google payments profile. ⚠️ The row's *other* half is unchanged and still open: Edge collects the equivalent through Partner Center verification, which is **still under review** — see A.4. ⚠️ And a nuance neither this file nor the packet could have known: `nikatru/vendors/mozilla.md` records AMO as **not asking** at signup and records that explicitly as **not found in AMO's policies, NOT as "not required"** — the Mozilla Add-on Distribution Agreement has not been read. That is an open question, not an open task. |
| **F4** — an add-on id the owner controls, ⚠️ OWNER ACTION, *"`gecko.id` is still `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` … `verify-firefox-package.node.js` refuses to pass until it is replaced"* | ⚠️ OWNER ACTION | **DONE.** The id is **`fullshot@nikatru.com`**, derived from `publish/identity.json` (`slug` + `ownerDomain`; domain chosen 2026-08-18). `node publish/verify-firefox-package.node.js` → **EXIT 0**, PASSING `gecko.id is NOT the placeholder`, the Mozilla email-format limb and the ≤80-character limb (20). `policy-check` and `pack.mjs` assert it independently. AMO's *permanence* — the id is fixed at first signing — is still a true fact; it just no longer describes an open item. |
| **F6** — *"Source `background.js` is **still unguarded**"* | ✅ with a standing rule | **The source is guarded.** `background.js` line 24: `if (typeof importScripts === 'function') {`. `verify-firefox-package.node.js` PASSES `source background.js guards importScripts` in its *build prerequisite* section, both bare and with `--zip`. The standing rule under the row — build with the packager, never by hand-zipping the source folder — is still correct and worth keeping. |
| **F7** — *"`publish/manifest.firefox.json` **1.10.1** = root `manifest.json` **1.10.1**"* | ✅ | Still ✅, by a **stronger mechanism**: the overlay does not carry a version to compare. `verify-firefox-package.node.js` PASSES `the overlay does not pin its own "version" — inherited` and `merged version === manifest.json version — merged 1.10.2 vs root 1.10.2`. |
| **A8 / E1** — 85 entries, *"Re-read from both 1.10.1 zips"* / *"Re-confirmed by reading the central directory of both 1.10.1 zips"* | ✅, 85 entries | **The count is still 85 and was re-verified — the provenance is not.** `node scripts/pack.mjs fullshot --target firefox --out <scratch> --release` → **EXIT 0**, `85 file(s) to pack — 55 locale catalogue(s) + 30 code/assets`, and `the archive reads back as 85 entries`. `verify-firefox-package.node.js --zip` on that build PASSES `package reads as a zip — 85 entries` and `no test/dev/scratch files in the package`. The 1.10.1 zips it cites are gone; the assertion now rests on a build from this tree. |
| **E2** — *"Both zips are 1.10.1 … md5 `c601e5ed…` · md5 `fb0c0199…` … Older zips (1.9.7, 1.9.11, 1.9.13, 1.10.0) are still in this folder as history; **do not upload one by mistake**"* | ✅ | **Every zip named in this row is deleted.** All twelve went on 2026-08-20 (`STALE-FIREFOX-ARTIFACTS-2026-08-20.md` preserves their sha256s). Those two md5s cannot be reproduced from this tree — it is 1.10.2. The *warning* the row ends on is now impossible to trip, because there is nothing in the folder to upload by mistake. |
| **E4** — *"`shipprobe-DELETE-ME.txt` (0 bytes) still in the working folder … Still worth deleting"* | ⚠️ | **Already gone.** `find . -name 'shipprobe*'` over the whole repository returns nothing. |

## A.3 The consolidated OWNER-ACTION list, re-graded item by item

| # | Body says | Today |
|---|---|---|
| 1 | Settle legal name **and a domain you control** | **Domain: DONE** — `nikatru.com`, chosen 2026-08-18, recorded in `publish/identity.json` and consumed by `gecko.id` and the privacy-policy URL. **Legal name: the VALUE is settled and public** — *Rajasekar Selvam, trading as NIKATRU* (`publish/PRIVACY-POLICY.html` line 132 and the served page), and it is the same name Chrome trader-verified. What is left is the owner **writing it onto the licence** — see A.5 for the exact line, because four of the five lines the grep returns must not be touched. |
| 2 | Declare EU DSA trader status — *"the longest pole"* | **DONE 2026-08-12** — declared **and verified**. See C11 above. |
| 3 | Host the privacy policy | **DONE.** `publish/identity.json` carries `https://nikatru.com/fullshot/privacy` (filled 2026-08-21). A GET on 2026-08-22 answered **200 with 0 redirect hops**. `publish/PRIVACY-POLICY.html` has **zero** remaining placeholders. Pasting the URL into dashboards is part of submission itself. |
| 4 | Fill the Privacy practices tab | **STILL OPEN, and correctly owner.** Every answer is drafted and internally consistent; what remains is a human ticking three Limited-Use certification boxes — a legal attestation, not a text field. |
| 5 | Paste the dashboard text fields | **STILL OPEN** — it is the submission act itself. The copy is ready: `check-store-metadata` → EXIT 0, `25 passed · 1 owner action(s)`, 15 listing files read, and it verifies `STORE-LISTING.md`'s name/summary/detailed-description match `store/chrome/*` byte for byte. |
| 6 | On-device QA pass | **STILL OPEN.** All eleven declared sims EXIT 0 (each run separately, Node v24.18.0, 2026-08-22) — and a sim is not a browser. Batch capture, Beautify, Scroll→Clip and `redact-e2e.html` have still never been exercised by hand. **This gates item 7, not the reverse.** |
| 7 | Create store visual assets | **STILL OPEN.** `store/_shared/screenshots/` holds **`README.md` and nothing else** — zero `.png`/`.jpg`. `check-store-metadata` prints this as an owner action rather than failing, because no store row is `served`. Still needed: 1–5 shots at 1280×800 (or 640×400, **opaque**), the 440×280 tile, the optional 1400×560 marquee, and the **300×300 Edge logo**, which cannot honestly be made by upscaling a 128px icon. Plus confirmation that `icons/icon128.png` is final art. |
| 8 | Provide a support email, **verified** at Chrome account level | **PARTLY.** `support@nikatru.com` is asserted in `publish/identity.json`, in `PRIVACY-POLICY.html` and on the served page; `store/_shared/support-url.txt` holds the issues URL. Whether the contact email is **verified in the Chrome dashboard** cannot be measured from inside this repo. Row stands until someone looks. |
| 9 | Redaction claim — already struck through as done | Unchanged. |
| 10 | Firefox — choose the add-on id, then rebuild | **DONE.** Id set (F4). The rebuild is moot: no stale zip survives, and CI builds fresh every time. Note the command has moved — `ci.yml` and `release.yml` build with **`scripts/pack.mjs`**, not `publish/package.node.js`. |
| 11 | Register the three developer accounts | **TWO OF THREE ARE LIVE, both 2026-08-12.** Chrome: live, fee paid, trader-verified. Firefox/AMO: created 2026-08-12 on `rajasekar@nikatru.com`, free. **Edge/Microsoft Partner Center is the one genuinely pending account** — A.4. |
| 12 | Pick a category | **Chrome and Edge: DONE** — `store/chrome/category.txt` and `store/edge/category.txt` both read `Productivity`. **AMO: still a choice** — `store/firefox/category.txt` holds **two** candidate lines, `Photos, Music & Videos` and `Privacy & Security`, and nothing in the tree picks between them. Small, but not decided. |
| 13 | Delete `shipprobe-DELETE-ME.txt` | **Already gone** (E4 above). |
| 14 | Apply the 123-char `description` fix | **DONE in 1.10.2.** `policy-check` PASSES `name/short_name/description within store limits — checked across all 55 locale(s)`. `CHANGELOG.md` records en `appDescription` 137 → **111**, longest catalogue now 132, longest locale **name** 44 — so the three over-length names (`ca`, `es`, `es_419`) came down with it. |

## A.4 The one genuinely pending store account

`nikatru/vendors/microsoft.md`: Microsoft Store developer enrolment **submitted 2026-08-05**
selecting **Company**; email and employment verification ✅; **business verification 🔴 STILL UNDER
REVIEW** at the last dated observation — screenshot, `storedeveloper.microsoft.com/en-US/onboarding`,
**2026-08-13 23:47 IST** — reading *"Your documents are under review (typically takes 5 business
days)"* with **`Finish account setup` greyed**. Support case **`2608120060000032`**. Five business
days elapsed **2026-08-20**, so the dashboard is worth re-reading rather than waiting on. **This
blocks Edge only** — Chrome and AMO are both live.

## A.5 Item 1's licence half — the exact line, so nobody edits the wrong one

`Extension/Full_Screen_Shot/LICENSE` has **five** lines matching `Required Notice`. **Four** must not
be touched. The grep the reader is invited to run —
`grep -n 'Required Notice' Extension/Full_Screen_Shot/LICENSE` — prints `35, 38, 168, 173, 180`
(counted 2026-08-22; read-only, the file is unchanged):

- **`:35` and `:38`** are **above** the rule at `:166`, inside PolyForm Shield 1.0.0's own §Notices
  **worked example**; `:38` is the `Copyright Yoyodyne, Inc. (http://example.com)` example. Lines
  `:172-173` of the same file say the text above the rule is *"the PolyForm Shield License 1.0.0,
  verbatim and unmodified; do not edit it."*
- **`:173`** is the tail of that same sentence — *"…do not edit it. The Required Notice line is the one
  thing this"* — so it **matches the grep while being the warning's own prose**. Non-editable, and not
  a candidate for the owner's name.
- **`:180`** is this repo's explanatory echo of that example.
- ✅ **`:168` is the one fillable slot:**
  `Required Notice: Copyright <OWNER LEGAL NAME OR COMPANY> (<OPTIONAL URL>)`
  flagged at `:170` with `>>> OWNER ACTION — replace the line above BEFORE the first commit. <<<`

`templates/tool/LICENSE:1` carries the same slot as `⟨LICENSOR⟩ (⟨LICENSOR_URL⟩)` and needs the same
line. `SUBMISSION-PACKET.md` §4b is what makes this reach a store: AMO has no PolyForm Shield entry
in its licence dropdown, so `LICENSE` is pasted in as a **Custom License**.

## A.6 Gate results this appendix rests on

Each exit code captured on its own line, not printed beside a command substitution.

| Command | Exit |
|---|---|
| `node scripts/policy-check.mjs fullshot` | **0** — `15 passed`, and it also prints warning(s). **The warning count is deliberately not written down here** — `policy-check.mjs` is being edited to retire a false-positive locale warning, so the same command can honestly print a different number depending on merge order. Read the run. `tool.json` `NOTES."gate status today"` says the same and names the standing one (no CSP `connect-src`). `EXIT 0` is the stable fact. |
| `node scripts/check-version.mjs fullshot` | **0** — `3 passed` |
| `node scripts/check-store-metadata.mjs fullshot` | **0** — `25 passed · 1 owner action(s)` — the owner action is the empty `store/_shared/screenshots/` — in **this** file that is §A.3 item 7, *"Create store visual assets"*. ⚠️ This cell used to say "A.4's O5", which is a pointer into a different document: `grep -n 'O5' COMPLIANCE-CHECKLIST.md` returns nothing but that phrase, this file has no O-numbering at all, and its §A.4 is *"The one genuinely pending store account"* (Microsoft Partner Center). The **O**-numbers live in `SUBMISSION-PACKET.md`, where "A.4's O5" is correct. Recorded here for the same reason the `check-catalog` row records its own: an exit code of 0 beside a bare pass-count hides work that is owed, and this table is what a reader trusts instead of re-running. |
| `node scripts/check-core-sync.mjs fullshot` | **0** — `1 passed` |
| `node scripts/check-catalog.mjs` | **0** — `7 passed`, 1 owner action (nothing listed in any store) |
| `node scripts/pack.mjs fullshot --target firefox --out <scratch> --release` | **0** — 85 entries |
| `node publish/verify-firefox-package.node.js` (bare) | **0** — `SOURCE PASSES — NO PACKAGE WAS GRADED` |
| `node publish/verify-firefox-package.node.js --zip <scratch>/fullshot-firefox.zip` | **0** — `ALL PASS` |
| all eleven declared sims, run one at a time on Node v24.18.0 | **0** each |
| `node scripts/check-store-packages.mjs fullshot` | 0, but **graded nothing** — no package present *on a clean checkout*, which is the state it was run in. `DEFAULT_DIRS` is `['publish','dist']`; after a local build it grades what it finds, and `ci.yml`'s `package` job calls it `--dir dist` on the zip it just built. The bare form proving nothing is a property of the subject, not of the script. |

The surviving `policy-check` warning is `no CSP connect-src to back the zero-network claim`. A second
warning — 8 locales missing 9 CLDR plural-form keys each, which fall back to `en` — is being closed
in `policy-check.mjs` as a false positive, so the same command can honestly print one or two
warnings depending on merge order. **EXIT 0 is the stable fact; neither warning is a failure and
neither blocks a submission.**
