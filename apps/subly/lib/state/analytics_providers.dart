import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

import '../core/config/app_config.dart';
import '../data/analytics/dio_event_transport.dart';

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
