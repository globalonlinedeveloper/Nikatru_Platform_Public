import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// SC 2.1.1 KEYBOARD, AT THE PRIMITIVE.
///
/// `apps/subly/test/keyboard_traversal_test.dart` measures the CRITERION on
/// three real screens. This file measures the PROPERTY on the widget those
/// screens are being rebuilt on, and the two are not the same assertion: a
/// screen sweep goes green the moment somebody deletes the last dead control,
/// including by deleting the control. These cases fail if [FocusableTap] ever
/// stops being focusable, whatever any app happens to be built out of.
///
/// 🔴 EVERY CASE HERE PRESSES REAL KEYS THROUGH A REAL `WidgetsApp` SHORTCUT
/// MAP. Nothing reads a `FocusNode` list, because a node that exists and no key
/// press can reach is exactly the defect this widget was built to end.
void main() {
  const Key kBox = Key('ft-child');

  Future<void> pump(
    WidgetTester tester,
    Widget w, {
    Size size = const Size(600, 400),
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester
        .pumpWidget(MaterialApp(home: Scaffold(body: Center(child: w))));
    tester.binding.focusManager.primaryFocus?.unfocus();
    await tester.pump();
  }

  /// The 48x48 box every case wraps: a size the app's own tap-target floor
  /// pins, so a layout regression introduced by the wrapper shows up here as a
  /// number rather than as a screenshot nobody looks at.
  Widget box() => const SizedBox(key: kBox, width: 48, height: 48);

  Future<void> tab(WidgetTester tester) async {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
  }

  /// Is the node `Tab` actually landed on INSIDE a [FocusableTap]?
  ///
  /// Element containment, walked upwards from the focused node — not a
  /// rectangle overlap and not a read of any `FocusNode` list. A focus ring
  /// that happens to cover a control it cannot activate is not reachability,
  /// and geometry cannot tell those apart. Walking UP from `primaryFocus` also
  /// means a bare `FocusScope` (which is what the enclosing route owns, and
  /// which is an ANCESTOR of everything on screen) can never be mistaken for a
  /// focus stop on the control.
  bool focusIsInsideTheTap(WidgetTester tester) {
    final BuildContext? c = tester.binding.focusManager.primaryFocus?.context;
    if (c == null) return false;
    bool inside = c.widget is FocusableTap;
    (c as Element).visitAncestorElements((Element a) {
      if (a.widget is FocusableTap) {
        inside = true;
        return false;
      }
      return true;
    });
    return inside;
  }

  group('reachable', () {
    testWidgets('one Tab press lands focus on the control', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        FocusableTap(onTap: () {}, child: box()),
      );
      await tab(tester);
      expect(
        focusIsInsideTheTap(tester),
        isTrue,
        reason:
            'Tab did not reach a FocusableTap. This widget exists for exactly '
            'one reason and that is it: a hand-rolled Semantics + '
            'GestureDetector pair gives a screen reader a ROLE and a keyboard '
            'NOTHING, which is SC 2.1.1 failed',
      );
    });

    testWidgets('an inert control (onTap: null) is NOT a focus stop', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        FocusableTap(onTap: null, child: box()),
      );
      await tab(tester);
      expect(
        focusIsInsideTheTap(tester),
        isFalse,
        reason: 'a row that does nothing when activated must not collect a Tab '
            'stop. FocusableTap.onTap documents why: announcing a control that '
            'is inert sends somebody pressing Enter at a dead surface and '
            'blaming their keyboard',
      );
    });
  });

  group('operable — reachable is not the same as activatable', () {
    testWidgets('Enter on the focused control invokes onTap', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pump(
        tester,
        FocusableTap(onTap: () => taps++, child: box()),
      );
      await tab(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(
        taps,
        1,
        reason: 'Enter reaches this widget as a ButtonActivateIntent through '
            "WidgetsApp's default shortcut map. A control that accepts focus "
            'and ignores Enter is reachable and inoperable',
      );
    });

    testWidgets('Space on the focused control invokes onTap', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await pump(
        tester,
        FocusableTap(onTap: () => taps++, child: box()),
      );
      await tab(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pump();
      expect(
        taps,
        1,
        reason: 'Space arrives as a plain ActivateIntent, Enter as a '
            'ButtonActivateIntent — two different Intent types out of one '
            'shortcut map. Binding only one leaves the control half-operable, '
            'and which half depends on which key the user reaches for first',
      );
    });

    // ── 🔴 THE WEB MAP, PINNED SEPARATELY, BECAUSE NO ORDINARY WIDGET TEST
    // CAN SEE IT ────────────────────────────────────────────────────────────
    // MEASURED against this checkout's Flutter
    // (`packages/flutter/lib/src/widgets/app.dart`), 2026-08-25:
    //   :1265  _defaultShortcuts     enter -> ActivateIntent
    //   :1317  _defaultWebShortcuts  enter -> ButtonActivateIntent
    // `flutter test` runs the NON-web map, so the `ButtonActivateIntent`
    // binding in [FocusableTap] is invisible to every case above — deleting it
    // leaves this whole file green. It was nearly deleted for exactly that
    // reason, and deleting it would have broken Enter on `apps/subly`'s WEB
    // build, which `deploy-web.yml` ships.
    //
    // So the web map is installed EXPLICITLY here, quoting the two rows the
    // framework installs when `kIsWeb`. That makes the second binding
    // reddenable: drop `ButtonActivateIntent` from the widget and this case
    // fails alone, which is the only reason it is allowed to exist.
    testWidgets('Enter under the WEB shortcut map invokes onTap', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await tester.binding.setSurfaceSize(const Size(600, 400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          shortcuts: const <ShortcutActivator, Intent>{
            SingleActivator(LogicalKeyboardKey.tab): NextFocusIntent(),
            SingleActivator(LogicalKeyboardKey.enter): ButtonActivateIntent(),
            SingleActivator(LogicalKeyboardKey.numpadEnter):
                ButtonActivateIntent(),
          },
          home: Scaffold(
            body: Center(
              child: FocusableTap(onTap: () => taps++, child: box()),
            ),
          ),
        ),
      );
      tester.binding.focusManager.primaryFocus?.unfocus();
      await tester.pump();
      await tab(tester);
      expect(
        focusIsInsideTheTap(tester),
        isTrue,
        reason: 'the substitute map must still traverse, or the next '
            'assertion would pass or fail for the wrong reason',
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(
        taps,
        1,
        reason: 'on the web build Enter arrives as a ButtonActivateIntent and '
            'NOTHING ELSE does. A widget that binds only ActivateIntent is '
            'fully operable under `flutter test` and silent on Enter in a '
            'browser — the exact shape of a green suite over a broken product',
      );
    });

    testWidgets('an inert control does nothing on Enter', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        FocusableTap(onTap: null, child: box()),
      );
      await tab(tester);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      // No callback exists to count; the assertion is that nothing threw and
      // no focus was taken. The previous group pins the focus half.
      expect(find.byKey(kBox), findsOneWidget);
    });
  });

  group('the wrapper is invisible to layout and audible to a reader', () {
    testWidgets('wrapping does not move a single pixel of the child', (
      WidgetTester tester,
    ) async {
      await pump(tester, box());
      final Size bare = tester.getSize(find.byKey(kBox));
      await pump(
        tester,
        FocusableTap(onTap: () {}, child: box()),
      );
      final Size wrapped = tester.getSize(find.byKey(kBox));
      expect(
        wrapped,
        bare,
        reason:
            'FocusableTap paints its ring as a FOREGROUND decoration precisely '
            'so this holds. A ring that participated in layout would shrink '
            'the 48px tap targets a11y_semantics_test and '
            'chassis_properties_test pin — trading a Level A failure for a '
            'different one',
      );
      expect(wrapped, const Size(48, 48));
    });

    testWidgets('the ring is painted when focused and not when it is not', (
      WidgetTester tester,
    ) async {
      await pump(
        tester,
        FocusableTap(onTap: () {}, child: box()),
      );
      BoxDecoration ringOf(WidgetTester t) => t
          .widget<DecoratedBox>(
            find
                .ancestor(
                  of: find.byKey(kBox),
                  matching: find.byType(DecoratedBox),
                )
                .first,
          )
          .decoration as BoxDecoration;

      expect(
        ringOf(tester).border,
        isNull,
        reason: 'an unfocused control must not paint a focus ring',
      );
      await tab(tester);
      expect(
        ringOf(tester).border,
        isNotNull,
        reason:
            'focus landed here and nothing on screen said so. Making a control '
            'focusable with no visible indication of where focus went trades '
            'SC 2.1.1 for SC 2.4.7. NOTE: this asserts the ring EXISTS. No '
            'contrast ratio has been measured against any ground, and the '
            'register carries no 2.4.7 row — see the class doc',
      );
    });

    testWidgets('the role a screen reader hears is button or link, not both', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pump(
        tester,
        FocusableTap(
          onTap: () {},
          label: 'Privacy',
          role: TapRole.link,
          child: box(),
        ),
      );
      expect(
        find.bySemanticsLabel('Privacy').evaluate().isNotEmpty,
        isTrue,
        reason: 'the label the caller passed must survive the wrapper',
      );
      // `isSemantics`, not `hasFlag` and not `containsSemantics`: both are
      // deprecated in this checkout's Flutter (3.32 and 3.40 respectively), and
      // `matchesSemantics` would assert the ABSENCE of every property not
      // listed — turning this case into a pin on the whole node rather than on
      // the one distinction it is about.
      expect(
        tester.getSemantics(find.byKey(kBox)),
        isSemantics(isLink: true, isButton: false),
        reason:
            'link, NOT button: this leaves the app, and a reader announces the '
            'two differently on purpose — "link" warns you before you go',
      );
      handle.dispose();
    });

    testWidgets('toggled and selected reach the semantics node', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pump(
        tester,
        FocusableTap(
          onTap: () {},
          label: 'Renewal alerts',
          toggled: true,
          child: box(),
        ),
      );
      expect(
        tester.getSemantics(find.byKey(kBox)),
        isSemantics(hasToggledState: true, isToggled: true),
        reason: 'a toggle whose state the user cannot hear is a button that '
            'appears to do nothing — the same rule '
            'assert-consent-withdrawal-surface.mjs limb 3 enforces for the '
            'analytics row',
      );
      handle.dispose();
    });
  });
}
