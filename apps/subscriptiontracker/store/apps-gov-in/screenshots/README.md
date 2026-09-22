# Screenshots — Nikatru Subscription Tracker · `apps-gov-in`

**This directory holds four PNGs at exactly 155x290, and none of them was
captured for this channel.** Each is derived from the `android-play` phone
screenshot of the same name. `CAPTURE.json` beside them records the source, the
source's SHA-256, the command, and the output's SHA-256 and bytes.

| file | pixels | PNG colour type | derived from |
|---|---|---|---|
| `01-home.png` | 155x290 | 2 (no alpha) | `../../android-play/screenshots/01-home.png` |
| `02-calendar.png` | 155x290 | 2 (no alpha) | `../../android-play/screenshots/02-calendar.png` |
| `03-insights.png` | 155x290 | 2 (no alpha) | `../../android-play/screenshots/03-insights.png` |
| `04-budget.png` | 155x290 | 2 (no alpha) | `../../android-play/screenshots/04-budget.png` |

The store icon sits one level up, as `../store-icon-512.png`. It is a byte copy of
`../../android-play/store-icon-512.png`, which `tooling/store/render-play-graphics.mjs`
derives 2:1 from the launcher-icon master `assets/icon/app_icon_1024.png`.

## What the portal accepts

These rules come from the upload form's own script (`/Developer/chunk-ZVEOEZCZ.js`),
read on 2026-09-22. They are recorded in `contracts/store/vocabulary.js`
`STORE_FORM_RULES["apps-gov-in"]` and in the Private runbook
`runbooks/store-submission-apps-gov-in.md`, under Step 2.

| field | rule |
|---|---|
| screenshot pixel size | **exactly 155x290**: any other size is refused |
| screenshot count | 4 to 8 |
| screenshot format | png or jpg |
| screenshot file size | at most 1,048,576 bytes each |
| icon | 512x512, under 204,800 bytes |

`tooling/ci/assert-store-metadata.mjs` applies every rule in that table.

An earlier note in this directory said the store specified nothing. That was true
of the public hosting guidelines PDF, but those guidelines are not the form. The
form's script is the actual rule set.

## Why derived, and how

This channel ships the same app and the same screens as the `android-play` lane.
The Play set was captured from a **live** build (its `CAPTURE.json` says posture
`live`), so it shows no "Demo data" banner and no third-party names.

A re-capture at 155x290 would need a signed-in test account on the machine that
runs it. A derivation needs only the committed originals. The derivation works
like this:

1. Pad each 1080x1920 original to the portal's aspect ratio by repeating its top
   and bottom rows, giving 1080x2021. This adds 50 rows above and 51 below. It
   crops nothing and stretches nothing.
2. Shrink the padded image to 155x290 by an exact area average.
3. Write the result as a 24-bit PNG with no alpha channel.

Re-derive with:

```
node tooling/ci/assert-apps-gov-in-media.mjs --write --app subscriptiontracker
```

`tooling/ci/assert-apps-gov-in-media.mjs` runs in CI with no arguments. It
re-derives every file and compares the pixels, and it fails when either of two
things is true:

- The Play set was re-captured and this set was not. The source hashes stop
  matching, and the failure names the command above.
- A file here was edited by hand.

Never hand-place a PNG here.
