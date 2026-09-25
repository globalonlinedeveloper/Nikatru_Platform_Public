// ─────────────────────────────────────────────────────────────────────────────
// e2e-verify-target.test.mjs — the live E2E run derives what it expects from
// FACTS, the three server-side verifiers grade on the trust fact, and none of
// them refuses to say so or guesses.
//
// `tooling/e2e/verify_row.mjs`, `verify_purged.mjs` and `verify_consent.mjs`
// each carry a NO_NEGATIVE_TEST_NEEDED entry in assert-guard-coverage.mjs: their
// subject is a live D1 row or a live GoTrue identity, and a fixture cannot stand
// in for either. That stays true. What IS fixture-testable is the half split out
// of them on 2026-09-22 — `tooling/e2e/auth_target_expectation.mjs`, which turns
// (trust, what was read) into an exit code and the lines that explain it, and
// since 2026-09-25 also derives the two facts from (SUPABASE_URL, register). So:
//
//   · the helper is IMPORTED and driven through every branch,
//   · tooling/e2e/derive_expectation.mjs, the step that writes the facts, is
//     SPAWNED against fixture registers, and
//   · each verifier's comment-stripped source is read — never run — to prove it
//     decides the trust fact through the helper, before its first request, and
//     exits 2 when it is undecided.
//
// 🔴 WHAT IS BEING PROTECTED. The two trust answers expect OPPOSITE outcomes from
// the same read (a subscription row: a pass with trust, a security finding
// without it; a deleted identity: the same, reversed). And the Phase 5 cutover
// moves the secrets (C6) before the register (C7), so the trust fact must come
// from the REGISTER, never from the stack or the target name. Each regression
// below has a MUTATION case that must go red:
//   1. TRUST hard-coded to `yes` (a Box C run before the switch reads trusted),
//   2. TRUST derived from the stack — what the old target NAME encoded — instead
//      of the register (the post-switch production run reads refused),
//   3. the refused branch grading like the trusted one,
//   4. an unset or unknown fact falling through to a default,
//   5. the refused branch deleted from verify_row's verdict.
// Each is preceded by the green control it breaks, because a case that fails for
// the wrong reason is not a case at all.
//
// 🔴 TRUST=yes IS PINNED BYTE FOR BYTE. Those strings are the ones the verifiers
// printed for `hosted` before the split, copied out of origin/main 0e6ce4fe. A
// trusted verdict that changes by a character is a change to what the nightly
// has always said, and it must be made here on purpose.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as real from '../../e2e/auth_target_expectation.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HELPER_SOURCE = readFileSync(join(REPO, 'tooling', 'e2e', 'auth_target_expectation.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(REPO, '.github', 'workflows', 'e2e.yml'), 'utf8');
const REAL_REGISTER = readFileSync(join(REPO, 'tooling', 'platform-register.json'), 'utf8');
const DERIVE = join(REPO, 'tooling', 'e2e', 'derive_expectation.mjs');

const USER = '9723a3bc-0000-4000-8000-000000000001';
const OTHER = '11111111-0000-4000-8000-000000000002';
const UNDECIDED = [undefined, null, '', 'Yes', 'YES', ' yes', 'yes\n', 'true', 'hosted', 'boxa', 'production'];

/** A hosted project origin and Box C's, as fixtures. Neither is read live. */
const HOSTED = 'https://fixtureproject.supabase.co';
const BOXC = 'https://auth-api.nikatru.com';

/** A register whose sharedValues carry exactly the entries given. */
const registerWith = (...values) =>
  JSON.stringify({ sharedValues: { values: values.map((value) => ({ at: 'vars.SUPABASE_URL', value })) } });

let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'nikatru-verify-target-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

/** A mutated copy of the helper, imported fresh. It has no imports of its own,
 *  so a copy anywhere on disk is the whole module. */
let copies = 0;
const importMutated = async (source) => {
  const file = join(TMP, `mutated-${++copies}.mjs`);
  writeFileSync(file, source);
  return import(pathToFileURL(file).href);
};

// ── the properties, written once and run against the real module AND each mutation

/** The three rows of the cutover, each graded against what it must derive. */
const derivationProblems = (m) => {
  const problems = [];
  const want = (url, register, stack, trust, row) => {
    const d = m.deriveExpectation(url, register);
    if (d.stack !== stack || d.trust !== trust) {
      problems.push(`${row}: derived stack=${d.stack} trust=${d.trust}, not stack=${stack} trust=${trust}`);
    }
  };
  want(HOSTED, registerWith(HOSTED), 'hosted', 'yes', 'hosted URL + hosted register');
  want(BOXC, registerWith(HOSTED), 'selfhosted', 'no', 'Box C URL + hosted register');
  want(BOXC, registerWith(BOXC), 'selfhosted', 'yes', 'Box C URL + Box C register');
  return problems;
};

/** The refused row expectation: exactly 0 passes, a row is a finding, an unread
 *  count is "could not look" and never a pass. */
const refusedRowProblems = (m) => {
  const problems = [];
  const zero = m.rowVerdict('no', 0);
  if (zero.code !== 0) problems.push(`trust no with 0 rows answered exit ${zero.code}, not 0`);
  const one = m.rowVerdict('no', 1);
  if (one.code !== 1) problems.push(`trust no with 1 row answered exit ${one.code}, not 1`);
  else if (!/ACCEPTED a token from an issuer it does not trust/.test(one.error.join('\n'))) problems.push('trust no with 1 row does not name the two-issuer finding');
  for (const raw of [undefined, null, 'abc', -1, 1.5, '']) {
    const v = m.rowVerdict('no', raw);
    if (v.code !== 2) problems.push(`trust no with an unread count ${JSON.stringify(raw)} answered exit ${v.code}, not 2`);
  }
  return problems;
};

/** An undecided trust answer is refused everywhere, and never becomes a default. */
const undecidedProblems = (m) => {
  const problems = [];
  for (const raw of UNDECIDED) {
    const d = m.decideTrust(raw);
    if (d.trust !== null) problems.push(`E2E_WORKERS_TRUST=${JSON.stringify(raw)} was decided as ${JSON.stringify(d.trust)}`);
    else if (!/^could not decide what to expect/.test(d.why ?? '')) problems.push(`E2E_WORKERS_TRUST=${JSON.stringify(raw)} was refused without saying why`);
  }
  for (const trust of [null, undefined, 'hosted']) {
    const verdicts = {
      rowVerdict: m.rowVerdict(trust, 1),
      identityVerdict: m.identityVerdict(trust, { status: 404, ok: false, userId: USER }),
      rowsVerdict: m.rowsVerdict(trust, 'subscriptions', 0),
      purgedSummary: m.purgedSummary(trust, { survived: false, blind: false }),
    };
    for (const [fn, v] of Object.entries(verdicts)) {
      if (v.code !== 2) problems.push(`${fn}(${JSON.stringify(trust)}) answered exit ${v.code}, not 2`);
      else if (!/^could not decide what to expect/.test(v.error[0] ?? '')) problems.push(`${fn}(${JSON.stringify(trust)}) did not say "could not decide what to expect"`);
    }
  }
  return problems;
};

describe('deriveExpectation — the two facts come from the URL and the register, never from a name', () => {
  test('GREEN CONTROL · hosted URL + hosted register: stack hosted, trust yes (production today)', () => {
    assert.deepEqual(real.deriveExpectation(HOSTED, registerWith(HOSTED)), { stack: 'hosted', trust: 'yes', why: null });
  });

  test('Box C URL + hosted register: stack selfhosted, trust no (a selfhosted run, or production after C6 and before C7)', () => {
    assert.deepEqual(real.deriveExpectation(BOXC, registerWith(HOSTED)), { stack: 'selfhosted', trust: 'no', why: null });
  });

  test('Box C URL + Box C register: stack selfhosted, trust yes (production after the switch commit)', () => {
    assert.deepEqual(real.deriveExpectation(BOXC, registerWith(BOXC)), { stack: 'selfhosted', trust: 'yes', why: null });
  });

  test('hosted URL + Box C register: stack hosted, trust no (the switch merged before the secrets rotated)', () => {
    assert.deepEqual(real.deriveExpectation(HOSTED, registerWith(BOXC)), { stack: 'hosted', trust: 'no', why: null });
  });

  test('the comparison is by origin: a trailing slash on the secret is the same issuer', () => {
    assert.deepEqual(real.deriveExpectation(`${BOXC}/`, registerWith(BOXC)), { stack: 'selfhosted', trust: 'yes', why: null });
  });

  test('POSITIVE CONTROL · the REAL register trusts its own vars.SUPABASE_URL', () => {
    const { url } = real.registeredSupabaseUrl(REAL_REGISTER);
    assert.ok(url, 'the real register records no single vars.SUPABASE_URL');
    assert.equal(real.deriveExpectation(url, REAL_REGISTER).trust, 'yes');
  });

  test('an unset URL, an unreadable register, and a register with zero or two entries are all refused', () => {
    for (const [url, register] of [
      [undefined, registerWith(HOSTED)],
      ['', registerWith(HOSTED)],
      ['not a url', registerWith(HOSTED)],
      [BOXC, 'not json'],
      [BOXC, registerWith()],
      [BOXC, registerWith(HOSTED, BOXC)],
      [BOXC, registerWith('not a url')],
    ]) {
      const d = real.deriveExpectation(url, register);
      assert.equal(d.stack, null, JSON.stringify([url, register]));
      assert.equal(d.trust, null, JSON.stringify([url, register]));
      assert.match(d.why, /^could not decide what to expect: /);
    }
  });

  test('a refusal never carries the URL it was handed', () => {
    const d = real.deriveExpectation(BOXC, registerWith());
    assert.ok(!d.why.includes(BOXC), d.why);
  });
});

describe('decideTrust and decideStack — exactly the declared values, nothing defaulted', () => {
  test('GREEN CONTROL · "yes" and "no", "hosted" and "selfhosted" decide themselves', () => {
    assert.deepEqual(real.decideTrust('yes'), { trust: 'yes', why: null });
    assert.deepEqual(real.decideTrust('no'), { trust: 'no', why: null });
    assert.deepEqual(real.decideStack('hosted'), { stack: 'hosted', why: null });
    assert.deepEqual(real.decideStack('selfhosted'), { stack: 'selfhosted', why: null });
  });

  test('unset, empty, mis-cased, padded, and retired target names are all refused, and never become a default', () => {
    assert.deepEqual(undecidedProblems(real), []);
  });

  test('an unset or unknown stack is refused, including the retired names', () => {
    for (const raw of [undefined, '', 'Hosted', 'boxa', 'production']) {
      const d = real.decideStack(raw);
      assert.equal(d.stack, null, JSON.stringify(raw));
      assert.match(d.why, /^could not decide what to expect: E2E_STACK is /);
    }
  });

  test('the refusal names the value it was given, so a log says what arrived', () => {
    assert.match(real.decideTrust(undefined).why, /E2E_WORKERS_TRUST is unset/);
    assert.match(real.decideTrust('').why, /E2E_WORKERS_TRUST is unset/);
    assert.match(real.decideTrust('hosted').why, /E2E_WORKERS_TRUST is "hosted"/);
    assert.match(real.decideStack('boxa').why, /E2E_STACK is "boxa"/);
  });

  test("AUTH_TARGETS is e2e.yml's `auth_target` choice list, in order", () => {
    const lines = WORKFLOW.split(/\r?\n/);
    const at = lines.findIndex((l) => /^\s+auth_target:\s*$/.test(l));
    assert.ok(at > 0, 'e2e.yml declares no auth_target input');
    const opt = lines.findIndex((l, i) => i > at && /^\s+options:\s*$/.test(l));
    assert.ok(opt > at && opt - at < 12, 'auth_target declares no options list');
    const options = [];
    for (let i = opt + 1; i < lines.length; i++) {
      const m = /^\s+-\s+(\S+)\s*$/.exec(lines[i]);
      if (!m) break;
      options.push(m[1]);
    }
    assert.deepEqual(options, [...real.AUTH_TARGETS]);
  });
});

describe('rowVerdict — verify_row.mjs', () => {
  test('trust yes, byte for byte: a row passes, none fails', () => {
    assert.deepEqual(real.rowVerdict('yes', 1), { code: 0, log: ['PASS: subscription row confirmed in live D1.'], error: [] });
    assert.deepEqual(real.rowVerdict('yes', '3'), { code: 0, log: ['PASS: subscription row confirmed in live D1.'], error: [] });
    assert.deepEqual(real.rowVerdict('yes', 0), { code: 1, log: [], error: ['FAIL: expected >= 1 subscription row created by the E2E run.'] });
  });

  test("trust yes keeps its old `?? 0`: a missing count reads as 0 and fails, exactly as before", () => {
    assert.equal(real.rowVerdict('yes', undefined).code, 1);
    assert.equal(real.rowVerdict('yes', null).code, 1);
  });

  test('GREEN CONTROL · trust no: exactly 0 passes, a row is the two-issuer finding, an unread count is exit 2', () => {
    assert.deepEqual(refusedRowProblems(real), []);
  });

  test('the two trust answers grade the same read in opposite directions', () => {
    assert.equal(real.rowVerdict('yes', 0).code, 1);
    assert.equal(real.rowVerdict('no', 0).code, 0);
    assert.equal(real.rowVerdict('yes', 1).code, 0);
    assert.equal(real.rowVerdict('no', 1).code, 1);
  });
});

describe('identityVerdict — verify_purged.mjs limb A', () => {
  test('trust yes, byte for byte: 404 passes, a resolving identity fails, anything else could not look', () => {
    assert.deepEqual(real.identityVerdict('yes', { status: 404, ok: false, userId: USER }), {
      code: 0,
      log: ['PASS: the identity record is gone (GoTrue admin read → 404).'],
      error: [],
    });
    assert.deepEqual(real.identityVerdict('yes', { status: 200, ok: true, bodyId: USER, userId: USER }), {
      code: 1,
      log: [],
      error: [
        `FAIL: the auth user ${USER} STILL RESOLVES (HTTP 200) after the in-app deletion reported success. ` +
          'The same email and password can still sign in — this is the exact "your data is gone and your ' +
          'login is not" outcome the platform route reports as 502, and the app told the user their account ' +
          'was deleted.',
      ],
    });
    assert.deepEqual(real.identityVerdict('yes', { status: 401, ok: false, userId: USER }), {
      code: 2,
      log: [],
      error: [
        'COULD NOT LOOK: the GoTrue admin read answered HTTP 401, which is neither 404 (gone) nor 2xx ' +
          '(still there). Check SUPABASE_SERVICE_ROLE_KEY before reading this as a deletion failure.',
      ],
    });
  });

  test('GREEN CONTROL · trust no: the identity still resolving AS THIS USER is the pass', () => {
    const v = real.identityVerdict('no', { status: 200, ok: true, bodyId: USER, userId: USER });
    assert.equal(v.code, 0);
    assert.match(v.log[0], /^PASS: the identity .* still resolves/);
  });

  test('trust no: the identity GONE is a finding (exit 1), not the trusted pass', () => {
    const v = real.identityVerdict('no', { status: 404, ok: false, userId: USER });
    assert.equal(v.code, 1);
    assert.match(v.error[0], /is GONE/);
  });

  test("trust no: a 2xx that does not name this user, and any other status, could not look (exit 2)", () => {
    assert.equal(real.identityVerdict('no', { status: 200, ok: true, bodyId: OTHER, userId: USER }).code, 2);
    assert.equal(real.identityVerdict('no', { status: 200, ok: true, bodyId: undefined, userId: USER }).code, 2);
    for (const status of [401, 403, 500, 502]) {
      assert.equal(real.identityVerdict('no', { status, ok: false, userId: USER }).code, 2, `HTTP ${status}`);
    }
  });
});

describe('rowsVerdict — verify_purged.mjs limb B', () => {
  test('trust yes, byte for byte, including a missing count reading as 0', () => {
    assert.deepEqual(real.rowsVerdict('yes', 'budgets', 0), { code: 0, log: ['ok  budgets: 0 row(s)'], error: [] });
    assert.deepEqual(real.rowsVerdict('yes', 'budgets', undefined), { code: 0, log: ['ok  budgets: 0 row(s)'], error: [] });
    assert.deepEqual(real.rowsVerdict('yes', 'budgets', 2), {
      code: 1,
      log: [],
      error: ['FAIL: budgets still holds 2 row(s) for the deleted user. The in-app deletion reported success and this data survived it.'],
    });
  });

  test('GREEN CONTROL · trust no: 0 rows passes', () => {
    assert.deepEqual(real.rowsVerdict('no', 'budgets', 0), { code: 0, log: ['ok  budgets: 0 row(s)'], error: [] });
  });

  test('trust no: a row is the two-issuer finding, and an unread count is never 0', () => {
    const one = real.rowsVerdict('no', 'subscriptions', 1);
    assert.equal(one.code, 1);
    assert.match(one.error[0], /ACCEPTED a token from an issuer it does not trust/);
    for (const raw of [undefined, 'x', -3]) assert.equal(real.rowsVerdict('no', 'subscriptions', raw).code, 2, JSON.stringify(raw));
  });
});

describe('purgedSummary — verify_purged.mjs closing lines', () => {
  test('trust yes, byte for byte', () => {
    assert.deepEqual(real.purgedSummary('yes', { survived: false, blind: false }), {
      code: 0,
      log: [
        'PASS: the in-app account deletion really erased this user — the identity is unresolvable and every ' +
          'user-owned table in subscriptiontracker_db is empty for it. [pipeline N-6 leg 6]',
      ],
      error: [],
    });
    assert.deepEqual(real.purgedSummary('yes', { survived: true, blind: true }), {
      code: 1,
      log: [],
      error: [
        "The golden path's delete leg is BROKEN against production: the app told a user their account was " +
          'deleted, and the stores disagree.',
        '  (Another limb of this audit also could not be read, so the damage above may be the smaller half of it.)',
      ],
    });
    assert.deepEqual(real.purgedSummary('yes', { survived: false, blind: true }), {
      code: 2,
      log: [],
      error: [
        'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the deletion worked. ' +
          'Exit 2 is deliberately not 1: fix the access, then re-run.',
      ],
    });
  });

  test('trust no: its own pass line, and 1 beats 2 exactly as with trust', () => {
    const pass = real.purgedSummary('no', { survived: false, blind: false });
    assert.equal(pass.code, 0);
    assert.match(pass.log[0], /^PASS: the refused delete leg left its user/);
    assert.equal(real.purgedSummary('no', { survived: true, blind: true }).code, 1);
    assert.equal(real.purgedSummary('no', { survived: true, blind: true }).error.length, 2);
    assert.equal(real.purgedSummary('no', { survived: false, blind: true }).code, 2);
  });
});

describe('expectationLine — what each verifier says it is looking for', () => {
  test('every verifier has a line for each trust answer, and the refused one never reads like the trusted one', () => {
    for (const verifier of ['verify_row', 'verify_purged', 'verify_consent']) {
      const lines = real.TRUST.map((t) => real.expectationLine(verifier, t));
      for (const [i, t] of real.TRUST.entries()) assert.match(lines[i], new RegExp(`^Workers trust this run's issuer: ${t} — expecting `));
      assert.notEqual(lines[0].replace(/^[^—]*/, ''), lines[1].replace(/^[^—]*/, ''), verifier);
    }
  });

  test('verify_consent without trust expects the SAME artifact, and says why', () => {
    assert.match(real.expectationLine('verify_consent', 'no'), /the SAME artifact as when the Workers trust the issuer: the consent route is unauthenticated/);
  });

  test('an undecided answer gets the refusal, and an unknown verifier is a programming error', () => {
    assert.match(real.expectationLine('verify_row', 'hosted'), /^could not decide what to expect/);
    assert.throws(() => real.expectationLine('verify_nothing', 'yes'), /no expectation is written/);
  });
});

describe('say — prints a verdict and hands back its code', () => {
  test('log lines to stdout, error lines to stderr, the code returned unchanged', () => {
    const out = [];
    const err = [];
    const { log, error } = console;
    console.log = (l) => out.push(l);
    console.error = (l) => err.push(l);
    try {
      assert.equal(real.say({ code: 1, log: ['a'], error: ['b', 'c'] }), 1);
    } finally {
      console.log = log;
      console.error = error;
    }
    assert.deepEqual(out, ['a']);
    assert.deepEqual(err, ['b', 'c']);
  });
});

// ── derive_expectation.mjs, spawned: the step that writes the facts ─────────

/** Runs the derivation step with a fixture register and a fresh GITHUB_ENV. */
let runs = 0;
function derive(url, register) {
  const dir = join(TMP, `derive-${++runs}`);
  const envFile = `${dir}.env`;
  const registerFile = `${dir}.register.json`;
  writeFileSync(registerFile, register);
  const env = { ...process.env, GITHUB_ENV: envFile, GITHUB_STEP_SUMMARY: '' };
  delete env.SUPABASE_URL;
  if (url !== undefined) env.SUPABASE_URL = url;
  const r = spawnSync(process.execPath, [DERIVE, '--register', registerFile], { cwd: REPO, env, encoding: 'utf8' });
  const written = existsSync(envFile) ? readFileSync(envFile, 'utf8') : null;
  return { code: r.status, out: `${r.stdout}${r.stderr}`, written };
}

describe('derive_expectation.mjs — writes the two facts, prints no URL, and refuses to guess', () => {
  test('GREEN CONTROL · Box C URL + Box C register writes selfhosted / yes / captcha gate yes', () => {
    const r = derive(BOXC, registerWith(BOXC));
    assert.equal(r.code, 0, r.out);
    assert.equal(r.written, 'E2E_STACK=selfhosted\nE2E_WORKERS_TRUST=yes\nE2E_EXPECT_CAPTCHA_GATE=yes\n');
  });

  test('hosted URL + hosted register writes hosted / yes / captcha gate no', () => {
    const r = derive(HOSTED, registerWith(HOSTED));
    assert.equal(r.code, 0, r.out);
    assert.equal(r.written, 'E2E_STACK=hosted\nE2E_WORKERS_TRUST=yes\nE2E_EXPECT_CAPTCHA_GATE=no\n');
  });

  test('Box C URL + hosted register writes selfhosted / no', () => {
    const r = derive(BOXC, registerWith(HOSTED));
    assert.equal(r.code, 0, r.out);
    assert.equal(r.written, 'E2E_STACK=selfhosted\nE2E_WORKERS_TRUST=no\nE2E_EXPECT_CAPTCHA_GATE=yes\n');
  });

  test('the URL never reaches the log, only the words', () => {
    const r = derive(BOXC, registerWith(HOSTED));
    assert.ok(!r.out.includes(BOXC), r.out);
    assert.ok(!r.out.includes(HOSTED), r.out);
    assert.match(r.out, /^E2E_STACK=selfhosted$/m);
    assert.match(r.out, /^E2E_WORKERS_TRUST=no$/m);
  });

  test('an unset SUPABASE_URL is exit 2 and writes nothing', () => {
    const r = derive(undefined, registerWith(HOSTED));
    assert.equal(r.code, 2, r.out);
    assert.equal(r.written, null);
    assert.match(r.out, /could not decide what to expect/);
  });

  test('a register with no single vars.SUPABASE_URL is exit 2 and writes nothing', () => {
    const r = derive(BOXC, registerWith(HOSTED, BOXC));
    assert.equal(r.code, 2, r.out);
    assert.equal(r.written, null);
  });
});

// ── the verifiers' wiring, read comment-stripped and never run ──────────────
// Running them would need a live D1 and a live GoTrue (their NO_NEGATIVE_TEST_
// NEEDED entries say why). What CAN be proved from the source is that each one
// hands its trust answer to the helper, decides it before its first request,
// exits 2 on an undecided one, and grades with the helper rather than its own literal.

const VERIFIERS = [
  { name: 'verify_row', calls: [/process\.exitCode\s*=\s*say\(\s*rowVerdict\(\s*auth\.trust\s*,/] },
  {
    name: 'verify_purged',
    calls: [
      /worse\(\s*say\(\s*identityVerdict\(\s*auth\.trust\s*,/,
      /worse\(\s*say\(\s*rowsVerdict\(\s*auth\.trust\s*,/,
      /say\(\s*purgedSummary\(\s*auth\.trust\s*,/,
    ],
  },
  { name: 'verify_consent', calls: [] },
];

const DECIDE =
  /const\s+auth\s*=\s*decideTrust\(\s*process\.env\.E2E_WORKERS_TRUST\s*\)\s*;\s*if\s*\(\s*!auth\.trust\s*\)\s*\{\s*console\.error\([^;]*\bauth\.why\b[^;]*\)\s*;\s*process\.exit\(\s*2\s*\)\s*;/;

/** Every way a verifier's code can fail to be trust-aware. [] = wired. */
const wiringProblems = (name, source) => {
  const code = stripSourceComments(source, '.mjs');
  const problems = [];
  if (!/from\s+['"]\.\/auth_target_expectation\.mjs['"]/.test(code)) problems.push('does not import ./auth_target_expectation.mjs');
  const decide = DECIDE.exec(code);
  if (!decide) problems.push('does not decide E2E_WORKERS_TRUST through decideTrust and exit 2 when it is undecided');
  const firstAwait = code.search(/\bawait\b/);
  if (decide && firstAwait !== -1 && decide.index > firstAwait) problems.push('decides the trust answer AFTER its first request');
  if (!new RegExp(`expectationLine\\(\\s*'${name}'\\s*,\\s*auth\\.trust\\s*\\)`).test(code)) problems.push(`does not print expectationLine('${name}', auth.trust)`);
  for (const re of VERIFIERS.find((v) => v.name === name).calls) if (!re.test(code)) problems.push(`does not grade through ${re.source}`);
  if (/E2E_WORKERS_TRUST\s*(\|\||\?\?)/.test(code)) problems.push('defaults E2E_WORKERS_TRUST itself');
  if (/E2E_AUTH_TARGET/.test(code)) problems.push('reads the target NAME');
  if (/['"`](yes|no|hosted|selfhosted|boxa|production)['"`]/.test(code)) problems.push('names a fact literally instead of leaving it to the helper');
  return problems;
};

const verifierSource = (name) => readFileSync(join(REPO, 'tooling', 'e2e', `${name}.mjs`), 'utf8');

describe('each verifier is wired to the helper, before its first request', () => {
  // One `test(` per verifier, never a loop: assert-no-loop-cases.mjs counts a
  // looped case as ONE declaration, so a verifier dropped from a list would
  // take its case with it where the coverage ratchet cannot see.
  test('GREEN CONTROL · verify_row.mjs decides, refuses an undecided answer with exit 2, and grades through the helper', () => {
    assert.deepEqual(wiringProblems('verify_row', verifierSource('verify_row')), []);
  });

  test('GREEN CONTROL · verify_purged.mjs decides, refuses an undecided answer with exit 2, and grades through the helper', () => {
    assert.deepEqual(wiringProblems('verify_purged', verifierSource('verify_purged')), []);
  });

  test('GREEN CONTROL · verify_consent.mjs decides, refuses an undecided answer with exit 2, and grades through the helper', () => {
    assert.deepEqual(wiringProblems('verify_consent', verifierSource('verify_consent')), []);
  });

  test('e2e.yml derives the facts after the secrets preflight and before any verifier runs, and never runs the helper', () => {
    const code = stripSourceComments(WORKFLOW, '.yml');
    const pre = code.search(/id:\s*pre\b/);
    const derived = code.indexOf('run: node tooling/e2e/derive_expectation.mjs');
    assert.ok(pre !== -1, 'e2e.yml has no secrets preflight (id: pre)');
    assert.ok(derived > pre, 'e2e.yml derives what it expects before the secrets preflight, or not at all');
    for (const { name } of VERIFIERS) {
      const run = code.indexOf(`run: node tooling/e2e/${name}.mjs`);
      assert.ok(run > derived, `${name}.mjs runs before E2E_WORKERS_TRUST is written (or not at all)`);
    }
    for (const script of ['captcha_posture', 'assert_one_issuer']) {
      assert.ok(code.indexOf(`run: node tooling/e2e/${script}.mjs`) > derived, `${script}.mjs runs before the facts are written`);
    }
    assert.ok(!code.includes('auth_target_expectation'), 'the helper is on a run: line — it is imported only');
    assert.ok(!/E2E_AUTH_TARGET/.test(code), 'e2e.yml still hands a consumer the target NAME');
  });

  test('MUTATION · a verifier that defaults the trust answer itself is not wired', () => {
    const src = verifierSource('verify_row');
    const mutated = src.replace(
      'const auth = decideTrust(process.env.E2E_WORKERS_TRUST);',
      "const auth = { trust: process.env.E2E_WORKERS_TRUST || 'yes', why: null };",
    );
    assert.notEqual(mutated, src, 'the mutation did not apply — agents-05');
    const problems = wiringProblems('verify_row', mutated);
    assert.ok(problems.some((p) => /does not decide/.test(p)), problems.join('; '));
    assert.ok(problems.some((p) => /defaults E2E_WORKERS_TRUST itself/.test(p)), problems.join('; '));
  });

  test('MUTATION · a verifier that decides after its first request is not wired', () => {
    const src = verifierSource('verify_purged');
    const decide = DECIDE.exec(stripSourceComments(src, '.mjs'));
    assert.ok(decide, 'the green control above must hold first');
    // Offsets are shared: stripSourceComments replaces with spaces, never deletes.
    const block = src.slice(decide.index, decide.index + decide[0].length);
    const mutated = src.replace(block, `await fetch('about:blank').catch(() => null);\n${block}`);
    assert.notEqual(mutated, src, 'the mutation did not apply — agents-05');
    assert.ok(wiringProblems('verify_purged', mutated).some((p) => /AFTER its first request/.test(p)));
  });
});

// ── the red controls, kept as cases so they stay red ────────────────────────

describe('red controls — each mutation of the helper must break the property it guards', () => {
  test('GREEN CONTROL · the three cutover rows derive what they must', () => {
    assert.deepEqual(derivationProblems(real), []);
  });

  test('MUTATION 1 · TRUST hard-coded to yes reads a Box C run before the switch as trusted', async () => {
    const mutated = HELPER_SOURCE.replace(
      "    trust: origin === originOf(registered.url) ? 'yes' : 'no',",
      "    trust: 'yes',",
    );
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = derivationProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /^Box C URL \+ hosted register: derived stack=selfhosted trust=yes/.test(p)), problems.join('; '));
  });

  test('MUTATION 2 · TRUST from the stack (what the old target NAME meant) instead of the register misreads the switch', async () => {
    const mutated = HELPER_SOURCE.replace(
      "    trust: origin === originOf(registered.url) ? 'yes' : 'no',",
      "    trust: HOSTED_ORIGIN.test(origin) ? 'yes' : 'no',",
    );
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = derivationProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /^Box C URL \+ Box C register: derived stack=selfhosted trust=no/.test(p)), problems.join('; '));
  });

  test('MUTATION 3 · the refused branch grading like the trusted one breaks the refused row expectation', async () => {
    const mutated = HELPER_SOURCE.replace(
      "  if (trust === 'no') {\n    const n = readCount(raw);",
      "  if (trust === 'no') {\n    return rowVerdict('yes', raw);\n    const n = readCount(raw);",
    );
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = refusedRowProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /trust no with 0 rows answered exit 1, not 0/.test(p)), problems.join('; '));
  });

  test('MUTATION 4 · an undecided answer falling through to a default is refused', async () => {
    const decided = "  if (raw === 'yes' || raw === 'no') return { trust: raw, why: null };\n";
    const mutated = HELPER_SOURCE.replace(decided, `${decided}  return { trust: 'yes', why: null };\n`);
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = undecidedProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /was decided as "yes"/.test(p)), problems.join('; '));
  });

  test("MUTATION 5 · deleting the refused branch from verify_row's verdict breaks the refused row expectation", async () => {
    const start = HELPER_SOURCE.indexOf("  if (trust === 'no') {\n    const n = readCount(raw);");
    const end = HELPER_SOURCE.indexOf('  return undecided(trust);', start);
    assert.ok(start !== -1 && end > start, 'the refused branch of rowVerdict was not found');
    const mutated = HELPER_SOURCE.slice(0, start) + HELPER_SOURCE.slice(end);
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = refusedRowProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /trust no with 0 rows answered exit 2, not 0/.test(p)), problems.join('; '));
  });
});
