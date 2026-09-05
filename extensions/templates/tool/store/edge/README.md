# Edge listing — UNFILLED SKELETON

Every `.txt` beside this file carries a `⟨…⟩` placeholder. They are placeholders and not blank
on purpose: `check-store-metadata.mjs` fails an EMPTY listing field, so a stamped tool is red
until somebody writes the copy — which is the intended state. A blank file would pass a presence
check and ship as an empty store field.

## Limits enforced

- `long-description.txt` — **minimum 250**, maximum 10,000
  (learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)

Edge is the only one of the three with a MINIMUM, and it is the easiest to trip.

⚠️ Edge takes the **same chromium zip as Chrome**, minus two documented manifest edits: remove
`update_url`, and rebrand if the name or description says "Chrome". Put that patch in
`storeMetadata.stores.edge.manifestPatch` if your tool needs one.

⚠️ The short description is **not editable in the Edge portal** — it comes from the manifest.

## Before you submit

Set `served: true` on this store in `tool.json` only once the listing is live. Until then a
missing directory prints; after it, a missing directory fails.
