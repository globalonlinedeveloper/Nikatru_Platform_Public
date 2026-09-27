// THE ONLY WAY THIS APP PHOTOGRAPHS A STORE FRAME — stamped by the app brick
// (O-SCREENSHOT-DRIVER-IS-ONE-APPS, 10b) in the shape of
// apps/subscriptiontracker/integration_test/store_capture_guard.dart, over this
// app's own types (nothing here imports app #1).
//
// 🔴 A capture signed in as the throwaway end-to-end account once put that
// account's address on a public Play listing (05-settings.png, 2026-08-05), and
// only a human opening the PNG caught it: nothing in the tree can read text out
// of an image. So every frame goes through [captureFrame], which reads the
// widget tree one instruction before the shutter and refuses a frame that shows
// the signed-in account. tooling/store/capture-suite-scan.mjs fails the build
// if this file stops declaring `captureFrame`, stops looking with
// `textContaining`, or stops refusing an empty set of forbidden strings, and if
// the suite calls the shutter any other way.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// The strings a store frame must not show: the address the suite signed in
/// with, and the session's own address. Never empty on a real run.
Set<String> accountIdentityNeedles({
  required String signedInWith,
  core.AuthUser? account,
}) {
  final Set<String> out = <String>{};
  void add(String? value) {
    final String trimmed = (value ?? '').trim();
    if (trimmed.isNotEmpty) out.add(trimmed);
  }

  add(signedInWith);
  add(account?.email);
  return out;
}

/// Photographs [frame] through [take] — or refuses, BEFORE any bytes exist.
///
/// Takes the shutter as a function, so a widget test can pass a recorder and
/// prove that a refused frame is a frame not taken.
Future<void> captureFrame({
  required Future<void> Function(String frame) take,
  required String frame,
  required Set<String> forbidden,
}) async {
  if (forbidden.isEmpty) {
    fail(
      'store capture REFUSED to photograph "$frame": the set of forbidden '
      'account strings is EMPTY, so the identity check would have examined the '
      'frame for nothing and passed it. The set is built from the address the '
      'suite signed in with, which is never empty on a real run.',
    );
  }
  final List<String> onScreen = forbidden
      .where(
        (String needle) => find
            .textContaining(needle, findRichText: true)
            .evaluate()
            .isNotEmpty,
      )
      .toList();
  if (onScreen.isNotEmpty) {
    fail(
      'store capture REFUSED to photograph "$frame": the frame carries the '
      'signed-in account on screen (${onScreen.join(', ')}). This frame would '
      'go on a public store listing. Photograph a screen that does not render '
      'the account, or stop capturing this one.',
    );
  }
  await take(frame);
}
