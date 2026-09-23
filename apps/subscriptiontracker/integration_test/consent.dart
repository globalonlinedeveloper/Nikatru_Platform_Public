// ─────────────────────────────────────────────────────────────────────────────
// consent.dart — WHICH INSTALL a live drive's consent row belongs to, told to
// the host. Shared by BOTH suites under integration_test/ (added 2026-09-23).
//
// Every live drive answers the DPDP prompt in a fresh browser profile, and the
// app uploads that answer to platform_db `consent_artifacts`, keyed by the
// install id and nothing else — the table deliberately carries no user id
// (services/platform/migrations/0002_analytics.sql). So the teardown can only
// remove the row if the drive TELLS the host which id it used:
//   · app_test.dart (the e2e nightly) → tooling/e2e/verify_consent.mjs and
//     tooling/e2e/purge.mjs, through tooling/e2e/consent_anon_id.mjs;
//   · store_screenshots_test.dart (the store capture) → the runner's ledger
//     (tooling/store/capture-play-screenshots.mjs), read by the same module's
//     `resolveCaptureConsentIds`, which purge.mjs deletes by.
//
// Until this file the store capture reported NOTHING, so its consent rows were
// written under `dev` and removed by nobody. ONE reader of the install id and
// ONE writer of the reportData keys, because two hand-written copies of either
// is how the capture and the nightly would come to disagree about a key name.
//
// The keys written here are read host-side by name; renaming one needs the
// same rename in tooling/e2e/consent_anon_id.mjs, and
// tooling/ci/test/consent-anon-id.test.mjs reads THIS file to hold that.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/state/analytics_providers.dart'
    show kInstallIdKey;

/// Polls the app's own prefs store for the install id — the `anon_id` every
/// consent artifact and analytics event is keyed by — and returns it, or null
/// when none was persisted within [timeout].
///
/// POLLED, BECAUSE THE WRITE RACES THE TAP. `installIdProvider` mints the id
/// and persists it inside the same un-awaited chain that uploads the consent
/// record, so it is normally on disk within a frame or two — and "normally" is
/// not a schedule.
///
/// `SharedPreferences.getInstance()` returns the SAME cached singleton the app
/// is writing through, so this reads the app's store rather than a second copy
/// of it that could never see the write.
///
/// [pump] is a callback because each suite pumps its own way: app_test.dart's
/// `guardedPump` is bound to its test epoch, the store suite's `pumpFor` is not.
Future<String?> pollInstallId({
  required Future<void> Function() pump,
  Duration timeout = const Duration(seconds: 10),
}) async {
  final PrefsKeyValueStore store = await PrefsKeyValueStore.create(
    appId: AppConfig.appId,
  );
  final DateTime end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    final String? id = await store.read(kInstallIdKey);
    if (id != null && id.isNotEmpty) return id;
    await pump();
  }
  return null;
}

/// Records what this drive did at the consent prompt into `reportData`, which
/// the driver hands to the host.
///
/// `prompt` is `'answered'` (recorded BEFORE the tap, so a drive that dies
/// after it still says a row may exist) or `'absent'` (the prompt never came,
/// so no row was written). `id` is the install id the answer was recorded
/// under.
///
/// 🔴 MERGED INTO reportData, NEVER ASSIGNED OVER IT. `binding.takeScreenshot`
/// accumulates into this same map (integration_test.dart: `reportData ??= {}`
/// then `reportData['screenshots'] ??= []`), and a screenshot may already have
/// been taken — so `reportData = {…}` would throw the screenshot list away on
/// its way past.
void publishConsent(
  IntegrationTestWidgetsFlutterBinding binding, {
  String? prompt,
  String? id,
}) {
  binding.reportData ??= <String, dynamic>{};
  if (prompt != null) binding.reportData!['consent_prompt'] = prompt;
  if (id != null) {
    binding.reportData!['consent_anon_id'] = id;

    // ⚠️ THIS LINE GOES TO THE BROWSER CONSOLE, NOT TO THE CI LOG, AND IT IS
    // KEPT ANYWAY. Measured against Flutter 3.44 on 2026-08-09: flutter_tools
    // does ask chromedriver for browser logs
    // (`goog:loggingPrefs` in drive/web_driver_service.dart), but nothing ever
    // reads them — flutter_driver consumes only the PERFORMANCE log, and only
    // for tracing — so this token cannot reach the tee'd drive log from inside
    // the app. It is here for a headed local run with devtools open. The
    // CI-visible copy of the same token is printed HOST-SIDE by
    // test_driver/integration_test.dart, out of the reportData set above.
    debugPrint('E2E_CONSENT_ANON_ID=$id');
  }
}
