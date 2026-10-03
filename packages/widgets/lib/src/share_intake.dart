import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// What another app shared in: text, or the text of a file (a CSV export).
@immutable
class SharedPayload {
  const SharedPayload({required this.text, this.fileName, this.mimeType});

  final String text;
  final String? fileName;
  final String? mimeType;

  /// The CSV-ness the import route needs to pick its parser.
  bool get isCsv =>
      mimeType == 'text/csv' ||
      mimeType == 'text/comma-separated-values' ||
      (fileName?.toLowerCase().endsWith('.csv') ?? false);

  /// Parses the channel's argument map. Anything malformed is null — a share
  /// is input from another process and is never trusted to be well-formed.
  static SharedPayload? fromChannel(Object? args) {
    if (args is! Map) return null;
    final Object? text = args['text'];
    if (text is! String || text.isEmpty) return null;
    if (text.length > maxChars) return null;
    final Object? name = args['name'];
    final Object? mime = args['mime'];
    return SharedPayload(
      text: text,
      fileName: name is String ? name : null,
      mimeType: mime is String ? mime : null,
    );
  }

  /// A share larger than this is refused rather than parsed: the import
  /// screen is for a list of subscriptions, not a database dump.
  static const int maxChars = 1 << 20;
}

/// The one route a share opens. The import hub (train T13) owns it; this
/// package only hands it the payload, as route `extra`, never in the URL —
/// a shared list in a URL is a list in browser history and in every log.
const String shareIntakeRoute = '/import';

/// Receives shares from the native share extension (iOS), the Services menu
/// (macOS) and any future receiver over ONE method channel, and hands each to
/// [onShared].
///
/// The native halves call `shared` with `{text, name?, mime?}`. A share that
/// arrives before the app has a router is held and delivered by [install], so
/// a cold launch from the share sheet still lands on the import route.
class ShareIntake {
  ShareIntake({
    required this.onShared,
    MethodChannel channel = const MethodChannel(channelName),
  }) : _channel = channel;

  static const String channelName = 'com.nikatru/share_intake';

  final void Function(SharedPayload payload) onShared;
  final MethodChannel _channel;

  /// Starts listening and drains a share that launched the app.
  Future<void> install() async {
    _channel.setMethodCallHandler(handle);
    try {
      final Object? initial = await _channel.invokeMethod<Object?>('initial');
      final SharedPayload? p = SharedPayload.fromChannel(initial);
      if (p != null) onShared(p);
    } on MissingPluginException {
      // No native receiver on this target in this build — see
      // GlanceCapabilities.shareIn.
    } on PlatformException catch (e) {
      debugPrint('share intake: initial share unreadable (${e.code})');
    }
  }

  /// The channel handler, public so a fixture can hand it a share exactly as
  /// a native extension would.
  @visibleForTesting
  Future<Object?> handle(MethodCall call) async {
    if (call.method != 'shared') return false;
    final SharedPayload? p = SharedPayload.fromChannel(call.arguments);
    if (p == null) return false;
    onShared(p);
    return true;
  }
}
