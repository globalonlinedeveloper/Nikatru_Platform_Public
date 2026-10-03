// ─────────────────────────────────────────────────────────────────────────────
// regen-gradle-verify-workflow.test.mjs — .github/workflows/regen-gradle-verify.yml
// never runs branch code in main's cache scope, and never uploads a file a strict
// build has not read.
//
// Ruling 7185eb on PR #1185 (review 60fb2f40, MAJOR 1): a workflow_dispatch run
// SAVES its caches under the ref it was dispatched ON, while this job checks out
// and builds a branch nobody has reviewed yet. Dispatched from main with a `ref`
// input, every cache it wrote landed in main's scope, which submit-play.yml and
// build-platforms.yml restore in the jobs that hold ANDROID_KEYSTORE_*. So the
// workflow must:
//   R1  take no `ref` dispatch input (it runs on the ref it is dispatched on);
//   R2  check out `github.ref`;
//   R3  write no cache: setup-flutter `cache: 'false'`, setup-java `cache` empty,
//       no actions/cache (or cache/save, cache/restore) step anywhere. ⏱ 2026-10-03
//       (nit 1 of review 289b2f60 on #1185): not only the two caching steps the
//       workflow has today — ANY cache step is refused: an action with a `cache`
//       path segment (any publisher's), any `with:` input naming a cache that is
//       not off, and any setup-* action that sets no cache input off (setup-gradle,
//       setup-go and setup-node v5 cache by default);
//   R4  refuse `refs/heads/main` in a step that exits 1, before the checkout, in a
//       job every other job `needs` (the gate).
// And (NIT 2): before upload-artifact, verification goes back to strict, Gradle
// re-runs bundleDebug, assembleDebug, bundleRelease and assembleRelease against
// the new file WITHOUT --write-verification-metadata, and
// tooling/ci/assert-signing-inputs-pinned.mjs runs:
//   R5  those steps precede the upload.
// ⏱ 2026-10-03 (lead, on #1185): main went red on a53ec299 (#1190) over an
// artefact a regeneration had not seen, so the regeneration must cover EVERY
// Android build lane CI runs, the pr lane and the release lane alike:
//   R6  the regenerate job's ANDROID_BUILD_LANES (<target>/<channel>/<lane>) EQUALS
//       the set of Android tooling/ci/flutter-release-build.mjs calls in every
//       other workflow of the tree; each target's Gradle task (apk ->
//       assembleRelease, appbundle -> bundleRelease) is run by both a
//       --write-verification-metadata step and the strict re-run; and a step reads
//       the list before the first generation, so the run itself maps every lane.
//
// Each rule is read off the REAL workflow (the green control), then off a copy
// with that one rule broken, which must be named — so no assertion here is one
// that cannot fail.
//
// Run:  node --test tooling/ci/test/regen-gradle-verify-workflow.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  BUILD_TARGET_PLATFORM,
  composerCallArgs,
  dispatchInputs,
  jobEnv,
  parseAllWorkflows,
  parseWorkflow,
  shellSegments,
  workflowSteps,
} from '../workflow-scan.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REL = '.github/workflows/regen-gradle-verify.yml';
const REAL = readFileSync(join(REPO, REL), 'utf8');

/** An action whose path has a `cache` segment: actions/cache and its save/restore,
 *  or any other publisher's cache action. */
const CACHE_ACTION = /(?:^|\/)cache(?:\/|@|$)/;

/** A setup-* action, published (`actions/setup-java@…`, `gradle/actions/setup-gradle@…`)
 *  or local (`./.github/actions/setup-flutter`). Several cache BY DEFAULT
 *  (setup-gradle, setup-go, setup-node from v5), so each must set one cache input off. */
const SETUP_ACTION = /(?:^|\/)setup-[^/@]*(?:@|$)/;

/** Whether one `with:` input whose name mentions a cache leaves it off: empty or
 *  `false`, or `true` for an inverted `*-disabled` input (setup-gradle's
 *  `cache-disabled`). An expression is not off: it may evaluate to on. */
function cacheOff(key, raw) {
  const v = String(raw ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase();
  return /-disabled$/i.test(key) ? v === 'true' : v === '' || v === 'false';
}

/** The one Gradle task `flutter build <target> --release` runs, per Android target. */
const GRADLE_TASK = new Map([
  ['apk', 'assembleRelease'],
  ['appbundle', 'bundleRelease'],
]);

/** Every Android build lane the workflows under `root` run, as `<target>/<channel>/<lane>`:
 *  each tooling/ci/flutter-release-build.mjs call whose target builds android, read
 *  through the census's own parse of a call (composerCallArgs), app ignored. */
function androidLanes(root) {
  const lanes = new Set();
  for (const wf of parseAllWorkflows(root)) {
    if (wf.rel === REL) continue;
    for (const job of wf.jobs.values()) {
      for (const l of job.logical) {
        for (const seg of shellSegments(l.text)) {
          const call = composerCallArgs(seg, `${wf.rel}:${l.n}`);
          if (call !== null && BUILD_TARGET_PLATFORM.get(call.target) === 'android') lanes.add(`${call.target}/${call.channel}/${call.lane}`);
        }
      }
    }
  }
  return lanes;
}

/** R6 over one job: its declared lanes against `lanes`, and each lane's task run. */
function laneFindings(job, steps, lanes) {
  const out = [];
  const declared = jobEnv(job).get('ANDROID_BUILD_LANES');
  if (declared === undefined) return [`R6 (${job.name}): uploads the file and declares no ANDROID_BUILD_LANES`];
  const list = new Set(String(declared.value).trim().split(/\s+/).filter((t) => t !== ''));
  if (lanes.size === 0) out.push('R6: no Android flutter-release-build.mjs call was read in .github/workflows, so the lane set was not compared');
  for (const l of lanes) if (!list.has(l)) out.push(`R6 (${job.name}): CI runs the Android lane ${l}, which ANDROID_BUILD_LANES does not list`);
  for (const l of list) if (!lanes.has(l)) out.push(`R6 (${job.name}): ANDROID_BUILD_LANES lists ${l}, which no workflow runs`);
  const runs = steps.map((s) => (s.run?.text ?? '').trim());
  const generating = runs.map((t, i) => [i, t]).filter(([, t]) => /--write-verification-metadata\b/.test(t));
  const strict = runs.filter((t) => /^\.\/gradlew --no-daemon (?!.*--write-verification-metadata)/.test(t));
  for (const l of list) {
    const target = l.split('/')[0];
    const task = GRADLE_TASK.get(target);
    if (task === undefined) {
      out.push(`R6 (${job.name}): lane ${l} builds ${target}, which has no Gradle task this test knows`);
      continue;
    }
    const has = (t) => new RegExp(`(?:^|\\s)${task}(?=\\s|$)`).test(t);
    if (!generating.some(([, t]) => has(t))) out.push(`R6 (${job.name}): no --write-verification-metadata step runs ${task} (lane ${l})`);
    if (!strict.some(has)) out.push(`R6 (${job.name}): the strict re-run does not run ${task} (lane ${l})`);
  }
  const mapper = runs.findIndex((t) => /\$\{?ANDROID_BUILD_LANES\b/.test(t));
  const firstGeneration = generating.length === 0 ? -1 : generating[0][0];
  if (mapper === -1 || (firstGeneration !== -1 && mapper > firstGeneration)) {
    out.push(`R6 (${job.name}): no step reads ANDROID_BUILD_LANES before the first generation`);
  }
  return out;
}

/** Every rule this test holds the workflow to, as finding strings (empty = clean).
 *  `lanesRoot` is the tree whose other workflows R6 reads the Android lanes from. */
function findings(root, lanesRoot = REPO) {
  const wf = parseWorkflow(root, REL);
  if (!wf) return [`${REL} is not on disk`];
  const out = [];
  const inputsAt = dispatchInputs(wf);
  const header = wf.lines.slice(0, wf.jobsAt ?? wf.lines.length);
  if (inputsAt !== null && header.some((l) => l.n > inputsAt && /^ {6}ref:\s*$/.test(l.text))) {
    out.push('R1: workflow_dispatch takes a `ref` input');
  }
  let uploads = 0;
  const jobs = [...wf.jobs.values()];
  if (jobs.length === 0) return [...out, 'no job was read'];
  const refuses = (s) =>
    s.env.get('REF')?.value?.trim() === '${{ github.ref }}' &&
    /\[ "\$REF" = refs\/heads\/main \]; then ; [^;]*; exit 1\b/.test(s.run?.text ?? '');
  const refusing = new Set();
  for (const job of jobs) {
    const steps = workflowSteps(job);
    const checkout = steps.findIndex((s) => /^actions\/checkout@/.test(s.uses ?? ''));
    const refusal = steps.findIndex(refuses);
    if (refusal !== -1 && (checkout === -1 || refusal < checkout)) refusing.add(job.name);
  }
  if (refusing.size === 0) out.push('R4: no job refuses refs/heads/main with exit 1 before its checkout');
  for (const job of jobs) {
    if (refusing.size > 0 && !refusing.has(job.name) && !job.needs.some((n) => refusing.has(n))) {
      out.push(`R4 (${job.name}): does not need the job that refuses main`);
    }
    const steps = workflowSteps(job);
    const idx = (pred) => steps.findIndex(pred);
    for (const s of steps) {
      const uses = s.uses ?? '';
      const cache = s.with.get('cache')?.value?.trim().replace(/^(['"])(.*)\1$/, '$2');
      if (/^actions\/checkout@/.test(uses) && s.with.get('ref')?.value?.trim() !== '${{ github.ref }}') {
        out.push(`R2 (${job.name}): checkout at line ${s.first} is not of \${{ github.ref }}`);
      }
      if (/^actions\/cache(?:\/(?:save|restore))?@/.test(uses)) out.push(`R3 (${job.name}): an actions/cache step at line ${s.first}`);
      else if (CACHE_ACTION.test(uses)) out.push(`R3 (${job.name}): a cache action (${uses}) at line ${s.first}`);
      if (uses === './.github/actions/setup-flutter' && cache !== 'false') out.push(`R3 (${job.name}): setup-flutter cache is not 'false'`);
      if (/^actions\/setup-java@/.test(uses) && cache !== '') out.push(`R3 (${job.name}): setup-java cache is not '' (it is ${JSON.stringify(cache ?? null)})`);
      const cacheInputs = [...s.with.entries()].filter(([k]) => /cache/i.test(k));
      for (const [k, v] of cacheInputs) {
        if (!cacheOff(k, v?.value)) out.push(`R3 (${job.name}): ${uses || 'a step'} at line ${s.first} turns a cache on (${k}: ${String(v?.value ?? '').trim()})`);
      }
      if (SETUP_ACTION.test(uses) && !cacheInputs.some(([k, v]) => cacheOff(k, v?.value))) {
        out.push(`R3 (${job.name}): ${uses} at line ${s.first} sets no cache input off, and a setup-* action may cache by default`);
      }
    }
    const upload = idx((s) => /^actions\/upload-artifact@/.test(s.uses ?? ''));
    if (upload === -1) continue;
    const strict = idx((s) => (s.run?.text ?? '').includes("sed -i '/^org\\.gradle\\.dependency\\.verification=/d'"));
    const builds = steps
      .map((s, i) => [i, (s.run?.text ?? '').trim()])
      .filter(([, t]) => /^\.\/gradlew --no-daemon bundleDebug assembleDebug bundleRelease assembleRelease$/.test(t))
      .map(([i]) => i);
    const pinned = idx((s) => /^node tooling\/ci\/assert-signing-inputs-pinned\.mjs$/.test((s.run?.text ?? '').trim()));
    if (strict === -1 || strict > upload) out.push(`R5 (${job.name}): verification is not put back to strict before the upload`);
    if (builds.length !== 1 || builds.some((i) => i < strict || i > upload)) out.push(`R5 (${job.name}): no strict re-run of bundleDebug assembleDebug bundleRelease assembleRelease sits between strict and the upload`);
    if (pinned === -1 || pinned > upload || pinned < strict) out.push(`R5 (${job.name}): assert-signing-inputs-pinned does not run before the upload`);
    out.push(...laneFindings(job, steps, androidLanes(lanesRoot)));
    uploads += 1;
  }
  if (uploads === 0) out.push('R5: no job uploads the file');
  return out;
}

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-regen-gradle-'));
});
after(() => rmSync(ROOT, { recursive: true, force: true }));

/** A tree holding the workflow with `edit` applied; `edit` must change it. */
function mutated(name, edit) {
  const body = edit(REAL);
  assert.notEqual(body, REAL, `the ${name} mutation no longer matches the workflow: rewrite it`);
  const dir = join(ROOT, name);
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(dir, REL), body);
  return dir;
}

const named = (list, rule) => assert.ok(list.some((f) => f.startsWith(rule)), `expected a ${rule} finding, got ${JSON.stringify(list)}`);

describe('regen-gradle-verify.yml — branch scope only, no cache, main refused, strict before upload', () => {
  test('green control: the real workflow breaks no rule', () => {
    assert.deepEqual(findings(REPO), []);
  });

  test('R1: a `ref` dispatch input is named', () => {
    const dir = mutated('ref-input', (s) =>
      s.replace('    inputs:\n', '    inputs:\n      ref:\n        description: x\n        required: true\n        type: string\n'),
    );
    named(findings(dir), 'R1');
  });

  test('R4: a job that does not need the refusing gate is named', () => {
    const dir = mutated('no-needs-gate', (s) => s.replace('    needs: gate\n', ''));
    named(findings(dir), 'R4');
  });

  test('R2: a checkout of inputs.ref is named', () => {
    const dir = mutated('checkout-input', (s) => s.replace('ref: ${{ github.ref }}\n          persist', 'ref: ${{ inputs.ref }}\n          persist'));
    named(findings(dir), 'R2');
  });

  test("R3: setup-flutter with its cache back on is named", () => {
    const dir = mutated('flutter-cache', (s) => s.replace("cache: 'false'", "cache: 'true'"));
    named(findings(dir), 'R3');
  });

  test('R3: setup-java caching gradle is named', () => {
    const dir = mutated('java-cache', (s) => s.replace("cache: ''", 'cache: gradle'));
    named(findings(dir), 'R3');
  });

  test('R3: an actions/cache step is named', () => {
    const dir = mutated('cache-step', (s) =>
      s.replace(
        '      - name: Resolve the workspace\n',
        '      - uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0\n        timeout-minutes: 5\n        with:\n          path: ~/.gradle/caches\n          key: x\n      - name: Resolve the workspace\n',
      ),
    );
    named(findings(dir), 'R3');
  });

  /** The workflow with `step` (YAML at step indent) inserted before the workspace resolve. */
  const withStep = (step) => (s) => s.replace('      - name: Resolve the workspace\n', `${step}      - name: Resolve the workspace\n`);

  test("R3: another publisher's cache action is named", () => {
    const dir = mutated('third-party-cache', withStep('      - uses: buildjet/cache@0000000000000000000000000000000000000001 # a fixture pin\n        timeout-minutes: 5\n        with:\n          path: ~/.gradle/caches\n          key: x\n'));
    named(findings(dir), 'R3');
  });

  test('R3: a setup-* action with a truthy cache input (setup-node, cache: npm) is named', () => {
    const dir = mutated('setup-node-cache', withStep("      - uses: actions/setup-node@0000000000000000000000000000000000000002 # a fixture pin\n        timeout-minutes: 5\n        with:\n          node-version: '24'\n          cache: npm\n"));
    named(findings(dir), 'R3');
  });

  test('R3: a setup-* action that caches by default and sets no cache input (setup-gradle) is named', () => {
    const dir = mutated('setup-gradle-default', withStep('      - uses: gradle/actions/setup-gradle@0000000000000000000000000000000000000003 # a fixture pin\n        timeout-minutes: 5\n'));
    named(findings(dir), 'R3');
  });

  test('R3: an inverted cache input left on (setup-gradle, cache-disabled: false) is named', () => {
    const dir = mutated('setup-gradle-enabled', withStep('      - uses: gradle/actions/setup-gradle@0000000000000000000000000000000000000003 # a fixture pin\n        timeout-minutes: 5\n        with:\n          cache-disabled: false\n'));
    named(findings(dir), 'R3');
  });

  test('R3 control: a setup-* action with its cache set off is NOT named', () => {
    const dir = mutated('setup-gradle-off', withStep('      - uses: gradle/actions/setup-gradle@0000000000000000000000000000000000000003 # a fixture pin\n        timeout-minutes: 5\n        with:\n          cache-disabled: true\n'));
    assert.deepEqual(findings(dir), []);
  });

  test('R6 control: the real tree runs Android lanes, and both the pr and the release lane are among them', () => {
    const lanes = androidLanes(REPO);
    assert.ok([...lanes].some((l) => l.endsWith('/pr')), `no pr lane read: ${JSON.stringify([...lanes])}`);
    assert.ok([...lanes].some((l) => l.endsWith('/release')), `no release lane read: ${JSON.stringify([...lanes])}`);
  });

  test('R6: a lane dropped from ANDROID_BUILD_LANES is named', () => {
    const dir = mutated('lane-dropped', (s) => s.replace(' appbundle/android-play/release ', ' '));
    named(findings(dir), 'R6');
  });

  test('R6: a lane ANDROID_BUILD_LANES lists that no workflow runs is named', () => {
    const dir = mutated('lane-extra', (s) => s.replace('ANDROID_BUILD_LANES: apk/', 'ANDROID_BUILD_LANES: appbundle/apps-gov-in/pr apk/'));
    named(findings(dir), 'R6');
  });

  test('R6: a new Android lane in ci.yml that the regeneration does not list is named', () => {
    const call = 'node tooling/ci/flutter-release-build.mjs ${{ matrix.app }} appbundle android-play --lane pr';
    /** Every workflow of the real tree copied under `name`, ci.yml through `edit`. */
    const copy = (name, edit) => {
      const lanesRoot = join(ROOT, name);
      mkdirSync(join(lanesRoot, '.github', 'workflows'), { recursive: true });
      const wfDir = join(REPO, '.github', 'workflows');
      for (const f of readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n))) {
        const body = readFileSync(join(wfDir, f), 'utf8');
        writeFileSync(join(lanesRoot, '.github', 'workflows', f), f === 'ci.yml' ? edit(body) : body);
      }
      return lanesRoot;
    };
    assert.deepEqual(findings(REPO, copy('ci-copy', (b) => b)), [], 'the unedited copy must be green, or the red below proves nothing');
    const edited = copy('ci-new-lane', (b) => {
      assert.ok(b.includes(call), 'the ci.yml mutation no longer matches: rewrite it');
      return b.replace(call, `${call} && node tooling/ci/flutter-release-build.mjs \${{ matrix.app }} appbundle apps-gov-in --lane pr`);
    });
    named(findings(REPO, edited), 'R6');
  });

  test('R6: the step that maps each lane to a Gradle task removed is named', () => {
    const dir = mutated('no-lane-mapper', (s) => s.replace('for lane in $ANDROID_BUILD_LANES; do', 'for lane in apk/android-play/pr; do'));
    named(findings(dir), 'R6');
  });

  test('R4: the main refusal removed is named', () => {
    const dir = mutated('no-main-refusal', (s) => s.replace('if [ "$REF" = refs/heads/main ]; then', 'if [ "$REF" = refs/heads/never ]; then'));
    named(findings(dir), 'R4');
  });

  test('R4: a main refusal that does not exit 1 is named', () => {
    const dir = mutated('main-refusal-no-exit', (s) => s.replace(/(never on main:[^\n]*\n\s*)exit 1/, '$1true'));
    named(findings(dir), 'R4');
  });

  test('R5: the signing-inputs guard moved after the upload is named', () => {
    const dir = mutated('pinned-after-upload', (s) =>
      s.replace('        run: node tooling/ci/assert-signing-inputs-pinned.mjs\n', '        run: echo skipped\n') +
      '      - name: late\n        timeout-minutes: 2\n        run: node tooling/ci/assert-signing-inputs-pinned.mjs\n',
    );
    named(findings(dir), 'R5');
  });

  test('R5: a strict re-run that writes the metadata instead of reading it is named', () => {
    const dir = mutated('strict-writes', (s) =>
      s.replace('run: ./gradlew --no-daemon bundleDebug assembleDebug bundleRelease assembleRelease', 'run: ./gradlew --no-daemon --write-verification-metadata sha256 bundleDebug assembleDebug bundleRelease assembleRelease'),
    );
    named(findings(dir), 'R5');
  });
});
