import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// Which out-of-window surface shows the glance on a target.
enum GlanceSurface {
  /// Android AppWidget or iOS WidgetKit, through home_widget.
  homeWidget,

  /// A tray / menu-bar item (Windows, Linux, macOS until WidgetKit lands).
  trayItem,

  /// The installed PWA's app badge.
  appBadge,

  /// Nothing — Fuchsia.
  none,
}

/// Which launcher surface carries the shortcuts on a target.
enum ShortcutSurface {
  /// Android ShortcutManager / iOS home-screen quick actions, via quick_actions.
  quickActions,

  /// The Windows taskbar jump list.
  jumpList,

  /// The macOS dock menu.
  dockMenu,

  /// The PWA manifest `shortcuts` (web) — declared in web/manifest.json.
  manifest,

  /// No launcher surface (Linux desktop files have Actions, not built here).
  none,
}

/// What the out-of-window surfaces can do on a platform — [pipeline C-7].
///
/// Pinned to **`home_widget` 0.10.x and `quick_actions` 1.x**. Each row says
/// both what the surface IS on that target (the parity lock: an equivalent is
/// named, never skipped) and whether THIS build ships it yet. A `false` in a
/// `*Built` field is a named wait, and [why] says what it waits for.
@immutable
class GlanceCapabilities {
  const GlanceCapabilities({
    required this.surface,
    required this.glanceBuilt,
    required this.shortcuts,
    required this.shortcutsBuilt,
    required this.shareIn,
    required this.why,
  });

  final GlanceSurface surface;
  final bool glanceBuilt;
  final ShortcutSurface shortcuts;
  final bool shortcutsBuilt;

  /// Whether a share from another app reaches the import route on this
  /// target in this build.
  final bool shareIn;

  /// The one-line reason, never empty.
  final String why;

  /// The capabilities for [platform]. [isWeb] wins over the host platform.
  static GlanceCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const GlanceCapabilities(
        surface: GlanceSurface.appBadge,
        glanceBuilt: true,
        shortcuts: ShortcutSurface.manifest,
        shortcutsBuilt: false,
        shareIn: false,
        why:
            'The Badging API shows the count due this week on an installed '
            'PWA (Chromium, Safari 17+); Firefox ignores it. Manifest '
            'shortcuts wait for a URL that opens the add sheet; share-in '
            'waits for a Web Share Target handler (a service worker route).',
      );
    }
    switch (platform) {
      case TargetPlatform.android:
        return const GlanceCapabilities(
          surface: GlanceSurface.homeWidget,
          glanceBuilt: true,
          shortcuts: ShortcutSurface.quickActions,
          shortcutsBuilt: true,
          shareIn: false,
          why:
              'home_widget writes SharedPreferences the AppWidget reads; '
              'quick_actions publishes dynamic shortcuts. Share-in on Android '
              'is not in the brief (iOS and macOS are) and is not claimed.',
        );
      case TargetPlatform.iOS:
        return const GlanceCapabilities(
          surface: GlanceSurface.homeWidget,
          glanceBuilt: false,
          shortcuts: ShortcutSurface.quickActions,
          shortcutsBuilt: true,
          shareIn: false,
          why:
              'home_widget writes the app-group UserDefaults; the WidgetKit '
              'and Share extension TARGETS need Xcode to add to the project '
              'and an app group on the provisioning profile, so both wait for '
              'a Mac with the pinned Xcode. Quick actions ship now.',
        );
      case TargetPlatform.macOS:
        return const GlanceCapabilities(
          surface: GlanceSurface.trayItem,
          glanceBuilt: false,
          shortcuts: ShortcutSurface.dockMenu,
          shortcutsBuilt: false,
          shareIn: false,
          why:
              'home_widget 0.10 has no macOS implementation, so the glance is '
              'a menu-bar item until a WidgetKit extension is added in Xcode; '
              'the dock menu and the Services entry are AppDelegate code that '
              'waits for the same Mac.',
        );
      case TargetPlatform.windows:
        return const GlanceCapabilities(
          surface: GlanceSurface.trayItem,
          glanceBuilt: false,
          shortcuts: ShortcutSurface.jumpList,
          shortcutsBuilt: false,
          shareIn: false,
          why:
              'Windows has no home-screen widget for a Win32 app; the '
              'equivalent is a notification-area item and the taskbar jump '
              'list, both runner (C++) code that waits for a Windows build.',
        );
      case TargetPlatform.linux:
        return const GlanceCapabilities(
          surface: GlanceSurface.trayItem,
          glanceBuilt: false,
          shortcuts: ShortcutSurface.none,
          shortcutsBuilt: false,
          shareIn: false,
          why:
              'The equivalent is a StatusNotifierItem (libayatana-appindicator), '
              'which waits for the runner; GNOME without the extension shows '
              'no tray at all, so Linux degrades to the in-app summary.',
        );
      case TargetPlatform.fuchsia:
        return const GlanceCapabilities(
          surface: GlanceSurface.none,
          glanceBuilt: false,
          shortcuts: ShortcutSurface.none,
          shortcutsBuilt: false,
          shareIn: false,
          why: 'No implementation of either plugin.',
        );
    }
  }
}
