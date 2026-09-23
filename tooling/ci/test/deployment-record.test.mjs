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
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  STATES,
  MAX_DESCRIPTION,
  encodeDescription,
  decodeDescription,
  resolveEnvironment,
  readSubmissions,
  calendarMonth,
  SUBMIT_TIME_STATES,
  SUBMISSION_STATES,
  STATE_MEANING,
} from '../deployment-record.mjs';
import { RECORD_CALL, expandMatrixEnvironment, isShellVariableEnvironment, shellSegments } from '../workflow-scan.mjs';
import { isRetryable, retryDelayMs, RETRY_ATTEMPTS, runIdentity, RUN_IDENTITY_ENV } from '../record-deployment.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CI_DIR, '../..');
const RECORDER = join(CI_DIR, 'record-deployment.mjs');

let TMP;
let seq = 0;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-deprec-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

const REGISTER = {
  channels: [
    { id: 'web', kind: 'web', deploymentEnvironment: '{app}-web' },
    { id: 'windows-store', kind: 'store', deploymentEnvironment: '{app}-windows-store' },
    { id: 'android-play', kind: 'store', deploymentEnvironment: '{app}-android-play' },
  ],
  serviceEnvironments: [
    { id: 'subscriptiontracker-api', kind: 'service', deploymentEnvironment: 'subscriptiontracker-api' },
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-12 · THE REPLAY. This file used to say "no network reachable" and
// "every case here fails or succeeds BEFORE the first fetch". Both sentences
// were FALSE, and measuring was the only way to find that out: under a logging
// `fetch` preload, one run of this file made FIVE real POSTs to
// https://api.github.com/repos/x/y/deployments. Three tests deliberately walk
// PAST the shape gate and assert `could not record the deployment` — a message
// that was being produced by the live API answering 401 Bad credentials to the
// token `t`. A test whose red depends on a third party is a test that goes red
// when that third party is slow, and CI ran these on every push.
//
// The replay is a module loaded into the RECORDER's own process with `--import`,
// exactly as tooling/ci/test/ops-register.test.mjs replays GitHub for the ops
// guard. The seam is the CHILD's `fetch`: record-deployment.mjs gains no fixture
// flag, no replay mode and no environment switch of its own, and what it runs
// against is the same `fetch` a runner gives it. An URL the replay does not know
// THROWS — so a future call that escapes to the network cannot pass quietly.
//
// It buys coverage as well as quiet: the live 401s could only ever produce one
// message. The replay can answer 201, so the two POST BODIES this ledger writes
// are now asserted end to end — the thing the "ONE SHAPE, NOT TWO" block below
// could previously only check by reading the source.
//
// (`GITHUB_API_URL` is a real loopback seam in record-deployment.mjs, used by
// github-rate-limit.test.mjs with an http server. It is not usable here: this
// file drives the recorder with spawnSync, which blocks the event loop, so a
// server in this process could never answer.)
// ─────────────────────────────────────────────────────────────────────────────

/** Serialised into a file and loaded with `--import`. It runs in the recorder's
 *  process, before the recorder does. */
function githubReplay(appendFileSync) {
  const log = process.env.RECORD_REPLAY_LOG;
  const status = Number(process.env.RECORD_REPLAY_STATUS || 401);
  const json = (body, code) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const { pathname } = new URL(url);
    let body = null;
    try {
      body = JSON.parse(init.body ?? 'null');
    } catch {
      body = { unparseable: String(init.body) };
    }
    if (log) appendFileSync(log, `${JSON.stringify({ method: init.method ?? 'GET', pathname, body })}\n`);
    if (/^\/repos\/[^/]+\/[^/]+\/deployments$/.test(pathname)) {
      return status === 201 ? json({ id: 42 }, 201) : json({ message: 'Bad credentials' }, status);
    }
    if (/^\/repos\/[^/]+\/[^/]+\/deployments\/42\/statuses$/.test(pathname)) {
      return status === 201 ? json({ id: 7, state: 'success' }, 201) : json({ message: 'Bad credentials' }, status);
    }
    throw new Error(`[replay] unreplayed request ${init.method ?? 'GET'} ${url} — this test file must reach no network`);
  };
}

let REPLAY;
before(() => {
  REPLAY = join(TMP, 'github-replay.mjs');
  writeFileSync(
    REPLAY,
    `import { appendFileSync } from 'node:fs';\n(${githubReplay.toString()})(appendFileSync);\n`,
  );
});

/** Run the real recorder against the replay. Every request it makes is written
 *  to a per-call log, so "what did it send" is measured rather than described. */
function record(args, env = {}) {
  const log = join(TMP, `replay-${seq++}.log`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(REPLAY).href, RECORDER, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'x/y',
      GITHUB_SHA: 'abc12345deadbeef',
      GH_TOKEN: 't',
      GITHUB_API_URL: '',
      // ⏱ 2026-09-23 — the run identity every Actions step has. A submittable
      // channel's record is refused without it, so a fixed one is the default and
      // a case that needs it absent passes `undefined` (spawnSync drops those).
      GITHUB_WORKFLOW_REF: 'x/y/.github/workflows/submit-play.yml@refs/heads/main',
      GITHUB_RUN_ID: '35787897094',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_NUMBER: '5',
      RECORD_REPLAY_LOG: log,
      ...env,
    },
  });
  const requests = existsSync(log)
    ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, requests };
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

/** ⏱ 2026-09-23 · #887. A shell variable in the `{app}` SLOT ONLY — `$TOOL-amo` —
 *  leaves the channel as literal text, so the channel is readable here even though
 *  the app is not: the suffix must complete ONE register template EXACTLY. Returns
 *  that row's id, or null when the token is not this shape or no row claims it. */
function appSlotChannel(register, written) {
  const m = String(written).match(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?(-[a-z0-9][a-z0-9-]*)$/);
  if (!m) return null;
  const rows = (register?.channels ?? []).filter((c) => c?.deploymentEnvironment === `{app}${m[1]}`);
  return rows.length === 1 ? rows[0].id : null;
}

describe('deployment-record — the environment resolves against the register', () => {
  test('an app-slot variable over a claimed channel suffix names that channel', () => {
    assert.equal(appSlotChannel(REAL_REGISTER, '$TOOL-amo'), 'amo');
    assert.equal(appSlotChannel(REAL_REGISTER, '${TOOL}-amo'), 'amo');
  });

  test('an app-slot variable over an UNCLAIMED suffix names nothing', () => {
    assert.equal(appSlotChannel(REAL_REGISTER, '$TOOL-nowhere'), null);
  });

  test('a variable anywhere but the app slot is not the app-slot shape', () => {
    assert.equal(appSlotChannel(REAL_REGISTER, '$environment'), null);
    assert.equal(appSlotChannel(REAL_REGISTER, 'fullshot-$CHANNEL'), null);
    assert.equal(appSlotChannel(REAL_REGISTER, '$TOOL-$CHANNEL'), null);
  });

  test('`subscriptiontracker-android-play` resolves to android-play, not to a channel called "play"', () => {
    const r = resolveEnvironment(REGISTER, 'subscriptiontracker-android-play');
    assert.equal(r.app, 'subscriptiontracker');
    assert.equal(r.channel.id, 'android-play');
  });

  test('`subscriptiontracker-web` resolves to the web row', () => {
    assert.equal(resolveEnvironment(REGISTER, 'subscriptiontracker-web').channel.id, 'web');
  });

  test('an environment no template matches resolves to null', () => {
    assert.equal(resolveEnvironment(REGISTER, 'subscriptiontracker-nowhere'), null);
  });

  test('a register with no channels resolves nothing', () => {
    assert.equal(resolveEnvironment({}, 'subscriptiontracker-web'), null);
  });

  // ── SERVICE ENVIRONMENTS — the five red deploy-workers runs from 2026-08-02 ──
  test('`subscriptiontracker-api` resolves to a service environment, not to nothing', () => {
    const r = resolveEnvironment(REGISTER, 'subscriptiontracker-api');
    assert.notEqual(r, null, 'a Worker deploy must be recordable');
    assert.equal(r.channel.id, 'subscriptiontracker-api');
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
    assert.equal(resolveEnvironment(REGISTER, 'subscriptiontracker-nowhere'), null);
    assert.equal(resolveEnvironment(REGISTER, 'not-a-worker'), null);
  });

  test('a service environment is matched exactly, never as a prefix', () => {
    assert.equal(resolveEnvironment(REGISTER, 'platform-staging'), null);
    assert.equal(resolveEnvironment(REGISTER, 'subscriptiontracker-api-canary'), null);
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
    // 🔴 LINE BY LINE, SO AN INVOCATION THE READER CANNOT PARSE HAS AN ADDRESS.
    // Joining the file first made `found nothing here` and `there is nothing
    // here` the same observation, which is the whole defect this test is now
    // written against.
    const unreadableInvocations = [];
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      for (const [i, raw] of readFileSync(join(dir, file), 'utf8').split('\n').entries()) {
        if (/^\s*#/.test(raw)) continue;
        // An INVOCATION, not a mention: deploy-web.yml's `paths:` filter names
        // this script as a TRIGGER path and runs nothing.
        const invokes = /node\s+\S*record-deployment\.mjs/.test(raw);
        RECORD_CALL.lastIndex = 0;
        const found = [...raw.matchAll(RECORD_CALL)];
        if (invokes && found.length === 0) {
          unreadableInvocations.push(`${file}:${i + 1}`);
          continue;
        }
        for (const m of found) {
          for (const environment of expandMatrixEnvironment(m[1], slugs)) {
            callSites.push({ file, line: i + 1, written: m[1], environment });
          }
        }
      }
    }

    // 🔴 THE FLOOR THAT MATCHES THE ONE assert-ops-register.mjs NOW CARRIES.
    // `record-deployment.mjs "$environment"` in build-platforms.yml matched
    // NOTHING until 2026-08-26, and every reader of that line — this test
    // included — treated "no match" as "no call". The count floor below cannot
    // see it: the three known records still made three.
    assert.deepEqual(
      unreadableInvocations,
      [],
      'a workflow line INVOKES record-deployment.mjs and `RECORD_CALL` read no environment from it. ' +
        'An argument shape this reader cannot parse leaves the call invisible to every guard built on it, ' +
        'and each of those guards then reports a smaller domain as a pass. Widen `RECORD_CALL`.',
    );

    // If this ever reads zero the test has stopped testing: a matcher with no
    // inputs passes trivially, which is how a guard quietly stops guarding.
    assert.ok(
      callSites.length >= 3,
      `expected at least the three known deploy records, found ${callSites.length} — ` +
        'this scanner has lost sight of the workflows it is meant to cover',
    );

    const unresolved = callSites
      .filter((c) => !isShellVariableEnvironment(c.written))
      .filter((c) => resolveEnvironment(REAL_REGISTER, c.environment) === null);
    assert.deepEqual(
      unresolved,
      [],
      'every environment a workflow records must be claimed by tooling/channel-register.json — ' +
        'either a `channels` row (a release channel) or a `serviceEnvironments` row (a backend Worker). ' +
        'An unclaimed one turns a SUCCESSFUL deploy into a red job after the upload already happened.',
    );

    // ⚠️ A SHELL VARIABLE HOLDS NO VALUE UNTIL THE JOB RUNS, so it is exempt from
    // the resolution above and would otherwise be exempt from everything. It is
    // held to the one thing that IS readable here: the loop that feeds it must be
    // `release-manifest.mjs --emit-environments`, which derives its output from
    // tooling/channel-register.json. Swap that producer for any other command and
    // this goes red — an unresolvable argument is not a licence to record
    // anything.
    for (const c of callSites.filter((s) => isShellVariableEnvironment(s.written))) {
      // Only the app is a runtime value here; the channel is literal and held to
      // exactly one register row. record-deployment.mjs resolves the whole name
      // again before it writes.
      if (appSlotChannel(REAL_REGISTER, c.written) !== null) continue;
      const name = c.written.replace(/^\$\{?/, '').replace(/\}$/, '');
      const producer = readFileSync(join(dir, c.file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l))
        .find((l) => new RegExp(`for\\s+${name}\\s+in\\s+\\$\\(`).test(l)
          && /release-manifest\.mjs\s+--emit-environments/.test(l));
      assert.ok(
        producer,
        `${c.file}:${c.line} records \`${c.written}\`, a value this scan cannot read, and no line in that file ` +
          `feeds \`${name}\` from \`release-manifest.mjs --emit-environments\` — so nothing ties what it records ` +
          'back to tooling/channel-register.json.',
      );
    }
  });

  test('service environments are not store channels', () => {
    for (const env of ['subscriptiontracker-api', 'platform']) {
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
      [{ environment: 'subscriptiontracker-web', createdAt: '2026-08-03T00:00:00Z', description: 'nk1 state=live sha=abc12345' }],
      REGISTER,
    );
    assert.deepEqual(records, []);
  });

  test('a store record is read whole', () => {
    const { records } = readSubmissions(
      [{
        environment: 'subscriptiontracker-windows-store',
        createdAt: '2026-08-03T10:00:00Z',
        description: 'nk1 state=in_review sha=abc12345 listing=https://apps.microsoft.com/detail/X',
      }],
      REGISTER,
    );
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      environment: 'subscriptiontracker-windows-store',
      app: 'subscriptiontracker',
      channel: 'windows-store',
      state: 'in_review',
      sha: 'abc12345',
      listingUrl: 'https://apps.microsoft.com/detail/X',
      createdAt: '2026-08-03T10:00:00Z',
    });
  });

  test('an unreadable store record is REPORTED, never silently dropped', () => {
    const { records, unreadable } = readSubmissions(
      [{ environment: 'subscriptiontracker-windows-store', createdAt: '2026-08-03T10:00:00Z', description: 'live at abc12345' }],
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
    const { code, out } = record(['subscriptiontracker-windows-store']);
    assert.equal(code, 1);
    assert.match(out, /kind: store\) and no --listing-url was given/);
    assert.match(out, /gives no way to look at it/);
  });

  test('REFUSES an unknown --state', () => {
    const { code, out } = record(['subscriptiontracker-web', '--state', 'shipped']);
    assert.equal(code, 1);
    assert.match(out, /is not one of in_review, live, rejected, pulled/);
  });

  // 🔴 THE REFUSAL THAT MUST SURVIVE THE serviceEnvironments CHANGE. Teaching
  // the resolver about backend Workers widened what it accepts; this is the
  // input proving it did not widen to everything.
  test('REFUSES an environment no register row claims', () => {
    const { code, out } = record(['subscriptiontracker-nowhere']);
    assert.equal(code, 1);
    assert.match(out, /claims the environment "subscriptiontracker-nowhere"/);
  });

  // A near-miss on a real service name must still be refused — the service list
  // is matched EXACTLY, so a typo cannot ride in on a prefix.
  test('REFUSES a near-miss on a service environment', () => {
    const { code, out } = record(['platform-staging']);
    assert.equal(code, 1);
    assert.match(out, /claims the environment "platform-staging"/);
  });

  test('REFUSES a --state flag with no value', () => {
    const { code, out } = record(['subscriptiontracker-web', '--state']);
    assert.equal(code, 1);
    assert.match(out, /--state was given with no value/);
  });

  test('a WEB environment needs no listing URL and gets past the shape checks', () => {
    // It then fails at the API with a fake token, which is proof it got there:
    // the shape gate is upstream of the first fetch.
    const { code, out } = record(['subscriptiontracker-web', 'https://subly.nikatru.com']);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/);
    assert.doesNotMatch(out, /--listing-url/);
  });

  test('a STORE environment WITH a listing URL gets past the shape checks', () => {
    const { code, out } = record([
      'subscriptiontracker-windows-store',
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
    const { code, out } = record(['subscriptiontracker-windows-store', '--listing-url', 'https://apps.microsoft.com/detail/X']);
    assert.equal(code, 1);
    assert.match(out, /no --state was given/);
    assert.match(out, /NOT live when the upload succeeds/);
    assert.doesNotMatch(out, /could not record the deployment/); // refused BEFORE the API
  });

  test('a WEB environment still gets the `live` default — the upload IS the go-live', () => {
    const { code, out } = record(['subscriptiontracker-web']);
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

  // ── THE THIRD CASE: A STORE THIS FACTORY CANNOT SUBMIT TO ───────────────────
  // 🔴 THESE RUN AGAINST THE REAL REGISTER, and that is the point: the three
  // browser add-on rows are `submittable: false`, so the extensions release lane
  // publishes the artifact and submits nothing. Asking it for a review state or a
  // listing URL asks for facts that do not exist — the listing is not issued
  // until somebody publishes by hand — and both of the two ways to satisfy the
  // old rule were fictions. Measured 2026-09-05 by review, on the real tree: the
  // loop, which passed only a URL, died AFTER `gh release create` under
  // `set -euo pipefail`.
  test('a NON-submittable store row gets past the shape checks with the origin state and NO listing URL', () => {
    const { code, out } = record([
      'fullshot-chrome-webstore',
      'https://github.com/x/y/releases/tag/fullshot-v1.0.0',
      '--state', 'pending_manual_publish',
    ]);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/); // reached the API: the shape gate passed
    assert.doesNotMatch(out, /--listing-url was given/);
  });

  test('a NON-submittable store row still refuses to inherit ANY default', () => {
    const { code, out } = record(['fullshot-chrome-webstore']);
    assert.equal(code, 1);
    assert.match(out, /no --state was given/);
    assert.match(out, /pending_manual_publish/);
    assert.doesNotMatch(out, /could not record the deployment/); // refused BEFORE the API
  });

  test('a NON-submittable store row REFUSES `in_review` — no lane here can have submitted it', () => {
    const { code, out } = record([
      'fullshot-chrome-webstore',
      '--state', 'in_review',
      '--listing-url', 'https://chromewebstore.google.com/detail/X',
    ]);
    assert.equal(code, 1);
    assert.match(out, /no lane in this factory can submit through it/);
    assert.doesNotMatch(out, /could not record the deployment/);
  });

  test('a SUBMITTABLE store row REFUSES the origin state — it is not the easy way past naming a submission', () => {
    const { code, out } = record(['subscriptiontracker-android-play', '--state', 'pending_manual_publish']);
    assert.equal(code, 1);
    assert.match(out, /this factory CAN submit through it/);
    assert.doesNotMatch(out, /could not record the deployment/);
  });

  test('a WEB row REFUSES the origin state too — nobody submits to a web channel', () => {
    const { code, out } = record(['subscriptiontracker-web', '--state', 'pending_manual_publish']);
    assert.equal(code, 1);
    assert.match(out, /which nobody submits to/);
    assert.doesNotMatch(out, /could not record the deployment/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 ONE SHAPE, NOT TWO — the defect found live on 2026-08-06.
//
// record-deployment.mjs writes a GitHub Deployment AND a Deployment Status, and
// each carries its own `description`. The status got `encodeDescription(...)`;
// the deployment got the prose `"<env> deploy"`. Verified against the live API
// that day: every deployment read `"subscriptiontracker-web deploy"` and every status read
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

  // ⏱ 2026-09-12 — AND NOW END TO END, THROUGH THE RECORDER ITSELF. The two
  // tests above read the SOURCE for the shape, which is what was possible while
  // the only answer this file could get from GitHub was 401. The replay can
  // answer 201, so what the recorder actually SENDS is measured.
  test('the recorder POSTs the deployment and its status, both carrying the SAME encoded description', () => {
    const { code, out, requests } = record(['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/'], {
      RECORD_REPLAY_STATUS: '201',
    });
    assert.equal(code, 0, out);
    assert.deepEqual(
      requests.map((r) => `${r.method} ${r.pathname}`),
      ['POST /repos/x/y/deployments', 'POST /repos/x/y/deployments/42/statuses'],
      'exactly two writes, in this order, and nothing else reached the network',
    );
    const [deployment, status] = requests;
    assert.equal(
      deployment.body.description,
      status.body.description,
      'ONE SHAPE, NOT TWO — the 2026-08-06 defect was these two fields disagreeing',
    );
    const decoded = decodeDescription(deployment.body.description);
    assert.equal(decoded.ok, true, deployment.body.description);
    assert.equal(decoded.state, 'live');
    assert.equal(decoded.sha, 'abc12345');
    assert.equal(deployment.body.environment, 'subscriptiontracker-web');
    assert.equal(deployment.body.ref, 'abc12345deadbeef');
    assert.equal(deployment.body.required_contexts.length, 0, 'the gate was already enforced by assert-gate-passed.mjs');
    assert.equal(status.body.state, 'success');
    assert.equal(status.body.environment_url, 'https://nikatru.com/subscriptiontracker/');
  });

  test('a store record carries its review state and listing URL into BOTH bodies', () => {
    const { code, requests } = record(
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x'],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0);
    assert.equal(requests.length, 2);
    for (const r of requests) {
      const d = decodeDescription(r.body.description);
      assert.equal(d.ok, true, r.body.description);
      assert.equal(d.state, 'in_review');
      assert.equal(d.listingUrl, 'https://play.google.com/store/apps/details?id=x');
    }
  });

  test('🔴 a refusal is the REPLAY refusing — no test in this file reaches GitHub', () => {
    // Measured 2026-09-12: before the replay, one run of this file made five real
    // POSTs to https://api.github.com/repos/x/y/deployments, and the message the
    // three "got past the shape gate" tests assert on was produced by the live
    // API answering 401 to the token `t`. The replay throws on any URL it does
    // not know, so a call that escaped would fail loudly rather than quietly
    // spending somebody's quota.
    const { code, out, requests } = record(['subscriptiontracker-web']);
    assert.equal(code, 1);
    assert.match(out, /could not record the deployment/);
    assert.deepEqual(requests.map((r) => r.pathname), ['/repos/x/y/deployments'], 'one write, refused, and no retry — 401 is not retryable');
  });

  test('a ledger built from the DEPLOYMENT field decodes — the shape the fix makes true', () => {
    // What `gh api …/deployments --jq '[.[]|{environment,createdAt:.created_at,description}]'`
    // now yields for a store submission, fed to the reader that consumes it.
    const { records, unreadable } = readSubmissions(
      [{
        environment: 'subscriptiontracker-android-play',
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
      [{ environment: 'subscriptiontracker-android-play', createdAt: '2026-08-06T00:00:00Z', description: 'subscriptiontracker-android-play deploy' }],
      REAL_REGISTER,
    );
    assert.deepEqual(records, []);
    assert.equal(unreadable.length, 1);
    assert.match(unreadable[0].reason, /not a "nk1" record/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-23 · EVERY DEPLOYMENT NAMES THE RUN THAT WROTE IT.
// tooling/ops/check-prod-provenance.mjs accepts a build stamped by a store
// submission lane only on a Deployment whose `payload` names that run's id and
// workflow. It used to bind by time — a Deployment created during the run — and
// a dry run at the upload's commit whose lifetime overlapped the upload's
// Deployment passed that. The payload is written here, from the runner's own
// GITHUB_WORKFLOW_REF / GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT / GITHUB_RUN_NUMBER.
// ─────────────────────────────────────────────────────────────────────────────
const PLAY_IDENTITY = { workflow: 'submit-play.yml', run_id: 35787897094, run_attempt: 1, run_number: 5 };
const NO_IDENTITY = Object.fromEntries(RUN_IDENTITY_ENV.map((k) => [k, undefined]));

/** Every `node … record-deployment.mjs` invocation in one workflow, and each
 *  thing in that file that would stop it carrying the runner's run identity:
 *  a wrapper in front of `node` (`env -i`, `sudo`, `docker run`, an inline
 *  assignment), a step `shell:` that is not a plain shell, or an `env:` entry
 *  that sets an identity variable to anything but its own `github.*` context. */
function identityBlockers(file) {
  const lines = readFileSync(join(ROOT, '.github/workflows', file), 'utf8').split('\n');
  const indent = (l) => l.match(/^\s*/)[0].length;
  const CONTEXT = { GITHUB_WORKFLOW_REF: 'workflow_ref', GITHUB_RUN_ID: 'run_id', GITHUB_RUN_ATTEMPT: 'run_attempt', GITHUB_RUN_NUMBER: 'run_number' };
  const problems = [];
  for (const [i, raw] of lines.entries()) {
    if (/^\s*#/.test(raw)) continue;
    const m = raw.match(/^\s+(GITHUB_WORKFLOW_REF|GITHUB_RUN_ID|GITHUB_RUN_ATTEMPT|GITHUB_RUN_NUMBER)\s*:\s*(.*?)\s*$/);
    if (m && m[2] !== `\${{ github.${CONTEXT[m[1]]} }}`) problems.push(`${file}:${i + 1} sets ${m[1]} to ${m[2] || '(nothing)'}`);
  }
  let invocations = 0;
  for (const [i, raw] of lines.entries()) {
    if (/^\s*#/.test(raw) || !/node\s+\S*record-deployment\.mjs/.test(raw)) continue;
    invocations += 1;
    const segment = shellSegments(raw)
      .find((s) => /record-deployment\.mjs/.test(s))
      .trim()
      .replace(/^(?:-\s+)?run:\s*/, '')
      .replace(/^(?:do|then|else)\s+/, '');
    if (!/^node\s+tooling\/ci\/record-deployment\.mjs(\s|$)/.test(segment)) {
      problems.push(`${file}:${i + 1} runs the recorder as \`${segment}\`, not straight from the step's shell`);
    }
    let start = i;
    if (!/^\s*-\s/.test(raw)) while (start > 0 && !(/^\s*-\s/.test(lines[start]) && indent(lines[start]) < indent(raw))) start -= 1;
    const stepIndent = indent(lines[start]);
    for (let j = start; j < lines.length && (j === start || lines[j].trim() === '' || indent(lines[j]) > stepIndent); j++) {
      const sh = lines[j].replace(/^(\s*)-\s/, '$1  ').match(/^(\s+)shell:\s*(.*?)\s*$/);
      if (sh && sh[1].length === stepIndent + 2 && !/^(bash|sh|pwsh|powershell)(\s|$)/.test(sh[2])) {
        problems.push(`${file}:${j + 1} runs the recorder's step under \`shell: ${sh[2]}\``);
      }
    }
  }
  return { invocations, problems };
}

describe('record-deployment — every Deployment names the run that wrote it', () => {
  test('runIdentity reads the Play upload\'s identity from the runner\'s variables', () => {
    const { payload, missing } = runIdentity({
      GITHUB_WORKFLOW_REF: 'globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows/submit-play.yml@refs/heads/main',
      GITHUB_RUN_ID: '35787897094',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_NUMBER: '5',
    });
    assert.deepEqual(missing, []);
    assert.deepEqual(payload, PLAY_IDENTITY);
  });

  test('runIdentity names EVERY missing variable and returns no payload', () => {
    assert.deepEqual(runIdentity({}), { payload: null, missing: [...RUN_IDENTITY_ENV] });
  });

  test('runIdentity refuses a ref that names no workflow file and an id that is not a number', () => {
    const { payload, missing } = runIdentity({
      GITHUB_WORKFLOW_REF: 'x/y@refs/heads/main',
      GITHUB_RUN_ID: '35787897094x',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_RUN_NUMBER: '5',
    });
    assert.equal(payload, null);
    assert.deepEqual(missing, ['GITHUB_WORKFLOW_REF', 'GITHUB_RUN_ID']);
  });

  test('the recorder WRITES the run payload into the Deployment it creates', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x'],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests[0].pathname, '/repos/x/y/deployments');
    assert.deepEqual(requests[0].body.payload, PLAY_IDENTITY);
  });

  test('a WEB record carries the run payload too — every Deployment names the run that wrote it', () => {
    const { code, out, requests } = record(['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/'], {
      RECORD_REPLAY_STATUS: '201',
      GITHUB_WORKFLOW_REF: 'x/y/.github/workflows/deploy-web.yml@refs/heads/main',
      GITHUB_RUN_ID: '35700000101',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_RUN_NUMBER: '101',
    });
    assert.equal(code, 0, out);
    assert.deepEqual(requests[0].body.payload, { workflow: 'deploy-web.yml', run_id: 35700000101, run_attempt: 2, run_number: 101 });
  });

  test('a SUBMITTABLE channel with no run identity is REFUSED, exit 2, before anything is written', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x'],
      { RECORD_REPLAY_STATUS: '201', ...NO_IDENTITY },
    );
    assert.equal(code, 2, out);
    assert.match(out, /is a channel this factory SUBMITS to, and the run identity is missing or unreadable: GITHUB_WORKFLOW_REF, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT, GITHUB_RUN_NUMBER/);
    assert.deepEqual(requests, [], 'a record naming no run would witness nothing, so nothing is written');
  });

  test('a WEB record with no run identity is still written — it is not a submission witness', () => {
    const { code, out, requests } = record(['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/'], {
      RECORD_REPLAY_STATUS: '201',
      ...NO_IDENTITY,
    });
    assert.equal(code, 0, out);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.payload, undefined);
  });

  test('THE REAL TREE: every workflow runs the recorder straight from a step shell that has the run identity', () => {
    const dir = resolve(ROOT, '.github/workflows');
    const problems = [];
    const submitCalls = {};
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const r = identityBlockers(file);
      problems.push(...r.problems);
      if (/^submit-.*\.ya?ml$/.test(file)) submitCalls[file] = r.invocations;
    }
    assert.deepEqual(problems, [], 'a recorder that cannot see GITHUB_RUN_ID writes a Deployment no submitted build can bind to');
    for (const f of ['submit-play.yml', 'submit-snap.yml', 'submit-windows-store.yml']) {
      assert.ok(submitCalls[f] >= 1, `${f} records no Deployment — found ${JSON.stringify(submitCalls)}`);
    }
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

  // 🔴 THE LINE [10]D-6's CADENCE COUNTS ON. `pending_manual_publish` is in the
  // vocabulary and OUT of the submission set: it says the release is an artifact's
  // origin and that nobody submitted anything. A state that drifted into
  // SUBMISSION_STATES would charge three submissions per tag against a cap of two.
  test('the origin state is a state, and it is not a submission', () => {
    assert.equal(STATES.includes('pending_manual_publish'), true);
    assert.equal(SUBMISSION_STATES.includes('pending_manual_publish'), false);
    assert.equal(SUBMIT_TIME_STATES.includes('pending_manual_publish'), false);
    assert.deepEqual([...SUBMISSION_STATES], ['in_review', 'live', 'rejected', 'pulled']);
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

  // ⚠️ The one 4xx that would justify a retry, and it still never takes THIS
  // path. `isRetryable` is the FIXED short backoff, and retrying a 429 on a fixed
  // backoff is how a client turns a throttle into a ban. Since 2026-09-11 a rate
  // limit goes through `classifyRefusal` / `planRateLimitWait` instead, which
  // wait what GitHub's `retry-after` / `x-ratelimit-reset` say, within a bound
  // (cases in github-rate-limit.test.mjs). Pinned so the two paths cannot merge.
  test('429 never takes the fixed backoff — a rate limit waits what GitHub says, not 500 ms', () => {
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
