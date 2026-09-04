// SECTION J of the spine — the router's refresh signal. Re-exported from
// `../providers.dart`.

import 'package:flutter/foundation.dart' show ChangeNotifier, Listenable;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'auth.dart';
import 'legal.dart';
import 'preferences.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION J · THE ROUTER'S REFRESH SIGNAL
// ═════════════════════════════════════════════════════════════════════════════

/// A ChangeNotifier something outside it can fire. `notifyListeners` is
/// protected, which is the right default and the wrong one for a bridge whose
/// entire job is to be fired from elsewhere.
class _Bump extends ChangeNotifier {
  void bump() => notifyListeners();
}

/// What the stamped router listens to — [pipeline C-13].
///
/// TWO signals, merged, because the redirect depends on two things that arrive
/// at different times: the session (auth) and the first-run flag (disk). The
/// first version listened only to auth, so the onboarding flag could resolve and
/// the router would never look again.
///
/// This IS what the live router listens to: `lib/core/router.dart` passes it to
/// `refreshListenable` (anchored verbatim by
/// `tooling/ci/assert-stamp-properties.mjs`). The old `core/router/app_router.dart`
/// and its private `GoRouterRefreshStream` bridge are gone — P2.5 de-duplicated
/// the two routers onto the STAMPED `lib/core/router.dart` path, and the bridge
/// class was retired once this provider provably covered the auth-change case.
final Provider<Listenable> routerRefreshProvider = Provider<Listenable>((ref) {
  final _Bump onboarding = _Bump();
  // 🔄 `(bool? _, bool? _)` — TWO wildcards, not `_`/`__`. The brick template
  // writes `__` for the second, which `nikatru_lints`' `unnecessary_underscores`
  // reports as an info under Subly's resolved lint set. Dart 3.7+ allows the
  // wildcard `_` to repeat in a parameter list, so this is the same code with
  // one fewer diagnostic. Measured, not assumed: it is the only NEW analyzer
  // finding this whole 1300-line merge produces inside the file itself.
  ref.listen<bool?>(
    onboardingSeenProvider,
    (bool? _, bool? _) => onboarding.bump(),
  );
  // 🔴 WITHOUT THIS THE INTERSTITIAL IS A DEAD END. `redirect` fires on
  // navigation, not on a provider settling, so a user who ticks the box on
  // `/reaccept-terms` changes the gate's answer and nothing re-runs the gate —
  // they sit on the screen they just completed. Exactly the defect
  // `refreshListenable` was added for when a session appeared, one gate later.
  //
  // It also covers HYDRATION: the first redirect runs while the store is still
  // being read and correctly declines to decide; this is what brings the router
  // back once the answer exists.
  //
  // 🔴 LISTEN TO THE PROVIDER THE REDIRECT READS — `legalReacceptanceNeeded
  // Provider`, THE DERIVED ONE, NOT `legalAcceptanceProvider` UNDERNEATH IT.
  // This line said `legalAcceptanceProvider` and the gate did not work at all
  // on a real launch. TRACED, not reasoned (2026-08-10, probe prints inside
  // this listener and inside the redirect):
  //
  //     PROBE legal listen fired null ->
  //     PROBE redirect loc=/onboarding … reaccept=null      ← STALE
  //     PROBE redirect loc=/home       … reaccept=null      ← STALE
  //
  // The bump fired and the redirect DID re-run — and read `null` both times,
  // because the listener is called while the SOURCE notifier is publishing its
  // new state and Riverpod has not yet recomputed the derived provider that
  // depends on it. The router then settled on `/home` for a signed-in user with
  // no acceptance on record: gated in principle, ungated in fact, on every
  // launch. A hand-called `router.refresh()` one frame later moved it, which is
  // what made this look like a go_router or pump-cadence problem for a whole
  // session — it is neither.
  //
  // ⚠️ THE ONBOARDING LIMB ABOVE NEVER HAD THE BUG, and the asymmetry is the
  // whole diagnosis: the redirect reads `onboardingSeenProvider` — the very
  // provider that limb listens to — so its listener cannot be early. The rule
  // this encodes: a refresh signal must be taken from the SAME provider whose
  // value the refreshed code reads. Listening one layer down buys a stale read
  // with no symptom at the listen site.
  //
  // Both directions are pinned from a pumped app in the
  // `legal-reacceptance-gated` chassis property, which navigates nowhere — a
  // pass there is exactly the claim that this line is what re-runs the gate.
  final _Bump legal = _Bump();
  ref.listen<bool?>(
    legalReacceptanceNeededProvider,
    (bool? _, bool? _) => legal.bump(),
  );
  // 🔴 A FOURTH SIGNAL, AND WITHOUT IT THE RECOVERY GATE NEVER FIRES ON A REAL
  // LAUNCH. The recovery event arrives while the user sits on whatever screen
  // the browser opened — nobody navigates — so `redirect` is never consulted and
  // the gate might as well not be written. The same defect the auth signal was
  // added for when a session appeared, and the legal signal one gate later.
  //
  // Listens to `passwordRecoveryProvider` — the provider the redirect READS —
  // per the rule the legal limb had to learn from a traced stale read: a
  // listener one layer down is called while the source is still publishing.
  final _Bump recovery = _Bump();
  ref.listen<bool>(
    passwordRecoveryProvider,
    (bool? _, bool _) => recovery.bump(),
  );
  // 🔴 A FIFTH SIGNAL, and it is the failure half of the fourth. The recovery
  // ARRIVAL can change without any session change at all: the seam turns a
  // failed exchange into `recoveryLinkFailed` (GlitchTip SUBLY-8, which used to
  // be a fatal crash), and nobody navigates when that lands either. Same rule as
  // every limb above — listen to the provider the redirect READS.
  final _Bump resetArrival = _Bump();
  ref.listen<core.PasswordResetArrivalReport>(
    passwordResetArrivalProvider,
    (core.PasswordResetArrivalReport? _, core.PasswordResetArrivalReport _) =>
        resetArrival.bump(),
  );
  ref.onDispose(onboarding.dispose);
  ref.onDispose(legal.dispose);
  ref.onDispose(recovery.dispose);
  ref.onDispose(resetArrival.dispose);
  return Listenable.merge(<Listenable>[
    ref.watch(authRefreshProvider),
    onboarding,
    legal,
    recovery,
    resetArrival,
  ]);
});
