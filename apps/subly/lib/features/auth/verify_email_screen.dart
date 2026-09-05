import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import 'turnstile_gate.dart';
import 'auth_error_text.dart';

/// "Check your inbox" — the only screen an UNVERIFIED session can reach.
///
/// 🔴 IT IS A SCREEN, NOT A BANNER, AND THAT IS THE LOCK. Email verification is
/// MANDATORY for email+password registration (owner, 2026-08-09 late), because
/// email is the matching key the one-identity lock merges social identities on:
/// an address nobody proved is a route into somebody else's Google/Apple
/// account. A dismissible nudge over a working app is not that rule.
///
/// ⚠️ THE SERVER HALF IS THE INTEGRATOR'S LIVE ACT — Supabase → Authentication →
/// Sign In / Providers → **Confirm email ON**. Unchecked as of the lock being
/// written. This screen is correct either way and neither half is redundant:
/// with the switch OFF gotrue returns a full session on sign-up and this gate is
/// the only refusal in the system; with it ON the honest screen for a session
/// whose address is unconfirmed is this one rather than a home screen that
/// half-works.
///
/// ⚠️ AND THE E2E SUITE PROVES NOTHING ABOUT ANY OF IT. It creates its users
/// through the admin API, which bypasses confirmation entirely. The pin is
/// `test/legal_gates_test.dart`, group (a).
class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key});

  static const Key resendButton = Key('verifyEmailResend');
  static const Key continueButton = Key('verifyEmailContinue');
  static const Key signOutButton = Key('verifyEmailSignOut');
  static const Key statusLine = Key('verifyEmailStatus');

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  bool _busy = false;
  String? _notice;

  /// See `login_screen.dart` for the full note. Null today; required after the
  /// cutover, because `resend` is one of the six captcha-gated endpoints.
  String? _captchaToken;

  /// Runs [action] with the busy flag held and the outcome shown inline.
  ///
  /// Inline rather than a SnackBar for the same reason the account-deletion
  /// notice is inline ([ADR 027]): pressing "I've confirmed" successfully
  /// REPLACES this page via the router's gate, and a SnackBar riding on a page
  /// that is being torn down is a message nobody reads.
  Future<void> _run(Future<String?> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      final String? message = await action();
      if (mounted) setState(() => _notice = message);
    } on core.AuthFailure catch (e) {
      // Was `_notice = e.message`. `resendVerificationEmail` hits `resend`, which
      // Box A gates, so this is one of the two screens the captcha actually reaches.
      if (mounted) {
        setState(
          () => _notice = authErrorText(AppLocalizations.of(context), e),
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _notice = AppLocalizations.of(context).authUnknownError);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    final String email = auth.currentUser?.email ?? '';

    return Scaffold(
      appBar: AppBar(title: Text(l10n.verifyEmailTitle)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                l10n.verifyEmailBody(email),
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 8),
              Text(
                l10n.verifyEmailSpamHint,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (_notice != null) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  _notice!,
                  key: VerifyEmailScreen.statusLine,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
              const SizedBox(height: 20),
              // 🔴 "I'VE CONFIRMED" EXISTS BECAUSE NOTHING PUSHES THE ANSWER AT
              // A RUNNING APP. The link is opened in a MAIL CLIENT — often on
              // another device — so the session in memory goes on saying
              // unverified until something asks the server again. Without this
              // control the only way out is to kill the app and relaunch it,
              // which reads as the app being broken.
              FilledButton(
                key: VerifyEmailScreen.continueButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                        final core.AuthUser? fresh = await auth.reloadUser();
                        // Still unverified is a real answer, not an error: the
                        // router leaves them here and this says why.
                        return core.sessionIsUnverified(fresh)
                            ? l10n.verifyEmailStillUnverified
                            : null;
                      }),
                child: Text(l10n.verifyEmailContinue),
              ),
              const SizedBox(height: 12),
              // The resend endpoint is captcha-gated too, so the button needs
              // a token like every other door. Renders nothing without a key.
              TurnstileGate(
                onToken: (String? t) => setState(() => _captchaToken = t),
              ),
              OutlinedButton(
                key: VerifyEmailScreen.resendButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                        await auth.resendVerificationEmail(
                          captchaToken: _captchaToken,
                        );
                        return l10n.verifyEmailResent;
                      }),
                child: Text(l10n.verifyEmailResend),
              ),
              const SizedBox(height: 12),
              // The only way OUT of the gate. A user who mistyped their address
              // has no other move — the account exists, they cannot reach the
              // app, and without this the app is a locked door with no handle.
              //
              // 🔴 THROUGH [signOutAndForgetUser], not `auth.signOut()`. It is a
              // session-ending control like the one in settings, so it owes the
              // device the same forget; it was left on the bare call and the
              // previous user's cached Pro survived it. `_run` invokes this
              // closure with nothing awaited before it, so the provider reads
              // inside still happen while this element is mounted — the deadline
              // [userStateDrops] exists for.
              TextButton(
                key: VerifyEmailScreen.signOutButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                        await signOutAndForgetUser(ref);
                        return null;
                      }),
                child: Text(l10n.signOut),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
