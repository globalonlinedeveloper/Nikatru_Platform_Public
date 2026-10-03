-- ─────────────────────────────────────────────────────────────────────────────
-- 0010_price_minor_iso_scale.sql — `price_minor` stored at the legacy two-digit
-- scale is rewritten to its currency's ISO 4217 scale (PR #1174 lead ruling
-- 1(c), review finding 2).
-- Applies to APP_DB (subscriptiontracker_db):
--   wrangler d1 migrations apply APP_DB --local   (or --remote)
-- In production it is applied by deploy-workers.yml's "Apply the Worker's D1
-- migrations (before deploy)" step (ci.yml job deploy-workers), BEFORE the
-- Worker that reads it deploys.
--
-- WHY. Until #1174 the app's money.dart knew JPY 0 and KWD 3 and wrote every
-- other code with two minor digits, so a ₩14,900 plan is stored as
-- price=14900, price_minor=1490000. The app now reads contracts/currency/
-- iso4217.js (KRW 0), and Subscription.readPrice prefers `price_minor`, so that
-- row would show ₩1,490,000. 24 codes changed scale; they are the
-- LEGACY_SCALE_CODES of iso4217.js, grouped below by their ISO digits
-- (test/price-minor-iso-scale.test.ts reds a list that drifts from that table).
--
-- WHAT. For exactly those codes, and only where the stored value IS the legacy
-- scale (`price_minor = round(price × 100)`), `price_minor` becomes
-- round(price × 10^digits). `price` — the REAL, right under both scales — is
-- the source and is never written. No row is deleted or inserted.
--
-- REPLAY-SAFE. A rewritten row no longer equals round(price × 100) (the two
-- agree only at price 0, where both are 0), so a second application matches
-- nothing. Each statement is an UPDATE … WHERE, which check-migrations.mjs and
-- test/migrations-replay.test.ts both classify as a self-limiting backfill.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── ISO digits 0 (no minor unit): 16 codes ──
UPDATE subscriptions
   SET price_minor = CAST(ROUND(price * 1) AS INTEGER)
 WHERE currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF')
   AND price IS NOT NULL
   AND price_minor = CAST(ROUND(price * 100) AS INTEGER);
UPDATE price_change
   SET old_price_minor = CAST(ROUND(old_price * 1) AS INTEGER)
 WHERE old_currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF')
   AND old_price IS NOT NULL
   AND old_price_minor = CAST(ROUND(old_price * 100) AS INTEGER);
UPDATE price_change
   SET new_price_minor = CAST(ROUND(new_price * 1) AS INTEGER)
 WHERE new_currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF')
   AND new_price IS NOT NULL
   AND new_price_minor = CAST(ROUND(new_price * 100) AS INTEGER);

-- ── ISO digits 3 (three minor digits): 6 codes ──
UPDATE subscriptions
   SET price_minor = CAST(ROUND(price * 1000) AS INTEGER)
 WHERE currency IN ('BHD', 'IQD', 'JOD', 'LYD', 'OMR', 'TND')
   AND price IS NOT NULL
   AND price_minor = CAST(ROUND(price * 100) AS INTEGER);
UPDATE price_change
   SET old_price_minor = CAST(ROUND(old_price * 1000) AS INTEGER)
 WHERE old_currency IN ('BHD', 'IQD', 'JOD', 'LYD', 'OMR', 'TND')
   AND old_price IS NOT NULL
   AND old_price_minor = CAST(ROUND(old_price * 100) AS INTEGER);
UPDATE price_change
   SET new_price_minor = CAST(ROUND(new_price * 1000) AS INTEGER)
 WHERE new_currency IN ('BHD', 'IQD', 'JOD', 'LYD', 'OMR', 'TND')
   AND new_price IS NOT NULL
   AND new_price_minor = CAST(ROUND(new_price * 100) AS INTEGER);

-- ── ISO digits 4 (four minor digits): 2 codes ──
UPDATE subscriptions
   SET price_minor = CAST(ROUND(price * 10000) AS INTEGER)
 WHERE currency IN ('CLF', 'UYW')
   AND price IS NOT NULL
   AND price_minor = CAST(ROUND(price * 100) AS INTEGER);
UPDATE price_change
   SET old_price_minor = CAST(ROUND(old_price * 10000) AS INTEGER)
 WHERE old_currency IN ('CLF', 'UYW')
   AND old_price IS NOT NULL
   AND old_price_minor = CAST(ROUND(old_price * 100) AS INTEGER);
UPDATE price_change
   SET new_price_minor = CAST(ROUND(new_price * 10000) AS INTEGER)
 WHERE new_currency IN ('CLF', 'UYW')
   AND new_price IS NOT NULL
   AND new_price_minor = CAST(ROUND(new_price * 100) AS INTEGER);
