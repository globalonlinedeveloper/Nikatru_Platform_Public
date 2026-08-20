// ─────────────────────────────────────────────────────────────────────────────
// deployment-record.test.mjs — the [10]D-9 record shape must round-trip, and
// record-deployment.mjs must REFUSE a store record nobody could open.
//
// 🔴 THE SHAPE IS DECIDED BEFORE THE FIRST SUBMISSION, ON PURPOSE. There has
// never been a store submission (no publisher account exists — [10]D-4 /
// OWNER_QUEUE A-2, A-3, A-4, A-6), so `readSubmissions` returns an EMPTY set
// today and that is the correct answer, not a defect. Deciding the encoding
// afterwards would mean re-writing a record that is by then the only copy of
// what happened: the console history is behind an account, and D-9's question
// is asked at exactly the moment nobody can log in.
//
// The NEGATIVE TEST that matters most is the LEGACY one: a hand-written
// `live at abc12345` description must decode as UNPARSEABLE, never as `live`.
// A reader that guessed would report a store listing live on the strength of a
// web deploy's prose sentence — the second source of truth this requirement
// exists to prevent.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  STATES,
  MAX_DESCRIPTION,
  encodeDescription,
  decodeDescription,
  resolveEnvironment,
  readSubmissions,
  calendarMonth,
  SUBMIT_TIME_STATES,
  STATE_MEANING,
} from '../deployment-record.mjs';
import { RECORD_CALL, expandMatrixEnvironment } from '../workflow-scan.mjs';
import { isRetryable, retryDelayMs, RETRY_ATTEMPTS } from '../record-deployment.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CI_DIR, '../..');
const RECORDER = join(CI_DIR, 'record-deployment.mjs');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-deprec-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const REGISTER = {
  channels: [
    { id: 'web', kind: 'web', deploymentEnvironment: '{app}-web' },
    { id: 'windows-store', kind: 'store', deploymentEnvironment: '{app}-windows-store' },
    { id: 'android-play', kind: 'store', deploymentEnvironment: '{app}-android-play' },
  ],
  serviceEnvironments: [
    { id: 'subly-api', kind: 'service', deploymentEnvironment: 'subly-api' },
    { id: 'platform', kind: 'service', deploymentEnvironment: 'platform' },
  ],
};

/** 🔴 THE REAL FILE, not the fixture above.
 *
 *  A fixture I wrote encodes the same understanding as the code I wrote, so the
 *  two agree by construction and prove nothing about the register that actually
 *  ships. The five red `deploy-workers.yml` runs from 2026-08-02 were a
 *  disagreement between the SHIPPING register and the SHIPPING workflows, and
 *  every fixture in this file was green throughout. */
const REAL_REGISTER = JSON.parse(
  readFileSync(resolve(ROOT, 'tooling/channel-register.json'), 'utf8'),
);

/** Run the real recorder with no network reachable — every case here fails or
 *  succeeds BEFORE the first fetch, which is exactly the boundary under test. */
function record(args, env = {}) {
  const r = spawnSync(process.execPath, [RECORDER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'x/y', GITHUB_SHA: 'abc12345deadbeef', GH_TOKEN: 't', ...env },
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('deployment-record — the encoding round-trips', () => {
  for (const state of STATES) {
    for (const listingUrl of [null, 'https://apps.microsoft.com/detail/9NBLGGH4NNS1']) {
      test(`(${state}, ${listingUrl ? 'with' : 'without'} a listing URL) survives encode → decode`, () => {
        const text = encodeDescription({ state, sha: 'abc12345deadbeef', listingUrl });
        const back = decodeDescription(text);
        assert.equal(back.ok, true, text);
        assert.equal(back.state, state);
        assert.equal(back.sha, 'abc12345');
        assert.equal(back.listingUrl, listingUrl);
      });
    }
  }

  test('an unknown state cannot be encoded', () => {
    assert.throws(() => encodeDescription({ state: 'shipped', sha: 'abc12345' }), /unknown state "shipped"/);
  });

  test('a non-sha cannot be encoded — the record must name the commit that shipped', () => {
    assert.throws(() => encodeDescription({ state: 'live', sha: 'not-a-sha' }), /not a hex commit sha/);
  });

  test('a record that would be TRUNCATED is refused, not written', () => {
    const long = `https://example.invalid/${'x'.repeat(MAX_DESCRIPTION)}`;
    assert.throws(() => encodeDescription({ state: 'live', sha: 'abc12345', listingUrl: long }), /truncat/i);
  });

  test('a listing URL with whitespace is refused — the one-line encoding cannot carry it', () => {
    assert.throws(() => encodeDescription({ state: 'live', sha: 'abc12345', listingUrl: 'https://a b' }), /whitespace/);
  });
});

describe('deployment-record — the LEGACY form is unparseable, never "live"', () => {
  // The negative test the whole version tag exists for.
  test('a hand-written `live at <sha>` decodes as UNPARSEABLE', () => {
    const r = decodeDescription('live at abc12345');
    assert.equal(r.ok, false);
    assert.match(r.reason, /Legacy prose records are reported as UNPARSEABLE/);
  });

  test('the word "live" alone is not a state', () => {
    assert.equal(decodeDescription('live').ok, false);
  });

  test('an empty description is unparseable', () => {
    assert.equal(decodeDescription('').ok, false);
    assert.equal(decodeDescription(null).ok, false);
  });

  test('a record with a bad state is unparseable, not defaulted', () => {
    const r = decodeDescription('nk1 state=shipped sha=abc12345');
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown state "shipped"/);
  });

  test('a record with no sha is unparseable', () => {
    const r = decodeDescription('nk1 state=live');
    assert.equal(r.ok, false);
    assert.match(r.reason, /is not an 8-character hex commit sha/);
  });

  test('a token that is not key=value is unparseable', () => {
    assert.equal(decodeDescription('nk1 state=live sha=abc12345 oops').ok, false);
  });
});

describe('deployment-record — the environment resolves against the register', () => {
  test('`subly-android-play` resolves to android-play, not to a channel called "play"', () => {
    const r = resolveEnvironment(REGISTER, 'subly-android-play');
    assert.equal(r.app, 'subly');
    assert.equal(r.channel.id, 'android-play');
  });

  test('`subly-web` resolves to the web row', () => {
    assert.equal(resolveEnvironment(REGISTER, 'subly-web').channel.id, 'web');
  });

  test('an environment no template matches resolves to null', () => {
    assert.equal(resolveEnvironment(REGISTER, 'subly-nowhere'), null);
  });

  test('a register with no channels resolves nothing', () => {
    assert.equal(resolveEnvironment({}, 'subly-web'), null);
  });

  // ── SERVICE ENVIRONMENTS — the five red deploy-workers runs from 2026-08-02 ──
  test('`subly-api` resolves to a service environment, not to nothing', () => {
    const r = resolveEnvironment(REGISTER, 'subly-api');
    assert.notEqual(r, null, 'a Worker deploy must be recordable');
    assert.equal(r.channel.id, 'subly-api');
    assert.equal(r.channel.kind, 'service');
  });

  test('`platform` resolves even though it is not app-scoped, and app is null', () => {
    const r = resolveEnvironment(REGISTER, 'platform');
    assert.notEqual(r, null);
    assert.equal(r.channel.kind, 'service');
    assert.equal(r.app, null, 'there is one platform Worker for every app — an app name here would be a guess');
  });

  // 🔴 THE ASSERTION MUST STILL BE ABLE TO FAIL. An environment claimed by
  // neither list is the input that proves this change fixed the cause instead of
  // deleting the check.
  test('an environment in NEITHER list is still refused', () => {
    assert.equal(resolveEnvironment(REGISTER, 'subly-nowhere'), null);
    assert.equal(resolveEnvironment(REGISTER, 'not-a-worker'), null);
  });

  test('a service environment is matched exactly, never as a prefix', () => {
    assert.equal(resolveEnvironment(REGISTER, 'platform-staging'), null);
    assert.equal(resolveEnvironment(REGISTER, 'subly-api-canary'), null);
  });

  // A service row must never satisfy the store rules: record-deployment.mjs
  // demands --listing-url for `kind === 'store'`, and readSubmissions counts
  // only those. If a service ever resolved as a store, a Worker deploy would be
  // filed in the submission ledger as a shipped app.
  // ── THE COVERAGE ASSERTION — real workflows against the real register ──────
  //
  // 🔴 THIS IS THE TEST THAT WOULD HAVE CAUGHT IT. Every fixture above was green
  // through all five red `deploy-workers.yml` runs, because the fixtures and the
  // matcher were written by the same hand and agreed with each other. The defect
  // lived between two files neither of them read: the workflows say
  // `record-deployment.mjs platform`, and the shipping register had no row that
  // could resolve it.
  //
  // Derived, never hardcoded — a literal list here would go stale the moment a
  // job is added, which is the same silent-drift class the register exists for.
  test('every record-deployment.mjs call site in every workflow resolves', () => {
    const dir = resolve(ROOT, '.github/workflows');
    // The app slugs a matrix leg expands over. [10]D-2b made deploy-web.yml a
    // matrix over the workspace, so its call site is
    // `record-deployment.mjs ${{ matrix.app }}-web` — and this test's OWN copy
    // of the call-site regex was one of the three that could not read it (it
    // matched nothing, and only the floor below noticed). The reader is
    // workflow-scan.mjs's now, shared with the two guards that need it.
    const slugs = JSON.parse(readFileSync(resolve(ROOT, 'catalog/apps.json'), 'utf8'))
      .map((a) => a?.slug)
      .filter(Boolean);
    assert.ok(slugs.length > 0, 'the app catalogue yielded no slug — a matrix leg would expand to nothing');
    const callSites = [];
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const yaml = readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .join('\n');
      RECORD_CALL.lastIndex = 0;
      for (const m of yaml.matchAll(RECORD_CALL)) {
        for (const environment of expandMatrixEnvironment(m[1], slugs)) callSites.push({ file, environment });
      }
    }

    // If this ever reads zero the test has stopped testing: a matcher with no
    // inputs passes trivially, which is how a guard quietly stops guarding.
    assert.ok(
      callSites.length >= 3,
      `expected at least the three known deploy records, found ${callSites.length} — ` +
        'this scanner has lost sight of the workflows it is meant to cover',
    );

    const unresolved = callSites.filter(
      (c) => resolveEnvironment(REAL_REGISTER, c.environment) === null,
    );
    assert.deepEqual(
      unresolved,
      [],
      'every environment a workflow records must be claimed by tooling/channel-register.json — ' +
        'either a `channels` row (a release channel) or a `serviceEnvironments` row (a backend Worker). ' +
        'An unclaimed one turns a SUCCESSFUL deploy into a red job after the upload already happened.',
    );
  });

  test('service environments are not store channels', () => {
    for (const env of ['subly-api', 'platform']) {
      assert.notEqual(resolveEnvironment(REGISTER, env).channel.kind, 'store');
    }
    assert.deepEqual(
      readSubmissions(
        [{ environment: 'platform', createdAt: 'x', description: 'nk1 state=live sha=abc12345' }],
        REGISTER,
      ),
      { records: [], unreadable: [] },
      'a Worker deploy is neither a submission nor an unreadable row',
    );
  });
});

describe('deployment-record — readSubmissions separates read from unreadable', () => {
  test('the ledger is EMPTY today, and that is the correct answer', () => {
    const { records, unreadable } = readSubmissions([], REGISTER);
    assert.deepEqual(records, []);
    assert.deepEqual(unreadable, []);
  });

  test('a web deploy is not a submission', () => {
    const { records } = readSubmissions(
      [{ environment: 'subly-web', createdAt: '2026-08-03T00:00:00Z', description: 'nk1 state=live sha=abc12345' }],
      REGISTER,
    );
    assert.deepEqual(records, []);
  });

  test('a store record is read whole', () => {
    const { records } = readSubmissions(
      [{
        environment: 'subly-windows-store',
        createdAt: '2026-08-03T10:00:00Z',
        description: 'nk1 state=in_review sha=abc12345 listing=https://apps.microsoft.com/detail/X',
      }],
      REGISTER,
    );
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      environment: 'subly-windows-store',
      app: 'subly',
      channel: 'windows-store',
      state: 'in_review',
      sha: 'abc12345',
      listingUrl: 'https://apps.microsoft.com/detail/X',
      createdAt: '2026-08-03T10:00:00Z',
    });
  });

  test('an unreadable store record is REPORTED, never silently dropped', () => {
    const { records, unreadable } = readSubmissions(
      [{ environment: 'subly-windows-store', createdAt: '2026-08-03T10:00:00Z', description: 'live at abc12345' }],
      REGISTER,
    );
    assert.deepEqual(records, []);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0].reason, /UNPARSEABLE/);
  });

  test('an environment no row claims is reported as unreadable', () => {
    const { unreadable } = readSubmissions([{ environment: 'ghost-env', description: 'nk1 state=live sha=abc12345' }], REGISTER);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0].reason, /no register row/);
  });

  test('calendarMonth buckets in UTC and refuses a non-date', () => {
    assert.equal(calendarMonth('2026-08-03T10:00:00Z'), '2026-08');
    assert.equal(calendarMonth('not a date'), null);
  });
});

describe('record-deployment — the store rule is enforced BEFORE anything is written', () => {
  test('REFUSES a store environment with no --listing-url', () => {
    const { code, out } = record(['subly-windows-store']);
    assert.equal(code, 1);
    assert.match(out, /kind: store\) and no --listing-url was given/);
    assert.match(out, /gives no way to look at it/);
  });

  test('REFUSES an unknown --state', () => {
    const { code, out } = record(['subly-web', '--state', 'shipped']);
    assert.equal(code, 1);
    assert.match(out, /is not one of in_review, live, rejected, pulled/);
  });

  // 🔴 THE REFUSAL THAT MUST SURVIVE THE serviceEnvironments CHANGE. Teaching
  // the resolver about backend Workers widened what it accepts; this is the
  // input proving it did not widen to everything.
  test('REFUSES an environment no register row claims', () => {
    const { code, out } = record(['subly-nowhere']);
    assert.equal(code, 1);
    assert.match(out, /claims the environment "subly-nowhere"/);
  });

  // A near-miss on a real service name must still be refused — the service list
  // is matched EXACTLY, so a typo cannot ride in on a prefix.
  test('REFUSES a near-miss on a service environment', () => {
    const { code, out } = record(['platform-staging']);
    assert.equal(code, 1);
    assert.match(out, /claims the environment "platform-staging"/);
  });

  test('REFUSES a --state flag with no value', () => {
    const { code, out } = record(['subly-web', '--state']);
    assert.equal(code, 1);
    assert.match(out, /--state was given with no value/);
  });

  test('a WEB environment needs no listing URL and gets past the shape checks', () => {
    // It then fails at the API with a fake token, which is proof it got there:
    // the shape gate is upstream of the first fetch.
    const { code, out } = record(['subly-web', 'https://subly.nikatru.com']);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/);
    assert.doesNotMatch(out, /--listing-url/);
  });

  test('a STORE environment WITH a listing URL gets past the shape checks', () => {
    const { code, out } = record([
      'subly-windows-store',
      '--state', 'in_review',
      '--listing-url', 'https://apps.microsoft.com/detail/X',
    ]);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/);
  });

  test('still refuses when nothing at all is given', () => {
    const { code, out } = record([]);
    assert.equal(code, 1);
    assert.match(out, /no environment given/);
  });

  // ── SUBMITTED IS NOT LIVE ───────────────────────────────────────────────────
  // The `live` default is correct for a web deploy — the upload finishing IS the
  // go-live, with no third party in between — and is the single most consequential
  // thing this ledger could get wrong on a store, where the upload is `in_review`
  // and the store decides hours-to-weeks later, possibly never. A forgotten flag
  // must not be what separates "we submitted it" from "the store approved it".
  test('a STORE environment REFUSES to inherit the `live` default', () => {
    const { code, out } = record(['subly-windows-store', '--listing-url', 'https://apps.microsoft.com/detail/X']);
    assert.equal(code, 1);
    assert.match(out, /no --state was given/);
    assert.match(out, /NOT live when the upload succeeds/);
    assert.doesNotMatch(out, /could not record the deployment/); // refused BEFORE the API
  });

  test('a WEB environment still gets the `live` default — the upload IS the go-live', () => {
    const { code, out } = record(['subly-web']);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/); // got past the shape gate
    assert.doesNotMatch(out, /no --state was given/);
  });

  test('a SERVICE environment still gets the `live` default', () => {
    const { code, out } = record(['platform', 'https://platform.nikatru.com']);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/);
    assert.doesNotMatch(out, /no --state was given/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 ONE SHAPE, NOT TWO — the defect found live on 2026-08-06.
//
// record-deployment.mjs writes a GitHub Deployment AND a Deployment Status, and
// each carries its own `description`. The status got `encodeDescription(...)`;
// the deployment got the prose `"<env> deploy"`. Verified against the live API
// that day: every deployment read `"subly-web deploy"` and every status read
// `nk1 state=live sha=6525fb7d`.
//
// That is not cosmetic. `readSubmissions` decodes `description`, and the ledger
// source this script's own header documents — `gh api …/deployments` — returns
// the DEPLOYMENT's field. So the documented query produced rows that all decoded
// as UNPARSEABLE, and a cadence count over them was a count of zero wearing the
// look of compliance. Both fields now carry the same encoding.
// ─────────────────────────────────────────────────────────────────────────────
describe('record-deployment — the DEPLOYMENT and its STATUS carry the same shape', () => {
  const source = readFileSync(RECORDER, 'utf8');

  test('no prose description survives anywhere in the writer', () => {
    assert.doesNotMatch(
      source,
      /description:\s*`\$\{environment\}\s+deploy`/,
      'the deployment body must not write free prose — `readSubmissions` decodes exactly this field',
    );
  });

  test('both API bodies send the encoded `description` variable', () => {
    const bodies = [...source.matchAll(/^\s*description,\s*$/gm)];
    assert.equal(
      bodies.length,
      2,
      'expected the deployment body AND the status body to send the same encoded `description`; ' +
        `found ${bodies.length}. Two shapes in one ledger is what this test exists to prevent.`,
    );
  });

  test('a ledger built from the DEPLOYMENT field decodes — the shape the fix makes true', () => {
    // What `gh api …/deployments --jq '[.[]|{environment,createdAt:.created_at,description}]'`
    // now yields for a store submission, fed to the reader that consumes it.
    const { records, unreadable } = readSubmissions(
      [{
        environment: 'subly-android-play',
        createdAt: '2026-08-06T00:00:00Z',
        description: encodeDescription({ state: 'in_review', sha: 'abc12345', listingUrl: 'https://play.google.com/x' }),
      }],
      REAL_REGISTER,
    );
    assert.deepEqual(unreadable, []);
    assert.equal(records.length, 1);
    assert.equal(records[0].state, 'in_review');
    assert.equal(records[0].channel, 'android-play');
  });

  test('the OLD deployment-field prose is what the fix removed — it decodes as unreadable', () => {
    const { records, unreadable } = readSubmissions(
      [{ environment: 'subly-android-play', createdAt: '2026-08-06T00:00:00Z', description: 'subly-android-play deploy' }],
      REAL_REGISTER,
    );
    assert.deepEqual(records, []);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0].reason, /not a "nk1" record/);
  });
});

describe('deployment-record — SUBMIT_TIME_STATES draws the submitted/live line', () => {
  test('a submitting run may assert exactly one state', () => {
    assert.deepEqual([...SUBMIT_TIME_STATES], ['in_review']);
  });

  test('every state carries a meaning, and every meaning names a state', () => {
    assert.deepEqual(Object.keys(STATE_MEANING).sort(), [...STATES].sort());
  });

  test('the store-issued states are NOT assertable at submission time', () => {
    for (const s of ['live', 'rejected', 'pulled']) {
      assert.equal(SUBMIT_TIME_STATES.includes(s), false, `${s} is decided after the submitting run has ended`);
    }
  });
});

// ── the retry, and the far more important question of what is NOT retried ───
// 🔴 A 503 ON 2026-08-17 LEFT A PUBLISHED SHA WITH NO DEPLOYMENT RECORD, and
// the record for it does not exist to this day. A whole-job re-run is not the
// remedy — by then the deploy has happened, so re-running re-deploys to get a
// second chance at the write. These are pure decisions so both directions run
// with no network and no token.
describe('record-deployment — the write is retried, and only where retrying is honest', () => {
  test('a 5xx says "ask again"', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      assert.equal(isRetryable({ status }), true, `${status} must be retryable`);
    }
  });

  test('a network failure never reached GitHub at all', () => {
    assert.equal(isRetryable({ networkError: true }), true);
    assert.equal(isRetryable({ status: null, networkError: true }), true);
  });

  // A 4xx is a REAL ANSWER. Retrying it repeats a wrong request and reports the
  // same failure later, having taught the reader the guard is flaky rather than
  // that the request is wrong.
  test('a 4xx is never retried — it is an answer, not a hiccup', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      assert.equal(isRetryable({ status }), false, `${status} must NOT be retried`);
    }
  });

  // ⚠️ The one 4xx that would justify a retry, and it is still excluded.
  // Honouring a rate limit means reading `Retry-After`; retrying a 429 on a
  // fixed backoff is how a client turns a throttle into a ban. Pinned so that
  // adding 429 has to be a deliberate act with a source, not a widened range.
  test('429 is DELIBERATELY not retried — that needs Retry-After, not a backoff', () => {
    assert.equal(isRetryable({ status: 429 }), false);
  });

  test('a 2xx and a 3xx are not retry decisions at all', () => {
    for (const status of [200, 201, 204, 301, 302]) assert.equal(isRetryable({ status }), false);
  });

  test('a missing or non-numeric status is not an invitation to retry', () => {
    for (const status of [undefined, null, '503', NaN, {}]) assert.equal(isRetryable({ status }), false);
    assert.equal(isRetryable({}), false);
  });

  test('the budget is BOUNDED and the backoff grows', () => {
    assert.ok(RETRY_ATTEMPTS >= 2 && RETRY_ATTEMPTS <= 5, `${RETRY_ATTEMPTS} attempts`);
    const waits = Array.from({ length: RETRY_ATTEMPTS - 1 }, (_, i) => retryDelayMs(i + 1));
    for (let i = 1; i < waits.length; i++) assert.ok(waits[i] > waits[i - 1], 'each wait exceeds the last');
    // This runs at the end of a real deploy. A long sleep here holds a runner
    // open to re-ask a question already answered twice.
    assert.ok(waits.reduce((a, b) => a + b, 0) <= 10_000, `total backoff ${waits} must stay under 10s`);
  });
});
