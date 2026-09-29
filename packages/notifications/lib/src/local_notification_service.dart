import 'package:nikatru_core/nikatru_core.dart' show NotificationService;

import 'notification_capabilities.dart';
import 'windows_notification_identity.dart';
// The real impl imports `flutter_local_notifications`, which has no web support
// (it pulls `dart:ui`/`dart:io`). Conditional import keeps `nikatru_notifications`
// web-compilable: native builds get the plugin-backed service; web gets a stub
// that returns `NoOpNotificationService`.
import 'local_notification_service_stub.dart'
    if (dart.library.io) 'local_notification_service_io.dart';

/// Creates the platform-appropriate [NotificationService] (pinned
/// `flutter_local_notifications` 22.x — see [NotificationCapabilities]).
///
/// - Android / iOS / macOS → immediate display, one-off `scheduleAt` and a
///   daily `zonedSchedule`.
/// - Windows → shows and schedules one-offs, given [windows] (the app's
///   identity from app.yaml); a daily schedule is the next instance only.
///   Without [windows], both no-op.
/// - Linux → shows immediately; scheduling no-ops (no Linux zonedSchedule).
/// - Web → a `NoOpNotificationService` (no plugin; show an in-app nudge instead).
///
/// Unsupported operations degrade to a safe no-op.
///
/// [localTimezone] is OPTIONAL and no longer the difference between right and
/// wrong: with none supplied the service anchors reminders to the device's own
/// IANA zone (or, failing that, its current UTC offset), so `hour: 9` means
/// 09:00 where the user is. Inject one only from a test.
NotificationService createLocalNotificationService({
  LocalTimezoneResolver? localTimezone,
  WindowsNotificationIdentity? windows,
}) =>
    createPlatformNotificationService(
      localTimezone: localTimezone,
      windows: windows,
    );
