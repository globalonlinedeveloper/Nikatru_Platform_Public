// ─────────────────────────────────────────────────────────────────────────────
// ST-N1d — A NATIVE BUILD'S CAPTCHA-GATED CALLS REACH THE NATIVE ROUTE, AND THE
// SESSION THEY MINT BECOMES THE MAIN CLIENT'S.
//
// ⏱ 2026-09-28 · rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
// O-NATIVE-AUTH-CALLBACK-UNBUILT. Box C's GoTrue refuses every captcha-gated
// call without a Turnstile token, and no store build carries a site key, so
// every native sign-in answered `captcha_failed`. The platform Worker's route
// (`services/platform/src/routes/native-auth.ts`) forwards the four gated calls
// without the captcha; this file proves the CLIENT half reaches it.
//
// 🔴 THE SDK IS NOT FAKED (auth-04, as in auth_redirect_capture_test.dart): two
// REAL GoTrueClients talk to one loopback server that plays both GoTrue
// (`/auth/v1/…`) and the Worker route (`/v1/auth/native/<app>/…`), and every
// assertion reads the request that ARRIVED.
//
// RED BEFORE (recorded in the lane report): with `_credentials` answering the
// main client, the password request arrives at GoTrue's `/auth/v1/token` —
// the endpoint Box C refuses without a captcha — and the route sees nothing.
//
// ⏱ 2026-09-29 · AND EVERY OP ARRIVES ATTESTED. The route now refuses an op
// with no attestation, so the loopback route also serves `/attest/challenge`
// and `/attest/install`, the native client is built with a REAL
// `InstallKeyAttestor`, and every op is checked for its headers and for an
// Ed25519 proof over clientData recomputed from the bytes that ARRIVED
// (⏱ 2026-09-30 · wire protocol v2: and from the path and query that arrived).
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

const String _app = 'subscriptiontracker';
const String _gotrue = '/auth/v1';
const String _route = '/v1/auth/native/$_app';

class _Seen {
  _Seen(this.method, this.uri, this.headers, this.body, this.bytes);
  final String method;
  final Uri uri;
  final HttpHeaders headers;
  final Map<String, Object?> body;

  /// The body exactly as it arrived — what an attestation is bound to.
  final List<int> bytes;
  @override
  String toString() => '$method ${uri.path}';
}

/// A token gotrue-dart can decode: `setSession` reads `exp` off it.
String _jwt() {
  String part(Map<String, Object?> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final int now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  return '${part(<String, Object?>{'alg': 'HS256', 'typ': 'JWT'})}.'
      '${part(<String, Object?>{'sub': _Server.userId, 'iat': now, 'exp': now + 3600})}.sig';
}

class _Server {
  _Server._(this._server) {
    _server.listen(_handle);
  }

  static Future<_Server> start() async =>
      _Server._(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  static const String userId = '00000000-0000-4000-8000-000000000001';

  final HttpServer _server;
  final List<_Seen> seen = <_Seen>[];

  /// When set, the route answers every call with this status and GoTrue body.
  (int, Map<String, Object?>)? routeRefusal;

  String get origin => 'http://127.0.0.1:${_server.port}';
  Future<void> close() => _server.close(force: true);

  List<_Seen> at(String prefix) =>
      seen.where((_Seen s) => s.uri.path.startsWith(prefix)).toList();

  static Map<String, Object?> _user() => <String, Object?>{
    'id': userId,
    'aud': 'authenticated',
    'role': 'authenticated',
    'email': 'a@b.com',
    'email_confirmed_at': '2026-09-28T00:00:00Z',
    'app_metadata': <String, Object?>{
      'provider': 'email',
      'providers': <String>['email'],
    },
    'user_metadata': <String, Object?>{},
    'created_at': '2026-09-28T00:00:00Z',
  };

  static Map<String, Object?> _session() => <String, Object?>{
    'access_token': _jwt(),
    'token_type': 'bearer',
    'expires_in': 3600,
    'refresh_token': 'rt',
    'user': _user(),
  };

  int _challenges = 0;

  Future<void> _handle(HttpRequest req) async {
    final List<int> bytes = await req.fold<List<int>>(
      <int>[],
      (List<int> all, List<int> chunk) => all..addAll(chunk),
    );
    final String raw = utf8.decode(bytes);
    final Object? parsed = raw.isEmpty ? null : jsonDecode(raw);
    seen.add(
      _Seen(
        req.method,
        req.uri,
        req.headers,
        parsed is Map<String, Object?> ? parsed : <String, Object?>{},
        bytes,
      ),
    );
    final String path = req.uri.path;
    final (int, Object?) answer;
    if (path.startsWith(_route) && routeRefusal != null) {
      answer = routeRefusal!;
    } else {
      final String op = path.startsWith(_route)
          ? path.substring(_route.length)
          : path.startsWith(_gotrue)
          ? path.substring(_gotrue.length)
          : path;
      answer = switch ((req.method, op)) {
        ('POST', '/token') => (200, _session()),
        ('POST', '/signup') => (200, _user()),
        ('POST', '/recover') => (200, <String, Object?>{}),
        ('POST', '/resend') => (200, <String, Object?>{}),
        ('GET', '/user') => (200, _user()),
        ('POST', '/attest/challenge') => (
          200,
          <String, Object?>{
            'challenge': 'ch-${++_challenges}',
            'expires_in': 120,
          },
        ),
        ('POST', '/attest/install') => (201, <String, Object?>{'key_id': 'k'}),
        _ => (404, <String, Object?>{'msg': 'not faked'}),
      };
    }
    req.response
      ..statusCode = answer.$1
      ..headers.contentType = ContentType.json
      ..write(jsonEncode(answer.$2));
    await req.response.close();
  }
}

/// gotrue's PKCE verifier store, in memory — ONE instance handed to both
/// clients, exactly as `nikatruPkceStorage` is in production.
class _MemoryStorage extends sb.GotrueAsyncStorage {
  final Map<String, String> items = <String, String>{};
  @override
  Future<String?> getItem({required String key}) async => items[key];
  @override
  Future<void> removeItem({required String key}) async => items.remove(key);
  @override
  Future<void> setItem({required String key, required String value}) async =>
      items[key] = value;
}

/// The test binding answers every `HttpClient` with 400; loopback needs the
/// real stack.
class _RealNetwork extends HttpOverrides {}

const List<TargetPlatform> _native = <TargetPlatform>[
  TargetPlatform.android,
  TargetPlatform.iOS,
  TargetPlatform.macOS,
  TargetPlatform.windows,
  TargetPlatform.linux,
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('nativeCredentialBaseUrl', () {
    test('the route base on every native target', () {
      for (final TargetPlatform p in _native) {
        expect(
          nativeCredentialBaseUrl(
            'https://platform.nikatru.com/',
            _app,
            isWeb: false,
            platform: p,
          ),
          'https://platform.nikatru.com/v1/auth/native/$_app',
          reason: '$p',
        );
      }
    });

    test('null on web, on fuchsia and in a demo build', () {
      expect(
        nativeCredentialBaseUrl(
          'https://platform.nikatru.com',
          _app,
          isWeb: true,
          platform: TargetPlatform.android,
        ),
        isNull,
        reason: 'web keeps Turnstile at GoTrue; the route refuses Origin',
      );
      expect(
        nativeCredentialBaseUrl(
          'https://platform.nikatru.com',
          _app,
          isWeb: false,
          platform: TargetPlatform.fuchsia,
        ),
        isNull,
      );
      for (final String demo in <String>['', '  ', 'platform.nikatru.com']) {
        expect(
          nativeCredentialBaseUrl(
            demo,
            _app,
            isWeb: false,
            platform: TargetPlatform.android,
          ),
          isNull,
          reason: '"$demo" is not an absolute http(s) URL',
        );
      }
    });

    test(
      'the main client is handed the SAME verifier store as the native one',
      () {
        final sb.FlutterAuthClientOptions options = nikatruAuthOptions(
          secureStore: core.InMemorySecureStore(),
        );
        expect(identical(options.pkceAsyncStorage, nikatruPkceStorage), isTrue);
      },
    );
  });

  late _Server server;
  // The REAL install-key attestor, over a store that is empty at each test:
  // the first op of every test registers a fresh key.
  late core.InstallKeyAttestor attestor;
  setUp(() async {
    server = await _Server.start();
    attestor = core.InstallKeyAttestor(store: core.InMemorySecureStore());
  });
  tearDown(() async => server.close());

  /// A repository wired as a live build on [platform] wires it: the main client
  /// at GoTrue, and the native client from [nativeCredentialClient].
  Future<void> live(
    TargetPlatform platform,
    bool isWeb,
    Future<void> Function(
      SupabaseAuthRepository auth,
      sb.GoTrueClient main,
      _MemoryStorage store,
    )
    body,
  ) => HttpOverrides.runWithHttpOverrides(() async {
    final _MemoryStorage store = _MemoryStorage();
    final sb.GoTrueClient main = sb.GoTrueClient(
      url: '${server.origin}$_gotrue',
      headers: <String, String>{'apikey': 'anon-key'},
      autoRefreshToken: false,
      asyncStorage: store,
    );
    final sb.GoTrueClient? native = nativeCredentialClient(
      platformBaseUrl: server.origin,
      appId: _app,
      attestor: attestor,
      isWeb: isWeb,
      platform: platform,
      pkceStorage: store,
    );
    expect(native == null, isWeb);
    await body(
      SupabaseAuthRepository(
        client: main,
        nativeCredentials: native,
        redirects: AuthRedirects(
          appId: _app,
          isWeb: isWeb,
          platform: platform,
          base: Uri.parse(isWeb ? 'https://nikatru.com/$_app/' : 'file:///x/'),
        ),
      ),
      main,
      store,
    );
  }, _RealNetwork());

  for (final TargetPlatform platform in _native) {
    test(
      '$platform: every GATED call reaches the route, with no captcha',
      () async {
        await live(platform, false, (
          SupabaseAuthRepository auth,
          sb.GoTrueClient main,
          _MemoryStorage store,
        ) async {
          final List<core.AuthEvent> events = <core.AuthEvent>[];
          final StreamSubscription<core.AuthEvent> sub = auth
              .authEvents()
              .listen(events.add);

          await auth.signInWithEmail(
            email: 'a@b.com',
            password: 'pw-123456',
            captchaToken: 'a-web-token',
          );
          await auth.signUpWithEmail(
            email: 'a@b.com',
            password: 'pw-123456',
            captchaToken: 'a-web-token',
          );
          await auth.sendPasswordReset('a@b.com', captchaToken: 'a-web-token');
          await auth.resendSignUpConfirmation(
            'a@b.com',
            captchaToken: 'a-web-token',
          );
          await auth.resendVerificationEmail(captchaToken: 'a-web-token');
          await pumpEventQueue();
          await sub.cancel();

          final List<String> routed = server
              .at(_route)
              .map((_Seen s) => '${s.method} ${s.uri.path}')
              .toList();
          // One registration, then one fresh challenge before every op.
          expect(routed, <String>[
            'POST $_route/attest/challenge',
            'POST $_route/attest/install',
            'POST $_route/attest/challenge',
            'POST $_route/token',
            'POST $_route/attest/challenge',
            'POST $_route/signup',
            'POST $_route/attest/challenge',
            'POST $_route/recover',
            'POST $_route/attest/challenge',
            'POST $_route/resend',
            'POST $_route/attest/challenge',
            'POST $_route/resend',
          ]);
          // ⏱ 2026-09-29 · every op carries the install key's attestation,
          // bound to its own challenge and to the bytes that ARRIVED. Ed25519
          // signatures are deterministic, so the attestor re-signing the
          // recomputed clientData must give the proof on the wire.
          final String keyId = await attestor.keyId();
          final Set<String> challenges = <String>{};
          for (final _Seen s in server.at(_route)) {
            final String op = s.uri.path.substring(_route.length + 1);
            if (!core.kNativeAttestOps.contains(op)) continue;
            final String? challenge = s.headers.value(
              core.kNativeAttestChallengeHeader,
            );
            expect(challenge, isNotNull, reason: '$s carried no challenge');
            expect(challenges.add(challenge!), isTrue, reason: 'reused');
            expect(
              s.headers.value(core.kNativeAttestKindHeader),
              'install-key',
            );
            expect(s.headers.value(core.kNativeAttestKeyHeader), keyId);
            // ⏱ 2026-09-30 · wire protocol v2: and over the target — the path
            // and query that ARRIVED, as the server recomputes it.
            final core.NativeAttestProof expected = await attestor.prove(
              clientData: core.nativeAttestClientData(
                app: _app,
                op: op,
                challenge: challenge,
                target: core.nativeAttestTarget(s.uri),
                body: s.bytes,
              ),
            );
            expect(
              s.headers.value(core.kNativeAttestProofHeader),
              expected.proof,
              reason: '$s: the proof is not over the bytes that arrived',
            );
          }
          expect(challenges, hasLength(5));
          final _Seen install = server.at('$_route/attest/install').single;
          expect(install.body, <String, Object?>{
            'kind': 'install-key',
            'public_key': await attestor.publicKey(),
          });
          expect(
            server
                .at(_route)
                .single0('/token')
                .uri
                .queryParameters['grant_type'],
            'password',
          );
          for (final _Seen s in server.at(_route)) {
            final Object? meta = s.body['gotrue_meta_security'];
            expect(
              meta is Map ? meta['captcha_token'] : null,
              isNull,
              reason: '$s carried a captcha token',
            );
            expect(
              s.headers.value('apikey'),
              isNull,
              reason: '$s sent an apikey; the route adds its own',
            );
          }
          // GoTrue itself saw NO gated call — only the handover's `GET /user`.
          expect(
            server.at(_gotrue).map((_Seen s) => '${s.method} ${s.uri.path}'),
            <String>['GET $_gotrue/user'],
          );

          // The session the route minted is the MAIN client's, announced as a
          // sign-in — what the router listens for.
          expect(main.currentSession?.refreshToken, 'rt');
          expect(auth.currentUser?.id, _Server.userId);
          expect(
            events.map((core.AuthEvent e) => e.kind),
            contains(core.AuthEventKind.signedIn),
          );
        });
      },
    );
  }

  test('the main client exchanges the code with the verifier a native sign-up '
      'stored', () async {
    await live(TargetPlatform.android, false, (
      SupabaseAuthRepository auth,
      sb.GoTrueClient main,
      _MemoryStorage store,
    ) async {
      await auth.signUpWithEmail(email: 'a@b.com', password: 'pw-123456');
      final _Seen signUp = server.at('$_route/signup').single;
      expect(signUp.body['code_challenge'], isA<String>());
      expect(signUp.body['code_challenge_method'], 's256');

      // What the returning link runs on the MAIN client: it has to find the
      // verifier the NATIVE client stored, or it throws "Code verifier could
      // not be found in local storage".
      await main.exchangeCodeForSession('code-from-the-link');
      final _Seen exchange = server.at('$_gotrue/token').single;
      expect(exchange.uri.queryParameters['grant_type'], 'pkce');
      expect(exchange.body['code_verifier'], isA<String>());
      expect(store.items, isEmpty, reason: 'the exchange spent the verifier');
    });
  });

  test('a 429 from the route is a RATE LIMIT, not a wrong password', () async {
    server.routeRefusal = (
      429,
      <String, Object?>{
        'code': 429,
        'error_code': 'over_request_rate_limit',
        'msg': 'Too many requests',
      },
    );
    await live(TargetPlatform.android, false, (
      SupabaseAuthRepository auth,
      sb.GoTrueClient main,
      _MemoryStorage store,
    ) async {
      await expectLater(
        auth.signInWithEmail(email: 'a@b.com', password: 'pw-123456'),
        throwsA(
          isA<core.AuthFailure>().having(
            (core.AuthFailure f) => f.code,
            'code',
            'over_request_rate_limit',
          ),
        ),
      );
      expect(main.currentSession, isNull);
    });
  });

  test(
    'WEB: every gated call goes to GoTrue, with its captcha token',
    () async {
      await live(TargetPlatform.android, true, (
        SupabaseAuthRepository auth,
        sb.GoTrueClient main,
        _MemoryStorage store,
      ) async {
        await auth.signInWithEmail(
          email: 'a@b.com',
          password: 'pw-123456',
          captchaToken: 'a-web-token',
        );
        await auth.sendPasswordReset('a@b.com', captchaToken: 'a-web-token');
        expect(server.at(_route), isEmpty);
        final _Seen token = server.at('$_gotrue/token').single;
        expect(
          (token.body['gotrue_meta_security']! as Map)['captcha_token'],
          'a-web-token',
        );
        expect(server.at('$_gotrue/recover'), hasLength(1));
      });
    },
  );
}

extension on List<_Seen> {
  _Seen single0(String suffix) =>
      where((_Seen s) => s.uri.path.endsWith(suffix)).single;
}
