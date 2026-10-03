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
//   · its email is EXACTLY tooling/e2e/e2e_email.mjs's E2E_EMAIL_SHAPE — the
//     provisioner's own prefix, a 13-digit tag, @nikatru.com, anchored at both
//     ends. GoTrue's `filter` narrows the list server-side, but it is a substring
//     match and is never trusted: every row is held to the shape here;
//   · its id is a UUID (it is interpolated into the DELETE path);
//   · BOTH witnesses of age — GoTrue's `created_at` and the address's own tag —
//     are older than STALE_AFTER_MS (2 h). Every job that provisions one of these
//     users times out within 60 minutes (e2e.yml, native-auth-proof.yml,
//     store-screenshots.yml), so a user that old belongs to no live run, and a
//     concurrent matrix leg's user is never in reach.
// At most SWEEP_CAP (20) users per run, oldest first. It prints COUNTS and user
// ids, never an address.
//
// Each selected user goes through the SAME path the always() purge uses
// (tooling/e2e/purge_requests.mjs purgeUserTables + purgeAuthUser), against
// E2E_APP_ID's database as tooling/e2e/backend.mjs resolves it. A second leg
// sweeping the same user concurrently is harmless: the D1 deletes are idempotent
// and the identity delete forgives 404.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID,
//      CLOUDFLARE_API_TOKEN, E2E_APP_ID.
// Exit 0 swept (or nothing to sweep) · 1 a refusal, a list that could not be
// read, or a user that was not fully purged.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { e2eEmailTagMs, E2E_EMAIL_PREFIX } from './e2e_email.mjs';
import { purgeClient, purgeUserTables, purgeAuthUser, PLAIN_TABLE } from './purge_requests.mjs';
import { e2eTargetOrExit } from './backend.mjs';
import { CredentialOriginRefused, credentialOrigin } from '../ops/credential-origin.mjs';

/** A user younger than this may belong to a run still in flight. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
/** The most users one run deletes. */
export const SWEEP_CAP = 20;
export const LIST_PER_PAGE = 1000;
export const LIST_MAX_PAGES = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The users a sweep may delete, from GoTrue user objects: the ids of those that
 * pass every rule in the header, oldest first, at most `cap`. `matched` counts
 * the rows of the E2E shape at any age; `young` those of them kept for age.
 */
export function selectStale(users, { nowMs = Date.now(), staleAfterMs = STALE_AFTER_MS, cap = SWEEP_CAP } = {}) {
  const stale = [];
  let matched = 0;
  let young = 0;
  for (const u of users ?? []) {
    const tagMs = e2eEmailTagMs(u?.email);
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
 * read is `listFailed`, and every purge failure is counted in `failures`.
 */
export async function sweepStale(client, { dbId, userTables, nowMs = Date.now(), log = console.log, warn = console.error } = {}) {
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
    warn(`WARN: the stale sweep could not list auth users, so it swept nothing: ${e.message}`);
    return { listFailed: true, failures: 1, purged: 0, selected: 0 };
  }
  const sel = selectStale(users, { nowMs });
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
  return { listFailed: false, failures, purged, selected: sel.ids.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const need = (name) => {
    const v = process.env[name];
    if (!v) {
      console.error(`Missing required env var: ${name}`);
      process.exit(1);
    }
    return v;
  };
  // Every exit is above the first request (purge.mjs's header: an exit over an
  // open undici handle crashes libuv on Windows and reports 127).
  let supaUrl;
  try {
    supaUrl = credentialOrigin(need('SUPABASE_URL'), 'supabase');
  } catch (e) {
    if (!(e instanceof CredentialOriginRefused)) throw e;
    console.error(`SUPABASE_URL: ${e.message}. Exit 1: nothing was sent.`);
    process.exit(1);
  }
  const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
  const acct = need('CLOUDFLARE_ACCOUNT_ID');
  const token = need('CLOUDFLARE_API_TOKEN');
  const { appDb: dbId, userTables } = e2eTargetOrExit(need('E2E_APP_ID'), { env: 'production', code: 1, prefix: 'REFUSED' });
  const bad = userTables.filter((t) => !PLAIN_TABLE.test(t));
  if (bad.length > 0) {
    console.error(`REFUSED: ${JSON.stringify(bad)} is not a plain table name. Nothing was swept.`);
    process.exit(1);
  }

  const client = purgeClient({ acct, token, supaUrl, serviceKey });
  const r = await sweepStale(client, { dbId, userTables });
  if (r.failures > 0) {
    console.error(`Stale sweep finished with ${r.failures} failure(s); ${r.purged} of ${r.selected} selected user(s) fully purged.`);
    process.exitCode = 1;
  } else {
    console.log(`Stale sweep complete: ${r.purged} user(s) purged.`);
  }
}
