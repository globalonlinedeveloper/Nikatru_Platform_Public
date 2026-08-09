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

import { resolveConsentAnonId, ANON_ID_TOKEN, ANON_ID_SHAPE } from '../../e2e/consent_anon_id.mjs';

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

  test(`the E2E writes \`${REPORT_FIELD}\` into reportData`, () => {
    const suite = readFileSync(join(REPO, 'apps/subly/integration_test/app_test.dart'), 'utf8');
    assert.ok(
      suite.includes(`reportData!['${REPORT_FIELD}']`),
      `apps/subly/integration_test/app_test.dart no longer writes \`${REPORT_FIELD}\` into binding.reportData. ` +
        'The nightly would still be green and the consent artifact it uploads would be unfindable.',
    );
  });

  test(`the driver prints \`${ANON_ID_TOKEN}\` on the host`, () => {
    const driver = readFileSync(join(REPO, 'apps/subly/test_driver/integration_test.dart'), 'utf8');
    assert.ok(
      driver.includes(ANON_ID_TOKEN),
      `apps/subly/test_driver/integration_test.dart no longer prints \`${ANON_ID_TOKEN}\`. That token is ` +
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
