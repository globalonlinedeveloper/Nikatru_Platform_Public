import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'auth_error_text.dart';

/// "Check your inbox" — the only screen an UNVERIFIED session can reach.
///
/// 🏗️ THE BODY OF `VerifyEmailScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. The three seam calls stayed in the brick adapter, where the
/// providers are: this widget takes them as callbacks and owns nothing but the
/// busy latch, the inline notice and the layout.
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
class VerifyEmailView extends StatefulWidget {
  const VerifyEmailView({
    required this.email,
    required this.onCheckConfirmed,
    required this.onResend,
    required this.onSignOut,
    super.key,
  });

  static const Key resendButton = Key('verifyEmailResend');
  static const Key continueButton = Key('verifyEmailContinue');
  static const Key signOutButton = Key('verifyEmailSignOut');
  static const Key statusLine = Key('verifyEmailStatus');

  /// The address the mail went to. Naming it is how a mistyped one is seen.
  final String email;

  /// Asks the SERVER again. Answers `true` when the session is STILL
  /// unverified, which is a real answer and not an error — the router leaves
  /// the user here and the notice says why.
  final Future<bool> Function() onCheckConfirmed;

  /// Sends the verification mail again.
  final Future<void> Function() onResend;

  /// The only way OUT of the gate. Goes through the SPINE in the adapter, not
  /// through a bare `signOut()` — see there for why.
  final Future<void> Function() onSignOut;

  @override
  State<VerifyEmailView> createState() => _VerifyEmailViewState();
}

class _VerifyEmailViewState extends State<VerifyEmailView> {
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
    } catch (e) {
      // ⏱ 2026-09-24 — ONE arm, through the mapper. `resend` is captcha-gated
      // on the self-hosted server, and this printed its refusal as written.
      if (mounted) {
        setState(() => _notice = authErrorText(context.chassisL10n, e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;

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
                l10n.verifyEmailBody(widget.email),
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
                  key: VerifyEmailView.statusLine,
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
                key: VerifyEmailView.continueButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          final bool stillUnverified =
                              await widget.onCheckConfirmed();
                          return stillUnverified
                              ? l10n.verifyEmailStillUnverified
                              : null;
                        }),
                child: Text(l10n.verifyEmailContinue),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                key: VerifyEmailView.resendButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          await widget.onResend();
                          return l10n.verifyEmailResent;
                        }),
                child: Text(l10n.verifyEmailResend),
              ),
              const SizedBox(height: 12),
              // The only way OUT of the gate. A user who mistyped their address
              // has no other move — the account exists, they cannot reach the
              // app, and without this the app is a locked door with no handle.
              TextButton(
                key: VerifyEmailView.signOutButton,
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          await widget.onSignOut();
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
