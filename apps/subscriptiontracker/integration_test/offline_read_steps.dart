// ─────────────────────────────────────────────────────────────────────────────
// THE OFFLINE READ, ON A REAL TARGET'S REAL STORE (AB-O1-05).
//
// One Dart persistence path serves every target — `CachedApiClient` over
// `LocalSubscriptionStore` over `PrefsKeyValueStore`, i.e. shared_preferences,
// whose backend differs per OS (localStorage, SharedPreferences XML,
// NSUserDefaults, a JSON file on Windows and Linux). The unit test
// test/subscriptions_survive_restart_test.dart proves the logic over an
// in-memory fake on ubuntu; nothing proved "the list survives with the network
// off" against any of those backends. This step does, wherever a drive runs it:
// the web leg (app_test.dart) and every native leg (native_auth_proof_test.dart,
// scheduled per target by e2e.yml's `native` job).
//
// THE SHAPE. The row was written ONLINE through the app's own provider chain
// (`apiClientProvider` → `cachedApiClientOver` → the live Worker), which mirrors
// what the server accepted into the platform store. Then a SECOND client is
// built the way a relaunch builds one — a new `LocalSubscriptionStore` over a
// new `PrefsKeyValueStore` handle — over a transport that cannot connect
// (a closed loopback port: a real connection refusal, status 0, not a fake).
// That client must still read the row back.
//
// 🔴 REMOVE THE CACHE WIRING AND THIS FAILS. Make `apiClientProvider` return
// the DioApiClient bare, or `cachedApiClientOver` return the network bare, and
// the online write mirrors nothing: the offline read finds no stored list and
// rethrows the transport failure. Make `CachedApiClient` stop falling back and
// the same happens.
//
// ⚠️ STATED LIMIT: the relaunch is in-process. The new store handle shares the
// shared_preferences instance cache with the running app, so what is proven is
// that the write went through the platform backend without refusal (a refused
// write raises LocalStoreWriteFailure and is counted, never silent) and that a
// fresh client with no network answers from it — not a cold process start.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show PrefsKeyValueStore;
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/api/dio_api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/state/providers.dart'
    show cachedApiClientOver;

/// A base no request can reach: port 9 (discard) on loopback, which nothing on
/// a runner or a device listens on. Every call fails at connect — status 0,
/// the failure `CachedApiClient.servesFromCacheFor` answers from the store.
const String kDeadApiBase = 'http://127.0.0.1:9/v1';

/// The line a native leg's driver reads back: tooling/e2e/native_auth_proof.mjs
/// requires it of every run whose proof suite prints it (`offlineReadDeclared`).
const String kOfflineReadOkLine = 'NK_PROOF step=offline-read outcome=ok';

/// "Relaunches" the list with the network dropped and returns what it read.
///
/// Throws the transport's [ApiException] when the device kept no list — the
/// red this step exists to show.
Future<List<Subscription>> readListWithNetworkOff() async {
  final core.KeyValueStore kv = await PrefsKeyValueStore.create(
    appId: AppConfig.appId,
  );
  final ApiClient offline = cachedApiClientOver(
    DioApiClient(baseUrl: kDeadApiBase, tokenProvider: () async => null),
    LocalSubscriptionStore(Future<core.KeyValueStore>.value(kv)),
  );
  return offline.getSubscriptions();
}

/// Asserts [seededName] is read back with the network off.
Future<void> expectListSurvivesOffline(String seededName) async {
  final List<Subscription> read;
  try {
    read = await readListWithNetworkOff();
  } on ApiException catch (e) {
    fail(
      'with the network off the list could not be read at all '
      '(status ${e.statusCode}): nothing was kept on this device, so the '
      'cache wiring (apiClientProvider → cachedApiClientOver → '
      'CachedApiClient) did not mirror the online write.',
    );
  }
  expect(
    read.map((Subscription s) => s.name),
    contains(seededName),
    reason:
        'with the network off the device store answered, but without the row '
        'written online: ${read.map((Subscription s) => s.name).toList()}',
  );
}
