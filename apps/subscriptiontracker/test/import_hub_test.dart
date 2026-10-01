// ─────────────────────────────────────────────────────────────────────────────
// THE IMPORT HUB — IM-01..06 and IM-08, each with the red control that fails
// without it.
//
//   IM-02 · a 3-row CSV with one row already in the list imports 2; a row whose
//           price does not parse is SHOWN with its reason and not imported.
//   IM-05 · a TrackMySubs-shaped header maps every column with no question;
//           every preset maps every column of its own signature.
//   IM-03 · back up 5 rows, delete 2, restore → 5 (merge, never delete), and a
//           second restore of the same file changes nothing.
//   IM-04 · a hand-written ₹ receipt is one candidate with price, currency and
//           date, and the ONLY call that leaves the screen is the add.
//   IM-06 · a file dropped into the import inbox opens the mapping step; a
//           share routes to /import with its text.
//   IM-01 · the three ways in — Home's empty state, Settings › Your data, the
//           add sheet's "Import instead" — each open /import.
//   IM-08 · a failed export says so; a list that did not load says so.
//
// RED CONTROLS (each run against the real tree while writing this file):
//   · `ImportPlan.build(... existingKeys: const [])` in import_screen.dart →
//     the duplicate is added and the IM-02 case counts 3, not 2;
//   · drop `kTrackerPresets` from `ColumnPreset.recognise` → IM-05 is red;
//   · `planText(f.text, const [])` (no existing rows) → the restore adds all
//     five again and the count is 8, not 5;
//   · return early from `_takeInbox` → both IM-06 cases are red;
//   · `exportOutcomeSentence` returning `exportDone` for every outcome → the
//     IM-08 failure case is red.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/portability/subscription_columns.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/add/add_subscription_sheet.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart'
    show currencyCodeProvider;
import 'package:subscriptiontracker/state/share_inbox.dart';

import 'support/width_harness.dart';

/// An in-memory repository that records every call it is asked to make — the
/// whole network surface an import has.
class _MemRepo extends SubscriptionRepository {
  _MemRepo(List<Subscription> rows)
    : rows = <Subscription>[...rows],
      super(SeedApiClient());

  final List<Subscription> rows;
  final List<String> calls = <String>[];
  int _next = 100;

  @override
  Future<List<Subscription>> fetchAll() async {
    calls.add('fetchAll');
    return <Subscription>[...rows];
  }

  @override
  Future<Subscription> add(Subscription draft) async {
    calls.add('add');
    // The server keys a new row; a restored row comes back under a NEW id.
    final Subscription created = Subscription.fromJson(<String, dynamic>{
      ...draft.toJson(),
      'id': 'srv-${_next++}',
    }, fallbackCurrencyCode: draft.price.currencyCode);
    rows.add(created);
    return created;
  }

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    calls.add('update');
    final int i = rows.indexWhere((Subscription s) => s.id == id);
    rows[i] = rows[i].patched(changes);
    return rows[i];
  }
}

Subscription _row(String id, String name, int minor, {String ccy = 'INR'}) =>
    Subscription(
      id: id,
      name: name,
      category: 'Streaming',
      price: Money(minor, ccy),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 11, 12),
    );

const String _threeRows =
    'name,price,currency,cycle,next_renewal\n'
    'Netflix,649,INR,monthly,2026-11-05\n'
    'Spotify,119,INR,monthly,2026-11-10\n'
    'Hotstar,299,INR,monthly,2026-11-12\n';

/// A hand-written ₹ receipt in the shape Indian mail receipts take.
const String _rupeeReceipt = '''
Payment Receipt
Netflix
Order ID 4839201775
Date: 12 Sep 2026
Plan: Premium (Monthly)
Subtotal ₹550.00
GST @18% ₹99.00
Total (incl. GST) ₹649.00
Paid via UPI
''';

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// [ImportScreen] over [repo], answering with the container so a case can
/// drop a file into the inbox the way a share or a drop does.
Future<ProviderContainer> _pumpHub(
  WidgetTester tester,
  _MemRepo repo, {
  List<Override> overrides = const <Override>[],
}) async {
  await pumpAt(
    tester,
    const Size(800, 2400),
    const ImportScreen(),
    overrides: <Override>[
      subscriptionRepositoryProvider.overrideWithValue(repo),
      currencyCodeProvider.overrideWithValue('INR'),
      ...overrides,
    ],
  );
  return ProviderScope.containerOf(tester.element(find.byType(ImportScreen)));
}

Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 8; i++) {
    await tester.pump();
  }
}

Future<void> _paste(WidgetTester tester, String text) async {
  await tester.enterText(find.byKey(E2EKeys.importPaste), text);
  await tester.pump();
  await tester.tap(find.byKey(E2EKeys.importRead));
  await _settle(tester);
}

Future<void> _tapKey(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  await _settle(tester);
}

void main() {
  group('IM-02 · CSV with mapping and review', () {
    testWidgets('RED CONTROL · 3 rows, one already in the list, imports 2', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(<Subscription>[
        _row('a', 'Hotstar', 29900),
      ]);
      await _pumpHub(tester, repo);
      final AppLocalizations l10n = await _en();

      await _paste(tester, _threeRows);
      expect(find.text(l10n.importMapTitle), findsOneWidget);
      await _tapKey(tester, E2EKeys.importContinue);

      expect(find.text(l10n.importReviewTitle), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('import-candidate-1')),
        findsOne,
      );
      expect(
        find.byKey(const ValueKey<String>('import-candidate-2')),
        findsOne,
      );
      expect(
        find.byKey(const ValueKey<String>('import-duplicate-3')),
        findsOneWidget,
        reason: 'Hotstar ₹299 monthly is already in the list: shown, marked',
      );
      expect(find.text(l10n.importReviewDuplicate), findsOneWidget);
      expect(find.text(l10n.importAddSelected(2)), findsOneWidget);

      await _tapKey(tester, E2EKeys.importAdd);
      expect(repo.calls.where((String c) => c == 'add'), hasLength(2));
      expect(repo.rows.map((Subscription s) => s.name), <String>[
        'Hotstar',
        'Netflix',
        'Spotify',
      ]);
      final Subscription netflix = repo.rows[1];
      expect(netflix.price, const Money(64900, 'INR'));
      expect(netflix.cycle, BillingCycle.monthly);
      expect(find.text(l10n.importAdded(2)), findsOneWidget);
    });

    testWidgets('RED CONTROL · a bad price row is shown, not imported', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(const <Subscription>[]);
      await _pumpHub(tester, repo);
      final AppLocalizations l10n = await _en();

      await _paste(
        tester,
        'name,price,currency,cycle\n'
        'Netflix,649,INR,monthly\n'
        'Broken,abc,INR,monthly\n',
      );
      await _tapKey(tester, E2EKeys.importContinue);

      final Finder error = find.byKey(const ValueKey<String>('import-error-2'));
      expect(error, findsOneWidget, reason: 'the bad row is SHOWN');
      expect(
        find.descendant(of: error, matching: find.textContaining('"abc"')),
        findsOneWidget,
        reason: 'with the cell it could not read',
      );
      expect(find.text(l10n.importAddSelected(1)), findsOneWidget);
      await _tapKey(tester, E2EKeys.importAdd);
      expect(repo.rows.map((Subscription s) => s.name), <String>['Netflix']);
    });

    testWidgets('a column can be re-mapped by hand before continuing', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(const <Subscription>[]);
      await _pumpHub(tester, repo);
      // "Thing" matches no synonym, so the name question starts unanswered and
      // Continue waits for it.
      await _paste(tester, 'Thing,price,currency\nNetflix,649,INR\n');
      expect(
        tester
            .widget<FilledButton>(find.byKey(E2EKeys.importContinue))
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const ValueKey<String>('import-map-name')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Thing').last);
      await tester.pumpAndSettle();
      await _tapKey(tester, E2EKeys.importContinue);
      await _tapKey(tester, E2EKeys.importAdd);
      expect(repo.rows.single.name, 'Netflix');
    });
  });

  group('IM-05 · presets for other trackers', () {
    test(
      'RED CONTROL · a TrackMySubs-shaped header auto-maps every column',
      () {
        const List<String> header = <String>[
          'Subscription Name',
          'Cost',
          'Currency',
          'Billing Frequency',
          'Next Bill Date',
          'Category',
          'Notes',
        ];
        expect(
          core.ColumnMapping.infer(
            header,
            kSubscriptionImportFields,
          ).unknownColumns,
          isNotEmpty,
          reason: 'the premise: the synonyms alone do NOT read this header',
        );
        final core.ColumnPreset? p = core.ColumnPreset.recognise(
          header,
          kTrackerPresets,
        );
        expect(p?.name, 'TrackMySubs');
        final core.ColumnMapping m = p!.apply(
          header,
          kSubscriptionImportFields,
        );
        expect(m.unknownHeaders, isEmpty);
        for (final String id in kImportMappedFieldIds) {
          expect(m.columnOf(id), isNotNull, reason: id);
        }
      },
    );

    test('every preset maps every column of its own signature', () {
      for (final core.ColumnPreset p in kTrackerPresets) {
        final List<String> header = p.fieldByHeader.keys.toList();
        expect(
          core.ColumnPreset.recognise(header, kTrackerPresets),
          same(p),
          reason: '${p.name} is recognised as itself',
        );
        expect(
          p.apply(header, kSubscriptionImportFields).unknownHeaders,
          isEmpty,
          reason: p.name,
        );
        expect(
          kSubscriptionImportFields.map((core.ImportField f) => f.id),
          containsAll(p.fieldByHeader.values),
          reason: '${p.name} names only fields this app has',
        );
      }
    });

    testWidgets('the mapping step names the recognised tracker', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(const <Subscription>[]);
      await _pumpHub(tester, repo);
      final AppLocalizations l10n = await _en();
      await _paste(
        tester,
        'Subscription Name,Cost,Currency,Billing Frequency,Next Bill Date,'
        'Category,Notes\n'
        'Netflix,649,INR,Monthly,2026-11-05,Streaming,family\n',
      );
      expect(find.text(l10n.importMapRecognised('TrackMySubs')), findsOne);
      await _tapKey(tester, E2EKeys.importContinue);
      await _tapKey(tester, E2EKeys.importAdd);
      final Subscription s = repo.rows.single;
      expect(s.name, 'Netflix');
      expect(s.category, 'Streaming');
      expect(s.notes, 'family');
    });
  });

  group('IM-03 · backup and restore', () {
    testWidgets('RED CONTROL · back up 5 rows, delete 2, restore → 5', (
      WidgetTester tester,
    ) async {
      final List<Subscription> five = <Subscription>[
        _row('1', 'Netflix', 64900),
        _row('2', 'Spotify', 11900),
        _row('3', 'Hotstar', 29900),
        _row('4', 'iCloud', 7500),
        _row('5', 'YouTube', 12900),
      ];
      final core.ExportFile backup = subscriptionsBackupFile(
        five,
        now: DateTime.utc(2026, 10, 1),
      );
      expect(backup.fileName, 'subscriptions-backup.json');
      final String json = utf8.decode(backup.bytes);

      // Two deleted since the backup was taken.
      final _MemRepo repo = _MemRepo(five.sublist(0, 3));
      final ProviderContainer c = await _pumpHub(tester, repo);
      final AppLocalizations l10n = await _en();

      c
          .read(importInboxProvider.notifier)
          .deliver(core.ImportedFile(name: 'backup.json', text: json));
      await _settle(tester);

      expect(find.text(l10n.restorePreview(2, 0, 3)), findsOneWidget);
      await _tapKey(tester, E2EKeys.restoreConfirm);
      expect(repo.rows, hasLength(5));
      expect(
        repo.rows.map((Subscription s) => s.name).toSet(),
        five.map((Subscription s) => s.name).toSet(),
      );
      expect(repo.calls, isNot(contains('delete')), reason: 'never deletes');
      expect(find.text(l10n.restoreDone(2)), findsOneWidget);
    });

    testWidgets('a second restore of the same file changes nothing', (
      WidgetTester tester,
    ) async {
      final List<Subscription> two = <Subscription>[
        _row('1', 'Netflix', 64900),
        _row('2', 'Spotify', 11900),
      ];
      final String json = utf8.decode(
        subscriptionsBackupFile(two, now: DateTime.utc(2026, 10, 1)).bytes,
      );
      // The first restore re-keyed Spotify on the server.
      final _MemRepo repo = _MemRepo(<Subscription>[
        two[0],
        _row('srv-9', 'Spotify', 11900),
      ]);
      final ProviderContainer c = await _pumpHub(tester, repo);
      c
          .read(importInboxProvider.notifier)
          .deliver(core.ImportedFile(name: 'backup.json', text: json));
      await _settle(tester);
      await _tapKey(tester, E2EKeys.restoreConfirm);
      expect(repo.rows, hasLength(2), reason: 'Spotify is not added twice');
      expect(repo.calls, isNot(contains('add')));
    });

    testWidgets('another app\'s backup is refused with the reason', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(const <Subscription>[]);
      final ProviderContainer c = await _pumpHub(tester, repo);
      final String other = core.BackupEnvelope(
        appId: 'someotherapp',
        exportedAt: DateTime.utc(2026, 10, 1),
        records: const <Map<String, Object?>>[
          <String, Object?>{'id': '1'},
        ],
      ).encode();
      c
          .read(importInboxProvider.notifier)
          .deliver(core.ImportedFile(name: 'x.json', text: other));
      await _settle(tester);
      expect(find.textContaining('someotherapp'), findsOneWidget);
      expect(find.byKey(E2EKeys.restoreConfirm), findsNothing);
    });
  });

  group('IM-04 · paste a receipt', () {
    testWidgets('RED CONTROL · a ₹ receipt is one candidate, sent nowhere', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(const <Subscription>[]);
      await _pumpHub(tester, repo);
      final AppLocalizations l10n = await _en();

      await _paste(tester, _rupeeReceipt);
      expect(find.text(l10n.importReviewTitle), findsOneWidget);
      expect(
        find.byKey(const ValueKey<String>('import-candidate-1')),
        findsOne,
      );
      expect(find.text('Netflix'), findsOneWidget);
      expect(find.text(l10n.importAddSelected(1)), findsOneWidget);
      expect(
        repo.calls,
        everyElement('fetchAll'),
        reason: 'reading the receipt asked for the list and nothing else',
      );

      await _tapKey(tester, E2EKeys.importAdd);
      final Subscription s = repo.rows.single;
      expect(s.price, const Money(64900, 'INR'));
      expect(s.cycle, BillingCycle.monthly);
      expect(
        s.firstChargeOn,
        DateTime(2026, 9, 12),
        reason: 'the receipt date is the charge it records',
      );
      expect(
        s.nextRenewal.isAfter(DateTime(2026, 9, 12)),
        isTrue,
        reason: 'rolled forward by the cadence to the next renewal',
      );
      expect(repo.calls.where((String c) => c != 'fetchAll'), <String>['add']);
    });
  });

  group('IM-06 · share and drop into import', () {
    testWidgets('RED CONTROL · a dropped CSV opens the mapping step', (
      WidgetTester tester,
    ) async {
      final _MemRepo repo = _MemRepo(const <Subscription>[]);
      final ProviderContainer c = await _pumpHub(tester, repo);
      final AppLocalizations l10n = await _en();
      expect(find.text(l10n.importMapTitle), findsNothing);

      c
          .read(importInboxProvider.notifier)
          .deliver(const core.ImportedFile(name: 'subs.csv', text: _threeRows));
      await _settle(tester);

      expect(find.text(l10n.importMapTitle), findsOneWidget);
      expect(find.text(l10n.importMapRows(3)), findsOneWidget);
      expect(c.read(importInboxProvider), isNull, reason: 'taken once');
    });

    testWidgets('RED CONTROL · a share routes to /import with its text', (
      WidgetTester tester,
    ) async {
      final _FakeShares shares = _FakeShares();
      final GoRouter router = GoRouter(
        routes: <RouteBase>[
          GoRoute(path: '/', builder: (_, _) => const Text('home')),
          GoRoute(path: '/import', builder: (_, _) => const ImportScreen()),
        ],
      );
      addTearDown(router.dispose);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...defaultWidthOverrides(),
          subscriptionRepositoryProvider.overrideWithValue(
            _MemRepo(const <Subscription>[]),
          ),
        ],
      );
      addTearDown(c.dispose);
      final ShareInboxRouter bridge = ShareInboxRouter(
        source: shares,
        deliver: (core.ImportedFile f) =>
            c.read(importInboxProvider.notifier).deliver(f),
        open: router.go,
      );
      addTearDown(bridge.stop);
      await tester.binding.setSurfaceSize(const Size(800, 2400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp.router(
            routerConfig: router,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      await bridge.start();
      await _settle(tester);
      expect(find.text('home'), findsOneWidget);

      shares.share(
        const core.ImportedFile(name: 'shared text', text: _threeRows),
      );
      await _settle(tester);

      expect(
        router.routerDelegate.currentConfiguration.uri.toString(),
        '/import',
      );
      expect(find.text((await _en()).importMapTitle), findsOneWidget);
    });

    test(
      'the Android channel reads a shared text map; silent elsewhere',
      () async {
        TestWidgetsFlutterBinding.ensureInitialized();
        final MethodChannelSharedImportSource off =
            MethodChannelSharedImportSource(enabled: false);
        expect(await off.initial(), isNull);
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(kShareChannel, (MethodCall call) async {
              return call.method == 'initial'
                  ? <String, String>{'name': 'a.csv', 'text': _threeRows}
                  : null;
            });
        addTearDown(
          () => TestDefaultBinaryMessengerBinding
              .instance
              .defaultBinaryMessenger
              .setMockMethodCallHandler(kShareChannel, null),
        );
        final core.ImportedFile? f = await MethodChannelSharedImportSource(
          enabled: true,
        ).initial();
        expect(f?.name, 'a.csv');
        expect(f?.kind, core.ImportInputKind.csv);
      },
    );
  });

  group('IM-01 · the three ways in open /import', () {
    Future<GoRouter> pumpRouted(
      WidgetTester tester,
      Widget start, {
      List<Override> overrides = const <Override>[],
    }) async {
      await tester.binding.setSurfaceSize(const Size(800, 3000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final GoRouter router = GoRouter(
        routes: <RouteBase>[
          GoRoute(path: '/', builder: (_, _) => start),
          GoRoute(
            path: '/import',
            builder: (_, _) => const Scaffold(body: Text('import-route')),
          ),
        ],
      );
      addTearDown(router.dispose);
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[...defaultWidthOverrides(), ...overrides],
          child: MaterialApp.router(
            routerConfig: router,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
          ),
        ),
      );
      for (int i = 0; i < 12; i++) {
        await tester.pump();
      }
      return router;
    }

    testWidgets('Home\'s empty state', (WidgetTester tester) async {
      await pumpRouted(
        tester,
        const HomeScreen(),
        overrides: <Override>[
          subscriptionRepositoryProvider.overrideWithValue(
            _MemRepo(const <Subscription>[]),
          ),
        ],
      );
      await tester.tap(find.byKey(E2EKeys.homeImport));
      await tester.pumpAndSettle();
      expect(find.text('import-route'), findsOneWidget);
    });

    testWidgets('Settings › Your data', (WidgetTester tester) async {
      await pumpRouted(tester, const SettingsScreen());
      await tester.ensureVisible(find.byKey(E2EKeys.settingsImport));
      await tester.tap(find.byKey(E2EKeys.settingsImport));
      await tester.pumpAndSettle();
      expect(find.text('import-route'), findsOneWidget);
    });

    testWidgets('Settings › Restore from backup', (WidgetTester tester) async {
      await pumpRouted(tester, const SettingsScreen());
      await tester.ensureVisible(find.byKey(E2EKeys.settingsRestore));
      await tester.tap(find.byKey(E2EKeys.settingsRestore));
      await tester.pumpAndSettle();
      expect(find.text('import-route'), findsOneWidget);
    });

    testWidgets('the add sheet\'s "Import instead"', (
      WidgetTester tester,
    ) async {
      await pumpRouted(
        tester,
        Scaffold(
          body: Builder(
            builder: (BuildContext context) => TextButton(
              onPressed: () => showAddSubscriptionSheet(context),
              child: const Text('open'),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.byKey(E2EKeys.addImportInstead));
      await tester.tap(find.byKey(E2EKeys.addImportInstead));
      await tester.pumpAndSettle();
      expect(find.text('import-route'), findsOneWidget);
    });
  });

  group('IM-08 · export says what happened', () {
    Future<void> tapExport(
      WidgetTester tester,
      core.FileExporter exporter, {
      List<Override> overrides = const <Override>[],
    }) async {
      await pumpAt(
        tester,
        const Size(800, 3000),
        const Scaffold(body: SettingsScreen()),
        overrides: <Override>[
          fileExporterProvider.overrideWithValue(exporter),
          ...overrides,
        ],
      );
      final AppLocalizations l10n = await _en();
      final Finder row = find.text(l10n.exportDataCsv);
      await tester.ensureVisible(row);
      await tester.tap(row);
      for (int i = 0; i < 8; i++) {
        await tester.pump();
      }
    }

    testWidgets('RED CONTROL · a failed exporter shows the failure sentence', (
      WidgetTester tester,
    ) async {
      await tapExport(tester, _Exporter(core.ExportOutcome.failed));
      expect(find.text((await _en()).exportFailed), findsOneWidget);
    });

    testWidgets('a dismissed share sheet says nothing was saved', (
      WidgetTester tester,
    ) async {
      await tapExport(tester, _Exporter(core.ExportOutcome.dismissed));
      expect(find.text((await _en()).exportDismissed), findsOneWidget);
    });

    testWidgets('an export that worked says so', (WidgetTester tester) async {
      await tapExport(tester, _Exporter(core.ExportOutcome.exported));
      expect(find.text((await _en()).exportDone), findsOneWidget);
    });

    testWidgets('a list that did not load says so, and exports nothing', (
      WidgetTester tester,
    ) async {
      final _Exporter exporter = _Exporter(core.ExportOutcome.exported);
      await tapExport(
        tester,
        exporter,
        overrides: <Override>[
          subscriptionRepositoryProvider.overrideWithValue(_FailingRepo()),
        ],
      );
      expect(find.text((await _en()).exportListFailed), findsOneWidget);
      expect(exporter.files, isEmpty);
    });

    testWidgets('"Back up (JSON)" hands a backup envelope to the exporter', (
      WidgetTester tester,
    ) async {
      final _Exporter exporter = _Exporter(core.ExportOutcome.exported);
      await pumpAt(
        tester,
        const Size(800, 3000),
        const Scaffold(body: SettingsScreen()),
        overrides: <Override>[fileExporterProvider.overrideWithValue(exporter)],
      );
      await tester.ensureVisible(find.byKey(E2EKeys.settingsBackup));
      await tester.tap(find.byKey(E2EKeys.settingsBackup));
      for (int i = 0; i < 8; i++) {
        await tester.pump();
      }
      final core.ExportFile f = exporter.files.single;
      expect(f.mimeType, 'application/json');
      final core.Result<core.BackupEnvelope> r = core.BackupEnvelope.decode(
        utf8.decode(f.bytes),
      );
      expect(r, isA<core.Ok<core.BackupEnvelope>>());
      expect((r as core.Ok<core.BackupEnvelope>).value.appId, kBackupAppId);
    });
  });
}

class _Exporter implements core.FileExporter {
  _Exporter(this.outcome);
  final core.ExportOutcome outcome;
  final List<core.ExportFile> files = <core.ExportFile>[];

  @override
  Future<core.ExportOutcome> export(core.ExportFile file) async {
    files.add(file);
    return outcome;
  }
}

class _FailingRepo extends SubscriptionRepository {
  _FailingRepo() : super(SeedApiClient());

  @override
  Future<List<Subscription>> fetchAll() async => throw StateError('offline');
}

class _FakeShares implements SharedImportSource {
  final StreamController<core.ImportedFile> _c =
      StreamController<core.ImportedFile>.broadcast();

  void share(core.ImportedFile f) => _c.add(f);

  @override
  Stream<core.ImportedFile> get arrivals => _c.stream;

  @override
  Future<core.ImportedFile?> initial() async => null;
}
