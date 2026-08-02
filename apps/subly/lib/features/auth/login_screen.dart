import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/config/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../state/providers.dart';
import '../shared/widgets.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _loading = false;
  bool _signUp = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String email = _email.text.trim();
    if (email.isEmpty || _password.text.isEmpty) {
      _snack('Enter your email and password.');
      return;
    }
    if (!email.contains('@') || !email.contains('.')) {
      _snack('Enter a valid email address.');
      return;
    }
    setState(() => _loading = true);
    final auth = ref.read(authRepositoryProvider);
    try {
      if (_signUp) {
        await auth.signUpWithEmail(
          email: _email.text.trim(),
          password: _password.text,
        );
      } else {
        await auth.signInWithEmail(
          email: _email.text.trim(),
          password: _password.text,
        );
      }
      if (mounted) context.go('/scan');
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _apple() async {
    setState(() => _loading = true);
    final auth = ref.read(authRepositoryProvider);
    try {
      await auth.signInWithApple();
      if (mounted && auth.currentUser != null) context.go('/scan');
    } catch (e) {
      _snack(e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _snack(Object e) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(_friendlyMessage(e))));
  }

  /// Maps raw auth/network errors onto short, human messages so users never see
  /// a stack-tracey exception (e.g. Supabase's invalid_credentials).
  String _friendlyMessage(Object e) {
    if (e is String) return e;
    final String raw = e.toString().toLowerCase();
    if (raw.contains('invalid_credentials') || raw.contains('invalid login')) {
      return 'Incorrect email or password.';
    }
    if (raw.contains('already registered') ||
        raw.contains('already been registered') ||
        raw.contains('user_already_exists')) {
      return 'That email is already registered — try signing in.';
    }
    if (raw.contains('weak_password') || raw.contains('password should be')) {
      return 'Password must be at least 6 characters.';
    }
    if (raw.contains('email_not_confirmed') || raw.contains('not confirmed')) {
      return 'Please confirm your email, then sign in.';
    }
    if (raw.contains('rate limit') || raw.contains('over_email_send')) {
      return 'Too many attempts — please wait a moment and try again.';
    }
    if (raw.contains('socketexception') ||
        raw.contains('failed host lookup') ||
        raw.contains('connection') ||
        raw.contains('network')) {
      return 'Network error — check your connection and try again.';
    }
    return 'Something went wrong. Please try again.';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(28, 40, 28, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  gradient: AppColors.brandGradient,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Text(
                  '◈',
                  style: TextStyle(fontSize: 24, color: Colors.white),
                ),
              ),
              const SizedBox(height: 22),
              // 🔴 WHAT HAPPENED TO THE ACCOUNT THEY JUST ASKED US TO DELETE.
              //
              // `deleteAccount()` signs out whichever way the request went, so
              // the router lands the user HERE — and takes the settings screen,
              // its dialog and any SnackBar with it. Measured, not assumed: the
              // router-driven test in test/delete_account_test.dart found ZERO
              // result widgets after the redirect settled. So the message that
              // matters most (502: your data is gone and your login still
              // works) was the one message nobody ever saw. [ADR 027]
              const _AccountDeletionNotice(),
              Text(
                _signUp ? 'Create account' : 'Welcome back',
                style: AppText.title.copyWith(fontSize: 34),
              ),
              const SizedBox(height: 6),
              Text(
                _signUp
                    ? 'Start tracking every subscription in one place.'
                    : 'Sign in to keep your money in check.',
                style: AppText.muted.copyWith(fontSize: 15),
              ),
              const SizedBox(height: 28),
              _field(
                'EMAIL',
                _email,
                TextInputType.emailAddress,
                fieldKey: E2EKeys.loginEmail,
                hint: 'you@email.com',
              ),
              const SizedBox(height: 14),
              _field(
                'PASSWORD',
                _password,
                TextInputType.text,
                obscure: true,
                fieldKey: E2EKeys.loginPassword,
                hint: 'Your password',
              ),
              if (!_signUp)
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton(
                    onPressed: () async {
                      await ref
                          .read(authRepositoryProvider)
                          .sendPasswordReset(_email.text.trim());
                      _snack('Password reset sent (demo).');
                    },
                    child: Text(
                      'Forgot password?',
                      style: AppText.body.copyWith(
                        color: AppColors.accent,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 12),
              GradientButton(
                key: E2EKeys.loginSubmit,
                label: _loading
                    ? 'Please wait…'
                    : (_signUp ? 'Create account' : 'Sign in'),
                onPressed: _loading ? null : _submit,
              ),
              const SizedBox(height: 20),
              Row(
                children: const <Widget>[
                  Expanded(child: Divider(color: AppColors.line)),
                  Padding(
                    padding: EdgeInsets.symmetric(horizontal: 12),
                    child: Text('or', style: TextStyle(color: AppColors.muted)),
                  ),
                  Expanded(child: Divider(color: AppColors.line)),
                ],
              ),
              const SizedBox(height: 20),
              SoftButton(
                label: '  Continue with Apple',
                onPressed: _loading ? null : _apple,
              ),
              const SizedBox(height: 24),
              Center(
                child: GestureDetector(
                  onTap: () => setState(() => _signUp = !_signUp),
                  child: Text.rich(
                    TextSpan(
                      text: _signUp ? 'Have an account? ' : 'New here? ',
                      style: AppText.muted.copyWith(fontSize: 14),
                      children: <InlineSpan>[
                        TextSpan(
                          text: _signUp ? 'Sign in' : 'Create account',
                          style: const TextStyle(
                            fontFamily: 'Manrope',
                            fontWeight: FontWeight.w800,
                            color: AppColors.accent,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 30),
              const Center(child: PoweredByNikatru()),
            ],
          ),
        ),
      ),
    );
  }

  Widget _field(
    String label,
    TextEditingController c,
    TextInputType type, {
    bool obscure = false,
    Key? fieldKey,
    String? hint,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(label, style: AppText.label),
        const SizedBox(height: 7),
        TextField(
          key: fieldKey,
          controller: c,
          obscureText: obscure,
          keyboardType: type,
          style: AppText.body.copyWith(fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: AppText.muted.copyWith(fontWeight: FontWeight.w500),
            filled: true,
            fillColor: AppColors.surface,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 15,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.line),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: AppColors.accent, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }
}

/// The deletion outcome, rendered where the sign-out redirect cannot reach it.
///
/// Inline rather than a dialog, deliberately: a dialog here is another PAGELESS
/// ROUTE, and this widget exists precisely because a pageless route was carried
/// away by a page change. It sits until the user dismisses it — clearing the
/// provider, so it cannot resurface at some later sign-out. [ADR 027]
class _AccountDeletionNotice extends ConsumerWidget {
  const _AccountDeletionNotice();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.AccountDeletionOutcome? outcome = ref.watch(
      lastAccountDeletionOutcomeProvider,
    );
    if (outcome == null) return const SizedBox.shrink();
    return Container(
      key: const Key('accountDeletionNotice'),
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: outcome.accountIsGone ? AppColors.line : AppColors.danger,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            outcome.accountIsGone ? 'Account deleted' : 'Not deleted',
            style: AppText.body.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            outcome.plainMessage,
            key: const Key('accountDeletionNoticeText'),
            style: AppText.muted.copyWith(fontSize: 13),
          ),
          if (!outcome.accountIsGone) ...<Widget>[
            const SizedBox(height: 6),
            // No turnaround time and no retention period: the published page
            // states none, and an app inventing one commits us to it.
            Text(
              'Email ${AppConfig.supportEmail} and we will finish it.',
              style: AppText.muted.copyWith(fontSize: 13),
            ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () =>
                  ref.read(lastAccountDeletionOutcomeProvider.notifier).state =
                      null,
              child: const Text('Dismiss'),
            ),
          ),
        ],
      ),
    );
  }
}
