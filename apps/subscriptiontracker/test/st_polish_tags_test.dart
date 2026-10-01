// ─────────────────────────────────────────────────────────────────────────────
// T20 · AD-12 — free-text tags: on the sheet, as chips on the detail, and as a
// filter over "All subscriptions".
//
// 🔴 THE RED CONTROL: filtering by "family" shows only the rows tagged family.
// Before this train a row had no tags field and home had no filter, so the
// chip below did not exist and the case failed at its first expectation.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';

import 'support/home_fixture.dart';
import 'support/st_polish_harness.dart';

/// The fixture board with Netflix and Spotify tagged "family" and the gym
/// "Work" — two spellings of case on purpose.
List<Subscription> _tagged() => <Subscription>[
  for (final Subscription s in homeFixture())
    switch (s.id) {
      'nfx' => s.copyWith(tags: <String>['family', 'Streaming']),
      'spt' => s.copyWith(tags: <String>['Family']),
      'gym' => s.copyWith(tags: <String>['Work']),
      _ => s,
    },
];

Finder _inAll(String name) => find.descendant(
  of: find.byKey(HomeScreen.allKey),
  matching: find.text(name),
);

void main() {
  group('the model', () {
    test('normaliseTags trims, drops blanks and non-strings, keeps the first '
        'spelling of a case-insensitive repeat, and caps count and length', () {
      expect(
        Subscription.normaliseTags(<Object?>[
          ' family ',
          '',
          '   ',
          7,
          null,
          'Family',
          'work',
          'x' * 40,
        ]),
        <String>['family', 'work', 'x' * Subscription.maxTagLength],
      );
      expect(
        Subscription.normaliseTags(<String>[
          for (int i = 0; i < 15; i++) 't$i',
        ]),
        hasLength(Subscription.maxTags),
      );
      expect(Subscription.normaliseTags('family'), isEmpty);
      expect(Subscription.normaliseTags(null), isEmpty);
    });

    test(
      'tags round-trip through the wire, and a row without them reads []',
      () {
        final Subscription s = _tagged().first;
        final Subscription back = Subscription.fromJson(s.toJson());
        expect(back.tags, <String>['family', 'Streaming']);
        final Map<String, dynamic> legacy = s.toJson()..remove('tags');
        expect(Subscription.fromJson(legacy).tags, isEmpty);
      },
    );

    test('a PATCH carries tags only when they changed', () {
      final Subscription s = _tagged().first;
      expect(
        Subscription.fromJson(s.toJson()).changesFrom(s),
        isEmpty,
        reason: 'two decodes of one list are two objects; that is no change',
      );
      expect(
        s.copyWith(tags: <String>['work']).changesFrom(s),
        <String, dynamic>{
          'tags': <String>['work'],
        },
      );
      expect(s.copyWith(tags: <String>[]).changesFrom(s), <String, dynamic>{
        'tags': <String>[],
      });
    });

    test(
      'SubMath: every tag once, case ignored; the filter matches any case',
      () {
        final List<Subscription> rows = _tagged();
        expect(SubMath.tagsOf(rows), <String>['family', 'Streaming', 'Work']);
        expect(
          SubMath.taggedWith(rows, 'FAMILY').map((Subscription s) => s.id),
          <String>['nfx', 'spt'],
        );
        expect(SubMath.taggedWith(rows, null), same(rows));
      },
    );
  });

  testWidgets('🔴 filtering by "family" shows only the rows tagged family', (
    WidgetTester tester,
  ) async {
    await pumpPolish(tester, const HomeScreen(), rows: _tagged());
    final Finder chip = find.byKey(HomeScreen.tagChipKeyOf('family'));
    expect(chip, findsOneWidget, reason: 'one chip per tag, case ignored');
    expect(_inAll('City Gym'), findsOneWidget);

    await tester.tap(chip);
    await settle(tester);
    expect(_inAll('Netflix'), findsOneWidget);
    expect(_inAll('Spotify'), findsOneWidget, reason: '"Family" is family');
    for (final String other in <String>['City Gym', 'iCloud+', 'Adobe CC']) {
      expect(
        _inAll(other),
        findsNothing,
        reason: '$other is not tagged family',
      );
    }

    await tester.tap(chip);
    await settle(tester);
    expect(_inAll('City Gym'), findsOneWidget, reason: 'the chip turns it off');
  });

  testWidgets('no tags anywhere: no filter is drawn', (
    WidgetTester tester,
  ) async {
    await pumpPolish(tester, const HomeScreen());
    expect(find.byKey(HomeScreen.tagFilterKey), findsNothing);
  });

  testWidgets('the detail shows a row\'s tags as chips', (
    WidgetTester tester,
  ) async {
    await pumpPolish(
      tester,
      const SubscriptionDetailScreen(id: 'nfx'),
      rows: _tagged(),
    );
    expect(find.byKey(const Key('detail-tags')), findsOneWidget);
    expect(find.widgetWithText(Chip, 'family'), findsOneWidget);
    expect(find.widgetWithText(Chip, 'Streaming'), findsOneWidget);
  });

  testWidgets('the edit sheet prefills the tags and saves what is typed', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = await pumpPolish(
      tester,
      Builder(
        builder: (BuildContext context) => TextButton(
          onPressed: () =>
              showAddSubscriptionSheet(context, initial: _tagged().first),
          child: const Text('open'),
        ),
      ),
      rows: _tagged(),
      size: const Size(400, 1400),
    );
    await tester.tap(find.text('open'));
    await settle(tester);
    final Finder field = find.widgetWithText(TextField, 'family, Streaming');
    expect(field, findsOneWidget);
    await tester.enterText(field, 'family,  work , Family');
    await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
    await settle(tester);
    await tester.tap(find.byKey(E2EKeys.addSubmit));
    await settle(tester);
    expect(
      listOf(c).firstWhere((Subscription s) => s.id == 'nfx').tags,
      <String>['family', 'work'],
    );
  });
}
