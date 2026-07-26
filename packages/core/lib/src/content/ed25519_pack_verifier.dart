import 'dart:convert';

import 'package:cryptography/cryptography.dart';

import 'pack_verifier.dart';

/// The real Ed25519 [PackVerifier] (ADR 007 + ADR 016).
///
/// [pipeline C-6] WHY THIS FILE EXISTS. Until it did, the only implementation of
/// [PackVerifier] in the entire repo was [RejectingPackVerifier], which returns
/// false unconditionally — so no content pack could ever load, on any platform,
/// ever. The seam, the two-tier loader, the `key_id` rotation design and the
/// manifest format were all built, tested and documented around a capability that
/// had no working implementation. Nothing reported a problem, because refusing
/// every pack is precisely what a correct verifier does when it has no key.
///
/// ADR 007 originally kept signing dependencies out of `core` and left the impl
/// to "the app layer". No app layer ever supplied one. **Amended 2026-07-26 by
/// owner decision:** the impl lives here. `package:cryptography` is pure Dart
/// (Apache-2.0, verified publisher `dint.dev`) and reaches `dart:ffi` only from
/// argon2, behind an `if (dart.library.ffi)` conditional import — so the web
/// build, which is the only platform Subly currently ships, is unaffected.
///
/// FAIL-CLOSED, and that is load-bearing rather than defensive: every failure
/// path returns false and none throws. A verifier that threw would surface as a
/// crash on untrusted input, and an exception escaping here would bypass the
/// loader's own `Result` handling.
class Ed25519PackVerifier implements PackVerifier {
  /// [pinnedKeys] defaults to the build's pinned map. Injectable ONLY so a test
  /// can prove the open path with a throwaway keypair — production must not
  /// override it, and the owner's real signing key is never in this repo
  /// (`OWNER_QUEUE` S-3).
  Ed25519PackVerifier({Map<String, String>? pinnedKeys, Ed25519? algorithm})
      : _keys = pinnedKeys ?? kContentPackPublicKeys,
        _ed = algorithm ?? Ed25519();

  final Map<String, String> _keys;
  final Ed25519 _ed;

  @override
  Future<bool> verify({
    required String keyId,
    required List<int> message,
    required List<int> signature,
  }) async {
    try {
      // An unknown or unpinned key_id is a rejection, NEVER a skipped check
      // (ADR 016). The loader also enforces this before calling us; both layers
      // do it so a future lax verifier cannot reopen the hole on its own.
      final String? encoded = _keys[keyId];
      if (encoded == null || encoded.isEmpty) return false;

      // No explicit length checks on the key or signature, and that is a
      // deliberate removal rather than an omission. They were here; mutation
      // testing proved them DEAD — deleting both changed no test outcome, while
      // making the catch below rethrow turned the suite red on its own. The
      // catch is what delivers the fail-closed contract for a truncated key, a
      // wrong-size signature or malformed base64. Per CLAUDE.md, an assertion
      // that cannot fail is worse than none, so the redundant pair is gone and
      // the proven mechanism is kept.
      return await _ed.verify(
        message,
        signature: Signature(
          signature,
          publicKey: SimplePublicKey(
            base64Decode(encoded),
            type: KeyPairType.ed25519,
          ),
        ),
      );
    } catch (_) {
      // Malformed base64, a truncated key, a corrupt signature — all mean
      // "reject", and none may escape as an exception.
      return false;
    }
  }
}
