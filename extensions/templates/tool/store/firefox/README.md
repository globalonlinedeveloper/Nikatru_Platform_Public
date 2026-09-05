# Firefox listing — UNFILLED SKELETON

Every `.txt` beside this file carries a `⟨…⟩` placeholder. They are placeholders and not blank
on purpose: `check-store-metadata.mjs` fails an EMPTY listing field, so a stamped tool is red
until somebody writes the copy — which is the intended state. A blank file would pass a presence
check and ship as an empty store field.

## Limits enforced

- `short-description.txt` — 250 chars. AMO calls this the **summary**.
  (extensionworkshop.com/documentation/develop/create-an-appealing-listing/)

🔴 **The add-on id is yours, not the store's.** `browser_specific_settings.gecko.id` is derived
from `publish/identity.json` as `<slug>@<ownerDomain>`. **AMO fixes it at FIRST SIGNING and it
cannot be walked back** — Mozilla: a guid "cannot be restored and will forever be unusable for
submission". Run `publish/verify-firefox-package.node.js` before any AMO upload.

AMO takes up to **two** categories where Chrome and Edge take one.

## Before you submit

Set `served: true` on this store in `tool.json` only once the listing is live. Until then a
missing directory prints; after it, a missing directory fails.
