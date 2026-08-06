#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-release-durable.mjs — a release lane may not finish with the artifact
// still inside the run that made it.
//
// [pipeline 9]R-4 "A release artifact outlives the run that made it. Every
//                 artifact intended for a user is published to a durable,
//                 addressable location with an integrity record, not left as a
//                 workflow-scoped artifact."
//
// ── THE CRITERION R-4 SHIPPED WITH QUANTIFIED OVER TWO EMPTY SETS ────────────
// As written it failed "if a RELEASE WORKFLOW's only artifact destination is
// `actions/upload-artifact`, or if a PUBLISHED RELEASE lacks a checksum file
// naming every asset."
//   · "published release" — there were ZERO. No tag had ever been pushed, so the
//     clause was vacuously true and would stay vacuously true right up to the day
//     the first release was published badly.
//   · "release workflow" — there was no workflow declared to be one, so a guard
//     written to those words would have skipped `build-platforms.yml` (the file
//     R-4's own evidence is drawn from) and reported clean.
// Both are the shape this repository keeps deleting: an assertion that cannot
// fail, inflating apparent coverage.
//
// So the subject is DERIVED from what a lane DOES, and the first limb has a real
// domain today:
//
//   A RELEASE LANE   a workflow that can be triggered by a release TAG
//                    (`on: push: tags:`). That is this factory's release trigger
//                    and `build-platforms.yml`'s own header calls it one: "It
//                    also triggers on `push: tags: <app>-v*`, which is a release
//                    trigger by any reading." A dispatch-only build-proof lane is
//                    NOT one — R-4's own correction is explicit that
//                    `retention-days: 7` "is correct BECAUSE these are build
//                    proofs", and grading those would be failing a lane for being
//                    what it is meant to be.
//   AN INSTALLABLE   an upload path naming a file extension the channel register
//                    declares (plus `.apk` — see release-manifest.mjs, no channel
//                    can declare it and it is the only sideloadable Android
//                    artifact), or a DIRECTORY under a `build/` tree, which is
//                    the acceptance's "or a desktop bundle directory".
//   DURABLE          a GitHub Release publish, or an R2 object put — [ADR 015] §4
//                    keeps Releases as the artifact ORIGIN and dl.nikatru.com as
//                    the download button, so both are real destinations.
//
// ── THE THREE LIMBS ──────────────────────────────────────────────────────────
// LIMB 1  In a RELEASE LANE, every job that uploads an installable artifact must
//   have a durable destination reachable from it — in the same job, or in a job
//   that transitively `needs` it. A job whose artifact's only destination is
//   `actions/upload-artifact` is the requirement's negation with a 7-day clock.
//   RECORDED FAILING CASE: delete the `gh release create` step from
//   build-platforms.yml's `release` job → this guard exits 1 naming all three
//   platform jobs. Proven against the real tree, not a fixture, 2026-08-06.
//
// LIMB 2  A durable publish must carry an INTEGRITY RECORD it has re-derived.
//   The publishing job must run `release-manifest.mjs --write <dir>` and then
//   `--verify <dir>` before it publishes, and must publish FROM `<dir>`. The
//   `--verify` half is what the acceptance's "naming every asset" turns on: that
//   mode fails in both directions — a named file that is absent, and a file in
//   the directory the manifest does not name. Checking only that a checksum file
//   EXISTS would accept one covering four assets out of five.
//
// LIMB 3  [9]R-5's register supplies the "published" predicate the original limb
//   2 needed. Every `served: true` channel that is not `kind: web` must have a
//   lane containing a durable publish. Today the only served channel is `web`,
//   whose format is a `static-bundle` and never a release asset — so this limb is
//   CORRECTLY empty rather than accidentally empty, it PRINTS that on every run,
//   and it acquires a real domain the moment any native row flips to `served`.
//
// ── REQUIRED_COVERAGE — DERIVED, never a number somebody ratchets ────────────
// Five identities, each anchored to a file that is already maintained:
//   (1) tooling/ci/release-manifest.mjs exists and still exports the
//       manifest name and the extension derivation. This guard NEVER writes
//       'SHA256SUMS' itself — a second copy of that string is the first thing to
//       drift, the same reason assert-release-provenance.mjs reads `const GATE`
//       out of assert-gate-passed.mjs instead of typing 'ci-gate'.
//   (2) the installable set covers EVERY `.ext` artifactFormat in
//       tooling/channel-register.json. Add a `.dmg` channel and this guard
//       covers it without an edit; narrow the derivation and it fails.
//   (3) the workflows parsed equal the workflows `git ls-files` tracks.
//   (4) every register `lane` {workflow, job} resolves in the parse.
//   (5) at least one installable upload step was FOUND. A classifier that stops
//       matching is the failure this file exists to prevent, and it would
//       otherwise report a clean tree with no subjects at all.
//
// ⚠️ THE HONEST LIMIT, stated rather than papered over. Limb 1 proves a durable
// destination EXISTS and is reachable; it cannot prove the step will RUN on a
// given trigger. A step-level `if:` is checked only for the literal `false`, and
// the condition of every durable step is PRINTED so a reader can see it. Proving
// reachability under GitHub's expression semantics would need an evaluator, and a
// half-written one that silently mis-evaluates is worse than a printed condition.
//
// Usage:  node tooling/ci/assert-release-durable.mjs [repoRoot]
// Exit 0 = no release lane can finish without a durable, verifiable artifact.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow, WORKFLOW_DIR, shellSegments } from './workflow-scan.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const ROOT_ARG = process.argv[2];
/** A fixture root is not a git repository and holds no channel register; saying
 *  so is the truth there rather than a coverage loss. Same distinction
 *  assert-guard-coverage.mjs and assert-release-lane-generic.mjs both draw. */
const scanningRealRepo = ROOT_ARG === undefined;

const REGISTER_REL = 'tooling/channel-register.json';
const MANIFEST_SCRIPT_REL = 'tooling/ci/release-manifest.mjs';

const problems = [];
const ok = (m) => console.log(`ok   ${m}`);
const note = (m) => console.log(`--   ${m}`);

function coverageLost(lines) {
  console.error('');
  console.error(`FAIL COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`     ${l}`);
  console.error('\nassert-release-durable: FAILED');
  process.exit(1);
}

// ── (1) the mechanism must still be there, and it owns its own constants ─────
const manifestAbs = join(ROOT, MANIFEST_SCRIPT_REL);
if (!existsSync(manifestAbs)) {
  coverageLost([
    `${MANIFEST_SCRIPT_REL} does not exist under ${ROOT}.`,
    'Every limb below is about workflows CALLING it. With the script gone, a lane that still names it',
    'would pass this guard and fail at runtime — a green check over a broken release.',
  ]);
}
let MANIFEST_NAME;
let installableExtensions;
let EXTRA_INSTALLABLE;
try {
  ({ MANIFEST_NAME, installableExtensions, EXTRA_INSTALLABLE } = await import(
    `file://${manifestAbs.replace(/\\/g, '/')}`
  ));
} catch (e) {
  coverageLost([`${MANIFEST_SCRIPT_REL} could not be imported (${e.message}).`]);
}
if (typeof MANIFEST_NAME !== 'string' || MANIFEST_NAME === '' || typeof installableExtensions !== 'function') {
  coverageLost([
    `${MANIFEST_SCRIPT_REL} no longer exports \`MANIFEST_NAME\` and \`installableExtensions\`.`,
    'This guard reads both OUT of that file so there is exactly one declaration of each. Without them it',
    'would have to carry its own copy — and a private copy of a constant is the first thing to drift,',
    'silently, in the direction that prints ok.',
  ]);
}

// ── (2) the installable set, derived from the register ───────────────────────
const registerAbs = join(ROOT, REGISTER_REL);
let register = null;
if (existsSync(registerAbs)) {
  try {
    register = JSON.parse(readFileSync(registerAbs, 'utf8'));
  } catch (e) {
    coverageLost([`${REGISTER_REL} is not valid JSON (${e.message}), so the installable set has no source.`]);
  }
} else if (scanningRealRepo) {
  coverageLost([
    `${REGISTER_REL} does not exist.`,
    'The installable-format set and limb 3\'s served set are both derived from it. Without it this guard',
    'would range over an empty format set and certify every lane in the tree.',
  ]);
}

const EXTS = installableExtensions(register ?? {});
const declaredInRegister = new Set();
for (const c of register?.channels ?? []) {
  for (const f of c?.artifactFormats ?? []) if (typeof f === 'string' && /^\.[A-Za-z0-9]+$/.test(f)) declaredInRegister.add(f);
}
if (EXTS.size === 0) {
  coverageLost([
    'the installable extension set is EMPTY.',
    `It is derived from ${REGISTER_REL}'s artifactFormats plus the declared extras in ${MANIFEST_SCRIPT_REL}.`,
    'An empty set makes "does this step upload an installable" answer no for every step in the tree, and',
    'this guard then reports a clean repository with no subjects at all.',
  ]);
}
const uncovered = [...declaredInRegister].filter((f) => !EXTS.has(f));
if (uncovered.length) {
  coverageLost([
    `${uncovered.length} format(s) declared in ${REGISTER_REL} are not in this guard's installable set: ${uncovered.join(', ')}.`,
    'The register is the maintained list; this guard must never cover less than it. A channel whose format',
    'escaped the classifier is a channel whose lane could terminate in upload-artifact unremarked.',
  ]);
}

// ── (3) the workflow set, anchored to what git tracks ────────────────────────
const wfDir = join(ROOT, WORKFLOW_DIR);
if (!existsSync(wfDir)) coverageLost([`${WORKFLOW_DIR} does not exist under ${ROOT}.`]);
const wfFiles = listDir(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort();
if (wfFiles.length === 0) coverageLost([`${WORKFLOW_DIR} contains no workflow file.`]);

const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '--', WORKFLOW_DIR], { encoding: 'utf8' });
const tracked =
  ls.status === 0
    ? [...new Set(ls.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.ya?ml$/.test(l)).map((l) => l.split('/').pop()))].sort()
    : [];
if (tracked.length === 0 && scanningRealRepo) {
  coverageLost([
    `\`git ls-files -- ${WORKFLOW_DIR}\` returned no tracked workflow under ${ROOT}.`,
    'The manifest that anchors the lane set is unreadable, so "did I see every lane" cannot be answered.',
  ]);
}
const unseen = tracked.filter((t) => !wfFiles.includes(t));
if (unseen.length) {
  coverageLost([
    `git tracks ${tracked.length} workflow(s) and this scan opened ${wfFiles.length}; it never saw: ${unseen.join(', ')}.`,
    'An unseen lane takes its uploads with it, so limb 1 would be computed over a smaller set and print ok.',
  ]);
}

// 🔴 COMMENTS ARE BLANKED BY parseWorkflow, AND THAT IS LOAD-BEARING HERE.
// build-platforms.yml's release job carries a comment reading "`gh release
// create` IS WRITTEN HERE, IN THE WORKFLOW, ON PURPOSE" — a raw text match would
// credit a lane for the prose explaining its own publish. This repo has shipped
// that exact defect twice (the guard-coverage counter that accepted a name in a
// comment; assert-stamp-platforms.mjs's deleted build step).
const workflows = wfFiles.map((f) => parseWorkflow(ROOT, `${WORKFLOW_DIR}/${f}`)).filter(Boolean);
for (const wf of workflows) {
  if (wf.rawStepCount > 0 && wf.strippedStepCount === 0) {
    coverageLost([
      `${wf.rel} has ${wf.rawStepCount} step(s) and NONE survived comment stripping.`,
      'Every question below would be asked of an empty file and answered "nothing to check".',
    ]);
  }
}
const byRel = new Map(workflows.map((w) => [w.rel, w]));
const totalJobs = workflows.reduce((n, wf) => n + wf.jobs.size, 0);
if (totalJobs === 0) {
  coverageLost([`parsed ${workflows.length} workflow file(s) and found ZERO jobs. The job parser has stopped reaching the files.`]);
}

// ── (4) every register lane resolves ─────────────────────────────────────────
let lanesChecked = 0;
for (const c of register?.channels ?? []) {
  const lane = c?.lane;
  if (!lane || typeof lane.workflow !== 'string' || typeof lane.job !== 'string') continue;
  lanesChecked++;
  const wf = byRel.get(lane.workflow);
  if (!wf || !wf.jobs.has(lane.job)) {
    coverageLost([
      `${REGISTER_REL}'s "${c.id}" row names lane ${lane.workflow}#${lane.job}, which this scan did not resolve.`,
      'Limb 3 grades a served channel through its lane. A lane this parse cannot see is a channel this',
      'guard silently stops covering — and assert-channel-register.mjs already holds the same lanes, so a',
      'divergence here means the two readings have come apart.',
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP PARSING — the structure limb 1 needs and `logical` lines do not carry.
// ─────────────────────────────────────────────────────────────────────────────

/** Split one job's lines into steps. A step opens with `- uses:` / `- name:` /
 *  `- run:` at the shallowest such indent in the job; everything to the next
 *  opener belongs to it. Anchoring on the SHALLOWEST opener rather than a fixed
 *  6 spaces is what keeps a nested list inside a `with:` block from being read
 *  as a new step. */
export function parseSteps(job) {
  const openers = [];
  let minIndent = Infinity;
  for (const l of job.lines) {
    const m = l.text.match(/^(\s+)-\s+(uses|name|run):/);
    if (!m) continue;
    minIndent = Math.min(minIndent, m[1].length);
  }
  if (minIndent === Infinity) return [];
  for (let i = 0; i < job.lines.length; i++) {
    const m = job.lines[i].text.match(/^(\s+)-\s+(uses|name|run):/);
    if (m && m[1].length === minIndent) openers.push(i);
  }
  const steps = [];
  for (let k = 0; k < openers.length; k++) {
    const from = openers[k];
    const to = k + 1 < openers.length ? openers[k + 1] : job.lines.length;
    const lines = job.lines.slice(from, to);
    steps.push({ n: job.lines[from].n, lines, text: lines.map((l) => l.text).join('\n') });
  }
  return steps;
}

/** The `path:` entries of a step — inline (`path: a/b`) and block (`path: |`
 *  followed by indented entries, with or without `- ` bullets). */
export function stepPaths(step) {
  const out = [];
  for (let i = 0; i < step.lines.length; i++) {
    const m = step.lines[i].text.match(/^(\s*)path:\s*(.*?)\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    const inline = m[2];
    if (inline !== '' && inline !== '|' && inline !== '>' && inline !== '|-' && inline !== '>-') {
      out.push(inline.replace(/^['"]|['"]$/g, ''));
      continue;
    }
    for (let j = i + 1; j < step.lines.length; j++) {
      const t = step.lines[j].text;
      if (t.trim() === '') continue;
      if (t.match(/^ */)[0].length <= indent) break;
      out.push(t.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''));
    }
  }
  return out;
}

/** Step-level `if:` — one indent deeper than the step's own bullet. */
export function stepIf(step) {
  for (const l of step.lines) {
    const m = l.text.match(/^\s+if:\s*(\S.*?)\s*$/);
    if (m) return { n: l.n, cond: m[1] };
  }
  return null;
}

/**
 * Does an upload path name something a person installs?
 *
 * Two shapes, and the second is the acceptance's own wording. A path ending in a
 * register-declared extension is one. A path with NO extension on its basename
 * that sits under a `build/` tree is a DESKTOP BUNDLE DIRECTORY — that is what
 * `build/windows/x64/runner/Release` and `build/linux/x64/release/bundle` are,
 * and uploading one is uploading an application. The `build/` anchor is what
 * keeps the two screenshot uploads out — `apps/<app>/screenshots/` in e2e.yml and
 * the Play listing directory in store-screenshots.yml. They are listing assets,
 * they are not installable, and failing their lanes would be a false red on two
 * workflows that are behaving correctly.
 *
 * (The glob in the sentence above is written `<app>` and not with a star on
 * purpose: a `*` followed by a slash inside a block comment CLOSES it. That is
 * the `services/*` defect recorded in assert-guard-coverage.mjs's header, hit
 * again here in the first run of this file.)
 */
export function isInstallablePath(rawPath, exts) {
  const p = rawPath.replace(/\$\{\{[^}]*\}\}/g, '_').trim();
  if (p === '') return false;
  const lower = p.toLowerCase();
  for (const e of exts) if (lower.endsWith(e.toLowerCase())) return true;
  const base = p.replace(/\/+$/, '').split('/').pop() ?? '';
  const hasExtension = /\.[A-Za-z0-9]+$/.test(base);
  return !hasExtension && /(^|\/)build\//.test(p);
}

/** A destination that outlives the run. `--dry-run` segments are excluded for
 *  the reason assert-release-provenance.mjs records: a dry run publishes
 *  nothing, and treating one as a publish demands provenance for a release that
 *  never happened. */
const DURABLE = [
  { re: /gh\s+release\s+(create|upload)\b/, what: 'a GitHub Release publish' },
  { re: /softprops\/action-gh-release|actions\/upload-release-asset/, what: 'a GitHub Release action' },
  { re: /wrangler[^\n]*\br2\s+object\s+put\b/, what: 'an R2 object upload (the dl.nikatru.com origin)' },
];
const DRY_RUN = /--dry-run\b/;

function durableIn(step) {
  for (const p of DURABLE) {
    if (shellSegments(step.text).some((s) => p.re.test(s) && !DRY_RUN.test(s))) return p.what;
  }
  return null;
}

/**
 * The line of the `tags:` filter under `on: push:`, or null. Parsed by INDENT
 * rather than matched with one regex over the whole header: `on:` legitimately
 * holds `workflow_dispatch`, `schedule` and blanked comment lines between the
 * `push:` key and its `tags:` child (build-platforms.yml has all three), and a
 * single regex either tolerates that by being loose enough to match a `tags:`
 * belonging to some other trigger, or is strict enough to miss the real one.
 * `tags-ignore:` is deliberately NOT a release trigger — it is an exclusion.
 */
export function releaseTriggerLine(wf) {
  const lines = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(/^(\s*)push:\s*$/);
    if (!m) continue;
    const indent = m[1].length;
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].text;
      if (t.trim() === '') continue;
      if (t.match(/^ */)[0].length <= indent) break;
      if (/^\s*tags:/.test(t)) return lines[j].n;
    }
  }
  return null;
}

// ── classify every job ───────────────────────────────────────────────────────
let installableUploads = 0;
for (const wf of workflows) {
  wf.releaseTrigger = releaseTriggerLine(wf);

  for (const job of wf.jobs.values()) {
    job.steps = parseSteps(job);
    job.installable = [];
    job.durable = [];
    for (const step of job.steps) {
      if (/uses:\s*actions\/upload-artifact@/.test(step.text)) {
        const hits = stepPaths(step).filter((p) => isInstallablePath(p, EXTS));
        if (hits.length) {
          installableUploads++;
          job.installable.push({ n: step.n, paths: hits });
        }
      }
      const what = durableIn(step);
      if (what) job.durable.push({ n: step.n, what, if: stepIf(step), text: step.text });
    }
  }
}

// ── (5) the classifier must still be matching something ──────────────────────
if (installableUploads === 0) {
  coverageLost([
    `ZERO installable upload steps found across ${workflows.length} workflow file(s).`,
    `Looked for ${[...EXTS].sort().join(', ')} and for extension-less directories under a build/ tree.`,
    'This tree uploads .apk, .aab, .msix and three desktop bundles — a zero means the classifier or the',
    'step parser stopped matching, and limb 1 would then range over nothing and report clean.',
  ]);
}

// ── limb 1 ───────────────────────────────────────────────────────────────────
/** Jobs downstream of `name` in `wf`, transitively — the only other place a
 *  durable destination can legitimately live. An upstream job cannot publish an
 *  artifact that does not exist yet. */
function downstream(wf, name) {
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of wf.jobs.values()) {
      if (out.has(j.name) || j.name === name) continue;
      if (j.needs.some((d) => d === name || out.has(d))) { out.add(j.name); grew = true; }
    }
  }
  return out;
}

let graded = 0;
const printed = [];
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    if (job.installable.length === 0) continue;
    const where = [job.name, ...downstream(wf, job.name)];
    const found = where.flatMap((n) => (wf.jobs.get(n)?.durable ?? []).map((d) => ({ ...d, job: n })));

    if (wf.releaseTrigger === null) {
      printed.push(
        `${wf.rel}: job "${job.name}" uploads ${job.installable.length} installable artifact(s) and this workflow has NO release tag trigger, ` +
          `so its uploads are build PROOFS and \`retention-days\` is correct for them${found.length ? ` (it publishes durably anyway: ${found[0].what})` : ''}.`,
      );
      continue;
    }
    graded++;
    if (found.length === 0) {
      problems.push(
        `${wf.rel}: job "${job.name}" uploads an installable artifact (${job.installable[0].paths.join(', ')}, first at :${job.installable[0].n}) ` +
          `and NOTHING in it or downstream of it publishes to a durable destination. This workflow is a release lane — it triggers on \`push: tags:\` at :${wf.releaseTrigger} — ` +
          'so on a tag it produces the artifact a user is meant to install and then lets it expire with the run. That is [9]R-4\'s negation, not a weak form of it.',
      );
      continue;
    }
    const dead = found.filter((d) => d.if && /^false$/i.test(d.if.cond));
    if (dead.length === found.length) {
      problems.push(
        `${wf.rel}: job "${job.name}"'s only durable destination is ${found[0].what} in job "${found[0].job}" at :${found[0].n}, whose step-level \`if:\` is the literal \`false\`. ` +
          'A destination that can never run is the same as no destination, and it reads as one in every diff.',
      );
    }
  }
}

// ── limb 2 ───────────────────────────────────────────────────────────────────
const WRITE = new RegExp(`release-manifest\\.mjs\\s+--write\\s+(\\S+)`);
const VERIFY = new RegExp(`release-manifest\\.mjs\\s+--verify\\s+(\\S+)`);
let publishingJobs = 0;
for (const wf of workflows) {
  for (const job of wf.jobs.values()) {
    if (job.durable.length === 0) continue;
    publishingJobs++;
    const first = job.durable[0];
    const write = job.logical.find((l) => WRITE.test(l.text));
    const verify = job.logical.find((l) => VERIFY.test(l.text));
    if (!write) {
      problems.push(
        `${wf.rel}: job "${job.name}" performs ${first.what} at :${first.n} and never runs \`${MANIFEST_SCRIPT_REL} --write\`. ` +
          `A release published without ${MANIFEST_NAME} is a set of downloads nobody can check against anything — the "integrity record" half of [9]R-4, missing.`,
      );
      continue;
    }
    const dir = write.text.match(WRITE)[1];
    if (write.n > first.n) {
      problems.push(
        `${wf.rel}: job "${job.name}" writes the manifest at :${write.n}, AFTER its first publish at :${first.n}. ` +
          'An integrity record written after the assets have left the runner describes something already downloadable.',
      );
    }
    if (!verify) {
      problems.push(
        `${wf.rel}: job "${job.name}" writes ${MANIFEST_NAME} and never runs \`--verify\`. ` +
          '`--write` is a claim; `--verify` re-hashes every file and fails BOTH ways — a named file that is absent, and a file in the ' +
          'directory the manifest does not name. "A checksum file naming EVERY asset" is the acceptance\'s wording, and only the second direction checks it.',
      );
    } else {
      const vdir = verify.text.match(VERIFY)[1];
      if (vdir !== dir) {
        problems.push(
          `${wf.rel}: job "${job.name}" writes the manifest for \`${dir}\` and verifies \`${vdir}\`. Two directories means the record proves nothing about the one being published.`,
        );
      }
      if (verify.n > first.n) {
        problems.push(`${wf.rel}: job "${job.name}" verifies the manifest at :${verify.n}, AFTER its first publish at :${first.n}. A check that runs after the upload cannot stop it.`);
      }
    }
    // The STEP's whole text, not a logical line looked up by number: a step's
    // `run: |` block is a logical line at the `run:` line, while `step.n` is the
    // `- name:` bullet above it. Matching by number found the NAME line and
    // reported a correct lane as publishing from a directory it never manifested
    // — a false red on the first real run of this guard, 2026-08-06.
    if (!first.text.includes(dir)) {
      problems.push(
        `${wf.rel}: job "${job.name}" manifests \`${dir}\` and its publish command never mentions it. ` +
          'The release would then be assembled from somewhere the integrity record does not describe, which is worse than no record — it looks verified.',
      );
    }
  }
}

// ── limb 3 — the register's "published" predicate ────────────────────────────
const servedNonWeb = (register?.channels ?? []).filter((c) => c?.served === true && c?.kind !== 'web');
for (const c of servedNonWeb) {
  const lane = c.lane;
  const wf = lane ? byRel.get(lane.workflow) : null;
  const anyDurable = wf ? [...wf.jobs.values()].some((j) => j.durable.length > 0) : false;
  if (!anyDurable) {
    problems.push(
      `${REGISTER_REL}: channel "${c.id}" is SERVED and is not the web channel, and its lane ${lane ? `${lane.workflow}#${lane.job}` : '(none declared)'} contains no durable publish. ` +
        'A served native channel with nowhere to publish means the artifact a user is told to download does not exist anywhere after the run.',
    );
  }
}

// ── report ───────────────────────────────────────────────────────────────────
ok(
  `${workflows.length} workflow(s), ${totalJobs} job(s); ${installableUploads} installable upload step(s), ` +
    `${graded} of them in a release lane; ${publishingJobs} job(s) publish durably`,
);
ok(
  `REQUIRED_COVERAGE — ${EXTS.size} installable extension(s) {${[...EXTS].sort().join(' ')}} covering all ${declaredInRegister.size} declared in ` +
    `${REGISTER_REL}${EXTRA_INSTALLABLE ? ` + ${EXTRA_INSTALLABLE.size} declared extra(s)` : ''}; ${lanesChecked} register lane(s) resolved; manifest name read from ${MANIFEST_SCRIPT_REL} as ${MANIFEST_NAME}`,
);
for (const p of printed) note(p);
if (servedNonWeb.length === 0) {
  note(
    `limb 3 — no SERVED non-web channel in ${REGISTER_REL}, so "a published release carries a checksum file" has no subject today. ` +
      'That is CORRECTLY empty rather than accidentally empty: the one served channel is `web`, whose artifactFormat is a static-bundle ' +
      'and never a release asset. It acquires a domain the moment a native row flips to `served: true`, and limb 1 has a real domain in the meantime.',
  );
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`FAIL ${p}`);
  console.error('\nassert-release-durable: FAILED');
  process.exitCode = 1;
} else {
  console.log('\nassert-release-durable: ok');
}
