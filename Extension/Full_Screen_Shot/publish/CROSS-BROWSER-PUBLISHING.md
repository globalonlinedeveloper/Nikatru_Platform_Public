# FullShot — Cross-Browser Publishing & Submission Runbook

Turnkey guide to shipping FullShot to the **Chrome Web Store**, **Microsoft
Edge Add-ons**, and **Firefox (AMO)**. All three are owner-gated (accounts,
uploads, on-device QA); this walks each one end to end and reuses the copy already
drafted in `STORE-LISTING.md` + `PRIVACY-POLICY.html`.

Files in this folder:
- `manifest.firefox.json` — the Firefox manifest, standalone. **This is a second, real manifest**: whenever `manifest.json` at the repo root is bumped, this file must be bumped with it in the same commit. It currently reads **1.10.1**, in step with the root.
- `package.node.js` — the builder (`node publish/package.node.js`). Writes **both** zips from an allowlist, applies the Firefox `importScripts` guard while writing, and refuses to write an unguarded Firefox package. Use it; never hand-zip the source folder.
- `verify-firefox-package.node.js` — the Firefox packaging gate (`node publish/verify-firefox-package.node.js`). Run it before every AMO upload; it exits non-zero and names the blocker. See §Firefox → *The packaging gate*.
- `SUBMISSION-PACKET.md` — every field all three stores ask for, drafted or marked OWNER. `PRIVACY-POLICY-HOSTING.md` — hosting the policy and the exact Chrome data-declaration answers.
- `fullshot-1.10.1.zip` — Chrome **and** Edge (same Chromium MV3 package). **Current.** md5 `c601e5ed7396cf6a078cc64c273e5a8e`.
- `fullshot-1.10.1-firefox.zip` — the Firefox candidate. **Current** and a correct build: the gate reads the zip, confirms its packaged `background.js` carries the `importScripts` guard, and confirms its packaged manifest equals `manifest.firefox.json`. md5 `fb0c019994d9ca0d59f801583fc29146`.
- `fullshot-1.9.7*.zip`, `1.9.11*`, `1.9.13*`, `1.10.0*` — superseded history. Keep or delete, but **do not upload one by mistake**; check the version in the filename against `manifest.json` every time.

> **Version state:** both current zips are **1.10.1**, matching root
> `manifest.json` and `publish/manifest.firefox.json`. The version-staleness
> blocker that stood in earlier revisions of this document is **resolved**.
> Both packages contain **85 entries** — 30 shipping files plus 55
> `_locales/<lang>/messages.json`, which arrived with the i18n phase.
> One rebuild is still coming: setting the real `gecko.id` (below) changes
> `manifest.firefox.json`, so the Firefox package must be rebuilt afterwards.

> **Verification boundary (read this):** the Firefox package is structurally
> validated in a sandbox (`verify-firefox-package.node.js`: manifest schema,
> `background.scripts` fallback, `data_collection_permissions`, reference
> integrity, Chrome/Firefox drift, and the packaged zip itself) but has **not**
> been loaded in a real Firefox. Like FullShot's other browser-only work, it is
> **eyeball-pending**: run it through `web-ext` on Firefox (steps below) before
> submitting. Chrome/Edge share the already-audited Chrome package.

---

## At a glance

| | Chrome Web Store | Edge Add-ons | Firefox (AMO) |
|---|---|---|---|
| Package | `fullshot-<ver>.zip` | `fullshot-<ver>.zip` (same) | `fullshot-<ver>-firefox.zip` |
| Registration fee | **US$5 one-time** | **Free** | **Free** |
| Account | Google account | Microsoft account (Partner Center) | Firefox account |
| Manifest changes vs Chrome | none | none | gecko id + `data_collection_permissions` + `background.scripts` + `options_ui` − `minimum_chrome_version` (done in the FF manifest) |
| Code change vs Chrome | none | none | guard `importScripts` (1 edit — see §Firefox) |
| Privacy policy required | yes | yes (if handling data) | yes |
| Data disclosure | dashboard: "Website content" | dashboard | **in the manifest**: `data_collection_permissions.required: ["none"]` |
| Review time (typical) | hours–days | hours–days | minutes–days (automated + possible manual) |

---

## Microsoft Edge — the easy one (same package)

Edge is Chromium, so it runs the **exact Chrome MV3 package unchanged**. Nothing to rebuild.

1. Register once at **Microsoft Partner Center** with a Microsoft account — free, no fee. (https://learn.microsoft.com/microsoft-edge/extensions/publish/create-dev-account)
2. Create a new extension submission and upload the current **`fullshot-<ver>.zip`**.
3. Fill the listing from `STORE-LISTING.md` (name, summary, detailed description, category → Productivity, screenshots).
4. Complete the **Privacy** section: point to the same hosted `PRIVACY-POLICY.html` URL; declare the same data practices (website content handled locally, no data sold/transmitted).
5. Submit. Edge certification runs its own review.

That's it — Edge needs no manifest or code changes.

---

## Firefox (AMO) — one small code change, then build

Firefox implements MV3 background differently and enforces a few manifest rules.
The FF package here already handles the manifest side; the **one code change** is
in `background.js`.

### Why the change is needed
`background.js` starts with `importScripts('pages/db.js')` / `importScripts('pages/batch.js')`.
`importScripts` exists only in a **service worker** (Chrome's MV3 background).
Firefox runs the background as an **event-page script**, where `importScripts` is
`undefined` — so unguarded, `background.js` throws on load and the extension is dead.

### The fix (apply to your real `background.js`, then rebuild)
Replace lines 6–7:
```js
importScripts('pages/db.js');
importScripts('pages/batch.js');   // v1.9.7: FSBatch pure core (queue/parse) in the worker
```
with:
```js
// Cross-browser: Chrome runs this file as a SERVICE WORKER (importScripts is
// available). Firefox runs it as a background EVENT-PAGE script where
// importScripts is undefined and pages/db.js + pages/batch.js are instead
// loaded via the manifest background.scripts array. Guard so neither throws.
if (typeof importScripts === 'function') {
  importScripts('pages/db.js');
  importScripts('pages/batch.js');   // v1.9.7: FSBatch pure core (queue/parse) in the worker
}
```
This is a **no-op for Chrome/Edge** (their service worker always has `importScripts`,
so `FSDB`/`FSBatch` load exactly as before) and makes Firefox load those two files
via the manifest's `background.scripts` array instead. One codebase, both browsers.

*(Update: this is **no longer a manual edit**. Source `background.js` is still
unguarded — the gate reports that, correctly, as a build prerequisite — but
`publish/package.node.js` now applies the guard while writing the Firefox zip
and **refuses to write an unguarded Firefox package at all**. The gate confirms
the guard is present inside `fullshot-1.10.1-firefox.zip`. The rule that
remains: **build with the packager, never by hand-zipping the source folder**,
because a hand-made zip would ship the unguarded file and the add-on would throw
on load.)*

### Manifest differences (already applied in `manifest.firefox.json`)
| Key | Chrome | Firefox |
|---|---|---|
| `background` | `{ "service_worker": "background.js" }` | `{ "service_worker": "background.js", "scripts": ["pages/db.js","pages/batch.js","background.js"] }` |
| `browser_specific_settings.gecko.id` | — | **required** for MV3 signing → `⟨fullshot@your-domain⟩` |
| `browser_specific_settings.gecko.strict_min_version` | — | `"128.0"` (optional_host_permissions landed in FF 128) |
| `browser_specific_settings.gecko.data_collection_permissions` | — | **required** since 2025-11-03 → `{ "required": ["none"] }` |
| `minimum_chrome_version` | `"116"` | **removed** — a Chrome Web Store key with no meaning in Firefox; Gecko's equivalent is `strict_min_version` |
| options page | `"options_page": "pages/options.html"` | `"options_ui": { "page": "pages/options.html", "open_in_tab": true }` |

Everything else is identical, and `verify-firefox-package.node.js` enforces
exactly that: any *other* top-level key that drifts between the two manifests
fails the gate.

**Keeping both `service_worker` and `scripts` is deliberate, not sloppiness.**
Firefox does not implement `background.service_worker` and runs `scripts`
instead; MDN's own cross-browser recipe is to declare both, and the AMO linter
raises `BACKGROUND_SERVICE_WORKER_NOFALLBACK` — an **error** — for a
`service_worker` with no `scripts` beside it. You will see one *warning*,
`BACKGROUND_SERVICE_WORKER_IGNORED`; that is expected and harmless.
(https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background · https://mozilla.github.io/addons-linter/)

**⚠️ OWNER ACTION — the add-on id.** `gecko.id` is still the placeholder
`fullshot@REPLACE-WITH-YOUR-DOMAIN.example`. Only the owner can choose it: it
must be an email-style string on a **domain you actually control**
(`^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$`, ≤80 chars — a GUID in braces is also
accepted). AMO checks the id for uniqueness the first time it signs the add-on
and the listing is that id from then on — change it later and you have published
a *different* add-on, not an update, so a placeholder shipped once cannot be
walked back. The packaging gate refuses to pass while the placeholder is present.
(https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings)

### Data collection consent — `data_collection_permissions` (mandatory)
Since **2025-11-03**, every *new* add-on submitted to AMO must declare what it
collects in the manifest; submissions without the key are rejected at upload.
Firefox shows the declaration in the install prompt, on the AMO listing, and in
`about:addons` → Permissions and Data.

FullShot's declaration is the "collects nothing" form:
```json
"browser_specific_settings": {
  "gecko": {
    "data_collection_permissions": { "required": ["none"] }
  }
}
```
`"none"` is exclusive — it cannot be listed alongside any data type. Mozilla
defines the thing being declared as data "collected, used, transferred, shared,
or handled **outside the add-on or the local browser**". FullShot makes zero
network calls and every byte it touches stays in the add-on's own storage on the
machine, so `none` is the accurate answer, not a convenient one.

Note this is **not** the same question Google asks — see COMPLIANCE-CHECKLIST.md
§C-FF for why Chrome gets "Website content" and Firefox gets "none" from the same
codebase.

Support landed in **Firefox 140**, while `strict_min_version` here is `128.0`;
older Firefox simply ignores the unknown key, and AMO enforces it regardless of
the minimum version. `web-ext lint` may note that the key is unavailable below
140 — that is expected, and dropping the key to silence it would make the add-on
unsubmittable.
Sources: https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/ ·
https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions/ ·
https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/140

### The packaging gate (run this before every AMO upload)
```bash
node publish/verify-firefox-package.node.js
# or point it at a specific build:
node publish/verify-firefox-package.node.js --zip publish/fullshot-1.10.1-firefox.zip
```
It grades `manifest.firefox.json` against Mozilla's current MV3 rules (gecko id
format, the `data_collection_permissions` vocabulary and the `none` exclusivity
rule, the `background.scripts` fallback, no Chrome-only keys), against the root
`manifest.json` (version parity + key-by-key drift), and — when the matching zip
exists — against the package itself (its manifest must equal this file, its
`background.js` must carry the guard, no test/dev files inside). Any blocker
exits non-zero and prints a named action.

**It is red today, on purpose.** As of 1.10.1 it reports two failures, but only
**one is a submission blocker**:
1. **OWNER (blocker)** — the placeholder `gecko.id` (above). Only the owner can
   resolve it, and the gate says so by name.
2. **BUILD (not a blocker any more)** — source `background.js` still calls
   `importScripts` unguarded. The gate is right to flag the source, but
   `package.node.js` now guards the file as it writes the Firefox zip, so the
   *package* is correct; the gate's own package section confirms
   `packaged background.js guards importScripts` **PASS**. The failure to watch
   is the source line, and the rule it implies is "always build with the
   packager".

Because it is red by design it is **not** part of the eleven test tiers and must
not be added to the all-green set.

### API portability (audited — all good except the guard)
FullShot uses the `chrome.*` namespace, which Firefox aliases. The one behavioral
rule to know: **`chrome.permissions.request` must be called from a user gesture** in
Firefox. FullShot's three call sites already are — the Options toggle change
(`pages/options.js`), the popup capture click (`popup/popup.js`), and Batch "start"
(`pages/batch.js`) — so the optional `<all_urls>` grant prompts correctly. No change needed.
`captureVisibleTab`, `scripting`, `downloads`, `storage.sync`, `runtime.getURL`,
`commands`, and IndexedDB are all supported in Firefox MV3. So are all five
declared permissions, `unlimitedStorage` included (in Firefox it additionally
grants a persistent IndexedDB database without prompting).
`chrome.storage.session` — where the worker parks its last-failure note — is
supported from **Firefox 115**, comfortably under `strict_min_version: 128.0`.
The popup already wraps its `storage.session` reads in `try`/`catch`, so a
browser without it degrades to showing nothing rather than throwing.
(https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session ·
https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions)

### Build + test with web-ext (do this before submitting)
```bash
node publish/verify-firefox-package.node.js   # in-repo gate first — it is free and instant
npm i -g web-ext
# from a folder containing the Firefox manifest + guarded background.js:
web-ext lint            # static AMO checks
web-ext run             # launches Firefox with the extension loaded — QA it live
web-ext build           # produces the submittable .zip
```
QA the eyeball-pending flows in `web-ext run`: full-page capture, the optional
`<all_urls>` prompt, batch, Beautify, Clip, and redaction.

Expected `web-ext lint` noise that is **not** a problem: the
`BACKGROUND_SERVICE_WORKER_IGNORED` warning (see above), and any note that
`data_collection_permissions` is newer than `strict_min_version: 128.0`.

### Submit to AMO
1. Create a free Firefox account; go to https://addons.mozilla.org/developers/ .
2. Submit a new add-on; upload the Firefox `.zip`.
3. Choose distribution (listed on AMO vs self-hosted signed).
4. Complete the data/privacy disclosures and paste the hosted `PRIVACY-POLICY.html` URL. The manifest already carries the machine-readable half (`data_collection_permissions.required: ["none"]`); keep the dashboard answers consistent with it.
5. Note: AMO may request reviewable source if code is minified/obfuscated — FullShot ships **unminified**, so this is straightforward.

---

## Consolidated submission checklist (all three stores)

Before any store — the full field list is `SUBMISSION-PACKET.md`:
- [x] ~~Rebuild both zips at the current version~~ — **done**, both are 1.10.1.
- [ ] Settle the legal name and a domain you control — they feed five places at once (`SUBMISSION-PACKET.md` §0).
- [ ] Declare **EU DSA trader status** in the Chrome dashboard; it is verified by Google and gates EEA distribution.
- [ ] Host `PRIVACY-POLICY.html` publicly; fill in every `⟨…⟩`; note the URL (`PRIVACY-POLICY-HOSTING.md`).
- [ ] Prepare visual assets: 1280×800 (or 640×400, opaque) screenshots ×1–5; Chrome/Edge small promo tile 440×280; **Edge logo 300×300**. Confirm `icons/icon128.png` is final.
- [ ] Bring the redaction bullet in `STORE-LISTING.md` into line with the "What it cannot do" paragraph now in `PRIVACY-POLICY.html` §3d.
- [ ] (Optional) apply the 123-char `description` fix from COMPLIANCE-CHECKLIST.md §A10. **Note: it is no longer a manifest edit** — the string now lives in `_locales/en/messages.json` and 54 sibling catalogues, behind the locale generator's guard.

Chrome Web Store:
- [ ] $5 developer account · upload the current `fullshot-<ver>.zip` · paste `STORE-LISTING.md` fields · Privacy-practices tab (disclose "Website content" local-only + certify 3 Limited-Use boxes) · privacy-policy URL · submit.

Microsoft Edge:
- [ ] Free Partner Center account · upload the same `fullshot-<ver>.zip` · same listing + privacy · submit.

Firefox AMO:
- [ ] Set a real `gecko.id` (owner-only) · apply the `importScripts` guard to the packaged `background.js` · `node publish/verify-firefox-package.node.js` **green** · `web-ext lint` + `run` (QA) + `build` · free AMO account · upload · privacy disclosures + policy URL · submit.

## Notes
- Keep **one version number** across stores so updates stay in lockstep — and remember that means **two files**: root `manifest.json` and `publish/manifest.firefox.json`. The packaging gate fails on drift between them.
- The Chrome/Edge package and the Firefox package are byte-different only where they must be (manifest + the guarded `background.js`); the capture engine, pages, and assets are identical.
- Safari is a larger port (Xcode `safari-web-extension-converter`, Apple Developer Program US$99/yr) — out of scope here; the same guarded, cross-browser codebase is the right starting point when you get to it.

---

# APPENDIX A — DATED CORRECTION, 2026-08-25

**Everything above this line is left exactly as written.** It was true of the tree it described.
This appendix does not rewrite it; it records, item by item, which of its claims are **false
today**, what the claim said, and **what was measured instead** — by running the thing, on
2026-08-25, with the exit code captured on its own line. Where a claim is **still true it is not
listed here**, because marking real owner work "done" is the more expensive mistake of the two.

Read order: this appendix wins over the body on any point it names. On every point it does not
name, the body stands.

This is the last document in `publish/` to get one: before today `grep -c '2026-08-22'` returned
**8** for `COMPLIANCE-CHECKLIST.md`, **6** for `SUBMISSION-PACKET.md`, **3** for
`STORE-LISTING.md`, **2** for `PRIVACY-POLICY-HOSTING.md` and **0** here.

## A.1 What was re-run, and what it exited

Every command below was run from `Extension/Full_Screen_Shot/` unless the path says otherwise,
bare, on Node **v24.18.0**, with the exit code read on its own line.

| Command | Exit | What it printed |
|---|---|---|
| `node publish/verify-firefox-package.node.js` (bare, exactly as `ci.yml:486` invokes it) | **0** | `SOURCE PASSES — NO PACKAGE WAS GRADED.` — `grep -c "^PASS  "` over its output → **56**, including `source background.js guards importScripts` and `the source this package would be built from guards importScripts` |
| `node publish/verify-firefox-package.node.js --zip <scratch>/fullshot-1.10.2-firefox.zip` | **0** | `ALL PASS` — including `packaged background.js guards importScripts` and `no test/dev/scratch files in the package` |
| `node scripts/pack.mjs fullshot --target firefox --out <scratch> --release` (from the repo root) | **0** | `6 passed`; `85 file(s) to pack — manifest included, 55 locale catalogue(s)`; `firefox manifest — publish/manifest.firefox.json applied as a merge patch — gecko.id fullshot@nikatru.com` |
| `node scripts/verify-refs.mjs --zip <scratch>/fullshot-firefox.zip --strict --leaks` | **0** | `4 passed · 1 warning(s)` |
| `node scripts/policy-check.mjs fullshot` | **0** | `15 passed · 1 warning(s)` — including `the Firefox add-on id is set — fullshot@nikatru.com -- and agrees with publish/identity.json` |
| `node scripts/check-version.mjs fullshot` | **0** | `3 passed` — `CHANGELOG top entry is [1.10.2]`, and `publish/manifest.firefox.json is an overlay — it does not restate the version, so it cannot drift from it` |
| `node scripts/run-tests.mjs fullshot` | **0** | `12 passed` |
| `node publish/package.node.js` (the full build, run in a **scratch `git worktree` copy** so no zip lands in `publish/`) | **0** | `ALL PASS — packaging + reference integrity`; `85 files` byte-identical to the tree, for both targets |
| `node publish/package.node.js --verify` | **1** | ⚠️ **read the print, not the code.** `2 FAIL — packaging + reference integrity`, and both FAILs are the same one: `FAIL package exists — …publish/fullshot-1.10.2.zip` / `…-firefox.zip`. `--verify` grades zips it does not build, and **no zip exists in `publish/` on a fresh checkout** (A.2, row 2). This is what a tree with no build output makes it say; it is not a statement about any artifact. Build first — or run the bare form above, which builds — and it exits 0. |

## A.2 Claims in this document that are FALSE today

| Where | What it says | What was measured 2026-08-25 |
|---|---|---|
| Line 9, `manifest.firefox.json` bullet | "**This is a second, real manifest** … whenever `manifest.json` … is bumped, this file must be bumped with it in the same commit. **It currently reads 1.10.1**, in step with the root." | **Three things false in one bullet.** (1) It is **not a second manifest**: since commit `1c2c082` (2026-08-15) it is an **RFC 7386 merge patch**, `wc -c` → **511** bytes, five keys, applied over `manifest.json` at pack time. (2) It **states no version at all** — `grep -c '"version"' publish/manifest.firefox.json` → **0** — so there is nothing to bump and the two **cannot** drift; `check-version.mjs` asserts exactly that by name. (3) The root is **1.10.2**, not 1.10.1 (`node -e "console.log(require('./manifest.json').version)"`). |
| Lines 13–15 and the **Version state** block, lines 17–23; also the checklist line 245 (`~~Rebuild both zips~~ — done, both are 1.10.1`) | `fullshot-1.10.1.zip` "**Current.** md5 `c601e5ed…`" and `fullshot-1.10.1-firefox.zip` "**Current** and a correct build … md5 `fb0c0199…`", plus the superseded `1.9.7*`/`1.9.11*`/`1.9.13*`/`1.10.0*` list | **The subject is gone. Every zip named on lines 13–15 was deleted on 2026-08-20** — all twelve of them. Measured: `git ls-files 'Extension/Full_Screen_Shot/publish/*.zip'` → **0** lines; `ls Extension/Full_Screen_Shot/publish/*.zip` → `No such file or directory`; and `git log --all --diff-filter=A -- 'Extension/Full_Screen_Shot/publish/*.zip'` → **0** commits, i.e. they were untracked build output and no commit deleted them. 🔴 **The two md5 hashes are NOT re-derived here and must not be.** They describe files that no longer exist; rebuilding something to make a hash match would be inventing the subject. The surviving record — deliberately the only survivor, and it explains *why* the six Firefox packages went first — is **`publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`**. Packages are built on demand now (A.1). |
| Lines 22–23, Version state | "**One rebuild is still coming**: setting the real `gecko.id` (below) changes `manifest.firefox.json`, so the Firefox package must be rebuilt afterwards." | **Already done, on 2026-08-18** — commit `088b4e3`, *"fix(firefox): give the add-on a real id, and make the two copies of it unable to drift"*. There is no pending rebuild, and there is no package left to be stale. |
| Line 110 (`gecko.id` → `⟨fullshot@your-domain⟩`), lines 128–135 (**⚠️ OWNER ACTION — the add-on id**), and the AMO checklist line 260 ("Set a real `gecko.id` (owner-only)") | "`gecko.id` is **still the placeholder** `fullshot@REPLACE-WITH-YOUR-DOMAIN.example` … The packaging gate refuses to pass while the placeholder is present." | **False. The id is `fullshot@nikatru.com`** — read it out of `publish/manifest.firefox.json` (`browser_specific_settings.gecko.id`), and it is asserted independently by `pack.mjs` (`gecko.id fullshot@nikatru.com`) and by `policy-check.mjs` (`the Firefox add-on id is set … and agrees with publish/identity.json`). ✅ **The paragraph's *reasoning* is still exactly right and must not be deleted:** AMO fixes the add-on identity at first signing, so a placeholder shipped once cannot be walked back. That is now the reason the filled id matters, not an open task. |
| Lines 185–198, *The packaging gate* | "**It is red today, on purpose.** As of 1.10.1 it reports **two failures** … Because it is red by design it is **not** part of the eleven test tiers and must not be added to the all-green set." | **EXIT 0, both ways** (A.1): bare it exits 0 with `SOURCE PASSES — NO PACKAGE WAS GRADED.`, and `--zip` against a freshly built package exits 0 with `ALL PASS`. **Both named failures are gone** — the placeholder id was filled 2026-08-18, and the source guard landed 2026-08-20. The standing rule underneath — *a red gate naming a real defect is the system working* — is untouched by this; what changed is that this gate is no longer naming one. |
| Lines 97–104 (the *Update* parenthesis) and line 189, BUILD note | "Source `background.js` is **still unguarded** — the gate reports that, correctly, as a build prerequisite — but `publish/package.node.js` now applies the guard **while writing** the Firefox zip" | **False on both halves.** `sed -n '24p' background.js` → `if (typeof importScripts === 'function') {`, with the two `importScripts` calls indented beneath it: the guard is **in the source**, committed 2026-08-20, and nothing rewrites the file on the way into a zip — `pack.mjs` copies it verbatim, which is why `package.node.js` can assert `every packaged file is byte-identical to the tree — 85 files`. ✅ The rule the parenthesis ends on — **build with the packager, never by hand-zipping** — is still correct and still worth keeping. |

## A.3 One correction to line 10 — `publish/package.node.js` is no longer what CI builds with

Line 10 presents `package.node.js` as **the** builder ("Writes **both** zips from an allowlist …
Use it; never hand-zip the source folder"). The *rule* is right; the *subject* has moved.

CI and release both build with **`scripts/pack.mjs`**, measured today:

- `.github/workflows/ci.yml:572` — `node scripts/pack.mjs ${{ matrix.tool }} --target ${{ matrix.target }} --out dist`
- `.github/workflows/ci.yml:590` — the determinism re-run, into `dist2`
- `.github/workflows/release.yml:161-162` — `--target chromium` and `--target firefox`, both `--release`

⚠️ **Line numbers were measured 2026-08-25 and `ci.yml` is edited often; the greps are the durable
form.** `grep -n 'node scripts/pack.mjs' .github/workflows/` finds the three build lines, and
`grep -n 'publish/package.node.js' .github/workflows/*.yml` returns **2** hits, **both comment lines**
(`ci.yml:94` and `ci.yml:607`) — no workflow line invokes it.

`ci.yml` runs `publish/verify-firefox-package.node.js` (line **486**, bare; line **658** with
`--zip`), but it never invokes `publish/package.node.js`. That file is still present, still
authoritative for its own ALLOW list, and still the tool-local packer this document describes —
it is just not the thing a release comes out of. ⚠️ It also writes into `publish/` and **only**
`publish/` (`OUT = __dirname`, no `--out` flag), and `publish/*.zip` is deliberately *un*-ignored
(`Extension/Full_Screen_Shot/.gitignore:134`, `!publish/*.zip`) — so running it bare in a real
checkout leaves two untracked zips behind. Build into a scratch worktree, or use `pack.mjs --out`.

## A.4 What of this document is STILL OPEN — deliberately left standing above

Not corrected, because measurement says they are real, or because nothing here can measure them:

- **The verification boundary, lines 25–31.** The Firefox package is still **eyeball-pending**: it
  has been graded in a sandbox, not loaded in a real Firefox. `web-ext lint` / `run` / `build`
  before submitting, exactly as the body says.
- **The legal name, the hosted-policy paste, the visual assets, the store accounts** (lines
  246–260) — owner work, tracked in `SUBMISSION-PACKET.md` §APPENDIX A, not re-adjudicated here.
- **Everything in §Manifest differences, §Data collection consent and §API portability.** Those
  describe Mozilla's rules and FullShot's call sites, not the state of the tree, and nothing
  measured today contradicts them. The one row inside them that moved is the `gecko.id` value
  (A.2).
