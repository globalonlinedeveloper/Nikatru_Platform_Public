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
//   · `deployment_trigger.metadata.commit_hash`, for GIT-CONNECTED projects
//     only, against the newest commit on `main` that touched the project's
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
//   ⚠️ DIRECT-UPLOAD PROJECTS CARRY NO COMMIT. `wrangler pages deploy` produces
//   `deployment_trigger.type: "ad_hoc"` with no `metadata.commit_hash`, so
//   asserting a hash there would fail for the wrong reason on a good deploy and
//   be "fixed" by deleting the assertion. Their stage is graded; their commit
//   limb is declared UNGRADED and counted, so the number of ungraded projects is
//   printed rather than hidden. Their commit witness is `record-deployment.mjs`,
//   which is a different rail, read by tooling/ops/check-prod-provenance.mjs (pipeline B-17).
//
// ── THREE-VALUED, AND 2 IS NOT A PASS ───────────────────────────────────────
//   0  every derived project's newest production deployment succeeded, and every
//      git-connected one is at the commit `main` says it should be.
//      A newest build still IN FLIGHT and younger than the ceiling is also 0,
//      printed ⏳, when the completed deployment behind it passes (or, for the
//      commit limb only, when the building one carries the commit `main` names).
//   1  a project is stale or red — its newest production build failed or was
//      canceled, has been in flight past the ceiling, or the commit it serves
//      does not CARRY the newest `main` commit for its source.
//   2  COULD NOT LOOK — no credential, a non-200, unparseable JSON, an
//      `environment` that came back something other than `production`, a stage
//      status outside Cloudflare's enum, an in-flight build whose `created_on`
//      does not parse (its age is the whole question), no COMPLETED deployment
//      within the rows read behind an in-flight one, or a
//      project list that derived to EMPTY. An empty sweep prints the same `ok`
//      as a complete one, which is the defect this portfolio keeps re-finding.
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

const HERE = dirname(fileURLToPath(import.meta.url));

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

/** Raised where the answer is "nothing was judged", never "it is fine". */
export class CouldNotLook extends Error {}

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
 *
 *    DIRECT-UPLOAD — one per `catalog/apps.json` slug. `deploy-web.yml` creates
 *      and uploads `--project-name=<slug>`, so a new app adds itself here by
 *      existing rather than by anyone remembering this file.
 *
 *  Returns `{ projects, problems }`. A `problem` is a READING failure (a missing
 *  or unparseable source), which the caller turns into exit 2 — not into a
 *  shorter list. */
export function derivePagesProjects(root) {
  const projects = [];
  const problems = [];

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
    for (const name of names) projects.push({ project: name, kind: 'git', sourceDir: `sites/${name}` });
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
        projects.push({ project: r.slug, kind: 'direct', sourceDir: `apps/${r.slug}` });
      }
    }
  }

  return { projects, problems };
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
 *  Returns `{ code, line }`. `code` is 0, 1 or 2 with the file-level meaning. */
export function judgeProject({
  project,
  kind,
  sourceDir,
  deployments,
  expectedCommit,
  isAncestor = null,
  now = Date.now(),
  ceilingMs = IN_FLIGHT_CEILING_MS,
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
  const ctx = { at, sourceDir, expectedCommit, isAncestor };

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
    return { code: 0, inflight: true, line: `⏳  ${at} — ${what} is IN FLIGHT; ${tail} Serving now: ${g.line.replace(/^ok\s+/, '')}` };
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
function gradeCompleted(dep, { at, sourceDir, expectedCommit, isAncestor }) {
  const id = dep.id ?? '(no id)';
  const trigger = dep.deployment_trigger ?? {};
  const served = trigger?.metadata?.commit_hash ?? null;

  if (expectedCommit === null) {
    return {
      code: 0,
      line:
        `ok  ${at} — deployment ${id} succeeded at stage \`deploy\`; commit limb UNGRADED ` +
        `(trigger \`${trigger.type ?? 'unknown'}\` carries no commit_hash, which is correct for a direct upload; ` +
        `its commit witness is record-deployment.mjs, read by check-prod-provenance.mjs on the pipeline B-17 rail).`,
    };
  }

  if (typeof served !== 'string' || served === '') {
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

/** The newest commit on `main` that touched a path. `null` when the history is
 *  unreadable — which the caller must turn into exit 2, never into a pass.
 *
 *  ⚠️ `origin/main`, NOT `HEAD`. ops-watch runs on a schedule and its checkout is
 *  main, but a dispatched run from a branch would otherwise compare Cloudflare's
 *  production build against a branch tip and report a false red. */
export function newestCommitTouching(root, path, run = spawnSync) {
  const r = run('git', ['log', '-1', '--format=%H', 'origin/main', '--', path], {
    cwd: root,
    encoding: 'utf8',
  });
  if (r.error || r.status !== 0) return null;
  const sha = (r.stdout ?? '').trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

const CF_API = 'https://api.cloudflare.com/client/v4';

async function readDeployments(project) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new CouldNotLook('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment');
  }
  const url = `${CF_API}/accounts/${account}/pages/projects/${encodeURIComponent(project)}/deployments?env=production&per_page=${DEPLOYMENTS_PER_PAGE}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    throw new CouldNotLook(`GET pages/projects/${project}/deployments answered HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CouldNotLook(`GET pages/projects/${project}/deployments answered unparseable JSON: ${text.slice(0, 200)}`);
  }
  if (body?.success !== true) {
    throw new CouldNotLook(`Cloudflare reported success=false for ${project}: ${JSON.stringify(body?.errors ?? null).slice(0, 400)}`);
  }
  return body.result;
}

async function main() {
  const { projects, problems } = derivePagesProjects(ROOT);

  if (problems.length > 0 || projects.length === 0) {
    console.error('✗ COULD NOT LOOK — the Pages project set did not derive, so NOTHING was swept:');
    for (const p of problems) console.error(`    ${p}`);
    if (projects.length === 0) console.error('    the derived project set is EMPTY, which prints the same ok as a complete sweep.');
    process.exitCode = 2;
    return;
  }

  const results = [];
  let ungraded = 0;

  for (const p of projects) {
    let expectedCommit = null;
    if (p.kind === 'git') {
      expectedCommit = newestCommitTouching(ROOT, p.sourceDir, spawnSync);
      if (expectedCommit === null) {
        results.push({
          code: 2,
          line:
            `?   ${p.project} (git) — \`git log origin/main -- ${p.sourceDir}\` produced no commit. The history is ` +
            `unreadable here (a shallow clone has no origin/main), so the freshness limb was NOT executed.`,
        });
        continue;
      }
    } else {
      ungraded += 1;
    }

    try {
      const deployments = await readDeployments(p.project);
      results.push(
        judgeProject({
          ...p,
          deployments,
          expectedCommit,
          isAncestor: (a, b) => isAncestorOf(ROOT, a, b, spawnSync),
        }),
      );
    } catch (e) {
      results.push({
        code: 2,
        line: `?   ${p.project} (${p.kind}) — ${e instanceof CouldNotLook ? e.message : `${e.name}: ${e.message}`}`,
      });
    }
  }

  const verdict = foldVerdicts(results, { projectsSwept: projects.length, ungraded });

  console.log(
    `⬜  MONITOR · Cloudflare Pages production deployments · ${verdict.projectsSwept} project(s) DERIVED ` +
      `(${verdict.projectsSwept - verdict.ungraded} commit-graded, ${verdict.ungraded} direct-upload with the commit limb ungraded)`,
  );
  for (const line of verdict.lines) console.log(`    ${line}`);

  if (verdict.code === 0) {
    console.log(
      verdict.inflight === 0
        ? `ok  every derived Pages project's newest PRODUCTION deployment succeeded and is at the commit main names.`
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
