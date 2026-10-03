// ─────────────────────────────────────────────────────────────────────────────
// report.ts — the report a client sends, validated WHOLE before anything is
// written (lane feedback-intake, Do 3, 6, 9 and 10).
//
// STRICT BY CONSTRUCTION. Every object here has a closed key set and an unknown
// key is a 400, never ignored: the payload is what the user saw in the preview,
// and a key the preview did not show is data nobody consented to send. Three
// consequences are the brief's red controls:
//   · `diagnostics` takes device CLASS (phone | tablet | desktop), never a model
//     or an identifier — there is no key to put one in;
//   · `logs` exists only when the user opted in; the client sends no key at all
//     otherwise, and this module never invents one;
//   · a key named `url`, ANYWHERE in the payload, is refused (`url_refused`): an
//     extension reports its own UI state, never the page it was opened on.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CATEGORIES,
  LOG_LINE_CHARS,
  MAX_ERROR_CODES,
  MAX_LINKS,
  MAX_LOG_LINES,
  MAX_TEXT_CHARS,
  MIN_FILL_MS,
  SURFACES,
  type Category,
  type Surface,
} from './limits';
import { linkCount, maskPii } from './mask';

export const DEVICE_CLASSES = ['phone', 'tablet', 'desktop'] as const;
export const THEMES = ['light', 'dark', 'system'] as const;

export interface Diagnostics {
  appVersion?: string;
  build?: string;
  channel?: string;
  platform?: string;
  osVersion?: string;
  deviceClass?: (typeof DEVICE_CLASSES)[number];
  locale?: string;
  textScale?: number;
  theme?: (typeof THEMES)[number];
  errorCodes?: string[];
  crashEventId?: string;
  logs?: string[];
}

export interface Report {
  idempotencyKey: string;
  appId: string;
  surface: Surface;
  category: Category;
  description: string;
  steps: string | null;
  diagnostics: Diagnostics;
  reply: boolean;
  notifyFixed: boolean;
  contactEmail: string | null;
  /** True when the honeypot was filled: accepted, and dropped. */
  honeypot: boolean;
}

export type Parsed = { ok: true; report: Report } | { ok: false; status: 400 | 413 | 422; error: string; field?: string };

const REPORT_KEYS = new Set([
  'idempotencyKey',
  'appId',
  'surface',
  'category',
  'description',
  'steps',
  'diagnostics',
  'consent',
  'contactEmail',
  'website',
  'elapsedMs',
]);
const DIAGNOSTIC_KEYS = new Set([
  'appVersion',
  'build',
  'channel',
  'platform',
  'osVersion',
  'deviceClass',
  'locale',
  'textScale',
  'theme',
  'errorCodes',
  'crashEventId',
  'logs',
]);
const CONSENT_KEYS = new Set(['reply', 'notifyFixed']);

const ID = /^[a-z][a-z0-9-]{1,40}$/;
const IDEMPOTENCY = /^[A-Za-z0-9-]{8,64}$/;
const SHORT = /^[\w .+:/()-]{1,64}$/;
const LOCALE = /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const EVENT_ID = /^[0-9a-f]{32}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True when any object at any depth carries a key named `url` (any case). */
export function carriesUrlKey(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(carriesUrlKey);
  if (!isObject(v)) return false;
  return Object.entries(v).some(([k, x]) => k.toLowerCase() === 'url' || carriesUrlKey(x));
}

const bad = (error: string, field?: string, status: 400 | 413 | 422 = 400): Parsed => ({ ok: false, status, error, field });

function text(v: unknown, field: string, required: boolean): string | null | Parsed {
  if (v === undefined || v === null || v === '') return required ? bad('required', field, 422) : null;
  if (typeof v !== 'string') return bad('not_a_string', field);
  const t = v.trim();
  if (required && t === '') return bad('required', field, 422);
  if ([...t].length > MAX_TEXT_CHARS) return bad('too_long', field, 413);
  return t === '' ? null : t;
}

function parseDiagnostics(v: unknown): Diagnostics | Parsed {
  if (v === undefined) return {};
  if (!isObject(v)) return bad('not_an_object', 'diagnostics');
  const out: Diagnostics = {};
  for (const [k, x] of Object.entries(v)) {
    if (!DIAGNOSTIC_KEYS.has(k)) return bad('unknown_key', `diagnostics.${k}`);
    if (x === null || x === undefined) continue;
    switch (k) {
      case 'appVersion':
      case 'build':
      case 'channel':
      case 'platform':
      case 'osVersion':
        if (typeof x !== 'string' || !SHORT.test(x)) return bad('invalid', `diagnostics.${k}`);
        out[k] = x;
        break;
      case 'deviceClass':
        if (!(DEVICE_CLASSES as readonly unknown[]).includes(x)) return bad('invalid', 'diagnostics.deviceClass');
        out.deviceClass = x as Diagnostics['deviceClass'];
        break;
      case 'theme':
        if (!(THEMES as readonly unknown[]).includes(x)) return bad('invalid', 'diagnostics.theme');
        out.theme = x as Diagnostics['theme'];
        break;
      case 'locale':
        if (typeof x !== 'string' || !LOCALE.test(x)) return bad('invalid', 'diagnostics.locale');
        out.locale = x;
        break;
      case 'textScale':
        if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0 || x > 5) return bad('invalid', 'diagnostics.textScale');
        out.textScale = x;
        break;
      case 'errorCodes':
        if (!Array.isArray(x) || x.length > MAX_ERROR_CODES || !x.every((c) => typeof c === 'string' && CODE.test(c))) {
          return bad('invalid', 'diagnostics.errorCodes');
        }
        out.errorCodes = x as string[];
        break;
      case 'crashEventId':
        if (typeof x !== 'string' || !EVENT_ID.test(x)) return bad('invalid', 'diagnostics.crashEventId');
        out.crashEventId = x;
        break;
      case 'logs':
        // Present ONLY when the user opted in; the client scrubbed each line with
        // packages/telemetry's scrub, and the server masks again.
        if (!Array.isArray(x) || x.length > MAX_LOG_LINES || !x.every((l) => typeof l === 'string')) {
          return bad('invalid', 'diagnostics.logs');
        }
        out.logs = (x as string[]).map((l) => maskPii(l.slice(0, LOG_LINE_CHARS)));
        break;
    }
  }
  return out;
}

const isParsed = (v: unknown): v is Parsed => isObject(v) && 'ok' in v && (v as { ok: unknown }).ok === false;

/** `body` (the decoded report JSON) as a Report, or the first reason it is not one. */
export function parseReport(body: unknown): Parsed {
  if (!isObject(body)) return bad('not_an_object');
  if (carriesUrlKey(body)) return bad('url_refused', 'url');
  for (const k of Object.keys(body)) if (!REPORT_KEYS.has(k)) return bad('unknown_key', k);

  const honeypot = typeof body.website === 'string' && body.website.trim() !== '';

  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY.test(body.idempotencyKey)) return bad('invalid', 'idempotencyKey');
  if (typeof body.appId !== 'string' || !ID.test(body.appId)) return bad('invalid', 'appId');
  if (!(SURFACES as readonly unknown[]).includes(body.surface)) return bad('invalid', 'surface');
  if (!(CATEGORIES as readonly unknown[]).includes(body.category)) return bad('invalid', 'category');

  const description = text(body.description, 'description', true);
  if (isParsed(description)) return description;
  const steps = text(body.steps, 'steps', false);
  if (isParsed(steps)) return steps;
  if (linkCount(`${description ?? ''}\n${steps ?? ''}`) > MAX_LINKS) return bad('too_many_links', 'description', 422);

  if (typeof body.elapsedMs !== 'number' || !Number.isFinite(body.elapsedMs)) return bad('invalid', 'elapsedMs');
  if (body.elapsedMs < MIN_FILL_MS) return bad('too_fast', 'elapsedMs', 422);

  const diagnostics = parseDiagnostics(body.diagnostics);
  if (isParsed(diagnostics)) return diagnostics;

  const consent = body.consent ?? {};
  if (!isObject(consent)) return bad('not_an_object', 'consent');
  for (const k of Object.keys(consent)) if (!CONSENT_KEYS.has(k)) return bad('unknown_key', `consent.${k}`);
  const reply = consent.reply === true;
  const notifyFixed = consent.notifyFixed === true;

  let contactEmail: string | null = null;
  if (body.contactEmail !== undefined && body.contactEmail !== null && body.contactEmail !== '') {
    if (typeof body.contactEmail !== 'string' || !EMAIL.test(body.contactEmail.trim())) return bad('invalid', 'contactEmail');
    // Kept ONLY with a box ticked that needs it — "you may reply to me" or
    // "tell me when it is fixed"; otherwise it is dropped here.
    contactEmail = reply || notifyFixed ? body.contactEmail.trim().toLowerCase() : null;
  }

  return {
    ok: true,
    report: {
      idempotencyKey: body.idempotencyKey,
      appId: body.appId,
      surface: body.surface as Surface,
      category: body.category as Category,
      description: maskPii(description as string),
      steps: steps === null ? null : maskPii(steps as string),
      diagnostics,
      reply,
      notifyFixed,
      contactEmail,
      honeypot,
    },
  };
}
