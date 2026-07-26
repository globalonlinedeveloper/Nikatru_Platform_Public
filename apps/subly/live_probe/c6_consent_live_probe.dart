// [pipeline C-6] MANUAL LIVE PROBE — writes to PRODUCTION. Not a test.
//
// ⚠️ DELIBERATELY OUTSIDE `test/` so `melos run test` and CI never run it. It
// posts real rows to the live platform Worker and production `platform_db`.
//
// Run it by hand from apps/subly:
//   flutter test live_probe/c6_consent_live_probe.dart
// then verify the rows in D1 and DELETE them (they carry app_version
// 'c6-localprobe', which is what makes them identifiable and removable).
//
// WHY IT EXISTS. Stage 3 declared the analytics rail LIVE-VERIFIED on the
// strength of curling the Worker. The Worker was never the broken half — the
// CLIENT was, and no amount of server testing could see it. This probe drives
// the app's own objects: the real ConsentController, the real
// DioConsentTransport, the real AnalyticsRecorder over the real
// DioEventTransport, against the real production endpoint. The only thing it
// does not exercise is the tap that calls `applyConsentDecision`, and that call
// is asserted by `tooling/ci/assert-seams-wired.mjs` plus the widget-level
// wiring in consent_prompt.dart.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:subly/state/analytics_funnel.dart';
import 'package:subly/state/analytics_providers.dart';

const String kProbePlatformBase = 'https://platform.nikatru.com';
const String kProbeAppVersion = 'c6-localprobe';

/// In-memory store: the probe must not touch the developer's real prefs.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

void main() {
  test(
    'LIVE: consent + funnel reach production',
    () async {
      final _MemStore store = _MemStore();
      // A fixed anon id so the rows are findable and deletable afterwards.
      const String anonId = 'c6probe-0000000000000001';
      final core.ConsentController consent = core.ConsentController(
        store: store,
      );

      // 1. The real decision path, over the real consent transport.
      final core.ConsentArtifact artifact = await applyConsentDecision(
        controller: consent,
        transport: DioConsentTransport(platformBaseUrl: kProbePlatformBase),
        appId: 'subly',
        anonId: anonId,
        granted: true,
        appVersion: kProbeAppVersion,
        platform: 'probe',
      );
      expect(
        consent.statusOf(core.ConsentPurpose.analytics),
        core.ConsentStatus.granted,
      );
      // ignore: avoid_print
      print('consent_id  = ${artifact.consentId}');

      // 2. The real recorder over the real event transport — the exact objects
      //    apps/subly/lib/state/analytics_providers.dart builds at runtime.
      final core.AnalyticsRecorder recorder = core.AnalyticsRecorder(
        appId: 'subly',
        anonId: anonId,
        transport: DioEventTransport(platformBaseUrl: kProbePlatformBase),
        consent: consent,
        queueStore: store,
        envelope: <String, Object?>{
          'platform': 'probe',
          'app_version': kProbeAppVersion,
        },
      );
      await recorder.hydrate();

      // 3. The real launch funnel — first_launch + app_open, as app.dart fires it.
      await AnalyticsFunnel(analytics: recorder, store: store).onLaunch();
      await recorder.flush();

      // ignore: avoid_print
      print('flushed for anon_id=$anonId app_version=$kProbeAppVersion');
    },
    timeout: const Timeout(Duration(seconds: 60)),
  );
}
