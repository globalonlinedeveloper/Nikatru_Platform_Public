import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import 'legal_consent_fields.dart';

/// Sign-up — [pipeline C-13], inherited by every stamped app.
///
/// 🔴 CARRIES THE BLOCKING TERMS CLICKWRAP AND THE EXPRESS MARKETING OPT-IN
/// (research/43 + research/44 riders, owner 2026-08-09). Both boxes arrive
/// UNTICKED; the terms box blocks the button and the marketing box may not.
/// See `legal_consent_fields.dart` for why they are two different legal animals.
class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  static const Key submitButton = Key('signUpSubmit');

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  /// 🔴 BOTH FALSE, ALWAYS. `assert-signup-consent-shape.mjs` fails the build if
  /// either initialiser ever says `true` — a pre-ticked consent is a dark
  /// pattern under Planet49/EDPB, DPDP Rules 2025 and CPRA alike, and it is the
  /// one mistake here that no test would notice because the flow still works.
  bool _acceptedTerms = false;
  bool _marketingEmail = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signUp(core.AuthRepository auth, AppLocalizations l10n) async {
    // 🔴 THE SECOND HALF OF THE CLICKWRAP. Disabling the button is the visible
    // rule; this is the one that holds when the button is not the only way in —
    // `onSubmitted:` on the password field reaches here from the keyboard, and
    // an enter key that bypasses a legal gate is still a bypass.
    if (_busy || !_acceptedTerms) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_password.text.length < 8) {
        // Checked HERE as well as server-side. The server is the authority, but
        // a round trip to be told "too short" is a worse experience than being
        // told before sending — and this is the one rule we can state exactly.
        throw core.AuthFailure(l10n.passwordTooShort);
      }
      await auth.signUpWithEmail(
        email: _email.text.trim(),
        password: _password.text,
      );
      // 🔴 AFTER THE ACCOUNT EXISTS, AND THE ORDER WAS THE OTHER WAY ROUND FOR
      // A DAY. Recording first was justified as "a user through the door with
      // no record of what they agreed to is the outcome to avoid" — true, and
      // not what recording first buys. What it bought was the opposite error,
      // and the opposite error is the unrecoverable one:
      //
      //   · the consent trail is APPEND-ONLY and keyed by `anon_id`, never by
      //     user id. A sign-up that then throws — address already registered, a
      //     server-side password rejection, a dropped connection — left a
      //     permanent `terms granted:true` and `marketing granted:true` for a
      //     registration that never happened, and `DELETE /v1/account` (keyed
      //     by user id) can never reach those rows to erase them.
      //   · worse, `accept()` sets the device stamp SYNCHRONOUSLY at its first
      //     line. So a failed sign-up satisfied the re-acceptance gate, and the
      //     same person could switch to the sign-IN tab and walk into a
      //     pre-clickwrap account with the gate already open — on the strength
      //     of an acceptance for an account that does not exist.
      //
      // The other direction costs a re-ask: if this write fails after a
      // successful sign-up, the gate stops them at the next launch and asks
      // again. That is the safe direction, it is recoverable, and it is the one
      // this flow now takes.
      //
      // ⚠️ NO FRAME CAN BE PAINTED BETWEEN THESE TWO STATEMENTS, which is why
      // the interstitial does not flash. `accept()` sets the in-memory stamp
      // before its own first `await`, and Flutter drains the microtask queue —
      // including this continuation — before it pumps a frame, so the router's
      // refresh from the new session cannot observe the gap.
      await ref
          .read(legalAcceptanceProvider.notifier)
          .accept(marketingEmail: _marketingEmail);
      // 🔴 THIS IS WHERE THE COMMENT WAS WRONG, AND IT IS WHY NOBODY LOOKED.
      // It read: "With 'Confirm email' on, that guard lands them on
      // `/verify-email`." It does not, and it cannot. With that switch ON,
      // gotrue returns a user and NO SESSION, so `currentUser` stays null — and
      // the guard's test is `sessionIsUnverified`, which answers FALSE for a
      // null user BY DESIGN (`identity_assurance.dart`: a signed-out visitor is
      // not unverified). Nothing fired, nothing moved, and this screen simply
      // re-enabled its button. MEASURED: 2 of the 4 accounts on the live
      // project are unconfirmed with `last_sign_in_at` NULL.
      //
      // So this screen navigates for exactly that state and for no other. When
      // a session DID appear the guard is still the only thing that moves the
      // user — pushing from both places is how two routes race for the top of
      // the stack.
      if (!mounted) return;
      if (auth.currentUser == null) {
        context.go('/check-inbox', extra: _email.text.trim());
      }
    } on core.AuthFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.signUpTitle)),
      // Same shape and same reasoning as LoginScreen: the error line lands
      // under the fields, so vertical centring makes the form move at exactly
      // the wrong moment. Width comes from the chassis.
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const <String>[AutofillHints.email],
                decoration: InputDecoration(labelText: l10n.email),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _password,
                obscureText: true,
                autofillHints: const <String>[AutofillHints.newPassword],
                decoration: InputDecoration(labelText: l10n.password),
                onSubmitted: (_) => _signUp(auth, l10n),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 20),
              LegalConsentFields(
                termsAccepted: _acceptedTerms,
                marketingAccepted: _marketingEmail,
                enabled: !_busy,
                onTermsChanged: (bool v) => setState(() => _acceptedTerms = v),
                onMarketingChanged: (bool v) =>
                    setState(() => _marketingEmail = v),
              ),
              const SizedBox(height: 20),
              // 🔴 DISABLED UNTIL THE TERMS BOX IS TICKED — and NOT until the
              // marketing box is. An optional consent that gates the service is
              // GDPR Art 7(4) conditionality, which research/43 declined as
              // legally unavailable rather than as a preference.
              FilledButton(
                key: SignUpScreen.submitButton,
                onPressed: (_busy || !_acceptedTerms)
                    ? null
                    : () => _signUp(auth, l10n),
                child: Text(l10n.signUp),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: _busy ? null : () => context.go('/sign-in'),
                child: Text(l10n.haveAccount),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
