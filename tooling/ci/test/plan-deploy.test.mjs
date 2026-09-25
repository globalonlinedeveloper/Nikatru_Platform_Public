// ─────────────────────────────────────────────────────────────────────────────
// plan-deploy.test.mjs — a superseded SHA never publishes, and an unreadable
// ledger publishes nothing (row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 3).
//
// THE LEDGER IS A FIXTURE, NEVER GITHUB. Every ledger read goes through an injected
// `fetchJson`, or, for the one end-to-end case, a loopback server this file starts.
// Ancestry and the diff are REAL: a throwaway git repository is built with three
// commits, so `git merge-base --is-ancestor` and `git diff` answer as they will on
// the runner. The deploy globs are the SHIPPING tooling/ci/lane-map.json `deployUnits`.
//
// Red controls (the brief's numbering):
//   RC1  ledger latest = HEAD, target = HEAD~1        → superseded, deploy=false, exit 0
//   RC1b target = latest                              → already-live, deploy=false
//   RC2  only docs/x.md changed                       → deploy=false for every unit;
//        only services/platform/src/x.ts changed      → deploy=true for platform only
//   RC3  the fixture fetch throws                     → exit 1
//   plus first-ever → first, deploy=true; and a SHALLOW clone → exit 1 (fetch-depth 0).
//
// Run:  timeout 600 node --single-threaded --test tooling/ci/test/plan-deploy.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runPlan, gitAt, decide, unitFor, matchUnit, readLatestSuccess, PlanRefusal, LEDGER_WINDOW } from '../plan-deploy.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLANNER = join(CI_DIR, 'plan-deploy.mjs');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'plan test',
  GIT_AUTHOR_EMAIL: 'plan@test.invalid',
  GIT_COMMITTER_NAME: 'plan test',
  GIT_COMMITTER_EMAIL: 'plan@test.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
};
function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
function commitFile(repo, rel, body, message) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), body);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

let TMP;
let REPO;
let C0; // README.md only
let C1; // + docs/x.md                  (touches no unit)
let C2; // + services/platform/src/x.ts (touches platform only)
const NOT_IN_HISTORY = 'f'.repeat(40);

before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-plan-'));
  REPO = join(TMP, 'repo');
  mkdirSync(REPO);
  git(REPO, 'init', '-q');
  C0 = commitFile(REPO, 'README.md', 'r\n', 'c0');
  C1 = commitFile(REPO, 'docs/x.md', 'd\n', 'c1');
  C2 = commitFile(REPO, 'services/platform/src/x.ts', 'export {};\n', 'c2');
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A ledger fixture: newest first, each Deployment with its statuses. */
function ledger(environment, deployments) {
  return async (path) => {
    if (path.startsWith('deployments?')) {
      assert.ok(path.includes(`environment=${encodeURIComponent(environment)}`), `listed the wrong environment: ${path}`);
      return deployments.map((d) => ({ id: d.id, sha: d.sha, environment, created_at: d.at }));
    }
    const m = path.match(/^deployments\/(\d+)\/statuses/);
    assert.ok(m, `unexpected ledger read ${path}`);
    return deployments.find((d) => d.id === Number(m[1])).statuses.map((state) => ({ state }));
  };
}

/** runPlan against the fixture repo; returns { code, line, logs, output }. */
async function plan(environment, target, fetchJson, extraEnv = {}) {
  const outFile = join(TMP, `out-${Math.random().toString(36).slice(2)}`);
  writeFileSync(outFile, '');
  const printed = [];
  const logs = [];
  const code = await runPlan({
    argv: [environment, '--target', target],
    env: { GITHUB_OUTPUT: outFile, ...extraEnv },
    fetchJson,
    git: gitAt(REPO),
    out: (s) => printed.push(s),
    log: (s) => logs.push(s),
  });
  return {
    code,
    line: printed.length ? JSON.parse(printed.join('')) : null,
    printedLines: printed.join('').split('\n').filter(Boolean).length,
    logs: logs.join('\n'),
    output: readFileSync(outFile, 'utf8'),
  };
}

describe('plan-deploy — the decision table', () => {
  test('RC1: the ledger\'s latest success is HEAD and the target is HEAD~1 → superseded, deploy=false, exit 0', async () => {
    const r = await plan('platform', C1, ledger('platform', [{ id: 2, sha: C2, at: '2026-09-24T10:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'superseded');
    assert.equal(r.line.deploy, false);
    assert.equal(r.line.lastSuccess, C2);
    assert.equal(r.output, 'deploy=false\ndecision=superseded\n');
    assert.match(r.logs, /decision=superseded deploy=false .*NOT publishing/);
  });

  test('RC1: a target two commits behind the live SHA is superseded too', async () => {
    const r = await plan('subscriptiontracker-web', C0, ledger('subscriptiontracker-web', [{ id: 9, sha: C2, at: '2026-09-24T10:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'superseded');
    assert.equal(r.line.deploy, false);
  });

  test('RC1b: the target IS the latest success → already-live, deploy=false', async () => {
    const r = await plan('platform', C2, ledger('platform', [{ id: 2, sha: C2, at: '2026-09-24T10:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'already-live');
    assert.equal(r.line.deploy, false);
    assert.equal(r.output, 'deploy=false\ndecision=already-live\n');
  });

  test('RC2: only docs/x.md changed → subscriptiontracker-web does not publish', async () => {
    const r = await plan('subscriptiontracker-web', C1, ledger('subscriptiontracker-web', [{ id: 1, sha: C0, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.unit, '<app>-web');
    assert.equal(r.line.decision, 'unchanged');
    assert.equal(r.line.deploy, false);
    assert.deepEqual(r.line.matched, []);
  });

  test('RC2: only docs/x.md changed → subscriptiontracker-api does not publish', async () => {
    const r = await plan('subscriptiontracker-api', C1, ledger('subscriptiontracker-api', [{ id: 1, sha: C0, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'unchanged');
    assert.equal(r.line.deploy, false);
  });

  test('RC2: only docs/x.md changed → platform does not publish', async () => {
    const r = await plan('platform', C1, ledger('platform', [{ id: 1, sha: C0, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'unchanged');
    assert.equal(r.line.deploy, false);
    assert.equal(r.output, 'deploy=false\ndecision=unchanged\n');
  });

  test('RC2: only services/platform/src/x.ts changed → platform publishes', async () => {
    const r = await plan('platform', C2, ledger('platform', [{ id: 1, sha: C1, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'changed');
    assert.equal(r.line.deploy, true);
    assert.deepEqual(r.line.matched, ['services/platform/src/x.ts']);
    assert.equal(r.line.matchedTotal, 1);
    assert.equal(r.output, 'deploy=true\ndecision=changed\n');
  });

  test('RC2: only services/platform/src/x.ts changed → subscriptiontracker-api does not publish', async () => {
    const r = await plan('subscriptiontracker-api', C2, ledger('subscriptiontracker-api', [{ id: 1, sha: C1, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'unchanged');
    assert.equal(r.line.deploy, false);
  });

  test('RC2: only services/platform/src/x.ts changed → subscriptiontracker-web does not publish', async () => {
    const r = await plan('subscriptiontracker-web', C2, ledger('subscriptiontracker-web', [{ id: 1, sha: C1, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'unchanged');
    assert.equal(r.line.deploy, false);
  });

  test('first-ever: the ledger holds no Deployment → first, deploy=true', async () => {
    const r = await plan('platform', C2, ledger('platform', []));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'first');
    assert.equal(r.line.deploy, true);
    assert.equal(r.line.lastSuccess, null);
    assert.equal(r.output, 'deploy=true\ndecision=first\n');
  });

  test('a Deployment with no success status is not the live one: the newest SUCCESS is', async () => {
    // The newest Deployment (C2) never got its success status; the live one is C0, so a C1
    // target is a real change of what is live, not a superseded one.
    const r = await plan(
      'platform',
      C1,
      ledger('platform', [
        { id: 3, sha: C2, at: '2026-09-24T11:00:00Z', statuses: [] },
        { id: 1, sha: C0, at: '2026-09-24T09:00:00Z', statuses: ['success'] },
      ]),
    );
    assert.equal(r.code, 0);
    assert.equal(r.line.lastSuccess, C0);
    assert.equal(r.line.decision, 'unchanged');
  });

  test('the ledger is ordered by created_at, not by the order GitHub\'s array arrived in', async () => {
    const r = await plan(
      'platform',
      C1,
      ledger('platform', [
        { id: 1, sha: C0, at: '2026-09-24T09:00:00Z', statuses: ['success'] },
        { id: 3, sha: C2, at: '2026-09-24T11:00:00Z', statuses: ['success'] },
      ]),
    );
    assert.equal(r.code, 0);
    assert.equal(r.line.lastSuccess, C2);
    assert.equal(r.line.decision, 'superseded');
  });

  test('a live SHA this full clone does not hold → live-not-in-history, deploy=true', async () => {
    const r = await plan('platform', C2, ledger('platform', [{ id: 5, sha: NOT_IN_HISTORY, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]));
    assert.equal(r.code, 0);
    assert.equal(r.line.decision, 'live-not-in-history');
    assert.equal(r.line.deploy, true);
  });

  test('stdout is exactly ONE JSON line', async () => {
    const r = await plan('platform', C2, ledger('platform', []));
    assert.equal(r.printedLines, 1);
    assert.deepEqual(Object.keys(r.line), ['decision', 'deploy', 'environment', 'unit', 'target', 'lastSuccess', 'matched', 'matchedTotal']);
  });
});

describe('plan-deploy — fails closed (exit 1, no deploy= written)', () => {
  test('RC3: the fixture fetch throws → exit 1', async () => {
    const r = await plan('platform', C2, async () => {
      throw new Error('GET deployments → 502 bad gateway (after 3 attempts)');
    });
    assert.equal(r.code, 1);
    assert.equal(r.line, null);
    assert.equal(r.output, '', 'a failed plan must write no deploy= output at all');
    assert.match(r.logs, /could not be read .*FAILING CLOSED/);
  });

  test('RC3: the ledger answers something that is not a list → exit 1', async () => {
    const r = await plan('platform', C2, async () => ({ message: 'Not Found' }));
    assert.equal(r.code, 1);
    assert.equal(r.output, '');
  });

  test('RC3: a statuses read that throws after the list succeeded → exit 1', async () => {
    const r = await plan('platform', C2, async (path) => {
      if (path.startsWith('deployments?')) return [{ id: 1, sha: C1, environment: 'platform', created_at: '2026-09-24T09:00:00Z' }];
      throw new Error('GET statuses → 500');
    });
    assert.equal(r.code, 1);
    assert.equal(r.output, '');
  });

  test('a full window of Deployments with no success status → exit 1, never `first`', async () => {
    const rows = [];
    for (let i = 0; i < LEDGER_WINDOW; i++) rows.push({ id: 100 + i, sha: C2, at: `2026-09-24T10:${String(i).padStart(2, '0')}:00Z`, statuses: ['failure'] });
    const r = await plan('platform', C2, ledger('platform', rows));
    assert.equal(r.code, 1);
    assert.match(r.logs, /carry no success status/);
  });

  test('a SHALLOW clone → exit 1 (the checkout lost fetch-depth: 0)', async () => {
    const shallow = join(TMP, 'shallow');
    git(TMP, 'clone', '-q', '--depth', '1', `file://${REPO}`, shallow);
    const outFile = join(TMP, 'out-shallow');
    writeFileSync(outFile, '');
    const logs = [];
    const code = await runPlan({
      argv: ['platform', '--target', C2],
      env: { GITHUB_OUTPUT: outFile },
      fetchJson: ledger('platform', [{ id: 1, sha: C1, at: '2026-09-24T09:00:00Z', statuses: ['success'] }]),
      git: gitAt(shallow),
      out: () => {},
      log: (s) => logs.push(s),
    });
    assert.equal(code, 1);
    assert.equal(readFileSync(outFile, 'utf8'), '');
    assert.match(logs.join('\n'), /SHALLOW.*fetch-depth: 0/);
  });

  test('an environment deployUnits does not name → exit 1', async () => {
    const r = await plan('nosuch-api', C2, ledger('nosuch-api', []));
    assert.equal(r.code, 1);
    assert.match(r.logs, /names no deploy unit for "nosuch-api"/);
  });

  test('a target that is not a 40-hex SHA → exit 1', async () => {
    const r = await plan('platform', 'HEAD', ledger('platform', []));
    assert.equal(r.code, 1);
  });

  test('inside Actions with no GITHUB_OUTPUT → exit 1', async () => {
    const logs = [];
    const code = await runPlan({
      argv: ['platform', '--target', C2],
      env: { GITHUB_ACTIONS: 'true' },
      fetchJson: ledger('platform', []),
      git: gitAt(REPO),
      out: () => {},
      log: (s) => logs.push(s),
    });
    assert.equal(code, 1);
    assert.match(logs.join('\n'), /GITHUB_OUTPUT is not set/);
  });

  test('the default reader refuses a non-loopback GITHUB_API_URL before any request', async () => {
    const logs = [];
    const code = await runPlan({
      argv: ['platform', '--target', C2],
      env: { GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 't', GITHUB_API_URL: 'https://example.invalid' },
      git: gitAt(REPO),
      out: () => {},
      log: (s) => logs.push(s),
    });
    assert.equal(code, 1);
    assert.match(logs.join('\n'), /neither https:\/\/api\.github\.com nor loopback/);
  });

  test('the default reader with no token → exit 1', async () => {
    const code = await runPlan({ argv: ['platform', '--target', C2], env: { GITHUB_REPOSITORY: 'o/r' }, git: gitAt(REPO), out: () => {}, log: () => {} });
    assert.equal(code, 1);
  });
});

describe('plan-deploy — the pure parts', () => {
  test('unitFor: an exact key wins; `<app>-web` matches an app\'s web environment', () => {
    const units = { '<app>-web': ['apps/**'], platform: ['services/platform/**'] };
    assert.equal(unitFor(units, 'platform').key, 'platform');
    assert.equal(unitFor(units, 'subscriptiontracker-web').key, '<app>-web');
    assert.equal(unitFor(units, 'subscriptiontracker-api'), null);
    assert.equal(unitFor(units, '-web'), null);
  });

  test('matchUnit: a glob shape globClaims cannot decide is a refusal, not "no match"', () => {
    assert.throws(() => matchUnit(['services/**/src/*.ts'], ['services/platform/src/x.ts']), PlanRefusal);
  });

  test('decide: a shallow checkout refuses before anything else is read', () => {
    const git = { isShallow: () => true, hasCommit: () => assert.fail('read after shallow'), isAncestor: () => assert.fail(), changedFiles: () => assert.fail() };
    assert.throws(() => decide({ target: C2, lastSuccess: null, globs: ['x/**'], git }), /SHALLOW/);
  });

  test('readLatestSuccess: Deployments of another environment in the answer are ignored', async () => {
    const got = await readLatestSuccess('platform', async (path) => {
      if (path.startsWith('deployments?')) return [{ id: 7, sha: C2, environment: 'subscriptiontracker-api', created_at: '2026-09-24T12:00:00Z' }];
      return assert.fail(`read statuses of a Deployment on another environment: ${path}`);
    });
    assert.equal(got, null);
  });
});

describe('plan-deploy — the CLI end to end, against a LOOPBACK ledger', () => {
  test('superseded over the real transport: one JSON line on stdout, deploy=false in GITHUB_OUTPUT, exit 0', async () => {
    const server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/repos/o/r/deployments?')) {
        res.end(JSON.stringify([{ id: 11, sha: C2, environment: 'platform', created_at: '2026-09-24T10:00:00Z' }]));
      } else if (req.url.startsWith('/repos/o/r/deployments/11/statuses')) {
        res.end(JSON.stringify([{ state: 'success' }]));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const outFile = join(TMP, 'out-cli');
    writeFileSync(outFile, '');
    try {
      const child = spawn(process.execPath, [PLANNER, 'platform', '--target', C1], {
        cwd: REPO,
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'fixture', GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: '' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      const code = await new Promise((r) => child.on('close', r));
      assert.equal(code, 0, stderr);
      const lines = stdout.split('\n').filter(Boolean);
      assert.equal(lines.length, 1, stdout);
      assert.equal(JSON.parse(lines[0]).decision, 'superseded');
      assert.equal(readFileSync(outFile, 'utf8'), 'deploy=false\ndecision=superseded\n');
      assert.match(stderr, /decision=superseded/);
    } finally {
      server.close();
    }
  });

  test('a 403 that is not a rate limit is a REAL answer → exit 1, nothing written', async () => {
    const server = createServer((req, res) => {
      res.statusCode = 403;
      res.end(JSON.stringify({ message: 'Resource not accessible by integration' }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const outFile = join(TMP, 'out-cli-403');
    writeFileSync(outFile, '');
    try {
      const child = spawn(process.execPath, [PLANNER, 'platform', '--target', C2], {
        cwd: REPO,
        env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'fixture', GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: '' },
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      const code = await new Promise((r) => child.on('close', r));
      assert.equal(code, 1, stderr);
      assert.equal(readFileSync(outFile, 'utf8'), '');
      assert.match(stderr, /FAILING CLOSED/);
    } finally {
      server.close();
    }
  });
});
