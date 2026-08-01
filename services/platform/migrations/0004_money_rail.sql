-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_money_rail.sql — THE MONEY RAIL'S STORAGE SHAPE, before the first payment.
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- [pipeline 5]M-3 (the entitlement record is complete before the first payment
-- lands) · [5]M-2 (a notification is recorded verbatim, exactly once, before it
-- is interpreted) · [5]M-7 (every payment is attributable, or resolvably
-- unclaimed) · [5]M-12 (sandbox money can never grant a production unlock).
--
-- 🔴 WHY ALL OF IT LANDS IN ONE MIGRATION, TODAY, WITH ZERO ROWS IN THE TABLE.
-- company/requirements/schema-evolution.md makes migrations ADDITIVE-ONLY, and
-- `entitlements` is the one table in this portfolio whose rows are a stranger's
-- money. The instant the first payment lands, every column that is missing here
-- is missing FOREVER for that row: there is no back-fill for a fact the provider
-- only ever sent once, in a notification we did not have a column to keep. So the
-- shape is decided while it is still free — which is now, and only now.
--
-- SHAPE DECISIONS (do not re-litigate):
--   • THE COMPOSITE-PK CARVE-OUT. `entitlements` is keyed (user_id, app_id,
--     entitlement) — a natural composite key, not a rowid table, unlike `events`
--     (0002) which is a ROWID table with a UNIQUE INDEX. The two are different on
--     purpose. `events` is append-only at high volume, where a random-UUID text
--     PK costs index locality on every insert. `entitlements` is a SMALL,
--     UPSERTED table whose identity IS the triple: the upsert's ON CONFLICT
--     target must name a real uniqueness constraint, and every read is
--     "this user, this app". A surrogate rowid here would add a second identity
--     that nothing uses and would let the same triple exist twice — two rows
--     disagreeing about whether one person paid.
--   • EVERY COLUMN ADDED BELOW IS NULLABLE, and that is not laziness. SQLite
--     cannot add a NOT NULL column without a constant DEFAULT, and a constant
--     default on a money column is a LIE told to every row that predates the
--     column: `provider_status DEFAULT 'active'` would assert that eight
--     never-written rows are active subscriptions. NULL means "this row was
--     written before the rail knew", which is the truth, and every reader is
--     required to fail closed on it.
--   • THE VERBATIM PAYLOAD IS STORED BEFORE IT IS INTERPRETED, never after.
--     A derivation bug that loses the notification loses the money event; a
--     derivation bug that runs after the row is safe loses only the derivation,
--     and the row can be re-derived.
--   • DEDUP IS `ON CONFLICT … DO NOTHING`, never `INSERT OR IGNORE`, for the
--     reason 0002_analytics.sql:12-19 already records: OR IGNORE also swallows
--     NOT NULL / CHECK / FK violations, so real corruption looks like a retry.
--
-- ⚠️ REPLAY. `ALTER TABLE … ADD COLUMN` has no `IF NOT EXISTS` form in SQLite, so
-- section A is LEDGER-PROTECTED rather than replay-safe: D1 records migration
-- FILE NAMES, so this file is applied exactly once. Sections B–E are all
-- `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` and do replay. test/migrations-
-- replay.test.ts classifies every statement in the set and asserts that the ONLY
-- non-replay-safe statements anywhere are `ALTER TABLE … ADD COLUMN` — so a DROP
-- or a bare CREATE TABLE sneaking in is still caught, and re-applying section A
-- is proven to fail LOUDLY rather than diverge silently.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A · THE ENTITLEMENT CONTRACT [5]M-3 ──────────────────────────────────────
-- 0001 gave this table eight columns: who, which app, which entitlement, which
-- product, which store, a boolean, an expiry and a receipt time. That is enough
-- to answer "is this person Pro" and not enough to answer any of the questions a
-- refund, a chargeback, a trial or a delayed retry ask. Each column below exists
-- because a specific question is unanswerable without it.

-- WHICH RAIL wrote this row. Two are live by decision ([ADR 004]: Paddle primary,
-- Lemon Squeezy parallel) and a third (RevenueCat, native IAP) is deferred but
-- already has a writer in services/subly-api. Without this, a refund arriving on
-- one rail cannot be matched to a grant written by another.
ALTER TABLE entitlements ADD COLUMN provider TEXT;

-- LIVE OR SANDBOX. [5]M-12: sandbox money must never grant a production unlock.
-- The read side treats a row whose environment is not the environment the reader
-- is running in as GRANTING NOTHING — so the isolation is a property of the data,
-- not only of which secret happened to be configured.
ALTER TABLE entitlements ADD COLUMN provider_environment TEXT;

-- The provider's own ids. `provider_subscription_id` is the stable handle across
-- the whole lifecycle (grant → renewal → cancel → refund); `provider_transaction_id`
-- is the single payment that last moved. A refund names a transaction; a
-- cancellation names a subscription. Keeping only one makes the other unmatchable.
ALTER TABLE entitlements ADD COLUMN provider_subscription_id TEXT;
ALTER TABLE entitlements ADD COLUMN provider_transaction_id TEXT;

-- THE PROVIDER'S STATUS, VERBATIM. `is_active` is a boolean and the lifecycle is
-- not: Paddle's subscription status is one of active / trialing / past_due /
-- paused / canceled (verified against developer.paddle.com, 2026-08-01). A
-- boolean cannot represent "trialing" or "past_due", and a flattened value cannot
-- be un-flattened later — the information is simply gone. Stored as the provider
-- sent it, un-normalised, because normalising is a decision that can be redone
-- from the raw value and cannot be undone from a lost one.
ALTER TABLE entitlements ADD COLUMN provider_status TEXT;

-- WHICH NOTIFICATION LAST WROTE THIS ROW, and WHEN THE PROVIDER SAYS IT HAPPENED.
-- These two are [5]M-2's ordering fix. Providers give no ordering guarantee — a
-- delayed retry of an older event arrives after a newer one — and `updated_at` is
-- RECEIPT time, which orders the retries, not the events. Writing a row only when
-- the incoming event's `occurred_at` is newer than the stored one is the whole
-- defence, and it needs the provider's clock persisted beside the row.
ALTER TABLE entitlements ADD COLUMN last_event_id TEXT;
ALTER TABLE entitlements ADD COLUMN occurred_at TEXT;

-- PAID THROUGH, and TRIAL THROUGH. `expires_at` (0001) conflates them. D-1 closed
-- on a subscription WITH A 30-DAY TRIAL, so "when does access end" and "when does
-- the free part end" are two different dates with two different consequences: the
-- second is the one a cancellation during trial is judged against, and it is the
-- path regulators scrutinise hardest.
ALTER TABLE entitlements ADD COLUMN current_period_end TEXT;
ALTER TABLE entitlements ADD COLUMN trial_end TEXT;

-- WHEN ACCESS WAS TAKEN AWAY, AND WHY. `is_active = 0` records that a user is not
-- Pro and nothing at all about whether that is a refund, a chargeback, a lapsed
-- card or a trial that simply ended — which is the difference between a support
-- reply, a fraud signal and a win-back. `revocation_reason` references
-- `revocation_reasons` (section E) by value.
--
-- ⚠️ THE COLUMN NAME SAYS "REVOCATION" AND ONE MEMBER RESTORES ACCESS. That is
-- deliberate and it is the reason the lookup table carries `restores_access`: a
-- reversed chargeback is a RE-GRANT, and nothing else in this rail restores
-- access to a row that was taken away. A restored row is exactly
-- `revoked_at IS NULL AND revocation_reason = 'chargeback_reversed'` — the
-- reason for the most recent transition of the revocation lifecycle, whichever
-- direction it went.
ALTER TABLE entitlements ADD COLUMN revoked_at TEXT;
ALTER TABLE entitlements ADD COLUMN revocation_reason TEXT;

-- Lifecycle lookups: "everything this provider subscription touches" is the query
-- a renewal, a cancellation and a refund all start from, and none of them knows
-- the (user_id, app_id, entitlement) triple.
CREATE INDEX IF NOT EXISTS idx_entitlements_provider_sub
  ON entitlements (provider, provider_subscription_id);

-- ── B · THE VERBATIM NOTIFICATION STORE [5]M-2 ───────────────────────────────
-- Every notification that passes signature verification is written here, byte for
-- byte, BEFORE anything interprets it — and the route answers 2xx on the strength
-- of THIS write, not of the derivation. A provider retries until it gets a 2xx
-- (Paddle: 60 attempts over 3 days, verified 2026-08-01), so an ack that waits for
-- derivation turns every derivation bug into a retry storm, and an ack that
-- precedes the write turns one into a lost payment.
--
-- ⚠️ THIS TABLE HOLDS WHATEVER THE PROVIDER SENT, WHICH INCLUDES BUYER PERSONAL
-- DATA (name, email, billing country). That is inherent in "recorded verbatim" and
-- it is named here rather than discovered later: it is DPDP-relevant, it is the
-- one table in platform_db that is NOT pseudonymous, and an erasure request has to
-- reach it. Unlike `events` (0002) it carries no `anon_id`, so no code path can
-- pair a payer with a pseudonymous install — [ADR 020]:21.
CREATE TABLE IF NOT EXISTS provider_notifications (
  -- Which rail sent it. Part of the dedup key: two providers may mint the same
  -- opaque id and they are not the same event.
  provider              TEXT NOT NULL,
  -- The PROVIDER'S EVENT ID — the id of the thing that happened, not the id of
  -- the delivery attempt. Paddle sends both: `event_id` (the event) and
  -- `notification_id` (this delivery of it). Deduping on the delivery id would
  -- store every retry as a fresh event.
  provider_event_id     TEXT NOT NULL,
  -- The delivery id, kept for support: "which attempt was this" is answerable
  -- from the provider's dashboard only if we wrote it down.
  provider_notification_id TEXT,
  event_type            TEXT,
  -- The provider's clock for the EVENT. The ordering authority for section A's
  -- `occurred_at`; never our receipt time, which orders retries instead.
  occurred_at           TEXT,
  -- 'live' | 'sandbox'. [5]M-12 — a sandbox notification is stored (so it is
  -- auditable) and can never write a live entitlement.
  environment           TEXT,
  -- Our receipt clock. Distinct from `occurred_at` on purpose; see above.
  received_at           TEXT NOT NULL,
  -- The RAW REQUEST BODY, exactly as it arrived and exactly as it was signed.
  -- Not a re-serialisation of a parsed object: signature verification is over the
  -- raw bytes, so a re-serialised copy cannot be re-verified later.
  payload               TEXT NOT NULL,
  -- NULL until something interpreted it. A row with `derived_at IS NULL` and an
  -- old `received_at` is a notification we took responsibility for and never
  -- acted on — the failure mode that is invisible without this column.
  derived_at            TEXT,
  -- Why derivation refused, when it did. A rail that fails closed and says
  -- nothing is indistinguishable from a rail with no traffic.
  derive_error          TEXT
);

-- THE EXACTLY-ONCE GUARANTEE. Exists before the first row lands, so no duplicate
-- can ever be admitted. Ingest MUST use `ON CONFLICT (provider,
-- provider_event_id) DO NOTHING`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_notifications_event
  ON provider_notifications (provider, provider_event_id);
-- "what has this rail sent lately", and the un-derived backlog query above.
CREATE INDEX IF NOT EXISTS idx_provider_notifications_received
  ON provider_notifications (provider, received_at);

-- ── C · THE PROVIDER ↔ ACCOUNT MAP [5]M-7 ────────────────────────────────────
-- Attribution's positive path. A checkout launched from inside an app carries the
-- account id in provider metadata, so the FIRST notification for a subscription
-- can resolve its buyer. Every LATER notification for the same subscription — the
-- renewal, the cancellation, the refund — resolves through this map instead.
--
-- 🔴 WHY THE MAP EXISTS RATHER THAN RE-READING THE METADATA EVERY TIME. Whether
-- checkout metadata propagates onto renewal transactions is a vendor fact this
-- repo has NOT been able to establish from a primary source (see
-- services/platform/src/lib/mor/paddle.ts's UNVERIFIED list). Designing on the
-- assumption that it does would mean discovering, on the first renewal after a
-- 30-day trial, that a paying customer has become unattributable. Writing the
-- link down once, on the event that provably carries it, depends on nothing.
CREATE TABLE IF NOT EXISTS provider_accounts (
  provider                 TEXT NOT NULL,
  provider_subscription_id TEXT NOT NULL,
  app_id                   TEXT NOT NULL,
  user_id                  TEXT NOT NULL,
  linked_at                TEXT NOT NULL,
  -- The notification that carried the metadata. Makes the link auditable: "why do
  -- we believe this subscription belongs to this account" has one answer.
  linked_from_event_id     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_accounts_sub
  ON provider_accounts (provider, provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_provider_accounts_user
  ON provider_accounts (user_id, app_id);

-- ── D · UNCLAIMED PAYMENTS [5]M-7 ────────────────────────────────────────────
-- The rare path: money arrived and no account could be resolved. Today the legacy
-- RevenueCat route answers `{ ok: true, act: false, reason: 'missing app_user_id' }`
-- — acknowledge and DISCARD. Someone paid and the only record is the provider's.
-- A row here is the difference between a support ticket that can be resolved and
-- one that cannot.
--
-- ⚠️ THE EMAIL IS STORED AS A SHA-256 HASH, NOT AS AN ADDRESS. The claim-on-first-
-- signin lookup is an EXACT match, which a hash serves exactly as well, so the
-- lookup index does not need to be a list of customers' email addresses. This does
-- NOT make the store PII-free — section B keeps the verbatim payload, which the
-- provider filled in — but it keeps the queryable, joinable column out of it.
CREATE TABLE IF NOT EXISTS unclaimed_payments (
  provider                 TEXT NOT NULL,
  provider_event_id        TEXT NOT NULL,
  provider_subscription_id TEXT,
  provider_transaction_id  TEXT,
  provider_customer_id     TEXT,
  -- Lowercased, trimmed, SHA-256, hex. NULL when the provider sent no email.
  customer_email_hash      TEXT,
  -- Which app's entitlement this payment was FOR, when the notification says so.
  app_id                   TEXT,
  environment              TEXT,
  received_at              TEXT NOT NULL,
  -- Set when the payment is later matched to an account. A row that is never
  -- claimed stays here forever on purpose: it is the evidence.
  --
  -- ⚠️ NAMED `claimed_user_id`, NOT `user_id`, AND THAT IS LOAD-BEARING. The
  -- shared erasure route (services/platform/src/routes/account.ts) DERIVES the
  -- tables it empties from the schema: every table carrying a column literally
  -- called `user_id` is user-owned by definition. `provider_accounts` therefore
  -- joins that set automatically and is erased with no edit to the route — which
  -- is correct, it is a link between a person and a subscription. This table
  -- deliberately does NOT join it: a row here is the record of money that
  -- arrived and could not be attributed, it carries no plaintext identifier, and
  -- deleting the evidence of an unresolved payment is not erasure of a person,
  -- it is destruction of the only thing that could ever resolve their support
  -- ticket. Whether an erasure should NULL the claim link is a live question and
  -- an owner/compliance decision (stage 8), not an agent's — it is recorded here
  -- rather than silently decided by a column name.
  claimed_at               TEXT,
  claimed_user_id          TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unclaimed_event
  ON unclaimed_payments (provider, provider_event_id);
CREATE INDEX IF NOT EXISTS idx_unclaimed_email
  ON unclaimed_payments (customer_email_hash);

-- ── E · THE REVOCATION REASON SET [5]M-3 ─────────────────────────────────────
-- 🔴 THIS SET IS DECIDED IN THIS MIGRATION OR NEVER. Rows written before a value
-- exists are unclassifiable forever — there is no back-fill for "why did this
-- person lose access" once the notification that said so is a year old.
--
-- IT IS A TABLE, NOT A CHECK CONSTRAINT AND NOT A COMMENT. A CHECK on the column
-- would freeze the set permanently: adding a member later needs a table rebuild,
-- which schema-evolution.md bans. A comment would be prose, and this repo's
-- standing rule is to assert on parsed structure rather than to grep prose. A
-- seeded lookup table is machine-readable by tooling/ci/assert-entitlement-
-- contract.mjs, extendable by one additive INSERT, and readable in the database.
CREATE TABLE IF NOT EXISTS revocation_reasons (
  reason          TEXT PRIMARY KEY,
  -- 1 when this transition GIVES ACCESS BACK. Exactly one member does today, and
  -- a boolean beats a name-matching convention that some later reader has to know.
  restores_access INTEGER NOT NULL DEFAULT 0,
  description     TEXT
);

INSERT INTO revocation_reasons (reason, restores_access, description) VALUES
  ('refund_approved',        0, 'The provider approved a refund for the transaction that paid for this access.'),
  ('chargeback',             0, 'The buyer disputed the charge with their bank and the provider reversed it.'),
  ('chargeback_reversed',    1, 'A previous chargeback was reversed in our favour. THE ONE MEMBER THAT RESTORES ACCESS: without it a customer who wins nothing and loses a dispute they raised in error stays locked out forever.'),
  ('subscription_expired',   0, 'The paid-through date passed and the subscription was not renewed.'),
  ('trial_expired',          0, 'The 30-day trial ended without converting to a paid subscription.'),
  ('payment_failed_final',   0, 'Dunning is out of scope (stage 13) but its ENTITLEMENT CONSEQUENCE is not: the provider gave up retrying a failed renewal charge, so access ends. "Dunning is cut" must never be read as "a lapsed subscriber keeps Pro".'),
  ('cancelled_at_period_end',0, 'Auto-renew was turned off and the already-paid period has now ended. NOT the same as cancelling: turning auto-renew off does not revoke, it schedules this.'),
  ('subscription_paused',    0, 'The subscription is paused. A paused subscription has no current billing period, so there is no paid-through date to honour and access stops now.')
ON CONFLICT(reason) DO NOTHING;
