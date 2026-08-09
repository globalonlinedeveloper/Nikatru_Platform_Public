// Driver for the web integration_test run. `flutter drive` invokes this on the
// host VM; its onScreenshot callback receives the bytes captured by
// binding.takeScreenshot(...) in integration_test/app_test.dart and writes them
// to app/screenshots/, which the CI job uploads as an artifact.

import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

/// The token `tooling/e2e/consent_anon_id.mjs` greps out of the tee'd
/// `flutter drive` log when the response file is missing.
const String kConsentAnonIdToken = 'E2E_CONSENT_ANON_ID';

Future<void> main() async {
  await integrationDriver(
    onScreenshot:
        (
          String screenshotName,
          List<int> screenshotBytes, [
          Map<String, Object?>? args,
        ]) async {
          final File file = File('screenshots/$screenshotName.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(screenshotBytes);
          return true;
        },
    // 🔴 THE DEFAULT IS NOT DISPLACED BY THE CALLBACK ABOVE — MEASURED, NOT
    // ASSUMED. `responseDataCallback` and `onScreenshot` are independent named
    // parameters of `integrationDriver`, and the former defaults to
    // `writeResponseData` whether or not the latter is supplied (read out of
    // integration_test_driver_extended.dart in the installed SDK, Flutter 3.44).
    // So `build/integration_response_data.json` was always being written. It is
    // passed explicitly here because the suite now DEPENDS on that file: it
    // carries `consent_anon_id`, the only key the consent artifact this run
    // uploaded can be found by, and a dependency that rests on a default nobody
    // states is one a package upgrade can remove without a compile error.
    responseDataCallback: (Map<String, dynamic>? data) async {
      final Object? anonId = data?['consent_anon_id'];
      if (anonId is String && anonId.isNotEmpty) {
        // THIS process's stdout is `flutter drive`'s stdout, which e2e.yml tees
        // to ${RUNNER_TEMP}/drive.log. The app prints the same token from inside
        // the browser, where nothing reads it — see the note in app_test.dart's
        // exportConsentAnonId.
        stdout.writeln('$kConsentAnonIdToken=$anonId');
      }
      await writeResponseData(data);
    },
    // 🔴 ON A RED RUN TOO, AND THAT IS THE POINT OF SETTING IT. The default is
    // false: a failing suite writes no response file and prints no token. But
    // the teardown that deletes this run's consent artifact from production is
    // `if: always()`, and a night that fails AFTER the consent tap is exactly
    // the night that leaves a row behind — so the one path where the id is
    // hardest to recover is the one where it matters most. Nothing here can
    // turn a green run red: it only widens when the data is emitted.
    writeResponseOnFailure: true,
  );
}
