// Runs around EVERY test file under apps/subscriptiontracker/test (Flutter
// picks up the nearest flutter_test_config.dart and calls [testExecutable]).
//
// With `NIKATRU_TEST_NOW` unset — every pull request, every local run — it does
// nothing but run the file. With it set, `wallClock` (the seam behind
// `nowProvider`) starts at that instant, so the weekly time-travel run executes
// this suite on another day. See test/support/test_clock.dart.

import 'dart:async';
import 'dart:io' show Platform;

import 'support/test_clock.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  installTestClock(Platform.environment);
  await testMain();
}
