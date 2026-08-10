// ─────────────────────────────────────────────────────────────────────────────
// THERE IS ONE AUTH URL, IT IS `/sign-in`, AND `/login` ARRIVES AT IT INTACT.
//
// 🔴 WHAT THIS EXISTS FOR. P2.5 mounted BOTH `/login` (Subly's live form) and
// `/sign-in` (the chassis stamp) and left the choice open. Two URLs for one gate
// is not a tidiness problem: a link is written once and read for years — a
// marketing page, a password-reset mail, a bookmark, a deep link a Worker
// builds — and the moment the two paths drift, half of those links land
// somewhere the other half does not. The owner settled it on 2026-08-09:
// `/sign-in` is canonical.
//
// ── WHY BOTH DIRECTIONS ARE ASSERTED ────────────────────────────────────────
// A one-way check passes against a router that redirects EVERYTHING to
// `/sign-in`, including `/sign-in` itself, which is a loop go_router reports as
// a redirect-limit exception rather than as the wrong screen. So:
//   · `/login` MUST MOVE      — it is not canonical and must not stay put;
//   · `/sign-in` MUST NOT     — it is canonical and a fixed point.
// Neither limb can pass for the other's reason.
//
// 🔴 AND THE QUERY IS THE LIMB THAT WOULD HAVE ROTTED SILENTLY. The obvious
// spelling of this redirect returns the literal `'/sign-in'`, which drops
// `?next=/budget` on the floor. Every assertion about WHICH SCREEN renders still
// passes — the user is on the sign-in form either way — and the only visible
// symptom is that after signing in they arrive somewhere they did not ask for,
// which reads like a user changing their mind. `deep-links preserved` is
// therefore its own case, with two parameters so a redirect that carried the
// first one by luck cannot pass.
//
// ⚠️ THE SCREEN IS PINNED, NOT JUST THE PATH. `/sign-in` must build
// `LoginScreen`: it is the surface that carries the ADR-027 account-deletion
// notice (the deletion outcome has nowhere else to render — the sign-out
// redirect tears down settings, its dialog and any SnackBar with it) and the
// `E2EKeys.login*` anchors the nightly E2E legs drive. A future change that
// re-points the canonical route at a leaner form would keep every path
// assertion green while removing both.
//
// ── MUTATION-TESTED AGAINST THE REAL ROUTER, 2026-08-10 · 5 of them ─────────
// Each was applied to `lib/core/router.dart` itself, not to a fixture, and the
// result below is what the run printed:
//
//   M1 the redirect returns the literal `'/sign-in'`  → ONLY the query limb RED
//   M2 `/login` goes back to `builder: LoginScreen`   → 3 RED: redirect, query,
//      AND the signed-in limb
//   M5 `/login` dropped from `authFlow`               → ONLY the query limb RED
//   M3 the signed-out guard answers `'/login'`        → 🔴 ALL FIVE STAYED GREEN
//   M4 the signed-in bounce stops naming `/login`     → 🔴 ALL FIVE STAYED GREEN
//
// 🔴 M3 AND M4 ARE WRITTEN DOWN BECAUSE THEY DID NOT FAIL, and an unrecorded
// surviving mutant is how a suite comes to be trusted for something it does not
// check. The reason is the same in both: the ROUTE-LEVEL redirect on `/login`
// launders them. A guard that still answers `/login` (M3) has its answer
// rewritten to `/sign-in` on the next pass, and a signed-in user sent to
// `/login` (M4) is canonicalised and then bounced home — so in both cases the
// user-visible destination is identical and no limb here can see the
// difference. These limbs assert WHERE THE USER ENDS UP, which is the property
// worth having; they do not pin the internal spelling, and this test does not
// claim to. M4 is why that clause was DELETED from the router rather than kept:
// the mutation proved nothing could reach it.
//
// 🔬 AND M2 IS THE PAIRED CONSEQUENCE OF THAT DELETION — re-measured 2026-08-10
// after the clause was gone, which is why this row reads 3 RED and not the 2 an
// earlier pass recorded. With the signed-in bounce no longer naming `/login`,
// restoring `builder: LoginScreen` on `/login` strands an authenticated user on
// the form: nothing canonicalises them to `/sign-in` any more, so the bounce
// never sees a path it recognises. The two mutations are not independent, and
// the surviving-mutant note above is exactly what makes that legible: M4 is
// safe ONLY while the route-level redirect stands, and M2 is the run that
// proves the suite notices when it stops standing.
//
// ⚠️ Falsifiability of the gated limb was then proven separately (M3b): point
// the signed-out guard at `'/onboarding'` and it goes RED with `/home` — so the
// limb is blind to one substitution, not vacuous.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/router.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
// `analyticsConsentProvider` comes through here — `state/providers.dart`
// re-exports it, so importing `state/analytics_providers.dart` as well is the
// `unnecessary_import` two other test files in this suite still carry. Not
// copied into a new one.
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

/// Signed out and staying that way. Anything beyond the two members the
/// redirect guard reads being called would mean this stopped being a routing
/// test.
class _SignedOutAuth implements core.AuthRepository {
  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _SignedInAuth implements core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'u1', email: 'a@b.test');

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The union router's onboarding gate DECLINES TO DECIDE while the seen-flag is
/// still hydrating (null), so a router test that never answers stalls before its
/// first real frame. Same override the other three router tests use.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

ProviderContainer _container({required core.AuthRepository auth}) =>
    ProviderContainer(
      overrides: <Override>[
        onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
        authRepositoryProvider.overrideWithValue(auth),
        keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
        analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      ],
    );

/// Pump the real router and drive it to [location]; returns where it SETTLED.
///
/// The settled location, not the requested one, is the entire question here —
/// and it is read after `pumpAndSettle` rather than on the next frame because a
/// redirect is a navigation: asserting early can catch the app mid-hop, which is
/// the polling mistake `sign_out_destination_test.dart` records.
Future<String> _settleAt(
  WidgetTester tester,
  ProviderContainer c,
  String location,
) async {
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
  c.read(routerProvider).go(location);
  await tester.pumpAndSettle();
  return c
      .read(routerProvider)
      .routerDelegate
      .currentConfiguration
      .uri
      .toString();
}

void main() {
  testWidgets('/login REDIRECTS onto the canonical /sign-in', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth: _SignedOutAuth());
    addTearDown(c.dispose);

    final String settled = await _settleAt(tester, c, '/login');

    expect(
      settled,
      '/sign-in',
      reason:
          'the old auth URL must not be a second place to sign in — it is a '
          'redirect onto the one canonical path',
    );
    expect(
      find.byType(LoginScreen),
      findsOneWidget,
      reason:
          'the URL changed and the SCREEN did not: /sign-in builds the live '
          'LoginScreen, which is what carries the ADR-027 deletion notice and '
          'the E2EKeys.login* anchors',
    );
  });

  testWidgets('/sign-in is a FIXED POINT — the canonical path stays put', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth: _SignedOutAuth());
    addTearDown(c.dispose);

    final String settled = await _settleAt(tester, c, '/sign-in');

    expect(
      settled,
      '/sign-in',
      reason:
          'the other direction, and it is not implied by the first: a router '
          'that rewrote EVERY auth path to /sign-in would satisfy the redirect '
          'case and loop here',
    );
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  testWidgets('the redirect CARRIES THE QUERY — a deep link survives the hop', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth: _SignedOutAuth());
    addTearDown(c.dispose);

    // Two parameters on purpose: a redirect that happened to forward the first
    // one cannot pass this by luck.
    final String settled = await _settleAt(
      tester,
      c,
      '/login?next=%2Fbudget&ref=mail',
    );

    expect(
      Uri.parse(settled).path,
      '/sign-in',
      reason: 'the PATH is what canonicalises',
    );
    expect(
      Uri.parse(settled).queryParameters,
      <String, String>{'next': '/budget', 'ref': 'mail'},
      reason:
          'returning the literal "/sign-in" from the redirect drops the query '
          'and every screen assertion stays green — the user simply arrives '
          'somewhere they did not ask for, which reads like they changed their '
          'mind. This is the only limb that can see it',
    );
  });

  testWidgets('a signed-out user on a GATED route is sent to /sign-in', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth: _SignedOutAuth());
    addTearDown(c.dispose);

    final String settled = await _settleAt(tester, c, '/budget');

    expect(
      settled,
      '/sign-in',
      reason:
          'a signed-out user reaching for a gated surface must END UP on the '
          'canonical auth path — however many hops it takes. ⚠️ This does NOT '
          'pin the guard to the string "/sign-in": M3 showed the guard can '
          'still answer "/login" and be laundered by the route-level redirect '
          'with every limb green. What it does catch is the guard answering '
          'something that is not an auth path at all (M3b: "/onboarding" → '
          'settles on /home, RED)',
    );
    expect(find.byType(LoginScreen), findsOneWidget);
  });

  testWidgets('a SIGNED-IN user who opens /login is not stranded on auth', (
    WidgetTester tester,
  ) async {
    final ProviderContainer c = _container(auth: _SignedInAuth());
    addTearDown(c.dispose);

    final String settled = await _settleAt(tester, c, '/login');

    expect(
      settled,
      '/home',
      reason:
          'an already-authenticated user following an old /login link must not '
          'be parked on a sign-in form they do not need. The hop is two: the '
          'route-level redirect canonicalises to /sign-in and the signed-in '
          'bounce takes it home from there — which is exactly why the bounce '
          'no longer names /login itself (M4: naming it changed no outcome)',
    );
    expect(find.byType(LoginScreen), findsNothing);
  });
}
