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

### ⚠️ `short-description.txt` is NOT the Subtitle

The contract requires `short-description.txt` in **every** tree and Apple has no
field of that name. It is the repo-native line the ≤ 30-character `subtitle.txt`
is condensed **from**. They are deliberately different files: the tagline is 37
characters and Apple's Subtitle is 30, so mapping one onto the other would fail
on **correct** input — the exact failure mode this tree's limits table exists to
avoid.

## Field limits — every number sourced, everything else marked UNVERIFIED

| Field | Limit | Source |
|---|---|---|
| App Name | **30** characters, minimum **2** | `developer.apple.com/help/app-store-connect/reference/app-information/` — fetched **2026-07-29**, recorded in `Private/company/pipeline/10-distribution-store.md` D-5 |
| Subtitle | **30** characters | *ibid.* |
| Keywords field | ⚠️ **COULD-NOT-ESTABLISH** | the fetched page carries **Name and Subtitle only**. The corpus's *"100 chars"* is **not** on it, so it is not used here |
| Description | ⚠️ **COULD-NOT-ESTABLISH** | not on the fetched page |
| Promotional text | ⚠️ **COULD-NOT-ESTABLISH** | not on the fetched page |
| *"≤ 70 CPPs"* (Custom Product Pages) | ⚠️ **UNVERIFIED** | carried from MASTER_PLAN §3's raw extract; **no primary source read** |
| Screenshot / preview dimensions, counts, video specs | ⚠️ **COULD-NOT-ESTABLISH** | see `screenshots/README.md` |
| Category vocabulary (the exact list App Store Connect accepts) | ⚠️ **UNVERIFIED** | `Productivity` is used because it is the obvious fit; the authoritative list was not fetched |

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
- 🔴 **Privacy manifest** (`PrivacyInfo.xcprivacy`) with **Required Reason API**
  declarations — G-49, which leaves stage 8's cut list the day A-4 is registered.
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

Everything that needs the account: **OWNER_QUEUE A-4** (Apple Developer Program
enrolment, $99/yr, plus an Apple device). No distribution certificate, no
provisioning profile and no App Store Connect API key exists, and none is wired
here — `served: false` and it stays false until a real submission happens.
