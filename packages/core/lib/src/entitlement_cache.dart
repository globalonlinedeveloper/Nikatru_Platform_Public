import 'dart:convert';

import 'models/entitlement.dart';
import 'storage/secure_store.dart';

/// Persists the user's last-known [Entitlements] to a [SecureStore] so a paid
/// user stays unlocked across restarts and offline.
///
/// A lifetime entitlement (no `expires_at`) is always honoured offline; a
/// subscription is honoured until `expires_at` + [grace], after which the client
/// falls back to not-Pro until the server reconciles on reconnect (ADR 005). The
/// server is always the source of truth; this cache is the offline stand-in.
class EntitlementCache {
  EntitlementCache({
    required SecureStore store,
    String key = 'nikatru.entitlements',
    Duration grace = const Duration(days: 3),
    Duration stalenessCeiling = kEntitlementStalenessCeiling,
  }) : _store = store,
       _key = key,
       _grace = grace,
       _stalenessCeiling = stalenessCeiling;

  final SecureStore _store;
  final String _key;
  final Duration _grace;
  final Duration _stalenessCeiling;

  /// The offline grace window applied after a subscription's `expires_at`.
  Duration get grace => _grace;

  /// How long an unverified answer keeps being honoured — [pipeline 5]M-8.
  Duration get stalenessCeiling => _stalenessCeiling;

  /// Persist [entitlements] as the new last-known value.
  ///
  /// 🔴 CALL [saveVerified] ON THE SERVER-READ PATH INSTEAD. This one persists
  /// whatever verification age the value already carries, so it cannot be used
  /// to launder a stale answer into a fresh one.
  Future<void> save(Entitlements entitlements) =>
      _store.write(_key, jsonEncode(entitlements.toJson()));

  /// Persist [entitlements] as CONFIRMED BY THE SERVER at [now].
  ///
  /// The only writer of `verified_at`, and it is deliberately not [save]: the
  /// staleness ceiling measures the distance to the last SERVER answer, so any
  /// write that could stamp itself fresh would make the ceiling unreachable and
  /// turn M-8 into a constant nothing consults.
  Future<void> saveVerified(Entitlements entitlements, {DateTime? now}) =>
      save(entitlements.verifiedAtNow(now ?? DateTime.now()));

  /// Drop the cached entitlements (e.g. on sign-out).
  Future<void> clear() => _store.delete(_key);

  /// The raw cached entitlements exactly as last saved, or null when nothing is
  /// cached or the cached value is unreadable/corrupt (a corrupt cache can never
  /// take the app down — it is treated as absent).
  ///
  /// THE STORE READ IS INSIDE THE TRY. It used to sit above it, so the documented
  /// failure path only covered a corrupt VALUE and not a failing STORE — and a
  /// [SecureStore] is the one seam here that really throws: a locked Keychain, a
  /// user who has not unlocked the device since boot, a Keystore key invalidated
  /// by a biometric enrolment, a `PlatformException` from the plugin. All of
  /// those escaped as an unhandled error out of what the doc comment promised
  /// was a null-returning read, taking the paywall gate (and whatever called it
  /// during startup) with them. A guarded catch that the guarded call is not
  /// inside is not a guard.
  Future<Entitlements?> readRaw() async {
    try {
      final String? raw = await _store.read(_key);
      if (raw == null) return null;
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map) {
        return Entitlements.fromJson(decoded.cast<String, dynamic>());
      }
    } catch (_) {
      // Unreadable store OR malformed/tampered value — both report "nothing
      // cached", which downgrades to not-Pro rather than crashing.
    }
    return null;
  }

  /// Whether the cached answer is older than the ceiling at [now] — M-8.
  ///
  /// An ABSENT `verified_at` is stale. It is the shape of a cache written before
  /// the field existed and the shape of a corrupt one, and neither is evidence
  /// that a server confirmed anything.
  bool isStaleAt(Entitlements cached, DateTime now) {
    final DateTime? verified = cached.verifiedAt;
    if (verified == null) return true;
    return now.toUtc().difference(verified.toUtc()) > _stalenessCeiling;
  }

  /// The offline entitlement decision at [now] (defaults to the current time):
  /// the cached entitlements when still Pro-valid within [grace], otherwise the
  /// same appId downgraded to not-Pro. Returns [Entitlements.none] when nothing
  /// is cached. The gate should still refresh from the server when online.
  ///
  /// ## [pipeline 5]M-8 — the revocation bound, and the loss taken on purpose
  /// A refund revokes on the server; this client learns of it only by asking.
  /// So access is bounded by how long an UNRE-VERIFIED answer keeps being
  /// honoured, and that bound is [stalenessCeiling].
  ///
  /// [connectivityAvailable] is what makes the bound a relationship rather than
  /// a countdown, and it points in exactly one direction:
  /// - **online and stale ⇒ RE-LOCK.** The refresh had every chance to happen
  ///   and did not, so we stop honouring an answer nobody will confirm.
  /// - **offline and stale ⇒ KEEP PRO.** This is a LOSS, WRITTEN DOWN rather
  ///   than discovered: a user who is refunded and then never reconnects keeps
  ///   access indefinitely. Locking a paying user out of an app they paid for
  ///   because their train went into a tunnel is the larger harm, and it is the
  ///   one that happens thousands of times more often.
  ///
  /// The default is `true` — the LOCKING side — because a caller that has not
  /// thought about connectivity must get the fail-closed answer.
  Future<Entitlements> readValid({
    DateTime? now,
    bool connectivityAvailable = true,
  }) async {
    final Entitlements? cached = await readRaw();
    if (cached == null) return Entitlements.none;
    final DateTime at = now ?? DateTime.now();
    final bool stale = connectivityAvailable && isStaleAt(cached, at);
    if (!stale && cached.isProAt(at, grace: _grace)) return cached;
    return Entitlements(
      appId: cached.appId,
      isPro: false,
      items: const <Entitlement>[],
    );
  }
}

/// 🔒 THE REVOCATION BOUND — [pipeline 5]M-8, and it is a NAMED CONSTANT so CI
/// can assert a relationship instead of trusting a sentence.
///
/// ## Why the number is not free
/// "Access is revoked within the declared bound" cannot fail as an acceptance
/// criterion: declare 365 days and a refunded user keeps Pro for a year, green.
/// So the bound is tied to two facts that live in the rail config, and
/// `tooling/ci/assert-purchase-path.mjs` fails the build if either is violated:
///
///   1. **≤ the trial length.** A 30-day trial that can be cancelled on day 29
///      must not leave 30 more days of honoured access behind it.
///   2. **≤ the shortest billing period (one month).** Past that, a subscriber
///      whose renewal failed keeps a period they did not pay for — and stage 13
///      cut dunning, so nothing else is coming to catch it.
///
/// Seven days sits well inside both and costs a single cheap read per week.
const Duration kEntitlementStalenessCeiling = Duration(days: 7);
