import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/state/analytics_providers.dart';

/// ⏱ 2026-10-01 · THE DECISION PATH RECORDS WHETHER ITS UPLOAD LANDED.
///
/// The platform Worker refuses analytics from an install whose consent artifact
/// it does not hold, so `core.AnalyticsRecorder` posts the artifact itself
/// before its first flush unless the controller says this one already landed.
/// `applyConsentDecision` is the only place that knows the outcome of the
/// upload it makes; these tests pin that it says so — and ONLY on a success,
/// because an acknowledgement after a failed POST is the lie that would let the
/// recorder send events the server will refuse.
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

class _ConsentTransport implements core.ConsentTransport {
  _ConsentTransport(this.answer);
  final core.Result<void> answer;
  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async => answer;
}

void main() {
  Future<core.ConsentController> decide(core.Result<void> answer) async {
    final core.ConsentController controller = core.ConsentController(
      store: _MemStore(),
    );
    await applyConsentDecision(
      controller: controller,
      transport: _ConsentTransport(answer),
      appId: 'subscriptiontracker',
      anonId: 'install-1',
      granted: true,
      platform: 'web',
      now: DateTime.utc(2026, 10, 1),
    );
    return controller;
  }

  test('a landed upload acknowledges the artifact it sent', () async {
    final core.ConsentController c = await decide(
      const core.Result<void>.ok(null),
    );
    expect(c.isAcknowledged(core.ConsentPurpose.analytics), isTrue);
  });

  test(
    'a FAILED upload leaves it unacknowledged, so the recorder retries it',
    () async {
      final core.ConsentController c = await decide(
        const core.Result<void>.err(core.Failure('offline')),
      );
      expect(
        c.statusOf(core.ConsentPurpose.analytics),
        core.ConsentStatus.granted,
        reason:
            'the decision still applies on-device — best-effort by contract',
      );
      expect(c.isAcknowledged(core.ConsentPurpose.analytics), isFalse);
    },
  );
}
