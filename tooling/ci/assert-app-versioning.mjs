#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-app-versioning.mjs — every shipped build carries a DIFFERENT, HIGHER,
// traceable version, and the number is derived rather than typed.
//
// THE DEFECT THIS EXISTS FOR. `apps/subly/pubspec.yaml` read `version: 1.0.0+1`
// from the first deploy onward and nothing in the repository raised it. Two
// things were broken by that, neither of them cosmetic:
//
//   1. The CFG-1 force-update kill-switch is INERT. packages/core/lib/src/config/
//      version_gate.dart:32 splits the running version on `+` and compares only
//      `major.minor.patch` against `min_supported_version`. Every build that has
//      ever shipped reports `1.0.0`, so there is no floor the owner can set that
//      separates an old client from a new one: set it to 1.0.1 and EVERY client
//      including the newest is walled off; leave it below and it never fires.
//      A kill-switch that cannot distinguish two releases is not a kill-switch.
//   2. A second Android upload would be rejected outright. Play requires a
//      strictly increasing versionCode, and `+1` is not increasing.
//
// THE MECHANISM. pubspec declares the RELEASE LINE (`major.minor`) — the part a
// human owns. CI supplies the patch AND the build number from
// `github.run_number`, which is monotonic per workflow and reproducible from the
// run. So the shipped version is `<release_line>.<run_number>+<sha7>`:
//   · distinct and increasing  — run_number only goes up
//   · reproducible             — same run, same number; a re-run does not bump it
//   · traceable                — the short SHA names the exact commit
//   · kill-switch-usable       — the patch moves, so a floor can sit between two
//                                real releases
// The SHA stays where it always was, in the build metadata after `+`, because a
// SHA is traceable but NOT ORDERED — it can identify a build, it can never rank
// two of them.
//
// WHY THERE IS AN `--emit` MODE. The workflow used to hardcode `1.0.0` in the
// APP_VERSION dart-define, a second copy of a number that already lived in
// pubspec. This script emits the release line for the build step to consume, so
// the value the build uses and the value this guard asserts come out of the SAME
// parser. There is no second notion of "the version" left to drift.
//
// WHAT IS AND IS NOT MECHANISABLE. "Did a human bump 1.0 → 1.1 for this
// feature?" is a judgement call and no guard can make it. What IS checkable, and
// is what actually regressed here, is that the release lane still DERIVES its
// version from a monotonic source instead of freezing a literal. Every check
// below has a written input that makes it fail; see
// tooling/ci/test/app-versioning.test.mjs.
//
// Usage:
//   node tooling/ci/assert-app-versioning.mjs [repoRoot]        # verify
//   node tooling/ci/assert-app-versioning.mjs --emit apps/subly [repoRoot]
//     → prints `release_line=…` / `pubspec_version=…` in GITHUB_OUTPUT form.
//   node tooling/ci/assert-app-versioning.mjs --tag subly-v1.0.0 [--app apps/subly] [repoRoot]
//     → the tag names the build name pubspec declares. See the --tag block.
//
// Exit 0 = wired, 1 = not wired (or the scan shrank), 2 = the flags name no check.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { listDir } from './tree-walk.mjs';
import { parseWorkflow } from './workflow-scan.mjs';

// ── The release lanes are DERIVED FROM THE REGISTER, never typed here ─────────
//
// 🔴 THIS WAS `const RELEASE_LANES = [{ workflow: 'deploy-web.yml', app:
// 'apps/subly' }]` — a one-entry hardcoded array — until 2026-08-03, and that
// array was the whole of R-2's native half being unbuilt. The register already
// carries a `lane: {workflow, job}` on three rows; a private second list here
// could only ever describe the one lane somebody remembered, and the day a
// native lane started shipping it would have been checked by nothing while this
// guard printed "ok  app versioning — 1 release lane(s)".
//
// The relation now is: every `channels[]` row in tooling/channel-register.json
// that has a `lane` IS a lane this guard knows about.
//   · `served: true`   ⇒ every `flutter build` in that job answers for its
//                        version, exactly as deploy-web.yml always has.
//   · `served: false`  ⇒ EXEMPT, and the exemption is PRINTED on every run
//                        naming the row. It expires by itself the day somebody
//                        flips `served` — nobody has to remember this file
//                        exists. (The standing posture for owner-gated work:
//                        failing the build on a channel only the owner can open
//                        blocks every merge on something no agent can do.)
const REGISTER_REL = 'tooling/channel-register.json';


// Steps that put a build in front of users. Deliberately does NOT include
// actions/upload-artifact: build-platforms.yml compiles all six platforms as a
// VERIFICATION matrix and ships none of them, so holding it to release-lane
// rules would fail the build for no user-visible reason.
const DEPLOY_MARKERS =
  /wrangler|pages\s+deploy|action-gh-release|upload-google-play|app-store-connect|apple-actions\/upload/;

// `app_version` is written to D1 through `str(e?.app_version, 32)`
// (services/platform/src/routes/events.ts:135), i.e. SILENTLY TRUNCATED at 32
// characters. A version that overflows is not rejected, it is quietly cut — and
// two different builds can then land in analytics under the same string. Bound
// the run number generously; 9 digits is ~1000x more deploys than this factory
// will ever run, and the point is the bound holds without anyone checking.
//
// ⚠️ MAX_RUN_DIGITS HAS A SECOND REASON, AND IT IS THE IRREVERSIBLE ONE. The
// same number becomes Play's `versionCode`, which Play caps and which can NEVER
// BE REUSED — an upload at or above the ceiling, or at a code already used, is
// rejected outright with nothing in the app to explain it. The ceiling is
// recorded in Private/requirements/ledger.json under [9]R-2 as 2,100,000,000 and
// is marked **UNVERIFIED** here on purpose: it was carried from the stage
// document (pipeline/09-release-engineering.md, folded into that JSON spec and
// deleted 2026-08-15) and was NOT re-fetched from a Google primary source. Do
// not restate it as fact and do not hard-code it — 9 digits sits an order of
// magnitude under the smallest plausible reading of it, which is the safe
// direction.
//
// 🔴 AND `github.run_number` IS PER-WORKFLOW-FILE, WHICH IS A TRAP WITH NO
// DIAGNOSTIC. It counts runs of the workflow FILE. Rename `deploy-web.yml`,
// replace it, or move the build into a new workflow, and the counter RESTARTS
// AT 1 — so the next store upload carries a versionCode lower than one already
// consumed and is rejected, while the app source shows no change at all to
// explain it. There is no way to raise Play's high-water mark back down. If a
// release lane is ever renamed, the build number has to be offset past the
// highest value the old file reached, deliberately and in the same commit.
const APP_VERSION_MAX = 32;
const MAX_RUN_DIGITS = 9;
const SHA_LEN = 7;

/** Pull `--name <value>` out of argv; returns the value (null if absent) and the
 *  argv with both tokens removed.
 *
 *  The `idx === -1` early return is not decoration. `i !== idx + 1` evaluated
 *  with idx === -1 drops argv[0] whenever the flag is ABSENT — the explicit
 *  repoRoot argument, silently replaced by cwd. assert-gate-passed.mjs shipped
 *  with an off-by-one in exactly this position and blocked both production
 *  deploys.
 *
 *  🔴 A FLAG WITH NO VALUE IS FATAL, NOT ABSENT. */
function takeFlag(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return { value: null, rest: argv };
  const value = argv[idx + 1];
  if (value === undefined || value === '' || value.startsWith('--')) {
    console.error(`✗ ${name} was passed with no value — refusing to fall through to a different check and report ok`);
    process.exit(2);
  }
  return { value, rest: argv.filter((_a, i) => i !== idx && i !== idx + 1) };
}

const args = process.argv.slice(2);
const emitFlag = takeFlag(args, '--emit');
const tagFlag = takeFlag(emitFlag.rest, '--tag');
const appFlag = takeFlag(tagFlag.rest, '--app');
const emitApp = emitFlag.value;
const repoRoot = appFlag.rest[0] ?? process.cwd();

// 🔴 MODE COLLISION. MEASURED 2026-08-27: `--emit … --tag subly-v9.9.9` → 0; that tag alone → 1.
if (emitApp !== null && tagFlag.value !== null) {
  console.error('✗ --emit and --tag in one invocation — --emit answers first and the tag would never be read; run them as two steps');
  process.exit(2);
}
if (appFlag.value !== null && tagFlag.value === null) {
  console.error('✗ --app was passed without --tag — it would be silently dropped and a different check report ok');
  process.exit(2);
}

// ── pubspec ──────────────────────────────────────────────────────────────────

/** Strip a YAML comment, respecting quotes. Prose in a comment must never be
 *  able to satisfy — or violate — a check about code. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

const stripAll = (text) => text.split('\n').map(stripComment);

/** Parse the `version:` declaration of a pubspec. Returns null if absent or
 *  malformed — a version that pub itself would reject is a real problem, not
 *  something to shrug past. */
function readPubspecVersion(absPath) {
  if (!existsSync(absPath)) return null;
  for (const line of stripAll(readFileSync(absPath, 'utf8'))) {
    const m = /^version:\s*(\S+)\s*$/.exec(line);
    if (!m) continue;
    const v = /^(\d+)\.(\d+)\.(\d+)(?:[-+]\S*)?$/.exec(m[1]);
    if (!v) return { raw: m[1], bad: true };
    return { raw: m[1], major: v[1], minor: v[2], patch: v[3], releaseLine: `${v[1]}.${v[2]}` };
  }
  return null;
}

// ── --emit: the build step's source of truth ─────────────────────────────────
if (emitApp) {
  const pv = readPubspecVersion(join(repoRoot, emitApp, 'pubspec.yaml'));
  if (!pv || pv.bad) {
    console.error(
      `✗ ${emitApp}/pubspec.yaml has no parseable \`version: X.Y.Z\`${pv ? ` (found "${pv.raw}")` : ''}` +
        ' — there is nothing to derive a build version from',
    );
    process.exit(1);
  }
  process.stdout.write(`release_line=${pv.releaseLine}\npubspec_version=${pv.raw}\n`);
  process.exit(0);
}

// ── --tag: the tag must name the version the app declares ────────────────────
//
// THE HOLE. `RELEASE_TAG` comes straight from `github.ref_name`
// (build-platforms.yml:1266-1272, `TAG="$REF_NAME"`) with nothing validating it,
// then renames every staged installer and titles the Release. Tag `subly-v9.9.9`
// today and the lane publishes `subly-v9.9.9-app-release.aab` whose build name
// is whatever pubspec says. The tag is the one claim a downloader reads BEFORE
// opening the file, and nothing cross-read it; the requirement existed in prose
// only, at tooling/release/RELEASE-RUNBOOK.md:264.
//
// 🔴 WHAT THIS PROVES AND WHAT IT DOES NOT. Two STRINGS agree: the version the
// tag names, and the build name THIS parser reads from pubspec. Nothing here
// opens an artifact, so it is no evidence at all about the versionName the
// compiled binary carries.
//
// BUILD NAME ONLY. pubspec's `+N` is the build NUMBER and the lane overrides it
// with `github.run_number` (see the header), so a tag carrying `+1` would state
// something the artifact contradicts BY DESIGN. `+…` is stripped from both sides.
//
// 🔴 THE SKIP IS THE DANGEROUS HALF, SO IT IS THE NARROW HALF. No tag has ever
// been pushed here (`git tag` → 0, measured 2026-08-27). The value a non-tag run
// synthesises is `${APP}-untagged-<sha7>` (build-platforms.yml:1270); that
// exact shape is a no-op, so anything that is not the untagged shape must
// resolve to an `X.Y.Z` or FAIL.
const UNTAGGED_REF = /^[A-Za-z0-9._-]+-untagged-[0-9a-f]{7,40}$/;

if (tagFlag.value !== null) {
  const tag = tagFlag.value;
  if (UNTAGGED_REF.test(tag)) {
    console.log(`⬜ "${tag}" is the <app>-untagged-<sha> value a NON-tag run synthesises — it claims no version, so there is nothing to compare`);
    process.exit(0);
  }
  const m = /^(.+)-v(.+)$/.exec(tag);
  if (!m) {
    console.error(
      `✗ tag "${tag}" names no version — it renames every staged installer and titles the Release,` +
        ' so a tag with no `-v<version>` ships files whose names claim nothing checkable',
    );
    process.exit(1);
  }
  const [, slug, claimed] = m;
  const claimedName = claimed.split('+')[0];
  if (!/^\d+\.\d+\.\d+$/.test(claimedName)) {
    console.error(
      `✗ tag "${tag}" claims version "${claimed}", which is not \`X.Y.Z\` — it can never equal a` +
        ' pubspec build name, so the installers it names would be unverifiable',
    );
    process.exit(1);
  }
  // 🔴 A CASEFOLD SEAM, CLOSED ON PURPOSE. `apps/${slug}` handed to existsSync
  // resolves case-INSENSITIVELY on this Windows host, so `SUBLY-v1.0.0` passes
  // here and ENOENTs on a case-sensitive filesystem. The leaf is matched EXACTLY
  // against the directory listing instead. It also closes the trap the `push:
  // tags: ['*-v*']` comment names in build-platforms.yml — a tag for a missing
  // app. Split on '/': basename reads the OS.
  const appPath = appFlag.value ?? `apps/${slug}`;
  const segs = appPath.split('/').filter((s) => s !== '');
  const appLeaf = segs.length ? segs[segs.length - 1] : appPath;
  const parentRel = segs.slice(0, -1).join('/') || '.';
  const parentAbs = join(repoRoot, ...segs.slice(0, -1));
  const onDisk = existsSync(parentAbs) ? listDir(parentAbs) : [];
  if (!onDisk.includes(appLeaf)) {
    console.error(
      `✗ tag "${tag}" names app "${appLeaf}" and ${parentRel}/ holds no directory of exactly that name` +
        ` (it has: ${onDisk.join(', ') || 'none'}) — the tag would rename every installer after an` +
        ' app this repository does not build',
    );
    process.exit(1);
  }
  if (appLeaf !== slug) {
    console.error(
      `✗ tag "${tag}" names app "${slug}" but ${appFlag.value === null ? 'its path resolves to' : '--app points at'} ${appPath}` +
        ' — the tag renames every staged installer and titles the Release, so it may relocate that app, not rename it',
    );
    process.exit(1);
  }
  const pv = readPubspecVersion(join(repoRoot, appPath, 'pubspec.yaml'));
  if (!pv || pv.bad) {
    console.error(
      `✗ tag "${tag}" names ${appPath}, whose pubspec has no parseable \`version: X.Y.Z\`` +
        `${pv ? ` (found "${pv.raw}")` : ''} — there is no build name to hold the tag to`,
    );
    process.exit(1);
  }
  const buildName = `${pv.major}.${pv.minor}.${pv.patch}`;
  if (claimedName !== buildName) {
    console.error(
      `✗ tag "${tag}" names version ${claimedName} but ${appPath}/pubspec.yaml declares "${pv.raw}",` +
        ` build name ${buildName}. Every installer would be published under a version the app does` +
        ' not carry. Bump the pubspec or retag; do not rename the files.',
    );
    process.exit(1);
  }
  console.log(
    `ok  tag ↔ pubspec — "${tag}" and ${appPath}/pubspec.yaml ("${pv.raw}") agree on build name` +
      ` ${buildName}; two strings compared, not the artifact.`,
  );
  process.exit(0);
}

// ── verify ───────────────────────────────────────────────────────────────────
const problems = [];
const coverage = [];

const wfDir = join(repoRoot, '.github', 'workflows');
if (!existsSync(wfDir)) {
  console.error(`✗ no .github/workflows under ${repoRoot}`);
  process.exit(1);
}
const wfFiles = listDir(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

/** Fold a `run: >` block back into one command line. The flags of a Flutter
 *  build are spread over a dozen continuation lines; scanning line-by-line would
 *  see `--build-number=${{` and nothing else. */
function commandAt(lines, idx) {
  const indent = lines[idx].length - lines[idx].trimStart().length;
  const parts = [lines[idx].trim()];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') break;
    if (l.length - l.trimStart().length < indent) break;
    parts.push(l.trim());
  }
  // `${{ github.run_number }}` contains spaces; collapse them so the command can
  // be tokenised on whitespace without splitting an expression in half.
  return parts.join(' ').replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_m, inner) => `\${{${inner.replace(/\s+/g, '')}}}`);
}

/** All `flutter build …` commands in a workflow, already folded. */
function flutterBuilds(lines) {
  const out = [];
  lines.forEach((l, i) => {
    if (/\bflutter build\b/.test(l)) out.push(commandAt(lines, i));
  });
  return out;
}

const flag = (cmd, name) => {
  const m = new RegExp(`--${name}=(\\S+)`).exec(cmd);
  return m ? m[1] : null;
};

// ── coverage self-check: has a release lane appeared that nobody declared? ────
// Workflows that trip the build-and-ship heuristic without shipping anything.
// EXPLICIT, not a cleverer regex: an exemption you can read is safer than a
// pattern that quietly stops matching, and this list is short enough to audit.
//
// `ci.yml` earned its place on 2026-07-29 when [pipeline S-3] added
// `flutter build web` against the throwaway probe. It typechecks two Workers
// with `wrangler deploy --dry-run`, so it matches a deploy marker — but a dry
// run ships nothing and the probe app is deleted seconds later. Holding it to
// release-lane rules would fail the build for a version no user can ever see,
// and a guard that fails for no user-visible reason is a guard that gets
// switched off. Same reasoning the DEPLOY_MARKERS comment gives for
// upload-artifact.
const SHIPS_NOTHING = new Set(['ci.yml']);
const lostCoverage = [];

// Every app on disk must at least declare a version pub can read. Independent of
// the lanes, so an app that is not yet deployed still cannot ship malformed.
const appsDir = join(repoRoot, 'apps');
const appsOnDisk = [];
let appsChecked = 0;
if (existsSync(appsDir)) {
  for (const a of listDir(appsDir)) {
    const p = join(appsDir, a, 'pubspec.yaml');
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    appsChecked++;
    appsOnDisk.push(`apps/${a}`);
    const pv = readPubspecVersion(p);
    if (!pv) problems.push(`apps/${a}/pubspec.yaml declares no \`version:\` at all`);
    else if (pv.bad) problems.push(`apps/${a}/pubspec.yaml version "${pv.raw}" is not \`X.Y.Z\` — pub will reject it`);
  }
}
if (appsChecked === 0) {
  lostCoverage.push('COVERAGE LOST — scanned apps/ and found no pubspec.yaml to check');
}

// ── the lanes, DERIVED from the channel register ─────────────────────────────
const regAbs = join(repoRoot, REGISTER_REL);
let register = null;
if (!existsSync(regAbs)) {
  lostCoverage.push(
    `COVERAGE LOST — ${REGISTER_REL} does not exist, so the lane set is derived from nothing.` +
      ' Every check below quantifies over "the release lanes"; with no register that set is empty and' +
      ' this guard would report clean over a tree with any number of unversioned lanes in it.',
  );
} else {
  try {
    register = JSON.parse(readFileSync(regAbs, 'utf8'));
  } catch (e) {
    lostCoverage.push(`COVERAGE LOST — ${REGISTER_REL} could not be parsed (${e.message})`);
  }
}

/** The apps a lane ships. Derived from the workflow, never declared here.
 *
 *  A workflow that NAMES an app directory (a `working-directory: apps/x`, an
 *  `--emit apps/x`, a path under `apps/x/build/…`) ships that app. A workflow
 *  that names none is building whatever the pub workspace resolves, which is
 *  every app on disk — so that is what it answers for. The fallback is not a
 *  shrug: it is the reading that can only ever check MORE, and a lane that
 *  names no app while still shipping is exactly the shape nobody would think to
 *  add to a hand-written list. */
const appsOf = (text) => {
  const named = appsOnDisk.filter((a) => text.includes(a));
  return named.length ? named : appsOnDisk;
};

const RELEASE_LANES = [];
if (register !== null) {
  const rows = Array.isArray(register.channels) ? register.channels : [];
  if (rows.length === 0) {
    lostCoverage.push(`COVERAGE LOST — ${REGISTER_REL} declares no \`channels\`, so no lane could be derived`);
  }
  for (const row of rows) {
    const lane = row?.lane;
    if (!lane || typeof lane.workflow !== 'string' || typeof lane.job !== 'string') continue;
    // The register writes the lane as a REPO-RELATIVE path and this guard has
    // always worked in workflow basenames. Take the basename so both spellings
    // resolve to one file rather than inventing a third convention.
    const wfFile = lane.workflow.split('/').pop();
    if (!existsSync(join(wfDir, wfFile))) {
      lostCoverage.push(
        `the register's "${row.id}" row names .github/workflows/${wfFile}, which does not exist`,
      );
      continue;
    }
    const parsed = parseWorkflow(repoRoot, `.github/workflows/${wfFile}`);
    const jobNames = parsed ? [...parsed.jobs.keys()] : [];
    if (!parsed || !parsed.jobs.has(lane.job)) {
      lostCoverage.push(
        `the register's "${row.id}" row names job "${lane.job}" in ${wfFile}, and that workflow declares` +
          ` no such job (it has: ${jobNames.join(', ') || 'none'}). A lane that resolves to no job is a` +
          ' lane nothing checks.',
      );
      continue;
    }
    const jobText = parsed.jobs.get(lane.job).logical.map((l) => l.text).join('\n');
    RELEASE_LANES.push({
      id: row.id,
      workflow: wfFile,
      job: lane.job,
      served: row.served === true,
      apps: appsOf(`${jobText}\n${readFileSync(join(wfDir, wfFile), 'utf8')}`),
    });
  }
  if (rows.length > 0 && RELEASE_LANES.length === 0) {
    lostCoverage.push(
      `COVERAGE LOST — ${REGISTER_REL} has ${rows.length} channel(s) and NONE resolved to a lane, so this` +
        ' guard checks nothing. A register whose rows all lost their `lane` block is not a tree with no' +
        ' release lanes; it is a scan with no subject.',
    );
  }
}

// A workflow that BUILDS and SHIPS but that no register row names as a lane.
// The register is the declaration; this is the direction that catches an
// undeclared one, and it is the reason a new native release lane cannot arrive
// unversioned and silent.
const laneWorkflows = new Set(RELEASE_LANES.map((l) => l.workflow));
for (const f of wfFiles) {
  const text = stripAll(readFileSync(join(wfDir, f), 'utf8')).join('\n');
  const ships = DEPLOY_MARKERS.test(text) && /\bflutter build\b/.test(text);
  if (ships && !laneWorkflows.has(f) && !SHIPS_NOTHING.has(f)) {
    lostCoverage.push(
      `${f} builds a Flutter app AND deploys it, but no ${REGISTER_REL} row names it as a lane —` +
        ' it ships unversioned',
    );
  }
}

const servedLanes = RELEASE_LANES.filter((l) => l.served);
const deferredLanes = RELEASE_LANES.filter((l) => !l.served);
if (register !== null && RELEASE_LANES.length > 0 && servedLanes.length === 0) {
  lostCoverage.push(
    `COVERAGE LOST — ${RELEASE_LANES.length} lane(s) resolved and NONE is served, so every per-lane` +
      ' check below is exempt and this guard asserts nothing at all. That is a real state to be in only' +
      ' if the factory ships to nobody; say so by removing the lanes, not by leaving the checks inert.',
  );
}

if (lostCoverage.length) {
  console.error('✗ COVERAGE LOST — the scan no longer reaches what it claims to cover:');
  for (const p of lostCoverage) console.error(`    ${p}`);
  console.error('  The scan is broken, or a new lane needs declaring. Either way this is not "clean".');
  process.exit(1);
}

// ── the per-lane checks ──────────────────────────────────────────────────────
let buildsChecked = 0;
const exemptions = [];

for (const laneRow of servedLanes) {
 for (const laneApp of laneRow.apps) {
  const lane = { ...laneRow, app: laneApp };
  const rel = `.github/workflows/${lane.workflow}`;
  const lines = stripAll(readFileSync(join(wfDir, lane.workflow), 'utf8'));
  const text = lines.join('\n');
  const pv = readPubspecVersion(join(repoRoot, lane.app, 'pubspec.yaml'));
  if (!pv || pv.bad) {
    // Named HERE as well as in the apps/ scan, so a lane whose app ever lives
    // outside apps/ still reports rather than silently dropping out of the loop.
    problems.push(
      `${rel} ships ${lane.app}, whose pubspec has no usable \`version: X.Y.Z\`` +
        `${pv ? ` (found "${pv.raw}")` : ''} — there is no release line to derive a build version from`,
    );
    continue;
  }

  // 1. The version must be DERIVED from pubspec by this very script, so the
  //    number that gets built and the number that gets asserted share a parser.
  //
  //    The argument may name the app path LITERALLY, or be the MATRIX LEG that
  //    expands to it. [10]D-2b made deploy-web.yml a matrix over the workspace
  //    app set (2026-08-07), so `--emit apps/${{ matrix.app }}` derives the
  //    version for EVERY app rather than for the one somebody typed — strictly
  //    stronger than the literal. A guard that knew only the literal would have
  //    failed the refactor that satisfies the requirement, which is how a check
  //    gets switched off rather than fixed.
  //
  //    ⚠️ IT DOES NOT RE-CHECK THAT THE MATRIX KEY IS DECLARED, and the omission
  //    is deliberate: GitHub expands an undeclared matrix context to the EMPTY
  //    STRING, and limb A′ of assert-release-lane-generic.mjs fails the build on
  //    exactly that, on every run, for every graded lane. A second copy here
  //    would be two implementations of one check, drifting in the way this file's
  //    own header says such copies always drift.
  const EMIT_ARG =
    `(?:${lane.app.replace(/\//g, '[/\\\\]')}\\b|apps[/\\\\]\\$\\{\\{[^}]*\\}\\})`;
  const emitLine = lines.findIndex((l) =>
    new RegExp(`assert-app-versioning\\.mjs\\s+--emit\\s+${EMIT_ARG}`).test(l),
  );
  let stepId = null;
  if (emitLine === -1) {
    problems.push(
      `${rel} never derives the version from ${lane.app}/pubspec.yaml` +
        ` (expected a step running \`assert-app-versioning.mjs --emit ${lane.app}\`)`,
    );
  } else {
    for (let i = emitLine; i >= 0 && i > emitLine - 12; i--) {
      const m = /^\s*id:\s*(\S+)\s*$/.exec(lines[i]);
      if (m) {
        stepId = m[1];
        break;
      }
      if (/^\s*-\s+(name|uses):/.test(lines[i]) && i !== emitLine) break;
    }
    if (!stepId) {
      problems.push(`${rel} runs --emit but the step has no \`id:\`, so nothing can read its outputs`);
    } else if (!text.includes(`steps.${stepId}.outputs.release_line`)) {
      problems.push(
        `${rel} derives release_line into step "${stepId}" and then never uses it —` +
          ' the build still versions itself from somewhere else',
      );
    }
  }

  const builds = flutterBuilds(lines);
  if (builds.length === 0) {
    problems.push(`${rel} is declared a release lane but runs no \`flutter build\``);
  }

  for (const cmd of builds) {
    buildsChecked++;

    // 2. Build number — the Play versionCode. Must be monotonic.
    const bn = flag(cmd, 'build-number');
    if (bn === null) {
      problems.push(
        `${rel} \`flutter build\` passes no --build-number — every upload carries the same` +
          ' versionCode and Play rejects the second one',
      );
    } else if (/^[0-9]/.test(bn)) {
      problems.push(`${rel} --build-number is the literal "${bn}" — a constant is not increasing`);
    } else if (/github\.sha|GITHUB_SHA/.test(bn)) {
      problems.push(
        `${rel} --build-number is derived from the commit SHA — a SHA is traceable but NOT ORDERED,` +
          ' and Play needs strictly increasing',
      );
    } else if (!/github\.run_number/.test(bn)) {
      problems.push(
        `${rel} --build-number "${bn}" is not derived from github.run_number, the only monotonic` +
          ' source available to the lane',
      );
    }

    // 3. Build name — the version string the store and the kill-switch see.
    const bname = flag(cmd, 'build-name');
    if (bname === null) {
      problems.push(
        `${rel} \`flutter build\` passes no --build-name, so the binary keeps pubspec's frozen` +
          " version and version_gate.dart can never tell two releases apart",
      );
    } else {
      if (/^[0-9]/.test(bname)) {
        problems.push(
          `${rel} --build-name "${bname}" is a hardcoded literal — a second copy of the version` +
            ` that ${lane.app}/pubspec.yaml already declares, free to drift from it`,
        );
      } else if (!bname.includes('outputs.release_line')) {
        problems.push(`${rel} --build-name "${bname}" is not derived from the pubspec release line`);
      }
      if (!/github\.run_number/.test(bname)) {
        problems.push(
          `${rel} --build-name "${bname}" does not move with github.run_number.` +
            ' version_gate.dart drops everything after `+`, so a frozen major.minor.patch leaves' +
            ' the CFG-1 force-update kill-switch with no floor it can usefully sit on.',
        );
      }
    }

    // 4. APP_VERSION — what analytics and the consent artifact record, and what
    //    version_gate.dart actually compares at runtime.
    const dd = /--dart-define=APP_VERSION=(\S+)/.exec(cmd);
    if (!dd) {
      problems.push(
        `${rel} passes no --dart-define=APP_VERSION, so AppConfig falls back to 'dev' and every` +
          ' production row is indistinguishable from a developer laptop',
      );
    } else {
      const appVersion = dd[1];
      const plus = appVersion.indexOf('+');
      const core = plus === -1 ? appVersion : appVersion.slice(0, plus);
      const meta = plus === -1 ? '' : appVersion.slice(plus + 1);

      if (/^[0-9]/.test(core)) {
        problems.push(
          `${rel} APP_VERSION's version core "${core}" is hardcoded. version_gate.dart compares` +
            ' exactly this substring against min_supported_version, so a literal here is the' +
            ' kill-switch being inert no matter what pubspec says.',
        );
      }
      if (bname !== null && core !== bname) {
        problems.push(
          `${rel} APP_VERSION core "${core}" differs from --build-name "${bname}" — the number the` +
            ' store shows and the number the kill-switch compares would be two different things',
        );
      }
      if (!/GITHUB_SHA|github\.sha/.test(meta)) {
        problems.push(
          `${rel} APP_VERSION carries no commit SHA in its build metadata — the version is ordered` +
            ' but no longer traceable to a commit',
        );
      }

      // Worst-case rendered length, against the server's silent truncation.
      const worst = pv.releaseLine.length + 1 + MAX_RUN_DIGITS + 1 + SHA_LEN;
      if (worst > APP_VERSION_MAX) {
        problems.push(
          `${rel} APP_VERSION can render up to ${worst} chars (release line "${pv.releaseLine}"` +
            ` + ${MAX_RUN_DIGITS}-digit run + "+" + ${SHA_LEN}-char sha) but the platform Worker` +
            ` truncates app_version at ${APP_VERSION_MAX} — two builds could land under one string`,
        );
      }
    }
  }
 }
}

// ── the deferred lanes: EXEMPT, and the exemption expires by itself ──────────
// A row with a lane and `served: false` builds an artifact nobody receives, so
// holding it to a version rule would fail the build over a number no user can
// see. What must NOT happen is the exemption becoming invisible: it is printed
// on every run, naming the row, so the day somebody flips `served` the guard
// starts asking and nobody has to remember this file exists.
for (const lane of deferredLanes) {
  const lines = stripAll(readFileSync(join(wfDir, lane.workflow), 'utf8'));
  const parsed = parseWorkflow(repoRoot, `.github/workflows/${lane.workflow}`);
  const jobLines = parsed.jobs.get(lane.job).logical;
  const builds = jobLines.filter((l) => /\bflutter build\b/.test(l.text)).map((l) => l.text);
  const withNumber = builds.filter((c) => /--build-number=/.test(c)).length;
  exemptions.push(
    `"${lane.id}" — .github/workflows/${lane.workflow} job "${lane.job}" builds ${builds.length} artifact(s), ` +
      `${withNumber} of them passing --build-number. The row is served: false, so this lane is EXEMPT from ` +
      'the version rules above and this line is the exemption. Flip `served` to true and every check the ' +
      'web lane answers becomes this lane\'s to answer too.' +
      (lines.length ? '' : ''),
  );
}

// NOTE — there is deliberately NO `if (buildsChecked === 0) COVERAGE LOST` here.
// A draft had one. Mutation testing then showed it could never fire: every route
// to zero matched builds already pushes a strictly better-worded problem ("is
// declared a release lane but runs no `flutter build`", or the unreadable-pubspec
// message above), including when the matcher regex in flutterBuilds() is itself
// broken — which is the exact scenario such a check exists for. By this repo's
// own rule an assertion that cannot fail is worse than none, because it inflates
// apparent coverage, so it was removed rather than kept for the look of it. The
// coverage that DOES matter here — an undeclared release lane, an empty
// RELEASE_LANES, an apps/ scan that reaches nothing — is asserted above and each
// case has a recorded failing input.
if (problems.length) {
  console.error(`✗ ${problems.length} app-versioning problem(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(
    '  Every deployed build must carry a distinct, increasing, traceable version.' +
      ' See the header of tooling/ci/assert-app-versioning.mjs for why.',
  );
  process.exit(1);
}

if (exemptions.length) {
  console.log('⬜ deferred lanes, EXEMPT and printed not hidden:');
  for (const e of exemptions) console.log(`    ${e}`);
}

console.log(
  `ok  app versioning — ${RELEASE_LANES.length} release lane(s) derived from ${REGISTER_REL}` +
    ` (${servedLanes.length} served and checked, ${deferredLanes.length} deferred and printed),` +
    ` ${buildsChecked} build command(s), ${appsChecked} app pubspec(s);` +
    ' version derived from pubspec + github.run_number',
);
