// ─────────────────────────────────────────────────────────────────────────────
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
import 'package:subly/features/auth/turnstile_gate.dart';

void main() {
  group('TurnstileGate is inert until a site key is compiled in', () {
    test('no site key is configured in a normal test/dev build', () {
      // If this ever fails, someone has started passing the dart-define into
      // ordinary builds — at which point every widget test below is asserting
      // something different from what it claims, and the ON path has quietly
      // become the default without anyone deciding that.
      expect(TurnstileGate.siteKey, isEmpty);
      expect(TurnstileGate.isConfigured, isFalse);
    });

    testWidgets('renders NOTHING, and takes up no space', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Column(
              children: <Widget>[
                const Text('above'),
                TurnstileGate(onToken: (String? _) {}),
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

    testWidgets('never calls back, so callers keep a null token', (tester) async {
      final List<String?> seen = <String?>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: TurnstileGate(onToken: seen.add)),
        ),
      );
      await tester.pump(const Duration(seconds: 1));

      // NOT "seen is all nulls" — no callback at all. A gate that reported null
      // would be indistinguishable from one whose challenge had just expired,
      // and a screen that blocks on that would block forever.
      expect(seen, isEmpty);
    });
  });

  group('the cutover assertion refuses an unconfigured build', () {
    test('assertConfiguredForCutover throws while no key is set', () {
      // The safety valve for the one moment the OFF state stops being harmless.
      // After SUPABASE_URL moves to Box A, a build with no key cannot
      // authenticate anyone — six endpoints refuse without a token — so the
      // checklist needs something that fails loudly rather than a discovery
      // made by users.
      expect(
        TurnstileGate.assertConfiguredForCutover,
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

    test('it is NOT called at startup, or every current build would crash', () {
      // Pinning the decision, not just the code: every build today correctly
      // has no key, so wiring this into main() would take the app down.
      // Building the gate must stay harmless.
      expect(() => TurnstileGate(onToken: (String? _) {}), returnsNormally);
    });
  });
}
