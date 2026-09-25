# `deploy-workers.yml`

The prose that used to live inside `.github/workflows/deploy-workers.yml`. The workflow keeps a
one-line `# why:` on each non-obvious decision; everything that explains, retracts or records a
measurement is here. Read `docs/ci/README.md` first — it carries the rules every workflow in this
repository has to obey.

Moved on 2026-09-06 with the `worker-shared-chassis` unit ([ADR 067] decision 2), on the pattern
`ci.yml` and the other twelve workflows already follow. **242 comment lines became 56**, and the
parsed YAML changed only where that unit deliberately changed it — the two `services/_shared/**`
globs — which is shown as a canonical-JSON diff in
`Private/pre-prune-2026-09-08:research/revamp-2026-09-05/phase2-spine-worker-shared-chassis.md`.

## ⏱ 2026-09-25 — a post-gate call job of ci.yml ([ADR 095] §4)

This file is now only a `workflow_call` callee. It runs as ci.yml's `deploy-workers` call
job, which has `needs: [ci-gate]` and the post-gate `if:`
(`github.event_name == 'push' && github.ref == 'refs/heads/main'`), so ci-gate has passed
before `d1 migrations apply --remote` can start. The push trigger, the `paths:` list and the
`workflow_dispatch` button are gone. Each job's plan step (`plan-deploy.mjs`) now decides from
the job's own unit in `tooling/ci/lane-map.json` `deployUnits`, graded by
`assert-deploy-triggers-deploy.mjs`. A run of this lane is listed as `deploy-workers / <job>`
inside a CI run. The ops register reads it there (`duty.workflow.deploy-workers.yml`,
`recordQuery.workflow: ci.yml`, unit `{jobs: [deploy-workers]}`), and `redeploy-stranded.yml`
listens to `CI`. The sections below keep the file's earlier prose as it was written. Where they
describe `on.push.paths` or the manual run, they describe the file before this change.

## File header

### above `on:`

Deploys the Cloudflare Workers in services/ on push to main. Path-scoped so a
change to one service never redeploys the other (mirrors deploy-web.yml's
scoping for the Flutter web app). Uses the SAME scoped Cloudflare credentials
as deploy-web.yml — CLOUDFLARE_API_TOKEN must include **Workers Scripts: Edit**
(the token in cowork-private/secrets.env already deploys these Workers).

Manual run: Actions ▸ Deploy Workers ▸ "Run workflow" (workflow_dispatch)
redeploys BOTH Workers from current main — a manual redeploy / rollback button.

### `on.push.paths`, above `contracts/entitlement/*.js`

── THE SHARED CONTRACT IS A BUILD INPUT OF THE platform WORKER ─────────
`services/platform/src/lib/mor/contract.ts` IMPORTS
`contracts/entitlement/contract.js` (ADR 067 decision 1), and esbuild
inlines it into the bundle — proven with `wrangler deploy --dry-run
--outdir`, whose sourcemap names the file. So editing the revocation
reason set changes what the live Worker runs while nothing under
services/ has moved. Without these two lines that edit deploys nothing
and NOTHING GOES RED, which is the exact shape assert-deploy-triggers
exists for.

⚠️ SCOPED TO *.js / *.json, NOT `contracts/entitlement/**`, AND THE
DIFFERENCE IS A RECORDED INCIDENT. The `services/subscriptiontracker-api/**` filter
above once matched a README and redeployed a production Worker on a
docs-only change. `contracts/entitlement/` holds README.md, a
contract.schema.json, a hand-written contract.d.ts and two generator
scripts; only the ES module and the generated table are bundled. A `.md`
edit here must not touch production.

### `on.push.paths`, above `services/_shared/**` — added 2026-09-06

`services/_shared/src/{health,error-sink,auth,entitlement-read}.ts` is the ONE HOME of the modules both
Workers and the brick's Worker template used to carry three times ([ADR 067] decision 2) — and, since
2026-09-10, of THE ONE entitlement reader ([ADR 057] §5), which both Workers mount at `/v1/entitlements`
and which is the reason a change there must redeploy BOTH. Every carrier reaches
it by a bare RELATIVE import, which esbuild inlines exactly as it inlines
`contracts/entitlement/contract.js` — so a file outside both service directories is a build input of
both Workers.

That is the incident-#155 shape if it goes unnamed: a shared file matching neither trigger nor
filter would deploy NOTHING while CI went green. `services/platform/test/twinned-worker-modules.test.ts`
recorded that objection on 2026-08-17 as the reason NOT to have a shared home at all. The objection
was real; the repair is these three globs — the trigger path here, and the same glob in BOTH inner
filters — plus the limb in `tooling/ci/assert-deploy-triggers-deploy.mjs` that fails the build when a
filter claims a source tree without claiming what that tree imports from outside itself.

## `permissions:`

### above `permissions:`

Least privilege. Deploys use the Cloudflare token, not GITHUB_TOKEN; this only
needs to read the repo, read ci-gate's verdict, and record what went live.
[pipeline F-5b]
`deployments: write` was here until 2026-07-27 and zizmor flagged it HIGH
severity / HIGH confidence: at workflow level EVERY job gets it, including
`detect`, which only reads ci-gate's verdict and writes nothing. It now sits on
the two jobs that actually record a deployment marker. [pipeline F-11]

## job `detect`

### above `timeout-minutes: 25`

25 because the gate check below polls for up to assert-gate-passed.mjs's own
1200 s default. That is not hypothetical here: this job's longest recorded
run is 20m06s — the poll expiring — against a 5m59s worst case when ci-gate
was already green. A bound under 21 would cut the poll short and report a
cancellation instead of "timed out waiting for ci-gate". [pipeline F-5b]

### inside the `actions/checkout` step

persist-credentials: false — actions/checkout otherwise writes GITHUB_TOKEN
into .git/config and LEAVES it there for the whole job. Any later step that
packages the workspace (or anything containing .git/) ships the token inside
the artifact, and on a PUBLIC repo artifacts are downloadable. Nothing here
does git push/tag/commit, so none of these checkouts need the credential.
[zizmor artipacked] Verified 2026-07-27: no current artifact path includes
.git/ — so this closes a FUTURE mistake, not a live leak.

### above `Require ci-gate to have passed for this commit`

The gate check lives HERE, not in the deploy jobs, for two reasons:
both deploy jobs already `needs: detect`, so one insertion blocks both;
and it therefore runs BEFORE `d1 migrations apply --remote`, which is
irreversible. It also covers workflow_dispatch — the "manual redeploy /
rollback button" that previously consulted nothing at all, and which is
by definition pressed when something is already wrong. Fails closed.
[pipeline F-5b]

### above the `dorny/paths-filter` step

── 🔴 THE WORKFLOW FILE MUST APPEAR IN BOTH FILTERS ────────────────────

THE DEPLOY PATH COULD NOT DEPLOY A FIX TO ITSELF, and that is not a
hypothetical — it is how #155 came to be recorded as shipped while
production stayed broken for six hours.

`on.push.paths` (top of this file) ALREADY lists this workflow, so a
workflow-only change TRIGGERS the run. This inner filter did not list
it, so `decide` set both outputs to `false`, both deploy jobs were
SKIPPED, and the run reported **success**. Measured: run 30933229005,
push of 2cd7b7a (#155) — `Detect changed services => success`,
`Deploy platform => skipped`, `Deploy subscriptiontracker-api => skipped`.

#155's whole subject was repairing this deploy job's double-deploy,
which had wiped `--var GLITCHTIP_DSN` and `--var RELEASE` off the live
`platform` Worker. The repair merged, ci-gate went green, the tracker
said "Fixed in #155" — and `platform.nikatru.com/v1/health` kept
answering `"build": null`, with the crash sink of the Worker every app
depends on still dark, until a human dispatched the workflow by hand.

📌 A CHANGE TO HOW DEPLOYS WORK IS EXACTLY THE CHANGE THAT MUST BE
PROVEN BY DEPLOYING. Listing the file in both filters costs one
redeploy of two Workers per workflow edit; omitting it costs the
ability to ever ship a deploy fix. `tooling/ci/assert-deploy-triggers-deploy.mjs`
now fails the build if any trigger path has no filter.

### inside the `filters:` block scalar, above `contracts/entitlement/*.js`

The shared entitlement contract — see the note on the trigger
list at the top of this file. Both halves must name it, or the
push starts a run whose `detect` job answers false and skips
every deploy while reporting success. That is the #155 shape and
`tooling/ci/assert-deploy-triggers-deploy.mjs` fails the build on
any trigger path no filter claims.

subscriptiontracker-api deliberately does NOT claim it: that Worker restates
its own two-value money environment in
`src/lib/money.ts` and imports nothing from contracts/.
Claiming a path it does not build from would redeploy it for a
change that cannot affect it.

### inside the `filters:` block scalar, `services/_shared/**` in BOTH names — added 2026-09-06

BOTH filters claim it, and that is not symmetry for its own sake: both Workers import from
`services/_shared/src/`, so a change there changes what BOTH live Workers run. This is the half the
top-level trigger cannot supply — a trigger starts the run, and the inner filter decides which deploy
jobs are allowed to do anything. `contracts/entitlement/*` shows the other side of the same rule:
only `platform` builds from it, so only `platform` claims it.

### above `id: decide`

Manual dispatch has no diff to filter on → deploy both. Push → per-path.

## job `subscriptiontracker-api`

### above `permissions:`

Job-level, so `detect` does not inherit write access it never uses.

### above `Apply APP_DB migrations (before deploy)`

MIGRATIONS BEFORE DEPLOY — the order is the whole point.

This step did not exist until 2026-07-25, and the gap was silent: a
migration could be committed, pass CI, and be "deployed" green while
never touching the database. Proved live — 0002_schema_debt.sql sat
unapplied while subly_db still had no budget_categories.id.

Migrations run FIRST because the schema standard is additive-only
(Private/requirements/ — the prose `schema-evolution.md` that used to be
cited here was folded into that JSON spec on 2026-08-16 in commit
e88fdcf, and the rule is now INV-505 for these migrations and INV-S3-10
for the brick's starter schema, both in invariants.json; the deleted page
still reads back with
`git -C Private show e88fdcf^:requirements/schema-evolution.md`): new
columns are harmless to code that predates them, whereas deploying code
that reads a column the database does not have yet is an outage. Expand,
then deploy.

### inside each `wrangler-action` step, beside `wranglerVersion`

pinned: package.json says ^4.0.0, which floats. [F-2]

### above `The deployed SQL is SQL live D1 will run`

── [pipeline K-7] THE SQL IS EXECUTED BEFORE THE CODE THAT SENDS IT IS ──

🔴 EVERY IN-APP ACCOUNT DELETION IN PRODUCTION FAILED FROM THE DAY THE
ROUTES SHIPPED AND EVERY CHECK WAS GREEN. The erasure routes derived
their table set from `FROM sqlite_master m JOIN pragma_table_info(m.name)
p`; D1's authorizer refuses that statement at RUNTIME (7500 `not
authorized: SQLITE_AUTH`), so the route threw before reading a row and
answered 503. Nothing could see it: the unit suite runs SQL through
`node:sqlite`, which has no authorizer, and ci.yml's static half can only
read text. A statement's legality is a property of the ENGINE.

⚠️ AFTER THE MIGRATIONS AND BEFORE THE DEPLOY, AND THE HALF-STATE IS THE
REASON. It has to run after the migrations because it executes the real
statements against the real schema, and a statement checked against
yesterday's columns proves nothing about today's. So a failure here
leaves migrations applied and the old code serving — which is the SAFE
half-state precisely because the schema standard is additive-only (see
the "MIGRATIONS BEFORE DEPLOY" note above, which carries the recovery
command for the folded `schema-evolution.md`, and Private/requirements/,
the JSON spec that absorbed it): new columns are harmless to code that
predates them. The unsafe half-state is the other order.

BLOCKING, and exit 2 ("could not look") blocks too. The check retries a
dropped socket once by itself; past that, deploying code whose SQL nobody
could execute is the state this whole step exists to end.

### above the `id: deploy` step

`id: deploy` is read by the record step at the bottom of this job — see
the block there. It is the only step whose success means "the new code is
what subscriptiontracker-api.nikatru.com is running", so it is the fact the ledger entry is
conditioned on.

### inside the `id: deploy` step, above `command:`

[pipeline 11]E-8 — the two vars the crash sink needs, supplied at
DEPLOY time rather than committed.

- `GLITCHTIP_DSN` — a `--var`, not a secret, deliberately: a DSN is a
  write-only ingest key this factory already ships inside every web
  build (deploy-web.yml passes the same value as a --dart-define,
  which lands in a bundle browsers download). Making it a secret
  would be ceremony around a public value AND would leave the sink
  waiting on an owner running `wrangler secret put` — which is how
  a fail-closed seam stays closed forever.
- `RELEASE` — the deployed SHA. NOT `API_VERSION`, which is the literal
  "v1" in both Workers and has never changed, so it would group
  every error this factory ever reports into one bucket named after
  a URL prefix. [9]R-2 replaces it with a real release id.

### above `Smoke — the live Worker answers at THIS commit`

── [pipeline 14]O-7 · THE DEPLOY IS NOT TRUSTED UNTIL THE WORKER AGREES ─
`build` is a SEPARATE field from `version` on /v1/health: `version` is
the literal "v1" API-contract version and can never equal a build
identity, so a smoke joined to it would have passed forever. `build` is
threaded from the same `--var RELEASE:${{ github.sha }}` the crash sink
groups by, so a deploy cannot set one and not the other.

`--require-ok` is a separate conjunct on purpose: a Worker serving the
right build with `ok:false` has deployed AND is unwell, and collapsing
the two would report a bad deploy as a good one.

### above `Record the deployed SHA`

── 🔴 CONDITIONED ON THE DEPLOY, NOT ON THE SMOKE (2026-08-09) ──────────
Same change, same reason, as the identical step in deploy-web.yml — read
the long block there for the measured failure (run 144) that produced it.
In one line: a provenance record must be conditioned on the ACT it
describes, never on a later verdict about that act. The upload settles
"which code is running"; the smoke asks the different question "does it
answer yet", and it can be red while the first answer is still true —
a Worker that deployed and is unwell (`--require-ok`) is the clearest
case, and it is exactly when knowing WHICH sha is live matters most.

A strict widening: the default `success()` already required `deploy` to
be green, so nothing that recorded before stops recording. The smoke
still fails the job.

## job `platform`

### above `Apply PLATFORM_DB migrations (before deploy)`

MIGRATIONS BEFORE DEPLOY — see the note in the subscriptiontracker-api job.
platform is the SOLE applier of platform_db migrations, so this is the
only place the shared entitlements/events/consent schema advances.

### above `The deployed SQL is SQL live D1 will run`

── [pipeline K-7] see the identical step in the subscriptiontracker-api job above ─────
This Worker is the portfolio's erasure ENTRY POINT: its DELETE
/v1/account sweeps platform_db, relays to every app's own route and
deletes the identity last. It is the route the rejected join broke first.
It binds subscriptiontracker_db as well as platform_db, so the check executes its
statements against BOTH — a route reads the databases it reads, not the
ones its Worker binds, and this is the seam where that stopped being true.

### above the `id: deploy` step

── ONE DEPLOY PER JOB, AND IT CARRIES THE VARS ─────────────────────────

🔴 THE SECOND DEPLOY NOBODY WROTE. The keep-alive secret used to be
pushed by a SEPARATE `wrangler-action` step that supplied `secrets:` and
no `command:`. The action's `command` DEFAULTS TO `deploy`, so that step
uploaded the secret and then ran a bare `wrangler deploy` — and wrangler's
default `keep_vars: false` deletes every plain-text var that is not in
`wrangler.jsonc`, which is exactly the two threaded by CLI flag below.

Measured on run 30891499182: 08:23:39 deploy with `env.GLITCHTIP_DSN` and
`env.RELEASE` bound (version 457a9616), 08:23:47 a second, unqualified
deploy with neither (version e5bfece9). The version left LIVE was the
second one. `GET /v1/health` returned `"build": null` while subscriptiontracker-api —
which has no secrets step — returned the SHA, and that is what reddened
the post-deploy smoke from 2026-08-02 onward.

⚠️ IT WAS NOT ONLY CI. The same wipe took `GLITCHTIP_DSN` with it, so the
crash sink of the Worker every app depends on for config, analytics,
consent, entitlements and the money webhook reported NOTHING for two
days, silently, while the deploy job looked like it had merely failed a
health assertion.

Merged into the single deploy so there is exactly one upload per job and
it is the one carrying the vars. The action runs `uploadSecrets()` BEFORE
`wranglerCommands()` (proven by the log ordering above: 🔑 08:23:46,
🚀 08:23:47), so the secret still lands and its VALUE still never appears
in an argument list or a log — it is read from the step env by name.

⚠️ ORDERING CAVEAT, stated because this change inverts it. The old step
ran after the deploy on the stated grounds that "a secret is pushed to a
Worker that must already exist". Secrets now upload FIRST, which is safe
for `platform` (live since 2026-07) but would fail on the first-ever
deploy of a brand-new Worker. A new Worker needs one deploy before its
first secret — do not copy this shape to one until it exists.

── [pipeline O-4] WHAT THE SECRET IS FOR ───────────────────────────────
`platform_db.cron_heartbeat` carried, every night for three consecutive
nights: "HTTP 401 — REJECTED (unauthenticated, no SUPABASE_ANON_KEY
configured). A rejected request is not proven activity." This keep-alive
is the only thing standing between the shared Supabase auth project and
the free tier's idle pause, and a paused auth project takes sign-in down
across the whole portfolio.

`id: deploy` — the record step at the bottom of this job is conditioned
on it; see the block there.

### inside the `id: deploy` step, above `command:`

[pipeline 11]E-8 — see the identical pair in the subscriptiontracker-api job above
for why the DSN is a `--var` and why the release is the SHA rather
than API_VERSION.

### above `Smoke — the live Worker answers at THIS commit`

── [pipeline 14]O-7 · see the identical step in the subscriptiontracker-api job ───────
This is the Worker every future app depends on for config, analytics,
consent and the single cron, and until this line nothing ever asked it
whether it had actually come up.

### above `Record the deployed SHA`

── 🔴 CONDITIONED ON THE DEPLOY, NOT ON THE SMOKE (2026-08-09) ──────────
See the identical step in the subscriptiontracker-api job above, and the long block in
deploy-web.yml for the run-144 failure this comes from. This Worker is
the one every app depends on for config, analytics, consent,
entitlements and the money webhook — "which sha is live on platform" is
the first question of every incident, and losing the answer because the
health probe was red is losing it exactly when it is needed.
