// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-27 · ST-A1: the gate is the CHASSIS widget now; this app supplies
// the renderer and the posture (`appCaptchaPosture`). The token lifecycle is
// pinned in packages/chassis_screens/test/turnstile_gate_test.dart.
//
// TurnstileGate — the OFF state, which is the only state any current build has.
//
// 🔴 WHY THIS SUITE IS ABOUT "OFF" RATHER THAN ABOUT THE CHALLENGE.
//
// `TURNSTILE_SITE_KEY` is a `String.fromEnvironment` const, so it is fixed at
// COMPILE time. A widget test cannot set it, and there is no seam that would
// let one — which means the ON path cannot be exercised here at all, and
// pretending otherwise with a mock would test the mock.
//
// What CAN be pinned, and what actually matters right now, is that the gate is
// INERT without a key. That is the property the whole rollout strategy rests on:
// it is why this can be merged and shipped today against hosted Supabase, why
// the other 791 tests did not have to change, and why a build that forgets the
// define degrades to today's behaviour instead of a broken login screen.
//
// ⚠️ SO SAY WHAT IS NOT COVERED, rather than let a green suite imply it: nothing
// here proves a real challenge renders, that a token is produced, or that the
// token reaches the server. The first two are Cloudflare's; the third is
// covered in `packages/auth_supabase` (the seam forwards it), and the whole
// chain is only observable against Box A, which the cutover checklist covers.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/features/auth/turnstile_gate.dart';

void main() {
  group('TurnstileGate is inert until a site key is compiled in', () {
    test('no site key is configured in a normal test/dev build', () {
      // If this ever fails, someone has started passing the dart-define into
      // ordinary builds — at which point every widget test below is asserting
      // something different from what it claims, and the ON path has quietly
      // become the default without anyone deciding that.
      expect(AppConfig.turnstileSiteKey, isEmpty);
      expect(appCaptchaPosture == CaptchaPosture.challenge, isFalse);
    });

    testWidgets('renders NOTHING, and takes up no space', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: <Widget>[
                const Text('above'),
                TurnstileGate(
                  controller: newCaptchaController(),
                  render: renderTurnstile,
                ),
                const Text('below'),
              ],
            ),
          ),
        ),
      );

      expect(find.byType(TurnstileGate), findsOneWidget);
      // Zero height: a gate that reserved space would shift every auth screen's
      // layout on a build that cannot use it.
      expect(tester.getSize(find.byType(TurnstileGate)), Size.zero);
      expect(find.text('above'), findsOneWidget);
      expect(find.text('below'), findsOneWidget);
    });

    testWidgets('never calls back, so callers keep a null token', (
      tester,
    ) async {
      final CaptchaTokenController c = newCaptchaController();
      addTearDown(c.dispose);
      final List<String?> seen = <String?>[];
      c.addListener(() => seen.add(c.token));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TurnstileGate(controller: c, render: renderTurnstile),
          ),
        ),
      );
      await tester.pump(const Duration(seconds: 1));
      // ...and a screen is never blocked by a challenge that does not render.
      expect(c.ready, isTrue);

      // NOT "seen is all nulls" — no callback at all. A gate that reported null
      // would be indistinguishable from one whose challenge had just expired,
      // and a screen that blocks on that would block forever.
      expect(seen, isEmpty);
    });
  });

  group('the cutover assertion refuses an unconfigured build', () {
    test('assertTurnstileConfiguredForCutover throws while no key is set', () {
      // The safety valve for the one moment the OFF state stops being harmless.
      // After SUPABASE_URL moves to Box A, a build with no key cannot
      // authenticate anyone — six endpoints refuse without a token — so the
      // checklist needs something that fails loudly rather than a discovery
      // made by users.
      expect(
        assertTurnstileConfiguredForCutover,
        throwsA(
          isA<StateError>().having(
            (StateError e) => e.message,
            'message',
            allOf(
              contains('TURNSTILE_SITE_KEY'),
              // The message has to carry the fix, not just the complaint.
              contains('--dart-define'),
            ),
          ),
        ),
      );
    });

    test('the cutover assertion reads the CHASSIS key, not a private copy', () {
      // [ADR 084]: the read has one home. Both views agree in this build.
      expect(newCaptchaController().siteKey, AppConfig.turnstileSiteKey);
      expect(AppConfig.isTurnstileConfigured, isFalse);
    });

    test('it is NOT called at startup, or every current build would crash', () {
      // Pinning the decision, not just the code: every build today correctly
      // has no key, so wiring this into main() would take the app down.
      // Building the gate must stay harmless.
      expect(
        () => TurnstileGate(
          controller: newCaptchaController(),
          render: renderTurnstile,
        ),
        returnsNormally,
      );
    });
  });

  // ⏱ 2026-09-15 · [ADR 084] — Turnstile is WEB-ONLY, and the posture is a pure
  // function so each branch is pinned here rather than implied by the one
  // branch a VM widget test happens to run (no key, not web). Each case is
  // declared on its own (assert-no-loop-cases).
  group('CaptchaPosture (ADR 084)', () {
    test('web + key: the challenge renders', () {
      expect(_posture(web: true, key: 'k'), CaptchaPosture.challenge);
    });

    test('web + live backend + NO key: misconfigured, not a pass', () {
      expect(_posture(web: true, key: ''), CaptchaPosture.misconfigured);
    });

    test('web DEMO (no backend) + no key: inert', () {
      final CaptchaPosture p = _posture(web: true, key: '', live: false);
      expect(p, CaptchaPosture.notOnThisChannel);
    });

    test('store (native) + no key: no captcha, by design', () {
      expect(_posture(web: false, key: ''), CaptchaPosture.notOnThisChannel);
    });

    test('native handed a key anyway: still renders nothing', () {
      // The build-time guard names that lane; the app must not render an
      // unverified webview widget because of it.
      expect(_posture(web: false, key: 'k'), CaptchaPosture.notOnThisChannel);
    });

    test('THIS build (a VM test, no key) is not misconfigured', () {
      // A widget test is not a web build, so it must never trip the report —
      // FlutterError.reportError would fail every auth-screen test.
      expect(appCaptchaPosture, CaptchaPosture.notOnThisChannel);
    });
  });
}

CaptchaPosture _posture({
  required bool web,
  required String key,
  bool live = true,
}) {
  return captchaPostureFor(isWeb: web, siteKey: key, backendLive: live);
}
