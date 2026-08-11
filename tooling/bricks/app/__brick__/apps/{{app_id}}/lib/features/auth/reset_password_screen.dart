import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// Where a password-reset link lands — the completion half of a feature that
/// shipped with only its request half.
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
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key});

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

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _busy = false;
  bool _done = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  /// The message for [problem], or null when there is nothing wrong.
  ///
  /// One sentence per arm. "Invalid password" would satisfy a test and tell the
  /// user nothing about which of the two boxes to look at.
  String? _problemMessage(AppLocalizations l10n, core.NewPasswordProblem? p) =>
      switch (p) {
        core.NewPasswordProblem.empty => l10n.resetPasswordEnterOne,
        core.NewPasswordProblem.tooShort => l10n.passwordTooShort,
        core.NewPasswordProblem.mismatched => l10n.resetPasswordMismatch,
        null => null,
      };

  Future<void> _submit(core.AuthRepository auth, AppLocalizations l10n) async {
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
      await auth.updatePassword(newPassword: _password.text);
      if (mounted) setState(() => _done = true);
    } on core.AuthFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The single exit, from both terminal states.
  ///
  /// 🔴 THE SIGN-OUT IS WHAT RELEASES THE GATE. `passwordRecoveryProvider`
  /// clears on `AuthEventKind.signedOut` and on nothing else, so a version of
  /// this that only navigated would leave the gate armed and the router would
  /// put the user straight back here. One mechanism, not two.
  Future<void> _leave() async {
    // 🔴 CLEARED BEFORE THE AWAIT, AND CLEARED AT ALL. `signedOut` is
    // deliberately NOT a release for the arrival — see
    // `passwordResetArrivalProvider`, where releasing on it would let a routine
    // `initialSession` emission erase what the launch URL just established — so
    // this is the ONE release, and without it a dead link would hold the user on
    // this screen for the rest of the session. Before the await because the
    // sign-out tears this element down and `ref` throws afterwards.
    ref.read(passwordResetArrivalProvider.notifier).clear();
    try {
      // 🔴 THE SPINE, NOT `auth.signOut()`. This called the repository directly
      // until `assert-seams-wired` caught it: a session-ending control beside
      // the spine leaves the entitlement cache — honoured offline for up to
      // seven days — and the notification schedule belonging to the person who
      // just left. It matters MORE here than anywhere else, because a password
      // reset is the one flow whose likeliest cause is "somebody else had my
      // account", and the device that finishes it may not be the owner's.
      await signOutAndForgetUser(ref);
    } catch (_) {
      // A sign-out that failed must not trap the user on this page. The gate
      // reads a session that is still there; navigating is still correct.
    }
    if (mounted) context.go('/sign-in');
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    final bool recovering = ref.watch(passwordRecoveryProvider);
    final core.PasswordResetArrivalReport arrival = ref.watch(
      passwordResetArrivalProvider,
    );

    return Scaffold(
      appBar: AppBar(title: Text(l10n.resetPasswordTitle)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ContentPane.form(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: _body(
              context,
              l10n,
              auth,
              recovering: recovering,
              arrival: arrival.arrival,
              problem: arrival.problem,
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _body(
    BuildContext context,
    AppLocalizations l10n,
    core.AuthRepository auth, {
    required bool recovering,
    required core.PasswordResetArrival arrival,
    required core.AuthLinkProblem? problem,
  }) {
    if (_done) {
      return <Widget>[
        Text(
          l10n.resetPasswordDone,
          key: ResetPasswordScreen.doneLine,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 20),
        FilledButton(
          key: ResetPasswordScreen.signInButton,
          onPressed: () => _leave(),
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
    if (auth.currentUser == null &&
        (!recovering || arrival == core.PasswordResetArrival.unusable)) {
      return <Widget>[
        Text(
          l10n.resetPasswordLinkDead,
          key: ResetPasswordScreen.linkDeadLine,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 8),
        Text(
          problem == core.AuthLinkProblem.expiredOrUsed
              ? l10n.resetPasswordLinkExpiredHint
              : l10n.resetPasswordSameDeviceHint,
          key: ResetPasswordScreen.linkDeadHint,
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 20),
        FilledButton(
          key: ResetPasswordScreen.signInButton,
          onPressed: () => _leave(),
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
      TextField(
        key: ResetPasswordScreen.passwordField,
        controller: _password,
        obscureText: true,
        // `newPassword`, never `password`: it is what tells a password manager
        // to OFFER to save rather than to autofill the old one.
        autofillHints: const <String>[AutofillHints.newPassword],
        decoration: InputDecoration(labelText: l10n.resetPasswordNew),
      ),
      const SizedBox(height: 12),
      TextField(
        key: ResetPasswordScreen.confirmField,
        controller: _confirm,
        obscureText: true,
        autofillHints: const <String>[AutofillHints.newPassword],
        decoration: InputDecoration(labelText: l10n.resetPasswordConfirm),
        onSubmitted: (_) => _submit(auth, l10n),
      ),
      if (_error != null) ...<Widget>[
        const SizedBox(height: 12),
        Text(
          _error!,
          key: ResetPasswordScreen.statusLine,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      ],
      const SizedBox(height: 20),
      FilledButton(
        key: ResetPasswordScreen.submitButton,
        onPressed: _busy ? null : () => _submit(auth, l10n),
        child: Text(l10n.resetPasswordSubmit),
      ),
      const SizedBox(height: 8),
      TextButton(
        key: ResetPasswordScreen.signInButton,
        onPressed: _busy ? null : () => _leave(),
        child: Text(l10n.cancel),
      ),
    ];
  }
}
