import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

import '../core/app_config.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';

/// 🔒 The version of the privacy policy the consent prompt shows the user.
///
/// MUST equal `data-policy-version` on `sites/nikatru/privacy.html`. Without
/// that equality a consent artifact proves someone tapped a button but not what
/// they were shown, which is the one thing the record exists to establish —
/// so `tooling/ci/assert-seams-wired.mjs` fails the build if the two drift.
const String kPrivacyPolicyVersion = '2026-08-01';

/// 🔒 The version of the Terms of Service the sign-up clickwrap accepts.
///
/// ⚠️ NOT PINNED TO THE PUBLISHED PAGE YET, AND SAYING SO IS THE POINT.
/// `kPrivacyPolicyVersion` above is checked against `data-policy-version` on
/// `sites/nikatru/privacy.html` by `assert-seams-wired.mjs`; `terms.html`
/// carries NO machine-readable version marker, so there is nothing for an
/// equivalent limb to compare against. Adding the attribute is a change to a
/// published legal page and publishing sign-off is the owner's ([ADR 031]
/// class B) — so it is recorded as an integration duty rather than half-guarded
/// here. A conditional check that passes when the marker is absent is the
/// assertion-that-cannot-fail this repository refuses to ship.
///
/// 🔴 BUMPING THIS PUTS AN INTERSTITIAL IN FRONT OF EVERY SIGNED-IN USER. That
/// is the mechanism working, not a side effect — re-acceptance is a MATERIAL-
/// CHANGE flag (research/43), never a version bump for its own sake. Ship a
/// wording tidy-up without touching this line.
const String kTermsVersion = '2026-08-01';

/// The pair the sign-up clickwrap accepts and the interstitial compares
/// against. ONE constant so no caller can compare half the question.
const core.LegalVersions kLegalVersions = core.LegalVersions(
  terms: kTermsVersion,
  privacy: kPrivacyPolicyVersion,
);

/// G-12 first-party analytics wiring ([ADR 011]).
///
/// The whole funnel is OFF until two things are true: a real backend is
/// configured, and the user has granted analytics consent. Demo builds and
/// widget tests satisfy neither, so they get [core.NoOpAnalytics] and never
/// touch the network.

/// 🔒 THE SAME KEY THE BRICK USES for `installIdProvider`.
///
/// `anon_id` MUST be the identical value an app buckets feature-flag rollouts
/// with. Two independently minted ids make the rollout bucket and the analytics
/// cohort impossible to join, which silently renders every experiment
/// unmeasurable — and it cannot be fixed across installs already in the field.
/// Subly has no flag wiring yet; sharing the key now means it joins for free
/// when it does.
const String kInstallIdKey = 'nikatru.install_id';

// REMOVED 2026-08-10 — `backendLiveProvider` was declared here and, once the
// dialog-shaped `ConsentGate` was deleted, read by nothing. It was minted for
// [pipeline C-6] with a single purpose its own doc stated: "so the open-path
// WIDGET test can pump ConsentGate as a live build". The widget lost its last
// mount in the P2.6 chassis merge, the test went with it, and the provider was
// left declaring an override point onto nothing — a second, never-read way to
// ask `AppConfig.isBackendLive`, which is exactly the shape the note at the foot
// of this file records for `logEvent(Ref, …)`. The live prompt keys off
// [analyticsEnabledProvider] and always did; that is the one the surface tests
// override. If a caller ever needs the raw compile-time flag again, read
// `AppConfig.isBackendLive` directly or re-mint this WITH the caller.

/// Non-secret key-value store (install id, consent decision, event queue).
final FutureProvider<core.KeyValueStore> keyValueStoreProvider =
    FutureProvider<core.KeyValueStore>((ref) => PrefsKeyValueStore.create());

/// The stable pseudonymous per-install id. Generated once from a secure random
/// source, then returned unchanged on every launch. Never a device ad-ID.
final FutureProvider<String> installIdProvider = FutureProvider<String>((
  ref,
) async {
  final core.KeyValueStore kv = await ref.watch(keyValueStoreProvider.future);
  final String? existing = await kv.read(kInstallIdKey);
  if (existing != null && existing.isNotEmpty) return existing;
  final Random rng = Random.secure();
  final String id = List<int>.generate(
    16,
    (_) => rng.nextInt(256),
  ).map((int b) => b.toRadixString(16).padLeft(2, '0')).join();
  await kv.write(kInstallIdKey, id);
  return id;
});

/// [pipeline K-15] The device-level opt-out (Global Privacy Control).
///
/// 🔴 SUBLY WAS NOT WIRED TO IT, AND THE BRICK WAS — a drift, not a decision.
/// The chassis has passed `core.createPrivacySignal()` into its controller since
/// K-15 landed; this app constructed the controller with the default
/// `NoPrivacySignal`, so a GPC browser reached the live web build and was
/// ignored. Subly ships on web, which is the one platform where GPC exists at
/// all, so it is the app the gap actually cost.
///
/// A PROVIDER rather than an inlined `createPrivacySignal()` call for the reason
/// the chassis states about its own switches: on the VM the real signal is
/// always false, so a test could never drive the true branch and the honoured-
/// GPC path would be a seam nobody has watched carry a payload.
final Provider<core.PrivacySignal> privacySignalProvider =
    Provider<core.PrivacySignal>((ref) => core.createPrivacySignal());

/// The DPDP consent seam, hydrated from disk. Resolves to `unknown` — which
/// blocks collection — if the store is unreadable.
final FutureProvider<core.ConsentController> consentControllerProvider =
    FutureProvider<core.ConsentController>((ref) async {
      final core.KeyValueStore kv = await ref.watch(
        keyValueStoreProvider.future,
      );
      final core.ConsentController c = core.ConsentController(
        store: kv,
        privacySignal: ref.watch(privacySignalProvider),
      );
      await c.hydrate(core.ConsentPurpose.analytics);
      // [research/44 rung 4] The Art 21 objection rides the SAME controller.
      // Hydrated here rather than lazily at the first promo consult, because a
      // lazy read would mean the very first card is decided against an unread
      // store — and "we had not loaded it yet" is not a defence for processing
      // someone objected to. One extra key read at launch, no extra request.
      await c.hydrate(core.ConsentPurpose.promo);
      return c;
    });

/// Current analytics consent, for the UI to read and the prompt to drive.
final Provider<core.ConsentStatus> analyticsConsentProvider =
    Provider<core.ConsentStatus>((ref) {
      final core.ConsentController? c = ref
          .watch(consentControllerProvider)
          .valueOrNull;
      return c?.statusOf(core.ConsentPurpose.analytics) ??
          core.ConsentStatus.unknown;
    });

/// **Has this person objected to promotional processing?** (GDPR Art 21.)
///
/// The single read every promo surface consults. It answers `true` — objected —
/// in three different situations, and they are three because collapsing them
/// would hide the third:
///
///   1. a stored `promo` artifact with `granted: false` — they used the control;
///   2. a live GPC signal — an automated objection under Art 21(5), which
///      [core.ConsentController] applies without writing an artifact;
///   3. 🔴 **the controller has not resolved yet.** `valueOrNull` is null for
///      the first frames of every launch, and a promo rendered in that window is
///      rendered against an objection nobody has read. Unknown-because-unloaded
///      is not the same as unknown-because-untouched, and only the second one
///      may show. This is the one place they are told apart; below this line
///      `unknown` means "never objected" and permits, because the surface runs
///      on legitimate interest, not on consent.
final Provider<bool> promoObjectedProvider = Provider<bool>((ref) {
  final core.ConsentController? c = ref
      .watch(consentControllerProvider)
      .valueOrNull;
  if (c == null) return true; // still loading — hold, do not show
  return core.PromoObjection(c).objected;
});

/// **Has the rail been read yet?** — the third state [promoObjectedProvider]
/// deliberately hides, exposed for the one caller that must not lose it.
///
/// 🔴 A GATE AND A CONTROL NEED OPPOSITE ANSWERS WHILE THE RAIL IS LOADING.
/// Case 3 above falls closed because a promotional surface rendered against an
/// unread objection is the outcome Art 21(3) forbids. A SETTINGS ROW that read
/// the same boolean would tell a person who has never objected "Offers are off"
/// on every launch — and a tap in that window calls `recordPromoObjection(ref,
/// objected: false)`, which writes AND uploads a `promo granted: true` artifact
/// recording a decision they never made. Falling closed protects someone from a
/// card; it does not license a claim about what they chose.
///
/// So the control reads BOTH: [promoObjectedProvider] for the value and this for
/// whether the value means anything yet. One derivation, two readings, and the
/// asymmetry written down once instead of inferred twice.
final Provider<bool> promoObjectionKnownProvider = Provider<bool>(
  (ref) => ref.watch(consentControllerProvider).valueOrNull != null,
);

/// Whether the consent question has been ANSWERED yet — distinct from whether
/// it was answered yes.
///
/// `unknown` means two different things to two different callers: to the
/// recorder it means "collect nothing" (correct), but to the UI it must mean
/// "still ask" — and while [consentControllerProvider] is resolving from disk
/// the status also reads `unknown`. Prompting on that would flash the dialog at
/// every launch for a user who already decided. So the UI keys off the resolved
/// controller, not the status alone.
final Provider<bool> consentDecidedProvider = Provider<bool>((ref) {
  final AsyncValue<core.ConsentController> c = ref.watch(
    consentControllerProvider,
  );
  if (!c.hasValue) return true; // still loading — do NOT prompt yet
  return c.requireValue.statusOf(core.ConsentPurpose.analytics) !=
      core.ConsentStatus.unknown;
});

/// Ships the consent artifact to the append-only server record.
///
/// The analytics ON switch — converged here in P2.6b exactly as the spine's
/// P2.6a comments scheduled ('the two converge when chassis_properties_test
/// lands'). A compile-time AppConfig read here made every container override
/// inert: the property suite could never open the rail, so seven of its cases
/// asserted against a NoOpAnalytics nothing could replace. Overridable-by-design.
final Provider<bool> analyticsEnabledProvider = Provider<bool>(
  (ref) => AppConfig.isBackendLive,
);

/// Ships event batches. A provider so the property test can watch a REAL event
/// arrive rather than assert that a fake returns what it was told to return.
final Provider<core.EventTransport> eventTransportProvider =
    Provider<core.EventTransport>(
      (ref) => DioEventTransport(platformBaseUrl: AppConfig.platformBaseUrl),
    );

/// Discards in demo/test builds, so a widget test never reaches the network and
/// an app with no backend configured is not broken by having a consent UI.
final Provider<core.ConsentTransport> consentTransportProvider =
    Provider<core.ConsentTransport>((ref) {
      if (!ref.watch(analyticsEnabledProvider)) {
        return const core.DiscardingConsentTransport();
      }
      return DioConsentTransport(platformBaseUrl: AppConfig.platformBaseUrl);
    });

/// The decision path, with no Riverpod and no Flutter in it.
///
/// Split out from [recordAnalyticsConsent] so it can be tested directly against
/// fakes. That is the point of this requirement rather than a nicety: the bug
/// being fixed was that nothing ever called [core.ConsentController.record], and
/// a path only reachable through a widget tree and three async providers is one
/// nobody writes a test for.
/// ⚠️ ONE DECISION PATH FOR EVERY PURPOSE, NOT ONE PER PURPOSE. [purpose] is a
/// parameter (defaulting to analytics, which is every pre-existing caller) so
/// the `promo` objection inherits this function's whole contract — the
/// append-only artifact, the policy-version stamp, the shared anon id, the
/// best-effort upload — instead of a second copy that drifts from it. [pipeline
/// C-3]: no capability exists twice.
Future<core.ConsentArtifact> applyConsentDecision({
  required core.ConsentController controller,
  required core.ConsentTransport transport,
  required String appId,
  required String anonId,
  required bool granted,
  core.ConsentPurpose purpose = core.ConsentPurpose.analytics,
  core.Analytics? analytics,
  String appVersion = AppConfig.appVersion,
  String? platform,
  DateTime? now,
}) async {
  final core.ConsentArtifact artifact = await controller.record(
    purpose,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
    anonId: anonId,
    now: now ?? DateTime.now(),
    appVersion: appVersion,
    platform: platform ?? _platformName(),
  );
  // 🔴 WITHDRAWAL DROPS WHAT IS ALREADY QUEUED (DPDP §6(3)). Recording the
  // artifact above shuts new collection instantly — the recorder holds this same
  // controller — but the outbox still contains everything gathered under the old
  // grant, in memory AND on disk, and it would ship on the next flush. Stopping
  // the enqueue is not withdrawal; dropping the payload is.
  //
  // Before the upload, not after: the user's right to have it dropped does not
  // depend on the network being up.
  //
  // 🔴 SCOPED TO THE PURPOSE THE OUTBOX BELONGS TO. The queue holds ANALYTICS
  // events, so a `promo` objection must not empty it: objecting to being shown
  // an offer says nothing about analytics the person separately consented to,
  // and deleting it would be destroying lawfully-held data on the strength of an
  // unrelated control. The reverse mistake — purging on every purpose "to be
  // safe" — is the one an untyped `if (!granted)` makes silently.
  if (!granted && purpose == core.ConsentPurpose.analytics) {
    await analytics?.purge();
  }
  // Best-effort by contract. The decision already applies on-device, so an
  // upload failure must never make the user's choice look rejected.
  await transport.send(appId: appId, artifact: artifact);
  return artifact;
}

/// Record the sign-up legal decisions: the BLOCKING terms acceptance and the
/// EXPRESS marketing-email opt-in, as two separate artifacts.
///
/// Split out from the widget for the same reason [applyConsentDecision] is: the
/// bug class this whole area keeps producing is a decision path nothing ever
/// calls, and a path reachable only through a widget tree and three async
/// providers is one nobody writes a test for.
///
/// 🔴 TWO ARTIFACTS, NEVER ONE. Bundling them would make the marketing opt-in a
/// limb of a consent the user could not decline — which is the "optional consent
/// riding on a mandatory one" shape research/43 declined outright, and it would
/// also make the shipped signups KV's purpose limitation unprovable.
///
/// 🔴 THE DECLINE IS RECORDED TOO, and that is deliberate. `granted: false` for
/// `marketing-email` is the evidence that the box existed and was left unticked
/// — an absent row proves nothing, because it is also what "we never asked"
/// looks like. The artifact carries no PII (an anon id, never the address).
///
/// The terms artifact's `policyVersion` is the COMPOSITE stamp, not the privacy
/// version alone: a terms-only change has to be visible to the re-acceptance
/// check, and it cannot be if only one of the two is written down.
///
/// 🔴 `marketingEmail` IS NULLABLE, AND NULL IS NOT FALSE. Null means THIS
/// SURFACE DID NOT ASK, so nothing is recorded for that purpose and whatever the
/// user decided previously stands. The re-acceptance interstitial passes null:
/// it shows no marketing box, and writing `granted: false` from it would
/// silently unsubscribe somebody for accepting a terms change. A three-state
/// argument here is what stops one screen speaking for a decision taken on
/// another.
Future<core.ConsentArtifact> applyLegalAcceptance({
  required core.ConsentController controller,
  required core.ConsentTransport transport,
  required String appId,
  required String anonId,
  required bool? marketingEmail,
  core.LegalVersions versions = kLegalVersions,
  String appVersion = AppConfig.appVersion,
  String? platform,
  DateTime? now,
}) async {
  final DateTime at = now ?? DateTime.now();
  final String plat = platform ?? _platformName();
  final core.ConsentArtifact terms = await controller.record(
    core.ConsentPurpose.terms,
    granted: true,
    policyVersion: versions.stamp,
    anonId: anonId,
    now: at,
    appVersion: appVersion,
    platform: plat,
  );
  // Best-effort by contract, exactly as the analytics decision is: the decision
  // already applies on-device, and an upload failure must never make a user's
  // choice look rejected. Sent in the order they were taken.
  await transport.send(appId: appId, artifact: terms);
  if (marketingEmail != null) {
    final core.ConsentArtifact marketing = await controller.record(
      core.ConsentPurpose.marketingEmail,
      granted: marketingEmail,
      policyVersion: versions.stamp,
      anonId: anonId,
      now: at,
      appVersion: appVersion,
      platform: plat,
    );
    await transport.send(appId: appId, artifact: marketing);
  }
  return terms;
}

/// Record the user's analytics decision, upload the artifact, and make the new
/// decision visible to everything watching.
///
/// The invalidate at the end is load-bearing, not tidiness: [core.ConsentController.record]
/// mutates the controller's own cache, so Riverpod sees no new object and would
/// never rebuild [analyticsProvider] — the recorder would keep its stale
/// fail-closed view and go on discarding events for the rest of the session,
/// which is indistinguishable from the bug this whole requirement exists to fix.
/// Invalidating re-reads the persisted decision from disk, which also proves the
/// write actually landed.
Future<void> recordAnalyticsConsent(
  WidgetRef ref, {
  required bool granted,
}) async {
  final core.ConsentController controller = await ref.read(
    consentControllerProvider.future,
  );
  final String anonId = await ref.read(installIdProvider.future);
  await applyConsentDecision(
    controller: controller,
    transport: ref.read(consentTransportProvider),
    appId: AppConfig.appId,
    anonId: anonId,
    granted: granted,
    // The LIVE recorder, read before the invalidate below disposes it. A
    // `valueOrNull` miss (analytics still resolving) is survivable and not a
    // hole: the rebuilt recorder's `hydrate` refuses to restore a queue under a
    // denied decision and deletes the persisted copy, so the disk half dies
    // either way.
    analytics: ref.read(analyticsProvider).valueOrNull,
  );
  ref.invalidate(consentControllerProvider);
}

/// Record the GDPR **Art 21 objection** to promotional processing, upload the
/// artifact, and make it visible to every promo surface. [objected] `true` =
/// stop; `false` = the person turned offers back on themselves.
///
/// It is [recordAnalyticsConsent]'s twin down to the invalidate, and it is a
/// separate function rather than a `purpose:` argument on that one for a reason
/// worth stating: the two are wired to different controls with different legal
/// bases, and a single entry point would let a settings row pass the wrong
/// purpose and silently move the wrong decision. The SHARED half —
/// [applyConsentDecision] — is where the reuse lives.
///
/// 🔴 `granted` IS INVERTED, ONCE, THROUGH A NAMED HELPER. The rail's field
/// means *may this purpose be processed*, so an objection is `granted: false`.
/// Spelling that inversion out at every call site is how one of them ends up
/// spelled the other way; `core.PromoObjection.grantedForObjection` is the one
/// place it happens.
Future<void> recordPromoObjection(
  WidgetRef ref, {
  required bool objected,
}) async {
  final core.ConsentController controller = await ref.read(
    consentControllerProvider.future,
  );
  final String anonId = await ref.read(installIdProvider.future);
  await applyConsentDecision(
    controller: controller,
    transport: ref.read(consentTransportProvider),
    appId: AppConfig.appId,
    anonId: anonId,
    purpose: core.ConsentPurpose.promo,
    granted: core.PromoObjection.grantedForObjection(objected: objected),
    // No `analytics:` — see the purge note in `applyConsentDecision`. A promo
    // objection has no outbox of its own and must not empty anyone else's.
  );
  // Same load-bearing invalidate as the analytics path: `record` mutates the
  // controller's own cache, so nothing watching it would rebuild and the card
  // would keep rendering for the rest of the session against a decision the
  // user has already made.
  ref.invalidate(consentControllerProvider);
}

String _platformName() {
  if (kIsWeb) return 'web';
  try {
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isWindows) return 'windows';
    if (Platform.isLinux) return 'linux';
  } catch (_) {
    // Platform is unavailable in some test environments.
  }
  return 'unknown';
}

/// The analytics facade the app programs against.
///
/// Resolves to [core.NoOpAnalytics] unless the backend is live — so demo mode
/// and tests are hermetic. When live, the recorder itself refuses to collect
/// until consent is granted, so this provider being non-noop is NOT consent.
final FutureProvider<core.Analytics>
analyticsProvider = FutureProvider<core.Analytics>((ref) async {
  if (!ref.watch(analyticsEnabledProvider)) return const core.NoOpAnalytics();
  final core.KeyValueStore kv = await ref.watch(keyValueStoreProvider.future);
  final String anonId = await ref.watch(installIdProvider.future);
  final core.ConsentController consent = await ref.watch(
    consentControllerProvider.future,
  );
  final core.AnalyticsRecorder recorder = core.AnalyticsRecorder(
    appId: AppConfig.appId,
    anonId: anonId,
    transport: ref.watch(eventTransportProvider),
    consent: consent,
    queueStore: kv,
    envelope: <String, Object?>{
      'platform': _platformName(),
      'app_version': AppConfig.appVersion,
    },
  );
  // 🔴 Same wiring as the brick's ([11]E-4a): the recorder owns a flush deadline
  // now, and this provider is rebuilt on every consent decision. Without this
  // the discarded recorder's timer outlives it. See the brick's copy for the
  // full reasoning — this app and the brick must not drift on it.
  ref.onDispose(recorder.dispose);
  await recorder.hydrate();
  return recorder;
});

// REMOVED 2026-08-01 — `logEvent(Ref, …)` was declared here and called from
// nowhere in this app (the 2026-08-01 corpus review found zero call sites; the
// brick's own copy IS wired, at its `app.dart`). A second, never-called path to
// the analytics rail inflates apparent coverage and is exactly what
// `assert-seams-wired` exists to stop being mistaken for a wiring. Features here
// read `analyticsProvider` directly. If a fire-and-forget helper is wanted again,
// it belongs in the chassis with a caller, not in this frozen app without one.
