import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'age_signal_host.dart';

/// Sign-in — [pipeline C-13], inherited by every stamped app.
///
/// 🏗️ THE BODY OF `SignInScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. It could not live in `packages/design_system`, and that is
/// measured rather than asserted: the design system may not see the domain
/// (`assert-package-boundaries.mjs` limb B), so every core type — a
/// `CredentialsProblem`, an `AccountDeletionOutcome` — would have to be mapped
/// down to plain values BY THE ADAPTER, which is exactly the cost that made
/// both earlier shared-widget adoptions GROW the call site (+136, +148,
/// [ADR 066]). This package can see core, so the mapping stays out of the brick.
///
/// ⛔ WHAT DID **NOT** MOVE, deliberately, and each for a named guard:
///   · the `caps.oauthRedirect && providers.any` READ stays in the adapter.
///     `assert-no-seam-forks.mjs`'s parity limb derives C from the `caps.<field>`
///     reads on the chassis side and requires C ⊆ F against Subly's fork; the
///     limb reports COVERAGE LOST when C is empty, and it NAMES THE ADAPTER when
///     it does. Keeping the read where the guard points is not decoration.
///   · `signInWithEmail(` stays in the adapter. `dod.json:75` anchors the
///     auth-redirect proof at `lib/features/auth/sign_in_screen.dart:
///     signInWithEmail`, and `assert-app-dod.mjs:836` fails when that symbol
///     stops appearing in that file outside comments.
///   · every navigation, for the usual reason: this package declares no
///     go_router, which is what keeps it out of the adapter set.
///
/// 🔴 THE OUTER `Center` IS GONE ON PURPOSE, and this screen is the exact case
/// that motivates it: [error] appears BELOW the password field, so a
/// vertically-centred form slides every field upward by half the error's height
/// the instant the user gets their password wrong — moving the field they are
/// about to correct, out from under the cursor. Top alignment cannot do that.
/// `ContentPane` also carries the 420 the chassis owns, instead of a sixth
/// private copy of it.
class SignInView extends StatefulWidget {
  const SignInView({
    required this.onSignIn,
    required this.onForgotPassword,
    required this.onNeedAccount,
    required this.showAppleButton,
    required this.onSignInWithApple,
    this.ageSignals,
    this.deletion,
    this.deletionDetail,
    this.onDismissDeletionNotice,
    super.key,
  });

  static const Key emailField = Key('signInEmail');
  static const Key passwordField = Key('signInPassword');
  static const Key submitButton = Key('signInSubmit');
  static const Key forgotButton = Key('signInForgot');
  static const Key needAccountButton = Key('signInNeedAccount');
  static const Key appleButton = Key('signInApple');

  /// Sends the credentials. Throws `core.AuthFailure` with a message to show.
  /// The client-side preflight below runs FIRST and never reaches this.
  final Future<void> Function(String email, String password) onSignIn;

  /// Asks for a recovery mail. Throws `core.AuthFailure` with a message.
  final Future<void> Function(String email) onForgotPassword;

  /// "I need an account" — the way to the sign-up door.
  final VoidCallback onNeedAccount;

  /// 🔴 TWO CONDITIONS COLLAPSED INTO ONE BOOLEAN BY THE ADAPTER, BECAUSE THERE
  /// ARE TWO INDEPENDENT FACTS. Only where the platform can actually complete a
  /// redirect — AND only where the identity server will honour the provider.
  /// `caps.oauthRedirect` alone is true on every row but fuchsia, so on its own
  /// it gates nothing a stamped app ships to; a disabled provider still answers
  /// 400 and the button still lies.
  final bool showAppleButton;

  final Future<void> Function() onSignInWithApple;

  /// ⏱ 2026-09-15 · [ADR 082] §5. Read before Sign in with Apple, which can
  /// create an account. Null reads [defaultAgeSignalSource] for the running host.
  final core.AgeSignalSource? ageSignals;

  /// 🔴 WHAT HAPPENED TO THE ACCOUNT THEY JUST ASKED US TO DELETE.
  ///
  /// `deleteAccount()` signs the user out whichever way the request went, so
  /// the router lands them HERE — and takes the settings screen, its dialog and
  /// any SnackBar with it. This is the surface the redirect arrives on, which is
  /// the only reason the outcome is readable at all. [ADR 027]
  final core.AccountDeletionOutcome? deletion;
  final String? deletionDetail;
  final VoidCallback? onDismissDeletionNotice;

  @override
  State<SignInView> createState() => _SignInViewState();
}

class _SignInViewState extends State<SignInView> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  String? _error;

  /// Where Enter goes from the email box.
  ///
  /// Held on the state rather than created inline because a `FocusNode` built
  /// in `build` is a NEW node on every rebuild, and this screen rebuilds on
  /// every `_busy` flip and every error: the node the email field asked to
  /// focus would already have been discarded.
  final FocusNode _passwordFocus = FocusNode();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  /// Runs [action] with the button disabled and any failure surfaced.
  ///
  /// The busy latch is not decoration: without it a double-tap fires two
  /// sign-ins, and the second can land after the first has already navigated.
  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on core.AuthFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _appleGated(ChassisLocalizations l10n) async {
    // ⏱ 2026-09-15 · [ADR 082] §5 — Sign in with Apple CAN CREATE AN ACCOUNT, so it
    // passes the store age gate BEFORE the provider is called. Whether this tap
    // creates an account or signs into one is only knowable after the OAuth
    // redirect returns, so the gate runs for both: a store signal below adult
    // refuses the tap outright, and no identity is ever created to delete.
    final core.AgeSignal signal = await core.readAgeSignal(
      widget.ageSignals ?? defaultAgeSignalSource(),
    );
    if (core.signUpAgeGate(signal) == core.SignUpAgeGate.refuse) {
      throw core.AuthFailure(l10n.signUpAgeRefused);
    }
    await widget.onSignInWithApple();
  }

  Future<void> _signIn(ChassisLocalizations l10n) => _run(() async {
        final String email = _email.text.trim();
        // 🔴 THIS SCREEN SENT WHATEVER WAS IN THE BOXES. Measured 2026-09-04:
        // `grep -c "contains('@')"` over it answered 0, so a blank form and a
        // mistyped address both cost a round trip and came back as the server's own
        // English. `core.signInProblem` is the same rule Subly has always had, now
        // in one place — see `packages/core/lib/src/auth/credentials_preflight.dart`.
        //
        // ⚠️ IT THROWS RATHER THAN RETURNING, because `_run` is what turns a
        // failure into the message under the fields. An early `return` here would
        // clear `_busy` and say nothing at all, which is the shape of a button that
        // looks broken.
        final core.CredentialsProblem? problem = core.signInProblem(
          email: email,
          password: _password.text,
        );
        if (problem != null) {
          throw core.AuthFailure(switch (problem) {
            core.CredentialsProblem.incomplete => l10n.authEnterBoth,
            core.CredentialsProblem.emailMalformed => l10n.authInvalidEmail,
            // Unreachable from this door, stated rather than defaulted so a future
            // arm cannot land here wearing the wrong sentence.
            core.CredentialsProblem.emailMissing => l10n.emailRequired,
          });
        }
        await widget.onSignIn(email, _password.text);
        // No navigation here: the router's redirect guard moves the user the moment
        // the session appears. Pushing from both places is how you get two routes
        // racing to be the top of the stack.
      });

  Future<void> _forgot(ChassisLocalizations l10n) => _run(() async {
        final String email = _email.text.trim();
        if (core.passwordResetProblem(email: email) != null) {
          throw core.AuthFailure(l10n.emailRequired);
        }
        await widget.onForgotPassword(email);
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(l10n.resetSent)));
      });

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.signInTitle)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              // ⚠️ ABOVE THE FIELDS, NOT BELOW THEM. It is the answer to
              // something the user did on a different screen, so it has to be
              // the first thing on this one; under the button it would be read
              // after they had already started typing a password into an
              // account that may no longer exist.
              //
              // Renders NOTHING when there is nothing to say, which is every
              // arrival except the one after a deletion.
              DestructiveOutcomeNotice(
                report: widget.deletion == null
                    ? null
                    : DestructiveActionReport(
                        message: widget.deletion!.plainMessage,
                        succeeded: widget.deletion!.accountIsGone,
                      ),
                detail: widget.deletionDetail,
                // ⚠️ THE RIGHT WORD FROM THE WRONG KEY, and it is flagged
                // rather than hidden: `catchUpDismiss` is "Got it", which is
                // exactly the label this control wants, but the arb has no
                // `close` of its own. Adding one is a one-line change in both
                // locales and this call site is where it lands.
                dismissLabel: l10n.catchUpDismiss,
                onDismiss: widget.onDismissDeletionNotice ?? () {},
              ),
              // 🔴 `AuthField`, NOT A BARE `TextField`, AND THE DIFFERENCE IS
              // MEASURED. Until 2026-09-04 ([ADR 065], chassis step 2) these
              // were two plain boxes with `labelText` and nothing else, so
              // every stamped app was born without three things this chassis
              // is supposed to hand it for free:
              //   · A NAME AFTER THE FIRST KEYSTROKE. `labelText` floats out of
              //     the way when the field has content and the hint fades —
              //     semantics and all — so a screen-reader user heard the box
              //     announced as nothing from the second character onward.
              //     `AuthField` annotates the name onto the field and merges
              //     it, so label, role and value are one node at every state.
              //   · A KEYBOARD. `grep -c "textInputAction"` over the auth
              //     directory answered 0: Enter in the email box did nothing.
              //   · THE APP'S OWN SURFACE COLOURS. A bare `TextField` paints
              //     Material's defaults, which is why a stamped app never
              //     looked like the design system it ships with.
              //
              // ⚠️ THE TWO BOXES ANSWER THE KEYBOARD DIFFERENTLY ON PURPOSE and
              // `AuthField` defaults NEITHER, so both are stated here. Enter in
              // the email box ADVANCES: submitting from it would always be the
              // "enter both" refusal, because the password box is by definition
              // still empty.
              AuthField(
                key: SignInView.emailField,
                label: l10n.email,
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                hint: null,
                autofillHints: const <String>[AutofillHints.email],
                textInputAction: TextInputAction.next,
                onSubmitted: _passwordFocus.requestFocus,
              ),
              const SizedBox(height: 12),
              AuthField(
                key: SignInView.passwordField,
                label: l10n.password,
                controller: _password,
                keyboardType: TextInputType.text,
                obscure: true,
                focusNode: _passwordFocus,
                // `password`, NOT `newPassword`: this is the sign-IN box, and
                // `newPassword` asks the browser to offer a generated secret
                // and to suppress the stored one. The dedicated sign-up screen
                // is where that hint belongs.
                autofillHints: const <String>[AutofillHints.password],
                textInputAction: TextInputAction.done,
                // The same door as the button, busy latch included — `_signIn`
                // routes through `_run`, so a second Enter cannot fire a second
                // request.
                onSubmitted: _busy ? null : () => _signIn(l10n),
              ),
              if (_error != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton(
                key: SignInView.submitButton,
                onPressed: _busy ? null : () => _signIn(l10n),
                child: Text(l10n.signIn),
              ),
              const SizedBox(height: 8),
              TextButton(
                key: SignInView.forgotButton,
                onPressed: _busy ? null : () => _forgot(l10n),
                child: Text(l10n.forgotPassword),
              ),
              if (widget.showAppleButton) ...<Widget>[
                const SizedBox(height: 8),
                OutlinedButton(
                  key: SignInView.appleButton,
                  onPressed:
                      _busy ? null : () => _run(() => _appleGated(l10n)),
                  child: Text(l10n.continueWithApple),
                ),
              ],
              const SizedBox(height: 16),
              TextButton(
                key: SignInView.needAccountButton,
                onPressed: _busy ? null : widget.onNeedAccount,
                child: Text(l10n.needAccount),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
