// The detail components — train ST-D5: AppIconAction, AppMonogram,
// AppFigureTile, AppDetailHeader, AppButtonStyles.destructive, and the
// AppListRow line limits. Behaviour, semantics, the three required windows,
// and every ink measured against the ground it is painted on, across the six
// stress seeds `status_contrast_test.dart` uses.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);

const Map<String, Color> seeds = <String, Color>{
  'subscriptiontracker indigo': Color(0xFF6459F5),
  'red': Color(0xFFE53935),
  'green': Color(0xFF2E7D32),
  'amber': Color(0xFFFFB300),
  'near-black': Color(0xFF101010),
  'near-white': Color(0xFFF5F5F5),
};

const double aa = 4.5;

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
  Color seed = const Color(0xFF6459F5),
  bool inList = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: seed, brightness: brightness),
      home: Scaffold(
        body: inList
            ? ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: <Widget>[w],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[w],
              ),
      ),
    ),
  );
}

void main() {
  // ═══════════════════════════════════════════════════════════════════════════
  group('AppIconAction', () {
    testWidgets('one BUTTON node named by its label, activated by Enter', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      int taps = 0;
      await pumpAt(
        tester,
        kPhone,
        AppIconAction(
          icon: Icons.close,
          label: 'Close',
          onPressed: () => taps++,
        ),
      );
      expect(
        tester.getSemantics(find.byType(AppIconAction)),
        matchesSemantics(
          label: 'Close',
          isButton: true,
          hasTapAction: true,
          hasFocusAction: true,
          isFocusable: true,
        ),
      );
      // The hand-rolled close it replaces had a role and NO focus node. Tab
      // to it and press Enter: a keyboard must be able to leave the screen.
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(taps, 1);
      handle.dispose();
    });

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('is 48 x 48 at ${size.width.toInt()}', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          size,
          Align(
            alignment: Alignment.centerLeft,
            child: AppIconAction(
              icon: Icons.close,
              label: 'Close',
              onPressed: () {},
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        expect(
          tester.getSize(find.byType(AppIconAction)),
          const Size.square(AppIconAction.size),
        );
        expect(AppIconAction.size, 48);
      });
    }

    for (final MapEntry<String, Color> seed in seeds.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${seed.key} · ${b.name}: the glyph clears 4.5:1 on its '
            'well, and the well is opaque', (WidgetTester tester) async {
          await pumpAt(
            tester,
            kPhone,
            AppIconAction(icon: Icons.close, label: 'Close', onPressed: () {}),
            brightness: b,
            seed: seed.value,
          );
          final ColorScheme scheme = Theme.of(
            tester.element(find.byType(AppIconAction)),
          ).colorScheme;
          final BoxDecoration well =
              tester
                      .widget<Container>(
                        find.descendant(
                          of: find.byType(AppIconAction),
                          matching: find.byType(Container),
                        ),
                      )
                      .decoration!
                  as BoxDecoration;
          expect(well.color, scheme.surfaceContainerHighest);
          expect(well.color!.a, 1.0);
          final Color ink = tester
              .widget<Icon>(find.byIcon(Icons.close))
              .color!;
          expect(ink, scheme.onSurface);
          expect(contrast(ink, well.color!), greaterThanOrEqualTo(aa));
        });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('AppMonogram', () {
    testWidgets('is decorative: it adds NO semantics node', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(tester, kPhone, const AppMonogram(text: 'NF'));
      expect(find.bySemanticsLabel('NF'), findsNothing);
      handle.dispose();
    });

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('keeps its named sizes at ${size.width.toInt()}', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          size,
          const Row(
            children: <Widget>[
              AppMonogram(text: 'NF'),
              AppMonogram(text: 'NF', size: AppMonogram.large),
            ],
          ),
        );
        expect(tester.takeException(), isNull);
        final List<Size> sizes = tester
            .widgetList<AppMonogram>(find.byType(AppMonogram))
            .map((AppMonogram m) => tester.getSize(find.byWidget(m)))
            .toList();
        expect(sizes, <Size>[
          const Size.square(AppListRow.leadingSize),
          const Size.square(AppSpacing.xxxl),
        ]);
      });
    }

    for (final MapEntry<String, Color> seed in seeds.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${seed.key} · ${b.name}: letters clear 4.5:1 on the '
            'container pair; a status mark takes the measured tone on tint', (
          WidgetTester tester,
        ) async {
          await pumpAt(
            tester,
            kPhone,
            const Row(
              children: <Widget>[
                AppMonogram(text: 'NF'),
                AppMonogram.icon(Icons.schedule, status: StatusKind.warn),
              ],
            ),
            brightness: b,
            seed: seed.value,
          );
          final ColorScheme scheme = Theme.of(
            tester.element(find.text('NF')),
          ).colorScheme;
          final Color ink = tester.widget<Text>(find.text('NF')).style!.color!;
          expect(ink, scheme.onPrimaryContainer);
          expect(
            contrast(ink, scheme.primaryContainer),
            greaterThanOrEqualTo(aa),
          );
          final StatusTones tones = StatusTones.forBrightness(b);
          expect(
            tester.widget<Icon>(find.byIcon(Icons.schedule)).color,
            tones.warn,
          );
          final Iterable<Color?> fills = tester
              .widgetList<Container>(
                find.descendant(
                  of: find.byType(AppMonogram),
                  matching: find.byType(Container),
                ),
              )
              .map((Container c) => (c.decoration! as BoxDecoration).color);
          expect(fills, <Color?>[scheme.primaryContainer, tones.warnTint]);
        });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('AppFigureTile', () {
    testWidgets('ONE node: label, figure and caption merged', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(
        tester,
        kPhone,
        const AppFigureTile(
          label: 'Next charge',
          figure: 'Jul 22',
          caption: 'Renews tomorrow',
          status: StatusKind.warn,
        ),
      );
      expect(
        tester.getSemantics(find.text('Jul 22')),
        matchesSemantics(label: 'Next charge\nJul 22\nRenews tomorrow'),
      );
      handle.dispose();
    });

    testWidgets('nothing under the 12 px floor, and the figure is tabular', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const AppFigureTile(label: 'Price', figure: '15.49', caption: 'month'),
      );
      for (final String s in <String>['Price', '15.49', 'month']) {
        expect(
          tester.widget<Text>(find.text(s)).style!.fontSize,
          greaterThanOrEqualTo(AppTypeRamp.minimumSize),
          reason: '"$s" is under the floor',
        );
      }
      expect(
        tester.widget<Text>(find.text('15.49')).style!.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
    });

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('two tiles side by side lay out at ${size.width.toInt()}', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          size,
          const Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: AppFigureTile(
                  label: 'Price',
                  figure: '15.49',
                  caption: 'per month',
                ),
              ),
              SizedBox(width: AppSpacing.md),
              Expanded(
                child: AppFigureTile(
                  label: 'Next charge',
                  figure: 'Jul 22',
                  caption: 'Renews tomorrow',
                  status: StatusKind.warn,
                ),
              ),
            ],
          ),
        );
        expect(tester.takeException(), isNull);
      });
    }

    for (final Brightness b in Brightness.values) {
      testWidgets('${b.name}: a status caption takes the SCHEME tone, a plain '
          'one the variant ink, and both clear 4.5:1 on the card', (
        WidgetTester tester,
      ) async {
        await pumpAt(
          tester,
          kPhone,
          const Column(
            children: <Widget>[
              AppFigureTile(label: 'A', figure: '1', caption: 'plain'),
              AppFigureTile(
                label: 'B',
                figure: '2',
                caption: 'warned',
                status: StatusKind.warn,
              ),
            ],
          ),
          brightness: b,
        );
        final ThemeData theme = Theme.of(tester.element(find.text('plain')));
        final Color ground = AppCard.fillOf(theme);
        final Color plain = tester
            .widget<Text>(find.text('plain'))
            .style!
            .color!;
        final Color warned = tester
            .widget<Text>(find.text('warned'))
            .style!
            .color!;
        expect(plain, theme.colorScheme.onSurfaceVariant);
        expect(warned, StatusTones.forBrightness(b).warn);
        expect(contrast(plain, ground), greaterThanOrEqualTo(aa));
        expect(contrast(warned, ground), greaterThanOrEqualTo(aa));
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('AppDetailHeader', () {
    Widget header({VoidCallback? onBack, VoidCallback? onMore}) =>
        AppDetailHeader(
          key: const Key('band'),
          paneKey: const Key('pane'),
          title: 'Netflix',
          subtitle: 'Entertainment · Premium',
          leading: const AppMonogram(text: 'NF', size: AppMonogram.large),
          backLabel: 'Back',
          onBack: onBack ?? () {},
          actions: <AppHeaderAction>[
            AppHeaderAction(
              icon: Icons.more_horiz,
              label: 'More options',
              onPressed: onMore ?? () {},
            ),
          ],
        );

    for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
      testWidgets('the band is full-bleed and its content capped at reading, '
          'at ${size.width.toInt()}', (WidgetTester tester) async {
        await pumpAt(tester, size, header(), inList: false);
        expect(tester.takeException(), isNull);
        expect(tester.getSize(find.byKey(const Key('band'))).width, size.width);
        final double content = tester
            .getSize(
              find
                  .descendant(
                    of: find.byKey(const Key('pane')),
                    matching: find.byType(Column),
                  )
                  .first,
            )
            .width;
        final double cap = size.width < AppBreakpoints.reading
            ? size.width
            : AppBreakpoints.reading;
        expect(
          content,
          cap - 2 * AppSpacing.gutterCompact,
          reason:
              'the gutter comes out of the CAP, so the title starts at the x '
              "a reading-capped body's first card starts at",
        );
      });
    }

    testWidgets('the way back is the FIRST Tab stop, then the actions', (
      WidgetTester tester,
    ) async {
      final List<String> pressed = <String>[];
      await pumpAt(
        tester,
        kPhone,
        header(
          onBack: () => pressed.add('back'),
          onMore: () => pressed.add('more'),
        ),
        inList: false,
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(pressed, <String>['back', 'more']);
    });

    testWidgets('the title is a HEADING and the mark is not announced', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpAt(tester, kPhone, header(), inList: false);
      expect(
        tester.getSemantics(find.text('Netflix')),
        matchesSemantics(label: 'Netflix', isHeader: true),
      );
      expect(find.bySemanticsLabel('NF'), findsNothing);
      expect(find.bySemanticsLabel('Back'), findsOneWidget);
      expect(find.bySemanticsLabel('More options'), findsOneWidget);
      handle.dispose();
    });

    for (final MapEntry<String, Color> seed in seeds.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${seed.key} · ${b.name}: title and subtitle clear 4.5:1 '
            'on the band', (WidgetTester tester) async {
          await pumpAt(
            tester,
            kPhone,
            header(),
            brightness: b,
            seed: seed.value,
            inList: false,
          );
          final ColorScheme scheme = Theme.of(
            tester.element(find.text('Netflix')),
          ).colorScheme;
          final Color band = tester
              .widget<ColoredBox>(
                find
                    .descendant(
                      of: find.byKey(const Key('band')),
                      matching: find.byType(ColoredBox),
                    )
                    .first,
              )
              .color;
          expect(band, scheme.surfaceContainer);
          for (final String s in <String>[
            'Netflix',
            'Entertainment · Premium',
          ]) {
            final Color ink = tester.widget<Text>(find.text(s)).style!.color!;
            expect(
              contrast(ink, band),
              greaterThanOrEqualTo(aa),
              reason: '"$s" on the header band',
            );
          }
        });
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('AppButtonStyles.destructive', () {
    for (final Brightness b in Brightness.values) {
      testWidgets('${b.name}: the danger tone on the OPAQUE danger tint, '
          'measured, at a 48 px height', (WidgetTester tester) async {
        await pumpAt(
          tester,
          kPhone,
          Builder(
            builder: (BuildContext context) => FilledButton(
              style: AppButtonStyles.destructive(context),
              onPressed: () {},
              child: const Text('Cancel plan'),
            ),
          ),
          brightness: b,
        );
        final StatusTones tones = StatusTones.forBrightness(b);
        final ButtonStyle style = tester
            .widget<FilledButton>(find.byType(FilledButton))
            .style!;
        final Color fill = style.backgroundColor!.resolve(<WidgetState>{})!;
        final Color ink = style.foregroundColor!.resolve(<WidgetState>{})!;
        expect(fill, tones.dangerTint);
        expect(ink, tones.danger);
        expect(fill.a, 1.0);
        expect(contrast(ink, fill), greaterThanOrEqualTo(aa));
        expect(
          tester.getSize(find.byType(FilledButton)).height,
          greaterThanOrEqualTo(48),
        );
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('AppListRow line limits', () {
    const String sentence =
        'Netflix renews in 3 days and will charge the card on file';

    testWidgets('the default is still ONE line per slot', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        const AppListRow(title: sentence, subtitle: sentence),
      );
      for (final Text t in tester.widgetList<Text>(find.text(sentence))) {
        expect(t.maxLines, 1);
      }
    });

    testWidgets('a sentence row passes more lines and grows instead of '
        'cutting', (WidgetTester tester) async {
      await pumpAt(
        tester,
        kPhone,
        const AppListRow(
          title: sentence,
          subtitle: sentence,
          titleMaxLines: 2,
          subtitleMaxLines: 3,
        ),
      );
      expect(tester.takeException(), isNull);
      final List<Text> texts = tester
          .widgetList<Text>(find.text(sentence))
          .toList();
      expect(texts.map((Text t) => t.maxLines), <int?>[2, 3]);
      expect(
        tester.getSize(find.byType(AppListRow)).height,
        greaterThan(AppListRow.minHeightFor(VisualDensity.standard)),
        reason: 'the row must GROW to hold the wrapped lines',
      );
    });
  });
}
