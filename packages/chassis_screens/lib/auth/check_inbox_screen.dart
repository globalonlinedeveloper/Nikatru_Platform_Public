import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// "Check your inbox" for a sign-up that produced NO SESSION.
///
/// 🏗️ THE BODY OF `CheckInboxScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. The brick keeps an adapter of the same name whose only remaining
/// job is `context.go('/sign-in')` — the one thing a package that declares no
/// go_router cannot do.
///
/// 🔴 IT IS NOT THE SAME SCREEN AS `/verify-email`, AND THE DIFFERENCE IS WHICH
/// STATE THE USER IS IN. With Supabase's "Confirm email" ON, `signUp` returns a
/// user and **no session**, so `auth.currentUser` is null — and
/// `sessionIsUnverified` is deliberately FALSE for a null user (there is nobody
/// to be unverified). The router's verification gate therefore never fires for
/// this person: they are signed OUT. `/verify-email` serves the other half, a
/// session whose address is unconfirmed, and both are needed because the
/// dashboard switch decides which one a given sign-up produces.
///
/// ⚠️ NO RESEND BUTTON, and its absence is a property of the state rather than
/// an omission. `resendVerificationEmail()` takes no address on purpose — it
/// aims at the CURRENT session, and there is none here. A button that could
/// only throw is worse than no button.
///
/// [email] is not optional and the route will not build this screen without one:
/// naming the address is the whole job, because a mistyped one is visible here
/// and nowhere else.
class CheckInboxView extends StatelessWidget {
  const CheckInboxView({
    required this.email,
    required this.onBackToSignIn,
    super.key,
  });

  static const Key backToSignInButton = Key('checkInboxBackToSignIn');

  final String email;

  /// The way out, and it is the PRIMARY action — see the note at the control.
  final VoidCallback onBackToSignIn;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;

    return AuthFrame(
      title: l10n.checkInboxTitle,
      children: <Widget>[
        Text(
          l10n.checkInboxBody(email),
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 8),
        Text(
          l10n.checkInboxThenSignIn,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 8),
        // The same sentence `/verify-email` shows, reused rather than
        // written twice: two spellings of one instruction age apart, and a
        // translator would have to render both.
        Text(
          l10n.verifyEmailSpamHint,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 20),
        // 🔴 THE WAY OUT, AND IT IS THE PRIMARY ACTION. Confirming happens
        // in a mail client; the next thing this app can do for them is
        // take their password. Without this control the screen is a
        // dead end, which is the defect it was built to remove.
        FilledButton(
          key: CheckInboxView.backToSignInButton,
          onPressed: onBackToSignIn,
          child: Text(l10n.checkInboxBackToSignIn),
        ),
      ],
    );
  }
}
