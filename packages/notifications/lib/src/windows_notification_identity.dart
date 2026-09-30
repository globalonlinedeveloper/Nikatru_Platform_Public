import 'package:flutter/foundation.dart' show immutable;

/// What Windows needs before it will post a toast for an app: the name the
/// toast shows, the AppUserModelID it is filed under, and the CLSID of the COM
/// activator a tapped toast launches.
///
/// Pure data and plugin-free, so an app can hold one without importing
/// `flutter_local_notifications`. Every stamped app gets its own from its
/// `app.yaml` (`windows.toastActivatorClsid`, beside the MSIX
/// `identityName`): tooling/app-yaml/render.mjs writes the same CLSID into
/// `msix_config.toast_activator` and this value into
/// `lib/core/windows_notification_identity.g.dart`, so the packaged manifest
/// and the running app can never name two different activators.
///
/// No identity ⇒ no Windows notifications at all
/// ([NotificationCapabilities.resolve]): the plugin refuses to initialise
/// without one, and a toggle that says ON over a plugin that never started is
/// the switch-lies shape.
@immutable
class WindowsNotificationIdentity {
  const WindowsNotificationIdentity({
    required this.appName,
    required this.appUserModelId,
    required this.toastActivatorClsid,
  });

  final String appName;

  /// `<PackageFamilyName>!<Application Id>` for the MSIX package.
  final String appUserModelId;

  /// A GUID, `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.
  final String toastActivatorClsid;
}
