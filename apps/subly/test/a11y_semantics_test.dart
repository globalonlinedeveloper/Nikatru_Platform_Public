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
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart' show InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
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

class _SignedInAuth extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(
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
Future<void> pumpShell(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(kPhone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
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
        await tester.binding.setSurfaceSize(kPhone);
        addTearDown(() => tester.binding.setSurfaceSize(null));
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
