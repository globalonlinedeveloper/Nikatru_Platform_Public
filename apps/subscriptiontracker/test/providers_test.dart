import 'dart:async';

// `show` only, and FlutterError is here for the same reason it is in
// `state/providers/auth.dart`: this is the handler the app's telemetry
// bootstrap installs, so it is where a reported failure actually lands.
import 'package:flutter/foundation.dart'
    show FlutterError, FlutterErrorDetails, FlutterExceptionHandler;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
// `show` only: this package also exports a `SupabaseAuthRepository`, and so does
// Subly's own data layer — an unnarrowed import makes that name ambiguous.
import 'package:nikatru_api_client/nikatru_api_client.dart' show RestClient;
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  ProviderContainer harness() => ProviderContainer(
    overrides: <Override>[
      // Swap the real shared_preferences store for an in-memory one so the
      // wiring is testable without platform channels.
      keyValueStoreProvider.overrideWith(
        (Ref ref) async => core.InMemoryKeyValueStore(),
      ),
    ],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // THE DEFERRED-READ INVARIANT — one runtime witness per pair, next to the
  // static guard that covers the class (tooling/ci/assert-provider-graph-
  // acyclic.mjs).
  //
  // A provider whose body RESOLVES another provider later — the erasure closure,
  // a token callback, an onUnauthorized hook — is doing `ref.read`, and
  // `ref.read` runs an assert that walks the TARGET's watch/listen ancestors and
  // throws `CircularDependencyError` when it finds the reader. #258 was exactly
  // that pair, and it threw before dio was ever asked for anything: Cloudflare's
  // zone analytics recorded ZERO `/v1/account` requests for the whole live
  // delete leg, not even a preflight.
  //
  // ⚠️ IT IS AN ASSERT, SO IT IS DEBUG-ONLY. `--release` strips it, which is why
  // production looked healthy while every test run and the whole `flutter drive`
  // E2E threw. A test is therefore the RIGHT place for this — the tests are
  // where the defect exists.
  //
  // ⚠️ WHY AN OVERRIDE, and it is not a shortcut. The live erasure closure only
  // exists on the `isBackendLive` branch and a `flutter test` takes no
  // `--dart-define`s, so the shipping closure cannot be reached from here. What
  // CAN be reproduced exactly is the thing Riverpod checks: an element whose
  // ORIGIN is [authRepositoryProvider] reading the target after both exist. An
  // override preserves the origin. (First needed in delete_account_test.dart for
  // the same reason; generalised here to every pair rather than the one.)
  void expectResolvableFromAuthRepository<T>(
    T Function(Ref<core.AuthRepository> ref) resolve, {
    required String reason,
  }) {
    late final T Function() deferred;
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith(
          (Ref ref) async => core.InMemoryKeyValueStore(),
        ),
        authRepositoryProvider.overrideWith((Ref<core.AuthRepository> ref) {
          deferred = () => resolve(ref);
          return InMemoryAuthRepository();
        }),
      ],
    );
    addTearDown(c.dispose);
    c.read(authRepositoryProvider); // built, exactly as the app builds it
    expect(deferred, returnsNormally, reason: reason);
  }

  test('🔴 the erasure closure can resolve the PLATFORM client — the #258 pair', () {
    expectResolvableFromAuthRepository<RestClient>(
      (Ref<core.AuthRepository> ref) => ref.read(platformRestClientProvider),
      reason:
          'authRepositoryProvider could not read platformRestClientProvider. If this is a '
          'CircularDependencyError, something platformRestClientProvider WATCHES is the auth '
          'repository itself — take the token through authTokenProvider, which only READS it, so '
          'no ancestor edge is registered.',
    );
  });

  test('the erasure closure can resolve the CHASSIS client too', () {
    expectResolvableFromAuthRepository<RestClient>(
      (Ref<core.AuthRepository> ref) => ref.read(restClientProvider),
      reason:
          'restClientProvider is the second client on the same two-hop shape. It is not read by '
          'the erasure closure today, and this is what keeps that a choice rather than a trap.',
    );
  });

  // The regression witness for
  // apps/subscriptiontracker/lib/state/providers/subscriptions.dart:55, where
  // `ref.watch(authRepositoryProvider).currentAccessToken` survived #258.
  //
  // 🔴 THIS POINTER READ `providers.dart:1662` AND HAD ALREADY DRIFTED — the
  // spine split only made it visible. Re-walked 2026-09-04: line 1662 of the
  // pre-split file was inside `LegalAcceptanceController._hydrate`, a comment
  // about clobbering a user mid-read, and had nothing to do with this tear-off.
  // The claim was true and the number pointed somewhere else, which is the
  // failure `assert-sworn-store-files.mjs`'s limb 8 exists for and which no
  // guard covers here.
  //
  // ⚠️ ITS DEMONSTRATED FAILING CASE IS NOT THE :55 REVERT, and saying so is
  // the point. `apiClientProvider` returns `SeedApiClient()` before it watches
  // anything when `AppConfig.isApiConfigured` is false, and a `flutter test`
  // takes no `--dart-define`s — so under `flutter test` the tear-off line never
  // runs and reverting it leaves this GREEN (measured 2026-08-09, not assumed).
  // What DOES turn it red is the watch escaping the configured branch, which is
  // the shape a later edit would take. The :55 revert itself is caught by the
  // static guard, which reads the source rather than running it — the division
  // of labour this pair of checks exists for.
  test('the erasure closure can resolve the TYPED api client', () {
    expectResolvableFromAuthRepository<ApiClient>(
      (Ref<core.AuthRepository> ref) => ref.read(apiClientProvider),
      reason:
          'apiClientProvider became an ancestor of the auth repository. Its tokenProvider must be '
          'authTokenProvider, never a ref.watch(authRepositoryProvider) tear-off.',
    );
  });

  test('the token closure resolves with every client that watches it built', () async {
    final ProviderContainer c = harness();
    addTearDown(c.dispose);
    // Build the watchers FIRST, so authTokenProvider really has the ancestors
    // the app gives it before its own read runs.
    c.read(platformRestClientProvider);
    c.read(restClientProvider);
    final Future<String?> Function() token = c.read(authTokenProvider);
    expect(
      token,
      returnsNormally,
      reason:
          'the token closure could not resolve what it reads while both clients already had it '
          'as an ancestor. Whatever authTokenProvider reads must not be something that watches '
          'it back — routing the token through a CLIENT instead of the repository is the edit '
          'that closes this one, and it is this test`s measured failing case.',
    );
    await expectLater(token(), completes);
  });

  test('install id is generated, non-empty and stable across reads', () async {
    final ProviderContainer c = harness();
    addTearDown(c.dispose);
    final String id1 = await c.read(installIdProvider.future);
    final String id2 = await c.read(installIdProvider.future);
    expect(id1, isNotEmpty);
    expect(id1, id2); // persisted → stable across launches
  });

  test('featureFlags resolves; an unconfigured flag is off', () async {
    final ProviderContainer c = harness();
    addTearDown(c.dispose);
    final core.FeatureFlags flags = await c.read(featureFlagsProvider.future);
    expect(flags.isOn('not_configured'), isFalse);
  });

  // [pipeline 11]E-12. The chassis must hand out an OBSERVED flag set, not a
  // raw one: a raw `core.FeatureFlags` decides on/off locally and emits
  // nothing, so the rollout it serves can only be reconstructed from a percent
  // that has since moved. The type IS the guarantee here, and it is asserted
  // rather than assumed because every future stamped app inherits it.
  test('the flag set is OBSERVED, and a read marks the flag exposed', () async {
    final ProviderContainer c = harness();
    addTearDown(c.dispose);
    final core.ObservedFeatureFlags flags = await c.read(
      featureFlagsProvider.future,
    );
    expect(flags.exposedFlags, isEmpty);
    flags.isOn('some_rollout');
    expect(flags.exposedFlags, contains('some_rollout'));
  });

  test('entitlementCache is available', () {
    final ProviderContainer c = harness();
    addTearDown(c.dispose);
    expect(c.read(entitlementCacheProvider), isA<core.EntitlementCache>());
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⏱ 2026-09-22 · O-APPLE-KEEPER-NO-ONERROR — A ROUND THAT GAVE UP IS HEARD.
  //
  // 🔴 THE KEEPER HAS REPORTED THROUGH `onError` SINCE 2026-09-22 AND NOBODY WAS
  // PASSING ONE. `packages/core/test/account_deletion_test.dart` already proves
  // the keeper CALLS `onError` after the bound; what it cannot prove is that
  // THIS APP hands one in. That gap is the whole defect: when the shared
  // platform Worker's CORS list left out PUT, every web `PUT
  // /v1/account/apple-token` was refused at the preflight and the keeper gave up
  // in silence. It took a hand-run count of `apple_provider_tokens` — 0 rows on
  // a live Apple account — to notice, and by then those accounts could only
  // delete with nothing to revoke at Apple.
  //
  // So this drives the REAL provider, not the keeper: the only way for the
  // report to arrive is for `appleTokenKeeperProvider` to have passed
  // `onError`. Drop that one argument and this goes red with `Expected: <1>
  // Actual: <0>` — which is the red control this proof is worth.
  //
  // ⚠️ IT MAKES NO NETWORK CALL. `platformRestClientProvider` builds its
  // `RestClient` from [authTokenProvider], and the client awaits that token in a
  // dio `onRequest` interceptor — BEFORE a socket is opened. A token function
  // that throws therefore fails the send with no host, no port and no wait.
  // [appleTokenRetryDelaysProvider] is overridden to empty so the first failure
  // is the last one; the shipping delays would make this sit for twenty seconds.
  group('appleTokenKeeperProvider reports a round that gave up', () {
    // The token this fake session carries. Distinctive on purpose: every
    // assertion below that it is ABSENT is only worth something if it would
    // otherwise be present, and the failure text deliberately contains it.
    const String token = 'apple-refresh-SECRET';

    late List<FlutterErrorDetails> reported;

    setUp(() {
      reported = <FlutterErrorDetails>[];
      final FlutterExceptionHandler? previous = FlutterError.onError;
      FlutterError.onError = reported.add;
      addTearDown(() => FlutterError.onError = previous);
    });

    ProviderContainer keeperHarness(_AppleKeeperAuth auth) => ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith(
          (Ref ref) async => core.InMemoryKeyValueStore(),
        ),
        authRepositoryProvider.overrideWithValue(auth),
        // Fails the send before any socket, and puts the token in the failure
        // text so the redaction below is a real measurement.
        authTokenProvider.overrideWithValue(
          () async => throw StateError('no bearer in a test ($token)'),
        ),
        appleTokenRetryDelaysProvider.overrideWithValue(const <Duration>[]),
      ],
    );

    test('🔴 a failing send reaches the app error tracker', () async {
      final _AppleKeeperAuth auth = _AppleKeeperAuth(token);
      final ProviderContainer c = keeperHarness(auth);
      addTearDown(c.dispose);

      c.read(appleTokenKeeperProvider); // subscribe, as the root widget does
      auth.arrive(); // the sign-in that carries Apple's one token
      await pumpEventQueue();

      expect(
        reported,
        hasLength(1),
        reason:
            'the keeper gave up and the provider passed no onError — this is '
            'the 2026-09-22 defect, not a test artefact',
      );
      expect(reported.single.library, 'apple_token_keeper');
    });

    test('🔴 what it reports is a reason and a count, never the token', () async {
      final _AppleKeeperAuth auth = _AppleKeeperAuth(token);
      final ProviderContainer c = keeperHarness(auth);
      addTearDown(c.dispose);

      c.read(appleTokenKeeperProvider);
      auth.arrive();
      await pumpEventQueue();

      final String text = reported.single.exception.toString();
      expect(text, contains(core.AppleTokenNotKept.reason));
      // One attempt, because the retry list is empty here. The COUNT is what
      // separates "the server is down for everybody" from "this one account".
      expect(text, contains('attempts: 1'));
      // The token is not a parameter of `onError` and the failure's own words
      // are dropped, so neither route can carry it out.
      expect(text, isNot(contains(token)));
    });
  });
}

/// A signed-in account whose session carries Apple's refresh token, and nothing
/// else. [MockAuthRepository] supplies every other member of the seam.
class _AppleKeeperAuth extends MockAuthRepository {
  _AppleKeeperAuth(this.token);

  final String token;
  final StreamController<core.AuthUser?> _users =
      StreamController<core.AuthUser?>.broadcast();

  /// The sign-in landing — the one moment the token is ever offered.
  void arrive() => _users.add(const core.AuthUser(id: 'u1', email: 'a@b.test'));

  @override
  Stream<core.AuthUser?> authStateChanges() => _users.stream;

  @override
  Future<core.AuthSession?> currentSession() async =>
      core.AuthSession(accessToken: 'at', providerRefreshToken: token);
}
