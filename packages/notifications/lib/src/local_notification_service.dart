import 'package:flutter/services.dart' show SystemNavigator;
import 'package:nikatru_core/nikatru_core.dart'
    show NotificationAction, NotificationService;

import 'linux_reminders.dart';
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
/// - Linux → shows immediately, and schedules through this package's ledger
///   (in process, a launch catch-up, and the `--remind` login entry — NO-04).
/// - Web → a `NoOpNotificationService` (no plugin; show an in-app nudge instead).
///
/// Unsupported operations degrade to a safe no-op.
///
/// [localTimezone] is OPTIONAL and no longer the difference between right and
/// wrong: with none supplied the service anchors reminders to the device's own
/// IANA zone (or, failing that, its current UTC offset), so `hour: 9` means
/// 09:00 where the user is. Inject one only from a test.
///
/// [linuxAppId] names the Linux ledger's directory (default: the binary's
/// name). [darwinActions] are the buttons Apple registers at initialize for
/// every notification that carries actions (NO-10) — already translated.
NotificationService createLocalNotificationService({
  LocalTimezoneResolver? localTimezone,
  WindowsNotificationIdentity? windows,
  String? linuxAppId,
  List<NotificationAction> darwinActions = const <NotificationAction>[],
}) => createPlatformNotificationService(
  localTimezone: localTimezone,
  windows: windows,
  linuxAppId: linuxAppId,
  darwinActions: darwinActions,
);

/// Whether this process was started by the XDG autostart entry to show due
/// reminders and exit (NO-04) — Linux only; false everywhere else.
bool isRemindLaunch() => platformIsRemindLaunch();

/// The login-time `--remind` run (NO-04), whole: when [isRemindLaunch], show
/// every reminder the Linux ledger holds that fell due while the app was
/// closed, then leave — no window (the Linux runner draws none for it), no
/// telemetry, no daemon. True when it ran, and the caller's `main()` returns
/// at once; false everywhere else, off Linux always. Every app's autostart
/// entry runs its binary this way, so the run lives here, not in an app.
Future<bool> runRemindLaunch({String? linuxAppId}) async {
  if (!isRemindLaunch()) return false;
  final NotificationService remind = createLocalNotificationService(
    linuxAppId: linuxAppId,
  );
  try {
    await remind.init();
  } finally {
    await SystemNavigator.pop();
  }
  return true;
}

/// The XDG autostart entry that shows due reminders at login (NO-04) — on
/// Linux only; null on every other target, web included. Create it when the
/// user turns reminders on and remove it when they turn them off.
LinuxAutostartControl? createLinuxAutostart({
  String? appId,
  required String appName,
}) => createPlatformLinuxAutostart(appId: appId, appName: appName);
