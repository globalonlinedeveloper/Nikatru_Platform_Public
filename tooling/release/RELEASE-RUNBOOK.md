# Release runbook — pushing a tag, and what comes out the other side

**Audience:** the owner, at the moment of a release. **Scope:** the public repo's own
release lane only — `.github/workflows/build-platforms.yml`. Store submissions are a
different act with a different runbook (each store row's `submission.runbook` in
`tooling/channel-register.json` names it).

**This file lives in the public tree on purpose.** It documents a procedure that runs
entirely on public infrastructure — a git tag, a GitHub Actions workflow, a GitHub
Release. Nothing here is a credential, an account detail or a business fact, so nothing
here belongs behind the private SSoT. Anyone who forks this repository needs exactly
this file to release from it.

> **Status as of 2026-08-09: no tag has ever been pushed and no Release has ever
> existed.** Everything up to `gh release create` has been exercised — staging, the
> checksum manifest, `--verify`, the asset list and the deployment-environment
> derivation were all run end to end against a fixture download tree on 2026-08-09, and
> the measured output is reproduced below. The publish step itself is unproven until
> somebody publishes. That is stated rather than implied.

---

## 1. The tag shape

```
<unit>-v<MAJOR>.<MINOR>.<PATCH>
```

`<unit>` is the **app slug** — the directory name under `apps/`, which is also the
entry in the root `pubspec.yaml`'s `workspace:` list and the `slug` in
`sites/_shared/_data/apps.json`. Today there is exactly one: `subly`.

| Example | Verdict |
| --- | --- |
| `subly-v1.0.0` | ✅ triggers the lane |
| `subly-v1.0.0-rc.1` | ✅ matches the glob (`*-v*`); the Release is created with that literal name |
| `v1.0.0` | ❌ **no `<unit>-` prefix → matches nothing → NOTHING HAPPENS, and there is no error.** A tag that matches no filter is simply not a trigger. |
| `subly-1.0.0` | ❌ no `-v`, same silent nothing |

The trigger glob is `push: tags: ['*-v*']` (`build-platforms.yml`). It names **no app**,
which is what keeps the lane generic over the factory — adding an app adds matrix legs,
not workflow lines.

> 🔴 **Tag a commit that is already on `main` and has already gone green.**
> `ci.yml` triggers on `branches: [main, feat/**, fix/**, chore/**]` and **not on tags**,
> so a tag never produces its own `ci-gate` run. The first job of the release lane,
> `gate`, runs `assert-gate-passed.mjs <sha>`, which POLLS the check-runs API for a
> **passed `ci-gate` on that exact SHA** and **fails closed** on absent/unknown/timed-out.
> Tag a commit that never ran through `main` and the whole lane stops at job one.

---

## 2. What a tag triggers

One workflow: **`build-platforms.yml`** ("Build all 6 platforms"). No other workflow in
`.github/workflows/` has a `push: tags:` trigger — `ci.yml` is branches-and-PRs, the
`deploy-*` lanes are branch-driven, and every `submit-*` lane is dispatch-only.

```
gate ─► prepare ─┬─► linux_web_android ─┐
                 ├─► windows ───────────┼─► all_platforms   (aggregator, fails on any red or skipped)
                 └─► apple ─────────────┘
                                        └─► release          (needs gate, prepare, and all three builds)
```

* **`gate`** — `ci-gate` must already have passed for this SHA (§1).
* **`prepare`** — derives the app set from the pub workspace; the matrix below iterates it.
* **the three build jobs** — six platforms, each preceded by its credential step
  (`android-signing.mjs`, `appimage-signing.mjs`, `windows-signing.mjs`,
  `apple-signing.mjs`).
* **`release`** — runs on *every* trigger; only `gh release create` and the deployment
  record are tag-only (`if: github.ref_type == 'tag'`). That is deliberate: a job-level
  `if:` resolves to `skipped`, and `all_platforms` correctly treats `skipped` as not-green.

### 🔴 The credential steps and the tag — read this before your first tag

Four channels are owner-gated and **cannot** sign: `windows-direct` (a certificate that
must be BOUGHT and renewed yearly), `ios-appstore` + `macos-appstore` (OWNER_QUEUE A-4,
the Apple enrolment), `linux-appimage` (a keypair, its custody and a restore drill).

Until **2026-08-09** each of those four seams treated *any* tag push with no secrets as
**fatal**, which killed `windows`, `apple` and `linux_web_android` — and `release`
`needs:` all three. **The first Release was therefore unreachable, and nothing said so.**

The rule is now derived from `tooling/channel-register.json` (`tooling/ci/channel-arming.mjs`):
a missing credential **fails** the release only when the channel is **ARMED** —
`served: true`, or `submittable: true` **with a real `lane`**. All four rows above are
unarmed today, so a tag **prints the gap in full and continues**, and the artifact for
that platform is a labelled build proof. `android-play` **is** armed (submittable, with
a lane that emits the `.aab`), so a missing Play upload key still fails — correctly.

**The tripwire:** arm any of those rows in the register and the identical tag fails
again, naming the field that armed it. Arming a channel and creating its secrets belong
in one change.

---

## 3. What the Release carries

Built by `release` (`build-platforms.yml` — the "Stage the installers and archive the
rest" step through "Record what shipped"). Two kinds of asset, plus the manifest.

### 3a. Installers, staged loose and renamed

`release-manifest.mjs --stage` **moves** every *installable* file out of the downloaded
artifact tree into `dist/`, renamed `<tag>-<original name>`. "Installable" is derived
from `artifactFormats` across the channel register — never typed into the workflow — minus
the extensions that only ever travel *inside* a bundle (a bare `.exe` is not a download).

Measured 2026-08-09 against a fixture download tree:

```
staged  subly-v1.0.0-app-release.aab
staged  subly-v1.0.0-app-release.apk
staged  subly-v1.0.0-subly.msix
ok  3 installable artifact(s) staged
```

| Asset | From | Channel it is the origin for |
| --- | --- | --- |
| `<tag>-app-release.aab` | `linux_web_android` | `android-play` (a Play upload format; the Release is the archive, not the store) |
| `<tag>-app-release.apk` | `linux_web_android` | none — the only sideloadable Android build, kept on purpose |
| `<tag>-subly.msix` | `windows` | `windows-store` / `windows-direct` |

### 3b. Everything else, archived whole

Whatever remains in each downloaded artifact directory is tarred, one `.tar.gz` per
platform artifact, as `<tag>-<artifact-name>.tar.gz` — so "outlives the run" covers the
artifact **set** and not just the installers:

| Archive | Contents |
| --- | --- |
| `<tag>-<app>-linux-web-android-<android posture>.tar.gz` | the Linux x64 bundle (and the web build) |
| `<tag>-<app>-windows.tar.gz` | the Windows `Release/` directory, including `<app>.exe` |
| `<tag>-<app>-macos.tar.gz` | `build/macos/Build/Products/Release` |

The Android artifact name carries the **signing posture** (e.g.
`…-debug-signed-build-proof`), so an unsigned build cannot be mistaken for a release by
its filename alone.

> ⬜ **No `.ipa` and no `.pkg`.** `build-platforms.yml` runs
> `flutter build ios --release --no-codesign`, which produces no `.ipa`, and nothing
> packages a `.pkg`. Both Apple rows are `lane: null` for exactly that reason. This is
> the same fact that keeps them unarmed in §2.

### 3c. `SHA256SUMS` — always first in the asset list

Written and then **re-verified** by `release-manifest.mjs` on every run, tag or not.
The header carries the app, the tag, the **gated commit SHA** and the run URL; `sha256sum -c`
skips `#`-prefixed lines, so the provenance rides inside the file a downloader already
knows how to check. Measured 2026-08-09:

```
# NIKATRU release manifest — verify with:  sha256sum -c SHA256SUMS
# app: subly
# tag: subly-v1.0.0
# commit: 4e814270000000000000000000000000000000aa
# built-by: https://github.com/.../actions/runs/1
# assets: 3
38760eab…  subly-v1.0.0-app-release.aab
dd37c2d7…  subly-v1.0.0-app-release.apk
a1788eec…  subly-v1.0.0-subly.msix
```

`--emit-assets` puts `SHA256SUMS` **first** and refuses an empty set, so a Release
cannot be created without the one file that makes it verifiable.

### 3d. The deployment record

For each `kind: "direct"` channel whose declared formats this release actually carries,
`record-deployment.mjs` writes a [10]D-9 GitHub Deployment. Derived at run time —
nothing is hardcoded, so an AppImage lane joins by being given a register row.
Measured 2026-08-09, `--emit-environments` over the fixture `dist/`:

```
subly-windows-direct
```

---

## 4. The required-reviewer environment note

**There is no required-reviewer gate on this lane today, and that is a fact you can
check in one command:**

```bash
grep -rn "^\s*environment:" .github/workflows/    # → no matches
```

No job in any workflow declares a GitHub **Environment**, so nothing pauses for
approval. **The only human gate on a release is the act of pushing the tag.** Treat the
`git push` in §5 as the approval step, because it is.

Two things that are easy to confuse with a gate and are not:

* **`permissions:` on the `release` job** (`contents: write`, `deployments: write`,
  `actions: read`) is *least privilege*, not review. It scopes what the token may do; it
  asks nobody anything.
* **The `<app>-<channel>` names in §3d are *Deployment* environments**, created through
  the Deployments API by `record-deployment.mjs`. Adding required reviewers to one of
  them in *Settings → Environments* would **not** pause the release job, because that job
  declares no `environment:` key. It would only affect a job that does.

**If you ever want a human approval gate**, the one place to put it is an
`environment: <name>` key on the `release` job in `build-platforms.yml`, with required
reviewers configured on that environment. Note before you do: the job would then sit in
`waiting` until approved, holding the whole workflow — and `all_platforms` needs
`release`, so nothing reports green until somebody clicks.

---

## 5. The owner's exact two commands for the first release

Run these from the repo root, on a **`main` checkout whose HEAD has already gone green
on `ci-gate`** (see §1).

```bash
git tag -a subly-v1.0.0 -m "subly v1.0.0"
git push origin subly-v1.0.0
```

That is the whole release. Nothing else is typed by hand: the tag is the trigger, the
workflow does the rest, and the Release appears at
`https://github.com/globalonlinedeveloper/Project_Cross_Platform_Apps/releases/tag/subly-v1.0.0`.

**Bump `1.0.0` to whatever `apps/subly/pubspec.yaml` declares** — the workflow derives its
build name from pubspec, and a tag that disagrees with it is two release lines.

### Watch it, and what "good" looks like

```bash
gh run watch "$(gh run list --workflow build-platforms.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expect, in the log:

* four `⬜ SIGNING POSTURE: UNSIGNED-BUILD-PROOF` blocks, each preceded by a
  `🔴 RELEASE LANE, NO SIGNING SECRETS — PRINTED IN FULL AND NOT FAILED` explanation
  naming the unarmed channel (§2). **These are expected. They are the four owner-gated
  channels, and they say so.**
* `All 6 platforms built`
* `ok  N asset(s) verified against SHA256SUMS`

### Rolling back

A Release is public the moment it is created. There is no undo that un-downloads it.

```bash
gh release delete subly-v1.0.0 --yes     # removes the Release and its assets
git push origin :refs/tags/subly-v1.0.0  # removes the tag
git tag -d subly-v1.0.0                  # and the local copy
```

Deleting and re-pushing the **same** tag is worse than moving on to `v1.0.1`: anyone who
already fetched the tag keeps the old commit under that name. Prefer a new version.
