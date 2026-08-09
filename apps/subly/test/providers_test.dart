import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
// `show` only: this package also exports a `SupabaseAuthRepository`, and so does
// Subly's own data layer — an unnarrowed import makes that name ambiguous.
import 'package:nikatru_api_client/nikatru_api_client.dart' show RestClient;
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/data/api/api_client.dart';
import 'package:subly/state/providers.dart';

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

  // The regression witness for apps/subly/lib/state/providers.dart:1450, where
  // `ref.watch(authRepositoryProvider).currentAccessToken` survived #258.
  //
  // ⚠️ ITS DEMONSTRATED FAILING CASE IS NOT THE :1450 REVERT, and saying so is
  // the point. `apiClientProvider` returns `SeedApiClient()` before it watches
  // anything when `AppConfig.isApiConfigured` is false, and a `flutter test`
  // takes no `--dart-define`s — so under `flutter test` the tear-off line never
  // runs and reverting it leaves this GREEN (measured 2026-08-09, not assumed).
  // What DOES turn it red is the watch escaping the configured branch, which is
  // the shape a later edit would take. The :1450 revert itself is caught by the
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
}
