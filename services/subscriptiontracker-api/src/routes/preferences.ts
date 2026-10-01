// ─────────────────────────────────────────────────────────────────────────────
// /v1/preferences — the caller's preferences, ONE ROW PER KEY (audit D11, ST-N6).
//
// ⏱ 2026-09-30 · lead ruling on #1080: PER KEY, SERVER-ORDERED, NEVER THE WHOLE
// DOCUMENT. The first draft replaced one document whole, so a stale device
// overwrote keys another device had changed, and an older build erased keys it
// did not know. Now:
//
//   GET    → { preferences: { <key>: { value, version, updated_at } } }
//   PATCH  { changes: { <key>: { value, base_version } } }
//          → { preferences: { <key>: { value, version, updated_at } },
//              conflicts: [<key>…] }
//
// 🔴 THE SERVER ORDERS. Each key's `version` is bumped here and nowhere else,
// and `updated_at` is server time. A change based on version N is accepted
// while the row is still at N or below; when the row is NEWER, another device
// got there first — that key is a CONFLICT, the server keeps its value, and the
// answer carries the current value and version for the client to apply. Keys
// in one PATCH are judged independently: a conflict on one never refuses the
// others. There is no whole-document write at all.
//
// 🔴 EVERY KEY IS VALIDATED, AND AN UNKNOWN KEY IS A 400 THAT WRITES NOTHING.
// A value is applied without a prompt on every device the user signs in on, so
// one this route did not understand would be one some client applies blind.
// The set is closed on purpose; a new preference is a code change here,
// deployed BEFORE the client that sends it. The client's key set is pinned
// against this validator by test/fixtures/preferences-contract.json, read by
// both this Worker's tests and the app's.
//
// 🔴 THE BODY IS BOUNDED BEFORE IT IS PARSED (services/_shared/src/body.ts):
// over MAX_BODY_BYTES is a 413 `preferences_too_large`.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { allRows, nowIso } from '../lib/d1';
import { readBoundedBody } from '../lib/body';

const app = new Hono<AppEnv>();

/** @ceiling none — 16 KiB, the ruling's cap on one PATCH body. An input shape, not a platform resource. */
export const MAX_BODY_BYTES = 16 * 1024;
/**
 * Keys one PATCH may carry.
 *
 * @ceiling d1.queriesPerInvocation lte
 * One PATCH is ONE count read, ONE batch of one upsert per key, and ONE read
 * of the answer: MAX_PATCH_KEYS + 2 = 22 statements against D1's Free ceiling
 * of 50 per invocation, under either reading of that ceiling (per statement or
 * per round-trip). A client sends only the keys the user changed, so a real
 * PATCH carries one or two.
 */
export const MAX_PATCH_KEYS = 20;
/** @ceiling none — named on/off switches one account may hold. An input shape, not a platform resource. */
export const MAX_SWITCHES = 32;
/** @ceiling none — the widest language tag stored. An input shape, not a platform resource. */
const MAX_LOCALE_LENGTH = 16;
/** @ceiling none — the longest reminder lead accepted, in days. An input shape, not a platform resource. */
const MAX_LEAD_DAYS = 365;

const THEME_MODES = new Set(['system', 'light', 'dark']);
const CURRENCY_CODE = /^[A-Z]{3}$/;
const LOCALE_TAG = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/;
/** `switch.<name>`; the name is an identifier, never free text (review #1080 finding 9). */
const SWITCH_KEY = /^switch\.[A-Za-z][A-Za-z0-9_]{0,31}$/;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why `value` is not acceptable for `key`, or null when it is. */
export function refusalOf(key: string, value: unknown): string | null {
  switch (key) {
    case 'currencyCode':
      return typeof value === 'string' && CURRENCY_CODE.test(value) ? null : 'currencyCode must be an ISO 4217 code';
    case 'themeMode':
      return typeof value === 'string' && THEME_MODES.has(value) ? null : 'themeMode must be system, light or dark';
    case 'locale':
      // '' means "follow the device", which is a choice and is kept.
      return typeof value === 'string' &&
        value.length <= MAX_LOCALE_LENGTH &&
        (value === '' || LOCALE_TAG.test(value))
        ? null
        : 'locale must be a language tag or ""';
    case 'reminderLeadDays':
      return isInt(value) && value >= 0 && value <= MAX_LEAD_DAYS
        ? null
        : `reminderLeadDays must be an integer 0..${MAX_LEAD_DAYS}`;
    case 'reminderMinuteOfDay':
      return isInt(value) && value >= 0 && value < 24 * 60 ? null : 'reminderMinuteOfDay must be an integer 0..1439';
    default:
      if (SWITCH_KEY.test(key)) return typeof value === 'boolean' ? null : `${key} must be a boolean`;
      return `unknown preference "${key.slice(0, 40)}"`;
  }
}

export interface Change {
  key: string;
  value: unknown;
  baseVersion: number;
}
type Checked = { ok: true; changes: Change[] } | { ok: false; detail: string };

/** Full validation of a PATCH body; a 400 detail instead of a throw, so no write sees an unchecked value. */
export function validatePatch(body: unknown): Checked {
  if (!isObject(body) || !isObject(body.changes)) {
    return { ok: false, detail: 'body must be {"changes": {<key>: {"value", "base_version"}}}' };
  }
  const entries = Object.entries(body.changes);
  if (entries.length === 0) return { ok: false, detail: 'changes is empty' };
  if (entries.length > MAX_PATCH_KEYS) {
    return { ok: false, detail: `changes has ${entries.length} keys, the maximum is ${MAX_PATCH_KEYS}` };
  }
  const changes: Change[] = [];
  for (const [key, change] of entries) {
    if (!isObject(change)) return { ok: false, detail: `changes.${key.slice(0, 40)} must be an object` };
    const refused = refusalOf(key, change.value);
    if (refused) return { ok: false, detail: refused };
    const base = change.base_version;
    if (!isInt(base) || base < 0) {
      return { ok: false, detail: `changes.${key}.base_version must be a non-negative integer` };
    }
    changes.push({ key, value: change.value, baseVersion: base });
  }
  return { ok: true, changes };
}

interface Row {
  key: string;
  value: string;
  version: number;
  updated_at: string;
}

type Current = Record<string, { value: unknown; version: number; updated_at: string }>;

function documentOf(rows: Row[]): Current {
  const out: Current = {};
  for (const r of rows) {
    let value: unknown;
    try {
      value = JSON.parse(r.value);
    } catch {
      continue; // every row this route wrote is JSON; anything else is not a preference
    }
    out[r.key] = { value, version: r.version, updated_at: r.updated_at };
  }
  return out;
}

// GET / — every key the account holds, each with its version.
app.get('/', async (c) => {
  const rows = await allRows<Row>(
    c.env.APP_DB.prepare('SELECT key, value, version, updated_at FROM preferences WHERE user_id = ?').bind(
      c.get('userId'),
    ),
  );
  return c.json({ preferences: documentOf(rows) });
});

// PATCH / — the changed keys only, each judged against the version it was based on.
app.patch('/', async (c) => {
  const read = await readBoundedBody(c.req.raw, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.status === 413
      ? c.json({ error: 'preferences_too_large', limit_bytes: MAX_BODY_BYTES }, 413)
      : c.json({ error: read.error }, 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const checked = validatePatch(body);
  if (!checked.ok) return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  const userId = c.get('userId');
  const db = c.env.APP_DB;
  const keys = checked.changes.map((ch) => ch.key);

  // The switch count, bounded BEFORE a new switch row can exist.
  const newSwitches = keys.filter((k) => k.startsWith('switch.'));
  if (newSwitches.length > 0) {
    const held = await allRows<{ key: string }>(
      db.prepare("SELECT key FROM preferences WHERE user_id = ? AND key LIKE 'switch.%'").bind(userId),
    );
    const after = new Set([...held.map((r) => r.key), ...newSwitches]);
    if (after.size > MAX_SWITCHES) {
      return c.json({ error: 'invalid_body', detail: `an account holds at most ${MAX_SWITCHES} switches` }, 400);
    }
  }

  // One batch: per key, insert at version 1 or update WHERE the stored version is
  // not newer than the base. RETURNING answers only the rows actually written,
  // so a key missing from the answer is exactly a conflict.
  const ts = nowIso();
  const upsert = db.prepare(
    `INSERT INTO preferences (user_id, key, value, version, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET
       value = excluded.value,
       version = preferences.version + 1,
       updated_at = excluded.updated_at
     WHERE preferences.version <= ?
     RETURNING key`,
  );
  const written = (await db.batch(
    checked.changes.map((ch) => upsert.bind(userId, ch.key, JSON.stringify(ch.value), ts, ch.baseVersion)),
  )) as Array<{ results?: Array<{ key: string }> }>;
  const accepted = new Set<string>();
  for (const r of written) for (const row of r.results ?? []) accepted.add(row.key);
  const conflicts = keys.filter((k) => !accepted.has(k));

  // The answer: every key of this PATCH as it now stands. One bound read of the
  // account's rows (at most 5 + MAX_SWITCHES), filtered here — no SQL is built.
  const asked = new Set(keys);
  const rows = (
    await allRows<Row>(
      db.prepare('SELECT key, value, version, updated_at FROM preferences WHERE user_id = ?').bind(userId),
    )
  ).filter((r) => asked.has(r.key));
  return c.json({ preferences: documentOf(rows), conflicts });
});

export default app;
