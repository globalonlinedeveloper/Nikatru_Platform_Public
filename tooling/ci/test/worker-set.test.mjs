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
