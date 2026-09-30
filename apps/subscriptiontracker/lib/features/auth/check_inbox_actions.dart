import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing, AuthMessage;

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import 'auth_error_sentence.dart';
import 'turnstile_gate.dart';

/// ST-A5 (audit A-6): the two moves "check your inbox" was missing — send the
/// confirmation again, and fix a mistyped address.
///
/// The only action was "Back to sign in", so a mail that never arrived, or
/// went to a typo, left the user with nothing to do. The resend takes the
/// address this screen names (there is no session to read one from); it is
/// captcha-gated like every other sign-up call and spends its token. Its own
/// file rather than lines in `check_inbox_screen.dart`, which is a private
/// copy of a chassis screen and may not grow (assert-chassis-parity).
class CheckInboxActions extends ConsumerStatefulWidget {
  const CheckInboxActions({required this.email, super.key});

  static const Key resendButton = Key('checkInboxResend');
  static const Key changeEmailButton = Key('checkInboxChangeEmail');
  static const Key noticeLine = Key('checkInboxNotice');

  /// ⏱ 2026-09-29 · ST-D10 (`CheckInbox`: "Resend link in 0:24"). How long the
  /// resend rests after a mail was SENT. A resend that failed rests not at all
  /// — the user has nothing in their inbox to wait for.
  static const Duration cooldown = Duration(seconds: 30);

  final String email;

  @override
  ConsumerState<CheckInboxActions> createState() => _CheckInboxActionsState();
}

class _CheckInboxActionsState extends ConsumerState<CheckInboxActions>
    with CaptchaHost<CheckInboxActions> {
  bool _busy = false;
  String? _notice;

  /// Seconds until the resend is offered again; 0 is "now".
  int _wait = 0;
  Timer? _tick;

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  void _rest() {
    _tick?.cancel();
    setState(() => _wait = CheckInboxActions.cooldown.inSeconds);
    _tick = Timer.periodic(const Duration(seconds: 1), (Timer t) {
      if (!mounted) return t.cancel();
      setState(() => _wait -= 1);
      if (_wait <= 0) t.cancel();
    });
  }

  Future<void> _resend() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _notice = null;
    });
    String notice;
    bool sent = false;
    try {
      // Waits for the challenge rather than disabling the button on it
      // (2026-09-28); `CaptchaUnavailable` becomes the retry sentence below.
      await captcha.untilReady();
      await ref
          .read(authRepositoryProvider)
          .resendSignUpConfirmation(
            widget.email,
            captchaToken: captcha.consume(),
          );
      notice = l10n.verifyEmailResent;
      sent = true;
    } catch (e) {
      notice = mounted ? authErrorSentence(context, e) : '';
    }
    if (mounted) {
      setState(() {
        _busy = false;
        _notice = notice;
      });
      if (sent) _rest();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TurnstileGate(controller: captcha, render: renderTurnstile),
        OutlinedButton(
          key: CheckInboxActions.resendButton,
          onPressed: (_busy || _wait > 0) ? null : _resend,
          child: Text(
            _wait > 0
                ? l10n.checkInboxResendIn(
                    '${_wait ~/ 60}:${(_wait % 60).toString().padLeft(2, '0')}',
                  )
                : l10n.verifyEmailResend,
          ),
        ),
        if (_notice != null) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          AuthMessage(message: _notice!, textKey: CheckInboxActions.noticeLine),
        ],
        const SizedBox(height: AppSpacing.sm),
        TextButton(
          key: CheckInboxActions.changeEmailButton,
          onPressed: _busy ? null : () => context.go('/sign-in'),
          child: Text(l10n.checkInboxChangeEmail),
        ),
      ],
    );
  }
}
