# @nikatru/tokens

Single source of truth for NIKATRU brand design tokens. Hand-authored DTCG JSON
(`tokens/*.json`) is compiled by [Style Dictionary](https://styledictionary.com) v5
into **exactly one committed output**:

| Output | Purpose |
| --- | --- |
| `../../sites/_shared/assets/tokens.css` | CSS custom properties, with dark values in a `@media (prefers-color-scheme: dark)` override block. |

There is **no `build/` directory and no Dart output.** `build/nikatru_tokens.dart`
was removed on 2026-07-26: a Dart token class encodes ONE fixed palette, but the
app factory is multi-brand (the Mason brick takes a per-app `seed_hex` and
`design_system/build_app_theme.dart` derives Material 3 via `ColorScheme.fromSeed`),
so it had zero consumers. No pubspec depends on this package and no `.dart` file
carries these hexes. **Changing a token here cannot affect the Flutter apps.**

The generator writes **straight into `sites/_shared/assets/`** rather than a local
`build/`, because emitting to a path nothing read is what previously left three
copies of the palette and made the generated one a decoy.

The build is deterministic — no timestamps — so re-running it on unchanged
sources produces byte-identical output. That is what makes the CI drift check
(`ci.yml`, `tokens` lane: delete the artifact, rebuild, `git diff --exit-code`)
meaningful.

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
npm install
npm run build   # regenerates ../../sites/_shared/assets/tokens.css
```

## Editing tokens

1. Edit the DTCG sources in `tokens/`: `color.json` (light palette),
   `color.dark.json` (dark overrides), `size.json` (radius), `font.json` (families).
2. **Add the token name to `LIGHT_COLORS` / `DARK_COLORS` in
   `style-dictionary.config.mjs`.** The emit order is an explicit list; a token
   present in the JSON but absent from the list would be silently dropped from the
   output, so the build now fails loudly in *both* directions — a listed token
   missing from JSON, and a JSON token missing from the list.
3. Run `npm run build`.
4. Commit the sources **and** the regenerated `tokens.css` together, or the CI
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
- `--ico-bg` (`#EEF3FF` light) is a real variable on `sites/rajasekarselvam/index.html`
  and is in no token file — the same gap `--soft` had, at one page instead of thirteen.

## Consuming

- **Web:** link `sites/_shared/assets/tokens.css` and use `var(--primary)`,
  `var(--soft)`, etc. Dark mode is automatic via `prefers-color-scheme`.
  See the deployment caveat above — no site links it today.
- **Flutter / Dart:** nothing to consume. Per-app colour comes from the brick's
  `seed_hex` via `ColorScheme.fromSeed`; non-colour cross-app values (spacing,
  type scale, radii) live in `packages/design_system` as Dart constants.
