import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// Resolves the device's IANA timezone name (e.g. `Asia/Kolkata`) for
/// timezone-correct daily scheduling.
///
/// Optional, and what happens WITHOUT one is the part that matters. This used to
/// default to returning the literal `'UTC'`, which `init()` then installed as
/// `tz.local` — so a reminder the seam documents as *"a nudge at [hour]:[minute]
/// local time"* was built at that hour in **UTC** and fired at 14:30 for a 09:00
/// reminder in the owner's own market, or in the middle of the night across the
/// Americas. Nothing in the tree injected a resolver, and every test injected
/// `'UTC'` — the one value where the bug and the correct behaviour agree.
///
/// The default is now the DEVICE's own current UTC offset (see
/// `deviceOffsetLocation`), which is exact for the reminder being scheduled and
/// needs no plugin. Inject a real IANA resolver (e.g. backed by
/// `flutter_timezone`) where full DST-rule correctness matters: a fixed offset
/// cannot know that a zone shifts by an hour next month, so a schedule made
/// before a DST transition fires an hour out until it is next re-armed.
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
/// The matrix is tied to the **pinned `flutter_local_notifications` 17.x** (shared
/// with apps/subly); re-review it on any version bump:
/// - **Android / iOS / macOS** — immediate display + repeating daily schedule.
/// - **Linux** — shows immediately, but `zonedSchedule` is unimplemented (the
///   Linux backend can't schedule, in 17.x–19.x alike) → show yes, schedule no.
/// - **Windows** — 17.x has **no Windows plugin** (support landed in 18.x), so it
///   can neither show nor schedule → both no-op. Revisit if the workspace moves
///   to 18.x+ and wires `WindowsInitializationSettings`.
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

  /// Whether repeating daily schedules (`scheduleDaily`) work on this platform.
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
        // 17.x through 19.x. Show yes, repeat-schedule no.
        return const NotificationCapabilities(
          canNotify: true,
          canSchedule: false,
        );
      case TargetPlatform.windows:
        // The pinned flutter_local_notifications 17.x has NO Windows plugin
        // (Windows support arrived in 18.x); calling show/cancel there throws.
        // Treat Windows as fully unsupported until the workspace bumps to 18.x+.
        return const NotificationCapabilities(
          canNotify: false,
          canSchedule: false,
        );
      case TargetPlatform.fuchsia:
        return const NotificationCapabilities(
          canNotify: false,
          canSchedule: false,
        );
    }
  }

  @override
  String toString() =>
      'NotificationCapabilities(canNotify: $canNotify, canSchedule: $canSchedule)';
}
