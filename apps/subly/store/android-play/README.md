# Store listing metadata — Subly · Google Play (`android-play`)

`[pipeline D-5]` — *"store listing metadata is generated from the spec and lives
in the repo … so a listing can be regenerated, audited, localized and diffed,
and is never hand-typed into a store console as the only copy."*

**This directory is the source of truth for the listing.** The Play Console is a
copy of it, not the other way round. If a field is edited in the console and not
here, the next regeneration silently reverts it — which is the intended
direction, and the reason `tooling/ci/assert-store-metadata.mjs` fails a missing
or emptied file.

## 🔴 Why the repo-native tree is the source of truth and not a fastlane tree

`fastlane` covers **3 of 6** platforms — `deliver` is `ios, mac`, `supply` is
`android`, and there is **no fastlane path for Microsoft Store, Snap/AppImage or
Web** (D-5, verified against fastlane's own action pages 2026-07-29).

Play is the one store where fastlane *does* have a path (`supply`), and this tree
is still authoritative — because a source of truth that changes shape depending on
which channel you are looking at is not a source of truth. `supply`'s
`fastlane/metadata/android/en-US/` layout is **generated FROM this directory** if
and when the submission is automated that way; it is not maintained in parallel.
The register records the same rule once, for every channel, in
`tooling/channel-register.json` → `storeMetadataContract`.

## Where every field comes from — the derivation map

Each file below is one listing field. "Checked" means
`tooling/ci/assert-store-metadata.mjs` compares it to the spec source on every CI
run, so drift is a build failure rather than a discovery at submission time.

| File | Play Console field | Derived from | Checked |
|---|---|---|---|
| `title.txt` | App name | `sites/_shared/_data/apps.json` → `name` | ✅ exact match **+ ≤ 30 chars** |
| `short-description.txt` | Short description | `sites/_shared/_data/apps.json` → `tagline` | ✅ exact match **+ ≤ 80 chars** |
| `long-description.txt` | Full description | the app's differentiation line (`app_brick` var `description`), expanded | non-empty **+ ≤ 4000 chars** |
| `category.txt` | Category | `app_brick` var `category` | non-empty |
| `privacy-policy-url.txt` | Privacy policy URL | `apps/subly/lib/core/app_config.dart` → `privacyUrl` | ✅ exact match |
| `support-url.txt` | Support contact — website | `apps/subly/lib/core/app_config.dart` → `contactUrl` | ✅ exact match |
| `feature-graphic.png` | Feature graphic (1024×500) | **generated** from `assets/icon/app_icon_{foreground,background}.svg` by `tooling/store/render-play-graphics.mjs` | ✅ `assert-listing-assets.mjs` — exact size + **no** alpha |
| `store-icon-512.png` | App icon (512×512) | **generated** from `assets/icon/app_icon_1024.png` — the same master the launcher icons use | ✅ `assert-listing-assets.mjs` — exact size + **with** alpha + ≤ 1024KB |
| `screenshots/` | Phone screenshots | **captured** from a LIVE build by `tooling/store/capture-play-screenshots.mjs` | ✅ count, dimensions, aspect, format **and recorded posture** |
| `data-safety.json` | **Data safety form** | derived from the code — see below | ✅ `assert-play-declarations.mjs` |
| `content-rating.json` | **Content rating questionnaire** | the app's own content — see below | ✅ `assert-play-declarations.mjs` |
| `ads-declaration.json` | **App content → Ads** | derived from the shipped **format** — the widget tree and the served config, not the pubspec | ✅ `assert-ads-declarations.mjs` |

**The brick vars are the generation mechanism, the app is the instance.** The
`app_brick` (`tooling/bricks/app/brick.yaml`) already declares `category` and
`description` — *"One-line differentiation for store listings"* — and until these
trees existed it wrote them **nowhere a store tool could read**, which was D-5's
entire evidence. Subly predates the brick, so its two derived-by-hand fields
(`long-description.txt`, `category.txt`) are checked for presence and length
rather than for equality with a var that Subly never had.

⬜ **Still open (D-5's own build, not this increment's):** the `app_brick` probe
asserting that a *fresh stamp* emits this tree from `category` and `description`.
Until that lands, a newly stamped app gets **no** tree and the guard PRINTS the
gap on every run.

## Field limits — every number sourced, everything else marked UNVERIFIED

| Field | Limit | Source |
|---|---|---|
| App name | **30 characters** | `support.google.com/googleplay/android-developer/answer/9859152`, fetched 2026-07-29 |
| Short description | **80 characters** | *ibid.* |
| Full description | **4000 characters** | *ibid.* — *"Character limits apply to both full-width and half-width characters"* |
| Category vocabulary (the exact list the Play Console accepts) | ⚠️ **UNVERIFIED** | `Productivity` is used because it is the obvious fit and because it is the value the `windows-store` tree carries — one `category` var, not two. The authoritative Play category list was not fetched |
| Feature graphic | **1024×500**, JPEG or 24-bit PNG (no alpha) | `support.google.com/googleplay/android-developer/answer/9866151`, fetched 2026-08-04 |
| App icon | **512×512**, 32-bit PNG (with alpha), ≤ 1024KB | *ibid.* |
| Phone screenshots | **2–8**, sides 320–3840px, max side ≤ 2 × min side, 24-bit PNG (no alpha) | *ibid.* — full table + what remains unverified in `screenshots/README.md` |
| Whether newlines count toward the description limit | ⚠️ **UNVERIFIED** | they ARE counted — the strict direction. See `storeMetadataContract._limitsWhy` |

These three numbers are enforced by
`tooling/channel-register.json` → `storeMetadataContract.perChannel["android-play"].maxChars`,
which counts **Unicode code points** of the trimmed file. A limit declared there
without a `source` **fails the build** rather than being applied.

🔴 **The rule that makes this table look sparse on purpose: an invented limit
fires on correct input.** A made-up *"120 characters or fewer"* once rejected this
repo's own fixture at 129. Any number added here later arrives **with a URL and a
date**, or arrives marked `UNVERIFIED`.

🔴 **The 30-character app-name cap is the one with teeth**, and it is worth
knowing why. `title.txt` is *derived* from `apps.json` → `name`, so the day an app
is stamped with a name longer than 30 characters the build fails — instead of the
Play Console rejecting it after a human has already worked through a submission
form. That is the whole point of putting the number in the register.

## The three sworn declarations — `data-safety.json`, `content-rating.json`, `ads-declaration.json`

These are **not listing copy**. They are declarations about *what the code does*,
and Google puts the accuracy on us:

> "All developers must complete a clear and accurate Data safety section for every
> app… The developer is responsible for the accuracy of the label."
> — `support.google.com/googleplay/android-developer/answer/10144311`, fetched 2026-08-04

🔴 **So they are derived from the tree, not typed from memory.**
`tooling/ci/assert-play-declarations.mjs` fails the build when the first two
drift; `tooling/ci/assert-ads-declarations.mjs` owns the third **and the
advertising limb of the other two**, because that one question is not answerable
from a pubspec (see below). What actually bites, in the order it would catch a
real drift:

| The drift | What fails |
|---|---|
| The `.aab` lane gains an identity `--dart-define` | `AppConfig.isBackendLive` is a compile-time constant over those defines, so the shipped bundle stops being the one the declaration describes |
| A permission or package contradicts a *"not collected"* answer | that answer's `tells` — the mechanism by which a location or ads SDK actually arrives |
| A permission or package contradicts a *"collected, but never from the device"* answer | that answer's `clientAbsence`, which is evaluated **whatever** the answer is. `tells` only run for a row that is never collected in any posture, so a row answering `true` — or `null` — would otherwise keep a tell list nobody evaluates |
| A `tells` block is left on a row that IS collected | it can never fire; an assertion that cannot fail is worse than none, so the guard says where to move it |
| Renovate bumps `sentry_flutter` | the *Device or other IDs* answer was derived by reading that SDK's source; `crashSdkSurface.pinned` is compared to `pubspec.lock`, so a bump demands a re-read |
| A settled answer drifts back to `null` | `resolved` re-checks every question it claims to have closed — the one backslide the blocking list can never print, because that list is built from `unresolved` |
| A new direct dependency appears | *"nobody said what data it can collect"* — the mitigation for not being able to read the merged manifest |
| A new `personalData: true` row lands in `tooling/legal/data-inventory.json` | it must be mapped to a Play data type or excluded **by name**, in both directions |
| An erasure route or the web deletion page disappears | the *"users can request deletion"* answer loses what backs it |
| The two forms answer *sharing* or *children* differently | Play asks both twice, months apart; the rating answers are **derived** from the Data safety ones |
| An IARC rating is written down | ratings are **assigned** by the rating authorities — one without a certificate and a citation is a guess wearing the costume of a result |
| **A promotional surface lands with no SDK behind it** | `assert-ads-declarations.mjs` — the *format* scan. Every advertising answer here used to key on `dependency-tells`, and Google's own trigger list includes one that needs no dependency at all: *"House ads: My app renders a small ad banner, interstitial ad, ad wall, and/or widget"*. A house ad is UI we render, so a pubspec walk stays green while the answer becomes false |
| **The advertising sentence on `privacy.html` is reworded, or the ads answers disagree with each other** | the same guard's four-way cross-check — this file's answer, `data-safety.json`'s advertising-purpose row count, `content-rating.json`'s `contains-ads`, and the published sentence pinned to its `policy-claims.json` row |

✅ **Both `null` answers were settled on 2026-08-04** and the guard no longer
prints `THE FORM CANNOT BE SUBMITTED YET`. Both had been recorded as needing
something they did not need — see `resolved` in `data-safety.json`, which keeps
the write-ups:

- **What the crash SDK puts in `contexts.device`** was called underivable
  *"because the payload is assembled inside the vendored SDK"*. A vendored SDK
  **is** source — pinned in `pubspec.lock`, unpacked in the pub cache. Reading it:
  sentry-android sets `device.id` to a UUID persisted for the life of the install,
  the string `sendDefaultPii` never appears in that file, the Dart layer passes
  the unmodelled key straight through, and `scrubEvent` never touches
  `event.contexts`. → *Device or other IDs* is `true` in **both** postures. Not
  uniform across platforms: Windows and Linux never install the contexts
  integration at all, and web is excluded by the same guard.
- **Whether Play counts edge-derived coarse geo as *Approximate location*** was
  recorded as having no primary source. It is a Note on the page this file already
  cited: *"Approximate location that is inferred, such as via IP address or Access
  Point Name, must be disclosed here."* Ours is also **stored** (three columns on
  `events`) rather than used in flight, so it is neither out of scope nor
  ephemeral. → `true` under `backend-live`, optional, purpose Analytics.

⚠️ **What is still not visible from here**: whether the self-hosted GlitchTip
instance runs its own GeoIP on ingest. That is a property of that deployment, not
of this tree, and it is printed in the guard's CANNOT-SEE list. It cannot move the
shipping answer — `buildPosture.current` is `backend-live`, where *Approximate
location* is already `true`.

⚠️ **The declaration describes the `backend-live` posture** — since 2026-08-04,
when the `.aab` lane started passing the identity dart-defines alongside
`GLITCHTIP_DSN` (fixing a separate defect: every store artefact in the tree had
been the demo build, with mock auth and seeded data). Every answer is still
recorded for **both** postures, and the guard reads the workflow to say which
column to type into the console.

## What this channel needs that lives OUTSIDE this directory

- ✅ **Data safety form** → `data-safety.json` **in this directory**, since
  2026-08-04. This line used to read *"Blocking, and it has no repo
  representation"*; it now does.
- ✅ **Content rating questionnaire** → `content-rating.json` in this directory.
  It records the **answers**, never a rating — see below.
- ✅ **App content → Ads** → `ads-declaration.json` in this directory, since
  2026-08-09. It is the answer that puts the **"Contains ads" badge** on the
  listing, and it had no repo representation at all until then — no file, no
  derivation, no guard — while the two declarations above answered *their*
  advertising questions from package tells that cannot see a house ad
  (research/44 §3 V3). Today it answers **no**, and
  `assert-ads-declarations.mjs` prints `DOMAIN EMPTY` with the counts that make
  that a measurement rather than a silence.
- ✅ **Account deletion URL** — `https://nikatru.com/delete-account`, carried
  in `data-safety.json` → `dataSecurity.deletionRequestSupported` and checked to
  resolve to a page this repo actually serves. Play requires **both** halves and
  Subly has both: the in-app control (`assert-deletion-control.mjs`) and the web
  link submitted on the Data safety form itself.
- ✅ **Target API level** — Android 16 / **API 36 by 2026-08-31**. A build property, not a
  listing field, and **already met**: `apps/subly/android/app/build.gradle.kts` pins the
  integer literal `targetSdk = 36`, and `tooling/ci/assert-android-target-sdk.mjs` reads the
  floor from `tooling/legal/duty-matrix.json` → `play-target-api-level` (sourced to
  `developer.android.com/google/play/requirements/target-sdk`, fetched 2026-08-04) and fails
  the build if the literal drops below it or stops being a literal. *(This row read `⬜` until
  2026-08-11; it had been satisfied since 2026-08-04.)*
- ✅ **12 testers × 14 continuous days does NOT apply to this account.** Google's page is titled
  *"App testing requirements for new **personal** developer accounts"* and scopes the rule to
  *"developers with personal accounts created after November 13, 2023"*. NIKATRU is a
  **verified Organization account** (2026-08-04), so there is no tester window and no calendar
  dependency before production access. A closed test remains good practice, not a gate.
  *(This row read `⬜ … A calendar, not a task` until 2026-08-11.)*
  See `Private/runbooks/store-submission-android.md` §1.

## Regenerating / validating

```
node tooling/ci/assert-store-metadata.mjs          # the D-5 guard
node tooling/release/submit-play.mjs --dry-run --app subly
```

The dry run validates this tree, the built `.aab`, the signing posture and the
service-account configuration, and exits 0 **without contacting Google**.
