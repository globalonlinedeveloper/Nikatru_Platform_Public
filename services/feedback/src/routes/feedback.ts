// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/feedback — "Report a problem", from every app, site and extension
// (lane feedback-intake, Do 5, 6 and 10).
//
// THE BODY: `application/json` (the report alone), or `multipart/form-data` with
// a `report` part (the same JSON) and at most one `screenshot` part (PNG or WebP,
// at most 2 MB). The whole body is read under one byte cap before it is parsed.
//
// TWO PATHS, ONE ROUTE:
//   · AUTHED — an `Authorization: Bearer` session token, verified exactly as the
//     other Workers verify it (JWKS first, the KV-cached set on a fetch failure,
//     the revocation list). A token that is present and does NOT verify is a 401,
//     never a silent downgrade to anonymous.
//   · ANONYMOUS — no token (signed out, the nikatru.com form through its Pages
//     Function, an extension without an account): the stricter hourly limit.
//
// THE SCREENSHOT goes to the private bucket `nikatru-feedback` (binding
// SCREENSHOTS), keyed `shots/<report id>.<png|webp>`, after its metadata chunks
// are stripped (lib/image.ts).
//
// THE ORDER IS THE POINT: closed-flag → size → parse → honeypot → limits → write.
// Nothing is written before every check has passed, and a honeypot hit answers
// exactly what a real report answers (202, an id) with no row and no object.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import { bearer } from '../../../_shared/src/auth';
import { sessionRevoked, verifySupabaseToken } from '../../../_shared/src/auth-middleware';
import { readBoundedBody } from '../lib/body';
import { firstRow, nowIso, run } from '../lib/d1';
import { stripImage } from '../lib/image';
import {
  ANON_PER_HOUR,
  AUTHED_PER_HOUR,
  DAY_MS,
  FEEDBACK_RETENTION_DAYS,
  GLOBAL_PER_DAY,
  HOUR_MS,
  MAX_BODY_BYTES,
  MAX_IMAGE_BYTES,
  MAX_REPORT_JSON_BYTES,
} from '../lib/limits';
import { parseReport, type Report } from '../lib/report';
import { windowLimiter } from '../lib/window-limiter';
import type { AppEnv, Env } from '../types';

const feedback = new Hono<AppEnv>();

/** 'FB-' + 10 Crockford base32 characters: short enough to read out on a call. */
export function newReportId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return `FB-${[...b].map((x) => alphabet[x % 32]).join('')}`;
}

type Who = { kind: 'user'; userId: string; email: string | null } | { kind: 'anonymous' };

async function whoIsCalling(env: Env, authorization: string | undefined, rid: string): Promise<Who | 'refused'> {
  if (authorization === undefined || authorization === '') return { kind: 'anonymous' };
  const token = bearer(authorization);
  if (token === null) return 'refused';
  try {
    const { payload } = await verifySupabaseToken(token, env.SUPABASE_URL, env.JWKS_CACHE, {
      legacyHs256Secret: env.SUPABASE_JWT_SECRET,
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') return 'refused';
    if (await sessionRevoked(env.SESSION_REVOKED, payload.sub, payload as Record<string, unknown>, `[feedback] rid=${rid}`)) {
      return 'refused';
    }
    const email = (payload as { email?: unknown }).email;
    return { kind: 'user', userId: payload.sub, email: typeof email === 'string' ? email : null };
  } catch {
    return 'refused';
  }
}

/** The report JSON and the screenshot bytes, from either body shape. */
async function partsOf(
  contentType: string,
  bytes: Uint8Array,
): Promise<{ ok: true; json: unknown; image: Uint8Array | null } | { ok: false; status: 400 | 413; error: string }> {
  const parse = (t: string) => {
    if (new TextEncoder().encode(t).byteLength > MAX_REPORT_JSON_BYTES) return { ok: false as const, status: 413 as const, error: 'report_too_large' };
    try {
      return { ok: true as const, json: JSON.parse(t) as unknown };
    } catch {
      return { ok: false as const, status: 400 as const, error: 'bad_json' };
    }
  };
  if (contentType.startsWith('application/json')) {
    const p = parse(new TextDecoder().decode(bytes));
    return p.ok ? { ok: true, json: p.json, image: null } : p;
  }
  if (contentType.startsWith('multipart/form-data')) {
    let form: FormData;
    try {
      form = await new Request('https://intake.invalid/', { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData();
    } catch {
      return { ok: false, status: 400, error: 'bad_multipart' };
    }
    const names = [...new Set([...form.keys()])];
    if (names.some((n) => n !== 'report' && n !== 'screenshot') || form.getAll('screenshot').length > 1) {
      return { ok: false, status: 400, error: 'bad_multipart' };
    }
    const report = form.get('report');
    if (typeof report !== 'string') return { ok: false, status: 400, error: 'bad_multipart' };
    const p = parse(report);
    if (!p.ok) return p;
    const shot = form.get('screenshot');
    if (shot === null) return { ok: true, json: p.json, image: null };
    if (typeof shot === 'string') return { ok: false, status: 400, error: 'bad_multipart' };
    if (shot.size > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: 'image_too_large' };
    return { ok: true, json: p.json, image: new Uint8Array(await shot.arrayBuffer()) };
  }
  return { ok: false, status: 400, error: 'unsupported_media_type' };
}

/** Each limiter the caller must pass, in order. A store error FAILS CLOSED. */
async function overLimit(env: Env, who: Who, address: string | null): Promise<'within' | 'over' | 'unavailable'> {
  const hourly =
    who.kind === 'user'
      ? { key: `user:${who.userId}`, limit: AUTHED_PER_HOUR }
      : { key: `addr:${address ?? 'none'}`, limit: ANON_PER_HOUR };
  try {
    const one = await windowLimiter(env.PLATFORM_DB, { windowMs: HOUR_MS, limit: hourly.limit, scope: 0 }).limit({ key: hourly.key });
    if (!one.success) return 'over';
    const all = await windowLimiter(env.PLATFORM_DB, { windowMs: DAY_MS, limit: GLOBAL_PER_DAY, scope: 1 }).limit({ key: 'global' });
    return all.success ? 'within' : 'over';
  } catch (err) {
    console.log(`[feedback] limiter unavailable: ${err instanceof Error ? err.name : typeof err}`);
    return 'unavailable';
  }
}

export function purgeAtOf(createdAtMs: number): string {
  return new Date(createdAtMs + FEEDBACK_RETENTION_DAYS * DAY_MS).toISOString();
}

/** The row's contact: the account's address or the typed one, ONLY on "you may reply". */
function contactOf(report: Report, who: Who): string | null {
  if (!report.reply) return null;
  if (who.kind === 'user') return who.email;
  return report.contactEmail;
}

feedback.post('/', async (c) => {
  if (c.env.INTAKE_OPEN !== 'true') return c.json({ error: 'intake_closed' }, 503);
  const rid = c.get('requestId') ?? '-';

  const body = await readBoundedBody(c.req.raw, MAX_BODY_BYTES);
  if (!body.ok) return c.json({ error: body.error }, body.status);

  const who = await whoIsCalling(c.env, c.req.header('Authorization'), rid);
  if (who === 'refused') return c.json({ error: 'unauthorized' }, 401);

  const parts = await partsOf(c.req.header('content-type') ?? '', body.bytes);
  if (!parts.ok) return c.json({ error: parts.error }, parts.status);

  const parsed = parseReport(parts.json);
  if (!parsed.ok) return c.json({ error: parsed.error, field: parsed.field ?? null }, parsed.status);
  const report = parsed.report;

  let image: { kind: 'png' | 'webp'; bytes: Uint8Array } | null = null;
  if (parts.image !== null) {
    image = stripImage(parts.image);
    if (image === null) return c.json({ error: 'unsupported_image', field: 'screenshot' }, 400);
  }

  // The honeypot: a person never sees the field, so a value is a script. It is
  // answered like a success and nothing is written, so the script learns nothing.
  if (report.honeypot) {
    console.log(`[feedback] rid=${rid} honeypot filled; dropped`);
    return c.json({ id: newReportId(), status: 'new' }, 202);
  }

  // A replay of a report already stored (the outbox sending again after a lost
  // answer) is answered with its first id and writes nothing — and spends no limit.
  const prior = await firstRow<{ id: string }>(
    c.env.PLATFORM_DB.prepare('SELECT id FROM feedback_reports WHERE idempotency_key = ?').bind(report.idempotencyKey),
  );
  if (prior) return c.json({ id: prior.id, status: 'duplicate' }, 200);

  const verdict = await overLimit(c.env, who, c.req.header('CF-Connecting-IP') ?? null);
  if (verdict === 'over') return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': '3600' });
  if (verdict === 'unavailable') return c.json({ error: 'temporarily_unavailable' }, 503);

  const id = newReportId();
  const now = Date.now();
  let screenshotKey: string | null = null;
  if (image !== null) {
    screenshotKey = `shots/${id}.${image.kind}`;
    await c.env.SCREENSHOTS.put(screenshotKey, image.bytes, { httpMetadata: { contentType: `image/${image.kind}` } });
  }
  try {
    await run(
      c.env.PLATFORM_DB.prepare(
        'INSERT INTO feedback_reports (id, idempotency_key, user_id, app_id, app_version, surface, category, description, steps, ' +
          'diagnostics, contact_email, reply_ok, notify_fixed, screenshot_key, status, created_at, purge_at) ' +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)",
      ).bind(
        id,
        report.idempotencyKey,
        who.kind === 'user' ? who.userId : null,
        report.appId,
        report.diagnostics.appVersion ?? null,
        report.surface,
        report.category,
        report.description,
        report.steps,
        JSON.stringify(report.diagnostics),
        contactOf(report, who),
        report.reply ? 1 : 0,
        report.notifyFixed ? 1 : 0,
        screenshotKey,
        new Date(now).toISOString(),
        purgeAtOf(now),
      ),
    );
  } catch (err) {
    // The object went in first; a row that did not follow leaves an orphan the
    // nightly sweep removes, and the client retries with the same key.
    if (screenshotKey !== null) await c.env.SCREENSHOTS.delete(screenshotKey).catch(() => {});
    throw err;
  }
  console.log(`[feedback] rid=${rid} stored ${id} app=${report.appId} surface=${report.surface} category=${report.category} at=${nowIso()}`);
  return c.json({ id, status: 'new' }, 201);
});

export default feedback;
