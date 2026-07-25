import 'dart:convert';

import 'package:crypto/crypto.dart';

import '../result.dart';
import 'content_pack.dart';
import 'content_pack_source.dart';
import 'pack_verifier.dart';

/// Loads a verified content pack (ADR 007): a remote pack is Ed25519-signature-
/// AND content-hash-verified before use; on any failure the loader falls back to
/// the trusted bundled base pack, then to offline ([Err]). The public keys are
/// pinned in `core` by `key_id` (ADR 016); Ed25519 verification is injected via
/// a [PackVerifier], so `core` needs no crypto-signing dependency (only sha256
/// for the hash check).
class ContentPackLoader {
  const ContentPackLoader({
    PackVerifier verifier = const RejectingPackVerifier(),
    Map<String, String> pinnedKeys = kContentPackPublicKeys,
  })  : _verifier = verifier,
        _pinnedKeys = pinnedKeys;

  final PackVerifier _verifier;

  /// The `key_id → public key` map this loader trusts (ADR 016). Defaults to
  /// the pinned [kContentPackPublicKeys]; overridable ONLY so tests can pin a
  /// throwaway key. Same trust model as the injected [PackVerifier] — an app
  /// layer must never narrow or widen it.
  final Map<String, String> _pinnedKeys;

  /// Two-tier load: the verified [remote] pack if available and valid, otherwise
  /// the trusted [bundled] base pack, otherwise [Err] (offline, no bundled base).
  Future<Result<ContentPack>> load({
    ContentPackSource? remote,
    ContentPackSource? bundled,
  }) async {
    if (remote != null) {
      final Result<ContentPack> r =
          await loadFrom(remote, requireSignature: true);
      if (r.isOk) return r;
    }
    if (bundled != null) {
      final Result<ContentPack> b =
          await loadFrom(bundled, requireSignature: false);
      if (b.isOk) return b;
    }
    return const Result<ContentPack>.err(
        Failure('content pack: none available (offline, no bundled base)'));
  }

  /// Read and verify a pack from a single [source].
  ///
  /// [requireSignature] encodes the source's TRUST. Pass `true` for an untrusted
  /// remote/CDN source — a valid `manifest.sig` over `manifest.json` bytes AND a
  /// non-empty, matching content hash are then both mandatory. Pass `false` ONLY
  /// for a trusted bundled base pack shipped inside the app binary; NEVER for a
  /// remote source, as it skips signature verification entirely. Prefer [load],
  /// which sets this correctly per tier.
  Future<Result<ContentPack>> loadFrom(
    ContentPackSource source, {
    required bool requireSignature,
  }) async {
    final List<int>? manifestBytes = await source.read('manifest.json');
    if (manifestBytes == null) {
      return const Result<ContentPack>.err(
          Failure('content pack: missing manifest.json'));
    }
    final ContentPackManifest manifest;
    try {
      manifest = ContentPackManifest.fromJson(_decodeMap(manifestBytes));
    } catch (e) {
      return Result<ContentPack>.err(
          Failure('content pack: malformed manifest.json', cause: e));
    }

    if (requireSignature) {
      // ADR 016: an untrusted pack must name the key that signed it, and that
      // key must be pinned in THIS build. Both checks happen here, before the
      // injected verifier runs, so the fail-closed posture holds even if an app
      // layer ever supplies a lax PackVerifier.
      if (manifest.keyId.isEmpty) {
        return const Result<ContentPack>.err(
            Failure('content pack: remote manifest missing key_id'));
      }
      if (_pinnedKeys[manifest.keyId] == null) {
        return Result<ContentPack>.err(
            Failure('content pack: unknown key_id "${manifest.keyId}"'));
      }
      final List<int>? sig = await source.read('manifest.sig');
      if (sig == null) {
        return const Result<ContentPack>.err(
            Failure('content pack: missing manifest.sig'));
      }
      final bool ok = await _verifier.verify(
        keyId: manifest.keyId,
        message: manifestBytes,
        signature: sig,
      );
      if (!ok) {
        return const Result<ContentPack>.err(
            Failure('content pack: signature verification failed'));
      }
    }

    final List<int>? contentBytes = await source.read('content.json');
    if (contentBytes == null) {
      return const Result<ContentPack>.err(
          Failure('content pack: missing content.json'));
    }
    // Content integrity. A remote (untrusted) pack MUST declare a content hash:
    // ADR 007 requires BOTH a valid signature AND a matching hash, so a
    // signed-but-hashless manifest must never leave content.json unverified. A
    // trusted bundled pack (shipped in the app binary) may omit it.
    if (requireSignature && manifest.contentHash.isEmpty) {
      return const Result<ContentPack>.err(
          Failure('content pack: remote manifest missing content_hash'));
    }
    if (manifest.contentHash.isNotEmpty) {
      final String digest = sha256.convert(contentBytes).toString();
      if (digest != manifest.contentHash.toLowerCase()) {
        return const Result<ContentPack>.err(
            Failure('content pack: content hash mismatch'));
      }
    }
    final Map<String, Object?> content;
    try {
      content = _decodeMap(contentBytes);
    } catch (e) {
      return Result<ContentPack>.err(
          Failure('content pack: malformed content.json', cause: e));
    }
    return Result<ContentPack>.ok(
        ContentPack(manifest: manifest, content: content));
  }

  static Map<String, Object?> _decodeMap(List<int> bytes) {
    final Object? decoded = jsonDecode(utf8.decode(bytes));
    if (decoded is Map) return decoded.cast<String, Object?>();
    throw const FormatException('expected a JSON object');
  }
}
