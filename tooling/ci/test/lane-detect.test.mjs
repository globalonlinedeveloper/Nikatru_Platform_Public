// ─────────────────────────────────────────────────────────────────────────────
// lane-detect.test.mjs — lane-detect.mjs must be able to say "run" and "skip" for
// the right reasons, fail open when it cannot see, and its --check must fail. [ADR 095]
//
// Each detect case builds a REAL two-commit git repository in a temp directory and
// runs the script as the callee's detect step runs it: env GITHUB_EVENT_NAME,
// GITHUB_EVENT_PATH (a pull_request payload carrying base.sha and head.sha) and
// GITHUB_OUTPUT. The --check cases run against a copy of the fixture map, and once
// against the real tree, which is the subject guard-meta grades.
//
// Run:  node --test tooling/ci/test/lane-detect.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { globToRegExp } from '../lane-detect.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const SCRIPT = join(CI_DIR, 'lane-detect.mjs');

const MAP = {
  _readme: ['fixture'],
  lanes: {
    workers: { globs: ['services/w/**', 'catalog/apps.json'] },
    sites: { globs: ['sites/**'] },
    guards: { globs: ['tooling/**'] },
  },
  unclaimed: ['docs/**', '*.md'],
};

const BASE_FILES = {
  'services/w/a.ts': 'export const a = 1;\n',
  'catalog/apps.json': '[]\n',
  'sites/s.html': '<p>s</p>\n',
  'docs/d.md': '# d\n',
  'README.md': '# r\n',
};

let TMP;
let n = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-lane-detect-'));
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
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

/** A repo with the fixture map committed as base, then `changes` committed as head. */
function repo(changes, map = MAP) {
  const root = join(TMP, `r${n++}`);
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  write(root, { ...BASE_FILES, 'tooling/ci/lane-map.json': `${JSON.stringify(map, null, 2)}\n` });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  write(root, changes);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'head');
  const head = git(root, 'rev-parse', 'HEAD');
  return { root, base, head };
}

function detect({ root, base, head }, lane, event = 'pull_request', payloadOverride = null) {
  const payloadPath = join(root, '..', `payload-${n++}.json`);
  const out = join(root, '..', `output-${n++}.txt`);
  writeFileSync(payloadPath, JSON.stringify(payloadOverride ?? { pull_request: { base: { sha: base }, head: { sha: head } } }));
  writeFileSync(out, '');
  const r = spawnSync(process.execPath, [SCRIPT, '--lane', lane, '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: payloadPath, GITHUB_OUTPUT: out },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, output: readFileSync(out, 'utf8') };
}

function check(root) {
  const r = spawnSync(process.execPath, [SCRIPT, '--check', '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function noCrash(res) {
  assert.doesNotMatch(res.out, /\b(SyntaxError|ReferenceError|TypeError|ERR_MODULE_NOT_FOUND)\b/, `the script crashed rather than reporting:\n${res.out}`);
}

describe('lane-detect.mjs --lane — the decision', () => {
  test('a push (not a pull_request) is affected, whatever changed', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n' }), 'workers', 'push');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /^reason=event is push, not a pull_request/m);
  });

  test('a pull_request changing a path in the lane is affected', () => {
    const r = detect(repo({ 'services/w/a.ts': 'export const a = 2;\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /1 changed path\(s\) in lane workers, first services\/w\/a\.ts/);
  });

  test('a pull_request changing only another lane\'s path is NOT affected', () => {
    const r = detect(repo({ 'sites/s.html': '<p>t</p>\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=false$/m);
  });

  test('a pull_request changing only `unclaimed` paths (docs) is NOT affected', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n', 'README.md': '# changed\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=false$/m);
    assert.match(r.output, /none of 2 changed path\(s\) is in lane workers, and every one is mapped/);
  });

  test('an unmapped path runs every lane, even beside an unclaimed one (RC1\'s shape)', () => {
    const r = detect(repo({ 'zz-unmapped.txt': 'x\n', 'docs/d.md': '# changed\n' }), 'workers');
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /^reason=unmapped zz-unmapped\.txt: a path the map does not name runs every lane$/m);
  });

  test('a diff that cannot be computed fails OPEN, and says why', () => {
    const fixture = repo({ 'docs/d.md': '# changed\n' });
    const r = detect(fixture, 'workers', 'pull_request', { pull_request: { base: { sha: 'f'.repeat(40) }, head: { sha: fixture.head } } });
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /^reason=the diff could not be computed \(git diff f{12}\.\.\.[0-9a-f]{12} failed: .+\): failing open$/m);
  });

  test('a payload without the two shas fails open too — it is not read as an empty diff', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n' }), 'workers', 'pull_request', { pull_request: {} });
    noCrash(r);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /the payload carries no pull_request\.base\.sha \/ head\.sha/);
  });

  test('a diff naming zero paths fails open rather than skipping', () => {
    const r = detect(repo({}), 'workers');
    noCrash(r);
    assert.match(r.output, /^affected=true$/m);
    assert.match(r.output, /the diff named zero paths/);
  });

  test('a lane the map does not name is COVERAGE LOST (exit 2), and writes no output', () => {
    const r = detect(repo({ 'docs/d.md': '# changed\n' }), 'wrokers');
    noCrash(r);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — lane "wrokers" is not in tooling\/ci\/lane-map\.json/);
    assert.equal(r.output, '');
  });
});

describe('lane-detect.mjs --check — the map\'s guard', () => {
  test('the real tree passes: every tracked file is placed and every glob is alive', () => {
    const r = check(REPO);
    noCrash(r);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok {2}lane map — \d+ tracked file\(s\) each claimed/m);
  });

  test('the fixture base passes (so each red below is the mutation, not the fixture)', () => {
    const r = check(repo({}).root);
    noCrash(r);
    assert.equal(r.code, 0, r.out);
  });

  test('a tracked file no entry claims fails (RC8\'s shape: a new service, the map not updated)', () => {
    const r = check(repo({ 'services/new-thing/x.ts': 'export {};\n' }).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /1 tracked file\(s\) match no lane and no `unclaimed` glob in tooling\/ci\/lane-map\.json: services\/new-thing\/x\.ts/);
  });

  test('a glob that matches no tracked file fails — a dead claim reads as coverage', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, sites: { globs: ['sites/**', 'site/**'] } } };
    const r = check(repo({}, map).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lane "sites" glob "site\/\*\*" matches no tracked file/);
  });

  test('a callee whose detect step names another lane fails', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, workers: { callee: 'lane-workers.yml', globs: MAP.lanes.workers.globs } } };
    const r = check(repo({ 'lane-workers.yml': 'run: node tooling/ci/lane-detect.mjs --lane sites\n' }, { ...map, unclaimed: [...map.unclaimed, '*.yml'] }).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lane-workers\.yml is lane "workers"'s callee in tooling\/ci\/lane-map\.json, but its detect step runs lane-detect\.mjs for "sites"/);
  });

  test('a callee whose only lane-detect step is commented out names no lane, and fails', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, workers: { callee: 'lane-workers.yml', globs: MAP.lanes.workers.globs } } };
    const r = check(repo({ 'lane-workers.yml': '      # - run: node tooling/ci/lane-detect.mjs --lane workers\n' }, { ...map, unclaimed: [...map.unclaimed, '*.yml'] }).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /but its detect step runs lane-detect\.mjs for no lane/);
  });

  test('a callee that does not exist fails', () => {
    const map = { ...MAP, lanes: { ...MAP.lanes, workers: { callee: 'lane-gone.yml', globs: MAP.lanes.workers.globs } } };
    const r = check(repo({}, map).root);
    noCrash(r);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /lane "workers" names callee lane-gone\.yml, which does not exist/);
  });

  test('a map with no lanes is COVERAGE LOST (exit 2), not a clean sweep', () => {
    const r = check(repo({}, { lanes: {}, unclaimed: ['**'] }).root);
    noCrash(r);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — tooling\/ci\/lane-map\.json has no `lanes` object/);
  });
});

describe('globToRegExp — the only syntax the map may use', () => {
  test('`**` spans directories and `*` stays inside one segment', () => {
    assert.equal(globToRegExp('services/w/**').test('services/w/src/deep/a.ts'), true);
    assert.equal(globToRegExp('services/w/**').test('services/wx/a.ts'), false);
    assert.equal(globToRegExp('*.md').test('README.md'), true);
    assert.equal(globToRegExp('*.md').test('docs/d.md'), false);
    assert.equal(globToRegExp('contracts/entitlement/*.d.ts').test('contracts/entitlement/bundle.d.ts'), true);
    assert.equal(globToRegExp('contracts/entitlement/*.d.ts').test('contracts/entitlement/bundleXd.ts'), false);
  });

  test('brace sets and absolute paths are refused, not half-matched', () => {
    assert.throws(() => globToRegExp('contracts/entitlement/*.{js,json}'), /not in the supported syntax/);
    assert.throws(() => globToRegExp('/services/**'), /not in the supported syntax/);
  });
});
