// SECTION — the device surfaces (T16): the app lock (XP-03, Free), the glance
// every widget, tray item and app badge shows (XP-04, Pro), the launcher
// shortcuts (XP-05) and the share-in route (IM-11). Each is a package
// (`nikatru_app_lock`, `nikatru_widgets`); this file is the app's adoption of
// them and holds no policy of its own. Re-exported from `../providers.dart`.

import 'dart:async' show unawaited;

import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:intl/intl.dart' show DateFormat;
import 'package:nikatru_app_lock/nikatru_app_lock.dart';
import 'package:nikatru_widgets/nikatru_widgets.dart';

import '../../core/app_config.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/api/api_client.dart';
import '../../data/api/cached_api_client.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import 'persistence.dart';
import 'subscriptions.dart' show apiClientProvider;

/// How the lock signs a person out. Set by the root widget to
/// `signOutAndForgetUser(ref)`: `.signOut()` may be called from
/// `providers/auth.dart` and nowhere else, and this hook is how the lock
/// reaches it without a second call site. Until it is set, the lock still
/// clears itself, which is the half that matters for recovery.
final StateProvider<Future<void> Function()> appLockSignOutProvider =
    StateProvider<Future<void> Function()>((ref) => () async {});

/// The ONE app lock. Loaded on creation, so a cold start with the lock on
/// opens locked.
final Provider<AppLockController> appLockControllerProvider =
    Provider<AppLockController>((ref) {
      final bool biometric = AppLockCapabilities.forPlatform(
        defaultTargetPlatform,
        isWeb: kIsWeb,
      ).biometric;
      final AppLockController controller = AppLockController(
        store: ref.watch(secureStoreProvider),
        signOut: () => ref.read(appLockSignOutProvider)(),
        unsyncedChanges: () => unsyncedAfterSync(ref.read(apiClientProvider)),
        biometric: biometric ? LocalAuthBiometricUnlocker() : null,
      );
      unawaited(controller.load());
      ref.onDispose(controller.dispose);
      return controller;
    });

/// ⏱ 2026-10-02 · review of #1155, finding 6. What the lock's sign-out
/// would lose: it SENDS the signed-in user's queued writes first, then counts
/// what is still unsent (offline, or refused). The lock asks before
/// discarding any of them. In the unconfigured posture there is no queue,
/// and no account to sign out of: nothing is at stake.
Future<int> unsyncedAfterSync(ApiClient api) async {
  if (api is! CachedApiClient) return 0;
  await api.replayPending();
  return (await api.pendingWrites()).length;
}

/// Where this build writes its glance: the AppWidget / WidgetKit store, the
/// PWA badge, or nowhere yet (see `GlanceCapabilities`).
final Provider<GlancePublisher> glancePublisherProvider =
    Provider<GlancePublisher>(
      (ref) => glancePublisherFor(
        defaultTargetPlatform,
        isWeb: kIsWeb,
        androidProvider: 'com.nikatru.${AppConfig.appId}.GlanceWidgetProvider',
        iOSKind: 'GlanceWidget',
        appGroupId: 'group.com.nikatru.${AppConfig.appId}',
      ),
    );

/// The launcher shortcuts, by stable type. `/home?add=1` is read by the root
/// widget as "open the add sheet over home".
List<AppShortcut> sublyShortcuts(AppLocalizations l10n) => <AppShortcut>[
  AppShortcut(
    type: 'add_subscription',
    route: addSheetRoute,
    title: l10n.shortcutAddSubscription,
  ),
  AppShortcut(
    type: 'what_renews_next',
    route: '/calendar',
    title: l10n.shortcutWhatRenewsNext,
  ),
];

/// The route a shortcut uses to mean "the add sheet".
const String addSheetRoute = '/home?add=1';

/// Subly's glance: the next renewal and what leaves the account this month,
/// with the count due in the next seven days as the badge.
///
/// The facts are Subly's (they name a subscription and a month's money); the
/// gate, the wire format and the publishers are the package's.
///
/// ⏱ 2026-10-02 · review of #1155, finding 7: with the APP LOCK on
/// ([appLocked]) the widget shows no figures at all — the home screen is
/// outside the lock.
GlanceSnapshot sublyGlance({
  required List<Subscription> subs,
  required bool locked,
  required DateTime now,
  required AppLocalizations l10n,
  bool appLocked = false,
}) {
  if (appLocked) return GlanceSnapshot.hidden(prompt: l10n.glanceAppLocked);
  final List<Subscription> charging = SubMath.charging(subs)
    ..sort(
      (Subscription a, Subscription b) =>
          a.nextCharge(now).compareTo(b.nextCharge(now)),
    );
  final MoneyFormatter money = MoneyFormatter(l10n.localeName);
  final List<GlanceFact> facts = <GlanceFact>[
    if (charging.isNotEmpty)
      GlanceFact(
        label: l10n.glanceNextRenewal,
        value:
            '${charging.first.name} · '
            '${DateFormat.MMMd(l10n.localeName).format(charging.first.nextCharge(now))}',
      ),
    GlanceFact(
      label: l10n.glanceThisMonth,
      value: money.formatBag(SubMath.chargedInMonth(subs, now.year, now.month)),
    ),
  ];
  return GlanceSnapshot.forPlan(
    isPro: !locked,
    facts: facts,
    proPrompt: l10n.glanceProPrompt,
    badgeCount: SubMath.dueWithinRows(subs, now, 7).length,
  );
}
