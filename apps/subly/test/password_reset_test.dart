// ─────────────────────────────────────────────────────────────────────────────
// PASSWORD RESET, END TO END — the completion half that did not exist.
//
// 🔴 WHAT WAS MEASURED BEFORE THIS INCREMENT. `sendPasswordReset` was
// implemented and a real recovery mail was delivered on 2026-08-03. There was no
// `updatePassword` on the seam or in either implementation, no `/reset-password`
// in Subly's 19 routes or the brick's 9, and no `redirectTo` on the request — a
// repo-wide grep for `updatePassword|passwordRecovery|reset-password` returned
// only the `AutofillHints.newPassword` constant. A user who forgot their
// password could ask for help and then had no way to accept it.
//
// ── WHY THE REAL REPOSITORY, NOT A FAKE ─────────────────────────────────────
// Every case below drives the REAL `InMemoryAuthRepository` through the REAL
// router and the REAL `passwordRecoveryProvider`. A hand-written double would
// let this file assert against a recovery event of its own invention, and the
// entire defect being fixed is that a recovery event and a sign-in event were
// the same object. The one thing standing in for production is the mailbox:
// `deliverPasswordRecovery` is what the emailed link plus the PKCE exchange
// produce, and it produces exactly what the Supabase adapter produces — a real
// session, labelled `passwordRecovery`. That the two are otherwise identical is
// pinned in `packages/auth_supabase/test/auth_repository_test.dart`.
//
// ── NEGATIVE-TESTED AGAINST THE REAL TREE, 2026-08-11 · 4 mutations ─────────
// Each was applied to the shipping file named, `flutter analyze` re-run to prove
// the red was a failed assertion and not a compile error, then reverted. The
// results are the run's own output, quoted in this file's report.
//
//   M1  supabase_auth_repository.dart — `authEvents()` mapped back to
//       `AuthEvent(signedIn, …)`, i.e. the event discarded exactly as it was
//       before this increment                    → the PROVIDER suite goes red
//   M2  providers.dart — `PasswordRecoveryController` stops arming on
//       `startsPasswordRecovery`                 → 4 RED here (routing, happy
//                                                   path, mismatch, weak)
//   M3  providers.dart — `routerRefreshProvider` stops listening to
//       `passwordRecoveryProvider`               → 4 RED here: the gate is
//                                                   correct and never re-runs
//   M4  providers.dart — the controller stops CLEARING on `signedOut`
//                                                → 1 RED: the user completes the
//                                                   reset and is held on the
//                                                   screen forever
//
// 🔴 M3 IS THE ONE WORTH THE FILE. The gate reads the right provider, the
// provider holds the right value, and nothing re-runs the redirect — which is
// this repository's most-repeated shape and the exact defect the legal gate
// shipped with. It is invisible to any test that navigates after arming the
// state, so the routing case below arms it and navigates NOWHERE.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/auth/reset_password_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

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

/// The union router's onboarding gate DECLINES TO DECIDE while the seen-flag is
/// still hydrating (null), so a router test that never answers stalls before its
/// first real frame. Same override the other router tests use.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

/// [launchUrl] is what the browser opened the app with.
///
/// 🔴 IT IS AN OVERRIDE BECAUSE `Uri.base` IS A PROPERTY OF THE PROCESS. The
/// whole failure half of this feature is decided by the URL a reset link lands
/// on, and without a way to construct one, every test here could only ever
/// drive the state by navigating to it by hand — which is precisely how three
/// tests came to prove a state production could not produce.
ProviderContainer _container(
  InMemoryAuthRepository auth, {
  String launchUrl = 'https://subly.nikatru.com/',
}) => ProviderContainer(
  overrides: <Override>[
    onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
    legalReacceptanceNeededProvider.overrideWithValue(false),
    authRepositoryProvider.overrideWithValue(auth),
    keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
    analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
    launchUriProvider.overrideWithValue(Uri.parse(launchUrl)),
  ],
);

/// Pump the real router; returns where it SETTLED.
///
/// 🔴 IT NAVIGATES NOWHERE UNLESS ASKED. `redirect` fires on navigation, so a
/// helper that always `go()`s would hide the whole class of defect where a gate
/// is correct and nothing re-runs it. [location] is optional for exactly that
/// reason, and the routing case below leaves it out.
Future<String> _pump(
  WidgetTester tester,
  ProviderContainer c, [
  String? location,
]) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (location != null) {
    c.read(routerProvider).go(location);
    await tester.pumpAndSettle();
  }
  return _where(c);
}

String _where(ProviderContainer c) =>
    c.read(routerProvider).routerDelegate.currentConfiguration.uri.toString();

/// Fill both boxes and press Save.
Future<void> _submit(
  WidgetTester tester,
  String password,
  String confirmation,
) async {
  await tester.enterText(
    find.byKey(ResetPasswordScreen.passwordField),
    password,
  );
  await tester.enterText(
    find.byKey(ResetPasswordScreen.confirmField),
    confirmation,
  );
  await tester.tap(find.byKey(ResetPasswordScreen.submitButton));
  await tester.pumpAndSettle();
}

void main() {
  late InMemoryAuthRepository auth;
  setUp(() => auth = InMemoryAuthRepository());
  tearDown(() => auth.dispose());

  // ══════════════════════════════════════════════════════════════════════════
  // (a) THE RECOVERY EVENT IS WHAT ROUTES. The load-bearing limb.
  // ══════════════════════════════════════════════════════════════════════════
  testWidgets(
    'a recovery arrival moves the app to /reset-password with NO navigation',
    (WidgetTester tester) async {
      final ProviderContainer c = _container(auth);
      addTearDown(c.dispose);

      // Signed out, settled, sitting on the sign-in form.
      expect(await _pump(tester, c), '/sign-in');

      // The link is followed. Nothing in the app navigates: the session simply
      // appears, exactly as it does when a browser opens the app root with a
      // `?code=` and the SDK exchanges it.
      auth.deliverPasswordRecovery('a@b.test');
      await tester.pumpAndSettle();

      expect(
        _where(c),
        '/reset-password',
        reason:
            'THE WHOLE INCREMENT IN ONE ASSERTION. Without the event this user is '
            'indistinguishable from somebody who just signed in — same id, same '
            'email, same emission on authStateChanges — and the router hands them '
            '/home, which is not what they came for and offers no way to get it',
      );
      expect(find.byType(ResetPasswordScreen), findsOneWidget);
      expect(
        find.byKey(ResetPasswordScreen.passwordField),
        findsOneWidget,
        reason:
            'the FORM state, not the dead-link state — a session is in hand',
      );
    },
  );

  // The other direction, and it is not implied by the first: a router that sent
  // EVERY arrival to /reset-password would satisfy the case above and trap every
  // ordinary sign-in here.
  testWidgets('an ordinary sign-in is NOT routed into the reset flow', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);

    await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
    await tester.pumpAndSettle();

    expect(_where(c), '/home');
    expect(find.byType(ResetPasswordScreen), findsNothing);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // (b) THE HAPPY PATH — the seam is actually reached, with the right value.
  // ══════════════════════════════════════════════════════════════════════════
  testWidgets('a valid, confirmed password REACHES the seam and confirms', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    auth.deliverPasswordRecovery('a@b.test');
    await tester.pumpAndSettle();

    await _submit(tester, 'correct-horse', 'correct-horse');

    expect(
      auth.passwordsSet,
      <String>['correct-horse'],
      reason:
          'the VALUE, not a call count: a screen wired to submit the '
          'CONFIRMATION field instead of the password field reaches the seam '
          'exactly once either way, and the user would be locked out with a '
          'password they never chose',
    );
    expect(
      find.byKey(ResetPasswordScreen.doneLine),
      findsOneWidget,
      reason:
          'the terminal state stays MOUNTED. Signing out here instead would '
          'fire the gate and tear this page down before the sentence could be '
          'read — [ADR 027] repeating itself',
    );
    expect(
      _where(c),
      '/reset-password',
      reason: 'still held: the gate releases on sign-out, and nobody has yet',
    );
  });

  // 🔴 THE GATE MUST RELEASE, and the sign-out is the only thing that releases
  // it. A version of the screen that merely navigated would leave the flag armed
  // and the router would put the user straight back here.
  testWidgets('signing in after a reset LEAVES the flow for good', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    auth.deliverPasswordRecovery('a@b.test');
    await tester.pumpAndSettle();
    await _submit(tester, 'correct-horse', 'correct-horse');

    await tester.tap(find.byKey(ResetPasswordScreen.signInButton));
    await tester.pumpAndSettle();

    expect(_where(c), '/sign-in');
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(
      c.read(passwordRecoveryProvider),
      isFalse,
      reason:
          'armed forever is a user who can never reach any other screen — the '
          'router would answer /reset-password to every location they try',
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // (c) THE TWO REFUSALS THAT MUST HAPPEN BEFORE THE NETWORK.
  // ══════════════════════════════════════════════════════════════════════════

  // 🔴 THE ONE ERROR THE SERVER CANNOT CATCH. Both boxes hold well-formed
  // passwords, so gotrue accepts the wrong one happily — and the user is locked
  // out of the account they just recovered, with their single-use link spent.
  testWidgets('a mistyped confirmation is refused and NOTHING is sent', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    auth.deliverPasswordRecovery('a@b.test');
    await tester.pumpAndSettle();

    await _submit(tester, 'correct-horse', 'correct-hosre');

    expect(auth.passwordsSet, isEmpty);
    expect(find.byKey(ResetPasswordScreen.statusLine), findsOneWidget);
    expect(
      find.text('The two passwords do not match.'),
      findsOneWidget,
      reason:
          'the message names WHICH box to look at. "Invalid password" would '
          'satisfy an assertion about an error being shown and tell the user '
          'nothing at all',
    );
    expect(
      find.byKey(ResetPasswordScreen.doneLine),
      findsNothing,
      reason: 'a refused submit must never render the success state',
    );
  });

  testWidgets('a password under the shared floor is refused before the wire', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    auth.deliverPasswordRecovery('a@b.test');
    await tester.pumpAndSettle();

    await _submit(tester, 'sevench', 'sevench');

    expect(auth.passwordsSet, isEmpty);
    expect(find.text('Use at least 8 characters.'), findsOneWidget);
    expect('sevench'.length, core.kMinPasswordLength - 1);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // (d) THE EXPIRED / ALREADY-USED / WRONG-DEVICE LINK.
  //
  // 🔴 THE COMMONEST OUTCOME IN THE FIELD, AND THE ONE AN IMPLEMENTATION THAT
  // ONLY TESTED THE HAPPY PATH GETS WRONG. PKCE keeps the code verifier in the
  // installation that REQUESTED the link, so a link opened on a second device —
  // or in a browser when the request came from the desktop build — arrives with
  // nothing to exchange and mints NO SESSION. The person is signed out.
  // ══════════════════════════════════════════════════════════════════════════
  testWidgets('a dead link lands on an EXPLANATION, not on the sign-in form', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);

    final String settled = await _pump(tester, c, '/reset-password');

    expect(
      settled,
      '/reset-password',
      reason:
          'without /reset-password in `authFlow` the signed-out guard eats this '
          'and answers /sign-in — the user came from their inbox, did exactly '
          'as instructed, and the app shows them the form they already could '
          'not get past, with no word about why',
    );
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsOneWidget);
    expect(
      find.byKey(ResetPasswordScreen.passwordField),
      findsNothing,
      reason:
          'a form with no session behind it is a button that can only fail — '
          'worse than no form, because it looks like the feature working',
    );
    expect(
      find.text(
        'Open the link on the same device and browser you asked for it from, '
        'or ask for a new one from the sign-in screen.',
      ),
      findsOneWidget,
      reason:
          'the same-device rule is a PROPERTY OF PKCE, not a bug, and this '
          'sentence is the only thing that turns a dead end into an action',
    );
  });

  // A signed-IN user typing the URL is not in a recovery: offering them a
  // password change here would be a silent rotation on whatever session is in
  // hand, on a project whose reauthentication switch is off.
  testWidgets('a signed-in user with no recovery is sent home', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth);
    addTearDown(c.dispose);
    await _pump(tester, c);
    await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
    await tester.pumpAndSettle();

    c.read(routerProvider).go('/reset-password');
    await tester.pumpAndSettle();

    expect(_where(c), '/home');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // (e) THE REQUEST HALF still asks for the right address.
  // ══════════════════════════════════════════════════════════════════════════
  testWidgets(
    'the Forgot-password control reaches the seam with the typed address',
    (WidgetTester tester) async {
      final ProviderContainer c = _container(auth);
      addTearDown(c.dispose);
      await _pump(tester, c);

      await tester.enterText(find.byType(TextField).first, 'ada@example.test');
      await tester.tap(find.text('Forgot password?'));
      await tester.pumpAndSettle();

      expect(
        auth.passwordResetsRequested,
        <String>['ada@example.test'],
        reason:
            'the send half was already live; this pins that the completion half '
            'was added without breaking the door it completes',
      );
    },
  );

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴 THE DEAD-LINK STATE, REACHED FROM THE FAILURE IT EXPLAINS.
  //
  // The tests above reach it by `go('/reset-password')` — by TYPING the URL —
  // and that was the whole defect the review caught: `passwordRecoveryProvider`
  // arms on the SUCCESS event and on nothing else, so a link that could not be
  // exchanged routed NOWHERE. The person landed on `/`, was bounced to
  // `/sign-in`, and the screen written for their exact situation was
  // unreachable from that situation. Three tests proved a state production could
  // not produce.
  //
  // These two drive the real thing: the URL gotrue really redirects to, and the
  // stream error the SDK really emits. Neither navigates by hand.
  // ══════════════════════════════════════════════════════════════════════════
  testWidgets('an EXPIRED link ROUTES here by itself, and says which failure it was', (
    WidgetTester tester,
  ) async {
    // Measured off the live project on 2026-08-11: this is the exact
    // `Location:` gotrue answers for an invalid or expired recovery token. The
    // fragment carries the error and the QUERY carries our marker, which is the
    // whole reason the marker exists.
    final ProviderContainer c = _container(
      auth,
      launchUrl:
          'https://subly.nikatru.com/?nk_auth=reset'
          '#error=access_denied&error_code=otp_expired'
          '&error_description=Email+link+is+invalid+or+has+expired&sb=',
    );
    addTearDown(c.dispose);

    // ⚠️ NO `go()`. The router is pumped and asked to navigate NOWHERE — if the
    // arrival does not route by itself, this settles on `/sign-in` and the case
    // fails, which is exactly what the shipped version did.
    final String settled = await _pump(tester, c);

    expect(
      settled,
      '/reset-password',
      reason:
          'the failure redirect lands on `/` with an unroutable fragment. '
          'Nothing but the arrival can put this person on the screen that '
          'explains their situation',
    );
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsOneWidget);
    expect(
      find.byKey(ResetPasswordScreen.passwordField),
      findsNothing,
      reason: 'a form with no session behind it can only fail',
    );
    expect(
      find.text(
        'Reset links stop working after a while, and each one can only be used '
        'once. Ask for a new one from the sign-in screen.',
      ),
      findsOneWidget,
      reason:
          'TYPED: this link expired, and telling somebody to open it on the '
          'device they asked from is useless advice to somebody who did',
    );
  });

  testWidgets('the PKCE crash [SUBLY-8] becomes a sentence on this screen', (
    WidgetTester tester,
  ) async {
    // The production crash, end to end. The launch URL is the SUCCESS shape —
    // marker and code, nothing wrong with it — and the exchange fails inside the
    // SDK because this browser never stored the verifier. Until this increment
    // that threw out of `runZonedGuarded` as a FATAL, and the user saw nothing.
    final ProviderContainer c = _container(
      auth,
      launchUrl:
          'https://subly.nikatru.com/?nk_auth=reset&code=abc123#/reset-password',
    );
    addTearDown(c.dispose);
    await _pump(tester, c);

    auth.failRecoveryArrival(
      'Code verifier could not be found in local storage.',
    );
    await tester.pumpAndSettle();

    expect(
      _where(c),
      '/reset-password',
      reason: 'the failed arrival must still land somewhere that explains it',
    );
    expect(find.byKey(ResetPasswordScreen.linkDeadLine), findsOneWidget);
    expect(
      find.text(
        'Open the link on the same device and browser you asked for it from, '
        'or ask for a new one from the sign-in screen.',
      ),
      findsOneWidget,
      reason:
          'TYPED the other way: the verifier lives in the installation that '
          'ASKED for the link, so this is the one cause the user can act on',
    );
  });

  testWidgets('leaving CLEARS the arrival, so a dead link is not a trap', (
    WidgetTester tester,
  ) async {
    // Without the explicit clear the gate holds forever: `signedOut` is
    // deliberately not a release for the arrival (a routine `initialSession`
    // emission would otherwise erase what the launch URL established), so
    // tapping Sign in would return the user straight to this screen.
    final ProviderContainer c = _container(
      auth,
      launchUrl:
          'https://subly.nikatru.com/?nk_auth=reset#error=access_denied'
          '&error_code=otp_expired',
    );
    addTearDown(c.dispose);
    expect(await _pump(tester, c), '/reset-password');

    await tester.tap(find.byKey(ResetPasswordScreen.signInButton));
    await tester.pumpAndSettle();

    expect(
      _where(c),
      '/sign-in',
      reason:
          'the one exit has to actually let go of the gate, or the explanation '
          'becomes a room with no door',
    );
  });

  testWidgets('an OAuth callback with a code is NOT sent here', (
    WidgetTester tester,
  ) async {
    // The regression this whole marker exists to prevent, driven through the
    // real router: `?code=` is every PKCE arrival, and a parser that keyed on it
    // alone would take somebody returning from a Google sign-in and put them on
    // the reset-password screen.
    final ProviderContainer c = _container(
      auth,
      launchUrl: 'https://subly.nikatru.com/?code=an-oauth-code',
    );
    addTearDown(c.dispose);

    expect(
      await _pump(tester, c),
      isNot('/reset-password'),
      reason: 'this arrival has nothing to do with a password reset',
    );
  });
}
