// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/account/export — the DPDP access request answered at once (lane
// dpdp-rights, Do 3; O-SERVER-DATA-EXPORT-MISSING): everything this platform
// holds SERVER-SIDE about the signed-in person, as ONE JSON file. The nominee
// routes are routes/account-nominee.ts.
//
// It sits behind `platformAuth` (src/index.ts mounts it on /v1/account/*),
// so the subject is the verified session's `sub`: no new identifier is collected
// to prove who is asking. It is bounded per person by EVENTS_LIMITER, keyed
// `privacy:<sub>`, as the reminders route is.
//
// ── THE EXPORT IS DERIVED, NOT LISTED ────────────────────────────────────────
// Its tables are the ERASURE WALK's (services/_shared/src/erasure.ts
// `exportUserRows`): every table carrying a `user_id` column, in platform_db and
// in every app database this Worker binds (generated/app-targets.ts APP_TARGETS).
// A table added with a `user_id` is exported by its own migration, exactly as it
// is erased. tooling/legal/data-inventory.json names this file as the READER of
// every store it reaches, and tooling/ci/assert-data-inventory.mjs fails a
// personal-data row that names no reader. test/account-data.test.ts seeds a row
// into every inventory store this file reads and fails if one is missing.
//
// The three pseudonymous stores (consent_artifacts, events, events_daily) are keyed on the
// INSTALL id and nothing maps it to an account ([ADR 020]). The app holds that id
// and passes it as `?anon_id=`, so those rows come with the export when the
// device asking is the device they describe.
//
// 🔒 A CREDENTIAL IS NEVER EXPORTED. A column whose name says it holds a hash, a
// token, a secret or a ciphertext is replaced by WITHHELD: the export is what we
// hold ABOUT the person, and a credential is not that.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { exportUserRows } from '../../../_shared/src/erasure';
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { allRows, nowIso } from '../lib/d1';
import { withinRateLimit } from '../lib/edge-ceiling';
import { APP_TARGETS } from '../generated/app-targets';
import type { AppEnv, Env } from '../types';

const accountExport = new Hono<AppEnv>();

export const EXPORT_SCHEMA = 'nikatru.data-export/1';
export const WITHHELD = 'WITHHELD: a credential, never exported';
export const EXPORT_NOTE =
  'Everything Nikatru holds on its servers about this account (and this install, when named). What the app keeps on your device is not here: it is already with you. Payment details are held by the store or payment provider, never by us.';

const CREDENTIAL = /(_hash$|^hash$|token|secret|ciphertext|salt)/i;
const ANON_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Each row with every credential-shaped column withheld. */
export function redact(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, CREDENTIAL.test(k) && v !== null ? WITHHELD : v])));
}

/** Every store's rows for `userId` (and the install `anonId`, when given), keyed `<db>.<table>`. */
export async function exportStores(env: Env, userId: string, anonId: string | null): Promise<Record<string, Array<Record<string, unknown>>>> {
  const stores: Record<string, Array<Record<string, unknown>>> = {};
  const add = (db: string, tables: Record<string, Array<Record<string, unknown>>>) => {
    for (const [t, rows] of Object.entries(tables)) stores[`${db}.${t}`] = redact(rows);
  };
  add('platform_db', await exportUserRows(env.PLATFORM_DB, userId));
  for (const t of APP_TARGETS) {
    const db = (env as unknown as Record<string, SqlDb | undefined>)[t.dbBinding];
    if (db) add(t.databaseName, await exportUserRows(db, userId));
  }
  if (anonId !== null) {
    stores['platform_db.consent_artifacts'] = redact(
      await allRows(env.PLATFORM_DB.prepare('SELECT * FROM consent_artifacts WHERE anon_id = ? ORDER BY rowid').bind(anonId)),
    );
    stores['platform_db.events_daily'] = redact(
      await allRows(env.PLATFORM_DB.prepare('SELECT * FROM events_daily WHERE anon_id = ? ORDER BY day LIMIT 10000').bind(anonId)),
    );
    stores['platform_db.events'] = redact(
      await allRows(env.PLATFORM_DB.prepare('SELECT * FROM events WHERE anon_id = ? ORDER BY rowid LIMIT 10000').bind(anonId)),
    );
  }
  return stores;
}

accountExport.get('/account/export', async (c) => {
  const userId = c.get('userId');
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `privacy:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
  const anon = c.req.query('anon_id');
  if (anon !== undefined && !ANON_ID.test(anon)) return c.json({ error: 'invalid', field: 'anon_id' }, 422);
  const stores = await exportStores(c.env, userId, anon ?? null);
  console.log(`[account-export] rid=${c.get('requestId') ?? '-'} stores=${Object.keys(stores).length}`);
  return c.json(
    { schema: EXPORT_SCHEMA, generatedAt: nowIso(), subject: userId, install: anon ?? null, note: EXPORT_NOTE, stores },
    200,
    { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="nikatru-data-export.json"' },
  );
});

export default accountExport;
