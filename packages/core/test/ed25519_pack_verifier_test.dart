import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// [pipeline C-6] THE OPEN-PATH TEST for content packs.
///
/// Every pre-existing pack test used a FAKE verifier, so the suite proved the
/// loader's plumbing and never once proved a genuine Ed25519 signature could be
/// checked. The only real implementation in the repo was [RejectingPackVerifier],
/// which refuses everything — so no pack could load, on any platform, ever, and
/// the tests stayed green because refusing is correct behaviour with no key.
///
/// These tests use a REAL generated keypair and a REAL signature over the real
/// manifest bytes, through the real loader. If the verifier stops working, they
/// go red.
List<int> _b(String s) => utf8.encode(s);
String _sha(List<int> bytes) => sha256.convert(bytes).toString();

/// A throwaway keypair minted per run. Deliberately NOT the owner's production
/// signing key, which does not exist yet and is owner-gated (`OWNER_QUEUE` S-3).
class _TestKey {
  _TestKey(this.keyId, this.publicKeyBase64, this._keyPair);
  final String keyId;
  final String publicKeyBase64;
  final SimpleKeyPair _keyPair;

  static Future<_TestKey> generate({String keyId = 'testk1'}) async {
    final SimpleKeyPair pair = await Ed25519().newKeyPair();
    final SimplePublicKey pub = await pair.extractPublicKey();
    return _TestKey(keyId, base64Encode(pub.bytes), pair);
  }

  Future<List<int>> sign(List<int> message) async {
    final Signature s = await Ed25519().sign(message, keyPair: _keyPair);
    return s.bytes;
  }

  Map<String, String> get pinned => <String, String>{keyId: publicKeyBase64};
}

/// A genuinely signed pack. [tamperManifest] flips a byte AFTER signing, which is
/// the attack the signature exists to stop.
Future<InMemoryContentPackSource> _signedPack(
  _TestKey key, {
  bool tamperManifest = false,
  bool tamperContent = false,
}) async {
  final List<int> content = _b('{"en":{"hello":"Hi"}}');
  final List<int> manifest = _b(jsonEncode(<String, Object?>{
    'pack_id': 'lingo',
    'version': '1.2.0',
    'key_id': key.keyId,
    'content_hash': _sha(content),
    'locales': <String>['en'],
    'generators': <String>['gemini-x'],
  }));
  final List<int> sig = await key.sign(manifest);

  List<int> shipped = manifest;
  if (tamperManifest) {
    // Change the declared version, leaving the signature untouched.
    shipped = _b(jsonEncode(<String, Object?>{
      'pack_id': 'lingo',
      'version': '9.9.9',
      'key_id': key.keyId,
      'content_hash': _sha(content),
      'locales': <String>['en'],
      'generators': <String>['gemini-x'],
    }));
  }

  return InMemoryContentPackSource(<String, List<int>>{
    'manifest.json': shipped,
    'content.json': tamperContent ? _b('{"en":{"hello":"HACKED"}}') : content,
    'manifest.sig': sig,
  });
}

void main() {
  group('[C-6] Ed25519PackVerifier — a real signature verifies', () {
    test('a genuine signature over the real bytes is ACCEPTED', () async {
      final _TestKey key = await _TestKey.generate();
      final List<int> message = _b('the manifest bytes');
      final List<int> sig = await key.sign(message);

      final Ed25519PackVerifier verifier =
          Ed25519PackVerifier(pinnedKeys: key.pinned);
      expect(
        await verifier.verify(
            keyId: key.keyId, message: message, signature: sig),
        isTrue,
        reason: 'if this fails no content pack can ever load',
      );
    });

    test('a tampered message is REJECTED', () async {
      final _TestKey key = await _TestKey.generate();
      final List<int> sig = await key.sign(_b('the manifest bytes'));
      final Ed25519PackVerifier verifier =
          Ed25519PackVerifier(pinnedKeys: key.pinned);
      expect(
        await verifier.verify(
            keyId: key.keyId,
            message: _b('the manifest byteS'),
            signature: sig),
        isFalse,
      );
    });

    test('a signature from a DIFFERENT key is REJECTED', () async {
      final _TestKey real = await _TestKey.generate();
      final _TestKey attacker = await _TestKey.generate(keyId: 'testk1');
      final List<int> message = _b('the manifest bytes');
      final List<int> forged = await attacker.sign(message);

      // Pin the real key, present the attacker's signature under the same id.
      final Ed25519PackVerifier verifier =
          Ed25519PackVerifier(pinnedKeys: real.pinned);
      expect(
        await verifier.verify(
            keyId: real.keyId, message: message, signature: forged),
        isFalse,
      );
    });

    test('an unpinned key_id is REJECTED, never skipped (ADR 016)', () async {
      final _TestKey key = await _TestKey.generate();
      final List<int> message = _b('the manifest bytes');
      final List<int> sig = await key.sign(message);
      final Ed25519PackVerifier verifier =
          Ed25519PackVerifier(pinnedKeys: key.pinned);
      expect(
        await verifier.verify(
            keyId: 'not-pinned', message: message, signature: sig),
        isFalse,
      );
    });

    test('the production default pins nothing, so it rejects', () async {
      // kContentPackPublicKeys is empty until OWNER_QUEUE S-3. The verifier must
      // fail closed on the real map, not fall back to accepting.
      final Ed25519PackVerifier verifier = Ed25519PackVerifier();
      expect(isContentPackKeyConfigured, isFalse);
      expect(
        await verifier.verify(
            keyId: 'k1', message: _b('x'), signature: List<int>.filled(64, 0)),
        isFalse,
      );
    });

    test('malformed inputs return false and never THROW', () async {
      final _TestKey key = await _TestKey.generate();
      final List<int> message = _b('the manifest bytes');
      final List<int> sig = await key.sign(message);

      // A verifier that threw would surface as a crash on untrusted input.
      expect(
        await Ed25519PackVerifier(
                pinnedKeys: <String, String>{'k1': 'not!valid!base64!'})
            .verify(keyId: 'k1', message: message, signature: sig),
        isFalse,
      );
      expect(
        await Ed25519PackVerifier(pinnedKeys: <String, String>{
          'k1': base64Encode(<int>[1, 2, 3])
        }).verify(keyId: 'k1', message: message, signature: sig),
        isFalse,
        reason: 'a 3-byte key is not a 32-byte Ed25519 key',
      );
      expect(
        await Ed25519PackVerifier(pinnedKeys: key.pinned).verify(
            keyId: key.keyId, message: message, signature: <int>[1, 2, 3]),
        isFalse,
        reason: 'a 3-byte signature is not a 64-byte Ed25519 signature',
      );
      expect(
        await Ed25519PackVerifier(pinnedKeys: <String, String>{'k1': ''})
            .verify(keyId: 'k1', message: message, signature: sig),
        isFalse,
      );
    });
  });

  group('[C-6] end to end — a signed pack actually LOADS', () {
    test('a genuinely signed remote pack loads through the loader', () async {
      final _TestKey key = await _TestKey.generate();
      final ContentPackLoader loader = ContentPackLoader(
        verifier: Ed25519PackVerifier(pinnedKeys: key.pinned),
        pinnedKeys: key.pinned,
      );

      final Result<ContentPack> r =
          await loader.loadFrom(await _signedPack(key), requireSignature: true);

      expect(r.isOk, isTrue,
          reason: 'the whole point: a real pack reaching a real user');
      final ContentPack pack =
          r.fold((ContentPack p) => p, (_) => ContentPack.empty);
      expect(pack.manifest.packId, 'lingo');
      expect(pack.manifest.keyId, key.keyId);
    });

    test('a manifest tampered after signing is REJECTED by the loader',
        () async {
      final _TestKey key = await _TestKey.generate();
      final ContentPackLoader loader = ContentPackLoader(
        verifier: Ed25519PackVerifier(pinnedKeys: key.pinned),
        pinnedKeys: key.pinned,
      );
      final Result<ContentPack> r = await loader.loadFrom(
          await _signedPack(key, tamperManifest: true),
          requireSignature: true);
      expect(r.isOk, isFalse);
    });

    test('tampered CONTENT is rejected by the hash even with a valid signature',
        () async {
      // ADR 007 requires BOTH a valid signature AND a matching hash. The
      // signature covers the manifest; only the hash covers content.json.
      final _TestKey key = await _TestKey.generate();
      final ContentPackLoader loader = ContentPackLoader(
        verifier: Ed25519PackVerifier(pinnedKeys: key.pinned),
        pinnedKeys: key.pinned,
      );
      final Result<ContentPack> r = await loader.loadFrom(
          await _signedPack(key, tamperContent: true),
          requireSignature: true);
      expect(r.isOk, isFalse);
    });
  });
}
