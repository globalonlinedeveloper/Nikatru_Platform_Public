// ─────────────────────────────────────────────────────────────────────────────
// THE REDIRECT, CAUGHT ON THE WIRE — for every call that sends a link.
//
// ⏱ 2026-09-23. Until this PR four link-sending calls of five passed no
// redirect at all, and nothing could see it: gotrue substitutes the project's
// Site URL for a missing `redirect_to`, so a missing argument and a correct one
// both produce mail that sends and a link that resolves — to different apps.
//
// 🔴 auth-04: WHEN TWO PATHS GIVE THE SAME RESULT, ASSERT ON THE ARTEFACT THAT
// SHOWS WHICH PATH RAN. The artefact here is the HTTP request gotrue sends (or,
// for OAuth, the URL handed to the browser). So the SDK is NOT faked: the real
// `GoTrueClient` talks to a loopback HTTP server that records every request,
// and each case reads `redirect_to` off what actually arrived. A fake client
// that overrode `signUp` would prove that our own override was called.
//
// ⚠️ THE OAUTH URL NEVER REACHES THE SERVER. gotrue builds `/authorize?…` on the
// client and hands it to `url_launcher`, so that case captures the launched URL
// off url_launcher's platform channel instead — the same seam
// `apps/subscriptiontracker/test/chassis_properties_test.dart` uses.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// One request as the fake gotrue saw it.
class _Seen {
  _Seen(this.method, this.uri, this.body);
  final String method;
  final Uri uri;
  final String body;
  String? get redirectTo => uri.queryParameters['redirect_to'];
  @override
  String toString() => '$method $uri';
}

/// A loopback gotrue that answers just enough for each flow to complete, and
/// records every request it was sent.
class _FakeGoTrueServer {
  _FakeGoTrueServer._(this._server) {
    _server.listen(_handle);
  }

  static Future<_FakeGoTrueServer> start() async => _FakeGoTrueServer._(
        await HttpServer.bind(InternetAddress.loopbackIPv4, 0),
      );

  final HttpServer _server;
  final List<_Seen> seen = <_Seen>[];

  String get url => 'http://127.0.0.1:${_server.port}';

  Future<void> close() => _server.close(force: true);

  /// The one request to [path] — exactly one, so a flow that silently fired
  /// twice (or not at all) is a failure here rather than a pass on the first.
  _Seen only(String method, String path) {
    final List<_Seen> hits = seen
        .where((_Seen s) => s.method == method && s.uri.path == path)
        .toList();
    expect(hits, hasLength(1), reason: 'requests seen: $seen');
    return hits.single;
  }

  static const String _userId = '00000000-0000-4000-8000-000000000001';

  static Map<String, Object?> _user({required bool confirmed}) =>
      <String, Object?>{
        'id': _userId,
        'aud': 'authenticated',
        'role': 'authenticated',
        'email': 'a@b.com',
        'email_confirmed_at': confirmed ? '2026-09-23T00:00:00Z' : null,
        'app_metadata': <String, Object?>{
          'provider': 'email',
          'providers': <String>['email'],
        },
        'user_metadata': <String, Object?>{},
        'created_at': '2026-09-23T00:00:00Z',
      };

  Future<void> _handle(HttpRequest req) async {
    final String body = await utf8.decoder.bind(req).join();
    seen.add(_Seen(req.method, req.uri, body));
    final Object? answer = switch ((req.method, req.uri.path)) {
      ('POST', '/token') => <String, Object?>{
          'access_token': 'at-not-a-jwt',
          'token_type': 'bearer',
          'expires_in': 3600,
          'refresh_token': 'rt',
          'user': _user(confirmed: true),
        },
      ('POST', '/signup') => _user(confirmed: false),
      ('POST', '/recover') => <String, Object?>{},
      ('POST', '/resend') => <String, Object?>{},
      ('GET', '/user/identities/authorize') => <String, Object?>{
          'url': 'https://appleid.apple.com/auth/authorize?from=link',
        },
      _ => null,
    };
    req.response
      ..statusCode = answer == null ? HttpStatus.notFound : HttpStatus.ok
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(answer ?? <String, Object?>{'msg': 'not faked'}));
    await req.response.close();
  }
}

/// gotrue's PKCE verifier store, in memory.
class _MemoryStorage extends sb.GotrueAsyncStorage {
  final Map<String, String> _items = <String, String>{};
  @override
  Future<String?> getItem({required String key}) async => _items[key];
  @override
  Future<void> removeItem({required String key}) async => _items.remove(key);
  @override
  Future<void> setItem({required String key, required String value}) async =>
      _items[key] = value;
}

/// The test binding replaces every `HttpClient` with one that answers 400; the
/// fake server needs the real network stack, on loopback only.
class _RealNetwork extends HttpOverrides {}

/// Every URL the adapter really handed to `url_launcher`, in order.
List<String> _captureLaunchedUrls() {
  const MethodChannel channel =
      MethodChannel('plugins.flutter.io/url_launcher');
  final List<String> launched = <String>[];
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(channel, (MethodCall call) async {
    if (call.method == 'launch') {
      final Map<Object?, Object?> args =
          call.arguments as Map<Object?, Object?>;
      launched.add(args['url']! as String);
    }
    return true;
  });
  addTearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );
  return launched;
}

/// A native build — the case that had NO address at all before this PR.
final AuthRedirects _native = AuthRedirects(
  appId: 'subscriptiontracker',
  isWeb: false,
  platform: TargetPlatform.android,
  base: Uri.parse('file:///x/'),
);

String _want(AuthFlow flow) =>
    'com.nikatru.subscriptiontracker://auth-callback?nk_auth=${flow.marker}';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeGoTrueServer server;
  setUp(() async => server = await _FakeGoTrueServer.start());
  tearDown(() async => server.close());

  /// Runs [body] against a real GoTrueClient pointed at the fake server.
  Future<void> live(
    Future<void> Function(SupabaseAuthRepository auth) body,
  ) =>
      HttpOverrides.runWithHttpOverrides(() async {
        final sb.GoTrueClient client = sb.GoTrueClient(
          url: server.url,
          autoRefreshToken: false,
          asyncStorage: _MemoryStorage(),
        );
        await body(SupabaseAuthRepository(client: client, redirects: _native));
      }, _RealNetwork());

  Future<void> signIn(SupabaseAuthRepository auth) =>
      auth.signInWithEmail(email: 'a@b.com', password: 'pw-123456');

  test('signUp sends the CONFIRM callback as redirect_to', () async {
    await live((SupabaseAuthRepository auth) async {
      await auth.signUpWithEmail(email: 'a@b.com', password: 'pw-123456');
    });
    expect(
      server.only('POST', '/signup').redirectTo,
      _want(AuthFlow.signUpConfirm),
      reason: 'without it the confirmation link lands on the Site URL — app '
          "#1's web home — whichever app the user signed up in",
    );
  });

  test('resend sends the SAME confirm callback as the first mail', () async {
    await live((SupabaseAuthRepository auth) async {
      await signIn(auth);
      await auth.resendVerificationEmail();
    });
    expect(
      server.only('POST', '/resend').redirectTo,
      _want(AuthFlow.signUpConfirm),
    );
  });

  test('the reset request sends the RESET callback', () async {
    await live((SupabaseAuthRepository auth) async {
      await auth.sendPasswordReset('a@b.com');
    });
    expect(server.only('POST', '/recover').redirectTo, _want(AuthFlow.reset));
  });

  test('linkIdentity asks gotrue for a URL carrying the LINK callback',
      () async {
    final List<String> launched = _captureLaunchedUrls();
    await live((SupabaseAuthRepository auth) async {
      await signIn(auth);
      await auth.linkAppleIdentity();
    });
    final _Seen req = server.only('GET', '/user/identities/authorize');
    expect(req.redirectTo, _want(AuthFlow.linkIdentity));
    expect(req.uri.queryParameters['provider'], 'apple');
    // And the URL gotrue answered with is what reached the browser.
    expect(launched, <String>[
      'https://appleid.apple.com/auth/authorize?from=link',
    ]);
  });

  test('signInWithOAuth hands the browser a URL carrying the OAUTH callback',
      () async {
    final List<String> launched = _captureLaunchedUrls();
    await live((SupabaseAuthRepository auth) async {
      await auth.signInWithApple();
    });
    expect(launched, hasLength(1));
    final Uri authorize = Uri.parse(launched.single);
    expect(authorize.path, '/authorize');
    expect(authorize.queryParameters['provider'], 'apple');
    expect(authorize.queryParameters['redirect_to'], _want(AuthFlow.oauth));
    // PKCE: the challenge travels, so only THIS installation can finish it —
    // which is why the redirect must come back to this installation.
    expect(authorize.queryParameters['code_challenge'], isNotEmpty);
  });

  // The honest null, over the wire: a repository nobody configured sends no
  // `redirect_to` at all — never an invented one.
  test('AuthRedirects.none sends no redirect_to', () async {
    await HttpOverrides.runWithHttpOverrides(() async {
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: sb.GoTrueClient(
          url: server.url,
          autoRefreshToken: false,
          asyncStorage: _MemoryStorage(),
        ),
      );
      await auth.signUpWithEmail(email: 'a@b.com', password: 'pw-123456');
    }, _RealNetwork());
    expect(server.only('POST', '/signup').redirectTo, isNull);
  });
}
