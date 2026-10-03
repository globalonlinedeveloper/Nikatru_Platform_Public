import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_core/testing.dart';
import 'package:test/test.dart';

/// ⏱ 2026-10-03 · port-auth. The fake passes the suite the GoTrue adapter
/// passes (tooling/ports/auth.json adapter `fake`): each scenario is staged by
/// the fake's own switches, the way the GoTrue fixture stages it by recorded
/// HTTP answers.
FakeAuthRepository _signedOut(AuthConformanceWorld world) => FakeAuthRepository(
  accounts: <String, String>{
    AuthConformanceWorld.email: AuthConformanceWorld.password,
  },
  clock: world.now,
  requestServerDeletion: world.requestServerDeletion,
);

FakeAuthRepository _signedIn(AuthConformanceWorld world) => FakeAuthRepository(
  signedIn: const AuthUser(id: 'u1', email: AuthConformanceWorld.email),
  password: AuthConformanceWorld.password,
  clock: world.now,
  requestServerDeletion: world.requestServerDeletion,
);

void main() {
  runAuthRepositoryConformance(
    adapter: 'fake',
    test: test,
    fixtures: <AuthScenario, AuthAdapterStarter>{
      AuthScenario.signIn: (_, AuthConformanceWorld w) => _signedOut(w),
      AuthScenario.refresh: (_, AuthConformanceWorld w) => _signedIn(w),
      AuthScenario.signOut: (_, AuthConformanceWorld w) => _signedOut(w),
      AuthScenario.delete: (_, AuthConformanceWorld w) => _signedOut(w),
      AuthScenario.wrongPassword: (_, AuthConformanceWorld w) => _signedOut(w),
      AuthScenario.offline: (_, AuthConformanceWorld w) =>
          _signedOut(w)..offline = true,
      AuthScenario.rateLimited: (_, AuthConformanceWorld w) =>
          _signedOut(w)..rateLimited = true,
      AuthScenario.revokedSession: (_, AuthConformanceWorld w) =>
          _signedIn(w)..sessionRevoked = true,
      AuthScenario.refreshUnreachable: (_, AuthConformanceWorld w) =>
          _signedIn(w)..offline = true,
      AuthScenario.ageSignal: (_, AuthConformanceWorld w) => _signedOut(w),
    },
  );

  // 🔴 THE RUNNER REFUSES A MISSING FIXTURE. A suite that skipped a scenario
  // nobody staged would let an adapter "conform" by omission.
  group('the runner', () {
    final List<String> ran = <String>[];
    final List<Object> errors = <Object>[];
    runAuthRepositoryConformance(
      adapter: 'unstaged',
      test: (String name, body) => ran.add(name),
      fixtures: const <AuthScenario, AuthAdapterStarter>{},
    );
    test('registers every scenario', () {
      expect(ran, hasLength(AuthScenario.values.length));
    });
    test('a scenario with no fixture THROWS, never skips', () async {
      Object? caught;
      runAuthRepositoryConformance(
        adapter: 'unstaged',
        test: (String name, body) {
          if (name.endsWith(': signIn')) {
            errors.add(body);
          }
        },
        fixtures: const <AuthScenario, AuthAdapterStarter>{},
      );
      try {
        await (errors.single as dynamic)();
      } on AuthConformanceFailure catch (e) {
        caught = e;
      }
      expect(caught, isA<AuthConformanceFailure>());
    });
    test('a fake that reads offline as a wrong password FAILS offline', () async {
      Object? caught;
      final List<Object> bodies = <Object>[];
      runAuthRepositoryConformance(
        adapter: 'conflating',
        test: (String name, body) {
          if (name.endsWith(': offline')) bodies.add(body);
        },
        fixtures: <AuthScenario, AuthAdapterStarter>{
          // Offline is not switched on, so the provider answers "wrong
          // password" for a password that is right — the conflation.
          AuthScenario.offline: (_, AuthConformanceWorld w) => FakeAuthRepository(
            accounts: <String, String>{AuthConformanceWorld.email: 'other'},
            clock: w.now,
          ),
        },
      );
      try {
        await (bodies.single as dynamic)();
      } on AuthConformanceFailure catch (e) {
        caught = e;
      }
      expect(caught.toString(), contains('expected network'));
    });
  });
}
