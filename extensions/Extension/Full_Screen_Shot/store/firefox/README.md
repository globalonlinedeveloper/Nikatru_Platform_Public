# Firefox Add-ons (AMO) listing

AMO takes a **different build** from Chrome and Edge — the firefox target, with
`publish/manifest.firefox.json` applied as an RFC 7386 merge patch. Every `.txt` here is
RENDERED from `../listing.json` by `scripts/render-listing.mjs`; edit the copy there, never here.

## Limits enforced here

- `short-description.txt` — 250 characters. This is what AMO calls the **summary**.
  extensionworkshop.com/documentation/develop/create-an-appealing-listing/
- `tags.txt` — AMO's tags, one per line. **No limit is enforced**: AMO's tag limit has not yet
  been read from its primary source, and a limit with no source is refused, not guessed.

## Two things AMO does differently

1. **Up to TWO categories**, where Chrome and Edge take one. `category.txt` may carry two
   lines here and one there.
2. **The add-on id is ours, not the store's.** `browser_specific_settings.gecko.id` is
   `fullshot@nikatru.com`, authored in `publish/identity.json`. 🔴 **AMO fixes the identity
   at FIRST SIGNING and it cannot be walked back** — Mozilla: a guid "cannot be restored and
   will forever be unusable for submission". `publish/verify-firefox-package.node.js` is the
   gate that refuses a placeholder, and `publish/STALE-FIREFOX-ARTIFACTS-2026-08-20.md`
   records the six packages that carried one.

⚠️ **The 50-character name limit is NOT enforced** — MDN only, same caveat as Edge.
extensionworkshop states no name limit.

## No graphic of its own, and that is measured rather than assumed

AMO asks for no asset at a size nothing else asks for, so this directory holds copy only.

- **Screenshots** — `../_shared/screenshots/`, 1280x800, the size AMO names as its maximum
  display size. AMO is the one store of the three that does **not** document screenshots as
  required; the set exists because Chrome does.
- **Icon** — `../_shared/icon-128.png`. ⚠️ **Two current Mozilla pages give different numbers and
  both are current.** The listing guidance (fetched 2026-09-20) says *"You can load icons at two
  resolutions—32x32 and 64x64—in either PNG or JPEG format"*; `mozilla.github.io/addons-server`
  recommends a 128x128 upload that AMO resizes itself. A 128x128 upload satisfies both readings,
  so AMO takes the same file Chrome requires and no second slot is created for a number two pages
  cannot agree on.
- **Promo tiles** — AMO has no equivalent asset. Nothing is owed.
