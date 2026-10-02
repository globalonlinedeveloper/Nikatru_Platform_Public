// SECTION C of the spine — the force-update kill-switch. Re-exported from
// `../providers.dart`; import that.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_telemetry/nikatru_telemetry.dart'
    show SentryTelemetryClient;
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/app_config.dart';
import 'config.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION C · FORCE-UPDATE KILL-SWITCH
// ═════════════════════════════════════════════════════════════════════════════

/// The running app version (e.g. "1.2.0"), or null when it can't be read — the
/// floor then fails OPEN, and core's `readInstalledVersion` reports that null to
/// the crash sink, once (O-FORCE-UPDATE-VERSION-READ-UNPROVEN). Never throws.
final FutureProvider<String?> packageVersionProvider = FutureProvider<String?>(
  (ref) => core.readInstalledVersion(
    () async => (await PackageInfo.fromPlatform()).version,
    channel: AppConfig.releaseChannel,
    report: const SentryTelemetryClient().captureMessage,
  ),
);

/// Whether the running version is below the CFG-1 `min_supported_version` floor
/// (the force-update kill-switch). Fails OPEN (false) while either the config or
/// the version is still resolving, so a slow load never blocks the app behind
/// the update wall.
final Provider<bool> mustForceUpdateProvider = Provider<bool>((ref) {
  final core.AppConfig? cfg = ref.watch(appConfigProvider).value;
  final String? version = ref.watch(packageVersionProvider).value;
  if (cfg == null || version == null) return false;
  return core.mustForceUpdate(version, cfg.minSupportedVersion);
});
