import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show RestClient;
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

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
  // THE DEFERRED-READ INVARIANT — born into every stamped app, because this is
  // the shape all fifty are born with.
  //
  // `authRepositoryProvider`'s erasure closure RESOLVES [restClientProvider]
  // after both exist, and [restClientProvider] takes its token through
  // [authTokenProvider] — which only READS the repository, so no ancestor edge is
  // registered. That two-hop shape is why the brick never had defect #258.
  //
  // 🔴 apps/subly DID, because its platform client was written by hand
  // afterwards with `ref.watch(authRepositoryProvider).currentAccessToken`, and
  // Riverpod's `ref.read` walks the TARGET's watch/listen ancestors and throws
  // `CircularDependencyError` when it finds the reader. The delete button threw
  // before a request was ever formed; Cloudflare's zone analytics recorded ZERO
  // `/v1/account` requests for the whole live leg.
  //
  // ⚠️ IT IS AN ASSERT, SO IT IS DEBUG-ONLY — release strips it and works, every
  // debug run and the whole `flutter drive` E2E does not. The correct shape being
  // correct is exactly why nothing here would have gone red on its own; that is
  // what this test is for. The CLASS is covered statically by
  // tooling/ci/assert-provider-graph-acyclic.mjs, which reads this template.
  //
  // ⚠️ WHY AN OVERRIDE: the live erasure closure only exists on the
  // `isBackendLive` branch and a `flutter test` takes no `--dart-define`s. An
  // override PRESERVES THE ORIGIN, which is the thing Riverpod's cycle check
  // looks at, so the same two providers are seen in the same direction.
  test('🔴 the erasure closure can resolve its REST client', () {
    late final RestClient Function() readAsTheErasureClosureDoes;
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith(
          (Ref ref) async => core.InMemoryKeyValueStore(),
        ),
        authRepositoryProvider.overrideWith((Ref<core.AuthRepository> ref) {
          readAsTheErasureClosureDoes = () => ref.read(restClientProvider);
          return InMemoryAuthRepository();
        }),
      ],
    );
    addTearDown(c.dispose);
    c.read(authRepositoryProvider); // built, exactly as the app builds it
    expect(
      readAsTheErasureClosureDoes,
      returnsNormally,
      reason:
          'authRepositoryProvider could not read restClientProvider. If this is a '
          'CircularDependencyError, restClientProvider WATCHES the auth repository — take the '
          'token through authTokenProvider, which only READS it, so no ancestor edge exists.',
    );
    expect(
      identical(readAsTheErasureClosureDoes(), c.read(restClientProvider)),
      isTrue,
      reason: 'it must resolve the app`s own client, not a second one',
    );
  });

  test('the token closure resolves with the client that watches it built', () async {
    final ProviderContainer c = harness();
    addTearDown(c.dispose);
    // Build the watcher FIRST, so authTokenProvider really carries the ancestors
    // the app gives it before its own read runs.
    c.read(restClientProvider);
    final Future<String?> Function() token = c.read(authTokenProvider);
    expect(
      token,
      returnsNormally,
      reason:
          'the token closure could not resolve what it reads while the client already had it as '
          'an ancestor. Whatever authTokenProvider reads must not be something that watches it '
          'back — routing the token through the CLIENT instead of the repository is the edit '
          'that closes this one.',
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
