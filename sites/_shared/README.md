# @nikatru/site-shared

Shared **Eleventy v3** layer for the NIKATRU static sites. This package is
additive (monorepo Step 1): the live sites (`sites/nikatru`,
`sites/rajasekarselvam`) are still plain static HTML and are untouched — they
will migrate onto this layer later (see plan §29.5).

## What lives here

| Path | Purpose |
| --- | --- |
| `_includes/base.njk` | HTML5 base layout: head/meta, tokens + base CSS, SEO partial, header/nav/main/footer. Zero JS, WCAG-minded. |
| `_includes/partials/app-card.njk` | Renders one app object as an accessible card. |
| `_includes/partials/seo.njk` | Canonical + OG/Twitter meta and JSON-LD (`Organization`, or `SoftwareApplication` when a page sets `app` in front matter). |
| `_data/apps.json` | **Single source of truth** for the NIKATRU app registry (SHOW-1). Append new apps here; both sites will read this list. |
| `_data/site.json` | Site-wide defaults (name, tagline, canonical URL, nav). |
| `assets/tokens.css` | Design tokens mirroring the live nikatru.com `:root` (light + dark). **GENERATED — do not hand-edit.** It is written directly by `packages/tokens` (`npm run build` there); CI fails if it drifts from a fresh build. Edit `packages/tokens/tokens/*.json` instead. *(Was a hand-maintained snapshot until 2026-07-26, which meant editing the token JSON changed nothing.)* |
| `assets/base.css` | Small shared reset + component styles built on the tokens. |
| `demo/index.njk` | Smoke-test page: loops `apps` through the layout + card partial so `npm run build` exercises the whole layer. |

## App registry shape

```json
{
  "slug": "subly",
  "name": "Subly",
  "tagline": "Track every subscription in one place",
  "url": "https://subly.nikatru.com",
  "api": "https://api.nikatru.com",
  "platforms": ["web"],
  "status": "live"
}
```

Add more apps by appending objects to the array in `_data/apps.json`.

## Develop

```sh
npm install
npm run build   # eleventy -> _site/
npm run dev     # eleventy --serve
```

The build output (`_site/`) is a demo only and is git-ignored; nothing here
deploys anywhere yet.
