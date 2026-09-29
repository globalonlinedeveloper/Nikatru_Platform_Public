import 'package:flutter/services.dart' show AssetBundle, ByteData, rootBundle;
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The BUNDLED tier of the content-pack rail — ST-X5 (audit B27).
///
/// `ContentPackLoader.load(bundled:)` has existed since the loader did, and
/// nothing supplied a bundled source: with the remote pointer null, every load
/// ended in "none available (offline, no bundled base)". This reads a pack the
/// app ships as a Flutter asset (`<prefix>/manifest.json`, `content.json`, …),
/// so a catalogue loads offline on all seven targets.
///
/// 🔴 TRUSTED BECAUSE IT IS INSIDE THE BINARY. The loader reads this tier with
/// `requireSignature: false`, which is correct only for bytes the store signed
/// as part of the app. Never point this at anything downloaded.
///
/// An absent entry is `null`, never a throw: an app that bundles no pack (the
/// brick's default) falls through to the loader's own failure, exactly as it
/// did before this source existed.
class AssetContentPackSource implements core.ContentPackSource {
  AssetContentPackSource(this.prefix, {AssetBundle? bundle})
      : _bundle = bundle ?? rootBundle;

  /// The asset directory the pack was bundled under, with no trailing slash.
  final String prefix;

  final AssetBundle _bundle;

  @override
  Future<List<int>?> read(String entry) async {
    try {
      final ByteData data = await _bundle.load('$prefix/$entry');
      return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    } catch (_) {
      return null;
    }
  }
}
