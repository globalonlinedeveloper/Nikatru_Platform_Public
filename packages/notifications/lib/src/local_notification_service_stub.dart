import 'package:nikatru_core/nikatru_core.dart'
    show NoOpNotificationService, NotificationAction, NotificationService;

import 'linux_reminders.dart';

import 'notification_capabilities.dart';
import 'windows_notification_identity.dart';

/// Web fallback: no local-notification plugin exists for web, so callers get a
/// [NoOpNotificationService] and show an in-app catch-up nudge instead. Selected
/// by the conditional import in `local_notification_service.dart` when
/// `dart.library.io` is unavailable (i.e. web).
NotificationService createPlatformNotificationService({
  LocalTimezoneResolver? localTimezone,
  WindowsNotificationIdentity? windows,
  String? linuxAppId,
  List<NotificationAction> darwinActions = const <NotificationAction>[],
}) => const NoOpNotificationService();

/// Never on the web.
bool platformIsRemindLaunch() => false;

/// No autostart on the web.
LinuxAutostartControl? createPlatformLinuxAutostart({
  String? appId,
  required String appName,
}) => null;
