import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart';
import 'package:nikatru_chassis_screens/integrity/device_integrity_gate.dart';
import 'package:nikatru_chassis_screens/shell/bootstrap.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// The app SHELL — `NikatruApp` and the four surfaces it hosts.
///
/// 🏗️ The widget half of the brick's `theme-triplet-supplied`,
/// `analytics-on-switch-mounted`, `analytics-lifecycle-complete` and
/// `update-url-resolved-from-config` groups. The WIRING halves stay in the
/// brick's `test/chassis_properties_test.dart`, because what they assert is that
/// a STAMPED app reads its providers and passes them in —
/// `assert-stamp-properties.mjs` anchors each of those reads in the brick file
/// and would report COVERAGE LOST if the group left.
///
/// 🔴 ONE PUMP MOUNTS ALL FIVE, ON PURPOSE. `_pumpShell` composes exactly what
/// the brick's `app.dart` composes — `NikatruApp` with an `AppLifecycleFlush` →
/// `ConsentScrim` → `OfflineBannerHost` chain as its `shell` — so these cases
/// measure the real arrangement rather than five widgets in isolation. A shell
/// that only works when each part is pumped alone is a shell that does not work.
void main() {
  // ── A router that renders one page and nothing else ────────────────────────
  // `onGenerateRoute` rather than the `pages` API: the latter's callback was
  // renamed between the SDK on this workstation and the one `ci.yml` pins, and a
  // harness that fails to compile on one of the two is a harness that proves
  // nothing on that one.
  Widget routedBody = const Text('routed body');

  Widget buildApp({
    bool asking = false,
    bool unreachable = false,
    bool mustUpdate = false,
    VoidCallback? onBackground,
    VoidCallback? onRetry,
    VoidCallback? onConfigRefresh,
    void Function({required bool granted})? onAnswer,
    ThemeMode themeMode = ThemeMode.light,
    Future<void> Function()? onReturn,
    Duration Function()? elapsed,
  }) {
    return NikatruApp(
      title: 'Probe',
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      locale: const Locale('en'),
      theme: buildAppTheme(seed: const Color(0xFF6750A4)),
      darkTheme: buildAppTheme(
        seed: const Color(0xFF6750A4),
        brightness: Brightness.dark,
      ),
      themeMode: themeMode,
      routerConfig: RouterConfig<Object>(
        routerDelegate: _OnePageRouterDelegate(() => routedBody),
      ),
      mustUpdate: mustUpdate,
      onUpdate: () {},
      onConfigRefresh: onConfigRefresh ?? () {},
      shell: (Widget routed) => RefreshOnResume(
        onRefresh: onReturn ?? () async {},
        elapsed: elapsed,
        child: AppLifecycleFlush(
          onBackground: onBackground ?? () {},
          child: ConsentScrim(
            asking: asking,
            prompt: ConsentPromptCard(
              appName: 'Probe',
              onAnswer: onAnswer ?? ({required bool granted}) {},
            ),
            child: OfflineBannerHost(
              unreachable: unreachable,
              onRetry: onRetry ?? () {},
              child: routed,
            ),
          ),
        ),
      ),
    );
  }

  Future<void> pumpShell(
    WidgetTester tester,
    Size size, {
    bool asking = false,
    bool unreachable = false,
    bool mustUpdate = false,
    VoidCallback? onBackground,
    VoidCallback? onRetry,
    void Function({required bool granted})? onAnswer,
    TextScaler? incomingScale,
    Future<void> Function()? onReturn,
    Duration Function()? elapsed,
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final Widget app = buildApp(
      asking: asking,
      unreachable: unreachable,
      mustUpdate: mustUpdate,
      onBackground: onBackground,
      onRetry: onRetry,
      onAnswer: onAnswer,
      onReturn: onReturn,
      elapsed: elapsed,
    );
    await tester.pumpWidget(
      incomingScale == null
          ? app
          : MediaQuery(
              data: MediaQueryData(size: size, textScaler: incomingScale),
              child: app,
            ),
    );
    await tester.pumpAndSettle();
  }

  // ── (1) THE CONSENT CARD IS CAPPED, AT EVERY WINDOW CLASS ─────────────────
  //
  // The card is a modal over a dimmed app, so it keeps `Center` and takes only
  // the WIDTH from the chassis: `AppBreakpoints.form`. Measured at all three
  // window classes because the cap only shows itself once the window is wider
  // than it — a single narrow case would pass with the cap deleted.
  // [pipeline 10]D-8 · O-FORCE-UPDATE-VERSION-READ-UNPROVEN —
  // `listenForConfigRefresh`, the chassis half of the brick's
  // `floor-rereads-after-launch` property: the edges it promises fire, and
  // nothing else does.
  group('listenForConfigRefresh', () {
    testWidgets('nothing at start: the first read is the provider\'s own', (
      tester,
    ) async {
      final List<String> calls = <String>[];
      final VoidCallback stop = listenForConfigRefresh(() => calls.add('r'));
      expect(calls, isEmpty);
      stop();
    });

    testWidgets('a resume re-reads — on web, a tab back at the front', (
      tester,
    ) async {
      final List<String> calls = <String>[];
      final VoidCallback stop = listenForConfigRefresh(() => calls.add('r'));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
      expect(calls, isEmpty, reason: 'going to the background is no re-read');
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(calls, <String>['r']);
      stop();
    });

    testWidgets('the timer re-reads a tab that never changes visibility', (
      tester,
    ) async {
      final List<String> calls = <String>[];
      final VoidCallback stop = listenForConfigRefresh(
        () => calls.add('r'),
        interval: const Duration(minutes: 1),
      );
      await tester.pump(const Duration(seconds: 59));
      expect(calls, isEmpty);
      await tester.pump(const Duration(seconds: 1));
      expect(calls, <String>['r']);
      await tester.pump(const Duration(minutes: 2));
      expect(calls, hasLength(3));
      stop();
    });

    test('the default interval is a quarter hour', () {
      expect(kConfigRefreshInterval, const Duration(minutes: 15));
    });

    testWidgets('stopped, it re-reads nothing — timer and listener both go', (
      tester,
    ) async {
      final List<String> calls = <String>[];
      listenForConfigRefresh(
        () => calls.add('r'),
        interval: const Duration(minutes: 1),
      )();
      await tester.pump(const Duration(minutes: 5));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(calls, isEmpty);
    });
  });

  // [pipeline 10]D-8 · O-FORCE-UPDATE-VERSION-READ-UNPROVEN: the shell mounts
  // `listenForConfigRefresh` above the wall, so a resume re-reads the config,
  // and an unmounted shell stops re-reading.
  testWidgets('NikatruApp re-reads the config on a resume, and stops when '
      'unmounted', (WidgetTester tester) async {
    final List<String> calls = <String>[];
    await tester.pumpWidget(buildApp(onConfigRefresh: () => calls.add('r')));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    expect(calls, <String>['r']);

    await tester.pumpWidget(const SizedBox.shrink());
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(kConfigRefreshInterval);
    expect(calls, <String>['r']);
  });

  group('property: consent-card-capped-at-every-window-class', () {
    Future<double> cardWidthAt(WidgetTester tester, Size size) async {
      await pumpShell(tester, size, asking: true);
      return tester
          .getSize(
            find.ancestor(
              of: find.byType(SingleChildScrollView),
              matching: find.byType(ConstrainedBox),
            ).first,
          )
          .width;
    }

    testWidgets('kPhone — narrower than the cap, so the card yields', (
      WidgetTester tester,
    ) async {
      expect(await cardWidthAt(tester, kPhone), lessThanOrEqualTo(kPhone.width));
    });

    testWidgets('kTablet — the form cap holds', (WidgetTester tester) async {
      expect(
        await cardWidthAt(tester, kTablet),
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });

    testWidgets('kDesktop — the form cap still holds', (
      WidgetTester tester,
    ) async {
      expect(
        await cardWidthAt(tester, kDesktop),
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  });

  // ── (2) THE SCROLL VIEW, WHICH IS A DEFECT REPAIR WITH A NUMBER ON IT ─────
  //
  // At the largest text the chassis PERMITS the card overflowed by 644 px in
  // English on a 640-tall screen and laid "Allow" out entirely below the fold.
  // `assert-consent-withdrawal-surface.mjs` limb 4 fails the build if the
  // scroller goes; this is the behavioural half of the same claim.
  group('property: consent-card-scrolls-at-the-largest-permitted-text', () {
    testWidgets('both answers are reachable at text scale 2.0', (
      WidgetTester tester,
    ) async {
      await pumpShell(
        tester,
        const Size(360, 640),
        asking: true,
        incomingScale: TextScaler.linear(3.0),
      );
      expect(find.byType(SingleChildScrollView), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.dragUntilVisible(
        find.byType(FilledButton),
        find.byType(SingleChildScrollView),
        const Offset(0, -60),
      );
      expect(find.byType(FilledButton), findsOneWidget);
    });
  });

  // ── (3) THE SCRIM IS MODAL, AND THAT IS TWO LINES OF SEMANTICS ────────────
  //
  // Semantic taps dispatch straight to the widget and DO NOT hit-test, so an
  // opaque `ColoredBox` stops a finger and stops nothing for TalkBack or
  // VoiceOver. Measured before `ExcludeSemantics` landed: the screen behind the
  // scrim was fully exposed with live tap actions.
  group('property: consent-scrim-is-modal', () {
    testWidgets('the app behind is excluded while the question is open', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpShell(tester, kPhone, asking: true);
      expect(find.bySemanticsLabel('routed body'), findsNothing);
      handle.dispose();
    });

    testWidgets('and reachable again once it is answered', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpShell(tester, kPhone);
      expect(find.bySemanticsLabel('routed body'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('both answers are equally prominent and both report', (
      WidgetTester tester,
    ) async {
      final List<bool> answers = <bool>[];
      await pumpShell(
        tester,
        kTablet,
        asking: true,
        onAnswer: ({required bool granted}) => answers.add(granted),
      );
      await tester.tap(find.byType(OutlinedButton));
      await tester.tap(find.byType(FilledButton));
      expect(answers, <bool>[false, true]);
    });
  });

  // ── (4) TEXT SCALING IS CLAMPED AT THE ROOT ───────────────────────────────
  //
  // Both stores' accessibility settings can push well past 2.0, and unbounded
  // scaling does not degrade gracefully — it overflows, and an overflow is a
  // screen the user cannot finish.
  group('property: text-scaling-clamped-at-the-root', () {
    testWidgets('a 3.0 request reaches the routed screen as 2.0', (
      WidgetTester tester,
    ) async {
      late TextScaler seen;
      routedBody = Builder(
        builder: (BuildContext context) {
          seen = MediaQuery.textScalerOf(context);
          return const Text('routed body');
        },
      );
      addTearDown(() => routedBody = const Text('routed body'));
      await pumpShell(
        tester,
        kTablet,
        incomingScale: TextScaler.linear(3.0),
      );
      expect(seen.scale(10), NikatruApp.maxTextScale * 10);
    });
  });

  // ── (5) THE OFFLINE BANNER — ITS ONLY CALL SITE ───────────────────────────
  //
  // Until 2026-08-06 `OfflineNotice` had no consumer anywhere in the repository:
  // present, anchored, green, and unreachable by every user of every stamped
  // app. It returns its child untouched while reachable, so the tree is
  // byte-identical to the pre-banner one until a request has actually failed.
  group('property: offline-banner-reachable', () {
    testWidgets('absent while the config resolves', (
      WidgetTester tester,
    ) async {
      await pumpShell(tester, kDesktop);
      expect(find.byType(OfflineNotice), findsNothing);
      expect(find.text('routed body'), findsOneWidget);
    });

    testWidgets('present, with a retry, once a request has failed', (
      WidgetTester tester,
    ) async {
      int retries = 0;
      await pumpShell(
        tester,
        kDesktop,
        unreachable: true,
        onRetry: () => retries += 1,
      );
      expect(find.byType(OfflineNotice), findsOneWidget);
      expect(find.text('routed body'), findsOneWidget);
      await tester.tap(find.byType(TextButton).first);
      expect(retries, 1);
    });
  });

  // ── (6) THE FLUSH FIRES ON ALL FOUR EDGES ─────────────────────────────────
  //
  // `inactive` is the one that covers desktop: on Windows, macOS and Linux the
  // previous three-state set fired on exactly one path — minimize — and never on
  // the way out of the app.
  group('property: lifecycle-flush-covers-desktop-too', () {
    testWidgets('every state that means "on the way out" flushes', (
      WidgetTester tester,
    ) async {
      int flushes = 0;
      await pumpShell(tester, kPhone, onBackground: () => flushes += 1);
      for (final AppLifecycleState state in <AppLifecycleState>[
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.detached,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      expect(flushes, 4);
    });

    testWidgets('and resuming does not', (WidgetTester tester) async {
      int flushes = 0;
      await pumpShell(tester, kPhone, onBackground: () => flushes += 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(flushes, 0);
    });
  });

  // ── ⏱ 2026-09-30 · ST-N6 · A RETURN TO THE FRONT RE-READS ────────────────
  //
  // `RefreshOnResume` is a pass-through: nothing to lay out, so the width
  // question is only whether the routed body still fills every window class
  // with it in the chain. The lifecycle cases are the behaviour.
  group('property: return-to-the-front-re-reads', () {
    for (final Size size in kAllWindows) {
      testWidgets('the routed body renders under it at ${size.width}', (
        WidgetTester tester,
      ) async {
        await pumpShell(tester, size);
        expect(find.text('routed body'), findsOneWidget);
        expect(find.byType(RefreshOnResume), findsOneWidget);
      });
    }

    testWidgets('paused -> resumed re-reads; a flick inside the floor does not', (
      WidgetTester tester,
    ) async {
      DateTime now = DateTime.utc(2026, 9, 30, 12);
      int runs = 0;
      await pumpShell(
        tester,
        kPhone,
        onReturn: () async => runs++,
        elapsed: () => now.difference(DateTime.utc(2026)),
      );
      now = now.add(const Duration(minutes: 5));
      for (final AppLifecycleState state in <AppLifecycleState>[
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pump();
      expect(runs, 1);

      // Alt-tab straight back (desktop, web): inactive -> resumed.
      now = now.add(const Duration(seconds: 2));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(runs, 1);
    });

    testWidgets('unmounted, it stops listening', (WidgetTester tester) async {
      DateTime now = DateTime.utc(2026, 9, 30, 12);
      int runs = 0;
      await pumpShell(
        tester,
        kPhone,
        onReturn: () async => runs++,
        elapsed: () => now.difference(DateTime.utc(2026)),
      );
      await tester.pumpWidget(const SizedBox.shrink());
      now = now.add(const Duration(minutes: 5));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(runs, 0);
    });
  });

  // ── (7) THE FORCE-UPDATE WALL REPLACES THE WHOLE APP ──────────────────────
  //
  // It is the emergency exit, and it is the one screen that cannot be dismissed
  // — so the copy is passed from the chassis catalogue rather than defaulted to
  // English, which is what every app this template stamped shipped until
  // 2026-09-04.
  // == (8) THE BOOT ORDER, OBSERVED RATHER THAN READ OFF THE SOURCE ==========
  //
  // Each of the five steps is load-bearing and each is stated in
  // `bootstrapNikatru`'s own doc. The brick could only assert this by reading
  // `lib/main.dart` as text, because `main()` cannot be run in a widget test.
  // Here it runs.
  group('property: boot-order-is-owned-by-the-chassis', () {
    // `AppErrorScreen.install()` REPLACES `ErrorWidget.builder`, which is the
    // whole point of step 3 - the default is the grey/yellow box in release and
    // the red screen in debug, and shipping either to a user looks like a broken
    // app and leaks widget internals. `testWidgets` asserts the builder is the
    // one it started with, so every case here restores it. That the boot really
    // does change it is itself part of the claim.
    // ...and it is restored INSIDE the body, not in a tearDown: the framework
    // makes that assertion at the end of `_runTestBody`, which runs BEFORE any
    // tearDown, so an `addTearDown` restore is measurably too late.
    Future<List<String>> boot({
      bool backendLive = true,
      core.DeviceIntegrityProbe? probe,
      String releaseChannel = '',
    }) async {
      final ErrorWidgetBuilder originalErrorWidget = ErrorWidget.builder;
      final _OrderRecorder notifications = _OrderRecorder();
      final List<String> steps = notifications.steps;
      await bootstrapNikatru(
        releaseChannel: releaseChannel,
        integrityProbe: probe,
        recordIntegrity: probe == null
            ? null
            : (core.DeviceIntegrity i) =>
                  steps.add('integrity.record ${i.signer.name}'),
        // A release build on android, so the signer check is not exempt.
        isDebugBuild: false,
        platform: TargetPlatform.android,
        notifications: notifications,
        runGuarded: (Future<void> Function() appRunner) async {
          steps.add('telemetry.zone.enter');
          await appRunner();
          steps.add('telemetry.zone.exit');
        },
        initialiseIdentity: () async {
          if (backendLive) steps.add('identity.init');
        },
        run: () => steps.add('runApp'),
      );
      ErrorWidget.builder = originalErrorWidget;
      return steps;
    }

    testWidgets('the licences are registered BEFORE the app runs', (
      WidgetTester tester,
    ) async {
      // LicenseRegistry is read LAZILY by LicensePage - the surface Settings
      // offers - so a registration that lands after a user has already opened
      // that page shows them an incomplete list, which is the same breach with
      // an extra step. Observed on the REGISTRY rather than on a step marker:
      // the claim is that the entries exist, not that a line ran.
      final ErrorWidgetBuilder originalErrorWidget = ErrorWidget.builder;
      // `run` is a `VoidCallback` by design - the brick's `runApp(...)` returns
      // nothing - so the subscription is opened SYNCHRONOUSLY inside it and
      // awaited afterwards. An `async` body here would have been a Future
      // nothing awaited, and the assertion would have read a variable set after
      // it: green or red by timing, which is worse than no case at all.
      Future<bool>? emptyAtRun;
      final _OrderRecorder notifications = _OrderRecorder();
      await bootstrapNikatru(
        releaseChannel: '',
        integrityProbe: null,
        notifications: notifications,
        runGuarded: (Future<void> Function() appRunner) => appRunner(),
        initialiseIdentity: () async {},
        run: () => emptyAtRun = LicenseRegistry.licenses.isEmpty,
      );
      ErrorWidget.builder = originalErrorWidget;
      expect(emptyAtRun, isNotNull, reason: 'run() was never called at all');
      expect(await emptyAtRun!, isFalse);
    });

    testWidgets('every step happens, once, in the order the doc states', (
      WidgetTester tester,
    ) async {
      expect(await boot(), <String>[
        'telemetry.zone.enter',
        'notifications.init',
        'identity.init',
        'runApp',
        'telemetry.zone.exit',
      ]);
    });

    // ⏱ 2026-10-01 · O-APPS-GOV-IN-VAPT-CHECKLIST — step 3½. A copy signed by
    // a key that is not one of the channel's COMPLETE pins reaches no data:
    // no notification adapter, no identity, no app. android-play's pins are
    // incomplete today (the app signing pin is not set), so a hand-built
    // complete set stands in through a channel the generated table has, and
    // the incomplete real one must NOT block.
    testWidgets('a re-signed copy stops before notifications, identity and the app', (
      WidgetTester tester,
    ) async {
      final core.IntegritySession before = DeviceIntegrityScope.session;
      addTearDown(() => DeviceIntegrityScope.session = before);
      final List<String> steps = await boot(
        releaseChannel: 'android-play',
        probe: core.FixedDeviceIntegrityProbe(
          certificates: core.SigningCertificates(sha256: <String>['00' * 32]),
        ),
      );
      // android-play is INCOMPLETE, so this is reported and the app runs.
      expect(steps, <String>[
        'telemetry.zone.enter',
        'integrity.record mismatchReported',
        'notifications.init',
        'identity.init',
        'runApp',
        'telemetry.zone.exit',
      ]);
      expect(DeviceIntegrityScope.session.integrity.blocksDataAccess, isFalse);
    });

    testWidgets('the genuine signer boots exactly as before', (
      WidgetTester tester,
    ) async {
      final core.IntegritySession before = DeviceIntegrityScope.session;
      addTearDown(() => DeviceIntegrityScope.session = before);
      final List<String> steps = await boot(
        releaseChannel: 'android-play',
        probe: core.FixedDeviceIntegrityProbe(
          certificates: core.SigningCertificates(
            sha256: core.signerPinsFor('android-play')!.digests,
          ),
        ),
      );
      expect(steps, <String>[
        'telemetry.zone.enter',
        'integrity.record verified',
        'notifications.init',
        'identity.init',
        'runApp',
        'telemetry.zone.exit',
      ]);
    });

    testWidgets('the boot path NEVER asks for notification permission', (
      WidgetTester tester,
    ) async {
      // Android 13+ turns a SECOND denial into USER_FIXED - permanently
      // non-promptable - so a launch-time prompt can burn the channel for the
      // life of the install. `assert-stamp-properties.mjs` walks this boot path
      // for the same reason; this is the behavioural half.
      expect(
        (await boot()).where((String s) => s.contains('requestPermission')),
        isEmpty,
      );
    });

    testWidgets('an app with no backend still boots and still runs', (
      WidgetTester tester,
    ) async {
      // The default stamp claims no Worker at all, so `initialiseIdentity` does
      // nothing for it. The app must still reach `runApp` - a boot that only
      // works for the backend variant is a boot that fails for the default one.
      expect(await boot(backendLive: false), <String>[
        'telemetry.zone.enter',
        'notifications.init',
        'runApp',
        'telemetry.zone.exit',
      ]);
    });
  });

  group('property: force-update-replaces-the-app', () {
    testWidgets('the routed screen is gone and the wall is localised', (
      WidgetTester tester,
    ) async {
      await pumpShell(tester, kPhone, mustUpdate: true);
      expect(find.text('routed body'), findsNothing);
      expect(find.byType(ForceUpdateGate), findsOneWidget);
    });
  });
}

/// One page, no navigation. See the note at the top of `main` for why this uses
/// `onGenerateRoute` rather than the declarative `pages` API.
class _OnePageRouterDelegate extends RouterDelegate<Object>
    with ChangeNotifier, PopNavigatorRouterDelegateMixin<Object> {
  _OnePageRouterDelegate(this.body);

  final Widget Function() body;

  @override
  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) => Navigator(
    key: navigatorKey,
    onGenerateRoute: (RouteSettings settings) =>
        MaterialPageRoute<void>(builder: (BuildContext _) => body()),
  );

  @override
  Future<void> setNewRoutePath(Object configuration) async {}
}

/// Records the ORDER in which `bootstrapNikatru` does the five things it owns.
///
/// 🔴 THE ORDER IS THE WHOLE POINT AND IT IS NOW TESTABLE. In the brick it was
/// 110 lines of comment inside a per-app `main()`: no test could run that
/// function — it initialises telemetry, a platform plugin and (when configured)
/// the Supabase SDK before `runApp` — so the brick's `asset_licences_surface_
/// test.dart` had to assert the ordering by READING THE SOURCE, and said so.
/// `bootstrapNikatru` takes every one of those as a seam, so the same claim is
/// an observation here instead of a text match.
class _OrderRecorder implements core.NotificationService {
  final List<String> steps = <String>[];

  @override
  Future<void> init() async => steps.add('notifications.init');

  @override
  Future<bool> requestPermission() async {
    // ⚠️ IT MUST NEVER ASK ON THE BOOT PATH. Android 13+ turns a SECOND denial
    // into USER_FIXED — permanently non-promptable — so a launch-time prompt
    // can burn the channel for the life of the install. Recorded rather than
    // thrown so the case below can name it.
    steps.add('notifications.requestPermission');
    return false;
  }

  @override
  Future<void> showNow({required String title, required String body}) async {}

  @override
  Future<void> scheduleDaily(core.DailyReminder reminder) async {}

  @override
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async {}

  @override
  Stream<core.NotificationTap> notificationTaps() =>
      const Stream<core.NotificationTap>.empty();

  @override
  Future<void> scheduleAt(core.ScheduledNotification notification) async {}

  @override
  Future<void> reconcile(
    List<core.ScheduledNotification> wanted, {
    required bool Function(int id) owns,
  }) async {}

  @override
  Future<core.NotificationTap?> takeLaunchTap() async => null;
}
