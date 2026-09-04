// SECTION B of the spine — the content-pack rail. Re-exported from
// `../providers.dart`; import that.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

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
final FutureProvider<core.ContentPack?> contentPackProvider =
    FutureProvider<core.ContentPack?>((ref) async {
      final core.ContentPackSource? source = ref.watch(
        contentPackSourceProvider,
      );
      if (source == null) return null;
      final core.Result<core.ContentPack> r = await ref
          .watch(contentPackLoaderProvider)
          .load(expectPackId: AppConfig.appId, remote: source);
      // A failed load is NOT an error the app shows. The pack is optional
      // content; the app must run without it. What must never happen is a
      // failed load being served as though it succeeded.
      return r.fold((core.ContentPack p) => p, (core.Failure _) => null);
    });
