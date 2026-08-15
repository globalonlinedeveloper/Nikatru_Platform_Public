# Store listing metadata — Subly · Apple App Store, macOS (`macos-appstore`)

`[pipeline D-5]` — *"store listing metadata is generated from the spec and lives
in the repo … so a listing can be regenerated, audited, localized and diffed,
and is never hand-typed into a store console as the only copy."*

**This directory is the source of truth for the listing.** App Store Connect is a
copy of it, not the other way round.

## 🔴 Why this is a SECOND tree and not a variant of the iOS one

The register carries `ios-appstore` and `macos-appstore` as **separate rows**, and
this is a separate directory for the same reason: **one App Store Connect record
per platform, one metadata tree, one review outcome.** They share an Apple
Developer account (`OWNER_QUEUE A-4`) and one App Store Connect API key — which
is why one script, `tooling/release/submit-appstore.mjs`, serves both with
`--channel` — but they are two submissions that can succeed and fail
independently. A shared tree would make one review outcome look like two.

What actually differs: the **artifact** (`.pkg`, not `.ipa`) and the
notarization question below. The listing fields are identical and are copies, on
purpose — divergence between them should be a visible diff, not an inherited
default.

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

`short-description.txt` is **not** the Subtitle — see the `ios-appstore` README's
section of the same name. The tagline is 37 characters and Apple's Subtitle is
30, so the two files are deliberately different.

## Field limits — every number sourced, everything else marked UNVERIFIED

| Field | Limit | Source |
|---|---|---|
| App Name | **30** characters, minimum **2** | `developer.apple.com/help/app-store-connect/reference/app-information/` — fetched **2026-07-29**, recorded in `Private/company/pipeline/10-distribution-store.md` D-5 |
| Subtitle | **30** characters | *ibid.* |
| Keywords field | ⚠️ **COULD-NOT-ESTABLISH** | the fetched page carries **Name and Subtitle only** |
| Description | ⚠️ **COULD-NOT-ESTABLISH** | not on the fetched page |
| Promotional text | ⚠️ **COULD-NOT-ESTABLISH** | not on the fetched page |
| *"≤ 70 CPPs"* (Custom Product Pages) | ⚠️ **UNVERIFIED** | carried from MASTER_PLAN §3's raw extract; **no primary source read** |
| Screenshot dimensions, counts, video specs | ⚠️ **COULD-NOT-ESTABLISH** | see `screenshots/README.md` |
| Category vocabulary (the exact list App Store Connect accepts for macOS) | ⚠️ **UNVERIFIED** | `Productivity` is used because it is the obvious fit; the authoritative list was not fetched |

🔴 An invented limit fires on **correct** input — a made-up *"120 characters or
fewer"* once rejected this repo's own fixture at 129. Any number added here later
arrives **with a URL and a date**, or arrives marked `UNVERIFIED`.

## 🔴 Notarization does NOT apply to this channel

This is the distinction that most often goes wrong, so it is recorded in the
tree rather than only in the runbook:

- **Mac App Store** (this channel, `.pkg`) — the package is signed with an
  Apple-issued distribution certificate and **reviewed**. It is **not** notarized;
  notarization is not part of this path.
- **Developer ID direct distribution** (a `.dmg`/`.pkg` you host yourself) —
  **is** notarized, via `xcrun notarytool`, and is **not** an App Store
  submission. This register carries **no** Developer ID row today; if native macOS
  is ever distributed outside the store, that is a **new channel row**, not a
  variant of this one.

⚠️ `xcrun altool` is retired for this path — the App Store Connect API is the
supported route, and `notarytool` belongs to the *other* path entirely. Neither
is what submits this channel.

## Other hard requirements this channel owns

- 🔴 **Uploads MUST be built with Xcode 26 or later** —
  `developer.apple.com/news/upcoming-requirements/`, in force since **28 April
  2026**. Unpinned here: `build-platforms.yml` runs `macos-26` and pins no Xcode.
- 🔴 **The `macos-26` runner is arm64-only.**
- 🔴 **Privacy manifest** (`PrivacyInfo.xcprivacy`) with **Required Reason API**
  declarations — G-49.
- **Age rating** is an App Store Connect questionnaire, not a repo file.
- **App Sandbox** is required for Mac App Store distribution; the entitlements
  that grants are per-app and unbuilt. ⚠️ The exact required entitlement set is
  **UNVERIFIED** — not fetched.

Full ordered console procedure: `Private/company/runbooks/store-submission-apple.md`.

## Regenerating / validating

```
node tooling/ci/assert-store-metadata.mjs                                      # the D-5 guard
node tooling/release/submit-appstore.mjs --dry-run --channel macos-appstore --app subly
```

Exits 0 **without contacting Apple**. `--submit` refuses with `UNVERIFIED:` lines.

## ⬜ What is still owner-gated

**OWNER_QUEUE A-4** — the same Apple Developer Program enrolment as
`ios-appstore`. No distribution certificate, no provisioning profile, no App
Store Connect API key, and none wired here.
