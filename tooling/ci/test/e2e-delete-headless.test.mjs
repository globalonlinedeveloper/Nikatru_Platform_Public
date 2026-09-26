// ─────────────────────────────────────────────────────────────────────────────
// e2e-delete-headless.test.mjs — golden-path leg 6 on a captcha-gated stack:
// the in-app leg asserts the refusal, tooling/e2e/delete_headless.mjs does the
// erasure through the ungated /verify, and neither can run where the other
// should.
//
// Measured 2026-09-26 (E2E live #145, run 36220597628): after the switch to
// Box C the delete dialog's reauth was refused `captcha_failed` and nothing
// reached a Worker. The fix splits the leg on E2E_EXPECT_CAPTCHA_GATE. So:
//
//   · the pure half, tooling/e2e/delete_headless_expectation.mjs, is IMPORTED
//     and driven through every verdict, each behind its green control;
//   · the step itself is SPAWNED for every refusal it makes before its first
//     request — the gate off or undecided, the trust answer undecided, a
//     missing credential, no erasure door in the register — so none of them
//     needs a network;
//   · e2e.yml and app_test.dart are read comment-stripped to hold the two
//     halves to the same fact and the step to its place;
//   · MUTATIONS of the helper must break the property each case names.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as real from '../../e2e/delete_headless_expectation.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const STEP = join(REPO, 'tooling', 'e2e', 'delete_headless.mjs');
const HELPER_PATH = join(REPO, 'tooling', 'e2e', 'delete_headless_expectation.mjs');
const HELPER_SOURCE = readFileSync(HELPER_PATH, 'utf8');
const WORKFLOW = stripSourceComments(readFileSync(join(REPO, '.github', 'workflows', 'e2e.yml'), 'utf8'), '.yml');
const SUITE = stripSourceComments(
  readFileSync(join(REPO, 'apps', 'subscriptiontracker', 'integration_test', 'app_test.dart'), 'utf8'),
  '.dart',
);
const REAL_CHANNELS = readFileSync(join(REPO, 'tooling', 'channel-register.json'), 'utf8');

const USER = '9723a3bc-0000-4000-8000-000000000001';
const OTHER = '11111111-0000-4000-8000-000000000002';

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-delete-headless-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A mutated copy of the helper, imported fresh. Its one import is rewritten
 *  to the real file, so the copy is the whole module wherever it sits. */
let copies = 0;
const importMutated = async (source) => {
  const file = join(TMP, `mutated-${++copies}.mjs`);
  const sibling = pathToFileURL(join(REPO, 'tooling', 'e2e', 'auth_target_expectation.mjs')).href;
  writeFileSync(file, source.replace("'./auth_target_expectation.mjs'", `'${sibling}'`));
  return import(pathToFileURL(file).href);
};

// ── the properties, written once and run against the real module AND each mutation

/** The door must be judged by the trust answer: a completed erasure (200) only
 *  with trust, the one-issuer 401 only without it. */
const doorProblems = (m) => {
  const problems = [];
  const want = (trust, status, code) => {
    const v = m.eraseVerdict(trust, { status });
    if (v.code !== code) problems.push(`trust ${trust}, door ${status}: exit ${v.code}, not ${code}`);
  };
  want('yes', 200, 0);
  want('yes', 202, 1);
  want('yes', 401, 1);
  want('yes', 403, 1);
  want('yes', 501, 1);
  want('yes', 502, 1);
  want('no', 401, 0);
  want('no', 200, 1);
  want('no', 202, 1);
  want('yes', 0, 2);
  want('no', 0, 2);
  return problems;
};

/** A session for anyone but the delete-leg user is never sent. */
const mintProblems = (m) => {
  const problems = [];
  const mine = m.mintedVerdict({ status: 200, hasToken: true, sub: USER, userId: USER });
  if (mine.code !== 0) problems.push(`this user's session answered exit ${mine.code}, not 0`);
  const theirs = m.mintedVerdict({ status: 200, hasToken: true, sub: OTHER, userId: USER });
  if (theirs.code !== 1) problems.push(`another user's session answered exit ${theirs.code}, not 1`);
  const none = m.mintedVerdict({ status: 403, hasToken: false, userId: USER });
  if (none.code !== 1) problems.push(`no session answered exit ${none.code}, not 1`);
  const unread = m.mintedVerdict({ status: 200, hasToken: true, sub: undefined, userId: USER });
  if (unread.code !== 2) problems.push(`an unreadable sub answered exit ${unread.code}, not 2`);
  return problems;
};

describe('decideCaptchaGate — the same define the in-app leg branches on, nothing defaulted', () => {
  test('GREEN CONTROL · "yes" and "no" decide themselves', () => {
    assert.deepEqual(real.decideCaptchaGate('yes'), { gate: 'yes', why: null });
    assert.deepEqual(real.decideCaptchaGate('no'), { gate: 'no', why: null });
  });

  test('unset, empty, mis-cased, padded and stack names are all refused', () => {
    const refused = [undefined, null, '', 'Yes', ' yes', 'yes\n', 'true', 'selfhosted', 'hosted'].filter(
      (raw) => real.decideCaptchaGate(raw).gate !== null || !/^could not decide what to expect/.test(real.decideCaptchaGate(raw).why),
    );
    assert.deepEqual(refused, []);
  });
});

describe('platformOrigin — the erasure door comes from the channel register', () => {
  test('POSITIVE CONTROL · the REAL register names the platform Worker the app compiles in', () => {
    assert.deepEqual(real.platformOrigin(REAL_CHANNELS), { origin: 'https://platform.nikatru.com', why: null });
  });

  test('a register with no platform row, two of them, a path, or plain http is refused', () => {
    const reg = (...urls) => JSON.stringify({ serviceEnvironments: urls.map((url) => ({ id: 'platform', url })) });
    for (const text of ['not json', '{}', reg(), reg('https://a.test', 'https://b.test'), reg('https://a.test/v1'), reg('http://a.test')]) {
      const r = real.platformOrigin(text);
      assert.equal(r.origin, null, text);
      assert.match(r.why, /^COULD NOT LOOK: .*nothing was sent\.$/, text);
    }
  });
});

describe('presentVerdict — before anything is sent, the account is still there', () => {
  test('GREEN CONTROL · the identity resolving as this user is present', () => {
    assert.equal(real.presentVerdict({ status: 200, ok: true, bodyId: USER, userId: USER }).code, 0);
  });

  test('already gone is a finding: something deleted past the refused reauth', () => {
    const v = real.presentVerdict({ status: 404, ok: false, userId: USER });
    assert.equal(v.code, 1);
    assert.match(v.error.join('\n'), /already GONE .* DELETE \/v1\/account is not sent\./);
  });

  test('a 2xx naming another user, or any other status, could not look', () => {
    assert.equal(real.presentVerdict({ status: 200, ok: true, bodyId: OTHER, userId: USER }).code, 2);
    assert.equal(real.presentVerdict({ status: 401, ok: false, userId: USER }).code, 2);
  });
});

describe('rowsBeforeVerdict — the row the leg wrote, graded by trust', () => {
  test('GREEN CONTROL · trust yes: a row passes; trust no: zero passes', () => {
    assert.equal(real.rowsBeforeVerdict('yes', 1).code, 0);
    assert.equal(real.rowsBeforeVerdict('no', 0).code, 0);
  });

  test('trust yes with no row, and trust no with one, are findings', () => {
    assert.equal(real.rowsBeforeVerdict('yes', 0).code, 1);
    assert.match(real.rowsBeforeVerdict('no', 1).error.join('\n'), /security finding/);
  });

  test('an unread count is never a number, and an undecided trust answer is refused', () => {
    for (const raw of [undefined, null, 'abc', -1, 1.5]) assert.equal(real.rowsBeforeVerdict('yes', raw).code, 2);
    assert.equal(real.rowsBeforeVerdict(null, 1).code, 2);
  });
});

describe('mintedVerdict — only the delete-leg user\'s own session is ever sent', () => {
  test('GREEN CONTROL · every mint shape answers as it must', () => {
    assert.deepEqual(mintProblems(real), []);
  });
});

describe('eraseVerdict — the door\'s answer, graded by trust', () => {
  test('GREEN CONTROL · 200 only with trust, 401 only without, no answer could not look', () => {
    assert.deepEqual(doorProblems(real), []);
  });

  test('a refusal names what the door said', () => {
    assert.match(real.eraseVerdict('yes', { status: 501, error: 'account_deletion_unconfigured' }).error[0], /answered 501 \(account_deletion_unconfigured\)/);
  });
});

describe('after the request — identity and rows, graded by trust', () => {
  test('GREEN CONTROL · trust yes: gone and empty; trust no: untouched and empty', () => {
    assert.equal(real.identityAfterVerdict('yes', { status: 404, ok: false, userId: USER }).code, 0);
    assert.equal(real.identityAfterVerdict('no', { status: 200, ok: true, bodyId: USER, userId: USER }).code, 0);
    assert.equal(real.rowsAfterVerdict('yes', 0).code, 0);
    assert.equal(real.rowsAfterVerdict('no', 0).code, 0);
  });

  test('the opposite reading under each trust answer is a finding', () => {
    assert.equal(real.identityAfterVerdict('yes', { status: 200, ok: true, bodyId: USER, userId: USER }).code, 1);
    assert.equal(real.identityAfterVerdict('no', { status: 404, ok: false, userId: USER }).code, 1);
    assert.equal(real.rowsAfterVerdict('yes', 1).code, 1);
    assert.equal(real.rowsAfterVerdict('no', 1).code, 1);
  });

  test('an unreadable read could not look, and an undecided trust answer is refused', () => {
    assert.equal(real.identityAfterVerdict('yes', { status: 500, ok: false, userId: USER }).code, 2);
    assert.equal(real.identityAfterVerdict('no', { status: 200, ok: true, bodyId: OTHER, userId: USER }).code, 2);
    assert.equal(real.identityAfterVerdict(undefined, { status: 404, ok: false, userId: USER }).code, 2);
    assert.equal(real.rowsAfterVerdict('yes', undefined).code, 2);
  });
});

// ── delete_headless.mjs, spawned: every refusal before the first request ────

const FULL_ENV = Object.freeze({
  E2E_EXPECT_CAPTCHA_GATE: 'yes',
  E2E_WORKERS_TRUST: 'yes',
  SUPABASE_URL: 'https://auth.fixture.invalid',
  SUPABASE_ANON_KEY: 'fixture-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  E2E_DELETE_EMAIL: 'fixture@nikatru.invalid',
  E2E_DELETE_USER_ID: USER,
  CLOUDFLARE_ACCOUNT_ID: 'fixture-account',
  CLOUDFLARE_API_TOKEN: 'fixture-token',
  SUBSCRIPTIONTRACKER_D1_DATABASE_ID: 'fixture-db',
});

/** Runs the step with exactly `vars` from the fixture set (plus PATH). */
function step(vars, args = []) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot };
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) env[k] = v;
  const r = spawnSync(process.execPath, [STEP, ...args], { cwd: REPO, env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('delete_headless.mjs — refuses before it sends anything', () => {
  test('an undecided captcha gate is exit 2, "could not decide"', () => {
    const r = step({ ...FULL_ENV, E2E_EXPECT_CAPTCHA_GATE: undefined });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /could not decide what to expect: E2E_EXPECT_CAPTCHA_GATE is unset/);
  });

  test('the gate OFF is exit 2: the in-app leg deletes there, and a second deleter would hide it', () => {
    const r = step({ ...FULL_ENV, E2E_EXPECT_CAPTCHA_GATE: 'no' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /^REFUSED: E2E_EXPECT_CAPTCHA_GATE=no\./m);
    assert.doesNotMatch(r.out, /DELETE https?:/);
  });

  test('an undecided trust answer is exit 2', () => {
    const r = step({ ...FULL_ENV, E2E_WORKERS_TRUST: 'hosted' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /could not decide what to expect: E2E_WORKERS_TRUST is "hosted"/);
  });

  test('a missing credential is exit 2 and names it', () => {
    const r = step({ ...FULL_ENV, E2E_DELETE_USER_ID: undefined });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /missing required env var E2E_DELETE_USER_ID/);
  });

  test('a register with no erasure door is exit 2, nothing sent', () => {
    const file = join(TMP, 'no-platform.json');
    writeFileSync(file, JSON.stringify({ serviceEnvironments: [] }));
    const r = step(FULL_ENV, ['--register', file]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /declares 0 serviceEnvironments with id "platform"/);
    assert.doesNotMatch(r.out, /DELETE https?:/);
  });
});

// ── the two halves and the workflow, read comment-stripped ──────────────────

describe('wiring — one fact splits the leg, and the step sits where it must', () => {
  test('e2e.yml runs the step gated on E2E_EXPECT_CAPTCHA_GATE, after the facts and the drive, before verify_purged', () => {
    const derived = WORKFLOW.indexOf('run: node tooling/e2e/derive_expectation.mjs');
    const drive = WORKFLOW.indexOf('integration_test/app_test.dart');
    const run = WORKFLOW.indexOf('run: node tooling/e2e/delete_headless.mjs');
    const purged = WORKFLOW.indexOf('run: node tooling/e2e/verify_purged.mjs');
    assert.ok(derived !== -1 && drive > derived, 'the facts are not derived before the drive');
    assert.ok(run > drive, 'delete_headless.mjs does not run after the drive (or not at all)');
    assert.ok(purged > run, 'verify_purged.mjs does not audit AFTER the headless erasure');
    const stepText = WORKFLOW.slice(WORKFLOW.lastIndexOf('- name:', run), run);
    assert.match(stepText, /\n\s*if:\s*env\.E2E_EXPECT_CAPTCHA_GATE\s*==\s*'yes'\s*\n/, 'the step is not gated on the captcha fact');
    assert.match(stepText, /E2E_DELETE_USER_ID:\s*\$\{\{\s*steps\.delete_user\.outputs\.user_id\s*\}\}/, 'the step is not handed the DELETE-leg user');
  });

  test('the in-app leg branches on the same define, asserts reauthFailed, and returns before the notice wait', () => {
    const gate = SUITE.indexOf('if (captchaGateOn) {', SUITE.indexOf('E2EKeys.deleteAccountConfirm'));
    const notice = SUITE.search(/find\.byKey\(E2EKeys\.accountDeletionNotice\),\s*timeout:/);
    assert.ok(gate !== -1, 'the delete leg has no captchaGateOn branch after its confirm tap');
    assert.ok(notice > gate, 'the captcha branch does not come before the 40s wait for the login-screen notice');
    const branch = SUITE.slice(gate, notice);
    assert.match(branch, /l10n\.deleteAccountResultNotDeleted/);
    assert.match(branch, /core\.AccountDeletionOutcome\.reauthFailed\.plainMessage/);
    assert.match(branch, /currentSession,\s*isNotNull/);
    assert.match(branch, /\breturn;\s*\}/);
    assert.match(SUITE, /const bool captchaGateOn = expectCaptchaGate == 'yes';/);
    assert.match(SUITE, /String\.fromEnvironment\(\s*'E2E_EXPECT_CAPTCHA_GATE',?\s*\)/);
  });
});

// ── red controls, kept as cases so they stay red ────────────────────────────

describe('red controls — each mutation of the helper must break the property it guards', () => {
  test('MUTATION 1 · a 202 graded as a completed erasure breaks the door property', async () => {
    const mutated = HELPER_SOURCE.replace('    if (status === 200) {\n      return {\n        code: 0,', '    if (status === 200 || status === 202) {\n      return {\n        code: 0,');
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = doorProblems(await importMutated(mutated));
    assert.ok(problems.includes('trust yes, door 202: exit 0, not 1'), problems.join('; '));
  });

  test('MUTATION 2 · the refused branch graded like the trusted one breaks the door property', async () => {
    const mutated = HELPER_SOURCE.replace("  if (status === 401) {\n    return {\n      code: 0,", "  if (status === 200) {\n    return {\n      code: 0,");
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = doorProblems(await importMutated(mutated));
    assert.ok(problems.includes('trust no, door 401: exit 1, not 0'), problems.join('; '));
    assert.ok(problems.includes('trust no, door 200: exit 0, not 1'), problems.join('; '));
  });

  test("MUTATION 3 · dropping the subject check sends another user's session", async () => {
    const start = HELPER_SOURCE.indexOf('  if (sub !== userId) {');
    const end = HELPER_SOURCE.indexOf('  return {\n    code: 0,\n    log: [`MINTED:', start);
    assert.ok(start !== -1 && end > start, 'the subject check was not found');
    const mutated = HELPER_SOURCE.slice(0, start) + HELPER_SOURCE.slice(end);
    const problems = mintProblems(await importMutated(mutated));
    assert.ok(problems.includes("another user's session answered exit 0, not 1"), problems.join('; '));
  });
});
