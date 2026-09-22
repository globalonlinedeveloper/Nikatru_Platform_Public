// ─────────────────────────────────────────────────────────────────────────────
// e2e-verify-target.test.mjs — the three server-side E2E verifiers know which
// auth target they are grading, and refuse to guess.
//
// `tooling/e2e/verify_row.mjs`, `verify_purged.mjs` and `verify_consent.mjs`
// each carry a NO_NEGATIVE_TEST_NEEDED entry in assert-guard-coverage.mjs: their
// subject is a live D1 row or a live GoTrue identity, and a fixture cannot stand
// in for either. That stays true. What IS fixture-testable is the half split out
// of them on 2026-09-22 — `tooling/e2e/auth_target_expectation.mjs`, which turns
// (target, what was read) into an exit code and the lines that explain it. The
// same split consent_anon_id.mjs made, for the same reason. So:
//
//   · the helper is IMPORTED and driven through every branch, and
//   · each verifier's comment-stripped source is read — never run — to prove it
//     decides the target through the helper, before its first request, and
//     exits 2 when the target is undecided.
//
// 🔴 WHAT IS BEING PROTECTED. The two targets expect OPPOSITE answers from the
// same read (a subscription row: hosted pass, boxa security finding; a deleted
// identity: hosted pass, boxa finding). Three regressions would each turn a boxa
// run into a lie, and each has a MUTATION case below that must go red:
//   1. the boxa branch grading like hosted,
//   2. an unset or unknown target falling through to hosted,
//   3. the boxa branch deleted from verify_row's verdict.
// Each is preceded by the green control it breaks, because a case that fails for
// the wrong reason is not a case at all.
//
// 🔴 HOSTED IS PINNED BYTE FOR BYTE. The hosted strings below are the ones the
// verifiers printed before the split, copied out of origin/main 0e6ce4fe. A
// hosted verdict that changes by a character is a change to what the nightly
// has always said, and it must be made here on purpose.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as real from '../../e2e/auth_target_expectation.mjs';
import { stripSourceComments } from '../text-reductions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HELPER_SOURCE = readFileSync(join(REPO, 'tooling', 'e2e', 'auth_target_expectation.mjs'), 'utf8');
const WORKFLOW = readFileSync(join(REPO, '.github', 'workflows', 'e2e.yml'), 'utf8');

const USER = '9723a3bc-0000-4000-8000-000000000001';
const OTHER = '11111111-0000-4000-8000-000000000002';
const UNDECIDED = [undefined, null, '', 'Hosted', 'BOXA', ' boxa', 'boxa\n', 'staging', 'local'];

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

/** The boxa row expectation: exactly 0 passes, a row is a finding, an unread
 *  count is "could not look" and never a pass. */
const boxaRowProblems = (m) => {
  const problems = [];
  const zero = m.rowVerdict('boxa', 0);
  if (zero.code !== 0) problems.push(`boxa with 0 rows answered exit ${zero.code}, not 0`);
  const one = m.rowVerdict('boxa', 1);
  if (one.code !== 1) problems.push(`boxa with 1 row answered exit ${one.code}, not 1`);
  else if (!/ACCEPTED a Box A-minted token/.test(one.error.join('\n'))) problems.push('boxa with 1 row does not name the two-issuer finding');
  for (const raw of [undefined, null, 'abc', -1, 1.5, '']) {
    const v = m.rowVerdict('boxa', raw);
    if (v.code !== 2) problems.push(`boxa with an unread count ${JSON.stringify(raw)} answered exit ${v.code}, not 2`);
  }
  return problems;
};

/** An undecided target is refused everywhere, and never becomes hosted. */
const undecidedProblems = (m) => {
  const problems = [];
  for (const raw of UNDECIDED) {
    const d = m.decideAuthTarget(raw);
    if (d.target !== null) problems.push(`E2E_AUTH_TARGET=${JSON.stringify(raw)} was decided as ${JSON.stringify(d.target)}`);
    else if (!/^could not decide what to expect/.test(d.why ?? '')) problems.push(`E2E_AUTH_TARGET=${JSON.stringify(raw)} was refused without saying why`);
  }
  for (const target of [null, undefined, 'staging']) {
    const verdicts = {
      rowVerdict: m.rowVerdict(target, 1),
      identityVerdict: m.identityVerdict(target, { status: 404, ok: false, userId: USER }),
      rowsVerdict: m.rowsVerdict(target, 'subscriptions', 0),
      purgedSummary: m.purgedSummary(target, { survived: false, blind: false }),
    };
    for (const [fn, v] of Object.entries(verdicts)) {
      if (v.code !== 2) problems.push(`${fn}(${JSON.stringify(target)}) answered exit ${v.code}, not 2`);
      else if (!/^could not decide what to expect/.test(v.error[0] ?? '')) problems.push(`${fn}(${JSON.stringify(target)}) did not say "could not decide what to expect"`);
    }
  }
  return problems;
};

describe('decideAuthTarget — exactly the two declared targets, nothing defaulted', () => {
  test('GREEN CONTROL · "hosted" and "boxa" decide themselves', () => {
    assert.deepEqual(real.decideAuthTarget('hosted'), { target: 'hosted', why: null });
    assert.deepEqual(real.decideAuthTarget('boxa'), { target: 'boxa', why: null });
  });

  test('unset, empty, mis-cased, padded and unknown targets are all refused, and never become hosted', () => {
    assert.deepEqual(undecidedProblems(real), []);
  });

  test('the refusal names the value it was given, so a log says what arrived', () => {
    assert.match(real.decideAuthTarget(undefined).why, /E2E_AUTH_TARGET is unset/);
    assert.match(real.decideAuthTarget('').why, /E2E_AUTH_TARGET is unset/);
    assert.match(real.decideAuthTarget('staging').why, /E2E_AUTH_TARGET is "staging"/);
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
  test('hosted, byte for byte: a row passes, none fails', () => {
    assert.deepEqual(real.rowVerdict('hosted', 1), { code: 0, log: ['PASS: subscription row confirmed in live D1.'], error: [] });
    assert.deepEqual(real.rowVerdict('hosted', '3'), { code: 0, log: ['PASS: subscription row confirmed in live D1.'], error: [] });
    assert.deepEqual(real.rowVerdict('hosted', 0), { code: 1, log: [], error: ['FAIL: expected >= 1 subscription row created by the E2E run.'] });
  });

  test("hosted keeps its old `?? 0`: a missing count reads as 0 and fails, exactly as before", () => {
    assert.equal(real.rowVerdict('hosted', undefined).code, 1);
    assert.equal(real.rowVerdict('hosted', null).code, 1);
  });

  test('GREEN CONTROL · boxa: exactly 0 passes, a row is the two-issuer finding, an unread count is exit 2', () => {
    assert.deepEqual(boxaRowProblems(real), []);
  });

  test('boxa and hosted grade the same read in opposite directions', () => {
    assert.equal(real.rowVerdict('hosted', 0).code, 1);
    assert.equal(real.rowVerdict('boxa', 0).code, 0);
    assert.equal(real.rowVerdict('hosted', 1).code, 0);
    assert.equal(real.rowVerdict('boxa', 1).code, 1);
  });
});

describe('identityVerdict — verify_purged.mjs limb A', () => {
  test('hosted, byte for byte: 404 passes, a resolving identity fails, anything else could not look', () => {
    assert.deepEqual(real.identityVerdict('hosted', { status: 404, ok: false, userId: USER }), {
      code: 0,
      log: ['PASS: the identity record is gone (GoTrue admin read → 404).'],
      error: [],
    });
    assert.deepEqual(real.identityVerdict('hosted', { status: 200, ok: true, bodyId: USER, userId: USER }), {
      code: 1,
      log: [],
      error: [
        `FAIL: the auth user ${USER} STILL RESOLVES (HTTP 200) after the in-app deletion reported success. ` +
          'The same email and password can still sign in — this is the exact "your data is gone and your ' +
          'login is not" outcome the platform route reports as 502, and the app told the user their account ' +
          'was deleted.',
      ],
    });
    assert.deepEqual(real.identityVerdict('hosted', { status: 401, ok: false, userId: USER }), {
      code: 2,
      log: [],
      error: [
        'COULD NOT LOOK: the GoTrue admin read answered HTTP 401, which is neither 404 (gone) nor 2xx ' +
          '(still there). Check SUPABASE_SERVICE_ROLE_KEY before reading this as a deletion failure.',
      ],
    });
  });

  test('GREEN CONTROL · boxa: the identity still resolving AS THIS USER is the pass', () => {
    const v = real.identityVerdict('boxa', { status: 200, ok: true, bodyId: USER, userId: USER });
    assert.equal(v.code, 0);
    assert.match(v.log[0], /^PASS: the Box A identity .* still resolves/);
  });

  test('boxa: the identity GONE is a finding (exit 1), not the hosted pass', () => {
    const v = real.identityVerdict('boxa', { status: 404, ok: false, userId: USER });
    assert.equal(v.code, 1);
    assert.match(v.error[0], /is GONE/);
  });

  test("boxa: a 2xx that does not name this user, and any other status, could not look (exit 2)", () => {
    assert.equal(real.identityVerdict('boxa', { status: 200, ok: true, bodyId: OTHER, userId: USER }).code, 2);
    assert.equal(real.identityVerdict('boxa', { status: 200, ok: true, bodyId: undefined, userId: USER }).code, 2);
    for (const status of [401, 403, 500, 502]) {
      assert.equal(real.identityVerdict('boxa', { status, ok: false, userId: USER }).code, 2, `HTTP ${status}`);
    }
  });
});

describe('rowsVerdict — verify_purged.mjs limb B', () => {
  test('hosted, byte for byte, including a missing count reading as 0', () => {
    assert.deepEqual(real.rowsVerdict('hosted', 'budgets', 0), { code: 0, log: ['ok  budgets: 0 row(s)'], error: [] });
    assert.deepEqual(real.rowsVerdict('hosted', 'budgets', undefined), { code: 0, log: ['ok  budgets: 0 row(s)'], error: [] });
    assert.deepEqual(real.rowsVerdict('hosted', 'budgets', 2), {
      code: 1,
      log: [],
      error: ['FAIL: budgets still holds 2 row(s) for the deleted user. The in-app deletion reported success and this data survived it.'],
    });
  });

  test('GREEN CONTROL · boxa: 0 rows passes', () => {
    assert.deepEqual(real.rowsVerdict('boxa', 'budgets', 0), { code: 0, log: ['ok  budgets: 0 row(s)'], error: [] });
  });

  test('boxa: a row is the two-issuer finding, and an unread count is never 0', () => {
    const one = real.rowsVerdict('boxa', 'subscriptions', 1);
    assert.equal(one.code, 1);
    assert.match(one.error[0], /ACCEPTED a Box A-minted token/);
    for (const raw of [undefined, 'x', -3]) assert.equal(real.rowsVerdict('boxa', 'subscriptions', raw).code, 2, JSON.stringify(raw));
  });
});

describe('purgedSummary — verify_purged.mjs closing lines', () => {
  test('hosted, byte for byte', () => {
    assert.deepEqual(real.purgedSummary('hosted', { survived: false, blind: false }), {
      code: 0,
      log: [
        'PASS: the in-app account deletion really erased this user — the identity is unresolvable and every ' +
          'user-owned table in subscriptiontracker_db is empty for it. [pipeline N-6 leg 6]',
      ],
      error: [],
    });
    assert.deepEqual(real.purgedSummary('hosted', { survived: true, blind: true }), {
      code: 1,
      log: [],
      error: [
        "The golden path's delete leg is BROKEN against production: the app told a user their account was " +
          'deleted, and the stores disagree.',
        '  (Another limb of this audit also could not be read, so the damage above may be the smaller half of it.)',
      ],
    });
    assert.deepEqual(real.purgedSummary('hosted', { survived: false, blind: true }), {
      code: 2,
      log: [],
      error: [
        'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the deletion worked. ' +
          'Exit 2 is deliberately not 1: fix the access, then re-run.',
      ],
    });
  });

  test('boxa: its own pass line, and 1 beats 2 exactly as on hosted', () => {
    const pass = real.purgedSummary('boxa', { survived: false, blind: false });
    assert.equal(pass.code, 0);
    assert.match(pass.log[0], /^PASS: on boxa the delete leg left its user/);
    assert.equal(real.purgedSummary('boxa', { survived: true, blind: true }).code, 1);
    assert.equal(real.purgedSummary('boxa', { survived: true, blind: true }).error.length, 2);
    assert.equal(real.purgedSummary('boxa', { survived: false, blind: true }).code, 2);
  });
});

describe('expectationLine — what each verifier says it is looking for', () => {
  test('every verifier has a line for every target, and boxa never reads like hosted', () => {
    for (const verifier of ['verify_row', 'verify_purged', 'verify_consent']) {
      const lines = real.AUTH_TARGETS.map((t) => real.expectationLine(verifier, t));
      for (const [i, t] of real.AUTH_TARGETS.entries()) assert.match(lines[i], new RegExp(`^auth target: ${t} — expecting `));
      assert.notEqual(lines[0].replace(/^auth target: \w+/, ''), lines[1].replace(/^auth target: \w+/, ''), verifier);
    }
  });

  test('verify_consent on boxa expects the SAME artifact as hosted, and says why', () => {
    assert.match(real.expectationLine('verify_consent', 'boxa'), /the SAME artifact as hosted: the consent route is unauthenticated/);
  });

  test('an undecided target gets the refusal, and an unknown verifier is a programming error', () => {
    assert.match(real.expectationLine('verify_row', 'staging'), /^could not decide what to expect/);
    assert.throws(() => real.expectationLine('verify_nothing', 'hosted'), /no expectation is written/);
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

// ── the verifiers' wiring, read comment-stripped and never run ──────────────
// Running them would need a live D1 and a live GoTrue (their NO_NEGATIVE_TEST_
// NEEDED entries say why). What CAN be proved from the source is that each one
// hands its target to the helper, decides it before its first request, exits 2
// on an undecided one, and grades with the helper rather than its own literal.

const VERIFIERS = [
  { name: 'verify_row', calls: [/process\.exitCode\s*=\s*say\(\s*rowVerdict\(\s*auth\.target\s*,/] },
  {
    name: 'verify_purged',
    calls: [
      /worse\(\s*say\(\s*identityVerdict\(\s*auth\.target\s*,/,
      /worse\(\s*say\(\s*rowsVerdict\(\s*auth\.target\s*,/,
      /say\(\s*purgedSummary\(\s*auth\.target\s*,/,
    ],
  },
  { name: 'verify_consent', calls: [] },
];

const DECIDE =
  /const\s+auth\s*=\s*decideAuthTarget\(\s*process\.env\.E2E_AUTH_TARGET\s*\)\s*;\s*if\s*\(\s*!auth\.target\s*\)\s*\{\s*console\.error\([^;]*\bauth\.why\b[^;]*\)\s*;\s*process\.exit\(\s*2\s*\)\s*;/;

/** Every way a verifier's code can fail to be target-aware. [] = wired. */
const wiringProblems = (name, source) => {
  const code = stripSourceComments(source, '.mjs');
  const problems = [];
  if (!/from\s+['"]\.\/auth_target_expectation\.mjs['"]/.test(code)) problems.push('does not import ./auth_target_expectation.mjs');
  const decide = DECIDE.exec(code);
  if (!decide) problems.push('does not decide E2E_AUTH_TARGET through decideAuthTarget and exit 2 when it is undecided');
  const firstAwait = code.search(/\bawait\b/);
  if (decide && firstAwait !== -1 && decide.index > firstAwait) problems.push('decides the target AFTER its first request');
  if (!new RegExp(`expectationLine\\(\\s*'${name}'\\s*,\\s*auth\\.target\\s*\\)`).test(code)) problems.push(`does not print expectationLine('${name}', auth.target)`);
  for (const re of VERIFIERS.find((v) => v.name === name).calls) if (!re.test(code)) problems.push(`does not grade through ${re.source}`);
  if (/E2E_AUTH_TARGET\s*(\|\||\?\?)/.test(code)) problems.push('defaults E2E_AUTH_TARGET itself');
  if (/['"`](hosted|boxa)['"`]/.test(code)) problems.push('names a target literally instead of leaving it to the helper');
  return problems;
};

const verifierSource = (name) => readFileSync(join(REPO, 'tooling', 'e2e', `${name}.mjs`), 'utf8');

describe('each verifier is wired to the helper, before its first request', () => {
  // One `test(` per verifier, never a loop: assert-no-loop-cases.mjs counts a
  // looped case as ONE declaration, so a verifier dropped from a list would
  // take its case with it where the coverage ratchet cannot see.
  test('GREEN CONTROL · verify_row.mjs decides, refuses an undecided target with exit 2, and grades through the helper', () => {
    assert.deepEqual(wiringProblems('verify_row', verifierSource('verify_row')), []);
  });

  test('GREEN CONTROL · verify_purged.mjs decides, refuses an undecided target with exit 2, and grades through the helper', () => {
    assert.deepEqual(wiringProblems('verify_purged', verifierSource('verify_purged')), []);
  });

  test('GREEN CONTROL · verify_consent.mjs decides, refuses an undecided target with exit 2, and grades through the helper', () => {
    assert.deepEqual(wiringProblems('verify_consent', verifierSource('verify_consent')), []);
  });

  test('e2e.yml writes E2E_AUTH_TARGET to $GITHUB_ENV before any verifier runs, and never runs the helper', () => {
    const code = stripSourceComments(WORKFLOW, '.yml');
    const write = code.search(/echo\s+"E2E_AUTH_TARGET=\$\{TARGET\}"\s*>>\s*"\$GITHUB_ENV"/);
    assert.ok(write !== -1, 'e2e.yml no longer writes E2E_AUTH_TARGET to $GITHUB_ENV');
    for (const { name } of VERIFIERS) {
      const run = code.indexOf(`run: node tooling/e2e/${name}.mjs`);
      assert.ok(run > write, `${name}.mjs runs before E2E_AUTH_TARGET is written (or not at all)`);
    }
    assert.ok(!code.includes('auth_target_expectation'), 'the helper is on a run: line — it is imported only');
  });

  test('MUTATION · a verifier that defaults the target itself is not wired', () => {
    const src = verifierSource('verify_row');
    const mutated = src.replace(
      'const auth = decideAuthTarget(process.env.E2E_AUTH_TARGET);',
      "const auth = { target: process.env.E2E_AUTH_TARGET || 'hosted', why: null };",
    );
    assert.notEqual(mutated, src, 'the mutation did not apply — agents-05');
    const problems = wiringProblems('verify_row', mutated);
    assert.ok(problems.some((p) => /does not decide/.test(p)), problems.join('; '));
    assert.ok(problems.some((p) => /defaults E2E_AUTH_TARGET itself/.test(p)), problems.join('; '));
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

// ── the three red controls, kept as cases so they stay red ──────────────────

describe('red controls — each mutation of the helper must break the property it guards', () => {
  test('MUTATION 1 · the boxa branch grading like hosted breaks the boxa row expectation', async () => {
    const mutated = HELPER_SOURCE.replace(
      "  if (target === 'boxa') {\n    const n = readCount(raw);",
      "  if (target === 'boxa') {\n    return rowVerdict('hosted', raw);\n    const n = readCount(raw);",
    );
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = boxaRowProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /boxa with 0 rows answered exit 1, not 0/.test(p)), problems.join('; '));
  });

  test('MUTATION 2 · an undecided target falling through to hosted is refused', async () => {
    const decided = "  if (raw === 'hosted' || raw === 'boxa') return { target: raw, why: null };\n";
    const mutated = HELPER_SOURCE.replace(decided, `${decided}  return { target: 'hosted', why: null };\n`);
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = undecidedProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /was decided as "hosted"/.test(p)), problems.join('; '));
  });

  test("MUTATION 3 · deleting the boxa branch from verify_row's verdict breaks the boxa row expectation", async () => {
    const start = HELPER_SOURCE.indexOf("  if (target === 'boxa') {\n    const n = readCount(raw);");
    const end = HELPER_SOURCE.indexOf('  return undecided(target);', start);
    assert.ok(start !== -1 && end > start, 'the boxa branch of rowVerdict was not found');
    const mutated = HELPER_SOURCE.slice(0, start) + HELPER_SOURCE.slice(end);
    assert.notEqual(mutated, HELPER_SOURCE, 'the mutation did not apply — agents-05');
    const problems = boxaRowProblems(await importMutated(mutated));
    assert.ok(problems.some((p) => /boxa with 0 rows answered exit 2, not 0/.test(p)), problems.join('; '));
  });
});
