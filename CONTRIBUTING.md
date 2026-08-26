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

⚠️ **CORRECTED 2026-08-25 — the backstop exists. The paragraph above is false from "and that file
does not exist" onward, and it is left standing only so the correction is legible next to it.**
`scripts/secret-scan.mjs` is a real file — **25027 bytes**, present since 2026-08-15 — and it is
invoked by two workflows, not zero: the `secrets-scan` job (`ci.yml`, the bare `- run:` step that
calls it) and the release workflow's equivalent. Measured today, bare, from the repository root with
the exit code read on its own line:

| Command | Exit | What it printed |
| --- | --- | --- |
| `node scripts/secret-scan.mjs .` | **0** | `3 passed` — `no committable path is a credential file by name` (540 paths × 5 rules), `no credential-shaped string in committable content` (540 files · 12274076 bytes · 9 rules) |

It also self-tests before it grades: its first line is `the scanner still bites — 9 content + 5 path
rule(s) matched their own samples; 5 benign sample(s) matched none`. That is the same discipline
`--self-test` gives the hook, run automatically rather than by hand.

The citation is stale too. `scripts/README.md` no longer "says so on purpose": it lists the script in
its inventory table, records its exit code in a dated block, and names the CI job it belongs to —
⚠️ **grep the job name `secrets-scan`, not a step name**, which is that README's own measured note.

Two things the correction does **not** retire, and they are the reason this paragraph was written:

- **The hook is still hand-installed and still unchecked.** `git config core.hooksPath .githooks` is
  written into `.git/config`, which is neither cloned nor pushed, and nothing in this repository can
  make it automatic. That half of the paragraph stands exactly as written.
- **A CI scan is not a pre-commit hook.** `secret-scan.mjs` runs *after* you have pushed, so it is a
  net under the history, not a gate in front of it. A credential caught by CI is a credential already
  in a public branch. Install the hook anyway.

The rule underneath is also unchanged and worth keeping: **a job that fails loudly on a missing
script is honest in a way that an `if [ -f ]` guard is not.** What changed is that the job no longer
has a missing script to be honest about.

⚠️ **CORRECTED AGAIN 2026-08-25, later the same day — four figures in the block above have drifted.
This is drift, not fabrication.** Every number in that block was measured honestly against the tree
as it stood when it was written; nothing there was guessed or reconstructed from memory. What moved
underneath it is `scripts/secret-scan.mjs` itself: a later change on the same day added a third
family of content rules — Indian identity numbers (PAN, GSTIN, Aadhaar) — as a fourth gate, which
changed the pass count, rewrote the self-test line word for word, and changed the scanner's own size
and the byte total it reports. The block above is left standing unedited, because the sequence of
corrections is the record.

Re-measured today from the repository root, bare, with the exit code read on its own line
(`node scripts/secret-scan.mjs . >/tmp/ss.txt 2>&1; rc=$?; echo "rc=$rc"` → `rc=0`), against the
working tree at commit `7c33a62` **plus the uncommitted change to `scripts/secret-scan.mjs`**:

| Figure in the block above | Stated there | Prints today |
| --- | --- | --- |
| Grade line for `node scripts/secret-scan.mjs .` | `3 passed` | `4 passed` — the added gate is `no Indian identity number in committable content` — `540 file(s) · 3 rule(s) — PAN, GSTIN, Aadhaar` |
| The self-test line, quoted verbatim | `the scanner still bites — 9 content + 5 path rule(s) matched their own samples; 5 benign sample(s) matched none` | see the block below — the old string no longer exists anywhere in the output |
| Content-gate size | `540 files · 12274076 bytes` | `540 file(s) · 12304986 bytes` |
| Size of `scripts/secret-scan.mjs` | `25027 bytes` | **25027 bytes at `7c33a62`, still exact** — but **37832 bytes** in the working tree with the identity rules applied |

The self-test line as it prints today, copied out of the run rather than retyped — note the two
spaces before the dash, and that `content` is now split into `credential` and `identity`:

```
  PASS  the scanner still bites  — 9 credential + 3 identity + 5 path rule(s) matched their own samples; 11 benign sample(s) matched none
```

What did **not** move, and is therefore the part of that block still safe to rely on: the exit code
is still **0**; the subject is still **540** committable files (547 on disk, 7 gitignored); the path
gate is still **5** rules; the credential-content gate is still **9** rules; and the script is still
invoked by two workflows.

🔴 **The lesson, and it is the reason this second correction was worth writing.** A record that
quotes a **verbatim self-test string** and a **byte count of a file somebody else is editing** is a
record that goes stale by the hour — not by the release. Both of those figures were true when taken
and false before the day was out, and neither failure was anybody's carelessness. Prefer the claim
that survives the next commit: *the scanner self-tests its own rules before it grades anything, and
fails closed — `gate A` calls `process.exit(EXIT_FAIL)` immediately if any rule stops matching its
own sample, before a single file is read.* That sentence stays true when a fourth or fifth rule
family lands; `9 content + 5 path` did not survive one. Where an exact figure genuinely earns its
place, **pin it to a commit** (`25027 bytes at 7c33a62`) or say out loud that it drifts — an
unpinned byte count reads as a fact and behaves like a timestamp.

⚠️ **This correction is self-referential, so any grep count of these strings is self-inclusive —
including the counts in this sentence.** The strings `the scanner still bites`, `12274076` and
`25027` now appear in this file both in the block being corrected and in the correction quoting it,
and again in this note about the counting. Counted with `grep -o … | wc -l` immediately after this
section was written: `the scanner still bites` **5 times** — once in the stale block, once in the
table row above, once in the fenced current output, and twice in this paragraph; `12274076`
**4 times**; `25027` **6 times**. None of those is evidence about the scanner; they are evidence
about this file. Subtract this section before concluding anything from such a count, and re-count
rather than trusting these three numbers if the file has been edited since.

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

⚠️ **CORRECTED 2026-08-25 — that sentence names the same directory twice, so it describes no
fallback at all.** Read out of the script rather than the prose: the candidate list is
`['templates/tool', '_skeleton']`, tried in that order, and `_skeleton/` is the template's
**pre-move location**, kept only as a fallback. In this tree `_skeleton/` **does not exist**
(`ls -d _skeleton` → `No such file or directory`), so `templates/tool/` is the only source a
scaffold can come from today; if it were ever missing, `new-tool.mjs` does not fall through
silently — it dies naming both candidates and offering `--template <dir>`. The rest of the sentence
is right, including "it prints which one it used": the run note says so explicitly when the fallback
is what got used.

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
| `node scripts/policy-check.mjs fullshot` | **0** | `15 passed · 1 warning(s)`, including `name/short_name/description within store limits — checked across all 55 locale(s)` ⚠️ **UPDATED 2026-08-26** — now `16 passed`, no warnings, EXIT **0**: `manifest.json` gained `content_security_policy.extension_pages` and that closed the CSP `connect-src` warning. Re-measured 2026-08-26. See the appended note below the next table for the two limits that go with it. |
| `node scripts/check-version.mjs fullshot` | **0** | `3 passed` |

The description is **111** characters, not 137 — count it yourself with
`node -e "const m=require('./Extension/Full_Screen_Shot/_locales/en/messages.json'); console.log([...m.appDescription.message].length)"`
— it was fixed in 1.10.2 and it no longer lives in the manifest at all, but in
`_locales/en/messages.json` and 54 sibling catalogues. `CHANGELOG.md` exists: **12874** bytes, top
entry `## [1.10.2] — 2026-08-15`. `tool.json` has been corrected in place and records both under
`NOTES.corrections`.

⚠️ **CORRECTED 2026-08-25 — "exactly what `ci.yml` runs" is true of those three and incomplete as a
list.** Each of the three *is* a CI gate, but the per-tool matrix runs four more beside them, and the
one this omission costs you most is **`run-tests.mjs`** — the tier that actually catches a capture
regression, and the one a contributor following this section would push without. Re-measured today
for `fullshot`, bare, exit code on its own line:

| Command | Exit | What it printed |
| --- | --- | --- |
| `node scripts/lint.mjs fullshot` | **0** | `1 passed` — `26 file(s) parse` |
| `node scripts/policy-check.mjs fullshot` | **0** | `15 passed · 1 warning(s)` — the warning is the absent CSP `connect-src`, a second barrier that is wanted and not a defect ⚠️ **UPDATED 2026-08-26** — now `16 passed`, no warnings, EXIT **0**. The barrier is no longer absent, so this cell's premise is discharged: `manifest.json` declares `connect-src 'none'` and there is nothing left to want. Note below. |
| `node scripts/check-version.mjs fullshot` | **0** | `3 passed` |
| `node scripts/run-tests.mjs fullshot` | **0** | `12 passed` — zero `FAIL` lines across the whole run |
| `node scripts/check-core-sync.mjs fullshot` | **0** | `1 passed` — `this tool vendors no core … consistent` |
| `node scripts/check-store-metadata.mjs fullshot` | **0** | prints the empty-screenshots note as **owner work** and exits 0 rather than blocking |
| `node scripts/check-store-packages.mjs fullshot` | **0** | `5 passed` |

⚠️ **APPENDED 2026-08-26 — both `policy-check` rows above stand as written and were true when they
were measured; the correction is recorded here rather than folded into them.** `manifest.json` now
declares `content_security_policy.extension_pages`, so the CSP `connect-src` warning both rows name is
**closed**: `node scripts/policy-check.mjs fullshot` prints `16 passed`, no warnings, EXIT **0**,
re-measured 2026-08-26 with the exit code read on its own line. The row above calls that warning *"a
second barrier that is wanted and not a defect"* — the barrier now exists, so that sentence has nothing
left to want.

🔴 **Do not read `16 passed` as more coverage than it buys.** Two limits are measured and both belong
beside any sentence claiming the browser enforces the zero-network claim:

- **Chromium only.** `publish/manifest.firefox.json` deletes the key again for Gecko with an RFC 7386
  `null` member, deliberately: the AMO build stays on the strict MV3 default and the Firefox package
  carries no `connect-src` at all. Counting the surface x browser grid — the 8 extension pages,
  `background.js`, and `content/capture.js` + `content/region.js` + `content/frame-expand.js`, across
  Chromium and Firefox — **two of the six cells** are backed by the browser. Firefox users rely on the
  source scan alone.
- **One of the seven declared directives is gated here.** The policy declares `script-src`, `object-src`,
  `img-src`, `connect-src`, `frame-src`, `base-uri` and `form-action`. `scripts/policy-check.mjs:589-607`
  is the only site in this repo that reads a directive off this manifest, and it reads `connect-src`
  only — deleting `img-src`, or setting it to `*`, leaves the gate at `16 passed` EXIT 0. The browser
  honours all seven; this repo verifies one. And `extension_pages` does not govern content scripts
  in either browser.

Also stale in the 2026-08-25 block above, found by sweeping this file rather than by being told, and
corrected here for the same append-never-rewrite reason: the line **"`CHANGELOG.md` exists: 12874
bytes"** (~line 352). It was 12874 when measured on 2026-08-25 and it is not now — `wc -c
Extension/Full_Screen_Shot/CHANGELOG.md` → **20984** on 2026-08-26. It had already grown to **18415**
before today's CSP work, when the two privacy fixes were appended to the `[1.10.2]` entry, and this
change added the `### Security` entry beside them. The claim the sentence is making — that the file
exists, which is why the old `absent.CHANGELOG.md` entry was retired — is still true; only the byte
count moved. ⚠️ `docs/ARCHITECTURE.md:284` carries the same **12874** figure and is **not corrected
here**: that file is not owned by this change.


⚠️ **Read `check-store-metadata`'s print, not its silence.** It exits 0 while telling you
`store/_shared/screenshots holds no images yet`. That is a real, unfinished submission prerequisite
that no exit code will ever turn red for you — an owner-work note is not a passing grade.

Add the four to your pre-push loop; the durable way to find the full set is
`grep -n 'run: node scripts/' .github/workflows/ci.yml`, because the matrix is edited often and any
list pasted into prose starts drifting the day it is written — this one included.

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
