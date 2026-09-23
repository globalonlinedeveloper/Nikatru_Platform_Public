// ─────────────────────────────────────────────────────────────────────────────
// consent-anon-id.test.mjs — the parse that decides WHICH consent row the
// nightly's teardown deletes from production.
//
// `tooling/e2e/consent_anon_id.mjs` is the fixture-testable half of the consent
// leg, split out from the live assertion deliberately. The live half re-reads
// platform_db and can only be exercised by a real run; THIS half turns two files
// on disk into an id, and every way that can go wrong is reachable from a temp
// directory — so it gets real inputs and real failing cases rather than an
// exemption.
//
// 🔴 THE STAKES ARE NOT "the verifier prints the wrong number". The id parsed
// here is bound into `DELETE FROM consent_artifacts WHERE app_id = ? AND
// anon_id = ?` against the live shared database. A parser that returned a
// truncated value, a placeholder or somebody else's id would delete a row this
// run never wrote. That is why the module refuses anything that is not the exact
// shape the app mints, and why the refusals below are tested as hard as the
// successes.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  resolveConsentAnonId,
  resolveCaptureConsentIds,
  ANON_ID_TOKEN,
  ANON_ID_SHAPE,
} from '../../e2e/consent_anon_id.mjs';
import { stampDeletable } from '../../e2e/app-version-stamp.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Two ids of the shape `installIdProvider` mints: 16 bytes as lower-case hex. */
const ID_A = 'cc67f474e059850cb5f57dccf07bc7ba';
const ID_B = '9ba437ef31bb1a06d0dc9eebc7104f4d';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-consent-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A real file on disk, because the module reads real files. */
const write = (name, text) => {
  const path = join(TMP, name);
  writeFileSync(path, text);
  return path;
};

/** `writeResponseData` writes `response.data` VERBATIM, so the file's top level
 *  is the reportData map itself — `screenshots` beside `consent_anon_id`. The
 *  fixtures keep that shape rather than a convenient one. */
const responseFile = (name, extra) =>
  write(
    name,
    JSON.stringify({ screenshots: [{ screenshotName: '00-consent', bytes: [] }], ...extra }, null, 2),
  );

const logFile = (name, ...lines) =>
  write(name, ['00:00 +0: loading...', ...lines, 'All tests passed.'].join('\n'));

describe('resolveConsentAnonId', () => {
  test('reads the id out of reportData', () => {
    const r = resolveConsentAnonId({
      responsePath: responseFile('a.json', { consent_anon_id: ID_A }),
    });
    assert.equal(r.id, ID_A);
    assert.match(r.source, /reportData/);
  });

  test('🔴 reportData BEATS the drive log when both carry one', () => {
    // The two channels can disagree — the log is append-only across re-runs and
    // the response file is rewritten — and the structured one is the one written
    // by the run that just finished. If this precedence ever inverts, the
    // teardown deletes a row belonging to an earlier attempt.
    const r = resolveConsentAnonId({
      responsePath: responseFile('b.json', { consent_anon_id: ID_A }),
      logPath: logFile('b.log', `${ANON_ID_TOKEN}=${ID_B}`),
    });
    assert.equal(r.id, ID_A);
  });

  test('falls back to the drive log when the response file does not exist', () => {
    const r = resolveConsentAnonId({
      responsePath: join(TMP, 'never-written.json'),
      logPath: logFile('c.log', `${ANON_ID_TOKEN}=${ID_B}`),
    });
    assert.equal(r.id, ID_B);
    assert.match(r.source, /drive log/);
    assert.ok(
      r.notes.some((n) => /never-written\.json could not be read/.test(n)),
      `the notes must say what the first source answered, got: ${r.notes.join(' | ')}`,
    );
  });

  test('falls back when the response file exists but carries no id', () => {
    // The shape of a run that ended before the consent tap, or an older build.
    const r = resolveConsentAnonId({
      responsePath: responseFile('d.json', {}),
      logPath: logFile('d.log', `${ANON_ID_TOKEN}=${ID_B}`),
    });
    assert.equal(r.id, ID_B);
    assert.ok(r.notes.some((n) => /carries no `consent_anon_id`/.test(n)));
  });

  test('falls back when the response file is not JSON at all', () => {
    const r = resolveConsentAnonId({
      responsePath: write('e.json', 'All tests passed.\n'),
      logPath: logFile('e.log', `${ANON_ID_TOKEN}=${ID_B}`),
    });
    assert.equal(r.id, ID_B);
    assert.ok(r.notes.some((n) => /is not JSON/.test(n)));
  });

  test('takes the LAST token in a log that holds several', () => {
    // A retried drive appends to the same file; the newest line is the run whose
    // row is still in the database.
    const r = resolveConsentAnonId({
      logPath: logFile('f.log', `${ANON_ID_TOKEN}=${ID_A}`, 'retrying', `${ANON_ID_TOKEN}=${ID_B}`),
    });
    assert.equal(r.id, ID_B);
  });

  test('🔴 REFUSES a malformed id in reportData rather than passing it on', () => {
    // Truncated, upper-cased, or a placeholder someone left in — none of these
    // may reach a DELETE. With no log to fall back to the answer is "no id",
    // which every caller treats as "could not look".
    for (const bad of ['', 'null', 'undefined', ID_A.slice(0, 20), ID_A.toUpperCase(), `${ID_A}extra`]) {
      const r = resolveConsentAnonId({
        responsePath: responseFile(`bad-${bad.length}-${bad.slice(0, 4)}.json`, { consent_anon_id: bad }),
      });
      assert.equal(r.id, null, `expected ${JSON.stringify(bad)} to be refused, got ${r.id}`);
    }
  });

  test('🔴 REFUSES a malformed id in the log, and SAYS the token was there', () => {
    // The difference between "the driver printed nothing" and "the driver
    // printed something unreadable" is the difference between a suite that
    // never got that far and a contract that has drifted.
    const r = resolveConsentAnonId({
      logPath: logFile('g.log', `${ANON_ID_TOKEN}=NOT-AN-ID`),
    });
    assert.equal(r.id, null);
    assert.ok(
      r.notes.some((n) => n.includes(ANON_ID_TOKEN) && /none is the/.test(n)),
      `the notes must distinguish a bad token from an absent one, got: ${r.notes.join(' | ')}`,
    );
  });

  test('with neither path given, answers null and says it consulted nothing', () => {
    const r = resolveConsentAnonId();
    assert.equal(r.id, null);
    assert.equal(r.notes.length, 2);
    for (const n of r.notes) assert.match(n, /no path was given/);
  });

  test('the shape refuses everything that is not 32 lower-case hex', () => {
    // An assertion that cannot fail is worse than none: this one pins the
    // regex's actual boundaries rather than restating that it exists.
    assert.ok(ANON_ID_SHAPE.test(ID_A));
    for (const bad of ['0'.repeat(31), '0'.repeat(33), 'g'.repeat(32), `\n${ID_A}\n`, ` ${ID_A}`]) {
      assert.equal(ANON_ID_SHAPE.test(bad), false, `${JSON.stringify(bad)} should not match`);
    }
  });
});

// ── THE STORE CAPTURE'S LEDGER (added 2026-09-23) ────────────────────────────
//
// A capture runs one drive per viewport and each drive can write its own consent
// row, so the capture's purge deletes by EVERY id its ledger names. The stakes
// are the nightly's, doubled: an id that is wrong deletes somebody else's row,
// and a drive that is silently skipped leaves one behind while the step passes.
// So an unreadable ledger and a drive with no id are UNRESOLVED — a failure the
// purge reports — never "nothing to do".
describe('resolveCaptureConsentIds', () => {
  const ledger = (name, value) => write(name, typeof value === 'string' ? value : JSON.stringify(value));

  test('an ABSENT ledger resolves nothing and fails nothing, and says why', () => {
    const r = resolveCaptureConsentIds(join(TMP, 'never-written-ledger.json'));
    assert.deepEqual(r.ids, []);
    assert.deepEqual(r.unresolved, []);
    assert.equal(r.stamp, null);
    assert.ok(r.notes.some((n) => /no ledger/.test(n)), r.notes.join('\n'));
  });

  test('🔴 a ledger that is not JSON is UNRESOLVED, never "nothing to do"', () => {
    const r = resolveCaptureConsentIds(ledger('garbled-ledger.json', '{"stamp":"cap-57-40c0787","drives":['));
    assert.deepEqual(r.ids, []);
    assert.equal(r.unresolved.length, 1);
    assert.match(r.unresolved[0], /ledger unreadable/);
  });

  test('two drives with two ids return both, and a repeated id once', () => {
    const r = resolveCaptureConsentIds(
      ledger('two-drives.json', {
        stamp: 'cap-57-40c0787',
        drives: [
          { viewport: 'phone', state: 'done', consent_prompt: 'answered', consent_anon_id: ID_A },
          { viewport: 'tablet-7', state: 'done', consent_prompt: 'answered', consent_anon_id: ID_B },
          { viewport: 'tablet-10', state: 'done', consent_prompt: 'answered', consent_anon_id: ID_A },
        ],
      }),
    );
    assert.deepEqual(r.ids, [ID_A, ID_B]);
    assert.deepEqual(r.unresolved, []);
    assert.equal(r.stamp, 'cap-57-40c0787');
  });

  test('🔴 a drive still "driving" with no board record is UNRESOLVED', () => {
    const r = resolveCaptureConsentIds(
      ledger('killed-before-record.json', {
        stamp: 'cap-57-40c0787',
        drives: [
          { viewport: 'phone', state: 'done', consent_prompt: 'answered', consent_anon_id: ID_A },
          { viewport: 'tablet-7', state: 'driving', record: join(TMP, 'no-such-board-record.json') },
        ],
      }),
    );
    assert.deepEqual(r.ids, [ID_A]);
    assert.equal(r.unresolved.length, 1);
    assert.match(r.unresolved[0], /tablet-7/);
  });

  test('a runner killed after the drive wrote its board record: the id is read from the record', () => {
    const record = write(
      'board-tablet-10.json',
      JSON.stringify({ screenshots: [], consent_prompt: 'answered', consent_anon_id: ID_B }),
    );
    const r = resolveCaptureConsentIds(
      ledger('killed-after-record.json', {
        stamp: 'cap-57-40c0787',
        drives: [{ viewport: 'tablet-10', state: 'driving', record }],
      }),
    );
    assert.deepEqual(r.ids, [ID_B]);
    assert.deepEqual(r.unresolved, []);
  });

  test('a drive whose consent prompt never appeared is a note, not unresolved', () => {
    const r = resolveCaptureConsentIds(
      ledger('prompt-absent.json', {
        stamp: 'cap-57-40c0787',
        drives: [{ viewport: 'phone', state: 'done', exit: 0, consent_prompt: 'absent' }],
      }),
    );
    assert.deepEqual(r.ids, []);
    assert.deepEqual(r.unresolved, []);
    assert.ok(r.notes.some((n) => /never appeared/.test(n)), r.notes.join('\n'));
  });

  test('🔴 an answered drive with a MALFORMED id is unresolved, and SAYS the id was there', () => {
    const r = resolveCaptureConsentIds(
      ledger('malformed-id.json', {
        stamp: 'cap-57-40c0787',
        drives: [{ viewport: 'phone', state: 'done', consent_prompt: 'answered', consent_anon_id: ID_A.slice(0, 20) }],
      }),
    );
    assert.deepEqual(r.ids, [], 'a truncated id must never be bound into a DELETE');
    assert.equal(r.unresolved.length, 1);
    assert.match(r.unresolved[0], /was reported but is not the 32-hex/);
  });

  test('stampDeletable admits only cap-* and rehearsal-*', () => {
    assert.equal(stampDeletable('cap-57-40c0787'), true);
    assert.equal(stampDeletable('rehearsal-1790000000'), true);
    // 🔴 e2e legs share a stamp and verify_consent reads the row; `dev` is every
    // unstamped build; a released version names real users' rows.
    for (const refused of ['e2e-1-abcdef0', 'dev', '1.0.101+e138f5b', null, undefined, '']) {
      assert.equal(stampDeletable(refused), false, `${JSON.stringify(refused)} must never be deleted by app_version`);
    }
  });
});

// ── THE PURGE REFUSES A MIXED CONSENT SOURCE, BEFORE ANY REQUEST ─────────────
//
// Spawned with an env that carries NO Cloudflare or Supabase credential at all,
// so no request can be made whatever the script does. Without the refusal the
// script would still exit 1 — on the first missing credential — so the
// assertion is on WHAT stderr names, not on the exit code alone.
describe('purge.mjs refuses a miswired consent source', () => {
  const PURGE = join(REPO, 'tooling', 'e2e', 'purge.mjs');
  const bare = (extra) => ({
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? '',
    ...extra,
  });

  test('🔴 E2E_CONSENT_LEDGER mixed with E2E_DRIVE_LOG is refused and named', () => {
    const r = spawnSync(process.execPath, [PURGE], {
      encoding: 'utf8',
      timeout: 60_000,
      env: bare({
        E2E_CONSENT_LEDGER: join(TMP, 'mixed-ledger.json'),
        E2E_DRIVE_LOG: join(TMP, 'mixed-drive.log'),
        PLATFORM_D1_DATABASE_ID: 'not-a-real-database',
      }),
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /REFUSED: E2E_CONSENT_LEDGER .* E2E_RESPONSE_DATA \/ E2E_DRIVE_LOG/);
    assert.doesNotMatch(r.stderr, /Missing required env var/);
  });

  test('🔴 E2E_CONSENT_LEDGER without PLATFORM_D1_DATABASE_ID is refused and named', () => {
    const r = spawnSync(process.execPath, [PURGE], {
      encoding: 'utf8',
      timeout: 60_000,
      env: bare({ E2E_CONSENT_LEDGER: join(TMP, 'lonely-ledger.json') }),
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /REFUSED: E2E_CONSENT_LEDGER is set but PLATFORM_D1_DATABASE_ID is not/);
  });
});

// ── COVERAGE SELF-CHECK — the two ends of the contract this module sits between ─
//
// 🔴 BOTH OF THESE FAIL SILENTLY AND FOREVER IF THEY DRIFT. The parser looks for
// a JSON field with one name and a log token with another; the app writes the
// first and the driver prints the second. Rename either and this module goes on
// working perfectly against input nothing produces — it would simply return
// `null` every night, the verifier would exit 2, and the message would be about
// a missing id rather than about a renamed key. The unit tests above cannot see
// that, because they supply both ends themselves.
describe('the producers still produce what this parses', () => {
  const REPORT_FIELD = 'consent_anon_id';
  const PROMPT_FIELD = 'consent_prompt';
  const IT = 'apps/subscriptiontracker/integration_test';
  const read = (name) => readFileSync(join(REPO, IT, name), 'utf8');

  // The two live drives publish through ONE helper (consent.dart, 2026-09-23),
  // so the key names are written in exactly one Dart file.
  test(`the shared helper writes \`${REPORT_FIELD}\` and \`${PROMPT_FIELD}\` into reportData`, () => {
    const helper = read('consent.dart');
    for (const field of [REPORT_FIELD, PROMPT_FIELD]) {
      assert.ok(
        helper.includes(`reportData!['${field}']`),
        `${IT}/consent.dart no longer writes \`${field}\` into binding.reportData. The nightly and the store ` +
          'capture would still be green and the consent artifact each uploads would be unfindable.',
      );
    }
    assert.ok(
      helper.includes(`${ANON_ID_TOKEN}=`),
      `${IT}/consent.dart no longer prints \`${ANON_ID_TOKEN}=\` beside the reportData write.`,
    );
  });

  test('🔴 BOTH live drives publish through the helper', () => {
    for (const name of ['app_test.dart', 'store_screenshots_test.dart']) {
      const suite = read(name);
      assert.ok(
        /\bpublishConsent\(\s*binding\b/.test(suite) && suite.includes("import 'consent.dart';"),
        `${IT}/${name} no longer calls publishConsent(binding, …) from consent.dart. A live drive that answers the ` +
          'consent prompt without publishing the install id leaves a production consent row nobody can delete.',
      );
    }
  });

  test(`🔴 the store capture records \`${PROMPT_FIELD}\` BEFORE it taps the prompt`, () => {
    const suite = read('store_screenshots_test.dart');
    const answered = suite.indexOf("publishConsent(binding, prompt: 'answered')");
    const tap = suite.indexOf('tap(consentDecline');
    assert.ok(answered >= 0, `${IT}/store_screenshots_test.dart no longer publishes prompt: 'answered'.`);
    assert.ok(tap >= 0, `${IT}/store_screenshots_test.dart no longer taps consentDecline — re-point this test.`);
    assert.ok(
      answered < tap,
      `${IT}/store_screenshots_test.dart publishes prompt: 'answered' AFTER tapping the consent prompt. The tap ` +
        'uploads the row, so a drive that dies between the two would report no row while one exists.',
    );
    assert.ok(
      suite.includes("publishConsent(binding, prompt: 'absent')"),
      `${IT}/store_screenshots_test.dart no longer says prompt: 'absent' when the prompt never came, so "no id" ` +
        'reads the same as a drive that answered and died.',
    );
  });

  test(`the driver prints \`${ANON_ID_TOKEN}\` on the host`, () => {
    const driver = readFileSync(join(REPO, 'apps/subscriptiontracker/test_driver/integration_test.dart'), 'utf8');
    assert.ok(
      driver.includes(ANON_ID_TOKEN),
      `apps/subscriptiontracker/test_driver/integration_test.dart no longer prints \`${ANON_ID_TOKEN}\`. That token is ` +
        'the only copy of the id that survives when the response file was never written, which is exactly ' +
        'the case a red night produces.',
    );
    assert.ok(
      driver.includes('writeResponseOnFailure'),
      'the driver no longer sets writeResponseOnFailure, so a failing suite emits neither channel — and a ' +
        'failing suite is the one that leaves a consent row behind in production.',
    );
  });
});
