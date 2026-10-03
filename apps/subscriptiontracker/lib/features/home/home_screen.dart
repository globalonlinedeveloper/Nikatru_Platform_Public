// ─────────────────────────────────────────────────────────────────────────────
// HOME — train ST-D1, the Subscription Tracker design, built on the ST-D0
// foundation.
//
// The dashboard is FOUNDATION COMPONENTS AND DOMAIN VALUES, nothing else:
//
//   · `AppSummaryCard`  — the monthly total, what qualifies it, and the 7- and
//                         30-day figures. Replaces the brand-gradient hero, whose
//                         white-on-purple literals no theme could reach.
//   · `DecisionStrip`   — the ONE decision this screen asks, the most urgent
//                         of `HomeSignals` (T8 · HO-05): a trial ending, a
//                         yearly charge close, a price that rose, "Still using
//                         {name}?" — each with one answer. It replaced the
//                         "N marked unused" strip only demo data could fill.
//   · `ListControls`    — search, sort and filter (T8 · HO-03), the design
//                         system's, leading the list so / and Ctrl/⌘+F always
//                         find the field built.
//   · `AppSectionHeader` + `AppListGroup` of `AppListRow`s — upcoming renewals
//                         and every subscription. Replace `SectionHeader` and
//                         one `RowCard` per row.
//   · `SkeletonList` / `DataStateView` — loading, empty and failed are three
//                         different screens, never a bare spinner and never a
//                         raw exception string (`couldNotLoad('$e')` is gone
//                         from here).
//
// What this file still decides is domain: which subscriptions are upcoming
// (the next 30 days, HO-04), which one is urgent, what matches a search,
// where a tap goes. Every colour,
// size and type style comes from the theme through the components.
//
// 🔴 THE ORDERING RULE THIS FILE ENCODES, because it is the one that bites:
// `overrides.md` §10-11 records that home and settings must merge AS A PAIR —
// `showUnused` below reads `prefs['unused']`, which only the settings toggles
// write — it now gates the "Still using {name}?" signal. Changing one screen
// without the other severs a coupling nothing tests.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async' show Timer;

import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../core/format/category_label.dart';
import '../../core/format/rail_label.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../data/portability/subscription_columns.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';
import '../../state/refresh_on_return.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
// The `/sub/:id` screen, imported so it can be BUILT IN PLACE in the second
// pane. It is still a route — a phone still pushes it — this import only gives
// the wide layout a way to render the same widget without a navigation.
import '../add/add_subscription_sheet.dart';
import '../detail/subscription_detail_screen.dart';
import '../shared/async_gate.dart';
import '../shared/cadence_label.dart';
import '../shared/due.dart';
// The shell this screen is a BRANCH of, imported for one number:
// [AppShell.pageInsetOf]. The FAB that inset reserves room for belongs to the
// shell, so the arithmetic does too.
import '../setup/setup_screen.dart' show shouldOfferSetup;
import '../shell/app_shell.dart';
import '../stop/stop_flow.dart' show showStopSheet;
import 'home_search.dart';
import 'home_signals.dart';

/// Home's sort orders (HO-03).
enum HomeSort { nextCharge, price, monthlyShare, name }

/// Home — branch 0's BODY ([ADR 037] Variant B): `AppShell` owns the adaptive
/// [AppScaffold], so this screen carries NO scaffold of its own — nesting one
/// inside the shell's body would render two navigation surfaces.
///
/// The `PaywallGate` wraps the INSIGHTS branch in `lib/core/router.dart`, so
/// `paywallLockedProvider` keeps its one real consumer there.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({this.category, super.key});

  /// T12 (IN-07): list only this category's rows — the drill-down from an
  /// Insights category row (`/home?category=`). Null or empty is every row.
  /// It lands as Home's own category filter chip (HO-03), so the user sees
  /// the filter in force and clears it where every other filter is cleared.
  final String? category;

  /// The narrowest BODY that holds the summary side column beside a
  /// list/detail split: `form` (420) + divider (1) + `expanded` (840) = 1261.
  ///
  /// [ADR 083]: THE TRIGGER IS A BODY THRESHOLD, NOT A WINDOW BREAKPOINT. It is
  /// the sum of the three floors, so a wider window may ADD a column and never
  /// remove one: at a body of 1200 an aside would leave the panes 779, below
  /// the split, and the open detail would vanish as the window grew. It is
  /// expressed as
  /// that arithmetic rather than as a literal 1261 so it cannot drift from
  /// the constants it is made of.
  static const double asideMinBodyWidth =
      AppBreakpoints.form + TwoPaneSplit.dividerWidth + AppBreakpoints.expanded;

  /// The list column's pane; `test/width_home_test.dart` resolves the
  /// `ListView` through it rather than through `.first`.
  static const Key listPaneKey = Key('home-list-pane');

  /// The list's pull-to-refresh (ST-N6), so a test can drag it by key.
  static const Key pullToRefreshKey = Key('home-pull-to-refresh');

  /// The summary's own column, present from [asideMinBodyWidth] up.
  static const Key asideKey = Key('home-aside');

  /// The summary card, wherever it is laid out.
  static const Key summaryKey = Key('home-summary');

  /// The decision strip for [s] of [kind] (HO-05).
  static Key signalKey(HomeSignalKind kind, String id) =>
      Key('home-signal-${kind.name}-$id');

  /// That strip's one answer.
  static Key signalActionKey(HomeSignalKind kind, String id) =>
      Key('home-signal-${kind.name}-$id-action');

  /// The search field (HO-03).
  static const Key searchFieldKey = Key('home-search');

  /// The sort menu button (HO-03).
  static const Key sortKey = Key('home-sort');

  /// The filter toggle that shows the chips (HO-03).
  static const Key filterKey = Key('home-filter');

  /// Shown in place of the all-subscriptions group when nothing matches.
  static const Key noMatchesKey = Key('home-no-matches');

  /// How many upcoming charges are listed before "{n} more" (HO-04).
  static const int upcomingShown = 4;

  /// The upcoming horizon, in days (HO-04).
  static const int upcomingDays = 30;

  /// The upcoming-renewals group.
  static const Key upcomingKey = Key('home-upcoming');

  /// The every-subscription group.
  static const Key allKey = Key('home-all');

  /// The control that enters the selection on a pointer target (HO-08).
  static const Key selectKey = Key('home-select');

  /// The selection's action bar (train T20, HO-08), its four actions, and
  /// the Done that leaves it.
  static const Key selectionBarKey = Key('home-selection-bar');
  static const Key selectDoneKey = Key('home-select-done');
  static const Key bulkPauseKey = Key('home-bulk-pause');
  static const Key bulkCancelKey = Key('home-bulk-cancel');
  static const Key bulkDeleteKey = Key('home-bulk-delete');
  static const Key bulkExportKey = Key('home-bulk-export');

  /// The tag filter's chips (ST-AD12), present only when a row has a tag.
  static const Key tagFilterKey = Key('home-tag-filter');

  /// One row's swipe wrapper, on a touch platform.
  static Key swipeKeyOf(String id) => ValueKey<String>('home-swipe-$id');

  /// One row's selection box, in the selection mode.
  static Key pickKeyOf(String id) => ValueKey<String>('home-pick-$id');

  /// A tag's chip in the filter.
  static Key tagChipKeyOf(String tag) =>
      ValueKey<String>('home-tag-${tag.toLowerCase()}');

  /// Whether rows swipe on [platform]: the two touch-first ones, where a
  /// swipe is the idiom. A desktop pointer has the selection mode instead.
  static bool swipesOn(TargetPlatform platform) =>
      platform == TargetPlatform.android || platform == TargetPlatform.iOS;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The filter reaches the dashboard through [_HomeFilter] so the shell
    // below stays one `const` tree — the shape the chassis property audit
    // reads its mounts from (assert-stamp-properties).
    return _HomeFilter(
      category: (category ?? '').isEmpty ? null : category,
      child: const Column(
        children: <Widget>[
          // [pipeline T-8] Above everything. MOUNTED EXACTLY ONCE IN THE APP —
          // chassis_properties_test pumps the whole SublyApp and asserts it.
          CatchUpNudgeBanner(),
          // [research/44 §7 rung 3] The same-app upgrade card, in the slot the
          // stamped chassis gives it: under the nudge, above the dashboard. It
          // renders NOTHING while `features.promo_card_enabled` is absent.
          UpgradePromoCard(),
          Expanded(child: _HomeDashboard()),
        ],
      ),
    );
  }
}

/// The category Home is filtered to (T12, IN-07), handed to the dashboard.
class _HomeFilter extends InheritedWidget {
  const _HomeFilter({required this.category, required super.child});

  final String? category;

  static String? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_HomeFilter>()?.category;

  @override
  bool updateShouldNotify(_HomeFilter old) => old.category != category;
}

/// Subly's product dashboard, docked as the Home destination.
///
/// STATEFUL FOR ONE NULLABLE STRING: [TwoPane] renders a detail beside the
/// list and deliberately owns neither selection nor routing, so this widget
/// holds the selected subscription id. Screen state, not a provider: which row
/// the second pane shows is not a fact about the user's data.
class _HomeDashboard extends ConsumerStatefulWidget {
  const _HomeDashboard();

  @override
  ConsumerState<_HomeDashboard> createState() => _HomeDashboardState();
}

class _HomeDashboardState extends ConsumerState<_HomeDashboard> {
  /// The row whose detail is showing in the second pane, or null.
  ///
  /// KEPT when the layout returns to one column: a window dragged narrow and
  /// wide again comes back to the row the user was reading, and [TwoPane] does
  /// not BUILD its detail below the split, so keeping it costs nothing.
  String? _selectedId;

  /// HO-03: what the user searched, sorted by and filtered to. Screen state:
  /// a way of looking at the list, not a fact about the user's data.
  String _query = '';
  HomeSort _sort = HomeSort.monthlyShare;
  final Set<String> _filters = <String>{};

  /// Whether the filter chips are showing — and they stay showing while any
  /// chip is on, so a filter in force is never folded away.
  bool _filtersOpen = false;
  final TextEditingController _search = TextEditingController();
  final FocusNode _searchFocus = FocusNode(debugLabel: 'home search');

  /// The list column's scroll, so a search request can bring the field back.
  final ScrollController _scroll = ScrollController();

  /// HO-04: lands at the next local midnight and re-reads [nowProvider], so a
  /// screen left open overnight relabels "Renews tomorrow" as "Due today".
  Timer? _midnight;

  @override
  void initState() {
    super.initState();
    _scheduleMidnight();
  }

  void _scheduleMidnight() {
    _midnight?.cancel();
    _midnight = Timer(untilLocalMidnight(ref.read(nowProvider)()), () {
      if (!mounted) return;
      ref.invalidate(nowProvider);
      setState(() {});
      _scheduleMidnight();
    });
  }

  /// The drill-down category last applied (IN-07), so a rebuild does not
  /// re-impose a filter the user has since cleared.
  String? _drilledTo;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final String? category = _HomeFilter.of(context);
    if (category == _drilledTo) return;
    _drilledTo = category;
    // A NEW drill-down replaces any category chip, and only that group: a
    // status or currency filter the user set stays.
    _filters.removeWhere((String f) => f.startsWith(_cat));
    if (category != null) {
      _filters.add('$_cat$category');
      _filtersOpen = true;
    }
  }

  @override
  void dispose() {
    _midnight?.cancel();
    _search.dispose();
    _searchFocus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// The tag "All subscriptions" is narrowed to, or null for every row
  /// (ST-AD12). Screen state for the reason [_selectedId] is.
  String? _tag;

  /// The MULTI-SELECTION (train T20, HO-08): null when the list is not in its
  /// selection mode, else the ids picked — possibly none yet.
  ///
  /// Entered by a long press on a row (touch) or by the section's "Select"
  /// action (every target: a pointer has no long press worth teaching), and
  /// left by "Done" or by acting on the selection. In the mode every row shows
  /// a checkbox and a tap toggles it instead of opening the row.
  Set<String>? _picked;

  void _toggle(String id) => setState(() {
    final Set<String> picked = _picked ?? <String>{};
    if (!picked.remove(id)) picked.add(id);
    _picked = picked;
  });

  @override
  Widget build(BuildContext context) {
    // SH-02: the shell's / and Ctrl/⌘+F land here. Next frame, so a request
    // that also switched to this branch finds the field mounted.
    ref.listen<int>(homeSearchRequestProvider, (int? _, int _) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        // Scrolled past it, the field is not built: back to the top first.
        if (_searchFocus.context == null && _scroll.hasClients) {
          _scroll.jumpTo(0);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _searchFocus.requestFocus();
          });
          return;
        }
        _searchFocus.requestFocus();
      });
    });
    final AppLocalizations l10n = AppLocalizations.of(context);
    final MoneyFormatter money = MoneyFormatter(
      l10n.localeName,
      emptyCurrencyCode: ref.watch(currencyCodeProvider),
    );
    final core.AuthUser? user = ref.watch(authRepositoryProvider).currentUser;
    // Settings' "Flag subscriptions you don't use" gates the unused decision.
    final bool showUnused =
        ref.watch(settingsControllerProvider).prefs['unused'] ?? true;
    // The injectable clock the calendar already reads: production never
    // overrides it, and a golden can pin the greeting and every due label.
    final DateTime now = ref.watch(nowProvider)();
    final AsyncValue<List<Subscription>> subs = ref.watch(
      subscriptionsControllerProvider,
    );

    // ⏱ ST-T9 (EN-18): a first sign-in whose list loads EMPTY is offered the
    // after-sign-in setup, once per account. After the frame, because a
    // navigation is not something a build may do; `maybeOf`, because a test
    // that pumps home without a router has nowhere to go.
    if (shouldOfferSetup(
      seen: ref.watch(setupSeenProvider),
      subscriptions: subs,
    )) {
      final GoRouter? router = GoRouter.maybeOf(context);
      if (router != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (context.mounted) router.go('/setup');
        });
      }
    }

    // 🔴 IT MEASURES THE BOX, NOT THE WINDOW. `AppShell`'s scaffold hands this
    // body the window minus its navigation, so a `MediaQuery` reading here
    // would open a column inside a box that cannot hold one.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool aside = constraints.maxWidth >= HomeScreen.asideMinBodyWidth;

        final Widget panes = TwoPane(
          // 🔴 THE `Builder` IS LOAD-BEARING. `TwoPane.isTwoPaneOf` is an
          // inherited lookup and only answers BELOW the TwoPane; `build`'s own
          // context would read `false` at every width, and a row would push a
          // route on top of an already-rendered detail pane.
          list: Builder(
            builder: (BuildContext listContext) => _listColumn(
              listContext,
              l10n,
              money,
              user,
              subs,
              now,
              showUnused,
              summaryInList: !aside,
            ),
          ),
          // Null until a row is tapped; below the split never built, so a
          // phone still pushes `/sub/:id`.
          detail: _selectedId == null
              ? null
              // 🔴 `onClose` IS NOT OPTIONAL HERE. Nothing was pushed, so the
              // location is still `/home`; without it every dismiss control on
              // the detail throws "There is nothing to pop" (GlitchTip
              // SUBLY-9). `test/detail_pane_pop_test.dart` pins both halves.
              : SubscriptionDetailScreen(
                  id: _selectedId!,
                  onClose: () => setState(() => _selectedId = null),
                ),
          // B8: the empty pane says what to do, not what the list is called.
          placeholder: TwoPanePlaceholder(message: l10n.homeSelectSubscription),
        );

        if (!aside) return panes;

        return Row(
          // `stretch`, so the rule between the columns is drawn at full height.
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            SizedBox(
              width: AppBreakpoints.form,
              child: _asideColumn(l10n, money, subs, now),
            ),
            // The SAME divider [TwoPane] draws between its own columns.
            const VerticalDivider(
              width: TwoPaneSplit.dividerWidth,
              thickness: TwoPaneSplit.dividerWidth,
            ),
            Expanded(child: panes),
          ],
        );
      },
    );
  }

  /// The MASTER column: the account header, then everything the subscription
  /// list is made of. Below the split this is the whole screen.
  ///
  /// 🔴 [context] MUST COME FROM INSIDE THE TwoPane — see the `Builder`.
  Widget _listColumn(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    core.AuthUser? user,
    AsyncValue<List<Subscription>> subs,
    DateTime now,
    bool showUnused, {
    required bool summaryInList,
  }) {
    final bool twoPane = TwoPane.isTwoPaneOf(context);

    // `reading` (720) caps the column between 720 and the split, where
    // nothing above this screen caps anything; below 720 and inside the split
    // it is a no-op. It is a CONTENT width, not a navigation breakpoint.
    return ContentPane.reading(
      key: HomeScreen.listPaneKey,
      // ST-N6 (D23): pull down to re-read — the SAME re-read a return to the
      // app runs, so the gesture and the resume cannot disagree about what
      // "refresh" means. Always scrollable, or a short list cannot be pulled.
      child: RefreshIndicator(
        key: HomeScreen.pullToRefreshKey,
        onRefresh: () => refreshOnReturn(ref),
        child: ListView(
          controller: _scroll,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: AppShell.pageInsetOf(context),
          children: <Widget>[
            // THE HEADER IS OUTSIDE THE DATA STATES. It is the route to
            // notifications and settings, so no state may hide it — a spinner
            // that ate it would be a screen with no door.
            _header(context, l10n, user, now),
            const SizedBox(height: AppSpacing.lg),
            ..._states(
              context,
              l10n,
              money,
              subs,
              now,
              showUnused,
              summaryInList: summaryInList,
              twoPane: twoPane,
            ),
          ],
        ),
      ),
    );
  }

  /// LOADING, FAILED, EMPTY and POPULATED — four branches, exactly one on
  /// screen. `test/home_states_test.dart` asserts each by key AND asserts the
  /// other three absent, which is the half that can fail.
  ///
  /// OFFLINE is not a fifth branch here, deliberately: the shell's
  /// `OfflineBannerHost` is the one offline surface in the app, and a cached
  /// list is still the user's list. Offline with data is POPULATED under that
  /// banner; offline without data is FAILED, with its retry.
  List<Widget> _states(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    AsyncValue<List<Subscription>> subs,
    DateTime now,
    bool showUnused, {
    required bool summaryInList,
    required bool twoPane,
  }) {
    if (!subs.hasValue) {
      if (subs.hasError) {
        // A SENTENCE, never the exception: the old `couldNotLoad('$e')` put a
        // stack-adjacent string in front of the user. The sentence is the
        // shared gate's (ST-U6, D21): chosen by WHAT failed, so a session the
        // server ended is not told to check its Wi-Fi.
        return <Widget>[
          DataStateView.failed(
            title: l10n.dataFailedTitle,
            body: dataFailedBodyFor(l10n, subs.error),
            retryLabel: l10n.retry,
            onRetry: () => ref.invalidate(subscriptionsControllerProvider),
          ),
        ];
      }
      // The list's own outline: the rows arrive where the placeholders were.
      return <Widget>[
        AppCard(
          padding: EdgeInsets.zero,
          child: SkeletonList(label: l10n.dataLoading, rows: 4),
        ),
      ];
    }
    final List<Subscription> list = subs.requireValue;
    if (list.isEmpty) {
      // No retry: an empty account is not a malfunction. ✅ ST-U6 (B3): the
      // first step is ON the empty state — "Add subscription" — so a first-run
      // user is never handed a message with nothing on it to tap.
      return <Widget>[
        DataStateView.empty(
          title: l10n.dataEmptyTitle,
          body: l10n.dataEmptyBody,
          actionLabel: l10n.addSubscriptionTitle,
          onAction: () => showAddSubscriptionSheet(context),
        ),
        // IM-01 — the second first step: a list kept somewhere else comes in
        // through the import hub rather than being typed row by row.
        Center(
          child: TextButton(
            key: E2EKeys.homeImport,
            onPressed: () => context.push('/import'),
            child: Text(l10n.importTitle),
          ),
        ),
      ];
    }
    return _dashboard(
      context,
      l10n,
      money,
      list,
      now,
      showUnused,
      summaryInList: summaryInList,
      twoPane: twoPane,
    );
  }

  /// The summary in a column of its own, from [HomeScreen.asideMinBodyWidth].
  ///
  /// 🔴 `.value`, NOT `.when`: the loading and failed states belong in
  /// ONE place — the list column the user is reading. Two skeletons would
  /// report one fetch as two. Until data lands this column is empty, which is
  /// honest: there is no total yet to show.
  Widget _asideColumn(
    AppLocalizations l10n,
    MoneyFormatter money,
    AsyncValue<List<Subscription>> subs,
    DateTime now,
  ) {
    final List<Subscription>? data = subs.value;
    return ListView(
      key: HomeScreen.asideKey,
      // The SAME inset as the list column, so the summary's top edge and the
      // header's top edge start on one line.
      padding: AppShell.pageInsetOf(context),
      children: <Widget>[
        if (data != null && data.isNotEmpty) _summary(l10n, money, data, now),
      ],
    );
  }

  /// Greeting, account name, notifications and the account shortcut.
  Widget _header(
    BuildContext context,
    AppLocalizations l10n,
    core.AuthUser? user,
    DateTime now,
  ) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                _greeting(l10n, now),
                style: text.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              // Signed out, the localised welcome — which is also what keeps
              // `test/smoke_test.dart`'s 'Welcome to' honest.
              Text(
                user?.displayName ?? l10n.welcomeTo(AppConfig.appName),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: text.headlineSmall?.copyWith(color: scheme.onSurface),
              ),
            ],
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        // [13]T-9's entry point. `push`, not `go`: notifications is a detail
        // over the shell, and the user comes back to where they were.
        //
        // 🔴 NO UNREAD DOT. It was `dot: true`, unconditionally — a badge that
        // is always on carries no information, and ST-D0's rule is that an
        // empty count draws nothing. It comes back with a real unread source.
        _headerButton(
          context,
          icon: Icons.notifications_none_rounded,
          label: l10n.notifications,
          onTap: () => context.push('/notifications'),
        ),
        const SizedBox(width: AppSpacing.sm),
        // KEPT beside the Settings destination: the destination is the
        // discoverable route, this is the conventional one (top-right) and the
        // only one that shows WHICH account is signed in.
        //
        // 🔴 `ExcludeSemantics` INSIDE `FocusableTap`, round the visual only.
        // `excludeSemantics: true` on the annotation dropped the tap action
        // with the letter, so a screen reader's double-tap did nothing
        // (`test/a11y_semantics_test.dart`'s `home ·` group pins it). The
        // letter is silent because "Account and settings R" is a stutter.
        FocusableTap(
          label: l10n.a11yAccountSettings,
          mergeDescendants: false,
          borderRadius: BorderRadius.circular(AppRadius.control),
          onTap: () => context.go('/settings'),
          child: ExcludeSemantics(
            child: Container(
              width: kMinInteractiveDimension,
              height: kMinInteractiveDimension,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: scheme.primary,
                borderRadius: BorderRadius.circular(AppRadius.control),
              ),
              child: Text(
                user?.initial ?? 'A',
                style: text.titleMedium?.copyWith(color: scheme.onPrimary),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// An icon-only header control: [kMinInteractiveDimension] square, on the
  /// card's own fill with the card's hairline, so the header controls and the
  /// cards below are one material in both schemes. [label] IS its name.
  Widget _headerButton(
    BuildContext context, {
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    return FocusableTap(
      label: label,
      mergeDescendants: false,
      borderRadius: BorderRadius.circular(AppRadius.control),
      onTap: onTap,
      child: Container(
        width: kMinInteractiveDimension,
        height: kMinInteractiveDimension,
        decoration: BoxDecoration(
          color: AppCard.fillOf(theme),
          borderRadius: BorderRadius.circular(AppRadius.control),
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Icon(icon, color: scheme.onSurface),
      ),
    );
  }

  /// Everything that needs a non-empty subscription list.
  ///
  /// [summaryInList] is false once the summary has its own column. [twoPane] is
  /// [TwoPane.isTwoPaneOf] read inside the pane and threaded down, so every
  /// row decides push-vs-select from the SAME measurement the layout used.
  List<Widget> _dashboard(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
    DateTime now,
    bool showUnused, {
    required bool summaryInList,
    required bool twoPane,
  }) {
    // HO-05: decisions a real row raises, each with one answer.
    final List<HomeSignal> signals = HomeSignals.of(
      subs,
      now,
      stillUsing: showUnused ? (Subscription s) => s.unused : null,
    ).take(HomeSignals.maxShown).toList();
    // HO-04: the next 30 days, four listed, the rest counted.
    final List<Subscription> horizon = SubMath.upcoming(
      subs,
      now,
      take: subs.length,
      withinDays: HomeScreen.upcomingDays,
    );
    final List<Subscription> upcoming = horizon
        .take(HomeScreen.upcomingShown)
        .toList();
    final int more = horizon.length - upcoming.length;
    // ST-AD12: a tag that has left the list (its last row untagged or
    // removed) filters nothing — the list never empties behind a stale chip.
    final List<String> tags = SubMath.tagsOf(subs);
    final String? tag = _tag == null
        ? null
        : tags
              .where((String t) => t.toLowerCase() == _tag!.toLowerCase())
              .firstOrNull;
    // HO-03: search, filter and sort apply to the every-subscription list;
    // a tag (ST-AD12) narrows it the same way.
    final List<Subscription> all = SubMath.taggedWith(_apply(subs, now), tag);
    // HO-08: a picked row that has left the list is no longer picked.
    final Set<String>? picked = _picked?.intersection(<String>{
      for (final Subscription s in subs) s.id,
    });

    // While the user is FINDING — a query or a filter on — the dashboard
    // steps aside and the matches sit directly under the controls.
    final bool finding =
        _query.trim().isNotEmpty || _filters.isNotEmpty || tag != null;

    return <Widget>[
      // FIRST, so / and Ctrl/⌘+F always find the field built: a lazy list
      // does not build what is below the fold, and an unbuilt field cannot
      // take focus.
      _controls(l10n, subs),
      const SizedBox(height: AppSpacing.lg),
      if (!finding)
        ..._overview(
          context,
          l10n,
          money,
          subs,
          now,
          signals,
          upcoming,
          more,
          summaryInList: summaryInList,
          twoPane: twoPane,
        ),
      AppSectionHeader(title: l10n.allSubscriptions, count: '${all.length}'),
      // HO-08: a POINTER has no long press worth teaching, so on the desktop
      // targets the way into the selection is a visible control. A touch
      // target enters it by a long press on a row (also a screen reader's
      // long-press action). Either way the bar's Done is the way out.
      if (picked == null && !HomeScreen.swipesOn(defaultTargetPlatform))
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: TextButton.icon(
            key: HomeScreen.selectKey,
            icon: const Icon(Icons.checklist),
            label: Text(l10n.selectAction),
            onPressed: () => setState(() => _picked = <String>{}),
          ),
        ),
      if (tags.isNotEmpty) ...<Widget>[
        _tagFilter(l10n, tags, tag),
        const SizedBox(height: AppSpacing.sm),
      ],
      if (picked != null) ...<Widget>[
        _selectionBar(context, l10n, subs, picked),
        const SizedBox(height: AppSpacing.sm),
      ],
      if (all.isEmpty)
        Padding(
          key: HomeScreen.noMatchesKey,
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
          child: Text(
            l10n.homeNoMatches,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        )
      else
        AppListGroup(
          key: HomeScreen.allKey,
          children: <Widget>[
            for (final Subscription s in all)
              _row(
                context,
                l10n,
                money,
                s,
                now,
                due: false,
                twoPane: twoPane,
                swipe:
                    picked == null &&
                    HomeScreen.swipesOn(defaultTargetPlatform),
              ),
          ],
        ),
    ];
  }

  /// The summary, the decisions and the upcoming charges — what Home shows
  /// above the list while the user is not searching.
  List<Widget> _overview(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
    DateTime now,
    List<HomeSignal> signals,
    List<Subscription> upcoming,
    int more, {
    required bool summaryInList,
    required bool twoPane,
  }) {
    return <Widget>[
      // In this column only while there is no column of its own: two summary
      // cards quoting one total read as a duplicated render.
      if (summaryInList) ...<Widget>[
        _summary(l10n, money, subs, now),
        const SizedBox(height: AppSpacing.lg),
      ],
      for (final HomeSignal sig in signals)
        _signalStrip(context, l10n, money, sig),
      // The Calendar link is the section's action: a real, keyboard-reachable
      // 48 px control whose arrow mirrors in RTL (the word used to carry a
      // literal '→').
      AppSectionHeader(
        title: l10n.upcomingRenewals,
        // "{n} more →" when the horizon holds more than the four listed.
        actionLabel: more > 0 ? l10n.homeUpcomingMore(more) : l10n.calendarLink,
        onAction: () => context.go('/calendar'),
      ),
      if (upcoming.isNotEmpty)
        AppListGroup(
          key: HomeScreen.upcomingKey,
          children: <Widget>[
            for (final Subscription s in upcoming)
              _row(context, l10n, money, s, now, due: true, twoPane: twoPane),
          ],
        ),
    ];
  }

  /// The filter keys: `status:<name>`, `cat:<category>`, `cur:<code>`.
  /// OR within a group, AND across groups.
  static const String _status = 'status:';
  static const String _cat = 'cat:';
  static const String _cur = 'cur:';

  /// [subs] searched (name and notes), filtered and sorted — through the
  /// shared [ListControls.apply], so the fold is the design system's.
  List<Subscription> _apply(List<Subscription> subs, DateTime now) {
    Iterable<String> group(String prefix) => _filters
        .where((String f) => f.startsWith(prefix))
        .map((String f) => f.substring(prefix.length));
    final Set<String> statuses = group(_status).toSet();
    final Set<String> cats = group(_cat).toSet();
    final Set<String> curs = group(_cur).toSet();
    final List<Subscription> base = SubMath.byMonthlyDesc(subs);
    return ListControls.apply<Subscription>(
      base,
      query: _query,
      matches: (Subscription s, String q) =>
          ListControls.anyFieldContains(<String>[s.name, s.notes], q),
      filters: <bool Function(Subscription)>[
        if (statuses.isNotEmpty)
          (Subscription s) => statuses.contains(s.status.name),
        if (cats.isNotEmpty) (Subscription s) => cats.contains(s.category),
        if (curs.isNotEmpty) (Subscription s) => curs.contains(s.currencyCode),
      ],
      compare: switch (_sort) {
        // byMonthlyDesc already ordered `base`; the stable fold keeps it.
        HomeSort.monthlyShare => null,
        HomeSort.nextCharge =>
          (Subscription a, Subscription b) =>
              a.daysUntil(now).compareTo(b.daysUntil(now)),
        // Within one currency only: across currencies the input (grouped by
        // currency) order stands, because the amounts do not compare.
        HomeSort.price =>
          (Subscription a, Subscription b) => a.currencyCode != b.currencyCode
              ? 0
              : b.price.minorUnits.compareTo(a.price.minorUnits),
        HomeSort.name =>
          (Subscription a, Subscription b) =>
              a.name.toLowerCase().compareTo(b.name.toLowerCase()),
      },
    );
  }

  /// The shared [ListControls], fed this screen's words and filters.
  Widget _controls(AppLocalizations l10n, List<Subscription> subs) {
    final List<String> categories =
        subs.map((Subscription s) => s.category).toSet().toList()..sort();
    final List<String> currencies =
        subs.map((Subscription s) => s.currencyCode).toSet().toList()..sort();
    String statusLabel(SubscriptionStatus st) => switch (st) {
      SubscriptionStatus.active => l10n.homeFilterActive,
      SubscriptionStatus.trialing => l10n.homeFilterTrial,
      SubscriptionStatus.paused => l10n.statusPaused,
      SubscriptionStatus.cancelled => l10n.statusCancelled,
    };
    return ListControls<HomeSort, String>(
      searchFieldKey: HomeScreen.searchFieldKey,
      sortButtonKey: HomeScreen.sortKey,
      searchLabel: l10n.homeSearchLabel,
      clearSearchLabel: l10n.homeSearchClear,
      searchController: _search,
      searchFocusNode: _searchFocus,
      query: _query,
      onQueryChanged: (String q) => setState(() => _query = q),
      sortLabel: l10n.homeSortLabel,
      sortOptions: <ListSortOption<HomeSort>>[
        ListSortOption<HomeSort>(
          value: HomeSort.monthlyShare,
          label: l10n.homeSortMonthlyShare,
        ),
        ListSortOption<HomeSort>(
          value: HomeSort.nextCharge,
          label: l10n.homeSortNextCharge,
        ),
        ListSortOption<HomeSort>(
          value: HomeSort.price,
          label: l10n.homeSortPrice,
        ),
        ListSortOption<HomeSort>(
          value: HomeSort.name,
          label: l10n.homeSortName,
        ),
      ],
      sort: _sort,
      onSortChanged: (HomeSort v) => setState(() => _sort = v),
      // STATUS is a fixed four and always offered — filtering to one the
      // list does not hold says "No subscriptions match", which is true. A
      // category or currency group with one value filters nothing, so it
      // draws no chips.
      filters: <ListFilterOption<String>>[
        for (final SubscriptionStatus st in SubscriptionStatus.values)
          ListFilterOption<String>(
            value: '$_status${st.name}',
            label: statusLabel(st),
          ),
        if (categories.length > 1 || _drilledTo != null)
          for (final String c in categories)
            ListFilterOption<String>(
              value: '$_cat$c',
              label: categoryLabel(l10n, c),
            ),
        if (currencies.length > 1)
          for (final String c in currencies)
            ListFilterOption<String>(value: '$_cur$c', label: c),
      ],
      filterLabel: l10n.homeFilterLabel,
      filterButtonKey: HomeScreen.filterKey,
      filtersOpen: _filtersOpen || _filters.isNotEmpty,
      onFiltersOpenChanged: (bool open) => setState(() {
        _filtersOpen = open;
        // Closing the chips clears them: a filter the user cannot see is a
        // list that silently shows less than it says.
        if (!open) _filters.clear();
      }),
      selectedFilters: _filters,
      onFilterToggled: (String f) => setState(
        () => _filters.contains(f) ? _filters.remove(f) : _filters.add(f),
      ),
    );
  }

  /// One [HomeSignal] as a [DecisionStrip] with its one answer (HO-05).
  Widget _signalStrip(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    HomeSignal sig,
  ) {
    final Subscription s = sig.subscription;
    final (String message, String? detail) = switch (sig.kind) {
      HomeSignalKind.trialEnding => (
        l10n.homeSignalTrialEnds(s.name, sig.days),
        null,
      ),
      HomeSignalKind.yearlyDue => (
        l10n.homeSignalYearlyDue(s.name, sig.days),
        l10n.homeSignalYearlyDueDetail(money.format(s.price)),
      ),
      HomeSignalKind.priceRose => (
        l10n.homeSignalPriceRose(s.name, money.format(s.price)),
        l10n.homeSignalPriceRoseDetail(money.format(sig.was!)),
      ),
      HomeSignalKind.stillUsing => (l10n.homeSignalStillUsing(s.name), null),
    };
    final bool stop = sig.kind == HomeSignalKind.stillUsing;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: DecisionStrip(
        key: HomeScreen.signalKey(sig.kind, s.id),
        kind: StatusKind.warn,
        message: message,
        detail: detail,
        actions: <DecisionAction>[
          DecisionAction(
            key: HomeScreen.signalActionKey(sig.kind, s.id),
            label: stop ? l10n.homeSignalStop : l10n.homeSignalOpen,
            primary: true,
            onPressed: stop
                // DE-07: the stop-a-charge flow replaced the cancel sheet.
                ? () => showStopSheet(context, s)
                : () => context.push('/sub/${s.id}'),
          ),
        ],
      ),
    );
  }

  /// The tag filter (ST-AD12): one chip per tag on the list, at most one on.
  /// Choosing the chip that is on turns the filter off.
  Widget _tagFilter(AppLocalizations l10n, List<String> tags, String? on) {
    return Semantics(
      label: l10n.tagFilterLabel,
      container: true,
      child: Wrap(
        key: HomeScreen.tagFilterKey,
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: <Widget>[
          for (final String t in tags)
            FilterChip(
              key: HomeScreen.tagChipKeyOf(t),
              label: Text(t),
              selected: on != null && on.toLowerCase() == t.toLowerCase(),
              onSelected: (bool sel) => setState(() => _tag = sel ? t : null),
            ),
        ],
      ),
    );
  }

  /// The selection's actions (HO-08): how many are picked, then Pause, Mark
  /// cancelled, Delete and Export — each acting on every picked row, each
  /// with ONE Undo for all of them. Disabled until something is picked.
  Widget _selectionBar(
    BuildContext context,
    AppLocalizations l10n,
    List<Subscription> subs,
    Set<String> picked,
  ) {
    final ThemeData theme = Theme.of(context);
    final List<Subscription> rows = <Subscription>[
      for (final Subscription s in subs)
        if (picked.contains(s.id)) s,
    ];
    final bool any = rows.isNotEmpty;
    final Future<core.ExportOutcome> Function(core.ExportFile)? export =
        exportFileTap(ref);
    return AppCard(
      key: HomeScreen.selectionBarKey,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    l10n.selectedCount(rows.length),
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                ),
              ),
              TextButton(
                key: HomeScreen.selectDoneKey,
                onPressed: () => setState(() => _picked = null),
                child: Text(l10n.selectDone),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.xs,
            children: <Widget>[
              TextButton.icon(
                key: HomeScreen.bulkPauseKey,
                icon: const Icon(Icons.pause),
                label: Text(l10n.actionPause),
                onPressed: any ? () => _pauseRows(rows) : null,
              ),
              TextButton.icon(
                key: HomeScreen.bulkCancelKey,
                icon: const Icon(Icons.cancel_outlined),
                label: Text(l10n.actionMarkCancelled),
                onPressed: any ? () => _cancelRows(rows) : null,
              ),
              TextButton.icon(
                key: HomeScreen.bulkDeleteKey,
                icon: const Icon(Icons.delete_outline),
                label: Text(l10n.actionDeleteFromTracker),
                onPressed: any ? () => _deleteRows(rows) : null,
              ),
              // Absent while `features.exports` is off — the one flag every
              // file that leaves the app answers to.
              if (export != null)
                TextButton.icon(
                  key: HomeScreen.bulkExportKey,
                  icon: const Icon(Icons.ios_share),
                  label: Text(l10n.exportSelected),
                  onPressed: any ? () => _exportRows(l10n, export, rows) : null,
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// One snackbar for a write over [count] rows, with ONE Undo for all of
  /// them. Resolved before any await by the callers: it outlives the rows.
  void _announce(
    ScaffoldMessengerState messenger,
    String message,
    Future<void> Function() undo,
  ) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          action: SnackBarAction(label: l10n.undo, onPressed: () => undo()),
        ),
      );
  }

  /// Runs a bulk [write], leaves the selection, and reports a failure in a
  /// sentence — never a stack-adjacent string.
  Future<void> _bulk(
    Future<void> Function(
      SubscriptionsController ctl,
      ScaffoldMessengerState messenger,
    )
    write,
  ) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    final SubscriptionsController ctl = ref.read(
      subscriptionsControllerProvider.notifier,
    );
    setState(() => _picked = null);
    try {
      await write(ctl, messenger);
    } on Object {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.updateSubscriptionFailed)),
      );
    }
  }

  /// Pause [rows] — or, for a swipe on a row already stopped, resume it.
  Future<void> _pauseRows(List<Subscription> rows) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return _bulk((SubscriptionsController ctl, ScaffoldMessengerState m) async {
      final List<Subscription> before = await ctl.pauseMany(
        rows.map((Subscription s) => s.id),
      );
      if (before.isEmpty) return;
      _announce(
        m,
        l10n.bulkPaused(before.length),
        () => ctl.restoreStatuses(before),
      );
    });
  }

  /// A swipe's start-to-end action: Pause a charging row, Resume a stopped
  /// one — the overflow menu's pair, on one gesture.
  Future<void> _pauseOrResume(Subscription s) {
    if (s.isCharging) return _pauseRows(<Subscription>[s]);
    final AppLocalizations l10n = AppLocalizations.of(context);
    return _bulk((SubscriptionsController ctl, ScaffoldMessengerState m) async {
      await ctl.resumeSubscription(s.id);
      _announce(
        m,
        l10n.subscriptionResumed(s.name),
        () => ctl.restoreStatuses(<Subscription>[s]),
      );
    });
  }

  Future<void> _cancelRows(List<Subscription> rows) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return _bulk((SubscriptionsController ctl, ScaffoldMessengerState m) async {
      final List<Subscription> before = await ctl.markCancelledMany(
        rows.map((Subscription s) => s.id),
      );
      if (before.isEmpty) return;
      _announce(
        m,
        l10n.bulkMarkedCancelled(before.length),
        () => ctl.restoreStatuses(before),
      );
    });
  }

  /// Delete [rows] — SOFT deletes, so the one Undo brings every one back.
  Future<void> _deleteRows(List<Subscription> rows) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return _bulk((SubscriptionsController ctl, ScaffoldMessengerState m) async {
      final List<Subscription> removed = await ctl.deleteMany(
        rows.map((Subscription s) => s.id),
      );
      if (removed.isEmpty) return;
      final List<String> ids = <String>[
        for (final Subscription s in removed) s.id,
      ];
      final String message = removed.length == 1
          ? l10n.subscriptionDeleted(removed.single.name)
          : l10n.bulkDeleted(removed.length);
      if (!ids.any(ctl.canUndoDelete)) {
        // The hard-DELETE fallback: nothing to bring back, so no Undo.
        m.showSnackBar(SnackBar(content: Text(message)));
        return;
      }
      _announce(m, message, () => ctl.undoDeleteMany(ids));
    });
  }

  /// Export [rows] as the same CSV Settings exports, through the same seam.
  Future<void> _exportRows(
    AppLocalizations l10n,
    Future<core.ExportOutcome> Function(core.ExportFile) export,
    List<Subscription> rows,
  ) async {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    setState(() => _picked = null);
    final core.ExportOutcome outcome = await export(subscriptionsCsvFile(rows));
    if (outcome == core.ExportOutcome.failed) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.exportFailed)));
    }
  }

  /// The summary: the monthly total, its two qualifiers, and the 7- and
  /// 30-day figures.
  ///
  /// `store_screenshots_test.dart` records `data.length` and
  /// `SubMath.totalMonthly(data)` as the board the frame shows — they are the
  /// `N active` fact and the figure here.
  Widget _summary(
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
    DateTime now,
  ) {
    return AppSummaryCard(
      key: HomeScreen.summaryKey,
      label: l10n.monthlySpend,
      figure: money.formatBag(SubMath.totalMonthly(subs)),
      facts: <String>[
        // PLURAL, so an inflecting language gets its arms. ⏱ ST truth pass
        // (HO-01): the CHARGING rows, the set the figure above is summed
        // over — a paused or cancelled row is on the list, not "active".
        l10n.activeCount(SubMath.charging(subs).length),
        // The plans' own yearly charges, never twelve rounded twelfths.
        l10n.perYearTotal(money.formatBagRounded(SubMath.totalYearly(subs))),
      ],
      stats: <SummaryStat>[
        SummaryStat(
          label: l10n.dueIn7Days,
          value: money.formatBag(SubMath.dueWithin(subs, now, 7)),
        ),
        // A 30-day horizon, which is derived. The app stores no history, so
        // no month-over-month figure could be honest.
        SummaryStat(
          label: l10n.dueIn30Days,
          value: money.formatBag(SubMath.dueWithin(subs, now, 30)),
        ),
      ],
    );
  }

  /// One subscription as an [AppListRow].
  ///
  /// [due] rows say WHEN it renews, and the renewal within a day is a warn
  /// STATUS — the word first, the scheme's warn tone second. Other rows say
  /// what it is, and a usage band where usage data exists.
  Widget _row(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    Subscription s,
    DateTime now, {
    required bool due,
    required bool twoPane,
    bool swipe = false,
  }) {
    final Set<String>? picked = _picked;
    final String subtitle;
    final StatusKind? status;
    if (due) {
      subtitle = DueInfo.localized(l10n, s, now).label;
      status = s.daysUntil(now) <= 1 ? StatusKind.warn : null;
    } else {
      // THE USAGE BAND ONLY WHERE USAGE DATA EXISTS. Nothing in the app
      // collects `usedPct` or `unused`, so on a real row both are defaults and
      // a band would be a fixed string dressed as a measurement. The demo set
      // and any API that sends `used_pct` keep all three bands.
      final bool hasUsage = s.unused || s.usedPct > 0;
      final String? usage = !hasUsage
          ? null
          : (s.unused
                ? l10n.usageRarelyUsed
                : (s.usedPct > 60 ? l10n.usageActive : l10n.usageOccasional));
      // ⏱ ST truth pass (HO-02): a row that is not simply active SAYS so —
      // "Paused", "Cancelled", "Free trial until …" — in its status tone, and
      // that outranks the usage band, which is about a plan still charging.
      final LifeStatus? life = LifeStatus.of(l10n, s);
      final String? note = life?.label ?? usage;
      final String category = categoryLabel(l10n, s.category);
      subtitle = note == null ? category : '$category · $note';
      status =
          life?.kind ??
          (!hasUsage
              ? null
              : (s.unused
                    ? StatusKind.warn
                    : (s.usedPct > 60 ? StatusKind.positive : null)));
    }

    // HO-06: the catalogue's logo where the row came from the catalogue and
    // the pack has one; else the monogram.
    final String? logo = s.serviceId == null
        ? null
        : ref.watch(serviceLogoAssetsProvider)[s.serviceId];
    // ST-T9 (AD-06): how it is paid, as neutral text in the subtitle's own
    // colour — no new tone; the row's status stays the only coloured signal.
    final String? rail = railLabel(l10n, s.rail);
    final Widget row = AppListRow(
      // The mark is a visual shorthand; the title names the plan, so the
      // logo or letters are silent rather than read before the name. In the
      // selection mode the slot holds the row's checkbox instead (HO-08) —
      // the one control a pointer and a screen reader both expect there.
      leading: picked != null
          ? Checkbox(
              key: HomeScreen.pickKeyOf(s.id),
              value: picked.contains(s.id),
              onChanged: (_) => _toggle(s.id),
            )
          : ExcludeSemantics(
              child: logo == null
                  ? _monogram(context, s)
                  : ClipRRect(
                      borderRadius: BorderRadius.circular(AppRadius.control),
                      child: Image.asset(
                        logo,
                        width: AppListRow.leadingSize,
                        height: AppListRow.leadingSize,
                        fit: BoxFit.contain,
                        errorBuilder:
                            (BuildContext c, Object e, StackTrace? t) =>
                                _monogram(c, s),
                      ),
                    ),
            ),
      title: s.name,
      subtitle: rail == null ? subtitle : '$subtitle · $rail',
      status: status,
      // The list SORTS by monthly share and the row SHOWS the charge with its
      // own cycle: a share is not a price.
      figure: money.format(s.price),
      caption: cadenceCaption(l10n, s.cycle),
      // A selection exists only where the layout has one: in a single column
      // the tap pushes a route, and "not selected" on every row would announce
      // a state this screen does not have. The multi-selection is one.
      selected: picked != null
          ? picked.contains(s.id)
          : (twoPane ? s.id == _selectedId : null),
      showChevron: picked == null,
      onTap: () {
        if (picked != null) {
          _toggle(s.id);
        } else if (twoPane) {
          // No navigation: the detail is already beside this row.
          setState(() => _selectedId = s.id);
        } else {
          context.push('/sub/${s.id}');
        }
      },
      // HO-08: a long press enters the selection with this row picked.
      onLongPress: () => picked == null
          ? setState(() => _picked = <String>{s.id})
          : _toggle(s.id),
    );
    if (!swipe) return row;
    return _swipeable(context, l10n, s, row);
  }

  /// [row] with the touch idiom on it (HO-08): swipe towards the END to pause
  /// (or resume a stopped row), towards the START to delete — each with an
  /// Undo. A delete lets the row leave; a pause leaves it in place, because
  /// a paused row stays on the list.
  Widget _swipeable(
    BuildContext context,
    AppLocalizations l10n,
    Subscription s,
    Widget row,
  ) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final bool stopped = !s.isCharging;
    return Dismissible(
      key: HomeScreen.swipeKeyOf(s.id),
      background: _swipeBackground(
        context,
        icon: stopped ? Icons.play_arrow : Icons.pause,
        label: stopped ? l10n.actionResume : l10n.actionPause,
        fill: scheme.secondaryContainer,
        ink: scheme.onSecondaryContainer,
        alignment: AlignmentDirectional.centerStart,
      ),
      secondaryBackground: _swipeBackground(
        context,
        icon: Icons.delete_outline,
        label: l10n.actionDeleteFromTracker,
        fill: scheme.errorContainer,
        ink: scheme.onErrorContainer,
        alignment: AlignmentDirectional.centerEnd,
      ),
      confirmDismiss: (DismissDirection direction) async {
        if (direction == DismissDirection.startToEnd) {
          await _pauseOrResume(s);
          return false;
        }
        await _deleteRows(<Subscription>[s]);
        // Let the row go only if the delete took it off the list; a failed
        // write leaves it, and it slides back.
        if (!mounted) return false;
        final List<Subscription>? now = ref
            .read(subscriptionsControllerProvider)
            .value;
        return now != null && !now.any((Subscription x) => x.id == s.id);
      },
      child: row,
    );
  }

  Widget _swipeBackground(
    BuildContext context, {
    required IconData icon,
    required String label,
    required Color fill,
    required Color ink,
    required AlignmentGeometry alignment,
  }) {
    return ColoredBox(
      color: fill,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Align(
          alignment: alignment,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon, color: ink),
              const SizedBox(width: AppSpacing.sm),
              Text(
                label,
                style: Theme.of(
                  context,
                ).textTheme.labelLarge?.copyWith(color: ink),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// The subscription's glyph (e.g. `NFX`), or its initial when it has none,
  /// in the scheme's `primaryContainer` pair.
  Widget _monogram(BuildContext context, Subscription s) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final String mark = s.glyph.isNotEmpty
        ? s.glyph
        : (s.name.isEmpty ? '?' : s.name.characters.first.toUpperCase());
    return CircleAvatar(
      backgroundColor: scheme.primaryContainer,
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xs),
          child: Text(
            mark,
            style: theme.textTheme.labelLarge?.copyWith(
              color: scheme.onPrimaryContainer,
            ),
          ),
        ),
      ),
    );
  }

  /// The time-of-day greeting. The BOUNDARIES stay in Dart and only the words
  /// move to the arb: a locale that divides the day differently needs a
  /// different rule, not a different string.
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
/// 🔴 HO-09 · THE OPT-OUT IT READS IS "RENEWAL ALERTS", NOT THE RETIRED DAILY
/// SWITCH. It read `remindersEnabledProvider`, which launch forces OFF
/// (ST-U1: the chassis daily reminder is not this app's) — so on web, the one
/// target this banner exists for, it could never show. It now reads the
/// capability (`renewalRemindersProvider`, `!canSchedule`) and the
/// alerts preference, at the reminder time the user chose in Settings.
///
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
    // The same object the scheduler was built from, so the nudge and the
    // scheduler cannot disagree about whether this target schedules.
    final NotificationCapabilities caps = ref
        .watch(renewalRemindersProvider)
        .capabilities;
    final SettingsState settings = ref.watch(settingsControllerProvider);
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DateTime now = (clock ?? DateTime.now)();
    final core.CatchUpNudgeVerdict verdict = const core.CatchUpNudge().decide(
      now: now,
      lastShownAt: ref.watch(catchUpNudgeProvider),
      reminderHour: settings.reminderMinuteOfDay ~/ 60,
      reminderMinute: settings.reminderMinuteOfDay % 60,
      remindersEnabled: settings.prefs['alerts'] ?? true,
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

  /// The rail's "plans changed" signal this card is repainted on.
  ///
  /// A STORE RAIL'S PLANS ARRIVE AFTER THE FIRST FRAME. Its price and trial are
  /// the store's answer, so the card first builds with no plans — which decides
  /// `nothingToShow` and latches nothing — and is decided again when they land.
  /// The web rail's plans are the rail config and never change.
  Listenable? _offeringsChanged;

  void _repaint() {
    if (mounted) setState(() {});
  }

  void _follow(Listenable changes) {
    if (identical(changes, _offeringsChanged)) return;
    _offeringsChanged?.removeListener(_repaint);
    _offeringsChanged = changes..addListener(_repaint);
  }

  @override
  void dispose() {
    _offeringsChanged?.removeListener(_repaint);
    super.dispose();
  }

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
    final core.AppConfig? cfg = ref.watch(appConfigProvider).value;
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
    final core.PromoGateState? stored = ref.watch(promoCardStateProvider).value;
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
        .value;
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
    _follow(offeringsChangesOf(rail));
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
            //
            // 🔴 AND NOTHING TO PROMOTE WHERE THIS BUILD CANNOT SELL. This was
            // `offerings.isNotEmpty` alone, so on Android, iOS, macOS and
            // apps.gov.in — where the channel forbids this rail and the build
            // ships no store billing — the card still rendered, PRICE AND ALL,
            // with only its buy button removed. A price for digital content the
            // build cannot sell in-app is the thing App Store 3.1.1/3.1.3(b)
            // and Google's payments policy forbid: it can only be paid
            // somewhere else. Parity is the capability on a target or an
            // honest absence — never a price with the button taken off.
            // Cancelling stays reachable: Settings' Manage-plan row is not
            // gated on the rail (ROSCA).
            // ST-U2 (audit C35): and nothing while `paywall.enabled` is false.
            hasContent:
                offerings.isNotEmpty &&
                rail.canStartCheckout &&
                ref.watch(sellingEnabledProvider),
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
    if (offerings.isEmpty || !rail.canStartCheckout) {
      return const SizedBox.shrink();
    }
    // The rail's OWN order, the same order the paywall lists them in. Picking
    // "the cheapest" would need a currency comparison this repo cannot make —
    // amounts are minor units of whatever currency the rail sent.
    final Offering offering = offerings.first;

    // ── THE VARIANT ────────────────────────────────────────────────────────
    // Absent id (the disk read has not landed) or absent flag ⇒ variant A.
    // Never a coin flip: `resolveFlag` is deterministic per install, so a user
    // does not see a different card on every launch.
    final String? installId = ref.watch(installIdProvider).value;
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
        // 🔴 THROUGH `MoneyFormatter` UNDER THE READER'S LOCALE, as the
        // paywall does — `offering.formattedPrice` has no grouping at all.
        priceLabel: l10n.promoCardPrice(
          MoneyFormatter(l10n.localeName).format(offering.price),
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
