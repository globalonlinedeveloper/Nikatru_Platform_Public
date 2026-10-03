// ─────────────────────────────────────────────────────────────────────────────
// Test harness for services/platform — A REAL SQL ENGINE, NOT A DOUBLE.
//
// Ported from services/subscriptiontracker-api/test/harness.ts (2026-08-01, [pipeline B-9]).
// The mechanism is the same and deliberately so: `node:sqlite` with THE REAL
// MIGRATIONS applied, wrapped in D1's interface. What changed is the shape of
// the double this Worker needed.
//
// 🔴 WHY THIS REPLACED `class FakeDb`. events.test.ts used to run against a
// hand-written recorder that pushed every prepared SQL string onto an array and
// answered `{ changes: 1 }` to everything. Against that object:
//
//   · an INSERT naming a column no migration ever created is indistinguishable
//     from a correct one — nothing parses the statement;
//   · `ON CONFLICT(event_id) DO NOTHING` was asserted as a SUBSTRING of the SQL,
//     so the dedup guarantee was proven by grep, not by two rows becoming one;
//   · "the route wrote zero rows" was unprovable in principle. The suite could
//     only say "the route did not call batch()", which is a different claim and
//     the one [pipeline B-4a] cannot be built on;
//   · `batch()` being ONE TRANSACTION was never exercised, so a partial write
//     under a constraint violation would have looked exactly like a clean one.
//
// TWO CAPABILITIES IN ONE OBJECT, ON PURPOSE. subscriptiontracker-api splits `realDb()` from
// `RecordingDb` because its questions split cleanly. This Worker's do not: the
// events route has assertions about WHAT SQL IT CHOSE (the conflict clause, the
// absence of an `ip` column, the exact bound tuple) *and* assertions about WHAT
// LANDED (row counts, dedup, rollback), frequently in the same test. Handing the
// route a recorder for one and an engine for the other would mean two runs of the
// same request that could disagree, which is how a "verified" contract drifts. So
// `RealDb` executes AND records, and every assertion in the file grades the same
// single execution.
//
// The migrations are imported with `?raw` rather than read with node:fs, so the
// schema under test is the schema that ships. Inlining a copy here would let the
// tests keep passing after a migration changed the tree — and platform_db is the
// one database the whole portfolio shares, so that drift is every app's.
// ─────────────────────────────────────────────────────────────────────────────
import { SqliteDb } from '../../_shared/src/ports/fakes/sql';
import entitlements0001 from '../migrations/0001_entitlements.sql?raw';
import analytics0002 from '../migrations/0002_analytics.sql?raw';
import cronHeartbeat0003 from '../migrations/0003_cron_heartbeat.sql?raw';
import moneyRail0004 from '../migrations/0004_money_rail.sql?raw';
import cancellations0005 from '../migrations/0005_cancellation_requests.sql?raw';
import erasureReach0006 from '../migrations/0006_erasure_reach.sql?raw';
import eventsRollup0007 from '../migrations/0007_events_rollup.sql?raw';
import bundleGrants0009 from '../migrations/0009_bundle_grants.sql?raw';
import pendingErasures0010 from '../migrations/0010_pending_erasures.sql?raw';
import signups0011 from '../migrations/0011_signups.sql?raw';
import appleTokens0012 from '../migrations/0012_apple_provider_tokens.sql?raw';
import contentReports0013 from '../migrations/0013_content_reports.sql?raw';
import revenuecatOwnership0015 from '../migrations/0015_revenuecat_ownership.sql?raw';
import providerTokens0016 from '../migrations/0016_provider_tokens.sql?raw';
import extDevices0017 from '../migrations/0017_ext_devices.sql?raw';
import bundleSourceTerm0018 from '../migrations/0018_bundle_source_term.sql?raw';
import oneTimeSource0019 from '../migrations/0019_one_time_source.sql?raw';
import reminders0020 from '../migrations/0020_reminders.sql?raw';
import extLinkFloor0021 from '../migrations/0021_ext_link_floor.sql?raw';
import nativeAttest0022 from '../migrations/0022_native_attest.sql?raw';
import providerTokenEncryption0023 from '../migrations/0023_provider_token_encryption.sql?raw';
import providerTokenClient0024 from '../migrations/0024_provider_token_client.sql?raw';
import boxConfigManifest0025 from '../migrations/0025_box_config_manifest.sql?raw';
import providerPaymentLinks0026 from '../migrations/0026_provider_payment_links.sql?raw';
import aiMeter0027 from '../migrations/0027_ai_meter.sql?raw';
import feedback0027 from '../migrations/0027_feedback.sql?raw';
import refundRequests0028 from '../migrations/0028_refund_requests.sql?raw';
import cancelAttempts0029 from '../migrations/0029_cancel_attempts.sql?raw';

type SQLValue = string | number | bigint | null | Uint8Array;

/**
 * platform_db's migration set, IN APPLICATION ORDER, exactly as
 * `wrangler d1 migrations apply PLATFORM_DB` would apply it.
 *
 * Exported rather than kept private because "this set re-applies cleanly" is
 * itself a property under test ([pipeline B-8]) and a replay test must be able
 * to name the set without re-listing it — a second list is a second thing to
 * forget to extend when 0004 lands.
 */
export const PLATFORM_MIGRATIONS: readonly string[] = [
  entitlements0001,
  analytics0002,
  cronHeartbeat0003,
  moneyRail0004,
  cancellations0005,
  erasureReach0006,
  eventsRollup0007,
  // 0008 is the app_id slug rename — an UPDATE-only data migration over rows
  // this harness never seeds, so it is not in the schema set. 0009 is.
  bundleGrants0009,
  // ⏱ 2026-09-15 · [ADR 081] the pending-erasure ledger.
  pendingErasures0010,
  // ⏱ 2026-09-15 · [ADR 087] the nikatru.com signup list.
  signups0011,
  // ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE: the Apple token a deletion
  // has to revoke with.
  appleTokens0012,
  // ⏱ 2026-09-18 · O-PLAY-AI-CONTENT-REPORTING — the in-app AI content report.
  contentReports0013,
  // 0014 is the consent_artifacts app_id rename (owner 2026-09-22, pre-launch) —
  // an UPDATE-only data migration over rows this harness never seeds, so, like
  // 0008, it is not in the schema set.
  // [ADR 092] §4.4 — the event time a RevenueCat link rests on. ADD COLUMN, so
  // ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS below.
  revenuecatOwnership0015,
  // ⏱ 2026-09-24 · O-GOOGLE-SIGN-IN-NOT-BUILT — one token row per (subject,
  // provider), with 0012's Apple rows copied in.
  providerTokens0016,
  // ⏱ 2026-09-24 · O-EXTENSION-ACCOUNT-CHECK-UNBUILT — the extension's one-time
  // code and its per-device credential.
  extDevices0017,
  // ⏱ 2026-09-26 · O-BUNDLE-MEMBER-INSERT-UNLOCKED — a bundle grant's term, on
  // its source and on the grant. ADD COLUMN, so ledger-protected and NOT in
  // REPLAY_SAFE_MIGRATIONS below.
  bundleSourceTerm0018,
  // ⏱ 2026-09-27 · O-ONE-TIME-GRANT-UNBUILT — the `paddle_one_time` source,
  // term `one_time`. One INSERT … ON CONFLICT DO NOTHING, but it names 0018's
  // ADD COLUMN, so it is NOT in REPLAY_SAFE_MIGRATIONS below (that subset
  // replays without 0018).
  oneTimeSource0019,
  // ⏱ 2026-09-28 · ST-R1/ST-R2 — the reminder preference, the sent ledger and
  // the calendar feed.
  reminders0020,
  // ⏱ 2026-09-30 · EXA-11 — the extension-link floor and each link's sign-in
  // time. ADD COLUMN, so ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS below.
  extLinkFloor0021,
  // ⏱ 2026-09-29 · ADR no.NNN — the native sign-in attestation state: redeemed
  // challenge nonces, registered install keys and the daily counters.
  nativeAttest0022,
  // ⏱ 2026-09-30 · review round 2 (security) — the provider refresh tokens are
  // encrypted at rest: `token_ct` and `token_key_id` on provider_tokens. ADD
  // COLUMN, so ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS below.
  providerTokenEncryption0023,
  // ⏱ 2026-10-02 · review of #1155, finding 1 — the OAuth client a provider
  // token was issued to (the bundle id, for a native Apple sheet). ADD
  // COLUMN, so ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS below.
  providerTokenClient0024,
  // ⏱ 2026-10-01 · PB-27 — what each box says its live config hashes are
  // (routes/box-manifest.ts).
  boxConfigManifest0025,
  // ⏱ 2026-10-03 · merge of main into #1176: the four below were 0025-0028 and
  // shifted to 0026-0029 behind main's 0025_box_config_manifest
  // (check-migrations: one number per directory).
  // ⏱ 2026-10-02 · PR #1149 ruling item 2 — a Razorpay charge's payment → its
  // subscription, so a refund or dispute resolves by payment id.
  providerPaymentLinks0026,
  // ⏱ 2026-10-02 · T17 — the AI meter: credits, allowance, opt-in and the call ledger.
  aiMeter0027,
  // ⏱ 2026-10-03 · lane feedback-intake — the "Report a problem" intake's tables,
  // WRITTEN by src/routes/feedback.ts and src/feedback/ (lane feedback-intake).
  feedback0027,
  // ⏱ 2026-10-02 · refund-finish — the in-window refund requests (MF-5).
  refundRequests0028,
  // ⏱ 2026-10-02 · refund-finish — the cancel executor's retry state. ADD
  // COLUMN, so ledger-protected and NOT in REPLAY_SAFE_MIGRATIONS below.
  cancelAttempts0029,
];

/**
 * The subset of [PLATFORM_MIGRATIONS] that is safe to APPLY TWICE.
 *
 * SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so 0004's entitlement
 * contract — and 0006's erasure-reach column — are inherently once-only. D1's ledger records migration FILE NAMES, so
 * wrangler applies each file exactly once and this is not a production hazard —
 * but it does mean "the whole set re-applies" stopped being true on 2026-08-01
 * and pretending otherwise would have meant weakening the replay test into
 * something vacuous. migrations-replay.test.ts instead CLASSIFIES every statement
 * in the whole set and proves that ALTER … ADD COLUMN is the ONLY non-replay-safe
 * form present anywhere, then replays this subset in full.
 */
export const REPLAY_SAFE_MIGRATIONS: readonly string[] = [
  entitlements0001,
  analytics0002,
  cronHeartbeat0003,
  // 0005 is CREATE TABLE / CREATE INDEX IF NOT EXISTS throughout — it replays.
  // Listed here rather than assumed: the classifier in migrations-replay.test.ts
  // proves the claim, and this list is what it replays to prove it.
  cancellations0005,
  // 0007 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS plus one
  // INSERT … ON CONFLICT DO NOTHING — all three are replay-safe forms, and the
  // seed row is idempotent BY the ON CONFLICT rather than by luck. Same
  // reasoning as 0005: listed so the classifier proves it, not assumed.
  eventsRollup0007,
  // 0009 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS plus one
  // INSERT … ON CONFLICT DO NOTHING — no ALTER TABLE anywhere in it, so it
  // replays. Listed so the classifier PROVES that rather than the comment
  // asserting it.
  bundleGrants0009,
  // 0010 ([ADR 081]) is CREATE TABLE / CREATE INDEX IF NOT EXISTS only.
  pendingErasures0010,
  // 0011 ([ADR 087]) is CREATE TABLE / CREATE INDEX IF NOT EXISTS only.
  signups0011,
  // 0012 is one CREATE TABLE IF NOT EXISTS — it replays.
  appleTokens0012,
  // 0013 is CREATE TABLE / CREATE INDEX IF NOT EXISTS only — it replays.
  contentReports0013,
  // 0016 is one CREATE TABLE IF NOT EXISTS plus one INSERT … SELECT … ON
  // CONFLICT DO NOTHING — both replay-safe forms, and the copy is idempotent BY
  // the conflict clause (test/provider-tokens-migration.test.ts applies it twice).
  // It reads 0012's table, which is listed above it.
  providerTokens0016,
  // 0017 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only — it replays.
  extDevices0017,
  // 0020 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only — it replays.
  reminders0020,
  // 0022 is CREATE TABLE / CREATE INDEX IF NOT EXISTS only — it replays.
  nativeAttest0022,
  // 0025 is one CREATE TABLE IF NOT EXISTS — it replays.
  boxConfigManifest0025,
  // 0026 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only — it replays.
  providerPaymentLinks0026,
  // 0027 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only — it replays.
  aiMeter0027,
  feedback0027,
  // 0028 is CREATE TABLE / CREATE [UNIQUE] INDEX IF NOT EXISTS only — it replays.
  refundRequests0028,
];

/**
 * The engine: platform_db's migrations over node:sqlite, executing AND
 * recording, `batch` ONE transaction.
 *
 * ⏱ 2026-10-02 · port-sql. The engine that lived here is PROMOTED to
 * services/_shared/src/ports/fakes/sql.ts — tooling/ports/sql.json adapter
 * `sqlite`, held to the SQL port's conformance suite — so this Worker and
 * subscriptiontracker-api run ONE engine, not two copies. `RealDb` stays here
 * for one PR, under its old name and with its old default schema, so no test
 * file had to change its import.
 */
export class RealDb extends SqliteDb {
  constructor(schema: readonly string[] = PLATFORM_MIGRATIONS) {
    super(schema);
  }
}

/**
 * ⏱ 2026-09-30 · a TOKEN_ENC_KEY_V1 for tests: 32 bytes (0x01…0x20), standard
 * base64 — the shape `openssl rand -base64 32` gives the owner. Fixed, so a
 * failing case reproduces; its only job is to be a VALID key. Every provider
 * token a test stores is sealed with it (src/lib/token-crypto.ts).
 */
export const TEST_TOKEN_ENC_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));

/** platform_db with the real migrations applied, in order. */
export function realPlatformDb(extraSchema: readonly string[] = []): RealDb {
  return new RealDb([...PLATFORM_MIGRATIONS, ...extraSchema]);
}

// ── one Workers-runtime API Node's WebCrypto does not have ───────────────────
// `crypto.subtle.timingSafeEqual` is a Cloudflare Workers extension, and the MoR
// signature comparison (src/lib/mor/paddle.ts) uses it. Without this shim the
// money route THROWS in Node and every test reports a 500 — which is
// indistinguishable from a request the handler deliberately rejected, i.e. the
// suite would look like it was testing rejection while testing a crash. On a
// money route that failure mode is worse than usual: "the tampered body was
// refused" and "the tampered body crashed the Worker" print the same red, and
// only one of them means the rail is safe.
//
// Ported verbatim from services/subscriptiontracker-api/test/harness.ts:180-208.
// Constant-time-ness is a property of the deployed runtime, not of this shim;
// what is being restored here is PRESENCE.
{
  const subtle = (
    globalThis as unknown as {
      crypto?: {
        subtle?: {
          timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
        };
      };
    }
  ).crypto?.subtle;
  if (subtle && typeof subtle.timingSafeEqual !== 'function') {
    subtle.timingSafeEqual = (a, b) => {
      const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (x.byteLength !== y.byteLength) {
        throw new TypeError('timingSafeEqual: inputs must have the same length');
      }
      let diff = 0;
      for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
      return diff === 0;
    };
  }
}
