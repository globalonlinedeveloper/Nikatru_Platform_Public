// ─────────────────────────────────────────────────────────────────────────────
// built-artifact-pr-lane.test.mjs — ci.yml's `android-artifacts` against
// build-platforms.yml's `linux_web_android`.
//
// ⏱ ADDED 2026-09-23 (O-BUILT-ARTIFACT-GUARDS-RUN-ONLY-AFTER-MERGE). The guards
// that read a BUILT Android artifact (the VAPT manifest items, the apps.gov.in
// signer and minSdk, the 16 KB page alignment, the artifact shape) ran only in
// build-platforms.yml, on a tag, a schedule or a dispatch, so a PR could break
// the merged manifest and nothing said so until after the merge. ci.yml now
// builds the same three Android artifacts on every PR, inspects them with the
// same guards and discards them.
//
// That is two copies of three build commands, and a copy is only worth having
// while it is the same build. This file is what holds the PR copy to the main
// one, flag for flag and define for define, and holds the PR lane to its own
// contract: it references only the secret the register maps for a store-rail
// stamp, uploads nothing, never signs, runs every built-artifact guard main runs
// (or names the one it cannot, with the reason), and carries no job-level `if:`.
//
// The workflows are read through workflow-scan.mjs, the one parse of a workflow
// in this tree. Every case reads the REAL tree; the red control of each case is
// recorded in the PR that added it (a mutation of the tree, then the restore).
//
// Exit codes are node:test's: 0 every case passed, 1 a case failed.
// ─────────────────────────────────────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, flutterReleaseBuilds, shellSegments, definesIn, workflowSteps } from '../workflow-scan.mjs';
import { PR_BLANKED } from '../flutter-release-build.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');

const PR_WORKFLOW = '.github/workflows/ci.yml';
const MAIN_WORKFLOW = '.github/workflows/build-platforms.yml';
const PR_JOB = 'android-artifacts';
const APPS_JOB = 'prepare';
const MAIN_JOB = 'linux_web_android';
const GATE_JOB = 'ci-gate';

/** The built-artifact guards main runs that the PR lane does not, each with the
 *  reason a PR run could give it no meaningful subject. T8 reads this; T9 holds
 *  every entry to a guard main still runs. */
const MAIN_ONLY = {
  'assert-artifact-signed.mjs':
    'its question is "is this the UPLOAD key and not the debug key". A PR holds no key by design, so its only possible PR answer is "debug", which says nothing. Its PR-time analogue is android-signing.test.mjs, plus android-signing.mjs refusing a partial secret set',
};

const ciWorkflow = parseWorkflow(REPO, PR_WORKFLOW);
const mainWorkflow = parseWorkflow(REPO, MAIN_WORKFLOW);

/** A job by name, or a failure that names what is missing — never an empty job
 *  that every assertion below would pass over. */
function jobOf(wf, rel, name) {
  assert.ok(wf, `${rel} did not parse, so there is nothing to compare`);
  const job = wf.jobs.get(name);
  assert.ok(job, `${rel} has no job "${name}" — renamed or removed, and this test would otherwise pass over nothing`);
  return job;
}

const ALL_BUILDS = flutterReleaseBuilds(REPO, [ciWorkflow, mainWorkflow].filter(Boolean));
const prBuilds = () => {
  jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB);
  const out = ALL_BUILDS.filter((b) => b.workflow === PR_WORKFLOW && b.job === PR_JOB);
  assert.ok(out.length > 0, `${PR_WORKFLOW} job "${PR_JOB}" runs no release \`flutter build\``);
  return out;
};
const mainAndroidBuilds = () => {
  jobOf(mainWorkflow, MAIN_WORKFLOW, MAIN_JOB);
  const out = ALL_BUILDS.filter((b) => b.workflow === MAIN_WORKFLOW && b.job === MAIN_JOB && b.platform === 'android');
  assert.ok(out.length > 0, `${MAIN_WORKFLOW} job "${MAIN_JOB}" runs no Android release \`flutter build\``);
  return out;
};

/** What pairs a PR build with its main twin: the target and the channel stamp. */
const twinKey = (b) => `${b.target}/${b.stamp}`;

/** One token per flag. A `${{ … }}` expression holds spaces and is one token. */
const FLAG_TOKEN = /(?:\$\{\{.*?\}\}|\S)+/g;
const SECRET_ONLY = /^\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}$/;

/**
 * A build's flags as the comparison sees them:
 *  - `--build-name=…` and `--build-number=…` are dropped;
 *  - `APP_VERSION=` becomes `APP_VERSION=*` (the PR ends in +pr, main in the commit);
 *  - a define whose value is a `${{ secrets.* }}` expression or empty becomes
 *    `NAME=` — the PR lane holds no secret, so main's secret and the PR's empty
 *    value are the same flag. T5 is what stops a PR secret hiding behind this;
 *  - `RELEASE_CHANNEL` and `REVENUECAT_KEY` (R-KEY A: the PR passes main's public
 *    key) are compared verbatim, and so is every other flag.
 *  - ⏱ 2026-09-26 (O-FLUTTER-BUILD-TYPED-PER-LINE, part 3 of 3): both twins are now
 *    composed by tooling/ci/flutter-release-build.mjs, and main's API_BASE_URL is the
 *    composer's rule value, not a secret. A define the composer's `--lane pr` blanks
 *    (PR_BLANKED, imported, never listed here) therefore becomes `NAME=` too.
 */
function normalise(segment) {
  const at = segment.search(/flutter\s+build\b/);
  const tokens = segment.slice(at === -1 ? 0 : at).match(FLAG_TOKEN) ?? [];
  const out = [];
  for (const t of tokens) {
    if (/^--build-(?:name|number)=/.test(t)) continue;
    const d = t.match(/^--dart-define=([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (d === null) {
      out.push(t);
      continue;
    }
    const [, name, value] = d;
    if (name === 'APP_VERSION') out.push('--dart-define=APP_VERSION=*');
    else if (name === 'RELEASE_CHANNEL' || name === 'REVENUECAT_KEY') out.push(t);
    else if (value === '' || SECRET_ONLY.test(value) || PR_BLANKED.has(name)) out.push(`--dart-define=${name}=`);
    else out.push(t);
  }
  return out;
}

/** Every build on the `from` side that has no single twin on the `to` side, or
 *  whose flags differ from its twin's, as one line each naming the flags. */
function driftFindings(fromBuilds, fromRel, toBuilds, toRel) {
  const findings = [];
  for (const b of fromBuilds) {
    const twins = toBuilds.filter((t) => twinKey(t) === twinKey(b));
    if (twins.length !== 1) {
      findings.push(`${fromRel}:${b.runLine} \`flutter build ${twinKey(b)}\` has ${twins.length} twin(s) in ${toRel}; exactly 1 is the contract`);
      continue;
    }
    const a = normalise(b.segment);
    const z = normalise(twins[0].segment);
    if (a.join(' ') === z.join(' ')) continue;
    const onlyA = a.filter((t) => !z.includes(t));
    const onlyZ = z.filter((t) => !a.includes(t));
    findings.push(
      `${fromRel}:${b.runLine} vs ${toRel}:${twins[0].runLine} (${twinKey(b)}): only in ${fromRel} [${onlyA.join(' ')}], only in ${toRel} [${onlyZ.join(' ')}]` +
        (onlyA.length === 0 && onlyZ.length === 0 ? ' — the same flags in a different order' : ''),
    );
  }
  return findings;
}

/** Every `node … tooling/ci/assert-*.mjs` a job runs: the script and its arguments. */
function guardInvocations(job) {
  const out = [];
  for (const l of job.logical) {
    for (const seg of shellSegments(l.text)) {
      const m = seg.match(/\bnode\b.*?tooling\/ci\/(assert-[A-Za-z0-9-]+\.mjs)(.*)$/);
      if (m) out.push({ n: l.n, script: m[1], args: m[2] });
    }
  }
  return out;
}

/** An argument that names a built Android artifact, or the artifact-shape lane. */
const ARTIFACT_ARGUMENT = /\.apk\b|\.aab\b|agi_apk|--platform\b/;

const mainArtifactGuards = () =>
  new Set(guardInvocations(jobOf(mainWorkflow, MAIN_WORKFLOW, MAIN_JOB)).filter((g) => ARTIFACT_ARGUMENT.test(g.args)).map((g) => g.script));

// ── T1 ───────────────────────────────────────────────────────────────────────
test('the PR lane builds the same three Android targets as linux_web_android', () => {
  assert.deepEqual(
    prBuilds().map(twinKey).sort(),
    mainAndroidBuilds().map(twinKey).sort(),
    `the (target/stamp) set of ${PR_WORKFLOW} "${PR_JOB}" must equal the Android builds of ${MAIN_WORKFLOW} "${MAIN_JOB}"`,
  );
});

// ── T2 ───────────────────────────────────────────────────────────────────────
test('each PR build carries the same flags as its main twin', () => {
  assert.deepEqual(driftFindings(prBuilds(), PR_WORKFLOW, mainAndroidBuilds(), MAIN_WORKFLOW), []);
});

// ── T3 ───────────────────────────────────────────────────────────────────────
test('each PR build carries every define NAME its main twin carries', () => {
  const main = mainAndroidBuilds();
  const findings = [];
  for (const b of prBuilds()) {
    const twin = main.find((t) => twinKey(t) === twinKey(b));
    if (twin === undefined) {
      findings.push(`${PR_WORKFLOW}:${b.runLine} (${twinKey(b)}) has no twin in ${MAIN_WORKFLOW}`);
      continue;
    }
    const pr = [...definesIn(b.segment)].sort();
    const mn = [...definesIn(twin.segment)].sort();
    const missing = mn.filter((d) => !pr.includes(d));
    const extra = pr.filter((d) => !mn.includes(d));
    if (missing.length || extra.length) {
      findings.push(`${PR_WORKFLOW}:${b.runLine} (${twinKey(b)}): missing [${missing.join(', ')}], extra [${extra.join(', ')}] against ${MAIN_WORKFLOW}:${twin.runLine}`);
    }
  }
  assert.deepEqual(findings, []);
});

// ── T4 ───────────────────────────────────────────────────────────────────────
// T2 walks the PR builds; this walks main's. A stamp changed on main alone leaves
// a main build with no PR twin, and that is red here whatever the PR side says.
test('a channel changed on main alone turns the PR lane red', () => {
  assert.deepEqual(driftFindings(mainAndroidBuilds(), MAIN_WORKFLOW, prBuilds(), PR_WORKFLOW), []);
});

// ── T5 (R-KEY A) ─────────────────────────────────────────────────────────────
// The allowed set is DERIVED from the register: a build whose stamp's channel
// sells through a rail in purchaseRails.storeKeyDefine.secretByRail may pass that
// rail's secret, and only as the storeKeyDefine define, on that build's own line.
// Any other secret on any line of the job is a finding.
test('the PR lane references only the secret the register maps for its store-rail stamps', () => {
  const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  const storeKey = register?.purchaseRails?.storeKeyDefine;
  assert.ok(
    typeof storeKey?.define === 'string' && storeKey?.secretByRail && typeof storeKey.secretByRail === 'object',
    'tooling/channel-register.json purchaseRails.storeKeyDefine has no `define` and `secretByRail` to derive the allowed secret from',
  );
  const channels = Array.isArray(register.channels) ? register.channels : [];
  const railOf = (stamp) => channels.find((c) => c?.id === stamp)?.purchaseRail?.rail ?? null;

  const job = jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB);
  const steps = workflowSteps(job);
  const allowed = new Map();
  for (const b of prBuilds()) {
    const secret = storeKey.secretByRail[railOf(b.stamp)];
    if (typeof secret !== 'string') continue;
    const step = steps.find((s) => s.run?.n === b.runLine);
    assert.ok(step, `${PR_WORKFLOW}:${b.runLine} — no step holds this build's run line`);
    // A typed build names the secret on its define line; a composer call names it
    // once, in its step's env, and the composer passes it as that define
    // (⏱ 2026-09-26, O-FLUTTER-BUILD-TYPED-PER-LINE part 3 of 3).
    const tokens = [`--dart-define=${storeKey.define}=\${{ secrets.${secret} }}`, `${secret}: \${{ secrets.${secret} }}`];
    for (const l of job.lines) {
      if (l.n >= step.first && l.n <= step.last && tokens.includes(l.text.trim())) allowed.set(l.n, l.text.trim());
    }
  }

  const findings = [];
  for (const l of job.lines) {
    if (!/\$\{\{\s*secrets\./.test(l.text)) continue;
    if (allowed.get(l.n) === l.text.trim()) continue;
    findings.push(`${PR_WORKFLOW}:${l.n} ${l.text.trim()}`);
  }
  assert.deepEqual(findings, [], 'a secret the register does not map to this build\'s store-rail stamp');
});

// ── T6 ───────────────────────────────────────────────────────────────────────
test('the PR lane uploads nothing', () => {
  const UPLOADS = [
    [/\buses:\s*actions\/upload-artifact@/, 'actions/upload-artifact'],
    [/upload-native-symbols/, 'upload-native-symbols'],
    [/glitchtip-cli|create-glitchtip-release/, 'glitchtip'],
    [/record-deployment/, 'record-deployment'],
    [/\bgh\s+release\b/, 'gh release'],
  ];
  const findings = [];
  for (const l of jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB).lines) {
    for (const [re, what] of UPLOADS) if (re.test(l.text)) findings.push(`${PR_WORKFLOW}:${l.n} ${what}: ${l.text.trim()}`);
  }
  assert.deepEqual(findings, []);
});

// ── T7 ───────────────────────────────────────────────────────────────────────
test('the PR lane never runs the signing script', () => {
  const findings = [];
  for (const l of jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB).logical) {
    for (const seg of shellSegments(l.text)) {
      if (/tooling\/ci\/android-signing\.mjs/.test(seg)) findings.push(`${PR_WORKFLOW}:${l.n} ${seg.trim()}`);
    }
  }
  assert.deepEqual(findings, []);
});

// ── T8 ── the class guard ────────────────────────────────────────────────────
// Compared by SCRIPT NAME: the arguments differ on purpose (--posture debug here,
// the minted posture on main; the lane key of artifact-shape).
test('every built-artifact guard on main is in the PR lane or declared main-only', () => {
  const pr = new Set(guardInvocations(jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB)).map((g) => g.script));
  const missing = [...mainArtifactGuards()].filter((s) => !pr.has(s) && !Object.hasOwn(MAIN_ONLY, s)).sort();
  assert.deepEqual(
    missing,
    [],
    `${MAIN_WORKFLOW} "${MAIN_JOB}" runs these over a built artifact and ${PR_WORKFLOW} "${PR_JOB}" does not — run it there, or add it to MAIN_ONLY with the reason`,
  );
});

// ── T9 ───────────────────────────────────────────────────────────────────────
test('a MAIN_ONLY entry that main no longer runs is stale', () => {
  const main = mainArtifactGuards();
  const stale = Object.keys(MAIN_ONLY).filter((s) => !main.has(s)).sort();
  assert.deepEqual(stale, [], `MAIN_ONLY names a guard ${MAIN_WORKFLOW} "${MAIN_JOB}" no longer runs over an artifact — delete the entry`);
});

// ── T10 ──────────────────────────────────────────────────────────────────────
test('the apps.gov.in check runs in debug posture', () => {
  const calls = guardInvocations(jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB)).filter((g) => g.script === 'assert-apps-gov-in-apk.mjs');
  assert.equal(calls.length, 1, `${PR_WORKFLOW} "${PR_JOB}" must run assert-apps-gov-in-apk.mjs exactly once; found ${calls.length}`);
  assert.match(
    calls[0].args,
    /(?:^|\s)--posture\s+debug(?:\s|$)/,
    `${PR_WORKFLOW}:${calls[0].n} — no signing key is in reach of a PR, so the .apk is debug-signed and --posture debug is the posture that requires the debug signer`,
  );
});

// ── T11 ──────────────────────────────────────────────────────────────────────
// assert-green-means-ran.mjs rule A2 holds ci-gate's needs complete for every job;
// this names the two jobs of this lane so a rename here is read here.
test('ci-gate needs both new jobs', () => {
  const needs = jobOf(ciWorkflow, PR_WORKFLOW, GATE_JOB).needs;
  const absent = [APPS_JOB, PR_JOB].filter((j) => !needs.includes(j));
  assert.deepEqual(absent, [], `${PR_WORKFLOW} "${GATE_JOB}" does not need ${absent.join(', ')}`);
});

// ── T12 ──────────────────────────────────────────────────────────────────────
// assert-green-means-ran.mjs rule A6 (no conditional constituents) forbids the
// same thing for every ci-gate constituent; named here for this lane's two jobs.
test('the PR lane carries no job-level if', () => {
  const conditional = [APPS_JOB, PR_JOB]
    .map((name) => ({ name, jobIf: jobOf(ciWorkflow, PR_WORKFLOW, name).jobIf }))
    .filter((j) => j.jobIf !== null)
    .map((j) => `${PR_WORKFLOW}:${j.jobIf.n} "${j.name}" if: ${j.jobIf.cond}`);
  assert.deepEqual(conditional, [], 'a job-level if: resolves to skipped whenever it is false, and a skipped lane proves nothing');
});

// ── T13 ──────────────────────────────────────────────────────────────────────
// A temp root built as artifact-shape.test.mjs's fixture() builds one: a COPY of
// the real register and an empty apps/<app>/. The app is the first the real
// emitter names and the lane key is the one ci.yml passes, so neither is a literal
// here. The guard must reach the files and find them missing (exit 1), never stop
// at "no output layout is declared" (exit 2).
test('the lane key exists in artifact-shape', () => {
  const emitted = spawnSync(process.execPath, [join(CI_DIR, 'assert-release-lane-generic.mjs'), '--emit-apps', REPO], { encoding: 'utf8' });
  assert.equal(emitted.status, 0, `--emit-apps exited ${emitted.status}: ${emitted.stdout}${emitted.stderr}`);
  const apps = JSON.parse(emitted.stdout.trim());
  assert.ok(Array.isArray(apps) && typeof apps[0] === 'string' && apps[0] !== '', `--emit-apps printed no app: ${emitted.stdout}`);

  const shape = guardInvocations(jobOf(ciWorkflow, PR_WORKFLOW, PR_JOB)).filter((g) => g.script === 'assert-artifact-shape.mjs');
  assert.equal(shape.length, 1, `${PR_WORKFLOW} "${PR_JOB}" must run assert-artifact-shape.mjs exactly once; found ${shape.length}`);
  const platform = shape[0].args.match(/--platform\s+(\S+)/)?.[1];
  assert.ok(platform, `${PR_WORKFLOW}:${shape[0].n} passes assert-artifact-shape.mjs no --platform`);

  const tmp = mkdtempSync(join(tmpdir(), 'nikatru-pr-lane-'));
  try {
    mkdirSync(join(tmp, 'tooling'), { recursive: true });
    copyFileSync(join(REPO, 'tooling', 'channel-register.json'), join(tmp, 'tooling', 'channel-register.json'));
    mkdirSync(join(tmp, 'apps', apps[0]), { recursive: true });
    const r = spawnSync(
      process.execPath,
      [join(CI_DIR, 'assert-artifact-shape.mjs'), '--repo-root', tmp, '--app', apps[0], '--platform', platform],
      { encoding: 'utf8' },
    );
    const out = `${r.stdout}${r.stderr}`;
    assert.doesNotMatch(out, /no output layout is declared/, `assert-artifact-shape.mjs has no LANE_OUTPUTS entry for "${platform}": ${out}`);
    assert.equal(r.status, 1, out);
    assert.match(out, /the directory does not exist/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
