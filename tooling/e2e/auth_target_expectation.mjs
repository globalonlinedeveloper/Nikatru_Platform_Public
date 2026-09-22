// ─────────────────────────────────────────────────────────────────────────────
// auth_target_expectation.mjs — WHAT the three server-side verifiers expect,
// decided by the auth target this run signed in against.
//
// e2e.yml runs the same live suite against two auth stacks (`auth_target`):
//
//   hosted → the hosted Supabase project, the ONE issuer the Workers trust today.
//            The golden path signs in, adds a subscription, deletes an account.
//   boxa   → the Box A GoTrue. Until the Phase 5 cutover the Workers REFUSE a
//            Box A-minted JWT (runbooks/auth-cutover.md: "the Workers trust
//            exactly one issuer"), so app_test.dart's `againstBoxA` legs stop at
//            `expectOneIssuerRefusal` right after sign-in — before any add and
//            before Delete account.
//
// The same D1 read therefore has OPPOSITE correct answers. On hosted a
// subscription row is the pass; on boxa it is a security finding (the Worker
// accepted a token from an issuer nobody told it to trust). On hosted the
// delete-leg identity being GONE is the pass; on boxa it is a finding (the app
// never asked for the erasure). A verifier that only knows the hosted answer
// fails every boxa run for the right reason read the wrong way round — run
// 35691503049 did exactly that at verify_row, and the one-issuer step after it
// was SKIPPED, which is the step the boxa run exists to reach.
//
// 🔴 AN UNDECIDED TARGET IS REFUSED, NEVER DEFAULTED. Because the answers are
// opposite, a default does not merely risk a false red: graded against the
// other target's expectation, a boxa identity that VANISHED would read as the
// hosted pass. `decideAuthTarget` accepts exactly the two values e2e.yml's
// `auth_target` choice declares and nothing else; every verdict below that is
// handed anything else answers exit 2, "could not decide what to expect".
//
// 🔴 HOSTED IS BYTE-FOR-BYTE WHAT THE VERIFIERS PRINTED BEFORE THIS FILE. The
// hosted strings and exit codes were moved here verbatim, quirks included
// (verify_row reads a missing count as 0, and a count that is not a number
// passes `n < 1`). tooling/ci/test/e2e-verify-target.test.mjs pins them.
//
// PURE, except `say`, which only prints a verdict and hands back its code. No
// fetch, no env, no SQL: the routes, the SQL and the MEASURED_CAUSE text stay in
// the verifiers, where assert-e2e-legs.mjs and assert-d1-sql-inventory.mjs read
// them.
//
// It is imported, never invoked as a step: naming it on a `run:` line would put
// it in assert-guard-coverage.mjs's set of workflow-invoked executables, which
// is a claim about a script CI runs directly. Same shape as consent_anon_id.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** The two values e2e.yml's `auth_target` input may take — its `type: choice`
 *  options, in order. The test holds this list equal to the workflow's. */
export const AUTH_TARGETS = Object.freeze(['hosted', 'boxa']);

/** One line per verifier and target, printed before the first read so a log
 *  says what was being looked for before it says what was found. */
const EXPECTATIONS = Object.freeze({
  verify_row: Object.freeze({
    hosted: 'at least 1 subscription row: the golden path signed in and added one.',
    boxa:
      'EXACTLY 0 subscription rows: the Worker refuses a Box A session, so the full walk stops at ' +
      'the one-issuer refusal before any add. A row would mean it accepted one.',
  }),
  verify_purged: Object.freeze({
    hosted:
      'the delete-leg identity GONE (404) and 0 rows: the app tapped Delete account and the ' +
      'erasure route ran.',
    boxa:
      'the delete-leg identity STILL RESOLVING on Box A and 0 rows: the leg stops at the ' +
      'one-issuer refusal, so the erasure route is never reached and nothing is ever added.',
  }),
  verify_consent: Object.freeze({
    hosted: 'an analytics artifact saying granted=0, with a policy_version, platform web and a consent_id.',
    boxa:
      'the SAME artifact as hosted: the consent route is unauthenticated and the suite answers the ' +
      'prompt before it signs in, so the issuer the Worker trusts never enters it.',
  }),
});

/**
 * The target this run's expectations are graded against.
 *
 * @param {unknown} raw  `process.env.E2E_AUTH_TARGET`, exactly as read.
 * @returns {{ target: 'hosted' | 'boxa', why: null } | { target: null, why: string }}
 */
export function decideAuthTarget(raw) {
  if (raw === 'hosted' || raw === 'boxa') return { target: raw, why: null };
  const shown = raw === undefined || raw === null || raw === '' ? 'unset' : JSON.stringify(String(raw));
  return {
    target: null,
    why:
      `could not decide what to expect: E2E_AUTH_TARGET is ${shown}, and it must be exactly ` +
      `${AUTH_TARGETS.map((t) => `"${t}"`).join(' or ')} (e2e.yml's preflight writes it to $GITHUB_ENV). ` +
      'The two targets expect OPPOSITE outcomes from the same read, so a default would grade this ' +
      'run against the other one, where a finding can read as a pass. Exit 2: nothing was looked at.',
  };
}

/** The line a verifier prints once the target is decided. */
export function expectationLine(verifier, target) {
  const byTarget = EXPECTATIONS[verifier];
  if (!byTarget) throw new Error(`no expectation is written for verifier ${JSON.stringify(verifier)}`);
  const decided = decideAuthTarget(target);
  if (!decided.target) return decided.why;
  return `auth target: ${decided.target} — expecting ${byTarget[decided.target]}`;
}

/** A count D1 really answered with: a non-negative integer, or the digits of
 *  one. Anything else is `NaN` — never 0, because on boxa 0 is a pass. */
const readCount = (raw) => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

/** A verdict for a target this file cannot grade against. */
const undecided = (target) => ({ code: 2, log: [], error: [decideAuthTarget(target).why] });

/**
 * verify_row.mjs — the subscription count for the golden-path user.
 *
 * @param {'hosted'|'boxa'|null} target
 * @param {unknown} raw  `result?.[0]?.results?.[0]?.n`, NOT yet defaulted — on
 *   boxa zero is the pass, so a count that was never read must not become 0.
 */
export function rowVerdict(target, raw) {
  if (target === 'hosted') {
    // Verbatim from verify_row.mjs before 2026-09-22, including `?? 0`.
    const n = Number(raw ?? 0);
    if (n < 1) {
      return { code: 1, log: [], error: ['FAIL: expected >= 1 subscription row created by the E2E run.'] };
    }
    return { code: 0, log: ['PASS: subscription row confirmed in live D1.'], error: [] };
  }
  if (target === 'boxa') {
    const n = readCount(raw);
    if (!Number.isInteger(n) || n < 0) {
      return {
        code: 2,
        log: [],
        error: [
          `COULD NOT LOOK: D1 answered without a readable count (${JSON.stringify(raw) ?? 'undefined'}). ` +
            'On boxa ZERO is the pass, so a count that was never read must not be read as 0.',
        ],
      };
    }
    if (n > 0) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: ${n} subscription row(s) exist for the Box A user. On boxa the full walk stops at the ` +
            'one-issuer refusal before any add, so a row can only mean the deployed Worker ACCEPTED a ' +
            'Box A-minted token: it trusts two issuers, which no code path in services/ implements and ' +
            'nobody decided. Treat it as a security finding, not a test failure.',
        ],
      };
    }
    return {
      code: 0,
      log: [
        'PASS: 0 subscription rows for the Box A user, as one trusted issuer predicts — the Worker ' +
          'refused the Box A session, so the full walk stopped at the refusal before any add.',
      ],
      error: [],
    };
  }
  return undecided(target);
}

/**
 * verify_purged.mjs limb A — the GoTrue admin read of the delete-leg user.
 *
 * @param {'hosted'|'boxa'|null} target
 * @param {{ status: number, ok: boolean, bodyId?: unknown, userId: string }} read
 *   `bodyId` is the `id` of the JSON body when the read was 2xx. Hosted never
 *   looks at it; boxa counts a resolving identity as the pass only when it is
 *   THIS user's.
 */
export function identityVerdict(target, { status, ok, bodyId, userId }) {
  if (target === 'hosted') {
    // Verbatim from verify_purged.mjs before 2026-09-22.
    if (status === 404) {
      return { code: 0, log: ['PASS: the identity record is gone (GoTrue admin read → 404).'], error: [] };
    }
    if (ok) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: the auth user ${userId} STILL RESOLVES (HTTP ${status}) after the in-app ` +
            'deletion reported success. The same email and password can still sign in — this is the ' +
            'exact "your data is gone and your login is not" outcome the platform route reports as 502, ' +
            'and the app told the user their account was deleted.',
        ],
      };
    }
    return {
      code: 2,
      log: [],
      error: [
        `COULD NOT LOOK: the GoTrue admin read answered HTTP ${status}, which is neither ` +
          '404 (gone) nor 2xx (still there). Check SUPABASE_SERVICE_ROLE_KEY before reading this as ' +
          'a deletion failure.',
      ],
    };
  }
  if (target === 'boxa') {
    if (ok && bodyId === userId) {
      return {
        code: 0,
        log: [
          `PASS: the Box A identity ${userId} still resolves (GoTrue admin read → HTTP ${status}, same id), ` +
            'which is the boxa expectation: the Worker refuses a Box A session, so the delete leg stops ' +
            'at that refusal and never reaches the erasure route. Nothing asked for this account to go.',
        ],
        error: [],
      };
    }
    if (status === 404) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: the Box A identity ${userId} is GONE (GoTrue admin read → 404), but on boxa the delete ` +
            'leg stops at the one-issuer refusal and never reaches the erasure route. Either the Worker ' +
            'ACCEPTED a Box A-minted session and the deletion went through — two trusted issuers, a ' +
            'security finding — or something else erased an account nobody asked to erase.',
        ],
      };
    }
    if (ok) {
      return {
        code: 2,
        log: [],
        error: [
          `COULD NOT LOOK: the GoTrue admin read answered HTTP ${status}, but its body names ` +
            `${bodyId === undefined ? 'no id' : JSON.stringify(bodyId)}, not ${userId}. On boxa a ` +
            'resolving identity is the pass, so an answer that does not name this user cannot count as one.',
        ],
      };
    }
    return {
      code: 2,
      log: [],
      error: [
        `COULD NOT LOOK: the GoTrue admin read answered HTTP ${status}, which is neither 2xx (still ` +
          'there, the boxa expectation) nor 404 (gone). Check BOXA_SUPABASE_SERVICE_ROLE_KEY before ' +
          'reading this either way.',
      ],
    };
  }
  return undecided(target);
}

/**
 * verify_purged.mjs limb B — one user-owned table's count for the delete-leg
 * user. Zero is the pass on BOTH targets; what a row MEANS differs.
 *
 * @param {'hosted'|'boxa'|null} target
 * @param {string} table
 * @param {unknown} raw  `result?.[0]?.results?.[0]?.n`, NOT yet defaulted.
 */
export function rowsVerdict(target, table, raw) {
  if (target === 'hosted') {
    // Verbatim from verify_purged.mjs before 2026-09-22, including `?? 0`.
    const rows = Number(raw ?? 0);
    if (rows > 0) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: ${table} still holds ${rows} row(s) for the deleted user. The in-app deletion ` +
            'reported success and this data survived it.',
        ],
      };
    }
    return { code: 0, log: [`ok  ${table}: 0 row(s)`], error: [] };
  }
  if (target === 'boxa') {
    const rows = readCount(raw);
    if (!Number.isInteger(rows) || rows < 0) {
      return {
        code: 2,
        log: [],
        error: [
          `COULD NOT LOOK: D1 answered ${table} without a readable count ` +
            `(${JSON.stringify(raw) ?? 'undefined'}), so it cannot be counted as empty.`,
        ],
      };
    }
    if (rows > 0) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: ${table} holds ${rows} row(s) for the Box A delete-leg user. On boxa that leg stops at ` +
            'the one-issuer refusal before its add, so a row can only mean the Worker ACCEPTED a Box ' +
            'A-minted token — two trusted issuers, a security finding.',
        ],
      };
    }
    return { code: 0, log: [`ok  ${table}: 0 row(s)`], error: [] };
  }
  return undecided(target);
}

/**
 * verify_purged.mjs's closing lines, once both limbs have been read.
 *
 * @param {'hosted'|'boxa'|null} target
 * @param {{ survived: boolean, blind: boolean }} findings
 */
export function purgedSummary(target, { survived, blind }) {
  const alsoBlind =
    '  (Another limb of this audit also could not be read, so the damage above may be the ' +
    'smaller half of it.)';
  if (target === 'hosted') {
    // Verbatim from verify_purged.mjs before 2026-09-22.
    if (survived) {
      return {
        code: 1,
        log: [],
        error: [
          "The golden path's delete leg is BROKEN against production: the app told a user their account " +
            'was deleted, and the stores disagree.',
          ...(blind ? [alsoBlind] : []),
        ],
      };
    }
    if (blind) {
      return {
        code: 2,
        log: [],
        error: [
          'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the deletion ' +
            'worked. Exit 2 is deliberately not 1: fix the access, then re-run.',
        ],
      };
    }
    return {
      code: 0,
      log: [
        'PASS: the in-app account deletion really erased this user — the identity is unresolvable and ' +
          'every user-owned table in subscriptiontracker_db is empty for it. [pipeline N-6 leg 6]',
      ],
      error: [],
    };
  }
  if (target === 'boxa') {
    if (survived) {
      return {
        code: 1,
        log: [],
        error: [
          'The boxa delete leg found what one trusted issuer says cannot happen: the Worker refuses a ' +
            'Box A session, so this user was never meant to be erased or to own a row, and the stores ' +
            'disagree.',
          ...(blind ? [alsoBlind] : []),
        ],
      };
    }
    if (blind) {
      return {
        code: 2,
        log: [],
        error: [
          'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the boxa delete ' +
            'leg left its user untouched. Exit 2 is deliberately not 1: fix the access, then re-run.',
        ],
      };
    }
    return {
      code: 0,
      log: [
        'PASS: on boxa the delete leg left its user exactly as one trusted issuer predicts — the ' +
          'identity still resolves on Box A and every user-owned table in subscriptiontracker_db is ' +
          'empty for it. [pipeline N-6 leg 6, boxa]',
      ],
      error: [],
    };
  }
  return undecided(target);
}

/** Print a verdict — `log` lines to stdout, `error` lines to stderr, each in
 *  order — and hand back its exit code. The only impure export. */
export function say({ code, log = [], error = [] }) {
  for (const line of log) console.log(line);
  for (const line of error) console.error(line);
  return code;
}
