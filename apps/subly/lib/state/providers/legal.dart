// SECTION H2 of the spine — legal acceptance (research/43 riders, owner
// 2026-08-09). Re-exported from `../providers.dart`.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../analytics_providers.dart';
import 'auth.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION H2 · LEGAL ACCEPTANCE (research/43 riders, owner 2026-08-09)
//
// The clickwrap the user ticked at sign-up, and the interstitial that asks
// again when the documents materially change. One store, one artifact, one
// append-only trail: this reads the SAME `ConsentController` every other
// purpose is recorded through, rather than minting a second private key that
// could drift from the record the server holds.
// ═════════════════════════════════════════════════════════════════════════════

/// The `LegalVersions.stamp` the signed-in user last accepted.
///
/// 🔴 THREE STATES, EXACTLY AS [OnboardingSeenController] HAS THREE, AND FOR
/// THE SAME MEASURED REASON. Hydration is async and the router's redirect runs
/// before the disk read lands:
///   · `null`  — not known yet. The redirect DECLINES TO DECIDE. A plain `''`
///     default would flash the re-acceptance interstitial at every launch for a
///     user who accepted months ago, and the router does not re-run on its own.
///   · `''`    — read, and nothing was ever accepted.
///   · a stamp — read, and this is what they agreed to.
///
/// ⚠️ ONLY A GRANTED ARTIFACT COUNTS. A `terms` artifact with `granted: false`
/// is a refusal, and reading its `policyVersion` would turn "I declined" into "I
/// accepted this version". The clickwrap never records a decline today — it
/// blocks instead — but the store is append-only and shared, so the reader must
/// not depend on a writer's current manners.
class LegalAcceptanceController extends Notifier<String?> {
  bool _userChose = false;

  /// Whether the identity stream has resolved at least once, and whether there
  /// was a session when it did. Two plain bools: no identifier is kept here,
  /// and that is the point — see [_reaskKey].
  bool _sawSession = false;
  bool _hadSession = false;

  @override
  String? build() {
    // 🔴 A SESSION ENDING RETIRES THE ACCEPTANCE ON THIS DEVICE. Without it the
    // acceptance is device-scoped while the router treats it as user-scoped,
    // and on a shared or family device that difference admits somebody who
    // never accepted anything: A signs up and accepts → A signs out → B signs
    // in to a pre-clickwrap account → the gate compares A's stamp, answers "no
    // re-acceptance needed", and B is inside the product having agreed to
    // nothing, with a record on file saying somebody did.
    //
    // 🔴 WHY IT IS A SIGN-OUT MARKER AND NOT THE OBVIOUS "REMEMBER WHO
    // ACCEPTED". Storing the accepting user's id beside this device's consent
    // artifact is a PAID identifier next to a PSEUDONYMOUS one, which [ADR 020]
    // forbids and `tooling/ci/assert-pseudonymity-firewall.mjs` fails the build
    // on — it was written that way first and the guard caught it in both trees.
    // The lock is not a formality: creating that mapping once retroactively
    // reclassifies the whole analytics corpus as personal data, for every app,
    // and deleting the pairing afterwards does not undo it. Nothing here
    // records WHO accepted; it records only that a session ended, which is
    // enough to make the next person answer for themselves.
    //
    // ⚠️ THE COST, STATED: a user who signs out and back in is asked once more.
    // research/43 declined re-asking on EVERY sign-in, and this is not that —
    // it is triggered by an explicit sign-out, never by a launch. Between the
    // two errors, asking one returning user again and admitting a different
    // person ungated, only the second is unrecoverable.
    ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (
      AsyncValue<core.AuthUser?>? previous,
      AsyncValue<core.AuthUser?> next,
    ) {
      if (next.isLoading) return;
      final bool hasSession = next.valueOrNull != null;
      // ⚠️ THE TRANSITION, NOT THE VALUE. `authUserProvider` resolves to null on
      // every signed-out launch, and treating THAT as a sign-out would mark a
      // re-ask before anybody had signed in — which is the "ask on every
      // sign-in" pattern research/43 declined, arriving by accident.
      final bool wasSignedIn = _sawSession && _hadSession;
      _sawSession = true;
      _hadSession = hasSession;
      if (!wasSignedIn || hasSession) return;
      _userChose = false;
      state = '';
      _markReask();
    });
    _hydrate();
    return null;
  }

  /// Set when a session ENDS, cleared when somebody accepts.
  ///
  /// Holds the literal string `true` and nothing else. It deliberately carries
  /// no user id, no address and no anon id: its only job is to make the next
  /// person on this device answer the clickwrap for themselves, and any
  /// identifier stored here would be the [ADR 020] pairing described above.
  static const String _reaskKey = 'nikatru.legal.reask';

  Future<void> _markReask() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_reaskKey, 'true');
    } catch (_) {
      // Best-effort. The in-memory `state = ''` above already gates THIS
      // session; a failed write only means a relaunch forgets, which is the
      // same direction every other decision in this class takes.
    }
  }

  Future<void> _hydrate() async {
    try {
      final core.ConsentController c = await ref.read(
        consentControllerProvider.future,
      );
      final core.ConsentStatus status = await c.hydrate(
        core.ConsentPurpose.terms,
      );
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final bool reask = (await kv.read(_reaskKey)) == 'true';
      // 🔴 EVERY ASSIGNMENT BELOW THE GUARD, NONE ABOVE IT. The read above is
      // an `await`, so a value assigned before this line would clobber a user
      // who ticked the box while the disk was still being read — and a partial
      // clobber is still a clobber.
      if (_userChose) return; // the user got there first — never clobber
      final core.ConsentArtifact? a = c.artifactOf(core.ConsentPurpose.terms);
      // A session ended on this device since the last acceptance, so whoever is
      // holding it now has to answer for themselves. The ARTIFACT is untouched:
      // it is the append-only legal record and it is not this flag's business.
      state = (!reask && status == core.ConsentStatus.granted && a != null)
          ? a.policyVersion
          : '';
    } catch (_) {
      // Unreadable store ⇒ ASK AGAIN. Resolving to '' rather than staying null
      // matters: null blocks the decision forever and the user sees a spinner
      // where the app should be. The cost is asymmetric in the same direction
      // as onboarding's — asking twice is a nuisance, never asking means
      // somebody is using the product under terms they were never shown.
      if (!_userChose) state = '';
    }
  }

  /// Record acceptance of [kLegalVersions] plus the express marketing decision,
  /// and make the router's gate open.
  ///
  /// In memory FIRST, exactly as [OnboardingSeenController.set] is: the redirect
  /// reads this synchronously the moment the screen navigates away, and a slow
  /// write must not bounce the user straight back into the interstitial.
  ///
  /// [marketingEmail] null = THIS SURFACE DID NOT ASK — see [acceptTermsOnly].
  Future<void> accept({required bool? marketingEmail}) async {
    _userChose = true;
    state = kLegalVersions.stamp;
    try {
      final core.ConsentController controller = await ref.read(
        consentControllerProvider.future,
      );
      final String anonId = await ref.read(installIdProvider.future);
      await applyLegalAcceptance(
        controller: controller,
        transport: ref.read(consentTransportProvider),
        appId: AppConfig.appId,
        anonId: anonId,
        marketingEmail: marketingEmail,
      );
      // The re-ask marker is cleared AFTER the artifact, so a half-written pair
      // reads as "still owed" rather than "settled" over a record that is not
      // there. Safe direction, same as everywhere else in this class.
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.remove(_reaskKey);
    } catch (_) {
      // Best-effort, and the in-memory state above is what the user experiences.
      // A failed write means the interstitial returns next launch — the safe
      // direction, and the same one every other decision here takes.
    }
  }

  /// Re-accept the documents WITHOUT touching the marketing decision.
  ///
  /// The interstitial's entry point. A named method rather than
  /// `accept(marketingEmail: null)` at the call site, because the thing being
  /// prevented is somebody "tidying" that null into a `false` — which reads
  /// harmless and silently unsubscribes every user who accepts a terms change.
  ///
  Future<void> acceptTermsOnly() => accept(marketingEmail: null);
}

final NotifierProvider<LegalAcceptanceController, String?>
legalAcceptanceProvider = NotifierProvider<LegalAcceptanceController, String?>(
  LegalAcceptanceController.new,
);

/// Whether the signed-in user must be shown the re-acceptance interstitial.
///
/// Null means "cannot tell yet" and the router must decline to decide — the
/// third state exists precisely so this question has an honest "not yet".
final Provider<bool?> legalReacceptanceNeededProvider = Provider<bool?>((ref) {
  final String? accepted = ref.watch(legalAcceptanceProvider);
  if (accepted == null) return null;
  return core.needsLegalReacceptance(
    // '' is "never accepted", and it is passed through as a real value rather
    // than mapped back to null: `needsLegalReacceptance` treats both the same,
    // and collapsing them here would re-create the loading ambiguity one layer
    // down.
    acceptedStamp: accepted,
    current: kLegalVersions,
  );
});
