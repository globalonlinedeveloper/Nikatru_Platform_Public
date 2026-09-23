// ─────────────────────────────────────────────────────────────────────────────
// THE SHELL'S FLOATING "+" MAY NOT BE DRAWN OVER A ROW — ON ANY BRANCH.
//
// ── THE DEFECT THIS MEASURES ────────────────────────────────────────────────
// `AppScaffold._compact()` puts the nav pill in `bottomNavigationBar`, which
// RESERVES its own height out of the body, and the "+" in
// `floatingActionButton`, which reserves NOTHING: `FloatingActionButtonLocation
// .endFloat` lays it out OVER the body at
// `contentBottom - kFloatingActionButtonMargin - fabSize`. The chassis docking
// collapsed those two into one sentence — "both insets are now paid twice" —
// and took the branches' bottom inset from 108 to `AppSpacing.xl`, i.e. 24. The
// pill's share really was double-paid. The FAB's 72 px was simply dropped, and
// the last row of a scrolled list has been drawn under the button ever since:
// `01-home.png` of the frames merged as `9f548515` shows the "+" across the
// "per month" line of a price row, `04-budget.png` across a category amount.
//
// ── WHY THE SWEEP IS OVER EVERY BRANCH, AT EVERY SHELL LAYOUT ───────────────
// The FAB belongs to `AppShell`, not to any screen. It is in the tree on all
// five branches, in the bottom-nav layout AND the rail layout, so the exposure
// is a property of the SHELL. Padding the two frames somebody happened to
// capture would leave the rest open with nothing red to say so — which is
// exactly how the 108 was lost in the first place. The sweep therefore visits
// every branch at phone, tablet and desktop, and ALSO home's detail pane: at
// ≥ 840 px of body `SubscriptionDetailScreen` is embedded UNDER the shell, so
// the "+" floats over ITS last row too, although it is not a branch.
//
// ── WHAT IS MEASURED, AND WHAT MAKES IT ABLE TO FAIL ────────────────────────
// Every vertical, page-level `ListView` in the FAB's column (horizontally
// under the button) gets two assertions:
//
//   1. THE RESERVATION — the list's viewport and its bottom padding together
//      put the end of its content at or above the FAB's top, measured against
//      the RECTS the framework laid out
//      (`viewport.bottom - padding.bottom <= fab.top`). This holds for every
//      such list, scrolling or not: that is the closes clause ("the scrollable
//      list reserves the FAB's height plus its margin"), and a list that is
//      short today is one seed row away from reaching the band. WHICH of the
//      two pays depends on the window class: at compact the shell insets its
//      BODY by the band, so the viewport ends at the FAB's top; in the rail
//      classes the band is in the list's padding. The rect sum is the same
//      rule either way, and removing either payment turns it red.
//   2. THE PIXEL — for a list that scrolls, it is scrolled to its TRUE end and
//      its last laid-out child must end at or above the FAB's top.
//
// ⚠️ "TRUE END" IS A LOOP, NOT ONE `jumpTo`. `ListView(children:)` ESTIMATES
// its extent from the children built so far; a single
// `jumpTo(maxScrollExtent)` lands on the estimate, lays more children out,
// and the maximum grows under it. Measured on the first cut of this file: one
// jump left home's last row 30 px short of its end, and the rect compared was
// not the last row at all. [_scrollToEnd] jumps until `pixels` IS the max.
//
// ⚠️ AND NOTHING HERE MAY PASS BY MEASURING NOTHING. [_mustReachTheBand] names
// every (layout, branch) where a list is in the FAB's column against the seed
// data — each one is required to be found — and [_mustScroll] the ones whose
// list must actually reach its own end, so "it passed because the list moved
// sideways / got shorter" cannot become the reason this file is green.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart' show StatefulNavigationShell;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/shared/widgets.dart';
import 'package:subscriptiontracker/features/shell/app_shell.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/width_harness.dart';

/// The five branches, by the path `shell.dart` declares each one at.
///
/// Opened through the router and not by tapping the pill: the pill exists
/// only in the bottom-nav layout, and the rail layouts are half of this sweep.
const List<(String, String)> _branches = <(String, String)>[
  ('/home', 'home'),
  ('/calendar', 'calendar'),
  ('/insights', 'insights'),
  ('/budget', 'budget'),
  ('/settings', 'settings'),
];

/// The three shell layouts: bottom nav + pill (phone), rail (tablet), rail with
/// home split in two (desktop).
const List<(Size, String)> _layouts = <(Size, String)>[
  (kPhone, 'phone'),
  (kTablet, 'tablet'),
  (kDesktop, 'desktop'),
];

/// Every (layout, branch) where, against the seed data, a page-level list is in
/// the FAB's column — each is REQUIRED to be found, so a list cannot pass this
/// file by moving out of the button's way.
///
/// MEASURED 2026-09-22, not assumed. The four absent pairs are absent because
/// nothing is under the button there, not because nobody looked:
///   · desktop/insights, desktop/budget, desktop/settings — the page is one
///     column capped at 720 and centred in the 1163 px body, so the list ends
///     at x = 1058.5 and the FAB's column starts at 1208.
///   · desktop/home — home splits in two; the list pane ends at x = 559 and
///     the right pane is the placeholder until a row is selected. The case
///     "desktop/home detail pane" below selects one and measures THAT list.
const Set<String> _mustReachTheBand = <String>{
  'phone/home',
  'phone/calendar',
  'phone/insights',
  'phone/budget',
  'phone/settings',
  'tablet/home',
  'tablet/calendar',
  'tablet/insights',
  'tablet/budget',
  'tablet/settings',
  'desktop/calendar',
};

/// The (layout, branch) pairs whose list in the FAB's column must SCROLL on the
/// seed data, so assertion 2 — the drawn pixel — is exercised and not skipped.
/// Measured 2026-09-22: every pair that scrolls today. Calendar at all three
/// layouts, tablet/insights and the desktop detail pane fit without scrolling,
/// and for those assertion 1 (the reservation) is the whole check.
const Set<String> _mustScroll = <String>{
  'phone/home',
  'phone/insights',
  'phone/budget',
  'phone/settings',
  'tablet/home',
  'tablet/budget',
  'tablet/settings',
};

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

class _SignedInAuth extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser => const core.AuthUser(
    id: 'fab',
    email: 'fab@test.dev',
    emailVerified: true,
  );

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The WHOLE APP through its real router, pinned to [size].
///
/// Not optional: a `StatefulNavigationShell` cannot be constructed standalone,
/// so the FAB under test is reachable ONLY through the router. Same rig, and
/// the same overrides, as `a11y_semantics_test.dart`'s `pumpShell`. [overrides]
/// are appended last, so on riverpod 2.6.1 they win (see `pumpAt`).
///
/// [grab] wraps the app in ONE `RepaintBoundary` keyed [_grabKey], so [_grab]
/// can read the pixels a camera would. It changes no layout.
Future<ProviderContainer> _pumpShell(
  WidgetTester tester,
  Size size, {
  List<Override> overrides = const <Override>[],
  bool grab = false,
}) async {
  await setSurface(tester, size);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(_SignedInAuth()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      ...overrides,
    ],
  );
  addTearDown(c.dispose);
  final Widget app = MaterialApp.router(
    localizationsDelegates: <LocalizationsDelegate<dynamic>>[
      ...AppLocalizations.localizationsDelegates,
      ChassisLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    routerConfig: c.read(routerProvider),
  );
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: grab ? RepaintBoundary(key: _grabKey, child: app) : app,
    ),
  );
  await tester.pumpAndSettle();
  expect(
    find.byType(AppShell),
    findsOneWidget,
    reason:
        'the router did not land on the shell, so there is no FAB to measure '
        '— check the redirect overrides, not the layout',
  );
  return c;
}

Future<void> _open(
  WidgetTester tester,
  ProviderContainer c,
  String path,
) async {
  c.read(routerProvider).go(path);
  await tester.pumpAndSettle();
  expect(
    c.read(routerProvider).routeInformationProvider.value.uri.path,
    path,
    reason: 'the router did not open $path, so the wrong screen is measured',
  );
}

Rect _fab(WidgetTester tester) => tester.getRect(find.byKey(E2EKeys.fabAdd));

Finder _exactly(Element e) =>
    find.byElementPredicate((Element x) => identical(x, e));

/// Every vertical `ListView` in the FAB's column, as ELEMENTS (so scrolling one
/// list cannot shift which widget an index-based finder resolves to).
///
/// Page-level only: a list inside another vertical scrollable is part of that
/// scrollable's content, and the OUTER list's reservation is what clears it.
///
/// ⚠️ THE COLUMN, NOT "RUNS DOWN INTO THE BAND". The first cut also required
/// `bottom > fab.top`; the compact body now stops exactly AT the FAB's top, so
/// that filter would drop every phone list and the phone half of the sweep
/// would pass over nothing.
List<Element> _listsInTheFabColumn(WidgetTester tester, Rect fab) {
  final List<Element> out = <Element>[];
  for (final Element e in find.byType(ListView).evaluate()) {
    if ((e.widget as ListView).scrollDirection != Axis.vertical) continue;
    bool nested = false;
    e.visitAncestorElements((Element a) {
      final Widget w = a.widget;
      if (w is Scrollable && w.axis == Axis.vertical) {
        nested = true;
        return false;
      }
      return true;
    });
    if (nested) continue;
    final Rect r = tester.getRect(_exactly(e));
    if (r.right <= fab.left || r.left >= fab.right) continue;
    out.add(e);
  }
  return out;
}

ScrollableState _scrollerOf(WidgetTester tester, Finder list) =>
    tester.state<ScrollableState>(
      find.descendant(of: list, matching: find.byType(Scrollable)).first,
    );

/// Scrolls to the list's TRUE end — see the header for why one jump is not it.
Future<void> _scrollToEnd(WidgetTester tester, ScrollableState s) async {
  for (int i = 0; i < 40; i++) {
    final ScrollPosition p = s.position;
    if (p.pixels >= p.maxScrollExtent) return;
    p.jumpTo(p.maxScrollExtent);
    await tester.pumpAndSettle();
  }
  fail('the list never reached its own end in 40 jumps');
}

/// The bottom edge, in global coordinates, of the list's last laid-out child.
double _lastChildBottom(WidgetTester tester, Finder list) {
  final RenderSliverMultiBoxAdaptor sliver = tester
      .renderObject<RenderSliverMultiBoxAdaptor>(
        find
            .descendant(
              of: list,
              matching: find.byWidgetPredicate(
                (Widget w) => w is SliverMultiBoxAdaptorWidget,
              ),
            )
            .first,
      );
  final RenderBox last = sliver.lastChild!;
  return last.localToGlobal(Offset(0, last.size.height)).dy;
}

/// Asserts both halves of the rule on every list the FAB is drawn over, and
/// returns how many lists that was, and how many of them scrolled.
Future<({int lists, int scrolled})> _assertClears(
  WidgetTester tester,
  String where,
) async {
  final Rect fab = _fab(tester);
  final List<Element> lists = _listsInTheFabColumn(tester, fab);
  int scrolled = 0;
  for (final Element e in lists) {
    final Finder list = _exactly(e);
    final EdgeInsets pad = ((e.widget as ListView).padding ?? EdgeInsets.zero)
        .resolve(TextDirection.ltr);
    final Rect viewport = tester.getRect(list);
    expect(
      viewport.bottom - pad.bottom,
      lessThanOrEqualTo(fab.top),
      reason:
          '$where: a list in the FAB\'s column does not reserve its band. The '
          'FAB occupies ${fab.top}..${fab.bottom}; the list ($viewport) ends '
          'its content at ${viewport.bottom - pad.bottom} with a bottom inset '
          'of ${pad.bottom}. It needs AppShell.fabReservedHeight '
          '(${AppShell.fabReservedHeight}) of room below the last row — out '
          'of the body at compact, in the list\'s padding otherwise',
    );

    final ScrollableState s = _scrollerOf(tester, list);
    if (s.position.maxScrollExtent <= 0) continue;
    scrolled++;
    await _scrollToEnd(tester, s);
    final double end = _lastChildBottom(tester, list);
    expect(
      end,
      lessThanOrEqualTo(_fab(tester).top),
      reason:
          '$where: scrolled to its end, the list\'s last row is drawn down to '
          '$end, inside the FAB band that starts at ${_fab(tester).top}',
    );
  }
  return (lists: lists.length, scrolled: scrolled);
}

/// The lowest rect among [rows] — the row a FAB at the bottom would cover.
Rect _lowest(WidgetTester tester, Finder rows) {
  Rect lowest = tester.getRect(rows.first);
  for (int i = 1; i < rows.evaluate().length; i++) {
    final Rect r = tester.getRect(rows.at(i));
    if (r.bottom > lowest.bottom) lowest = r;
  }
  return lowest;
}

// ── PIXELS: THE FOLD FADE ───────────────────────────────────────────────────

/// The boundary [_pumpShell] puts round the app when asked to [grab].
const Key _grabKey = Key('width-shell-fab.grab');

/// One rendered frame: RGBA bytes, one pixel per LOGICAL pixel.
typedef _Frame = ({Uint8List rgba, int width, int height});

/// Largest per-channel gap tolerated between a pixel and the page ground. The
/// fade's solid tail is the exact ground colour, so this only absorbs raster
/// rounding.
const int _groundTolerance = 2;

/// How far above the fade's top [_straddle] puts a card's top edge, so a probe
/// halfway down that strip reads the card's own surface, clear of the fade.
const double _straddleLead = 8;

Future<_Frame> _grab(WidgetTester tester) async {
  final RenderRepaintBoundary boundary = tester
      .renderObject<RenderRepaintBoundary>(find.byKey(_grabKey));
  final _Frame? out = await tester.runAsync(() async {
    final ui.Image image = await boundary.toImage(pixelRatio: 1);
    final ByteData? bytes = await image.toByteData(
      format: ui.ImageByteFormat.rawRgba,
    );
    final _Frame frame = (
      rgba: bytes!.buffer.asUint8List(),
      width: image.width,
      height: image.height,
    );
    image.dispose();
    return frame;
  });
  expect(out, isNotNull, reason: 'the frame could not be read back');
  return out!;
}

/// The largest RGB channel gap between the pixel at ([x], [y]) and [ground].
int _offGround(_Frame f, int x, int y, Color ground) {
  final int i = (y * f.width + x) * 4;
  final int argb = ground.toARGB32();
  int worst = 0;
  for (final int d in <int>[
    (f.rgba[i] - ((argb >> 16) & 0xff)).abs(),
    (f.rgba[i + 1] - ((argb >> 8) & 0xff)).abs(),
    (f.rgba[i + 2] - (argb & 0xff)).abs(),
  ]) {
    if (d > worst) worst = d;
  }
  return worst;
}

/// The cards of the page at [path], inside its first list.
Finder _pageCards(String path) {
  final Finder list = find.byType(ListView).first;
  if (path == '/home') {
    return find.descendant(of: list, matching: find.byType(RowCard));
  }
  final RegExp barKey = RegExp(r'^budget\.bar\.\d+$');
  return find.descendant(
    of: list,
    matching: find.byWidgetPredicate(
      (Widget w) =>
          w.key is ValueKey<String> &&
          barKey.hasMatch((w.key! as ValueKey<String>).value),
    ),
  );
}

/// Scrolls the page's first list so the first card that fits sits with its
/// top [_straddleLead] px above the fade and its body across [foldY]. Returns
/// its rect after ONE jump, or null when no card can be put there within the
/// list's extent (a page that does not scroll, a card too short).
Future<Rect?> _straddle(WidgetTester tester, Finder cards, double foldY) async {
  final Finder list = find.byType(ListView).first;
  if (list.evaluate().isEmpty) return null;
  final ScrollableState s = _scrollerOf(tester, list);
  final double top = foldY - AppShell.foldFade - _straddleLead;
  // ⏱ 2026-09-23 · A LAZY LIST HAS NOT BUILT A ROW IT HAS NOT REACHED. On the
  // base this re-landed on, phone 360 /home at offset 0 built ZERO `RowCard`s
  // (measured: 1 list, 0 cards, maxScrollExtent 1060): the header, hero and
  // upcoming strip fill the viewport plus its cache extent, so the loop below
  // ran over nothing and returned null. Step half a viewport at a time until a
  // card exists, then measure from wherever that leaves the list.
  while (cards.evaluate().isEmpty &&
      s.position.pixels < s.position.maxScrollExtent) {
    s.position.jumpTo(
      (s.position.pixels + s.position.viewportDimension / 2).clamp(
        0.0,
        s.position.maxScrollExtent,
      ),
    );
    await tester.pumpAndSettle();
  }
  // Elements, not indexes: a jump rebuilds the list and would re-point
  // `cards.at(i)`.
  for (final Element e in cards.evaluate().toList()) {
    final Rect r = tester.getRect(_exactly(e));
    if (r.height <= AppShell.foldFade + _straddleLead) continue;
    final double target = s.position.pixels + r.top - top;
    if (target < 0 || target > s.position.maxScrollExtent) continue;
    s.position.jumpTo(target);
    await tester.pumpAndSettle();
    final Rect after = tester.getRect(_exactly(e));
    return after.top <= top + 0.5 && after.bottom > foldY ? after : null;
  }
  return null;
}

// ── AT REST: THE FRAME THE STORE ACTUALLY PHOTOGRAPHS ───────────────────────
// Everything above scrolls a list to its END. The store suite never does: it
// photographs each tab at scroll offset 0 (`store_screenshots_test.dart`, the
// "asserted where it lies, not after a scroll" note before `01-home`). A page
// inset only moves where a list ENDS, so on a phone the "+" can still float
// over a row in the middle of the page at rest — which is the frame #854
// shipped: the "per month" line of the Video streaming row under the button.

/// The phone the store photographs: `CAPTURES` in
/// `tooling/store/capture-play-screenshots.mjs`, 360×640 logical at dpr 3.
const Size _capturePhone = Size(360, 640);

/// The six rows the store suite seeds, as `kIllustrative` in
/// `integration_test/store_screenshots_test.dart` declares them: name, price,
/// category and (since 2026-09-22) the renewal offset in days. Copied rather
/// than imported (that file is an integration binding, not a library); the
/// first case of the group pins the copy to the source text, so the two cannot
/// drift apart silently.
const List<List<String>> _illustrative = <List<String>>[
  <String>['Video streaming', '15.99', 'Streaming', '3'],
  <String>['Music streaming', '10.99', 'Music', '6'],
  <String>['Cloud storage', '2.99', 'Cloud', '11'],
  <String>['AI assistant', '20.00', 'AI tools', '17'],
  <String>['Fitness club', '39.00', 'Fitness', '24'],
  <String>['News digest', '4.50', 'News', '29'],
];

/// The account the store photographs: the six rows, each renewing its own
/// offset in days from today (the suite types that date into the add sheet's
/// renewal picker), and the bare-zero budget `/budget` returns to a user who
/// never set one.
///
/// ⏱ 2026-09-22 · WAS "each renewing one monthly cycle from today (the add
/// sheet's default, which is how the suite seeds them)". Every row then read
/// the same "In N days", and `SubMath.upcoming` tied on all six.
class _IllustrativeRepo implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async {
    final DateTime today = DateTime.now();
    DateTime renews(List<String> row) =>
        DateTime(today.year, today.month, today.day + int.parse(row[3]));
    return <Subscription>[
      for (final List<String> row in _illustrative)
        Subscription(
          id: row[0],
          name: row[0],
          category: row[2],
          price: Money((double.parse(row[1]) * 100).round(), 'USD'),
          cycle: BillingCycle.monthly,
          nextRenewal: renews(row),
        ),
    ];
  }

  @override
  Future<BudgetInfo> budget() async => BudgetInfo.fromJson(<String, dynamic>{});

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

/// Every text glyph box a viewer can SEE that the FAB's rect covers, plus how
/// many visible boxes in the FAB's column were measured at all.
///
/// ⚠️ NOT `find.byType(Text).hitTestable()`, AND THE REASON IS THE DEFECT.
/// `hitTestable()` keeps a widget only if a hit test at its centre reaches it,
/// and the `Scaffold` hit-tests its FAB before its body — so a line whose
/// centre is under the "+" is exactly the line `hitTestable()` drops. The
/// filter would hide the very overlap this group exists to catch. What is
/// measured instead is what the camera sees:
///   · onstage only (the finder's default skips the four offstage branches);
///   · the GLYPHS, via `getBoxesForSelection`, not the paragraph's box — a
///     label in an `Expanded` has a box far wider than its words;
///   · clipped to every enclosing `Scrollable`, so a row laid out in the
///     cache extent below the viewport is not "under" anything;
///   · the FAB's own icon excluded (it is a `RichText` too).
({List<String> covered, int inColumn}) _visibleTextUnder(
  WidgetTester tester,
  Rect fab,
) {
  final Element button = find.byKey(E2EKeys.fabAdd).evaluate().single;
  final List<String> covered = <String>[];
  int inColumn = 0;
  for (final Element e in find.byType(RichText).evaluate()) {
    bool inButton = false;
    Rect clip = Rect.largest;
    e.visitAncestorElements((Element a) {
      if (identical(a, button)) {
        inButton = true;
        return false;
      }
      if (a.widget is Scrollable) {
        clip = clip.intersect(tester.getRect(_exactly(a)));
      }
      return true;
    });
    if (inButton) continue;
    final RenderParagraph p = e.renderObject! as RenderParagraph;
    final String text = p.text.toPlainText();
    if (text.isEmpty) continue;
    for (final TextBox b in p.getBoxesForSelection(
      TextSelection(baseOffset: 0, extentOffset: text.length),
    )) {
      final Rect local = b.toRect();
      final Rect seen = Rect.fromPoints(
        p.localToGlobal(local.topLeft),
        p.localToGlobal(local.bottomRight),
      ).intersect(clip);
      if (seen.width <= 0 || seen.height <= 0) continue;
      if (seen.right > fab.left && seen.left < fab.right) inColumn++;
      if (seen.overlaps(fab)) covered.add('"$text" at $seen');
    }
  }
  return (covered: covered, inColumn: inColumn);
}

void main() {
  group('the shell FAB clears every list it floats over', () {
    for (final (Size size, String layout) in _layouts) {
      for (final (String path, String name) in _branches) {
        final String where = '$layout/$name';
        testWidgets('$where reserves the FAB band', (
          WidgetTester tester,
        ) async {
          final ProviderContainer c = await _pumpShell(tester, size);
          await _open(tester, c, path);

          final ({int lists, int scrolled}) seen = await _assertClears(
            tester,
            where,
          );
          if (_mustReachTheBand.contains(where)) {
            expect(
              seen.lists,
              greaterThan(0),
              reason:
                  '$where found no list in the FAB\'s column, so the '
                  'clearance was asserted over nothing. If the layout really '
                  'moved the list out of the button\'s column, take it out of '
                  '_mustReachTheBand on purpose',
            );
          }
          if (_mustScroll.contains(where)) {
            expect(
              seen.scrolled,
              greaterThan(0),
              reason:
                  '$where no longer scrolls against the seed data, so the '
                  'drawn-pixel half was never exercised — fix the fixture, do '
                  'not delete the case',
            );
          }
        });
      }
    }

    // HOME'S DETAIL PANE IS NOT A BRANCH, AND IS STILL UNDER THE BUTTON. At
    // desktop home splits in two and the selected subscription renders as
    // `SubscriptionDetailScreen` INSIDE the branch, so the shell's "+" floats
    // over the right-hand pane — whose list padded 24 at its foot, with no
    // band. Pushed at `/sub/:id` the same screen sits above the shell and must
    // NOT pay the band; `AppShell.fabClearanceOf` is what tells the two apart.
    testWidgets('desktop/home detail pane reserves the FAB band', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await _pumpShell(tester, kDesktop);
      await _open(tester, c, '/home');
      final List<Subscription> subs = c
          .read(subscriptionsControllerProvider)
          .requireValue;
      expect(subs, isNotEmpty, reason: 'no seed rows to select');
      await tester.tap(
        find
            .descendant(
              of: find.byKey(const Key('home-list-pane')),
              matching: find.widgetWithText(RowCard, subs.first.name),
            )
            .first,
      );
      await tester.pumpAndSettle();
      expect(
        find.byType(SubscriptionDetailScreen),
        findsOneWidget,
        reason: 'the detail pane did not render beside the list',
      );

      final Finder pane = find.byKey(const Key('detail-body-pane'));
      final Element detailList = find
          .descendant(of: pane, matching: find.byType(ListView))
          .evaluate()
          .first;
      expect(
        _listsInTheFabColumn(tester, _fab(tester)),
        contains(detailList),
        reason:
            'the detail pane\'s list is not under the FAB at desktop, so this '
            'case measures nothing — the layout changed',
      );
      await _assertClears(tester, 'desktop/home+detail');
    });

    // THE INSTANCES, MEASURED THE WAY THE FRAMES SHOW THEM: a real row at the
    // very bottom, the button's rect, and no overlap. The sweep states the
    // rule; these state the pixels `01-home.png` and `04-budget.png` caught.
    testWidgets('phone/home: the last row does not intersect the FAB', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await _pumpShell(tester, kPhone);
      await _open(tester, c, '/home');
      final Finder list = find.byType(ListView).first;
      final ScrollableState s = _scrollerOf(tester, list);
      expect(
        s.position.maxScrollExtent,
        greaterThan(0),
        reason: 'home does not scroll against the seed data at phone size',
      );
      await _scrollToEnd(tester, s);

      final Finder rows = find.byType(RowCard);
      expect(
        rows,
        findsWidgets,
        reason:
            'home rendered no RowCard at all, so this case is measuring '
            'nothing — the seed data or the list changed',
      );
      final Rect lowest = _lowest(tester, rows);
      final Rect fab = _fab(tester);
      expect(
        fab.overlaps(lowest),
        isFalse,
        reason:
            'the FAB ($fab) is drawn across the bottom row ($lowest) — the '
            'defect 01-home.png photographed, where the "+" covers the '
            '"per month" line of a price',
      );
      // ⏱ 2026-09-22 · AND WHOLLY ABOVE THE FOLD FADE. The fade covers the
      // page's last [AppShell.foldFade] px; at the list's end the last row
      // must stop where the fade starts, or the end-inset no longer clears
      // it and the fade dims a row nobody can scroll further up.
      final Rect fade = tester.getRect(find.byKey(AppShell.foldFadeKey));
      expect(
        lowest.bottom,
        lessThanOrEqualTo(fade.top + 0.01),
        reason:
            'scrolled to its end, the last row ($lowest) runs into the fold '
            'fade, which starts at ${fade.top}',
      );
    });

    testWidgets('phone/budget: the last category card does not intersect '
        'the FAB', (WidgetTester tester) async {
      final ProviderContainer c = await _pumpShell(tester, kPhone);
      await _open(tester, c, '/budget');
      final Finder list = find.byType(ListView).first;
      final ScrollableState s = _scrollerOf(tester, list);
      expect(
        s.position.maxScrollExtent,
        greaterThan(0),
        reason: 'budget does not scroll against the seed data at phone size',
      );
      await _scrollToEnd(tester, s);

      final RegExp barKey = RegExp(r'^budget\.bar\.\d+$');
      final Finder bars = find.byWidgetPredicate(
        (Widget w) =>
            w.key is ValueKey<String> &&
            barKey.hasMatch((w.key! as ValueKey<String>).value),
      );
      expect(
        bars,
        findsWidgets,
        reason:
            'budget rendered no category card, so this case is measuring '
            'nothing — the seed caps or the list changed',
      );
      final Rect lowest = _lowest(tester, bars);
      final Rect fab = _fab(tester);
      expect(
        fab.overlaps(lowest),
        isFalse,
        reason:
            'the FAB ($fab) is drawn across the last category card ($lowest) '
            '— the defect 04-budget.png photographed, where the "+" covers a '
            'category amount',
      );
      // ⏱ 2026-09-22 · AND WHOLLY ABOVE THE FOLD FADE (see phone/home).
      final Rect fade = tester.getRect(find.byKey(AppShell.foldFadeKey));
      expect(
        lowest.bottom,
        lessThanOrEqualTo(fade.top + 0.01),
        reason:
            'scrolled to its end, the last category card ($lowest) runs into '
            'the fold fade, which starts at ${fade.top}',
      );
    });
  });

  // ── THE FOLD: WHAT THE CAMERA SEES WHERE THE PAGE STOPS ───────────────────
  // The cases above prove no row sits UNDER the button. None of them looks at
  // the row the page's bottom edge CUTS: sliced by a hard edge it reads as a
  // broken row in a store frame, which is what `AppShell.foldFade` fixes. A
  // missing fade shows only in pixels, so these read the rendered frame.
  //
  // 🔴 MUTATIONS (both must go red at phone 360):
  //   1. delete the fade's `Positioned` in `app_shell.dart` — the key check
  //      fails first ("no fold fade");
  //   2. keep it but make all three gradient colours `withAlpha(0)` — the key
  //      check passes and the PIXEL check fails ("… px off the ground").
  group('the fold: a card the page edge cuts fades into the ground', () {
    const List<(Size, String)> sizes = <(Size, String)>[
      (_capturePhone, 'phone 360'),
      (Size(900, 1600), 'tablet 900'),
      (Size(1280, 800), 'desktop 1280'),
    ];
    for (final (Size size, String label) in sizes) {
      for (final String path in <String>['/home', '/budget']) {
        testWidgets('$label $path: the device rows just above the fold are '
            'the page ground', (WidgetTester tester) async {
          final ProviderContainer c = await _pumpShell(
            tester,
            size,
            grab: true,
            overrides: <Override>[
              subscriptionRepositoryProvider.overrideWithValue(
                _IllustrativeRepo(),
              ),
            ],
          );
          await _open(tester, c, path);

          // The fold, measured WITHOUT the fade: where the branch's own box
          // stops (above the FAB band at compact, the window bottom in the
          // rail classes).
          final Rect shell = tester.getRect(
            find.byType(StatefulNavigationShell),
          );
          final double foldY = shell.bottom;
          final Finder fade = find.byKey(AppShell.foldFadeKey);
          expect(
            fade,
            findsOneWidget,
            reason:
                '$label $path: no fold fade, so a card the page edge cuts is '
                'drawn with a hard edge — the broken row the store frames showed',
          );
          final Rect fadeRect = tester.getRect(fade);
          expect(
            fadeRect.bottom,
            moreOrLessEquals(foldY),
            reason:
                '$label $path: the fade ends at ${fadeRect.bottom}, not at the '
                'fold ($foldY)',
          );
          expect(
            fadeRect.left <= shell.left && fadeRect.right >= shell.right,
            isTrue,
            reason:
                '$label $path: the fade ($fadeRect) does not span the page '
                '($shell)',
          );

          // Put a card ACROSS the fold, or the check below could pass over a
          // gap between cards with or without a fade.
          final Rect? card = await _straddle(tester, _pageCards(path), foldY);
          if (size == _capturePhone) {
            expect(
              card,
              isNotNull,
              reason:
                  '$label $path: no card could be scrolled across the fold, so '
                  'the pixel check would measure bare ground — the seed or the '
                  'layout changed',
            );
          }
          final Color ground = Theme.of(
            tester.element(find.byType(AppShell)),
          ).scaffoldBackgroundColor;
          final _Frame f = await _grab(tester);
          if (card != null) {
            final int probe = _offGround(
              f,
              card.center.dx.round(),
              (foldY - AppShell.foldFade - _straddleLead / 2).floor(),
              ground,
            );
            expect(
              probe,
              greaterThan(_groundTolerance),
              reason:
                  '$label $path: the card\'s own surface matches the page '
                  'ground, so a missing fade would not show — this case would '
                  'measure nothing',
            );
          }

          final Rect fab = _fab(tester);
          int off = 0;
          final List<String> sample = <String>[];
          for (
            int y = (foldY - AppShell.foldFadeSolid).ceil();
            y < foldY.floor();
            y++
          ) {
            for (int x = shell.left.ceil(); x < shell.right.floor(); x++) {
              // The FAB and its shadow float over the fade in the rail classes.
              if (x >= fab.left - 16 && x <= fab.right + 16) continue;
              final int d = _offGround(f, x, y, ground);
              if (d <= _groundTolerance) continue;
              off++;
              if (sample.length < 5) sample.add('($x,$y) by $d');
            }
          }
          expect(
            off,
            0,
            reason:
                '$label $path: $off px off the ground in the '
                '${AppShell.foldFadeSolid} rows above the fold ($foldY), '
                'e.g. ${sample.join(', ')} — the card is cut by a hard edge',
          );
        });
      }
    }
  });

  group('at rest, the frame the store photographs', () {
    test('the six rows are the store suite\'s own', () {
      final String source = File(
        'integration_test/store_screenshots_test.dart',
      ).readAsStringSync();
      final RegExpMatch? block = RegExp(
        r'kIllustrative = <List<String>>\[(.*?)\n\];',
        dotAll: true,
      ).firstMatch(source);
      expect(
        block,
        isNotNull,
        reason: 'kIllustrative is no longer declared where this pin reads it',
      );
      // Both directions: a row edited on either side, a row added to or
      // dropped from the source, or the order changed all fail here.
      //
      // ⏱ 2026-09-22 · THREE OR FOUR COLUMNS. The fourth is the renewal
      // offset in days. The pattern takes either shape, so this pin could
      // re-base alone before the column landed; a row is compared whole, so
      // an offset edited on either side fails here too.
      final List<List<String>> seeded =
          RegExp(
            r"<String>\['([^']*)', '([^']*)', '([^']*)'(?:, '([^']*)')?\]",
          ).allMatches(block!.group(1)!).map((RegExpMatch m) {
            return <String>[
              m.group(1)!,
              m.group(2)!,
              m.group(3)!,
              if (m.group(4) != null) m.group(4)!,
            ];
          }).toList();
      expect(
        seeded,
        _illustrative,
        reason:
            'kIllustrative no longer seeds these rows, so this group '
            'photographs an account the store suite does not — re-copy them',
      );
    });

    for (final (String path, String name) in _branches) {
      // Settings is not one of the store's frames.
      if (name == 'settings') continue;
      testWidgets('phone/$name at scroll offset 0: no visible text under the '
          'FAB', (WidgetTester tester) async {
        // The true 360×640 frame: `setSurface` pins layout but leaves
        // MediaQuery at the test default (see `width_harness.dart`).
        tester.view.physicalSize = const Size(1080, 1920);
        tester.view.devicePixelRatio = 3;
        addTearDown(tester.view.reset);
        final ProviderContainer c = await _pumpShell(
          tester,
          _capturePhone,
          overrides: <Override>[
            subscriptionRepositoryProvider.overrideWithValue(
              _IllustrativeRepo(),
            ),
          ],
        );
        await _open(tester, c, path);
        expect(
          c
              .read(subscriptionsControllerProvider)
              .requireValue
              .map((Subscription s) => s.name),
          unorderedEquals(_illustrative.map((List<String> r) => r[0])),
          reason: 'the fake account did not reach the controller',
        );
        for (final ScrollableState s in tester.stateList<ScrollableState>(
          find.byType(Scrollable),
        )) {
          expect(
            s.position.pixels,
            0,
            reason: 'phone/$name is not at rest, so this is not the frame',
          );
        }

        final Rect fab = _fab(tester);
        final ({List<String> covered, int inColumn}) seen = _visibleTextUnder(
          tester,
          fab,
        );
        expect(
          seen.inColumn,
          greaterThan(0),
          reason:
              'phone/$name shows no text at all in the FAB\'s column, so '
              '"nothing is under the button" was asserted over nothing',
        );
        expect(
          seen.covered,
          isEmpty,
          reason:
              'phone/$name at rest: the FAB ($fab) is drawn over visible '
              'text — the frame the store photographs. Covered: '
              '${seen.covered.join('; ')}',
        );
      });
    }
  });
}
