# edge-shield

The Cloudflare edge in front of **Box C** (self-hosted GoTrue, `auth-api.nikatru.com/auth/v1/*`)
and **Box B** (GlitchTip, `glitchtip.nikatru.com/api/*`). LEAD RULING SHIELD-R1, row
O-BOXES-UNSHIELDED-FROM-SPIKES.

- Passes every request to the tunnel origin unchanged (`fetch(request)`), adding one response
  header, `x-nikatru-shield: 1`.
- Counts four classes (`src/classify.ts`) per client (IPv4 address, IPv6 /64) and globally per
  Cloudflare location, with Workers Rate Limiting bindings (`wrangler.jsonc`). Over a limit:
  429 with `Retry-After` — except the refresh grant, refused **503**, because the auth SDK signs
  the user out on a refresh 4xx.
- Serves the GoTrue JWKS from the edge cache for 300 s.
- **Fails open**: any limiter fault admits the request (logged as `shield_fail_open`), and
  `passThroughOnException()` hands the request to the origin if the Worker throws.

Bound by two **zone routes**, never a custom domain. Deployed by
`.github/workflows/deploy-workers.yml` (`edge-shield` job); proven in path daily by
`tooling/ops/check-edge-shield.mjs` from ops-watch.

**Emergency bypass:** delete the two Worker routes on the nikatru.com zone. The origin answers
directly again, exactly as before the shield existed; nothing on either box changes.

```
npm ci && npx tsc --noEmit && npm test && npx wrangler deploy --dry-run
```
