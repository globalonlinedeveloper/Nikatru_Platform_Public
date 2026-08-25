// ─────────────────────────────────────────────────────────────────────────────
// SC 2.4.7 FOCUS VISIBLE — THE RING'S CONTRAST RATIO, MEASURED.
//
// 🔴 WHAT THIS FILE CLOSES, QUOTED FROM THE THINGS THAT SAID IT WAS OPEN.
//
//   · `packages/design_system/lib/src/widgets/focusable_tap.dart`, class doc:
//     "THE RING IS NOT A CONFORMANCE CLAIM FOR SC 2.4.7 OR SC 2.4.11 ... no
//     contrast ratio against any of the grounds this widget can be dropped on
//     has been measured".
//   · `packages/design_system/test/focusable_tap_test.dart`, the ring case's
//     own `reason`: "this asserts the ring EXISTS. No contrast ratio has been
//     measured against any ground".
//   · `tooling/dod-register.json`, the `keyboard` row's `reMeasured2026-08-25`:
//     "the focus ring `FocusableTap` introduces has NO measured contrast ratio
//     against any of the grounds it lands on".
//
// All three are statements about a RATIO THAT NOBODY COMPUTED. This file
// computes it. It does not change one pixel of what is painted — the numbers
// below were what the shipped theme was already producing, unmeasured.
//
// ── THE NUMBERS, MEASURED 2026-08-26 ─────────────────────────────────────────
// Flutter 3.44.9, `flutter test test/a11y/`, seed #6459F5, read by raising
// [kNonTextContrastFloor] until every case reported its own ratio:
//
//   LIGHT · ring #5B5891 on scaffold #FCF8FF ....................  6.16:1
//   LIGHT · ring #5B5891 on card     #FFFFFF ....................  6.46:1
//   DARK  · ring #C4C0FF on scaffold #131318 .................... 10.87:1
//   DARK  · ring #C4C0FF on card     #35343A ....................  7.24:1
//
// ✅ THREE OF THE FOUR GROUNDS CROSS-CHECK AGAINST NUMBERS THIS CORPUS ALREADY
// WROTE DOWN INDEPENDENTLY, which is the cheapest evidence available that the
// rig is resolving the real theme rather than a test-only one: #FCF8FF is the
// live light scaffold `AppColors.muted`'s doc measures against, #131318 is the
// dark scaffold the same doc measures, and #35343A is the dark
// `surfaceContainerHighest` it names. None of the three is typed in this file.
//
// 🟢 SO THE RING WAS ALREADY CONFORMANT AND NOBODY KNEW — the closest of the
// four clears SC 1.4.11's 3:1 by more than 2x. That is the finding, and it is
// worth stating plainly because the honest alternative was a red. What was
// missing was never the contrast; it was the MEASUREMENT, which is why this
// increment adds a test and changes no colour.
//
// ── WHICH FLOOR, AND WHY IT IS NOT 2.4.7's ───────────────────────────────────
// SC 2.4.7 Focus Visible (Level AA) requires a visible focus indicator and
// states NO ratio; the criterion that puts a number on a focus indicator at
// Level AA is SC 1.4.11 Non-text Contrast, at 3:1. (SC 2.4.13 Focus Appearance
// does specify 3:1 plus a minimum area, and is LEVEL AAA — not inside the
// published claim, and not asserted here.) So the floor asserted is 3.0, and
// the register already settled that this is the house number:
// `aaaAdopted` -> `carveOut` reads "TEXT ONLY. Non-text contrast stays at SC
// 1.4.11's Level AA 3:1". Asserting 4.5 here would import a TEXT floor onto a
// border and would be a stricter bar than the claim we publish.
//
// ── EVERY COLOUR IS RESOLVED, NONE IS RETYPED ────────────────────────────────
// The ring colour is READ OFF THE PAINTED DECORATION — `DecoratedBox`'s own
// `BoxDecoration.border`, after a real `Tab` — not read off
// `colorScheme.primary` and compared to itself. The ground is resolved from the
// same `BuildContext` the control builds in: `Theme.of(context)
// .scaffoldBackgroundColor` for a control on the page, and
// `cardDecoration(context).color` for a control on a card. A hex literal on
// either side of a contrast comparison is a second declaration of a fact the
// theme already states, and it makes the natural regression — somebody moving
// the token — pass, because both sides move together.
//
// The ONE literal is [kSublySeed], and it is deliberate on the precedent
// `dark_card_surface_test.dart` sets in its own words: kept as a literal "so a
// change to the app's seed shows up as a failure to explain rather than as a
// test that silently follows it".
//
// ── DIRECTION IS PROVEN IN-FILE, NOT IN A COMMIT MESSAGE ─────────────────────
// The `FALSIFIER` group paints the ring with `focusColor:` set to the ground's
// own colour — a ring the theme could produce and a user could not see — and
// asserts the harness scores it at 1.00 and BELOW the floor. A measurement that
// cannot report a failure is not a measurement, and the only way to know this
// one can is to hand it something that must fail.
//
// AND THE WHOLE FILE WAS MUTATION-TESTED ONCE, ON 2026-08-26, RATHER THAN
// ARGUED ABOUT. The mutant drove the ring for EVERY case — not just the
// falsifiers — to `colorScheme.surfaceContainerHighest`, a real theme role one
// step off its own ground:
//
//   as written ..... `flutter test test/a11y/` -> rc=0, 9 of 9 pass
//   mutant ......... rc=1, 5 fail: 6.16 -> 1.23 · 6.46 -> 1.29 ·
//                    10.87 -> 1.50 · 7.24 -> 1.00, plus the strictly-further
//                    case, which catches the same mutation a second way
//
// All four grounds moved, in both brightnesses. A rig that could only redden on
// one of them would be pinning that ground, not the ring.
//
// ⚠️ WHAT THIS FILE DOES NOT ESTABLISH. It measures the ring against the two
// grounds `apps/subly` actually paints under a `FocusableTap` (the live
// scaffold and the shared card), in BOTH brightnesses. It says nothing about
// SC 2.4.11 Focus Not Obscured (a per-screen overlay-stack property, cut as a
// gate in the register), nothing about the brand-gradient ground that
// `focusColor:` exists for, and nothing about the 14 unmeasured routes. A
// register row for 2.4.7 is OWED and is not written here — `tooling/
// dod-register.json` is not this file's to edit.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/shared/widgets.dart';

/// The seed `apps/subly/lib/app.dart` passes to BOTH `theme:` and `darkTheme:`.
///
/// A literal, on the precedent and for the reason `dark_card_surface_test.dart`
/// records: reading it from the app would make this suite follow a seed change
/// silently, and a seed change is exactly the event that can move a focus ring
/// under the floor.
const Color kSublySeed = Color(0xFF6459F5);

/// SC 1.4.11 Non-text Contrast, Level AA. See the header for why the focus
/// ring's number comes from 1.4.11 and not from 2.4.7 or from 1.4.3's 4.5.
const double kNonTextContrastFloor = 3.0;

const Key _child = Key('focus-ring-child');

/// The WCAG contrast ratio between two OPAQUE colours, to 2dp.
///
/// ⚠️ IT IGNORES ALPHA, because `Color.computeLuminance()` does — a translucent
/// ring over a dark ground would be scored as though it were opaque, i.e.
/// FLATTERINGLY. Safe here and only here: every ring this file measures is read
/// off the painted decoration and asserted opaque before the ratio is taken, so
/// the trap is closed by [_ringOn] rather than by hope.
///
/// This duplicates the arithmetic of `_ratio` in `a11y_semantics_test.dart` and
/// of the inline luminance compare in `packages/design_system/test/
/// app_text_test.dart`. It is duplicated rather than shared because both are
/// PRIVATE top-level functions in test files and the design system exports no
/// contrast utility at all (`grep -rn "ontrast" packages/*/lib` -> three prose
/// comments, zero code). 📌 The shared helper is owed; the register's
/// `aaaAdopted` -> `guard` already says "the first increment is the computation
/// itself".
double contrastRatio(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return double.parse(((hi + 0.05) / (lo + 0.05)).toStringAsFixed(2));
}

/// One measurement: what got painted, and what it was painted next to.
class _Measurement {
  const _Measurement({required this.ring, required this.ground});

  /// Read off the focused control's own foreground decoration.
  final Color ring;

  /// Resolved from the control's own `BuildContext`.
  final Color ground;

  double get ratio => contrastRatio(ring, ground);
}

/// Where the control sits. Both values are grounds `apps/subly` really paints
/// a [FocusableTap] on today, not hypotheticals:
enum _Ground {
  /// Bare on the page — login's sign-up toggle, home's notifications button,
  /// the legal links. The ground is the live scaffold.
  scaffold,

  /// Inside a `cardDecoration` card — settings' currency chips, its `_Toggle`
  /// switches, its `_LinkRow`s and the profile card.
  card,
}

/// Mounts ONE [FocusableTap] on [ground] under [mode], presses a real `Tab`,
/// and returns the ring the widget actually painted beside the colour actually
/// under it.
///
/// A real key press rather than `node.requestFocus()`: the ring answers
/// `onFocusChange`, and a ring that only appears for programmatic focus is a
/// ring no keyboard user ever sees. `keyboard_traversal_test.dart` holds the
/// same line for the same reason.
Future<_Measurement> _measureRing(
  WidgetTester tester, {
  required ThemeMode mode,
  required _Ground ground,
  Color? focusColor,
}) async {
  await tester.binding.setSurfaceSize(const Size(600, 400));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSublySeed),
      darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
      themeMode: mode,
      home: Builder(
        builder: (BuildContext context) {
          // The child is a TRANSPARENT box on purpose. Nothing of this test's
          // own is painted inside the ring, so the colour the ring abuts on the
          // inside is the same ground it abuts on the outside — which is what
          // makes a single number an honest answer for this control.
          final Widget tap = FocusableTap(
            onTap: () {},
            focusColor: focusColor,
            child: const SizedBox(key: _child, width: 48, height: 48),
          );
          return Scaffold(
            body: Center(
              child: switch (ground) {
                _Ground.scaffold => tap,
                _Ground.card => Container(
                  decoration: cardDecoration(context),
                  padding: const EdgeInsets.all(16),
                  child: tap,
                ),
              },
            ),
          );
        },
      ),
    ),
  );

  // 🔴 SETTLE BEFORE READING, AND THE REASON IS A TRAP THIS FILE FELL INTO.
  // `MaterialApp` hands its theme to an `AnimatedTheme`, which LERPS over
  // `kThemeAnimationDuration` (200ms) whenever the theme changes. So a second
  // `pumpWidget` in the same test — light first, then dark — followed by a
  // single `pump()` reads a `colorScheme.primary` that is still essentially the
  // OLD brightness's. Measured 2026-08-26: the dark ring read back as the light
  // one, byte for byte (#5B5891 both times), and the derived ratio would have
  // been a number the app never paints. Fresh tests hide this, because the
  // FIRST build of an `AnimatedTheme` starts at its target rather than
  // animating to it — which is exactly why the four per-ground cases were green
  // while the cross-brightness one was red.
  await tester.pump(kThemeAnimationDuration);
  tester.binding.focusManager.primaryFocus?.unfocus();
  await tester.pump();
  await tester.sendKeyEvent(LogicalKeyboardKey.tab);
  await tester.pump();

  return _Measurement(
    ring: _ringOn(tester),
    ground: _groundUnder(tester, ground),
  );
}

/// The ring colour, taken from the painted decoration.
///
/// The NEAREST `DecoratedBox` ancestor of the child is [FocusableTap]'s own
/// foreground ring — `find.ancestor` yields closest-first, and on the card
/// ground the card's own `Container` is strictly further up. Selecting by
/// proximity rather than by border width means a future ring of a different
/// thickness is still measured rather than silently skipped.
Color _ringOn(WidgetTester tester) {
  final BoxDecoration decoration =
      tester
              .widget<DecoratedBox>(
                find
                    .ancestor(
                      of: find.byKey(_child),
                      matching: find.byType(DecoratedBox),
                    )
                    .first,
              )
              .decoration
          as BoxDecoration;

  final Border? border = decoration.border as Border?;
  expect(
    border,
    isNotNull,
    reason:
        'Tab landed on the control and it painted no ring at all. That is SC '
        '2.4.7 failing outright, and there is no ratio to report for a thing '
        'that is not there',
  );

  final Color ring = border!.top.color;
  expect(
    ring.a,
    1.0,
    reason:
        'the ring is TRANSLUCENT, and contrastRatio() goes through '
        'Color.computeLuminance(), which IGNORES ALPHA — so every number this '
        'file reports about it would be flattering rather than true. A '
        'translucent focus indicator has to be measured against the composite, '
        'which is a different rig from this one',
  );
  return ring;
}

/// The colour immediately under and around the ring, resolved from the
/// control's own context — never retyped.
Color _groundUnder(WidgetTester tester, _Ground ground) {
  final BuildContext context = tester.element(find.byKey(_child));
  return switch (ground) {
    _Ground.scaffold => Theme.of(context).scaffoldBackgroundColor,
    _Ground.card =>
      cardDecoration(context).color ??
          (throw StateError(
            'cardDecoration returned a null fill; there is no ground to '
            'measure against',
          )),
  };
}

void main() {
  group('SC 2.4.7 / 1.4.11 — the focus ring is measurably visible', () {
    for (final (String name, ThemeMode mode) in <(String, ThemeMode)>[
      ('LIGHT', ThemeMode.light),
      ('DARK', ThemeMode.dark),
    ]) {
      for (final (String where, _Ground ground) in <(String, _Ground)>[
        ('the live scaffold', _Ground.scaffold),
        ('a cardDecoration card', _Ground.card),
      ]) {
        testWidgets('$name — ring vs $where clears 3:1', (
          WidgetTester tester,
        ) async {
          final _Measurement m = await _measureRing(
            tester,
            mode: mode,
            ground: ground,
          );

          expect(
            m.ratio,
            greaterThanOrEqualTo(kNonTextContrastFloor),
            reason:
                'the focus ring scores ${m.ratio}:1 on $where in $name — ring '
                '${m.ring} on ground ${m.ground}. SC 1.4.11 Non-text Contrast '
                '(AA) asks 3:1 of a focus indicator, and the register carves '
                'non-text contrast to exactly that number. A ring under the '
                'floor makes 23 controls focusable with no perceivable '
                'indication of WHERE focus went, which trades the SC 2.1.1 '
                'failure FocusableTap was built to end for an SC 2.4.7 one',
          );
        });
      }
    }

    testWidgets('the ring differs from its ground at every brightness', (
      WidgetTester tester,
    ) async {
      final _Measurement light = await _measureRing(
        tester,
        mode: ThemeMode.light,
        ground: _Ground.scaffold,
      );
      final _Measurement dark = await _measureRing(
        tester,
        mode: ThemeMode.dark,
        ground: _Ground.scaffold,
      );

      expect(
        light.ring,
        isNot(dark.ring),
        reason:
            'the ring resolves from colorScheme.primary, which forks by '
            'brightness. One literal painted at both brightnesses is the '
            'defect AppColors.muted documents at length — it cannot clear the '
            'floor on a near-white scaffold and a near-black one at once',
      );
    });
  });

  // ── FALSIFIER ──────────────────────────────────────────────────────────────
  // 🔴 THE CASES ABOVE ARE WORTH NOTHING WITHOUT THESE TWO. Four green
  // assertions prove a rig runs; they do not prove it can go red over the input
  // it claims to police. `focusColor:` IS the ring-colour input — it is the
  // documented override "for a control sitting on a ground the theme's primary
  // does not survive" — so driving it with a colour that does not survive is
  // mutating the real input class, not simulating one.
  group('FALSIFIER — the measurement can report a failure', () {
    testWidgets('a ring painted the ground\'s own colour scores 1.00', (
      WidgetTester tester,
    ) async {
      final Color ground = buildAppTheme(
        seed: kSublySeed,
      ).scaffoldBackgroundColor;

      final _Measurement m = await _measureRing(
        tester,
        mode: ThemeMode.light,
        ground: _Ground.scaffold,
        focusColor: ground,
      );

      expect(m.ring, ground);
      expect(
        m.ratio,
        1.00,
        reason:
            'a ring the same colour as what it is drawn on is invisible, and '
            'the ratio of a colour with itself is 1.00 by definition',
      );
      expect(
        m.ratio,
        lessThan(kNonTextContrastFloor),
        reason:
            'THE POINT OF THIS CASE. If an invisible ring passes the floor '
            'this file asserts, then every green case above is green for a '
            'reason unrelated to contrast and the whole file is decorative',
      );
    });

    testWidgets('a near-ground ring fails while a distinguishable one passes', (
      WidgetTester tester,
    ) async {
      final ThemeData light = buildAppTheme(seed: kSublySeed);

      // A pale grey ONE STEP off the light scaffold: the shape of the real
      // regression (somebody "tidying" the ring to a neutral outline token),
      // not a degenerate identity.
      final _Measurement bad = await _measureRing(
        tester,
        mode: ThemeMode.light,
        ground: _Ground.scaffold,
        focusColor: light.colorScheme.surfaceContainerHighest,
      );
      final _Measurement good = await _measureRing(
        tester,
        mode: ThemeMode.light,
        ground: _Ground.scaffold,
      );

      expect(
        bad.ratio,
        lessThan(kNonTextContrastFloor),
        reason:
            'surfaceContainerHighest is a SURFACE role, not an indicator one. '
            'It sits a step from the scaffold by design, so a ring painted '
            'with it is a ring that is almost the page — and this rig must '
            'score that as the failure it is',
      );
      expect(
        good.ratio,
        greaterThan(bad.ratio),
        reason:
            'the shipped ring must be strictly further from the ground than '
            'the near-ground mutant. If these two ever converge, the '
            'measurement has stopped depending on the ring colour at all',
      );
    });
  });

  // ── THE ARITHMETIC ITSELF ──────────────────────────────────────────────────
  // Pinned against the two ratios WCAG fixes by definition, so a broken helper
  // cannot quietly hand every case above a passing number.
  group('contrastRatio is the WCAG formula', () {
    test('black on white is 21:1 and a colour on itself is 1:1', () {
      expect(
        contrastRatio(const Color(0xFF000000), const Color(0xFFFFFFFF)),
        21.0,
      );
      expect(
        contrastRatio(const Color(0xFF6459F5), const Color(0xFF6459F5)),
        1.0,
      );
    });

    test('the ratio is symmetric — order of arguments cannot flatter it', () {
      const Color a = Color(0xFF6459F5);
      const Color b = Color(0xFFFCF8FF);
      expect(contrastRatio(a, b), contrastRatio(b, a));
    });
  });
}
