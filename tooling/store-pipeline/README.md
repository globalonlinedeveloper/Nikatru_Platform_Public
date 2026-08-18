# `tooling/store-pipeline` — the per-slot build pipeline, as ONE template

A **slot** is a Store × Target × Type cell of the store matrix: the directory pair that holds one
product's public and private trees for one storefront. `catalog/store-matrix.json` declares fifteen of
them. Under the owner's FULL SOURCE COPY decision, each of those fifteen gets its own repository pair,
and therefore its own build pipeline.

**This directory is that pipeline, written once.** Not fifteen copies — one template plus a resolver
that works out, at run time, which slot it is standing in.

---

## 1. How it is parameterised — the whole design in one paragraph

A slot repository is one checkout, and nothing inside it says *"I am the Microsoft Store / Windows /
Games slot"*. Nothing should: a `slot.json` committed into each repo would be fifteen typed copies of a
fact `catalog/store-matrix.json` already holds. So `resolve-slot.mjs` **matches the checkout against the
registry** — by explicit flag, by `SLOT_PUBLIC_DIR`, by the git origin against the row's `boundRemote`,
by `GITHUB_REPOSITORY`, by the checkout's own directory name — requires the signals it finds to agree,
and then **derives everything else from two registers that already exist**:

| Fact | Derived from |
|---|---|
| store · target · type · public/private dir | `catalog/store-matrix.json`, the row |
| which channel this slot ships through | `tooling/channel-register.json`, the row whose `platforms` contains the target |
| artifact format(s) | that channel's `artifactFormats` |
| toolchain | that channel's `minimumToolchain` |
| signing key kind and the secret NAMES | that channel's `signing` block |
| submission script / workflow / job | that channel's `submission` block |
| listing metadata directory | that channel's `storeMetadataDir` |
| **the runner label** | the `runs-on:` of the job that channel's `lane` names — parsed, not typed |
| **the toolchain version** | the `env:` of that lane's workflow — parsed, not typed |
| which Flutter platform directory is this slot's own | `catalog/copy-origins.json` `targetPlatformDirs` |

🔴 **No store name, runner label, toolchain version or channel id is written anywhere in the workflow
templates.** Grep them. A new store is meant to be a ROW in `store-matrix.json`; if the pipeline needed
a code change to notice it, the pipeline would have broken that promise.

Two facts genuinely have no home in any existing register, so this directory gives each one **exactly
one** home and a both-directions guard: which build verb emits which artifact format
(`artifact-build.mjs`), and how each channel is signed and how that signature is proven
(`signing-seams.mjs`). Both are held to `tooling/channel-register.json` — every key must be a real
channel/format, and every real channel/format must have a key.

---

## 2. Files

| File | What it is |
|---|---|
| `slot-build.yml` | The build pipeline. Installed **byte-identically** in every slot as `.github/workflows/slot-build.yml`. Runs on push/PR/dispatch. Signs nothing, references no secret, cannot reach a store. |
| `slot-submit.yml` | The submission pipeline. Dispatch-only, four gates, one marked per-slot block. |
| `resolve-slot.mjs` | The parameteriser. Answers "which slot is this and what does it build". |
| `artifact-build.mjs` | Data. Artifact format → build verb, and **where the packaging actually happens**. |
| `signing-seams.mjs` | Data. Channel → how it is signed, and how (or whether) that can be proven. |
| `slot-signing.mjs` | Dispatcher over `signing-seams.mjs`. `--prepare` before the build, `--verify` after it. |
| `assert-slot-pipeline.mjs` | The guard over all of the above. Ten checks; see §6. |
| `test/slot-pipeline.test.mjs` | 24 cases that break the **real** template and require the guard to go red. |

### Installing it into a slot

```
cp tooling/store-pipeline/slot-build.yml  .github/workflows/slot-build.yml
cp tooling/store-pipeline/slot-submit.yml .github/workflows/slot-submit.yml
# then edit ONLY the marked PER-SLOT block in .github/workflows/slot-submit.yml
node tooling/store-pipeline/assert-slot-pipeline.mjs      # must exit 0
```

GitHub Actions requires a workflow to live under `.github/workflows`, so the copy is forced by the
platform rather than chosen — which is exactly why check 10 exists: the guard compares the installed
copy against the template **in the same checkout**, byte for byte. It has to, because
`catalog/copy-origins.json` classifies `.github/workflows/**` as *per-slot*, meaning
`assert-copy-parity.mjs` **never compares these files across slots**. Nothing else would notice fifteen
divergent copies.

---

## 3. What is genuinely per-store, and what is shared

Stated plainly, because the difference is the whole engineering content of this template.

### Shared — one implementation, no per-slot edits
- Slot identification, and every refusal that comes with it.
- Channel resolution, artifact format, toolchain, runner label, toolchain version.
- The entire build lane: checkout, toolchain setup, `flutter build`, artifact upload.
- The whole *shape* of the submission lane: gate → resolve → dry-run → approved submit.
- The four submission gates, and the guard that proves they are still there.
- The "there is no product here" reporting.

### Genuinely per-store — different mechanisms, not different values
- **Signing.** Play: an upload key we hold, materialised into the runner, read by Gradle — and Play
  binds that certificate at the first upload. Apple: a developer identity in a temporary keychain,
  provisioning profiles, and notarisation (a network round trip that is *part of* signing). Microsoft:
  package identity bound at first submission, Store-signed for Store distribution. Snap: **no key of
  ours at all** — Canonical signs the binary. AMO: the add-on id is fixed **permanently** at first
  signing. These are five different things; only `signing-seams.mjs` knows which is which.
- **Store credentials.** GitHub Actions cannot safely name a secret dynamically, so the names must be
  written literally somewhere. They are written once, inside the `PER-SLOT BLOCK BEGIN/END` markers in
  `slot-submit.yml`, and the guard requires every one of them to be a name the register declares **for
  this slot's channel**.
- **Artifact format and packaging.** `flutter build windows` produces a directory of loose binaries,
  **not** an `.msix`; `flutter build linux` does not produce a `.snap`. `artifact-build.mjs` records
  where each packaging step really happens, including the entries that say *nowhere in this repository*.
- **The submission API.** Play's edit lifecycle, App Store Connect, Partner Center, `snapcraft upload`,
  the AMO signing API — five protocols. The template never implements one; it runs the script the
  register names for the channel, or refuses if the register names none.
- **Store listing metadata.** `apps/{app}/store/<channel-id>/…`, per channel, and correctly so.

---

## 4. What this template will not do

- **No secret value is in any file here.** Only `${{ secrets.NAME }}` indirections. Guard check 9 scans
  every file in this directory for PEM blocks, token shapes and long base64 runs.
- **`slot-build.yml` references no secret at all and contains no `--submit`.** It runs on every push; a
  lane on that trigger that can authenticate to a store is a one-way door left ajar.
- **Nothing can submit without a deliberate, typed, reviewed act.** `slot-submit.yml` is
  `workflow_dispatch` and nothing else; the submitting job needs a confirmation string **derived from
  the slot** (`SUBMIT-<store>`, so a dispatch copy-pasted between slot repos does nothing), an
  `environment:` reviewer gate, a passing dry run on the same commit, and a signature check that runs
  **before** the submit step.
- **`environment:` alone is not trusted.** GitHub's documented behaviour: *"Running a workflow that
  references an environment that does not exist will create an environment with the referenced name."*
  A typo therefore creates an unprotected environment and runs immediately, and the history then shows a
  deployment, which reads like an approval. Measured in this repository on 2026-08-09: every environment
  that existed returned `"protection_rules": []`. The submission script's own environment check is what
  covers that; `submit-play.mjs` has one (PG-5), and **a script for any other store must grow the same
  limb before it is pointed at a real account.**
- **Nothing here creates, renames or deletes a repository, and nothing here can.**

Every store-submitting step is treated as one-way, because for at least one store in this matrix the
door has no handle on the other side: **FullShot's AMO add-on id is permanent from first signing.**

---

## 5. 🔴 THE THING THIS TEMPLATE CANNOT SOLVE

**Twelve of the fifteen slots have no product, and a pipeline for a slot with no source is a pipeline
that has never run.**

Measured, not assumed. `catalog/store-matrix.json` re-measured the inherited "12 of 15" as **11
shell-empty + 3 shell-claimed + 1 live**, under its own counting rule (a slot is *backed* when a real
tree exists today that it would be built from — the three extension slots are backed by FullShot, which
sits outside the store tree and is not filed into them). Both numbers are recorded rather than
reconciled; the disagreement is about the counting rule, not about the tree.

What the resolver actually reports today, run against all fifteen rows:

| Slots | Outcome |
|---|---|
| 1 (Google Play / Android / Apps) | resolves, has a product, has a build lane, has a signing seam and a verifier |
| 2 (Play / Android / Games) | resolves to a real channel; **no product** |
| 2 (Microsoft Store / Windows) | resolves; **no product**; `.msix` has a signing seam but **nothing in this repository can read an `.msix` signature** |
| 2 (Linux Store / Linux) | resolves; **no product**; no key of ours — Canonical signs |
| 4 (Apple App Store / iOS · macOS) | resolves; **no product**; **`lane: null` — this repository has no job that emits an `.ipa` or a `.pkg` at all** |
| 2 (Nikatru Web Store / Web) | resolves; **no store channel** — the web channel is `submittable: false`, so there is correctly no submission lane |
| 3 (Chrome · Edge · Firefox) | **exit 4, NO CHANNEL** — `tooling/channel-register.json` has never described a browser-extension channel, and nothing here invents one |

No amount of templating changes any of that. A template can make an empty slot *resolve* correctly; it
cannot make it *build*.

### The two failure modes this creates, and what is done about each

**(a) The empty slot that looks green.** If the build job is simply skipped when there is no product,
the workflow shows a green tick — the exact shape of a check that has stopped checking. So
`slot-build.yml` carries a `no-product` job whose `if:` is the exact complement of the build job's, and
whose entire output is a step summary reading **`⬜ NEVER BUILT — no product in this slot`**. Green there
means *"the pipeline correctly found nothing"*, in words, not inferred from a colour. Guard check 6
requires both jobs to exist with complementary conditions, so deleting the second one to tidy the run
list fails the build instead of quietly restoring the vacuous green.

**(b) Proving a pipeline you cannot run.** Running `resolve-slot.mjs --slot <another-slot>` from inside
*this* checkout finds `apps/subly/ios`, `apps/subly/windows` and so on — because this one app carries
all six Flutter platform directories. That would report "product present" for a slot whose repository
pair is empty. **Capability is not backing**, and counting the first as the second is exactly how
fourteen empty directories start reading as a portfolio. So an overridden run reports
`productState: not-measurable-here` and refuses to answer. To measure a slot's product, stand in that
slot.

### How a slot proves its pipeline works before it ships anything

Nothing below requires a store account, and nothing below can reach a store. In order, each step
producing evidence a person can read:

1. **The slot resolves, unambiguously.** `node tooling/store-pipeline/resolve-slot.mjs` in the slot
   repo. Exit 0 and the printed plan names the right store, target, channel, format and runner. Exit 2
   means the checkout cannot be identified — fix that before anything else, because every step below
   would be answering about the wrong slot.
2. **The template is intact.** `node tooling/store-pipeline/assert-slot-pipeline.mjs`, with no
   `--template-only` flag, in the slot repo. It compares the installed workflows against the template
   and the two tables against the register.
3. **The guard can still fail, in this checkout.**
   `node --test tooling/store-pipeline/test/slot-pipeline.test.mjs` — 24 cases that break the real
   template and require red. A guard whose failing path is never exercised reports "ok" forever after it
   stops working; this repository has already lost weeks to that, twice.
4. **The pipeline runs and correctly reports nothing.** Push. The run must show `no-product`, green,
   with the `⬜ NEVER BUILT` summary — **not** a skipped build job and a bare green tick.
5. **A real product lands in the slot** (STORE-MATRIX-PLAN.md Step 7). The `no-product` job must now
   NOT run, the `build` job must, and it must produce an artifact whose name ends `-unsigned`.
6. **The dry run walks the whole submission path.** Dispatch `slot-submit.yml` leaving `confirm` at its
   default. The dry-run job must sign, build, **read the signature back out of the artifact**, and run
   the register's submission script with `--dry-run`. If `slot-signing.mjs --verify` exits 2 — as it
   will today for Microsoft Store and Linux slots — **the slot is not ready to submit**, and that
   refusal is the honest state, not an obstacle to route around.
7. **Only then** does the confirmation string exist to be typed, and even then a reviewer must approve.

**Steps 1–4 are available to every slot today, including the twelve with nothing in them.** They prove
the pipeline resolves, is intact, and reports emptiness out loud. They do **not** prove it builds, and
this README will not let anyone say they do. Steps 5–7 are the only proof that exists, and they require
a product.

---

## 6. Proof this guard can fail

Run against the **real** tree on 2026-08-18. Every mutation edited a real file in this repository and
was restored; the tree hash before and after matched.

```
baseline (unmutated)                                     exit=0
M1  delete environment: from the submitting job          exit=1  RED
M2  confirm input defaults to a confirming value         exit=1  RED
M3  add a push trigger to the submit workflow            exit=1  RED
M4  drop the signature check before --submit             exit=1  RED
M5  secret reference outside the per-slot markers        exit=1  RED
M6  name a secret this channel does not declare          exit=1  RED
M7  run --submit from the BUILD lane                     exit=1  RED
M8  reference a secret from the BUILD lane               exit=1  RED
M9  delete the no-product job                            exit=1  RED
M10 break the build/no-product complement                exit=1  RED
M11 add a format to the REAL channel register            exit=1  RED
M12 remove a key from the artifact-build table           exit=1  RED
M13 remove a channel's signing seam entry                exit=1  RED
M14 point a seam at a script that does not exist         exit=1  RED
M15 plant a base64 credential blob in a template         exit=1  RED
M16 add a 16th slot with an uncovered target             exit=1  RED
M17 declare an uncovered target that IS covered          exit=1  RED

no --template-only, copies absent (expect 2)             exit=2  as expected
--template-only WHILE installed (expect 2)               exit=2  as expected
installed byte-identical, no flag (expect 0)             exit=0  as expected
installed copy drifts by one byte (expect 1)             exit=1  as expected
only one of the two workflows installed (expect 1)       exit=1  as expected

node --test tooling/store-pipeline/test/slot-pipeline.test.mjs
  tests 24 · pass 24 · fail 0                            exit=0
```

**Two defects the writing of these tests found, in the code being tested:**

- The guard's first run raised **three findings, all of them its own prose** — the templates discuss
  `--submit` and `secrets.` at length in their headers, and a raw text scan reported the documentation
  as the defect. Now scanned over the parsed, comment-stripped lines. This repository's own rule:
  *assert on parsed structure, never by grepping prose.*
- `resolve-slot.mjs --slot <a name that does not exist>` **matched no row, contributed no signal, and
  fell through to the checkout directory** — so a run that named a slot it could not find silently
  resolved to the flagship and exited 0. That is precisely the fallback the script's header promises
  does not exist, reached by the one path nobody looks at: a typo. It now refuses.

### The absences, and why they get different answers

`assert-slot-pipeline.mjs` refuses (exit 2) rather than passing when it cannot see its subject. The
installed-copy check has two ways to have no subject and they must never share an answer: *this checkout
is the origin and has not installed the template* (normal — declare `--template-only`, and the number of
assertions not made is printed in capitals), versus *a slot repository deleted its installed workflow*
(the failure this guard exists for). Passing on the first would report the second as the first, forever.
And `--template-only` is self-policing: pass it where the workflows **are** installed and it refuses, so
the waiver cannot outlive its reason.

---

## 7. Known limits — stated rather than discovered later

- **Not wired into `ci.yml`, deliberately.** Its two siblings — `assert-store-matrix.mjs` and
  `assert-github-matrix.mjs` — are not either, for the reason `catalog/store-matrix.json` records: an
  insertion into `ci.yml` shifts every `ci.yml:NNNN` citation below it, and the private corpus holds
  roughly 1,647 of them. In a **slot** repository the guard is not unwired: `slot-build.yml` runs it as
  its first real step, on every push.
- **A corollary worth saying out loud:** `tooling/ci/assert-guard-coverage.mjs` requires every `.mjs` in
  `tooling/ci` to be reachable from a workflow. Nothing here lives in `tooling/ci`, so that reachability
  rule does not reach these files. The compensating mechanism is the bullet above — the template's own
  workflow runs the guard in every slot — and it is a compensating mechanism, not an equivalent one.
- **This template presupposes that `tooling/` is copied per slot.** STORE-MATRIX-PLAN.md §5.6 is OPEN
  and moves the copy cost by roughly 4×. If the answer turns out to be "centralised", these scripts are
  not in a slot repo and neither are the registers they read. That is not papered over: `resolve-slot.mjs`
  exits 2 naming §5.6 when it cannot find `catalog/store-matrix.json` and `tooling/channel-register.json`
  in an ancestor, and again when `tooling/ci/workflow-scan.mjs` (the shared workflow parser, deliberately
  not re-implemented here) is absent.
- **`.github/workflows/**` is `per-slot` in `catalog/copy-origins.json`, so `assert-copy-parity.mjs`
  never compares the installed workflows across slots.** The within-repo byte comparison is the only
  thing standing against fifteen silent divergences. `tooling/**` is `undecided` there, so this
  directory appearing in a second slot will be reported as a finding naming §5.6 — which is that guard
  working, not failing.
- **Four Apple slots have `lane: null`.** The template reports NO BUILD LANE for them and stops. That is
  a real hole in this repository, surfaced rather than filled with a guess.
- **Three extension slots have no channel at all.** Exit 4. Adding one is a row in
  `tooling/channel-register.json` plus an entry in `signing-seams.mjs`; the guard will demand both.
- **`.msix` and `.AppImage` signatures cannot be verified here.** `signing-seams.mjs` records
  `verify: null` with the reason, and `slot-signing.mjs --verify` **refuses** on it. Those slots cannot
  honestly claim a verified artifact, and therefore cannot submit, until a reader exists.
- **The `store-publish` environment does not exist in this repository**, and creating it is a repo-admin
  act. `.github/workflows/submit-play.yml`'s header carries the exact `gh api` commands for a human to
  run. Until then, gate 3 is inert and gate 4 is what stands.
- **Nothing in this template has ever run in CI.** Every timeout in both workflow files is marked
  `⬜ NEVER RUN` and sized from the nearest measured job in `build-platforms.yml`. Re-pin them against
  the first real run.
