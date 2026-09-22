# Store listing — {{{short_name}}} · `apps-gov-in`

**apps.gov.in — the Mobile Seva AppStore, Government of India
(`O-APPS-GOV-IN-SUSPENSION-CLOCK`).**

## This tree was GENERATED, not typed

Every file here was written by `tooling/bricks/app` from the app spec when
`{{app_id}}` was stamped. Nobody hand-wrote a listing for this app and nobody
should: `tooling/ci/assert-store-metadata.mjs` checks BOTH that this tree is
complete AND that the brick still emits it, so an app stamped tomorrow gets the
same listing without anyone opening a console.

`title.txt` and `short-description.txt` are compared on every CI run against
`sites/_shared/_data/apps.json` (`name` and `tagline`), and the two URLs
against `tooling/channel-register.json` → `storeMetadataContract.portfolioUrls`.
**Editing a derived file here without editing its source fails the build.**

## 🔴 THIS IS THE ONE CHANNEL WITH NO SUBMISSION API AND A CLOCK

Two facts about this store make its listing different from every other tree in
this directory, and both are recorded rather than implied:

1. **There is no publishing API.** The developer portal is a manual web
   workflow; the "APIs" it advertises are open-data APIs for apps to CONSUME.
   Measured in `research/revamp-2026-09-05/09-selfhost-build-release.md` §1.9.
   The register row therefore reads `submittable: false` with a written
   `noSubmissionApi` reason, and `tooling/ci/assert-channel-register.mjs` prints
   `NO SUBMISSION API` for it on every run. **Nothing in this repository will
   ever upload this listing.** A person types it into the portal, from here.
2. **The developer profile expires.** An individual developer must upload an app
   within two months of profile approval or the profile is suspended. Approved
   2026-08-31, so the clock runs out about **2026-10-31** — the only expiry in
   [ADR 067].

The procedure, the exact owner steps, and the fields nobody has read yet are in
`Private/runbooks/store-submission-apps-gov-in.md`. Read that before touching
anything here.

## Changing the copy

- A DERIVED field (title, short description, the two URLs): change the source,
  not this file.
- An EDITORIAL field (`long-description.txt`): edit it here. It is stamped with
  a truthful description of what the chassis gives every app; replace it with
  what THIS app does as soon as it does it.

## The form, read on 2026-09-22

The upload form was read on 2026-09-22, from its own script. Its rules are in
`contracts/store/vocabulary.js` `STORE_FORM_RULES["apps-gov-in"]`, and its text
limits are in `tooling/channel-register.json`
`storeMetadataContract.perChannel["apps-gov-in"].maxChars`.
`tooling/ci/assert-store-metadata.mjs` applies both to every app and to this
template.

- `category.txt` is `Others` for every app. The form's 23 categories have no
  "Productivity", and "Finance" asks for an authorisation letter.
  `tooling/app-yaml/render.mjs` writes the same value, from `listingCategory`.
- `developed-by.txt` is the form's "Developed By" field, 3 to 50 characters.
- `form-answers.json` holds the answer to every question on the form, each with
  its evidence. It is stamped with the answers that are true of the chassis. Re-read
  step 3 whenever the app gains a feature: CI fails the built `.apk` if it
  requests a device permission this file answers No to.
- `store-icon-512.png` is written by the stamp as a placeholder, and replaced by
  `node tooling/ci/assert-apps-gov-in-media.mjs --write --app {{app_id}}` with a
  copy of the Play store icon.
- `screenshots/` explains how the 155x290 set is derived.
