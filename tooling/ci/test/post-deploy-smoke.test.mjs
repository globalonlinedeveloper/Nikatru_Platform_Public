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
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { judge, judgeOk, flag, judgeCacheControl, isWebChannelSmoke, WEB_ENTRY_POINTS } from '../../ops/post-deploy-smoke.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', 'ops', 'post-deploy-smoke.mjs');
const ROOT = resolve(HERE, '..', '..', '..');

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

// ─────────────────────────────────────────────────────────────────────────────
// THE EDGE CACHE LIMB — [14]O-8, `revert.mitigation.force-update`.
//
// The row was DEGRADED on exactly this: `assert-web-cache-policy.mjs` reads the
// DECLARED policy in `apps/subly/web/_headers` and nothing in this repository
// read the header the EDGE returns. The measured failure was the nikatru.com
// zone's Browser Cache TTL of 14400 stamping `public, max-age=14400,
// must-revalidate` over a correct origin header on `.js` — four hours in which
// a client keeps the previous build and reports the previous version honestly,
// which is the one client the force-update gate cannot see.
//
// ⚠️ THE EXPECTATION UNDER TEST IS THE DECLARED REQUIREMENT, NOT A MEASUREMENT.
// Production on 2026-08-07 serves `public, max-age=0, must-revalidate` on both
// entry points — it AGREES with `_headers` today. A guard written to match that
// observation would pass by construction, so the tests below are built the
// other way round: the historical failing value is the first input, and it must
// go red.
// ─────────────────────────────────────────────────────────────────────────────

/** The live values measured against production on 2026-08-07, pasted verbatim. */
const LIVE_OK = 'public, max-age=0, must-revalidate';
/** The value measured on 2026-08-04, before the zone moved to "Respect Existing Headers". */
const LIVE_BAD = 'public, max-age=14400, must-revalidate';

const JS = 'application/javascript';

/** Runs the real script with BOTH fixtures, so the limb is exercised end to end
 *  through the actual exit codes rather than only as a pure function. */
function runCache(responses, args, cacheMap) {
  const f = join(TMP, `fx-${(seq += 1)}.json`);
  const c = join(TMP, `cf-${(seq += 1)}.json`);
  writeFileSync(f, JSON.stringify(responses));
  writeFileSync(c, JSON.stringify(cacheMap));
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--fixture', f, '--cache-fixture', c], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Every path the limb looks at, all serving the value production serves. */
const cacheAllGood = () => ({
  '/version.json': { status: 200, headers: { 'content-type': 'application/json', 'cache-control': LIVE_OK } },
  '/flutter_bootstrap.js': { status: 200, headers: { 'content-type': JS, 'cache-control': LIVE_OK } },
  '/main.dart.js': { status: 200, headers: { 'content-type': JS, 'cache-control': LIVE_OK } },
});

describe('post-deploy-smoke — the edge cache decision [14]O-8', () => {
  test('PASSES on the value production actually serves', () => {
    const v = judgeCacheControl({ status: 200, contentType: JS, cacheControl: LIVE_OK, expectType: /javascript/ });
    assert.equal(v.ok, true);
    assert.equal(v.actual, LIVE_OK);
  });

  test('🔴 FAILS on the MEASURED 2026-08-04 value, and does NOT retry', () => {
    // The whole reason this limb exists. It is configuration — a zone setting —
    // so it is identical one second after the deploy and one hour after, and
    // waiting could only turn a real divergence into a slower real divergence.
    const v = judgeCacheControl({ status: 200, contentType: JS, cacheControl: LIVE_BAD, expectType: /javascript/ });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false);
    assert.match(v.reason, /max-age=14400/);
    assert.match(v.reason, /force-update gate cannot see/);
  });

  test('🔴 FAILS on ANY positive max-age, not just the one that was measured', () => {
    // An assertion pinned to 14400 would pass on 14399 — decoration.
    for (const cc of ['public, max-age=1', 'max-age=60, must-revalidate', 'public, max-age=31536000']) {
      const v = judgeCacheControl({ status: 200, contentType: JS, cacheControl: cc, expectType: /javascript/ });
      assert.equal(v.ok, false, `${cc} must fail`);
    }
  });

  test('🔴 FAILS on `immutable` — the exact thing /assets/* wrongly declared', () => {
    const v = judgeCacheControl({
      status: 200,
      contentType: JS,
      cacheControl: 'public, max-age=31536000, immutable',
      expectType: /javascript/,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false);
    assert.match(v.reason, /immutable/);
  });

  test('🔴 FAILS when the edge returns NO Cache-Control at all', () => {
    // The platform-default state `_headers` was written to end. Absent must
    // never read as fine: "I could not tell" reading as "it is fine" is how
    // max-age=14400 lived behind a green build.
    for (const cc of [undefined, null, '', '   ']) {
      const v = judgeCacheControl({ status: 200, contentType: JS, cacheControl: cc, expectType: /javascript/ });
      assert.equal(v.ok, false, `${JSON.stringify(cc)} must fail`);
      assert.equal(v.retry, false);
      assert.match(v.reason, /NO Cache-Control at all/);
    }
  });

  test('🔴 FAILS on a header that sets no freshness lifetime at all', () => {
    const v = judgeCacheControl({ status: 200, contentType: JS, cacheControl: 'public', expectType: /javascript/ });
    assert.equal(v.ok, false);
    assert.match(v.reason, /no freshness lifetime/);
  });

  test('🔴 FAILS on s-maxage>0 even when max-age is 0 — the edge IS a shared cache', () => {
    const v = judgeCacheControl({
      status: 200,
      contentType: JS,
      cacheControl: 'public, max-age=0, s-maxage=14400, must-revalidate',
      expectType: /javascript/,
    });
    assert.equal(v.ok, false);
    assert.match(v.reason, /s-maxage=14400/);
  });

  test('no-cache and no-store PASS — they are stricter than max-age=0', () => {
    // The property is "ask before reusing", not a literal string. Exact string
    // equality would fail on an equally-correct header and get deleted.
    for (const cc of ['no-cache', 'no-store', 'private, no-cache', 'MAX-AGE=0, PUBLIC']) {
      assert.equal(
        judgeCacheControl({ status: 200, contentType: JS, cacheControl: cc, expectType: /javascript/ }).ok,
        true,
        `${cc} must pass`,
      );
    }
  });

  test('🔴 an SPA shell where JavaScript belongs is a MISSING asset — and RETRIES', () => {
    // Pages answers an unknown path with index.html at 200. Judging its header
    // would report on a file that is not there.
    const v = judgeCacheControl({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      cacheControl: LIVE_OK,
      expectType: /javascript/,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true);
    assert.match(v.reason, /text\/html/);
  });

  test('🔴 a non-200 entry point fails, and RETRIES — that is what propagation looks like', () => {
    const v = judgeCacheControl({ status: 404, contentType: JS, cacheControl: LIVE_OK, expectType: /javascript/ });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true);
    assert.match(v.reason, /HTTP 404/);
  });

  test('the limb covers exactly the entry points the register row names', () => {
    // `main.dart.js` is compiled output but its NAME is stable, so it is an
    // entry point by the rule _headers states: the split is by whether the name
    // carries a hash, not by file type.
    assert.deepEqual(WEB_ENTRY_POINTS, ['/flutter_bootstrap.js', '/main.dart.js']);
  });

  test('the predicate separates the web channel from the Workers', () => {
    assert.equal(isWebChannelSmoke('https://subly.nikatru.com/version.json'), true);
    assert.equal(isWebChannelSmoke('https://api.nikatru.com/v1/health'), false);
    assert.equal(isWebChannelSmoke('not a url'), false);
  });

  test('REQUIRED COVERAGE: deploy-web.yml still smokes the URL the limb keys on', () => {
    // ⚠️ THE LIMB IS SCOPED BY THE SMOKED URL'S PATH, which is a coupling to the
    // caller. If deploy-web.yml ever smokes a different URL the limb goes QUIET
    // rather than red — the exact "a check that silently stopped checking"
    // failure this repository keeps paying for. This asserts the coupling
    // against the REAL workflow, so that change breaks a test instead.
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'deploy-web.yml'), 'utf8');
    // ⚠️ `node ...` and not the bare filename: the first mention in this file is
    // the `paths:` trigger list, which carries no --url. Matching that instead
    // of the RUN step is how this assertion would have reported on the wrong
    // line — it did, on the first run, which is why the anchor is spelled out.
    const at = wf.indexOf('node tooling/ops/post-deploy-smoke.mjs');
    assert.notEqual(at, -1, 'deploy-web.yml no longer invokes post-deploy-smoke.mjs at all');
    const window = wf.slice(at, at + 400);
    // The whole rest of the line, not \S+: the value is
    // `${{ steps.target.outputs.site_url }}/version.json` and an expression with
    // spaces in it would otherwise truncate to `${{`.
    const url = window.match(/--url[ \t]+(.+)/);
    assert.ok(url, 'the smoke invocation in deploy-web.yml has no --url');
    assert.match(
      url[1].trim(),
      /\/version\.json$/,
      `deploy-web.yml smokes ${url[1]}, but the edge cache limb only fires on /version.json — it is now silent on every web deploy`,
    );
  });
});

describe('post-deploy-smoke — the edge cache limb, end to end', () => {
  test('exit 0 and NAMES every header it saw', () => {
    const r = runCache([{ status: 200, body: '{"build_number":482}' }], WEB, cacheAllGood());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /flutter_bootstrap\.js revalidates/);
    assert.match(r.out, /main\.dart\.js revalidates/);
  });

  test('🔴 exit 1 when ONE entry point carries the measured bad value', () => {
    // main.dart.js only — a limb that checked the bootstrap alone would pass.
    const m = cacheAllGood();
    m['/main.dart.js'].headers['cache-control'] = LIVE_BAD;
    const r = runCache([{ status: 200, body: '{"build_number":482}' }], WEB, m);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /EDGE CACHE POLICY FAILED for https:\/\/subly\.nikatru\.com\/main\.dart\.js/);
    assert.match(r.out, /max-age=14400/);
    assert.match(r.out, /kill-switch cannot see/);
  });

  test('🔴 exit 1 when the bootstrap carries NO Cache-Control', () => {
    const m = cacheAllGood();
    delete m['/flutter_bootstrap.js'].headers['cache-control'];
    const r = runCache([{ status: 200, body: '{"build_number":482}' }], WEB, m);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /flutter_bootstrap\.js — the edge returned NO Cache-Control/);
  });

  test('🔴 exit 1 when an entry point is not served at all', () => {
    const m = cacheAllGood();
    delete m['/main.dart.js'];
    const r = runCache([{ status: 200, body: '{"build_number":482}' }], WEB, m);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /HTTP 404/);
  });

  test('🔴 exit 1 on the SMOKED url itself, not only the two entry points', () => {
    const m = cacheAllGood();
    m['/version.json'].headers['cache-control'] = LIVE_BAD;
    const r = runCache([{ status: 200, body: '{"build_number":482}' }], WEB, m);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /FAILED for https:\/\/subly\.nikatru\.com\/version\.json/);
  });

  test('a Worker deploy is NOT failed by a policy that does not govern it', () => {
    // api.nikatru.com/v1/health serves no Cache-Control at all — measured
    // 2026-08-07. Applying the web channel's _headers rule there would fail
    // every Workers deploy for a file that does not exist.
    const r = run([{ status: 200, body: '{"build":"abc123","ok":true}' }], API);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /not applicable/);
  });

  test('under --fixture alone the limb SKIPS, and says so loudly', () => {
    // There is no live edge to look at offline. A silent skip here would be the
    // limb quietly not existing.
    const r = run([{ status: 200, body: '{"build_number":482}' }], WEB);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /SKIPPED: --fixture is set and --cache-fixture is not/);
    assert.match(r.out, /must never appear in a real CI log/);
  });

  test('🔴 exit 2 on an unreadable cache fixture — never a silent pass', () => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, ...WEB, '--cache-fixture', join(TMP, 'nope.json')],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 2);
  });
});
