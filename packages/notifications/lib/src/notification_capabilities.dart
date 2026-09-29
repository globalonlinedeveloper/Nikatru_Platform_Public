import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

import 'windows_notification_identity.dart';

/// Resolves the device's IANA timezone name (e.g. `Asia/Kolkata`) for
/// timezone-correct scheduling.
///
/// Optional, and what happens WITHOUT one is the part that matters. This used to
/// default to returning the literal `'UTC'`, which `init()` then installed as
/// `tz.local` — so a reminder the seam documents as *"a nudge at [hour]:[minute]
/// local time"* was built at that hour in **UTC** and fired at 14:30 for a 09:00
/// reminder in the owner's own market, or in the middle of the night across the
/// Americas. Nothing in the tree injected a resolver, and every test injected
/// `'UTC'` — the one value where the bug and the correct behaviour agree.
///
/// The default is now the DEVICE'S OWN IANA ZONE, read through
/// `flutter_timezone` by `deviceIanaTimezone` (device_timezone.dart), which
/// carries the DST rules a fixed offset cannot. When that read fails the
/// resolution degrades to the device's current UTC offset — exact today, one
/// hour out across the next DST change — and SAYS SO through
/// `LocalTimezoneResolution.fallbackReason`. Inject a resolver only from a test.
typedef LocalTimezoneResolver = Future<String> Function();

/// Reads the running device's current UTC offset. Injectable ONLY so the
/// local-vs-UTC difference can be asserted from a test: a test process cannot
/// choose the offset `DateTime.now()` reports, so a test that used the real one
/// would assert nothing on a UTC CI runner — which is exactly how the original
/// defect stayed invisible.
typedef DeviceUtcOffset = Duration Function();

/// What a platform can do with local notifications — the portability seam that
/// drives every runtime guard in the notification adapter.
///
/// The matrix is tied to the **pinned `flutter_local_notifications` 22.x** (shared
/// with apps/subscriptiontracker); re-review it on any version bump:
/// - **Android / iOS / macOS** — immediate display + repeating daily schedule.
/// - **Linux** — shows immediately, but `zonedSchedule` is unimplemented (the
///   Linux backend can't schedule, in 17.x–22.x alike) → show yes, schedule no.
/// - **Windows** — shows and schedules ONE-OFF notifications (the 22.x Windows
///   plugin, since 19.0.0; it cannot repeat, so a daily schedule is the next
///   instance only and the boot-path resync re-arms it). It needs the app's
///   [WindowsNotificationIdentity]; [resolve] reports neither without one
///   (O-RENEWAL-REMINDERS-OFF-ON-DESKTOP).
/// - **Web / Fuchsia** — neither.
///
/// Unsupported operations no-op and callers fall back to an in-app catch-up nudge.
@immutable
class NotificationCapabilities {
  const NotificationCapabilities({
    required this.canNotify,
    required this.canSchedule,
  });

  /// Whether immediate notifications (`showNow`) work on this platform.
  final bool canNotify;

  /// Whether OS-brokered schedules (`scheduleAt`, `scheduleDaily`) work on
  /// this platform.
  final bool canSchedule;

  /// The capabilities for [platform] (with [isWeb] taking precedence — a web
  /// build reports its host [TargetPlatform] but has no notification plugin).
  static NotificationCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const NotificationCapabilities(
        canNotify: false,
        canSchedule: false,
      );
    }
    switch (platform) {
      case TargetPlatform.android:
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
        // Full support: immediate display + repeating daily zonedSchedule.
        return const NotificationCapabilities(
          canNotify: true,
          canSchedule: true,
        );
      case TargetPlatform.linux:
        // flutter_local_notifications shows immediately on Linux but has NO
        // zonedSchedule implementation (throws UnimplementedError) — true in
        // 17.x through 22.x. Show yes, repeat-schedule no.
        return const NotificationCapabilities(
          canNotify: true,
          canSchedule: false,
        );
      case TargetPlatform.windows:
        // flutter_local_notifications 22.x's Windows plugin shows and
        // zonedSchedules (one-off: it ignores matchDateTimeComponents). It
        // needs the app's WindowsNotificationIdentity, which [resolve] checks.
        return const NotificationCapabilities(
          canNotify: true,
          canSchedule: true,
        );
      case TargetPlatform.fuchsia:
        return const NotificationCapabilities(
          canNotify: false,
          canSchedule: false,
        );
    }
  }

  /// What THIS app can do on [platform] — [forPlatform], less what the app has
  /// not supplied. On Windows that is its [WindowsNotificationIdentity]: with
  /// none the plugin is never initialised, so both are false. Every other
  /// platform is [forPlatform] unchanged.
  static NotificationCapabilities resolve(
    TargetPlatform platform, {
    required bool isWeb,
    WindowsNotificationIdentity? windows,
  }) {
    if (!isWeb && platform == TargetPlatform.windows && windows == null) {
      return const NotificationCapabilities(
        canNotify: false,
        canSchedule: false,
      );
    }
    return forPlatform(platform, isWeb: isWeb);
  }

  @override
  String toString() =>
      'NotificationCapabilities(canNotify: $canNotify, canSchedule: $canSchedule)';
}
