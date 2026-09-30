// PERMISSION PRIMING — train ST-D8. Behaviour, the sheet/dialog split per
// window class, and one golden per window class x theme. The a11y sweep is
// `a11y_permission_priming_test.dart`, named so the coverage guard counts it.
//
// Regenerate the goldens, after a DELIBERATE visual change only, from the repo
// root:
//   flutter test --update-goldens packages/design_system/test/permission_priming_test.dart
// and review every PNG before committing it. ⚠️ LINUX ONLY, for the renderer
// reason `packages/design_system/test/foundation_golden_test.dart` records.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The three windows every surface here is measured at — a phone, a tablet
/// and a desktop, the chassis harness's own three sizes.
///
/// ⚠️ PRIVATE NAMES ON PURPOSE. `assert-responsive-coverage.mjs` harvests every
/// `const Size k… = Size(…)` from this root's tests when it has no support
/// harness, and one such declaration would switch the WHOLE of
/// `packages/design_system` to the three-window form for every surface it
/// holds — a decision for its own change, not a side effect of this file.
const Size _phone = Size(375, 812);
const Size _tablet = Size(768, 1024);
const Size _desktop = Size(1280, 900);

/// Subly's seed, the one the foundation goldens use.
const Color _seed = Color(0xFF6459F5);

const String _title = 'Allow reminders?';
const String _body =
    'We will ask your device for permission to send reminders. You can change '
    'this at any time in Settings.';
const List<String> _reasons = <String>[
  'A heads-up two days before each renewal',
  'Nothing else: no marketing, ever',
];

PermissionPrimingView _view({
  VoidCallback? onAllow,
  VoidCallback? onNotNow,
  List<String> reasons = _reasons,
}) => PermissionPrimingView(
  title: _title,
  body: _body,
  reasons: reasons,
  allowLabel: 'Continue',
  notNowLabel: 'Not now',
  onAllow: onAllow ?? () {},
  onNotNow: onNotNow ?? () {},
);

/// A launcher that records what [showPermissionPriming] answered.
class _Launcher extends StatefulWidget {
  const _Launcher({required this.onAnswer});
  final ValueChanged<bool> onAnswer;

  @override
  State<_Launcher> createState() => _LauncherState();
}

class _LauncherState extends State<_Launcher> {
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: FilledButton(
        key: const Key('launch'),
        onPressed: () async {
          final bool answer = await showPermissionPriming(
            context,
            title: _title,
            body: _body,
            reasons: _reasons,
            allowLabel: 'Continue',
            notNowLabel: 'Not now',
          );
          widget.onAnswer(answer);
        },
        child: const Text('Turn on'),
      ),
    ),
  );
}

/// The route the priming view was pushed on — the platform-owned half of the
/// split (a sheet drags down, a dialog closes on Escape), read off the route
/// rather than off a private widget type a Flutter upgrade may rename.
ModalRoute<Object?>? _routeOf(WidgetTester tester) =>
    ModalRoute.of(tester.element(find.byType(PermissionPrimingView)));

/// Pumps [child] in a WINDOW of [size].
///
/// ⚠️ THE VIEW, NOT THE SURFACE, and the difference is the thing under test.
/// `setSurfaceSize` sizes the render SURFACE and leaves the test view at its
/// 800 px default, so `MediaQuery.sizeOf` — which [showPermissionPriming]
/// reads, because it must see the window and not the caller's pane — answers
/// 800 at "phone" and every phone case would measure a medium window.
/// Measured: the first draft of this suite pumped with `setSurfaceSize` at 375
/// and got a dialog where the sheet was asserted.
Future<void> _pumpWindow(WidgetTester tester, Size size, Widget child) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}

/// Pumps [child] on a surface of [size], for the cases that read no window.
Future<void> _pumpSurface(WidgetTester tester, Size size, Widget child) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: child));
  await tester.pumpAndSettle();
}

void main() {
  group('property: priming-never-spends-the-prompt-on-a-no', () {
    testWidgets('the primary answers true', (WidgetTester tester) async {
      bool? answer;
      await _pumpWindow(
        tester,
        _phone,
        _Launcher(onAnswer: (bool a) => answer = a),
      );
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(PermissionPrimingView.allowButton));
      await tester.pumpAndSettle();
      expect(answer, isTrue);
      expect(find.byType(PermissionPrimingView), findsNothing);
    });

    testWidgets('"Not now" answers false', (WidgetTester tester) async {
      bool? answer;
      await _pumpWindow(
        tester,
        _phone,
        _Launcher(onAnswer: (bool a) => answer = a),
      );
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(PermissionPrimingView.notNowButton));
      await tester.pumpAndSettle();
      expect(answer, isFalse);
    });

    // The platform-owned exits: the scrim on a phone, Escape on a desktop.
    // Either is a "no", never a null the caller might read as a yes.
    testWidgets('a scrim dismissal on a phone answers false', (
      WidgetTester tester,
    ) async {
      bool? answer;
      await _pumpWindow(
        tester,
        _phone,
        _Launcher(onAnswer: (bool a) => answer = a),
      );
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      await tester.tapAt(const Offset(8, 8));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsNothing);
      expect(answer, isFalse);
    });

    testWidgets('Escape on a desktop answers false', (
      WidgetTester tester,
    ) async {
      bool? answer;
      await _pumpWindow(
        tester,
        _desktop,
        _Launcher(onAnswer: (bool a) => answer = a),
      );
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsNothing);
      expect(answer, isFalse);
    });
  });

  group('property: priming-fits-the-window', () {
    testWidgets('phone — a bottom sheet, where the thumb is', (
      WidgetTester tester,
    ) async {
      await _pumpWindow(tester, _phone, _Launcher(onAnswer: (_) {}));
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      expect(_routeOf(tester), isA<ModalBottomSheetRoute<bool>>());
    });

    Future<void> expectCappedDialog(WidgetTester tester) async {
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      expect(_routeOf(tester), isA<DialogRoute<bool>>());
      expect(
        tester.getSize(find.byType(PermissionPrimingView)).width,
        lessThanOrEqualTo(AppBreakpoints.pane),
      );
    }

    testWidgets('tablet — a dialog capped at the pane width', (
      WidgetTester tester,
    ) async {
      await _pumpWindow(tester, _tablet, _Launcher(onAnswer: (_) {}));
      await expectCappedDialog(tester);
    });

    testWidgets('desktop — a dialog capped at the pane width', (
      WidgetTester tester,
    ) async {
      await _pumpWindow(tester, _desktop, _Launcher(onAnswer: (_) {}));
      await expectCappedDialog(tester);
    });

    testWidgets('no reasons, no list: nothing empty is drawn', (
      WidgetTester tester,
    ) async {
      await _pumpSurface(
        tester,
        _phone,
        Scaffold(body: _view(reasons: const <String>[])),
      );
      expect(find.byIcon(Icons.check_circle_outline), findsNothing);
      await _pumpSurface(tester, _phone, Scaffold(body: _view()));
      expect(find.byIcon(Icons.check_circle_outline), findsNWidgets(2));
    });

    testWidgets('text scale 2.0 in a 320 px window does not overflow', (
      WidgetTester tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(320, 640));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: ChassisLocalizations.localizationsDelegates,
          supportedLocales: ChassisLocalizations.supportedLocales,
          builder: (BuildContext c, Widget? child) => MediaQuery(
            data: MediaQuery.of(
              c,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: _Launcher(onAnswer: (_) {}),
        ),
      );
      await tester.tap(find.byKey(const Key('launch')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(PermissionPrimingView.allowButton), findsOneWidget);
    });
  });

  group('golden: permission priming', () {
    const Map<String, Size> classes = <String, Size>{
      'compact': Size(390, 844),
      'medium': Size(700, 1000),
      'expanded': Size(1024, 900),
      'large': Size(1440, 900),
    };

    test('each photographed size is the class it is named for', () {
      expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
      expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
      expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
      expect(windowClassFor(classes['large']!.width), WindowClass.large);
    });

    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('priming · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          // Half density, for the reason the foundation goldens record.
          tester.view.physicalSize = c.value * 0.5;
          tester.view.devicePixelRatio = 0.5;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(
            MaterialApp(
              debugShowCheckedModeBanner: false,
              localizationsDelegates:
                  ChassisLocalizations.localizationsDelegates,
              supportedLocales: ChassisLocalizations.supportedLocales,
              theme: buildAppTheme(seed: _seed, brightness: b),
              home: _Launcher(onAnswer: (_) {}),
            ),
          );
          await tester.tap(find.byKey(const Key('launch')));
          await tester.pumpAndSettle();
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile(
              'goldens/permission_priming_${c.key}_${b.name}.png',
            ),
          );
        }, skip: !Platform.isLinux);
      }
    }
  });
}
