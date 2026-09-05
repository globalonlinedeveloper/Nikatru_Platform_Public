# Screenshots, TABLET set — {{{short_name}}} · `android-play`

**This directory is stamped EMPTY on purpose, and its emptiness is the SECOND
DEVICE TYPE Play's minimum counts.** Google's sentence is *"You must provide a
minimum of two screenshots across different device types to publish your store
listing"* — a count of TYPES, not of files. `screenshots/` beside this one is
the phone type. This directory is the tablet type, and until it holds real
frames this app is not publishable at all, however many phone shots it carries.

🔴 **THIS DIRECTORY DID NOT EXIST IN THE BRICK UNTIL 2026-09-05, AND THAT IS THE
DEFECT IT WAS ADDED FOR.** `tooling/channel-register.json` has required the
tablet set since 2026-08-21 and `apps/subly/store/android-play/screenshots-tablet`
has carried it since 2026-08-27, but the template every future app is stamped
from emitted only `screenshots/`. So every app stamped between those dates was
born one device type short — structurally unpublishable — and nothing said so,
because the guard that counts device types ranged over `catalog/apps.json` and
could not see a template. A check that cannot see the factory grades only the
one app somebody already fixed by hand.

## The obligation, with its numbers

Every number below is `tooling/channel-register.json` →
`storeMetadataContract.perChannel["android-play"].graphicAssets.screenshots
.deviceTypeCoverage.sets.tablet`, and it is enforced from THERE, never from a
copy in this file:

| | |
|---|---|
| how many | **at least 4** (`minCount`) |
| short side | **at least 1080px** (`minSide`) |
| long side | **at most 3840px** (`maxSide`) |
| portrait aspect | **exactly 9:16** (`portraitAspect`) |

Verbatim from the page, fetched 2026-08-21 —
`support.google.com/googleplay/android-developer/answer/9866151`: *"For
Chromebook and tablets, you can add a minimum of 4 screenshots to demonstrate
your in-app experience. Upload screenshots between 1,080 and 7,680px Use a 16:9
aspect ratio for landscape and a 9:16 aspect ratio for portrait"*.

⚠️ **THE PAGE STATES TWO MAXIMA AND DOES NOT RECONCILE THEM** — the general
Requirements block says 3840px, the tablet paragraph says 7,680px. The register
enforces the STRICTER (3840) so a compliant set is inside both readings, and
keeps the looser one beside it as `statedMaxSideForTablets` rather than dropping
it: a number that was read and then discarded looks exactly like one nobody
looked for.

## How to fill it

1. Build and run the app for Android.
2. `tooling/store/capture-play-screenshots.mjs` drives the SAME capture suite at
   a second viewport — CSS 900x1600 at DPR 2 → **1800x3200**, inside the
   expanded window class `AppBreakpoints` declares, exactly 9:16, and clear of
   every bound above. Same suite means the same guarded shutter in
   `store_capture_guard.dart`; adding a form factor opens no second path to the
   pixels.
3. Commit the PNGs here, with the `CAPTURE.json` the live run writes. A
   screenshot with no provenance is evidence about nothing.

## 🔴 DO NOT PUT A PLACEHOLDER HERE

Not a 1x1, not a grey rectangle, not a copy of a phone frame, not a `.gitkeep`
renamed to `.png`. **`tooling/ci/assert-play-device-coverage.mjs` FAILS on any
PNG found in this directory in the brick**, at any served state and on any lane,
and that limb is not tidiness:

- A placeholder in the template is stamped into every app at once, and it
  satisfies exactly the check — "the tablet directory has pixels" — that is
  supposed to prove the frames were captured. It would turn this whole
  mechanism into a rubber stamp.
- The frames in a store listing are what a stranger decides to install on. A
  listing built from placeholders advertises a product nobody can recognise,
  and it can be published — which is strictly worse than a listing that cannot
  be published yet and says why.

An empty set that is DECLARED and VISIBLE is an honest unfinished job. A filled
set that is fake is a finished-looking lie, and this repository has already
deleted one invented compliance number for firing on correct input.

## Why a README rather than nothing

Git cannot commit an empty directory. This file is the only thing that makes the
directory exist in a fresh clone — which is precisely how the gap arose: there
was nothing to commit, so there was no directory, so there was no device type.

The guard checks this file is here for the same reason. A missing README means a
missing directory means a stamped app that is short a device type again.
