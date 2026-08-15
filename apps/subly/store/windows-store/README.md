# Store listing metadata — Subly · Microsoft Store (`windows-store`)

`[pipeline D-5]` — *"store listing metadata is generated from the spec and lives
in the repo … so a listing can be regenerated, audited, localized and diffed,
and is never hand-typed into a store console as the only copy."*

**This directory is the source of truth for the listing.** Partner Center is a
copy of it, not the other way round. If a field is edited in the console and not
here, the next regeneration silently reverts it — which is the intended
direction, and the reason `tooling/ci/assert-store-metadata.mjs` fails a missing
or emptied file.

## 🔴 Why the repo-native tree is the source of truth and not a fastlane tree

`fastlane` covers **3 of 6** platforms — `deliver` is `ios, mac`, `supply` is
`android`, and there is **no fastlane path for Microsoft Store, Snap/AppImage or
Web** (D-5, verified against fastlane's own action pages 2026-07-29). Microsoft
is the **first** channel this factory can actually register ($0, no D-U-N-S), so
the one store fastlane cannot reach is the one we reach first. A fastlane layout
as the source of truth could therefore only ever describe half the portfolio, and
the half it could not describe would get hand-typed into a console as the only
copy — the exact outcome D-5 exists to prevent.

So: **this tree is authoritative, and Apple/Play fastlane trees are generated
FROM it** when those channels are built.

## Where every field comes from — the derivation map

Each file below is one listing field. "Checked" means
`tooling/ci/assert-store-metadata.mjs` compares it to the spec source on every CI
run, so drift is a build failure rather than a discovery at submission time.

| File | Listing field | Derived from | Checked |
|---|---|---|---|
| `title.txt` | Product name | `sites/_shared/_data/apps.json` → `name` | ✅ exact match |
| `short-description.txt` | Short description | `sites/_shared/_data/apps.json` → `tagline` | ✅ exact match |
| `long-description.txt` | Description | the app's differentiation line (`app_brick` var `description`), expanded | non-empty |
| `category.txt` | Category | `app_brick` var `category` | non-empty |
| `search-terms.txt` | Search terms | listing copy; **≤ 7** terms | ✅ count ≤ 7 |
| `privacy-policy-url.txt` | Privacy policy URL | `apps/subly/lib/core/app_config.dart` → `privacyUrl` | ✅ exact match |
| `support-url.txt` | Support contact info | `apps/subly/lib/core/app_config.dart` → `contactUrl` | ✅ exact match |
| `screenshots/` | Screenshots | not derivable — see that directory's README | slot must exist |

**The brick vars are the generation mechanism, the app is the instance.** The
`app_brick` (`tooling/bricks/app/brick.yaml`) already declares `category` and
`description` — *"One-line differentiation for store listings"* — and until this
tree existed it wrote them **nowhere a store tool could read**, which was D-5's
entire evidence. Subly predates the brick, so its two derived-by-hand fields
(`long-description.txt`, `category.txt`) are checked for presence rather than for
equality with a var that Subly never had.

⬜ **Still open (D-5's own build, not this increment's):** the `app_brick` probe
asserting that a *fresh stamp* emits this tree from `category` and `description`.
Until that lands, a newly stamped app gets **no** tree and the guard PRINTS the
gap on every run.

## Field limits — every number sourced, everything else marked UNVERIFIED

| Field | Limit | Source |
|---|---|---|
| Search terms | **≤ 7 unique terms or phrases** | Microsoft Store Policies **v7.19 §10.1.3**, verbatim: *"Not exceed seven unique terms or phrases."* Also required: relevant, no pricing terms, no other products' titles unless also published by you |
| Product title | ⚠️ **no numeric limit published.** Policy **10.1.1** constrains CONTENT instead: *"Your product title or name must be unique and must not contain marketing or descriptive text, including extraneous use of keywords."* | *ibid.* |
| Short description length | ⚠️ **UNVERIFIED** | no primary source read |
| Description length | ⚠️ **UNVERIFIED** | no primary source read |
| Category vocabulary (the exact list Partner Center accepts) | ⚠️ **UNVERIFIED** | `Productivity` is used because it is the obvious fit; the authoritative list was not fetched |
| Screenshot / image dimensions | ⚠️ **UNVERIFIED** | see `screenshots/README.md` |

🔴 **The rule that makes this table look sparse on purpose: an invented limit
fires on correct input.** A made-up *"120 characters or fewer"* once rejected
this repo's own fixture at 129. Any number added here later arrives **with a URL
and a date**, or arrives marked `UNVERIFIED`. `assert-store-metadata.mjs`
enforces exactly one length-ish rule — the ≤ 7 search terms — because that is the
only one with a citation.

## Policy dependencies this channel owns

- **10.5.1 — the privacy policy URL is REQUIRED in Partner Center** for any
  product that accesses personal information, and Desktop Bridge / Win32 products
  *"must always have privacy policies"*. `privacy-policy-url.txt` is that URL and
  it must resolve; the page is `sites/nikatru/privacy.html`.
- **Age rating** is a Partner Center questionnaire, not a repo file. See
  `Private/runbooks/store-submission-windows.md`.

## Regenerating / validating

```
node tooling/ci/assert-store-metadata.mjs          # the D-5 guard
node tooling/release/submit-windows-store.mjs --dry-run --app subly
```

The dry run validates this tree, the packaged `.msix` and the configured package
identity, and exits 0 **without contacting Microsoft**.
