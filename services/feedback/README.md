# feedback — Cloudflare Worker

The private **"Report a problem"** intake for every app, site and extension
(lane feedback-intake, O-FEEDBACK-INTAKE-UNBUILT). Stamped from the brick's
Worker (`tooling/kit/stamp-service.mjs`) and cut down to an intake.

- `GET /v1/health` — public deploy marker (no auth).
- `POST /v1/feedback` — one report: JSON, or multipart with a `report` part and
  at most one PNG/WebP `screenshot` (≤ 2 MB, metadata chunks stripped before
  storage). Authed with the app's session token (JWKS, like every Worker), or
  anonymous with a stricter hourly limit. Free text is PII-masked before
  storage; a payload carrying a `url` key anywhere is refused.

Nothing else is mounted. **No route reads a report or a screenshot**: the read
path is the `FeedbackInternal` entrypoint (`src/internal.ts`), reachable only
over a Service Binding, and the lead's laptop reads through the Cloudflare
credential it already uses for D1.

## Where the data is

- `platform_db.feedback_reports` (APAC), migrated by
  `services/platform/migrations/0025_feedback.sql`. 90 days, then the nightly
  cron deletes the row and its screenshot and keeps an anonymised count
  (`feedback_counts`). Account deletion removes a person's reports through the
  platform's schema-derived erasure walk (the column is `user_id`); the next
  night's orphan sweep removes their screenshots.
- `nikatru-feedback` (R2, private): the screenshots, keyed `shots/<id>.<png|webp>`.
- Rate limits: `feedback_rate_windows` keyed by a salted, truncated hash; the
  per-window salt is deleted with the window. No address is ever stored.

## Go-live (lead steps)

1. `wrangler r2 bucket create nikatru-feedback` (and `nikatru-feedback-sandbox`),
   no public access.
2. Merge: deploy-workers.yml deploys it and binds `feedback.nikatru.com`.
3. Flip `INTAKE_OPEN` to `"true"` in `wrangler.jsonc` in a follow-up PR.
