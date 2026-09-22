# Store listing — Nikatru Subscription Tracker · `apps-gov-in`

**apps.gov.in — the Mobile Seva AppStore, Government of India (MeitY / NeGD).**
Channel row: `tooling/channel-register.json` → `channels[] id: "apps-gov-in"`.
Owner queue: `O-APPS-GOV-IN-SUSPENSION-CLOCK` (`Private/platform-state/open.json`).

## Why this tree arrived late, and what it was built from

🔴 **This directory did not exist until 2026-09-20, and no guard failed over it.**
The brick has carried an `apps-gov-in` template since it was written; this app
predates the brick, its `store/` tree was hand-made, and
`tooling/ci/assert-store-metadata.mjs` printed `NO TREE (deferred)` for this
channel on every run instead of failing — because the row is `served: false`.
So the build was green on a channel whose publisher account is **verified** and
**on a clock**. The guard limb that allowed that was changed in the same commit
that created this directory: a deferred row with no tree now fails unless its
register row carries an explicit dated tree deferral. See that file's
"tree missing, row deferred" block.

**The shape here is the brick's, not an invention.** Every file below exists in
`tooling/bricks/app/__brick__/apps/{{app_id}}/store/apps-gov-in/`, and the
brick's copy is what an app stamped tomorrow gets. Nothing was added to the
shape and nothing was dropped from it.

## Where each field comes from — nothing here is a second copy of a fact

| file | source | held by |
|---|---|---|
| `title.txt` | `catalog/apps.json` → `name` | `assert-store-metadata.mjs` `derivedFields`, every run |
| `short-description.txt` | `catalog/apps.json` → `tagline` | same |
| `privacy-policy-url.txt` | `channel-register.json` → `storeMetadataContract.portfolioUrls.privacyUrl` | same |
| `support-url.txt` | same block, `supportUrl` | same |
| `category.txt` | `Others`: the portal's 23-value list has no "Productivity", and "Finance" brings up an authorisation-letter upload meant for financial institutions. `tooling/app-yaml/render.mjs` writes `Others` for every app on this channel, from `contracts/store/vocabulary.js` `STORE_FORM_RULES["apps-gov-in"].listingCategory` | `assert-store-metadata.mjs`: the value must be one of the 23 |
| `developed-by.txt` | editorial: the name the portal prints as the developer (3 to 50 characters) | `assert-store-metadata.mjs` `maxChars` |
| `form-answers.json` | every answer for the portal's three steps, each one citing its evidence | `assert-store-metadata.mjs` (its structure), `assert-apps-gov-in-apk.mjs` (the answers the built `.apk` can contradict) |
| `store-icon-512.png` | a byte copy of `../android-play/store-icon-512.png` | `assert-apps-gov-in-media.mjs`, `assert-listing-assets.mjs` |
| `long-description.txt` | **byte-identical to `../android-play/long-description.txt`** | ⚠️ nothing — see below |
| `screenshots/` | **derived at 155x290 from the `android-play` phone set** | `screenshots/CAPTURE.json` records it; `assert-apps-gov-in-media.mjs` re-derives it |

⚠️ **`long-description.txt` is a COPY and nothing holds the two together.** It is
android-play's copy rather than the other four channels' shared copy for one
reason: **this channel distributes the same Android `.apk`**, so it is the text
with the Android `PERMISSIONS` paragraph (notification permission, and that
declining it costs only reminders) that is true of what a user installs from
here. That paragraph is false of the desktop trees, which is why they carry a
different text. The exposure is real and it is pre-existing rather than new:
`ios-appstore`, `macos-appstore`, `windows-store` and `linux-snap` already carry
four byte-identical copies of one description with no guard holding them equal.
Edit android-play's copy and this one forks silently. **Recorded, not fixed
here** — a "listing copy may not fork across channels sharing an artifact" limb
is a policy decision about all six trees, not this channel's business.

## 🔴 No submission API, and no repository will ever upload this listing

apps.gov.in publishes no submission API at all: the developer portal is a manual
web workflow and the "APIs" it advertises are open-data APIs for apps to
**consume**. The register row says so in `noSubmissionApi`, carries
`submittable: false`, and `tooling/ci/assert-channel-register.mjs` prints
`NO SUBMISSION API` for it on every run. A person types this listing into the
portal, from these files. `C-MANUAL-FIRST-PUBLISH` is satisfied by construction
here rather than pending a script somebody has not written.

## ⏳ The clock, which no other row in this register has

The developer profile was **APPROVED 2026-08-31, entity INDIVIDUAL**
(`Private/platform-state/identity.json` → `storeAccounts.apps-gov-in`). An
individual developer must upload an app within two months of profile approval or
the profile is suspended, so the `verified` status lapses about **2026-10-31** by
the store's own rule rather than by going stale. It is the only expiry in
[ADR 067]. The owner's upload sitting is that date.

## The form, read on 2026-09-22

The upload form's rules were read from its own script (`/Developer/chunk-ZVEOEZCZ.js`)
on 2026-09-22. They are recorded in the Private runbook
`runbooks/store-submission-apps-gov-in.md`, and in this repository in
`contracts/store/vocabulary.js` `STORE_FORM_RULES["apps-gov-in"]` and
`tooling/channel-register.json` `storeMetadataContract.perChannel["apps-gov-in"]`.
`tooling/ci/assert-store-metadata.mjs` enforces them:

- the category comes from the form's 23 values;
- screenshots: 4 to 8, exactly 155x290, png or jpg, at most 1,048,576 bytes each;
- the icon: 512x512, under 204,800 bytes;
- field lengths: app name 2 to 80, developed-by 3 to 50, description 10 to 4000,
  support phone at most 12.

`form-answers.json` holds the answer to every question on the form, each with its
evidence. The owner fills only the support email and the support phone, which are
marked `OWNER FILLS`. The file to upload is the CI artifact
`apps-gov-in-<app>-apk`, produced by the Android job of
`.github/workflows/build-platforms.yml`.

## Changing the copy

- A **derived** field (title, short description, category, the two URLs):
  change the source, not this file. The guard compares them on every run and a
  fork fails the build. The category's source is `listingCategory`, not the
  app's own `app.yaml` category.
- An **editorial** field (`long-description.txt`, `developed-by.txt`): edit it
  here. For the description, edit `../android-play/long-description.txt` in the
  same change, or the two disagree about the same `.apk`.
