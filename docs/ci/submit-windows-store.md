# `submit-windows-store.yml`

The prose that used to live inside `.github/workflows/submit-windows-store.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains,
retracts or records a measurement is here. Read `docs/ci/README.md` first —
it carries the rules every workflow in this repository has to obey.

## File header

### above `on:`

[pipeline D-10] limb (i) — "a submission script exists AND RESOLVES TO A STEP
IN A WORKFLOW, parsed not grepped". This workflow is the step it resolves to.
tooling/channel-register.json's windows-store row names this file and this job
in its `submission` block, so deleting either is a register that points at
nothing rather than an unnoticed loss.

🔴 DISPATCH-ONLY, AND THAT IS THE CORRECT SHAPE WHILE `served: false`.
The channel has no publisher account (OWNER_QUEUE A-2) and the MSIX package
identity is still the PARTNER-CENTER-PENDING sentinel, so there is nothing to
submit TO. What this proves on demand is that the path from source to a
validated, store-shaped package still WALKS — the listing tree is complete and
derived from the spec, the .msix actually builds, and the identity the register
declares is the identity `msix` packages. That is the whole of D-10's promise:
submission #2 costs minutes, not archaeology. Submission #1 costs the account.

⏱ 2026-09-22 — the account exists and is verified (Partner Center Legal
info: Company, Active, Authorized), and the package identity is no longer the
sentinel: the register row and apps/subscriptiontracker/pubspec.yaml carry the
real values, and `assert-channel-register.mjs` §6e recomputes the Package
Family Name from the publisher. Dispatch-only stays the correct shape: the row
is still `served: false`, and a first submission is the owner's word.

⚠️ IT RUNS THE REAL THING, NOT A DOUBLE. The dry run is deliberately NOT given
--allow-missing-artifact: the job builds Windows and packages the MSIX first,
so the script validates a package that exists on disk. A dry run that skipped
the artifact would report the path healthy while never touching the one output
the channel actually accepts.

The script's `--submit` mode refuses with UNVERIFIED rather than guessing at
Partner Center's endpoints.

⏱ 2026-09-22 — stale since 2026-09-12, when the script's own header was
corrected: `--submit` REALLY SUBMITS and is gated, not refused. Read from the
source (not run): it fails closed without the typed `--confirm` phrase (PG-1),
outside GitHub Actions (PG-1b), with any of the five `MS_STORE_*` secrets empty
(PG-3), and unless the publish environment carries a required reviewer read
back from the GitHub API (PG-6). The placeholder-identity refusal no longer
fires for subscriptiontracker, whose identity is now real.

## job `gate`

### above `gate:`

Same shape and same reason as build-platforms.yml's gate job: this workflow
runs a `flutter build --release`, and a release build from an ungated commit
is [pipeline R-6]'s whole subject. assert-release-provenance.mjs walks the
`needs` graph, so gating once here covers the job below.

### above `timeout-minutes: 25`

25, not 10, and the number comes from the script rather than from the clock:
assert-gate-passed.mjs POLLS for up to its own 1200 s default (this call
leaves `--timeout-seconds` unset), so any bound at or under 20 kills it
mid-poll and replaces "timed out waiting for ci-gate" with an opaque
cancellation. Kept byte-identical in all five `gate:` jobs. [pipeline F-5b]

## job `dry-run`

### above `timeout-minutes: 20`

20, and the number is headroom over a measurement rather than a neighbour:
run 32947216531 (2026-08-26) completed this job in 8m32s with all 11 steps
green, including a real `dart run msix:create` — windows build 5m10s.

### before step **Build windows**

The backend defines. Without them `AppConfig.isBackendLive` stays false —
every field is still at its PLACEHOLDER — and the .msix packaged below is
the DEMO build: mock sign-in, seeded data, no crash sink. Found on the
Google Play lane 2026-08-04 and true of every store lane in the tree;
graded by tooling/ci/assert-store-build-config.mjs.

### before step **Dry-run the Microsoft Store submission**

The credentials do not exist yet — OWNER_QUEUE A-2 creates the Partner
Center account that issues them — and the script reports their ABSENCE as
a printed gap rather than a failure. `secrets` are empty strings when
unset, which is what the script's presence check reads.

---

## `--submit` is implemented — 2026-09-07, and what it is implemented *against*

**Appended, not rewritten.** Everything above describes the tree as it stood
while `--submit` refused; the refusal is gone and the reason it existed is not.

Six of the seven `UNVERIFIED` facts were replaced by pages fetched on
2026-09-07 and recorded in `PRIMARY_SOURCES` inside
`tooling/release/submit-windows-store.mjs`. Every one of them is re-checked at
run time: blank a URL and `--submit` refuses naming the key, before any call is
made — `windows-store-submission.test.mjs` mutates one and proves the exit 1
with a green control first.

| fact | source (fetched 2026-09-07) |
|---|---|
| base URL + API version | `https://manage.devcenter.microsoft.com/v1.0/my` — *Manage app submissions* |
| create a submission | `POST .../applications/{applicationId}/submissions` |
| the package upload URL | the `fileUploadUrl` SAS URI in the create response — *Create an app submission* |
| listing metadata shape | `listings.<lang>.baseListing`, `applicationPackages[]` — same page |
| commit + status | `POST .../submissions/{id}/commit`, `GET .../submissions/{id}/status`; `CommitStarted → PreProcessing` on success, `CommitFailed` on error |
| the token exchange | `POST https://login.microsoftonline.com/<tenant_id>/oauth2/token`, `grant_type=client_credentials`, `resource=https://manage.devcenter.microsoft.com`, 60-minute lifetime |
| which transport is supported | the **Microsoft Store Developer CLI**, v0.4.2 published 2026-09-02, repository active — read from the GitHub releases API |

### What is still refused, by name

Two `UNSOURCED` entries survive and each names the limb it costs:

1. whether `msstore reconfigure` strictly **requires `--sellerId`** in CI. The
   options table still marks nothing required and no page says, so the
   *requirement* stays unsourced — but as of **2026-09-09 it no longer gates
   anything**, because the question that decides the code is not "is it required"
   but "is it correct", and that one is sourced: the commands page names SellerId
   as one of the account-identifying parameters and **both** of its CI/CD examples
   pass it. The lane now passes `--sellerId` from `MS_STORE_SELLER_ID`, the fifth
   `MS_STORE_*` secret. The asymmetry is what decided it — passing a documented
   identifier costs nothing if it is optional and is the whole lane if it is not.

   ⚠️ **This account has carried TWO seller ids that differ by three digits.** The
   retired one authenticates against nothing and looks entirely plausible in a
   log, so the live value is read from
   `Private/runbooks/store-submission-windows.md` and never from memory or from an
   old workflow run. The value is not written into this public tree.
2. the **raw-HTTP transport** — the exact Azure Blob request for the ZIP (the
   documentation demonstrates it only through .NET's `CloudBlockBlob`) and the
   field-by-field submission body. So no request in the script reaches
   `manage.devcenter.microsoft.com`; the CLI holds both links. Listing sync stays
   a console act.

### The `submit` job

`submit-windows-store.yml` now carries a third job, `submit`, `timeout-minutes: 30`:

* `if: inputs.confirm == 'SUBMIT-TO-MICROSOFT-STORE'` — a typed phrase, default empty
* `environment: store-publish` — the owner-approval pause, one environment for the whole factory
* a `listing_url` input, refused unless it is `https://…`, so the `[10]D-9` record has an address
* a secret preflight over all **five** `MS_STORE_*` names that **ends the job** when any is empty (the `e2e.yml:56-63` shape `assert-green-means-ran` section B counts)
* the CLI installed at an exact version, then
  `submit-windows-store.mjs --submit --app subscriptiontracker --confirm SUBMIT-TO-MICROSOFT-STORE`
* `record-deployment.mjs subscriptiontracker-windows-store --state in_review --listing-url "$LISTING_URL"`

### `environment:` on its own fails open — so the script reads the rules back

GitHub creates a referenced environment that does not exist, with no protection
rules, and runs the job. So `--submit` performs a run-time
`GET /repos/{owner}/{repo}/environments/store-publish` and refuses a
`protection_rules` array carrying no `required_reviewers` entry.
`assert-release-provenance.mjs` limb 4 requires exactly both halves and now sees
them on this lane as it already did on Play and Snap.

### The first publish is still MANUAL, and that is the API's own rule

*Create and manage submissions*, verbatim: "You cannot use the Microsoft Store
submission API to create an app in Partner Center", and "Before you can create a
submission for a given app using this API, you must first create one submission
for the app in Partner Center, including answering the age ratings
questionnaire." That is `C-MANUAL-FIRST-PUBLISH` and [ADR 067] decision 8 stated
by Microsoft rather than by us. The owner steps are in
`Private/runbooks/store-submission-windows.md`.

### The risk that is not ours to close

The Partner Center account has **no Entra tenant** today, and the API needs one
with Global administrator permission plus an application assigned the Manager
role. Until the owner creates it, this lane is fail-closed and cannot be
exercised end to end. Nothing here invents an endpoint to work around that.

---

## ⏱ 2026-09-25 — `submit` ships the package `dry-run` built (O-SUBMIT-REBUILDS-WHAT-THE-DRY-RUN-BUILT)

**Appended, not rewritten.** Until this date the `submit` job ran `flutter build windows` and
`dart run msix:create` a second time, so the package Microsoft received was not the bytes the dry run
had validated and read back. Now there is ONE compile and ONE `msix:create` per dispatch:

* `dry-run` hashes its .msix in step **Hand the submit job this package's name and sha256**
  (`id: bytes`, `shell: bash`) and exports `outputs.artifact` and `outputs.sha256`; the upload reads
  the same output for its name.
* `submit` downloads that artifact into `build/windows/msix`, the path `submit-windows-store.mjs`
  derives from `msix_config`, then **The package is the one the dry-run job hashed (sha256)** runs
  `sha256sum --check --strict` against `needs.dry-run.outputs.sha256`, passed through `env:`. An
  approval older than the 7-day retention finds nothing and FAILS.
* Removed from `submit`: `setup-flutter`, **Resolve the workspace**, **Derive the release line from
  pubspec**, **Build windows**, **Install glitchtip-cli**, **Upload the native debug symbols to
  GlitchTip**, **Package MSIX (Microsoft Store)** and its read-back **The MSIX carries the identity
  the register declares**. The read-back ran on these bytes in `dry-run`, straight after packaging
  them (assert-channel-register.mjs §10 limb (iv)), and the sha256 proves they are the same bytes; the
  packaging-step census drops 3 → 2 for that reason. The mapping went to the crash sink from
  `dry-run`; `submit` re-keeps that job's symbols directory as
  `symbols-subscriptiontracker-windows-store` for 90 days.

Held by `tooling/ci/test/submit-lanes-take-dry-run-bytes.test.mjs`. The proof is static: the job has
never run (the Entra tenant above), so its first dispatch is also its first live run.
