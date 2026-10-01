// ─────────────────────────────────────────────────────────────────────────────
// HOME — train ST-D1, the Subscription Tracker design, built on the ST-D0
// foundation.
//
// The dashboard is FOUNDATION COMPONENTS AND DOMAIN VALUES, nothing else:
//
//   · `AppSummaryCard`  — the monthly total, what qualifies it, and the 7- and
//                         30-day figures. Replaces the brand-gradient hero, whose
//                         white-on-purple literals no theme could reach.
//   · `DecisionStrip`   — "N marked unused · cancel to save X · Review": the
//                         one decision this screen asks. Replaces the warn-bar
//                         `RowCard` and its hand-measured `!` glyph tone.
//   · `AppSectionHeader` + `AppListGroup` of `AppListRow`s — upcoming renewals
//                         and every subscription. Replace `SectionHeader` and
//                         one `RowCard` per row.
//   · `SkeletonList` / `DataStateView` — loading, empty and failed are three
//                         different screens, never a bare spinner and never a
//                         raw exception string (`couldNotLoad('$e')` is gone
//                         from here).
//
// What this file still decides is domain: which subscriptions are upcoming,
// which one is urgent, what "unused" means, where a tap goes. Every colour,
// size and type style comes from the theme through the components.
//
// 🔴 THE ORDERING RULE THIS FILE ENCODES, because it is the one that bites:
// `overrides.md` §10-11 records that home and settings must merge AS A PAIR —
// `showUnused` below reads `prefs['unused']`, which only the settings toggles
// write. Changing one screen without the other severs a coupling nothing tests.
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
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../core/windows_notification_identity.g.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';
import '../../state/providers.dart';
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
import '../shell/app_shell.dart';

/// Home — branch 0's BODY ([ADR 037] Variant B): `AppShell` owns the adaptive
/// [AppScaffold], so this screen carries NO scaffold of its own — nesting one
/// inside the shell's body would render two navigation surfaces.
///
/// The `PaywallGate` wraps the INSIGHTS branch in `lib/core/router.dart`, so
/// `paywallLockedProvider` keeps its one real consumer there.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

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

  /// The summary's own column, present from [asideMinBodyWidth] up.
  static const Key asideKey = Key('home-aside');

  /// The summary card, wherever it is laid out.
  static const Key summaryKey = Key('home-summary');

  /// The unused-plans decision.
  static const Key unusedStripKey = Key('home-unused-strip');

  /// The decision's one answer.
  static const Key unusedReviewKey = Key('home-unused-review');

  /// The upcoming-renewals group.
  static const Key upcomingKey = Key('home-upcoming');

  /// The every-subscription group.
  static const Key allKey = Key('home-all');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return const Column(
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
    );
  }
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

  @override
  Widget build(BuildContext context) {
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
          placeholder: TwoPanePlaceholder(message: l10n.allSubscriptions),
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
      child: ListView(
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
    final List<Subscription> unused = SubMath.unused(subs);
    final List<Subscription> upcoming = SubMath.upcoming(subs, now);
    final List<Subscription> all = SubMath.byMonthlyDesc(subs);

    return <Widget>[
      // In this column only while there is no column of its own: two summary
      // cards quoting one total read as a duplicated render.
      if (summaryInList) ...<Widget>[
        _summary(l10n, money, subs, now),
        const SizedBox(height: AppSpacing.lg),
      ],
      if (showUnused && unused.isNotEmpty)
        // A DECISION, NOT A NOTICE: the user has plans they marked unused,
        // and the answer is one tap away. The tone is the scheme's warn pair
        // on an opaque tint — measured once per scheme by the component —
        // which retires the `_warnGlyphOnWash` #956006 this file measured by
        // hand for a 16 % wash.
        DecisionStrip(
          key: HomeScreen.unusedStripKey,
          kind: StatusKind.warn,
          // PLURAL: the whole clause is in each arm, so a language that
          // inflects the noun translates a sentence.
          message: l10n.markedUnusedCount(unused.length),
          detail: l10n.cancelToSave(money.formatBag(SubMath.savings(subs))),
          actions: <DecisionAction>[
            DecisionAction(
              key: HomeScreen.unusedReviewKey,
              label: l10n.homeReviewUnused,
              primary: true,
              onPressed: () => context.go('/insights'),
            ),
          ],
        ),
      // The Calendar link is the section's action: a real, keyboard-reachable
      // 48 px control whose arrow mirrors in RTL (the word used to carry a
      // literal '→').
      AppSectionHeader(
        title: l10n.upcomingRenewals,
        actionLabel: l10n.calendarLink,
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
      AppSectionHeader(title: l10n.allSubscriptions, count: '${subs.length}'),
      AppListGroup(
        key: HomeScreen.allKey,
        children: <Widget>[
          for (final Subscription s in all)
            _row(context, l10n, money, s, now, due: false, twoPane: twoPane),
        ],
      ),
    ];
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
  }) {
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
      subtitle = note == null ? s.category : '${s.category} · $note';
      status =
          life?.kind ??
          (!hasUsage
              ? null
              : (s.unused
                    ? StatusKind.warn
                    : (s.usedPct > 60 ? StatusKind.positive : null)));
    }

    return AppListRow(
      // The monogram is a visual shorthand; the title names the plan, so the
      // letters are silent rather than read before the name.
      leading: ExcludeSemantics(child: _monogram(context, s)),
      title: s.name,
      subtitle: subtitle,
      status: status,
      // The list SORTS by monthly share and the row SHOWS the charge with its
      // own cycle: a share is not a price.
      figure: money.format(s.price),
      caption: cadenceCaption(l10n, s.cycle),
      // A selection exists only where the layout has one: in a single column
      // the tap pushes a route, and "not selected" on every row would announce
      // a state this screen does not have.
      selected: twoPane ? s.id == _selectedId : null,
      onTap: () {
        if (twoPane) {
          // No navigation: the detail is already beside this row.
          setState(() => _selectedId = s.id);
        } else {
          context.push('/sub/${s.id}');
        }
      },
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
    final NotificationCapabilities caps = NotificationCapabilities.resolve(
      defaultTargetPlatform,
      isWeb: kIsWeb,
      windows: kWindowsNotificationIdentity,
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
