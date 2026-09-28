import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/subscriptions_controller.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/async_gate.dart' show dataFailedBodyFor;
import '../shared/widgets.dart';

/// First-run setup screen. It loads subscriptions from the repository and
/// prepares the derived views, and the step labels now say exactly that.
///
/// 2026-07-27 - these labels previously read "Connecting to accounts",
/// "Reading bank statements", "Scanning inbox receipts", "Matching merchants",
/// "Detecting recurring charges". The app does NONE of those: there is no bank
/// or mail integration anywhere in the dependency graph, and this widget is a
/// timer over a fixed list. Telling a user their bank statements are being read
/// when they are not is a false claim about access to financial data, and a
/// store-submission and payment-processor risk on top of that. If real import is
/// ever built, these labels earn their way back one at a time, as each becomes
/// true. (They now live in `app_en.arb` as `scanStep1..5`; the honesty argument
/// above is about the COPY, and it travels with the key rather than being lost
/// when the literal moved.)
///
/// ✅ RE-MEASURED 2026-08-21 against `lib/l10n/app_en.arb:867-889`, because a
/// work order arrived that still described the OLD copy as live. It is not:
/// `scanStep1..5` read "Preparing your board" / "Loading your subscriptions" /
/// "Building your renewal calendar" / "Working out your totals" / "Finalising",
/// and `app_ta.arb:195-199` carries the same five. Every one of those is a
/// thing this widget's own dependency graph actually does. The paragraph above
/// is therefore a HISTORY of copy that was removed, not a description of copy
/// that ships — kept verbatim because the honesty argument is the durable part
/// and a dated record that gets renumbered stops being evidence.
///
/// ✅ ST-U3 (B44 copy): the busy CTA `scanningEllipsis` now reads "Loading…"
/// and the ring's label `a11yScanRing` "Setting up, {percent}." — the last two
/// strings on this surface that asserted a scan. The key names stay; their
/// values no longer claim one.
///
/// ⏱ 2026-09-28 · train ST-D7 — "IMPORT", ON THE ST-D0 FOUNDATION. This file
/// used to fork every colour by brightness (LIGHT the literal `AppColors`
/// token, DARK the scheme slot) and paint its own ring, bar, gradient hero and
/// row cards. It is now built only from the foundation, so it is one design in
/// both schemes and nothing on it is a colour, size or type literal:
///
///  * **loading** — a determinate [LinearProgressIndicator] with its figure
///    and the step caption, over a [SkeletonList] in an [AppCard]: the outline
///    of the list about to arrive, so nothing jumps when it lands. The
///    hand-painted ring and its `AppColors.accent` arc are gone.
///  * **populated** — the summary in an [AppCard] (count and monthly total in
///    the theme's ramp, tabular figures) over one card of [AppListRow]s. The
///    saturated gradient hero, whose white label needed an alpha argument to
///    clear AA, is gone with it.
///  * **empty** — [DataStateView.empty]. The fetch worked and the answer is
///    nothing, which used to render as a hero congratulating the user on "0
///    subscriptions · ₹0 per month".
///  * **failed / offline** — [DataStateView.failed], with its own retry. The
///    body says what to do about a transport failure
///    ([ApiException.isOffline]) and nothing is invented for any other; the
///    raw exception (`couldNotLoad('$e')`) is no longer printed at a user.
class ScanScreen extends ConsumerStatefulWidget {
  const ScanScreen({super.key});

  @override
  ConsumerState<ScanScreen> createState() => _ScanScreenState();
}

class _ScanScreenState extends ConsumerState<ScanScreen> {
  /// How many captions the run cycles through — `scanStep1..5`.
  ///
  /// 🔴 THE LABELS THEMSELVES ARE NO LONGER STATE, and that is forced rather
  /// than tidy. They used to be a `static const List<String>` that the timer
  /// copied into a `_status` field; localized, they must come from
  /// `AppLocalizations`, which is an inherited lookup and therefore illegal in
  /// [initState]. So the timer now advances an INDEX only and [build] maps that
  /// index to a string — which is also the shape that survives the user
  /// changing locale mid-run, where a cached label would have frozen in the old
  /// language until the next tick.
  ///
  /// The count stays a constant beside the arm list in [_statusLabel]: those
  /// two must agree, and `_pct` is computed from it, so a sixth step added to
  /// one and not the other is a range error rather than a silent 83%.
  static const int _stepCount = 5;

  /// How many placeholder rows the loading skeleton draws.
  static const int _skeletonRows = 3;

  Timer? _timer;
  int _step = 0;
  int _pct = 0;

  /// 🔴 ABSENT IS NOT EMPTY — the defect `state/subscriptions_controller.dart`
  /// names in full at its `addSubscription` guard, on the one screen where it
  /// is a user-visible lie rather than a corrupted metric.
  ///
  /// This field used to be called `_done` and it was the WHOLE completion test:
  /// the timer flipped it after 560 ms × 6 = 3.36 s no matter what the fetch was
  /// doing, and the list underneath was read as `.value ?? const []`. So a
  /// fetch that was merely slow, and a fetch that had FAILED, both rendered the
  /// identical congratulation — "All set", "0 subscriptions", "£0.00 per month",
  /// and a live "Go to dashboard". A first-run user whose network dropped was
  /// told, in the app's warmest voice, that they own nothing.
  ///
  /// The timer stays, but demoted to what it was always actually good for: a
  /// MINIMUM DWELL. A fetch that returns in 40 ms would otherwise flash the bar
  /// through five captions in under a frame, which reads as a glitch rather than
  /// as setup. So the completion test is now the CONJUNCTION — this floor AND
  /// the `AsyncValue` having reached data. See [build]; the failure arm is
  /// [_failed].
  bool _minDwellElapsed = false;

  @override
  void initState() {
    super.initState();
    _startDwell();
  }

  /// (Re)starts the minimum-dwell animation from zero.
  ///
  /// Called again from the retry path so a second attempt gets the same
  /// evidence-of-progress the first one did — after a failure `_pct` is parked
  /// at 100 and the timer is cancelled, so without this reset a retry would sit
  /// on a full bar while nothing visibly changed.
  void _startDwell() {
    _timer?.cancel();
    _step = 0;
    _pct = 0;
    _minDwellElapsed = false;
    _timer = Timer.periodic(const Duration(milliseconds: 560), (Timer t) {
      if (_step < _stepCount) {
        setState(() {
          _pct = (((_step + 1) / _stepCount) * 100).round();
          _step++;
        });
      } else {
        t.cancel();
        setState(() => _minDwellElapsed = true);
      }
    });
  }

  /// Re-runs the fetch this screen is waiting on.
  ///
  /// `invalidate`, not a "check the network" probe: the only honest test of
  /// whether the repository can be read is the read the screen wanted to make,
  /// which is the same argument `_OfflineBanner` records in `app.dart`.
  void _retry() {
    setState(_startDwell);
    ref.invalidate(subscriptionsControllerProvider);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// The caption for the current tick.
  ///
  /// `_step` is the number of ticks that have HAPPENED, so index 0 is the
  /// pre-first-tick state (`scanStatusInitial`, on screen for the first 560 ms
  /// of every first run) and index n shows step n. The off-by-one is the same
  /// one the old code had implicitly, where the timer read `_steps[_step]` and
  /// then incremented.
  String _statusLabel(AppLocalizations l10n) {
    if (_step == 0) return l10n.scanStatusInitial;
    return <String>[
      l10n.scanStep1,
      l10n.scanStep2,
      l10n.scanStep3,
      l10n.scanStep4,
      l10n.scanStep5,
    ][_step - 1];
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final MoneyFormatter money = MoneyFormatter(l10n.localeName);
    final AsyncValue<List<Subscription>> subsAsync = ref.watch(
      subscriptionsControllerProvider,
    );

    // THE PHASES, AND THEY ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION.
    //
    // `hasValue && !hasError` rather than `hasValue` alone, for the reason
    // `subscriptions_controller.dart` records at its own use of this pair:
    // Riverpod KEEPS the previous data on an `AsyncError`, so a screen that
    // asked only `hasValue` would call a stale list behind a failed refresh a
    // successful load — which is this file's original bug wearing a different
    // hat.
    final bool failed = subsAsync.hasError;
    final bool ready = _minDwellElapsed && subsAsync.hasValue && !failed;

    return Scaffold(
      body: SafeArea(
        // `.reading` (720) and NOT the default 1280 cap. This is first-run flow
        // content, and its only sibling in that role — onboarding — is already
        // `ContentPane.reading` (`onboarding/onboarding_screen.dart`, asserted
        // at that cap by `test/width_onboarding_test.dart`). 720 binds at every
        // body width above it, including the 1323 px a 1440 window hands the
        // body beside the slim rail ([ADR 083]); `width_scan_test.dart` pins it.
        //
        // The inset is INSIDE the cap (`ContentPane` applies it within), so at
        // any width below 720 — every phone, every split pane — the content is
        // the window less the two gutters.
        //
        // ⚠️ THE COLUMN HAS AN `Expanded` CHILD AND THAT IS SAFE HERE. Flex
        // needs bounded height, and `content_pane.dart` warns that the pane's
        // `Align` SHRINK-WRAPS in an unbounded-height parent (a scroll view, a
        // sliver). This is not that: the pane sits directly in the `Scaffold`
        // body, which hands down a bounded height. Moving this pane inside a
        // `SingleChildScrollView` later would break the `Expanded`, not the cap.
        child: ContentPane.reading(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                ready ? l10n.scanDoneTitle : l10n.scanBusyTitle,
                style: text.headlineMedium?.copyWith(color: scheme.onSurface),
              ),
              // ⚠️ THE SUBTITLE IS DROPPED IN THE FAILURE ARM, and that is a
              // deletion rather than a substitution on purpose.
              // `scanBusySubtitle` is "This only takes a moment.", and printing
              // a reassurance directly above a failure is a false statement.
              // The failed state below says what happened.
              if (!failed) ...<Widget>[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  ready ? l10n.scanDoneSubtitle : l10n.scanBusySubtitle,
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.lg),
              Expanded(
                child: failed
                    ? _failed(l10n, subsAsync.error)
                    : ready
                    ? _results(context, l10n, money, subsAsync.requireValue)
                    : _loading(context, l10n),
              ),
              // THE ONE PRIMARY ACTION, in the two arms that have one:
              // disabled while the list loads, "Go to dashboard" once it has.
              // The failed arm hands the way out to [DataStateView.failed]'s
              // own retry rather than stacking a second button under it.
              if (!failed) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                FilledButton(
                  key: E2EKeys.scanPrimary,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(AppSpacing.xxxl),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppRadius.control),
                    ),
                  ),
                  onPressed: ready ? () => context.go('/home') : null,
                  child: Text(
                    ready ? l10n.goToDashboard : l10n.scanningEllipsis,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// LOADING: the progress, the step it is on, and the outline of the list.
  ///
  /// A `ListView`, so a large text scale on a short window scrolls rather
  /// than overflowing; it carries no control, so nothing here is hidden from
  /// the tap-target sweep by the implicit scrolling.
  Widget _loading(BuildContext context, AppLocalizations l10n) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        // 🔴 THE PROGRESS SPEAKS, AND IN A SENTENCE. First run parks the user
        // here with the primary action disabled, so this is the only thing on
        // the page that changes. The bar says nothing to a screen reader and a
        // bare "45%" says a number with no noun, so the pair is one node whose
        // label wraps the SAME `'$_pct%'` string that is painted.
        //
        // `container: true` so it is not glued to the step caption below,
        // which changes on the same tick.
        Semantics(
          container: true,
          label: l10n.a11yScanRing('$_pct%'),
          excludeSemantics: true,
          child: Row(
            children: <Widget>[
              Expanded(
                child: LinearProgressIndicator(
                  value: _pct / 100,
                  minHeight: AppSpacing.sm,
                  borderRadius: BorderRadius.circular(AppRadius.sm),
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Text(
                // `'$_pct%'` is interpolation, not a key: the only prose in it
                // is the percent sign, and a locale that writes percent
                // differently is a NumberFormat question rather than an arb
                // one. Recorded as such in the work order (§1, [FP]).
                '$_pct%',
                style: text.titleMedium?.copyWith(
                  color: scheme.onSurface,
                  fontFeatures: const <FontFeature>[
                    FontFeature.tabularFigures(),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(
          _statusLabel(l10n),
          style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
        ),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          padding: EdgeInsets.zero,
          child: SkeletonList(label: l10n.scanStep2, rows: _skeletonRows),
        ),
      ],
    );
  }

  /// FAILED or OFFLINE — a fetch that did not come back, said so, with the
  /// way out on the state itself.
  ///
  /// The words are the app's data-state title and the shared gate's sentence
  /// for WHAT failed ([dataFailedBodyFor], ST-U6 D21): "Check your connection
  /// and try again." only when the failure WAS the connection. It used to be
  /// `couldNotLoad('$e')`, which printed the raw exception at a first-run user.
  Widget _failed(AppLocalizations l10n, Object? error) {
    return DataStateView.failed(
      title: l10n.dataFailedTitle,
      body: dataFailedBodyFor(l10n, error),
      retryLabel: l10n.retry,
      onRetry: _retry,
    );
  }

  Widget _results(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
  ) {
    // EMPTY is a success with nothing in it — never the failure above, and
    // never a summary congratulating the user on owning nothing. No retry:
    // see [DataStateView.empty]. ✅ ST-U6 (B3): the first step is ON the empty
    // state — "Add subscription".
    if (subs.isEmpty) {
      return DataStateView.empty(
        title: l10n.dataEmptyTitle,
        body: l10n.dataEmptyBody,
        actionLabel: l10n.addSubscriptionTitle,
        onAction: () => showAddSubscriptionSheet(context),
      );
    }
    final MoneyBag total = SubMath.totalMonthly(subs);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    const List<FontFeature> tabular = <FontFeature>[
      FontFeature.tabularFigures(),
    ];
    return ListView(
      padding: EdgeInsets.zero,
      children: <Widget>[
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                l10n.scanResultsHeading,
                style: text.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              // 🔴 A PLURAL KEY, and it fixes a shipped bug rather than only
              // translating one: the live line was `'${subs.length}
              // subscriptions'`, which reads "1 subscriptions" for a user with
              // a single plan — the exact user this first-run screen is most
              // likely to be showing.
              Text(
                l10n.subscriptionCount(subs.length),
                style: text.headlineMedium?.copyWith(
                  color: scheme.onSurface,
                  fontFeatures: tabular,
                ),
              ),
              Text(
                l10n.perMonthTotal(money.formatBag(total)),
                style: text.titleMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                  fontFeatures: tabular,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < subs.length; i++) ...<Widget>[
                if (i > 0) const Divider(height: 1),
                // `name` and `category` are DATA, not copy — they come from
                // the user's own records (or the demo seed). The figure is the
                // charge with its own cycle; the summary above carries the
                // per-month total.
                AppListRow(
                  leading: GlyphTile(
                    glyph: subs[i].glyph,
                    size: AppListRow.leadingSize,
                    fontSize: AppTypeRamp.minimumSize,
                  ),
                  title: subs[i].name,
                  subtitle: subs[i].category,
                  figure: money.format(subs[i].price),
                  caption: subs[i].cycle == BillingCycle.yearly
                      ? l10n.perYear
                      : l10n.perMonth,
                  // B49: a result row opens the subscription it names.
                  onTap: () => context.push('/sub/${subs[i].id}'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
