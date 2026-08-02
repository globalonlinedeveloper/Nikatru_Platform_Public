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
import { mkdtempSync, rmSync } from 'node:fs';
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
} from '../deployment-record.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
};

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

  test('REFUSES an environment no register row claims', () => {
    const { code, out } = record(['subly-nowhere']);
    assert.equal(code, 1);
    assert.match(out, /has a `deploymentEnvironment` template matching/);
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
});
