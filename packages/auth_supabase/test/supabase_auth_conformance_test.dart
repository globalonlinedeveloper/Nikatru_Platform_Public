// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-03 · port-auth — THE GOTRUE ADAPTER PASSES THE AUTH PORT'S SUITE.
//
// `runAuthRepositoryConformance` (package:nikatru_core/testing.dart) drives
// SupabaseAuthRepository through a REAL GoTrueClient whose HTTP client replays
// GoTrue's answers from test/fixtures/gotrue_wire.json — the same bytes per
// scenario that the fake is staged with by its switches. Nothing in gotrue-dart
// is overridden: what is proven is how the adapter reads what GoTrue SENDS.
//
// Each scenario names the answers it may consume, in order. A request with no
// answer left, or one the scenario did not expect, fails the scenario: an
// adapter cannot pass by calling something nobody recorded.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/testing.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

const String _origin = 'https://gotrue.conformance.invalid';

final Map<String, Object?> _wire = jsonDecode(
  File('test/fixtures/gotrue_wire.json').readAsStringSync(),
) as Map<String, Object?>;

Map<String, Object?> _answer(String id) {
  final Object? a = (_wire['answers']! as Map<String, Object?>)[id];
  if (a == null) throw StateError('gotrue_wire.json has no answer $id');
  return a as Map<String, Object?>;
}

/// A token gotrue-dart can read `exp` off, an hour after [now].
String _jwt(DateTime now, int n) {
  String part(Map<String, Object?> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final int iat = now.millisecondsSinceEpoch ~/ 1000;
  return '${part(<String, Object?>{'alg': 'ES256', 'typ': 'JWT'})}.'
      '${part(<String, Object?>{'sub': 'conformance', 'iat': iat, 'exp': iat + 3600, 'n': n})}.sig';
}

/// A transport failure: this request and EVERY one after it never arrives
/// (gotrue-dart retries a refresh that could not reach the server).
const String _offline = 'offline';

/// Replays [script] in order; a request it does not expect throws.
http.Client _replay(List<String> script, AuthConformanceWorld world) {
  int next = 0;
  int issued = 0;
  return MockClient((http.Request req) async {
    if (next >= script.length) {
      throw StateError('unrecorded request ${req.method} ${req.url}');
    }
    final String id = script[next];
    if (id != _offline) next++;
    if (id == _offline) {
      throw http.ClientException('Failed host lookup', req.url);
    }
    final Map<String, Object?> a = _answer(id);
    final String want = a['request']! as String;
    final String have = '${req.method} ${req.url.path}'
        '${req.url.queryParameters.containsKey('grant_type') ? '?grant_type=${req.url.queryParameters['grant_type']}' : ''}';
    if (have != want) {
      throw StateError('$id answers "$want", but the adapter sent "$have"');
    }
    final Object? body = a['body'];
    final String text = body == null
        ? ''
        : jsonEncode(body).replaceAll(
            '{{access_token}}',
            _jwt(world.now(), ++issued),
          );
    return http.Response(
      text,
      a['status']! as int,
      headers: (a['headers']! as Map<String, Object?>).cast<String, String>(),
    );
  });
}

Future<SupabaseAuthRepository> _adapter(
  AuthConformanceWorld world,
  List<String> script, {
  bool signedIn = false,
}) async {
  final sb.GoTrueClient client = sb.GoTrueClient(
    url: '$_origin/auth/v1',
    autoRefreshToken: false,
    httpClient: _replay(<String>[
      if (signedIn) 'password-grant-ok',
      ...script,
    ], world),
    flowType: sb.AuthFlowType.implicit,
  );
  final SupabaseAuthRepository auth = SupabaseAuthRepository(
    client: client,
    clock: world.now,
    requestServerDeletion: world.requestServerDeletion,
  );
  if (signedIn) {
    await auth.signInWithEmail(
      email: AuthConformanceWorld.email,
      password: AuthConformanceWorld.password,
    );
  }
  return auth;
}

void main() {
  runAuthRepositoryConformance(
    adapter: 'supabase',
    test: test,
    fixtures: <AuthScenario, AuthAdapterStarter>{
      AuthScenario.signIn: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['password-grant-ok']),
      AuthScenario.refresh: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['refresh-grant-ok'], signedIn: true),
      AuthScenario.signOut: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['password-grant-ok', 'logout']),
      AuthScenario.delete: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['password-grant-ok', 'logout']),
      AuthScenario.wrongPassword: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['password-grant-wrong']),
      AuthScenario.offline: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>[_offline]),
      AuthScenario.rateLimited: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['password-grant-throttled']),
      AuthScenario.revokedSession: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>['refresh-grant-revoked'], signedIn: true),
      AuthScenario.refreshUnreachable: (_, AuthConformanceWorld w) =>
          _adapter(w, <String>[_offline], signedIn: true),
      AuthScenario.ageSignal: (_, AuthConformanceWorld w) => _adapter(
        w,
        <String>['password-grant-wrong', 'signup-unconfirmed'],
      ),
    },
  );
}
