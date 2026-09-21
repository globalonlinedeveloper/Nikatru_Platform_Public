// ─────────────────────────────────────────────────────────────────────────────
// store_seed_idempotence_test.dart — RUN THE STORE CAPTURE'S SEED TWICE, AND
// THE BOARD STILL HOLDS SIX ROWS.
//
// 🔴 THE DEFECT, MEASURED. Eight frames were merged as Public 9f548515 (#854).
// The phone set reads `6 active` and `$93.47` a month. The tablet set OF THE
// SAME RUN reads `12 active` and `$186.94`, and its Home list names five of the
// six illustrative rows TWICE under "All subscriptions 12". `kIllustrative`
// holds exactly six rows — 15.99 + 10.99 + 2.99 + 20.00 + 39.00 + 4.50 = 93.47
// — so 186.94 is that set seeded twice and can be nothing else.
//
// WHY: `tooling/store/capture-play-screenshots.mjs` runs `flutter drive` ONCE
// PER VIEWPORT against ONE account the workflow provisions once, and nothing
// deletes the first drive's rows between the two. The seeding loop was guarded
// only by `if (AppConfig.isBackendLive)` and never by "is this board already
// seeded", so the second drive added a second copy of every row.
//
// 🔴 WHY THIS TEST IS IN `test/` AND NOT BESIDE THE SUITE. An
// `integration_test/` file can only be exercised by a live capture — CI-only
// secrets, a provisioned Supabase user, a browser — and that lane runs a
// handful of times a year. A seeding rule that lived only there would ship
// having never once been run against a board that was already seeded, which is
// the only state it exists for. This is the same argument, in the same words,
// that `store_capture_guard.dart` makes about `store_capture_guard_test.dart`.
//
// ── ⚠️ WHAT THIS DRIVES, AND WHAT IT DOES NOT ───────────────────────────────
// It drives the REAL `SubscriptionsController.addSubscription` — the method
// `_AddSheetState._save` awaits — over a repository that really STORES, and it
// asks the REAL decision: `rowsMissingFrom` is imported from
// `integration_test/store_board_census.dart`, the same symbol the capture
// suite's loop iterates over. So the thing under test is the capture's own
// decision and the app's own board, not a copy of either. A change to that
// function is seen here on the next push.
//
// What is NOT driven is the SHEET — opening it, typing, choosing a category,
// reaching the submit button. That is a question about LAYOUT at one viewport,
// and the capture suite carries its own limbs for it (`ensureVisible` +
// `hitTestable` on the submit button, measured at 360x640; the per-row receipt
// that the sheet closed). Said plainly rather than glossed: this file proves
// the seed is IDEMPOTENT and does not prove the seed still works at the phone
// viewport. The live dispatch is the only answer to the second question.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

// 🔴 THE SUITE'S OWN SOURCES, IMPORTED RATHER THAN RETYPED. A fixture that
// restated the six rows here would keep passing on the day somebody changed
// `kIllustrative`, and a local copy of the seeding decision would be blind to a
// change in the real one — which is exactly the failure shape this repository
// has already paid for: a detector seeded from the wrong source, blind to the
// very bug it was written for, and still looking like coverage.
import '../integration_test/store_board_census.dart';
import '../integration_test/store_screenshots_test.dart' show kIllustrative;

/// A repository that really STORES what is added, because the whole subject is
/// what happens on the SECOND pass over a board that already holds rows. A
/// double that returned an empty `fetchAll()` would make every pass look like
/// the first one and this file would pass against the unfixed code.
class _StoringRepository implements SubscriptionRepository {
  final List<Subscription> rows = <Subscription>[];
  int adds = 0;

  @override
  Future<List<Subscription>> fetchAll() async => List<Subscription>.of(rows);

  @override
  Future<Subscription> add(Subscription draft) async {
    adds++;
    // `copyWith` cannot set the id (it is deliberately not one of its named
    // parameters — see its doc), so the row the server would have minted is
    // constructed here. Every other field is carried from the draft the sheet
    // built, because the whole point is that what is stored is what was typed.
    final Subscription created = Subscription(
      id: 'row-$adds',
      name: draft.name,
      category: draft.category,
      price: draft.price,
      cycle: draft.cycle,
      nextRenewal: draft.nextRenewal,
      plan: draft.plan,
      glyph: draft.glyph,
      usedPct: draft.usedPct,
      usageNote: draft.usageNote,
      unused: draft.unused,
    );
    rows.add(created);
    return created;
  }

  @override
  Future<void> cancel(String id) async =>
      rows.removeWhere((Subscription s) => s.id == id);

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

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

void main() {
  late _StoringRepository repo;

  Widget host() => ProviderScope(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
      subscriptionRepositoryProvider.overrideWithValue(repo),
      subscriptiontrackerNotificationServiceProvider.overrideWithValue(
        _SilentNotifications(),
      ),
    ],
    // The delegates are load-bearing: `l10n.yaml` sets `nullable-getter:
    // false`, so the first line of anything in this tree that reads a string
    // dies with a null-check failure under a bare MaterialApp. The anchor
    // button exists only to give `ProviderScope.containerOf` an element.
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              key: const Key('scope-anchor'),
              onPressed: () {},
              child: const Text('anchor'),
            ),
          ),
        ),
      ),
    ),
  );

  ProviderContainer containerOf(WidgetTester tester) =>
      ProviderScope.containerOf(
        tester.element(find.byKey(const Key('scope-anchor'))),
        listen: false,
      );

  /// The board the app holds, waited for rather than snatched — the same rule
  /// the capture suite's `loadedBoard()` states, and for the same reason: an
  /// `AsyncLoading` provider read as an empty list is what makes an idempotent
  /// seed seed everything again.
  Future<List<Subscription>> board(WidgetTester tester) async {
    final ProviderContainer c = containerOf(tester);
    for (int i = 0; i < 40; i++) {
      final AsyncValue<List<Subscription>> s = c.read(
        subscriptionsControllerProvider,
      );
      if (s.hasValue && !s.isLoading) return s.requireValue;
      await tester.pump(const Duration(milliseconds: 50));
    }
    fail('the subscriptions provider never left AsyncLoading');
  }

  /// One pass of the capture's seed: ask the SUITE'S OWN decision which rows
  /// are missing, and create exactly those through the app's own create path.
  ///
  /// 🔴 `addSubscription` IS WHAT THE SHEET CALLS, not a shortcut past it.
  /// `_AddSheetState._save` builds exactly this `Subscription` draft — id '',
  /// the typed name, the chosen category, the entered price — and awaits
  /// `subscriptionsControllerProvider.notifier.addSubscription(draft)`. So the
  /// board this test builds is built by the same controller method, through the
  /// same repository, updating the same provider the capture reads.
  ///
  /// ⚠️ WHAT IS DELIBERATELY NOT DRIVEN HERE, SAID RATHER THAN GLOSSED: the
  /// SHEET. Opening it, typing into two fields, picking a category in the
  /// dropdown and reaching the submit button are a question about LAYOUT at a
  /// particular viewport, and the capture suite carries its own reachability
  /// limbs for exactly that (`ensureVisible` + `hitTestable` on the submit
  /// button, measured at 360x640; the per-row receipt that the sheet closed).
  /// This file's subject is the DECISION and the BOARD: how many rows exist
  /// after the seed has run more than once. Mixing the two would mean a red
  /// here could be either, which is the reading that makes a failure useless.
  Future<int> seedOnce(WidgetTester tester) async {
    final List<Subscription> now = await board(tester);
    final List<List<String>> toSeed = rowsMissingFrom(
      censusOf(now.map((Subscription s) => s.name)),
      kIllustrative,
    );
    final ProviderContainer c = containerOf(tester);
    for (final List<String> row in toSeed) {
      await c
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(
            Subscription(
              id: '',
              name: row[0],
              category: row[2],
              price: Money.fromMajorUnits(num.parse(row[1]), 'USD'),
              cycle: BillingCycle.monthly,
              nextRenewal: DateTime.now().add(const Duration(days: 30)),
            ),
          );
      await tester.pumpAndSettle();
    }
    return toSeed.length;
  }

  setUp(() => repo = _StoringRepository());

  testWidgets('the first pass creates the whole illustrative set', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();

    final int created = await seedOnce(tester);

    expect(created, kIllustrative.length);
    expect(repo.adds, kIllustrative.length);
    expect((await board(tester)).length, kIllustrative.length);
  });

  // 🔴 THE CASE THE ROW ASKS FOR. Run the seed twice against ONE board — which
  // is what two `flutter drive` invocations against one provisioned account
  // are — and the board must still hold six rows.
  testWidgets('running the seed TWICE leaves the board holding six rows', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();

    final int first = await seedOnce(tester);
    final int second = await seedOnce(tester);

    expect(first, kIllustrative.length, reason: 'the first pass seeds the set');
    expect(
      second,
      0,
      reason:
          'the second pass must create NOTHING — every illustrative row is '
          'already on the board. This is the tablet drive, and a non-zero '
          'number here is the #854 defect: it created a second copy of every '
          'row, and the tablet frames read `12 active` / `\$186.94` against '
          'the phone frames\' `6 active` / `\$93.47`.',
    );

    final List<Subscription> after = await board(tester);
    expect(
      after.length,
      kIllustrative.length,
      reason:
          'the board holds ${after.length} row(s) after two passes: '
          '${after.map((Subscription s) => s.name).join(', ')}',
    );
    // The POST count, not only the list length: a board that ended at six by
    // having twelve rows de-duplicated somewhere downstream would satisfy the
    // line above and would still be a second drive creating six subscriptions
    // in production.
    expect(repo.adds, kIllustrative.length);
    expect(
      boardComplaints(
        censusOf(after.map((Subscription s) => s.name)),
        kIllustrative,
      ),
      isEmpty,
    );
  });

  // A third pass, because "twice" could be satisfied by a rule that only ever
  // skips once.
  testWidgets('a third pass still leaves six rows', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();
    await seedOnce(tester);
    await seedOnce(tester);
    expect(await seedOnce(tester), 0);
    expect(repo.adds, kIllustrative.length);
  });

  // ── 🔴 THE REFUSAL LIMB, WHICH THE SEED-TWICE CASES CANNOT REACH ──────────
  //
  // MEASURED, not assumed: mutating `boardComplaints` so a duplicated row no
  // longer complains left every case above GREEN (exit 0, 4/4). Of course it
  // did — with the seed fixed, no board in this file ever HOLDS a duplicate, so
  // the limb that names one ranges over nothing. That limb is not decoration:
  // it is what stops a drive that ARRIVES at an already-doubled account — a
  // previous run that died before its teardown, an account re-used across runs
  // — from photographing it. Seeding nothing does not repair such a board.
  //
  // So it is driven on the census directly, in both directions, because the
  // state it exists for is one a fixed seed cannot produce.
  testWidgets('a board that ARRIVES doubled is refused, not silently accepted', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();
    await seedOnce(tester);

    // The #854 board: every illustrative row present twice.
    final List<String> doubled = <String>[
      for (final List<String> row in kIllustrative) ...<String>[row[0], row[0]],
    ];
    final List<String> complaints = boardComplaints(
      censusOf(doubled),
      kIllustrative,
    );
    expect(complaints.length, kIllustrative.length);
    for (final List<String> row in kIllustrative) {
      expect(
        complaints.any((String c) => c.contains('"${row[0]}" appears 2 times')),
        isTrue,
        reason: 'no complaint named "${row[0]}": $complaints',
      );
    }

    // 🟢 And the green control for the same call, on the board this test just
    // built, so a complaint list that is never empty cannot pass as a detector.
    expect(
      boardComplaints(
        censusOf((await board(tester)).map((Subscription s) => s.name)),
        kIllustrative,
      ),
      isEmpty,
    );
  });

  testWidgets('a row the set never asked for is named too', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();
    final List<String> stray = <String>[
      for (final List<String> row in kIllustrative) row[0],
      'Netflix',
    ];
    final List<String> complaints = boardComplaints(
      censusOf(stray),
      kIllustrative,
    );
    expect(complaints.length, 1);
    expect(complaints.single, contains('"Netflix" is on the board'));
  });

  testWidgets(
    'a MISSING row is named, so the skip cannot become a mute button',
    (WidgetTester tester) async {
      await tester.pumpWidget(host());
      await tester.pumpAndSettle();
      final List<String> short = <String>[
        for (final List<String> row in kIllustrative.sublist(1)) row[0],
      ];
      final List<String> complaints = boardComplaints(
        censusOf(short),
        kIllustrative,
      );
      expect(complaints.length, 1);
      expect(
        complaints.single,
        contains('"${kIllustrative.first[0]}" is MISSING'),
      );
    },
  );

  // ⚠️ AND THE OTHER DIRECTION, so the skip is not a mute button. A board
  // holding SOME of the set must be completed, not left alone — otherwise a
  // drive that died halfway through its own seeding would publish a short
  // board and this rule would be the reason.
  testWidgets('a partially seeded board is completed, not skipped', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.pumpAndSettle();

    // Seed the whole set, then drop two rows from the STORE and make the app
    // re-read it — the shape of a previous drive that failed partway. The
    // re-read goes through `refresh`, which re-runs the controller's own
    // `build()` against `fetchAll()`: assigning the notifier's `state` from a
    // test would be reaching past the protected member and would prove the
    // rule against a state no fetch can produce.
    await seedOnce(tester);
    final ProviderContainer c = containerOf(tester);
    final List<Subscription> keep = (await board(tester)).sublist(0, 4);
    repo.rows
      ..clear()
      ..addAll(keep);
    c.invalidate(subscriptionsControllerProvider);
    await tester.pumpAndSettle();
    expect((await board(tester)).length, 4);

    expect(await seedOnce(tester), 2);
    expect((await board(tester)).length, kIllustrative.length);
  });
}
