import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';
import 'legal_consent_fields.dart';

/// Sign-in — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]). Three
/// things stayed here and each answers a named guard rather than a preference:
///
/// ⛔ THE `caps.oauthRedirect && providers.any` GATE.
/// `tooling/ci/assert-no-seam-forks.mjs`'s parity limb derives C from the
/// `caps.<field>` reads on the chassis side of this pair and requires C ⊆ F
/// against `apps/subscriptiontracker/lib/features/auth/login_screen.dart`. It reads the
/// adapter UNIONED with the file it delegates to — and its zero-caps refusal
/// still NAMES THE ADAPTER, so the read stays where the guard points. It is
/// also the honest home: `AuthCapabilities` is the auth SEAM, and a package the
/// design system's own limb-B argument applies to must not be handed it.
///
/// ⛔ `signInWithEmail(`. `dod.json:75` anchors the auth-redirect proof at
/// `lib/features/auth/sign_in_screen.dart:signInWithEmail`, and
/// `assert-app-dod.mjs:836` fails the build when that symbol stops appearing in
/// THIS file outside comments. The mutation record it carries is a statement
/// about this call site.
///
/// ⛔ The navigations, because the chassis package declares no go_router.
class SignInScreen extends ConsumerWidget {
  const SignInScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    // What identity can actually do HERE — declared, not assumed
    // ([pipeline C-7]). Offering an OAuth button on a platform that cannot
    // complete the redirect is promising something the app cannot deliver.
    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);
    // …and whether the SERVER will accept the provider at all, which the
    // capability matrix does not describe. Both must be true.
    final AuthProviders providers = ref.watch(authProvidersProvider);
    final core.AccountDeletionOutcome? deletion = ref.watch(
      lastAccountDeletionOutcomeProvider,
    );

    return SignInView(
      // ⏱ 2026-09-15 · [ADR 082] §5 — the store age signal read before Sign in with
      // Apple, which can create an account. Sign-up age gate ONLY: never stored,
      // logged or sent (`ageSignalSourceProvider`).
      ageSignals: ref.watch(ageSignalSourceProvider),
      onSignIn: (String email, String password) =>
          auth.signInWithEmail(email: email, password: password),
      // A CALL, NOT A TEAR-OFF — same reason as `verify_email_screen.dart`:
      // `sendPasswordReset` is one of the four captcha-gated seam methods and
      // assert-captcha-gated-call-sites matches `<method>(`.
      onForgotPassword: (String email) => auth.sendPasswordReset(email),
      onNeedAccount: () => context.go('/sign-up'),
      showAppleButton: caps.oauthRedirect && providers.any && providers.apple,
      onSignInWithApple: () => auth.signInWithApple(),
      // ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT — the same two facts, and
      // `providers.google` is false until the owner provisions the client.
      showGoogleButton: caps.oauthRedirect && providers.any && providers.google,
      onSignInWithGoogle: () => auth.signInWithGoogle(),
      // ⏱ 2026-09-15 · O-SIWA-NO-CLICKWRAP — Sign in with Apple can create an
      // account, so a device that still owes the terms answers the SAME clickwrap
      // before the provider is called, and the acceptance is recorded first.
      // "Not known yet" (null) counts as owed.
      // 🔴 THE SOURCE PROVIDER, COMPARED HERE — NOT `legalReacceptanceNeededProvider`.
      // Reading the DERIVED provider inside build makes Riverpod recompute it
      // mid-build, and the router's refresh listener on that provider then fires
      // DURING this build ("setState() or markNeedsBuild() called during build",
      // measured on check_inbox_test and legal_gates_test). The comparison is the
      // same one the derived provider makes; null (not hydrated yet) is owed.
      appleTermsOwed: core.needsLegalReacceptance(
        acceptedStamp: ref.watch(legalAcceptanceProvider),
        current: kLegalVersions,
      ),
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
      onAcceptTerms: ({required bool marketingEmail}) => ref
          .read(legalAcceptanceProvider.notifier)
          .accept(marketingEmail: marketingEmail),
      deletion: deletion,
      deletionDetail: ref.watch(lastAccountDeletionDetailProvider),
      onDismissDeletionNotice: () {
        // Cleared on dismissal so it cannot resurface at some later, unrelated
        // sign-out — the notice answers ONE act.
        ref.read(lastAccountDeletionOutcomeProvider.notifier).state = null;
        ref.read(lastAccountDeletionDetailProvider.notifier).state = null;
      },
    );
  }
}
