import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ContentPane;

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/painters.dart';
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
/// ⬜ ONE CLAIM SURVIVES AND IT IS NOT IN THIS FILE'S GIFT: the busy CTA reads
/// `scanningEllipsis` = "Scanning…" (`app_en.arb:911`), which is the last
/// string on the surface that asserts a scan. Fixing it is an arb edit plus
/// `test/dark_group_detail_test.dart:620`, which asserts that exact key renders
/// in the busy phase — neither file is owned here, so it is reported rather
/// than half-done.
///
/// 🔴 THE BRIGHTNESS RULE FOR THIS FILE is the one stated in full on
/// [SubscriptionDetailScreen]: LIGHT keeps the literal token, byte-identical to
/// the pre-dark screen; only the dark arm derives from the scheme. Here that
/// touches the two ink/muted text colours and the progress track. The Scaffold
/// drops its `AppColors.bg` override and inherits
/// `theme.scaffoldBackgroundColor` — 0xFFF4F4F8 is a near-white, which on a
/// dark theme painted this entire first-run screen light. The results hero's
/// `AppColors.brandGradient` and the whites on it do NOT fork: a saturated
/// indigo→violet gradient is its own surface in either brightness, exactly as
/// the detail hero is. `AppColors.accent` on the ring and the meter is the same
/// case — a brand hue, legible on both, and swapping it for `scheme.primary`
/// would move the LIGHT build (see the theme-fork note in `app.dart`: the
/// seeded scheme's primary is no longer #6459F5 exactly).
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

  Timer? _timer;
  int _step = 0;
  int _pct = 0;

  /// 🔴 ABSENT IS NOT EMPTY — the defect `state/subscriptions_controller.dart`
  /// names in full at its `addSubscription` guard, on the one screen where it
  /// is a user-visible lie rather than a corrupted metric.
  ///
  /// This field used to be called `_done` and it was the WHOLE completion test:
  /// the timer flipped it after 560 ms × 6 = 3.36 s no matter what the fetch was
  /// doing, and the list underneath was read as `.valueOrNull ?? const []`. So a
  /// fetch that was merely slow, and a fetch that had FAILED, both rendered the
  /// identical congratulation — "All set", "0 subscriptions", "£0.00 per month",
  /// and a live "Go to dashboard". A first-run user whose network dropped was
  /// told, in the app's warmest voice, that they own nothing.
  ///
  /// The timer stays, but demoted to what it was always actually good for: a
  /// MINIMUM DWELL. A fetch that returns in 40 ms would otherwise flash the ring
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
  /// on a full ring and a full bar while nothing visibly changed.
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
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    final currency = ref.watch(currencyProvider);
    final AsyncValue<List<Subscription>> subsAsync = ref.watch(
      subscriptionsControllerProvider,
    );

    // THE THREE PHASES, AND THEY ARE MUTUALLY EXCLUSIVE BY CONSTRUCTION.
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
        // at that cap by `test/width_onboarding_test.dart`). Left uncapped at
        // 1280 the results gradient hero is a wall-to-wall banner, and the
        // default `kMaxBodyWidth` would still hand it 1246 px of one; 720 keeps
        // the first thing a new user ever sees proportionate to what it says.
        //
        // ⚠️ THAT PRECEDENT USED TO BE THINNER THAN IT LOOKED, and the note is
        // kept because the shape recurs. Subly carried TWO `OnboardingScreen`
        // classes with the same name: an unrouted `firstrun/` twin that HAD the
        // pane and was the one `responsive_width_test.dart` measured, and the
        // routed `onboarding/` screen that had NO pane and is what
        // `router.dart` actually builds for `/onboarding`. So the cap was
        // asserted on the twin the user never reaches. Fixed 2026-08-09: the
        // routed screen got the pane, the twin was deleted from this app, and
        // the measurement moved with the routing. `/scan` below was always on
        // the live path — `router.dart` builds THIS file — so the width test
        // for this screen has always measured the screen that ships.
        //
        // ✅ RE-MEASURED 2026-08-21, because a work order arrived asserting this
        // screen was still handed the 1280 default and asking for a cap in the
        // 840-960 band. It is not, and it does not need one. `AppBreakpoints
        // .reading` is 720 (pinned by `width_scan_test.dart`'s third case), and
        // 720 binds at EVERY body width above it — including the whole 839-1280
        // band that work order named, and including the 1079 an `AppScaffold`
        // hands the body at a 1440 window. A cap in the 840-960 band would be a
        // LOOSENING of this screen's, not a fix, and it would part this screen
        // from onboarding, its only sibling in the first-run role. 720 stands.
        //
        // The `Padding(24)` this replaces moved INTO the pane, which is the
        // same box it always was: `ContentPane` applies its inset INSIDE the
        // cap (`content_pane.dart:43-46`), so at any width below 720 — every
        // phone, every split pane — this renders pixel-identical to before.
        //
        // ⚠️ THE COLUMN HAS AN `Expanded` CHILD AND THAT IS SAFE HERE. Flex
        // needs bounded height, and `content_pane.dart:52-54` warns that the
        // pane's `Align` SHRINK-WRAPS in an unbounded-height parent (a scroll
        // view, a sliver). This is not that: the pane sits directly in the
        // `Scaffold` body, which hands down a bounded height, so the `Align`
        // passes it on and the flex resolves. Moving this pane inside a
        // `SingleChildScrollView` later would break the `Expanded`, not the cap.
        child: ContentPane.reading(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                ready ? l10n.scanDoneTitle : l10n.scanBusyTitle,
                style: AppText.title.copyWith(
                  fontSize: 28,
                  color: isLight ? AppColors.ink : scheme.onSurface,
                ),
              ),
              const SizedBox(height: 6),
              // ⚠️ THE SUBTITLE IS DROPPED IN THE FAILURE ARM, and that is a
              // deletion rather than a substitution on purpose. `scanBusyTitle`
              // ("Setting up your board") stays true after a failed fetch —
              // setting up is exactly what was attempted — but
              // `scanBusySubtitle` is "This only takes a moment.", and printing
              // a reassurance directly above "Could not load: …" is the same
              // class of false statement this whole change removes, one line
              // smaller. No replacement string is invented here: there is no
              // error-subtitle key in `app_en.arb`, and inventing English copy
              // in Dart on a fully localised screen would ship an untranslated
              // sentence to every non-English user. The failure arm below says
              // what happened.
              if (!failed)
                Text(
                  ready ? l10n.scanDoneSubtitle : l10n.scanBusySubtitle,
                  style: AppText.muted.copyWith(
                    fontSize: 14,
                    color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
                  ),
                ),
              const SizedBox(height: 8),
              Expanded(
                child: failed
                    ? _failed(context, l10n, subsAsync.error)
                    : ready
                    ? _results(context, l10n, currency, subsAsync.requireValue)
                    : _scanning(context, l10n),
              ),
              const SizedBox(height: 12),
              // THE ONE PRIMARY ACTION SLOT SERVES ALL THREE PHASES, so the
              // failure arm does not stack a second full-width button under the
              // one that is already here. Disabled while loading — that is the
              // state `GradientButton` documents `enabled:` for — and the retry
              // reuses `l10n.retry`, the key `_OfflineBanner` already uses, so
              // this adds no copy and nothing to translate.
              GradientButton(
                label: failed
                    ? l10n.retry
                    : ready
                    ? l10n.goToDashboard
                    : l10n.scanningEllipsis,
                onPressed: failed
                    ? _retry
                    : ready
                    ? () => context.go('/home')
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _scanning(BuildContext context, AppLocalizations l10n) {
    // Center, not just Column(mainAxisAlignment: center). The PARENT column uses
    // CrossAxisAlignment.start, so this child is never stretched - it shrink-wrapped
    // to the 158px ring and sat hard against the left edge. mainAxisAlignment only
    // centred it vertically, which is why it looked half-right: centred down the
    // page, pinned to the left across it. Center() takes the full available width.
    //
    // THE PANE DID NOT REPLACE THIS, and that is deliberate. `ContentPane`
    // aligns to topCenter precisely because a PAGE must not re-centre as its
    // height changes — but `content_pane.dart:36-41` reserves explicit
    // vertical centring for the one shape that should sit in the middle of an
    // otherwise dead screen, and a short blocking progress state is that shape.
    // The pane caps the width; this Center places it down the page. Folding one
    // into the other would re-make the half-right layout described above.
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          SizedBox(
            width: 158,
            height: 158,
            // 🔴 A `CustomPaint` AGAIN, AND THIS ONE GATES THE APP. First run
            // parks the user on this screen for the length of the scan with the
            // CTA disabled ("Scanning…", `onPressed: null`), so the ring is the
            // only thing on the page that changes and the only evidence that
            // anything is happening. Its arc says nothing to a screen reader,
            // and the bare "45%" in the middle says a number with no noun.
            //
            // The label wraps that same figure in a sentence. `'$_pct%'` is
            // passed through verbatim rather than re-derived so the spoken
            // percentage and the painted one are literally the same string —
            // see the comment below on why the figure is an interpolation.
            //
            // `container: true` for the reason `insights_screen.dart` records
            // against its donut — and it matters more here, because the thing
            // this would otherwise be glued to is the status caption that
            // changes on the same tick.
            child: Semantics(
              container: true,
              label: l10n.a11yScanRing('$_pct%'),
              excludeSemantics: true,
              child: CustomPaint(
                painter: RingPainter(
                  progress: _pct / 100,
                  // Brand hue, unforked — see the class doc.
                  color: AppColors.accent,
                  stroke: 14,
                ),
                child: Center(
                  child: Text(
                    // `'$_pct%'` is interpolation, not a key: the only prose in
                    // it is the percent sign, and a locale that writes percent
                    // differently is a NumberFormat question rather than an arb
                    // one. Recorded as such in the work order (§1, [FP]).
                    '$_pct%',
                    style: AppText.fig.copyWith(
                      fontSize: 34,
                      color: isLight ? AppColors.ink : scheme.onSurface,
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 28),
          SizedBox(
            width: 200,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: _pct / 100,
                minHeight: 6,
                // The TRACK is a light neutral (0xFFECECF2); unbranched it is
                // a near-white bar on a dark first-run screen.
                backgroundColor: isLight
                    ? AppColors.line
                    : scheme.outlineVariant,
                color: AppColors.accent,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            _statusLabel(l10n),
            style: AppText.muted.copyWith(
              fontWeight: FontWeight.w600,
              color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  /// The arm the screen never had — a fetch that FAILED, said so.
  ///
  /// Mirrors `home_screen.dart`'s `error:` limb deliberately, down to the key:
  /// `l10n.couldNotLoad('$e')`. That key interpolates the raw exception, which
  /// that file flags as a real defect (WORKORDER §1) and deliberately does not
  /// paper over inside an l10n increment — the same reasoning applies here, and
  /// diverging would leave the app with two different answers to one question.
  /// When the leak is fixed it must be fixed in the key, once.
  ///
  /// The way OUT is the screen's existing primary CTA rather than a control
  /// invented here; see the `GradientButton` in [build].
  Widget _failed(BuildContext context, AppLocalizations l10n, Object? error) {
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    // Vertically centred for the same reason [_scanning] is, and stated there
    // in full: this is the blocking phase of a first-run screen, the one shape
    // `content_pane.dart:36-41` reserves vertical centring for.
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // No `semanticLabel`: an unlabelled `Icon` is silent, which is right
          // here — the sentence below already carries the whole message, and
          // announcing a decorative glyph beside it is the stutter `GlyphTile`
          // records.
          Icon(Icons.error_outline, size: 48, color: scheme.error),
          const SizedBox(height: 16),
          Text(
            l10n.couldNotLoad('$error'),
            textAlign: TextAlign.center,
            style: AppText.muted.copyWith(
              fontSize: 14,
              // `AppText.muted` bare paints `AppColors.ink`-family literals, so
              // it forks by brightness exactly like the two lines in [build].
              color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  Widget _results(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    List<Subscription> subs,
  ) {
    final double total = SubMath.totalMonthly(subs);
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Container(
          margin: const EdgeInsets.symmetric(vertical: 16),
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: AppColors.brandGradient,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              // The three whites below are ON `AppColors.brandGradient` — a
              // saturated indigo→violet, its own surface in either brightness.
              // They do not fork; see the class doc.
              //
              // 🔴 BUT THE ALPHA IS NOT FREE, AND THIS ONE WAS THE DEFECT.
              // At `0.85` the glyphs blend to ~#EAE6FE against the gradient's
              // #6C57F7 here, which measured **3.97:1** — under SC 1.4.3's 4.5:1
              // for this 11px label, and the only reason `every string on scan
              // (results)` was red. Opaque white is **4.90:1** at the accent end
              // and 4.51:1 at the #8950FF end, so it clears AA across the whole
              // sweep. The de-emphasis this alpha bought is not worth a string
              // that fails the bar the Definition of Done publishes; the size and
              // tracking of `AppText.label` already carry the hierarchy.
              // 📌 The sibling at `:346` is `0.92` on 15px w700 and MEASURED
              // passing — it is left alone deliberately, not overlooked.
              Text(
                l10n.scanResultsHeading,
                style: AppText.label.copyWith(color: Colors.white),
              ),
              const SizedBox(height: 4),
              // 🔴 A PLURAL KEY, and it fixes a shipped bug rather than only
              // translating one: the live line was `'${subs.length}
              // subscriptions'`, which reads "1 subscriptions" for a user with
              // a single plan — the exact user this first-run screen is most
              // likely to be showing.
              Text(
                l10n.subscriptionCount(subs.length),
                style: AppText.fig.copyWith(fontSize: 34, color: Colors.white),
              ),
              Text(
                l10n.perMonthTotal(currency.fmt(total)),
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                  color: Color.fromRGBO(255, 255, 255, 0.92),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.separated(
            itemCount: subs.length,
            // `(_, _)`, not `(_, __)`: the wildcard pattern, which the analyzer
            // flags as `unnecessary_underscores` in the old spelling. Pre-dates
            // this change and is fixed here only because a file this task must
            // leave analyzing CLEAN cannot carry it. Same spelling as
            // `subscriptions_controller.dart`'s `ref.listen(…, (_, _) {`.
            separatorBuilder: (_, _) => const SizedBox(height: 9),
            itemBuilder: (BuildContext context, int i) {
              final Subscription s = subs[i];
              return RowCard(
                padding: 11,
                leading: GlyphTile(glyph: s.glyph, size: 38, fontSize: 11),
                // `s.name` and `s.category` are DATA, not copy — they come
                // from the user's own records (or the demo seed). Nothing here
                // is an arb key.
                title: s.name,
                subtitle: Text(
                  s.category,
                  style: AppText.muted.copyWith(
                    fontSize: 12,
                    color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
                  ),
                ),
                trailing: Text(
                  currency.fmt(s.monthlyPrice),
                  style: AppText.fig.copyWith(
                    fontSize: 15,
                    color: isLight ? AppColors.ink : scheme.onSurface,
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
