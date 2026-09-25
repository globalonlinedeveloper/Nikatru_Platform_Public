import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show RestClient;
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // ───────────────────────────────────────────────────────────────────────────
  // ⏱ 2026-09-24 · O-BRICK-ERASURE-DESTROYS-THE-IDENTITY — THE ERASURE CLOSURE
  // NOW RESOLVES [platformRestClientProvider].
  //
  // Account deletion enters at the SHARED platform Worker, which deletes the
  // identity LAST after relaying to this app's own Worker for its rows. So
  // `authRepositoryProvider`'s erasure closure reads the PLATFORM client, and
  // that client must take its token through [authTokenProvider] — which only
  // READS the repository — or Riverpod's `ref.read` finds the reader among the
  // target's ancestors and throws `CircularDependencyError` (the live app's
  // defect #258: zero `/v1/account` requests, because none was ever formed).
  //
  // test/providers_test.dart holds the same shape for [restClientProvider],
  // which the rest of the app still uses. This file is the one about the client
  // deletion actually rides. The HOST that client is built on is held
  // statically by tooling/ci/assert-deletion-control.mjs limb 7, because
  // RestClient keeps its base URL private.
  //
  // ⚠️ WHY AN OVERRIDE: the live erasure closure only exists on the
  // `isBackendLive` branch and a `flutter test` takes no `--dart-define`s. An
  // override PRESERVES THE ORIGIN, which is the thing Riverpod's cycle check
  // looks at, so the same two providers are seen in the same direction.
  test('🔴 the erasure closure can resolve the PLATFORM client', () {
    late final RestClient Function() resolve;
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith(
          (Ref ref) async => core.InMemoryKeyValueStore(),
        ),
        authRepositoryProvider.overrideWith((Ref<core.AuthRepository> ref) {
          resolve = () => ref.read(platformRestClientProvider);
          return InMemoryAuthRepository();
        }),
      ],
    );
    addTearDown(c.dispose);
    c.read(authRepositoryProvider); // built, exactly as the app builds it
    expect(
      resolve,
      returnsNormally,
      reason:
          'authRepositoryProvider could not read platformRestClientProvider. If this is a '
          'CircularDependencyError, the platform client WATCHES the auth repository — take '
          'the token through authTokenProvider, which only READS it.',
    );
    expect(
      identical(resolve(), c.read(platformRestClientProvider)),
      isTrue,
      reason: 'it must resolve the app`s own platform client',
    );
  });

  test('the platform client is not the app Worker client', () {
    final ProviderContainer c = ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith(
          (Ref ref) async => core.InMemoryKeyValueStore(),
        ),
      ],
    );
    addTearDown(c.dispose);
    final RestClient platform = c.read(platformRestClientProvider);
    final RestClient app = c.read(restClientProvider);
    expect(
      identical(platform, app),
      isFalse,
      reason:
          'deletion and the Apple token go to the shared platform Worker; the '
          'app Worker client is a different host and must be a different client',
    );
  });
}
