import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/auth/reset_password_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';
import 'auth_panel.dart';

/// Where a password-reset link lands — the ADAPTER half.
///
/// ⏱ 2026-10-01 · [ADR 086] adopted chassis `ResetPasswordView` (EN-06). The
/// body — the three states (dead link, form, done), the pre-network
/// `core.newPasswordProblem` check and the error mapper — moved to the package
/// with its dated reasoning in its header, and gained there what this private
/// copy was about to grow alone: `AuthField` with Show / Hide on both boxes,
/// the rules checklist, and a live-region "done" line. So every stamped app
/// gets them, not only this one. What stays here is what a package that
/// declares no Riverpod and no go_router cannot have: the provider reads, the
/// seam call, the navigation, and this app's own side panel.
class ResetPasswordScreen extends ConsumerWidget {
  const ResetPasswordScreen({super.key});

  // Aliases of the package's keys, not copies: the tests reach them through
  // this class name, and two `Key('…')` literals in two files is the drift the
  // chassis exists to remove.
  static const Key passwordField = ResetPasswordView.passwordField;
  static const Key confirmField = ResetPasswordView.confirmField;
  static const Key submitButton = ResetPasswordView.submitButton;
  static const Key signInButton = ResetPasswordView.signInButton;
  static const Key statusLine = ResetPasswordView.statusLine;
  static const Key doneLine = ResetPasswordView.doneLine;
  static const Key linkDeadLine = ResetPasswordView.linkDeadLine;
  static const Key linkDeadHint = ResetPasswordView.linkDeadHint;
  static const Key checklist = ResetPasswordView.checklist;

  /// The single exit, from both terminal states.
  ///
  /// 🔴 THE SIGN-OUT IS WHAT RELEASES THE GATE. `passwordRecoveryProvider`
  /// clears on `AuthEventKind.signedOut` and on nothing else, so a version that
  /// only navigated would leave the gate armed and put the user straight back.
  ///
  /// 🔴 THE ARRIVAL IS CLEARED BEFORE THE AWAIT, AND CLEARED AT ALL.
  /// `signedOut` is deliberately NOT a release for the arrival — see
  /// `passwordResetArrivalProvider` — so this is the ONE release, and without it
  /// a dead link would hold the user here for the rest of the session. Before
  /// the await because the sign-out tears this element down.
  ///
  /// 🔴 THE SPINE, NOT `auth.signOut()`. `assert-seams-wired` caught that: a
  /// session-ending control beside the spine leaves the entitlement cache and
  /// the notification schedule of the person who just left. It matters MORE
  /// here than anywhere, because a password reset's likeliest cause is
  /// "somebody else had my account".
  Future<void> _leave(BuildContext context, WidgetRef ref) async {
    ref.read(passwordResetArrivalProvider.notifier).clear();
    try {
      await signOutAndForgetUser(ref);
    } catch (_) {
      // A failed sign-out must not trap the user on this page. The gate still
      // reads a live session, and navigating is still the right move.
    }
    if (context.mounted) context.go('/sign-in');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
    final core.PasswordResetArrivalReport arrival = ref.watch(
      passwordResetArrivalProvider,
    );
    return ResetPasswordView(
      panel: const AuthPanel(),
      hasSession: auth.currentUser != null,
      recovering: ref.watch(passwordRecoveryProvider),
      arrival: arrival.arrival,
      problem: arrival.problem,
      onSubmit: (String newPassword) =>
          auth.updatePassword(newPassword: newPassword),
      onLeave: () => _leave(context, ref),
    );
  }
}
