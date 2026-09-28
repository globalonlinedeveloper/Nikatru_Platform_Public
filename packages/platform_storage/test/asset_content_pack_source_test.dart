import 'dart:convert';

import 'package:flutter/foundation.dart' show FlutterError;
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

/// An asset bundle holding exactly [_assets]; anything else is absent, the way
/// `rootBundle` reports a key no pubspec declared.
class _MapBundle extends CachingAssetBundle {
  _MapBundle(this._assets);
  final Map<String, List<int>> _assets;

  @override
  Future<ByteData> load(String key) async {
    final List<int>? bytes = _assets[key];
    if (bytes == null) throw FlutterError('Unable to load asset: "$key".');
    return ByteData.sublistView(Uint8List.fromList(bytes));
  }
}

void main() {
  test('reads a bundled entry under its prefix', () async {
    final AssetContentPackSource s = AssetContentPackSource(
      'assets/content_pack',
      bundle: _MapBundle(<String, List<int>>{
        'assets/content_pack/manifest.json': utf8.encode('{"pack_id":"x"}'),
      }),
    );
    expect(utf8.decode((await s.read('manifest.json'))!), '{"pack_id":"x"}');
  });

  test('an absent entry is null, never a throw', () async {
    final AssetContentPackSource s = AssetContentPackSource(
      'assets/content_pack',
      bundle: _MapBundle(<String, List<int>>{}),
    );
    expect(await s.read('manifest.json'), isNull);
  });

  test('an app that bundles no pack falls through to the loader failure',
      () async {
    final core.Result<core.ContentPack> r = await const core.ContentPackLoader()
        .load(
      expectPackId: 'probe',
      bundled: AssetContentPackSource(
        'assets/content_pack',
        bundle: _MapBundle(<String, List<int>>{}),
      ),
    );
    expect(r.isOk, isFalse);
  });
}
