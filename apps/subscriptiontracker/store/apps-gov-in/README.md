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
| `category.txt` | editorial — the same answer as the other five trees | nothing; it is one word and the stores' taxonomies differ |
| `long-description.txt` | **byte-identical to `../android-play/long-description.txt`** | ⚠️ nothing — see below |
| `screenshots/` | **byte-identical copies of the `android-play` phone set** | `screenshots/CAPTURE.json` records it; see that file |

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

## ⚠️ UNVERIFIED — the field list itself, and what "unread" precisely means

No listing character limit and no listing **field list** has been read from the
form that will actually be filled in. The upload form is behind an authenticated
JavaScript SPA at `apps.gov.in/Developer`; `apps.gov.in/Developer/hosting_req`
returns an empty shell to a non-JS fetch. So no limit is declared in
`tooling/channel-register.json` for this channel, none is enforced, and this tree
carries the portfolio's standard eight files rather than a set derived from the
real form. **An agent never logs in.**

⚠️ **"Nobody has read it" is too strong, and the distinction matters.** The
portal's public JavaScript bundles *were* searched case-insensitively
(2026-09-08): no SBOM field, no bill-of-materials field, no audit-certificate
field, no request for source code. That is what closed `O-APPS-GOV-IN-SBOM` as
DEFER-CONFIRMED on 2026-09-08 — **that row is `done`, and anything still citing
it as the open unread-form blocker is stale**, including
`tooling/bricks/app/__brick__/apps/{{app_id}}/store/apps-gov-in/`, which this
tree's shape came from. What remains unseen is the **authenticated** form, so
the reading above is confirmed rather than assumed; that residue rides with
`O-APPS-GOV-IN-SUSPENSION-CLOCK`, the upload sitting itself. The runbook —
`Private/runbooks/store-submission-apps-gov-in.md` — has a section waiting for
it; fill that, this tree's screenshot table, and the register's
`storeMetadataContract.perChannel["apps-gov-in"]` from the one sitting.

## Changing the copy

- A **derived** field (title, short description, the two URLs): change the
  source, not this file. The guard compares them on every run and a fork fails
  the build.
- An **editorial** field (`long-description.txt`, `category.txt`): edit it here —
  and, for the description, edit `../android-play/long-description.txt` in the
  same change or the two disagree about the same `.apk`.
