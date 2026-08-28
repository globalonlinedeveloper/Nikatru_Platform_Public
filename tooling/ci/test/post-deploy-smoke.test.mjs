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

// ─────────────────────────────────────────────────────────────────────────────
// THE PLAY LIMB — [14]O-7 over a STORE channel. Added 2026-08-26; these tests
// added the same day, because the limb shipped with NO committed test and a
// limb nothing exercises is the exact failure this whole file exists to prevent.
//
// 🔴 WHAT MAKES THIS LIMB DIFFERENT FROM EVERYTHING ABOVE, AND THEREFORE WHAT
// THE TESTS HAVE TO REACH. Everything above is one unauthenticated GET. This is
// a CREDENTIALLED, STATEFUL read: mint a token, INSERT an edit, list its tracks,
// DELETE the edit. Three of those four steps can fail on their own and the
// fourth — the delete — is the one that costs somebody something when it is
// skipped, because "Each user may have only a single edit open at a time" and a
// leaked probe edit blocks the NEXT submission for a reason no log explains.
//
// So the coverage is in three layers, deliberately:
//   1. `judgePlayTracks` as a PURE FUNCTION — every verdict, no network.
//   2. the real script end to end through `--play-fixture` — argument handling,
//      the retry ceiling, and the EXIT CODES, which are the part CI reads.
//   3. `smokePlayTrack` in process over a STUBBED `fetch` — the edit lifecycle,
//      which no fixture can reach because `--play-fixture` short-circuits the
//      whole transport (`if (!canned)`), credential included.
// Layer 3 is not optional: without it the insert/read/delete sequence has no
// observer at all, and it is the sequence with a side effect on a live console.
// ─────────────────────────────────────────────────────────────────────────────
import {
  judgePlayTracks,
  smokePlayTrack,
  PLAY_SA_ENV,
  PLAY_API_ORIGIN,
  GOOGLE_TOKEN_URL,
  PLAY_SCOPE,
} from '../../ops/post-deploy-smoke.mjs';
import { generateKeyPairSync } from 'node:crypto';

const PLAY_PKG = 'com.nikatru.subly';
/** The versionCode "this job just uploaded" in every fixture below. */
const CODE = '4242';

/** A track as `tracksResource` shapes it: {track, releases[{status,versionCodes}]}. */
const trk = (name, codes, status = 'completed') => ({
  track: name,
  releases: [{ status, versionCodes: codes }],
});

/** ⚠️ The host's own environment must never decide the answer. A developer with
 *  a real PLAY_SERVICE_ACCOUNT_JSON exported would otherwise take the network
 *  path in the credential tests below, and this suite would then pass or fail
 *  depending on whose machine it ran on. */
function playEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === PLAY_SA_ENV) delete env[k];
  return { ...env, ...extra };
}

/** Runs the REAL script over canned track states — one per attempt, exactly as
 *  the HTTP fixture mode above does, so the exit codes are exercised too. */
function runPlay(canned, expected = CODE) {
  const f = join(TMP, `play-${(seq += 1)}.json`);
  writeFileSync(f, JSON.stringify(canned));
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--play-package', PLAY_PKG, '--expect', String(expected), '--play-fixture', f],
    { encoding: 'utf8', env: playEnv() },
  );
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('post-deploy-smoke — the Play track decision [14]O-7', () => {
  test('PASSES when a track carries the versionCode this job uploaded, and NAMES the track and the status', () => {
    // The message is the whole point of the pass line: "green" without which
    // track and in what state is not a reading anybody can act on.
    const v = judgePlayTracks({ tracks: [trk('internal', ['4242'], 'inProgress')], expected: CODE });
    assert.equal(v.ok, true);
    assert.equal(v.track, 'internal');
    assert.equal(v.status, 'inProgress');
  });

  test('a STRING versionCode and an INTEGER one are the same build', () => {
    // The API answers strings; the bundle upload reports an integer. `4242 !==
    // "4242"` failing a good submission is the kind of red that gets a check
    // deleted rather than fixed.
    assert.equal(judgePlayTracks({ tracks: [trk('internal', [4242])], expected: '4242' }).ok, true);
    assert.equal(judgePlayTracks({ tracks: [trk('internal', ['4242'])], expected: 4242 }).ok, true);
  });

  test('finds the code when a release carries SEVERAL versionCodes', () => {
    // `Release.versionCodes` is plural — an app shipping split ABIs puts more
    // than one in a single release, and a check that read [0] would fail one.
    const v = judgePlayTracks({ tracks: [trk('beta', ['4240', '4241', '4242'])], expected: CODE });
    assert.equal(v.ok, true);
    assert.equal(v.track, 'beta');
  });

  test('🔴 FAILS when NO track carries it — and the message LISTS WHAT THE TRACKS DO CARRY', () => {
    // ⚠️ THAT LIST IS THE ENTIRE DIAGNOSTIC. "no track carries 4242" tells the
    // reader nothing about whether the upload went to the wrong track, shipped
    // nothing, or went to the wrong app; `internal=4241, production=4200` tells
    // those three apart at a glance. Asserting only `ok === false` here would
    // let the list be deleted without a test noticing.
    const v = judgePlayTracks({
      tracks: [trk('internal', ['4241']), trk('production', ['4200'])],
      expected: CODE,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true, 'a track state that has not appeared YET looks identical to one that never will');
    assert.match(v.reason, /NO track carries versionCode 4242/);
    assert.match(v.reason, /internal=4241/);
    assert.match(v.reason, /production=4200/);
  });

  test('🔴 the diagnostic still says something when the tracks carry NOTHING', () => {
    const v = judgePlayTracks({ tracks: [{ track: 'internal', releases: [] }], expected: CODE });
    assert.equal(v.ok, false);
    assert.match(v.reason, /no releases at all/);
  });

  test('🔴 ZERO tracks is a FAILURE and is NOT retryable', () => {
    // Every Play app has the standard track set, so an empty list means this
    // service account cannot see this package — a probe that read nothing.
    // Retrying it would turn "I am not allowed to look" into a slow "I am not
    // allowed to look", and "I could not tell" must never read as "it is fine".
    const v = judgePlayTracks({ tracks: [], expected: CODE });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false);
    assert.match(v.reason, /ZERO tracks/);
    assert.match(v.reason, /cannot see this package/);
  });

  test('🔴 a body that is not the documented shape FAILS, and does not retry', () => {
    for (const tracks of [undefined, null, {}, 'tracks']) {
      const v = judgePlayTracks({ tracks, expected: CODE });
      assert.equal(v.ok, false, `${JSON.stringify(tracks)} must fail`);
      assert.equal(v.retry, false);
      assert.match(v.reason, /no `tracks` array/);
    }
  });

  test('a malformed track entry does not throw — it just does not match', () => {
    // A shape the API is not documented to return must not crash the probe into
    // an unhandled rejection, which reports as neither a pass nor a failure.
    const v = judgePlayTracks({ tracks: [{}, { track: 7 }, { releases: null }], expected: CODE });
    assert.equal(v.ok, false);
    assert.match(v.reason, /NO track carries versionCode 4242/);
  });
});

describe('post-deploy-smoke — the Play limb end to end, through the real script', () => {
  test('exit 0 and the line names the track and the release status', () => {
    const r = runPlay([{ tracks: [trk('internal', ['4242'], 'inProgress')] }]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /versionCode 4242 is on the "internal" track/);
    assert.match(r.out, /release status inProgress/);
  });

  test('the Play fixture mode announces itself LOUDLY', () => {
    const r = runPlay([{ tracks: [trk('internal', ['4242'])] }]);
    assert.match(r.out, /OFFLINE PLAY FIXTURE MODE/);
    assert.match(r.out, /must NEVER appear in a real CI log/i);
  });

  test('🔴 exit 1 when no track carries it, and the FAILURE PRINTS THE TRACK LIST', () => {
    const r = runPlay([{ tracks: [trk('internal', ['4241']), trk('production', ['4200'])] }]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PLAY TRACK SMOKE FAILED for com\.nikatru\.subly/);
    assert.match(r.out, /internal=4241, production=4200/);
  });

  test('a track state that appears on a LATER attempt is a PASS — commit propagation is not a bad upload', () => {
    const r = runPlay([{ tracks: [trk('internal', ['4241'])] }, { tracks: [trk('internal', ['4242'])] }]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /attempt 2\/6/);
  });

  test('🔴 ZERO tracks exits 1 IMMEDIATELY — the non-retryability is observable', () => {
    // ⚠️ HOW THIS ASSERTS "did not retry" WITHOUT A CLOCK: the second canned
    // state is a PASS. If the empty list were retryable the run would reach it
    // and exit 0. Exit 1 therefore proves the loop broke on attempt 1.
    const r = runPlay([{ tracks: [] }, { tracks: [trk('internal', ['4242'])] }]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ZERO tracks/);
    assert.doesNotMatch(r.out, /attempt 2\/6/);
  });

  test('🔴 exit 1 on an API error — a 403 is a failure, never a pass', () => {
    // The credential can read the token endpoint and still be un-granted on the
    // app. That answers 403 forever, and it is the state where a probe that
    // shrugged would certify an upload nobody can see.
    const r = runPlay([{ error: 'edits.tracks.list answered HTTP 403' }]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /PLAY TRACK SMOKE FAILED/);
    assert.match(r.out, /the Play API could not be read/);
    assert.match(r.out, /HTTP 403/);
  });

  test('a TRANSIENT API error followed by a good read is a PASS', () => {
    const r = runPlay([{ error: 'edits.insert answered HTTP 500' }, { tracks: [trk('internal', ['4242'])] }]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /attempt 2\/6/);
  });

  test('🔴 exit 1 when the API answers a shape this probe does not read', () => {
    const r = runPlay([{ tracks: { internal: ['4242'] } }]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /no `tracks` array/);
  });

  test('🔴 an EMPTY credential is a FAILURE — a probe that cannot run is never a pass', () => {
    // No --play-fixture, so the real credential path runs. It must fail BEFORE
    // any network call, which is also why this test needs no stub.
    for (const value of [undefined, '', '   ']) {
      const env = playEnv(value === undefined ? {} : { [PLAY_SA_ENV]: value });
      const r = spawnSync(process.execPath, [SCRIPT, '--play-package', PLAY_PKG, '--expect', CODE], {
        encoding: 'utf8',
        env,
      });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      assert.equal(r.status, 1, `${JSON.stringify(value)} must fail: ${out}`);
      assert.match(out, /PLAY TRACK SMOKE FAILED/);
      assert.match(out, /A probe that cannot run is a failure, never a pass/);
    }
  });

  test('🔴 an UNPARSEABLE credential fails — and its contents are never printed', () => {
    const secret = 'not-json-but-SECRET-MATERIAL-abcdef';
    const r = spawnSync(process.execPath, [SCRIPT, '--play-package', PLAY_PKG, '--expect', CODE], {
      encoding: 'utf8',
      env: playEnv({ [PLAY_SA_ENV]: secret }),
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    assert.equal(r.status, 1, out);
    assert.match(out, /does not parse as JSON/);
    assert.ok(!out.includes(secret), `the credential leaked into the log: ${out}`);
  });

  test('🔴 exit 2 — --play-package WITHOUT --expect is a REFUSAL, not a pass', () => {
    // "I was called wrong" must be a different exit code from "the upload is
    // not fine", or CI cannot tell a broken step from a broken deploy.
    const r = spawnSync(process.execPath, [SCRIPT, '--play-package', PLAY_PKG], {
      encoding: 'utf8',
      env: playEnv(),
    });
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /usage: post-deploy-smoke\.mjs --play-package/);
  });

  test('🔴 exit 2 on an unreadable play fixture — never a silent pass', () => {
    const r = spawnSync(
      process.execPath,
      [SCRIPT, '--play-package', PLAY_PKG, '--expect', CODE, '--play-fixture', join(TMP, 'nope.json')],
      { encoding: 'utf8', env: playEnv() },
    );
    assert.equal(r.status, 2);
    assert.match(`${r.stdout}${r.stderr}`, /could not read play fixture/);
  });

  test('🔴 exit 2 on a play fixture that is not a non-empty array', () => {
    for (const bad of [[], {}, 'nope', null]) {
      const f = join(TMP, `play-bad-${(seq += 1)}.json`);
      writeFileSync(f, JSON.stringify(bad));
      const r = spawnSync(
        process.execPath,
        [SCRIPT, '--play-package', PLAY_PKG, '--expect', CODE, '--play-fixture', f],
        { encoding: 'utf8', env: playEnv() },
      );
      assert.equal(r.status, 2, `${JSON.stringify(bad)} must be refused`);
      assert.match(`${r.stdout}${r.stderr}`, /non-empty array/);
    }
  });

  test('🔴 the HTTP mode exit-2 CONTRACT HAS NOT MOVED', () => {
    // ⚠️ The Play branch is taken BEFORE the --url usage check, so it now sits
    // upstream of a contract that predates it. If it ever swallowed the bare
    // invocation — or answered it with the PLAY usage line — every existing
    // caller's "called wrong" signal would change shape silently. Asserting the
    // exit code alone would not catch the wrong usage line being printed.
    for (const args of [[], ['--url', 'https://x'], ['--field', 'build'], ['--expect', '482']]) {
      const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: playEnv() });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      assert.equal(r.status, 2, `${JSON.stringify(args)} must still exit 2: ${out}`);
      assert.match(out, /usage: post-deploy-smoke\.mjs --url <u> --field <f> --expect <v>/);
      assert.doesNotMatch(out, /--play-package <applicationId>/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE EDIT LIFECYCLE — the side effect, and the only part of the limb that
// `--play-fixture` cannot reach.
//
// androidpublisher v3 exposes no track read outside an edit, so the probe must
// INSERT one. `editsGuide`: "If you create a new edit, any existing edit you may
// have open is invalidated" — so a probe edit that is not discarded both blocks
// the next run ("only a single edit open at a time") and can invalidate an edit
// the owner has open in the Play Console at that second. The delete lives in a
// `finally` for exactly that reason, and a `finally` nobody has watched throw is
// not yet a `finally`.
//
// These run IN PROCESS with a stubbed `fetch`, because `smokePlayTrack` skips
// the entire transport when `canned` is set. Nothing here touches the network,
// this host's credentials, or a real Play account: the service account is a
// throwaway RSA key generated in memory, and every URL is answered by the stub.
// ─────────────────────────────────────────────────────────────────────────────

/** A real, throwaway RSA key so `createSign("RSA-SHA256")` genuinely signs —
 *  generated lazily, because keygen is the slowest thing in this file and the
 *  tests above must not pay for it. */
let SA_JSON = null;
function serviceAccountJson() {
  if (SA_JSON === null) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    SA_JSON = JSON.stringify({
      type: 'service_account',
      client_email: 'probe@nikatru-test.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: GOOGLE_TOKEN_URL,
    });
  }
  return SA_JSON;
}

const EDIT_ID = 'edit-probe-777';
const stubRes = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** Routes the four requests the limb makes, and RECORDS every one — the record
 *  is what the delete assertions read. */
function playFetchStub({ tracks, listStatus = 200, deleteStatus = 204, insertStatus = 200, deleteThrows = false }) {
  const calls = [];
  const editsBase = `${PLAY_API_ORIGIN}/androidpublisher/v3/applications/${PLAY_PKG}/edits`;
  return {
    calls,
    editsBase,
    async fetch(url, init = {}) {
      const u = String(url);
      const method = (init.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${u}`);
      if (u === GOOGLE_TOKEN_URL) {
        // The assertion must carry the documented JWT-bearer grant.
        assert.match(String(init.body ?? ''), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
        return stubRes(200, { access_token: 'stub-access-token' });
      }
      if (method === 'POST' && u === editsBase) return stubRes(insertStatus, { id: EDIT_ID });
      if (method === 'GET' && u === `${editsBase}/${EDIT_ID}/tracks`) {
        return stubRes(listStatus, listStatus === 200 ? { tracks } : 'nope');
      }
      if (method === 'DELETE' && u === `${editsBase}/${EDIT_ID}`) {
        if (deleteThrows) throw new Error('socket hang up');
        return stubRes(deleteStatus, '');
      }
      throw new Error(`the limb made an UNROUTED request: ${method} ${u}`);
    },
  };
}

/** Swaps in the stub, a real credential, an instant clock and a log sink, and
 *  puts every one of them back. ⚠️ `setTimeout` is stubbed because the retry
 *  gap is 10s x 5 on the failing paths — 50 real seconds per test otherwise. */
async function withStubbedPlay(stub, fn) {
  const realFetch = globalThis.fetch;
  const realTimeout = globalThis.setTimeout;
  const realLog = console.log;
  const realError = console.error;
  const hadEnv = Object.prototype.hasOwnProperty.call(process.env, PLAY_SA_ENV);
  const realEnv = process.env[PLAY_SA_ENV];
  const logged = [];
  globalThis.fetch = stub.fetch;
  globalThis.setTimeout = (cb, _ms, ...rest) => realTimeout(cb, 0, ...rest);
  console.log = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  process.env[PLAY_SA_ENV] = serviceAccountJson();
  try {
    const value = await fn();
    return { value, log: logged.join('\n') };
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
    console.log = realLog;
    console.error = realError;
    if (hadEnv) process.env[PLAY_SA_ENV] = realEnv;
    else delete process.env[PLAY_SA_ENV];
  }
}

const countCalls = (calls, prefix) => calls.filter((c) => c.startsWith(prefix)).length;

describe('post-deploy-smoke — the Play edit lifecycle', () => {
  test('a good read INSERTS an edit, lists its tracks, and DELETES the edit', async () => {
    const stub = playFetchStub({ tracks: [trk('internal', ['4242'])] });
    const { value, log } = await withStubbedPlay(stub, () =>
      smokePlayTrack({ packageName: PLAY_PKG, expected: CODE, canned: null }),
    );
    assert.equal(value, true, log);
    assert.equal(countCalls(stub.calls, `POST ${stub.editsBase}`), 1);
    assert.equal(countCalls(stub.calls, `GET ${stub.editsBase}/${EDIT_ID}/tracks`), 1);
    assert.equal(
      countCalls(stub.calls, `DELETE ${stub.editsBase}/${EDIT_ID}`),
      1,
      `the probe edit was never discarded: ${stub.calls.join(' | ')}`,
    );
    // The delete is the LAST thing that happens, not something that raced the read.
    assert.match(stub.calls[stub.calls.length - 1], /^DELETE /);
  });

  test('🔴 THE EDIT IS DELETED EVEN WHEN THE READ THROWS', async () => {
    // ⚠️ THE `finally`. A throw between insert and read is the one path where a
    // naive implementation leaks an edit, and a leaked edit blocks the NEXT
    // submission for a reason nothing in the log explains. Six attempts open six
    // edits, so all six must be discarded — asserting only "at least one delete"
    // would pass on an implementation that cleaned up once and leaked five.
    const stub = playFetchStub({ listStatus: 500 });
    const { value, log } = await withStubbedPlay(stub, () =>
      smokePlayTrack({ packageName: PLAY_PKG, expected: CODE, canned: null }),
    );
    assert.equal(value, false, log);
    const inserts = countCalls(stub.calls, `POST ${stub.editsBase}`);
    const deletes = countCalls(stub.calls, `DELETE ${stub.editsBase}/${EDIT_ID}`);
    assert.ok(inserts > 0, 'the probe never opened an edit at all');
    assert.equal(deletes, inserts, `${inserts} edit(s) opened but only ${deletes} discarded`);
    assert.match(log, /the Play API could not be read/);
    assert.match(log, /HTTP 500/);
  });

  test('🔴 a failed INSERT opens nothing, so it deletes nothing — and still fails', async () => {
    // The other side of the same coin: cleanup must not fire for an edit that
    // was never created, or the probe DELETEs an id it does not own.
    const stub = playFetchStub({ insertStatus: 403 });
    const { value, log } = await withStubbedPlay(stub, () =>
      smokePlayTrack({ packageName: PLAY_PKG, expected: CODE, canned: null }),
    );
    assert.equal(value, false, log);
    assert.equal(countCalls(stub.calls, 'DELETE '), 0, `deleted an edit it never opened: ${stub.calls.join(' | ')}`);
    assert.match(log, /edits\.insert answered HTTP 403/);
  });

  test('a delete that FAILS is reported loudly and does NOT fail a good submission', async () => {
    // Failing a genuinely good upload over cleanup would be the false red this
    // file was rewritten to remove — but a SILENT catch would leave the next
    // submission blocked with nothing in the log. So: loud, and still green.
    const stub = playFetchStub({ tracks: [trk('internal', ['4242'])], deleteStatus: 500 });
    const { value, log } = await withStubbedPlay(stub, () =>
      smokePlayTrack({ packageName: PLAY_PKG, expected: CODE, canned: null }),
    );
    assert.equal(value, true, log);
    assert.match(log, new RegExp(`the probe edit ${EDIT_ID} could NOT be deleted \\(HTTP 500\\)`));
    assert.match(log, /discard it in the Play Console/);
  });

  test('a delete that THROWS is reported too — and is not an unhandled rejection', async () => {
    const stub = playFetchStub({ tracks: [trk('internal', ['4242'])], deleteThrows: true });
    const { value, log } = await withStubbedPlay(stub, () =>
      smokePlayTrack({ packageName: PLAY_PKG, expected: CODE, canned: null }),
    );
    assert.equal(value, true, log);
    assert.match(log, new RegExp(`the probe edit ${EDIT_ID} could NOT be deleted \\(socket hang up\\)`));
  });

  test('🔴 the credential and the token never reach the log, on the failing path either', async () => {
    // The limb prints a lot on failure. None of it may be key material.
    const stub = playFetchStub({ tracks: [trk('internal', ['4241'])] });
    const { value, log } = await withStubbedPlay(stub, () =>
      smokePlayTrack({ packageName: PLAY_PKG, expected: CODE, canned: null }),
    );
    assert.equal(value, false);
    assert.ok(!log.includes('BEGIN PRIVATE KEY'), 'the private key reached the log');
    assert.ok(!log.includes('stub-access-token'), 'the bearer token reached the log');
    assert.ok(!log.includes(serviceAccountJson()), 'the service-account JSON reached the log');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED COVERAGE. A limb nothing exercises goes QUIET rather than red, which
// is the failure this whole file exists to prevent — and it is exactly the state
// the Play limb shipped in on 2026-08-26, proven only by fixtures its writer ran
// by hand. These assertions make its DISAPPEARANCE a red test.
// ─────────────────────────────────────────────────────────────────────────────

/** The script with WHOLE-LINE comments blanked out. NOT a parser: it blanks a
 *  line whose first non-space characters are `//`, `*` or `/*`, and nothing
 *  else. A trailing comment on a code line survives, and so does a match inside
 *  a template literal. That is enough for the one job it has — stopping a
 *  substring pin from being satisfied by the script's own usage banner and
 *  JSDoc, which is how three of the pins below were inert. */
function codeOnly(src) {
  return src
    .split('\n')
    .map((l) => {
      const t = l.trimStart();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : l;
    })
    .join('\n');
}

const indentOf = (l) => l.length - l.trimStart().length;

/** The lines of the `- name:` step that ENCLOSES line `idx`: back to that step's
 *  own `- name:`, forward to the first later non-blank line indented no further
 *  than the dash. The indentation is READ FROM THE FILE, never assumed — the
 *  earlier spelling hard-coded `'\n      - name:'` and stopped searching at the
 *  invocation line, which made moving `env:` below `run:` a false red. */
function enclosingStep(lines, idx) {
  let start = -1;
  for (let i = idx; i >= 0; i--) {
    if (/^\s*-\s+name:/.test(lines[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const stepIndent = indentOf(lines[start]);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    if (indentOf(lines[i]) <= stepIndent) {
      end = i;
      break;
    }
  }
  return { lines: lines.slice(start, end), keyIndent: stepIndent + 2 };
}

/** Every KEY LINE of the step's `env:` MAPPING. `env:` must sit at the step's own
 *  key indent (`- ` is two characters, so that offset is YAML's, not a magic
 *  number), and only lines indented further than it are collected — which is why
 *  the body of a `run:` block scalar, where a commented-out credential would
 *  live, can never appear in this list. */
function stepEnvKeys(step) {
  const keys = [];
  for (let i = 0; i < step.lines.length; i++) {
    const l = step.lines[i];
    if (!/^\s*env:\s*$/.test(l) || indentOf(l) !== step.keyIndent) continue;
    for (let j = i + 1; j < step.lines.length; j++) {
      const m = step.lines[j];
      if (m.trim() === '') continue;
      if (indentOf(m) <= step.keyIndent) break;
      if (m.trimStart().startsWith('#')) continue;
      keys.push(m.trim());
    }
  }
  return keys;
}

describe('post-deploy-smoke — REQUIRED COVERAGE of the Play limb', () => {
  test('REQUIRED COVERAGE: the Play limb is still exported, and this file still imports it', () => {
    // ⚠️ The named imports at the top of this section are the first line of
    // defence: deleting either export turns them into a link-time SyntaxError
    // and the ENTIRE file goes red rather than quietly testing less. This
    // asserts the same thing at run time so the reason is legible in the test
    // output rather than being an unexplained module error.
    assert.equal(typeof judgePlayTracks, 'function', 'judgePlayTracks is gone — the Play decision is untested');
    assert.equal(typeof smokePlayTrack, 'function', 'smokePlayTrack is gone — the Play limb is untested');
    assert.equal(PLAY_SA_ENV, 'PLAY_SERVICE_ACCOUNT_JSON');
    assert.equal(PLAY_API_ORIGIN, 'https://androidpublisher.googleapis.com');
    assert.equal(GOOGLE_TOKEN_URL, 'https://oauth2.googleapis.com/token');
    assert.equal(PLAY_SCOPE, 'https://www.googleapis.com/auth/androidpublisher');
  });

  test('REQUIRED COVERAGE: the script still declares the Play limb and its flags', () => {
    // Reading the SOURCE and not only the module surface: an export kept alive
    // as a stub — `export const judgePlayTracks = () => ({ok:true})` — would
    // satisfy the typeof check above while the limb had stopped existing.
    const src = readFileSync(SCRIPT, 'utf8');
    assert.match(src, /^export function judgePlayTracks\(/m, 'judgePlayTracks is no longer a declared function');
    assert.match(
      src,
      /^export async function smokePlayTrack\(/m,
      'smokePlayTrack is no longer a declared async function',
    );
    // ⚠️ WHICH CLAUSES ARE LOAD-BEARING. The two `^export … function(` anchors
    // above are comment-proof on their own — `^` plus `export` cannot be
    // satisfied by prose. THE THREE BELOW ARE PLAIN SUBSTRING PINS, and this
    // script documents itself: it carries a usage banner
    // (`//   node tooling/ops/post-deploy-smoke.mjs --play-package <applicationId>`
    // and `//   ... --play-fixture <file>`) and a JSDoc line naming
    // `androidpublisher/v3/applications`. MEASURED 2026-08-26 against mutated
    // copies: read against `src`, renaming the real flag in
    // `flag(process.argv, '--play-package')` and repointing the real `editsBase`
    // to `/androidpublisher/v4/apps/` left ALL THREE GREEN — the comments alone
    // satisfied them. So they read `code`, not `src`, and all three now go red.
    //
    // THEIR LIMIT, SAID OUT LOUD: they are substring pins on a file with its
    // whole-line comments blanked. They do NOT prove the flag is parsed or the
    // URL is fetched, and a TRAILING comment on a code line would still satisfy
    // them. The behaviour is covered by the end-to-end fixture runs and the
    // edit-lifecycle tests above; these only pin the spellings those depend on.
    const code = codeOnly(src);
    assert.match(code, /--play-package/, 'the script no longer accepts --play-package (its usage comment does not count)');
    assert.match(code, /--play-fixture/, 'the script no longer accepts --play-fixture (its usage comment does not count)');
    assert.match(
      code,
      /androidpublisher\/v3\/applications/,
      'the edits transport is gone (the JSDoc naming the same path does not count)',
    );
  });

  test('REQUIRED COVERAGE: the edit cleanup is still a `finally`, not a success-path step', () => {
    // ⚠️ THIS ASSERTION USED TO BE A FALSE SENTENCE. It read
    // `assert.match(src, /\}\s*finally\s*\{/, 'the edit cleanup `finally` is gone')`
    // over the WHOLE file, under a comment claiming "if it is refactored away,
    // this says so". It did not say so. post-deploy-smoke.mjs has TWO
    // `} finally {`: one in `fetchOnce`, which predates the Play limb and has
    // nothing to do with it, and one here. MEASURED 2026-08-26 — moving the
    // delete out of the Play `finally` onto the success path left the assertion
    // GREEN, satisfied by `fetchOnce`.
    //
    // Scoped to `readPlayTracksOnce` and checking ORDER, it goes red on that
    // mutant. ITS LIMIT: a TEXT SCAN, NOT A PARSE. It shows a `finally` exists in
    // this function and the DELETE is textually after it; it does not prove the
    // delete is lexically inside the block, and a second `finally` added ahead of
    // the delete would satisfy it.
    //
    // AND THE REAL GUARD IS NOT THIS TEST. `🔴 THE EDIT IS DELETED EVEN WHEN THE
    // READ THROWS` above runs the limb against a throwing read and counts DELETEs
    // against inserts — that is what actually catches a moved delete. This exists
    // so the failure names the refactor instead of arriving as a count mismatch.
    const code = codeOnly(readFileSync(SCRIPT, 'utf8'));
    const fnAt = code.indexOf('async function readPlayTracksOnce(');
    assert.notEqual(fnAt, -1, 'readPlayTracksOnce is gone — the edit lifecycle has been restructured');
    const fnEnd = code.indexOf('\n}', fnAt);
    const fn = code.slice(fnAt, fnEnd === -1 ? code.length : fnEnd);
    const finallyAt = fn.search(/\}\s*finally\s*\{/);
    assert.notEqual(finallyAt, -1, 'the edit cleanup `finally` is gone from readPlayTracksOnce');
    const deleteAt = fn.search(/method:\s*'DELETE'/);
    assert.notEqual(deleteAt, -1, 'readPlayTracksOnce no longer DELETEs the edit it opened');
    assert.ok(
      deleteAt > finallyAt,
      'the edits.delete no longer sits after the `finally` in readPlayTracksOnce — a delete on the success path leaks the probe edit on every failed read, and a leaked edit blocks the NEXT submission',
    );
  });

  test('REQUIRED COVERAGE: submit-play.yml still RUNS the limb, with a credential', () => {
    // ⚠️ THE LIMB HAS EXACTLY ONE CALLER. If submit-play.yml stops invoking it —
    // or invokes it without PLAY_SERVICE_ACCOUNT_JSON in that step's env, which
    // makes it fail every run and get "fixed" by deletion — the probe is silent
    // on every upload and nothing else in this repository notices. This asserts
    // the coupling against the REAL workflow so that change breaks a test.
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'submit-play.yml'), 'utf8');
    // ⚠️ BY LINE, AND THE LINE MUST *START* WITH THE COMMAND. A whole-file
    // `indexOf` was the first spelling of this assertion and it was WRONG:
    // commenting the step out — `# node tooling/ops/post-deploy-smoke.mjs
    // --play-package …` — leaves the substring in the file, so the test stayed
    // GREEN while the probe had stopped running on every upload. A mention on a
    // comment line is not a call site. Measured 2026-08-26 against a mutated
    // copy of this workflow, before this line was written.
    const INVOKE = 'node tooling/ops/post-deploy-smoke.mjs --play-package';
    const lines = wf.split('\n');
    const idx = lines.findIndex((l) => l.trim().startsWith(INVOKE));
    assert.notEqual(idx, -1, 'submit-play.yml no longer RUNS the Play track smoke — it is gone or commented out');
    // The whole rest of the line: the values are `"${APPLICATION_ID}"` and
    // `"${VERSION_CODE}"`, so \S+ alone would truncate on nothing useful.
    const line = lines[idx];
    assert.match(line, /--expect\s+\S+/, 'the Play smoke invocation carries no --expect, so it asserts nothing');
    assert.doesNotMatch(
      line,
      /--play-fixture/,
      'submit-play.yml runs the Play smoke in OFFLINE FIXTURE MODE — it is reading a file, not the store',
    );
    // ⚠️ THE CREDENTIAL, BY LINE, IN THE STEP'S `env:` MAPPING — the SAME defect
    // class as the INVOKE line above, still sitting here after that one was
    // fixed. The first spelling was
    // `assert.match(wf.slice(stepStart, at), new RegExp(`${PLAY_SA_ENV}:`))`, a
    // substring match over the whole slice. MEASURED 2026-08-26 against a mutated
    // copy: delete the step's ENTIRE `env:` block and leave
    // `# TODO restore PLAY_SERVICE_ACCOUNT_JSON: …` as a SHELL COMMENT inside
    // `run:`, and it stayed GREEN — the step then carried no credential at all
    // and the smoke would have failed on every upload, which is precisely the
    // state this test's own comment says it prevents. CONTROL, same date:
    // deleting the env block with no comment went red, which is why the hole was
    // invisible. `stepEnvKeys` can only ever see mapping keys under `env:`, so no
    // `run:` body can satisfy it; the commented variant is red now.
    //
    // ⚠️ TWO LIMITS, BOTH FAIL SAFE — RED, NEVER FALSELY GREEN. IF ONE FIRES,
    // TEACH THE ASSERTION; DO NOT RELAX IT.
    //   1. STEP-SCOPED. GitHub Actions also resolves `env:` at JOB and WORKFLOW
    //      level, so hoisting PLAY_SERVICE_ACCOUNT_JSON up one level is a legal
    //      refactor that leaves the probe working and turns this RED (measured
    //      2026-08-26). Deliberate: this file does not implement YAML scope
    //      resolution, and "not on the step" is the honest report of what it
    //      actually checked.
    //   2. A LINE-AND-INDENT SCAN, NOT A YAML PARSE. It follows `- name:`,
    //      `env:` and indentation as text; an anchor, a merge key, or a flow
    //      mapping (`env: { PLAY_SERVICE_ACCOUNT_JSON: … }`) would go red too.
    // The old spelling was wrong in the OTHER direction as well: it hard-coded
    // six-space indentation and searched only as far as the INVOKE line, so
    // moving `env:` BELOW `run:` — legal YAML, no behaviour change — was a FALSE
    // RED. Measured 2026-08-26: that variant is green here now.
    const step = enclosingStep(lines, idx);
    assert.notEqual(step, null, 'the Play smoke invocation is not inside a named step');
    assert.ok(
      stepEnvKeys(step).some((k) => k.startsWith(`${PLAY_SA_ENV}:`)),
      `the step running the Play smoke does not put ${PLAY_SA_ENV} in its own env: mapping — the probe would fail every run. (If it was hoisted to job or workflow level it IS in scope for real, but out of scope for this assertion: teach it, do not delete it.)`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE RELEASE ASSET READ-BACK LIMB — [pipeline 14]O-7, the GitHub Release lane.
//
// 🔴 WHY THIS SECTION EXISTS, SAID PLAINLY. `judgeReleaseAssets` and
// `smokeReleaseAssets` are the ONLY thing standing between "the publish step
// went green" and "the release serves bytes nobody built". Until this file was
// written they had ZERO tests, and their one caller — build-platforms.yml, the
// step named "The release must carry the assets this job just uploaded" — sits
// behind `if: github.ref_type == 'tag'`, which has NEVER FIRED: this repository
// has no tags and no releases (measured 2026-08-27: `git tag` is empty and
// `gh api repos/:owner/:repo/releases --jq length` answers 0). So the limb was
// 189 lines that had never executed anywhere except by hand.
//
// ⚠️ WHAT THIS SECTION DOES AND DOES NOT PROVE. It proves THE DECISION — every
// named branch of it, offline and network-free, through the pure function and
// through the real script's argument handling and exit codes. It does NOT prove
// a tag ever exercises the limb in CI; nothing in a test file can prove that.
// The REQUIRED COVERAGE block at the end pins the call site so that DELETING the
// invocation, dropping its credential, or leaving it in offline fixture mode
// breaks a test — which is the strongest statement available from here.
// ─────────────────────────────────────────────────────────────────────────────
import {
  judgeReleaseAssets,
  smokeReleaseAssets,
  GITHUB_API_ORIGIN,
  GITHUB_API_VERSION,
  RELEASE_TOKEN_ENV,
} from '../../ops/post-deploy-smoke.mjs';
import { MANIFEST_NAME } from '../release-manifest.mjs';
import { createHash } from 'node:crypto';

const R_REPO = 'nikatru/Nikatru_Platform_Public';
const R_TAG = 'v9.9.9-fixture';

const A_LINUX = 'subly-linux-x64.AppImage';
const A_WIN = 'subly-windows-x64.exe';
/** sha256 of the empty byte string. */
const H_LINUX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
/** sha256 of the five bytes `hello\n`. */
const H_WIN = '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03';

/** The manifest EXACTLY as `release-manifest.mjs --emit` shapes one: three
 *  comment lines of metadata, then `<64 hex>  <name>` per asset, LF, trailing
 *  newline. Its byte length is pinned below, so editing this edits that too. */
const MANIFEST_TEXT = [
  '# NIKATRU release manifest - verify with:  sha256sum -c SHA256SUMS',
  '# commit: 4a25d9c0000000000000000000000000000000ab',
  '# tag: v9.9.9-fixture',
  `${H_LINUX}  ${A_LINUX}`,
  `${H_WIN}  ${A_WIN}`,
  '',
].join('\n');

// 🔴 THE EXTERNAL ANCHOR, AND THE WHOLE REASON THIS CONSTANT IS A LITERAL.
// `manifestDigest` is the sha256 of the manifest FILE — the one hash that cannot
// appear inside the manifest's own body, and therefore the one the fixture has
// to supply. The obvious way to write it is
// `createHash('sha256').update(readFileSync(f))`, which is CHARACTER FOR
// CHARACTER what smokeReleaseAssets does. That fixture would be GREEN WHILE
// BROKEN: hash the utf8 STRING instead of the bytes, or forget the trailing
// newline, or lower-case the wrong end, and the probe and its test would agree
// with each other and with nothing else in the world.
//
// So this number does not come from node. MEASURED 2026-08-27 over the exact 319
// bytes of MANIFEST_TEXT by THREE independent implementations:
//   node  createHash('sha256')            -> 6e616f1d…46c4
//   certutil -hashfile … SHA256 (Windows) -> 6e616f1d…46c4
//   sha256sum (coreutils, MSYS)           -> 6e616f1d…46c4
// The test immediately below re-derives it with node and asserts it against this
// literal, so if either side of the pair ever drifts, THIS FILE says so.
const MANIFEST_DIGEST = '6e616f1d255c08440a0d1fa21c2d63810bf61d4f51521f4f78958f7f2b7a46c4';
/** MANIFEST_TEXT with every LF turned into CRLF — the bytes a Windows checkout
 *  with `core.autocrlf=true` would hand the probe. */
const MANIFEST_TEXT_CRLF = MANIFEST_TEXT.replace(/\n/g, '\r\n');

/** One asset as the releases/tags endpoint shapes it. `digestHex === null` means
 *  the asset carries NO `digest` key at all, which is what mid-upload looks
 *  like from outside. */
const rAsset = (name, digestHex, state = 'uploaded') => {
  const a = { name, state };
  if (digestHex !== null) a.digest = `sha256:${digestHex}`;
  return a;
};

/** The release as it looks when the publish did exactly what it claimed. The
 *  manifest is an asset too — `--emit-assets` puts it FIRST — so there are
 *  THREE, not two. */
const rGood = () => [rAsset(MANIFEST_NAME, MANIFEST_DIGEST), rAsset(A_LINUX, H_LINUX), rAsset(A_WIN, H_WIN)];

function writeManifest(text = MANIFEST_TEXT) {
  const f = join(TMP, `sha256sums-${(seq += 1)}`);
  writeFileSync(f, text);
  return f;
}

/** ⚠️ THE HOST'S OWN ENVIRONMENT MUST NEVER DECIDE THE ANSWER — the same defect
 *  `playEnv` above exists for. Anyone who has ever run `gh auth login` has
 *  GH_TOKEN or GITHUB_TOKEN exported, and the no-credential test below would
 *  then take the NETWORK path on their machine and the offline path on CI. */
function releaseEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    const u = k.toUpperCase();
    if (u === RELEASE_TOKEN_ENV || u === 'GITHUB_TOKEN') delete env[k];
  }
  return { ...env, ...extra };
}

function runReleaseArgs(args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: releaseEnv(extraEnv) });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Runs the REAL script over canned release reads — one per attempt, exactly as
 *  the HTTP and Play fixture modes above do. Both retry sleeps are guarded by
 *  `!canned`, so a six-attempt exhaustion costs nothing. */
function runRelease(canned, { manifestText = MANIFEST_TEXT, manifestPath = null } = {}) {
  const f = join(TMP, `release-fx-${(seq += 1)}.json`);
  writeFileSync(f, JSON.stringify(canned));
  return runReleaseArgs([
    '--release-repo',
    R_REPO,
    '--release-tag',
    R_TAG,
    '--release-manifest',
    manifestPath ?? writeManifest(manifestText),
    '--release-fixture',
    f,
  ]);
}

describe('post-deploy-smoke — the release asset decision [14]O-7', () => {
  test('🔴 the fixture manifest digest agrees with an INDEPENDENT hasher, not only with the probe', () => {
    // If this ever goes red, do NOT repaste node's answer over the literal. The
    // literal is the outside world; node is the thing on trial. See the block
    // comment on MANIFEST_DIGEST.
    const f = writeManifest();
    const bytes = readFileSync(f);
    assert.equal(bytes.length, 319, 'the fixture manifest is no longer the 319 bytes that were hashed externally');
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      MANIFEST_DIGEST,
      'node no longer agrees with certutil and sha256sum about these bytes — the fixture drifted, or the hash did',
    );
  });

  test('PASSES when the release carries every manifested asset AND the manifest itself, by digest', () => {
    const v = judgeReleaseAssets({ assets: rGood(), manifestText: MANIFEST_TEXT, manifestDigest: MANIFEST_DIGEST });
    assert.equal(v.ok, true, v.reason);
    // THREE: the two the manifest names, plus SHA256SUMS. A `matched` of 2 would
    // mean the manifest itself is shipped unverified, which is the file every
    // downloader checks the others against.
    assert.equal(v.matched, 3);
  });

  test('an EMPTY manifest is COVERAGE LOST, never a pass, and waiting cannot help', () => {
    // The trap this branch exists for: every loop below ranges over `entries`,
    // so an empty manifest satisfies all of them vacuously. A release with
    // nothing in it would verify perfectly.
    const v = judgeReleaseAssets({ assets: rGood(), manifestText: '# commit: abc\n', manifestDigest: MANIFEST_DIGEST });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false, 'a manifest that names nothing will not grow entries by being read again');
    assert.ok(v.reason.includes('COVERAGE LOST'), v.reason);
    assert.ok(v.reason.includes('An empty integrity record verifies an empty release.'), v.reason);
  });

  test('an `assets` that is NOT AN ARRAY is a failure naming the type, and is not retryable', () => {
    const v = judgeReleaseAssets({
      assets: { [A_WIN]: 'ok' },
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false, 'the API answering a different SHAPE is not a propagation delay');
    assert.ok(v.reason.includes('returned no `assets` array (got object)'), v.reason);
  });

  test('a MISSING asset is RETRYABLE and names the asset that is absent', () => {
    const v = judgeReleaseAssets({
      assets: rGood().filter((a) => a.name !== A_WIN),
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true, 'from outside, an asset that has not landed and one that never will look identical');
    assert.ok(v.reason.includes(`the release does NOT carry: ${A_WIN}`), v.reason);
    assert.ok(v.reason.includes('If this persists to the ceiling'), v.reason);
  });

  test('a MISSING SHA256SUMS is caught too — the manifest is one of the assets', () => {
    const v = judgeReleaseAssets({
      assets: rGood().filter((a) => a.name !== MANIFEST_NAME),
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true);
    assert.ok(v.reason.includes(`the release does NOT carry: ${MANIFEST_NAME}`), v.reason);
  });

  test('an asset whose state is NOT `uploaded` is RETRYABLE and reports the state it saw', () => {
    const v = judgeReleaseAssets({
      assets: [rAsset(MANIFEST_NAME, MANIFEST_DIGEST), rAsset(A_LINUX, H_LINUX), rAsset(A_WIN, H_WIN, 'starter')],
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true, 'mid-upload is the ONE state here that resolves on its own');
    assert.ok(v.reason.includes(`${A_WIN} state="starter"`), v.reason);
  });

  test('an asset carrying NO digest yet is RETRYABLE — an absent hash is not a matching hash', () => {
    // 🔴 THE FAIL-OPEN THIS FORBIDS. `String(undefined ?? '')` is `''`; if the
    // empty-digest check were dropped, `'' !== 'sha256:…'` would land in `wrong`
    // and report DIFFERENT BYTES for an asset that is merely still uploading —
    // and if it were compared the other way it would PASS.
    const v = judgeReleaseAssets({
      assets: [rAsset(MANIFEST_NAME, MANIFEST_DIGEST), rAsset(A_LINUX, H_LINUX), rAsset(A_WIN, null)],
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, true);
    assert.ok(v.reason.includes(`${A_WIN} carries no \`digest\` yet`), v.reason);
  });

  test('🔴 a null manifestDigest is a NAME-ONLY match and is NOT a pass', () => {
    // The single most dangerous shape in this function: everything is present,
    // everything is uploaded, and the only asset that could not be hashed is the
    // one every downloader checks the others against. Presence is a weaker read
    // than a hash, and a weaker read reporting itself as a pass is how a probe
    // stops probing.
    const v = judgeReleaseAssets({ assets: rGood(), manifestText: MANIFEST_TEXT, manifestDigest: null });
    assert.equal(v.ok, false, 'a name-only match reported ok — the manifest would ship unverified');
    assert.equal(v.retry, true);
    assert.ok(v.reason.includes(`${MANIFEST_NAME} could be matched by NAME only`), v.reason);
    assert.ok(v.reason.includes('the caller supplied no digest for it'), v.reason);
  });

  test('🔴 a DIGEST MISMATCH is the whole point, and it is NOT retryable', () => {
    const bad = rGood().map((a) => (a.name === A_WIN ? rAsset(A_WIN, H_LINUX) : a));
    const v = judgeReleaseAssets({ assets: bad, manifestText: MANIFEST_TEXT, manifestDigest: MANIFEST_DIGEST });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false, "an asset's digest is fixed at upload; waiting turns a real divergence into a slower one");
    assert.ok(v.reason.includes('the release serves DIFFERENT BYTES than this run built'), v.reason);
    assert.ok(v.reason.includes(`${A_WIN}: the release carries sha256:${H_LINUX}, this run built sha256:${H_WIN}`), v.reason);
  });

  test('an EXTRA asset the manifest does not name is a failure, and is NOT retryable', () => {
    // Both directions or it is not an integrity check: a file in the release that
    // nothing checksummed is a file no downloader can verify.
    const v = judgeReleaseAssets({
      assets: [...rGood(), rAsset('subly-installer-UNSIGNED.exe', H_WIN)],
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false, 'an asset nobody staged does not appear by propagation');
    assert.ok(v.reason.includes('the release carries asset(s) the manifest does not name'), v.reason);
    assert.ok(v.reason.includes('subly-installer-UNSIGNED.exe'), v.reason);
  });

  test('a MISMATCH alongside a MISSING asset stays NON-retryable — divergence outranks propagation', () => {
    // ⚠️ ORDER IS LOAD-BEARING. `wrong`/`extra` are tested BEFORE
    // `missing`/`pending`. Swap the two blocks and this release would be retried
    // six times over ten-second gaps before reporting a divergence that was
    // already final on the first read.
    const assets = rGood().filter((a) => a.name !== A_LINUX).map((a) => (a.name === A_WIN ? rAsset(A_WIN, H_LINUX) : a));
    const v = judgeReleaseAssets({ assets, manifestText: MANIFEST_TEXT, manifestDigest: MANIFEST_DIGEST });
    assert.equal(v.ok, false);
    assert.equal(v.retry, false, 'a definitive divergence was reported as a wait-and-see');
    assert.ok(v.reason.includes('DIFFERENT BYTES'), v.reason);
  });
});

describe('post-deploy-smoke — the release read-back across line endings and case', () => {
  // ⚠️ WHY THESE ARE HERE. This limb has no `process.platform` in it — grepped
  // 2026-08-27, zero hits in the whole script — so there is no OS branch to
  // drive. What it DOES read is line endings (a digest over raw bytes, a parser
  // that splits on LF) and case (digests folded, names not). Those are the seams
  // where a Windows gate and a Linux runner can disagree, so they are driven
  // here from both sides rather than assumed.

  test('a CRLF manifest names the SAME assets as an LF one — the parser is line-ending agnostic', () => {
    assert.notEqual(MANIFEST_TEXT_CRLF, MANIFEST_TEXT, 'the fixture manifest has no newlines left to convert');
    const v = judgeReleaseAssets({
      assets: rGood(),
      manifestText: MANIFEST_TEXT_CRLF,
      manifestDigest: MANIFEST_DIGEST,
    });
    assert.equal(v.ok, true, v.reason);
    assert.equal(v.matched, 3, 'a stray CR was read as part of an asset NAME');
  });

  test('🔴 but the manifest DIGEST is over the BYTES, so a CRLF checkout is CAUGHT, not shrugged off', () => {
    // The honest consequence of the test above: LF and CRLF parse the same and
    // hash DIFFERENTLY. That is correct — the digest describes the file the
    // release actually serves — and it means a runner that rewrote line endings
    // between build and publish is reported as divergence, by name, on the one
    // asset it affected. Driven end to end so the exit code is exercised too.
    const r = runRelease([{ assets: rGood() }], { manifestText: MANIFEST_TEXT_CRLF });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('the release serves DIFFERENT BYTES than this run built'), r.out);
    assert.ok(r.out.includes(`${MANIFEST_NAME}: the release carries sha256:${MANIFEST_DIGEST}`), r.out);
    // …and ONLY that asset. The other two are byte-identical either way.
    assert.ok(!r.out.includes(A_WIN), r.out);
    assert.ok(!r.out.includes(A_LINUX), r.out);
  });

  test('an UPPERCASE digest is the SAME digest — GitHub folding its hex is not a divergence', () => {
    const shouty = rGood().map((a) => ({ ...a, digest: a.digest.toUpperCase() }));
    const v = judgeReleaseAssets({
      assets: shouty,
      manifestText: MANIFEST_TEXT,
      manifestDigest: MANIFEST_DIGEST.toUpperCase(),
    });
    assert.equal(v.ok, true, v.reason);
  });

  test('🔴 an asset NAME differing only in CASE is NOT the asset the manifest named', () => {
    // Deliberate and worth pinning: Windows would call these one file, the
    // release calls them two, and the release is right — a downloader asking for
    // the manifested name gets a 404. It surfaces as an EXTRA, which is
    // non-retryable, so this fails FAST rather than after six ten-second waits.
    const wrongCase = rGood().map((a) => (a.name === A_WIN ? { ...a, name: A_WIN.toUpperCase() } : a));
    const v = judgeReleaseAssets({ assets: wrongCase, manifestText: MANIFEST_TEXT, manifestDigest: MANIFEST_DIGEST });
    assert.equal(v.ok, false, 'the name join is casefolding — a manifested name that 404s was reported as shipped');
    assert.equal(v.retry, false);
    assert.ok(v.reason.includes(A_WIN.toUpperCase()), v.reason);
  });
});

describe('post-deploy-smoke — the release limb end to end, through the real script', () => {
  test('EXIT 0 and a banner when the release carries what this run built', () => {
    const r = runRelease([{ assets: rGood() }]);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes(`ok  ${R_REPO}@${R_TAG} carries all 3 asset(s) this run built`), r.out);
    assert.ok(r.out.includes('every one matched by sha256 digest (attempt 1/6)'), r.out);
    // The fixture seam announces itself so it can never be mistaken for a real
    // read in a log. The REQUIRED COVERAGE block below asserts CI does not use it.
    assert.ok(r.out.includes('OFFLINE RELEASE FIXTURE MODE'), r.out);
    // 🔴 no credential on any path, ever.
    assert.ok(!r.out.includes('Bearer'), r.out);
  });

  test('EXIT 1 on a digest mismatch, naming the divergence', () => {
    const bad = rGood().map((a) => (a.name === A_LINUX ? rAsset(A_LINUX, H_WIN) : a));
    const r = runRelease([{ assets: bad }]);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('RELEASE ASSET SMOKE FAILED'), r.out);
    assert.ok(r.out.includes('the release serves DIFFERENT BYTES than this run built'), r.out);
  });

  test('a TRANSIENT unreadable answer followed by a good read is a PASS', () => {
    const r = runRelease([{ error: 'no release is readable at tag v9.9.9-fixture (HTTP 404)' }, { assets: rGood() }]);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes('(attempt 2/6)'), r.out);
  });

  test('an asset that ARRIVES on a later attempt is a PASS — the retry limb actually loops', () => {
    const r = runRelease([{ assets: rGood().filter((a) => a.name !== A_WIN) }, { assets: rGood() }]);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes('(attempt 2/6)'), r.out);
  });

  test('🔴 a MISMATCH on the first read STOPS — a later good read does not rescue it', () => {
    // ⚠️ THIS IS THE TEST FOR `if (!verdict.retry) break;`, and nothing else in
    // this file covers it. Delete that line and the run below reads the second,
    // matching fixture entry and EXITS 0 — a release that served wrong bytes
    // reported as shipped, which is the exact state this limb exists to end.
    // The two cases above are its controls: they show the loop DOES continue
    // when the verdict says retry, so a green here cannot be "the loop is dead".
    const bad = rGood().map((a) => (a.name === A_WIN ? rAsset(A_WIN, H_LINUX) : a));
    const r = runRelease([{ assets: bad }, { assets: rGood() }]);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('the release serves DIFFERENT BYTES than this run built'), r.out);
    assert.ok(!r.out.includes('attempt 2/6'), r.out);
  });

  test('a release that NEVER carries the asset exhausts the ceiling and EXITS 1', () => {
    // One entry, so `canned[Math.min(i, len-1)]` repeats it for all six attempts.
    const r = runRelease([{ assets: rGood().filter((a) => a.name !== A_WIN) }]);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`the release does NOT carry: ${A_WIN}`), r.out);
    assert.ok(r.out.includes('Ceiling: 6 attempt(s) 10s apart'), r.out);
  });

  test('an API that is unreadable on EVERY attempt EXITS 1 — "could not tell" is not "it is fine"', () => {
    const r = runRelease([{ error: 'releases/tags answered HTTP 502' }]);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('the release could not be read: releases/tags answered HTTP 502'), r.out);
  });

  test('EXIT 1 when the MANIFEST cannot be read — a probe with no expectation is not a probe', () => {
    const r = runRelease([{ assets: rGood() }], { manifestPath: join(TMP, 'no-such-manifest-at-all') });
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('could not be read'), r.out);
    assert.ok(r.out.includes('A probe with no expectation is not a probe.'), r.out);
  });

  test(`EXIT 1 with NO ${RELEASE_TOKEN_ENV} — a probe that cannot run reliably is a failure, never a pass`, () => {
    // ⚠️ THE ONE TEST HERE THAT IS NOT STRUCTURALLY OFFLINE, AND ITS LIMIT. It
    // runs WITHOUT `--release-fixture`, because the credential check is skipped
    // when `canned` is set. On the real code it returns BEFORE any fetch, so no
    // packet leaves the machine — `releaseEnv` guarantees the empty credential
    // that makes that so. If somebody deleted the check, this test would go to
    // the network and take the six-attempt ceiling to fail. That is a SLOW red,
    // not a false green, which is the direction to fail in.
    const r = runReleaseArgs([
      '--release-repo',
      R_REPO,
      '--release-tag',
      R_TAG,
      '--release-manifest',
      writeManifest(),
    ]);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes(`${RELEASE_TOKEN_ENV} is empty`), r.out);
    assert.ok(r.out.includes('rate-limited by an IP every runner shares'), r.out);
    assert.ok(!r.out.includes('carries all'), r.out);
  });
});

describe('post-deploy-smoke — the release limb argument contract', () => {
  // 🔴 EVERY CASE BELOW ASSERTS THE EXIT CODE, NOT `!== 0`. A negative that only
  // asserts "it failed" is satisfied by exit 2 on a typo'd flag while never
  // reaching the branch it claims to test — which is how a suite of red tests
  // can cover nothing at all. Exit 2 here means USAGE and exit 1 means VERDICT,
  // and the two must never be read as each other.

  test('EXIT 2: --release-repo without --release-tag', () => {
    const r = runReleaseArgs(['--release-repo', R_REPO, '--release-manifest', writeManifest()]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('usage: post-deploy-smoke.mjs --release-repo <owner/repo> --release-tag <tag>'), r.out);
  });

  test('EXIT 2: --release-tag without --release-manifest', () => {
    const r = runReleaseArgs(['--release-repo', R_REPO, '--release-tag', R_TAG]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('--release-manifest <SHA256SUMS>'), r.out);
  });

  test('EXIT 2: --release-fixture ALONE selects the mode and is then incomplete', () => {
    // Any ONE of the four flags selects this branch, so a half-written invocation
    // exits 2 instead of falling through and being reported as a missing --url.
    const f = join(TMP, `release-lonely-${(seq += 1)}.json`);
    writeFileSync(f, JSON.stringify([{ assets: rGood() }]));
    const r = runReleaseArgs(['--release-fixture', f]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('usage: post-deploy-smoke.mjs --release-repo'), r.out);
    assert.ok(!r.out.includes('--url <u>'), r.out);
  });

  test('EXIT 2: an UNREADABLE fixture file', () => {
    const r = runReleaseArgs([
      '--release-repo',
      R_REPO,
      '--release-tag',
      R_TAG,
      '--release-manifest',
      writeManifest(),
      '--release-fixture',
      join(TMP, 'no-such-fixture.json'),
    ]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('could not read release fixture'), r.out);
  });

  test('EXIT 2: a fixture that is not an ARRAY', () => {
    const f = join(TMP, `release-obj-${(seq += 1)}.json`);
    writeFileSync(f, JSON.stringify({ assets: rGood() }));
    const r = runReleaseArgs([
      '--release-repo',
      R_REPO,
      '--release-tag',
      R_TAG,
      '--release-manifest',
      writeManifest(),
      '--release-fixture',
      f,
    ]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('the release fixture must be a non-empty array'), r.out);
  });

  test('EXIT 2: an EMPTY array fixture — zero canned reads is not zero failures', () => {
    // `canned[Math.min(i, canned.length - 1)]` on an empty array is
    // `canned[-1]`, i.e. `undefined`, which `?? {}` turns into a read with no
    // assets and no error. Caught at the door instead.
    const f = join(TMP, `release-empty-${(seq += 1)}.json`);
    writeFileSync(f, '[]');
    const r = runReleaseArgs([
      '--release-repo',
      R_REPO,
      '--release-tag',
      R_TAG,
      '--release-manifest',
      writeManifest(),
      '--release-fixture',
      f,
    ]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('the release fixture must be a non-empty array'), r.out);
  });
});

/** The value of the step's own `if:` key, or null. Same line-and-indent scan as
 *  `stepEnvKeys`: `if:` must sit at the step's key indent, so an `if` inside a
 *  `run:` block scalar can never satisfy it. NOT a YAML parse. */
function stepIf(step) {
  for (const l of step.lines) {
    if (indentOf(l) !== step.keyIndent) continue;
    const m = l.trim().match(/^if:\s*(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

describe('post-deploy-smoke — REQUIRED COVERAGE of the release limb', () => {
  test('REQUIRED COVERAGE: the release limb is still exported, and this file still imports it', () => {
    assert.equal(typeof judgeReleaseAssets, 'function', 'judgeReleaseAssets is gone — the release decision is untested');
    assert.equal(typeof smokeReleaseAssets, 'function', 'smokeReleaseAssets is gone — the release limb is untested');
    assert.equal(GITHUB_API_ORIGIN, 'https://api.github.com');
    assert.equal(GITHUB_API_VERSION, '2022-11-28');
    assert.equal(RELEASE_TOKEN_ENV, 'GH_TOKEN');
    // Every fixture above spells the manifest asset through this constant; if it
    // changes, they are testing a name the release no longer carries.
    assert.equal(MANIFEST_NAME, 'SHA256SUMS');
  });

  test('REQUIRED COVERAGE: the script still declares the release limb and its flags', () => {
    // ⚠️ The `^export … function(` anchors are comment-proof on their own. The
    // flag pins are PLAIN SUBSTRINGS on a self-documenting file — its usage
    // banner spells `--release-repo`, `--release-tag`, `--release-manifest` and
    // `--release-fixture` in comments — so they read `codeOnly(src)`, exactly as
    // the Play block above had to after all three of its pins were measured
    // inert. THEIR LIMIT: substring pins with whole-line comments blanked. They
    // do not prove a flag is parsed or the URL fetched; the end-to-end runs
    // above do that. These pin the spellings those runs depend on.
    const src = readFileSync(SCRIPT, 'utf8');
    assert.match(src, /^export function judgeReleaseAssets\(/m, 'judgeReleaseAssets is no longer a declared function');
    assert.match(
      src,
      /^export async function smokeReleaseAssets\(/m,
      'smokeReleaseAssets is no longer a declared async function',
    );
    const code = codeOnly(src);
    for (const f of ['--release-repo', '--release-tag', '--release-manifest', '--release-fixture']) {
      assert.ok(code.includes(f), `the script no longer accepts ${f} (its usage comment does not count)`);
    }
    assert.match(code, /releases\/tags\//, 'the read-by-tag transport is gone (the JSDoc naming it does not count)');
  });

  test('REQUIRED COVERAGE: build-platforms.yml still RUNS the limb, on a tag, with a credential', () => {
    // 🔴 THE LIMB HAS EXACTLY ONE CALLER AND IT HAS NEVER FIRED. There are no
    // tags in this repository, so nothing in CI has ever executed one line of
    // this limb; if the invocation is deleted, commented out, stripped of
    // GH_TOKEN, or left in offline fixture mode, NO RUN ANYWHERE WOULD GO RED.
    // This test is the only thing that notices. It cannot make the limb run — no
    // test can — it can only make removing the call site break a build.
    const wf = readFileSync(join(ROOT, '.github', 'workflows', 'build-platforms.yml'), 'utf8');
    // BY LINE, AND THE LINE MUST *START* WITH THE COMMAND — the defect the Play
    // block above documents measuring: a whole-file `indexOf` stays green when
    // the step is commented out with `# node tooling/ops/post-deploy-smoke.mjs …`.
    const INVOKE = 'node tooling/ops/post-deploy-smoke.mjs --release-repo';
    const lines = wf.split('\n');
    const idx = lines.findIndex((l) => l.trim().startsWith(INVOKE));
    assert.notEqual(idx, -1, 'build-platforms.yml no longer RUNS the release read-back — it is gone or commented out');
    const line = lines[idx];
    assert.match(line, /--release-tag\s+\S+/, 'the release smoke invocation names no tag');
    assert.match(line, /--release-manifest\s+\S+/, 'the release smoke invocation carries no manifest, so it asserts nothing');
    assert.ok(
      !line.includes('--release-fixture'),
      'build-platforms.yml runs the release smoke in OFFLINE FIXTURE MODE — it is reading a file, not the release',
    );
    const step = enclosingStep(lines, idx);
    assert.notEqual(step, null, 'the release smoke invocation is not inside a named step');
    // The credential, in the STEP'S OWN `env:` mapping. Same two limits the Play
    // block spells out and for the same reasons: hoisting GH_TOKEN to job or
    // workflow level is a legal refactor that turns this RED, and this is a
    // line-and-indent scan rather than a YAML parse. BOTH FAIL SAFE. If one
    // fires, teach the assertion; do not relax it.
    assert.ok(
      stepEnvKeys(step).some((k) => k.startsWith(`${RELEASE_TOKEN_ENV}:`)),
      `the step running the release smoke does not put ${RELEASE_TOKEN_ENV} in its own env: mapping — the probe would fail every run. (If it was hoisted to job or workflow level it IS in scope for real, but out of scope for this assertion: teach it, do not delete it.)`,
    );
    // ⚠️ AND THE GATE THAT KEEPS IT OFF EVERY NON-TAG RUN. Without this `if:` the
    // step runs on every branch push, fails on every one of them because there is
    // no release to read, and gets deleted within a day as a broken check. ITS
    // LIMIT, SAID OUT LOUD: this reads the step's own `if:` as TEXT. It does not
    // prove GitHub evaluates it, and rewriting the same gate as
    // `startsWith(github.ref, 'refs/tags/')` would be a FALSE RED — teach it.
    const gate = stepIf(step);
    assert.notEqual(gate, null, 'the release read-back step has no `if:` — it would run, and fail, on every branch push');
    assert.match(
      gate,
      /ref_type\s*==\s*'tag'/,
      `the release read-back step is no longer gated on a tag (its \`if:\` reads ${JSON.stringify(gate)})`,
    );
  });
});
