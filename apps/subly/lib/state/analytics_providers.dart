import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

import '../core/config/app_config.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';

/// 🔒 The version of the privacy policy the consent prompt shows the user.
///
/// MUST equal `data-policy-version` on `sites/nikatru/privacy.html`. Without
/// that equality a consent artifact proves someone tapped a button but not what
/// they were shown, which is the one thing the record exists to establish —
/// so `tooling/ci/assert-seams-wired.mjs` fails the build if the two drift.
const String kPrivacyPolicyVersion = '2026-07-26';

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

/// The DPDP consent seam, hydrated from disk. Resolves to `unknown` — which
/// blocks collection — if the store is unreadable.
final FutureProvider<core.ConsentController> consentControllerProvider =
    FutureProvider<core.ConsentController>((ref) async {
      final core.KeyValueStore kv = await ref.watch(
        keyValueStoreProvider.future,
      );
      final core.ConsentController c = core.ConsentController(store: kv);
      await c.hydrate(core.ConsentPurpose.analytics);
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
/// Discards in demo/test builds, so a widget test never reaches the network and
/// an app with no backend configured is not broken by having a consent UI.
final Provider<core.ConsentTransport> consentTransportProvider =
    Provider<core.ConsentTransport>((ref) {
      if (!AppConfig.isBackendLive) {
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
Future<core.ConsentArtifact> applyConsentDecision({
  required core.ConsentController controller,
  required core.ConsentTransport transport,
  required String appId,
  required String anonId,
  required bool granted,
  String appVersion = AppConfig.appVersion,
  String? platform,
  DateTime? now,
}) async {
  final core.ConsentArtifact artifact = await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
    anonId: anonId,
    now: now ?? DateTime.now(),
    appVersion: appVersion,
    platform: platform ?? _platformName(),
  );
  // Best-effort by contract. The decision already applies on-device, so an
  // upload failure must never make the user's choice look rejected.
  await transport.send(appId: appId, artifact: artifact);
  return artifact;
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
  );
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
  if (!AppConfig.isBackendLive) return const core.NoOpAnalytics();
  final core.KeyValueStore kv = await ref.watch(keyValueStoreProvider.future);
  final String anonId = await ref.watch(installIdProvider.future);
  final core.ConsentController consent = await ref.watch(
    consentControllerProvider.future,
  );
  final core.AnalyticsRecorder recorder = core.AnalyticsRecorder(
    appId: AppConfig.appId,
    anonId: anonId,
    transport: DioEventTransport(platformBaseUrl: AppConfig.platformBaseUrl),
    consent: consent,
    queueStore: kv,
    envelope: <String, Object?>{
      'platform': _platformName(),
      'app_version': AppConfig.appVersion,
    },
  );
  await recorder.hydrate();
  return recorder;
});

/// Fire-and-forget helper so a feature never has to await analytics, and a
/// still-resolving provider can never delay a user-facing action.
void logEvent(Ref ref, String event, {Map<String, Object?>? params}) {
  final core.Analytics? a = ref.read(analyticsProvider).valueOrNull;
  if (a == null) return; // not ready yet — dropping beats blocking the UI
  a.log(event, params: params);
}
