import '../result.dart';
import 'consent.dart';

/// How a recorded [ConsentArtifact] reaches the server, as a seam.
///
/// Mirrors [EventTransport] deliberately: the concrete HTTP client lives in the
/// app/adapter layer so `core` stays pure Dart (ADR 005), and a test supplies a
/// fake without a network.
///
/// WHY this exists at all: [ConsentController.record] returns the artifact so
/// the caller can ship it, and until this seam existed there was nothing to ship
/// it with — the artifact was persisted locally and the append-only
/// `consent_artifacts` table on the server stayed empty. A consent record that
/// exists only on the user's own device cannot demonstrate anything, which is
/// the entire reason DPDP §6(3) wants the artifact.
abstract interface class ConsentTransport {
  /// Send one artifact. Best-effort by contract: a failure must never block the
  /// user's choice, which has already taken effect locally.
  Future<Result<void>> send({
    required String appId,
    required ConsentArtifact artifact,
  });
}

/// The default: accepts and drops. Used in demo builds, widget tests, and any
/// app with no backend configured.
///
/// Named for what it does. A class called `ConsentTransport()` that silently
/// discarded would be the same trap this requirement exists to close.
class DiscardingConsentTransport implements ConsentTransport {
  const DiscardingConsentTransport();

  @override
  Future<Result<void>> send({
    required String appId,
    required ConsentArtifact artifact,
  }) async =>
      const Result<void>.ok(null);
}
