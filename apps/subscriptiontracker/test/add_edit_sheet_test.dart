// ─────────────────────────────────────────────────────────────────────────────
// add_edit_sheet_test.dart — train ST-D6, the Add / Edit sheet, one case per
// STATE and one per write.
//
//   empty      an add: nothing typed, the POPULAR shortcuts, "Add subscription"
//   populated  an edit: every field prefilled from the row, no shortcuts
//   loading    a save in flight: the primary disabled and saying so, fields off
//   error      a failed save: a danger banner, the draft kept, the primary live
//   offline    the app knows the network is down: a warn banner up front
//
// plus the validation that replaced the invented 9.99, the edit's PATCH (only
// the sheet's own fields, the row's own currency), and the keyboard path.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/catalogue_fixture.dart';
import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

Subscription _row() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: const Money(64900, 'INR'),
  cycle: BillingCycle.yearly,
  nextRenewal: DateTime(2030, 3, 14),
  plan: 'Premium',
);

/// A repository whose writes wait on [gate] and then either apply or throw.
class _Repo implements SubscriptionRepository {
  _Repo({this.fail = false, Subscription? seed})
    : rows = <Subscription>[seed ?? _row()];

  final bool fail;
  Completer<void>? gate;
  final List<Subscription> added = <Subscription>[];
  final List<(String, Map<String, dynamic>)> updates =
      <(String, Map<String, dynamic>)>[];

  /// The SERVER's rows: an update is applied here, so a test reads back what
  /// the server now holds rather than what the client sent.
  final List<Subscription> rows;

  Future<void> _wait() async {
    final Completer<void>? g = gate;
    if (g != null) await g.future;
    if (fail) throw Exception('SocketException: Failed host lookup');
  }

  @override
  Future<List<Subscription>> fetchAll() async => rows;

  @override
  Future<Subscription> add(Subscription draft) async {
    await _wait();
    added.add(draft);
    return draft;
  }

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    await _wait();
    updates.add((id, changes));
    final int i = rows.indexWhere((Subscription s) => s.id == id);
    return rows[i] = rows[i].patched(changes);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

Future<(ProviderContainer, AppLocalizations)> _open(
  WidgetTester tester, {
  required _Repo repo,
  Subscription? editing,
  bool offline = false,
  bool stayOnPick = false,
}) async {
  // The VIEW, not `setSurfaceSize`: the sheet caps its height off
  // MediaQuery, which only the view moves (the trap width_add_sheet_test.dart
  // records). ST-T3b's form is tall enough to scroll on a phone.
  tester.view.physicalSize = kPhone;
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
  if (offline) {
    c.read(networkUnreachableProvider.notifier).report(unreachable: true);
  }
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
                onPressed: () => editing == null
                    ? showAddSubscriptionSheet(context)
                    : showAddSubscriptionSheet(context, initial: editing),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  // Load the list first, so an edit has an OBSERVED list to replace into.
  await c.read(subscriptionsControllerProvider.future);
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  // ST-T9: an add opens on the catalogue pick step; these tests are about the
  // FORM, so they step past it the way a user adding by hand does.
  if (editing == null && !stayOnPick) {
    await tester.tap(find.byKey(E2EKeys.addByHand));
    await tester.pumpAndSettle();
  }
  final AppLocalizations l10n = await AppLocalizations.delegate.load(
    const Locale('en'),
  );
  return (c, l10n);
}

String _fieldText(WidgetTester tester, Key key) =>
    tester.widget<TextField>(find.byKey(key)).controller!.text;

Future<void> _submit(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
  await tester.pumpAndSettle();
  // ST-T9: a focused field re-shows its caret once the scroll settles, and on
  // the longer form that can carry Save back below the fold — look again.
  await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
  await tester.pump();
  await tester.tap(find.byKey(E2EKeys.addSubmit));
}

Finder _inSubmit(String text) => find.descendant(
  of: find.byKey(E2EKeys.addSubmit),
  matching: find.text(text),
);

void main() {
  testWidgets('PICKING — an add opens on the catalogue, POPULAR offered', (
    WidgetTester tester,
  ) async {
    final (_, AppLocalizations l10n) = await _open(
      tester,
      repo: _Repo(),
      stayOnPick: true,
    );
    expect(find.text(l10n.addPopularHeading), findsOneWidget);
    expect(find.byKey(E2EKeys.addSearch), findsOneWidget);
    expect(find.byKey(E2EKeys.addName), findsNothing);
    expect(find.byKey(E2EKeys.addBanner), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('EMPTY — an add by hand opens blank', (
    WidgetTester tester,
  ) async {
    final (_, AppLocalizations l10n) = await _open(tester, repo: _Repo());
    expect(find.text(l10n.addPopularHeading), findsNothing);
    expect(_fieldText(tester, E2EKeys.addName), isEmpty);
    expect(_fieldText(tester, E2EKeys.addPrice), isEmpty);
    expect(_inSubmit(l10n.addSubscriptionTitle), findsOneWidget);
    expect(find.byKey(E2EKeys.addBanner), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('POPULATED — an edit opens on the row, every field filled', (
    WidgetTester tester,
  ) async {
    final (_, AppLocalizations l10n) = await _open(
      tester,
      repo: _Repo(),
      editing: _row(),
    );
    expect(find.text(l10n.editSubscriptionTitle), findsOneWidget);
    expect(find.text(l10n.addPopularHeading), findsNothing);
    expect(_fieldText(tester, E2EKeys.addName), 'Netflix');
    // ST-T3b: the stored amount as a person types it, to the currency's digits.
    expect(_fieldText(tester, E2EKeys.addPrice), '649.00');
    expect(
      tester
          .widget<DropdownButtonFormField<String>>(
            find.byKey(E2EKeys.addCategory),
          )
          .initialValue,
      'Streaming',
    );
    expect(
      find.descendant(
        of: find.byKey(E2EKeys.addRenewal),
        matching: find.text('Mar 14, 2030'),
      ),
      findsOneWidget,
    );
    // ⏱ ST-T3b (ST-E4): the cadence is a dropdown showing the row's own.
    expect(find.text(l10n.cycleYearly), findsOneWidget);
    expect(_inSubmit(l10n.save), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('LOADING — a save in flight disables the form and says so', (
    WidgetTester tester,
  ) async {
    final _Repo repo = _Repo()..gate = Completer<void>();
    final (_, AppLocalizations l10n) = await _open(tester, repo: repo);
    await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
    await tester.enterText(find.byKey(E2EKeys.addPrice), '7.99');
    await _submit(tester);
    await tester.pump();

    expect(_inSubmit(l10n.addingEllipsis), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(E2EKeys.addSubmit)).onPressed,
      isNull,
    );
    expect(
      tester.widget<TextField>(find.byKey(E2EKeys.addName)).enabled,
      isFalse,
    );
    // A second tap while busy writes nothing twice.
    await tester.tap(find.byKey(E2EKeys.addSubmit), warnIfMissed: false);
    repo.gate!.complete();
    await tester.pumpAndSettle();
    expect(repo.added, hasLength(1));
    expect(find.byType(SubscriptionFormSheet), findsNothing);
  });

  testWidgets('ERROR — a failed edit keeps the edits and re-arms the save', (
    WidgetTester tester,
  ) async {
    final (_, AppLocalizations l10n) = await _open(
      tester,
      repo: _Repo(fail: true),
      editing: _row(),
    );
    await tester.enterText(find.byKey(E2EKeys.addName), 'Netflix 4K');
    await _submit(tester);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    final Finder banner = find.byKey(E2EKeys.addBanner);
    expect(banner, findsOneWidget);
    expect(tester.widget<DecisionStrip>(banner).kind, StatusKind.danger);
    expect(
      find.descendant(
        of: banner,
        matching: find.text(l10n.updateSubscriptionFailed),
      ),
      findsOneWidget,
    );
    expect(_fieldText(tester, E2EKeys.addName), 'Netflix 4K');
    expect(_inSubmit(l10n.save), findsOneWidget);
    expect(
      tester.widget<FilledButton>(find.byKey(E2EKeys.addSubmit)).onPressed,
      isNotNull,
    );
  });

  testWidgets('OFFLINE — a warn banner says so before anything is typed', (
    WidgetTester tester,
  ) async {
    final (_, AppLocalizations l10n) = await _open(
      tester,
      repo: _Repo(),
      offline: true,
    );
    final Finder banner = find.byKey(E2EKeys.addBanner);
    expect(banner, findsOneWidget);
    expect(tester.widget<DecisionStrip>(banner).kind, StatusKind.warn);
    expect(
      find.descendant(of: banner, matching: find.text(l10n.formOfflineNotice)),
      findsOneWidget,
    );
    // The form stays usable: the banner informs, it does not block.
    expect(
      tester.widget<TextField>(find.byKey(E2EKeys.addName)).enabled,
      isNot(isFalse),
    );
  });

  // ⏱ 2026-09-29 · ST-T3b (ST-E2) is the behaviour of record: Add is DISABLED
  // until the form describes a real row, and the price field names what is
  // wrong — rather than ST-D6's submit-then-flag. A name is not required.
  testWidgets('VALIDATION — nothing is written, and nothing is invented', (
    WidgetTester tester,
  ) async {
    final _Repo repo = _Repo();
    final (_, AppLocalizations l10n) = await _open(tester, repo: repo);
    VoidCallback? submit() =>
        tester.widget<FilledButton>(find.byKey(E2EKeys.addSubmit)).onPressed;
    String? priceError() => tester
        .widget<TextField>(find.byKey(E2EKeys.addPrice))
        .decoration
        ?.errorText;

    expect(submit(), isNull, reason: 'no price: nothing to save');
    expect(priceError(), isNull, reason: 'a fresh sheet greets with no error');

    await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
    for (final String bad in <String>['abc', '-3', 'Infinity', '0']) {
      await tester.enterText(find.byKey(E2EKeys.addPrice), bad);
      await tester.pump();
      expect(priceError(), l10n.priceErrorInvalid, reason: bad);
      expect(submit(), isNull, reason: '"$bad" would be saved as an amount');
    }
    await tester.enterText(find.byKey(E2EKeys.addPrice), '');
    await tester.pump();
    expect(priceError(), l10n.priceErrorInvalid, reason: 'emptied');

    await tester.enterText(find.byKey(E2EKeys.addPrice), '7.99');
    await tester.pump();
    expect(priceError(), isNull);
    expect(submit(), isNotNull);
    expect(repo.added, isEmpty, reason: 'typing wrote nothing');
  });

  testWidgets('EDIT WRITES — only the sheet fields, in the row currency', (
    WidgetTester tester,
  ) async {
    final _Repo repo = _Repo();
    final (ProviderContainer c, AppLocalizations l10n) = await _open(
      tester,
      repo: repo,
      editing: _row(),
    );
    await tester.enterText(find.byKey(E2EKeys.addName), 'Netflix 4K');
    await tester.enterText(find.byKey(E2EKeys.addPrice), '799');
    await tester.pump();
    await _submit(tester);
    await tester.pumpAndSettle();

    expect(find.byType(SubscriptionFormSheet), findsNothing);
    expect(repo.updates, hasLength(1));
    final (String id, Map<String, dynamic> patch) = repo.updates.single;
    expect(id, 'sub-1');
    // ⏱ ST-T3b (ST-E1): ONE PATCH of only what changed — the untouched
    // category, cadence and date are not re-sent.
    expect(patch['name'], 'Netflix 4K');
    expect(patch.keys, containsAll(<String>['name', 'price']));
    for (final String untouched in <String>['category', 'plan', 'notes']) {
      expect(patch.containsKey(untouched), isFalse, reason: untouched);
    }

    final Subscription saved = c
        .read(subscriptionsControllerProvider)
        .requireValue
        .single;
    expect(saved.name, 'Netflix 4K');
    expect(saved.price, const Money(79900, 'INR'));
    expect(saved.plan, 'Premium', reason: 'a field the sheet does not own');
  });

  testWidgets('EDIT KEEPS A SHARE — name, amount and date change, the 1/3 '
      'share stays on the server (ST-P4, F38)', (WidgetTester tester) async {
    final Subscription shared = _row().patched(<String, dynamic>{
      'shared_with': 'flatmates',
      'share_numerator': 1,
      'share_denominator': 3,
    });
    expect(shared.isShared, isTrue, reason: 'the fixture is a shared row');
    final _Repo repo = _Repo(seed: shared);
    await _open(tester, repo: repo, editing: shared);
    await tester.enterText(find.byKey(E2EKeys.addName), 'Netflix 4K');
    await tester.enterText(find.byKey(E2EKeys.addPrice), '799');
    await tester.ensureVisible(find.byKey(E2EKeys.addRenewal));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(E2EKeys.addRenewal));
    await tester.pumpAndSettle();
    await tester.tap(find.text('20'));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await _submit(tester);
    await tester.pumpAndSettle();

    final (_, Map<String, dynamic> patch) = repo.updates.single;
    expect(patch.keys, containsAll(<String>['name', 'price']));
    for (final String k in <String>[
      'shared_with',
      'share_numerator',
      'share_denominator',
    ]) {
      expect(patch.containsKey(k), isFalse, reason: '$k is not re-sent');
    }
    // The server's row, read back: renamed, repriced, re-dated, still shared.
    final Subscription stored = (await repo.fetchAll()).single;
    expect(stored.name, 'Netflix 4K');
    expect(stored.price, const Money(79900, 'INR'));
    expect(stored.nextRenewal, isNot(shared.nextRenewal));
    expect(stored.isShared, isTrue);
    expect(stored.shareNumerator, 1);
    expect(stored.shareDenominator, 3);
    expect(stored.sharedWith, 'flatmates');
  });

  testWidgets('KEYBOARD — Next walks on from the name; Ctrl+Enter submits', (
    WidgetTester tester,
  ) async {
    final _Repo repo = _Repo();
    await _open(tester, repo: repo);
    expect(
      tester.widget<TextField>(find.byKey(E2EKeys.addName)).textInputAction,
      TextInputAction.next,
    );
    await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
    await tester.enterText(find.byKey(E2EKeys.addPrice), '7.99');
    await tester.pump();
    // The chassis sheet's own submit chord, from inside a field (ST-D6).
    await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
    await tester.pumpAndSettle();
    expect(repo.added.single.name, 'Hulu');
    expect(repo.added.single.price.minorUnits, 799);
  });

  testWidgets('KEYBOARD — Escape closes the sheet without writing', (
    WidgetTester tester,
  ) async {
    final _Repo repo = _Repo();
    await _open(tester, repo: repo);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byType(SubscriptionFormSheet), findsNothing);
    expect(repo.added, isEmpty);
  });
}
