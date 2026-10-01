import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// ST truth pass (2026-10-01, EN-17): the three screens that REPLACE the app —
/// the update wall, the 404 and the build-error screen — at 200 % text on a
/// 360×640 phone. Each was a centred or top-aligned `Column` with no scroll, so
/// a translated paragraph at 2.0 pushed its only control off the screen and
/// drew the overflow stripe instead. Each now scrolls, and each title is a
/// heading a reader can jump to.
///
/// The copy is deliberately long — the length a translation reaches, not the
/// length English happens to be.
const String _title = 'This needs your attention before you go on';
const String _message =
    'This version of the app can no longer be used. Everything you saved is '
    'safe and will be here when you come back. Install the latest version to '
    'carry on — it takes a minute, and nothing needs to be entered again. If '
    'the store does not offer it yet, try again in a little while.';
const String _action = 'Update now';

Future<void> _pumpAt2x(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(360, 640);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: const TextScaler.linear(2)),
        child: child!,
      ),
      home: screen,
    ),
  );
  await tester.pump();
}

void _expectHeader(WidgetTester tester, String title) {
  final SemanticsNode node = tester.getSemantics(find.text(title));
  expect(
    node.getSemanticsData().hasFlag(SemanticsFlag.isHeader),
    isTrue,
    reason: '"$title" is the screen\'s title and must be announced as one',
  );
}

void main() {
  testWidgets('ForceUpdateGate scrolls at 200 % and its title is a heading', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pumpAt2x(
      tester,
      ForceUpdateGate(
        mustUpdate: true,
        title: _title,
        message: _message,
        buttonLabel: _action,
        onUpdate: () {},
        child: const SizedBox.shrink(),
      ),
    );
    expect(tester.takeException(), isNull, reason: 'no overflow at 2.0');
    await tester.scrollUntilVisible(find.text(_action), 100);
    expect(find.text(_action), findsOneWidget);
    _expectHeader(tester, _title);
    handle.dispose();
  });

  // Its WIDTH, at the three window classes: the wall is centred and capped at
  // the form reading width, never a full-bleed line of copy on a desktop.
  for (final Size window in const <Size>[
    Size(375, 812),
    Size(768, 1024),
    Size(1280, 900),
  ]) {
    testWidgets('ForceUpdateGate at ${window.width.toInt()} is capped at the '
        'form width and does not overflow', (WidgetTester tester) async {
      tester.view.physicalSize = window;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: ForceUpdateGate(
            mustUpdate: true,
            title: _title,
            message: _message,
            buttonLabel: _action,
            onUpdate: () {},
            child: const SizedBox.shrink(),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(
        tester.getSize(find.text(_message)).width,
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  }

  testWidgets('NotFoundScreen scrolls at 200 % and drops the query', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pumpAt2x(
      tester,
      NotFoundScreen(
        title: _title,
        message: _message,
        goHomeLabel: 'Go home',
        onGoHome: () {},
        attemptedLocation: '/reset?code=abc123&email=a%40b.example#top',
      ),
    );
    expect(tester.takeException(), isNull, reason: 'no overflow at 2.0');
    expect(find.text('/reset'), findsOneWidget);
    expect(find.textContaining('abc123'), findsNothing);
    _expectHeader(tester, _title);
    handle.dispose();
  });

  testWidgets('AppErrorScreen scrolls at 200 % and its title is a heading', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await _pumpAt2x(
      tester,
      AppErrorScreen(
        title: _title,
        message: _message,
        details: 'StateError: Bad state: boom\n#0 main (file.dart:1:1)',
        onRetry: () {},
        retryLabel: 'Go home',
      ),
    );
    expect(tester.takeException(), isNull, reason: 'no overflow at 2.0');
    _expectHeader(tester, _title);
    handle.dispose();
  });

  test('NotFoundScreen.pathOf keeps a bare path and cuts at ? or #', () {
    expect(NotFoundScreen.pathOf('/home'), '/home');
    expect(NotFoundScreen.pathOf('/sub/1?x=1'), '/sub/1');
    expect(NotFoundScreen.pathOf('/a#b?c'), '/a');
  });

  testWidgets('install() asks for localized copy where the error is BUILT', (
    WidgetTester tester,
  ) async {
    bool home = false;
    final ErrorWidgetBuilder previous = AppErrorScreen.install(
      localized: (BuildContext context) =>
          (title: 'Localised', message: 'Body', goHomeLabel: 'Home'),
      onGoHome: () => home = true,
    );
    final ErrorWidgetBuilder installed = ErrorWidget.builder;
    // Restored before the body ends: flutter_test checks the global first.
    ErrorWidget.builder = previous;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) =>
              installed(FlutterErrorDetails(exception: StateError('boom'))),
        ),
      ),
    );
    expect(find.text('Localised'), findsOneWidget);
    await tester.tap(find.text('Home'));
    expect(home, isTrue);
  });

  testWidgets('install() keeps the English last resort with no copy', (
    WidgetTester tester,
  ) async {
    final ErrorWidgetBuilder previous = AppErrorScreen.install(
      localized: (BuildContext context) => null,
    );
    final ErrorWidgetBuilder installed = ErrorWidget.builder;
    ErrorWidget.builder = previous;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (BuildContext context) =>
              installed(FlutterErrorDetails(exception: StateError('boom'))),
        ),
      ),
    );
    expect(find.text(AppErrorScreen.fallbackTitle), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });
}
