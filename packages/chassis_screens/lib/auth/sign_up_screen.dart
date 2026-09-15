import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'age_signal_host.dart';
import 'legal_consent_fields.dart';

/// Sign-up — [pipeline C-13], inherited by every stamped app.
///
/// 🏗️ THE BODY OF `SignUpScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. Both consent flags moved with the boxes they belong to;
/// `assert-signup-consent-shape.mjs` follows the delegation and reads the
/// adapter UNIONED with this file, so limbs 1, 2 and 3 all still land on the
/// lines that decide them.
///
/// 🔴 CARRIES THE BLOCKING TERMS CLICKWRAP AND THE EXPRESS MARKETING OPT-IN
/// (research/43 + research/44 riders, owner 2026-08-09). Both boxes arrive
/// UNTICKED; the terms box blocks the button and the marketing box may not.
/// See `legal_consent_fields.dart` for why they are two different legal animals.
///
/// ⛔ WHAT DID **NOT** MOVE. The order of "create the account, THEN record the
/// consent" and the no-session navigation both live in the adapter's
/// [onSignUp], because both are statements about providers and routes. The
/// reasoning for the order is written there, beside the code that implements it.
class SignUpView extends StatefulWidget {
  const SignUpView({
    required this.onSignUp,
    required this.onHaveAccount,
    required this.consentFields,
    this.ageSignals,
    super.key,
  });

  static const Key submitButton = Key('signUpSubmit');
  static const Key emailField = Key('signUpEmail');
  static const Key passwordField = Key('signUpPassword');
  static const Key haveAccountButton = Key('signUpHaveAccount');

  /// Creates the account, records the consent and navigates for the
  /// no-session case. Throws `core.AuthFailure` with a message to show.
  final Future<void> Function({
    required String email,
    required String password,
    required bool marketingEmail,
  }) onSignUp;

  /// "I already have an account" — the way to the sign-in door.
  final VoidCallback onHaveAccount;

  /// Renders the tick boxes — see [ConsentFieldsBuilder] for why the ADAPTER
  /// builds them and this surface only owns the flags.
  final ConsentFieldsBuilder consentFields;

  /// ⏱ 2026-09-15 · [ADR 082] §5. The store age signal read before the account
  /// is created. Null reads [defaultAgeSignalSource] for the running host.
  final core.AgeSignalSource? ageSignals;

  @override
  State<SignUpView> createState() => _SignUpViewState();
}

class _SignUpViewState extends State<SignUpView> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  /// 🔴 BOTH FALSE, ALWAYS. `assert-signup-consent-shape.mjs` fails the build
  /// if either initialiser ever says `true` — a pre-ticked consent is a dark
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

  Future<void> _signUp(ChassisLocalizations l10n) async {
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
      // ⏱ 2026-09-15 · [ADR 082] §5 — THE STORE AGE GATE, BEFORE ANYTHING IS
      // CREATED. Below adult: no account and no terms recorded (`onSignUp` is
      // what does both, so it is never called). No signal: proceed on the 18+
      // declaration the terms box above already carries.
      final core.AgeSignal signal = await core.readAgeSignal(
        widget.ageSignals ?? defaultAgeSignalSource(),
      );
      if (core.signUpAgeGate(signal) == core.SignUpAgeGate.refuse) {
        throw core.AuthFailure(l10n.signUpAgeRefused);
      }
      await widget.onSignUp(
        email: _email.text.trim(),
        password: _password.text,
        marketingEmail: _marketingEmail,
      );
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
    final ChassisLocalizations l10n = context.chassisL10n;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.signUpTitle)),
      // Same shape and same reasoning as the sign-in screen: the error line
      // lands under the fields, so vertical centring makes the form move at
      // exactly the wrong moment. Width comes from the chassis.
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              TextField(
                key: SignUpView.emailField,
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const <String>[AutofillHints.email],
                decoration: InputDecoration(labelText: l10n.email),
              ),
              const SizedBox(height: 12),
              TextField(
                key: SignUpView.passwordField,
                controller: _password,
                obscureText: true,
                autofillHints: const <String>[AutofillHints.newPassword],
                decoration: InputDecoration(labelText: l10n.password),
                onSubmitted: (_) => _signUp(l10n),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 20),
              widget.consentFields(
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
                key: SignUpView.submitButton,
                onPressed:
                    (_busy || !_acceptedTerms) ? null : () => _signUp(l10n),
                child: Text(l10n.signUp),
              ),
              const SizedBox(height: 16),
              TextButton(
                key: SignUpView.haveAccountButton,
                onPressed: _busy ? null : widget.onHaveAccount,
                child: Text(l10n.haveAccount),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
