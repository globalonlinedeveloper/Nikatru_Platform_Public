import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'auth_error_text.dart';
import 'turnstile_gate.dart' show CaptchaTokenController;

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
    this.captcha,
    this.captchaController,
    this.secondsUntilResend,
    this.onUseDifferent,
    this.panel,
    super.key,
  });

  static const Key resendButton = Key('verifyEmailResend');
  static const Key continueButton = Key('verifyEmailContinue');
  static const Key signOutButton = Key('verifyEmailSignOut');
  static const Key statusLine = Key('verifyEmailStatus');

  /// ⏱ 2026-10-01 · EN-14 — signs out to sign-up with the address filled.
  static const Key useDifferentButton = Key('verifyEmailUseDifferent');

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

  /// ST-A1: the adapter's `TurnstileGate`, rendered above Resend. The adapter
  /// owns it because it owns the token the gated callback spends.
  final Widget? captcha;

  /// The adapter's token holder, which this view WAITS on — never gates on.
  /// A gated action validates its fields first, then awaits
  /// `untilReady()` (the gate shows its wait line), then calls the adapter's
  /// callback, which spends the token with `consume()` in the same step.
  /// Null where the adapter has no captcha.
  ///
  /// ⏱ 2026-09-28 — THIS WAS `captchaReady`, AND IT DISABLED THE BUTTONS: with
  /// no token yet the action was dead, and an empty form could not even say
  /// what was missing (E2E live run 36379673890, the #1022 regression).
  final CaptchaTokenController? captchaController;

  /// ⏱ 2026-10-01 · EN-14 — whole seconds until Resend may send again, read
  /// on arrival and after each send. The adapter keeps the deadline, so leaving
  /// and coming back does not reset it: a rest held in this view's state ended
  /// with the view, and the second tap is what manufactures GoTrue's
  /// `over_email_send_rate_limit`. Null: Resend never rests.
  final int Function()? secondsUntilResend;

  /// ⏱ 2026-10-01 · EN-14 — "Use a different email": out of the unverified
  /// account and onto sign-up with the address to correct. The way out for
  /// somebody who registered with a typo. Null: no such control.
  final Future<void> Function()? onUseDifferent;

  /// The leading half of the wide split (`AuthFrame.panel`), as on
  /// `ReacceptTermsView`. Null renders the single column.
  final Widget? panel;

  @override
  State<VerifyEmailView> createState() => _VerifyEmailViewState();
}

class _VerifyEmailViewState extends State<VerifyEmailView> {
  bool _busy = false;
  String? _notice;

  /// Seconds until Resend is offered again; 0 is "now".
  int _wait = 0;
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _rest();
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  /// Seeds the countdown from the adapter's deadline and runs it down.
  void _rest() {
    _tick?.cancel();
    _wait = widget.secondsUntilResend?.call() ?? 0;
    if (_wait <= 0) return;
    _tick = Timer.periodic(const Duration(seconds: 1), (Timer t) {
      if (!mounted) return t.cancel();
      setState(() => _wait -= 1);
      if (_wait <= 0) t.cancel();
    });
  }

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

    return AuthFrame(
      panel: widget.panel,
      title: l10n.verifyEmailTitle,
      // A gate: the router re-asserts it, so a back arrow would lead nowhere.
      showBack: false,
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
          AuthMessage(message: _notice!, textKey: VerifyEmailView.statusLine),
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
                  final bool stillUnverified = await widget.onCheckConfirmed();
                  return stillUnverified
                      ? l10n.verifyEmailStillUnverified
                      : null;
                }),
          child: Text(l10n.verifyEmailContinue),
        ),
        const SizedBox(height: 12),
        ?widget.captcha,
        OutlinedButton(
          key: VerifyEmailView.resendButton,
          onPressed: (_busy || _wait > 0)
              ? null
              : () => _run(() async {
                  await widget.captchaController?.untilReady();
                  await widget.onResend();
                  if (mounted) setState(_rest);
                  return l10n.verifyEmailResent;
                }),
          child: Text(
            _wait > 0
                ? l10n.verifyEmailResendIn(
                    '${_wait ~/ 60}:${(_wait % 60).toString().padLeft(2, '0')}',
                  )
                : l10n.verifyEmailResend,
          ),
        ),
        if (widget.onUseDifferent
            case final Future<void> Function() go) ...<Widget>[
          const SizedBox(height: 12),
          TextButton(
            key: VerifyEmailView.useDifferentButton,
            onPressed: _busy
                ? null
                : () => _run(() async {
                    await go();
                    return null;
                  }),
            child: Text(l10n.verifyEmailUseDifferent),
          ),
        ],
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
    );
  }
}
