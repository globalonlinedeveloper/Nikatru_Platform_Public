// ─────────────────────────────────────────────────────────────────────────────
// P2.6b — THE HOME MERGE.  ⚠️ DRAFT: pre-fabricated, NOT yet compiled.
//
// Two files became one:
//
//   · the STAMPED home (chassis shell) contributed the `AppScaffold` adaptive
//     navigation, the `PaywallGate` Explore tab — the [pipeline C-6] OPEN PATH,
//     the only proven consumer of `paywallLockedProvider` — the
//     `CatchUpNudgeBanner` ([pipeline T-8]), and l10n.
//   · the LIVE home (the product) contributed everything a user came for: the
//     hero card, upcoming renewals, the all-subscriptions list, the unused-subs
//     warning, and the four navigation entry points that hang off them.
//
// VARIANT B (the shape that shipped — see the class doc below): `AppShell`
// kept scaffold ownership, so the stamped Explore placeholder DIED here (its
// gate moved to the router's Insights branch) and the only `welcomeTo` left in
// this file is the dashboard header's signed-out fallback — which is exactly
// what keeps `test/smoke_test.dart`'s `findsOneWidget` on 'Welcome to' honest.
//
// 🔴 THE ORDERING RULE THIS FILE ENCODES, because it is the one that bites:
// `overrides.md` §10-11 records that home and settings must merge AS A PAIR —
// `_showUnused` below reads `prefs['unused']`, which only the settings toggles
// write. Merging one screen without the other severs a coupling nothing tests.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
// The `/sub/:id` screen, imported so it can be BUILT IN PLACE in the second
// pane. It is still a route — `lib/core/router.dart` is untouched and a phone
// still pushes it — this import only gives the wide layout a way to render the
// same widget without a navigation.
import '../detail/subscription_detail_screen.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

/// Home — branch 0's BODY, VARIANT B ([ADR 037]; decision recorded in session
/// notes 2026-08-08): `AppShell` owns the adaptive [AppScaffold] (docked in
/// P2.6a via the `compactNavigationBar` seam), so this screen carries NO
/// scaffold of its own — nesting one inside the shell's body would render two
/// navigation surfaces at every width, wrong in a way no assertion covers.
/// The stamped 3-destination shell shape this draft originally carried lives
/// on in the brick; Subly's 5-tab product nav won the collision.
///
/// The `PaywallGate` ([pipeline 5]M-5's open path) did NOT die with the shell
/// ownership move — it wraps the INSIGHTS branch in `lib/core/router.dart`
/// (Subly's premium-surface default until Phase 4 decides finally), so
/// `paywallLockedProvider` keeps its one real consumer.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return const Column(
      children: <Widget>[
        // [pipeline T-8] Above everything: a nudge the user paid to see is not
        // a nudge. MOUNTED EXACTLY ONCE IN THE APP — chassis_properties_test
        // pumps the whole SublyApp and asserts findsOneWidget.
        CatchUpNudgeBanner(),
        // [research/44 §7 rung 3] The same-app upgrade card, the TWIN of the
        // brick's. In the stamped chassis it sits directly above `PaywallGate`
        // in the home body; here the gate moved to the router's Insights branch
        // with [ADR 037]'s Variant B, so the equivalent position is this one —
        // the same slot in the same Column, immediately under the nudge banner
        // and above the product dashboard. It renders NOTHING while
        // `features.promo_card_enabled` is absent, which it is.
        UpgradePromoCard(),
        Expanded(child: _HomeDashboard()),
      ],
    );
  }
}

/// Subly's product dashboard — the live `home_screen.dart` body, docked as the
/// Home destination. Everything below this line is the live file's own code and
/// its own comments; the merge changed four things and each is marked `🔀`.
///
/// 🔴 STATEFUL SINCE 2026-08-21, AND THE STATE IS ONE NULLABLE STRING.
/// [TwoPane] renders a detail beside the list and deliberately owns NEITHER
/// selection nor routing — its class doc says both belong to the screen and the
/// router respectively, because both outlive the layout. So this widget holds
/// the selected subscription id, and that is the whole reason it stopped being a
/// `ConsumerWidget`.
///
/// Screen state rather than a provider, deliberately: which row the second pane
/// is showing is not a fact about the user's data, nothing else in the app reads
/// it, and a provider would make it outlive the screen that owns it.
class _HomeDashboard extends ConsumerStatefulWidget {
  const _HomeDashboard();

  @override
  ConsumerState<_HomeDashboard> createState() => _HomeDashboardState();
}

class _HomeDashboardState extends ConsumerState<_HomeDashboard> {
  /// The row whose detail is showing in the second pane, or null for "nothing
  /// selected" — the state every cold start opens in.
  ///
  /// KEPT rather than cleared when the layout goes back to a single column: a
  /// window dragged narrow and wide again returns to the row the user was
  /// reading, and it costs nothing in the meantime, because [TwoPane] does not
  /// BUILD its `detail` below [AppBreakpoints.expanded] — no `initState`, no
  /// fetch and no analytics event for a pane nobody can see.
  String? _selectedId;

  /// The on-LIGHT tone for the unused-subs badge's `!`. **#956006, not
  /// [AppColors.warn] #F59E0B — and not `due.dart`'s #9C6406 either.**
  ///
  /// 🔴 THE GROUND IS THE WASH, NOT THE CARD, AND THAT IS THE WHOLE REASON
  /// THIS VALUE IS A THIRD ONE. The badge paints its glyph on
  /// `Color.fromRGBO(245, 158, 11, 0.16)` composited over `RowCard`'s own
  /// fill, so the legibility question is asked against the COMPOSITE. Measured
  /// 2026-08-21, both sides, over the two grounds `RowCard` actually resolves:
  ///   · LIGHT — 0.16 warn over #FFFFFF ⇒ **#FDEFD8**
  ///       [AppColors.warn] #F59E0B ....... **1.89:1**  ❌
  ///       `due.dart`'s `_warnOnLight` #9C6406 ... **4.37:1**  ❌ still short
  ///       THIS VALUE #956006 .............. **4.68:1**  ✅
  ///   · DARK — 0.16 warn over `scheme.surfaceContainerHighest` #35343A ⇒
  ///     **#544533**: [AppColors.warn] **4.30:1**, and it is UNTOUCHED — the
  ///     dark arm below still paints the shipped literal, so that branch
  ///     repaints by zero pixels and cannot regress. (The 4.31 recorded on
  ///     2026-08-21 and the 4.30 recomputed here are the same measurement one
  ///     rounding step apart, in the composite's blue channel.)
  ///
  /// ⚠️ AND THE FORK IS LOAD-BEARING IN BOTH DIRECTIONS, so this is not a value
  /// that could quietly replace the literal: #956006 on the DARK wash measures
  /// **1.74:1**. Adopting it unbranched would trade a light failure for a
  /// worse dark one — the same trap `app_colors.dart:101-104` measured for the
  /// token itself, one composite deeper.
  ///
  /// 🔴 SO THE PALETTE'S OWN OWED STEP DOES NOT COVER THIS GLYPH, AND THAT IS
  /// THE FINDING WORTH CARRYING UPSTREAM. `app_colors.dart:106-112` names the
  /// status-trio fork it owes and gives warn's light text tone as #9C6406, "a
  /// measured minimum step that clears every real ground" — but the grounds it
  /// measured are the white card, [AppColors.bg] #F4F4F8 and the live scaffold
  /// #FCF8FF. A 16 % warn wash over white is DARKER than all three (#FDEFD8),
  /// and #9C6406 lands at 4.37 on it. The owed token is not wrong; its
  /// enumeration of grounds is incomplete, and a badge is exactly the shape it
  /// missed. When `warnText` lands, this call site does NOT simply adopt it.
  ///
  /// HOW THE VALUE WAS CHOSEN, so it is a step and not a taste: identical hue
  /// and saturation to [AppColors.warn] (HSL 37.7° / 92 %), lightness stepped
  /// down from 50.2 % to **30.5 %** — one notch past the 31.8 % `due.dart`
  /// uses for the same hue on the lighter white card. It is a legibility step,
  /// not a re-tint: the badge still reads as the same amber warning, which is
  /// what keeps it one status treatment with the `accentBar` and the wash
  /// around it.
  ///
  /// 📌 IT IS A LOCAL CONST FOR THE SAME REASON `due.dart`'s is: the slot it
  /// belongs in (`warnText` on `AppThemeX`, resolved by brightness the way
  /// `AppText.of` resolves prose) is `packages/design_system`'s to mint, and
  /// that is a separate increment with a separate owner. This is the single
  /// place the value is spelled and it has exactly one reader.
  static const Color _warnGlyphOnWash = Color(0xFF956006);

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Currency currency = ref.watch(currencyProvider);
    final core.AuthUser? user = ref.watch(authRepositoryProvider).currentUser;
    // The `unused` setting was declared in settings_controller.dart and read
    // NOWHERE, so the switch in Settings did nothing. It now gates the surface it
    // describes: "Flag subscriptions you don't use".
    final bool showUnused =
        ref.watch(settingsControllerProvider).prefs['unused'] ?? true;
    final DateTime now = DateTime.now();
    final AsyncValue<List<Subscription>> subs = ref.watch(
      subscriptionsControllerProvider,
    );

    // ── THE SECOND COLUMN, AND WHY THE MEASUREMENT IS TAKEN HERE ─────────────
    // 🔴 IT MEASURES THE BOX, NOT THE WINDOW — the rule [TwoPane]'s header
    // states, and it bites harder here than there. `AppShell`'s `AppScaffold`
    // hands this body `min(W - 361, 1280)` (measured 2026-08-21), so "the window
    // is 1200" and "this screen has 1200" are 361 px apart. Read from
    // `MediaQuery` this `if` would open a second column inside a box that cannot
    // hold one, and nothing would overflow to say so — the hero would simply be
    // squeezed.
    //
    // 🔴 AND IT IS ABOVE THE TwoPane RATHER THAN INSIDE ITS `list`, WHICH IS THE
    // ONLY PLACE IT CAN GO. `TwoPaneSplit` caps the list column at
    // [AppBreakpoints.pane] (480) at every width from the split upward, and
    // BELOW the split the whole pane is under [AppBreakpoints.expanded] (840).
    // So `paneWidth >= large` asked anywhere inside `list` is an `if` that can
    // never be true — dead code wearing a feature's clothes. Asked here it sees
    // the whole body, which is the thing that actually has three columns in it.
    //
    // BOTH WIDTHS ARE EXISTING CONSTANTS. Neither is new:
    //  · [AppBreakpoints.large] (1200) is the TRIGGER, and it is the correct
    //    half of `AppBreakpoints` for this question. That class's own doc splits
    //    its constants into "WHICH NAVIGATION?" (medium/expanded/large/
    //    extraLarge) and "how wide may this CONTENT get?" (form/pane/reading).
    //    "How many columns does this page have?" is the first kind — the same
    //    reasoning the list pane's cap below uses to reach the OPPOSITE answer,
    //    which is why both are written out rather than assumed.
    //  · [AppBreakpoints.form] (420) is the COLUMN. The hero is one card — a
    //    label, a figure, two pills and two stat boxes — i.e. exactly the
    //    single-column shape `form` names, and it is the same floor [TwoPane]
    //    gives its own list column, so a three-column home repeats one column
    //    width rather than inventing a second.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        // The stated trigger: at [AppBreakpoints.large] the page WANTS a second
        // column (see above).
        final bool wantsAside = constraints.maxWidth >= AppBreakpoints.large;

        // 🔴 …AND THE FEASIBILITY CLAUSE, WITHOUT WHICH GETTING WIDER DELETES A
        // PANE. Measured 2026-08-21 against the real widths, not reasoned about:
        // the aside is paid for out of whatever [TwoPane] would otherwise have
        // had, so at a body of 1200 the panes are left 1200 − 420 − 1 = 779,
        // which is BELOW [AppBreakpoints.expanded] (840) and therefore not a
        // split at all. A user at 1199 with a subscription open, dragging their
        // window one pixel WIDER, would watch the detail pane vanish and the
        // hero take its place. Growth has to be monotonic: a wider window may
        // add a column, never remove one.
        //
        // 🔴 THE NUMBER IS NOT INVENTED, IT IS THE SUM OF THE THREE FLOORS —
        // `form` (420) + `dividerWidth` (1) + `expanded` (840) = 1261, the
        // narrowest body that can hold an aside AND a split. It is expressed as
        // that arithmetic rather than as a literal 1261 so it cannot drift from
        // the constants it is made of.
        //
        // ⚠️ SO `large` NEVER DECIDES THIS ON ITS OWN — 1261 > 1200, and that is
        // an honest conflict between two requirements rather than a bug: "the
        // hero sits beside the list from 1200" and "the detail sits beside the
        // list from 840" cannot both hold in 1200…1260 with sourced widths. The
        // detail wins that band, because it is the pane a user opened
        // deliberately and the hero is the one they did not. `wantsAside` is
        // kept as its own named clause anyway, because it is the POLICY and the
        // second clause is the ARITHMETIC — collapsing them into one number
        // would hide which of the two a future edit is changing.
        //
        // ⚠️ INSIDE THE CHASSIS THIS BAND IS NARROW AND IT IS NOT DEAD.
        // `AppScaffold` hands the body `min(W − 361, 1280)`, so the aside opens
        // at a window of 1622 and the body tops out at 1280 — an aside band of
        // 1261…1280. Pumped without a shell (the width test, and any future
        // re-parenting) it runs to whatever width the screen is given.
        final bool aside =
            wantsAside &&
            constraints.maxWidth -
                    AppBreakpoints.form -
                    TwoPaneSplit.dividerWidth >=
                AppBreakpoints.expanded;

        final Widget panes = TwoPane(
          // 🔴 THE `Builder` IS LOAD-BEARING, NOT TIDINESS.
          // `TwoPane.isTwoPaneOf` is an `InheritedWidget` lookup, so it only
          // answers for a context BELOW the TwoPane. `build`'s own context is
          // above it and would read `false` at every width — which is precisely
          // the "pushed route on top of a rendered detail pane" defect that
          // lookup exists to prevent, reintroduced by reading it one line too
          // high. Same class of mistake as reading `MediaQuery`, different
          // mechanism.
          list: Builder(
            builder: (BuildContext listContext) => _listColumn(
              listContext,
              l10n,
              currency,
              user,
              subs,
              now,
              showUnused,
              heroInList: !aside,
            ),
          ),
          // Null until a row is tapped, and below 840 never looked at: [TwoPane]
          // does not build `detail` there, so a phone still pushes `/sub/:id`
          // and still gets the detail as a full route over the shell.
          detail: _selectedId == null
              ? null
              // 🔴 `onClose` IS NOT OPTIONAL HERE EVEN THOUGH THE PARAMETER IS.
              // This is the arm that mounts the detail as a WIDGET, so nothing
              // was pushed and the location is still `/home` — a one-match
              // stack. Without this callback the screen falls through to its
              // router arm and every dismiss control on it throws `GoError:
              // There is nothing to pop` (GlitchTip SUBLY-9, fatal, and the
              // reason it was only ever seen from wide landscape windows).
              // Clearing the selection is also what the control is FOR: the
              // pane closes and the placeholder comes back.
              // `test/detail_pane_pop_test.dart` pins both halves.
              : SubscriptionDetailScreen(
                  id: _selectedId!,
                  onClose: () => setState(() => _selectedId = null),
                ),
          // ⬜ THE COPY IS AN EXISTING KEY AND NOT THE RIGHT ONE — DELIBERATE,
          // AND NAMED SO IT IS NOT MISTAKEN FOR AN OVERSIGHT. What this column
          // wants to say is "select a subscription to see its details", and no
          // arb key says it; `app_en.arb` / `app_ta.arb` are not this
          // increment's files to edit. A bare English literal here would render
          // untranslated in `ta` — the exact regression `l10n_group_home_test`
          // exists to catch — so the placeholder borrows the heading of the
          // column its chevron points back at instead. Minting the real key is
          // handed over rather than done in passing.
          placeholder: TwoPanePlaceholder(message: l10n.allSubscriptions),
        );

        if (!aside) return panes;

        return Row(
          // `stretch`, so the rule between the aside and the panes is drawn at
          // full height. Under the default `center` a `VerticalDivider` is
          // handed LOOSE height constraints and collapses to nothing — an
          // invisible divider that still reserves its width.
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            SizedBox(
              width: AppBreakpoints.form,
              child: _asideColumn(l10n, currency, subs, now),
            ),
            // The SAME divider [TwoPane] draws between ITS two columns, at the
            // same thickness and off the same constant, so a three-column home
            // has one kind of seam rather than two that nearly match.
            const VerticalDivider(
              width: TwoPaneSplit.dividerWidth,
              thickness: 1,
            ),
            Expanded(child: panes),
          ],
        );
      },
    );
  }

  /// The MASTER column: the account header, then everything the subscription
  /// list is made of. Below [AppBreakpoints.expanded] this is the ENTIRE screen,
  /// which is what [TwoPane.list] requires of it.
  ///
  /// 🔴 [context] MUST COME FROM INSIDE THE TwoPane — see the `Builder` in
  /// [build]. Passing `build`'s own context here compiles, renders identically,
  /// and silently disables the whole master-detail behaviour.
  Widget _listColumn(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    core.AuthUser? user,
    AsyncValue<List<Subscription>> subs,
    DateTime now,
    bool showUnused, {
    required bool heroInList,
  }) {
    // The decision [TwoPane] actually made, from the width [TwoPane] actually
    // had. It is also a DEPENDENCY, so this column rebuilds when the pane
    // crosses the breakpoint and cannot be left holding a stale answer after a
    // resize.
    final bool twoPane = TwoPane.isTwoPaneOf(context);

    // 🔀 MERGE CHANGE 1 of 4 — THE HEADER MOVED OUT OF `.when()`.
    //
    // The live file wrapped the WHOLE body in `subscriptionsControllerProvider
    // .when(...)`, so while the first fetch was in flight the screen was a bare
    // `CircularProgressIndicator` — no greeting, no account name, no way to
    // reach notifications or settings. That was survivable when the shell drew
    // the navigation; inside `AppScaffold` the header is also the only route to
    // /notifications, and a spinner that hides it is a dead end.
    //
    // It is ALSO what makes `test/smoke_test.dart` deterministic: that test
    // pumps `HomeScreen` in a bare `ProviderScope` with no overrides, so the
    // subscriptions fetch is still LOADING on the frame it asserts. With the
    // header inside `.when()` the tree would hold a spinner and
    // `find.textContaining('Welcome to')` would find nothing — a red that names
    // the copy and says nothing about the cause.
    //
    // Nothing in the header depends on the subscription list, so nothing is
    // being shown early or optimistically. Only the parts that need the data
    // wait for it.
    return ContentPane.reading(
      // 🔀 MERGE CHANGE 2 of 4 — THE WIDTH DECISION THIS SCREEN NEVER HAD.
      //
      // Same defect and same fix as PR #210's three screens. `AppScaffold` caps
      // the body at `kMaxBodyWidth` only in its EXTRA-LARGE class (>=1600), so
      // between 1200 and 1599 the hero card and every `RowCard` grew to the full
      // window — a 1550 px row with a glyph at one edge and a price at the
      // other. Nothing overflowed, nothing clipped, no assertion existed to fail.
      //
      // 🔴 720 (`AppBreakpoints.reading`), NOT 1280 — CORRECTED 2026-08-21,
      // BECAUSE THE 1280 CAP NEVER ONCE BOUND ON A REAL DESKTOP.
      //
      // The paragraph that used to stand here said `ContentPane`'s default
      // `kMaxBodyWidth` "makes the two agree instead of agreeing only past
      // 1600". That was true of the NUMBER and false of the SCREEN, and it is
      // corrected rather than deleted because the reasoning is what misled:
      // `AppScaffold` hands its body `min(W - 361, 1280)` — a 360 px drawer and
      // a 1 px divider are taken off the window first — so at a maximised 1440
      // the body is 1079 and at 1920 it is 1559-capped-to-1280. Measured
      // 2026-08-21: the 1280 cap DOES bind at 1920, and binds NOWHERE a real
      // 1440p or 1600p desktop lives. Between 839 and 1280 this screen was a
      // phone column that simply got wider — the exact defect the wrapper was
      // added to prevent, surviving inside the fix for it.
      //
      // Why `reading` (720) and not a fresh 840–960:
      //   · This body is ONE COLUMN OF CARDS — a hero card, then `RowCard`s
      //     that put a 40 px glyph, two short lines and a price on one line.
      //     `AppBreakpoints`' own doc splits its constants into "WHICH
      //     NAVIGATION?" (medium/expanded/large/extraLarge) and "how wide may
      //     this CONTENT get?" (form/pane/reading). 840 is `expanded`, a
      //     NAVIGATION number; borrowing it as a content cap is precisely the
      //     conflation that class exists to prevent, and a bare literal `900`
      //     would be the sixth private copy of a width the chassis already owns.
      //   · `reading` is the widest CONTENT width the design system has, and at
      //     720 a RowCard's two intrinsic ends stay within an eye-span of each
      //     other. Below 720 nothing changes (a `ConstrainedBox` may only
      //     tighten), so every phone and small tablet renders byte-identically.
      //
      // ⚠️ THIS PANE MOVED INTO THE LIST COLUMN ON 2026-08-21, SO THE BAND ITS
      // CAP BINDS IN IS NARROWER THAN IT WAS — corrected here rather than
      // deleted, because the 720 argument above is untouched and is still why
      // the number is 720. What changed is who hands this pane its width:
      // [TwoPane] gives the list column at most [AppBreakpoints.pane] (480) from
      // 840 up, and above [AppBreakpoints.large] this screen gives that column
      // `body - 421` before TwoPane splits it again. So `reading` is the BINDING
      // cap only between 720 and the split; above the split it is a no-op in
      // exactly the way it is already a no-op on a phone. KEPT, not removed: the
      // band it governs is every tablet and small-desktop window, and there it
      // is still the only thing standing between a `RowCard` and the full width
      // in a tree where nothing above this screen caps anything.
      //
      // ✅ POLICED SINCE #239 by `test/width_home_test.dart`.
      // ⚠️ THE COUNT AND THE CASE LIST THAT STOOD HERE ARE NOW FALSE AND ARE
      // CORRECTED, NOT DELETED. It read: "Deleting this wrapper fails all five
      // of its cases (375 · 768 · 1280 · 1920 · 1500) on the harness's `inPane`
      // guard; widening the cap back to `kMaxBodyWidth` fails the 768, 1280,
      // 1920 and 1500 ones." True of the one-column screen; false of this one.
      // At 1280/1920/1500 the list column is 420 or 480 wide and a 720 cap does
      // not bind there at all, so widening it is invisible to those cases. The
      // case that falsifies the CAP is now the band between 720 and the split —
      // 768 and 839 in the test — while every case still falsifies the PANE,
      // because they all resolve the `ListView` THROUGH this keyed pane via the
      // harness's `inPaneOf`.
      //
      // 🔴 THE KEY IS NOT DECORATION. There are now up to three `ListView`s on
      // this screen (aside · list · the detail screen's own), and
      // `width_harness.dart`'s `inPane` resolves `.first` — "whichever the
      // element tree happened to visit first", which is right by accident and
      // wrong the day the columns are reordered. `inPaneOf(find.byKey(...), …)`
      // exists for exactly this shape.
      key: const Key('home-list-pane'),
      child: ListView(
        // 🔀 MERGE CHANGE 3 of 4 — PADDING RE-BASED FOR THE CHASSIS SHELL.
        // Live was `fromLTRB(18, 58, 18, 108)`. Both odd numbers were paying for
        // the old shell: 58 cleared a status bar under a `Scaffold` with no app
        // bar, and 108 cleared `AppShell`'s floating pill bar plus its FAB.
        // `AppScaffold._compact()` wraps the body in a `SafeArea` and puts the
        // navigation in `bottomNavigationBar`, so both insets are now paid twice
        // — 58 px of dead space under the notch and 108 px under the last row.
        // 18 is `AppSpacing.gutterCompact`, the chassis's own page gutter.
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.xl,
        ),
        children: <Widget>[
          _header(context, l10n, user),
          const SizedBox(height: 18),
          ...subs.when(
            loading: () => const <Widget>[
              Padding(
                padding: EdgeInsets.only(top: 48),
                child: Center(child: CircularProgressIndicator()),
              ),
            ],
            // ⚠️ `couldNotLoad` INTERPOLATES THE RAW EXCEPTION, and the arb
            // key preserves that verbatim rather than quietly improving it.
            // Leaking a stack-adjacent string at a user is a real defect
            // (WORKORDER §1 flags it), but it is a COPY decision and this is
            // an l10n increment: changing what the sentence says here would
            // hide the leak behind a translation commit instead of fixing it
            // where it can be reviewed.
            error: (Object e, _) => <Widget>[
              Padding(
                padding: const EdgeInsets.only(top: 48),
                child: Center(
                  // `AppText.of`, not the bare const: `AppText.muted`
                  // bakes `AppColors.muted` and paints the same grey on a
                  // dark scaffold. An error message is the one string that
                  // must be readable when everything else has failed.
                  child: Text(
                    l10n.couldNotLoad('$e'),
                    style: AppText.of(context).muted,
                  ),
                ),
              ),
            ],
            data: (List<Subscription> list) => _dashboard(
              context,
              l10n,
              currency,
              list,
              now,
              showUnused,
              heroInList: heroInList,
              twoPane: twoPane,
            ),
          ),
        ],
      ),
    );
  }

  /// The hero, lifted out of the scroller and into a column of its own at
  /// [AppBreakpoints.large] and above.
  ///
  /// 🔴 IT READS `valueOrNull` RATHER THAN `.when`, AND THAT IS NOT A SHORTCUT.
  /// The spinner and the error sentence belong in exactly ONE place, and that
  /// place is the list column — the one the user is reading. A second spinner
  /// beside the first reports one fetch as two, and a second `couldNotLoad`
  /// reports one failure as two. While the fetch is in flight this column is
  /// therefore EMPTY, which is the honest state: there is no monthly total yet
  /// to put in it.
  Widget _asideColumn(
    AppLocalizations l10n,
    Currency currency,
    AsyncValue<List<Subscription>> subs,
    DateTime now,
  ) {
    final List<Subscription>? data = subs.valueOrNull;
    return ListView(
      key: const Key('home-aside'),
      // The SAME gutter the list column uses, so the hero's top edge and the
      // account header's top edge start on one line rather than a few pixels
      // apart. A scroller, not a `Column`, because a short window must still be
      // able to reach the bottom of the hero.
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.gutterCompact,
        AppSpacing.gutterCompact,
        AppSpacing.gutterCompact,
        AppSpacing.xl,
      ),
      children: <Widget>[
        if (data != null)
          _heroCard(
            l10n,
            currency,
            SubMath.totalMonthly(data),
            data.length,
            SubMath.dueWithin(data, now, 7),
            SubMath.dueWithin(data, now, 30),
          ),
      ],
    );
  }

  /// Greeting, account name, notifications and the avatar shortcut. Independent
  /// of the subscription list — see MERGE CHANGE 1.
  Widget _header(
    BuildContext context,
    AppLocalizations l10n,
    core.AuthUser? user,
  ) {
    // 🔴 `AppText.of(context)`, NOT THE BARE CONSTS — THE GREETING AND THE
    // ACCOUNT NAME ARE THE FIRST TWO STRINGS THE APP EVER PAINTS.
    //
    // `AppText.title` / `.muted` bake `AppColors.ink` (#141420) and
    // `AppColors.muted` into `const TextStyle`s, so they paint near-black
    // whatever the ambient brightness is — the gap `dark_group_home_test.dart`
    // names in its own header ("⬜ WHAT THIS INCREMENT DOES NOT FIX"). `of`
    // returns THE SAME const objects in light (`identical`, by construction),
    // so this repaints nothing for the owner's light build and only fixes dark.
    final AppTextStyles text = AppText.of(context);
    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                _greeting(l10n, DateTime.now()),
                style: text.muted.copyWith(fontSize: 12),
              ),
              // 🔀 MERGE CHANGE 4 of 4 — THE SIGNED-OUT FALLBACK IS NOW THE
              // LOCALISED WELCOME.
              //
              // Live rendered the bare literal `'Welcome'`. The stamped home's
              // whole visible copy was `l10n.welcomeTo(appName)`, and dropping it
              // would delete the only translated string on this surface AND turn
              // `smoke_test.dart:29` red. Using it HERE keeps the key earning its
              // keep on the destination the test actually pumps, and "Welcome to
              // Subly" over "Good morning" reads better than a bare "Welcome".
              //
              // ⚠️ `AppConfig.appName` DIFFERS BETWEEN THE TWO CONFIGS THIS
              // MERGE IS SANDWICHED BETWEEN — live says `Subly`, the stamp says
              // `Subly — Subscription Tracker`. This line renders whichever
              // P2.5's de-duplication keeps. See MANIFEST.md · FINDING 2.
              Text(
                user?.displayName ?? l10n.welcomeTo(AppConfig.appName),
                style: text.title.copyWith(fontSize: 24),
              ),
            ],
          ),
        ),
        // [13]T-9's home entry point. `push`, not `go`: notifications is a
        // detail over the shell, and the user must come back to where they were.
        //
        // ⬜ `dot: true` IS UNCONDITIONAL — it is a badge that is always on, so
        // it carries no information. Pre-existing (it is live behaviour, carried
        // verbatim) and deliberately NOT fixed here: an unread count needs a
        // source, and inventing one inside a merge increment is how a merge
        // stops being reviewable. Named in MANIFEST.md · OPEN QUESTION 4.
        _circleButton(
          context: context,
          icon: Icons.notifications_none_rounded,
          semanticLabel: l10n.notifications,
          dot: true,
          onTap: () => context.push('/notifications'),
        ),
        const SizedBox(width: 9),
        // KEPT ALONGSIDE the Settings nav destination, deliberately. They are
        // not redundant: the destination is the discoverable route (labelled, in
        // the rail and the drawer at every width above 600), the avatar is the
        // conventional one (top-right, where a user looks for their account) and
        // it is the only one that shows WHICH account is signed in. Removing
        // either leaves a real user group without the affordance it looks for.
        // 🔴 ITS ONLY VISIBLE CONTENT IS ONE LETTER. `user?.initial ?? 'A'` is
        // the account initial, so a screen reader announced this control as
        // "R" — a letter, with no role and no destination. That is the worst of
        // the three states an unlabelled control can be in: not silent (which at
        // least reads as "unknown"), but confidently wrong.
        //
        // The letter is dropped rather than appended to: the initial is a
        // visual shorthand for "your account", and hearing the shorthand AND
        // its expansion ("Account and settings R") is the stutter [GlyphTile]
        // records. Which account is signed in is already announced by the
        // greeting and the display name to the left of this row.
        //
        // 🔴 THE EXCLUSION IS `ExcludeSemantics` AROUND THE VISUAL, NOT
        // `excludeSemantics: true` ON THE ANNOTATION — AND THE DIFFERENCE IS
        // THE WHOLE CONTROL. This read
        // `Semantics(button: true, label: …, excludeSemantics: true)` wrapped
        // around the `GestureDetector`, and that flag drops the ENTIRE subtree
        // beneath the annotation: the account initial it was aimed at, and the
        // gesture handler's `SemanticsAction.tap` with it. So the node
        // announced "Account and settings, button" and had no action to
        // perform — and a screen reader's double-tap dispatches the action to
        // the node rather than synthesising a pointer event, so the ONE route
        // to /settings a reader can find did nothing at all. Sighted taps were
        // unaffected (hit-testing never consults semantics), which is why this
        // shipped.
        //
        // Moving the exclusion inside the gesture handler keeps every property
        // the old spelling was for — the annotation still supplies the role and
        // the name, the letter is still silent — and leaves the tap action on
        // the node that announces the button. Same shape as the settings
        // profile card, which had it right.
        //
        // ✅ POLICED by the `home ·` group in `test/a11y_semantics_test.dart`:
        // restoring `excludeSemantics: true` here fails its third limb by name.
        // `expectNothingNaked` cannot see this defect in either direction — it
        // ranges over nodes that HAVE a tap action, so a control missing one is
        // exactly the control it skips.
        //
        // 🔴 THE THIRD KEYBOARD-DEAD CONTROL ON THIS SCREEN, AND THE
        // SUBSTITUTION IS DELIBERATELY NARROW: `FocusableTap` re-emits the same
        // `Semantics(button: true, label: …)` this had, keeps the
        // `ExcludeSemantics` exactly where the paragraph above argues it
        // belongs — INSIDE, round the visual, so the tap action stays on the
        // node that announces the button — and adds only the `FocusNode` the
        // pair never created. `mergeDescendants: false` preserves the previous
        // spelling: the annotation was bare `Semantics`, not `MergeSemantics`,
        // and there is nothing beneath it left to merge anyway.
        FocusableTap(
          label: l10n.a11yAccountSettings,
          mergeDescendants: false,
          borderRadius: BorderRadius.circular(14),
          onTap: () => context.go('/settings'),
          child: ExcludeSemantics(
            // 🔴 48, NOT 44 — AND THE 44 SURVIVED BECAUSE IT WAS BESIDE THE
            // ONE ASSERTION THAT COULD NOT SEE IT. `_circleButton` nine
            // pixels to the left is 48 and says so in its own comment ("48px,
            // not 44: the chassis floor for an icon-only tap target"); this
            // control does the same job in the same row and shipped at 44.
            // `chassis_properties_test`'s 48px limb ranges over
            // `_iconOnlyControls`, which filters to controls with NO `Text`
            // descendant — and this one has one, the account initial. So the
            // ONE control in the header the floor did not apply to is the one
            // that missed it. [ADR 048] defect 1, found by the sweep that
            // replaces the mistitled assertion: measured 44.0x44.0 against
            // androidTapTargetGuideline's 48.
            //
            // The row was ALREADY 48 tall (the bell sets it), so this changes
            // the avatar's own box and nothing around it.
            child: Container(
              width: 48,
              height: 48,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: AppColors.brandGradient,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                user?.initial ?? 'A',
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Everything that needs the subscription list. Returns a list so the header
  /// above can stay outside the async boundary.
  ///
  /// [heroInList] is false once the hero has its own column — see
  /// [_asideColumn]. [twoPane] is [TwoPane.isTwoPaneOf] read inside the pane and
  /// threaded down rather than re-derived, so every row on this screen decides
  /// push-vs-select from the SAME measurement the layout used.
  List<Widget> _dashboard(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    List<Subscription> subs,
    DateTime now,
    bool showUnused, {
    required bool heroInList,
    required bool twoPane,
  }) {
    final double total = SubMath.totalMonthly(subs);
    final double dueSoon = SubMath.dueWithin(subs, now, 7);
    final List<Subscription> unused = SubMath.unused(subs);
    final double savings = SubMath.savings(subs);
    final List<Subscription> upcoming = SubMath.upcoming(subs, now);
    final List<Subscription> all = SubMath.byMonthlyDesc(subs);

    return <Widget>[
      // 🔴 THE HERO IS IN THIS COLUMN ONLY WHILE THERE IS NO COLUMN OF ITS OWN.
      // At and above [AppBreakpoints.large] the same card is built by
      // [_asideColumn]; building it in both places would put two hero cards on
      // one screen, each quoting the same monthly total, which reads as a
      // duplicated render rather than a layout.
      if (heroInList) ...<Widget>[
        _heroCard(
          l10n,
          currency,
          total,
          subs.length,
          dueSoon,
          SubMath.dueWithin(subs, now, 30),
        ),
        const SizedBox(height: 14),
      ],
      if (showUnused && unused.isNotEmpty)
        RowCard(
          accentBar: AppColors.warn,
          onTap: () => context.go('/insights'),
          // ⬜ THE WARN BADGE AND ITS BAR STAY UNCONDITIONAL, AND THAT IS A
          // DECISION RATHER THAN A MISS. The 3 px `accentBar`, the 16 % wash
          // below and the `!` riding it are ONE deliberate status treatment in
          // the brand's warn hue — the same hue the `unused` dot in [_subTile]
          // uses — so they are FILLS carrying meaning, not prose that follows a
          // ground.
          //
          // 🔴 THE `!` WAS ILLEGIBLE IN LIGHT, AND THE PARAGRAPH THAT STOOD
          // HERE DIAGNOSED IT AND THEN DREW THE WRONG CONCLUSION. It read: "A
          // BRIGHTNESS FORK CANNOT FIX WHAT IS WRONG WITH THE `!` … so it
          // belongs to whoever owns the palette." CORRECTED 2026-08-21, not
          // deleted, because the half that was TRUE is why the fix has the
          // shape it has.
          //
          // TRUE: the failing side is the LIGHT one — the side every other fork
          // in this file leaves byte-identical on purpose — so a fork whose
          // light arm is the shipped literal is a no-op here, and forking that
          // way would have shipped a dead `if` reporting healthy.
          // FALSE: the conclusion. A fork fixes it fine; it just has to move
          // the LIGHT arm, which is exactly what `due.dart`'s `_warnOnLight`
          // already does for the due label on this same screen. That is a
          // CALL-SITE change, not a token change: [AppColors.warn] does not
          // move and must not — `app_colors.dart:76-78`'s "NO VALUE HERE CAN
          // FIX IT" is a statement about the TOKEN, which has to serve the dark
          // surfaces too, and warn is still the correct FILL for this wash and
          // for the `accentBar` above.
          //
          // The numbers, the grounds they were taken against and why this value
          // is not `due.dart`'s: [_warnGlyphOnWash].
          //
          // ⚠️ THE BAR THAT GOVERNS THIS GLYPH IS 3.0, NOT THE 4.5 THE DUE
          // LABEL ANSWERS TO, and saying so is not a licence to relax anything.
          // `MinimumTextContrastGuideline.targetContrastRatio(19, bold: true)`
          // returns `kMinimumRatioLargeText` because 19 ≥ `kLargeTextMinimumSize`
          // (18) — this is a large-text glyph, unlike the 11px w700 due label
          // one method down. 1.89:1 failed even that, and the new light tone
          // clears 4.5 anyway, so the fix is safe under either reading.
          //
          // ⬜ AND NOTHING IN `test/` MEASURES THIS GLYPH TODAY — it is a hole,
          // named rather than assumed away. `a11y_semantics_test.dart`'s
          // `_rowCardTexts` sets `ground = null` for any `Text` under a
          // `DecoratedBox` that carries its own colour, and `_assertLegible`
          // `continue`s on a null ground. The badge has a decorated ground by
          // construction, so it is skipped — which is why 1.89:1 shipped green.
          // Closing that hole means measuring the COMPOSITE (the helper's own
          // translucency guard refuses to score alpha, correctly), and it lives
          // in a test file this increment does not own.
          leading: Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            // UNCHANGED IN BOTH BRIGHTNESSES. Darkening the wash cannot help:
            // with an amber glyph on it the ground would have to fall to a
            // relative luminance of 0.059 to clear 4.5, and warn over a white
            // card cannot reach that at ANY opacity — at 1.0 the ground IS
            // warn, luminance 0.439. The glyph is the only end that can move.
            decoration: BoxDecoration(
              color: const Color.fromRGBO(245, 158, 11, 0.16),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              '!',
              style: TextStyle(
                fontFamily: 'Space Grotesk',
                fontWeight: FontWeight.w700,
                fontSize: 19,
                // THE ONE LINE THAT MOVES, AND IT MOVES ON THE LIGHT SIDE.
                // Dark keeps the shipped literal, so that branch repaints by
                // zero pixels and its 4.30:1 cannot regress.
                color: Theme.of(context).brightness == Brightness.light
                    ? _warnGlyphOnWash
                    : AppColors.warn,
              ),
            ),
          ),
          // PLURAL — one of the app's first three. `markedUnusedCount` carries
          // the whole clause in each arm, so a language that inflects the noun
          // (Tamil: திட்டம் → திட்டங்கள்) is translating a sentence rather than
          // gluing a number onto a fixed word.
          title: l10n.markedUnusedCount(unused.length),
          // `RowCard` is theme-aware (its ground is `cardDecoration(context)`),
          // so a const `AppText.muted` here is near-grey prose on a dark card.
          subtitle: Text(
            l10n.cancelToSave(currency.fmt(savings)),
            style: AppText.of(context).muted.copyWith(fontSize: 12),
          ),
          // 🔴 THE ONE GLYPH THE PROSE MIGRATION COULD NOT SEE, FIXED
          // 2026-08-21. `RowCard`'s ground forks — `AppColors.surface` in
          // light, `scheme.surfaceContainerHighest` in dark — and this `Icon`
          // did not. `AppColors.muted` #6F6F7B is a grey chosen against WHITE
          // (its own token doc says so), so on the dark card #35343A it
          // measured **2.49:1**, under SC 1.4.11's 3:1 for a meaningful
          // non-text glyph and it is the only arrow this row has.
          //
          // It survived the home sweep because it is NOT an `AppText` defect:
          // the pattern that migrated every string here (`AppText.<style>` →
          // `AppText.of(context)`) cannot match an `Icon`. It is named as
          // outstanding in `dark_group_home_test.dart`'s header, which cites it
          // by its pre-merge line ("home_screen.dart:443").
          //
          // `onSurfaceVariant` is THE SLOT, not a second literal: it is what
          // `AppThemeX.fromScheme` already maps `muted` to, and what
          // `AppText.of(context).muted` one line up already gives this row's
          // own subtitle — so the arrow and the prose beside it resolve from
          // the same place instead of drifting apart. Measured against
          // `buildAppTheme(seed: 0xFF6459F5, brightness: dark)`, what
          // `app.dart:84` actually supplies: #C8C5D0 on #35343A = **7.25:1**.
          //
          // LIGHT KEEPS THE LITERAL AND REPAINTS BY ZERO PIXELS — 4.96:1 on the
          // white card, already AA. Same rule, same reason, as `cardDecoration`
          // and `RowCard`'s own light branches.
          trailing: Icon(
            Icons.arrow_forward,
            color: Theme.of(context).brightness == Brightness.light
                ? AppColors.muted
                : Theme.of(context).colorScheme.onSurfaceVariant,
            size: 20,
          ),
        ),
      SectionHeader(
        l10n.upcomingRenewals,
        // 🔴 THE ARROW LEFT THE STRING, and that is the point of the key rather
        // than a side effect. The literal was `'Calendar →'` — a LEFT-TO-RIGHT
        // glyph baked into copy, so every RTL locale would have rendered a
        // "forward" arrow pointing back the way the reader came, and every
        // translator would have had to remember to flip a character. It is now
        // an `Icons.arrow_forward`, which Flutter declares with
        // `matchTextDirection: true` and therefore mirrors itself; the arb key
        // (`calendarLink`) carries the word alone.
        // The word is already there, so this needs the ROLE and not a label:
        // merged, the node reads "Calendar, button" instead of "Calendar" as
        // prose sitting beside a heading. The arrow contributes nothing — an
        // `Icon` with no `semanticLabel` is silent — which is correct: it is the
        // same direction the word already implies.
        // 🔴 THE PAINTED WORD WAS THE WHOLE TAP TARGET, AND IT WAS 13 PIXELS
        // TALL. Measured 112.0x13.0 against androidTapTargetGuideline's 48 —
        // and it fails WCAG 2.5.8's 24x24 as well, so this is not merely under
        // the stricter Android bar. NONE of 2.5.8's exceptions covers it: it is
        // not Inline (it sits beside a heading, not inside a sentence, and its
        // size is set by its own 12px style rather than by surrounding
        // line-height), and Equivalent would be a claim about the shell's
        // Calendar tab — a control that is NOT in the tree when this screen is
        // pumped, i.e. an exclusion nothing here could falsify.
        //
        // So the target grows to 48 rather than being argued away. Two halves,
        // both needed: `SizedBox` gives the SEMANTICS NODE its height (the rect
        // a reader's switch/scan target is derived from), and
        // `HitTestBehavior.opaque` gives the POINTER the same area — without it
        // the node would claim 48 while a finger still had to find the 13px
        // word, which is the announce-one-thing-do-another shape the avatar
        // above records. The painted row is unmoved; only the header's own
        // block is taller.
        //
        // 🔴 AND IT WAS KEYBOARD-DEAD, WHICH IS A THIRD PROPERTY OF THE
        // SAME CONTROL AND WAS FIXED LAST. The two paragraphs above are about
        // what a READER hears and what a FINGER can hit; neither implies a
        // keyboard can get here, and it could not —
        // `test/keyboard_traversal_test.dart` counted this as one of home's
        // three dead controls. `FocusableTap` keeps the `MergeSemantics` +
        // `Semantics(button: true)` and the `opaque` 48px band exactly as
        // argued above, and adds the `FocusNode`.
        trailing: FocusableTap(
          onTap: () => context.go('/calendar'),
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            height: 48,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // 🔴 THE ACCENT IS INK HERE, SO IT FORKS BY BRIGHTNESS.
                // `AppColors.accent` (#6459F5) is a FILL colour that this
                // row paints as 12px w700 TEXT, so SC 1.4.3's 4.5:1 governs,
                // not 1.4.11's 3:1. On the dark scaffold #131318 it measured
                // **3.78:1** — the whole reason `every string on home … DARK`
                // was red. `scheme.primary` is the same seed resolved for the
                // ambient brightness (M3 puts dark primary at tone 80), which
                // is why the fork is a chassis lookup and not a second
                // literal. Light keeps the literal so nothing repaints.
                Text(
                  l10n.calendarLink,
                  style: AppText.body.copyWith(
                    color: Theme.of(context).brightness == Brightness.light
                        ? AppColors.accent
                        : Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.w700,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(width: 3),
                Icon(
                  Icons.arrow_forward,
                  color: Theme.of(context).brightness == Brightness.light
                      ? AppColors.accent
                      : Theme.of(context).colorScheme.primary,
                  size: 13,
                ),
              ],
            ),
          ),
        ),
      ),
      ...upcoming.map(
        (Subscription s) => Padding(
          padding: const EdgeInsets.only(bottom: 9),
          child: _subTile(
            context,
            l10n,
            currency,
            s,
            now,
            showDue: true,
            twoPane: twoPane,
          ),
        ),
      ),
      SectionHeader(
        l10n.allSubscriptions,
        trailing: Text(
          '${subs.length}',
          style: AppText.of(context).muted.copyWith(fontSize: 12),
        ),
      ),
      ...all.map(
        (Subscription s) => Padding(
          padding: const EdgeInsets.only(bottom: 9),
          child: _subTile(
            context,
            l10n,
            currency,
            s,
            now,
            showDue: false,
            twoPane: twoPane,
          ),
        ),
      ),
    ];
  }

  /// 🔴 THE HERO IS THE ONE SURFACE ON THIS SCREEN THAT IS ALREADY DARK IN BOTH
  /// BRIGHTNESSES, so the six `Colors.white` / `rgba(255,255,255,…)` values in
  /// this method and in [_statBox] STAY. They are not the light-hardcoded defect
  /// `cardDecoration` and `RowCard` carried.
  ///
  /// The ground here is [AppColors.heroGradient] — `heroA/B/C`, three fixed
  /// near-black purples — and it is a BRAND asset, not a themed surface: it
  /// renders identically under `theme` and `darkTheme` because it is a constant
  /// gradient, not a scheme slot. White is therefore the correct foreground in
  /// both modes, and swapping it for `scheme.onSurface` would put near-black
  /// text on a near-black card in LIGHT mode — the same defect this campaign is
  /// removing, introduced in the opposite direction.
  ///
  /// `test/dark_group_home_test.dart` pins that in both brightnesses, because
  /// "migrate every hardcoded colour" is exactly the tidy-up that would break it
  /// and nothing else would notice.
  Widget _heroCard(
    AppLocalizations l10n,
    Currency currency,
    double total,
    int count,
    double dueSoon,
    double due30,
  ) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: AppColors.heroGradient,
        borderRadius: BorderRadius.circular(26),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color.fromRGBO(42, 36, 86, 0.8),
            blurRadius: 50,
            offset: Offset(0, 24),
            spreadRadius: -24,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            l10n.monthlySpend,
            style: AppText.label.copyWith(
              color: const Color.fromRGBO(255, 255, 255, 0.7),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            currency.fmt(total),
            style: AppText.fig.copyWith(
              fontSize: 44,
              color: Colors.white,
              height: 1,
            ),
          ),
          const SizedBox(height: 12),
          // Wrap, not Row (P2.6b route-walk finding): two intrinsic-width
          // pills overflow a narrow card where a Wrap folds to a second line —
          // same fix as the PoweredByNikatru legal links, same reason.
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: <Widget>[
              // PLURAL. English collapses ("1 active" / "2 active") so the arms
              // read the same here — which is precisely why the key has to be a
              // plural rather than an interpolation: Tamil and every other
              // language that inflects gets the arms it needs, and English's
              // coincidence stops being the shape the app is built on.
              Pill(
                l10n.activeCount(count),
                bg: const Color.fromRGBO(255, 255, 255, 0.13),
                fg: Colors.white,
              ),
              Pill(
                l10n.perYearTotal(currency.fmt0(total * 12)),
                bg: const Color.fromRGBO(255, 255, 255, 0.13),
                fg: Colors.white,
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: <Widget>[
              _statBox(l10n.dueIn7Days, currency.fmt(dueSoon), Colors.white),
              const SizedBox(width: 12),
              // Was 'VS LAST MONTH', computed as `total - 174`. 174 was the last
              // element of the fabricated six-month trend array in insights, so this
              // compared the user's real total against a number someone typed. It
              // also hardcoded a '+', so it reported an increase every single month.
              // The app stores no history, so no month-over-month figure can be
              // honest. Replaced with a 30-day horizon, which is derived.
              _statBox(l10n.dueIn30Days, currency.fmt(due30), Colors.white),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statBox(String label, String value, Color valueColor) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color.fromRGBO(255, 255, 255, 0.08),
          borderRadius: BorderRadius.circular(15),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              label,
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontWeight: FontWeight.w600,
                fontSize: 10,
                color: Color.fromRGBO(255, 255, 255, 0.7),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              value,
              style: AppText.fig.copyWith(fontSize: 20, color: valueColor),
            ),
          ],
        ),
      ),
    );
  }

  Widget _subTile(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    Subscription s,
    DateTime now, {
    required bool showDue,
    required bool twoPane,
  }) {
    // [L1] `DueInfo.localized`, not `DueInfo.of` — this is one of the three call
    // sites the retained English-only factory is waiting on, and it also picks up
    // the shipped plural bug on the way: `of` returned "In 1 days" from both its
    // live branches.
    // `brightness:` is what ACTIVATES the light arm of the urgent-branch fork
    // in due.dart. Without it the call takes the dark-safe default and paints
    // AppColors.warn #F59E0B as small bold text on the white card — 2.15:1,
    // against a 4.5 bar. The fork landed before these three call sites did, so
    // a11y_semantics_test.dart carried a named exemption citing this exact line;
    // passing brightness is what expires it.
    final DueInfo due = DueInfo.localized(
      l10n,
      s,
      now,
      brightness: Theme.of(context).brightness,
    );

    // 🔴 THE USAGE BAND IS NOW CONDITIONAL, BECAUSE ITS INPUT IS NEVER
    // COLLECTED AND ITS `else` ARM WAS THEREFORE A CONSTANT.
    //
    // `usedPct` and `unused` are set in exactly two places — `DemoData` and an
    // `unused`/`used_pct` field an API would have to send — and NOTHING in the
    // app writes either. So on real rows `usedPct` is its `0` default and
    // `unused` is `false`, both ternaries fell through to their last arm, and
    // every subscription a live user has ever added has been labelled
    // "Occasional" with a grey status dot. That is not a weak signal, it is a
    // fixed string dressed as a measurement — the same class of defect as the
    // hero's old "VS LAST MONTH", which compared a real total against a typed
    // number and is recorded a few methods up.
    //
    // Retired rather than replaced: there is no usage source to invent one
    // from. `hasUsage` shows the band ONLY where the data actually exists, so
    // the demo set and any API that starts sending `used_pct` keep all three
    // bands, and a real row shows its category alone. Same rule for the status
    // dot — `GlyphTile` already takes a null `statusColor` (that is the
    // `showDue` branch), so "no data" draws no dot rather than the grey one,
    // which read as a deliberate "inactive" verdict.
    //
    // ⚠️ The three arb keys STAY. `usageActive` / `usageRarelyUsed` are also
    // read by `subscription_detail_screen.dart`, and `usageOccasional` is
    // reachable here the moment a row carries usage — deleting it would make
    // the band unrestorable without a new translation round.
    final bool hasUsage = s.unused || s.usedPct > 0;
    final Color? dot = !hasUsage
        ? null
        : (s.unused
              ? AppColors.warn
              : (s.usedPct > 60
                    ? AppColors.positive
                    : const Color(0xFFC9C9D2)));
    final String? usage = !hasUsage
        ? null
        : (s.unused
              ? l10n.usageRarelyUsed
              : (s.usedPct > 60 ? l10n.usageActive : l10n.usageOccasional));
    final AppTextStyles text = AppText.of(context);

    // 🔴 PUSH OR SELECT, AND THE ANSWER COMES FROM THE LAYOUT ITSELF.
    // [twoPane] is `TwoPane.isTwoPaneOf` read from inside the pane (see
    // [_listColumn]) and threaded down. Re-deriving it here from `MediaQuery`
    // would decide from the WINDOW while [TwoPane] decided from the BODY — 361
    // px apart inside the chassis — and at the boundary that pushes a full
    // route ON TOP of an already-rendered detail pane.
    final bool selected = twoPane && s.id == _selectedId;

    final Widget card = RowCard(
      onTap: () {
        if (twoPane) {
          // No navigation at all: the detail is already on screen beside this
          // row, and pushing would cover the list the user is comparing against
          // — the loss [TwoPane]'s header opens by naming.
          setState(() => _selectedId = s.id);
        } else {
          context.push('/sub/${s.id}');
        }
      },
      // 🔴 THE SELECTION MARK IS `accentBar`, AN EXISTING `RowCard` PARAMETER,
      // AND NOT A NEW DECORATION. A master-detail list has to say which row the
      // pane on the right is about, `RowCard` has no `selected` API, and the
      // alternative was a border or a fill invented in this file — a second
      // private opinion about card state in a repo that already has one. It is
      // the same 3 px rule the unused-plans card above draws, in
      // `AppColors.accent` (the emphasis hue this screen already uses for the
      // Calendar link) rather than `AppColors.warn`, so the two bars mean two
      // different things and look it.
      //
      // Null below the split, because nothing is "selected" in a single column:
      // the tap pushes a route and the user comes back.
      accentBar: selected ? AppColors.accent : null,
      leading: GlyphTile(glyph: s.glyph, statusColor: showDue ? null : dot),
      title: s.name,
      subtitle: showDue
          ? Text(
              due.label,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontWeight: FontWeight.w700,
                fontSize: 11,
                color: due.color,
              ),
            )
          : Text(
              usage == null ? s.category : '${s.category} · $usage',
              style: text.muted.copyWith(fontSize: 12),
            ),
      trailing: showDue
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Text(
                  currency.fmt(s.monthlyPrice),
                  style: text.fig.copyWith(fontSize: 16),
                ),
                Text(
                  s.cycle == BillingCycle.yearly ? l10n.perYear : l10n.perMonth,
                  style: text.muted.copyWith(fontSize: 10),
                ),
              ],
            )
          : Text(
              currency.fmt(s.monthlyPrice),
              style: text.fig.copyWith(fontSize: 16),
            ),
    );

    // The `selected` flag ONLY where the layout has a selection. Annotating
    // every row `selected: false` in a single column would announce a state
    // this screen does not have there — the tap pushes a route and returns —
    // and a screen reader would read "not selected" on twelve rows that can
    // never be selected.
    return twoPane ? Semantics(selected: selected, child: card) : card;
  }

  /// The bell and (via the same shape) any future header control.
  ///
  /// 🔴 THIS IS THE HOME SCREEN'S ONE REAL DARK DEFECT, and unlike the hero it
  /// is the [cardDecoration] / [RowCard] defect exactly: a `AppColors.surface`
  /// fill is `0xFFFFFFFF`, so on a dark scaffold this was a WHITE 48px square
  /// with near-black `AppColors.ink` iconography inside it — the brightest thing
  /// on the screen, sitting next to a hero that is already dark.
  ///
  /// Same rule as its two siblings, so the three read as one decision:
  ///   · LIGHT is byte-identical — the literal `surface` / `line` / `ink`,
  ///     pinned against the literals in `test/dark_group_home_test.dart`.
  ///   · DARK derives from the scheme: `surfaceContainerHighest` (the slot
  ///     `cardDecoration` and `RowCard` already use, so the header control and
  ///     the rows below it are the same material), an `outlineVariant` hairline,
  ///     and `onSurface` for the glyph.
  ///
  /// The unread dot's ring follows the FILL rather than staying white: the ring
  /// exists to punch the dot out of whatever it sits on, so a white ring on a
  /// dark button is the same bug one size down.
  Widget _circleButton({
    required BuildContext context,
    required IconData icon,
    required String semanticLabel,
    bool dot = false,
    VoidCallback? onTap,
  }) {
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    final Color fill = isLight
        ? AppColors.surface
        : scheme.surfaceContainerHighest;
    final Color edge = isLight ? AppColors.line : scheme.outlineVariant;
    final Color glyph = isLight ? AppColors.ink : scheme.onSurface;

    // 48px, not 44: the chassis floor for an icon-only tap target, asserted
    // route-wide by chassis_properties_test. The Semantics wrapper is what a
    // screen reader announces — an icon-only control without one is unusable.
    //
    // 🔴 AND `FocusableTap` IS WHAT A KEYBOARD REACHES. Two of home's
    // three keyboard-dead controls are built here (notifications and calendar;
    // the account avatar below is the third), and the register's phrasing is
    // the one to keep: they are every route OFF a screen whose rows all
    // traverse fine, so a keyboard-only user could read the list and leave by
    // no door on it. `mergeDescendants: false` because this control has no
    // descendant text to merge — [semanticLabel] IS its name, and the dot is
    // decoration.
    return FocusableTap(
      label: semanticLabel,
      mergeDescendants: false,
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Stack(
        children: <Widget>[
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: fill,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: edge),
            ),
            child: Icon(icon, color: glyph, size: 20),
          ),
          if (dot)
            Positioned(
              top: 9,
              right: 10,
              child: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: AppColors.warn,
                  shape: BoxShape.circle,
                  border: Border.all(color: fill, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }

  /// The time-of-day greeting.
  ///
  /// ⚠️ THE BOUNDARIES STAY IN DART, and only the words move to the arb. A
  /// locale that divides the day differently needs a different RULE, not a
  /// different string, so encoding 12/18 as translatable copy would look like
  /// localisation while changing nothing. Named here so the next reader does not
  /// mistake the omission for an oversight.
  String _greeting(AppLocalizations l10n, DateTime now) {
    if (now.hour < 12) return l10n.greetingMorning;
    if (now.hour < 18) return l10n.greetingAfternoon;
    return l10n.greetingEvening;
  }
}

/// The in-app catch-up nudge — [pipeline T-8].
///
/// 🔴 WHY IT EXISTS AND WHY IT IS PERMANENT. Three of the six platforms cannot
/// schedule a repeating local notification, and **no version of the pinned
/// plugin family changes that**: its own limitations text records that Windows
/// throws on repeating notifications, Linux has no scheduler API, and browsers
/// support neither scheduled nor repeating ones. Web is the only live platform
/// today. The settings screen is already honest about it — it refuses to offer a
/// switch it cannot honour — and this is the half that actually delivers
/// something: the next time the app is opened after the reminder's moment has
/// passed, say so, once.
///
/// It is the humblest mechanism that works, on purpose: no background work, no
/// polling, no wake-up the OS refuses to grant, and nothing that needs a server.
///
/// ⚠️ IT RESPECTS THE OPT-OUT. An in-app banner is still a notification, so
/// [core.CatchUpNudge] refuses when reminders are off — routing around the
/// switch is precisely what the switch exists to prevent.
///
/// ⚠️ P2.5 DEPENDENCY: `AppConfig.reminderHour` / `reminderMinute` exist ONLY in
/// the STAMPED `lib/core/app_config.dart`. The live `lib/core/config/
/// app_config.dart` has neither, so the de-duplication must keep the stamp's
/// constants or this widget stops compiling. See MANIFEST.md · FINDING 3.
class CatchUpNudgeBanner extends ConsumerWidget {
  const CatchUpNudgeBanner({this.clock, super.key});

  /// Injectable ONLY so the due/not-due boundary is reachable from a test: a
  /// test process cannot choose what `DateTime.now()` reports, so a widget test
  /// on the real clock would assert nothing for twenty hours of every day and
  /// then start failing at 20:00. Same reasoning as `DeviceUtcOffset` in
  /// `packages/notifications`, and the same reason the decision itself is pure.
  final DateTime Function()? clock;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final NotificationCapabilities caps = NotificationCapabilities.forPlatform(
      defaultTargetPlatform,
      isWeb: kIsWeb,
    );
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DateTime now = (clock ?? DateTime.now)();
    final core.CatchUpNudgeVerdict verdict = const core.CatchUpNudge().decide(
      now: now,
      lastShownAt: ref.watch(catchUpNudgeProvider),
      reminderHour: AppConfig.reminderHour,
      reminderMinute: AppConfig.reminderMinute,
      remindersEnabled: ref.watch(remindersEnabledProvider),
      platformCanSchedule: caps.canSchedule,
    );
    if (verdict != core.CatchUpNudgeVerdict.show) {
      return const SizedBox.shrink();
    }
    final ThemeData theme = Theme.of(context);
    return MaterialBanner(
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      leading: const Icon(Icons.notifications_active_outlined),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(l10n.catchUpTitle, style: theme.textTheme.titleSmall),
          Text(l10n.catchUpBody, style: theme.textTheme.bodySmall),
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () =>
              ref.read(catchUpNudgeProvider.notifier).markShown(now),
          child: Text(l10n.catchUpDismiss),
        ),
      ],
    );
  }
}

/// The SAME-APP upgrade card — [research/44 §7 rung 3].
///
/// 🔴 SAME-APP IS THE WHOLE DECLARATION ARGUMENT, NOT A PRODUCT CHOICE. This
/// card promotes the app the user is already inside. Google Play's third
/// ads-declaration trigger — the one that needs no SDK — is worded *"House ads:
/// My app renders a small ad banner, interstitial ad, ad wall, and/or widget"*
/// **to promote my other apps**, and this matches none of the three, so no ads
/// label and no "Contains ads" badge follow from it (research/44 V2). The
/// cross-app version is a SEPARATE component with a SEPARATE config key,
/// deferred until app #2 exists (rung 6); the two may never share a widget or a
/// flag, because their declaration consequences differ.
///
/// ## What it reads, and what each read is for
/// * `features.promo_card_enabled` — the on-switch. **Absent reads FALSE**
///   (`AppConfig.feature`'s `orElse`), so a stamped app that has never reached
///   the network shows nothing. This is the state of every app in the portfolio
///   today.
/// * `AppConfig.copy` — the words, so a campaign is a config edit and not a
///   release. Falls back to l10n and **never to the key**: `AppConfig.text`
///   returns the key itself when unset, and a fresh stamp has no overrides, so
///   a purely config-driven card would greet its first user with
///   `promo.card.title`. Same trap, same fix, as the onboarding carousel.
/// * `flags.promo_card_variant` — which wording this install sees, bucketed on
///   the SAME `installIdProvider` value the analytics cohort uses. Two
///   independently minted ids makes every experiment permanently unanalysable.
/// * the rail's `Offering` — the price, DERIVED. There is no price literal in
///   this file and `tooling/ci/assert-no-price-literals.mjs` fails the build if
///   one appears.
/// * `PurchaseRail.canStartCheckout` — whether to offer to sell at all. False
///   on `ios-appstore`, `macos-appstore` and `android-play` (ADR 039 D3 ·
///   research/44 V13), where the card still renders and simply carries no buy
///   button. Steering to an external checkout on those three is a documented
///   rejection cause.
/// * `paywallLockedProvider` — a user who has already paid is not promoted to.
///   The rule the `CatchUpNudgeBanner` beside it established, applied to money:
///   a nudge the user paid to see is not a nudge.
///
/// ## What it deliberately does NOT do
/// **It opens no URL.** The buy control navigates to `/paywall`, which is where
/// the ONE hosted rail lives; every offer link therefore resolves to the apex
/// buy surface (ADR 038) through the merchant of record this portfolio is
/// locked to. A second checkout — a `pay.rev.cat` link, a per-app subdomain,
/// anything this widget launched itself — would be a second merchant of record
/// with its own VAT/GST posture (research/44 V14). `assert-purchase-path.mjs`
/// fails the build if this file grows a launcher.
///
/// **It emits no impression or click event.** research/44 §4.4 is explicit that
/// v1 ships UNMEASURED and that this is the one irreversible decision in the
/// programme: the locked taxonomy carries no cross-promo event, adding one
/// takes a portfolio session-capacity cut of 25–50% against the binding D1
/// rows-written ceiling, and the choice is owner decision D6. So the variant is
/// resolved with the PURE `core.resolveFlag` rather than through
/// `featureFlagsProvider`, whose `ObservedFeatureFlags` wrapper would emit
/// `variant_exposed` on first read. That read is a genuine gap and it is
/// PRINTED on every run by `assert-flag-exposure.mjs` rather than left to be
/// discovered — when D6 says measure, this line moves to the observed reader
/// and the guard's ceiling comes back down.
class UpgradePromoCard extends ConsumerStatefulWidget {
  const UpgradePromoCard({this.clock, super.key});

  /// Injectable ONLY so the cooldown boundary is reachable from a test — a test
  /// process cannot choose what `DateTime.now()` reports. Same reasoning as
  /// [CatchUpNudgeBanner]'s, and the same reason `core.PromoGate` takes `now`.
  final DateTime Function()? clock;

  @override
  ConsumerState<UpgradePromoCard> createState() => _UpgradePromoCardState();
}

class _UpgradePromoCardState extends ConsumerState<UpgradePromoCard> {
  /// 🔴 THE DECISION IS LATCHED FOR THE LIFE OF THIS PRESENTATION, AND WITHOUT
  /// IT THE CARD DELETES ITSELF ON THE FRAME AFTER IT APPEARS.
  ///
  /// `PromoGate.decide` is pure and idempotent, and the impression is recorded
  /// by PERSISTING its returned state. That write republishes
  /// `promoCardStateProvider`, which rebuilds this widget, which re-decides —
  /// now from a record that says "shown just now" — and gets
  /// `shownTooRecently`. So a card that correctly decided to show would vanish
  /// within one frame, on every device, and nothing about the gate or the
  /// persistence would look wrong.
  bool _showing = false;

  /// The app's override for [key], then its variant override, then the chassis
  /// default.
  ///
  /// Empty is treated as absent: a config shipping `""` is a config somebody
  /// half-edited, and a blank card is worse than the default one.
  String _copy(core.AppConfig? cfg, String key, {required String fallback}) {
    final String? override = cfg?.copy[key];
    return (override == null || override.trim().isEmpty) ? fallback : override;
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
    // ── THE HYDRATION BARRIER, AND IT IS THE FIRST DECISION FOR A REASON
    // 🔴 A RECORD WE HAVE NOT READ YET IS NOT A RECORD THAT SAYS "NOBODY
    // OBJECTED". The first version of this widget read a SYNCHRONOUS
    // `PromoGateState` that started at the empty default and hydrated behind
    // it, so a device holding `"suppressed": true` was shown a promotional
    // card for the whole duration of the disk read — measured on the real
    // tree at t+0, t+5, t+10 and t+20 ms against a 40 ms store, off screen
    // only by t+60. Nothing failed, because every widget test in this repo
    // calls `pumpAndSettle()` first and that is exactly the window being
    // skipped. Art 21(3) — "the personal data shall no longer be processed
    // for such purposes" — has no grace period in it, so neither does this.
    //
    // `valueOrNull == null` states the rule ONCE for both shapes of
    // not-knowing — still reading, and could not read — which is the whole
    // reason the controller is an `AsyncNotifier`: a barrier that lives in the
    // TYPE cannot be forgotten by the next caller of this provider.
    final core.PromoGateState? stored = ref
        .watch(promoCardStateProvider)
        .valueOrNull;
    if (stored == null) return const SizedBox.shrink();

    // ── THE SECOND HALF OF THE SAME BARRIER — THE CONSENT RAIL ─────────────
    // `PromoGateState.suppressed` is a PROJECTION of `ConsentPurpose.promo`,
    // never an independent fact (`PromoObjection`'s library comment). So the
    // record above is only half the input: a person who objected on this
    // device, or whose browser is sending a GPC signal this session, is
    // "objected" whether or not the latch on disk has caught up. Reading the
    // record without the rail is the two-stores defect — both halves report
    // healthy while the card keeps rendering to somebody who exercised an
    // absolute right to stop it (Art 21(2)/(3)).
    //
    // Same fail-closed shape as the record barrier immediately above, and for
    // the same measured reason: a rail we have not finished reading is not a
    // rail that says nobody objected.
    final core.ConsentController? consent = ref
        .watch(consentControllerProvider)
        .valueOrNull;
    if (consent == null) return const SizedBox.shrink();

    // ── THE LATCHES OUTRANK THE LATCH ──────────────────────────────────────
    // Checked before `_showing`, deliberately: a dismissal or a GDPR Art 21
    // objection raised while the card is on screen must take it off the screen,
    // not wait for the next launch. Art 21(3) — "the personal data shall no
    // longer be processed for such purposes" — has no grace period in it.
    if (stored.dismissed || stored.suppressed) return const SizedBox.shrink();

    // A user who has already paid is not promoted to. `paywallLockedProvider`
    // is only meaningful for an app that HAS a paywall; for one that sells
    // nothing it is false for everyone, which must not read as "everybody has
    // paid".
    if ((cfg?.paywall.enabled ?? false) && !ref.watch(paywallLockedProvider)) {
      return const SizedBox.shrink();
    }

    final PurchaseRail rail = ref.watch(purchaseRailProvider);
    final List<Offering> offerings = rail.offerings;

    if (!_showing) {
      // 🔴 THROUGH `PromoObjection`, NEVER STRAIGHT AT THE GATE. It projects
      // the rail onto the record first and cannot be skipped — a GPC objection
      // (Art 21(5)) writes no artifact at all and reaches the gate by no other
      // route. `assert-consent-withdrawal-surface.mjs` limb 5 fails the build
      // for any `.decide(` on a promo gate whose expression does not name it.
      final core.PromoGateDecision decision = core.PromoObjection(consent)
          .decide(
            ref.watch(promoGateProvider),
            stored,
            now: (widget.clock ?? DateTime.now)(),
            featureEnabled: cfg?.feature(kPromoCardFeature) ?? false,
            // 🔴 THE [pipeline C-6] LIMB. An eligible user and nothing to
            // promote is `nothingToShow`, not `show` — research/44's
            // DO-NOT-BUILD list opens with the empty portfolio directory:
            // "wired, guarded, green and useless". A card with no price to
            // quote is that shape one size down.
            hasContent: offerings.isNotEmpty,
          );
      if (!decision.show) return const SizedBox.shrink();
      _showing = true;
      // Persisted on RENDER, not on decide. The gate is pure, so the write is
      // the moment of truth — and it is deferred to after this frame because a
      // provider mutation during build is a rebuild inside a build.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(promoCardStateProvider.notifier).markShown(decision.state);
      });
    }

    // Belt and braces after the latch: a config that loses its offerings mid
    // session leaves nothing to quote, and `offerings.first` on an empty list
    // is a crash on the home screen.
    if (offerings.isEmpty) return const SizedBox.shrink();
    // The rail's OWN order, the same order the paywall lists them in. Picking
    // "the cheapest" would need a currency comparison this repo cannot make —
    // amounts are minor units of whatever currency the rail sent.
    final Offering offering = offerings.first;

    // ── THE VARIANT ────────────────────────────────────────────────────────
    // Absent id (the disk read has not landed) or absent flag ⇒ variant A.
    // Never a coin flip: `resolveFlag` is deterministic per install, so a user
    // does not see a different card on every launch.
    final String? installId = ref.watch(installIdProvider).valueOrNull;
    final bool variantB =
        installId != null &&
        core.resolveFlag(
          flag: kPromoCardVariantFlag,
          rolloutPercent: cfg?.rolloutPercent(kPromoCardVariantFlag) ?? 0,
          stableId: installId,
        );
    final String suffix = variantB ? '.b' : '';

    String copy(String key, String fallback) => _copy(
      cfg,
      'promo.card.$key$suffix',
      fallback: _copy(cfg, 'promo.card.$key', fallback: fallback),
    );

    final bool canSell = rail.canStartCheckout;

    // ── THE FRAME, AND THE CREATIVE INSIDE IT ──────────────────────────────
    // `PromoSurface` carries the two things that attach to the FIRST
    // promotional communication and that a creative increment forgets because
    // they are not part of the creative: the promotional label (Apple 2.5.18 ·
    // Microsoft 10.10.4 · Play's native-ads trigger · India's Disguised
    // Advertisement) and the Art 21(4) on-card objection, "presented clearly
    // and separately", where somebody meeting their first offer will actually
    // see it. It offers no constructor argument that switches either off, so
    // the card cannot render without them — which is the whole reason it is a
    // frame rather than two more parameters on `PromoCard`.
    return PromoSurface(
      show: true,
      objected: ref.watch(promoObjectedProvider),
      onObjectionChanged: (bool objected) =>
          recordPromoObjection(ref, objected: objected),
      promotionalLabel: l10n.promoLabel,
      stopLabel: l10n.promoStopOffers,
      resumeLabel: l10n.promoResumeOffers,
      objectedNotice: l10n.promoOffersOff,
      child: PromoCard(
        show: true,
        label: copy('label', l10n.promoCardLabel),
        title: copy('title', l10n.promoCardTitle),
        message: copy('body', l10n.promoCardBody),
        // DERIVED from the rail's own amount and currency. Absolute, always: no
        // percentage, no "was", no countdown — see the class doc and
        // research/44 V6.
        priceLabel: l10n.promoCardPrice(
          offering.formattedPrice,
          offering.term.wire,
        ),
        primaryActionLabel: canSell ? l10n.paywallUpgrade : null,
        onPrimaryAction: canSell ? () => context.go('/paywall') : null,
        // 🔒 ROSCA PARITY, IN THIS CARD, NOT A LEVEL DOWN. `PromoCard` makes
        // both of these `required`, so a promo surface that offers a way to
        // start paying and no equally-adjacent way to stop does not compile —
        // and `assert-purchase-path.mjs` asserts this file really navigates to
        // the cancel surface, because a required callback can still be `() {}`.
        manageLabel: l10n.managePlanTitle,
        onManageAction: () => context.go('/manage-plan'),
        // Neutral decline copy. "Not now" — never "No thanks, I don't want to
        // save", which is the confirm-shaming India's CCPA Dark Patterns
        // Guidelines 2023 name outright.
        dismissLabel: l10n.notNow,
        onDismiss: () => ref.read(promoCardStateProvider.notifier).dismiss(),
        dismissSemanticLabel: l10n.promoCardDismissA11y,
      ),
    );
  }
}
