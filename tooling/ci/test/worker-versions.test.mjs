// ─────────────────────────────────────────────────────────────────────────────
// worker-versions.test.mjs — tooling/ops/check-worker-versions.mjs must be able
// to go RED when a live Worker serves a build its ledger does not name as
// newest, and must say "could not look" (2) rather than green when it could not.
//
// PB-06, row O-LIVE-DUTY-RED-BLOCKS-THE-FIX-DEPLOY. No case reaches the network:
// every read is injected, or answered from tooling/ops/fixtures/worker-versions.
//
// Run:  node --test tooling/ci/test/worker-versions.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  recordedUnits,
  deriveUnits,
  judgeUnit,
  activeVersionOf,
  fold,
  fixtureReaders,
  liveReaders,
  run,
  DEPLOY_WORKERS_REL,
} from '../../ops/check-worker-versions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(REPO, 'tooling', 'ops', 'check-worker-versions.mjs');
const FIXTURES = join(REPO, 'tooling', 'ops', 'fixtures', 'worker-versions');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

describe('the unit set is DERIVED from deploy-workers.yml', () => {
  test('the real tree derives platform, every app Worker and the shield, with no problem', () => {
    const { units, problems } = deriveUnits(REPO);
    assert.deepEqual(problems, []);
    const names = units.map((u) => u.unit);
    assert.ok(names.includes('platform'));
    assert.ok(names.includes('edge-shield'));
    assert.ok(units.some((u) => u.how === 'health' && u.unit !== 'platform'), 'at least one app Worker');
    assert.equal(units.find((u) => u.unit === 'platform').health, 'https://platform.nikatru.com/v1/health');
  });

  test('the matrix line expands; a literal unit is read with its url', () => {
    const r = recordedUnits('run: node tooling/ci/record-deployment.mjs ${{ matrix.worker.worker }} ${{ matrix.worker.origin }}\nrun: node tooling/ci/record-deployment.mjs platform https://p.example');
    assert.deepEqual(r.map((x) => x.matrix), [true, false]);
    assert.equal(r[1].url, 'https://p.example');
  });

  test('a recorded unit nobody can read is COVERAGE LOST, never skipped', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wv-'));
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(root, 'services', 'edge-shield'), { recursive: true });
      writeFileSync(join(root, 'services', 'edge-shield', 'wrangler.jsonc'), '{ "name": "edge-shield" }');
      writeFileSync(join(root, DEPLOY_WORKERS_REL), 'run: node tooling/ci/record-deployment.mjs mystery https://m.example\n');
      const { code, lines } = await run({ root, readers: fixtureReaders({}), matrix: () => ({ entries: [], lost: null }) });
      assert.equal(code, 2);
      assert.match(lines.join('\n'), /mystery .*neither/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a deploy lane that records nothing is COVERAGE LOST, not a clean sweep', () => {
    const root = mkdtempSync(join(tmpdir(), 'wv-'));
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(root, DEPLOY_WORKERS_REL), 'jobs: {}\n');
      const { units, problems } = deriveUnits(root, { matrix: () => ({ entries: [], lost: null }) });
      assert.equal(units.length, 0);
      assert.ok(problems.some((p) => /records no Worker unit/.test(p)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('judgeUnit', () => {
  const u = { unit: 'platform', how: 'health' };
  test('green: the live build is the newest record', () => {
    assert.equal(judgeUnit(u, { id: 1, sha: A }, { build: A }).code, 0);
  });
  test('RED: the live build is another commit', () => {
    const r = judgeUnit(u, { id: 1, sha: A }, { build: B });
    assert.equal(r.code, 1);
    assert.match(r.line, /NOT the ledger's newest record/);
  });
  test('an empty ledger, or a build that is not a commit, is COVERAGE LOST', () => {
    assert.equal(judgeUnit(u, null, { build: A }).code, 2);
    assert.equal(judgeUnit(u, { sha: A }, { build: 'dev' }).code, 2);
  });
  test('the shield by version id: equal is green, different is red, unrecorded is 2', () => {
    const s = { unit: 'edge-shield', how: 'shield' };
    assert.equal(judgeUnit(s, { sha: A, payload: { worker_version_id: 'v1' } }, { versionId: 'v1' }).code, 0);
    assert.equal(judgeUnit(s, { sha: A, payload: { worker_version_id: 'v1' } }, { versionId: 'v2' }).code, 1);
    assert.equal(judgeUnit(s, { sha: A, payload: { worker_version_id: null } }, { versionId: 'v2' }).code, 2);
  });
  test('2 beats 1 beats 0', () => {
    assert.equal(fold([{ code: 0 }, { code: 1 }]), 1);
    assert.equal(fold([{ code: 1 }, { code: 2 }, { code: 0 }]), 2);
    assert.equal(fold([{ code: 0 }]), 0);
  });
});

describe('the Cloudflare active version', () => {
  test('the newest deployment at 100% is the active version', () => {
    const body = {
      result: {
        deployments: [
          { created_on: '2026-09-01T00:00:00Z', versions: [{ version_id: 'old', percentage: 100 }] },
          { created_on: '2026-09-30T00:00:00Z', versions: [{ version_id: 'new', percentage: 100 }] },
        ],
      },
    };
    assert.equal(activeVersionOf(body), 'new');
  });
  test('a split rollout, or no deployment, is no single version', () => {
    assert.equal(activeVersionOf({ result: { deployments: [{ versions: [{ version_id: 'a', percentage: 50 }, { version_id: 'b', percentage: 50 }] }] } }), null);
    assert.equal(activeVersionOf({ result: { deployments: [] } }), null);
  });
  test('no Cloudflare token is COULD NOT LOOK, never a pass', async () => {
    const r = liveReaders({ fetchImpl: async () => assert.fail('no request without a token'), env: {} });
    await assert.rejects(() => r.cloudflare('edge-shield'), /CLOUDFLARE_API_TOKEN/);
  });
  test('a shield header that carries a commit is graded like a build, and the API is not asked', async () => {
    const readers = {
      ...fixtureReaders({ ledger: { platform: { sha: A }, 'edge-shield': { sha: B, payload: {} } }, health: { platform: A } }),
      shieldHeader: async () => B,
      cloudflare: async () => assert.fail('the header answered; the API must not be read'),
    };
    const root = mkdtempSync(join(tmpdir(), 'wv-'));
    try {
      mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(root, 'services', 'edge-shield'), { recursive: true });
      writeFileSync(join(root, 'services', 'edge-shield', 'wrangler.jsonc'), '{ "name": "edge-shield" }');
      writeFileSync(
        join(root, DEPLOY_WORKERS_REL),
        'run: node tooling/ci/record-deployment.mjs platform https://platform.example\nrun: node tooling/ci/record-deployment.mjs edge-shield https://s.example\n',
      );
      const { code } = await run({ root, readers, matrix: () => ({ entries: [], lost: null }) });
      assert.equal(code, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the ledger read', () => {
  test('the newest Deployment of the environment, with its payload parsed', async () => {
    const seen = [];
    const fetchImpl = async (url) => {
      seen.push(url);
      return { status: 200, json: async () => [{ id: 7, sha: A, payload: JSON.stringify({ worker_version_id: 'v' }) }] };
    };
    const rec = await liveReaders({ fetchImpl, env: { GITHUB_REPOSITORY: 'o/r' } }).ledger('platform');
    assert.equal(rec.sha, A);
    assert.equal(rec.payload.worker_version_id, 'v');
    assert.match(seen[0], /repos\/o\/r\/deployments\?environment=platform&per_page=1$/);
  });
  test('a non-200 ledger answer is COULD NOT LOOK', async () => {
    const fetchImpl = async () => ({ status: 404, json: async () => ({}) });
    await assert.rejects(() => liveReaders({ fetchImpl, env: {} }).ledger('platform'), /HTTP 404/);
  });
});

describe('the CLI, against the real tree (the red control)', () => {
  const cli = (fixture) => spawnSync(process.execPath, [SCRIPT, '--fixture', join(FIXTURES, fixture)], { encoding: 'utf8' });
  test('GREEN control: every Worker serves its newest record → exit 0', () => {
    const r = cli('green.json');
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
  test('RED control: a ledger SHA differing from the live build → exit 1', () => {
    const r = cli('drift.json');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /platform — live build ffffffffffff is NOT/);
  });
  test('a fixture missing a unit is COVERAGE LOST → exit 2', () => {
    const fx = JSON.parse(readFileSync(join(FIXTURES, 'green.json'), 'utf8'));
    delete fx.health.platform;
    const dir = mkdtempSync(join(tmpdir(), 'wv-'));
    try {
      writeFileSync(join(dir, 'fx.json'), JSON.stringify(fx));
      const r = spawnSync(process.execPath, [SCRIPT, '--fixture', join(dir, 'fx.json')], { encoding: 'utf8' });
      assert.equal(r.status, 2, r.stdout + r.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
