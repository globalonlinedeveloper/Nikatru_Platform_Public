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
// Run:  node --test "tooling/ci/test/*.test.mjs"   (glob, so every *.test.mjs runs;
//       a bare directory path is treated as a module on Windows and throws)
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
// The behaviour that matters most is "the wrapper FAILS when the scanner stops
// detecting" — which cannot be exercised with the real binary, because a working
// gitleaks always detects. These substitute stub scanners with known behaviour.
describe('scan-secrets', () => {
  const PEM = 'BEGIN RSA PRIVATE KEY';

  /** A faithful stub: exits 1 (finding) iff the scanned dir holds a PEM header. */
  const HONEST = `
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-stub'); process.exit(0); }
const src = a[a.indexOf('--source') + 1];
const walk = (d) => readdirSync(d).flatMap((e) => {
  const p = join(d, e);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
let hit = false;
for (const f of walk(src)) { try { if (readFileSync(f, 'utf8').includes('${PEM}')) hit = true; } catch {} }
if (hit) { console.log('finding: private-key'); process.exit(1); }
process.exit(0);
`;

  /** A scanner that has silently stopped detecting — always reports clean. */
  const BLIND = `
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1-blind'); process.exit(0); }
process.exit(0);
`;

  /** The stub lives OUTSIDE the scanned tree — both because a real scanner binary
   *  is not in the repo, and because the stub's own source contains the PEM
   *  literal it looks for, which would otherwise be found as a "leak" in itself. */
  const build = (name, stub, files = {}) => {
    const root = fixture(name, {
      'bin/stub.mjs': stub,
      'repo/README.md': 'nothing secret here\n',
      // The fixture carries the same marker paths the real tree has, because
      // scan-secrets now asserts its scan actually reached a repository before
      // believing a clean result — gitleaks over an empty directory exits 0 with
      // no findings, byte-for-byte identical to a clean repo. [pipeline F-10]
      'repo/.github/workflows/ci.yml': 'name: ci\n',
      'repo/tooling/ci/placeholder.mjs': '// guard\n',
      'repo/packages/.keep': '',
      'repo/apps/.keep': '',
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`repo/${k}`, v])),
    });
    return { repo: join(root, 'repo'), stub: join(root, 'bin', 'stub.mjs'), root };
  };

  test('PASSES on a clean tree, after proving the scanner still detects', () => {
    const { repo, stub } = build('ss-clean', HONEST);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 0, out);
    assert.match(out, /self-test — a planted secret is still detected/);
    assert.match(out, /no findings/);
  });

  test('COVERAGE: a tree that is not the repo FAILS instead of reporting clean', () => {
    // The self-test proves the SCANNER detects. It says nothing about whether
    // the scanner was pointed at anything. A mistyped path, a checkout that did
    // not happen, or a relocated working directory all yield exit 0 and no
    // findings — identical to success. [pipeline F-10]
    const { repo, stub, root } = build('ss-wrong-root', HONEST);
    void repo;
    const { code, out } = run('scan-secrets.mjs', { args: [join(root, 'bin'), '--gitleaks', stub] });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
    assert.match(out, /The scan is broken, not the tree/);
  });

  test('FAILS when the scanner has silently stopped detecting — the whole point', () => {
    const { repo, stub } = build('ss-blind', BLIND);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 1);
    assert.match(out, /SELF-TEST FAILED/);
    assert.match(out, /would have reported this repository "clean"/);
  });

  test('FAILS when the tree actually contains a secret', () => {
    const { repo, stub } = build('ss-leak', HONEST, { 'config/leaked.key': `-----${PEM}-----\nAAAA\n` });
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', stub] });
    assert.equal(code, 1);
    assert.match(out, /secret scan found something/);
  });

  test('FAILS with a named cause when the scanner is not installed', () => {
    const { repo, root } = build('ss-missing', HONEST);
    const { code, out } = run('scan-secrets.mjs', { args: [repo, '--gitleaks', join(root, 'nope.mjs')] });
    assert.equal(code, 1);
    assert.match(out, /not runnable/);
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

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-6] assert-seams-wired — the guard that makes a fail-closed seam
// prove it has an on-switch. Every check below has a recorded failing case,
// because a guard nobody has watched fail is a guard nobody should trust (F-10).
describe('assert-seams-wired', () => {
  const RECORD_CALL = `
final x = () async {
  await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
  );
};
const String kPrivacyPolicyVersion = '2026-07-26';
`;
  const UI_CALLER = `onPressed: () => recordAnalyticsConsent(ref, granted: true),`;
  const POLICY = (v) => `<p class="updated" data-policy-version="${v}">x</p>`;

  // 12 files minimum, else the guard reports COVERAGE LOST rather than passing.
  const filler = (n) => {
    const out = {};
    for (let i = 0; i < n; i++) out[`apps/subly/lib/filler_${i}.dart`] = '// filler\n';
    return out;
  };

  // The DECLARATION must be present in the fixture's provider file, exactly as
  // it is in the real repo. Without it these tests pass against a guard whose
  // caller check is satisfied by the declaration itself — which is the bug that
  // was live here, invisible to a fixture that omitted the declaration and
  // caught only by mutating the real tree.
  const DECLARATION = `
Future<void> recordAnalyticsConsent(
  WidgetRef ref, {
  required bool granted,
}) async {}
`;

  // The guard checks several seams in one run, so a fixture that omits the
  // pack-verifier files fails for a reason unrelated to what the test is about.
  // Kept realistic rather than minimal — the same correction the caller-vs-
  // declaration bug forced.
  // The brick template also declares kPrivacyPolicyVersion, so the guard checks
  // BOTH files. A fixture missing it fails for a reason unrelated to the test —
  // fixtures must mirror the real tree.
  const BRICK_POLICY_FILE = {
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart':
      "const String kPrivacyPolicyVersion = '2026-07-26';\n",
  };

  const PACK_FILES = {
    'packages/core/lib/src/content/ed25519_pack_verifier.dart':
      'class Ed25519PackVerifier implements PackVerifier {\n  verify() async { if (x == null) return false; return await _ed.verify(m); }\n}\n',
    'packages/core/lib/nikatru_core.dart': "export 'src/content/ed25519_pack_verifier.dart';\n",
    'packages/core/lib/src/content/pack_verifier.dart':
      'const Map<String, String> kContentPackPublicKeys = <String, String>{};\n',
  };

  const build = (name, { record = RECORD_CALL, ui = UI_CALLER, decl = DECLARATION, htmlVersion = '2026-07-26', dartVersion = '2026-07-26', fillerCount = 14 } = {}) =>
    fixture(name, {
      ...filler(fillerCount),
      ...PACK_FILES,
      ...BRICK_POLICY_FILE,
      'apps/subly/lib/state/analytics_providers.dart':
        `${record}\n${decl}\nconst String kPrivacyPolicyVersion = '${dartVersion}';\n`,
      'apps/subly/lib/features/consent/consent_prompt.dart': ui,
      'sites/nikatru/privacy.html': POLICY(htmlVersion),
    });

  test('passes when the seam has a real call site and the policy matches', () => {
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('seams-ok') });
    assert.equal(code, 0);
    assert.match(out, /a real record\(\) call/);
    assert.match(out, /policy version pinned/);
  });

  test('FAILS when the record() call is deleted — the original defect', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-record', { record: '// nothing calls record any more\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a real record\(\) call NOT FOUND/);
  });

  test('FAILS when the UI caller is deleted but the logic remains', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-no-ui', { ui: '// prompt removed\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /a UI caller NOT FOUND/);
  });

  // The regression test for the guard's own defect. A declaration is not a
  // caller; if this ever passes with no UI file, the caller check has stopped
  // discriminating and the rail can go dark with CI green.
  test('a DECLARATION alone does not count as a caller', () => {
    const dir = fixture('seams-decl-only', {
      ...filler(14),
      ...PACK_FILES,
      ...BRICK_POLICY_FILE,
      'apps/subly/lib/state/analytics_providers.dart':
        `${RECORD_CALL}\n${DECLARATION}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n`,
      // no consent_prompt.dart, no settings caller — nothing calls it at all
      'sites/nikatru/privacy.html': POLICY('2026-07-26'),
    });
    const { code, out } = run('assert-seams-wired.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /a UI caller NOT FOUND/);
  });

  test('FAILS on policy-version drift between app and published policy', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-drift', { htmlVersion: '2026-08-01', dartVersion: '2026-07-26' }),
    });
    assert.equal(code, 1);
    assert.match(out, /policy version DRIFT/);
  });

  test('FAILS when privacy.html carries no version at all', () => {
    const dir = fixture('seams-noversion', {
      ...filler(14),
      ...PACK_FILES,
      ...BRICK_POLICY_FILE,
      'apps/subly/lib/state/analytics_providers.dart': `${RECORD_CALL}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n`,
      'apps/subly/lib/features/consent/consent_prompt.dart': UI_CALLER,
      'sites/nikatru/privacy.html': '<p class="updated">Last updated: whenever</p>',
    });
    const { code, out } = run('assert-seams-wired.mjs', { cwd: dir });
    assert.equal(code, 1);
    assert.match(out, /no data-policy-version/);
  });

  // The self-check. A guard whose scan silently stops reaching the tree would
  // pass every seam by finding nothing to contradict — the exact failure mode
  // that let check-migrations.mjs report clean over an incomplete set.
  test('FAILS LOUDLY when its own scan stops reaching the app tree', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('seams-coverage', { fillerCount: 0 }),
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-6 instance 2] The pack-verifier half of assert-seams-wired. Split
// from the consent suite because its two halves have DIFFERENT OWNERS: a missing
// implementation is a build failure, while unpinned production keys are owner
// work (OWNER_QUEUE S-3) that must be reported and must NOT block CI.
describe('assert-seams-wired — pack verifier', () => {
  const REAL_IMPL = `
class Ed25519PackVerifier implements PackVerifier {
  Future<bool> verify({required String keyId, required List<int> message, required List<int> signature}) async {
    final String? encoded = _keys[keyId];
    if (encoded == null) return false;
    return await _ed.verify(message, signature: Signature(signature));
  }
}
`;
  const BARREL = "export 'src/content/ed25519_pack_verifier.dart';\n";
  const keysFile = (entries) =>
    `/// Long doc comment mentioning 'k1' and keys and base64 at length.\nconst Map<String, String> kContentPackPublicKeys = <String, String>{${entries}};\n`;

  const filler = (n) => {
    const out = {};
    for (let i = 0; i < n; i++) out[`apps/subly/lib/f_${i}.dart`] = '// filler\n';
    return out;
  };
  // The consent half must stay satisfied so these tests isolate the verifier.
  const consentOk = {
    'apps/subly/lib/state/analytics_providers.dart':
      "await c.record(core.ConsentPurpose.analytics,\n granted: granted,\n);\nFuture<void> recordAnalyticsConsent(\n  WidgetRef ref, {\n  required bool granted,\n}) async {}\nconst String kPrivacyPolicyVersion = '2026-07-26';\n",
    'apps/subly/lib/features/consent/consent_prompt.dart': 'recordAnalyticsConsent(ref, granted: true);',
    'sites/nikatru/privacy.html': '<p data-policy-version="2026-07-26">x</p>',
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart':
      "const String kPrivacyPolicyVersion = '2026-07-26';\n",
  };

  const build = (name, { impl = REAL_IMPL, barrel = BARREL, keys = keysFile('') } = {}) =>
    fixture(name, {
      ...filler(14),
      ...consentOk,
      'packages/core/lib/src/content/ed25519_pack_verifier.dart': impl,
      'packages/core/lib/nikatru_core.dart': barrel,
      'packages/core/lib/src/content/pack_verifier.dart': keys,
    });

  test('passes with a real impl exported, and REPORTS 0 pinned keys', () => {
    const { code, out } = run('assert-seams-wired.mjs', { cwd: build('pv-ok') });
    assert.equal(code, 0, 'unpinned production keys must NOT fail the build');
    assert.match(out, /a real PackVerifier implementation exists/);
    assert.match(out, /exported from the core barrel/);
    assert.match(out, /0 production keys pinned/);
    assert.match(out, /OWNER-GATED/);
  });

  test('FAILS when no PackVerifier implementation exists', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noimpl', { impl: '// the impl was deleted\n' }),
    });
    assert.equal(code, 1);
    assert.match(out, /declares no PackVerifier implementation/);
  });

  test('FAILS when the verifier is not exported — no app can reach it', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-noexport', { barrel: "export 'src/result.dart';\n" }),
    });
    assert.equal(code, 1);
    assert.match(out, /does not export the verifier/);
  });

  // Proves the key count is PARSED out of the map, not grepped from the prose
  // around it. The fixture's doc comment deliberately mentions 'k1' and "keys";
  // a text search would report keys that the map does not contain — the exact
  // bug that made a CORS guard match a comment explaining the absence.
  test('counts pinned keys from the MAP, not the surrounding comment', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-prose', { keys: keysFile('') }),
    });
    assert.equal(code, 0);
    assert.match(out, /0 production keys pinned/);
  });

  test('reports the real count once keys ARE pinned', () => {
    const { code, out } = run('assert-seams-wired.mjs', {
      cwd: build('pv-pinned', { keys: keysFile("'k1': 'AAAA', 'k2': 'BBBB'") }),
    });
    assert.equal(code, 0);
    assert.match(out, /2 production key\(s\) pinned/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-16] assert-stamp-properties — the rule that no chassis requirement
// lands without an assertion the STAMPED APP carries itself. The assertions live
// in the brick template (owner decision) so every app inherits them; this guard
// stops that file quietly vanishing, because vanishing looks exactly like passing.
describe('assert-stamp-properties', () => {
  const BRICK = 'tooling/bricks/app/__brick__/apps/{{app_id}}';
  const PROP = `${BRICK}/test/chassis_properties_test.dart`;
  const APP = `${BRICK}/lib/app.dart`;

  // Mirrors the real template: four declared properties and >= MIN_BLOCKS blocks.
  // A fixture thinner than the tree it stands for fails for reasons that have
  // nothing to do with the behaviour under test.
  const goodTest = `
group('property: theme-mode-persisted', () {
  test('a', () {});
  test('b', () {});
  test('c', () {});
  test('d', () {});
});
group('property: theme-triplet-supplied', () {
  testWidgets('e', (t) async {});
  test('f', () {});
  test('g', () {});
  test('h', () {});
});
group('property: analytics-consent-gated', () {
  test('i', () {});
  test('j', () {});
  test('k', () {});
});
group('property: analytics-on-switch-mounted', () {
  testWidgets('l', (t) async {});
  test('m', () {});
});
`;
  const goodApp = `
return MaterialApp.router(
  theme: buildAppTheme(),
  darkTheme: buildAppTheme(brightness: Brightness.dark),
  themeMode: ref.watch(themeModeProvider),
  builder: (c, child) => ForceUpdateGate(
    child: AnalyticsGate(child: child ?? const SizedBox.shrink()),
  ),
);
`;
  // The analytics property also checks the TEMPLATE really calls record().
  const goodProviders = `
final x = () async {
  await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
  );
};
`;
  const BRICK_PROVIDERS =
    'tooling/bricks/app/__brick__/apps/{{app_id}}/lib/state/providers.dart';

  const build = (name, { propTest = goodTest, app = goodApp, providers = goodProviders, omitProp = false } = {}) => {
    const files = { [APP]: app, [BRICK_PROVIDERS]: providers };
    if (!omitProp) files[PROP] = propTest;
    return fixture(name, files);
  };

  test('passes when both properties are asserted and implemented', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-ok') });
    assert.equal(code, 0);
    assert.match(out, /theme-mode-persisted' asserted/);
    assert.match(out, /theme-triplet-supplied' asserted and implemented/);
    assert.match(out, /analytics-consent-gated' asserted and implemented/);
    assert.match(out, /analytics-on-switch-mounted' asserted and implemented/);
  });

  test('FAILS when the inherited property test is deleted', () => {
    const { code, out } = run('assert-stamp-properties.mjs', { cwd: build('sp-missing', { omitProp: true }) });
    assert.equal(code, 1);
    assert.match(out, /is MISSING/);
  });

  // A file that still exists but has been emptied of assertions is the sneaky
  // case: "the file is there" would pass while it asserts nothing.
  test('FAILS its own coverage check when the file is gutted', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-gutted', { propTest: `test('only one', () {});` }),
    });
    assert.equal(code, 1);
    assert.match(out, /COVERAGE LOST/);
  });

  test('FAILS when a declared property stops being asserted', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-renamed', { propTest: goodTest.replace('theme-mode-persisted', 'something-else') }),
    });
    assert.equal(code, 1);
    assert.match(out, /'theme-mode-persisted' is NOT asserted/);
  });

  // The hollow-test case: the assertion is still there but the thing it asserts
  // has been deleted from the app. A test-name check alone would pass.
  test('FAILS when the assertion survives but the IMPLEMENTATION is gone', () => {
    const { code, out } = run('assert-stamp-properties.mjs', {
      cwd: build('sp-hollow', { app: 'return MaterialApp.router(theme: buildAppTheme());' }),
    });
    assert.equal(code, 1);
    assert.match(out, /IMPLEMENTATION is gone/);
  });
});
