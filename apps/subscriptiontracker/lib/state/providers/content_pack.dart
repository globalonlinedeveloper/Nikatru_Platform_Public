// SECTION B of the spine — the content-pack rail. Re-exported from
// `../providers.dart`; import that.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show FutureProviderFamily;
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show AssetContentPackSource;

import '../../core/app_config.dart';
import 'config.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION B · THE CONTENT-PACK RAIL ([pipeline 7]P-9 · [8]K-9 · [2]C-1)
//
// These three providers are the consumer half. They are deliberately separate
// so a test can replace the SOURCE (the bytes) without replacing the LOADER
// (the verification) — swapping the loader would assert that a fake returns
// what the fake was told to return.
//
// ⚠️ SUBLY'S POINTER IS `null` (see [kAppDefaultConfig]), so this rail is
// dormant IN THIS APP by configuration, not by wiring — and the pointer comes
// from the RESOLVED config, so the server can turn it on without a release.
// `test/chassis_properties_test.dart` proves the open path by overriding
// `appConfigProvider` with a pointer, not by relying on the compiled default.
// ⏱ 2026-09-28 · ST-X5 (audit B27): the REMOTE tier is what stays dormant.
// The bundled tier (`bundledContentPackSourceProvider`) now serves the service
// catalogue shipped in `assets/content_pack/`, offline, while the pointer is null.
// ═════════════════════════════════════════════════════════════════════════════

/// The Ed25519 verifier this build trusts (ADR 016).
///
/// Injected rather than defaulted inside the loader so the key pinning is
/// visible at the app layer — and so a test can prove the OPEN path with a
/// throwaway keypair. Production must never narrow or widen the pinned map.
final Provider<core.PackVerifier> packVerifierProvider =
    Provider<core.PackVerifier>((ref) => core.Ed25519PackVerifier());

/// Where pack bytes come from, or null when this app is configured with no pack.
///
/// Derived from the RESOLVED config rather than from [AppConfig], so the server
/// decides which pack a shipped binary reads.
final Provider<core.ContentPackSource?> contentPackSourceProvider =
    Provider<core.ContentPackSource?>((ref) {
      final core.AppConfig cfg =
          ref.watch(appConfigProvider).value ?? kAppDefaultConfig;
      final String? pointer = cfg.contentPack;
      if (pointer == null || pointer.isEmpty) return null;
      return DioContentPackSource(packBaseUrl: pointer);
    });

/// ST-X5 (audit B27) — the pack shipped INSIDE the binary, as a Flutter asset
/// (`assets/content_pack/`, built by tooling/content_pipeline from
/// examples/service-catalogue and held byte-for-byte by assert-pack-roundtrip).
/// Trusted because the store signed it with the app, which is why the loader
/// reads this tier without a signature check.
final Provider<core.ContentPackSource?> bundledContentPackSourceProvider =
    Provider<core.ContentPackSource?>(
      (ref) => AssetContentPackSource('assets/content_pack'),
    );

/// The loader itself — CONSTRUCTED here, which is the thing that had never
/// happened anywhere outside a test.
final Provider<core.ContentPackLoader> contentPackLoaderProvider =
    Provider<core.ContentPackLoader>(
      (ref) =>
          core.ContentPackLoader(verifier: ref.watch(packVerifierProvider)),
    );

/// The pack this app is currently serving, or null when it has none.
///
/// 🔴 NULL WHEN THE POINTER IS NULL, AND NULL AGAIN WHEN IT FLIPS TO ONE THAT
/// DOES NOT VERIFY. Both matter, and the second is the one a takedown depends
/// on ([pipeline 8]K-9): retiring a pack has to actually stop it being served,
/// within hours and without a store release. `ref.watch` on the config is what
/// makes that true — the pointer changing re-runs this provider.
///
/// `expectPackId` is the app's own id: the loader refuses a pack that is
/// perfectly valid and simply not ours.
///
/// ⏱ 2026-09-28 · ST-X5: "null when the pointer is null" above now reads
/// "the BUNDLED pack when the pointer is null" — null only when neither tier
/// verifies. A remote pack that fails still falls back, never serves.
final FutureProvider<core.ContentPack?> contentPackProvider =
    FutureProvider<core.ContentPack?>((ref) async {
      // ⏱ 2026-09-28 · ST-X5 (audit B27): the BUNDLED tier is passed too, so
      // a null pointer no longer means no pack — the remote tier stays dormant
      // and the pack shipped inside the binary serves, offline.
      final core.Result<core.ContentPack> r = await ref
          .watch(contentPackLoaderProvider)
          .load(
            expectPackId: AppConfig.appId,
            remote: ref.watch(contentPackSourceProvider),
            bundled: ref.watch(bundledContentPackSourceProvider),
          );
      // A failed load is NOT an error the app shows. The pack is optional
      // content; the app must run without it. What must never happen is a
      // failed load being served as though it succeeded.
      return r.fold((core.ContentPack p) => p, (core.Failure _) => null);
    });

/// ST-T9 (AD-03) — the service catalogue the add sheet's pick step searches,
/// typed from [contentPackProvider] with names in [locale] (falling back to
/// `en`). Null when no pack serves or the pack does not read as a catalogue:
/// the sheet then offers only "Add by hand", never a partial list.
///
/// A family by locale, not a read of the ambient one, so a Tamil sheet and
/// its golden name every service in Tamil without a global.
final FutureProviderFamily<core.ServiceCatalogue?, String>
serviceCatalogueProvider =
    FutureProvider.family<core.ServiceCatalogue?, String>((
      ref,
      String locale,
    ) async {
      final core.ContentPack? pack = await ref.watch(
        contentPackProvider.future,
      );
      if (pack == null) return null;
      return core.ServiceCatalogue.fromPack(
        pack,
        locale: locale,
      ).fold((core.ServiceCatalogue c) => c, (core.Failure _) => null);
    });
