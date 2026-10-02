# edge-shield

The Cloudflare edge in front of **Box C** (self-hosted GoTrue, `auth-api.nikatru.com/auth/v1/*`)
and **Box B** (GlitchTip, `glitchtip.nikatru.com/api/*`). LEAD RULINGS SHIELD-R1, R2 and R3, row
O-BOXES-UNSHIELDED-FROM-SPIKES.

- Passes every request to the tunnel origin unchanged (`fetch(request)`), adding one response
  header, `x-nikatru-shield: <RELEASE>` (the deployed commit SHA, or `1` without one), on a
  refusal too.
- Counts four classes (`src/classify.ts`) against ONE global cap each, per Cloudflare location,
  with Workers Rate Limiting bindings (`wrangler.jsonc`). Over a cap: 429 with `Retry-After` —
  except the refresh grant, refused **503**, because the auth SDK signs the user out on a
  refresh 4xx (SHIELD-R2).
- **Reads no client address and no `Origin`** (SHIELD-R3, the ADR no.011 / ADR no.020 posture).
  The per-IP limit on the credential paths is the nikatru.com zone's own rate-limiting rule,
  declared in `tooling/edge-ratelimit-rule.json` and applied by the same deploy job.
- Serves the GoTrue JWKS from the edge cache for 300 s.
- **Fails open**: any limiter fault admits the request (logged as `shield_fail_open`), and
  `passThroughOnException()` hands the request to the origin if the Worker throws.

Bound by two **zone routes**, never a custom domain. Deployed by
`.github/workflows/deploy-workers.yml` (`edge-shield` job); proven in path weekly (and on every deploy) by
`tooling/ops/check-edge-shield.mjs`, and the zone rule compared with its file by
`tooling/ops/edge-ratelimit-rule.mjs`, both from ops-watch.

**Emergency bypass:** delete the two Worker routes on the nikatru.com zone. The origin answers
directly again, exactly as before the shield existed; nothing on either box changes.

```
npm ci && npx tsc --noEmit && npm test && npx wrangler deploy --dry-run
```
