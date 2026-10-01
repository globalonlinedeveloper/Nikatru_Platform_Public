// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SIGN-OUT AFTER A CONFIRMED E-MAIL CHANGE — ADR 059 decision 2.
//
// ⏱ 2026-10-01 · review of #1129, finding 2. "Change e-mail" (SE-02) made the
// change reachable from Settings, and ADR 059 locks that a successful change
// ends EVERY session: whoever else holds one — a stolen refresh token, a
// forgotten shared laptop — must not stay signed in on the new identity.
//
// THE SIGNAL is the account itself: the same user id arriving under a
// different address (`core.emailChangeCompleted`). With secure e-mail change
// that happens exactly once both links are followed — on the device that opens
// the second link (its new session carries the new address) and on any device
// whose next token refresh does — never at the request, and never on the first
// link. It reads the auth state, not the link, so it holds on every target:
// off the web the link reaches only the SDK, never this app's router.
//
// ⚠️ What it cannot see: an app that STARTS signed in under the new address
// with no earlier state in memory (a fresh browser tab opened by the link).
// The device the change was confirmed on still ends every session at its own
// next refresh, within the hour the access token lives.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart' show StateProvider;
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';

/// True once this device ended every session because the account's address
/// changed. The sign-in screen says so; dismissing it clears it.
final StateProvider<bool> emailChangeSignedOutProvider = StateProvider<bool>(
  (ref) => false,
);

/// Watches the signed-in account while [child] is mounted (the app shell is
/// the child's home, so: while anyone is signed in) and, on a confirmed
/// e-mail change, signs out EVERYWHERE through [signOutAndForgetUser] — the
/// one path allowed to sign out, which also forgets this device's per-user
/// state and writes the Worker revocation.
class EmailChangeSignOut extends ConsumerWidget {
  const EmailChangeSignOut({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (
      AsyncValue<core.AuthUser?>? before,
      AsyncValue<core.AuthUser?> after,
    ) {
      if (core.emailChangeCompleted(before?.value, after.value)) {
        _endEverySession(ref);
      }
    });
    return child;
  }

  static Future<void> _endEverySession(WidgetRef ref) async {
    ref.read(emailChangeSignedOutProvider.notifier).state = true;
    try {
      await signOutAndForgetUser(ref, scope: core.SignOutScope.global);
    } catch (_) {
      // The revoke did not go through (no network): still signed in here, so
      // no sign-in screen will say otherwise — and the notice must not wait
      // to appear at some later, unrelated sign-out. Not retried: the change
      // is seen once, on its transition.
      try {
        ref.read(emailChangeSignedOutProvider.notifier).state = false;
      } catch (_) {}
    }
  }
}
