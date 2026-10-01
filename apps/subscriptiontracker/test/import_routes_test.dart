// ─────────────────────────────────────────────────────────────────────────────
// `/import` THROUGH THE REAL ROUTER — IM-01 (ADR 077 §2.2).
//
// Was `scan_survives_the_gate_test.dart`. `/scan` is now a redirect onto the
// import hub, so the questions that file asked of `/scan` are asked of
// `/import`, and three are added that only the route change raises:
//   · `/scan` lands on `/import` and its QUERY survives (path-only rewrite);
//   · a SIGNED-OUT `/import` goes to `/sign-in` and BANKS `?next=/import`;
//   · asking for `/import` while the re-acceptance gate is CLOSED banks it,
//     and clearing the gate the way a user clears it lands on `/import`.
//
// ⚠️ THE ASSERTIONS CARRY THE FULL URI, NOT `.uri.path`. `legal_gates_test`'s
// `_settleAt` returns the path alone, which is right for its questions and
// hides the only evidence that matters for this one: a banked `?next=` lives in
// the QUERY, so a run that loses the destination and a run that never banked it
// are the same string under `.path`.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations;
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/features/auth/legal_consent_fields.dart';
import 'package:subscriptiontracker/features/auth/reaccept_terms_screen.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// An in-memory `KeyValueStore`, so nothing here touches SharedPreferences.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);

  @override
  Future<void> remove(String key) async => data.remove(key);

  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// The router declines to decide while the onboarding flag hydrates.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

/// A signed-in, verified session. `extends`, not `implements`, for the reason
/// `legal_gates_test.dart` records: the verification members carry honest
/// default bodies and only `extends` inherits them.
class _Auth extends core.AuthRepository {
  final StreamController<core.AuthUser?> changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'u1', email: 'a@b.test', emailVerified: true);

  @override
  Stream<core.AuthUser?> authStateChanges() => changes.stream;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 🔴 `legalReacceptanceNeededProvider` IS DELIBERATELY NOT OVERRIDDEN. It
/// hydrates from the real `ConsentController` over an empty [_MemStore], which
/// is the fresh-install shape and the shape the e2e's admin-API user is in:
/// nobody has a clickwrap record. Overriding it to `false` is what makes the
/// existing test in `legal_gates_test.dart` unable to see this.
ProviderContainer _gatedContainer() => ProviderContainer(
  overrides: <Override>[
    onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
    authRepositoryProvider.overrideWithValue(_Auth()),
    keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
    analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
  ],
);

/// The router's CURRENT location, query included.
String _where(ProviderContainer c) =>
    c.read(routerProvider).routerDelegate.currentConfiguration.uri.toString();

Future<void> _boot(WidgetTester tester, ProviderContainer c) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// A signed-OUT visitor: no session.
class _SignedOut extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The gate OPEN (acceptance recorded), so a route question is only a route
/// question.
ProviderContainer _openContainer({core.AuthRepository? auth}) =>
    ProviderContainer(
      overrides: <Override>[
        onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
        authRepositoryProvider.overrideWithValue(auth ?? _Auth()),
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        legalReacceptanceNeededProvider.overrideWithValue(false),
      ],
    );

void main() {
  testWidgets('RED CONTROL · /scan is a redirect onto /import, query kept', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _openContainer();
    addTearDown(c.dispose);
    await _boot(tester, c);

    c.read(routerProvider).go('/scan?ref=mail');
    await tester.pumpAndSettle();

    expect(
      _where(c),
      '/import?ref=mail',
      reason:
          'ADR 077 §2.2: the timed loader is gone and its URL rewrites onto '
          'the import hub, path only — a bare `/import` here means the '
          'redirect returned a literal and ate the query',
    );
    expect(find.byType(ImportScreen), findsOneWidget);
  });

  testWidgets('/IMPORT in any case is the import hub', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _openContainer();
    addTearDown(c.dispose);
    await _boot(tester, c);

    c.read(routerProvider).go('/IMPORT');
    await tester.pumpAndSettle();
    expect(find.byType(ImportScreen), findsOneWidget);
  });

  testWidgets('RED CONTROL · a signed-OUT /import goes to sign-in with next', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _openContainer(auth: _SignedOut());
    addTearDown(c.dispose);
    await _boot(tester, c);

    c.read(routerProvider).go('/import');
    await tester.pumpAndSettle();

    expect(
      _where(c),
      '/sign-in?next=%2Fimport',
      reason:
          'the hub writes rows through the add route, so it is not on the '
          'signed-out allowlist (`/scan` was); and the place the visitor asked '
          'for is BANKED, so signing in brings them back to it',
    );
    expect(find.byType(ImportScreen), findsNothing);
  });

  testWidgets('asking for /import while the gate is CLOSED banks it as ?next=', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _gatedContainer();
    addTearDown(c.dispose);
    await _boot(tester, c);

    expect(
      c.read(legalReacceptanceNeededProvider),
      isTrue,
      reason:
          'the premise: an empty store means no clickwrap record, which is '
          'exactly the state the e2e admin-API user is in. If this is false '
          'the rest of the file is asserting against a gate that never fired',
    );

    c.read(routerProvider).go('/import');
    await tester.pumpAndSettle();

    expect(
      _where(c),
      '/reaccept-terms?next=%2Fimport',
      reason:
          'the gate must BANK the destination rather than merely blocking it. '
          'A bare /reaccept-terms here means `_gateWithNext` dropped it, and '
          'the user is going to /home no matter how the interstitial is cleared',
    );
  });

  testWidgets(
    'and clearing the gate the way a user clears it lands on /import',
    (WidgetTester tester) async {
      final ProviderContainer c = _gatedContainer();
      addTearDown(c.dispose);
      await _boot(tester, c);

      c.read(routerProvider).go('/import');
      await tester.pumpAndSettle();

      // 🔴 SATISFIED BY THE REAL SCREEN, NOT BY FLIPPING A PROVIDER: tick the
      // box, press the button, the write lands in the store, the provider
      // recomputes, `routerRefreshProvider` re-runs the redirect. Every one of
      // those hops is a place the `next` can be lost.
      expect(
        find.byKey(LegalConsentFields.termsCheckbox),
        findsOneWidget,
        reason: 'the interstitial must actually be on screen to be cleared',
      );
      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ReacceptTermsScreen.acceptButton));
      await tester.pumpAndSettle();

      expect(_where(c), '/import');
      // The URL moves on the redirect; the page swap lands a frame later, after
      // the acceptance write's own settle. MEASURED: with the bare
      // `pumpAndSettle` above, the interstitial is still the page on screen.
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.byType(ImportScreen), findsOneWidget);
    },
  );
}
