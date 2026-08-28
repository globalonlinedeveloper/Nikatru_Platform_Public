import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A [PackVerifier] whose result is fixed — stands in for the app-layer Ed25519
/// impl so the loader's verify→hash→fallback logic is testable without a key.
class _FakeVerifier implements PackVerifier {
  const _FakeVerifier(this.result);
  final bool result;
  @override
  Future<bool> verify({
    required String keyId,
    required List<int> message,
    required List<int> signature,
  }) async =>
      result;
}

/// A verifier that records the `key_id` it was asked to verify under, proving
/// the loader routes key selection to the impl (ADR 016).
class _KeyCapturingVerifier implements PackVerifier {
  String? seenKeyId;
  @override
  Future<bool> verify({
    required String keyId,
    required List<int> message,
    required List<int> signature,
  }) async {
    seenKeyId = keyId;
    return true;
  }
}

List<int> _b(String s) => utf8.encode(s);
String _sha(List<int> bytes) => sha256.convert(bytes).toString();

/// The throwaway pinned-key map used by the remote-path tests. Production pins
/// the real key in `kContentPackPublicKeys`, and has since 2026-07-27.
///
/// 📌 CORRECTED 2026-08-25. The second sentence read: "Production pins the real
/// keys in `kContentPackPublicKeys`, which is empty until S-3." MEASURED TODAY:
/// `grep -rn -A2 "kContentPackPublicKeys =" packages/core` resolves to
/// `packages/core/lib/src/content/pack_verifier.dart:30-32`, and the map there
/// holds `'k1': 'zcrBolFZjWixE+0UF0Qbd6T2jUKGkWgAWtJVmYdK6dQ='` — a real pinned
/// key, not an empty map. This is the SECOND home of one stale sentence:
/// `pack_verifier.dart:136` corrected its own copy on 2026-08-21 ("False until
/// S-3 lands …"), the correction landed in the source and this test file was
/// missed. Nothing about the fixtures below changes; only this sentence was wrong.
///
/// 🔴 THE MAP BELOW IS A THROWAWAY AND ITS VALUE MUST NOT BE "FIXED" TO MATCH
/// PRODUCTION. `content_pack_fixture_test.dart:33` rests on production pinning
/// `k1` and NOT `test-k1`, so that the production loader REJECTS the pipeline's
/// derived test pack. DIRECTION RE-PROVED 2026-08-25 rather than cited: deleting
/// the `k1` entry from `kContentPackPublicKeys` in a detached scratch worktree
/// (never this checkout) takes `dart test` in packages/core from 307 pass / 0 fail
/// to 305 pass / 2 fail, and one of the two is in THIS file — "pinned keys +
/// rejecting verifier the production key is pinned, and only the pinned id
/// resolves". The pin is load-bearing, not decorative, and the sentence corrected
/// above was the only thing here that was wrong.
const Map<String, String> _testKeys = <String, String>{'k1': 'dGVzdC1rZXk='};

/// The identity every fixture below declares unless a test asks for another —
/// named so a test that means "a DIFFERENT pack" says so out loud.
const String _kPackId = 'lingo';
const String _kVersion = '1.2.0';

/// A well-formed pack source with a matching content hash. [tamperContent]
/// corrupts content.json AFTER the manifest hash is computed (hash mismatch);
/// omit [includeSig] to drop the signature entry; [keyId] sets/clears the
/// manifest's ADR-016 signing-key id; [packId] / [version] set the manifest's
/// declared identity, which is what the loader binds against.
InMemoryContentPackSource _pack({
  bool tamperContent = false,
  bool includeSig = true,
  String? keyId = 'k1',
  String packId = _kPackId,
  String version = _kVersion,
}) {
  final List<int> content = _b('{"en":{"hello":"Hi"},"fr":{"hello":"Salut"}}');
  final List<int> manifest = _b(jsonEncode(<String, Object?>{
    'pack_id': packId,
    'version': version,
    if (keyId != null) 'key_id': keyId,
    'content_hash': _sha(content),
    'locales': <String>['en', 'fr'],
    'generators': <String>['gemini-x'],
  }));
  return InMemoryContentPackSource(<String, List<int>>{
    'manifest.json': manifest,
    'content.json': tamperContent ? _b('{"en":{"hello":"HACKED"}}') : content,
    if (includeSig) 'manifest.sig': _b('signature-bytes'),
  });
}

/// A signed source whose manifest declares NO content_hash — used to prove the
/// remote path fails closed rather than accepting unverified content.
InMemoryContentPackSource _hashlessPack() {
  final List<int> content = _b('{"en":{"hello":"Hi"}}');
  final List<int> manifest = _b(jsonEncode(<String, Object?>{
    'pack_id': 'lingo',
    'version': '1.0.0', // no content_hash
    'key_id': 'k1',
  }));
  return InMemoryContentPackSource(<String, List<int>>{
    'manifest.json': manifest,
    'content.json': content,
    'manifest.sig': _b('signature-bytes'),
  });
}

void main() {
  group('ContentPackManifest JSON', () {
    test('parses and round-trips', () {
      const ContentPackManifest m = ContentPackManifest(
        packId: 'lingo',
        version: '1.2.0',
        contentHash: 'abc',
        assets: <ContentAsset>[ContentAsset(path: 'a.png', sha256: 'deadbeef')],
        generators: <String>['gemini-x'],
        locales: <String>['en'],
      );
      final ContentPackManifest back = ContentPackManifest.fromJson(m.toJson());
      expect(back.packId, 'lingo');
      expect(back.version, '1.2.0');
      expect(back.contentHash, 'abc');
      expect(back.assets.single.path, 'a.png');
      expect(back.generators, <String>['gemini-x']);
      expect(back.locales, <String>['en']);
    });

    test('missing pack_id or version throws FormatException', () {
      expect(
          () => ContentPackManifest.fromJson(
              <String, Object?>{'version': '1.0.0'}),
          throwsFormatException);
      expect(
          () => ContentPackManifest.fromJson(<String, Object?>{'pack_id': 'x'}),
          throwsFormatException);
    });
  });

  group('ContentPackLoader.loadFrom (single source)', () {
    test('trusted bundled pack loads without a signature (hash enforced)',
        () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r =
          await loader.loadFrom(_pack(), requireSignature: false);
      expect(r.isOk, isTrue);
      final ContentPack p =
          r.fold((ContentPack p) => p, (_) => ContentPack.empty);
      expect(p.manifest.packId, 'lingo');
      expect(p.text('hello', locale: 'fr'), 'Salut');
      expect(p.text('hello'), 'Hi'); // default en
      expect(p.text('missing'), 'missing'); // key fallback
    });

    test('content hash mismatch is rejected', () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r = await loader
          .loadFrom(_pack(tamperContent: true), requireSignature: false);
      expect(r.isOk, isFalse);
    });

    test('remote pack with no content_hash is rejected (fail-closed)',
        () async {
      // A validly-signed but hash-less manifest must NOT leave content.json
      // unverified on the untrusted remote path (ADR 007: sig AND hash).
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(_hashlessPack(),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isFalse);
    });

    test('trusted bundled pack may omit the content hash', () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r =
          await loader.loadFrom(_hashlessPack(), requireSignature: false);
      expect(r.isOk, isTrue);
    });

    test('remote pack requires a signature — missing sig rejected', () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(
          _pack(includeSig: false),
          requireSignature: true,
          expectPackId: _kPackId);
      expect(r.isOk, isFalse);
    });

    test('remote pack with an invalid signature is rejected', () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(false), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(_pack(),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isFalse);
    });

    test('remote pack with a valid signature + matching hash loads', () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(_pack(),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isTrue);
    });

    test('missing manifest is rejected', () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r = await loader.loadFrom(
          const InMemoryContentPackSource(<String, List<int>>{}),
          requireSignature: false);
      expect(r.isOk, isFalse);
    });

    test('malformed manifest JSON is rejected (not a crash)', () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r = await loader.loadFrom(
        const InMemoryContentPackSource(<String, List<int>>{
          'manifest.json': <int>[123, 34, 111]
        }),
        requireSignature: false,
      );
      expect(r.isOk, isFalse);
    });
  });

  group('ContentPackLoader.load (two-tier policy)', () {
    test('returns the verified remote pack when valid', () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.load(
          remote: _pack(), bundled: _pack(), expectPackId: _kPackId);
      expect(r.isOk, isTrue);
    });

    test('falls back to the bundled base when the remote fails verification',
        () async {
      // Default loader: no pinned keys AND a RejectingPackVerifier => the
      // remote pack never validates, so the trusted bundled base loads instead.
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r = await loader.load(
          remote: _pack(), bundled: _pack(), expectPackId: _kPackId);
      expect(r.isOk, isTrue);
      final ContentPack p =
          r.fold((ContentPack p) => p, (_) => ContentPack.empty);
      expect(p.manifest.packId, 'lingo');
    });

    test('errs when neither a valid remote nor a bundled pack is available',
        () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r =
          await loader.load(remote: _pack(), expectPackId: _kPackId);
      expect(r.isOk, isFalse); // remote rejected, no bundled base
    });
  });

  // ── ADR 016: key_id rotation. These lock the format BEFORE the first pack
  //    ships — after that, released binaries can't be taught the field. ──
  group('ADR 016 key_id', () {
    test('a remote manifest with NO key_id is rejected', () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(_pack(keyId: null),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isFalse);
    });

    test('a remote manifest naming an UNPINNED key_id is rejected', () async {
      // Fail-closed even with a permissive verifier: the loader refuses before
      // verification, so a rotated-out (or attacker-chosen) key can't be used.
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(_pack(keyId: 'k99'),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isFalse);
    });

    test('the manifest key_id is handed to the verifier for key selection',
        () async {
      final _KeyCapturingVerifier v = _KeyCapturingVerifier();
      final ContentPackLoader loader =
          ContentPackLoader(verifier: v, pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.loadFrom(_pack(),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isTrue);
      expect(v.seenKeyId, 'k1');
    });

    test('a trusted BUNDLED pack may omit key_id (never signature-checked)',
        () async {
      const ContentPackLoader loader = ContentPackLoader();
      final Result<ContentPack> r =
          await loader.loadFrom(_pack(keyId: null), requireSignature: false);
      expect(r.isOk, isTrue);
    });

    test('key_id survives the manifest JSON round-trip', () {
      const ContentPackManifest m = ContentPackManifest(
          packId: 'lingo', version: '1.0.0', contentHash: 'abc', keyId: 'k2');
      expect(m.toJson()['key_id'], 'k2');
      expect(ContentPackManifest.fromJson(m.toJson()).keyId, 'k2');
      // Absent / wrong-typed key_id parses to '' rather than throwing — the
      // LOADER decides whether that is fatal (remote) or fine (bundled).
      expect(
          ContentPackManifest.fromJson(<String, Object?>{
            'pack_id': 'x',
            'version': '1.0.0',
            'key_id': 7,
          }).keyId,
          isEmpty);
    });
  });

  group('pinned keys + rejecting verifier', () {
    // INVERTED 2026-07-27 when S-3 landed. This asserted the PRE-key state
    // ("nothing is pinned yet"), which was correct then and is wrong now. It is
    // rewritten rather than deleted, because the invariant it guards still
    // matters -- it just points the other way: a key IS pinned, it is the right
    // shape, and an id nobody pinned still resolves to null. [ADR 022]
    test('the production key is pinned, and only the pinned id resolves', () {
      expect(isContentPackKeyConfigured, isTrue);
      expect(kContentPackPublicKeys, contains('k1'));

      // Base64 of a RAW 32-byte Ed25519 key. Asserting the DECODED length is the
      // point: a key pasted in the wrong encoding (PEM, DER, hex) would still be
      // a non-empty string and would still "look pinned", while failing every
      // real verification later.
      expect(base64.decode(kContentPackPublicKeys['k1']!).length, 32);

      expect(contentPackPublicKeyFor('k1'), isNotNull);
      expect(contentPackPublicKeyFor('k2'), isNull);
    });

    test('an unpinned key_id fails closed against the REAL pinned map',
        () async {
      // Until 2026-07-27 this passed a pack with the DEFAULT key_id ('k1') and
      // relied on kContentPackPublicKeys being empty. Now that S-3 has pinned k1,
      // that pack legitimately loads, so the test was asserting the old world.
      //
      // The invariant it exists to protect is unchanged and still worth having:
      // an id nobody pinned must fail closed EVEN IF the injected verifier says
      // yes. So it now uses an id that is genuinely unpinned. [ADR 022]
      const ContentPackLoader loader =
          ContentPackLoader(verifier: _FakeVerifier(true));
      final Result<ContentPack> r = await loader.loadFrom(_pack(keyId: 'k2'),
          requireSignature: true, expectPackId: _kPackId);
      expect(r.isOk, isFalse);
    });

    test('RejectingPackVerifier refuses everything', () async {
      const PackVerifier v = RejectingPackVerifier();
      expect(
          await v.verify(keyId: 'k1', message: <int>[1], signature: <int>[2]),
          isFalse);
    });
  });

  // ── IDENTITY BINDING (2026-08-01 full-corpus review, #8). ─────────────────
  //
  // 🔴 EVERY TEST ABOVE PASSED WITH NO IDENTITY CHECK AT ALL. They prove the
  // pack is AUTHENTIC — signed by a pinned key, hash intact — and authenticity
  // is a different question from "is this the pack I asked for". The verifier is
  // given `_FakeVerifier(true)` throughout precisely so these say what they mean:
  // a perfectly valid signature is not an answer, so every rejection below is the
  // binding doing the work and nothing else.
  group('ADR 007 identity binding: pack_id + version', () {
    const ContentPackLoader loader =
        ContentPackLoader(verifier: _FakeVerifier(true), pinnedKeys: _testKeys);

    // Same bucket, same signing key, wrong app. Nothing else in the pipeline
    // separates these two packs.
    test('a correctly-signed pack for ANOTHER app is rejected', () async {
      final Result<ContentPack> r = await loader.loadFrom(
        _pack(packId: 'drift'),
        requireSignature: true,
        expectPackId: _kPackId,
      );
      expect(r.isOk, isFalse);
      expect(_why(r), contains('pack_id mismatch'));
    });

    // Last release's pack, still validly signed, replayed by the CDN.
    test('a correctly-signed pack at ANOTHER version is rejected', () async {
      final Result<ContentPack> r = await loader.loadFrom(
        _pack(version: '1.1.0'),
        requireSignature: true,
        expectPackId: _kPackId,
        expectVersion: _kVersion,
      );
      expect(r.isOk, isFalse);
      expect(_why(r), contains('version mismatch'));
    });

    // The fail-closed limb: the same posture key_id and content_hash already
    // have. A caller that names no pack cannot be given one.
    test('a remote load that asks for NO pack_id is refused', () async {
      final Result<ContentPack> r =
          await loader.loadFrom(_pack(), requireSignature: true);
      expect(r.isOk, isFalse);
      expect(_why(r), contains('asked for no pack_id'));

      // Empty is not a request either — and it must be reported as the CALLER's
      // omission, not as a mismatch. Both reject, so `isOk` alone cannot tell
      // them apart, and they are opposite bugs: "we forgot to say which pack we
      // wanted" versus "the CDN served us someone else's". Asserting only
      // `isFalse` here would leave the `isEmpty` limb unprovable — an assertion
      // nobody can fail is worse than none.
      final Result<ContentPack> blank = await loader.loadFrom(_pack(),
          requireSignature: true, expectPackId: '');
      expect(blank.isOk, isFalse);
      expect(_why(blank), contains('asked for no pack_id'));
    });

    // The positive control. Without this the group would pass just as well
    // against a loader that rejected everything.
    test('the requested id AND version load', () async {
      final Result<ContentPack> r = await loader.loadFrom(
        _pack(),
        requireSignature: true,
        expectPackId: _kPackId,
        expectVersion: _kVersion,
      );
      expect(r.isOk, isTrue);
      final ContentPack p =
          r.fold((ContentPack p) => p, (_) => ContentPack.empty);
      expect(p.manifest.packId, _kPackId);
      expect(p.manifest.version, _kVersion);
    });

    // Version is optional BY DESIGN: the pointer may name only the id (ADR 007
    // pointer indirection resolves `latest`). Omitting it must not be read as
    // "reject everything", or the common case never loads.
    test('an unspecified version accepts whatever the pointer resolved to',
        () async {
      final Result<ContentPack> r = await loader.loadFrom(
        _pack(version: '9.9.9'),
        requireSignature: true,
        expectPackId: _kPackId,
      );
      expect(r.isOk, isTrue);
    });

    test('the bundled tier binds the id too — no unchecked trusted path',
        () async {
      const ContentPackLoader bundledOnly = ContentPackLoader();
      final Result<ContentPack> r = await bundledOnly.loadFrom(
        _pack(packId: 'drift'),
        requireSignature: false,
        expectPackId: _kPackId,
      );
      expect(r.isOk, isFalse);
      expect(_why(r), contains('pack_id mismatch'));
    });
  });

  group('ADR 007 identity binding through load() (two-tier)', () {
    test('an id mismatch on BOTH tiers ends in Err, never in the wrong pack',
        () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.load(
        remote: _pack(packId: 'drift'),
        bundled: _pack(packId: 'drift'),
        expectPackId: _kPackId,
      );
      expect(r.isOk, isFalse,
          reason:
              'falling back onto another app\'s base pack is not a fallback');
    });

    // 🔴 VERSION MUST NOT REACH THE BUNDLED TIER. The bundled base is whatever
    // shipped in this binary and is legitimately older than the version the
    // pointer names; binding it there would make every content release fall all
    // the way through to Err the moment the device is offline.
    test(
        'a version asked of the remote tier does NOT disqualify the bundled base',
        () async {
      const ContentPackLoader loader = ContentPackLoader(
          verifier: _FakeVerifier(true), pinnedKeys: _testKeys);
      final Result<ContentPack> r = await loader.load(
        // The remote is unusable (no signature entry), so the bundled base — at
        // an older version — has to carry the load.
        remote: _pack(includeSig: false),
        bundled: _pack(version: '1.0.0'),
        expectPackId: _kPackId,
        expectVersion: '2.0.0',
      );
      expect(r.isOk, isTrue);
      final ContentPack p =
          r.fold((ContentPack p) => p, (_) => ContentPack.empty);
      expect(p.manifest.version, '1.0.0');
    });
  });
}

/// The failure message from an [Err], or '' for an [Ok]. Asserting on the REASON
/// matters here: every one of these rejections would also be produced by a
/// loader that had simply stopped loading anything, and `isOk == false` cannot
/// tell those apart.
String _why(Result<ContentPack> r) =>
    r.fold((ContentPack _) => '', (Failure f) => f.message);
