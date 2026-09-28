// ─────────────────────────────────────────────────────────────────────────────
// ST-U6 — EMPTY AND ERROR STATES WITH A WAY FORWARD, AND NO RAW EXCEPTION TEXT.
//
// The audit (Private/research/session-2026-09-23/full-review-r2/
// product-audit-st.md §7.2) measured:
//   · B3/B42/C3/B46 — an empty list rendered zero-figures (home, scan) or a
//     message with nothing to tap (calendar, insights): a first-run dead end.
//   · B4/B48 — home and scan printed `couldNotLoad('$e')`: the raw exception.
//   · D21 — every failure said "Check your connection", including a 401 and
//     our own 5xx.
// DataStateView.empty gained an action slot in packages/design_system (so
// every stamped app has it); the app's list gate uses it and picks the failure
// sentence by what failed.
//
// RED CONTROLS: drop `onEmptyAction` from home's gate and the empty case is
// red; put `couldNotLoad('$e')` back and the failure case finds the exception
// text; make [dataFailedBodyFor] return `dataFailedBody` always and the
// mapping case is red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/api/api_client.dart' show ApiException;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/calendar/calendar_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/shared/async_gate.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

class _Answers implements SubscriptionRepository {
  _Answers(this._fetch);
  final Future<List<Subscription>> Function() _fetch;

  @override
  Future<List<Subscription>> fetchAll() => _fetch();

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

List<Override> _repo(Future<List<Subscription>> Function() fetch) => <Override>[
  subscriptionRepositoryProvider.overrideWithValue(_Answers(fetch)),
];

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

void main() {
  test(
    'D21 · the failure sentence follows what failed, never its text',
    () async {
      final AppLocalizations l10n = await _en();
      expect(
        dataFailedBodyFor(l10n, ApiException(0, 'x')),
        l10n.dataFailedBody,
      );
      expect(
        dataFailedBodyFor(l10n, ApiException(401, 'x')),
        l10n.dataFailedSignedOut,
      );
      expect(
        dataFailedBodyFor(l10n, ApiException(503, 'x')),
        l10n.dataFailedServer,
      );
      expect(
        dataFailedBodyFor(l10n, ApiException(404, 'x')),
        l10n.dataFailedGeneric,
      );
      expect(dataFailedBodyFor(l10n, StateError('x')), l10n.dataFailedGeneric);
      // Four different causes, four different sentences — not one for all.
      expect(<String>{
        l10n.dataFailedBody,
        l10n.dataFailedSignedOut,
        l10n.dataFailedServer,
        l10n.dataFailedGeneric,
      }, hasLength(4));
    },
  );

  testWidgets('B3 · home with nothing on the list offers the first step', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: _repo(() async => const <Subscription>[]),
    );
    final AppLocalizations l10n = await _en();
    expect(find.byKey(DataStateView.emptyKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(DataStateView.emptyActionKey),
        matching: find.text(l10n.addSubscriptionTitle),
      ),
      findsOneWidget,
      reason: 'an empty first run with nothing to tap is a dead end',
    );
  });

  testWidgets('B4 · home failing says what failed, offers Retry, and leaks '
      'no exception text', (WidgetTester tester) async {
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: _repo(
        () async => throw ApiException(503, 'upstream said: 503 at /v1/subs'),
      ),
    );
    final AppLocalizations l10n = await _en();
    expect(find.byKey(DataStateView.failedKey), findsOneWidget);
    expect(find.byKey(DataStateView.retryKey), findsOneWidget);
    expect(find.text(l10n.dataFailedServer), findsOneWidget);
    expect(find.textContaining('ApiException'), findsNothing);
    expect(find.textContaining('upstream said'), findsNothing);
  });

  testWidgets('B42 · the calendar with nothing on it offers the first step', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const CalendarScreen(),
      overrides: _repo(() async => const <Subscription>[]),
    );
    expect(find.byKey(DataStateView.emptyActionKey), findsOneWidget);
  });
}
