# Microsoft Edge Add-ons listing

Edge takes the **same chromium zip as Chrome** — `tool.json` declares
`targets.chromium.stores = ["chrome","edge"]`, and `release.yml` says "the identical file
goes to both". What differs is the listing, which is why this directory exists.

## Limits enforced here

- `long-description.txt` — **minimum 250**, maximum 10,000 characters.
  learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension
  Edge is the only one of the three with a MINIMUM, and it is the easiest to trip.

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
