// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/ops/feedback/move — the ONE way a report's status moves, apart from
// the cron's own fixed -> notified (lane feedback-triage, Do 3).
//
// THE CALLER is tooling/feedback/move.mjs on the lead's laptop, run after the
// lead accepts a triage proposal. The triage routine itself never holds this
// secret: it proposes, the lead moves (docs/ops/feedback-triage.md).
//
// 🔴 AUTHENTICATED BY ONE SECRET, FEEDBACK_OPS_SECRET (`wrangler secret put`),
// compared over SHA-256 digests with `timingSafeEqual`, as POST
// /v1/ops/box-manifest compares its box secrets. Not configured ⇒ 503 before
// the body is read. NO CORS: middleware/cors.ts refuses `Origin` on `/v1/ops/`.
//
//   { "id": "FB-…", "to": "in-fix", "pr": 1234 }
//   { "id": "FB-…", "to": "fixed", "version": "1.4.1" }
//   { "id": "FB-…", "to": "duplicate", "duplicateOf": "FB-…" }
//
// A move lib/lifecycle.ts does not list is 409 `illegal_move` and writes
// nothing; `notified` is 409 `cron_only`. The UPDATE is conditional on the
// status the move was checked against, so two movers racing cannot both win.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { bearer } from '../../../_shared/src/auth';
import { isPlainObject } from '../../../_shared/src/validate';
import { readBoundedBody } from '../lib/body';
import { firstRow, nowIso, run } from '../lib/d1';
import { appendHistory, checkMove, isStatus, REPORT_ID, type MoveRequest } from '../feedback/lifecycle';
import { closedPurgeAt, isPrivacyStatus, PRIVACY_ID, PRIVACY_MOVES } from '../feedback/privacy';
import type { AppEnv } from '../types';

const ops = new Hono<AppEnv>();

/** @ceiling none — a request-shape bound: one move is a few short fields. */
export const MOVE_MAX_BYTES = 1_024;

const MOVE_KEYS = new Set(['id', 'to', 'duplicateOf', 'pr', 'version']);

/** Constant-time equality of two secrets, over their SHA-256 digests. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(a), new Uint8Array(b));
}

/** The move body, validated for shape (the lifecycle checks the rest), or null. */
export function parseMove(v: unknown): MoveRequest | null {
  if (!isPlainObject(v)) return null;
  if (Object.keys(v).some((k) => !MOVE_KEYS.has(k))) return null;
  const { id, to, duplicateOf, pr, version } = v as Record<string, unknown>;
  if (typeof id !== 'string' || !REPORT_ID.test(id) || !isStatus(to)) return null;
  if (duplicateOf !== undefined && typeof duplicateOf !== 'string') return null;
  if (pr !== undefined && typeof pr !== 'number') return null;
  if (version !== undefined && typeof version !== 'string') return null;
  return { id, to, duplicateOf, pr, version } as MoveRequest;
}

ops.post('/move', async (c) => {
  const secret = c.env.FEEDBACK_OPS_SECRET;
  if (!secret) return c.json({ error: 'not_configured' }, 503);
  const token = bearer(c.req.header('Authorization') ?? '');
  if (token === null || !(await sameSecret(token, secret))) return c.json({ error: 'unauthorized' }, 401);

  const body = await readBoundedBody(c.req.raw, MOVE_MAX_BYTES);
  if (!body.ok) return c.json({ error: body.error }, body.status);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return c.json({ error: 'bad_json' }, 400);
  }
  // ⏱ 2026-10-03 · lane dpdp-rights: a rights request (PR-…) moves through its own
  // graph, feedback/privacy.ts PRIVACY_MOVES: new -> acknowledged -> resolved |
  // refused. Only here, only by the lead; nothing automatic closes one.
  const raw = json as Record<string, unknown> | null;
  if (raw !== null && typeof raw === 'object' && typeof raw.id === 'string' && PRIVACY_ID.test(raw.id)) {
    if (Object.keys(raw).some((k) => k !== 'id' && k !== 'to') || !isPrivacyStatus(raw.to)) return c.json({ error: 'invalid' }, 422);
    const to = raw.to;
    const pr = await firstRow<{ status: string; status_history: string | null }>(
      c.env.PLATFORM_DB.prepare('SELECT status, status_history FROM privacy_requests WHERE id = ?').bind(raw.id),
    );
    if (!pr || !isPrivacyStatus(pr.status)) return c.json({ error: 'not_found' }, 404);
    if (!PRIVACY_MOVES[pr.status].includes(to)) return c.json({ error: 'illegal_move', field: 'to', from: pr.status, to }, 409);
    const at = nowIso();
    let list: unknown = [];
    try {
      list = pr.status_history ? JSON.parse(pr.status_history) : [];
    } catch {
      list = [];
    }
    const history = JSON.stringify([...(Array.isArray(list) ? list : []), { from: pr.status, to, at, by: 'ops' }]);
    const closed = to === 'resolved' || to === 'refused';
    const moved = await run(
      c.env.PLATFORM_DB.prepare(
        `UPDATE privacy_requests SET status = ?, status_at = ?, status_history = ?, acknowledged_at = CASE WHEN ? = 'acknowledged' THEN ? ELSE acknowledged_at END, resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END, purge_at = CASE WHEN ? THEN ? ELSE purge_at END WHERE id = ? AND status = ?`,
      ).bind(to, at, history, to, at, closed ? 1 : 0, at, closed ? 1 : 0, closedPurgeAt(Date.parse(at)), raw.id, pr.status),
    );
    if (moved.meta.changes !== 1) return c.json({ error: 'conflict', from: pr.status, to }, 409);
    console.log(`[feedback-ops] moved ${raw.id} ${pr.status} -> ${to}`);
    return c.json({ id: raw.id, from: pr.status, to, at }, 200);
  }
  const req = parseMove(json);
  if (req === null) return c.json({ error: 'invalid' }, 422);

  const row = await firstRow<{ status: string; status_history: string | null }>(
    c.env.PLATFORM_DB.prepare('SELECT status, status_history FROM feedback_reports WHERE id = ?').bind(req.id),
  );
  if (!row || !isStatus(row.status)) return c.json({ error: 'not_found' }, 404);
  const verdict = checkMove(row.status, req, 'ops');
  if (!verdict.ok) {
    const status = verdict.error === 'required' ? 422 : 409;
    return c.json({ error: verdict.error, field: verdict.field ?? null, from: row.status, to: req.to }, status);
  }
  if (req.to === 'duplicate') {
    const target = await firstRow<{ id: string }>(
      c.env.PLATFORM_DB.prepare('SELECT id FROM feedback_reports WHERE id = ?').bind(req.duplicateOf as string),
    );
    if (!target) return c.json({ error: 'not_found', field: 'duplicateOf' }, 422);
  }

  const at = nowIso();
  const history = appendHistory(row.status_history, { from: row.status, to: req.to, at, by: 'ops' });
  const result = await run(
    c.env.PLATFORM_DB.prepare(`UPDATE feedback_reports SET status = ?, status_at = ?, status_history = ?, duplicate_of = COALESCE(?, duplicate_of), fix_pr = COALESCE(?, fix_pr), fixed_version = COALESCE(?, fixed_version) WHERE id = ? AND status = ?`).bind(
      req.to,
      at,
      history,
      req.to === 'duplicate' ? (req.duplicateOf as string) : null,
      req.to === 'in-fix' ? (req.pr as number) : null,
      req.to === 'fixed' ? (req.version as string) : null,
      req.id,
      row.status,
    ),
  );
  if (result.meta.changes !== 1) return c.json({ error: 'conflict', from: row.status, to: req.to }, 409);
  console.log(`[feedback-ops] moved ${req.id} ${row.status} -> ${req.to}`);
  return c.json({ id: req.id, from: row.status, to: req.to, at }, 200);
});

export default ops;
