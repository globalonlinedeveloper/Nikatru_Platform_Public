# Store listing metadata — Subly · Apple App Store, iOS (`ios-appstore`)

`[pipeline D-5]` — *"store listing metadata is generated from the spec and lives
in the repo … so a listing can be regenerated, audited, localized and diffed,
and is never hand-typed into a store console as the only copy."*

**This directory is the source of truth for the listing.** App Store Connect is a
copy of it, not the other way round. If a field is edited in the console and not
here, the next regeneration silently reverts it — which is the intended
direction, and the reason `tooling/ci/assert-store-metadata.mjs` fails a missing
or emptied file.

## 🔴 fastlane `deliver` covers this channel, and this tree is still authoritative

Unlike Microsoft Store or Snap, Apple *does* have a fastlane path — `deliver`
supports `ios` and `mac`. That does not make a fastlane tree the source of truth
here. D-5's finding is that fastlane covers **3 of 6** platforms, so a fastlane
layout could only ever describe half this portfolio, and the half it could not
describe would get hand-typed into a console as the only copy. So the rule is the
same for every channel: **this repo-native tree is authoritative, and a fastlane
`deliver` tree is GENERATED from it** if and when that path is wired.

## Where every field comes from — the derivation map

"Checked" means `tooling/ci/assert-store-metadata.mjs` verifies it on every CI
run, so drift is a build failure rather than a discovery at submission time.

| File | App Store Connect field | Derived from | Checked |
|---|---|---|---|
| `title.txt` | App Name | `sites/_shared/_data/apps.json` → `name` | ✅ exact match, **and ≤ 30 / ≥ 2 chars** |
| `subtitle.txt` | Subtitle | hand-written; condensed from `short-description.txt` | ✅ **≤ 30 chars** |
| `short-description.txt` | *(no Apple field of this name)* | `sites/_shared/_data/apps.json` → `tagline` | ✅ exact match |
| `long-description.txt` | Description | the app's differentiation line (`app_brick` var `description`), expanded | non-empty |
| `keywords.txt` | Keywords | listing copy, comma-separated | non-empty — **limit UNVERIFIED** |
| `promotional-text.txt` | Promotional Text | listing copy | non-empty — **limit UNVERIFIED** |
| `category.txt` | Primary Category | `app_brick` var `category` | non-empty |
| `privacy-policy-url.txt` | Privacy Policy URL | `apps/subly/lib/core/app_config.dart` → `privacyUrl` | ✅ exact match |
| `support-url.txt` | Support URL | `apps/subly/lib/core/app_config.dart` → `contactUrl` | ✅ exact match |
| `screenshots/` | App Previews and Screenshots | not derivable — see that directory's README | slot must exist |
| `privacy-manifest.json` | *(not a listing field — see below)* | **measured from the tree** on 2026-08-31: the plugin closure, each plugin's own `PrivacyInfo.xcprivacy`, and `apps/subly/store/android-play/data-safety.json` for the collected-data rows | ✅ `tooling/ci/assert-apple-privacy-manifest.mjs` re-derives **both** `PrivacyInfo.xcprivacy` files from it and compares |

### ⚠️ `short-description.txt` is NOT the Subtitle

The contract requires `short-description.txt` in **every** tree and Apple has no
field of that name. It is the repo-native line the ≤ 30-character `subtitle.txt`
is condensed **from**. They are deliberately different files: the tagline is 37
characters and Apple's Subtitle is 30, so mapping one onto the other would fail
on **correct** input — the exact failure mode this tree's limits table exists to
avoid.

## 🔴 `privacy-manifest.json` — the Apple privacy manifest, and the two things it is not

`privacy-manifest.json` is not listing copy. It is the repo-native **audit** that
`tooling/store/render-apple-privacy-manifest.mjs` renders into both
`apps/subly/ios/Runner/PrivacyInfo.xcprivacy` and
`apps/subly/macos/Runner/PrivacyInfo.xcprivacy`, and that
`tooling/ci/assert-apple-privacy-manifest.mjs` re-derives and compares on every CI
run. Editing either `.xcprivacy` by hand is a build failure, in the same direction
as this whole tree: **the repository is authoritative and Xcode is a copy of it.**

**One file covers both Apple channels.** The macOS manifest is generated from *this*
file, which is why `macos-appstore/` carries no second copy — two copies of one
identity is how the wrong one ships. Where the platforms genuinely differ (the
plugin set differs on four rows; the macOS engine manifest carries no
`NSPrivacyAccessedAPITypes` key at all where the iOS one declares three reason
codes) the difference is a field inside the audit, not a second document.

### ⚠️ Enforcement is at UPLOAD, not at review

Apple: *"Starting May 1, 2024, apps that don't describe their use of required
reason API in their privacy manifest file aren't accepted by App Store Connect."*
(`developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api`,
recorded with its fetch date in the shared brain's `vendors/apple.md` §9.) A wrong
answer here therefore costs an **upload round-trip**, not a review cycle. The
rejection string `ITMS-91053` is written down once in the audit and **no guard
asserts it**: the RULE is sourced, the CODE appears on no Apple public page and is
third-party-only.

### ⚠️ App Store Connect's App Privacy questionnaire is a SEPARATE artefact

The console's **App Privacy** section is not this file and is not generated from
it. It is a questionnaire with no API this repo uses and no file to emit, it is a
hard gate on a first submission, and it asks the same questions as the audit's
`collectedDataTypes`. **This file is the answer key**; the console is a copy of it,
in the same direction as every other store artefact here. A manifest that disagrees
with the questionnaire is a contradiction Apple can see. It rides **OWNER_QUEUE
O-3** and cannot be done before the app record exists (audit `unresolved` U-2).

### 🔴 The answer is an EMPTY `NSPrivacyAccessedAPITypes`, and an empty array is a CLAIM

`accessedApiDetermination` is empty for **both** platforms, and that is the audit's
**finding**, not its default. Apple asks a **binary** why *it* uses an API, and the
app target's own sources — `AppDelegate.swift`, `SceneDelegate.swift` and the
generated plugin registrant, all read in full and all stock — reach none. Every
category this app genuinely depends on is declared by the binary that uses it:

| Category | Reason code | Declared by |
|---|---|---|
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `0A2A.1`, `C617.1` | the Flutter engine (`Flutter.framework`) — the Dart runtime lives there, so `File.lastModified()` from Dart is the engine's declared use |
| `NSPrivacyAccessedAPICategorySystemBootTime` | `35F9.1` | the Flutter engine |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | `flutter_local_notifications` 17.2.4 |
| `NSPrivacyAccessedAPICategoryUserDefaults` | `1C8F.1` | `shared_preferences_foundation` 2.5.6 |

Repeating any of those in the app manifest would be the app target swearing to code
it does not contain. **Declaring `FileTimestamp` and `SystemBootTime` "just in case"
costs nothing at upload and is a false sworn statement** — and it would destroy the
file's only real property, that a NEW required-reason call has to change it.

⚠️ **The corpus had the attribution wrong and the audit corrects it.**
`nikatru/vendors/apple.md` recorded *"CA92.1 for shared_preferences"*. Measured:
`shared_preferences_foundation` declares `1C8F.1`, and `CA92.1` is
`flutter_local_notifications`'. The
same sentence named `share_plus`, which is not a dependency of this app at all, and
`path_provider`, which as of `path_provider_foundation` 2.6.0 has **no native binary
to attach a manifest to** — it is FFI-only, so its place on Apple's third-party SDK
list is discharged by there being no binary, and its missing manifest must not be
read as one that is owed.

`NSPrivacyTracking` is `false` and `NSPrivacyTrackingDomains` is empty — the pair is
asserted together, because a non-empty domain list under tracking-false is a
contradiction. The eleven `NSPrivacyCollectedDataTypes` rows are **derived from**
`apps/subly/store/android-play/data-safety.json` at its current posture rather than
written independently, so a Play row cannot flip without this file moving.

### ⚠️ U-1, the one unresolved question, and why it is NOT declared

`sentry_flutter` 9.26.0 registers the selector **`systemUptime`** (`NSProcessInfo`)
in its `objective_c` binding file. `NSProcessInfo.systemUptime` **is**
`NSPrivacyAccessedAPICategorySystemBootTime` (`35F9.1`) — and it is reached
dynamically, by `objc_msgSend` on a runtime-registered selector string, from Dart
AOT code in **`App.framework`**: the one binary in a Flutter build that can carry no
manifest at all, because no target owns it.

Whether Apple's upload scan attributes that call to `App.framework` is **not
knowable from outside App Store Connect**. Both answers are defensible and both
cost something, so the audit decides rather than guesses: **DO NOT DECLARE.** The
app target does not call it, the reason code would be unjustifiable if asked, and a
rejected upload is cheap, immediate and unambiguous where a false sworn declaration
is a policy problem that survives. **If the first upload returns a required-reason
complaint naming SystemBootTime**, the remedy is one line in `privacy-manifest.json`
— add `35F9.1` under `accessedApiDetermination` for both platforms, regenerate,
re-upload — not a re-audit. The reason itself is real (it is what a crash SDK does);
it is the **attribution** that is unproven.

### ⚠️ What this artefact cannot see

- **The CocoaPods closure.** `sentry_flutter` vendors `Sentry/HybridSDK 8.58.4`, the
  only native SDK in the bundle that is not a pub package. The audit ran on Windows,
  so that pod was never fetched and **its manifest and signature were not read** —
  believed satisfied is not read. A macOS runner with a real `Pods/` checkout is the
  place that could settle it.
- **The built bundle.** Apple assembles its aggregate privacy report from what is
  actually embedded, and no compiled `.app` has been inspected here on any platform.
- **Apple's scanner.** U-1 turns on it, and it is not observable from this side.

## Field limits — every number sourced, everything else marked UNVERIFIED

| Field | Limit | Source |
|---|---|---|
| App Name | **30** characters, minimum **2** | `developer.apple.com/help/app-store-connect/reference/app-information/` — fetched **2026-07-29**, recorded against D-5 and now `Private/requirements/ledger.json`’s `[10]D-5` entry |
| Subtitle | **30** characters | *ibid.* |
| Keywords field | ⚠️ **COULD-NOT-ESTABLISH** | the fetched page carries **Name and Subtitle only**. The corpus's *"100 chars"* is **not** on it, so it is not used here |
| Description | ⚠️ **COULD-NOT-ESTABLISH** | not on the fetched page |
| Promotional text | ⚠️ **COULD-NOT-ESTABLISH** | not on the fetched page |
| *"≤ 70 CPPs"* (Custom Product Pages) | ⚠️ **UNVERIFIED** | carried from MASTER_PLAN §3's raw extract; **no primary source read** |
| Screenshot / preview dimensions, counts, video specs | ⚠️ **COULD-NOT-ESTABLISH** | see `screenshots/README.md` |
| Category vocabulary (the exact list App Store Connect accepts) | ⚠️ **UNVERIFIED** | `Productivity` is used because it is the obvious fit; the authoritative list was not fetched |
| `NSPrivacyCollectedDataType*` and `…Purpose*` spellings | ⚠️ **UNVERIFIED — no local witness** | every plugin manifest in the closure ships `NSPrivacyCollectedDataTypes` **empty**, so not one of these constants appears in any file on this machine. They are cross-checked against `apps/subly/store/android-play/data-safety.json` instead of being trusted alone — a misspelling is a plist Apple *ignores*, not an error it reports |
| `NSPrivacyAccessedAPICategoryDiskSpace`, `…ActiveKeyboards` | ⚠️ **UNVERIFIED — no local witness** | the other three category constants were read out of real manifests during the audit; these two were not, and the vocabulary records which is which so nobody adds a row believing the spelling was checked |

🔴 **The rule that makes this table look sparse on purpose: an invented limit
fires on correct input.** A made-up *"120 characters or fewer"* once rejected this
repo's own fixture at 129. Any number added here later arrives **with a URL and a
date**, or arrives marked `UNVERIFIED`. `assert-store-metadata.mjs` enforces
exactly the two limits above, because those are the only two with a citation —
and it **refuses to enforce a `max` that arrives without a `source`**.

## Hard requirements this channel owns (recorded, not enforced here)

These are submission-time facts, not repo files. The full ordered console
procedure is `Private/runbooks/store-submission-apple.md`.

- 🔴 **Uploads MUST be built with Xcode 26 or later** — `developer.apple.com/news/upcoming-requirements/`,
  in force since **28 April 2026**. The register's `ios-appstore` row carries this
  as an UNPINNED TOOLCHAIN FLOOR: `build-platforms.yml` runs on `macos-26` and
  pins **no** Xcode version, and `tooling/versions.json` has no `xcode` key.
- 🔴 **The `macos-26` runner is arm64-only.** Anything assuming an Intel runner
  does not apply.
- ✅ **Privacy manifest** (`PrivacyInfo.xcprivacy`) with **Required Reason API**
  declarations — G-49. **It left stage 8's cut list on 2026-08-31**, the day Apple
  Developer enrolment completed: the cut was consistent only while enrolment was
  deferred, and that pairing was recorded as a tripwire precisely so registering
  the account could not quietly break it. It is now a repo artefact —
  `privacy-manifest.json` above — and no longer a submission-time fact.
- **Age rating** is an App Store Connect questionnaire, not a repo file.
- **Notarization does NOT apply to this channel.** It is the Developer ID
  direct-distribution path; an App Store submission is signed and reviewed, not
  notarized. See the `macos-appstore` tree's README for the same distinction.

## Regenerating / validating

```
node tooling/ci/assert-store-metadata.mjs                                    # the D-5 guard
node tooling/release/submit-appstore.mjs --dry-run --channel ios-appstore --app subly
```

The dry run validates this tree, the artifact and the credential configuration,
and exits 0 **without contacting Apple**. `--submit` refuses with `UNVERIFIED:`
lines rather than guessing at App Store Connect API endpoints.

## ⬜ What is still owner-gated

Everything that needs the account: **OWNER_QUEUE A-4**. Enrolment in the Apple
Developer Program **completed on 2026-08-31** — which is what fired G-49 above.
Nothing downstream of it moved: no distribution certificate, no provisioning
profile and no App Store Connect API key exists, and none is wired here —
`served: false` and it stays false until a real submission happens. The **App
Privacy** questionnaire (audit `unresolved` U-2) joins that list: it is a console
form with no file to generate, it is a hard gate on a first submission, and it
cannot be filled in before the app record exists.
