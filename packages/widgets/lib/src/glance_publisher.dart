import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:home_widget/home_widget.dart';

import 'glance.dart';
import 'glance_capabilities.dart';
import 'web_badge.dart';

/// Writes a [GlanceSnapshot] to wherever this target shows one.
abstract interface class GlancePublisher {
  Future<void> publish(GlanceSnapshot snapshot);

  /// ⏱ 2026-10-02 · review of #1155, finding 7. Forgets every value the
  /// surface holds — run by every sign-out, so a signed-out phone's home
  /// screen does not keep the last account's renewals. Never throws: the
  /// glance is a mirror, and a sign-out must not fail over one.
  Future<void> clear();
}

/// A publisher that does nothing — a target whose surface is not built yet,
/// a test, a demo build. Named rather than null so the app's call site never
/// branches.
class NoGlancePublisher implements GlancePublisher {
  const NoGlancePublisher();

  @override
  Future<void> publish(GlanceSnapshot snapshot) async {}

  @override
  Future<void> clear() async {}
}

/// Android AppWidget and iOS WidgetKit, through `home_widget`.
///
/// The widget classes it names are the native halves of the contract in
/// [GlanceSnapshot.toWidgetData]: `GlanceWidgetProvider` in the app's
/// android/ tree, and the WidgetKit kind `GlanceWidget` in its iOS extension.
class HomeWidgetGlancePublisher implements GlancePublisher {
  HomeWidgetGlancePublisher({
    required this.androidProvider,
    required this.iOSKind,
    this.appGroupId,
  });

  /// The fully-qualified AppWidgetProvider class.
  final String androidProvider;

  /// The WidgetKit `kind`.
  final String iOSKind;

  /// The iOS app group both the app and the extension are entitled to.
  final String? appGroupId;

  bool _grouped = false;

  @override
  Future<void> publish(GlanceSnapshot snapshot) async {
    try {
      final String? group = appGroupId;
      if (group != null && !_grouped) {
        await HomeWidget.setAppGroupId(group);
        _grouped = true;
      }
      for (final MapEntry<String, String> e
          in snapshot.toWidgetData().entries) {
        await HomeWidget.saveWidgetData<String>(e.key, e.value);
      }
      await HomeWidget.updateWidget(
        qualifiedAndroidName: androidProvider,
        iOSName: iOSKind,
      );
    } on Object catch (e) {
      // A widget that was never added, or an extension not yet in this build,
      // must not fail a sync: the glance is a mirror, never the record.
      debugPrint('glance: home widget not updated ($e)');
    }
  }

  @override
  Future<void> clear() async {
    try {
      final String? group = appGroupId;
      if (group != null && !_grouped) {
        await HomeWidget.setAppGroupId(group);
        _grouped = true;
      }
      for (final String key in GlanceSnapshot.widgetKeys) {
        await HomeWidget.saveWidgetData<String>(key, null);
      }
      await HomeWidget.updateWidget(
        qualifiedAndroidName: androidProvider,
        iOSName: iOSKind,
      );
    } on Object catch (e) {
      debugPrint('glance: home widget not cleared ($e)');
    }
  }
}

/// The web equivalent: the installed PWA's app badge, set to the count due
/// this week (`navigator.setAppBadge`). A browser without the Badging API, or
/// a page that is not installed, ignores it.
class WebBadgeGlancePublisher implements GlancePublisher {
  const WebBadgeGlancePublisher();

  @override
  Future<void> publish(GlanceSnapshot snapshot) =>
      setAppBadge(snapshot.locked ? 0 : snapshot.badgeCount);

  @override
  Future<void> clear() async {
    try {
      await setAppBadge(0);
    } on Object catch (e) {
      debugPrint('glance: badge not cleared ($e)');
    }
  }
}

/// The publisher for [platform], by [GlanceCapabilities]: the one call an
/// app's composition root makes.
GlancePublisher glancePublisherFor(
  TargetPlatform platform, {
  required bool isWeb,
  required String androidProvider,
  required String iOSKind,
  String? appGroupId,
}) {
  final GlanceCapabilities caps = GlanceCapabilities.forPlatform(
    platform,
    isWeb: isWeb,
  );
  switch (caps.surface) {
    case GlanceSurface.homeWidget:
      return HomeWidgetGlancePublisher(
        androidProvider: androidProvider,
        iOSKind: iOSKind,
        appGroupId: appGroupId,
      );
    case GlanceSurface.appBadge:
      return const WebBadgeGlancePublisher();
    case GlanceSurface.trayItem:
    case GlanceSurface.none:
      return const NoGlancePublisher();
  }
}

/// Taps on a home-screen glance, as app routes from a CLOSED set.
///
/// The widget writes `?route=` into the launch URI from the link the app
/// stored; this re-checks it against [allowed] before anything routes, so a
/// value that is not one of the app's own widget routes opens nothing.
class GlanceTaps {
  const GlanceTaps({required this.allowed});

  final Set<String> allowed;

  /// The route a launch [uri] asks for, or null.
  String? routeOf(Uri? uri) {
    final String? route = uri?.queryParameters['route'];
    return route != null && allowed.contains(route) ? route : null;
  }

  /// Delivers the tap that launched the app, then every later one. Returns the
  /// cancel. A target with no home widget delivers nothing.
  Future<void> Function() listen(void Function(String route) onRoute) {
    void deliver(Uri? uri) {
      final String? route = routeOf(uri);
      if (route != null) onRoute(route);
    }

    final StreamSubscription<Uri?> sub = HomeWidget.widgetClicked.listen(
      deliver,
      onError: (Object e) => debugPrint('glance: tap unreadable ($e)'),
    );
    HomeWidget.initiallyLaunchedFromHomeWidget()
        .then(deliver)
        .catchError(
          (Object e) => debugPrint('glance: launch tap unreadable ($e)'),
        );
    return sub.cancel;
  }
}
