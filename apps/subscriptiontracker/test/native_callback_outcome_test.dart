// ─────────────────────────────────────────────────────────────────────────────
// ST-N1f — A NATIVE AUTH CALLBACK WHOSE CODE CANNOT BE EXCHANGED SHOWS "LINK
// FAILED" AND SAYS SO IN THE DEVICE LOG.
//
// ⏱ 2026-09-28 · O-NATIVE-AUTH-CALLBACK-UNBUILT follow-up 3. The per-target
// proof (`integration_test/native_auth_proof_test.dart`) has the OS open
// `com.nikatru.<app>://auth-callback?nk_auth=reset&code=st-n1-invalid` and reads
// two things: the dead-link sentence, and the line
// `nk_auth_callback flow=reset outcome=failed`. This is the same pair, in a
// widget test, over the SHIPPING pieces: the real `SupabaseAuthRepository`
// around a real `GoTrueClient`, the real router, and the exact calls
// `supabase_flutter`'s deep-link handler makes (`getSessionFromUrl`, then
// `notifyException` on an AuthException — supabase_auth.dart:283-299, 2.16.0).
//
// The launch URL is a NATIVE one: off web the marked callback never reaches
// `Uri.base`, so the arrival is known only by the failed exchange.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show SupabaseAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations, lookupChassisLocalizations;
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/auth/reset_password_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;
import 'support/user_state_fakes.dart';

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

/// gotrue's PKCE verifier store — empty, as on a device that never sent the
/// link it is opening.
class _EmptyPkce extends sb.GotrueAsyncStorage {
  @override
  Future<String?> getItem({required String key}) async => null;
  @override
  Future<void> removeItem({required String key}) async {}
  @override
  Future<void> setItem({required String key, required String value}) async {}
}

/// What a native launch reads as `Uri.base`: no marker, no code.
final Uri _nativeLaunch = Uri.parse('file:///');

const String _callback =
    'com.nikatru.subscriptiontracker://auth-callback?nk_auth=reset&code=st-n1-invalid';

/// ⏱ 2026-10-01 · EN-04 / EN-15 — the two callbacks that are NOT resets. A
/// confirmation opened where its PKCE verifier was never stored, and a
/// provider return the user cancelled (gotrue's error redirect).
const String _confirmCallback =
    'com.nikatru.subscriptiontracker://auth-callback?nk_auth=confirm&code=st-n1-invalid';
const String _oauthCallback =
    'com.nikatru.subscriptiontracker://auth-callback?nk_auth=oauth'
    '&error=access_denied&error_code=user_cancelled'
    '&error_description=User+cancelled+the+sign-in';

/// What one callback did: where the router settled, and the log lines.
typedef _Outcome = ({String path, List<String> log});

/// Pumps the real router over the real adapter, then has "the OS" hand the app
/// [callback] exactly as `supabase_flutter`'s deep-link handler does.
///
/// [deliverDeepLink]: whether the native fake ALSO answers the adapter's
/// latest-deep-link read with [callback] — what `app_links` does on a device.
/// False is the default adapter wiring under a widget test (no plugin), which
/// must still fall back to the launch URL.
Future<_Outcome> _arrive(
  WidgetTester tester,
  String callback, {
  bool deliverDeepLink = true,
}) async {
  final sb.GoTrueClient gotrue = sb.GoTrueClient(
    // Never reached: with no verifier the exchange fails before any request.
    url: 'http://127.0.0.1:9/auth/v1',
    autoRefreshToken: false,
    asyncStorage: _EmptyPkce(),
  );
  Uri? delivered;
  final SupabaseAuthRepository auth = SupabaseAuthRepository(
    client: gotrue,
    launchUri: () => _nativeLaunch,
    deepLink: deliverDeepLink ? () async => delivered : null,
  );
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(auth),
      keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      launchUriProvider.overrideWithValue(_nativeLaunch),
      secureStoreProvider.overrideWithValue(MemSecureStore()),
      notificationServiceProvider.overrideWithValue(FakeNotifications()),
      renewalRemindersProvider.overrideWithValue(RecordingSublyNotifications()),
    ],
  );
  addTearDown(c.dispose);

  final List<String> log = <String>[];
  final DebugPrintCallback original = debugPrint;
  debugPrint = (String? message, {int? wrapWidth}) {
    if (message != null) log.add(message);
  };
  try {
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: MaterialApp.router(
          localizationsDelegates: <LocalizationsDelegate<dynamic>>[
            ...AppLocalizations.localizationsDelegates,
            ChassisLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          routerConfig: c.read(routerProvider),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsNothing);

    // The OS hands the app its callback; supabase_flutter does exactly this.
    await tester.runAsync(() async {
      delivered = Uri.parse(callback);
      try {
        await gotrue.getSessionFromUrl(Uri.parse(callback));
        fail('an unknown code must not mint a session');
      } on sb.AuthException catch (error, stack) {
        // The SDK's own call, verbatim: supabase_auth.dart:295-296 carries
        // the same ignore.
        // ignore: invalid_use_of_internal_member
        gotrue.notifyException(error, stack);
      }
      // The adapter's flow read is async; let it land inside real time. A
      // bounded poll on what it produces — the log line AND the routing state
      // — not a fixed sleep: a 10 ms sleep read as no event at all on a
      // loaded machine.
      bool landed() =>
          log.any((String l) => l.startsWith('nk_auth_callback')) &&
          (c.read(failedAuthArrivalProvider) != null ||
              c.read(passwordResetArrivalProvider).arrival ==
                  core.PasswordResetArrival.unusable);
      for (int i = 0; i < 300 && !landed(); i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
    });
    await tester.pumpAndSettle();
  } finally {
    debugPrint = original;
  }
  return (
    path: c.read(routerProvider).routerDelegate.currentConfiguration.uri.path,
    log: log.where((String l) => l.startsWith('nk_auth_callback ')).toList(),
  );
}

void main() {
  testWidgets('an invalid native callback shows LINK FAILED and logs '
      'outcome=failed', (WidgetTester tester) async {
    final _Outcome o = await _arrive(tester, _callback);
    expect(o.path, '/reset-password');
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsOneWidget);
    expect(o.log, <String>[
      'nk_auth_callback flow=reset outcome=failed',
    ], reason: 'ONE line per callback, however many providers listen');
  });

  testWidgets('with no deep link to read, an unmarked failure keeps the reset '
      'answer (ST-A2), and the line carries no code', (
    WidgetTester tester,
  ) async {
    final _Outcome o = await _arrive(tester, _callback, deliverDeepLink: false);
    expect(o.path, '/reset-password');
    expect(o.log, <String>['nk_auth_callback flow=reset outcome=failed']);
    expect(o.log.join('\n'), isNot(contains('st-n1-invalid')));
  });

  // 🔴 ⏱ 2026-10-01 · EN-04 / EN-15 — THE TWO THAT WERE FILED AS RESETS. The
  // adapter read `Uri.base`, which off web is `file:///`, so both landed on
  // "This reset link cannot be used here". MUTATION PROOF: make
  // `_failedArrivalUri` return `_launchUri()` and both go red on the path.
  testWidgets('a failed native CONFIRMATION lands on sign-in with the notice '
      'and a resend, not on /reset-password', (WidgetTester tester) async {
    final _Outcome o = await _arrive(tester, _confirmCallback);
    expect(o.path, '/sign-in');
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsNothing);
    expect(find.byKey(const Key('authArrivalNotice')), findsOneWidget);
    final ChassisLocalizations ch = lookupChassisLocalizations(
      const Locale('en'),
    );
    expect(find.text(ch.authLinkFailedSignIn), findsOneWidget);
    expect(find.byKey(const Key('authArrivalResend')), findsOneWidget);
    expect(o.log, <String>['nk_auth_callback flow=confirm outcome=failed']);
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  testWidgets('a failed native PROVIDER return lands on sign-in with the '
      'provider sentence, not on /reset-password', (WidgetTester tester) async {
    final _Outcome o = await _arrive(tester, _oauthCallback);
    expect(o.path, '/sign-in');
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsNothing);
    final ChassisLocalizations ch = lookupChassisLocalizations(
      const Locale('en'),
    );
    expect(find.text(ch.authProviderSignInCancelled), findsOneWidget);
    expect(
      find.byKey(const Key('authArrivalResend')),
      findsNothing,
      reason: 'a provider return has no confirmation mail to resend',
    );
    expect(o.log, <String>['nk_auth_callback flow=oauth outcome=failed']);
  });
}
