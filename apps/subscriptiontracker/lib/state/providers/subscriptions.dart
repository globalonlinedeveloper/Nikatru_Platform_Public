// SECTION K of the spine — Subly's own product state: the typed API client,
// the subscription repository and the injectable wall clock the renewal
// calendar is rendered against. Re-exported from `../providers.dart`.
//
// The two account-deletion outcome holders that stood here are in `auth.dart`,
// with the erasure flow they report on.

import 'package:flutter/foundation.dart'
    show FlutterError, FlutterErrorDetails, visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';
// FutureProviderFamily moved to misc.dart in Riverpod 3.0.
import 'package:flutter_riverpod/misc.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_core/nikatru_core.dart' show OutboxEntry;

import '../../core/app_config.dart';
import '../../data/api/api_client.dart';
import '../../data/api/cached_api_client.dart';
import '../../data/api/dio_api_client.dart';
import '../../data/api/persisted_api_client.dart';
import '../../data/api/seed_api_client.dart';
import '../../data/local/subscription_store.dart';
import '../../data/models/payment_record.dart';
import '../../data/models/price_change.dart';
import '../../data/models/spend_history.dart';
import '../../data/models/subscription.dart';
import '../../data/subscriptions/subscription_repository.dart';
import '../settings_controller.dart' show currencyCodeProvider;
import '../subscriptions_controller.dart' show subscriptionsControllerProvider;
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
/// read-through cache, and since 2026-09-30 (audit D22) an add made offline is
/// queued in its outbox and replayed idempotently instead of failing.
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
  // ✅ HO-10: the base URL is FOLLOWED, never watched. This watched the
  // config document, which resolves after the first list read,
  // so every cold launch rebuilt this client, the repository and the list —
  // two `GET /v1/subscriptions` per launch. [followApiBase] reads the base
  // once and moves the SAME client when the config names another.
  late final DioApiClient network;
  final String baseUrl = followApiBase(
    ref,
    decide: (String? configured) => apiBaseFor(
      pinned: AppConfig.pinnedBackend,
      configured: configured,
      define: AppConfig.apiBaseUrl,
    ),
    rebase: (String next) => network.rebase(next),
  );
  // The client itself is needed inside its own 401 handler (to drop its copy
  // on that sign-out path); `late` because the handler runs only after it exists.
  late final ApiClient client;
  return client = cachedApiClientOver(
    network = DioApiClient(
      baseUrl: baseUrl,
      tokenProvider: ref.watch(authTokenProvider),
      // ✅ ST-U7 (D20): a 401 on the list is asked whether the session is GONE,
      // and if it is the session is signed out — which the router's auth gate
      // turns into /sign-in. Without this an expired or revoked session (e.g.
      // "Log out of all devices" on another device) left the list saying
      // "Check your connection" forever. The SAME decision the chassis client
      // makes (`restClientProvider`): a token that merely expired while offline
      // is not a signed-out user. `read` inside the closure, never `watch`.
      onUnauthorized: () => signOutOnlyIfSessionIsGone(
        ref.read(authRepositoryProvider),
        // The same ordered helper every sign-out runs; the queue is KEPT on a
        // forced 401, for this user's return.
        onSignedOut: () => forgetSignedInUser(
          offlineStateDrops(
            api: client,
            store: store,
            owner: null,
            discardQueue: false,
          ),
        ),
      ),
      // ST-C1: a currency-less row is read in the user's currency, asked at
      // decode time. `read` inside the closure, not `watch` here: a currency
      // change must not rebuild the client and drop its cache.
      currencyCode: () => ref.read(currencyCodeProvider),
    ),
    store,
    // D19: a list answered from the copy is STATE a surface can mark ("showing
    // your last synced copy"); the stale banner itself is ST-D1 D1-5.
    onStaleChanged: (bool stale) =>
        ref.read(staleReadProvider.notifier).report(stale: stale),
    // D24: the copy was answered without waiting on the connect timeout and the
    // request carried on; when it lands, the list reads again. `read` and
    // `invalidate` inside closures, never `watch`: no edge back to this client.
    onRevalidated: () => ref.invalidate(subscriptionsControllerProvider),
    // Review #1075 finding 1: every queued write belongs to the user signed in
    // when it was made, and only that user's session ever sends it. Read at
    // call time (inside the closure), so an account switch is seen at once.
    currentUser: () => ref.read(authRepositoryProvider).currentUser?.id,
    onOutboxChanged: () => ref.invalidate(syncProblemsProvider),
  );
});

/// The signed-in user's writes that could not sync — refused by the server,
/// or failed too often (review #1075 finding 9; the ruling's dead-letter
/// state). The shell shows them with Retry and Discard.
final FutureProvider<List<OutboxEntry>> syncProblemsProvider =
    FutureProvider<List<OutboxEntry>>((ref) async {
      final ApiClient api = ref.watch(apiClientProvider);
      return api is CachedApiClient
          ? await api.syncProblems()
          : const <OutboxEntry>[];
    });

/// Whether the list on screen is the device's copy rather than the server's
/// answer — true only after a read was served from the cache (audit D19).
class StaleReadController extends Notifier<bool> {
  @override
  bool build() => false;

  /// Reported by the cache on every change, in both directions.
  void report({required bool stale}) {
    if (state != stale) state = stale;
  }
}

/// See [StaleReadController]. ST-D1 D1-5 draws the banner from this.
final NotifierProvider<StaleReadController, bool> staleReadProvider =
    NotifierProvider<StaleReadController, bool>(StaleReadController.new);

/// Where a failed cache write goes in production: the crash sink.
///
/// 🔴 AB-O2-03. The production wiring passed no `onCacheWriteFailed`, so a
/// failed mirror reached only `debugPrint` — which a release build discards —
/// and "my list did not survive restart" had no cause anyone could read. It is
/// reported now, with the store key and the store's own error: no row content
/// is ever part of either. NAMED so a test can drive exactly this function.
void reportCacheWriteFailure(Object error) {
  FlutterError.reportError(
    FlutterErrorDetails(
      exception: StateError('subscriptions cache write failed: $error'),
      library: 'subscriptions_cache',
    ),
  );
}

/// The base URL [decide] gives the config document now, with [rebase] called
/// on every later change — the ONE way a client provider learns its base
/// (HO-10). [decide] is the caller's, so the host decision (`apiBaseFor`,
/// L-PIN) stays visible in the provider that owns the client.
///
/// 🔴 `listen`, NOT `watch`. A watch makes the caller REBUILD on the config
/// resolve, and a rebuilt client is a rebuilt repository and a second list
/// read on every cold launch. A listen keeps the caller and moves its client;
/// a resolve that leaves the base unchanged moves nothing.
/// NAMED so `one_list_fetch_test.dart` drives exactly this function across a
/// resolve with a counting fake.
String followApiBase(
  Ref ref, {
  required String Function(String? configured) decide,
  required void Function(String baseUrl) rebase,
}) {
  String now = decide(ref.read(appConfigProvider).value?.apiBaseUrl);
  ref.listen<String?>(
    appConfigProvider.select(
      (AsyncValue<core.AppConfig> c) => c.value?.apiBaseUrl,
    ),
    (String? _, String? configured) {
      final String next = decide(configured);
      if (next == now) return;
      now = next;
      rebase(next);
    },
  );
  return now;
}

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
  LocalSubscriptionStore store, {
  void Function(bool stale)? onStaleChanged,
  void Function()? onRevalidated,
  void Function(Object error) onCacheWriteFailed = reportCacheWriteFailure,
  String? Function()? currentUser,
  void Function()? onOutboxChanged,
}) => CachedApiClient(
  network,
  store,
  onCacheWriteFailed: onCacheWriteFailed,
  onStaleChanged: onStaleChanged,
  onRevalidated: onRevalidated,
  currentUser: currentUser,
  onOutboxChanged: onOutboxChanged,
);

final Provider<SubscriptionRepository> subscriptionRepositoryProvider =
    Provider<SubscriptionRepository>(
      (ref) => SubscriptionRepository(ref.watch(apiClientProvider)),
    );

/// One subscription's payment history — ST-U7 (B16).
///
/// The detail screen read this through a `FutureBuilder` fired on EVERY
/// rebuild, and rendered `snap.data ?? const []`: loading and failure both
/// became "No payments yet." — a false statement about a record of real
/// charges. A provider gives the screen the three states apart and one fetch
/// per subscription, and `invalidate` is its retry.
///
/// ⚠️ NOT `autoDispose`, measured: disposing it when the detail screen leaves
/// schedules riverpod's zero-length disposal timer, which is still pending when
/// a widget test's tree is torn down (`!timersPending` in two
/// dark_group_detail cases). A history is a handful of rows per subscription.
final FutureProviderFamily<List<PaymentRecord>, String> paymentHistoryProvider =
    FutureProvider.family<List<PaymentRecord>, String>(
      (ref, String id) => ref.watch(subscriptionRepositoryProvider).history(id),
    );

/// One row's price edits, newest first (DE-05) — the timeline merges these
/// with [paymentHistoryProvider]. Not cached, for the same reason.
final FutureProviderFamily<List<PriceChange>, String> priceHistoryProvider =
    FutureProvider.family<List<PriceChange>, String>(
      (ref, String id) =>
          ref.watch(subscriptionRepositoryProvider).priceHistory(id),
    );

/// Every charge and price edit over the last year — ST-P6 (round-2 F23, the
/// trend) and ST-I4 (round-2 X09, the price-rise alert).
///
/// It WATCHES the list's PRICE-BEARING PROJECTION ([_historyKey]: which plans
/// are live, and what each costs), so an edit that moves a price (and writes
/// its `price_change` row in the same batch) or removes a plan re-reads the
/// history, and the rise shows without a restart. A rename, a note or a
/// loading flip of the same rows does not: watching the whole list cost two
/// SELECTs on every optimistic update.
///
/// 🔴 NULL, NOT AN ERROR, WHEN THE READ FAILS — and not an empty history
/// either. Null is "unknown": Insights hides the trend and draws no rise, and
/// never a row of empty bars that reads as "you spent nothing". It is caught
/// here rather than surfaced because this read is an ENRICHMENT of a screen
/// that stands without it, and an error state would arm riverpod's retry
/// backoff on every Insights visit while offline. The next list change
/// re-reads it.
final FutureProvider<SpendHistory?> spendHistoryProvider =
    FutureProvider<SpendHistory?>((ref) async {
      ref.watch(
        subscriptionsControllerProvider.select(
          (AsyncValue<List<Subscription>> v) => _historyKey(v.value),
        ),
      );
      try {
        return await ref.watch(subscriptionRepositoryProvider).spendHistory();
      } catch (_) {
        return null;
      }
    });

/// What `GET /v1/insights` depends on, from the list: each live plan's id and
/// exact price. Null while no list has loaded.
String? _historyKey(List<Subscription>? rows) {
  if (rows == null) return null;
  final List<String> keys = <String>[
    for (final Subscription s in rows)
      if (s.deletedAt == null)
        '${s.id}:${s.price.minorUnits}${s.price.currencyCode}',
  ]..sort();
  return keys.join(',');
}

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
///
/// ✅ HO-04: IT IS RE-READ AT LOCAL MIDNIGHT. A screen left open overnight
/// said "Renews tomorrow" about a charge that was now due today, until
/// something else rebuilt it. Home schedules [untilLocalMidnight] and
/// invalidates this provider when it lands, so every reader rebuilds on the
/// new day. A FRESH CLOSURE per evaluation, so the invalidation is a change
/// its readers see (a tear-off of `DateTime.now` is equal to the last one).
///
/// 🔴 THE TIMER IS NOT IN HERE, deliberately: a provider-owned timer outlives
/// every widget test whose container is disposed at teardown, and fails each
/// with `!timersPending`. A widget's timer dies with the widget.
final Provider<DateTime Function()> nowProvider = Provider<DateTime Function()>(
  (Ref ref) =>
      () => DateTime.now(),
);

/// How long from [now] until the next LOCAL midnight — calendar arithmetic,
/// so a daylight-saving day is as long as it really is. At least a second, so
/// a tick that lands a hair early cannot spin.
Duration untilLocalMidnight(DateTime now) {
  final DateTime local = now.toLocal();
  final DateTime next = DateTime(local.year, local.month, local.day + 1);
  final Duration d = next.difference(local);
  return d < const Duration(seconds: 1) ? const Duration(seconds: 1) : d;
}
