// ─────────────────────────────────────────────────────────────────────────────
// delete_headless.mjs — golden-path leg 6's ERASURE on a captcha-gated stack,
// done the way a headless run can: through the ungated `/verify`, not the
// Turnstile-gated password grant the in-app dialog re-authenticates with.
// Node 20+ global fetch only, no SDK.
//
// Why it exists, and why the in-app leg now asserts a refusal instead, is the
// header of tooling/e2e/delete_headless_expectation.mjs (every verdict line
// lives there). In order, it:
//
//   1. reads the delete-leg identity (GoTrue admin API) and its subscription
//      rows (live D1) — the app's reauth was refused, so both must still be
//      there. Nothing is sent unless the identity resolves AS THIS USER.
//   2. mints that user's session: `admin/generate_link` (magiclink) then
//      `/verify` with the ANON key, the route the suite signs in by. The
//      driver's own token is single use and already spent; generate_link is
//      not. The token's `sub` must be this user, or nothing is sent.
//   3. sends DELETE {platform}/v1/account with it — the same deployed door the
//      app calls: ES256 on this issuer, the relay to the app Worker, the
//      identity delete last.
//   4. reads the identity and the rows again. verify_purged.mjs, the next step,
//      then audits every user-owned table the schema names.
//
// With E2E_WORKERS_TRUST=no (a self-hosted rehearsal before the switch) the same
// four reads expect the one-issuer refusal: 401 at the door, the account
// untouched.
//
// 🔴 `process.exit()` ONLY BEFORE THE FIRST fetch — the refusals at the top.
// Below it, `process.exitCode` and return: exiting over an open undici handle
// crashes libuv on Windows and reports 127 (verify_purged.mjs's header).
//
// Env: E2E_EXPECT_CAPTCHA_GATE, E2E_WORKERS_TRUST (both from e2e.yml's step
//      "Derive what this run expects"), SUPABASE_URL, SUPABASE_ANON_KEY,
//      SUPABASE_SERVICE_ROLE_KEY, E2E_DELETE_EMAIL, E2E_DELETE_USER_ID,
//      CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, SUBSCRIPTIONTRACKER_D1_DATABASE_ID.
// Argv: --register <path> overrides tooling/channel-register.json (tests).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideTrust, say } from './auth_target_expectation.mjs';
import {
  UNGATED_REFUSAL,
  decideCaptchaGate,
  eraseVerdict,
  expectationLine,
  identityAfterVerdict,
  mintedVerdict,
  platformOrigin,
  presentVerdict,
  rowsAfterVerdict,
  rowsBeforeVerdict,
} from './delete_headless_expectation.mjs';

/** The door this step sends the minted session to. Named as a value because
 *  tooling/ci/assert-e2e-legs.mjs reads this harness comment-stripped. */
const ERASURE_ROUTE = '/v1/account';

// ── the refusals, all before any request ────────────────────────────────────
const gate = decideCaptchaGate(process.env.E2E_EXPECT_CAPTCHA_GATE);
if (!gate.gate) {
  console.error(gate.why);
  process.exit(2);
}
if (gate.gate !== 'yes') {
  console.error(UNGATED_REFUSAL);
  process.exit(2);
}
const auth = decideTrust(process.env.E2E_WORKERS_TRUST);
if (!auth.trust) {
  console.error(`COULD NOT LOOK: ${auth.why}`);
  process.exit(2);
}

const supaUrl = need('SUPABASE_URL').replace(/\/+$/, '');
const anonKey = need('SUPABASE_ANON_KEY');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const email = need('E2E_DELETE_EMAIL');
const userId = need('E2E_DELETE_USER_ID');
const acct = need('CLOUDFLARE_ACCOUNT_ID');
const cfToken = need('CLOUDFLARE_API_TOKEN');
const dbId = need('SUBSCRIPTIONTRACKER_D1_DATABASE_ID');

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = process.argv.indexOf('--register');
const registerPath = at === -1 ? join(REPO, 'tooling', 'channel-register.json') : resolve(process.argv[at + 1] ?? '');
let registerText = '';
try {
  registerText = readFileSync(registerPath, 'utf8');
} catch (e) {
  console.error(`COULD NOT LOOK: the channel register could not be read (${e.code ?? e.name}). Exit 2: nothing was sent.`);
  process.exit(2);
}
const platform = platformOrigin(registerText);
if (!platform.origin) {
  console.error(platform.why);
  process.exit(2);
}

console.log(expectationLine(auth.trust));

// 1 BEATS 2, as in verify_purged.mjs: a finding must not be buried under a
// read that could not be taken. Both fail the step.
let finding = false;
let blind = false;
const worse = (code) => {
  if (code === 1) finding = true;
  else if (code === 2) blind = true;
};

await run();
if (finding) console.error('The headless deletion leg found what it must not. The lines above say which read.');
else if (blind) console.error('The headless deletion leg COULD NOT COMPLETE; nothing above is proof either way.');
else console.log(`PASS: the headless deletion leg ran as E2E_WORKERS_TRUST=${auth.trust} predicts. [pipeline N-6 leg 6]`);
process.exitCode = finding ? 1 : blind ? 2 : 0;

async function run() {
  // ── 1 · still there ──────────────────────────────────────────────────────
  const before = await identity();
  if (before === null) {
    worse(2);
    return;
  }
  const present = say(presentVerdict({ ...before, userId }));
  worse(present);
  const rows = await subscriptionCount();
  worse(rows === null ? 2 : say(rowsBeforeVerdict(auth.trust, rows)));
  if (present !== 0) return;

  // ── 2 · a session for exactly this user, through the ungated route ───────
  const minted = await mint();
  if (minted === null) {
    worse(2);
    return;
  }
  const mintedCode = say(mintedVerdict({ ...minted, userId }));
  worse(mintedCode);
  if (mintedCode !== 0) return;

  // ── 3 · the erasure door ─────────────────────────────────────────────────
  let status = 0;
  let error;
  try {
    const res = await fetch(`${platform.origin}${ERASURE_ROUTE}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${minted.token}` },
    });
    status = res.status;
    try {
      error = (await res.json())?.error;
    } catch {
      error = undefined;
    }
  } catch (e) {
    console.error(`DELETE ${platform.origin}${ERASURE_ROUTE} did not complete (${e.name}).`);
  }
  console.log(`DELETE ${platform.origin}${ERASURE_ROUTE} -> HTTP ${status}`);
  worse(say(eraseVerdict(auth.trust, { status, error })));

  // ── 4 · read again ───────────────────────────────────────────────────────
  const after = await identity();
  worse(after === null ? 2 : say(identityAfterVerdict(auth.trust, { ...after, userId })));
  const rowsAfter = await subscriptionCount();
  worse(rowsAfter === null ? 2 : say(rowsAfterVerdict(auth.trust, rowsAfter)));
}

/** The GoTrue admin read of the delete-leg user, or null after saying why. */
async function identity() {
  let res;
  try {
    res = await fetch(`${supaUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
  } catch (e) {
    console.error(`COULD NOT LOOK: the GoTrue admin API was unreachable (${e.name}).`);
    return null;
  }
  let bodyId;
  if (res.ok) {
    try {
      bodyId = (await res.json())?.id;
    } catch {
      bodyId = undefined;
    }
  }
  return { status: res.status, ok: res.ok, bodyId };
}

/** A fresh magic-link session for the delete-leg user: `{ status, hasToken,
 *  token, sub }`, or null when the admin route itself could not be used. */
async function mint() {
  let linkRes;
  try {
    linkRes = await fetch(`${supaUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({ type: 'magiclink', email }),
    });
  } catch (e) {
    console.error(`COULD NOT LOOK: admin/generate_link was unreachable (${e.name}).`);
    return null;
  }
  const tokenHash = linkRes.ok ? (await linkRes.json().catch(() => null))?.hashed_token : undefined;
  if (!tokenHash) {
    console.error(`COULD NOT LOOK: admin/generate_link answered HTTP ${linkRes.status} with no hashed_token.`);
    return null;
  }
  console.log(`::add-mask::${tokenHash}`);
  let verifyRes;
  try {
    verifyRes = await fetch(`${supaUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
    });
  } catch (e) {
    console.error(`COULD NOT LOOK: /verify was unreachable (${e.name}).`);
    return null;
  }
  const session = verifyRes.ok ? await verifyRes.json().catch(() => null) : null;
  const token = typeof session?.access_token === 'string' ? session.access_token : '';
  if (token) console.log(`::add-mask::${token}`);
  return { status: verifyRes.status, hasToken: token !== '', token, sub: subjectOf(token) };
}

/** The `sub` claim of an access token, read without a signature check (the
 *  Worker does that) and only to compare. Undefined when unreadable. */
function subjectOf(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.sub === 'string' ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

/** The delete-leg user's subscription rows AS D1 ANSWERED — not yet a number,
 *  because whether a missing count may stand for 0 is the verdict's call.
 *  `null` = the read failed (already said why). */
async function subscriptionCount() {
  let res;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbId}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfToken}` },
      body: JSON.stringify({ sql: 'SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?', params: [userId] }),
    });
  } catch (e) {
    console.error(`COULD NOT LOOK: the D1 HTTP API was unreachable (${e.name}).`);
    return null;
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    console.error(`COULD NOT LOOK: D1 query failed — HTTP ${res.status} ${JSON.stringify(json?.errors ?? null)}`);
    return null;
  }
  // `?? undefined`: a JSON null count is an unread count, not the failed read.
  return json.result?.[0]?.results?.[0]?.n ?? undefined;
}

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`COULD NOT LOOK: missing required env var ${name}. Exit 2: nothing was sent.`);
    process.exit(2); // safe: every need() runs BEFORE the first fetch
  }
  return v;
}
