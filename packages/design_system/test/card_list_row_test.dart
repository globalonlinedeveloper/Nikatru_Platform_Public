// AppCard and AppListRow — train ST-D0. Behaviour, semantics, the three
// required windows, and every word on a card measured against the card.

import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

Future<void> pumpAt(
  WidgetTester tester,
  Size size,
  Widget w, {
  Brightness brightness = Brightness.light,
  VisualDensity? density,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final ThemeData theme = buildAppTheme(
    seed: const Color(0xFF6459F5),
    brightness: brightness,
  );
  await tester.pumpWidget(
    MaterialApp(
      theme: density == null ? theme : theme.copyWith(visualDensity: density),
      // A ListView, as the screens host these: it hands every child the
      // pane's full width, which is what "spans the pane" is measured on.
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[w],
        ),
      ),
    ),
  );
}

void main() {
  group('AppCard', () {
    for (final Brightness b in Brightness.values) {
      testWidgets('${b.name}: opaque fill, hairline edge, card radius', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          kPhone,
          const AppCard(child: Text('x')),
          brightness: b,
        );
        final Material m = tester.widget<Material>(
          find.descendant(
            of: find.byType(AppCard),
            matching: find.byType(Material),
          ),
        );
        final ThemeData theme = Theme.of(tester.element(find.text('x')));
        expect(m.color, AppCard.fillOf(theme));
        expect(m.color!.a, 1.0);
        final RoundedRectangleBorder shape = m.shape! as RoundedRectangleBorder;
        expect(shape.side.color, theme.colorScheme.outlineVariant);
        expect(shape.borderRadius, BorderRadius.circular(AppRadius.card));
      });
    }

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('spans the pane at ${size.width.toInt()}', (
        WidgetTester tester,
      ) async {
        await pumpAt(tester, size, const AppCard(child: Text('Total')));
        expect(tester.takeException(), isNull);
        expect(
          tester.getSize(find.byType(AppCard)).width,
          size.width - 2 * AppSpacing.lg,
        );
      });
    }

    testWidgets('a tappable card is ONE button node', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        AppCard(onTap: () {}, child: const Text('Open')),
      );
      expect(
        tester.getSemantics(find.text('Open')),
        matchesSemantics(
          label: 'Open',
          isButton: true,
          hasTapAction: true,
          hasFocusAction: true,
          isFocusable: true,
        ),
      );
      handle.dispose();
    });
  });

  group('AppListRow', () {
    test('64 at standard density, 56 at compact', () {
      expect(AppListRow.minHeightFor(VisualDensity.standard), 64);
      expect(AppListRow.minHeightFor(VisualDensity.compact), 56);
    });

    for (final VisualDensity d in <VisualDensity>[
      VisualDensity.standard,
      VisualDensity.compact,
    ]) {
      testWidgets('renders at its min height, $d', (WidgetTester tester) async {
        await pumpAt(
          tester,
          kPhone,
          const AppListRow(title: 'Netflix'),
          density: d,
        );
        expect(
          tester.getSize(find.byType(AppListRow)).height,
          AppListRow.minHeightFor(d),
        );
      });
    }

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets(
        'keeps title and figure on one row at ${size.width.toInt()}',
        (WidgetTester tester) async {
          const String title =
              'A subscription with a long name that must ellipsize';
          await pumpAt(
            tester,
            size,
            AppListRow(
              title: title,
              subtitle: 'Renews in 2 days',
              status: StatusKind.warn,
              figure: '1,500',
              caption: 'per month',
              onTap: () {},
            ),
          );
          expect(tester.takeException(), isNull);
          final double titleY = tester.getCenter(find.text(title)).dy;
          expect(tester.getCenter(find.text('1,500')).dy, closeTo(titleY, 1));
          expect(
            tester.getTopRight(find.text('1,500')).dx,
            lessThanOrEqualTo(size.width - AppSpacing.lg),
          );
        },
      );
    }

    testWidgets('one node per row, announced as a button', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        AppListRow(
          title: 'Netflix',
          subtitle: 'Renews in 2 days',
          status: StatusKind.warn,
          figure: '₹649',
          caption: 'per month',
          onTap: () {},
        ),
      );
      final SemanticsNode node = tester.getSemantics(find.byType(AppListRow));
      expect(node.label, contains('Netflix'));
      expect(node.label, contains('Renews in 2 days'));
      expect(node.label, contains('₹649'));
      expect(node.label, contains('per month'));
      expect(node.flagsCollection.isButton, isTrue);
      handle.dispose();
    });

    for (final Brightness b in Brightness.values) {
      testWidgets('${b.name}: a status paints its words in the scheme tone', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          kPhone,
          const AppListRow(
            title: 'Gym',
            subtitle: 'Unused for 60 days',
            status: StatusKind.danger,
          ),
          brightness: b,
        );
        final Text t = tester.widget<Text>(find.text('Unused for 60 days'));
        expect(t.style!.color, StatusTones.forBrightness(b).danger);
      });
    }

    test('a status without words is refused', () {
      expect(
        () => AppListRow(title: 'x', status: StatusKind.warn),
        throwsAssertionError,
      );
    });

    testWidgets('the figure is tabular', (WidgetTester tester) async {
      await pumpAt(tester, kPhone, const AppListRow(title: 'x', figure: '12'));
      final Text t = tester.widget<Text>(find.text('12'));
      expect(
        t.style!.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
    });
  });

  group('every word on a card clears AA against the card', () {
    for (final Brightness b in Brightness.values) {
      for (final Color seed in const <Color>[
        Color(0xFF6459F5),
        Color(0xFFE53935),
        Color(0xFF2E7D32),
        Color(0xFFFFB300),
        Color(0xFF101010),
        Color(0xFFF5F5F5),
      ]) {
        test('${b.name}, seed $seed', () {
          final ThemeData theme = buildAppTheme(seed: seed, brightness: b);
          final ColorScheme cs = theme.colorScheme;
          final Color card = AppCard.fillOf(theme);
          final StatusTones tones = StatusTones.forBrightness(b);
          final Map<String, Color> inks = <String, Color>{
            'title and figure (onSurface)': cs.onSurface,
            'subtitle and caption (onSurfaceVariant)': cs.onSurfaceVariant,
            'positive status': tones.positive,
            'warn status': tones.warn,
            'danger status': tones.danger,
          };
          for (final MapEntry<String, Color> ink in inks.entries) {
            final double r = contrast(ink.value, card);
            expect(
              r,
              greaterThanOrEqualTo(4.5),
              reason: '${ink.key}: ${r.toStringAsFixed(2)}',
            );
          }
        });
      }
    }
  });

  // ── train ST-D1 ───────────────────────────────────────────────────────────
  group('AppListRow · selection and the figure cap (train ST-D1)', () {
    for (final Brightness b in Brightness.values) {
      testWidgets(
        '${b.name}: selected is a START-edge primary bar AND a state',
        (WidgetTester tester) async {
          final SemanticsHandle handle = tester.ensureSemantics();
          await pumpAt(
            tester,
            kPhone,
            AppCard(
              padding: EdgeInsets.zero,
              child: Column(
                children: <Widget>[
                  AppListRow(title: 'On', onTap: () {}, selected: true),
                  AppListRow(title: 'Off', onTap: () {}, selected: false),
                  AppListRow(title: 'None', onTap: () {}),
                ],
              ),
            ),
            brightness: b,
          );
          final ThemeData theme = Theme.of(tester.element(find.text('On')));
          final Iterable<BoxDecoration> bars = tester
              .widgetList<DecoratedBox>(
                find.descendant(
                  of: find.byType(AppListRow),
                  matching: find.byType(DecoratedBox),
                ),
              )
              .map((DecoratedBox d) => d.decoration)
              .whereType<BoxDecoration>()
              .where((BoxDecoration d) => d.border is BorderDirectional);
          expect(bars, hasLength(1), reason: 'only the selected row has a bar');
          final BorderDirectional edge =
              bars.single.border! as BorderDirectional;
          expect(edge.start.color, theme.colorScheme.primary);
          expect(edge.start.width, AppListRow.selectedBarWidth);
          // The bar is a non-text indicator: SC 1.4.11's 3:1 against the card.
          expect(
            contrast(edge.start.color, AppCard.fillOf(theme)),
            greaterThanOrEqualTo(3),
          );

          final SemanticsNode on = tester.getSemantics(find.text('On'));
          final SemanticsNode off = tester.getSemantics(find.text('Off'));
          final SemanticsNode none = tester.getSemantics(find.text('None'));
          expect(on.flagsCollection.isSelected, Tristate.isTrue);
          expect(off.flagsCollection.isSelected, Tristate.isFalse);
          expect(
            none.flagsCollection.isSelected,
            Tristate.none,
            reason: 'a list with no selection must not announce "not selected"',
          );
          handle.dispose();
        },
      );
    }

    testWidgets('at 100 % the figure is untouched by the cap', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const AppListRow(
          title: 'Netflix',
          figure: r'$15.49',
          caption: 'per month',
        ),
      );
      expect(
        find.ancestor(
          of: find.text(r'$15.49'),
          matching: find.byType(FittedBox),
        ),
        findsOneWidget,
      );
      final double drawn = tester.getSize(find.text(r'$15.49')).width;
      final double natural = tester
          .renderObject<RenderParagraph>(find.text(r'$15.49'))
          .getMaxIntrinsicWidth(double.infinity);
      expect(drawn, natural, reason: 'no scaling below the cap');
    });

    testWidgets(
      '200 % text on a 360 px phone: the figure scales, no overflow',
      (WidgetTester tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await pumpAt(
          tester,
          const Size(360, 800),
          AppCard(
            padding: EdgeInsets.zero,
            child: AppListRow(
              leading: const CircleAvatar(child: Text('N')),
              title: 'A subscription with a long name',
              subtitle: 'Renews tomorrow',
              status: StatusKind.warn,
              figure: r'$1,234.56',
              caption: 'per month',
              onTap: () {},
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        final Rect row = tester.getRect(find.byType(AppListRow));
        final Rect figure = tester.getRect(find.text(r'$1,234.56'));
        expect(figure.right, lessThanOrEqualTo(row.right));
        expect(
          tester.getSize(find.byType(FittedBox).last).width,
          lessThanOrEqualTo(row.width * AppListRow.figureShare),
        );
      },
    );
  });
}
