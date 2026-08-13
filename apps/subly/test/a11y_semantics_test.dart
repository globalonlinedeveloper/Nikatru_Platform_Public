// ─────────────────────────────────────────────────────────────────────────────
// P5·A11Y — WHAT A SCREEN READER IS ACTUALLY HANDED.
//
// 🔴 THE BASELINE THIS FILE REPLACES, MEASURED BEFORE ANY OF IT WAS WRITTEN:
// 4 `Semantics(` wrappers and 1 `Tooltip` across 55 Dart files, ZERO
// `semanticsLabel` anywhere, and ZERO `IconButton`s — every control in the app
// is a hand-rolled `GestureDetector` or `InkWell` (23 of them). That combination
// is the defect: `IconButton` and `ButtonStyleButton` bring their own semantics,
// and NOTHING ELSE DOES. An `InkWell` contributes a tap ACTION and no `isButton`
// flag, so the app's commonest control — a subscription row — announced as prose
// you happen to be able to double-tap, and a `CustomPaint` contributes nothing
// at all, so the donut, the budget arc and the scan ring were silent holes where
// the app's only real figures live.
//
// ── WHY THE ASSERTIONS WALK THE SEMANTICS TREE ───────────────────────────────
// `find.bySemanticsLabel` reads `renderObject.debugSemantics`, i.e. the node a
// PARTICULAR render object owns. Whether a given `Semantics` widget owns a node
// or is absorbed into an ancestor's is a property of Flutter's fragment
// compiler, not of this app: an annotation with no conflicting sibling merges
// upward and its render object then has no node of its own. So a
// `find.bySemanticsLabel` assertion can go red for a reason that has nothing to
// do with what a user hears, and — worse in the other direction — can go GREEN
// while the label is stranded on a node the reader reaches separately from the
// control it belongs to.
//
// [announced] therefore collects every label in the COMPILED tree, which is the
// thing a screen reader traverses. The same walk is what makes [_Naked] below
// expressible at all.
//
// ── THE SWEEP IS THE HALF THAT CATCHES WHAT NOBODY THOUGHT OF ────────────────
// The per-screen cases below name controls somebody already looked at. The
// "nothing is naked" case asks the opposite question — is there ANY node on this
// screen a user can activate that announces no role or no name — and it is the
// only limb here that can fail on a control added tomorrow. It found two while
// it was being written: the calendar's renewal rows (a hand-rolled twin of
// `RowCard` that never inherited the fix) and the shell's FAB (whose `Tooltip`
// filled the `tooltip` slot and left `isButton` unset).
//
// ⚠️ `tester.ensureSemantics()` IS RELEASED IN A `finally`, NEVER IN
// `addTearDown`. flutter_test verifies that no SemanticsHandle outlives the test
// BEFORE tear-downs run, so a handle released in a tear-down reports as leaked
// and buries the real failure under a second, unrelated one. Same reasoning
// `chassis_properties_test.dart:1340` records. [semantically] is that
// try/finally, written once.
//
// ⚠️ AND THE MANUAL SCREEN-READER PASS IS DELIBERATELY NOT HERE. Driving
// TalkBack/VoiceOver/NVDA by hand is a recorded CUT (dod-register:134-141), not
// an omission: nothing in this file claims the app was heard, only that the
// tree it hands a reader is well formed.
// ─────────────────────────────────────────────────────────────────────────────
// `dart:ui` for the two tri-state enums `flagsCollection` reports with. They are
// NOT re-exported by `package:flutter/semantics.dart` (which exports only the
// two string-attribute classes from dart:ui), so the direct import is the only
// way to name them — `show`n narrowly because dart:ui also defines Color, and an
// unrestricted import would collide with material's.
import 'dart:ui' show CheckedState, Tristate;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:intl/date_symbols.dart' show DateSymbols;
import 'package:intl/intl.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show buildAppTheme;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/core/format/currency.dart';
import 'package:subly/core/format/sub_math.dart';
import 'package:subly/core/router.dart';
import 'package:subly/data/models/budget_info.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/seed/demo_data.dart';
import 'package:subly/features/add/add_subscription_sheet.dart';
import 'package:subly/features/auth/check_inbox_screen.dart';
import 'package:subly/features/auth/legal_consent_fields.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/auth/reaccept_terms_screen.dart';
import 'package:subly/features/auth/reset_password_screen.dart';
import 'package:subly/features/auth/sign_up_screen.dart';
import 'package:subly/features/auth/verify_email_screen.dart';
import 'package:subly/features/budget/budget_screen.dart';
import 'package:subly/features/calendar/calendar_screen.dart';
import 'package:subly/features/cancel/cancel_sheet.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/insights/insights_screen.dart';
import 'package:subly/features/monetization/manage_plan_screen.dart';
import 'package:subly/features/monetization/paywall_screen.dart';
import 'package:subly/features/notifications/notifications_screen.dart';
import 'package:subly/features/onboarding/onboarding_screen.dart';
import 'package:subly/features/scan/scan_screen.dart';
import 'package:subly/features/settings/settings_screen.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/money_providers.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/settings_controller.dart';
import 'package:subly/state/subscriptions_controller.dart';

import 'support/width_harness.dart';

// ─── the walk ────────────────────────────────────────────────────────────────

void _visit(SemanticsNode node, void Function(SemanticsNode) fn) {
  fn(node);
  node.visitChildren((SemanticsNode child) {
    _visit(child, fn);
    return true;
  });
}

/// Every node in the compiled semantics tree.
///
/// ⚠️ REACHED THROUGH `rootPipelineOwner` AND ITS CHILDREN, NOT THROUGH
/// `binding.pipelineOwner`. The latter is the obvious spelling and it is
/// DEPRECATED (after 3.10) precisely because it is no longer the owner that
/// produces frames: `WidgetsBinding.wrapWithDefaultView` attaches the real
/// render tree to an owner in the tree rooted at `rootPipelineOwner`, and a
/// binding may host several. Walking the owner tree is both non-deprecated —
/// which keeps this file inside the app's zero-new-analyzer-issues budget — and
/// correct for more than one view.
///
/// The `expect` is not decoration: a pump that produced no semantics at all —
/// a handle taken too late, a screen that never laid out — makes every
/// `contains` below false and every `every` below vacuously true, i.e. one limb
/// red for the wrong reason and the other green for no reason.
List<SemanticsNode> _nodes(WidgetTester tester) {
  final List<SemanticsNode> all = <SemanticsNode>[];
  void collect(PipelineOwner owner) {
    final SemanticsNode? root = owner.semanticsOwner?.rootSemanticsNode;
    if (root != null) {
      _visit(root, all.add);
    }
    owner.visitChildren(collect);
  }

  collect(tester.binding.rootPipelineOwner);
  expect(
    all,
    isNotEmpty,
    reason:
        'COVERAGE LOST — there is no semantics tree, so nothing below is '
        'looking at anything. Check that ensureSemantics() was taken before '
        'the pump.',
  );
  return all;
}

/// Every non-empty label a reader could hear on this screen.
List<String> announced(WidgetTester tester) => _nodes(tester)
    .map((SemanticsNode n) => n.getSemanticsData().label)
    .where((String l) => l.trim().isNotEmpty)
    .toList();

/// Everything reachable from [node] downward, as one string.
///
/// A control's name does not have to sit on the same node as its tap action —
/// Material's own buttons put the flag on a container and let the label merge in
/// — so "does this control announce a name" is a question about the subtree, not
/// about one node. Asking only about `node.label` would flag correct code.
String _spoken(SemanticsNode node) {
  final StringBuffer b = StringBuffer(node.getSemanticsData().label);
  node.visitChildren((SemanticsNode c) {
    b
      ..write(' ')
      ..write(_spoken(c));
    return true;
  });
  return b.toString().trim();
}

/// ⚠️ `flagsCollection`, NOT `hasFlag`. `SemanticsData.hasFlag` and the
/// `SemanticsFlag` bit constants were deprecated after 3.32, and this app's
/// analyze budget is ZERO NEW ISSUES — a new file that arrives with twenty
/// `deprecated_member_use` infos is a new file that makes the baseline unusable
/// as a comparison. The tri-state accessors are also more precise than the bits
/// they replace: `isEnabled` distinguishes "disabled" from "enablement does not
/// apply here", which the old `hasFlag(isEnabled)` could not.
extension on SemanticsData {
  bool get announcesButton => flagsCollection.isButton;
  bool get announcesLink => flagsCollection.isLink;
  bool get announcesSelected => flagsCollection.isSelected == Tristate.isTrue;

  /// Whether selection is a property this control HAS, in either state.
  ///
  /// The tri-state is the point: `none` means "selection does not apply to
  /// this", which is a different fact from "not selected" and is what
  /// distinguishes a nav tab from an ordinary link that happens to share its
  /// word.
  bool get announcesSelectedState =>
      flagsCollection.isSelected != Tristate.none;
  bool get announcesEnabled => flagsCollection.isEnabled == Tristate.isTrue;

  /// Any role that tells a reader "this responds to you".
  bool get announcesSomeRole =>
      flagsCollection.isButton ||
      flagsCollection.isLink ||
      flagsCollection.isTextField ||
      flagsCollection.isSlider ||
      flagsCollection.isChecked != CheckedState.none ||
      flagsCollection.isToggled != Tristate.none;
}

/// A node a user can activate that a user cannot identify.
class NakedControl {
  NakedControl(this.node);
  final SemanticsNode node;

  bool get missesRole => !node.getSemanticsData().announcesSomeRole;
  bool get missesName => _spoken(node).isEmpty;

  @override
  String toString() =>
      '«${_spoken(node)}»${missesRole ? " NO ROLE" : ""}'
      '${missesName ? " NO NAME" : ""}';
}

/// Every activatable node on the current screen that announces no role or no
/// name.
List<NakedControl> nakedControls(WidgetTester tester) => _nodes(tester)
    .where(
      (SemanticsNode n) => n.getSemanticsData().hasAction(SemanticsAction.tap),
    )
    .map(NakedControl.new)
    .where((NakedControl n) => n.missesRole || n.missesName)
    .toList();

/// Asserts the screen carries at least [floor] activatable nodes before
/// [nakedControls] is believed.
///
/// "Nothing is naked" is also true of a screen with nothing on it, and a
/// redirect that quietly lands somewhere empty looks exactly like a clean pass —
/// the vacuity `chassis_properties_test` records against its own sweeps.
void expectNothingNaked(WidgetTester tester, String screen, {int floor = 1}) {
  final int tappable = _nodes(tester)
      .where(
        (SemanticsNode n) =>
            n.getSemanticsData().hasAction(SemanticsAction.tap),
      )
      .length;
  expect(
    tappable,
    greaterThanOrEqualTo(floor),
    reason:
        'COVERAGE LOST — $screen offered only $tappable activatable node(s), '
        'below the $floor this screen is known to have. The sweep below then '
        'ranges over almost nothing and passes whatever the code does.',
  );
  final List<NakedControl> naked = nakedControls(tester);
  expect(
    naked,
    isEmpty,
    reason:
        '$screen carries ${naked.length} control(s) a user can activate but '
        'cannot identify. A tap action without isButton/isLink is announced as '
        'prose that happens to respond, and one with no name is announced as '
        'nothing at all:\n  ${naked.join('\n  ')}',
  );
}

// ─── the tap-target family's falsifier ───────────────────────────────────────

/// [androidTapTargetGuideline]'s traversal with a floor nothing can clear.
///
/// The SAME class, so the SAME skip rules — links, hidden nodes, merged nodes,
/// nodes with no tap action, targets clipped by a scrolling boundary — decide
/// what it visits. Only the threshold differs, which turns "did it pass" into
/// "what did it look at".
const AccessibilityGuideline _everyTapTargetIsTooSmall =
    MinimumTapTargetGuideline(
      size: Size(1000000, 1000000),
      link:
          'the falsifier for androidTapTargetGuideline — not a real guideline',
    );

/// How many nodes [androidTapTargetGuideline] ACTUALLY inspects on the screen
/// that is currently pumped.
///
/// [Evaluation] exposes no node list, so the count comes from its reason text —
/// `MinimumTapTargetGuideline` emits exactly one `expected tap target size` line
/// per node it measured and rejected, and at the floor above it rejects every
/// node it measures.
Future<int> tapTargetSubjects(WidgetTester tester) async {
  final Evaluation e = await _everyTapTargetIsTooSmall.evaluate(tester);
  return (e.reason ?? '')
      .split('\n')
      .where((String line) => line.contains('expected tap target size'))
      .length;
}

/// Positive proof the sweep beside this call ranged over something.
///
/// 🔴 THE WHOLE REASON THIS FAMILY IS NOT ONE LINE PER SCREEN. A guideline that
/// inspects nothing returns `Evaluation.pass()`, which is byte-identical to a
/// screen whose every control is the right size. Six of the nineteen surfaces
/// were in exactly that state while this increment was being written.
Future<void> expectGuidelineHadSubjects(
  WidgetTester tester,
  String screen,
) async {
  expect(
    await tapTargetSubjects(tester),
    greaterThanOrEqualTo(1),
    reason:
        'COVERAGE LOST — androidTapTargetGuideline inspected NOT ONE node on '
        '$screen, so the sweep beside this call passed over the empty set and '
        'reported the screen clean. Check the pump before believing anything '
        'below it: the guideline skips links, hidden and merged nodes, nodes '
        'with no tap action, and targets at a scroll or view boundary.',
  );
}

// ─── the contrast family's falsifier ─────────────────────────────────────────

/// [textContrastGuideline]'s traversal with a target ratio nothing can clear.
///
/// The SAME class, so the SAME skip rules — merged, invisible, hidden and
/// DISABLED nodes, route scopes, nodes whose label is empty, nodes whose text is
/// not `hitTestable`, elements whose paint bounds fall outside the view — decide
/// what it visits. Only [targetContrastRatio] differs, which turns "did it pass"
/// into "what did it look at". The maximum contrast ratio expressible is 21:1
/// (white on black), so this floor rejects every subject it is handed.
class _EveryTextFailsContrast extends MinimumTextContrastGuideline {
  const _EveryTextFailsContrast();

  @override
  double targetContrastRatio(double? fontSize, {required bool bold}) => 1000000;
}

/// How many text nodes [textContrastGuideline] ACTUALLY measures on the screen
/// that is currently pumped.
///
/// [Evaluation] exposes no node list, so the count comes from its reason text —
/// `MinimumTextContrastGuideline` emits exactly one `Expected contrast ratio of
/// at least` line per element it rasterised and rejected, and at the floor above
/// it rejects every element it rasterises.
///
/// ⚠️ THE COUNT IS OF (node, element) PAIRS THAT REACHED THE HISTOGRAM, WHICH IS
/// THE ONLY NUMBER WORTH HAVING. Four separate limbs inside
/// `_evaluateElement` return `Evaluation.pass()` BEFORE any colour is read — an
/// empty intersection between the node's rect and the render box's, a node the
/// view rect culls, and an empty colour histogram. A subject that leaves by one
/// of those doors is exactly the vacuous pass this helper exists to expose, and
/// it does not appear in this count.
Future<int> contrastSubjects(WidgetTester tester) async {
  final Evaluation e = await const _EveryTextFailsContrast().evaluate(tester);
  return (e.reason ?? '')
      .split('\n')
      .where((String l) => l.contains('Expected contrast ratio of at least'))
      .length;
}

/// Positive proof the contrast sweep beside this call ranged over something.
///
/// 🔴 THE SAME REASON THE TAP-TARGET FAMILY HAS ONE, AND A SHARPER ONE. A
/// guideline that inspects nothing returns `Evaluation.pass()`, byte-identical
/// to a screen whose every string is legible — and this family is MORE exposed
/// to that than the tap-target one, because `MinimumTextContrastGuideline` culls
/// against `view.physicalSize` too (`isNodeOffScreen`, accessibility.dart:483).
/// That is the stale-`physicalSize` defect [sizeSurface] was written for,
/// pointed at a second family: without [sizeSurface] every string below 600
/// logical pixels on an 812-tall phone would be culled and the sweep would
/// report the screen clean having read nothing off it.
Future<void> expectContrastHadSubjects(
  WidgetTester tester,
  String screen,
) async {
  expect(
    await contrastSubjects(tester),
    greaterThanOrEqualTo(1),
    reason:
        'COVERAGE LOST — the text-contrast guideline measured NOT ONE string on '
        '$screen, so the sweep beside this call passed over the empty set and '
        'reported the screen legible. Check the pump before believing anything '
        'below it: the guideline skips route scopes, merged/invisible/hidden '
        'and DISABLED nodes, labels that are not `hitTestable`, and anything '
        'whose paint bounds fall outside `view.physicalSize` — which is what '
        '[sizeSurface] exists to keep honest.',
  );
}

/// Whether WCAG **AAA** (7.0 normal / 4.5 large) would additionally hold here.
///
/// Reported, never asserted. The Definition of Done publishes **AA**, so AA is
/// what the sweeps below enforce; this is the measurement that lets each case
/// say in a comment what the stricter bar would do, without a second failing
/// gate for a level nothing has committed to. See the group header for why AAA
/// is not simply switched on globally.
Future<bool> meetsAAA(WidgetTester tester) async =>
    (await const MinimumTextContrastGuidelineAAA().evaluate(tester)).passed;

/// Refuses a screen whose text was measured against **NOTHING**.
///
/// 🔴🔴 THE DEFECT THIS INCREMENT ACTUALLY FOUND, AND IT IS THE VACUOUS-PASS
/// SHAPE INVERTED — a CONFIDENT WRONG NUMBER RATHER THAN A SILENT PASS.
/// `_ContrastReport` builds its histogram from the rasterised layer and then
/// calls `Color.computeLuminance()`, WHICH IGNORES ALPHA. A fully transparent
/// pixel is therefore scored as PURE BLACK, luminance 0.
///
/// Five of Subly's surfaces — insights, budget, calendar, settings, home — are
/// the AppShell's branch panes and DECLARE NO `Scaffold` OF THEIR OWN
/// (`insights_screen.dart` contains the string `Scaffold` only inside two
/// comments). In the app they are the `body:` of the one `AppScaffold` builds
/// (`app_scaffold.dart:198`), which is what paints `scaffoldBackgroundColor`.
/// Pumped standalone the way every case in this file pumps them, they paint
/// their text onto TRANSPARENCY.
///
/// MEASURED on the first run of this family: 74 nodes were scored against
/// `dark - Color(alpha: 0.0000, …)`, and the numbers were not noise —
/// insights' 26px "Insights" heading, whose real contrast is
/// `onSurface`/`surface` = 16.29:1, was reported at **1.15:1** and FAILED. The
/// app's most legible text, reported as its worst, by a check that had just
/// been written to find exactly that.
///
/// 📌 THE OTHER TWO FAMILIES COULD NOT HAVE CAUGHT THIS AND NEVER WILL: the
/// semantics walk and `MinimumTapTargetGuideline` read the tree and the
/// geometry, never a pixel, so a missing background costs them nothing. The
/// first family that reads pixels inherits every rig shortcut the others could
/// afford. Hence [pumpScreen]'s `paintBackground:`, and hence this assertion —
/// which fails BY NAME rather than as an unreadable ratio.
Future<void> expectOpaqueGround(WidgetTester tester, String screen) async {
  final Evaluation e = await const _EveryTextFailsContrast().evaluate(tester);
  final List<String> transparent = (e.reason ?? '')
      .split('\n')
      .where(
        (String l) => l.startsWith('light - ') && l.contains('alpha: 0.0000'),
      )
      .toList();
  expect(
    transparent,
    isEmpty,
    reason:
        'COVERAGE LOST — ${transparent.length} string(s) on $screen were scored '
        'against a TRANSPARENT ground, and `Color.computeLuminance()` ignores '
        'alpha, so the guideline compared them to PURE BLACK. Every ratio below '
        'is fiction. The pump is missing whatever paints this surface in the '
        'real app — the five AppShell branch panes declare no Scaffold and get '
        'their background from `AppScaffold`. Pass `paintBackground: true` to '
        '[pumpScreen]; do NOT relax the sweep.\n  ${transparent.join('\n  ')}',
  );
}

// ─── hosts ───────────────────────────────────────────────────────────────────

/// Pins BOTH the render surface and the view it is supposed to be a view of.
///
/// 🔴 `setSurfaceSize` ALONE LEAVES `FlutterView.physicalSize` AT FLUTTER_TEST'S
/// DEFAULT 800×600, AND THAT IS NOT A COSMETIC DISAGREEMENT — IT SILENTLY
/// AMPUTATED THE TAP-TARGET SWEEP. `setSurfaceSize` moves the size the render
/// view LAYS OUT to; it does not touch the size the view REPORTS. Every case in
/// this file laid out at 375×812 while `tester.view.physicalSize` still said
/// 2400×1800 physical (= 800×600 at dpr 3).
///
/// Nothing noticed for as long as every assertion here walked the semantics tree
/// itself, because the walk never reads the view. `MinimumTapTargetGuideline`
/// does: it skips any node whose paint bounds touch `Offset.zero &
/// view.physicalSize`, on the entirely sound grounds that a target hanging off
/// the edge has less area than its rect claims. Against a stale 800×600 rect
/// that rule fires on EVERYTHING BELOW 600 LOGICAL PIXELS.
///
/// MEASURED before this function existed, with the guideline re-run at an
/// impossible floor so every node it actually inspects reports itself: scan's
/// only CTA, onboarding's Skip and Next, check-inbox's only way out,
/// reset-password's only way out and BOTH cancel-sheet buttons were inspected
/// ZERO times. Six of the nineteen surfaces handed the guideline nothing at all,
/// and it returned `Evaluation.pass()` for every one of them — the family would
/// have gone from ×0 to ×20 without a single one of those controls being
/// measured. That is the [ADR 048] defect reproduced in a new place: not a check
/// that fails, a check that never started.
Future<void> sizeSurface(WidgetTester tester, Size size) async {
  await tester.binding.setSurfaceSize(size);
  tester.view.physicalSize = size * tester.view.devicePixelRatio;
  addTearDown(() async {
    tester.view.resetPhysicalSize();
    await tester.binding.setSurfaceSize(null);
  });
}

/// [tester.ensureSemantics] with the release in a `finally` — see the header.
Future<void> semantically(
  WidgetTester tester,
  Future<void> Function() body,
) async {
  final SemanticsHandle handle = tester.ensureSemantics();
  try {
    await body();
  } finally {
    handle.dispose();
  }
}

/// The seed `app.dart:83` stamps this app with, spelled the way seven other
/// files under `apps/subly/test` already spell it.
///
/// ⚠️ IT IS A COPY, AND THE COPY IS ALREADY GUARDED SOMEWHERE ELSE —
/// `chassis_properties_test.dart:1106` pumps the REAL `SublyApp` and asserts its
/// `theme.colorScheme.primary` equals `buildAppTheme(seed: 0xFF6459F5)`'s. So
/// the day somebody re-seeds the app, that case goes red and this constant is
/// found by following it. Restating the pin here would be a second thing to rot.
const Color kSublySeed = Color(0xFF6459F5);

/// The theme the app SHIPS, at the brightness asked for.
///
/// 🔴 NOT COSMETIC, AND IT IS WHY THIS FILE GREW A `theme:` ARGUMENT AT ALL.
/// Every case in this file pumped a bare `MaterialApp` — i.e. Flutter's DEFAULT
/// `ThemeData`, a palette no Subly user has ever seen. That costs the semantic
/// sweeps nothing, because the semantics walk never reads a colour. It would
/// cost the contrast family everything: a contrast sweep run against the default
/// theme measures the framework's palette and reports a verdict about Subly's,
/// which is the live-verify defect this repo keeps recording — a green check
/// standing over the test double instead of the thing.
ThemeData appTheme({Brightness brightness = Brightness.light}) =>
    buildAppTheme(seed: kSublySeed, brightness: brightness);

/// [pumpAt]'s shape plus a locale, and it hands the container back.
///
/// The container is the point: every expected label below is built from the
/// SAME providers the screen read, so the assertion cannot drift from the data
/// the painter was given. Re-typing "₹2,340" here would pin the seed data, not
/// the label.
///
/// [paintBackground] paints `theme.scaffoldBackgroundColor` behind [screen] —
/// what `AppScaffold`'s own `Scaffold` paints behind the five AppShell branch
/// panes in the real app, and what those panes DO NOT paint for themselves. See
/// [expectOpaqueGround] for what happens to a pixel-reading sweep without it. It
/// is a `ColoredBox`, not a `Scaffold`, deliberately: it adds a paint and
/// changes NO layout, so a case that opts in is measuring the same geometry the
/// naked and tap-target cases measure on the same screen.
Future<ProviderContainer> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  Locale locale = const Locale('en'),
  Size size = kPhone,
  ThemeData? theme,
  bool paintBackground = false,
}) async {
  await sizeSurface(tester, size);
  final ProviderContainer c = ProviderContainer(
    overrides: defaultWidthOverrides(),
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        // `null` is `MaterialApp`'s own default, so every pre-existing caller
        // pumps the byte-identical tree it pumped before this argument existed.
        theme: theme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: paintBackground
            ? ColoredBox(
                color: (theme ?? ThemeData.light()).scaffoldBackgroundColor,
                child: screen,
              )
            : screen,
      ),
    ),
  );
  // The harness's loop, for the harness's reason: several provider futures
  // resolve in sequence and `pumpAndSettle` would both lie about the wait and
  // run scan's periodic timer to quiescence.
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return c;
}

/// One widget on a bare `MaterialApp` — for the shared primitives, which have no
/// providers and no locale of their own.
Future<void> pumpBare(WidgetTester tester, Widget child) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(body: Center(child: child)),
    ),
  );
  await tester.pump();
}

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

class _SignedInAuth extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser => const core.AuthUser(
    id: 'a11y',
    email: 'a11y@test.dev',
    emailVerified: true,
  );

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The WHOLE APP through its real router, pinned to a phone.
///
/// Not optional, and not tidiness: `StatefulNavigationShell` cannot be built
/// standalone, and `compactNavigationBar` is a seam `AppScaffold` reaches ONLY
/// in the compact window class — flutter_test's 800×600 default resolves to
/// `medium`, i.e. a RAIL, where the pill this file is about is not in the tree
/// at all. Same rig and same reasons as `dark_group_home_test.dart`'s.
Future<void> pumpShell(WidgetTester tester, {ThemeData? theme}) async {
  await sizeSurface(tester, kPhone);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      // This user has accepted the current terms. Stated, not defaulted: a
      // signed-in user with no acceptance on record is sent to /reaccept-terms
      // by the router, which is correct and is what every pre-clickwrap install
      // sees once. The gate itself is driven in legal_gates_test.dart.
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(_SignedInAuth()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        theme: theme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  expect(
    find.byType(AppShell),
    findsOneWidget,
    reason:
        'the router did not land on the shell, so nothing below is measuring '
        'the nav pill — check the redirect overrides, not the semantics',
  );
}

/// A bare host for the contrast FALSIFIERS below.
///
/// Deliberately not [pumpScreen]: a falsifier has to control every pixel inside
/// the text's paint bounds, and a real screen brings a Scaffold, an AppBar and a
/// theme's surface colour with it.
Future<void> pumpContrastFixture(WidgetTester tester, Widget child) async {
  await sizeSurface(tester, kPhone);
  await tester.pumpWidget(
    MaterialApp(
      theme: appTheme(),
      home: Scaffold(body: Center(child: child)),
    ),
  );
  await tester.pump();
}

Future<AppLocalizations> _load(String code) =>
    AppLocalizations.delegate.load(Locale(code));

/// The donut's expected sentence, composed from the same providers the screen
/// read. See [pumpScreen].
String expectedDonutLabel(ProviderContainer c, AppLocalizations l10n) {
  final List<Subscription> subs =
      c.read(subscriptionsControllerProvider).valueOrNull ??
      const <Subscription>[];
  final Currency currency = c.read(currencyProvider);
  final List<CategoryTotal> cats = SubMath.categoryTotals(subs);
  expect(
    cats.length,
    greaterThanOrEqualTo(2),
    reason:
        'COVERAGE LOST — the seed resolved to ${cats.length} category(ies), so '
        'the "per category" half of this label is empty or trivial and the '
        'assertion is about the prose only.',
  );
  return l10n.a11yCategoryDonut(
    currency.fmt0(SubMath.totalMonthly(subs)),
    <String>[
      for (final CategoryTotal cat in cats)
        l10n.a11yCategoryShare(cat.name, currency.fmt0(cat.value)),
    ].join(', '),
  );
}

/// The budget arc's expected sentence, from the same two providers the screen
/// reads.
String expectedRingLabel(ProviderContainer c, AppLocalizations l10n) {
  final List<Subscription> subs =
      c.read(subscriptionsControllerProvider).valueOrNull ??
      const <Subscription>[];
  final BudgetInfo? budget = c.read(budgetProvider).valueOrNull;
  expect(
    budget,
    isNotNull,
    reason:
        'COVERAGE LOST — budgetProvider had not resolved, so the screen was '
        'still its CircularProgressIndicator branch and there was no ring to '
        'describe. Check the pump count before believing any failure below.',
  );
  final Currency currency = c.read(currencyProvider);
  final double total = SubMath.totalMonthly(subs);
  final double budgetVal = budget!.monthlyBudget;
  final bool over = total > budgetVal;
  final String percent = NumberFormat.percentPattern(
    l10n.localeName,
  ).format(budgetVal <= 0 ? 0 : (total / budgetVal).clamp(0, 1));
  return over
      ? l10n.a11yBudgetRingOver(
          currency.fmt(total),
          currency.fmt0(budgetVal),
          percent,
        )
      : l10n.a11yBudgetRing(
          currency.fmt(total),
          currency.fmt0(budgetVal),
          percent,
        );
}

void main() {
  // ═══ THE SHARED PRIMITIVES ═════════════════════════════════════════════════
  // Asserted on their own rather than only through a screen: these four widgets
  // carry every list row, every CTA and every glyph in the app, so a regression
  // here is a regression everywhere, and a per-screen test would report it as
  // one screen's problem.
  group('the shared primitives announce what they are', () {
    testWidgets('GlyphTile with no label is DECORATIVE — the token is gone', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(tester, const GlyphTile(glyph: 'NF'));
        expect(
          announced(tester),
          isNot(contains('NF')),
          reason:
              'the two-letter mark is an abbreviation of the name that sits '
              'beside it on every screen, so announcing it makes every row '
              'open with a meaningless token',
        );
      });
    });

    testWidgets('GlyphTile with a label announces the label, NOT the glyph', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(
          tester,
          const GlyphTile(glyph: 'NF', semanticLabel: 'Netflix'),
        );
        expect(announced(tester), contains('Netflix'));
        expect(
          announced(tester),
          isNot(contains('NF')),
          reason:
              'excludeSemantics is what keeps the label from being read as '
              '"Netflix NF"',
        );
      });
    });

    testWidgets('a tappable RowCard is a BUTTON, and it is ONE node', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(
          tester,
          RowCard(
            title: 'Netflix',
            subtitle: const Text('Renews in 3 days'),
            trailing: const Text(r'$15.49'),
            onTap: () {},
          ),
        );
        final List<SemanticsNode> buttons = _nodes(tester)
            .where((SemanticsNode n) => n.getSemanticsData().announcesButton)
            .toList();
        expect(
          buttons,
          hasLength(1),
          reason:
              'InkWell gives a tap ACTION and no isButton flag — this is the '
              'app-wide defect the wrapper fixes',
        );
        // One node, all three fragments: unmerged this is four swipes to hear
        // one row.
        final String label = buttons.single.getSemanticsData().label;
        expect(label, contains('Netflix'));
        expect(label, contains('Renews in 3 days'));
        expect(label, contains(r'$15.49'));
      });
    });

    testWidgets('an INERT RowCard is not announced as a button', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(tester, const RowCard(title: 'Netflix'));
        expect(
          _nodes(
            tester,
          ).any((SemanticsNode n) => n.getSemanticsData().announcesButton),
          isFalse,
          reason:
              'announcing "button" for a row that does nothing when activated '
              'is the same lie one size down',
        );
        expect(announced(tester), contains('Netflix'));
      });
    });

    testWidgets('GradientButton is a button, and carries its enabled state', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(
          tester,
          GradientButton(label: 'Sign in', onPressed: () {}),
        );
        final SemanticsData live = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .firstWhere((SemanticsData d) => d.label.contains('Sign in'));
        expect(live.announcesButton, isTrue);
        expect(live.announcesEnabled, isTrue);

        // The disabled arm is real: scan holds `onPressed: null` for the whole
        // scan, and the add sheet while it saves.
        await pumpBare(tester, const GradientButton(label: 'Scanning…'));
        final SemanticsData dead = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .firstWhere((SemanticsData d) => d.label.contains('Scanning…'));
        expect(dead.announcesButton, isTrue);
        expect(
          dead.announcesEnabled,
          isFalse,
          reason:
              'a disabled control that still announces as actionable sends '
              'somebody tapping at nothing',
        );
      });
    });

    testWidgets('SoftButton is ALREADY a button — nothing here duplicates it', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(tester, SoftButton(label: 'Keep it', onPressed: () {}));
        final List<SemanticsNode> buttons = _nodes(tester)
            .where((SemanticsNode n) => n.getSemanticsData().announcesButton)
            .toList();
        expect(
          buttons,
          hasLength(1),
          reason:
              'SoftButton is an OutlinedButton, i.e. a ButtonStyleButton, which '
              'wraps itself in Semantics(button: true). A second wrapper in '
              'widgets.dart would nest a duplicate node inside Material own. '
              'This case is pointed at MATERIAL, so it goes red if that ever '
              'stops being true instead of the app going silent.',
        );
        expect(buttons.single.getSemanticsData().label, contains('Keep it'));
      });
    });

    testWidgets('the publisher legal links are LINKS, not buttons', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // Through `pumpScreen` rather than `pumpBare`: this widget reads the
        // arb for its three short link words, and `l10n.yaml` sets
        // `nullable-getter: false`, so a host without the delegates throws on
        // the first frame rather than falling back to English.
        await pumpScreen(
          tester,
          const Scaffold(body: Center(child: PoweredByNikatru())),
        );
        final AppLocalizations l10n = await _load('en');
        final List<SemanticsData> links = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.announcesLink)
            .toList();
        expect(
          links.map((SemanticsData d) => d.label),
          containsAll(<String>[
            l10n.linkPrivacyShort,
            l10n.linkTermsShort,
            l10n.linkRefundShort,
          ]),
          reason:
              'these three hand the URL to the platform browser. A reader '
              'announcing "link" rather than "button" is what warns somebody '
              'they are about to leave the app, which is the one thing they '
              'want to know before activating something on a phone.',
        );
        expect(
          links.any((SemanticsData d) => d.announcesButton),
          isFalse,
          reason:
              'a link that also claims to be a button says both and means '
              'neither',
        );
      });
    });

    testWidgets('Pill is read but is NOT announced as a control', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpBare(
          tester,
          const Pill(
            r'$42.00/mo',
            bg: Color(0xFFEEEEEE),
            fg: Color(0xFF000000),
          ),
        );
        expect(announced(tester), contains(r'$42.00/mo'));
        expect(
          _nodes(
            tester,
          ).any((SemanticsNode n) => n.getSemanticsData().announcesButton),
          isFalse,
          reason:
              'a status chip has no onTap; a button flag here would announce a '
              'control that does not exist',
        );
      });
    });
  });

  // ═══ TIER 1 · INSIGHTS ═════════════════════════════════════════════════════
  group('insights · the donut says what it draws', () {
    testWidgets('[en] the chart announces the total AND every category', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final ProviderContainer c = await pumpScreen(
          tester,
          const InsightsScreen(),
        );
        final AppLocalizations l10n = await _load('en');
        expect(
          announced(tester),
          contains(expectedDonutLabel(c, l10n)),
          reason:
              'a CustomPaint contributes NOTHING to semantics, so without this '
              'wrapper the only chart in the app is a 126x126 silent hole',
        );
      });
    });

    testWidgets('[ta] the same sentence, in Tamil', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final ProviderContainer c = await pumpScreen(
          tester,
          const InsightsScreen(),
          locale: const Locale('ta'),
        );
        final AppLocalizations ta = await _load('ta');
        final AppLocalizations en = await _load('en');
        expect(announced(tester), contains(expectedDonutLabel(c, ta)));
        // THE FALSIFIER. Every figure in the sentence is locale-independent, so
        // an implementation that hardcoded the English prose would pass the
        // positive case on the numbers alone.
        expect(
          announced(tester),
          isNot(contains(expectedDonutLabel(c, en))),
          reason: 'the English chart description survived into a Tamil build',
        );
      });
    });

    testWidgets('nothing on insights is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const InsightsScreen());
        expectNothingNaked(tester, 'insights');
      });
    });
  });

  // ═══ TIER 1 · BUDGET ═══════════════════════════════════════════════════════
  group('budget · the arc says spent-of-budget', () {
    testWidgets('[en] the ring announces both figures, not just the percent', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final ProviderContainer c = await pumpScreen(
          tester,
          const BudgetScreen(),
        );
        final AppLocalizations l10n = await _load('en');
        expect(
          announced(tester),
          contains(expectedRingLabel(c, l10n)),
          reason:
              'the visible percent is CLAMPED to 100%, so a user well over '
              'budget hears a figure that is also true of being exactly on it. '
              'The spent/budget pair is the part that cannot be clamped.',
        );
      });
    });

    testWidgets('[ta] the same sentence, in Tamil', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final ProviderContainer c = await pumpScreen(
          tester,
          const BudgetScreen(),
          locale: const Locale('ta'),
        );
        expect(
          announced(tester),
          contains(expectedRingLabel(c, await _load('ta'))),
        );
        expect(
          announced(tester),
          isNot(contains(expectedRingLabel(c, await _load('en')))),
          reason: 'the English ring description survived into a Tamil build',
        );
      });
    });

    testWidgets('nothing on budget is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const BudgetScreen());
        // The floor is 0 and stated: budget is the one Tier-1 screen with no
        // control on it at all — it is a report. Passing 1 here would be a
        // requirement invented by the test.
        expect(nakedControls(tester), isEmpty);
      });
    });
  });

  // ═══ TIER 1 · SCAN ═════════════════════════════════════════════════════════
  group('scan · the ring says the percentage', () {
    testWidgets('[en] it announces 0% and then TRACKS the value', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ScanScreen());
        final AppLocalizations l10n = await _load('en');
        expect(announced(tester), contains(l10n.a11yScanRing('0%')));

        // 🔴 THE SECOND HALF IS WHAT MAKES THE FIRST MEAN ANYTHING. A label
        // hardcoded to "0%" passes the assertion above. `_pct` advances on a
        // 560 ms `Timer.periodic` in steps of 100/5, so one tick is 20%.
        await tester.pump(const Duration(milliseconds: 560));
        expect(announced(tester), contains(l10n.a11yScanRing('20%')));
        expect(announced(tester), isNot(contains(l10n.a11yScanRing('0%'))));
      });
    });

    testWidgets('nothing on scan is naked — measured in the DONE phase', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ScanScreen());
        final AppLocalizations l10n = await _load('en');

        // 🔴 THE CLOCK IS WALKED FORWARD, AND THE FIRST ATTEMPT AT THIS CASE
        // WENT RED FOR A GOOD REASON. During the SCANNING phase the screen's
        // only control is the CTA, and it is genuinely disabled
        // (`onPressed: null`) — a disabled InkWell contributes no tap action at
        // all, so the sweep found ZERO activatable nodes and the coverage floor
        // said so rather than passing over nothing. The phase worth sweeping is
        // the one with controls in it.
        //
        // Six ticks: `_stepCount` is 5 and the sixth flips `_done`. The
        // sentinel is positive proof the phase arrived rather than an
        // assumption that six pumps were enough — `pumpAndSettle` is not an
        // option against a periodic timer, for the reason
        // `width_scan_test.dart`'s header records.
        for (int i = 0; i < 6; i++) {
          await tester.pump(const Duration(milliseconds: 560));
        }
        expect(
          find.text(l10n.goToDashboard),
          findsOneWidget,
          reason:
              'the scan never reached its results phase, so the sweep below is '
              'about the scanning screen again',
        );
        expectNothingNaked(tester, 'scan (results)');
      });
    });
  });

  // ═══ TIER 1 · CALENDAR ═════════════════════════════════════════════════════
  group('calendar · the weekday header is readable aloud', () {
    testWidgets('[en] the full names are announced and the letters are not', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const CalendarScreen());
        final DateSymbols symbols = DateFormat.yMMMM('en').dateSymbols;
        final List<String> labels = announced(tester);

        // Every column, not a spot check: the row is a rotation, so an
        // off-by-one in the rotation is exactly the bug that would leave six
        // right and one wrong.
        for (final String day in symbols.WEEKDAYS) {
          expect(
            labels,
            contains(day),
            reason:
                'the header column for $day announces its narrow letter or '
                'nothing at all',
          );
        }
        // THE FALSIFIER, and the reason this matters in English specifically:
        // NARROWWEEKDAYS is [S, M, T, W, T, F, S] — two T's and two S's — so
        // the letters are not merely terse, they are AMBIGUOUS.
        for (final String narrow in symbols.NARROWWEEKDAYS) {
          expect(
            labels,
            isNot(contains(narrow)),
            reason:
                'the narrow letter "$narrow" is still a semantics label; it is '
                'a layout compromise and has no business in the audio channel',
          );
        }
      });
    });

    testWidgets('nothing on calendar is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const CalendarScreen());
        // The renewal rows are hand-rolled InkWells — RowCard's twin, and the
        // control this sweep actually found.
        expectNothingNaked(tester, 'calendar');
      });
    });
  });

  // ═══ TIER 1 · DETAIL ═══════════════════════════════════════════════════════
  group('detail · the icon-only hero controls', () {
    testWidgets('[en] back and more-options announce their arb values', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // Netflix — `data/seed/demo_data.dart:10`, the id the width tests use,
        // so this renders the POPULATED branch rather than the not-found one.
        await pumpScreen(tester, const SubscriptionDetailScreen(id: '1'));
        final AppLocalizations l10n = await _load('en');
        final List<String> labels = announced(tester);
        expect(labels, contains(l10n.back));
        expect(labels, contains(l10n.moreOptions));
      });
    });

    testWidgets('the hero glyph is decorative, not a second name', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final ProviderContainer c = await pumpScreen(
          tester,
          const SubscriptionDetailScreen(id: '1'),
        );
        final Subscription sub = _seedSub(c);
        expect(
          announced(tester),
          isNot(contains(sub.glyph)),
          reason:
              'the mark is an abbreviation of the 30pt title twelve pixels '
              'below it, so announcing both opens every detail screen with '
              '"${sub.glyph}, ${sub.name}"',
        );
        expect(announced(tester).join(' '), contains(sub.name));
      });
    });

    testWidgets('nothing on detail is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const SubscriptionDetailScreen(id: '1'));
        expectNothingNaked(tester, 'detail', floor: 3);
      });
    });
  });

  // ═══ TIER 1 · SHELL ════════════════════════════════════════════════════════
  group('shell · the compact pill and the FAB', () {
    testWidgets('the FAB is a BUTTON with a name, not a tooltip', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpShell(tester);
        final AppLocalizations l10n = await _load('en');
        final Iterable<SemanticsData> fab = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.label == l10n.addSubscriptionTitle);
        expect(
          fab,
          isNotEmpty,
          reason:
              'the FAB carried its name in the `tooltip` slot only, which is a '
              'hint rather than a name',
        );
        expect(fab.every((SemanticsData d) => d.announcesButton), isTrue);
      });
    });

    testWidgets(
      'every pill tab is a button and EXACTLY ONE says it is selected',
      (WidgetTester tester) async {
        await semantically(tester, () async {
          await pumpShell(tester);
          final AppLocalizations l10n = await _load('en');
          final List<String> tabs = <String>[
            l10n.navHome,
            l10n.navCalendar,
            l10n.navInsights,
            l10n.navBudget,
            l10n.navMore,
          ];
          // ⚠️ SCOPED BY "HAS A SELECTED STATE", NOT BY LABEL ALONE, AND THAT
          // IS A REAL FINDING RATHER THAN A CONVENIENCE. `navCalendar`'s value
          // is "Calendar", and so is `calendarLink`'s — the "Calendar →" jump
          // in home's `Upcoming renewals` heading — so a label-only filter
          // matched SIX nodes on this screen and two of them were the same word
          // for two different controls. A tab is the thing that reports whether
          // it is the current one; the link never can be.
          final List<SemanticsData> tabNodes = _nodes(tester)
              .map((SemanticsNode n) => n.getSemanticsData())
              .where(
                (SemanticsData d) =>
                    tabs.contains(d.label) && d.announcesSelectedState,
              )
              .toList();
          expect(
            tabNodes,
            hasLength(tabs.length),
            reason:
                'AppScaffold supplies destination semantics through Material '
                'NavigationRail/Drawer at every OTHER width, but COMPACT is the '
                'class Subly overrides via compactNavigationBar — so this pill '
                'is the only navigation on a phone and owns its own semantics. '
                'Found: ${announced(tester)}',
          );
          expect(
            tabNodes.every((SemanticsData d) => d.announcesButton),
            isTrue,
          );
          expect(
            tabNodes.where((SemanticsData d) => d.announcesSelected).length,
            1,
            reason:
                'without isSelected a reader is given five identical tabs and '
                'no way to know which screen they are on — the colour is the '
                'only other channel and it is not one a reader has',
          );
        });
      },
    );

    testWidgets('nothing on the shell is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpShell(tester);
        // Five tabs + the FAB + home's own header controls and rows.
        expectNothingNaked(tester, 'the shell (landed on /home)', floor: 7);
      });
    });
  });

  // ═══ CHECK-INBOX ═══════════════════════════════════════════════════════════
  group('check-inbox · the one way out', () {
    testWidgets('[en] the only control announces as a named button', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const CheckInboxScreen(email: 'a-fairly-long-address@example.test'),
        );
        final AppLocalizations l10n = await _load('en');
        final Iterable<SemanticsData> cta = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.label == l10n.checkInboxBackToSignIn);
        expect(cta, isNotEmpty);
        expect(cta.every((SemanticsData d) => d.announcesButton), isTrue);
        expect(cta.every((SemanticsData d) => d.announcesEnabled), isTrue);
      });
    });

    testWidgets('the address is READ ALOUD, not left to the eye', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const CheckInboxScreen(email: 'typo@exmaple.test'),
        );
        expect(
          announced(tester).join(' '),
          contains('typo@exmaple.test'),
          reason:
              'naming the address is the whole job of this screen — a '
              'mistyped one is visible here and nowhere else',
        );
      });
    });

    testWidgets('nothing on check-inbox is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const CheckInboxScreen(email: 'a@b.test'));
        expectNothingNaked(tester, 'check-inbox');
      });
    });
  });

  // ═══ VERIFY-EMAIL ══════════════════════════════════════════════════════════
  group('verify-email · three stacked controls', () {
    testWidgets('[en] all three announce their arb labels as buttons', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const VerifyEmailScreen());
        final AppLocalizations l10n = await _load('en');
        for (final String label in <String>[
          l10n.verifyEmailContinue,
          l10n.verifyEmailResend,
          l10n.signOut,
        ]) {
          final Iterable<SemanticsData> hit = _nodes(tester)
              .map((SemanticsNode n) => n.getSemanticsData())
              .where((SemanticsData d) => d.label == label);
          expect(hit, isNotEmpty, reason: '"$label" is not announced at all');
          expect(
            hit.every((SemanticsData d) => d.announcesButton),
            isTrue,
            reason: '"$label" announces as prose that happens to respond',
          );
        }
      });
    });

    testWidgets('nothing on verify-email is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const VerifyEmailScreen());
        expectNothingNaked(tester, 'verify-email', floor: 3);
      });
    });
  });

  // ═══ RE-ACCEPT TERMS ═══════════════════════════════════════════════════════
  group('re-accept terms · the clickwrap', () {
    testWidgets('[en] the tick announces UNCHECKED and its sentence', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ReacceptTermsScreen());
        final AppLocalizations l10n = await _load('en');
        final List<SemanticsData> boxes = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where(
              (SemanticsData d) =>
                  d.flagsCollection.isChecked != CheckedState.none,
            )
            .toList();
        expect(boxes, hasLength(1));
        expect(boxes.single.flagsCollection.isChecked, CheckedState.isFalse);
        expect(announced(tester).join(' '), contains(l10n.legalAcceptTerms));
      });
    });

    testWidgets('the two document links announce as LINKS', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ReacceptTermsScreen());
        final AppLocalizations l10n = await _load('en');
        final List<SemanticsData> links = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.announcesLink)
            .toList();
        expect(
          links.map((SemanticsData d) => d.label),
          containsAll(<String>[l10n.linkTermsShort, l10n.linkPrivacyShort]),
        );
        expect(links.any((SemanticsData d) => d.announcesButton), isFalse);
      });
    });

    testWidgets(
      'the accept button announces DISABLED until the box is ticked',
      (WidgetTester tester) async {
        await semantically(tester, () async {
          await pumpScreen(tester, const ReacceptTermsScreen());
          final AppLocalizations l10n = await _load('en');
          SemanticsData accept() => _nodes(tester)
              .map((SemanticsNode n) => n.getSemanticsData())
              .firstWhere(
                (SemanticsData d) => d.label == l10n.reacceptTermsAccept,
              );

          expect(accept().announcesButton, isTrue);
          expect(
            accept().announcesEnabled,
            isFalse,
            reason:
                'the tick is the affirmative act, and a control that announces '
                'as actionable before it has been taken sends somebody tapping '
                'at a button that cannot fire',
          );

          await tester.tap(find.byKey(LegalConsentFields.termsCheckbox));
          await tester.pump();
          expect(
            accept().announcesEnabled,
            isTrue,
            reason:
                'THE FALSIFIER — a label hardcoded to disabled passes the arm '
                'above on its own, and a reader would be told the only way off '
                'this screen is dead',
          );
        });
      },
    );

    testWidgets('nothing on re-accept-terms is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ReacceptTermsScreen());
        expectNothingNaked(tester, 're-accept terms', floor: 4);
      });
    });
  });

  // ═══ TIER 1 · SIGN-IN ══════════════════════════════════════════════════════
  group('sign-in · the form every signed-out visitor is handed', () {
    testWidgets('the fields KEEP their names once they carry text', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen());
        final AppLocalizations l10n = await _load('en');

        // 🔴 THE STATE A PRISTINE FORM HIDES, AND THE REASON THIS CASE IS NOT
        // FOLDED INTO THE SWEEP BELOW. This screen paints its field names as a
        // `Text` ABOVE the box rather than through `InputDecoration.labelText`,
        // so nothing tied the two together and the only string in a field's own
        // semantics was the HINT. Flutter fades the hint out — semantics
        // included, because `AnimatedOpacity` drops a fully transparent child
        // from the tree — the moment the field has content. So the sweep on an
        // empty form passed on «you@email.com»: a placeholder standing in for a
        // name, on both boxes of the first screen every signed-out user sees.
        await tester.enterText(
          find.byKey(E2EKeys.loginEmail),
          'somebody@example.com',
        );
        await tester.enterText(
          find.byKey(E2EKeys.loginPassword),
          'hunter2hunter2',
        );
        // ⚠️ TWO PUMPS, AND THE SECOND ONE CARRIES TIME. A single frame leaves
        // the hint at full opacity and still in the tree, which is exactly the
        // reading that made this defect invisible on the first attempt — the
        // labels came back «you@email.com» and everything looked well.
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));

        final List<String> labels = announced(tester);
        expect(
          labels,
          contains(l10n.email),
          reason:
              'with the hint gone this field announces NOTHING unless the '
              'painted label is annotated onto it',
        );
        expect(labels, contains(l10n.password));
        // THE FALSIFIER, and it is the calendar's narrow-weekday rule one
        // screen over: the capitals are a layout compromise. Satisfying the two
        // assertions above by simply merging the painted `Text` in would put
        // "EMAIL" in the audio channel, which readers that treat all-caps as an
        // acronym spell out one letter at a time.
        expect(
          labels,
          isNot(contains(l10n.email.toUpperCase())),
          reason:
              'the shouted layout label reached the audio channel; only the '
              'sentence-case word belongs there',
        );
        expectNothingNaked(tester, 'sign-in (the fields carry text)', floor: 8);
      });
    });

    testWidgets('nothing on sign-in is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen());
        // Eight, MEASURED rather than a token 1: two fields, "Forgot
        // password?", the submit CTA, the sign-up toggle and the publisher's
        // three legal links. A floor under the real count is a floor that
        // cannot notice half the screen disappearing.
        expectNothingNaked(tester, 'sign-in', floor: 8);
      });
    });

    testWidgets('nothing on the SIGN-UP ARM of this screen is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen());
        final AppLocalizations l10n = await _load('en');

        // 🔴 THE SECOND DOOR, AND IT IS THE ONE MOST PEOPLE USE. `/sign-up` is
        // not the only registration surface — this toggle flips `_signUp` and
        // `_submit` then calls `signUpWithEmail`, and the router sends every
        // signed-out visitor HERE rather than there. A sweep that only ever
        // measured the sign-in arm would never see the clickwrap, which is the
        // one legally blocking control in the app.
        await tester.tap(find.text(l10n.newHerePrompt));
        await tester.pump();
        expect(
          find.text(l10n.legalAcceptTerms),
          findsOneWidget,
          reason:
              'the toggle did not flip, so the sweep below is about the '
              'sign-in arm again and the two consent boxes are not in the tree',
        );
        // Ten: the eight above, less "Forgot password?" (sign-in only), plus
        // the two consent boxes and the two document links beneath them.
        expectNothingNaked(tester, 'sign-in (sign-up arm)', floor: 10);
      });
    });

    testWidgets('nothing on the account-deletion notice is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final ProviderContainer c = await pumpScreen(
          tester,
          const LoginScreen(),
        );
        // 🔴 [ADR 027]. `deleteAccount()` signs out whichever way the request
        // went, so the router lands the user on this screen and takes the
        // settings screen, its dialog and any SnackBar with it — which is why
        // the outcome is rendered HERE. `signInSurvives` is the 502 arm: data
        // gone, login still working. It is the message that matters most and
        // the one nobody ever saw, and no other case on this screen puts its
        // Dismiss button in the tree.
        c.read(lastAccountDeletionOutcomeProvider.notifier).state =
            core.AccountDeletionOutcome.signInSurvives;
        await tester.pump();
        final AppLocalizations l10n = await _load('en');
        expect(
          find.text(l10n.deleteAccountResultNotDeleted),
          findsOneWidget,
          reason:
              'the notice never rendered, so the sweep below is the ordinary '
              'sign-in screen with an extra pump',
        );
        expectNothingNaked(tester, 'sign-in (deletion notice)', floor: 9);
      });
    });
  });

  // ═══ TIER 1 · SIGN-UP ══════════════════════════════════════════════════════
  group('sign-up · the clickwrap surface', () {
    testWidgets('nothing on sign-up is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const SignUpScreen());
        // Seven, and the submit button is deliberately NOT among them: it ships
        // disabled until the terms box is ticked, and a disabled
        // ButtonStyleButton contributes no tap action at all. The floor counts
        // what a reader can actually activate on arrival — two fields, two
        // consent boxes, two document links and the "already have an account"
        // exit.
        expectNothingNaked(tester, 'sign-up', floor: 7);
      });
    });
  });

  // ═══ TIER 1 · RESET PASSWORD ═══════════════════════════════════════════════
  group('reset-password · both states a link can land on', () {
    testWidgets('nothing on the DEAD-LINK state is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ResetPasswordScreen());
        expect(
          find.byKey(ResetPasswordScreen.linkDeadLine),
          findsOneWidget,
          reason:
              'no session and no recovery in flight — the state an expired, '
              'reused or wrong-device link produces, and the one this feature '
              'reaches most often in the field',
        );
        // The floor is the default 1 and it is the true count: this state is
        // two sentences and a single way out. Claiming more would be a
        // requirement invented by the test.
        expectNothingNaked(tester, 'reset-password (dead link)');
      });
    });

    testWidgets('nothing on the reset FORM is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // 🔴 THIS CASE BUILDS ITS OWN HOST, AND `pumpScreen` WOULD NOT DO.
        // Unoverridden, `authRepositoryProvider` resolves the demo repository
        // with nobody signed in — and no session IS the dead-link state, so
        // every measurement would be of the case above. The override has to sit
        // on the ROOT container: a nested `ProviderScope` throws here, because
        // riverpod 2 refuses to read a provider whose dependency was overridden
        // in a child scope unless it declares `dependencies`, and
        // `passwordRecoveryProvider` does not.
        final InMemoryAuthRepository auth = InMemoryAuthRepository();
        addTearDown(auth.dispose);
        await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
        await sizeSurface(tester, kPhone);
        final ProviderContainer c = ProviderContainer(
          overrides: <Override>[
            ...defaultWidthOverrides(),
            authRepositoryProvider.overrideWithValue(auth),
          ],
        );
        addTearDown(c.dispose);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: c,
            child: MaterialApp(
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const ResetPasswordScreen(),
            ),
          ),
        );
        for (int i = 0; i < 12; i++) {
          await tester.pump();
        }
        expect(
          find.byKey(ResetPasswordScreen.passwordField),
          findsOneWidget,
          reason:
              'the SUBJECT check — without it this sweeps the dead-link state '
              'and reports the form as clean without ever rendering it',
        );
        // Four: both password boxes, the submit and the cancel.
        expectNothingNaked(tester, 'reset-password (the form)', floor: 4);
      });
    });
  });

  // ═══ TIER 1 · HOME ═══════════════════════════════════════════════════════
  group('home · the two icon-only header controls', () {
    testWidgets(
      '[en] the bell and the account shortcut are BUTTONS THAT CAN BE PRESSED',
      (WidgetTester tester) async {
        await semantically(tester, () async {
          await pumpScreen(tester, const HomeScreen());
          final AppLocalizations l10n = await _load('en');

          // 🔴 THE THIRD LIMB IS THE ONE THAT WENT RED, AND IT IS WHY THIS CASE
          // ASKS ABOUT THE ACTION RATHER THAN ONLY ABOUT THE NAME AND THE ROLE.
          // The avatar was `Semantics(button: true, label: …,
          // excludeSemantics: true)` wrapped around the GestureDetector, and
          // `excludeSemantics` drops the WHOLE subtree — the account initial it
          // was aimed at AND the gesture handler's `SemanticsAction.tap`. So the
          // node announced "Account and settings, button" and a reader's
          // double-tap, which dispatches that action to the node rather than
          // synthesising a pointer event, reached nothing. A button that says
          // its name, says it is a button, and cannot be pressed is invisible to
          // every other assertion in this file: `expectNothingNaked` only ranges
          // over nodes that HAVE a tap action, so the one control missing one is
          // precisely the control it cannot see.
          for (final String name in <String>[
            l10n.notifications,
            l10n.a11yAccountSettings,
          ]) {
            final Iterable<SemanticsData> control = _nodes(tester)
                .map((SemanticsNode n) => n.getSemanticsData())
                .where((SemanticsData d) => d.label == name);
            expect(
              control,
              isNotEmpty,
              reason:
                  'the header control "$name" announces no name of its own — '
                  'both are icon-only, so there is no other channel. '
                  'Found: ${announced(tester)}',
            );
            expect(
              control.every((SemanticsData d) => d.announcesButton),
              isTrue,
              reason: '"$name" is a bare GestureDetector without the role',
            );
            expect(
              control.every(
                (SemanticsData d) => d.hasAction(SemanticsAction.tap),
              ),
              isTrue,
              reason:
                  '"$name" announces as a button and carries NO tap action, so '
                  'a screen reader offers it and then does nothing when it is '
                  'activated',
            );
          }
        });
      },
    );

    testWidgets('the account initial is decorative, not the control\'s name', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const HomeScreen());
        final AppLocalizations l10n = await _load('en');
        // Signed out on this rig, so the avatar renders its `'A'` fallback —
        // the same one-letter shape `user?.initial` produces for a real
        // account. It is a visual shorthand for "your account" and the row
        // already says whose account it is, so hearing "A, Account and
        // settings" is the stutter [GlyphTile] records one size down.
        expect(announced(tester), isNot(contains('A')));
        expect(announced(tester), contains(l10n.a11yAccountSettings));
      });
    });

    testWidgets('nothing on home is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const HomeScreen());
        // The floor names what is fixed rather than what happened to build:
        // the bell, the account shortcut, the "Calendar →" jump and the
        // unused-plans card are on this screen whatever the seed says, and the
        // renewal rows bring the rest. A phone viewport lays out only the first
        // six `RowCard`s of twelve, which is why the floor is not the row count.
        expectNothingNaked(tester, 'home', floor: 6);
      });
    });
  });

  // ═══ TIER 1 · SETTINGS ═══════════════════════════════════════════════════
  group('settings · the controls a reader has to operate', () {
    testWidgets(
      '[en] the DPDP withdrawal row announces its STATE, not just its name',
      (WidgetTester tester) async {
        await semantically(tester, () async {
          final ProviderContainer c = await pumpScreen(
            tester,
            const SettingsScreen(),
          );
          final AppLocalizations l10n = await _load('en');
          final Iterable<SemanticsData> row = _nodes(tester)
              .map((SemanticsNode n) => n.getSemanticsData())
              .where(
                (SemanticsData d) =>
                    d.label.contains(l10n.usageStatistics) &&
                    d.hasAction(SemanticsAction.tap),
              );
          expect(
            row,
            isNotEmpty,
            reason:
                'the analytics-consent row is the DPDP §6(3) withdrawal path — '
                'privacy.html promises it can be turned off here without '
                'contacting us, and a reader that cannot find it cannot '
                'exercise that. Found: ${announced(tester)}',
          );
          // 🔴 THE TOGGLED STATE IS THE LOAD-BEARING HALF. `_Toggle` is a
          // hand-rolled `AnimatedContainer`, so the ONLY channel carrying
          // on-or-off is the pill's colour and the knob's position — neither of
          // which a reader has. Without `toggled:` this row announces the same
          // sentence whether consent is granted or withdrawn, which is the one
          // fact somebody opening it came for.
          expect(
            row.every(
              (SemanticsData d) => d.flagsCollection.isToggled != Tristate.none,
            ),
            isTrue,
            reason:
                'the row announces no on/off state at all, so a reader is told '
                'nothing about whether usage statistics are being collected',
          );
          // Read from the SAME provider the screen read, so the assertion
          // cannot drift from the state the row was painted from.
          final bool granted =
              c.read(analyticsConsentProvider) == core.ConsentStatus.granted;
          expect(
            row.every(
              (SemanticsData d) =>
                  (d.flagsCollection.isToggled == Tristate.isTrue) == granted,
            ),
            isTrue,
            reason:
                'the announced state is the OPPOSITE of the consent the screen '
                'read — a reader told "on" while nothing is collected (or the '
                'reverse) is worse served than one told nothing',
          );
        });
      },
    );

    testWidgets('every currency chip is a button and EXACTLY ONE is selected', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const SettingsScreen());
        // ⚠️ SCOPED BY "HAS A SELECTED STATE", the nav pill's rule, and for the
        // same reason: '₹' is also the leading glyph of the Refund policy row
        // further down this very screen, so a label-only filter matches a row
        // that can never be the current currency. A chip is the thing that
        // reports whether it is the chosen one.
        final List<SemanticsData> chips = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where(
              (SemanticsData d) =>
                  const <String>[r'$', '€', '£', '₹'].contains(d.label) &&
                  d.announcesSelectedState,
            )
            .toList();
        expect(
          chips,
          hasLength(4),
          reason:
              'the four currency chips are hand-rolled GestureDetectors and '
              'the ONLY thing that said which one is on was the gradient. '
              'Found: ${announced(tester)}',
        );
        expect(chips.every((SemanticsData d) => d.announcesButton), isTrue);
        expect(
          chips.where((SemanticsData d) => d.announcesSelected).length,
          1,
          reason:
              'without isSelected a reader hears four identical currency '
              'symbols and cannot tell which one the app is using',
        );
      });
    });

    testWidgets('nothing on settings is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        // ⚠️ A TALL VIEWPORT, AND IT IS THE HALF THAT MAKES THIS A SWEEP.
        // Settings is by some way the longest `ListView` in the app, and a
        // `ListView` lays out only what fits: at `kPhone` this screen builds as
        // far as the privacy card and NOTHING below it — no legal links, no
        // licences tile, no Log out — so a sweep pumped at phone height would
        // range over the top third and pass whatever the other two do. The
        // width is still a phone's; only the height is opened up.
        await pumpScreen(
          tester,
          const SettingsScreen(),
          size: const Size(375, 3000),
        );

        // 🔴 MERGED-INTO-PARENT NODES ARE EXCLUDED, AND THAT IS NOT A WEAKENING
        // — IT IS THE DOUBLE COUNT REMOVED. `RadioListTile` and
        // `SwitchListTile` are `MergeSemantics` around a `ListTile` holding a
        // `Radio`/`Switch`, and those inner controls own a node that carries
        // the tap action and no label of its own. That node is never sent to
        // the platform: `SemanticsOwner.sendSemanticsUpdate` skips every node
        // whose parent `isPartOfNodeMerging`, so a reader never focuses it —
        // and its action and its (absent) name are already part of the parent's
        // `SemanticsData`, which IS checked below. Counting it as well flags
        // four controls that announce correctly as "System, radio button,
        // selected" and "Reminders, switch".
        //
        // Nothing is lost by the filter: `isMergedIntoParent` is set exactly
        // when the parent merges all descendants, so every excluded node's data
        // is asserted on at the ancestor that absorbed it.
        final int tappable = _nodes(tester)
            .where(
              (SemanticsNode n) =>
                  n.getSemanticsData().hasAction(SemanticsAction.tap),
            )
            .length;
        expect(
          tappable,
          greaterThanOrEqualTo(24),
          reason:
              'COVERAGE LOST — settings offered only $tappable activatable '
              'node(s). The theme segments (3), the language radios (3), the '
              'currency chips (4), the preference toggles (3), the reminders '
              'switch, the two privacy controls, the four account/legal link '
              'rows, contact support, licences, About and Log out are on this '
              'screen whatever the session says. Below that count the sweep '
              'ranges over the top of a list and passes whatever the rest does.',
        );
        final List<NakedControl> naked = nakedControls(
          tester,
        ).where((NakedControl n) => !n.node.isMergedIntoParent).toList();
        expect(
          naked,
          isEmpty,
          reason:
              'settings carries ${naked.length} control(s) a user can activate '
              'but cannot identify. A tap action without isButton/isLink is '
              'announced as prose that happens to respond, and one with no '
              'name is announced as nothing at all:\n  ${naked.join('\n  ')}',
        );
      });
    });
  });

  // ═══ TIER 1 · NOTIFICATIONS ══════════════════════════════════════════════
  group('notifications · the one control on a screen of cards', () {
    testWidgets('[en] the close button announces its name and its role', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const NotificationsScreen());
        final AppLocalizations l10n = await _load('en');
        final Iterable<SemanticsData> close = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.label == l10n.close);
        expect(
          close,
          isNotEmpty,
          reason:
              'this is a pushed full-screen route and this button is the only '
              'way back out of it that is not a system gesture — an unnamed '
              'icon here is a dead end. Found: ${announced(tester)}',
        );
        expect(close.every((SemanticsData d) => d.announcesButton), isTrue);
      });
    });

    testWidgets('the notification CARDS are read but are not controls', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const NotificationsScreen());
        final AppLocalizations l10n = await _load('en');
        // Every card is an inert `Container` — nothing on this screen navigates
        // anywhere. Announcing a role for one would send somebody tapping at a
        // surface that does nothing, which is the `RowCard` lie in the opposite
        // direction, and it is the shape a future "tap to open the plan" would
        // arrive in.
        expect(
          _nodes(tester)
              .map((SemanticsNode n) => n.getSemanticsData())
              .where((SemanticsData d) => d.announcesButton)
              .map((SemanticsData d) => d.label),
          <String>[l10n.close],
          reason:
              'a card that announces itself as a button is a control the '
              'screen does not have',
        );
        // COVERAGE, and it is the half that makes the assertion above mean
        // something: "the only button is Close" is ALSO true of a screen that
        // rendered nothing but its own chrome — the empty state
        // (`notifNothingDue`) is exactly that shape, and it would pass. So the
        // card has to be positively there.
        //
        // Asked as "a label that is neither the title nor the button", not as a
        // count and not by re-typing a card's sentence: the due-soon rows are
        // built from `daysUntil(now)` and would pin this case to the wall
        // clock. The flagged-unused row is not — three of the twelve demo
        // subscriptions carry `unused: true` and that row is built from
        // `flaggedUnused.isNotEmpty` alone — so there is a card on every day of
        // the year, and nothing here has to know what it says.
        final List<String> labels = announced(tester);
        expect(labels, contains(l10n.notifications));
        expect(
          labels.where(
            (String l) => l != l10n.notifications && l != l10n.close,
          ),
          isNotEmpty,
          reason:
              'COVERAGE LOST — the screen announced its title and its close '
              'button and NOTHING ELSE, so it is in its empty state and the '
              'assertion above ranged over a screen with no cards on it. '
              'Found: $labels',
        );
      });
    });

    testWidgets('nothing on notifications is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const NotificationsScreen());
        // The floor is 1 and stated: the close button is the ONLY activatable
        // node on this screen. Asking for more would be a requirement invented
        // by the test.
        expectNothingNaked(tester, 'notifications');
      });
    });
  });

  // ═══ MONEY · PAYWALL ═══════════════════════════════════════════════════════
  group('paywall · the plan rows are the control', () {
    testWidgets('[en] every plan row announces its price AND its button', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // 🔴 THE FAKE RAIL IS NOT OPTIONAL, AND IT IS A FAKE RAIL AND NOT A
        // FAKE GATE. The shipped `HostedCheckoutRail` refuses on every mobile
        // channel by policy and has no `checkout_url_template` (OWNER_QUEUE
        // A-1), so `canStartCheckout` is false and the choosing phase renders
        // ONE line of copy — `paywallUnavailable` — with no plan rows at all.
        // MEASURED: without this override the sweep below finds ZERO
        // activatable nodes, i.e. it ranges over nothing and passes whatever
        // the code does. This is the REAL rail with a config and a capability
        // row supplied, the same shape `width_paywall_test.dart` needs and for
        // the same reason; `paywall.enabled` and app-config-data.json are
        // untouched.
        //
        // TWO offerings, and the monthly carries a trial: that makes
        // `paywallTermWithTrial` — the longest sentence this screen renders,
        // and the only one with a second number in it — part of what is heard.
        const List<Offering> offerings = <Offering>[
          Offering(
            productId: 'pro_monthly',
            amountMinor: 499,
            currencyCode: 'USD',
            term: OfferingTerm.month,
            trialDays: 30,
          ),
          Offering(
            productId: 'pro_yearly',
            amountMinor: 4999,
            currencyCode: 'USD',
            term: OfferingTerm.year,
            trialDays: 0,
          ),
        ];
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              purchaseRailProvider.overrideWithValue(
                HostedCheckoutRail(
                  config: const RailConfig(
                    offerings: offerings,
                    checkoutUrlTemplate: 'https://example.test/{price_id}',
                    manageUrlTemplate: null,
                  ),
                  appId: AppConfig.appId,
                  returnUrl: kCheckoutReturnUrl,
                  accountId: () async => 'a11y',
                  accessToken: () async => null,
                  cancellationTransport:
                      const core.UnavailableCancellationTransport(),
                  capabilities: const PurchaseCapabilities(
                    technicallySupported: true,
                    channelPermitted: true,
                    why: 'a11y sweep needs the populated choosing phase',
                  ),
                ),
              ),
            ],
            child: const PaywallScreen(),
          ),
        );
        final AppLocalizations l10n = await _load('en');
        final List<String> labels = announced(tester);

        // ⚠️ ONE NODE PER ROW, NOT ONE PER FRAGMENT — which is why this asks
        // for a label CONTAINING both halves rather than for each half in the
        // list. `ListTile` merges its title and subtitle, so the row is heard
        // as "$4.99, billed per month, after a 30-day free trial" in a single
        // stop. Asserting `contains(price)` against the label LIST instead
        // fails on correct code (measured: the list holds the joined string,
        // never the bare price), and the merged form is the one that matters —
        // a price on one stop and what it buys on the next is how somebody
        // agrees to the wrong plan.
        //
        // The price is DERIVED from the rail's own amount and currency, so it
        // is built the same way here rather than re-typed: a `$4.99` literal
        // would pin the fixture and say nothing about the formatter. (It would
        // also trip `assert-no-price-literals.mjs`.)
        for (final Offering o in offerings) {
          final String term = o.trialDays > 0
              ? l10n.paywallTermWithTrial(o.term.wire, o.trialDays)
              : l10n.paywallTerm(o.term.wire);
          expect(
            labels.where(
              (String l) => l.contains(o.formattedPrice) && l.contains(term),
            ),
            hasLength(1),
            reason:
                'the ${o.term.wire} plan must announce its price and its terms '
                'as ONE row. Found: $labels',
          );
        }

        // 🔴 SCOPED BY `announcesButton`, NOT BY THE LABEL ALONE, AND THAT IS
        // A MEASURED FINDING RATHER THAN A HABIT. `paywallTitle` and
        // `paywallUpgrade` are BOTH the word "Upgrade" in the arb, so a
        // label-only filter matches THREE nodes here and one of them is the
        // AppBar heading — a title, not a control. Same shape the shell's tab
        // case records for `navCalendar` vs `calendarLink`: the button flag is
        // what separates the two identical words.
        final List<SemanticsData> upgrades = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where(
              (SemanticsData d) =>
                  d.label == l10n.paywallUpgrade && d.announcesButton,
            )
            .toList();
        expect(
          upgrades,
          hasLength(offerings.length),
          reason:
              'one Upgrade button per offering, and the AppBar title is not '
              'one of them. Found: $labels',
        );
        expect(
          upgrades.every((SemanticsData d) => d.announcesEnabled),
          isTrue,
          reason:
              'the choosing phase is the phase in which buying is possible; a '
              'button that announces disabled here sends somebody tapping at '
              'nothing',
        );
      });
    });

    testWidgets('nothing on the paywall is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              purchaseRailProvider.overrideWithValue(
                HostedCheckoutRail(
                  config: const RailConfig(
                    offerings: <Offering>[
                      Offering(
                        productId: 'pro_monthly',
                        amountMinor: 499,
                        currencyCode: 'USD',
                        term: OfferingTerm.month,
                        trialDays: 30,
                      ),
                      Offering(
                        productId: 'pro_yearly',
                        amountMinor: 4999,
                        currencyCode: 'USD',
                        term: OfferingTerm.year,
                        trialDays: 0,
                      ),
                    ],
                    checkoutUrlTemplate: 'https://example.test/{price_id}',
                    manageUrlTemplate: null,
                  ),
                  appId: AppConfig.appId,
                  returnUrl: kCheckoutReturnUrl,
                  accountId: () async => 'a11y',
                  accessToken: () async => null,
                  cancellationTransport:
                      const core.UnavailableCancellationTransport(),
                  capabilities: const PurchaseCapabilities(
                    technicallySupported: true,
                    channelPermitted: true,
                    why: 'a11y sweep needs the populated choosing phase',
                  ),
                ),
              ),
            ],
            child: const PaywallScreen(),
          ),
        );
        // Floor 2 = one Upgrade per offering, and it is the limb that refuses
        // the empty screen: drop the rail override above and this reads 0.
        expectNothingNaked(tester, 'paywall (choosing)', floor: 2);
      });
    });
  });

  // ═══ MONEY · MANAGE PLAN ═══════════════════════════════════════════════════
  group('manage-plan · the cancel row is the requirement', () {
    testWidgets('[en] restore and cancel both announce as named buttons', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              // THE SERVER'S ANSWER, NOT THE LOCK — `promo_card_surface_test`'s
              // idiom. Overriding `paywallLockedProvider` would assert that a
              // boolean changes a widget, which was never in doubt; this drives
              // the entitlement the screen's `isPro` is computed from.
              entitlementsProvider.overrideWith(
                (_) async => core.Entitlements(
                  appId: AppConfig.appId,
                  isPro: true,
                  items: const <core.Entitlement>[],
                ),
              ),
            ],
            child: const ManagePlanScreen(),
          ),
        );
        final AppLocalizations l10n = await _load('en');
        // `contains` and not `==`: `ListTile` merges its title into the row
        // node, and the restore row has a subtitle merged in beside it.
        final List<String> names = _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.announcesButton)
            .map((SemanticsData d) => d.label)
            .toList();
        expect(
          names.any((String l) => l.contains(l10n.restorePurchases)),
          isTrue,
          reason:
              'Apple guideline 3.1.1 makes this control mandatory the day a '
              'native IAP rail ships, and a control nobody is told is a '
              'control does not satisfy it. Found: ${announced(tester)}',
        );
        expect(
          names.any((String l) => l.contains(l10n.cancelPlan)),
          isTrue,
          reason:
              'ROSCA is a rule about how hard the CANCEL control is to find, '
              'and a control a reader is never told is a control is the '
              'hardest kind to find. Found: ${announced(tester)}',
        );
      });
    });

    testWidgets('nothing on manage-plan is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        // 🔴 PRO, AND STATED. The cancel row is `if (isPro)`, so the default
        // state sweeps ONE control — and the one it drops is the one this
        // screen exists for. Measured with `isPro: false`: the floor reads 1,
        // which is why it is 2 here rather than left at the default.
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              entitlementsProvider.overrideWith(
                (_) async => core.Entitlements(
                  appId: AppConfig.appId,
                  isPro: true,
                  items: const <core.Entitlement>[],
                ),
              ),
            ],
            child: const ManagePlanScreen(),
          ),
        );
        expectNothingNaked(tester, 'manage-plan (pro)', floor: 2);
      });
    });
  });

  // ═══ MONEY · ONBOARDING ════════════════════════════════════════════════════
  group('onboarding · the dots are the only position there is', () {
    testWidgets(
      '[en] the carousel announces WHICH slide, not three blank dots',
      (WidgetTester tester) async {
        await semantically(tester, () async {
          await pumpScreen(tester, const OnboardingScreen());
          final AppLocalizations l10n = await _load('en');
          expect(
            announced(tester),
            contains(l10n.a11yPageIndicator(1, 3)),
            reason:
                'the dots encode position in PIXEL WIDTH and nothing else — 24 '
                'px active, 7 px not, no text anywhere — so without this label '
                'the semantics tree for a swipeable three-page carousel says '
                'neither where you are nor that there is anywhere to go',
          );
        });
      },
    );

    testWidgets('nothing on onboarding is naked', (WidgetTester tester) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const OnboardingScreen());
        // Skip and Next. The PageView contributes scroll actions, not tap
        // ones, so the two buttons are the whole activatable surface here.
        expectNothingNaked(tester, 'onboarding', floor: 2);
      });
    });
  });

  // ═══ TIER 1 · ADD SHEET (modal) ═══════════════════════════════════════════
  group('add sheet · the quick-add grid and the cycle toggle', () {
    testWidgets('the POPULAR tiles announce the NAME, never the two-letter mark', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // A sheet is opened, not routed to, so the host is a launcher button —
        // `width_add_sheet_test.dart:64-90`'s rig, on `pumpScreen`'s container
        // and delegates rather than its own `ProviderScope`.
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showAddSubscriptionSheet(context),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();

        final List<String> labels = announced(tester);
        for (final List<String> service in DemoData.popular) {
          expect(
            labels,
            contains(service[0]),
            reason: 'the ${service[0]} quick-add tile announces no name',
          );
          // THE FALSIFIER, and the reason this tile needed work at all: the
          // mark and the name are STACKED, so unmerged the tile announced
          // "HUL" and then "Hulu" as two separate stops and neither of them as
          // a control. `ExcludeSemantics` on the chip is what removes the
          // first; delete it and this line is what goes red.
          expect(
            labels,
            isNot(contains(service[1])),
            reason:
                'the two-letter mark "${service[1]}" is an abbreviation of the '
                'name 5 px below it — announcing both opens every tile with '
                '"${service[1]}, ${service[0]}"',
          );
        }
      });
    });

    testWidgets('the cycle toggle reports WHICH arm is current, and it moves', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showAddSubscriptionSheet(context),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _load('en');

        // Scoped by "has a selected STATE", the same way the shell's pill case
        // is: Monthly/Yearly is a two-way choice whose only visual indication
        // is a gradient fill, and a reader has no gradient.
        List<SemanticsData> arms() => _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where(
              (SemanticsData d) =>
                  <String>[
                    l10n.cycleMonthly,
                    l10n.cycleYearly,
                  ].contains(d.label) &&
                  d.announcesSelectedState,
            )
            .toList();

        expect(
          arms(),
          hasLength(2),
          reason:
              'both arms must REPORT a selection state — the tri-state is the '
              'point, and an arm with no state at all is announced as an '
              'ordinary button that happens to share the word. '
              'Found: ${announced(tester)}',
        );
        expect(arms().every((SemanticsData d) => d.announcesButton), isTrue);
        expect(
          arms()
              .where((SemanticsData d) => d.announcesSelected)
              .map((SemanticsData d) => d.label),
          <String>[l10n.cycleMonthly],
          reason: 'the sheet opens on Monthly, and exactly one arm may say so',
        );

        // 🔴 THE HALF THAT MAKES THE FIRST HALF MEAN ANYTHING. A hardcoded
        // `selected: true` on the monthly arm passes everything above.
        //
        // ⚠️ `ensureVisible` FIRST, AND IT IS NOT DEFENSIVE PADDING. The
        // sheet's `maxHeight` is `MediaQuery.size.height * 0.86`, and
        // `setSurfaceSize` pins LAYOUT CONSTRAINTS WITHOUT MOVING MediaQuery
        // (`width_harness.dart:166-178` measures both halves) — so the sheet is
        // 516 tall whatever surface this runs at, its `SingleChildScrollView`
        // clips the last ~80 px, and a bare `tap` derives an offset that hit
        // tests onto the sheet's own padding. That failure prints as a WARNING
        // and the tap silently does nothing, which reads exactly like a
        // `selected` flag that refused to move.
        await tester.ensureVisible(find.text(l10n.cycleYearly));
        await tester.pumpAndSettle();
        await tester.tap(find.text(l10n.cycleYearly));
        await tester.pumpAndSettle();
        expect(
          arms()
              .where((SemanticsData d) => d.announcesSelected)
              .map((SemanticsData d) => d.label),
          <String>[l10n.cycleYearly],
          reason:
              'the selected flag did not FOLLOW the choice, so a reader is '
              'told the wrong billing cycle is current',
        );
      });
    });

    testWidgets('nothing on the add sheet is naked', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showAddSubscriptionSheet(context),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();

        // 🔴 WHY THIS IS NOT `expectNothingNaked`, AND WHY EVERY MODAL SURFACE
        // WILL NEED THE SAME SHAPE. `showModalBottomSheet` mounts a framework
        // `ModalBarrier` whose `Semantics` carries a tap action, a NAME (the
        // localized scrim label) and an `onTapHint` — but no role flag
        // (`modal_barrier.dart:237-242`). It is therefore NAKED by this file's
        // definition, on every modal in every Flutter app, and it is NOT
        // fixable here: `showModalBottomSheet` exposes `barrierLabel` and
        // nothing else, and the only knob that removes the node — passing
        // `isDismissible: false` — removes tap-outside-to-close along with it.
        // Trading a real affordance away to satisfy an assertion is the wrong
        // direction, so the barrier is EXCLUDED — by the property that
        // identifies it, never by matching its label, which is localized and
        // would make this case pass in English and range over nothing in Tamil.
        //
        // The exclusion is bounded in both directions rather than trusted:
        // exactly one node may carry a dismiss action, and it has to be the
        // one that is named. A second one appearing — an app control that
        // declared `onDismiss` and slipped out of the sweep — turns into a
        // named failure instead of a silent hole.
        final List<SemanticsNode> tappable = _nodes(tester)
            .where(
              (SemanticsNode n) =>
                  n.getSemanticsData().hasAction(SemanticsAction.tap),
            )
            .toList();
        final List<SemanticsNode> barrier = tappable
            .where(
              (SemanticsNode n) =>
                  n.getSemanticsData().hasAction(SemanticsAction.dismiss),
            )
            .toList();
        expect(
          barrier,
          hasLength(1),
          reason:
              'the modal scrim is the ONE node this sweep steps around, so '
              'there had better be exactly one of it. Found: '
              '${tappable.map(NakedControl.new)}',
        );
        expect(
          _spoken(barrier.single),
          isNotEmpty,
          reason:
              'the scrim is excluded on the grounds that it is at least NAMED '
              '— an unnamed scrim is a silent dismiss target and the exclusion '
              'stops being defensible',
        );

        final List<SemanticsNode> ours = tappable
            .where(
              (SemanticsNode n) =>
                  !n.getSemanticsData().hasAction(SemanticsAction.dismiss),
            )
            .toList();
        // The coverage floor, for [expectNothingNaked]'s reason: "nothing is
        // naked" is also true of a sheet that failed to mount. 8 POPULAR tiles
        // + name + price + 2 cycle arms + Cancel + Add = 14, and the tile count
        // is READ rather than typed so the seed stays the thing that drives it.
        expect(
          ours.length,
          greaterThanOrEqualTo(DemoData.popular.length + 6),
          reason:
              'COVERAGE LOST — the add sheet offered only ${ours.length} of '
              'its own activatable node(s); the sweep below then ranges over '
              'almost nothing and passes whatever the code does',
        );

        final List<NakedControl> naked = nakedControls(tester)
            .where(
              (NakedControl n) =>
                  !n.node.getSemanticsData().hasAction(SemanticsAction.dismiss),
            )
            .toList();
        expect(
          naked,
          isEmpty,
          reason:
              'the add sheet carries ${naked.length} control(s) a user can '
              'activate but cannot identify. A tap action without '
              'isButton/isTextField is announced as prose that happens to '
              'respond, and one with no name is announced as nothing at '
              'all:\n  ${naked.join('\n  ')}',
        );
      });
    });
  });

  // ═══ TIER 1 · CANCEL SHEET (modal) ════════════════════════════════════════
  group('cancel sheet · both steps of a destructive confirmation', () {
    testWidgets('[en] each step names the plan, and every way out is a button', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // The subscription is constructed rather than read from the seed, the
        // same way `width_cancel_sheet_test.dart:51-58` does it: this sheet is
        // a pure function of the object handed to `showCancelSheet`, so the
        // seed would only add a dependency the surface does not have.
        final Subscription sub = Subscription(
          id: 'sub-1',
          name: 'Netflix',
          category: 'Streaming',
          price: 15,
          cycle: BillingCycle.monthly,
          nextRenewal: DateTime.utc(2026, 9, 12),
        );
        final ProviderContainer c = await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showCancelSheet(context, sub),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _load('en');

        // WHOSE plan. A confirmation that announces "Cancel?" and a price is a
        // confirmation a reader cannot check before destroying something.
        expect(
          announced(tester),
          contains(l10n.cancelSubscriptionTitle(sub.name)),
        );

        List<SemanticsData> named(String label) => _nodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData())
            .where((SemanticsData d) => d.label == label)
            .toList();

        for (final String label in <String>[
          l10n.keepPlan,
          l10n.confirmCancel,
        ]) {
          expect(
            named(label),
            isNotEmpty,
            reason: '"$label" is not announced at all on step 0',
          );
          expect(
            named(label).every((SemanticsData d) => d.announcesButton),
            isTrue,
            reason:
                '"$label" is one of the two ways out of a destructive '
                'confirmation and it does not announce as a control',
          );
          expect(
            named(label).every((SemanticsData d) => d.announcesEnabled),
            isTrue,
            reason:
                'a live control announcing disabled sends somebody tapping at '
                'nothing — and on THIS sheet the disabled branch is real, it '
                'is what `Cancelling…` renders as',
          );
        }

        await tester.tap(find.text(l10n.confirmCancel));
        await tester.pumpAndSettle();

        // 🔴 STEP 1, AND THE ASSERTION IS ABOUT THE U+FFFC SPLICE. The saved
        // amount is emphasised by asking for ONE translated message with an
        // OBJECT REPLACEMENT CHARACTER standing in for the money, then cutting
        // the finished string at that character and re-joining it as three
        // spans. `Text.rich` flattens to a single semantics label, so a splice
        // that mis-cut — or one that left the control character in — is
        // audible as garbage in the one sentence that tells a user what they
        // just saved. Composed from the SAME provider the sheet read, so the
        // expectation cannot drift from the currency the sheet formatted.
        final Currency currency = c.read(currencyProvider);
        expect(announced(tester), contains(l10n.cancelledHeading));
        expect(
          announced(tester),
          contains(l10n.cancelStep2Body(currency.fmt(sub.monthlyPrice))),
          reason:
              'the emphasised amount is spliced into a translated sentence at '
              'U+FFFC; a reader must hear the sentence, not the seam. '
              'Found: ${announced(tester)}',
        );
        expect(
          announced(tester).join(' '),
          isNot(contains('\u{FFFC}')),
          reason:
              'the OBJECT REPLACEMENT CHARACTER survived into the audio '
              'channel — the placeholder was never cut out',
        );
        expect(
          named(l10n.done).every((SemanticsData d) => d.announcesButton),
          isTrue,
          reason:
              'Done is the only way off the success step; a reader who cannot '
              'find it is stranded on a sheet with no exit',
        );
      });
    });

    testWidgets('nothing on the cancel sheet is naked — in EITHER step', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final Subscription sub = Subscription(
          id: 'sub-1',
          name: 'Netflix',
          category: 'Streaming',
          price: 15,
          cycle: BillingCycle.monthly,
          nextRenewal: DateTime.utc(2026, 9, 12),
        );
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showCancelSheet(context, sub),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _load('en');

        // The scrim exclusion, argued once in the add-sheet sweep above and
        // applied here for the same reason — the barrier belongs to
        // `showModalBottomSheet`, not to this file's two Columns.
        void sweep(String step, int floor) {
          final List<SemanticsNode> tappable = _nodes(tester)
              .where(
                (SemanticsNode n) =>
                    n.getSemanticsData().hasAction(SemanticsAction.tap),
              )
              .toList();
          expect(
            tappable.where(
              (SemanticsNode n) =>
                  n.getSemanticsData().hasAction(SemanticsAction.dismiss),
            ),
            hasLength(1),
            reason:
                '$step: the modal scrim is the ONE node this sweep steps '
                'around, so there had better be exactly one of it',
          );
          final List<SemanticsNode> ours = tappable
              .where(
                (SemanticsNode n) =>
                    !n.getSemanticsData().hasAction(SemanticsAction.dismiss),
              )
              .toList();
          expect(
            ours.length,
            greaterThanOrEqualTo(floor),
            reason:
                'COVERAGE LOST — $step offered only ${ours.length} of its own '
                'activatable node(s), below the $floor it is known to have',
          );
          final List<NakedControl> naked = nakedControls(tester)
              .where(
                (NakedControl n) => !n.node.getSemanticsData().hasAction(
                  SemanticsAction.dismiss,
                ),
              )
              .toList();
          expect(
            naked,
            isEmpty,
            reason:
                '$step carries ${naked.length} control(s) a user can activate '
                'but cannot identify:\n  ${naked.join('\n  ')}',
          );
        }

        // Step 0 — 'Keep it' and the destructive confirm.
        sweep('the cancel sheet (step 0)', 2);

        // 🔴 STEP 1 IS SWEPT SEPARATELY BECAUSE IT IS A DIFFERENT TREE. The
        // sheet swaps its whole Column on `_step`, so a control added to the
        // success branch is invisible to any sweep that only ever measured the
        // confirmation branch — the phase-dependent hole `scan`'s case records
        // one domain over. The sentinel is positive proof the branch arrived
        // rather than an assumption that the tap landed.
        await tester.tap(find.text(l10n.confirmCancel));
        await tester.pumpAndSettle();
        expect(
          find.text(l10n.cancelledHeading),
          findsOneWidget,
          reason:
              'the confirmation never resolved, so the sweep below is about '
              'step 0 a second time',
        );
        sweep('the cancel sheet (step 1)', 1);
      });
    });
  });

  // ═══ 48×48 · FLUTTER_TEST'S OWN TAP-TARGET SWEEP, EVERY SURFACE ═══════════
  //
  // 🔴 WHY THIS FAMILY EXISTS, AND WHAT IT REPLACES. [ADR 048] measured two
  // things about tap targets in this repository and both were the same defect
  // wearing different clothes:
  //   · `chassis_properties_test.dart:1209` is titled "every tap target on
  //     every declared route is at least 48px" and ranges over
  //     `_iconOnlyControls` — IconButton | InkWell | GestureDetector, FILTERED
  //     TO THOSE WITH NO `Text` DESCENDANT. Every LABELLED control in the app is
  //     outside it. The title describes a sweep; the code is a spot check.
  //   · `assert-a11y-coverage.mjs:283-286` has recognised a `tap-target` family
  //     since it was written, keyed on `meetsGuideline(…TapTargetGuideline)`,
  //     and printed `tap-target ×0` on every run. A check that never started.
  //
  // The three defects that fell out of pointing the real guideline at the real
  // screens are all controls the old assertion could not have seen, and two of
  // them are the reason the filter exists at all:
  //   · home's account avatar — 44.0×44.0, nine pixels from a sibling that is 48
  //     and says so. It has a `Text` descendant (the account initial), which is
  //     exactly what `_iconOnlyControls` filters out.
  //   · home's "Calendar →" jump — 112.0×13.0. Labelled, so outside the filter.
  //   · insights' "Cancel" — 73.5×36.0, ×3 rows. Labelled, so outside the
  //     filter. It is the one destructive path on that screen.
  //   · sign-in's "New here? Create account" — 319.0×40.0. Labelled, so outside
  //     the filter. It is the only route to registration from the screen every
  //     signed-out visitor is routed to.
  // Each was fixed in `lib/`, with the measurement written beside the fix. NONE
  // was excluded: see the two non-sweeps at the bottom of this group for the
  // only two surfaces that get an exception, and why.
  //
  // ── WHY THE FRAMEWORK'S GUIDELINE AND NOT A HAND-ROLL ────────────────────
  // WCAG 2.5.8 is not "measure the rect and compare to 48". It carries five
  // exceptions (Spacing, Equivalent, Inline, User Agent Control, Essential), and
  // `MinimumTapTargetGuideline` already implements the ones that are mechanical:
  // it skips `isLink` nodes (its source cites the WCAG link exemption by URL),
  // hidden nodes, nodes merged into a parent, nodes with no tap/long-press
  // action, and targets clipped by a scrolling boundary. It implements NO
  // Spacing exception. A hand-rolled version of this file would have had to
  // re-derive all of that and would have got it wrong in the direction that
  // reports clean.
  //
  // ── 🔴 THE FALSIFIER IS NOT OPTIONAL HERE, AND IT IS WHY THIS GROUP IS NOT
  //    NINETEEN COPIES OF ONE LINE ─────────────────────────────────────────
  // `meetsGuideline(androidTapTargetGuideline)` returns `Evaluation.pass()` for
  // a screen it inspected NOTHING on. It is the vacuous-pass shape this
  // repository keeps paying for, and it is not hypothetical: before
  // `sizeSurface` existed (see its own note), SIX of the nineteen surfaces
  // handed the guideline zero nodes and every one of them passed. The family
  // tally would have gone ×0 → ×20 without a single one of those controls being
  // measured — the [ADR 048] defect reproduced by the change that was supposed
  // to close it.
  //
  // So every case below runs [expectGuidelineHadSubjects] FIRST. It re-runs the
  // SAME guideline class at an impossible floor, so every node the real sweep
  // would inspect reports itself; the count is the size of the domain the sweep
  // ranged over. The floor is 1 — non-vacuity, not a second coverage assertion,
  // because the `nothing on … is naked` case on the SAME pump already carries a
  // per-screen count. The measurements are recorded per case so a reader has the
  // number without a brittle equality standing in for it.
  group('48×48 · flutter_test\'s own tap-target sweep', () {
    testWidgets('every tap target on insights is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const InsightsScreen());
        // 3 subjects. All three are the unused-plan "Cancel" buttons, and all
        // three were 73.5×36.0 until this increment.
        await expectGuidelineHadSubjects(tester, 'insights');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on calendar is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const CalendarScreen());
        // 3 subjects — the renewal rows, the hand-rolled RowCard twin whose
        // semantics the naked sweep found on this same pump.
        await expectGuidelineHadSubjects(tester, 'calendar');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on scan (results) is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ScanScreen());
        final AppLocalizations l10n = await _load('en');
        // Six ticks to the DONE phase, for the naked sweep's reason: during
        // SCANNING the only control is genuinely disabled and contributes no
        // tap action, so the guideline would inspect nothing and pass.
        for (int i = 0; i < 6; i++) {
          await tester.pump(const Duration(milliseconds: 560));
        }
        expect(
          find.text(l10n.goToDashboard),
          findsOneWidget,
          reason:
              'the scan never reached its results phase, so the sweep below is '
              'about the scanning screen again',
        );
        // 1 subject — the dashboard CTA is the whole activatable surface here.
        await expectGuidelineHadSubjects(tester, 'scan (results)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on detail is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const SubscriptionDetailScreen(id: '1'));
        // 4 subjects — back, more-options and the two hero actions.
        await expectGuidelineHadSubjects(tester, 'detail');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on the shell is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpShell(tester);
        // 11 subjects, the largest domain outside settings: five pill tabs, the
        // FAB and home's own header and rows underneath them. This case is also
        // the one that pumps the REAL router, so it attributes to no single
        // domain surface — the same shape `assert-a11y-coverage.mjs` already
        // reports for the shell's naked sweep.
        await expectGuidelineHadSubjects(tester, 'the shell (landed on /home)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on verify-email is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const VerifyEmailScreen());
        // 2 of the three stacked controls; the third sits under this screen's
        // scroll boundary, which the guideline steps around.
        await expectGuidelineHadSubjects(tester, 'verify-email');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on re-accept terms is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ReacceptTermsScreen());
        // 1 subject.
        //
        // ⚠️ AND THE CLICKWRAP TICK IS NOT THE DEFECT IT WAS EXPECTED TO BE.
        // `legal_consent_fields.dart` paints a 20 px box, and the brief for this
        // increment named it as the Equivalent-exception case to argue. It is
        // not: that box is a Material `Checkbox`, whose default
        // `materialTapTargetSize` is `padded`, so the node it contributes is
        // 48×48 and the 20 px is the PAINTED square inside it. Measured, not
        // assumed — the guideline inspects this screen and passes. No exception
        // is needed and none is claimed.
        await expectGuidelineHadSubjects(tester, 're-accept terms');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on sign-in is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen());
        // 5 subjects. One of them — "New here? Create account" — was 319.0×40.0
        // until this increment, and it is the only route to registration from
        // the screen the router hands every signed-out visitor.
        await expectGuidelineHadSubjects(tester, 'sign-in');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on the SIGN-UP ARM is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen());
        final AppLocalizations l10n = await _load('en');
        // The second door, and a DIFFERENT TREE — the naked sweep's reason,
        // unchanged here: this arm is where the two consent boxes and their
        // document links live, and no other pump of this screen has them.
        await tester.tap(find.text(l10n.newHerePrompt));
        await tester.pump();
        expect(
          find.text(l10n.legalAcceptTerms),
          findsOneWidget,
          reason:
              'the toggle did not flip, so the sweep below is about the '
              'sign-in arm again and the two consent boxes are not in the tree',
        );
        // 4 subjects.
        await expectGuidelineHadSubjects(tester, 'sign-in (sign-up arm)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on sign-up is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const SignUpScreen());
        // 4 subjects.
        await expectGuidelineHadSubjects(tester, 'sign-up');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on the reset FORM is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // 🔴 THE FORM, NOT THE DEAD-LINK STATE, AND THE CHOICE IS MEASURED.
        // Both states are swept for naked controls. Only this one gives the
        // guideline anything: the dead-link state's single way out sits under a
        // scroll boundary (see the non-sweeps at the bottom of this group), so a
        // case pumped there would pass over zero nodes. The host is built by
        // hand for the same reason the naked case builds it — unoverridden,
        // `authRepositoryProvider` resolves with nobody signed in, and no
        // session IS the dead-link state.
        final InMemoryAuthRepository auth = InMemoryAuthRepository();
        addTearDown(auth.dispose);
        await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
        await sizeSurface(tester, kPhone);
        final ProviderContainer c = ProviderContainer(
          overrides: <Override>[
            ...defaultWidthOverrides(),
            authRepositoryProvider.overrideWithValue(auth),
          ],
        );
        addTearDown(c.dispose);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: c,
            child: MaterialApp(
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const ResetPasswordScreen(),
            ),
          ),
        );
        for (int i = 0; i < 12; i++) {
          await tester.pump();
        }
        expect(
          find.byKey(ResetPasswordScreen.passwordField),
          findsOneWidget,
          reason:
              'the SUBJECT check — without it this sweeps the dead-link state '
              'and reports the form as clean without ever rendering it',
        );
        // 3 subjects — both password boxes and one of the two buttons.
        await expectGuidelineHadSubjects(tester, 'reset-password (the form)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on home is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const HomeScreen());
        // 7 subjects, and TWO of them were defects: the account avatar at
        // 44.0×44.0 and the "Calendar →" jump at 112.0×13.0. Both are labelled
        // controls, i.e. both are outside `_iconOnlyControls` and neither could
        // ever have failed the assertion this family replaces.
        await expectGuidelineHadSubjects(tester, 'home');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on settings is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // The tall viewport, for the naked sweep's reason: settings is the
        // longest ListView in the app and a ListView lays out only what fits.
        await pumpScreen(
          tester,
          const SettingsScreen(),
          size: const Size(375, 3000),
        );
        // 24 subjects — by some way the largest domain in the app, and the one
        // that most needed the `sizeSurface` fix: at the stale 800×600 view rect
        // the guideline inspected 10 of them and passed on the other fourteen.
        await expectGuidelineHadSubjects(tester, 'settings');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on notifications is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const NotificationsScreen());
        // 1 subject — the close button is the only control on a screen of
        // cards, stated rather than defaulted (the naked case measures the
        // same 1).
        await expectGuidelineHadSubjects(tester, 'notifications');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on the paywall is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // The rail override is the limb that refuses the empty screen: without
        // it the choosing phase never renders and there is nothing to buy, so
        // the guideline would inspect zero plan rows and pass.
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              purchaseRailProvider.overrideWithValue(
                HostedCheckoutRail(
                  config: const RailConfig(
                    offerings: <Offering>[
                      Offering(
                        productId: 'pro_monthly',
                        amountMinor: 499,
                        currencyCode: 'USD',
                        term: OfferingTerm.month,
                        trialDays: 30,
                      ),
                      Offering(
                        productId: 'pro_yearly',
                        amountMinor: 4999,
                        currencyCode: 'USD',
                        term: OfferingTerm.year,
                        trialDays: 0,
                      ),
                    ],
                    checkoutUrlTemplate: 'https://example.test/{price_id}',
                    manageUrlTemplate: null,
                  ),
                  appId: AppConfig.appId,
                  returnUrl: kCheckoutReturnUrl,
                  accountId: () async => 'a11y',
                  accessToken: () async => null,
                  cancellationTransport:
                      const core.UnavailableCancellationTransport(),
                  capabilities: const PurchaseCapabilities(
                    technicallySupported: true,
                    channelPermitted: true,
                    why: 'a11y sweep needs the populated choosing phase',
                  ),
                ),
              ),
            ],
            child: const PaywallScreen(),
          ),
        );
        // 2 subjects — one Upgrade per offering.
        await expectGuidelineHadSubjects(tester, 'paywall (choosing)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on manage-plan is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        // PRO, and stated: the cancel row is `if (isPro)`, so the default state
        // drops the control this screen exists for — the ROSCA requirement.
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              entitlementsProvider.overrideWith(
                (_) async => core.Entitlements(
                  appId: AppConfig.appId,
                  isPro: true,
                  items: const <core.Entitlement>[],
                ),
              ),
            ],
            child: const ManagePlanScreen(),
          ),
        );
        // 2 subjects — restore and cancel.
        await expectGuidelineHadSubjects(tester, 'manage-plan (pro)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on onboarding is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const OnboardingScreen());
        // 2 subjects — Skip and Next. Both were invisible to the guideline
        // before `sizeSurface`: they sit at the bottom of an 812-tall phone,
        // i.e. below the 600 logical pixels the stale view rect stopped at.
        await expectGuidelineHadSubjects(tester, 'onboarding');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on the add sheet is at least 48×48', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showAddSubscriptionSheet(context),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        // 6 subjects.
        //
        // ⚠️ AND THE MODAL SCRIM NEEDS NO EXCLUSION HERE, WHICH IS THE ONE PLACE
        // THIS FAMILY IS SIMPLER THAN THE NAKED ONE. The naked sweep has to step
        // around `showModalBottomSheet`'s `ModalBarrier` by hand — it carries a
        // tap action and no role flag, so it is naked in every Flutter app. The
        // guideline never sees it: the barrier fills the view, so it is at the
        // view boundary and skipped before any size is compared. Nothing is
        // being excluded; the framework's own rule already covers it.
        await expectGuidelineHadSubjects(tester, 'the add sheet');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    testWidgets('every tap target on the cancel sheet is at least 48×48 — in '
        'EITHER step', (WidgetTester tester) async {
      await semantically(tester, () async {
        final Subscription sub = Subscription(
          id: 'sub-1',
          name: 'Netflix',
          category: 'Streaming',
          price: 15,
          cycle: BillingCycle.monthly,
          nextRenewal: DateTime.utc(2026, 9, 12),
        );
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showCancelSheet(context, sub),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _load('en');

        // Step 0 — 2 subjects: 'Keep it' and the destructive confirm.
        await expectGuidelineHadSubjects(tester, 'the cancel sheet (step 0)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));

        // 🔴 STEP 1 IS A DIFFERENT TREE, the naked sweep's reason verbatim: the
        // sheet swaps its whole Column on `_step`, so a control added to the
        // success branch is invisible to any sweep that only measured the
        // confirmation branch.
        await tester.tap(find.text(l10n.confirmCancel));
        await tester.pumpAndSettle();
        expect(
          find.text(l10n.cancelledHeading),
          findsOneWidget,
          reason:
              'the confirmation never resolved, so the sweep below is about '
              'step 0 a second time',
        );
        // Step 1 — 1 subject: Done, the only way off the success step.
        await expectGuidelineHadSubjects(tester, 'the cancel sheet (step 1)');
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      });
    });

    // ── THE TWO SURFACES THAT GET NO SWEEP, AND WHY — ASSERTED, NOT ASSERTED
    //    ABOUT ────────────────────────────────────────────────────────────
    // 🔴 NEITHER IS A WCAG EXCEPTION. Both are surfaces on which
    // `androidTapTargetGuideline` inspects ZERO nodes, so a
    // `meetsGuideline(androidTapTargetGuideline)` beside them would be an
    // assertion that CANNOT FAIL — the shape this repository has recorded as
    // worse than none, because it inflates apparent coverage. Both keep their
    // `nothing on … is naked` sweep; only this family skips them.
    //
    // The two cases below are what stops that from being a prose claim that
    // rots. Each PINS the measured zero, so the day it stops being zero — a
    // control lands on budget, or a Flutter upgrade changes the traversal — the
    // suite goes red and says "now write the sweep" instead of leaving a
    // permanent hole nobody re-checks.
    testWidgets('budget hands the tap-target guideline NOTHING — pinned', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const BudgetScreen());
        // Budget is the one Tier-1 screen with no control on it at all — it is a
        // report, and its naked case says the same thing with a floor of 0. A
        // tap-target sweep here would range over an empty set forever.
        expect(
          await tapTargetSubjects(tester),
          0,
          reason:
              'budget now offers the tap-target guideline something to measure, '
              'and this family skips it on the grounds that it does not. Add '
              '`meetsGuideline(androidTapTargetGuideline)` for this screen and '
              'delete this case — the exception has expired.',
        );
      });
    });

    testWidgets('check-inbox hands the tap-target guideline NOTHING — pinned', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const CheckInboxScreen(email: 'a@b.test'));
        // 🔴 NOT THE APP'S DOING, AND MEASURED RATHER THAN INFERRED. This screen
        // has exactly one control, a Material `FilledButton`, and it measures
        // 48.0 tall — there is no defect here to find. It is skipped by
        // `MinimumTapTargetGuideline`'s scroll-boundary rule, which compares the
        // CHILD'S RECT IN ROOT SPACE against the SCROLLABLE'S RECT IN ITS OWN
        // LOCAL SPACE. Measured on this pump: AppBar 0..56, SingleChildScrollView
        // 56..440 (so 384 tall in its own space), button at 368..416 in root
        // space — 416 > 384, so the guideline reads it as hanging off the
        // scrollable's bottom edge and steps around it. Subtract the 56px AppBar
        // and it sits at 312..360, comfortably inside. The mismatch is the
        // framework's, it is the same for every Flutter app with a scrollable
        // under an AppBar, and it is deliberately NOT worked around here: the
        // whole reason this family uses the framework's guideline is that
        // re-deriving its skip rules by hand is how a sweep starts disagreeing
        // with the thing it claims to be.
        expect(
          await tapTargetSubjects(tester),
          0,
          reason:
              'check-inbox now offers the tap-target guideline something to '
              'measure — the framework traversal changed, or the screen no '
              'longer puts its control under a scrollable. Add '
              '`meetsGuideline(androidTapTargetGuideline)` for this screen and '
              'delete this case — the exception has expired.',
        );
      });
    });
  });

  // ═══ WCAG 1.4.3 · FLUTTER_TEST'S OWN TEXT-CONTRAST SWEEP ══════════════════
  //
  // 🔴 WHY THIS FAMILY EXISTS. `assert-a11y-coverage.mjs` has recognised a
  // `contrast` family since it was written, keyed on
  // `meetsGuideline(textContrastGuideline)`, and printed `contrast ×0` on every
  // run. The same "check that never started" shape [ADR 048] recorded for
  // tap-target, one family over: a matcher waiting for a call nobody made.
  //
  // ── WHAT THE MEASUREMENT SAID, AND WHY THE ANSWER IS NOT `contrastLevel` ──
  // Measured 2026-08-13 across 7 seeds and both brightnesses on Flutter 3.44.9:
  //   · `ColorScheme.fromSeed` is ALREADY AAA on body text — onSurface/surface
  //     16.29:1 light, 14.35:1 dark. Nothing to fix there.
  //   · Only the ACCENT falls short, and uniformly: `primary`/`surface` lands
  //     6.12–6.16:1 in LIGHT mode for EVERY hue, because M3 pins light `primary`
  //     to tone 40. `onPrimary`/`primary` is 6.46:1 light.
  //   · `contrastLevel: 1.0` fixes every pair AND flattens all brands to
  //     13.25–13.33:1 at near-identical LIGHTNESS. Contrast constrains lightness
  //     only, so fifty apps become fifty dark-on-white apps differing by hue —
  //     which undercuts the [pipeline C-11] fix whose whole stated purpose is
  //     surviving store clone-detection, where a clone-flag is a PORTFOLIO-wide
  //     event. It is deliberately NOT set.
  //   · `contrastLevel: 0.5` is NON-MONOTONIC:
  //     `onPrimaryContainer`/`primaryContainer` gets WORSE, 7.25:1 → 5.16:1.
  //
  // ── WHY AA IS THE BAR AND AAA IS ONLY REPORTED ───────────────────────────
  // The Definition of Done publishes AA, so AA is what these sweeps enforce and
  // AAA is noted per case via [meetsAAA] rather than gated. That is not
  // timidity: 🔴 SC 1.4.6 (Contrast Enhanced) governs TEXT AND IMAGES OF TEXT
  // ONLY, and there is NO AAA counterpart to SC 1.4.11 Non-text Contrast. So
  // "make everything AAA" is not even a well-formed instruction for a fill, a
  // chart segment or a FAB background — those live at 1.4.11's AA 3:1 whatever
  // the text bar is. The resolution the palette work carries is to keep the
  // bright brand accent for FILLS and darken a brand-derived tone only where the
  // accent is TEXT; this family is what measures the second half of that.
  //
  // ── 🔴 THE GUIDELINE IS A SCREENSHOT HEURISTIC, AND ITS OWN DOC SAYS SO ──
  // `_ContrastReport` (accessibility.dart:684) rasterises the layer, takes a
  // colour histogram of the text's paint bounds INFLATED BY 4 LOGICAL PIXELS,
  // splits those colours into "light" and "dark" AT THEIR MEAN LIGHTNESS, and
  // reports the ratio between the MODE of each group. Its own doc calls that "a
  // very naive partitioning". So the four FALSIFIERS below are not decoration —
  // they are the recorded proof of what this family can and cannot see, and
  // three of the four were WRONG about the answer before they were run:
  //   A · flat, 2.07:1 ...................... CAUGHT (the control)
  //   B · mid-grey on a white→black ramp .... CAUGHT at 3.76:1 — but by
  //       comparing the glyph fill to the SCAFFOLD colour the 4px inflate
  //       reached, never to the ramp. A smooth gradient has no mode.
  //   C · white text on a black→white ramp .. CAUGHT at 2.61:1. So "gradients
  //       defeat it" was the expected finding and it is FALSE as stated.
  //   D · white text on a WHITE box, 1.00:1,  NOT CAUGHT. Passes AA and AAA.
  //       The 4px inflate reached a black surround, which supplied the other
  //       mode. This is the real blind spot and it is about the INFLATE, not
  //       about gradients. See the case for why four pixels is enough to reach
  //       a divider, a card edge or an icon beside almost any label in this app.
  // 📌 A GREEN CASE IN THIS FAMILY MEANS NOTHING OBVIOUS IS WRONG. It is not
  // proof that every string is legible, which is why the token audit at the
  // bottom of this group is not redundant with the sweeps, and why the manual
  // screen-reader pass stays a recorded CUT (dod-register:134-141).
  //
  // ── TWO FALSIFIERS PER CASE, AND THE SECOND ONE FOUND THE REAL DEFECT ────
  // Vacuity first, same shape as the tap-target family's: a guideline that
  // inspects NOTHING returns `Evaluation.pass()`, so every case runs
  // [expectContrastHadSubjects], which re-runs the SAME class at an impossible
  // target ratio and counts what reports itself.
  //
  // 🔴 THEN [expectOpaqueGround], WHICH IS THE ONE THIS INCREMENT WAS ACTUALLY
  // PAID FOR. On the first run, 74 nodes across five surfaces were scored
  // against `dark - Color(alpha: 0.0000)` — a TRANSPARENT ground, which
  // `Color.computeLuminance()` reads as pure black. Insights' 26px heading, real
  // contrast 16.29:1, was reported at 1.15:1 and FAILED. The five AppShell
  // branch panes declare no `Scaffold` of their own and every case in this file
  // pumps them standalone, so their text was painted onto nothing. The other two
  // families never noticed because they never read a pixel. See
  // [expectOpaqueGround] and [pumpScreen]'s `paintBackground:`.
  group('contrast · flutter_test\'s own text-contrast sweep', () {
    // ── FALSIFIER A · THE FLAT CASE — the guideline DOES catch this ────────
    testWidgets('THE FALSIFIER · A — low-contrast text on a FLAT ground is caught', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpContrastFixture(
          tester,
          ColoredBox(
            color: const Color(0xFFFFFFFF),
            child: const Text(
              'deliberately unreadable',
              style: TextStyle(color: Color(0xFFB4B4B4), fontSize: 14),
            ),
          ),
        );
        // #B4B4B4 on #FFFFFF is 2.07:1 by the WCAG formula, against a 4.5 target
        // for 14px non-bold text. If this passes, the family below is measuring
        // nothing and every green case in it is worthless.
        expect(await contrastSubjects(tester), greaterThanOrEqualTo(1));
        final Evaluation e = await textContrastGuideline.evaluate(tester);
        expect(
          e.passed,
          isFalse,
          reason:
              'THE FALSIFIER PASSED. `textContrastGuideline` accepted 2.07:1 '
              'text, so it is not enforcing WCAG 1.4.3 and nothing below this '
              'line is a measurement. Do not fix the fixture — find out what '
              'changed in the guideline.',
        );
      });
    });

    testWidgets(
      'THE FALSIFIER · B — mid-grey on a ramp, caught by the SURROUND',
      (WidgetTester tester) async {
        await semantically(tester, () async {
          await pumpContrastFixture(
            tester,
            Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: <Color>[Color(0xFFFFFFFF), Color(0xFF000000)],
                ),
              ),
              child: const Text(
                'mid-grey text on a white-to-black ramp',
                style: TextStyle(color: Color(0xFF808080), fontSize: 14),
              ),
            ),
          );
          expect(await contrastSubjects(tester), greaterThanOrEqualTo(1));
          // CAUGHT — 3.76:1 against a 4.5 target. But read WHICH two colours
          // it compared: `light` is #FCF8FF, the SCAFFOLD's surface, reached
          // through the 4px inflate — not the ramp's white end — and `dark` is
          // #808080, the text itself. A smooth gradient has no mode: every one
          // of its colours occurs a handful of times, while the flat surround
          // and the glyph fill occur thousands. So the guideline did not
          // measure the text against its own background at all. It got the
          // right verdict from the wrong comparison, which is why FALSIFIER D
          // exists.
          final Evaluation e = await textContrastGuideline.evaluate(tester);
          expect(e.passed, isFalse, reason: 'falsifier B stopped failing: $e');
        });
      },
    );

    testWidgets('THE FALSIFIER · C — white text half-invisible on a ramp', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpContrastFixture(
          tester,
          ColoredBox(
            color: const Color(0xFF000000),
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: <Color>[Color(0xFF000000), Color(0xFFFFFFFF)],
                ),
              ),
              child: const Text(
                'white text vanishing into the white end of this ramp',
                style: TextStyle(color: Color(0xFFFFFFFF), fontSize: 14),
              ),
            ),
          ),
        );
        expect(await contrastSubjects(tester), greaterThanOrEqualTo(1));
        // CAUGHT — 2.61:1. White text on a black-to-white ramp is unreadable
        // across its right-hand half and the guideline says so, comparing
        // #FFFFFF (the glyphs) against #A0A0A0 (a mid-ramp colour that
        // happened to be the mode of the dark group). So a gradient is not
        // automatically a blind spot. What IS one is below.
        final Evaluation e = await textContrastGuideline.evaluate(tester);
        expect(e.passed, isFalse, reason: 'falsifier C stopped failing: $e');
      });
    });

    // ── 🔴🔴 FALSIFIER D · THE RECORDED BLIND SPOT — THIS ONE IS NOT CAUGHT ──
    //
    // WHITE TEXT ON A WHITE BOX. Contrast ratio 1.00:1. A sighted user sees an
    // empty rectangle. `textContrastGuideline` PASSES it, and so does
    // `MinimumTextContrastGuidelineAAA`.
    //
    // THE MECHANISM, WHICH IS GENERAL RATHER THAN A QUIRK OF THIS FIXTURE:
    // `_evaluateElement` (accessibility.dart:400) takes the histogram of
    // `renderBox.paintBounds.inflate(4.0)` — FOUR LOGICAL PIXELS WIDER THAN THE
    // TEXT ON EVERY SIDE — and `_ContrastReport` then reports the mode of the
    // colours above mean lightness against the mode of those below. Here that is
    // white (box + glyphs, thousands of pixels) against black (the 4px ring of
    // surround that the inflate reached), i.e. 21:1. The guideline never
    // compares a glyph to the pixels BEHIND that glyph; it compares the two
    // busiest colours in a slightly-too-big rectangle.
    //
    // 📌 WHY THIS MATTERS HERE RATHER THAN IN THE ABSTRACT: four pixels is
    // nothing. A label near a card edge, a divider, an icon, a chip border or a
    // section background — most labels in this app — has a contrasting colour
    // inside its inflated bounds, and any such colour can supply the "other"
    // mode and rescue an illegible pair. So a GREEN case in this family is
    // evidence that nothing OBVIOUS is wrong, and it is not proof that every
    // string is legible. That is exactly why the token audit at the bottom of
    // this group is not redundant with the twenty-four sweeps above it, and why
    // the manual screen-reader/eyes pass stays a recorded CUT
    // (dod-register:134-141) rather than something these cases replace.
    //
    // The assertion is deliberately `isTrue`: it PINS the gap. The day Flutter
    // sharpens the partition this case goes red, and the correct response is to
    // delete it and shrink the caveat above — not to weaken it.
    testWidgets('THE FALSIFIER · D — 1.00:1 text the guideline does NOT catch', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpContrastFixture(
          tester,
          ColoredBox(
            color: const Color(0xFF000000),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: ColoredBox(
                color: const Color(0xFFFFFFFF),
                child: const Text(
                  'white on white, 1.00 to 1',
                  style: TextStyle(color: Color(0xFFFFFFFF), fontSize: 14),
                ),
              ),
            ),
          ),
        );
        // Not vacuous: the guideline DID measure this string. It measured it
        // and approved it.
        expect(await contrastSubjects(tester), greaterThanOrEqualTo(1));
        final Evaluation aa = await textContrastGuideline.evaluate(tester);
        expect(
          aa.passed,
          isTrue,
          reason:
              'GOOD NEWS, AND IT INVALIDATES THIS CASE. '
              '`textContrastGuideline` now catches 1.00:1 text whose inflated '
              'paint bounds reach a contrasting surround, which it did not on '
              'Flutter 3.44.9 (measured 2026-08-13). Delete this case and cut '
              'the caveat above it back to what is still true.\n$aa',
        );
        expect(
          await meetsAAA(tester),
          isTrue,
          reason:
              'AAA now catches what AA does not, so the two levels no longer '
              'share the partition. Re-measure both before trusting either.',
        );
      });
    });

    testWidgets('every string on insights meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const InsightsScreen(),
          theme: appTheme(),
          paintBackground: true,
        );
        // 5 subjects. AA passes; AAA does not — see the group header.
        await expectOpaqueGround(tester, 'insights');
        await expectContrastHadSubjects(tester, 'insights');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on budget meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const BudgetScreen(),
          theme: appTheme(),
          paintBackground: true,
        );
        // 3 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'budget');
        await expectContrastHadSubjects(tester, 'budget');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on scan (results) meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const ScanScreen(), theme: appTheme());
        final AppLocalizations l10n = await _load('en');
        for (int i = 0; i < 6; i++) {
          await tester.pump(const Duration(milliseconds: 560));
        }
        expect(
          find.text(l10n.goToDashboard),
          findsOneWidget,
          reason:
              'the scan never reached its results phase, so the sweep below is '
              'about the scanning screen again',
        );
        // 6 subjects, and this case is RED on the tree of 2026-08-13.
        // MEASURED: `YOUR SUBSCRIPTIONS` (11px) is 3.97:1 — #6C57F7 on
        // #EAE6FE — against a 4.5 target. That is `AppColors.accent` used
        // as TEXT (scan_screen.dart:249), the exact case the seeded-palette
        // research predicted: the accent is fine as a FILL at 1.4.11's 3:1
        // and short as TEXT at 1.4.3's 4.5:1. Owned by the palette lane —
        // do not relax this assertion to make the suite green.
        await expectOpaqueGround(tester, 'scan (results)');
        await expectContrastHadSubjects(tester, 'scan (results)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on calendar meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const CalendarScreen(),
          theme: appTheme(),
          paintBackground: true,
        );
        // 34 subjects, joint-largest with settings. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'calendar');
        await expectContrastHadSubjects(tester, 'calendar');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on detail meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const SubscriptionDetailScreen(id: '1'),
          theme: appTheme(),
        );
        // 5 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'detail');
        await expectContrastHadSubjects(tester, 'detail');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the shell meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpShell(tester, theme: appTheme());
        // 8 subjects. This case pumps the REAL router, so it attributes to
        // no single domain surface — the shape assert-a11y-coverage.mjs
        // already reports for the shell's other two families.
        // AA passes; AAA does not.
        await expectOpaqueGround(tester, 'the shell (landed on /home)');
        await expectContrastHadSubjects(tester, 'the shell (landed on /home)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on verify-email meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const VerifyEmailScreen(), theme: appTheme());
        // 6 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'verify-email');
        await expectContrastHadSubjects(tester, 'verify-email');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on re-accept terms meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const ReacceptTermsScreen(),
          theme: appTheme(),
        );
        // 5 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 're-accept terms');
        await expectContrastHadSubjects(tester, 're-accept terms');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on sign-in meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen(), theme: appTheme());
        // 12 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'sign-in');
        await expectContrastHadSubjects(tester, 'sign-in');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the SIGN-UP ARM meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const LoginScreen(), theme: appTheme());
        final AppLocalizations l10n = await _load('en');
        await tester.tap(find.text(l10n.newHerePrompt));
        await tester.pump();
        expect(
          find.text(l10n.legalAcceptTerms),
          findsOneWidget,
          reason:
              'the toggle did not flip, so the sweep below is about the '
              'sign-in arm again and the two consent boxes are not in the tree',
        );
        // 5 subjects on the second door. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'sign-in (sign-up arm)');
        await expectContrastHadSubjects(tester, 'sign-in (sign-up arm)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on sign-up meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const SignUpScreen(), theme: appTheme());
        // 4 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'sign-up');
        await expectContrastHadSubjects(tester, 'sign-up');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the reset FORM meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        final InMemoryAuthRepository auth = InMemoryAuthRepository();
        addTearDown(auth.dispose);
        await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
        await sizeSurface(tester, kPhone);
        final ProviderContainer c = ProviderContainer(
          overrides: <Override>[
            ...defaultWidthOverrides(),
            authRepositoryProvider.overrideWithValue(auth),
          ],
        );
        addTearDown(c.dispose);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: c,
            child: MaterialApp(
              theme: appTheme(),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const ResetPasswordScreen(),
            ),
          ),
        );
        for (int i = 0; i < 12; i++) {
          await tester.pump();
        }
        expect(
          find.byKey(ResetPasswordScreen.passwordField),
          findsOneWidget,
          reason:
              'the SUBJECT check — without it this sweeps the dead-link state '
              'and reports the form as legible without ever rendering it',
        );
        // 4 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'reset-password (the form)');
        await expectContrastHadSubjects(tester, 'reset-password (the form)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    // ── CHECK-INBOX · MEASURED HERE, DELIBERATELY NOT SPELLED `meetsGuideline`
    //
    // 🔴 THE ONE SURFACE IN THE APP THIS FAMILY MUST NOT REGISTER ON, AND THE
    // REASON IS A DEPENDENCY IN THE OTHER DIRECTION — a guard's own negative
    // tests depend on a property of THIS file.
    //
    // `assert-a11y-coverage.mjs` keys the `contrast` family on the literal
    // `meetsGuideline(textContrastGuideline`. Its mutation ledger M1/M2/M2b
    // deletes ONE sweep call from a surface and asserts the surface moves out of
    // SWEPT — which only measures anything while that surface is swept by
    // EXACTLY ONE family. `CheckInboxScreen` is that surface, and
    // `tooling/ci/test/a11y-coverage.test.mjs:395` asserts the precondition by
    // name (`familiesOf(out, SUBJECT) == ['naked-controls']`) precisely because
    // a second family silently landed on the PREVIOUS subject, InsightsScreen,
    // and made all three mutations vacuous for a commit.
    //
    // After this increment every other surface carries two families, so there is
    // no surface left to re-point M1/M2/M2b at. Spelling `meetsGuideline` here
    // would take the count to 19 of 19 and disarm three of that guard's ten
    // mutations in the same change — trading a tally for the thing the tally is
    // supposed to be evidence of.
    //
    // So the screen IS swept, with the same guideline, the same falsifiers and
    // the same bar; only the spelling differs, and the cost is stated rather
    // than hidden: `contrast ×23` covers 18 of the 19 surfaces, and
    // `assert-a11y-coverage.mjs` cannot see this case. If M1/M2/M2b are ever
    // rewritten to delete EVERY sweep of their subject (the alternative that
    // guard's own failure message offers), replace the two lines below with
    // `await expectLater(tester, meetsGuideline(textContrastGuideline));` and
    // the nineteenth surface registers itself.
    testWidgets('every string on check-inbox meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const CheckInboxScreen(email: 'a@b.test'),
          theme: appTheme(),
        );
        // 5 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'check-inbox');
        await expectContrastHadSubjects(tester, 'check-inbox');
        final Evaluation e = await textContrastGuideline.evaluate(tester);
        expect(
          e.passed,
          isTrue,
          reason:
              'check-inbox carries text under WCAG 1.4.3 AA. Same guideline as '
              'every case above, spelled so the family matcher does not see it '
              '— read the comment above this case before "fixing" the '
              'spelling.\n$e',
        );
      });
    });

    testWidgets('every string on home meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const HomeScreen(),
          theme: appTheme(),
          paintBackground: true,
        );
        // 2 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'home');
        await expectContrastHadSubjects(tester, 'home');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on settings meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const SettingsScreen(),
          size: const Size(375, 3000),
          theme: appTheme(),
          paintBackground: true,
        );
        // 34 subjects, joint-largest with calendar. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'settings');
        await expectContrastHadSubjects(tester, 'settings');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on notifications meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const NotificationsScreen(),
          theme: appTheme(),
        );
        // 1 subject — the close button is the only string the guideline
        // reaches on a screen of cards. AA AND AAA both pass.
        await expectOpaqueGround(tester, 'notifications');
        await expectContrastHadSubjects(tester, 'notifications');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the paywall meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              purchaseRailProvider.overrideWithValue(
                HostedCheckoutRail(
                  config: const RailConfig(
                    offerings: <Offering>[
                      Offering(
                        productId: 'pro_monthly',
                        amountMinor: 499,
                        currencyCode: 'USD',
                        term: OfferingTerm.month,
                        trialDays: 30,
                      ),
                      Offering(
                        productId: 'pro_yearly',
                        amountMinor: 4999,
                        currencyCode: 'USD',
                        term: OfferingTerm.year,
                        trialDays: 0,
                      ),
                    ],
                    checkoutUrlTemplate: 'https://example.test/{price_id}',
                    manageUrlTemplate: null,
                  ),
                  appId: AppConfig.appId,
                  returnUrl: kCheckoutReturnUrl,
                  accountId: () async => 'a11y',
                  accessToken: () async => null,
                  cancellationTransport:
                      const core.UnavailableCancellationTransport(),
                  capabilities: const PurchaseCapabilities(
                    technicallySupported: true,
                    channelPermitted: true,
                    why: 'a11y sweep needs the populated choosing phase',
                  ),
                ),
              ),
            ],
            child: const PaywallScreen(),
          ),
          theme: appTheme(),
        );
        // 4 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'paywall (choosing)');
        await expectContrastHadSubjects(tester, 'paywall (choosing)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on manage-plan meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              entitlementsProvider.overrideWith(
                (_) async => core.Entitlements(
                  appId: AppConfig.appId,
                  isPro: true,
                  items: const <core.Entitlement>[],
                ),
              ),
            ],
            child: const ManagePlanScreen(),
          ),
          theme: appTheme(),
        );
        // 3 subjects. AA AND AAA both pass.
        await expectOpaqueGround(tester, 'manage-plan (pro)');
        await expectContrastHadSubjects(tester, 'manage-plan (pro)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on onboarding meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(tester, const OnboardingScreen(), theme: appTheme());
        // 11 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'onboarding');
        await expectContrastHadSubjects(tester, 'onboarding');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the add sheet meets WCAG AA contrast', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showAddSubscriptionSheet(context),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
          theme: appTheme(),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        // 17 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'the add sheet');
        await expectContrastHadSubjects(tester, 'the add sheet');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the cancel sheet meets WCAG AA contrast — in '
        'EITHER step', (WidgetTester tester) async {
      await semantically(tester, () async {
        final Subscription sub = Subscription(
          id: 'sub-1',
          name: 'Netflix',
          category: 'Streaming',
          price: 15,
          cycle: BillingCycle.monthly,
          nextRenewal: DateTime.utc(2026, 9, 12),
        );
        await pumpScreen(
          tester,
          Scaffold(
            body: Builder(
              builder: (BuildContext context) => Center(
                child: TextButton(
                  onPressed: () => showCancelSheet(context, sub),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
          theme: appTheme(),
        );
        await tester.tap(find.text('open'));
        await tester.pumpAndSettle();
        final AppLocalizations l10n = await _load('en');

        // Step 0 — 4 subjects. AA passes; AAA does not.
        await expectOpaqueGround(tester, 'the cancel sheet (step 0)');
        await expectContrastHadSubjects(tester, 'the cancel sheet (step 0)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));

        await tester.tap(find.text(l10n.confirmCancel));
        await tester.pumpAndSettle();
        expect(
          find.text(l10n.cancelledHeading),
          findsOneWidget,
          reason:
              'the confirmation never resolved, so the sweep below is about '
              'step 0 a second time',
        );
        // Step 1 — 3 subjects, a DIFFERENT TREE (the sheet swaps its whole
        // Column on `_step`). AA passes; AAA does not.
        await expectOpaqueGround(tester, 'the cancel sheet (step 1)');
        await expectContrastHadSubjects(tester, 'the cancel sheet (step 1)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    // ── DARK IS SHIPPED, SO DARK IS SWEPT ──────────────────────────────────
    testWidgets('every string on home meets WCAG AA contrast — DARK', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const HomeScreen(),
          theme: appTheme(brightness: Brightness.dark),
          paintBackground: true,
        );
        // 2 subjects, and this case is RED on the tree of 2026-08-13.
        // MEASURED: the `Calendar →` jump is 3.78:1 — #6459F5 on #131318.
        // That is `AppColors.accent` (home_screen.dart:451/459) painted
        // UNCONDITIONALLY, i.e. the light palette on the dark surface. It is
        // the cost app.dart:70-77 names in prose — `126 AppColors.*
        // references paint the LIGHT palette unconditionally` — with a
        // number attached for the first time.
        await expectOpaqueGround(tester, 'home (dark)');
        await expectContrastHadSubjects(tester, 'home (dark)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on settings meets WCAG AA contrast — DARK', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          const SettingsScreen(),
          size: const Size(375, 3000),
          theme: appTheme(brightness: Brightness.dark),
          paintBackground: true,
        );
        // 34 subjects, and this case is RED on the tree of 2026-08-13,
        // by the widest margin anywhere in the app.
        // MEASURED: the `Settings` heading is 1.01:1 — #141420 on #131318.
        // `AppColors.ink` on the dark surface: the text is INVISIBLE, not
        // merely low. `themeMode` defaults to `ThemeMode.system`
        // (app.dart:88), so this is what every dark-OS user is handed.
        // Owned by the palette lane / the scheduled theme fork.
        await expectOpaqueGround(tester, 'settings (dark)');
        await expectContrastHadSubjects(tester, 'settings (dark)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    testWidgets('every string on the paywall meets WCAG AA contrast — DARK', (
      WidgetTester tester,
    ) async {
      await semantically(tester, () async {
        await pumpScreen(
          tester,
          ProviderScope(
            overrides: <Override>[
              purchaseRailProvider.overrideWithValue(
                HostedCheckoutRail(
                  config: const RailConfig(
                    offerings: <Offering>[
                      Offering(
                        productId: 'pro_monthly',
                        amountMinor: 499,
                        currencyCode: 'USD',
                        term: OfferingTerm.month,
                        trialDays: 30,
                      ),
                    ],
                    checkoutUrlTemplate: 'https://example.test/{price_id}',
                    manageUrlTemplate: null,
                  ),
                  appId: AppConfig.appId,
                  returnUrl: kCheckoutReturnUrl,
                  accountId: () async => 'a11y',
                  accessToken: () async => null,
                  cancellationTransport:
                      const core.UnavailableCancellationTransport(),
                  capabilities: const PurchaseCapabilities(
                    technicallySupported: true,
                    channelPermitted: true,
                    why: 'a11y sweep needs the populated choosing phase',
                  ),
                ),
              ),
            ],
            child: const PaywallScreen(),
          ),
          theme: appTheme(brightness: Brightness.dark),
        );
        // 3 subjects. AA AND AAA both pass — the paywall is the one dark
        // surface that paints from the scheme rather than from AppColors.
        await expectOpaqueGround(tester, 'paywall (choosing, dark)');
        await expectContrastHadSubjects(tester, 'paywall (choosing, dark)');
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      });
    });

    // ── THE TOKEN AUDIT THE SCREENSHOT HEURISTIC CANNOT DO ────────────────
    //
    // 🔴 THIS IS NOT BELT-AND-BRACES, IT IS THE HALF THE SWEEPS ABOVE CANNOT
    // COVER. FALSIFIER D proves `textContrastGuideline` returns PASS — at AA
    // *and* AAA — for text at 1.00:1. A pair of tokens has no paint bounds, no
    // 4px inflate and no light/dark partition, so this limb cannot be fooled the
    // same way. Neither limb is redundant: the sweeps see what was PAINTED and
    // this sees what was CHOSEN.
    for (final (String name, Brightness brightness) in <(String, Brightness)>[
      ('light', Brightness.light),
      ('dark', Brightness.dark),
    ]) {
      test('the shipped $name scheme\'s text pairs clear WCAG AA', () {
        final ColorScheme s = appTheme(brightness: brightness).colorScheme;
        // Every pair M3 defines as "text/icon drawn ON this container". The
        // accent-as-TEXT pair `primary`/`surface` is in here deliberately: it is
        // the one the seeded-palette research found short, because M3 pins light
        // `primary` to tone 40 for EVERY hue.
        final Map<String, double> measured = <String, double>{
          'onSurface/surface': _ratio(s.onSurface, s.surface),
          'onSurfaceVariant/surface': _ratio(s.onSurfaceVariant, s.surface),
          'primary/surface': _ratio(s.primary, s.surface),
          'onPrimary/primary': _ratio(s.onPrimary, s.primary),
          'onPrimaryContainer/primaryContainer': _ratio(
            s.onPrimaryContainer,
            s.primaryContainer,
          ),
          'onSecondaryContainer/secondaryContainer': _ratio(
            s.onSecondaryContainer,
            s.secondaryContainer,
          ),
          'onTertiaryContainer/tertiaryContainer': _ratio(
            s.onTertiaryContainer,
            s.tertiaryContainer,
          ),
          'onError/error': _ratio(s.onError, s.error),
          'onErrorContainer/errorContainer': _ratio(
            s.onErrorContainer,
            s.errorContainer,
          ),
        };
        // 🔴 A `print` HERE SUPPRESSED `avoid_print` AND WAS DELETED, NOT
        // ALLOWLISTED. It dumped the whole token table on every run, including
        // every passing one — but the only value anyone reads is the one that
        // FAILED, and the `reason` below already carries that value, its pair
        // name and its bar. So the suppression bought duplicate output and cost
        // an exemption from a rule the whole factory inherits
        // (`assert-no-gate-weakening.mjs`, [pipeline N-4]). The full measured
        // table across seeds and brightnesses is recorded in [ADR 050], which is
        // where a reader looking for it should go.
        for (final MapEntry<String, double> e in measured.entries) {
          expect(
            e.value,
            greaterThanOrEqualTo(4.5),
            reason:
                '$name `${e.key}` is ${e.value}:1, under WCAG 1.4.3 AA (4.5 for '
                'normal text). This is a TOKEN fact — it holds on every screen '
                'that paints the pair, whatever any rasterised sweep above '
                'says, and it moves only when the seed or the scheme moves.',
          );
        }
      });
    }
  });
}

/// The WCAG contrast ratio between two OPAQUE colours, to 2dp.
///
/// Not a re-implementation of the guideline — the guideline works from PIXELS
/// and this works from TOKENS, which is the whole point. See the group header:
/// the framework's guideline is a screenshot heuristic with a naive light/dark
/// partition, and on a gradient it reports the GRADIENT's own range rather than
/// the text's legibility. A token pair has no gradient and no partition to get
/// wrong.
double _ratio(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return double.parse((((hi + 0.05) / (lo + 0.05))).toStringAsFixed(2));
}

/// The subscription the detail screen under test is showing, read from the
/// same provider the screen resolved rather than re-typed here — so the glyph
/// this test looks for is the glyph the screen was actually handed.
Subscription _seedSub(ProviderContainer c) {
  final List<Subscription> subs =
      c.read(subscriptionsControllerProvider).valueOrNull ??
      const <Subscription>[];
  expect(
    subs,
    isNotEmpty,
    reason:
        'COVERAGE LOST — the seed repository resolved to nothing, so the '
        'detail screen rendered its not-found branch and there is no hero to '
        'check.',
  );
  return subs.firstWhere((Subscription s) => s.id == '1');
}
