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

import 'package:flutter/material.dart';
// `rendering.dart` and NOT `semantics.dart`: material re-exports the widgets
// layer but neither of these, and rendering re-exports semantics — so this one
// import covers both `PipelineOwner` (the owner-tree walk in [_nodes]) and
// `SemanticsNode`/`SemanticsData`, while importing both makes the second an
// `unnecessary_import` info.
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbols.dart' show DateSymbols;
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/format/currency.dart';
import 'package:subly/core/format/sub_math.dart';
import 'package:subly/core/router.dart';
import 'package:subly/data/models/budget_info.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/features/budget/budget_screen.dart';
import 'package:subly/features/calendar/calendar_screen.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';
import 'package:subly/features/insights/insights_screen.dart';
import 'package:subly/features/scan/scan_screen.dart';
import 'package:subly/features/shared/widgets.dart';
import 'package:subly/features/shell/app_shell.dart';
import 'package:subly/l10n/app_localizations.dart';
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

// ─── hosts ───────────────────────────────────────────────────────────────────

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

/// [pumpAt]'s shape plus a locale, and it hands the container back.
///
/// The container is the point: every expected label below is built from the
/// SAME providers the screen read, so the assertion cannot drift from the data
/// the painter was given. Re-typing "₹2,340" here would pin the seed data, not
/// the label.
Future<ProviderContainer> pumpScreen(
  WidgetTester tester,
  Widget screen, {
  Locale locale = const Locale('en'),
  Size size = kPhone,
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: defaultWidthOverrides(),
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: screen,
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

class _SignedInAuth implements core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'a11y', email: 'a11y@test.dev');

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
Future<void> pumpShell(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(kPhone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      authRepositoryProvider.overrideWithValue(_SignedInAuth()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
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
