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
| `privacy-policy-url.txt` | Privacy policy URL | `apps/subly/lib/core/config/app_config.dart` → `privacyUrl` | ✅ exact match |
| `support-url.txt` | Support contact — website | `apps/subly/lib/core/config/app_config.dart` → `contactUrl` | ✅ exact match |
| `screenshots/` | Graphic assets | not derivable — see that directory's README | slot must exist |

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
| Graphic asset dimensions | ⚠️ **UNVERIFIED** | see `screenshots/README.md` |
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

## What this channel needs that lives OUTSIDE this directory

Play asks for several things that are not listing text and are not files here.
They are recorded so their absence is visible, not so this tree can claim them:

- ⬜ **Data safety form** — a Play Console questionnaire (G-32, owned by
  **stage 8**, not by D-5). Blocking, and it has no repo representation.
- ⬜ **Content rating questionnaire** — Play Console, per-app, one-time.
- ⬜ **Account deletion URL** — required for any app with accounts. Subly has
  in-app deletion; the *web-reachable* URL half is stage 8's.
- ⬜ **Target API level** — Android 16 / **API 36 by 2026-08-31** for new apps and
  updates. A build property, not a listing field; see
  `company/runbooks/store-submission-android.md`.
- ⬜ **12 testers × 14 continuous days** of closed testing before production
  access, for personal accounts created after 2023-11-13. A calendar, not a task.

## Regenerating / validating

```
node tooling/ci/assert-store-metadata.mjs          # the D-5 guard
node tooling/release/submit-play.mjs --dry-run --app subly
```

The dry run validates this tree, the built `.aab`, the signing posture and the
service-account configuration, and exits 0 **without contacting Google**.
