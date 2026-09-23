// Asserts the ONE-ISSUER fact, in whichever direction this run's auth target
// makes it true — positively, on every run, rather than as a leg that gets
// skipped when the answer would be inconvenient.
//
// ── THE FACT
//
// `runbooks/auth-cutover.md` Phase 5: "every hosted-minted session 401s
// portfolio-wide. There is no dual-issuer path in the code — the Workers trust
// exactly one issuer." Today that issuer is the HOSTED Supabase project, so:
//
//   hosted → a token this run minted is ACCEPTED by the deployed Worker (200).
//   boxa   → the same request with a BOX A-minted token is REFUSED (401).
//
// Both are things that must be true. Writing only the first would leave the
// second as a comment; writing only the second would leave it unexercised until
// the day it matters. Writing both means the day the Workers gain a second
// issuer — or lose the first — this step names it in one line instead of six
// golden-path screenshots ending at a blank page.
//
// ⚠️ THIS IS NOT THE CUTOVER. Nothing here changes a Worker, a secret or KV.
// It reads what the deployed Worker already does with a token it is handed.
//
// ── HOW IT GETS A TOKEN WITHOUT SPENDING THE DRIVER'S
//
// `provision_user.mjs` mints ONE single-use magic-link token per user and the
// browser spends it; a replay returns 403 (measured against Box A 2026-09-04).
// So this step mints its OWN, from the same admin route, for the same already
// provisioned throwaway user — `admin/generate_link` is not single-use, the
// TOKEN it returns is. `/verify` is not captcha-gated on either target
// (auth-cutover.md §4.7), which is why this works against Box A at all.
//
// ── AND THE SECOND READING: THE `iss` CLAIM, COMPARED RATHER THAN PRINTED
//
// Until 2026-09-22 this step printed `token issuer: the Box A auth stack` — a
// FIXED STRING assembled from the target, not a claim read out of the token. So
// no run had ever read the live `iss` back, and O-PHASE5-ISSUER-SUFFIX (the
// suffix on Box A's GOTRUE_JWT_ISSUER) stayed open with nothing to close it on:
// runbooks/auth-cutover.md records that /settings and /health both answer 401,
// which leaves the token itself as the only place the value can be read from.
//
// 🔴 AND THE VALUE CANNOT BE PRINTED. `BOXA_SUPABASE_URL` and `SUPABASE_URL` are
// repository SECRETS, so Actions masks them in every log line: a raw `iss`
// printed here reads `***/auth/v1`, and run 35704944906 shows the same mask on
// `GET ***/v1/subscriptions -> HTTP 401`. Evidence that survives a mask is a
// COMPARISON or a PATH, never a value — so this step prints the `iss` PATH and
// two yes/no lines, each computed in-process where the unmasked value still is.
//
// ⚠️ THEY REPORT; THEY DO NOT JUDGE. A "no" on either line does NOT fail the
// step: the 401-on-boxa / 200-on-hosted verdict below is the assertion, and it is
// unchanged. A wrong issuer suffix is exactly what this row expects to find, and
// a red run that hides its own reading behind a failure would be worth less than
// the reading. The one thing that DOES fail is a token that cannot be read at
// all — see `readIssuerBack`'s `# why:`.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, E2E_EMAIL,
//      API_BASE_URL, E2E_AUTH_TARGET (default `hosted`).

const url = need('SUPABASE_URL').replace(/\/+$/, '');
const anonKey = need('SUPABASE_ANON_KEY');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const email = need('E2E_EMAIL');
const apiBase = need('API_BASE_URL').replace(/\/+$/, '');
const target = process.env.E2E_AUTH_TARGET || 'hosted';

if (target !== 'hosted' && target !== 'boxa') {
  console.error(`E2E_AUTH_TARGET must be "hosted" or "boxa", not "${target}".`);
  process.exitCode = 1;
} else {
  const linkRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!linkRes.ok) {
    console.error(`generate_link failed: HTTP ${linkRes.status}`);
    process.exitCode = 1;
  } else {
    const link = await linkRes.json();
    const tokenHash = link.hashed_token;
    if (!tokenHash) {
      console.error(
        `No hashed_token in generate_link response (keys: ${Object.keys(link).sort().join(', ')})`,
      );
      process.exitCode = 1;
    } else {
      console.log(`::add-mask::${tokenHash}`);
      const verifyRes = await fetch(`${url}/auth/v1/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: anonKey },
        body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
      });
      const session = verifyRes.ok ? await verifyRes.json() : null;
      const accessToken = session?.access_token ?? '';
      if (!accessToken) {
        console.error(
          `::error title=Could not mint a session::/verify answered HTTP ${verifyRes.status} with no ` +
            'access_token, so nothing could be presented to the Worker. On boxa this is the ' +
            'magic-link login path itself failing, which is a bigger finding than the one-issuer check.',
        );
        process.exitCode = 1;
      } else {
        console.log(`::add-mask::${accessToken}`);
        const probe = await fetch(`${apiBase}/v1/subscriptions`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        console.log(`auth target : ${target}`);
        console.log(`token issuer: the ${target === 'boxa' ? 'Box A' : 'hosted'} auth stack`);
        readIssuerBack(accessToken, url);
        console.log(`GET ${apiBase}/v1/subscriptions -> HTTP ${probe.status}`);

        if (target === 'hosted') {
          if (probe.status === 200) {
            console.log(
              'ASSERTED: the deployed Worker accepts a hosted-minted session. The one issuer the ' +
                'Workers trust is still the hosted project, which is what Phase 5 moves.',
            );
          } else {
            console.error(
              `::error title=One-issuer check::the Worker answered ${probe.status} to a token minted ` +
                'by the auth project it is configured for. Either SUPABASE_URL on the Workers has ' +
                'moved, or the JWKS fetch is failing — see runbooks/auth-cutover.md Phase 1.',
            );
            process.exitCode = 1;
          }
        } else if (probe.status === 401) {
          console.log(
            'ASSERTED: the deployed Worker REFUSES a Box A-minted session with 401. This is the ' +
              'one-issuer fact, and it is why the golden-path legs below cannot pass against boxa ' +
              'until Phase 5 moves SUPABASE_URL on both Workers. Refusal here is the PASS.',
          );
        } else {
          console.error(
            `::error title=One-issuer check::the Worker answered ${probe.status}, not 401, to a Box ` +
              'A-minted session. If it answered 200 the Workers now trust TWO issuers, which no code ' +
              'path in services/ implements and which nobody decided — treat it as a security ' +
              'finding, not a test failure.',
          );
          process.exitCode = 1;
        }
      }
    }
  }
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

/** `new URL(value)` or null. An `iss` that is not a URL is a READING — the box
 *  minting a bare name instead of an origin is a finding worth printing — so it
 *  must not throw its way out of a step whose subject is the HTTP answer above. */
function asUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Reads ONE claim — `iss` — out of the access token this run just minted, and
 *  prints the three lines that survive Actions' masking. No signature check: the
 *  deployed Worker does that, and what the Worker did with this exact token is
 *  asserted above. Nothing else from the payload is read, printed or kept.
 *
 *  # why: exit 2, not 1, when the token cannot be read back. In this file exit 1
 *  means THE ONE-ISSUER FACT IS WRONG — a hosted-minted token refused, or a Box
 *  A-minted token accepted — which is a finding about the deployed Workers. A
 *  token that does not decode says nothing at all about the Workers: it says
 *  this step could not take its reading. That is the distinction Public #869
 *  drew when verify_row, verify_purged and verify_consent were given exit 2 for
 *  "could not decide what to expect" (tooling/e2e/auth_target_expectation.mjs).
 *  The step fails on both codes, so an unreadable token can never print as a
 *  pass; the code says which of the two happened. If the assertion below also
 *  fails it overwrites this 2 with its 1, deliberately: the finding about the
 *  live Workers outranks the failure to read a claim.
 *
 *  # why: `process.exitCode`, never `process.exit(2)`. The sibling verifiers may
 *  exit outright because they refuse BEFORE their first request; by here undici
 *  has already driven three, and an immediate exit can cut off the very lines
 *  this function exists to leave in the log.
 */
function readIssuerBack(token, supabaseUrl) {
  const expected = `${supabaseUrl}/auth/v1`;
  const refuse = (missing) => {
    console.error(
      `::error title=Issuer readback::${missing}. The one-issuer verdict below still stands — it is ` +
        'about what the Worker did with this token — but the `iss` claim could not be read, so this ' +
        'run records no issuer reading at all, which is the one thing it was extended to produce.',
    );
    process.exitCode = 2;
  };

  const parts = token.split('.');
  if (parts.length !== 3) {
    refuse(`the access token is not three dot-separated segments (it has ${parts.length})`);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (err) {
    // The CLASS of the error, never its message: a JSON.parse message quotes the
    // input it choked on, and the input here IS the decoded payload segment.
    refuse(`the payload segment did not decode to JSON (${err.name})`);
    return;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    refuse('the payload segment decoded to JSON that is not an object');
    return;
  }
  if (typeof payload.iss !== 'string' || payload.iss === '') {
    refuse('the decoded payload carries no `iss` claim');
    return;
  }

  const iss = asUrl(payload.iss);
  const mine = asUrl(supabaseUrl);
  console.log(`iss path    : ${iss ? iss.pathname : '(the iss claim is not a URL)'}`);
  console.log(`iss host equals SUPABASE_URL host: ${iss && mine && iss.host === mine.host ? 'yes' : 'no'}`);
  console.log(`iss equals SUPABASE_URL + /auth/v1: ${payload.iss === expected ? 'yes' : 'no'}`);
  if (payload.iss !== expected) {
    console.log(
      'READ BACK, NOT ASSERTED: this stack mints an issuer that is not byte-for-byte ' +
        '${SUPABASE_URL}/auth/v1, which is the single string services/_shared/src/auth.ts builds its ' +
        'JWKS check from. The comparison lines above are the evidence; the value itself is a ' +
        'repository secret and would print masked. O-PHASE5-ISSUER-SUFFIX: the fix is GOTRUE_JWT_ISSUER ' +
        'on the box, applied in the owner window (C-BOXA-SUPABASE-ONLY), never by this step.',
    );
  }
}
