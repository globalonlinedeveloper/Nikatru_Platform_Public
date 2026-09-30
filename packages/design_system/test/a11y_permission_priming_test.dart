// ─────────────────────────────────────────────────────────────────────────────
// a11y_permission_priming_test.dart — the accessibility sweep for
// `PermissionPrimingView` (train ST-D8).
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body.
// Both schemes, at a phone, a tablet and a desktop width.
//
// The subject floor is MEASURED, not hoped for: 2 activatable nodes (Not now,
// Continue) and 6 labelled ones (the title, the body, both reasons and both
// buttons). A sweep over fewer ranged over less than this surface has, and
// passed whatever the code did.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const String _title = 'Allow reminders?';
const String _body =
    'We will ask your device for permission to send reminders. You can '
    'change this at any time in Settings.';
const List<String> _reasons = <String>[
  'A heads-up two days before each renewal',
  'Nothing else: no marketing, ever',
];

void _expectSubjects(WidgetTester tester) {
  final List<SemanticsNode> nodes = tester.semantics
      .simulatedAccessibilityTraversal()
      .toList();
  final int tappable = nodes
      .where(
        (SemanticsNode n) =>
            n.getSemanticsData().hasAction(SemanticsAction.tap),
      )
      .length;
  final int labelled = nodes
      .where((SemanticsNode n) => n.getSemanticsData().label.trim().isNotEmpty)
      .length;
  expect(tappable, greaterThanOrEqualTo(2), reason: 'COVERAGE LOST — tappable');
  expect(labelled, greaterThanOrEqualTo(6), reason: 'COVERAGE LOST — labelled');
}

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('PermissionPrimingView, phone, ${b.name}', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(375, 812));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: Scaffold(
            body: PermissionPrimingView(
              title: _title,
              body: _body,
              reasons: _reasons,
              allowLabel: 'Continue',
              notNowLabel: 'Not now',
              onAllow: () {},
              onNotNow: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      _expectSubjects(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }

  for (final Brightness b in Brightness.values) {
    testWidgets('PermissionPrimingView, tablet, ${b.name}', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(768, 1024));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: Scaffold(
            body: PermissionPrimingView(
              title: _title,
              body: _body,
              reasons: _reasons,
              allowLabel: 'Continue',
              notNowLabel: 'Not now',
              onAllow: () {},
              onNotNow: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      _expectSubjects(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }

  for (final Brightness b in Brightness.values) {
    testWidgets('PermissionPrimingView, desktop, ${b.name}', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.binding.setSurfaceSize(const Size(1280, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
          home: Scaffold(
            body: PermissionPrimingView(
              title: _title,
              body: _body,
              reasons: _reasons,
              allowLabel: 'Continue',
              notNowLabel: 'Not now',
              onAllow: () {},
              onNotNow: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      _expectSubjects(tester);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }
}
