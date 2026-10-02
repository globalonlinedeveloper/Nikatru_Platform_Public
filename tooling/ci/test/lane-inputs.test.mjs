// ─────────────────────────────────────────────────────────────────────────────
// lane-inputs.test.mjs — assert-lane-inputs.mjs must go red when a derived lane's
// globs miss what its jobs read, and refuse when it cannot derive. [ADR 095]
//
// Each case builds a REAL git repository in a temp directory (the derivation reads
// `git ls-files`), with a lane callee, a script it runs, a pub workspace and a map,
// writes the map with --write, and then breaks one thing: a path dependency added
// without its glob, a data file a script starts reading, a glob nobody derives, a
// callee or a workspace that is gone. The last case runs against the real tree,
// which is the subject guard-meta grades.
//
// Run:  node --test tooling/ci/test/lane-inputs.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { asMapPattern, stampedPath, stampedReads, pathDependencies, judgeLane } from '../assert-lane-inputs.mjs';
import { treeOf } from '../../scripts/affected-guards.mjs';
import { globToRegExp } from '../lane-detect.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(CI_DIR, 'assert-lane-inputs.mjs');
const MAP_REL = 'tooling/ci/lane-map.json';

const CALLEE = [
  'name: Lane — apps',
  'on:',
  '  workflow_call:',
  'jobs:',
  '  detect:',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: node tooling/ci/check.mjs --lane apps',
  '  build:',
  '    needs: detect',
  '    runs-on: ubuntu-24.04',
  '    steps:',
  '      - run: flutter build web',
  '        working-directory: apps/x',
  '',
].join('\n');

const BASE_FILES = {
  '.github/workflows/lane-apps.yml': CALLEE,
  'tooling/ci/check.mjs': "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nreadFileSync(join(process.cwd(), 'tooling', 'data.json'), 'utf8');\n",
  'tooling/data.json': '{}\n',
  'tooling/other.json': '{}\n',
  'pubspec.yaml': 'name: ws\nworkspace:\n  - packages/a\n  - apps/x\n',
  'pubspec.lock': '# lock\n',
  'apps/x/pubspec.yaml': 'name: x\ndependencies:\n  a:\n    path: ../../packages/a\n',
  'apps/x/lib/main.dart': 'void main() {}\n',
  'packages/a/pubspec.yaml': 'name: a\n',
  'packages/b/pubspec.yaml': 'name: b\n',
  'mason.yaml': 'bricks: {}\n',
  'README.md': '# r\n',
};

const MAP = {
  _readme: ['fixture'],
  lanes: {
    apps: { callee: '.github/workflows/lane-apps.yml', globs: ['apps/**'] },
    guards: { globs: ['tooling/**', '.github/**'] },
  },
  unclaimed: ['*.md'],
};

let TMP;
let n = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-lane-inputs-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

const git = (root, ...args) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) {
      rmSync(join(root, rel), { force: true });
      continue;
    }
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** A fixture repository with every file tracked, and its map written by --write. */
function fixture(extra = {}, map = MAP) {
  const root = join(TMP, `r${n++}`);
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  write(root, { ...BASE_FILES, ...extra, [MAP_REL]: `${JSON.stringify(map, null, 2)}\n` });
  git(root, 'add', '-A');
  return root;
}

const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, '--root', root, '--lane', 'apps', ...args], { encoding: 'utf8' });
const out = (r) => `${r.stdout}${r.stderr}`;
const globsOf = (root) => JSON.parse(readFileSync(join(root, MAP_REL), 'utf8')).lanes.apps.globs;

/** Change files and track them, as the pull request would. */
function change(root, files) {
  write(root, files);
  git(root, 'add', '-A');
}

describe('assert-lane-inputs — the derivation', () => {
  test('--write derives the callee, its scripts, what they read, the pub graph and the tool manifests; the check is then green', () => {
    const root = fixture();
    const w = run(root, '--write');
    assert.equal(w.status, 0, out(w));
    const globs = globsOf(root);
    for (const g of [
      '.github/workflows/lane-apps.yml',
      'tooling/ci/check.mjs',
      'tooling/data.json',
      'apps/x/**',
      'packages/a/**',
      'pubspec.yaml',
      'pubspec.lock',
    ]) {
      assert.ok(globs.includes(g), `${g} is not derived: ${JSON.stringify(globs)}`);
    }
    assert.ok(!globs.includes('packages/b/**'), 'packages/b is no member and no dependency, and was derived anyway');
    assert.ok(!globs.includes('tooling/other.json'), 'tooling/other.json is read by nothing, and was derived anyway');
    const c = run(root);
    assert.equal(c.status, 0, out(c));
    assert.match(c.stdout, /ok {2}lane inputs — apps: \d+ derived input globs/);
  });

  test('RED: a path dependency added without its glob is a missed input, named with what reads it', () => {
    const root = fixture();
    assert.equal(run(root, '--write').status, 0);
    change(root, { 'apps/x/pubspec.yaml': 'name: x\ndependencies:\n  a:\n    path: ../../packages/a\n  b:\n    path: ../../packages/b\n' });
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /lane "apps" misses input packages\/b\/\*\* \(a path dependency of apps\/x\/pubspec\.yaml\)/);
  });

  test('RED: a data file a script starts reading is a missed input', () => {
    const root = fixture();
    assert.equal(run(root, '--write').status, 0);
    change(root, { 'tooling/ci/check.mjs': `${BASE_FILES['tooling/ci/check.mjs']}readFileSync('tooling/other.json', 'utf8');\n` });
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /misses input tooling\/other\.json \(read by tooling\/ci\/check\.mjs\)/);
  });

  test('RED: a module the script imports, and what that module reads, are inputs', () => {
    const root = fixture();
    assert.equal(run(root, '--write').status, 0);
    change(root, {
      'tooling/ci/check.mjs': `import './lib.mjs';\n${BASE_FILES['tooling/ci/check.mjs']}`,
      'tooling/ci/lib.mjs': "export const P = 'tooling/other.json';\n",
    });
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /misses input tooling\/ci\/lib\.mjs \(imported by tooling\/ci\/check\.mjs\)/);
    assert.match(r.stderr, /misses input tooling\/other\.json/);
  });

  test('RED: a glob the derivation does not produce is hand-written', () => {
    const root = fixture();
    assert.equal(run(root, '--write').status, 0);
    const map = JSON.parse(readFileSync(join(root, MAP_REL), 'utf8'));
    map.lanes.apps.globs.push('README.md');
    change(root, { [MAP_REL]: `${JSON.stringify(map, null, 2)}\n` });
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /lane "apps" glob README\.md is not derived from anything the lane reads: it is hand-written/);
  });

  test('a script a step writes to the runner is read as the step\'s own text', () => {
    const root = fixture({
      '.github/workflows/lane-apps.yml': `${CALLEE}      - run: |\n          echo "import { spawnSync } from 'node:child_process'; spawnSync(process.execPath, ['tooling/ci/check.mjs']); const f = 'tooling/other.json';" > "$RUNNER_TEMP/x.mjs"\n          node "$RUNNER_TEMP/x.mjs"\n`,
    });
    assert.equal(run(root, '--write').status, 0);
    assert.ok(globsOf(root).includes('tooling/other.json'), JSON.stringify(globsOf(root)));
  });

  // ⏱ 2026-10-02: `node --test <glob>` names no script, so the suites it runs were a
  // literal glob and what they read was derived by nothing (#1148's contract suite
  // reads tooling/ports/channels.json and its fixtures).
  test('RED: a `node --test <glob>` step runs each suite it matches: what a suite reads, and an --import preload, are inputs', () => {
    const suite = {
      'tooling/ci/pre.mjs': 'export {};\n',
      'tooling/release/test/a.test.mjs': "import { readFileSync } from 'node:fs';\nreadFileSync('tooling/other.json', 'utf8');\n",
    };
    const root = fixture(suite);
    assert.equal(run(root, '--write').status, 0);
    assert.ok(!globsOf(root).includes('tooling/other.json'));
    change(root, { '.github/workflows/lane-apps.yml': `${CALLEE}      - run: node --import ./tooling/ci/pre.mjs --test "tooling/release/test/*.test.mjs"\n` });
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /misses input tooling\/other\.json \(read by tooling\/release\/test\/a\.test\.mjs\)/);
    assert.match(r.stderr, /misses input tooling\/ci\/pre\.mjs/);
  });

  test('a module that imports a computed path follows the adapters a PORT register names, and no other register\'s', () => {
    const suite = {
      'tooling/release/test/a.test.mjs':
        "import { readFileSync } from 'node:fs';\nconst p = JSON.parse(readFileSync('tooling/ports/rails.json', 'utf8'));\n" +
        "JSON.parse(readFileSync('tooling/jobs.json', 'utf8'));\nfor (const a of p.adapters) await import(a.impl.file);\n",
      'tooling/ports/rails.json': JSON.stringify({ adapters: [{ impl: { file: 'tooling/rails/one.mjs' } }] }),
      'tooling/rails/one.mjs': "import { readFileSync } from 'node:fs';\nreadFileSync('tooling/data.json', 'utf8');\n",
      'tooling/jobs.json': JSON.stringify({ job: { runs: 'tooling/rails/other.mjs' } }),
      'tooling/rails/other.mjs': 'export {};\n',
      '.github/workflows/lane-apps.yml': `${CALLEE}      - run: node --test "tooling/release/test/*.test.mjs"\n`,
    };
    const root = fixture(suite);
    const w = run(root, '--write');
    assert.equal(w.status, 0, out(w));
    const globs = globsOf(root);
    assert.ok(globs.includes('tooling/ports/rails.json'), JSON.stringify(globs));
    assert.ok(globs.includes('tooling/rails/one.mjs'), `the port's adapter is not followed: ${JSON.stringify(globs)}`);
    assert.ok(!globs.includes('tooling/rails/other.mjs'), `a non-port register's script path was followed: ${JSON.stringify(globs)}`);
  });

  test('a tool reads its manifest by convention: a `mason make` step derives mason.yaml', () => {
    const root = fixture();
    assert.equal(run(root, '--write').status, 0);
    assert.ok(!globsOf(root).includes('mason.yaml'));
    change(root, { '.github/workflows/lane-apps.yml': `${CALLEE}      - run: mason make app -o .\n` });
    const r = run(root);
    assert.equal(r.status, 1, out(r));
    assert.match(r.stderr, /misses input mason\.yaml \(\.github\/workflows\/lane-apps\.yml job "build" \(mason reads mason\.yaml\)\)/);
  });

  test('a brick file the lane reads is read at its stamped place: its relative reads outside the stamp are inputs', () => {
    const brick = 'tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api';
    const root = fixture({
      'tooling/ci/check.mjs': `${BASE_FILES['tooling/ci/check.mjs']}const B = 'tooling/bricks/app';\nimport { readdirSync } from 'node:fs';\nreaddirSync(B);\n`,
      [`${brick}/src/x.ts`]: "import { y } from '../../_shared/src/y';\n",
      'services/_shared/src/y.ts': 'export const y = 1;\n',
    });
    assert.equal(run(root, '--write').status, 0, out(run(root)));
    const globs = globsOf(root);
    assert.ok(globs.some((g) => globToRegExp(g).test(`${brick}/src/x.ts`)), `no glob covers the brick file: ${JSON.stringify(globs)}`);
    assert.ok(globs.includes('services/_shared/src/y.ts'), JSON.stringify(globs));
  });
});

describe('assert-lane-inputs — COVERAGE LOST, never a pass', () => {
  test('a lane the map does not name', () => {
    const root = fixture({}, { ...MAP, lanes: { guards: MAP.lanes.guards } });
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /COVERAGE LOST — lane "apps" is not in tooling\/ci\/lane-map\.json/);
  });

  test('a callee that does not exist', () => {
    const root = fixture({ '.github/workflows/lane-apps.yml': null });
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /names callee \.github\/workflows\/lane-apps\.yml, which does not exist/);
  });

  test('a `node --test` target that matches no tracked file', () => {
    const root = fixture({ '.github/workflows/lane-apps.yml': `${CALLEE}      - run: node --test "tooling/none/*.test.mjs"\n` });
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /runs `node --test tooling\/none\/\*\.test\.mjs`, which matches no tracked file/);
  });

  test('a callee that runs no node script', () => {
    const root = fixture({ '.github/workflows/lane-apps.yml': CALLEE.replace('node tooling/ci/check.mjs --lane apps', 'echo detect') });
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /runs no `node <script>`/);
  });

  test('a pub workspace with no member', () => {
    const root = fixture({ 'pubspec.yaml': 'name: ws\n' });
    const r = run(root);
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /declares no `workspace:` member/);
  });

  test('a lane that is not a derived lane', () => {
    const root = fixture();
    const r = spawnSync(process.execPath, [SCRIPT, '--root', root, '--lane', 'guards'], { encoding: 'utf8' });
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /--lane guards is not a derived lane/);
  });
});

describe('assert-lane-inputs — the pieces', () => {
  test('asMapPattern turns a brick segment into `*`, never across a `/` inside a tag', () => {
    assert.equal(asMapPattern('tooling/bricks/app/__brick__/apps/{{app_id}}/x.json'), 'tooling/bricks/app/__brick__/apps/*/x.json');
    assert.equal(
      asMapPattern('tooling/bricks/app/__brick__/{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/package.json'),
      'tooling/bricks/app/__brick__/*/*/package.json',
    );
    assert.equal(asMapPattern('apps/**'), 'apps/**');
  });

  test('stampedPath keeps a section\'s text and makes a variable a placeholder', () => {
    assert.equal(stampedPath('{{#needs_backend}}services{{/needs_backend}}/{{app_id}}-api/src/x.ts'), 'services/\u0000-api/src/x.ts');
  });

  test('stampedReads resolves from the stamped place and drops what stays inside the stamp', () => {
    const tree = treeOf(['services/_shared/src/y.ts', 'services/_shared/test/a.test.ts']);
    const got = stampedReads(
      '{{#b}}services{{/b}}/{{app_id}}-api/vitest.config.ts',
      "include: ['test/**/*.test.ts', '../_shared/test/**/*.test.ts']; import '../_shared/src/y'; import './own';",
      tree,
    );
    assert.deepEqual(got.map((p) => `${p.kind}:${p.path}`).sort(), ['file:services/_shared/src/y.ts', 'glob:services/_shared/test/**/*.test.ts']);
  });

  test('pathDependencies reads every `path:` and resolves it from the pubspec', () => {
    assert.deepEqual(pathDependencies('dependencies:\n  a:\n    path: ../../packages/a # why\n  b:\n    path: "../b"\n', 'apps/x'), ['packages/a', 'apps/b']);
  });

  test('judgeLane names a miss and a hand-written glob, and is silent when equal', () => {
    const inputs = new Map([['a/**', 'read by s'], ['b.json', 'read by s']]);
    assert.deepEqual(judgeLane('apps', ['a/**', 'b.json'], inputs), []);
    const p = judgeLane('apps', ['a/**', 'c.json'], inputs);
    assert.equal(p.length, 2);
    assert.match(p[0], /misses input b\.json \(read by s\)/);
    assert.match(p[1], /glob c\.json is not derived/);
  });
});

describe('assert-lane-inputs — the real tree', () => {
  test('every derived lane\'s globs equal its derivation', () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8' });
    assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /apps: \d+ derived input globs .*brick: \d+ derived input globs/);
  });
});
