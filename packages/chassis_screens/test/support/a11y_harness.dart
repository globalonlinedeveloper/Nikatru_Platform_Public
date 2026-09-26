import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The pump and the FALSIFIERS the `a11y_*_test.dart` sweeps in this package
/// are built on.
///
/// ── WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT A COPY ──────────────────
/// `apps/subscriptiontracker/test/a11y_semantics_test.dart` carries a hand-rolled sweep
/// family (`nakedControls` / `expectNothingNaked`) and two hand-rolled
/// falsifier guidelines. NONE of it is importable from here: it lives in a
/// TEST file of an APP, and Dart can only import `lib/` of a package. Copying
/// ~150 lines of it into this package would create the second copy of a parse
/// that nothing compares — the exact failure `assert-a11y-coverage.mjs`'s own
/// header records about `deriveRoots()` having four call sites.
///
/// So this file does the opposite: every sweep below this package runs is
/// `flutter_test`'s OWN, which is one implementation shipped by the framework
/// and shared by every root that calls it —
///   · [androidTapTargetGuideline]  — 48x48 hit area ([ADR 048]'s figure, and
///     WCAG 2.2 SC 2.5.5 Enhanced's 44 clears with it)
///   · [labeledTapTargetGuideline]  — every tappable node announces a NAME
///   · [textContrastGuideline]      — WCAG 2.2 SC 1.4.3 contrast
/// and what is added here is the ONE thing the framework does not supply: proof
/// that the guideline looked at anything.
///
/// 🔴 THE ROLE HALF OF THE SUBLY WALK IS NOT REPRODUCED HERE, AND IT IS
/// RECORDED RATHER THAN QUIETLY DROPPED. `nakedControls` fails a node that has
/// a tap action and announces no ROLE (`isButton` / `isLink` / …).
/// `labeledTapTargetGuideline` covers the NAME half of the same question and
/// nothing in the framework covers the role half, so this package's sweeps are
/// narrower than subscriptiontracker's by exactly that one predicate. Closing it needs the
/// walk to live in a package both roots can import, which is a decision about
/// where shared test support lives and not a thing to settle by copying.
/// See `research/revamp-2026-09-05/post-audit-chassis-screens-a11y.md` §
/// residues.
///
/// ⚠️ `tester.ensureSemantics()` IS RELEASED IN A `finally`, NEVER IN
/// `addTearDown`. `flutter_test` verifies that no `SemanticsHandle` outlives
/// the test BEFORE tear-downs run, so a handle released in a tear-down reports
/// as leaked and buries the real failure under a second, unrelated one. Same
/// reasoning `apps/subscriptiontracker/test/a11y_semantics_test.dart` records.

/// The seed every stamped app's theme is built from in the brick's `app.dart`.
///
/// ⚠️ THE THEME IS NOT OPTIONAL FOR A CONTRAST SWEEP, WHICH IS WHY THIS PUMP
/// EXISTS BESIDE `pumpChassis`. `support/width_harness.dart` pumps a bare
/// `MaterialApp` with NO theme, because a width does not depend on one. A
/// contrast ratio depends on nothing else: measured against Flutter's default
/// `ThemeData`, `textContrastGuideline` would be grading colours no stamped app
/// ever renders.
const Color kChassisSeed = Color(0xFF6750A4);

/// The five platforms every `a11y_*_test.dart` sweep in this package runs on.
///
/// O-DESKTOP-TAP-TARGETS-BELOW-48. `ThemeData` derives `materialTapTargetSize`
/// and `visualDensity` from the platform, and flutter_test's default platform
/// is android, so a sweep pumped only there graded the MOBILE defaults and
/// said nothing about linux, macOS or windows. The variant sets the platform
/// override for the test body; [pumpForA11y] builds the theme inside that
/// body, so the theme it hands `MaterialApp` is the one each platform gets.
const TargetPlatformVariant kTapTargetPlatforms = TargetPlatformVariant(
  <TargetPlatform>{
    TargetPlatform.android,
    TargetPlatform.iOS,
    TargetPlatform.linux,
    TargetPlatform.macOS,
    TargetPlatform.windows,
  },
);

/// Pumps [child] under the chassis theme at [size], in [brightness].
Future<void> pumpForA11y(
  WidgetTester tester,
  Size size,
  Widget child, {
  Brightness brightness = Brightness.light,
  Locale locale = const Locale('en'),
  bool settle = true,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      theme: buildAppTheme(seed: kChassisSeed, brightness: brightness),
      home: child,
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

/// Pumps a widget that is ALREADY an application root — `NikatruApp` brings its
/// own `MaterialApp`, so wrapping it in another one measures a tree no app
/// mounts.
Future<void> pumpRootForA11y(
  WidgetTester tester,
  Size size,
  Widget app, {
  bool settle = true,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(app);
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }
}

/// Positive proof the guideline sweeps beside this call ranged over something.
///
/// 🔴 THE WHOLE REASON EVERY CASE IN THIS PACKAGE CARRIES ONE. An
/// [AccessibilityGuideline] that inspects NOTHING returns `Evaluation.pass()`,
/// which is byte-identical to a screen whose every control is the right size
/// and every string legible. [ADR 048] records six of subscriptiontracker's nineteen surfaces
/// sitting in exactly that state while the tap-target increment was written,
/// and [ADR 050] records the same shape one level up as the reason a vacuous
/// conformance claim is worse than none.
///
/// The subjects are counted off `simulatedAccessibilityTraversal()` — the
/// framework's own traversal, in the order a screen reader walks it, with
/// merged nodes already collapsed. Nothing is re-implemented here: the count is
/// read off the same tree the guidelines read.
///
/// [tappable] and [labelled] are MEASURED numbers, not aspirations — each was
/// read off this rig on 2026-09-07 and written down, so a case whose surface
/// silently empties (a redirect landing nowhere, a pump that never laid out)
/// fails by name instead of passing over nothing.
void expectSweepHadSubjects(
  WidgetTester tester,
  String screen, {
  required int tappable,
  required int labelled,
}) {
  final List<SemanticsNode> traversal = tester.semantics
      .simulatedAccessibilityTraversal()
      .toList();
  final int tapCount = traversal
      .where(
        (SemanticsNode n) => n.getSemanticsData().hasAction(SemanticsAction.tap),
      )
      .length;
  final int labelCount = traversal
      .where((SemanticsNode n) => n.getSemanticsData().label.trim().isNotEmpty)
      .length;
  expect(
    tapCount,
    greaterThanOrEqualTo(tappable),
    reason:
        'COVERAGE LOST — $screen offered only $tapCount activatable node(s), '
        'below the $tappable this surface was measured to have. The tap-target '
        'and labelled-tap-target sweeps beside this call then range over almost '
        'nothing and pass whatever the code does.',
  );
  expect(
    labelCount,
    greaterThanOrEqualTo(labelled),
    reason:
        'COVERAGE LOST — $screen announced only $labelCount non-empty label(s), '
        'below the $labelled this surface was measured to have. The contrast '
        'sweep beside this call rasterises text nodes; with none, it reports '
        'the screen legible having read nothing off it.',
  );
}
