/// The pinned Ed25519 public keys used to verify every remote content pack's
/// signature, keyed by the manifest's `key_id` (ADR 007 + ADR 016). SINGLE
/// SOURCE OF TRUTH — the app-layer [PackVerifier] impl selects its key from here.
///
/// **Why a map and not one constant (ADR 016):** the pinned key is baked into
/// every released binary on all 6 platforms. With a single key and no rotation
/// field, a *compromised* key can never be revoked — every installed app would
/// be stuck trusting it until a synchronised store update, and users who never
/// update are permanently stranded. Cold-storage backup covers key *loss*;
/// only `key_id` covers *compromise*. The field must exist BEFORE the first pack
/// ships, because older binaries can't be taught to read it afterwards.
///
/// PLACEHOLDER until the owner generates the pack-signing keypair (OWNER_QUEUE
/// S-3): the private key goes to `.claude/` (never git), the public key is pinned
/// here as `{'k1': '<base64 of the raw 32-byte key>'}`. While this map is empty a
/// correct [PackVerifier] MUST reject remote packs (only the trusted bundled base
/// loads), so no unsigned CDN content is ever accepted. Losing the private key =
/// no pack signed with that `key_id` can ever be updated again — back it up with
/// a restore drill before the first signed pack ships.
///
/// Rotation: ADD the new entry, keep the old one until no shipped binary needs
/// it, and sign new packs with the new `key_id`. Never reuse a retired `key_id`.
const Map<String, String> kContentPackPublicKeys = <String, String>{};

/// The pinned public key for [keyId] (base64 of the raw 32-byte Ed25519 key), or
/// null when that `key_id` is not pinned in this build. A null result MUST be
/// treated as "reject the pack" — never as "skip verification" (ADR 016).
String? contentPackPublicKeyFor(String keyId) => kContentPackPublicKeys[keyId];

/// Whether at least one real pack-signing key has been pinned. False until S-3
/// lands, and while false every remote pack fails closed.
bool get isContentPackKeyConfigured => kContentPackPublicKeys.isNotEmpty;

/// Seam for Ed25519 signature verification of a content pack manifest. The
/// concrete impl (e.g. `package:cryptography` or `package:ed25519_edwards`) is
/// injected from the app layer so `core` stays pure Dart (ADR 007).
abstract interface class PackVerifier {
  /// Whether [signature] is a valid Ed25519 signature over [message] for the
  /// key pinned under [keyId] in [kContentPackPublicKeys]. MUST return false
  /// (never throw) when [keyId] is unknown/unconfigured or the signature/inputs
  /// are malformed — the fail-closed posture of ADR 007.
  Future<bool> verify({
    required String keyId,
    required List<int> message,
    required List<int> signature,
  });
}

/// A [PackVerifier] that rejects everything — the safe default before a real
/// Ed25519 impl + pinned keys exist (OWNER_QUEUE S-3). With this verifier only a
/// trusted bundled base pack loads; every remote pack is refused.
class RejectingPackVerifier implements PackVerifier {
  const RejectingPackVerifier();

  @override
  Future<bool> verify({
    required String keyId,
    required List<int> message,
    required List<int> signature,
  }) async =>
      false;
}
