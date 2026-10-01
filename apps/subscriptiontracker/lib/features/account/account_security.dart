// ─────────────────────────────────────────────────────────────────────────────
// CHANGE E-MAIL AND CHANGE PASSWORD (SE-02) — from Settings, after proving it
// is still you.
//
// ⏱ 2026-10-01 · train ST-SETTINGS. Before this a signed-in person could not
// change either: the only password path was the "forgot" mail, and the only
// e-mail path was a new account. Both now run the SAME TWO STEPS, in order:
//
//   1. RE-AUTHENTICATE, through the seam sign-in uses — the current password,
//      or, for an account that signs in with Apple or Google, that provider's
//      sheet again (`core.confirmIdentityWithProvider`, the one account
//      deletion uses). A borrowed, unlocked device must not be enough to move
//      an account to someone else's inbox or lock its owner out of it.
//   2. Only then the change: `AuthRepository.updateEmail` (the provider mails
//      the confirmation it already templates, to BOTH addresses — so the
//      result says "check both inboxes" and claims nothing has moved yet) or
//      `updatePassword` (with the same `AuthPasswordChecklist` sign-up shows).
//
// 🔴 A REFUSED RE-AUTHENTICATION CHANGES NOTHING — step 2 is unreachable from
// the `on core.AuthFailure` arm, which returns. `settings_account_test.dart`
// is the red control.
//
// 🔴 THE CAPTCHA IS MOUNTED HERE, IN THE FILE THAT MAKES THE CALL. The password
// re-authentication is `signInWithEmail`, a captcha-gated endpoint, so this
// file carries the `TurnstileGate` and the call carries its token —
// `assert-captcha-gated-call-sites.mjs` limbs R1 and R2. The submit validates
// first and then WAITS for the challenge (R4); it is never disabled on it.
//
// 🔴 NOT UNDER lib/features/settings/, ON PURPOSE. `assert-deletion-control`
// reads that directory as ONE body for the deletion flow's re-authentication
// and in-flight lock; this file has both, for a different flow, and inside it
// it made the guard's own mutations of the DELETE dialog go green.
//
// App-owned for now: the chassis `SettingsView` this would slot into is not
// yet the screen this app draws (SE-01), and the captcha gate's renderer is
// this app's (`renderTurnstile`).
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../auth/turnstile_gate.dart';

/// Which account fact the dialog changes.
enum AccountChange { email, password }

/// Opens the change dialog for [kind]. Not dismissible by a stray tap while a
/// request is in flight — the dialog's own `PopScope` refuses that too.
Future<void> showAccountChange(BuildContext context, AccountChange kind) =>
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext _) => AccountChangeDialog(kind: kind),
    );

class AccountChangeDialog extends ConsumerStatefulWidget {
  const AccountChangeDialog({required this.kind, super.key});

  final AccountChange kind;

  static const Key newValueField = Key('accountChangeNew');
  static const Key currentPasswordField = Key('accountChangeCurrent');
  static const Key submitButton = Key('accountChangeSubmit');
  static const Key message = Key('accountChangeMessage');

  @override
  ConsumerState<AccountChangeDialog> createState() =>
      _AccountChangeDialogState();
}

class _AccountChangeDialogState extends ConsumerState<AccountChangeDialog> {
  final TextEditingController _new = TextEditingController();
  final TextEditingController _current = TextEditingController();
  final CaptchaTokenController _captcha = newCaptchaController();
  bool _busy = false;
  String? _error;

  /// The result sentence once the change went through; the form is gone.
  String? _done;

  @override
  void dispose() {
    _new.dispose();
    _current.dispose();
    _captcha.dispose();
    super.dispose();
  }

  bool get _isEmail => widget.kind == AccountChange.email;

  /// Deliberately as weak as the sign-in preflight's test: the provider is
  /// the judge of an address, and a stricter rule here refuses real ones.
  static bool _looksLikeEmail(String v) => v.contains('@') && v.contains('.');

  bool _valid(core.AuthUser user) {
    final String v = _new.text.trim();
    final bool newOk = _isEmail
        ? _looksLikeEmail(v) && v.toLowerCase() != user.email.toLowerCase()
        : _new.text.length >= core.kMinPasswordLength;
    return newOk && (!user.hasPasswordIdentity || _current.text.isNotEmpty);
  }

  Future<void> _submit() async {
    final core.AuthRepository auth = ref.read(authRepositoryProvider);
    final core.AuthUser? user = auth.currentUser;
    if (_busy || user == null || !_valid(user)) return;
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String newValue = _isEmail ? _new.text.trim() : _new.text;
    setState(() {
      _busy = true;
      _error = null;
    });

    // ── 1. RE-AUTHENTICATE. Nothing below runs unless this succeeded. ──────
    try {
      if (user.hasPasswordIdentity) {
        await auth.signInWithEmail(
          email: user.email,
          password: _current.text,
          captchaToken: await _captcha.consumeWhenReady(),
        );
      } else {
        await core.confirmIdentityWithProvider(auth: auth, user: user);
      }
    } on core.AuthFailure {
      _fail(
        user.hasPasswordIdentity
            ? l10n.reauthWrongPassword
            : l10n.accountChangeFailed,
      );
      return;
    } catch (_) {
      // Not the provider saying no — no network, a captcha that never came.
      // Telling someone their password is wrong would send them round a loop.
      _fail(l10n.accountChangeFailed);
      return;
    }

    // ── 2. THE CHANGE ─────────────────────────────────────────────────────
    try {
      if (_isEmail) {
        await auth.updateEmail(newEmail: newValue);
      } else {
        await auth.updatePassword(newPassword: newValue);
      }
    } catch (_) {
      _fail(l10n.accountChangeFailed);
      return;
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _done = _isEmail
          ? l10n.changeEmailCheckInboxes(user.email, newValue)
          : l10n.changePasswordDone;
    });
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = message;
    });
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String title = _isEmail
        ? l10n.changeEmailTitle
        : l10n.changePasswordTitle;
    final String? done = _done;
    if (done != null) {
      return AlertDialog(
        title: Text(title),
        content: Text(done, key: AccountChangeDialog.message),
        actions: <Widget>[
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.done),
          ),
        ],
      );
    }
    final core.AuthUser? user = ref.watch(authRepositoryProvider).currentUser;
    if (user == null) return const SizedBox.shrink();
    final bool password = user.hasPasswordIdentity;
    final String typed = _new.text.trim();
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(title),
        content: SingleChildScrollView(
          child: AutofillGroup(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                TextField(
                  key: AccountChangeDialog.newValueField,
                  controller: _new,
                  enabled: !_busy,
                  autofocus: true,
                  obscureText: !_isEmail,
                  keyboardType: _isEmail
                      ? TextInputType.emailAddress
                      : TextInputType.visiblePassword,
                  autofillHints: <String>[
                    _isEmail ? AutofillHints.email : AutofillHints.newPassword,
                  ],
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    labelText: _isEmail ? l10n.changeEmailNew : l10n.newPassword,
                    errorText:
                        _isEmail && typed.isNotEmpty && !_looksLikeEmail(typed)
                        ? l10n.changeEmailInvalid
                        : null,
                  ),
                ),
                if (!_isEmail) ...<Widget>[
                  const SizedBox(height: AppSpacing.sm),
                  AuthPasswordChecklist(
                    rules: <AuthRule>[
                      AuthRule(
                        label: l10n.authPasswordRuleLength(
                          core.kMinPasswordLength,
                        ),
                        state: _new.text.length >= core.kMinPasswordLength
                            ? AuthRuleState.met
                            : AuthRuleState.pending,
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: AppSpacing.md),
                if (password) ...<Widget>[
                  TextField(
                    key: AccountChangeDialog.currentPasswordField,
                    controller: _current,
                    enabled: !_busy,
                    obscureText: true,
                    autofillHints: const <String>[AutofillHints.password],
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _submit(),
                    decoration: InputDecoration(
                      labelText: l10n.currentPassword,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                  TurnstileGate(controller: _captcha, render: renderTurnstile),
                ] else
                  Text(l10n.reauthProviderHint),
                if (_error != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.sm),
                  Text(
                    _error!,
                    key: AccountChangeDialog.message,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: _busy ? null : () => Navigator.pop(context),
            child: Text(l10n.cancel),
          ),
          FilledButton(
            key: AccountChangeDialog.submitButton,
            onPressed: (_busy || !_valid(user)) ? null : _submit,
            child: _busy
                ? const SizedBox.square(
                    dimension: AppSpacing.lg,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(title),
          ),
        ],
      ),
    );
  }
}
