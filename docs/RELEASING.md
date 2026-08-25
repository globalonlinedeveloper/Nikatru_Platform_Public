# Releasing

The path from a working tree to a package a store will accept.

One tool is released at a time. Nothing here builds, versions or tags more than the tool you are
standing in. Commands are shown from a tool's own directory.

**CI exists and every gate it names is on disk.** `.github/workflows/` holds `ci.yml`, `release.yml` and
`e2e.yml`. A named script CI cannot find fails the job, deliberately, rather than being skipped —
`ci.yml`'s own gate-script inventory step goes further and derives every `scripts/…` and
`Extension/<Tool>/publish/….node.js` path the three workflows mention, failing if one is absent *or* if
its own pattern matches nothing (`grep -n 'found no gate-script call' .github/workflows/ci.yml` finds
that limb; line numbers in these workflows move, so grep for the sentence rather than trusting an
offset). The one thing still untried is the tag:
`git for-each-ref refs/tags` returns **0**, so `release.yml` has never run. The design position is that a
gate must be runnable identically in both places, which is why they are dependency-free Node scripts.

**That position has named exceptions, and they matter to anyone copying a step body.** A handful of steps
are inline `bash` rather than a single `node` call, and those are *not* runnable as-is in PowerShell on
the owner's machine. Count them yourself rather than trusting this sentence — `ci.yml`'s own header gives
the anchored form, `grep -cE "^        shell: bash$" .github/workflows/ci.yml`, which returned **7** on
2026-08-22 (and **2** for `release.yml`). Collapsing those into `scripts/` is open work. The unanchored
`grep -c 'shell: bash'` returns a larger number because the prose in that file discusses the string, which
is why the anchored form is the one to use.

> **CORRECTION — 2026-08-22.** This block used to open **"CI exists and cannot pass yet … written to call
> `scripts/*.mjs` gates that are still landing"**, dated as a statement about the tree as of
> **2026-08-14**, and it concluded **"until that clears, the release is a human running the local commands
> below in order."** Re-measured 2026-08-22 and false: every gate path the three workflows invoke
> exists. Do not take the set on trust from this page — `ci.yml`'s inventory step derives it, and you can
> run the same derivation:
>
> ```sh
> grep -rhoE '(scripts|Extension/[A-Za-z0-9_]+/publish)/[A-Za-z0-9][A-Za-z0-9._/-]*\.(mjs|node\.js)' \
>   .github/workflows | sort -u
> ```
>
> It returned **17** paths on 2026-08-22, which is the number `ci.yml` itself reports as *"17 of 17 gate
> script(s) present"*: fifteen `scripts/*.mjs` — `discover check-version policy-check check-core-sync lint
> check-store-metadata check-catalog secret-scan run-tests pack verify-refs sha256 check-store-packages
> publish-catalog changelog-section` — **plus `scripts/test/selftest.node.js`**, which is a sixteenth gate
> path under `scripts/`, **plus** `Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js`.
> Fourteen of the fifteen `.mjs` were run in one pass — with `fullshot` where they take a tool, on a built
> zip for `sha256.mjs` — and every one **EXIT 0** (only `publish-catalog.mjs` was left alone, because
> running it *writes* the catalogue). So were `scripts/test/selftest.node.js` (EXIT 0, ALL PASS),
> `_locales/make-locales.mjs --check` (EXIT 0) and `publish/verify-firefox-package.node.js` (EXIT 0).
> **Nothing below should be read as "the gates are not written yet".**
>
> ⚠️ **The self-test's check count is deliberately not quoted here.** An earlier draft of this paragraph
> said *"EXIT 0, 118 checks"*, and it was stale before it landed — `selftest.node.js` gains a check every
> time a gate learns a new mutation to bite on, so the total moves and nothing on this page recomputes it.
> What matters is the durable claim it makes, which is printed beside the number: every gate it covers was
> shown to go **red on a planted defect**, so a green run is evidence rather than decoration. Read the
> count off your own run.
>
> The dated corrections further down were made in the same pass and by the same method.

---

## 1. The sequence

### 1a. A tool stamped from `templates/tool` — from that tool's own directory

Every file named here ships into a new tool by `scripts/new-tool.mjs`. **FullShot is not one of these
tools and has only two of the seven lines below** — see §1b for the sequence that actually applies today.
Measured 2026-08-22 from `Extension/Full_Screen_Shot/`: `publish/preflight.mjs`, `publish/bump-version.mjs`,
`publish/pack.mjs`, `test/browser/smoke.mjs` and `test/fullshot-sim.node.js` are all **absent**; only
`_locales/make-locales.mjs` and `publish/verify-firefox-package.node.js` are present. The single
`test/<tool>-sim.node.js` line has no FullShot equivalent at all — FullShot keeps a directory of separate
`test/*.node.js` files that `scripts/run-tests.mjs` drives from `tool.json`, which is why §1b runs
`run-tests.mjs` and never names a sim file.

```
node publish/preflight.mjs                # is this still a template? fix every TODO first
node test/<tool>-sim.node.js              # the node tier — ALL PASS
node test/browser/smoke.mjs               # the real-browser tier — ALL PASS
node _locales/make-locales.mjs --check    # the locale catalogues are in step
node publish/bump-version.mjs minor       # stamps a CHANGELOG stanza — fill it in
node publish/pack.mjs                     # writes and grades both packages
node publish/verify-firefox-package.node.js
```

**Every one of these ends in `process.exit(failures ? 1 : 0)`, so the exit code is the signal — read it
and the output.** What is not trustworthy is how a shell reports that code:

- `node gate.mjs | tail -5` gives you *`tail`'s* status. A failing gate reads as `0`.
- `printf '%s %s\n' "$(basename "$g")" "$?"` gives you *`basename`'s* status, because the command
  substitution runs before `$?` is expanded. A loop written that way reports every gate green.
- **`out=$(node "$g" 2>&1); code=$?` never reaches `code` at all when `errexit` is on.** Under `set -e` a
  failing command substitution in an assignment kills the shell on that line, so `code` is only ever
  readable as `0` and the line that reports the failure is unreachable.

Capture the status on its own line, before anything else runs, and take it from a form `-e` cannot
pre-empt:

```sh
code=0
out=$(node "$g" 2>&1) || code=$?
printf '%s EXIT %s\n' "$(basename "$g")" "$code"
printf '%s\n' "$out"
```

> 🔴 **CORRECTION — 2026-08-22. This snippet used to read
> `out=$(node "$g" 2>&1); code=$?; printf '%s EXIT %s\n' "$(basename "$g")" "$code"` on one line, and that
> form is silently broken in a GitHub Actions `run:` step.** GitHub executes a `run:` body as
> `bash --noprofile --norc -eo pipefail {0}`, so **`-e` is already on before your first line**. Writing
> `set -uo pipefail` at the top *adds* `-u`; it does not take `-e` away.
>
> Measured 2026-08-22, same body, one deliberately failing gate, two shells:
>
> | shell | exit | bytes printed |
> | --- | --- | --- |
> | `bash body.sh` — what an author tests in | 0 | **non-zero** — `red.mjs EXIT 1` and the gate's own message |
> | `bash --noprofile --norc -eo pipefail body.sh` — what the runner uses | 1 | **0** |
>
> *Amended 2026-08-22, later pass: those two cells read **48 bytes**. That figure was a property of the
> throwaway stub gate used to take the measurement, and the stub is gone, so no reader can reproduce it —
> an independent rebuild with a different message printed 39. Deleted rather than re-pinned: a figure that
> reads as evidence and cannot be re-derived is worse than none. The load-bearing cell is the **0**, and it
> reproduces exactly, because "prints nothing" is a property of the flags and not of your stub.*
>
> The step goes red having said nothing about *why*. The fixed form above, under the runner's own flags,
> prints that same output and reports `EXIT 1`. This is the `$?` family the bullet above already warns
> about, one level over: there the trap was expansion order, here it is **shell flags**. Both make a
> failing thing report success, and `set -euo pipefail` plus `|| code=$?` closes both.

A checking loop is itself a check. Run yours once against a gate you know is red and confirm it prints
non-zero **under the flags it will really run with**, before you trust a screen of passes.

`preflight.mjs` is deliberately red in the template — its whole job is to answer "has this copy become a
tool yet?". It is not part of the all-green set. When it goes green, the two test tiers are green, and
the packager grades clean, you are looking at a submittable item.

### 1b. FullShot — from the repository root

FullShot predates the template and was never stamped from it, so §1a's paths are not FullShot's paths.
This is the sequence that is actually wired into `ci.yml` and `release.yml`, and every line was run to
**EXIT 0** on 2026-08-22:

```
node scripts/check-version.mjs   fullshot [--expect <tag version>]   # manifest == CHANGELOG == tag
node scripts/policy-check.mjs    fullshot
node scripts/check-core-sync.mjs fullshot          # needs the tool argument; bare it exits 2
node scripts/lint.mjs            fullshot
node scripts/check-store-metadata.mjs fullshot
node scripts/check-catalog.mjs
node scripts/secret-scan.mjs .
node scripts/run-tests.mjs       fullshot          # the node tier — 12 passed, ~2 min
node Extension/Full_Screen_Shot/_locales/make-locales.mjs --check
node scripts/pack.mjs fullshot --target chromium --out dist [--release]
node scripts/pack.mjs fullshot --target firefox   --out dist [--release]
node scripts/verify-refs.mjs --zip dist/fullshot-chromium.zip --strict
node scripts/verify-refs.mjs --zip dist/fullshot-chromium.zip --leaks
node scripts/check-store-packages.mjs fullshot --dir dist
node Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js --zip dist/fullshot-firefox.zip
```

⚠️ **`--target` takes `chromium` or `firefox`. `chrome` exits 2 with "CANNOT RUN".**

⚠️ **`verify-firefox-package.node.js` run bare exits 0 printing `SOURCE PASSES — NO PACKAGE WAS
GRADED`.** Without `--zip` its package limb opens nothing, so a bare green from it says nothing about any
archive. `release.yml`'s step *"The tool's own AMO submission gate, on the built zip (FullShot)"* asserts
the *positive* `ALL PASS` wording for exactly this reason.

> **CORRECTION — 2026-08-22.** §1b replaces a paragraph headed **"FullShot is on an older toolchain"**,
> which read: *"It carries `publish/package.node.js` instead of `pack.mjs`, and it has no
> `identity.json`, no `preflight.mjs` and no `bump-version.mjs`. Its build command is
> `node publish/package.node.js`."* Three of those five claims are false as measured 2026-08-22:
> `Extension/Full_Screen_Shot/publish/identity.json` **exists** and is what `check-store-packages.mjs`
> and `policy-check.mjs` read; `scripts/pack.mjs` works on FullShot for **both** targets at EXIT 0 (85
> entries each, re-measured 2026-08-22) and is what `ci.yml`'s *Build package* step and `release.yml`'s
> ***Build all store packages*** step actually invoke; so `package.node.js` is **in addition to** the
> repo-wide packer, not instead of it, and it is
> not the build command any lane uses. What remains true: FullShot has no `publish/preflight.mjs`, no
> `publish/bump-version.mjs`, no `publish/pack.mjs` and no `test/browser/`. **Which of the two packers
> survives is an open question this document deliberately does not answer** — it needs a measured
> file-set diff first. `ci.yml` records in prose that `package.node.js` is what produced the six stale
> Firefox zips `check-store-packages.mjs` was written to catch, which is the argument for closing it, not
> the decision.
>
> ⚠️ **Both step names above are quoted so you can grep them, and both were greppable on 2026-08-22 —
> check, do not assume.** `grep -n 'name: Build package' .github/workflows/ci.yml` and
> `grep -n 'name: Build all store packages' .github/workflows/release.yml` each return one line. An
> earlier draft of this paragraph called the `release.yml` one *"the Pack step"*; there is no step by that
> name, `grep -n 'name: Pack' .github/workflows/release.yml` returns nothing, and a name a reader cannot
> grep is no better than the line number it was meant to replace. Cite a step by a string that exists.

---

## 2. Version

**`manifest.json` `version` is the single source of truth.** Nothing else declares a version — no
`package.json` version, no metadata file version. Every duplicate is a drift bug waiting for a release
day.

The version is nevertheless *written* in more than one place, which is why bumping is a script and not a
three-character edit:

| Site | Why it is easy to miss |
| --- | --- |
| `manifest.json` | The source of truth. |
| `publish/manifest.firefox.json` | **Template-stamped tools only.** There it is a whole second manifest that AMO reads and that nothing else will remind you about. |
| `CHANGELOG.md` heading | The release notes come from here. |

> **CORRECTION — 2026-08-22.** A fourth row read **"Both package filenames — Derived:
> `<slug>-<version>.zip` and `<slug>-<version>-firefox.zip`"**, and it is gone because the filenames no
> longer carry a version: `scripts/pack.mjs` writes `<out>/<id>-<target>.zip`
> (`fullshot-chromium.zip`, `fullshot-firefox.zip`), unconditionally — measured, and stated in the
> script's own header as one of the four things the repo-wide packer fixed. A filename is therefore not a
> version site any more, and §4 and §5 below are corrected to match.
>
> The `manifest.firefox.json` row is also narrower than it was. FullShot's copy is an **RFC 7386 merge
> patch**, not a whole manifest: it restates no version, and `check-version.mjs fullshot` says so in its
> own words — *"publish/manifest.firefox.json is an overlay — it does not restate the version, so it
> cannot drift from it"*. `templates/tool/publish/manifest.firefox.json` **is** a full manifest carrying
> `"version": "0.0.1"`, so the row stands there.

```
node publish/bump-version.mjs patch     # 1.2.3 -> 1.2.4
node publish/bump-version.mjs minor     # 1.2.3 -> 1.3.0
node publish/bump-version.mjs major     # 1.2.3 -> 2.0.0
node publish/bump-version.mjs 1.2.3     # exactly that
node publish/bump-version.mjs --check   # do all the sites agree?
node publish/bump-version.mjs --sync    # re-derive gecko.id from identity.json; touches no version
```

The list of version sites is declared data, not a guess. Adding a site is one line, and a site that
stops matching is a hard failure rather than a silent skip.

### The format rules the stores enforce

- **One to four dot-separated integers, each 0–65535, no leading zeros.** Nothing else is a valid
  extension version.
- **No pre-release suffixes.** `1.9.11-beta` is not a legal Chrome version. Gecko would accept
  `1.9.11beta1`; do not use it. One convention across three stores beats each store's maximum
  expressiveness.
- **Use the fourth component for a store-only re-upload** that carries no source change: `1.9.11.1`.

### Never reuse a version number

Two different packages under one version is unrecoverable in public: the store keeps whichever it
received first, and no diff afterwards tells you which one a given user has. Bump before you rebuild,
always. The bump script refuses to bump to the current number for this reason.

---

## 3. CHANGELOG

Keep-a-Changelog form, newest first:

```markdown
## [1.10.1] — 2026-08-14
### Fixed
- …
```

⚠️ **That version is deliberately NOT the tree's current one** (FullShot's top entry is `[1.10.2]`), and
it must stay that way. `scripts/changelog-section.mjs` cites this exact fenced block by its exact string
as the worked case for why an extractor has to be fence-aware: the day a documentation example matches a
real heading, a fence-blind extractor ends the section at the example and truncates the release body with
nothing saying so. Do not "freshen" this example to match the manifest.

The heading is one of the version sites, so it is checked against the manifest — by `bump-version.mjs`
and `preflight.mjs` in a template-stamped tool, and by **`scripts/check-version.mjs <id>`** everywhere,
which is the one CI and `release.yml` run. Write the stanza when you bump, while you still know what
changed — a release note reconstructed a week later is a guess with a date on it.

`node scripts/changelog-section.mjs <id> <version>` extracts one stanza; `release.yml` uses it to build
the release body. It EXITs 0 for `fullshot 1.10.2` today.

---

## 4. Pack

**There are two packers, and they take different flags.** A template-stamped tool's own
`publish/pack.mjs` builds both targets in one run:

```
node publish/pack.mjs                    # build both packages, then grade them
node publish/pack.mjs --verify           # grade what is already there, build nothing
node publish/pack.mjs --extract <dir>    # unpack the built package for the browser tier
```

The repo-wide `scripts/pack.mjs` — the one CI and `release.yml` invoke, and the only one that works on
FullShot — builds **one target at a time** and has neither `--verify` nor `--extract` (it always leaves
an unpacked tree at `<out>/unpacked-<target>/`):

```
node scripts/pack.mjs <tool-id> --target <chromium|firefox> [--out dist] [--release]
```

Two packages come out of one source tree:

| File | Goes to | Manifest |
| --- | --- | --- |
| `<id>-chromium.zip` | Chrome Web Store **and** Microsoft Edge Add-ons — the same file, unchanged | `manifest.json` |
| `<id>-firefox.zip` | AMO | `publish/manifest.firefox.json` applied as an RFC 7386 merge patch |

> **CORRECTION — 2026-08-22.** This table used to name the files `<slug>-<version>.zip` and
> `<slug>-<version>-firefox.zip`. Measured: `scripts/pack.mjs` writes `<out>/<id>-<target>.zip` with no
> version in the name, and `release.yml` uploads `dist/*.zip` — so a real release's assets are
> `fullshot-chromium.zip`, `fullshot-firefox.zip` and `SHA256SUMS.txt`. The version lives in the tag, the
> manifest and the CHANGELOG, not in the filename. The old table also said the Firefox manifest was
> "swapped in"; FullShot's is *merged* in, which is why it can hold `"service_worker": null` and
> `"options_page": null` as deletions.

`background.js` is identical in both. The `importScripts` guard lives in the source file, so there is no
patch step and no text anchor to lose.

**Two refusals are deliberate, and both mean "nothing was written".**

- If the localisation gate fails — a declared `default_locale` whose catalogue is missing, or locale
  files on disk the build did not collect — the packager writes nothing and leaves the previous zips
  untouched. A store rejects that upload outright, and an unshippable zip written over a good one is not
  something a non-zero exit can undo.
- If the Firefox add-on identity is still a placeholder or disagrees with `identity.json`, no Firefox
  package is written at all. AMO fixes an add-on's identity at first signing; see
  [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md#4-firefox--addonsmozillaorg-amo). (FullShot's id is settled:
  `fullshot@nikatru.com`, from `publish/identity.json`, and `check-store-packages.mjs` confirms the built
  Firefox zip agrees with it.)

### What the grader checks

In a template-stamped tool this is one script: `publish/pack.mjs` runs it, and
`node publish/verify-package.node.js` runs it standalone.

> **CORRECTION — 2026-08-22.** That used to be the whole of this sentence, and it misdirects anyone
> standing in FullShot: **`publish/verify-package.node.js` exists only in `templates/tool/publish/`**, and
> `scripts/pack.mjs` does not itself perform the list below. In the `scripts/` lane the same ground is
> covered by **five commands plus a two-pack comparison**, all measured EXIT 0 on a freshly built FullShot
> zip on 2026-08-22 — the per-item notes in brackets say which one owns each check:
>
> ```sh
> node scripts/check-version.mjs <id> --expect <version>          # [parity] manifest == CHANGELOG == expected
> node scripts/pack.mjs <id> --target <t> --out dist              # [pack]   file set, locales, overlay, read-back
> node scripts/verify-refs.mjs --zip dist/<id>-<t>.zip --strict   # [refs]   51 references, case-exact
> node scripts/verify-refs.mjs --zip dist/<id>-<t>.zip --leaks    # [leaks]  85 entries against 11 rules
> node scripts/check-store-packages.mjs <id> --dir dist           # [store]  gecko.id, localised store fields
>
> # [determinism] pack a SECOND time and compare the two hashes — this is the check,
> # and nothing above performs it:
> node scripts/pack.mjs <id> --target <t> --out dist2
> a=$(node scripts/sha256.mjs dist/<id>-<t>.zip)
> b=$(node scripts/sha256.mjs dist2/<id>-<t>.zip)
> [ "$a" = "$b" ] || { echo "zip is not reproducible"; exit 1; }
> ```
>
> 🔴 **`pack.mjs` does not verify determinism — it only asserts it.** Its success line reads *"sorted,
> fixed timestamp, fixed deflate level, so two runs give one sha256"*, which is a description of how it
> builds, not a measurement that two runs agreed. An earlier draft of this block listed *determinism* in
> the `[pack]` bracket, and a reader following it locally would have got no determinism check while being
> told they had one. The real check is the two-pack-and-compare above; in CI it is its own step,
> `grep -n 'Determinism check' .github/workflows/ci.yml`. Measured 2026-08-22 on `fullshot --target
> chromium`: both packs produced 940 406 bytes and the identical sha256, and mutating one byte of the
> second copy changed the hash, so the comparison discriminates rather than always agreeing.
>
> `--strict` also **WARNs** about one injection path it cannot resolve statically
> (`background.js: files: [file]`), and names it rather than counting it as covered. That warning is
> expected and is not a failure.
>
> `dist2/` is scratch — `rm -rf dist2` when you are done; only `dist/` feeds the steps below. Measured
> 2026-08-22: `dist/` is gitignored and `dist2/` is **not**, so a forgotten `dist2/` shows up as untracked
> zips in `git status`. CI uses the same throwaway name inside a runner that is discarded whole.

The checks themselves:

- `manifest.json` is at the **root** of the archive, not nested inside a folder. Hand-zipping a folder in
  Windows Explorer nests everything and the store answers "Manifest file is missing or unreadable" — the
  most common first-upload failure there is.
- Every reference inside the package — manifest paths, `<script src>`, `<link href>`, `importScripts`
  arguments — resolves **inside the package, case-exactly**. A case mismatch is reported as its own
  verdict, separate from missing.
- No packaged script can reach the network.
- Nothing leaked: no `test/`, no `.md`, no build script, no `node_modules`, no scratch file, no
  credential-shaped filename.
- `_locales` ships in full; nothing else underscore-prefixed ships at all.
- `LICENSE` **is** in the package, deliberately — PolyForm Shield requires the terms to travel with every
  copy, and a store user receives the zip. (**FullShot still does not ship it, and the packer is no
  longer the reason.** Re-measured 2026-08-22 by building a fresh zip: `scripts/pack.mjs fullshot
  --target chromium` selects 85 files *from `tool.json`'s own `package.include`/`exclude`*, and `LICENSE`
  appears zero times in the archive — `background.js` and `manifest.json` at the root, no `LICENSE`.
  `tool.json` records the gap on purpose, under `NOTES."package.LICENSE"`, and calls adding it *"a
  licence question for the owner"*. The earlier wording here blamed *"FullShot's older packager"* and
  cited *"its shipped 1.10.1 zip"*. Both citations are stale: the list that decides what
  `scripts/pack.mjs` ships is `tool.json`'s own `package` block (`publish/package.node.js` still carries a
  separate hard-coded `ALLOW`, which is one more reason the two-packer question is open), and that 1.10.1
  zip no longer exists — see the golden-master note below. This is a divergence to close with an owner
  sentence, not a rule with an exception.)
- The manifest passes the store's upload rules: `manifest_version` 3, name and short-name and description
  length limits **in every locale**, every `__MSG_*__` resolving, no static `host_permissions`, no
  developer `key`, no `update_url`, an icon set including 128.
- Version parity across the manifest, the AMO manifest and the CHANGELOG heading. (Corrected
  2026-08-22: this line used to add *"and both filenames"*, which the versionless `<id>-<target>.zip`
  names no longer carry. In the `scripts/` lane the parity check is `check-version.mjs <id> --expect
  <tag version>`, and the AMO manifest is only a site where it is a whole manifest rather than an
  overlay.)
- A **diff against the previous release**, so a silently dropped file is caught. Versions are compared
  numerically — a lexical sort puts `1.9.7` after `1.9.11` and would quietly diff against the wrong
  release. **For FullShot this floor currently grades nothing** — see the golden-master note below.

### The build is deterministic, and that is the point

Entries are sorted, the timestamp is fixed, and the compression level is pinned, so the same inputs
produce the same bytes. A rebuild that changes the file is a change in the *code*, and it can be diffed.
That is what makes a privacy claim checkable by someone who does not trust you: rebuild from the source
at a given version and compare hashes with the artifact the store received.

The built zips are kept in `publish/` as golden masters — the exact artifacts a store received, and what
the next build diffs against. This is a deliberate divergence from the usual "build output never enters
git" rule, and the root `.gitignore` says so in place. Real release binaries also belong on a release
page; the copy in `publish/` is the reference, not the distribution.

⚠️ **A tool's own nested `.gitignore` can quietly overrule the root's exception**, and a golden master
that is not committed is not a golden master — it is a file on one machine. Check the file, do not assume
the rule: `git check-ignore -v <path-to-zip>` names the line that decided.

**The FullShot half of that warning was fixed on 2026-08-20, and the shelf is now empty for a different
reason.** Measured 2026-08-22:

- `Extension/Full_Screen_Shot/.gitignore` no longer swallows the golden masters. It carries `*.zip`
  immediately followed by `!publish/*.zip`, and `git check-ignore -v` from inside the tool confirms both
  limbs: a stray root `scratch.zip` is caught by the `*.zip` line, while
  `publish/fullshot-1.10.2.zip` is re-included by the negation line. The `.gitignore` itself records the
  old text and why it was wrong.
- **There is no golden master to diff against, because there are no zips.** `find . -name '*.zip'` over
  the whole repo returns exactly one file — `templates/tool/publish/skeleton-0.0.1.zip` — and `git
  ls-files "*.zip"` returns the same one. (Re-measured 2026-08-22 **with no build output on disk**. If you
  have just run §4 you will also see `dist/` and `dist2/`, which are yours rather than the repo's. Trust
  the `git ls-files` half, which does not depend on what you have built. Note that `dist/` is ignored —
  `git check-ignore -v dist/x.zip` names the `.gitignore` line that decided — but **`dist2/` is not
  ignored**, which is the second reason §4 tells you to delete it.)
  `scripts/pack.mjs` says so itself on every FullShot build:
  *"no previous release package … the dropped-file floor graded 0 entries. That is correct for a first
  package, and it is NOT a clean diff: nothing was compared."*
- The **first** zip committed to `publish/` re-arms that floor. Until then the dropped-file check is
  running over an empty set on the only real tool in the repo.

> **CORRECTION — 2026-08-22.** This warning used to end: *"Today only
> `templates/tool/publish/skeleton-0.0.1.zip` is tracked; FullShot's `.gitignore` carries a bare `*.zip`,
> so its **five** shipped pairs exist on disk and in no commit."* Every clause after the semicolon is now
> false. The bare `*.zip` was corrected 2026-08-20; there were **six** pairs, not five (1.9.7, 1.9.11,
> 1.9.13, 1.10.0, 1.10.1, 1.10.2); and all twelve archives were **deleted** on 2026-08-20 — the six
> Firefox ones because they carried the placeholder `gecko.id
> fullshot@REPLACE-WITH-YOUR-DOMAIN.example` and must never reach AMO. Their versions, byte counts and
> sha256s survive in `Extension/Full_Screen_Shot/publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`, which
> exists precisely so a stray copy found on a backup drive can be identified and refused.

---

## 5. Tag and release

The convention is `<tool-id>-v<version>` — `fullshot-v1.10.1`. Ids are lowercase-kebab and permanent
(see [ARCHITECTURE.md](ARCHITECTURE.md#1-naming)).

```
git commit -am "fullshot: v1.10.1 — <what changed>"
git tag fullshot-v1.10.1
git push origin main --tags
```

`fullshot-v1.10.1` is the house illustration — `release.yml`, `scripts/check-version.mjs` and
`scripts/changelog-section.mjs` all use the same one, so it is kept here rather than freshened. **The
real tag must carry the manifest's version**, which is `1.10.2` today; `check-version.mjs <id> --expect
<version>` (or `--tag <the tag>`) is what proves it.

A release carries both packages and their checksums — the names are the packer's, with no version in
them:

```
<id>-chromium.zip
<id>-firefox.zip
SHA256SUMS.txt
```

**`release.yml` exists and has never run — no tag has been pushed** (`git for-each-ref refs/tags`
returns 0, measured 2026-08-22). It fires on `<tool-id>-v<semver>` and `<tool-id>-v<semver>.<n>` (and
excludes `core-v*`, which is versioned but is not a tool), then re-runs the gates, builds both packages,
checksums them with `sha256sum` and creates the release with `gh`. Two rules survive automation either
way: the tag must be on an ancestor of the default branch, and the tag version, the manifest version and
the top CHANGELOG entry must be the same string — the check that kills the entire class of "shipped
1.10.1 with 1.10.0 in the manifest".

🔴 **Both packages go to a PUBLIC repository the instant the tag lands.** `release.yml`'s
`gh release create` carries no `--draft`, so there is no throwaway tag and no rehearsal: pushing one
*is* the publish.

**FullShot satisfies the three-number check today.** Measured 2026-08-22:

```
node scripts/check-version.mjs fullshot --expect 1.10.2   ->  EXIT 0, 4 passed
node scripts/check-version.mjs fullshot --expect 1.10.1   ->  EXIT 1, 3 passed · 1 FAILED
```

The red half is shown deliberately: the gate discriminates, so its green is worth something.

> **CORRECTION — 2026-08-22.** Two sentences here were false and both would have cost a session.
> (a) *"Until its `scripts/` gates are all present, creating the release and attaching the artifacts is
> manual"* — every gate path the workflows name is present, `ci.yml`'s own inventory says *17 of 17*, and
> the derivation you can run yourself is in the correction at the top of this document.
> (b) *"FullShot cannot satisfy that check yet: it has **no `CHANGELOG.md`**, so only two of the three
> numbers exist to compare. Backfilling it is a prerequisite for its first tag."* —
> `Extension/Full_Screen_Shot/CHANGELOG.md` exists, **12 874 bytes**, ten `## [x.y.z]` headings from
> `[1.10.2] — 2026-08-15` down to `[1.9.7] — 2026-07-16`, and `check-version.mjs` prints *"CHANGELOG top
> entry is [1.10.2] — agrees with the manifest"*. There is nothing to backfill.

---

## 6. After it is live

- Install the published item yourself, on a profile that is not your development profile, and do the
  thing the single-purpose sentence promises.
- Keep the shipped zip as the golden master for the next diff.
- Write the first line of the next CHANGELOG entry while you still remember what you are about to do.

Two failure modes are worth remembering because they cost days rather than minutes:

- **A resubmission restarts the review queue.** Getting the listing right the first time is worth an
  hour of care; see [STORE-PLAYBOOK.md](STORE-PLAYBOOK.md).
- **Never upload a hand-zipped folder.** Besides the nesting problem, hand-zipping sweeps in `test/`,
  whose fixtures deliberately contain network APIs inside an item whose listing claim is that it makes
  none. The allowlist makes that impossible; a right-click makes it likely.


---

## Appendix A — the release lane, measured 2026-08-25

**Appended, not merged into the sections above** — every dated block in this document stays as it was
written, and this one corrects two of them by name rather than by rewriting them.

Everything below was measured on 2026-08-25 in a working tree where **other in-flight work was editing
`.github/workflows/ci.yml`**. Where that perturbs a figure it is said so on the line, and the reproduction
command is given so you can take your own.

### A.1 — two holes in `release.yml` were closed on 2026-08-25

Both were the same family: a step whose *shell flags* decided its verdict instead of its subject.

**`Checksums` published its digest list through an unguarded pipe.** The body was
`run: cd dist && sha256sum *.zip | tee SHA256SUMS.txt` with **no `shell:` key**, and this file has no
`defaults:` block (`grep -n '^defaults:' .github/workflows/release.yml` → no match). GitHub runs a bare
`run:` as `bash -e {0}` — `-e` but **not** `-o pipefail` — so the step’s status was `tee`’s. Measured on
the old one-liner against three `dist` fixtures in a temp tree:

| `dist` fixture | `bash -e` (the old flags) | `bash --noprofile --norc -eo pipefail` |
| --- | --- | --- |
| 0 zips | **EXIT 0**, `SHA256SUMS.txt` 0 bytes | EXIT 1 |
| 1 hashable zip of 2 | **EXIT 0**, `SHA256SUMS.txt` 1 line | EXIT 1 |
| 2 hashable zips of 2 | EXIT 0, 2 lines | EXIT 0 |

The zero-zip row is **not** the reachable one — `Reference integrity + leak check on every artifact` above
already exits 1 when `dist/*.zip` matches nothing. The reachable row is the middle one: a *partial*
failure, where the glob matches N zips and `sha256sum` can hash fewer, and the step went green having
published a **short** list. That matters because `Release notes from CHANGELOG` appends *“Artifacts are
byte-reproducible: rebuild from this tag … and compare SHA256SUMS.txt”* and `gh release create` uploads
`dist/SHA256SUMS.txt` to a **public** release. The step now carries `shell: bash`, `set -euo pipefail`,
and a positive count check (`digest lines == zips present`) rather than a tripwire on `sha256sum`’s
wording. Re-measured with pipefail deleted from *both* the body and the shell, so only that count check
could bite: 1-of-2 fixture **EXIT 1**, 2-of-2 fixture **EXIT 0**; weakened to the naive
`[ "$listed" -lt 1 ]`, the 1-of-2 goes **EXIT 0**. The equality is what bites.

⚠️ **What that step does *not* catch, on purpose.** It compares digest lines to the zips *present in
`dist`*. A build that wrote one zip instead of two is 1 zip and 1 digest, so `Checksums` is correctly
green on it — measured on real `--release` artifacts. Catching a **missing** package is the next fix’s job.

**`The built packages are uploadable` ran its gate bare, and that gate says its exit code is not the
verdict.** Measured from the repo root with no `dist/`:

```
node scripts/check-store-packages.mjs fullshot --dir dist   ->  EXIT 0
  0 store package(s) opened and graded, 0 unreadable, across 2 declared target(s).
  ZERO PACKAGES WERE PRESENT, so this run proved nothing about any artifact.
  ... Read this line rather than the exit code.
```

The step now wraps it the way the AMO step below it already did — `shell: bash`, `set -euo pipefail`,
`out=$(…) || code=$?`, print, fail on nonzero — **and then asserts `graded == declared`, parsed from that
tally line.** The equality is the whole fix: `graded > 0` passes the realistic failure, which is not an
empty `dist` but a half-built one. Measured against a real `--release` build of both FullShot packages,
then with `dist/fullshot-firefox.zip` removed / corrupted:

| `dist` state | the script prints | its bare EXIT | the step |
| --- | --- | --- | --- |
| both zips | 2 graded / 2 declared, 5 passed | 0 | EXIT 0 |
| chromium zip only | 1 graded / 2 declared, 3 passed | **0** | **EXIT 1** |
| present but empty | 0 graded / 2 declared, 0 passed | **0** | **EXIT 1** |
| firefox zip corrupted | 3 passed · 1 FAILED | 1 | EXIT 1 |

With the assertion weakened to `[ "$graded" -lt 1 ]` the chromium-only row goes **EXIT 0** on the same
fixture. It is deliberately **not** keyed on the `ZERO PACKAGES WERE PRESENT` wording: that is the
script’s failure text, and a tripwire on failure text goes quietly green the day the text changes. Before
this change the missing-Firefox-zip case was caught for exactly one tool, by the
`if: steps.tag.outputs.id == 'fullshot'` AMO step; the new assertion holds for every tool and every
declared target.

⬜ **OPEN, and not part of this change.** `ci.yml` calls the same script the same bare way in its
`package` job — `grep -n 'check-store-packages.mjs ${{ matrix.tool }} --dir dist' .github/workflows/ci.yml`
finds it — so the PR-time twin of this gate still reads an exit code the script disclaims. Fixing it
belongs with whoever owns `ci.yml`.

### A.2 — CORRECTION to the header block: `release.yml`’s anchored `shell: bash` count is now **4**

The block near the top of this document reports `grep -cE "^        shell: bash$"` as **7** for `ci.yml`
and **2** for `release.yml`, measured 2026-08-22. The `release.yml` half is superseded: the two steps in
A.1 each gained a `shell: bash` key, and the same command returned **4** on 2026-08-25.

The `ci.yml` half is **deliberately not re-pinned here.** That file was being edited by other work while
this was measured, and the same command returned a different number than 7 during it. Run it yourself;
do not carry either figure forward on trust. The point the original sentence makes — that a handful of
steps are inline `bash` and are not runnable as-is in PowerShell — is unchanged and now applies to two
more of them.

### A.3 — CORRECTION to a dated comment inside `release.yml`: one sentence in it is stale

`release.yml`’s 2026-08-22 comment block above the AMO step says:

> The repository’s most detailed AMO gate therefore graded no package on any path, and least of all on the
> one that ships one.

(`grep -n 'graded no package on any' .github/workflows/release.yml` finds it; line numbers move.)

**That is no longer true, and it is corrected here rather than by rewriting the dated block.** Measured
2026-08-25: `ci.yml`’s `package` job runs

```
out=$(node Extension/Full_Screen_Shot/publish/verify-firefox-package.node.js --zip "$zip" 2>&1) || code=$?
```

with the same `grep -q '^ALL PASS$'` wrapper — `grep -n 'verify-firefox-package.node.js --zip'
.github/workflows/ci.yml` finds it. So the `--zip` limb **is** exercised on CI, on every PR that builds a
Firefox package. The sentence was true of the tree it described and stopped being true when that `ci.yml`
step landed. What survives from it is the *reason* the wrapper exists, which is still exactly right: the
script exits 0 having graded nothing, so both steps assert `ALL PASS` instead of trusting the code.

### A.4 — “The release lane is untested” is FALSE. **Four** things in it have never executed.

`release.yml` has still never fired: `git for-each-ref refs/tags | wc -l` → **0**, `git tag | wc -l` →
**0**, `git ls-remote --tags origin | wc -l` → **0**, all re-measured 2026-08-25. But *never fired* is not
*never proven*: most of what it runs is the same call `ci.yml` makes on every PR, and writing off the
whole lane would send the next reader re-deriving all of it.

Token occurrences over each file’s **full text, comments and prose included** — the literal rule is
`grep -oE '<token>' <file> | wc -l`, so these are *mentions*, not call counts. Measured 2026-08-25 **after**
the A.1 edits:

| token | `ci.yml` | `release.yml` |
| --- | --- | --- |
| `check-version\.mjs` | 2 | 1 |
| `pack\.mjs` | 12 | 7 |
| `\-\-release` | 2 | 5 |
| `check-store-packages` | 2 | 3 |
| `verify-refs\.mjs` | 3 | 1 |
| `web-ext` | 6 | 5 |
| `verify-firefox-package` | 3 | 1 |
| `\-\-zip` | 4 | 3 |
| `\-\-expect` | **0** | 1 |
| `changelog-section` | **0** | 1 |
| `sha256sum` | **0** | 5 |
| `gh release` | **0** | 2 |

The `release.yml` column moved on 2026-08-25 for four of those tokens (`--release` 4→5,
`check-store-packages` 1→3, `sha256sum` 2→5, `gh release` 1→2) purely because the new comment blocks
discuss them. That is the counting rule doing what it says, and it is why the load-bearing half of this
table is the **zeros in the `ci.yml` column**.

**The four genuinely unexecuted things, named precisely:**

1. **`Parse tag  (fullshot-v1.10.1 → id + version)`** — reads `GITHUB_REF_NAME` and writes the `id` and
   `version` outputs every later step interpolates. It *cannot* exist in `ci.yml`: there is no tag on a
   PR. Never executed anywhere.
2. **`Tag must be reachable from main`** — `git fetch --no-tags …` then
   `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`. Same reason; no `ci.yml` equivalent exists.
3. **`Checksums` / `sha256sum` / `SHA256SUMS.txt`** — `sha256sum` has **0** hits in `ci.yml`. CI proves
   determinism through `scripts/sha256.mjs`, a *different program* that hashes two builds and compares
   them; the coreutils binary and the published digest file are release-only. The rewritten body was
   exercised locally against the fixtures in A.1, but no runner has ever run this step.
4. **`Publish GitHub Release` / `gh release create`** — **0** hits in `ci.yml`, and it must never be
   rehearsed. It carries no `--draft` and both repositories are public, so pushing a test tag publishes a
   permanent public release. There is no safe way to execute this step as it stands; see A.6.

Two clarifications that keep this list honest:

- **An unproven step is not a broken one.** Nothing above is a defect. It is an inventory of what a first
  tag will exercise for the first time.
- **The A.1 wrappers are release-only code and have never run on a runner either**, but their *subjects*
  (`check-store-packages.mjs`, `sha256sum`) are covered above, and both bodies were extracted from the
  YAML and run under the runner’s exact flags against passing and failing fixtures. They are not a fifth
  unknown.

### A.5 — the two release-only *scripts* were exercised off-runner, 2026-08-25

Run from a detached worktree of `main`, bare, exit code captured on its own line:

```
node scripts/check-version.mjs     fullshot --expect 1.10.2   ->  EXIT 0
node scripts/check-version.mjs     fullshot --expect 9.9.9    ->  EXIT 1
node scripts/changelog-section.mjs fullshot 1.10.2            ->  EXIT 0
node scripts/changelog-section.mjs fullshot 9.9.9             ->  EXIT 1
```

The red halves are shown deliberately: both gates discriminate, so their green is worth something.
`changelog-section.mjs` reported on stderr *“emitted [1.10.2] — heading on
Extension/Full_Screen_Shot/CHANGELOG.md line 25, section ends at line 62 — 34 line(s), 2145 byte(s) on
stdout”*.

⚠️ **Read that as a line count, not a byte count.** The redirected file is **2148** bytes with **34** LF
line endings and **5** non-ASCII bytes: the script’s figure is a JavaScript string length, so it
undercounts every multi-byte character by the bytes they add. The **34 lines** figure reproduces exactly.

### A.6 — PROPOSED, not implemented: a `workflow_dispatch` dry run

The only way to raise confidence in A.4’s items 1–4 without publishing something permanent is to give
`release.yml` a `workflow_dispatch` trigger with a dry-run input — supplying the tag string by hand,
running every gate, building both packages and writing `SHA256SUMS.txt`, then **stopping before
`gh release create`**.

**It is deliberately not done in this change.** It alters the workflow’s trigger surface, which is a
decision with a cost rather than a cleanup: a second entry point into the one job that holds
`contents: write` needs its own thinking about who may press it and what an input can reach. It is raised
in the pull request instead, for a decision.
