// ⏱ 2026-09-30 · ST-N6 (D23, F37, AB-M3-03) — WHAT A RETURN TO THE APP
// RE-READS, and nothing else.
//
// WHEN is the chassis's: `RefreshOnResume` (packages/chassis_screens) fires
// this on every "back to the front" edge, throttled by core's `ResumeRefresh`,
// and the home list's pull-to-refresh calls the same function. A list read
// once per process showed a web tab left open for a day, or a phone app back
// from the background, whatever the server said when it was opened.
import 'package:flutter/widgets.dart' show Widget;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart'
    show RefreshOnResume;

import 'money_providers.dart';
import 'providers.dart';
import 'subscriptions_controller.dart';

/// The app's [RefreshOnResume] around [child]: every return to the front runs
/// [refreshOnReturn], throttled by the chassis. Built HERE, not in app.dart:
/// app.dart is a private copy of a chassis file and may not grow
/// (assert-chassis-parity, O-CHASSIS-PHASE-2B).
Widget refreshOnResume(WidgetRef ref, {required Widget child}) =>
    RefreshOnResume(
      onRefresh: () => refreshOnReturn(ref),
      elapsed: ref.read(resumeElapsedProvider), // a test steps the floor
      child: child,
    );

/// The monotonic time `RefreshOnResume` throttles by — null in production (a
/// stopwatch); a test overrides it to step past the 30 s floor.
final Provider<Duration Function()?> resumeElapsedProvider =
    Provider<Duration Function()?>((_) => null);

/// Re-read what the server may have changed while the app was away: the
/// subscription list (another device added or edited one), the entitlement
/// (a purchase or refund on another target) and the account's preferences
/// (changed on another device — D11).
///
/// The list is re-read SOFTLY ([SubscriptionsController.refresh]) — a failed
/// re-read keeps the list on screen. The entitlement is invalidated, not read:
/// a failed fetch already answers the cached plan, and nothing watches it in a
/// build that sells nothing. The preferences sync sends this device's waiting
/// changes first and never reads over one.
///
/// 🔴 ONLY A LIST THAT EXISTS. Reading `.notifier` would BUILD the list on a
/// sign-in screen, where its fetch can only fail, and leave that failure
/// waiting for the home screen the user is about to open.
///
/// The two reads run TOGETHER (review #1080 nit 11): the list, and the
/// pull-to-refresh spinner, never wait behind the preferences round-trip.
Future<void> refreshOnReturn(WidgetRef ref) async {
  ref.invalidate(entitlementsProvider);
  await Future.wait(<Future<void>>[
    ref.read(accountPreferencesSyncProvider)?.sync() ?? Future<void>.value(),
    if (ref.exists(subscriptionsControllerProvider))
      ref.read(subscriptionsControllerProvider.notifier).refresh(),
  ]);
}
