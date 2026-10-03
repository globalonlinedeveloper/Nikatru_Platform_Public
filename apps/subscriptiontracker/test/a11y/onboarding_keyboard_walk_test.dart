// ─────────────────────────────────────────────────────────────────────────────
// SC 2.1.1 (KEYBOARD, LEVEL A) — `/onboarding`, PAGE BY PAGE, TO THE EXIT.
//
// `keyboard_sweep_test.dart` sweeps every screen-bearing route but one, and
// names the one in [kCannotBeSwept]: `/onboarding` is a horizontal `PageView`,
// only the CURRENT page is built, and a single sweep would report page one as
// the whole screen. The page it never builds is the last, and the last carries
// the only way out of a fresh install that is not Skip. So the route a new user
// sees FIRST was the one route no keyboard case had ever walked
// (O-DOD-KEYBOARD-ROW-STALE-AND-ONBOARDING-UNSWEPT, SYN-X1 / C-13).
//
// ── WHAT THIS FILE DOES THAT A SWEEP CANNOT ─────────────────────────────────
// It drives the carousel WITH THE KEYBOARD. On every page: Tab round the whole
// orbit, require every control the page builds to be on it, Tab to the
// advance button and press Enter. The next page is built by that key press, so
// the sweep of page N+1 is a sweep of a page the keyboard itself reached. On
// the last page the same Enter must leave onboarding — the fact is recorded and
// the router lands on `/sign-in`. A second case leaves by Skip, the other exit.
//
// ── 🔴 THE DOMAIN IS READ, NOT WRITTEN ───────────────────────────────────────
// The screen is the ROUTER's `/onboarding` builder (the expression `GoRouter`
// evaluates for a user), and the page count is the mounted `OnboardingView`'s
// own `pages.length`. Neither is a number here: add a slide and the walk takes
// one more step; re-point the route and it walks the new screen.
//
// ── DESKTOP, BECAUSE THAT IS WHERE A KEYBOARD IS THE INPUT ──────────────────
// Run under android AND the desktop three. A keyboard is the PRIMARY input on
// linux, macOS and windows, and focus traversal and button activation both
// branch on the platform inside the framework, so an android-only walk would
// grade the platform where a keyboard is least likely.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/state/providers.dart';

import '../keyboard_traversal_test.dart' show kKeyboardSurface;
import '../support/width_harness.dart';

const String kOnboarding = '/onboarding';

const TargetPlatformVariant kKeyboardPlatforms =
    TargetPlatformVariant(<TargetPlatform>{
      TargetPlatform.android,
      TargetPlatform.linux,
      TargetPlatform.macOS,
      TargetPlatform.windows,
    });

/// True when [child] is [ancestor] or sits anywhere beneath it. Verbatim from
/// `keyboard_sweep_test.dart`.
bool _isUnder(Element? child, Element? ancestor) {
  if (child == null || ancestor == null) return false;
  if (identical(child, ancestor)) return true;
  bool found = false;
  child.visitAncestorElements((Element a) {
    if (identical(a, ancestor)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/// The Tab orbit from a cleared focus: every node Tab lands on before it
/// returns to one already visited. Same rig as `keyboard_sweep_test.dart`.
Future<List<FocusNode>> _orbit(WidgetTester tester) async {
  tester.binding.focusManager.primaryFocus?.unfocus();
  await tester.pump();
  final List<FocusNode> orbit = <FocusNode>[];
  for (int i = 0; i < 200; i++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final FocusNode? pf = tester.binding.focusManager.primaryFocus;
    if (pf == null || orbit.any((FocusNode n) => identical(n, pf))) break;
    orbit.add(pf);
  }
  return orbit;
}

/// Every interactive control on screen, outermost only. Same inventory as
/// `keyboard_sweep_test.dart`'s `_sweepRoute`.
List<Element> _controls() {
  final List<Element> candidates = <Element>[
    for (final Element e in find.byType(GestureDetector).evaluate())
      if ((e.widget as GestureDetector).onTap != null) e,
    for (final Element e in find.byType(InkWell).evaluate())
      if ((e.widget as InkWell).onTap != null) e,
    ...find.byType(EditableText).evaluate(),
  ];
  return candidates
      .where(
        (Element e) =>
            !candidates.any((Element o) => !identical(o, e) && _isUnder(e, o)),
      )
      .toList();
}

/// The orbit index of the stop that belongs to the control keyed [key], or -1.
///
/// ONE direction only: the stop must sit INSIDE the control. A stop whose
/// context merely CONTAINS the control is some ancestor's node, and pressing
/// a key there activates nothing the control owns.
int _stopOf(List<FocusNode> orbit, Key key) {
  final Element control = find.byKey(key).evaluate().single;
  return orbit.indexWhere(
    (FocusNode n) => _isUnder(n.context as Element?, control),
  );
}

/// Presses Tab until [key]'s control holds focus — at most one full orbit —
/// then presses [activate]. Never `requestFocus`: the point is that a KEYBOARD
/// gets there. Not "clear focus, press Tab `stop + 1` times": a cleared focus
/// returns to its scope, and the scope remembers where it last was, so the
/// count is history-dependent (measured: it landed one stop late).
Future<void> _tabToAndPress(
  WidgetTester tester,
  List<FocusNode> orbit,
  Key key,
  LogicalKeyboardKey activate,
) async {
  final int stop = _stopOf(orbit, key);
  expect(stop, isNot(-1), reason: '$key owns no stop on the Tab orbit');
  for (int i = 0; i <= orbit.length; i++) {
    if (identical(tester.binding.focusManager.primaryFocus, orbit[stop])) {
      break;
    }
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
  }
  expect(
    identical(tester.binding.focusManager.primaryFocus, orbit[stop]),
    isTrue,
    reason: 'a whole orbit of Tab presses never landed on $key',
  );
  await tester.sendKeyEvent(activate);
  // A bounded advance of fake time: the page turn is a 250 ms animation, and
  // `pumpAndSettle` is refused for the reason the sweep's header gives.
  for (int i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  // `TestWidgetsFlutterBinding` first, for the reason `keyboard_sweep_test.dart`
  // records: resolving the router initialises a binding of its own otherwise.
  TestWidgetsFlutterBinding.ensureInitialized();
  final ProviderContainer routerContainer = ProviderContainer();
  tearDownAll(routerContainer.dispose);
  final GoRoute onboarding = () {
    final List<GoRoute> found = <GoRoute>[];
    void walk(List<RouteBase> routes) {
      for (final RouteBase r in routes) {
        if (r is GoRoute && r.path == kOnboarding) found.add(r);
        walk(r.routes);
      }
    }

    walk(routerContainer.read(routerProvider).configuration.routes);
    return found.single;
  }();

  /// The router's own `/onboarding` builder, mounted the way
  /// `keyboard_sweep_test.dart` mounts every route (`pumpAt`, the same host and
  /// surface), under an [InheritedGoRouter] so `context.go` at the exit has a
  /// router to go through. That router is NOT mounted, and it does not need to
  /// be: where it was sent is the fact under test, and [wentTo] reads it.
  ///
  /// ⚠️ NOT `MaterialApp.router`. MEASURED while this file was written: under
  /// it the first Tab never left the View scope, so the orbit was ONE node and
  /// every control on the page read as unreachable — a rig failure that looks
  /// exactly like the defect this file looks for.
  Future<({ProviderContainer container, GoRouter router})> pumpOnboarding(
    WidgetTester tester,
  ) async {
    final GoRouter host = GoRouter(
      initialLocation: kOnboarding,
      routes: <RouteBase>[
        GoRoute(path: kOnboarding, builder: onboarding.builder),
        GoRoute(
          path: '/sign-in',
          builder: (BuildContext _, GoRouterState _) => const SizedBox(),
        ),
      ],
    );
    addTearDown(host.dispose);
    final GoRouterState state = GoRouterState(
      host.configuration,
      uri: Uri.parse(kOnboarding),
      matchedLocation: kOnboarding,
      fullPath: kOnboarding,
      pathParameters: const <String, String>{},
      pageKey: const ValueKey<String>(kOnboarding),
    );
    await pumpAt(
      tester,
      kKeyboardSurface,
      InheritedGoRouter(
        goRouter: host,
        child: Builder(
          builder: (BuildContext c) => onboarding.builder!(c, state),
        ),
      ),
    );
    return (
      container: ProviderScope.containerOf(
        tester.element(find.byType(OnboardingView)),
      ),
      router: host,
    );
  }

  String wentTo(GoRouter router) =>
      router.routeInformationProvider.value.uri.path;

  int pageNow(WidgetTester tester) =>
      tester.widget<PageView>(find.byType(PageView)).controller!.page!.round();

  group('$kOnboarding · keyboard, page by page', () {
    testWidgets(
      'SC 2.1.1 · every page is fully on the Tab orbit, and Enter on the '
      'advance button walks to the last page and out to /sign-in',
      (WidgetTester tester) async {
        final (:ProviderContainer container, :GoRouter router) =
            await pumpOnboarding(tester);
        expect(find.byType(OnboardingView), findsOneWidget);
        expect(wentTo(router), kOnboarding);
        final int pages = tester
            .widget<OnboardingView>(find.byType(OnboardingView))
            .pages
            .length;
        expect(
          pages,
          greaterThan(1),
          reason:
              'a one-page onboarding is not a carousel, and this walk exists '
              'because the route is one. Re-read keyboard_sweep_test.dart\'s '
              'kCannotBeSwept: its reason may have expired',
        );

        int walked = 0;
        for (int p = 0; p < pages; p++) {
          expect(pageNow(tester), p, reason: 'the walk is not on page $p');
          final List<FocusNode> orbit = await _orbit(tester);
          final List<Element> controls = _controls();
          final List<Element> dead = controls
              .where(
                (Element e) => !orbit.any(
                  (FocusNode n) =>
                      _isUnder(e, n.context as Element?) ||
                      _isUnder(n.context as Element?, e),
                ),
              )
              .toList();
          expect(
            controls,
            isNotEmpty,
            reason: 'page $p of $kOnboarding built no control at all',
          );
          expect(
            dead.map((Element e) => e.widget.runtimeType).toList(),
            isEmpty,
            reason:
                'page $p of $kOnboarding builds ${controls.length} control(s) '
                'and ${dead.length} of them own no stop on the Tab orbit — a '
                'keyboard user cannot operate them',
          );
          // Both exits are reachable on EVERY page, not only the first: Skip
          // is the store-required way out, and it must not be pointer-only.
          expect(_stopOf(orbit, OnboardingView.skipButton), isNot(-1));
          await _tabToAndPress(
            tester,
            orbit,
            OnboardingView.advanceButton,
            LogicalKeyboardKey.enter,
          );
          walked++;
          if (p < pages - 1) {
            expect(
              pageNow(tester),
              p + 1,
              reason:
                  'Enter on the advance button of page $p did not turn the '
                  'page — the carousel is pointer- or swipe-only',
            );
          }
        }

        expect(walked, pages, reason: 'the walk skipped a page');
        expect(
          wentTo(router),
          '/sign-in',
          reason:
              'Enter on the LAST page\'s button did not leave $kOnboarding. '
              'That button is the fresh install\'s exit, and a keyboard user '
              'would be held on the last slide',
        );
        expect(
          container.read(onboardingSeenProvider),
          isTrue,
          reason: 'the keyboard exit left without recording onboarding as seen',
        );
      },
      variant: kKeyboardPlatforms,
    );

    testWidgets(
      'Skip is reachable by Tab and Space leaves from the first page',
      (WidgetTester tester) async {
        final (:ProviderContainer container, :GoRouter router) =
            await pumpOnboarding(tester);
        expect(pageNow(tester), 0);
        final List<FocusNode> orbit = await _orbit(tester);
        await _tabToAndPress(
          tester,
          orbit,
          OnboardingView.skipButton,
          LogicalKeyboardKey.space,
        );
        expect(wentTo(router), '/sign-in');
        expect(container.read(onboardingSeenProvider), isTrue);
      },
      variant: kKeyboardPlatforms,
    );
  });
}
