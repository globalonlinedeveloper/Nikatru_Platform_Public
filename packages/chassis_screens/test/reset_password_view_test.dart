import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/reset_password_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/raw_vendor_error.dart';
import 'support/width_harness.dart';

/// `ResetPasswordView` — the three states, the width decision, and the one
/// check the SERVER cannot make.
///
/// 🏗️ THESE ARE THE WIDGET-HALF CASES OF `property: password-recovery-routes`,
/// moved out of the brick's `chassis_properties_test.dart` with the body they
/// exercise ([ADR 071]). The WIRING half — the router redirect that decides who
/// arrives here at all — stays in the brick, where the stamped root is booted:
/// it is a fact about the app, not about this widget.
void main() {
  Widget view({
    bool hasSession = true,
    bool recovering = true,
    core.PasswordResetArrival arrival = core.PasswordResetArrival.pending,
    core.AuthLinkProblem? problem,
    Future<void> Function(String)? onSubmit,
    VoidCallback? onLeave,
  }) =>
      ResetPasswordView(
        hasSession: hasSession,
        recovering: recovering,
        arrival: arrival,
        problem: problem,
        onSubmit: onSubmit ?? (String _) async {},
        onLeave: onLeave ?? () {},
      );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // 🔴 THE ASSERTION IS THE CAP, NOT "IT RENDERED". A screen that grows to fill
  // a 1280 px display raises no exception and clips no pixel — an unmeasured
  // width is a width nobody decided. `ContentPane.form` owns 420 for every
  // stamped app, so the phone case proves the pane yields below the cap and the
  // two wider ones prove it holds.
  //
  // ⚠️ THE THREE CASES ARE WRITTEN OUT, NOT LOOPED. `assert-responsive-coverage`
  // reads which window classes a case pumps by finding the CONSTANT in an
  // argument position in THIS file (`:1000`); a loop over `kAllWindows` names
  // none of them here, so the file would be credited with 375 alone and the
  // guard would correctly report kTablet and kDesktop unmeasured.
  group('property: reset-password-fills-the-form-pane at every window class',
      () {
    Future<double> fieldWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byKey(ResetPasswordView.passwordField)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields',
        (WidgetTester tester) async {
      expect(await fieldWidthAt(tester, kPhone), lessThan(kPhone.width));
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await fieldWidthAt(tester, kTablet), AppBreakpoints.form);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await fieldWidthAt(tester, kDesktop), AppBreakpoints.form,
          reason:
              'a form that grew to 1280 px is a form nobody decided the width of');
    });
  });

  // ── (2) THE DEAD LINK, AND WHICH SENTENCE IT SHOWS ────────────────────────
  //
  // Typed, so the second sentence fits the cause. `verifierMissing` is the only
  // one the user can act on; telling somebody to "use the same browser" when
  // they did is how a correct instruction becomes noise.
  group('property: reset-password-explains-a-dead-link', () {
    testWidgets('no session and an unusable arrival shows the dead-link state',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          hasSession: false,
          arrival: core.PasswordResetArrival.unusable,
          problem: core.AuthLinkProblem.expiredOrUsed,
        ),
      );
      expect(find.byKey(ResetPasswordView.linkDeadLine), findsOneWidget);
      expect(find.byKey(ResetPasswordView.passwordField), findsNothing);
    });

    testWidgets('expiredOrUsed and verifierMissing show DIFFERENT hints',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          hasSession: false,
          arrival: core.PasswordResetArrival.unusable,
          problem: core.AuthLinkProblem.expiredOrUsed,
        ),
      );
      final String expired =
          tester.widget<Text>(find.byKey(ResetPasswordView.linkDeadHint)).data!;

      await pumpChassis(
        tester,
        kPhone,
        view(
          hasSession: false,
          arrival: core.PasswordResetArrival.unusable,
          problem: core.AuthLinkProblem.verifierMissing,
        ),
      );
      final String missing =
          tester.widget<Text>(find.byKey(ResetPasswordView.linkDeadHint)).data!;

      expect(expired, isNot(missing),
          reason: 'one sentence for both causes is the shape that makes the '
              'same-device instruction noise for the half it does not apply to');
      expect(expired, isNotEmpty);
      expect(missing, isNotEmpty);
    });

    testWidgets('the only control on the dead-link state is the way out',
        (WidgetTester tester) async {
      bool left = false;
      await pumpChassis(
        tester,
        kPhone,
        view(
          hasSession: false,
          arrival: core.PasswordResetArrival.unusable,
          onLeave: () => left = true,
        ),
      );
      await tester.tap(find.byKey(ResetPasswordView.signInButton));
      await tester.pump();
      expect(left, isTrue);
    });
  });

  // ── (3) THE MISMATCH IS CHECKED BEFORE THE NETWORK ────────────────────────
  //
  // 🔴 THE ONE ERROR ON THIS SCREEN THE SERVER CANNOT CATCH. Both fields are
  // well-formed passwords, so gotrue accepts the wrong one happily and the user
  // is locked out of an account they just recovered — with a single-use link
  // already spent.
  group('property: reset-password-refuses-a-mismatch-locally', () {
    testWidgets('a mismatched confirmation never reaches onSubmit',
        (WidgetTester tester) async {
      final List<String> sent = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(onSubmit: (String p) async => sent.add(p)),
      );
      await tester.enterText(
          find.byKey(ResetPasswordView.passwordField), 'correct-horse-1');
      await tester.enterText(
          find.byKey(ResetPasswordView.confirmField), 'correct-horse-2');
      await tester.tap(find.byKey(ResetPasswordView.submitButton));
      await tester.pump();

      expect(sent, isEmpty,
          reason: 'a confirmation typo must be refused on the device');
      expect(find.byKey(ResetPasswordView.statusLine), findsOneWidget);
    });

    testWidgets('a matching pair reaches onSubmit and lands on DONE',
        (WidgetTester tester) async {
      final List<String> sent = <String>[];
      await pumpChassis(
        tester,
        kPhone,
        view(onSubmit: (String p) async => sent.add(p)),
      );
      await tester.enterText(
          find.byKey(ResetPasswordView.passwordField), 'correct-horse-1');
      await tester.enterText(
          find.byKey(ResetPasswordView.confirmField), 'correct-horse-1');
      await tester.tap(find.byKey(ResetPasswordView.submitButton));
      await tester.pumpAndSettle();

      expect(sent, <String>['correct-horse-1']);
      expect(find.byKey(ResetPasswordView.doneLine), findsOneWidget);
    });

    // ⏱ 2026-09-24 — shown MAPPED, by the reasons the adapter now carries.
    // This case asserted the server's words appeared verbatim.
    testWidgets('a failure from the seam is shown, mapped by its reasons',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSubmit: (String _) async => throw core.AuthFailure(
            'Password is known to be weak and easy to guess.',
            code: core.AuthFailure.weakPassword,
            reasons: const <String>[core.AuthFailure.reasonPwned],
          ),
        ),
      );
      await tester.enterText(
          find.byKey(ResetPasswordView.passwordField), 'correct-horse-1');
      await tester.enterText(
          find.byKey(ResetPasswordView.confirmField), 'correct-horse-1');
      await tester.tap(find.byKey(ResetPasswordView.submitButton));
      await tester.pumpAndSettle();

      expect(find.byKey(ResetPasswordView.doneLine), findsNothing);
      expect(
        tester.widget<Text>(find.byKey(ResetPasswordView.statusLine)).data,
        _en.passwordBreached,
      );
    });

    // 🔴 THE `'$e'` ARM.
    testWidgets('a NON-AuthFailure is mapped, never printed',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(onSubmit: (String _) async => throw const RawVendorError()),
      );
      await tester.enterText(
          find.byKey(ResetPasswordView.passwordField), 'correct-horse-1');
      await tester.enterText(
          find.byKey(ResetPasswordView.confirmField), 'correct-horse-1');
      await tester.tap(find.byKey(ResetPasswordView.submitButton));
      await tester.pumpAndSettle();

      expect(find.textContaining(rawVendorFragment), findsNothing);
      expect(
        tester.widget<Text>(find.byKey(ResetPasswordView.statusLine)).data,
        _en.authCaptchaFailed,
      );
    });
  });

  // ── (4) DONE IS TERMINAL, AND ITS ONLY EXIT IS THE SIGN-OUT ───────────────
  testWidgets('property: reset-password-done-exits-through-onLeave',
      (WidgetTester tester) async {
    bool left = false;
    await pumpChassis(
      tester,
      kPhone,
      view(onLeave: () => left = true),
    );
    await tester.enterText(
        find.byKey(ResetPasswordView.passwordField), 'correct-horse-1');
    await tester.enterText(
        find.byKey(ResetPasswordView.confirmField), 'correct-horse-1');
    await tester.tap(find.byKey(ResetPasswordView.submitButton));
    await tester.pumpAndSettle();

    expect(find.byKey(ResetPasswordView.doneLine), findsOneWidget);
    await tester.tap(find.byKey(ResetPasswordView.signInButton));
    await tester.pump();
    expect(left, isTrue,
        reason:
            'navigating without the sign-out leaves the recovery gate armed and '
            'the router puts the user straight back here');
  });
}

/// ⏱ 2026-09-24 — the sentences the shared `authErrorText` answers with.
final ChassisLocalizations _en = lookupChassisLocalizations(const Locale('en'));
