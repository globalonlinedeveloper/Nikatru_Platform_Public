// ─────────────────────────────────────────────────────────────────────────────
// spawn-ceiling-cwd.test.mjs — the spawn-ceiling preload a workflow passes to
// `node --import` must load from ANY working directory.
//
// ⏱ 2026-10-02 · PR #1160 (run 37006580364, ops tooling tests · windows-2022): the
// step ran `node --import ../tooling/scripts/spawn-ceiling.mjs` from the repository
// ROOT, so `../` left the checkout and node refused before the first test ran
// (ERR_MODULE_NOT_FOUND, "imported from" the root). An `--import` is resolved
// against the cwd of the process that reads it — the step's, and the cwd of every
// child that inherits it through NODE_OPTIONS or fork()'s execArgv. So the preload
// is now ONE absolute file URL, $SPAWN_CEILING, which .github/actions/setup-node
// exports for every later step. These cases hold that:
//   (a) the setup-node expression, run from a temp dir with GITHUB_WORKSPACE = this checkout,
//       gives a file URL that loads the preload from the repository root, from
//       extensions/ and from a temp dir — as an `--import` argument and as
//       NODE_OPTIONS. The relative forms the workflows used are the RED CONTROL:
//       `../` fails from the root and `./` fails from a temp dir, both ways.
//   (b) no workflow or composite action passes `--import` (or NODE_OPTIONS) a
//       relative path, and every job that names $SPAWN_CEILING exports it first —
//       with fixture lines as the red control, and a floor so the scan is not vacuous.
//
// Mutations run against the real tree (2026-10-02, green control exit 0 first):
//   · the setup-node expression drops GITHUB_WORKSPACE (resolves the cwd)   → (a) RED
//   · one extensions-ci.yml line back to `--import ../tooling/scripts/…`       → (b) RED
//   · the GITHUB_ENV write removed from setup-node                             → (b) RED
//
// Runs on ubuntu AND windows-2022 (extensions-ci.yml's ops-tooling job).
// Run:  node --test tooling/ci/test/spawn-ceiling-cwd.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResolvedWorkflows, workflowSteps, githubEnvWrites, ACTION_DIR } from '../workflow-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ACTION = join(ROOT, ACTION_DIR, 'setup-node', 'action.yml');

// The child proves the preload LOADED, not merely that node started: the
// preload renames spawnSync to withSpawnCeiling…, so exit 0 means it ran.
const PROBE = "process.exit(require('node:child_process').spawnSync.name.startsWith('withSpawnCeiling') ? 0 : 3)";

/** The one `node -p` expression setup-node writes SPAWN_CEILING from. */
function actionExpression() {
  const m = readFileSync(ACTION, 'utf8').match(/^\s*ceiling="\$\(node -p "([^"]+)"\)"\s*$/m);
  assert.ok(m, `${ACTION_DIR}/setup-node/action.yml no longer computes SPAWN_CEILING as ceiling="$(node -p "…")"`);
  return m[1];
}

/** A child node with the preload given as `--import <spec>` (or NODE_OPTIONS), from `cwd`. */
function start(spec, cwd, { viaOptions = false } = {}) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (viaOptions) env.NODE_OPTIONS = `--import=${spec}`;
  const args = viaOptions ? ['-e', PROBE] : ['--import', spec, '-e', PROBE];
  return spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
}

describe('spawn-ceiling: the workflow preload loads from any cwd', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'spawn-ceiling-cwd-'));
  const cwds = { root: ROOT, extensions: join(ROOT, 'extensions'), temp: tmp };

  test('(a) setup-node\'s SPAWN_CEILING is a file URL that loads from the root, extensions/ and a temp dir', () => {
    try {
      // From a temp dir: the step that runs it may stand anywhere, so the URL must come
      // from GITHUB_WORKSPACE alone, never from the cwd.
      const r = spawnSync(process.execPath, ['-p', actionExpression()], { cwd: tmp, env: { ...process.env, GITHUB_WORKSPACE: ROOT }, encoding: 'utf8', timeout: 60_000 });
      assert.equal(r.status, 0, `the setup-node expression failed: ${r.stderr}`);
      const url = r.stdout.trim();
      assert.match(url, /^file:\/\/\/.*\/tooling\/scripts\/spawn-ceiling\.mjs$/, `not an absolute file URL: ${url}`);
      for (const [name, cwd] of Object.entries(cwds)) {
        for (const viaOptions of [false, true]) {
          const c = start(url, cwd, { viaOptions });
          assert.equal(c.status, 0, `${viaOptions ? 'NODE_OPTIONS' : '--import'} from ${name} (${cwd}): exit ${c.status}\n${c.stderr}`);
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('(a) the red control: the relative forms the workflows used fail outside their one cwd', () => {
    const t = mkdtempSync(join(tmpdir(), 'spawn-ceiling-cwd-red-'));
    try {
      const cases = [['../tooling/scripts/spawn-ceiling.mjs', ROOT, 'root'], ['./tooling/scripts/spawn-ceiling.mjs', t, 'temp dir']];
      for (const [spec, cwd, name] of cases) {
        for (const viaOptions of [false, true]) {
          const c = start(spec, cwd, { viaOptions });
          assert.notEqual(c.status, 0, `${spec} from the ${name} STARTED — the red control no longer reds`);
          assert.match(c.stderr, /ERR_MODULE_NOT_FOUND/, `${spec} from the ${name} failed for another reason:\n${c.stderr}`);
        }
      }
      // ...and each relative form does load from the one cwd it was written for,
      // so the reds above are about the cwd, not a broken probe.
      assert.equal(start('../tooling/scripts/spawn-ceiling.mjs', join(ROOT, 'extensions')).status, 0, '../ from extensions/');
      assert.equal(start('./tooling/scripts/spawn-ceiling.mjs', ROOT).status, 0, './ from the root');
    } finally {
      rmSync(t, { recursive: true, force: true });
    }
  });
});

/** The non-comment lines of `text` that pass `--import` a relative path. */
function relativeImports(text) {
  const bad = [];
  text.split('\n').forEach((line, i) => {
    const code = line.replace(/^\s*#.*$/, '');
    for (const m of code.matchAll(/--import(?:=|\s+)(['"]?)([^\s'"]+)\1/g)) {
      if (!/^(?:file:|data:|node:|\$\{?[A-Z_][A-Z0-9_]*\}?$)/.test(m[2])) bad.push(`:${i + 1} ${line.trim()}`);
    }
  });
  return bad;
}

describe('spawn-ceiling: no workflow names a preload relatively', () => {
  test('(b) the red control: a relative --import is caught, the URL variable is not', () => {
    assert.equal(relativeImports('        run: node --import ../tooling/scripts/spawn-ceiling.mjs "$f"').length, 1);
    assert.equal(relativeImports('        run: node --import ./tooling/scripts/spawn-ceiling.mjs --test x').length, 1);
    assert.equal(relativeImports('          NODE_OPTIONS: --import=tooling/scripts/spawn-ceiling.mjs').length, 1);
    assert.equal(relativeImports('          NODE_OPTIONS: "--import=./x.mjs"').length, 1);
    assert.deepEqual(relativeImports('        run: node --import "$SPAWN_CEILING" --test x'), []);
    assert.deepEqual(relativeImports('        run: node --import=file:///D:/a/x.mjs y.mjs'), []);
    assert.deepEqual(relativeImports('      # node --import ../x.mjs'), [], 'a comment is not a run');
  });

  test('(b) every workflow and composite: no relative --import; $SPAWN_CEILING is exported before it is read', () => {
    const { workflows, filesRead, refusal } = parseResolvedWorkflows(ROOT);
    assert.equal(refusal, null, `the workflows could not be resolved: ${JSON.stringify(refusal)}`);
    assert.ok(filesRead.includes(`${ACTION_DIR}/setup-node/action.yml`), 'setup-node was not read: the scan no longer sees composites');
    const bad = [];
    for (const rel of filesRead) for (const b of relativeImports(readFileSync(join(ROOT, rel), 'utf8'))) bad.push(`${rel}${b}`);
    let uses = 0;
    for (const wf of workflows) {
      for (const job of wf.jobs.values()) {
        const steps = workflowSteps(job);
        const exported = githubEnvWrites(job).filter((w) => w.name === 'SPAWN_CEILING').map((w) => w.stepIndex);
        for (const step of steps) {
          if (!/\$\{?SPAWN_CEILING\b/.test(step.run?.text ?? '')) continue;
          uses++;
          if (!exported.some((i) => i < step.index)) bad.push(`${wf.rel} job ${job.name}: step ${step.name ?? step.index} reads $SPAWN_CEILING, but no earlier step exports it (uses: ./.github/actions/setup-node)`);
        }
      }
    }
    // Anti-vacuity: eight steps on 2026-10-02 (ci.yml ×3, extensions-ci.yml ×5).
    assert.ok(uses >= 8, `only ${uses} step(s) read $SPAWN_CEILING: the scan stopped seeing them`);
    assert.deepEqual(bad, [], bad.join('\n'));
  });
});
