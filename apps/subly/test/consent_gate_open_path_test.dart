import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/features/consent/consent_prompt.dart';
import 'package:subly/state/analytics_providers.dart';
import 'package:subly/state/providers.dart';

/// [pipeline C-6] THE OPEN-PATH WIDGET TEST.
///
/// consent_open_path_test.dart proves the decision path works WHEN CALLED; this
/// file proves the decision path can actually be REACHED. That gap is exactly
/// how the last defect shipped: ConsentGate is installed via
/// `MaterialApp.router`'s `builder`, which sits ABOVE the router's Navigator,
/// so `showDialog` from the gate's own context threw "no Navigator" — silently,
/// from an unawaited post-frame future with `_asked` already latched — and the
/// DPDP prompt never appeared in any backend-live build while every logic test
/// stayed green. These tests pump the EXACT production structure (router with
/// [rootNavigatorKey] + builder-wrapped gate, live flag on) and go red if the
/// dialog cannot render or a tap stops recording.
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

/// The production wiring from app.dart, minus the app's screens: a router
/// anchored on the real [rootNavigatorKey], with ConsentGate above it in the
/// `builder` — the structure that made `showDialog` throw before the fix.
Widget _app({required core.KeyValueStore store, bool live = true}) {
  final GoRouter router = GoRouter(
    navigatorKey: rootNavigatorKey,
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (_, __) => const Scaffold(body: Text('HOME')),
      ),
    ],
  );
  return ProviderScope(
    overrides: <Override>[
          onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      backendLiveProvider.overrideWithValue(live),
      keyValueStoreProvider.overrideWith((ref) async => store),
    ],
    child: MaterialApp.router(
      // P2.6b: home reads l10n now; a host without delegates throws on the
      // first frame that renders it (nullable-getter: false).
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: router,
      builder: (BuildContext context, Widget? child) =>
          ConsentGate(child: child ?? const SizedBox.shrink()),
    ),
  );
}

Future<core.ConsentStatus> _persistedStatus(core.KeyValueStore store) =>
    core.ConsentController(store: store).hydrate(core.ConsentPurpose.analytics);

/// P2.6a: the union router's onboarding gate DECLINES TO DECIDE while the
/// seen-flag is still hydrating (null) and sends seen=false to /onboarding —
/// so a router test that never answers the question stalls before its first
/// real frame. Predicted by the re-stamp red-team pass, observed here.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

void main() {
  testWidgets(
    'the consent dialog ACTUALLY APPEARS above the router Navigator',
    (WidgetTester tester) async {
      final _MemStore store = _MemStore();
      await tester.pumpWidget(_app(store: store));
      // pump() with no duration does not run timers; settle covers the async
      // provider resolution AND the post-frame showDialog.
      await tester.pumpAndSettle();

      expect(
        find.byType(AlertDialog),
        findsOneWidget,
        reason:
            'a live build with no decision on disk must ask — this was '
            'the unreachable DPDP prompt',
      );
      expect(find.text('Allow'), findsOneWidget);
      expect(find.text('No thanks'), findsOneWidget);
      // The app itself still rendered underneath.
      expect(find.text('HOME'), findsOneWidget);
    },
  );

  testWidgets(
    'tapping Allow records a granted decision and dismisses the dialog',
    (WidgetTester tester) async {
      final _MemStore store = _MemStore();
      await tester.pumpWidget(_app(store: store));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Allow'));
      await tester.pumpAndSettle();

      expect(find.byType(AlertDialog), findsNothing);
      // A fresh controller over the same store == the next app launch: the
      // tap must have produced a persisted decision, not just closed a modal.
      expect(await _persistedStatus(store), core.ConsentStatus.granted);
    },
  );

  testWidgets('tapping No thanks records a denial, not nothing', (
    WidgetTester tester,
  ) async {
    final _MemStore store = _MemStore();
    await tester.pumpWidget(_app(store: store));
    await tester.pumpAndSettle();

    await tester.tap(find.text('No thanks'));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    // Denied is an ANSWER (never re-ask); unknown would re-prompt forever.
    expect(await _persistedStatus(store), core.ConsentStatus.denied);
  });

  testWidgets('an already-decided install is never asked again', (
    WidgetTester tester,
  ) async {
    final _MemStore store = _MemStore();
    await core.ConsentController(store: store).record(
      core.ConsentPurpose.analytics,
      granted: true,
      policyVersion: kPrivacyPolicyVersion,
      anonId: 'install-abc',
      now: DateTime.utc(2026, 8, 1),
      appVersion: 'test',
      platform: 'test',
    );

    await tester.pumpWidget(_app(store: store));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
  });

  testWidgets('demo/test builds (backend not live) are never prompted', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_app(store: _MemStore(), live: false));
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
  });
}
