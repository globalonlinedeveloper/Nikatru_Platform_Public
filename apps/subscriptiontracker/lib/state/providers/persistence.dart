// SECTION D of the spine — the secure store, the resolved feature flags and
// the offline entitlement cache. Re-exported from `../providers.dart`.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show FlutterSecureStore, ShareFileExporter;

import '../../data/local/subscription_store.dart';
import '../../data/models/subscription.dart' show Subscription;
import '../../data/portability/subscription_columns.dart';
import '../analytics_providers.dart';
import '../subscriptions_controller.dart' show subscriptionsControllerProvider;
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

/// ST-X1 (audit D2, D31) — hands an exported file to the platform: the share
/// sheet, a browser download, or a save dialog on linux
/// (`ExportCapabilities`). A seam so `test/settings_export_test.dart` can keep
/// the bytes the user would have received and parse them back.
final Provider<core.FileExporter> fileExporterProvider =
    Provider<core.FileExporter>((ref) => ShareFileExporter());

/// ST-X1 (audit D2/D31) — what the Settings "Export data (CSV)" row does: the
/// loaded list, as a CSV file (`subscription_columns.dart`), handed to
/// [fileExporterProvider].
///
/// NULL WHILE `features.exports` IS OFF — the flag config.dart advertised and
/// nothing read until this — which renders the row inert rather than removing
/// it: the row is what `data-safety.json`'s export declaration points at. It
/// lives here, not in the screen, because settings_screen.dart is a private
/// fork of a chassis file and may not grow (assert-chassis-parity).
///
/// A list that failed to load exports nothing, never an empty file that reads
/// like a user with no subscriptions. The exporter itself never throws.
void Function()? exportDataTap(WidgetRef ref) {
  final core.AppConfig cfg =
      ref.watch(appConfigProvider).valueOrNull ?? kAppDefaultConfig;
  if (!cfg.feature('exports')) return null;
  return () async {
    final core.FileExporter exporter = ref.read(fileExporterProvider);
    final List<Subscription> subs;
    try {
      subs = await ref.read(subscriptionsControllerProvider.future);
    } catch (_) {
      return;
    }
    await exporter.export(subscriptionsCsvFile(subs));
  };
}

/// Where the subscriptions and the budget live when no backend is configured —
/// which is the DEFAULT posture and what every unconfigured build ships as.
///
/// 🔴 IT IS THE KEY-VALUE STORE AND NOT THE SECURE ONE, deliberately. A
/// subscription list is not a secret, and `StorageCapabilities` records that on
/// Linux the secure store needs both an installed libsecret AND a running,
/// unlocked Secret Service daemon — "callers must treat a secure-store failure
/// as expected here". Putting the user's own list behind that condition would
/// make an ordinary desktop session lose it. `shared_preferences` has no such
/// condition on any of the six Flutter targets.
///
/// ⚠️ IT WATCHES `keyValueStoreProvider.future` RATHER THAN AWAITING IT, so this
/// stays a synchronous `Provider`. `apiClientProvider` is read synchronously all
/// over the app and must remain a `Provider`; `.future` is a stable object, so
/// watching it adds an ancestor edge without a rebuild when the store resolves.
/// The store itself resolves the future on first use, which is when the first
/// read happens anyway.
final Provider<LocalSubscriptionStore> localSubscriptionStoreProvider =
    Provider<LocalSubscriptionStore>(
      (ref) => LocalSubscriptionStore(ref.watch(keyValueStoreProvider.future)),
    );

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
/// argument list. `tooling/ci/assert-flag-exposure.mjs` scans `apps/` (subscriptiontracker is
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
