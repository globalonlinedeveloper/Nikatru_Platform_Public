// ─────────────────────────────────────────────────────────────────────────────
// The STEPS of the per-target native sign-in proof (ST-N1g), apart from the
// binding, so a local red run can drive the same step against a fake server.
//
// ⏱ 2026-09-28 · rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
// O-NATIVE-AUTH-CALLBACK-UNBUILT. Each step fails with WHAT IS ON SCREEN, so a
// red job on a device nobody can watch names the refusal it met.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// Pumps in short slices until [target] shows, tapping through first-run
/// screens that stand in its way, for at most [timeout].
Future<bool> pumpUntilShown(
  WidgetTester tester,
  Finder target, {
  Duration timeout = const Duration(seconds: 60),
  List<Finder> tapThrough = const <Finder>[],
}) async {
  final DateTime end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (target.evaluate().isNotEmpty) return true;
    for (final Finder f in tapThrough) {
      if (f.evaluate().isNotEmpty) {
        await tester.tap(f.first, warnIfMissed: false);
        break;
      }
    }
    await tester.pump(const Duration(milliseconds: 250));
    // Real I/O gets a turn: on a device binding runAsync just runs this; under
    // flutter_test's fake clock it is what lets a loopback answer land.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
  }
  return target.evaluate().isNotEmpty;
}

/// Every text on screen, for a failure message.
String onScreen() => find
    .byType(RichText)
    .evaluate()
    .map((Element e) => (e.widget as RichText).text.toPlainText())
    .where((String s) => s.trim().isNotEmpty)
    .take(40)
    .join(' | ');

/// Step 1: the REAL sign-in form signs [email] in, and [home] shows.
Future<void> proveFormSignIn(
  WidgetTester tester, {
  required String email,
  required String password,
  required Finder emailField,
  required Finder passwordField,
  required Finder submit,
  required Finder home,
  List<Finder> tapThrough = const <Finder>[],
  Duration timeout = const Duration(seconds: 60),
}) async {
  await tester.enterText(emailField, email);
  await tester.enterText(passwordField, password);
  await tester.pump(const Duration(milliseconds: 300));
  // A phone's keyboard or a short window can put the button below the fold.
  await tester.ensureVisible(submit);
  await tester.pump(const Duration(milliseconds: 300));
  await tester.tap(submit);
  final bool landed = await pumpUntilShown(
    tester,
    home,
    timeout: timeout,
    tapThrough: tapThrough,
  );
  expect(
    landed,
    isTrue,
    reason:
        'the sign-in form did not reach Home within ${timeout.inSeconds}s. '
        'On screen: ${onScreen()}',
  );
}

/// What GoTrue answered a gated call: `ok`, or the failure's code (else its
/// message). The proof prints it, so the run records what was MEASURED.
Future<String> answerOf(Future<Object?> Function() call) async {
  try {
    await call();
    return 'ok';
  } on core.AuthFailure catch (e) {
    return e.code ?? e.message;
  }
}

/// The line the native repository writes for a failed callback exchange.
const String kFailedResetCallbackLine =
    'nk_auth_callback flow=reset outcome=failed';

/// The line the proof prints when it is ready for the OS to open the callback.
/// The workflow waits for it before it fires the URL.
const String kAwaitCallbackMarker = 'NK_PROOF_AWAIT_CALLBACK';
