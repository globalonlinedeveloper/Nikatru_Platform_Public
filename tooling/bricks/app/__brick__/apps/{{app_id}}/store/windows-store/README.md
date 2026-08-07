# Store listing — {{{short_name}}} · `windows-store`

**Microsoft Store — the first channel this factory can register (OWNER_QUEUE A-2).**

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

- `search-terms.txt` — Microsoft Store Policies v7.19 §10.1.3: *"Not exceed
  seven unique terms or phrases."* Stamped with the three terms derivable from
  the spec (the app name, its id and its category); add up to four more that
  describe what the app actually does. The limit is enforced from the register.

## ⚠️ UNVERIFIED

No character limit for the Microsoft Store's name or description was fetched
from a primary source, so **none is enforced**. An invented limit fires on
correct input, and this repository has already deleted one for doing exactly
that. Fetch `learn.microsoft.com` and add the number with its URL and date to
`storeMetadataContract.perChannel["windows-store"].maxChars` before relying on
one.

## Package identity

The MSIX identity is NOT in this tree. It is one declaration in
`tooling/channel-register.json` → `channels[windows-store].packageIdentity`,
applied to `pubspec.yaml`'s `msix_config:`, and Partner Center assigns the
real values after A-2.
