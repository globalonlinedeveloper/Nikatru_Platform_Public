import 'package:nikatru_core/nikatru_core.dart' show NotificationService;

import 'notification_capabilities.dart';
// The real impl imports `flutter_local_notifications`, which has no web support
// (it pulls `dart:ui`/`dart:io`). Conditional import keeps `nikatru_notifications`
// web-compilable: native builds get the plugin-backed service; web gets a stub
// that returns `NoOpNotificationService`.
import 'local_notification_service_stub.dart'
    if (dart.library.io) 'local_notification_service_io.dart';

/// Creates the platform-appropriate [NotificationService] (pinned
/// `flutter_local_notifications` 17.x — see [NotificationCapabilities]).
///
/// - Android / iOS / macOS → immediate display + daily `zonedSchedule`.
/// - Linux → shows immediately; `scheduleDaily` no-ops (no Linux zonedSchedule).
/// - Windows → both no-op on 17.x (no Windows plugin until 18.x).
/// - Web → a `NoOpNotificationService` (no plugin; show an in-app nudge instead).
///
/// Unsupported operations degrade to a safe no-op.
///
/// [localTimezone] is OPTIONAL and no longer the difference between right and
/// wrong: with none supplied the service anchors reminders to the device's own
/// current UTC offset, so `hour: 9` means 09:00 where the user is. It used to
/// mean 09:00 UTC. Inject a real IANA resolver (e.g. via `flutter_timezone`)
/// where DST-rule correctness across a transition matters.
NotificationService createLocalNotificationService({
  LocalTimezoneResolver? localTimezone,
}) =>
    createPlatformNotificationService(localTimezone: localTimezone);
