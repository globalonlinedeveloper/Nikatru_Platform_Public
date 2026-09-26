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
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
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
import {
  RECORD_CALL,
  expandMatrixEnvironment,
  isShellVariableEnvironment,
  shellSegments,
  parseWorkflow,
  stepShell,
  workflowSteps,
} from '../workflow-scan.mjs';
import {
  isRetryable,
  retryDelayMs,
  RETRY_ATTEMPTS,
  runIdentity,
  RUN_IDENTITY_ENV,
  publishedIds,
  workerVersionIdFrom,
  PUBLISHED_ID_KEYS,
  rollbackRecord,
} from '../record-deployment.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CI_DIR, '../..');
const RECORDER = join(CI_DIR, 'record-deployment.mjs');
const READER = join(CI_DIR, 'read-ledger-version-code.mjs');

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
    const { pathname, search } = new URL(url);
    let body = null;
    try {
      body = JSON.parse(init.body ?? 'null');
    } catch {
      body = { unparseable: String(init.body) };
    }
    if (log) appendFileSync(log, `${JSON.stringify({ method: init.method ?? 'GET', pathname, search, body })}\n`);
    // ⏱ 2026-09-24 — the ledger READ (read-ledger-version-code.mjs). It answers the list in
    // RECORD_REPLAY_LIST unless the case names a refusal status of its own; the 401 default
    // is the write's, and a read case that wants a refusal says so.
    if ((init.method ?? 'GET') === 'GET' && /^\/repos\/[^/]+\/[^/]+\/deployments$/.test(pathname)) {
      return process.env.RECORD_REPLAY_STATUS && status >= 300
        ? json({ message: 'Bad credentials' }, status)
        : json(JSON.parse(process.env.RECORD_REPLAY_LIST ?? '[]'), 200);
    }
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
function record(args, env = {}, script = RECORDER) {
  const log = join(TMP, `replay-${seq++}.log`);
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(REPLAY).href, script, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
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
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, stdout: r.stdout ?? '', requests };
}

/** ⏱ 2026-09-24 — the ledger READER, against the same replay. */
const readLedger = (args, env = {}) => record(args, env, READER);

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
/**
 * ⏱ 2026-09-25 · THE SECOND PRODUCER. True when the step holding the call at
 * `file:line` feeds `name` from `${{ steps.<id>.outputs.unit }}`, and the
 * step with that id runs EARLIER in the same job and runs
 * `node tooling/ops/rollback.mjs`. That tool writes `unit` only after resolving
 * it against tooling/channel-register.json (resolveEnvironment) and refusing one
 * no row claims — tooling/ci/test/rollback.test.mjs holds the refusal. A dispatch
 * input fed straight into the call is NOT this, and stays red.
 */
function fedByRollbackResolution(file, line, name) {
  const wf = parseWorkflow(ROOT, `.github/workflows/${file}`);
  for (const job of wf.jobs.values()) {
    const steps = workflowSteps(job);
    const caller = steps.find((s) => s.first <= line && line <= s.last);
    if (!caller) continue;
    const fed = String(caller.env.get(name)?.value ?? '').match(/^\$\{\{\s*steps\.([A-Za-z0-9_-]+)\.outputs\.unit\s*\}\}$/);
    if (!fed) return false;
    const producer = steps.find((s) => s.id === fed[1]);
    return Boolean(
      producer && producer.index < caller.index && /(^|[\s;])node\s+tooling\/ops\/rollback\.mjs\s/.test(producer.run?.text ?? ''),
    );
  }
  return false;
}

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

  // ── SITE ENVIRONMENTS — ⏱ 2026-09-25, D3a (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE) ──
  test('`nikatru-site` resolves from `siteEnvironments` as kind site with app null, in the SHIPPING register', () => {
    const r = resolveEnvironment(REAL_REGISTER, 'nikatru-site');
    assert.notEqual(r, null, 'the apex site deploy must be recordable');
    assert.equal(r.channel.id, 'nikatru-site');
    assert.equal(r.channel.kind, 'site');
    assert.equal(r.app, null);
  });

  test('a site environment is matched exactly, and a register without the list refuses it', () => {
    const withSite = { ...REGISTER, siteEnvironments: [{ id: 'nikatru-site', deploymentEnvironment: 'nikatru-site' }] };
    assert.equal(resolveEnvironment(withSite, 'nikatru-site').channel.kind, 'site');
    assert.equal(resolveEnvironment(withSite, 'nikatru-site-preview'), null);
    assert.equal(resolveEnvironment(REGISTER, 'nikatru-site'), null);
  });

  test('a site record takes no published-id flag: --pages-deployment-id on kind site is REFUSED', () => {
    const r = publishedIds('site', { 'pages-deployment-id': '0123abcd-0123-4abc-8def-0123456789ab' }, {});
    assert.match(r.refusal, /unit of kind "site", which publishes nothing rollback\.yml can re-promote/);
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
      // rollback.yml records the unit rollback.mjs resolved (fedByRollbackResolution).
      if (fedByRollbackResolution(c.file, c.line, name)) continue;
      // ⏱ 2026-09-26 (O-APP-RELEASE-RECORDS-NO-DEPLOYMENT-SILENTLY) — THE PRODUCER IS AN
      // ASSIGNMENT, and the loop reads the variable. This case used to accept ONLY
      // `for <name> in $(… --emit-environments …)`, the one form whose exit `set -e`
      // never sees, so it pinned the swallow. assert-workflow-hardening.mjs limb 12
      // now refuses that form in every `run:` body.
      const codeLines = readFileSync(join(dir, c.file), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*#/.test(l));
      const loopVar = codeLines
        .map((l) => l.match(new RegExp(`for\\s+${name}\\s+in\\s+"?\\$\\{?([A-Za-z_][A-Za-z0-9_]*)\\}?"?\\s*;`)))
        .find(Boolean)?.[1];
      const producer = loopVar && codeLines.find((l) => new RegExp(`^\\s*${loopVar}="\\$\\(`).test(l)
          && /release-manifest\.mjs\s+--emit-environments/.test(l));
      assert.ok(
        producer,
        `${c.file}:${c.line} records \`${c.written}\`, a value this scan cannot read, and no line in that file ` +
          `feeds \`${name}\` from \`release-manifest.mjs --emit-environments\` or from the \`unit\` output of an ` +
          `earlier \`tooling/ops/rollback.mjs\` step — so nothing ties what it records ` +
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
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x', '--version-code', '5'],
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
/** ⏱ 2026-09-25 — the two id keys every payload carries, here with no id. */
const NO_IDS = { pages_deployment_id: null, worker_version_id: null };

/** Every `node … record-deployment.mjs` invocation in one workflow, and each
 *  thing in that file that would stop it carrying the runner's run identity:
 *  a wrapper in front of `node` (`env -i`, `sudo`, `docker run`, an inline
 *  assignment), or an `env:` entry that sets an identity variable to anything
 *  but its own `github.*` context. The SHELL each call runs under is
 *  `dialectBlockers`' question, below. */
function identityBlockers(file) {
  const lines = readFileSync(join(ROOT, '.github/workflows', file), 'utf8').split('\n');
  const CONTEXT ={ GITHUB_WORKFLOW_REF: 'workflow_ref', GITHUB_RUN_ID: 'run_id', GITHUB_RUN_ATTEMPT: 'run_attempt', GITHUB_RUN_NUMBER: 'run_number' };
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
  }
  return { invocations, problems };
}

/** ⏱ 2026-09-23 · THE SHELL THAT READS THE RECORDER'S ARGUMENTS. Every call
 *  writes them in bash — `"$LISTING_URL"`, `"$environment"`, `"$TOOL-amo"` —
 *  and so does RECORD_CALL, the one reader of the call site. Under pwsh each of
 *  those is an unset PowerShell VARIABLE, not the step's `env:` entry, so it
 *  expands to nothing. submit-windows-store.yml's recorder ran exactly there:
 *  no `shell:` on the step, in a `runs-on: windows-2025` job, whose default is
 *  pwsh. The recorder got no listing URL and exited 1 before any POST, and the
 *  check this replaces passed it, because it read only an explicit `shell:` key
 *  and admitted pwsh even when one was written. The shell is now the one the
 *  step RUNS under (workflow-scan's `stepShell`: step, job defaults, workflow
 *  defaults, then the runner's own default), and only bash or sh reads bash.
 *
 *  Why bash and not "pwsh with `$env:NAME`": one call site, one dialect. A pwsh
 *  call would be read in bash by every reader of RECORD_CALL, so it would be
 *  right on the runner and misread in every report about it. */
function dialectBlockers(file, root = ROOT) {
  const rel = `.github/workflows/${file}`;
  const lines = readFileSync(join(root, rel), 'utf8').split('\n');
  const wf = parseWorkflow(root, rel);
  const problems = [];
  let invocations = 0;
  for (const [i, raw] of lines.entries()) {
    if (/^\s*#/.test(raw) || !/node\s+\S*record-deployment\.mjs/.test(raw)) continue;
    invocations += 1;
    const sh = stepShell(wf, i + 1);
    if (sh.family === 'bash' || sh.family === 'sh') continue;
    problems.push(
      sh.shell === null
        ? `${file}:${i + 1} runs the recorder under a shell nobody can name: ${sh.why} — declare \`shell: bash\` on the step`
        : `${file}:${i + 1} runs the recorder under \`${sh.shell}\` (${sh.from}, line ${sh.n}), which reads its bash-written arguments as its own unset variables — declare \`shell: bash\` on the step`,
    );
  }
  return { invocations, problems };
}

/** A one-job workflow in a fresh root, for dialectBlockers. */
function recorderFixture(body) {
  const root = join(TMP, `wf-${seq++}`);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'submit-x.yml'), body);
  return root;
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
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x', '--version-code', '5'],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests[0].pathname, '/repos/x/y/deployments');
    assert.deepEqual(requests[0].body.payload, { ...PLAY_IDENTITY, version_code: 5, ...NO_IDS });
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
    assert.deepEqual(requests[0].body.payload, { workflow: 'deploy-web.yml', run_id: 35700000101, run_attempt: 2, run_number: 101, ...NO_IDS });
  });

  test('a SUBMITTABLE channel with no run identity is REFUSED, exit 2, before anything is written', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x', '--version-code', '5'],
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
    // ⏱ 2026-09-25 — no run and no id, and the payload still says so: two nulls, never an absent key.
    assert.deepEqual(requests[0].body.payload, NO_IDS);
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

  test('THE REAL TREE: every recorder call runs under bash, the dialect its arguments are written in', () => {
    const dir = resolve(ROOT, '.github/workflows');
    const problems = [];
    const calls = {};
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const r = dialectBlockers(file);
      problems.push(...r.problems);
      calls[file] = r.invocations;
    }
    assert.deepEqual(problems, [], 'a recorder whose shell cannot read "$LISTING_URL" records nothing, and a real submission goes unwitnessed');
    assert.ok(calls['submit-windows-store.yml'] >= 1, `the Windows Store lane records no Deployment — found ${JSON.stringify(calls)}`);
  });

  test('the Windows Store shape — no `shell:`, runs-on windows — is REFUSED: pwsh reads "$LISTING_URL" as its own unset variable', () => {
    const root = recorderFixture(`name: X
on: workflow_dispatch
jobs:
  submit:
    runs-on: windows-2025
    steps:
      - name: Record the submission in the [10]D-9 ledger
        env:
          LISTING_URL: \${{ inputs.listing_url }}
        run: node tooling/ci/record-deployment.mjs subscriptiontracker-windows-store --state in_review --listing-url "$LISTING_URL"
`);
    const { invocations, problems } = dialectBlockers('submit-x.yml', root);
    assert.equal(invocations, 1);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /^submit-x\.yml:10 runs the recorder under `pwsh` \(runner default, runs-on: windows-2025, line 5\)/);
  });

  test('the same Windows step with `shell: bash` passes — Git Bash reads "$LISTING_URL" from the step env', () => {
    const root = recorderFixture(`name: X
on: workflow_dispatch
jobs:
  submit:
    runs-on: windows-2025
    steps:
      - name: Record the submission in the [10]D-9 ledger
        shell: bash
        env:
          LISTING_URL: \${{ inputs.listing_url }}
        run: node tooling/ci/record-deployment.mjs subscriptiontracker-windows-store --state in_review --listing-url "$LISTING_URL"
`);
    assert.deepEqual(dialectBlockers('submit-x.yml', root), { invocations: 1, problems: [] });
  });

  test('a recorder whose job runs on an EXPRESSION, with no shell declared, is REFUSED — nobody can say which dialect reads it', () => {
    const root = recorderFixture(`name: X
on: workflow_dispatch
jobs:
  submit:
    runs-on: \${{ matrix.os }}
    steps:
      - run: node tooling/ci/record-deployment.mjs x-web https://x.example/
`);
    const { problems } = dialectBlockers('submit-x.yml', root);
    assert.equal(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /a shell nobody can name: job "submit" runs on `\$\{\{ matrix\.os \}\}`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-24 · A PLAY UPLOAD RECORDS ITS versionCode (cloud-review #909 finding 1).
// The committed mark in tooling/channel-register.json moved only when somebody committed
// it, so a run nobody recorded left --play-floor comparing against a stale mark. The
// upload's own ledger Deployment now carries `payload.version_code`, and
// read-ledger-version-code.mjs hands the largest one to --play-floor before each build.
// Whether a row requires the flag is read from the register (`versionCodeHighWater`),
// never from the environment's name.
// ─────────────────────────────────────────────────────────────────────────────
const PLAY_ARGS = ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x'];

describe('record-deployment — a Play upload writes its versionCode into the ledger', () => {
  test('the Deployment payload carries version_code beside the run identity (L1)', () => {
    const { code, out, requests } = record([...PLAY_ARGS, '--version-code', '7'], { RECORD_REPLAY_STATUS: '201' });
    assert.equal(code, 0, out);
    assert.equal(requests[0].pathname, '/repos/x/y/deployments');
    assert.equal(requests[0].body.payload.version_code, 7);
    assert.equal(requests[0].body.payload.run_id, 35787897094, 'the run identity stays beside it');
  });

  test('a row with a versionCodeHighWater block REFUSES a record with no --version-code, before anything is written (L2)', () => {
    const { code, out, requests } = record(PLAY_ARGS, { RECORD_REPLAY_STATUS: '201' });
    assert.equal(code, 1, out);
    assert.match(out, /--version-code/);
    assert.deepEqual(requests, [], 'a Play record that names no versionCode is not written');
  });

  test('a row with no versionCodeHighWater block REFUSES --version-code, before anything is written (L3)', () => {
    const { code, out, requests } = record(['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/', '--version-code', '7'], {
      RECORD_REPLAY_STATUS: '201',
    });
    assert.equal(code, 1, out);
    assert.match(out, /--version-code/);
    assert.deepEqual(requests, []);
  });
});

describe('read-ledger-version-code — the largest versionCode the ledger holds', () => {
  test('prints the largest version_code, reading a string payload as JSON (L4)', () => {
    const list = [{ payload: { version_code: 5 } }, { payload: '{"version_code":9}' }, { payload: {} }];
    const { code, out, stdout, requests } = readLedger(['subscriptiontracker-android-play'], { RECORD_REPLAY_LIST: JSON.stringify(list) });
    assert.equal(code, 0, out);
    assert.equal(stdout.trim(), '9');
    assert.deepEqual(requests.map((r) => `${r.method} ${r.pathname}`), ['GET /repos/x/y/deployments'], 'one short page, one read');
    assert.match(requests[0].search, /environment=subscriptiontracker-android-play/);
  });

  test('prints `none` when no Deployment carries a version_code (L5)', () => {
    const list = [
      { payload: { workflow: 'submit-play.yml', run_id: 35787897094, run_attempt: 1, run_number: 5 } },
      { payload: '' },
      {},
    ];
    const { code, out, stdout } = readLedger(['subscriptiontracker-android-play'], { RECORD_REPLAY_LIST: JSON.stringify(list) });
    assert.equal(code, 0, out);
    assert.equal(stdout.trim(), 'none');
  });

  test('exits 2 and prints nothing on stdout when GitHub refuses the read (L6)', () => {
    const { code, out, stdout } = readLedger(['subscriptiontracker-android-play'], { RECORD_REPLAY_STATUS: '401' });
    assert.equal(code, 2, out);
    assert.equal(stdout, '', 'the step reads stdout as the answer, so a refusal must print none of it');
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

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 · THE UNIT OF REVERT (row O-DEPLOY-IS-NOT-ONE-GATED-LANE, limb 4).
// A SHA does not say which Cloudflare object serves it, and rollback.yml
// re-promotes an OBJECT: a Pages deployment or a Worker version. Every payload
// now names both, null when the step had none. The id's shape (a UUID) is an
// assumption, so an unreadable id is a warning and a null — the record of a
// deploy that happened is never lost over it — while an id flag on the wrong
// kind of unit is refused before anything is written.
// ─────────────────────────────────────────────────────────────────────────────
const PAGES_ID = '3f2b8c1a-5d4e-4f60-8a7b-9c0d1e2f3a4b';
const WORKER_ID = '5f0e7a52-1c3b-4d2e-9f60-7a8b9c0d1e2f';
/** A made-up `wrangler deploy` output. The var line is the reason no warning
 *  may quote this text: wrangler prints the Worker's vars. */
const DEPLOY_OUTPUT = [
  'Total Upload: 100.00 KiB / gzip: 20.00 KiB',
  'Your Worker has access to the following bindings:',
  'env.GLITCHTIP_DSN ("https://made-up-fixture-key@example.invalid/1")',
  'Uploaded platform (2.00 sec)',
  'Deployed platform triggers (0.50 sec)',
  '  https://platform.nikatru.com',
  `Current Version ID: ${WORKER_ID}`,
].join('\n');

describe('record-deployment — every payload names the Pages deployment or Worker version it published', () => {
  test('the two keys are the ones rollback.mjs reads', () => {
    assert.deepEqual([...PUBLISHED_ID_KEYS], ['pages_deployment_id', 'worker_version_id']);
  });

  test('workerVersionIdFrom reads the id off the `Current Version ID:` line', () => {
    assert.equal(workerVersionIdFrom(DEPLOY_OUTPUT), WORKER_ID);
  });

  test('workerVersionIdFrom returns null when two lines name DIFFERENT versions — a guess is a rollback to the wrong one', () => {
    const two = `${DEPLOY_OUTPUT}\nCurrent Version ID: 00000000-0000-4000-8000-000000000000`;
    assert.equal(workerVersionIdFrom(two), null);
  });

  test('workerVersionIdFrom returns null for output with no version line, and for a value that is not an id', () => {
    assert.equal(workerVersionIdFrom('Uploaded platform (2.00 sec)'), null);
    assert.equal(workerVersionIdFrom('Current Version ID: (none)'), null);
  });

  test('publishedIds: a web unit takes --pages-deployment-id and lower-cases it', () => {
    const r = publishedIds('web', { 'pages-deployment-id': PAGES_ID.toUpperCase() }, {});
    assert.equal(r.refusal, null);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.ids, { pages_deployment_id: PAGES_ID, worker_version_id: null });
  });

  test('publishedIds: a store unit takes no id flag at all', () => {
    const r = publishedIds('store', { 'worker-version-id': WORKER_ID }, {});
    assert.match(r.refusal, /--worker-version-id was given for a unit of kind "store", which publishes nothing rollback\.yml can re-promote/);
  });

  test('a WEB record writes the Pages deployment id it was given', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/', '--pages-deployment-id', PAGES_ID],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests[0].body.payload.pages_deployment_id, PAGES_ID);
    assert.equal(requests[0].body.payload.worker_version_id, null);
    assert.match(out, new RegExp(`Pages deployment ${PAGES_ID}`));
  });

  test('a SERVICE record reads the Worker version out of the deploy output in the named variable — and never prints that output', () => {
    const { code, out, requests } = record(
      ['platform', 'https://platform.nikatru.com', '--wrangler-output-env', 'DEPLOY_OUTPUT'],
      { RECORD_REPLAY_STATUS: '201', DEPLOY_OUTPUT },
    );
    assert.equal(code, 0, out);
    assert.equal(requests[0].body.payload.worker_version_id, WORKER_ID);
    assert.equal(requests[0].body.payload.pages_deployment_id, null);
    assert.ok(!out.includes('made-up-fixture-key'), 'wrangler prints the Worker vars; the recorder must not echo them');
  });

  test('an EMPTY Pages deployment id warns and writes the record anyway, with the id null', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/', '--pages-deployment-id', ''],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests.length, 2, 'the deploy happened; its record is written');
    assert.equal(requests[0].body.payload.pages_deployment_id, null);
    assert.match(out, /::warning title=This Deployment names no re-promotable id::the Pages deployment id is empty/);
  });

  test('deploy output with no version line warns and writes the record anyway, with the id null', () => {
    const { code, out, requests } = record(
      ['platform', 'https://platform.nikatru.com', '--wrangler-output-env', 'DEPLOY_OUTPUT'],
      { RECORD_REPLAY_STATUS: '201', DEPLOY_OUTPUT: 'Uploaded platform (2.00 sec)' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].body.payload.worker_version_id, null);
    assert.match(out, /the deploy output in DEPLOY_OUTPUT \(28 characters\) names no single `Current Version ID:`/);
  });

  test('a Worker version id that is not an id warns, and is recorded as null rather than as the bad value', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-api', 'https://subscriptiontracker-api.nikatru.com', '--worker-version-id', 'latest'],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests[0].body.payload.worker_version_id, null);
    assert.match(out, /the Worker version id is not an id \(6 characters, not a UUID\)/);
  });

  test('a Pages id on a SERVICE unit is REFUSED, exit 1, before anything is written', () => {
    const { code, out, requests } = record(
      ['platform', 'https://platform.nikatru.com', '--pages-deployment-id', PAGES_ID],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--pages-deployment-id was given for a unit of kind "service", which takes --wrangler-output-env or --worker-version-id/);
    assert.deepEqual(requests, []);
  });

  test('a Worker id on a WEB unit is REFUSED, exit 1, before anything is written', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-web', 'https://nikatru.com/subscriptiontracker/', '--worker-version-id', WORKER_ID],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--worker-version-id was given for a unit of kind "web", which takes --pages-deployment-id/);
    assert.deepEqual(requests, []);
  });

  test('both Worker id sources at once is REFUSED — a record names one Worker version', () => {
    const { code, out, requests } = record(
      ['platform', 'https://platform.nikatru.com', '--wrangler-output-env', 'DEPLOY_OUTPUT', '--worker-version-id', WORKER_ID],
      { RECORD_REPLAY_STATUS: '201', DEPLOY_OUTPUT },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--wrangler-output-env and --worker-version-id were both given/);
    assert.deepEqual(requests, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 · …AND THE DEPLOY WORKFLOWS HAND IT OVER. A recorder that can
// take an id is worth nothing if the step calling it passes none: every record
// would carry two nulls and rollback.yml would have nothing to re-promote.
// ─────────────────────────────────────────────────────────────────────────────
/** Every step of one workflow that runs the recorder, with its job's name. */
function recorderSteps(file) {
  const wf = parseWorkflow(ROOT, `.github/workflows/${file}`);
  const out = [];
  for (const job of wf.jobs.values()) {
    for (const step of workflowSteps(job)) {
      if (step.run && /record-deployment\.mjs/.test(step.run.text)) out.push({ job: job.name, step });
    }
  }
  return out;
}

describe('the deploy workflows hand the recorder the id their deploy step published', () => {
  // ⏱ 2026-09-25 · D3a: deploy-web.yml's `site` job records `nikatru-site`, a kind `site`
  // row, which takes NO published-id flag (record-deployment.mjs refuses one at run time).
  test('THE REAL TREE: deploy-web.yml passes the Pages deployment id, through env:', () => {
    const steps = recorderSteps('deploy-web.yml');
    assert.deepEqual(steps.map((s) => s.job), ['deploy-web', 'site'], `deploy-web.yml records ${steps.length} time(s)`);
    const { step } = steps[0];
    assert.equal(step.env.get('PAGES_DEPLOYMENT_ID')?.value, '${{ steps.deploy.outputs.pages-deployment-id }}');
    assert.match(step.run.text, /--pages-deployment-id "\$PAGES_DEPLOYMENT_ID"(\s|$)/);
  });

  test('THE REAL TREE: the `site` job records nikatru-site with no id flag, which its kind would refuse', () => {
    const site = recorderSteps('deploy-web.yml').find((s) => s.job === 'site');
    assert.ok(site, 'deploy-web.yml has no recording `site` job');
    assert.match(site.step.run.text, /record-deployment\.mjs nikatru-site https:\/\/nikatru-apex\.pages\.dev\s*$/);
    assert.doesNotMatch(site.step.run.text, /--(pages-deployment-id|worker-version-id|wrangler-output-env)\b/);
    assert.equal(resolveEnvironment(REAL_REGISTER, 'nikatru-site')?.channel?.kind, 'site');
  });

  test('THE REAL TREE: each deploy-workers.yml job passes its deploy output, through env:', () => {
    const steps = recorderSteps('deploy-workers.yml');
    assert.deepEqual(steps.map((s) => s.job), ['subscriptiontracker-api', 'platform']);
    assert.equal(steps[0].step.env.get('DEPLOY_OUTPUT')?.value, '${{ steps.deploy.outputs.command-output }}');
    assert.match(steps[0].step.run.text, /--wrangler-output-env DEPLOY_OUTPUT(\s|$)/);
    assert.equal(steps[1].step.env.get('DEPLOY_OUTPUT')?.value, '${{ steps.deploy.outputs.command-output }}');
    assert.match(steps[1].step.run.text, /--wrangler-output-env DEPLOY_OUTPUT(\s|$)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-25 · A RE-PROMOTION RECORDS THE COMMIT THAT WENT BACK LIVE.
// rollback.yml records its outcome here. At GITHUB_SHA the ledger would name
// the build just taken down as live, and plan-deploy.mjs — which reads the
// newest successful Deployment as what is live — would never roll forward.
// ─────────────────────────────────────────────────────────────────────────────
const REPROMOTED = '0123456789abcdef0123456789abcdef01234567';

describe('record-deployment — a re-promotion is recorded at the commit it put back', () => {
  test('--rollback-of with --ref: ref and description name the re-promoted commit, and the payload says it is a rollback', () => {
    const { code, out, requests } = record(
      [
        'subscriptiontracker-web',
        'https://nikatru.com/subscriptiontracker/',
        '--rollback-of',
        '9001',
        '--ref',
        REPROMOTED.toUpperCase(),
        '--pages-deployment-id',
        PAGES_ID,
      ],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 0, out);
    assert.equal(requests[0].body.ref, REPROMOTED);
    assert.equal(requests[0].body.description, encodeDescription({ state: 'live', sha: REPROMOTED, listingUrl: null }));
    assert.equal(requests[0].body.payload.rollback, true);
    assert.equal(requests[0].body.payload.rollback_of, 9001);
    assert.equal(requests[0].body.payload.pages_deployment_id, PAGES_ID);
    assert.match(out, /re-promoted from ledger Deployment 9001/);
  });

  test('--ref without --rollback-of is REFUSED, before anything is written', () => {
    const { code, out, requests } = record(
      ['platform', 'https://platform.nikatru.com', '--ref', REPROMOTED],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--ref was given without --rollback-of/);
    assert.deepEqual(requests, []);
  });

  test('--rollback-of without --ref is REFUSED: recorded at GITHUB_SHA it would name the bad build live', () => {
    const { code, out, requests } = record(
      ['platform', 'https://platform.nikatru.com', '--rollback-of', '9001', '--worker-version-id', WORKER_ID],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--rollback-of was given without --ref/);
    assert.deepEqual(requests, []);
  });

  test('--rollback-of on a STORE unit is REFUSED: only web and service units are re-promoted', () => {
    const { code, out, requests } = record(
      ['subscriptiontracker-android-play', '--state', 'in_review', '--listing-url', 'https://play.google.com/store/apps/details?id=x', '--rollback-of', '9001', '--ref', REPROMOTED],
      { RECORD_REPLAY_STATUS: '201' },
    );
    assert.equal(code, 1, out);
    assert.match(out, /--rollback-of was given for a unit of kind "store"/);
    assert.deepEqual(requests, []);
  });

  test('rollbackRecord: an abbreviated --ref is refused; neither flag is an ordinary record', () => {
    assert.match(rollbackRecord('web', '9001', 'abc12345').refusal, /is not a full 40-character commit SHA/);
    assert.deepEqual(rollbackRecord('web', null, null), { sha: null, payload: {}, refusal: null });
  });
});
