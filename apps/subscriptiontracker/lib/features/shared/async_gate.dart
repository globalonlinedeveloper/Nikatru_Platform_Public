import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/subscriptions_controller.dart';

/// The subscription list's THREE OUTCOMES, told apart — or null when there is
/// real data to draw.
///
/// ═══════════════════════════════════════════════════════════════════════════
/// 🔴 THE ONE LINE THIS REPLACES, AND WHY IT WAS A USER-FACING DEFECT
/// ═══════════════════════════════════════════════════════════════════════════
///     ref.watch(subscriptionsControllerProvider).valueOrNull ?? const []
///
/// stood at budget:131, calendar:116, detail:108, insights:234 and
/// notifications:47. `valueOrNull` is null for a fetch IN FLIGHT and null for a
/// fetch that FAILED; `?? const []` then renders both as a SUCCESSFUL fetch
/// that returned nothing. A user whose network had just died was shown a calm,
/// well-designed screen telling them they have no subscriptions.
///
/// That is not a cosmetic gap. An empty state invites acceptance and an error
/// state invites a retry, so the app was steering a recoverable failure toward
/// the one response that cannot recover from it. And because the wrong branch
/// raises nothing, clips nothing and fails no assertion, it was invisible to
/// everything except a test that looks for it — which is why it outlived ten
/// PRs of foundation work on these same files.
///
/// ── WHY A FUNCTION AND NOT A WIDGET ────────────────────────────────────────
/// A public widget class declared in `apps/subscriptiontracker/lib/features/**`
/// that no `builder:` in `core/router.dart` returns is an UNROUTED TWIN, and
/// `assert-responsive-coverage.mjs`'s DEAD COVERAGE limb exists to catch
/// exactly that shape — a measurement pointed at a widget no user can open.
/// The reusable thing here is the MAPPING, not a surface; the surface is
/// [DataStateView], which lives in the design system where both guards already
/// hold it. So this is a function that returns one, and the app grows no new
/// routable-looking class.
///
/// ── 🔴 WHERE THE CALLER MUST PUT IT: INSIDE THE CHROME, NEVER AROUND IT ────
/// `home_screen.dart:376-394` records the measurement in its own words: the
/// live file wrapped the WHOLE body in `.when(...)`, so a fetch in flight left
/// the user on a bare `CircularProgressIndicator` with no greeting, no account
/// name and — because the header is also the only route to /notifications —
/// **no way off the screen**. A spinner that eats the navigation is a dead end,
/// and a dead end during a failure is worse than the empty screen this replaces.
///
/// So every call site below hands this the BODY SLOT of a scaffold it has
/// already built. The app bar, the close control and the shell navigation are
/// outside the gate and survive all three states. `notifications` and `detail`
/// are the two that would actually strand a user — both reach `/home` only
/// through their own close button — and both keep it.
///
/// ── WHAT "EMPTY" MEANS HERE, PER SCREEN ────────────────────────────────────
/// [emptyTitle]/[emptyBody] are shown only when the fetch SUCCEEDED and the
/// user has no subscriptions AT ALL. That is deliberately NOT the same question
/// as "is there nothing to show in this section", and the two are kept apart:
/// `calendar_screen.dart` keeps `l10n.calendarEmpty` ("No renewals this month")
/// and `notifications_screen.dart` keeps its own `items.isEmpty` line, because
/// a user with five subscriptions and none due this month has a REAL month grid
/// and a real screen — replacing it with "No subscriptions yet" would be a
/// second false statement of the same family as the one being fixed.
///
/// ── ⚠️ REFRESH DOES NOT FLASH THE SPINNER ──────────────────────────────────
/// Returning null while a REFRESH is in flight is a deliberate fourth case, not
/// an omission: after a retry the provider is `AsyncLoading` and still carries
/// the previous list, so the caller keeps drawing the figures the user is
/// already reading instead of being thrown back to a spinner they just
/// dismissed. See the `hasValue` note on the guard itself.
///
/// ── RETURNS NULL WHEN THE CALLER SHOULD DRAW ITS OWN BODY ──────────────────
/// Null is "the list is here and it is not empty" — the ONLY case in which the
/// screen's real content is a true statement about the user's data.
Widget? subscriptionsState(
  WidgetRef ref, {
  required AppLocalizations l10n,
  required String emptyTitle,
  String? emptyBody,
  IconData? emptyIcon,
}) {
  final AsyncValue<List<Subscription>> subs = ref.watch(
    subscriptionsControllerProvider,
  );

  // 🔴 FAILURE IS TESTED FIRST, AND `hasValue` GUARDS BOTH LIMBS. An
  // `AsyncValue` is not a three-way switch: during a refresh it is `isLoading`
  // AND carries the previous data, and after a failed refresh it is `hasError`
  // and STILL carries it. Reading `isLoading` first would blink a spinner over
  // figures the user is already reading; reading `hasError` without the
  // `hasValue` guard would throw away a good list because a later refetch
  // failed. `hasValue` is what separates "we have nothing to show" from "we
  // have something, and an update is in flight or has failed".
  if (!subs.hasValue) {
    if (subs.hasError) {
      return DataStateView.failed(
        title: l10n.dataFailedTitle,
        body: l10n.dataFailedBody,
        retryLabel: l10n.retry,
        // `invalidate`, not a method on the controller: `build()` IS the fetch
        // (`subscriptions_controller.dart:139-168`), so invalidating re-runs it
        // and re-registers the two `ref.listen` edges in the same pass. A
        // bespoke `retry()` would be a second way to do the one thing `build`
        // already does, and the two would drift.
        onRetry: () => ref.invalidate(subscriptionsControllerProvider),
      );
    }
    return DataStateView.loading(label: l10n.dataLoading);
  }

  if (subs.requireValue.isEmpty) {
    return DataStateView.empty(
      title: emptyTitle,
      body: emptyBody,
      icon: emptyIcon,
    );
  }

  // The list is present and non-empty: the caller draws its real body.
  return null;
}

/// [subscriptionsState] in the shape a BODY SLOT wants — for a caller that has
/// already built its chrome and needs one widget to hand to it.
///
/// 🔴 IT IS A WRAPPER, NOT A SECOND IMPLEMENTATION, and that is deliberate.
/// Two screens want an early `return` and three want a widget in a slot; the
/// natural thing is to write the four-branch mapping twice in the two shapes,
/// and the repository has already paid for that twice over — `assert-no-tls-
/// pinning.mjs`'s union floor and #587's two branches each pinning the same
/// number are both the same failure: a second copy that stays plausible while
/// it drifts. There is ONE mapping. This adds a call shape to it and no logic.
Widget subscriptionsGate(
  WidgetRef ref, {
  required AppLocalizations l10n,
  required String emptyTitle,
  String? emptyBody,
  required Widget Function(List<Subscription> subs) builder,
  IconData? emptyIcon,
}) {
  final Widget? state = subscriptionsState(
    ref,
    l10n: l10n,
    emptyTitle: emptyTitle,
    emptyBody: emptyBody,
    emptyIcon: emptyIcon,
  );
  if (state != null) return state;
  return builder(ref.watch(subscriptionsControllerProvider).requireValue);
}
