import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';

/// Home shell for {{{display_name}}}, built on the design-system [AppScaffold]
/// (adaptive NavigationBar -> Rail -> Drawer) and brand tokens.
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  int _index = 0;

  // NOT static const: labels are localised, so they need a BuildContext.
  // [pipeline C-12] A const list cannot read l10n, and an unlocalised nav bar is
  // the most visible untranslated surface in the app.
  List<AppDestination> _destinations(AppLocalizations l10n) => <AppDestination>[
    AppDestination(
      icon: Icons.home_outlined,
      selectedIcon: Icons.home,
      label: l10n.navHome,
    ),
    AppDestination(
      icon: Icons.explore_outlined,
      selectedIcon: Icons.explore,
      label: l10n.navExplore,
    ),
    AppDestination(
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
      label: l10n.navSettings,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final AppThemeX tokens = Theme.of(context).extension<AppThemeX>()!;
    final AppLocalizations l10n = AppLocalizations.of(context);
    // 🔴 [pipeline 5]M-5 — THE GATE, AND ITS FIRST REAL CONSUMER.
    //
    // `PaywallGate` shipped in the design system and was referenced by exactly
    // one widget test and one comment: a fail-closed seam with no proven open
    // path, which is the [pipeline C-6] shape in its purest form. This line is
    // the open path. `paywallLockedProvider` resolves from the SERVER's
    // entitlement read (via the cache, with the M-8 staleness ceiling applied),
    // so what unlocks this surface is a row somebody paid for and nothing else.
    //
    // A stamped app with `paywall.enabled: false` — which is the default —
    // locks nothing, so being born with the gate costs a fresh app nothing.
    final bool locked = ref.watch(paywallLockedProvider);
    return AppScaffold(
      title: const Text(AppConfig.appName),
      destinations: _destinations(l10n),
      selectedIndex: _index,
      // 🔴 THE SETTINGS DESTINATION NOW NAVIGATES, AND IT DID NOT BEFORE.
      // `onDestinationSelected` only ever set `_index`, and the body does not
      // switch on it — so the Settings tab was decorative: every screen the
      // settings register row claims (profile, appearance, language, reminders,
      // legal, sign-out, delete account) sat behind a `/settings` route that NO
      // control in the chassis navigated to. `assert-screen-set.mjs` passed
      // throughout, because its `reachable` check asks whether the ROUTE exists.
      //
      // Found 2026-08-01 while deriving the ROSCA step counts for [pipeline
      // 5]M-9: "cancelling is one tap from Settings" is worth nothing if nothing
      // is a tap from Settings. `assert-purchase-path.mjs` now requires
      // `/settings` to be reachable from `/` through the router graph, so this
      // cannot silently regress.
      onDestinationSelected: (int i) {
        if (i == 2) {
          context.go('/settings');
          return;
        }
        setState(() => _index = i);
      },
      // The EXPLORE tab is the chassis's premium surface. Gating tab 1 rather
      // than the whole app is deliberate: a paywall a user meets before they
      // have seen anything is a wall, and it is also the shape that makes the
      // activation number meaningless.
      body: Column(
        children: <Widget>[
          // [pipeline T-8] The OTHER half of the reminder promise. Above the
          // paywall gate on purpose: a nudge the user paid to see is not a nudge.
          const CatchUpNudgeBanner(),
          Expanded(
            child: PaywallGate(
              locked: _index == 1 && locked,
              onUpgrade: () => context.go('/paywall'),
              title: l10n.paywallHeadline,
              message: l10n.paywallGateMessage,
              upgradeLabel: l10n.paywallUpgrade,
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        gradient: tokens.brandGradient,
                        borderRadius: BorderRadius.circular(AppRadius.lg),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Text(
                      l10n.welcomeTo(AppConfig.appName),
                      style: AppText.title,
                    ),
                    const SizedBox(height: AppSpacing.xs),
                    Text(l10n.homeTagline, style: AppText.muted),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The in-app catch-up nudge — [pipeline T-8].
///
/// 🔴 WHY IT EXISTS AND WHY IT IS PERMANENT. Three of the six platforms cannot
/// schedule a repeating local notification, and **no version of the pinned
/// plugin family changes that**: its own limitations text records that Windows
/// throws on repeating notifications, Linux has no scheduler API, and browsers
/// support neither scheduled nor repeating ones. Web is the only live platform
/// today. The settings screen is already honest about it — it refuses to offer a
/// switch it cannot honour — and this is the half that actually delivers
/// something: the next time the app is opened after the reminder's moment has
/// passed, say so, once.
///
/// It is the humblest mechanism that works, on purpose: no background work, no
/// polling, no wake-up the OS refuses to grant, and nothing that needs a server.
///
/// ⚠️ IT RESPECTS THE OPT-OUT. An in-app banner is still a notification, so
/// [core.CatchUpNudge] refuses when reminders are off — routing around the
/// switch is precisely what the switch exists to prevent.
class CatchUpNudgeBanner extends ConsumerWidget {
  const CatchUpNudgeBanner({this.clock, super.key});

  /// Injectable ONLY so the due/not-due boundary is reachable from a test: a
  /// test process cannot choose what `DateTime.now()` reports, so a widget test
  /// on the real clock would assert nothing for twenty hours of every day and
  /// then start failing at 20:00. Same reasoning as `DeviceUtcOffset` in
  /// `packages/notifications`, and the same reason the decision itself is pure.
  final DateTime Function()? clock;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(
      defaultTargetPlatform,
      isWeb: kIsWeb,
    );
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DateTime now = (clock ?? DateTime.now)();
    final core.CatchUpNudgeVerdict verdict = const core.CatchUpNudge().decide(
      now: now,
      lastShownAt: ref.watch(catchUpNudgeProvider),
      reminderHour: AppConfig.reminderHour,
      reminderMinute: AppConfig.reminderMinute,
      remindersEnabled: ref.watch(remindersEnabledProvider),
      platformCanSchedule: caps.canSchedule,
    );
    if (verdict != core.CatchUpNudgeVerdict.show) {
      return const SizedBox.shrink();
    }
    final ThemeData theme = Theme.of(context);
    return MaterialBanner(
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      leading: const Icon(Icons.notifications_active_outlined),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(l10n.catchUpTitle, style: theme.textTheme.titleSmall),
          Text(l10n.catchUpBody, style: theme.textTheme.bodySmall),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () =>
              ref.read(catchUpNudgeProvider.notifier).markShown(now),
          child: Text(l10n.catchUpDismiss),
        ),
      ],
    );
  }
}
