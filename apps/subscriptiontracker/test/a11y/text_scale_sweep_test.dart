// ─────────────────────────────────────────────────────────────────────────────
// SC 1.4.4 (RESIZE TEXT, LEVEL AA) — EVERY ROUTE AT 200 %, ON A SMALL PHONE.
//
// The app PERMITS 200 % text: `lib/app.dart` clamps the platform's scale with
// `MediaQuery.withClampedTextScaling(maxScaleFactor: 2.0)`, and WCAG 2.2 AA
// requires that range to WORK. Until this file 2.0 was exercised on about four
// surfaces (width_calendar, detail_notifications_states, sheet_failure_surface,
// chassis_properties) and never per route, while `lib/app.dart` itself records
// an overflow at 360×640 @2.0 that was found BY HAND (SYN-X1 C-12, train P39).
//
// ── THE ROUTE SET IS READ OUT OF THE ROUTER ─────────────────────────────────
// Exactly as `keyboard_sweep_test.dart` does it, with that file's own walk
// ([everyGoRoute]) and its own route INPUTS ([kPathParameters], [kExtra],
// [kSweptAs]) — imported, not copied, so there is one definition of what a
// route is and which state it is opened in, shared by both sweeps. Every route
// with a builder is pumped through the route's OWN builder: a route added
// tomorrow is swept tomorrow with no edit here.
//
// ── WHAT IS ASSERTED, PER ROUTE AND PER LOCALE (en, ta) ─────────────────────
// At a 360×640 window — the small-phone floor `lib/app.dart`'s note measures —
// with `TextScaler.linear(2.0)`:
//   1. NO OVERFLOW. Every `FlutterError` the frame reports is collected; one
//      that says "overflowed" fails the route BY NAME, with the error.
//   2. NO CONTROL BELOW THE FOLD THAT CANNOT BE SCROLLED TO. A control (a
//      `GestureDetector`/`InkWell` with an `onTap`, or an `EditableText`) whose
//      rect ends below the window and that has NO `Scrollable` ancestor is a
//      control a user at 200 % can never reach. Inside a `Scrollable` it is
//      reachable by scrolling, which 1.4.4 permits in the scrolling axis.
//   3. THE SCREEN BUILT SOMETHING — at least one `Text` — so a route whose
//      builder threw before painting cannot pass on an empty tree.
// Tamil is the second locale on purpose: its strings run far longer than
// English (`lib/app.dart` measured 1180 px of overflow in ta against 644 in en
// on the same box), so a layout that only survives English is caught here.
//
// ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
// The route's screen is pumped WITHOUT the app shell (no bottom bar, no
// `GoRouter` above it), as the keyboard sweep pumps it. The shell's own nav at
// 200 % is the `shell ·` groups' job. `/onboarding` is swept on the page it
// opens on; its later pages are a carousel this rig does not drive (the same
// limit [kCannotBeSwept] records for the keyboard).
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show FlutterExceptionHandler;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations;
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import '../support/width_harness.dart' show defaultWidthOverrides;
import 'keyboard_sweep_test.dart'
    show everyGoRoute, kExtra, kPathParameters, kSweptAs;

/// The small-phone window `lib/app.dart`'s 2.0 note was measured at.
const Size kTextScaleSurface = Size(360, 640);

/// The largest scale the app permits (`maxScaleFactor: 2.0`, lib/app.dart).
const double kMaxPermittedScale = 2.0;

/// The locales swept: the source language and the longest-running one.
const List<Locale> kTextScaleLocales = <Locale>[Locale('en'), Locale('ta')];

/// One route's reading at 200 %.
class TextScaleReading {
  TextScaleReading(this.overflows, this.unreachable, this.texts);

  final List<String> overflows;
  final List<String> unreachable;
  final int texts;
}

/// True when some ancestor of [e] is a [Scrollable].
bool _scrolls(Element e) {
  bool found = false;
  e.visitAncestorElements((Element a) {
    if (a.widget is Scrollable) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/// Pumps [screen] at [kTextScaleSurface] with 200 % text in [locale] and
/// reads it. Errors are COLLECTED, not thrown, so a route reports every
/// overflow it has rather than the first.
Future<TextScaleReading> readAtDoubleText(
  WidgetTester tester,
  Widget screen,
  Locale locale, {
  List<Override> overrides = const <Override>[],
}) async {
  // The VIEW, not only the surface: `setSurfaceSize` leaves `MediaQuery` at
  // 800×600 (width_harness.dart says so), and a layout sized off MediaQuery
  // would be measured at the wrong window.
  tester.view.physicalSize = kTextScaleSurface;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final List<String> overflows = <String>[];
  final FlutterExceptionHandler? previous = FlutterError.onError;
  FlutterError.onError = (FlutterErrorDetails d) {
    final String text = d.exceptionAsString();
    if (text.contains('overflowed')) {
      // The first line names the size; the creator location names the widget,
      // which is what makes the failure fixable without re-running by hand.
      final RegExpMatch? at = RegExp(
        r'lib/[^\s:]+\.dart:\d+:\d+',
      ).firstMatch(d.toString());
      overflows.add(
        '${text.split('\n').first}${at == null ? '' : ' (${at.group(0)})'}',
      );
    } else {
      previous?.call(d);
    }
  };
  try {
    final Set<Object> replaced = <Object>{
      for (final Override o in overrides) o.origin,
    };
    final ProviderContainer c = ProviderContainer(
      retry: (int retryCount, Object error) => null,
      overrides: <Override>[
        for (final Override o in defaultWidthOverrides())
          if (!replaced.contains(o.origin)) o,
        ...overrides,
      ],
    );
    addTearDown(c.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: MaterialApp(
          locale: locale,
          localizationsDelegates: <LocalizationsDelegate<dynamic>>[
            ...AppLocalizations.localizationsDelegates,
            ChassisLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: const TextScaler.linear(kMaxPermittedScale)),
            child: child!,
          ),
          home: screen,
        ),
      ),
    );
    // A bounded advance of fake time, as the keyboard sweep does: provider
    // futures resolve in sequence, and `pumpAndSettle` spins forever on a
    // screen whose timer never quiesces.
    for (int i = 0; i < 40; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  } finally {
    FlutterError.onError = previous;
  }

  final List<String> unreachable = <String>[];
  final List<Element> controls = <Element>[
    for (final Element e in find.byType(GestureDetector).evaluate())
      if ((e.widget as GestureDetector).onTap != null) e,
    for (final Element e in find.byType(InkWell).evaluate())
      if ((e.widget as InkWell).onTap != null) e,
    ...find.byType(EditableText).evaluate(),
  ];
  for (final Element e in controls) {
    final RenderObject? r = e.renderObject;
    if (r is! RenderBox || !r.hasSize || !r.attached) continue;
    final Rect rect = r.localToGlobal(Offset.zero) & r.size;
    if (rect.bottom <= kTextScaleSurface.height + 0.5) continue;
    if (_scrolls(e)) continue;
    unreachable.add(
      '${e.widget.runtimeType} at ${rect.top.toStringAsFixed(0)}–'
      '${rect.bottom.toStringAsFixed(0)} px',
    );
  }
  return TextScaleReading(
    overflows,
    unreachable,
    find.byType(Text).evaluate().length,
  );
}

void main() {
  // The router is read from a container, BEFORE any testWidgets: see
  // keyboard_sweep_test.dart for why the binding is initialised first.
  TestWidgetsFlutterBinding.ensureInitialized();
  final ProviderContainer container = ProviderContainer();
  tearDownAll(container.dispose);
  final GoRouter router = container.read(routerProvider);
  final List<GoRoute> screenBearing = everyGoRoute(
    router.configuration.routes,
  ).where((GoRoute r) => r.builder != null).toList();

  test('the sweep ranges over the router, not over a list', () {
    // A floor, not a pin: the keyboard sweep pins the exact count (16). This
    // half only refuses a walk that silently found (almost) nothing.
    expect(
      screenBearing.length,
      greaterThanOrEqualTo(16),
      reason:
          'the router walk found ${screenBearing.length} screen-bearing '
          'route(s); the app declares 16. A sweep over fewer is a sweep that '
          'stopped reaching the router.',
    );
  });

  for (final GoRoute route in screenBearing) {
    for (final Locale locale in kTextScaleLocales) {
      testWidgets('${route.path} · ${locale.languageCode} · 200 % text at '
          '${kTextScaleSurface.width.toInt()}×'
          '${kTextScaleSurface.height.toInt()}', (WidgetTester tester) async {
        final GoRouterState state = GoRouterState(
          router.configuration,
          uri: Uri.parse(route.path),
          matchedLocation: route.path,
          fullPath: route.path,
          pathParameters:
              kPathParameters[route.path] ?? const <String, String>{},
          extra: kExtra[route.path],
          pageKey: ValueKey<String>(route.path),
        );
        final TextScaleReading r = await readAtDoubleText(
          tester,
          Builder(builder: (BuildContext c) => route.builder!(c, state)),
          locale,
          overrides: kSweptAs[route.path] ?? const <Override>[],
        );
        expect(
          r.texts,
          greaterThan(0),
          reason: '${route.path} painted no Text at all, so nothing was read',
        );
        expect(
          r.overflows,
          isEmpty,
          reason:
              '${route.path} (${locale.languageCode}) OVERFLOWS at 200 % '
              'text on a 360×640 window — a size the app permits '
              '(maxScaleFactor 2.0) and WCAG 2.2 SC 1.4.4 requires to work:\n'
              '${r.overflows.join('\n')}',
        );
        expect(
          r.unreachable,
          isEmpty,
          reason:
              '${route.path} (${locale.languageCode}) puts control(s) below '
              'the fold with NO scrollable ancestor at 200 % text, so a user '
              'at that size can never reach them:\n'
              '${r.unreachable.join('\n')}',
        );
      });
    }
  }

  // ── THE RIG CAN FAIL ─────────────────────────────────────────────────────
  // A sweep whose assertions cannot go red is worse than none. These two pump
  // a deliberately broken screen through the SAME reader and require it to
  // report the defect, so a reader that stopped seeing overflows (or stopped
  // seeing controls) fails here rather than reading clean everywhere.
  testWidgets('RED CONTROL · a fixed-height Column of long text overflows', (
    WidgetTester tester,
  ) async {
    final TextScaleReading r = await readAtDoubleText(
      tester,
      Scaffold(
        body: Column(
          children: <Widget>[
            for (int i = 0; i < 12; i++)
              const Text('A line of copy that wraps'),
          ],
        ),
      ),
      const Locale('en'),
    );
    expect(r.overflows, isNotEmpty);
  });

  testWidgets(
    'RED CONTROL · a button pushed below the fold, unscrollable, is caught',
    (WidgetTester tester) async {
      final TextScaleReading r = await readAtDoubleText(
        tester,
        Scaffold(
          body: OverflowBox(
            alignment: Alignment.topCenter,
            maxHeight: 2000,
            child: Column(
              children: <Widget>[
                const SizedBox(height: 900),
                TextButton(onPressed: () {}, child: const Text('Continue')),
              ],
            ),
          ),
        ),
        const Locale('en'),
      );
      expect(r.unreachable, isNotEmpty);
    },
  );
}
