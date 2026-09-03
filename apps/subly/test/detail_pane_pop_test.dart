import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/router.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/subscriptions_controller.dart';

import 'support/user_state_fakes.dart';
import 'support/width_harness.dart';

/// 🔴 THE TWO-PANE DETAIL IS A WIDGET, NOT A ROUTE — SO ITS BACK ARROW HAD
/// NOTHING TO POP.
///
/// Reproduces GlitchTip `subly` SUBLY-9 (level FATAL, 4 events, 2026-08-21
/// 14:11:25–14:12:04Z, release `subly@1.0.220+350bd7f`):
/// `GoError: There is nothing to pop`, with
/// `flutter_error_details.context = "thrown while handling a gesture"`,
/// `library: "gesture"`, browser hash `#/home`, `screen_width_pixels: 1920`,
/// `orientation: "landscape"`.
///
/// Every one of those facts is this shape and no other:
///
///   · `home_screen.dart` renders `SubscriptionDetailScreen` INLINE as
///     `TwoPane.detail` once the body can split (>= `AppBreakpoints.expanded`).
///     No route is pushed — `_subCard`'s tap runs `setState(() => _selectedId =
///     s.id)` in the two-pane arm and `context.push('/sub/:id')` ONLY in the
///     single-column arm. So the router's location stays `/home`, which is why
///     the reported hash is `#/home` and not `#/sub/...`.
///   · `/home` is the first branch of the `StatefulShellRoute` and the app's
///     landing route, so its stack holds exactly one match. go_router's `pop()`
///     THROWS there rather than returning false.
///   · 1920 landscape is the three-column regime (`width_home_test.dart`'s
///     table), i.e. one of the regimes where the detail pane exists at all. A
///     phone can never reach this — it pushes the route and the pop is real,
///     which is why every existing detail test stayed green.
///   · The throw is synchronous inside `GestureDetector.onTap`, which is
///     exactly the `library: "gesture"` the event carries.
///   · Four events in 39 s is a user tapping a back arrow that does nothing and
///     trying again.
///
/// ⚠️ THE SURFACE PIN IS THE TEST. At flutter_test's default 800x600 the body
/// is single-column, `TwoPane` does not build `detail` at all, the row tap
/// pushes `/sub/:id` and the back arrow pops a route that genuinely exists —
/// green against the unfixed code, proving nothing. Never drop [kWide] here.
///
/// ⚠️ AND THE ROW IS FOUND BY ITS TITLE, NOT BY `find.byType(RowCard).first`.
/// Measured 2026-08-24: home renders 10 `RowCard`s at this width and the FIRST
/// one is the Insights link in the hero (`home_screen.dart:738`), whose tap
/// runs `context.go('/insights')`. A `.first` here navigated away from home and
/// the case went red for the wrong reason.
class _SignedInAuth extends core.AuthRepository {
  final StreamController<core.AuthUser?> _changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'u1', email: 'a@b.test', emailVerified: true);

  @override
  Stream<core.AuthUser?> authStateChanges() => _changes.stream;

  @override
  Future<void> signOut() async {}
  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async => currentUser!;
  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async => currentUser!;
  @override
  Future<void> deleteAccount() async {}
  @override
  Future<String?> currentAccessToken() async => 'token';
  @override
  Future<core.AuthSession?> currentSession() async => null;
  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {}
  @override
  Future<void> signInWithApple() async {}
  @override
  Future<core.AuthUser> updateProfile({required String displayName}) async =>
      currentUser!;
}

/// The router's onboarding gate DECLINES TO DECIDE while the seen-flag is still
/// hydrating (null), so a router test that never answers it stalls before its
/// first real frame. Same shim as `sign_out_destination_test.dart`'s.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

/// Mounts the REAL router at `/home` on a surface wide enough to split.
Future<ProviderContainer> _pumpHomeAtWide(WidgetTester tester) async {
  await setSurface(tester, kWide);
  return _pumpRouter(tester);
}

/// Mounts the REAL router on WHATEVER SURFACE THE CALLER ALREADY PINNED.
///
/// ⚠️ IT DOES NOT PIN ONE ITSELF, and that is the whole reason it is separate
/// from [_pumpHomeAtWide]: the route-mode cases below must run at [kPhone], and
/// a helper that pinned [kWide] internally would silently put them back in the
/// two-pane regime — where `onClose` is non-null and the `canPop` arms they
/// exist to falsify are never reached.
Future<ProviderContainer> _pumpRouter(WidgetTester tester) async {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(_SignedInAuth()),
      keyValueStoreProvider.overrideWith((_) async => MemStore()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      secureStoreProvider.overrideWithValue(MemSecureStore()),
      notificationServiceProvider.overrideWithValue(FakeNotifications()),
      sublyNotificationServiceProvider.overrideWithValue(SilentNotifications()),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: container.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  container.read(routerProvider).go('/home');
  await tester.pumpAndSettle();
  return container;
}

/// The router's current location, read the way the app's own history reads it.
String _location(ProviderContainer c) =>
    c.read(routerProvider).routeInformationProvider.value.uri.path;

/// Selects a subscription in the two-pane list.
///
/// Asserts the split happened and that selecting did NOT navigate — both are
/// preconditions without which the pop under test is a different pop.
Future<ProviderContainer> _selectFirstSubscription(WidgetTester tester) async {
  final ProviderContainer container = await _pumpHomeAtWide(tester);

  expect(
    find.byType(TwoPanePlaceholder),
    findsOneWidget,
    reason:
        'the detail column is not being built, so this surface is not in the '
        'two-pane regime and this case cannot go red',
  );

  final List<Subscription> subs = container
      .read(subscriptionsControllerProvider)
      .requireValue;
  expect(subs, isNotEmpty, reason: 'no seed rows to select');

  // ⚠️ SCOPED THROUGH THE LIST PANE, AND `.first` WITHIN IT. Measured
  // 2026-08-24: the seed's first subscription name matches FOUR `RowCard`s at
  // this width — two inside `home-list-pane` (the all-subscriptions row and
  // the same brand again in the unused-plans group) and two more outside it in
  // the hero — and `tap()` refuses an ambiguous finder. Any of the list rows
  // reaches the same `_subCard` tap handler, which is the thing under test, so
  // `.first` is a choice of row and not a choice of behaviour.
  await tester.tap(
    find
        .descendant(
          of: find.byKey(const Key('home-list-pane')),
          matching: find.widgetWithText(RowCard, subs.first.name),
        )
        .first,
  );
  await tester.pumpAndSettle();

  expect(
    find.byType(SubscriptionDetailScreen),
    findsOneWidget,
    reason: 'the detail pane did not render beside the list',
  );

  // 🔴 THE LOCATION MUST STILL BE `/home`. This is the fact the whole defect
  // rests on, and it is asserted rather than assumed: if a future edit makes
  // the row tap push `/sub/:id` even in two-pane mode, the pops below become
  // legitimate and these tests would go green for a reason that has nothing to
  // do with the guard they are pinning.
  expect(
    _location(container),
    '/home',
    reason: 'selecting a row navigated, so the inline-pane defect is not armed',
  );

  return container;
}

void main() {
  testWidgets(
    '🔴 THE TWO-PANE DETAIL BACK ARROW DOES NOT THROW "nothing to pop"',
    (WidgetTester tester) async {
      final ProviderContainer container = await _selectFirstSubscription(
        tester,
      );

      await tester.tap(find.byIcon(Icons.arrow_back));
      await tester.pumpAndSettle();

      // Against the unfixed code this is `GoError: There is nothing to pop`.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the inline detail pane popped a router stack that holds only /home '
            '- GlitchTip SUBLY-9',
      );

      // And the guard must CLOSE the pane, not merely swallow the throw. A back
      // arrow that no longer crashes but also does nothing is the same dead
      // control the user tapped four times.
      expect(
        find.byType(TwoPanePlaceholder),
        findsOneWidget,
        reason: 'back left the detail pane open, so the control is still dead',
      );
      expect(_location(container), '/home');
    },
  );

  testWidgets('🔴 THE TWO-PANE "Edit plan" BUTTON DOES NOT THROW EITHER', (
    WidgetTester tester,
  ) async {
    final ProviderContainer container = await _selectFirstSubscription(tester);

    final AppLocalizations l10n = AppLocalizations.of(
      tester.element(find.byType(SubscriptionDetailScreen)),
    );

    await tester.tap(find.text(l10n.editPlan));
    await tester.pumpAndSettle();

    expect(
      tester.takeException(),
      isNull,
      reason:
          'the inline detail pane popped a router stack that holds only /home '
          '- same GoError as the back arrow, second call site',
    );
    expect(_location(container), '/home');
  });

  // ── THE ROUTE MODE, BOTH ARMS ───────────────────────────────────────────────
  // `_dismiss`'s `canPop()` is TWO conditions and each gets its own case, so
  // neither arm can rot into an assertion that cannot fail. Deleting the guard
  // reddens the deep-link case; hard-coding `context.go('/home')` in place of
  // the guard reddens the pushed case (it would leave `/home` reachable but
  // destroy the back-to-calendar path and the stack depth asserted below).

  testWidgets('🔴 A DEEP-LINKED /sub/:id BACK ARROW LANDS ON HOME, NOT A THROW', (
    WidgetTester tester,
  ) async {
    // Phone width on purpose: no two-pane, so this is the ROUTE mounting and
    // `onClose` is null — the arm the pane cases above can never reach.
    await setSurface(tester, kPhone);
    final ProviderContainer container = await _pumpRouter(tester);

    final List<Subscription> subs = container
        .read(subscriptionsControllerProvider)
        .requireValue;

    // What a page RELOAD at `https://subly.nikatru.com/#/sub/<id>` produces: the
    // location is restored with nothing under it. `go`, never `push`.
    container.read(routerProvider).go('/sub/${subs.first.id}');
    await tester.pumpAndSettle();
    expect(find.byType(SubscriptionDetailScreen), findsOneWidget);
    expect(_location(container), '/sub/${subs.first.id}');

    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();

    expect(
      tester.takeException(),
      isNull,
      reason:
          'a reloaded detail URL has a one-entry stack and pop throws on it',
    );
    expect(
      _location(container),
      '/home',
      reason: 'the fallback must go somewhere, not merely not-throw',
    );
  });

  testWidgets('🔴 A PUSHED /sub/:id BACK ARROW STILL REALLY POPS', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kPhone);
    final ProviderContainer container = await _pumpRouter(tester);

    final List<Subscription> subs = container
        .read(subscriptionsControllerProvider)
        .requireValue;

    container.read(routerProvider).go('/calendar');
    await tester.pumpAndSettle();
    container.read(routerProvider).push('/sub/${subs.first.id}');
    await tester.pumpAndSettle();
    expect(find.byType(SubscriptionDetailScreen), findsOneWidget);

    await tester.tap(find.byIcon(Icons.arrow_back));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    // 🔴 `/calendar`, NOT `/home`. This is what stops the fix from being
    // "always go home": that would swallow the crash and silently break the
    // real back path off every pushed detail screen, and no other case here
    // could tell the difference.
    expect(
      _location(container),
      '/calendar',
      reason: 'the guard replaced a working pop instead of guarding it',
    );
  });

  // ── THE NOTIFICATIONS CLOSE BUTTON, BOTH ARMS ───────────────────────────────
  // Same defect class, at the call site nothing has reported yet. `/notifications`
  // is only ever `push`ed in-app, which is exactly why the bare pop looked total.

  testWidgets(
    '🔴 A DEEP-LINKED /notifications CLOSE LANDS ON HOME, NOT A THROW',
    (WidgetTester tester) async {
      await setSurface(tester, kPhone);
      final ProviderContainer container = await _pumpRouter(tester);

      container.read(routerProvider).go('/notifications');
      await tester.pumpAndSettle();
      expect(_location(container), '/notifications');

      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();

      expect(
        tester.takeException(),
        isNull,
        reason:
            'a reloaded #/notifications has a one-entry stack and pop throws on it',
      );
      expect(_location(container), '/home');
    },
  );

  testWidgets('🔴 A PUSHED /notifications CLOSE STILL REALLY POPS', (
    WidgetTester tester,
  ) async {
    await setSurface(tester, kPhone);
    final ProviderContainer container = await _pumpRouter(tester);

    container.read(routerProvider).go('/calendar');
    await tester.pumpAndSettle();
    container.read(routerProvider).push('/notifications');
    await tester.pumpAndSettle();

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(
      _location(container),
      '/calendar',
      reason: 'the guard replaced a working pop instead of guarding it',
    );
  });

  // ── THE POST-CANCEL-SHEET DISMISS, IN THE PANE ──────────────────────
  // 🔴 THE THIRD CALL SITE, AND THE ONE THE TWO PANE CASES ABOVE CANNOT REACH.
  // `subscription_detail_screen.dart:457` fires from an `async` callback AFTER
  // `showCancelSheet`'s future completes, behind an `if (context.mounted)` — a
  // path no case in this file entered, because none of them had ever opened the
  // cancel sheet. Measured 2026-08-24: reverting that one line to a bare
  // `context.pop()` left all six cases above GREEN, so the guard on it was
  // pinned by nothing at all. With this case present the same revert throws
  // `GoError: There is nothing to pop` out of
  // `subscription_detail_screen.dart:457:39`.
  //
  // ⚠️ IT IS DRIVEN THROUGH THE REAL SHEET, ALL THE WAY TO 'Done', AND THAT
  // IS THE POINT. `showCancelSheet` is `useRootNavigator: true`, so the sheet's
  // own `Navigator.of(context).pop()` pops THE SHEET and nothing else; the
  // detail element survives the await, `context.mounted` is therefore true, and
  // what runs next is the guard under test. A case that only proved the sheet
  // opens would never reach :457 at all.
  //
  // ⚠️ AND EVERY FINDER IS SCOPED. 'Cancel plan' and 'Done' are ordinary
  // words, and the sheet is a ROOT-navigator overlay above a live home screen —
  // both panes are still in the tree underneath it. Scoping the opener to
  // [SubscriptionDetailScreen] and the two sheet taps to `BottomSheet` is what
  // keeps this case tapping the controls it names.

  testWidgets(
    '🔴 THE TWO-PANE POST-CANCEL-SHEET DISMISS DOES NOT THROW EITHER',
    (WidgetTester tester) async {
      final ProviderContainer container = await _selectFirstSubscription(
        tester,
      );

      final AppLocalizations l10n = AppLocalizations.of(
        tester.element(find.byType(SubscriptionDetailScreen)),
      );

      await tester.tap(
        find.descendant(
          of: find.byType(SubscriptionDetailScreen),
          matching: find.text(l10n.cancelPlanButton),
        ),
      );
      await tester.pumpAndSettle();

      // A PRECONDITION, NOT DECORATION: with no sheet on screen the two taps
      // below would miss and this case would pass having driven nothing.
      expect(
        find.byType(BottomSheet),
        findsOneWidget,
        reason: 'the cancel sheet never opened, so :457 is never reached',
      );

      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text(l10n.confirmCancel),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text(l10n.done),
        ),
        findsOneWidget,
        reason:
            'the sheet did not reach step 1, so "Done" - the tap that lets '
            'showCancelSheet complete and hands control back to :457 - does '
            'not exist yet',
      );

      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text(l10n.done),
        ),
      );
      await tester.pumpAndSettle();

      // Against a reverted :457 this is `GoError: There is nothing to pop`,
      // thrown out of the async callback rather than out of a gesture — same
      // defect, one frame later.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the post-cancel dismiss popped a router stack that holds only '
            '/home - GlitchTip SUBLY-9, third call site',
      );

      // ...and it must CLOSE the pane, for the same reason the back-arrow case
      // asserts it: a dismiss that stops throwing but leaves the detail of a
      // subscription the user just cancelled sitting on screen is not fixed.
      expect(
        find.byType(BottomSheet),
        findsNothing,
        reason: 'the sheet itself is still up, so nothing was dismissed',
      );
      expect(
        find.byType(TwoPanePlaceholder),
        findsOneWidget,
        reason: 'the cancelled subscription is still filling the detail pane',
      );
      expect(_location(container), '/home');
    },
  );
}
