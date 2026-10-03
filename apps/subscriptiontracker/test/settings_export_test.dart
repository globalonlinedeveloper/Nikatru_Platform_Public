// 🔴 ST-X1 (audit D2, D31, F35) — THE EXPORT ROW SAVES A REAL FILE.
//
// `data-safety.json` has long declared that a user can export their data, and
// the only surface that said so was a settings row with `onTap: null`: tapping
// it did nothing, and no test anywhere referenced it. This pumps the REAL
// SettingsScreen with a fake exporter that keeps the bytes, taps the row, and
// parses the file the user would receive back into cells.
//
// RED ON main (e0beeb14): the row has no onTap, so the exporter is never
// called and `exporter.files` is empty.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/integrity/device_integrity_gate.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/portability/subscription_columns.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/width_harness.dart';

class _KeepingExporter implements core.FileExporter {
  final List<core.ExportFile> files = <core.ExportFile>[];

  @override
  Future<core.ExportOutcome> export(core.ExportFile file) async {
    files.add(file);
    return core.ExportOutcome.exported;
  }
}

class _FixedRepository extends SubscriptionRepository {
  _FixedRepository(this._subs) : super(SeedApiClient());
  final List<Subscription> _subs;

  @override
  Future<List<Subscription>> fetchAll() async => _subs;
}

/// A rupee row whose name carries a comma AND quotes — the two characters a
/// naive writer breaks on — and a row whose name is a spreadsheet formula.
final List<Subscription> _subs = <Subscription>[
  Subscription(
    id: 'sub-1',
    name: 'Netflix, "Premium"',
    category: 'Streaming',
    price: const Money(64900, 'INR'),
    cycle: BillingCycle.monthly,
    nextRenewal: DateTime(2026, 10, 5),
    plan: 'Premium',
  ),
  Subscription(
    id: 'sub-2',
    name: '=cmd',
    category: 'Other',
    price: const Money(999, 'USD'),
    cycle: BillingCycle.yearly,
    nextRenewal: DateTime(2027, 1, 31),
    unused: true,
  ),
];

Future<_KeepingExporter> _pumpAndTap(
  WidgetTester tester, {
  List<Override> overrides = const <Override>[],
}) async {
  final _KeepingExporter exporter = _KeepingExporter();
  await pumpAt(
    tester,
    const Size(800, 3000),
    const SettingsScreen(),
    overrides: <Override>[
      subscriptionRepositoryProvider.overrideWithValue(_FixedRepository(_subs)),
      fileExporterProvider.overrideWithValue(exporter),
      ...overrides,
    ],
  );
  final AppLocalizations l10n = AppLocalizations.of(
    tester.element(find.byType(SettingsScreen)),
  );
  final Finder row = find.text(l10n.exportDataCsv);
  expect(row, findsOneWidget, reason: 'the export row must be on the screen');
  await tester.ensureVisible(row);
  await tester.tap(row);
  for (int i = 0; i < 6; i++) {
    await tester.pump();
  }
  return exporter;
}

void main() {
  testWidgets('🔴 tapping "Export data (CSV)" hands a CSV of the loaded list '
      'to the exporter, and it parses back', (WidgetTester tester) async {
    final _KeepingExporter exporter = await _pumpAndTap(tester);

    expect(
      exporter.files,
      hasLength(1),
      reason: 'the row was tapped and nothing was exported — onTap is null',
    );
    final core.ExportFile file = exporter.files.single;
    expect(file.fileName, 'subscriptions.csv');
    expect(file.mimeType, 'text/csv');
    expect(file.bytes.take(3).toList(), <int>[
      0xEF,
      0xBB,
      0xBF,
    ], reason: 'a UTF-8 BOM, or Excel reads ₹ and Tamil as mojibake');
    final String text = utf8.decode(file.bytes);
    expect(text, contains('\r\n'), reason: 'RFC 4180 records end in CRLF');

    final core.CsvTable table = const core.CsvReader().read(text);
    expect(table.header, kSubscriptionCsvHeader);
    expect(table.rows, hasLength(2), reason: 'both rows, neither dropped');

    final Map<String, String> netflix = Map<String, String>.fromIterables(
      table.header,
      table.rows[0],
    );
    expect(
      netflix['name'],
      'Netflix, "Premium"',
      reason: 'the comma and the quotes survive as ONE cell',
    );
    expect(netflix['price'], '649.00', reason: 'decimal major units');
    expect(netflix['currency'], 'INR', reason: 'an ISO-4217 code, not ₹');
    expect(netflix['cycle'], 'monthly');
    expect(netflix['next_renewal'], '2026-10-05');
    expect(text, isNot(contains('₹')), reason: 'never a formatted symbol');

    final Map<String, String> formula = Map<String, String>.fromIterables(
      table.header,
      table.rows[1],
    );
    expect(
      formula['name'],
      "'=cmd",
      reason:
          'a cell opening with = is a formula to a spreadsheet; the '
          'leading apostrophe makes it text (CSV injection)',
    );
    expect(formula['price'], '9.99');
    expect(formula['currency'], 'USD');
    expect(formula['unused'], 'true');
  });

  testWidgets('with features.exports OFF the row stays and exports nothing', (
    WidgetTester tester,
  ) async {
    final _KeepingExporter exporter = await _pumpAndTap(
      tester,
      overrides: <Override>[
        appConfigProvider.overrideWith(
          (_) async => kAppDefaultConfig.copyWith(
            features: <String, bool>{
              ...kAppDefaultConfig.features,
              'exports': false,
            },
          ),
        ),
      ],
    );
    expect(exporter.files, isEmpty);
  });

  test('ST-X2 · this app\'s own export reads straight back in: every column '
      'maps or is kept, and every row is a duplicate of the list it came '
      'from', () {
    final String text = utf8.decode(subscriptionsCsvFile(_subs).bytes);
    final core.CsvTable table = const core.CsvReader().read(text);
    final core.ColumnMapping mapping = core.ColumnMapping.infer(
      table.header,
      kSubscriptionImportFields,
    );
    expect(mapping.unknownHeaders, <String>[
      'id',
      'glyph',
      'used_pct',
      'usage_note',
      'unused',
      // ⏱ 2026-09-29 · ST-T3b: the ADR no.077 §5 columns the import engine
      // does not model yet (`notes` it does) — kept and listed, like the rest.
      'cycle_every',
      'cycle_unit',
      'status',
      'first_charge_on',
      'trial_ends_on',
      'cancelled_on',
      'deleted_at',
      'cancel_url',
      // ⏱ 2026-10-01 · T20 (AD-12): the tags cell — kept and listed too.
      'tags',
      // ⏱ 2026-10-01 · train T11: 0010's three, kept and listed the same way.
      'price_after_trial_minor',
      'still_using',
      'still_using_at',
    ], reason: 'kept and listed, never dropped');
    final core.ImportPlan plan = core.ImportPlan.build(
      table,
      mapping,
      fields: kSubscriptionImportFields,
      keyOf: subscriptionImportKey,
      existingKeys: _subs.map(subscriptionExistingKey),
    );
    expect(plan.questions, isEmpty, reason: 'ISO dates leave nothing to ask');
    expect(plan.errors, isEmpty);
    expect(plan.candidates, isEmpty, reason: 'nothing new in our own export');
    expect(plan.duplicates, hasLength(2));
    expect(plan.accountedFor, plan.rowCount);
  });

  test('the header main already ships keeps its order: new columns are '
      'appended, never inserted', () {
    expect(
      kSubscriptionCsvHeader.take(22),
      <String>[
        'id',
        'name',
        'category',
        'price',
        'currency',
        'cycle',
        'next_renewal',
        'plan',
        'glyph',
        'used_pct',
        'usage_note',
        'unused',
        'cycle_every',
        'cycle_unit',
        'status',
        'first_charge_on',
        'trial_ends_on',
        'cancelled_on',
        'deleted_at',
        'notes',
        'cancel_url',
        'tags',
      ],
      reason:
          'a column an earlier export had never moves; new columns are '
          'appended',
    );
  });

  test('the column map covers every field of Subscription', () {
    // `price_minor` is the same amount as `price`; the file carries it once,
    // as major units beside its currency code.
    // A row from an API that serves `price_after_trial_minor` (0010): T9's
    // capability gate leaves the key off `toJson` for one that does not.
    final Set<String> fields = Subscription.fromJson(<String, dynamic>{
      ..._subs.first.toJson(),
      'price_after_trial_minor': null,
    }).toJson().keys.toSet()..remove('price_minor');
    expect(kSubscriptionCsvHeader.toSet(), fields);
    expect(kSubscriptionCsvHeader, hasLength(fields.length));
  });

  // ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — ON A ROOTED DEVICE THE EXPORT
  // ASKS THE SIGNED-IN USER TO RE-AUTHENTICATE FIRST, and a cancel exports
  // nothing. The clean-device path is every case above: no prompt at all.
  group('a rooted device', () {
    late core.IntegritySession before;
    setUp(() {
      before = DeviceIntegrityScope.session;
      DeviceIntegrityScope.session = core.IntegritySession(
        const core.DeviceIntegrity(
          root: core.RootReport(core.RootStatus.rooted, <core.RootSignal>{
            core.RootSignal.suBinary,
          }),
          signer: core.SignerVerdict.verified,
        ),
      );
    });
    tearDown(() => DeviceIntegrityScope.session = before);

    Future<(_KeepingExporter, _CountingAuth)> tapSignedIn(
      WidgetTester tester,
    ) async {
      final _CountingAuth auth = _CountingAuth();
      await auth.signInWithEmail(email: 'a@example.test', password: 'pw');
      auth.attempts = 0;
      final _KeepingExporter exporter = await _pumpAndTap(
        tester,
        overrides: <Override>[authRepositoryProvider.overrideWithValue(auth)],
      );
      await tester.pumpAndSettle();
      return (exporter, auth);
    }

    testWidgets('cancelling the re-auth exports nothing', (
      WidgetTester tester,
    ) async {
      final (_KeepingExporter exporter, _CountingAuth auth) = await tapSignedIn(
        tester,
      );
      expect(find.byKey(ReauthDialog.passwordField), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(exporter.files, isEmpty);
      expect(auth.attempts, 0);
    });

    testWidgets('re-authenticating exports the file', (
      WidgetTester tester,
    ) async {
      final (_KeepingExporter exporter, _CountingAuth auth) = await tapSignedIn(
        tester,
      );
      expect(find.byKey(ReauthDialog.passwordField), findsOneWidget);
      await tester.enterText(find.byKey(ReauthDialog.passwordField), 'pw');
      await tester.tap(find.byKey(ReauthDialog.confirmButton));
      await tester.pumpAndSettle();
      expect(auth.attempts, 1);
      expect(exporter.files, hasLength(1));
    });
  });
}

/// The mock, counting re-authentications.
class _CountingAuth extends MockAuthRepository {
  int attempts = 0;

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) {
    attempts++;
    return super.signInWithEmail(
      email: email,
      password: password,
      captchaToken: captchaToken,
    );
  }
}
