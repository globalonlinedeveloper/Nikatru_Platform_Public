// ─────────────────────────────────────────────────────────────────────────────
// post-deploy-smoke.test.mjs — tooling/ops/post-deploy-smoke.mjs must be able to
// FAIL, and must fail for the right reason on each of its branches.
//
// [pipeline 14]O-7. The requirement is "a deploy is not trusted until the live
// surface answers at the SHA just shipped", and the state it replaces is the one
// where the LAST STEP OF EVERY DEPLOY JOB WROTE A CLAIM and nothing ever read
// one. A smoke that cannot go red would reproduce that exactly, one layer down.
//
// The decision is exercised as a PURE FUNCTION (`judge`) so every branch is
// reachable without a network, plus end-to-end runs through the fixture mode so
// the argument handling and the exit codes are exercised too — the off-by-one in
// `flag()` is the failure mode that actually shipped once, in
// assert-gate-passed.mjs, and blocked both production deploys.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { judge, judgeOk, flag } from '../../ops/post-deploy-smoke.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ops', 'post-deploy-smoke.mjs');

let TMP;
let seq = 0;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-smoke-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** Runs the real script against canned responses, so the exit codes and the
 *  argument handling are exercised rather than only the decision. */
function run(responses, args) {
  const f = join(TMP, `fx-${(seq += 1)}.json`);
  writeFileSync(f, JSON.stringify(responses));
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--fixture', f], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const WEB = ['--url', 'https://subly.nikatru.com/version.json', '--field', 'build_number', '--expect', '482'];
const API = ['--url', 'https://api.nikatru.com/v1/health', '--field', 'build', '--expect', 'abc123', '--require-ok'];

describe('post-deploy-smoke — the decision', () => {
  test('PASSES when the live surface reports the expected build', () => {
    const v = judge({ status: 200, body: '{"build_number":482}', field: 'build_number', expected: '482' });
    assert.equal(v.ok, true);
  });

  test('a NUMBER and its STRING are the same build', () => {
    // `482 !== '482'` would fail a perfectly good deploy — the kind of red that
    // gets a check deleted rather than fixed.
    assert.equal(judge({ status: 200, body: '{"build_number":"482"}', field: 'build_number', expected: 482 }).ok, true);
  });

  test('🔴 FAILS on a build that is not the one just shipped, and RETRIES', () => {
    // Indistinguishable from a CDN still serving the previous asset, which is
    // why it is retryable — and why it is never a pass.
    const v = judge({ status: 200, body: '{"build_number":481}', field: 'build_number', expected: '482' });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true);
    assert.match(v.reason, /still serving a different build/);
  });

  test('🔴 FAILS on a non-200', () => {
    const v = judge({ status: 502, body: '', field: 'build', expected: 'abc' });
    assert.equal(v.ok, false);
    assert.match(v.reason, /HTTP 502/);
  });

  test('🔴 a 200 carrying an SPA shell is a MISSING asset, not a slow one', () => {
    // Pages answers an unknown path with index.html. Retrying that for a minute
    // would turn a real failure into a slow real failure.
    const v = judge({ status: 200, body: '<!DOCTYPE html><html>', field: 'build_number', expected: '482' });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false);
    assert.match(v.reason, /not JSON/);
  });

  test('🔴 FAILS when the field is absent — names the keys, and RETRIES', () => {
    const v = judge({ status: 200, body: '{"version":"v1"}', field: 'build', expected: 'abc' });
    assert.equal(v.ok, false);
    // Retryable: a surface still serving the PREVIOUS build answers in that
    // build's shape, so a field the deploy INTRODUCES is absent until it lands.
    assert.equal(v.retry, true);
    assert.match(v.reason, /has no `build` field/);
    assert.match(v.reason, /version/);
  });

  test('🔴 FAILS when the field is present and EMPTY — and RETRIES', () => {
    // ── REGRESSION TEST FOR A MEASURED FALSE RED (2026-08-04) ────────────────
    // `retry` was FALSE here, so the platform deploy on run 30934945633 failed
    // in 240ms — one attempt against an advertised ceiling of six — and 80s
    // later the same URL served the SHA that deploy had shipped. An empty
    // `build` is what the OLD version answers, because the version still being
    // served is the one deployed without `--var RELEASE`. It is the propagating
    // state, not the failed one, and only the ceiling can tell them apart.
    for (const body of ['{"build":null}', '{"build":""}']) {
      const v = judge({ status: 200, body, field: 'build', expected: 'abc' });
      assert.equal(v.ok, false);
      assert.equal(v.retry, true, `empty \`build\` must be retryable, got retry=false for ${body}`);
      assert.match(v.reason, /did not thread a build identity/);
    }
  });

  test('🔴 a JSON body that is not an object is refused', () => {
    assert.equal(judge({ status: 200, body: '"just a string"', field: 'build', expected: 'abc' }).ok, false);
    assert.equal(judge({ status: 200, body: 'null', field: 'build', expected: 'abc' }).ok, false);
  });

  test('judgeOk is a SEPARATE conjunct from the build match', () => {
    // A Worker serving the right build with ok:false has deployed AND is
    // unwell; collapsing the two reports a bad deploy as a good one.
    assert.equal(judgeOk('{"ok":true}'), true);
    assert.equal(judgeOk('{"ok":false}'), false);
    assert.equal(judgeOk('{"okay":true}'), false);
    assert.equal(judgeOk('not json'), false);
  });

  test('flag() never selects argv[0] for an absent flag', () => {
    // The exact off-by-one that shipped in assert-gate-passed.mjs and blocked
    // both production deploys.
    assert.equal(flag(['node', 'x.mjs', '--url', 'u'], '--field'), null);
    assert.equal(flag(['node', 'x.mjs', '--url', 'u'], '--url'), 'u');
    assert.equal(flag(['node', 'x.mjs', '--url'], '--url'), null);
  });
});

describe('post-deploy-smoke — end to end, through the real script', () => {
  test('exit 0 and says which build it saw', () => {
    const r = run([{ status: 200, body: '{"build_number":482}' }], WEB);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /is live at build_number=482/);
  });

  test('the fixture mode announces itself LOUDLY', () => {
    // Its presence in a real CI log must be unmistakable.
    assert.match(run([{ status: 200, body: '{"build_number":482}' }], WEB).out, /OFFLINE FIXTURE MODE/);
  });

  test('🔴 exit 1 on the wrong build, after exhausting the ceiling', () => {
    const r = run([{ status: 200, body: '{"build_number":481}' }], WEB);
    assert.equal(r.code, 1);
    assert.match(r.out, /POST-DEPLOY SMOKE FAILED/);
  });

  test('🔴 THE MEASURED FALSE RED: empty, then the shipped build, is a PASS', () => {
    // This is run 30934945633 replayed. `platform` answered `{"build":null}`
    // 7s after the deploy and `{"build":"<sha>"}` 80s later. The check exited 1
    // on the first response and the tracker recorded a broken deploy that had
    // in fact worked — which is the same class of error as a green tick over a
    // broken pipe, pointed the other way.
    const r = run(
      [{ status: 200, body: '{"ok":true,"build":null}' }, { status: 200, body: '{"ok":true,"build":"abc123"}' }],
      API,
    );
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /attempt 2\/6/);
  });

  test('🔴 an empty build that NEVER resolves still exits 1 — the failure is delayed, not removed', () => {
    // The other half of the trade. Making the empty case retryable must not
    // make it unfailable; a deploy that genuinely never threads RELEASE has to
    // stay red, just later.
    const r = run([{ status: 200, body: '{"ok":true,"build":null}' }], API);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /did not thread a build identity/);
  });

  test('a LATER attempt that succeeds is a pass — propagation is not a bad deploy', () => {
    const r = run([{ status: 404, body: '' }, { status: 200, body: '{"build_number":482}' }], WEB);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /attempt 2\/6/);
  });

  test('🔴 the right build with ok:false still fails when --require-ok is set', () => {
    const r = run([{ status: 200, body: '{"build":"abc123","ok":false}' }], API);
    assert.equal(r.code, 1);
    assert.match(r.out, /reports ok:false — it deployed, and it is unwell/);
  });

  test('the right build with ok:true passes --require-ok', () => {
    const r = run([{ status: 200, body: '{"build":"abc123","ok":true}' }], API);
    assert.equal(r.code, 0, r.out);
  });

  test('🔴 exit 2 — a BAD INVOCATION is not a pass', () => {
    // "I was called wrong" must never read as "the deploy is fine", and it must
    // be a different exit code from "the deploy is not fine".
    const r = spawnSync(process.execPath, [SCRIPT, '--url', 'https://x'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /usage:/);
  });

  test('🔴 exit 2 on an unreadable fixture — never a silent pass', () => {
    const r = spawnSync(process.execPath, [SCRIPT, ...WEB, '--fixture', join(TMP, 'nope.json')], { encoding: 'utf8' });
    assert.equal(r.status, 2);
  });
});
