/// The surfaces an app shows outside its own window — XP-04, XP-05, IM-11.
///
/// [GlanceSnapshot] is the two-fact glance (Pro, ADR 101) every widget, tray
/// item and app badge renders; [GlancePublisher] writes it; [LauncherShortcuts]
/// owns the launcher shortcuts; [ShareIntake] hands a share to the import
/// route. [GlanceCapabilities] names each target's surface, built or waiting.
library;

export 'src/app_shortcuts.dart';
export 'src/glance.dart';
export 'src/glance_capabilities.dart';
export 'src/glance_publisher.dart';
export 'src/share_intake.dart';
