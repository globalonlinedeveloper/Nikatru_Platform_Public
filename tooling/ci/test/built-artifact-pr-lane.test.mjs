// ─────────────────────────────────────────────────────────────────────────────
// built-artifact-pr-lane.test.mjs — the PR lane's artifact jobs in ci.yml against
// the main jobs that build the same artifacts to ship them.
//
// ⏱ ADDED 2026-09-23 (O-BUILT-ARTIFACT-GUARDS-RUN-ONLY-AFTER-MERGE). The guards
// that read a BUILT Android artifact (the VAPT manifest items, the apps.gov.in
// signer and minSdk, the 16 KB page alignment, the artifact shape) ran only in
// build-platforms.yml, on a tag, a schedule or a dispatch, so a PR could break
// the merged manifest and nothing said so until after the merge. ci.yml now
// builds the same three Android artifacts on every PR, inspects them with the
// same guards and discards them.
//
// ⏱ WIDENED 2026-09-25 (O-PR-LANE-BUILDS-ONLY-ANDROID-ARTIFACTS). The same held
// for the web bundle and the Linux bundle: the only build of either ran on main
// (deploy-web.yml's `deploy-web`, build-platforms.yml's `linux_web_android`), so
// a PR that broke the web build, its fonts or its first launch, or the Linux
// bundle's snapcraft input, was green until the merge. ci.yml's `web-artifacts`
// and `linux-artifacts` now build both on every PR, run the guards main runs
// over them and discard them. TWINS below pairs each PR job with its main job;
// every case that compares builds or guards is written out once per twin.
//
// That is two copies of each build command, and a copy is only worth having
// while it is the same build. This file is what holds each PR copy to its main
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

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');

const PR_WORKFLOW = '.github/workflows/ci.yml';
const MAIN_WORKFLOW = '.github/workflows/build-platforms.yml';
const WEB_MAIN_WORKFLOW = '.github/workflows/deploy-web.yml';
const PR_JOB = 'android-artifacts';
const WEB_PR_JOB = 'web-artifacts';
const LINUX_PR_JOB = 'linux-artifacts';
const APPS_JOB = 'android-apps';
const MAIN_JOB = 'linux_web_android';
const WEB_MAIN_JOB = 'deploy-web';
const GATE_JOB = 'ci-gate';

/**
 * Each PR artifact job and the main job it twins. `platform` picks the main
 * job's builds (linux_web_android builds three platforms); `artifact` is what
 * marks a main guard invocation as one over a BUILT artifact of that platform —
 * a guard that reads the source tree is not this lane's business.
 */
const TWINS = {
  android: {
    prJob: PR_JOB,
    mainWorkflow: MAIN_WORKFLOW,
    mainJob: MAIN_JOB,
    platform: 'android',
    artifact: /\.apk\b|\.aab\b|agi_apk|--platform\b/,
  },
  web: {
    prJob: WEB_PR_JOB,
    mainWorkflow: WEB_MAIN_WORKFLOW,
    mainJob: WEB_MAIN_JOB,
    platform: 'web',
    artifact: /build\/web|--platform\b/,
  },
  linux: {
    prJob: LINUX_PR_JOB,
    mainWorkflow: MAIN_WORKFLOW,
    mainJob: MAIN_JOB,
    platform: 'linux',
    artifact: /build\/linux|--emitted|--bundle|--platform\b/,
  },
};

/** The built-artifact guards a main job runs that its PR twin does not, per
 *  twin, each with the reason a PR run could give it no meaningful subject. T8
 *  reads this; T9 holds every entry to a guard its main job still runs. */
const MAIN_ONLY = {
  android: {
    'assert-artifact-signed.mjs':
      'its question is "is this the UPLOAD key and not the debug key". A PR holds no key by design, so its only possible PR answer is "debug", which says nothing. Its PR-time analogue is android-signing.test.mjs, plus android-signing.mjs refusing a partial secret set',
    'stamp-channel.mjs':
      'it writes the release.json channel stamp (<file>.channel.json, carrying the run id) that only the upload of a shipped file carries, and the PR lane uploads nothing (T6). The pairing of --channel with its build step\'s RELEASE_CHANNEL is graded without a build by assert-release-json.mjs --static',
  },
};

const ciWorkflow = parseWorkflow(REPO, PR_WORKFLOW);
const mainWorkflow = parseWorkflow(REPO, MAIN_WORKFLOW);
const webWorkflow = parseWorkflow(REPO, WEB_MAIN_WORKFLOW);
const PARSED = new Map([
  [PR_WORKFLOW, ciWorkflow],
  [MAIN_WORKFLOW, mainWorkflow],
  [WEB_MAIN_WORKFLOW, webWorkflow],
]);

/** A job by name, or a failure that names what is missing — never an empty job
 *  that every assertion below would pass over. */
function jobOf(wf, rel, name) {
  assert.ok(wf, `${rel} did not parse, so there is nothing to compare`);
  const job = wf.jobs.get(name);
  assert.ok(job, `${rel} has no job "${name}" — renamed or removed, and this test would otherwise pass over nothing`);
  return job;
}

const ALL_BUILDS = flutterReleaseBuilds(REPO, [...PARSED.values()].filter(Boolean));

/** The release builds one job runs, of one platform (null: every platform), or a
 *  failure when there are none. */
function buildsOf(rel, job, platform) {
  jobOf(PARSED.get(rel), rel, job);
  const out = ALL_BUILDS.filter((b) => b.workflow === rel && b.job === job && (platform === null || b.platform === platform));
  assert.ok(out.length > 0, `${rel} job "${job}" runs no ${platform === null ? '' : `${platform} `}release \`flutter build\``);
  return out;
}
/** Every build the PR job runs, whatever its platform: a stray one is a finding. */
const prBuilds = (twin) => buildsOf(PR_WORKFLOW, twin.prJob, null);
const mainBuilds = (twin) => buildsOf(twin.mainWorkflow, twin.mainJob, twin.platform);

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
    else if (value === '' || SECRET_ONLY.test(value)) out.push(`--dart-define=${name}=`);
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

/** T1: the (target/stamp) sets of the two jobs are equal. */
function assertSameTargets(twin) {
  assert.deepEqual(
    prBuilds(twin).map(twinKey).sort(),
    mainBuilds(twin).map(twinKey).sort(),
    `the (target/stamp) set of ${PR_WORKFLOW} "${twin.prJob}" must equal the ${twin.platform} builds of ${twin.mainWorkflow} "${twin.mainJob}"`,
  );
}

/** T3: every define NAME a main build passes, its PR twin passes, and no other. */
function defineNameFindings(twin) {
  const main = mainBuilds(twin);
  const findings = [];
  for (const b of prBuilds(twin)) {
    const t = main.find((m) => twinKey(m) === twinKey(b));
    if (t === undefined) {
      findings.push(`${PR_WORKFLOW}:${b.runLine} (${twinKey(b)}) has no twin in ${twin.mainWorkflow}`);
      continue;
    }
    const pr = [...definesIn(b.segment)].sort();
    const mn = [...definesIn(t.segment)].sort();
    const missing = mn.filter((d) => !pr.includes(d));
    const extra = pr.filter((d) => !mn.includes(d));
    if (missing.length || extra.length) {
      findings.push(`${PR_WORKFLOW}:${b.runLine} (${twinKey(b)}): missing [${missing.join(', ')}], extra [${extra.join(', ')}] against ${twin.mainWorkflow}:${t.runLine}`);
    }
  }
  return findings;
}

/** Every `node … tooling/<dir>/<script>.mjs` a job runs: the script and its
 *  arguments. The directories are the ones a built-artifact check lives in:
 *  ci (the assert-* guards), web (the fonts), smoke (the first launch), ops (the
 *  GlitchTip release and the symbol uploads) and release (generate-snapcraft). */
function guardInvocations(job) {
  const out = [];
  for (const l of job.logical) {
    for (const seg of shellSegments(l.text)) {
      const m = seg.match(/\bnode\b.*?tooling\/(?:ci|web|smoke|ops|release)\/([A-Za-z0-9-]+\.mjs)(.*)$/);
      if (m) out.push({ n: l.n, script: m[1], args: m[2] });
    }
  }
  return out;
}

const mainArtifactGuards = (twin) =>
  new Set(guardInvocations(jobOf(PARSED.get(twin.mainWorkflow), twin.mainWorkflow, twin.mainJob)).filter((g) => twin.artifact.test(g.args)).map((g) => g.script));

/** T8: the main job's built-artifact guards the PR twin runs in neither the lane
 *  nor MAIN_ONLY. Compared by SCRIPT NAME: the arguments differ on purpose
 *  (--posture debug here, the minted posture on main; each lane's artifact-shape
 *  key; the smoke's --connect origins, which only a deployed build is served under). */
function assertEveryMainGuardRuns(twin, key) {
  const pr = new Set(guardInvocations(jobOf(ciWorkflow, PR_WORKFLOW, twin.prJob)).map((g) => g.script));
  const excused = MAIN_ONLY[key] ?? {};
  const missing = [...mainArtifactGuards(twin)].filter((s) => !pr.has(s) && !Object.hasOwn(excused, s)).sort();
  assert.deepEqual(
    missing,
    [],
    `${twin.mainWorkflow} "${twin.mainJob}" runs these over a built ${twin.platform} artifact and ${PR_WORKFLOW} "${twin.prJob}" does not — run it there, or add it to MAIN_ONLY.${key} with the reason`,
  );
}

/** T13: a temp root built as artifact-shape.test.mjs's fixture() builds one: a
 *  COPY of the real register and an empty apps/<app>/. The app is the first the
 *  real emitter names and the lane key is the one the job passes, so neither is
 *  a literal here. The guard must reach the files and find them missing (exit
 *  1), never stop at "no output layout is declared" (exit 2). */
function assertLaneKeyExists(prJob) {
  const emitted = spawnSync(process.execPath, [join(CI_DIR, 'assert-release-lane-generic.mjs'), '--emit-apps', REPO], { encoding: 'utf8' });
  assert.equal(emitted.status, 0, `--emit-apps exited ${emitted.status}: ${emitted.stdout}${emitted.stderr}`);
  const apps = JSON.parse(emitted.stdout.trim());
  assert.ok(Array.isArray(apps) && typeof apps[0] === 'string' && apps[0] !== '', `--emit-apps printed no app: ${emitted.stdout}`);

  const shape = guardInvocations(jobOf(ciWorkflow, PR_WORKFLOW, prJob)).filter((g) => g.script === 'assert-artifact-shape.mjs');
  assert.equal(shape.length, 1, `${PR_WORKFLOW} "${prJob}" must run assert-artifact-shape.mjs exactly once; found ${shape.length}`);
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
}

const PR_LANE_JOBS = [PR_JOB, WEB_PR_JOB, LINUX_PR_JOB];

// ── T1 ───────────────────────────────────────────────────────────────────────
test('the PR lane builds the same three Android targets as linux_web_android', () => {
  assertSameTargets(TWINS.android);
});

test('T1w: web-artifacts builds the same web target as deploy-web', () => {
  assertSameTargets(TWINS.web);
});

test('T1l: linux-artifacts builds the same Linux target as linux_web_android', () => {
  assertSameTargets(TWINS.linux);
});

// ── T2 ───────────────────────────────────────────────────────────────────────
test('each PR build carries the same flags as its main twin', () => {
  assert.deepEqual(driftFindings(prBuilds(TWINS.android), PR_WORKFLOW, mainBuilds(TWINS.android), MAIN_WORKFLOW), []);
});

test('T2w: the web-artifacts build carries the same flags as deploy-web\'s', () => {
  assert.deepEqual(driftFindings(prBuilds(TWINS.web), PR_WORKFLOW, mainBuilds(TWINS.web), WEB_MAIN_WORKFLOW), []);
});

test('T2l: the linux-artifacts build carries the same flags as linux_web_android\'s', () => {
  assert.deepEqual(driftFindings(prBuilds(TWINS.linux), PR_WORKFLOW, mainBuilds(TWINS.linux), MAIN_WORKFLOW), []);
});

// ── T3 ───────────────────────────────────────────────────────────────────────
test('each PR build carries every define NAME its main twin carries', () => {
  assert.deepEqual(defineNameFindings(TWINS.android), []);
});

test('T3w: the web-artifacts build carries every define NAME deploy-web\'s carries', () => {
  assert.deepEqual(defineNameFindings(TWINS.web), []);
});

test('T3l: the linux-artifacts build carries every define NAME linux_web_android\'s carries', () => {
  assert.deepEqual(defineNameFindings(TWINS.linux), []);
});

// ── T4 ───────────────────────────────────────────────────────────────────────
// T2 walks the PR builds; this walks main's. A stamp changed on main alone leaves
// a main build with no PR twin, and that is red here whatever the PR side says.
test('a channel changed on main alone turns the PR lane red', () => {
  assert.deepEqual(driftFindings(mainBuilds(TWINS.android), MAIN_WORKFLOW, prBuilds(TWINS.android), PR_WORKFLOW), []);
});

test('T4w: a web build changed in deploy-web alone turns the PR lane red', () => {
  assert.deepEqual(driftFindings(mainBuilds(TWINS.web), WEB_MAIN_WORKFLOW, prBuilds(TWINS.web), PR_WORKFLOW), []);
});

test('T4l: a Linux build changed in linux_web_android alone turns the PR lane red', () => {
  assert.deepEqual(driftFindings(mainBuilds(TWINS.linux), MAIN_WORKFLOW, prBuilds(TWINS.linux), PR_WORKFLOW), []);
});

// ── T5 (R-KEY A) ─────────────────────────────────────────────────────────────
// The allowed set is DERIVED from the register: a build whose stamp's channel
// sells through a rail in purchaseRails.storeKeyDefine.secretByRail may pass that
// rail's secret, and only as the storeKeyDefine define, on that build's own line.
// Any other secret on any line of any PR-lane job is a finding. The web and Linux
// channels sell through no store rail, so their jobs may reference no secret.
test('the PR lane references only the secret the register maps for its store-rail stamps', () => {
  const register = JSON.parse(readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8'));
  const storeKey = register?.purchaseRails?.storeKeyDefine;
  assert.ok(
    typeof storeKey?.define === 'string' && storeKey?.secretByRail && typeof storeKey.secretByRail === 'object',
    'tooling/channel-register.json purchaseRails.storeKeyDefine has no `define` and `secretByRail` to derive the allowed secret from',
  );
  const channels = Array.isArray(register.channels) ? register.channels : [];
  const railOf = (stamp) => channels.find((c) => c?.id === stamp)?.purchaseRail?.rail ?? null;

  const findings = [];
  for (const name of PR_LANE_JOBS) {
    const job = jobOf(ciWorkflow, PR_WORKFLOW, name);
    const steps = workflowSteps(job);
    const allowed = new Map();
    for (const b of buildsOf(PR_WORKFLOW, name, null)) {
      const secret = storeKey.secretByRail[railOf(b.stamp)];
      if (typeof secret !== 'string') continue;
      const step = steps.find((s) => s.run?.n === b.runLine);
      assert.ok(step, `${PR_WORKFLOW}:${b.runLine} — no step holds this build's run line`);
      const token = `--dart-define=${storeKey.define}=\${{ secrets.${secret} }}`;
      for (const l of job.lines) {
        if (l.n >= step.first && l.n <= step.last && l.text.trim() === token) allowed.set(l.n, token);
      }
    }
    for (const l of job.lines) {
      if (!/\$\{\{\s*secrets\./.test(l.text)) continue;
      if (allowed.get(l.n) === l.text.trim()) continue;
      findings.push(`${PR_WORKFLOW}:${l.n} (${name}) ${l.text.trim()}`);
    }
  }
  assert.deepEqual(findings, [], 'a secret the register does not map to this build\'s store-rail stamp');
});

// ── T6 ───────────────────────────────────────────────────────────────────────
test('the PR lane uploads nothing', () => {
  const UPLOADS = [
    [/\buses:\s*actions\/upload-artifact@/, 'actions/upload-artifact'],
    [/upload-native-symbols/, 'upload-native-symbols'],
    [/glitchtip-cli|create-glitchtip-release/, 'glitchtip'],
    [/sourcemap/i, 'sourcemap upload'],
    [/record-deployment/, 'record-deployment'],
    [/\bgh\s+release\b/, 'gh release'],
  ];
  const findings = [];
  for (const name of PR_LANE_JOBS) {
    for (const l of jobOf(ciWorkflow, PR_WORKFLOW, name).lines) {
      for (const [re, what] of UPLOADS) if (re.test(l.text)) findings.push(`${PR_WORKFLOW}:${l.n} (${name}) ${what}: ${l.text.trim()}`);
    }
  }
  assert.deepEqual(findings, []);
});

// ── T7 ───────────────────────────────────────────────────────────────────────
test('the PR lane never runs a signing script', () => {
  const findings = [];
  for (const name of PR_LANE_JOBS) {
    for (const l of jobOf(ciWorkflow, PR_WORKFLOW, name).logical) {
      for (const seg of shellSegments(l.text)) {
        if (/tooling\/ci\/(?:android|appimage)-signing\.mjs/.test(seg)) findings.push(`${PR_WORKFLOW}:${l.n} (${name}) ${seg.trim()}`);
      }
    }
  }
  assert.deepEqual(findings, []);
});

// ── T8 ── the class guard ────────────────────────────────────────────────────
test('every built-artifact guard on main is in the PR lane or declared main-only', () => {
  assertEveryMainGuardRuns(TWINS.android, 'android');
});

test('T8w: every guard deploy-web runs over build/web is in web-artifacts or declared main-only', () => {
  assertEveryMainGuardRuns(TWINS.web, 'web');
});

test('T8l: every guard linux_web_android runs over the Linux bundle is in linux-artifacts or declared main-only', () => {
  assertEveryMainGuardRuns(TWINS.linux, 'linux');
});

// ── T9 ───────────────────────────────────────────────────────────────────────
test('a MAIN_ONLY entry that main no longer runs is stale', () => {
  const stale = [];
  for (const [key, entries] of Object.entries(MAIN_ONLY)) {
    const twin = TWINS[key];
    assert.ok(twin, `MAIN_ONLY.${key} names no twin in TWINS`);
    const main = mainArtifactGuards(twin);
    for (const s of Object.keys(entries)) if (!main.has(s)) stale.push(`${key}: ${s}`);
  }
  assert.deepEqual(stale.sort(), [], 'MAIN_ONLY names a guard its main job no longer runs over an artifact — delete the entry');
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
// this names the jobs of this lane so a rename here is read here.
test('ci-gate needs every PR-lane job', () => {
  const needs = jobOf(ciWorkflow, PR_WORKFLOW, GATE_JOB).needs;
  const absent = [APPS_JOB, ...PR_LANE_JOBS].filter((j) => !needs.includes(j));
  assert.deepEqual(absent, [], `${PR_WORKFLOW} "${GATE_JOB}" does not need ${absent.join(', ')}`);
});

// ── T12 ──────────────────────────────────────────────────────────────────────
// assert-green-means-ran.mjs rule A6 (no conditional constituents) forbids the
// same thing for every ci-gate constituent; named here for this lane's jobs.
test('the PR lane carries no job-level if', () => {
  const conditional = [APPS_JOB, ...PR_LANE_JOBS]
    .map((name) => ({ name, jobIf: jobOf(ciWorkflow, PR_WORKFLOW, name).jobIf }))
    .filter((j) => j.jobIf !== null)
    .map((j) => `${PR_WORKFLOW}:${j.jobIf.n} "${j.name}" if: ${j.jobIf.cond}`);
  assert.deepEqual(conditional, [], 'a job-level if: resolves to skipped whenever it is false, and a skipped lane proves nothing');
});

// ── T13 ──────────────────────────────────────────────────────────────────────
test('the lane key exists in artifact-shape', () => {
  assertLaneKeyExists(PR_JOB);
});

test('T13w: the web-artifacts lane key exists in artifact-shape', () => {
  assertLaneKeyExists(WEB_PR_JOB);
});

test('T13l: the linux-artifacts lane key exists in artifact-shape', () => {
  assertLaneKeyExists(LINUX_PR_JOB);
});
