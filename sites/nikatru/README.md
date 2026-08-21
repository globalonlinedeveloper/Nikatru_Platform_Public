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
