import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The REMOTE half of the content-pack rail (ADR 007) — the concrete
/// [core.ContentPackSource] that `content_pack_source.dart` says belongs in the
/// app layer, so `core` stays pure Dart and carries no HTTP dependency.
///
/// 🔴 WHY THIS FILE EXISTS AT ALL. `ContentPackLoader` shipped complete, with a
/// signature check, a content-hash check and an identity binding — and had ZERO
/// non-test call sites anywhere in the repository ([pipeline 7]P-9). Every app
/// the factory stamped resolved `contentPack: null`, so the whole rail was a
/// fail-closed seam with no open path: nothing went red, because refusing is
/// the correct behaviour when nothing is configured. A loader with no source to
/// read from cannot have a caller, so the missing source WAS the missing caller.
///
/// Reads pack entries as raw bytes from `<packBaseUrl>/<entry>`. The base URL
/// comes from the resolved `AppConfig.contentPack`, which means the SERVER
/// decides which pack a build reads — pointing it at an immutable versioned
/// path is a config change, not a release.
///
/// ⚠️ HONEST LIMIT, stated rather than implied: this reads whatever URL the
/// config names. It does not itself resolve the `latest.json` → version
/// indirection; that is the producer side's shape ([pipeline 7]P-1) and is not
/// claimed here. What the CLIENT guarantees is unchanged and lives in
/// [core.ContentPackLoader]: an untrusted pack must carry a pinned `key_id`, a
/// valid signature, a matching content hash and the identity the caller asked
/// for, or it is refused.
class DioContentPackSource implements core.ContentPackSource {
  DioContentPackSource({required String packBaseUrl, Dio? httpClient})
      : _base = packBaseUrl.endsWith('/')
            ? packBaseUrl.substring(0, packBaseUrl.length - 1)
            : packBaseUrl,
        _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  /// The bytes of [entry], or null when it is absent or unreachable.
  ///
  /// NULL, NEVER A THROW, and never a partial read. [core.ContentPackLoader]
  /// treats a null entry as "this pack is not available" and falls back to the
  /// bundled base pack; an exception escaping here would instead take down
  /// whatever was awaiting the load. A 404 on `manifest.sig` and a flat network
  /// are the same answer to the only question the loader asks.
  @override
  Future<List<int>?> read(String entry) async {
    try {
      final Response<List<int>> res = await _dio.get<List<int>>(
        '$_base/$entry',
        options: Options(
          // BYTES, not JSON. The signature is computed over the exact manifest
          // bytes, so anything that decodes and re-encodes them — which
          // ResponseType.json does — changes the message being verified and
          // makes every valid signature fail.
          responseType: ResponseType.bytes,
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
        ),
      );
      final List<int>? body = res.data;
      if (body == null || body.isEmpty) return null;
      return body;
    } on DioException {
      return null;
    } catch (_) {
      return null;
    }
  }
}
