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
//   RELEASE BUILD  a step running `flutter build …` in release mode — which is
//                  Flutter's DEFAULT mode, so `--release` is optional decoration
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

/**
 * 🔴 RELEASE IS FLUTTER'S DEFAULT BUILD MODE — triage 2026-07-31 (mutation-
 * proven): the first version demanded the literal `--release`, so an ungated
 * `flutter build appbundle` job — written without the redundant flag, as the
 * very next Play lane will be — was an INVISIBLE release build; the
 * releaseJobs floor stayed satisfied by build-platforms.yml and nothing
 * tripped. The verb is still required — `flutter test --release` is not a
 * release build — but the flag no longer is: a `flutter build <target>`
 * command counts unless its own segment says `--debug` or `--profile`, the
 * only two spellings that make a Flutter build non-release. (`web-server` is
 * a dev-server target, not a shippable artifact.)
 */
const RELEASE_BUILD_CMD = /flutter\s+build\s+(?!web-server\b)\S+/;
const NON_RELEASE_MODE = /--debug\b|--profile\b/;

/**
 * A PUBLISH hands an artifact to something outside the run. Deliberately a
 * NAMED list rather than a heuristic: a heuristic that stops matching reports
 * "clean", and the whole point of this guard is that silence is not success.
 * `actions/upload-artifact` is EXCLUDED on purpose — see the header.
 */
const PUBLISH = [
  { re: /wrangler[^\n]*\bdeploy\b|pages\s+deploy/, what: 'a Cloudflare deploy' },
  // `cloudflare/wrangler-action` is classified from its `with: command:` line,
  // NOT from the `uses:` line — triage 2026-07-31 (mutation-proven): the verb
  // lives on the `command:` line, so classifying the `uses:` line called a
  // correctly-gated `command: deploy --dry-run` typecheck a publish and
  // demanded a ledger entry for a deployment that never happened — the exact
  // fabrication the header calls worse than recording nothing. `viaCommand`
  // routes these steps through the command classifier below; a step with NO
  // `command:` still counts, because the action's default command is `deploy`.
  { re: /cloudflare\/wrangler-action/, what: 'a Cloudflare deploy action', viaCommand: true },
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
 *
 * Triage 2026-07-31 (mutation-proven): the exclusion then over-rotated — it
 * dropped the WHOLE LINE, so `npx wrangler deploy --dry-run && npx wrangler
 * deploy`, a real publish, vanished on the strength of the dry run beside it.
 * Lines are now split on the shell separators and each command segment answers
 * for itself: only the segment that carries `--dry-run` is excluded, and any
 * segment that publishes without it still counts.
 */
const DRY_RUN = /--dry-run/;
const shellSegments = (text) => text.split(/&&|\|\||[;|]/);

/** A job-level `if:` containing either of these runs the job even when a job it
 *  `needs` has FAILED — which is precisely what disarms a `needs: gate` edge. */
const NEUTRALIZING_IF = /\balways\s*\(|\bfailure\s*\(/;

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

// ── which job IS the gate? derived, never duplicated ─────────────────────────
// `assert-gate-passed.mjs` polls a check run BY NAME, and that name is declared
// exactly once — in that script. Reading it here instead of writing 'ci-gate'
// a second time is [pipeline F-2]'s single-declaration rule: a private copy of
// the name would make this guard the first thing to drift when it changes.
const gateCheckMatch = read(GATE_SCRIPT).match(/const GATE = '([^']+)'/);
if (!gateCheckMatch) {
  coverageLost([
    `${GATE_SCRIPT} no longer declares \`const GATE = '…'\`, so this guard cannot tell which job IS the gate.`,
    'The gate-constituent credit below would silently stop applying and flag the gate workflow\'s own',
    'compile-proof builds — a false red on the one workflow every deploy lane depends on.',
  ]);
}
const GATE_CHECK = gateCheckMatch[1];

// ── parse ────────────────────────────────────────────────────────────────────
const wfDir = join(ROOT, WORKFLOWS);
if (!existsSync(wfDir)) coverageLost([`${WORKFLOWS} does not exist.`]);
const wfFiles = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')).sort();
if (wfFiles.length === 0) coverageLost([`${WORKFLOWS} contains no workflow files.`]);

/**
 * LOGICAL LINES — a `run: >` block is ONE command that YAML happens to fold
 * (deploy-web.yml:95 folds the web release build exactly this way, and a
 * reflowed `--release` was invisible to the line-anchored regexes — triage
 * 2026-07-31), so its continuation lines are joined with a space before any
 * pattern looks at them. A `run: |` block is the opposite — each line is its
 * OWN shell command — so those lines are joined with ` ; `, a separator the
 * segment splitter above already understands, and two commands can never blur
 * into one. Joining `|` with spaces would re-open the dry-run hole this same
 * review closed: line one's `--dry-run` would exonerate line two's real deploy.
 * The joined entry keeps the `run:` line's number, so a report still points
 * into the real file.
 */
function joinBlockScalars(jobLines) {
  const out = [];
  for (let i = 0; i < jobLines.length; i++) {
    const line = jobLines[i];
    const m = line.text.match(/^(\s*)(?:-\s+)?run:\s*([|>])[+-]?[0-9]*\s*$/);
    if (!m) {
      out.push(line);
      continue;
    }
    const keyIndent = m[1].length;
    const parts = [];
    let contentIndent = null;
    let j = i + 1;
    while (j < jobLines.length) {
      const t = jobLines[j].text;
      if (t.trim() === '') {
        j++; // blank (or comment-blanked) lines are legal inside a block scalar
        continue;
      }
      const indent = t.match(/^ */)[0].length;
      if (contentIndent === null) {
        if (indent <= keyIndent) break;
        contentIndent = indent;
      }
      if (indent < contentIndent) break;
      parts.push(t.trim());
      j++;
    }
    out.push({ n: line.n, text: line.text.replace(/[|>][+-]?[0-9]*\s*$/, parts.join(m[2] === '>' ? ' ' : ' ; ')) });
    i = j - 1;
  }
  return out;
}

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
        jobs.set(current, { name: current, needs: [], lines: [], logical: [], jobIf: null, continueOnError: null, displayName: null });
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
  //
  // Triage 2026-07-31 (mutation-proven): all three forms must also strip
  // QUOTES. `needs: ["gate"]` is the same edge in YAML GitHub happily runs,
  // but reading the dep as `"gate"` — quotes included — made `wf.jobs.get()`
  // miss and the walk silently drop the edge, so a correctly-gated workflow
  // drew this guard's own ungated complaint. A false red on a right tree is
  // the scalar-form lesson above, relearned one quoting level down.
  for (const job of jobs.values()) {
    const body = job.lines.map((l) => l.text).join('\n');
    const flow = body.match(/needs:\s*\[([^\]]*)\]/);
    const scalar = body.match(/^\s*needs:\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*$/m);
    if (flow) {
      job.needs = flow[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    } else if (scalar) {
      job.needs = [scalar[2]];
    } else {
      const idx = job.lines.findIndex((l) => /^\s*needs:\s*$/.test(l.text));
      if (idx !== -1) {
        for (const l of job.lines.slice(idx + 1)) {
          const m = l.text.match(/^\s*-\s*(['"]?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*$/);
          if (!m) break;
          job.needs.push(m[2]);
        }
      }
    }

    // Job-level `if:` / `continue-on-error:` / `name:` — read for the gate
    // credit below. Job keys sit at exactly 4 spaces (jobs at 2, steps at 6),
    // so the ` {4}` anchor is what keeps a STEP's `if:` — 8 spaces, e.g.
    // e2e.yml's purge steps — from being mistaken for a job condition.
    // `continue-on-error` is taken at ANY depth on purpose: on the gate STEP it
    // swallows a red verdict inside the job, at job level it swallows it from
    // `needs` — either placement disarms the edge.
    for (const l of job.lines) {
      let m;
      if (job.jobIf === null && (m = l.text.match(/^ {4}if:\s*(\S.*?)\s*$/))) job.jobIf = { n: l.n, cond: m[1] };
      if (job.continueOnError === null && /^\s*continue-on-error:\s*true\b/.test(l.text)) job.continueOnError = { n: l.n };
      if (job.displayName === null && (m = l.text.match(/^ {4}name:\s*(\S.*?)\s*$/))) job.displayName = m[1].replace(/^['"]|['"]$/g, '');
    }

    job.logical = joinBlockScalars(job.lines);
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
const has = (job, re) => job.logical.find((l) => re.test(l.text));

/**
 * The publish set for one job. Two passes: `cloudflare/wrangler-action` steps
 * are classified from their `with: command:` line — synthesized back into a
 * `wrangler …` command so the SAME publish patterns and the SAME per-segment
 * dry-run rule judge it, rather than a second vocabulary that could drift —
 * and every other pattern is matched per shell segment of each logical line.
 * A `command:` line the action pass consumed is skipped by the generic pass,
 * so one deploy is never reported twice.
 */
function classifyPublishes(job) {
  const found = [];
  const consumed = new Set();
  for (let i = 0; i < job.logical.length; i++) {
    const line = job.logical[i];
    if (!/cloudflare\/wrangler-action/.test(line.text)) continue;
    let command = null;
    for (let k = i + 1; k < job.logical.length; k++) {
      const t = job.logical[k].text;
      if (/^\s*-\s/.test(t)) break; // next step — this step's `with:` block is over
      const m = t.match(/^\s*command:\s*(\S.*?)\s*$/);
      if (m) {
        command = { n: job.logical[k].n, text: m[1].replace(/^['"]|['"]$/g, '') };
        break;
      }
    }
    if (command === null) {
      // No `command:` key — the action's DEFAULT command is `deploy`, so
      // silence here IS a publish, reported at the `uses:` line.
      found.push({ n: line.n, what: 'a Cloudflare deploy action' });
      continue;
    }
    consumed.add(command.n);
    const cmd = `wrangler ${command.text}`;
    const publishes = PUBLISH.some(
      (p) => !p.viaCommand && shellSegments(cmd).some((s) => p.re.test(s) && !DRY_RUN.test(s)),
    );
    if (publishes) found.push({ n: command.n, what: 'a Cloudflare deploy action' });
  }
  for (const p of PUBLISH) {
    if (p.viaCommand) continue;
    for (const l of job.logical) {
      if (consumed.has(l.n)) continue;
      if (shellSegments(l.text).some((s) => p.re.test(s) && !DRY_RUN.test(s))) found.push({ n: l.n, what: p.what });
    }
  }
  return found.sort((a, b) => a.n - b.n);
}

for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    job.releaseBuilds = job.logical.filter((l) =>
      shellSegments(l.text).some((s) => RELEASE_BUILD_CMD.test(s) && !NON_RELEASE_MODE.test(s)),
    );
    job.gateCall = has(job, /node\s+tooling\/ci\/assert-gate-passed\.mjs/);
    job.markerCall = has(job, /node\s+tooling\/ci\/record-deployment\.mjs/);
    job.publishes = classifyPublishes(job);
  }
}

/**
 * Does this job, or any job it transitively needs, run the gate check — and is
 * the credit REAL? Triage 2026-07-31 (mutation-proven): a `needs: gate` edge
 * proves nothing once GitHub's own semantics have disarmed it. A job-level
 * `if: always()` (or `failure()`) on the building/publishing job — or on any
 * intermediate job on the walked path — runs it even when the needed gate
 * FAILED; `continue-on-error: true` in the gate job swallows a red
 * assert-gate-passed verdict before `needs` can see it. Both idioms already
 * live in this tree (build-platforms.yml's `all_platforms`, ci.yml's
 * aggregator), so "nobody would write that" is not a defense. A gate call in
 * the SAME job still counts on step order alone — a job's own `if:` cannot
 * reorder its steps. Ordinary conditions (`if: github.ref == …`) are left
 * alone; only always()/failure() disarm an edge.
 *
 * Returns { clean, refused }: `clean` is a gate job credited with no
 * neutralizer on the path; `refused` records credits that WOULD have counted,
 * so the failure message can name the exact line that disarmed them instead of
 * claiming no gate exists.
 */
function findGate(wf, job) {
  let clean = null;
  const refused = [];
  const walk = (j, blockedBy, path) => {
    if (path.has(j.name)) return;
    path.add(j.name);
    if (j.gateCall) {
      if (blockedBy) refused.push({ kind: 'if', gate: j, blockedBy });
      else if (j.continueOnError) refused.push({ kind: 'coe', gate: j });
      else if (!clean) clean = j;
    }
    for (const dep of j.needs) {
      const d = wf.jobs.get(dep);
      if (!d) continue;
      const disarmed = j.jobIf !== null && NEUTRALIZING_IF.test(j.jobIf.cond) ? { job: j, line: j.jobIf } : null;
      walk(d, blockedBy ?? disarmed, path);
    }
    path.delete(j.name);
  };
  walk(job, null, new Set());
  return { clean, refused };
}

function neutralizedCredit(wf, job, r, doing) {
  if (r.kind === 'coe') {
    return (
      `${wf.rel}: job "${job.name}" ${doing}, and its gate job "${r.gate.name}" carries \`continue-on-error: true\` at :${r.gate.continueOnError.n}. ` +
      `${GATE_SCRIPT} failing can no longer fail that job, so every \`needs\` edge to it is satisfied on a RED gate — the edge exists and enforces nothing.`
    );
  }
  return (
    `${wf.rel}: job "${job.name}" ${doing}, and its only path to ${GATE_SCRIPT} (job "${r.gate.name}") is neutralized: ` +
    `job "${r.blockedBy.job.name}" has a job-level \`if:\` at :${r.blockedBy.line.n} containing \`always()\`/\`failure()\`, so it runs even when the gate FAILED and the \`needs\` edge enforces nothing.`
  );
}

// ── the gate's own builds are gated by construction ──────────────────────────
// Widening RELEASE BUILD to Flutter's default mode (above) pulls ci.yml's
// stamped-probe build — `flutter build web --pwa-strategy=none`, [pipeline S-3]
// — into the domain, and ci.yml cannot call assert-gate-passed.mjs on itself:
// the verdict it would poll for is the one it is busy producing. The credit is
// structural instead: a job the gate-verdict job transitively `needs` cannot go
// red without the gate going red, so building there IS how the commit gets
// gated. (Publishing there gets NO such credit — an artifact that leaves the
// runner before the verdict completes is still limb 2's problem.) The credit is
// withdrawn entirely if MORE than one job claims the gate's check name:
// assert-gate-passed.mjs polls by name, and a second claimant could hand every
// deploy lane the wrong verdict.
const gateVerdictJobs = [];
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    if ((job.displayName ?? job.name) === GATE_CHECK) gateVerdictJobs.push({ wf, job });
  }
}
const gateConstituents = new Map(); // wf.rel → Set(jobName)
if (gateVerdictJobs.length === 1) {
  const { wf, job } = gateVerdictJobs[0];
  const seen = new Set();
  const stack = [...job.needs];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const d = wf.jobs.get(n);
    if (d) stack.push(...d.needs);
  }
  gateConstituents.set(wf.rel, seen);
} else if (gateVerdictJobs.length > 1) {
  problems.push(
    `${gateVerdictJobs.length} jobs produce a check run named "${GATE_CHECK}" (${gateVerdictJobs.map((g) => `${g.wf.rel}:"${g.job.name}"`).join(', ')}). ` +
      `${GATE_SCRIPT} polls that check BY NAME, so a second claimant can hand every deploy lane the wrong verdict — and no gate-constituent credit is granted while the name is ambiguous.`,
  );
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
      const { clean: gateJob, refused } = findGate(wf, job);
      if (gateJob) {
        if (gateJob.name === job.name && gateJob.gateCall.n > job.releaseBuilds[0].n) {
          problems.push(
            `${wf.rel}: job "${job.name}" calls ${GATE_SCRIPT} at :${gateJob.gateCall.n}, AFTER its first release build at :${job.releaseBuilds[0].n}. ` +
              'A gate consulted after the build has verified nothing — the artifact already exists.',
          );
        }
      } else if (gateConstituents.get(wf.rel)?.has(job.name)) {
        // Gated by construction — the gate verdict `needs` this job, so a red
        // build here IS a red gate. See the gate-constituent block above.
      } else if (refused.length > 0) {
        problems.push(
          neutralizedCredit(wf, job, refused[0], `runs ${job.releaseBuilds.length} release build(s) (first at :${job.releaseBuilds[0].n})`),
        );
      } else {
        problems.push(
          `${wf.rel}: job "${job.name}" runs ${job.releaseBuilds.length} release build(s) (first at :${job.releaseBuilds[0].n}) and neither it nor any job it \`needs\` calls ${GATE_SCRIPT}. ` +
            'An artifact can then be built from any dispatched ref, including one whose gate is RED, and nothing downstream can tell the difference.',
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
      // passed limb 2 (limb 1's ordering only covers release builds, and
      // publish-only jobs like deploy-workers' are exactly the ones limb 1 never
      // sees). A gate consulted after the artifact left the runner verified nothing.
      const firstPublish = job.publishes[0];
      const { clean: gateJob, refused } = findGate(wf, job);
      if (!gateJob) {
        if (refused.length > 0) {
          problems.push(neutralizedCredit(wf, job, refused[0], `performs ${lastPublish.what} at :${lastPublish.n}`));
        } else {
          problems.push(
            `${wf.rel}: job "${job.name}" performs ${lastPublish.what} without any \`${GATE_SCRIPT}\` call in itself or a job it \`needs\`.`,
          );
        }
      } else if (gateJob.name === job.name && gateJob.gateCall.n > firstPublish.n) {
        problems.push(
          `${wf.rel}: job "${job.name}" calls ${GATE_SCRIPT} at :${gateJob.gateCall.n}, AFTER its first publish at :${firstPublish.n}. A gate consulted after the artifact left the runner has verified nothing.`,
        );
      }
    }

    // ── limb 3: a SERVED channel's lane is held to the same bar ─────────────
    // Derived from the register, so the day a channel is served its lane is
    // covered without anyone remembering to add it here.
    if (isServedLane && !buildsRelease && job.publishes.length === 0 && !findGate(wf, job).clean) {
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
    `ZERO jobs across ${workflows.length} workflow file(s) run a \`flutter build\` in release mode.`,
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
