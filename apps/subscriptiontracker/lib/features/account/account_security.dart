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

import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';
import '../auth/auth_error_sentence.dart';
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

    // The session this device holds NOW — re-authenticating replaces it.
    final String? before = await _sessionId(auth);

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
    } on core.AuthFailure catch (e) {
      // ⏱ review of #1129, finding 7: only a refused PASSWORD is told as a
      // wrong password. A captcha refusal, a rate limit or no network said
      // that would send someone holding the right one round a loop.
      _fail(
        user.hasPasswordIdentity && _wrongPassword(e)
            ? l10n.reauthWrongPassword
            : l10n.accountChangeFailed,
      );
      return;
    } catch (_) {
      // Not the provider saying no — no network, a captcha that never came.
      _fail(l10n.accountChangeFailed);
      return;
    }

    // ⏱ review of #1129, finding 5: the sign-in above minted a NEW session
    // and the one it replaced lives on server-side — sessions never expire
    // there (ADR 059 decision 6), so it would sit in "Your devices" for good,
    // and a refresh token stolen before this would keep working. Signed out
    // by id; best effort, because the change must not wait on it.
    await _signOutReplaced(auth, before);

    // ── 2. THE CHANGE ─────────────────────────────────────────────────────
    try {
      if (_isEmail) {
        await auth.updateEmail(newEmail: newValue);
      } else {
        // The project requires the CURRENT password with a signed-in change
        // (finding 1, measured live: without it `current_password_required`).
        await auth.updatePassword(
          newPassword: newValue,
          currentPassword: _current.text,
        );
      }
    } on core.AuthFailure catch (e) {
      _fail(_changeRefusal(e, l10n));
      return;
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

  static bool _wrongPassword(core.AuthFailure e) =>
      e.code == null || e.code == core.AuthFailure.invalidCredentials;

  /// The CHANGE's refusal, said as what it is: a current password the server
  /// would not take is a wrong password, a weak new one gets the sign-up
  /// screens' own sentence, and only the rest is "that did not work".
  String _changeRefusal(core.AuthFailure e, AppLocalizations l10n) {
    if (e.code == core.AuthFailure.currentPasswordInvalid ||
        e.code == core.AuthFailure.currentPasswordRequired) {
      return l10n.reauthWrongPassword;
    }
    if (e.code == core.AuthFailure.weakPassword) {
      return authErrorSentence(context, e);
    }
    return l10n.accountChangeFailed;
  }

  static Future<String?> _sessionId(core.AuthRepository auth) async {
    try {
      return core.sessionIdOfAccessToken(await auth.currentAccessToken());
    } catch (_) {
      return null;
    }
  }

  Future<void> _signOutReplaced(
    core.AuthRepository auth,
    String? before,
  ) async {
    if (before == null || !ref.read(sessionsAvailableProvider)) return;
    try {
      final String? token = await auth.currentAccessToken();
      final String? after = core.sessionIdOfAccessToken(token);
      // The provider path may not have signed in again at all (a sign-in in
      // the last five minutes is confirmation enough): same session, nothing
      // to end — and the host refuses the current one anyway.
      if (after == null || after == before) return;
      await ref
          .read(sessionsTransportProvider)
          .revoke(id: before, accessToken: token);
    } catch (_) {
      // Best effort: what is left behind is the state before this change.
    }
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
                    labelText: _isEmail
                        ? l10n.changeEmailNew
                        : l10n.newPassword,
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
