-- ─────────────────────────────────────────────────────────────────────────────
-- 0032_offer_codes.sql — OUR OWN OFFER CODES AND INVITE-A-FRIEND (lane
-- growth-codes, O-PROMO-CODES-NO-REDEEM-ROUTE, O-INVITE-REWARD-UNBUILT).
--
-- Applies to the SHARED platform_db (services/platform is the sole applier):
--   wrangler d1 migrations apply PLATFORM_DB --local    (or --remote)
--
-- ADDITIVE ONLY: four new tables, CREATE ... IF NOT EXISTS, so it replays. It
-- DEPLOYS ALONE, BEFORE the Worker that reads it (the brief's "migration alone
-- first"): every route below answers 503 on a missing table, never a guess.
--
-- WHAT A CODE BUYS. The offer it names, from tooling/catalog/offers.json (the
-- register; the Worker bundles it): a number of free Pro months on ONE app,
-- granted as a `bundle_grants` row of source `promo_code` through the ONE writer
-- (src/lib/mor/bundle-store.ts). `promo_code` is `requires_receipt = 0`, so the
-- AI meter (src/lib/ai/meter.ts planOf) never counts it as paid: a code NEVER
-- buys an AI allowance. A DISCOUNT is not redeemed here at all — it is the rail's
-- own mechanism (a Paddle discount, an Apple offer code, a Play promo code), and
-- the register's floor guard (tooling/ci/assert-offers.mjs) is what holds it.
--
-- ── offer_codes ──────────────────────────────────────────────────────────────
-- One row per code an operator issued. THE CODE ITSELF IS NEVER STORED: only
-- `code_hash`, SHA-256 of its normalised text (src/lib/codes/verify.ts), so a
-- read of this table cannot redeem anything. A code carries at least 80 bits of
-- entropy (the register's `codePolicy`), which is what makes an unsalted hash
-- safe here: nobody can enumerate the space to invert it.
--   offer_id         the offers.json row it redeems.
--   app_id           the app the months unlock.
--   max_redemptions  how many accounts may redeem it (1 for a personal code).
--   redeemed         how many have; the redeem's UPDATE refuses past the cap in
--                    the same statement, so two concurrent redeems cannot both
--                    take the last one.
--   expires_at       after this instant the code redeems nothing.
--   issued_by        the OPERATOR RECORD: who issued it and under what ticket.
--                    A `promo_code` grant needs one (tooling/ci/assert-bundle-
--                    provenance.mjs limb 5).
CREATE TABLE IF NOT EXISTS offer_codes (
  code_hash        TEXT PRIMARY KEY NOT NULL,
  offer_id         TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  max_redemptions  INTEGER NOT NULL CHECK (max_redemptions >= 1),
  redeemed         INTEGER NOT NULL DEFAULT 0 CHECK (redeemed >= 0),
  expires_at       TEXT NOT NULL,
  issued_by        TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- ── offer_redemptions ────────────────────────────────────────────────────────
-- One row per (code, account): the receipt of a redemption, and the reason a
-- replay grants ONCE. `idempotency_key` is the client's; a retry with the same
-- key answers the first outcome and writes nothing.
-- 🔴 `user_id`, SPELT EXACTLY: the erasure walk deletes every table carrying it
-- (services/_shared/src/erasure.ts), and the export reads it.
CREATE TABLE IF NOT EXISTS offer_redemptions (
  redemption_id    TEXT PRIMARY KEY NOT NULL,
  code_hash        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  offer_id         TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  grant_id         TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (code_hash, user_id),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_offer_redemptions_user ON offer_redemptions (user_id);

-- ── invite_links ─────────────────────────────────────────────────────────────
-- An account's own invite code, minted on first ask. Stored as the code's hash
-- (the same rule as offer_codes) and keyed by the inviter's account.
CREATE TABLE IF NOT EXISTS invite_links (
  user_id          TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  code_hash        TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

-- ── invites ──────────────────────────────────────────────────────────────────
-- THE INVITE RELATION: who invited whom. One row per invitee and app — the
-- primary key IS the "one reward per invitee" rule. The relation is personal
-- data about TWO people, so the notice discloses it and it carries a retention
-- class (tooling/legal/data-inventory.json `table:platform_db.invites`).
--   user_id          the INVITEE (the account that claimed the code). The erasure
--                    walk deletes the row when the invitee leaves.
--   inviter_user_id  the inviter. A `*_user_id` column REFERENCES a person, so
--                    the erasure walk NULLs it when the INVITER leaves
--                    (services/_shared/src/erasure.ts): the invitee keeps their
--                    reward and the relation no longer names anyone.
--   state            pending -> rewarded | refused.
--   refused_reason   the abuse rule that refused it (src/lib/codes/invites.ts).
--   reward_grant_ids the two grant ids, inviter's then invitee's.
CREATE TABLE IF NOT EXISTS invites (
  user_id          TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  inviter_user_id  TEXT,
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'rewarded', 'refused')),
  refused_reason   TEXT,
  reward_grant_ids TEXT,
  claimed_at       TEXT NOT NULL,
  settled_at       TEXT,
  PRIMARY KEY (user_id, app_id)
);
CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites (inviter_user_id, state, settled_at);
