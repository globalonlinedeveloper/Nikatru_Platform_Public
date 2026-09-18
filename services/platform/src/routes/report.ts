// ─────────────────────────────────────────────────────────────────────────────
// report.ts — POST /v1/report: a user flags AI-generated content, from inside
// the app, to us.
//
// O-PLAY-AI-CONTENT-REPORTING (MASTER_PLAN G-39). Google Play, AI-Generated
// Content (answer/13985936, read 2026-09-18): "Apps that generate content using AI
// must contain in-app user reporting or flagging features that allow users to
// report or flag offensive content to developers without needing to exit the
// app." This route is the "to developers" half; the chassis control that calls it
// is the "without needing to exit the app" half.
//
// AUTHENTICATED (`platformAuth`, mounted at /v1/report in index.ts): the reporter
// is the verified JWT's subject and nothing a body can say. That makes a report
// attributable for moderation, erasable with the account (0013's header), and
// capped per person.
//
// ORDER, and why each step sits where it does:
//   1. body bounded, then parsed, then validated — nothing touches D1 on a bad body;
//   2. the burst breaker (EVENTS_LIMITER, keyed `report:<user>`) — fail-open by the
//      helper's design, so it is a breaker, not the cap;
//   3. THE CAP: at most MAX_REPORTS_PER_USER_PER_HOUR rows in the last hour, read
//      from D1 — a real limit that a missing binding cannot switch off;
//   4. INSERT — the report exists from here, whatever happens next;
//   5. the support notice, under `waitUntil`, after the response. The user never
//      waits on email and never learns whether it went (lib/report-notify.ts).
// 202, because the report is RECEIVED, not yet reviewed.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { firstRow, nowIso } from '../lib/d1';
import { isKnownApp } from '../config';
import { readBoundedBody } from '../lib/body';
import { withinRateLimit } from '../lib/edge-ceiling';
import { notifyReport } from '../lib/report-notify';

const report = new Hono<AppEnv>();

/**
 * The closed set of reasons — Play's policy names offensive content, and these
 * are the classes its prohibited-content examples fall into, plus `other`.
 * Enforced HERE, not by a CHECK constraint (0013's header).
 */
export const REPORT_REASONS = [
  'offensive',
  'sexual',
  'violence',
  'hate',
  'self_harm',
  'dangerous',
  'misinformation',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * An app id, a reason, a reference, an excerpt and a note: 8 KiB holds the three
 * text caps below at their worst-case UTF-8 width with room for the JSON.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_REPORT_BODY_BYTES = 8192;
/** @ceiling none — a field length we chose for moderation, not a platform resource. */
export const MAX_EXCERPT_CHARS = 2000;
/** @ceiling none — a field length we chose for moderation, not a platform resource. */
export const MAX_NOTE_CHARS = 1000;
/** @ceiling none — a field length we chose for moderation, not a platform resource. */
export const MAX_CONTENT_REF_CHARS = 200;
/**
 * Reports one person may file per rolling hour. Generous for a real user; a
 * scripted flood stops at the eleventh.
 *
 * @ceiling none — an abuse cap we chose, not a platform resource; enforced by a D1 read, not a binding.
 */
export const MAX_REPORTS_PER_USER_PER_HOUR = 10;

type Parsed =
  | { ok: true; appId: string; reason: ReportReason; contentRef: string | null; excerpt: string | null; note: string | null }
  | { ok: false; status: 400 | 404; error: string };

/** Optional text: absent or null is null; a string is trimmed and capped; anything else is refused. */
function optionalText(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? undefined : t;
}

/** The body, validated. Exported so the rules are testable without a request. */
export function parseReport(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'invalid_body' };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.app_id !== 'string' || !isKnownApp(b.app_id)) return { ok: false, status: 404, error: 'unknown_app' };
  if (typeof b.reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(b.reason)) {
    return { ok: false, status: 400, error: 'invalid_reason' };
  }
  const contentRef = optionalText(b.content_ref, MAX_CONTENT_REF_CHARS);
  const excerpt = optionalText(b.content_excerpt, MAX_EXCERPT_CHARS);
  const note = optionalText(b.note, MAX_NOTE_CHARS);
  if (contentRef === undefined) return { ok: false, status: 400, error: 'invalid_content_ref' };
  if (excerpt === undefined) return { ok: false, status: 400, error: 'invalid_content_excerpt' };
  if (note === undefined) return { ok: false, status: 400, error: 'invalid_note' };
  // A report that names nothing — no reference, no excerpt — cannot be acted on,
  // and would let the per-hour cap be spent on empty rows.
  if (contentRef === null && excerpt === null) return { ok: false, status: 400, error: 'nothing_reported' };
  return { ok: true, appId: b.app_id, reason: b.reason as ReportReason, contentRef, excerpt, note };
}

report.post('/report', async (c) => {
  const userId = c.get('userId');

  const read = await readBoundedBody(c.req.raw, MAX_REPORT_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = parseReport(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  c.set('appId', parsed.appId); // [pipeline B-16] attribution, post-validation.

  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `report:${userId}`, 'EVENTS_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  const now = nowIso();
  const hourAgo = new Date(Date.parse(now) - 3600_000).toISOString();
  const recent = await firstRow<{ n: number }>(
    c.env.PLATFORM_DB.prepare('SELECT COUNT(*) AS n FROM content_reports WHERE user_id = ? AND created_at >= ?').bind(
      userId,
      hourAgo,
    ),
  );
  if ((recent?.n ?? 0) >= MAX_REPORTS_PER_USER_PER_HOUR) return c.json({ error: 'rate_limited' }, 429);

  const id = crypto.randomUUID();
  await c.env.PLATFORM_DB.prepare(
    `INSERT INTO content_reports
       (id, user_id, app_id, reason, content_ref, content_excerpt, note, status, created_at, notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, NULL)`,
  )
    .bind(id, userId, parsed.appId, parsed.reason, parsed.contentRef, parsed.excerpt, parsed.note, now)
    .run();

  c.executionCtx.waitUntil(
    notifyReport(c.env.PLATFORM_DB, c.env.RESEND_API_KEY, { id, appId: parsed.appId, reason: parsed.reason, createdAt: now }),
  );
  return c.json({ ok: true, id }, 202);
});

export default report;
