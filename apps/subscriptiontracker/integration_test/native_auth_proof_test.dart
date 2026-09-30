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
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/auth/reaccept_terms_screen.dart';
import 'package:subscriptiontracker/features/auth/reset_password_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/main.dart' as app;
import 'package:subscriptiontracker/state/providers.dart';

import 'native_auth_proof_steps.dart';
import 'offline_read_steps.dart';

const String _email = String.fromEnvironment('E2E_EMAIL');
const String _password = String.fromEnvironment('E2E_PASSWORD');
const bool _awaitCallback = bool.fromEnvironment('NK_PROOF_CALLBACK');

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
      final List<Finder> firstRun = <Finder>[
        find.text('Skip'),
        find.text('No thanks'),
      ];
      expect(
        await pumpUntilShown(
          tester,
          find.byKey(E2EKeys.loginEmail),
          tapThrough: firstRun,
        ),
        isTrue,
        reason: 'the sign-in form never showed. On screen: ${onScreen()}',
      );

      // 1 ── the real form, the real route.
      await proveFormSignIn(
        tester,
        email: _email,
        password: _password,
        emailField: find.byKey(E2EKeys.loginEmail),
        passwordField: find.byKey(E2EKeys.loginPassword),
        submit: find.byKey(E2EKeys.loginSubmit),
        home: find.byType(HomeScreen),
        tapThrough: <Finder>[
          find.byKey(ReacceptTermsScreen.acceptButton),
          ...firstRun,
        ],
      );
      debugPrint('NK_PROOF step=sign-in outcome=ok');

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
