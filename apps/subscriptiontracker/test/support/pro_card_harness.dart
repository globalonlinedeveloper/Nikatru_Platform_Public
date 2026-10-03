// The Pro "plan and save" card (forecast_card.dart) pumped UNLOCKED, with its
// two outside reads — the spend history and the file exporter — overridden.
// Shared by the ST-P5 / ST-P6 red controls (month_report_test, spend_trend_test,
// set_aside_test).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show ExportFile, ExportOutcome, FileExporter;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/insights/forecast_card.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// Keeps every file it is handed, and answers [outcome].
class KeepingExporter implements FileExporter {
  KeepingExporter({this.outcome = ExportOutcome.exported});

  final ExportOutcome outcome;
  final List<ExportFile> files = <ExportFile>[];

  @override
  Future<ExportOutcome> export(ExportFile file) async {
    files.add(file);
    return outcome;
  }
}

Future<void> pumpProCard(
  WidgetTester tester,
  List<Subscription> subs, {
  SpendHistory? history,
  KeepingExporter? exporter,
  String currencyCode = 'INR',
}) async {
  tester.view.physicalSize = const Size(800, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        paywallLockedProvider.overrideWithValue(false),
        spendHistoryProvider.overrideWith((Ref ref) async => history),
        fileExporterProvider.overrideWithValue(exporter ?? KeepingExporter()),
      ],
      child: MaterialApp(
        theme: buildAppTheme(
          seed: const Color(0xFF6459F5),
          brightness: Brightness.light,
        ),
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SingleChildScrollView(
            child: ForecastCard(
              subs: subs,
              money: MoneyFormatter('en', emptyCurrencyCode: currencyCode),
              currencyCode: currencyCode,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
