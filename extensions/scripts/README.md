# `scripts/` — the repo's gates

Node only. **Zero npm dependencies, forever.** Nothing here is ever shipped inside an extension.

Every gate **in this directory** is a plain `node scripts/<name>.mjs` call, so **the command CI runs
is the command you run** on Windows in PowerShell. There is no wrapper, no task runner and no config
file to keep in sync.

> **That is a claim about `scripts/`, and it is not a claim about the workflows.** "CI is only a
> scheduler" used to stand here unqualified and it was never quite true: `grep -c 'shell: bash'
> .github/workflows/ci.yml` is not zero, and each of those blocks is inline bash — a `for` loop, a
> `[ -d ... ]` guard, a double-pack digest comparison — that no PowerShell prompt reproduces. It
> also runs one thing that is not a `scripts/` gate at all: `npx --yes web-ext@8 lint`, the only npm
> dependency in the gate workflows — which is why the "zero npm dependencies" line above says *here*
> rather than *anywhere*. (`grep -nE 'npx|npm ' .github/workflows/*.yml`, 2026-08-22: `web-ext@8` in
> `ci.yml` and `release.yml`, plus `npm ci` and `npx playwright install` in the separate, non-blocking
> `e2e.yml`.) Collapsing those blocks into `scripts/` gates is open work; until it happens the honest
> form is this one — *every gate is a script call, and the workflows contain more than gates.* Stated
> 2026-08-22 with the grep rather than a count on purpose: that count moved while this paragraph was
> being written.

```powershell
node scripts/discover.mjs                    # which tools exist / which the diff touched
node scripts/lint.mjs        fullshot        # node --check every shipped .js/.mjs
node scripts/policy-check.mjs fullshot       # privacy · permissions · store limits
node scripts/check-version.mjs fullshot      # manifest == CHANGELOG top == tag
node scripts/check-core-sync.mjs fullshot    # vendor/core matches core/
node scripts/test/selftest.node.js           # do the gates above actually bite?
```

## Conventions every script here follows

**Three exit codes, and the middle one is the point.**

| Code | Meaning |
|---|---|
| `0` | the gate ran, and everything it checked passed |
| `1` | the gate ran, and something it checked **failed** |
| `2` | the gate **could not run** — bad usage, missing file, unparseable input |

A script that cannot run never exits `0`. *Silence is not success*: a scanner that quietly stops
scanning still prints clean, CI still goes green, and nothing surfaces until the thing it guarded is
already broken.

**A tool is named by id or by path.** `fullshot` and `Extension/Full_Screen_Shot` resolve to the same
tool. CI passes the id, because the id is the stable public handle — tags, zip names and artifact names
are all built from it — while a human at a prompt has just tab-completed the path.

**`--repo-root <dir>` works on every script.** It is how `test/selftest.node.js` points the gates at a
synthetic tree. A guard you can only run against the real repo is a guard you can only negative-test by
breaking the real repo.

**A mistyped flag is refused, not ignored.** `--warings-as-errors` exits 2 rather than silently leaving
strict mode off.

**Four verdicts, and only one is fatal by default.** `PASS` · `FAIL` (exit 1) · `WARN` (printed) ·
`OWNER` (a gap only the owner can close — a domain to buy, a listing to create). Owner actions print on
every run and never fail the build unless `--owner-actions-fatal` is passed. A build permanently red on
work only one person can do teaches everyone that red is negotiable.

---

## What is here

| Script | Does | Notes |
|---|---|---|
| `discover.mjs` | globs `Category/Tool/tool.json` → the CI matrix, diff-aware | emits **ids**. Every ambiguity widens to ALL tools |
| `lint.mjs` | `node --check` on every shipped `.js`/`.mjs` | also accepts `core` and `scripts`. Fails when it checks **zero shipped files** |
| `policy-check.mjs` | the eight gates of the architecture's §4.3 | strips comments and strings before scanning; see below |
| `check-version.mjs` | manifest == CHANGELOG top == tag | delegates to the tool's own `publish/bump-version.mjs --check` when it has one |
| `sync-core.mjs` | `core/<channel>` → `<tool>/vendor/core` + hashes | refuses to write over strays; refuses an unsatisfiable pin |
| `check-core-sync.mjs` | fails if a tool's `vendor/core` drifted | compares file ↔ core ↔ recorded hash; names CRLF-only drift as such |
| `gen-catalog.mjs` | rewrites the README table from `tool.json` files | writes only between `<!-- CATALOG:START -->` / `<!-- CATALOG:END -->` |
| `new-tool.mjs` | stamps `templates/tool` (or `_skeleton`) → `Category/Tool_Name` | never writes into an existing directory |
| `publish-catalog.mjs` | derives `catalog/extensions.json` from the `tool.json` files | `--check` compares **bytes**; a UTF-8 BOM is refused on the raw buffer |
| `check-catalog.mjs` | grades that catalogue as a contract | an unlisted tool is an `OWNER` line, not a failure |
| `check-store-metadata.mjs` | one directory per **store**; limits measured on the resolved translation | an unsourced limit is refused, never invented |
| `check-store-packages.mjs` | grades the **built** store package, not the source it came from | reads one entry through `lib/zip.mjs` |
| `pack.mjs` | `<id> --target <chromium\|firefox> --out <dir> [--release]` → `<dir>/<id>-<target>.zip` **and** `<dir>/unpacked-firefox/` | deterministic: sorted entries, fixed DOS timestamp, fixed deflate level. Refuses an `--out` inside the source tree |
| `verify-refs.mjs` | `--zip <path> [--strict] [--leaks]` — reference integrity **on the zip**, case-exact | the two flags name two families and neither implies the other |
| `run-tests.mjs` | runs exactly the paths in `tool.json` `tests` | bare Node, no `npm install`, ever |
| `secret-scan.mjs` | credential shapes over everything that can be committed | tracked **plus** untracked-not-ignored — the shape a commit can still pick up |
| `sha256.mjs` | the hex digest of one file, on stdout | the determinism check diffs two builds with it |
| `changelog-section.mjs` | one version's notes on stdout, for the release body | warns when the version asked for is not the newest heading |
| `lib/toolinfo.mjs` | loads and validates `tool.json`; answers "what ships?" | the one loader every gate reads through |
| `lib/zip.mjs` | **reads** one named entry out of a store package | deliberately not `verify-refs.mjs`'s whole-archive reader — different question, different cost |
| `lib/report.mjs` | the pass/fail/warn/owner reporter and argv parser | not in the architecture's file list; added so the gates cannot disagree about what "failed" means. **All 18** `scripts/*.mjs` import it (measured 2026-08-22; this cell said "eight") |
| `schema/tool.schema.json` | editor autocomplete and hover docs for `tool.json` | **not** the gate — `lib/toolinfo.mjs` is. Cross-file checks are the ones that matter and no JSON Schema can express them |
| `test/selftest.node.js` | every gate **it covers**, proven to fail on a real mutation — see the coverage note below | run it after touching anything here. **The run prints its own check count — do not restate it here.** This cell asserted "90 checks" until 2026-08-22, when two runs an hour apart printed 118 and then 130 — and a fourth run at the end of that same day printed **136** |

### Two deliberate deviations from the written architecture

1. **An external `<a href>` does not fail the remote-subresource gate.** §4.3.2 words the rule as "no
   `src`/`href` in packaged HTML with an http(s) scheme", which taken literally fails the privacy-policy
   link every options page is required to carry. An `<a href>` navigates; it loads nothing into the
   extension's context. External links are **listed** in the output; every other tag — `script`, `link`,
   `img`, `iframe` — still fails. A gate that fails correct code gets switched off, and then it guards
   nothing.

2. **Store metadata limits are measured on the resolved translation, in every locale.** `name` and
   `description` are `__MSG_` placeholders, so measuring the manifest literal measures nothing. The
   limit is enforced per locale by the store, and a translation is where 132 characters gets exceeded.

---

## ABSENT — one file, and it is named

`scripts/lib/mergepatch.mjs` is the only entry in the architecture's §1.2 `scripts/lib/` list that is
not in this directory. The *algorithm* is not missing: `mergePatch()` in `pack.mjs` is RFC 7386 §2 in
full — a null member deletes, an object member merges — and the manifest-overlay merge in that same
file is its only caller. `grep -n 'mergePatch(' scripts/pack.mjs` returns three lines and no more:
the definition, one recursive call inside it, one call site (measured 2026-08-22 — the grep is the
citation, deliberately, because a line number here would rot the way six `release.yml` ones just did).
Extracting it would produce a shared module with one consumer, so it stays inline until a second gate
needs it.

> ### 🔴 CORRECTION — 2026-08-22
>
> **Until this edit, this section was a seven-row table headed "ABSENT — named, not stubbed" which
> stated that `pack.mjs`, `verify-refs.mjs`, `run-tests.mjs`, `secret-scan.mjs`, `sha256.mjs`,
> `changelog-section.mjs` and `lib/zip.mjs` "**do not exist**".** All seven are in the tree, are called
> by name from `.github/workflows/ci.yml` and `release.yml`, and were run to `EXIT 0` on 2026-08-22:
>
> | Run this session | Exit | What it printed |
> |---|---|---|
> | `node scripts/pack.mjs fullshot --target firefox --out <tmp>` | `0` | `<tmp>/fullshot-firefox.zip`, 85 entries, **and** `<tmp>/unpacked-firefox/` |
> | `node scripts/verify-refs.mjs --zip <tmp>/fullshot-firefox.zip --strict --leaks` | `0` | 53 references resolved case-exactly · 85 entries graded against 11 leak rules · 1 named WARN |
> | `node scripts/run-tests.mjs fullshot` | `0` | 12 passed |
> | `node scripts/secret-scan.mjs .` | `0` | 540 file(s) · 9 rule(s) |
> | `node scripts/sha256.mjs README.md` | `0` | the digest, and nothing else |
> | `node scripts/changelog-section.mjs fullshot 1.10.1` | `0` | 45 line(s), 2789 byte(s) on stdout |
>
> **Re-run check, 2026-08-22, after the rest of this round had landed: all six rows reproduce.** 85
> entries · 53 references, 85 entries, 11 leak rules, 1 WARN · 12 passed · the bare digest on stdout
> (the `sha256 <path> N byte(s)` banner goes to **stderr**, which is what "and nothing else" means) ·
> 45 line(s), 2789 byte(s) — that last pair is printed by the script itself, on stderr, so it is a
> quotation and not an arithmetic of mine.
>
> **One of them reproduced only on the second try, and that is worth more than the table.** Run
> earlier the same day, `secret-scan.mjs .` printed `626 file(s) · 9 rule(s)` and closed
> `subject: 540 tracked + 86 untracked-not-ignored`; run again later it printed `540 file(s) ·
> 9 rule(s)` and `subject: 540 tracked + 0 untracked-not-ignored`. (Its byte total is deliberately
> not quoted here at all: it changes with every character anyone types, including these.)
> Nothing about the gate changed. 86 uncommitted files existed in the tree for part of the round and
> then did not, and this scanner's subject is *tracked **plus** untracked-not-ignored* — the shape a
> commit can still pick up — so its total is a fact about a working tree at an instant, not about
> the repository. **`540` here is only reproducible against a clean tree.** Exit code, rule count and
> verdict never moved. Recorded rather than smoothed over, because this is the same failure as the
> six `release.yml` line numbers below in a different costume: a true number, measured honestly,
> that stops being true because something else moved underneath it.
>
> **Call sites — named, not numbered, and here is why.** This block, and the two `pack.mjs`
> paragraphs further down, first carried `file:LINE` citations — **six distinct `release.yml` line
> numbers across four places in this file**. Inside the same working day a 14-line insertion above
> them moved **all six**, so a correction written to make a record agree with the tree was
> disagreeing with it again before the day ended. That is not a fluke of this round: search
> `.github/workflows/ci.yml` for **`cite this file by line number`** and it records 23 such citations
> from six other files — `core/CHANGELOG.md`, `core/README.md`, `core/core.json`, `pack.mjs`,
> `run-tests.mjs`, `sha256.mjs` — all aimed into one ~110-line window of that workflow and all
> "ALREADY stale" — with a dated correction block underneath showing that the first attempt to say
> *how* stale got **both** of its numbers wrong.
>
> > ✅ **UPDATE, 2026-08-22, later the same day: those 23 are now fixed, and this paragraph is a
> > historical record rather than a live finding.** Every `ci.yml:NNN` / `release.yml:NNN` pointer in
> > those six files was replaced with a step name or a distinctive line of the body it describes.
> > Re-measured after that pass: `grep -rnoIE "(ci|release)\.yml:[0-9]+" --exclude-dir=.git .` returns
> > hits only inside correction records that QUOTE what the old pointer used to say. One of the eight
> > `pack.mjs` pointers was stale in substance as well as position — it described a `release.yml`
> > invocation of `pack.mjs --target chromium --release` with no `--out` that `release.yml` does not
> > make. The reason the fix is worth recording here: with no line citation left pointing into either
> > workflow, **a line may now be added near the top of `ci.yml` without invalidating anything**, and
> > that constraint had been shaping edits to that file — its header was twice rewritten "at exactly
> > its old line count" to protect pointers that were already wrong.
>
> So the citations below are **step names**, which
> `grep -nE '^\s*- name:' .github/workflows/*.yml` answers and which an insertion above cannot move:
>
> | Gate | `ci.yml` step | `release.yml` step |
> |---|---|---|
> | `secret-scan.mjs` | job `secrets-scan` — one of the two bare `- run:` steps in the file, so grep the **job** name, not a step name | `Secret scan (full tree)` |
> | `run-tests.mjs` | `Run tool sims` | `Sims` |
> | `pack.mjs` | `Build package` · `Determinism check (zip is byte-reproducible)` | `Build all store packages` |
> | `verify-refs.mjs` | `Reference integrity (inside the zip)` · `Leak check (no test/, docs, node_modules, zips, secrets)` | `Reference integrity + leak check on every artifact` |
> | `sha256.mjs` | `Determinism check (zip is byte-reproducible)` | **none** — `Checksums` shells out to `sha256sum` |
> | `changelog-section.mjs` | **none** | `Release notes from CHANGELOG` |
> | `lib/zip.mjs` | never called directly; reached through `check-store-packages.mjs` in `The BUILT store packages carry the right add-on identity` · `The built package carries the right store identity` | `The built packages are uploadable` |
>
> Measured 2026-08-22, after every other change in this round had landed: all **16** distinct step
> names above, plus the `secrets-scan` job name, return **exactly one** hit in the file each is
> credited to — so every one of them is an unambiguous address, not just a description.
>
> **Why a name and not a number — the two forms were run against the same broken tree.** Take a copy
> of `release.yml`, insert 14 padding lines at the top and rename one step, then ask each form where
> `pack.mjs` is called:
>
> ```bash
> grep -Fc -- "- name: Build all store packages" release-broken.yml   # 0 hits, exit 1
> sed -n '159p' release-broken.yml                                    # exit 0 — prints
> #   node scripts/lint.mjs ${{ steps.tag.outputs.id }}
> ```
>
> The name **goes red and says so**. The line number **stays green and hands back a different gate**
> — still a plausible `node scripts/*.mjs` line, which is precisely why nobody notices. A step name
> can of course still be renamed; the difference is that renaming one is a deliberate edit visible in
> a diff, while inserting a line above a number falsifies it silently and nothing in this repository
> recomputes it.
>
> The old table's description of `lib/zip.mjs` was wrong in a second way that outlived the first: it
> called the file a "deterministic zip **writer**". It is a **reader** — one named entry out of one
> archive. The deterministic writer is `writeZip()` in `pack.mjs`, and its header says why the two
> readers in this directory are deliberately not one.
>
> Kept as a correction rather than deleted, because *what this record claimed while the tree said
> otherwise* is the useful part: seven working gates were advertised as unwritten work.

### Packing — what the three "blockers" actually did

> **CORRECTION — 2026-08-22.** This subsection was headed *"Why packing was not rewritten, and exactly
> what blocks a wrapper"* and closed with **"So: packing stays per-tool for now."** It does not. CI has
> packed through `scripts/pack.mjs` since it was written — `ci.yml`'s **Build package** step and
> `release.yml`'s **Build all store packages** step (named, not numbered, for the reason given above).
> The three numbered obstacles below are kept **because two of them were answered by the thing that got
> built** — and the answer was not a wrapper, which is why they read as unresolved:
>
> - **(1) is still literally true and no longer relevant.** `Extension/Full_Screen_Shot/publish/` still
>   has **no** `verify-package.node.js` (measured 2026-08-22: `package.node.js` and
>   `verify-firefox-package.node.js` are the only two `*.node.js` files there — the directory also
>   holds nine `.md` / `.html` / `.json` files, eleven entries in all), so aiming `SK_ROOT` at
>   FullShot would still throw. Nothing
>   aims `SK_ROOT` at FullShot. `pack.mjs` reads `tool.json` and imports neither file.
> - **(2) is closed.** `pack.mjs` owns the mapping: it writes `<out>/<id>-<target>.zip`, and `--out` and
>   `--release` are its own flags.
> - **(3) is closed.** `pack.mjs` writes `<out>/unpacked-firefox/` as part of a build; `web-ext lint
>   --source-dir dist/unpacked-firefox` reads exactly that in `ci.yml`'s **web-ext lint (Firefox
>   only)** step and `release.yml`'s **web-ext lint** step. That release step opens with an
>   `if [ ! -d dist/unpacked-firefox ]` guard that stops the release before the lint runs, so an
>   ungraded AMO package cannot ship past a missing directory (grep the guard, not a line number).

Two per-tool packagers also exist, and they remain the record of what shipped:

- `templates/tool/publish/pack.mjs` — positive allowlist, deterministic zip (sorted entries, fixed DOS
  timestamp, fixed deflate level), an unconditional `_locales` collector that no pattern edit can
  defeat, a diff against the previous release that fails on a **dropped** file, and a refusal to write
  a Firefox package while `gecko.id` is a placeholder.
- `Extension/Full_Screen_Shot/publish/package.node.js` — the same design, older, and the one that
  actually built the shipped `fullshot-1.10.1` zips.

*The argument as it stood, kept verbatim and superseded by the correction above:* Rewriting either from
the architecture's description would replace tested code with untested code. But a thin repo-level
wrapper does not work today either, and these are the measured reasons:

1. **`templates/tool/publish/pack.mjs` reads `SK_ROOT`**, so it can be aimed at another tool — but it also
   does `require(<SK_ROOT>/publish/verify-package.node.js)` and
   `import '../_locales/package-guard.mjs'` (relative to the **script**, not to `SK_ROOT`).
   `Extension/Full_Screen_Shot/publish/` has **no** `verify-package.node.js`. Aiming `SK_ROOT` at
   FullShot therefore throws before it packs anything.
2. **The output names do not match.** The per-tool packers write
   `publish/<slug>-<version>.zip` and `publish/<slug>-<version>-firefox.zip`. `ci.yml` expects
   `dist/<tool-id>-<target>.zip` — different directory, no version in the name, and a target suffix on
   both. A wrapper has to own that mapping, and `--out` and `--release` on top of it.
3. **`dist/unpacked-firefox/` is required** by the `web-ext lint` step and neither packer produces it as
   part of a build. `pack.mjs --extract <dir> [--firefox]` gets close and is the piece to build on.

~~So: **packing stays per-tool for now.**~~ **NO LONGER TRUE — `scripts/pack.mjs` is what CI runs.** What
survives of that paragraph: `verify-refs.mjs` is the architecture's own name for the zip-side gate, and
the per-tool `verify-package.node.js` / `verify-firefox-package.node.js` implement the same algorithm —
including the check that caught a missing `background.js` before it shipped. The rest of the gates in
this directory still grade the *source tree* and stop where the zip begins.

### Also absent, and deliberately

- **The ESM shim emitter in `sync-core.mjs`.** §2.3 describes writing
  `vendor/core/esm/<mod>.js` = `import '../<mod>.js'; export const <mod> = globalThis.TX.<mod>;`.
  Not implemented: the shim must know each module's namespace object and export name, and `core/v1/`
  today holds three modules promoted from `templates/tool` that attach their own globals because
  `core/v1/ns.js` **does not exist**. Generating those files would mean importing a symbol nothing ever
  assigns. It returns when `ns.js` is real.
> **CORRECTION — 2026-08-22.** Two further bullets stood here and both named gaps that are closed:
>
> - **"`core/test/`."** — *"`core/core.json` declares this gap itself."* It declares the **closure**:
>   `core/core.json` carries it in its `gaps` array — grep the string `CLOSED 2026-08-15 —
>   core/test/ now holds a sim per shipped module`, one hit, no line number needed. Measured
>   2026-08-22: `core/test/` holds `settings.node.js`, `storage.node.js`, `jobs.node.js`, `harness.js`
>   and `coverage.node.js` — one sim per shipped `v1/` module, plus the counter that fails when a fourth
>   module lands without one.
> - **"The `CATALOG` markers in the root `README.md`."** — *"Adding them is a one-time manual edit; until
>   then the catalog table is hand-maintained."* They are there — `grep -n 'CATALOG:' README.md`
>   returns the `<!-- CATALOG:START -->` / `<!-- CATALOG:END -->` pair, around the FullShot row.
>   `node scripts/gen-catalog.mjs` → `EXIT 0`, "README.md catalog is up to date — 1 tool(s)". The table
>   is generated, not hand-maintained, and a hand edit to it is now a red build.

---

## `test/selftest.node.js`

```powershell
node scripts/test/selftest.node.js          # every gate, twice: correct tree, then one mutation
node scripts/test/selftest.node.js --keep   # leave the fixtures on disk to poke at
```

It builds a real tool tree in the OS temp directory — real PNG icons copied out of `templates/tool`, a real
manifest, a real locale catalogue — runs the gates it covers, then **breaks exactly one thing** and runs
them again. Every assertion comes in a pair: the gate passes on a correct tree and fails on one specific
mutation, with a message that names the problem.

**🔴 IT DOES NOT COVER EVERY GATE, AND THE GAP IS THE ZIP-SIDE HALF.** Measured 2026-08-22 with

```bash
for g in scripts/*.mjs; do n=$(basename "$g"); echo "$n $(grep -c "$n" scripts/test/selftest.node.js)"; done
```

— **10 of the 18 gate scripts in `scripts/` are named in it**. The eight it never invokes are `pack.mjs`,
`verify-refs.mjs`, `run-tests.mjs`, `secret-scan.mjs`, `sha256.mjs`, `changelog-section.mjs`,
`publish-catalog.mjs` and `check-catalog.mjs` — which is, almost exactly, the set this README used to
call ABSENT. They were written and wired into CI; the negative halves were not written with them. Every
one of the eight was run green by hand on 2026-08-22 (see the correction above), and *a gate that has
only ever been run against a correct tree is a gate nobody has proven bites.* Re-derive the count rather
than trusting this paragraph: on 2026-08-22 alone it read 90, then 118, then 130, then **136** — and
136 is only the number that was true when this sentence was last touched.

*An assertion that cannot fail is worse than none* — it inflates apparent coverage. If you add a gate
here and cannot write the mutation that makes it red, the gate is not real.

Four bugs in these scripts were found by running them, and are recorded as cases in that file:

- `lint.mjs` reported a pass over a tool whose entire shipped surface had fallen out of
  `package.include`, because the tests named in `tool.json` still put one file in the set. Shipped
  files are now counted separately.
- A malformed manifest version was a `tool.json` **contract** error, so every gate exited `2` and the
  one script whose job is version agreement could not report it. Content moved to the gates that own it.
- `__MSG_@@bidi_dir__` was demanded of `messages.json`. It is one of Chrome's **predefined** messages and
  is never there. Found only by running against the real FullShot tree.
- `__MSG_` keys quoted in **comments** — FullShot's `pages/batch.js` documents why an inline `<style>`
  cannot pick one up — were treated as unresolved references. A gate red on its own documentation is a
  gate somebody disables.
