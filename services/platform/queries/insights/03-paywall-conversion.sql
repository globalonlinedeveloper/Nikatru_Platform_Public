-- number: paywall_conversion
-- title:  Paywall conversion
-- source: analytics-events.md § "The ~5 numbers" #3 — "`paywall_viewed` →
--         `checkout_started` → `purchase_success` (stage 5)"
-- params: ?1 app_id · ?2 window_start (inclusive) · ?3 window_end (exclusive)
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THIS COUNTS INSTALLS THAT REACHED EACH STAGE. IT DOES NOT PROVE THEY
-- REACHED THEM IN ORDER, AND IT MUST NOT CLAIM TO. The edge stamps ONE
-- `server_ts` per BATCH (routes/events.ts: `const serverTs = nowIso()` is hoisted
-- above the row loop), so every event the client queued together carries an
-- identical authoritative timestamp. `paywall_viewed < checkout_started` is
-- therefore a TIE, not an ordering, for exactly the events most likely to be
-- queued together — a funnel that filtered on `<` would drop real conversions
-- whenever the user moved fast enough to stay inside one batch, and the drop
-- would look like a conversion problem rather than a measurement artifact.
-- `client_ts` cannot rescue it either: it is user-settable and offline-skewed.
-- This is the recorded finding under E-6 ("in order is unrecoverable") applied
-- rather than re-discovered.
--
-- So: three DISTINCT install counts inside one window, and the ratios between
-- them. That is a funnel in the sense a decision needs — where does the money
-- leak — without an ordering claim the data cannot support.
--
-- DISTINCT is load-bearing, not defensive. A paywall is re-viewed on every
-- trigger; counting rows would make the top of the funnel grow with engagement
-- and drive the conversion rate DOWN as the product got stickier.
--
-- Each rate is NULL when its own denominator is 0, never 0.0 — see
-- 01-activation-rate.sql for why a manufactured zero is the worse answer.
-- ─────────────────────────────────────────────────────────────────────────────
WITH staged AS (
  SELECT event, anon_id
  FROM events
  WHERE app_id = ?1
    AND server_ts >= ?2
    AND server_ts <  ?3
    -- `purchase_failed` and `purchase_restored` are deliberately absent: a
    -- failure is not a stage of this funnel and a restore is not a new sale.
    AND event IN ('paywall_viewed', 'checkout_started', 'purchase_success')
)
SELECT
  COUNT(DISTINCT CASE WHEN event = 'paywall_viewed'   THEN anon_id END) AS viewed_installs,
  COUNT(DISTINCT CASE WHEN event = 'checkout_started' THEN anon_id END) AS checkout_installs,
  COUNT(DISTINCT CASE WHEN event = 'purchase_success' THEN anon_id END) AS purchased_installs,
  CASE WHEN COUNT(DISTINCT CASE WHEN event = 'paywall_viewed' THEN anon_id END) = 0 THEN NULL ELSE
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN event = 'checkout_started' THEN anon_id END)
          / COUNT(DISTINCT CASE WHEN event = 'paywall_viewed' THEN anon_id END), 2)
  END AS view_to_checkout_pct,
  CASE WHEN COUNT(DISTINCT CASE WHEN event = 'checkout_started' THEN anon_id END) = 0 THEN NULL ELSE
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN event = 'purchase_success' THEN anon_id END)
          / COUNT(DISTINCT CASE WHEN event = 'checkout_started' THEN anon_id END), 2)
  END AS checkout_to_purchase_pct,
  CASE WHEN COUNT(DISTINCT CASE WHEN event = 'paywall_viewed' THEN anon_id END) = 0 THEN NULL ELSE
    ROUND(100.0 * COUNT(DISTINCT CASE WHEN event = 'purchase_success' THEN anon_id END)
          / COUNT(DISTINCT CASE WHEN event = 'paywall_viewed' THEN anon_id END), 2)
  END AS view_to_purchase_pct
FROM staged;
