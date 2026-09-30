// ─────────────────────────────────────────────────────────────────────────────
// /v1/preferences — the caller's preferences document (audit D11, ST-N6).
//
// ⏱ 2026-09-30. Preferences lived only on the device, so a second device met
// the defaults and a change on one never reached the other. The app now keeps
// the device store as a CACHE and this row as the account's copy:
// packages/core AccountPreferencesSync decides when each is read and written.
//
//   GET  → { preferences: {…} | null }   null = the account has none yet
//   PUT  { preferences: {…} }            replaces the document whole
//
// 🔴 EVERY KEY IS VALIDATED, AND AN UNKNOWN KEY IS A 400. The document is
// written back to every device the user signs in on, and applied there without
// a prompt — so a value this route did not understand would be a value some
// client applies blind. The set is small and closed on purpose; a new
// preference is a code change here, deployed BEFORE the client that sends it.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { firstRow, nowIso } from '../lib/d1';

const app = new Hono<AppEnv>();

interface PreferencesRow {
  document: string;
}

/** @ceiling none — how many named on/off switches a document may carry. An input shape, not a resource. */
const MAX_SWITCHES = 32;
/** @ceiling none — one switch name's width. An input shape, not a resource. */
const MAX_SWITCH_NAME = 32;
/** @ceiling none — the widest language tag stored. An input shape, not a resource. */
const MAX_LOCALE_LENGTH = 16;
/** @ceiling none — the longest reminder lead accepted, in days. An input shape, not a resource. */
const MAX_LEAD_DAYS = 365;

const THEME_MODES = new Set(['system', 'light', 'dark']);
const CURRENCY_CODE = /^[A-Z]{3}$/;
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/;

type Checked = { ok: true; document: Record<string, unknown> } | { ok: false; detail: string };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Full validation; returns a 400 detail instead of throwing, so no write sees an unchecked value. */
export function validatePreferences(body: unknown): Checked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, detail: 'body must be a JSON object' };
  }
  const doc = (body as { preferences?: unknown }).preferences;
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { ok: false, detail: 'preferences must be a JSON object' };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    switch (key) {
      case 'currencyCode':
        if (typeof value !== 'string' || !CURRENCY_CODE.test(value)) {
          return { ok: false, detail: 'currencyCode must be an ISO 4217 code' };
        }
        break;
      case 'themeMode':
        if (typeof value !== 'string' || !THEME_MODES.has(value)) {
          return { ok: false, detail: 'themeMode must be system, light or dark' };
        }
        break;
      case 'locale':
        // '' means "follow the device", which is a choice and is kept.
        if (
          typeof value !== 'string' ||
          value.length > MAX_LOCALE_LENGTH ||
          (value !== '' && !LOCALE_TAG.test(value))
        ) {
          return { ok: false, detail: 'locale must be a language tag or ""' };
        }
        break;
      case 'reminderLeadDays':
        if (!isInt(value) || value < 0 || value > MAX_LEAD_DAYS) {
          return { ok: false, detail: `reminderLeadDays must be an integer 0..${MAX_LEAD_DAYS}` };
        }
        break;
      case 'reminderMinuteOfDay':
        if (!isInt(value) || value < 0 || value >= 24 * 60) {
          return { ok: false, detail: 'reminderMinuteOfDay must be an integer 0..1439' };
        }
        break;
      case 'prefs': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { ok: false, detail: 'prefs must be an object of booleans' };
        }
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length > MAX_SWITCHES) {
          return { ok: false, detail: `prefs has ${entries.length} switches, the maximum is ${MAX_SWITCHES}` };
        }
        for (const [name, on] of entries) {
          if (name === '' || name.length > MAX_SWITCH_NAME || typeof on !== 'boolean') {
            return { ok: false, detail: `prefs.${name.slice(0, MAX_SWITCH_NAME)} must be a boolean` };
          }
        }
        break;
      }
      default:
        return { ok: false, detail: `unknown preference "${key.slice(0, MAX_SWITCH_NAME)}"` };
    }
    out[key] = value;
  }
  return { ok: true, document: out };
}

// GET / — the stored document, or null when the account has none yet.
app.get('/', async (c) => {
  const row = await firstRow<PreferencesRow>(
    c.env.APP_DB.prepare('SELECT document FROM preferences WHERE user_id = ?').bind(c.get('userId')),
  );
  let preferences: unknown = null;
  if (row) {
    try {
      preferences = JSON.parse(row.document);
    } catch {
      // Every row this route wrote is JSON; anything else is not a document.
      preferences = null;
    }
  }
  return c.json({ preferences });
});

// PUT / — replace the document whole, validated before the write.
app.put('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const checked = validatePreferences(body);
  if (!checked.ok) {
    return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  }
  await c.env.APP_DB.prepare(
    `INSERT INTO preferences (user_id, document, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       document = excluded.document,
       updated_at = excluded.updated_at`,
  )
    .bind(c.get('userId'), JSON.stringify(checked.document), nowIso())
    .run();
  return c.json({ preferences: checked.document });
});

export default app;
