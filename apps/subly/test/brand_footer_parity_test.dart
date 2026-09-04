import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/l10n/app_localizations.dart';

/// THE MOVE PIN — `PoweredByNikatru` / `NikatruWordmark` must RENDER exactly
/// what they rendered before they were moved into `packages/design_system`.
///
/// ── WHY A DIGEST AND NOT A GOLDEN ───────────────────────────────────────────
/// The brand widgets were lifted out of `apps/subly/lib/features/shared/
/// widgets.dart` into `packages/design_system` (`BrandWordmark` /
/// `BrandFooter`), and the app's copies became thin adapters that supply
/// `AppConfig` + the arb strings. `apps/subly` is the app the owner eyeballs,
/// so the ONLY acceptable outcome of that lift is "nothing moved on screen".
///
/// A golden file cannot say that here: this footer draws Manrope, and the fonts
/// are not bundled (see `apps/subly/pubspec.yaml`'s commented `fonts:` block),
/// so a golden would pin Ahem boxes and would go red for a font change rather
/// than for a regression. So the pin is a DIGEST of every render-bearing
/// property instead: the asset the lockup loads, its height and accessible
/// name, and every `TextStyle`, `SizedBox`, `Wrap`, `Column`, `Padding` and
/// `FocusableTap` configuration in document order, in BOTH brightnesses.
///
/// 🔴 THE WALK DELIBERATELY SKIPS COMPOSITION. `StatelessWidget` wrappers are
/// not in the digest, because the move ADDS two of them — `NikatruWordmark` now
/// builds a `BrandWordmark` which builds the `Image` — and a digest that
/// counted them would go red for the one change that is guaranteed not to be
/// visible. What IS in the digest is everything that paints or measures. If a
/// literal drifts during the lift — a colour, a font size, a gap, a hit-test
/// behaviour, the underline — this file names it.
///
/// ⚠️ THE EXPECTED STRINGS BELOW WERE CAPTURED FROM THE TREE **BEFORE** THE
/// MOVE, by running this same walk against the pre-move `PoweredByNikatru`.
/// That is the whole evidentiary value of the file: they are a measurement of
/// the old widget, not a transcription of the new one.
void main() {
  group('PoweredByNikatru renders identically after the design_system lift', () {
    testWidgets('[light] the render digest is unchanged', (
      WidgetTester tester,
    ) async {
      final String digest = await _digest(tester, Brightness.light);
      expect(digest, _kLight, reason: _kWhy);
    });

    testWidgets('[dark] the render digest is unchanged', (
      WidgetTester tester,
    ) async {
      final String digest = await _digest(tester, Brightness.dark);
      expect(digest, _kDark, reason: _kWhy);
    });

    testWidgets('the lockup alone carries the same asset and accessible name', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: buildAppTheme(seed: _kSeed),
          home: const Scaffold(
            body: Center(child: NikatruWordmark(onDark: true, height: 18)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final Image img = tester.widget<Image>(find.byType(Image));
      expect(
        (img.image as AssetImage).assetName,
        'assets/brand/nikatru-logo-dark-bg.png',
        reason:
            'onDark picks the dark-background lockup. This is the ONE call '
            'site that passes onDark: true (onboarding_screen.dart:403), and '
            'it is on the hero, so the wrong asset is a black mark on a dark '
            'gradient.',
      );
      expect(img.height, 18);
      expect(
        img.semanticLabel,
        AppConfig.companyName,
        reason:
            'the accessible name is app copy and had to become a REQUIRED '
            'parameter when the widget moved into packages/ — a default '
            'sentence there is a shipped literal outside the reach of '
            'tooling/ci/assert-no-hardcoded-strings.mjs.',
      );
    });
  });
}

const Color _kSeed = Color(0xFF6459F5);

const String _kWhy =
    'apps/subly is the app the owner eyeballs. Lifting these widgets into '
    'packages/design_system was a MOVE, and a move that changes a pixel is a '
    'repaint nobody asked for. Any diff here names the literal that drifted.';

Future<String> _digest(WidgetTester tester, Brightness brightness) async {
  await tester.binding.setSurfaceSize(const Size(600, 400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(seed: _kSeed, brightness: brightness),
      home: const Scaffold(body: Center(child: PoweredByNikatru())),
    ),
  );
  await tester.pumpAndSettle();

  final List<String> lines = <String>[];
  void walk(Element e) {
    final String? line = _describe(e.widget);
    if (line != null) lines.add(line);
    e.visitChildren(walk);
  }

  walk(tester.element(find.byType(PoweredByNikatru)));
  final String out = lines.join('\n');
  // Printed as well as asserted: the capture that seeded the constants below
  // was taken from this line, and a future move can re-seed it the same way.
  debugPrint('--- DIGEST[$brightness] ---\n$out\n--- END ---');
  return out;
}

/// One canonical line per render-bearing widget, or `null` to skip it.
String? _describe(Widget w) {
  if (w is Image) {
    return 'Image(asset=${(w.image as AssetImage).assetName} '
        'h=${w.height} fq=${w.filterQuality.name} sem=${w.semanticLabel})';
  }
  if (w is Text) {
    return 'Text(${w.data!.length > 40 ? '${w.data!.substring(0, 40)}…' : w.data}'
        ' ${_style(w.style)})';
  }
  if (w is SizedBox) return 'SizedBox(w=${w.width} h=${w.height})';
  if (w is Wrap) {
    return 'Wrap(align=${w.alignment.name} cross=${w.crossAxisAlignment.name} '
        'sp=${w.spacing} run=${w.runSpacing})';
  }
  if (w is Column) {
    return 'Column(size=${w.mainAxisSize.name} cross=${w.crossAxisAlignment.name} '
        'main=${w.mainAxisAlignment.name})';
  }
  if (w is Padding) return 'Padding(${w.padding})';
  if (w is FocusableTap) {
    return 'FocusableTap(role=${w.role.name} behavior=${w.behavior.name} '
        'radius=${w.borderRadius.topLeft.x} focusColor=${_hex(w.focusColor)} '
        'merge=${w.mergeDescendants} label=${w.label} enabled=${w.onTap != null})';
  }
  return null;
}

String _style(TextStyle? s) {
  if (s == null) return 'style=null';
  return 'ff=${s.fontFamily} fw=${s.fontWeight?.value} fs=${s.fontSize} '
      'color=${_hex(s.color)} dec=${s.decoration}';
}

String _hex(Color? c) =>
    c == null ? 'null' : '#${c.toARGB32().toRadixString(16).padLeft(8, '0')}';

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURED FROM THE PRE-MOVE TREE. Do not hand-edit: re-seed from the debugPrint.
// ─────────────────────────────────────────────────────────────────────────────
const String _kLight = r'''Column(size=min cross=center main=start)
Image(asset=assets/brand/nikatru-logo.png h=22.0 fq=medium sem=Nikatru)
SizedBox(w=null h=8.0)
Text(Subly by Nikatru ff=Manrope fw=500 fs=12.0 color=#ff6f6f7b dec=null)
SizedBox(w=null h=8.0)
Wrap(align=center cross=center sp=0.0 run=0.0)
FocusableTap(role=link behavior=deferToChild radius=4.0 focusColor=null merge=true label=null enabled=true)
Text(Privacy ff=Manrope fw=700 fs=12.0 color=#ff6f6f7b dec=TextDecoration.underline)
Padding(EdgeInsets(8.0, 0.0, 8.0, 0.0))
Text(· ff=null fw=null fs=12.0 color=#ff6f6f7b dec=null)
FocusableTap(role=link behavior=deferToChild radius=4.0 focusColor=null merge=true label=null enabled=true)
Text(Terms ff=Manrope fw=700 fs=12.0 color=#ff6f6f7b dec=TextDecoration.underline)
Padding(EdgeInsets(8.0, 0.0, 8.0, 0.0))
Text(· ff=null fw=null fs=12.0 color=#ff6f6f7b dec=null)
FocusableTap(role=link behavior=deferToChild radius=4.0 focusColor=null merge=true label=null enabled=true)
Text(Refund ff=Manrope fw=700 fs=12.0 color=#ff6f6f7b dec=TextDecoration.underline)''';

const String _kDark = r'''Column(size=min cross=center main=start)
Image(asset=assets/brand/nikatru-logo.png h=22.0 fq=medium sem=Nikatru)
SizedBox(w=null h=8.0)
Text(Subly by Nikatru ff=Manrope fw=500 fs=12.0 color=#ffc8c5d0 dec=null)
SizedBox(w=null h=8.0)
Wrap(align=center cross=center sp=0.0 run=0.0)
FocusableTap(role=link behavior=deferToChild radius=4.0 focusColor=null merge=true label=null enabled=true)
Text(Privacy ff=Manrope fw=700 fs=12.0 color=#ffc8c5d0 dec=TextDecoration.underline)
Padding(EdgeInsets(8.0, 0.0, 8.0, 0.0))
Text(· ff=null fw=null fs=12.0 color=#ffc8c5d0 dec=null)
FocusableTap(role=link behavior=deferToChild radius=4.0 focusColor=null merge=true label=null enabled=true)
Text(Terms ff=Manrope fw=700 fs=12.0 color=#ffc8c5d0 dec=TextDecoration.underline)
Padding(EdgeInsets(8.0, 0.0, 8.0, 0.0))
Text(· ff=null fw=null fs=12.0 color=#ffc8c5d0 dec=null)
FocusableTap(role=link behavior=deferToChild radius=4.0 focusColor=null merge=true label=null enabled=true)
Text(Refund ff=Manrope fw=700 fs=12.0 color=#ffc8c5d0 dec=TextDecoration.underline)''';
