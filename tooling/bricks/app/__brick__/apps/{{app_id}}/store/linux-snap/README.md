# Store listing — {{{short_name}}} · `linux-snap`

**Snap Store (OWNER_QUEUE A-6).**

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

- `snap-name.txt` — **the field with real consequences.** This is the GLOBAL
  Snap Store namespace, claimed once with `snapcraft register <name>` and not
  transferable casually. It is stamped as the app id in `param-case` (a snap
  name may not contain an underscore) so the name we intend to claim is
  reviewable and diffable BEFORE it is claimed, instead of being decided at a
  terminal prompt.
- `license.txt` — the SPDX identifier the listing shows. `proprietary` is a
  valid SPDX-ish value the Snap Store accepts; change it only if this app really
  ships under an open licence.

## ⚠️ UNVERIFIED

No Snap Store listing character limit has been fetched from a primary source, so
none is declared in `tooling/channel-register.json` and none is enforced.
