import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/shell/sync_problems_strip.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

// Review #1075 finding 9 / the lead's dead-letter state: a change the server
// refused is SHOWN, with Retry and Discard, and the shell is untouched while
// there is none.

OutboxEntry _dead(String id) => OutboxEntry(
  id: id,
  owner: 'user-a',
  recordId: id,
  op: OutboxOp.create,
  kind: 'subscription',
  body: const <String, dynamic>{'name': 'Gym'},
  queuedAt: DateTime.utc(2026, 9, 30),
  dead: true,
);

Future<void> _pump(WidgetTester tester, List<OutboxEntry> problems) =>
    tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          syncProblemsProvider.overrideWith((Ref ref) async => problems),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SyncProblemsStrip(child: Text('the shell'))),
        ),
      ),
    );

void main() {
  testWidgets('a dead letter is shown with Retry and Discard', (
    WidgetTester tester,
  ) async {
    await _pump(tester, <OutboxEntry>[_dead('k1')]);
    await tester.pumpAndSettle();
    expect(find.byType(DecisionStrip), findsOneWidget);
    expect(find.text("A change couldn't sync"), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('Discard'), findsOneWidget);
    expect(find.text('the shell'), findsOneWidget);
  });

  testWidgets('with nothing stuck the shell is the bare child', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const <OutboxEntry>[]);
    await tester.pumpAndSettle();
    expect(find.byType(DecisionStrip), findsNothing);
    expect(find.text('the shell'), findsOneWidget);
  });

  testWidgets('a queue that cannot be read is shown, with Retry', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          syncProblemsProvider.overrideWith(
            (Ref ref) async =>
                throw const OutboxStoreFailure('storage unavailable'),
          ),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: SyncProblemsStrip(child: Text('the shell'))),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(DecisionStrip), findsOneWidget);
    expect(
      find.text(
        'Your offline changes could not be read on this device. They are kept; '
        'try again.',
      ),
      findsOneWidget,
    );
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('the shell'), findsOneWidget);
  });
}
