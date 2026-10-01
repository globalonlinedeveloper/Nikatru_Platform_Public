// ST-T9 (train st-add-catalogue) — the add sheet opens on a pick over the
// catalogue, a pick prefills the form, and the form carries how it is paid,
// its reminders and its notice. Each test is a red control for one patch:
//   AD-03 pick  · typing "hot" finds JioHotstar; "Add by hand" is the blank form
//   AD-03 fill  · Netflix in INR fills the rupee price, monthly, its category
//                 and cancel page — and a currency the pack has no price in
//                 stays blank (never a converted guess)
//   AD-06 rail  · the PATCH carries `rail`; the row's subtitle names it
//   AD-07       · a new plan saved with 7 and 1 days carries both, + notice
//   AD-08       · "Then" appears only behind `price_after_trial_minor`
//   AD-09       · at 1280 the form is a dialog; at 375 it is a sheet
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/catalogue_fixture.dart';
import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

Subscription _row({bool afterTrial = false}) =>
    Subscription.fromJson(<String, dynamic>{
      'id': 'sub-1',
      'name': 'Netflix',
      'category': 'Streaming',
      'price_minor': 64900,
      'currency': 'INR',
      'cycle_every': 1,
      'cycle_unit': 'month',
      'next_renewal': '2030-03-14',
      if (afterTrial) 'price_after_trial_minor': null,
    });

class _Repo implements SubscriptionRepository {
  _Repo({this.afterTrial = false});
  final bool afterTrial;
  final List<Subscription> added = <Subscription>[];
  final List<(String, Map<String, dynamic>)> updates =
      <(String, Map<String, dynamic>)>[];
  late final List<Subscription> rows = <Subscription>[
    _row(afterTrial: afterTrial),
  ];

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  Future<Subscription> add(Subscription draft) async {
    added.add(draft);
    return draft;
  }

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    updates.add((id, changes));
    return rows.firstWhere((Subscription s) => s.id == id).patched(changes);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

Future<ProviderContainer> _open(
  WidgetTester tester, {
  required _Repo repo,
  Subscription? editing,
  Size size = kPhone,
  String currency = 'INR',
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      subscriptionRepositoryProvider.overrideWithValue(repo),
      ...catalogueOverrides(),
    ],
  );
  addTearDown(c.dispose);
  await c.read(settingsControllerProvider.notifier).setCurrency(currency);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed),
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => Center(
              child: TextButton(
                onPressed: () =>
                    showAddSubscriptionSheet(context, initial: editing),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await c.read(subscriptionsControllerProvider.future);
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return c;
}

String _text(WidgetTester tester, Key key) =>
    tester.widget<TextField>(find.byKey(key)).controller!.text;

Future<void> _pickNetflix(WidgetTester tester) async {
  await tester.enterText(find.byKey(E2EKeys.addSearch), 'net');
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(E2EKeys.addPickRow('netflix')));
  await tester.pumpAndSettle();
}

Future<void> _save(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
  await tester.pumpAndSettle();
  // A focused field re-shows its caret after the scroll settles; on the
  // longer ST-T9 form that can scroll Save back below the fold, so look again.
  await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
  await tester.pump();
  await tester.tap(find.byKey(E2EKeys.addSubmit));
  await tester.pumpAndSettle();
}

void main() {
  group('AD-03 · the pick step', () {
    testWidgets('an add opens on the search; typing "hot" finds JioHotstar', (
      WidgetTester tester,
    ) async {
      await _open(tester, repo: _Repo());
      expect(find.byKey(E2EKeys.addSearch), findsOneWidget);
      expect(find.byKey(E2EKeys.addName), findsNothing);
      // INR → India first: the POPULAR grid opens on the India services,
      // ahead of the everywhere ones, and never offers the US-only one.
      expect(find.text('POPULAR'), findsOneWidget);
      Offset at(String id) =>
          tester.getTopLeft(find.byKey(E2EKeys.addPickRow(id)));
      bool before(Offset a, Offset b) =>
          a.dy < b.dy || (a.dy == b.dy && a.dx < b.dx);
      expect(before(at('jiohotstar'), at('netflix')), isTrue);
      expect(before(at('cultpass'), at('netflix')), isTrue);
      expect(find.byKey(E2EKeys.addPickRow('hulu')), findsNothing);

      await tester.enterText(find.byKey(E2EKeys.addSearch), 'hot');
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.addPickRow('jiohotstar')), findsOneWidget);
      expect(find.byKey(E2EKeys.addPickRow('netflix')), findsNothing);
    });

    testWidgets('"Add by hand" opens the blank form', (
      WidgetTester tester,
    ) async {
      await _open(tester, repo: _Repo());
      await tester.tap(find.byKey(E2EKeys.addByHand));
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.addSearch), findsNothing);
      expect(_text(tester, E2EKeys.addName), isEmpty);
      expect(_text(tester, E2EKeys.addPrice), isEmpty);
    });

    testWidgets('an EDIT opens on the form, never the pick step', (
      WidgetTester tester,
    ) async {
      final _Repo repo = _Repo();
      await _open(tester, repo: repo, editing: repo.rows.single);
      expect(find.byKey(E2EKeys.addSearch), findsNothing);
      expect(_text(tester, E2EKeys.addName), 'Netflix');
    });
  });

  group('AD-03 · prefill', () {
    testWidgets(
      'picking Netflix in INR fills ₹649, monthly, its category, the cancel '
      'page, notice and service_id',
      (WidgetTester tester) async {
        final _Repo repo = _Repo();
        await _open(tester, repo: repo);
        await _pickNetflix(tester);
        expect(_text(tester, E2EKeys.addName), 'Netflix');
        expect(_text(tester, E2EKeys.addPrice), '649.00');
        expect(
          find.descendant(
            of: find.byKey(E2EKeys.addCategory),
            matching: find.text('Streaming'),
          ),
          findsOneWidget,
        );
        expect(find.text('https://example.com/netflix/cancel'), findsOneWidget);
        await _save(tester);
        final Subscription s = repo.added.single;
        expect(s.price, const Money(64900, 'INR'));
        expect(s.cycle, Cadence.monthly);
        expect(s.category, 'Streaming');
        expect(s.cancelUrl, 'https://example.com/netflix/cancel');
        expect(s.noticeDays, 1);
        expect(s.toJson()['service_id'], 'netflix');
      },
    );

    testWidgets('a currency the pack has no price in leaves the price blank', (
      WidgetTester tester,
    ) async {
      await _open(tester, repo: _Repo(), currency: 'EUR');
      await _pickNetflix(tester);
      expect(_text(tester, E2EKeys.addName), 'Netflix');
      expect(_text(tester, E2EKeys.addPrice), isEmpty);
    });
  });

  group('AD-06 · paid with', () {
    testWidgets('the PATCH carries rail and rail_holder', (
      WidgetTester tester,
    ) async {
      final _Repo repo = _Repo();
      await _open(tester, repo: repo, editing: repo.rows.single);
      await tester.ensureVisible(find.byKey(E2EKeys.addRail));
      await tester.tap(find.byKey(E2EKeys.addRail));
      await tester.pumpAndSettle();
      await tester.tap(find.text('UPI Autopay').last);
      await tester.pumpAndSettle();
      final Finder holder = find.widgetWithText(
        TextField,
        'Card or account label (optional)',
      );
      await tester.enterText(holder, 'Mum UPI');
      await tester.pumpAndSettle();
      await _save(tester);
      final Map<String, dynamic> body = repo.updates.single.$2;
      expect(body['rail'], 'upi_autopay');
      expect(body['rail_holder'], 'Mum UPI');
      expect(body.containsKey('name'), isFalse, reason: 'only what changed');
    });

    test('the row carries the rail it was sent and reads it back', () {
      final Subscription s = _row().patched(<String, dynamic>{
        'rail': 'card_emandate',
      });
      expect(s.rail, PaymentRail.cardEmandate);
      expect(Subscription.fromJson(s.toJson()).rail, PaymentRail.cardEmandate);
    });
  });

  group('AD-07 · reminders and notice on the sheet', () {
    testWidgets('a new plan saved with 7 and 1 days carries both, and notice', (
      WidgetTester tester,
    ) async {
      final _Repo repo = _Repo();
      await _open(tester, repo: repo);
      await _pickNetflix(tester);
      for (final int d in <int>[7, 1]) {
        await tester.ensureVisible(find.byKey(E2EKeys.addLead(d)));
        await tester.tap(find.byKey(E2EKeys.addLead(d)));
        await tester.pumpAndSettle();
      }
      await _save(tester);
      final Subscription s = repo.added.single;
      expect(s.reminderDays, <int>[7, 1]);
      expect(s.toJson()['reminder_days'], <int>[7, 1]);
      expect(s.toJson()['notice_days'], 1);
    });
  });

  group('AD-08 · price after trial, behind the API capability', () {
    testWidgets('no "Then" field while the API lacks the column', (
      WidgetTester tester,
    ) async {
      final _Repo repo = _Repo();
      await _open(tester, repo: repo, editing: repo.rows.single);
      await tester.ensureVisible(find.byType(Switch));
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.addThenPrice), findsNothing);
    });

    testWidgets('with the column, a trial sends price_after_trial_minor', (
      WidgetTester tester,
    ) async {
      final _Repo repo = _Repo(afterTrial: true);
      await _open(tester, repo: repo, editing: repo.rows.single);
      await tester.ensureVisible(find.byType(Switch));
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(E2EKeys.addThenPrice), '799');
      await tester.pumpAndSettle();
      await _save(tester);
      expect(repo.updates.single.$2['price_after_trial_minor'], 79900);
    });
  });

  group('AD-09 · the desktop dialog', () {
    testWidgets('at 1280 the form is a dialog of at most 600', (
      WidgetTester tester,
    ) async {
      await _open(tester, repo: _Repo(), size: kDesktop);
      expect(find.byType(Dialog), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        tester.getSize(find.byType(AppFormSheet)).width,
        lessThanOrEqualTo(AppFormSheet.dialogMaxWidth),
      );
    });

    testWidgets('at 375 it is still the bottom sheet', (
      WidgetTester tester,
    ) async {
      await _open(tester, repo: _Repo());
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.byType(Dialog), findsNothing);
    });
  });
}
