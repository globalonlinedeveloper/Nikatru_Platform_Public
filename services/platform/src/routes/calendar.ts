// ─────────────────────────────────────────────────────────────────────────────
// calendar.ts — THE PRIVATE CALENDAR FEED EVERY TARGET CAN USE (ST-R2).
//
//   AUTHED  POST   /v1/calendar/feed            — { app_id } → mint (or ROTATE)
//                                                  the caller's feed; answers the
//                                                  https and webcal URLs, ONCE
//   AUTHED  DELETE /v1/calendar/feed?app_id=…   — revoke it
//   PUBLIC  GET    /v1/calendar/<token>.ics     — the feed; `?download=1` adds an
//                                                  attachment disposition
//
// Every target reaches a calendar by URL: Google Calendar and Outlook subscribe
// to the https URL, Apple Calendar to webcal://, and a browser downloads the same
// file with `?download=1`. So there is one feed, rendered by one writer
// (lib/ics.ts), and no client builds a calendar file of its own.
//
// 🔴 THE TOKEN IS THE CAPABILITY, SO THE GET IS PUBLIC. A calendar service
// fetches the feed from its own servers with no session of ours. The token is 256
// random bits; only its SHA-256 is stored (reminder_feed.token_hash), so neither
// the database nor a backup of it can be turned back into a working URL, and no
// new secret is needed to verify it. Rotating replaces the hash — the old URL
// answers 404 at once — and revoking stamps `revoked_at`, which answers the same
// 404 as a token that never existed.
//
// ⚠️ RATE-LIMITED THE WAY EVERY PUBLIC ROUTE HERE IS: the server-derived
// `edge:<colo>:<asn>` key (lib/edge-ceiling.ts) on its own binding,
// REMINDERS_CEILING_LIMITER. A calendar provider fetches every subscriber's feed
// from its own few networks, so that key bounds a provider's whole fetch rate,
// not one person's — see the limit's derivation in wrangler.jsonc.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { firstRow, nowIso } from '../lib/d1';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling } from '../lib/edge-ceiling';
import { writeCalendar, type IcsEvent } from '../lib/ics';
import {
  DEFAULT_LEAD_DAYS,
  TOKEN_SHAPE,
  appName,
  clampLead,
  leadFor,
  mintToken,
  nextOccurrence,
  priceLabel,
  readLiveSubscriptions,
  ymdOf,
} from '../lib/reminders';
import { appTargets } from '../scheduled';
import { isReminderApp } from './reminders';
import { sha256Hex } from '../middleware/ext-device-auth';

const calendar = new Hono<AppEnv>();

/**
 * `{ "app_id": "<slug>" }` and nothing else.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_FEED_BODY_BYTES = 512;

/** The feed's two URLs for `token`, on the host the caller reached. */
export function feedUrls(origin: string, token: string): { https_url: string; webcal_url: string } {
  const https = `${origin.replace(/^http:/, 'https:')}/v1/calendar/${token}.ics`;
  return { https_url: https, webcal_url: https.replace(/^https:/, 'webcal:') };
}

calendar.post('/calendar/feed', async (c) => {
  const read = await readBoundedBody(c.req.raw, MAX_FEED_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const appId = (body as { app_id?: unknown } | null)?.app_id;
  if (!isReminderApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  const token = mintToken();
  const createdAt = nowIso();
  // Mint and rotate are one statement: the (user, app) row is replaced in place,
  // so a person has at most one live feed per app and the previous URL dies here.
  await c.env.PLATFORM_DB.prepare(
    `INSERT INTO reminder_feed (user_id, app_id, token_hash, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT (user_id, app_id) DO UPDATE SET
       token_hash = excluded.token_hash, created_at = excluded.created_at, revoked_at = NULL`,
  )
    .bind(c.get('userId'), appId, await sha256Hex(token), createdAt)
    .run();
  // Named keys, not a spread: assert-analytics-contract pins this literal
  // against the released Dart client (CalendarFeed.tryParse), and a key it
  // cannot name is a key it cannot compare.
  const urls = feedUrls(new URL(c.req.url).origin, token);
  return c.json({ app_id: appId, https_url: urls.https_url, webcal_url: urls.webcal_url, created_at: createdAt }, 201);
});

calendar.delete('/calendar/feed', async (c) => {
  const appId = c.req.query('app_id');
  if (!isReminderApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  const res = await c.env.PLATFORM_DB.prepare(
    'UPDATE reminder_feed SET revoked_at = ? WHERE user_id = ? AND app_id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), c.get('userId'), appId)
    .run();
  if (Number(res.meta?.changes ?? 0) === 0) return c.json({ error: 'no_feed' }, 404);
  return c.body(null, 204);
});

calendar.get('/calendar/:file', async (c) => {
  if (!(await withinEdgeCeiling(c.env.REMINDERS_CEILING_LIMITER, c, 'REMINDERS_CEILING_LIMITER'))) {
    return c.text('rate limited', 429);
  }
  const file = c.req.param('file');
  const token = file.endsWith('.ics') ? file.slice(0, -'.ics'.length) : '';
  // A malformed token costs no read.
  if (!TOKEN_SHAPE.test(token)) return c.text('not found', 404);
  const feed = await firstRow<{ user_id: string; app_id: string }>(
    c.env.PLATFORM_DB.prepare('SELECT user_id, app_id FROM reminder_feed WHERE token_hash = ? AND revoked_at IS NULL').bind(
      await sha256Hex(token),
    ),
  );
  if (!feed) return c.text('not found', 404);
  const target = appTargets(c.env).find((t) => t.appId === feed.app_id);
  // A feed for an app whose database this Worker no longer binds is a
  // configuration fault, not a missing feed — it must not read as "revoked".
  if (!target?.db) throw new Error(`calendar feed: no database binding for app ${feed.app_id}`);
  c.set('appId', feed.app_id);
  const prefs = await firstRow<{ lead_days: number }>(
    c.env.PLATFORM_DB.prepare('SELECT lead_days FROM reminder_prefs WHERE user_id = ? AND app_id = ?').bind(
      feed.user_id,
      feed.app_id,
    ),
  );
  const personLead = prefs ? clampLead(prefs.lead_days) : DEFAULT_LEAD_DAYS;
  const now = Date.now();
  const today = ymdOf(now);
  const subs = await readLiveSubscriptions(target.db, [feed.user_id]);
  const events: IcsEvent[] = [];
  for (const sub of subs) {
    const date = nextOccurrence(sub, today);
    if (date === null) continue;
    const name = (sub.name ?? '').trim() || 'A subscription';
    const price = priceLabel(sub.price);
    events.push({
      // Stable across fetches: the same occurrence is the same event, so a client
      // that re-reads the feed updates it rather than adding a second copy.
      uid: `${feed.app_id}.${sub.id}.${date}@reminders.nikatru.com`,
      date,
      summary: `${name} renews`,
      description: [sub.cycle ? `Renews ${sub.cycle}` : null, price ? `Amount ${price}` : null].filter(Boolean).join(' · ') || undefined,
      alarmDaysBefore: leadFor(sub, personLead),
    });
  }
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    // Private: the URL is a credential. A shared cache must never hold it, and a
    // referrer must never carry it on.
    'Cache-Control': 'private, max-age=900',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  };
  if (c.req.query('download') === '1') headers['Content-Disposition'] = 'attachment; filename="renewals.ics"';
  return c.body(writeCalendar({ name: `${appName(feed.app_id)} renewals`, stamp: new Date(now), events }), 200, headers);
});

export default calendar;
