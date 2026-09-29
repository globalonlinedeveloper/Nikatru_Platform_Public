// ─────────────────────────────────────────────────────────────────────────────
// /v1/subscriptions — user-scoped CRUD. All rows are keyed by c.get('userId').
// JSON is snake_case matching the DB columns; `unused` (0/1) serializes to bool
// and `reminder_days` (JSON text) to the list it holds.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { AppEnv, Payment, Subscription } from '../types';
import { allRows, firstRow, nowIso, run, uuid } from '../lib/d1';
import {
  isBoundedString,
  isCalendarDate,
  isFiniteNumber,
  isPlainObject,
  type Invalid,
} from '../lib/validate';

const app = new Hono<AppEnv>();

/**
 * `reminder_days` is stored as the JSON text this route wrote and served as the
 * list itself. Only `validate` below writes the column, so a parse failure
 * means a row edited outside this Worker; it is served as NULL ("use the
 * account default") rather than failing the whole list.
 */
function reminderDaysOf(raw: string | null): number[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((d) => Number.isSafeInteger(d)) ? (v as number[]) : null;
  } catch {
    return null;
  }
}

/**
 * DB row -> API JSON (0/1 `unused` becomes a real boolean).
 *
 * Exported because /v1/renewals serves the same rows: two serializers for one
 * row is how the 0003 columns would have reached one endpoint and not the other.
 *
 * 🔴 EVERY KEY BELOW `updated_at` IS ADDITIVE. A client that predates 0003
 * ignores them (Subscription.fromJson reads named keys), and `price` and `cycle`
 * keep their old meaning, so it reads exactly what it read before. `currency` is
 * NULL on every row written before 0003: the client decodes that with the
 * user's own currency (ST-C1), which is the unit those rows were typed in.
 */
export function serializeSubscription(row: Subscription) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    category: row.category,
    price: row.price,
    cycle: row.cycle,
    next_renewal: row.next_renewal,
    plan: row.plan,
    glyph: row.glyph,
    used_pct: row.used_pct,
    usage_note: row.usage_note,
    unused: row.unused === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    currency: row.currency,
    price_minor: row.price_minor,
    cycle_every: row.cycle_every,
    cycle_unit: row.cycle_unit,
    first_charge_on: row.first_charge_on,
    status: row.status,
    trial_ends_on: row.trial_ends_on,
    cancelled_on: row.cancelled_on,
    deleted_at: row.deleted_at,
    notes: row.notes,
    service_id: row.service_id,
    cancel_url: row.cancel_url,
    rail: row.rail,
    rail_holder: row.rail_holder,
    reminder_days: reminderDaysOf(row.reminder_days),
    shared_with: row.shared_with,
    share_numerator: row.share_numerator,
    share_denominator: row.share_denominator,
    // 0004_notice_days.sql (ST-R8). `?? null`: a DB 0004 has not reached yields
    // no such key on the row, and the wire says null ("no notice period").
    notice_days: row.notice_days ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION — same shape as routes/budget.ts's `validate`: check the WHOLE body
// and return a 400 `detail`, never throw, and never let an unchecked value reach
// a bind.
//
// The `CreateBody` interface that used to stand here was deleted, not updated:
// it was the whole "validation" this route had, and a TS interface is erased
// before the request exists. Keeping it next to a real validator would only
// invite the next reader to trust it again.
//
// What was actually reachable before, all of it a 500 with no useful message:
//
//   · `JSON.parse('null')`/`'"x"'`/`'[]'` — a non-object body. `body.unused`
//     threw a TypeError on null before any check ran.
//   · `{"price":{}}` / `{"name":[]}` — an object bound straight into D1, which
//     answers D1_TYPE_ERROR. On PATCH that happens AFTER the ownership read, so
//     the caller cannot tell "not yours" from "bad value".
//   · `{"cycle":"weekly"}` — violates the `CHECK (cycle IN ('monthly','yearly'))`
//     in 0001_init.sql, so the DATABASE rejected it as a 500 rather than the
//     route rejecting it as a 400.
//   · `{"next_renewal":"soon"}` — accepted and stored. /v1/renewals compares
//     next_renewal as a STRING, so the row silently never appears in any renewal
//     window: a subscription the user is still paying for, invisible forever.
//   · unbounded strings — a megabyte `usage_note` per row, per user.
// ─────────────────────────────────────────────────────────────────────────────

/** Bounds. Generous enough for any real subscription, small enough to bound a row.
 *
 *  Every MAX_* string bound here is a COLUMN WIDTH on one row of one INSERT —
 *  an input shape, not a platform resource. The resource they touch is D1's
 *  maximum row size, whose ceiling is 2 MB; with 0003's columns their sum is
 *  under 8 KB, more than two orders of magnitude below it, so none of them can
 *  ever be the binding constraint. */
/** @ceiling none — column width; see the block above. */
const MAX_NAME = 200;
/** @ceiling none — column width; see the block above. */
const MAX_CATEGORY = 120;
/** @ceiling none — column width; see the block above. */
const MAX_PLAN = 200;
/** @ceiling none — column width; an emoji or short token, not a field. */
const MAX_GLYPH = 32;
/** @ceiling none — column width; see the block above. */
const MAX_NOTE = 1000;
/** @ceiling none — column width; the free-text `notes` 0003 added ([ADR 077] §5.1). */
const MAX_NOTES = 2000;
/** @ceiling none — column width; a label like "Google Pay · HDFC ••4471". */
const MAX_RAIL_HOLDER = 120;
/** @ceiling none — column width; a label, not a list of accounts. */
const MAX_SHARED_WITH = 200;
/** @ceiling none — column width; one catalogue key. */
const MAX_SERVICE_ID = 64;
/** @ceiling none — column width; the longest URL browsers reliably keep. */
const MAX_CANCEL_URL = 2048;
/**
 * Upper bound on `price`. Deliberately generous: the app ships to six platforms
 * worldwide — a real yearly subscription is ~2 600 000 in VND and ~1 800 000 in
 * IDR, so a "sensible" 1 000 000 cap would 400 legitimate first-party traffic in
 * those markets. The bound exists to keep a typo out of a REAL column and to
 * keep the value well inside exact-integer range, not to police what a
 * subscription may cost.
 *
 * @ceiling none — a VALUE bound on one numeric column, not a resource bound. Its
 * real right-hand side is Number.MAX_SAFE_INTEGER, a language limit.
 */
const MAX_PRICE = 1_000_000_000;
/**
 * Upper bound on `price_minor`: MAX_PRICE in a currency with four minor-unit
 * digits, the most ISO 4217 assigns. 10^13, well inside exact-integer range.
 *
 * @ceiling none — a VALUE bound on one numeric column, derived from MAX_PRICE.
 */
const MAX_PRICE_MINOR = MAX_PRICE * 10_000;
/**
 * Upper bound on `cycle_every`: a year counted in the finest unit. A longer
 * cadence is written in a coarser unit ("every 2 years", not "every 730 days").
 *
 * @ceiling none — a VALUE bound on one numeric column, not a resource bound.
 */
const MAX_CYCLE_EVERY = 366;
/** @ceiling none — a list length on one column; the spec's example is [7,1]. */
const MAX_REMINDERS = 5;
/** @ceiling none — a VALUE bound: a reminder at most a year before the charge. */
const MAX_REMINDER_DAY = 365;
/** @ceiling none — a VALUE bound: a notice period at most a year before the
 *  charge, the same year MAX_REMINDER_DAY allows a reminder (0004, ST-R8). */
const MAX_NOTICE_DAYS = 365;
/** @ceiling none — a VALUE bound: "your share of N", N people at most. */
const MAX_SHARE_DENOMINATOR = 100;

/** The closed sets 0003 deliberately did NOT put in a CHECK (see its header):
 *  a new member here is a code change, where in SQL it would be a rebuild. */
const STATUSES = ['active', 'trialing', 'paused', 'cancelled'] as const;
/**
 * ⏳ THE STATUSES A ROW MAY BE GIVEN TODAY — not yet `paused` or `cancelled`.
 * Nothing that reads rows skips them yet: the platform fan-out
 * (services/platform/src/renewals.ts) would keep rolling a cancelled row's
 * `next_renewal` and writing payments for charges that never happen, and
 * /v1/renewals would keep listing it as due. ST-E3 ("Mark cancelled / Pause
 * keep the row") widens this in the same change that teaches those readers.
 * `deleted_at` waits for the same readers — see `validate`.
 */
const STATUSES_ACCEPTED = ['active', 'trialing'] as const;
const RAILS = [
  'upi_autopay',
  'card_emandate',
  'nach',
  'app_store',
  'play',
  'paypal',
  'manual',
  'unknown',
] as const;
const CYCLE_UNITS = ['day', 'week', 'month', 'year'] as const;

/** ISO 4217 is three letters; stored upper case, as the client reads it. */
const CURRENCY = /^[A-Za-z]{3}$/;
/** A catalogue key: lower-case, no spaces, nothing a URL or a file path would
 *  need to escape. */
const SERVICE_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** Columns this route will write, and the checked value for each. */
type Column =
  | 'name'
  | 'category'
  | 'price'
  | 'cycle'
  | 'next_renewal'
  | 'plan'
  | 'glyph'
  | 'used_pct'
  | 'usage_note'
  | 'unused'
  | 'currency'
  | 'price_minor'
  | 'cycle_every'
  | 'cycle_unit'
  | 'first_charge_on'
  | 'status'
  | 'trial_ends_on'
  | 'cancelled_on'
  | 'deleted_at'
  | 'notes'
  | 'service_id'
  | 'cancel_url'
  | 'rail'
  | 'rail_holder'
  | 'reminder_days'
  | 'shared_with'
  | 'share_numerator'
  | 'share_denominator'
  | 'notice_days';

/** Only the keys the body actually carried — PATCH must not touch the others. */
type Fields = Partial<Record<Column, string | number | null>>;

type ValidatedSubscription = { ok: true; fields: Fields } | Invalid;

const invalid = (detail: string): Invalid => ({ ok: false, detail });

/** Nullable free-text columns and their length caps. */
const TEXT_COLUMNS: ReadonlyArray<readonly [Column, number]> = [
  ['name', MAX_NAME],
  ['category', MAX_CATEGORY],
  ['plan', MAX_PLAN],
  ['glyph', MAX_GLYPH],
  ['usage_note', MAX_NOTE],
  ['notes', MAX_NOTES],
  ['rail_holder', MAX_RAIL_HOLDER],
  ['shared_with', MAX_SHARED_WITH],
];

/** Nullable 'YYYY-MM-DD' columns. */
const DATE_COLUMNS: ReadonlyArray<Column> = [
  'next_renewal',
  'first_charge_on',
  'trial_ends_on',
  'cancelled_on',
];

/**
 * The legacy `cycle` a cadence means: 'monthly' for every 1 month, 'yearly' for
 * every 1 year, NULL for anything else. 0001's CHECK admits nothing more, and
 * the platform fan-out rolls `next_renewal` by `cycle` alone and skips NULL — so
 * NULL is what keeps a weekly row from being rolled forward a month.
 */
function legacyCycle(every: number, unit: string): 'monthly' | 'yearly' | null {
  if (every !== 1) return null;
  if (unit === 'month') return 'monthly';
  if (unit === 'year') return 'yearly';
  return null;
}

/**
 * Full-body validation shared by POST and PATCH. Returns the CHECKED value for
 * every key the body carried (explicit `null` is kept — it clears the column),
 * or a 400 detail string. Absent keys are absent from the result, which is what
 * lets PATCH stay a partial update without re-deriving the rules.
 */
function validate(body: unknown): ValidatedSubscription {
  if (!isPlainObject(body)) {
    return { ok: false, detail: 'body must be a JSON object' };
  }
  const fields: Fields = {};

  for (const [col, max] of TEXT_COLUMNS) {
    const v = body[col];
    if (v === undefined) continue;
    if (v === null) {
      fields[col] = null;
      continue;
    }
    if (!isBoundedString(v, max)) {
      return {
        ok: false,
        detail: `${col} must be a string of at most ${max} characters`,
      };
    }
    fields[col] = v;
  }

  const price = body.price;
  if (price !== undefined) {
    if (price === null) {
      fields.price = null;
    } else if (!isFiniteNumber(price) || price < 0 || price > MAX_PRICE) {
      return {
        ok: false,
        detail: `price must be a finite number between 0 and ${MAX_PRICE}`,
      };
    } else {
      fields.price = price;
    }
  }

  const cycle = body.cycle;
  if (cycle !== undefined) {
    if (cycle === null) {
      fields.cycle = null;
    } else if (cycle !== 'monthly' && cycle !== 'yearly') {
      // 0001_init.sql: CHECK (cycle IN ('monthly','yearly')). Enforced here so
      // the caller gets a 400 that names the field instead of a D1 500.
      return { ok: false, detail: "cycle must be 'monthly' or 'yearly'" };
    } else {
      fields.cycle = cycle;
    }
  }

  for (const col of DATE_COLUMNS) {
    const v = body[col];
    if (v === undefined) continue;
    if (v === null) {
      fields[col] = null;
    } else if (!isCalendarDate(v)) {
      return invalid(`${col} must be a real calendar date as YYYY-MM-DD`);
    } else {
      fields[col] = v;
    }
  }

  const usedPct = body.used_pct;
  if (usedPct !== undefined) {
    if (usedPct === null) {
      fields.used_pct = null;
    } else if (!isFiniteNumber(usedPct) || usedPct < 0 || usedPct > 100) {
      return { ok: false, detail: 'used_pct must be a number between 0 and 100' };
    } else {
      // The column is INTEGER and the client sends an int; truncating keeps a
      // stray float out of an integer column rather than relying on affinity.
      fields.used_pct = Math.trunc(usedPct);
    }
  }

  const unused = body.unused;
  if (unused !== undefined) {
    // `null` clears, exactly as it does for every other nullable column above —
    // an explicit null meaning "clear" for `price` but 400 for `unused` would be
    // a rule nobody can remember. The column is nullable with DEFAULT 0.
    if (unused === null) {
      fields.unused = null;
    } else if (typeof unused !== 'boolean' && unused !== 0 && unused !== 1) {
      return { ok: false, detail: 'unused must be a boolean' };
    } else {
      fields.unused = unused === true || unused === 1 ? 1 : 0;
    }
  }

  // ── 0003: single-column rules ──────────────────────────────────────────────
  const currency = body.currency;
  if (currency !== undefined) {
    if (currency === null) {
      fields.currency = null;
    } else if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
      return invalid('currency must be a three-letter ISO 4217 code, e.g. INR');
    } else {
      // Upper-cased because Subscription.readPrice upper-cases what it reads;
      // storing 'inr' would make two spellings of one currency.
      fields.currency = currency.toUpperCase();
    }
  }

  const status = body.status;
  if (status !== undefined) {
    // NOT NULL DEFAULT 'active' in 0003, so there is no "clear" to ask for.
    if (!isOneOf(status, STATUSES)) {
      return invalid(`status must be one of ${STATUSES.join(', ')}`);
    }
    if (!isOneOf(status, STATUSES_ACCEPTED)) {
      return invalid(
        `status '${status}' is not accepted yet: the renewals readers would keep charging the row (ST-E3); use ${STATUSES_ACCEPTED.join(' or ')}`,
      );
    }
    fields.status = status;
  }

  const rail = body.rail;
  if (rail !== undefined) {
    if (rail === null) {
      fields.rail = null;
    } else if (!isOneOf(rail, RAILS)) {
      return invalid(`rail must be one of ${RAILS.join(', ')}`);
    } else {
      fields.rail = rail;
    }
  }

  const serviceId = body.service_id;
  if (serviceId !== undefined) {
    if (serviceId === null) {
      fields.service_id = null;
    } else if (!isBoundedString(serviceId, MAX_SERVICE_ID) || !SERVICE_ID.test(serviceId)) {
      return invalid(
        `service_id must be a catalogue key of at most ${MAX_SERVICE_ID} characters: a-z, 0-9, '.', '_' or '-'`,
      );
    } else {
      fields.service_id = serviceId;
    }
  }

  const cancelUrl = body.cancel_url;
  if (cancelUrl !== undefined) {
    if (cancelUrl === null) {
      fields.cancel_url = null;
    } else if (!isHttpUrl(cancelUrl, MAX_CANCEL_URL)) {
      // 🔴 THE CLIENT WILL OPEN THIS. A `javascript:` or `data:` URL stored here
      // is script the app hands to the platform's URL launcher, so only a web
      // address is a cancel URL.
      return invalid(`cancel_url must be an http(s) URL of at most ${MAX_CANCEL_URL} characters`);
    } else {
      fields.cancel_url = cancelUrl;
    }
  }

  const deletedAt = body.deleted_at;
  if (deletedAt !== undefined) {
    // ⏳ SERVED, NOT YET WRITABLE. A soft-deleted row would still be listed by
    // GET /, still be due in /v1/renewals and still be charged by the platform
    // fan-out, so setting it today would hide nothing and keep charging. ST-E3
    // (soft delete with Undo) makes it writable with those readers. `null` is
    // accepted: it is what every row already holds.
    if (deletedAt !== null) {
      return invalid('deleted_at cannot be set yet: nothing that lists or charges rows skips a deleted one (ST-E3)');
    }
    fields.deleted_at = null;
  }

  const reminders = body.reminder_days;
  if (reminders !== undefined) {
    if (reminders === null) {
      // NULL = "use the account default"; [] = "no reminder for this one".
      fields.reminder_days = null;
    } else if (
      !Array.isArray(reminders) ||
      reminders.length > MAX_REMINDERS ||
      !reminders.every((d) => isWholeNumber(d, 0, MAX_REMINDER_DAY)) ||
      new Set(reminders).size !== reminders.length
    ) {
      return invalid(
        `reminder_days must be a list of at most ${MAX_REMINDERS} different whole numbers of days, 0 to ${MAX_REMINDER_DAY}`,
      );
    } else {
      fields.reminder_days = JSON.stringify(reminders);
    }
  }

  // ── 0004: the notice period (ST-R8) ────────────────────────────────────────
  const notice = body.notice_days;
  if (notice !== undefined) {
    if (notice === null) {
      // NULL = no notice period: the plan can be cancelled up to the charge.
      fields.notice_days = null;
    } else if (!isWholeNumber(notice, 0, MAX_NOTICE_DAYS)) {
      return invalid(`notice_days must be a whole number of days, 0 to ${MAX_NOTICE_DAYS}`);
    } else {
      fields.notice_days = notice;
    }
  }

  // ── 0003: rules that span two keys ─────────────────────────────────────────
  // Each reads only THIS body, never the stored row, so POST and PATCH share
  // them and a PATCH needs no read before it can be judged.
  const cadence = checkCadence(body, fields);
  if (cadence) return cadence;
  const share = checkShare(body, fields);
  if (share) return share;
  const amount = checkExactAmount(body, fields);
  if (amount) return amount;

  return { ok: true, fields };
}

/** A value from a closed set. */
function isOneOf<T extends string>(v: unknown, set: readonly T[]): v is T {
  return typeof v === 'string' && (set as readonly string[]).includes(v);
}

/** An exact integer in [min, max] — a JSON number, never a numeric string. */
function isWholeNumber(v: unknown, min: number, max: number): v is number {
  return Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
}

/** An absolute http(s) URL with a host, no longer than [max]. */
function isHttpUrl(v: unknown, max: number): v is string {
  if (!isBoundedString(v, max)) return false;
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== '';
}

/**
 * THE CADENCE: `cycle_every` + `cycle_unit`, and the legacy `cycle` kept equal
 * to what the pair means (see `legacyCycle`).
 *
 *   · the pair travels together — half a cadence is not a cadence;
 *   · a body that sends the pair AND `cycle` must not contradict itself: a 400,
 *     never a silent pick of one;
 *   · a body that sends the pair alone gets `cycle` derived from it;
 *   · a body that sends `cycle` alone — every client before ST-T3b — gets the
 *     pair derived from it, so a row an old client edits never keeps a stale
 *     cadence beside a fresh `cycle`.
 */
function checkCadence(body: Record<string, unknown>, fields: Fields): Invalid | null {
  const every = body.cycle_every;
  const unit = body.cycle_unit;
  if ((every === undefined) !== (unit === undefined)) {
    return invalid('cycle_every and cycle_unit must be sent together');
  }
  if (every === undefined) {
    if (fields.cycle !== undefined) {
      fields.cycle_every = fields.cycle === null ? null : 1;
      fields.cycle_unit =
        fields.cycle === null ? null : fields.cycle === 'yearly' ? 'year' : 'month';
    }
    return null;
  }
  if (every === null || unit === null) {
    if (every !== null || unit !== null) {
      return invalid('cycle_every and cycle_unit must both be null to clear the cadence');
    }
    if (fields.cycle !== undefined && fields.cycle !== null) {
      return invalid('cycle must be null or absent when cycle_every and cycle_unit are null');
    }
    fields.cycle_every = null;
    fields.cycle_unit = null;
    fields.cycle = null;
    return null;
  }
  if (!isWholeNumber(every, 1, MAX_CYCLE_EVERY)) {
    return invalid(`cycle_every must be a whole number between 1 and ${MAX_CYCLE_EVERY}`);
  }
  if (!isOneOf(unit, CYCLE_UNITS)) {
    return invalid(`cycle_unit must be one of ${CYCLE_UNITS.join(', ')}`);
  }
  const legacy = legacyCycle(every, unit);
  if (fields.cycle !== undefined && fields.cycle !== legacy) {
    return invalid(
      `cycle contradicts cycle_every/cycle_unit: every ${every} ${unit} is cycle ${legacy === null ? 'null' : `'${legacy}'`}`,
    );
  }
  fields.cycle_every = every;
  fields.cycle_unit = unit;
  fields.cycle = legacy;
  return null;
}

/**
 * "Your share of N": both numbers travel together, 1 ≤ numerator ≤ denominator.
 * Both columns are NOT NULL DEFAULT 1, so 1/1 — not null — is how a share is
 * undone.
 */
function checkShare(body: Record<string, unknown>, fields: Fields): Invalid | null {
  const num = body.share_numerator;
  const den = body.share_denominator;
  if ((num === undefined) !== (den === undefined)) {
    return invalid('share_numerator and share_denominator must be sent together');
  }
  if (num === undefined) return null;
  if (!isWholeNumber(den, 1, MAX_SHARE_DENOMINATOR)) {
    return invalid(`share_denominator must be a whole number between 1 and ${MAX_SHARE_DENOMINATOR}`);
  }
  if (!isWholeNumber(num, 1, den)) {
    return invalid('share_numerator must be a whole number between 1 and share_denominator');
  }
  fields.share_numerator = num;
  fields.share_denominator = den;
  return null;
}

/**
 * `price_minor` is the exact form of `price` in `currency`, so it may only be
 * written with both, and it may never outlive a change to either.
 *
 *   · a whole number of minor units, 0 to MAX_PRICE_MINOR;
 *   · sent with a non-null `price` and `currency` in the SAME body. `price`
 *     stays the column every older reader uses (the fan-out copies it into
 *     payment_history), so an exact amount with no decimal beside it would
 *     leave the two disagreeing;
 *   · a body that changes `price` or `currency` WITHOUT `price_minor` clears
 *     it. Subscription.readPrice prefers `price_minor` when it is there, so a
 *     stale one would outrank the fresh decimal — a new price shown as the old,
 *     or ₹649.00 relabelled ¥64,900.
 */
function checkExactAmount(body: Record<string, unknown>, fields: Fields): Invalid | null {
  const minor = body.price_minor;
  if (minor === undefined) {
    if (fields.price !== undefined || fields.currency !== undefined) fields.price_minor = null;
    return null;
  }
  if (minor === null) {
    fields.price_minor = null;
    return null;
  }
  if (!isWholeNumber(minor, 0, MAX_PRICE_MINOR)) {
    return invalid(`price_minor must be a whole number between 0 and ${MAX_PRICE_MINOR}`);
  }
  if (
    fields.price === undefined ||
    fields.price === null ||
    fields.currency === undefined ||
    fields.currency === null
  ) {
    return invalid('price_minor must be sent with a price and a currency: the three describe one amount');
  }
  fields.price_minor = minor;
  return null;
}

// GET / — list, most expensive first.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await allRows<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY price DESC',
    ).bind(userId),
  );
  return c.json(rows.map(serializeSubscription));
});

// POST / — create.
app.post('/', async (c) => {
  const userId = c.get('userId');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // ── VALIDATE FIRST — nothing below this line may touch a row otherwise ──────
  const checked = validate(body);
  if (!checked.ok) {
    return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  }
  const f = checked.fields;

  const id = uuid();
  const ts = nowIso();

  // `status` and the share pair are NOT NULL DEFAULT in 0003; they are bound
  // with those same defaults because a named column bound to NULL is a
  // constraint failure, not a default.
  await run(
    c.env.APP_DB.prepare(
      `INSERT INTO subscriptions
         (id, user_id, name, category, price, cycle, next_renewal, plan, glyph,
          used_pct, usage_note, unused, created_at, updated_at,
          currency, price_minor, cycle_every, cycle_unit, first_charge_on,
          status, trial_ends_on, cancelled_on, deleted_at, notes, service_id,
          cancel_url, rail, rail_holder, reminder_days, shared_with,
          share_numerator, share_denominator, notice_days)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?)`,
    ).bind(
      id,
      userId,
      f.name ?? null,
      f.category ?? null,
      f.price ?? null,
      f.cycle ?? null,
      f.next_renewal ?? null,
      f.plan ?? null,
      f.glyph ?? null,
      f.used_pct ?? 0,
      f.usage_note ?? null,
      f.unused ?? 0,
      ts,
      ts,
      f.currency ?? null,
      f.price_minor ?? null,
      f.cycle_every ?? null,
      f.cycle_unit ?? null,
      f.first_charge_on ?? null,
      f.status ?? 'active',
      f.trial_ends_on ?? null,
      f.cancelled_on ?? null,
      f.deleted_at ?? null,
      f.notes ?? null,
      f.service_id ?? null,
      f.cancel_url ?? null,
      f.rail ?? null,
      f.rail_holder ?? null,
      f.reminder_days ?? null,
      f.shared_with ?? null,
      f.share_numerator ?? 1,
      f.share_denominator ?? 1,
      f.notice_days ?? null,
    ),
  );

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id),
  );
  return c.json(row ? serializeSubscription(row) : { error: 'not_found' }, 201);
});

// GET /:id — one subscription (must be owned) + its payment history.
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT * FROM subscriptions WHERE id = ? AND user_id = ?',
    ).bind(id, userId),
  );
  if (!row) return c.json({ error: 'not_found' }, 404);

  // ── NAMED COLUMNS, NOT `SELECT *` ──────────────────────────────────────────
  // 🔴 THIS RESULT IS RETURNED VERBATIM ON THE WIRE as `payment_history`, so
  // `SELECT *` made the served shape whatever the migrations happened to leave
  // behind. It already had: 0002_schema_debt.sql added `updated_at`, and from
  // that day `"updated_at": null` was on the wire while `Payment` in src/types.ts
  // declared five fields and did not mention it — a served field with no
  // declaration on one side and, until the same date, no writer on the other.
  // Naming the columns makes the wire shape a decision in this file: a column a
  // future migration adds does not reach a client until someone writes it here.
  // `currency` and `source` are 0003's, written here on purpose.
  //
  // 🔴 A PAYMENT WITH NO CURRENCY OF ITS OWN IS SERVED IN ITS SUBSCRIPTION'S.
  // The platform fan-out is the only writer, it copies the subscription's
  // `price` into `amount` and it does not write `currency` yet — so the unit of
  // that amount IS the subscription's. Served NULL, the client would decode it
  // with the user's currency (PaymentRecord.fromJson) and put "$649.00" in the
  // history under a subscription that reads "₹649.00". A payment that carries
  // its own currency keeps it, and a subscription with none leaves it NULL.
  const payments = await allRows<Payment>(
    c.env.APP_DB.prepare(
      `SELECT id, subscription_id, user_id, amount, paid_at, updated_at,
              COALESCE(currency, ?) AS currency, source
         FROM payment_history
         WHERE subscription_id = ? AND user_id = ?
         ORDER BY paid_at DESC`,
    ).bind(row.currency, id, userId),
  );

  return c.json({
    ...serializeSubscription(row),
    payment_history: payments,
  });
});

// PATCH /:id — update a whitelisted set of fields.
app.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  // ── VALIDATE BEFORE THE OWNERSHIP READ ─────────────────────────────────────
  // Order matters for the CALLER, not for safety: a bad value that only failed
  // at the bind produced a 500 after the 404 check, so "not yours" and "bad
  // value" were indistinguishable from the outside.
  const checked = validate(body);
  if (!checked.ok) {
    return c.json({ error: 'invalid_body', detail: checked.detail }, 400);
  }

  // Ownership check up front.
  const existing = await firstRow<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT id FROM subscriptions WHERE id = ? AND user_id = ?',
    ).bind(id, userId),
  );
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };

  // Only the columns the body actually carried — `validate` drops the rest, so
  // this cannot widen to a column the validator has not checked.
  for (const [col, val] of Object.entries(checked.fields)) put(col, val);

  put('updated_at', nowIso());

  values.push(id, userId);
  await run(
    c.env.APP_DB.prepare(
      `UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
    ).bind(...values),
  );

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id),
  );
  return c.json(row ? serializeSubscription(row) : { error: 'not_found' });
});

// DELETE /:id — cancel/remove.
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  await run(
    c.env.APP_DB.prepare(
      'DELETE FROM subscriptions WHERE id = ? AND user_id = ?',
    ).bind(id, userId),
  );
  return c.json({ ok: true });
});

export default app;
