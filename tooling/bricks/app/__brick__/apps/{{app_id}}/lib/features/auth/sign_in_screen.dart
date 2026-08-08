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

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
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
                autofillHints: const <String>[AutofillHints.password],
                decoration: InputDecoration(labelText: l10n.password),
                onSubmitted: (_) => _signIn(auth),
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
              // Only where the platform can actually complete a redirect.
              if (caps.oauthRedirect) ...<Widget>[
                const SizedBox(height: 8),
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
    await auth.signInWithEmail(
      email: _email.text.trim(),
      password: _password.text,
    );
    // No navigation here: the router's redirect guard moves the user the moment
    // the session appears. Pushing from both places is how you get two routes
    // racing to be the top of the stack.
  });

  Future<void> _forgot(core.AuthRepository auth, AppLocalizations l10n) =>
      _run(() async {
        final String email = _email.text.trim();
        if (email.isEmpty) throw core.AuthFailure(l10n.emailRequired);
        await auth.sendPasswordReset(email);
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(l10n.resetSent)));
      });
}
