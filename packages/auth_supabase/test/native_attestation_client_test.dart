// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-29 · NATIVE SIGN-IN ATTESTATION — the HTTP half.
//
// The server refuses every native op (token, signup, recover, resend) that
// carries no attestation bound to a fresh challenge and to the exact body. This
// pins what NativeAttestationClient puts on the wire, read off the requests that
// ARRIVED at a MockClient:
//   · one fresh challenge per op, never reused;
//   · the headers, and a proof over clientData recomputed from the RECEIVED
//     bytes — so a body re-encoded between hashing and sending is caught;
//   · install registration first when needed, once;
//   · `attestation_key_unknown` → forget, re-register ONCE, retry ONCE — not
//     twice, and the second refusal reaches the caller with its body intact;
//   · no attest header on any URL outside the native base;
//   · an attestor that cannot prove fails the call; the op is never sent.
//
// ⏱ 2026-09-30 · wire protocol v2: the proof also covers the request TARGET
// (path + canonical query). The recomputation below takes the target from the
// URL that ARRIVED, and the literals pin it — so a client that bound a URL
// other than the one it sent (a dropped query, the base instead of the op, the
// install path taken from the op) fails here.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

const String _app = 'subscriptiontracker';
const String _origin = 'https://platform.nikatru.test';
const String _base = '$_origin/v1/auth/native/$_app';

/// A deterministic attestor: the proof NAMES the requestHash it was asked to
/// prove, so a test can recompute it from the bytes that arrived.
class _FakeAttestor implements core.NativeAttestor {
  _FakeAttestor({
    this.needsInstall = true,
    this.kindName = core.kNativeAttestKindInstallKey,
    this.keyId = 'KEY',
  });

  @override
  final bool needsInstall;
  final String kindName;
  final String? keyId;
  bool registered = false;
  bool failProve = false;
  int registers = 0;
  int forgets = 0;

  /// Every install target [register] was handed, in order.
  final List<String> installTargets = <String>[];

  /// Every clientData [prove] was asked for, in order.
  final List<String> proved = <String>[];

  @override
  String get kind => kindName;

  @override
  Future<bool> isRegistered({required String app}) async => registered;

  @override
  Future<core.NativeAttestInstall> register({
    required String app,
    required String challenge,
    required String target,
  }) async {
    registers++;
    installTargets.add(target);
    final List<int> body = utf8.encode(
      '{"kind":"$kindName","public_key":"PK"}',
    );
    final String clientData = core.nativeAttestClientData(
      app: app,
      op: core.kNativeAttestInstallOp,
      challenge: challenge,
      target: target,
      body: body,
    );
    return core.NativeAttestInstall(
      kind: kindName,
      body: body,
      proof: 'install:${core.nativeAttestRequestHash(clientData)}',
    );
  }

  @override
  Future<void> markRegistered({required String app}) async => registered = true;

  @override
  Future<core.NativeAttestProof> prove({required String clientData}) async {
    proved.add(clientData);
    if (failProve) {
      throw core.NativeAttestationException(kindName, 'channel_failed');
    }
    return core.NativeAttestProof(
      kind: kindName,
      keyId: keyId,
      proof: 'proof:${core.nativeAttestRequestHash(clientData)}',
    );
  }

  @override
  Future<void> forget({required String app}) async {
    forgets++;
    registered = false;
  }
}

/// The Worker, faked at the HTTP boundary.
class _Wire {
  final List<http.Request> seen = <http.Request>[];
  int _challenges = 0;

  /// What an op answers: status and JSON body.
  (int, Map<String, Object?>) Function(http.Request) op = (_) =>
      (200, <String, Object?>{'ok': true});

  /// What the challenge endpoint answers, when not a fresh challenge.
  (int, Map<String, Object?>)? challengeRefusal;

  /// Extra headers on an op's answer (EN-02: `Retry-After`).
  Map<String, String> opHeaders = const <String, String>{};

  late final MockClient client = MockClient((http.Request r) async {
    seen.add(r);
    final String path = r.url.path;
    final (int, Map<String, Object?>) answer;
    bool isOp = false;
    if (path == '/v1/auth/native/$_app/attest/challenge') {
      answer =
          challengeRefusal ??
          (
            200,
            <String, Object?>{
              'challenge': 'ch-${++_challenges}',
              'expires_in': 120,
            },
          );
    } else if (path == '/v1/auth/native/$_app/attest/install') {
      answer = (201, <String, Object?>{'key_id': 'KEY'});
    } else {
      answer = op(r);
      isOp = true;
    }
    return http.Response(
      jsonEncode(answer.$2),
      answer.$1,
      headers: <String, String>{
        'content-type': 'application/json',
        if (isOp) ...opHeaders,
      },
    );
  });

  List<String> get paths => seen
      .map((http.Request r) => r.url.path.replaceFirst('/v1/auth/native', ''))
      .toList();

  Iterable<http.Request> at(String suffix) =>
      seen.where((http.Request r) => r.url.path.endsWith(suffix));
}

/// gotrue's PKCE verifier store, in memory — a sign-up writes one before it
/// sends, and the default store needs a platform plugin.
class _MemoryPkce extends sb.GotrueAsyncStorage {
  final Map<String, String> items = <String, String>{};
  @override
  Future<String?> getItem({required String key}) async => items[key];
  @override
  Future<void> removeItem({required String key}) async => items.remove(key);
  @override
  Future<void> setItem({required String key, required String value}) async =>
      items[key] = value;
}

bool _hasAttestHeader(http.BaseRequest r) =>
    r.headers.keys.any((String k) => k.toLowerCase().startsWith('x-nk-attest'));

/// The proof the fake attestor would have made for [r] AS RECEIVED — its URL
/// (path and query) and its bytes.
String _expectedProof(http.Request r, String op) =>
    _proofFor(r, op, core.nativeAttestTarget(r.url));

/// The fake attestor's proof for [r]'s challenge and bytes, bound to [target].
String _proofFor(http.Request r, String op, String target) {
  final String clientData = core.nativeAttestClientData(
    app: _app,
    op: op,
    challenge: r.headers[core.kNativeAttestChallengeHeader]!,
    target: target,
    body: r.bodyBytes,
  );
  return 'proof:${core.nativeAttestRequestHash(clientData)}';
}

/// The target line (the fifth) of a clientData.
String _targetLine(String clientData) => clientData.split('\n')[4];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _Wire wire;
  late _FakeAttestor attestor;
  late NativeAttestationClient client;
  setUp(() {
    wire = _Wire();
    attestor = _FakeAttestor();
    client = NativeAttestationClient(
      baseUrl: _base,
      appId: _app,
      attestor: attestor,
      inner: wire.client,
    );
  });

  Future<http.Response> post(String path, Map<String, Object?> body) =>
      client.post(
        Uri.parse('$_base$path'),
        headers: <String, String>{'Content-Type': 'application/json'},
        body: jsonEncode(body),
      );

  test('registers once, then one fresh challenge per op; every op carries the '
      'headers and a proof over the bytes that arrived', () async {
    await post('/token?grant_type=password', <String, Object?>{
      'email': 'a@example.test',
      'password': 'pw',
    });
    await post('/signup', <String, Object?>{'email': 'b@example.test'});
    await post('/recover', <String, Object?>{'email': 'c@example.test'});
    await post('/resend', <String, Object?>{'type': 'signup'});

    expect(wire.paths, <String>[
      '/$_app/attest/challenge',
      '/$_app/attest/install',
      '/$_app/attest/challenge',
      '/$_app/token',
      '/$_app/attest/challenge',
      '/$_app/signup',
      '/$_app/attest/challenge',
      '/$_app/recover',
      '/$_app/attest/challenge',
      '/$_app/resend',
    ]);
    expect(attestor.registers, 1);

    final List<String> challenges = <String>[];
    for (final String op in core.kNativeAttestOps) {
      final http.Request r = wire.at('/$op').single;
      expect(r.headers[core.kNativeAttestKindHeader], 'install-key');
      expect(r.headers[core.kNativeAttestKeyHeader], 'KEY');
      expect(r.headers[core.kNativeAttestProofHeader], _expectedProof(r, op));
      challenges.add(r.headers[core.kNativeAttestChallengeHeader]!);
    }
    expect(
      challenges.toSet(),
      hasLength(4),
      reason: 'a challenge is single use',
    );
    expect(challenges, isNot(contains('ch-1')), reason: 'ch-1 was the install');

    // The op keeps its query and its own headers.
    final http.Request token = wire.at('/token').single;
    expect(token.url.queryParameters['grant_type'], 'password');
    expect(token.headers['Content-Type'], startsWith('application/json'));

    // v2: each op's proof was asked for over the target of the URL it was
    // sent to — the token's query included.
    expect(attestor.proved.map(_targetLine), <String>[
      '/v1/auth/native/$_app/token?grant_type=password',
      '/v1/auth/native/$_app/signup',
      '/v1/auth/native/$_app/recover',
      '/v1/auth/native/$_app/resend',
    ]);

    // The install request: kind, challenge, proof — no key header; its proof
    // is over op=install, the install URL's target and its own body.
    final http.Request install = wire.at('/attest/install').single;
    expect(attestor.installTargets, <String>[
      '/v1/auth/native/$_app/attest/install',
    ]);
    expect(install.headers[core.kNativeAttestChallengeHeader], 'ch-1');
    expect(install.headers[core.kNativeAttestKindHeader], 'install-key');
    expect(install.headers.containsKey(core.kNativeAttestKeyHeader), isFalse);
    expect(
      install.headers[core.kNativeAttestProofHeader],
      'install:${core.nativeAttestRequestHash(core.nativeAttestClientData(app: _app, op: 'install', challenge: 'ch-1', target: core.nativeAttestTarget(install.url), body: install.bodyBytes))}',
    );
    expect(install.body, '{"kind":"install-key","public_key":"PK"}');

    // The challenge requests carry no attest header and an empty object.
    for (final http.Request c in wire.at('/attest/challenge')) {
      expect(_hasAttestHeader(c), isFalse);
      expect(c.body, '{}');
    }
  });

  test('🔴 red control: a proof for different bytes is not the proof on the '
      'wire', () async {
    await post('/token', <String, Object?>{'email': 'a@example.test'});
    final http.Request r = wire.at('/token').single;
    final List<int> tampered = List<int>.of(r.bodyBytes)..[1] ^= 0x01;
    final String forTampered =
        'proof:${core.nativeAttestRequestHash(core.nativeAttestClientData(app: _app, op: 'token', challenge: r.headers[core.kNativeAttestChallengeHeader]!, target: core.nativeAttestTarget(r.url), body: tampered))}';
    expect(r.headers[core.kNativeAttestProofHeader], isNot(forTampered));
    expect(
      r.headers[core.kNativeAttestProofHeader],
      _expectedProof(r, 'token'),
    );
  });

  test(
    '🔴 red control (v2): the proof on the wire is for the query that was '
    'SENT — the same bytes under another redirect_to are another proof',
    () async {
      const String redirect =
          'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm';
      await post(
        '/signup?redirect_to=${Uri.encodeComponent(redirect)}',
        <String, Object?>{'email': 'b@example.test'},
      );
      final http.Request r = wire.at('/signup').single;
      expect(
        r.headers[core.kNativeAttestProofHeader],
        _proofFor(
          r,
          'signup',
          '/v1/auth/native/$_app/signup?redirect_to=com.nikatru.subscriptiontracker'
              '%3A%2F%2Fauth-callback%3Fnk_auth%3Dconfirm',
        ),
      );
      for (final String other in <String>[
        '/v1/auth/native/$_app/signup?redirect_to=https%3A%2F%2Fevil.test%2Fcb',
        '/v1/auth/native/$_app/signup',
        '/v1/auth/native/$_app/token',
      ]) {
        expect(
          r.headers[core.kNativeAttestProofHeader],
          isNot(_proofFor(r, 'signup', other)),
          reason: other,
        );
      }
    },
  );

  test('the target is the CANONICAL query of the URL sent: order and spelling '
      'on the wire do not change it', () async {
    await post('/token?b=2&grant_type=password&a=x+y', <String, Object?>{});
    final http.Request r = wire.at('/token').single;
    expect(r.url.query, 'b=2&grant_type=password&a=x+y', reason: 'sent as is');
    expect(
      _targetLine(attestor.proved.single),
      '/v1/auth/native/$_app/token?a=x%20y&b=2&grant_type=password',
    );
    expect(
      r.headers[core.kNativeAttestProofHeader],
      _expectedProof(r, 'token'),
    );
  });

  test('attestation_key_unknown: forget, re-register ONCE, retry ONCE — and '
      'the second refusal reaches the caller intact', () async {
    attestor.registered = true;
    final Map<String, Object?> refusal = <String, Object?>{
      'code': 401,
      'error_code': 'attestation_key_unknown',
      'msg': 'no key',
    };
    wire.op = (_) => (401, refusal);

    final http.Response res = await post('/token', <String, Object?>{});

    expect(wire.paths, <String>[
      '/$_app/attest/challenge',
      '/$_app/token',
      '/$_app/attest/challenge',
      '/$_app/attest/install',
      '/$_app/attest/challenge',
      '/$_app/token',
    ]);
    expect(attestor.forgets, 1);
    expect(attestor.registers, 1);
    expect(res.statusCode, 401);
    expect(jsonDecode(res.body), refusal);
    final List<http.Request> tokens = wire.at('/token').toList();
    expect(
      tokens[0].headers[core.kNativeAttestChallengeHeader],
      isNot(tokens[1].headers[core.kNativeAttestChallengeHeader]),
      reason: 'the retry takes a new challenge',
    );
  });

  test('the retry that succeeds is what the caller gets', () async {
    attestor.registered = true;
    int calls = 0;
    wire.op = (_) => ++calls == 1
        ? (401, <String, Object?>{'error_code': 'attestation_key_unknown'})
        : (200, <String, Object?>{'access_token': 'at'});
    final http.Response res = await post('/token', <String, Object?>{});
    expect(res.statusCode, 200);
    expect(jsonDecode(res.body), <String, Object?>{'access_token': 'at'});
    expect(attestor.registered, isTrue);
  });

  test('any other 401 is handed back untouched, with no retry', () async {
    attestor.registered = true;
    final Map<String, Object?> refusal = <String, Object?>{
      'code': 401,
      'error_code': 'attestation_invalid',
      'msg': 'bad proof',
    };
    wire.op = (_) => (401, refusal);
    final http.Response res = await post('/token', <String, Object?>{});
    expect(wire.paths, <String>['/$_app/attest/challenge', '/$_app/token']);
    expect(res.statusCode, 401);
    expect(jsonDecode(res.body), refusal);
    expect(res.headers['content-type'], 'application/json');
    expect(attestor.forgets, 0);
  });

  test('a kind with no install step (play-integrity): no install, no key '
      'header, no retry', () async {
    attestor = _FakeAttestor(
      needsInstall: false,
      kindName: core.kNativeAttestKindPlayIntegrity,
      keyId: null,
    );
    client = NativeAttestationClient(
      baseUrl: _base,
      appId: _app,
      attestor: attestor,
      inner: wire.client,
    );
    wire.op = (_) =>
        (401, <String, Object?>{'error_code': 'attestation_key_unknown'});
    final http.Response res = await post('/token', <String, Object?>{});
    expect(wire.paths, <String>['/$_app/attest/challenge', '/$_app/token']);
    final http.Request r = wire.at('/token').single;
    expect(r.headers[core.kNativeAttestKindHeader], 'play-integrity');
    expect(r.headers.containsKey(core.kNativeAttestKeyHeader), isFalse);
    expect(res.statusCode, 401);
  });

  test(
    'a challenge refusal is the op\'s answer, and the op is never sent',
    () async {
      final Map<String, Object?> limited = <String, Object?>{
        'code': 429,
        'error_code': 'over_request_rate_limit',
        'msg': 'Too many requests',
      };
      wire.challengeRefusal = (429, limited);
      attestor.registered = true;
      final http.Response res = await post('/token', <String, Object?>{});
      expect(res.statusCode, 429);
      expect(jsonDecode(res.body), limited);
      expect(wire.at('/token'), isEmpty);
    },
  );

  test('🔴 an attestor that cannot prove FAILS the call: the op is never sent '
      'without a proof', () async {
    attestor
      ..registered = true
      ..failProve = true;
    await expectLater(
      post('/token', <String, Object?>{}),
      throwsA(isA<core.NativeAttestationException>()),
    );
    expect(wire.at('/token'), isEmpty);
  });

  test('no attest header on any URL outside the native base, nor on a '
      'non-op path inside it', () async {
    final List<Uri> elsewhere = <Uri>[
      Uri.parse('$_origin/auth/v1/token?grant_type=password'),
      Uri.parse('https://other.test/v1/auth/native/$_app/token'),
      Uri.parse('http://platform.nikatru.test/v1/auth/native/$_app/token'),
      Uri.parse('$_origin/v1/auth/native/otherapp/token'),
      Uri.parse('$_base/verify'),
      Uri.parse('$_base/token/extra'),
    ];
    for (final Uri url in elsewhere) {
      await client.post(url, body: '{}');
    }
    await client.get(Uri.parse('$_base/user'));
    expect(wire.seen, hasLength(elsewhere.length + 1));
    expect(wire.seen.where(_hasAttestHeader), isEmpty);
    expect(wire.at('/attest/challenge'), isEmpty);
    expect(attestor.registers, 0);
  });

  // ⏱ 2026-10-01 · EN-02 — the Worker's `Retry-After` reaches the failure a
  // screen maps. gotrue-dart's exception carries no header, so without the
  // latch the wait was dropped here. MUTATION PROOF: drop the `observe` call in
  // `NativeAttestationClient.send` and the first expectation goes red.
  test('a 429 with Retry-After reaches AuthFailure.retryAfter, once', () async {
    attestor.registered = true;
    final RetryAfterLatch latch = RetryAfterLatch();
    final SupabaseAuthRepository auth = SupabaseAuthRepository(
      client: sb.GoTrueClient(
        url: 'http://127.0.0.1:9/auth/v1',
        autoRefreshToken: false,
        asyncStorage: _MemoryPkce(),
      ),
      nativeCredentials: nativeCredentialClient(
        platformBaseUrl: _origin,
        appId: _app,
        attestor: attestor,
        isWeb: false,
        platform: TargetPlatform.android,
        transport: wire.client,
        pkceStorage: _MemoryPkce(),
        retryAfter: latch,
      ),
      retryAfter: latch,
    );
    wire.op = (_) => (
      429,
      <String, Object?>{
        'code': 429,
        'error_code': 'over_request_rate_limit',
        'msg': 'Request rate limit reached',
      },
    );
    wire.opHeaders = <String, String>{'retry-after': '60'};
    await expectLater(
      auth.signInWithEmail(email: 'a@example.test', password: 'pw'),
      throwsA(
        isA<core.AuthFailure>()
            .having((core.AuthFailure e) => e.code, 'code',
                'over_request_rate_limit')
            .having((core.AuthFailure e) => e.retryAfter, 'retryAfter',
                const Duration(seconds: 60)),
      ),
    );
    wire.opHeaders = const <String, String>{};
    wire.op = (_) => (
      400,
      <String, Object?>{
        'code': 400,
        'error_code': 'invalid_credentials',
        'msg': 'Invalid login credentials',
      },
    );
    await expectLater(
      auth.signInWithEmail(email: 'a@example.test', password: 'pw'),
      throwsA(
        isA<core.AuthFailure>().having(
          (core.AuthFailure e) => e.retryAfter,
          'retryAfter',
          isNull,
        ),
      ),
      reason: 'an answer with no Retry-After never carries a stale wait',
    );
  });

  group('nativeCredentialClient', () {
    test('a null attestor is NO client, on every native target', () {
      for (final TargetPlatform p in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.macOS,
        TargetPlatform.windows,
        TargetPlatform.linux,
      ]) {
        expect(
          nativeCredentialClient(
            platformBaseUrl: _origin,
            appId: _app,
            attestor: null,
            isWeb: false,
            platform: p,
          ),
          isNull,
          reason: '$p',
        );
      }
    });

    test('an attestor on a native target is a client; web is still none', () {
      expect(
        nativeCredentialClient(
          platformBaseUrl: _origin,
          appId: _app,
          attestor: attestor,
          isWeb: false,
          platform: TargetPlatform.android,
        ),
        isNotNull,
      );
      expect(
        nativeCredentialClient(
          platformBaseUrl: _origin,
          appId: _app,
          attestor: attestor,
          isWeb: true,
          platform: TargetPlatform.android,
        ),
        isNull,
      );
    });

    test(
      'through the REAL gotrue-dart: the password grant is attested over '
      'the exact bytes gotrue-dart sent, and a refusal keeps its code',
      () async {
        final sb.GoTrueClient native = nativeCredentialClient(
          platformBaseUrl: _origin,
          appId: _app,
          attestor: attestor,
          isWeb: false,
          platform: TargetPlatform.android,
          transport: wire.client,
        )!;
        wire.op = (_) => (
          400,
          <String, Object?>{
            'code': 400,
            'error_code': 'invalid_credentials',
            'msg': 'Invalid login credentials',
          },
        );
        await expectLater(
          native.signInWithPassword(email: 'a@example.test', password: 'pw'),
          throwsA(
            isA<sb.AuthApiException>().having(
              (sb.AuthApiException e) => e.code,
              'code',
              'invalid_credentials',
            ),
          ),
        );
        final http.Request token = wire.at('/token').single;
        expect(token.url.queryParameters['grant_type'], 'password');
        expect(
          token.headers[core.kNativeAttestProofHeader],
          _expectedProof(token, 'token'),
        );
        expect(jsonDecode(token.body), containsPair('email', 'a@example.test'));
        expect(
          _targetLine(attestor.proved.single),
          '/v1/auth/native/$_app/token?grant_type=password',
        );
      },
    );

    test('through the REAL gotrue-dart: a sign-up\'s redirect_to, in the '
        'query gotrue-dart built, is inside the proof', () async {
      final sb.GoTrueClient native = nativeCredentialClient(
        platformBaseUrl: _origin,
        appId: _app,
        attestor: attestor,
        isWeb: false,
        platform: TargetPlatform.android,
        pkceStorage: _MemoryPkce(),
        transport: wire.client,
      )!;
      wire.op = (_) => (
        422,
        <String, Object?>{
          'code': 422,
          'error_code': 'weak_password',
          'msg': 'Password should be longer',
        },
      );
      await expectLater(
        native.signUp(
          email: 'a@example.test',
          password: 'pw',
          emailRedirectTo:
              'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm',
        ),
        throwsA(isA<sb.AuthException>()),
      );
      final http.Request signup = wire.at('/signup').single;
      expect(
        signup.url.queryParameters['redirect_to'],
        'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm',
      );
      expect(
        _targetLine(attestor.proved.single),
        '/v1/auth/native/$_app/signup?redirect_to=com.nikatru.subscriptiontracker'
        '%3A%2F%2Fauth-callback%3Fnk_auth%3Dconfirm',
      );
      expect(
        signup.headers[core.kNativeAttestProofHeader],
        _expectedProof(signup, 'signup'),
      );
    });
  });
}
