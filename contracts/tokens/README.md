# `contracts/tokens/` — one brand palette, three runtimes

**The DTCG JSON in `dtcg/` is the source of truth for the NIKATRU company brand.**
Three generated files carry it to the three runtimes, and a guard holds all three
equal to this directory.

🔴 **THE NARROWER CLAIM, BECAUSE THE WIDE ONE WAS MEASURED FALSE.** This file said
*"nothing else in the tree may declare a brand value"* until 2026-09-05, when an
independent reviewer measured **28 places that did** — every one a hand-typed
`fontFamily:` string — and, worse, found that **nothing forbade a 29th**. An
unverifiable claim shipped in the contract's own README is the failure this
corpus punishes hardest, so it is replaced by two statements a guard reads. What
`tooling/ci/assert-palette-consistent.mjs` now enforces, on every run, over all
369 tracked `.dart` files:

- **Under `packages/`, only the generated `brand_tokens.dart` may name a brand
  font family.** The two exceptions found in the measurement —
  `build_app_theme.dart`'s app-wide text theme and `brand_lockup.dart`'s
  publisher footer — now read `BrandTokens.fontBody`. A 29th anywhere under
  `packages/` fails the build, in the file that gained it.
- **The remaining app-level copies are enumerated per file and may only shrink** —
  38 sites across 13 `apps/subscriptiontracker` files today, listed in `BRAND_FONT_DEBT` in
  that guard. Adding one fails. Removing one without lowering the number *also*
  fails, so the list cannot quietly stop describing the tree.

For **colours** the enforced statement is different and narrower still: every
`:root` block under `sites/` is compared with the generated `tokens.css` on every
property they share (21 today, across 18 pages), and the three generated outputs
are held equal to `dtcg/`. `packages/design_system/lib/src/tokens/app_colors.dart`
is deliberately outside that — it is a **different palette**, not a copy of this
one; see below.

```
contracts/tokens/dtcg/*.json                        ← hand-authored DTCG JSON
  color.json · color.dark.json · font.json · size.json      (the ONLY editable file)
        │
        │  packages/tokens — Style Dictionary v5, deterministic, no timestamps
        │  `cd packages/tokens && npm run build`
        ▼
  ┌─────────────────────────────────┬──────────────────────────────────┬────────────────────────────┐
  │ sites/_shared/assets/tokens.css │ packages/design_system/lib/src/  │ extensions/core/tokens.json│
  │                                 │   tokens/brand_tokens.dart       │                            │
  │ CSS custom properties, light +  │ `BrandTokens` / `BrandTokensDark`│ a plain JSON table         │
  │ a prefers-color-scheme override │ constants                        │                            │
  └─────────────────────────────────┴──────────────────────────────────┴────────────────────────────┘
       the two static sites               the Flutter apps                  the build-free extensions
```

All three outputs are **committed**, and all three are checked twice:

- `ci.yml`'s `site-tokens` lane **deletes all three, rebuilds, and
  `git diff --exit-code`s all three.** That is a re-derivation, and it works
  because the emitter writes no timestamps. Deleting first is what makes it
  meaningful — an artefact left in place is checked only for "the build did not
  change it", which a build that never wrote the file also satisfies.
- `tooling/ci/assert-palette-consistent.mjs` holds all three **equal to `dtcg/`**
  without needing `npm ci`, so a hand edit to a generated file is caught in the
  cheap guard lanes and on a developer machine that has never installed the
  emitter. Seven real-tree mutations are recorded in its header.

## What a token change now reaches, and what it does not

**This is the honest version, because the previous one was a claim nobody could
check.** `packages/tokens/README.md` used to say, of the Flutter apps,
*"Changing a token here cannot affect the Flutter apps."* That is no longer true,
and the exact extent of the change is:

| Token | Reaches |
|---|---|
| `font.display`, `font.body` | **the Flutter apps, live, in three places.** `app_text.dart`'s six named `TextStyle`s, `build_app_theme.dart`'s **app-wide** `textTheme` (every unnamed Material style in every stamped app), and `brand_lockup.dart`'s publisher footer all read `BrandTokens.fontDisplay` / `fontBody`. All three were string literals until 2026-09-05. `BrandTokens` is exported from `nikatru_design_system.dart`, so an app can read it too — nothing in `apps/` imports a `src/` path, so a token that is not on that barrel is a token no app can reach. |
| `positive`, `warn`, `danger` and their `-tint`s (light and dark) | **every Flutter app, live** — added 2026-09-28 (train ST-D0). Status is not a brand, so these six ARE an app's paint: `StatusTones.of(context)` picks the scheme half, `AppThemeX.fromScheme` carries the trio, and `DecisionStrip` / `AppListRow` paint them. `packages/design_system/test/status_contrast_test.dart` measures each tone on its opaque tint and on every seeded surface slot, both schemes; the brick's `test/design_foundation_test.dart` re-measures on each stamp's own seed. |
| every other colour, `size.radius` | the two static sites (through `tokens.css` and the palette guard, which compares the 18 inline `:root` blocks against it) and the extension subtree (through `tokens.json`). They reach Dart **as constants**, and nothing paints with them yet — see below. |

🔴 **A colour here is NOT an app's paint, and must not become one.** The app
factory is multi-brand: every stamped app derives its Material 3 scheme from its
own `seed_hex` through `ColorScheme.fromSeed`, so a single generated palette
could only be every app's paint if all 50 apps shared one brand. That is the
reason the Dart output was deleted on 2026-07-26, and the reason it is back on
narrower terms rather than as before.

🔴 **`packages/design_system/lib/src/tokens/app_colors.dart` is a DIFFERENT
palette and is deliberately not generated.** Research 01 §8.2 item 4 proposed
generating it and deleting its hand-written values; that is declined and the
reason is recorded in `packages/tokens/style-dictionary.config.mjs` so it is not
re-proposed. `AppColors` is Subly's palette — `bg` #F4F4F8 against #F6F8FC, `ink`
#141420 against #0B1220, a seed #6459F5 with no counterpart here — plus a status
trio, a hero ramp and two `LinearGradient`s that are Flutter composition rather
than tokens. Overwriting it from this source would repaint every screen of the
shipping app and would discard measured WCAG derivations against a **published**
WCAG 2.2 AA claim. "Two palettes that nothing compares" was a correct
observation; the remedy is not to make one overwrite the other, because they are
two brands, not two copies.

## What is still owed

- 🔴 **A brand-font change is NOT a one-line change yet, and the guard says so.**
  `apps/subscriptiontracker` types the two families 38 times across 13 files — 26 in screens,
  12 in test expectations. Edit `dtcg/font.json` alone and those 38 sites keep
  the old face: a **half** repaint, which looks deliberate rather than broken.
  The sweep in `assert-palette-consistent.mjs` fails on exactly those files with
  their counts, so the work is enumerated rather than discovered on a store
  screenshot. It is not done here because `apps/subscriptiontracker/**` belongs to the chassis
  work ([ADR 067] decision 2), which moves those screens into packages; the
  entries come out of `BRAND_FONT_DEBT` one file at a time as it lands.
- 🟡 **`sites/nikatru/fullshot/privacy.html` still hand-codes four of these
  values in its own `:root`** — and it declares `primary` under a fourth name,
  `--accent`, which is why `assert-palette-consistent` cannot pin it the way it
  pins `--ink`, `--muted` and `--line` on that page. Renaming it, or pointing the
  page at a generated block, is an edit to `sites/nikatru/**`.
- 🟡 **No extension imports `tokens.json` yet.** It is committed, drift-checked
  and readable with no tooling, which is the property `extensions/` needed; a
  tool adopting it also needs a `core.json` module row, which belongs to whoever
  owns the extension core.

## Editing

Edit `dtcg/*.json`. Then, from the repo root:

```
cd packages/tokens && npm ci && npm run build
```

and commit the three outputs with the source. Adding a token to the JSON without
adding it to the emit order in `style-dictionary.config.mjs` **fails the build**
(`assertEmitsEveryToken`) rather than silently dropping it.
