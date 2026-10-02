import 'dart:async' show unawaited;

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_widgets/nikatru_widgets.dart';

import '../../core/router/navigator_key.dart';
import '../../core/router/router_provider.dart' show routerProvider;
import '../../data/api/cached_api_client.dart' show CachedApiClient;
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart' show paywallLockedProvider;
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart'
    show subscriptionsControllerProvider;
import '../add/add_subscription_sheet.dart';

/// The routes a home-screen widget tap may open — a CLOSED set. The link is
/// read from the widget's own store, which any code in this app's process can
/// write; it is still never routed unless it is one of these.
const GlanceTaps _widgetTaps = GlanceTaps(
  allowed: <String>{'/home', '/paywall'},
);

/// T16 · the device surfaces, adopted at the root: the app lock over every
/// screen (XP-03), the glance written on each sync (XP-04), the launcher
/// shortcuts (XP-05), and shares routed to the import hub (IM-11).
///
/// Mounted in `MaterialApp.router`'s `builder`, BELOW `Localizations` (so the
/// lock and the shortcut titles are translated) and ABOVE the router's
/// Navigator (so the lock covers every route, dialogs included).
class DeviceSurfacesHost extends ConsumerStatefulWidget {
  const DeviceSurfacesHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<DeviceSurfacesHost> createState() => _DeviceSurfacesHostState();
}

class _DeviceSurfacesHostState extends ConsumerState<DeviceSurfacesHost> {
  bool _installed = false;
  Map<String, String>? _lastGlance;
  Future<void> Function()? _cancelTaps;

  /// Refreshed on every dependency change, so a locale switch re-words the
  /// next glance.
  late AppLocalizations _l10n;

  @override
  void initState() {
    super.initState();
    // The lock's recovery is a full sign-out, through the ONE call site that
    // may make it (providers/auth.dart).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(appLockSignOutProvider.notifier).state = () =>
          signOutAndForgetUser(ref);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _l10n = AppLocalizations.of(context);
    if (_installed) return;
    _installed = true;
    final AppLocalizations l10n = _l10n;
    final GlanceCapabilities caps = GlanceCapabilities.forPlatform(
      defaultTargetPlatform,
      isWeb: kIsWeb,
    );
    if (caps.shortcutsBuilt && caps.shortcuts == ShortcutSurface.quickActions) {
      unawaited(
        LauncherShortcuts(
          shortcuts: sublyShortcuts(l10n),
          onRoute: _open,
        ).install(),
      );
    }
    unawaited(
      ShareIntake(
        onShared: (SharedPayload p) =>
            ref.read(routerProvider).go(shareIntakeRoute, extra: p),
      ).install(),
    );
    if (caps.surface == GlanceSurface.homeWidget) {
      _cancelTaps = _widgetTaps.listen(_open);
    }
    // The glance is written on each sync (the list changes) and on each plan
    // change (Pro locks or unlocks it), and once now.
    ref.listenManual(
      subscriptionsControllerProvider,
      (_, _) => _publishGlance(),
      fireImmediately: true,
    );
    ref.listenManual(paywallLockedProvider, (_, _) => _publishGlance());
    // ⏱ 2026-10-02 · review of #1155, finding 7: turning the app lock on or
    // off hides or shows the figures at once, not at the next sync.
    final AppLockController lock = ref.read(appLockControllerProvider)
      ..addListener(_publishGlance);
    _lock = lock;
  }

  AppLockController? _lock;

  @override
  void dispose() {
    _lock?.removeListener(_publishGlance);
    final Future<void> Function()? cancel = _cancelTaps;
    if (cancel != null) unawaited(cancel());
    super.dispose();
  }

  /// Routes a shortcut or widget tap. `/home?add=1` opens home, then the add
  /// sheet over it — the sheet is a modal, not a route, so it cannot be a URL.
  void _open(String route) {
    final GoRouter router = ref.read(routerProvider);
    if (route == addSheetRoute) {
      router.go('/home');
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final BuildContext? ctx = rootNavigatorKey.currentContext;
        if (ctx != null) unawaited(showAddSubscriptionSheet(ctx));
      });
      return;
    }
    router.go(route);
  }

  /// Writes the glance when what it would show has changed. Comparing the
  /// flat map keeps a rebuild from re-writing the widget store every frame.
  void _publishGlance() {
    if (!mounted) return;
    final List<Subscription>? subs = ref
        .read(subscriptionsControllerProvider)
        .value;
    if (subs == null) return;
    // Signed out: the sign-out cleared the glance (`userStateDrops`), and an
    // empty list landing after it must not write "This month: 0" back.
    if (glanceSignedOut(ref)) {
      _lastGlance = null;
      return;
    }
    final AppLockController lock = ref.read(appLockControllerProvider);
    final GlanceSnapshot snapshot;
    try {
      snapshot = sublyGlance(
        subs: subs,
        locked: ref.read(paywallLockedProvider),
        now: ref.read(nowProvider)(),
        l10n: _l10n,
        // Not yet read counts as on: a cold start must not publish the
        // figures in the frames before the store answers.
        appLocked: lock.enabled || !lock.ready,
      );
    } on Object catch (e) {
      // The glance is a mirror, never the record: a fact that cannot be
      // formatted skips this write and must not reach the app's error path.
      debugPrint('glance: not built ($e)');
      return;
    }
    final Map<String, String> data = snapshot.toWidgetData();
    if (_mapEquals(data, _lastGlance)) return;
    _lastGlance = data;
    unawaited(ref.read(glancePublisherProvider).publish(snapshot));
  }

  static bool _mapEquals(Map<String, String> a, Map<String, String>? b) {
    if (b == null || a.length != b.length) return false;
    for (final MapEntry<String, String> e in a.entries) {
      if (b[e.key] != e.value) return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = _l10n;
    return AppLockGate(
      controller: ref.watch(appLockControllerProvider),
      strings: AppLockStrings(
        title: l10n.appLockTitle,
        pinLabel: l10n.appLockPinLabel,
        unlock: l10n.appLockUnlock,
        useBiometric: l10n.appLockUseBiometric,
        biometricReason: l10n.appLockBiometricReason,
        forgotPin: l10n.appLockForgotPin,
        wrongPin: l10n.appLockWrongPin,
        lockedOut: l10n.appLockLockedOut,
        unsyncedWarning: l10n.appLockUnsyncedWarning,
        signOutAnyway: l10n.appLockSignOutAnyway,
        keepChanges: l10n.appLockKeepChanges,
      ),
      child: widget.child,
    );
  }
}

/// Whether nobody is signed in on a build that HAS accounts. In the
/// unconfigured posture the list is the device's own and the glance shows it.
bool glanceSignedOut(WidgetRef ref) =>
    ref.read(apiClientProvider) is CachedApiClient &&
    ref.read(authRepositoryProvider).currentUser == null;
