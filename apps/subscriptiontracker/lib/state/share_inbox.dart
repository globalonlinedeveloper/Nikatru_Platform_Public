// IM-06 — SHARE INTO IMPORT. A `.csv`, a backup or the text of a receipt
// shared to the app from another app opens the import hub with it.
//
// ANDROID TODAY: `MainActivity.kt` answers on [kShareChannel] — `initial` for
// the share that launched the app, a `shared` call for one that arrives while
// it runs (the activity is singleTop). iOS and macOS share extensions are a
// separate target (train T16); every other platform has no share-in surface,
// so [MethodChannelSharedImportSource] never touches the channel there.
//
// Nothing is uploaded: the text goes into `importInboxProvider` and the import
// hub reads it on the device, the same as a paste.

import 'dart:async';

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The channel `MainActivity.kt` answers on. Spelled once, here and there.
const MethodChannel kShareChannel = MethodChannel(
  'com.nikatru.subscriptiontracker/share',
);

/// Something that hands the app files shared to it from outside.
abstract interface class SharedImportSource {
  /// The share that LAUNCHED the app, once; null when there was none.
  Future<core.ImportedFile?> initial();

  /// Shares that arrive while the app is running.
  Stream<core.ImportedFile> get arrivals;
}

/// The Android half, over [kShareChannel]. Silent on every other platform.
class MethodChannelSharedImportSource implements SharedImportSource {
  MethodChannelSharedImportSource({
    MethodChannel channel = kShareChannel,
    bool? enabled,
  }) : _channel = channel,
       _enabled =
           enabled ??
           (!kIsWeb && defaultTargetPlatform == TargetPlatform.android);

  final MethodChannel _channel;
  final bool _enabled;
  StreamController<core.ImportedFile>? _arrivals;

  static core.ImportedFile? _read(Object? args) {
    if (args is! Map) return null;
    final Object? text = args['text'];
    if (text is! String || text.trim().isEmpty) return null;
    final Object? name = args['name'];
    return core.ImportedFile(
      name: name is String && name.isNotEmpty ? name : 'shared text',
      text: text,
    );
  }

  @override
  Future<core.ImportedFile?> initial() async {
    if (!_enabled) return null;
    try {
      return _read(await _channel.invokeMethod<Object?>('initial'));
    } catch (_) {
      // No handler (a build without the activity half, a test binding) or a
      // platform refusal: there is no launching share to hand over.
      return null;
    }
  }

  @override
  Stream<core.ImportedFile> get arrivals {
    if (!_enabled) return const Stream<core.ImportedFile>.empty();
    final StreamController<core.ImportedFile>? existing = _arrivals;
    if (existing != null) return existing.stream;
    final StreamController<core.ImportedFile> c =
        StreamController<core.ImportedFile>.broadcast();
    try {
      _channel.setMethodCallHandler((MethodCall call) async {
        if (call.method != 'shared') return null;
        final core.ImportedFile? f = _read(call.arguments);
        if (f != null) c.add(f);
        return null;
      });
    } catch (_) {
      // No binding yet (a plain unit test that builds the router): nothing
      // can be shared in, so there is nothing to listen for.
      return const Stream<core.ImportedFile>.empty();
    }
    _arrivals = c;
    return c.stream;
  }
}

/// The share-in source the router listens to. A seam so a test can share.
final Provider<SharedImportSource> sharedImportSourceProvider =
    Provider<SharedImportSource>((ref) => MethodChannelSharedImportSource());

/// Puts every shared file in the import inbox and opens `/import`. The gate
/// chain still runs on the way: a signed-out share lands on sign-in with
/// `?next=/import`, and the inbox holds the file across that hop.
class ShareInboxRouter {
  ShareInboxRouter({
    required SharedImportSource source,
    required void Function(core.ImportedFile file) deliver,
    required void Function(String location) open,
  }) : _source = source,
       _deliver = deliver,
       _open = open;

  final SharedImportSource _source;
  final void Function(core.ImportedFile file) _deliver;
  final void Function(String location) _open;
  StreamSubscription<core.ImportedFile>? _sub;

  Future<void> start() async {
    if (_sub != null) return;
    _sub = _source.arrivals.listen(_take);
    final core.ImportedFile? first = await _source.initial();
    if (first != null) _take(first);
  }

  void _take(core.ImportedFile f) {
    _deliver(f);
    _open('/import');
  }

  void stop() {
    _sub?.cancel();
    _sub = null;
  }
}
