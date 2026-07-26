// ─────────────────────────────────────────────────────────────────────────────
// guards.test.mjs — the guards must be able to FAIL.
//
// Every guard in tooling/ci runs on every build, but only ever against the real
// repository — which is, by definition, valid input. So CI exercises the passing
// path and nothing else. A guard that silently stops working still prints "ok",
// and the requirement it enforces silently stops being true while the pipeline
// spec still says VERIFIED.
//
// That is not hypothetical. Both have already happened here:
//   · check-migrations.mjs's own coverage assertion omits services/subly-api,
//     so a renamed directory would report "clean" over an incomplete set.
//   · assert-gate-passed.mjs shipped with an off-by-one that made it unable to
//     read its own SHA argument. It blocked both production deploys, and it was
//     found because the deploys broke — not because anything tested the guard.
//
// So: feed each guard KNOWN-BAD input and assert it fails; feed it KNOWN-GOOD
// input and assert it passes. Fixtures are built in a temp dir, never in the
// repo. No network — the two API-backed guards are covered for argument and
// decision handling only, which is exactly where the real defect was.
//
// Pipeline requirement: company/pipeline/01-foundation.md → F-10.
//
// Run:  node --test tooling/ci/test/
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let ROOT;
before(() => {
  ROOT = mkdtempSync(join(tmpdir(), 'nikatru-guard-'));
});
after(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** Build a throwaway fixture tree. `files` maps relative path → contents. */
function fixture(name, files) {
  const dir = join(ROOT, name);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run a guard as CI runs it: a real subprocess, real exit code. */
function run(script, { cwd = ROOT, args = [], env } = {}) {
  const r = spawnSync(process.execPath, [join(CI_DIR, script), ...args], {
    cwd,
    encoding: 'utf8',
    env: env === undefined ? process.env : env,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const pubspec = (name) => `name: ${name}\n`;
const rootPubspec = (members) =>
  `name: fixture\nworkspace:\n${members.map((m) => `  - ${m}\n`).join('')}`;

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-workspace-coverage', () => {
  const build = (name, onDisk, declared) => {
    const files = { 'pubspec.yaml': rootPubspec(declared) };
    for (const p of onDisk) files[`${p}/pubspec.yaml`] = pubspec(p.split('/').pop());
    return fixture(name, files);
  };
  const six = ['packages/a', 'packages/b', 'packages/c', 'packages/d', 'packages/e', 'apps/f'];

  test('PASSES when every package on disk is a workspace member', () => {
    const { code } = run('assert-workspace-coverage.mjs', { args: [build('wc-ok', six, six)] });
    assert.equal(code, 0);
  });

  test('FAILS when a package on disk is missing from the list, and names it', () => {
    const dir = build('wc-unlisted', six, six.slice(0, 5));
    const { code, out } = run('assert-workspace-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /apps\/f/);
  });

  test('FAILS when a listed member does not exist on disk', () => {
    const dir = build('wc-stale', six, [...six, 'packages/ghost']);
    const { code, out } = run('assert-workspace-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /ghost/);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const two = ['packages/a', 'packages/b'];
    const { code, out } = run('assert-workspace-coverage.mjs', { args: [build('wc-cov', two, two)] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-migrations', () => {
  const ADDITIVE = 'CREATE TABLE IF NOT EXISTS t (id TEXT);\nALTER TABLE t ADD COLUMN x TEXT;\n';
  const build = (name, platformSql, brickSql = ADDITIVE, extra = {}) =>
    fixture(name, {
      'services/platform/migrations/0001_init.sql': platformSql,
      'tooling/bricks/app/__brick__/svc/migrations/0001_init.sql': brickSql,
      ...extra,
    });

  test('PASSES on additive-only migrations', () => {
    const { code } = run('check-migrations.mjs', { cwd: build('mig-ok', ADDITIVE) });
    assert.equal(code, 0);
  });

  for (const [label, sql, needle] of [
    ['DROP TABLE', 'DROP TABLE t;\n', /DROP TABLE/i],
    ['RENAME', 'ALTER TABLE t RENAME TO u;\n', /RENAME/i],
    ['NOT NULL with no DEFAULT', 'ALTER TABLE t ADD COLUMN y TEXT NOT NULL;\n', /NOT NULL/i],
  ]) {
    test(`FAILS on ${label}`, () => {
      const { code, out } = run('check-migrations.mjs', { cwd: build(`mig-${label.replace(/\W+/g, '')}`, sql) });
      assert.equal(code, 1);
      assert.match(out, needle);
    });
  }

  test('does NOT trip on a banned keyword inside a comment', () => {
    const sql = `-- we never DROP TABLE here, and never RENAME either\n${ADDITIVE}`;
    const { code } = run('check-migrations.mjs', { cwd: build('mig-comment', sql) });
    assert.equal(code, 0);
  });

  test('FAILS its own coverage check when a required migration set is absent', () => {
    const dir = fixture('mig-cov', { 'services/platform/migrations/0001_init.sql': ADDITIVE });
    const { code, out } = run('check-migrations.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-cors-allowlist', () => {
  const ALL = [
    'https://subly.nikatru.com',
    'https://subly-9cp.pages.dev',
    'http://localhost:3000',
  ];
  const build = (name, body) =>
    fixture(name, { 'services/platform/wrangler.jsonc': body });
  const config = (origins, trailer = '') =>
    `{\n  // the shared platform Worker\n  "vars": { "ALLOWED_ORIGINS": "${origins.join(',')}" }${trailer}\n}\n`;

  test('PASSES when every required origin is listed', () => {
    const { code } = run('assert-cors-allowlist.mjs', { cwd: build('cors-ok', config(ALL)) });
    assert.equal(code, 0);
  });

  test('FAILS when a required origin is dropped, and names it', () => {
    const dir = build('cors-missing', config(ALL.slice(0, 2)));
    const { code, out } = run('assert-cors-allowlist.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /localhost:3000/);
  });

  test('FAILS on an empty allowlist — which would deny every browser origin', () => {
    const { code } = run('assert-cors-allowlist.mjs', { cwd: build('cors-empty', config([])) });
    assert.equal(code, 1);
  });

  test('is STRUCTURAL — an origin mentioned only in a comment does not satisfy it', () => {
    const body = `{\n  // https://subly-9cp.pages.dev and http://localhost:3000 used to be here\n  "vars": { "ALLOWED_ORIGINS": "https://subly.nikatru.com" }\n}\n`;
    const { code } = run('assert-cors-allowlist.mjs', { cwd: build('cors-comment', body) });
    assert.equal(code, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No network. These cover argument and precondition handling only — which is
// precisely where the defect that blocked both production deploys lived.
describe('assert-gate-passed (offline paths)', () => {
  const baseEnv = { ...process.env, GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' };

  test('REGRESSION: a bare SHA with no flag is parsed, not discarded', () => {
    // The bug: indexOf returns -1 when --timeout-seconds is absent, so
    // `timeoutIdx + 1` was 0 and argv[0] — the SHA — was filtered out.
    // Proven without network: if the SHA is read, the run advances PAST the SHA
    // check and stops on the next missing precondition instead.
    const env = { ...process.env, GITHUB_TOKEN: 't' };
    delete env.GITHUB_REPOSITORY;
    delete env.GH_TOKEN;
    const { code, out } = run('assert-gate-passed.mjs', { args: ['abc1234'], env });
    assert.equal(code, 1);
    assert.match(out, /GITHUB_REPOSITORY is not set/);
    assert.doesNotMatch(out, /no commit SHA given/);
  });

  test('FAILS with a named cause when no SHA is given', () => {
    const { code, out } = run('assert-gate-passed.mjs', { args: [], env: baseEnv });
    assert.equal(code, 1);
    assert.match(out, /no commit SHA given/);
  });

  test('does not mistake a flag VALUE for the SHA', () => {
    const { code, out } = run('assert-gate-passed.mjs', { args: ['--timeout-seconds', '10'], env: baseEnv });
    assert.equal(code, 1);
    assert.match(out, /no commit SHA given/);
  });

  test('FAILS when no token is available', () => {
    const env = { ...process.env, GITHUB_REPOSITORY: 'o/r' };
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    const { code, out } = run('assert-gate-passed.mjs', { args: ['abc1234'], env });
    assert.equal(code, 1);
    assert.match(out, /TOKEN/);
  });

  test('FAILS on a non-numeric timeout rather than waiting forever', () => {
    const { code, out } = run('assert-gate-passed.mjs', {
      args: ['abc1234', '--timeout-seconds', 'soon'],
      env: baseEnv,
    });
    assert.equal(code, 1);
    assert.match(out, /positive number/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-lane-coverage', () => {
  const EIGHT_DART = Array.from({ length: 8 }, (_, i) => `packages/p${i}`);
  const workflow = (paths) =>
    `name: CI\njobs:\n  a:\n    steps:\n${paths.map((p) => `      - run: build ${p}\n`).join('')}`;

  /** `dart` members go in the workspace list; everything else must be named in a workflow. */
  const build = (name, { dart = EIGHT_DART, declared = EIGHT_DART, workers = [], sites = [], named = [] } = {}) => {
    const files = {
      'pubspec.yaml': rootPubspec(declared),
      '.github/workflows/ci.yml': workflow(named),
    };
    for (const d of dart) files[`${d}/pubspec.yaml`] = pubspec(d.split('/').pop());
    for (const w of workers) files[`${w}/wrangler.jsonc`] = '{}\n';
    for (const s of sites) files[`${s}/index.html`] = '<html></html>\n';
    return fixture(name, files);
  };

  test('PASSES when every unit is claimed by the right mechanism', () => {
    const dir = build('lc-ok', { workers: ['services/w'], sites: ['sites/s'], named: ['services/w', 'sites/s'] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 0, out);
    assert.match(out, /all claimed/);
  });

  test('FAILS when a Worker is named in no workflow', () => {
    const dir = build('lc-worker', { workers: ['services/w'], named: [] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /services\/w/);
  });

  test('FAILS when a site is named in no workflow — the real F-9 gap', () => {
    const dir = build('lc-site', { sites: ['sites/nikatru'], named: [] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /sites\/nikatru/);
  });

  test('FAILS when a dart package is outside the workspace', () => {
    const dir = build('lc-dart', { declared: EIGHT_DART.slice(0, 7) });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /packages\/p7/);
  });

  test('does NOT demand that dart packages be named in a workflow', () => {
    // The false-alarm case. melos covers members collectively and never names
    // them, so a naive path grep would report all eight as uncovered — and a
    // guard that cries wolf on eight packages is a guard someone switches off.
    const dir = build('lc-dart-ok', { named: [] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const dir = build('lc-cov', { dart: ['packages/only'], declared: ['packages/only'] });
    const { code, out } = run('assert-lane-coverage.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('check-site-integrity', () => {
  const REQUIRED = ['index.html', '404.html', 'robots.txt', '_headers'];
  const ESM_FN = 'export async function onRequestPost({ request, env }) {\n  return new Response("ok");\n}\n';

  const build = (name, { sites = ['a', 'b'], omit = null, fnBody = ESM_FN, fnCount = 1 } = {}) => {
    const files = {};
    for (const s of sites) {
      for (const f of REQUIRED) {
        if (omit && omit.site === s && omit.file === f) continue;
        files[`sites/${s}/${f}`] = f.endsWith('.html') ? '<html></html>\n' : 'x\n';
      }
    }
    if (fnCount > 0) files[`sites/${sites[0]}/functions/api/handler.js`] = fnBody;
    return fixture(name, files);
  };

  test('PASSES on healthy sites — and accepts ESM syntax in a .js Function', () => {
    // `node --check` treats .js as CommonJS and would reject `export`. If the
    // .mjs probe ever regresses, this test fails and every real Function would
    // otherwise be reported broken.
    const { code, out } = run('check-site-integrity.mjs', { args: [build('si-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /2 deploy root\(s\)/);
  });

  test('FAILS when a required file is missing, and names it', () => {
    const dir = build('si-missing', { omit: { site: 'b', file: '404.html' } });
    const { code, out } = run('check-site-integrity.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /404\.html/);
  });

  test('FAILS when a Pages Function does not parse', () => {
    const dir = build('si-syntax', { fnBody: 'export async function onRequestPost( {\n' });
    const { code, out } = run('check-site-integrity.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /does not parse/);
  });

  test('FAILS its own coverage check when a deploy root disappears', () => {
    const { code, out } = run('check-site-integrity.mjs', { args: [build('si-onesite', { sites: ['a'] })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS its own coverage check when server-side code stops being found', () => {
    const { code, out } = run('check-site-integrity.mjs', { args: [build('si-nofn', { fnCount: 0 })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures deliberately contain no .git, so the tracked-ness check self-disables
// and these exercise the lockfile-presence and install-command rules.
describe('assert-lockfile-discipline', () => {
  const UNITS = ['services/w1', 'services/w2', 'packages/n1'];
  const build = (name, { units = UNITS, omitLockFor = null, workflow = null } = {}) => {
    const files = {
      '.github/workflows/ci.yml': workflow ?? 'jobs:\n  a:\n    steps:\n      - run: npm ci\n',
    };
    for (const u of units) {
      files[`${u}/package.json`] = '{"name":"x"}\n';
      if (u !== omitLockFor) files[`${u}/package-lock.json`] = '{"lockfileVersion":3}\n';
    }
    return fixture(name, files);
  };

  test('PASSES when every node unit is locked and installs are reproducible', () => {
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /every workflow install is reproducible/);
  });

  test('FAILS when a node unit has no lockfile, and names it', () => {
    const dir = build('ld-nolock', { omitLockFor: 'services/w2' });
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /services\/w2/);
  });

  test('FAILS on a bare npm install in a workflow, with file and line', () => {
    const wf = 'jobs:\n  a:\n    steps:\n      - run: npm ci\n  b:\n    steps:\n      - run: npm install\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-install', { workflow: wf })] });
    assert.equal(code, 1);
    assert.match(out, /ci\.yml:7/);
    assert.match(out, /npm ci/);
  });

  test('ALLOWS npm install for a mason-stamped app — the one deliberate exception', () => {
    const wf =
      'jobs:\n  a:\n    steps:\n      - name: stamped service\n        working-directory: services/probeapi-api\n        run: |\n          npm install\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-excused', { workflow: wf })] });
    assert.equal(code, 0, out);
  });

  test('does NOT trip on npm install mentioned in a comment', () => {
    const wf = 'jobs:\n  a:\n    steps:\n      # we used to run npm install here\n      - run: npm ci\n';
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-comment', { workflow: wf })] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const { code, out } = run('assert-lockfile-discipline.mjs', { args: [build('ld-cov', { units: ['services/only'] })] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-workflow-hardening', () => {
  const SHA = 'a'.repeat(40);
  const wf = (uses, { withPermissions = true } = {}) =>
    `name: X\non: push\n${withPermissions ? 'permissions:\n  contents: read\n' : ''}jobs:\n  j:\n    steps:\n` +
    uses.map((u) => `      - uses: ${u}\n`).join('');

  /** 12 refs across 3 files clears the scan's own MIN_USES / MIN_WORKFLOWS floor. */
  const build = (name, { bad = null, noPermsIn = null } = {}) => {
    const files = {};
    for (const f of ['a', 'b', 'c']) {
      const refs = Array.from({ length: 4 }, (_, i) => `actions/act${i}@${SHA}`);
      if (bad && bad.file === f) refs[bad.index] = bad.ref;
      files[`.github/workflows/${f}.yml`] = wf(refs, { withPermissions: noPermsIn !== f });
    }
    return fixture(name, files);
  };

  test('PASSES when every action is SHA-pinned and every workflow declares permissions', () => {
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [build('wh-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /all SHA-pinned/);
  });

  test('FAILS on a movable tag reference, naming file and line', () => {
    const dir = build('wh-tag', { bad: { file: 'b', index: 2, ref: 'actions/checkout@v4' } });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /b\.yml:\d+/);
    assert.match(out, /movable reference/);
  });

  test('FAILS on a branch reference, not only on version tags', () => {
    const dir = build('wh-branch', { bad: { file: 'a', index: 0, ref: 'some/action@main' } });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /@main/);
  });

  test('FAILS when a workflow declares no permissions block', () => {
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [build('wh-perms', { noPermsIn: 'c' })] });
    assert.equal(code, 1);
    assert.match(out, /c\.yml declares no/);
  });

  test('does NOT trip on a tag reference inside a comment', () => {
    const dir = fixture('wh-comment', {
      '.github/workflows/a.yml':
        `name: X\npermissions:\n  contents: read\njobs:\n  j:\n    steps:\n      # was uses: actions/checkout@v4\n` +
        Array.from({ length: 12 }, (_, i) => `      - uses: actions/act${i}@${SHA}\n`).join(''),
      '.github/workflows/b.yml': wf([`actions/x@${SHA}`]),
      '.github/workflows/c.yml': wf([`actions/y@${SHA}`]),
    });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const dir = fixture('wh-cov', { '.github/workflows/a.yml': wf([`actions/x@${SHA}`]) });
    const { code, out } = run('assert-workflow-hardening.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assert-version-consistency', () => {
  const DECL = {
    flutter: '3.44.7',
    node: '24',
    java: '17',
    melos: '8.2.2',
    mason_cli: '0.1.3',
    runner_ubuntu: 'ubuntu-24.04',
    runner_windows: 'windows-2025',
    runner_macos: 'macos-26',
  };

  /** 12 references clears the scan's own MIN_OCCURRENCES floor. */
  const wf = ({ flutter = DECL.flutter, node = DECL.node, mason = DECL.mason_cli, extra = '' } = {}) =>
    `name: X\njobs:\n  j:\n    steps:\n` +
    Array.from({ length: 5 }, () => `      - uses: x\n        with:\n          flutter-version: ${flutter}\n`).join('') +
    Array.from({ length: 5 }, () => `      - uses: y\n        with:\n          node-version: ${node}\n`).join('') +
    `      - run: dart pub global activate melos ${DECL.melos}\n` +
    `      - run: dart pub global activate mason_cli ${mason}\n` +
    extra;

  const build = (name, opts) =>
    fixture(name, { 'tooling/versions.json': JSON.stringify(DECL), '.github/workflows/ci.yml': wf(opts) });

  test('PASSES when every literal matches the declaration', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-ok')] });
    assert.equal(code, 0, out);
    assert.match(out, /all match versions\.json/);
  });

  test('FAILS on a drifted Flutter version, naming file, line and both values', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-flutter', { flutter: '3.40.0' })] });
    assert.equal(code, 1);
    assert.match(out, /ci\.yml:\d+/);
    assert.match(out, /"3\.40\.0".*"3\.44\.7"/);
  });

  test('FAILS on a drifted Node version', () => {
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-node', { node: '22' })] });
    assert.equal(code, 1);
    assert.match(out, /Node is "22"/);
  });

  test('FAILS when mason_cli is UNPINNED — the real defect this found', () => {
    // `dart pub global activate mason_cli` with no version takes whatever is
    // newest. Mason stamps apps, so an unpinned mason means the factory's own
    // product can differ between runs.
    const { code, out } = run('assert-version-consistency.mjs', { args: [build('vc-mason', { mason: '' })] });
    assert.equal(code, 1);
    assert.match(out, /mason_cli is UNPINNED/);
  });

  test('compares PARSED values, so a commented-out version cannot mask a drift', () => {
    const dir = build('vc-comment', { extra: '      # flutter-version: 9.9.9\n' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS on a `-latest` runner label, which is a moving target', () => {
    const dir = build('vc-runner', { extra: '  k:\n    runs-on: macos-latest\n    steps: []\n' });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /macOS runner is "macos-latest"/);
  });

  test('PASSES on pinned runner labels', () => {
    const dir = build('vc-runner-ok', {
      extra: '  k:\n    runs-on: ubuntu-24.04\n    steps: []\n  l:\n    runs-on: windows-2025\n    steps: []\n',
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 0, out);
  });

  test('FAILS its own coverage check when the scan finds almost nothing', () => {
    const dir = fixture('vc-cov', {
      'tooling/versions.json': JSON.stringify(DECL),
      '.github/workflows/ci.yml': `name: X\njobs:\n  j:\n    steps:\n      - run: echo hi\n`,
    });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS when there is no declaration to check against', () => {
    const dir = fixture('vc-nodecl', { '.github/workflows/ci.yml': wf() });
    const { code, out } = run('assert-version-consistency.mjs', { args: [dir] });
    assert.equal(code, 1);
    assert.match(out, /no tooling\/versions\.json/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('record-deployment (offline paths)', () => {
  test('FAILS when no environment is given', () => {
    const { code, out } = run('record-deployment.mjs', { args: [], env: { ...process.env } });
    assert.equal(code, 1);
    assert.match(out, /no environment given/);
  });

  test('FAILS when the repository is unknown', () => {
    const env = { ...process.env, GITHUB_SHA: 'abc', GH_TOKEN: 't' };
    delete env.GITHUB_REPOSITORY;
    const { code, out } = run('record-deployment.mjs', { args: ['staging'], env });
    assert.equal(code, 1);
    assert.match(out, /GITHUB_REPOSITORY/);
  });

  test('FAILS when there is no SHA to record', () => {
    const env = { ...process.env, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't' };
    delete env.GITHUB_SHA;
    const { code, out } = run('record-deployment.mjs', { args: ['staging'], env });
    assert.equal(code, 1);
    assert.match(out, /GITHUB_SHA/);
  });
});
