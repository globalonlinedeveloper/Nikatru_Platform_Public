// Host-side driver for the store screenshot capture.
//
// `flutter drive` runs this on the host VM; its onScreenshot callback receives
// the bytes WebDriver captured from the browser and writes them to disk.
//
// 🔴 THE OUTPUT DIRECTORY IS AN ENVIRONMENT VARIABLE AND HAS NO DEFAULT THAT
// POINTS AT THE LISTING. `integration_test.dart` (the nightly e2e driver)
// hardcodes `screenshots/`, which is right for a debugging artefact and wrong
// here: a demo-posture mechanism proof must not be able to land in
// apps/<app>/store/android-play/screenshots/ just because somebody invoked
// `flutter drive` directly. The runner decides where the bytes go — proof runs
// get a throwaway directory — and refuses to point a demo run at the listing.
// See tooling/store/capture-play-screenshots.mjs.

import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final String? outDir = Platform.environment['STORE_SHOT_DIR'];
  if (outDir == null || outDir.trim().isEmpty) {
    stderr.writeln(
      'STORE_SHOT_DIR is not set. This driver refuses to guess an output '
      'directory: the wrong guess writes a demo-posture capture into the live '
      'store listing. Run tooling/store/capture-play-screenshots.mjs instead of '
      'invoking flutter drive directly.',
    );
    exit(1);
  }

  await integrationDriver(
    onScreenshot:
        (
          String screenshotName,
          List<int> screenshotBytes, [
          Map<String, Object?>? args,
        ]) async {
          final File file = File('$outDir/$screenshotName.png');
          await file.parent.create(recursive: true);
          await file.writeAsBytes(screenshotBytes);
          stdout.writeln(
            'captured ${file.path} (${screenshotBytes.length} bytes)',
          );
          return true;
        },
  );
}
