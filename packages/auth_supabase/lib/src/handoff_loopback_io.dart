/// ⏱ 2026-10-01 · The loopback return of the system-browser hand-off on a
/// desktop build (RFC 8252 §7.3): an HTTP listener on 127.0.0.1, on a port the
/// OS picks, that takes the first request to `/nk-auth-callback` carrying THIS
/// hand-off's `state` and answers the browser a one-line page. 🔴 127.0.0.1,
/// NEVER `localhost` (§8.3: a hosts file can point that name elsewhere), and the
/// server holds the redirect to exactly this shape. ⏱ 2026-10-02: any other
/// request is 404 and the wait goes on (it used to END the wait, so whatever hit
/// the path first failed the sign-in). core `handoffCodeOf` still re-checks the
/// arrival, and the code is worthless without the verifier, which never leaves
/// the app.
library;

import 'dart:async';
import 'dart:io';

import 'package:nikatru_core/nikatru_core.dart' as core;

import 'browser_handoff_client.dart';

const String _page = '<!DOCTYPE html><meta charset="utf-8"><title>Nikatru</title>'
    '<p style="font:16px system-ui;margin:3em;text-align:center">'
    'You can close this tab and return to the app.</p>';

final class _Loopback implements HandoffReturn {
  _Loopback(this._server)
      : redirectUri = core.handoffLoopbackRedirect(_server.port) {
    _sub = _server.listen((HttpRequest req) async {
      final bool ours = req.method == 'GET' &&
          req.uri.path == core.kHandoffLoopbackPath &&
          _carriesArmedState(req.uri) &&
          !_arrived.isCompleted;
      // Completed synchronously, before the first await: a second request
      // arriving while this one is answered finds the wait already over.
      if (ours) {
        _arrived.complete(
          Uri.parse(redirectUri).replace(query: req.uri.query),
        );
      }
      req.response
        ..statusCode = ours ? HttpStatus.ok : HttpStatus.notFound
        ..headers.contentType = ContentType.html
        ..headers.set('Cache-Control', 'no-store')
        ..headers.set('Referrer-Policy', 'no-referrer')
        ..write(ours ? _page : '');
      await req.response.close();
    });
  }

  final HttpServer _server;
  late final StreamSubscription<HttpRequest> _sub;
  final Completer<Uri> _arrived = Completer<Uri>();
  String? _state;

  bool _carriesArmedState(Uri uri) {
    final String? armed = _state;
    if (armed == null) return false;
    try {
      return uri.queryParameters['state'] == armed;
    } on FormatException {
      return false;
    }
  }

  @override
  void expectState(String state) => _state = state;

  @override
  final String redirectUri;

  @override
  Future<Uri> get callback => _arrived.future;

  @override
  Future<void> close() async {
    await _sub.cancel();
    await _server.close(force: true);
  }
}

/// Binds 127.0.0.1 on an OS-chosen port and returns the listener.
Future<HandoffReturn> openHandoffLoopback() async =>
    _Loopback(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));
