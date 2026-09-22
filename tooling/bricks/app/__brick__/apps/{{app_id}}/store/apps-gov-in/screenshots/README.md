# Screenshots — {{{short_name}}} · `apps-gov-in`

**This directory is stamped EMPTY on purpose.** Every other field in this tree
is derived from the app spec by `tooling/bricks/app`. Screenshots cannot be:
they are pictures of a build that does not exist at stamp time.

## What the portal accepts

These rules come from the upload form's own script (`/Developer/chunk-ZVEOEZCZ.js`),
read on 2026-09-22, and are recorded in `contracts/store/vocabulary.js`
`STORE_FORM_RULES["apps-gov-in"]`.

| field | rule |
|---|---|
| screenshot pixel size | **exactly 155x290**: any other size is refused |
| screenshot count | 4 to 8 |
| screenshot format | png or jpg |
| screenshot file size | at most 1,048,576 bytes each |
| icon (`../store-icon-512.png`) | 512x512, under 204,800 bytes |

`tooling/ci/assert-store-metadata.mjs` applies every rule in that table. While
the app is `preview` in the catalogue, an empty directory here is printed; once
it is `live`, an empty directory fails the build.

## How to fill it

Do not capture at 155x290. Derive this set from the app's `android-play` phone
screenshots, which must be a LIVE capture (their `CAPTURE.json` says posture
`live`):

```
node tooling/ci/assert-apps-gov-in-media.mjs --write --app {{app_id}}
```

That pads each Play screenshot to the portal's shape, shrinks it to 155x290,
copies the Play store icon beside this directory, and writes `CAPTURE.json`
recording where every file came from. The same script, run with no arguments in
CI, fails when a Play screenshot changes and this set was not re-derived, or
when a file here was edited by hand.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen: seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.
