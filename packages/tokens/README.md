# @nikatru/tokens

Single source of truth for NIKATRU brand design tokens. Hand-authored DTCG JSON
(`tokens/*.json`) is compiled by [Style Dictionary](https://styledictionary.com) v5
into two committed outputs:

| Output | Purpose |
| --- | --- |
| `build/tokens.css` | CSS custom properties. Names mirror the live `nikatru.com` `:root` exactly (incl. `--brand-ink`), with dark values in a `@media (prefers-color-scheme: dark)` override block — drop-in for a future site migration. |
| `build/nikatru_tokens.dart` | Pure-Dart constants (imports only `dart:ui`, no Flutter dependency): `NikatruTokens` (light palette) and `NikatruTokensDark` (dark palette; unchanged tokens re-exported). |

`build/` outputs are **committed**, so consumers never need Node. Rebuild only when
tokens change. The build is deterministic (no timestamps) — re-running it on
unchanged sources produces byte-identical files.

## Build

```sh
npm install
npm run build   # regenerates build/tokens.css and build/nikatru_tokens.dart
```

## Editing tokens

1. Edit the DTCG sources in `tokens/`: `color.json` (light palette),
   `color.dark.json` (dark overrides), `size.json` (radius), `font.json` (families).
2. Run `npm run build`.
3. Commit the sources **and** the regenerated `build/` outputs together.

CSS variable names and palette ordering are locked in
`style-dictionary.config.mjs`; the build fails loudly if a required token is
removed or renamed.

## Token reference

| Token | CSS variable | Light | Dark |
| --- | --- | --- | --- |
| ink | `--brand-ink` | `#0B1220` | (shared) |
| ink-2 | `--ink-2` | `#111C33` | (shared) |
| primary | `--primary` | `#2E6FF2` | (shared) |
| teal | `--teal` | `#17C3A2` | (shared) |
| bg | `--bg` | `#F6F8FC` | `#0B1220` |
| card | `--card` | `#FFFFFF` | `#111C33` |
| card-2 | `--card-2` | `#F8FAFD` | `#0E1830` |
| text | `--text` | `#334155` | `#C7D2E3` |
| strong | `--strong` | `#0B1220` | `#F1F5F9` |
| muted | `--muted` | `#586275` | `#93A1BC` |
| line | `--line` | `#E2E8F0` | `#22304D` |
| radius | `--radius` | `16px` | (shared) |
| font display | `--font-display` | `Space Grotesk` | (shared) |
| font body | `--font-body` | `Manrope` | (shared) |

## Consuming

- **Web:** import or link `build/tokens.css` and use `var(--primary)`,
  `var(--card-2)`, etc. Dark mode is automatic via `prefers-color-scheme`.
- **Flutter / Dart:** reference or vendor `build/nikatru_tokens.dart` — it only
  imports `dart:ui`, so it works in plain Dart tooling and Flutter alike, e.g.
  `Container(color: NikatruTokens.card, ...)`.
