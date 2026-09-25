// ─────────────────────────────────────────────────────────────────────────────
// auth_target_expectation.mjs — WHAT the live E2E run expects, derived from two
// FACTS about the stack it signed in against, never from the name of a target.
//
// e2e.yml's `auth_target` names a SECRET SET, not a stack:
//
//   production → secrets.SUPABASE_*             (the default; the nightly)
//   selfhosted → secrets.SELFHOSTED_SUPABASE_*  (Box C, dispatched on a branch)
//
// ⏱ 2026-09-25 — WHY THE NAME STOPPED BEING ENOUGH. Until today the two targets
// were `hosted` and `boxa`, and each hard-coded TWO facts at once: which captcha
// posture the stack has, and whether the deployed Workers trust its issuer. The
// Phase 5 cutover moves those two facts at DIFFERENT moments — the repo secrets
// are rotated to Box C first (C6), and the Workers follow only when the switch
// commit changes vars.SUPABASE_URL (C7) — so in between, the default run is on a
// stack with captcha ON that the Workers do NOT yet trust, a combination neither
// old target expected. So both facts are now derived, once, by
// `deriveExpectation` below, from the run's SUPABASE_URL and the register:
//
//   E2E_STACK          hosted     — the URL's origin is `https://<ref>.supabase.co`
//                      selfhosted — anything else (Box C's GoTrue)
//                      → decides the CAPTCHA posture (captcha_posture.mjs, and
//                        the wrong-password copy in app_test.dart).
//   E2E_WORKERS_TRUST  yes — the URL's origin IS tooling/platform-register.json
//                            `sharedValues` vars.SUPABASE_URL at the checked-out
//                            sha, the one-issuer fact assert-platform-register
//                            LIMB 5 holds equal to all three wrangler configs
//                      no  — anything else
//                      → decides EVERYTHING BEHIND THE WORKER (assert_one_issuer,
//                        the three verifiers below, and whether app_test.dart
//                        walks the app or stops at `expectOneIssuerRefusal`).
//
// tooling/e2e/derive_expectation.mjs is the step that calls it and writes both
// to $GITHUB_ENV. Every consumer reads the fact it needs and refuses an unset or
// unknown value with exit 2; none of them reads the target name.
//
// The same D1 read has OPPOSITE correct answers under the two trust values. With
// trust a subscription row is the pass; without it a row is a security finding
// (the Worker accepted a token from an issuer nobody told it to trust). With
// trust the delete-leg identity being GONE is the pass; without it that is a
// finding (the app never reached the erasure route). A verifier that only knew
// the trusted answer failed every refused run for the right reason read the
// wrong way round — run 35691503049 did exactly that at verify_row.
//
// 🔴 AN UNDECIDED FACT IS REFUSED, NEVER DEFAULTED. Because the answers are
// opposite, a default does not merely risk a false red: graded against the
// other expectation, a refused identity that VANISHED would read as the trusted
// pass. `decideTrust` accepts exactly `yes` or `no`; every verdict below that is
// handed anything else answers exit 2, "could not decide what to expect".
//
// 🔴 TRUST=yes IS BYTE-FOR-BYTE WHAT THE VERIFIERS PRINTED FOR `hosted` BEFORE
// THIS FILE. The hosted strings and exit codes were moved here verbatim, quirks
// included (verify_row reads a missing count as 0, and a count that is not a
// number passes `n < 1`), and the re-key on 2026-09-25 kept them.
// tooling/ci/test/e2e-verify-target.test.mjs pins them.
//
// PURE, except `say`, which only prints a verdict and hands back its code. No
// fetch, no env, no file read, no SQL: the register TEXT is handed in, and the
// routes, the SQL and the MEASURED_CAUSE text stay in the verifiers, where
// assert-e2e-legs.mjs and assert-d1-sql-inventory.mjs read them.
//
// It is imported, never invoked as a step: naming it on a `run:` line would put
// it in assert-guard-coverage.mjs's set of workflow-invoked executables, which
// is a claim about a script CI runs directly. Same shape as consent_anon_id.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** The two values e2e.yml's `auth_target` input may take — its `type: choice`
 *  options, in order. Each names a secret set; neither names what to expect.
 *  The test holds this list equal to the workflow's. */
export const AUTH_TARGETS = Object.freeze(['production', 'selfhosted']);

/** The two stacks E2E_STACK may name, and the two answers E2E_WORKERS_TRUST may give. */
export const STACKS = Object.freeze(['hosted', 'selfhosted']);
export const TRUST = Object.freeze(['yes', 'no']);

/** A hosted Supabase project's origin. The same shape
 *  tooling/ops/auth-cutover-preflight.mjs grades as "hosted". */
const HOSTED_ORIGIN = /^https:\/\/[a-z0-9]+\.supabase\.co$/;

/** The origin of an absolute http(s) URL, or null. */
function originOf(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
}

/**
 * The ONE `vars.SUPABASE_URL` tooling/platform-register.json declares.
 *
 * @param {string} registerText  the register file's text, exactly as read.
 * @returns {{ url: string, why: null } | { url: null, why: string }}
 */
export function registeredSupabaseUrl(registerText) {
  let register;
  try {
    register = JSON.parse(registerText);
  } catch {
    return { url: null, why: 'tooling/platform-register.json is not JSON' };
  }
  const values = register?.sharedValues?.values;
  if (!Array.isArray(values)) return { url: null, why: 'tooling/platform-register.json has no sharedValues.values[]' };
  const hits = values.filter((v) => v?.at === 'vars.SUPABASE_URL');
  if (hits.length !== 1) {
    return {
      url: null,
      why: `tooling/platform-register.json declares ${hits.length} vars.SUPABASE_URL entries, not exactly one`,
    };
  }
  if (!originOf(hits[0].value)) {
    return { url: null, why: 'tooling/platform-register.json vars.SUPABASE_URL is not an http(s) URL' };
  }
  return { url: hits[0].value, why: null };
}

/**
 * The two facts this run is graded on.
 *
 * @param {unknown} supabaseUrl   the run's resolved SUPABASE_URL (a secret: it is
 *   compared here and never returned or printed).
 * @param {string} registerText   tooling/platform-register.json at the checked-out sha.
 * @returns {{ stack: 'hosted'|'selfhosted', trust: 'yes'|'no', why: null }
 *         | { stack: null, trust: null, why: string }}
 */
export function deriveExpectation(supabaseUrl, registerText) {
  const refuse = (because) => ({
    stack: null,
    trust: null,
    why: `could not decide what to expect: ${because}. Exit 2: nothing was looked at.`,
  });
  const origin = originOf(supabaseUrl);
  if (!origin) return refuse('the run\'s SUPABASE_URL is unset or is not an http(s) URL');
  const registered = registeredSupabaseUrl(registerText);
  if (!registered.url) return refuse(registered.why);
  return {
    stack: HOSTED_ORIGIN.test(origin) ? 'hosted' : 'selfhosted',
    trust: origin === originOf(registered.url) ? 'yes' : 'no',
    why: null,
  };
}

/** Shown value of an env read, for a refusal: never more than the value itself. */
const shown = (raw) => (raw === undefined || raw === null || raw === '' ? 'unset' : JSON.stringify(String(raw)));

/**
 * E2E_STACK, as a consumer reads it back.
 *
 * @param {unknown} raw  `process.env.E2E_STACK`, exactly as read.
 * @returns {{ stack: 'hosted'|'selfhosted', why: null } | { stack: null, why: string }}
 */
export function decideStack(raw) {
  if (raw === 'hosted' || raw === 'selfhosted') return { stack: raw, why: null };
  return {
    stack: null,
    why:
      `could not decide what to expect: E2E_STACK is ${shown(raw)}, and it must be exactly ` +
      `${STACKS.map((s) => `"${s}"`).join(' or ')} (e2e.yml's step "Derive what this run expects" ` +
      'writes it to $GITHUB_ENV). The two stacks answer a captcha token in OPPOSITE ways, so a default ' +
      'would grade this run against the other one. Exit 2: nothing was looked at.',
  };
}

/**
 * E2E_WORKERS_TRUST, as a consumer reads it back.
 *
 * @param {unknown} raw  `process.env.E2E_WORKERS_TRUST`, exactly as read.
 * @returns {{ trust: 'yes'|'no', why: null } | { trust: null, why: string }}
 */
export function decideTrust(raw) {
  if (raw === 'yes' || raw === 'no') return { trust: raw, why: null };
  return {
    trust: null,
    why:
      `could not decide what to expect: E2E_WORKERS_TRUST is ${shown(raw)}, and it must be exactly ` +
      `${TRUST.map((t) => `"${t}"`).join(' or ')} (e2e.yml's step "Derive what this run expects" ` +
      'writes it to $GITHUB_ENV). The two answers expect OPPOSITE outcomes from the same read, so a ' +
      'default would grade this run against the other one, where a finding can read as a pass. ' +
      'Exit 2: nothing was looked at.',
  };
}

/** One line per verifier and trust answer, printed before the first read so a
 *  log says what was being looked for before it says what was found. */
const EXPECTATIONS = Object.freeze({
  verify_row: Object.freeze({
    yes: 'at least 1 subscription row: the golden path signed in and added one.',
    no:
      "EXACTLY 0 subscription rows: the Workers refuse this run's issuer, so the full walk stops at " +
      'the one-issuer refusal before any add. A row would mean they accepted it.',
  }),
  verify_purged: Object.freeze({
    yes:
      'the delete-leg identity GONE (404) and 0 rows: the app tapped Delete account and the ' +
      'erasure route ran.',
    no:
      "the delete-leg identity STILL RESOLVING on this run's stack and 0 rows: the leg stops at the " +
      'one-issuer refusal, so the erasure route is never reached and nothing is ever added.',
  }),
  verify_consent: Object.freeze({
    yes: 'an analytics artifact saying granted=0, with a policy_version, platform web and a consent_id.',
    no:
      'the SAME artifact as when the Workers trust the issuer: the consent route is unauthenticated ' +
      'and the suite answers the prompt before it signs in, so the issuer the Worker trusts never enters it.',
  }),
});

/** The line a verifier prints once the trust answer is decided. */
export function expectationLine(verifier, trust) {
  const byTrust = EXPECTATIONS[verifier];
  if (!byTrust) throw new Error(`no expectation is written for verifier ${JSON.stringify(verifier)}`);
  const decided = decideTrust(trust);
  if (!decided.trust) return decided.why;
  return `Workers trust this run's issuer: ${decided.trust} — expecting ${byTrust[decided.trust]}`;
}

/** A count D1 really answered with: a non-negative integer, or the digits of
 *  one. Anything else is `NaN` — never 0, because without trust 0 is a pass. */
const readCount = (raw) => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

/** A verdict for a trust answer this file cannot grade against. */
const undecided = (trust) => ({ code: 2, log: [], error: [decideTrust(trust).why] });

/**
 * verify_row.mjs — the subscription count for the golden-path user.
 *
 * @param {'yes'|'no'|null} trust
 * @param {unknown} raw  `result?.[0]?.results?.[0]?.n`, NOT yet defaulted — with
 *   no trust zero is the pass, so a count that was never read must not become 0.
 */
export function rowVerdict(trust, raw) {
  if (trust === 'yes') {
    // Verbatim from verify_row.mjs before 2026-09-22, including `?? 0`.
    const n = Number(raw ?? 0);
    if (n < 1) {
      return { code: 1, log: [], error: ['FAIL: expected >= 1 subscription row created by the E2E run.'] };
    }
    return { code: 0, log: ['PASS: subscription row confirmed in live D1.'], error: [] };
  }
  if (trust === 'no') {
    const n = readCount(raw);
    if (!Number.isInteger(n) || n < 0) {
      return {
        code: 2,
        log: [],
        error: [
          `COULD NOT LOOK: D1 answered without a readable count (${JSON.stringify(raw) ?? 'undefined'}). ` +
            'When the Workers refuse the issuer ZERO is the pass, so a count that was never read must not be read as 0.',
        ],
      };
    }
    if (n > 0) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: ${n} subscription row(s) exist for a user whose issuer the Workers refuse. The full walk ` +
            'stops at the one-issuer refusal before any add, so a row can only mean the deployed Worker ' +
            'ACCEPTED a token from an issuer it does not trust: it trusts two issuers, which no code path ' +
            'in services/ implements and nobody decided. Treat it as a security finding, not a test failure.',
        ],
      };
    }
    return {
      code: 0,
      log: [
        "PASS: 0 subscription rows for this run's user, as one trusted issuer predicts — the Worker " +
          'refused the session, so the full walk stopped at the refusal before any add.',
      ],
      error: [],
    };
  }
  return undecided(trust);
}

/**
 * verify_purged.mjs limb A — the GoTrue admin read of the delete-leg user.
 *
 * @param {'yes'|'no'|null} trust
 * @param {{ status: number, ok: boolean, bodyId?: unknown, userId: string }} read
 *   `bodyId` is the `id` of the JSON body when the read was 2xx. With trust it is
 *   never looked at; without it a resolving identity is the pass only when it is
 *   THIS user's.
 */
export function identityVerdict(trust, { status, ok, bodyId, userId }) {
  if (trust === 'yes') {
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
  if (trust === 'no') {
    if (ok && bodyId === userId) {
      return {
        code: 0,
        log: [
          `PASS: the identity ${userId} still resolves (GoTrue admin read → HTTP ${status}, same id), ` +
            'which is the expectation when the Workers refuse the issuer: the delete leg stops at that ' +
            'refusal and never reaches the erasure route. Nothing asked for this account to go.',
        ],
        error: [],
      };
    }
    if (status === 404) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: the identity ${userId} is GONE (GoTrue admin read → 404), but the Workers refuse this ` +
            "run's issuer, so the delete leg stops at the one-issuer refusal and never reaches the erasure " +
            'route. Either the Worker ACCEPTED a session from an issuer it does not trust and the deletion ' +
            'went through — two trusted issuers, a security finding — or something else erased an account ' +
            'nobody asked to erase.',
        ],
      };
    }
    if (ok) {
      return {
        code: 2,
        log: [],
        error: [
          `COULD NOT LOOK: the GoTrue admin read answered HTTP ${status}, but its body names ` +
            `${bodyId === undefined ? 'no id' : JSON.stringify(bodyId)}, not ${userId}. When the Workers ` +
            'refuse the issuer a resolving identity is the pass, so an answer that does not name this user ' +
            'cannot count as one.',
        ],
      };
    }
    return {
      code: 2,
      log: [],
      error: [
        `COULD NOT LOOK: the GoTrue admin read answered HTTP ${status}, which is neither 2xx (still ` +
          'there, the expectation when the Workers refuse the issuer) nor 404 (gone). Check the ' +
          "target's SUPABASE_SERVICE_ROLE_KEY before reading this either way.",
      ],
    };
  }
  return undecided(trust);
}

/**
 * verify_purged.mjs limb B — one user-owned table's count for the delete-leg
 * user. Zero is the pass under BOTH trust answers; what a row MEANS differs.
 *
 * @param {'yes'|'no'|null} trust
 * @param {string} table
 * @param {unknown} raw  `result?.[0]?.results?.[0]?.n`, NOT yet defaulted.
 */
export function rowsVerdict(trust, table, raw) {
  if (trust === 'yes') {
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
  if (trust === 'no') {
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
          `FAIL: ${table} holds ${rows} row(s) for a delete-leg user whose issuer the Workers refuse. ` +
            'That leg stops at the one-issuer refusal before its add, so a row can only mean the Worker ' +
            'ACCEPTED a token from an issuer it does not trust — two trusted issuers, a security finding.',
        ],
      };
    }
    return { code: 0, log: [`ok  ${table}: 0 row(s)`], error: [] };
  }
  return undecided(trust);
}

/**
 * verify_purged.mjs's closing lines, once both limbs have been read.
 *
 * @param {'yes'|'no'|null} trust
 * @param {{ survived: boolean, blind: boolean }} findings
 */
export function purgedSummary(trust, { survived, blind }) {
  const alsoBlind =
    '  (Another limb of this audit also could not be read, so the damage above may be the ' +
    'smaller half of it.)';
  if (trust === 'yes') {
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
  if (trust === 'no') {
    if (survived) {
      return {
        code: 1,
        log: [],
        error: [
          'The refused delete leg found what one trusted issuer says cannot happen: the Worker refuses ' +
            "this run's session, so this user was never meant to be erased or to own a row, and the " +
            'stores disagree.',
          ...(blind ? [alsoBlind] : []),
        ],
      };
    }
    if (blind) {
      return {
        code: 2,
        log: [],
        error: [
          'This audit COULD NOT COMPLETE, so nothing above may be read as proof that the refused delete ' +
            'leg left its user untouched. Exit 2 is deliberately not 1: fix the access, then re-run.',
        ],
      };
    }
    return {
      code: 0,
      log: [
        'PASS: the refused delete leg left its user exactly as one trusted issuer predicts — the ' +
          "identity still resolves on this run's stack and every user-owned table in " +
          'subscriptiontracker_db is empty for it. [pipeline N-6 leg 6, refused issuer]',
      ],
      error: [],
    };
  }
  return undecided(trust);
}

/** Print a verdict — `log` lines to stdout, `error` lines to stderr, each in
 *  order — and hand back its exit code. The only impure export. */
export function say({ code, log = [], error = [] }) {
  for (const line of log) console.log(line);
  for (const line of error) console.error(line);
  return code;
}
