// ─────────────────────────────────────────────────────────────────────────────
// lane-verdict.test.mjs — lane-verdict.mjs must go RED on everything but a green lane
// or a skip that detect licensed. [ADR 095]
//
// Each case runs the script exactly as a callee's lane-verdict job runs it: the
// `toJSON(needs)` object in env LANE_NEEDS. The objects are written out by hand in
// the shape GitHub renders — `{ "<job>": { "result": …, "outputs": { … } } }` — one
// per case, so that no case can be a loop variable that silently stopped varying.
//
// Run:  node --test tooling/ci/test/lane-verdict.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(CI_DIR, 'lane-verdict.mjs');

function run(needs) {
  const env = { ...process.env };
  delete env.LANE_NEEDS;
  if (needs !== undefined) env.LANE_NEEDS = typeof needs === 'string' ? needs : JSON.stringify(needs);
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
  const out = `${r.stdout}${r.stderr}`;
  assert.doesNotMatch(out, /\b(SyntaxError|ReferenceError|TypeError|ERR_MODULE_NOT_FOUND)\b/, `the script crashed rather than reporting:\n${out}`);
  return { code: r.status, out };
}

describe('lane-verdict.mjs — green only when the lane ran or was licensed to skip', () => {
  test('every need success, detect affected=true: green', () => {
    const r = run({
      detect: { result: 'success', outputs: { affected: 'true', reason: '1 changed path(s) in lane workers' } },
      'worker-subscriptiontracker-api': { result: 'success', outputs: {} },
      'worker-platform': { result: 'success', outputs: {} },
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^worker-platform=success$/m);
    assert.match(r.out, /^ok {2}lane verdict — 3 need\(s\)/m);
  });

  test('a work job that failed is red', () => {
    const r = run({
      detect: { result: 'success', outputs: { affected: 'true' } },
      'worker-subscriptiontracker-api': { result: 'success', outputs: {} },
      'worker-platform': { result: 'failure', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"worker-platform" is failure\./);
  });

  test('a work job that was cancelled is red', () => {
    const r = run({
      detect: { result: 'success', outputs: { affected: 'true' } },
      'worker-subscriptiontracker-api': { result: 'cancelled', outputs: {} },
      'worker-platform': { result: 'success', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"worker-subscriptiontracker-api" is cancelled\./);
  });

  test('both work jobs skipped under affected=false is the ONE licensed skip: green', () => {
    const r = run({
      detect: { result: 'success', outputs: { affected: 'false', reason: 'none of 1 changed path(s) is in lane workers' } },
      'worker-subscriptiontracker-api': { result: 'skipped', outputs: {} },
      'worker-platform': { result: 'skipped', outputs: {} },
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^detect\.affected=false \(none of 1 changed path/m);
  });

  test('RC7: a work job skipped although detect said affected=true is red', () => {
    const r = run({
      detect: { result: 'success', outputs: { affected: 'true' } },
      'worker-platform': { result: 'skipped', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"worker-platform" was SKIPPED although "detect" said affected=true/);
  });

  test('detect not success is red, and the skips it caused are not licensed', () => {
    const r = run({
      detect: { result: 'failure', outputs: {} },
      'worker-subscriptiontracker-api': { result: 'skipped', outputs: {} },
      'worker-platform': { result: 'skipped', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"detect" is failure, not success: the lane never decided/);
    assert.match(r.out, /"worker-platform" was skipped, and with no verdict from "detect" nothing licenses that skip/);
  });

  test('detect missing from needs is red — no skip can be licensed', () => {
    const r = run({
      'worker-subscriptiontracker-api': { result: 'skipped', outputs: {} },
      'worker-platform': { result: 'success', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"detect" is not a need of this job/);
  });

  test('detect success with an affected output that is neither true nor false is red', () => {
    const r = run({
      detect: { result: 'success', outputs: {} },
      'worker-platform': { result: 'skipped', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /its `affected` output is undefined, neither 'true' nor 'false'/);
  });

  test('a result outside the four GitHub reports is red, not ignored', () => {
    const r = run({
      detect: { result: 'success', outputs: { affected: 'true' } },
      'worker-platform': { result: 'neutral', outputs: {} },
    });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /"worker-platform" reports "neutral"/);
  });

  test('LANE_NEEDS unset is COVERAGE LOST (exit 2)', () => {
    const r = run(undefined);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — LANE_NEEDS is unset or empty/);
  });

  test('LANE_NEEDS that is not JSON is COVERAGE LOST (exit 2)', () => {
    const r = run('{detect: success');
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — LANE_NEEDS is not JSON/);
  });

  test('needs naming only detect is COVERAGE LOST (exit 2) — a verdict over no work', () => {
    const r = run({ detect: { result: 'success', outputs: { affected: 'false' } } });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /COVERAGE LOST — needs names no work job besides "detect"/);
  });
});
