// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD OPERABILITY — THE SWEEP `tooling/dod-register.json` ADOPTED AND
// NEVER RAN.
//
// The register's `keyboard-no-exception` row (SC 2.1.3, Level AAA) has carried
// `⬜ ADOPTED AND UNMET (unmeasured — no keyboard-operability sweep exists)`
// since 2026-08-13, and its evidence sentence ended "That has never been
// asserted: no keyboard-traversal test exists in the chassis suite". This file
// is the first measurement. It does NOT discharge that row — see THE SCOPE
// below — and the row has been corrected to say so rather than left to be read
// as coverage.
//
// 🔴 THE CRITERION THIS FILE IS ACTUALLY ABOUT IS SC 2.1.1 KEYBOARD, LEVEL A.
// Until 2026-08-21 the register carried 2.1.3 (AAA, optional, attached under
// §5.3.2) and had NO ROW AT ALL for 2.1.1 — the Level A criterion that the
// published claim "Accessible — WCAG 2.2 Level AA" REQUIRES by §5.2.1. That is
// the §4-F defect the register was built to stop, arriving one level lower than
// anybody was looking: a criterion in neither the required list nor the cut
// list, under a claim that cannot be true without it. `insideTheClaim` in the
// register is the row that was missing; this file is its evidence.
//
// ── WHAT IS MEASURED, AND WHY IT IS THE ORBIT AND NOT A WIDGET COUNT ─────────
// The question SC 2.1.1 asks is "can a keyboard reach this control", and the
// only honest answer is the one a keyboard produces. So [_sweep] presses REAL
// Tab keys through the app's REAL `WidgetsApp` shortcut bindings and records
// the ORBIT — the sequence of nodes `primaryFocus` actually visits, stopping
// the moment it revisits one. Nothing here reads a `FocusNode` list directly;
// a node that exists but no `Tab` press can land on is exactly the defect.
//
// A control is REACHABLE iff some orbit node's `Focus` element is an ancestor
// of it, or it is an ancestor of that element. Both directions are needed and
// each catches a different lie:
//   · ancestor-of  — `TextButton` builds its own `GestureDetector` UNDER its
//     `Focus`, so a one-directional test would report the framework's own
//     buttons as keyboard-dead. 6 of login's 8 candidates are that shape.
//   · descendant-of — an author `GestureDetector` wrapping a `ListTile` sits
//     ABOVE the tile's focus node.
// Element containment rather than rectangle overlap, deliberately: a focus ring
// that happens to cover a control it cannot activate is not reachability, and
// geometry cannot tell those apart.
//
// ⚠️ THE CANDIDATE SET IS `GestureDetector(onTap:) ∪ InkWell(onTap:) ∪
// EditableText`, reduced to the OUTERMOST of any nested run. That set is not a
// guess: `a11y_semantics_test.dart`'s header records the measured baseline —
// "every control in the app is a hand-rolled `GestureDetector` or `InkWell` (23
// of them)", ZERO `IconButton`s. The outermost reduction is what stops one
// control being counted twice when an `InkWell` builds a `GestureDetector`
// inside itself.
//
// ── THE SURFACE IS 1079×2400, AND BOTH NUMBERS ARE LOAD-BEARING ─────────────
// 1079 is the width `AppScaffold` hands a branch on a maximised 1440 px desktop
// — `min(1440 - 361, 1280)`, measured 2026-08-21, and already named `kShell` in
// `width_settings_test.dart`. A keyboard sweep belongs at a DESKTOP width
// because a desktop is where a keyboard-only user is.
//
// 2400 tall is what makes the sweep COMPLETE rather than merely long. A
// `ListView` culls what is off-screen, and a culled control is neither
// reachable nor unreachable — it does not exist, so a sweep run in a short
// viewport measures the viewport instead of the screen and silently
// under-reports. Every group below therefore opens with [_everythingIsLaidOut],
// which asserts `maxScrollExtent == 0`: nothing was culled, so the inventory is
// the whole screen. Delete that case and every count in this file becomes a
// number about a window rather than about a product.
//
// ── 🔴 WHAT THE SWEEP FOUND, 2026-08-21. IT IS NOT A PASS. ──────────────────
// login 4 of 8 · settings 9 of 27 · home 17 of 20 — 55 interactive controls
// across the three screens, 30 reachable by Tab, 25 keyboard-DEAD. Traversal
// itself is clean everywhere it exists: every orbit closes, retraces under
// Shift-Tab and runs down the page. The failure is not the ORDER of the
// traversal, it is what the traversal never visits.
//
// The dead ones are the app's hand-rolled `Semantics(button:
// true)` + `GestureDetector` pairs — the same shape `a11y_semantics_test.dart`
// found announcing as prose. `Semantics(button: true)` tells a screen reader
// what a thing IS; it creates no `FocusNode`, so it does nothing whatever for a
// keyboard, and the two defects have been mistaken for one another before.
//
// The worst single instance is on the screen every signed-out visitor is routed
// to: login's "New here? Create account" band, which `login_screen.dart:562`
// already documents as "the ONLY control that reaches registration from the
// screen every signed-out visitor is routed to" — and `:553` as "the only way
// to reach sign-up". A keyboard-only user cannot register.
//
// ⚠️ THESE CASES ARE THEREFORE PINS, NOT PASSES. Each dead-control case asserts
// an EXACT count and prints the labels when it moves. It goes red when a
// control is added AND when one is fixed — the second is the point. A sweep
// that only fires on regression records today's failure as the standard.
//
// ── 🟢 2026-08-25 — RE-MEASURED AFTER THE FIX. APPENDED, NOT REWRITTEN. ──
// The block above is the 2026-08-21 measurement and stays as it was written;
// this is what the same sweep reports today, on the same 1079x2400 surface,
// after `packages/design_system`'s `FocusableTap` replaced the hand-rolled
// `Semantics` + `GestureDetector` pairs on all three screens:
//
//   login    8 of 8   (was 4 of 8)
//   settings 25 of 27 (was 9 of 27)
//   home     20 of 20 (was 17 of 20)
//
// 55 controls, 53 reachable by Tab, 2 not. Both remaining are the `en` and `ta`
// members of the LANGUAGE `RadioGroup`.
//
// 🔴 AND THOSE TWO ARE NOT KEYBOARD-DEAD — THE 2026-08-21 READING OF THEM WAS
// WRONG, AND IT IS CORRECTED HERE RATHER THAN QUIETLY DROPPED. That sweep's
// sentence "every one of the eighteen it does NOT visit is a hand-rolled
// `_Toggle`, `_LinkRow` or currency chip" is FALSE of two of the eighteen: they
// are Material `RadioListTile`s, and a `RadioGroup` is a SINGLE Tab stop by
// design — you arrive on the group and move within it with the arrow keys, which
// is what a radio group is supposed to do. MEASURED 2026-08-25 by
// [_arrowReachesWithinTheRadioGroup] below: ArrowDown from the group's own Tab
// stop moves focus onto the `en` tile. SC 2.1.1 asks whether a KEYBOARD can
// operate the control, not whether TAB can land on it, so a Tab-only sweep
// counts a conformant radio group as two failures. The honest 2026-08-21 total
// was therefore 23 keyboard-dead, not 25.
//
// The two rows are NOT counted as reachable in the pins below — the pins measure
// the Tab orbit and must keep measuring exactly that — so the arrow-key property
// gets its own case with its own EXACT count instead. That is what stops the
// correction becoming a loosened matcher: the number 2 goes red if a third
// control ever falls out of the Tab orbit for a different reason.

// ── THE SCOPE, STATED SO IT CANNOT BE READ AS MORE ───────────────────────────
// THREE screens — login, settings, home. ⚠️ TWO DENOMINATORS, AND THEY COUNT
// DIFFERENT THINGS, so both are named rather than blended — this comment read
// "of the register's 22" until 2026-08-25 and that number was stale by
// nineteen days and belonged to neither domain:
//
//   · 25 — screens declared in `tooling/screen-register.json`. MEASURED
//     2026-08-25: `node -e "console.log(JSON.parse(require('fs')
//     .readFileSync('tooling/screen-register.json','utf8')).screens.length)"`
//     -> 25, of which 24 are `present` and 1 is `blocked`. This is the domain
//     the register's 2.1.3 guard specifies ("on a fresh stamp, EVERY declared
//     route"), and 22 was this set's `present` count on 2026-08-06 — see
//     `tooling/ci/assert-screen-set.mjs`, whose header quotes its own old
//     output `22 present and anchored` and whose MIN_PRESENT floor now reads
//     24. The number went UP; the stale figure UNDERSTATED the domain and so
//     OVERSTATED this file's share of it.
//   · 17 — screens `apps/subly/lib/core/router.dart` actually declares.
//     MEASURED 2026-08-25: `grep -c 'GoRoute(' apps/subly/lib/core/router.dart`
//     -> 19, two of which are redirect-only (`/` and `/login`) and carry no
//     builder, so 17 build a screen. This is the domain THIS FILE sweeps 3 of,
//     and 14 of it are unmeasured.
//
// On apps/subly, the frozen rail-prover, NOT on a fresh stamp of
// `tooling/bricks/app`. This is neither the guard's tree nor its scope, and the
// register's `guardStatus` says PARTLY BUILT for exactly that reason.
//
// The three were chosen because their files are stable, and because between
// them they cover the three control idioms the app has: a form (login), a
// settings list of toggles and radios (settings), and a list of rows under
// app-bar actions (home).
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';

import 'support/width_harness.dart';

/// The desktop shell width (see the header) at a viewport tall enough that no
/// screen in the sweep scrolls. Both halves are asserted, not assumed:
/// [_everythingIsLaidOut] fails if 2400 ever stops being enough.
const Size kKeyboardSurface = Size(1079, 2400);

/// True when [child] is [ancestor] or sits anywhere beneath it.
///
/// `visitAncestorElements` rather than a downward walk because the upward chain
/// is O(depth) and the downward one is O(subtree) — and this runs once per
/// candidate per orbit node.
bool _isUnder(Element? child, Element? ancestor) {
  if (child == null || ancestor == null) return false;
  if (identical(child, ancestor)) return true;
  bool found = false;
  child.visitAncestorElements((Element a) {
    if (identical(a, ancestor)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/// What a failure calls a control.
///
/// The nearest enclosing `Semantics` label first — that is what the app itself
/// decided this control is called, and `a11y_semantics_test.dart` polices that
/// every control has one. The first `Text` beneath it is the fallback for the
/// handful that carry their name only as painted copy. The type name is the
/// last resort and reads as one.
///
/// ⚠️ LOCALISED STRINGS ON PURPOSE. A failure message naming "$", "₹" and
/// "Log out" is a sentence somebody can act on; an element hash is not. No
/// ASSERTION compares these — only the COUNTS are pinned — so an .arb edit
/// cannot turn this file red.
String _label(Element e) {
  String? semantic;
  e.visitAncestorElements((Element a) {
    final Widget w = a.widget;
    if (w is Semantics && w.properties.label != null) {
      semantic = w.properties.label;
      return false;
    }
    return true;
  });
  if (semantic != null) return semantic!;
  String? painted;
  void down(Element c) {
    if (painted != null) return;
    final Widget w = c.widget;
    if (w is Text && w.data != null) {
      painted = w.data;
      return;
    }
    c.visitChildren(down);
  }

  e.visitChildren(down);
  return painted ?? e.widget.runtimeType.toString();
}

/// Is [e] a `RadioListTile`, or inside one?
///
/// Used by exactly one assertion, and its narrowness is the assertion: the
/// tolerance for a control that no `Tab` press reaches applies to a radio group
/// and to NOTHING else. `RadioListTile` is generic, so the walk matches on the
/// runtime type's NAME rather than on `is RadioListTile<T>` for a `T` this file
/// would have to guess.
bool _isUnderARadioTile(Element e) {
  bool found = e.widget.runtimeType.toString().startsWith('RadioListTile');
  e.visitAncestorElements((Element a) {
    if (a.widget.runtimeType.toString().startsWith('RadioListTile')) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/// One screen's measurement.
class _Sweep {
  _Sweep(this.orbit, this.controls, this.dead);

  /// The nodes `Tab` actually visited, in the order it visited them.
  final List<FocusNode> orbit;

  /// Every interactive control found on the screen (see the header's candidate
  /// set), outermost-of-nest.
  final List<Element> controls;

  /// The subset of [controls] no orbit node covers — the keyboard-dead ones.
  final List<Element> dead;

  List<String> get deadLabels => dead.map(_label).toList();
}

/// Presses Tab from a cold start and records where focus goes.
///
/// 🔴 NO SEED NODE IS CHOSEN BY HAND. The first Tab is pressed with nothing
/// focused, which is what `FocusTraversalPolicy` treats as "start at the
/// beginning" — so orbit[0] IS the screen's first element as the framework
/// defines it, not as this test would like to define it. Hand-picking a seed
/// would make the reading-order case below assert an order this file had
/// already chosen.
///
/// The loop stops the moment focus lands on a node it has already seen. WHICH
/// node it lands on is the entire no-trap question and is asserted separately;
/// this function only records.
Future<_Sweep> _sweep(WidgetTester tester, Widget screen) async {
  await pumpAt(tester, kKeyboardSurface, screen);
  tester.binding.focusManager.primaryFocus?.unfocus();
  await tester.pump();

  final List<FocusNode> orbit = <FocusNode>[];
  // The bound is the whole-screen control count with headroom, not a guess at
  // the orbit length: a traversal that never repeats would otherwise spin here
  // rather than fail, and a hung test reads as infrastructure trouble.
  for (int i = 0; i < 200; i++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final FocusNode? pf = tester.binding.focusManager.primaryFocus;
    if (pf == null || orbit.any((FocusNode n) => identical(n, pf))) break;
    orbit.add(pf);
  }

  final List<Element> candidates = <Element>[
    for (final Element e in find.byType(GestureDetector).evaluate())
      if ((e.widget as GestureDetector).onTap != null) e,
    for (final Element e in find.byType(InkWell).evaluate())
      if ((e.widget as InkWell).onTap != null) e,
    ...find.byType(EditableText).evaluate(),
  ];
  final List<Element> controls = candidates
      .where(
        (Element e) =>
            !candidates.any((Element o) => !identical(o, e) && _isUnder(e, o)),
      )
      .toList();

  final List<Element> dead = controls
      .where(
        (Element e) => !orbit.any(
          (FocusNode n) =>
              _isUnder(e, n.context as Element?) ||
              _isUnder(n.context as Element?, e),
        ),
      )
      .toList();

  return _Sweep(orbit, controls, dead);
}

/// The completeness precondition every count in this file rests on. See the
/// header: a culled control is invisible to the sweep, so a scrolling screen
/// would under-report and never say so.
void _everythingIsLaidOut(WidgetTester tester, String screen) {
  for (final Element e in find.byType(Scrollable).evaluate()) {
    final ScrollableState s = (e as StatefulElement).state as ScrollableState;
    expect(
      s.position.maxScrollExtent,
      0.0,
      reason:
          '$screen scrolls at ${kKeyboardSurface.width}x'
          '${kKeyboardSurface.height}, so its off-screen controls were culled '
          'and every count in this group is about the viewport rather than '
          'about the screen. Raise the surface height until this passes; do '
          'NOT relax this assertion',
    );
  }
}

/// Reading order for a pair of focus rects, with no invented tolerance.
///
/// Two controls are on the SAME visual row iff their rects overlap vertically —
/// which is a fact about the rects, where "within N pixels of each other" would
/// have been a number with no source. Same row: left must not go backwards.
/// Different rows: top must not go backwards.
bool _followsInReadingOrder(Rect a, Rect b) {
  final bool sameRow = b.top < a.bottom && a.top < b.bottom;
  return sameRow ? b.left >= a.left : b.top >= a.top;
}

void main() {
  /// The four cases every screen gets, in the order they must be read: the
  /// inventory is complete, the traversal closes, it retraces, and it runs down
  /// the page.
  void traversalGroup(String name, Widget Function() build) {
    group('$name · keyboard traversal', () {
      testWidgets('the sweep sees the whole screen', (
        WidgetTester tester,
      ) async {
        await _sweep(tester, build());
        _everythingIsLaidOut(tester, name);
      });

      testWidgets('Tab closes a cycle back onto the first element', (
        WidgetTester tester,
      ) async {
        final _Sweep s = await _sweep(tester, build());
        expect(
          s.orbit,
          isNotEmpty,
          reason:
              'pressing Tab on $name focused nothing at all — the screen is '
              'entirely keyboard-inoperable, which is SC 2.1.1 failed outright '
              'rather than partially',
        );
        // Re-walk the cycle by hand: the sweep stopped ON the repeat, so this
        // is the one press it did not record, and WHICH node it lands on is the
        // difference between a closed cycle and a lasso — a traversal that runs
        // into a sub-loop it cannot leave is a focus trap even though every
        // node in that sub-loop is reachable from every other.
        s.orbit.first.requestFocus();
        await tester.pump();
        for (int i = 0; i < s.orbit.length; i++) {
          await tester.sendKeyEvent(LogicalKeyboardKey.tab);
          await tester.pump();
        }
        expect(
          identical(tester.binding.focusManager.primaryFocus, s.orbit.first),
          isTrue,
          reason:
              '${s.orbit.length} Tab presses from the first element of $name '
              'did not come back to it. Focus entered a sub-cycle it cannot '
              'leave — a keyboard trap (SC 2.1.2), reached from the very first '
              'Tab press',
        );
      });

      testWidgets('Shift-Tab retraces the same cycle backwards', (
        WidgetTester tester,
      ) async {
        final _Sweep s = await _sweep(tester, build());
        s.orbit.first.requestFocus();
        await tester.pump();
        // One press MORE than the orbit is long: the extra one proves the
        // reverse cycle WRAPS rather than stopping dead at the first element,
        // which is the backwards half of the trap question.
        //
        // ⚠️ `shiftLeft`, NOT `shift`. `LogicalKeyboardKey.shift` is a SYNONYM
        // key; sending it down leaves `HardwareKeyboard.isShiftPressed` false,
        // so `WidgetsApp`'s `SingleActivator(tab, shift: true)` never matches
        // and every press below reads as a plain forward Tab. Measured
        // 2026-08-21 — with `shift` the reverse walk returned the FORWARD
        // order and this case failed pointing at the app instead of at itself.
        for (int i = 0; i <= s.orbit.length; i++) {
          await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
          await tester.sendKeyEvent(LogicalKeyboardKey.tab);
          await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
          await tester.pump();
          final FocusNode want =
              s.orbit[s.orbit.length - 1 - (i % s.orbit.length)];
          expect(
            identical(tester.binding.focusManager.primaryFocus, want),
            isTrue,
            reason:
                'Shift-Tab #${i + 1} on $name left focus somewhere other than '
                'the forward orbit reversed. A control reachable going one way '
                'and not the other is a one-way trap: the user gets in and '
                'cannot back out',
          );
        }
      });

      testWidgets('focus order follows visual order', (
        WidgetTester tester,
      ) async {
        final _Sweep s = await _sweep(tester, build());
        for (int i = 0; i + 1 < s.orbit.length; i++) {
          final Rect a = s.orbit[i].rect;
          final Rect b = s.orbit[i + 1].rect;
          expect(
            _followsInReadingOrder(a, b),
            isTrue,
            reason:
                'on $name, Tab goes from '
                '${_label(s.orbit[i].context! as Element)} at ${a.topLeft} to '
                '${_label(s.orbit[i + 1].context! as Element)} at ${b.topLeft} '
                '— backwards up the page, or leftwards along a row. SC 2.4.3 '
                'asks focus order to preserve meaning, and the meaning of a '
                'form is the order it is read in',
          );
        }
      });
    });
  }

  traversalGroup('login', () => const LoginScreen());
  traversalGroup('settings', () => const SettingsScreen());
  traversalGroup('home', () => const HomeScreen());

  // ───────────────────────────────────────────────────────────────────────────
  // THE INVENTORY. Read the header's "WHAT THE SWEEP FOUND" before changing a
  // number here: these are PINS ON A FAILING STATE, and each is meant to go red
  // when the failure is FIXED as loudly as when it is widened.
  // ───────────────────────────────────────────────────────────────────────────
  group('SC 2.1.1 · which controls a keyboard can and cannot reach', () {
    Future<_Sweep> pin(
      WidgetTester tester,
      String name,
      Widget screen, {
      required int controls,
      required int reachable,
    }) async {
      final _Sweep s = await _sweep(tester, screen);
      _everythingIsLaidOut(tester, name);
      expect(
        s.controls.length,
        controls,
        reason:
            'the interactive-control inventory for $name moved. That is not a '
            'failure by itself — a screen may gain or lose a control — but the '
            'reachable/dead split below is meaningless until this number is '
            'reconciled, and the register cites it',
      );
      expect(
        s.controls.length - s.dead.length,
        reachable,
        reason:
            '$name: ${s.controls.length - s.dead.length} of '
            '${s.controls.length} controls are reachable by Tab, not '
            '$reachable. If this went UP, a keyboard-dead control was fixed — '
            'update this number, and update the SC 2.1.1 row in '
            'tooling/dod-register.json, which quotes it. Keyboard-dead today: '
            '${s.deadLabels}',
      );
      return s;
    }

    testWidgets('login · 8 of 8, registration included', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await pin(
        tester,
        'login',
        const LoginScreen(),
        controls: 8,
        reachable: 8,
      );
      // 🔴 THIS CASE USED TO ASSERT THE OPPOSITE, AND THE INVERSION IS THE
      // POINT. Until 2026-08-25 it read `expect(deadLabels.where(contains
      // 'Create account')).length, 1)` — a pin on the fact that a
      // keyboard-only user could NOT create an account, with a note saying that
      // if the toggle ever became reachable "this is the good failure". It
      // became reachable; this is that failure, taken.
      //
      // Kept as its own assertion rather than folded into `reachable: 8`
      // because the count does not convey WHICH control. `8 of 8` would also be
      // satisfied by deleting the sign-up toggle and fixing the seven that
      // remain — and deleting the only route to registration is not a fix.
      expect(
        s.deadLabels,
        isEmpty,
        reason:
            'login keyboard-dead controls: ${s.deadLabels}. The screen every '
            'signed-out visitor is routed to must have NO control a keyboard '
            'cannot reach — login_screen.dart records the sign-up toggle as '
            'the only control that reaches registration from it',
      );
    });

    // ⚠️ REACHABLE IS NOT OPERABLE, AND THIS IS THE CONTROL WHERE THE
    // DIFFERENCE COSTS AN ACCOUNT. The case below drives the worst single
    // instance end to end: Tab to the sign-up toggle, press Enter, and read the
    // form's own copy to prove it actually flipped into registration. A toggle
    // that takes focus and ignores Enter would satisfy every count in this file
    // and still leave a keyboard-only user unable to register.
    testWidgets('Enter on the sign-up toggle really opens registration', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweep(tester, const LoginScreen());
      final FocusNode toggle = s.orbit.firstWhere(
        (FocusNode n) =>
            _label(n.context! as Element).contains('Create account'),
        orElse: () => throw StateError(
          'the sign-up toggle is not in the login Tab orbit at all. Orbit: '
          '${s.orbit.map((FocusNode n) => _label(n.context! as Element))}',
        ),
      );
      toggle.requestFocus();
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      // ⚠️ THE EXPECTED STRING IS READ OUT OF THE APP'S OWN
      // LOCALISATIONS, NOT TYPED. The header's rule is that no assertion in
      // this file compares a localised value, so an .arb edit cannot turn it
      // red; `l10n.haveAccountPrompt` honours that — it is the same lookup the
      // widget does, so the two move together by construction.
      final AppLocalizations l10n = AppLocalizations.of(
        tester.element(find.byType(LoginScreen)),
      );
      expect(
        find.text(l10n.haveAccountPrompt),
        findsOneWidget,
        reason:
            'Enter on the focused sign-up toggle must flip the form into '
            'registration — the prompt swaps from newHerePrompt to '
            'haveAccountPrompt. Focus without activation is a control a '
            'keyboard can look at and not use',
      );
    });

    testWidgets('settings · 25 of 27, and the 2 are a radio group', (
      WidgetTester tester,
    ) async {
      // WAS 9 of 27 on 2026-08-21. The sixteen that moved are the four currency
      // chips, the four `_Toggle` switches, five wired `_LinkRow`s and the three
      // `PoweredByNikatru` legal links — every one of them a hand-rolled
      // `Semantics` + `GestureDetector` pair, and every one now a
      // `FocusableTap`. The two `_LinkRow`s that stay OUT of the orbit are the
      // ones with no `onTap` ("Connected accounts", "Export data (CSV)"): they
      // were never in the 27 either, because the inventory counts
      // `GestureDetector(onTap:)`.
      //
      // The remaining 2 are the `en` and `ta` radios — see the 2026-08-25 block
      // in the header, and [_arrowReachesWithinTheRadioGroup] below, which is
      // where their keyboard operability is actually asserted.
      final _Sweep s = await pin(
        tester,
        'settings',
        const SettingsScreen(),
        controls: 27,
        reachable: 25,
      );
      expect(
        s.dead.length,
        2,
        reason:
            'settings controls outside the Tab orbit: ${s.deadLabels}. EXACTLY '
            'two are expected and both must be RadioListTiles inside the '
            'language RadioGroup, which is a single Tab stop by design. A '
            'third would be a real regression wearing the same shape',
      );
      for (final Element e in s.dead) {
        expect(
          _isUnderARadioTile(e),
          isTrue,
          reason:
              '"${_label(e)}" is outside the Tab orbit and is NOT a '
              '`RadioListTile`. The radio-group exemption applies to radio '
              'groups and to nothing else — any other widget that leaves the '
              'orbit is SC 2.1.1 failing again, and must not inherit this '
              "case's tolerance",
        );
      }
    });

    // 🔴 THE ONE PLACE THIS FILE ASSERTS OPERABILITY BY A KEY THAT IS NOT
    // TAB, AND WHY THAT IS NOT A LOOSENED MATCHER.
    //
    // A `RadioGroup` collects ONE Tab stop and moves within itself on the arrow
    // keys — the behaviour every platform's radio group has, and the reason
    // SC 2.1.1's text says "operable through a keyboard interface" rather than
    // "reachable by Tab". The 2026-08-21 sweep, which presses only Tab, counted
    // the two non-focused tiles as keyboard-dead. They are not.
    //
    // ⚠️ THE WHOLE ORBIT, NOT THE FIRST STEP — CORRECTED 2026-08-25, AND THE
    // COMMENT THAT STOOD HERE UNTIL TODAY WAS DISPROVABLE BY READING THE LOOP
    // BELOW IT. It said the count was pinned at EXACTLY 1 rather than
    // `isNotEmpty` because "a 'one or more' matcher would let a group that
    // stopped responding at the second tile pass for the same reason a working
    // one does". That justification was FALSE IN BOTH HALVES. The old loop
    // re-focused its start node before EVERY ArrowDown and so never pressed a
    // second one, and MEASURED 2026-08-25 exactly ONE orbit node of the 25 sits
    // inside the `RadioGroup` (orbit[3]) while the other 24 land ArrowDown on a
    // node the orbit already covers — so `reached` could not structurally
    // exceed 1 and `== 1` and `isNotEmpty` were THE SAME ASSERTION. Worse, a
    // group that stopped at the second tile still scores 1, so the strict
    // matcher did not catch the very failure it was defended by, and the `ta`
    // tile's operability was asserted NOWHERE.
    //
    // What is asserted now is the FULL orbit from the group's single Tab stop:
    // three ArrowDowns must visit BOTH skipped tiles, once each, and the third
    // must return focus to the Tab stop it started from. That is what evidences
    // every member of the group rather than the first, and it is STRICTLY
    // STRONGER than what it replaces — negative-tested 2026-08-25 in a scratch
    // mirror, never the checkout: `ExcludeFocus` round the `ta` tile alone
    // leaves the old `reached == 1` GREEN and turns this case RED.
    //
    // 🔴 IDENTITY, NEVER LABELS. Every assertion below compares ELEMENTS via
    // [_isUnder]; `_label` appears only inside `reason:` strings. The header's
    // rule holds — an .arb edit cannot turn this file red.
    testWidgets('ArrowDown walks the whole language radio group', (
      WidgetTester tester,
    ) async {
      final _Sweep s = await _sweep(tester, const SettingsScreen());

      // The group is ONE Tab stop BY DESIGN, and every count below depends on
      // that being true rather than assumed: if a second orbit node ever lands
      // inside a radio tile, "three ArrowDowns is the whole orbit" stops being
      // the right walk and this case must say so instead of quietly measuring
      // the wrong thing.
      final List<FocusNode> inGroup = s.orbit
          .where((FocusNode n) => _isUnderARadioTile(n.context! as Element))
          .toList();
      expect(
        inGroup.length,
        1,
        reason:
            'the language RadioGroup must contribute EXACTLY ONE node to the '
            'settings Tab orbit — that is the whole reason the ${s.dead.length} '
            'tiles Tab skips are tolerated. Orbit nodes found inside a radio '
            'tile: ${inGroup.map((FocusNode n) => _label(n.context! as Element)).toList()}',
      );

      final Element stop = inGroup.single.context! as Element;
      inGroup.single.requestFocus();
      await tester.pump();

      // One press per member: 2 skipped tiles + the wrap back onto the Tab
      // stop. NOT a bounded search — the length is the group's size, so a
      // fourth tile added without a fourth press would fail the coverage
      // assertion below rather than pass unnoticed.
      final List<Element?> walk = <Element?>[];
      for (int i = 0; i < s.dead.length + 1; i++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
        await tester.pump();
        walk.add(tester.binding.focusManager.primaryFocus?.context as Element?);
      }

      for (final Element tile in s.dead) {
        expect(
          walk
              .where((Element? l) => _isUnder(tile, l) || _isUnder(l, tile))
              .length,
          1,
          reason:
              '"${_label(tile)}" is skipped by Tab, so ArrowDown is the ONLY '
              'key that can reach it and this walk is the only place it is '
              'evidenced. Walking ${s.dead.length + 1} steps from the group\'s '
              'Tab stop must land on it EXACTLY once. Landed on: '
              '${walk.map((Element? l) => l == null ? "<focus lost>" : _label(l)).toList()}. '
              'Skipped tiles: ${s.deadLabels}',
        );
      }

      expect(
        _isUnder(stop, walk.last) || _isUnder(walk.last, stop),
        isTrue,
        reason:
            'the ${s.dead.length + 1}th ArrowDown must bring focus back to the '
            "group's own Tab stop — a radio group cycles, and a walk that ran "
            'off the end into the rest of the screen would have visited both '
            'tiles above and still not be a radio group. Landed on: '
            '${walk.last == null ? "<focus lost>" : _label(walk.last!)}',
      );
    });

    testWidgets('home · 20 of 20', (WidgetTester tester) async {
      // WAS 17 of 20. Home's subscription rows were always `InkWell`s, so they
      // traversed for free; the three that did not were the app-bar actions —
      // notifications, account/settings, calendar — i.e. every route OUT of
      // this screen. A keyboard-only user could read the list and leave by no
      // door on it. All three are `FocusableTap`s now.
      final _Sweep s = await pin(
        tester,
        'home',
        const HomeScreen(),
        controls: 20,
        reachable: 20,
      );
      expect(
        s.deadLabels,
        isEmpty,
        reason: 'home keyboard-dead controls: ${s.deadLabels}',
      );
    });

    // ⚠️ NO FOURTH CASE SUMMING THE THREE. It was written, and it was deleted:
    // 55 / 30 / 25 is the ARITHMETIC of the three pins above (8+27+20,
    // 4+9+17), so a total can only fail where a part already has — an
    // assertion that cannot fail on its own, which this repo treats as worse
    // than none. It also could not be written honestly here: pumping three
    // screens inside one `testWidgets` disposes each tree with the previous
    // screen's riverpod scheduler timer still pending, and flutter_test fails
    // the case on `!timersPending` rather than on anything about a keyboard.
    // The register quotes the three rows, not the sum.
  });

  // ───────────────────────────────────────────────────────────────────────────
  // REACHABLE IS NOT OPERABLE. The register's guard says "reachable AND
  // activatable", and the two come apart: a node can take focus and still do
  // nothing on Enter. Asserted on ONE control rather than swept, because
  // activating an arbitrary control navigates, and `pumpAt` hosts no router —
  // a `context.go` from a settings row throws "no GoRouter found in context",
  // which reads as a keyboard failure and is not one. Login's submit is the
  // right single case: its empty-field guard answers IN PLACE, with a snackbar
  // and no navigation.
  // ───────────────────────────────────────────────────────────────────────────
  testWidgets('Enter on the focused sign-in button submits the form', (
    WidgetTester tester,
  ) async {
    final _Sweep s = await _sweep(tester, const LoginScreen());
    // ⚠️ `orbit.last` UNTIL 2026-08-25, AND THAT WAS ONLY EVER TRUE BY
    // ACCIDENT. The sign-in button was last in the orbit because everything
    // BELOW it on the screen — the sign-up toggle and the three legal links —
    // was keyboard-dead; fixing them moved four nodes in behind it and this
    // case started pressing Enter on "Refund". A test whose subject is chosen
    // by position depends on the defect it is meant to outlive, so the button
    // is now found by the key the screen gives it.
    //
    // The SAME containment relation the sweep itself uses, in both directions:
    // `GradientButton` carries the key and builds its focus node BENEATH
    // itself, so `find.descendant` from the focus element would find nothing
    // and a one-directional test would report the button missing.
    final Element submit = tester.element(find.byKey(E2EKeys.loginSubmit));
    final FocusNode signIn = s.orbit.firstWhere(
      (FocusNode n) =>
          _isUnder(submit, n.context as Element?) ||
          _isUnder(n.context as Element?, submit),
      orElse: () => throw StateError(
        'the sign-in button is not in the login Tab orbit. Orbit: '
        '${s.orbit.map((FocusNode n) => _label(n.context! as Element))}',
      ),
    );
    signIn.requestFocus();
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    final AppLocalizations l10n = AppLocalizations.of(
      tester.element(find.byType(LoginScreen)),
    );
    expect(
      find.text(l10n.authEnterBoth),
      findsOneWidget,
      reason:
          'Enter on the focused sign-in button must reach `_submit` — which, '
          'with both fields empty, answers with authEnterBoth. A button that '
          'accepts focus and ignores Enter is reachable and inoperable, and '
          'only this half can tell them apart',
    );
  });
}
