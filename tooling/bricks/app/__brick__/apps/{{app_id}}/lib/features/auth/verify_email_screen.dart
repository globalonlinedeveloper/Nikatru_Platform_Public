import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// "Check your inbox" — the only screen an UNVERIFIED session can reach.
///
/// 🔴 IT IS A SCREEN, NOT A BANNER, AND THAT IS THE LOCK. Email verification is
/// MANDATORY for email+password registration (owner, 2026-08-09 late), because
/// email is the matching key the one-identity lock merges social identities on:
/// an address nobody proved is a route into somebody else's Google/Apple
/// account. A dismissible nudge over a working app is not that rule.
///
/// ⚠️ THE SERVER HALF IS A PER-PROJECT LIVE ACT — Supabase → Authentication →
/// Sign In / Providers → **Confirm email ON**, once per stamped app's project.
/// This screen is correct either way and neither half is redundant: with the
/// switch OFF gotrue returns a full session on sign-up and this gate is the only
/// refusal in the system; with it ON the honest screen for an unconfirmed
/// session is this one rather than a home screen that half-works.
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

  /// Runs [action] with the busy flag held and the outcome shown INLINE.
  ///
  /// Inline rather than a SnackBar: pressing "I've confirmed" successfully
  /// REPLACES this page via the router's gate, and a SnackBar riding on a page
  /// being torn down is a message nobody reads ([ADR 027]'s lesson, applied
  /// before it has to be relearned).
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
      if (mounted) setState(() => _notice = e.message);
    } catch (e) {
      if (mounted) setState(() => _notice = '$e');
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
              // A RUNNING APP. The link is opened in a MAIL CLIENT, often on
              // another device, so the session in memory says unverified until
              // something asks the server again. Without this control the only
              // way out is to kill the app and relaunch it, which reads as the
              // app being broken.
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
              OutlinedButton(
                key: VerifyEmailScreen.resendButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                        await auth.resendVerificationEmail();
                        return l10n.verifyEmailResent;
                      }),
                child: Text(l10n.verifyEmailResend),
              ),
              const SizedBox(height: 12),
              // The only way OUT of the gate. A user who mistyped their address
              // has no other move — the account exists, they cannot reach the
              // app, and without this the app is a locked door with no handle.
              TextButton(
                key: VerifyEmailScreen.signOutButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                        await auth.signOut();
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
