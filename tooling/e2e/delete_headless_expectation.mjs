// ─────────────────────────────────────────────────────────────────────────────
// delete_headless_expectation.mjs — WHAT tooling/e2e/delete_headless.mjs
// expects at each of its reads, as pure verdicts.
//
// ── WHY THAT STEP EXISTS, MEASURED 2026-09-26 ───────────────────────────────
// E2E live #145 (run 36220597628) was the first run after the switch to Box C,
// and its delete leg failed without reaching any Worker. The in-app dialog
// re-authenticates with `signInWithEmail` before it deletes; that is
// `token?grant_type=password`, which Box C gates with Turnstile, and a headless
// browser gets no captcha token. Box C's GoTrue answered 400 `captcha_failed`,
// the app showed "Not deleted", and the platform Worker logged 0 requests to
// /v1/account. Sign-in had already moved to the ungated `/verify` for exactly
// this reason; the delete reauth was the one other gated call on the golden
// path, and it had no equivalent.
//
// So on a captcha-gated stack the two halves split:
//   · app_test.dart's delete leg asserts the REFUSAL — "Not deleted", the
//     outcome `reauthFailed`, the session still live;
//   · delete_headless.mjs then does the erasure the browser cannot: it reads
//     that the account and its row are still there, mints the delete-leg
//     user's session through the ungated `/verify`, sends it to the deployed
//     platform Worker's DELETE /v1/account, and reads the identity and the row
//     again. verify_purged.mjs audits the result as it always has.
//
// Both halves read the SAME fact, E2E_EXPECT_CAPTCHA_GATE, so they cannot
// disagree about which of them deletes. With the gate off (the hosted project)
// the in-app leg deletes and this step must NOT run: a second deleter would
// erase the account whatever the app did, and verify_purged would pass over a
// broken in-app deletion. It refuses with exit 2 rather than trusting the
// workflow's `if:` alone.
//
// Each read answers for both values of E2E_WORKERS_TRUST, because a
// self-hosted REHEARSAL before the switch runs with trust `no`: the Worker
// must then refuse the minted session with 401 at the erasure door and the
// account must survive. That is how a rehearsal exercises this route — mint,
// DELETE, read-back — up to the one boundary it cannot cross before the switch.
//
// Exit codes, as in every e2e verifier: 0 as expected, 1 a finding, 2 could
// not look or could not decide. PURE, except that the verdicts are printed by
// `say` from auth_target_expectation.mjs. Imported, never run as a step, like
// auth_target_expectation.mjs and consent_anon_id.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { decideTrust } from './auth_target_expectation.mjs';

/** Shown value of an env read, for a refusal: never more than the value itself. */
const shown = (raw) => (raw === undefined || raw === null || raw === '' ? 'unset' : JSON.stringify(String(raw)));

/**
 * E2E_EXPECT_CAPTCHA_GATE, as this step reads it back — the same define
 * app_test.dart's delete leg branches on.
 *
 * @param {unknown} raw  `process.env.E2E_EXPECT_CAPTCHA_GATE`, exactly as read.
 * @returns {{ gate: 'yes'|'no', why: null } | { gate: null, why: string }}
 */
export function decideCaptchaGate(raw) {
  if (raw === 'yes' || raw === 'no') return { gate: raw, why: null };
  return {
    gate: null,
    why:
      `could not decide what to expect: E2E_EXPECT_CAPTCHA_GATE is ${shown(raw)}, and it must be exactly ` +
      '"yes" or "no" (e2e.yml\'s step "Derive what this run expects" writes it to $GITHUB_ENV, and ' +
      "app_test.dart's delete leg branches on the same value). Exit 2: nothing was looked at.",
  };
}

/** Why the step refuses to run when the gate is off. */
export const UNGATED_REFUSAL =
  'REFUSED: E2E_EXPECT_CAPTCHA_GATE=no. Without the captcha gate the in-app delete leg erases the account ' +
  'itself, and verify_purged.mjs audits THAT deletion. Deleting it here as well would erase it whatever the ' +
  'app did, so a broken in-app deletion would read as a pass. e2e.yml runs this step only when the gate is ' +
  'on. Exit 2: nothing was looked at, nothing was sent.';

/** The line printed once both facts are decided, before the first request. */
export function expectationLine(trust) {
  const decided = decideTrust(trust);
  if (!decided.trust) return decided.why;
  return decided.trust === 'yes'
    ? "Workers trust this run's issuer: yes — expecting the delete-leg account and the row it wrote " +
        'still present (the in-app reauth was refused at the captcha gate), DELETE /v1/account answering 200 ' +
        'to a session minted through /verify, and then the identity gone (404) and 0 rows.'
    : "Workers trust this run's issuer: no — expecting the delete-leg account present with 0 rows (the leg " +
        'stops at the one-issuer refusal before its add), DELETE /v1/account answering 401 to a session minted ' +
        'through /verify, and the account still present afterwards.';
}

/** A verdict for a trust answer this file cannot grade against. */
const undecided = (trust) => ({ code: 2, log: [], error: [decideTrust(trust).why] });

/** A count D1 really answered with, or `NaN` — never 0 by default. */
const readCount = (raw) => {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

/**
 * The platform Worker's origin, from tooling/channel-register.json — the same
 * register row deploy-workers.yml deploys to, and the default the app compiles
 * in (`AppConfig.platformBaseUrl`). Never a literal in the step.
 *
 * @param {string} registerText  the register file's text, exactly as read.
 * @returns {{ origin: string, why: null } | { origin: null, why: string }}
 */
export function platformOrigin(registerText) {
  const refuse = (because) => ({
    origin: null,
    why: `COULD NOT LOOK: ${because}, so there is no erasure door to send the request to. Exit 2: nothing was sent.`,
  });
  let register;
  try {
    register = JSON.parse(registerText);
  } catch {
    return refuse('tooling/channel-register.json is not JSON');
  }
  const envs = register?.serviceEnvironments;
  if (!Array.isArray(envs)) return refuse('tooling/channel-register.json has no serviceEnvironments[]');
  const hits = envs.filter((e) => e?.id === 'platform');
  if (hits.length !== 1) {
    return refuse(`tooling/channel-register.json declares ${hits.length} serviceEnvironments with id "platform", not exactly one`);
  }
  let url;
  try {
    url = new URL(hits[0].url);
  } catch {
    return refuse('the platform serviceEnvironment url is not a URL');
  }
  if (url.protocol !== 'https:' || url.origin !== String(hits[0].url).replace(/\/+$/, '')) {
    return refuse('the platform serviceEnvironment url is not a bare https origin');
  }
  return { origin: url.origin, why: null };
}

/**
 * Before anything is sent: the delete-leg identity must still resolve, AS THIS
 * USER. With the gate on, the dialog's reauth was refused, so nothing may have
 * erased it — whatever the trust answer.
 *
 * @param {{ status: number, ok: boolean, bodyId?: unknown, userId: string }} read
 */
export function presentVerdict({ status, ok, bodyId, userId }) {
  if (ok && bodyId === userId) {
    return {
      code: 0,
      log: [
        `PRESENT: the delete-leg identity ${userId} still resolves (GoTrue admin read → HTTP ${status}). The ` +
          'in-app reauth was refused and nothing was destroyed.',
      ],
      error: [],
    };
  }
  if (status === 404) {
    return {
      code: 1,
      log: [],
      error: [
        `FAIL: the delete-leg identity ${userId} is already GONE (GoTrue admin read → 404) before this step sent ` +
          'anything. With the captcha gate on, the in-app reauth is refused and the dialog says "Not deleted" ' +
          '(app_test.dart asserts it), so either a deletion went through past a gate that should have refused it, ' +
          'or something else erased an account nobody asked to erase. DELETE /v1/account is not sent.',
      ],
    };
  }
  return {
    code: 2,
    log: [],
    error: [
      `COULD NOT LOOK: the GoTrue admin read answered HTTP ${status}` +
        (ok ? `, naming ${bodyId === undefined ? 'no id' : JSON.stringify(bodyId)} rather than ${userId}` : '') +
        ', so this step cannot say the account it is about to delete is the delete-leg user. Check the ' +
        "target's SUPABASE_SERVICE_ROLE_KEY. DELETE /v1/account is not sent.",
    ],
  };
}

/**
 * Before anything is sent: the delete-leg user's rows in the app's rowTable
 * (tooling/e2e-leg-register.json `apps.<id>.rowTable`).
 *
 * @param {'yes'|'no'|null} trust
 * @param {unknown} raw  `result?.[0]?.results?.[0]?.n`, NOT yet defaulted.
 * @param {string} [table]  the table counted, for the printed lines.
 */
export function rowsBeforeVerdict(trust, raw, table = 'rowTable') {
  if (trust !== 'yes' && trust !== 'no') return undecided(trust);
  const n = readCount(raw);
  if (Number.isNaN(n)) {
    return {
      code: 2,
      log: [],
      error: [`COULD NOT LOOK: D1 answered the ${table} count without a readable number (${JSON.stringify(raw) ?? 'undefined'}).`],
    };
  }
  if (trust === 'yes') {
    if (n >= 1) {
      return { code: 0, log: [`PRESENT: ${n} row(s) in ${table} — the one the delete leg wrote is there to be erased.`], error: [] };
    }
    return {
      code: 1,
      log: [],
      error: [
        `FAIL: 0 rows in ${table} before the deletion. The delete leg writes one through the live Worker and ` +
          'reads it back off Home before it opens the dialog, so "0 rows" after the deletion would prove nothing.',
      ],
    };
  }
  if (n === 0) {
    return {
      code: 0,
      log: [`PRESENT: 0 rows in ${table}, as the one-issuer refusal predicts — the leg stops before its add.`],
      error: [],
    };
  }
  return {
    code: 1,
    log: [],
    error: [
      `FAIL: ${n} row(s) in ${table} for a delete-leg user whose issuer the Workers refuse. The leg stops at the ` +
        'one-issuer refusal before its add, so a row means the Worker ACCEPTED a token from an issuer it does not ' +
        'trust — two trusted issuers, a security finding.',
    ],
  };
}

/**
 * The session this step minted, before it is sent anywhere: it must be the
 * delete-leg user's. A DELETE carrying anybody else's session erases the wrong
 * account on a production auth stack, so a mismatch is never sent.
 *
 * @param {{ status: number, hasToken: boolean, sub?: unknown, userId: string }} minted
 */
export function mintedVerdict({ status, hasToken, sub, userId }) {
  if (!hasToken) {
    return {
      code: 1,
      log: [],
      error: [
        `FAIL: /verify answered HTTP ${status} with no access_token for the delete-leg user's magic link. That ` +
          'is the ungated headless route itself failing on this stack — the same one the suite signs in by — so ' +
          'nothing can be presented to the erasure door. DELETE /v1/account is not sent.',
      ],
    };
  }
  if (typeof sub !== 'string' || sub === '') {
    return {
      code: 2,
      log: [],
      error: [
        'COULD NOT LOOK: the minted access token carries no readable `sub`, so this step cannot confirm whose ' +
          'session it is holding. DELETE /v1/account is not sent.',
      ],
    };
  }
  if (sub !== userId) {
    return {
      code: 1,
      log: [],
      error: [
        `FAIL: /verify minted a session for ${sub}, not for the delete-leg user ${userId}. Sending it would ` +
          'erase the wrong account. DELETE /v1/account is not sent.',
      ],
    };
  }
  return {
    code: 0,
    log: [`MINTED: a session for ${userId} through the ungated /verify (a magic link), with no captcha involved.`],
    error: [],
  };
}

/** What each refusal of the erasure door means, by its `error` body. */
const DOOR_REFUSALS = Object.freeze({
  401: 'the Worker refuses a session minted by the issuer it is configured to trust — its SUPABASE_URL is not the register\'s, or the JWKS fetch is failing (runbooks/auth-cutover.md Phase 1)',
  403: 'reauth_required: the door judged this session\'s sign-in not recent enough (services/_shared/src/auth.ts deletionRecencyRefusal)',
  501: 'account_deletion_unconfigured: the Worker has no SUPABASE_SERVICE_ROLE_KEY or no APP_ERASURE_ENDPOINTS, and deleted nothing',
  502: 'the relay to an app Worker or the identity delete failed — rows may be gone while the login survives',
  503: 'the platform_db walk failed before anything was deleted',
});

/**
 * The erasure door's answer.
 *
 * @param {'yes'|'no'|null} trust
 * @param {{ status: number, error?: unknown }} answer  `status` 0 = no answer at all.
 */
export function eraseVerdict(trust, { status, error }) {
  if (trust !== 'yes' && trust !== 'no') return undecided(trust);
  const said = typeof error === 'string' && error !== '' ? ` (${error})` : '';
  if (status === 0) {
    return {
      code: 2,
      log: [],
      error: [
        'COULD NOT LOOK: DELETE /v1/account got no answer at all, so this step cannot say whether anything was ' +
          'erased. The reads after it say what the stores hold.',
      ],
    };
  }
  if (trust === 'yes') {
    if (status === 200) {
      return {
        code: 0,
        log: ['ERASED: DELETE /v1/account answered 200 to the minted session — ES256 on this issuer, the relay and the identity delete all ran.'],
        error: [],
      };
    }
    if (status === 202) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: DELETE /v1/account answered 202${said}: accepted and still finishing, with the identity KEPT ` +
            'until the nightly erasure retry completes. An app Worker could not be reached; the leg proves a completed ' +
            'erasure, and this is not one.',
        ],
      };
    }
    return {
      code: 1,
      log: [],
      error: [
        `FAIL: DELETE /v1/account answered ${status}${said}` +
          (DOOR_REFUSALS[status] ? `: ${DOOR_REFUSALS[status]}.` : ', a status the erasure contract does not model.') +
          ' Read the platform Worker logs for DELETE /v1/account at this time.',
      ],
    };
  }
  if (status === 401) {
    return {
      code: 0,
      log: [
        "REFUSED: DELETE /v1/account answered 401 to a session from this run's issuer, which the register does " +
          'not name. The erasure door keeps the one-issuer rule like every other door; refusal is the pass.',
      ],
      error: [],
    };
  }
  if (status === 200 || status === 202) {
    return {
      code: 1,
      log: [],
      error: [
        `FAIL: DELETE /v1/account answered ${status}${said} to a session from an issuer the Workers do not trust, ` +
          'and erased (or began erasing) an account with it. Two trusted issuers is a code path nothing in ' +
          'services/ implements and nobody decided — treat it as a security finding, not a test failure.',
      ],
    };
  }
  return {
    code: 1,
    log: [],
    error: [
      `FAIL: DELETE /v1/account answered ${status}${said}, not the one-issuer 401, to a session from an issuer ` +
        'the Workers do not trust. The door judged something other than the issuer first.',
    ],
  };
}

/**
 * After the request: the identity, read again.
 *
 * @param {'yes'|'no'|null} trust
 * @param {{ status: number, ok: boolean, bodyId?: unknown, userId: string }} read
 */
export function identityAfterVerdict(trust, { status, ok, bodyId, userId }) {
  if (trust === 'yes') {
    if (status === 404) return { code: 0, log: ['GONE: the identity is unresolvable (GoTrue admin read → 404).'], error: [] };
    if (ok) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: the identity ${userId} STILL RESOLVES (HTTP ${status}) after the erasure door answered. The ` +
            'same email and password can still sign in — the "your data is gone and your login is not" outcome.',
        ],
      };
    }
  } else if (trust === 'no') {
    if (ok && bodyId === userId) {
      return {
        code: 0,
        log: [`UNTOUCHED: the identity ${userId} still resolves (HTTP ${status}), as the one-issuer refusal predicts.`],
        error: [],
      };
    }
    if (status === 404) {
      return {
        code: 1,
        log: [],
        error: [
          `FAIL: the identity ${userId} is GONE (404) although the Workers do not trust this run's issuer. A ` +
            'session they should refuse erased an account — a security finding.',
        ],
      };
    }
  } else {
    return undecided(trust);
  }
  return {
    code: 2,
    log: [],
    error: [`COULD NOT LOOK: the GoTrue admin read after the request answered HTTP ${status}, which this step cannot grade.`],
  };
}

/**
 * After the request: the same rows. Zero under both trust answers;
 * verify_purged.mjs then walks every user-owned table the schema names.
 *
 * @param {'yes'|'no'|null} trust
 * @param {unknown} raw  `result?.[0]?.results?.[0]?.n`, NOT yet defaulted.
 * @param {string} [table]  the table counted, for the printed lines.
 */
export function rowsAfterVerdict(trust, raw, table = 'rowTable') {
  if (trust !== 'yes' && trust !== 'no') return undecided(trust);
  const n = readCount(raw);
  if (Number.isNaN(n)) {
    return {
      code: 2,
      log: [],
      error: [`COULD NOT LOOK: D1 answered the ${table} count without a readable number (${JSON.stringify(raw) ?? 'undefined'}).`],
    };
  }
  if (n === 0) return { code: 0, log: [`ok  ${table}: 0 row(s)`], error: [] };
  return {
    code: 1,
    log: [],
    error: [
      trust === 'yes'
        ? `FAIL: ${table} still holds ${n} row(s) for the erased user. The door answered and this data survived it.`
        : `FAIL: ${table} holds ${n} row(s) for a user whose issuer the Workers refuse — a security finding.`,
    ],
  };
}
