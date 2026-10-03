// ST-T3b — the add/edit sheet and the detail screen's new controls
// ([ADR no.077] §5): ST-E1 (edit), ST-E2 (sheet quality), ST-E3 (the
// overflow). The model- and controller-level halves are in
// subscription_model_t3b_test.dart.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show FocusableTap;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/catalogue_fixture.dart';
import 'support/width_harness.dart';

/// Records every write; a PATCH is applied the way the route applies it.
/// [refuseWith] makes the next write a 400 carrying that `detail`.
class _Api implements ApiClient {
  _Api(this.subs);
  List<Subscription> subs;
  final List<Map<String, dynamic>> patches = <Map<String, dynamic>>[];
  final List<Subscription> posts = <Subscription>[];
  int deletes = 0;
  String? refuseWith;

  @override
  Future<List<Subscription>> getSubscriptions() async => subs;
  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    final String? r = refuseWith;
    if (r != null) throw ApiException(400, 'invalid_body', detail: r);
    posts.add(draft);
    final Subscription made = draft.patched(<String, dynamic>{'id': 'new'});
    subs = <Subscription>[...subs, made];
    return made;
  }

  @override
  Future<Subscription> getSubscription(String id) async =>
      subs.firstWhere((Subscription s) => s.id == id);
  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    patches.add(Map<String, dynamic>.of(changes));
    final Subscription u = subs
        .firstWhere((Subscription s) => s.id == id)
        .patched(changes);
    subs = <Subscription>[
      for (final Subscription s in subs) s.id == id ? u : s,
    ];
    return u;
  }

  @override
  Future<void> deleteSubscription(String id) async => deletes++;
  // NO-10 · "Mark as paid": not exercised by this suite.
  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {}

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async =>
      const <PaymentRecord>[];
  @override
  Future<SpendHistory> getSpendHistory() async => SpendHistory.empty;
  @override
  Future<BudgetInfo> getBudget() async => const BudgetInfo(
    monthlyBudget: Money(1, 'USD'),
    categories: <BudgetCap>[],
  );
  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async => budget;
  @override
  Future<core.Entitlements> getEntitlements() async => core.Entitlements.none;
}

final Subscription _netflix = Subscription(
  id: 'nf',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(1549, 'USD'),
  cycle: Cadence.monthly,
  nextRenewal: DateTime(2030, 1, 22),
  plan: 'Premium 4K',
  glyph: 'NFX',
);

/// A tall window, so no field is off the sheet's scroll.
const Size _tall = Size(800, 2400);

Future<void> _openSheet(
  WidgetTester tester,
  _Api api, {
  Subscription? initial,
  bool stayOnPick = false,
}) async {
  await pumpAt(
    tester,
    _tall,
    Scaffold(
      body: Builder(
        builder: (BuildContext c) => Center(
          child: TextButton(
            onPressed: () => showAddSubscriptionSheet(c, initial: initial),
            child: const Text('open'),
          ),
        ),
      ),
    ),
    overrides: <Override>[
      apiClientProvider.overrideWithValue(api),
      ...catalogueOverrides(),
    ],
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  // ST-T9: an add opens on the catalogue pick step; these tests are about the
  // form, so they step past it the way a user adding by hand does.
  if (initial == null && !stayOnPick) {
    await tester.tap(find.byKey(E2EKeys.addByHand));
    await tester.pumpAndSettle();
  }
}

// ⏱ 2026-09-29 · train ST-D6 on ST-T3b: the primary is the chassis
// `AppFormActions` FilledButton (it was a GradientButton); the key and the
// disabled-until-valid contract are unchanged.
VoidCallback? _submit(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(E2EKeys.addSubmit)).onPressed;

String? _errorOf(WidgetTester tester, Key key) =>
    tester.widget<TextField>(find.byKey(key)).decoration?.errorText;

void main() {
  late AppLocalizations en;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  group('ST-E1 · edit', () {
    testWidgets(
      'the sheet opens PREFILLED and saving sends ONE PATCH of the changed keys',
      (WidgetTester tester) async {
        final _Api api = _Api(<Subscription>[_netflix]);
        await _openSheet(tester, api, initial: _netflix);

        expect(find.text(en.editSubscriptionTitle), findsOneWidget);
        expect(find.widgetWithText(TextField, 'Netflix'), findsOneWidget);
        expect(find.widgetWithText(TextField, '15.49'), findsOneWidget);
        expect(find.widgetWithText(TextField, 'Premium 4K'), findsOneWidget);

        await tester.enterText(find.byKey(E2EKeys.addName), 'Netflix UHD');
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
        await tester.pump();
        await tester.tap(find.byKey(E2EKeys.addSubmit));
        await tester.pumpAndSettle();

        expect(api.patches, hasLength(1));
        expect(api.patches.single, <String, dynamic>{'name': 'Netflix UHD'});
        expect(api.posts, isEmpty);
        expect(api.deletes, 0);
      },
    );

    testWidgets('"Edit plan" on the detail screen opens that sheet', (
      WidgetTester tester,
    ) async {
      final _Api api = _Api(<Subscription>[_netflix]);
      await pumpAt(
        tester,
        _tall,
        const SubscriptionDetailScreen(id: 'nf'),
        overrides: <Override>[apiClientProvider.overrideWithValue(api)],
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text(en.editPlan));
      await tester.tap(find.text(en.editPlan));
      await tester.pumpAndSettle();
      expect(find.text(en.editSubscriptionTitle), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Netflix'), findsOneWidget);
    });

    test('no subtitle ends in a dangling " · "', () {
      final Subscription noPlan = _netflix.patched(<String, dynamic>{
        'plan': '',
      });
      expect(detailSubtitle(en, noPlan), 'Streaming');
      expect(detailSubtitle(en, _netflix), 'Streaming · Premium 4K');
      expect(
        detailSubtitle(
          en,
          noPlan.patched(<String, dynamic>{'status': 'paused'}),
        ),
        'Streaming · ${en.statusPaused}',
      );
    });
  });

  group('ST-E2 · the sheet refuses what is not a price, and says so', () {
    testWidgets('a blank price or "-5" disables Add and shows errorText', (
      WidgetTester tester,
    ) async {
      await _openSheet(tester, _Api(<Subscription>[]));
      await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
      await tester.pumpAndSettle();
      expect(_submit(tester), isNull, reason: 'no price: nothing to save');

      await tester.enterText(find.byKey(E2EKeys.addPrice), '-5');
      await tester.pumpAndSettle();
      expect(_submit(tester), isNull);
      expect(_errorOf(tester, E2EKeys.addPrice), en.priceErrorInvalid);

      await tester.enterText(find.byKey(E2EKeys.addPrice), '');
      await tester.pumpAndSettle();
      expect(_submit(tester), isNull);
      expect(_errorOf(tester, E2EKeys.addPrice), en.priceErrorInvalid);

      await tester.enterText(find.byKey(E2EKeys.addPrice), '1,299');
      await tester.pumpAndSettle();
      expect(_submit(tester), isNotNull);
      expect(_errorOf(tester, E2EKeys.addPrice), isNull);
    });

    testWidgets('"1,299" is saved EXACTLY, never the old 9.99 fallback', (
      WidgetTester tester,
    ) async {
      final _Api api = _Api(<Subscription>[]);
      await _openSheet(tester, api);
      await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
      await tester.enterText(find.byKey(E2EKeys.addPrice), '1,299');
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
      await tester.pump();
      await tester.tap(find.byKey(E2EKeys.addSubmit));
      await tester.pumpAndSettle();
      expect(api.posts.single.price.minorUnits, 129900);
      // The glyph is derived BEFORE POST by the helper the seed client uses.
      expect(api.posts.single.glyph, Subscription.glyphFor('Hulu'));
    });

    testWidgets(
      'a 400 reads "Check the highlighted fields" and marks the field',
      (WidgetTester tester) async {
        final _Api api = _Api(<Subscription>[])
          ..refuseWith =
              'price must be a finite number between 0 and 1000000000';
        await _openSheet(tester, api);
        await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
        await tester.enterText(find.byKey(E2EKeys.addPrice), '5');
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
        await tester.pump();
        await tester.tap(find.byKey(E2EKeys.addSubmit));
        await tester.pumpAndSettle();
        // ⏱ train ST-D6: said on the sheet's banner, not in a SnackBar the
        // modal barrier drew over.
        expect(
          find.descendant(
            of: find.byKey(E2EKeys.addBanner),
            matching: find.text(en.checkHighlightedFields),
          ),
          findsOneWidget,
        );
        expect(_errorOf(tester, E2EKeys.addPrice), en.checkHighlightedFields);
        expect(find.text(en.addSubscriptionFailed), findsNothing);
      },
    );

    testWidgets('every field is found by its semantics label', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle h = tester.ensureSemantics();
      await _openSheet(tester, _Api(<Subscription>[]));
      for (final String label in <String>[
        en.fieldLabelName,
        en.fieldLabelPrice,
        en.fieldLabelCurrency,
        en.fieldLabelCycle,
        en.fieldLabelRenews,
        en.fieldLabelPlan,
        en.fieldLabelWebsite,
        en.fieldLabelNotes,
        en.fieldLabelTrial,
      ]) {
        expect(
          find.bySemanticsLabel(RegExp(RegExp.escape(label))),
          findsWidgets,
          reason: '"$label" has no semantics node a reader can land on',
        );
      }
      h.dispose();
    });

    testWidgets('Tab reaches a POPULAR tile, the cycle and the date', (
      WidgetTester tester,
    ) async {
      // ST-T9: the POPULAR tiles are on the pick step, the cycle and the
      // date on the form after it — one walk each.
      await _openSheet(tester, _Api(<Subscription>[]), stayOnPick: true);
      final Set<String> reached = <String>{};
      for (int i = 0; i < 40; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pumpAndSettle();
        final BuildContext? focused =
            FocusManager.instance.primaryFocus?.context;
        if (focused?.findAncestorWidgetOfExactType<GridView>() != null) {
          reached.add('tile');
          break;
        }
      }
      await tester.tap(find.byKey(E2EKeys.addByHand));
      await tester.pumpAndSettle();
      for (int i = 0; i < 40; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pumpAndSettle();
        final BuildContext? focused =
            FocusManager.instance.primaryFocus?.context;
        if (focused == null) continue;
        if (focused.findAncestorWidgetOfExactType<GridView>() != null) {
          reached.add('tile');
        }
        bool inCycle = false;
        focused.visitAncestorElements((Element e) {
          // The type argument is the sheet's private preset enum, so the
          // widget is matched by its runtime type's name.
          inCycle = e.widget.runtimeType.toString().startsWith(
            'DropdownButtonFormField<_CyclePreset>',
          );
          return !inCycle;
        });
        if (inCycle) reached.add('cycle');
        if (focused.findAncestorWidgetOfExactType<FocusableTap>()?.key ==
            E2EKeys.addRenewal) {
          reached.add('date');
        }
      }
      expect(reached, containsAll(<String>['tile', 'cycle', 'date']));
    });
  });
}
