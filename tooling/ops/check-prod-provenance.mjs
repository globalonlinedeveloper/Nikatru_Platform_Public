#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-prod-provenance.mjs — [pipeline B-17] THE MONITOR LIMB.
//
// "Verification against production is permitted and expected, but every artifact
// it creates is provably removed, and the check is mechanical rather than
// remembered."
//
// 🔴 WHY THIS IS A MONITOR AND NOT A GATE, STATED ONCE. B-17's falsifier is A
// ROW IN A DATABASE. It lives outside the repository, behind a credential, and
// ci.yml — which gates every push, including from forks — can never hold that
// credential. So the push gate (tooling/ci/assert-prod-provenance.mjs) asserts
// the RULES exist and that this reader is wired; only this file can answer
// whether any row actually fails one. That makes it a WEAKER RUNG: green here
// means "nothing has contradicted B-17 since the last run", never "B-17 holds".
//
// It runs daily in ops-watch.yml, which already holds CLOUDFLARE_API_TOKEN with
// D1 read and has no `push` trigger by design.
//
// ── WHAT IT COUNTS ──────────────────────────────────────────────────────────
// Per table, the rows whose provenance does NOT resolve — the inversion that
// replaced B-17's original criterion. The original counted "rows matching the
// test-marker convention"; there was no convention, so the predicate was empty
// and the count was 0 on every possible production state, forever. Counting the
// rows that CANNOT BE TRACED instead gives the predicate a non-empty complement
// that probe rows fall into without anyone tagging anything.
//
// A table may also declare `alsoResolves` — a list of SECOND resolvers, tried
// only for a value the primary one has already refused, and every acceptance on
// that footing PRINTS. Two tables use it: `consent_artifacts` (`e2e-run` since
// 2026-08-28, `store-capture` since 2026-09-23 — the blocks above
// `e2eRunResolver` and `makeStoreCaptureResolver` argue each trade in full) and
// `pending_erasures` (`erasure-step`, [ADR 087]).
//
// The rules are per table because the columns are (tooling/prod-provenance.json
// carries each marker and the written reason for it), and the table set is
// ENUMERATED from each database's migrations rather than listed — the same
// reading the gate uses, from the same module, so the two limbs cannot come to
// range over different schemas.
//
// ⏱ 2026-09-26 · EVERY DATABASE THE PLATFORM REGISTER'S WORKERS OWN
// (O-PROVENANCE-WALKS-ONE-DATABASE). This file read ONE wrangler path,
// services/platform/wrangler.jsonc, so a table added to subscriptiontracker_db
// was never enumerated, never queried and never missed. The set is now
// tooling/ci/migration-tables.mjs `registeredD1Databases`: servingWorker then
// each appWorker, every TOP-LEVEL D1 binding carrying `migrations_dir` —
// `env.*` blocks (the capture sandbox) are not production and are not walked.
// prod-provenance.json keeps `databases.<name>.{wrangler, migrationsDir,
// tables}`, held to that set both ways: a database with no entry is COVERAGE
// LOST (exit 2), an entry no Worker owns is a finding (exit 1). Every step
// below — completeness, both schema reads, the pending path, the census — runs
// per database, and every finding names `<database>.<table>`. A table whose
// columns carry no marker any resolver reads is `exempt`: never queried,
// printed as such, and its reason must name every one of its columns.
//
// ── PRIVACY: IT NEVER READS A ROW ───────────────────────────────────────────
// Every query is `SELECT <marker>, COUNT(*) … GROUP BY <marker>`. It reads ONE
// declared column and a tally. That is not tidiness: `provider_notifications`
// stores merchant-of-record payloads VERBATIM — a buyer's name, email address
// and billing country — and a monitor that hoovered rows into a public CI log
// would be a worse data incident than the residue it hunts.
//
// ── THREE-VALUED EXIT, AND THE DISTINCTION IS LOAD-BEARING ──────────────────
//   0 · every row in every table resolves to a released build or its declared
//       equivalent.
//   1 · at least one row does not. Someone wrote to production and did not
//       clean up, or a rail wrote a row it could not attribute.
//   2 · IT COULD NOT LOOK — no credential, no released-build set, an unreadable
//       register. "I could not look" must never read as "I looked and it was
//       fine": that is precisely how the claim this replaces became
//       unfalsifiable, and 04-backend-platform.md's own evidence block still
//       says `consent_artifacts` 0 because nothing ever looked again.
//
// ── THE SECOND WITNESS: A RUN THAT FAILED CAN STILL HAVE DEPLOYED ───────────
// 🔴 A RUN'S CONCLUSION IS A FACT ABOUT THE RUN, NOT ABOUT WHAT REACHED USERS,
// and reading it as the latter cost this repository a real incident. deploy-web
// run 144 (2026-08-08) uploaded to Cloudflare Pages successfully and then lost
// the CDN propagation race in its post-deploy smoke, so the RUN concluded
// `failure` while the bundle was live and serving. Rows written by real people
// carried `1.0.144+40c0787`, no successful run numbered 144 existed, and this
// monitor correctly — and uselessly — called them unattributable. The repair was
// a hand-written attestation in tooling/ops/manual-deploys.json.
//
// So a build now resolves on EITHER of two footings:
//   (a) its run number belongs to a SUCCESSFUL run of a served release lane
//       whose head commit is the build's own metadata — the original rule, and
//       the common case; or
//   (b) its run number belongs to a run of ANY conclusion whose head commit is
//       the build's own metadata, AND a GitHub DEPLOYMENT exists for that commit
//       on a served environment.
//
// (b) is the SAME PAIR OF INDEPENDENT WITNESSES manual-deploys.json demands, and
// it is not a weakening: a GitHub Deployment on `<app>-web` is written by exactly
// one thing — tooling/ci/record-deployment.mjs, inside the lane job, which is the
// only job in the repository holding `deployments: write`. Since 2026-08-09 that
// step is conditioned on the deploy step succeeding rather than on the smoke
// passing (see the block on it in deploy-web.yml), so the witness exists
// precisely when bytes reached the origin. Nothing here trusts the run's own
// verdict about itself.
//
// ⚠️ THE RUN-NUMBER LEG IS STILL REQUIRED IN (b). A deployment alone would let
// any sha resolve any run number, and run numbers are what version strings are
// ORDERED by. Both halves, or neither.
//
// ⏱ 2026-09-23 · A THIRD FOOTING: A BUILD THAT LEFT THROUGH A STORE SUBMISSION.
// The paragraphs above read "a served release lane" as deploy-web.yml alone, so
// the first real Play upload — submit-play.yml run_number 5 (run 35787897094),
// stamped `1.0.5+0390db6` — wrote consent rows that this reader called
// unattributable (ops-watch run 35820464059). A submittable Flutter-app channel's
// `submission.workflow` stamps its OWN run number, so it is a release lane too.
// Its footing is narrower than (b), on purpose:
//   (c) a run of that submission lane whose head commit is the build's metadata,
//       AND a GitHub Deployment on that lane's own `{app}-<channel>` environment,
//       at that FULL commit, whose `payload` NAMES THAT RUN: `payload.workflow`
//       is the lane's workflow basename and `payload.run_id` is the run's id.
//       tooling/ci/record-deployment.mjs writes that payload from the run's own
//       GITHUB_WORKFLOW_REF and GITHUB_RUN_ID, and refuses a submission
//       environment that has neither.
// The run's conclusion is not consulted: a dry run concludes `success` and
// uploads nothing, and the one thing that says a binary left is the Deployment
// the run's own record step wrote after the upload. The binding is by run
// identity and never by time. A dry run at the same commit, a re-run attempt of
// that dry run, and a run whose lifetime merely overlaps an upload each carry a
// run id the upload's Deployment does not name, so none of them can borrow it;
// and a recovery Deployment written by hand after a rate limit binds however
// late it is written, provided it carries the run's payload. A payload-less
// Deployment on a submission environment binds ONLY through
// `legacyDeploymentBindings` in tooling/prod-provenance.json: a dated, measured
// deployment id → run id entry for a Deployment written before the payload
// existed. `dev`, `c6-localprobe` and a dry run's stamp stay refused.
//
// Usage:
//   node tooling/ops/check-prod-provenance.mjs
//   node tooling/ops/check-prod-provenance.mjs --root <dir>
//   node tooling/ops/check-prod-provenance.mjs --rows-file f.json --runs-file r.json
//     → OFFLINE FIXTURE MODE, for tests. It announces itself loudly; that line
//       must never appear in a real ops-watch log. `--deployments-file d.json`
//       (an array of sha strings) supplies witness (b) in that mode.
//       ⏱ 2026-09-23: an entry may also be an object `{environment, sha, id?,
//       created_at?, payload?}` — the only form that can witness footing (c); a
//       bare sha string is a served-ledger entry and never witnesses a
//       submission. A `--runs-file` entry may carry `path` or `workflow` naming
//       its lane; one with neither is a served-lane run, as every older fixture
//       means it. A submission-lane run must carry its `id`.
//       ⏱ 2026-09-23: `--point-reads-file p.json` supplies the point reads in
//       that mode — an object mapping each GitHub API path (no leading slash,
//       e.g. `commits/428beef`) to `{status, body}`; a path it does not name
//       answers 404. WITHOUT that flag a fixture run makes NO point reads and
//       says so, rather than inventing an answer for a commit it never asked about.
//       ⏱ 2026-09-23: `--capture-runs-file c.json` supplies the store-capture
//       witness set in that mode — `[{run_number, head_sha, status?,
//       conclusion?}]`, runs of store-screenshots.yml of ANY status. It never
//       enters `--runs-file` (which refuses a workflow that is no release lane),
//       and WITHOUT it a fixture run's capture set is empty, refusing every
//       `cap-*` value.
//       ⏱ 2026-09-25: four more seams for the pending-migration path below,
//       each REFUSED without `--rows-file`, because a live run reads the real
//       thing: `--schema-file s.json` — what the two schema reads answer,
//       `{"tables": [<name>…], "migrations": [<file>…] | {"error": "…"}}`
//       (WITHOUT it every enumerated table is present and every migration
//       applied, which is what every older fixture means); `--now <iso>` — that
//       path's clock (a fixture that reaches it without one is refused, so no
//       test reads the wall clock); `--history <dir>` — the git repository merge
//       times and ancestry are read from (default: `--root`); and
//       `--platform-deployments-file p.json` — the platform environment's
//       Deployments, `[{sha, id?, created_at?}]` (WITHOUT it: NOT READ, and the
//       clock alone decides).
//   node tooling/ops/check-prod-provenance.mjs --emit-served-environments
//     → prints the deployment environments witness (b) is read from, one per
//       line, and exits. Needs no credential, so it is the ONLY way a test can
//       reach that expansion — see the block on it in main().
//   node tooling/ops/check-prod-provenance.mjs --emit-release-lanes
//     → ⏱ 2026-09-23: prints every release lane as `<workflow>\t<kind>\t<env,…>`
//       and exits; the same no-credential reach, for footing (c)'s lanes.
//
// ⏱ 2026-09-23 · A CONSISTENT WALK, THEN A POINT READ BEFORE A VERDICT
// (O-PROVENANCE-MIN-CLAIM-PASSES-UNSTABLE-WALK). Each listing is walked from
// page 1 until one walk is internally consistent — one claim on every page, no
// row served twice, and as many distinct rows as claimed — up to WALK_ATTEMPTS
// walks; none consistent is COVERAGE LOST (exit 2). Then every `released-build`
// value the walked runs cannot place is looked up directly (`commits/<sha7>`,
// then each release lane's `runs?head_sha=<full>`), at most POINT_READ_CAP of
// them; a build found that way is judged like any other run and PRINTED. Every
// walk attempt and every point read prints one line, on success and on exit 2.
//
// ⏱ 2026-09-25 · A TABLE ITS MIGRATION HAS NOT REACHED YET IS NOT A FAILED READ
// (PROV-BEFORE-MIGRATION). #930 merged 0017_ext_devices.sql; deploy-workers #186,
// the one run that applies PLATFORM_DB migrations, refused because CI #3828 was
// red (ops-watch #484, an unrelated GlitchTip cause); and ops-watch #485 then
// counted `ext_devices` in production before anything had created it. D1
// answered `no such table`, this reader exited 2, and a red monitor keeps CI red
// — the loop that froze deploys until #186 was re-run by hand and applied 0017
// at 04:07:54Z. So, before the census, two plain schema reads through `queryD1`:
// every table in `sqlite_master`, and every name in wrangler's migration ledger
// (`migrations_table` of the same D1 entry, default `d1_migrations`). A table
// the migrations create and production lacks is then exactly one of:
//   · its migration IS recorded → a finding (exit 1): it ran, and the table it
//     creates is not there.
//   · its migration is NOT recorded → zero rows, PRINTED `⬜ not yet migrated: …`,
//     for as long as waiting can still bring it: no platform Deployment at a
//     commit containing the migration exists, and it merged less than
//     PENDING_LIMIT_HOURS ago. Past either, a finding naming the table, the
//     file, the merge time and the hours since.
// The clock is git: the committer date of the first-parent commit that ADDED
// the file, which on this squash-merge repository is the merge. A SHALLOW clone
// is refused — every file in it looks added by its one commit, a clock that
// restarts each checkout and never reaches 24 h — which is why ops-watch's job
// checks out with `fetch-depth: 0`. The ledger is the platform environment's
// GitHub Deployments: deploy-workers applies PLATFORM_DB migrations BEFORE its
// `deploy` step and records only when that step succeeded (the gate's limb 9
// holds that order), so a Deployment at a commit containing the migration says
// the applier ran it, and waiting will not bring the table. It is read only
// while something is pending, and the schema is read AGAIN after it, so a deploy
// that finishes between the two reads is seen as applied, never contradicted. A
// MISSING Deployment (the 2026-08-17 503) only leaves the clock to decide; the
// ledger can make a verdict red sooner and can never make a table look
// migrated. Either schema read failing, or answering in a shape this reader
// cannot believe, is exit 2 — never "every migration applied".
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (D1 read, on EVERY walked
//      database — a refusal names the database, so a token scoped to one of
//      them is exit 2 naming the other, never a clean total over one)
//      GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY (release-lane run history and
//      the deployment ledger)
//      GITHUB_API_URL (the loopback test seam of record-deployment.mjs; Actions
//      sets the real origin, accepted unchanged)
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { enumerateMigrationTables, registeredD1Databases, databaseLock, exemptionProblem, EXEMPT } from '../ci/migration-tables.mjs';
// ⏱ 2026-09-24 — where the GitHub reads go is record-deployment.mjs's loopback-only
// seam, the rule assert-gate-passed.mjs already imports, not a third copy of it.
import { githubApiBase } from '../ci/record-deployment.mjs';
// ⏱ 2026-09-23 — which submittable channels ship a Flutter build (and so carry an
// APP_VERSION stamp) is the surface's `flutterApp` answer, read the way six guards
// already read it; a row on a surface that answers nothing is CouldNotLook.
import { flutterAppChannel, undeclaredSurfaceLine } from '../ci/channel-surface.mjs';
// ⏱ 2026-09-25 [ADR 095 §4] — which workflow's runs carry a lane's stamps is the
// workflow scanner's run-host answer: a `workflow_call`-only lane runs as its one
// caller's child, and inherits that caller's run_number and GITHUB_WORKFLOW_REF.
import { parseResolvedWorkflows, laneRunHost, laneRefusalText, WORKFLOW_DIR } from '../ci/workflow-scan.mjs';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry, fetchWithBoundedRetry, backoffPlan } from './bounded-retry.mjs';
// ⏱ 2026-09-23 — the non-release stamp shapes live in ONE module, which the
// store capture's define helper and assert-live-writer-provenance also import:
// the shape a drive stamps and the shape this reader accepts are one definition.
import { CAPTURE_WORKFLOW, E2E_RUN_SHAPE, STORE_CAPTURE_SHAPE } from '../e2e/app-version-stamp.mjs';
// The product kinds a bundle may span, imported rather than retyped: the same
// file tooling/bundle-availability.mjs and the Worker twin read, so `script`
// becoming real is one edit and not three.
import { PRODUCT_KINDS } from '../../contracts/entitlement/bundle.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER_REL = 'tooling/prod-provenance.json';
const CHANNELS_REL = 'tooling/channel-register.json';
const PROVIDERS_REL = 'tooling/legal/provider-register.json';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 || i === args.length - 1 ? null : args[i + 1];
};
const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

// ⏱ 2026-09-21 — THE ONE SHAPE OF "I COULD NOT LOOK" NOW COMES FROM
// tooling/ops/bounded-retry.mjs. It was declared here, which meant `e instanceof
// CouldNotLook` in the tail below was true only for throws from THIS file — fine
// while every throw and catch sat in one file, and wrong the moment a shared
// helper started raising it. Still never 0 and never 1. Re-exported at the
// bottom of this file exactly as before, so test/prod-provenance.test.mjs is
// unmoved and is the green control for the change.

const readJson = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new CouldNotLook(`${rel} does not exist`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new CouldNotLook(`${rel} is not valid JSON (${e.message})`);
  }
};

// ── the released-build set ──────────────────────────────────────────────────
//
// A build this factory SHIPPED is `<release_line>.<run_number>+<sha7>` — the
// shape deploy-web.yml composes and assert-app-versioning.mjs enforces. So a
// version string resolves iff:
//   · its release line (major.minor) is one an app in this workspace declares,
//   · its patch equals the run number of a COMPLETED run of a SERVED release
//     lane, and
//   · its build metadata is that run's head commit, and
//   · that run either SUCCEEDED, or left a GitHub Deployment behind on a served
//     environment — witness (b) in the header. The third bullet said "a
//     SUCCESSFUL run" until 2026-08-09 and that reading is what called run 144's
//     live bundle unattributable; a run's conclusion is a fact about the run,
//     not about what reached users.
// Nothing is listed here. `dev` (the dart-define default when APP_VERSION is
// absent) and `c6-localprobe` (the C-6 live probe's literal) fail all of them.
//
// ⏱ 2026-09-23 — the bullets above are left as written. A build that leaves
// through a SUBMISSION lane (a submittable Flutter-app channel's
// `submission.workflow`) is also a shipped build, and its patch is that lane's
// own run number. Its footing is footing (c) in the header: a Deployment on the
// lane's environment whose payload names that run. A run's success is not
// enough there, because a dry run succeeds and ships nothing.
function releaseLines() {
  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return new Set();
  const lines = new Set();
  for (const e of readdirSync(appsDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(appsDir, e.name, 'pubspec.yaml');
    if (!existsSync(p)) continue;
    const m = readFileSync(p, 'utf8').match(/^version:\s*(\d+)\.(\d+)\.(\d+)/m);
    if (m) lines.add(`${m[1]}.${m[2]}`);
  }
  return lines;
}

/** THE RELEASE LANES, BOTH KINDS, read off tooling/channel-register.json.
 *  served     — `served: true` rows with a `lane.workflow` (deploy-web.yml today).
 *  submission — `submittable: true` rows whose surface ships a Flutter app, via
 *               `submission.workflow`; their stamped builds reach users through
 *               a store, and the witness is the Deployment the run recorded.
 *  `environments` is the rows' `deploymentEnvironment` expanded over
 *  appSlugs(). Replaced servedLaneWorkflows() on 2026-09-23, which read the
 *  served rows only.
 *
 *  ⏱ 2026-09-23 · ONE LANE PER WORKFLOW, AND THE STRICTEST FOOTING WINS. A
 *  workflow that any row names as its `submission.workflow` is a SUBMISSION lane,
 *  whatever else a row says about it, and its environments are those submission
 *  rows' environments only. This was one entry per (workflow, kind), and a row
 *  that is both `served: true` and submittable on the same workflow (linux-snap:
 *  lane.workflow and submission.workflow are both submit-snap.yml) made TWO lanes
 *  for one workflow — the resolver's lane lookup took the served one and would
 *  have judged a dry run's stamp on the weaker served footing, where success
 *  alone resolves. The combination is not forbidden in the register instead,
 *  because it is a TRUE state a row reaches: a store channel becomes served once
 *  it is live and stays submittable for its next release, and a register rule
 *  would force a false row. A per-row rule would also miss two rows naming one
 *  workflow. Deciding it here decides it once for every reader of the lanes:
 *  `--emit-release-lanes`, the live walk, the fixture placement, the resolver
 *  and the census. */
function releaseLanes({ lenientWhenUnread = false } = {}) {
  const reg = readJson(CHANNELS_REL);
  const slugs = appSlugs();
  const expand = (tpl) => (tpl.includes('{app}') ? slugs.map((s) => tpl.replace('{app}', s)) : [tpl]);
  const byKind = { served: new Map(), submission: new Map() }; // workflow basename → lane
  const add = (kind, wfPath, row) => {
    const workflow = wfPath.split('/').pop();
    const lane = byKind[kind].get(workflow) ?? { kind, workflow, path: wfPath, channels: [], environments: new Set() };
    lane.channels.push(row.id);
    if (typeof row.deploymentEnvironment === 'string') for (const e of expand(row.deploymentEnvironment)) lane.environments.add(e);
    byKind[kind].set(workflow, lane);
  };
  for (const c of reg.channels ?? []) {
    if (c?.served === true && c?.lane?.workflow) add('served', c.lane.workflow, c);
    if (c?.submittable !== true) continue;
    const app = flutterAppChannel(reg, c);
    if (app === null) throw new CouldNotLook(undeclaredSurfaceLine(c, 'whether its submitted builds carry an APP_VERSION stamp'));
    if (app === false) continue; // an extension: not a Flutter build, no app_version
    if (typeof c?.submission?.workflow !== 'string' || typeof c?.deploymentEnvironment !== 'string') {
      throw new CouldNotLook(
        `channel ${JSON.stringify(c.id)} is submittable but declares no submission.workflow or deploymentEnvironment, ` +
          'so its builds could be neither fetched nor witnessed',
      );
    }
    add('submission', c.submission.workflow, c);
  }
  const out = [
    ...[...byKind.served.values()].filter((l) => !byKind.submission.has(l.workflow)),
    ...byKind.submission.values(),
  ].map((l) => ({ ...l, environments: [...l.environments] }));
  if (!out.some((l) => l.kind === 'served')) throw new CouldNotLook(`no served lane in ${CHANNELS_REL}, so the released-build set has no footing`);
  // The register is judged first, so a malformed row is named before any
  // workflow file is read.
  return withRunHosts(out, { lenientWhenUnread });
}

/** The listing filter on a CALLER's runs: a lane called from ci.yml runs only
 *  on the post-gate class (POST_GATE_IF: a push to main), so a pull-request or
 *  branch run of the caller never carried a stamp of this lane. */
const HOST_RUN_FILTER = 'branch=main&event=push';

/** ⏱ 2026-09-25 [ADR 095 §4] WHICH WORKFLOW'S RUNS CARRY A LANE'S STAMPS.
 *  A workflow_call-only lane (deploy-web.yml once ci.yml calls it) has no runs
 *  of its own from then on: GITHUB_WORKFLOW_REF and run_number are the CALLER's,
 *  so its stamps read `<line>.<ci run_number>+<sha7>` and its Deployment payloads
 *  name `ci.yml`. Each lane therefore carries `runWorkflows`:
 *    · a callee lane: [<its own file>, <its one caller>] — its own file for the
 *      runs from before the move, the caller's `branch=main&event=push` runs after;
 *    · every other lane: [<its own file>].
 *  The run number alone never binds: every footing also checks that the stamp's
 *  sha7 is the run's head_sha prefix, so a deploy-web.yml run and a ci.yml run
 *  that share a number resolve only at their own commits.
 *  A laneRunHost refusal (two callers, an orphan, a missing file) is COVERAGE
 *  LOST: grading one of two hosts would leave the other unread. Two lanes on one
 *  run workflow are refused too — the resolver places a run on ONE lane.
 *  `lenientWhenUnread`: only a --runs-file fixture root with no .github/workflows
 *  at all reads each lane as its own run workflow (main prints NOT READ); a live
 *  run or an emit is never lenient. */
function withRunHosts(lanes, { lenientWhenUnread }) {
  if (!existsSync(join(ROOT, WORKFLOW_DIR))) {
    if (lenientWhenUnread) return lanes.map((l) => ({ ...l, runWorkflows: [l.workflow], host: null }));
    throw new CouldNotLook(`${WORKFLOW_DIR} is not in ${ROOT}, so the workflow whose runs carry each release lane's stamps could not be read`);
  }
  // parseResolvedWorkflows' own `refusal` concerns a composite or call edge
  // anywhere in the tree; laneRunHost refuses what bears on a lane's run host.
  const scan = parseResolvedWorkflows(ROOT);
  const ownerOf = new Map(); // run workflow basename → lane workflow
  return lanes.map((l) => {
    const h = laneRunHost(scan, l.path);
    if (h.refusal) throw new CouldNotLook(`COVERAGE LOST — release lane ${l.workflow}: ${laneRefusalText(h.refusal)}`);
    const host = h.callJob === null ? null : { workflow: h.workflow.split('/').pop(), callJob: h.callJob, filter: HOST_RUN_FILTER };
    const runWorkflows = host ? [l.workflow, host.workflow] : [l.workflow];
    for (const wf of runWorkflows) {
      if (ownerOf.has(wf)) {
        throw new CouldNotLook(
          `${wf} carries the runs of two release lanes (${ownerOf.get(wf)} and ${l.workflow}), so a run of it could not be ` +
            'placed on one lane — COVERAGE LOST, not a guess',
        );
      }
      ownerOf.set(wf, l.workflow);
    }
    return { ...l, runWorkflows, host };
  });
}

/** The listing filter a lane's run workflow is read with: '' for its own file,
 *  the host filter for its caller's. */
const runFilterOf = (lane, wf) => (lane.host && wf === lane.host.workflow ? lane.host.filter : '');

/** A lane's run workflows; a lane built by hand without them (an exported
 *  resolver's caller) runs as its own workflow. */
const runWorkflowsOf = (lane) => lane?.runWorkflows ?? (typeof lane?.workflow === 'string' ? [lane.workflow] : []);

/** 🔴 A SUBMISSION RUN WITH NO `id` IS REFUSED, NOT GUESSED. Footing (c) asks
 *  whether a Deployment's payload names THIS run, by id; a run without one
 *  could be bound to nothing, and "refused" would then be a verdict about the
 *  fixture rather than about the build. Live runs of every lane are already
 *  floored on `id` in githubRuns; fixture runs of a submission lane pass
 *  through here. Replaced requireRunWindow() on 2026-09-23, when the time
 *  window stopped being the binding. */
function requireRunId(r, workflowFile) {
  if (typeof r?.id !== 'number' && (typeof r?.id !== 'string' || r.id.length === 0)) {
    throw new CouldNotLook(
      `run ${r?.run_number ?? '?'} of ${workflowFile} carries no \`id\`, so no Deployment's payload can be bound to it`,
    );
  }
  return r;
}

/** A Deployment's payload as `{workflow, run_id, …}`, or `null` when it names
 *  nothing. The API returns the object record-deployment.mjs posted; a payload
 *  posted as a string comes back as that string, so a JSON string is parsed.
 *  `{}`, `''`, a string that is not JSON and a non-object all mean the same
 *  thing — this Deployment names no run — and the resolver refuses on it rather
 *  than this reader calling it unreadable. */
function deploymentPayload(raw) {
  let p = raw;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      return null;
    }
  }
  if (p === null || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length === 0) return null;
  return p;
}

/** A Deployment record, or CouldNotLook: `{ id, environment, sha, created_at,
 *  payload }`. `environment: null` is a served-ledger entry with no environment
 *  named (the bare-sha fixture form) and is accepted by footing (b) only. Live
 *  reads and fixture files both pass through here. ⏱ 2026-09-23 — `created_at`
 *  is carried for the log line only; it binds nothing, so its absence is no
 *  longer a refusal. */
function deploymentRecord(d, environment) {
  if (typeof d?.sha !== 'string' || d.sha.length === 0) {
    throw new CouldNotLook(`a deployment of ${environment ?? 'the served ledger'} carries no \`sha\`, so it witnesses no build`);
  }
  return {
    id: d?.id ?? null,
    environment,
    sha: d.sha.toLowerCase(),
    created_at: environment === null || typeof d?.created_at !== 'string' ? null : d.created_at,
    payload: environment === null ? null : deploymentPayload(d?.payload),
  };
}

/** The dated, measured exceptions to "a submission Deployment must carry its
 *  run's payload" — `legacyDeploymentBindings` in tooling/prod-provenance.json.
 *  Each entry binds ONE payload-less Deployment id to ONE run id, and states the
 *  workflow, environment and full sha it was measured at; the resolver applies
 *  it only when all of those match. An absent key is an empty list, which fails
 *  safe (the build it would have bound is refused); a present key of the wrong
 *  shape is CouldNotLook, because a half-read list would change verdicts
 *  silently. */
function legacyDeploymentBindings(register) {
  const list = register?.legacyDeploymentBindings;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new CouldNotLook(`${REGISTER_REL} legacyDeploymentBindings is not an array`);
  return list.map((b, i) => {
    const bad = (why) => new CouldNotLook(`${REGISTER_REL} legacyDeploymentBindings[${i}] ${why}, so it can bind nothing`);
    for (const k of ['deploymentId', 'runId']) {
      if (!/^\d+$/.test(String(b?.[k] ?? ''))) throw bad(`carries no numeric \`${k}\``);
    }
    for (const k of ['workflow', 'environment', 'measured', 'why']) {
      if (typeof b?.[k] !== 'string' || b[k].length === 0) throw bad(`carries no \`${k}\``);
    }
    if (!/^[0-9a-f]{40}$/.test(String(b?.sha ?? ''))) throw bad('carries no full 40-hex `sha`');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.measured)) throw bad('carries no `measured` date (YYYY-MM-DD)');
    return { ...b, deploymentId: String(b.deploymentId), runId: String(b.runId) };
  });
}

/** The app slugs `{app}` expands over. The published catalogue is the SSoT (it
 *  is what assert-publish-records.mjs builds the required environment set from),
 *  with the workspace directories as the floor so this reader still works on a
 *  tree that carries apps and no catalogue. */
function appSlugs() {
  const cat = join(ROOT, 'catalog', 'apps.json');
  if (existsSync(cat)) {
    try {
      const parsed = JSON.parse(readFileSync(cat, 'utf8'));
      const slugs = (Array.isArray(parsed) ? parsed : []).map((a) => a?.slug).filter((s) => typeof s === 'string');
      if (slugs.length) return slugs;
    } catch { /* falls through to the directory floor */ }
  }
  const appsDir = join(ROOT, 'apps');
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

/** ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT. The EXTENSION slugs, read from
 *  extensions/catalog/extensions.json — the extension catalogue the extensions
 *  lane publishes from. Its own reader, deliberately NOT `appSlugs()`: an
 *  extension is not an app, has no `apps/*` directory to fall back to, and an
 *  app slug must never resolve an extension-keyed row (nor the reverse). No
 *  directory floor: an unreadable catalogue yields [], which the resolver
 *  below refuses as COULD NOT LOOK rather than marking every row bad. */
function extensionSlugs() {
  const cat = join(ROOT, 'extensions', 'catalog', 'extensions.json');
  if (!existsSync(cat)) return [];
  try {
    const parsed = JSON.parse(readFileSync(cat, 'utf8'));
    return (Array.isArray(parsed) ? parsed : []).map((e) => e?.slug).filter((s) => typeof s === 'string');
  } catch {
    return [];
  }
}

/** `{app}-web` × the apps — the environments a served RELEASE channel's lane
 *  records into, and therefore the only ones whose GitHub Deployments witness
 *  that an app build was PUBLISHED. Service environments (the Workers) are
 *  deliberately excluded: a Worker deploy at some commit says nothing about
 *  whether the app bundle at that commit ever reached a browser. */
function servedEnvironments() {
  const reg = readJson(CHANNELS_REL);
  const slugs = appSlugs();
  const envs = new Set();
  for (const c of reg.channels ?? []) {
    if (c?.served !== true || typeof c?.deploymentEnvironment !== 'string') continue;
    if (!c.deploymentEnvironment.includes('{app}')) { envs.add(c.deploymentEnvironment); continue; }
    for (const s of slugs) envs.add(c.deploymentEnvironment.replace('{app}', s));
  }
  if (envs.size === 0) {
    throw new CouldNotLook(
      'no served channel in ' + CHANNELS_REL + ' expands to a deployment environment, so the GitHub Deployment ' +
        'ledger could not be read and witness (b) would be silently empty — which reads exactly like "no deploy ' +
        'was ever recorded" and would call every failed-run build unattributable.',
    );
  }
  return [...envs];
}

/** 🔴 ENVIRONMENTS NOTHING WRITES ANY MORE, AND THE LEDGER STILL HAS TO BE READ
 *  FROM THEM. Declared, dated, and never derived.
 *
 *  `servedEnvironments()` above expands `{app}-web` over the app DIRECTORIES, so
 *  it answers "where does the lane write TODAY" — and that binding is exactly
 *  what prod-provenance.test.mjs grades against deploy-web.yml. It must not grow
 *  a second meaning. But a GitHub Deployment environment is a NAME ON GITHUB,
 *  created when the deploy ran, and it does not move when a directory is
 *  renamed. On 2026-09-09 `apps/subly` became `apps/subscriptiontracker` and the
 *  ledger went from 58 witnesses to 2 — measured:
 *
 *    gh api repos/<owner>/<repo>/deployments?per_page=100
 *      -> subly-web 58 · subly-api 14 · platform 25
 *         subscriptiontracker-web 2 · subscriptiontracker-api 1
 *
 *  Nothing went red about the LOSS. What went red is its consequence, which is
 *  the failure this reader exists to produce rather than swallow: six groups of
 *  real production rows — including a real person's consent artifact — stopped
 *  tracing to any published build, because the two builds that wrote them
 *  (efabfb5, 40c0787) have their Deployments under `subly-web`.
 *
 *  ⚠️ THIS IS A READ-SIDE WIDENING ONLY, and the asymmetry is the whole safety
 *  property. `--emit-served-environments` still prints ONLY the derived set, so
 *  the test that binds this reader to the lane still grades the lane's name and
 *  cannot be satisfied by a line added here. An entry below can make a HISTORICAL
 *  build attributable; it can never make today's lane look like it recorded
 *  something it did not.
 *
 *  Each entry earns its line, EXTRAS-style: an environment nobody can say when
 *  or why stopped being written is drift, not history. Delete an entry when the
 *  last production row written by a build in it is gone. */
const RETIRED_ENVIRONMENTS = [
  {
    environment: 'subly-web',
    retired: '2026-09-09',
    why:
      'the web channel for app id `subly`, which became `subscriptiontracker` when the slug rename landed ' +
      '(#567). 58 Deployments were recorded under this name by record-deployment.mjs between 2026-07 and ' +
      '2026-09-09, and production rows written by those builds are still in platform_db.',
  },
];

/** The environments the DEPLOYMENT LEDGER is read from: where the lane writes
 *  today, plus the names it used to write. Read-side only — see the block above
 *  for why the emitted set stays narrower than this one. */
function ledgerEnvironments() {
  const envs = new Set(servedEnvironments());
  for (const r of RETIRED_ENVIRONMENTS) envs.add(r.environment);
  return [...envs];
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 · A REFUSED READ IS NOT A BAD ATTESTATION.
//
// Each entry of tooling/ops/manual-deploys.json is accepted only on two GitHub
// witnesses: the sha is a commit on this repository, and record-deployment.mjs
// wrote a Deployment for it. The loop in `main()` read ANY non-200 on the commit
// as "not a commit" and ANY non-200 on the deployment list as "no Deployment
// exists" — both pushed into `violations`, which is exit 1: "production carries
// rows that trace to no released build". So an expired token, a 5xx, or
// `API rate limit exceeded for installation` (the refusal that froze CI on
// 2026-09-11) paged as a bad attestation. The two answers are classified here,
// where every branch is reachable without a network: a 404/422 on the commit and
// an EMPTY deployment list stay findings; every other status, a body that is not
// JSON and a body that is not a list are CouldNotLook, exit 2. The requests stay
// in `main()`.
// ─────────────────────────────────────────────────────────────────────────────
/** PURE. What one commit read says: `'commit'`, `'not-a-commit'`, or CouldNotLook. */
export function attestationCommitRead(status, sha7) {
  if (status === 200) return 'commit';
  if (status === 404 || status === 422) return 'not-a-commit';
  throw new CouldNotLook(`the GitHub API returned ${status} reading commit ${sha7} for manual-deploys.json — a refused read is not a missing commit, so that attestation was not checked`);
}

/** The Deployments one attestation rests on, from a fetch-shaped answer
 *  (`status`, `json()`), or CouldNotLook. An empty list is returned, not thrown:
 *  "no Deployment exists" is a finding. */
export async function attestationDeployments(res, environment, sha7) {
  if (res.status !== 200) {
    throw new CouldNotLook(`the GitHub API returned ${res.status} listing the Deployments of ${environment} @ ${sha7} for manual-deploys.json — a refused read is not an empty ledger`);
  }
  let deps;
  try {
    deps = await res.json();
  } catch (err) {
    throw new CouldNotLook(`the Deployments of ${environment} @ ${sha7} came back as something other than JSON (${err.message})`);
  }
  if (!Array.isArray(deps)) {
    throw new CouldNotLook(`the Deployments of ${environment} @ ${sha7} came back without a list, so "none exists" cannot be concluded from them`);
  }
  return deps;
}

// Named `ghJson` rather than `gh` because the manual-deploys block below
// declares its own local `gh`; two helpers with one name in one file is how a
// later edit ends up calling the wrong one.
// ⏱ 2026-09-21 — attempted up to READ_ATTEMPTS times on the shared bounded plan
// (tooling/ops/bounded-retry.mjs). Un-retried until today, so one dropped TCP
// connection anywhere in a multi-page provenance walk discarded every read before
// it — row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep clause. The exit code is
// unmoved: a read that outlives the plan is still COULD NOT LOOK, still exit 2.
//
// 🔴 429 IS RE-ASKED HERE AND THAT IS DELIBERATE. record-deployment.mjs's own
// `isRetryable` EXCLUDES 429 because GitHub's secondary rate limit wants a longer
// wait than a deploy step can spend; this is a READER on ops-watch, where a
// `Retry-After` the API supplies is honoured (clamped) and a persistent 429 still
// ends as COVERAGE LOST rather than a pass.
//
// ⏱ 2026-09-23 — split in two. `ghRead` is the one request: a transient status
// is re-asked on the shared plan, and any OTHER status comes back as an ANSWER,
// `{ status, body }`, for the caller to grade — because the point read below
// must tell "this commit does not exist" (404, a finding) from "I was refused"
// (403, COVERAGE LOST), and a helper that turns every non-2xx into one verdict
// cannot. `ghJson` keeps its old contract on top of it: 2xx or CouldNotLook.
const ghRead = async (repo, token, path, what) =>
  readWithBoundedRetry(async (_attempt, { signal }) => {
    const base = githubBase();
    let res;
    try {
      res = await fetch(`${base}/repos/${repo}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'nikatru-prod-provenance' },
        signal,
      });
    } catch (e) {
      throw classifyThrown(e, `the GitHub API did not answer ${what} (${e?.name ?? 'error'}: ${e?.message ?? e})`);
    }
    if (isTransientStatus(res.status)) {
      throw transientLook(`the GitHub API returned ${res.status} ${what}`, { retryAfterMs: retryAfterMs(res) });
    }
    if (!res.ok) return { status: res.status, body: null };
    try {
      return { status: res.status, body: await res.json() };
    } catch (e) {
      throw classifyThrown(e, `the GitHub API response ${what} was not JSON (${e.message})`);
    }
  });

const ghJson = async (repo, token, path, what) => {
  const { status, body } = await ghRead(repo, token, path, what);
  if (status < 200 || status > 299) throw new CouldNotLook(`the GitHub API returned ${status} ${what}`);
  return body;
};

function githubCredentials() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || gitRemoteRepo();
  if (!token) throw new CouldNotLook('neither GITHUB_TOKEN nor GH_TOKEN is set, so the released-build set cannot be derived');
  if (!repo) throw new CouldNotLook('the repository could not be resolved (GITHUB_REPOSITORY unset and no origin remote)');
  return { token, repo };
}

/** The origin both GitHub reads are built on. ⏱ 2026-09-24 (row
 *  O-OPS-READER-NO-CEILING): until today both hard-coded `https://api.github.com`,
 *  so no test reached them with a server that accepts and never answers. Resolved
 *  once, by `githubApiBase`: unset or the real origin (what Actions sets) is
 *  GitHub; a loopback `http:` URL is the test seam and says so on one line; any
 *  other host is refused as COULD NOT LOOK before a request carries the token. */
let resolvedGithubBase = null;
function githubBase() {
  if (resolvedGithubBase === null) {
    const { base, override, error } = githubApiBase();
    if (error) throw new CouldNotLook(error);
    if (override) console.log(`⬜ GITHUB_API_URL override in effect: ${base} — a LOOPBACK TEST SEAM, not GitHub.`);
    resolvedGithubBase = base;
  }
  return resolvedGithubBase;
}

/**
 * ONE PAGED GITHUB LISTING, READ WHOLE OR REFUSED. `fetchPage(page)` answers
 * `{ rows, totalCount }` — `totalCount` being the endpoint's OWN claim about
 * how many rows it holds, or absent where the endpoint makes no claim — and
 * `idOf(row)` is the row's stable identity. Returns the rows de-duplicated by
 * that identity, in the order first served.
 *
 * 🔴 THE DEFECT THIS REPLACES, found 2026-09-22. Both walkers below were
 * `out.push(...rows); if (rows.length < 100) break;`, which is three separate
 * ways to read less than there is and return it as a complete read:
 *
 *   · NO DE-DUPLICATION. Each page is a fresh snapshot. A run completing
 *     between page 1 and page 2 shifts every later row one place down, so
 *     page 2 re-serves a row page 1 already gave — and the row pushed past the
 *     window is never served at all. The duplicate MASKED the loss: the total
 *     length still looked right.
 *   · THE API'S OWN COUNT WAS NEVER ASKED FOR. The workflow-runs endpoint
 *     answers in an envelope carrying `total_count`. Nothing compared it to
 *     what actually arrived, so a short page — the shape a truncated or
 *     throttled read takes — ended the walk as a clean, silent break.
 *   · THE PAGE CAP WAS SILENT. Ten pages all full means "there is more and I
 *     stopped asking", which is COVERAGE LOST. It returned 1000 rows instead
 *     and said nothing.
 *
 * Every refusal here is `CouldNotLook` — exit 2, never 0 and never 1 — because
 * this reader's whole contract is that "I could not look" must not read as
 * "I looked and it was fine".
 *
 * ZERO ROWS IS NOT A REFUSAL, and must never be made into one. `/deployments`
 * answers `[]` for an environment served by Cloudflare Pages, because a Pages
 * deploy is not a GitHub Deployment; the canonical record there is Cloudflare's
 * own `canonical_deployment`. An empty answer is a TRUE reading of the GitHub
 * ledger and stays a clean pass.
 *
 * ⏱ 2026-09-23 · A WALK IS COMPLETE ONLY WHEN IT IS INTERNALLY CONSISTENT
 * (row O-PROVENANCE-MIN-CLAIM-PASSES-UNSTABLE-WALK). The 2026-09-22 version
 * kept the SMALLEST `total_count` any page claimed and refused only when fewer
 * distinct rows arrived than that. Ops watch run 35843108090 (09:28Z) printed
 *     walk · listing runs of deploy-web.yml: total_count 384 · fetched 439 · distinct 384 · 5 page(s)
 * and PASSED it: 55 of the 439 rows served were repeats, so 55 real runs were
 * never served, and the reader went red on 42 real rows from runs 365-428
 * instead of saying it could not look. The trial that motivated the check —
 * `total_count=222 fetched=425 distinct=337` — passed it as well (337 ≥ 222).
 * "Distinct ≥ the smallest claim" cannot tell a shifted listing from a whole one.
 *
 * So one walk from page 1 is accepted only when ALL THREE hold:
 *   · every page made the SAME claim (a claim that moved means the listing
 *     changed under the walk, and pages cut from two lists are not one list);
 *   · no row was served twice (a repeat is a row some other row was pushed off
 *     the page for — the one never served);
 *   · as many distinct rows arrived as were claimed, where a claim was made.
 * An inconsistent walk is walked AGAIN FROM PAGE 1, up to WALK_ATTEMPTS times,
 * pausing on the shared backoffPlan at WALK_PAUSE_MS. Growth is not special-
 * cased: a run completing mid-walk makes one inconsistent walk, and the next
 * walk reads the settled list whole. A walk that never comes back consistent is
 * COVERAGE LOST (exit 2), naming every attempt's claim, fetched and distinct.
 * The page-cap refusal is unchanged and is NOT re-walked: a listing bigger than
 * the window stays bigger on a second read.
 *
 * ⚠️ WALK_ATTEMPTS IS NOT A TRANSIENT RETRY, AND IT IS NOT A RIVAL OF
 * bounded-retry.mjs. Every page read inside a walk already goes through the
 * shared plan (ghRead). This loop re-asks a question whose answers all
 * SUCCEEDED and contradicted each other — the same class as post-deploy-smoke's
 * propagation poll, which ops-bounded-retry.test.mjs exempts by name in
 * NOT_A_TRANSIENT_RETRY. ⏱ 2026-09-26: that census's NO RIVAL LOOP pattern is
 * now every `const <X>_ATTEMPTS =`, so it sees this loop, and WALK_ATTEMPTS is
 * registered there by file AND constant, with this reason; a second private
 * attempt count in this file is still a rival.
 * The gaps come from backoffPlan itself, so there is no second backoff formula.
 */
/** Every walk this process made, one entry PER ATTEMPT, in order: what the API
 *  claimed, rows fetched, distinct rows kept, pages read, and whether the walk
 *  was consistent. Printed in the summary on every run, and on COULD NOT LOOK. */
const WALKS = [];

/** How many times one listing is walked from page 1 before an inconsistent
 *  answer is COVERAGE LOST, and the base of the pause between walks. Named once,
 *  here. 3 walks of deploy-web's 5 pages took ~22 s each on 2026-09-23 10:46Z;
 *  with the 2 s + 4 s pauses that is ~72 s, inside the job's 10-minute ceiling. */
const WALK_ATTEMPTS = 3;
const WALK_PAUSE_MS = 2000;
const nap = (ms) => new Promise((done) => setTimeout(done, ms));

/** The page-cap refusal, as its own class so that `collectWindowed` can tell
 *  "this window holds more than the cap reaches" (split it) from every other
 *  COULD NOT LOOK (re-thrown untouched). It IS a CouldNotLook: anything that does
 *  not catch it by name still exits 2 with the message it always had. */
class WalkTruncated extends CouldNotLook {}

/** One walk's line, the SAME text in the summary and on COULD NOT LOOK. */
function formatWalk(w) {
  const claim = w.claims?.length ? w.claims.join(' → ') : 'not given';
  return (
    `walk · ${w.what}: total_count ${claim} · fetched ${w.fetched} · distinct ${w.distinct} · ${w.pages} page(s) · ` +
    `attempt ${w.attempt}/${w.attempts} · ${w.consistent ? 'consistent' : `INCONSISTENT — ${w.why}`}`
  );
}

async function collectPaged({
  fetchPage,
  idOf,
  what,
  perPage = 100,
  pageCap = 10,
  log = WALKS,
  attempts = WALK_ATTEMPTS,
  pauseMs = WALK_PAUSE_MS,
  sleep = nap,
}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new CouldNotLook(`${what}: ${attempts} walk attempt(s) is no walk at all`);
  const gaps = backoffPlan(attempts, pauseMs);

  /** ONE walk from page 1. Throws only for a page that is not rows at all. */
  const walkOnce = async (attempt) => {
    const byId = new Map();
    const claims = [];
    let pagesRead = 0;
    let lastPageLength = 0;
    let fetched = 0;
    for (let page = 1; page <= pageCap; page++) {
      const { rows, totalCount = null } = await fetchPage(page, { attempt });
      if (!Array.isArray(rows)) throw new CouldNotLook(`${what}: a page of the listing was not an array of rows`);
      pagesRead = page;
      lastPageLength = rows.length;
      fetched += rows.length;
      // EVERY distinct claim, in the order served — never the smallest one.
      if (typeof totalCount === 'number' && Number.isFinite(totalCount) && !claims.includes(totalCount)) claims.push(totalCount);
      for (const row of rows) {
        const id = idOf(row);
        if (!byId.has(id)) byId.set(id, row);
      }
      if (rows.length < perPage) break;
    }
    const distinct = byId.size;
    const faults = [];
    if (claims.length > 1) {
      faults.push(`the pages claimed ${claims.length} different totals (${claims.join(', ')}), so the listing changed while it was read`);
    }
    if (fetched !== distinct) {
      faults.push(
        `${fetched - distinct} row(s) were served twice (fetched ${fetched}, distinct ${distinct}) — each repeat stands where a row ` +
          'that was never served should have been',
      );
    }
    // Capped by what the cap could physically reach, so a listing far larger than
    // the window refuses for TRUNCATION below and not for arithmetic here.
    if (claims.length === 1 && distinct !== Math.min(claims[0], pageCap * perPage)) {
      faults.push(`the GitHub API said it had ${claims[0]} row(s) and served ${distinct} distinct one(s)`);
    }
    const entry = {
      what,
      attempt,
      attempts,
      claimed: claims.length === 1 ? claims[0] : null,
      claims,
      fetched,
      distinct,
      pages: pagesRead,
      consistent: faults.length === 0,
      why: faults.length ? faults.join('; ') : null,
    };
    // Recorded BEFORE any refusal, so a walk that refuses still leaves its numbers
    // behind. The row that asked for this (O-PROVENANCE-WALK-HAS-NO-COMPLETENESS-CHECK)
    // wants the next false red read back as a COUNT, not as a verdict.
    log.push(entry);
    return { entry, rows: [...byId.values()], truncated: pagesRead === pageCap && lastPageLength === perPage };
  };

  const tried = [];
  for (let i = 0; i < attempts; i++) {
    const { entry, rows, truncated } = await walkOnce(i + 1);
    if (truncated) {
      throw new WalkTruncated(
        `${what}: all ${pageCap} pages of ${perPage} came back full, so rows exist that this reader never asked ` +
          'for — a walk that stopped at its own cap is COVERAGE LOST, not a complete read',
      );
    }
    if (entry.consistent) return rows;
    tried.push(entry);
    if (i < gaps.length) await sleep(gaps[i]);
  }
  throw new CouldNotLook(
    `${what}: ${attempts} walk(s) from page 1 and not one was internally consistent — ` +
      tried
        .map(
          (w) =>
            `attempt ${w.attempt}: total_count ${w.claims.length ? w.claims.join(' → ') : 'not given'}, fetched ${w.fetched}, ` +
            `distinct ${w.distinct}, ${w.pages} page(s) — ${w.why}`,
        )
        .join('; ') +
      '. Rows a listing claims and did not serve are rows this reader cannot see, so this is COVERAGE LOST, not a complete read',
  );
}

/**
 * ONE LISTING READ WHOLE ACROSS `created` DATE WINDOWS, each read by
 * `collectPaged` with every check above intact.
 *
 * 🔴 WHY, ⏱ 2026-09-26. Ops watch #536 (run 36214720117) went exit 2:
 *     ✗ COULD NOT LOOK — listing runs of ci.yml (branch=main&event=push): all 10 pages of 100 came back full …
 * main crossed 1,000 completed push runs of ci.yml that night. GitHub's
 * list-workflow-runs endpoint serves AT MOST 1,000 results for a filtered
 * query — page 11 answers `total_count 0` and no rows, and `total_count`
 * itself is capped at 1,000 (both measured 2026-09-26 03:33Z) — so raising
 * `pageCap` could never have read the rest: the rows beyond 1,000 are not
 * reachable through one listing at all.
 *
 * THE WALK, newest first. `edge` is the day on and after which every run has
 * been read (none, at the start). Each step:
 *   1. asks the API how many runs are OLDER than `edge` — a query with NO LOWER
 *      BOUND (`created=<=edge-1`, or no `created` at all on the first step), one
 *      row a page, read only for its `total_count`;
 *   2. if that count is under the cap, reads that whole remainder through
 *      `collectPaged` — consistent, de-duplicated, as many distinct rows as
 *      claimed — and the walk ENDS. A remainder that still comes back full (the
 *      count under-claimed) is treated as over the cap, never as read;
 *   3. otherwise reads the next `windowDays`-day window below `edge` (the first
 *      one open above, `created=>=…`, so a run created while the walk runs, or
 *      on a clock ahead of this one, is not cut off) and moves `edge` down.
 * A window that is itself truncated is split in half, newer half first, down to
 * ONE DAY; a one-day window that is still full is COULD NOT LOOK, naming it.
 *
 * 🔴 THE START OF THE WALK IS NOT A GUESSED FLOOR. It ends only on a complete,
 * internally consistent read of EVERYTHING older than its oldest window, by a
 * query that has no lower bound. So a run from any date — before any quiet gap,
 * any number of empty weeks — is still read; "two empty windows in a row" would
 * have dropped every run before a fortnight's pause, and a recorded floor would
 * have dropped every run before it. A step cap exists only so a misbehaving API
 * cannot walk this forever, and reaching it is COULD NOT LOOK.
 *
 * `created` is immutable, so windows never shift under a walk the way page
 * offsets do; the union is still de-duplicated by `idOf`. With no window needed
 * (under 1,000 runs) the one read is the old whole listing, plus one count.
 */
const WINDOW_DAYS = 7;
const WINDOW_STEP_CAP = 530;
const DAY_MS = 86_400_000;
const isoDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The GitHub search-syntax `created` value of a window of whole UTC days, or
 *  null for no `created` filter at all. `from`/`to` null = open that side. */
function createdQualifier({ from, to }) {
  if (from === null && to === null) return null;
  if (from === null) return `<=${isoDay(to)}`;
  if (to === null) return `>=${isoDay(from)}`;
  return `${isoDay(from)}..${isoDay(to)}`;
}

async function collectWindowed({
  fetchPage,
  idOf,
  what,
  today = new Date(),
  windowDays = WINDOW_DAYS,
  stepCap = WINDOW_STEP_CAP,
  perPage = 100,
  pageCap = 10,
  log = WALKS,
  attempts,
  pauseMs,
  sleep,
}) {
  const cap = perPage * pageCap;
  const todayDay = Math.floor(today.getTime() / DAY_MS);
  const byId = new Map();
  const keep = (rows) => {
    for (const row of rows) {
      const id = idOf(row);
      if (!byId.has(id)) byId.set(id, row);
    }
  };
  const labelOf = (w) => {
    const q = createdQualifier(w);
    return q === null ? what : `${what} · created ${q}`;
  };
  const paged = (w) =>
    collectPaged({
      what: labelOf(w),
      idOf,
      perPage,
      pageCap,
      log,
      attempts,
      pauseMs,
      sleep,
      fetchPage: (page, { attempt } = { attempt: 1 }) => fetchPage({ created: createdQualifier(w), page, perPage, attempt }),
    });

  const readWindow = async (w) => {
    try {
      keep(await paged(w));
    } catch (e) {
      if (!(e instanceof WalkTruncated)) throw e;
      const days = (w.to ?? todayDay) - w.from + 1;
      if (days <= 1) {
        throw new CouldNotLook(
          `${e.message} — and the window created ${createdQualifier(w)} is ONE DAY wide, so it cannot be split any further`,
        );
      }
      const mid = w.from + Math.floor(days / 2);
      await readWindow({ from: mid, to: w.to });
      await readWindow({ from: w.from, to: mid - 1 });
    }
  };

  let edge = null;
  for (let step = 0; step < stepCap; step++) {
    const rest = { from: null, to: edge === null ? null : edge - 1 };
    const probe = await fetchPage({ created: createdQualifier(rest), page: 1, perPage: 1, attempt: 1 });
    const claim = probe?.totalCount;
    if (typeof claim === 'number' && Number.isFinite(claim) && claim < cap) {
      try {
        keep(await paged(rest));
        return [...byId.values()];
      } catch (e) {
        if (!(e instanceof WalkTruncated)) throw e;
      }
    }
    const from = (edge ?? todayDay + 1) - windowDays;
    await readWindow({ from, to: edge === null ? null : edge - 1 });
    edge = from;
  }
  throw new CouldNotLook(
    `${what}: ${stepCap} windows of ${windowDays} day(s) back from ${isoDay(todayDay)} and the API still claims ${cap} or more ` +
      'older rows — a walk that stopped at its own step cap is COVERAGE LOST, not a complete read',
  );
}

/** The floor every LIVE run must stand on, whether it came from a walk or from a
 *  point read — ⏱ 2026-09-23 extracted from githubRuns so that a walked run and
 *  a point-read run are floored by this one function. */
function floorRuns(runs, workflowFile, { requireConclusion = true } = {}) {
  // A run with no `conclusion` would silently take the resolver's benefit-of-
  // the-doubt default below, which is the one direction that weakens without
  // announcing itself. Live data always carries one; a shape change must be
  // "could not look", never "looked and it was fine".
  // ⏱ 2026-09-23 — EXCEPT on the store-capture listing, which reads every
  // status on purpose: an in-progress capture has no conclusion yet, and its
  // rows must not red ops-watch while it runs. That witness is existence, not
  // success, so the conclusion floor is skipped there and ONLY there.
  for (const r of runs) {
    if (requireConclusion && typeof r?.conclusion !== 'string') {
      throw new CouldNotLook(
        `run ${r?.run_number ?? '?'} of ${workflowFile} carries no \`conclusion\`, so this reader cannot tell a ` +
          'successful lane run from a failed one and would treat both as released',
      );
    }
    // Without an id there is nothing to tell two runs apart from ONE run
    // served twice, which is the whole basis of the de-duplication above.
    // ⏱ 2026-09-23 — and it is the id a submission Deployment's payload
    // must name for footing (c), so this one floor serves both.
    if (typeof r.id !== 'number' && typeof r.id !== 'string') {
      throw new CouldNotLook(
        `run ${r?.run_number ?? '?'} of ${workflowFile} carries no \`id\`, so this reader cannot tell two runs ` +
          'apart from one run served twice across pages',
      );
    }
  }
  return runs;
}

/** EVERY COMPLETED RUN of a served release lane, not only the successful ones —
 *  a run that failed after its deploy step succeeded is the case witness (b)
 *  exists for, and filtering it out here would put it beyond reach.
 *  ⏱ 2026-09-23 — `{ status: null }` lists runs of EVERY status (the
 *  store-capture witness); the default keeps every release-lane call as it was. */
async function githubRuns(workflowFile, { status = 'completed', filter = '' } = {}) {
  const { token, repo } = githubCredentials();
  const what =
    (status === 'completed' ? `listing runs of ${workflowFile}` : `listing ${status ?? 'all'} runs of ${workflowFile}`) +
    (filter ? ` (${filter})` : '');
  // ⏱ 2026-09-26 — walked in `created` windows (collectWindowed), because one
  // filtered listing never serves more than 1,000 runs.
  return collectWindowed({
    what,
    idOf: (r) => r.id,
    fetchPage: async ({ created, page, perPage }) => {
      const body = await ghJson(
        repo,
        token,
        `/actions/workflows/${workflowFile}/runs?${filter ? `${filter}&` : ''}${created ? `created=${encodeURIComponent(created)}&` : ''}` +
          `${status ? `status=${status}&` : ''}per_page=${perPage}&page=${page}`,
        created ? `${what} · created ${created}` : what,
      );
      const runs = body?.workflow_runs;
      if (!Array.isArray(runs)) throw new CouldNotLook(`the GitHub API response for ${workflowFile} carried no workflow_runs array`);
      floorRuns(runs, workflowFile, { requireConclusion: status === 'completed' });
      // `total_count` is this endpoint's own claim about how many completed
      // runs it holds. Handing it over is what turns a short read into a
      // refusal instead of a silent, confident undercount.
      return { rows: runs, totalCount: body?.total_count };
    },
  });
}

/** Every GitHub Deployment on the given environments — the ledger
 *  tooling/ci/record-deployment.mjs writes, and the second witness. ⏱ 2026-09-23:
 *  returns deploymentRecord()s rather than a Set of shas, because footing (c)
 *  needs each record's environment, id and payload; main() still derives the
 *  served-ledger sha set from them. */
async function githubDeployments(environments) {
  const { token, repo } = githubCredentials();
  const records = [];
  for (const environment of environments) {
    const what = `listing deployments of ${environment}`;
    const deployments = await collectPaged({
      what,
      idOf: (d) => d.id,
      fetchPage: async (page) => {
        const body = await ghJson(
          repo,
          token,
          `/deployments?environment=${encodeURIComponent(environment)}&per_page=100&page=${page}`,
          what,
        );
        if (!Array.isArray(body)) throw new CouldNotLook(`the GitHub API response listing deployments of ${environment} was not an array`);
        for (const d of body) {
          if (typeof d?.id !== 'number' && typeof d?.id !== 'string') {
            throw new CouldNotLook(
              `a deployment of ${environment} carries no \`id\`, so this reader cannot tell two deployments apart ` +
                'from one deployment served twice across pages',
            );
          }
        }
        // 🔴 NO `totalCount` HERE, AND THAT IS NOT AN OVERSIGHT. `/deployments`
        // answers with a BARE ARRAY — no envelope, no `total_count`, nothing
        // that states how many rows exist; the `Array.isArray(body)` check
        // above IS that shape. There is no claim to compare a count against,
        // so this walker gets the de-duplication and the page-cap refusal and
        // structurally cannot get the third check. Inventing a claim — say,
        // asserting that rows must exist — would break the Cloudflare Pages
        // case, where `[]` is the true and expected answer.
        return { rows: body };
      },
    });
    for (const d of deployments) if (typeof d?.sha === 'string') records.push(deploymentRecord(d, environment));
  }
  return records;
}

function gitRemoteRepo() {
  const cfg = join(ROOT, '.git', 'config');
  if (!existsSync(cfg)) return null;
  const m = readFileSync(cfg, 'utf8').match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\s*$/m);
  return m ? m[1] : null;
}

/** The shape a shipped build stamps: `<line>.<run_number>+<sha7>`. ONE pattern,
 *  read by the resolver, the manual-deploys register and the point reads below. */
const BUILD_VERSION = /^(\d+)\.(\d+)\.(\d+)\+([0-9a-fA-F]{7,40})$/;

/**
 * `1.0.101+e138f5b` → resolvable iff the line and the run number and the sha all
 * line up, AND that run either SUCCEEDED or left a GitHub Deployment behind.
 *
 * `deployedShas` is the deployment ledger (witness (b) in the header); pass
 * `null` where it cannot be read, and only successful runs resolve. `onWitness`
 * is called once per build that resolved on (b) alone, so an acceptance that
 * rests on the weaker footing PRINTS instead of passing silently — the same
 * discipline the manual-deploys register follows.
 *
 * A run entry with no `conclusion` is read as successful: that is the shape of
 * every historic `--runs-file` fixture, and live runs are floored above so the
 * default can never be reached from real data.
 *
 * ⏱ 2026-09-23 — THE OPTIONS OBJECT, AND THREE FOOTINGS. `lanes` is
 * releaseLanes(); `deployments` is the deploymentRecord() list; `deployedShas`
 * is the served-ledger sha set above; `onWitness` receives `{footing, note}`.
 * Each run carries `workflow` (its lane's basename) or `kind: 'attested'`; a
 * run whose workflow names no lane is judged on the served footing, which is
 * what every older fixture was written against.
 *   served     — the rule above, unchanged, and its messages unchanged.
 *   attested   — a manual-deploys.json entry: its two witnesses were checked
 *                in main(), so only the sha is compared here.
 *   submission — footing (c): a Deployment on this lane's environments at this
 *                full head whose payload names this run (`payload.run_id` is
 *                the run's id and `payload.workflow` the lane's workflow), or
 *                a payload-less one that `legacyBindings` binds to this run's
 *                id. The conclusion is not consulted and time plays no part:
 *                the payload is written from the run's own identity.
 *
 * `legacyBindings` is legacyDeploymentBindings(register): the dated list of
 * payload-less Deployments, each bound to exactly one run id.
 *
 * 🔴 RUN NUMBERS ARE PER WORKFLOW, SO ONE NUMBER CAN NAME SEVERAL RUNS. deploy-web
 * and submit-play both have a run 6. The map below keeps EVERY candidate and a
 * value resolves if any one of them passes; a last-wins map would let whichever
 * lane was listed last decide, and refuse a build another lane really shipped.
 * When all refuse, every reason is reported, joined by ` · `.
 */
function makeReleasedBuildResolver(
  lines,
  runs,
  { lanes = null, deployments = null, deployedShas = null, legacyBindings = [], onWitness = () => {} } = {},
) {
  const byNumber = new Map();
  for (const r of runs) {
    const k = String(r.run_number);
    byNumber.set(k, [...(byNumber.get(k) ?? []), r]);
  }
  const laneOf = (r) =>
    r?.kind === 'attested'
      ? { kind: 'attested' }
      : (lanes?.find((l) => runWorkflowsOf(l).includes(r?.workflow)) ?? { kind: 'served', workflow: r?.workflow ?? null });
  // ⏱ 2026-09-25 [ADR 095 §4] — a run listed under the lane's CALLER (ci.yml
  // once deploy-web.yml is workflow_call-only) is named by that workflow in
  // every reason and acceptance, so "run 3850" is never ambiguous in the log.
  const viaHost = (run, lane) => typeof run?.workflow === 'string' && lane?.workflow !== undefined && run.workflow !== lane.workflow;

  const judgeServed = (run, lane, value, n, sha) => {
    const head = String(run.head_sha ?? '').toLowerCase();
    const via = viaHost(run, lane) ? `${run.workflow} ` : '';
    // The sha7 check is what keeps a run-number collision between the lane's own
    // runs and its host's from resolving on the wrong run.
    if (!head.startsWith(sha.toLowerCase())) return `${via}run ${n} shipped ${head.slice(0, 7)}, not ${sha}`;
    const conclusion = run.conclusion ?? 'success';
    const hostNote = () => {
      if (via) {
        onWitness({
          footing: 'host',
          note:
            `${value} — resolved in ${run.workflow} run ${n} at ${head.slice(0, 7)}, the run host of ${lane.workflow}` +
            (lane.host?.callJob ? ` (call job \`${lane.host.callJob}\`)` : ''),
        });
      }
      return null;
    };
    if (conclusion === 'success') return hostNote();
    if (deployedShas?.has(head)) {
      onWitness({
        footing: 'served',
        note:
          `${value} — ${via}run ${n} concluded \`${conclusion}\`, and a GitHub Deployment for ${head.slice(0, 7)} on a ` +
          'served environment witnesses that it shipped anyway (a deploy step that succeeded before a later step failed)',
      });
      return hostNote();
    }
    return (
      `${via}run ${n} concluded \`${conclusion}\` and NO GitHub Deployment names ${head.slice(0, 7)} on a served ` +
      'environment, so nothing witnesses that this build was ever published'
    );
  };

  const judgeAttested = (run, n, sha) => {
    const head = String(run.head_sha ?? '').toLowerCase();
    return head.startsWith(sha) ? null : `attested manual deploy ${n} shipped ${head.slice(0, 7)}, not ${sha}`;
  };

  // 🔴 BOUND BY RUN IDENTITY, NEVER BY TIME. Until this rework a Deployment
  // "created between the run's created_at and updated_at" bound it — and a dry
  // run at the same commit whose lifetime overlapped the upload's Deployment, or
  // a dry run re-run so its updated_at moved past it, resolved on the upload's
  // witness. A run id is unique to one run (a re-run attempt keeps the id, but a
  // dry run's attempts never wrote a Deployment to be named).
  // ⏱ 2026-09-25 [ADR 095 §4] — the payload's `workflow` binds when it is ANY of
  // the lane's run workflows: a callee lane's Deployment is recorded inside its
  // caller's run, whose GITHUB_WORKFLOW_REF names the caller. A lane that is not
  // a callee has one run workflow, so a payload naming any other is still refused.
  const judgeSubmission = (run, lane, value, n, sha) => {
    const head = String(run.head_sha ?? '').toLowerCase();
    const runWf = viaHost(run, lane) ? run.workflow : lane.workflow;
    const bindsTo = runWorkflowsOf(lane);
    if (!head.startsWith(sha)) return `${runWf} run ${n} shipped ${head.slice(0, 7)}, not ${sha}`;
    const runId = String(run.id);
    const onLane = (deployments ?? []).filter(
      (d) => d.environment !== null && lane.environments.includes(d.environment) && d.sha === head,
    );
    const bound = onLane.find((d) => d.payload !== null && String(d.payload.run_id) === runId && bindsTo.includes(d.payload.workflow));
    if (bound) {
      onWitness({
        footing: 'submission',
        note:
          `${value} — ${runWf} run ${n} at ${head.slice(0, 7)}, Deployment ${bound.id ?? '?'} on ` +
          `${bound.environment} whose payload names run ${runId}`,
      });
      return null;
    }
    for (const d of onLane) {
      if (d.payload !== null) continue;
      const legacy = legacyBindings.find(
        (b) =>
          b.deploymentId === String(d.id) &&
          b.runId === runId &&
          bindsTo.includes(b.workflow) &&
          b.environment === d.environment &&
          b.sha === d.sha,
      );
      if (!legacy) continue;
      onWitness({
        footing: 'submission',
        note:
          `${value} — ${runWf} run ${n} at ${head.slice(0, 7)}, Deployment ${d.id} on ${d.environment} ` +
          `carries no payload and is bound to run ${runId} by legacyDeploymentBindings (measured ${legacy.measured})`,
      });
      return null;
    }
    return (
      `${runWf} run ${n} concluded \`${run.conclusion}\` but no Deployment on ${lane.environments.join(', ')} ` +
      `names run ${runId}; a dry run writes none, and a hand-written recovery Deployment must carry the run payload`
    );
  };

  return (value) => {
    if (typeof value !== 'string' || value.length === 0) return 'no app_version at all — the build defaults to `dev` only when APP_VERSION is unset, so an empty value is a row written by something that is not a build';
    const m = value.match(BUILD_VERSION);
    if (!m) return `\`${value}\` is not the shape a shipped build produces (<release_line>.<run_number>+<sha7>)`;
    const line = `${m[1]}.${m[2]}`;
    if (!lines.has(line)) return `release line ${line} is declared by no app in apps/*/pubspec.yaml`;
    const n = m[3];
    const sha = m[4].toLowerCase();
    const cands = byNumber.get(n) ?? [];
    if (cands.length === 0) return `no run numbered ${n} exists on any release lane`;
    const reasons = [];
    for (const run of cands) {
      const lane = laneOf(run);
      const why =
        lane.kind === 'attested'
          ? judgeAttested(run, n, sha)
          : lane.kind === 'submission'
            ? judgeSubmission(run, lane, value, n, sha)
            : judgeServed(run, lane, value, n, m[4]);
      if (why === null) return null;
      reasons.push(why);
    }
    return reasons.join(' · ');
  };
}

// ── POINT READS · CONFIRM BEFORE CONVICTING ─────────────────────────────────
//
// ⏱ 2026-09-23 (O-PROVENANCE-MIN-CLAIM-PASSES-UNSTABLE-WALK). A walk that reads
// as consistent is still a LISTING, and the listing is the one input this reader
// has been wrong about: on 2026-09-23 09:28Z it served 55 rows twice, and the
// reader went red on 42 real people's rows from builds it had simply not been
// shown. So before a `released-build` value is reported as untraceable it is
// looked up DIRECTLY, by the two facts the value itself carries:
//   GET commits/<sha7>                                   → the full sha, or "no such commit"
//   GET actions/workflows/<lane>/runs?head_sha=<full>…   → the completed runs AT that commit
// A run the point read finds joins the resolver's runs and is judged by exactly
// the same rules as a walked one — found is not the same as released — and it is
// PRINTED, because it means a walk that read as consistent missed it.
//
// Bounded: values are de-duplicated by app_version and at most POINT_READ_CAP of
// them are looked up; more than that is COVERAGE LOST, never a partial answer.
// Every read that does not answer 200 is COVERAGE LOST too — except 404/422 on
// the commit, which IS an answer ("not a commit on this repository"). A refused
// read is not a missing build.
const POINT_READ_CAP = 10;
/** Every point read this process made: `{value, found, reads, verdict}`. */
const POINT_READS = [];

async function pointReadBuild({ value, read, lanes }) {
  const m = value.match(BUILD_VERSION);
  if (!m) throw new CouldNotLook(`point read · ${value}: not the shape a shipped build produces, so there is nothing to look up`);
  const n = m[3];
  const sha7 = m[4].toLowerCase();
  const reads = [];
  const ask = async (path) => {
    let answer;
    try {
      answer = await read(path);
    } catch (e) {
      throw new CouldNotLook(`point read · ${value}: GET ${path}: ${e.message}`);
    }
    reads.push(`GET ${path} → ${answer.status}`);
    return answer;
  };
  const refused = (path, status) =>
    new CouldNotLook(
      `point read · ${value}: GET ${path} answered ${status} — a refused read is not a missing build, so this is ` +
        'COVERAGE LOST, not a verdict about the row',
    );

  const commitPath = `commits/${sha7}`;
  const commit = await ask(commitPath);
  if (commit.status === 404 || commit.status === 422) {
    return { value, found: null, reads, verdict: `${sha7} is not a commit on this repository` };
  }
  if (commit.status !== 200) throw refused(commitPath, commit.status);
  const full = String(commit.body?.sha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(full) || !full.startsWith(sha7)) {
    throw new CouldNotLook(`point read · ${value}: GET ${commitPath} answered 200 without a full sha that starts with ${sha7}`);
  }

  // Served lanes first: deploy-web is where nearly every stamped build ships.
  const ordered = [...lanes.filter((l) => l.kind === 'served'), ...lanes.filter((l) => l.kind !== 'served')];
  const atCommit = [];
  // ⏱ 2026-09-25 [ADR 095 §4] — each lane's run workflows in order: its own
  // file, then (for a callee lane) its caller's `branch=main&event=push` runs.
  // A hit needs the run number AND the full head_sha, so a same-numbered run of
  // the other workflow at another commit is never the one found.
  for (const lane of ordered) {
    for (const wf of runWorkflowsOf(lane)) {
      const filter = runFilterOf(lane, wf);
      const path = `actions/workflows/${wf}/runs?head_sha=${full}&${filter ? `${filter}&` : ''}status=completed&per_page=100`;
      const listing = await ask(path);
      if (listing.status !== 200) throw refused(path, listing.status);
      const runs = listing.body?.workflow_runs;
      if (!Array.isArray(runs)) throw new CouldNotLook(`point read · ${value}: GET ${path} carried no workflow_runs array`);
      floorRuns(runs, wf);
      const hit = runs.find((r) => String(r.run_number) === n && String(r.head_sha ?? '').toLowerCase() === full);
      if (hit) return { value, found: { ...hit, workflow: wf }, reads, verdict: null };
      // One commit with more than a page of completed runs on one lane is not a
      // shape this repository produces; if it ever does, the unread page could hold
      // the run, so it is COVERAGE LOST rather than "not found".
      if (typeof listing.body?.total_count === 'number' && listing.body.total_count > runs.length) {
        throw new CouldNotLook(
          `point read · ${value}: GET ${path} claimed ${listing.body.total_count} run(s) and served ${runs.length}, so the run ` +
            'this reader is looking for could be on a page it did not read',
        );
      }
      for (const r of runs) atCommit.push(`${wf} run ${r.run_number}`);
    }
  }
  return {
    value,
    found: null,
    reads,
    verdict:
      `commit ${sha7} exists, and no release lane has a completed run numbered ${n} at it` +
      (atCommit.length ? ` (the completed runs at it: ${atCommit.join(', ')})` : ''),
  };
}

/** The lines every walk attempt and every point read leave in the log — the
 *  SAME lines on a verdict and on COULD NOT LOOK, so the next surprise is read
 *  back as numbers. `made` is false for a fixture run with no --point-reads-file;
 *  `summary` is false on COULD NOT LOOK, where the lookups may never have begun. */
function lookupLines({ made = true, summary = true } = {}) {
  const out = WALKS.map((w) => `⬜  ${formatWalk(w)}`);
  for (const p of POINT_READS) {
    out.push(
      p.found
        ? `⬜  point read · ${p.value}: ${p.reads.join(' · ')} → FOUND ${p.found.workflow} run ${p.found.run_number} (${p.found.conclusion})`
        : `⬜  point read · ${p.value}: ${p.reads.join(' · ')} → not found — ${p.verdict}`,
    );
  }
  const found = POINT_READS.filter((p) => p.found);
  for (const p of found) {
    out.push(
      `⚠   point read found a build the walked runs did not include: ${p.value} — ${p.found.workflow} run ` +
        `${p.found.run_number} at ${String(p.found.head_sha).slice(0, 7)}; the listing was incomplete even though the walk ` +
        'that returned read as consistent',
    );
  }
  if (!summary) return out;
  out.push(
    made
      ? `⬜  point reads: ${POINT_READS.length} build(s) looked up, ${found.length} found, ${POINT_READS.length - found.length} not found` +
          (found.length ? ` — found: ${found.map((p) => p.value).join(', ')}` : '')
      : '⬜  point reads: NOT MADE — offline fixture mode without --point-reads-file, so no build was looked up directly',
  );
  return out;
}

// ── `e2e-run` · THE NIGHTLY'S OWN STAMP ─────────────────────────────────────
//
// `e2e-<run_number>-<sha7>` — the ONE string .github/workflows/e2e.yml derives
// into $GITHUB_ENV and passes as `--dart-define=APP_VERSION`. Born 2026-08-28,
// with the stamp itself: before that the nightly passed no APP_VERSION at all,
// AppConfig fell back to its compile-time `'dev'`, and six rows written by two
// crashed re-runs on 2026-08-27 turned this monitor red on 2026-08-28 carrying
// nothing that said who wrote them.
//
// 🔴 IT IS A SEPARATE RESOLVER BECAUSE `released-build` MUST NOT BE WIDENED.
// The cheap change was to let the shipped-build matcher accept anything with a
// `+` or a `-` in it. That is the EMPTY PREDICATE the register's own _readme was
// written against — it would admit `dev`-class junk forever, and the count would
// still print clean. This admits one shape and names it.
//
// ⚠️ SHAPE-ONLY, AND WEAKER THAN `released-build` — SAID HERE RATHER THAN LEFT
// TO BE DISCOVERED. `released-build` cross-checks the run number and the sha
// against GitHub's real run history; this does not, because e2e.yml is not a
// release lane and appears in no row of the channel register, so `githubRuns`
// never enumerates it. A row hand-posted in this shape to the public consent
// route would therefore resolve. What it CANNOT admit is the class this register
// exists for: `dev`, `c6-localprobe`, NULL, the empty string, a bare `e2e`, an
// upper-case or full-length sha, and every released-build string all fail it.
//
// ⚠️ AND THE FALSE NEGATIVE IS PAID FOR, NOT WAIVED. Accepting `e2e-*` means
// residue from a CRASHED nightly stops reddening this monitor — which is exactly
// the incident above, so the trade has to be made deliberately or not at all.
// It is made because tooling/e2e/purge.mjs now HARD-FAILS the moment it cannot
// identify the consent row it was asked to delete, so the nightly goes red at
// the moment of the failure, on the workflow that owns the residue, instead of
// this reader going red a day later on a different workflow with no idea what
// wrote the row. That is an earlier and better detector, not a lost one. And an
// acceptance here is PRINTED on every run — see `alsoAccepted` in main() — so
// the residue is still visible in this monitor's own log.
//
// 1-9 digits mirrors assert-app-versioning.mjs's MAX_RUN_DIGITS; 7 lower-case
// hex mirrors its SHA_LEN and `${GITHUB_SHA::7}`. Both halves are anchored, so
// the total can never exceed 4 + 9 + 1 + 7 = 21 characters — inside the 32 that
// services/platform/src/routes/events.ts binds with `str(body?.app_version, 32)`
// and above which a value is stored as NULL rather than truncated.
// ⏱ 2026-09-23 — E2E_RUN_SHAPE is imported from tooling/e2e/app-version-stamp.mjs
// (the same anchored shape), no longer declared here.

function e2eRunResolver(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'no app_version at all, so it is not the nightly e2e lane\'s stamp either';
  }
  return E2E_RUN_SHAPE.test(value)
    ? null
    : `\`${value}\` is not the shape .github/workflows/e2e.yml stamps (e2e-<run_number>-<sha7>)`;
}

// ── `store-capture` · A STORE CAPTURE'S OWN STAMP, WITNESSED ────────────────
//
// `cap-<run_number>-<sha7>` — derived by tooling/e2e/app-version-stamp.mjs
// `captureStamp` from the Actions default env inside a store-screenshots.yml
// run; the workflow sets nothing. Born 2026-09-23, after the Linux capture job
// wrote two `dev` consent rows to production (run 35818960378) that nothing
// could attribute.
//
// STRONGER THAN `e2e-run`: a value is accepted only when a store-screenshots.yml
// run with that exact number exists AND its head_sha starts with the sha7. That
// run may be of ANY status — an in-progress capture's rows must not red the
// ops-watch that happens to read during it, so the listing is all-status and
// its conclusion floor is off (see floorRuns).
//
// 🔴 THE CAPTURE RUN SET IS ITS OWN VARIABLE, NEVER MERGED INTO `runs`. A
// capture run must never lend its (number, sha) to `released-build`.
//
// ⚠️ THE FALSE NEGATIVE IS PAID FOR THE SAME WAY AS `e2e-run`: the capture
// job's always() purge deletes every drive's consent row by anon_id AND every
// row carrying the stamp, and hard-fails when a drive's id is unresolved. A
// `rehearsal-*` stamp (a local rehearsal) is deliberately unwitnessable here.
//
// An EMPTY run set refuses every value (fail-closed, like `erasure-step`).
function makeStoreCaptureResolver(captureRuns, onWitness = () => {}) {
  const set = Array.isArray(captureRuns) ? captureRuns : [];
  return (value) => {
    if (typeof value !== 'string' || value.length === 0) {
      return 'no app_version at all, so it is not a store capture\'s stamp either';
    }
    const m = value.match(STORE_CAPTURE_SHAPE);
    if (!m) return `\`${value}\` is not the shape ${CAPTURE_WORKFLOW} stamps (cap-<run_number>-<sha7>)`;
    const [, n, sha7] = m;
    const run = set.find(
      (r) => String(r?.run_number) === n && String(r?.head_sha ?? '').toLowerCase().startsWith(sha7),
    );
    if (!run) return `no ${CAPTURE_WORKFLOW} run ${n} at ${sha7}, so \`${value}\` is witnessed by nothing`;
    onWitness(`${value} ← ${CAPTURE_WORKFLOW} run ${n} (${run.status ?? '-'}/${run.conclusion ?? '-'})`);
    return null;
  };
}

// ── the other four resolvers ────────────────────────────────────────────────
function cronJobNames() {
  const src = join(ROOT, 'services', 'platform', 'src');
  if (!existsSync(src)) throw new CouldNotLook('services/platform/src does not exist, so the declared cron-job set is empty');
  let text = '';
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(e.name)) text += readFileSync(p, 'utf8');
    }
  };
  walk(src);
  const jobs = new Set([...text.matchAll(/export\s+const\s+\w*_JOB\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
  if (jobs.size === 0) {
    throw new CouldNotLook(
      'no `export const <NAME>_JOB` declaration was found in services/platform/src, so the allowed job set is EMPTY — ' +
        'every heartbeat row would read as unattributable and the red would be about the parse, not the data',
    );
  }
  return jobs;
}

/** ⏱ 2026-09-15 · [ADR 087] the non-app erasure steps services/platform/src declares
 *  as `export const <NAME>_STEP = '<literal>'` — the same shape-derived set as
 *  `cronJobNames`, for the `erasure-step` second resolver on `pending_erasures`. */
function erasureStepNames() {
  const src = join(ROOT, 'services', 'platform', 'src');
  if (!existsSync(src)) throw new CouldNotLook('services/platform/src does not exist, so the declared erasure-step set is empty');
  let text = '';
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|mjs)$/.test(e.name)) text += readFileSync(p, 'utf8');
    }
  };
  walk(src);
  return new Set([...text.matchAll(/export\s+const\s+\w*_STEP\s*=\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
}

function providerIds() {
  const reg = readJson(PROVIDERS_REL);
  const raw = reg.providers;
  const ids = new Set(
    Array.isArray(raw) ? raw.map((p) => p?.id ?? p?.provider ?? p).filter((x) => typeof x === 'string') : Object.keys(raw ?? {}),
  );
  if (ids.size === 0) throw new CouldNotLook(`${PROVIDERS_REL} declares zero providers, so every provider row would read as unattributable`);
  return ids;
}

// ── D1 ──────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 — `platformD1()` read the one binding carrying `migrations_dir`
// in services/platform/wrangler.jsonc. Each database is now an entry of
// `registeredD1Databases` (tooling/ci/migration-tables.mjs), which carries its
// id and its wrangler ledger (`migrationsTable`) the same way.

/** One D1 read against one walked database. A refusal names the database: a
 *  token whose D1 scope covers one database and not the other is exit 2 naming
 *  that database, which is the owner's cue to widen the token. */
async function queryDb(db, sql) {
  try {
    return await queryD1(db.id, sql);
  } catch (e) {
    if (e instanceof CouldNotLook) throw new CouldNotLook(`${db.name} (${db.binding}): ${e.message}`);
    throw e;
  }
}

async function queryD1(dbId, sql) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment');
  }
  // ⏱ 2026-09-21 — bounded retry, shared plan. A POST that is a READ: the D1 HTTP
  // API takes SELECTs by POST and re-sending one changes nothing, so the decision
  // is recorded at this call site rather than guessed from the verb.
  return readWithBoundedRetry(async (_attempt, { signal }) => {
    let res;
    try {
      res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`, {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
    } catch (e) {
      throw classifyThrown(e, `the D1 API did not answer (${e?.name ?? 'error'}: ${e?.message ?? e})`);
    }
    if (!res.ok) {
      const line = `the D1 API returned ${res.status}`;
      throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw classifyThrown(e, `the D1 API response was not JSON (${e.message})`);
    }
    if (body?.success !== true) throw new CouldNotLook(`the D1 API reported failure: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    const rows = body?.result?.[0]?.results;
    if (!Array.isArray(rows)) throw new CouldNotLook('the D1 API response carried no results array');
    return rows;
  });
}

// ── THE PENDING-MIGRATION PATH · ⏱ 2026-09-25 (see the header) ─────────────
/** How long a migration may wait for the deploy that applies it. */
export const PENDING_LIMIT_HOURS = 24;
/** The schema read, VERBATIM the shape D1's authorizer was measured to accept
 *  (a plain sqlite_master read — tooling/ci/d1-sql-inventory.mjs) and the one
 *  tooling/e2e/verify_purged.mjs already runs against live D1. */
export const SCHEMA_TABLES_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
/** A migration's ledger key. wrangler records the file name; the `.sql` is
 *  dropped on BOTH sides so a ledger that omits it cannot call every table
 *  pending — and a ledger naming none of the files is refused outright below. */
const migrationKey = (f) => String(f).replace(/\.sql$/i, '');
const isoZ = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** PURE. The names one schema read answered, or CouldNotLook for an answer
 *  that is not a list of named rows. */
function namesOf(rows, what) {
  if (!Array.isArray(rows)) throw new CouldNotLook(`${what} did not answer with a list of rows`);
  const names = new Set();
  for (const r of rows) {
    const n = typeof r === 'string' ? r : r?.name;
    if (typeof n !== 'string' || n.length === 0) throw new CouldNotLook(`a row of ${what} carries no \`name\` (${JSON.stringify(r)?.slice(0, 80)})`);
    names.add(n);
  }
  return names;
}

/** PURE. The `sqlite_master` read → the set of tables production has.
 *  CouldNotLook when it names no table, or not the migration ledger itself:
 *  either way "none recorded" would call every missing table pending. */
export function presentTablesFrom(rows, migrationsTable) {
  const present = namesOf(rows, 'the sqlite_master read');
  if (present.size === 0) throw new CouldNotLook('the sqlite_master read answered zero tables — a production database with none is a read that failed');
  if (!present.has(migrationsTable)) {
    throw new CouldNotLook(
      `production has no \`${migrationsTable}\` table, so which migrations ran cannot be read — and "none recorded" ` +
        'would call every missing table pending',
    );
  }
  return present;
}

/** PURE. The migration-ledger read → the set of applied migration keys.
 *  CouldNotLook when it is empty: a database that has tables and no recorded
 *  migration is a read this reader cannot believe, never "nothing applied". */
export function appliedMigrationsFrom(rows, migrationsTable) {
  const applied = namesOf(rows, `the \`${migrationsTable}\` read`);
  if (applied.size === 0) throw new CouldNotLook(`\`${migrationsTable}\` answered zero migrations from a database that has tables`);
  return new Set([...applied].map(migrationKey));
}

/** PURE. Every table the migrations create, against production:
 *  `present`, `pending` (absent, its migration NOT recorded) or `vanished`
 *  (absent, its migration recorded). CouldNotLook when the ledger names none of
 *  the files that create a table — a name format this reader does not expect
 *  would otherwise read as "nothing has been applied yet". */
export function classifyMigrationState(tables, schema) {
  const files = [...new Set([...tables.values()].map((t) => t.createdIn))];
  if (!files.some((f) => schema.applied.has(migrationKey(f)))) {
    throw new CouldNotLook(
      `the migration ledger names none of the ${files.length} migration file(s) that create a table ` +
        `(${[...schema.applied].slice(0, 3).join(', ') || 'nothing'} …), so its names are not the ones this reader expects`,
    );
  }
  const out = { present: [], pending: [], vanished: [] };
  for (const name of [...tables.keys()].sort()) {
    const file = tables.get(name).createdIn;
    if (schema.present.has(name)) out.present.push(name);
    else (schema.applied.has(migrationKey(file)) ? out.vanished : out.pending).push({ table: name, file });
  }
  return out;
}

/** `git -C <dir> …`, bounded. Never throws: callers read `status`, which is
 *  `null` when git did not finish. */
function runGit(dir, argv) {
  const r = spawnSync('git', ['-C', dir, ...argv], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr || (r.error?.message ?? '') };
}

/** When `rel` merged: `{ sha, mergedAt }` of the newest first-parent commit on
 *  HEAD that ADDED it — on this squash-merge repository, the merge. CouldNotLook
 *  on a shallow clone, a git that does not answer, or no such commit. */
export function migrationMerge(dir, rel, git = runGit) {
  const shallow = git(dir, ['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0) {
    throw new CouldNotLook(`\`git rev-parse --is-shallow-repository\` exited ${shallow.status ?? 'without a status'} in ${dir}, so when ${rel} merged cannot be read`);
  }
  if (shallow.stdout.trim() === 'true') {
    throw new CouldNotLook(
      `${dir} is a SHALLOW clone, so ${rel} looks added by the oldest commit it holds — a clock that restarts every ` +
        `checkout and never reaches ${PENDING_LIMIT_HOURS} h. The job running this reader must check out with \`fetch-depth: 0\``,
    );
  }
  const log = git(dir, ['log', '--first-parent', '-m', '--no-renames', '--diff-filter=A', '--format=%H%x09%cI', 'HEAD', '--', rel]);
  if (log.status !== 0) throw new CouldNotLook(`\`git log\` for ${rel} exited ${log.status ?? 'without a status'} (${log.stderr.trim().slice(0, 200)})`);
  const m = log.stdout.split('\n').find((l) => l.trim())?.match(/^([0-9a-f]{40})\t(\S+)$/);
  if (!m || !Number.isFinite(Date.parse(m[2]))) {
    throw new CouldNotLook(`no first-parent commit on HEAD in ${dir} adds ${rel}, so how long it has waited for its deploy cannot be said`);
  }
  return { sha: m[1], mergedAt: isoZ(Date.parse(m[2])) };
}

/** Does commit `descendant` contain commit `ancestor`? `true` / `false`, or
 *  `null` when git cannot say — a Deployment of a commit this clone never
 *  fetched. */
export function commitContains(dir, ancestor, descendant, git = runGit) {
  if (!/^[0-9a-f]{7,40}$/i.test(String(descendant))) return null;
  const r = git(dir, ['merge-base', '--is-ancestor', ancestor, descendant]);
  return r.status === 0 ? true : r.status === 1 ? false : null;
}

/** PURE. One pending migration's verdict: `{ overdue, line }`. `containing` is
 *  the owning Worker's Deployments at a commit that contains the merge.
 *  ⏱ 2026-09-26 — `worker` and `binding` name the database's owner and its
 *  binding (they were the literals `platform` and `PLATFORM_DB`). */
export function pendingMigrationVerdict({ table, file, merged, nowMs, containing = [], migrationsTable = 'd1_migrations', worker = 'platform', binding = 'PLATFORM_DB' }) {
  const mergedMs = Date.parse(merged?.mergedAt);
  if (!Number.isFinite(mergedMs)) throw new CouldNotLook(`${file} has no readable merge time, so how long \`${table}\` has waited cannot be said`);
  if (!Number.isFinite(nowMs)) throw new CouldNotLook(`the pending-migration path has no clock, so how long \`${table}\` has waited cannot be said`);
  const hours = ((nowMs - mergedMs) / 3_600_000).toFixed(1);
  const at = `merged ${isoZ(mergedMs)} in ${String(merged.sha ?? '?').slice(0, 7)}`;
  if (containing.length) {
    return {
      overdue: true,
      line:
        `${table}: absent from production and ${file} is not in \`${migrationsTable}\` (${at}, ${hours} h ago), yet ${containing.length} ` +
        `${worker} Deployment(s) at a commit containing it exist (${containing.map((d) => `${d.sha.slice(0, 7)}${d.id != null ? ` · Deployment ${d.id}` : ''}`).join(', ')}). ` +
        `deploy-workers applies ${binding} migrations before it deploys, so the applier has run this one — waiting will not bring the table`,
    };
  }
  if (Number(hours) >= PENDING_LIMIT_HOURS) {
    return {
      overdue: true,
      line: `${table}: ${file} is still not in \`${migrationsTable}\` ${hours} h after the merge that added it (${at}) — a migration may wait ${PENDING_LIMIT_HOURS} h for its deploy, not longer`,
    };
  }
  return { overdue: false, line: `⬜ not yet migrated: ${table} (${file}, merged ${isoZ(mergedMs)})` };
}

/** The GitHub Deployment environment a database's owning Worker records its
 *  deploys into: the ONE service environment whose `source` is the directory of
 *  that Worker's wrangler file. ⏱ 2026-09-26 — per database; it read the
 *  register's one `wrangler` until then. */
function serviceEnvironment(db) {
  const src = String(db.wrangler ?? '').split('/').slice(0, -1).join('/');
  const hits = (readJson(CHANNELS_REL).serviceEnvironments ?? []).filter((s) => s?.source === src && typeof s?.deploymentEnvironment === 'string');
  if (hits.length !== 1) {
    throw new CouldNotLook(`${CHANNELS_REL} declares ${hits.length} service environment(s) with source \`${src || '(none)'}\` — ${db.name}'s Deployment ledger needs exactly one`);
  }
  return hits[0].deploymentEnvironment;
}

/**
 * ⏱ 2026-09-15 · [ADR 087]. The census query for a table resolved by
 * `not-reserved-address`: each row is projected to `reserved` / `unreserved`
 * INSIDE D1 and only a count per bucket comes back.
 *
 * 🔴 THE ADDRESS NEVER LEAVES THE DATABASE, and that is the whole reason this is
 * a separate query rather than the generic `SELECT "<marker>" … GROUP BY`. The
 * generic shape returns every distinct marker VALUE — for `signups` that is every
 * email address, pulled onto a GitHub runner and printed in a violation line.
 *
 * Reserved for testing: RFC 2606 (example.com/.net/.org, .test, .example,
 * .invalid, .localhost) and RFC 6761 (the same names, as special-use). The domain
 * is everything after the first `@`, lower-cased.
 */
export function reservedAddressCensusSql(table, marker) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table) || !/^[a-z_][a-z0-9_]*$/.test(marker)) {
    throw new CouldNotLook(`refusing to build a census query over \`${table}\`.\`${marker}\`: not a plain identifier`);
  }
  const d = `substr(lower("${marker}"), instr("${marker}", '@') + 1)`;
  const reserved = [
    `${d} IN ('example.com', 'example.net', 'example.org', 'example', 'test', 'invalid', 'localhost')`,
    ...['example.com', 'example.net', 'example.org', 'example', 'test', 'invalid', 'localhost'].map((t) => `${d} LIKE '%.${t}'`),
  ].join(' OR ');
  return `SELECT CASE WHEN ${reserved} THEN 'reserved' ELSE 'unreserved' END AS marker, COUNT(*) AS n FROM "${table}" GROUP BY 1`;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  // ── `--emit-served-environments` · THE ONE WAY WITNESS (b)'s SUBJECT IS
  //    REACHABLE WITHOUT A GITHUB TOKEN ───────────────────────────────────────
  // `servedEnvironments()` is consulted on exactly one line — the live branch of
  // `deployedShas` — and that line sits BEHIND `githubRuns`, which needs a
  // credential. So every test of this file reached it never: its expansion was
  // unexercised and its `CouldNotLook` was an assertion no input could make
  // fail, which this repository's own rule calls worse than none. This flag is
  // the same `--emit` idiom assert-release-lane-generic.mjs, assert-app-
  // versioning.mjs and assert-catalog-reachable.mjs already use, and it exists
  // for the same reason they do: the reader that USES the fact and the reader
  // that is TESTED on it must be one function, or the test grades a copy.
  //
  // It runs before the migration read on purpose — the environment set has no
  // dependency on the schema, and a `--root` fixture written to exercise this
  // expansion should not first have to carry a valid migrations directory.
  if (args.includes('--emit-served-environments')) {
    for (const e of servedEnvironments()) console.log(e);
    process.exitCode = 0;
    return;
  }

  // ── `--emit-ledger-environments` · THE READ SIDE, REACHABLE FOR THE SAME
  //    REASON AND ON THE SAME TERMS ────────────────────────────────────────────
  // `ledgerEnvironments()` sits behind the same credential wall the emitter above
  // was built to get past, so without this flag RETIRED_ENVIRONMENTS would be a
  // list nothing grades — and a widening nothing grades is how a reader quietly
  // starts accepting a name it should not. Two flags rather than one because the
  // ASYMMETRY is the property: the emitted set must stay bound to what
  // deploy-web.yml records today, and this one must be a superset of it.
  if (args.includes('--emit-ledger-environments')) {
    for (const e of ledgerEnvironments()) console.log(e);
    process.exitCode = 0;
    return;
  }

  // ── `--emit-release-lanes` · ⏱ 2026-09-23 · FOOTING (c)'s LANES, REACHABLE
  //    WITHOUT A TOKEN ─────────────────────────────────────────────────────────
  // releaseLanes() is otherwise read only behind githubRuns. One line per lane:
  // `<workflow>\t<kind>\t<env,env,…>`. prod-provenance.test.mjs binds each
  // submission lane's printed environments to the `record-deployment.mjs <env>`
  // calls in that lane's workflow file, so this is the function the live read
  // uses, reached by a test.
  // ⏱ 2026-09-25 [ADR 095 §4] — a fourth column, `<run,workflows>`: where the
  // lane's runs are listed (a callee lane adds its caller). Never lenient: an
  // emit with no .github/workflows is COVERAGE LOST.
  if (args.includes('--emit-release-lanes')) {
    for (const l of releaseLanes()) console.log(`${l.workflow}\t${l.kind}\t${l.environments.join(',')}\t${l.runWorkflows.join(',')}`);
    process.exitCode = 0;
    return;
  }

  const register = readJson(REGISTER_REL);
  const legacyBindings = legacyDeploymentBindings(register);
  const registered = register.databases;
  if (registered === null || typeof registered !== 'object' || Array.isArray(registered) || Object.keys(registered).length === 0) {
    throw new CouldNotLook(`${REGISTER_REL} declares no \`databases\`, so no table in any database has a rule`);
  }

  // ── ⏱ 2026-09-26 · WHICH DATABASES — see the header ──────────────────────
  // Read, never listed: the platform register's Workers, each one's top-level
  // D1 bindings carrying `migrations_dir`. A database a Worker owns and the
  // register does not name is COVERAGE LOST — its tables would go unread and
  // the total would still print — and an entry no Worker owns is a finding.
  const derived = registeredD1Databases(ROOT);
  if (derived.problems.length) throw new CouldNotLook(`the D1 databases to walk could not be derived: ${derived.problems.join('; ')}`);
  const lock = databaseLock(derived.databases, registered);
  if (lock.unregistered.length) {
    throw new CouldNotLook(
      `COVERAGE LOST — ${lock.unregistered.length} database(s) a Worker in tooling/platform-register.json owns have NO entry in ${REGISTER_REL} \`databases\`: ` +
        `${lock.unregistered.join(', ')}. This reader would have walked ${derived.databases.length - lock.unregistered.length} of ${derived.databases.length} database(s) and printed a clean total.`,
    );
  }
  const registerViolations = [
    ...lock.stale.map((n) => `databases.${n}: no Worker in tooling/platform-register.json owns a database of that name, so these rules are applied to nothing`),
    ...lock.mismatched.map((m) => `databases.${m}`),
  ];

  // COVERAGE LOST is the gate's verdict, but the monitor must not sail past it:
  // a table with no rule is a table this reader would not query, and a silent
  // shorter list is the failure mode both limbs are written against.
  const dbs = derived.databases.map((db) => {
    const rules = registered[db.name]?.tables ?? {};
    const { tables, filesRead } = enumerateMigrationTables(join(ROOT, db.migrationsDir));
    if (filesRead === 0 || tables.size === 0) {
      throw new CouldNotLook(
        `${db.name}: ${filesRead} migration file(s) read and ${tables.size} table(s) enumerated under ${db.migrationsDir} — ` +
          'the schema could not be read, so "every table is clean" would range over nothing',
      );
    }
    const uncovered = [...tables.keys()].filter((t) => !Object.prototype.hasOwnProperty.call(rules, t));
    if (uncovered.length) {
      throw new CouldNotLook(
        `COVERAGE LOST — ${uncovered.length} table(s) the migrations create have NO rule in ${REGISTER_REL}: ` +
          `${uncovered.map((t) => `${db.name}.${t}`).join(', ')}. This reader would have queried ${Object.keys(rules).length} of ${tables.size} tables in ${db.name} and printed a clean total.`,
      );
    }
    // An `exempt` rule is an argument, not a waiver: no marker, and a reason
    // that names every column the migrations give the table.
    for (const [name, rule] of Object.entries(rules)) {
      const why = tables.has(name) ? exemptionProblem(name, rule, tables.get(name).columns) : null;
      if (why) registerViolations.push(`databases.${db.name}.tables: ${why}`);
    }
    return { ...db, rules, tables, filesRead };
  });

  const rowsFile = flag('--rows-file');
  const runsFile = flag('--runs-file');
  const deploymentsFile = flag('--deployments-file');
  const pointReadsFile = flag('--point-reads-file');
  // ⏱ 2026-09-23 — the store-capture witness set: `[{run_number, head_sha, status?, conclusion?}]`.
  const captureRunsFile = flag('--capture-runs-file');
  if (rowsFile || runsFile || deploymentsFile || pointReadsFile || captureRunsFile) {
    console.log(
      '!!  OFFLINE FIXTURE MODE — --rows-file/--runs-file/--deployments-file/--point-reads-file/--capture-runs-file is set. This must NEVER appear in a real ops-watch log.',
    );
  }
  // ⏱ 2026-09-25 — the pending-migration seams. Each one without `--rows-file`
  // would let a LIVE run judge real rows against a hand-written schema, clock,
  // history or ledger, so it is refused rather than honoured.
  const schemaFile = flag('--schema-file');
  const nowFlag = flag('--now');
  const historyFlag = flag('--history');
  const platformDeploymentsFile = flag('--platform-deployments-file');
  for (const [name, v] of [['--schema-file', schemaFile], ['--now', nowFlag], ['--history', historyFlag], ['--platform-deployments-file', platformDeploymentsFile]]) {
    if (v !== null && !rowsFile) {
      throw new CouldNotLook(`${name} is an offline fixture seam and this run has no --rows-file: a live run reads production's schema, the wall clock, this checkout's history and the real ledger`);
    }
  }

  // Resolver contexts. Each throws CouldNotLook rather than resolving nothing.
  //
  // ⏱ 2026-09-23 — every release lane, both kinds, is read in BOTH modes: live,
  // one walk per distinct workflow with each run tagged by it; fixture, each
  // entry placed on its lane by `path`/`workflow` (an entry naming neither is a
  // served-lane run, which is what every older fixture means), and an entry
  // naming a workflow that is no lane is refused rather than judged.
  //
  // ⏱ 2026-09-25 [ADR 095 §4] — "a workflow" here is a RUN workflow: a callee
  // lane is walked in its own file and in its caller's push-to-main runs, each
  // run tagged by the workflow it was listed under, and a fixture entry naming
  // the caller is placed on the callee's lane.
  const lanes = releaseLanes({ lenientWhenUnread: Boolean(runsFile) });
  const runHostsUnread = !existsSync(join(ROOT, WORKFLOW_DIR));
  const servedLane = lanes.find((l) => l.kind === 'served');
  const laneByWorkflow = new Map(lanes.flatMap((l) => l.runWorkflows.map((wf) => [wf, l])));
  const fixtureRuns = (arr) => {
    if (!Array.isArray(arr)) throw new CouldNotLook(`${runsFile} is not an array of runs`);
    return arr.map((r) => {
      const named = typeof r?.workflow === 'string' ? r.workflow : typeof r?.path === 'string' ? r.path.split('/').pop() : null;
      const workflow = named ?? servedLane.workflow;
      const lane = laneByWorkflow.get(workflow);
      if (!lane) throw new CouldNotLook(`fixture run ${r?.run_number ?? '?'} names workflow ${workflow}, which is no release lane in ${CHANNELS_REL}`);
      if (lane.kind === 'submission') requireRunId(r, workflow);
      return { ...r, workflow };
    });
  };
  const runs = runsFile
    ? fixtureRuns(JSON.parse(readFileSync(runsFile, 'utf8')))
    : (
        await Promise.all(
          [...laneByWorkflow.entries()].map(async ([wf, lane]) =>
            (await githubRuns(wf, { filter: runFilterOf(lane, wf) })).map((r) => ({ ...r, workflow: wf })),
          ),
        )
      ).flat();
  const lines = releaseLines();
  if (lines.size === 0) throw new CouldNotLook('no apps/*/pubspec.yaml declares a version, so no release line is known');
  if (runs.length === 0) throw new CouldNotLook('no completed run of any served release lane was found, so the released-build set is EMPTY');
  // Submission-lane runs must not stand in for an empty web lane: a read that
  // found none of deploy-web's runs is a read that failed, whatever else it found.
  const servedRuns = runs.filter((r) => laneByWorkflow.get(r.workflow)?.kind === 'served');
  if (servedRuns.length === 0) {
    throw new CouldNotLook(
      `no completed run of the served lane ${servedLane.workflow} was found (listed in ${servedLane.runWorkflows.join(', ')}), ` +
        'so the released-build set has no served footing',
    );
  }

  // ── witness (b): the GitHub Deployment ledger ─────────────────────────────
  // Read for real on a live run; from a fixture file in offline mode; and NEVER
  // fabricated. `null` — the state a fixture with no --deployments-file is in —
  // means "no second witness available", so only successful runs resolve, which
  // is exactly the behaviour every pre-existing fixture was written against.
  //
  // ⏱ 2026-09-23 — read as RECORDS, over the ledger environments AND every
  // submission lane's environments, because footing (c) needs each record's
  // environment, id and payload. `deployedShas` keeps its meaning: the shas
  // with a Deployment on a served (or retired served) environment. A bare sha
  // string in a fixture file is a served-ledger entry (`environment: null`); only
  // an object entry names an environment and can witness a submission.
  // Strictest wins here too (see releaseLanes): an environment a submission
  // lane owns never witnesses the served footing, even when its row is also
  // `served: true` — otherwise a failed deploy-web run could borrow a store
  // upload's Deployment at the same commit.
  const allSubmissionEnvs = new Set(lanes.filter((l) => l.kind === 'submission').flatMap((l) => l.environments));
  const ledger = new Set(ledgerEnvironments().filter((e) => !allSubmissionEnvs.has(e)));
  const submissionEnvs = [...allSubmissionEnvs];
  const fixtureDeployments = (arr) => {
    if (!Array.isArray(arr)) throw new CouldNotLook(`${deploymentsFile} is not an array of deployments`);
    return arr.map((d) =>
      typeof d === 'string'
        ? deploymentRecord({ sha: d }, null)
        : deploymentRecord(d, typeof d?.environment === 'string' ? d.environment : null),
    );
  };
  const deployments = deploymentsFile
    ? fixtureDeployments(JSON.parse(readFileSync(deploymentsFile, 'utf8')))
    : runsFile
      ? null
      : await githubDeployments([...ledger, ...submissionEnvs]);
  const deployedShas =
    deployments === null ? null : new Set(deployments.filter((d) => d.environment === null || ledger.has(d.environment)).map((d) => d.sha));
  // ⏱ 2026-09-23 — the store-capture witness: runs of EVERY status, in their own
  // variable and NEVER concatenated into `runs` (a capture run must not lend its
  // number and sha to `released-build`). The same `file : fixture ? inert : live`
  // form as `deployments` above: a fixture that names no capture runs gets an
  // EMPTY set, which refuses every cap value.
  const captureRuns = captureRunsFile
    ? JSON.parse(readFileSync(captureRunsFile, 'utf8'))
    : runsFile
      ? []
      : await githubRuns(CAPTURE_WORKFLOW, { status: null });
  if (!Array.isArray(captureRuns)) throw new CouldNotLook(`${captureRunsFile} is not an array of runs`);
  const witnessed = [];
  const submissionWitnessed = [];
  // ⏱ 2026-09-25 [ADR 095 §4] — a stamp resolved in a lane's CALLER's run.
  const hostResolved = [];
  const captureWitnessed = [];

  // ── attested manual deploys — tooling/ops/manual-deploys.json ─────────────
  // A deploy that shipped outside its lane is attributable ONLY through this
  // register, and an entry is accepted ONLY after two independent records
  // confirm it: the sha must be a real commit on this repository (GitHub API),
  // and a GitHub Deployment written by record-deployment.mjs must exist for
  // that sha + environment. Accepted entries PRINT on every run; an invalid
  // entry lands in `violations` — a bad attestation is worse than an
  // unattributed row. Born 2026-08-08: run numbers are never reissued, so a
  // manual restore that reuses a FAILED run's number is version-monotonic but
  // provenance-orphaned, and deleting real production rows to appease this
  // checker was the alternative nobody should ever take.
  const attested = [];
  const attViolations = [];
  // Fixture mode (--runs-file) cannot reach either witness, so the register is
  // SKIPPED there rather than half-validated — the fixture banner above already
  // makes that mode unmistakable in any log. Live runs always validate.
  if (!runsFile) {
    const regPath = join(ROOT, 'tooling/ops/manual-deploys.json');
    if (existsSync(regPath)) {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const ghRepo = process.env.GITHUB_REPOSITORY || gitRemoteRepo();
      const ghBase = githubBase();
      for (const d of reg.deploys ?? []) {
        const m = String(d.version ?? '').match(BUILD_VERSION);
        if (!m) { attViolations.push(`manual-deploys.json: \`${d.version}\` is not a shipped-build shape`); continue; }
        if (!String(d.sha ?? '').toLowerCase().startsWith(m[4].toLowerCase())) {
          attViolations.push(`manual-deploys.json: \`${d.version}\` build metadata does not match its own sha field`); continue;
        }
        // ⏱ 2026-09-21 — bounded retry (tooling/ops/bounded-retry.mjs). This helper
        // returns the RESPONSE, because its two callers below grade the status
        // themselves (a 404 here means "not a commit", which is an ANSWER). Only the
        // wire dropping, 429 and 5xx are re-asked; a persistent one still raises
        // CouldNotLook and is still exit 2.
        const gh = (path) =>
          fetchWithBoundedRetry(
            ({ signal }) =>
              fetch(`${ghBase}/repos/${ghRepo}${path}`, {
                headers: { Authorization: `Bearer ${ghToken}`, 'User-Agent': 'check-prod-provenance' },
                signal,
              }),
            { describe: (why) => `GET ${path}: ${why}` },
          );
        const sha7 = String(d.sha).slice(0, 7);
        const commit = await gh(`/commits/${d.sha}`);
        // ⏱ 2026-09-11 — a refused read throws CouldNotLook (exit 2); see attestationCommitRead.
        if (attestationCommitRead(commit.status, sha7) === 'not-a-commit') { attViolations.push(`manual-deploys.json: sha ${sha7} is not a commit on ${ghRepo} (HTTP ${commit.status})`); continue; }
        const depRes = await gh(`/deployments?environment=${encodeURIComponent(d.environment)}&sha=${d.sha}`);
        const deps = await attestationDeployments(depRes, d.environment, sha7);
        if (deps.length === 0) {
          attViolations.push(`manual-deploys.json: no GitHub Deployment exists for ${d.environment} @ ${sha7} — record-deployment.mjs never ran, so this attestation has no second witness`); continue;
        }
        // `conclusion: 'success'` is explicit rather than defaulted: the two
        // witnesses above ARE this entry's validation, so it must not be sent
        // back through the deployment-ledger check a second time.
        // ⏱ 2026-09-23 — tagged `kind: 'attested'`, so the resolver judges it on
        // its own footing instead of as whichever lane's run shares its number.
        attested.push({ run_number: Number(m[3]), head_sha: String(d.sha).toLowerCase(), conclusion: 'success', kind: 'attested' });
        console.log(`⬜  attested manual deploy accepted: ${d.version} (${d.environment}, ${d.deployedAt}) — commit and GitHub Deployment both verified`);
      }
    }
  }

  // ⏱ 2026-09-23 — built TWICE. First over the walked runs alone and SILENT, to
  // find the values a point read must look up (a probe must not print an
  // acceptance); then again over the walked runs plus whatever the point reads
  // found, recording, for the census proper. One function either way, so a
  // point-read run is judged by exactly the rules a walked run is.
  const buildReleased = (extra, onWitness) =>
    makeReleasedBuildResolver(lines, [...runs, ...attested, ...extra], { lanes, deployments, deployedShas, legacyBindings, onWitness });
  const recordWitness = ({ footing, note }) => {
    const into = footing === 'submission' ? submissionWitnessed : footing === 'host' ? hostResolved : witnessed;
    if (!into.includes(note)) into.push(note);
  };
  let releasedBuild = buildReleased([], () => {});

  const resolverFns = {
    'released-build': (v) => releasedBuild(v),
    'e2e-run': e2eRunResolver,
    // ⏱ 2026-09-23 — WITNESSED by a store-screenshots.yml run of any status; each
    // acceptance is recorded and printed under its own label.
    'store-capture': makeStoreCaptureResolver(captureRuns, (note) => {
      if (!captureWitnessed.includes(note)) captureWitnessed.push(note);
    }),
    // ⏱ 2026-09-15 · [ADR 087]. A SECOND resolver only (pending_erasures), so an empty
    // set refuses every step value rather than admitting one.
    'erasure-step': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `\`${v}\` is not an erasure step declared by \`export const <NAME>_STEP\` in services/platform/src`))(erasureStepNames()),
    'live-environment': (v) =>
      v === 'live' ? null : v == null ? 'no environment at all — the rail could not attribute this row to a money world' : `environment is \`${v}\`, not \`live\``,
    'cron-job': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `job \`${v}\` is declared by no \`export const <NAME>_JOB\` in services/platform/src`))(cronJobNames()),
    'provider-register': ((set) => (v) => (typeof v === 'string' && set.has(v) ? null : `provider \`${v}\` has no row in ${PROVIDERS_REL}`))(providerIds()),
    // For DERIVED tables carrying no build marker. Deliberately weaker than
    // `released-build` — it proves the row belongs to a real app, not that a
    // released build wrote it — and the register's own definition says so.
    //
    // ⚠️ REUSES THE `appSlugs()` ALREADY IN THIS FILE rather than reading the
    // catalogue a second time. The first draft added its own reader and Node
    // refused the module outright — `Identifier 'appSlugs' has already been
    // declared` — which is the cheapest possible version of the second-declaration
    // failure this repository keeps paying for, caught by the language instead of
    // by a drifted count months later.
    'app-catalogue': ((set) => (v) =>
      typeof v === 'string' && set.has(v)
        ? null
        : `app \`${v}\` has no entry in the app catalogue, so this row belongs to no app the factory ships`)(
      (() => {
        const s = new Set(appSlugs());
        // An empty set marks every row unattributable, which reads as a finding
        // about the data when it is really a finding about the reader.
        if (s.size === 0) throw new CouldNotLook('the app catalogue declares zero apps, so every row would read as unattributable');
        return s;
      })(),
    ),
    // ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT. For the extension
    // account-check tables (`ext_codes`, `ext_devices`), whose `product` names a
    // browser extension, never an app. Same shape and same weakness as
    // `app-catalogue` one entry up — it proves the row belongs to an extension
    // the factory ships, not that a released build wrote it — over its OWN
    // catalogue, so no app slug can resolve an extension row.
    //
    // ⚠️ THE CATALOGUE IS READ WHEN A ROW FIRST NEEDS IT, not when this map is
    // built: a census with no extension rows (and every offline fixture tree,
    // which carries no extensions/ directory) must not be refused for a
    // catalogue it never consults. An empty catalogue met BY A ROW is still
    // COULD NOT LOOK, never a finding about the row.
    'extension-catalogue': ((read) => {
      let set = null;
      return (v) => {
        if (set === null) {
          set = new Set(read());
          if (set.size === 0) throw new CouldNotLook('the extension catalogue declares zero extensions, so every row would read as unattributable');
        }
        return typeof v === 'string' && set.has(v)
          ? null
          : `extension \`${v}\` has no entry in extensions/catalog/extensions.json, so this row belongs to no extension the factory ships`;
      };
    })(extensionSlugs),
    // For rows created by a dated, reviewed OPERATOR act — neither a client, nor
    // the money rail, nor a migration seed. `feature_sets` is the case: minting a
    // bundle version is an explicit forward-only act ([ADR 057] §4), and
    // `minted_from` is the commit or register hash that act recorded.
    //
    // 🔴 THE PREDICATE IS "NON-EMPTY", AND THAT IS WEAKER THAN IT LOOKS ON
    // PURPOSE. This reader cannot verify a sha against anything: the register
    // hash a mint records is not a git object, and resolving it would mean this
    // monitor deciding what a valid mint looks like — a second authority over a
    // one-way door. What it CAN say is that somebody recorded something, and the
    // failing input it exists for is the row minted by hand against nothing,
    // which is the row that silently defines what a stranger bought.
    'operator-minted': (v) =>
      typeof v === 'string' && v.trim().length > 0
        ? null
        : v == null
          ? 'no mint provenance at all — this version was created against no reviewed state, and grants that pin it are defined by nobody'
          : 'mint provenance is blank',
    // For the member rows of a pinned feature set. The marker is the CATEGORY the
    // slug came from, checked against the kinds the shared contract declares.
    //
    // ⚠️ DELIBERATELY NOT A JOIN AGAINST THE PRODUCT CATALOGUES. A RETIRED product
    // legitimately leaves `catalog/apps.json` while every grant that pinned it must
    // keep resolving — so a catalogue join would turn honest history into a false
    // red, which is the same trap `app-catalogue` above is allowed to take only
    // because its tables are derived and carry no purchase.
    'product-kind': ((set) => (v) =>
      typeof v === 'string' && set.has(v)
        ? null
        : `product kind \`${v}\` is not one of the kinds contracts/entitlement/bundle.js declares (${[...set].join(', ')})`)(
      (() => {
        const s = new Set(PRODUCT_KINDS);
        // An empty set marks every row unattributable, which reads as a finding
        // about the data when it is really a finding about the reader — the same
        // failure `app-catalogue` guards against one entry up.
        if (s.size === 0) throw new CouldNotLook('the bundle contract declares zero product kinds, so every member row would read as unattributable');
        return s;
      })(),
    ),
    // ⏱ 2026-09-15 · [ADR 087]. Receives ONLY the bucket name the projection in
    // `reservedAddressCensusSql` returns — never an address — and never echoes
    // an unexpected value, in case a future query shape hands it one.
    'not-reserved-address': (v) =>
      v === 'unreserved'
        ? null
        : v === 'reserved'
          ? 'addressed to a domain reserved for testing (RFC 2606 / RFC 6761) — probe residue, not a person who asked to hear about a launch'
          : 'the reserved-address projection returned a value that is neither `reserved` nor `unreserved`, so this reader cannot tell what it counted',
    'migration-seed': null, // built per table below — the allowed set is that table's own seeds
  };

  const fixture = rowsFile ? JSON.parse(readFileSync(rowsFile, 'utf8')) : null;
  /** ⏱ 2026-09-26 — a fixture's rows for one table: the key `<database>.<table>`,
   *  or a bare `<table>` for the serving Worker's database, which is what every
   *  older fixture means. */
  const fixtureRows = (db, name) => fixture[`${db.name}.${name}`] ?? (db.serving ? fixture[name] : undefined) ?? [];
  /** ⏱ 2026-09-26 — `--schema-file`: `{tables, migrations}` is the serving
   *  Worker's database (every older fixture); `{<database>: {tables,
   *  migrations}}` names each. A database it does not name is NOT READ. */
  const schemaDoc = schemaFile ? JSON.parse(readFileSync(schemaFile, 'utf8')) : null;
  const schemaEntry = (db) => {
    if (!schemaFile) return undefined;
    // Not an object at all: handed to the judges below, which refuse it.
    if (schemaDoc === null || typeof schemaDoc !== 'object' || Array.isArray(schemaDoc)) return schemaDoc;
    if (Object.prototype.hasOwnProperty.call(schemaDoc, 'tables') || Object.prototype.hasOwnProperty.call(schemaDoc, 'migrations')) return db.serving ? schemaDoc : undefined;
    return schemaDoc[db.name];
  };

  // ── (0) HAS EVERY TABLE ARRIVED? · ⏱ 2026-09-25 — see the header ─────────
  // Live: two bounded reads through `queryD1`, the ledger only once the table
  // read has shown it exists. Fixture: `--schema-file`, through the same two
  // judges; WITHOUT it, `null` — every table present, which is what every older
  // fixture means and the only state in which this block reads nothing.
  // ⏱ 2026-09-26 — once PER DATABASE, against that database's own ledger.
  const readSchema = async (db) => {
    const s = schemaEntry(db);
    if (s !== undefined) {
      const present = presentTablesFrom(s?.tables, db.migrationsTable);
      if (s?.migrations?.error !== undefined) throw new CouldNotLook(`the \`${db.migrationsTable}\` read failed: ${s.migrations.error} (${db.name})`);
      return { present, applied: appliedMigrationsFrom(s?.migrations, db.migrationsTable) };
    }
    if (rowsFile) return null;
    const present = presentTablesFrom(await queryDb(db, SCHEMA_TABLES_SQL), db.migrationsTable);
    return { present, applied: appliedMigrationsFrom(await queryDb(db, `SELECT name FROM "${db.migrationsTable}" ORDER BY name`), db.migrationsTable) };
  };
  const migrationViolations = [];
  const pendingLines = [];
  const unplaced = new Set();
  for (const db of dbs) {
    let schema = await readSchema(db);
    let migState = schema === null ? { present: [...db.tables.keys()].sort(), pending: [], vanished: [] } : classifyMigrationState(db.tables, schema);
    let env = null;
    let deploys = null;
    if (migState.pending.length) {
      env = serviceEnvironment(db);
      // `--platform-deployments-file` is the SERVING Worker's ledger, as its
      // name says; another database's ledger is NOT READ in fixture mode, and
      // the clock alone decides there.
      deploys = platformDeploymentsFile && db.serving
        ? (() => {
            const arr = JSON.parse(readFileSync(platformDeploymentsFile, 'utf8'));
            if (!Array.isArray(arr)) throw new CouldNotLook(`${platformDeploymentsFile} is not an array of deployments`);
            return arr.map((d) => deploymentRecord(typeof d === 'string' ? { sha: d } : d, env));
          })()
        : rowsFile
          ? null
          : await githubDeployments([env]);
      // 🔴 READ AGAIN, AFTER THE LEDGER. A Deployment the ledger lists was
      // recorded after its migrations applied, so a schema read that FOLLOWS the
      // ledger read has to see them; the first read may predate a deploy that
      // finished in between, and would call that deploy a contradiction.
      if (!rowsFile) {
        schema = await readSchema(db);
        migState = classifyMigrationState(db.tables, schema);
      }
    }
    Object.assign(db, { schema, migState, env, deploys, quiet: new Set([...migState.pending, ...migState.vanished].map((p) => p.table)) });
    for (const { table, file } of migState.vanished) {
      migrationViolations.push(`${db.name}.${table}: absent from production, yet ${file} is recorded in \`${db.migrationsTable}\` — the migration ran and the table it creates is not there`);
    }
    if (migState.pending.length) {
      const nowMs = nowFlag !== null ? Date.parse(nowFlag) : rowsFile ? NaN : Date.now();
      if (!Number.isFinite(nowMs)) {
        throw new CouldNotLook(
          nowFlag !== null
            ? `--now ${JSON.stringify(nowFlag)} is not a time`
            : `fixture mode reached ${migState.pending.length} pending migration(s) in ${db.name} with no --now — a test must never read the wall clock`,
        );
      }
      const history = resolve(historyFlag ?? ROOT);
      const mergeOf = new Map();
      for (const { table, file } of migState.pending) {
        if (!mergeOf.has(file)) mergeOf.set(file, migrationMerge(history, `${db.migrationsDir}/${file}`));
        const merged = mergeOf.get(file);
        const mergedMs = Date.parse(merged.mergedAt);
        const containing = [];
        // A Deployment created before the merge cannot contain it, so only the
        // ones after it cost a git call.
        for (const d of (deploys ?? []).filter((x) => x.created_at === null || !(Date.parse(x.created_at) < mergedMs))) {
          const c = commitContains(history, merged.sha, d.sha);
          if (c === true) containing.push(d);
          else if (c === null) unplaced.add(`${db.worker} Deployment ${d.sha.slice(0, 7)} is not in this checkout's history, so it neither shows nor rules out ${file}`);
        }
        const v = pendingMigrationVerdict({
          table: `${db.name}.${table}`,
          file,
          merged,
          nowMs,
          containing,
          migrationsTable: db.migrationsTable,
          worker: db.worker,
          binding: db.binding,
        });
        (v.overdue ? migrationViolations : pendingLines).push(v.line);
      }
    }
  }

  // ⏱ 2026-09-23 — THE CENSUS RUNS IN FOUR PHASES, so that no row is judged
  // before every build it names has been looked for: (A) read each table's
  // groups and resolver chain; (B) collect the `released-build` values the
  // walked runs cannot place; (C) point-read them; (D) judge. The D1 reads are
  // the same reads as before, in the same order — only the judging moved.
  // ⏱ 2026-09-26 — database by database, in the derived order.
  const plan = [];
  for (const db of dbs) {
    for (const name of [...db.tables.keys()].sort()) {
      const rule = db.rules[name];
      // An exempt table has no marker to read: it is not queried, and the
      // census prints it as exempt rather than as a clean zero.
      if (rule.resolver === EXEMPT) {
        plan.push({ db, name, rule, marker: null, resolve_: null, alts: [], groups: [], quiet: db.quiet.has(name), exempt: true });
        continue;
      }
      const marker = rule.marker;
      let resolve_ = resolverFns[rule.resolver];
      if (rule.resolver === 'migration-seed') {
        const seeded = db.tables.get(name).seeds.get(marker) ?? new Set();
        if (seeded.size === 0) throw new CouldNotLook(`COVERAGE LOST — \`${db.name}.${name}\` resolves by \`migration-seed\` on \`${marker}\` and the migrations seed nothing there`);
        resolve_ = (v) => (typeof v === 'string' && seeded.has(v) ? null : `\`${v}\` is not one of the ${seeded.size} values the migrations seed into \`${marker}\``);
      }
      if (typeof resolve_ !== 'function') throw new CouldNotLook(`\`${db.name}.${name}\` names resolver \`${rule.resolver}\`, which this reader cannot execute`);

      // ── the table's SECOND resolvers, if it declares any ───────────────────
      // Consulted ONLY for a value the primary has already refused, so this can
      // never make the primary weaker — it can only admit a value the primary
      // named, and it has to name that value itself, in a shape it declares.
      //
      // 🔴 AN UNEXECUTABLE ENTRY IS `CouldNotLook`, NOT A SKIP. A silently ignored
      // `alsoResolves` reads as "the rule was applied and nothing matched", which
      // is the direction that weakens without announcing itself — the same reason
      // the run-with-no-`conclusion` case above refuses to guess.
      const alts = (Array.isArray(rule.alsoResolves) ? rule.alsoResolves : []).map((id) => {
        const fn = resolverFns[id];
        if (typeof fn !== 'function') {
          throw new CouldNotLook(
            `\`${db.name}.${name}\` lists \`${id}\` in \`alsoResolves\` and this reader cannot execute it. A second resolver ` +
              'that is quietly skipped would leave rows counted as unattributable for a rule nobody applied.',
          );
        }
        return [id, fn];
      });

      // ⏱ 2026-09-25 — a table production does not have yet is ZERO rows, and a
      // table that vanished is its own finding above: neither is queried.
      const groups = db.quiet.has(name)
        ? []
        : fixture
          ? fixtureRows(db, name)
          : await queryDb(
              db,
              rule.resolver === 'not-reserved-address'
                ? reservedAddressCensusSql(name, marker)
                : `SELECT "${marker}" AS marker, COUNT(*) AS n FROM "${name}" GROUP BY "${marker}"`,
            );
      plan.push({ db, name, rule, marker, resolve_, alts, groups, quiet: db.quiet.has(name), exempt: false });
    }
  }

  // ── (B) the builds a point read must look up ─────────────────────────────
  // A value qualifies only when ALL hold: its table's chain names
  // `released-build`; every resolver in that chain refuses it; it has the shape
  // of a shipped build on a declared line; and NO walked or attested run carries
  // its run number at its sha. The last is the point: a run the walk DID serve
  // that failed without a Deployment is a verdict about the build, not a gap in
  // the listing, and it costs no read.
  const walkedOrAttested = [...runs, ...attested];
  const missing = new Set();
  for (const p of plan) {
    const chain = [p.rule.resolver, ...(Array.isArray(p.rule.alsoResolves) ? p.rule.alsoResolves : [])];
    if (!chain.includes('released-build')) continue;
    for (const g of p.groups) {
      const v = g.marker;
      if (typeof v !== 'string') continue;
      const m = v.match(BUILD_VERSION);
      if (!m || !lines.has(`${m[1]}.${m[2]}`)) continue;
      if (p.resolve_(v) === null || p.alts.some(([, fn]) => fn(v) === null)) continue;
      const sha = m[4].toLowerCase();
      if (walkedOrAttested.some((r) => String(r.run_number) === m[3] && String(r.head_sha ?? '').toLowerCase().startsWith(sha))) continue;
      missing.add(v);
    }
  }
  const candidates = [...missing].sort();

  // ── (C) the point reads ──────────────────────────────────────────────────
  // Live: the GitHub API through the shared bounded retry. Fixture: the
  // --point-reads-file map, where a path it does not name answers 404. A fixture
  // run WITHOUT that file makes no point reads at all and prints so; it never
  // invents "not a commit" for a sha nobody asked about.
  let pointRead = null;
  if (pointReadsFile) {
    const map = JSON.parse(readFileSync(pointReadsFile, 'utf8'));
    if (map === null || typeof map !== 'object' || Array.isArray(map)) throw new CouldNotLook(`${pointReadsFile} is not an object of path → {status, body}`);
    for (const [path, a] of Object.entries(map)) {
      if (!Number.isInteger(a?.status)) throw new CouldNotLook(`${pointReadsFile}: ${path} carries no integer status`);
    }
    pointRead = async (path) => (Object.prototype.hasOwnProperty.call(map, path) ? map[path] : { status: 404, body: null });
  } else if (!runsFile) {
    let creds = null;
    pointRead = (path) => {
      creds ??= githubCredentials();
      return ghRead(creds.repo, creds.token, `/${path}`, `reading ${path}`);
    };
  }
  const pointReadsMade = pointRead !== null;
  if (pointReadsMade && candidates.length > POINT_READ_CAP) {
    throw new CouldNotLook(
      `${candidates.length} distinct build(s) in production are absent from the walked runs — more than the ` +
        `${POINT_READ_CAP} this reader will look up one by one (${candidates.join(', ')}). A listing that missed that ` +
        `many is a listing that failed, so this is COVERAGE LOST, not ${candidates.length} findings`,
    );
  }
  const foundRuns = [];
  if (pointReadsMade) {
    for (const value of candidates) {
      const pr = await pointReadBuild({ value, read: pointRead, lanes });
      POINT_READS.push(pr);
      if (pr.found) foundRuns.push(pr.found);
    }
  }
  const pointReadOf = new Map(POINT_READS.map((pr) => [pr.value, pr]));
  releasedBuild = buildReleased(foundRuns, recordWitness);

  // ── (D) the census proper ────────────────────────────────────────────────
  const census = [];
  const violations = [...attViolations];
  // Acceptances on a SECOND resolver, printed after the census. Never silent —
  // the same rule the deployment witness and the manual-deploys register follow,
  // and here it is what keeps a crashed nightly's residue visible in this log
  // even though it no longer turns the run red.
  const alsoAccepted = [];
  for (const { db, name, rule, marker, resolve_, alts, groups, quiet: unread, exempt } of plan) {
    // ⏱ 2026-09-26 — every finding names its database.
    const label = `${db.name}.${name}`;
    if (exempt) {
      census.push({ db, name, total: 0, bad: 0, marker: null, resolver: rule.resolver, unread, exempt: true });
      continue;
    }
    let total = 0;
    let bad = 0;
    for (const g of groups) {
      const n = Number(g.n ?? 0);
      total += n;
      let why = resolve_(g.marker);
      if (why !== null) {
        for (const [id, fn] of alts) {
          if (fn(g.marker) !== null) continue;
          // ⏱ 2026-09-25 (capsand-b) — the capture writes the SANDBOX Workers now,
          // so a witnessed `cap-*` consent row in production means a sandbox lane
          // wrote production. It is a FINDING, never an acceptance.
          if (id === 'store-capture' && name === 'consent_artifacts') {
            why = `a sandbox lane wrote production: ${g.marker} (run ${String(g.marker).match(STORE_CAPTURE_SHAPE)?.[1] ?? '?'})`;
            break;
          }
          alsoAccepted.push(
            id === 'erasure-step'
              ? `${label}: ${n} row(s) with \`${marker}\` = \`${g.marker}\` — refused by \`${rule.resolver}\` and accepted by ` +
                  'the narrower `erasure-step`: a non-app step of an erasure that is still pending ([ADR 087]). The nightly ' +
                  'erasure_retry heartbeat, not this census, is what turns red if it never finishes.'
              : id === 'store-capture'
                ? `${label}: ${n} row(s) with \`${marker}\` = \`${g.marker}\` — refused by \`${rule.resolver}\` and accepted by ` +
                    `the narrower \`store-capture\`: written by ${CAPTURE_WORKFLOW} run ${String(g.marker).match(STORE_CAPTURE_SHAPE)?.[1] ?? '?'}, ` +
                    'whose purge step owns removing it. A row that survives the purge is residue; this line printing on the ' +
                    'next ops-watch IS that signal.'
              : `${label}: ${n} row(s) with \`${marker}\` = \`${g.marker}\` — refused by \`${rule.resolver}\` and accepted by ` +
                  `the narrower \`${id}\`. These rows were written by a live verification, which B-17 permits; what B-17 ` +
                  'also requires is that the harness removed them, and THAT is asserted by the harness, not here.',
          );
          why = null;
          break;
        }
      }
      if (why !== null) {
        bad += n;
        // ⏱ 2026-09-23 — a build that was looked up directly says what the
        // lookup found, so a finding is never a finding about the listing alone.
        const pr = pointReadOf.get(g.marker);
        if (pr && !pr.found) why = `${why} · looked up directly: ${pr.verdict}`;
        violations.push(`${label}: ${n} row(s) — ${why}  [marker \`${marker}\`, resolver \`${rule.resolver}\`]`);
      }
    }
    census.push({ db, name, total, bad, marker, resolver: rule.resolver, unread, exempt: false });
  }

  const grandTotal = census.reduce((a, c) => a + c.total, 0);
  // ⏱ 2026-09-26 — one line per walked database, then the total, so a database
  // that was walked and found empty is a count and never an absence.
  for (const db of dbs) {
    const mine = census.filter((c) => c.db === db);
    const exempt = mine.filter((c) => c.exempt).length;
    console.log(
      `⬜  MONITOR · [pipeline B-17] · ${db.name}: ${mine.length} table(s) enumerated from ${db.migrationsDir} (${db.filesRead} migration file(s)), ` +
        `${mine.reduce((a, c) => a + c.total, 0)} row(s)${exempt ? ` · ${exempt} exempt table(s), not queried` : ''}`,
    );
  }
  console.log(`⬜  MONITOR · [pipeline B-17] · ${dbs.length} database(s) walked (${dbs.map((d) => d.name).join(', ')}): ${census.length} table(s), ${grandTotal} row(s)`);
  console.log(
    `⬜  released-build set: ${runs.length} completed lane run(s), ${runs.filter((r) => (r.conclusion ?? 'success') === 'success').length} successful · ` +
      `deployment ledger: ${deployedShas === null ? 'NOT READ (fixture mode)' : `${deployedShas.size} commit(s) with a GitHub Deployment on a served environment`}`,
  );
  // ⏱ 2026-09-23 — one line per release lane, so a lane that was read and found
  // empty is visible as a count and not as an absence.
  // ⏱ 2026-09-25 — what the schema reads found, on every run, as counts.
  // ⏱ 2026-09-26 — per database.
  for (const db of dbs) {
    console.log(
      db.schema === null
        ? `⬜  ${db.name} migration ledger: NOT READ (fixture mode, ${schemaFile ? 'the --schema-file names no schema for it' : 'no --schema-file'}) — every enumerated table taken as present`
        : `⬜  ${db.name} migration ledger: ${db.schema.applied.size} migration(s) recorded in \`${db.migrationsTable}\` · ${db.migState.present.length} of ${db.tables.size} table(s) present · ` +
            `${db.migState.pending.length} not yet migrated · ${db.migState.vanished.length} missing though recorded`,
    );
  }
  for (const db of dbs.filter((d) => d.env !== null)) {
    console.log(`⬜  ${db.worker} Deployment ledger (${db.env}): ${db.deploys === null ? 'NOT READ (fixture mode) — the clock alone decides' : `${db.deploys.length} Deployment(s)`}`);
  }
  for (const l of pendingLines) console.log(l);
  for (const u of unplaced) console.log(`⬜  ${u}`);
  if (runHostsUnread) {
    console.log(`⬜  run hosts: NOT READ — this fixture root has no ${WORKFLOW_DIR}, so each release lane is read as its own run workflow`);
  }
  for (const l of lanes) {
    const laneRuns = runs.filter((r) => l.runWorkflows.includes(r.workflow) && laneByWorkflow.get(r.workflow) === l).length;
    const listedIn = l.host ? ` (listed in ${l.runWorkflows.join(' + ')}; run host ${l.host.workflow} job \`${l.host.callJob}\`, ${l.host.filter})` : '';
    const deps =
      deployments === null
        ? 'NOT READ'
        : String(
            deployments.filter((d) =>
              l.kind === 'served' ? d.environment === null || ledger.has(d.environment) : l.environments.includes(d.environment),
            ).length,
          );
    console.log(`⬜  release lane · ${l.kind} · ${l.workflow}: ${laneRuns} completed run(s)${listedIn} · ${deps} Deployment(s) on ${l.environments.join(', ') || '(none declared)'}`);
  }
  // ⏱ 2026-09-23 — one line per walk ATTEMPT (with its consistency verdict) and
  // one per point read, then the point-read total, on every run.
  for (const l of lookupLines({ made: pointReadsMade })) console.log(l);
  // An acceptance resting on the weaker footing is announced, never silent — the
  // same rule the manual-deploys register follows. A build that resolves ONLY
  // because a failed run left a deployment behind is a build somebody should be
  // able to see in the log without going looking.
  for (const w of witnessed) console.log(`⬜  deployment-witnessed build accepted: ${w}`);
  // ⏱ 2026-09-23 — and a build accepted on footing (c) says which run and which
  // Deployment carried it, on every run.
  for (const w of submissionWitnessed) console.log(`⬜  submission-witnessed build accepted: ${w}`);
  // ⏱ 2026-09-25 [ADR 095 §4] — and a stamp resolved in a lane's caller says
  // which workflow's run it was (`ci.yml run 3850`), on every run.
  for (const w of hostResolved) console.log(`⬜  host-resolved build accepted: ${w}`);
  // ⏱ 2026-09-23 — and a store-capture stamp says which capture run witnessed it.
  for (const w of captureWitnessed) console.log(`⬜  store-capture-witnessed stamp accepted: ${w}`);
  for (const a of alsoAccepted) console.log(`⬜  second-resolver acceptance: ${a}`);
  for (const db of dbs) {
    console.log(`    ${db.name} (${db.wrangler} \`${db.binding}\`):`);
    for (const c of census.filter((x) => x.db === db)) {
      if (c.exempt) {
        console.log(`    ⬜  ${c.name.padEnd(24)} ${c.unread ? 'not in production, ' : ''}exempt — not queried   [no marker · ${c.resolver}]`);
        continue;
      }
      if (c.unread) {
        console.log(`    ⬜  ${c.name.padEnd(24)} ${String(c.total).padStart(6)} row(s) — not in production, not queried   [${c.marker} · ${c.resolver}]`);
        continue;
      }
      console.log(`    ${c.bad === 0 ? 'ok ' : '✗  '} ${c.name.padEnd(24)} ${String(c.total).padStart(6)} row(s), ${c.bad} unattributable   [${c.marker} · ${c.resolver}]`);
    }
  }

  // ⏱ 2026-09-26 — the register's database map against the Workers that own
  // databases, and every exemption's argument. A finding about the register,
  // never about a row.
  if (registerViolations.length) {
    console.error('');
    console.error(`✗ ${registerViolations.length} problem(s) with ${REGISTER_REL}'s databases:`);
    for (const v of registerViolations) console.error(`    ${v}`);
    process.exitCode = 1;
  }
  if (migrationViolations.length) {
    console.error('');
    console.error(`✗ ${migrationViolations.length} table(s) the migrations create are not in production, and waiting will not bring them:`);
    for (const v of migrationViolations) console.error(`    ${v}`);
    console.error('');
    console.error("  deploy-workers is the one applier of each database's migrations. A migration still waiting past the limit is a");
    console.error('  deploy that has not happened — find what is blocking it; one the applier has run, or one recorded with');
    console.error('  its table gone, is a database this reader and the deploy do not agree on.');
    process.exitCode = 1;
  }
  if (violations.length) {
    console.error('');
    console.error(`✗ ${violations.length} group(s) of rows in production cannot be traced to a released build:`);
    for (const v of violations) console.error(`    ${v}`);
    console.error('');
    // ⏱ 2026-09-23 — this text used to end "Delete the residue", and on
    // 2026-09-23 09:28Z it was printed under 42 rows that were real people's
    // consent artifacts and events, from builds a shifted listing never served.
    // It now never suggests removing a row: removal belongs to the harness that
    // created an artifact, and an untraced row is first a question about who
    // wrote it. prod-provenance-walk.test.mjs holds the wording to that.
    console.error('  B-17: verification against production is permitted and EXPECTED, and every artifact it creates must be');
    console.error('  provably removed — by the harness that created it, never by hand from this list.');
    console.error('  A row listed here is one this reader could not TRACE, which is not the same as residue: a build stamp');
    console.error('  above was looked for in the walked run history and, where no walk served it, by a direct read of its');
    console.error('  commit (the `point read ·` lines).');
    console.error("  Establish who wrote each row first: a consent artifact or an event from a real person's build is a record to keep.");
    console.error('  If the row is real, fix what wrote it (or this reader) so the next one traces.');
    process.exitCode = 1;
    return;
  }
  if (migrationViolations.length || registerViolations.length) return;

  const exemptCount = census.filter((c) => c.exempt).length;
  console.log(
    `ok  every row in every shared table resolves to a released build or its declared equivalent [pipeline B-17] — ${dbs.length} database(s)` +
      `${exemptCount ? `; ${exemptCount} exempt table(s) were not queried, and say so above` : ''}`,
  );
  console.log('⬜  THIS IS A MONITOR, NOT A GATE. Green means "nothing has contradicted B-17 since this run", never');
  console.log('    "B-17 holds" — the next write to production happens between two runs of this reader.');
  process.exitCode = 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    await main();
  } catch (e) {
    if (e instanceof CouldNotLook) {
      // ⏱ 2026-09-23 — the numbers first: every walk attempt and every point read
      // made before the refusal, so an exit 2 is read back as counts.
      for (const l of lookupLines({ summary: POINT_READS.length > 0 })) console.log(l);
      console.error(`✗ COULD NOT LOOK — ${e.message}`);
      console.error('');
      console.error('  This is exit 2, not exit 1, and the difference is the whole point: "I could not look" must never');
      console.error('  read as "I looked and it was fine". 04-backend-platform.md\'s B-17 evidence block still records');
      console.error('  `consent_artifacts` 0 for exactly that reason — nothing ever looked again.');
      process.exitCode = 2;
    } else {
      console.error(`✗ ${e.stack ?? e.message}`);
      process.exitCode = 2;
    }
  }
}

export {
  makeReleasedBuildResolver,
  makeStoreCaptureResolver,
  releaseLines,
  CouldNotLook,
  collectPaged,
  collectWindowed,
  githubRuns,
  WALKS,
  WalkTruncated,
  WINDOW_DAYS,
  formatWalk,
  WALK_ATTEMPTS,
  WALK_PAUSE_MS,
  POINT_READ_CAP,
};
