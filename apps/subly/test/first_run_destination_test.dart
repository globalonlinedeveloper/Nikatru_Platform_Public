// ─────────────────────────────────────────────────────────────────────────────
// WHERE A FRESH INSTALL ACTUALLY LANDS — asserted after a settle, at the
// viewport the Play capture lane photographs.
//
// 🔴 THE OUTAGE THIS EXISTS FOR (run 32947223120, 2026-08-26). The Play
// screenshot lane failed on the phone viewport (360x640@3) with:
//
//     Expected: exactly one matching candidate
//       Actual: _TextWidgetFinder:<Found 0 widgets with text "Welcome back">
//
// and the login title was NOT missing. The DPDP analytics-consent prompt was
// sitting over the onboarding carousel absorbing the tap on Skip, so the app
// never left `/onboarding` and the login form was never built. The capture
// suite was supposed to answer that prompt and did not, because it was looking
// for it with `find.byType(Dialog)`.
//
// 🔬 THE SAME MISTAKE, THE THIRD TIME. `integration_test/app_test.dart`
// documents the first two (2026-07-27 and 2026-08-08) and states the rule it
// arrived at: *"SO IT NO LONGER ASKS WHAT THE MODAL IS."* Its helpers were
// corrected on 2026-08-09 in #236 — "consent helpers see the inline prompt (the
// outage class, recurring)". `integration_test/store_screenshots_test.dart` was
// NOT touched by that fix and kept the stale `Dialog` detector, correct only
// while `ConsentGate` was a `showDialog` ROUTE — which it stopped being on
// 2026-08-08 (#217, P2.6a), when `app.dart` replaced it with the inline
// `_ConsentPrompt`: a `Positioned.fill` + opaque `ColoredBox` inside
// `MaterialApp.builder`, above the router's Navigator, where `showDialog` has
// no Navigator to push onto.
//
// The capture lane had run exactly ONCE in its life — 2026-08-04, four days
// BEFORE the prompt changed shape — so the detector was right on the only day
// it was ever exercised and wrong on every day after, invisibly.
//
// 🔑 WHY A WIDGET TEST AND NOT A NOTE ON THE INTEGRATION SUITE. The integration
// suites run against a device or a browser: one runs nightly, the other has now
// run twice in three weeks. A defect that only those can see is a defect nobody
// sees for weeks. Everything below runs in `flutter test` on every push, and it
// reproduces the outage exactly — the scrim up, the tap swallowed, `"Welcome
// back" ×0` — without a device.
//
// ⚠️ NO POLLING FOR THE DESTINATION. `sign_out_destination_test.dart` records
// what that shape cost: the nightly E2E polled `find.text('Welcome back')` and
// returned on first match, so it could pass on a frame the app was merely
// passing THROUGH. Every assertion here is made after the tree has settled.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'package:subly/app.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';
import 'package:subly/state/providers.dart';

/// In-memory storage seam — `PrefsKeyValueStore` needs a platform channel a
/// widget test has not got. Declared locally, as in
/// `consent_prompt_real_surface_test.dart` and `sign_out_destination_test.dart`.
///
/// EMPTY at construction, and that is the fixture: an empty store is a FRESH
/// INSTALL. Nothing has seen onboarding and nobody has answered consent, which
/// is precisely the state the capture lane boots into on a clean CI browser.
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

/// The rails are stubbed because this file is about NAVIGATION, not delivery.
/// What a decision records and ships is
/// `consent_prompt_real_surface_test.dart`'s subject and is fully covered there;
/// duplicating it here would give a navigation lane a second reason to go red.
class _NullEventTransport implements core.EventTransport {
  @override
  Future<core.Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async => const core.Result<void>.ok(null);
}

class _NullConsentTransport implements core.ConsentTransport {
  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async => const core.Result<void>.ok(null);
}

/// The analytics switch FORCED ON.
///
/// `AppConfig.isBackendLive` is COMPILE-TIME, and a widget test is not a live
/// build, so without this override the prompt never mounts — and a first-run
/// test that never sees the prompt would have stayed green straight through the
/// outage it is here to catch. This is the one line that makes this file a
/// reproduction of the LIVE lane rather than of the demo one.
ProviderContainer _freshInstall(_MemStore store) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    analyticsEnabledProvider.overrideWithValue(true),
    eventTransportProvider.overrideWithValue(_NullEventTransport()),
    consentTransportProvider.overrideWithValue(_NullConsentTransport()),
  ],
);

/// Several provider futures resolve in sequence, a route transition animates,
/// and the consent decision is deliberately un-awaited. `pumpAndSettle` with a
/// slice covers all three and — unlike a poll — cannot return early on a frame
/// the app is transiting.
Future<void> _settle(WidgetTester tester) =>
    tester.pumpAndSettle(const Duration(milliseconds: 400));

/// Boot the REAL app root.
///
/// 🔴 `SublyApp`, NOT `MaterialApp.router`. The consent scrim is stacked by
/// `AnalyticsGate` in `MaterialApp.builder` (`lib/app.dart`), ABOVE the router.
/// A test that mounts the router directly — as the sign-out and legal-gate
/// tests correctly do for their own subjects — has no scrim in its tree at all,
/// and would pass with the bug fully present.
Future<void> _launch(WidgetTester tester, ProviderContainer c) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(container: c, child: const SublyApp()),
  );
  await _settle(tester);
}

/// The controls, located the way `app_test.dart` settled on after this class of
/// failure twice: by the AFFORDANCE, never by the widget type. Both survive the
/// prompt being restyled, re-parented or moved between a route and a scrim —
/// which is exactly what happened.
final Finder _decline = find.text('No thanks');
final Finder _allow = find.text('Allow');
final Finder _skip = find.text('Skip');
final Finder _welcomeBack = find.text('Welcome back');

void main() {
  /// THE VIEWPORT THAT FAILED. 1080x1920 physical at dpr 3 is 360x640 logical —
  /// `--browser-dimension=360x640@3`, the phone set's geometry, verbatim. Stated
  /// rather than defaulted so that a failure here is a failure at the size the
  /// listing is actually photographed at.
  void phoneViewport(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 1920);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
  }

  group('first run, live build — the consent scrim and what it covers', () {
    /// 🔑 THIS ASSERTION IS BIDIRECTIONAL, WHICH IS WHAT MAKES IT A GUARD
    /// RATHER THAN A NOTE. It fails if the prompt is not on screen, AND it
    /// fails the day somebody makes the prompt a `Dialog` again. Under the
    /// pre-#217 `ConsentGate` — a `showDialog` route — it would have been RED.
    /// So the prompt's shape can no longer change without a push turning red
    /// and putting whoever changed it in front of every consent detector in the
    /// tree. That is the property missing on 2026-08-08, when the shape changed
    /// and two suites went on polling for the shape it used to have.
    testWidgets(
      '🔴 THE PROMPT ON SCREEN IS NOT A Dialog, AND Skip IS NOT HITTABLE '
      'BEHIND IT',
      (WidgetTester tester) async {
        phoneViewport(tester);
        final ProviderContainer c = _freshInstall(_MemStore());
        addTearDown(c.dispose);

        await _launch(tester, c);

        // The prompt IS up — established by its own controls, so nothing below
        // can be explained away as "it never appeared".
        expect(
          _decline,
          findsOneWidget,
          reason: 'precondition: prompt mounted',
        );
        expect(_allow, findsOneWidget, reason: 'precondition: prompt mounted');

        // ── THE ROOT CAUSE, PINNED ────────────────────────────────────────
        // With the prompt demonstrably on screen, the detector
        // `store_screenshots_test.dart` used until 2026-08-26 sees NOTHING.
        // That is not a near-miss: it is the difference between answering the
        // prompt and walking into it.
        expect(
          find.byType(Dialog),
          findsNothing,
          reason:
              'The consent prompt is an inline scrim (app.dart _ConsentPrompt: '
              'Positioned.fill + opaque ColoredBox), NOT a route and NOT a '
              'Dialog. Any suite that detects it with find.byType(Dialog) will '
              'conclude the prompt is absent while it is absorbing every tap — '
              'the 2026-07-27, 2026-08-08 and 2026-08-26 outages, one cause.',
        );

        // ── AND THE SHAPE-INDEPENDENT LIMB ────────────────────────────────
        // Skip is in the tree, so `expect(find.text('Skip'), findsOneWidget)`
        // PASSES and the suite believes it reached onboarding. It cannot be
        // touched. That gap is the whole silent failure: the assertion that
        // guards the tap is satisfied by the very state that defeats it.
        expect(
          _skip,
          findsOneWidget,
          reason:
              'the carousel is built beneath the scrim — this is why a '
              'presence check on Skip is not a safe guard for a tap on Skip',
        );
        expect(
          _skip.hitTestable(),
          findsNothing,
          reason:
              'a tap aimed at Skip would land on the scrim instead, silently. '
              'This limb needs to know nothing about what is covering the app, '
              'which is why it is the one that survives the next reshaping.',
        );
      },
    );

    testWidgets(
      '🔴 REPRODUCTION: an unanswered scrim swallows Skip and the login form '
      'is never reached',
      (WidgetTester tester) async {
        phoneViewport(tester);
        final ProviderContainer c = _freshInstall(_MemStore());
        addTearDown(c.dispose);

        await _launch(tester, c);
        expect(
          _decline,
          findsOneWidget,
          reason: 'precondition: prompt mounted',
        );

        // `warnIfMissed: false` because THE MISS IS THE SUBJECT. This is the
        // capture suite's exact line, and its silence is the defect: no
        // exception, no failure, just a tap that goes somewhere else.
        await tester.tap(_skip, warnIfMissed: false);
        await _settle(tester);

        expect(
          _welcomeBack,
          findsNothing,
          reason:
              'run 32947223120, reproduced: Found 0 widgets with text '
              '"Welcome back" — not because the string is missing, but because '
              'the app never left onboarding',
        );
        expect(
          find.byType(OnboardingScreen),
          findsOneWidget,
          reason: 'the tap was swallowed, so the carousel is still mounted',
        );
        expect(find.byType(LoginScreen), findsNothing);
      },
    );

    testWidgets(
      'ANSWERED, first run settles on the login form — deterministically',
      (WidgetTester tester) async {
        phoneViewport(tester);
        final ProviderContainer c = _freshInstall(_MemStore());
        addTearDown(c.dispose);

        await _launch(tester, c);

        // Answer it the way the capture lane must: DECLINE. Recording a
        // listing capture must not point a stream of analytics at production.
        await tester.tap(_decline);
        await _settle(tester);

        expect(
          _decline,
          findsNothing,
          reason:
              'a scrim that outlives its own answer leaves every tap beneath '
              'it swallowed just the same',
        );
        expect(
          _skip.hitTestable(),
          findsOneWidget,
          reason: 'with the scrim gone the carousel is reachable again',
        );

        await tester.tap(_skip);
        await _settle(tester);

        // ── ASSERTED AFTER THE SETTLE, NOT ON FIRST SIGHT ─────────────────
        expect(
          find.byType(LoginScreen),
          findsOneWidget,
          reason:
              'Skip runs OnboardingScreen._finish: it records the seen-flag '
              'and hands off to /sign-in, where the router leaves a '
              'signed-out visitor standing (authFlow)',
        );
        expect(
          _welcomeBack,
          findsOneWidget,
          reason:
              'the landmark the Play capture keys on. It must be the SETTLED '
              'state, not a frame in transit',
        );
        expect(
          find.byType(OnboardingScreen),
          findsNothing,
          reason: 'the carousel is finished with, not merely painted over',
        );
      },
    );
  });
}
