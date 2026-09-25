// ───────────────────────────────────────────────────────────
// deploy-ref.test.mjs — assert-deploy-ref.mjs lets a publishing job run from the ref
// its trigger allows and from nothing else (row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 2).
//
// Every case spawns the REAL script with a made-up GITHUB_EVENT_NAME / GITHUB_REF, so
// the exit code the workflow step would see is the thing asserted. Nothing here reads
// the network or the tree.
//
// Red control (the brief's numbering):
//   RC10  --allow main, GITHUB_REF=refs/heads/fix-x   → exit 1
//
// Run:  timeout 600 node --single-threaded --test tooling/ci/test/deploy-ref.test.mjs
// ───────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllow, decide, DeployRefUsage } from '../assert-deploy-ref.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(CI_DIR, 'assert-deploy-ref.mjs');

/** The script as a workflow step runs it. `vars` replaces the two GITHUB_ variables whole. */
function check(args, vars) {
  const env = { ...process.env };
  delete env.GITHUB_EVENT_NAME;
  delete env.GITHUB_REF;
  Object.assign(env, vars);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.error, undefined, `spawn failed: ${r.error}`);
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const TAG = 'tag:fullshot-v[0-9]+.[0-9]+.[0-9]+';

describe('assert-deploy-ref: --allow main', () => {
  test('a push to main passes', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /ok — push, refs\/heads\/main is main/);
  });

  test('a dispatch from main passes', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 0, r.err);
  });

  test('RC10: a dispatch from refs/heads/fix-x is refused, exit 1', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/fix-x' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /refs\/heads\/fix-x is not refs\/heads\/main/);
    assert.match(r.err, /Nothing publishes from this run/);
  });

  test('a branch whose name merely ends in main is refused', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/not-main' });
    assert.equal(r.code, 1, r.out);
  });

  test('a TAG named main is refused: main means the branch', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/tags/main' });
    assert.equal(r.code, 1, r.out);
  });

  test('a pull request merge ref is refused', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/pull/7/merge' });
    assert.equal(r.code, 1, r.out);
  });

  test('a schedule on main is refused by the event, named', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'schedule', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /the event is "schedule"; only push and workflow_dispatch may publish/);
  });

  test('a pull_request_target on main is refused by the event', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /"pull_request_target"/);
  });
});

describe('assert-deploy-ref: --allow tag:<filter>', () => {
  test('a release tag the filter matches passes', () => {
    const r = check(['--allow', TAG], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/tags/fullshot-v1.2.3' });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /matches tag:fullshot-v\[0-9\]\+/);
  });

  test('a tag the filter does not match is refused', () => {
    const r = check(['--allow', TAG], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/tags/fullshot-v1.2.3-rc1' });
    assert.equal(r.code, 1, r.out);
  });

  test('a BRANCH with the tag\'s name is refused: tag: means refs/tags/', () => {
    const r = check(['--allow', TAG], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/fullshot-v1.2.3' });
    assert.equal(r.code, 1, r.out);
  });

  test('main is refused when only a tag is allowed', () => {
    const r = check(['--allow', TAG], { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 1, r.out);
  });

  test('two --allow values: the second one allows', () => {
    const r = check(['--allow', TAG, '--allow=tag:fullshot-v[0-9]+.[0-9]+.[0-9]+.[0-9]+'], {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/tags/fullshot-v1.2.3.4',
    });
    assert.equal(r.code, 0, r.err);
  });
});

describe('assert-deploy-ref: what is not a verdict exits 2', () => {
  test('no --allow at all', () => {
    const r = check([], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /REFUSED — no --allow given/);
  });

  test('--allow with no value', () => {
    const r = check(['--allow'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 2, r.out);
  });

  test('an --allow value that is neither main nor tag:', () => {
    const r = check(['--allow', 'refs/heads/main'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /expected main, or tag:<filter>/);
  });

  test('a negative tag filter allows nothing, so it is refused', () => {
    const r = check(['--allow', 'tag:!fullshot-v*'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/x' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /negative tag filter/);
  });

  test('a tag filter the GitHub reading cannot read is refused, never guessed', () => {
    const r = check(['--allow', 'tag:v[0-9'], { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /never closes it/);
  });

  test('GITHUB_REF unset', () => {
    const r = check(['--allow', 'main'], { GITHUB_EVENT_NAME: 'push' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /GITHUB_REF is not set/);
  });

  test('GITHUB_EVENT_NAME unset', () => {
    const r = check(['--allow', 'main'], { GITHUB_REF: 'refs/heads/main' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.err, /GITHUB_EVENT_NAME is not set/);
  });
});

describe('assert-deploy-ref: the exported reading', () => {
  test('parseAllow reads main and a tag filter, in order', () => {
    const allow = parseAllow(['--allow', 'main', '--allow', TAG]);
    assert.equal(allow.length, 2);
    assert.equal(allow[0].kind, 'main');
    assert.equal(allow[1].kind, 'tag');
    assert.equal(allow[1].re.test('fullshot-v10.0.1'), true);
    assert.equal(allow[1].re.test('fullshot-v10.0'), false);
  });

  test('parseAllow throws the usage class, not a verdict', () => {
    assert.throws(() => parseAllow(['--nope']), DeployRefUsage);
  });

  test('decide refuses workflow_run by name even on main', () => {
    const v = decide(parseAllow(['--allow', 'main']), 'workflow_run', 'refs/heads/main');
    assert.equal(v.ok, false);
    assert.match(v.why, /"workflow_run"/);
  });
});
