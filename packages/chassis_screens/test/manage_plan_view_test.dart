import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `ManagePlanView` — the ROSCA cancel surface.
///
/// 🏗️ The widget half. That the cancel really reaches
/// `PurchaseRail.requestCancellation()` and that the entitlement is re-read
/// afterwards are wiring halves and stay in the brick suite.
void main() {
  Widget view({
    bool isPro = true,
    bool busy = false,
    String? outcomeMessage,
    VoidCallback? onBack,
    VoidCallback? onRestore,
    VoidCallback? onCancel,
    StatusKind? outcomeKind,
    String? planDetail,
    VoidCallback? onUpgrade,
    bool loading = false,
    VoidCallback? onReload,
    bool offline = false,
    VoidCallback? onReconnect,
    PlanSourceView? source,
    DateTime? periodEnds,
    VoidCallback? onManageInStore,
  }) => ManagePlanView(
    title: 'Manage plan',
    isPro: isPro,
    planStatusLabel: isPro ? 'Your plan is active' : 'No active plan',
    restoreHint: 'Sign in on a new device and your plan follows you',
    cancelLabel: 'Cancel plan',
    busy: busy,
    outcomeMessage: outcomeMessage,
    onBack: onBack ?? () {},
    onRestore: onRestore ?? () {},
    onCancel: onCancel ?? () {},
    outcomeKind: outcomeKind,
    planDetail: planDetail,
    upgradeLabel: onUpgrade == null ? null : 'See plans',
    onUpgrade: onUpgrade,
    loading: loading,
    onReload: onReload,
    offline: offline,
    onReconnect: onReconnect,
    source: source,
    periodEnds: periodEnds,
    onManageInStore: onManageInStore,
  );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // ROSCA is a rule about how hard the control is to FIND, and layout is part of
  // how hard something is to find: unconstrained, the cancel row's label sat a
  // full window away from the icon that identifies it on a desktop.
  group('property: manage-plan-page-is-capped at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byType(ListView)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kPhone), kPhone.width);
    });

    // ⏱ ST-D9: the cap is `reading` (720), the one the shipping app already
    // chose — so the tablet is now capped too, not only the desktop.
    testWidgets('kTablet — the reading cap engages', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kTablet), AppBreakpoints.reading);
    });

    testWidgets('kDesktop — the reading cap holds', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kDesktop), AppBreakpoints.reading);
    });
  });

  // ── (2) THE CANCEL ENTRY IS ONE TAP FROM HERE, AND ONLY WHEN THERE IS A
  //        PLAN TO CANCEL ────────────────────────────────────────────────────
  group('property: manage-plan-controls', () {
    testWidgets('an active plan offers BOTH restore and cancel, one tap each', (
      WidgetTester tester,
    ) async {
      int cancelled = 0;
      int restored = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(onCancel: () => cancelled++, onRestore: () => restored++),
      );
      await tester.tap(find.byKey(ManagePlanView.cancelTile));
      await tester.tap(find.byKey(ManagePlanView.restoreTile));
      expect(cancelled, 1);
      expect(restored, 1);
    });

    testWidgets('no active plan hides the cancel row — there is nothing to '
        'cancel, and offering it is an offer the app cannot honour', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(isPro: false));
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });

    testWidgets('a request in flight disables EVERY control, so a second tap '
        'cannot start a second cancellation', (WidgetTester tester) async {
      int cancelled = 0;
      // `settle: false` — the busy bar is a `LinearProgressIndicator` and it
      // never stops animating, so `pumpAndSettle` would time out on the very
      // state this case is about.
      await pumpChassis(
        tester,
        kPhone,
        view(busy: true, onCancel: () => cancelled++),
        settle: false,
      );
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      await tester.tap(find.byKey(ManagePlanView.cancelTile));
      expect(cancelled, 0);
    });

    testWidgets('the outcome sentence is RENDERED, not swallowed', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(outcomeMessage: 'We have recorded your request'),
      );
      expect(find.text('We have recorded your request'), findsOneWidget);
    });
  });

  // ── (2b) THE ST-D9 STATES ─────────────────────────────────────────────────
  //
  // Loading, failed, offline, free (the "empty" state: no plan) and active
  // (populated). In EVERY one of them Restore is still there: a user who cannot
  // see their plan is exactly the user who needs it.
  group('ST-D9 states', () {
    // Text scaling is platform-owned: the user's 200% must reflow, never clip.
    testWidgets('at 200% text on a phone nothing overflows', (
      WidgetTester tester,
    ) async {
      await tester.binding.setSurfaceSize(kPhone);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: ChassisLocalizations.localizationsDelegates,
          supportedLocales: ChassisLocalizations.supportedLocales,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: view(
            planDetail: 'Plan and save are on',
            outcomeMessage: 'Recorded',
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    ChassisLocalizations l10nOf(WidgetTester tester) =>
        ChassisLocalizations.of(tester.element(find.byType(ManagePlanView)));

    testWidgets('loading: a placeholder where the plan goes; Restore stays', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(isPro: false, loading: true));
      expect(find.byType(SkeletonList), findsOneWidget);
      expect(find.byKey(ManagePlanView.statusCard), findsNothing);
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });

    testWidgets('failed: says so, retries, and Restore stays', (
      WidgetTester tester,
    ) async {
      int reloaded = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(isPro: false, onReload: () => reloaded++),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.managePlanLoadFailed), findsOneWidget);
      expect(find.byKey(ManagePlanView.statusCard), findsNothing);
      await tester.tap(find.text(l10n.retry));
      expect(reloaded, 1);
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });

    testWidgets('offline: a warning strip above the plan', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(offline: true));
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.offlineMessage), findsOneWidget);
      expect(find.byKey(ManagePlanView.statusCard), findsOneWidget);
      expect(find.byKey(ManagePlanView.cancelTile), findsOneWidget);
    });

    testWidgets(
      'free (empty): the way to a plan, when the adapter offers one',
      (WidgetTester tester) async {
        int upgraded = 0;
        await pumpChassis(
          tester,
          kPhone,
          view(isPro: false, onUpgrade: () => upgraded++),
        );
        expect(find.text('No active plan'), findsOneWidget);
        await tester.tap(find.byKey(ManagePlanView.upgradeTile));
        expect(upgraded, 1);
        expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
      },
    );

    testWidgets('free, no upgrade passed (a build that sells nothing): none', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(isPro: false));
      expect(find.byKey(ManagePlanView.upgradeTile), findsNothing);
    });

    testWidgets('active (populated): status, detail, and never an upgrade', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(planDetail: 'Plan and save are on', onUpgrade: () {}),
      );
      expect(find.text('Your plan is active'), findsOneWidget);
      expect(find.text('Plan and save are on'), findsOneWidget);
      expect(find.byKey(ManagePlanView.upgradeTile), findsNothing);
    });

    testWidgets('the outcome takes its tone from outcomeKind', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(outcomeMessage: 'Cancelled', outcomeKind: StatusKind.positive),
      );
      final DecisionStrip strip = tester.widget(
        find.byKey(ManagePlanView.outcomeStrip),
      );
      expect(strip.kind, StatusKind.positive);
    });

    testWidgets('an ungraded outcome is a warning, never good news', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(outcomeMessage: 'Recorded'));
      final DecisionStrip strip = tester.widget(
        find.byKey(ManagePlanView.outcomeStrip),
      );
      expect(strip.kind, StatusKind.warn);
    });
  });

  // ── (3) THE WAY OUT ───────────────────────────────────────────────────────
  //
  // The screen is reached with `context.go`, which REPLACES the stack, so
  // `AppBar` never built a back control of its own. On the one screen whose job
  // is "cancelling must be no harder than subscribing", that left no way out.
  testWidgets('the explicit back control is present and calls onBack', (
    WidgetTester tester,
  ) async {
    bool back = false;
    await pumpChassis(tester, kPhone, view(onBack: () => back = true));
    await tester.tap(find.byType(BackButton));
    expect(back, isTrue);
  });

  // ── ⏱ 2026-10-01 · MO-05, AB-M4-03-client: WHERE THE USER PAID ───────────
  group('manage plan follows where the plan was bought', () {
    ChassisLocalizations l10nOf(WidgetTester tester) =>
        ChassisLocalizations.of(tester.element(find.byType(ManagePlanView)));

    // RED CONTROL: a Play-sourced plan (on any build — the source is the
    // entitlement's, the view has no build channel) shows "Manage in Google
    // Play" and NO Cancel, so nothing can post /v1/plan/cancel for it.
    testWidgets('Google Play: Manage in Google Play, and no Cancel', (
      WidgetTester tester,
    ) async {
      int cancels = 0;
      int opened = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(
          source: PlanSourceView.googlePlay,
          periodEnds: DateTime(2026, 11, 1),
          onCancel: () => cancels++,
          onManageInStore: () => opened++,
        ),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.manageInGooglePlay), findsOneWidget);
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
      expect(find.text('Cancel plan'), findsNothing);
      expect(find.text(l10n.planBoughtInGooglePlay), findsOneWidget);
      expect(find.text(l10n.planPeriodEnds(DateTime(2026, 11, 1))), findsOneWidget);
      await tester.tap(find.byKey(ManagePlanView.manageInStoreTile));
      await tester.pump();
      expect(opened, 1);
      expect(cancels, 0);
    });

    testWidgets('App Store: Manage in the App Store, and no Cancel', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(source: PlanSourceView.appStore, onManageInStore: () {}),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.manageInAppStore), findsOneWidget);
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
    });

    testWidgets('a store plan with no page to open still shows no Cancel', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(source: PlanSourceView.googlePlay));
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
      expect(find.byKey(ManagePlanView.manageInStoreTile), findsNothing);
    });

    testWidgets('web: our own Cancel, and no store row', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(source: PlanSourceView.web, onManageInStore: () {}),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.byKey(ManagePlanView.cancelTile), findsOneWidget);
      expect(find.byKey(ManagePlanView.manageInStoreTile), findsNothing);
      expect(find.text(l10n.planBoughtOnWeb), findsOneWidget);
    });

    testWidgets('free: no source line, no period line', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(isPro: false, source: PlanSourceView.web, periodEnds: DateTime(2026)),
      );
      final ChassisLocalizations l10n = l10nOf(tester);
      expect(find.text(l10n.planBoughtOnWeb), findsNothing);
      expect(find.textContaining('2026'), findsNothing);
    });
  });
}
