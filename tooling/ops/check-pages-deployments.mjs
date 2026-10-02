#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-pages-deployments.mjs — THE CLOUDFLARE PAGES BUILD IS GRADED, BY US,
// BECAUSE NOTHING ELSE GRADES IT AT ALL.
//
// ── THE MEASURED HOLE ────────────────────────────────────────────────────────
// `sites/nikatru` is a GIT-CONNECTED Pages project (sites/nikatru/README.md:
// project `nikatru`, root directory `sites/nikatru`, output `/`, no build step).
// Cloudflare deploys it on the merge push, on Cloudflare's side of the wire. It
// posts NO commit status, opens NO GitHub Deployment and appears in NO Actions
// run. So on the Actions page — the page the owner reads — a Cloudflare build
// that FAILED is indistinguishable from one that never needed to happen, and a
// project stuck on a three-week-old commit looks exactly like a quiet week.
//
// 🔴 AND THAT PROJECT IS NOT A MARKETING SITE ANY MORE. Since [ADR 075] the
// apex is the app's PUBLIC ADDRESS: `nikatru.com/<id>/` is served by
// `sites/nikatru/functions/_middleware.js` proxying the app's own Pages project.
// The router and the app are therefore TWO deployments that must both land, and
// only one of them has ever had a witness. A router stuck on the pre-[ADR 075]
// commit serves 404s at the app's address while `deploy-web.yml` is green, the
// app's own Pages project is green, and the post-deploy smoke — which fetches
// the app's origin — is green too. That is the white-page failure mode with the
// deploy lane reporting success, and it had no observer.
//
// ── WHY IT IS HERE AND NOT IN A DEPLOY LANE ─────────────────────────────────
// The Cloudflare build starts when Cloudflare notices the push, which is after
// our workflow has finished. A deploy-time check would have to poll for a build
// it cannot trigger and cannot bound. So this is a DUTY: it runs on ops-watch's
// twelve slots, where a build that has not landed by the next slot is a finding
// and not a race. ops-watch.yml is also the ONE workflow holding
// CLOUDFLARE_API_TOKEN, which is the other half of why it lives there.
//
// ── WHAT IS GRADED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
//   GET /accounts/{account}/pages/projects/{project}/deployments?env=production
//
//   · `latest_stage.name === 'deploy' && latest_stage.status === 'success'` —
//     the newest PRODUCTION deployment reached the last stage and that stage
//     passed. A project whose newest production build failed is live on the
//     PREVIOUS one, which is precisely the state that looks healthy from
//     outside: the site answers 200, with last week's bytes.
//
//   · 🔴 IN FLIGHT IS NOT FAILED. Until 2026-09-19 any newest deployment short
//     of `deploy`/`success` was RED, and a build that was simply STILL RUNNING
//     met that test. ops-watch run 35422355154 (schedule, 04:50:14Z) read
//     `rajasekarselvam` at ~04:50:34Z: PR #816 had merged at 04:50:11Z,
//     Cloudflare created the build for 77a8495b at 04:50:13Z, and its deploy
//     stage ended `success` at 04:50:41Z — seven seconds after the verdict. A
//     red ops-watch reddens ci-gate on `main` and freezes every merge, so the
//     race fired on ANY merge that landed near a slot. The stage is now read as
//     one of four things (classifyStage): DONE, FAILED (`failure`/`canceled`),
//     IN FLIGHT (`active`/`idle`, or a non-final stage that has passed) or a
//     status outside Cloudflare's published enum, which is exit 2. An in-flight
//     newest build younger than IN_FLIGHT_CEILING_MS is NOT graded; the newest
//     COMPLETED production deployment behind it is, with every limb below, and
//     the line says ⏳ and names the build the next slot will grade. Past the
//     ceiling it is RED as a STUCK build.
//
//   · `deployment_trigger.metadata.commit_hash` (for GIT-CONNECTED projects,
//     and since 2026-09-19 for DIRECT-UPLOAD rows that carry one — below)
//     against the newest commit on `main` that touched the project's
//     source directory. The test is CONTAINMENT, not equality: the served
//     commit passes if it IS that commit or is a DESCENDANT of it. BEHIND —
//     a served commit that does not carry it — means the build for that commit
//     never ran or never finished. An ancestry that cannot be read is exit 2.
//
//     🔴 THIS LIMB READ `!==` UNTIL 2026-09-09 AND THAT WAS WRONG. Cloudflare
//     builds EVERY push to main, not only the ones touching this project's
//     directory, so a healthy project normally serves a commit AHEAD of the one
//     `main` names, and equality holds only for the minutes between a
//     source-touching commit and the next push of any kind. ops-watch run
//     34379156976 called both `nikatru` and `rajasekarselvam` RED while each
//     served 2dd81ff, a descendant of the commit it was accused of missing;
//     `duty.workflow.ops-watch.yml` then read RED SINCE and reddened
//     `Guards — platform, data and ops` on every open pull request at once.
//
//   ⚠️ `*.pages.dev` IS NOT ASKED, ON PURPOSE. It is a different zone with its
//   own preview deployments, and `env=production` is the whole reason this query
//   is trustworthy: a green preview of a branch is not evidence about the apex,
//   and a check that accepted one would be green through the entire failure this
//   file exists for. The filter is a REQUEST, so the ANSWER is checked too —
//   every returned row's `environment` must read `production` or the verdict is
//   withheld (exit 2), the same reason classifyRunHistoryAnswer in
//   assert-ops-register.mjs re-reads `head_branch` off the response.
//
//   ⚠️ DIRECT-UPLOAD PROJECTS CARRY NO COMMIT — the sentence this paragraph read
//   until 2026-09-19, kept here because it is what the code did: `wrangler pages
//   deploy` produces `deployment_trigger.type: "ad_hoc"` with no
//   `metadata.commit_hash`, so the commit limb was declared UNGRADED.
//
//   🔴 THAT PREMISE WAS FALSE, AND ONE OF THREE PROJECTS HAD ITS FRESHNESS LIMB
//   OFF BECAUSE OF IT. Measured 2026-09-19 (row O-PAGES-DIRECT-UPLOAD-COMMIT-
//   UNGRADED): all ten newest production rows of `subscriptiontracker` are
//   `ad_hoc` AND carry `metadata.commit_hash`, `branch: main`, `commit_dirty:
//   true` — 0b3409b5 serves ac22b935 (#819), 5b862e8b serves 30b4ef06 (#810).
//   deploy-web.yml passes no `--commit-hash`: wrangler reads HEAD of the
//   Actions checkout itself (dirty because `build/` is in the tree), so the
//   hash is the SHA the deploy-web run was triggered for. Each of those ten
//   equals the `head_sha` of the successful deploy-web run that published it —
//   nine `push` runs (35430092698 → ac22b935 … 35089676466 → 9698fdce) and one
//   `workflow_dispatch` re-run (35081373399 → 9b3b7b0b, after push run
//   35079844913 for the same SHA failed).
//
//   So the limb is now GRADED for a direct-upload row that carries a hash, with
//   the same CONTAINMENT test as a git-connected one, against the newest commit
//   on `main` that `deploy-web.yml` itself would deploy for: its own
//   `on.push.paths` filter, PARSED from the workflow (deployLaneInputs), never a
//   hand list — `apps/<slug>` alone is too narrow (a `packages/**` or
//   `pubspec.lock` change redeploys every app) and any list here would rot away
//   from the workflow's. It is UNGRADED, and counted, only for a row that truly
//   carries no hash.
//
//   🔴 THE DEPLOY LANE IS THE IN-FLIGHT WINDOW, AND CLOUDFLARE CANNOT SEE IT.
//   A direct upload has no `active` row while it builds: the row appears only
//   when wrangler uploads, ~9 minutes after the merge (deploy-web run created
//   07:43:18Z, Cloudflare row 07:51:53Z on 2026-09-19). A served commit that
//   does not carry the expected one is therefore ⏳ (exit 0) while the expected
//   commit's committer time is younger than the DEPLOY-LANE CEILING, and RED
//   past it. The ceiling is DERIVED from deploy-web.yml too: every job's
//   `timeout-minutes`, summed, times DEPLOY_LANE_RUNS (2) — the workflow's
//   concurrency group on `main` does not cancel in progress, so the run for the
//   newest commit can wait behind one full run before starting its own. A job
//   with no `timeout-minutes` (GitHub's default is 360) is exit 2, not a guess.
//   `record-deployment.mjs` / check-prod-provenance.mjs (pipeline B-17) remain
//   the second, independent commit witness.
//
//   🔴 2026-09-27 (FPI-1): NOT CARRYING THE COMMIT IS NOT SERVING OTHER BYTES.
//   #996 (51a4e9ad) touched subscriptiontracker, its main CI went red, so
//   deploy-web never published it; revert #1002 (e9b256b8) restored the files
//   byte for byte, and deploy-web's planner then read `decision=unchanged`
//   (`"matched":[]`, main CI 36293604395) against the live 646e00c1 — correct,
//   those ARE its bytes. Ops watch run 36297578437 still went RED: 646e00c does
//   not carry e9b256b, past the ceiling. The two readers asked two questions,
//   and any touch-then-untouch kept this one red until an unrelated web change
//   happened to deploy. So a direct row that does not carry the expected commit
//   now asks the PLANNER's own `decide()` (plan-deploy.mjs) first, with target =
//   expected and live = served: `unchanged` is ok and says so; `changed` is the
//   old verdict; anything it cannot answer (shallow, a missing object) is the
//   old verdict too — never a pass (unitUnchangedBetween).
//
//   ⏱ 2026-09-25 [ADR 095 §4]: deploy-web.yml has no `on.push.paths` now —
//   ci.yml calls it after ci-gate on every push to main, and its plan step
//   publishes only for a commit its unit claims. So the source set is that
//   unit, `deployUnits` in tooling/ci/lane-map.json, resolved from the plan
//   step's environment the way plan-deploy.mjs resolves it. The ceiling still
//   sums deploy-web.yml's own jobs; the ci.yml lanes that run before the call
//   are not in it.
//
// ── A SITE MOVES TO DIRECT UPLOAD; ITS OLD PROJECT IS ROLLBACK-ONLY ─────────
// 🔴 THIS READER JUDGED A PROJECT NOTHING WILL EVER BUILD AGAIN. At 16:27Z on
// 2026-09-26 (D3-1, [ADR 098]) nikatru.com moved from the Git-connected project
// `nikatru` to the Direct Upload project `nikatru-apex`, which only
// deploy-web.yml's `site` job publishes, and at 16:31:47Z every deployment of
// `nikatru` was switched off; it is kept for rollback. ops-watch run
// 36277702128 then read `✗ nikatru (git)`: 7f3475d6 serves e154dc6, which does
// not carry cff2c81 — a guaranteed red, while `nikatru-apex`, the project
// actually serving the apex, was not among the 3 projects derived at all.
//
// So a `sites/<name>` directory is DIRECT when a deploy-web.yml job plans a
// deployUnits entry claiming `sites/<name>/**` and names ONE `--project-name`
// (siteLanes): that project is graded like a catalogue app, against that
// unit's paths, inside a ceiling summed from that job and its `needs`, on the
// commit_hash its row carries (wrangler reads the Actions checkout HEAD, which
// the job also stamps into version.json). A site no job claims stays
// git-connected, as before.
//
// A project nothing builds any more is DECLARED rollback-only in
// tooling/ops/pages-rollback-only.json, never inferred from the account. It is
// read once per sweep (GET /pages/projects/{name}) and is `rollback-only
// (paused)` only while its Git source has deployments, production deployments
// and previews all off and it holds no domain outside `*.pages.dev`. Either one
// coming back with the declaration unchanged is RED, and so is a declared
// project that a site directory or the catalogue still derives as serving.
//
// ── THREE-VALUED, AND 2 IS NOT A PASS ───────────────────────────────────────
//   0  every derived project's newest production deployment succeeded, and every
//      one carrying a commit_hash is at the commit `main` says it should be (a
//      direct upload may also be ⏳ inside the deploy-lane ceiling, or serve a
//      commit whose unit files deploy-web's planner reads as `unchanged`).
//      A newest build still IN FLIGHT and younger than the ceiling is also 0,
//      printed ⏳, when the completed deployment behind it passes (or, for the
//      commit limb only, when the building one carries the commit `main` names).
//   1  a project is stale or red — its newest production build failed or was
//      canceled, has been in flight past the ceiling, or the commit it serves
//      does not CARRY the newest `main` commit for its source (for a direct
//      upload: past the deploy-lane ceiling).
//   2  COULD NOT LOOK — no credential, a non-200 that survived the retry below,
//      unparseable JSON, an
//      unreadable deploy-web.yml filter or job timeout, an
//      `environment` that came back something other than `production`, a stage
//      status outside Cloudflare's enum, an in-flight build whose `created_on`
//      does not parse (its age is the whole question), no COMPLETED deployment
//      within the rows read behind an in-flight one, or a
//      project list that derived to EMPTY. An empty sweep prints the same `ok`
//      as a complete one, which is the defect this portfolio keeps re-finding.
//
// ── ONE DROPPED CONNECTION IS NOT AN OUTAGE — THE BOUNDED RETRY ─────────────
// 🔴 A SINGLE UN-RETRIED `fetch` TURNED THE WHOLE RUN RED (row
// O-PAGES-FETCH-TRANSIENT-NOT-RETRIED). ops-watch run 35478397730 (schedule,
// 2026-09-20T00:17:52Z) read `✗ nikatru (git) — TypeError: fetch failed`: 0 RED,
// 1 NOT JUDGED, exit 2. The other two projects read fine in the SAME run and a
// dispatch sixteen minutes later was green, so the endpoint was healthy either
// side of it — one dropped TCP connection. A red ops-watch reddens `ci-gate` on
// `main`, so that blip froze the merge queue until somebody re-ran it, and it
// teaches every reader to shrug at an ops-watch red, which is how a genuinely
// red one (eight missed heartbeats) sat unnoticed for eight hours on the same
// day.
//
// So each Cloudflare read is attempted up to READ_ATTEMPTS times with a
// doubling gap. Both numbers are JUDGEMENT, recorded as judgement — neither is
// a vendor SLA and neither may be cited as one:
//
//   READ_ATTEMPTS = 3, RETRY_BASE_MS = 1000  →  gaps of 1 s then 2 s, a
//   RETRY_CEILING_MS of 3 s of waiting per project. The defect is a dropped
//   connection, which needs ONE more try and not six; three projects derive
//   today, so a TOTAL outage adds ~9 s to a job whose `timeout-minutes` is 10.
//   The ceiling is SUMMED from the plan (`backoffPlan`), never written twice.
//
// ⚠️ THE RETRY TELLS A BLIP FROM AN OUTAGE; IT HIDES NEITHER. A failure that
// survives every attempt is still COULD NOT LOOK — exit 2, with the attempt
// count in the line. Swallowing it into a pass would turn a real Cloudflare
// outage into a green sweep, which is strictly worse than the false red this
// section exists to remove. And only a TRANSIENT shape is retried at all
// (`transientLook`): the transport failing outright, HTTP 429, or HTTP 5xx. A
// 401/403 is an ANSWER — a revoked token does not improve in two seconds — and
// re-asking it three times only makes the run slower and the log longer.
//
// ⚠️ IT WAS THE FOURTH PRIVATE COPY OF THE LOOP, AND THE TREE HAD NO SHARED
// ONE. Swept 2026-09-21: post-deploy-smoke.mjs inlines it five times
// (ATTEMPTS/GAP_MS), verify-free-api-scope.mjs had a module-local
// `fetchWithRetry`, and record-deployment.mjs exports the POLICY primitives
// (`RETRY_ATTEMPTS`, `isRetryable`, `retryDelayMs`) but no wrapper — and its
// policy is GitHub-shaped: it deliberately excludes 429, which for the
// Cloudflare API is exactly the "ask again" case. So this file still does not
// import it, and its own predicate is named `isTransientLook` rather than
// shadowing that export with a different signature.
//
// ⏱ 2026-09-21 — THE LOOP ITSELF NO LONGER LIVES HERE. The class sweep this
// row also asks for found ELEVEN more ops-watch readers turning one dropped
// connection into a run-level verdict, so the primitives MOVED, unchanged, to
// tooling/ops/bounded-retry.mjs and are re-exported below. `status.mjs` was the
// worst shaped of them and its defect was the VERDICT rather than the retry: a
// DNS blip there reported exit 1 — "I looked, it is broken" — rather than 2.
//
// 🔴 `process.exit()` IS BANNED IN THIS FILE, for the reason recorded in
// check-analytics-liveness.mjs: an undici keep-alive socket is still open and
// the libuv assertion aborts the process on Windows. Set `process.exitCode`.
//
// Usage:  node tooling/ops/check-pages-deployments.mjs [--root DIR]
// Env:    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readUnits, plannedEnvironments, unitKeyFor, UNITS_REL } from '../ci/assert-deploy-triggers-deploy.mjs';
import { parseWorkflow } from '../ci/workflow-scan.mjs';
import { decide, gitAt, PlanRefusal } from '../ci/plan-deploy.mjs';
import {
  CouldNotLook,
  transientLook,
  readWithBoundedRetry,
} from './bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

// ── THE RETRY PRIMITIVES NOW LIVE IN tooling/ops/bounded-retry.mjs ──────────
// They were declared here by #852 and MOVED on 2026-09-21, unchanged, when the
// class sweep this row also asks for made eleven more readers need them. They
// are re-exported under their original names so this file's existing 82 cases
// keep importing them from here: that suite is the GREEN CONTROL for the move,
// because MOVED CODE SILENCES GUARDS and a refactor that nothing re-proves is
// evidence of nothing.
//
// 🔴 `isTransientLook` IS STILL NOT NAMED `isRetryable`. record-deployment.mjs
// exports a function by that name with a GitHub-shaped policy that deliberately
// excludes 429; two readings of "is this transient?" under one name is how they
// come to disagree silently.
export {
  CouldNotLook,
  transientLook,
  isTransientLook,
  READ_ATTEMPTS,
  RETRY_BASE_MS,
  backoffPlan,
  RETRY_CEILING_MS,
  readWithBoundedRetry,
} from './bounded-retry.mjs';

/** The directory under `sites/` that is not a site. Named once. */
const SITES_SHARED = '_shared';

/** THE PROJECT SET IS DERIVED, NEVER LISTED. A hand-written list here is a
 *  second copy of the deployment topology, and the copy is the one that rots —
 *  the same rule `deploy-web.yml`'s matrix obeys (`--emit-apps`, not a literal).
 *
 *  Two kinds, from two sources, because they are two different mechanisms:
 *
 *    GIT-CONNECTED — one per directory under `sites/` except `_shared`. These
 *      are the projects Cloudflare builds itself, and they are the ones with no
 *      witness anywhere else. `sites/<name>` is both the project name and the
 *      configured root directory (sites/nikatru/README.md), so ONE reading gives
 *      the project to query AND the path whose git history it must match.
 *      ⏱ 2026-09-26 [ADR 098]: EXCEPT a site a deploy-web.yml job publishes
 *      (siteLanes) — that directory is the DIRECT project the job names, carrying
 *      its deploy `unit`, and the git project of the same name is no longer
 *      derived; if it is kept, it is declared in ROLLBACK_ONLY_REL instead.
 *
 *    DIRECT-UPLOAD — one per `catalog/apps.json` slug. `deploy-web.yml` creates
 *      and uploads `--project-name=<slug>`, so a new app adds itself here by
 *      existing rather than by anyone remembering this file.
 *
 *  Returns `{ projects, rollbackOnly, problems }`. A `problem` is a READING
 *  failure (a missing or unparseable source), which the caller turns into exit 2
 *  — not into a shorter list. */
export function derivePagesProjects(root) {
  const projects = [];
  const problems = [];
  const sites = siteLanes(root);
  problems.push(...sites.problems);

  const sitesDir = join(root, 'sites');
  if (!existsSync(sitesDir)) {
    problems.push('sites/ does not exist, so no git-connected Pages project could be derived.');
  } else {
    const names = readdirSync(sitesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== SITES_SHARED)
      .map((d) => d.name)
      .sort();
    if (names.length === 0) {
      problems.push(`sites/ holds no site directory other than ${SITES_SHARED}/. The shape changed underneath this reader.`);
    }
    for (const name of names) {
      const lane = sites.bySite.get(name);
      if (lane) projects.push({ project: lane.project, kind: 'direct', unit: lane.unit, sourceDir: siteUnitLabel(lane) });
      else projects.push({ project: name, kind: 'git', sourceDir: `sites/${name}` });
    }
  }

  const cataloguePath = join(root, 'catalog', 'apps.json');
  if (!existsSync(cataloguePath)) {
    problems.push('catalog/apps.json does not exist, so no direct-upload Pages project could be derived.');
  } else {
    let rows;
    try {
      rows = JSON.parse(readFileSync(cataloguePath, 'utf8'));
    } catch (e) {
      problems.push(`catalog/apps.json did not parse: ${e.message}`);
      rows = null;
    }
    if (rows && !Array.isArray(rows)) {
      problems.push('catalog/apps.json is not an array. The shape changed underneath this reader.');
    } else if (rows) {
      if (rows.length === 0) {
        problems.push('catalog/apps.json is EMPTY, so the direct-upload half of this sweep would range over nothing.');
      }
      for (const r of rows) {
        if (!r || typeof r.slug !== 'string' || r.slug === '') {
          problems.push(`catalog/apps.json holds a row with no \`slug\`: ${JSON.stringify(r)}`);
          continue;
        }
        projects.push({ project: r.slug, kind: 'direct', sourceDir: DEPLOY_WEB_FILTER_LABEL });
      }
    }
  }

  const declared = readRollbackOnly(root);
  problems.push(...declared.problems);

  return { projects, rollbackOnly: declared.projects, problems };
}

/** The register that DECLARES a Pages project rollback-only. Named once. */
export const ROLLBACK_ONLY_REL = 'tooling/ops/pages-rollback-only.json';

/** Every field a rollback-only entry must carry, as a non-empty string. */
const ROLLBACK_FIELDS = ['pausedAt', 'servedBy', 'decision', 'why'];

/** The projects ROLLBACK_ONLY_REL declares, as `{ projects, problems }`. A missing
 *  or unparseable register is a problem (exit 2), never "nothing is paused": the
 *  file being gone would otherwise drop a paused project out of the sweep with
 *  nothing said, and nobody would see it regain a domain. */
export function readRollbackOnly(root) {
  const abs = join(root, ...ROLLBACK_ONLY_REL.split('/'));
  if (!existsSync(abs)) {
    return { projects: [], problems: [`${ROLLBACK_ONLY_REL} does not exist, so which Pages projects are kept for rollback only is unknown.`] };
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    return { projects: [], problems: [`${ROLLBACK_ONLY_REL} did not parse: ${e.message}`] };
  }
  const rows = doc?.projects;
  if (!rows || typeof rows !== 'object' || Array.isArray(rows)) {
    return { projects: [], problems: [`${ROLLBACK_ONLY_REL} holds no \`projects\` object. The shape changed underneath this reader.`] };
  }
  const projects = [];
  const problems = [];
  for (const [project, r] of Object.entries(rows)) {
    const missing = ROLLBACK_FIELDS.filter((k) => typeof r?.[k] !== 'string' || r[k].trim() === '');
    if (missing.length > 0) {
      problems.push(`${ROLLBACK_ONLY_REL} entry "${project}" lacks ${missing.join(', ')}, so its declaration cannot be checked.`);
    } else if (!Number.isFinite(Date.parse(r.pausedAt))) {
      problems.push(`${ROLLBACK_ONLY_REL} entry "${project}" has a pausedAt ${JSON.stringify(r.pausedAt)} that does not parse.`);
    } else {
      projects.push({ project, pausedAt: r.pausedAt, servedBy: r.servedBy, decision: r.decision });
    }
  }
  return { projects, problems };
}

/** `--project-name` values a job's code names literally. `${{ matrix.app }}` is
 *  not a name, so the app matrix job answers none. */
const projectNamesIn = (text) => [...new Set([...text.matchAll(/--project-name[= ]([A-Za-z0-9][A-Za-z0-9-]*)/g)].map((m) => m[1]))];

/** One tree glob `sites/<name>/**` as `<name>`, else null. */
const siteOfGlob = (g) => /^sites\/([^/*?[\]!+]+)\/\*\*$/.exec(g)?.[1] ?? null;

const jobText = (job) => job.lines.map((l) => l.text).join('\n');

/** Which `sites/<name>` directories a deploy-web.yml job publishes by Direct
 *  Upload, as `{ bySite: Map<name, { unit, job, project }>, problems }`. A job
 *  qualifies when it plans a LITERAL environment whose deployUnits entry claims
 *  `sites/<name>/**`; the project is the ONE `--project-name` that job's code
 *  names. Two names, none, or two jobs claiming one site is a problem, never a
 *  guess. No workflow or no unit file maps nothing, and every site stays
 *  git-connected — which the rollback-only declaration then turns red for a
 *  site whose git project is paused, so that fallback is never silent. */
export function siteLanes(root) {
  const bySite = new Map();
  const problems = [];
  const parsed = parseWorkflow(root, DEPLOY_WEB_REL);
  const units = readUnits(root);
  if (parsed === null || units === null || !(parsed.jobs instanceof Map)) return { bySite, problems };
  for (const job of parsed.jobs.values()) {
    const text = jobText(job);
    const keys = [
      ...new Set(
        plannedEnvironments(text)
          .filter((e) => !e.includes('${{'))
          .map((e) => unitKeyFor(units, e))
          .filter((k) => k !== null),
      ),
    ];
    for (const unit of keys) {
      const claimed = units[unit].map(siteOfGlob).filter((n) => n !== null && n !== SITES_SHARED);
      if (claimed.length === 0) continue;
      const names = projectNamesIn(text);
      if (names.length !== 1) {
        problems.push(
          `${DEPLOY_WEB_REL} job \`${job.name}\` plans deployUnits["${unit}"], which claims ` +
            `${claimed.map((n) => `sites/${n}/**`).join(', ')}, but its code names ${JSON.stringify(names)} as ` +
            '`--project-name`, so the Pages project serving that site is unknown.',
        );
        continue;
      }
      for (const site of claimed) {
        if (bySite.has(site)) {
          problems.push(`sites/${site} is published by two ${DEPLOY_WEB_REL} jobs (\`${bySite.get(site).job}\`, \`${job.name}\`), so which project serves it is unknown.`);
          continue;
        }
        bySite.set(site, { unit, job: job.name, project: names[0] });
      }
    }
  }
  return { bySite, problems };
}

const siteUnitLabel = ({ unit, job }) => `the deploy unit ${DEPLOY_WEB_REL} job \`${job}\` plans (${UNITS_REL} deployUnits["${unit}"])`;

/** The workflow that direct-uploads every catalogue app. Named once: the
 *  deploy unit it plans IS the source set of a direct-upload project, and its
 *  job timeouts ARE the window in which a newer commit may not be served yet.
 *  ⏱ 2026-09-25 [ADR 095 §4]: it has no `on.push.paths` any more — ci.yml calls
 *  it after ci-gate on every push to main, and its plan step publishes only for
 *  a commit its deployUnits entry claims, so the unit is the source set. */
export const DEPLOY_WEB_REL = '.github/workflows/deploy-web.yml';
const DEPLOY_WEB_FILTER_LABEL = `the deploy unit ${DEPLOY_WEB_REL} plans (${UNITS_REL} deployUnits)`;

/** How many full deploy-web runs the newest commit can wait through before it
 *  is served: its own, plus ONE in progress ahead of it. deploy-web.yml's
 *  concurrency group has `cancel-in-progress: false` on main, and GitHub keeps
 *  at most one PENDING run per group (a newer pending run replaces it), so no
 *  commit ever waits behind more than one running build. */
export const DEPLOY_LANE_RUNS = 2;

/** PURE. One GitHub `paths` glob as a git pathspec with the SAME meaning, or
 *  null when this reader cannot be sure it means the same thing. The shapes
 *  are the three `globClaims` in assert-deploy-triggers-deploy.mjs answers
 *  exactly — `X/**` (the tree), `X/*` / `X/*.ext` (files directly in X) and a
 *  literal path. Anything else — a `!` negation, `+`, `?`, a bracket, a `**`
 *  mid-pattern — is null, which the caller turns into exit 2: a pathspec that
 *  silently means something narrower is a freshness limb that silently grades
 *  against an OLDER commit. */
export function toPathspec(glob) {
  if (typeof glob !== 'string' || glob === '') return null;
  const tree = /^([^*?[\]!+]+)\/\*\*$/.exec(glob);
  if (tree) return `:(literal)${tree[1]}`;
  const files = /^([^*?[\]!+]+)\/\*(\.[A-Za-z0-9.]+)?$/.exec(glob);
  if (files) return `:(glob)${files[1]}/*${files[2] ?? ''}`;
  if (!/[*?[\]!+]/.test(glob)) return `:(literal)${glob}`;
  return null;
}

/** Every job's `timeout-minutes`, read off ONE parse of the workflow —
 *  `parseWorkflow` in tooling/ci/workflow-scan.mjs, whose job map already
 *  knows where a job starts and ends and has comments blanked — as
 *  `{ minutes: {job: n}, problems }`. A job without one runs for GitHub's
 *  default 360 minutes, which is not a ceiling anyone chose: a problem, not a
 *  number. Job keys sit at exactly four spaces (steps at six and deeper), so a
 *  STEP's `timeout-minutes` is never mistaken for the job's. */
export function jobTimeouts(parsed) {
  const minutes = {};
  const problems = [];
  if (!parsed || !(parsed.jobs instanceof Map)) return { minutes, problems: ['the workflow did not parse'] };
  if (parsed.jobs.size === 0) problems.push('the `jobs:` block holds no job');
  for (const [name, job] of parsed.jobs) {
    minutes[name] = null;
    for (const l of job.lines) {
      const t = /^ {4}timeout-minutes:\s*(\d+)\s*$/.exec(l.text);
      if (t) minutes[name] = Number(t[1]);
    }
    if (!Number.isInteger(minutes[name]) || minutes[name] <= 0) {
      problems.push(`job \`${name}\` declares no job-level \`timeout-minutes\` (GitHub's default is 360), so the lane has no chosen ceiling`);
    }
  }
  return { minutes, problems };
}

/** What a direct-upload project's commit limb is graded against, read from
 *  deploy-web.yml and the unit it plans: `{ pathspecs, ceilingMs, problems }`. A non-empty
 *  `problems` is exit 2 for every direct-upload project — never a pass, and
 *  never a fallback to `apps/<slug>`, which is narrower than what the lane
 *  deploys for and would grade against an OLDER commit. The workflow is read
 *  ONCE, through workflow-scan.mjs (O-LOCAL-SCRIPTS-PARSE-MOVED-WORKFLOWS), and
 *  every "cannot see it" case REFUSES out loud.
 *
 *  `unit` (⏱ 2026-09-26 [ADR 098]) names a site's deploy unit — `nikatru-site` —
 *  and selects the job(s) planning exactly that unit instead of the app matrix. */
export function deployLaneInputs(root, { unit } = {}) {
  const problems = [];
  const parsed = parseWorkflow(root, DEPLOY_WEB_REL);
  if (parsed === null) {
    return { pathspecs: [], globs: [], ceilingMs: null, problems: [`${DEPLOY_WEB_REL} does not exist`] };
  }

  // The unit is resolved the way assert-deploy-triggers-deploy.mjs limb 1 and
  // plan-deploy.mjs resolve it: from the environment the workflow's plan step names.
  // ⏱ 2026-09-25 · D3a (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE): deploy-web.yml runs a
  // SECOND publishing job, `site`, which plans `nikatru-site` for the apex site's own project.
  // The projects graded here are the apps', which the MATRIX job publishes, so the lane is the
  // job(s) planning a per-app environment (`${{ matrix.… }}`) plus every job they `needs`, and
  // the ceiling sums those. A workflow with no such job is read whole, as before.
  // ⏱ 2026-09-26: with `unit`, the lane is the job(s) planning THAT unit plus their `needs`,
  // and none is a problem — a site lane is never "the whole workflow".
  const units = readUnits(root);
  const lane = new Set();
  const addWithNeeds = (name) => {
    if (lane.has(name) || !parsed.jobs.has(name)) return;
    lane.add(name);
    for (const n of parsed.jobs.get(name).needs ?? []) addWithNeeds(n);
  };
  const inLane =
    unit === undefined
      ? (envs) => envs.some((e) => /\$\{\{\s*matrix\./.test(e))
      : (envs) => units !== null && envs.some((e) => !e.includes('${{') && unitKeyFor(units, e) === unit);
  for (const job of parsed.jobs.values()) {
    if (inLane(plannedEnvironments(jobText(job)))) addWithNeeds(job.name);
  }
  if (unit !== undefined && lane.size === 0) problems.push(`${DEPLOY_WEB_REL} has no job planning deployUnits["${unit}"]`);
  const laneJobs = lane.size > 0 || unit !== undefined ? [...parsed.jobs.values()].filter((j) => lane.has(j.name)) : [...parsed.jobs.values()];
  const keys =
    units === null
      ? []
      : [...new Set(plannedEnvironments(lane.size > 0 ? laneJobs.map(jobText).join('\n') : parsed.lines.map((l) => l.text).join('\n')).map((e) => unitKeyFor(units, e)))];
  const globs = units !== null && keys.length === 1 && keys[0] !== null ? units[keys[0]] : null;
  const pathspecs = [];
  if (!Array.isArray(globs) || globs.length === 0) {
    problems.push(
      `${DEPLOY_WEB_REL} plans no single readable deploy unit in ${UNITS_REL} (found ${JSON.stringify(keys)}), ` +
        'so the set of commits it deploys for is unknown',
    );
  } else {
    for (const g of globs) {
      const spec = toPathspec(g);
      if (spec === null) problems.push(`deployUnits["${keys[0]}"] entry ${JSON.stringify(g)} has a shape this reader cannot translate exactly`);
      else pathspecs.push(spec);
    }
  }

  const t = jobTimeouts(parsed);
  for (const p of t.problems) problems.push(`${DEPLOY_WEB_REL}: ${p}`);
  const total = laneJobs.reduce((s, j) => s + (Number.isInteger(t.minutes[j.name]) ? t.minutes[j.name] : 0), 0);
  const ceilingMs = t.problems.length === 0 ? DEPLOY_LANE_RUNS * total * 60 * 1000 : null;

  // `globs` is the unit as the planner reads it, for unitUnchangedBetween.
  return { pathspecs, globs: Array.isArray(globs) ? globs : [], ceilingMs, problems };
}

/** PURE. ONE project's answer turned into a verdict, so every branch is
 *  reachable from a test with no network and no git — the shell/pure split the
 *  ops readers in this directory already use.
 *
 *  `expectedCommit` is the SHA `main` says this project should be serving, or
 *  `null` for a project whose commit limb is ungraded (direct upload) or whose
 *  history could not be read.
 *
 *  `isAncestor(a, b)` answers "does commit b already carry commit a?" as
 *  true/false/null, null meaning UNREADABLE. It is injected rather than called
 *  here so this function stays pure and every branch stays reachable from a test
 *  with no git. It is consulted ONLY when the served commit differs from
 *  `expectedCommit`; when they are equal the question is already answered.
 *
 *  `now` (epoch ms) and `ceilingMs` are injected for the same reason: the
 *  in-flight branch turns on a build's AGE, and a test must be able to stand on
 *  either side of the ceiling without waiting for it.
 *
 *  `expectedAt` (epoch ms, the expected commit's committer time) and
 *  `laneCeilingMs` are read for DIRECT-UPLOAD projects only: a served commit
 *  that does not carry `expectedCommit` is ⏳ while the deploy lane may still
 *  be publishing it, and red past that. Either unreadable is exit 2 there.
 *
 *  `treeUnchanged(served, expected)` (⏱ 2026-09-27, FPI-1) is asked for a
 *  DIRECT-UPLOAD row only, and only once that row is known NOT to carry
 *  `expectedCommit`: true means deploy-web's planner reads the pair as
 *  `unchanged` and will never publish it, so the served build IS current;
 *  false or null (unreadable) leaves the verdict exactly as it was without it.
 *  Injected like `isAncestor`; the real one is unitUnchangedBetween.
 *
 *  Returns `{ code, line }`, plus `ungraded: true` on a row whose commit limb
 *  was not graded. `code` is 0, 1 or 2 with the file-level meaning. */
export function judgeProject({
  project,
  kind,
  sourceDir,
  deployments,
  expectedCommit,
  isAncestor = null,
  treeUnchanged = null,
  now = Date.now(),
  ceilingMs = IN_FLIGHT_CEILING_MS,
  expectedAt = null,
  laneCeilingMs = null,
}) {
  const at = `${project} (${kind})`;

  if (!Array.isArray(deployments)) {
    return { code: 2, line: `?   ${at} — the deployments answer was not an array, so NOTHING was judged.` };
  }
  if (deployments.length === 0) {
    return {
      code: 1,
      line:
        `✗   ${at} — the project has NO production deployment at all. Either it has never published, ` +
        `or its deployments were purged. Nothing is serving what this repository built.`,
    };
  }

  // 🔴 THE FILTER IS THE REQUEST; THIS IS THE ANSWER, CHECKED. `?env=production`
  // silently ignored by a future API version would hand us preview rows and this
  // guard would grade a branch build as the apex with nothing to notice.
  const foreign = deployments.filter((d) => d?.environment !== 'production');
  if (foreign.length > 0) {
    return {
      code: 2,
      line:
        `?   ${at} — the API answered with ${foreign.length} row(s) whose \`environment\` is ` +
        `${JSON.stringify(foreign[0]?.environment ?? null)} for a query that asked for \`production\`. ` +
        `The environment filter did not hold, so no verdict about production is available.`,
    };
  }

  const newest = deployments[0];
  const stage = newest?.latest_stage;
  const cls = classifyStage(stage);
  const id = newest?.id ?? '(no id)';
  const ctx = { at, kind, sourceDir, expectedCommit, isAncestor, treeUnchanged, now, expectedAt, laneCeilingMs };

  if (cls === 'unreadable') {
    return {
      code: 2,
      line: `?   ${at} — the newest production deployment carries no readable \`latest_stage\`, so NOTHING was judged.`,
    };
  }

  if (cls === 'unknown') {
    return {
      code: 2,
      line:
        `?   ${at} — the newest production deployment ${id} reports stage \`${stage.name}\` with status ` +
        `\`${stage.status}\`, which is outside Cloudflare's published enum (${[...STAGE_KNOWN].join(', ')}). ` +
        `Whether that is running, landed or failed is not known here, so NOTHING was judged.`,
    };
  }

  if (cls === 'failed') {
    return {
      code: 1,
      line:
        `✗   ${at} — the newest production deployment ${id} stopped at stage \`${stage.name}\` with status ` +
        `\`${stage.status}\`. Production is therefore still serving the PREVIOUS build, which answers 200 with ` +
        `older bytes — the state that looks healthy from outside. Cloudflare posts no commit status for this ` +
        `build, so this line is the only place it is ever reported.`,
    };
  }

  if (cls === 'inflight') return judgeInFlight(deployments, ctx, { now, ceilingMs });

  return gradeCompleted(newest, ctx);
}

/** THE CEILING ON "STILL BUILDING". Measured 2026-09-19 over the 50 newest
 *  production deployments of the two git-connected projects (`nikatru`,
 *  `rajasekarselvam`): created_on → deploy-stage end took 14–45 s, of which
 *  the `queued` stage alone was up to 32 s. Thirty minutes is ~40× the slowest
 *  build seen, so a build still running at that age is STUCK, not slow; and it
 *  is well inside the gap between two ops-watch slots, so a build this run
 *  excuses as young is past the ceiling — graded, or red as stuck — at the
 *  next slot at the latest. It is a named constant, not a literal in a branch,
 *  so the test pins it and a change to it is a reviewed diff. */
export const IN_FLIGHT_CEILING_MS = 30 * 60 * 1000;

/** How many production rows one read asks for. The in-flight branch needs the
 *  newest COMPLETED deployment behind the running one, which is row 1 unless
 *  several pushes landed inside one build window; ten covers a burst of nine.
 *  No completed row among them is exit 2, never a pass. */
export const DEPLOYMENTS_PER_PAGE = 10;

/** Cloudflare's published `latest_stage.status` enum (API reference, Pages
 *  deployments, read 2026-09-19): success, idle, active, failure, canceled.
 *  Stage names: queued, initialize, clone_repo, build, deploy. */
const STAGE_FAILED = new Set(['failure', 'canceled']);
const STAGE_RUNNING = new Set(['active', 'idle']);
const STAGE_KNOWN = new Set(['success', ...STAGE_RUNNING, ...STAGE_FAILED]);

/** PURE. One `latest_stage` read as one of five things:
 *    'done'       `deploy` / `success` — the build landed.
 *    'failed'     `failure` or `canceled` at ANY stage — terminal, and red.
 *    'inflight'   `active` / `idle` at any stage, OR `success` at a stage that
 *                 is not `deploy` — a stage passed and the next has not been
 *                 reported yet, which is still a build in progress.
 *    'unknown'    a status outside the enum — exit 2, not a guess either way.
 *    'unreadable' no stage, or a name/status that is not a string — exit 2. */
export function classifyStage(stage) {
  if (!stage || typeof stage.name !== 'string' || typeof stage.status !== 'string') return 'unreadable';
  if (STAGE_FAILED.has(stage.status)) return 'failed';
  if (stage.status === 'success') return stage.name === 'deploy' ? 'done' : 'inflight';
  if (STAGE_RUNNING.has(stage.status)) return 'inflight';
  return 'unknown';
}

const short = (h) => (typeof h === 'string' ? h.slice(0, 7) : String(h));

/** The newest production deployment is still building. Its AGE decides what
 *  that means, and age comes from Cloudflare's own `created_on` against the
 *  clock — never from "it was running when I looked", which is true of every
 *  build for some seconds and of a stuck one forever.
 *
 *  Young: the newest COMPLETED production deployment behind it is graded with
 *  every limb `gradeCompleted` has, because that is what production serves
 *  right now. One case needs the building row: the completed deployment may
 *  legitimately PREDATE the newest commit touching the site directory, because
 *  the build for that commit is the one running. That is ⏳ and exit 0 only
 *  when the building commit itself carries the expected one; a running build
 *  that ALSO does not carry it means the build for that commit never started. */
function judgeInFlight(deployments, ctx, { now, ceilingMs }) {
  const { at, expectedCommit, isAncestor } = ctx;
  const building = deployments[0];
  const bid = building.id ?? '(no id)';
  const bstage = building.latest_stage;
  const bcommit = building.deployment_trigger?.metadata?.commit_hash ?? null;

  const created = typeof building.created_on === 'string' ? Date.parse(building.created_on) : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(now)) {
    return {
      code: 2,
      line:
        `?   ${at} — the newest production deployment ${bid} is IN FLIGHT (stage \`${bstage.name}\` ` +
        `\`${bstage.status}\`) but its \`created_on\` ${JSON.stringify(building.created_on ?? null)} does not ` +
        `parse, so whether it is building or STUCK cannot be told. NOTHING was judged.`,
    };
  }
  const ageMs = Math.max(0, now - created);
  const age = `${Math.round(ageMs / 1000)} s`;
  const what = `deployment ${bid} (commit ${short(bcommit)}, ${age} old, stage \`${bstage.name}\` \`${bstage.status}\`)`;

  if (ageMs > ceilingMs) {
    return {
      code: 1,
      line:
        `✗   ${at} — STUCK BUILD: ${what} is still in flight past the ${Math.round(ceilingMs / 60000)}-minute ` +
        `ceiling. Builds of this project take well under a minute, so this one is not slow, it is not going to ` +
        `land, and production is serving the PREVIOUS build.`,
    };
  }

  const i = deployments.findIndex((d, k) => k > 0 && classifyStage(d?.latest_stage) !== 'inflight');
  if (i === -1) {
    return {
      code: 2,
      line:
        `?   ${at} — ${what} is IN FLIGHT, and none of the ${deployments.length - 1} older production row(s) ` +
        `read is COMPLETED, so there is no landed build to grade. NOTHING was judged.`,
    };
  }

  const prev = deployments[i];
  const pcls = classifyStage(prev.latest_stage);
  const pid = prev.id ?? '(no id)';
  if (pcls === 'failed') {
    return {
      code: 1,
      line:
        `✗   ${at} — ${what} is in flight, but the newest COMPLETED production deployment ${pid} stopped at ` +
        `stage \`${prev.latest_stage.name}\` with status \`${prev.latest_stage.status}\`. Production is serving ` +
        `an OLDER build still, and a new build starting does not excuse the one that failed.`,
    };
  }
  if (pcls !== 'done') {
    return {
      code: 2,
      line:
        `?   ${at} — ${what} is in flight, and the completed deployment behind it (${pid}) carries a ` +
        `\`latest_stage\` this reader cannot classify (${JSON.stringify(prev.latest_stage ?? null)}). NOTHING was judged.`,
    };
  }

  const g = gradeCompleted(prev, ctx);
  const tail = `the next ops-watch slot grades ${bid}.`;

  if (g.code === 0) {
    return {
      code: 0,
      inflight: true,
      ...(g.ungraded ? { ungraded: true } : {}),
      line: `⏳  ${at} — ${what} is IN FLIGHT; ${tail} Serving now: ${g.line.replace(/^(ok|⏳)\s+/u, '')}`,
    };
  }

  if (g.behind) {
    // The completed build predates the expected commit. Legitimate ONLY when the
    // running build is the one carrying it.
    const carries =
      bcommit === expectedCommit
        ? true
        : typeof bcommit === 'string' && typeof isAncestor === 'function'
          ? isAncestor(expectedCommit, bcommit)
          : null;
    if (carries === true) {
      return {
        code: 0,
        inflight: true,
        line:
          `⏳  ${at} — ${what} is IN FLIGHT and carries ${short(expectedCommit)}, the newest \`main\` commit ` +
          `touching ${ctx.sourceDir}; production still serves ${pid} at ${short(g.served)}, which predates it. ` +
          `That is the build window, not a missed build — ${tail}`,
      };
    }
    if (carries === null) {
      return {
        code: 2,
        line:
          `?   ${at} — ${what} is in flight and the completed ${pid} does not carry ${short(expectedCommit)}; ` +
          `whether the BUILDING commit carries it could not be read, so NOTHING was judged.`,
      };
    }
    return { code: 1, line: `${g.line} The build in flight (${bid}, commit ${short(bcommit)}) does not carry it either.` };
  }

  return { code: g.code, line: `${g.line} (Graded behind ${what}, which is in flight.)` };
}

/** One deployment already known to be DONE (`deploy` / `success`), graded on
 *  its commit limb. `behind: true` marks the one red an in-flight build can
 *  legitimately explain; `served` is carried out for that caller's line. */
function gradeCompleted(dep, { at, kind, sourceDir, expectedCommit, isAncestor, treeUnchanged, now, expectedAt, laneCeilingMs }) {
  const id = dep.id ?? '(no id)';
  const trigger = dep.deployment_trigger ?? {};
  const served = trigger?.metadata?.commit_hash ?? null;
  const hasHash = typeof served === 'string' && served !== '';

  // UNGRADED only where it is TRUE: a direct upload whose row carries no hash.
  // A row that does carry one is graded below exactly like a git-connected one
  // (measured 2026-09-19: every `subscriptiontracker` row carries one).
  if (kind === 'direct' && !hasHash) {
    return {
      code: 0,
      ungraded: true,
      line:
        `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`; commit limb UNGRADED ` +
        `(trigger \`${trigger.type ?? 'unknown'}\` carries no commit_hash on THIS row; ` +
        `its commit witness is record-deployment.mjs, read by check-prod-provenance.mjs on the pipeline B-17 rail).`,
    };
  }

  if (typeof expectedCommit !== 'string' || expectedCommit === '') {
    return {
      code: 2,
      line:
        `?   ${at} — deployment ${id} succeeded serving ${short(served)}, but no expected commit for ` +
        `${sourceDir} was supplied, so the freshness question is unanswered rather than answered "fine".`,
    };
  }

  if (!hasHash) {
    return {
      code: 2,
      line:
        `?   ${at} — deployment ${id} succeeded, but \`deployment_trigger.metadata.commit_hash\` is ` +
        `${JSON.stringify(served)} on a GIT-CONNECTED project. Nothing identifies WHICH commit is live, so the ` +
        `freshness question is unanswered rather than answered "fine".`,
    };
  }

  // 🔴 THE QUESTION IS CONTAINMENT, NOT EQUALITY, AND `!==` ASKS THE WRONG ONE.
  // Cloudflare's git integration builds EVERY push to `main`, not only the ones
  // touching this project's source directory, so a healthy deployment normally
  // serves a commit AHEAD of `expectedCommit`. Equality holds only in the window
  // between a source-touching commit and the next push of any kind, which on a
  // busy day is minutes. The real defect — "the build for that commit never ran"
  // — is `served` being strictly BEHIND `expectedCommit`, i.e. not carrying it.
  //
  // Measured 2026-09-09: ops-watch run 34379156976 called BOTH `nikatru` and
  // `rajasekarselvam` RED while each served 2dd81ff, a DESCENDANT of the commit
  // it was accused of missing (bf04fc6 and c72701c respectively, both ancestors).
  // That false red is not free: `duty.workflow.ops-watch.yml` then reads RED
  // SINCE in assert-ops-register.mjs, which reddened `Guards — platform, data
  // and ops` on EVERY open pull request at once.
  //
  // An unreadable ancestry is exit 2, never a pass: a shallow clone that cannot
  // see the served commit has not judged this, and saying "fine" there is the
  // blind-pass this whole file exists to refuse.
  if (served !== expectedCommit) {
    const carries = typeof isAncestor === 'function' ? isAncestor(expectedCommit, served) : null;

    if (carries === null) {
      return {
        code: 2,
        line:
          `?   ${at} — deployment ${id} is serving ${short(served)} and \`main\` names ${short(expectedCommit)} ` +
          `for ${sourceDir}, but whether the served commit CARRIES that one could not be read from this ` +
          `checkout. The freshness question is unanswered rather than answered "fine".`,
      };
    }

    if (carries === false && kind === 'direct') {
      // FPI-1: the planner's question before this reader's verdict. Only `true`
      // changes anything; false and null (unreadable) fall through unchanged.
      const same = typeof treeUnchanged === 'function' ? treeUnchanged(served, expectedCommit) : null;
      if (same === true) {
        return {
          code: 0,
          line:
            `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`, serving ${short(served)}, which does not ` +
            `contain ${short(expectedCommit)}, but the unit's files are identical between them (deploy-web planned ` +
            `"unchanged") — current.`,
        };
      }
      return gradeDirectBehind({ at, id, served, sourceDir, expectedCommit, now, expectedAt, laneCeilingMs });
    }

    if (carries === false) {
      return {
        code: 1,
        behind: true,
        served,
        line:
          `✗   ${at} — deployment ${id} succeeded, but it is serving commit ${short(served)}, which does NOT ` +
          `carry ${short(expectedCommit)} — the newest commit on \`main\` touching ${sourceDir}. The Cloudflare ` +
          `build for ${short(expectedCommit)} never ran or never finished. This is invisible on the Actions page ` +
          `by construction: the build happens on Cloudflare's side of the wire and posts no status here.`,
      };
    }

    return {
      code: 0,
      line:
        `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`, serving ${short(served)}, which is AHEAD of ` +
        `${short(expectedCommit)}, the newest \`main\` commit touching ${sourceDir}, and carries it.`,
    };
  }

  return {
    code: 0,
    line: `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`, serving ${short(served)}, the newest \`main\` commit touching ${sourceDir}.`,
  };
}

/** A DIRECT-UPLOAD row serving a commit that does not carry the one `main`
 *  names. Cloudflare shows no in-flight row for a direct upload — the row is
 *  created when wrangler uploads, minutes after the merge — so the deploy
 *  lane's own window stands in for `created_on`: the expected commit's
 *  committer time (a squash merge's is the merge) against the ceiling derived
 *  from deploy-web.yml. Inside it is ⏳, past it is RED, unreadable is exit 2. */
function gradeDirectBehind({ at, id, served, sourceDir, expectedCommit, now, expectedAt, laneCeilingMs }) {
  if (!Number.isFinite(expectedAt) || !Number.isFinite(laneCeilingMs) || laneCeilingMs <= 0 || !Number.isFinite(now)) {
    return {
      code: 2,
      line:
        `?   ${at} — deployment ${id} serves ${short(served)}, which does not carry ${short(expectedCommit)}, the ` +
        `newest \`main\` commit touching ${sourceDir}; whether the deploy lane is still inside its window cannot be ` +
        `told (commit time ${JSON.stringify(expectedAt)}, ceiling ${JSON.stringify(laneCeilingMs)}). NOTHING was judged.`,
    };
  }
  const ageMs = Math.max(0, now - expectedAt);
  const age = `${Math.round(ageMs / 60000)} min`;
  const ceiling = `${Math.round(laneCeilingMs / 60000)}-minute`;
  if (ageMs <= laneCeilingMs) {
    return {
      code: 0,
      inflight: true,
      line:
        `⏳  ${at} — deployment ${id} serves ${short(served)}; ${short(expectedCommit)}, the newest \`main\` commit ` +
        `touching ${sourceDir}, landed ${age} ago, inside the ${ceiling} deploy-lane ceiling. That is the ` +
        `deploy-web window, not a missed deploy — the next ops-watch slot grades it.`,
    };
  }
  return {
    code: 1,
    behind: true,
    served,
    line:
      `✗   ${at} — deployment ${id} succeeded, but it is serving commit ${short(served)}, which does NOT carry ` +
      `${short(expectedCommit)} — the newest commit on \`main\` touching ${sourceDir}, landed ${age} ago, past the ` +
      `${ceiling} deploy-lane ceiling. The deploy-web run for ${short(expectedCommit)} never ran, failed, or did not ` +
      `publish, and production is serving an older build of this app.`,
  };
}

/** The ancestry question `judgeProject` cannot ask for itself: does `descendant`
 *  already carry `ancestor`? true / false / null, where null is UNREADABLE and
 *  the caller must turn it into exit 2 rather than a pass.
 *
 *  ⚠️ `git merge-base --is-ancestor` uses its EXIT CODE as the answer: 0 is yes,
 *  1 is no, and anything else (128 for an object this checkout does not have) is
 *  an ERROR that must not be read as "no". ops-watch.yml checks out with
 *  `fetch-depth: 0` precisely so both commits are present. */
export function isAncestorOf(root, ancestor, descendant, run = spawnSync) {
  const sha = /^[0-9a-f]{7,40}$/i;
  if (typeof ancestor !== 'string' || typeof descendant !== 'string') return null;
  if (!sha.test(ancestor) || !sha.test(descendant)) return null;

  const r = run('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: root, encoding: 'utf8' });
  if (r.error) return null;
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  return null;
}

/** The `treeUnchanged` question, answered by deploy-web's PLANNER and not by a
 *  second copy of it (⏱ 2026-09-27, FPI-1): `decide()` from plan-deploy.mjs,
 *  with target = `expected` and live = `served`, over the unit's own `globs` —
 *  the call that printed `decision=unchanged … "matched":[]` for 646e00c1 →
 *  e9b256b8. true for `unchanged`, false for `changed`, and null for every
 *  other answer and every PlanRefusal (a shallow clone, a commit this checkout
 *  lacks, a failed diff): an unanswerable read is never a pass. `git` is the
 *  planner's own `gitAt(root)` shape, injected so a test needs no repository. */
export function unitUnchangedBetween(served, expected, globs, git) {
  const sha = /^[0-9a-f]{7,40}$/i;
  if (typeof served !== 'string' || typeof expected !== 'string' || !sha.test(served) || !sha.test(expected)) return null;
  if (!Array.isArray(globs) || globs.length === 0) return null;
  let verdict;
  try {
    verdict = decide({ target: expected, lastSuccess: served, globs, git });
  } catch (e) {
    if (e instanceof PlanRefusal) return null;
    throw e;
  }
  if (verdict.decision === 'unchanged') return true;
  if (verdict.decision === 'changed') return false;
  return null;
}

/** PURE. The whole sweep's verdict from the per-project ones. The WORST code
 *  wins and 2 outranks 1: "some of it was not judged" is a strictly worse state
 *  than "one of the things I did judge is broken", because the unjudged half
 *  could hold anything. */
export function foldVerdicts(results, { projectsSwept, ungraded }) {
  const code = results.reduce((worst, r) => (r.code === 2 || worst === 2 ? 2 : Math.max(worst, r.code)), 0);
  const lines = results.map((r) => r.line);
  const reds = results.filter((r) => r.code === 1).length;
  const unknowns = results.filter((r) => r.code === 2).length;
  const inflight = results.filter((r) => r.code === 0 && r.inflight === true).length;
  return { code, lines, reds, unknowns, inflight, projectsSwept, ungraded };
}

/** PURE. One DECLARED rollback-only project against its live project record
 *  (GET /pages/projects/{name}), plus the derived set it must not be part of.
 *
 *  RED (1) when the declaration and the repository disagree — the project is
 *  still DERIVED as serving a site or an app, or its `servedBy` is not derived at
 *  all — and when the account disagrees with it: a domain outside `*.pages.dev`,
 *  any of Git deployments, production deployments or previews back ON, or
 *  ⏱ 2026-10-01 (PB-20, row O-PAUSED-PAGES-PROJECT-NIKATRU) a NEWEST deployment
 *  (`latest_deployment.created_on`) made AFTER `pausedAt`. The switches say no
 *  build will run; this says none HAS since the pause, so the copy it keeps for
 *  rollback is still the one it was paused on, and not a build nothing gated.
 *  NOT JUDGED (2) when the record does not carry those fields in the shapes read:
 *  a Direct Upload project has no switch to be off, so "paused" cannot be read;
 *  and a record with no dated newest deployment has no build to keep.
 *  Otherwise 0, once, as `rollback-only (paused)` — its freshness is not judged. */
export function judgeRollbackOnly({ project, pausedAt, servedBy, decision, answer, derived = [] }) {
  const serving = derived.find((p) => p.project === project);
  if (serving) {
    return {
      code: 1,
      line:
        `✗   ${project} — DECLARED rollback-only in ${ROLLBACK_ONLY_REL} (${decision}), yet ${serving.sourceDir} still ` +
        `derives it as the ${serving.kind} project SERVING it. The declaration and the deploy topology disagree: either ` +
        `the site moved back and the entry must go, or the job that publishes it elsewhere is gone.`,
    };
  }
  if (!derived.some((p) => p.project === servedBy)) {
    return {
      code: 1,
      line:
        `✗   ${project} — DECLARED rollback-only in ${ROLLBACK_ONLY_REL}, served by \`${servedBy}\`, but no site ` +
        `directory or catalogue slug derives \`${servedBy}\`, so nothing this sweep grades serves what ${project} used to.`,
    };
  }
  if (!answer || typeof answer !== 'object' || answer.name !== project) {
    return { code: 2, line: `?   ${project} — the project record did not come back as project "${project}", so NOTHING was judged.` };
  }
  if (!Array.isArray(answer.domains) || !answer.domains.every((d) => typeof d === 'string')) {
    return { code: 2, line: `?   ${project} — the project record's \`domains\` is ${JSON.stringify(answer.domains ?? null)}, not a list of names, so whether it holds a custom domain is unknown. NOTHING was judged.` };
  }
  const config = answer.source?.config;
  const kind = typeof answer.source?.type === 'string' ? 'git' : 'direct';
  const at = `${project} (${kind})`;
  const custom = answer.domains.filter((d) => !d.endsWith('.pages.dev'));
  if (custom.length > 0) {
    return {
      code: 1,
      line:
        `✗   ${at} — DECLARED rollback-only (paused since ${pausedAt}) but it holds custom domain(s) ${custom.join(', ')}. ` +
        `A paused project serves the build it was paused on and nothing refreshes it: move the domain back to ` +
        `${servedBy}, or remove the entry from ${ROLLBACK_ONLY_REL} so this project is graded again.`,
    };
  }
  if (
    !config ||
    typeof config.deployments_enabled !== 'boolean' ||
    typeof config.production_deployments_enabled !== 'boolean' ||
    typeof config.preview_deployment_setting !== 'string'
  ) {
    return {
      code: 2,
      line:
        `?   ${at} — DECLARED rollback-only, but the record carries no Git source with \`deployments_enabled\`, ` +
        `\`production_deployments_enabled\` and \`preview_deployment_setting\` (source ${JSON.stringify(answer.source?.type ?? null)}), ` +
        `so whether its deployments are OFF cannot be read. NOTHING was judged.`,
    };
  }
  const on = [];
  if (config.deployments_enabled !== false) on.push('deployments_enabled=true');
  if (config.production_deployments_enabled !== false) on.push('production_deployments_enabled=true');
  if (config.preview_deployment_setting !== 'none') on.push(`preview_deployment_setting=${JSON.stringify(config.preview_deployment_setting)}`);
  if (on.length > 0) {
    return {
      code: 1,
      line:
        `✗   ${at} — DECLARED rollback-only (paused since ${pausedAt}) but its deployments are back ON: ${on.join(', ')}. ` +
        `Cloudflare builds it again on the next push, outside every gate; switch them off, or remove the entry from ` +
        `${ROLLBACK_ONLY_REL} so this project is graded again.`,
    };
  }
  const newestAt = answer.latest_deployment?.created_on;
  const newestMs = typeof newestAt === 'string' ? Date.parse(newestAt) : NaN;
  if (!Number.isFinite(newestMs)) {
    return {
      code: 2,
      line:
        `?   ${at} — DECLARED rollback-only, but the record's \`latest_deployment.created_on\` is ` +
        `${JSON.stringify(newestAt ?? null)}, so whether a build landed after the pause (${pausedAt}) cannot be read. ` +
        `NOTHING was judged.`,
    };
  }
  if (newestMs > Date.parse(pausedAt)) {
    return {
      code: 1,
      line:
        `✗   ${at} — DECLARED rollback-only (paused since ${pausedAt}) but its newest deployment ` +
        `${answer.latest_deployment.id ?? '(no id)'} was created ${newestAt}, AFTER the pause. The copy it keeps for ` +
        `rollback is no longer the build it was paused on, and nothing gated the one that replaced it: find what ` +
        `deployed it, and re-declare or remove the entry in ${ROLLBACK_ONLY_REL} once the project is understood.`,
    };
  }
  return {
    code: 0,
    rollbackOnly: true,
    line:
      `ok  ${at} — rollback-only (paused): Git deployments, production deployments and previews all OFF, no custom ` +
      `domain (${answer.domains.join(', ') || 'none'}), newest deployment ${newestAt}, not after the pause; declared in ` +
      `${ROLLBACK_ONLY_REL} (${decision}, paused ${pausedAt}), so its freshness is NOT judged — ${servedBy} serves what it used to.`,
  };
}

/** The newest commit on `main` that touched a path. `null` when the history is
 *  unreadable — which the caller must turn into exit 2, never into a pass.
 *
 *  ⚠️ `origin/main`, NOT `HEAD`. ops-watch runs on a schedule and its checkout is
 *  main, but a dispatched run from a branch would otherwise compare Cloudflare's
 *  production build against a branch tip and report a false red. */
export function newestCommitTouching(root, path, run = spawnSync) {
  const specs = Array.isArray(path) ? path : [path];
  if (specs.length === 0) return null;
  const r = run('git', ['log', '-1', '--format=%H', 'origin/main', '--', ...specs], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return null;
  const sha = (r.stdout ?? '').trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** A commit's COMMITTER time as epoch ms, or null when unreadable. For a squash
 *  merge on GitHub the committer time is the merge, which is when deploy-web's
 *  push run is created — the start of the deploy-lane window. */
export function commitTimeOf(root, sha, run = spawnSync) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) return null;
  const r = run('git', ['log', '-1', '--format=%cI', sha], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const t = Date.parse((r.stdout ?? '').trim());
  return Number.isFinite(t) ? t : null;
}

/** PURE. A read that never produced an answer, as one project's verdict. It is
 *  exit 2 and it is exit 2 AFTER the retry too: the bounded retry decides
 *  whether we ask again, never whether a failure counts. Extracted from `main`
 *  so a test can stand on the whole chain — persistent transient failure →
 *  `readWithBoundedRetry` → here → `foldVerdicts` — with no network. */
export function readFailureResult(project, kind, err) {
  const how = err instanceof CouldNotLook ? err.message : `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`;
  return { code: 2, line: `?   ${project} (${kind}) — ${how}` };
}

const CF_API = 'https://api.cloudflare.com/client/v4';

/** HTTP statuses that mean "ask again", not "no". 429 is the rate limiter and
 *  every 5xx is the API's own side failing; both are the same class of event as
 *  a dropped connection. Every other non-200 is an ANSWER and is final. */
const RETRYABLE_STATUS = (status) => status === 429 || (status >= 500 && status <= 599);

/** ONE read of one project's production deployments. `fetchImpl` and `env` are
 *  injected so every branch — including the transport failing, which is the one
 *  that went red in production — is reachable from a test with NO network. */
export async function readDeployments(project, opts = {}) {
  return readPagesApi(project, `/deployments?env=production&per_page=${DEPLOYMENTS_PER_PAGE}`, '/deployments', opts);
}

/** ONE read of one project's own record — its `domains` and its Git source's
 *  deployment switches — for a project declared rollback-only. The same
 *  transport, the same retry shapes, the same exit-2 answers as readDeployments. */
export async function readProject(project, opts = {}) {
  return readPagesApi(project, '', '', opts);
}

async function readPagesApi(project, query, label, { fetchImpl = fetch, env = process.env, signal } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment');
  }
  const url = `${CF_API}/accounts/${account}/pages/projects/${encodeURIComponent(project)}${query}`;
  const what = `GET pages/projects/${project}${label}`;

  // 🔴 THE THROW THAT FROZE THE MERGE QUEUE. `fetch` rejects — `TypeError: fetch
  // failed` — when the connection never completed, which says NOTHING about
  // Cloudflare and everything about one TCP socket. It is the transient shape.
  let res;
  let text;
  try {
    res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal });
    text = await res.text();
  } catch (e) {
    throw transientLook(`${what} did not complete at all — ${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`);
  }

  if (!res.ok) {
    const line = `${what} answered HTTP ${res.status}: ${text.slice(0, 400)}`;
    throw RETRYABLE_STATUS(res.status) ? transientLook(line) : new CouldNotLook(line);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CouldNotLook(`${what} answered unparseable JSON: ${text.slice(0, 200)}`);
  }
  if (body?.success !== true) {
    throw new CouldNotLook(`Cloudflare reported success=false for ${project}: ${JSON.stringify(body?.errors ?? null).slice(0, 400)}`);
  }
  return body.result;
}

async function main() {
  const { projects, rollbackOnly, problems } = derivePagesProjects(ROOT);

  if (problems.length > 0 || projects.length === 0) {
    console.error('✗ COULD NOT LOOK — the Pages project set did not derive, so NOTHING was swept:');
    for (const p of problems) console.error(`    ${p}`);
    if (projects.length === 0) console.error('    the derived project set is EMPTY, which prints the same ok as a complete sweep.');
    process.exitCode = 2;
    return;
  }

  const results = [];
  const appLane = projects.some((p) => p.kind === 'direct' && p.unit === undefined) ? deployLaneInputs(ROOT) : null;
  const planGit = gitAt(ROOT);

  for (const p of projects) {
    let expectedCommit = null;
    let expectedAt = null;
    // A site published by a deploy-web job is graded against ITS unit and ITS job's window.
    const lane = p.unit === undefined ? appLane : deployLaneInputs(ROOT, { unit: p.unit });
    if (p.kind === 'git') {
      expectedCommit = newestCommitTouching(ROOT, p.sourceDir, spawnSync);
    } else {
      if (lane.problems.length > 0) {
        results.push({
          code: 2,
          line:
            `?   ${p.project} (direct) — the deploy lane's inputs did not read, so the commit limb has nothing to ` +
            `grade against: ${lane.problems.join('; ')}.`,
        });
        continue;
      }
      expectedCommit = newestCommitTouching(ROOT, lane.pathspecs, spawnSync);
      expectedAt = expectedCommit === null ? null : commitTimeOf(ROOT, expectedCommit, spawnSync);
    }
    if (expectedCommit === null) {
      results.push({
        code: 2,
        line:
          `?   ${p.project} (${p.kind}) — \`git log origin/main -- <${p.sourceDir}>\` produced no commit. The history is ` +
          `unreadable here (a shallow clone has no origin/main), so the freshness limb was NOT executed.`,
      });
      continue;
    }

    try {
      const deployments = await readWithBoundedRetry((_attempt, { signal }) => readDeployments(p.project, { signal }), {
        note: (m) => console.log(`    ⟳   ${p.project} (${p.kind}) — ${m}`),
      });
      results.push(
        judgeProject({
          ...p,
          deployments,
          expectedCommit,
          isAncestor: (a, b) => isAncestorOf(ROOT, a, b, spawnSync),
          treeUnchanged: p.kind === 'direct' ? (a, b) => unitUnchangedBetween(a, b, lane.globs, planGit) : null,
          expectedAt,
          laneCeilingMs: lane?.ceilingMs ?? null,
        }),
      );
    } catch (e) {
      results.push(readFailureResult(p.project, p.kind, e));
    }
  }

  // Each DECLARED rollback-only project, once: never graded for freshness, always read.
  for (const r of rollbackOnly) {
    try {
      const answer = await readWithBoundedRetry((_attempt, { signal }) => readProject(r.project, { signal }), {
        note: (m) => console.log(`    ⟳   ${r.project} (rollback-only) — ${m}`),
      });
      results.push(judgeRollbackOnly({ ...r, answer, derived: projects }));
    } catch (e) {
      results.push(readFailureResult(r.project, 'rollback-only', e));
    }
  }

  const ungraded = results.filter((r) => r.ungraded === true).length;
  const verdict = foldVerdicts(results, { projectsSwept: projects.length, ungraded });

  console.log(
    `⬜  MONITOR · Cloudflare Pages production deployments · ${verdict.projectsSwept} project(s) DERIVED ` +
      `(${verdict.ungraded} with the commit limb UNGRADED because the served row carries no commit_hash), ` +
      `${rollbackOnly.length} declared ROLLBACK-ONLY in ${ROLLBACK_ONLY_REL}`,
  );
  for (const line of verdict.lines) console.log(`    ${line}`);

  if (verdict.code === 0) {
    console.log(
      verdict.inflight === 0
        ? `ok  every derived Pages project's newest PRODUCTION deployment succeeded and is at the commit main names, ` +
            `or at one whose unit files are identical to it.`
        : `ok  every derived Pages project's served PRODUCTION deployment passed; ${verdict.inflight} newer build(s) still ` +
            `IN FLIGHT inside the ceiling, each named ⏳ above, which the next slot grades.`,
    );
  } else {
    console.error('');
    console.error(
      `✗ ${verdict.reds} project(s) RED, ${verdict.unknowns} NOT JUDGED. A Cloudflare Git build posts no commit ` +
        `status, opens no GitHub Deployment and appears in no Actions run, so this reader is the only observer it has.`,
    );
  }
  process.exitCode = verdict.code;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
