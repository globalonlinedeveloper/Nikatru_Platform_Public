# `contracts/store/` — the store vocabulary

**Status: WIRED (2026-09-20).** `vocabulary.js` is the one declaration of the
words the store pipeline spells. Two consumers read it today;
`tooling/ci/assert-store-vocabulary.mjs` holds it to
`tooling/channel-register.json`, to the listing trees on disk, and to those
consumers — in **both directions**.

[ADR 067] decision 1 names four things this directory holds: *"a top-level
`contracts/` directory holds tokens, legal text, the entitlement contract and
store vocabulary, read by Dart, the Workers and the extensions."* The first
three landed in September 2026. This is the fourth, and it is the whole reason
programme row **P1-2** stayed `in-flight`.

## What is here

| File | What it is |
|---|---|
| `vocabulary.js` | the authored source — a plain ES module, no build step |
| `vocabulary.json` | GENERATED from it by `generate.mjs`, for readers that cannot import JavaScript |
| `vocabulary.schema.json` | the JSON Schema that grades the generated file's shape |
| `vocabulary.d.ts` | hand-written types, so a TypeScript consumer imports the `.js` and loses nothing |
| `generate.mjs` | `--check` in CI; without it the JSON would be a second hand-maintained copy |

```
node contracts/store/generate.mjs          rewrite vocabulary.json
node contracts/store/generate.mjs --check  prove it agrees
node tooling/ci/assert-store-vocabulary.mjs
```

## Words, not rows — and why that line matters

🔴 **This directory carries WORDS. `tooling/channel-register.json` carries
ROWS.** That register holds one row per channel with its evidence, its account
status, its lane, its deferral and ~250 KB of dated reasoning, and ~60 files
already read it. Copying those rows here would be a second register and the
first to drift — the exact failure `contracts/` exists to prevent.

What the register never had is a declaration of the **closed sets its rows spell
out of**. Ask it "which words may a `surface` field hold?" and the honest answer
is "whichever words the twelve rows happen to use today". Ask two other readers
and you got two more answers, typed by hand:

| Where | What it declared | Measured |
|---|---|---|
| `tooling/channel-register.json` `storeMetadataContract.requiredFiles` | the application listing files | 8 names |
| `extensions/scripts/check-store-metadata.mjs` `REQUIRED_PER_STORE` + `REQUIRED_SHARED` | the extension listing files | 7 of the same names, re-typed |
| `tooling/app-yaml/render.mjs` `RENDERED_LISTING_FILES` | the files the renderer owns | 5 of the same names, re-typed |

Three independent spellings of one listing vocabulary in one repository,
differing over whether `README.md` is a listing file and over whether
`screenshots/README.md` is per-channel or shared. Each was right about its own
surface; none recorded that it was describing half of something, so nothing in
the tree could tell a deliberate difference from a divergence. That is the same
shape as the revocation-reason set written into SQL and into TypeScript minutes
apart and already out of step by one member — the failure that created this
directory.

The `LISTING_FIELDS` table is now the one declaration, with an `app` column, an
`extension` column and a `rendered` column, and all four arrays are that table
filtered. **Declaration order is load-bearing**: consumers use the arrays
verbatim, so reordering the table changes four files, which is the point of it
being one table.

## The axes, and the consumer that keeps each honest

| Axis | Held against |
|---|---|
| `channelIds` | `channels[].id`, and every `apps/*/store/<dir>` name |
| `surfaces` · `channelKinds` · `platforms` | the register's `surfaces` block and each row's own fields |
| `storefrontKeys` · `extensionStoreKeys` | each row's keys, and every `extensions/**/store/<dir>` name |
| `artifactFormats` | `artifactBuild.formats` **and** each row's `artifactFormats` |
| `deviceClasses` | `deviceTypeCoverage.sets`, and the screenshot directories on disk |
| `listingFields` | `requiredFiles`, `urlFiles`, every `perChannel[].additionalFiles`, and both re-pointed consumers |
| `listingCategories` | every `category.txt` in every listing tree |

## Both directions, and why the second one is the load-bearing half

- → a value a consumer spells that the contract does not carry — **FAIL**
- ← a value the contract carries that no consumer spells — **FAIL**

The second limb is what keeps this file from becoming a wish-list. A vocabulary
is a contract only while every word in it is load-bearing; a word nobody uses is
a word nobody will notice going wrong.

## What this contract deliberately does NOT claim

🔴 **It does not grade a category against a store's own category list.** No
store's list has been fetched from a primary source, and an invented limit fires
on *correct* input — this repository has paid for that twice (a made-up
120-character store limit; a guessed snapcraft base). What `listingCategories`
does is replace eight scattered one-line files, each its own only copy, with one
declaration that a guard compares them against. The day a real list arrives with
its citation it lands here beside the values it grades, the guard's first
category limb becomes a real store check, and **no consumer moves**.

🔴 **It does not carry the ids that are not channels.** The register holds two
other id lists that read exactly like channel ids and are not:
`purchaseRails.awaitingChannelRow` (researched, no row yet — `android-sideload`,
`macos-direct`) and `disqualified` (`flathub`, refused on a policy ground).
Section 3 of the guard refuses the merge rather than trusting nobody will make
it, because arming a channel by typo is the one failure in this area that ships
instead of failing the build.

## The consumers re-pointed so far

| Consumer | What it stopped typing |
|---|---|
| `tooling/app-yaml/render.mjs` | `RENDERED_LISTING_FILES` — now `renderedListingFiles()`, compared **by value** |
| `extensions/scripts/check-store-metadata.mjs` | `REQUIRED_PER_STORE` + `REQUIRED_SHARED` — now the contract's `extension` column |

The extension consumer imports across the `extensions/` boundary, which is
allowed and checked: `scripts/` is repository tooling and nothing under it is
packed into a submitted zip, `scripts/publish-arming.mjs` already imports
`../../tooling/ci/channel-arming.mjs` by the same route, and the contract is
plain JavaScript with no build step — the property
`tooling/ci/assert-extensions-build-free.mjs` exists to protect.

## What is still open

The survey that produced this contract found more consumers than one change
should re-point. They are listed with their citations rather than left to be
rediscovered:

- 🟡 `packages/purchases/lib/src/purchase_capabilities.dart:11-20` — `PurchaseChannel`
  restates nine channel ids as Dart enum values. Dart cannot import JavaScript,
  so this needs a **generated Dart** emitter, the way
  `contracts/entitlement/generate-dart.mjs` already works. It is the largest
  single consumer and the one whose drift would be hardest to see.
- 🟡 `tooling/store/name-probes.mjs:166-450` — the `PROBES` table restates the
  entire channel-id vocabulary as object keys. Its header already says it is
  "keyed by channel-register `id`", and nothing derives it.
- 🟡 `tooling/release/submit-appstore.mjs:78` (`CHANNELS`), `submit-play.mjs:91`,
  `submit-snap.mjs:95`, `submit-windows-store.mjs:75`,
  `tooling/store/capture-play-screenshots.mjs:172` — one hardcoded `CHANNEL_ID`
  each. Each already reads the register for everything else about its channel.
- 🟡 `tooling/ci/assert-store-bijection.mjs:83-132` — the publisher-account id ↔
  channel id map (`google-play` ↔ `android-play`, `mozilla-amo` ↔ `amo`, …).
  This is a THIRD naming layer and it is deliberate; the half it maps to lives in
  the private corpus, which no CI job can read, so the map cannot simply move
  here. What could move is the channel-id side of it.
- 🟡 `tooling/store/capture-play-screenshots.mjs:217-218` — `'phone'` / `'tablet'`
  typed as literals, under a comment that already says they must not be.
- 🟡 `.github/workflows/submit-*.yml`, `build-platforms.yml`, `extensions.yml` —
  every lane hardcodes its own channel id as a CLI argument. A YAML consumer is
  why `vocabulary.json` exists.
  ⏱ 2026-09-22: the ids are still typed — nothing generates YAML — but they are
  no longer unchecked. `assert-channel-register.mjs` limb 6b-iv pairs every
  `--dart-define=RELEASE_CHANNEL=` and every `--channel` site with the register
  row it names: the stamping job must be that row's `lane`, or its
  `submission.workflow`, or must invoke its `submission.script`. Anything else
  is a declared entry in `CHANNEL_STAMP_EXEMPT` with a written `why`, graded in
  both directions. The failure this closes is the one membership cannot see —
  a *valid* id in the wrong lane, e.g. `RELEASE_CHANNEL=ios-appstore` in the
  Android job, which produces an .aab that reports itself as an App Store build
  to the rail, the crash sink and analytics. The `--channel` form had no
  membership check at all before that limb.
- 🟡 `tooling/ci/assert-channel-register.mjs` — the `BUILD_TARGETS` oracle types
  the artifact formats. It is a deliberate independent oracle, so re-pointing it
  would *remove* a check; the decision is whether the format NAMES come from
  here while the mapping stays there.
  ⏱ 2026-09-22: decided — the names are held here, the mapping stays there. The
  table is still written out by hand (that is the independence worth keeping),
  and every format word in it is now checked against `ARTIFACT_FORMATS`
  immediately below it. A word this contract does not name is a word no channel
  row can accept, so it would read as a FORMAT GAP for the life of the typo,
  never as a mistake in the oracle. A build intermediate nobody ships — `.app`
  inside a macOS build — is declared in `INTERMEDIATE_FORMATS` with its reason,
  and that table is graded in both directions: a declared word the contract
  later adopts, and a declared word no `BUILD_TARGETS` entry emits, both fail.
- 🟡 **The guard is not its own named step in `.github/workflows/ci.yml`.** It
  runs in CI today only through the green control in
  `tooling/ci/test/store-vocabulary.test.mjs`, which executes it against the
  real tree inside the `node --test "tooling/ci/test/*.test.mjs"` step — real
  enforcement, but a failure there reads as a test failure rather than as this
  guard. It was left out of `ci.yml` on purpose in the change that landed it:
  an insertion shifts every `ci.yml:NNNN` citation below it, and the private
  corpus holds ~1,647 of them.
