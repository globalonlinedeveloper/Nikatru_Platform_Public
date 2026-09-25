# Chrome Web Store listing

The fields the Chrome Web Store dashboard asks for, one per file. Every `.txt` here is
RENDERED from `../listing.json` by `node scripts/render-listing.mjs fullshot` (from
`extensions/`), and check-store-metadata.mjs fails a hand edit — change the copy in
`listing.json`. `publish/STORE-LISTING.md` keeps the REASONING — why the redaction bullet
is worded the way it is, which policy each claim answers to.

## Limits enforced here

- `title.txt` — 75 characters. developer.chrome.com/docs/extensions/reference/manifest/name
- `short-description.txt` — 132 characters. developer.chrome.com/docs/webstore/best-listing

⚠️ **`long-description.txt` has NO enforced maximum.** The widely-repeated 16,000 appears
nowhere on developer.chrome.com — not on cws-dashboard-listing, best-listing, prepare, or
the listing-requirements policy. An unsourced limit is not enforced here.

## The graphic in this directory

`promo-tile-440x280.png` — **440x280, and Chrome REQUIRES it.**
<https://developer.chrome.com/docs/webstore/images> (fetched 2026-09-20), verbatim:
*"Small: 440x280 pixels (required)"*. A submission without it is refused at upload, which is why
capturing screenshots alone does not unblock this store.

It sits here rather than in `../_shared/` because `_shared/` means *all three stores take this*:
Edge treats a 440x280 tile as **optional** and AMO has no equivalent asset at all. An earlier note
in `../_shared/README.md` planned to keep it there; that plan is superseded and the correction is
recorded where it stood.

It is **derived**, not drawn by hand:
`node ../../scripts/render-extension-graphics.mjs fullshot` composes it from the extension's own
128x128 icon and its own `--accent` colours. `--check` proves the committed file is still that
script's output.

## Not in this directory

Screenshots live in `../_shared/screenshots/` — 1280x800 is the one size Chrome, Edge and AMO all
accept — and so does `../_shared/icon-128.png`, the 128x128 store icon Chrome requires and AMO
reuses. The 1400x560 marquee tile is optional and is not produced. Permission justifications and
the single-purpose statement are dashboard fields drafted in `publish/STORE-LISTING.md`.
