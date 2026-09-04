import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// [BrandWordmark] / [BrandFooter] — the two brand widgets lifted out of
/// `apps/subly` by backlog P-3, measured HERE rather than in the app.
///
/// The app keeps its own `brand_footer_parity_test.dart`, and the two are
/// different assertions on purpose. That one says "nothing moved on screen in
/// Subly". These say the widget still HAS the properties the move was made to
/// spread — the accessible name, the dark-ground contrast branch, the keyboard
/// reachability — so they stay true for the next app to render it, which is the
/// only reason the move was worth making.
///
/// 🔴 THE KEYBOARD CASES PRESS REAL KEYS through a real `WidgetsApp` shortcut
/// map, following `focusable_tap_test.dart`. Nothing here reads a `FocusNode`
/// list: a node that exists and no key press can reach is exactly the defect
/// these links carried for months.
void main() {
  const String kLine = 'Widgetly by Nikatru';
  const String kCompany = 'Nikatru';

  Future<void> pump(
    WidgetTester tester,
    Widget child, {
    Brightness brightness = Brightness.light,
  }) async {
    await tester.binding.setSurfaceSize(const Size(600, 400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      DefaultAssetBundle(
        // 🔴 THE PACKAGE SHIPS NO ARTWORK, AND THAT IS THE POINT.
        // [BrandWordmark] loads `assets/brand/…` with NO `package:` argument,
        // so the key resolves against the HOST APP's bundle — which is what
        // lets a stamped app drop its own lockup under the same key with no
        // code change. A `packages/design_system` test therefore has no such
        // asset and `Image.asset` would throw before any assertion ran. This
        // stands in as the host: one 1x1 PNG for every key, so the real
        // `Image.asset` path is exercised rather than stubbed out.
        bundle: _HostBundle(),
        child: MaterialApp(
          theme: buildAppTheme(
            seed: const Color(0xFF6459F5),
            brightness: brightness,
          ),
          home: Scaffold(body: Center(child: child)),
        ),
      ),
    );
    tester.binding.focusManager.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
  }

  BrandFooterLink link(String label, List<String> log) =>
      BrandFooterLink(label: label, onTap: () => log.add(label));

  // ───────────────────────────────────────────────────────────────────────────
  group('BrandWordmark', () {
    testWidgets('the accessible name is the caller\'s, not a package literal', (
      WidgetTester tester,
    ) async {
      await pump(tester, const BrandWordmark(semanticLabel: kCompany));
      expect(
        tester.widget<Image>(find.byType(Image)).semanticLabel,
        kCompany,
        reason:
            'an image with no accessible name is announced as nothing at all. '
            'The name is REQUIRED and undefaulted because '
            'assert-no-hardcoded-strings.mjs does not scan packages/, so a '
            'default here would be a shipped literal outside the guard.',
      );
    });

    testWidgets('onDark selects the reversed artwork, not a colour filter', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        const BrandWordmark(semanticLabel: kCompany, onDark: true),
      );
      expect(
        (tester.widget<Image>(find.byType(Image)).image as AssetImage)
            .assetName,
        'assets/brand/nikatru-logo-dark-bg.png',
      );
    });

    testWidgets('a stamped app can point both assets at its own artwork', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        const BrandWordmark(
          semanticLabel: kCompany,
          lightAsset: 'assets/brand/other.png',
          height: 40,
        ),
      );
      final Image img = tester.widget<Image>(find.byType(Image));
      expect((img.image as AssetImage).assetName, 'assets/brand/other.png');
      expect(img.height, 40);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('BrandFooter separators sit BETWEEN links', () {
    // The app this came from hard-coded three links and two dots. A stamped app
    // with two legal pages would have shipped a dangling middot; one with none
    // would have shipped a bare row of separators.
    for (final (int n, int dots) in <(int, int)>[
      (0, 0),
      (1, 0),
      (2, 1),
      (3, 2)
    ]) {
      testWidgets('$n link(s) -> $dots separator(s)', (
        WidgetTester tester,
      ) async {
        final List<String> log = <String>[];
        await pump(
          tester,
          BrandFooter(
            wordmarkSemanticLabel: kCompany,
            poweredByLine: kLine,
            links: <BrandFooterLink>[
              for (int i = 0; i < n; i++) link('L$i', log),
            ],
          ),
        );
        expect(find.text('·'), findsNWidgets(dots));
        expect(find.byType(FocusableTap), findsNWidgets(n));
      });
    }

    testWidgets('no links means no Wrap and no separator gap at all', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        const BrandFooter(
          wordmarkSemanticLabel: kCompany,
          poweredByLine: kLine,
        ),
      );
      expect(
        find.byType(Wrap),
        findsNothing,
        reason:
            'an empty list means the row is absent, not present and empty — '
            'which is what replaced the old showLinks boolean.',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the quiet ink resolves, and onDark is not "dark mode"', () {
    Color inkOf(WidgetTester tester, String label) =>
        tester.widget<Text>(find.text(label)).style!.color!;

    testWidgets('[light] the literal muted token, unchanged', (
      WidgetTester tester,
    ) async {
      final List<String> log = <String>[];
      await pump(
        tester,
        BrandFooter(
          wordmarkSemanticLabel: kCompany,
          poweredByLine: kLine,
          links: <BrandFooterLink>[link('Privacy', log)],
        ),
      );
      expect(inkOf(tester, kLine), AppColors.muted);
      expect(inkOf(tester, 'Privacy'), AppColors.muted);
    });

    testWidgets('[dark scaffold, onDark false] resolves — the 3.74:1 fix', (
      WidgetTester tester,
    ) async {
      final List<String> log = <String>[];
      await pump(
        tester,
        BrandFooter(
          wordmarkSemanticLabel: kCompany,
          poweredByLine: kLine,
          links: <BrandFooterLink>[link('Privacy', log)],
        ),
        brightness: Brightness.dark,
      );
      final ColorScheme scheme = buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: Brightness.dark,
      ).colorScheme;

      expect(
        inkOf(tester, 'Privacy'),
        scheme.onSurfaceVariant,
        reason:
            'THE MEASURED DEFECT. onDark:false used to paint the LIGHT literal '
            'AppColors.muted (#6F6F7B) on the dark scaffold too — 3.74:1, under '
            "SC 1.4.3's 4.5:1 for 12px w700 link text. onDark means \"on a dark "
            'HERO", not "the app is in dark mode", so the false arm has to '
            'resolve through the ambient brightness.',
      );
      expect(
        inkOf(tester, 'Privacy'),
        isNot(AppColors.muted),
        reason: 'THE FALSIFIER: the light literal must not survive into dark.',
      );
      expect(inkOf(tester, kLine), scheme.onSurfaceVariant);
    });

    testWidgets('[onDark true] keeps its own 60% white, in either brightness', (
      WidgetTester tester,
    ) async {
      const Color hero = Color.fromRGBO(255, 255, 255, 0.6);
      for (final Brightness b in Brightness.values) {
        final List<String> log = <String>[];
        await pump(
          tester,
          BrandFooter(
            wordmarkSemanticLabel: kCompany,
            poweredByLine: kLine,
            links: <BrandFooterLink>[link('Privacy', log)],
            onDark: true,
          ),
          brightness: b,
        );
        expect(
          inkOf(tester, 'Privacy'),
          hero,
          reason:
              'onDark is the caller saying "I am on a dark gradient". It owns '
              'its own ink in BOTH brightnesses; folding it into the '
              'brightness branch is the conflation that caused the defect.',
        );
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the legal links are reachable and operable by keyboard (SC 2.1.1)',
      () {
    Future<void> tab(WidgetTester tester) async {
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
    }

    testWidgets('Tab lands on every link in order, and Enter activates', (
      WidgetTester tester,
    ) async {
      final List<String> log = <String>[];
      await pump(
        tester,
        BrandFooter(
          wordmarkSemanticLabel: kCompany,
          poweredByLine: kLine,
          links: <BrandFooterLink>[
            link('Privacy', log),
            link('Terms', log),
            link('Refund', log),
          ],
        ),
      );

      for (final String expected in <String>['Privacy', 'Terms', 'Refund']) {
        await tab(tester);
        final BuildContext? c =
            tester.binding.focusManager.primaryFocus?.context;
        expect(
          c,
          isNotNull,
          reason: 'Tab found nothing to land on — the pre-move defect exactly.',
        );
        expect(
          find
              .descendant(
                  of: find.byWidget(c!.widget), matching: find.text(expected))
              .evaluate()
              .isNotEmpty,
          isTrue,
          reason: 'focus should be on the $expected link',
        );
        await tester.sendKeyEvent(LogicalKeyboardKey.enter);
        await tester.pump();
      }

      expect(
        log,
        <String>['Privacy', 'Terms', 'Refund'],
        reason:
            'reachable AND operable. Binding only ActivateIntent would leave '
            'these focusable and silent on Enter, which is half a fix.',
      );
    });

    testWidgets('Space activates too, not just Enter', (
      WidgetTester tester,
    ) async {
      final List<String> log = <String>[];
      await pump(
        tester,
        BrandFooter(
          wordmarkSemanticLabel: kCompany,
          poweredByLine: kLine,
          links: <BrandFooterLink>[link('Privacy', log)],
        ),
      );
      await tab(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(log, <String>['Privacy']);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  testWidgets('the links announce as LINKS, never as buttons', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();

    final List<String> log = <String>[];
    await pump(
      tester,
      BrandFooter(
        wordmarkSemanticLabel: kCompany,
        poweredByLine: kLine,
        links: <BrandFooterLink>[link('Privacy', log), link('Terms', log)],
      ),
    );

    for (final String label in <String>['Privacy', 'Terms']) {
      final SemanticsData d =
          tester.semantics.find(find.text(label)).getSemanticsData();
      expect(
        d.flagsCollection.isLink,
        isTrue,
        reason:
            'these hand the URL to the platform browser. "link" rather than '
            '"button" is what warns somebody they are about to leave the app.',
      );
      expect(
        d.flagsCollection.isButton,
        isFalse,
        reason: 'a link that also claims to be a button says both and means '
            'neither',
      );
      expect(
        d.label,
        label,
        reason: 'mergeDescendants means the word IS the name — one stop, not a '
            'nameless link beside a piece of prose.',
      );
    }
    // Disposed HERE, not via addTearDown: teardowns run AFTER the framework's
    // end-of-test handle check, which then fails the case it was meant to let
    // pass.
    handle.dispose();
  });
}

/// Stands in for the host app's asset bundle. See the note in `pump`.
class _HostBundle extends CachingAssetBundle {
  /// A 1x1 transparent PNG — the smallest thing `Image.asset` will decode.
  static final Uint8List _png = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8'
    'z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  );

  /// ⚠️ THE MANIFEST IS NOT OPTIONAL. `AssetImage` reads `AssetManifest.bin`
  /// FIRST, to pick a resolution variant, and hands whatever comes back to
  /// `StandardMessageCodec` — so a bundle that returns the PNG for every key
  /// fails with `FormatException: Message corrupted` before it ever reaches the
  /// image. An EMPTY manifest is the honest answer: no variants declared, so
  /// the 1.0x asset is used, which is what the app does for these two lockups.
  @override
  Future<ByteData> load(String key) async {
    if (key == 'AssetManifest.bin') {
      return const StandardMessageCodec().encodeMessage(<String, Object?>{})!;
    }
    return ByteData.sublistView(_png);
  }
}
