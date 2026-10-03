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
//
// Each rule is read off the REAL workflow (the green control), then off a copy
// with that one rule broken, which must be named — so no assertion here is one
// that cannot fail.
//
// Run:  node --test tooling/ci/test/regen-gradle-verify-workflow.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dispatchInputs, parseWorkflow, workflowSteps } from '../workflow-scan.mjs';

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

/** Every rule this test holds the workflow to, as finding strings (empty = clean). */
function findings(root) {
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
