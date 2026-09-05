# @nikatru/site-shared

Shared **Eleventy v3** layer for the Nikatru static sites, plus the app registry
that the rest of the repository genuinely reads.

🔴 **THE LIVE SITES DO NOT USE THE ELEVENTY HALF, AND NO MIGRATION IS SCHEDULED.**
`sites/nikatru` and `sites/rajasekarselvam` are plain static HTML and are
untouched by this layer. The **wholesale migration onto it was CUT on
2026-07-27** — `Private/requirements/not-built.json`, stage `12-growth-discovery`,
origin `[12] cut 6`: *"A full SSG rewrite of a working hand-built site is churn,
not a requirement."* It reverses only on a named condition — *"the hand-built
site becomes the constraint on a requirement that cannot otherwise be met"* —
and Phase 2 of `Private/runbooks/website-migration.md` has been **PARKED (owner
to decide)** since 2026-07-20.

*(Until 2026-08-17 this file said the sites "will migrate onto this layer later
(see plan §29.5)". Both halves were wrong: the citation pointed into
`requirements/architecture.md` §29, deleted in Private commit `e88fdcf` and
recorded as deliberate in `lost-deliberately.json`; and the promise itself was
contradicted by the 2026-07-27 cut above. It is corrected rather than deleted
because this file is cited by `sites/nikatru/_headers:53` as the answer to why
`/assets/tokens.css` is a 404, so a reader arrives here already asking.)*

⚠️ One contradiction is **open and is not this file's to settle**:
`nikatru/decisions/decisions-log.md:82` still locks *"Web: Eleventy + shared
`sites/_shared/`"* as the architecture. That is a business-brain lock against a
product-side cut; reconciling the two needs one ADR in `Private/decisions/`, not
an edit here.

## What lives here

| Path | Purpose |
| --- | --- |
| `_data/apps.json` | 🔴 **The one genuinely consumed file in this directory.** Single source of truth for the Nikatru app registry (SHOW-1), read by ~40 call sites — `tooling/sites/generate-discovery.mjs`, the four store-submission scripts, the signing scripts, `services/platform/src/config.ts` and the brick's `post_gen.dart`. Append new apps here. |
| `_includes/base.njk` | HTML5 base layout: head/meta, tokens + base CSS, SEO partial, header/nav/main/footer. Zero JS, WCAG-minded. **Its `<link rel="stylesheet">` tags resolve only inside the Eleventy demo build** — see the 404 note below. |
| `_includes/partials/app-card.njk` | Renders one app object as an accessible card. |
| `_includes/partials/seo.njk` | Canonical + OG/Twitter meta and JSON-LD (`Organization`, or `SoftwareApplication` when a page sets `app` in front matter). |
| `_data/site.json` | Site-wide defaults (name, tagline, canonical URL, nav). |
| `assets/tokens.css` | The shared design-token palette (light + dark). **GENERATED — do not hand-edit.** Written directly by `packages/tokens` (`npm run build` there); CI fails if it drifts from a fresh build. Edit `contracts/tokens/dtcg/*.json` instead. ⚠️ **Nothing relates this file to the 18 inline `:root` blocks the live pages actually serve** — that gap is the subject of the section below. *(Was a hand-maintained snapshot until 2026-07-26, which meant editing the token JSON changed nothing.)* |
| `assets/base.css` | Small shared reset + component styles built on the tokens. |
| `demo/index.njk` | Smoke-test page: loops `apps` through the layout + card partial so `npm run build` exercises the whole layer. |

`_includes/*`, `demo/`, `eleventy.config.js`, `assets/base.css`, `_data/site.json`
and the two package files exist to make `npm run build` exit 0 in the
`site_shared` CI lane. That is a real but small purpose; do not mistake it for
the directory being dead — `_data/apps.json` and `assets/tokens.css` are not.

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

**Who reads it today, precisely.** `sites/nikatru` reads it *through the
generator*: `tooling/sites/generate-discovery.mjs` writes `apps/index.html` and
`apps/subly.html` from these rows, and those files are committed and
byte-diffed by `tooling/ci/assert-discovery-surface.mjs`. Two surfaces
deliberately do **not**: `sites/nikatru/index.html`'s hand-written
`const APPS = [` array at `:470` (whether a live app is named on the public
homepage is an owner announcement decision, which `check-site-integrity.mjs`
refuses to take and prints instead), and `sites/rajasekarselvam`, which ships no
`apps/` directory at all. *(This file used to say "both sites will read this
list". They do not, and one of them is structurally prevented from doing so —
an `apps/` directory there would make the root app-facing and immediately owe
four legal pages it does not have.)*

## 🔴 Why the 18 live pages each inline their own CSS — measured, and settled

PT-5 asked the narrower question the migration cut leaves open: never mind
Eleventy, can the 18 static pages at least **share a stylesheet**? Measured
2026-08-17, on this branch. **The answer is no, on three independent grounds.**

**1. The shared sheet is not reachable.** Both sites are Cloudflare Pages
projects wired to Git with the **build command blank**
(`Private/runbooks/deploy.md:22-37`), root directories `sites/nikatru` and
`sites/rajasekarselvam`. `sites/_shared/` is a deploy root of neither, and its
`_site/` output is gitignored and uploaded by nothing. So `/assets/tokens.css`
and `/assets/base.css` **404 in production today** — already recorded at
`sites/nikatru/_headers:49-53` and `tooling/ci/assert-web-cache-policy.mjs:88-90`.
Confirmed independently: `grep -c 'rel="stylesheet"'` across all 18 pages
returns zero. The two routes out are a dashboard build command (owner-only, and
it puts the served bytes where **no repo guard scans them** — the
`sites/_shared/_site/**` mistake that made an `apps.json` write look consumed
for a month) or a committed copy per deploy root, which is still duplication
plus a new drift guard.

**2. It makes the first visit slower and larger.** Re-derived on this branch
(gzip level 9, shared core = the 23 CSS lines present in ≥9 of the 18 files,
1,726 B raw / 828 B gz). `sites/nikatru/privacy.html` today: **5,916 B gzipped
in one request**. Split: 5,160 B gz of page + 828 B gz of sheet = **5,988 B gz
in two requests** — more bytes *and* an extra render-blocking round trip. Every
page in this set is a single-page-visit page; a store reviewer opens one privacy
URL, a buyer lands on `checkout-return` once. Across all 18 pages the aggregate
goes 75,067 → 67,843 B gz — a 7,224 B saving that **no single visitor ever
pays**, because no visitor fetches 18 pages.

**3. The return visit does not rescue it.** Both `_headers` files declare
`/*.css → public, max-age=0, must-revalidate`, and
`assert-web-cache-policy.mjs`'s class probes *force* that for any stable CSS
name. So a shared sheet costs a conditional request — a full RTT — on **every
page view, forever**, to save ~750 B of gzipped HTML. The escape hatch
(content-hashed filename declared `immutable`) makes every page's `<link href>`
a function of the palette, i.e. all 18 pages become generated.

Cross-site sharing is impossible regardless: two Pages projects, two origins,
and both `_headers` set `style-src 'self' 'unsafe-inline'` — a cross-origin
sheet needs a security-header edit, to save 93 B gz across
rajasekarselvam's three pages.

### What PT-5 actually found, and what to build instead

The defect is not duplication. It is **drift across 19 copies of a
12-declaration `:root`** — 18 pages plus the `STYLE` constant in
`tooling/sites/generate-discovery.mjs:233-281`. Per this repo's own doctrine
(*"prefer a build-failing guard over a note"*), **guard the duplication; do not
remove it.**

Shape of `tooling/ci/assert-site-palette.mjs`:

1. **Parse** each page's `:root` and its `@media (prefers-color-scheme: dark)`
   `:root` — parse declarations, never grep prose.
2. Assert every deploy-root page declaring a given custom property declares the
   **same value**, and that the brand-ink property is named **`--ink`**.
3. Derive expected values from **one** source, `contracts/tokens/dtcg/color.json`.
4. **Coverage floor**: fail COVERAGE LOST below 18 parsed `:root` blocks across
   fewer than 2 deploy roots. A walk that stops matching prints clean — this
   repo's single most repeated failure.
5. **Negative-test it against the real tree**, not a fixture: mutate one hex in
   one real page and confirm it exits 1 naming that file.

⚠️ Two pages are **generated**. `sites/nikatru/apps/index.html` and
`apps/subly.html` come from `generate-discovery.mjs`; a sed-style palette sweep
over `sites/**` rewrites them in place and turns the discovery lane red on a
byte-equality diff. Change the generator's `STYLE` constant and regenerate.

**The guard would ship GREEN, and that is the reason it needs the negative
test.** A brace-counting prototype was run over the tree after the four palette
decisions landed: 18 of 18 pages carry a parsed `:root`; every custom property
declared on more than one page carries the **same value on every page**, in both
light and dark; and every property that both the pages and
`sites/_shared/assets/tokens.css` declare now **agrees**. Mutating one real page
(`pricing.html`, `--text` → `#334155`) made it report
`--text DISAGREES: #1E293B x14 | #334155 x1`. An assertion that cannot fail is
worse than none, so it must be proven against a mutated real page — and it must
`process.exit(1)`, not merely print, or it reproduces this repo's most expensive
failure exactly.

Two loose ends the prototype surfaced, neither of them blocking:

- **`--ico-bg` is the next `--soft`.** `sites/rajasekarselvam/index.html`
  declares it (`#EEF3FF` light / `rgba(46,111,242,.14)` dark) and no token file
  carries it — the same gap `--soft` had, at one page instead of thirteen.
- **The discovery family declares `--ink` but never uses it.**
  `apps/index.html`, `apps/subly.html` and `apps/_template.html` are the only 3
  of 18 pages with zero `var(--ink)`; their footer and header use the literal
  `#0B1220` instead. Harmless today because the values agree, but it means a
  future change to `--ink` would not reach them. Fixing it changes rendered
  bytes on three pages, so it is a separate decision, not a side effect of this
  one.

### Decision 4 — the three dated legal snapshots are permanently excluded

`sites/nikatru/legal/2026-07-26/en/privacy.html`,
`legal/2026-08-01/en/privacy.html` and `legal/2026-08-10/en/privacy.html` must
**never** be pointed at a shared stylesheet, hashed or otherwise, and no palette
sweep may treat them as ordinary pages.

They are not pages; they are **evidence**. `tooling/ci/assert-policy-archive.mjs`
exists so that a consent record citing "policy version 2026-08-01" can be
resolved to the bytes that version served. A snapshot whose appearance depends
on a file outside itself stops being a reproducible record of what the user was
shown, and starts silently re-rendering — or, once that file moves, failing to
render at all. All three are self-contained today: zero `rel="stylesheet"`, one
inline `<style>`, zero `<img>`, zero `<script>`. Keep them that way.

Their palettes were checked on 2026-08-17 and already carry the decided values
(`--ink`, `--text:#1E293B`, `--soft` light/dark), so this exclusion costs
nothing today.

🔴 **It is enforced by nothing, in either direction, and that is stated rather
than hidden.** `assert-policy-archive.mjs:201-206` compares `visibleText()`, and
`stripInert()` (`tooling/ci/text-reductions.mjs:378-382`) deletes `<style>`
blocks outright — so a palette edit inside a snapshot is invisible to it, and so
is skipping one. Only the current version (2026-08-10) is compared against the
live page at all; the two older snapshots are compared against nothing. If
`assert-site-palette.mjs` is built, excluding these three paths **by name** and
asserting they carry no external stylesheet reference is the cheap place to
close this.

## Develop

```sh
npm install
npm run build   # eleventy -> _site/
npm run dev     # eleventy --serve
```

The build output (`_site/`) is a demo only and is git-ignored; nothing here
deploys anywhere. The `site_shared` CI lane runs `npm run build` and discards
the result — it proves the layer still compiles, nothing more.
