// ─────────────────────────────────────────────────────────────────────────────
// store_capture_guard_test.dart — THE CAPTURE REFUSAL MUST BE ABLE TO REFUSE.
//
// 🔴 WHY THIS IS A WIDGET TEST AND NOT PART OF THE CAPTURE SUITE. The refusal
// lives in `integration_test/`, and that suite can only run against a LIVE build
// — which needs a confirmed Supabase account, which needs a CI-only secret. A
// refusal exercised only there would ship having never once refused, and the
// first evidence either way would be a red capture run or a leaked address on a
// public listing. Here it runs on every push, in a real widget tree, in both
// directions.
//
// THE DEFECT, RESTATED. `05-settings.png` (2026-08-05) photographed the settings
// account card while signed in as the end-to-end account, so the frame read
// `subly-e2e+1785856022717@nikatru.com`. `assert-listing-assets.mjs` passed it:
// it decodes pixels and looks for a BAND OF ONE COLOUR, and no guard in this
// tree can read text out of an image. The check has to happen while the frame is
// still a widget tree.
//
// Run:  flutter test test/store_capture_guard_test.dart   (from apps/subly)
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/data/auth/auth_models.dart';

import '../integration_test/store_capture_guard.dart';

/// The account the CI capture actually signs in as — the real shape, including
/// the `+`-tagged local part the provisioner generates.
const String kE2EAddress = 'subly-e2e+1785856022717@nikatru.com';

/// A stand-in for the settings account card: the account address rendered as
/// `Text`, which is exactly what `settings_screen.dart` does with `user?.email`.
Widget _frame(List<Widget> children) => MaterialApp(
  home: Scaffold(
    body: Column(mainAxisSize: MainAxisSize.min, children: children),
  ),
);

/// Records what the shutter was asked to photograph. A refusal that throws AFTER
/// the bytes exist is not a refusal, so every test below asserts on this list
/// rather than only on whether `captureFrame` threw.
class _Shutter {
  final List<String> taken = <String>[];
  Future<void> call(String frame) async => taken.add(frame);
}

void main() {
  group('accountIdentityNeedles', () {
    test('always carries the address the suite signed in with', () {
      expect(
        accountIdentityNeedles(signedInWith: kE2EAddress),
        contains(kE2EAddress),
      );
    });

    test('adds the session the app actually holds, when it differs', () {
      final Set<String> needles = accountIdentityNeedles(
        signedInWith: 'typed@nikatru.com',
        account: const AuthUser(id: 'u', email: 'session@nikatru.com'),
      );
      expect(
        needles,
        containsAll(<String>['typed@nikatru.com', 'session@nikatru.com']),
      );
    });

    // HomeScreen renders `user?.displayName ?? 'Welcome'`, so a live account
    // carrying a full_name would put a real person's name on 01-home.png. It is
    // null for the provisioned CI account TODAY, which is safe by accident.
    test('covers the profile name a live build would render on Home', () {
      final Set<String> needles = accountIdentityNeedles(
        signedInWith: kE2EAddress,
        account: const AuthUser(
          id: 'u',
          email: kE2EAddress,
          displayName: 'Rajasekar Selvam',
        ),
      );
      expect(needles, contains('Rajasekar Selvam'));
    });

    // The --proof lane signs into MockAuthRepository, whose profile name is the
    // fictional 'Alex Rivera'. Refusing on it would fail the mechanism-proof
    // lane forever over a leak that cannot exist, and a guard that blocks
    // correct work is a guard somebody switches off.
    test('leaves a demo build\'s fictional profile name alone', () {
      final Set<String> needles = accountIdentityNeedles(
        signedInWith: 'demo@nikatru.com',
        account: const AuthUser(
          id: 'demo-user',
          email: 'alex@example.com',
          displayName: 'Alex Rivera',
        ),
        includeProfileName: false,
      );
      expect(needles, isNot(contains('Alex Rivera')));
      // …and the ADDRESS limbs are still on in that posture.
      expect(
        needles,
        containsAll(<String>['demo@nikatru.com', 'alex@example.com']),
      );
    });

    test('an absent session does not put an empty string in the set', () {
      final Set<String> needles = accountIdentityNeedles(
        signedInWith: kE2EAddress,
        account: const AuthUser(id: 'u', email: '  ', displayName: ''),
      );
      expect(needles, <String>{kE2EAddress});
    });
  });

  group('captureFrame — the frame that leaked', () {
    // 🔴 THE REGRESSION ITSELF. This is `05-settings.png`, rebuilt as a widget
    // tree: the account card with the end-to-end address in it.
    testWidgets('REFUSES a frame carrying the signed-in address', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _frame(<Widget>[
          const Text('Settings'),
          const Text('Account'),
          const Text(kE2EAddress),
        ]),
      );
      final _Shutter shutter = _Shutter();

      await expectLater(
        captureFrame(
          take: shutter.call,
          frame: '05-settings',
          forbidden: accountIdentityNeedles(signedInWith: kE2EAddress),
        ),
        throwsA(isA<TestFailure>()),
      );
      // The frame was NOT taken. This is the assertion that matters: bytes that
      // exist can be committed by mistake, and the whole defect was a file that
      // reached the repository before anybody looked at it.
      expect(shutter.taken, isEmpty);
    });

    // The other half. Without it the refusal could be a constant that fires on
    // everything, which would be caught in CI only by the capture never working.
    testWidgets('photographs a frame that does not carry the account', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _frame(<Widget>[
          const Text('Subscriptions'),
          const Text('Video streaming'),
          const Text('\$15.99'),
        ]),
      );
      final _Shutter shutter = _Shutter();

      await captureFrame(
        take: shutter.call,
        frame: '01-home',
        forbidden: accountIdentityNeedles(signedInWith: kE2EAddress),
      );
      expect(shutter.taken, <String>['01-home']);
    });

    // The address is rendered inside a longer sentence, and the settings card
    // constrains its width so the glyphs are visually clipped. The WIDGET still
    // holds the whole string, which is why the check is a substring match on the
    // tree rather than anything about what fits on screen.
    testWidgets('REFUSES when the address is a substring of a longer label', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _frame(<Widget>[
          const SizedBox(
            width: 40,
            child: Text(
              'Signed in as $kE2EAddress',
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ]),
      );
      final _Shutter shutter = _Shutter();

      await expectLater(
        captureFrame(
          take: shutter.call,
          frame: '05-settings',
          forbidden: accountIdentityNeedles(signedInWith: kE2EAddress),
        ),
        throwsA(isA<TestFailure>()),
      );
      expect(shutter.taken, isEmpty);
    });

    // A profile name is not an address and would never look wrong to a size or
    // format check; it is the SAME defect one field over.
    testWidgets('REFUSES a frame carrying the account profile name', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _frame(<Widget>[const Text('Hi, Rajasekar Selvam')]),
      );
      final _Shutter shutter = _Shutter();

      await expectLater(
        captureFrame(
          take: shutter.call,
          frame: '01-home',
          forbidden: accountIdentityNeedles(
            signedInWith: kE2EAddress,
            account: const AuthUser(
              id: 'u',
              email: kE2EAddress,
              displayName: 'Rajasekar Selvam',
            ),
          ),
        ),
        throwsA(isA<TestFailure>()),
      );
      expect(shutter.taken, isEmpty);
    });
  });

  group('captureFrame — it cannot be satisfied by having nothing to check', () {
    // An empty needle set makes the loop above range over nothing and pass every
    // frame — an assertion that cannot fail, in the one place whose output is a
    // public asset. It must refuse instead.
    testWidgets('REFUSES when the forbidden set is empty', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_frame(<Widget>[const Text(kE2EAddress)]));
      final _Shutter shutter = _Shutter();

      await expectLater(
        captureFrame(
          take: shutter.call,
          frame: '01-home',
          forbidden: const <String>{},
        ),
        throwsA(isA<TestFailure>()),
      );
      expect(shutter.taken, isEmpty);
    });

    // The refusal has to say WHY, or the next person to hit it deletes it.
    testWidgets('says what it refused and what would have gone public', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_frame(<Widget>[const Text(kE2EAddress)]));
      Object? thrown;
      try {
        await captureFrame(
          take: _Shutter().call,
          frame: '05-settings',
          forbidden: accountIdentityNeedles(signedInWith: kE2EAddress),
        );
      } catch (e) {
        thrown = e;
      }
      expect(thrown, isNotNull);
      expect(thrown.toString(), contains('05-settings'));
      expect(thrown.toString(), contains(kE2EAddress));
      expect(thrown.toString(), contains('public Play listing'));
    });
  });
}
