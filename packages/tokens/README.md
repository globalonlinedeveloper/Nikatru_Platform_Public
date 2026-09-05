# @nikatru/tokens

**The EMITTER. The source moved out of this package on 2026-09-05.**

Hand-authored DTCG JSON now lives at **`contracts/tokens/dtcg/*.json`** — it is a
contract more than one runtime agrees about ([ADR 067] decision 1), and this
package is what compiles it. Read `contracts/tokens/README.md` first; it is the
source's own documentation and it states what a token change reaches.

[Style Dictionary](https://styledictionary.com) v5 compiles that source into
**three committed outputs**:

| Output | Purpose |
| --- | --- |
| `../../sites/_shared/assets/tokens.css` | CSS custom properties, with dark values in a `@media (prefers-color-scheme: dark)` override block. |
| `../design_system/lib/src/tokens/brand_tokens.dart` | `BrandTokens` / `BrandTokensDark` constants for the Flutter apps. |
| `../../extensions/core/tokens.json` | a plain JSON table the **build-free** extension subtree can read with no tooling. |

There is still **no `build/` directory**: every output is written straight to the
place that reads it, because emitting to a path nothing read is what previously
left three copies of the palette and made the generated one a decoy.

## The Dart output, removed 2026-07-26 and back 2026-09-05 on narrower terms

The 2026-07-26 removal was right and its reasoning still holds: a Dart token class
encodes ONE fixed palette, the app factory is multi-brand (the Mason brick takes a
per-app `seed_hex` and `design_system/build_app_theme.dart` derives Material 3 via
`ColorScheme.fromSeed`), so `build/nikatru_tokens.dart` could not be every app's
paint and had zero consumers.

⚠️ **This README used to end that paragraph with "Changing a token here cannot
affect the Flutter apps." That sentence is now FALSE and this is its correction.**
`brand_tokens.dart` is imported by
`packages/design_system/lib/src/tokens/app_text.dart`, which reads
`BrandTokens.fontDisplay` and `BrandTokens.fontBody` in all six named
`TextStyle`s — the two font families were typed there as string literals until
2026-09-05, and they are brand facts declared in `font.json`. So a change to
`font.display` reaches every app that uses `AppText`.

🔴 **What has NOT changed is the colour half.** The colours reach Dart as
constants and **nothing paints with them**, deliberately. Do not repaint a screen
from `BrandTokens`, and do not generate
`packages/design_system/lib/src/tokens/app_colors.dart` from this source — that is
Subly's palette, not this one, and the reasons are in
`style-dictionary.config.mjs`'s header and in `contracts/tokens/README.md`.

The build is deterministic — no timestamps — so re-running it on unchanged
sources produces byte-identical output. That is what makes the CI drift check
(`ci.yml`, `site-tokens` lane: delete **all three** artifacts, rebuild,
`git diff --exit-code` all three) meaningful, and it is why
`tooling/ci/assert-palette-consistent.mjs` can additionally hold all three equal
to `contracts/tokens/dtcg/` without installing anything.

## ⚠️ What this file does and does not govern today

`tokens.css` is **not currently fetched by any visitor.** Measured 2026-08-17:
zero `rel="stylesheet"` tags exist across the 18 static pages — every page inlines
its own `<style>` block with its own `:root`. `sites/nikatru/_headers` records that
`/assets/tokens.css` returns **404**; the only `<link>` to it is
`sites/_shared/_includes/base.njk`, whose Eleventy output lands in a gitignored
`_site/` that deploys nowhere.

So this package is presently the **reference palette**, not the served one. Editing
a token here changes zero rendered bytes. Keeping it correct still matters: it is
the value source a palette guard compares the 18 inline `:root` blocks against, and
it is what a future migration would adopt.

**There is a second, unrelated palette in the tree:** `tooling/sites/generate-discovery.mjs`
hardcodes its own `:root` and writes `sites/nikatru/apps/index.html` and
`apps/subly.html` under a byte-equality guard. Those two pages must be changed at
that generator, never in place, and they are not driven by this package.

## Build

```sh
npm ci
npm run build   # regenerates all three outputs listed above
```

## Editing tokens

1. Edit the DTCG sources in `../../contracts/tokens/dtcg/`: `color.json` (light
   palette), `color.dark.json` (dark overrides), `size.json` (radius),
   `font.json` (families).
2. **Add the token name to `LIGHT_COLORS` / `DARK_COLORS` in
   `style-dictionary.config.mjs`.** The emit order is an explicit list; a token
   present in the JSON but absent from the list would be silently dropped from the
   output, so the build now fails loudly in *both* directions — a listed token
   missing from JSON, and a JSON token missing from the list.
3. Run `npm run build`.
4. Commit the sources **and** all three regenerated outputs together, or the CI
   drift lane goes red.

⚠️ **Do not write curly-brace token paths inside a `$description`.** Style Dictionary
parses braces in *any* string field as a token reference, so prose like
`aliasing to {color.bg}` fails the build with an unresolved-reference error.

## Token reference

| Token | CSS variable | Light | Dark |
| --- | --- | --- | --- |
| ink | `--ink` | `#0B1220` | (shared) |
| ink-2 | `--ink-2` | `#111C33` | (shared) |
| primary | `--primary` | `#2E6FF2` | (shared) |
| teal | `--teal` | `#17C3A2` | (shared) |
| bg | `--bg` | `#F6F8FC` | `#0B1220` |
| card | `--card` | `#FFFFFF` | `#111C33` |
| card-2 | `--card-2` | `#F8FAFD` | `#0E1830` |
| text | `--text` | `#1E293B` | `#C7D2E3` |
| strong | `--strong` | `#0B1220` | `#F1F5F9` |
| muted | `--muted` | `#586275` | `#93A1BC` |
| line | `--line` | `#E2E8F0` | `#22304D` |
| soft | `--soft` | `#F6F8FC` | `#0E1830` |
| radius | `--radius` | `16px` | (shared) |
| font display | `--font-display` | `Space Grotesk` | (shared) |
| font body | `--font-body` | `Manrope` | (shared) |

### Notes on three of these

**`ink` emits `--ink`, not `--brand-ink`.** Until 2026-08-17 the generator renamed
it on the way out, justified in a comment as mirroring the live site "exactly".
That premise was false: of the 18 static pages, **17 declare `--ink`** and exactly
one declared `--brand-ink`. The rename had been modelled on that single outlier.
It is gone; the token name is the variable name.

**`soft` is a literal, deliberately not an alias.** It equals `bg` in light
(`#F6F8FC`) but not in dark (`#0E1830` vs `#0B1220`), and equals `card-2` in dark
exactly but not in light (`#F6F8FC` vs `#F8FAFD`). It is an alias of neither, so
aliasing it to either token would encode a coupling that is false on one side.

**`soft` and `card-2` are the same design role under two names**, and are
**disjoint across the corpus**: the 13 pages that declare `--soft` declare no
`--card-2`, and the 2 pages that declare `--card-2` declare no `--soft`. Their
light values differ by (2,2,1)/255 — invisible — and their dark values are
identical. Collapsing them into one token is the obvious follow-up, but it edits
rendered bytes on 13 pages, so it is its own decision and not a side effect of
adding this token.

### Known divergences from the live pages

These are recorded rather than silently tolerated:

- `--font-display: "Space Grotesk"` and `--font-body: "Manrope"` appear on **zero**
  live pages; every page uses the system stack
  (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`).
  ⚠️ Those two tokens are no longer inert, though: since 2026-09-05 they are the
  fonts the **Flutter apps** set, through `BrandTokens.fontDisplay` /
  `fontBody` in `app_text.dart`. Changing one changes the apps and no page.
- `--ico-bg` (`#EEF3FF` light) is a real variable on `sites/rajasekarselvam/index.html`
  and is in no token file — the same gap `--soft` had, at one page instead of thirteen.

## Consuming

- **Web:** link `sites/_shared/assets/tokens.css` and use `var(--primary)`,
  `var(--soft)`, etc. Dark mode is automatic via `prefers-color-scheme`.
  See the deployment caveat above — no site links it today.
- **Flutter / Dart:** import
  `packages/design_system/lib/src/tokens/brand_tokens.dart` and use
  `BrandTokens.fontDisplay` / `fontBody` / `radius`. **Per-app COLOUR still comes
  from the brick's `seed_hex` via `ColorScheme.fromSeed`** — `BrandTokens`'
  colours are the company brand, not an app's, and painting a screen with one
  would make every app look like the website. Spacing and the type scale live in
  `packages/design_system` as hand-written Dart constants and stay there.
- **Extensions:** read `extensions/core/tokens.json` directly. It is data, so no
  bundler, transpiler or install step is involved and the build-free guarantee
  (`tooling/ci/assert-extensions-build-free.mjs`) is untouched. No tool imports
  it yet; a tool that adopts it also needs a `core.json` module row.
