/// Content-pack data model (ADR 007): an immutable, semver'd, Ed25519-signed
/// unit — `manifest.json` + `content.json` + `assets/` + `manifest.sig`.
library;

/// A single asset in a content pack, addressed by [path] within `assets/` and
/// integrity-checked against its [sha256] (lower-case hex) from the manifest.
class ContentAsset {
  const ContentAsset({required this.path, required this.sha256});

  final String path;
  final String sha256;

  factory ContentAsset.fromJson(Map<String, Object?> j) => ContentAsset(
        path: j['path'] is String ? j['path']! as String : '',
        sha256: j['sha256'] is String ? j['sha256']! as String : '',
      );

  Map<String, Object?> toJson() =>
      <String, Object?>{'path': path, 'sha256': sha256};
}

/// The signed manifest of a content pack: identity + semver, the signing
/// `key_id`, the content integrity hash, per-asset hashes, generator provenance
/// and locales. The Ed25519 signature (`manifest.sig`) is computed over the
/// manifest bytes.
class ContentPackManifest {
  const ContentPackManifest({
    required this.packId,
    required this.version,
    required this.contentHash,
    this.keyId = '',
    this.assets = const <ContentAsset>[],
    this.generators = const <String>[],
    this.locales = const <String>[],
  });

  /// Stable pack identity (usually the app id).
  final String packId;

  /// Semantic version of this immutable pack.
  final String version;

  /// Which pinned Ed25519 key signed this manifest (ADR 016) — the client looks
  /// it up in `kContentPackPublicKeys`. Empty on a trusted BUNDLED pack (never
  /// signature-checked); MANDATORY on any remote pack, where an empty or
  /// unpinned `key_id` is rejected. Present from day one so a compromised key
  /// can be rotated without stranding already-released binaries.
  final String keyId;

  /// sha256 (lower-case hex) of `content.json` — the Merkle root also covers the
  /// per-asset hashes once asset loading is wired.
  final String contentHash;

  /// Per-asset integrity hashes.
  final List<ContentAsset> assets;

  /// Generator model IDs (provenance — the copyright-defensible curation trail).
  final List<String> generators;

  /// Locales carried by `content.json`.
  final List<String> locales;

  factory ContentPackManifest.fromJson(Map<String, Object?> j) {
    final Object? id = j['pack_id'];
    final Object? ver = j['version'];
    if (id is! String || id.isEmpty) {
      throw const FormatException(
          'ContentPackManifest: missing/invalid pack_id');
    }
    if (ver is! String || ver.isEmpty) {
      throw const FormatException(
          'ContentPackManifest: missing/invalid version');
    }
    return ContentPackManifest(
      packId: id,
      version: ver,
      contentHash:
          j['content_hash'] is String ? j['content_hash']! as String : '',
      // Lenient parse: an absent/wrong-typed key_id becomes '' and the LOADER
      // decides — '' is legal for a bundled pack and fatal for a remote one.
      keyId: j['key_id'] is String ? j['key_id']! as String : '',
      assets: _list(j['assets'])
          .whereType<Map<Object?, Object?>>()
          .map((Map<Object?, Object?> m) =>
              ContentAsset.fromJson(m.cast<String, Object?>()))
          .toList(),
      generators: _list(j['generators']).map((Object? e) => '$e').toList(),
      locales: _list(j['locales']).map((Object? e) => '$e').toList(),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'pack_id': packId,
        'version': version,
        'key_id': keyId,
        'content_hash': contentHash,
        'assets': assets.map((ContentAsset a) => a.toJson()).toList(),
        'generators': generators,
        'locales': locales,
      };

  static List<Object?> _list(Object? v) =>
      v is List ? v.cast<Object?>() : const <Object?>[];
}

/// A loaded, verified content pack: its [manifest] plus the decoded, locale-
/// sharded [content] (`content.json`). Replaces the P0.3 stub.
class ContentPack {
  const ContentPack({required this.manifest, required this.content});

  final ContentPackManifest manifest;

  /// Locale-sharded content: `locale -> (key -> value)`. Values may be strings
  /// or richer JSON; [text] covers the common string-copy case.
  final Map<String, Object?> content;

  /// The string value for [key] in [locale], falling back to [fallbackLocale]
  /// then the key itself. Resolves only string leaves under a
  /// `locale -> {key: value}` shape.
  String text(String key,
      {String locale = 'en', String fallbackLocale = 'en'}) {
    return _lookup(locale, key) ?? _lookup(fallbackLocale, key) ?? key;
  }

  String? _lookup(String locale, String key) {
    final Object? shard = content[locale];
    if (shard is Map) {
      final Object? v = shard[key];
      if (v is String) return v;
    }
    return null;
  }

  /// A safe empty default pack — used when no pack is available.
  static const ContentPack empty = ContentPack(
    manifest:
        ContentPackManifest(packId: '', version: '0.0.0', contentHash: ''),
    content: <String, Object?>{},
  );
}
