import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'auth_error_text.dart';

/// Where a password-reset link lands — the completion half of a feature that
/// shipped with only its request half.
///
/// 🏗️ THE BODY OF `ResetPasswordScreen`, MOVED HERE BY [ADR 067] decision 2 /
/// [ADR 071]. The brick keeps an adapter of the same name that reads the
/// providers and hands this widget plain values and two callbacks. Nothing
/// below knows what Riverpod or go_router are, which is what makes it
/// mountable in a plain `testWidgets` pump.
///
/// 🔴 WHAT WAS BROKEN. `sendPasswordReset` existed, real recovery mail was
/// delivered, and there was no `updatePassword` on the seam, no route, and no
/// `redirectTo` — so the mail arrived, the link resolved to the project's Site
/// URL, and the person who followed it was dropped on a home screen with no way
/// to set anything. Asking for help and then being unable to accept it is worse
/// than not offering help: the user has spent their one link.
///
/// 🔴 TWO THINGS ROUTE PEOPLE HERE, AND THE SECOND ONE IS THE FIX THIS SCREEN
/// SPENT A REVIEW WITHOUT. The url strategy forces the shape: nothing in this
/// repository calls `usePathUrlStrategy`, so Flutter web is on the HASH strategy
/// and this screen's address is `…/#/reset-password` — the route lives in the
/// fragment, where the `?code=` gotrue appends would be invisible to the SDK.
/// So the link points at the app ROOT with the route in the fragment and a
/// marker in the QUERY (`passwordResetRedirectUrl`), the SDK exchanges the code
/// off the query, and:
///
///   · ON SUCCESS, `AuthEventKind.passwordRecovery` says why the app was opened
///     — the only thing that can, since a recovery session is byte-for-byte an
///     ordinary one. See `passwordRecoveryProvider`.
///   · ON FAILURE, nothing does. That was the defect: gotrue's error redirect
///     REPLACES the fragment with `#error=…&error_code=otp_expired` (measured
///     live, 2026-08-11), so the route is gone, no recovery event is ever
///     emitted, and this screen was unreachable from the one situation it
///     exists to explain. `passwordResetArrivalProvider` reads the marker off
///     the query — which gotrue does preserve — and the seam's
///     `recoveryLinkFailed` event, and routes both here.
///
/// ⚠️ THREE STATES, AND THE MIDDLE ONE IS THE ONE AN IMPLEMENTATION THAT ONLY
/// TESTED THE HAPPY PATH GETS WRONG:
///   · THE LINK IS DEAD — expired, already used, or opened where the PKCE
///     verifier was never stored. It says which, and offers the way back. This
///     is the state the feature reaches most often in the field, and it is
///     REACHED now rather than merely written: `password_reset_test.dart` drives
///     it from the real failure redirect and from the real stream error, with no
///     hand navigation.
///   · THE FORM — two boxes, checked by `core.newPasswordProblem` before
///     anything leaves the device.
///   · DONE — terminal, with sign-in as its only exit. The sign-out happens on
///     that TAP, never on success: signing out immediately fires the router's
///     gate and tears this page down before the confirmation can be read, which
///     is [ADR 027] repeating itself.
class ResetPasswordView extends StatefulWidget {
  const ResetPasswordView({
    required this.hasSession,
    required this.recovering,
    required this.arrival,
    required this.problem,
    required this.onSubmit,
    required this.onLeave,
    this.panel,
    super.key,
  });

  static const Key passwordField = Key('resetPasswordNew');
  static const Key confirmField = Key('resetPasswordConfirm');
  static const Key submitButton = Key('resetPasswordSubmit');
  static const Key signInButton = Key('resetPasswordSignIn');
  static const Key statusLine = Key('resetPasswordStatus');
  static const Key doneLine = Key('resetPasswordDone');
  static const Key linkDeadLine = Key('resetPasswordLinkDead');

  /// The SECOND sentence of the dead-link state — keyed because it is the
  /// typed half, and a test that only found the first would pass whichever
  /// reason was rendered.
  static const Key linkDeadHint = Key('resetPasswordLinkDeadHint');

  /// ⏱ 2026-10-01 · EN-06 — the rules, readable before a refusal.
  static const Key checklist = Key('resetPasswordChecklist');

  /// Whether the exchange produced a session at all. No session ⇒ dead link.
  final bool hasSession;

  /// Whether the app was opened BY a recovery link (`passwordRecoveryProvider`).
  final bool recovering;

  /// What the launch URL said about the arrival, typed rather than inferred.
  final core.PasswordResetArrival arrival;

  /// Why the link failed, when it did. Decides the second sentence.
  final core.AuthLinkProblem? problem;

  /// Sets the new password. Throws `core.AuthFailure` with a message to show.
  final Future<void> Function(String newPassword) onSubmit;

  /// The single exit from both terminal states — releases the router gate and
  /// navigates. See the adapter: it is a sign-out, not a `context.go` alone.
  final VoidCallback onLeave;

  /// The leading half of the wide split (`AuthFrame.panel`), as on
  /// `ReacceptTermsView`. Null renders the single column.
  final Widget? panel;

  @override
  State<ResetPasswordView> createState() => _ResetPasswordViewState();
}

class _ResetPasswordViewState extends State<ResetPasswordView> {
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();

  /// Where Enter goes from the first box. Held on the state: a node built in
  /// `build` is a new node on every keystroke, and the checklist rebuilds on
  /// every keystroke.
  final FocusNode _confirmFocus = FocusNode();
  bool _busy = false;
  bool _done = false;
  String? _error;

  /// Whether the server refused THIS password as breached — the one rule the
  /// checklist cannot know before the request. Forgotten on the next keystroke.
  bool _breached = false;

  @override
  void initState() {
    super.initState();
    _password.addListener(_passwordEdited);
  }

  void _passwordEdited() {
    if (mounted) setState(() => _breached = false);
  }

  @override
  void dispose() {
    _password.removeListener(_passwordEdited);
    _password.dispose();
    _confirm.dispose();
    _confirmFocus.dispose();
    super.dispose();
  }

  AuthRevealLabels _revealLabels(ChassisLocalizations l10n) => AuthRevealLabels(
    show: l10n.authShow,
    hide: l10n.authHide,
    showName: l10n.authShowPassword,
    hideName: l10n.authHidePassword,
  );

  /// The message for [p], or null when there is nothing wrong.
  ///
  /// One sentence per arm. "Invalid password" would satisfy a test and tell the
  /// user nothing about which of the two boxes to look at.
  String? _problemMessage(
    ChassisLocalizations l10n,
    core.NewPasswordProblem? p,
  ) => switch (p) {
    core.NewPasswordProblem.empty => l10n.resetPasswordEnterOne,
    core.NewPasswordProblem.tooShort => l10n.passwordTooShort,
    core.NewPasswordProblem.mismatched => l10n.resetPasswordMismatch,
    null => null,
  };

  Future<void> _submit(ChassisLocalizations l10n) async {
    if (_busy) return;
    // 🔴 CHECKED BEFORE THE NETWORK, and the mismatch arm is why. A confirmation
    // typo is the one error on this screen that the SERVER cannot catch: both
    // fields are well-formed passwords, so gotrue accepts the wrong one happily
    // and the user is locked out of an account they just "recovered".
    final String? problem = _problemMessage(
      l10n,
      core.newPasswordProblem(
        password: _password.text,
        confirmation: _confirm.text,
      ),
    );
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit(_password.text);
      if (mounted) setState(() => _done = true);
    } catch (e) {
      // ⏱ 2026-09-24 — ONE arm, through the mapper, which reads the failure's
      // code and reasons: a breached password now says so, where this printed
      // GoTrue's "known to be weak and easy to guess" as written.
      if (mounted) {
        final String sentence = authErrorText(l10n, e);
        setState(() {
          _error = sentence;
          _breached = sentence == l10n.passwordBreached;
        });
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
      title: l10n.resetPasswordTitle,
      children: _body(context, l10n),
    );
  }

  List<Widget> _body(BuildContext context, ChassisLocalizations l10n) {
    if (_done) {
      return <Widget>[
        // ⏱ 2026-10-01 · EN-06 — a LIVE REGION: the form this line replaces
        // had focus, and without it a screen reader said nothing when the
        // password was changed.
        Semantics(
          liveRegion: true,
          child: Text(
            l10n.resetPasswordDone,
            key: ResetPasswordView.doneLine,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
        ),
        const SizedBox(height: 20),
        FilledButton(
          key: ResetPasswordView.signInButton,
          onPressed: widget.onLeave,
          child: Text(l10n.signIn),
        ),
      ];
    }

    // 🔴 NO SESSION ⇒ THE LINK IS DEAD, AND THIS STATE IS NOW REACHABLE FROM
    // THE FAILURE IT EXPLAINS. It shipped unreachable: the only thing that
    // routed here was the SUCCESS event, so a link that could not be exchanged
    // landed on `/` and was bounced to the sign-in form with no explanation,
    // while this paragraph called itself the state the feature reaches most
    // often in the field. `passwordResetArrivalProvider` reads the launch URL
    // and the seam's `recoveryLinkFailed` event; the router sends both here.
    //
    // ⚠️ TYPED, so the second sentence is the one that fits. `verifierMissing`
    // is a PROPERTY OF PKCE and the only cause the user can act on: the code
    // verifier lives in the installation that ASKED for the link, so opening the
    // mail on a second device — or in a browser when the request came from the
    // desktop app — arrives with nothing to exchange. `expiredOrUsed` is not
    // about devices at all, and telling somebody to "use the same browser" when
    // they did is how a correct instruction becomes noise.
    if (!widget.hasSession &&
        (!widget.recovering ||
            widget.arrival == core.PasswordResetArrival.unusable)) {
      return <Widget>[
        Text(
          l10n.resetPasswordLinkDead,
          key: ResetPasswordView.linkDeadLine,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 8),
        Text(
          widget.problem == core.AuthLinkProblem.expiredOrUsed
              ? l10n.resetPasswordLinkExpiredHint
              : l10n.resetPasswordSameDeviceHint,
          key: ResetPasswordView.linkDeadHint,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 20),
        FilledButton(
          key: ResetPasswordView.signInButton,
          onPressed: widget.onLeave,
          child: Text(l10n.signIn),
        ),
      ];
    }

    return <Widget>[
      Text(
        l10n.resetPasswordBody,
        style: Theme.of(context).textTheme.bodyMedium,
      ),
      const SizedBox(height: 16),
      // ⏱ 2026-10-01 · EN-06 — `AuthField`, the sign-in form's field, with
      // the same Show / Hide and the same rules checklist sign-up shows. These
      // were two plain `TextField(obscureText: true)` boxes: a person setting
      // a password they will have to type again could not see what they
      // typed, and learned the length rule only from a refusal.
      AuthField(
        label: l10n.resetPasswordNew,
        controller: _password,
        keyboardType: TextInputType.text,
        obscure: true,
        fieldKey: ResetPasswordView.passwordField,
        reveal: _revealLabels(l10n),
        // `newPassword`, never `password`: it is what tells a password manager
        // to OFFER to save rather than to autofill the old one.
        autofillHints: const <String>[AutofillHints.newPassword],
        textInputAction: TextInputAction.next,
        onSubmitted: _confirmFocus.requestFocus,
      ),
      const SizedBox(height: AppSpacing.sm),
      AuthPasswordChecklist(
        key: ResetPasswordView.checklist,
        rules: <AuthRule>[
          AuthRule(
            label: l10n.authPasswordRuleLength(core.kMinPasswordLength),
            state: _password.text.length >= core.kMinPasswordLength
                ? AuthRuleState.met
                : AuthRuleState.pending,
          ),
          AuthRule(
            label: l10n.authPasswordRuleBreach,
            state: _breached ? AuthRuleState.failed : AuthRuleState.pending,
          ),
        ],
      ),
      const SizedBox(height: AppSpacing.md),
      AuthField(
        label: l10n.resetPasswordConfirm,
        controller: _confirm,
        keyboardType: TextInputType.text,
        obscure: true,
        fieldKey: ResetPasswordView.confirmField,
        reveal: _revealLabels(l10n),
        focusNode: _confirmFocus,
        autofillHints: const <String>[AutofillHints.newPassword],
        textInputAction: TextInputAction.done,
        onSubmitted: _busy ? null : () => _submit(l10n),
      ),
      if (_error != null) ...<Widget>[
        const SizedBox(height: 12),
        AuthMessage(
          message: _error!,
          textKey: ResetPasswordView.statusLine,
          kind: StatusKind.danger,
        ),
      ],
      const SizedBox(height: 20),
      FilledButton(
        key: ResetPasswordView.submitButton,
        onPressed: _busy ? null : () => _submit(l10n),
        child: Text(l10n.resetPasswordSubmit),
      ),
      const SizedBox(height: 8),
      TextButton(
        key: ResetPasswordView.signInButton,
        onPressed: _busy ? null : widget.onLeave,
        child: Text(l10n.cancel),
      ),
    ];
  }
}
