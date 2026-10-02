// HO-10 · SV-04 — ONE LIST FETCH PER LAUNCH, AND A TRUE ERROR.
//
// 🔴 HO-10. `apiClientProvider` WATCHED `appConfigProvider`, and the config
// document resolves AFTER the first list read. So a cold launch built the
// client, read the list, resolved the config, rebuilt the client — and with it
// the repository and the list — and read it again: two `GET /v1/subscriptions`
// for one launch. The configured branch sits behind a compile-time define no
// `flutter test` can set, so the proof is in two halves, as
// `subscriptions_survive_restart_test.dart` does it: [followApiBase] — the
// function the provider now calls — is driven across a real resolve with a
// counting fake, and the provider's source is read to assert it calls that
// function and watches nothing config-shaped.
//
// 🔴 SV-04. `RestClient.decode` mapped a malformed 2xx to `ApiException(0,…)`;
// 0 is the transport marker, so the list said "Check your connection" about a
// server that had answered.
import 'dart:async';
import 'dart:io' show File;

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/dio_api_client.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/shared/async_gate.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

/// A seed client that counts list reads and records every base it is moved to.
class _CountingApi extends SeedApiClient {
  int gets = 0;
  final List<String> bases = <String>[];

  @override
  Future<List<Subscription>> getSubscriptions() {
    gets++;
    return super.getSubscriptions();
  }
}

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Answers every request 200 with [body].
class _OkAdapter implements HttpClientAdapter {
  _OkAdapter(this.body);
  final String body;
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async => ResponseBody.fromString(
    body,
    200,
    headers: <String, List<String>>{
      Headers.contentTypeHeader: <String>[Headers.jsonContentType],
    },
  );
  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    '🔴 HO-10: a counting fake sees exactly ONE list GET across a config resolve',
    () async {
      final Completer<core.AppConfig> config = Completer<core.AppConfig>();
      final _CountingApi api = _CountingApi();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
          appConfigProvider.overrideWith((Ref ref) => config.future),
          // The production shape: the base FOLLOWED through the named
          // function, never watched.
          apiClientProvider.overrideWith((Ref ref) {
            followApiBase(
              ref,
              decide: (String? configured) => apiBaseFor(
                pinned: false,
                configured: configured,
                define: 'https://define.test',
              ),
              rebase: api.bases.add,
            );
            return api;
          }),
        ],
      );
      addTearDown(c.dispose);
      final ProviderSubscription<AsyncValue<List<Subscription>>> keep = c
          .listen(subscriptionsControllerProvider, (_, _) {});
      addTearDown(keep.close);

      await c.read(subscriptionsControllerProvider.future);
      expect(api.gets, 1, reason: 'the cold read');

      // The config document lands, naming its own API base.
      config.complete(kAppDefaultConfig);
      await c.read(appConfigProvider.future);
      await Future<void>.delayed(Duration.zero);
      await c.read(subscriptionsControllerProvider.future);

      expect(
        api.gets,
        1,
        reason: 'a config resolve must not rebuild the client and re-read',
      );
      expect(api.bases, <String>[
        kAppDefaultConfig.apiBaseUrl,
      ], reason: 'the SAME client is moved to the resolved base');
      expect(identical(c.read(apiClientProvider), api), isTrue);
    },
  );

  test('🔴 HO-10: the provider follows the base and watches no config', () {
    final String src = File(
      'lib/state/providers/subscriptions.dart',
    ).readAsStringSync();
    final int start = src.indexOf('apiClientProvider = Provider<ApiClient>');
    final String body = src.substring(start, src.indexOf('\n});', start));
    expect(body, contains('followApiBase('));
    expect(body, isNot(contains('ref.watch(appConfigProvider')));
    expect(body, contains('apiBaseFor('), reason: 'L-PIN: the host decision');
  });

  test('a DioApiClient is moved in place by rebase', () {
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://a.test/v1',
      tokenProvider: () async => null,
    );
    client.rebase('https://b.test/v1');
    expect(client.baseUrl, 'https://b.test/v1');
  });

  test(
    '🔴 SV-04: a malformed body says "server problem", never "offline"',
    () async {
      final Dio dio = Dio()
        ..httpClientAdapter = _OkAdapter('{"unexpected": true}');
      final DioApiClient client = DioApiClient(
        baseUrl: 'https://example.test/v1',
        tokenProvider: () async => null,
        httpClient: dio,
      );
      Object? error;
      try {
        await client.getSubscriptions();
      } catch (e) {
        error = e;
      }
      expect(error, isA<ApiException>());
      final ApiException e = error! as ApiException;
      expect(e.isOffline, isFalse);
      expect(ApiException.isOfflineError(e), isFalse);
      expect(e.statusCode, greaterThanOrEqualTo(500));

      final AppLocalizations l10n = lookupAppLocalizations(const Locale('en'));
      expect(dataFailedBodyFor(l10n, e), l10n.dataFailedServer);
      expect(dataFailedBodyFor(l10n, e), isNot(l10n.dataFailedBody));
    },
  );
}
