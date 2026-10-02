// ─────────────────────────────────────────────────────────────────────────────
// ST-N1g — THE PER-TARGET NATIVE SIGN-IN PROOF, run by
// .github/workflows/native-auth-proof.yml on each target's own device against
// PRODUCTION auth, as the provisioned throwaway user (tooling/e2e/
// provision_user.mjs; purged by tooling/e2e/purge.mjs).
//
// ⏱ 2026-09-28 · rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
// O-NATIVE-AUTH-CALLBACK-UNBUILT. Before ST-T7 every native sign-in answered
// `captcha_failed`: Box C captchas the password grant and no store build
// carries a site key (ADR 084). The steps:
//   0. the DPDP consent prompt is declined, its install id printed FIRST so
//      tooling/e2e/purge.mjs removes the row it writes (run 36525783687);
//   1. the REAL form signs the user in, and Home shows;
//   1b. (AB-O1-05) a row written online is read back with the network off,
//      from this target's own shared_preferences backend
//      (offline_read_steps.dart), printed as NK_PROOF step=offline-read;
//   2. sign-up with the (already registered) address and a reset for an
//      unregistered one both answer WITHOUT `captcha_failed`, and neither sends
//      mail — what GoTrue answered is printed as measured;
//   3. sign out;
//   4. (NK_PROOF_CALLBACK=true) the proof prints NK_PROOF_AWAIT_CALLBACK, the
//      workflow has the OS open
//      com.nikatru.<app>://auth-callback?nk_auth=reset&code=st-n1-invalid, and
//      the dead-link sentence shows with the line
//      `nk_auth_callback flow=reset outcome=failed`.
//
// The brick carries the same file (tooling/bricks/app/__brick__/apps/{{app_id}}
// /integration_test/), keyed on the chassis sign-in screen; this copy reads
// this app's own keys.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_chassis_screens/shell/web_semantics.dart'
    show releaseWebSemantics;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/features/auth/legal_consent_fields.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/auth/reaccept_terms_screen.dart';
import 'package:subscriptiontracker/features/auth/reset_password_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/main.dart' as app;
import 'package:subscriptiontracker/state/providers.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'flow_steps.dart';
import 'native_auth_proof_steps.dart';
import 'offline_read_steps.dart';

const String _email = String.fromEnvironment('E2E_EMAIL');
const String _password = String.fromEnvironment('E2E_PASSWORD');
const bool _awaitCallback = bool.fromEnvironment('NK_PROOF_CALLBACK');
// iOS: the URL the APP opens itself (tooling/e2e/native_auth_proof.mjs,
// appOpensCallback); empty where the host's OS opens it.
const String _openFromApp = String.fromEnvironment('NK_PROOF_OPEN_FROM_APP');
// How this leg gets its session (tooling/e2e/native_auth_proof.mjs --sign-in):
// `form` — the real form (desktop, and every target that can sign in on a
// hosted runner); `token` — the harness-minted one-time token, where the form's
// route needs an attestation no hosted emulator or simulator can produce (ADR
// no.NNN). The driver refuses a `form` leg whose output carries the token line.
const String _signInVia = String.fromEnvironment(
  'NK_PROOF_SIGN_IN',
  defaultValue: 'form',
);
const String _tokenHash = String.fromEnvironment('E2E_TOKEN_HASH');
// Android: the host taps the reminder (native_auth_proof.mjs --notification-tap).
const bool _notificationTap = bool.fromEnvironment('NK_PROOF_NOTIFICATION_TAP');
// `run` walks the core flow and the tap; anything else PARKS them, said
// (native_auth_proof.mjs --pending-flows; lead ruling on #1143).
const String _pendingFlows = String.fromEnvironment('NK_PROOF_PENDING_FLOWS');

/// A wall-clock pump that lets real I/O land, for the flow steps.
Future<void> _pumpFor(WidgetTester tester, Duration total) async {
  final DateTime end = DateTime.now().add(total);
  while (DateTime.now().isBefore(end)) {
    await tester.pump(const Duration(milliseconds: 100));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('ST-N1 native sign-in proof', (WidgetTester tester) async {
    expect(
      _email.isNotEmpty && _password.isNotEmpty,
      isTrue,
      reason: 'E2E_EMAIL / E2E_PASSWORD are not defined by the workflow.',
    );
    final List<String> log = <String>[];
    final DebugPrintCallback original = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) log.add(message);
      original(message, wrapWidth: wrapWidth);
    };
    final ErrorWidgetBuilder builderBeforeTest = ErrorWidget.builder;
    try {
      await app.main();

      // 0 ── the DPDP consent prompt, answered HERE and nowhere else, before
      // anything under its scrim is touched (answerConsentPrompt says why).
      Future<String> installId(BuildContext context) =>
          ProviderScope.containerOf(context).read(installIdProvider.future);
      bool consentAnswered = await answerConsentPrompt(
        tester,
        installId: installId,
      );
      final List<Finder> firstRun = <Finder>[find.text('Skip')];
      expect(
        await pumpUntilShown(
          tester,
          find.byKey(E2EKeys.loginEmail),
          tapThrough: firstRun,
        ),
        isTrue,
        reason: 'the sign-in form never showed. On screen: ${onScreen()}',
      );
      consentAnswered =
          consentAnswered ||
          await answerConsentPrompt(
            tester,
            installId: installId,
            timeout: const Duration(seconds: 5),
          );
      if (!consentAnswered) debugPrint('NK_PROOF step=consent outcome=absent');

      // 1 ── the real form, the real route — or, where that route needs an
      // attestation a hosted runner cannot produce, the harness token, said so.
      if (_signInVia == 'token') {
        expect(
          _tokenHash.isNotEmpty,
          isTrue,
          reason: 'NK_PROOF_SIGN_IN=token and no E2E_TOKEN_HASH was defined.',
        );
        await tester.runAsync(
          () => sb.Supabase.instance.client.auth.verifyOTP(
            type: sb.OtpType.magiclink,
            tokenHash: _tokenHash,
          ),
        );
        bool home = false;
        final DateTime end = DateTime.now().add(const Duration(seconds: 60));
        while (!home && DateTime.now().isBefore(end)) {
          home = await pumpUntilShown(
            tester,
            find.byType(HomeScreen),
            timeout: const Duration(seconds: 2),
            tapThrough: firstRun,
          );
          if (!home &&
              find
                  .byKey(ReacceptTermsScreen.acceptButton)
                  .evaluate()
                  .isNotEmpty) {
            await acceptUpdatedTerms(
              tester,
              accept: find.byKey(ReacceptTermsScreen.acceptButton),
              tick: find.byKey(LegalConsentFields.termsCheckbox),
            );
          }
        }
        expect(
          home,
          isTrue,
          reason:
              'the harness session did not reach Home. On screen: ${onScreen()}',
        );
        debugPrint('NK_PROOF step=session outcome=ok via=harness-token');
      } else {
        await proveFormSignIn(
          tester,
          email: _email,
          password: _password,
          emailField: find.byKey(E2EKeys.loginEmail),
          passwordField: find.byKey(E2EKeys.loginPassword),
          submit: find.byKey(E2EKeys.loginSubmit),
          home: find.byType(HomeScreen),
          reacceptButton: find.byKey(ReacceptTermsScreen.acceptButton),
          reacceptTick: find.byKey(LegalConsentFields.termsCheckbox),
          tapThrough: firstRun,
        );
        debugPrint('NK_PROOF step=sign-in outcome=ok');
      }

      final ProviderContainer container = ProviderScope.containerOf(
        tester.element(find.byType(HomeScreen).first),
      );

      // 1b ── the list survives with the network off, on THIS target's store
      // (AB-O1-05; offline_read_steps.dart). Online first, through the app's
      // own client: one read so the device holds a list, then a row the live
      // Worker accepts and the cache mirrors. Before sign-out, which clears it.
      final String seeded =
          'Offline proof ${DateTime.now().millisecondsSinceEpoch}';
      await tester.runAsync(() async {
        final SubscriptionRepository repo = container.read(
          subscriptionRepositoryProvider,
        );
        await repo.fetchAll();
        await repo.add(
          Subscription(
            id: '',
            name: seeded,
            category: 'AI tools',
            price: const Money(100, 'USD'),
            cycle: BillingCycle.monthly,
            nextRenewal: DateTime.now().add(const Duration(days: 30)),
          ),
        );
        await expectListSurvivesOffline(seeded);
      });
      debugPrint(kOfflineReadOkLine);

      // 1c ── the core flow (XP-02), through the UI, read back from the
      // server: add a weekly plan → read it back → edit its price → pause
      // (status chip) → delete → Undo → delete (flow_steps.dart).
      // 1d ── the notification tap (Android): one minute out, tapped by the
      // host, landing on /sub/<id>.
      // ⏱ 2026-10-02 · PARKED unless NK_PROOF_PENDING_FLOWS=run: red on all
      // five targets in dispatch 36987269922 (O-E2E-CORE-FLOW-LEGS-PENDING).
      if (_pendingFlows == 'run') {
        await walkCoreFlow(tester, _pumpFor);
        if (_notificationTap) await proveNotificationTap(tester, _pumpFor);
      } else {
        debugPrint(kCoreFlowPendingLine);
      }

      // 2 ── the other gated calls, answered without the captcha.
      final core.AuthRepository auth = container.read(authRepositoryProvider);
      final int ts = DateTime.now().millisecondsSinceEpoch;
      final String signUp = await answerOf(
        () =>
            auth.signUpWithEmail(email: _email, password: 'St-N1-not-this-$ts'),
      );
      final String recover = await answerOf(
        () => auth.sendPasswordReset('st-n1-unregistered-$ts@nikatru.com'),
      );
      debugPrint('NK_PROOF step=sign-up-registered answer=$signUp');
      debugPrint('NK_PROOF step=recover-unregistered answer=$recover');
      expect(signUp, isNot('captcha_failed'));
      expect(recover, isNot('captcha_failed'));

      // 3 ── sign out.
      await auth.signOut();
      expect(
        await pumpUntilShown(tester, find.byKey(E2EKeys.loginEmail)),
        isTrue,
        reason:
            'sign-out did not return to the sign-in form. '
            'On screen: ${onScreen()}',
      );
      debugPrint('NK_PROOF step=sign-out outcome=ok');

      // 4 ── the OS delivers an unusable callback.
      if (_awaitCallback) {
        debugPrint(kAwaitCallbackMarker);
        if (_openFromApp.isNotEmpty) {
          await openCallbackFromApp(tester, _openFromApp);
        }
        expect(
          await pumpUntilShown(
            tester,
            find.byKey(ResetPasswordScreen.linkDeadLine),
            timeout: const Duration(seconds: 180),
          ),
          isTrue,
          reason:
              'the callback did not reach the dead-link sentence. '
              'On screen: ${onScreen()}',
        );
        expect(log, contains(kFailedResetCallbackLine));
        debugPrint('NK_PROOF step=callback outcome=ok');
      }
    } finally {
      debugPrint = original;
      ErrorWidget.builder = builderBeforeTest;
      // main() holds a semantics handle on web; the harness must release it
      // (web_semantics_test.dart). A no-op on the native targets this runs on.
      releaseWebSemantics();
    }
  });
}
