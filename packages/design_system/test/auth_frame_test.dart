// ─────────────────────────────────────────────────────────────────────────────
// auth_frame_test.dart — the shared auth frame and its parts (train ST-D10):
// the split at 1200, the heading as a heading, back only where a route can pop,
// the inline answer as a live region, the checklist's three states, and the
// password field's Show / Hide control. Every case pumps a surface size, which
// is what `assert-responsive-coverage` requires of a package suite.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Color _seed = Color(0xFF6459F5);
const AuthBrand _brand = AuthBrand(mark: 'S', name: 'Subscriptions');
const AuthRevealLabels _labels = AuthRevealLabels(
  show: 'Show',
  hide: 'Hide',
  showName: 'Show password',
  hideName: 'Hide password',
);

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  double width = 390,
  Brightness brightness = Brightness.light,
}) async {
  await tester.binding.setSurfaceSize(Size(width, 900));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: _seed, brightness: brightness),
      home: home,
    ),
  );
  await tester.pump();
}

AuthFrame _frame({Widget? panel, bool showBack = true}) => AuthFrame(
  title: 'Welcome back',
  titleKey: const Key('title'),
  subtitle: 'Sign in to see your subscriptions.',
  brand: _brand,
  panel: panel,
  showBack: showBack,
  children: const <Widget>[Text('the form')],
);

const Widget _panel = AuthBrandPanel(
  brand: _brand,
  headline: 'Never be charged by surprise.',
  body: 'Every renewal, as one account.',
  footnote: 'No bank login',
);

void main() {
  group('AuthFrame · the split', () {
    for (final double w in <double>[390, 700, 1024, 1199]) {
      testWidgets('below 1200 ($w) the form stands alone, panel or not', (
        WidgetTester tester,
      ) async {
        await _pump(tester, _frame(panel: _panel), width: w);
        expect(find.byKey(AuthFrame.panelKey), findsNothing);
        expect(find.text('Never be charged by surprise.'), findsNothing);
        expect(find.text('the form'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }

    for (final double w in <double>[1200, 1440]) {
      testWidgets('at $w a supplied panel takes the leading side', (
        WidgetTester tester,
      ) async {
        await _pump(tester, _frame(panel: _panel), width: w);
        final Rect panel = tester.getRect(find.byKey(AuthFrame.panelKey));
        expect(panel.left, 0);
        expect(
          panel.width,
          (w * AuthFrame.panelFraction).clamp(0, AuthFrame.panelMaxWidth),
        );
        // The form sits wholly to the right of the panel, under its 420 cap.
        final Rect title = tester.getRect(find.byKey(const Key('title')));
        expect(title.left, greaterThanOrEqualTo(panel.right));
        expect(title.width, lessThanOrEqualTo(AppBreakpoints.form));
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('no panel, no split — even at 1440', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _frame(), width: 1440);
      expect(find.byKey(AuthFrame.panelKey), findsNothing);
    });
  });

  group('AuthFrame · the page', () {
    testWidgets('the title is a heading that names the route', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, _frame());
      expect(
        tester.getSemantics(find.byKey(const Key('title'))),
        matchesSemantics(
          label: 'Welcome back',
          isHeader: true,
          namesRoute: true,
        ),
      );
      handle.dispose();
    });

    testWidgets('the brand mark is decoration; the name is read', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, _frame());
      expect(find.bySemanticsLabel('S'), findsNothing);
      expect(find.bySemanticsLabel('Subscriptions'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('no back on a root route', (WidgetTester tester) async {
      await _pump(tester, _frame());
      expect(find.byKey(AuthFrame.backKey), findsNothing);
    });

    for (final bool gate in <bool>[false, true]) {
      testWidgets(
        gate
            ? 'no back on a gate, even pushed'
            : 'back where the route can pop',
        (WidgetTester tester) async {
          await _pump(
            tester,
            Builder(
              builder: (BuildContext context) => TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => _frame(showBack: !gate),
                  ),
                ),
                child: const Text('open'),
              ),
            ),
          );
          await tester.tap(find.text('open'));
          await tester.pumpAndSettle();
          expect(
            find.byKey(AuthFrame.backKey),
            gate ? findsNothing : findsOneWidget,
          );
        },
      );
    }

    for (final Brightness b in Brightness.values) {
      testWidgets('paints from the scheme in ${b.name}', (
        WidgetTester tester,
      ) async {
        await _pump(tester, _frame(), brightness: b);
        final ColorScheme scheme = buildAppTheme(
          seed: _seed,
          brightness: b,
        ).colorScheme;
        expect(
          tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
          scheme.surface,
        );
        expect(
          tester.widget<Text>(find.byKey(const Key('title'))).style!.color,
          scheme.onSurface,
        );
      });
    }
  });

  group('AuthMessage', () {
    testWidgets('is a live region carrying the words under its key', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        const Scaffold(
          body: AuthMessage(
            message: 'Enter your email and password.',
            kind: StatusKind.danger,
            textKey: Key('said'),
          ),
        ),
      );
      expect(
        tester.getSemantics(find.byType(AuthMessage)),
        matchesSemantics(
          label: 'Enter your email and password.',
          isLiveRegion: true,
        ),
      );
      expect(
        tester.widget<Text>(find.byKey(const Key('said'))).data,
        'Enter your email and password.',
      );
      handle.dispose();
    });

    for (final Brightness b in Brightness.values) {
      testWidgets('a danger answer is the danger pair (${b.name})', (
        WidgetTester tester,
      ) async {
        await _pump(
          tester,
          const Scaffold(
            body: AuthMessage(message: 'No.', kind: StatusKind.danger),
          ),
          brightness: b,
        );
        final StatusTones tones = StatusTones.forBrightness(b);
        expect(
          tester.widget<Text>(find.text('No.')).style!.color,
          tones.danger,
        );
        final DecoratedBox box = tester.widget<DecoratedBox>(
          find.descendant(
            of: find.byType(AuthMessage),
            matching: find.byType(DecoratedBox),
          ),
        );
        expect((box.decoration as BoxDecoration).color, tones.dangerTint);
      });
    }
  });

  group('AuthPasswordChecklist', () {
    testWidgets('each state has its own glyph', (WidgetTester tester) async {
      await _pump(
        tester,
        const Scaffold(
          body: AuthPasswordChecklist(
            rules: <AuthRule>[
              AuthRule(label: 'At least 8', state: AuthRuleState.met),
              AuthRule(label: 'Not breached', state: AuthRuleState.failed),
              AuthRule(label: 'Pending', state: AuthRuleState.pending),
            ],
          ),
        ),
      );
      expect(find.byIcon(Icons.check_circle), findsOneWidget);
      expect(find.byIcon(Icons.cancel), findsOneWidget);
      expect(find.byIcon(Icons.radio_button_unchecked), findsOneWidget);
      expect(
        tester.widget<Text>(find.text('Not breached')).style!.color,
        StatusTones.light.danger,
      );
    });
  });

  group('AuthField · reveal', () {
    Widget field({AuthRevealLabels? reveal}) => Scaffold(
      body: AuthField(
        label: 'Password',
        controller: TextEditingController(),
        keyboardType: TextInputType.text,
        obscure: true,
        fieldKey: const Key('inner'),
        reveal: reveal,
      ),
    );

    testWidgets('without labels the field renders exactly as before', (
      WidgetTester tester,
    ) async {
      await _pump(tester, field());
      expect(find.byKey(AuthField.revealKey), findsNothing);
      expect(
        find.ancestor(
          of: find.byType(MergeSemantics),
          matching: find.descendant(
            of: find.byType(AuthField),
            matching: find.byType(Stack),
          ),
        ),
        findsNothing,
      );
    });

    testWidgets('Show reveals, Hide conceals, and each says so', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, field(reveal: _labels));
      TextField inner() =>
          tester.widget<TextField>(find.byKey(const Key('inner')));
      expect(inner().obscureText, isTrue);
      expect(find.bySemanticsLabel('Show password'), findsOneWidget);

      await tester.tap(find.byKey(AuthField.revealKey));
      await tester.pump();
      expect(inner().obscureText, isFalse);
      expect(find.bySemanticsLabel('Hide password'), findsOneWidget);
      expect(find.text('Hide'), findsOneWidget);

      await tester.tap(find.byKey(AuthField.revealKey));
      await tester.pump();
      expect(inner().obscureText, isTrue);
      handle.dispose();
    });

    testWidgets('the control is NOT merged into the field', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(tester, field(reveal: _labels));
      // The field keeps its one merged node, named by its label; the control
      // is a separate button a screen reader can reach on its own.
      expect(find.bySemanticsLabel('Password'), findsOneWidget);
      expect(
        tester.getSemantics(find.byKey(AuthField.revealKey)),
        matchesSemantics(
          label: 'Show password',
          isButton: true,
          hasTapAction: true,
          hasEnabledState: true,
          isEnabled: true,
          isFocusable: true,
          hasFocusAction: true,
        ),
      );
      handle.dispose();
    });

    testWidgets('an unobscured field ignores the labels', (
      WidgetTester tester,
    ) async {
      await _pump(
        tester,
        Scaffold(
          body: AuthField(
            label: 'Email',
            controller: TextEditingController(),
            keyboardType: TextInputType.emailAddress,
            reveal: _labels,
          ),
        ),
      );
      expect(find.byKey(AuthField.revealKey), findsNothing);
    });
  });

  // Every part, together, at each window class and in both schemes: nothing
  // overflows, and the split appears only from 1200.
  group('every part at every window class', () {
    const List<Size> windows = <Size>[
      Size(375, 812),
      Size(768, 1024),
      Size(1280, 900),
      Size(1440, 900),
    ];
    for (final Size window in windows) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${window.width.toInt()} · ${b.name}', (
          WidgetTester tester,
        ) async {
          await tester.binding.setSurfaceSize(window);
          addTearDown(() => tester.binding.setSurfaceSize(null));
          await tester.pumpWidget(
            MaterialApp(
              theme: buildAppTheme(seed: _seed, brightness: b),
              home: AuthFrame(
                title: 'Create your account',
                subtitle: 'Start tracking every subscription.',
                brand: _brand,
                panel: _panel,
                icon: Icons.mark_email_unread_outlined,
                notices: const <Widget>[
                  AuthMessage(message: 'Your account was deleted.'),
                ],
                children: <Widget>[
                  AuthField(
                    label: 'Password',
                    controller: TextEditingController(text: 'hunter22'),
                    keyboardType: TextInputType.text,
                    obscure: true,
                    reveal: _labels,
                  ),
                  const AuthPasswordChecklist(
                    rules: <AuthRule>[
                      AuthRule(label: 'At least 8', state: AuthRuleState.met),
                    ],
                  ),
                  const AuthMessage(message: 'No.', kind: StatusKind.danger),
                  const AuthOrDivider(label: 'or'),
                ],
              ),
            ),
          );
          await tester.pump();
          expect(tester.takeException(), isNull);
          expect(
            find.byKey(AuthFrame.panelKey),
            window.width >= AuthFrame.splitFrom ? findsOneWidget : findsNothing,
          );
        });
      }
    }
  });
}
