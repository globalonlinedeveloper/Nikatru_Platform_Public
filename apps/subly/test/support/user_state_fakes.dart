import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/services/notifications/notification_service.dart'
    as subly;

/// The two seams `forgetSignedInUser` drives, as fakes a widget test can drive.
///
/// 🔴 WHY EVERY TEST THAT REACHES A SIGN-OUT NEEDS THESE. `FlutterSecureStore`
/// and the chassis notification adapter are platform channels, and in a widget
/// test an unmocked channel call does not fail — it NEVER COMPLETES. Measured
/// 2026-08-11: a probe that awaited `entitlementCacheProvider.clear()` inside a
/// pumped widget printed neither a result nor an error, and `pumpAndSettle`
/// returned clean over the still-pending future. So the screen simply stops
/// half-way through, which reads exactly like a handler that was never wired.
///
/// Subly's own [subly.NotificationService] fork needs no such care — its methods
/// return early until `init()` has run — but it is faked here anyway, because
/// "it happens not to touch the plugin today" is not something a test should
/// depend on, and the renewal reminders it owns are what part (b) is about.

/// An in-memory [core.SecureStore].
class MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};

  @override
  Future<void> delete(String key) async => data.remove(key);

  @override
  Future<void> deleteAll() async => data.clear();

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A [core.NotificationService] that records what reached it.
///
/// 🔴 `cancelAll` REALLY DROPS THE SCHEDULE. Counting the call and leaving the
/// list populated is how "cancelled" and "still armed" become the same
/// observation — the device would still fire. The assertion worth making is
/// against what is LEFT, so this fake has to be able to be left non-empty.
class FakeNotifications implements core.NotificationService {
  int cancelAllCalls = 0;
  final List<core.DailyReminder> scheduled = <core.DailyReminder>[];
  final StreamController<core.NotificationTap> taps =
      StreamController<core.NotificationTap>.broadcast();

  @override
  Future<void> init() async {}

  @override
  Future<bool> requestPermission() async => true;

  @override
  Future<void> showNow({required String title, required String body}) async {}

  @override
  Future<void> scheduleDaily(core.DailyReminder reminder) async {
    scheduled.removeWhere((core.DailyReminder r) => r.id == reminder.id);
    scheduled.add(reminder);
  }

  @override
  Future<void> cancel(int id) async =>
      scheduled.removeWhere((core.DailyReminder r) => r.id == id);

  @override
  Future<void> cancelAll() async {
    cancelAllCalls++;
    scheduled.clear();
  }

  @override
  Stream<core.NotificationTap> notificationTaps() => taps.stream;
}

/// Subly's frozen fork, recording. Subclassed through `forTesting()` — the same
/// route `settings_wiring_test.dart` takes, because the production object is a
/// singleton that cannot be replaced.
class RecordingSublyNotifications extends subly.NotificationService {
  RecordingSublyNotifications() : super.forTesting();

  int cancelAllCalls = 0;

  @override
  Future<void> cancelAll() async => cancelAllCalls++;
}

/// A cached LIFETIME Pro entitlement, written the way the money rail writes it.
///
/// Lifetime on purpose: no `expires_at`, so `readValid` honours it offline for
/// ever. A cache seeded with something that expires could be emptied by the
/// clock rather than by the sign-out, and the test would pass for the wrong
/// reason.
///
/// Shared rather than copied because TWO harnesses need it now — the widget
/// test that drives the settings screen directly, and the ROUTER test that is
/// the only one able to see the disposal race (`sign_out_destination_test.dart`).
Future<void> seedLifetimePro(core.EntitlementCache cache) => cache.saveVerified(
  const core.Entitlements(
    appId: 'subly',
    isPro: true,
    items: <core.Entitlement>[
      core.Entitlement(
        entitlement: 'pro',
        productId: 'pro_lifetime',
        store: 'test',
        isActive: true,
      ),
    ],
  ),
);

/// The raw cached value, straight out of the store — NOT through
/// `EntitlementCache.readRaw`, which answers null for an unreadable store as
/// well as for an absent one. Only the store itself can tell "cleared" from
/// "could not be read".
String? rawEntitlementCache(MemSecureStore store) =>
    store.data['nikatru.entitlements'];
