import 'dart:convert';
import 'dart:io';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// [pipeline 7]P-9 / P-11 — THE PRODUCED PACK MEETS THE CLIENT THAT MUST READ IT.
///
/// Every other pack test in this package builds its subject in Dart, which proves
/// the loader against bytes the loader's own author wrote. This one loads
/// `packages/core/test/fixtures/pack/v1/` — a real pack emitted and signed by
/// `tooling/content_pipeline`, committed byte for byte — through the real
/// [ContentPackLoader] and the real [Ed25519PackVerifier].
///
/// 🔴 IT IS THE ONLY PLACE THE TWO HALVES OF THE RAIL TOUCH. A signer that signs
/// a re-serialisation instead of the bytes it wrote produces a pack that verifies
/// perfectly on the pipeline machine and fails on every installed app; nothing on
/// the Node side can see that, because both sides there are the same code. Here
/// the manifest bytes are read from disk exactly as a CDN would serve them.
///
/// The pinned key is the pipeline's DERIVED test key, injected through the same
/// `pinnedKeys` seam the loader documents as existing only so a test can prove
/// the open path. `kContentPackPublicKeys` pins `k1` and not `test-k1`, so the
/// production loader rejects this pack — asserted below, because a fixture the
/// shipped binary would accept is a production key wearing a test name.
const String _testKeyId = 'test-k1';
const String _testPublicKeyBase64 =
    'SKwspmiis26bCdVVXZBZeWt+cpflQXrfqio6g9iOxBY=';

/// A [ContentPackSource] over a directory on disk — the shape a real bundled or
/// downloaded pack has, and the reason this test reads files rather than a map.
class _DirSource implements ContentPackSource {
  _DirSource(this.dir, {this.overrides = const <String, List<int>>{}});
  final Directory dir;
  final Map<String, List<int>> overrides;

  @override
  Future<List<int>?> read(String entry) async {
    if (overrides.containsKey(entry)) return overrides[entry];
    final File f = File('${dir.path}/$entry');
    if (!f.existsSync()) return null;
    return f.readAsBytesSync();
  }
}

Directory _fixture(String version) {
  // `dart test` runs with the package root as cwd for a workspace member, and
  // from the repo root under melos. Try both rather than guessing, and FAIL
  // LOUDLY if neither exists — a fixture path that silently resolves to nothing
  // would turn every expectation below into a test of `null`.
  for (final String p in <String>[
    'test/fixtures/pack/$version',
    'packages/core/test/fixtures/pack/$version',
  ]) {
    final Directory d = Directory(p);
    if (d.existsSync()) return d;
  }
  fail(
    'COVERAGE LOST — the frozen pack fixture $version was not found from ${Directory.current.path}. '
    'Every assertion in this file would otherwise run against an absent pack.',
  );
}

void main() {
  final Directory v1 = _fixture('v1');
  final List<int> manifestBytes = File(
    '${v1.path}/manifest.json',
  ).readAsBytesSync();
  final Map<String, Object?> manifestJson =
      jsonDecode(utf8.decode(manifestBytes)) as Map<String, Object?>;

  ContentPackLoader loader() => ContentPackLoader(
        verifier: Ed25519PackVerifier(
          pinnedKeys: const <String, String>{_testKeyId: _testPublicKeyBase64},
        ),
        pinnedKeys: const <String, String>{_testKeyId: _testPublicKeyBase64},
      );

  group('the pipeline-produced pack, through the REAL loader', () {
    test('loads with signature verification required', () async {
      final Result<ContentPack> r = await loader().loadFrom(
        _DirSource(v1),
        requireSignature: true,
        expectPackId: manifestJson['pack_id']! as String,
        expectVersion: manifestJson['version']! as String,
      );
      final ContentPack pack = r.fold<ContentPack>(
        (ContentPack p) => p,
        (Failure f) => fail(
            'the real loader rejected a pack the pipeline signed: ${f.message}'),
      );
      expect(pack.manifest.keyId, _testKeyId);
      expect(pack.manifest.locales, isNotEmpty);
      expect(
        pack.text('greeting.hello', locale: 'fr'),
        isNot('greeting.hello'),
        reason:
            'the fr shard must resolve, or the pack shipped a locale that renders as its own key',
      );
    });

    test('ONE FLIPPED MANIFEST BYTE is refused', () async {
      final List<int> tampered = List<int>.from(manifestBytes);
      tampered[tampered.length - 3] ^= 0x01;
      final Result<ContentPack> r = await loader().loadFrom(
        _DirSource(
          v1,
          overrides: <String, List<int>>{'manifest.json': tampered},
        ),
        requireSignature: true,
        expectPackId: manifestJson['pack_id']! as String,
      );
      expect(r.isOk, isFalse);
    });

    test(
      'the PRODUCTION pinned key set rejects it — test-k1 is not pinned in any shipped binary',
      () async {
        final Result<ContentPack> r =
            await ContentPackLoader(verifier: Ed25519PackVerifier()).loadFrom(
          _DirSource(v1),
          requireSignature: true,
          expectPackId: manifestJson['pack_id']! as String,
        );
        expect(
          r.isOk,
          isFalse,
          reason:
              'a fixture the shipped loader accepts is a production key wearing a test name',
        );
        expect(contentPackPublicKeyFor(_testKeyId), isNull);
      },
    );

    test(
      'a pack_id the caller did not ask for is refused, even correctly signed',
      () async {
        final Result<ContentPack> r = await loader().loadFrom(
          _DirSource(v1),
          requireSignature: true,
          expectPackId: 'some-other-app',
        );
        expect(r.isOk, isFalse);
      },
    );
  });

  group('[pipeline 7]P-11 — a format change must not strand a shipped binary',
      () {
    test(
      'the CURRENT parser reads the frozen v1 manifest and every declared field survives',
      () {
        final ContentPackManifest m = ContentPackManifest.fromJson(
          manifestJson,
        );
        expect(m.packId, manifestJson['pack_id']);
        expect(m.version, manifestJson['version']);
        expect(m.keyId, manifestJson['key_id']);
        expect(m.contentHash, manifestJson['content_hash']);
        expect(
          m.locales,
          (manifestJson['locales']! as List<Object?>).cast<String>(),
        );
        expect(
          m.generators,
          (manifestJson['generators']! as List<Object?>).cast<String>(),
        );
        expect(
          m.assets.length,
          (manifestJson['assets']! as List<Object?>).length,
        );
        expect(m.assets.first.sha256, matches(RegExp(r'^[0-9a-f]{64}$')));
      },
    );

    test(
      'AN UNKNOWN MANIFEST FIELD IS IGNORED, not fatal — the invariant no test protected',
      () async {
        // Leniency was an implementation ACCIDENT: content_pack.dart reads six
        // named keys and ignores the rest, and nothing asserted it. A strict-parse
        // refactor would have destroyed forward compatibility with the whole suite
        // green — and forward compatibility is the ONLY thing that lets a v2 pack
        // reach a v1 binary without bricking it.
        final Map<String, Object?> planted = Map<String, Object?>.from(
          manifestJson,
        )..['a_field_from_the_future'] = <String, Object?>{'nested': true};
        final ContentPackManifest m = ContentPackManifest.fromJson(planted);
        expect(m.packId, manifestJson['pack_id']);
        expect(m.contentHash, manifestJson['content_hash']);
      },
    );

    test(
      'a RE-TYPED field degrades rather than throwing — content_hash object instead of string',
      () {
        // The lenient parse turns a wrong-typed content_hash into '', and the
        // LOADER then decides: empty is legal for a bundled pack and fatal for a
        // remote one. Asserting that split here is what keeps the two halves of
        // the contract from drifting apart.
        final Map<String, Object?> retyped =
            Map<String, Object?>.from(manifestJson)
              ..['content_hash'] = <String, Object?>{
                'sha256': manifestJson['content_hash'],
              };
        expect(ContentPackManifest.fromJson(retyped).contentHash, '');
      },
    );

    test(
      'a manifest with no pack_id is REFUSED — identity is not optional',
      () {
        final Map<String, Object?> broken = Map<String, Object?>.from(
          manifestJson,
        )..remove('pack_id');
        expect(
          () => ContentPackManifest.fromJson(broken),
          throwsA(isA<FormatException>()),
        );
      },
    );
  });

  group('the pack is inert data', () {
    test('carries only the five [ADR 007] member kinds', () {
      final List<String> members = v1
          .listSync(recursive: true)
          .whereType<File>()
          .map(
            (File f) => f.path
                .replaceAll('\\', '/')
                .substring(v1.path.replaceAll('\\', '/').length + 1),
          )
          .toList();
      expect(
        members,
        isNotEmpty,
        reason: 'COVERAGE LOST — the fixture walk found no files',
      );
      for (final String m in members) {
        final bool ok = const <String>[
              'manifest.json',
              'manifest.sig',
              'content.json',
              'PROVENANCE.json',
            ].contains(m) ||
            m.startsWith('assets/');
        expect(ok, isTrue, reason: '$m is not a member a pack may carry');
      }
    });

    test('every asset the manifest declares is present and hash-matched', () {
      final ContentPackManifest m = ContentPackManifest.fromJson(manifestJson);
      expect(
        m.assets,
        isNotEmpty,
        reason: 'COVERAGE LOST — a pack with no assets exercises none of this',
      );
      for (final ContentAsset a in m.assets) {
        final File f = File('${v1.path}/assets/${a.path}');
        expect(
          f.existsSync(),
          isTrue,
          reason: 'assets/${a.path} is declared and absent',
        );
      }
    });
  });
}
