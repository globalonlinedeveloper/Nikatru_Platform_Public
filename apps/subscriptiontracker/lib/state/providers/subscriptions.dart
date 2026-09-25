// SECTION K of the spine — Subly's own product state: the typed API client,
// the subscription repository and the injectable wall clock the renewal
// calendar is rendered against. Re-exported from `../providers.dart`.
//
// The two account-deletion outcome holders that stood here are in `auth.dart`,
// with the erasure flow they report on.

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../../data/api/api_client.dart';
import '../../data/api/cached_api_client.dart';
import '../../data/api/dio_api_client.dart';
import '../../data/api/persisted_api_client.dart';
import '../../data/api/seed_api_client.dart';
import '../../data/local/subscription_store.dart';
import '../../data/subscriptions/subscription_repository.dart';
import 'auth.dart';
import 'config.dart';
import 'persistence.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION K · SUBLY'S OWN PRODUCT STATE (live-only, carried verbatim)
// ═════════════════════════════════════════════════════════════════════════════

/// API: real Worker via Dio when configured, else the seed client (demo mode),
/// with the DEVICE as that client's store.
/// The Dio base URL comes from the CFG-1 `api_base_url` (runtime, swappable with
/// no store release), falling back to the compile-time define until it resolves.
///
/// 🔴 THE UNCONFIGURED BRANCH KEPT NOTHING, AND IT IS THE BRANCH THAT SHIPS.
/// `SeedApiClient` holds its list and its budget in plain fields, and this
/// provider is not auto-dispose — so a subscription the user added survived
/// every navigation and died with the process, silently, on every build that
/// carries no `--dart-define=API_BASE_URL`. [PersistedApiClient] mirrors that
/// same client's working set into the device's key-value store; the client is
/// untouched and is still the one implementation of what a create or a cancel
/// MEANS, which is why this is a wrapper and not a flag.
///
/// 🔴 THE CONFIGURED BRANCH WAS THE ONE THAT SHIPS, AND IT HAD NO LOCAL COPY.
/// `catalog/apps.json` sets `api` for every real build, so the paragraph above
/// described the branch production never takes, and #590/#595 were inert in the
/// field. [CachedApiClient] now wraps the network client too: the Worker stays
/// the system of record and every write still goes to it first, but what it
/// last answered is mirrored into the same [LocalSubscriptionStore], and served
/// — only on a transport or 5xx failure — when it cannot be asked. It is a
/// read-through cache and NOT a write queue: an offline add fails honestly.
/// The decision is [apiClientFor], a pure function, so the configured branch
/// is provable under `flutter test` (which carries no `--dart-define`).
///
/// 🔴 `tokenProvider` TAKES [authTokenProvider], AND IT IS THE SAME RULE
/// [platformRestClientProvider] IS BUILT ON — read that block, which explains how
/// the identical tear-off there became a delete button that never sent a request
/// (#258). This line held `ref.watch(authRepositoryProvider).currentAccessToken`
/// until 2026-08-09, and nothing was broken by it YET: the loop was still OPEN,
/// because nothing inside [authRepositoryProvider]'s own closure reads this
/// provider. It was ONE EDIT from closing — measured, not argued, by adding a
/// single `ref.read(apiClientProvider)` to that closure and watching
/// `assert-provider-graph-acyclic.mjs` name the chain
/// `authRepositoryProvider --read--> apiClientProvider --watch-->
/// authRepositoryProvider`. With this line as it now stands, the same addition is
/// green. The note at [authRepositoryProvider] records that routing erasure
/// through a second client was CONSIDERED; had it been chosen against the old
/// line here, the same debug-only `CircularDependencyError` would have landed on
/// a second seam, and the four days would have been spent twice.
///
/// [authTokenProvider] is a type-identical drop-in — both are
/// `Future<String?> Function()` — and it is STRICTLY FRESHER: the tear-off binds
/// whichever repository instance existed when this provider built, while
/// [authTokenProvider] resolves the repository at CALL time. A hand-written
/// client belongs on this shape; the brick's `restClientProvider` already is, and
/// is why the brick never had this defect.
final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((ref) {
  final LocalSubscriptionStore store = ref.watch(
    localSubscriptionStoreProvider,
  );
  if (!AppConfig.isApiConfigured) {
    return PersistedApiClient(SeedApiClient(), store);
  }
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  final String baseUrl = apiBaseFor(
    pinned: AppConfig.pinnedBackend,
    configured: cfg?.apiBaseUrl,
    define: AppConfig.apiBaseUrl,
  );
  return cachedApiClientOver(
    DioApiClient(baseUrl: baseUrl, tokenProvider: ref.watch(authTokenProvider)),
    store,
  );
});

/// The API base URL [apiClientProvider] builds its client on.
///
/// 🔴 A PINNED BUILD TAKES THE DEFINE AND NEVER THE CONFIG DOCUMENT (F1, row
/// O-STORE-CAPTURE-WRITES-UNATTRIBUTED-ROWS). Unpinned, the CFG-1
/// `api_base_url` wins whenever a config document has resolved — including the
/// compiled seed `kAppDefaultConfig`, which names the PRODUCTION API and is what
/// resolves under `SKIP_REMOTE_CONFIG=true`. That is how a store capture given
/// a sandbox `API_BASE_URL` still wrote to production. `pinned` is
/// [AppConfig.pinnedBackend], which only the capture runner sets; a production
/// build is unpinned and behaves exactly as before. A pure function, so both
/// directions are provable under `flutter test`, which carries no define.
String apiBaseFor({
  required bool pinned,
  required String? configured,
  required String define,
}) => pinned ? '$define/v1' : (configured ?? '$define/v1');

/// The client the CONFIGURED posture gets: [network] behind the device cache.
///
/// 🔴 A NAMED FUNCTION SO THE PRODUCTION BRANCH IS TESTABLE.
/// `AppConfig.isApiConfigured` is a compile-time `String.fromEnvironment`, so
/// no `flutter test` can reach the branch above; the provider hands the
/// configured client to this function, which a test can call with a fake
/// network. `subscriptions_survive_restart_test.dart` proves the cache through
/// it AND reads this file to assert the provider's configured branch still
/// calls it — the two halves of one mutation proof: make this return
/// [network] bare, or make the provider return `DioApiClient` bare, and one of
/// them goes red.
@visibleForTesting
ApiClient cachedApiClientOver(
  ApiClient network,
  LocalSubscriptionStore store,
) => CachedApiClient(network, store);

final Provider<SubscriptionRepository> subscriptionRepositoryProvider =
    Provider<SubscriptionRepository>(
      (ref) => SubscriptionRepository(ref.watch(apiClientProvider)),
    );

// ── `purchasesServiceProvider` WAS HERE, AND IT IS GONE ON PURPOSE ──────────
// [pipeline 5]M-11/M-13/M-15, [ADR 026]. `lib/services/purchases/` held a
// RevenueCat-shaped stub: a `PurchasesService` whose `purchase()` returned
// `success: false`, whose `restore()` returned `false`, and whose offerings were
// hardcoded price literals — prices the owner replaced on 2026-07-27 and which
// nothing could contradict, because a hardcoded string is consistent with itself
// forever. The provider had zero consumers.
//
// It was REPLACED, not extended: its `PurchaseResult{isPro}` shape hands the
// unlock decision to the client, and this rail's whole design is that only the
// server grants. The real path lives in `packages/purchases` and is wired by
// `lib/state/money_providers.dart`, which reads [appConfigProvider],
// [authRepositoryProvider], [entitlementCacheProvider], [kPlatformBaseUrl] and
// the re-exported `analyticsProvider` from this file. See
// Private/decisions/026-purchases-adapter-replaces-revenuecat-stub.md.

/// The wall clock, injectable so a screen that renders "the month now falls in"
/// is testable at a KNOWN date.
///
/// 🔴 WHY THIS EXISTS. `CalendarScreen` renders the month `DateTime.now()` falls
/// in, while `demo_data.dart` holds FIXED renewal dates. That pair ROTS: with no
/// code change at all, `a11y_semantics_test` passed CI on 2026-08-31 and failed
/// on 2026-09-02 ("Expected: contains 'Notion'"; "Expected: <7> Actual: <2>"),
/// and `a11y/keyboard_sweep_test` lost its `/calendar` control count the same
/// way. A test that rots with the wall clock is not a test.
///
/// It is a PROVIDER and not only a widget parameter because `/calendar` is built
/// by the router, so a test that sweeps routes cannot pass a constructor
/// argument. `kSweptAs` in the keyboard sweep overrides this per route.
///
/// ⚠️ Production never overrides it, so behaviour is unchanged: the screen still
/// "renders identically today and correctly tomorrow".
final Provider<DateTime Function()> nowProvider = Provider<DateTime Function()>(
  (Ref ref) => DateTime.now,
);
