# nikatru.com

Static site for the **Nikatru** brand — studio app portfolio + legal pages (privacy, terms, refund, contact),
plus a Cloudflare Pages Function (`/api/subscribe`) that stores launch-list signups in Cloudflare KV.

Part of the **`Nikatru_Platform_Public`** monorepo — this site lives at **`sites/nikatru/`**.
*(This line named `Project_Cross_Platform_Apps` until 2026-08-21. That name was freed by the
2026-08-19 renames; `gh repo list` is the only thing that settles a repo name, because GitHub
follows rename redirects and the old name answers 200.)*

## Hosting
**Cloudflare Pages** project **`nikatru`** (formerly `project-nek`), connected to the monorepo with root
directory `sites/nikatru` and output dir `/`. Pushes redeploy automatically — no build step, plain static
HTML + one Pages Function. (GitHub Pages is intentionally not used.)

The `/api/subscribe` Function uses two production bindings set on the Pages project (not in any wrangler
config): D1 `PLATFORM_DB → platform_db`, where the signup list lives in table `signups` ([ADR 087],
2026-09-15), and KV `SIGNUPS → nikatru-signups`, which holds only the one-hour `rl:` rate-limit counter.

⏱ 2026-09-25 (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE, D3a): the gated deploy lane now also
publishes this directory, by Direct Upload, to a SECOND Pages project, **`nikatru-apex`**
(`nikatru-apex.pages.dev`), from the `site` job of `.github/workflows/deploy-web.yml`. There the
bindings come from `tooling/sites/nikatru-apex/wrangler.jsonc`, which the job writes into a staged
copy of this directory, and the salt from the Actions secret of the same name. No wrangler config may
sit in this directory: it is the root of the Git-connected project, which would read it as its own.
`nikatru.com` stays on the Git-connected project `nikatru` above until the owner moves the domain.
`tooling/ci/assert-site-bindings.mjs` reads this table against that file, the Function's `env.*`
reads and the job's `pages secret put`:

| kind | binding | target |
|---|---|---|
| D1 | `PLATFORM_DB` | `platform_db` |
| KV | `SIGNUPS` | `nikatru-signups` |
| secret | `SUBSCRIBE_RATE_LIMIT_SALT` | the HMAC key of the rate-limit counter, never in a file |

> rajasekarselvam.com is a **separate** site in the same monorepo at `sites/rajasekarselvam/`
> (Cloudflare Pages project `rajasekarselvam`).

## 🔴 ONE ADDRESS PER APP — `nikatru.com/<id>` — and what it replaced

**An app's public address is a PATH on the apex.** `https://nikatru.com/<id>` is the application
itself; `<id>.nikatru.com` is an internal origin and a permanent 301 to it. Locked by the owner on
2026-09-09, recorded as **ADR 075**.

| address | what it is | measured 2026-09-09 |
|---|---|---|
| **`nikatru.com/<id>/`** | the running web application, proxied from the app's own Pages project by `functions/_middleware.js` | `200`, serving the app |
| `nikatru.com/<id>` | the same, one hop | `301 → /<id>/` (the build is compiled with `--base-href /<id>/`) |
| **`nikatru.com/apps/<id>`** | the product/marketing page — UNCHANGED, still where the generator writes it and where the sitemap, the hub and every store-facing link point | `200` |
| `<id>.nikatru.com` | the app's own Cloudflare Pages origin; not an address given to humans | `301 → nikatru.com/<id>/…` |

**Why.** Paddle attaches approval to the DOMAIN — *"you will only be allowed to sell through the
domain(s) that have been approved"* — and of a subdomain, *"you will need to have that subdomain
approved separately"*
(paddle.com/help/start/account-verification/what-is-domain-verification). Its checkout overlay
enforces **at init, against the page origin**, so on a subdomain in-app checkout could not open at
all. Razorpay needs a support ticket per sub-domain against a ceiling of one main site plus five.
Neither conditions anything on a path. One apex approval, held once, covers app #51.

### 🔄 SUPERSEDED — the rule this section used to state, kept because the reversal is the useful part

Until 2026-09-09 this file said, under the heading *"TWO ADDRESSES, ONE PRODUCT"*, that
`nikatru.com/subscriptiontracker` and the app's old subdomain were **"both permanent and they are not the same
thing"**, that **"neither redirects to the other"**, and that the path served marketing while the
subdomain served the application. It also recorded, correctly for what was known then, that whether
Paddle's approval extended to the subdomain was **NOT ESTABLISHED**.

Two of those three are now false and the third is answered. The unknown was closed by reading the
vendor's own documentation (above): the approval does **not** extend, and it never would have. So
the "two permanent addresses" rule was resting on an open question, and once the question was
answered the second address stopped being defensible — a subdomain per app is a payment-provider
submission per app, forever, in exchange for isolation the portfolio had already traded away by
running one shared identity project.

What survives unchanged: **`/apps/<id>` is still the marketing page.** Nothing that pointed there
moves. What moved is `/<id>`, from a redirect into the application.

## The one contact record

Used identically on the site, in every store console and in FullShot's privacy policy. Never retyped
per store — a divergence here is a policy-mismatch finding a reviewer can see.

- **Support / privacy / grievance:** `support@nikatru.com` — 🔴 **every `mailto:` to it must be wrapped
  in `<!--email_off-->…<!--/email_off-->`.** Cloudflare's Email Address Obfuscation is a ZONE feature,
  on by default, and it rewrites both the `href` and the visible text to `[email protected]`, so
  without the wrapper the address rule 4(2) obliges us to **display** is absent from the served bytes
  until JavaScript runs. Measured live 2026-09-09: zero occurrences across nine pages. Held by
  `tooling/ci/check-site-integrity.mjs`.
  ⚠️ **AND THIS IS WHY IT SURVIVED EVERY PREVIEW TEST: `*.pages.dev` IS A DIFFERENT ZONE.** Measured
  2026-09-09, the same path on the same deployment, without the fix — `project-nek.pages.dev/contact`
  served `support@nikatru.com` in the clear **3 times** with **zero** `__cf_email__`, while
  `nikatru.com/contact` served it **0** times with **3**. The obfuscation is a setting on the
  `nikatru.com` zone, and a Pages preview URL never passes through it. **A green preview is not
  evidence about production for anything the zone transforms** — caching headers were the last one
  (see `_headers`, the 2026-08-04 `browser_cache_ttl` note). Prove this class of fix by fetching
  `https://nikatru.com/…` after the merge, never the preview.
- **Phone:** `+91 94984 98011`
- **Registered address:** `7, RR Tower 4, Thiru Vi Ka Industrial Estate, SIDCO Industrial Estate,
  Guindy, Chennai, Tamil Nadu, 600032, India` — see the superseded block below for why this spelling
  and not `7th Floor`.
- **Public location (short form, still used where a city is all that fits):** `Chennai, Tamil Nadu, India`

### 🔄 SUPERSEDED 2026-09-09 — the postal address IS published, by owner ruling

The paragraph below was the rule until 2026-09-09 and is kept verbatim, because every document that
quotes it should still find the sentence it quoted — and because the exposure it describes is
**accepted, not absent**.

> 🔴 **THE REGISTERED POSTAL ADDRESS DOES NOT GO ON THIS SITE.** Clause 6d of the Awfis membership
> agreement forbids it on the website or in marketing, and the NOC that grants use of the address
> **auto-revokes on breach** — with the GST and Udyam registrations resting on it. The 2026-08-04
> carve-out in `nikatru/business/company-master.md` is narrow: it covers channels that *require* the
> address (the Play public developer profile publishes it, unavoidably) and states that the public
> site copy stays "Chennai, Tamil Nadu, India".

**What replaced it.** Owner ruling 2026-09-09, verbatim: *"publish the address, it's a statutory
requirement, and update the respective requirement."* `contact.html`, `about.html`, `support.html`,
`shipping.html` and `terms.html` now carry the full registered address (PR #564, `5b0a017e`). The
hook is **rule 4(2) of the Consumer Protection (E-Commerce) Rules, 2020** — legal name, the principal
geographic address of the headquarters and all branches, website details and customer-care contact
details, **displayed** — reinforced commercially by the Razorpay merchant contract's website check.
⛔ Not the RBI circular clause 7.2; that was repealed 2025-09-15.

**The published spelling is `7, RR Tower 4, …` and it is NOT to be "corrected" to `7th Floor`.**
One structured field, value `7`, printed three ways: `Floor No 7` on the GST certificate, `7th Floor`
on the Udyam certificate, `7,` in the D&B record — and the D&B rendering is what the Play payments
profile and Microsoft Partner Center hold, because confirming a D-U-N-S overwrites the profile to the
registry's form. Editing the site to the Udyam prose form would create the divergence it looks like it
is fixing. Recorded at `nikatru/vendors/awfis.md` (*the field-rendering trap*) and
`nikatru/vendors/dnb.md` (retraction of 2026-08-04, with the side-by-side that settled it).

⬜ **Rides this, not part of it:** written consent from Awfis for the website use has NOT been asked
for. Tracked in `nikatru/business/company-master.md` §3.

## Performance targets — and the two "optimisations" that are FORBIDDEN

Agreed 2026-08-21 from the website research brief, step 16 ("Set performance targets and stop there").

| metric | target | measured how |
|---|---|---|
| **LCP** | ≤ **2500 ms** | 75th percentile |
| **INP** | ≤ **200 ms** | 75th percentile |
| **CLS** | ≤ **0.1** | 75th percentile |

Source: **web.dev/articles/vitals** (fetched 2026-08-20). Judged at the **75th percentile** and
**segmented mobile and desktop** — one blended figure lets desktop traffic hide a mobile regression,
which is the only regression that would matter here.

⚠️ **Nothing above is measured for these pages yet.** These are the agreed *targets*; no field or lab
number for nikatru.com has been recorded. Do not read the table as a pass.

### 🔴 The prohibitions — recorded because they are the half that gets "optimised" back

**1. DO NOT split the inline `<style>` blocks into a shared stylesheet.**
Every page here carries its styles in an inline `<style>`, so the site ships **zero render-blocking
external CSS and zero external JS** (measured 2026-08-04, recorded in `_headers`: `/assets/tokens.css`
and `/assets/base.css` both return 404). Extracting a stylesheet does not remove work — it *adds* a
render-blocking round trip that does not exist today. This looks like a best practice precisely
because on most sites the external file already exists; here it would be created in order to be
optimised.

**2. DO NOT add an HTML minifier.**
Cloudflare compresses `text/html` by default, and on the Free plan content "is compressed by default
using Zstandard" (developers.cloudflare.com/speed/optimization/content/compression/, fetched
2026-08-20). A minifier would spend build complexity re-winning bytes the edge already wins, and it
buys that with a build step this site does not otherwise have (Pages deploys these files as-is, no
build).

**Where the effort goes instead: image bytes.** The brief's corollary — PNG and JPEG are *absent*
from Cloudflare's default-compressed content-type list, so image weight is the one thing the edge is
not already handling.
