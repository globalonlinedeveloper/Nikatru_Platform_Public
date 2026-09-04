// SECTION D of the spine — the secure store, the resolved feature flags and
// the offline entitlement cache. Re-exported from `../providers.dart`.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show FlutterSecureStore;

import '../analytics_providers.dart';
import 'config.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION D · PERSISTENCE (G-2)
//
// ⚠️ `keyValueStoreProvider` AND `installIdProvider` ARE NOT DECLARED HERE.
// They live in `analytics_providers.dart` and are re-exported at the top of this
// file. Declaring a second pair would give this app two install ids and two
// prefs handles, which is the precise failure `analytics_providers.dart:27-34`
// records: two independently minted ids make the rollout bucket and the
// analytics cohort impossible to join, and it cannot be repaired across installs
// already in the field.
// ═════════════════════════════════════════════════════════════════════════════

/// Secure store (auth tokens, the entitlement cache).
final Provider<core.SecureStore> secureStoreProvider =
    Provider<core.SecureStore>((ref) => FlutterSecureStore());

/// Resolved feature flags for this install: the resolved config's rollout
/// percents bound to the persisted install id. Callers ask `.isOn('flag')`.
///
/// 🔴 THE TYPE IS [core.ObservedFeatureFlags], AND IT IS NOT AN UPGRADE — it is
/// the only way a rollout is measurable at all ([pipeline 11]E-12). A raw
/// `core.FeatureFlags` decides on/off locally and tells nobody, so the treatment
/// group can only ever be re-derived later from a rollout percentage that has
/// since moved: percents are not versioned, so once ramped the past is gone.
///
/// ⚠️ The `core.FeatureFlags` construction MUST stay inside the wrapper's
/// argument list. `tooling/ci/assert-flag-exposure.mjs` scans `apps/` (subly is
/// NOT exempt there) and fails the build on a raw one escaping.
final FutureProvider<core.ObservedFeatureFlags> featureFlagsProvider =
    FutureProvider<core.ObservedFeatureFlags>((ref) async {
      final core.AppConfig cfg = await ref.watch(appConfigProvider.future);
      final String id = await ref.watch(installIdProvider.future);
      return core.ObservedFeatureFlags(
        flags: core.FeatureFlags(rollouts: cfg.flags, stableId: id),
        analytics: await ref.watch(analyticsProvider.future),
      );
    });

/// The offline entitlement cache (SecureStore-backed): a paid user stays
/// unlocked across restarts; honours expires_at + a grace window (ADR 005).
/// Consumed by `lib/state/money_providers.dart`.
final Provider<core.EntitlementCache> entitlementCacheProvider =
    Provider<core.EntitlementCache>(
      (ref) => core.EntitlementCache(store: ref.watch(secureStoreProvider)),
    );
