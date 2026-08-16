import '../storage/key_value_store.dart';
import 'analytics.dart';

/// 🔒 The persisted marker that `first_launch` has already been EMITTED.
///
/// It does NOT mean "the app has been launched before" — those are different
/// facts and conflating them is how the event ends up firing for a user who
/// declined analytics on their first run and granted it on their second.
const String kFirstLaunchEmittedKey = 'nikatru.analytics.first_launch_done';

/// The last launch this install recorded, ISO-8601 UTC. The `return_visit`
/// denominator.
const String kLastOpenKey = 'nikatru.analytics.last_open';

/// The three launch-time events of the locked taxonomy — §1 Open & acquire and
/// §6 Retain of `analytics-events.md`, the prose page that was folded into
/// `Private/requirements/` on 2026-08-16 (commit e88fdcf) and now reads as
/// origin `[REQ]analytics-events §standard-events`, which carries the standard
/// event list verbatim. The deleted page itself is still
/// `git -C Private show e88fdcf^:requirements/analytics-events.md`.
/// Implemented ONCE for every app the factory stamps.
///
/// 🔴 WHY THIS IS IN `core` AND NOT IN AN APP. It shipped as `AnalyticsFunnel`
/// inside `apps/subly`, so a stamped app inherited `app_open` and nothing else:
/// **1 of the 3 lifecycle events**, with the property test asserting only the
/// one that existed. Fifty stamps would have been fifty copies of a file the
/// brick does not carry — and `first_launch` is the denominator every activation
/// and retention number is divided by, so an app missing it is not "partly
/// instrumented", it is unmeasurable. [pipeline 11]E-5.
///
/// ⚠️ THIS CLASS DOES NOT ENFORCE CONSENT AND MUST NOT BE CALLED BEFORE IT.
/// The [Analytics] recorder is fail-closed and would discard, but discarding is
/// invisible: the first-launch marker would still be written, and the one
/// `first_launch` this install will ever have would be spent on a launch that
/// collected nothing. The gate that owns the consent decision is the only
/// correct caller — exactly as it already was for `app_open`.
class AnalyticsLifecycle {
  AnalyticsLifecycle({
    required Analytics analytics,
    required KeyValueStore store,
    DateTime Function()? clock,
  })  : _analytics = analytics,
        _store = store,
        _now = clock ?? DateTime.now;

  final Analytics _analytics;
  final KeyValueStore _store;
  final DateTime Function() _now;

  /// Emit the launch trio: `first_launch` (once per INSTALL, ever), `app_open`
  /// (every launch), and `return_visit{days_since_last}` on every launch that is
  /// not the first and has a previous launch on record.
  ///
  /// `first_launch`, not `app_install`: a reinstall is indistinguishable from a
  /// new user, so this is an install-level denominator and naming it after an
  /// install invites exactly the person-level reading that skews every cohort
  /// ratio built on it.
  ///
  /// Fire-and-forget and swallows its own failures — analytics is never allowed
  /// to be the reason a launch stalls or a screen fails to appear.
  Future<void> onLaunch() async {
    try {
      final String? emitted = await _store.read(kFirstLaunchEmittedKey);
      final bool isFirst = emitted == null || emitted.isEmpty;
      if (isFirst) {
        await _analytics.log('first_launch');
        // Written AFTER the log, so a throw leaves the marker unset and the
        // event is retried next launch rather than lost forever.
        await _store.write(kFirstLaunchEmittedKey, '1');
      }

      await _analytics.log('app_open');

      final String? lastRaw = await _store.read(kLastOpenKey);
      final DateTime now = _now();
      if (!isFirst && lastRaw != null && lastRaw.isNotEmpty) {
        final DateTime? last = DateTime.tryParse(lastRaw);
        if (last != null) {
          // BUCKETED, never the exact integer. An unbounded day count is a
          // fingerprinting surface in a row that is supposed to be
          // pseudonymous, and the retention curve only needs D1/D7/D30 shape.
          await _analytics.log(
            'return_visit',
            params: <String, Object?>{
              'days_since_last': bucketDaysSinceLast(
                now.difference(last).inDays,
              ),
            },
          );
        }
      }
      await _store.write(kLastOpenKey, now.toUtc().toIso8601String());
    } catch (_) {
      // Never surface. A measurement failure is not a user-facing failure.
    }
  }

  /// D1 / D7 / D30 shaped buckets — an ENUMERABLE param value, per the taxonomy's
  /// "no free text, no unbounded values" rule.
  static String bucketDaysSinceLast(int days) {
    if (days <= 0) return 'same_day';
    if (days == 1) return '1';
    if (days <= 7) return '2_7';
    if (days <= 30) return '8_30';
    return '30_plus';
  }
}
