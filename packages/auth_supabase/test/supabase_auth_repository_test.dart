import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// [G-43] The PRODUCTION identity adapter, driven directly.
///
/// 🔴 THERE WAS NO TEST OF THIS CLASS AT ALL. Every existing auth test drove
/// `InMemoryAuthRepository`, which enforces the expiry invariant that production
/// did not — so the suite proved the contract against the one implementation
/// that already honoured it, and the shipping one handed back expired tokens
/// with nothing red anywhere.
///
/// The `GoTrueClient` here is a real one with its network methods overridden:
/// subclassing keeps the seam honest (the repository still calls the SDK's own
/// API) while making the two things that matter observable — how many refreshes
/// actually left the process, and what the clock said when we decided.
void main() {
  group('SupabaseAuthRepository.currentAccessToken — expiry and refresh', () {
    // A fake clock, so expiry is a decision this test makes rather than
    // something it waits for. `Session.isExpired` reads the wall clock
    // internally, which is exactly why the repository does its own arithmetic.
    late DateTime now;
    DateTime clock() => now;

    setUp(() => now = DateTime.utc(2026, 8, 1, 12));

    test('a LIVE token is returned untouched, with no refresh', () async {
      final _FakeGoTrue g = _FakeGoTrue(
        session: _session('live', expiry: now.add(const Duration(hours: 1))),
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: clock,
      );

      expect(_label(await auth.currentAccessToken()), 'live');
      expect(g.refreshCalls, 0, reason: 'a valid token must not be refreshed');
    });

    // THE DEFECT. The old body was `_auth.currentSession?.accessToken`: an
    // expired JWT went out on the wire, the Worker answered 401, and the brick
    // turned that into a sign-out.
    test('an EXPIRED token is never handed back — it refreshes first',
        () async {
      final _FakeGoTrue g = _FakeGoTrue(
        session:
            _session('stale', expiry: now.subtract(const Duration(minutes: 5))),
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: clock,
      );

      final String? token = await auth.currentAccessToken();
      expect(_label(token), isNot('stale'),
          reason: 'the stale token must not escape');
      expect(_label(token), 'refreshed-1');
      expect(g.refreshCalls, 1);
    });

    // A token with two seconds left is worthless: the request carrying it takes
    // longer than that to reach the Worker, so it arrives expired.
    test('a token inside the skew window counts as expired', () async {
      final _FakeGoTrue g = _FakeGoTrue(
        session:
            _session('nearly', expiry: now.add(const Duration(seconds: 5))),
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: clock,
        refreshSkew: const Duration(seconds: 30),
      );

      expect(_label(await auth.currentAccessToken()), 'refreshed-1');
      expect(g.refreshCalls, 1);
    });

    test('time PASSING is what expires it — same session, two answers',
        () async {
      final _FakeGoTrue g = _FakeGoTrue(
        session: _session('live', expiry: now.add(const Duration(minutes: 10))),
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: clock,
      );

      expect(_label(await auth.currentAccessToken()), 'live');
      expect(g.refreshCalls, 0);

      // Nothing changed but the clock.
      now = now.add(const Duration(minutes: 11));
      expect(_label(await auth.currentAccessToken()), 'refreshed-1');
      expect(g.refreshCalls, 1);
    });

    test('no session at all means no token, and no refresh attempt', () async {
      final _FakeGoTrue g = _FakeGoTrue(session: null);
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: clock,
      );

      expect(await auth.currentAccessToken(), isNull);
      expect(g.refreshCalls, 0);
    });

    // Returning null rather than throwing is the contract the brick's
    // `onUnauthorized` reads: null means "the session really is gone", which is
    // the ONE case where signing the user out is the truthful action.
    test('a FAILED refresh reports null instead of throwing', () async {
      final _FakeGoTrue g = _FakeGoTrue(
        session:
            _session('stale', expiry: now.subtract(const Duration(minutes: 5))),
        failRefresh: true,
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: clock,
      );

      expect(await auth.currentAccessToken(), isNull);
      expect(g.refreshCalls, 1);
    });
  });

  // ── SINGLE-FLIGHT. ────────────────────────────────────────────────────────
  // Not an optimisation. gotrue INVALIDATES the old refresh token as it issues a
  // new one, so N concurrent refreshes mean N-1 callers presenting a token the
  // server has already retired — the session dies from being used correctly by
  // several screens at once, which is the normal shape of a resumed app.
  group('SupabaseAuthRepository.currentAccessToken — single-flight refresh',
      () {
    late DateTime now;
    setUp(() => now = DateTime.utc(2026, 8, 1, 12));

    test('five concurrent callers trigger exactly ONE refresh', () async {
      final Completer<void> gate = Completer<void>();
      final _FakeGoTrue g = _FakeGoTrue(
        session:
            _session('stale', expiry: now.subtract(const Duration(minutes: 5))),
        hold: gate.future,
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: () => now,
      );

      final List<Future<String?>> calls = <Future<String?>>[
        for (int i = 0; i < 5; i++) auth.currentAccessToken(),
      ];
      // All five are now parked inside the refresh. Release it.
      await Future<void>.delayed(Duration.zero);
      gate.complete();
      final List<String?> tokens = await Future.wait(calls);
      final List<String?> labels = tokens.map(_label).toList();

      expect(g.refreshCalls, 1,
          reason: 'the refresh must be shared, not repeated');
      // …and every caller must get the SAME new token. Five refreshes would
      // hand four of them a token the server had already retired.
      expect(labels, everyElement('refreshed-1'));
    });

    // The flight must END. A future cached forever would replay one token past
    // its own expiry — a "fix" that breaks in an hour instead of immediately.
    test('a LATER expiry refreshes again rather than replaying the first',
        () async {
      final _FakeGoTrue g = _FakeGoTrue(
        session:
            _session('stale', expiry: now.subtract(const Duration(minutes: 5))),
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: () => now,
      );

      expect(_label(await auth.currentAccessToken()), 'refreshed-1');
      // The fake issues a token that is itself already stale, so the next call
      // has to go again.
      expect(_label(await auth.currentAccessToken()), 'refreshed-2');
      expect(g.refreshCalls, 2);
    });
  });

  // ── G2. The deletion hook, which used to be null on every stamped app. ────
  group('SupabaseAuthRepository.deleteAccount', () {
    test('calls the injected server request, then signs out', () async {
      int called = 0;
      final _FakeGoTrue g = _FakeGoTrue(session: _session('live'));
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        requestServerDeletion: () async => called++,
      );

      await auth.deleteAccount();
      expect(called, 1, reason: 'the server must actually be asked');
      expect(g.signOutCalls, 1);
    });

    // The 501 the stamped route returns when it cannot delete the identity
    // record arrives here as a thrown ApiException. It must NOT read as success.
    test('a server refusal signs out AND throws — never a silent success',
        () async {
      final _FakeGoTrue g = _FakeGoTrue(session: _session('live'));
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        requestServerDeletion: () async =>
            throw StateError('501 account_deletion_unconfigured'),
      );

      await expectLater(auth.deleteAccount(), throwsA(isA<core.AuthFailure>()));
      expect(g.signOutCalls, 1,
          reason:
              'a user who asked to be deleted must not keep a live session');
    });

    test('with NO hook injected it refuses loudly rather than pretending',
        () async {
      final _FakeGoTrue g = _FakeGoTrue(session: _session('live'));
      final SupabaseAuthRepository auth = SupabaseAuthRepository(client: g);
      await expectLater(auth.deleteAccount(), throwsA(isA<core.AuthFailure>()));
    });
  });

  // ── [G-43] The session must LAND IN THE SECURE STORE. ────────────────────
  // The one line that keeps refresh tokens out of plaintext used to be
  // unreachable from a test (it sat inside `Supabase.initialize`, which needs
  // plugin channels), so a guard matching its text stood in for a test — and
  // that guard stayed green while the shipping app persisted its session in
  // shared_preferences.
  group('nikatruAuthOptions', () {
    test('the WRITE goes through SecureStore, not shared_preferences',
        () async {
      final core.SecureStore store = core.InMemorySecureStore();
      final sb.FlutterAuthClientOptions options = nikatruAuthOptions(
        secureStore: store,
      );

      final sb.LocalStorage? storage = options.localStorage;
      expect(storage, isNotNull,
          reason: 'a null localStorage IS the plaintext default');
      expect(storage, isA<SecureSessionStorage>());

      await storage!.persistSession('{"access_token":"t","refresh_token":"r"}');

      // The assertion that matters: the bytes are in the SECURE store.
      expect(
        await store.read(SecureSessionStorage.defaultKey),
        '{"access_token":"t","refresh_token":"r"}',
      );
      expect(await storage.accessToken(), contains('refresh_token'));
    });

    test('web-safe OAuth defaults survive: PKCE and URL detection', () {
      final sb.FlutterAuthClientOptions options = nikatruAuthOptions(
        secureStore: core.InMemorySecureStore(),
      );
      // The implicit flow puts the token in the URL, where history and
      // referrers can see it.
      expect(options.authFlowType, sb.AuthFlowType.pkce);
      // On web the OAuth token arrives in the URL FRAGMENT and the SDK reads it;
      // switching this off is a login that simply never completes.
      expect(options.detectSessionInUri, isTrue);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A REAL GoTrueClient with its two network-facing members overridden. Extending
// rather than reimplementing keeps the repository talking to the SDK's own API,
// so a rename in the SDK breaks this test instead of silently bypassing it.
// `autoRefreshToken: false` matters: the real constructor otherwise installs a
// periodic timer that outlives the test.
// ─────────────────────────────────────────────────────────────────────────────
class _FakeGoTrue extends sb.GoTrueClient {
  _FakeGoTrue({
    required this.session,
    this.failRefresh = false,
    this.hold,
  }) : super(autoRefreshToken: false);

  sb.Session? session;
  final bool failRefresh;

  /// Parks the refresh so several callers are in flight at once.
  final Future<void>? hold;

  int refreshCalls = 0;
  int signOutCalls = 0;

  @override
  sb.Session? get currentSession => session;

  @override
  Future<sb.AuthResponse> refreshSession([String? refreshToken]) async {
    refreshCalls++;
    if (hold != null) await hold;
    if (failRefresh) throw sb.AuthException('refresh_token_not_found');
    // Deliberately issued ALREADY STALE, so "did the flight end?" is
    // observable: a cached future would replay refreshed-1 forever.
    session = _session(
      'refreshed-$refreshCalls',
      expiry: DateTime.utc(2026, 8, 1, 11),
    );
    return sb.AuthResponse(session: session);
  }

  @override
  Future<void> signOut({sb.SignOutScope scope = sb.SignOutScope.local}) async {
    signOutCalls++;
    session = null;
  }
}

/// Reads the marker back out of a token produced by [_session].
///
/// The assertions compare LABELS rather than raw strings because the access
/// token has to be a real JWT: `Session.expiresAt` parses the `exp` claim out of
/// it, so a plain string like `'stale'` would report an unknown expiry and every
/// expiry test would silently pass by never deciding anything.
String? _label(String? jwt) {
  if (jwt == null) return null;
  final List<String> parts = jwt.split('.');
  if (parts.length < 2) return jwt;
  final Object? payload = jsonDecode(
    utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
  );
  return (payload as Map<String, dynamic>)['token'] as String?;
}

/// A session whose access token is a real (unsigned) JWT carrying [expiry] in
/// its `exp` claim — which is where `Session.expiresAt` reads it from, so an
/// `expires_in` shortcut would be testing something the SDK does not consult.
sb.Session _session(String token, {DateTime? expiry}) {
  final DateTime exp = expiry ?? DateTime.utc(2026, 8, 1, 13);
  String seg(Map<String, Object?> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final String jwt = '${seg(<String, Object?>{'alg': 'none'})}.'
      '${seg(<String, Object?>{
        'sub': 'user-1',
        'exp': exp.millisecondsSinceEpoch ~/ 1000,
        'token': token,
      })}.sig';
  return sb.Session(
    accessToken: jwt,
    refreshToken: 'refresh-$token',
    tokenType: 'bearer',
    user: sb.User(
      id: 'user-1',
      appMetadata: const <String, dynamic>{},
      userMetadata: const <String, dynamic>{},
      aud: 'authenticated',
      email: 'a@b.com',
      createdAt: '2026-08-01T00:00:00Z',
    ),
  );
}
