import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';
import 'legal_consent_fields.dart';

/// Sign-up — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]), both
/// consent flags with it. What could not travel is below: the seam call, the
/// consent write and the ONE navigation this screen owns.
class SignUpScreen extends ConsumerWidget {
  const SignUpScreen({super.key});

  static const Key submitButton = SignUpView.submitButton;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    return SignUpView(
      // ⏱ 2026-09-15 · [ADR 082] §5 — the store age signal read before the account is
      // created. Sign-up age gate ONLY: never stored, logged or sent
      // (`ageSignalSourceProvider`).
      ageSignals: ref.watch(ageSignalSourceProvider),
      onSignUp: ({required String email, required String password, required bool marketingEmail}) async {
        await auth.signUpWithEmail(email: email, password: password);
        // 🔴 AFTER THE ACCOUNT EXISTS, and the order was the other way round
        // for a day. Recording first was justified as "a user through the door
        // with no record of what they agreed to is the outcome to avoid" —
        // true, and not what recording first buys. What it bought was the
        // opposite error, and the opposite error is the unrecoverable one:
        //
        //   · the consent trail is APPEND-ONLY and keyed by `anon_id`, never by
        //     user id. A sign-up that then throws — address already registered,
        //     a server-side password rejection, a dropped connection — left a
        //     permanent `terms granted:true` and `marketing granted:true` for a
        //     registration that never happened, and an account deletion (keyed
        //     by user id) can never reach those rows to erase them.
        //   · worse, `accept()` sets the device stamp SYNCHRONOUSLY at its
        //     first line. So a failed sign-up satisfied the re-acceptance gate,
        //     and the same person could sign IN to a pre-clickwrap account with
        //     the gate already open — on the strength of an acceptance for an
        //     account that does not exist.
        //
        // The other direction costs a re-ask: if this write fails after a
        // successful sign-up, the gate stops them at the next launch and asks
        // again. Recoverable, and the direction every other decision in this
        // chassis takes.
        //
        // ⚠️ NO FRAME CAN BE PAINTED BETWEEN THESE TWO STATEMENTS, which is why
        // the interstitial does not flash. `accept()` sets the in-memory stamp
        // before its own first `await`, and Flutter drains the microtask queue
        // — including this continuation — before it pumps a frame.
        await ref
            .read(legalAcceptanceProvider.notifier)
            .accept(marketingEmail: marketingEmail);
        // 🔴 A SIGN-UP DOES NOT ALWAYS PRODUCE A SESSION, AND THE REDIRECT
        // GUARD CANNOT SEE THE CASE WHERE IT DOES NOT. With "Confirm email" ON,
        // gotrue returns a user and NO session, so `currentUser` stays null —
        // and the router's verification gate is `sessionIsUnverified`, which
        // answers FALSE for a null user BY DESIGN. Nothing fires, nothing
        // moves, and the person who has just registered is left looking at the
        // form they completed with no word about the mail now sitting in their
        // inbox.
        //
        // So this screen navigates for exactly that state and for no other.
        // When a session DID appear the guard is still the only thing that
        // moves the user — pushing from both places is how two routes race for
        // the top of the stack.
        if (!context.mounted) return;
        if (auth.currentUser == null) {
          context.go('/check-inbox', extra: email);
        }
      },
      onHaveAccount: () => context.go('/sign-in'),
      // The brick's own consent widget, still MOUNTED — see
      // `legal_consent_fields.dart`. The chassis view owns the two flags; this
      // side owns the published URLs and the platform call that opens them.
      consentFields:
          ({
            required bool termsAccepted,
            required bool marketingAccepted,
            required bool enabled,
            required ValueChanged<bool> onTermsChanged,
            required ValueChanged<bool> onMarketingChanged,
          }) => LegalConsentFields(
            termsAccepted: termsAccepted,
            marketingAccepted: marketingAccepted,
            enabled: enabled,
            onTermsChanged: onTermsChanged,
            onMarketingChanged: onMarketingChanged,
          ),
    );
  }
}
