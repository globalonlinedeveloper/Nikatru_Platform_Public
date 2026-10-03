// ─────────────────────────────────────────────────────────────────────────────
// privacy.ts — DPDP RIGHTS REQUESTS, riding the private intake (lane dpdp-rights,
// Do 1; O-DPDP-RIGHTS-INTAKE-UNBUILT).
//
// A rights request arrives on POST /v1/feedback with `kind: "privacy-request"`:
// the same route, the same limits, the same Pages Function on nikatru.com and the
// same Dart transport and outbox as "Report a problem". It is stored in its own
// table, `privacy_requests` (0030_privacy_requests.sql), because its lifecycle is
// a statutory one and the problem-report triage must never touch it.
//
// IDENTITY. A signed-in request is identified by the verified session — nothing
// new is collected to prove who the requester is. A signed-out requester (for
// example a launch-list sign-up) proves the address with a one-time e-mailed
// link; until then the request is `unverified`, no clock runs and nobody acts on
// it. A signed-out request with no address is refused (401 `proof_required`).
//
// THE CLOCKS are the PUBLISHED promise (privacy.html §9, "How to complain"):
//   · acknowledge within ACK_HOURS (48 h) of verification;
//   · resolve within RESOLVE_DAYS (30 days);
//   · a grievance is never past GRIEVANCE_STATUTORY_DAYS (90 days, DPDP Rules
//     2025) — recorded on the row, and inside the 30 days anyway.
// `clockOf` grades an open request green / amber / red; the feedback cron pages
// the owner (lib/owner-page.ts) for every red one, once a day while it stays red.
//
// 🔴 NOTHING AUTOMATIC CLOSES A RIGHTS REQUEST. PRIVACY_MOVES has no cron mover:
// only the ops route (the lead, with the ops secret) moves `new` onward, and the
// purge reaches a row only once it is closed (or never verified within 7 days).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import type { MailTransport } from '../../../_shared/src/ports/mail';
import emailJson from '../../../../tooling/i18n/messages/email.json';
import { allRows, firstRow, run } from '../lib/d1';
import { DAY_MS, HOUR_MS, MAX_TEXT_CHARS, MIN_FILL_MS, SURFACES, type Surface } from './limits';
import { linkCount, maskPii } from './mask';
import { FEEDBACK_LINK_ORIGIN, localeOf, newToken, sha256Hex, TOKEN_SHAPE } from './notify';

export const PRIVACY_KIND = 'privacy-request';

/** The rights a data principal can ask for (DPDP Act ss.11-14, and consent withdrawal, s.6(4)). */
export const REQUEST_TYPES = ['access', 'correction', 'erasure', 'nomination', 'grievance', 'withdraw-consent'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const PRIVACY_STATUSES = ['unverified', 'new', 'acknowledged', 'resolved', 'refused'] as const;
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];

/** @ceiling none — the published acknowledgement promise (privacy.html §9), not a platform resource. */
export const ACK_HOURS = 48;
/** @ceiling none — the published resolution promise (privacy.html §9), not a platform resource. */
export const RESOLVE_DAYS = 30;
/** @ceiling none — DPDP Rules 2025's outer limit for a grievance, not a platform resource. */
export const GRIEVANCE_STATUTORY_DAYS = 90;
/** @ceiling none — how close to the resolution deadline an open request turns amber. */
export const AMBER_DAYS = 3;
/** @ceiling none — how long an unproven signed-out request (and its address) is kept. */
export const UNVERIFIED_TTL_DAYS = 7;
/** @ceiling none — the locked 400-day class (C-RETENTION-PERIODS) a CLOSED request is kept for, as evidence it was handled. */
export const CLOSED_RETENTION_DAYS = 400;
/** @ceiling none — our own per-run pacing of the overdue scan, not a platform resource. */
export const MAX_OVERDUE_PER_RUN = 20;

/** Every legal move. `unverified` -> `new` is the e-mailed link's alone. */
export const PRIVACY_MOVES: Readonly<Record<PrivacyStatus, readonly PrivacyStatus[]>> = {
  unverified: [],
  new: ['acknowledged', 'refused'],
  acknowledged: ['resolved', 'refused'],
  resolved: [],
  refused: [],
};

export const PRIVACY_ID = /^PR-[0-9A-HJKMNP-TV-Z]{10}$/;
export const isPrivacyStatus = (v: unknown): v is PrivacyStatus =>
  typeof v === 'string' && (PRIVACY_STATUSES as readonly string[]).includes(v);

export function newPrivacyId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return `PR-${[...b].map((x) => alphabet[x % 32]).join('')}`;
}

export interface PrivacyRequest {
  idempotencyKey: string;
  appId: string;
  surface: Surface;
  requestType: RequestType;
  details: string | null;
  contactEmail: string | null;
  locale: string | null;
  honeypot: boolean;
}

export type PrivacyParsed = { ok: true; request: PrivacyRequest } | { ok: false; status: 400 | 413 | 422; error: string; field?: string };

const KEYS = new Set(['kind', 'idempotencyKey', 'appId', 'surface', 'requestType', 'details', 'contactEmail', 'locale', 'website', 'elapsedMs']);
const ID = /^[a-z][a-z0-9-]{1,40}$/;
const IDEMPOTENCY = /^[A-Za-z0-9-]{8,64}$/;
const LOCALE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bad = (error: string, field?: string, status: 400 | 413 | 422 = 400): PrivacyParsed => ({ ok: false, status, error, field });

/** True when `body` is a rights request rather than a problem report. */
export const isPrivacyKind = (body: unknown): boolean => isObject(body) && body.kind === PRIVACY_KIND;

/** `body` as a rights request, or the first reason it is not one. Closed key set, as reports are. */
export function parsePrivacyRequest(body: unknown): PrivacyParsed {
  if (!isObject(body)) return bad('not_an_object');
  for (const k of Object.keys(body)) if (!KEYS.has(k)) return bad('unknown_key', k);
  if (body.kind !== PRIVACY_KIND) return bad('invalid', 'kind');
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY.test(body.idempotencyKey)) return bad('invalid', 'idempotencyKey');
  if (typeof body.appId !== 'string' || !ID.test(body.appId)) return bad('invalid', 'appId');
  if (!(SURFACES as readonly unknown[]).includes(body.surface)) return bad('invalid', 'surface');
  if (!(REQUEST_TYPES as readonly unknown[]).includes(body.requestType)) return bad('invalid', 'requestType');
  let details: string | null = null;
  if (body.details !== undefined && body.details !== null && body.details !== '') {
    if (typeof body.details !== 'string') return bad('not_a_string', 'details');
    const t = body.details.trim();
    if ([...t].length > MAX_TEXT_CHARS) return bad('too_long', 'details', 413);
    if (linkCount(t) > 3) return bad('too_many_links', 'details', 422);
    details = t === '' ? null : maskPii(t);
  }
  // A correction or a grievance says what is wrong; the others are complete as asked.
  if ((body.requestType === 'correction' || body.requestType === 'grievance') && details === null) return bad('required', 'details', 422);
  let contactEmail: string | null = null;
  if (body.contactEmail !== undefined && body.contactEmail !== null && body.contactEmail !== '') {
    if (typeof body.contactEmail !== 'string' || !EMAIL.test(body.contactEmail.trim())) return bad('invalid', 'contactEmail');
    contactEmail = body.contactEmail.trim().toLowerCase();
  }
  let locale: string | null = null;
  if (body.locale !== undefined && body.locale !== null) {
    if (typeof body.locale !== 'string' || !LOCALE.test(body.locale)) return bad('invalid', 'locale');
    locale = body.locale;
  }
  if (typeof body.elapsedMs !== 'number' || !Number.isFinite(body.elapsedMs)) return bad('invalid', 'elapsedMs');
  if (body.elapsedMs < MIN_FILL_MS) return bad('too_fast', 'elapsedMs', 422);
  return {
    ok: true,
    request: {
      idempotencyKey: body.idempotencyKey,
      appId: body.appId,
      surface: body.surface as Surface,
      requestType: body.requestType as RequestType,
      details,
      contactEmail,
      locale,
      honeypot: typeof body.website === 'string' && body.website.trim() !== '',
    },
  };
}

/** The three deadlines, from the moment the request was verified. */
export function deadlinesFrom(verifiedMs: number, type: RequestType): { ackDueAt: string; resolveDueAt: string; statutoryDueAt: string | null } {
  return {
    ackDueAt: new Date(verifiedMs + ACK_HOURS * HOUR_MS).toISOString(),
    resolveDueAt: new Date(verifiedMs + RESOLVE_DAYS * DAY_MS).toISOString(),
    statutoryDueAt: type === 'grievance' ? new Date(verifiedMs + GRIEVANCE_STATUTORY_DAYS * DAY_MS).toISOString() : null,
  };
}

export type Clock = 'closed' | 'waiting' | 'green' | 'amber' | 'red';

export interface ClockRow {
  status: string;
  ack_due_at: string | null;
  resolve_due_at: string | null;
  statutory_due_at: string | null;
  acknowledged_at: string | null;
}

/**
 * Where an open request stands against its published promises at `nowMs`.
 *   closed   resolved or refused;
 *   waiting  not yet verified (no clock runs);
 *   red      past the 48 h acknowledgement unacknowledged, or past the 30 days, or past the statutory 90;
 *   amber    within AMBER_DAYS of the 30 days;
 *   green    otherwise.
 * A request verified on day 0 is amber on day 29 and red on day 31.
 */
export function clockOf(row: ClockRow, nowMs: number): Clock {
  if (row.status === 'resolved' || row.status === 'refused') return 'closed';
  if (row.status === 'unverified' || row.resolve_due_at === null) return 'waiting';
  const t = (iso: string | null) => (iso === null ? Number.POSITIVE_INFINITY : Date.parse(iso));
  if (row.acknowledged_at === null && nowMs > t(row.ack_due_at)) return 'red';
  if (nowMs > t(row.resolve_due_at) || nowMs > t(row.statutory_due_at)) return 'red';
  if (nowMs > t(row.resolve_due_at) - AMBER_DAYS * DAY_MS) return 'amber';
  return 'green';
}

export type Who = { kind: 'user'; userId: string; email: string | null } | { kind: 'anonymous' };

export type Intake =
  | { status: 201; body: { id: string; status: 'new'; ackDueAt: string; resolveDueAt: string } }
  | { status: 202; body: { id: string; status: 'unverified' } }
  | { status: 200; body: { id: string; status: 'duplicate' } }
  | { status: 401; body: { error: 'proof_required' } };

/**
 * Store one rights request. Signed in: verified now, the clocks start. Signed out:
 * held `unverified` and a one-time link is mailed to the address it names; with no
 * address there is nothing to prove, and the request is refused.
 */
export async function acceptPrivacyRequest(
  db: SqlDb,
  mail: MailTransport | null,
  req: PrivacyRequest,
  who: Who,
  nowMs: number,
): Promise<Intake> {
  if (who.kind === 'anonymous' && req.contactEmail === null) return { status: 401, body: { error: 'proof_required' } };
  const prior = await firstRow<{ id: string }>(db.prepare('SELECT id FROM privacy_requests WHERE idempotency_key = ?').bind(req.idempotencyKey));
  if (prior) return { status: 200, body: { id: prior.id, status: 'duplicate' } };
  const id = newPrivacyId();
  const now = new Date(nowMs).toISOString();
  if (who.kind === 'user') {
    const d = deadlinesFrom(nowMs, req.requestType);
    await run(
      db
        .prepare(
          `INSERT INTO privacy_requests (id, idempotency_key, user_id, app_id, surface, request_type, details, contact_email, locale, status, created_at, verified_at, ack_due_at, resolve_due_at, statutory_due_at, status_at, status_history) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, req.idempotencyKey, who.userId, req.appId, req.surface, req.requestType, req.details, who.email, req.locale, now, now, d.ackDueAt, d.resolveDueAt, d.statutoryDueAt, now, JSON.stringify([{ from: 'unverified', to: 'new', at: now, by: 'session' }])),
    );
    return { status: 201, body: { id, status: 'new', ackDueAt: d.ackDueAt, resolveDueAt: d.resolveDueAt } };
  }
  const token = newToken();
  await run(
    db
      .prepare(
        `INSERT INTO privacy_requests (id, idempotency_key, user_id, app_id, surface, request_type, details, contact_email, locale, status, created_at, verify_hash, purge_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?, ?)`,
      )
      .bind(id, req.idempotencyKey, req.appId, req.surface, req.requestType, req.details, req.contactEmail, req.locale, now, await sha256Hex(token), new Date(nowMs + UNVERIFIED_TTL_DAYS * DAY_MS).toISOString()),
  );
  await sendVerifyLink(mail, req.contactEmail as string, id, token, req.locale);
  return { status: 202, body: { id, status: 'unverified' } };
}

interface PrivacyMailCopy {
  verifySubject: string;
  verifyBody: string;
  verifyWhy: string;
}
const PRIVACY_COPY = (emailJson as unknown as { privacyMail: Record<string, Partial<PrivacyMailCopy> | undefined> }).privacyMail;
const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** The link that proves the address, in the requester's language. Never throws. */
async function sendVerifyLink(mail: MailTransport | null, to: string, id: string, token: string, locale: string | null): Promise<void> {
  if (mail === null) {
    console.log(`[privacy] ${id} verify link not sent: mail not configured`);
    return;
  }
  const loc = localeOf(locale);
  const copy = { ...(PRIVACY_COPY.en as PrivacyMailCopy), ...(PRIVACY_COPY[loc] ?? {}) };
  const link = `${FEEDBACK_LINK_ORIGIN}/v1/feedback/verify?t=${token}`;
  try {
    const outcome = await mail.send({
      stream: 'feedback',
      to: [to],
      subject: fill(copy.verifySubject, { id }),
      text: `${fill(copy.verifyBody, { id })}\n\n${link}\n\n${copy.verifyWhy}\n`,
    });
    if (!outcome.ok) console.log(`[privacy] ${id} verify link not sent: ${outcome.kind} ${outcome.detail}`);
  } catch (err) {
    console.log(`[privacy] ${id} verify link transport threw: ${err instanceof Error ? err.name : typeof err}`);
  }
}

/** The unverified request a link's token names, or null. */
export async function requestOfToken(db: SqlDb, token: string | undefined): Promise<{ id: string; request_type: RequestType } | null> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  return firstRow<{ id: string; request_type: RequestType }>(
    db.prepare(`SELECT id, request_type FROM privacy_requests WHERE verify_hash = ? AND status = 'unverified'`).bind(await sha256Hex(token)),
  );
}

/** The link was followed: the address is proven, the clocks start, the token is spent. */
export async function verifyRequest(db: SqlDb, token: string | undefined, nowMs: number): Promise<string | null> {
  const row = await requestOfToken(db, token);
  if (row === null) return null;
  const now = new Date(nowMs).toISOString();
  const d = deadlinesFrom(nowMs, row.request_type);
  const r = await run(
    db
      .prepare(
        `UPDATE privacy_requests SET status = 'new', verified_at = ?, ack_due_at = ?, resolve_due_at = ?, statutory_due_at = ?, verify_hash = NULL, purge_at = NULL, status_at = ?, status_history = ? WHERE id = ? AND status = 'unverified'`,
      )
      .bind(now, d.ackDueAt, d.resolveDueAt, d.statutoryDueAt, now, JSON.stringify([{ from: 'unverified', to: 'new', at: now, by: 'link' }]), row.id),
  );
  return r.meta.changes === 1 ? row.id : null;
}

export interface OverdueRow extends ClockRow {
  id: string;
  request_type: string;
  app_id: string;
  verified_at: string | null;
  paged_at: string | null;
}

/**
 * Every open, verified request that is RED, at most MAX_OVERDUE_PER_RUN, with the
 * ones not paged in the last day marked due. Reads only; the caller pages.
 */
export async function overdueRequests(db: SqlDb, nowMs: number): Promise<{ red: OverdueRow[]; due: OverdueRow[]; amber: number }> {
  const rows = await allRows<OverdueRow>(
    db
      .prepare(
        `SELECT id, request_type, app_id, status, verified_at, ack_due_at, resolve_due_at, statutory_due_at, acknowledged_at, paged_at FROM privacy_requests WHERE status IN ('new', 'acknowledged') ORDER BY resolve_due_at LIMIT ?`,
      )
      .bind(MAX_OVERDUE_PER_RUN),
  );
  const red = rows.filter((r) => clockOf(r, nowMs) === 'red');
  const amber = rows.filter((r) => clockOf(r, nowMs) === 'amber').length;
  const due = red.filter((r) => r.paged_at === null || nowMs - Date.parse(r.paged_at) >= DAY_MS);
  return { red, due, amber };
}

/** One page line per overdue request: its id, type, app and which promise it broke. Never the requester. */
export function pageLine(r: OverdueRow, nowMs: number): string {
  const days = r.verified_at ? Math.floor((nowMs - Date.parse(r.verified_at)) / DAY_MS) : 0;
  const what = r.acknowledged_at === null && nowMs > Date.parse(r.ack_due_at ?? '') ? 'not acknowledged within 48 h' : 'not resolved within 30 days';
  return `${r.id} (${r.request_type}, ${r.app_id}) day ${days}: ${what}`;
}

export async function markPaged(db: SqlDb, ids: string[], nowMs: number): Promise<void> {
  if (ids.length === 0) return;
  const at = new Date(nowMs).toISOString();
  await db.batch(ids.map((id) => db.prepare('UPDATE privacy_requests SET paged_at = ? WHERE id = ?').bind(at, id)));
}

/** Purge what is past its `purge_at`: unproven requests after 7 days, closed ones after 400. An open request has none. */
export async function purgePrivacy(db: SqlDb, nowMs: number): Promise<number> {
  const r = await run(
    db.prepare(`DELETE FROM privacy_requests WHERE purge_at IS NOT NULL AND purge_at <= ? AND status IN ('unverified', 'resolved', 'refused')`).bind(new Date(nowMs).toISOString()),
  );
  return r.meta.changes ?? 0;
}

/** The purge instant a closed request takes. */
export const closedPurgeAt = (nowMs: number): string => new Date(nowMs + CLOSED_RETENTION_DAYS * DAY_MS).toISOString();
