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
// that happens exactly once both links are followed, and only in an app that
// held the account under the OLD address when the new one arrived — a running
// app that opens the second link, or a running app whose next token refresh
// carries the new address. It reads the auth state, not the link, so it holds
// on every target: off the web the link reaches only the SDK.
//
// ⚠️ WHAT IT CANNOT SEE (review 3, finding 2): an app that STARTS under the
// new address with nothing earlier in memory — the common web path, where the
// second link opens a fresh tab. Nothing fires there; the device that
// REQUESTED the change fires only if it is still open when a refresh brings
// the new address. And an attacker's client never runs this code at all. The
// clause is a SERVER property; this is the client's half, and the server's is
// the follow-up row O-ST-EMAIL-CHANGE-SERVER-SIGNOUT.
//
// 🔴 IT TELLS THE TRUTH (review 3, finding 1). gotrue drops THIS device's
// session and announces the sign-out BEFORE it sends the global revoke, so a
// revoke that fails after that point leaves every other session alive with no
// session here to retry from. Two failures, two answers:
//   · the revoke never started (still signed in here) → retried with backoff,
//     and if it still fails, the app says so and offers it again;
//   · it failed after this device was signed out → the sign-in screen says the
//     OTHER devices were not signed out and how to do it.
// "Every device was signed out" is said only after the revoke succeeded.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart'
    show StateController, StateProvider;
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';

/// What the sign-in screen says after a confirmed e-mail change.
enum EmailChangeSignOutNotice {
  /// The global revoke succeeded: every device, this one included.
  everywhere,

  /// This device was signed out, but the revoke of the others did NOT go
  /// through — they may still be signed in.
  othersStillSignedIn,
}

/// The notice the sign-in screen shows, or null. Dismissing it clears it, and
/// so does the next successful sign-in ([EmailChangeSignOut] mounts again).
final StateProvider<EmailChangeSignOutNotice?> emailChangeSignedOutProvider =
    StateProvider<EmailChangeSignOutNotice?>((ref) => null);

/// Watches the signed-in account while [child] is mounted (the app shell, so:
/// while anyone is signed in) and, on a confirmed e-mail change, signs out
/// EVERYWHERE through [signOutAndForgetUser] — the one path allowed to sign
/// out, which also forgets this device's per-user state.
class EmailChangeSignOut extends ConsumerStatefulWidget {
  const EmailChangeSignOut({required this.child, super.key});

  final Widget child;

  /// The SnackBar that says the other devices are still signed in.
  static const Key failedKey = Key('emailChangeSignOutFailed');

  /// The waits between attempts while this device is still signed in: three
  /// attempts in all, then the app says it did not work and offers it again.
  static const List<Duration> retryBackoff = <Duration>[
    Duration(seconds: 1),
    Duration(seconds: 2),
  ];

  @override
  ConsumerState<EmailChangeSignOut> createState() => _EmailChangeSignOutState();
}

class _EmailChangeSignOutState extends ConsumerState<EmailChangeSignOut> {
  bool _running = false;

  @override
  void initState() {
    super.initState();
    // Mounted again = someone signed in again: an earlier notice is history.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(emailChangeSignedOutProvider.notifier).state = null;
    });
  }

  Future<void> _endEverySession() async {
    if (_running) return;
    _running = true;
    // Read BEFORE any await: a sign-out unmounts this widget part-way through.
    final StateController<EmailChangeSignOutNotice?> notice = ref.read(
      emailChangeSignedOutProvider.notifier,
    );
    final core.AuthRepository auth = ref.read(authRepositoryProvider);
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final AppLocalizations l10n = AppLocalizations.of(context);
    for (int attempt = 0; ; attempt++) {
      try {
        await signOutAndForgetUser(ref, scope: core.SignOutScope.global);
        notice.state = EmailChangeSignOutNotice.everywhere;
        _running = false;
        return;
      } catch (_) {
        if (auth.currentUser == null) {
          // Signed out HERE, revoke not done: say so where they land.
          notice.state = EmailChangeSignOutNotice.othersStillSignedIn;
          _running = false;
          return;
        }
        if (attempt >= EmailChangeSignOut.retryBackoff.length || !mounted) {
          break;
        }
        await Future<void>.delayed(EmailChangeSignOut.retryBackoff[attempt]);
        if (!mounted) break;
      }
    }
    _running = false;
    // Still signed in everywhere: never claim otherwise, and offer it again.
    messenger?.showSnackBar(
      SnackBar(
        key: EmailChangeSignOut.failedKey,
        content: Text(l10n.emailChangeSignOutFailed),
        duration: const Duration(minutes: 1),
        action: SnackBarAction(
          label: l10n.retry,
          onPressed: () {
            if (mounted) _endEverySession();
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (
      AsyncValue<core.AuthUser?>? before,
      AsyncValue<core.AuthUser?> after,
    ) {
      if (core.emailChangeCompleted(before?.value, after.value)) {
        _endEverySession();
      }
    });
    return widget.child;
  }
}
