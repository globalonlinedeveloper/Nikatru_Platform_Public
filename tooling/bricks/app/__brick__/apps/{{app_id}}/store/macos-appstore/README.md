# Store listing — {{{short_name}}} · `macos-appstore`

**Mac App Store — a SEPARATE App Store Connect record with its own review outcome (OWNER_QUEUE A-4).**

## This tree was GENERATED, not typed

Every file here was written by `tooling/bricks/app` from the app spec when
`{{app_id}}` was stamped. Nobody hand-wrote a listing for this app and nobody
should: `tooling/ci/assert-store-metadata.mjs` checks BOTH that this tree is
complete AND that the brick still emits it, so an app stamped tomorrow gets the
same listing without anyone opening a console.

`title.txt` and `short-description.txt` are compared on every CI run against
`sites/_shared/_data/apps.json` (`name` and `tagline`), and the two URLs
against `tooling/channel-register.json` → `storeMetadataContract.portfolioUrls`.
**Editing a derived file here without editing its source fails the build.** That
is the point: the console is a copy of this directory, never the other way round.

## Changing the copy

- A DERIVED field (title, short description, the two URLs): change the source,
  not this file.
- An EDITORIAL field (`long-description.txt`, and the per-channel files below):
  edit it here. It is stamped with a truthful description of what the chassis
  gives every app; replace it with what THIS app does as soon as it does it.

## Per-channel fields

- `subtitle.txt` — a real App Store field, **30 characters**, taken from the
  spec's `subtitle` var. It is a spec field rather than a slice of the short
  description because truncating prose to 30 characters invents copy.
- `keywords.txt` — comma-separated, no spaces after the commas (Apple counts
  them). Stamped from the app id and its category; add the words a buyer would
  actually type.
- `promotional-text.txt` — the one field Apple lets you change WITHOUT a new
  review. Worth keeping short and worth keeping current.

## ⚠️ UNVERIFIED

Only two Apple numbers were fetched from a primary source — app name 30 (min 2)
and subtitle 30, both from
`developer.apple.com/help/app-store-connect/reference/app-information/`
(2026-07-29). The limits for **keywords, description and promotional text are
NOT on that page** and are therefore not enforced anywhere. The corpus's
"100 characters for keywords" is not sourced either. Fetch the page that carries
them before adding a number.

⚠️ `short-description.txt` is NOT Apple's subtitle. Apple has no field of that
name; it is the repo-native line the ≤30 subtitle is condensed from, and it is
required in every tree by the contract.
