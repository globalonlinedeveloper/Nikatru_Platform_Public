// ─────────────────────────────────────────────────────────────────────────────
// P2.6b — THE HOME MERGE.  ⚠️ DRAFT: pre-fabricated, NOT yet compiled.
//
// Two files became one:
//
//   · the STAMPED home (chassis shell) contributed the `AppScaffold` adaptive
//     navigation, the `PaywallGate` Explore tab — the [pipeline C-6] OPEN PATH,
//     the only proven consumer of `paywallLockedProvider` — the
//     `CatchUpNudgeBanner` ([pipeline T-8]), and l10n.
//   · the LIVE home (the product) contributed everything a user came for: the
//     hero card, upcoming renewals, the all-subscriptions list, the unused-subs
//     warning, and the four navigation entry points that hang off them.
//
// VARIANT B (the shape that shipped — see the class doc below): `AppShell`
// kept scaffold ownership, so the stamped Explore placeholder DIED here (its
// gate moved to the router's Insights branch) and the only `welcomeTo` left in
// this file is the dashboard header's signed-out fallback — which is exactly
// what keeps `test/smoke_test.dart`'s `findsOneWidget` on 'Welcome to' honest.
//
// 🔴 THE ORDERING RULE THIS FILE ENCODES, because it is the one that bites:
// `overrides.md` §10-11 records that home and settings must merge AS A PAIR —
// `_showUnused` below reads `prefs['unused']`, which only the settings toggles
// write. Merging one screen without the other severs a coupling nothing tests.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';

import '../../core/app_config.dart';
import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

/// Home — branch 0's BODY, VARIANT B ([ADR 037]; decision recorded in session
/// notes 2026-08-08): `AppShell` owns the adaptive [AppScaffold] (docked in
/// P2.6a via the `compactNavigationBar` seam), so this screen carries NO
/// scaffold of its own — nesting one inside the shell's body would render two
/// navigation surfaces at every width, wrong in a way no assertion covers.
/// The stamped 3-destination shell shape this draft originally carried lives
/// on in the brick; Subly's 5-tab product nav won the collision.
///
/// The `PaywallGate` ([pipeline 5]M-5's open path) did NOT die with the shell
/// ownership move — it wraps the INSIGHTS branch in `lib/core/router.dart`
/// (Subly's premium-surface default until Phase 4 decides finally), so
/// `paywallLockedProvider` keeps its one real consumer.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return const Column(
      children: <Widget>[
        // [pipeline T-8] Above everything: a nudge the user paid to see is not
        // a nudge. MOUNTED EXACTLY ONCE IN THE APP — chassis_properties_test
        // pumps the whole SublyApp and asserts findsOneWidget.
        CatchUpNudgeBanner(),
        Expanded(child: _HomeDashboard()),
      ],
    );
  }
}

/// Subly's product dashboard — the live `home_screen.dart` body, docked as the
/// Home destination. Everything below this line is the live file's own code and
/// its own comments; the merge changed four things and each is marked `🔀`.
class _HomeDashboard extends ConsumerWidget {
  const _HomeDashboard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final core.AuthUser? user = ref.watch(authRepositoryProvider).currentUser;
    // The `unused` setting was declared in settings_controller.dart and read
    // NOWHERE, so the switch in Settings did nothing. It now gates the surface it
    // describes: "Flag subscriptions you don't use".
    final bool showUnused =
        ref.watch(settingsControllerProvider).prefs['unused'] ?? true;
    final DateTime now = DateTime.now();

    // 🔀 MERGE CHANGE 1 of 4 — THE HEADER MOVED OUT OF `.when()`.
    //
    // The live file wrapped the WHOLE body in `subscriptionsControllerProvider
    // .when(...)`, so while the first fetch was in flight the screen was a bare
    // `CircularProgressIndicator` — no greeting, no account name, no way to
    // reach notifications or settings. That was survivable when the shell drew
    // the navigation; inside `AppScaffold` the header is also the only route to
    // /notifications, and a spinner that hides it is a dead end.
    //
    // It is ALSO what makes `test/smoke_test.dart` deterministic: that test
    // pumps `HomeScreen` in a bare `ProviderScope` with no overrides, so the
    // subscriptions fetch is still LOADING on the frame it asserts. With the
    // header inside `.when()` the tree would hold a spinner and
    // `find.textContaining('Welcome to')` would find nothing — a red that names
    // the copy and says nothing about the cause.
    //
    // Nothing in the header depends on the subscription list, so nothing is
    // being shown early or optimistically. Only the parts that need the data
    // wait for it.
    return ContentPane(
      // 🔀 MERGE CHANGE 2 of 4 — THE WIDTH DECISION THIS SCREEN NEVER HAD.
      //
      // Same defect and same fix as PR #210's three screens. `AppScaffold` caps
      // the body at `kMaxBodyWidth` only in its EXTRA-LARGE class (>=1600), so
      // between 1200 and 1599 the hero card and every `RowCard` grew to the full
      // window — a 1550 px row with a glyph at one edge and a price at the
      // other. Nothing overflowed, nothing clipped, no assertion existed to fail.
      // `ContentPane`'s default IS `kMaxBodyWidth`, which is the same ceiling
      // `AppScaffold` applies above 1600, so this makes the two agree instead of
      // agreeing only past 1600 — the identical argument the stamped settings
      // screen records at its own `ContentPane`.
      //
      // ⬜ NOT YET POLICED. `test/responsive_width_test.dart` covers onboarding,
      // settings and manage-plan; it has NO HomeScreen group. The block that
      // would close that is written out in `width-behaviour.md` §4 — until it
      // lands, this wrapper can be deleted with every test still green.
      child: ListView(
        // 🔀 MERGE CHANGE 3 of 4 — PADDING RE-BASED FOR THE CHASSIS SHELL.
        // Live was `fromLTRB(18, 58, 18, 108)`. Both odd numbers were paying for
        // the old shell: 58 cleared a status bar under a `Scaffold` with no app
        // bar, and 108 cleared `AppShell`'s floating pill bar plus its FAB.
        // `AppScaffold._compact()` wraps the body in a `SafeArea` and puts the
        // navigation in `bottomNavigationBar`, so both insets are now paid twice
        // — 58 px of dead space under the notch and 108 px under the last row.
        // 18 is `AppSpacing.gutterCompact`, the chassis's own page gutter.
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.xl,
        ),
        children: <Widget>[
          _header(context, user),
          const SizedBox(height: 18),
          ...ref
              .watch(subscriptionsControllerProvider)
              .when(
                loading: () => const <Widget>[
                  Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ],
                error: (Object e, _) => <Widget>[
                  Padding(
                    padding: const EdgeInsets.only(top: 48),
                    child: Center(
                      child: Text('Could not load: $e', style: AppText.muted),
                    ),
                  ),
                ],
                data: (List<Subscription> subs) =>
                    _dashboard(context, currency, subs, now, showUnused),
              ),
        ],
      ),
    );
  }

  /// Greeting, account name, notifications and the avatar shortcut. Independent
  /// of the subscription list — see MERGE CHANGE 1.
  Widget _header(BuildContext context, core.AuthUser? user) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                _greeting(DateTime.now()),
                style: AppText.muted.copyWith(fontSize: 12),
              ),
              // 🔀 MERGE CHANGE 4 of 4 — THE SIGNED-OUT FALLBACK IS NOW THE
              // LOCALISED WELCOME.
              //
              // Live rendered the bare literal `'Welcome'`. The stamped home's
              // whole visible copy was `l10n.welcomeTo(appName)`, and dropping it
              // would delete the only translated string on this surface AND turn
              // `smoke_test.dart:29` red. Using it HERE keeps the key earning its
              // keep on the destination the test actually pumps, and "Welcome to
              // Subly" over "Good morning" reads better than a bare "Welcome".
              //
              // ⚠️ `AppConfig.appName` DIFFERS BETWEEN THE TWO CONFIGS THIS
              // MERGE IS SANDWICHED BETWEEN — live says `Subly`, the stamp says
              // `Subly — Subscription Tracker`. This line renders whichever
              // P2.5's de-duplication keeps. See MANIFEST.md · FINDING 2.
              Text(
                user?.displayName ?? l10n.welcomeTo(AppConfig.appName),
                style: AppText.title.copyWith(fontSize: 24),
              ),
            ],
          ),
        ),
        // [13]T-9's home entry point. `push`, not `go`: notifications is a
        // detail over the shell, and the user must come back to where they were.
        //
        // ⬜ `dot: true` IS UNCONDITIONAL — it is a badge that is always on, so
        // it carries no information. Pre-existing (it is live behaviour, carried
        // verbatim) and deliberately NOT fixed here: an unread count needs a
        // source, and inventing one inside a merge increment is how a merge
        // stops being reviewable. Named in MANIFEST.md · OPEN QUESTION 4.
        _circleButton(
          icon: Icons.notifications_none_rounded,
          semanticLabel: AppLocalizations.of(context).notifications,
          dot: true,
          onTap: () => context.push('/notifications'),
        ),
        const SizedBox(width: 9),
        // KEPT ALONGSIDE the Settings nav destination, deliberately. They are
        // not redundant: the destination is the discoverable route (labelled, in
        // the rail and the drawer at every width above 600), the avatar is the
        // conventional one (top-right, where a user looks for their account) and
        // it is the only one that shows WHICH account is signed in. Removing
        // either leaves a real user group without the affordance it looks for.
        GestureDetector(
          onTap: () => context.go('/settings'),
          child: Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              gradient: AppColors.brandGradient,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(
              user?.initial ?? 'A',
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Everything that needs the subscription list. Returns a list so the header
  /// above can stay outside the async boundary.
  List<Widget> _dashboard(
    BuildContext context,
    Currency currency,
    List<Subscription> subs,
    DateTime now,
    bool showUnused,
  ) {
    final double total = SubMath.totalMonthly(subs);
    final double dueSoon = SubMath.dueWithin(subs, now, 7);
    final List<Subscription> unused = SubMath.unused(subs);
    final double savings = SubMath.savings(subs);
    final List<Subscription> upcoming = SubMath.upcoming(subs, now);
    final List<Subscription> all = SubMath.byMonthlyDesc(subs);

    return <Widget>[
      _heroCard(
        currency,
        total,
        subs.length,
        dueSoon,
        SubMath.dueWithin(subs, now, 30),
      ),
      const SizedBox(height: 14),
      if (showUnused && unused.isNotEmpty)
        RowCard(
          accentBar: AppColors.warn,
          onTap: () => context.go('/insights'),
          leading: Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color.fromRGBO(245, 158, 11, 0.16),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Text(
              '!',
              style: TextStyle(
                fontFamily: 'Space Grotesk',
                fontWeight: FontWeight.w700,
                fontSize: 19,
                color: AppColors.warn,
              ),
            ),
          ),
          title: '${unused.length} marked unused',
          subtitle: Text(
            'Cancel to save ${currency.fmt(savings)}/mo',
            style: AppText.muted.copyWith(fontSize: 12),
          ),
          trailing: const Icon(
            Icons.arrow_forward,
            color: AppColors.muted,
            size: 20,
          ),
        ),
      SectionHeader(
        'Upcoming renewals',
        trailing: GestureDetector(
          onTap: () => context.go('/calendar'),
          child: Text(
            'Calendar →',
            style: AppText.body.copyWith(
              color: AppColors.accent,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ),
      ),
      ...upcoming.map(
        (Subscription s) => Padding(
          padding: const EdgeInsets.only(bottom: 9),
          child: _subTile(context, currency, s, now, showDue: true),
        ),
      ),
      SectionHeader(
        'All subscriptions',
        trailing: Text(
          '${subs.length}',
          style: AppText.muted.copyWith(fontSize: 12),
        ),
      ),
      ...all.map(
        (Subscription s) => Padding(
          padding: const EdgeInsets.only(bottom: 9),
          child: _subTile(context, currency, s, now, showDue: false),
        ),
      ),
    ];
  }

  Widget _heroCard(
    Currency currency,
    double total,
    int count,
    double dueSoon,
    double due30,
  ) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: AppColors.heroGradient,
        borderRadius: BorderRadius.circular(26),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color.fromRGBO(42, 36, 86, 0.8),
            blurRadius: 50,
            offset: Offset(0, 24),
            spreadRadius: -24,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'MONTHLY SPEND',
            style: AppText.label.copyWith(
              color: const Color.fromRGBO(255, 255, 255, 0.7),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            currency.fmt(total),
            style: AppText.fig.copyWith(
              fontSize: 44,
              color: Colors.white,
              height: 1,
            ),
          ),
          const SizedBox(height: 12),
          // Wrap, not Row (P2.6b route-walk finding): two intrinsic-width
          // pills overflow a narrow card where a Wrap folds to a second line —
          // same fix as the PoweredByNikatru legal links, same reason.
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: <Widget>[
              Pill(
                '$count active',
                bg: const Color.fromRGBO(255, 255, 255, 0.13),
                fg: Colors.white,
              ),
              Pill(
                '${currency.fmt0(total * 12)} / yr',
                bg: const Color.fromRGBO(255, 255, 255, 0.13),
                fg: Colors.white,
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: <Widget>[
              _statBox('DUE IN 7 DAYS', currency.fmt(dueSoon), Colors.white),
              const SizedBox(width: 12),
              // Was 'VS LAST MONTH', computed as `total - 174`. 174 was the last
              // element of the fabricated six-month trend array in insights, so this
              // compared the user's real total against a number someone typed. It
              // also hardcoded a '+', so it reported an increase every single month.
              // The app stores no history, so no month-over-month figure can be
              // honest. Replaced with a 30-day horizon, which is derived.
              _statBox('DUE IN 30 DAYS', currency.fmt(due30), Colors.white),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statBox(String label, String value, Color valueColor) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color.fromRGBO(255, 255, 255, 0.08),
          borderRadius: BorderRadius.circular(15),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              label,
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontWeight: FontWeight.w600,
                fontSize: 10,
                color: Color.fromRGBO(255, 255, 255, 0.7),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: AppText.fig.copyWith(fontSize: 20, color: valueColor),
            ),
          ],
        ),
      ),
    );
  }

  Widget _subTile(
    BuildContext context,
    Currency currency,
    Subscription s,
    DateTime now, {
    required bool showDue,
  }) {
    final DueInfo due = DueInfo.of(s, now);
    final Color dot = s.unused
        ? AppColors.warn
        : (s.usedPct > 60 ? AppColors.positive : const Color(0xFFC9C9D2));
    final String usage = s.unused
        ? 'Rarely used'
        : (s.usedPct > 60 ? 'Active' : 'Occasional');

    return RowCard(
      onTap: () => context.push('/sub/${s.id}'),
      leading: GlyphTile(glyph: s.glyph, statusColor: showDue ? null : dot),
      title: s.name,
      subtitle: showDue
          ? Text(
              due.label,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontWeight: FontWeight.w700,
                fontSize: 11,
                color: due.color,
              ),
            )
          : Text(
              '${s.category} · $usage',
              style: AppText.muted.copyWith(fontSize: 12),
            ),
      trailing: showDue
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(
                  currency.fmt(s.monthlyPrice),
                  style: AppText.fig.copyWith(fontSize: 16),
                ),
                Text(
                  s.cycle == BillingCycle.yearly ? 'per year' : 'per month',
                  style: AppText.muted.copyWith(fontSize: 10),
                ),
              ],
            )
          : Text(
              currency.fmt(s.monthlyPrice),
              style: AppText.fig.copyWith(fontSize: 16),
            ),
    );
  }

  Widget _circleButton({
    required IconData icon,
    required String semanticLabel,
    bool dot = false,
    VoidCallback? onTap,
  }) {
    // 48px, not 44: the chassis floor for an icon-only tap target, asserted
    // route-wide by chassis_properties_test. The Semantics wrapper is what a
    // screen reader announces — an icon-only control without one is unusable.
    return Semantics(
      button: true,
      label: semanticLabel,
      child: GestureDetector(
        onTap: onTap,
        child: Stack(
          children: <Widget>[
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.line),
              ),
              child: Icon(icon, color: AppColors.ink, size: 20),
            ),
            if (dot)
              Positioned(
                top: 9,
                right: 10,
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: AppColors.warn,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.surface, width: 2),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  String _greeting(DateTime now) {
    if (now.hour < 12) return 'Good morning';
    if (now.hour < 18) return 'Good afternoon';
    return 'Good evening';
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
///
/// ⚠️ P2.5 DEPENDENCY: `AppConfig.reminderHour` / `reminderMinute` exist ONLY in
/// the STAMPED `lib/core/app_config.dart`. The live `lib/core/config/
/// app_config.dart` has neither, so the de-duplication must keep the stamp's
/// constants or this widget stops compiling. See MANIFEST.md · FINDING 3.
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
