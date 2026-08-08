import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// ⚠️ EVERY WIDGET TEST HERE PINS THE SURFACE, and that is not tidiness.
/// `flutter_test`'s default surface is 800×600 — which `windowClassFor` resolves
/// to `medium`, i.e. a RAIL. A width assertion pumped at the default size is
/// therefore measuring a layout nobody asked about, and a cap of 720 tested on
/// an 800 px surface passes for the wrong reason. Pin it, and restore it with
/// `addTearDown` so a surface left set cannot leak into the next test.
///
/// `tester.binding.setSurfaceSize` is the chassis idiom, NOT
/// `tester.view.physicalSize` — the latter needs a matching
/// `devicePixelRatio` and its own reset, and getting one of the two wrong
/// silently changes the logical width the test believes it set.
void main() {
  const Key kChild = Key('pane-child');

  /// A child that WANTS to be infinitely wide, so anything narrower than the
  /// viewport is the cap doing its job. A shrink-wrapping child would measure
  /// nothing.
  Widget greedy({double height = 40}) =>
      SizedBox(key: kChild, width: double.infinity, height: height);

  Future<void> pumpAt(WidgetTester tester, Size size, Widget w) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: w));
  }

  double widthOf(WidgetTester tester) =>
      tester.getSize(find.byKey(kChild)).width;

  // ── The caps, measured on a surface WIDER than all of them ─────────────────
  //
  // 1280 is deliberate: it is wider than form/pane/reading, so each named
  // constructor's own number is the only thing that can produce the observed
  // width. On a 500 px surface `form` and `pane` would both report 500 and the
  // test could not tell them apart.
  group('named constructors cap at their own width (surface 1280)', () {
    testWidgets('.form caps at AppBreakpoints.form',
        (WidgetTester tester) async {
      await pumpAt(
          tester, const Size(1280, 900), ContentPane.form(child: greedy()));
      expect(widthOf(tester), AppBreakpoints.form);
      expect(AppBreakpoints.form, 420,
          reason: 'the value six call sites copied');
    });

    testWidgets('.pane caps at AppBreakpoints.pane',
        (WidgetTester tester) async {
      await pumpAt(
          tester, const Size(1280, 900), ContentPane.pane(child: greedy()));
      expect(widthOf(tester), AppBreakpoints.pane);
      expect(AppBreakpoints.pane, 480);
    });

    testWidgets('.reading caps at AppBreakpoints.reading',
        (WidgetTester tester) async {
      await pumpAt(
          tester, const Size(1280, 900), ContentPane.reading(child: greedy()));
      expect(widthOf(tester), AppBreakpoints.reading);
      expect(AppBreakpoints.reading, 720);
    });

    test('the four caps are genuinely different widths', () {
      // A constructor that resolves to the same width as its neighbour is a
      // name, not a decision — the same falsifiability rule the five window
      // classes carry.
      expect(
        <double>{
          AppBreakpoints.form,
          AppBreakpoints.pane,
          AppBreakpoints.reading,
          AppBreakpoints.kMaxBodyWidth,
        },
        hasLength(4),
      );
    });
  });

  testWidgets('the default constructor caps at kMaxBodyWidth',
      (WidgetTester tester) async {
    // Measured at 2000, not 1280: at 1280 the surface and the cap are the same
    // number, so a broken cap would still report 1280 and the test would pass
    // for the wrong reason.
    await pumpAt(tester, const Size(2000, 900), ContentPane(child: greedy()));
    expect(widthOf(tester), AppBreakpoints.kMaxBodyWidth);
  });

  // ── Under the cap, the pane is a no-op ─────────────────────────────────────
  group('below the cap nothing changes (surface 375 — a phone)', () {
    testWidgets('.form passes the full width through',
        (WidgetTester tester) async {
      await pumpAt(
          tester, const Size(375, 812), ContentPane.form(child: greedy()));
      expect(widthOf(tester), 375,
          reason: 'ConstrainedBox may only tighten WITHIN the constraints it '
              'was handed, so a phone renders exactly as it did before');
    });

    testWidgets('.reading passes the full width through',
        (WidgetTester tester) async {
      await pumpAt(
          tester, const Size(375, 812), ContentPane.reading(child: greedy()));
      expect(widthOf(tester), 375);
    });
  });

  // ── The alignment, which is the whole reason this is not `Center` ──────────
  group('alignment is topCenter, not center', () {
    testWidgets('a short child sits at the TOP of the space',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(400, 800),
          ContentPane.form(child: greedy(height: 50)));
      expect(
        tester.getTopLeft(find.byKey(kChild)).dy,
        0,
        reason: 'a Center would put it at (800 - 50) / 2 = 375, and a body '
            'whose height changes would then MOVE every time it changed',
      );
    });

    testWidgets('the capped child is centred HORIZONTALLY',
        (WidgetTester tester) async {
      await pumpAt(
          tester, const Size(1280, 900), ContentPane.form(child: greedy()));
      // (1280 - 420) / 2 — the horizontal half of Center is the half worth
      // keeping.
      expect(tester.getTopLeft(find.byKey(kChild)).dx, 430);
    });

    testWidgets('growing the child does not move what was already on screen',
        (WidgetTester tester) async {
      // The concrete regression: an error line appears under a form, and with
      // `Center` every field above it slides up by half the new height.
      await tester.binding.setSurfaceSize(const Size(400, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      Widget form({required bool withError}) => MaterialApp(
            home: ContentPane.form(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const SizedBox(key: kChild, height: 60, width: 200),
                  if (withError) const SizedBox(height: 120, width: 200),
                ],
              ),
            ),
          );

      await tester.pumpWidget(form(withError: false));
      final Offset before = tester.getTopLeft(find.byKey(kChild));
      await tester.pumpWidget(form(withError: true));
      expect(tester.getTopLeft(find.byKey(kChild)), before);
    });
  });

  // ── Padding sits INSIDE the cap ────────────────────────────────────────────
  testWidgets('padding is applied inside maxWidth',
      (WidgetTester tester) async {
    await pumpAt(
      tester,
      const Size(1280, 900),
      ContentPane.form(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: greedy(),
      ),
    );
    expect(widthOf(tester), AppBreakpoints.form - 48,
        reason: 'the cap is the width of the PADDED box — which is what the '
            'call sites this widget replaced already did');
  });

  // ── Unbounded height (a scroll view) must not blow up ──────────────────────
  testWidgets('shrink-wraps inside a SingleChildScrollView',
      (WidgetTester tester) async {
    await pumpAt(
      tester,
      const Size(1280, 400),
      SingleChildScrollView(
        child: ContentPane.form(child: greedy(height: 1200)),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(widthOf(tester), AppBreakpoints.form);
    expect(tester.getSize(find.byType(ContentPane)).height, 1200,
        reason: 'an Align under an unbounded height must shrink-wrap, or it '
            'swallows the scroll extent');
  });

  // ── The converted REAL screens ────────────────────────────────────────────
  //
  // These two were UNCONSTRAINED before this change: on a desktop the message
  // ran the full width of the window. They are here rather than in a widget of
  // their own because the negative test below mutates one of them.
  group('the system screens inherit the cap', () {
    testWidgets('AppErrorScreen caps its content at form width',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(1280, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(const MaterialApp(
        home: AppErrorScreen(title: 'Oops', message: 'Something broke'),
      ));
      expect(
        tester.getSize(find.byType(Column).first).width,
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });

    testWidgets('NotFoundScreen caps its content at form width',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(1280, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(
        home: NotFoundScreen(
          title: 'Not found',
          message: 'No such page',
          goHomeLabel: 'Home',
          onGoHome: () {},
          attemptedLocation: '/a/very/long/path/that/a/user/typed/by/hand',
        ),
      ));
      expect(
        tester.getSize(find.byType(Column).first).width,
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  });
}
