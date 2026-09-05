# Chrome Web Store listing

The fields the Chrome Web Store dashboard asks for, one per file. Extracted from
`publish/STORE-LISTING.md`, which keeps the REASONING — why the redaction bullet is
worded the way it is, which policy each claim answers to. This directory is the COPY;
that document is the argument.

## Limits enforced here

- `title.txt` — 75 characters. developer.chrome.com/docs/extensions/reference/manifest/name
- `short-description.txt` — 132 characters. developer.chrome.com/docs/webstore/best-listing

⚠️ **`long-description.txt` has NO enforced maximum.** The widely-repeated 16,000 appears
nowhere on developer.chrome.com — not on cws-dashboard-listing, best-listing, prepare, or
the listing-requirements policy. An unsourced limit is not enforced here.

## Not in this directory

Screenshots and the promo tile live in `../_shared/` — 1280x800 is the one screenshot size
Chrome, Edge and AMO all accept, and the 440x280 tile is byte-identical between Chrome and
Edge. Permission justifications and the single-purpose statement are dashboard fields
drafted in `publish/STORE-LISTING.md`.
