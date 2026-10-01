/// Plugin-backed implementation of the NIKATRU core `NotificationService` seam
/// (local streak / daily-goal reminders) for the platforms that support it.
///
/// Inject the result of [createLocalNotificationService] in the app/brick layer
/// so `packages/core` stays pure Dart (CFG G-25 / ADR 005). On Web — where no
/// local-notification plugin exists — this returns a `NoOpNotificationService`
/// and the app shows an in-app catch-up nudge instead.
library;

export 'src/device_timezone.dart';
export 'src/linux_reminders.dart';
export 'src/local_notification_service.dart';
export 'src/notification_capabilities.dart';
export 'src/quiet_hours.dart';
export 'src/windows_notification_identity.dart';
