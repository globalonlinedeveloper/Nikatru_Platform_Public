# `templates/tool` — the starting point for every tool in this family

> This is the template's original README — the long tour. It moved here from `_skeleton/README.md` when
> the template moved to `templates/tool/`; `README.md` beside it is the shorter stamping guide. Where this
> document says "the skeleton" it means this template, which still calls itself that in `skeleton.json`,
> `CHANGELOG-skeleton.md` and the `slug: "skeleton"` identity signal.

This folder is a **real, loadable, working MV3 extension**, not a pile of stubs.
Load it unpacked right now (`chrome://extensions` → Developer mode → Load
unpacked → this folder) and the popup opens, reports the active tab's title
through the message router as a real job, and copies it; the options page saves
settings and empties storage.

Every tool in this family is **copied** from this folder — never linked. A
no-build-step vanilla-JS extension cannot share modules at runtime, and each
tool must be free to diverge.

```sh
cp -r templates/tool  Extension/My_Tool     # or: robocopy templates\tool Extension\My_Tool /E
```

The documents, in the order you need them:

| file | what it is for |
| --- | --- |
| **`TEMPLATE.md`** | **the procedure.** Ordered, section by section, every edit point named. This is the one you actually work through — start at §0 |
| **`README.md`** (this file) | what you get and why, and how to run the tests. Background, not instructions |
| **`test/browser/README.md`** | the real-browser tier in detail — what it proves, what it does not, and where the one fleet Playwright install lives |
| **`publish/SUBMISSION.md`** | the last mile: only the things a human must do, in order. Its companions are `STORE-LISTING.md` and `COMPLIANCE-CHECKLIST.md` |
| **`HANDOFF.md`** | the session log template. Decisions are the only part of this that does not retrofit at any price |
| **`CHANGELOG-skeleton.md`** | what changed in `_skeleton` itself, so a tool copied at v1.1.0 can be told what it is missing. **Delete it at §14, not when you copy** — the node tier reads it as "this is still the skeleton" until §1 sets the identity |

Provenance is stamped, not guessed: `skeleton.json` records which skeleton
version a tool came from, and `node tools/audit-fleet.mjs` walks the fleet and
reports which tools are BEHIND and which have DIVERGED from their inherited
files. Without it, "which of the 67 has the fixed packager?" is unanswerable.

---

## The house style this encodes

You do not re-derive any of this. It is already true of every file here, and
your job is to keep it true.

- Manifest V3, vanilla JS. **No build step, no framework, no dependency, no
  `node_modules` shipped.** Every `.mjs` in the tree is a BUILD-TIME script —
  the icon generator, the locale generator, the packager, the version bump — and
  none of them can be packaged: the allowlist collects `.js`, never `.mjs`.
- **Zero network calls in shipped code**, and the *platform* enforces it. No
  `fetch`, XHR, WebSocket, `sendBeacon`, remote font, CDN, or `eval` — and
  `manifest.json` declares `connect-src 'none'`, so the browser refuses them
  from every extension page and from the service worker. The browser tier proves
  the refusal on every run rather than asserting the absence.
- Minimum permissions: `activeTab` first; `optional_host_permissions` requested
  at run time only if unavoidable — **and revocable inside the product**, from
  the options page. Ships with `activeTab` + `storage` and no host permissions.
- No accounts, no ads, no tracking. Single purpose, stated in one sentence.
- Anything stored is **listed, exportable, deletable one row at a time and
  deletable all at once** — settings included; anything abandoned is cleaned up.
  "Delete everything" **enumerates** the database rather than naming stores, so
  a store you add later is emptied whether or not you remembered.
- **A private window is never written to disk.** Spanning mode means one store
  for both kinds of window, so one predicate guards every write site.
- **Only this extension may talk to the router**, and the tab a case acts on is
  derived from `sender.tab` rather than claimed by the message.
- **The tool's functional output is never translated** — exported Markdown, CSV
  headers, JSON keys, filenames and captured page text are the user's data in
  the page's own language, and translating them corrupts it.
- **A secrets file is never committed.** Nothing here needs a credential, and
  three layers say so: `.gitignore`, the packaging never-list, and the rule that
  an ignored file is still one `git add -f` from being public.
- **No state that outlives one message may live only in memory.** An MV3 service
  worker is killed mid-job several times an hour; the job table is written
  through to `chrome.storage.session` on every mutation.
- **Never lose data silently.** A failed write says so in a sentence the user can
  act on, and a browser that may evict the store says so too.
- **Untrusted text never reaches the DOM as markup.** `createElement` +
  `textContent`, never `innerHTML` with an interpolated value.
- **Never sanitise untrusted text with a regex.** Use an allowlist of fixed
  strings plus one generic fallback.

The last two are not style preferences. They are the two bugs this family has
actually shipped and paid for, and the shell is arranged so that obeying them is
easier than not.

---

## What a tool gets for free

All of it live, exercised code — not commented intentions.

**Shell — 18 files ship, plus the 55 locale catalogues (~240 KB packaged)**

- `manifest.json` — MV3, `activeTab` + `storage` only, no host permissions, and
  a real `content_security_policy.extension_pages` with `connect-src 'none'`,
  `style-src 'self'` and `img-src` limited to `self data: blob:` — the second
  gate behind "untrusted text never becomes markup", and the one still standing
  after somebody writes markup anyway. `"incognito": "spanning"` is declared out
  loud so it is a decision rather than a default nobody read.
- `background.js` — message router with ONE try/catch and ONE response gate; the
  **allowlist error path** (`REASONS` table + `humanReason`/`wireReason`) so no
  engine string can carry a token to the UI; the **blocked-page table** with a
  row per family, including the four the reference's three divergent copies all
  missed (`file:` and the checkbox that fixes it, `chrome-error:`, the built-in
  **PDF viewer**, and a **sandboxed** document — the last two serve ordinary
  `https:` urls and look completely normal); a last-failure note in
  `chrome.storage.session` that stores **origin only**; the **wake sequence**
  (rehydrate, badge reset, watchdog, orphan sweep, retention) that runs on every
  worker start rather than only on browser start; and a single `abortJob`
  cleanup hook wired to every way work can be abandoned — tab closed, tab
  navigated, window closed, user cancelled, router threw, worker suspended,
  watchdog timed out.
- `lib/jobs.js` — **the job table, and the reason it is not a `Map`.** An MV3
  worker is killed mid-job several times an hour, so `SKJOBS` mirrors every
  mutation to `chrome.storage.session` and rehydrates on wake. Reads stay
  synchronous. This is the recurring correctness bug in every tool with a queue
  or a long operation, fixed once.
- `pages/common.js` — `el()`/`elText()`/`elClear()`/`elAppend()` make
  `textContent` the path of least resistance (there is **zero `innerHTML` in the
  whole folder**), plus `skSafeHref()` (allowlist of href shapes, default deny,
  protocol-relative rejected), clipboard with a no-permission fallback that
  cleans up in a `finally`, download with a no-permission `<a download>`
  fallback, the FILENAME ALLOWLIST (keep `[A-Za-z0-9._-]`, everything else
  becomes `_`, Windows device names rejected by exact comparison, truncated on
  BYTES — it was a denylist character class, which is the shape this family has
  lost to twice), toast, theme, the `<dialog>` confirm **with an
  optional review pane**, `skRequestPersistence()`/`skDurabilityKey()`, and
  `skBuildDiagnostic()` — the problem report, built from an allowlist.
- `lib/settings.js` — the **one** definition of defaults + schema version +
  migration runner, `importScripts`'d by the worker and `<script>`'d by pages, so
  the duplicated-DEFAULTS drift cannot happen. It also carries the **sync/local
  partition**: `chrome.storage.sync` is an upload for anyone signed in, so a key
  goes there only if you would be comfortable seeing its value in a Google
  account export, and the default for a new key is local. `skSetSettings`
  **answers `{ok, reason}` and never throws**.
- `lib/storage.js` — IndexedDB with the two-kind split that makes the privacy
  promise keepable: **`scratch`** (in-flight, invisible, always cleaned up) vs
  **`items`** (finished, listed, exportable, deletable). Plus the three things
  every tool would otherwise get wrong: an age-and-ownership `sweepScratch` for
  the abandonment no abort path can catch, `trimItemsByAge` for retention (a
  count cap is not a retention policy), and `isQuotaError` classifying on
  `DOMException.name`/`code` — never on the engine's prose.
- `pages/options.*` — auto-saving settings that **report their own failures** and
  repaint the form from storage afterwards (so the page can never display a
  clamped value that is not in effect), migration on load, numeric clamps, the
  **"Your data"** section (list · export to one JSON file · per-row delete ·
  Delete everything · Reset settings · a durability line that is true in both
  branches), and **Report a problem**. `keepHistory` defaults to OFF.
- `publish/PRIVACY-POLICY.html` — the hosted policy, written against the storage
  architecture above rather than from scratch per tool. A Web Store submission
  is blocked without a policy URL, and a policy that overclaims is worse than
  none. Fill in the `⟨…⟩` slots; never packaged.
- `pages/common.css` — the family design tokens, light + dark, plus the four
  rules no tool should re-derive: the single `:where(…):focus-visible` ring, the
  full `prefers-reduced-motion` block (pseudo-elements and iteration count
  included), a `forced-colors` block for Windows High Contrast, and the switch
  control with its RTL knob direction. Every colour is a token and the sim
  computes every pairing against WCAG AA in both themes. `popup.css` carries
  layout only and declares no colour of its own.
- `icons/make-icons.mjs` — dependency-free PNG writer + 5×7 bitmap font, 4×
  supersampled. Change two constants and every tool has real icons.

**Tests (2 tiers, 686 checks)**

> **Tier 1 is currently RED, with three failures, and they are all one fact:
> 25 of the 51 translatable locales are still English.** `_locales/tm/` holds a
> translation memory for 26 of them; the remaining 25 have no TM file yet, so
> the generator writes English into their catalogues and the anti-abandonment
> checks say so. `node _locales/make-locales.mjs --todo` prints the list. This
> is unfinished content, not a broken skeleton — every other check in both
> tiers passes — but **do not copy a tool from here until it is zero**, because
> those 25 markets would each receive an English build wearing a locale code,
> 67 times. See *Not done yet* at the end of this file.

- `test/harness.js` + `test/skeleton-sim.node.js` — **619 checks**, browser-free,
  grading the real shipped files. Fake `chrome` (including `chrome.i18n`, reading
  the real catalogue, and storage that can be made to fail a write), fake
  IndexedDB faithful enough that `lib/storage.js` runs unmodified and that a real
  `QuotaExceededError` can be injected, fake DOM built from the tool's own HTML —
  attributes and all, with a real `activeElement`, a working `<dialog>`, a
  `StorageManager` and the Blobs a download was handed — a network trap,
  `restartWorker()` for modelling a suspension, and static scans that discover
  shipped files by walking the tree. Six of its sections matter to every tool:
  `=== a11y ===` (accessible names, no div-as-button, no positive tabindex, live
  regions, focus, motion, forced colours, RTL, silent truncation, and — because
  the key-resolution check can only grade keys that *exist* — visible text,
  attributes and text-sink literals that never reached the catalogue at all),
  `=== theme ===`
  (WCAG contrast computed from the CSS custom properties, in both themes,
  printed), `=== restricted ===` (twelve families of blocked page, each with its
  own sentence), `=== lifetime ===` (the worker killed mid-job and brought back),
  `=== data ===` (export, per-row delete, retention, quota, durability, the
  sync/local partition, and the claims on screen matching the code) and
  `=== diagnostic ===` (what may and may not reach a file the user sends on).
  The seventh, `=== publish ===`, is the only one that grades something other
  than the working folder: it builds a real archive with the real packaging
  functions and then tries to break it six ways — nested under a folder, 54
  locales dropped, an icon differing only in CASE, `test/` smuggled in, the
  `importScripts` guard removed, a `fetch()` added — and requires the grader to
  condemn every one.
- `test/browser/smoke.mjs` — **67 checks** performed by a real Chromium on the
  extension as shipped, including the things no static parse can see: a Tab walk
  that proves every control is reachable and every stop paints a ring, a dialog
  opened and closed with a real Escape that must hand focus back, the switch knob
  actually moving (and reversing under `dir="rtl"`), the layout surviving 200%
  and 400% zoom and a 280px popup, the durability line agreeing with the real
  `StorageManager`, and the export really downloading a parseable file through
  the no-permission anchor path. It then launches a **second browser whose UI
  language is Arabic** — three of the 55 required locales are RTL, and the
  failures that matter there all happen before any CSS runs: the catalogue not
  loading, `dir` never being set at boot, the mirrored layout clipping. Flipping
  `dir` by hand on an English page cannot see any of them.
  No edits, ever; it reads your `manifest.json`.
  Point it at the built package with `SMOKE_EXT_DIR` and it grades the bytes a
  reviewer will receive rather than the folder you have been editing.

---

## Copy and specialise

Work `TEMPLATE.md` sections 0–14 top to bottom. The short version:

**0.** `cp -r templates/tool Extension/My_Tool`, then ask a script what is left to do:

```sh
node publish/preflight.mjs      # every edit point, as a numbered list
```

It scans the exact file set that would **ship** — not the folder — and prints
the placeholders, the unfilled `⟨SLOT⟩`s, the demo feature, the database name,
the add-on id, the version, the provenance stamp, the store assets and the
documents that are still the skeleton's. When it prints none you are looking at
a submittable item. (Whatever number it prints in `_skeleton` is whatever it
prints — a count repeated in prose goes stale and a script does not, which is
why neither this file nor `TEMPLATE.md` quotes one.) It exists because the grep
this step used to recommend,
`grep -rni "skeleton\|replace me" .`, is unsatisfiable by construction: it
matches this README, `TEMPLATE.md`, the harness banner and the sim's own
filename, so the only way to "pass" it was to delete the instructions.

**0.5. Identity, before any code.** Fill in `publish/identity.json` — `slug`,
`ownerDomain`, `supportEmail`, `privacyPolicyUrl` — then
`node publish/bump-version.mjs --sync`. The Firefox add-on id is derived from
`ownerDomain`, and **AMO fixes an add-on's identity at first signing**, so it is
the one field in this folder that cannot be corrected later. The packager
refuses to build a Firefox package while the placeholder is there.

**1–2. Identity and prefix.** Rename in `manifest.json` (name, short_name,
description ≤132 chars, default_title, version → `0.1.0`), `popup.html`,
`options.html`, then swap the `sk`/`SK` code prefix.

> **Rename by explicit identifier, not with a blanket `sed s/SK/TP/g`.**
> `TEMPLATE.md` §3 lists the names for exactly this reason: the harness contains
> `SKIP_DIRS` and `SK_ROOT`, and a naive global replace silently corrupts them
> into `TPIP_DIRS` / `TP_ROOT`. Leave `el`, `elText`, `elClear`, `elAppend`,
> `elLink` alone — short names are why people reach for them instead of `innerHTML`.

`LAST_ERROR_KEY` **must match** between `background.js` and `popup/popup.js`; the
node sim has a check that fails if they drift.

**3. Look.** Set `--accent` in `pages/common.css`, `BADGE_COLOR` in
`background.js`, and `MARK`/`ACCENT` in `icons/make-icons.mjs` to the same hex,
then `node icons/make-icons.mjs` (it rewrites all four PNGs and reads each IHDR
back; `--check` re-reads without writing).

**4–5. Settings and storage.** Add keys to `SK_DEFAULTS` + a row in
`options.html` + an entry in `options.js` `FIELDS`; name your IndexedDB and stores.

**6. Error vocabulary.** Reword `RESTRICTED_REASONS`, add one `REASONS` row per
outcome. **Do not replace the gates with a sanitiser** — the comment above
`R_GENERIC` is the post-mortem of two regex attempts that failed open.

**7. The work.** Replace `describeTab` (**pure core** — data in, data out, no
`chrome.*`, no DOM, node-testable) and `runReadTitle` (**browser controller**)
with the real work, keeping that split; add router cases; replace the popup body
and `renderInfo`. Keep every abandonment routed through `abortJob`.

**8. Permissions.** Add one only when you can defend it in the store listing.

**9. Accessibility.** The checklist in `TEMPLATE.md` §10 — every line of it is
already enforced by the two tiers, so the work is keeping the checks rather than
rediscovering the rules. Copy the `.opt` row shape verbatim when you add a
setting; it is the one place `aria-labelledby` has to be right.

**11. The two test tiers**, and which parts of the sim are yours to rewrite.
Then **12–14: the licence and secrets rule, the package, the final checklist** —
see below.

### The forbidden-API grep, written so it does not cry wolf

Written as bare words it matches the *comments* that promise those APIs are
absent, and returns hits on a perfectly clean tool. A check that cries wolf
trains you to ignore it. This is the call-shaped version, and it is what the node
sim actually enforces:

```sh
grep -rnE "\.innerHTML|\.outerHTML|insertAdjacentHTML|\bfetch\s*\(|\bnew\s+XMLHttpRequest\b|\bnew\s+WebSocket\b|sendBeacon\s*\(|\beval\s*\(" \
  background.js popup pages lib
```

---

## Running the two tiers

```sh
node test/skeleton-sim.node.js       # tier 1 — no browser, ~6 seconds, 619 checks
node test/browser/smoke.mjs          # tier 2 — real Chromium, ~60 seconds, 67 checks
HEADFUL=1 node test/browser/smoke.mjs   # the same run, in a window you can watch
```

Both exit `0` only on `ALL PASS`, so they drop straight into a pre-publish
script. Both run from any working directory. Neither needs `npm install` **in
the tool**: there is one Playwright install for the whole fleet, in
`Tools/_playwright/`, and the browser tier prints the path *and the version* it
settled on so a release can be tied to the browser build that graded it. See
`test/browser/README.md`. Rename the sim to `test/<tool>-sim.node.js`;
`test/harness.js` and `test/browser/smoke.mjs` need no edits at all — and if you
edit one anyway, say so in `HANDOFF.md`, because `tools/audit-fleet.mjs` will
report the tool as DIVERGED and that is where somebody will look.

The two tiers are complementary, and you need both:

- the **node sim** proves the markup sink was never written, and can fuzz
  hundreds of hostile inputs through the pure core in milliseconds;
- the **browser** proves the string never became an element, and that Chrome
  accepts the manifest at all.

Both of them grade the **working folder**, which nobody outside your machine
will ever see. So there is a third thing to run before a release, and it grades
the artifact:

```sh
node publish/pack.mjs                    # build + grade both packages
node publish/pack.mjs --extract /tmp/pkg # then load THE PACKAGE, not the folder:
SMOKE_EXT_DIR=/tmp/pkg node test/browser/smoke.mjs
```

---

## Shipping

```sh
node publish/preflight.mjs                    # is it still the skeleton?
node icons/make-icons.mjs --promo "My Tool"   # the 440x280 store tile
node publish/shots.mjs                        # 1280x800 screenshots, from the real browser
node publish/bump-version.mjs minor           # every version site, in one step
node publish/pack.mjs                         # build + grade both packages
node publish/verify-firefox-package.node.js   # the AMO gate
```

The two asset commands are there because the store will not accept a submission
without a screenshot at exactly 1280×800 or 640×400, and because items with no
promo tile rank poorly in browse. Both are **generated**, from the browser that
is already running and from the PNG writer that already exists, so neither is a
reason to open an image editor — and, more to the point, an asset drawn by hand
at v0.1 and never refreshed is a description-vs-behaviour mismatch by v1.2,
which the store penalises specifically. Regenerate them every release.

The package is built from a **positive allowlist**, so `test/` — which
deliberately contains an exfiltration-shaped URL and five network APIs, inside an
item whose listing claim is "zero network calls" — can never ride along, and a
`.md` dropped into `pages/` cannot either. `_locales/` bypasses the pattern
language entirely and is unioned in unconditionally, because four innocent-looking
edits could each silently un-ship 55 catalogues and Chrome then refuses to load
the extension at all. Every reference is resolved **inside** the archive,
case-exact, and a **CASE MISMATCH is reported separately from MISSING** because
`icons/Icon128.PNG` loads on Windows and 404s on a reviewer's Linux box.

**Firefox is solved, not deferred.** `publish/manifest.firefox.json` is a
documented five-key delta and `background.js` is byte-identical in both packages
— the `importScripts` guard lives in the source, so there is no build-time
rewrite to lose. The one thing only the owner can do is choose the domain:
`gecko.id` is derived from `publish/identity.json`, AMO fixes an add-on's
identity at first signing, and the packager **refuses to write** a Firefox
package while the placeholder is present.

The documents — `STORE-LISTING.md` (single purpose, the 132-character cut, a
pre-written justification for all six permissions), `COMPLIANCE-CHECKLIST.md`
(the privacy-practices decision table, including why Google gets *"Website
content"* and Mozilla gets `["none"]` and why that is one honest answer rather
than two), `SUBMISSION.md` (only what a human must do) and `PRIVACY-POLICY.html`
— are in `publish/`, and `TEMPLATE.md` §13 explains what each gate guarantees.

---

## What the browser smoke test does and does not prove

Be honest about this. `test/browser/README.md` has the full treatment; the
summary is:

**It proves** — Chrome parses and *accepts* the manifest and enables the
extension (a manifest naming a missing file, or a version like `01.02`, makes
Chrome reject the whole extension, and nothing else in the toolchain can see
that); the service worker reaches `activated` without throwing; the popup and
options page render non-empty visible text; zero console errors, uncaught
exceptions and unhandled rejections; every declared icon decodes as a real image
at its declared size; every declared permission was actually *recognised* by
Chrome; and **zero network requests left the browser**. It also runs a second
Chromium whose UI language is **Arabic**, and proves the Arabic catalogue really
loaded, that `dir="rtl"` was set at boot from the locale rather than by the test,
that the layout mirrors *geometrically* (brand against the right edge, settings
rows reversed, knob travelling the other way) and that nothing clips or scrolls
sideways once it does.

The network check is **armed on every run**: before judging, it fires one
`fetch()` at a closed loopback port from a plain `data:` page — deliberately
*outside* the extension, since the extension's own CSP now refuses such a call —
and fails if it does not observe it. "We saw no traffic" is worthless if the
listener was never attached.

It then asserts the refusal itself, twice: a `fetch()` from an extension page and
one from the service worker must both **reject**, and neither request may reach
the wire. That turns the zero-network claim from something code review is
responsible for into something the engine will not permit.

**It does not prove the tool works.** Specifically:

- **No real website is involved.** No content script, no capture, no parse, no
  transform. Build the page-driving tier for that.
- **The popup is opened as a normal tab**, not a real action popup. Popup
  sizing, the ~25-second popup lifetime, and anything needing a user gesture are
  not covered.
- **`activeTab` is not granted** — there is no click. A tool whose work needs
  `activeTab` renders its "cannot read this page" path here, and that is correct
  for this tier.
- **Install *warnings* are invisible.** An unrecognised manifest *key* yields a
  yellow warning, not a load error, and Chrome does not log it. Bad
  *permissions* are caught; bad *keys* are not.
- **One browser build, one OS, one fresh profile.** No other extensions, no
  enterprise policy, no proxy.
- **Nothing about how it looks.** "Text is non-empty and elements have boxes" is
  not the same as legible, aligned, or right. **Look at it yourself** —
  `HEADFUL=1` exists for that, and it is not optional before publishing.

---

## Test doctrine

Two rules. The skeleton and both harnesses were built and signed off under both.

**FAIL-FIRST.** Write the check, predict the line it will go red on, watch it go
red *there*, then write the fix. A check first seen green has never been
observed to work.

**TEETH.** Re-inject the bug into the shipped file, prove the check bites,
restore byte-identical, verify the md5. A test that does not bite is not a test.

### Verification record

This skeleton was independently verified before any tool was built on it. Both
tiers were run, then bugs were injected **into the shipped files in place** (not
a copy — so the harnesses had to read what Chrome actually loads), and every file
was restored from its original buffer with the md5 compared.

| injected bug | the check that bit |
| --- | --- |
| `"bookmarkz"` added to `permissions` | `every declared permission was recognised by Chrome — DROPPED: bookmarkz` |
| `throw` at the top of `background.js` | `the service worker reached "activated" — state=redundant` |
| `console.error` in the popup | `zero console errors from the worker and the pages` (names the file and the message) |
| `fetch()` to a remote URL in the popup | five reds across both tiers — the static scan (`popup/popup.js:212`), the sim's runtime network trap, the package grader, and two browser-tier reds |
| the same `fetch()` **plus** `connect-src` relaxed to admit it | `ZERO network requests left the browser — https://evil.example/… <- chrome-extension://…/popup/popup.html` |
| `icons/icon128.png` deleted | disk check **and** *Chrome refused it — Could not load icon 'icons/icon128.png'* (10 reds) |
| both `_locales` collection paths defeated in `pack.mjs` | the packager **refused to write anything**, plus six sim reds naming the 55 dropped catalogues |
| a hardcoded `<h2>` label, a hardcoded `title`/`aria-label`, and an English sentence handed to `skToast` and to `elText` | the three checks added in v1.1.0 — see below |

Note the fifth row. A remote `fetch()` alone no longer reaches the wire, because
`connect-src 'none'` refuses it at the platform layer — so *"zero network"* stays
green and four **other** checks do the work. Proving that check still has teeth
required relaxing the CSP as well, which is the realistic compound mistake: an
author who wants a network call will remove the thing stopping it. Both halves
are independently caught.

**One injection was not caught, and is now fixed.** A user-visible string typed
straight into the markup passed every gate in both tiers. The existing check
resolves the keys that *exist*; a label with no key at all was invisible to it,
and would have shipped to all 55 locales in English with no symptom — the one
i18n failure with no natural signal, since a missing key renders a marker and a
dropped catalogue is refused at package time. Three checks now cover it (visible
text, visible attributes, and literals handed to a text sink), each proven to
bite. Letter-free glyphs are allowed by rule.

Because zero-network is the claim the whole family rests on, four further leak
channels were probed. **All four were caught**, each naming the offending URL and
its origin: `fetch()` at the very top of the service worker (the earliest
possible moment, before the popup exists), a passive `<img src=remote>` in the
popup HTML, `navigator.sendBeacon()`, and a remote `@font-face` in the shared
stylesheet with no JavaScript involved at all.

**The harness fails loudly when it cannot run.** With Playwright unavailable the
browser tier prints `CANNOT RUN` and exits `1`. It never reports a pass it did
not perform, which for an inherited tier matters more than any single check.

**The copy test.** The folder is copied to a scratch tool and `TEMPLATE.md` is
followed literally, with no other context. It has now been run twice, and the
second run found that the first run's fix was incomplete — which is the reason
this section exists at all.

*First run (v1.1.0).* Three defects, all the same shape: a check that was **red
on a correct tool**, which is the shape that teaches an author to delete checks.
Both `CHANGELOG-skeleton.md` and the identity checks were made to read one
`isSkeletonTree()` signal.

*Second run.* Following §0 literally **still** turned the node tier red, two
checks at once. `isSkeletonTree()` answers from `publish/identity.json`'s `slug`,
but §0's stamp writes `skeleton.json` — so a freshly copied, correctly stamped
tool still answers *"I am the skeleton"* until §1, and §0 told the author to
delete the skeleton's changelog **before** §1. Moving the deletion to §14 only
moved the red to the other side: the tree says "tool" from §1 while the file is
present until §14, so *some* point in the procedure was always red. The fix was
to stop asserting the deletion in the node tier at all — it is a **completeness**
fact, `publish/preflight.mjs` already grades it, and preflight is red by design.
The node tier now asserts only what is invariant everywhere: the fleet auditor
was inherited. The copy is now identical to the skeleton at §0 (619 checks) and
carries no copy-only failure at §1 (615 checks; the difference is skeleton-only
fixtures correctly skipping).

The lesson generalises: **a binary check over a file that a multi-step procedure
deletes in the middle cannot be green throughout.** Assert the invariant in the
tier; leave the countdown to preflight.

**Localisation was verified by comparing the screen to the API**, in five UI
languages plus a deliberately untranslated one. A real Chromium was launched
under `en`, `hi`, `ja`, `ar`, `de` and `ta`; both pages were opened; and for
every `[data-i18n]` node and every `data-i18n-attr` pair the **rendered**
`textContent` was compared against `chrome.i18n.getMessage()` for that same key,
evaluated in that same page. 68/68. This is the exact comparison an earlier
attempt did not make — `getMessage` returned Hindi while the popup rendered
English, and every check that read only one side of it was green.

Two details make it honest. The snapshot is taken at `DOMContentLoaded`: the boot
applier runs at end-of-body so it has already run, while `popup.js`'s async fill
— which legitimately replaces `#title` with the tab's real title or the em-dash
no-value glyph — has not. Grading later marks correct product code wrong. And
`ta` is in the list **because it is not translated**: it renders English, proving
the harness reports what is actually on screen rather than what the catalogue
promised.

Rendered samples: `hi` — `optionsHeading = "विकल्प"`, `popupCopyTitle = "शीर्षक कॉपी करें"`.
`ja` — `optionsHeading = "オプション"`. `ar` — `optionsHeading = "الخيارات"`,
`dir=rtl`. `de` — `optCopyOnOpenTitle = "Beim Öffnen kopieren"`. Nothing clipped
and no sideways scroll in any of the six, including `de` (the longest strings)
and `ta` (the tallest glyphs).

**RTL was verified in a real Arabic Chromium**, not by flipping an attribute:
`chrome.i18n.getUILanguage() = ar`, `h1 = "الخيارات"`, the brand 18px from the
right edge instead of 1099px, settings rows reversed, knob at `translateX(-18px)`,
zero sideways scroll and nothing clipped. That run is now part of the tier.

**The i18n sink checks were quote-blind, and are not any more.** The check that
refuses an English sentence handed to a text sink matched `'…'` only. The
identical bug written `skToast("Nothing was saved.")` — or with a template
literal — walked past it in silence, and `skConfirm({ title, body })`, which is
four user-visible strings and the last thing a user reads before agreeing to a
destructive action, was in no sink list at all. Nothing in this family enforces a
quote style and 67 authors will not all pick the same one. Both sink checks now
match all three JavaScript string spellings, and `skConfirm` is covered; all six
variants were proven to bite.

**Packaging was verified by reading the archive back**, from its central
directory, not from the packer's own report: 73 entries, `manifest.json` at the
zip root with no wrapper folder, 55 locale folders, every `_locales/` entry
matching `_locales/<code>/messages.json` and nothing else, and no `test/`,
`*.mjs`, `*.md`, `publish/`, `tools/`, `_locales/tm/` or `skeleton.json`. Every
entry was then **decompressed and scanned** for the test fixtures' exfiltration
payload strings; none is present anywhere in the archive.

That last point is load-bearing: `test/` carries deliberately malware-shaped
fixture URLs and five network APIs, and a package leaking it would read as
malware to a store reviewer. Three mechanisms stand between the fixtures and the
zip, and they were probed in order. The per-directory `ALLOW` list does not name
`test/` at all. The `NEVER` regex refuses it a second time — but `NEVER` is *one
regex used by both the walker and the read-back grader*, so a single edit defeats
both, and that edit was made. The third mechanism is independent and it is the
one that bit: *no packaged script can reach the network* went red naming
`test/harness.js` and `test/skeleton-sim.node.js` with the exact APIs a reviewer
would grep for. Two layers share a regex; the third does not.

Do the same for every check you add.

---

## Not done yet

**Do not copy a tool from this folder until this section is empty.** Everything
below is content, not machinery — the machinery is built, proven and green.

**25 of the 51 translatable locales are still English.** `_locales/tm/` holds a
translation memory for 26 of them; these 25 have no TM file, so the generator
writes English into their catalogues and three anti-abandonment checks in
`=== locales ===` say so by name. They are the only failures in either tier.

```
_locales/tm/{am,bn,ca,da,et,fa,fi,fil,gu,he,hr,hu,kn,lt,lv,ml,mr,no,ro,sl,sr,sw,ta,te,th}.json
node _locales/make-locales.mjs --todo     # prints exactly which keys each one lacks
```

Copy `_locales/tm/es.json` (2 plural categories) or `_locales/tm/ru.json` (4) as
the shape, ~114 keys each. Then `node _locales/make-locales.mjs`, and the three
reds shrink as the list does. **Do not edit those three checks** — a green tier
bought by lowering them is the certified abandonment they exist to catch, and the
next reader would inherit it believing 55 languages had shipped. Add each
locale's six round trips to `_locales/backtranslations.json` or the coverage
check goes red for it. Do six or eight locales per session, not 25.

**The fleet Playwright install does not exist.** `test/browser/smoke.mjs`
declares `Tools/_playwright/` as the one fleet location and explains at length
why a per-tool `node_modules` must not be the answer — then falls back to an
ancestor-and-sibling walk, which is what is actually resolving today (it lands on
`Full_Screen_Shot/test/e2e/node_modules/playwright`, v1.61.1). Rename or delete
that one tool and 67 browser tiers stop finding Playwright on the same afternoon.
Create it once:

```
mkdir Tools/_playwright && cd Tools/_playwright
npm init -y && npm i -D playwright && npx playwright install chromium
```

**Two documents still paraphrase `optResetDesc` with wording the product no
longer uses** — `publish/PRIVACY-POLICY.html:155` and `TEMPLATE.md` both say
"synced profile" where the catalogue says "synced **browser** profile". They are
prose in non-shipping documents, and they are the only two places in the tree
that disagree with what the product says on screen. A store reviewer reads the
privacy policy.

**Typography is mixed in the catalogue.** Four messages use the typographic
apostrophe U+2019 (`reasonFileUrl`, `reasonPdfViewer`, `optionsLead`,
`optReportDesc`); `reasonExtensionPage` uses the straight `'`. Normalising now
costs 26 staleness re-stamps, so it is deferred deliberately — but if you do it,
do it in one pass, fix the markup fallbacks in the same commit, and re-stamp.
