# Screenshots — Nikatru Subscription Tracker · `apps-gov-in`

**This directory holds four PNGs and not one of them was captured for this
channel.** They are byte-identical copies of the `android-play` phone set.
`CAPTURE.json` beside them records which file each came from, its SHA-256, and
the posture of the run that originally produced it — a screenshot with no
provenance is evidence about nothing, and a *copied* screenshot with no
provenance is worse, because it looks captured.

| file | pixels | PNG colour type | origin |
|---|---|---|---|
| `01-home.png` | 1080x1920 | 2 (no alpha) | `../../android-play/screenshots/01-home.png` |
| `02-calendar.png` | 1080x1920 | 2 (no alpha) | `../../android-play/screenshots/02-calendar.png` |
| `03-insights.png` | 1080x1920 | 2 (no alpha) | `../../android-play/screenshots/03-insights.png` |
| `04-budget.png` | 1080x1920 | 2 (no alpha) | `../../android-play/screenshots/04-budget.png` |

## Why a copy is the honest answer here, and not a shortcut

The Play set was captured by `tooling/store/capture-play-screenshots.mjs` against
a **live** build (`CAPTURE.json` posture `live`) — not a demo build, whose every
screen carries a "Demo data" banner and whose board is twelve third-party
trademarks. **This channel distributes the same `.apk` the `android-play` lane
produces**, on the same platform, showing the same four screens: `01-home`,
`02-calendar`, `03-insights`, `04-budget`. There is no second app to photograph.
Re-running the capture would produce a second set of pixels of the same screens
and a second `CAPTURE.json` to keep in step — two records of one photograph.

⚠️ **This is the one borrowing this tree permits, and the reason is the
artifact.** The `linux-snap`, `macos-appstore` and `windows-store` READMEs each
forbid borrowing for the opposite reason: a macOS screenshot submitted for Linux
shows the wrong window chrome and the wrong system fonts, because those channels
ship *different builds*. Here the build is the same file.

## 🔴 The store specifies NOTHING, and the absence is the finding

**`NOT SPECIFIED` — no screenshot or icon dimension, count, aspect ratio, format
or file-size cap is published by this store anywhere a non-authenticated reader
can reach.**

| field | value | status |
|---|---|---|
| screenshot pixel dimensions | — | 🔴 **NOT SPECIFIED by the store** |
| screenshot count (min / max) | — | 🔴 **NOT SPECIFIED by the store** |
| accepted file formats | — | 🔴 **NOT SPECIFIED by the store** |
| file-size cap | — | 🔴 **NOT SPECIFIED by the store** |
| feature graphic dimensions | — | 🔴 **NOT SPECIFIED by the store** |
| icon dimensions | — | 🔴 **NOT SPECIFIED by the store** |

**That is measured, not assumed.** Source:
<https://apps.gov.in/assets/SOP/App-Hosting-&-Security-Guidelines.pdf> — "NeGD
App Hosting & Security Guidelines, Gov.in App Store", cover date 2-10-2025,
18 pages, **read in full by the store-asset research lane on 2026-09-20**
(`Private/research/session-2026-09-19b/store-shots/REQUIREMENTS.md` §11 — that
reading is the citation; this lane did not re-fetch the PDF). It is a
security and compliance document (OWASP MASVS/MSTG, App Defense Alliance,
ISO 27001/27701, NIST SP 800-53/800-171). Its **entire** treatment of listing
media is one clause, §4.1, and it is the only occurrence of the word
"screenshots" in the document:

> "Listing Confirmation: Developers verify store details (screenshots, feature graphic, T&C)."

No icons, no pixels, no aspect ratios, no formats, no size caps, no counts.

⚠️ **The field names mirror Google Play's, and that is an inference, not a
measurement.** "screenshots" and "feature graphic" are Play's own words, which
suggests the upload form was modelled on Play's — which is the reason the Play
set is a *reasonable* borrowing and is **not** evidence that Play's dimensions
apply. Nobody has read the form. **No dimension is declared for this channel in
`tooling/channel-register.json` and none is enforced. Do not guess one: an
invented limit fires on correct input** — this repo has already rejected its own
fixture at 129 characters against a made-up "120 or fewer".

**The cost of not guessing is one rejected upload**, which is the same trade the
Apple trees make in writing. The cost of guessing is a number in the corpus that
nobody can source and everybody trusts.

## What closes this, and who can do it

The only way to pin real numbers is the **authenticated** upload form at
`apps.gov.in/Developer`. It is a JavaScript SPA; the unauthenticated URL returns
an empty shell, and the portal's public JS bundles have already been searched
(2026-09-08) — that search closed `O-APPS-GOV-IN-SBOM` and did **not** turn up
any asset spec. **Agents never log in.** This is owner work and it is the same
sitting as the upload itself — `O-APPS-GOV-IN-SUSPENSION-CLOCK`, due about
2026-10-31, which now carries that residue. When the form has been read, fill
the table above, the register's
`storeMetadataContract.perChannel["apps-gov-in"]`, and the runbook's empty
section from that one reading, each with the date.

## If these ever need re-capturing rather than copying

Run the Play capture and copy again — do not hand-place a PNG here.
`tooling/store/capture-play-screenshots.mjs` refuses to write demo output into a
listing directory at all, and it writes the `CAPTURE.json` that says which build
was photographed. Then update `CAPTURE.json` here so its SHA-256s still match
what sits beside it; stale hashes are how a copy quietly stops being one.
