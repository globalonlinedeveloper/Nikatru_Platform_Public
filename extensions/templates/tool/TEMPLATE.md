# TEMPLATE — turning this skeleton into a named tool

This folder is a **real, loadable, working MV3 extension**. Load it unpacked
right now (`chrome://extensions` → Developer mode → Load unpacked → this folder)
and it will do something small but genuine: the popup reports the active tab's
title and copies it. You are starting from working software, not a blank page.

**Read §0 before you touch anything.** Then work top to bottom. Every step names
the exact file, the exact thing to find, and what to put there instead.

---

## 0. Before the first edit — how this document works

**Copy the folder, do not link to it.** A no-build-step vanilla-JS extension
cannot share modules at runtime, and every tool must be free to diverge.

```
cp -r templates/tool  Extension/My_Tool     # or: robocopy templates\tool Extension\My_Tool /E
cd Extension/My_Tool
```

**Stamp where it came from, now, while you still know.**

```jsonc
// skeleton.json — edit "tool" and "copiedAt". NEVER edit "skeletonVersion":
// it records the version you copied FROM, which is the whole point.
{ "skeletonVersion": "1.1.0", "tool": "My_Tool", "copiedAt": "2026-08-12" }
```

**Keep `CHANGELOG-skeleton.md` for now.** It is the skeleton's history, not
yours, and §14 tells you to delete it — but not yet, and the reason is worth one
paragraph because it is the whole reason the inherited tier can be trusted.

The node tier has to grade two different worlds from one file: the skeleton,
where every placeholder must still be present, and a tool, where every one of
them must be gone. It decides which world it is in from **one** signal, the
`slug` in `publish/identity.json`, and you set that in §1. Until you do, this
tree still answers *"I am the skeleton"* — so deleting the skeleton's files
before §1 turns the tier red for obeying the procedure, which is precisely how
an author learns to delete checks instead of reading them. Set the identity
first; delete the skeleton's own files last. §14 lists both.

### Three commands you will use constantly

```
node publish/preflight.mjs        what is still the skeleton's?  (RED until you are done)
node test/skeleton-sim.node.js    the node tier    (must be GREEN at all times)
node test/browser/smoke.mjs       the browser tier (must be GREEN at all times)
```

`preflight` scans the exact file set that would **ship** — not the folder — so it
never reports this document or the test tier at you. It is the machine half of
§14, and it is the answer to "am I finished?".

### Two things about editing that will otherwise cost you an afternoon

**Never run a blanket `sed` over the folder.** Renaming `SK` → `MT` with a
global replace corrupts `SKIP_DIRS` into `MTIP_DIRS`, `TASK` into `TAMT`, and
about forty other words. Every rename below names the file and the identifier.

**Never write a comment close-marker inside a comment.** Comments do not nest,
the first close wins, and the rest of your prose is then parsed as code. It has
happened twice in this family: once in `pages/common.css`, where it swallowed
the entire light token block (dark mode looked perfect, light mode had no
`--accent` and therefore **no focus ring at all**, and every static check still
passed); once in `publish/bump-version.mjs`, where node reported the error 130
lines away from the cause. There are now four checks for it. Do not be the
third.

### Where the strings live

**No user-visible string is a literal anywhere in this extension.** They are all
in `_locales/en/messages.json`, and the other 54 locales are generated from it.
So a step below that says *"change the tool name"* means **edit the catalogue**,
not the HTML. §2 is the whole procedure and it is short.

---

## The house style this skeleton already encodes

Do not re-derive these. They are already true of every file here, and it is your
job to keep them true.

| Rule | Where it lives |
|---|---|
| Manifest V3, vanilla JS, no build step, no framework, no dependency, no `node_modules` shipped | whole folder — every `.mjs` is a build-time script (icons, locales, packaging, version bump, screenshots, fleet audit) and the allowlist collects `.js`, never `.mjs` |
| **Zero network calls**, and the *platform* enforces it | `manifest.json` `content_security_policy.extension_pages` — `connect-src 'none'`. Plus the grep over shipped source, plus a real-browser check that a `fetch()` is refused |
| Minimum permissions: `activeTab` first, `optional_host_permissions` requested at run time only if unavoidable — **and revocable in the product** | `manifest.json` · the "Site access" section of `pages/options.html` |
| No accounts, no ads, no tracking. Single purpose, one sentence | `appDescription` in `_locales/en`, options "About", `publish/STORE-LISTING.md` |
| Anything stored is **listed, exportable, deletable one row at a time and deletable all at once** — settings included; anything abandoned is cleaned up | `pages/options.html` "Your data" · `background.js` `abortJob`/`dropScratch`/`wakeUp` · `lib/settings.js` `skResetSettings` |
| **"Delete everything" enumerates; it never lists.** A store you add later is emptied too | `lib/storage.js` `clearAll` reads `db.objectStoreNames` · `background.js` `wipeLocalPayload` |
| **A private window is never written to disk.** Spanning mode means one store for both kinds of window | `background.js` `isPrivate(tab)`, used at every write site and in the failure note |
| **No state that outlives one message may live only in memory.** An MV3 worker is killed mid-job several times an hour | `lib/jobs.js` — a write-through table over `chrome.storage.session`; a bare `new Map()` of jobs in `background.js` is a red |
| **Never lose data silently.** A write that failed says so, in a sentence the user can act on; a browser that may evict the store says so too | `SKDB.isQuotaError` → `reasonStorageFull` · `skSetSettings` returns `{ok, reason}` · the durability line |
| **A report path with no backend.** The diagnostic is built from a declared list of fields, shown in full, and saved to the user's own disk | `pages/common.js` `skBuildDiagnostic` · `skConfirm({previewText})` |
| **Untrusted text never reaches the DOM as markup** — `createElement` + `textContent`, never `innerHTML` with an interpolated value | `pages/common.js` `el()` / `elText()`; there is zero `innerHTML` in the whole folder |
| **Never sanitise untrusted text with a regex.** Use an allowlist of fixed strings plus one generic fallback | `background.js` `REASONS`/`humanReason`/`wireReason` · `pages/common.js` `SK_NAME_ALLOWED` |
| **Only this extension may talk to the router.** `sender.id`, and the tab is derived from `sender.tab`, never claimed by the message | `background.js` `senderIsOurs` / `tabIdFor` |
| **Every control has an accessible name, a visible focus ring and a real `<button>` behind it**; every status has a live region; every colour pairing is computed against WCAG AA in both themes | `pages/common.css` · both pages · `=== a11y ===` and `=== theme ===` in the sim — see §10 |
| **Logical properties only** (`margin-inline-start`, never `margin-left`) — three of the 55 locales are RTL | every stylesheet; a static check fails on an untagged physical property |
| **The tool's functional output is never translated** — see §2c | `skBuildFilename`'s `{date}`/`{time}`, exported JSON keys, CSV headers, captured page text |
| **A secrets file is never committed** — and this family needs none — see §12 | `.gitignore` · the packaging never-list matches `secrets*`, `credentials*`, `*.pem`, `*.key` |
| A test that does not bite is not a test | see "Prove it" at the bottom |
| **The package is built by a script, from a positive allowlist.** Never hand-zip | `publish/pack.mjs` · graded by `publish/verify-package.node.js` and by `=== publish ===` |
| **The same `background.js` runs in Chrome and in Firefox.** The `importScripts` guard is in the source, not applied by the build | `background.js` line 42 · `publish/manifest.firefox.json` `background.scripts` |
| **One source for every fact written twice.** The version, the add-on id, the slug, the support email, the skeleton version | `publish/identity.json` · `publish/bump-version.mjs` · `skeleton.json` |
| Licence: **PolyForm Shield 1.0.0**, and it ships inside the package because the licence says the notice travels with copies | `LICENSE` — allowlisted explicitly in `publish/pack.mjs` |

---

## 1. Identity — the four facts, written once

**Do this before any code.** `publish/identity.json` holds the four facts that
appear in more than one place, so they can never be typed twice and drift:

| Field | What it decides | Warning |
|---|---|---|
| `slug` | the zip filenames and the local part of the Firefox add-on id | lowercase, hyphens, not shown to users |
| `ownerDomain` | `gecko.id` is derived as `<slug>@<ownerDomain>` | **AMO fixes the add-on identity at first signing.** Get it right once. `publish/pack.mjs` refuses to build a Firefox package while the placeholder is here |
| `supportEmail` | the store listing's support field | a real inbox someone reads |
| `privacyPolicyUrl` | where you host `publish/PRIVACY-POLICY.html` | no URL, no publish button |

Then:

```
node publish/bump-version.mjs --sync      # writes the derived gecko.id into the Firefox manifest
```

Never type that id by hand.

> **The slug is also what tells the test tier which world it is in.** While
> `slug` is `"skeleton"`, the sim requires every `PLACEHOLDER(` tag to still be
> present. The moment it is anything else, it requires them all to be **gone**.
> That is why the inherited test tier is not red on day one of your tool.

## 2. Strings — the catalogue is the only place they live

`_locales/en/messages.json` is the single source. All 55 Chrome Web Store
locales are generated from it by one script, so **adding or changing a string
regenerates every locale in sync**.

### 2a. The procedure, every time you touch a string

1. Edit **`_locales/en/messages.json`** only. Each entry needs a `message` and a
   `description` **written for a translator** — what the string is for, what
   must not be reordered, what is a product name and must be copied through.
   Tag it `[privacy]` or `[permission]` in the description if it makes a claim
   about data or access; that is what puts it in the back-translation gate.
2. Reference it from markup with `data-i18n="key"` for the element's text, and
   `data-i18n-attr="title:key; aria-label:key2"` for its attributes — one pair
   per attribute, `;`-separated. From code, `skMsg('key')` (or
   `skPlural('base', n)`). Never a literal. Those two attributes are the only
   ones the pass reads; `data-i18n-title=` and friends were an earlier spelling
   and are now refused by the sim, because markup that looks translated and is
   never read renders English forever.

   `skApplyI18n()` writes text with `textContent` and attributes with
   `setAttribute` **against the `SK_I18N_ATTRS` allowlist in `pages/common.js`**
   — nine inert, text-only names. `href`, `src`, `style`, the form-submission
   attributes and `value` are absent deliberately: `_locales/` is the part of a
   shipped extension a *translator* edits, and it must only ever become text.
   `value` is worse than the rest — an `<option value>` is a stored enum, so
   translating one corrupts the user's settings. Adding a name to that array is
   red in `=== i18n ===`, at the declaration and again at the write.

   **A key that does not resolve leaves the authored English standing** and
   warns to the console. That is why the English inside a `[data-i18n]` element
   is not dead text: it is the first paint, and it is the fallback. Keep it
   byte-identical to the catalogue (the sim checks).
3. Regenerate:

```
node _locales/make-locales.mjs            # rewrite all 55, then run every gate
node _locales/make-locales.mjs --check    # gates only, write nothing (this is the CI shape)
node _locales/make-locales.mjs --todo     # which keys each locale still lacks
node _locales/make-locales.mjs --self-test  # prove the negation check bites
```

**Translations are data, not code.** `_locales/tm/<locale>.json` is a flat
`{ key: "text" }` file per language; the generator reads them and writes the 55
catalogues. To add or fix a language you edit one small file, not a table
inside a script. Three shortcuts are built in, so a TM file is shorter than the
catalogue it produces:

- a key whose **English is byte-identical** to another key's inherits that
  key's translation (`optExportTitle` and `optExportButton` are one string);
- a plural family needs only the categories the language actually uses — the
  other CLDR forms are filled from `_other`;
- a regional variant inherits its base and overrides only what differs
  (`es_419` → `es`, `pt_PT` → `pt_BR`, `en_GB` → `en`). `_locales/tm/es_419.json`
  is 17 lines and is a complete Latin-American Spanish.

`ar` and `en_GB` ship filled in as worked examples — Arabic because it is RTL,
exercises all six CLDR plural categories, and is the fixture the sim runs the
real applier against.

**A missing TM never becomes English.** The generator refuses, in full, any run
that would replace a translated message with the English source: nothing is
written, not even for the locales that were fine, and the refusal names the
locale and the count. There is no `--force`. This is not caution, it is the
lesson of a sibling project that nearly lost 38 translated locales in one
command while every structural gate stayed green. The two legitimate ways to
drop a translation are both visible in a diff:

1. delete `_locales/<locale>/messages.json`, or
2. put the English string in that locale's TM on purpose.

**`node _locales/make-locales.mjs --todo` is your progress bar.** A locale with
no TM file is not broken — Chrome falls back to `default_locale` and the user
sees English — but it *is* unfinished, and `test/skeleton-sim.node.js` says so
by name in its `locales` section. Do not silence those checks; fill the file.

**The first time you change an identity string, this command will FAIL. That is
correct.** `ar` and `en_GB` ship translated, and each generated entry records
the English it was translated from in its `description`. Change the English and
the recorded source no longer matches, so the run says:

```
FAIL   ar: 9 translation(s) were made from English that has since changed — appName, …
```

It is refusing to serve a translation of a sentence you no longer ship. Two ways
forward, and **hand-editing 55 files is not one of them**:

1. **Wire `translate()`** and re-run — a new translation is adopted and re-stamped.
2. **Let those keys fall through to English** until you do. Delete the stale
   entries from the locale file; a key with no entry is the English falling
   through, which is a valid shippable state. `--todo` lists what is missing.

```js
// drop entries whose recorded source no longer matches _locales/en
const en = JSON.parse(fs.readFileSync('_locales/en/messages.json', 'utf8'));
const j  = JSON.parse(fs.readFileSync('_locales/ar/messages.json', 'utf8'));
for (const k of Object.keys(j)) {
  const d = j[k].description || '';
  if (d.startsWith('en: ') && en[k] && d.slice(4) !== en[k].message) delete j[k];
}
```

**A string you never put in the catalogue is caught too.** Three checks in
`=== a11y ===` refuse visible text in a page that is not inside a `[data-i18n]`
subtree, a `title`/`aria-label`/`placeholder`/`alt` with no `data-i18n-attr`
counterpart, and a literal handed to `skToast`/`skMsg`/`elText`/`skConfirm`.
Glyphs with no letters in them (`◐ ↻ ✕`) are fine — they are identical in every
locale, and the accessible *name* of a glyph button is separately required to be
a key.

Those sink checks read **all three JavaScript string spellings** — `'…'`, `"…"`
and `` `…` `` — so your quote style is your own business. That was not always
true: they matched single quotes only, `skToast("Nothing was saved.")` walked
past in silence, and `skConfirm({ title, body })` — four user-visible strings and
the last thing a user reads before agreeing to delete their data — was in no sink
list at all. Nothing here enforces a quote style and 67 authors will not all pick
the same one.

**And a string that never reaches the screen is caught, which is the harder
one.** Everything above reads your files. `=== i18n ===` *runs* them: the real
`pages/common.js`, in a vm, against the real `_locales/ar/messages.json`, over a
DOM built out of your own markup — then asserts the Arabic is in `textContent`.
This item has twice been reported done by an author who had wired `dir` and
spelled every key, on pages that still rendered English, so the section is
explicitly built to refuse that: `@@bidi_dir` and `@@ui_locale` resolve without
a catalogue and are excluded by name from "this page reached the message
files", and a page that carries keys but loads no applier is named and failed.
If you add a page that does **not** load `pages/common.js`, it needs its own
copy of the pass — otherwise it renders the authored English with `data-i18n`
attributes all over it and every static check stays green.

### 2b. The identity strings, by key

These are the ones §1 used to send you to `manifest.json` for. They are **not**
in the manifest — it holds `__MSG_appName__` and friends.

| # | Key in `_locales/en/messages.json` | Currently | Replace with |
|---|---|---|---|
| 2.1 | `appName` | `SKELETON — replace me` | the store name. **≤ 75 chars hard**, and the store truncates near 45 |
| 2.2 | `appShortName` | `SKELETON` | **≤ 12 chars** — shown under the icon |
| 2.3 | `appDescription` | `REPLACE ME — …` | **one sentence, ≤ 132 chars.** The store cuts it there; the reference shipped 137 and lost the end |
| 2.4 | `actionDefaultTitle` | `SKELETON — replace me` | the toolbar-button tooltip; name the shortcut if you declare one |
| 2.5 | `popupBrand`, `popupDocTitle` | `SKELETON` | the display name |
| 2.6 | `optionsBrand`, `optionsDocTitle` | `SKELETON · Options` | the display name |
| 2.7 | `aboutName`, `aboutBlurb` | `SKELETON — replace me` | name + the same one sentence + the privacy claim. The markup that carries them is tagged `PLACEHOLDER(about)` in `pages/options.html` |

The markup that references these keys is tagged `PLACEHOLDER(tool-name)` in
`popup/popup.html` and `pages/options.html` (twice). You are not editing the
text there — it is the English fallback, which the applier overwrites at boot —
but the tags mark the spots to read once so you can see where each key lands.

The length limits are **enforced against every one of the 55 catalogues**, not
against the `__MSG_` placeholder — measuring `__MSG_appDescription__` is 22
characters and passes trivially, which is what happens to a length check the day
i18n lands.

### 2c. LOCKED RULE — the tool's functional output is never translated

This is an owner decision, not a preference, and getting it wrong corrupts data
rather than merely reading badly.

> **UI chrome is translated. Functional output is not.**

| Translated | Never translated |
|---|---|
| Labels, buttons, headings, error sentences, toasts, dialog text | **Exported Markdown, JSON keys, CSV headers** |
| Numbers and dates shown *to a person* — `skFormatBytes`, `skFormatDate`, which take the UI locale explicitly | **Captured page text** — it is the user's own content, in the page's own language |
| | **Filenames** — `{date}`/`{time}` stay ISO-ish. `Intl.DateTimeFormat` gives `04/07/2026` in one locale, `07/04/2026` in another and `٢٠٢٦` in a third, and a folder of those does not sort |
| | The version string, message-type constants, reason **keys** |

A filename is typed into shells and matched by scripts; a CSV header is parsed
by a spreadsheet; captured text is data. Translating any of them turns a
localisation into a corruption, in a language the maintainer cannot read.

## 3. The code prefix

The skeleton uses `sk` / `SK` so two tools installed side by side never collide
in a shared global scope, and so a grep for your prefix finds your code.

| # | File | Find | Replace with |
|---|---|---|---|
| 3.1 | `lib/settings.js` | `SK_DEFAULTS`, `SK_SYNC_KEYS`, `SK_LOCAL_KEYS`, `SK_INTERNAL_KEYS`, `SK_SETTINGS_VERSION`, `SK_MIGRATIONS`, `skGetSettings`, `skSetSettings`, `skResetSettings`, `skMigrateSettings`, `skInitSettings`, `skOnSettingsChanged` | same names with your prefix |
| 3.2 | `lib/storage.js` | `SKDB` | `<PREFIX>DB` |
| 3.3 | `lib/jobs.js` | `SKJOBS`, and `PLACEHOLDER(prefix)` — `JOBS_KEY = 'skJobs'` | `<PREFIX>JOBS` and one session key per tool |
| 3.4 | `pages/common.js` | the `sk*` helpers (`skApplyTheme`, `skCopyText`, `skToast`, `skConfirm`, `skBuildFilename`, `skDownloadBlob`, `skDownloadJson`, `skSafeHref`, `skRequestPersistence`, `skDurabilityKey`, `skBuildDiagnostic`, …) | same names with your prefix. **Leave `el`, `elText`, `elClear`, `elAppend`, `elLink`, `elUntrusted` alone** — short names are why people reach for them instead of `innerHTML` |
| 3.5 | `background.js` **and** `popup/popup.js` | `PLACEHOLDER(prefix)`: `LAST_ERROR_KEY = 'skLastError'` | one key per tool. **The two files must match** — the worker writes it, the popup reads it, and the sim checks they agree |
| 3.6 | `background.js` **and** `popup/popup.js` | `PLACEHOLDER(note-ttl)`: `SK_NOTE_TTL_MS` | same value in both, same reason |
| 3.7 | `pages/options.js`, `popup/popup.js` | the message types `SK_TAB_INFO`, `SK_JOB_CANCEL`, `SK_CLEAR_DATA`, `SK_DIAGNOSTIC` | your protocol constants, matching `background.js` |
| 3.8 | all `.js` | `SKELETON` in comment banners and `console.error` prefixes | your tool's name — log lines are how you find your own errors in a shared console |

## 4. Look

| # | File | Find | Replace with |
|---|---|---|---|
| 4.1 | `pages/common.css` | `PLACEHOLDER(accent)` — `--accent`, `--accent-hover`, `--accent-fg`, in **all three** token blocks | your accent, its hover, and the ink drawn on it. Keep every other token: that is the family look. Then run the sim — `=== theme ===` computes all 26 pairings in both themes and prints the ratios. The dark block deliberately flips `--accent-fg` to a dark ink, because white on a light indigo is 2.9:1 |
| 4.2 | `background.js` | `PLACEHOLDER(accent)` — `BADGE_COLOR` | the same hex as `--accent` |
| 4.3 | `icons/make-icons.mjs` | `PLACEHOLDER(icon)` — `MARK` and `ACCENT` | a one- or two-letter mark (A–Z 0–9) and the same hex again |
| 4.4 | — | `node icons/make-icons.mjs` | rewrites `icon16/32/48/128.png`, reads each back to prove its IHDR says what it should, and prints the **content box** of each. `--check` re-reads without writing |

Icon padding is a per-size lookup, not a constant: 128 is drawn 96×96 inside its
canvas, which is Chrome's own store guidance, while 16 fills its tile because a
toolbar icon has 256 pixels and cannot spare four rows of margin. An icon that
fills the 128 canvas renders visibly larger than every neighbour in the store
grid.

## 5. Settings

| # | File | Find | Replace with |
|---|---|---|---|
| 5.1 | `lib/settings.js` | `PLACEHOLDER(settings)` — `SK_DEFAULTS` | your keys. **Default to OFF** for anything that stores or reveals more than the single purpose needs |
| 5.2 | `pages/options.html` | `PLACEHOLDER(options-rows)` | one `.opt` row per key, `id` = the key name. **Copy the row shape exactly** — the triple in §10.1 is what gives the control a name at all |
| 5.3 | `pages/options.js` | `PLACEHOLDER(options-fields)` — `FIELDS` | one entry per key: `'checked'` \| `'value'` \| `'number'` |
| 5.4 | `pages/options.js` | `PLACEHOLDER(clamps)` | clamp every numeric setting here. The widget's `min`/`max` is a suggestion; anyone with devtools posts whatever they like |
| 5.5 | `lib/settings.js` | `PLACEHOLDER(migrations)` | leave empty until you **rename or change the meaning** of a stored key. Then bump `SK_SETTINGS_VERSION` and add the function keyed by the version it migrates *to*. Keep old entries forever |
| 5.6 | `lib/settings.js` | `SK_SYNC_KEYS` / `SK_LOCAL_KEYS` | **every key goes in exactly one, and the default for a new key is LOCAL.** See §5a |
| 5.7 | `lib/settings.js` | `SK_INTERNAL_KEYS` | keys with no control on the options page. Declare them; do not just omit them, or the parity check cannot tell "internal" from "forgotten" |
| 5.8 | `pages/common.js` | `PLACEHOLDER(setting-enums)` — `SK_SAFE_SETTING_VALUES` | the enum values a problem report may print verbatim. Everything else becomes `(text)` |

Adding a key needs no migration: a missing key reads its default. Moving a key
between **areas** needs none either — `skMigrateSettings` re-homes it and deletes
the stale copy — but it cannot un-replicate what has already been uploaded.

### 5a. Which storage area a setting goes in

`chrome.storage.sync` is not "storage that happens to sync". For a signed-in
user with sync on it is an **upload**: the value goes to Google's servers and is
replicated to every device on the account. The test is one sentence:

> A key goes in `SK_SYNC_KEYS` only if you would be comfortable seeing its value
> in a Google account export.

A theme, a boolean, a numeric cap: fine. The moment your tool grows a free-text
preference — a filename template naming a client, a per-site rule keyed by
hostname, a redaction wordlist, an allowed-domain list, a last-used folder — it
goes in `SK_LOCAL_KEYS`. With one store on offer and nothing saying otherwise,
that value ends up in the upload, which is how a workplace hostname reaches a
third party without anyone deciding it should.

The sim enforces both halves: every key is in exactly one list, and **no synced
key defaults to free text** (an enum is exempt, because its whole value space is
declared).

### 5b. `skSetSettings` answers; it never throws

It returns `{ ok: true }` or `{ ok: false, reason }`, where `reason` is a message
key. Writes fail for real — the 8 KB per-item sync ceiling, the 120-writes-a-
minute limiter after a burst — and the old signature let that rejection escape
into an unhandled promise, so the user got no "Saved", no error, and a form still
displaying a value that was never stored. **Handle the answer**, and repaint the
form from storage afterwards (`renderFields()`): a clamp that is not written back
means the page is showing a value that is not in effect, which makes every later
bug report from that user ambiguous.

## 6. Storage

| # | File | Find | Replace with |
|---|---|---|---|
| 6.1 | `lib/storage.js` | `PLACEHOLDER(db-name)` — `DB_NAME = 'skeleton'` | one database name per tool. Two tools sharing a name share a schema, and the second one to upgrade wins |
| 6.2 | `lib/storage.js` | `PLACEHOLDER(db-stores)` | your stores. Keep the two-kind split: **`scratch`** = in-flight, invisible, always cleaned up; **`items`** = finished, listed, deletable. Bump `DB_VERSION` whenever you add a store. **You do not have to touch `clearAll`** — it enumerates `objectStoreNames`, so a store you add is emptied whether or not you remembered |
| 6.3 | `pages/options.html` / `options.js` | the "Your data" section | keep **all five** controls: the list, Export everything, the per-row delete, Delete everything, Reset settings. The hosted privacy policy promises every one of them by name, and the sim checks that the promise and the product agree |
| 6.4 | `lib/storage.js` | `PLACEHOLDER(export)` — `SKDB.exportAll` | if your rows hold binary (an image, a PDF), decide here: base64 into the same JSON, or a second file. **Do not let a Blob reach `JSON.stringify`** — it serialises as `{}` and the export silently loses the payload |
| 6.5 | `background.js` | `PLACEHOLDER(scratch-ttl)` / `PLACEHOLDER(job-timeout)` | `JOB_TIMEOUT_MS` must be longer than your longest legitimate job's **wall clock** (it is measured across suspensions), and `SCRATCH_TTL_MS` longer still. Keep that order: the watchdog gets first refusal on a job still in the table, so the sweeper only ever sees rows with no owner |

### 6a. The three ways stored data disappears without anyone deleting it

**The browser evicts it.** An origin's IndexedDB is in a *best-effort* bucket
until `navigator.storage.persist()` grants otherwise, and a best-effort origin
can be emptied under storage pressure with no prompt and no event. Two things
every tool would otherwise rediscover: `persist()` is **Window-only** (the
service worker gets `undefined`, which is why the popup and the options page call
it and the worker never does), and `unlimitedStorage` raises the *quota* — it
makes nothing durable. `skRequestPersistence()` asks once, recorded in a **local**
setting because durability is granted per origin per device. The options page
prints `skDurabilityKey()` verbatim in both branches. **Never print "durable" on
a guess**; the best-effort sentence tells the user to export.

**The disk is full.** `SKDB.isQuotaError(e)` classifies on `DOMException.name`
and the legacy `code` 22 — enumerated protocol values, never `.message`, so it is
a membership test and not the sanitiser shape this family has failed with twice.
Map it to `R_STORAGE_FULL` at the write site, and **fail the run**: a disk-full
write reported as success leaves the user with history switched on, an empty
list, and no way to find out why.

**Retention swept it.** `retentionDays` is the age half of the policy that
`historyLimit` only bounds by count; the sweep runs on the worker wake, because
nobody writes a row on the day it expires. Scratch rows with no timestamp are
swept as orphans; **item** rows with no timestamp are kept, because items are
listed and the user can deal with them, and deleting a visible row on a guess is
losing data silently.

### 6b. A private window is never written to disk

`manifest.json` declares `"incognito": "spanning"` — the MV3 default, stated out
loud so it is a decision. Spanning means **one** service worker, **one**
IndexedDB and **one** settings store shared between normal and private windows.
So the moment a user ticks "Allow in Incognito" — exactly the user who cares
most — anything you persist from a private window lands in the same permanent,
listed store as everything else.

`isPrivate(tab)` is the one predicate. Use it at **every** write site:

- never write to `items` (scratch only, dropped at `endJob` as always)
- never park an origin in the failure note
- **say so.** The popup toasts `popupPrivateNotSaved` when history is on and the
  window is private — a user who turned the setting on and sees an empty list
  will otherwise conclude the setting is broken

`"incognito": "split"` is the alternative and it is a bigger decision than it
looks: it gives you two independent worker instances with separate storage,
which is cleaner in principle and means every piece of shared state in your tool
now exists twice. Firefox does not support `split` at all. Stay with `spanning`
and the predicate unless you have a specific reason.

## 7. The error vocabulary

| # | File | Find | Replace with |
|---|---|---|---|
| 7.1 | `background.js` | `PLACEHOLDER(restricted-copy)` — `RESTRICTED_REASONS` | reword for your tool, in `_locales/en`. Say *which kind of page* and *what to do instead*: "protected" on its own leaves the user nowhere to go. **The rows are tested in order, so narrow goes above broad** (`about:srcdoc` before `about:`) |
| 7.2 | `background.js` | `PLACEHOLDER(pdf-detect)` — `looksLikePdf` | the path ending `.pdf` is the cheap first cut. A tool that can afford a probe should also look for an `EMBED`/`OBJECT` of type `application/pdf` filling the viewport, and route it to the same reason |
| 7.3 | `background.js` | `PLACEHOLDER(reasons)` — `REASONS` | one row per outcome your tool can produce. Left = the exact string a code path or the engine emits; right = a **message key**, never a sentence |
| 7.4 | `background.js` | `PLACEHOLDER(actions)` — `ACTIONS` | your action names; anything outside the list becomes `'run'` |
| 7.5 | `popup/popup.js` | `PLACEHOLDER(actions)` — `ACTION_KEY` | the same names, each mapped to its OWN message key. Not a table of noun fragments to glue into a sentence — that compiles English word order into the program |

### 7a. The pages that are blocked and do not look blocked

`blockReason(tab)` is the single entry point, and it already covers more than
scheme matching, because two of these serve an ordinary `https:` url and every
scheme test says they are fine:

| Case | Why it is not obvious | What the user is told |
|---|---|---|
| `file:` | Not blocked by the browser at all — blocked by a **checkbox** the user has never seen | name the checkbox: "Allow access to file URLs" |
| `chrome-error:` | What an SSL interstitial or a DNS failure looks like | the page did not load; there is nothing to read yet |
| the built-in **PDF viewer** | The tab's url is the PDF's own `https:` address, so the tab looks completely ordinary | open it in a normal tab, or download it first |
| a **sandboxed** document | `about:srcdoc`, a top-level `data:`/`blob:`, or any frame whose `origin` is the literal string `"null"` | the *site* sandboxed it, not the extension |
| `chrome-untrusted:` / `resource:` | Internal WebUI, and Firefox internals for the cross-browser build | the generic browser-page sentence |
| `addons.mozilla.org` | The Firefox counterpart of the Web Store row | the site blocks every extension |

**Keep this vocabulary in one file.** The reference had three divergent copies
inside one extension, and none of them covered `chrome-error:`. The pages hold
no copy of it; the sim fails if one appears.

**Do not** replace the two gates with a sanitiser. Two attempts in this family
did, and both failed open — the second was beaten by an apostrophe in a URL path,
which ended the regex match early and left a session token in the sentence that
reached the popup. The long comment above `R_GENERIC` is the post-mortem; read it
before you touch that block. A reason is **recognised or it is generic**, and
both gates only ever return keys declared in that file.

## 8. The work

| # | File | Find | Replace with |
|---|---|---|---|
| 8.1 | `background.js` | `PLACEHOLDER(the-work)` — `describeTab` + `runReadTitle` | your tool's actual work. **Keep the split**: a PURE CORE (`describeTab`) that takes data and returns data — no `chrome.*`, no DOM, node-testable — and a BROWSER CONTROLLER (`runReadTitle`) that talks to the browser and calls the core. This is the split the whole test tier depends on |
| 8.2 | `background.js` | `PLACEHOLDER(messages)` | your router cases. Thin: validate, call a controller, answer. Never build markup here, never touch the network. **Derive the tab with `tabIdFor(msg, sender)`** — do not read `msg.tabId` |
| 8.3 | `popup/popup.html` | `PLACEHOLDER(popup-body)` | your controls. Keep the shape: a result area, a primary action, the error surface below |
| 8.4 | `popup/popup.js` | `renderInfo` | your render. Every value from outside goes through `elText`/`el`/`elUntrusted`. `renderInfo` is a top-level function in a classic script on purpose — a real-browser test can call `window.renderInfo({...})` with a hostile payload without any test-only code in the shipped file |
| 8.5 | `pages/common.js` | `PLACEHOLDER(filename)` — `skBuildFilename` | your tokens. Everything substituted in goes through the **allowlist**: keep `[A-Za-z0-9._-]`, everything else becomes `_`, Windows device names are rejected by exact comparison, and the result is truncated on **bytes** |
| 8.6 | `pages/common.js` | `PLACEHOLDER(diagnostic)` | your problem-report fields — see §8d |
| 8.7 | `publish/shots.mjs` | `PLACEHOLDER(shots)` | a screenshot of your tool **doing its single purpose**. The two the skeleton ships photograph the shell, and a listing whose only picture is a settings page is a weak listing |

Keep every path that gives a job up routed through `abortJob` — tab closed, tab
navigated, window closed, user cancelled, router threw, worker suspended,
watchdog timed out. That single hook is why nothing this tool writes, and nothing
it does to a page, can outlive the work that started it.

### 8a. The service worker dies mid-job. Design for it.

Chrome kills an MV3 service worker after ~30 seconds idle and after ~5 minutes of
wall clock, **while your job is running**, several times an hour. When it comes
back it is a fresh module and every module-scope variable is at its initial
value. So:

> **No state that outlives one message may live only in memory.**

A job table in a `new Map()` has exactly one behaviour after a suspension — it is
empty — and everything the map owned becomes unreachable: the scratch rows are
orphaned in a store nothing lists, `abortJob(tabId)` finds nothing so closing the
tab cleans up nothing, and the badge stays stuck because the `setTimeout` that
would have cleared it died too. The skeleton hands you the fixed version:

| Piece | What it does | Where |
|---|---|---|
| `SKJOBS` | the job table, mirrored to `chrome.storage.session` on **every** mutation; reads stay synchronous against an in-memory cache | `lib/jobs.js` |
| `wakeUp()` + `SK_WAKE` | rehydrate · clear the badge · watchdog · sweep orphaned scratch · apply retention. Runs at module top level, on **every** wake — not in `onStartup`, which fires when the *browser* starts and may not fire for weeks | `background.js` |
| `await SK_WAKE` | the first line of the router. A message can be what *starts* the worker, so a case that peeked at the table early would see it empty and start a second job in a tab that already has one | `background.js` |
| `onSuspend` | best-effort head start on the same cleanup. Not guaranteed to fire, which is why the wake sweep exists as well | `background.js` |

Two rules for what goes in a job record: **an origin, never a url** (it is
written to storage and read back by a later instance, so it is subject to the
same rule as the parked failure note), and **nothing the page controls** — no
titles. The sim asserts both against a hostile url.

Persisting the table removed the accidental garbage collector that suspension
used to be, so the **watchdog is not optional**: without it a wedged job marks its
tab busy for the rest of the session. It aborts through the same hook and parks
`reasonTimedOut`, so the user can find out why the badge stopped.

`H.restartWorker(prev)` in the harness is how you test all of this: it tears the
dead instance's listeners down (a real suspension takes them with it) and boots a
fresh module against the same `chrome` and the same IndexedDB.

### 8b. If your tool changes the page, the abort must change it back

`PLACEHOLDER(abort)` in `background.js` marks it. `abortJob` already calls
`revertPage(tabId)` on **every** abort path — that is shipped, live code, not a
comment telling you to add one. What is missing is the other end, because the
skeleton ships no content script (it does not need one, and shipping one would
hand every tool a permission and a second purpose it has not asked for).

When you add one:

- **Snapshot before you mutate.** `revert()` restores every property it touched
  from that snapshot — scroll position, `pointer-events`, `designMode`, a hidden
  element, an injected overlay.
- **Answer `SK_PAGE_REVERT`** with it. An aborted run that leaves a full-page
  overlay capturing clicks, on a page the user is still typing into, is not a
  cosmetic bug.
- **Every mutation has a revert or it does not ship.**
- **Everything a content script hands back is untrusted, page-controlled data**
  and goes through the same `el()` / allowlist discipline as a page title. It
  arrives from a context that shares a process with the page.
- The content script's messages reach the router with `sender.tab` set, so the
  router derives the tab from the sender. Do not add a case that trusts
  `msg.tabId`.

### 8c. Who may talk to the router

`senderIsOurs(sender)` refuses anything whose `sender.id` is not this extension,
and any extension-page sender whose url is not under our own origin. A refused
sender gets **no answer at all** — a refusal that answers is a probe that
succeeded.

This fails closed while you have only `activeTab`, which is precisely why it
would go unnoticed until after a tool grew a content script and a broad host
grant. Leave it in place, and add router cases *under* it.

### 8d. Report a problem, with no backend

There is no server, so there is nothing to send a report *to*. The user gets a
file they read, keep and send themselves — which makes redaction a design
constraint, because that file is about to leave the machine by a route this
product cannot see.

`skBuildDiagnostic()` is **built from an allowlist**, one field at a time.
Nothing walks an object and takes what it finds, and nothing is passed through a
regex that tries to remove urls from prose. Add your fields at
`PLACEHOLDER(diagnostic)`, and add each one to the sim's redaction check in the
same commit. **Never in a report:** a page url or path, a query string, a page
title, a captured document, a row's contents, or a free-text setting's value
(those are reported as `(text)`). The user-agent is reduced to an engine and a
major version. Then `skConfirm({ previewText })` shows the whole file before a
byte is written, and Cancel writes nothing.

## 9. Permissions — add only what you can defend

`manifest.json` ships with `activeTab` + `storage`. Each addition costs you an
install-time warning and a justification field in the store listing.

| You need | Add | Note |
|---|---|---|
| to read/act on the tab the user invoked you on | *nothing* — `activeTab` already covers it | granted by the click, for that tab, until it navigates |
| a real Save-As dialog or a download subfolder | `"downloads"` | `skDownloadBlob` already falls back to an `<a download>` that needs no permission — try that first |
| to inject a content script | `"scripting"` | still needs a host grant for the page |
| to inject an **asset** into a page (a stylesheet, an image, an iframe) | `"web_accessible_resources"` | scope `matches` to the **narrowest host set the feature needs; never `<all_urls>`**. A broad entry publishes your extension id to every page the user visits — a stable, high-entropy fingerprint that also tells a hostile site exactly which tool is watching it — and lets any page frame your own pages. Set `"use_dynamic_url": true` so the URL is not a fixed install fingerprint. The sim fails on an `<all_urls>` entry or a missing dynamic url |
| large local storage that must not be evicted | `"unlimitedStorage"` | it raises the **quota**, it does **not** make anything durable — `navigator.storage.persist()` does that, and the skeleton already calls it |
| any page, not just the invoked one | `"optional_host_permissions": ["<all_urls>"]` | **optional**, requested at run time, gated behind an opt-in feature. Never a static `host_permissions`. Declaring it lights up the **Site access** section of the options page automatically — state, grant, and **revoke** — with no code change: `PLACEHOLDER(optional-perms)` in `pages/options.js` reads the origins straight out of the manifest, so the row can never claim access you did not declare. Narrower than `<all_urls>` is always the better answer |
| a keyboard shortcut | a `"commands"` block | shortcut-fired work has no popup listening, which is exactly what the parked error note exists for |

**Two things that must stay absent**, and the sim checks both: no
`externally_connectable` (it opens the router to named web origins), and no call
to `chrome.storage.session.setAccessLevel` — the default `TRUSTED_CONTEXTS` is
what keeps the parked failure note out of reach of code sharing a process with
the page.

**Whatever you add, write down why, in `publish/STORE-LISTING.md` §4, under a
`### Permission: \`name\`` heading.** All six blocks are pre-written in the
formula the minimum-permission policy is judged against — narrowest scope · the
less-privileged option you rejected and why · tied to the single purpose — so
adding a permission is a delete-the-rest job, not a blank page at 11pm.
`manifestGates()` fails the build if a declared permission has no heading there,
or if the paragraph under it is under 40 characters. That is the check that
*scales*: it does not pin a permission list, it demands a paragraph. The guards
that do not scale with your feature set — no **static** `host_permissions`, no
`<all_urls>` content script — are enforced separately, where a tool that
legitimately adds `downloads` cannot knock them out by deleting a red line.

## 10. Accessibility — a checklist, not a principle

Every line below is enforced by `=== a11y ===` or `=== theme ===` in
`test/skeleton-sim.node.js`, or by the accessibility block in
`test/browser/smoke.mjs`. You do not have to remember them; you have to not
delete the check that remembers them for you. **Run the sim after every markup
change** — it is one second.

**10.1 Naming — every control, no exceptions.**

The shipped `.opt` row is the pattern. Copy it exactly:

```html
<div class="opt">
  <div class="text">
    <b id="myKey-label"  data-i18n="optMyKeyTitle">Setting name</b>
    <small id="myKey-desc" data-i18n="optMyKeyDesc">What it does.</small>
  </div>
  <input type="checkbox" class="switch" id="myKey"
         aria-labelledby="myKey-label" aria-describedby="myKey-desc">
</div>
```

- [ ] Every `input` / `select` / `textarea` has `aria-labelledby` pointing at an
      element that exists — **not** a wrapping `<label>` around the input alone,
      which names it with nothing, and not a `<label for>` either: the visible
      text is a *sibling* in a flex row, and wrapping it would change the layout
- [ ] Every icon-only button carries **both** `aria-label` and `title`. Per
      HTML-AAM an element's content beats its `title`, so `<button title="Toggle
      theme">◐</button>` announces as **"◐"**. `title` is a mouse tooltip; it is
      not a name. Both come from the catalogue in one attribute:
      `data-i18n-attr="title:themeToggle; aria-label:themeToggle"` — and the
      English you type into `title=`/`aria-label=` beside it is the first paint
      and the fallback, so it stays
- [ ] Every `<img>` declares `alt` — `alt=""` is the right answer for decoration
- [ ] Every page has exactly one `<h1>`, and `<html>` carries `lang` and `dir`

**10.2 Keyboard — everything, in order, visibly.**

- [ ] Real `<button>`/`<a>`, never a `div` with a click handler. The sim fails on
      `role="button"` on a non-button *and* on a click listener bound to a
      `DIV`/`SPAN` at runtime
- [ ] No positive `tabindex` anywhere. DOM order **is** the tab order
- [ ] The focus ring comes from the single `:where(…):focus-visible` rule in
      `common.css`. Change its colour if you must; never write `outline: none`
- [ ] Escape dismisses whatever is dismissible, from **one** document-level
      `keydown` handler — extend the branch, do not add a second listener

**10.3 Dialogs — use the one that exists.**

- [ ] Anything destructive or confirming goes through `skConfirm({titleKey,
      bodyKey, confirmKey, danger})` in `pages/common.js`. It is a native
      `<dialog>` + `showModal()`, so focus containment, Escape, backdrop inerting
      and **focus restore to the trigger** all come from the engine
- [ ] Do not hand-roll a scrim `div`. Five things have to be right and the
      reference shipped one with three of them wrong

**10.4 Live regions — a result nobody is told about did not happen.**

Four surfaces, and every tool has them. Each must be **in the DOM before it has
text** — a region that gains its role and its text in the same tick is not
reliably announced.

| Surface | Role | Why |
|---|---|---|
| the result of the tool's job | `status` | polite; wrap the whole card so it reads as one unit |
| the error/failure surface | `alert` | assertive; a failure interrupts |
| `skToast` | `status` | already set at creation in `common.js` |
| the "your data" summary | `status` | it changes after a wipe |

- [ ] A fifth surface means a new line in `LIVE_REGIONS` in the sim. That line is
      where someone decides polite vs assertive

**10.5 Colour — computed, never eyeballed.**

- [ ] Every colour in every stylesheet is a `var(--token)`. The sim fails on a
      raw `#hex` / `rgb()` outside the three token blocks in `common.css`
- [ ] After changing `--accent`, run the sim: `=== theme ===` prints all 26
      pairings with their ratios, in **both** themes, and goes red under 4.5:1
      (3:1 for control edges, state indicators and the focus ring). Dark mode is
      where this always breaks, and dark mode is what nobody screenshots
- [ ] `--accent` is used as a fill *and* as link text *and* as the focus ring. If
      one colour cannot satisfy all three, that is what `--accent-fg` flipping to
      a dark ink in the dark block is for
- [ ] Both dark blocks — `:root[data-theme="dark"]` and the
      `prefers-color-scheme` one — must stay identical. They are copies; copies
      drift

**10.6 Motion, forced colours, direction, and room to grow.**

- [ ] The reduced-motion block covers `*, *::before, *::after` and sets
      `animation-iteration-count: 1`. Without the pseudo-elements the switch knob
      keeps animating; without the iteration count an `infinite` spinner runs at
      0.01 ms per turn, which is a strobe aimed at the exact people the query
      exists for
- [ ] A `@media (forced-colors: active)` block restates every state carried by
      colour alone, in system colour keywords. Never `forced-color-adjust: none`
- [ ] **Logical properties only.** `margin-inline-start`, not `margin-left`;
      `inset-inline-end`, not `right`. A genuinely physical value is allowed if
      the line is tagged `/* physical: intentional */`. Use `[dir="rtl"]`
      selectors, not `:dir(rtl)` — `:dir()` shipped in Chrome 120 and this
      manifest declares 116
- [ ] Nothing caps its height and hides its overflow. German and Tamil run 40–80%
      longer than English; silent clipping is a bug nobody can see happen, so
      nobody reports it. The browser tier expands every label by 45% and
      re-measures
- [ ] Every `display: flex` states its `flex-wrap` (`nowrap` is a fine answer — it
      just has to be a decision). Every flex child holding text gets
      `min-inline-size: 0`
- [ ] Size text boxes in `ch` and containers in `min()`, not fixed px

**10.7 Untrusted text.**

- [ ] Anything from outside — a page title, an origin, a filename — is built with
      `elUntrusted(cls, text)`, which emits a `<bdi>`. A title containing U+202E
      RIGHT-TO-LEFT OVERRIDE reverses the rendering of everything after it in the
      same bidi paragraph, which lets a hostile page change what the **origin
      line** appears to say. `elText` stops it becoming markup; only isolation
      stops it hijacking the trusted text beside it

**10.8 No `<style>` blocks, no `style=` attributes.**

- [ ] Page layout lives in a `.css` file. `manifest.json` declares
      `style-src 'self'` with no `'unsafe-inline'`, so the browser **refuses**
      an inline block outright — and that CSP is the second gate behind
      "untrusted text never becomes markup". Setting `element.style.foo` from
      script is fine and is not what CSP blocks

## 11. The two test tiers

```
node test/skeleton-sim.node.js     # ~1s, no browser. Rename it to <your-tool>-sim.node.js
node test/browser/smoke.mjs        # ~10s, a real Chromium. Copy it UNCHANGED — ever
```

`test/harness.js` and `test/browser/smoke.mjs` are **inherited files**: they read
your `manifest.json` and grade whatever they find, so they need no edits. If you
do edit one, say so in `HANDOFF.md` — `tools/audit-fleet.mjs` will report your
tool as DIVERGED and that file is where somebody looks to find out whether it was
on purpose.

Playwright is **not** installed per tool. There is one install for the whole
fleet, in `Tools/_playwright/`; see `test/browser/README.md`. The path and
version are printed on every run — record them with a release.

> **Check that path on your first run.** `Tools/_playwright/` does not exist
> yet; the resolver falls back to an ancestor-and-sibling walk and currently
> lands inside another tool's `node_modules`. That works until someone renames
> or deletes that tool, at which point 67 browser tiers stop finding Playwright
> on the same afternoon. If the printed path is not `Tools/_playwright/…`,
> create the fleet install rather than working around it:
> `mkdir Tools/_playwright && cd Tools/_playwright && npm init -y && npm i -D playwright && npx playwright install chromium`

**The node tier is RED in `_skeleton` today, with exactly three failures**, and
they are one fact: 25 of the 51 translatable locales are still English. If you
copied a tool and see those three and nothing else, you inherited them — see
*Not done yet* in `README.md`. Any **fourth** failure is yours.

**Which parts of the sim are yours to rewrite, and which are not.**

| Rewrite freely | Keep |
|---|---|
| Every fixture and assertion about the **demo feature** — `read-title`, `copy-title`, `describeTab`. Those are scaffolding, and §14 requires them gone | `=== sink ===`, `=== network ===`, `=== canonical ===`, `=== reasons ===` — the four rules this family has actually paid for |
| The settings fixtures, once your keys replace `copyOnOpen`/`keepHistory` | `=== a11y ===`, `=== i18n ===`, `=== theme ===`, `=== restricted ===`, `=== lifetime ===`, `=== data ===`, `=== diagnostic ===`, `=== publish ===` — none of these name your feature |
| The `boot()` tab fixture, *added to* — do not remove the blocked-page or private-window tabs | The `boot()` blocked-page and private-window tabs. They are the coverage all 67 tools inherit |

Deleting a check because it went red is how the sink and allowlist checks get
lost as collateral. If a check is genuinely wrong for your tool, replace it with
one that is right and write down why in `HANDOFF.md`.

## 12. Licence, secrets and repo hygiene

- **`LICENSE` is PolyForm Shield 1.0.0**, a locked owner decision. Replace
  `⟨LICENSOR⟩` and `⟨LICENSOR_URL⟩` in the `Required Notice:` line at the top and
  delete the comment around it. It is **source-available and non-compete, not
  OSI open source** — say so plainly wherever you are asked, because a reviewer
  who assumes otherwise asks questions.
- **The licence file ships inside the package.** PolyForm's *Notices* section
  makes the terms travel with every copy, and a store user receives a copy. It is
  in the packaging allowlist explicitly, as a decision rather than an accident.

### LOCKED RULE — a secrets file is never committed

Nothing in this family needs a credential. Zero network calls, no accounts, no
telemetry, no CI that publishes for you; you sign in to the store dashboards
yourself, in a browser. **So a `.env`, a token, an API key or a `secrets.json` in
a tool folder is either a mistake or a sign the tool has stopped being one of
these tools.**

Three layers, and none of them is permission:

1. `.gitignore` covers `.env*`, `secrets*`, `credentials*`, `*.pem`, `*.key`,
   `*.p12`, `*.pfx`.
2. The **packaging never-list** matches the same shapes, so one cannot reach a
   store package even if it is somehow in the tree. The package grader then
   reports the file as MISSING, loudly, rather than shipping it.
3. The rule itself: **an ignored file is still on your disk and one `git add -f`
   from being public.** If you genuinely need a credential, it lives outside the
   repo, and you should first work out why a tool in this family wants one.

The never-list is deliberately broad. A false positive costs one rename and
fails loudly; a false negative costs a published credential.

- `publish/*.zip` **is tracked**, deliberately: each release zip is the exact
  artifact a store received, and the next build diffs against it to catch a
  silently dropped file. `publish/store/` is tracked for the same reason.
  `.gitignore` says both, and says what you lose if you change your mind.
- Never commit `node_modules`.

## 13. Shipping

Six commands, in this order. None is optional and none is slow.

```
node publish/preflight.mjs                    # is it still the skeleton?
node icons/make-icons.mjs --promo "My Tool"   # the 440x280 store tile
node publish/shots.mjs                        # 1280x800 screenshots, from the real browser
node publish/bump-version.mjs minor           # every version site, in one step
node publish/pack.mjs                         # build + grade both packages
node publish/verify-firefox-package.node.js   # the AMO gate
```

Then, once per release, load **the package** rather than the folder:

```
node publish/pack.mjs --extract /tmp/pkg
SMOKE_EXT_DIR=/tmp/pkg node test/browser/smoke.mjs
```

Every other gate in this repo grades the *working tree*. Nobody outside your
machine will ever see the working tree. That last pair is the only one that puts
a real browser in front of the bytes a reviewer receives.

**What the packager guarantees, so you do not have to remember it**

- A **positive allowlist**: `manifest.json`, `background.js`, `LICENSE`,
  `icons/*.png`, `lib/*.js`, `pages/*.{html,js,css}`, `popup/*.{html,js,css}`,
  `_locales/**/messages.json`. A `.md` dropped into `pages/` cannot ride along.
- **`test/` can never ship.** This family's fixtures deliberately contain an
  exfiltration-shaped URL and five network APIs, inside an item whose listing
  claim is "zero network calls". An automated store scan finding those is a
  malware-review referral, not a warning.
- **`_locales/` can never be dropped.** It does not go through the allowlist's
  pattern language at all — it is enumerated directly and unioned in
  unconditionally, because four independent innocent-looking edits could each
  silently un-ship 55 catalogues. The generic rule is kept alongside it and the
  build reports any disagreement between the two.
- **Every reference resolves inside the archive, case-exact** — every
  `<script src>`, `<link href>`, `<img src>`, icon, `importScripts` target and
  manifest path. A **CASE MISMATCH is its own kind of failure**, separate from
  MISSING, because `icons/Icon128.PNG` loads on your Windows box and 404s on a
  Linux reviewer's.
- The store's **upload rules**: name ≤ 75, `short_name` ≤ 12, description ≤ 132
  **resolved through every one of the 55 catalogues**, version format, no
  developer `key`, no `update_url`, a 128 icon, `default_locale` and `_locales/`
  implying each other, and every `__MSG_` resolving in every locale.
- **Nothing stale.** Every packaged byte is compared with the tree, and the file
  set is diffed against the previous release.

**Firefox is solved, not deferred.** `publish/manifest.firefox.json` is a
documented five-key delta — `background.scripts` alongside `service_worker` (its
absence is the addons-linter *error* `BACKGROUND_SERVICE_WORKER_NOFALLBACK`),
`options_ui` instead of `options_page`, no `minimum_chrome_version`, and the
`gecko` block with `data_collection_permissions` (mandatory for new add-ons since
2025-11-03). Anything else that differs is drift and fails the gate.
`background.js` itself is **identical** in both packages.

The one thing only you can do: **choose the domain.** `gecko.id` is derived from
`publish/identity.json`, AMO fixes the identity at first signing, and the packager
**refuses to write a Firefox package** while the placeholder is there — because an
artifact that exists is an artifact somebody uploads at 11pm.

Then `publish/SUBMISSION.md`, which lists only what a human must do.

**Three of these commands are RED in `_skeleton` itself, and that is correct.**
`preflight.mjs` prints its outstanding list, `verify-firefox-package.node.js`
reports one blocker, and `pack.mjs` builds and grades the Chrome package but
**refuses** the Firefox one. All three name the same fact: the skeleton is not a
submittable product and must not pretend to be. They are **submission gates, not
test tiers** — do not add them to the all-green set, and do not "fix" them by
inventing a domain. The two test tiers and `_locales/make-locales.mjs --check`
are the ones that must be green at all times, including in the skeleton.

`publish/` also ships with **no zip and no store assets in it**. The first ones
you build are your first release.

### 13a. Version bumps

```
node publish/bump-version.mjs patch|minor|major|1.2.3
node publish/bump-version.mjs --check     # the sim runs this too
```

It rewrites every declared site (`manifest.json`, `publish/manifest.firefox.json`),
stamps a dated `CHANGELOG.md` stanza carrying anything under *Unreleased*,
re-derives `gecko.id`, and then **greps the tree for the old number** and fails if
it survives anywhere it should not. Adding a new site is one line in
`VERSION_SITES`.

**A version is never reused.** Two different packages under one version number is
unrecoverable in public: the store keeps whichever it received first, and no diff
afterwards tells you which one a user has. Bump *before* you rebuild.

## 14. Before you call it done

**Run this first. It is the whole checklist, minus the judgement calls:**

```
node publish/preflight.mjs
```

It scans the exact file set that would SHIP (not the folder) and prints a
numbered list of what is still the skeleton: placeholders, `⟨SLOT⟩`s, the demo
feature, the database name, the add-on id, the version, the provenance stamp, the
store assets, the documents. In a finished tool it prints none. **The number it
prints in `_skeleton` is whatever it prints — do not quote a count here, because a
count in prose goes stale and the script does not.**

It replaces two greps this section used to open with, both defective.
`grep -rn "PLACEHOLDER("` matched this document, and
`grep -rni "skeleton\|replace me"` was **unsatisfiable by construction** — it
matches `README.md`, this file, the harness banner and the sim's own filename, so
the only way to "pass" it was to delete the instructions you were following. A
checklist item that cannot be satisfied teaches its reader to declare items done
by judgement, which is the exact failure a checklist exists to prevent.

Then, the four green commands:

- [ ] `node test/skeleton-sim.node.js` — **ALL PASS**; read the printed contrast
      ratios rather than trusting the summary line
- [ ] `node test/browser/smoke.mjs` — **ALL PASS**, including the keyboard walk,
      the dialog focus restore, the 200%/400% zoom reflow, the 45%-longer-labels
      pass, the CSP refusals, the real export download and the durability line
      agreeing with the real `StorageManager`
- [ ] `node _locales/make-locales.mjs --check` — no drift, no failed gate
- [ ] `node icons/make-icons.mjs --check` — 16/32/48/128 with your mark, and the
      content box of each

And the things only a person can check:

- [ ] Loads unpacked with **no errors and no warnings** on `chrome://extensions`
- [ ] The popup works, the options page saves, "Delete everything" empties the store
- [ ] **Export everything** writes a file you can open, and it contains your rows
- [ ] **Reset settings** puts the form back and clears the synced browser profile
- [ ] **Report a problem** shows you the file before it writes it, and there is
      nothing in it you would mind a stranger reading
- [ ] The durability line says one of the two declared things and **agrees with
      `navigator.storage.persisted()`** — never "durable" on a guess
- [ ] In a **private window** (with "Allow in Incognito" on), the tool still works
      and stores nothing
- [ ] `publish/PRIVACY-POLICY.html` — every `⟨PLACEHOLDER⟩` replaced, every
      sentence checked against what your code actually does, **hosted at a public
      URL**, and that URL pasted into the store listing's Privacy policy field.
      No URL, no publish button
- [ ] The single-purpose paragraph in `publish/STORE-LISTING.md` describes
      **every button in the popup and every row in options.html**. If it cannot,
      you have two purposes and one of them has to go
- [ ] `HANDOFF.md` has an entry for this session
- [ ] Tab through both pages yourself once, with the mouse pushed away from the
      keyboard. Ten seconds, and it is the only check that notices an order that
      is technically correct and humanly wrong

### Last step

**Delete `TEMPLATE.md` and `CHANGELOG-skeleton.md`, and rewrite `README.md` for
your tool.** All three are the skeleton's documentation, not yours, and a
reviewer who opens your package and finds a document titled *"turning this
skeleton into a named tool"* is looking at a template rather than a product.
`preflight` checks all three.

**Do this last, not first** — §0 says why. Both files are named in the node
tier, and the tier only stops requiring them once `publish/identity.json` says
this tree is a tool rather than the skeleton. Delete them before §1 and the tier
goes red for following the procedure; delete them here and it stays green while
`preflight` counts down to zero.

---

## Prove it — the test doctrine

Two rules, and the skeleton was built under both.

**FAIL-FIRST.** Write the check, predict which line it will go red on, watch it go
red there, *then* write the fix. A check first seen green has never been observed
to work.

**TEETH.** Re-inject the bug into the shipped file, prove the check bites, restore
byte-identical, verify the md5.

The most useful thing in this whole section is the list of checks that **did not
bite the first time** — fourteen of them across four rounds of teeth. Every one
was green over nothing and would have shipped to 67 tools that way. The recurring
pattern, in all fourteen:

> The check was **true by construction**, or **true because a second guard was
> doing the work** — not because the thing it named was being enforced.

Three shapes to watch for in your own checks:

1. **A filter inside an assertion.** `stops.filter(s => s.visible && s.width < 2)`
   is vacuously green if nothing is ever visible. Assert the population size too.
2. **A fixture that makes the failure unreachable.** A test whose browser GRANTS
   persistence cannot see a missing "ask only once" flag, because `persisted()`
   answers true forever afterwards. Test the branch where the guard does work.
3. **A second guard silently covering the first.** Adding `{dir:'test'}` to the
   packaging allowlist changed nothing, because the never-list caught it — which
   means the day somebody also relaxes the never-list there is no warning left.

### The teeth this skeleton was signed off with

| Round | Bugs injected | Caught | Missed on the first run |
|---|---|---|---|
| accessibility and theming | 25 | 25 | — |
| data lifecycle and privacy | 48 | 48 | 4 |
| shipping and packaging | 39 | 39 | 6 |
| the remaining audit gaps | 32 | 32 | 4 |

Selected bugs and the check that caught each — the ones a tool author is most
likely to reintroduce:

| Bug re-injected | Check that went red |
|---|---|
| `elText` uses `innerHTML` instead of `textContent` | the hostile page title became a live `<img>` in the popup, plus the static "zero innerHTML" scan |
| `humanReason` returns its argument when unrecognised | the session token appeared verbatim in the popup answer *and* in the parked note; a foreign object's own `toString` ran and printed `PWNED` |
| one `aria-labelledby` deleted from an options row | *every control on every shipped page resolves an accessible name* |
| light `--accent` set to a pale indigo | *light: all 26 colour pairings clear their WCAG floor* — 2.94:1, named, with the token and the hex |
| a comment close-marker written inside a comment | *no stylesheet has a stray comment marker* — found the hard way; it swallowed the entire light token block |
| the `[dir="rtl"]` knob rule deleted | *the switch knob travels the other way in RTL* — the bug no LTR test can see |
| `lib/jobs.js`'s cache stops writing through | six reds, headed by *THE JOB SURVIVES THE SUSPENSION* |
| the sweep's `keepJobIds` guard removed | **MISSED first time.** `JOB_TIMEOUT_MS` below `SCRATCH_TTL_MS` meant the watchdog always reached a long job first, so the guard was never the thing saving it. Rewritten against the predicate directly |
| a disk-full `items` write swallowed | **MISSED first time.** The job writes scratch BEFORE items, so failing the next put only exercised the first of the two quota paths |
| the persist-once flag removed | **MISSED first time.** When the browser GRANTS, `persisted()` answers true forever and the missing flag is invisible. Only the refused branch shows it |
| `onInstalled` goes back to a blanket write on `reason: 'install'` | *INSTALL on a profile that already carries synced settings PRESERVES them* — a settings wipe on every device on the account |
| the downgrade guard removed | **MISSED first time.** "The stamp is not written downward" is true by construction; what the guard stops is an older build *rewriting* a newer layout |
| the unconditional `_locales` union deleted | **MISSED first time.** While the ALLOW rule works, removing the safety net changes nothing. The sim now deletes the ALLOW rule at run time and demands the catalogues anyway |
| the fixed zip timestamp replaced with the clock | **MISSED first time.** Two writes microseconds apart are identical. The check now reads the mod-time bytes out of the archive |
| the `importScripts` guard "simplified" to `if (true)` | *the worker is a classic script AND every importScripts call is guarded* — Firefox runs `background.js` as an event page where `importScripts` is undefined |
| `connect-src 'none'` deleted from the CSP | the browser tier's *CSP refuses a fetch() from an extension PAGE* goes green-to-red the other way: the request suddenly reaches the wire |
| `style-src` given `'unsafe-inline'` back | *an injected `<style>` element has no effect* — the outline appeared |
| the sender gate removed from the router | **MISSED first time.** The harness's default sender was `{}`, which no browser produces, so a router that validated `sender.id` refused the sim's own messages and the natural conclusion was that the check was wrong. The fake now sends what Chrome sends |
| `clearAll` goes back to naming `items` and `scratch` | **MISSED first time.** The fake `objectStoreNames` exposed only `contains`, so `Array.from()` answered `[]` and an enumerating implementation looked like it cleared nothing while the hard-coded one passed |
| `isPrivate` removed from the `items` write site | *but it writes NOTHING to the store the options page lists* |
| `skBuildFilename` back to the denylist character class | **MISSED first time** in its old form — the assertions named characters that must be absent, which is the same mistake as the sanitiser. Replaced by a fuzz over 428 hostile titles asserting the output alphabet is a subset of the allowlist |
| the note TTL removed | *a note older than the TTL is NOT shown* — a failure on an intranet host still on screen seven hours later |
| `revertPage` deleted from `abortJob` | *every abort tells the PAGE to put itself back* |
| the PLACEHOLDER check pinned to "at least 15" | *A SPECIALISED TOOL: no edit point is left unmade* — the check that used to be red on day one of every tool |

All were restored byte-identical and the clean run went back to ALL PASS. **Do the
same for every check you add.**

**What to build on top**, in the order the reference implementation grew them:

1. a `.node.js` sim that `require()`s your pure core and grades it with no
   browser — parsing, state machines, filename derivation
2. a `=== canonical ===` section: no untrusted input may carry a
   HTML-significant character into a value you later render
3. a `=== sink ===` section: the renderer never matches
   `/innerHTML\s*=[^;]*\+/`, and does contain `textContent`
4. a real-browser Playwright harness that loads the unpacked extension and drives
   the service worker the way the popup does
5. a tier that grades **the artifact**, not the folder: `=== publish ===` builds a
   real archive with the real packaging functions and then tries to break it six
   ways and requires the grader to condemn each one

---

## What is in the box

```
manifest.json          MV3 · activeTab + storage · default_locale · incognito:
                       spanning · a real CSP with connect-src 'none' · popup ·
                       options page
background.js          message router (one try/catch, one response gate, one
                       sender gate) · allowlist error path · blocked-page table
                       incl. file:, chrome-error:, the PDF viewer, sandboxed
                       documents · storage.session note (origin only, with a
                       display TTL) · the wake sequence (rehydrate, watchdog,
                       orphan sweep, retention) · cleanup-on-abort, including
                       the page revert · install/update migration
popup/popup.html|js|css  the house look; renders through textContent only; the
                       error surface reads the parked note; asks for durable
                       storage on the first meaningful write
pages/common.js        el() DOM helpers · i18n applier and skMsg/skPlural ·
                       theme · clipboard and download (both with no-permission
                       fallbacks) · the FILENAME ALLOWLIST · toast · <dialog>
                       confirm with a review pane · safe-href allowlist ·
                       storage durability · the problem-report builder
pages/common.css       the design tokens for the whole family, light + dark,
                       plus the accessibility substrate (focus ring, switch,
                       reduced motion, forced colours, RTL)
pages/options.css      the options page layout — a FILE, because the CSP
                       forbids a <style> block
pages/options.html|js  auto-saving settings that report their own failures ·
                       migration on load · "Your data" (list, export, per-row
                       delete, delete everything, reset settings, durability) ·
                       Site access (grant AND revoke) · Report a problem
lib/settings.js        the ONE definition of defaults · the sync/local
                       partition · schema version · migrations that cannot
                       wipe, downgrade or half-stamp
lib/storage.js         IndexedDB: scratch (in-flight) vs items (user-visible,
                       user-deletable) · key ranges · trim by count and by age ·
                       orphan sweep · export · quota classification · a
                       clearAll that ENUMERATES the database
lib/jobs.js            the job table, write-through to chrome.storage.session,
                       so a job survives the worker being killed mid-run
_locales/              all 55 Chrome Web Store locales
  en/messages.json     THE SOURCE. Every user-visible string, each with a
                       description written for a translator
  make-locales.mjs     regenerates all 55 from en, in sync, plus the gates and
                       the back-translation check on privacy/permission keys
  package-guard.mjs    the guard pack.mjs cannot finish without calling
icons/make-icons.mjs   dependency-free PNG writer + 5x7 bitmap font: two
                       constants produce all four icons (padded per size to the
                       store's own guidance) and --promo produces the 440x280
                       store tile
icons/icon*.png        16/32/48/128, generated by that script
LICENSE                PolyForm Shield 1.0.0 + the Required Notice line. SHIPS
                       inside the package — the licence says the notice travels
CHANGELOG.md           your tool's releases. The top entry must equal the
                       manifest version, and the sim checks it
CHANGELOG-skeleton.md  the SKELETON's history. Delete it when you copy
skeleton.json          provenance: which skeleton version, which tool, when
HANDOFF.md             the session log template. Five headings, one of them Teeth
.gitignore             node_modules, secrets, OS droppings, scratch — and notes
                       saying publish/*.zip and publish/store/ are tracked ON
                       PURPOSE

test/
  harness.js           the shared sim harness: fake chrome (recording every
                       call), fake IndexedDB (with injectable failures), fake
                       DOM, the network trap, WCAG colour maths, restartWorker
  skeleton-sim.node.js 17 sections, no browser. Rename it for your tool
  browser/smoke.mjs    a real Chromium loads the extension. Copy it UNCHANGED
  browser/README.md    how it finds the one fleet Playwright install

tools/audit-fleet.mjs  read-only: which tools are BEHIND this skeleton, and
                       which have DIVERGED from its inherited files

publish/               everything about shipping. None of it is ever packaged.
  identity.json        slug · ownerDomain · supportEmail · privacyPolicyUrl
  pack.mjs             the packager: positive allowlist, _locales as an
                       unconditional union, deterministic zip, previous-release
                       diff, --extract for the browser tier. Refuses a Firefox
                       package while the add-on id is a placeholder
  verify-package.node.js   the grader: reads the archive BACK OUT, every
                       reference case-exactly, the store's upload rules (via
                       manifestGates(), the same function the sim runs on the
                       tree), the network scan, the leak check, staleness
  verify-firefox-package.node.js  the AMO gate. RED by design until the owner
                       picks a domain
  manifest.firefox.json    the documented five-key delta. Same background.js
  bump-version.mjs     every version site in one step + the old-number grep
  preflight.mjs        the machine half of §14: is this still the skeleton?
  shots.mjs            1280x800 store screenshots from the real browser
  STORE-LISTING.md     single purpose · the 132-char cut · a pre-written
                       justification for all six permissions · remote code: none
  COMPLIANCE-CHECKLIST.md  the privacy-practices decision table
  SUBMISSION.md        only what a human must do
  PRIVACY-POLICY.html  the hosted policy, written against the storage
                       architecture above. Fill in the ⟨…⟩ slots
```
