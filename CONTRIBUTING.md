# Contributing

This is a small catalogue of independently shipped browser extensions, maintained by one person. It
is not an application: there is no repo-wide build, no workspace tool, no shared `node_modules`, and
no step between the source and what runs. Everything below follows from that.

Read [`PRINCIPLES.md`](PRINCIPLES.md) first. It is eight rules, it is short, and a change that
violates one of them cannot be merged regardless of how good it is.

## Licence, before you write anything

There is no repository-wide `LICENSE` file, on purpose — the terms are per directory, and there are
two of them.

- **Each extension is source-available, not open source**, under the
  [PolyForm Shield License 1.0.0](https://polyformproject.org/licenses/shield/1.0.0): you may read,
  run, modify and share it, but you may not use it to compete with the licensor. See the `LICENSE`
  file in that extension's directory for the exact terms and the Required Notice.
- **`core/` is MPL-2.0** (`core/LICENSE`) — deliberately weaker, file-level copyleft, so other
  extension authors can adopt and improve the shared layer without dragging their own product under
  the Shield terms. A patch to `core/` is offered under MPL-2.0; a patch to an extension is offered
  under PolyForm Shield. The file you are editing decides, not the pull request.

Consequences worth knowing before you spend an evening on a patch:

- A contribution you send is offered under the same terms as the file it changes.
- Sign your commits off with `git commit -s` (the [Developer Certificate of Origin](https://developercertificate.org/)).
  It is one line, it is lighter than a contributor agreement, and it is the only provenance record
  this project keeps.
- Large unsolicited features are likely to be declined, not because they are bad but because every
  shipped line is one person's maintenance burden across three stores. Open an issue first and
  describe the problem before writing the solution.

The most valuable contribution is not usually code. It is a **page that captures wrong**, reported
with its URL — see the issue templates.

## The rules that get a pull request rejected on sight

**1. The no-build law.** Clone, load the extension folder unpacked, and it runs. A change that
introduces a required build step for an existing tool is rejected. No bundler, no transpiler, no
minifier, no framework.

**2. Zero runtime dependencies.** No npm package may end up inside a shipped package. Development-only
tools do exist inside tool folders — the end-to-end tier installs a browser driver under
`test/e2e/node_modules/`, and the icon generator sits in `icons/` next to the PNGs it writes — and
that is fine, because they are gitignored and because packaging is a *positive allowlist*: `icons/`
admits `.png` and nothing else, `pages/` admits `.html`, `.js` and `.css`, and `node_modules`, `test`
and `publish` are refused a second time by the graders. Nothing reaches a zip by not being excluded.

**3. Shared code is copied, not linked.** MV3 has no runtime module system and this family has no
build step, so shared code reaches a tool as a **copy**. Two mechanisms, and they are not the same
thing:

  - A whole tool is copied from `templates/tool/` once, at birth, and stamped with its provenance in
    `skeleton.json`. `node templates/tool/tools/audit-fleet.mjs` then reports which tools are behind and
    which have diverged. Divergence is not automatically wrong — it just has to be visible. FullShot
    predates the stamp and the auditor reports it `UNSTAMPED`; that is a true statement about where
    it came from, not drift to be fixed by inventing a provenance it does not have.
  - `core/` is **vendored**: its files are copied into a tool as `<tool>/vendor/core/` by
    `scripts/sync-core.mjs`, which writes a sha256 per file into `vendor/core/.coremeta.json`, and
    `scripts/check-core-sync.mjs` — which `ci.yml` runs for every affected tool — fails when a
    vendored file stops matching. No tool vendors core yet, so that gate has nothing to check today.
    Read `core/README.md` before proposing anything for it: the admission bar is deliberately high,
    and it is honest about which of its modules exist (1 of the 11 the architecture specifies).

  The vendored directory is `vendor/core/` and **never** `_core/`. Chrome refuses to load any
  extension whose package has a root file or directory beginning with an underscore: *"Filenames
  starting with `_` are reserved for use by the system."* The single exception is `_locales`, which is
  why the packaging allowlist treats it as a special case rather than letting a `_*` exclusion
  silently drop every translation — and why `scripts/policy-check.mjs` fails any package with a
  reserved underscore path at its root.

**4. Fail-first.** Write the check that fails, watch it fail, then fix the thing. A capture bug means
a new fixture in `test/`, observed red, named after the behaviour it protects rather than after the
issue number — the fixture corpus has to stay readable at forty entries. A scenario whose deliberate
mutations do not make it fail is not a test; it is decoration.

**5. Never commit:** credentials of any shape, `node_modules/`, generated output, or third-party
screenshots. Install the hook that enforces the first one:

```sh
git config core.hooksPath .githooks     # hooks are not cloned; do this once per clone
sh .githooks/pre-commit --self-test     # and watch it prove its own patterns
```

**Nothing in this repository installs that for you, and nothing checks that you ran it.** Git executes
no repository code on clone, so no file here can make the hook automatic; `core.hooksPath` is written
into `.git/config`, which is neither cloned nor pushed. There is no root `package.json` and there is not
going to be — the no-build law above forbids the `npm install` a `postinstall` hook would need — so
there is nowhere to hide it either. Until somebody types that first line, `.git/hooks/` holds nothing
but git's fourteen `*.sample` files and this repository's only credential gate is off.

Be equally clear about what the second line is. `--self-test` runs the hook's two patterns against a
table of samples that must be refused and samples that must be allowed, and it reads nothing in your
tree. It is a regression test on the guard, not a scan of what you are about to commit.

And there is no backstop behind it yet. `ci.yml` has a `secrets-scan` job that runs
`node scripts/secret-scan.mjs .`, and that file does not exist — `scripts/README.md` says so on purpose
and records the contract whoever writes it must meet, because a job that fails loudly on a missing
script is honest in a way that an `if [ -f ]` guard is not. So today the only thing between a credential
and this repository's public history is a hook you installed by hand on your own machine. Treat the
first line of that block as part of the price of a clone, not as a tip.

`.githooks/pre-commit` refuses a commit whose staged paths or staged diff look like a credential.
`--no-verify` bypasses it, which is why it is a net rather than a permit.

The hook is tracked as mode `100755`. If you ever re-add it from a filesystem that drops the
executable bit (`git config core.filemode` is `false` on Windows), restore it with
`git add --chmod=+x .githooks/pre-commit` — on Linux and macOS a hook without that bit is skipped
**silently**, which looks exactly like a hook that found nothing.

## Naming — decided once, not revisited

| Identifier | Form | Example | Used by |
|---|---|---|---|
| Category directory | `Capitalized_Singular` | `Extension/` | filesystem only |
| Tool directory | `Title_Snake_Case` | `Full_Screen_Shot/` | filesystem only |
| **Tool id** | `lowercase-kebab` | `fullshot` | tags, package filenames, CI matrix, store paperwork |
| Product name | free text | `FullShot` | manifest, stores, README |

A category is a **delivery surface** (`Extension/`, and later others), never a product theme.
Themes change whenever marketing changes and re-categorising breaks every path, tag and link that
referenced it.

The **tool id is the stable public handle**. Directories can be renamed; ids cannot.

One more casing note, because it costs a green build to learn: Git on Windows is case-insensitive by
default and Linux is not, so `pages/Db.js` works on the author's machine and 404s inside the package
on a reviewer's. The package graders report a case mismatch separately from a missing file for
exactly this reason.

## Adding a tool

```sh
node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest --dry-run
node scripts/new-tool.mjs --category Extension --name "Tab Digest" --id tabdigest
```

It copies a whole working extension — `templates/tool/` if that directory exists, `templates/tool/`
otherwise, and it prints which one it used — stamps the four facts that must be right on day one, and
writes the `tool.json` that makes the rest of the repository see the tool at all. Then it prints the
ordered list of things it deliberately did not do, and that list is the real procedure.

**Do not substitute `cp -r`.** A hand-copied folder has no `tool.json`, and `tool.json` is the entire
coupling surface: `scripts/discover.mjs` builds the CI matrix by globbing for it, so a tool without
one does not merely go unlisted — it gets no lint, no policy check, no version gate and no package
build, and a tool absent from the checks list looks exactly like a tool that passed.

Two of the printed steps are worth repeating here, because both are enforced and neither can be
generated:

- **The permission justifications in the new `tool.json` are empty strings**, so
  `node scripts/policy-check.mjs <id>` fails until a human writes them. That is the design: a
  justification a script could have written explains nothing, and store review asks for this exact
  text at submission.
- **Add the tool's id to `.github/ISSUE_TEMPLATE/bad-page.yml` and `bug.yml`.** `ci.yml` greps both
  for `(<id>)` and fails the push without it. Issue forms cannot be generated, so this is the one
  place a new tool is added by hand.

Then work through the copied `TEMPLATE.md` from §0, top to bottom, and write
`publish/STORE-LISTING.md` in your own words. Nothing generates that file, and nothing should: every
listing is its own product ([`PRINCIPLES.md`](PRINCIPLES.md) P7), and metadata reused from a sibling
breaks Edge developer policy §1.1.5 — the clause that governs extensions, where Microsoft Store
10.1.4 governs apps — for which Edge states only that non-compliance *may* result in extension
removal and account suspension or termination, so the exposure is the account's and not just the one
listing's.

`templates/tool` is a real, loadable, working MV3 extension, not a pile of stubs — load it unpacked and it
does something small and genuine. `preflight.mjs` is the machine half of `TEMPLATE.md`'s checklist:
it is deliberately red in the skeleton, and every red line is a step somebody has not done yet.

## Gates before you push

Cheap gates first — that ordering is why work can iterate for days without opening a browser.

### Inside the tool directory you changed

```sh
cd Extension/<Tool>

# 1. Node tiers: pure logic, no DOM, seconds. Run every one; the exit code is the gate.
for t in test/*.node.js test/pixel-sim/run.js; do
  [ -f "$t" ] || continue                 # an unmatched glob is passed through literally, and
                                          # "cannot find module" is not a failing test
  out=$(node "$t" 2>&1); code=$?          # capture the status on its own line, before anything else
  printf '%s EXIT %s\n' "$t" "$code"
  [ "$code" -eq 0 ] || printf '%s\n' "$out"
done

# 2. Build both packages (Chromium + Firefox) and grade them.
node publish/pack.mjs

# 3. Grade the archives on their own, reading the bytes back out of the finished file.
node publish/verify-package.node.js
node publish/verify-firefox-package.node.js

# 4. Submission readiness — deliberately red until the human-only steps are done.
node publish/preflight.mjs
```

Steps 2–4 are the script names a tool inherits from `templates/tool/`. **FullShot predates them** and has
its own: `node publish/package.node.js` builds both packages and grades what it built, and
`node publish/package.node.js --verify` grades the existing zips without rebuilding.
`node publish/verify-firefox-package.node.js` grades the AMO submission. FullShot has no `preflight.mjs`.

⚠️ **CORRECTED 2026-08-25.** That sentence used to end *"and is red by design until the owner sets a
real `gecko.id`"*. **It is not red, either way.** Run bare — exactly as `ci.yml:486` invokes it — it
exits **0** with `SOURCE PASSES — NO PACKAGE WAS GRADED.`; run `--zip` against a freshly built package
it exits **0** with `ALL PASS`. The id was filled on 2026-08-18 (`088b4e3`) and is `fullshot@nikatru.com`.
Two things that did **not** change with it: the gate is still what you run before an AMO upload, and
AMO still fixes the add-on identity at first signing, so the id cannot be walked back.

⚠️ One more measured note on the line above it, because it is the one that surprises people:
`node publish/package.node.js --verify` grades zips **it does not build**, and no zip exists in
`Extension/Full_Screen_Shot/publish/` on a fresh checkout (`git ls-files
'Extension/Full_Screen_Shot/publish/*.zip'` → 0 lines; all twelve were deleted 2026-08-20, see
`publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`). So on a clean tree it exits **1** with
`2 FAIL — packaging + reference integrity`, and both FAILs are `package exists`. That is the absence of
a build, not a defect in the tree. Build first — the bare form builds and grades in one go, and exited
**0** with `ALL PASS — packaging + reference integrity`, `85 files` byte-identical to the tree, on
2026-08-25. ⚠️ It writes into `publish/` and only `publish/` (`OUT = __dirname`, there is no `--out`),
and `publish/*.zip` is deliberately *un*-ignored, so run it somewhere disposable or clean up after it —
`git status --porcelain` must not show a zip.

Two traps in that paragraph, both cheap to hit:

- **The flag is `--verify`, not `--check`.** `package.node.js` tests `process.argv.includes('--verify')`
  and nothing else, so any other spelling silently means *build* and overwrites both zips.
- Do not paste one tool's command list into another tool's terminal and read the "command not found"
  as a passing gate.

### From the repository root

These read `tool.json` and are exactly what `ci.yml` runs, so run them before the push rather than
after the red check:

```sh
node scripts/lint.mjs <id>            # node --check every shipped script
node scripts/policy-check.mjs <id>    # privacy · permissions · store limits · i18n · icons · _paths
node scripts/check-version.mjs <id>   # manifest version == top CHANGELOG entry
```

⚠️ **CORRECTED 2026-08-25 — all three of those are green now.** This paragraph used to read *"Some of
these are red on FullShot today, for reasons the tree already admits: its manifest description is 137
characters against the store's 132-character cap (recorded in its own `tool.json`), and it has no
`CHANGELOG.md` yet."* Re-measured on 2026-08-25, bare, exit code on its own line:

| Command | Exit | What it printed |
| --- | --- | --- |
| `node scripts/lint.mjs fullshot` | **0** | — |
| `node scripts/policy-check.mjs fullshot` | **0** | `15 passed · 1 warning(s)`, including `name/short_name/description within store limits — checked across all 55 locale(s)` |
| `node scripts/check-version.mjs fullshot` | **0** | `3 passed` |

The description is **111** characters, not 137 — count it yourself with
`node -e "const m=require('./Extension/Full_Screen_Shot/_locales/en/messages.json'); console.log([...m.appDescription.message].length)"`
— it was fixed in 1.10.2 and it no longer lives in the manifest at all, but in
`_locales/en/messages.json` and 54 sibling catalogues. `CHANGELOG.md` exists: **12874** bytes, top
entry `## [1.10.2] — 2026-08-15`. `tool.json` has been corrected in place and records both under
`NOTES.corrections`.

**The rule this paragraph exists for is unchanged, and it is the part worth keeping: a red gate naming
a real defect is the system working.** Read the finding before you fix it, though — a gate can also be
wrong, and `@@`-prefixed messages such as `@@bidi_dir` are supplied by the browser rather than by
`_locales/en/messages.json`. A gate that has gone red because its *assertion* drifted is the same
class of bug pointing the other way: `publish/package.node.js` spent five days reporting a Chrome
packaging defect that did not exist, because its `importScripts` check was anchored at column 0 and
the source had gained a guard that indented the call. Fix the assertion, never by loosening it into
something the real defect would also pass.

The real-browser tier (`test/browser/smoke.mjs` in the skeleton, `test/e2e/run.mjs` for FullShot) is
slower and needs a driver installed; run it before a release, not before every commit.

Two things about the loop itself, both learned expensively:

- Capture `$?` on its own line. `printf '%s EXIT %s\n' "$(basename $t)" "$?"` reports *basename's*
  exit status, always `0`, so a failing gate reads as green.
- A checking loop is itself a check. Run it once against a gate you know is failing and confirm it
  prints non-zero, before you trust a screen full of `EXIT 0`.

## Commits

```
<tool-id>: <imperative summary>
```

`fullshot: guard importScripts for Gecko event pages`. Use `skeleton:` for changes to `templates/tool/`,
`core:` for the shared runtime, and `repo:` for anything at the root. The prefix is how a reader of
`git log` knows which of several independently versioned products a change belongs to.

Sign off with `-s`. Keep a commit to one tool where you can — they release separately, and a commit
spanning three of them cannot be reverted for one of them.

## Reporting a security issue

Not here, and not in a public issue. See [`SECURITY.md`](SECURITY.md).
