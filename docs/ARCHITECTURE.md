# Architecture

How this repository fits together, and why each part is shaped the way it is.

This is a **catalogue of independently shipped MV3 browser extensions, not an application.** That one
sentence decides everything below. There is no repo-wide build step, no workspace tool, no shared
`node_modules` that an extension depends on at runtime, and no release that ships more than one
extension at a time. Each tool carries its own version, its own package, its own store listings and its
own release.

Two consequences worth stating plainly, because they are constraints rather than preferences:

- **Clone and load unpacked has to work.** A contributor points `chrome://extensions` at a tool
  directory and it runs. Anything that breaks that — a bundler, a codegen step, a dependency install —
  is a per-tool opt-in with a written reason, never a repo-wide decision.
- **Nothing shared may be *linked*.** The unit of delivery is a zip containing one directory. Shared
  code has to be *inside* that directory when the zip is built, so shared code is copied. The rest of
  this document is largely about making a copy auditable instead of assumed.

---

## 1. Naming

| Identifier | Form | Example | Used by |
| --- | --- | --- | --- |
| Category directory | `Capitalized_Singular` | `Extension/` | filesystem only |
| Tool directory | `Title_Snake_Case` | `Full_Screen_Shot/` | filesystem only |
| **Tool id** | `lowercase-kebab` | `fullshot` | tags, zip filenames, CI matrix, artifact names |
| Product name | free text | `FullShot` | manifest, store listings, README |

**A category is a delivery surface, not a product theme.** `Extension/` is where things that install
into a browser live. A surface determines the toolchain, the package format and the store target, and
it does not change. Themes ("capture", "privacy", "productivity") change whenever the marketing does,
and re-categorising breaks every path, tag and store reference that pointed at the old one. So one flat
`Extension/` directory is correct; sub-foldering it by theme is not.

**The tool id — not the directory — is the stable public handle.** Directories can be renamed. Ids
cannot: they appear in tags, in package filenames and in artifact names, and a rename orphans all of
them. Choose the id once, when the tool is created.

**Casing is load-bearing.** Git on Windows is case-insensitive by default; Linux CI runners and
zip-entry lookups are not. `<script src="Pages/db.js">` works on a Windows machine and 404s inside the
package on a reviewer's Linux box. The package graders therefore resolve every reference **case-exactly**
and report a case mismatch as its own kind of failure, separate from "missing" — because
"not in the package" sends an author hunting for a file that is right there. If you ever rename by case
alone, set `git config core.ignorecase false` first.

---

## 2. Why shared code is vendored into each tool

MV3 has no shared-code mechanism. There is no runtime module resolver, no package manager inside the
browser, and no way for one installed extension to import from another. Everything the extension loads
must be a file inside its own package. Three obvious alternatives fail for concrete reasons:

| Alternative | Why it does not work |
| --- | --- |
| Relative imports across the repo (`../../core/v1/msg.js`) | Only files inside the tool directory are packaged. The reference resolves on disk and is absent from the zip — the exact failure the reference-integrity gate exists to catch. |
| Symlinks | Windows needs Developer Mode or admin, Git for Windows has `core.symlinks` off by default, and the unpacked loader treats them inconsistently. |
| npm workspace with a `file:` dependency | Drags `node_modules` into a runtime with no module resolver, and forces a build step to flatten it — the thing this repo is built to avoid. |

**So the copy is the design, and the discipline is around the copy.** Shared code is copied into the
tool, committed with it, and checked against its source. That buys four things worth more than the
elegance of a link: the tool directory loads unpacked with zero setup; adopting a shared change is a
visible diff in the pull request that adopts it; a tool can stay on an older shared version while
another moves ahead; and a hand-edit of a copied file is a check failure rather than a silent fork.

The admission rules for shared code — what may be copied into every tool in the first place — are in
[CORE-POLICY.md](CORE-POLICY.md).

### The vendored directory is `vendor/core/`, never `_core/`

Chrome refuses to load an extension whose package has a root file or directory whose name begins with
an underscore:

```
Cannot load extension with file or directory name _core.
Filenames starting with "_" are reserved for use by the system.
```

`_locales` is the only permitted exception. This is not a style rule and it has no workaround: the
extension does not load at all. Any vendored directory is `vendor/core/`.

**The same rule has a second, opposite edge, and it has already bitten this family once.** Because
underscore-prefixed entries are forbidden, the intuitive packaging rule is "exclude `_*`" — and that
rule silently drops `_locales/`. Once `default_locale` is declared, an extension whose default
catalogue is missing is rejected on upload, and if it were installed it would not load. So the packager
treats `_locales/` as **allowlist-always**: it enumerates the locale directories directly, outside the
pattern language that decides everything else, and unions them in unconditionally. The general pattern
rule is deliberately kept as well, and the build reports when the two paths disagree — two independent
statements of the same claim, so the bug is both impossible and visible.

### Load form: classic scripts, one namespace

Shared files are classic scripts that attach to a single global namespace, not ES modules. The reason is
that one file must load in three places with no build step:

```html
<!-- an extension page -->
<script src="../lib/settings.js"></script>
```
```js
// the Chrome service worker
if (typeof importScripts === 'function') importScripts('lib/settings.js');
```
```jsonc
// the Firefox event page loads the same files through the manifest
"background": { "scripts": ["lib/settings.js", "lib/storage.js", "lib/jobs.js", "background.js"] }
```

Note the guard in the second block. Firefox runs `background.scripts` as event-page scripts, where
`importScripts` is undefined; calling it unguarded throws at load and the add-on is dead. The guard
belongs in the `background.js` **source**, not in a build step that patches the Firefox package —
otherwise the Firefox package is a hand-patched artifact rather than a build output, and one source
tree no longer serves both engines.

---

## 3. The scripts are the gate

A gate here is a plain Node script with **no dependencies**, runnable with the same command on a
developer's machine and on a runner. Five properties make them worth trusting:

1. **They grade the artifact, not the intention.** The package graders read entries back out of the
   finished zip rather than trusting the file list the builder meant to write. "The list and the archive
   disagreed" is the entire class of bug they exist for.
2. **The zip is graded, not the folder.** Every other check reads the working tree — the node sims, the
   browser smoke run, and the developer, who loaded the tree too. A file that loads unpacked and 404s
   inside the archive is invisible to all three.
3. **The file list is a positive allowlist.** Only files the browser loads are packaged, pinned per
   directory. A stray `.md` dropped into `pages/` cannot ride along, because nothing but `.html`, `.js`
   and `.css` from `pages/` ever could. This matters more than tidiness: test fixtures in this family
   deliberately contain network APIs and an exfiltration-shaped URL, inside items whose listing claim is
   that they make no network calls. An automated scan finding those in a package is a malware referral,
   not a warning.
4. **A refusal beats a bad artifact.** The packager refuses to *write* when the localisation gate fails
   or when the Firefox add-on identity is still a placeholder, rather than writing and warning. A file
   that exists is a file somebody uploads at 11pm, and an unshippable zip written over the last good one
   is not something an exit code can undo.
5. **Every gate has a recorded failing case.** An assertion that cannot fail is worse than none — it
   inflates apparent coverage. If you cannot write the input that makes a check go red, delete it or
   re-point it.

The privacy claim is one of these gates rather than a sentence in a README: no packaged script may
reach the network, and the graders scan packaged scripts for network APIs. Extensions in this
repository collect no analytics, and that is checkable from the artifact.

### What exists today

A status table dates instantly, and a stale one is worse than none — it gets read as current. So each row
below names **where the authority is**; the snapshot is only the last column. Verified against the tree on
**2026-08-14**, while several of these were actively being written. Re-derive before relying on any of it.

| Capability | Where it lives / who decides | Status, 2026-08-14 |
| --- | --- | --- |
| Deterministic packager, positive allowlist, both targets | `templates/tool/publish/pack.mjs` | Real, runnable |
| Package grader (case-exact references, leaks, network scan, locale completeness, version parity, previous-release diff) | `templates/tool/publish/verify-package.node.js` | Real, runnable |
| AMO submission gate (gecko id, data-collection declaration, background fallback, Chrome-only keys) | `templates/tool/publish/verify-firefox-package.node.js` | Real, runnable |
| Version bump across every version site | `templates/tool/publish/bump-version.mjs` | Real, runnable |
| Specialisation gate ("has this copy become a tool yet?") | `templates/tool/publish/preflight.mjs` | Real, runnable, red by design in the template |
| Listing screenshots at store-legal dimensions | `templates/tool/publish/shots.mjs` | Real, runnable |
| Node simulation tier and harness | `templates/tool/test/skeleton-sim.node.js`, `templates/tool/test/harness.js` | Real, runnable |
| Real-browser smoke tier | `templates/tool/test/browser/smoke.mjs` | Real, runnable |
| Pixel simulation (fake DOM, canvas2d, PNG encoder) | `Extension/Full_Screen_Shot/test/pixel-sim/` | Real, runnable |
| Drift audit across stamped tools | `templates/tool/tools/audit-fleet.mjs` | Real, runnable |
| A tool's own packager | `Extension/Full_Screen_Shot/publish/package.node.js` | Real, runnable — **an older, separate implementation from the template's** |
| The shared runtime | `core/` — and `core/core.json` is its own status file, module by module | **Partial, v0.1.0.** Three files are in `core/v1/`, but only **one of the eleven specified** modules; the other two were never on the list. Every one was promoted from code that already ran. `core/test/` holds no sims. See [CORE-POLICY.md](CORE-POLICY.md#5-status-what-exists-today). |
| The vendored copy inside a tool | `<tool>/vendor/core/` | **Absent everywhere.** There is no `vendor/` directory in the tree at all, so the hash gate that makes a copy honest is not yet exercised by anything. |
| Repo-level gates | `scripts/`, and the header comment of `.github/workflows/ci.yml` is the authoritative list of what CI requires | **Incomplete, landing.** A script that header names and CI cannot find fails the job on purpose — there are no `if [ -f … ]` guards, because a workflow that skips its own absent gates is a green build that checked nothing. `ls scripts/` answers "which exist". |
| The per-tool contract | `Extension/Full_Screen_Shot/tool.json`, `templates/tool/tool.json` | Written; **not yet consumed end to end** (§5). |
| Scaffolding a new tool | `scripts/new-tool.mjs`, stamping from `templates/tool/` | Real, runnable. `templates/tool/` is the full 132-file stamp since the move recorded in `MIGRATION.md`; copying by hand still works. |
| CI | `.github/workflows/` (`ci`, `release`, `e2e`), the issue forms, `.githooks/pre-commit` | Present and **not green**: the workflows call `scripts/*.mjs` gates that are still landing, and no tag exists, so `release.yml` has never run. |

**FullShot and the template do not share a packager.** FullShot predates the template and carries its own
`publish/package.node.js` with the same design and a different implementation. Two implementations of
one rule is a real divergence, not a nuance: a fix applied to one is not applied to the other. Treat
convergence as work that has not happened yet.

### ⚠️ APPENDED CORRECTION — 2026-08-25

**The table above is not edited.** It is a dated snapshot, it says so, and it tells you to re-derive
before relying on it. This is the re-derivation, run on 2026-08-25. Rows it does not name still stand.

- **"Repo-level gates … *Incomplete, landing*" is false.** The row names the right authority — the
  `gate-inventory` job derives the set from the workflow files rather than from prose — so run what it
  runs. From the repo root:

  ```bash
  grep -rhoE '(scripts|Extension/[A-Za-z0-9_]+/publish)/[A-Za-z0-9][A-Za-z0-9._/-]*\.(mjs|node\.js)' \
    .github/workflows | sort -u
  ```

  → **17** paths, and every one of them is a file on disk: **0 ABSENT**. Sixteen live under
  `scripts/` and the seventeenth is
  `Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js`. **Do not subtract 16 from 18**
  — only **15** of those sixteen are `scripts/*.mjs`; the sixteenth is `scripts/test/selftest.node.js`,
  which is not a `.mjs`. Against `ls scripts/*.mjs` → **18**, that leaves **three** scripts no workflow
  calls, and they are `scripts/gen-catalog.mjs`, `scripts/new-tool.mjs`, `scripts/sync-core.mjs`
  (`comm -23` of the two sorted lists, re-measured **2026-08-25**). `grep -n` over
  `.github/workflows/*.yml` returns **0** lines for `gen-catalog.mjs`, **0** for `sync-core.mjs`, and
  **6** for `new-tool.mjs` — four `#` comments in ci.yml, one `//` comment inside e2e.yml's inline
  `node -e` script, and one `echo` message string. Not one of the six is an invocation. ci.yml states
  that third case itself, in the comment beginning "`new-tool.mjs` IS WRITTEN WITHOUT ITS `scripts/`
  PREFIX HERE AND BELOW": writing it with the prefix "took the inventory from 17 entries to 18,
  adding a script no workflow invokes". Nothing in the inventory is "landing" any more. What the
  row's *reasoning* got right and what must not be softened: a script the
  header names and CI cannot find still fails the job on purpose, and there are still no
  `if [ -f … ]` guards.

- **"The per-tool contract … *Written; not yet consumed end to end*" is false** — see the corrected
  §5 below. `pack.mjs`, `verify-refs.mjs`, `run-tests.mjs` and `discover.mjs` all read `tool.json`, and
  all four exited **0** on 2026-08-25.

- **"CI … *Present and not green*" is half false.** The half that has moved: the workflows no longer
  "call `scripts/*.mjs` gates that are still landing" — see the inventory above. The half that is
  still true, re-measured: `git tag | wc -l` → **0**, so `release.yml` has still never run.

- **"A tool's own packager … Real, runnable" is still true, and it is green again today.**
  `node publish/package.node.js` (full build, run in a scratch worktree so no zip lands in `publish/`)
  exits **0** with `ALL PASS — packaging + reference integrity` and `85 files` byte-identical to the
  tree for both targets. It had been red since 2026-08-20 on one limb —
  `Chrome package keeps the plain importScripts calls` — whose column-0 regex stopped matching when
  `background.js` gained the Firefox guard and the call moved two columns right. The **assertion** was
  what had moved, not the zip; it is now indent-tolerant and pinned against four mutant sources in
  `Extension/Full_Screen_Shot/test/i18n-sim.node.js`.

- **"The vendored copy inside a tool … *Absent everywhere*" is still true.**
  `ls Extension/Full_Screen_Shot/vendor` → `No such file or directory`.

---

## 4. The template is a stamp, not a library

A new tool is made by copying the template directory and specialising it. Copying is the only mechanism
available — see §2 — so the discipline is entirely in what the copy records and what a script can check
afterwards:

- **Provenance is stamped at copy time.** `skeleton.json` records which template version the tree came
  from, which tool it became, and when. Retro-stamping is guesswork: by then the copies have diverged
  for good reasons and accidental ones, and telling them apart means reading the inherited test code in
  every tool.
- **The inherited set is declared.** `skeleton.json` lists the files a tool is expected *not* to edit.
  Editing one is allowed — it just has to be a decision somebody can see, rather than many copies
  quietly diverging. `tools/audit-fleet.mjs` reads that list across tools and reports what has drifted.
- **The template is red on purpose.** `preflight.mjs` answers "has this copy actually become a tool
  yet?", so in the template itself every item is outstanding. It is not part of the all-green set, and
  it must never be added to it.
- **A stamped copy is not a shippable listing.** Identical descriptions and screenshots across listings
  fail Microsoft's distinct-metadata rule, and identical copy is a stamped portfolio's *default output*
  rather than an accident that might happen. Differentiation is a required step, not polish — see
  [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md).

---

## 5. Where a tool's contract lives

The architecture calls for one file per tool — `tool.json` — as the entire coupling surface between a
tool and the repo: id, package allowlist, targets, tests, permission justifications and an empty network
allowlist that makes the privacy claim machine-readable. **The file exists for FullShot, and it is read
end to end.** ⚠️ **CORRECTED 2026-08-25** — this passage used to say *"Nothing reads it end to end yet —
the gates that would consume it (`pack`, `verify-refs`, `run-tests`) are the part still landing. Treat it
today as a written contract with no enforcement behind it"*, and it ends with *"check `scripts/` before
assuming otherwise"*, so here is that check, run bare on 2026-08-25 with the exit code on its own line:

| Command | Exit | What it printed |
| --- | --- | --- |
| `node scripts/pack.mjs fullshot --target firefox --out <scratch> --release` | **0** | `6 passed`; `85 file(s) selected by package.include/exclude: 55 locale catalogue(s) + 30 code/assets` |
| `node scripts/verify-refs.mjs --zip <scratch>/fullshot-firefox.zip --strict --leaks` | **0** | `4 passed · 1 warning(s)` |
| `node scripts/run-tests.mjs fullshot` | **0** | `12 passed` — the subject set it ran is `tests` in `tool.json` and nothing else, which is the rule stated at `scripts/run-tests.mjs:10` (a source comment, not output: `grep -c 'subject set'` over this run's stdout+stderr → **0**) |
| `node scripts/discover.mjs` | **0** | `tools on disk: fullshot` — the CI matrix is globbed out of `*/*/tool.json`, so the contract file is what decides which jobs exist at all |

The enforcement is real. What the passage got right and what still holds: where the code and a
`tool.json` disagree, the code is what ships, so the contract file is the thing to correct.

Two properties of it are worth knowing before writing the second one:

- **It was filled in from the tree, not from the plan.** Where a planning document and the shipped
  artifact disagreed, the artifact won and the disagreement is recorded in the file rather than smoothed
  over. Its package list was checked against the 85 entries of the zip that actually shipped.
- **It carries an `absent` block.** A tool records what the architecture names and it does not have.
  ⚠️ **CORRECTED 2026-08-25** — this bullet used to name three examples, *"no `CHANGELOG.md`, no
  vendored core, a Firefox manifest that is a full second manifest rather than an overlay"*, and
  **only the middle one is still true**:
  - `CHANGELOG.md` **exists** — `wc -c Extension/Full_Screen_Shot/CHANGELOG.md` → **12874** bytes, top
    entry `## [1.10.2] — 2026-08-15`; `node scripts/check-version.mjs fullshot` EXIT **0**, `3 passed`.
  - **No vendored core** — still true. `ls Extension/Full_Screen_Shot/vendor` → `No such file or
    directory`.
  - The Firefox manifest is **not a second manifest**: it is an RFC 7386 merge patch, converted on
    2026-08-15 (`1c2c082`, 532 bytes) and **511** bytes in its present shape since 2026-08-18
    (`088b4e3`). `check-version.mjs` prints `publish/manifest.firefox.json is an overlay — it does not
    restate the version, so it cannot drift from it`.

  Both retired entries were removed from `tool.json`'s `absent` block on 2026-08-22 and the removal is
  recorded in its `NOTES.corrections`; a third, `absent.README`, was removed on 2026-08-25 the same
  way. The principle is unchanged and is why the block is worth keeping: **a stale absence is the same
  lie pointing the other way**, so an entry is deleted the day the real thing lands. A gap that is
  written down can be read as a gap; a plausible stub cannot.

Three other files hold the rest of a tool's facts:

| File | What it owns |
| --- | --- |
| `manifest.json` | The version. The single source of truth; the AMO manifest and the CHANGELOG follow it. |
| `publish/identity.json` | The facts that appear in more than one place: slug, owner domain (the Firefox add-on id is derived from it), support email, hosted privacy-policy URL. Every publish script reads them from here so they cannot be typed twice and drift. ⚠️ **CORRECTED 2026-08-25** — this cell used to read *"Template-side only — FullShot has none, which is part of why its publish scripts are a different set."* FullShot **has one**: `wc -c Extension/Full_Screen_Shot/publish/identity.json` → **2476** bytes, and it is what the Firefox add-on id is derived from — `policy-check.mjs` prints `the Firefox add-on id is set — fullshot@nikatru.com -- and agrees with publish/identity.json` (EXIT **0**). The publish scripts being a different set is still true, for the reason in §3, not for this one. |
| `skeleton.json` | Provenance and the inherited-file list (§4). |

The package allowlist, the permission justifications and the network prohibition are also stated in code
and prose (`pack.mjs`, `publish/package.node.js`, `publish/STORE-LISTING.md`, the graders). Where those
and a `tool.json` disagree, the code is what ships — so the contract file is the thing to correct, not
the evidence.

---

## 6. Reading order

- Releasing a version: [RELEASING.md](RELEASING.md)
- Getting a package in front of a store reviewer: [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md)
- Deciding whether something may become shared code: [CORE-POLICY.md](CORE-POLICY.md)
