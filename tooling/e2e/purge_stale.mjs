// ─────────────────────────────────────────────────────────────────────────────
// purge_stale.mjs — SWEEPS THROWAWAY E2E USERS THAT NO always() PURGE REACHED.
//
// ⏱ 2026-10-03 — WHY IT EXISTS. E2E runs 37076032926 and 37081275953 each
// created a throwaway user, then died on `generate_link failed: HTTP 520` before
// tooling/e2e/provision_user.mjs wrote `user_id=`; both always() purges got an
// empty E2E_USER_ID and purged nothing, so two confirmed users stayed in
// production auth. provision_user.mjs now writes the id before the mint, which
// closes that path; this sweep removes what that path (or a cancelled run, a
// runner lost mid-job) already left, at the start of the next E2E run.
//
// 🔴 WHAT IT MAY SELECT — ALL OF THESE, OR THE USER IS NEVER TOUCHED:
//   · its email is EXACTLY tooling/e2e/e2e_email.mjs's E2E_SWEEPABLE_SHAPE
//     MARKED FOR E2E_APP_ID — the provisioner's own prefix, this app's id, a
//     13-digit tag, @nikatru.com, anchored at both ends. Only e2e.yml marks an
//     address (E2E_SWEEP_APP), so a store capture's user (rows in the SANDBOX
//     databases), a native-auth-proof user and another app's user are never in
//     reach: the sweep purges rows only where THIS app's e2e.yml users keep them,
//     and never deletes an identity whose rows it could not reach (PR #1177
//     review, finding 3). GoTrue's `filter` narrows the list server-side, but it
//     is a substring match and is never trusted: every row is held to the shape;
//   · its id is a UUID (it is interpolated into the DELETE path);
//   · BOTH witnesses of age — GoTrue's `created_at` and the address's own tag —
//     are older than STALE_AFTER_MS (2 h). Every job that provisions one of these
//     users times out within 60 minutes (e2e.yml, native-auth-proof.yml,
//     store-screenshots.yml), so a user that old belongs to no live run, and a
//     concurrent matrix leg's user is never in reach.
// At most SWEEP_CAP (20) users per run, oldest first. It prints COUNTS and user
// ids, never an address.
//
// Each selected user goes through the SAME per-user path the always() purge
// uses (tooling/e2e/purge_requests.mjs purgeUserTables + purgeAuthUser), against
// E2E_APP_ID's PRODUCTION database as tooling/e2e/backend.mjs resolves it — the
// database purge.mjs purges for e2e.yml. (The consent artifact purge.mjs also
// deletes is keyed by the browser profile's anon_id, not by the user, so no
// sweep can find it.) A second leg sweeping the same user concurrently is
// harmless: the D1 deletes are idempotent and the identity delete forgives 404.
//
// ⏱ 2026-10-03 — 🔴 A FAILED SWEEP NEVER FAILS THE E2E (PR #1177 review,
// finding 2). This is best-effort hygiene in front of the proof that grades
// production health; an auth 5xx, a timeout, a refusal or any throw here prints
// ONE `::warning::` with the failure count and the status (never an address)
// and exits 0, so the run goes on to provision and prove. Only the always()
// purge of THIS run's users is mandatory, and it stays so.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID,
//      CLOUDFLARE_API_TOKEN, E2E_APP_ID.
// Exit 0, always: swept, nothing to sweep, or a `::warning::` saying why not.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { e2eSweepTagMs, E2E_EMAIL_PREFIX } from './e2e_email.mjs';
import { purgeClient, purgeUserTables, purgeAuthUser, PLAIN_TABLE } from './purge_requests.mjs';
import { BackendRefused, backendOf, e2eAppOf } from './backend.mjs';
import { CredentialOriginRefused, credentialOrigin } from '../ops/credential-origin.mjs';

/** A user younger than this may belong to a run still in flight. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/** The most users one run deletes. */
export const SWEEP_CAP = 20;
export const LIST_PER_PAGE = 1000;
export const LIST_MAX_PAGES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The users a sweep for [appId] may delete, from GoTrue user objects: the ids of
 * those that pass every rule in the header, oldest first, at most `cap`.
 * `matched` counts the rows marked for [appId] at any age; `young` those of them
 * kept for age. Without an app id nothing is ever selected.
 */
export function selectStale(users, { appId, nowMs = Date.now(), staleAfterMs = STALE_AFTER_MS, cap = SWEEP_CAP } = {}) {
  const stale = [];
  let matched = 0;
  let young = 0;
  for (const u of users ?? []) {
    const tagMs = e2eSweepTagMs(u?.email, appId);
    if (tagMs === null) continue;
    if (typeof u.id !== 'string' || !UUID.test(u.id)) continue;
    matched++;
    const createdMs = typeof u.created_at === 'string' ? Date.parse(u.created_at) : NaN;
    if (!Number.isFinite(createdMs) || nowMs - createdMs <= staleAfterMs || nowMs - tagMs <= staleAfterMs) {
      young++;
      continue;
    }
    stale.push({ id: u.id, createdMs });
  }
  stale.sort((a, b) => a.createdMs - b.createdMs);
  return { ids: stale.slice(0, cap).map((s) => s.id), stale: stale.length, matched, young };
}

/**
 * Lists, selects and purges. Never throws for a request: a list that cannot be
 * read is `listFailed` with its `status` (an HTTP code or an error name, never
 * the error's text, which could quote a response holding addresses), and every
 * purge failure is counted in `failures`.
 */
export async function sweepStale(client, { appId, dbId, userTables, nowMs = Date.now(), log = console.log, warn = console.error } = {}) {
  const users = [];
  let partial = false;
  try {
    for (let page = 1; page <= LIST_MAX_PAGES; page++) {
      const rows = await client.listAuthUsers({ page, perPage: LIST_PER_PAGE, filter: E2E_EMAIL_PREFIX.replace(/\+$/, '') });
      users.push(...rows);
      if (rows.length < LIST_PER_PAGE) break;
      if (page === LIST_MAX_PAGES) partial = true;
    }
  } catch (e) {
    const status = statusOf(e);
    warn(`WARN: the stale sweep could not list auth users (${status}), so it swept nothing`);
    return { listFailed: true, status, failures: 1, purged: 0, selected: 0 };
  }
  const sel = selectStale(users, { appId, nowMs });
  log(
    `stale sweep: ${sel.matched} throwaway E2E user(s) listed, ${sel.young} younger than ${STALE_AFTER_MS / 3_600_000} h kept, ` +
      `${sel.stale} stale, ${sel.ids.length} selected (cap ${SWEEP_CAP})` +
      (partial ? `; the list stopped at ${LIST_MAX_PAGES} pages, so a later run may find more` : ''),
  );
  let failures = 0;
  let purged = 0;
  for (const id of sel.ids) {
    const f = (await purgeUserTables(client, { dbId, userTables, userId: id, log, warn })) + (await purgeAuthUser(client, id, { log, warn }));
    failures += f;
    if (f === 0) purged++;
  }
  return { listFailed: false, status: failures > 0 ? 'a purge request failed' : 'ok', failures, purged, selected: sel.ids.length };
}

/** An error's HTTP status (`HTTP 503`) when its message carries one, `no answer`
 *  for a timeout or a lost connection, else its name — never its text. */
export function statusOf(e) {
  const msg = String(e?.message ?? '');
  const m = /\bHTTP (\d{3})\b/.exec(msg);
  if (m) return `HTTP ${m[1]}`;
  if (e?.name === 'TimeoutError' || /did not answer|timed out|fetch failed/i.test(msg)) return 'no answer (a timeout or a lost connection)';
  return String(e?.name ?? 'Error');
}

/** The ONE warning a sweep that did not finish prints (GitHub annotates it). */
export function sweepWarning({ failures, status, purged = 0, selected = 0 }) {
  return (
    `::warning title=Stale E2E user sweep::the sweep did not finish (${failures} failure(s), ${status}); ` +
    `${purged} of ${selected} selected user(s) fully purged. The E2E run continues; this run's own users are still purged by its always() steps.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (e) {
    // Anything unforeseen is a warning too: the sweep never fails the E2E.
    console.log(sweepWarning({ failures: 1, status: statusOf(e) }));
  }
}

async function main() {
  // Every refusal is a warning and exit 0 (the header), and every exit is above
  // the first request (purge.mjs's header: an exit over an open undici handle
  // crashes libuv on Windows). Below the first request nothing exits; the code
  // stays 0.
  const skip = (status) => {
    console.log(sweepWarning({ failures: 1, status: `REFUSED: ${status}; nothing was sent` }));
    process.exit(0);
  };
  const need = (name) => process.env[name] || skip(`${name} is not set`);
  let supaUrl;
  try {
    supaUrl = credentialOrigin(need('SUPABASE_URL'), 'supabase');
  } catch (e) {
    if (!(e instanceof CredentialOriginRefused)) throw e;
    skip('SUPABASE_URL is not a pinned credential origin');
  }
  const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
  const acct = need('CLOUDFLARE_ACCOUNT_ID');
  const token = need('CLOUDFLARE_API_TOKEN');
  const appId = need('E2E_APP_ID');
  let dbId;
  let userTables;
  try {
    ({ appDb: dbId } = backendOf(appId, { env: 'production' }));
    ({ userTables } = e2eAppOf(appId));
  } catch (e) {
    if (!(e instanceof BackendRefused)) throw e;
    skip('E2E_APP_ID resolves to no app database');
  }
  if (userTables.some((t) => !PLAIN_TABLE.test(t))) skip('a user table is not a plain table name');

  const r = await sweepStale(purgeClient({ acct, token, supaUrl, serviceKey }), { appId, dbId, userTables });
  if (r.failures > 0) console.log(sweepWarning(r));
  else console.log(`Stale sweep complete: ${r.purged} user(s) purged.`);
}
