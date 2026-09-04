// SECTION E of the spine — the analytics envelope (launch lifecycle, the
// shared platform host, the version and platform stamped on every event).
// Re-exported from `../providers.dart`.

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../analytics_providers.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION E · ANALYTICS ENVELOPE + TRANSPORT HOSTS
//
// 🔴 WHAT IS NOT HERE, AND WHY. The chassis spine also declares
// `kPrivacyPolicyVersion`, `consentControllerProvider`, `analyticsConsentProvider`,
// `consentDecidedProvider`, `consentTransportProvider`, `applyConsentDecision`,
// `recordAnalyticsConsent` and `analyticsProvider`. Every one of them already
// exists in `analytics_providers.dart` — which the guards anchor — so they are
// re-exported, not re-declared.
//
// `logEvent` is deliberately NOT carried, and that is a decision with a date
// on it: `analytics_providers.dart:244-250` records it being DELETED from this
// app on 2026-08-01 for having zero call sites, because "a second, never-called
// path to the analytics rail inflates apparent coverage and is exactly what
// `assert-seams-wired` exists to stop being mistaken for a wiring".
// `logLaunchLifecycle` IS carried (below) — its one caller arrived with the
// P2.6a `app.dart` merge (`AnalyticsGate`'s granted branch), and the funnel's
// `onLaunch()` was deleted in the same increment so there is exactly ONE
// launch path, exactly one `app_open` per launch.
// ═════════════════════════════════════════════════════════════════════════════

/// Emit the launch trio — `first_launch` (once per INSTALL, ever), `app_open`
/// (every launch), `return_visit{days_since_last}` — via the chassis
/// [core.AnalyticsLifecycle], which owns the rule and the persistence so they
/// are ONE implementation for fifty stamps, testable without a widget tree.
/// Uses the same storage seam as everything else ([keyValueStoreProvider]) and
/// the SAME keys Subly's old `AnalyticsFunnel.onLaunch` used
/// (core/analytics_lifecycle.dart:9,:14), so an existing install does not
/// re-emit `first_launch` after the P2.6a swap.
///
/// ⚠️ CONSENT IS THE CALLER'S JOB, and its only caller is `AnalyticsGate`'s
/// granted branch. Do not call this anywhere a consent decision has not
/// already been granted — firing pre-consent burned the install's only
/// `first_launch` on an event the fail-closed recorder then discarded.
Future<void> logLaunchLifecycle(WidgetRef ref) async {
  final core.Analytics analytics = await ref.read(analyticsProvider.future);
  final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
  await core.AnalyticsLifecycle(analytics: analytics, store: kv).onLaunch();
}

/// The SHARED platform Worker: analytics ingest, the consent artifact, and the
/// money rail's entitlement + cancellation reads ([ADR 020]).
///
/// Deliberately NOT [AppConfig.apiBaseUrl] and deliberately NOT per-app — every
/// app in the portfolio posts to the same host, which is what makes one query
/// answer "is the portfolio working" instead of six.
///
/// ⚠️ SAME VALUE, SAME DEFINE as `AppConfig.platformBaseUrl`, which
/// `analytics_providers.dart` reads. The duplication is the chassis's shape and
/// is carried because `lib/state/money_providers.dart` reads THIS name — see
/// MANIFEST.md §7 for the convergence item.
const String kPlatformBaseUrl = String.fromEnvironment(
  'PLATFORM_BASE_URL',
  defaultValue: 'https://platform.nikatru.com',
);

/// The marketing version stamped on events, consent artifacts and crash reports.
///
/// Injected at BUILD time rather than read from `package_info_plus`, and that is
/// not a shortcut — it was measured. The plugin needs a platform round trip that
/// does NOT resolve inside a widget test's fake clock, so routing the consent
/// write through it made `recordAnalyticsConsent` hang forever. A version string
/// must never be able to block a consent decision. It also resolves on web,
/// where [packageVersionProvider] can legitimately return null.
const String kAnalyticsAppVersion = AppConfig.appVersion;

/// Which of the six platforms this build runs on, for the analytics envelope.
///
/// 🔴 `defaultTargetPlatform`, NOT `dart:io`'s `Platform`. See MANIFEST.md §8 —
/// `analytics_providers.dart:1` still imports `dart:io`, and whether that is
/// survivable on the web target is an OPEN QUESTION this merge does not settle.
String analyticsPlatformName() {
  if (kIsWeb) return 'web';
  return switch (defaultTargetPlatform) {
    TargetPlatform.android => 'android',
    TargetPlatform.iOS => 'ios',
    TargetPlatform.macOS => 'macos',
    TargetPlatform.windows => 'windows',
    TargetPlatform.linux => 'linux',
    TargetPlatform.fuchsia => 'fuchsia',
  };
}
