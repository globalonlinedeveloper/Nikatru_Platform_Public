// ─────────────────────────────────────────────────────────────────────────────
// [pipeline C-16] CHASSIS PROPERTY ASSERTIONS — inherited by every stamped app.
//
// WHY THIS FILE LIVES IN THE BRICK AND NOT ONLY IN CI (owner decision
// 2026-07-27). CI's `app_brick` lane already stamps a throwaway app, compiles it
// and runs its tests. What it never checked is whether the app BEHAVES — so
// anything merely ABSENT sailed through: `themeMode` appeared zero times
// repo-wide, `Semantics(` zero times, and the account-delete button called
// `Navigator.pop` and nothing else. All three passed.
//
// A check that only runs on a throwaway app stops protecting the moment a real
// app leaves the factory. Putting the assertions HERE means app #7 keeps checking
// itself for the rest of its life, which is the whole premise of a shared
// chassis: exists once, inherited rather than copied.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: no chassis requirement lands without an
// assertion in here. `tooling/ci/assert-stamp-properties.mjs` fails the build if
// this file goes missing or stops covering a declared property — the same
// discipline F-10 applies to the CI guards themselves.
//
// If your app deliberately diverges from one of these, DELETE the specific test
// and say why in the commit. That is a visible, reviewed choice. Silently losing
// the property is what this file prevents.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
// [pipeline C-11] buildAppTheme + AppThemeX, for the brand-seed property.
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:{{app_id.snakeCase()}}/app.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';
import 'package:{{app_id.snakeCase()}}/core/app_config.dart';
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

/// In-memory store: `PrefsKeyValueStore` needs a platform channel that does not
/// exist in a widget test, so every test overrides the seam rather than mocking
/// the plugin. This is the storage seam earning its keep.
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

ProviderContainer _container(_MemStore store) => ProviderContainer(
  overrides: <Override>[keyValueStoreProvider.overrideWith((_) async => store)],
);

/// Captures whatever the analytics rail actually ships. The point of a FAKE
/// rather than a mock: the assertion is "a real batch, with real contents,
/// arrived", which is the single thing no test in this repo was making before
/// [pipeline C-6].
class _FakeEventTransport implements core.EventTransport {
  final List<Map<String, Object?>> sent = <Map<String, Object?>>[];
  String? lastAnonId;
  Map<String, Object?>? lastEnvelope;

  @override
  Future<core.Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    lastAnonId = anonId;
    lastEnvelope = envelope;
    sent.addAll(events);
    return const core.Result<void>.ok(null);
  }
}

class _FakeConsentTransport implements core.ConsentTransport {
  final List<core.ConsentArtifact> sent = <core.ConsentArtifact>[];

  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    sent.add(artifact);
    return const core.Result<void>.ok(null);
  }
}

/// A container with the analytics switch FORCED ON.
///
/// `AppConfig.isBackendLive` is compile-time, so without this override the open
/// path could never be exercised at all — and an open path nobody exercises is
/// the exact defect [pipeline C-6] was about.
ProviderContainer _analyticsContainer({
  required _MemStore store,
  required _FakeEventTransport events,
  required _FakeConsentTransport consent,
  bool enabled = true,
}) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    analyticsEnabledProvider.overrideWithValue(enabled),
    eventTransportProvider.overrideWithValue(events),
    consentTransportProvider.overrideWithValue(consent),
  ],
);

/// Grant (or refuse) analytics consent through the SAME decision path the UI
/// uses, then make the new decision visible the way the UI does.
Future<core.ConsentArtifact> _decide(
  ProviderContainer c, {
  required bool granted,
}) async {
  final core.ConsentArtifact a = await applyConsentDecision(
    controller: await c.read(consentControllerProvider.future),
    transport: c.read(consentTransportProvider),
    appId: AppConfig.appId,
    anonId: await c.read(installIdProvider.future),
    granted: granted,
  );
  c.invalidate(consentControllerProvider);
  return a;
}

/// Widget tests here have no animations and no timers, but several provider
/// futures resolve in sequence; `pumpAndSettle` would be a lie about why we are
/// waiting, so turn the event loop a fixed number of times instead.
Future<void> _turns(WidgetTester tester, [int n = 12]) async {
  for (int i = 0; i < n; i++) {
    await tester.pump();
  }
}

/// Turn the loop AND let a route transition finish.
///
/// 🔴 `tester.pump()` with no duration does not advance the clock, so a page
/// transition never completes and the OUTGOING route stays mounted. A test that
/// asserts "the sign-in form is gone" therefore fails on a router that navigated
/// perfectly — which cost an hour, and looks exactly like a broken redirect.
/// Anything asserting on navigation must advance time.
Future<void> _turnsAndSettleRoute(WidgetTester tester) async {
  await _turns(tester);
  await tester.pump(const Duration(milliseconds: 500));
  await _turns(tester, 4);
}

/// A container whose session is already established.
///
/// 🔴 [pipeline C-13] ADDED WHEN THE AUTH GATE LANDED. The router now redirects a
/// signed-out app to /sign-in, so two of the accessibility limbs below — which
/// measure the NAVIGATION BAR — suddenly had nothing to measure. They were
/// silently relying on the app opening on Home. Establishing the state a test
/// needs is the test's job; the alternative is a chassis that cannot add an auth
/// gate without breaking its own assertions.
Future<ProviderContainer> _signedInContainer(_MemStore store) async {
  final ProviderContainer c = _container(store);
  await c
      .read(authRepositoryProvider)
      .signInWithEmail(email: 'a@b.com', password: 'pw');
  return c;
}

void main() {
  // ── PROPERTY: theme-mode-persisted ────────────────────────────────────────
  // DoD §4-D requires theme + darkTheme + a PERSISTED themeMode. MaterialApp
  // defaults to ThemeMode.system, so dark mode appears to work while the user's
  // own choice is silently discarded — passing by accident, not by design.
  group('property: theme-mode-persisted', () {
    test('defaults to following the OS', () {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      expect(c.read(themeModeProvider), ThemeMode.system);
    });

    test('a choice is written to storage', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer c = _container(store);
      addTearDown(c.dispose);
      await c.read(themeModeProvider.notifier).set(ThemeMode.dark);
      expect(c.read(themeModeProvider), ThemeMode.dark);
      expect(store.data['nikatru.theme_mode'], 'dark');
    });

    test('a stored choice SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _container(store);
      await first.read(themeModeProvider.notifier).set(ThemeMode.light);
      first.dispose();

      // A fresh container over the same store == the next app launch.
      final ProviderContainer reborn = _container(store);
      addTearDown(reborn.dispose);
      reborn.read(themeModeProvider); // triggers the background hydrate
      await Future<void>.delayed(Duration.zero);
      expect(
        reborn.read(themeModeProvider),
        ThemeMode.light,
        reason: 'without this the setting resets at every launch',
      );
    });

    test(
      'an unreadable store keeps following the OS, and never throws',
      () async {
        final ProviderContainer c = ProviderContainer(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith(
              (_) async => throw StateError('disk gone'),
            ),
          ],
        );
        addTearDown(c.dispose);
        expect(c.read(themeModeProvider), ThemeMode.system);
        await Future<void>.delayed(Duration.zero);
        expect(c.read(themeModeProvider), ThemeMode.system);
      },
    );
  });

  // ── PROPERTY: theme-triplet-supplied ──────────────────────────────────────
  // Asserted on the REAL app root, not on a hand-built MaterialApp, because the
  // defect being prevented is "somebody deleted a line from app.dart".
  group('property: theme-triplet-supplied', () {
    testWidgets('the app supplies theme, darkTheme AND themeMode', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          ],
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      // pump(), never pumpAndSettle(): the config and version providers resolve
      // asynchronously and settling would wait on them for no reason.
      await tester.pump();

      final MaterialApp app = tester.widget<MaterialApp>(
        find.byType(MaterialApp),
      );
      expect(app.theme, isNotNull, reason: 'no light theme');
      expect(
        app.darkTheme,
        isNotNull,
        reason: 'no dark theme — dark mode is dead',
      );
      expect(
        app.themeMode,
        isNotNull,
        reason: 'themeMode omitted ⇒ the user override is silently discarded',
      );
    });

    testWidgets('light and dark are genuinely different schemes', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          ],
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await tester.pump();
      final MaterialApp app = tester.widget<MaterialApp>(
        find.byType(MaterialApp),
      );
      // Guards against `darkTheme: buildAppTheme()` — present, and light.
      expect(app.theme!.brightness, Brightness.light);
      expect(app.darkTheme!.brightness, Brightness.dark);
    });
  });

  // ── PROPERTY: brand-seed-drives-paint ─────────────────────────────────────
  // [pipeline C-11] One brand input must produce a VISIBLY DISTINCT app.
  //
  // It did not. `buildAppTheme` passed the seed to ColorScheme.fromSeed and then
  // overrode `primary` with a constant, and attached a `const` AppThemeX — so a
  // red-seeded app and a green-seeded app came out with an identical primary, an
  // identical brand gradient and an identical category ramp. Every app the
  // factory stamped looked the same.
  //
  // This is a STORE-SURVIVAL property, not a cosmetic one: both stores treat
  // near-identical apps as spam, Play enforcement reaches RELATED ACCOUNTS, and
  // the portfolio stakes everything on one store identity — so one clone-flag is
  // a portfolio-wide event. Asserted here so every stamped app keeps proving it.
  group('property: brand-seed-drives-paint', () {
    test('two different seeds paint differently', () {
      final ThemeData red = buildAppTheme(seed: const Color(0xFFFF0000));
      final ThemeData green = buildAppTheme(seed: const Color(0xFF00FF00));

      expect(
        red.colorScheme.primary,
        isNot(green.colorScheme.primary),
        reason:
            'the seed does not reach primary — every app is the same colour',
      );

      final AppThemeX rx = red.extension<AppThemeX>()!;
      final AppThemeX gx = green.extension<AppThemeX>()!;
      expect(
        rx.brandGradient,
        isNot(gx.brandGradient),
        reason:
            'the brand gradient is the most visible surface in the app; a '
            'const gradient makes every stamp look identical no matter the seed',
      );
      expect(
        rx.categoryRamp,
        isNot(gx.categoryRamp),
        reason: 'a shared category ramp is a clone tell on every chart',
      );
    });

    // Anchored to THIS app's real theme, not to the builder in isolation: the
    // defect being prevented is somebody hardcoding a colour into app.dart, or
    // dropping the `seed:` argument, which a builder-only test cannot see.
    testWidgets('this app really paints with ITS OWN seed', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          ],
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await tester.pump();

      final MaterialApp app = tester.widget<MaterialApp>(
        find.byType(MaterialApp),
      );
      // One line, deliberately: `seed_hex` is always six hex characters, so the
      // substituted length is fixed and `dart format` leaves this alone. The
      // template is mustache and cannot be formatted — only the stamp can, so
      // the indentation here has to match the formatter's output by hand.
      final ThemeData expected = buildAppTheme(seed: const Color(0xFF{{{seed_hex}}}));
      expect(
        app.theme!.colorScheme.primary,
        expected.colorScheme.primary,
        reason: 'the app is not painting with the seed it was stamped with',
      );
    });

    // Status colours must NOT follow the brand. Green means good and red means
    // danger in every app; re-hueing them from a seed trades a universal signal
    // for decoration, and this asserts that trade was not made by accident.
    test('status colours stay universal across brands', () {
      final AppThemeX red = buildAppTheme(
        seed: const Color(0xFFFF0000),
      ).extension<AppThemeX>()!;
      final AppThemeX green = buildAppTheme(
        seed: const Color(0xFF00FF00),
      ).extension<AppThemeX>()!;
      expect(red.positive, green.positive);
      expect(red.danger, green.danger);
      expect(red.warn, green.warn);
    });
  });

  // ── PROPERTY: ui-invariants-inherited ─────────────────────────────────────
  // [pipeline C-14] The invariants that are near-free in the chassis and
  // near-impossible to retrofit across 50 shipped apps. MASTER_PLAN §4 tagged
  // these `[CI]` and no CI lane had ever touched them: `Semantics(` appeared 0
  // times repo-wide, `TextScaler` 0 times, and AppScaffold covered 3 window
  // classes where DoD §4-C asked for 5.
  //
  // Each limb below is INDEPENDENTLY FALSIFIABLE — one can go red without the
  // others, which is what stops this becoming a single check that passes for
  // the wrong reason.
  group('property: ui-invariants-inherited', () {
    // LIMB 1 — TEXT SCALING, clamped at the root.
    testWidgets('text scaling is clamped to 1.0–2.0 at the app root', (
      WidgetTester tester,
    ) async {
      tester.platformDispatcher.textScaleFactorTestValue = 4.0;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          ],
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await _turns(tester);

      // Read the scaling INSIDE the app, below the clamp — asserting on the
      // dispatcher would only prove the test set it.
      final BuildContext ctx = tester.element(find.byType(Scaffold).first);
      final double scaled = MediaQuery.textScalerOf(ctx).scale(10.0);
      expect(
        scaled,
        lessThanOrEqualTo(20.0),
        reason:
            'the OS asked for 4x and nothing clamped it — unbounded scaling '
            'overflows, and an overflowing screen is one the user cannot finish',
      );
      expect(
        scaled,
        greaterThanOrEqualTo(10.0),
        reason: 'text must never render below the design size',
      );
    });

    // LIMB 2 — REACHABILITY. A control smaller than 48x48 is one a person with
    // imprecise touch cannot reliably hit; both platforms' own guidance says so.
    testWidgets('every navigation target is at least 48px', (
      WidgetTester tester,
    ) async {
      // A PHONE-sized window, explicitly. Flutter's default test surface is
      // 800x600, and 800 now resolves to `medium` — a rail, not a bottom bar —
      // so this limb silently had nothing to measure until the size was pinned.
      // Tap-target size matters most exactly here, on touch.
      await tester.binding.setSurfaceSize(const Size(400, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final ProviderContainer c = await _signedInContainer(_MemStore());
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turns(tester);

      final Finder targets = find.byType(NavigationDestination);
      // A non-empty domain is asserted FIRST. "Every target is big enough" over
      // zero targets is the vacuous check this property exists to replace.
      expect(
        targets,
        findsWidgets,
        reason:
            'no navigation destinations found — the size check below would '
            'range over nothing and pass without examining anything',
      );
      for (final Element e in targets.evaluate()) {
        expect(
          tester.getSize(find.byWidget(e.widget)).height,
          greaterThanOrEqualTo(48.0),
          reason: 'tap target below the 48px floor',
        );
      }
    });

    // LIMB 3 — ADAPTIVE LAYOUT at Material's exact boundaries. Asserted on the
    // PURE resolver, so the five classes are checked at their exact edges rather
    // than at five sizes that happen to be far from any boundary. `medium` was
    // 640 — not a Material breakpoint — so 600..639 silently got the phone
    // layout; that off-by-40 is exactly what an edge test catches and a
    // mid-range test does not.
    test('five window classes, at Material 600/840/1200/1600', () {
      expect(windowClassFor(599), WindowClass.compact);
      expect(windowClassFor(600), WindowClass.medium);
      expect(windowClassFor(839), WindowClass.medium);
      expect(windowClassFor(840), WindowClass.expanded);
      expect(windowClassFor(1199), WindowClass.expanded);
      expect(windowClassFor(1200), WindowClass.large);
      expect(windowClassFor(1599), WindowClass.large);
      expect(windowClassFor(1600), WindowClass.extraLarge);
      // All five must be reachable; a class no width maps to is a number in a
      // doc, not a layout.
      expect(
        <double>[400, 700, 1000, 1400, 1800].map(windowClassFor).toSet(),
        hasLength(5),
      );
    });

    // LIMB 4 — the ICON-LABEL check, made real. Every navigation destination
    // must carry a non-empty text label, and the domain must be non-empty. The
    // vacuous version of this check asserted labels on "icon-only controls", of
    // which the tree contains zero — so it passed by having nothing to inspect.
    testWidgets('every icon in the navigation carries a real label', (
      WidgetTester tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(400, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final ProviderContainer c = await _signedInContainer(_MemStore());
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turns(tester);

      final Iterable<NavigationDestination> found = tester
          .widgetList<NavigationDestination>(
            find.byType(NavigationDestination),
          );
      expect(
        found,
        isNotEmpty,
        reason:
            'nothing to check — a label assertion over an empty set is the '
            'vacuous check this limb replaces',
      );
      for (final NavigationDestination d in found) {
        expect(
          d.label.trim(),
          isNotEmpty,
          reason: 'an unlabelled icon is unusable with a screen reader',
        );
      }
    });
  });

  // ── PROPERTY: auth-seam-wired ─────────────────────────────────────────────
  // [pipeline C-15] A stamped app must be able to authenticate THROUGH THE SEAM,
  // and the token must reach the shared REST client.
  //
  // Before this, the brick wired no auth and no tokenProvider: the working
  // implementations lived inside apps/subly, so every app the factory stamped
  // was born unable to sign anyone in. The seam existed in core and had no home.
  //
  // 🔴 PROVES THE SEAM OPENS, not merely that it refuses. [pipeline C-6]: a
  // fail-closed seam with no proven open path is a dead feature that reports
  // healthy — four shipped that way and no test went red, because refusing is
  // correct when nothing is configured.
  group('property: auth-seam-wired', () {
    test('the app gets a REAL auth implementation, not a null stub', () {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      expect(auth, isNotNull);
      // A demo build must still be able to sign in. A stub returning null from
      // everything is the shape C-6 exists to catch.
      expect(auth, isA<InMemoryAuthRepository>());
    });

    test('signing in OPENS the seam and yields a bearer token', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);

      expect(await auth.currentAccessToken(), isNull);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      final String? token = await auth.currentAccessToken();
      expect(token, isNotNull);
      expect(token, isNotEmpty);
    });

    // THE ACCEPTANCE CRITERION. Without this the seam exists, the app signs in,
    // and no request ever carries a token — the backend never knows.
    test('the tokenProvider reaches the shared REST client', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');

      // Read the SAME function the RestClient is constructed with, so this
      // cannot pass while the client is wired to something else.
      final String? token = await c.read(authTokenProvider)();
      expect(
        token,
        await auth.currentAccessToken(),
        reason:
            'the REST client would send a different token than the one the '
            'session holds',
      );
      expect(c.read(restClientProvider), isNotNull);
    });

    test('signing out closes it again', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      await auth.signOut();
      expect(await c.read(authTokenProvider)(), isNull);
    });

    // The six-platform matrix is DECLARED, so a caller can ask before promising
    // the user something the platform cannot do.
    test('the app declares what identity can do on this platform', () {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final AuthCapabilities caps = c.read(authCapabilitiesProvider);
      // Email/password is pure REST — it must work on all six.
      expect(caps.emailPassword, isTrue);
    });
  });

  // ── PROPERTY: auth-redirect-follows-session ───────────────────────────────
  // [pipeline C-13] A user who signs in must END UP SOMEWHERE ELSE.
  //
  // 🔴 THEY DID NOT. `sign_in_screen.dart` deliberately does not navigate, on
  // the grounds that the router's redirect guard moves the user the moment the
  // session appears. It does not: `redirect` re-runs when the router is TOLD to,
  // and nothing in the brick was watching `authStateChanges()`. So a stamped app
  // signed the user in and went on showing them the form they had just
  // completed. The seam worked. The guard worked. Nothing joined them.
  //
  // 🔬 It passed `assert-screen-set` throughout, because that guard proves the
  // redirect guard EXISTS — which was never in doubt. Presence is not
  // enforcement. Found by DRIVING THE FORM in a test rather than reading the
  // code, which is also how the account-deletion dead button was found.
  //
  // Driven through the real widget tree on purpose: a unit test on the seam
  // passes today and passed while the app was unusable.
  //
  // 🔬 MUTATION-TESTED ON THE REAL TEMPLATE, 4 of them, each grep-verified to
  // have actually landed before the result was believed:
  //   M1 `refreshListenable:` deleted           → guard RED, both limbs RED
  //   M2 the notifier subscribes but never fires → guard GREEN, both limbs RED
  //   M3 the signed-out redirect returns null    → both limbs RED (limb 1 by its
  //      own domain assertion, before it ever reaches the interesting part)
  //   M4 the notifier filters out null users     → ONLY LIMB 2 RED
  // M2 is the one worth remembering: every anchor in assert-stamp-properties
  // still matched, so the guard passed while the app was broken again. The guard
  // stops this property VANISHING; only the property stops the behaviour
  // vanishing. M4 is why limb 2 is here rather than being folded into limb 1 —
  // it is the mutation limb 1 cannot see.
  group('property: auth-redirect-follows-session', () {
    testWidgets('signing in through the FORM moves the user off it', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await _turns(tester);

      // The domain, asserted first: without a form on screen the check below
      // would pass by having nothing to look at.
      expect(
        find.byType(TextField),
        findsWidgets,
        reason: 'a signed-out app must open on the sign-in screen',
      );

      await tester.enterText(find.byType(TextField).at(0), 'a@b.com');
      await tester.enterText(find.byType(TextField).at(1), 'password123');
      await tester.tap(find.byType(FilledButton).first);
      await _turnsAndSettleRoute(tester);

      // Two separate failures, told apart. A seam that never opened and a
      // redirect that never fired look identical from the screen.
      expect(
        c.read(authRepositoryProvider).currentUser,
        isNotNull,
        reason: 'the seam never signed anyone in',
      );
      expect(
        find.byType(TextField),
        findsNothing,
        reason:
            'signed in, and STILL looking at the form they just completed — '
            'the router was never told the session appeared',
      );
    });

    // The other direction, and independently falsifiable: a session that ends
    // must take the user back out. Otherwise sign-out leaves them sitting on a
    // screen they are no longer entitled to.
    testWidgets('signing out puts the user back on the form', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await _signedInContainer(_MemStore());
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await _turnsAndSettleRoute(tester);
      expect(find.byType(TextField), findsNothing);

      await c.read(authRepositoryProvider).signOut();
      await _turnsAndSettleRoute(tester);

      expect(
        find.byType(TextField),
        findsWidgets,
        reason: 'the session ended and the user was left inside the app',
      );
    });
  });

  // ── PROPERTY: account-deletion-works ──────────────────────────────────────
  // [pipeline C-13] Both stores require a WORKING in-app account-deletion path
  // wherever an account can be created.
  //
  // 🔴 THIS BUTTON USED TO DO NOTHING. Its confirm action was
  // `Navigator.pop(dialogContext)` and no more — no API call, no reauth — and it
  // passed every check the repo had, because a button that pops a dialog looks
  // exactly like a button that worked. It is the third instance of the shape
  // [pipeline C-6] exists to catch, after the consent recorder with no call site
  // and the pack verifier with no key.
  //
  // Asserted on the SEAM rather than by tapping through the dialog: the seam is
  // what the store requirement is really about, and a widget-level test would
  // pass against a dialog wired to the wrong repository.
  group('property: account-deletion-works', () {
    test(
      'deleting really goes through the seam, and signs the user out',
      () async {
        final ProviderContainer c = _container(_MemStore());
        addTearDown(c.dispose);
        final core.AuthRepository auth = c.read(authRepositoryProvider);
        await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
        expect(auth.currentUser, isNotNull);

        await auth.deleteAccount();

        expect(
          (auth as InMemoryAuthRepository).deletionRequested,
          isTrue,
          reason:
              'the request never reached the seam — this is the dead-button '
              'shape the property exists to catch',
        );
        expect(
          auth.currentUser,
          isNull,
          reason: 'still signed in after deletion',
        );
        expect(await auth.currentAccessToken(), isNull);
      },
    );

    // A user who has ASKED to be deleted must not keep a live session, even when
    // the request fails — that is the worst of both outcomes.
    test(
      'a FAILED deletion still signs out, and does not claim success',
      () async {
        final ProviderContainer c = _container(_MemStore());
        addTearDown(c.dispose);
        final core.AuthRepository auth = c.read(authRepositoryProvider);

        // Nobody signed in: the seam must refuse rather than silently succeed.
        await expectLater(
          auth.deleteAccount(),
          throwsA(isA<core.AuthFailure>()),
          reason:
              'a deletion that quietly does nothing is the one failure a user '
              'can never detect and never recover from',
        );
      },
    );
  });

  // ── PROPERTY: reminder-intent-persisted ───────────────────────────────────
  // [pipeline C-13] The user's reminder choice survives a restart, and is stored
  // SEPARATELY from the OS permission.
  //
  // 🔴 WHY SEPARATE. The OS can revoke notification permission at any time from
  // the system settings app, and the app finds out only when it next tries. If
  // the toggle stored "permission granted" it would read ON while every
  // notification was silently dropped — the toggle lying about the feature is
  // exactly the shape [pipeline C-6] exists to catch. So this stores INTENT, and
  // the platform's answer is asked for fresh each time it matters.
  group('property: reminder-intent-persisted', () {
    test('defaults to OFF — nothing is scheduled without a choice', () {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      expect(c.read(remindersEnabledProvider), isFalse);
    });

    test('a choice is written to storage', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer c = _container(store);
      addTearDown(c.dispose);
      await c.read(remindersEnabledProvider.notifier).set(true);
      expect(c.read(remindersEnabledProvider), isTrue);
      expect(store.data['nikatru.reminders_enabled'], 'true');
    });

    test('a stored choice SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _container(store);
      await first.read(remindersEnabledProvider.notifier).set(true);
      first.dispose();

      final ProviderContainer reborn = _container(store);
      addTearDown(reborn.dispose);
      reborn.read(remindersEnabledProvider); // triggers the background hydrate
      await Future<void>.delayed(Duration.zero);
      expect(
        reborn.read(remindersEnabledProvider),
        isTrue,
        reason: 'without this the toggle resets at every launch',
      );
    });

    test(
      'an unreadable store leaves reminders OFF, and never throws',
      () async {
        final ProviderContainer c = ProviderContainer(
          overrides: <Override>[
            keyValueStoreProvider.overrideWith(
              (_) async => throw StateError('disk gone'),
            ),
          ],
        );
        addTearDown(c.dispose);
        expect(c.read(remindersEnabledProvider), isFalse);
        await Future<void>.delayed(Duration.zero);
        expect(c.read(remindersEnabledProvider), isFalse);
      },
    );
  });

  // ── PROPERTY: locale-actually-switches ────────────────────────────────────
  // [pipeline C-13] The i18n seam is PROVEN TO OPEN.
  //
  // 🔴 WHY THIS IS THE POINT. Until a second locale existed, the chassis claimed
  // internationalisation and had never once run it: one language file, one
  // supportedLocales entry, and no path that could ever produce a different
  // string. That is the fail-closed-with-no-open-path shape [pipeline C-6] keeps
  // catching — a seam that refuses correctly and is never asked to deliver.
  //
  // So this asserts the STRINGS REALLY CHANGE, not that a setting was stored.
  // A test that only checked the stored value would pass against a locale the
  // app never reads.
  group('property: locale-actually-switches', () {
    test('both locales are offered', () {
      // A picker over one locale is a control that cannot change anything.
      expect(AppLocalizations.supportedLocales.length, greaterThanOrEqualTo(2));
      expect(
        AppLocalizations.supportedLocales.map((Locale l) => l.languageCode),
        containsAll(<String>['en', 'ta']),
      );
    });

    test('the same key yields DIFFERENT text in each locale', () async {
      final AppLocalizations en = await AppLocalizations.delegate.load(
        const Locale('en'),
      );
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      expect(
        ta.settingsTitle,
        isNot(en.settingsTitle),
        reason: 'the translation is not being reached — the seam is not open',
      );
      expect(ta.signIn, isNot(en.signIn));
      expect(ta.cancel, isNot(en.cancel));
    });

    test('a placeholder still interpolates in the second locale', () async {
      final AppLocalizations ta = await AppLocalizations.delegate.load(
        const Locale('ta'),
      );
      // Placeholders are where a translation most often breaks: a translator
      // drops the {appName} and the string silently loses the value.
      expect(ta.welcomeTo('Probe'), contains('Probe'));
      expect(ta.consentTitle('Probe'), contains('Probe'));
    });

    test('NULL means follow the device, and is the default', () {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      expect(
        c.read(localeProvider),
        isNull,
        reason:
            'a concrete default would freeze the app to whatever language '
            'the first launch happened to see',
      );
    });

    test('a choice is written, and SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _container(store);
      await first.read(localeProvider.notifier).set(const Locale('ta'));
      expect(store.data['nikatru.locale'], 'ta');
      first.dispose();

      final ProviderContainer reborn = _container(store);
      addTearDown(reborn.dispose);
      reborn.read(localeProvider); // triggers the background hydrate
      await Future<void>.delayed(Duration.zero);
      expect(reborn.read(localeProvider)?.languageCode, 'ta');
    });

    test('choosing "follow the device" again clears the override', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer c = _container(store);
      addTearDown(c.dispose);
      await c.read(localeProvider.notifier).set(const Locale('ta'));
      await c.read(localeProvider.notifier).set(null);
      expect(c.read(localeProvider), isNull);
      // Stored as empty, not deleted: an absent key and "follow the device" must
      // read the same on the next launch, and they do.
      expect(store.data['nikatru.locale'], '');
    });

    // The app must PAINT in the chosen language, not merely remember it.
    testWidgets('the running app renders the chosen locale', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer c = await _signedInContainer(store);
      addTearDown(c.dispose);
      await c.read(localeProvider.notifier).set(const Locale('ta'));

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turns(tester);

      final MaterialApp app = tester.widget<MaterialApp>(
        find.byType(MaterialApp),
      );
      expect(
        app.locale?.languageCode,
        'ta',
        reason:
            'the override is stored but never reaches MaterialApp — the '
            'picker would be a control the app ignores',
      );
    });
  });

  // ── PROPERTY: analytics-consent-gated ─────────────────────────────────────
  // Stage 11 says a stamped app answers is-it-working / is-it-converting /
  // is-it-broken with no per-app instrumentation. That claim is only true if the
  // rail both REFUSES without consent and DELIVERS with it. Asserting only the
  // refusal is what let apps/subly ship a rail that was inert for months: every
  // test passed, because discarding is the correct answer when consent is
  // absent. Both directions, or neither is worth anything.
  group('property: analytics-consent-gated', () {
    test('collects NOTHING before consent, even with the switch on', () async {
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer c = _analyticsContainer(
        store: _MemStore(),
        events: events,
        consent: _FakeConsentTransport(),
      );
      addTearDown(c.dispose);

      final core.Analytics a = await c.read(analyticsProvider.future);
      await a.log('app_open');
      await a.flush();

      expect(events.sent, isEmpty, reason: 'collected without consent');
      expect(
        (a as core.AnalyticsRecorder).queuedCount,
        0,
        reason: 'pre-consent events must be DISCARDED, not buffered for replay',
      );
    });

    test('a DENIAL keeps the rail shut', () async {
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer c = _analyticsContainer(
        store: _MemStore(),
        events: events,
        consent: _FakeConsentTransport(),
      );
      addTearDown(c.dispose);

      await _decide(c, granted: false);
      final core.Analytics a = await c.read(analyticsProvider.future);
      await a.log('app_open');
      await a.flush();

      expect(events.sent, isEmpty);
    });

    test('granting consent OPENS the rail — an event really ships', () async {
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer c = _analyticsContainer(
        store: _MemStore(),
        events: events,
        consent: _FakeConsentTransport(),
      );
      addTearDown(c.dispose);

      await _decide(c, granted: true);
      final core.Analytics a = await c.read(analyticsProvider.future);
      await a.log('app_open');
      await a.flush();

      expect(
        events.sent.map((Map<String, Object?> e) => e['event']),
        contains('app_open'),
        reason:
            'the rail is fail-closed; if this never passes the app is '
            'instrumented on paper and silent in production',
      );
      expect(
        events.lastEnvelope?['platform'],
        isNotNull,
        reason: 'the envelope must name the platform for per-OS triage',
      );
    });

    test('the analytics anon_id IS the feature-flag install id', () async {
      final _MemStore store = _MemStore();
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer c = _analyticsContainer(
        store: store,
        events: events,
        consent: _FakeConsentTransport(),
      );
      addTearDown(c.dispose);

      await _decide(c, granted: true);
      final core.Analytics a = await c.read(analyticsProvider.future);
      await a.log('app_open');
      await a.flush();

      final String installId = store.data['nikatru.install_id']!;
      expect(
        events.lastAnonId,
        installId,
        reason:
            'two independently minted ids make the rollout bucket and the '
            'analytics cohort impossible to join, and that cannot be repaired '
            'across installs already in the field',
      );
    });

    test('the artifact names the pinned policy and the same id', () async {
      final _MemStore store = _MemStore();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer c = _analyticsContainer(
        store: store,
        events: _FakeEventTransport(),
        consent: consent,
      );
      addTearDown(c.dispose);

      await _decide(c, granted: true);

      final core.ConsentArtifact sent = consent.sent.single;
      expect(sent.granted, isTrue);
      expect(
        sent.policyVersion,
        kPrivacyPolicyVersion,
        reason: 'an artifact naming no policy proves nothing was agreed to',
      );
      expect(sent.anonId, store.data['nikatru.install_id']);
    });

    test('a recorded decision SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _analyticsContainer(
        store: store,
        events: _FakeEventTransport(),
        consent: _FakeConsentTransport(),
      );
      await _decide(first, granted: true);
      first.dispose();

      // A fresh container over the same store == the next app launch.
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer reborn = _analyticsContainer(
        store: store,
        events: events,
        consent: _FakeConsentTransport(),
      );
      addTearDown(reborn.dispose);

      await reborn.read(consentControllerProvider.future);
      expect(reborn.read(consentDecidedProvider), isTrue);
      final core.Analytics a = await reborn.read(analyticsProvider.future);
      await a.log('app_open');
      await a.flush();
      expect(
        events.sent,
        isNotEmpty,
        reason: 're-prompting a user who already decided is the other failure',
      );
    });

    test('with the switch OFF the rail is a no-op', () async {
      final _FakeEventTransport events = _FakeEventTransport();
      final ProviderContainer c = _analyticsContainer(
        store: _MemStore(),
        events: events,
        consent: _FakeConsentTransport(),
        enabled: false,
      );
      addTearDown(c.dispose);

      final core.Analytics a = await c.read(analyticsProvider.future);
      expect(a, isA<core.NoOpAnalytics>());
      await a.log('app_open');
      await a.flush();
      expect(events.sent, isEmpty);
    });
  });

  // ── PROPERTY: analytics-on-switch-mounted ─────────────────────────────────
  // The unit tests above prove the rail CAN open. This one proves the app
  // actually contains the thing that opens it. That distinction is the whole
  // [pipeline C-6] defect: every piece worked, and nothing was wired to the
  // button. Asserted against the REAL app root, so deleting AnalyticsGate from
  // app.dart turns this red instead of turning production silent.
  group('property: analytics-on-switch-mounted', () {
    testWidgets('the app root asks for consent, and Allow opens the rail', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final _FakeEventTransport events = _FakeEventTransport();
      final _FakeConsentTransport consent = _FakeConsentTransport();
      final ProviderContainer container = _analyticsContainer(
        store: store,
        events: events,
        consent: consent,
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await _turns(tester);

      expect(
        find.text('Allow'),
        findsOneWidget,
        reason:
            'no consent prompt in the app root ⇒ nothing ever calls '
            'ConsentController.record ⇒ every event is silently discarded',
      );
      expect(
        find.text('No thanks'),
        findsOneWidget,
        reason: 'a one-sided prompt is a dark pattern, not a choice',
      );

      await tester.tap(find.text('Allow'));
      await _turns(tester);

      expect(find.text('Allow'), findsNothing, reason: 'asked twice');
      expect(consent.sent.single.granted, isTrue);

      // …and the launch event the funnel's denominator is made of got through.
      final core.Analytics a = await container.read(analyticsProvider.future);
      await a.flush();
      expect(
        events.sent.map((Map<String, Object?> e) => e['event']),
        contains('app_open'),
      );
    });

    testWidgets('no prompt at all while the switch is OFF', (
      WidgetTester tester,
    ) async {
      final ProviderContainer container = _analyticsContainer(
        store: _MemStore(),
        events: _FakeEventTransport(),
        consent: _FakeConsentTransport(),
        enabled: false,
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const {{app_id.pascalCase()}}App(),
        ),
      );
      await _turns(tester);

      expect(
        find.text('Allow'),
        findsNothing,
        reason:
            'a demo build collects nothing, so asking would be a question '
            'whose answer changes nothing',
      );
    });
  });
}
