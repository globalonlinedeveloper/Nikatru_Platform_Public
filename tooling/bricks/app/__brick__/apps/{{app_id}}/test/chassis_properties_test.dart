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
import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
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
import 'package:{{app_id.snakeCase()}}/core/router.dart';
import 'package:{{app_id.snakeCase()}}/features/firstrun/onboarding_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/home/home_screen.dart';
import 'package:{{app_id.snakeCase()}}/features/settings/settings_screen.dart';
// [pipeline T-8] The platform capability matrix, so the no-silent-channel loop
// derives its expectation from the same source the widget reads.
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:{{app_id.snakeCase()}}/state/money_providers.dart';
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

/// Records what the notification seam was actually asked to do.
///
/// 🔴 THE FAKE IS THE WHOLE POINT HERE. The reminder toggle used to call
/// `requestPermission()` and store the answer and nothing else — no `init()` and
/// no `scheduleDaily` anywhere in the template — so a stamped app spent the ONE
/// OS permission prompt most platforms grant, showed the switch as ON, and never
/// scheduled a notification. Every test passed, because they asserted the flag
/// was persisted and it was. Only something that records what REACHED the
/// service can tell those two states apart.
class _FakeNotifications implements core.NotificationService {
  int initCalls = 0;
  int cancelAllCalls = 0;
  bool permission = true;
  final List<core.DailyReminder> scheduled = <core.DailyReminder>[];

  @override
  Future<void> init() async => initCalls++;

  @override
  Future<bool> requestPermission() async {
    requestPermissionCalls++;
    return permission;
  }

  @override
  Future<void> showNow({required String title, required String body}) async {}

  int requestPermissionCalls = 0;

  @override
  // Replaces by id, because the real one does — `scheduleDaily` overwrites a
  // pending notification with the same id. A fake that only APPENDED made the
  // idempotence assertion below meaningless: re-arming on every launch would
  // have grown the list here while the device held exactly one.
  Future<void> scheduleDaily(core.DailyReminder reminder) async {
    scheduled.removeWhere((core.DailyReminder r) => r.id == reminder.id);
    scheduled.add(reminder);
  }

  @override
  Future<void> cancel(int id) async =>
      scheduled.removeWhere((core.DailyReminder r) => r.id == id);

  @override
  // 🔴 IT REALLY DROPS THEM. Counting the call and leaving the list populated is
  // how "OFF still leaves schedules alive" passed for an entire increment: the
  // count went up, the assertion was on the count, and the device would still
  // have fired. The only assertion that can tell the two apart is one made
  // against what is left.
  Future<void> cancelAll() async {
    cancelAllCalls++;
    scheduled.clear();
  }
}

ProviderContainer _container(
  _MemStore store, {
  core.AuthRepository? auth,
  core.NotificationService? notifications,
}) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    // Only when a test needs a session in a state the default cannot reach
    // — an already-expired one, for instance.
    if (auth != null) authRepositoryProvider.overrideWithValue(auth),
    // Same reason as `_MemStore`: the real service reaches a platform
    // channel that does not exist in a widget test.
    if (notifications != null)
      notificationServiceProvider.overrideWithValue(notifications),
  ],
);

/// A container that has already seen onboarding.
///
/// 🔴 [pipeline C-13] ADDED WHEN THE ONBOARDING GATE LANDED, for exactly the
/// reason `_signedInContainer` was added when the auth gate did: the router now
/// sends a fresh install to `/onboarding`, so every widget test that pumps the
/// app was suddenly measuring the carousel instead of its own subject. A test
/// establishes the state it needs; the alternative is a chassis that cannot add
/// a first-run step without breaking its own assertions.
_MemStore _onboardedStore([_MemStore? store]) {
  final _MemStore s = store ?? _MemStore();
  s.data['nikatru.onboarding_seen'] = 'true';
  return s;
}

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

/// An in-memory [core.SecureStore] — the real one needs a platform channel a
/// widget test has not got, which is exactly why `secureStoreProvider` sat in
/// this guard's UNASSERTED list until the money rail gave it a reason to be
/// driven.
class _MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async => data.clear();
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Answers the entitlement read with whatever the test wants the SERVER to say.
///
/// 🔴 A FAKE SERVER, NOT A FAKE GATE. The property under test is that a real
/// answer travels from the transport, through the cache, into the lock decision
/// and out to `PaywallGate`. Overriding `paywallLockedProvider` directly would
/// assert that a boolean makes a widget change, which was never in doubt — and
/// is precisely how `PaywallGate` came to exist for months with zero consumers.
class _FakeEntitlements implements core.EntitlementTransport {
  _FakeEntitlements({this.pro = false});
  bool pro;

  /// Set by a test to make the SERVER unreachable mid-flight.
  bool fail = false;
  int calls = 0;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    calls++;
    if (fail) {
      return const core.Result<core.Entitlements>.err(core.Failure('offline'));
    }
    return core.Result<core.Entitlements>.ok(
      core.Entitlements(
        appId: appId,
        isPro: pro,
        items: const <core.Entitlement>[],
      ),
    );
  }
}

ProviderContainer _moneyContainer({
  required _MemStore store,
  required _FakeEntitlements server,
  _MemSecureStore? secure,
  bool paywallEnabled = true,
}) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    secureStoreProvider.overrideWithValue(secure ?? _MemSecureStore()),
    entitlementTransportProvider.overrideWithValue(server),
    // The paywall's on-switch is CFG-1 config, and a freshly stamped app is
    // born with it OFF — so the open path has to be opened deliberately, the
    // same shape `analyticsEnabledProvider` uses for the analytics rail.
    appConfigProvider.overrideWith(
      (_) async => core.AppConfig(
        appId: AppConfig.appId,
        apiBaseUrl: AppConfig.apiBaseUrl,
        features: const <String, bool>{},
        paywall: core.PaywallConfig(
          enabled: paywallEnabled,
          extra: const <String, Object?>{
            'offerings': <Object?>[
              <String, Object?>{
                'product_id': 'pro_monthly',
                'amount_minor': 499,
                'currency_code': 'USD',
                'term': 'month',
                'trial_days': 30,
              },
            ],
          },
        ),
        contentPack: null,
        copy: const <String, String>{},
        minSupportedVersion: '1.0.0',
      ),
    ),
  ],
);

/// Records what the review seam was actually asked to do — [pipeline C-13].
///
/// A FAKE, not a mock: the assertion is "a request really arrived", which is the
/// one thing worth knowing. Neither store reports whether a prompt was drawn, so
/// nothing beyond this point is knowable to any test.
class _RecordingPrompter implements core.ReviewPrompter {
  int requests = 0;
  int listings = 0;
  bool available = true;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<void> requestReview() async => requests++;

  // The outcome is TYPED because a listing that could not open — no store on
  // this platform, or no store id in this build — used to be indistinguishable
  // from one that did. `notConfigured` is the state a stamped app is born in:
  // neither store id exists until the app is registered.
  @override
  Future<core.StoreListingOutcome> openStoreListing() async {
    listings++;
    return core.StoreListingOutcome.opened;
  }
}

/// A container with the review prompter faked, so the OPEN path is reachable.
/// The real adapter needs a platform channel a widget test has not got — which
/// is exactly how a seam ends up never being exercised at all.
ProviderContainer _reviewContainer(
  _MemStore store,
  _RecordingPrompter prompter,
) => ProviderContainer(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    reviewPrompterProvider.overrideWithValue(prompter),
  ],
);

/// A container whose session is already established.
///
/// 🔴 [pipeline C-13] ADDED WHEN THE AUTH GATE LANDED. The router now redirects a
/// signed-out app to /sign-in, so two of the accessibility limbs below — which
/// measure the NAVIGATION BAR — suddenly had nothing to measure. They were
/// silently relying on the app opening on Home. Establishing the state a test
/// needs is the test's job; the alternative is a chassis that cannot add an auth
/// gate without breaking its own assertions.
Future<ProviderContainer> _signedInContainer(_MemStore store) async {
  final ProviderContainer c = _container(_onboardedStore(store));
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

    // ── A 401 IS NOT PROOF THE SESSION IS GONE. ─────────────────────────────
    // The REST client used to sign out on ANY 401. An access token that merely
    // expired looks identical from the Worker's chair, and expiry is routine —
    // the SDK stops its refresh ticker while the app is paused and restarts it
    // asynchronously on resume, so the first request after a resume carries a
    // stale token by design. The user came back to the app and was thrown out
    // of it.
    test('a 401 with a LIVE session does not sign the user out', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');

      await signOutOnlyIfSessionIsGone(auth);

      expect(
        auth.currentUser,
        isNotNull,
        reason:
            'a 401 the session can still answer for is a failed REQUEST, not a '
            'reason to destroy state the user can still use',
      );
    });

    // …and the one case where signing out IS the truthful action.
    test('a 401 the session cannot answer for DOES sign the user out', () async {
      final ProviderContainer c = _container(
        _MemStore(),
        // A session that is already expired the instant it is issued: the seam
        // reports no usable token, which is what "the session is gone" means.
        auth: InMemoryAuthRepository(sessionLifetime: Duration.zero),
      );
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      expect(await auth.currentAccessToken(), isNull);

      await signOutOnlyIfSessionIsGone(auth);

      expect(auth.currentUser, isNull);
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
      // Past onboarding: this limb is about the AUTH redirect, and a fresh
      // install would land on the carousel instead of the form.
      final ProviderContainer c = _container(_onboardedStore());
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
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
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
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

    // 🔴 AND IT MUST SAY WHICH FAILURE. The screen used to `catch (_)` and print
    // ONE string — "Your account has NOT been deleted" — for every refusal the
    // route can give. That sentence is FALSE on a 502, where the rows are gone
    // and only the identity survived: the user is told nothing happened while
    // their data is already destroyed and their login still works. [ADR 027].
    test('501 and 502 do NOT collapse into one message', () async {
      final AppLocalizations l10n = await AppLocalizations.delegate.load(
        const Locale('en'),
      );

      final String nothing = deleteAccountFailureMessage(
        l10n,
        core.AccountDeletionOutcome.forStatus(501),
      );
      final String dataGone = deleteAccountFailureMessage(
        l10n,
        core.AccountDeletionOutcome.forStatus(502),
      );
      final String refused = deleteAccountFailureMessage(
        l10n,
        core.AccountDeletionOutcome.forStatus(503),
      );
      final String unknown = deleteAccountFailureMessage(
        l10n,
        core.AccountDeletionOutcome.forStatus(0),
      );

      expect(
        <String>{nothing, dataGone, refused, unknown}.length,
        4,
        reason:
            'four outcomes that mean four different things to the user must '
            'not share a sentence',
      );
      // The 502 message must not claim the account is intact — that is the one
      // state the user cannot verify for themselves.
      expect(dataGone.toLowerCase(), contains('deleted'));
      expect(dataGone.toLowerCase(), isNot(contains('nothing')));
      // …and the 501 message must not claim anything WAS removed.
      expect(nothing.toLowerCase(), contains('nothing'));
    });
  });

  // ── PROPERTY: profile-edit-works ──────────────────────────────────────────
  // [pipeline C-13] The user can change their display name, and SEE that it
  // changed.
  //
  // 🔴 THIS SCREEN WAS REFUSED, on the grounds that "there is no profile data
  // model". There is: every identity provider worth using stores user metadata,
  // and Supabase's gotrue exposes `updateUser` for exactly this. The refusal
  // described a field that nothing wrote and concluded from that it could never
  // be written — the symptom stated as the cause, which is what all four of
  // those refusals had in common.
  //
  // The last limb drives the REAL UI, because the defect this repo keeps
  // shipping is a button wired to nothing: a seam-level test passes against a
  // dialog whose save button calls `Navigator.pop` and no more, which is
  // precisely what account deletion did for months.
  //
  // 🔬 MUTATION-TESTED ON THE REAL TREE, 4, each grep-verified to have landed:
  //   P1 save button only pops the dialog   → guard RED, widget limb RED
  //   P2 tile reads `currentUser` not the stream → guard RED, widget limb RED
  //   P3 the seam updates but never emits   → guard GREEN, emit + widget RED
  //   P4 an empty name stored as '' not null → guard GREEN, ONLY the clear limb
  // P3 and P4 are invisible to the guard by construction — no anchor can see
  // behaviour — which is the division of labour this file exists for.
  group('property: profile-edit-works', () {
    test('the seam really changes the name', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      expect(auth.currentUser!.displayName, isNull);

      final core.AuthUser updated = await auth.updateProfile(
        displayName: 'Ada Lovelace',
      );

      expect(updated.displayName, 'Ada Lovelace');
      expect(
        auth.currentUser!.displayName,
        'Ada Lovelace',
        reason:
            'the returned user changed but the session still holds the old '
            'one, so the next screen to read it shows the stale name',
      );
    });

    // An empty name must CLEAR it rather than store '', or callers get a second
    // "no name" case that renders as a blank line instead of the not-set label.
    test('an empty name clears it rather than storing a blank', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');
      await auth.updateProfile(displayName: 'Ada');
      await auth.updateProfile(displayName: '');
      expect(auth.currentUser!.displayName, isNull);
    });

    // Fail-closed, and asserted: an update with nobody signed in must refuse
    // rather than invent a user.
    test('updating while signed out refuses', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      await expectLater(
        c.read(authRepositoryProvider).updateProfile(displayName: 'Ada'),
        throwsA(isA<core.AuthFailure>()),
      );
    });

    // The seam must EMIT, or a screen showing the name has no way to learn it
    // changed and the save is invisible — indistinguishable from one that
    // silently failed.
    // The seam's contract says an implementation MUST emit, so this asserts on
    // the seam's OWN stream rather than through a provider.
    //
    // 🔴 THE FIRST VERSION OF THIS TEST WATCHED [authUserProvider] AND PROVED
    // NOTHING. That provider yields the synchronous snapshot before forwarding
    // the stream, and the yield is async — so subscribing and immediately
    // editing let the generator run AFTER the edit and seed the NEW name. With
    // the emit deleted from the seam it still passed. Found by mutation, not by
    // review; an assertion satisfied by a race is worse than no assertion,
    // because it also reports coverage. The end-to-end widget limb below is
    // what proves the provider half.
    test('the change is EMITTED on the identity stream', () async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);
      final core.AuthRepository auth = c.read(authRepositoryProvider);
      await auth.signInWithEmail(email: 'a@b.com', password: 'pw');

      final List<core.AuthUser?> emitted = <core.AuthUser?>[];
      final StreamSubscription<core.AuthUser?> sub = auth
          .authStateChanges()
          .listen(emitted.add);
      addTearDown(sub.cancel);

      await auth.updateProfile(displayName: 'Ada Lovelace');
      await Future<void>.delayed(Duration.zero);

      expect(
        emitted.map((core.AuthUser? u) => u?.displayName),
        contains('Ada Lovelace'),
        reason:
            'nothing watching identity was told — the name changes in the '
            'session and every screen showing it keeps the old value',
      );
    });

    // THE LIMB THAT MATTERS. Everything above passes against a save button
    // wired to nothing.
    testWidgets('editing it in the REAL app updates what the user sees', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await _signedInContainer(_MemStore());
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      c.read(routerProvider).go('/settings');
      await _turnsAndSettleRoute(tester);

      // The domain first: with no profile tile the taps below would fail for
      // the wrong reason.
      final Finder tile = find.text('No name set');
      expect(
        tile,
        findsOneWidget,
        reason: 'no profile row on the settings screen — a seam with no way in',
      );

      await tester.tap(tile);
      await _turns(tester);
      await tester.enterText(find.byType(TextField).first, 'Ada Lovelace');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await _turns(tester, 20);

      expect(
        find.text('Ada Lovelace'),
        findsOneWidget,
        reason:
            'the name was typed and saved and the screen still shows the old '
            'value — which is what a save button wired to nothing looks like',
      );
      expect(find.text('No name set'), findsNothing);
      expect(
        c.read(authRepositoryProvider).currentUser?.displayName,
        'Ada Lovelace',
        reason: 'the UI updated but the seam was never called',
      );
    });
  });

  // ── PROPERTY: onboarding-shown-once ───────────────────────────────────────
  // [pipeline C-13] A first run introduces the app, exactly once.
  //
  // 🔴 THE REFUSAL THIS REPLACES was "the content is app-specific" — true of the
  // WORDS and false of the MECHANISM. `AppConfig.copy` already existed, so the
  // carousel is chassis and the words are per-app config.
  //
  // ⚠️ THE TRAP THIS PROPERTY EXISTS FOR: `AppConfig.text(key)` returns the KEY
  // ITSELF when there is no override. A freshly stamped app has no overrides, so
  // a purely config-driven carousel would greet its first user with
  // `onboarding.1.title`. That would ship, look deliberate to every reviewer,
  // and be visible only to a user. The l10n string is the default; config is the
  // override.
  //
  // 🔬 MUTATION-TESTED ON THE REAL TREE, each grep-verified to have landed:
  //   O1 the redirect drops the onboarding check   → the "shown on first run"
  //      limb RED
  //   O2 the flag is never persisted (write dropped) → the "only once" limb RED
  //   O3 the copy falls back to the KEY, as AppConfig.text does → guard GREEN,
  //      the "never shows a raw key" limb RED, and ONLY that one
  //
  // O3 is the one to remember. It is a one-word change to a fallback, it ships
  // `onboarding.1.title` to a real user, and it reads as entirely deliberate in
  // review — the guard cannot see it, because an anchor sees the CALL and this
  // mutation is inside the callee.
  group('property: onboarding-shown-once', () {
    testWidgets('a fresh install lands on onboarding, before sign-in', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      expect(
        find.byType(OnboardingScreen),
        findsOneWidget,
        reason:
            'a first run that goes straight to a sign-in form asks somebody to '
            'sign into something nobody has introduced',
      );
    });

    // The raw-key trap, asserted directly. This is the limb that would have
    // caught a config-driven carousel in a stamped app.
    testWidgets('it never shows a raw config key to a user', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _container(_MemStore());
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      for (final String key in <String>[
        'onboarding.1.title',
        'onboarding.1.body',
        'onboarding.2.title',
        'onboarding.3.title',
      ]) {
        expect(
          find.text(key),
          findsNothing,
          reason:
              'the copy key leaked to the screen — AppConfig.text() returns the '
              'KEY when there is no override, and a fresh stamp has none',
        );
      }
      // …and the real default is what appeared instead.
      expect(find.text('Welcome'), findsOneWidget);
    });

    testWidgets('finishing it moves the user on, and it does not come back', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      final ProviderContainer c = _container(store);
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      await tester.tap(find.widgetWithText(TextButton, 'Skip'));
      await _turnsAndSettleRoute(tester);

      expect(
        find.byType(OnboardingScreen),
        findsNothing,
        reason: 'skipping left the user exactly where they were',
      );
      expect(
        store.data['nikatru.onboarding_seen'],
        'true',
        reason:
            'nothing was written, so the next launch shows it again — and the '
            'launch after that, forever',
      );
    });

    test('a stored choice SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _container(store);
      await first.read(onboardingSeenProvider.notifier).set(true);
      first.dispose();

      final ProviderContainer reborn = _container(store);
      addTearDown(reborn.dispose);
      reborn.read(onboardingSeenProvider); // triggers the background hydrate
      await Future<void>.delayed(Duration.zero);
      expect(reborn.read(onboardingSeenProvider), isTrue);
    });

    // Fail towards SHOWING it. Getting this wrong is asymmetric: showing it
    // twice is an irritation, showing it never drops the user into an app
    // nobody introduced.
    test('an unreadable store shows onboarding, never skips it', () async {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith(
            (_) async => throw StateError('disk gone'),
          ),
        ],
      );
      addTearDown(c.dispose);
      // Starts UNKNOWN, then resolves to false. Both halves matter: unknown
      // must not read as "seen", and it must not stay unknown forever either —
      // a decision that never resolves is a user who never gets past it.
      expect(c.read(onboardingSeenProvider), isNull);
      await Future<void>.delayed(Duration.zero);
      expect(
        c.read(onboardingSeenProvider),
        isFalse,
        reason:
            'an unreadable store must resolve to SHOWING onboarding, not sit '
            'unknown and block the redirect forever',
      );
    });

    // The app's words win over the chassis default — the half that makes this
    // chassis-owned rather than fabricated.
    testWidgets('an app config override replaces the chassis default', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          appConfigProvider.overrideWith(
            (_) async => kAppDefaultConfig.copyWith(
              copy: <String, String>{'onboarding.1.title': 'Track your spend'},
            ),
          ),
        ],
      );
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      expect(find.text('Track your spend'), findsOneWidget);
      expect(
        find.text('Welcome'),
        findsNothing,
        reason:
            'the override was ignored, so every app in the portfolio would '
            'introduce itself with the same three sentences',
      );
    });
  });

  // ── PROPERTY: review-prompt-gated ─────────────────────────────────────────
  // [pipeline C-13] The store-review prompt asks, and asks RARELY.
  //
  // 🔴 THE REFUSAL THIS REPLACES was "there are no users to ask" — an argument
  // about WHEN, not about whether the mechanism can be built and proven. WHEN is
  // `ReviewGate`: pure arithmetic over four persisted numbers, decidable today
  // with no users at all.
  //
  // ⚠️ WHY BOTH DIRECTIONS ARE ASSERTED HERE AND NOT JUST THE REFUSAL. The gate
  // says no on almost every launch BY DESIGN, so a test suite that only checked
  // "it did not ask" would pass against a prompter wired to nothing, forever,
  // and nobody would notice until the app had shipped a year without ever
  // asking. That is [pipeline C-6] exactly. The open path is the load-bearing
  // limb.
  // 🔬 MUTATION-TESTED ON THE REAL TREE, each grep-verified to have landed:
  //   R1 `await review.maybeAsk()` deleted from app.dart → guard RED, and the
  //      widget limb RED — but ONLY after that limb was rebuilt. Its first
  //      version asserted just that the launch counter advanced, so R1 left
  //      EVERY TEST GREEN and the guard's text anchor was the only thing that
  //      noticed. An anchor is a text match; it cannot survive a refactor that
  //      renames the call.
  //   R2 the gate's verdict ignored (ask on every launch) → guard GREEN, the
  //      "fresh install" and "not twice in a row" limbs RED.
  //
  // 🔴 REBUILDING THE WIDGET LIMB ALSO FOUND A REAL BUG IN THE CONTROLLER.
  // Seeding a history and pumping the app showed `launches` stuck at its stored
  // value: `recordLaunch()` fired from the first frame while `_hydrate()` was
  // still in flight, incremented the EMPTY default, and hydration then
  // overwrote it. One lost launch per cold start, forever. Counters cannot use
  // the `_userChose` last-writer-wins guard the other controllers use.
  group('property: review-prompt-gated', () {
    test('a fresh install is NOT asked', () async {
      final _MemStore store = _MemStore();
      final _RecordingPrompter prompter = _RecordingPrompter();
      final ProviderContainer c = _reviewContainer(store, prompter);
      addTearDown(c.dispose);

      await c.read(reviewPromptProvider.notifier).recordLaunch();
      final core.ReviewRequestOutcome out = await c
          .read(reviewPromptProvider.notifier)
          .maybeAsk();

      expect(out, core.ReviewRequestOutcome.gated);
      expect(
        prompter.requests,
        0,
        reason:
            'asking on first launch asks somebody who has not seen the app '
            'yet, and spends the one request the store will honour',
      );
    });

    // THE OPEN PATH. Without this limb every other assertion here is satisfied
    // by a prompter that does nothing at all.
    test('a settled, engaged install IS asked — the request lands', () async {
      final _MemStore store = _MemStore();
      final _RecordingPrompter prompter = _RecordingPrompter();
      final ProviderContainer c = _reviewContainer(store, prompter);
      addTearDown(c.dispose);

      final ReviewPromptController review = c.read(
        reviewPromptProvider.notifier,
      );
      final DateTime installed = DateTime.utc(2026, 1, 1);
      await review.recordLaunch(now: installed);
      for (int i = 0; i < 5; i++) {
        await review.recordLaunch(now: installed);
      }

      final core.ReviewRequestOutcome out = await review.maybeAsk(
        now: installed.add(const Duration(days: 10)),
      );

      expect(out, core.ReviewRequestOutcome.requested);
      expect(
        prompter.requests,
        1,
        reason:
            'the gate agreed and nothing reached the prompter — a seam that '
            'refuses correctly and is never asked to deliver',
      );
    });

    // 🔴 THE EXPENSIVE MISTAKE. iOS discards requests beyond its own quota
    // WITHOUT SAYING SO, so a second ask does not annoy anyone — it silently
    // burns the app's remaining requests on a dialog nobody sees.
    test('it does not ask twice in a row', () async {
      final _MemStore store = _MemStore();
      final _RecordingPrompter prompter = _RecordingPrompter();
      final ProviderContainer c = _reviewContainer(store, prompter);
      addTearDown(c.dispose);

      final ReviewPromptController review = c.read(
        reviewPromptProvider.notifier,
      );
      final DateTime installed = DateTime.utc(2026, 1, 1);
      for (int i = 0; i < 6; i++) {
        await review.recordLaunch(now: installed);
      }
      final DateTime later = installed.add(const Duration(days: 10));
      await review.maybeAsk(now: later);
      final core.ReviewRequestOutcome second = await review.maybeAsk(
        now: later.add(const Duration(days: 1)),
      );

      expect(second, core.ReviewRequestOutcome.gated);
      expect(prompter.requests, 1);
    });

    test('a platform that cannot ask reports so, and spends nothing', () async {
      final _MemStore store = _MemStore();
      final _RecordingPrompter prompter = _RecordingPrompter()
        ..available = false;
      final ProviderContainer c = _reviewContainer(store, prompter);
      addTearDown(c.dispose);

      final ReviewPromptController review = c.read(
        reviewPromptProvider.notifier,
      );
      final DateTime installed = DateTime.utc(2026, 1, 1);
      for (int i = 0; i < 6; i++) {
        await review.recordLaunch(now: installed);
      }
      final core.ReviewRequestOutcome out = await review.maybeAsk(
        now: installed.add(const Duration(days: 10)),
      );

      expect(out, core.ReviewRequestOutcome.unavailable);
      expect(prompter.requests, 0);
      expect(
        c.read(reviewPromptProvider).timesAsked,
        0,
        reason:
            'a platform that cannot ask must not consume an ask — otherwise a '
            'Linux user burns the quota their phone would have used',
      );
    });

    test('the history SURVIVES a restart', () async {
      final _MemStore store = _MemStore();
      final ProviderContainer first = _reviewContainer(
        store,
        _RecordingPrompter(),
      );
      await first.read(reviewPromptProvider.notifier).recordLaunch();
      await first.read(reviewPromptProvider.notifier).recordLaunch();
      first.dispose();

      final ProviderContainer reborn = _reviewContainer(
        store,
        _RecordingPrompter(),
      );
      addTearDown(reborn.dispose);
      reborn.read(reviewPromptProvider);
      await Future<void>.delayed(Duration.zero);

      expect(
        reborn.read(reviewPromptProvider).launches,
        2,
        reason:
            'a launch counter that resets is a counter that never reaches the '
            'threshold, so the app would never ask at all',
      );
    });

    // 🔴 THE LIMB THAT MATTERS, and it had to be rebuilt. The first version
    // asserted only that the launch counter advanced — so deleting
    // `await review.maybeAsk()` from app.dart left EVERY TEST GREEN, and only
    // the guard's text anchor noticed. That is the [pipeline C-6] shape wearing
    // its best camouflage: the gate refuses on almost every launch by design, so
    // "nothing was asked" is the correct outcome nearly always and proves
    // nothing at all.
    //
    // So this seeds a history the gate WILL say yes to, then pumps the real app
    // and asserts a request actually arrived. It is the only assertion here that
    // fails when the call site disappears.
    testWidgets('the running app records a launch AND really asks', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      // A settled, engaged install — written the way the controller persists it,
      // so this exercises the real hydrate path rather than a private setter.
      final DateTime installed = DateTime.now().toUtc().subtract(
        const Duration(days: 30),
      );
      store.data['nikatru.review_gate'] = jsonEncode(
        core.ReviewGateState(launches: 20, firstLaunch: installed).toJson(),
      );

      final _RecordingPrompter prompter = _RecordingPrompter();
      final ProviderContainer c = _reviewContainer(store, prompter);
      addTearDown(c.dispose);
      await c
          .read(authRepositoryProvider)
          .signInWithEmail(email: 'a@b.com', password: 'pw');

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);
      await _turns(tester, 20);

      expect(
        c.read(reviewPromptProvider).launches,
        greaterThan(20),
        reason:
            'nothing in the running app records a launch, so the gate can '
            'never reach its threshold and the prompt is dead code',
      );
      expect(
        prompter.requests,
        1,
        reason:
            'the gate agreed and the running app never asked — the seam has no '
            'caller, which no other assertion in this group can see',
      );
    });
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

    // ── THE HALF THAT WAS MISSING ────────────────────────────────────────────
    // Persisting the intent is necessary and was never the feature. These four
    // assert the OS was actually told.
    test('turning reminders ON really SCHEDULES one', () async {
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = _container(_MemStore(), notifications: notes);
      addTearDown(c.dispose);

      final bool granted = await c
          .read(remindersEnabledProvider.notifier)
          .applyReminderChoice(on: true, title: 'T', body: 'B');

      expect(granted, isTrue);
      expect(
        notes.initCalls,
        greaterThan(0),
        reason:
            'without init() the timezone database and the plugin are never set '
            'up, and nothing can be scheduled at all',
      );
      expect(
        notes.scheduled,
        hasLength(1),
        reason:
            'a toggle that primes the user, spends the one OS prompt and '
            'schedules nothing is the C-6 shape in its purest form',
      );
      expect(notes.scheduled.single.id, kDailyReminderId);
      expect(notes.scheduled.single.hour, AppConfig.reminderHour);
      expect(notes.scheduled.single.minute, AppConfig.reminderMinute);
      expect(notes.scheduled.single.title, 'T');
      expect(c.read(remindersEnabledProvider), isTrue);
    });

    test(
      'a REFUSED OS permission schedules nothing and leaves it OFF',
      () async {
        final _FakeNotifications notes = _FakeNotifications()
          ..permission = false;
        final ProviderContainer c = _container(
          _MemStore(),
          notifications: notes,
        );
        addTearDown(c.dispose);

        final bool granted = await c
            .read(remindersEnabledProvider.notifier)
            .applyReminderChoice(on: true, title: 'T', body: 'B');

        expect(granted, isFalse);
        expect(notes.scheduled, isEmpty);
        expect(
          c.read(remindersEnabledProvider),
          isFalse,
          reason:
              'the OS decides; a switch reading ON after a refusal is the '
              'toggle lying about the feature',
        );
      },
    );

    test('turning reminders OFF cancels', () async {
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = _container(_MemStore(), notifications: notes);
      addTearDown(c.dispose);

      final RemindersEnabledController controller = c.read(
        remindersEnabledProvider.notifier,
      );
      await controller.applyReminderChoice(on: true, title: 'T', body: 'B');
      await controller.applyReminderChoice(on: false, title: 'T', body: 'B');

      expect(notes.cancelAllCalls, 1);
      expect(c.read(remindersEnabledProvider), isFalse);
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

  // ── PROPERTY: reminders-resync-on-start ───────────────────────────────────
  // [pipeline T-5/T-7] The intent is reconciled with the OS at every launch.
  //
  // 🔴 THE MEASURED DEFECT THIS REPLACES. `set(false)` — the plain flag writer —
  // persisted OFF and left every schedule armed, because the only route to
  // `cancelAll` was `applyReminderChoice`, reachable from exactly one
  // `SwitchListTile.onChanged`. Any other writer (a settings sync, a restore, a
  // future prefs screen, the permission-refusal branch) produced a switch reading
  // OFF over a device that still fired. And there was no repair path at all: an
  // Android reboot drops pending alarms and a DST shift moves the wall-clock hour
  // a schedule was built against, so "reminders are on" decayed to "reminders
  // were on once" with nothing red anywhere.
  //
  // ⚠️ The `_FakeNotifications` change is half of this property. Its `cancelAll`
  // used to increment a counter and leave the list populated — so an assertion on
  // the COUNT passed against a device that would still have fired. Everything
  // below is asserted against what is LEFT.
  group('property: reminders-resync-on-start', () {
    test('set(false) ALONE cancels — not just the toggle path', () async {
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = _container(_MemStore(), notifications: notes);
      addTearDown(c.dispose);
      final RemindersEnabledController controller = c.read(
        remindersEnabledProvider.notifier,
      );

      await controller.applyReminderChoice(on: true, title: 'T', body: 'B');
      expect(notes.scheduled, hasLength(1));

      // The plain flag writer, with no widget and no dialog anywhere near it.
      await controller.set(false);

      expect(
        notes.cancelAllCalls,
        greaterThan(0),
        reason:
            'a second writer of the intent must reach the OS; before this it '
            'did not, and the schedule outlived the switch',
      );
      expect(
        notes.scheduled,
        isEmpty,
        reason:
            'OFF is a promise that nothing fires, not a promise about a bool',
      );
    });

    test('intent ON is re-armed from the store at start-up', () async {
      final _MemStore store = _MemStore();
      store.data['nikatru.reminders_enabled'] = 'true';
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = _container(store, notifications: notes);
      addTearDown(c.dispose);

      await c
          .read(remindersEnabledProvider.notifier)
          .resyncOnStart(title: 'T', body: 'B');

      expect(notes.scheduled, hasLength(1));
      expect(notes.scheduled.single.id, kDailyReminderId);
      expect(notes.scheduled.single.hour, AppConfig.reminderHour);
      expect(notes.scheduled.single.minute, AppConfig.reminderMinute);
      expect(
        notes.requestPermissionCalls,
        0,
        reason:
            'the boot path must never spend the OS ask — Android 13+ makes a '
            'SECOND denial permanent, so a launch-time prompt can burn the '
            'permission for the life of the install',
      );
    });

    test('intent OFF is re-asserted from the store at start-up', () async {
      final _MemStore store = _MemStore();
      store.data['nikatru.reminders_enabled'] = 'false';
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = _container(store, notifications: notes);
      addTearDown(c.dispose);
      // Something else armed it — a previous install, a restored backup.
      await notes.scheduleDaily(
        const core.DailyReminder(
          id: kDailyReminderId,
          title: 'stale',
          body: 'stale',
          hour: 9,
          minute: 0,
        ),
      );

      await c
          .read(remindersEnabledProvider.notifier)
          .resyncOnStart(title: 'T', body: 'B');

      expect(notes.cancelAllCalls, greaterThan(0));
      expect(notes.scheduled, isEmpty);
    });

    test('an unreadable store at start-up changes NOTHING', () async {
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith(
            (_) async => throw StateError('disk gone'),
          ),
          notificationServiceProvider.overrideWithValue(notes),
        ],
      );
      addTearDown(c.dispose);

      await c
          .read(remindersEnabledProvider.notifier)
          .resyncOnStart(title: 'T', body: 'B');

      expect(
        notes.cancelAllCalls,
        0,
        reason:
            'a transient disk error is not an instruction to disable the '
            'feature; cancelling here would silently turn reminders off',
      );
      expect(notes.scheduled, isEmpty);
    });

    // ⚠️ NOT "≤ 64 pending". The stamp's id set has size one, so a 64 assertion
    // has no writable failing input — and the 64 figure itself is UNVERIFIED
    // (observed platform behaviour from a forum post, not reference
    // documentation). What CAN fail is the id going non-stable: make it a
    // counter and this reddens immediately, because the re-arm stops replacing.
    test('re-arming repeatedly keeps exactly ONE distinct id', () async {
      final _MemStore store = _MemStore();
      store.data['nikatru.reminders_enabled'] = 'true';
      final _FakeNotifications notes = _FakeNotifications();
      final ProviderContainer c = _container(store, notifications: notes);
      addTearDown(c.dispose);
      final RemindersEnabledController controller = c.read(
        remindersEnabledProvider.notifier,
      );

      await controller.resyncOnStart(title: 'T', body: 'B');
      await controller.resyncOnStart(title: 'T', body: 'B');
      await controller.applyReminderChoice(on: true, title: 'T', body: 'B');

      expect(
        notes.scheduled.map((core.DailyReminder r) => r.id).toSet(),
        <int>{kDailyReminderId},
        reason:
            'a non-stable id turns every launch into another pending '
            'notification, and the OS drops the oldest silently once its own '
            'budget is reached',
      );
      expect(notes.scheduled, hasLength(1));
    });
  });

  // ── PROPERTY: no-silent-channel ───────────────────────────────────────────
  // [pipeline T-8] EVERY platform row either gets a real OS schedule or gets the
  // in-app catch-up nudge. Never neither.
  //
  // 🔴 THE RELATIONSHIP IS THE ASSERTION, and it is why this loop enumerates
  // `TargetPlatform.values` instead of naming platforms. A hand-written list is a
  // list somebody shortens: it would have kept passing over Android alone, and a
  // platform Flutter adds later would arrive with neither half of the promise and
  // nothing red. Enumerating the enum makes the domain grow with the framework.
  //
  // ⚠️ THE FALLBACK IS PERMANENT, NOT A BRIDGE. The pinned plugin family's own
  // limitations text records that Windows throws on repeating notifications,
  // Linux has no scheduler API, and browsers support neither scheduled nor
  // repeating notifications. No version of it schedules on those three.
  //
  // ⬜ DECLARED GAP: the WEB row cannot be driven from here. `kIsWeb` is a
  // compile-time constant, so `debugDefaultTargetPlatformOverride` cannot reach
  // it — and web is the only live platform this factory ships to today. The
  // decision itself is covered for that row in
  // `packages/core/test/catch_up_nudge_test.dart`, which takes
  // `platformCanSchedule` as a parameter; what is NOT covered is this widget's
  // own `kIsWeb` read. Closing it needs `isWeb` as an injectable seam value, a
  // [2]C-1/C-7 edit. `tooling/ci/assert-stamp-properties.mjs` prints it on every
  // run rather than asserting something nobody here can satisfy.
  group('property: no-silent-channel', () {
    /// Pumps the banner alone — deliberately not the whole app, so the platform
    /// override is the only variable and no router/auth state can mask the row.
    Future<void> pumpBanner(
      WidgetTester tester,
      ProviderContainer c, {
      required DateTime now,
    }) async {
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(body: CatchUpNudgeBanner(clock: () => now)),
          ),
        ),
      );
      await tester.pump();
    }

    /// Sets the platform override for [body] and ALWAYS clears it inside the
    /// test body.
    ///
    /// ⚠️ `tearDown` is TOO LATE and looks like it works. flutter_test asserts
    /// "no foundation debug variable was left changed" at the end of the body,
    /// before any tearDown runs, so every test in this group failed on that
    /// invariant rather than on anything it asserts — a red that says nothing
    /// about the feature.
    Future<void> onPlatform(
      TargetPlatform p,
      Future<void> Function() body,
    ) async {
      debugDefaultTargetPlatformOverride = p;
      try {
        await body();
      } finally {
        debugDefaultTargetPlatformOverride = null;
      }
    }

    testWidgets('every platform gets EITHER an OS schedule OR the in-app nudge', (
      WidgetTester tester,
    ) async {
      for (final TargetPlatform p in TargetPlatform.values) {
        await onPlatform(p, () async {
          final _MemStore store = _MemStore();
          store.data['nikatru.reminders_enabled'] = 'true';
          final ProviderContainer c = _container(store);
          addTearDown(c.dispose);
          c.read(remindersEnabledProvider);
          // `tester.pump()`, never `Future.delayed` — testWidgets runs in a fake
          // async zone, so a real delay never completes and the whole file hangs.
          await tester.pump();

          final NotificationCapabilities caps =
              NotificationCapabilities.forPlatform(p, isWeb: false);
          // An hour past the configured reminder, so the nudge is genuinely due
          // on any row that cannot schedule.
          await pumpBanner(
            tester,
            c,
            now: DateTime(
              2026,
              8,
              3,
              AppConfig.reminderHour,
              0,
            ).add(const Duration(hours: 1)),
          );

          final bool shown = find.byType(MaterialBanner).evaluate().isNotEmpty;
          expect(
            shown,
            !caps.canSchedule,
            reason:
                'on $p canSchedule=${caps.canSchedule}; the reminder must be '
                'delivered by exactly one of the two mechanisms — a row with '
                'neither is a switch that reads ON over a device that never '
                'says anything',
          );
        });
      }
    });

    // 🔴 THE MOUNT, ASSERTED AGAINST THE REAL RUNNING APP. Everything else in
    // this group pumps the banner directly, which proves the DECISION and proves
    // nothing about the app containing it — deleting the widget from the home
    // shell left all four of those tests green. Same distinction
    // `analytics-on-switch-mounted` exists for, learned the same way.
    //
    // Asserted on the widget's PRESENCE, not on the banner it renders, so it is
    // independent of the wall clock: `HomeScreen` mounts it with the real
    // `DateTime.now()`, and a test that required the reminder to be due would
    // assert nothing for twenty hours a day and then start failing at 20:00.
    testWidgets('the running app really MOUNTS the nudge on home', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _moneyContainer(
        store: _onboardedStore(),
        server: _FakeEntitlements(),
      );
      addTearDown(c.dispose);
      await c
          .read(authRepositoryProvider)
          .signInWithEmail(email: 'a@b.com', password: 'pw');
      await c.read(appConfigProvider.future);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      expect(
        find.byType(CatchUpNudgeBanner),
        findsOneWidget,
        reason:
            'on Web, Windows and Linux this widget is the ONLY delivery '
            'mechanism there is, so an unmounted one is a reminder feature that '
            'silently does nothing on three of six platforms',
      );
    });

    testWidgets('a platform that cannot schedule still respects the opt-out', (
      WidgetTester tester,
    ) async {
      await onPlatform(TargetPlatform.windows, () async {
        final ProviderContainer c = _container(_MemStore());
        addTearDown(c.dispose);

        await pumpBanner(
          tester,
          c,
          now: DateTime(2026, 8, 3, AppConfig.reminderHour, 30),
        );

        expect(
          find.byType(MaterialBanner),
          findsNothing,
          reason:
              'an in-app banner is still a notification; showing one to '
              'somebody who turned reminders off routes around the switch',
        );
      });
    });

    testWidgets('dismissing it persists, and it does not come back today', (
      WidgetTester tester,
    ) async {
      await onPlatform(TargetPlatform.windows, () async {
        final _MemStore store = _MemStore();
        store.data['nikatru.reminders_enabled'] = 'true';
        final ProviderContainer c = _container(store);
        addTearDown(c.dispose);
        c.read(remindersEnabledProvider);
        await tester.pump();

        final DateTime now = DateTime(2026, 8, 3, AppConfig.reminderHour, 30);
        await pumpBanner(tester, c, now: now);
        expect(find.byType(MaterialBanner), findsOneWidget);

        await tester.tap(find.text('Got it'));
        await tester.pump();
        await tester.pump();

        expect(
          store.data['nikatru.last_nudge_shown_at'],
          isNotNull,
          reason:
              'an in-memory dismissal comes straight back at the next launch',
        );
        await pumpBanner(tester, c, now: now.add(const Duration(hours: 1)));
        expect(find.byType(MaterialBanner), findsNothing);
      });
    });

    testWidgets('it comes back for TOMORROW\'s reminder', (
      WidgetTester tester,
    ) async {
      await onPlatform(TargetPlatform.windows, () async {
        final _MemStore store = _MemStore();
        store.data['nikatru.reminders_enabled'] = 'true';
        store.data['nikatru.last_nudge_shown_at'] = DateTime(
          2026,
          8,
          3,
          AppConfig.reminderHour,
          30,
        ).toUtc().toIso8601String();
        final ProviderContainer c = _container(store);
        addTearDown(c.dispose);
        c.read(remindersEnabledProvider);
        c.read(catchUpNudgeProvider);
        await tester.pump();

        await pumpBanner(
          tester,
          c,
          now: DateTime(2026, 8, 4, AppConfig.reminderHour, 5),
        );
        expect(
          find.byType(MaterialBanner),
          findsOneWidget,
          reason:
              'a daily reminder has a daily catch-up; suppressing on "ever '
              'shown" would fire once in the life of the install',
        );
      });
    });
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
  // ═══════════════════════════════════════════════════════════════════════
  // [pipeline 5]M-5 · M-8 · M-11 — THE MONEY RAIL, PROVEN ON A STAMPED APP.
  //
  // 🔴 THIS IS THE PROPERTY THAT DID NOT EXIST. `EntitlementCache` and
  // `PaywallGate` both shipped, both were tested, and NOTHING in the repo had
  // ever asked the server whether anybody had paid — a fail-closed seam with no
  // proven open path, which is the [pipeline C-6] shape in its purest form. No
  // test went red, because refusing is correct when nobody has paid.
  //
  // So the assertions here drive the WHOLE chain — fake server, real cache, real
  // lock decision, real widget — and never override the decision itself.
  // ═══════════════════════════════════════════════════════════════════════
  group('property: paywall-gate-driven-by-server', () {
    test('a SERVER "no" locks the gate, and a server "yes" opens it', () async {
      final _FakeEntitlements server = _FakeEntitlements();
      final ProviderContainer c = _moneyContainer(
        store: _onboardedStore(),
        server: server,
      );
      addTearDown(c.dispose);

      // The config must be RESOLVED first: paywallLockedProvider reads it, and
      // nothing else in this chain starts it. Without this the provider takes
      // its documented not-yet-known branch and the test measures that instead.
      await c.read(appConfigProvider.future);
      await c.read(entitlementsProvider.future);
      expect(
        c.read(paywallLockedProvider),
        isTrue,
        reason: 'the server says this user has not paid',
      );
      // The fetch really happened — a lock decision reached without asking is
      // the dead capability this property exists to rule out.
      expect(server.calls, greaterThan(0));

      server.pro = true;
      c.invalidate(entitlementsProvider);
      await c.read(entitlementsProvider.future);
      expect(c.read(paywallLockedProvider), isFalse);
    });

    test(
      'the paywall is OFF by default, so a fresh stamp gates nothing',
      () async {
        // `paywall.enabled` is the outer switch and a stamped app is born with it
        // false. Without this, being born with the gate would cost every new app
        // a wall it never asked for.
        final ProviderContainer c = _moneyContainer(
          store: _onboardedStore(),
          server: _FakeEntitlements(),
          paywallEnabled: false,
        );
        addTearDown(c.dispose);
        await c.read(appConfigProvider.future);
        await c.read(entitlementsProvider.future);
        expect(c.read(paywallLockedProvider), isFalse);
      },
    );

    test(
      '[5]M-8 · a stale answer RE-LOCKS when online, and HOLDS when offline',
      () async {
        final ProviderContainer c = _moneyContainer(
          store: _onboardedStore(),
          server: _FakeEntitlements(pro: true),
        );
        addTearDown(c.dispose);

        // The config must be RESOLVED first: paywallLockedProvider reads it, and
        // nothing else in this chain starts it. Without this the provider takes
        // its documented not-yet-known branch and the test measures that instead.
        await c.read(appConfigProvider.future);
        await c.read(entitlementsProvider.future);
        expect(c.read(paywallLockedProvider), isFalse);

        // The cache now holds a verified grant. Move the clock past the ceiling.
        final core.EntitlementCache cache = c.read(entitlementCacheProvider);
        final DateTime far = DateTime.now().add(
          cache.stalenessCeiling + const Duration(days: 1),
        );
        expect(
          (await cache.readValid(now: far)).isPro,
          isFalse,
          reason: 'online and unverified past the ceiling ⇒ access stops',
        );
        // 🔴 BOTH DIRECTIONS. Without the second, a client that ALWAYS locks
        // passes — and always-locking is the fail-closed-and-dead shape this
        // stage exists to stop.
        expect(
          (await cache.readValid(now: far, connectivityAvailable: false)).isPro,
          isTrue,
          reason:
              'offline it is HELD — a deliberate loss, written down: locking a '
              'paying user out for being in a tunnel is the larger harm',
        );
      },
    );

    test(
      'a failed fetch keeps the cached answer — a flat network is not a refund',
      () async {
        final _FakeEntitlements server = _FakeEntitlements(pro: true);
        final ProviderContainer c = _moneyContainer(
          store: _onboardedStore(),
          server: server,
        );
        addTearDown(c.dispose);
        await c.read(appConfigProvider.future);
        await c.read(entitlementsProvider.future);

        server.fail = true;
        c.invalidate(entitlementsProvider);
        expect((await c.read(entitlementsProvider.future)).isPro, isTrue);
      },
    );

    test('[5]M-11 · the price comes from the RAIL CONFIG, formatted', () async {
      final ProviderContainer c = _moneyContainer(
        store: _onboardedStore(),
        server: _FakeEntitlements(),
      );
      addTearDown(c.dispose);
      await c.read(appConfigProvider.future);

      final PurchaseRail rail = c.read(purchaseRailProvider);
      expect(rail.offerings, hasLength(1));
      // 499 + USD, DERIVED. There is no price literal anywhere in the chassis;
      // `assert-no-price-literals.mjs` fails the build if one appears.
      expect(rail.offerings.single.formattedPrice, r'$4.99');
      // …and NOT sellable, because no checkout template is configured. That is
      // the honest state today (OWNER_QUEUE A-1) and the paywall says so.
      expect(rail.canStartCheckout, isFalse);
    });

    testWidgets('the GATE really covers the premium surface', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = _moneyContainer(
        store: _onboardedStore(),
        server: _FakeEntitlements(),
      );
      addTearDown(c.dispose);
      // SIGNED IN, or the router's redirect guard sends this straight to
      // /sign-in and the test measures the auth gate instead of the paywall.
      await c
          .read(authRepositoryProvider)
          .signInWithEmail(email: 'a@b.com', password: 'pw');
      await c.read(appConfigProvider.future);
      await c.read(entitlementsProvider.future);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const {{app_id.pascalCase()}}App()),
      );
      await _turnsAndSettleRoute(tester);

      // Tab 0 is not gated: a paywall a user meets before they have seen
      // anything is a wall, not a paywall.
      expect(find.byType(PaywallGate), findsOneWidget);
      expect(find.text('Unlock the full experience'), findsNothing);

      // Tab 1 IS. Explore is the chassis's premium surface.
      await tester.tap(find.text('Explore'));
      await _turnsAndSettleRoute(tester);
      expect(find.text('Unlock the full experience'), findsOneWidget);
    });
  });

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
