// ─────────────────────────────────────────────────────────────────────────────
// The nominee (lane dpdp-rights, Do 4; DPDP Act s.14): the ONE person an account
// holder names to exercise their rights if they die or become incapacitated. A
// name and an e-mail address, nothing more; the nominee is told only when they
// act, and the erasure walk deletes the row with the account (`user_id`).
//
//   GET    /v1/account/nominee   { nominee: { name, email, updatedAt } | null }
//   PUT    /v1/account/nominee   { name, email } — set or replace it
//   DELETE /v1/account/nominee   remove it (204)
//
// Behind `platformAuth` (src/index.ts mounts it on /v1/account/*), so the subject
// is the verified session's `sub`; bounded per person by EVENTS_LIMITER, keyed
// `privacy:<sub>`. Every status is a literal, so the wire pin
// (tooling/ci/assert-analytics-contract.mjs) reads the whole set.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { firstRow, nowIso, run } from '../lib/d1';
import { readBoundedBody } from '../lib/body';
import { withinRateLimit } from '../lib/edge-ceiling';
import type { AppEnv } from '../types';

const accountNominee = new Hono<AppEnv>();

/** @ceiling none — a request-shape bound: a nominee is a name and an address. */
export const NOMINEE_MAX_BYTES = 1_024;
/** @ceiling none — the longest nominee name accepted, a request-shape bound. */
export const NOMINEE_NAME_MAX = 120;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/;

/** A nominee body — a name and an address, nothing more — or null. */
export function parseNominee(v: unknown): { name: string; email: string } | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== 'name' && k !== 'email')) return null;
  if (typeof o.name !== 'string' || typeof o.email !== 'string') return null;
  const name = o.name.trim();
  const email = o.email.trim().toLowerCase();
  if (name === '' || [...name].length > NOMINEE_NAME_MAX || !EMAIL.test(email)) return null;
  return { name, email };
}

accountNominee.get('/account/nominee', async (c) => {
  const userId = c.get('userId');
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `privacy:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
  const row = await firstRow<{ name: string; email: string; updated_at: string }>(
    c.env.PLATFORM_DB.prepare('SELECT name, email, updated_at FROM privacy_nominees WHERE user_id = ?').bind(userId),
  );
  return c.json({ nominee: row ? { name: row.name, email: row.email, updatedAt: row.updated_at } : null }, 200, { 'Cache-Control': 'no-store' });
});

accountNominee.put('/account/nominee', async (c) => {
  const userId = c.get('userId');
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `privacy:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
  const body = await readBoundedBody(c.req.raw, NOMINEE_MAX_BYTES);
  if (!body.ok) return body.status === 413 ? c.json({ error: body.error }, 413) : c.json({ error: body.error }, 400);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }
  const n = parseNominee(json);
  if (n === null) return c.json({ error: 'invalid' }, 422);
  const at = nowIso();
  await run(
    c.env.PLATFORM_DB.prepare(
      'INSERT INTO privacy_nominees (user_id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, email = excluded.email, updated_at = excluded.updated_at',
    ).bind(userId, n.name, n.email, at, at),
  );
  return c.json({ nominee: { name: n.name, email: n.email, updatedAt: at } }, 200);
});

accountNominee.delete('/account/nominee', async (c) => {
  const userId = c.get('userId');
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `privacy:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
  await run(c.env.PLATFORM_DB.prepare('DELETE FROM privacy_nominees WHERE user_id = ?').bind(userId));
  return c.body(null, 204);
});

export default accountNominee;
