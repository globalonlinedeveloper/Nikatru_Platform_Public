#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-release-provenance.mjs — nothing is built for release from an ungated
// commit, and nothing is published without recording what shipped.
//
// [pipeline R-6] "A release is produced only from a commit whose required gate
//                passed, and the mapping published artifact → commit SHA → gate
//                verdict is queryable after the fact."
//
// ── WHY A THIRD GUARD WHEN BOTH MECHANISMS ALREADY EXIST ─────────────────────
// `assert-gate-passed.mjs` and `record-deployment.mjs` are built, VERIFIED and
// live-proven by [pipeline F-5b]. R-6 does not need them rewritten — it needs
// them CALLED on a surface they do not cover. So this guard asserts the CALL
// SITES exist and are correctly ORDERED. Reusing the scripts is deliberate:
// F-5b's live test found an off-by-one in `assert-gate-passed.mjs` that broke
// both deploys, and that fix is covered by `guards.test.mjs` — a second
// implementation would inherit none of it.
//
// ── THE CRITERION R-6 SHIPPED WITH HAD NO DOMAIN ─────────────────────────────
// "The RELEASE LANE's first step resolves ci-gate's conclusion … the PUBLISHED
// RELEASE names that SHA." There is no release lane and no published release, so
// both halves were empty-set true and would stay clean right up to the day
// somebody adds an ungated lane — at which point they are STILL clean, because
// the guard was written to check "the release lane" and the new one is not yet
// declared to be it. So the set is derived from what a lane DOES:
//
//   RELEASE BUILD  a step running `flutter build … --release`
//   PUBLISH        a step that hands an artifact to something outside the run
//   (NOT `actions/upload-artifact` — [pipeline R-4] established those are 7-day
//    BUILD PROOFS, not user artifacts. Requiring a deployment marker for one
//    would write a deployment that never happened into [10]D-9's ledger, which
//    is worse than recording nothing.)
//
// ⚠️ COMMENTS ARE STRIPPED HERE — the OPPOSITE of assert-channel-claims.mjs, and
// both are right. There, the comment WAS the payload (a Flathub URL a human
// copies). Here the hazard runs the other way: `deploy-web.yml` explains in prose
// why it calls both scripts (`:46-49`, `:121-122`), so a raw text match would
// report a lane as gated on the strength of a comment DESCRIBING the gate. This
// repo has shipped that exact defect twice — the guard-coverage counter that
// accepted a name in a comment ([pipeline F-10], fixed at dd30feb) and
// `assert-stamp-platforms.mjs:37-42`, whose header records deleting the real
// build step and staying green because the comment above it said the words.
//
// ── ORDER IS THE WHOLE POINT, AND IT CROSSES JOBS ────────────────────────────
// A gate check that runs AFTER the build has verified nothing. But the gate may
// legitimately live in a SEPARATE job that the build job `needs:` — which is the
// cheaper shape when three platform jobs share one verdict. So ordering is
// resolved two ways: same job ⇒ by line; different job ⇒ by walking the `needs`
// graph transitively. A guard that only understood line order would force every
// workflow into one job to satisfy it.
//
// Usage:  node tooling/ci/assert-release-provenance.mjs [repoRoot]
// Exit 0 = every release build is gated and every publish is recorded.
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const WORKFLOWS = '.github/workflows';
const REGISTER = 'tooling/channel-register.json';
const GATE_SCRIPT = 'tooling/ci/assert-gate-passed.mjs';
const MARKER_SCRIPT = 'tooling/ci/record-deployment.mjs';

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : null);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-release-provenance: FAILED');
  process.exit(1);
}

/** A release build. `--release` alone is not enough — `flutter test --release`
 *  is not a release build — so the verb is matched too. */
const RELEASE_BUILD = /flutter\s+build\s+\S+[^\n]*--release/;

/**
 * A PUBLISH hands an artifact to something outside the run. Deliberately a
 * NAMED list rather than a heuristic: a heuristic that stops matching reports
 * "clean", and the whole point of this guard is that silence is not success.
 * `actions/upload-artifact` is EXCLUDED on purpose — see the header.
 */
const PUBLISH = [
  { re: /wrangler[^\n]*\bdeploy\b|pages\s+deploy/, what: 'a Cloudflare deploy' },
  { re: /cloudflare\/wrangler-action/, what: 'a Cloudflare deploy action' },
  // `upload` as well as `create` — review 2026-07-31: the register's own
  // linux-appimage row locks the AppImage flow to Releases-as-origin, and a lane
  // adding assets to an existing release says `gh release upload`. Missing it
  // meant the exact flow the register prescribes escaped this guard.
  { re: /gh\s+release\s+(create|upload)|softprops\/action-gh-release|actions\/upload-release-asset/, what: 'a GitHub Release publish' },
  // `r2 object put` — dl.nikatru.com is R2 behind a domain ([ADR 015] §4), so
  // pushing an object there IS publishing a user-receivable artifact.
  { re: /wrangler[^\n]*\br2\s+object\s+put\b/, what: 'an R2 artifact upload' },
  { re: /snapcraft\s+upload|fastlane\s+(deliver|supply|pilot)|xcrun\s+altool/, what: 'a store submission' },
  // The stores the register marks submittable that fastlane cannot reach:
  // Microsoft's CLI/action, and the community Play-upload action.
  { re: /msstore\s+publish|store-submission|r0adkll\/upload-google-play/, what: 'a store submission action' },
];

/**
 * 🔴 A DRY RUN PUBLISHES NOTHING, AND MISSING THIS COST THE FIRST VERSION FIVE
 * FALSE FAILURES. `ci.yml` typechecks both Workers with `npx wrangler deploy
 * --dry-run` at :55, :434 and :634 — the word `deploy` is right there and not one
 * byte leaves the runner. Demanding a gate check and a deployment marker around
 * a dry run would have written three deployments that never happened into
 * [10]D-9's ledger. Checked against the actual lines before believing the guard,
 * which is the only reason this is a comment and not a commit.
 */
const DRY_RUN = /--dry-run/;

// ── the two mechanisms must still exist ──────────────────────────────────────
// Asserting call sites to a script that has been deleted proves nothing.
for (const s of [GATE_SCRIPT, MARKER_SCRIPT]) {
  if (!existsSync(join(ROOT, s))) {
    coverageLost([
      `${s} does not exist.`,
      'Every assertion below is about workflows CALLING it. With the script gone, a workflow that still',
      'names it would pass this guard while failing at runtime — a green check over a broken lane.',
    ]);
  }
}

// ── parse ────────────────────────────────────────────────────────────────────
const wfDir = join(ROOT, WORKFLOWS);
if (!existsSync(wfDir)) coverageLost([`${WORKFLOWS} does not exist.`]);
const wfFiles = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
if (wfFiles.length === 0) coverageLost([`${WORKFLOWS} contains no workflow files.`]);

/**
 * Jobs, their `needs`, and every line inside them — with comments stripped but
 * LINE NUMBERS PRESERVED, so a reported line still points at the real file.
 * Blanking a comment rather than deleting it is what keeps those in step.
 */
function parseWorkflow(rel) {
  const raw = read(rel);
  if (raw === null) return null;
  const rawLines = raw.split('\n');
  const lines = rawLines.map((l) => (/^\s*#/.test(l) ? '' : l.replace(/\s#.*$/, '')));

  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs = new Map();
  if (jobsAt !== -1) {
    let current = null;
    for (let i = jobsAt + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break;
      const m = lines[i].match(/^ {2}([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
      if (m) {
        current = m[1];
        jobs.set(current, { name: current, needs: [], lines: [] });
      } else if (current !== null) {
        jobs.get(current).lines.push({ n: i + 1, text: lines[i] });
      }
    }
  }

  // 🔴 `needs:` HAS THREE FORMS AND THE FIRST VERSION PARSED ONLY TWO.
  // `deploy-workers.yml` writes the SCALAR form — `needs: detect` — and its two
  // deploy jobs are correctly gated through that dependency. Missing the scalar
  // form made a properly-wired production workflow look ungated, and "fixing"
  // the tree on the strength of that would have been the actual defect. Flow,
  // scalar, block — all three, or the graph walk below is reading a lie.
  for (const job of jobs.values()) {
    const body = job.lines.map((l) => l.text).join('\n');
    const flow = body.match(/needs:\s*\[([^\]]*)\]/);
    const scalar = body.match(/^\s*needs:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/m);
    if (flow) {
      job.needs = flow[1].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (scalar) {
      job.needs = [scalar[1]];
    } else {
      const idx = job.lines.findIndex((l) => /^\s*needs:\s*$/.test(l.text));
      if (idx !== -1) {
        for (const l of job.lines.slice(idx + 1)) {
          const m = l.text.match(/^\s*-\s*([A-Za-z_][A-Za-z0-9_-]*)\s*$/);
          if (!m) break;
          job.needs.push(m[1]);
        }
      }
    }
  }

  const rawStepCount = (raw.match(/^\s+-\s+(name|run|uses):/gm) ?? []).length;
  const strippedStepCount = lines.join('\n').match(/^\s+-\s+(name|run|uses):/gm)?.length ?? 0;
  return { rel, jobs, rawStepCount, strippedStepCount };
}

const workflows = wfFiles.map((f) => parseWorkflow(`${WORKFLOWS}/${f}`)).filter(Boolean);

// ── coverage self-check on the stripper ──────────────────────────────────────
// A stripper that ate the file makes every "does this call X" question below run
// against an empty string and answer "no" — or, worse, makes the RELEASE BUILD
// set empty so nothing is checked at all and it reports clean.
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'Every question below would then be asked of an empty file and answered "nothing to check".',
    ]);
  }
}
const totalJobs = workflows.reduce((n, wf) => n + wf.jobs.size, 0);
if (totalJobs === 0) {
  coverageLost([`parsed ${workflows.length} workflow file(s) and found ZERO jobs. The job parser has stopped reaching the files.`]);
}

// ── classify every job ───────────────────────────────────────────────────────
const has = (job, re) => job.lines.find((l) => re.test(l.text));
const allMatches = (job, re) => job.lines.filter((l) => re.test(l.text));

for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    job.releaseBuilds = allMatches(job, RELEASE_BUILD);
    job.gateCall = has(job, /node\s+tooling\/ci\/assert-gate-passed\.mjs/);
    job.markerCall = has(job, /node\s+tooling\/ci\/record-deployment\.mjs/);
    job.publishes = PUBLISH.flatMap((p) =>
      allMatches(job, p.re)
        .filter((l) => !DRY_RUN.test(l.text))
        .map((l) => ({ ...l, what: p.what })),
    ).sort((a, b) => a.n - b.n);
  }
}

/** Does this job, or any job it transitively needs, run the gate check? */
function gatedBy(wf, job, seen = new Set()) {
  if (seen.has(job.name)) return null;
  seen.add(job.name);
  if (job.gateCall) return job;
  for (const dep of job.needs) {
    const d = wf.jobs.get(dep);
    if (!d) continue;
    const found = gatedBy(wf, d, seen);
    if (found) return found;
  }
  return null;
}

// ── the served lanes, from [9]R-5's register ─────────────────────────────────
const registerRaw = read(REGISTER);
const servedLaneWorkflows = new Set();
if (registerRaw !== null) {
  try {
    const register = JSON.parse(registerRaw);
    for (const c of register.channels ?? []) {
      if (c.served === true && c.lane && typeof c.lane.workflow === 'string') servedLaneWorkflows.add(c.lane.workflow);
    }
  } catch {
    problems.push(`${REGISTER} is not valid JSON, so the served-lane half of this guard has no subject.`);
  }
}

// ── assertions ───────────────────────────────────────────────────────────────
let releaseJobs = 0;
let publishJobs = 0;

for (const wf of workflows) {
  const isServedLane = servedLaneWorkflows.has(wf.rel);

  for (const job of wf.jobs.values()) {
    const buildsRelease = job.releaseBuilds.length > 0;
    if (buildsRelease) releaseJobs++;

    // ── limb 1: a release build must be gated, and gated BEFORE it ──────────
    if (buildsRelease) {
      const gateJob = gatedBy(wf, job);
      if (!gateJob) {
        problems.push(
          `${wf.rel}: job "${job.name}" runs ${job.releaseBuilds.length} release build(s) (first at :${job.releaseBuilds[0].n}) and neither it nor any job it \`needs\` calls ${GATE_SCRIPT}. ` +
            'An artifact can then be built from any dispatched ref, including one whose gate is RED, and nothing downstream can tell the difference.',
        );
      } else if (gateJob.name === job.name && gateJob.gateCall.n > job.releaseBuilds[0].n) {
        problems.push(
          `${wf.rel}: job "${job.name}" calls ${GATE_SCRIPT} at :${gateJob.gateCall.n}, AFTER its first release build at :${job.releaseBuilds[0].n}. ` +
            'A gate consulted after the build has verified nothing — the artifact already exists.',
        );
      }
    }

    // ── limb 2: a publish must record what shipped, AFTER publishing ────────
    if (job.publishes.length > 0) {
      publishJobs++;
      const lastPublish = job.publishes[job.publishes.length - 1];
      if (!job.markerCall) {
        problems.push(
          `${wf.rel}: job "${job.name}" performs ${lastPublish.what} at :${lastPublish.n} and never calls ${MARKER_SCRIPT}. ` +
            'The code shipped and nothing can say what shipped — which is the state [10]D-9\'s ledger exists to abolish.',
        );
      } else if (job.markerCall.n < lastPublish.n) {
        problems.push(
          `${wf.rel}: job "${job.name}" records the deployment at :${job.markerCall.n}, BEFORE its last publish at :${lastPublish.n}. ` +
            'A marker written before the publish records an intention, not an outcome, and it survives a failed deploy.',
        );
      }
      // A publishing lane is also a release lane, whether or not it says --release.
      // 🔴 ORDER, not just presence — review 2026-07-31: this branch checked only
      // that a gate call EXISTED, so a same-job gate placed after the publish
      // passed limb 2 (limb 1's ordering only covers `--release` builds, and
      // publish-only jobs like deploy-workers' are exactly the ones limb 1 never
      // sees). A gate consulted after the artifact left the runner verified nothing.
      const firstPublish = job.publishes[0];
      const gateJob = gatedBy(wf, job);
      if (!gateJob) {
        problems.push(
          `${wf.rel}: job "${job.name}" performs ${lastPublish.what} without any \`${GATE_SCRIPT}\` call in itself or a job it \`needs\`.`,
        );
      } else if (gateJob.name === job.name && gateJob.gateCall.n > firstPublish.n) {
        problems.push(
          `${wf.rel}: job "${job.name}" calls ${GATE_SCRIPT} at :${gateJob.gateCall.n}, AFTER its first publish at :${firstPublish.n}. A gate consulted after the artifact left the runner has verified nothing.`,
        );
      }
    }

    // ── limb 3: a SERVED channel's lane is held to the same bar ─────────────
    // Derived from the register, so the day a channel is served its lane is
    // covered without anyone remembering to add it here.
    if (isServedLane && !buildsRelease && job.publishes.length === 0 && !gatedBy(wf, job)) {
      // Not every job in a served lane's workflow builds or publishes (a lint
      // job, say). Only complain if NO job in this workflow is gated at all.
      const anyGated = [...wf.jobs.values()].some((j) => j.gateCall);
      if (!anyGated) {
        problems.push(
          `${wf.rel} is the lane for a SERVED channel in ${REGISTER}, and no job in it calls ${GATE_SCRIPT}. A served channel ships from an unverified commit.`,
        );
      }
    }
  }
}

// ── the domain must not be empty ─────────────────────────────────────────────
if (releaseJobs === 0) {
  coverageLost([
    `ZERO jobs across ${workflows.length} workflow file(s) run a \`flutter build … --release\`.`,
    'This repo builds six platforms for release; a zero here means the pattern or the parser stopped',
    'matching, and every limb above then ranges over nothing and reports clean.',
  ]);
}
if (publishJobs === 0) {
  coverageLost([
    `ZERO publishing jobs found across ${workflows.length} workflow file(s).`,
    'deploy-web.yml and deploy-workers.yml deploy to Cloudflare on every push to main, so zero means the',
    'PUBLISH pattern set has stopped matching — and limb 2 would then be vacuously true forever.',
  ]);
}
if (servedLaneWorkflows.size === 0) {
  problems.push(
    `${REGISTER} declares no SERVED channel with a lane, so limb 3 has no subject. [9]R-5 requires at least one served channel; this guard should never see zero.`,
  );
}

ok(`${workflows.length} workflow file(s), ${totalJobs} job(s); ${releaseJobs} build for release, ${publishJobs} publish`);
ok(`${servedLaneWorkflows.size} served-channel lane(s) from ${REGISTER}: ${[...servedLaneWorkflows].join(', ') || '(none)'}`);

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-release-provenance: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-release-provenance: ok');
}
