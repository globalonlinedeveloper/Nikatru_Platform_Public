import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/auth/verify_email_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';
import 'captcha.dart';

/// The gate an UNVERIFIED session sits behind — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]). What stays
/// here is the three seam calls and the provider read, because they are the
/// part a package declaring no Riverpod cannot hold. `VerifyEmailView`'s own
/// header carries why this screen exists at all.
///
/// 🔴 THE SIGN-OUT GOES THROUGH [signOutAndForgetUser], NOT `auth.signOut()`.
/// It is a session-ending control like the one in settings, so it owes the
/// device the same forget; it was left on the bare call once and the previous
/// user's cached Pro survived it. `assert-seams-wired` is what holds it.
class VerifyEmailScreen extends ConsumerWidget {
  const VerifyEmailScreen({super.key});

  static const Key resendButton = VerifyEmailView.resendButton;
  static const Key continueButton = VerifyEmailView.continueButton;
  static const Key signOutButton = VerifyEmailView.signOutButton;
  static const Key statusLine = VerifyEmailView.statusLine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    // ST-A1: the chassis captcha gate; every gated call spends its token.
    final CaptchaTokenController captcha = ref.watch(
      captchaControllerProvider('verify-email'),
    );
    return VerifyEmailView(
      captcha: TurnstileGate(controller: captcha, render: renderTurnstile),
      captchaController: captcha,
      email: auth.currentUser?.email ?? '',
      // Still unverified is a real answer, not an error.
      onCheckConfirmed: () async {
        final core.AuthUser? fresh = await auth.reloadUser();
        return core.sessionIsUnverified(fresh);
      },
      // 🔴 A CALL, NOT A TEAR-OFF, AND `assert-captcha-gated-call-sites.mjs`
      // IS WHY. It finds a gated call site by matching `<method>(` and then
      // reads its argument list for `captchaToken:`. `auth.resendVerificationEmail`
      // passed as a tear-off is a gated seam call the scan cannot see at all —
      // the silent-blind shape, in a guard whose whole job is to notice a call
      // site that cannot answer a challenge.
      onResend: () =>
          auth.resendVerificationEmail(captchaToken: captcha.consume()),
      onSignOut: () => signOutAndForgetUser(ref),
    );
  }
}
