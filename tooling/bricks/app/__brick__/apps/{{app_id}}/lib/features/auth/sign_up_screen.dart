import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Sign-up — [pipeline C-13], inherited by every stamped app.
class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen> {
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

  Future<void> _signUp(core.AuthRepository auth, AppLocalizations l10n) async {
    if (_busy) return;
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
      // The redirect guard takes it from here — see SignInScreen.
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
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
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
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _busy ? null : () => _signUp(auth, l10n),
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
      ),
    );
  }
}
