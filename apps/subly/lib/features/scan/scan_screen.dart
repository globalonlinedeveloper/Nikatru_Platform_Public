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
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(milliseconds: 560), (Timer t) {
      if (_step < _stepCount) {
        setState(() {
          _pct = (((_step + 1) / _stepCount) * 100).round();
          _step++;
        });
      } else {
        t.cancel();
        setState(() => _done = true);
      }
    });
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
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final double total = SubMath.totalMonthly(subs);

    return Scaffold(
      body: SafeArea(
        // `.reading` (720) and NOT the default 1280 cap. This is first-run flow
        // content, and its only sibling in that role — onboarding — is already
        // `ContentPane.reading` (`firstrun/onboarding_screen.dart`, asserted at
        // that cap by `test/responsive_width_test.dart`). Left uncapped at 1280
        // the results gradient hero is a wall-to-wall banner, and the default
        // `kMaxBodyWidth` would still hand it 1246 px of one; 720 keeps the
        // first thing a new user ever sees proportionate to what it says.
        //
        // ⚠️ THAT PRECEDENT IS THINNER THAN IT LOOKS, so it is not the whole
        // argument. There are TWO `OnboardingScreen` classes with the same
        // name: `firstrun/onboarding_screen.dart` (has the pane, and is what
        // `responsive_width_test.dart` imports and measures) and
        // `onboarding/onboarding_screen.dart` (has NO pane, and is the one
        // `router.dart:45` actually builds for `/onboarding`). The cap is
        // asserted on the twin the user never reaches. `/scan` below is on the
        // live path — `router.dart:143` builds THIS file — so the width test
        // for this screen measures the screen that ships.
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
                _done ? l10n.scanDoneTitle : l10n.scanBusyTitle,
                style: AppText.title.copyWith(
                  fontSize: 28,
                  color: isLight ? AppColors.ink : scheme.onSurface,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                _done ? l10n.scanDoneSubtitle : l10n.scanBusySubtitle,
                style: AppText.muted.copyWith(
                  fontSize: 14,
                  color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: _done
                    ? _results(context, l10n, currency, subs, total)
                    : _scanning(context, l10n),
              ),
              const SizedBox(height: 12),
              GradientButton(
                label: _done ? l10n.goToDashboard : l10n.scanningEllipsis,
                onPressed: _done ? () => context.go('/home') : null,
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

  Widget _results(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    List<Subscription> subs,
    double total,
  ) {
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
              Text(
                l10n.scanResultsHeading,
                style: AppText.label.copyWith(
                  color: const Color.fromRGBO(255, 255, 255, 0.85),
                ),
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
            separatorBuilder: (_, __) => const SizedBox(height: 9),
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
