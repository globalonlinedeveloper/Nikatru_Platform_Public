// Driver for the web integration_test run. `flutter drive` invokes this on the
// host VM; its onScreenshot callback receives the bytes captured by
// binding.takeScreenshot(...) in integration_test/app_test.dart and writes them
// to app/screenshots/, which the CI job uploads as an artifact.

import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  await integrationDriver(
    onScreenshot: (
      String screenshotName,
      List<int> screenshotBytes, [
      Map<String, Object?>? args,
    ]) async {
      final File file = File('screenshots/$screenshotName.png');
      await file.parent.create(recursive: true);
      await file.writeAsBytes(screenshotBytes);
      return true;
    },
  );
}
