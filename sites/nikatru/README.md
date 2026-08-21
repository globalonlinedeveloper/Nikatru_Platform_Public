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

The `/api/subscribe` Function uses the KV binding `SIGNUPS → nikatru-signups`.

> rajasekarselvam.com is a **separate** site in the same monorepo at `sites/rajasekarselvam/`
> (Cloudflare Pages project `rajasekarselvam`).

## 🔴 TWO ADDRESSES, ONE PRODUCT — the rule, written down once

`nikatru.com/subly` and `subly.nikatru.com` are **both permanent and they are not the same thing.**
Neither redirects to the other. This was decided but never recorded, which is how it keeps being
re-litigated.

| address | what it is | measured 2026-08-21 |
|---|---|---|
| **`nikatru.com/subly`** | marketing, pricing, commerce, legal. The address given to stores, ads and humans. | `301 → /apps/subly`, serving the product page |
| **`subly.nikatru.com`** | the running web application — where the product actually executes | `200` |
| `nikatru.com/subly/web` | describes the web build and links OUT to the subdomain | not built yet |

**Why the apex holds the commerce half.** Paddle attaches domain approval to the domain:
*"You should submit each domain and subdomain you plan to launch a checkout from, but only one
approved domain is required to move forward with verification"*
(paddle.com/help/start/account-verification/what-is-domain-verification, fetched 2026-08-20).
Keeping checkout on the apex keeps it to one submission.

⚠️ **NOT ESTABLISHED: whether that approval extends to `subly.nikatru.com`. Assume it does not —
keep checkout off the subdomain** until it is verified, because the failure mode is a live checkout
on an unapproved domain.

## The one contact record

Used identically on the site, in every store console and in FullShot's privacy policy. Never retyped
per store — a divergence here is a policy-mismatch finding a reviewer can see.

- **Support / privacy / grievance:** `support@nikatru.com`
- **Phone:** `+91 94984 98011`
- **Public location:** `Chennai, Tamil Nadu, India`

🔴 **THE REGISTERED POSTAL ADDRESS DOES NOT GO ON THIS SITE.** Clause 6d of the Awfis membership
agreement forbids it on the website or in marketing, and the NOC that grants use of the address
**auto-revokes on breach** — with the GST and Udyam registrations resting on it. The 2026-08-04
carve-out in `nikatru/business/company-master.md` is narrow: it covers channels that *require* the
address (the Play public developer profile publishes it, unavoidably) and states that the public
site copy stays "Chennai, Tamil Nadu, India".

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
