// ─────────────────────────────────────────────────────────────────────────────
// submit-common.test.mjs — requirePublishEnvironment, the one run-time read of
// the `store-publish` environment (C4b, 2026-09-25).
//
// submit-play, submit-snap, submit-windows-store and (through
// extensions/scripts/lib/store-environment.mjs) the three extension publishers
// all call it, so every refusal it makes is a refusal of seven publish paths.
// Each case below drives it in-process with an injected `env` and `fetchImpl`:
// no network, no child process, and a fetch that records what it was asked.
//
// Every case is written out by hand (assert-no-loop-cases.mjs).
//
// Run:  node --test tooling/ci/test/submit-common.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMMON = join(REPO, 'tooling', 'release', 'submit-common.mjs');
const { requirePublishEnvironment, PUBLISH_ENVIRONMENT, GITHUB_ENVIRONMENTS_API, githubToken } = await import(pathToFileURL(COMMON).href);

/** A run inside the lane, with everything the read needs. */
const LANE = Object.freeze({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'ghs-test' });

/** A fetch that answers every request with one response and records the requests. */
function answer(status, body) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fetchImpl, seen };
}

/** A fetch that must never be reached. */
function unreachable() {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    throw new Error('the read was reached');
  };
  return { fetchImpl, seen };
}

const GATED = { protection_rules: [{ id: 1, type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 55662283 } }] }] };

describe('requirePublishEnvironment — it refuses before the read', () => {
  test('refuses outside GitHub Actions and never fetches', async () => {
    const f = unreachable();
    const r = await requirePublishEnvironment({ env: { GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }, fetchImpl: f.fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /^FAIL a store publish runs only inside GitHub Actions/);
    assert.deepEqual(f.seen, []);
  });

  test('refuses a blank GITHUB_REPOSITORY — there is no repository to read the environment of', async () => {
    const f = unreachable();
    const r = await requirePublishEnvironment({ env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: '  ', GITHUB_TOKEN: 't' }, fetchImpl: f.fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /runs only inside GitHub Actions \(GITHUB_ACTIONS=true and GITHUB_REPOSITORY set\)/);
    assert.deepEqual(f.seen, []);
  });

  test('refuses with no token, names the API it could not read, and never fetches', async () => {
    const f = unreachable();
    const r = await requirePublishEnvironment({ env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: '   ' }, fetchImpl: f.fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /needs GITHUB_TOKEN to read the publish environment's protection rules \("store-publish"\)/);
    assert.ok(r.lines.includes(`     ${GITHUB_ENVIRONMENTS_API}`), r.lines.join('\n'));
    assert.deepEqual(f.seen, []);
  });

  test('refuses a GITHUB_API_URL that is neither the real origin nor loopback, before the token leaves', async () => {
    const f = unreachable();
    const r = await requirePublishEnvironment({ env: { ...LANE, GITHUB_API_URL: 'https://evil.example.com' }, fetchImpl: f.fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /^FAIL GITHUB_API_URL points at https:\/\/evil\.example\.com, which is neither/);
    assert.deepEqual(f.seen, []);
  });
});

describe('requirePublishEnvironment — the read itself', () => {
  test('GETs the one environment on the real origin with the job token', async () => {
    const f = answer(200, GATED);
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: f.fetchImpl, userAgent: 'nikatru-test' });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(f.seen.length, 1);
    assert.equal(f.seen[0].url, 'https://api.github.com/repos/o/r/environments/store-publish');
    assert.equal(f.seen[0].init.headers.authorization, 'Bearer ghs-test');
    assert.equal(f.seen[0].init.headers['x-github-api-version'], '2022-11-28');
    assert.equal(f.seen[0].init.headers['user-agent'], 'nikatru-test');
    assert.equal(r.url, f.seen[0].url);
    assert.equal(PUBLISH_ENVIRONMENT, 'store-publish');
  });

  test('falls back to GH_TOKEN when GITHUB_TOKEN is absent', async () => {
    const f = answer(200, GATED);
    const r = await requirePublishEnvironment({ env: { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'gh-fallback' }, fetchImpl: f.fetchImpl });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(f.seen[0].init.headers.authorization, 'Bearer gh-fallback');
    assert.equal(githubToken({ GH_TOKEN: ' gh-fallback ' }), 'gh-fallback');
  });

  test('a loopback GITHUB_API_URL is used, and the success lines say it is a test seam', async () => {
    const f = answer(200, GATED);
    const r = await requirePublishEnvironment({ env: { ...LANE, GITHUB_API_URL: 'http://127.0.0.1:9/' }, fetchImpl: f.fetchImpl });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.equal(f.seen[0].url, 'http://127.0.0.1:9/repos/o/r/environments/store-publish');
    assert.match(r.lines[0], /^⬜ {3}GITHUB_API_URL override in effect: http:\/\/127\.0\.0\.1:9 — this is a LOOPBACK TEST SEAM/);
  });

  test('a fetch that throws is a refusal — an unreadable gate has not been shown to exist', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /^FAIL could not reach https:\/\/api\.github\.com\/repos\/o\/r\/environments\/store-publish \(ECONNREFUSED\)/);
  });

  test('a 404 is the fail-open state and is refused by name', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(404, { message: 'Not Found' }).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /^FAIL the "store-publish" environment does not exist in o\/r\./);
    assert.match(r.lines.join('\n'), /referencing a missing environment CREATES it/);
  });

  test('any other non-2xx is a refusal, not a pass', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(500, {}).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /^FAIL got HTTP 500 from https:\/\/api\.github\.com\/repos\/o\/r\/environments\/store-publish/);
  });
});

describe('requirePublishEnvironment — the reviewer rule', () => {
  test('refuses an environment with no rules (the auto-created state) and prints what it read', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { protection_rules: [] }).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /carries NO required reviewer/);
    assert.equal(r.lines[1], '     protection_rules = []');
  });

  test('refuses a body with no protection_rules field at all', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { name: 'store-publish' }).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /carries NO required reviewer/);
  });

  test('refuses a body that is not JSON — it shows no rules', async () => {
    const fetchImpl = async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /carries NO required reviewer/);
  });

  test('refuses a wait-timer-only environment — a delay is not an approval', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { protection_rules: [{ id: 9, type: 'wait_timer', wait_timer: 30 }] }).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /carries NO required reviewer/);
  });

  test('refuses a required_reviewers rule whose reviewers list is EMPTY — it names nobody to approve', async () => {
    // The one direction in which unifying the four copies narrowed windows'
    // rule: submit-windows-store PG-6 keyed on the `type` label and accepted this.
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { protection_rules: [{ id: 2, type: 'required_reviewers', reviewers: [] }] }).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /carries NO required reviewer/);
  });

  test('refuses reviewers under any other rule type — only a required_reviewers rule is one', async () => {
    // The direction in which the strict intersection narrowed the other three
    // copies (PC4B-1): they keyed on a non-empty `reviewers` list alone.
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { protection_rules: [{ id: 5, type: 'wait_timer', reviewers: [{ id: 1 }] }] }).fetchImpl });
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /carries NO required reviewer/);
  });

  test('accepts a rule that carries reviewers, counts them, and returns the body it read', async () => {
    const body = { protection_rules: [{ id: 3, type: 'wait_timer', wait_timer: 5 }, { id: 4, type: 'required_reviewers', reviewers: [{ id: 1 }, { id: 2 }] }], can_admins_bypass: false };
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, body).fetchImpl });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.match(r.lines[0], /^ok {3}publish gate — "store-publish" carries 2 required reviewer\(s\) and `can_admins_bypass` is false/);
    assert.equal(r.body, body);
  });
});

describe('requirePublishEnvironment — what the success line may claim', () => {
  test('can_admins_bypass true: the requirement is verified, the approval is NOT claimed', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { ...GATED, can_admins_bypass: true }).fetchImpl });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.match(r.lines[0], /carries 1 required reviewer\(s\)\. ⚠️ `can_admins_bypass` is true, so reaching this line does NOT prove one of them approved/);
    assert.doesNotMatch(r.lines[0], /because one of them approved it/);
  });

  test('can_admins_bypass ABSENT is read as true — only an explicit false earns the approval claim', async () => {
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, GATED).fetchImpl });
    assert.equal(r.ok, true, r.lines.join('\n'));
    assert.match(r.lines[0], /does NOT prove one of them approved/);
  });

  test('a label names the caller\'s gate on the FAIL line and on the ok line', async () => {
    const refused = await requirePublishEnvironment({ env: LANE, label: 'PG-6', fetchImpl: answer(404, {}).fetchImpl });
    assert.match(refused.lines[0], /^FAIL PG-6 · the "store-publish" environment does not exist in o\/r\./);
    const passed = await requirePublishEnvironment({ env: LANE, label: 'PG-5', fetchImpl: answer(200, GATED).fetchImpl });
    assert.match(passed.lines[0], /^ok {3}PG-5 publish gate — "store-publish" carries 1 required reviewer\(s\)/);
  });
});

describe('requirePublishEnvironment — it never exits (TRAPS shell-12)', () => {
  test('a refusal returns a verdict and leaves process.exitCode alone', async () => {
    // submit-windows-store runs on a Windows runner, where process.exit() while
    // undici holds a socket leaves with 3221226505. The function therefore only
    // reports; the caller chooses how to stop.
    const before = process.exitCode;
    const r = await requirePublishEnvironment({ env: LANE, fetchImpl: answer(200, { protection_rules: [] }).fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(process.exitCode, before);
  });
});
