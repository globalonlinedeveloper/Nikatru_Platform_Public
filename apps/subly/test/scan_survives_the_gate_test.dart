// ─────────────────────────────────────────────────────────────────────────────
// DOES `/scan` SURVIVE THE RE-ACCEPTANCE GATE WHEN THE GATE IS REALLY CLOSED?
//
// 🔴 WHY THIS FILE EXISTS AND legal_gates_test.dart DOES NOT ALREADY ANSWER IT.
// That file has the assertion that looks like this one —
// `_settleAt(c, '/reaccept-terms?next=%2Fscan') == '/scan'` at its
// "a satisfied gate returns the user to where they were going" group — but it
// builds its container with `_container(...)`, whose `reacceptNeeded` defaults
// to `false`. So the gate is switched OFF and the router is handed a URL that
// already carries the banked destination. It proves the EXIT LINE
// (`_nextOr(state, '/home')`), which is a real thing to prove, and it proves
// nothing at all about the two steps before it:
//   · does asking for `/scan` while the gate is CLOSED bank `?next=/scan`, or
//     does `_gateWithNext` drop it?
//   · does SATISFYING the gate by the route a user actually takes — ticking the
//     box and pressing the button — put them on `/scan`?
//
// That is the journey the e2e walk takes, and step 03 of the nightly has failed
// on it three times (runs against `feat/e2e-login-via-magic-link`). The suite
// signs in with a single-use magic-link token instead of the login form, so
// `LoginScreen._submit`'s `context.go('/scan')` — the ONLY caller of that route
// in the tree — never runs, and the harness stands in for it. Whether that
// stand-in works is a router question, and a router question belongs here where
// the answer takes two seconds, not in a 20-minute CI dispatch.
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
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

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
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'asking for /scan while the gate is CLOSED banks it as ?next=',
    (WidgetTester tester) async {
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

      // The harness's stand-in for `LoginScreen._submit`'s `context.go('/scan')`.
      c.read(routerProvider).go('/scan');
      await tester.pumpAndSettle();

      expect(
        _where(c),
        '/reaccept-terms?next=%2Fscan',
        reason:
            'the FIRST of the two steps the existing test skips: the gate must '
            'BANK the destination rather than merely blocking it. A bare '
            '/reaccept-terms here means `_gateWithNext` dropped it, and the '
            'user is going to /home no matter how the interstitial is cleared',
      );
    },
  );

  testWidgets(
    'and clearing the gate the way a user clears it lands on /scan',
    (WidgetTester tester) async {
      final ProviderContainer c = _gatedContainer();
      addTearDown(c.dispose);
      await _boot(tester, c);

      c.read(routerProvider).go('/scan');
      await tester.pumpAndSettle();

      // 🔴 SATISFIED BY THE REAL SCREEN, NOT BY FLIPPING A PROVIDER. Overriding
      // the provider to `false` would assert the exit line over again; the
      // question is whether the acceptance a user actually performs — tick the
      // box, press the button, the write lands in the store, the provider
      // recomputes, `routerRefreshProvider` re-runs the redirect — arrives at
      // the banked destination. Every one of those hops is a place the `next`
      // can be lost, and only this route exercises them.
      expect(
        find.byKey(LegalConsentFields.termsCheckbox),
        findsOneWidget,
        reason: 'the interstitial must actually be on screen to be cleared',
      );
      await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ReacceptTermsScreen.acceptButton));
      await tester.pumpAndSettle();

      expect(
        _where(c),
        '/scan',
        reason:
            'THE WHOLE QUESTION. The nightly e2e signs in with a magic-link '
            'token, stands in for the form\'s context.go(\'/scan\'), clears '
            'this interstitial and then asserts ScanScreen rendered "Go to '
            'dashboard". Landing on /home here reproduces that red locally, '
            'and is the router/gates.dart:376 regression arriving by a second '
            'route',
      );
    },
  );
}
