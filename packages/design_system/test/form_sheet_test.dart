// ─────────────────────────────────────────────────────────────────────────────
// form_sheet_test.dart — the chassis FORM SHEET components (train ST-D6):
// layout per window class, the platform-owned keyboard (Escape dismisses,
// Ctrl/Cmd+Enter submits), the choice's announced state, the busy state, text
// scaling, and MEASURED contrast for every pair the components introduce.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);
const Color kSeed = Color(0xFF6459F5);

/// WCAG relative-luminance contrast of [a] over [b].
double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

/// A form with every component, counting submits.
class _Form extends StatefulWidget {
  const _Form({this.busy = false, this.onSubmitCount});

  final bool busy;
  final ValueNotifier<int>? onSubmitCount;

  @override
  State<_Form> createState() => _FormState();
}

class _FormState extends State<_Form> {
  int _cycle = 0;

  void _submit() => widget.onSubmitCount?.value++;

  @override
  Widget build(BuildContext context) {
    return AppFormSheet(
      title: 'Add subscription',
      onSubmit: widget.busy ? null : _submit,
      actions: AppFormActions(
        cancelKey: const Key('cancel'),
        submitKey: const Key('submit'),
        cancelLabel: 'Cancel',
        onCancel: () => Navigator.of(context).pop(),
        submitLabel: 'Add subscription',
        busyLabel: 'Adding…',
        busy: widget.busy,
        onSubmit: _submit,
      ),
      children: <Widget>[
        AppFormField(
          label: 'NAME',
          child: TextField(
            key: const Key('name'),
            decoration: AppFieldDecoration.of(context, hint: 'e.g. Hulu'),
          ),
        ),
        AppFormField(
          label: 'CYCLE',
          child: AppSegmentedChoice<int>(
            choices: const <AppChoice<int>>[
              AppChoice<int>(value: 0, label: 'Monthly'),
              AppChoice<int>(value: 1, label: 'Yearly'),
            ],
            selected: _cycle,
            onChanged: (int v) => setState(() => _cycle = v),
          ),
        ),
      ],
    );
  }
}

Future<void> _open(
  WidgetTester tester,
  Size size, {
  Brightness brightness = Brightness.light,
  double textScale = 1,
  Widget form = const _Form(),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSeed, brightness: brightness),
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () =>
                  showAppFormSheet<void>(context, builder: (_) => form),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  group('AppFormSheet — per window class', () {
    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('at ${size.width.toInt()}: capped at 640, action reachable', (
        WidgetTester tester,
      ) async {
        await _open(tester, size);
        expect(tester.takeException(), isNull);
        final Rect sheet = tester.getRect(find.byType(AppFormSheet));
        expect(sheet.width, math.min(size.width, 640));
        expect(
          sheet.height,
          lessThanOrEqualTo(size.height * AppFormSheet.maxHeightFraction),
        );
        await tester.ensureVisible(find.byKey(const Key('submit')));
        await tester.pumpAndSettle();
        final Rect submit = tester.getRect(find.byKey(const Key('submit')));
        expect(submit.bottom, lessThanOrEqualTo(size.height));
        expect(submit.height, AppFormActions.height);
      });
    }

    testWidgets('320 wide at a 2.0 text scale lays out without overflow', (
      WidgetTester tester,
    ) async {
      await _open(tester, const Size(320, 568), textScale: 2);
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.byKey(const Key('submit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('submit')).hitTestable(), findsOneWidget);
    });

    testWidgets('the title is announced as a heading', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _open(tester, kPhone);
      expect(
        tester.getSemantics(find.text('Add subscription').first),
        isSemantics(label: 'Add subscription', isHeader: true),
      );
      handle.dispose();
    });
  });

  group('AppFormSheet — the keyboard (platform-owned behaviour)', () {
    testWidgets('Escape dismisses the sheet (the modal route owns it)', (
      WidgetTester tester,
    ) async {
      await _open(tester, kDesktop);
      expect(find.byType(AppFormSheet), findsOneWidget);
      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pumpAndSettle();
      expect(find.byType(AppFormSheet), findsNothing);
    });

    for (final (String name, LogicalKeyboardKey modifier)
        in <(String, LogicalKeyboardKey)>[
          ('Ctrl', LogicalKeyboardKey.controlLeft),
          ('Cmd', LogicalKeyboardKey.metaLeft),
        ]) {
      testWidgets('$name+Enter from a field submits', (
        WidgetTester tester,
      ) async {
        final ValueNotifier<int> submits = ValueNotifier<int>(0);
        await _open(tester, kDesktop, form: _Form(onSubmitCount: submits));
        await tester.tap(find.byKey(const Key('name')));
        await tester.pump();
        await tester.sendKeyDownEvent(modifier);
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.sendKeyUpEvent(modifier);
        await tester.pump();
        expect(submits.value, 1);
      });
    }

    testWidgets('a busy form does NOT submit on Ctrl+Enter', (
      WidgetTester tester,
    ) async {
      final ValueNotifier<int> submits = ValueNotifier<int>(0);
      await _open(
        tester,
        kDesktop,
        form: _Form(busy: true, onSubmitCount: submits),
      );
      await tester.tap(find.byKey(const Key('name')));
      await tester.pump();
      await tester.sendKeyDownEvent(LogicalKeyboardKey.controlLeft);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.sendKeyUpEvent(LogicalKeyboardKey.controlLeft);
      await tester.pump();
      expect(submits.value, 0);
    });
  });

  group('AppSegmentedChoice', () {
    testWidgets('reports WHICH arm is selected, and the flag follows a tap', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _open(tester, kPhone);
      expect(
        tester.getSemantics(find.text('Monthly')),
        isSemantics(
          label: 'Monthly',
          isButton: true,
          hasSelectedState: true,
          isSelected: true,
          isInMutuallyExclusiveGroup: true,
          hasTapAction: true,
          isFocusable: true,
        ),
      );
      await tester.ensureVisible(find.text('Yearly'));
      await tester.tap(find.text('Yearly'));
      await tester.pumpAndSettle();
      expect(
        tester.getSemantics(find.text('Yearly')),
        isSemantics(label: 'Yearly', isSelected: true),
      );
      expect(
        tester.getSemantics(find.text('Monthly')),
        isSemantics(
          label: 'Monthly',
          hasSelectedState: true,
          isSelected: false,
        ),
      );
      // Never colour-only: the current arm carries the check glyph too.
      expect(
        find.descendant(
          of: find.ancestor(
            of: find.text('Yearly'),
            matching: find.byType(InkWell),
          ),
          matching: find.byIcon(Icons.check),
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('a null onChanged disables every arm', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: kSeed),
          home: Scaffold(
            body: AppSegmentedChoice<int>(
              choices: const <AppChoice<int>>[
                AppChoice<int>(value: 0, label: 'Monthly'),
                AppChoice<int>(value: 1, label: 'Yearly'),
              ],
              selected: 0,
              onChanged: null,
            ),
          ),
        ),
      );
      final Iterable<InkWell> wells = tester.widgetList<InkWell>(
        find.byType(InkWell),
      );
      expect(wells, hasLength(2));
      expect(wells.every((InkWell w) => w.onTap == null), isTrue);
    });
  });

  group('AppFormActions — the loading state', () {
    testWidgets(
      'busy: the primary is disabled and says so; Cancel stays live',
      (WidgetTester tester) async {
        await _open(tester, kPhone, form: const _Form(busy: true));
        final FilledButton submit = tester.widget<FilledButton>(
          find.byKey(const Key('submit')),
        );
        expect(submit.onPressed, isNull);
        expect(
          find.descendant(
            of: find.byKey(const Key('submit')),
            matching: find.text('Adding…'),
          ),
          findsOneWidget,
        );
        final OutlinedButton cancel = tester.widget<OutlinedButton>(
          find.byKey(const Key('cancel')),
        );
        expect(cancel.onPressed, isNotNull);
        await tester.ensureVisible(find.byKey(const Key('cancel')));
        await tester.tap(find.byKey(const Key('cancel')));
        await tester.pumpAndSettle();
        expect(find.byType(AppFormSheet), findsNothing);
      },
    );
  });

  group('MEASURED contrast, both schemes', () {
    for (final Brightness b in Brightness.values) {
      final ThemeData theme = buildAppTheme(seed: kSeed, brightness: b);
      final ColorScheme scheme = theme.colorScheme;
      final Color sheet = AppFormSheet.fillOf(theme);
      final Color field = AppCard.fillOf(theme);
      final StatusTones tones = StatusTones.forBrightness(b);

      test('[${b.name}] a field edge is a 3:1 non-text boundary', () {
        // WCAG 1.4.11: the edge is what says "this is a control".
        expect(contrast(scheme.outline, sheet), greaterThanOrEqualTo(3));
        expect(contrast(scheme.outline, field), greaterThanOrEqualTo(3));
      });

      testWidgets('[${b.name}] the field skin paints the pairs measured here', (
        WidgetTester tester,
      ) async {
        late InputDecoration d;
        late InputDecoration e;
        await tester.pumpWidget(
          MaterialApp(
            theme: theme,
            home: Builder(
              builder: (BuildContext context) {
                d = AppFieldDecoration.of(context, hint: 'x');
                e = AppFieldDecoration.of(context, errorText: 'y');
                return const SizedBox.shrink();
              },
            ),
          ),
        );
        // Without these, the pairs below would be measured and never painted.
        expect(d.enabledBorder!.borderSide.color, scheme.outline);
        expect(d.fillColor, field);
        expect(d.hintStyle!.color, scheme.onSurfaceVariant);
        expect(e.errorStyle!.color, tones.danger);
        expect(e.errorBorder!.borderSide.color, tones.danger);
        expect(
          d.focusedBorder!.borderSide.width,
          greaterThan(d.enabledBorder!.borderSide.width),
          reason: 'focus is shown by weight as well as by hue',
        );
      });

      test('[${b.name}] field value, hint and label text are AA', () {
        expect(contrast(scheme.onSurface, field), greaterThanOrEqualTo(4.5));
        expect(
          contrast(scheme.onSurfaceVariant, field),
          greaterThanOrEqualTo(4.5),
        );
        expect(
          contrast(scheme.onSurfaceVariant, sheet),
          greaterThanOrEqualTo(4.5),
        );
        expect(contrast(scheme.onSurface, sheet), greaterThanOrEqualTo(4.5));
      });

      test('[${b.name}] an error reads AA on the sheet it is drawn over', () {
        expect(contrast(tones.danger, sheet), greaterThanOrEqualTo(4.5));
      });

      test('[${b.name}] the selected choice is AA on its own fill', () {
        expect(
          contrast(scheme.onSecondaryContainer, scheme.secondaryContainer),
          greaterThanOrEqualTo(4.5),
        );
      });
    }
  });
}
