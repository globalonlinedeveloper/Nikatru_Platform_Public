import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Sign-in — [pipeline C-13], inherited by every stamped app.
///
/// It lives in the BRICK rather than in `packages/design_system` because it
/// needs the auth seam, and the design system must stay domain-free
/// ([pipeline C-5] limb b). Every stamped app therefore gets a working sign-in
/// without writing one, which is the whole point of a chassis.
///
/// 🏗️ WHAT IS NO LONGER WRITTEN OUT HERE, AND WHY THAT MATTERS MORE THAN WHERE
/// IT WENT — [ADR 065], chassis step 2, 2026-09-04. The parts of this screen
/// that are neither auth-seam nor app-specific now live once, in
/// `packages/`, and this file composes them:
///   · the labelled, named, autofilling field → `AuthField` (design_system)
///   · the light/dark neutral resolution       → `formTones` (design_system)
///   · what a client may refuse before sending → `core.signInProblem`
///
/// The measurement that justified the move is that this file and
/// `apps/subly/lib/features/auth/login_screen.dart` are the same screen written
/// twice, and the two had been drifting at ~1.34 unpaired edits a day with NOT
/// ONE of the repository's 148 guards comparing them. Every item above was
/// present in Subly and absent here — the drift ran one way, so a stamped app
/// inherited the poorer half of a screen nobody was comparing.
///
/// ⛔ WHAT DID **NOT** MOVE, deliberately. The `caps.oauthRedirect &&
/// providers.any` gate below stays in this file and in the fork, because
/// `AuthCapabilities` is the auth SEAM and `design_system` may not see it — its
/// own limb B bans any `nikatru_`-prefixed dependency. That is also what keeps
/// `tooling/ci/assert-no-seam-forks.mjs`'s parity limb alive: it derives C from
/// the `caps.<field>` reads in THIS file and requires C ⊆ F. Move the gate into
/// a shared widget and C empties, which that guard reports as COVERAGE LOST
/// rather than as a pass — the correct outcome, and the reason the chassis
/// takes plain booleans instead of the seam.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
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

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    // What identity can actually do HERE — declared, not assumed
    // ([pipeline C-7]). Offering an OAuth button on a platform that cannot
    // complete the redirect is promising something the app cannot deliver.
    final AuthCapabilities caps = ref.watch(authCapabilitiesProvider);
    // …and whether the SERVER will accept the provider at all, which the
    // capability matrix does not describe. Both must be true; see below.
    final AuthProviders providers = ref.watch(authProvidersProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.signInTitle)),
      // 🔴 THE OUTER `Center` IS GONE ON PURPOSE, and this screen is the exact
      // case that motivates it: `_error` appears BELOW the password field, so a
      // vertically-centred form slides every field upward by half the error's
      // height the instant the user gets their password wrong — moving the
      // field they are about to correct, out from under the cursor. Top
      // alignment cannot do that. `ContentPane` also carries the 420 the
      // chassis owns, instead of a sixth private copy of it.
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
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
              //   · A KEYBOARD. `grep -c "textInputAction"` over this directory
              //     answered 0: Enter in the email box did nothing, and Enter
              //     in the password box worked only because `onSubmitted` was
              //     wired by hand here and nowhere else.
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
                onSubmitted: _busy ? null : () => _signIn(auth),
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
                onPressed: _busy ? null : () => _signIn(auth),
                child: Text(l10n.signIn),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _busy ? null : () => _forgot(auth, l10n),
                child: Text(l10n.forgotPassword),
              ),
              // 🔴 TWO CONDITIONS, BECAUSE THERE ARE TWO INDEPENDENT FACTS.
              // Only where the platform can actually complete a redirect —
              // AND only where the identity server will honour the provider.
              // `caps.oauthRedirect` alone is true on every row but fuchsia,
              // so on its own it gates nothing a stamped app ships to; a
              // disabled provider still answers 400 and the button still lies.
              // See `AuthProviders` for the live probe behind the declaration.
              if (caps.oauthRedirect && providers.any) ...<Widget>[
                const SizedBox(height: 8),
                if (providers.apple)
                  OutlinedButton(
                    onPressed: _busy ? null : () => _run(auth.signInWithApple),
                    child: Text(l10n.continueWithApple),
                  ),
              ],
              const SizedBox(height: 16),
              TextButton(
                onPressed: _busy ? null : () => context.go('/sign-up'),
                child: Text(l10n.needAccount),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _signIn(core.AuthRepository auth) => _run(() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String email = _email.text.trim();
    // 🔴 THIS SCREEN SENT WHATEVER WAS IN THE BOXES. Measured 2026-09-04:
    // `grep -c "contains('@')"` over this file answered 0, so a blank form and
    // a mistyped address both cost a round trip and came back as the server's
    // own English. `core.signInProblem` is the same rule Subly has always had,
    // now in one place — see `packages/core/lib/src/auth/credentials_preflight.dart`.
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
    await auth.signInWithEmail(email: email, password: _password.text);
    // No navigation here: the router's redirect guard moves the user the moment
    // the session appears. Pushing from both places is how you get two routes
    // racing to be the top of the stack.
  });

  Future<void> _forgot(core.AuthRepository auth, AppLocalizations l10n) =>
      _run(() async {
        final String email = _email.text.trim();
        if (core.passwordResetProblem(email: email) != null) {
          throw core.AuthFailure(l10n.emailRequired);
        }
        await auth.sendPasswordReset(email);
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(l10n.resetSent)));
      });
}
