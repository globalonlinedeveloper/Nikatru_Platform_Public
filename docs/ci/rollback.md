# `rollback.yml`

The prose behind `.github/workflows/rollback.yml`. The workflow keeps a one-line
`# why:` on each non-obvious decision; everything that explains or records a
measurement is here. Read `docs/ci/README.md` first — it carries the rules every
workflow in this repository has to obey.

## What it closes

**O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 4.** Putting a known-good web bundle or
Worker back live was a procedure in `tooling/ops/register.json` (rows
`revert.web.subscriptiontracker`, `revert.worker.platform`,
`revert.worker.subscriptiontracker-api`) that a person ran by hand from a laptop,
outside any gate. This workflow is that procedure as a lane: a dispatch names a
ledger Deployment that was good, and the Pages deployment or Worker version it
recorded goes back live, behind the `production` environment, a main-only ref
check, the unit's own smoke and a ledger record.

## Inputs

| input | what it is |
|---|---|
| `unit` | the ledger environment: `<app>-web`, `subscriptiontracker-api` or `platform`. Resolved through `tooling/channel-register.json` by `resolveEnvironment` in `tooling/ci/deployment-record.mjs`, the resolver `record-deployment.mjs` uses, so any app's `<app>-web` is taken the same way. |
| `deployment` | the id of the GitHub Deployment (the ledger record) whose build goes back live. |
| `dry_run` | **defaults to true.** Prints the exact command and changes nothing: no Cloudflare call, no smoke, no record. A stray click is a no-op. |

## Steps, in order

1. **Checkout**, `persist-credentials: false`.
2. **`node tooling/ci/assert-deploy-ref.mjs --allow main`.** ⚠️ **That file lands
   with the parallel change for limb 2 (draft pd2c), not with this one.** Until it
   is on main this step fails, and so does every dispatch: rollback.yml merges
   after it, never before. It is the first step after the checkout it needs.
3. **Node**, then the **wrangler island** (`npm ci --ignore-scripts --prefix
   tooling/wrangler`, the pin `deploy-web.yml` already installs), on a real run
   only.
4. **`tooling/ops/rollback.mjs`.** Reads the ledger Deployment and its statuses
   (two GETs), refuses anything that is not a known-good record of this unit,
   prints `$ <the exact command>`, and on a real run runs it:
   - `<app>-web`: `POST /accounts/{account}/pages/projects/<app>/deployments/<id>/rollback`
     on the Cloudflare API, which must answer `success: true`.
   - a Worker: `wrangler rollback <version-id> --message "<run and ledger id>" --yes`,
     from `services/<worker>/`, with the island's binary. The run then reads
     `Current Version ID:` back and refuses if it is not the id it asked for.
5. **The unit's own smoke**, joined to the re-promoted build rather than to
   main's head: the web build number is the recorded run's `run_number`
   (`<environment_url>/version.json`, field `build_number`); a Worker's build is
   the recorded SHA (`/v1/health`, field `build`, `--require-ok`).
6. **The record**: `record-deployment.mjs <unit> <url> --rollback-of <ledger id>
   --ref <sha> <id flag> <id>`, conditioned on the re-promotion, not on the smoke,
   like both deploy lanes' record steps.

## The record names the commit that went back live

`plan-deploy.mjs` reads the newest successful Deployment per environment as what
is live. Recorded at `GITHUB_SHA` (main's head, the build just taken down), the
ledger would name the bad build live, and the next push would plan nothing for
the unit. So the re-promotion is recorded at the re-promoted SHA, with
`rollback: true` and `rollback_of` in the payload. `record-deployment.mjs`
refuses `--ref` without `--rollback-of`, `--rollback-of` without `--ref`, and
either on a store unit.

⚠️ **The consequence: the next push to main that touches the unit deploys main's
head again, bad commit included.** A rollback buys time; it does not replace
reverting the bad commit on main, or landing the fix, before that push.

A record that is itself a re-promotion is refused as a target: its `run_number`
is the rollback run's, which is not the build number the site serves. Name the
ledger Deployment it re-promoted instead; the refusal prints its id.

## What is never re-promoted here

- **D1 schema.** `revert.d1.schema` stays owner-run. `rollback.mjs` refuses a
  unit whose name is a D1 binding or `database_name` in any
  `services/*/wrangler.jsonc`, or that is shaped like a database name.
- **Store units.** A store build is superseded by a new submission, not
  re-promoted.
- **A record with no id.** A Deployment recorded before its deploy passed the
  Pages deployment id or Worker version id has nothing to re-promote, and is
  refused with that reason (RC11).

## The facts this rests on

| fact | source | status |
|---|---|---|
| `cloudflare/wrangler-action` exposes `pages-deployment-id` and `command-output` | the action's `action.yml` is not in this tree | **UNVERIFIED.** A missing output is a warning at record time and a refusal at rollback time, never a wrong re-promotion. |
| Pages has no wrangler rollback command; the REST route is `POST /accounts/{account_id}/pages/projects/{project_name}/deployments/{deployment_id}/rollback` | wrangler 4.129.0 `wrangler-dist/cli.js`: `pages deployment` offers list, create, tail and delete only; the route is in the bundled Cloudflare SDK | read from the bundle, never called from this repository |
| `wrangler rollback [version-id]` takes `--name`, `--message` (at most 120 characters) and `--yes`, and prints `Current Version ID:` | wrangler 4.129.0 `wrangler-dist/cli.js` | read at 4.129.0; the island pins 4.135.0 |

## The owner step after merge

An attended no-op re-promotion of what is live now: dispatch with `unit:
subscriptiontracker-web` and `deployment:` the newest successful ledger
Deployment for it, first with `dry_run` ticked (read the printed command), then
unticked. Re-promoting the live build changes nothing a visitor sees; its smoke
going green is the evidence limb 4 needs. If Cloudflare refuses to roll back to
the deployment that is already live, the refusal is printed and nothing changed:
record that, and re-promote the previous one instead.
