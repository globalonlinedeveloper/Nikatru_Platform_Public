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
//
// Exit 0 = the version mechanism is wired, 1 = it is not (or the scan shrank).
// ─────────────────────────────────────────────────────────────────────────────
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── The release lanes: a workflow that BUILDS a Flutter app and SHIPS it. ─────
// Declared rather than sniffed, so the guard can name the app each lane ships.
// The coverage self-check below refuses to let this list fall behind the tree.
const RELEASE_LANES = [{ workflow: 'deploy-web.yml', app: 'apps/subly' }];

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
const APP_VERSION_MAX = 32;
const MAX_RUN_DIGITS = 9;
const SHA_LEN = 7;

const args = process.argv.slice(2);
const emitIdx = args.indexOf('--emit');
const emitApp = emitIdx === -1 ? null : args[emitIdx + 1];
// `i !== emitIdx + 1` unguarded would drop argv[0] whenever --emit is ABSENT
// (indexOf returns -1, so emitIdx + 1 === 0) — the explicit repoRoot argument,
// silently replaced by cwd. assert-gate-passed.mjs shipped with an off-by-one in
// exactly this position and blocked both production deploys.
const positional = emitIdx === -1 ? args : args.filter((a, i) => i !== emitIdx && i !== emitIdx + 1);
const repoRoot = positional[0] ?? process.cwd();

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

// ── verify ───────────────────────────────────────────────────────────────────
const problems = [];
const coverage = [];

const wfDir = join(repoRoot, '.github', 'workflows');
if (!existsSync(wfDir)) {
  console.error(`✗ no .github/workflows under ${repoRoot}`);
  process.exit(1);
}
const wfFiles = readdirSync(wfDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

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
const declaredWorkflows = new Set(RELEASE_LANES.map((l) => l.workflow));
const lostCoverage = [];
for (const f of wfFiles) {
  const lines = stripAll(readFileSync(join(wfDir, f), 'utf8'));
  const text = lines.join('\n');
  const ships = DEPLOY_MARKERS.test(text) && /\bflutter build\b/.test(text);
  if (ships && !declaredWorkflows.has(f) && !SHIPS_NOTHING.has(f)) {
    lostCoverage.push(
      `${f} builds a Flutter app AND deploys it, but is not in RELEASE_LANES — it ships unversioned`,
    );
  }
}
for (const lane of RELEASE_LANES) {
  if (!existsSync(join(wfDir, lane.workflow))) {
    lostCoverage.push(`RELEASE_LANES names .github/workflows/${lane.workflow}, which does not exist`);
  }
  if (!existsSync(join(repoRoot, lane.app, 'pubspec.yaml'))) {
    lostCoverage.push(`RELEASE_LANES names ${lane.app}, which has no pubspec.yaml`);
  }
}

// Every app on disk must at least declare a version pub can read. Independent of
// the lanes, so an app that is not yet deployed still cannot ship malformed.
const appsDir = join(repoRoot, 'apps');
let appsChecked = 0;
if (existsSync(appsDir)) {
  for (const a of readdirSync(appsDir)) {
    const p = join(appsDir, a, 'pubspec.yaml');
    if (!existsSync(p) || !statSync(p).isFile()) continue;
    appsChecked++;
    const pv = readPubspecVersion(p);
    if (!pv) problems.push(`apps/${a}/pubspec.yaml declares no \`version:\` at all`);
    else if (pv.bad) problems.push(`apps/${a}/pubspec.yaml version "${pv.raw}" is not \`X.Y.Z\` — pub will reject it`);
  }
}
if (appsChecked === 0) {
  lostCoverage.push('COVERAGE LOST — scanned apps/ and found no pubspec.yaml to check');
}
if (RELEASE_LANES.length === 0) {
  lostCoverage.push('COVERAGE LOST — RELEASE_LANES is empty, so this guard checks nothing');
}

if (lostCoverage.length) {
  console.error('✗ COVERAGE LOST — the scan no longer reaches what it claims to cover:');
  for (const p of lostCoverage) console.error(`    ${p}`);
  console.error('  The scan is broken, or a new lane needs declaring. Either way this is not "clean".');
  process.exit(1);
}

// ── the per-lane checks ──────────────────────────────────────────────────────
let buildsChecked = 0;

for (const lane of RELEASE_LANES) {
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
  const emitLine = lines.findIndex((l) =>
    new RegExp(`assert-app-versioning\\.mjs\\s+--emit\\s+${lane.app.replace(/\//g, '[/\\\\]')}\\b`).test(l),
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

console.log(
  `ok  app versioning — ${RELEASE_LANES.length} release lane(s), ${buildsChecked} build command(s),` +
    ` ${appsChecked} app pubspec(s); version derived from pubspec + github.run_number`,
);
