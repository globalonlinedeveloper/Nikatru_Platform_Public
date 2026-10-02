// ST-T9 (train st-add-catalogue) — what the sheet writes shows up where the
// user reads it. Red controls:
//   AD-06 · a row with a `rail` names it, as neutral subtitle text, on home
//   AD-08 · a trial row reads "Free trial until {date}, then {price}" once the
//           price after the trial is known — and the plain trial line without it
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart'
    show detailSubtitle;
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/home_fixture.dart';
import 'support/width_harness.dart';

class _Rows implements SubscriptionRepository {
  _Rows(this.rows);
  final List<Subscription> rows;

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  Future<BudgetInfo> budget() async => throw StateError('not under test');

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Subscription _netflix(Map<String, dynamic> extra) =>
    Subscription.fromJson(<String, dynamic>{
      'id': 'sub-1',
      'name': 'Netflix',
      'category': 'Streaming',
      'price_minor': 64900,
      'currency': 'INR',
      'cycle_every': 1,
      'cycle_unit': 'month',
      'next_renewal': '2030-03-14',
      ...extra,
    });

void main() {
  late AppLocalizations en;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  testWidgets('AD-06 · home names how a row is paid', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: <Override>[
        subscriptionRepositoryProvider.overrideWithValue(
          _Rows(<Subscription>[
            _netflix(<String, dynamic>{'rail': 'upi_autopay'}),
          ]),
        ),
        nowProvider.overrideWithValue(() => kHomeFixtureNow),
      ],
    );
    expect(find.textContaining(en.railUpiAutopay), findsWidgets);
  });

  testWidgets('AD-06 · a row with no rail says nothing about it', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      const HomeScreen(),
      overrides: <Override>[
        subscriptionRepositoryProvider.overrideWithValue(
          _Rows(<Subscription>[_netflix(const <String, dynamic>{})]),
        ),
        nowProvider.overrideWithValue(() => kHomeFixtureNow),
      ],
    );
    expect(find.textContaining(en.railUpiAutopay), findsNothing);
  });

  test('AD-08 · a trial row says what it turns into, once that is known', () {
    final Subscription known = _netflix(<String, dynamic>{
      'status': 'trialing',
      'trial_ends_on': '2030-03-14',
      'price_after_trial_minor': 64900,
    });
    expect(known.priceAfterTrial, const Money(64900, 'INR'));
    expect(known.priceAfterTrialSupported, isTrue);
    final String line = detailSubtitle(en, known);
    expect(line, contains('Free trial until Mar 14, 2030, then'));
    expect(line, contains('649'));

    final Subscription unknown = _netflix(<String, dynamic>{
      'status': 'trialing',
      'trial_ends_on': '2030-03-14',
    });
    expect(unknown.priceAfterTrialSupported, isFalse);
    expect(
      detailSubtitle(en, unknown),
      contains(en.statusTrialing('Mar 14, 2030')),
    );
    expect(detailSubtitle(en, unknown), isNot(contains('then')));
    // Behind the capability: a row from a server without the column never
    // sends it, so an old API cannot be handed a key it would drop.
    expect(unknown.toJson().containsKey('price_after_trial_minor'), isFalse);
    expect(known.toJson()['price_after_trial_minor'], 64900);
  });
}
