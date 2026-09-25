# Microsoft Edge Add-ons listing

Edge takes the **same chromium zip as Chrome** — `tool.json` declares
`targets.chromium.stores = ["chrome","edge"]`, and `release.yml` says "the identical file
goes to both". What differs is the listing, which is why this directory exists. Every
`.txt` here is RENDERED from `../listing.json` by `scripts/render-listing.mjs`; edit the copy
there, never here.

## Limits enforced here

- `long-description.txt` — **minimum 250**, maximum 10,000 characters.
  learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
  Edge is the only one of the three with a MINIMUM, and it is the easiest to trip.
- `search-terms.txt` — **at most seven unique terms**, one per line (`maxItems: 7` in `tool.json`).
  learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies §1.1.4, fetched
  2026-09-24: "Search terms may not exceed seven unique terms".

## Two things Edge does differently

1. **The short description is not editable in the portal.** Microsoft: "To edit the short
   description, you must update the description field in the manifest file of the extension
   package, and then re-upload the package." So there is no `short-description.txt` to
   maintain here — the manifest is the field.
2. **Two manifest edits are required to port a Chrome package**: remove `update_url`, and
   rebrand if the name or description says "Chrome". Measured 2026-08-20: FullShot carries
   no `update_url` and its name is `__MSG_appName__`, so **no patch is needed today**.
   `storeMetadata.stores.edge.manifestPatch` is present and `null` so that the day one is
   needed it is a value, not a new mechanism.

⚠️ **The 45-character name limit is NOT enforced.** MDN states it, dated "as of February
2024"; learn.microsoft.com states no name limit anywhere. MDN is a secondary source for
another vendor's rule.

## The graphic in this directory

`logo-300x300.png` — **300x300, and Edge REQUIRES it.** Same page, fetched 2026-09-20, verbatim:
*"Extension logo | Required for each language | An image (one per language) that represents your
company or extension logo, with an aspect ratio of 1:1 and a recommended size of 300 x 300 pixels,
with a minimum size of 128 x 128 pixels."*

**"Required for each language" is a dashboard duty, not a file duty.** The same page's Step 7 says
the logo is copied across languages inside Partner Center — *"click the Duplicate option … For
example, click Duplicate this logo for all languages"* — so one file here serves every locale the
package declares, and nobody should add `_locales`-shaped copies of it.

**300x300 is what is rendered and what is enforced**, not the 128x128 minimum: a logo at the floor
would be upscaled by the store, and that is a quality loss nothing downstream could see.

Derived like every other listing graphic —
`node ../../scripts/render-extension-graphics.mjs fullshot` — from the extension's own icon and
accent colours. The 440x280 and 1400x560 promotional tiles are **optional** on Edge; the 440x280
file in `../chrome/` would satisfy the small one byte-for-byte if the owner chooses to upload it,
and neither is declared required here.
