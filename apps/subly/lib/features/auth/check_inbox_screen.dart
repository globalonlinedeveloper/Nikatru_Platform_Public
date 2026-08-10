import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../l10n/app_localizations.dart';

/// "Check your inbox" for a sign-up that produced NO SESSION.
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
/// 🔴 MEASURED, NOT ANTICIPATED. Two of the four accounts on the live Supabase
/// project are unconfirmed with `last_sign_in_at` NULL: they registered, were
/// sent somewhere that said nothing about a confirmation mail, and never came
/// back. `login_screen.dart` ran `context.go('/scan')` unconditionally after a
/// sign-up and `/scan` is on the signed-out allowlist, so the destination was a
/// receipt-scanner; through `/sign-up` the screen simply re-enabled its button
/// and stayed put.
///
/// ⚠️ NO RESEND BUTTON, and its absence is a property of the state rather than
/// an omission. `resendVerificationEmail()` takes no address on purpose — it
/// aims at the CURRENT session, and there is none here. A button that could
/// only throw is worse than no button.
///
/// [email] is not optional and the route will not build this screen without one:
/// naming the address is the whole job, because a mistyped one is visible here
/// and nowhere else.
class CheckInboxScreen extends StatelessWidget {
  const CheckInboxScreen({required this.email, super.key});

  static const Key backToSignInButton = Key('checkInboxBackToSignIn');

  final String email;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.checkInboxTitle)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
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
                key: CheckInboxScreen.backToSignInButton,
                onPressed: () => context.go('/sign-in'),
                child: Text(l10n.checkInboxBackToSignIn),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
