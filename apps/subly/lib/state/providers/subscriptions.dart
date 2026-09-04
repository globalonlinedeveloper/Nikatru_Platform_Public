// SECTION K of the spine — Subly's own product state: the typed API client,
// the subscription repository and the injectable wall clock the renewal
// calendar is rendered against. Re-exported from `../providers.dart`.
//
// The two account-deletion outcome holders that stood here are in `auth.dart`,
// with the erasure flow they report on.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../../data/api/api_client.dart';
import '../../data/api/dio_api_client.dart';
import '../../data/api/seed_api_client.dart';
import '../../data/subscriptions/subscription_repository.dart';
import 'auth.dart';
import 'config.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION K · SUBLY'S OWN PRODUCT STATE (live-only, carried verbatim)
// ═════════════════════════════════════════════════════════════════════════════

/// API: real Worker via Dio when configured, else the seed client (demo mode).
/// The Dio base URL comes from the CFG-1 `api_base_url` (runtime, swappable with
/// no store release), falling back to the compile-time define until it resolves.
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
  if (!AppConfig.isApiConfigured) return SeedApiClient();
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  final String baseUrl = cfg?.apiBaseUrl ?? '${AppConfig.apiBaseUrl}/v1';
  return DioApiClient(
    baseUrl: baseUrl,
    tokenProvider: ref.watch(authTokenProvider),
  );
});

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
