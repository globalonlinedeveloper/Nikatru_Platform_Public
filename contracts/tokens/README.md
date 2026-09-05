# `contracts/tokens/` — one brand palette, three runtimes

**The DTCG JSON in `dtcg/` is the source of truth for the NIKATRU company brand.**
Nothing else in the tree may declare a brand value; three generated files carry
it to the three runtimes, and a guard holds all three equal to this directory.

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
| `font.display`, `font.body` | **the Flutter apps, live.** `packages/design_system/lib/src/tokens/app_text.dart` reads `BrandTokens.fontDisplay` / `fontBody` in all six named `TextStyle`s, where `'Space Grotesk'` and `'Manrope'` were typed as literals until 2026-09-05. |
| every colour, `size.radius` | the two static sites (through `tokens.css` and the palette guard, which compares the 18 inline `:root` blocks against it) and the extension subtree (through `tokens.json`). They reach Dart **as constants**, and nothing paints with them yet — see below. |

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
