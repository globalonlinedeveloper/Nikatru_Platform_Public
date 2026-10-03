import 'dart:async';

import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'auth_error_text.dart';

/// ⏱ 2026-10-01 · EN-21 — "E-mail me a code": the half of the flow after the
/// first code was sent. The code field, the sign-in button, a resend that
/// counts down the per-address cooldown, and the way back to the password.
///
/// The ADAPTER owns the two calls, and with them the captcha (the gate is
/// mounted on the sign-in screen, which owns the token) and the persisted
/// cooldown. This view owns what every app's code entry is the same in: the
/// shape check before a request, the busy latch, the countdown, and saying a
/// refusal through the one mapper.
///
/// 🔴 THE ANSWER IS UNIFORM. The line under the heading says a code was sent
/// to [email] IF it has an account — the same words for every address,
/// because the send cannot tell the two apart and must not.
class EmailCodeForm extends StatefulWidget {
  const EmailCodeForm({
    required this.email,
    required this.onVerify,
    required this.onResend,
    required this.onCancel,
    this.cooldown = core.emailCodeCooldown,
    super.key,
  });

  /// The address the code went to.
  final String email;

  /// Signs in with the code. The auth stream moves the user on; this view
  /// takes no navigation.
  final Future<void> Function(String code) onVerify;

  /// Sends another code. Resolves to the wait before the NEXT one may go —
  /// a full cooldown after a send, or what is left of one.
  final Future<Duration> Function() onResend;

  /// Back to the password form.
  final VoidCallback onCancel;

  /// The wait already owed when the view opens (the send that opened it).
  final Duration cooldown;

  static const Key codeField = Key('emailCodeField');
  static const Key verifyButton = Key('emailCodeVerify');
  static const Key resendButton = Key('emailCodeResend');
  static const Key cancelButton = Key('emailCodeCancel');
  static const Key statusLine = Key('emailCodeStatus');

  @override
  State<EmailCodeForm> createState() => _EmailCodeFormState();
}

class _EmailCodeFormState extends State<EmailCodeForm> {
  final TextEditingController _code = TextEditingController();
  late int _wait = widget.cooldown.inSeconds;
  Timer? _tick;
  bool _busy = false;
  String? _notice;
  StatusKind _noticeKind = StatusKind.danger;

  @override
  void initState() {
    super.initState();
    _startTick();
  }

  @override
  void dispose() {
    _tick?.cancel();
    _code.dispose();
    super.dispose();
  }

  void _startTick() {
    _tick?.cancel();
    if (_wait <= 0) return;
    _tick = Timer.periodic(const Duration(seconds: 1), (Timer t) {
      if (!mounted) return t.cancel();
      setState(() => _wait = _wait - 1);
      if (_wait <= 0) t.cancel();
    });
  }

  Future<void> _run(Future<void> Function() call) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await call();
    } catch (e) {
      if (mounted) {
        setState(() {
          _notice = authErrorText(context.chassisL10n, e);
          _noticeKind = StatusKind.danger;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final ChassisLocalizations l10n = context.chassisL10n;
    final String code = _code.text.replaceAll(' ', '');
    // The shape is checked here so a typo costs no request — never instead of
    // the server's answer, which is the only one that can sign anyone in.
    if (!core.isEmailCodeShape(code)) {
      setState(() {
        _notice = l10n.emailCodeShape;
        _noticeKind = StatusKind.danger;
      });
      return;
    }
    await _run(() => widget.onVerify(code));
  }

  Future<void> _resend() async {
    if (_wait > 0) return;
    await _run(() async {
      final Duration next = await widget.onResend();
      if (!mounted) return;
      setState(() {
        _wait = next.inSeconds;
        _notice = context.chassisL10n.emailCodeSentAgain;
        _noticeKind = StatusKind.positive;
      });
      _startTick();
    });
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    // The width decision: the form cap every auth form keeps
    // (`AppBreakpoints.form`), so a desktop window never stretches one code
    // field across 1280 px. Inside `AuthFrame` the frame's cap already holds.
    return Align(
      alignment: AlignmentDirectional.topCenter,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
        child: _form(context, l10n),
      ),
    );
  }

  Widget _form(BuildContext context, ChassisLocalizations l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          l10n.emailCodeSentTo(widget.email),
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: AppSpacing.lg),
        AuthField(
          label: l10n.emailCodeLabel,
          controller: _code,
          keyboardType: TextInputType.number,
          fieldKey: EmailCodeForm.codeField,
          autofillHints: const <String>[AutofillHints.oneTimeCode],
          textInputAction: TextInputAction.done,
          onSubmitted: _busy ? null : _verify,
        ),
        if (_notice case final String said) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          AuthMessage(
            message: said,
            textKey: EmailCodeForm.statusLine,
            kind: _noticeKind,
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        FilledButton(
          key: EmailCodeForm.verifyButton,
          onPressed: _busy ? null : _verify,
          child: Text(l10n.emailCodeSignIn),
        ),
        const SizedBox(height: AppSpacing.sm),
        TextButton(
          key: EmailCodeForm.resendButton,
          onPressed: (_busy || _wait > 0) ? null : _resend,
          child: Text(
            _wait > 0 ? l10n.emailCodeResendIn(_wait) : l10n.emailCodeResend,
          ),
        ),
        TextButton(
          key: EmailCodeForm.cancelButton,
          onPressed: _busy ? null : widget.onCancel,
          child: Text(l10n.emailCodeUsePassword),
        ),
      ],
    );
  }
}
