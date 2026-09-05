# Firefox Add-ons (AMO) listing

AMO takes a **different build** from Chrome and Edge — the firefox target, with
`publish/manifest.firefox.json` applied as an RFC 7386 merge patch.

## Limits enforced here

- `short-description.txt` — 250 characters. This is what AMO calls the **summary**.
  extensionworkshop.com/documentation/develop/create-an-appealing-listing/

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
