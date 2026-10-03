// ─────────────────────────────────────────────────────────────────────────────
// limits.ts — every bound the intake enforces, in one place (lane feedback-intake,
// Do 6 and 7). The numbers are the brief's: "description and steps at most 4,000
// characters each; one image at most 2 MB", "the 4th anonymous report in an hour
// from one key is refused with 429", "purge_at = created_at + 90 days".
// ─────────────────────────────────────────────────────────────────────────────

/** Characters, each of `description` and `steps`. */
export const MAX_TEXT_CHARS = 4000;
/** Bytes of the one screenshot (PNG or WebP). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Bytes of the report JSON part. Diagnostics and opt-in logs ride here. */
export const MAX_REPORT_JSON_BYTES = 64 * 1024;
/** Bytes of the whole request body: the two parts plus the multipart framing. */
export const MAX_BODY_BYTES = MAX_IMAGE_BYTES + MAX_REPORT_JSON_BYTES + 8 * 1024;
/** Links across description and steps; more is the shape of spam, not of a bug. */
export const MAX_LINKS = 3;
/** Milliseconds the sheet must have been open before a submit: a person reads
 *  and types; a script posts at once. */
export const MIN_FILL_MS = 3000;
/** Opt-in log lines kept, each at most LOG_LINE_CHARS. */
export const MAX_LOG_LINES = 200;
export const LOG_LINE_CHARS = 500;
/** Error codes kept from the client's ring buffer. */
export const MAX_ERROR_CODES = 20;

/** Reports per hour from one signed-out key (a salted hash of the address). */
export const ANON_PER_HOUR = 3;
/** Reports per hour from one account. */
export const AUTHED_PER_HOUR = 10;
/** Reports per UTC day across the whole intake: the backstop for a botnet. */
export const GLOBAL_PER_DAY = 2000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** [Do 7] The retention class: tooling/legal/data-inventory.json
 *  `table:platform_db.feedback_reports` and tooling/ops/register.json
 *  `retention.d1.platform_db.feedback_reports` both say 90, and
 *  test/retention.test.ts holds the three equal. */
export const FEEDBACK_RETENTION_DAYS = 90;
/** Rows (and their screenshots) one purge pass takes, again while a pass is full,
 *  at most PURGE_MAX_PASSES passes a night. A pass is one read, one object delete
 *  per screenshot and one two-statement batch; D1 binds at most 100 parameters to
 *  a statement, so a pass is under that. */
export const PURGE_BATCH = 90;
export const PURGE_MAX_PASSES = 5;
/** Screenshot keys checked per orphan-sweep page (D1 binds at most 100 parameters). */
export const ORPHAN_PAGE = 50;

export const CATEGORIES = ['bug', 'crash', 'billing', 'accessibility', 'translation', 'question', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const SURFACES = ['app', 'site', 'extension'] as const;
export type Surface = (typeof SURFACES)[number];
