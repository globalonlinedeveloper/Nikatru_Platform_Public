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
import 'package:url_launcher/url_launcher.dart' show LaunchMode, launchUrl;

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
  required Finder reacceptButton,
  required Finder reacceptTick,
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
  final DateTime end = DateTime.now().add(timeout);
  bool landed = false;
  while (!landed && DateTime.now().isBefore(end)) {
    landed = await pumpUntilShown(
      tester,
      home,
      timeout: const Duration(seconds: 2),
      tapThrough: tapThrough,
    );
    if (!landed && reacceptButton.evaluate().isNotEmpty) {
      await acceptUpdatedTerms(
        tester,
        accept: reacceptButton,
        tick: reacceptTick,
      );
    }
  }
  expect(
    landed,
    isTrue,
    reason:
        'the sign-in form did not reach Home within ${timeout.inSeconds}s. '
        'On screen: ${onScreen()}',
  );
}

/// The updated-terms interstitial a signed-in user must pass before Home:
/// tick the clickwrap box, then Accept and continue.
///
/// 🔴 THE TICK FIRST. The accept button is disabled until the box is ticked,
/// and a tap on a disabled button does nothing: proof run 36533541325 signed in
/// on iOS, macOS, Windows and Linux and then sat on "Our terms have changed"
/// for 60 s, tapping [accept] and nothing else. The e2e suite's
/// `acceptTermsIfShown` does the same two taps.
Future<void> acceptUpdatedTerms(
  WidgetTester tester, {
  required Finder accept,
  required Finder tick,
}) async {
  await tester.ensureVisible(tick.first);
  await tester.pump(const Duration(milliseconds: 300));
  expect(
    tick.first.hitTestable(),
    findsOneWidget,
    reason:
        'the updated-terms box cannot be ticked — a tap would not land. '
        'On screen: ${onScreen()}',
  );
  await tester.tap(tick.first);
  await tester.pump(const Duration(milliseconds: 300));
  await tester.ensureVisible(accept.first);
  await tester.pump(const Duration(milliseconds: 300));
  expect(
    accept.first.hitTestable(),
    findsOneWidget,
    reason:
        'the updated-terms accept button is covered. On screen: ${onScreen()}',
  );
  await tester.tap(accept.first);
  expect(
    await pumpUntilGone(tester, accept, timeout: const Duration(seconds: 30)),
    isTrue,
    reason:
        'accepting the updated terms did not leave the interstitial (is the '
        'box ticked, did the acceptance POST land?). On screen: ${onScreen()}',
  );
  debugPrint('NK_PROOF step=reaccept outcome=accepted');
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

/// Step 4 on iOS: the APP opens its own callback [url], so iOS delivers it
/// through the scene (`scene(_:openURLContexts:)` → app_links →
/// supabase_flutter), the path an email link takes.
///
/// 🔴 NOT `simctl openurl`. iOS holds a custom-scheme URL opened from outside
/// the app behind a system `Open in "<app>"?` sheet, and nothing on a runner
/// taps Open: proof run 36637965865's screenshot, 25 s after the open, showed
/// the sheet over the sign-in form, and the app never saw the URL. The launch
/// still resolves the scheme through the OS, so an unregistered one fails
/// here as `launched=false`.
Future<void> openCallbackFromApp(WidgetTester tester, String url) async {
  final bool? launched = await tester.runAsync(
    () => launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication),
  );
  debugPrint('NK_PROOF callback_opened_by=app launched=$launched');
  expect(
    launched,
    isTrue,
    reason:
        "iOS did not open the app's own callback URL — is its scheme in "
        'Info.plist CFBundleURLSchemes? On screen: ${onScreen()}',
  );
}

/// The line the native repository writes for a failed callback exchange.
const String kFailedResetCallbackLine =
    'nk_auth_callback flow=reset outcome=failed';

/// The line the proof prints when it is ready for the OS to open the callback.
/// The workflow waits for it before it fires the URL.
const String kAwaitCallbackMarker = 'NK_PROOF_AWAIT_CALLBACK';

/// ⏱ 2026-10-01 · AB-A1-02 — the line the native repository writes when an
/// OAuth RETURN reached the session exchange: supabase_flutter ran the PKCE
/// exchange for `nk_auth=oauth` (and it failed — no flow minted the code), and
/// the seam classed it by the deep link's marker. The same string
/// `tooling/e2e/native_auth_proof.mjs` `OAUTH_RETURN_LINE` requires.
const String kOAuthReturnCallbackLine =
    'nk_auth_callback flow=oauth outcome=failed';

/// What the OAuth-return suite prints once it has seen
/// [kOAuthReturnCallbackLine] — `OAUTH_RETURN_OK_LINE` in the drive.
const String kOAuthReturnOkLine = 'NK_PROOF step=oauth-return outcome=ok';

/// The consent prompt's decline control (chassis l10n `consentDecline`).
const String kConsentDecline = 'No thanks';

/// The token the host reads the consent row's install id by — the same token
/// tooling/e2e/consent_anon_id.mjs parses (`ANON_ID_TOKEN`).
const String kConsentAnonIdToken = 'E2E_CONSENT_ANON_ID';
