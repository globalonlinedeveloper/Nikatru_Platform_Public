// ⏱ 2026-09-30 · ST-N6 (D23, F37, AB-M3-03) — WHAT A RETURN TO THE APP
// RE-READS, and nothing else.
//
// WHEN is the chassis's: `RefreshOnResume` (packages/chassis_screens) fires
// this on every "back to the front" edge, throttled by core's `ResumeRefresh`,
// and the home list's pull-to-refresh calls the same function. A list read
// once per process showed a web tab left open for a day, or a phone app back
// from the background, whatever the server said when it was opened.
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'money_providers.dart';
import 'subscriptions_controller.dart';

/// Re-read what the server may have changed while the app was away: the
/// subscription list (another device added or edited one) and the entitlement
/// (a purchase or refund on another target).
///
/// The list is re-read SOFTLY ([SubscriptionsController.refresh]) — a failed
/// re-read keeps the list on screen. The entitlement is invalidated, not read:
/// a failed fetch already answers the cached plan, and nothing watches it in a
/// build that sells nothing.
///
/// 🔴 ONLY A LIST THAT EXISTS. Reading `.notifier` would BUILD the list on a
/// sign-in screen, where its fetch can only fail, and leave that failure
/// waiting for the home screen the user is about to open.
Future<void> refreshOnReturn(WidgetRef ref) async {
  ref.invalidate(entitlementsProvider);
  if (ref.exists(subscriptionsControllerProvider)) {
    await ref.read(subscriptionsControllerProvider.notifier).refresh();
  }
}
