# MIGRATION — `_skeleton/` → `templates/tool/`

The template a new extension is stamped from moved from `_skeleton/` at the repository root to
`templates/tool/`, the location the architecture names as the scaffold source. **The move was a rename
and nothing else**: no file's contents changed, no file was dropped, and every path kept its position
relative to the folder it lives in.

This document exists so that the move is *auditable* — so a reader can confirm afterwards that 132 files
arrived, that the three things git cannot notice were handled, and that a red check after the move was
already red before it.

> **The tree is the authority for everything below.** Every count, every command result and every "still
> works" in this file was measured on the tree, on Node v24.18.0. Where a planning document and the tree
> disagreed, the tree won.

---

## STATUS — the move landed, 2026-08-14

Read this before anything below it. **§0, §1, §2 and §5 describe a state that no longer exists**; they
are kept as the record of the window, not as instructions. §3 is the reasoning and is timeless. Measured
on the tree, at the repository root:

| Claim | Measured now |
|---|---|
| `_skeleton/` is gone | `ls -d _skeleton` → no such directory · `git ls-files _skeleton \| wc -l` → **0** |
| the template is whole | `find templates/tool -type f \| wc -l` → **134**. `git ls-files` counts 133 of them: `.gitignore` ignores `**/HANDOFF.md` and then un-ignores `templates/tool/HANDOFF.md` specifically, so that one is tracked or untracked depending on whether it has been staged yet — see §9. |
| §5 was resolved as **option B** | `templates/tool/README-tour.md` exists and is tracked; the new stamping guide is `templates/tool/README.md` |
| the scaffolder follows it | `node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest --dry-run` → `template: templates/tool` · `133 file(s) to copy` · `tool.json tests: test/skeleton-sim.node.js` · **EXIT 0** |
| the old fallback is empty | the same command with `--template _skeleton` → **EXIT 2**, `CANNOT RUN — no template found. Looked for: _skeleton.` |
| **§6 is fixed** | `node templates/tool/tools/audit-fleet.mjs` → `tools 1 found`, `1 unstamped`, exit 0. The walk is anchored on `.git` and a zero-tool result now exits **1** instead of reading as good news. §6 is kept for the reasoning, not as an open defect. |

**§4, §6, §7, §8 and §9 are the reason this file stays.** §4 is the pre-move baseline a red check is
still attributed against, and §6 records why the obvious repointing fix — ascend for `README.md` — would
have reproduced the very failure it was meant to repair.

---

## 0. ⚠️ The half-state that existed before the move, and what it did to the scaffolder

*Closed by the move. Kept because the failure shape is the one this corpus keeps meeting.*

For a window, `templates/tool/` existed and held **two** files (`tool.json`, `README.md`). That was not
inert.

`scripts/new-tool.mjs` chooses its template by precedence — `templates/tool/` **if it exists**, otherwise
`_skeleton/`. The precedence was written so that the day the move landed the script would follow it
without an edit. What it did *then*, with the directory half-populated, was measured:

```
node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest --dry-run
  template: templates/tool
  2 file(s) to copy · package.include: manifest.json, _locales/
  tool.json tests: none found
  EXIT 0
```

Two files, no manifest, no locales, no tests — and **exit 0**, with nothing that read like a warning.
The same command with `--template _skeleton` copied **131 files** and listed the real include set and
`test/skeleton-sim.node.js`.

The move was landed together with the two new files, so the window closed rather than being worked
around. **Do not reach for the escape hatch this section used to prescribe** — `--template _skeleton`
now names a directory that does not exist:

```
node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest --template _skeleton --dry-run
  CANNOT RUN — no template found. Looked for: _skeleton.
  EXIT 2
```

The plain command reports `template: templates/tool` and `133 file(s) to copy`, exit 0. The `_skeleton/`
fallback stays in the script on purpose (§7): it costs one branch, and it is what made this window
recoverable rather than fatal.

This is the same failure this corpus keeps meeting from the other side: nothing broke, something *stopped
working properly*, and the exit code stayed 0.

---

## 1. What moved

All **132 tracked files** under `_skeleton/`, as **18 top-level entries**:

| | Entry | Kind | Files |
|---|---|---|---|
| 1 | `.gitignore` | file | 1 |
| 2 | `CHANGELOG-skeleton.md` | file | 1 |
| 3 | `CHANGELOG.md` | file | 1 |
| 4 | `HANDOFF.md` | file | 1 |
| 5 | `LICENSE` | file | 1 |
| 6 | `README.md` | file | 1 — ⚠️ **destination occupied, see §5** |
| 7 | `TEMPLATE.md` | file | 1 |
| 8 | `background.js` | file | 1 |
| 9 | `manifest.json` | file | 1 |
| 10 | `skeleton.json` | file | 1 |
| 11 | `_locales/` | dir | 88 |
| 12 | `icons/` | dir | 5 |
| 13 | `lib/` | dir | 3 |
| 14 | `pages/` | dir | 5 |
| 15 | `popup/` | dir | 3 |
| 16 | `publish/` | dir | 13 |
| 17 | `test/` | dir | 4 |
| 18 | `tools/` | dir | 1 |
| | | | **132** |

Measured with `git ls-files _skeleton | wc -l` → 132, and one entry per line of
`git ls-files _skeleton | sed 's|_skeleton/||' | cut -d/ -f1 | sort -u` → 18.

### 1.1 Every path, and where it landed

Destination was `templates/tool/<same path>` in every single case. The table is written out in full
rather than summarised, because "it's just a rename" is exactly the claim that needs to be checkable.

| # | `_skeleton/…` | → `templates/tool/…` |
|---|---|---|
| 1 | `.gitignore` | `.gitignore` |
| 2 | `CHANGELOG-skeleton.md` | `CHANGELOG-skeleton.md` |
| 3 | `CHANGELOG.md` | `CHANGELOG.md` |
| 4 | `HANDOFF.md` | `HANDOFF.md` |
| 5 | `LICENSE` | `LICENSE` |
| 6 | `README.md` | `README.md` — ⚠️ **§5** |
| 7 | `TEMPLATE.md` | `TEMPLATE.md` |
| 8 | `background.js` | `background.js` |
| 9 | `manifest.json` | `manifest.json` |
| 10 | `skeleton.json` | `skeleton.json` |
| 11 | `icons/icon16.png` | `icons/icon16.png` |
| 12 | `icons/icon32.png` | `icons/icon32.png` |
| 13 | `icons/icon48.png` | `icons/icon48.png` |
| 14 | `icons/icon128.png` | `icons/icon128.png` |
| 15 | `icons/make-icons.mjs` | `icons/make-icons.mjs` |
| 16 | `lib/jobs.js` | `lib/jobs.js` |
| 17 | `lib/settings.js` | `lib/settings.js` |
| 18 | `lib/storage.js` | `lib/storage.js` |
| 19 | `pages/common.css` | `pages/common.css` |
| 20 | `pages/common.js` | `pages/common.js` |
| 21 | `pages/options.css` | `pages/options.css` |
| 22 | `pages/options.html` | `pages/options.html` |
| 23 | `pages/options.js` | `pages/options.js` |
| 24 | `popup/popup.css` | `popup/popup.css` |
| 25 | `popup/popup.html` | `popup/popup.html` |
| 26 | `popup/popup.js` | `popup/popup.js` |
| 27 | `publish/COMPLIANCE-CHECKLIST.md` | `publish/COMPLIANCE-CHECKLIST.md` |
| 28 | `publish/PRIVACY-POLICY.html` | `publish/PRIVACY-POLICY.html` |
| 29 | `publish/STORE-LISTING.md` | `publish/STORE-LISTING.md` |
| 30 | `publish/SUBMISSION.md` | `publish/SUBMISSION.md` |
| 31 | `publish/bump-version.mjs` | `publish/bump-version.mjs` |
| 32 | `publish/identity.json` | `publish/identity.json` |
| 33 | `publish/manifest.firefox.json` | `publish/manifest.firefox.json` |
| 34 | `publish/pack.mjs` | `publish/pack.mjs` |
| 35 | `publish/preflight.mjs` | `publish/preflight.mjs` |
| 36 | `publish/shots.mjs` | `publish/shots.mjs` |
| 37 | `publish/skeleton-0.0.1.zip` | `publish/skeleton-0.0.1.zip` — tracked on purpose, see §8 |
| 38 | `publish/verify-firefox-package.node.js` | `publish/verify-firefox-package.node.js` |
| 39 | `publish/verify-package.node.js` | `publish/verify-package.node.js` |
| 40 | `test/browser/README.md` | `test/browser/README.md` |
| 41 | `test/browser/smoke.mjs` | `test/browser/smoke.mjs` |
| 42 | `test/harness.js` | `test/harness.js` |
| 43 | `test/skeleton-sim.node.js` | `test/skeleton-sim.node.js` |
| 44 | `tools/audit-fleet.mjs` | `tools/audit-fleet.mjs` — ⚠️ **§6** |

**`_locales/` — 88 files, all 1:1**

| Group | Count | Paths |
|---|---|---|
| generator + gates | 3 | `_locales/make-locales.mjs` · `_locales/package-guard.mjs` · `_locales/backtranslations.json` |
| catalogues | 55 | `_locales/<code>/messages.json` for `am ar bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW` |
| translation memory | 30 | `_locales/tm/<code>.json` for `ar bg ca cs de el en_AU en_GB en_US es es_419 fr hi id it ja ko ms nl pl pt_BR pt_PT ru sk sv tr uk vi zh_CN zh_TW` |

### 1.2 New files, which are additions rather than moves

| Path | What it is |
|---|---|
| `templates/tool/tool.json` | the monorepo contract, as the template declares it. **Reference and hand-copy path, not a form the scaffolder fills in:** `scripts/new-tool.mjs` writes a fresh `tool.json` into the new tool rather than copying this one (with empty permission justifications, so `policy-check` is red until a human writes them) |
| `templates/tool/README.md` | the stamping guide — ⚠️ **collides with entry 6, see §5** |
| `Extension/Full_Screen_Shot/tool.json` | the same contract, filled in for FullShot from its real manifest, store listing, packager and shipped zip |
| `MIGRATION.md` | this file |

### 1.3 The template is a superset of the sketch — do not trim it to match

A planning sketch of `templates/tool/` lists roughly ten entries (`tool.json`, `manifest.json`,
`README.md`, `CHANGELOG.md`, `background.js`, `popup/`, `pages/`, `icons/`, `_locales/en/messages.json`,
`test/smoke.node.js`). What actually moves is larger, and deliberately so:

- **55 locale catalogues, not one.** They are generated from `en` by `_locales/make-locales.mjs` and
  gated by it; dropping 54 of them would not simplify the template, it would delete the generator's
  output and the check that the output is current.
- **`lib/`, `publish/`, `tools/`** — settings/storage/jobs, the packager and its two graders, and the
  fleet audit. None appear in the sketch; all are real, runnable, and are what makes the template a
  working extension rather than a scaffold.
- **`test/smoke.node.js` does not exist and should not be created.** The two real tiers are
  `test/skeleton-sim.node.js` (node, no browser) and `test/browser/smoke.mjs` (real Chromium). Renaming
  either to match a sketch would break the names the documents, the harness and `preflight` all use.

---

## 2. The move, as the commands that ran

*Record, not instructions — `_skeleton/` is gone, so nothing below will do anything if you run it now.*

`templates/tool/` already contained `tool.json` and `README.md`, so **`git mv _skeleton templates/tool`
would have been wrong** — git moves a directory *into* an existing directory, which would have produced
`templates/tool/_skeleton/`. The 17 uncontested entries moved individually, then `README.md` was resolved
per §5.

```sh
# from the repository root
fail=0
for p in .gitignore CHANGELOG-skeleton.md CHANGELOG.md HANDOFF.md LICENSE TEMPLATE.md \
         background.js manifest.json skeleton.json \
         _locales icons lib pages popup publish test tools; do
  if ! git mv "_skeleton/$p" "templates/tool/$p"; then echo "FAILED: $p"; fail=1; fi
done
[ "$fail" -eq 0 ] || { echo "MOVE INCOMPLETE — fix the failures above before continuing"; exit 1; }
```

```powershell
# PowerShell equivalent
$entries = '.gitignore','CHANGELOG-skeleton.md','CHANGELOG.md','HANDOFF.md','LICENSE','TEMPLATE.md',
           'background.js','manifest.json','skeleton.json',
           '_locales','icons','lib','pages','popup','publish','test','tools'
$failed = @()
foreach ($p in $entries) { git mv "_skeleton/$p" "templates/tool/$p"; if (-not $?) { $failed += $p } }
if ($failed) { Write-Host "MOVE INCOMPLETE — failed: $($failed -join ', ')"; exit 1 }
```

**A loop that only prints its failures has not checked anything.** The first draft of this file ended
each iteration with `|| echo "FAILED: $p"`, which reports a partial move as a successful one — the same
shape as `node guard.mjs | tail -3; echo $?` reporting `tail`'s status. Both forms above end non-zero
when any entry did not move.

Then, once `README.md` is resolved, the source directory must be empty:

```sh
rmdir _skeleton          # fails loudly if anything is left behind — that is the point
git status --short       # expect renames only: R  _skeleton/… -> templates/tool/…
```

`git mv` moves **tracked** files only. Anything ignored or untracked under `_skeleton/` stays put and
makes `rmdir` fail, which is the correct outcome. Right now there is nothing to leave behind:
`git status --ignored --short _skeleton/` prints zero lines.

Use `git mv` rather than a filesystem move plus `git add`: it stages the deletion and the addition
together, which is what lets `git log --follow` and every diff view show a rename instead of 132
deletions next to 132 creations.

---

## 3. Why the move, in one paragraph

`templates/tool/` is where the scaffolding script looks for the tree it copies (§0), and a category
directory at the repository root (`Extension/`, and its future siblings) should hold products rather than
the stamp they were made from. The leading underscore is **not** the reason: Chrome's rule about
underscore-prefixed names applies to entries *inside* a loaded package, not to the name of the folder you
point "Load unpacked" at. That is measured rather than assumed — `test/browser/smoke.mjs` launches real
Chromium with `--load-extension=<_skeleton>` and `--disable-extensions-except=<_skeleton>`, and it reports
`67/67 checks passed — ALL PASS`, exit 0, against a directory whose name begins with `_`. (The rule still
matters elsewhere: a vendored shared core goes in `vendor/core/`, never `_core/`, and `_locales` is the
one underscore name Chrome permits inside a package.)

---

## 4. Baseline — what these checks said BEFORE the move

Recorded so that a red result afterwards can be attributed correctly. Measured on Node v24.18.0 at the
repository root.

| Command | Exit | Result |
|---|---|---|
| `node _skeleton/test/skeleton-sim.node.js` | **1** | 619 checks, `FAILURES: 1` — the generator does not agree `_locales/de/messages.json` is what it would write. **Pre-existing, unrelated to the move.** |
| `node _skeleton/_locales/make-locales.mjs --check` | **1** | the same `de` drift, plus three `REVIEW` notes on `uk`/`zh_CN`/`zh_TW` back-translations |
| `node _skeleton/publish/preflight.mjs` | **1** | `19 ready, 19 outstanding` — **red by design**; this is the specialisation checklist for a copy that has not become a tool |
| `node _skeleton/publish/pack.mjs` | **1** | Chrome zip written (`allowlist: 73 files = 55 locales + 18 code/assets`, 73 entries read back, 397.8 KB); Firefox package **refused**, `gecko.id is still a placeholder` — red by design ⚠️ **see the warning below** |
| `node _skeleton/icons/make-icons.mjs --check` | **0** | 4 icons, correct sizes and content boxes |
| `node _skeleton/test/browser/smoke.mjs` | **0** | `67/67 checks passed — ALL PASS` |
| `node _skeleton/tools/audit-fleet.mjs` | **0** | `tools 1 found` — `Full_Screen_Shot`, reported `UNSTAMPED` |

> ⚠️ **`pack.mjs` writes into the tree it packs.** Running it rewrites the tracked golden
> `publish/skeleton-0.0.1.zip` in place — `git status` shows the file modified afterwards. Run it on a
> scratch copy of the folder, or `git checkout -- _skeleton/publish/skeleton-0.0.1.zip` when you are
> done. A verification step that quietly edits the artifact it is verifying against destroys the next
> comparison, and the diff is a binary blob nobody reads.

Two of those reds are the design (`preflight`, the Firefox half of `pack`). One is a genuine
pre-existing defect: **`_locales/de/messages.json` is not what the generator would write.** It is not
caused by the move and is not fixed by it; regenerate it in its own change so the diff is legible.

That drift is not cosmetic. Rebuilding the Chrome package **in a scratch copy** and comparing its central
directory against the tracked golden `publish/skeleton-0.0.1.zip` gives **73 entries in both, zero
differing DOS timestamps, zero entries present in one and not the other, and exactly one differing CRC —
`_locales/de/messages.json`.** Two things follow: the packager is genuinely byte-deterministic (72 of 73
entries reproduce exactly, which is what makes "rebuild from the tag and compare" a real check rather
than a hope), and the working tree's German catalogue no longer matches the one inside the last package
built from it.

**The two new files were tested against this baseline before being committed.** With
`templates/tool/README.md` and `templates/tool/tool.json` copied into a scratch clone of the tree:
`skeleton-sim` reports the identical single failure, `preflight` reports the identical
`19 ready, 19 outstanding` — including item 17, *"README.md has been rewritten for this tool — still
opens with the skeleton's own first sentence"* — and `pack` still lists `73 files`, so neither new file
can reach a store package.

---

## 5. ⚠️ The one collision: `README.md` — resolved as **option B**

> **Decided and executed.** `templates/tool/README-tour.md` is `_skeleton/README.md` under its new name,
> tracked; `templates/tool/README.md` is the stamping guide. Both files exist, nothing was discarded, and
> the guard sentence below survived — `README-tour.md:1` still opens with *"the starting point for every
> tool in this family"*, and so does the stamping guide. The table is kept because the constraint that
> picked the option is permanent.

`_skeleton/README.md` and the new stamping guide both wanted `templates/tool/README.md`. **Nothing was
overwritten** — `git mv` refuses a destination that exists unless forced, so the move would have failed
loudly rather than quietly discarding one of them.

**The constraint that binds every option**, discovered by reading the guard rather than assumed:
`publish/preflight.mjs` grades *"README.md has been rewritten for this tool"* by testing whether the
file still contains the sentence **"the starting point for every tool in this family"**. Whatever ends
up at `templates/tool/README.md` must still contain that sentence, or the template's own README reports
green — and every tool copied from it inherits a check that has silently stopped checking.

| Option | Effect |
|---|---|
| **A — merge (recommended)** | Fold the stamping guide into the existing README and keep one file. Largest, most complete document; the two overlap on "copy, never link" and on the identity rules. |
| **B — keep both** | `git mv _skeleton/README.md templates/tool/README-tour.md` and leave the new file as `README.md`. Nothing is lost; the tour is one hop away. `.md` files never enter a package, so this adds nothing to any zip. |
| **C — supersede** | `git rm _skeleton/README.md`. Cheapest, and it discards a document no test grades — which is exactly why nothing would tell you later that it was worth keeping. |

The new file was written to make A and B both easy: it is short, it opens with the sentence the guard
looks for, and it defers the full procedure to `TEMPLATE.md` rather than restating it.

---

## 6. ⚠️ What the move broke that git did not notice — **fixed, and here is why the obvious fix was wrong**

> **Status: resolved in `templates/tool/tools/audit-fleet.mjs`.** Both resolutions below landed, and the
> section is kept because the *marker* half of it is a trap anyone repointing a walk in this repository
> can still fall into. Re-measure in one line: `node templates/tool/tools/audit-fleet.mjs` → `tools 1
> found`, `1 unstamped`, exit 0; and `TOOLS_REPO_ROOT=<repo>/templates node …` → `BROKEN AUDIT —
> discovery found no tool directory`, **exit 1**.

**`tools/audit-fleet.mjs` stopped finding any tools — and exited 0 while doing it.**

It located the fleet by walking from its own position: `path.dirname(SKELETON)`, i.e. the template's
parent directory, then that directory's children and grandchildren, collecting anything containing a
`manifest.json` and skipping the template itself. From `_skeleton/tools/` that walk started at the
repository root and found `Extension/Full_Screen_Shot`. From `templates/tool/tools/` it started at
`templates/`, whose only child is the template — which the script deliberately skips.

Measured, not predicted. A scratch tree with the script at `templates/tool/tools/audit-fleet.mjs` and a
tool at `Extension/Full_Screen_Shot/`:

```
before   tools       1 found      →  UNSTAMPED  Full_Screen_Shot                      (exit 0)
after    tools       0 found      →  0 current · 0 behind · 0 diverged · 0 unstamped   (exit 0)
```

A drift audit that reports "nothing has drifted" because it looked at nothing is the failure this corpus
keeps meeting: the check does not break, it stops checking, and the output looks like good news.

**Resolutions. 1 and 2 were both required; they were never alternatives, and both have landed.**

1. **Repoint the walk.** The walk root became the repository root instead of the template's parent,
   keeping the "named, not positional" spirit the script already documents — find the root by a marker
   rather than by counting `..` segments. **The marker has to be one the template does not ship.** The
   landed code ascends for **`.git`**, which every clone has by definition; `scripts/lib/toolinfo.mjs`,
   or `scripts/` plus `.githooks/`, would serve equally and are root-only for the same reason.

   ⚠️ **`README.md` and `.gitignore` are disqualified, and this section used to name the first of them.**
   `templates/tool/` ships both (§1.1 entries 1 and 6, and §5), so an ascent from `templates/tool/tools/`
   that accepts either stops at `templates/tool` — the same wrong root, reached by following this
   section's own earlier advice. Measured on the tree, running each candidate ascent and then feeding its
   result to the walk:

   ```
   marker set                    ANY-of match                ALL-of match
   .git, README.md               templates/tool → 0 tools    repo root → 1 tool
   README.md                     templates/tool → 0 tools    templates/tool → 0 tools
   .gitignore                    templates/tool → 0 tools    templates/tool → 0 tools
   .git                          repo root      → 1 tool     repo root → 1 tool
   scripts/lib/toolinfo.mjs      repo root      → 1 tool     repo root → 1 tool
   scripts + .githooks           repo root      → 1 tool     repo root → 1 tool
   ```

   Read the first row carefully: `(.git, README.md)` survives only if the implementer happens to require
   **both** markers in the same directory. Written as a parenthetical list, it reads as *either*, which is
   the reading that returns `templates/tool` and zero tools. A marker set whose correctness depends on
   which way a reader parses a comma is not a specification.

   There is an explicit override too — `--repo-root <dir>` and `TOOLS_REPO_ROOT`, the two names
   `scripts/lib/toolinfo.mjs` already honours — and when **no** marker is found, which is exactly what a
   tool folder checked out on its own looks like (`Extension/Full_Screen_Shot` has no `.git` of its own),
   the script now fails and asks for explicit tool paths. It no longer falls back to
   `path.dirname(SKELETON)`; that fallback *was* the bug.
2. **The assertion that would have caught it** — the script fails, rather than passes, when it finds zero
   tools and none were named on the command line. Every scanner in this family needs a test that it is
   still scanning what it thinks it is; this one had none, which is why the move could have silenced it
   in a commit that looked like a rename. **It was never an alternative to 1.** Any marker scheme is
   guessable by the next reorganisation; the zero-tools assertion is the part that makes the next
   silencing loud instead of cheerful. Negative-tested by pointing the root at a directory with no tools
   under it: `tools 0 found` now prints `BROKEN AUDIT — discovery found no tool directory … nothing was
   scanned.` and exits **1**.
3. **Interim, no code change** — passing the tools explicitly, which the script supported all along and
   which was verified working from the new location:
   `node templates/tool/tools/audit-fleet.mjs Extension/Full_Screen_Shot` → `tools 1 found`. Still the
   right move for a fleet with no `.git` above it.

The script's own header carries the same measurement and names `.git` as the marker, so the code and this
section say one thing. **If a future repoint is tempted by `README.md` because it is "always at the
root", the table above is the reason not to** — it is at the root of the template too.

---

## 7. References to `_skeleton` elsewhere in the repository

Prose and comments naming the old path. None of them break the build; all of them mislead a reader after
the move. **Match on the text, never on a line number** — a line number is a pointer into a file other
people edit, and nothing recomputes it.

| File | What it says | Action |
|---|---|---|
| `README.md` (root) | `_skeleton/            the template a new extension is stamped from` | repoint to `templates/tool/` |
| `docs/ARCHITECTURE.md` | 11 lines name `_skeleton`: **nine** capability-table rows cite `_skeleton/publish/…` (six), `_skeleton/test/…` (two) and `_skeleton/tools/…` (one) | repoint each path |
| `docs/ARCHITECTURE.md` | one further row — *"Scaffolding a new tool \| `_skeleton/`, copied **by hand** \| No `new-tool.mjs`. `templates/tool/` holds the contract file, not a full stamp."* | **already stale in two ways**: `scripts/new-tool.mjs` now exists, and `templates/tool/` exists but is not yet a full stamp. Rewrite it after the move rather than repointing it |
| `docs/ARCHITECTURE.md` | one line of prose: *"FullShot and the template do not share a packager. FullShot predates `_skeleton` …"* | this one names the template as a *thing*, not a path — leave it or reword deliberately |
| `PRINCIPLES.md` | seven citations of `_skeleton/publish/…` (six under an **Enforced by** heading, one in prose about the allowlist) | repoint each path |
| `scripts/new-tool.mjs` | the template precedence and its explanatory header both name `_skeleton` | **do not repoint** — it must keep naming both, and the fallback is what makes §0 recoverable |
| `core/core.json`, `core/v1/{settings,storage,jobs}.js` | `promotedFrom: "_skeleton/lib/<file>.js"` (three) and `Source: _skeleton/lib/<file>.js` (three) | these are **provenance**, not live paths: either repoint them or mark them "path as of promotion". Decide once and do the same in all six places |

**Do not run a blanket find-and-replace inside the moved tree.** Its own documents and tests are coupled
by literal text: `test/skeleton-sim.node.js` asserts that `TEMPLATE.md` contains the phrase
*"RED in `_skeleton` itself, and that is correct"*, so rewording that sentence turns the node tier red.
The occurrences inside `templates/tool/` name *the template as a thing*, not a filesystem path, and most
of them are correct as they stand — `skeleton.json`, `CHANGELOG-skeleton.md` and the `slug: "skeleton"`
identity signal all keep their names. Change them, if ever, in a dedicated commit with the sim green
before and after.

---

## 8. What the move does **not** change

- **Every script inside the folder.** All of them resolve paths from their own location
  (`path.resolve(HERE, '..')`, `path.join(__dirname, '..', '..')`); `tools/audit-fleet.mjs` in §6 is the
  only one that walks *outside* the folder.
- **`test/browser/smoke.mjs` finding Playwright.** It walks up from its own directory looking for a
  directory *named* `_playwright`, not for a fixed number of levels, so the repository root remains
  reachable from the new depth.
- **What is tracked and what is ignored.** `publish/skeleton-0.0.1.zip` stays tracked: the root
  `.gitignore` deliberately does not ignore `**/publish/*.zip`, because each release zip is the golden
  master the next build is diffed against. No ignore rule in the repository matches `templates/`.
- **The packaged output.** `pack.mjs` builds from the folder it lives in; the zip's entries are relative
  to that folder, so the bytes it produces are identical before and after.
- **Which tools the repo-level gates see.** They walk category directories and skip `templates/`
  explicitly, so the template's own `tool.json` is graded by nothing — before the move and after it.

---

## 9. Verification, after the move

Run from the repository root. The first six must match §4 **exactly** — same exit codes, same failures,
same counts. Anything new is caused by the move.

```sh
node templates/tool/test/skeleton-sim.node.js          # expect exit 1: the one pre-existing de/ drift
node templates/tool/_locales/make-locales.mjs --check  # expect exit 1: the same drift
node templates/tool/publish/preflight.mjs              # expect exit 1: 19 ready, 19 outstanding
node templates/tool/icons/make-icons.mjs --check       # expect exit 0
node templates/tool/test/browser/smoke.mjs             # expect exit 0: 67/67 ALL PASS

# pack REWRITES the tracked golden zip — run it, then restore the file:
node templates/tool/publish/pack.mjs                   # expect exit 1: chrome zip written, firefox refused
git checkout -- templates/tool/publish/skeleton-0.0.1.zip

node templates/tool/tools/audit-fleet.mjs              # ⚠️ expect "0 found" until §6 is applied
node templates/tool/tools/audit-fleet.mjs Extension/Full_Screen_Shot   # expect "1 found"

# and the scaffolder, which is the whole point of the move (§0):
node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest --dry-run
                                                       # expect "template: templates/tool" AND ~131 files
```

And the move itself:

```sh
git status --short | grep -c '^R'                # expect 132 renames (git mv stages them as renames)
git ls-files templates/tool | wc -l              # 132 moved + tool.json + README.md = 134 on disk.
                                                 #   This counts 133 or 134 depending on HANDOFF.md:
                                                 #   .gitignore has `**/HANDOFF.md` and then a
                                                 #   `!templates/tool/HANDOFF.md` negation, so the
                                                 #   template's copy is trackable but only counts
                                                 #   once it has been staged. Everything else is 133.
                                                 #   The two new files must be `git add`ed first:
                                                 #   until then they are untracked and count 0.
ls _skeleton                                     # expect: no such directory
git ls-files _skeleton | wc -l                   # expect 0
```

Capture exit codes on their own line before printing them —
`out=$(node "$f" 2>&1); code=$?` — because `$?` read after any other command, including a command
substitution inside the same `printf` argument list, reports that command's status and turns a failing
check into a cheerful `EXIT 0`.
