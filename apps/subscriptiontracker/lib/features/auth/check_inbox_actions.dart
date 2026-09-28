import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

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

  final String email;

  @override
  ConsumerState<CheckInboxActions> createState() => _CheckInboxActionsState();
}

class _CheckInboxActionsState extends ConsumerState<CheckInboxActions>
    with CaptchaHost<CheckInboxActions> {
  bool _busy = false;
  String? _notice;

  Future<void> _resend() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _notice = null;
    });
    String notice;
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
    } catch (e) {
      notice = mounted ? authErrorSentence(context, e) : '';
    }
    if (mounted) {
      setState(() {
        _busy = false;
        _notice = notice;
      });
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
          onPressed: _busy ? null : _resend,
          child: Text(l10n.verifyEmailResend),
        ),
        if (_notice != null) ...<Widget>[
          const SizedBox(height: 8),
          Semantics(
            liveRegion: true,
            child: Text(_notice!, key: CheckInboxActions.noticeLine),
          ),
        ],
        const SizedBox(height: 8),
        TextButton(
          key: CheckInboxActions.changeEmailButton,
          onPressed: _busy ? null : () => context.go('/sign-in'),
          child: Text(l10n.checkInboxChangeEmail),
        ),
      ],
    );
  }
}
