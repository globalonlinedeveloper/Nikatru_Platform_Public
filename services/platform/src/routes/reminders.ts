// ─────────────────────────────────────────────────────────────────────────────
// reminders.ts — the renewal reminder EMAIL preference, and the way out of it
// (ST-R1). The nightly job that reads the preference is src/lib/reminders.ts.
//
//   AUTHED  GET  /v1/reminders/prefs?app_id=<app>  — the caller's preference, or
//                                                    the default (not opted in)
//   AUTHED  PUT  /v1/reminders/prefs               — { app_id, email_opt_in,
//                                                    lead_days? }
//   PUBLIC  GET  /v1/reminders/unsubscribe?t=<tok> — a page with one button; it
//                                                    changes NOTHING by itself
//   PUBLIC  POST /v1/reminders/unsubscribe?t=<tok> — RFC 8058 one-click: opts the
//                                                    (account, app) the token
//                                                    names out of email
//
// ⚠️ ONLY `/v1/reminders/prefs` IS BEHIND `platformAuth` (index.ts), and the
// unsubscribe pair is deliberately NOT: the person clicking it is reading an
// email, often on a device where they are signed in to nothing. The token IS the
// capability — 256 random bits minted per digest, stored only as SHA-256 on that
// digest's `reminder_sent` rows — and all it can do is turn email OFF.
//
// 🔴 A GET NEVER UNSUBSCRIBES. Mail scanners and link previewers fetch every URL
// in a message; an unsubscribe on GET would opt people out who never clicked.
// RFC 8058 §3.1 is the POST, and the GET page's button makes the same POST.
//
// Per app: `app_id` must be an app this Worker fans reminders out to (it has an
// app database in the generated target list), not merely a known app.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { firstRow, nowIso, run } from '../lib/d1';
import { isKnownApp } from '../config';
import { readBoundedBody } from '../lib/body';
import { withinEdgeCeiling, withinRateLimit } from '../lib/edge-ceiling';
import { APP_TARGETS } from '../generated/app-targets';
import { DEFAULT_LEAD_DAYS, MAX_LEAD_DAYS, TOKEN_SHAPE, appName } from '../lib/reminders';
import { sha256Hex } from '../middleware/ext-device-auth';

const reminders = new Hono<AppEnv>();

/**
 * An app id, a boolean and a small integer.
 *
 * @ceiling workers.maxRequestBodySize lte
 */
export const MAX_PREFS_BODY_BYTES = 1024;

/** True for an app the reminder job reaches: known, and with an app database. */
export function isReminderApp(appId: unknown): appId is string {
  return isKnownApp(appId) && APP_TARGETS.some((t) => t.appId === appId);
}

type PrefsBody =
  | { ok: true; appId: string; emailOptIn: boolean; leadDays: number | null }
  | { ok: false; status: 400 | 404; error: string };

/** The PUT body, validated. Exported so the rules are testable without a request. */
export function parsePrefs(body: unknown): PrefsBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, status: 400, error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  if (!isReminderApp(b.app_id)) return { ok: false, status: 404, error: 'unknown_app' };
  if (typeof b.email_opt_in !== 'boolean') return { ok: false, status: 400, error: 'invalid_email_opt_in' };
  const lead = b.lead_days;
  if (lead !== undefined && lead !== null && !(typeof lead === 'number' && Number.isInteger(lead) && lead >= 0 && lead <= MAX_LEAD_DAYS)) {
    return { ok: false, status: 400, error: 'invalid_lead_days' };
  }
  return { ok: true, appId: b.app_id, emailOptIn: b.email_opt_in, leadDays: typeof lead === 'number' ? lead : null };
}

reminders.get('/reminders/prefs', async (c) => {
  const appId = c.req.query('app_id');
  if (!isReminderApp(appId)) return c.json({ error: 'unknown_app' }, 404);
  c.set('appId', appId);
  const row = await firstRow<{ email_opt_in: number; lead_days: number }>(
    c.env.PLATFORM_DB.prepare('SELECT email_opt_in, lead_days FROM reminder_prefs WHERE user_id = ? AND app_id = ?').bind(
      c.get('userId'),
      appId,
    ),
  );
  return c.json({
    app_id: appId,
    email_opt_in: row ? row.email_opt_in === 1 : false,
    lead_days: row ? row.lead_days : DEFAULT_LEAD_DAYS,
  });
});

reminders.put('/reminders/prefs', async (c) => {
  const userId = c.get('userId');
  const read = await readBoundedBody(c.req.raw, MAX_PREFS_BODY_BYTES);
  if (!read.ok) return c.json({ error: read.error }, read.status);
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = parsePrefs(body);
  if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
  c.set('appId', parsed.appId);
  // The per-person burst breaker, the same binding and key shape report.ts uses.
  if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `reminders:${userId}`, 'EVENTS_LIMITER'))) {
    return c.json({ error: 'rate_limited' }, 429);
  }
  // An absent lead keeps the stored one (or the default for a first write).
  // `run`: an upsert of the same values, so a retry after a reset is the same write.
  await run(
    c.env.PLATFORM_DB.prepare(
      `INSERT INTO reminder_prefs (user_id, app_id, email_opt_in, lead_days, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, app_id) DO UPDATE SET
         email_opt_in = excluded.email_opt_in,
         lead_days = CASE WHEN ?6 = 1 THEN excluded.lead_days ELSE reminder_prefs.lead_days END,
         updated_at = excluded.updated_at`,
    ).bind(
      userId,
      parsed.appId,
      parsed.emailOptIn ? 1 : 0,
      parsed.leadDays ?? DEFAULT_LEAD_DAYS,
      nowIso(),
      parsed.leadDays === null ? 0 : 1,
    ),
  );
  const row = await firstRow<{ email_opt_in: number; lead_days: number }>(
    c.env.PLATFORM_DB.prepare('SELECT email_opt_in, lead_days FROM reminder_prefs WHERE user_id = ? AND app_id = ?').bind(
      userId,
      parsed.appId,
    ),
  );
  return c.json({ app_id: parsed.appId, email_opt_in: row?.email_opt_in === 1, lead_days: row?.lead_days ?? DEFAULT_LEAD_DAYS });
});

/** Headers every unsubscribe answer carries: the token is in the URL, so it must
 *  not travel on as a referrer, and the page must never be indexed or cached. */
function privateHeaders(): Record<string, string> {
  return { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
}

function page(title: string, body: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>` +
    `<body><main><h1>${title}</h1>${body}</main></body></html>`
  );
}

/** Which (account, app) a token names, or null. Refuses a malformed token before any read. */
async function tokenOwner(db: SqlDb, token: string | undefined): Promise<{ user_id: string; app_id: string } | null> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  return firstRow<{ user_id: string; app_id: string }>(
    db.prepare('SELECT user_id, app_id FROM reminder_sent WHERE unsubscribe_hash = ? LIMIT 1').bind(await sha256Hex(token)),
  );
}

reminders.get('/reminders/unsubscribe', async (c) => {
  if (!(await withinEdgeCeiling(c.env.REMINDERS_CEILING_LIMITER, c, 'REMINDERS_CEILING_LIMITER'))) {
    return c.text('rate limited', 429, privateHeaders());
  }
  const token = c.req.query('t');
  const owner = await tokenOwner(c.env.PLATFORM_DB, token);
  if (!owner) return c.html(page('Link not recognised', '<p>This unsubscribe link is not valid any more.</p>'), 404, privateHeaders());
  const name = appName(owner.app_id).replace(/[&<>"]/g, '');
  return c.html(
    page(
      'Stop renewal reminder emails',
      `<p>Stop the renewal reminder emails from ${name}? You can switch them back on in the app.</p>` +
        `<form method="post" action="/v1/reminders/unsubscribe?t=${token}"><button type="submit">Stop these emails</button></form>`,
    ),
    200,
    privateHeaders(),
  );
});

reminders.post('/reminders/unsubscribe', async (c) => {
  if (!(await withinEdgeCeiling(c.env.REMINDERS_CEILING_LIMITER, c, 'REMINDERS_CEILING_LIMITER'))) {
    return c.text('rate limited', 429, privateHeaders());
  }
  const owner = await tokenOwner(c.env.PLATFORM_DB, c.req.query('t'));
  if (!owner) return c.text('This unsubscribe link is not valid any more.', 404, privateHeaders());
  c.set('appId', owner.app_id);
  // 🔴 `run`, BECAUSE THE PROVIDER SENDS THIS ONCE (rv2-services-003). A mail
  // client's RFC 8058 POST is not retried by anybody: a transient D1 reset here
  // was a 500, and the person kept getting the mail they had asked to stop.
  await run(
    c.env.PLATFORM_DB.prepare('UPDATE reminder_prefs SET email_opt_in = 0, updated_at = ? WHERE user_id = ? AND app_id = ?').bind(
      nowIso(),
      owner.user_id,
      owner.app_id,
    ),
  );
  // A POST from a mail client (RFC 8058) reads the status; a person pressing the
  // page's button reads the page.
  return c.html(
    page('Unsubscribed', '<p>You will not get renewal reminder emails any more. You can switch them back on in the app.</p>'),
    200,
    privateHeaders(),
  );
});

export default reminders;
