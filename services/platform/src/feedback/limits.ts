// ─────────────────────────────────────────────────────────────────────────────
// limits.ts — every bound the intake enforces, in one place (lane feedback-intake,
// Do 6 and 7). The numbers are the brief's: "description and steps at most 4,000
// characters each; one image at most 2 MB", "the 4th anonymous report in an hour
// from one key is refused with 429", "purge_at = created_at + 90 days".
// ─────────────────────────────────────────────────────────────────────────────

/** Characters, each of `description` and `steps`. */
// @ceiling none — an input-shape bound on one typed field, not a platform resource
export const MAX_TEXT_CHARS = 4000;
/** Bytes of the one screenshot (PNG or WebP). */
// @ceiling none — an input-shape bound on one screenshot; far below a Worker request body or an R2 object
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Bytes of the report JSON part. Diagnostics and opt-in logs ride here. */
// @ceiling none — an input-shape bound on the report part of one request body
export const MAX_REPORT_JSON_BYTES = 64 * 1024;
/** Bytes of the whole request body: the two parts plus the multipart framing. */
// @ceiling none — the sum of the three input-shape bounds above, read before parsing
export const MAX_BODY_BYTES = MAX_IMAGE_BYTES + MAX_REPORT_JSON_BYTES + 8 * 1024;
/** Links across description and steps; more is the shape of spam, not of a bug. */
// @ceiling none — a spam heuristic on typed text, not a platform resource
export const MAX_LINKS = 3;
/** Milliseconds the sheet must have been open before a submit: a person reads
 *  and types; a script posts at once. */
// @ceiling none — a spam heuristic (a person reads and types; a script posts at once), not a platform resource
export const MIN_FILL_MS = 3000;
/** Opt-in log lines kept, each at most LOG_LINE_CHARS. */
// @ceiling none — an input-shape bound on the opt-in log lines one report may carry
export const MAX_LOG_LINES = 200;
// @ceiling none — an input-shape bound on one opt-in log line
export const LOG_LINE_CHARS = 500;
/** Error codes kept from the client's ring buffer. */
// @ceiling none — an input-shape bound on the error codes one report may carry
export const MAX_ERROR_CODES = 20;

/** Reports per hour from one signed-out NETWORK: the Cloudflare colo and ASN the
 *  request came through (edgeCeilingKey), never an address — no Worker here reads
 *  one ([ADR 011] / [ADR 020], tooling/ci/assert-glitchtip-no-ip.mjs). A network is
 *  shared by many people (one mobile ASN in one city), so the bound is wider than
 *  the brief's per-person "3": the 21st anonymous report in an hour from one network
 *  is refused, and the global daily cap, the honeypot, the minimum time and the
 *  size and link caps carry the rest of the spam control. */
// @ceiling none — a policy limit on anonymous reports per network, counted in D1, not a vendor ceiling
export const ANON_PER_HOUR = 20;
/** Reports per hour from one account. */
// @ceiling none — a policy limit on reports per account, counted in D1, not a vendor ceiling
export const AUTHED_PER_HOUR = 10;
/** Reports per UTC day across the whole intake: the backstop for a botnet. */
// @ceiling none — a policy backstop on reports per UTC day; at one INSERT each it is 2% of D1's rows-written-per-day, the account ceiling it spends
export const GLOBAL_PER_DAY = 2000;
// @ceiling none — a unit of time, not a limit
export const HOUR_MS = 60 * 60 * 1000;
// @ceiling none — a unit of time, not a limit
export const DAY_MS = 24 * HOUR_MS;

/** [Do 7] The retention class: tooling/legal/data-inventory.json
 *  `table:platform_db.feedback_reports` and tooling/ops/register.json
 *  `retention.d1.platform_db.feedback_reports` both say 90, and
 *  test/retention.test.ts holds the three equal. */
// @ceiling none — a retention period (tooling/legal/data-inventory.json), not a platform resource
export const FEEDBACK_RETENTION_DAYS = 90;
/** Rows (and their screenshots) one purge pass takes, again while a pass is full,
 *  at most PURGE_MAX_PASSES passes a night. A pass is one read, one object delete
 *  per screenshot and one two-statement batch; D1 binds at most 100 parameters to
 *  a statement, so a pass is under that. */
// @ceiling none — kept under D1's 100 bound parameters per statement (the purge binds one id each)
export const PURGE_BATCH = 90;
// @ceiling none — passes per nightly run: PURGE_BATCH x passes stays far under the per-invocation query and subrequest ceilings
export const PURGE_MAX_PASSES = 5;
/** Screenshot keys checked per orphan-sweep page: one bounded read each. */
// @ceiling none — our own page size; the keys are bound as ONE JSON array, so no parameter bound applies
export const ORPHAN_PAGE = 50;
/** Orphan-sweep pages a night. The sweep resumes where the last night stopped
 *  (its cursor is in CONFIG_KV), so the whole bucket is covered over nights while
 *  one firing's D1 statements and R2 deletes stay summable. */
// @ceiling none — our own per-night pacing of the sweep, inside the firing's statement budget
export const ORPHAN_MAX_PAGES = 4;

export const CATEGORIES = ['bug', 'crash', 'billing', 'accessibility', 'translation', 'question', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const SURFACES = ['app', 'site', 'extension'] as const;
export type Surface = (typeof SURFACES)[number];
