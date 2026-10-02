// ─────────────────────────────────────────────────────────────────────────────
// /v1/subscriptions — user-scoped CRUD. All rows are keyed by c.get('userId').
// JSON is snake_case matching the DB columns; `unused` (0/1) serializes to bool
// and `reminder_days` (JSON text) to the list it holds.
// ─────────────────────────────────────────────────────────────────────────────

// The Idempotency-Key half of POST / (AB-O2-02) and of POST /:id/payments; see
// lib/idempotency.ts.
import { PAYMENT_SCOPE, idempotentCreate, reservedCreateId } from '../lib/idempotency';
import { Hono, type Context } from 'hono';
import type { AppEnv, Payment, PriceChange, Subscription } from '../types';
import { allRows, firstRow, nowIso, run, todayYmd, uuid } from '../lib/d1';
import {
  isBoundedString,
  isCalendarDate,
  isCalendarDateBetween,
  isFiniteNumber,
  isPlainObject,
  type Invalid,
} from '../lib/validate';
import { visibleCategory } from './categories';
import {
  MAX_REMINDERS,
  MAX_REMINDER_DAY,
  isReminderDaysList,
  parseReminderDays,
} from '../../../_shared/src/reminder-days';

const app = new Hono<AppEnv>();

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
    // Stored as the JSON text `validate` wrote, served as the list itself. The
    // ONE reading of the column, shared with the platform Worker that reminds
    // from it (services/_shared/src/reminder-days.ts); a value edited outside
    // this Worker is served as NULL ("use the account default"), never a 500.
    reminder_days: parseReminderDays(row.reminder_days),
    shared_with: row.shared_with,
    share_numerator: row.share_numerator,
    share_denominator: row.share_denominator,
    // 0005 (ST-X8). `?? null`: a DB 0005 has not reached has no such key.
    category_id: row.category_id ?? null,
    // 0004_notice_days.sql (ST-R8). `?? null`: a DB 0004 has not reached yields
    // no such key on the row, and the wire says null ("no notice period").
    notice_days: row.notice_days ?? null,
    // 0009_tags.sql (AD-12). Stored as the JSON text `validate` wrote, served as
    // the list; NULL, a DB 0007 has not reached, or text edited outside this
    // Worker is served as [] ("no tags"), never a 500.
    tags: parseTags(row.tags),
    // 0010_trial_price_still_using.sql (train T11). `?? null` for 0004's reason.
    // The post-trial price is in the row's `currency`, like `price_minor`.
    price_after_trial_minor: row.price_after_trial_minor ?? null,
    still_using: row.still_using ?? null,
    still_using_at: row.still_using_at ?? null,
  };
}

/** `tags` as stored -> the list it holds, or [] for anything else. */
export function parseTags(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  return isTagList(v) ? v : [];
}

/**
 * A tag list the route accepts: at most MAX_TAGS strings, each 1..MAX_TAG
 * characters with no leading or trailing space, no two equal ignoring case.
 * The client normalises to exactly this (Subscription.normaliseTags), so a 400
 * here is a client that skipped it, never a user's typo.
 */
function isTagList(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length > MAX_TAGS) return false;
  const seen = new Set<string>();
  for (const t of v) {
    if (typeof t !== 'string' || t === '' || t.length > MAX_TAG || t.trim() !== t) return false;
    const key = t.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
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
/** @ceiling none — column width; a built-in slug or a 32-hex / UUID id. */
const MAX_CATEGORY_ID = 64;
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
 *
 * Exported because routes/budget.ts bounds `monthly_budget` and each cap by the
 * same figure: a budget is an amount of the same money a price is.
 */
export const MAX_PRICE = 1_000_000_000;
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
// MAX_REMINDERS and MAX_REMINDER_DAY live with the column's one reading, in
// services/_shared/src/reminder-days.ts, imported above.
/** @ceiling none — a VALUE bound: a notice period at most a year before the
 *  charge, the same year MAX_REMINDER_DAY allows a reminder (0004, ST-R8). */
const MAX_NOTICE_DAYS = 365;
/** @ceiling none — a VALUE bound: labels on one row (0007, AD-12). The
 *  client's `Subscription.maxTags` is the same number. */
const MAX_TAGS = 10;
/** @ceiling none — column width; one label. `Subscription.maxTagLength`. */
const MAX_TAG = 32;
/** @ceiling none — a VALUE bound: "your share of N", N people at most. */
const MAX_SHARE_DENOMINATOR = 100;

/** The closed sets 0003 deliberately did NOT put in a CHECK (see its header):
 *  a new member here is a code change, where in SQL it would be a rebuild. */
const STATUSES = ['active', 'trialing', 'paused', 'cancelled'] as const;
/**
 * ⏱ 2026-09-29 · ST-E3 (round-2 F04). ALL FOUR ARE WRITABLE NOW. This was a
 * narrower `STATUSES_ACCEPTED = ['active', 'trialing']`, held back until every
 * reader skipped a paused or cancelled row — and the app shipped Pause and Mark
 * as cancelled (#1045) against it, so both answered 400 on the live Worker.
 * The readers that must skip them, and do:
 *   · the platform fan-out (services/platform/src/renewals.ts) charges only
 *     these two statuses and `deleted_at IS NULL` (#1045);
 *   · /v1/renewals (./renewals.ts) filters on the same two, from here.
 * GET / still LISTS a paused or cancelled row — it stays, with its history —
 * and hides only a deleted one.
 */
export const CHARGING_STATUSES = ['active', 'trialing'] as const;

/**
 * The cancel date a PATCH writes when it sets `status: 'cancelled'` and names no
 * date (absent, or an explicit null beside the cancel). Bound to today.
 *
 * 🔴 TODAY ONLY ON THE TRANSITION INTO `cancelled` (review of #1063, minor 2). A
 * row that is ALREADY cancelled with a date keeps it: re-sending the status — a
 * full-body edit, an outbox replay, a second tap — used to stamp today over the
 * day the user actually cancelled. Decided in the UPDATE against the stored row
 * (SQLite's SET reads the row as it was before the statement), so no read ahead
 * of the write can go stale, and it needs no statement of its own.
 */
const CANCEL_DATED_ON_TRANSITION =
  "cancelled_on = CASE WHEN status = 'cancelled' AND cancelled_on IS NOT NULL THEN cancelled_on ELSE ? END";

/**
 * The most statements any `.batch()` on this router sends: a price-moving
 * PATCH's two (the price_change row and the UPDATE). FIXED BY THE CODE, not
 * sized by input, and test/lifecycle.test.ts counts every batch against it.
 *
 * ⏱ 2026-10-01 · train T11 (SV-01): this was three, for `purgeExpired`, the
 * 3-statement DELETE batch GET / ran ahead of EVERY list read — four statements
 * per list, on the path every app open takes. The purge is a nightly platform
 * limb now (services/platform/src/subscription-housekeeping.ts
 * `purgeSoftDeleted`, which owns SOFT_DELETE_PURGE_DAYS), and GET / is one
 * SELECT.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const MAX_BATCH_STATEMENTS = 2;
/** @ceiling none — column width; an ISO-8601 instant is 24 characters. */
const MAX_INSTANT = 40;
/** An ISO-8601 instant with an explicit zone: what `toISOString()` writes. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
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
/** The "Still using?" answers (0010). The one closed set 0010 DID put in a
 *  CHECK: the question is yes/no, so a third member is a different question. */
const STILL_USING = ['yes', 'no'] as const;

/** ISO 4217 is three letters; stored upper case, as the client reads it.
 *  Exported so routes/budget.ts checks a budget's currency by the same rule. */
export const CURRENCY = /^[A-Za-z]{3}$/;
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
  | 'category_id'
  | 'notice_days'
  | 'tags'
  | 'price_after_trial_minor'
  | 'still_using'
  | 'still_using_at';

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
    // ⏱ 2026-09-29 · ST-E3 (round-2 F03): SOFT DELETE, WRITABLE. A row with
    // `deleted_at` set leaves GET /, /v1/renewals and the platform fan-out, and
    // `null` brings it back (the app's Undo). It is kept, history and all, for
    // SOFT_DELETE_PURGE_DAYS, then the platform Worker's nightly
    // `purgeSoftDeleted` (services/platform/src/subscription-housekeeping.ts)
    // removes the two together.
    //
    // 🔴 THE CLIENT'S INSTANT IS CHECKED FOR SHAPE AND THEN NOT TRUSTED. It is
    // the device clock: one a month behind (or any past instant) would make
    // the next nightly purge take the row AND its history at once, with no
    // Undo, and a future one would hide the row forever. So a non-null value
    // means "delete now" and PATCH stamps the SERVER's time, keeping an existing
    // stamp exactly as DELETE /:id does (review of #1063, finding 1).
    if (deletedAt === null) {
      fields.deleted_at = null;
    } else if (
      !isBoundedString(deletedAt, MAX_INSTANT) ||
      !INSTANT.test(deletedAt) ||
      Number.isNaN(Date.parse(deletedAt))
    ) {
      return invalid('deleted_at must be an ISO-8601 instant with a zone, e.g. 2026-09-29T10:00:00Z, or null');
    } else {
      fields.deleted_at = new Date(deletedAt).toISOString();
    }
  }

  const reminders = body.reminder_days;
  if (reminders !== undefined) {
    if (reminders === null) {
      // NULL = "use the account default"; [] = "no reminder for this one".
      fields.reminder_days = null;
    } else if (!isReminderDaysList(reminders)) {
      return invalid(
        `reminder_days must be a list of at most ${MAX_REMINDERS} different whole numbers of days, 0 to ${MAX_REMINDER_DAY}`,
      );
    } else {
      fields.reminder_days = JSON.stringify(reminders);
    }
  }

  // ── 0005: the category by id (ST-X8) — shape only here; `resolveCategory`
  // checks it names a category this user can use, which needs a read.
  const categoryId = body.category_id;
  if (categoryId !== undefined) {
    if (categoryId === null) {
      fields.category_id = null;
    } else if (!isBoundedString(categoryId, MAX_CATEGORY_ID) || categoryId === '') {
      return invalid(`category_id must be a category id of at most ${MAX_CATEGORY_ID} characters, or null`);
    } else {
      fields.category_id = categoryId;
    }
  }

  // A cancel with no date (absent, or an explicit null beside the cancel) is
  // dated by the ROUTE, not here: POST dates it today, and PATCH dates it today
  // only on the TRANSITION into `cancelled` — see CANCEL_DATED_ON_TRANSITION.
  // Dating it here stamped today over the real cancel date every time a client
  // re-sent `status: 'cancelled'` (review of #1063, minor 2).

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

  // ── 0007: the user's labels (AD-12) ────────────────────────────────────────
  const tags = body.tags;
  if (tags !== undefined) {
    if (tags === null) {
      fields.tags = null;
    } else if (!isTagList(tags)) {
      return invalid(
        `tags must be a list of at most ${MAX_TAGS} different labels of 1 to ${MAX_TAG} characters, no leading or trailing space`,
      );
    } else {
      // [] is stored as NULL: "no tags" has one spelling in the table.
      fields.tags = tags.length === 0 ? null : JSON.stringify(tags);
    }
  }

  // ── 0010: the price after the trial (AD-08) and "Still using?" (IN-08) ──────
  // The post-trial price is an exact amount in the ROW's currency, bounded as
  // `price_minor` is. Whether that currency exists is the route's to check
  // (`afterTrialCurrency`): on PATCH it may be the stored row's.
  const afterTrial = body.price_after_trial_minor;
  if (afterTrial !== undefined) {
    if (afterTrial === null) {
      fields.price_after_trial_minor = null;
    } else if (!isWholeNumber(afterTrial, 0, MAX_PRICE_MINOR)) {
      return invalid(`price_after_trial_minor must be a whole number between 0 and ${MAX_PRICE_MINOR}, or null`);
    } else {
      fields.price_after_trial_minor = afterTrial;
    }
  }

  const stillUsing = body.still_using;
  if (stillUsing !== undefined) {
    if (stillUsing === null) {
      // NULL = not answered: the question comes back on every device.
      fields.still_using = null;
    } else if (!isOneOf(stillUsing, STILL_USING)) {
      return invalid(`still_using must be one of ${STILL_USING.join(', ')}, or null`);
    } else {
      fields.still_using = stillUsing;
    }
  }

  // 🔴 `still_using_at` IS CHECKED FOR SHAPE AND THEN NOT TRUSTED, for
  // `deleted_at`'s reason: it is the device clock. The route stamps the SERVER's
  // time when an answer is written (and keeps the stamp when the same answer is
  // re-sent), so a body that echoes the row back is not refused and cannot
  // back-date an answer either. Never written to `fields`.
  const stillUsingAt = body.still_using_at;
  if (
    stillUsingAt !== undefined &&
    stillUsingAt !== null &&
    (!isBoundedString(stillUsingAt, MAX_INSTANT) ||
      !INSTANT.test(stillUsingAt) ||
      Number.isNaN(Date.parse(stillUsingAt)))
  ) {
    return invalid('still_using_at must be an ISO-8601 instant with a zone, or null; the server stamps it');
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

/**
 * THE CATEGORY, BY ID AND BY NAME, KEPT IN STEP (ST-X8). Mutates [f].
 *
 *   · `category_id` sent: it must be a built-in or one of this user's own
 *     (404-shaped as a 400 — the caller named a category it cannot use), and
 *     `category` is written as that category's name, whatever the body said,
 *     so every client that reads only the name reads the right one;
 *   · `category` alone — every client before this change: the id is looked up
 *     by name (a built-in first), and a name no category has is stored as the
 *     free text it always was, with no id;
 *   · null clears both.
 */
async function resolveCategory(db: D1Database, userId: string, f: Fields): Promise<Invalid | null> {
  if (f.category_id !== undefined) {
    if (f.category_id === null) {
      f.category = null;
      return null;
    }
    const cat = await visibleCategory(db, userId, String(f.category_id));
    if (!cat) return invalid(`category_id '${String(f.category_id)}' is not a category you can use`);
    f.category = cat.name;
    return null;
  }
  if (f.category === undefined) return null;
  if (f.category === null) {
    f.category_id = null;
    return null;
  }
  const byName = await firstRow<{ id: string }>(
    db
      .prepare(
        `SELECT id FROM categories WHERE name = ? AND (user_id IS NULL OR user_id = ?)
          ORDER BY builtin DESC LIMIT 1`,
      )
      .bind(f.category, userId),
  );
  f.category_id = byName?.id ?? null;
  return null;
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

/**
 * NAMES ARE REQUIRED (train T11, AD-01 server half). `isBoundedString` checks a
 * length and nothing else, so `{name: "  "}` was stored and every list showed a
 * row with no name — a subscription the user could not tell from any other.
 *
 *   · POST: a name must be sent, and must hold something other than whitespace;
 *   · PATCH: a body that OMITS `name` is a partial edit and is fine; one that
 *     sends it null or blank is refused, because that is clearing the name.
 *
 * Its own error code, not `invalid_body`, so a client can put the message on
 * the name field. Checked after `validate`, so a non-string name is still the
 * `invalid_body` it always was.
 */
function nameMissing(f: Fields, create: boolean): boolean {
  if (f.name === undefined) return create;
  return f.name === null || String(f.name).trim() === '';
}

const NAME_REQUIRED = {
  error: 'name_required',
  detail: 'name must hold at least one character that is not a space',
} as const;

/**
 * THE POST-TRIAL PRICE IS IN THE ROW'S CURRENCY (train T11, AD-08), so a
 * non-null one needs a currency to be in: the body's, or on PATCH a stored one.
 * `storedCurrency` is undefined on POST (there is no row yet).
 */
function afterTrialCurrency(f: Fields, storedCurrency?: string | null): Invalid | null {
  if (f.price_after_trial_minor === undefined || f.price_after_trial_minor === null) return null;
  const currency = f.currency !== undefined ? f.currency : storedCurrency;
  if (currency === undefined || currency === null) {
    return invalid('price_after_trial_minor needs a currency: send `currency`, or set one on the row first');
  }
  return null;
}

// GET / — list, most expensive first. A soft-deleted row is not listed; a
// paused or cancelled one is (it stays, with its history — ST-E3).
//
// ⏱ 2026-10-01 · train T11 (SV-01): ONE STATEMENT. This handler ran
// `purgeExpired` — a 3-statement DELETE batch — ahead of its SELECT on every
// list read, so the read every app open makes cost four statements and three
// of them were writes. The 30-day purge of soft-deleted rows, with their
// payment_history and price_change, is the platform Worker's nightly limb now
// (services/platform/src/subscription-housekeeping.ts `purgeSoftDeleted`).
// test/list-read.test.ts counts the statements.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const rows = await allRows<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT * FROM subscriptions WHERE user_id = ? AND deleted_at IS NULL ORDER BY price DESC',
    ).bind(userId),
  );
  return c.json(rows.map(serializeSubscription));
});

// POST / with an Idempotency-Key: a repeat is answered with the row the first
// attempt made (AB-O2-02). See lib/idempotency.ts.
app.post(
  '/',
  idempotentCreate(async (c, id) => {
    const row = await firstRow<Subscription>(
      c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?').bind(
        id,
        c.get('userId'),
      ),
    );
    if (!row) return null;
    // A soft-deleted row is GONE to a replay (review #1075 round 2, minor b):
    // 410, so a late replay never answers a row the user removed. Undo clears
    // `deleted_at`, and a restored row answers 200 again.
    if (row.deleted_at != null) return c.json({ error: 'idempotent_create_gone' }, 410);
    return c.json(serializeSubscription(row), 200);
  }),
);

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
  if (nameMissing(f, true)) return c.json(NAME_REQUIRED, 400);
  if (f.deleted_at !== undefined && f.deleted_at !== null) {
    return c.json({ error: 'invalid_body', detail: 'deleted_at cannot be set on create' }, 400);
  }
  const afterTrial = afterTrialCurrency(f);
  if (afterTrial) return c.json({ error: 'invalid_body', detail: afterTrial.detail }, 400);
  const category = await resolveCategory(c.env.APP_DB, userId, f);
  if (category) return c.json({ error: 'invalid_body', detail: category.detail }, 400);
  // A row created cancelled with no date was cancelled today: the detail screen
  // says "Cancelled on …", and a cancelled row with no date has nothing to say.
  if (f.status === 'cancelled' && f.cancelled_on == null) f.cancelled_on = todayYmd();

  const id = reservedCreateId(c) ?? uuid();
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
          share_numerator, share_denominator, category_id, notice_days, tags,
          price_after_trial_minor, still_using, still_using_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?)`,
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
      f.category_id ?? null,
      f.notice_days ?? null,
      f.tags ?? null,
      f.price_after_trial_minor ?? null,
      f.still_using ?? null,
      // An answer is stamped with the SERVER's time — see `validate`.
      f.still_using === undefined || f.still_using === null ? null : ts,
    ),
  );

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id),
  );
  return c.json(row ? serializeSubscription(row) : { error: 'not_found' }, 201);
});

// GET /:id — one subscription (must be owned, and not removed) + its history.
// A soft-deleted row is a 404 here, as it is to POST /:id/payments: removed
// means removed everywhere a client reads, and PATCH {deleted_at: null} (Undo)
// is the one way back.
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');

  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare(
      'SELECT * FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
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

  // Every price edit, newest first (0005, ST-I4). Named columns, for the same
  // reason as the payments above: the wire shape is decided here.
  const priceHistory = await allRows<PriceChange>(
    c.env.APP_DB.prepare(
      `SELECT id, subscription_id, old_price, new_price, old_price_minor,
              new_price_minor, old_currency, new_currency, changed_at
         FROM price_change
         WHERE subscription_id = ? AND user_id = ?
         ORDER BY changed_at DESC`,
    ).bind(id, userId),
  );

  return c.json({
    ...serializeSubscription(row),
    payment_history: payments,
    price_history: priceHistory,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/payments — the user records a payment by hand (ST-R5, round-2 X06:
// "mark as paid"). Until now the nightly fan-out was the table's only writer, so
// a charge the user paid off-cycle, or on a rail the fan-out never rolls (a
// weekly row, a paused one), had no way into the history.
//
// Body: { amount, paid_on: 'YYYY-MM-DD', currency? }. `currency` defaults to the
// subscription's, for the reason GET /:id serves a NULL one in it. Stored with
// `source` = 'manual' and `paid_at` at midnight UTC, the same shape the fan-out
// writes (`${date}T00:00:00Z`), so one ORDER BY paid_at sorts both.
//
// 🔴 IT TAKES AN Idempotency-Key, AS POST / DOES (D-PAYMENTS-IDEMPOTENCY). A
// payment is money: without a key, a "mark as paid" that committed and lost its
// response was recorded again by the retry, and the spend counted it twice. The
// key, the ledger and every answer are lib/idempotency.ts's, in PAYMENT_SCOPE.
// ─────────────────────────────────────────────────────────────────────────────
const MANUAL_SOURCE = 'manual';

/**
 * THE WINDOW A PAID DATE MAY FALL IN (review of #1063, minor 5, its half that
 * needs no idempotency helper). A payment is a thing that HAPPENED, so `paid_on`
 * is at the latest tomorrow in UTC: one day of skew, because a user east of UTC
 * paying on their local today is already on UTC's tomorrow (up to +14 h). A
 * future date was stored as spent and sorted FIRST in `ORDER BY paid_at DESC`,
 * so '2099-01-01' both inflated spend and sat on top of the history for good.
 * The floor refuses the absurd past (a year typed as 0026, a zeroed date) that
 * would sort last and still count; no subscription the app tracks was paid
 * before this century.
 */
const EARLIEST_PAID_ON = '2000-01-01';
// @ceiling none — clock-skew tolerance on a user-entered date, not a platform resource
const PAID_ON_SKEW_DAYS = 1;

// A repeat of a keyed payment is answered with the payment as stored — the
// amount, currency and date the first attempt recorded, never recomputed — or
// 410 once its subscription is removed: a removed row takes no history, and a
// late replay must not report a payment under it as freshly recorded. Undo
// (PATCH {deleted_at: null}) brings the 200 back, as it does for POST /.
app.post(
  '/:id/payments',
  idempotentCreate(async (c, id) => {
    const row = await firstRow<Payment & { parent_id: string | null; parent_deleted_at: string | null }>(
      c.env.APP_DB.prepare(
        `SELECT p.id, p.subscription_id, p.user_id, p.amount, p.paid_at, p.updated_at,
                p.currency, p.source, s.id AS parent_id, s.deleted_at AS parent_deleted_at
           FROM payment_history p
           LEFT JOIN subscriptions s ON s.id = p.subscription_id AND s.user_id = p.user_id
           WHERE p.id = ? AND p.user_id = ?`,
      ).bind(id, c.get('userId')),
    );
    if (!row) return null;
    if (row.parent_id == null || row.parent_deleted_at != null) {
      return c.json({ error: 'idempotent_create_gone' }, 410);
    }
    const payment: Payment = {
      id: row.id,
      subscription_id: row.subscription_id,
      user_id: row.user_id,
      amount: row.amount,
      paid_at: row.paid_at,
      updated_at: row.updated_at,
      currency: row.currency,
      source: row.source,
    };
    return c.json(payment, 200);
  }, PAYMENT_SCOPE),
);

app.post('/:id/payments', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isPlainObject(body)) {
    return c.json({ error: 'invalid_body', detail: 'body must be a JSON object' }, 400);
  }
  const { amount, paid_on: paidOn, currency } = body;
  if (!isFiniteNumber(amount) || amount < 0 || amount > MAX_PRICE) {
    return c.json(
      { error: 'invalid_body', detail: `amount must be a finite number between 0 and ${MAX_PRICE}` },
      400,
    );
  }
  if (!isCalendarDate(paidOn)) {
    return c.json({ error: 'invalid_body', detail: 'paid_on must be a real calendar date as YYYY-MM-DD' }, 400);
  }
  const latestPaidOn = new Date(Date.now() + PAID_ON_SKEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!isCalendarDateBetween(paidOn, EARLIEST_PAID_ON, latestPaidOn)) {
    return c.json(
      {
        error: 'invalid_body',
        detail: `paid_on must be between ${EARLIEST_PAID_ON} and ${latestPaidOn}: a payment is a date that has happened`,
      },
      400,
    );
  }
  if (currency !== undefined && currency !== null && (typeof currency !== 'string' || !CURRENCY.test(currency))) {
    return c.json({ error: 'invalid_body', detail: 'currency must be a three-letter ISO 4217 code, e.g. INR' }, 400);
  }

  // A payment against a row that is not yours, or that you removed, is a 404:
  // a soft-deleted row takes no new history.
  const sub = await firstRow<Pick<Subscription, 'id' | 'currency'>>(
    c.env.APP_DB.prepare(
      'SELECT id, currency FROM subscriptions WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    ).bind(id, userId),
  );
  if (!sub) return c.json({ error: 'not_found' }, 404);

  const payment: Payment = {
    id: reservedCreateId(c) ?? uuid(),
    subscription_id: id,
    user_id: userId,
    amount,
    paid_at: `${paidOn}T00:00:00Z`,
    updated_at: nowIso(),
    currency: typeof currency === 'string' ? currency.toUpperCase() : sub.currency,
    source: MANUAL_SOURCE,
  };
  await run(
    c.env.APP_DB.prepare(
      `INSERT INTO payment_history
         (id, subscription_id, user_id, amount, paid_at, updated_at, currency, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      payment.id,
      payment.subscription_id,
      payment.user_id,
      payment.amount,
      payment.paid_at,
      payment.updated_at,
      payment.currency,
      payment.source,
    ),
  );
  return c.json(payment, 201);
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
  if (nameMissing(checked.fields, false)) return c.json(NAME_REQUIRED, 400);

  // ── OWNERSHIP, AND A REMOVED ROW IS NOT THERE (review of #1063, minor 1) ───
  // A soft-deleted row answers a PATCH exactly as GET /:id and POST /:id/payments
  // answer it — 404, the same body — and nothing is written: no edit, and no
  // price_change row for a row nobody can see. The ONE PATCH a removed row takes
  // is the Undo, `{deleted_at: null}`, which brings it back (with whatever else
  // that body carries). The same condition is repeated in the write's WHERE
  // (`target`, below), so a DELETE landing between this read and the write
  // cannot be edited through either.
  //
  // 🔴 …EXCEPT A BODY THAT ONLY REMOVES IT AGAIN (review of #1089, finding 1).
  // `{deleted_at: <instant>}` and nothing else is `DELETE /:id` spelled as a
  // PATCH, and it is idempotent the way DELETE is: 200, the FIRST stamp kept.
  // Refusing it made a delete that SUCCEEDED read as a failure three ways — the
  // `run()` retry after a commit whose acknowledgement was lost (the retried
  // UPDATE matched no live row), a client retry after a lost response, and a
  // second device removing a row the first already had. So: on a row already
  // removed it writes nothing and answers the stored row, and its write is not
  // limited to live rows (`target`), so a retried or racing removal still
  // matches and the COALESCE keeps the first stamp.
  const f = checked.fields;
  const restoring = f.deleted_at === null;
  const removing = f.deleted_at != null && Object.keys(f).length === 1;
  const existing = await firstRow<Pick<Subscription, 'id' | 'deleted_at'>>(
    c.env.APP_DB.prepare('SELECT id, deleted_at FROM subscriptions WHERE id = ? AND user_id = ?').bind(
      id,
      userId,
    ),
  );
  if (!existing || (existing.deleted_at !== null && !restoring && !removing)) {
    return c.json({ error: 'not_found' }, 404);
  }
  if (removing && existing.deleted_at !== null) return answerRow(c, id);
  // A post-trial price sent WITHOUT a currency is in the stored one: read only
  // then, so every other PATCH keeps the one ownership read it had.
  const storedCurrency =
    f.price_after_trial_minor != null && f.currency === undefined
      ? ((
          await firstRow<Pick<Subscription, 'currency'>>(
            c.env.APP_DB.prepare('SELECT currency FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, userId),
          )
        )?.currency ?? null)
      : undefined;
  const afterTrial = afterTrialCurrency(f, storedCurrency);
  if (afterTrial) return c.json({ error: 'invalid_body', detail: afterTrial.detail }, 400);
  const category = await resolveCategory(c.env.APP_DB, userId, f);
  if (category) return c.json({ error: 'invalid_body', detail: category.detail }, 400);

  const sets: string[] = [];
  const values: unknown[] = [];
  const put = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    values.push(val);
  };

  const ts = nowIso();

  // A cancel that names no date is dated by the stored row, not the body: see
  // CANCEL_DATED_ON_TRANSITION. An explicit date is the user's and is written.
  const datedByRow = f.status === 'cancelled' && f.cancelled_on == null;
  if (datedByRow) delete f.cancelled_on;
  // 🔴 AND A DATE CLEARED ALONE CANNOT LEAVE A CANCELLED ROW UNDATED (review of
  // #1089, finding 2). `{cancelled_on: null}` with no `status` is judged against
  // the stored row, as a dateless cancel is: a cancelled row keeps its date (or,
  // a legacy one with none, gets today), and any other row is cleared as asked.
  // Kept rather than refused because that is what this API already does with a
  // missing cancel date — the server supplies it (POST, and the transition
  // above) — and because refusing would need the stored status, a read that can
  // go stale before the write; the CASE reads it inside the write.
  const dateClearedAlone = f.status === undefined && f.cancelled_on === null;
  if (dateClearedAlone) delete f.cancelled_on;

  // Only the columns the body actually carried — `validate` drops the rest, so
  // this cannot widen to a column the validator has not checked.
  for (const [col, val] of Object.entries(f)) {
    if (col === 'deleted_at' && val !== null) {
      // Server time, and the FIRST delete's time — see `validate`.
      sets.push('deleted_at = COALESCE(deleted_at, ?)');
      values.push(ts);
    } else {
      put(col, val);
    }
  }
  if (datedByRow) {
    sets.push(CANCEL_DATED_ON_TRANSITION);
    values.push(todayYmd());
  }
  if (dateClearedAlone) {
    sets.push("cancelled_on = CASE WHEN status = 'cancelled' THEN COALESCE(cancelled_on, ?) ELSE NULL END");
    values.push(todayYmd());
  }
  // ── 0010 (train T11) ───────────────────────────────────────────────────────
  // An answer to "Still using?" is stamped with the server's time, and a body
  // that re-sends the SAME answer (a full-body edit, an outbox replay) keeps the
  // stamp it had: SET reads the row as it was, so the comparison is against the
  // stored answer, decided inside the write.
  if (f.still_using !== undefined) {
    if (f.still_using === null) {
      put('still_using_at', null);
    } else {
      sets.push('still_using_at = CASE WHEN still_using IS ? THEN COALESCE(still_using_at, ?) ELSE ? END');
      values.push(f.still_using, ts, ts);
    }
  }
  // A currency that MOVES takes the post-trial price with it unless the body
  // sends a new one, for `checkExactAmount`'s reason: an amount in minor units
  // read in another currency is ₹649.00 relabelled ¥64,900. Unlike
  // `price_minor` it is kept when the SAME currency is re-sent, because every
  // client before 0010 sends `currency` on every edit and none sends this
  // column, and wiping a trial's real price would convert it at the trial's.
  if (f.currency !== undefined && f.price_after_trial_minor === undefined) {
    sets.push('price_after_trial_minor = CASE WHEN currency IS ? THEN price_after_trial_minor ELSE NULL END');
    values.push(f.currency);
  }

  if (removing) {
    // A removal that matches an already-removed row (a retry, a racing device)
    // changes nothing, so it does not move `updated_at` either.
    sets.push('updated_at = CASE WHEN deleted_at IS NULL THEN ? ELSE updated_at END');
    values.push(ts);
  } else {
    put('updated_at', ts);
  }

  const target =
    restoring || removing ? 'id = ? AND user_id = ?' : 'id = ? AND user_id = ? AND deleted_at IS NULL';
  const update = c.env.APP_DB.prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE ${target}`).bind(
    ...values,
    id,
    userId,
  );

  // ── THE PRICE HISTORY ([ADR 077] §5.2, ST-I4, round-2 F14) ─────────────────
  // One price_change row per edit that MOVED the amount, in the SAME batch as
  // the edit, so the log can never hold a change the row does not, or miss one
  // it does. What counts as a move: a different `price`, or a different
  // `currency` where the row already had one. A legacy row (currency NULL)
  // being stamped with its currency by the client is not a price change, and
  // `price_minor` alone is only the exact form of an unchanged `price`.
  //
  // 🔴 THE OLD AMOUNT IS READ INSIDE THE BATCH, NOT BEFORE IT (review of #1063,
  // minor 4). It was read by the ownership SELECT above and bound into the
  // INSERT, so two edits racing from one amount both logged it as their `old`:
  // 649 → 899 and 649 → 999, where the row went 649 → 899 → 999. Now the log is
  // an INSERT … SELECT FROM the row, placed BEFORE the UPDATE in one batch (one
  // transaction): it reads the amount the update is about to replace, and the
  // "did it move" test is its WHERE, so the second of two racing edits logs
  // 899 → 999. SQLite's RETURNING yields only the NEW values, so the read has to
  // be a statement of its own, ahead of the write.
  //
  // A body that names neither `price` nor `currency` cannot move the amount, so
  // it sends the UPDATE alone.
  let changes: number;
  if (f.price !== undefined || f.currency !== undefined) {
    // The value the row will hold: the body's where it sent one, else the column.
    const after = (col: 'price' | 'price_minor' | 'currency') =>
      f[col] === undefined ? { sql: col, binds: [] as unknown[] } : { sql: '?', binds: [f[col]] };
    const price = after('price');
    const minor = after('price_minor');
    const currency = after('currency');
    const log = c.env.APP_DB.prepare(
      `INSERT INTO price_change
         (id, subscription_id, user_id, old_price, new_price, old_price_minor,
          new_price_minor, old_currency, new_currency, changed_at)
       SELECT ?, id, user_id, price, ${price.sql}, price_minor, ${minor.sql}, currency, ${currency.sql}, ?
         FROM subscriptions
        WHERE ${target}
          AND (${price.sql} IS NOT price OR (currency IS NOT NULL AND ${currency.sql} IS NOT currency))`,
    ).bind(
      uuid(),
      ...price.binds,
      ...minor.binds,
      ...currency.binds,
      ts,
      id,
      userId,
      ...price.binds,
      ...currency.binds,
    );
    const [, updated] = await c.env.APP_DB.batch([log, update]);
    changes = updated?.meta.changes ?? 0;
  } else {
    changes = (await run(update)).meta.changes;
  }
  // Removed (or erased) between the ownership read and the write: the write
  // matched nothing, and the answer is the one a removed row gets.
  if (changes === 0) return c.json({ error: 'not_found' }, 404);

  return answerRow(c, id);
});

/** PATCH's answer: the caller's row as it now stands, or the 404 a row that is
 *  gone gets (never a 200 carrying `{error}`). */
async function answerRow(c: Context<AppEnv>, id: string) {
  const row = await firstRow<Subscription>(
    c.env.APP_DB.prepare('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, c.get('userId')),
  );
  return row ? c.json(serializeSubscription(row)) : c.json({ error: 'not_found' }, 404);
}

// DELETE /:id — remove, SOFTLY (ST-E3, round-2 B33).
//
// ⏱ 2026-09-29. This was `DELETE FROM subscriptions`: the row went, and its
// payment_history stayed behind with a subscription_id nothing matched (0001
// has no foreign key, so nothing cascaded) — history no screen could reach and
// only erasure would ever remove. Now it sets `deleted_at` exactly as
// PATCH {deleted_at} does, so an older client's DELETE is restorable too, and
// the nightly `purgeSoftDeleted` (services/platform/src/subscription-housekeeping.ts)
// removes the row WITH its history once the window has passed.
// Idempotent: a second DELETE keeps the first instant.
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = c.req.param('id');
  const ts = nowIso();
  await run(
    c.env.APP_DB.prepare(
      'UPDATE subscriptions SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ? AND user_id = ?',
    ).bind(ts, ts, id, userId),
  );
  return c.json({ ok: true });
});

export default app;
