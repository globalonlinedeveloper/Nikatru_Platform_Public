// ─────────────────────────────────────────────────────────────────────────────
// ST-U8 — NAVIGATION SLIPS: A TAP GOES WHERE IT SAYS, AND "KEEP IT" KEEPS YOU.
//
// The audit (Private/research/session-2026-09-23/full-review-r2/
// product-audit-st.md §7.2) measured:
//   · B15 — "Keep it" (or a swipe) on the remove sheet still dismissed the
//     detail screen underneath, because `showCancelSheet` returned `void` and
//     the caller dismissed after EVERY close.
//   · B49 — /scan's result rows could not be opened, unlike every other list
//     of the same rows.
//   · C16 — a "Netflix renews in 2 days" notification card was a dead end.
//
// RED CONTROLS: make `showCancelSheet` report true unconditionally; drop the
// scan row's `onTap`; drop the card's `FocusableTap` — each case is red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/cancel/cancel_sheet.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/features/scan/scan_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

Subscription _sub(String id, DateTime renews) => Subscription(
  id: id,
  name: 'Renews Soon $id',
  category: 'Video',
  price: const Money(999, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: renews,
);

class _Fixed implements SubscriptionRepository {
  _Fixed(this._subs);
  final List<Subscription> _subs;

  @override
  Future<List<Subscription>> fetchAll() async => _subs;

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// [start] under a real router that also knows `/sub/:id`, so a push to the
/// detail is observable as the placeholder it lands on.
Future<void> _pumpRouted(
  WidgetTester tester,
  Widget start, {
  List<Override> overrides = const <Override>[],
}) async {
  await tester.binding.setSurfaceSize(kPhone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final GoRouter router = GoRouter(
    routes: <RouteBase>[
      GoRoute(path: '/', builder: (_, _) => start),
      GoRoute(
        path: '/sub/:id',
        builder: (_, GoRouterState s) =>
            Scaffold(body: Text('detail:${s.pathParameters['id']}')),
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
}

void main() {
  group('B15 · the remove sheet reports whether anything was removed', () {
    Future<List<bool>> open(WidgetTester tester) async {
      final List<bool> results = <bool>[];
      await setSurface(tester, kPhone);
      await tester.pumpWidget(
        ProviderScope(
          overrides: defaultWidthOverrides(),
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Builder(
                builder: (BuildContext context) => Center(
                  child: TextButton(
                    onPressed: () async => results.add(
                      await showCancelSheet(
                        context,
                        _sub('1', DateTime.utc(2026, 10, 1)),
                      ),
                    ),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      return results;
    }

    testWidgets('"Keep it" reports false, so the detail stays open', (
      WidgetTester tester,
    ) async {
      final List<bool> results = await open(tester);
      await tester.tap(find.text((await _en()).keepPlan));
      await tester.pumpAndSettle();
      expect(results, <bool>[false]);
    });

    testWidgets('a completed removal reports true', (
      WidgetTester tester,
    ) async {
      final List<bool> results = await open(tester);
      final AppLocalizations l10n = await _en();
      await tester.tap(find.text(l10n.confirmCancel));
      await tester.pumpAndSettle();
      expect(find.text(l10n.cancelledHeading), findsOneWidget);
      await tester.tap(find.text(l10n.done));
      await tester.pumpAndSettle();
      expect(results, <bool>[true]);
    });
  });

  testWidgets('B49 · a scan result row opens its detail', (
    WidgetTester tester,
  ) async {
    await _pumpRouted(
      tester,
      const ScanScreen(),
      overrides: <Override>[
        subscriptionRepositoryProvider.overrideWithValue(
          _Fixed(<Subscription>[_sub('42', DateTime.utc(2026, 11, 1))]),
        ),
      ],
    );
    // Past the 560 ms dwell of every step; see width_scan_test.dart.
    for (int i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 560));
    }
    await tester.tap(find.text('Renews Soon 42'));
    await tester.pumpAndSettle();
    expect(find.text('detail:42'), findsOneWidget);
  });

  testWidgets('C16 · a renewal card opens the subscription it is about', (
    WidgetTester tester,
  ) async {
    final DateTime soon = DateTime.now().add(const Duration(days: 2));
    await _pumpRouted(
      tester,
      const NotificationsScreen(),
      overrides: <Override>[
        subscriptionRepositoryProvider.overrideWithValue(
          _Fixed(<Subscription>[_sub('7', soon)]),
        ),
      ],
    );
    await tester.tap(find.textContaining('Renews Soon 7').first);
    await tester.pumpAndSettle();
    expect(find.text('detail:7'), findsOneWidget);
  });
}
