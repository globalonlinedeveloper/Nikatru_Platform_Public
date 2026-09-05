# Changelog — the skeleton itself

**Not the same file as `CHANGELOG.md`.** That one is your tool's release
history and ships with your tool. This one records what changed in `_skeleton`,
so that a tool copied at v1.0.0 can be told what it is missing at v1.3.0
without anybody reading two thousand lines of diff.

`tools/audit-fleet.mjs` prints which tools are BEHIND. This file is what turns
that into a decision: read the entries between their version and the current
one, decide which of them that tool actually needs, copy those files across,
and bump its `skeleton.json`.

One line per change, and **name the files touched** — that is the whole point.
Bump `skeletonVersion` in `skeleton.json` in the same commit.

`_skeleton` is not published anywhere, so these version numbers mean only:
patch = a fix inside an existing pattern · minor = a new pattern, a new check,
a new build-time script · major = a change a tool cannot pick up without
editing its own code.

**Delete this file when you copy the folder.** It is the skeleton's history,
not your tool's.

---

## [Unreleased] — mass-production readiness audit (verification pass)

**Verdict: NOT yet safe to copy 67 tools from.** The machinery is proven; the
CONTENT is not. 25 of the 51 translatable locales are still English and the node
tier is red for that and nothing else. Everything below was found by running the
thing rather than by reading the reports about it.

- `test/skeleton-sim.node.js` — **the two i18n sink checks were quote-blind.**
  They matched `'…'` only, so `skToast("Nothing was saved.")`, the
  template-literal form and `.title = "Dismiss"` all walked past in silence; and
  `skConfirm({title, body})` — four user-visible strings, read immediately
  before a destructive action — was in no sink list at all. Both checks now use
  a shared `JS_STR` covering all three JavaScript string spellings (a template
  literal with a substitution is excluded, so the concatenation ban keeps sole
  custody of that case), and `skConfirm` is covered. Six variants proven to
  bite. Nothing in this family enforces a quote style, so this left a large part
  of the fleet ungraded by a check everyone believed in.
- `test/skeleton-sim.node.js` + `TEMPLATE.md` — **the copy test was red from step
  0, and v1.1.0's fix for that was incomplete.** `isSkeletonTree()` reads the
  slug in `publish/identity.json`, but §0's stamp writes `skeleton.json` — so a
  correctly stamped copy still answers *"I am the skeleton"* until §1, and §0
  told the author to delete `CHANGELOG-skeleton.md` before §1. Moving the
  deletion to §14 only moved the red to the far side, because the tree says
  "tool" from §1 while the file is present until §14. The node tier no longer
  asserts the deletion at all: that is a COMPLETENESS fact,
  `publish/preflight.mjs` already grades it, and preflight is red by design. The
  tier now asserts only the invariant — the fleet auditor was inherited. A copy
  is now identical to the skeleton at §0 (619) and carries no copy-only failure
  at §1 (615; the difference is skeleton-only fixtures correctly skipping).
  **General rule worth keeping:** a binary check over a file that a multi-step
  procedure deletes in the middle cannot be green throughout.
- `TEMPLATE.md` — §0 no longer says to delete `CHANGELOG-skeleton.md`; §14 says
  to delete it alongside `TEMPLATE.md`, and both places say why. §0's worked
  example stamped a stale `skeletonVersion` of 1.0.0; it now shows 1.1.0.
- `TEMPLATE.md` §11 — states that the node tier is red today with exactly three
  failures, so an author who inherits them knows a **fourth** is theirs; and
  warns that `Tools/_playwright/` does not exist, so the resolver is currently
  landing inside another tool's `node_modules`.
- `TEMPLATE.md` §14 + `publish/PRIVACY-POLICY.html` — the last two places in the
  tree that paraphrased `optResetDesc` as "synced profile" now say "synced
  **browser** profile", matching the catalogue and all 26 translations made from
  it. Left by three previous agents; a store reviewer reads the privacy policy.
- `README.md` — check counts corrected (619 + 67, not 574 + 65), the tier's
  current red stated at the top of the test section, the verification record
  rewritten around what was actually run this pass, and a new **Not done yet**
  section listing the 25 locales, the missing fleet Playwright install, the two
  document paraphrases and the mixed typography. The old copy-test paragraph
  claimed both tiers ran green from a copy; that had stopped being true, which
  is the case in point for this whole entry.

**What was proven rather than asserted, this pass.** Both tiers run. A real
Chromium under `en`, `hi`, `ja`, `ar`, `de` and `ta`, comparing the **rendered**
text of every marked-up node and attribute against `chrome.i18n.getMessage()`
for the same key in the same page — 68/68, which is the comparison an earlier
attempt never made. Eight harness teeth probes injected into the shipped files
in place and restored byte-identical with md5 compared. A copy test through §0
and §1. And the built package read back from its central directory and
decompressed entry by entry.

No shipped file changed in this pass. `_locales/` is untouched: `--check` is ALL
PASS, nothing written, no drift.

---

## [Unreleased] — i18n, step 3 of 3: the generator, the locales, the anti-abandonment gate

**This step is NOT finished, and the test tier says so.** 26 of the 51
translatable locales are real translations; **25 still hold English** and are
named, one by one, by three red checks in `test/skeleton-sim.node.js`. Do not
stamp a version until `node _locales/make-locales.mjs --todo` is empty. Fill
`_locales/tm/<locale>.json` for: `am bn ca da et fa fi fil gu he hr hu kn lt lv
ml mr no ro sl sr sw ta te th`.

- `_locales/make-locales.mjs` — **translations moved out of the script and into
  `_locales/tm/<locale>.json`**, a flat `{key: "text"}` file per language.
  Resolution is TM → identical-English sibling key → plural `_other` → base
  locale (`es_419`→`es`, `pt_PT`→`pt_BR`, `en_*`→`en`) → brand/glyph
  pass-through. `--check` still writes nothing and is still the CI shape.
- `_locales/make-locales.mjs` — **THE DESTRUCTIVE-WRITE GUARD.** Any run that
  would replace a translated message with the English source refuses in full
  and writes nothing at all, naming every locale and count. No override flag.
  Proved twice: the same code with the guard removed silently flattened 120
  Arabic messages to English and exited `ALL PASS`; with the guard it refuses.
- `_locales/backtranslations.json` (new) + `backTranslate()` wired — the round
  trips for a **six-key privacy claim set**, declared as `BACKTRANSLATED_CLAIMS`
  with a line of justification each, one of which (`optDeleteAllDesc`) carries
  no negation at all and is the positive control for an *invented* negation.
  156 round trips are examined; the run prints in full what a green result does
  and does not prove.
- `test/skeleton-sim.node.js` — new `locales` section, **the anti-abandonment
  checks**: no two catalogues byte-identical; every locale differs from English
  in ≥90% of its graded message VALUES; every non-Latin locale is ≥90% in its
  own script (21 script ranges); placeholder parity; no tag leak; the generator
  agrees the tree is what it would write; `--self-test` still bites. Two
  exemptions, both printed rather than silent: brand/letterless pass-through
  keys, and variants of the *source* language (`en_GB` is English). `zh_TW`
  identical to `zh_CN` is graded like any other abandonment.
- `_locales/tm/` × 26 (new) — ar bg cs de el es es_419 fr hi id it ja ko ms nl
  pl pt_BR pt_PT ru sk sv tr uk vi zh_CN zh_TW.
- `TEMPLATE.md` §2 — the TM, the three shortcuts that keep a TM short, the
  guard, and the two legitimate ways to remove a translation.

Packaging needed no change and was verified by reading the built zip back from
its central directory: 55 catalogues inside, the default catalogue present,
nothing under `_locales/` that is not a catalogue, and the German *inside the
archive* is German. The generator, `package-guard.mjs`, `tm/` and
`backtranslations.json` are all build-time and all absent from the zip.

## [Unreleased] — i18n, step 2 of 3: the pass is wired and the gate runs it

Not stamped into `skeleton.json` yet: step 3 (the translations and the
back-translation gate) closes this item, and one version bump for the three
steps is easier for `tools/audit-fleet.mjs` to reason about than three.

- `pages/common.js` — **the applier is now the reference's.** `skApplyI18n()`
  reads exactly two attributes: `data-i18n` for text and
  `data-i18n-attr="title:key; aria-label:key2"` for attributes, written through
  `setAttribute` against the new **`SK_I18N_ATTRS` allowlist** — nine inert,
  text-only names, with `href`/`src`/`style`/`value`/the form-submission
  attributes deliberately absent (`_locales/` is edited by translators and must
  only ever become text; an `<option value>` is a stored enum). The earlier
  `data-i18n-title=`/`-label=`/`-placeholder=` spelling is gone and is now
  *refused* by the sim, because markup that looks translated and is never read
  renders English forever. **A key that does not resolve now leaves the authored
  English standing and warns** instead of overwriting it with the `⟦key⟧`
  marker: a forgotten catalogue entry degrades to English, never to a blank
  control. `skRawMsg()` is the new silent resolver underneath `skMsg`/`skPlural`
  /the DOM pass; `skUiLocale()` now reads `@@ui_locale` (the message file that
  actually **loaded**) before `getUILanguage()` (what the user asked for) —
  they disagree on every fallback, and it is the strings on screen that the
  plural rule has to agree with.
- `popup/popup.html`, `pages/options.html` — the four icon-only buttons moved to
  `data-i18n-attr`. No text and no key changed, so no locale churn.
- `test/skeleton-sim.node.js` — **a new `=== i18n ===` section, 26 checks, that
  RUNS the pass** instead of reading it. The real `pages/common.js`, in a vm,
  against the real `_locales/ar/messages.json`, over a DOM built from each
  page's own markup: every `[data-i18n]` node must hold its Arabic message in
  `textContent`, every allowlisted attribute must have been written, and every
  string `ar` translates must no longer read as the authored English. A sentinel
  node carrying a real key over impossible text makes that unfoolable in a tool
  whose locales are still English. `@@bidi_dir`/`@@ui_locale` are excluded **by
  name** from "this page reached the message files" — wiring those and stopping
  is how this item was twice reported done while the pages rendered English. A
  page that carries keys and loads no applier is named and failed; a forbidden
  attribute is caught at the declaration *and* at the write; a missing key is
  asserted to leave the English standing and to warn. Also: `skPlural` families
  are graded for all six CLDR categories (the literal scan cannot see them), and
  the physical-property check gained `direction`/`clear`/the corner radii plus a
  requirement that every `/* physical: intentional */` hatch say **why**.
- `test/browser/smoke.mjs` — two checks in the Arabic run: an icon-only button's
  `title` **and** `aria-label` come back in Arabic through `data-i18n-attr`, and
  no `⟦key⟧` marker survives anywhere in the rendered page. The node tier proves
  the pass against a fake DOM; only a real engine proves the selector matched.
- `TEMPLATE.md` §2a, §10.1, §11 — the two-attribute rule, the allowlist and its
  reasoning, the degrade-to-English behaviour, and `=== i18n ===` added to the
  sections a tool must keep.

## [1.1.0] — 2026-08-12

A verification pass: every gate was run, and seven deliberate defects were
injected into a real extension to prove the harness fails on a broken one.
Six of the seven were caught. The seventh, and three defects found by copying
the folder and following `TEMPLATE.md` literally, are fixed here.

- `test/skeleton-sim.node.js` — **a hardcoded user-visible string is now
  caught.** Nothing anywhere graded it: the existing check resolves the keys
  that *exist*, so a label typed straight into the markup was invisible to it
  and shipped to all 55 locales in English with no symptom. Three new checks —
  visible text outside any `[data-i18n]` subtree, a `title`/`aria-label`/
  `placeholder`/`alt` with no `data-i18n-*` counterpart, and a literal handed
  to `skToast`/`skMsg`/`elText`. Letter-free glyphs (`◐ ↻ ✕`) are allowed by
  rule, consistent with LOCKED RULE 1.
- `test/skeleton-sim.node.js` — **three checks that were red on a correct
  tool** are fixed, all via one shared `isSkeletonTree()` signal:
  `CHANGELOG-skeleton.md` was required to exist while TEMPLATE §0 tells you to
  delete it (so step 3 of the procedure turned the tier red); the same file was
  demanded by the "paths named in TEMPLATE.md exist" check; and the Firefox
  placeholder-detector asserted that *this tree's live identity* is a
  placeholder, which is false the moment you set a real domain.
- `test/skeleton-sim.node.js` — the PLACEHOLDER-tag check no longer fails a
  tool that still has tags. It demanded zero the instant the slug changed,
  which TEMPLATE §1 tells you to do *first*, so the tier was red for the whole
  build rather than for none of it. Completeness belongs to
  `publish/preflight.mjs`, which is red by design; the sim prints a count.
- `test/browser/smoke.mjs` — **a second browser, whose UI language is Arabic.**
  Everything before flipped `dir` by hand on an English page, which cannot see
  the three failures that happen before any CSS runs: catalogue not found, `dir`
  never set at boot, mirrored layout clipping. Seven checks; proven to bite.

## [1.0.0] — 2026-08-12

First stamped version. Everything below is what a tool copied from here starts
with; from now on, entries describe changes since the previous line.

- `manifest.json` — MV3, `activeTab` + `storage`, `default_locale`,
  `"incognito": "spanning"` declared, and a real
  `content_security_policy.extension_pages` with `connect-src 'none'`.
- `background.js` — message router with one try/catch, one response gate and a
  sender gate; the allowlist error path; the blocked-page table including
  `file:`, `chrome-error:`, the PDF viewer and sandboxed documents; the
  origin-only failure note with a display TTL; the wake sequence; the
  cleanup-on-abort hook with the page-revert call.
- `lib/settings.js` — defaults, the sync/local partition, schema version,
  migrations that cannot wipe, downgrade or half-stamp.
- `lib/storage.js` — scratch vs items, key ranges, trim by count and by age,
  the orphan sweep, export, quota classification, and a `clearAll` that
  enumerates the database rather than naming two stores.
- `lib/jobs.js` — the job table, write-through to `chrome.storage.session`.
- `pages/`, `popup/` — the design tokens, the accessibility substrate, the
  `<dialog>` confirm, the filename allowlist, the problem-report builder, the
  "Your data" section, and the site-access row.
- `_locales/` — all 55 Chrome Web Store locales and the generator that keeps
  them in sync, with the back-translation gate on privacy and permission keys.
- `publish/` — identity, packager, two graders, version bump, preflight,
  screenshots, and the four store documents.
- `test/` — two tiers: `test/skeleton-sim.node.js` and
  `test/browser/smoke.mjs`.
- `tools/audit-fleet.mjs`, `skeleton.json`, `HANDOFF.md` — fleet provenance.
