# Chrome listing — UNFILLED SKELETON

Every `.txt` beside this file carries a `⟨…⟩` placeholder. They are placeholders and not blank
on purpose: `check-store-metadata.mjs` fails an EMPTY listing field, so a stamped tool is red
until somebody writes the copy — which is the intended state. A blank file would pass a presence
check and ship as an empty store field.

## Limits enforced

- `title.txt` — 75 chars (developer.chrome.com/docs/extensions/reference/manifest/name)
- `short-description.txt` — 132 chars (developer.chrome.com/docs/webstore/best-listing)

⚠️ No maximum is enforced on `long-description.txt`: the widely-repeated 16,000 appears nowhere
on developer.chrome.com. An unsourced limit is not enforced.

## Before you submit

Set `served: true` on this store in `tool.json` only once the listing is live. Until then a
missing directory prints; after it, a missing directory fails.
