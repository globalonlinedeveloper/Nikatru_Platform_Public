import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — THE APP SHELL AND THE FOUR SURFACES IT HOSTS.
///
/// `NikatruApp`, `AppLifecycleFlush`, `ConsentScrim`, `ConsentPromptCard` and
/// `OfflineBannerHost` are mounted by EVERY stamped app on every launch, so
/// they are the most reachable surfaces the factory ships. See
/// `a11y_auth_test.dart`'s header for what each case asserts and why.
///
/// ✅ 2026-09-14 — THE PIN BELOW IS RETIRED: `OfflineBannerHost` now paints the
/// notice after the routed child, and the offline case sweeps the banner
/// through the router (O-CHASSIS-OFFLINE-BANNER-UNANNOUNCED). The paragraph
/// that follows is kept as it was written on 2026-09-07.
///
/// 🔴 ONE CASE HERE IS A PIN OVER A DEFECT THIS SUITE FOUND, NOT A SWEEP, AND
/// THE DEFECT IS IN `lib/` WHICH THIS UNIT DOES NOT OWN. Composed the way the
/// brick's `app.dart` composes it, `OfflineBannerHost`'s banner is MOUNTED and
/// INVISIBLE TO A SCREEN READER: the router pushes a `MaterialPageRoute`, whose
/// `ModalBarrier` wraps the page in `BlockSemantics`
/// (`flutter/lib/src/widgets/modal_barrier.dart:264`), and `BlockSemantics`
/// drops the semantics of everything painted BEFORE it — which is exactly the
/// notice, because `OfflineBannerHost.build` puts it FIRST in a `Column` above
/// the routed child. Measured 2026-09-07 in this rig:
/// `find.text('Retry')` → 1 widget, `find.byType(BlockSemantics)` → 1,
/// `find.bySemanticsLabel('Retry')` → **0 nodes**.
/// The banner sweeps correctly when it is pumped WITHOUT a router (the two
/// standalone cases below), so the sweep is real and the composition is the
/// defect. It is recorded as a residue against
/// `packages/chassis_screens/lib/shell/app_shell.dart` rather than fixed here.
void main() {
  // ── ConsentPromptCard ─────────────────────────────────────────────────────
  //
  // ⚠️ IT IS A `Positioned`, so it MUST be pumped inside a `Stack` — outside
  // one it throws `Incorrect use of ParentDataWidget` before a single
  // assertion runs. Measured while this file was written.
  group('a11y: consent-prompt-card', () {
    testWidgets('light, kPhone — both answers equally prominent', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: Stack(
              children: <Widget>[
                const Center(child: Text('the app behind the question')),
                ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
              ],
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'consent-prompt-card',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: Stack(
              children: <Widget>[
                const Center(child: Text('the app behind the question')),
                ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
              ],
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'consent-prompt-card (dark, kDesktop)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── OfflineBannerHost ─────────────────────────────────────────────────────
  group('a11y: offline-banner-host', () {
    testWidgets('light, kPhone — unreachable, so the notice and its retry are '
        'on screen', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: OfflineBannerHost(
              unreachable: true,
              onRetry: () {},
              child: const Center(child: Text('the app below the banner')),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'offline-banner-host',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: OfflineBannerHost(
              unreachable: true,
              onRetry: () {},
              child: const Center(child: Text('the app below the banner')),
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'offline-banner-host (dark, kDesktop)',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── ConsentScrim + AppLifecycleFlush ──────────────────────────────────────
  //
  // The scrim is MODAL and that is two lines of semantics: a semantic tap
  // dispatches straight to the widget and does NOT hit-test, so an opaque
  // `ColoredBox` stops a finger and stops nothing for TalkBack or VoiceOver.
  // These cases sweep the question that is ON TOP; that the app BEHIND is
  // excluded is `app_shell_view_test.dart`'s claim and stays there.
  group('a11y: consent-scrim', () {
    testWidgets('light, kPhone — asking', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: ConsentScrim(
              asking: true,
              prompt: ConsentPromptCard(
                appName: 'Probe',
                onAnswer: ({required bool granted}) {},
              ),
              child: AppLifecycleFlush(
                onBackground: () {},
                child: const Center(child: Text('the app behind the scrim')),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'consent-scrim (asking)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop — asking', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: ConsentScrim(
              asking: true,
              prompt: ConsentPromptCard(
                appName: 'Probe',
                onAnswer: ({required bool granted}) {},
              ),
              child: AppLifecycleFlush(
                onBackground: () {},
                child: const Center(child: Text('the app behind the scrim')),
              ),
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'consent-scrim (asking, dark, kDesktop)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kPhone — NOT asking, which is the state the app spends '
        'its life in and the one that must not swallow the tree', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            appBar: AppBar(title: const Text('Probe')),
            body: ConsentScrim(
              asking: false,
              prompt: ConsentPromptCard(
                appName: 'Probe',
                onAnswer: ({required bool granted}) {},
              ),
              child: AppLifecycleFlush(
                onBackground: () {},
                child: Center(
                  child: FilledButton(
                    onPressed: () {},
                    child: const Text('A control the reader must still reach'),
                  ),
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'consent-scrim (answered)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── NikatruApp, composed exactly as the brick's `app.dart` composes it ─────
  group('a11y: nikatru-app', () {
    testWidgets('light, kPhone — a routed page under the whole gate chain', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(tester, 'shell', tappable: 1, labelled: 2);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kDesktop,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.dark,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'shell (dark, kDesktop)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kPhone — the consent question OVER the routed page, '
        'which is the first thing a new install is handed', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: true,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'shell (asking)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kPhone — the force-update gate, the one screen that '
        'REPLACES the app and cannot be dismissed', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => const Scaffold(body: Center(child: Text('routed body'))),
              ),
            ),
            mustUpdate: true,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'shell (force update)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kPhone — offline: the banner is announced THROUGH the '
        'router, and swept with the page', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: true,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );

        // ✅ REPAIRED 2026-09-14 (O-CHASSIS-OFFLINE-BANNER-UNANNOUNCED). This
        // case was a PIN over the defect: the notice mounted, a `BlockSemantics`
        // from the page route's `ModalBarrier` painted after it, and the reader
        // handed nothing. `OfflineBannerHost` now paints the notice AFTER the
        // routed child (see its build), so the same composition announces it.
        // The `BlockSemantics` is still there — that is the point: the fix
        // does not depend on the route changing.
        expect(find.byType(OfflineNotice), findsOneWidget);
        expect(find.byType(BlockSemantics), findsOneWidget);
        final List<SemanticsNode> traversal = tester.semantics
            .simulatedAccessibilityTraversal()
            .toList();
        final List<String> announced = traversal
            .map((SemanticsNode n) => n.getSemanticsData().label)
            .where((String l) => l.trim().isNotEmpty)
            .toList();
        expect(
          announced,
          contains('Retry'),
          reason:
              'the offline banner is mounted and a screen reader cannot reach '
              'its Retry control — the BlockSemantics of the routed page is '
              'dropping it again. Announced: $announced',
        );
        expect(
          traversal.any(
            (SemanticsNode n) =>
                n.getSemanticsData().label == 'Retry' &&
                n.getSemanticsData().hasAction(SemanticsAction.tap),
          ),
          isTrue,
          reason: 'Retry is announced but cannot be activated.',
        );

        // The routed page's control and title, plus the banner's message and
        // its Retry: the tappable floor is the unannounced pin's plus one.
        expectSweepHadSubjects(
          tester,
          'shell (offline, banner announced)',
          tappable: 2,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });
}

/// One page, no navigation — the same shape `app_shell_view_test.dart` uses,
/// and for the same reason: `onGenerateRoute` compiles on both the SDK on this
/// workstation and the one `ci.yml` pins, where the declarative `pages` API's
/// callback was renamed between them.
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
