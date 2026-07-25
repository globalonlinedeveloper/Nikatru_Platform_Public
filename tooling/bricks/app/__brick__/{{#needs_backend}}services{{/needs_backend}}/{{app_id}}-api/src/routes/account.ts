import { Hono } from 'hono';
import type { AppEnv } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// G2 — in-app account deletion (server side). DELETE /v1/account purges every
// row this user owns from the app database, plus their shared-platform
// entitlements, then returns what was deleted. The client (Settings → Delete
// account) calls this, then signs the user out of Supabase.
//
// EXTEND THIS per app: add every user-owned APP_DB table to `appTables`.
// Missing a table here = orphaned PII after "delete my account".
// ─────────────────────────────────────────────────────────────────────────────
const account = new Hono<AppEnv>();

account.delete('/', async (c) => {
  const userId = c.get('userId');
  const deleted: Record<string, number> = {};

  // App-owned data (APP_DB). One entry per user-owned table.
  const appTables = ['records'];
  for (const table of appTables) {
    const res = await c.env.APP_DB.prepare(
      `DELETE FROM ${table} WHERE user_id = ?`,
    )
      .bind(userId)
      .run();
    deleted[table] = res.meta.changes ?? 0;
  }

  // Shared entitlements (PLATFORM_DB). Best-effort: the table may not exist in a
  // fresh platform database, so a failure here must not block the deletion.
  try {
    const res = await c.env.PLATFORM_DB.prepare(
      'DELETE FROM entitlements WHERE user_id = ?',
    )
      .bind(userId)
      .run();
    deleted['entitlements'] = res.meta.changes ?? 0;
  } catch {
    deleted['entitlements'] = 0;
  }

  return c.json({ ok: true, deleted });
});

export default account;
