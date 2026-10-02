import 'package:flutter/foundation.dart';
import 'package:quick_actions/quick_actions.dart';

/// One launcher shortcut: a stable [type] the OS hands back, the app route it
/// opens, and its localized title.
@immutable
class AppShortcut {
  const AppShortcut({
    required this.type,
    required this.route,
    required this.title,
    this.icon,
  });

  /// Stable across releases: a pinned shortcut stores it, so renaming one
  /// strands every pin made before.
  final String type;

  /// The app location it opens, e.g. `/home?add=1`.
  final String route;
  final String title;

  /// A native drawable / asset-catalog name, or null for the platform default.
  final String? icon;
}

/// Maps a shortcut [type] the OS delivered to the route it opens.
///
/// 🔴 AN UNKNOWN TYPE OPENS NOTHING. A shortcut pinned by an older build, or a
/// type an attacker-controlled intent made up, is ignored rather than
/// interpreted: the route table is the closed set this app declared.
String? routeForShortcut(String? type, List<AppShortcut> shortcuts) {
  for (final AppShortcut s in shortcuts) {
    if (s.type == type) return s.route;
  }
  return null;
}

/// The launcher shortcuts through `quick_actions` (Android ShortcutManager,
/// iOS quick actions — which App Intents surface in Siri and Spotlight).
///
/// [onRoute] is called with the route for a launch or a tap while running;
/// the app hands it to its router.
class LauncherShortcuts {
  LauncherShortcuts({
    required this.shortcuts,
    required this.onRoute,
    QuickActions? quickActions,
  }) : _qa = quickActions ?? const QuickActions();

  final List<AppShortcut> shortcuts;
  final void Function(String route) onRoute;
  final QuickActions _qa;

  /// Registers the handler first, then the items: a cold launch from a
  /// shortcut delivers its type to the handler set here, so the order is the
  /// difference between landing on the add sheet and landing on home.
  Future<void> install() async {
    try {
      await _qa.initialize(handle);
      await _qa.setShortcutItems(<ShortcutItem>[
        for (final AppShortcut s in shortcuts)
          ShortcutItem(type: s.type, localizedTitle: s.title, icon: s.icon),
      ]);
    } on Object catch (e) {
      debugPrint('shortcuts: not installed ($e)');
    }
  }

  /// The handler, public so a test can deliver a type as the OS would.
  void handle(String type) {
    final String? route = routeForShortcut(type, shortcuts);
    if (route != null) onRoute(route);
  }
}
