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

/// Pumps in short slices until [target] is gone, for at most [timeout].
Future<bool> pumpUntilGone(
  WidgetTester tester,
  Finder target, {
  Duration timeout = const Duration(seconds: 10),
}) async {
  final DateTime end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (target.evaluate().isEmpty) return true;
    await tester.pump(const Duration(milliseconds: 250));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
  }
  return target.evaluate().isEmpty;
}

/// Answers the DPDP analytics-consent prompt with [kConsentDecline] if it
/// shows within [timeout], and returns whether it did.
///
/// 🔴 THE ONLY PLACE THE PROOF ANSWERS IT, AND THE INSTALL ID IS PRINTED
/// BEFORE THE TAP. Either answer uploads a row to platform_db
/// `consent_artifacts`, keyed by the install id alone, so the teardown
/// (tooling/e2e/purge.mjs) can remove it only by that id. Printed first, a run
/// that dies after the tap still names its row; and because no other step taps
/// this control, a finished proof log with no [kConsentAnonIdToken] line shows
/// this run wrote no row (tooling/e2e/consent_anon_id.mjs, `proofLogConsent`).
/// [installId] reads the app's own `installIdProvider` — the id the upload
/// reads — from the prompt's context.
///
/// The prompt is an inline scrim over the whole app (the stamped
/// `_ConsentPrompt`), so until it closes every tap beneath it is swallowed:
/// proof run 36525783687 lost its Sign in tap to it on Android and Linux.
Future<bool> answerConsentPrompt(
  WidgetTester tester, {
  required Future<String> Function(BuildContext context) installId,
  Duration timeout = const Duration(seconds: 20),
}) async {
  final Finder decline = find.text(kConsentDecline);
  if (!await pumpUntilShown(tester, decline, timeout: timeout)) return false;
  expect(
    find.text('Allow'),
    findsWidgets,
    reason:
        '"$kConsentDecline" showed without "Allow" beside it — that is not '
        'the consent prompt this proof answers. On screen: ${onScreen()}',
  );
  final String? id = await tester.runAsync(
    () => installId(tester.element(decline.first)),
  );
  expect(
    id != null && id.isNotEmpty,
    isTrue,
    reason:
        'the install id did not resolve, so the consent row this answer '
        'writes could not be named for the teardown.',
  );
  debugPrint('$kConsentAnonIdToken=$id');
  await tester.pump(const Duration(milliseconds: 100));
  expect(
    decline.first.hitTestable(),
    findsOneWidget,
    reason:
        'the tap on "$kConsentDecline" would not land. '
        'On screen: ${onScreen()}',
  );
  await tester.tap(decline.first);
  expect(
    await pumpUntilGone(tester, decline),
    isTrue,
    reason:
        'the consent prompt did not close after "$kConsentDecline". '
        'On screen: ${onScreen()}',
  );
  debugPrint('NK_PROOF step=consent outcome=declined');
  return true;
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
  // 🔴 A TAP THAT WOULD NOT LAND IS A FAILURE, NOT A WARNING. Proof run
  // 36525783687 (Android, Linux) tapped Sign in through the DPDP consent scrim:
  // flutter_test printed "would not hit test", the tap went nowhere, and the
  // step spent 60 s waiting for a Home no request had been made for.
  expect(
    submit.hitTestable(),
    findsWidgets,
    reason:
        'the sign-in button is covered, so a tap on it would not land. '
        'On screen: ${onScreen()}',
  );
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

/// The consent prompt's decline control (chassis l10n `consentDecline`).
const String kConsentDecline = 'No thanks';

/// The token the host reads the consent row's install id by — the same token
/// tooling/e2e/consent_anon_id.mjs parses (`ANON_ID_TOKEN`).
const String kConsentAnonIdToken = 'E2E_CONSENT_ANON_ID';
