# nikatru.com

Static site for the **Nikatru** brand — studio app portfolio + legal pages (privacy, terms, refund, contact),
plus a Cloudflare Pages Function (`/api/subscribe`) that stores launch-list signups in Cloudflare KV.

Part of the **`Project_Cross_Platform_Apps`** monorepo — this site lives at **`sites/nikatru/`**.

## Hosting
**Cloudflare Pages** project **`nikatru`** (formerly `project-nek`), connected to the monorepo with root
directory `sites/nikatru` and output dir `/`. Pushes redeploy automatically — no build step, plain static
HTML + one Pages Function. (GitHub Pages is intentionally not used.)

The `/api/subscribe` Function uses the KV binding `SIGNUPS → nikatru-signups`.

> rajasekarselvam.com is a **separate** site in the same monorepo at `sites/rajasekarselvam/`
> (Cloudflare Pages project `rajasekarselvam`).
