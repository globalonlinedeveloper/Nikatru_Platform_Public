import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/subscriptions/subscription_repository.dart';
import 'package:subly/features/add/add_subscription_sheet.dart';
import 'package:subly/features/cancel/cancel_sheet.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:subly/state/providers.dart';

/// THE SHEETS HAD NO FAILURE PATH AT ALL.
///
/// `_save()` and `_confirm()` awaited a call that goes through the repository to
/// the network with no try/catch. One offline moment therefore threw out of an
/// unawaited future: the error surfaced nowhere, the busy flag was never
/// cleared, and the button sat disabled on 'Adding…' / 'Cancelling…' forever.
/// The user's only escape was to dismiss the sheet and start again.
///
/// Every existing sheet test drives the SUCCESS path, which is why nothing was
/// red. These drive the failure, and assert the three things the user needs: the
/// error does not escape, the control comes back, and they are told.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Reads fine, writes fail — the shape of being offline behind a cache.
class _WriteFailsRepository implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[];

  @override
  Future<Subscription> add(Subscription draft) async =>
      throw const SocketFailure();

  @override
  Future<void> cancel(String id) async => throw const SocketFailure();

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

class SocketFailure implements Exception {
  const SocketFailure();
  @override
  String toString() => 'SocketException: Failed host lookup';
}

class _SilentNotifications extends NotificationService {
  _SilentNotifications() : super.forTesting();
  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

Widget _app(void Function(BuildContext) open) {
  return ProviderScope(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
      subscriptionRepositoryProvider.overrideWithValue(_WriteFailsRepository()),
      sublyNotificationServiceProvider.overrideWithValue(
        _SilentNotifications(),
      ),
    ],
    // 🔴 THE DELEGATES ARE NOT DECORATION — WITHOUT THEM THIS HOST THROWS.
    // `l10n.yaml` sets `nullable-getter: false`, so the generated
    // `AppLocalizations.of(context)` ends in a null assertion: the first line of
    // either sheet's `build` that reads a string dies with a
    // `Null check operator used on a null value` the instant it mounts under a
    // bare `MaterialApp`. That failure looks nothing like a missing delegate —
    // it points at the sheet — which is why it is called out here rather than
    // left to be rediscovered.
    //
    // Nothing else in this file changed for l10n. Every assertion below still
    // reads the same English literal it did before the sheets moved to the arb,
    // and that is the point: the arb VALUES were minted from the shipped copy,
    // so this file is the review gate on that claim. A value that drifted would
    // show up here as a red line naming the string, not as a silent repaint.
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => open(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

/// [_app] with the platform text scale forced to [scale].
///
/// The scaler is applied in `MaterialApp.builder`, which wraps the NAVIGATOR —
/// so it reaches the modal route the sheet mounts into. Wrapping `home` instead
/// would scale the open button and nothing else: `showModalBottomSheet` builds
/// its route above `home`, not inside it.
Widget _appScaled(void Function(BuildContext) open, double scale) {
  return ProviderScope(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
      subscriptionRepositoryProvider.overrideWithValue(_WriteFailsRepository()),
      sublyNotificationServiceProvider.overrideWithValue(
        _SilentNotifications(),
      ),
    ],
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => open(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

Subscription _sub() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: 15,
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 12),
);

/// The two windows the height cases below are pinned to, named so a failure says
/// WHICH viewport was being measured rather than a bare pair of numbers.
/// [kLandscapePhone] is a phone on its side — the shortest viewport this app
/// ships to that is not a fold.
const Size kLandscapePhone = Size(740, 360);
const Size kPortraitPhone = Size(375, 812);

/// A short portrait phone. Separate from [kPortraitPhone] because the two fail
/// for DIFFERENT reasons and each pins a different half of the fix — see the
/// block comment above the height cases.
const Size kShortPhone = Size(375, 667);

/// Fails, naming the control and the window, when [finder]'s rect leaves the
/// window.
///
/// 🔴 THIS IS THE ASSERTION, NOT `takeException()`. A `ClipRect` around the
/// sheet would silence the overflow exception and leave the buttons exactly as
/// unreachable as they were; "the user can see and tap it" is the property, and
/// only a rect can state it.
void _expectOnScreen(
  WidgetTester tester,
  Finder finder,
  Size window,
  String what,
) {
  final Rect r = tester.getRect(finder);
  expect(
    r.left >= 0 &&
        r.top >= 0 &&
        r.right <= window.width &&
        r.bottom <= window.height,
    isTrue,
    reason:
        '$what laid out at $r, which leaves the $window window — '
        'it is on screen for nobody',
  );
}

void main() {
  testWidgets('add sheet: a failed save re-arms the button and says so', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app((BuildContext c) => showAddSubscriptionSheet(c)),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
    await tester.pumpAndSettle();

    final Finder submit = find.byKey(E2EKeys.addSubmit);
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    // `pump()` with no duration runs NO timers, and the SnackBar needs them.
    await tester.pumpAndSettle();

    // 1. The error did not escape as an unhandled async error.
    expect(tester.takeException(), isNull);
    // 2. The user is told.
    expect(find.byType(SnackBar), findsOneWidget);
    expect(
      find.textContaining('Could not add that subscription'),
      findsOneWidget,
    );
    // 3. The button is usable again and the typed draft survived, so a retry is
    //    one tap rather than a re-entry.
    expect(find.text('Adding…'), findsNothing);
    // Scoped to the button: the sheet's own title reads 'Add subscription' too.
    expect(
      find.descendant(of: submit, matching: find.text('Add subscription')),
      findsOneWidget,
    );
    // Scoped to the field: 'Hulu' is also one of the POPULAR tiles.
    expect(
      find.descendant(
        of: find.byKey(E2EKeys.addName),
        matching: find.text('Hulu'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('cancel sheet: a failed cancel never claims success', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app((BuildContext c) => showCancelSheet(c, _sub())),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Confirm cancel'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.textContaining('Could not cancel just now'), findsOneWidget);
    // 🔴 The confirmation step congratulates the user on savings. Showing it
    // after a failed cancel would be a lie the app tells about the user's money.
    expect(find.text('Cancelled'), findsNothing);
    expect(find.text('Cancelling…'), findsNothing);
    expect(find.text('Confirm cancel'), findsOneWidget);
  });

  // ── THE CONFIRMATION SURVIVES A SHORT VIEWPORT ────────────────────────────
  //
  // 🔴 THE AUDIT'S DIAGNOSIS WAS WRONG AND THE BUG WAS REAL. It suspected the
  // step-0 `Row` of two `Expanded` buttons of clipping at large text scale. Two
  // `Expanded`s always fit the width they are handed — measured at 1.3× and at
  // 2.0×, the row laid out at its full 596 px both times and threw nothing.
  // What overflowed was the sheet's OUTER `Column`, and the axis that ran out
  // was HEIGHT: 137 px on a 740×360 phone at 1.3× against
  // `showModalBottomSheet`'s default cap of 9/16 of the window (202.5 px). The
  // row was pushed to y 416.5–466.5 — below the bottom of a 360 px screen — so
  // 'Keep it' and 'Confirm cancel' were both unreachable, and the only way out
  // of a destructive confirmation was to dismiss it.
  //
  // Fixed in `showCancelSheet`, NOT by re-laying-out the row: wrapping or
  // stacking those buttons makes the sheet TALLER, which is the wrong direction.
  // The fix is two parts, and the three cases below are one-per-part plus a
  // control. Both parts were mutation-tested against this file on 2026-08-21:
  //   · drop `isScrollControlled: true` → the LANDSCAPE case goes red on its
  //     HEIGHT line, and ONLY there. The 9/16 cap comes back, the scroll view
  //     obediently squeezes the copy into the ~75 px that leaves, and both
  //     buttons stay on screen — so the two rect assertions accept it. The
  //     sheet would be legible-in-principle and unreadable in fact.
  //   · drop the `Flexible` + `SingleChildScrollView` → the SHORT-PHONE case
  //     goes red (overflowed by 80 px), because at 2.0× the content is taller
  //     than the whole 667 px window, not merely taller than 9/16 of it.
  // Neither mutation is caught by the other's case. That is why there are two.

  testWidgets(
    '🔴 landscape 740×360 at 1.3× text: both confirmation buttons are on screen',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(kLandscapePhone);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        _appScaled((BuildContext c) => showCancelSheet(c, _sub()), 1.3),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      _expectOnScreen(
        tester,
        find.widgetWithText(OutlinedButton, 'Keep it'),
        kLandscapePhone,
        "'Keep it'",
      );
      _expectOnScreen(
        tester,
        find.widgetWithText(FilledButton, 'Confirm cancel'),
        kLandscapePhone,
        "'Confirm cancel'",
      );
      // 🔴 AND THE 9/16 CAP IS GONE, not merely worked around.
      // `isScrollControlled: false` caps the sheet at
      // `constraints.maxHeight * 9/16` — `bottom_sheet.dart:32`, applied at
      // `:621-623` — which is 202.5 px in this window, measured. The scroll
      // view satisfies that cap by squeezing the copy, so every assertion
      // above still passes with the flag deleted. This is the one that does
      // not: the sheet is as tall as its content, so the reason the user is
      // being asked to confirm is fully on screen and nothing scrolls at all.
      expect(
        tester.getSize(find.byType(BottomSheet)).height,
        greaterThan(kLandscapePhone.height * 9 / 16),
      );
    },
  );

  testWidgets(
    '🔴 short phone 375×667 at 2.0× text: the confirmation is still reachable',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(kShortPhone);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        _appScaled((BuildContext c) => showCancelSheet(c, _sub()), 2.0),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      // No `ensureVisible` — that is the point. At this scale the COPY is
      // taller than the window and scrolls; the button row is outside the
      // viewport and is still sitting on screen with nothing scrolled.
      _expectOnScreen(
        tester,
        find.widgetWithText(FilledButton, 'Confirm cancel'),
        kShortPhone,
        "'Confirm cancel'",
      );
    },
  );

  testWidgets('portrait 375×812 at 1.3× text: the sheet still shrink-wraps', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(kPortraitPhone);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      _appScaled((BuildContext c) => showCancelSheet(c, _sub()), 1.3),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    // The CONTROL case: this window never overflowed, and it is here to catch
    // the cost of the fix rather than the bug. `isScrollControlled: true`
    // REMOVES the 9/16 cap, so what it risks is a two-button confirmation that
    // grew into a full-height sheet on an ordinary phone. It does not, because
    // `SingleChildScrollView` sizes itself to its child within the incoming
    // constraints rather than filling them — measured on both sides of this
    // change on an 800×600 host, the sheet is 289 px tall either way and the
    // 'Confirm cancel' rect is identical to the pixel.
    expect(tester.takeException(), isNull);
    expect(
      tester.getSize(find.byType(BottomSheet)).height,
      lessThan(kPortraitPhone.height),
    );
  });
}
