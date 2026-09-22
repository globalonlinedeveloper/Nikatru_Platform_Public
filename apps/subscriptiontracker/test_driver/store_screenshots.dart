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

import 'dart:convert';
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
    // ── 🔴 THE SUITE'S `reportData` LANDS WHERE THE RUNNER CAN READ IT ───────
    //
    // WHY THIS EXISTS. The suite now reads the board out of the running app —
    // `activeCount`, the monthly total in minor units, the row names — because
    // that is what `01-home.png` shows in words no guard in this tree can read:
    // nothing here decodes TEXT from a PNG, so `6 active` versus `12 active`
    // was only ever catchable by a human opening two files and counting rows.
    // That is how the doubled tablet set of 9f548515 (#854) was found, and it
    // is not a check.
    //
    // The default callback is `writeResponseData`, which writes
    // `build/integration_response_data.json` — ONE path, in the APP directory,
    // overwritten by the second viewport's drive. Two viewports sharing one
    // output file is the exact shape of the bug this instrument was added to
    // catch, so the path comes from the runner and is one per viewport.
    //
    // 🔴 AND NOT INTO THE LISTING DIRECTORY, which is what the header above is
    // about. `$outDir` is the SET's directory: what the workflow `git add -f`s
    // onto a review branch and what `assert-listing-assets.mjs` reads. The
    // runner's pre-drive clean deletes `*.png` from it and nothing else, so a
    // record written there would also survive a later run that produced none
    // and be read as that run's.
    //
    // ⚠️ THE RUNNER READS IT AND THE RUNNER DECIDES. This callback only writes.
    // `capture-play-screenshots.mjs` folds the record into each set's
    // CAPTURE.json and FAILS the run when the two viewports report different
    // boards — a driver that judged would judge one viewport at a time, and one
    // viewport cannot see a divergence between two.
    //
    // Unset means this driver was invoked by hand rather than through the
    // runner. That is not an error — the frames are still the point — it is
    // printed, and the runner refuses to compare viewports it has no record for
    // rather than reading absence as agreement.
    //
    // `null` data is a real case and is written as one: a `--proof` run is a
    // demo build, skips the seeding block entirely, and publishes no `board`
    // key. The file is still written, so "the drive produced no record" and
    // "the drive produced a record with no board in it" are different states on
    // disk rather than the same missing file.
    responseDataCallback: (Map<String, dynamic>? data) async {
      final String? boardPath = Platform.environment['STORE_BOARD_FILE'];
      if (boardPath == null || boardPath.trim().isEmpty) {
        stdout.writeln(
          'STORE_BOARD_FILE is not set — no board record was written. Run '
          'tooling/store/capture-play-screenshots.mjs, which sets it per '
          'viewport and compares the two records.',
        );
        return;
      }
      final File file = File(boardPath);
      await file.parent.create(recursive: true);
      await file.writeAsString('${jsonEncode(data ?? <String, dynamic>{})}\n');
      stdout.writeln('board record: ${file.path}');
    },
    // A drive that FAILED is the run whose board record is worth most — "the
    // capture stopped because the board held twelve rows" is the sentence, and
    // it is unreadable if the record is only written on success. Same lesson as
    // the workflow's `if: failure()` frame upload, which exists because two
    // failed runs threw their pixels away.
    writeResponseOnFailure: true,
  );
}
