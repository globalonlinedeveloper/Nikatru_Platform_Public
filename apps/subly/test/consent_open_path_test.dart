import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/state/analytics_providers.dart';

/// [pipeline C-6] THE OPEN-PATH TEST.
///
/// Every other test in this repo about consent proves the rail correctly stays
/// SHUT. That is what let the real defect ship: consent was never granted by any
/// code path, so the recorder discarded every event — and each of those tests
/// still passed, because refusing was exactly what they asserted.
///
/// These tests assert the opposite direction: that the app's own decision path
/// actually OPENS the rail and an event reaches the transport. If the wiring is
/// removed, these go red. That is the whole contract.
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

class _CapturingConsentTransport implements core.ConsentTransport {
  final List<core.ConsentArtifact> sent = <core.ConsentArtifact>[];
  String? lastAppId;
  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    lastAppId = appId;
    sent.add(artifact);
    return const core.Result<void>.ok(null);
  }
}

void main() {
  group('[C-6] the analytics rail can actually be opened', () {
    test('granting consent records an artifact AND ships it', () async {
      final _MemStore store = _MemStore();
      final core.ConsentController controller = core.ConsentController(
        store: store,
      );
      final _CapturingConsentTransport transport = _CapturingConsentTransport();

      expect(
        controller.statusOf(core.ConsentPurpose.analytics),
        core.ConsentStatus.unknown,
        reason: 'precondition: this is the state every install was stuck in',
      );

      final core.ConsentArtifact artifact = await applyConsentDecision(
        controller: controller,
        transport: transport,
        appId: 'subly',
        anonId: 'install-abc',
        granted: true,
        platform: 'web',
        now: DateTime.utc(2026, 7, 26),
      );

      expect(
        controller.statusOf(core.ConsentPurpose.analytics),
        core.ConsentStatus.granted,
      );
      expect(transport.sent, hasLength(1));
      expect(transport.lastAppId, 'subly');
      expect(artifact.anonId, 'install-abc');
      expect(artifact.granted, isTrue);
    });

    test('the artifact records WHICH policy the user was shown', () async {
      final _CapturingConsentTransport transport = _CapturingConsentTransport();
      final core.ConsentArtifact artifact = await applyConsentDecision(
        controller: core.ConsentController(store: _MemStore()),
        transport: transport,
        appId: 'subly',
        anonId: 'install-abc',
        granted: true,
        platform: 'web',
        now: DateTime.utc(2026, 7, 26),
      );
      // Without this the record proves a button was tapped, not what was agreed
      // to — and `assert-seams-wired.mjs` pins this constant to privacy.html.
      expect(artifact.policyVersion, kPrivacyPolicyVersion);
      expect(artifact.policyVersion, isNotEmpty);
    });

    test('a granted decision SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      await applyConsentDecision(
        controller: core.ConsentController(store: store),
        transport: _CapturingConsentTransport(),
        appId: 'subly',
        anonId: 'install-abc',
        granted: true,
        platform: 'web',
        now: DateTime.utc(2026, 7, 26),
      );

      // A fresh controller over the same store == the next app launch.
      final core.ConsentController reborn = core.ConsentController(
        store: store,
      );
      expect(
        await reborn.hydrate(core.ConsentPurpose.analytics),
        core.ConsentStatus.granted,
        reason: 'if this fails the prompt reappears at every launch',
      );
    });

    test('withdrawing shuts the rail again, as a NEW artifact', () async {
      final _MemStore store = _MemStore();
      final core.ConsentController controller = core.ConsentController(
        store: store,
      );
      final _CapturingConsentTransport transport = _CapturingConsentTransport();

      final core.ConsentArtifact granted = await applyConsentDecision(
        controller: controller,
        transport: transport,
        appId: 'subly',
        anonId: 'install-abc',
        granted: true,
        platform: 'web',
        now: DateTime.utc(2026, 7, 26),
      );
      final core.ConsentArtifact withdrawn = await applyConsentDecision(
        controller: controller,
        transport: transport,
        appId: 'subly',
        anonId: 'install-abc',
        granted: false,
        platform: 'web',
        now: DateTime.utc(2026, 7, 27),
      );

      expect(
        controller.statusOf(core.ConsentPurpose.analytics),
        core.ConsentStatus.denied,
        reason: 'the settings toggle must genuinely stop collection',
      );
      // Append-only: the audit trail is two rows, not one edited row. Both were
      // uploaded, so the server record matches what the device believes.
      expect(withdrawn.consentId, isNot(granted.consentId));
      expect(transport.sent.map((core.ConsentArtifact a) => a.granted), <bool>[
        true,
        false,
      ]);
    });

    test(
      'consent is per purpose — allowing analytics does not allow sync backup',
      () async {
        final core.ConsentController controller = core.ConsentController(
          store: _MemStore(),
        );
        await applyConsentDecision(
          controller: controller,
          transport: _CapturingConsentTransport(),
          appId: 'subly',
          anonId: 'install-abc',
          granted: true,
          platform: 'web',
          now: DateTime.utc(2026, 7, 26),
        );
        expect(
          controller.statusOf(core.ConsentPurpose.syncBackup),
          core.ConsentStatus.unknown,
        );
      },
    );
  });
}
