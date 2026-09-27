// ─────────────────────────────────────────────────────────────────────────────
// worker-set.test.mjs — tooling/ci/worker-set.mjs, the reader lane-workers.yml's
// `worker` matrix is built from, must name every Worker directory, must never
// name services/_shared, and must REFUSE rather than print an empty or partial
// set.
//
// RC4 and RC5 of O-CI-AND-WORKER-LANES-NAME-ONE-APP (the ci.yml half) are the
// two `RC` cases below. The real tree is read first: the set it prints is the
// set the lane iterates.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { workerSet, SERVICES_DIR, SHARED_DIR, WORKER_CONFIG } from '../worker-set.mjs';
import { parseWorkflow } from '../workflow-scan.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CI_DIR, '..', '..');
const CLI = join(CI_DIR, 'worker-set.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-workerset-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

let seq = 0;
/** A root whose services/ holds `dirs`: `{ name: [file, …] }`. `null` builds no services/ at all. */
function root(dirs) {
  const r = join(TMP, `r${seq++}`);
  mkdirSync(r, { recursive: true });
  if (dirs === null) return r;
  mkdirSync(join(r, SERVICES_DIR), { recursive: true });
  for (const [name, files] of Object.entries(dirs)) {
    mkdirSync(join(r, SERVICES_DIR, name), { recursive: true });
    for (const f of files) writeFileSync(join(r, SERVICES_DIR, name, f), '{}\n');
  }
  return r;
}
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout.trim(), out: `${r.stdout}${r.stderr}` };
};

describe('worker-set.mjs — the reader', () => {
  test('the real tree: every Worker holds its config, _shared is not one, and --emit agrees with the module', () => {
    const set = workerSet(REPO);
    assert.ok(set !== null && set.workers.length >= 1, `the real services/ yielded ${JSON.stringify(set)}`);
    assert.deepEqual(set.strays, [], `the real services/ holds a directory that is neither _shared nor a Worker: ${set.strays.join(', ')}`);
    assert.ok(!set.workers.includes(SHARED_DIR), `${SHARED_DIR} was read as a Worker`);
    for (const w of set.workers) assert.ok(existsSync(join(REPO, SERVICES_DIR, w, WORKER_CONFIG)), `${w} has no ${WORKER_CONFIG}`);
    const r = cli('--emit', REPO);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), set.workers);
  });

  test('RC4 · a Worker directory added under services/ is in the set, and _shared never is — not even holding a config', () => {
    const r = cli('--emit', root({
      _shared: ['package.json', WORKER_CONFIG],
      platform: ['package.json', WORKER_CONFIG],
      'zzz-api': [WORKER_CONFIG],
    }));
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(JSON.parse(r.stdout), ['platform', 'zzz-api']);
  });

  test('the set is sorted, so the matrix order is the same on every checkout', () => {
    const set = workerSet(root({ 'zzz-api': [WORKER_CONFIG], 'aaa-api': [WORKER_CONFIG], platform: [WORKER_CONFIG] }));
    assert.deepEqual(set.workers, ['aaa-api', 'platform', 'zzz-api']);
  });

  test('without --emit it prints one name per line', () => {
    const r = cli(root({ platform: [WORKER_CONFIG], 'zzz-api': [WORKER_CONFIG] }));
    assert.equal(r.code, 0, r.out);
    assert.equal(r.stdout, 'platform\nzzz-api');
  });

  test('a file under services/ and a hidden directory are not Workers and not strays', () => {
    const r = root({ platform: [WORKER_CONFIG], '.wrangler': ['state.json'] });
    writeFileSync(join(r, SERVICES_DIR, 'README.md'), '# services\n');
    assert.deepEqual(workerSet(r), { workers: ['platform'], strays: [] });
  });
});

describe('worker-set.mjs — it refuses rather than printing a partial or empty set', () => {
  test('RC5 · services/ with no Worker directory is COVERAGE LOST (exit 2)', () => {
    const r = cli('--emit', root({ _shared: ['package.json'] }));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — .*holds no directory with a wrangler\.jsonc/);
    assert.equal(r.stdout, '', 'a refusal must print no set a workflow could read as the matrix');
  });

  test('no services/ directory at all is COVERAGE LOST (exit 2)', () => {
    const r = cli('--emit', root(null));
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — .*does not exist, so no Worker directory was read/);
  });

  test('a Worker whose config moved is a finding (exit 1) naming it, not a quieter matrix', () => {
    const r = cli('--emit', root({ platform: [WORKER_CONFIG], 'zzz-api': ['wrangler.toml', 'package.json'] }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /services\/zzz-api is neither services\/_shared nor a Worker \(no wrangler\.jsonc\)/);
    assert.equal(r.stdout, '');
  });

  test('an unknown flag is refused, never read as the root', () => {
    const r = cli('--bogus', REPO);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /unknown flag --bogus/);
  });
});

// ⏱ 2026-09-26 — O-SERVICE-KIT-UNBUILT (E-a1): `--for-deploy`. RC1 and RC2 are the
// design's controls; every tree here is a real git checkout in os.tmpdir(), because
// "the lockfile is tracked" is a question only the index answers.
describe('worker-set.mjs --for-deploy — the register, the committed lockfile and the crash-sink secret', () => {
  const HEALTH = [{ method: 'GET', path: '/v1/health' }];
  /** A register row for services/<dir>, the shape tooling/platform-register.json's rows have. */
  const row = (dir, extra = {}) => ({
    name: dir,
    config: `services/${dir}/wrangler.jsonc`,
    hosts: [`${dir}.example.test`],
    dsnSecret: 'GLITCHTIP_DSN',
    routes: HEALTH,
    ...extra,
  });
  const register = (edit = (r) => r) =>
    edit({ servingWorker: { ...row('platform'), routes: undefined }, routes: HEALTH, appWorkers: [row('zzz-api')] });
  const cfg = (migrated) =>
    `{\n  // a JSONC comment, as the real configs carry\n  "name": "w",\n  "main": "src/index.ts",\n  "d1_databases": [\n${migrated
      .map((b) => `    { "binding": "${b}", "database_name": "d", "database_id": "0", "migrations_dir": "migrations" },\n`)
      .join('')}    { "binding": "SHARED_DB", "database_name": "s", "database_id": "0" }\n  ],\n}\n`;
  /** A git checkout holding `workers` ({ dir: { migrated, lock, lockName, track } }) and the register. */
  function deployTree({ workers, reg = register(), withRegister = true, git = true } = {}) {
    const ws = workers ?? { platform: { migrated: ['PLATFORM_DB'] }, 'zzz-api': { migrated: ['APP_DB'] } };
    const r = root({});
    const late = [];
    for (const [dir, w] of Object.entries(ws)) {
      const d = join(r, SERVICES_DIR, dir);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, WORKER_CONFIG), cfg(w.migrated ?? []));
      writeFileSync(join(d, 'package.json'), JSON.stringify({ name: dir, private: true }));
      const lock = JSON.stringify({ name: w.lockName ?? dir, lockfileVersion: 3, packages: { '': { name: w.lockName ?? dir } } });
      if (w.lock === false) continue;
      if (w.track === false) late.push([join(d, 'package-lock.json'), lock]);
      else writeFileSync(join(d, 'package-lock.json'), lock);
    }
    if (withRegister) {
      mkdirSync(join(r, 'tooling'), { recursive: true });
      writeFileSync(join(r, 'tooling', 'platform-register.json'), JSON.stringify(reg, null, 2));
    }
    if (git) {
      assert.equal(spawnSync('git', ['-C', r, 'init', '-q'], { encoding: 'utf8' }).status, 0, 'git init failed');
      assert.equal(spawnSync('git', ['-C', r, 'add', '-A'], { encoding: 'utf8' }).status, 0, 'git add failed');
    }
    for (const [p, text] of late) writeFileSync(p, text);
    return r;
  }

  test('the real tree: every Worker holds, and --json names the same set --emit prints', () => {
    const j = cli('--for-deploy', '--json', REPO);
    assert.equal(j.code, 0, j.out);
    const e = cli('--emit', REPO);
    const entries = JSON.parse(j.stdout);
    assert.deepEqual(entries.map((x) => x.dir), JSON.parse(e.stdout).map((w) => `${SERVICES_DIR}/${w}`));
    for (const x of entries) {
      assert.match(x.smokeUrl, /^https:\/\/[a-z0-9.-]+\/(?:[^\s]*\/)?health$/, `${x.dir} smokeUrl`);
      assert.ok(typeof x.dsnSecret === 'string' && x.dsnSecret !== '', `${x.dir} dsnSecret`);
    }
  });

  test('a tree that holds prints each Worker with what a deploy step reads, and --emit prints the names', () => {
    const r = deployTree();
    const j = cli('--for-deploy', '--json', r);
    assert.equal(j.code, 0, j.out);
    assert.deepEqual(JSON.parse(j.stdout), [
      { worker: 'platform', dir: 'services/platform', migrations: 'PLATFORM_DB', smokeUrl: 'https://platform.example.test/v1/health', dsnSecret: 'GLITCHTIP_DSN' },
      { worker: 'zzz-api', dir: 'services/zzz-api', migrations: 'APP_DB', smokeUrl: 'https://zzz-api.example.test/v1/health', dsnSecret: 'GLITCHTIP_DSN' },
    ]);
    const e = cli('--for-deploy', '--emit', r);
    assert.equal(e.code, 0, e.out);
    assert.deepEqual(JSON.parse(e.stdout), ['platform', 'zzz-api']);
  });

  test('a Worker whose config migrates nothing deploys with `migrations: null`, never a guessed binding', () => {
    const r = deployTree({ workers: { platform: { migrated: ['PLATFORM_DB'] }, 'zzz-api': { migrated: [] } } });
    const j = cli('--for-deploy', '--json', r);
    assert.equal(j.code, 0, j.out);
    assert.equal(JSON.parse(j.stdout)[1].migrations, null);
  });

  test('RC1 · a Worker with no lockfile fails (exit 1), naming it, and prints no set', () => {
    const r = deployTree({ workers: { platform: { migrated: ['PLATFORM_DB'] }, 'zzz-api': { migrated: ['APP_DB'], lock: false } } });
    const j = cli('--for-deploy', '--emit', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /services\/zzz-api has no package-lock\.json/);
    assert.equal(j.stdout, '');
  });

  test('RC2 · a Worker with its lockfile and no register row fails (exit 1), naming it', () => {
    const r = deployTree({ reg: register((g) => ({ ...g, appWorkers: [] })) });
    const j = cli('--for-deploy', '--emit', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /services\/zzz-api holds a wrangler\.jsonc and tooling\/platform-register\.json has no row for it/);
  });

  test('a lockfile on disk that git does not track fails — the lane checks out the index, not the disk', () => {
    const r = deployTree({ workers: { platform: { migrated: ['PLATFORM_DB'] }, 'zzz-api': { migrated: ['APP_DB'], track: false } } });
    const j = cli('--for-deploy', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /services\/zzz-api\/package-lock\.json is on disk and NOT tracked by git/);
  });

  test("a lockfile copied from another Worker fails: its root name is not this package's", () => {
    const r = deployTree({ workers: { platform: { migrated: ['PLATFORM_DB'] }, 'zzz-api': { migrated: ['APP_DB'], lockName: 'platform' } } });
    const j = cli('--for-deploy', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /services\/zzz-api\/package-lock\.json is the lockfile of "platform" and services\/zzz-api\/package\.json is "zzz-api"/);
  });

  test('a register row naming a directory the tree does not hold fails — the other direction', () => {
    const r = deployTree({ reg: register((g) => ({ ...g, appWorkers: [...g.appWorkers, row('ghost-api')] })) });
    const j = cli('--for-deploy', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /appWorkers\[1\] \(ghost-api\) names services\/ghost-api, which is not a Worker directory on this tree/);
  });

  test('a row with no `dsnSecret` fails, naming the row', () => {
    const r = deployTree({ reg: register((g) => ({ ...g, appWorkers: [row('zzz-api', { dsnSecret: undefined })] })) });
    const j = cli('--for-deploy', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /appWorkers\[0\] \(services\/zzz-api\) declares no `dsnSecret`/);
  });

  test('a row with no GET …/health route gives no smoke URL, and fails', () => {
    const r = deployTree({ reg: register((g) => ({ ...g, appWorkers: [row('zzz-api', { routes: [{ method: 'POST', path: '/v1/health' }] })] })) });
    const j = cli('--for-deploy', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /appWorkers\[0\] \(services\/zzz-api\) gives no smoke URL: it declares no GET …\/health route/);
  });

  test('a config that migrates two D1 bindings fails rather than picking one', () => {
    const r = deployTree({ workers: { platform: { migrated: ['PLATFORM_DB'] }, 'zzz-api': { migrated: ['APP_DB', 'OTHER_DB'] } } });
    const j = cli('--for-deploy', r);
    assert.equal(j.code, 1, j.out);
    assert.match(j.out, /services\/zzz-api\/wrangler\.jsonc migrates 2 D1 bindings \(APP_DB, OTHER_DB\)/);
  });

  test('COVERAGE LOST — no register to hold the set to', () => {
    const j = cli('--for-deploy', deployTree({ withRegister: false }));
    assert.equal(j.code, 2, j.out);
    assert.match(j.out, /COVERAGE LOST — tooling\/platform-register\.json is missing, is not JSON/);
  });

  test('COVERAGE LOST — a tree that is not a git checkout cannot say whether a lockfile is committed', () => {
    const j = cli('--for-deploy', deployTree({ git: false }));
    assert.equal(j.code, 2, j.out);
    assert.match(j.out, /COVERAGE LOST — git could not say whether services\/platform\/package-lock\.json is tracked/);
  });

  test('--json without --for-deploy, and --emit with --json, are refused', () => {
    const a = cli('--json', REPO);
    assert.equal(a.code, 1, a.out);
    assert.match(a.out, /--json prints what --for-deploy checked, and --for-deploy was not given/);
    const b = cli('--for-deploy', '--emit', '--json', REPO);
    assert.equal(b.code, 1, b.out);
    assert.match(b.out, /--emit and --json print two different shapes/);
  });

  test("the Workers lane reads its set through --for-deploy, so the lockfile rule gates its npm ci", () => {
    const wf = parseWorkflow(REPO, '.github/workflows/lane-workers.yml');
    assert.ok(wf && wf.jobs.has('detect'), 'lane-workers.yml has no detect job');
    const calls = wf.jobs.get('detect').logical.filter((l) => /tooling\/ci\/worker-set\.mjs/.test(l.text));
    assert.equal(calls.length, 1, `detect runs worker-set.mjs ${calls.length} time(s)`);
    assert.match(calls[0].text, /worker-set\.mjs --for-deploy --emit\b/);
  });
});
