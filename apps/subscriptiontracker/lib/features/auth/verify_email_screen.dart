import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/auth/verify_email_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'auth_panel.dart';
import '../../state/providers.dart';
import 'turnstile_gate.dart';

/// "Check your inbox" — the only screen an UNVERIFIED session can reach. The
/// ADAPTER half.
///
/// ⏱ 2026-10-01 · [ADR 086] adopted chassis `VerifyEmailView` (EN-14). The
/// body moved to the package with the reasoning for it in its header (the
/// screen-not-banner lock, "I've confirmed", the inline notice), and gained
/// there what this private copy was about to grow alone: a Resend that rests
/// for [kResendCooldown] across leave and return, and "Use a different email".
/// The blocker recorded on 2026-09-20 — no captcha slot on the view — is gone:
/// `captcha` / `captchaController` landed with ST-A1. What stays here is what
/// a package without Riverpod and go_router cannot hold: the seam calls, the
/// cooldown's deadline, the navigation, and this app's side panel.
///
/// ⚠️ THE E2E SUITE PROVES NOTHING ABOUT THE GATE. It creates its users through
/// the admin API, which bypasses confirmation entirely. The pin is
/// `test/legal_gates_test.dart`, group (a).
class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key});

  static const Key resendButton = VerifyEmailView.resendButton;
  static const Key continueButton = VerifyEmailView.continueButton;
  static const Key signOutButton = VerifyEmailView.signOutButton;
  static const Key statusLine = VerifyEmailView.statusLine;
  static const Key useDifferentButton = VerifyEmailView.useDifferentButton;

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen>
    with CaptchaHost<VerifyEmailScreen> {
  @override
  Widget build(BuildContext context) {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    final String email = auth.currentUser?.email ?? '';
    final ResendCooldownController rest = ref.read(
      resendCooldownProvider.notifier,
    );
    return VerifyEmailView(
      panel: const AuthPanel(),
      email: email,
      // The resend endpoint is captcha-gated too. Renders nothing without a key.
      captcha: TurnstileGate(controller: captcha, render: renderTurnstile),
      captchaController: captcha,
      onCheckConfirmed: () async {
        final core.AuthUser? fresh = await auth.reloadUser();
        // Still unverified is a real answer, not an error.
        return core.sessionIsUnverified(fresh);
      },
      // A CALL, not a tear-off: `assert-captcha-gated-call-sites.mjs` finds a
      // gated call by `<method>(` and reads its arguments for `captchaToken:`.
      onResend: () async {
        await auth.resendVerificationEmail(captchaToken: captcha.consume());
        rest.start(email);
      },
      secondsUntilResend: () => rest.secondsLeft(email),
      // The router is read BEFORE the sign-out, which moves the gate and tears
      // this screen down before an `await` returns.
      onUseDifferent: () async {
        final GoRouter router = GoRouter.of(context);
        await signOutAndForgetUser(ref);
        router.go('/sign-up', extra: email);
      },
      // 🔴 THROUGH [signOutAndForgetUser], not `auth.signOut()`: a
      // session-ending control owes the device the same forget as the one in
      // settings; on the bare call the previous user's cached Pro survived.
      onSignOut: () => signOutAndForgetUser(ref),
    );
  }
}
