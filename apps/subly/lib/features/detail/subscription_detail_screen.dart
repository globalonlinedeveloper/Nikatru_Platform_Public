import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/currency.dart';
import '../../data/models/payment_record.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../cancel/cancel_sheet.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

/// 🔴 THE BRIGHTNESS RULE FOR THIS FILE, stated once so the three sites below
/// do not each have to argue it. `apps/subly` is the frozen legacy rail-prover
/// the owner eyeballs, so LIGHT MUST NOT MOVE — every fork here keeps the
/// literal token on its light arm, byte-identical to the pre-dark screen, and
/// derives only the dark arm from the scheme. That is the same shape
/// `cardDecoration` and `RowCard` already took (W0/P4·L1), and
/// `test/dark_group_detail_test.dart` pins BOTH arms: the light half against
/// the literal (so "tidying" it to a scheme slot goes red rather than
/// repainting the app) and the dark half against the scheme (the falsifier).
///
/// Three categories do NOT fork, each for its own reason:
///   · THE SCAFFOLDS lose their `AppColors.bg` override outright and inherit
///     `theme.scaffoldBackgroundColor`. 0xFFF4F4F8 is a near-white, so on a
///     dark theme it was the whole page painted light under dark chrome — the
///     single worst pixel on this route. It is the one place where light does
///     move, and that is deliberate rather than incidental: `buildAppTheme`
///     already sets the scaffold to `scheme.surface` for every screen that does
///     not override it, so this route was the one painting a colour of its own.
///   · STATUS COLOURS (warn / positive / danger) stay literal in BOTH
///     brightnesses, because `AppThemeX.fromScheme` keeps them literal too and
///     says why: green means good and red means danger in every app, and
///     re-hueing them from a brand seed trades a universal signal for a
///     decoration.
///   · THE ON-GRADIENT WHITES stay white. `AppColors.heroGradient` is
///     heroA/B/C — three DARK indigos — in both brightnesses, so the hero is
///     its own dark surface whatever the rest of the page is doing. White is
///     the correct ink on it in light mode and still the correct ink on it in
///     dark mode; forking them would break the light build to fix nothing.
class SubscriptionDetailScreen extends ConsumerWidget {
  const SubscriptionDetailScreen({super.key, required this.id, this.onClose});
  final String id;

  /// How this screen goes away — supplied by whoever put it on screen.
  ///
  /// 🔴 THIS SCREEN IS MOUNTED TWO WAYS AND ONLY ONE OF THEM COULD BE POPPED.
  /// GlitchTip SUBLY-9 / SUBLY-A (FATAL, 4+1 events, 2026-08-21 14:11–14:12Z,
  /// release `subly@1.0.220+350bd7f`): `GoError: There is nothing to pop`,
  /// thrown while handling a gesture, with the browser hash reading `#/home`
  /// and a 1920-wide landscape window.
  ///
  ///   · AS A ROUTE — `/sub/:id`, `context.push`ed from home (single-column
  ///     arm) and from calendar. There is something under it, so `pop` works.
  ///   · AS A PANE — `home_screen.dart` hands this widget straight to
  ///     `TwoPane.detail` once the body can split. NOTHING WAS PUSHED. The
  ///     location is still `/home`, whose stack is one match deep, and every
  ///     dismiss control on this screen called `context.pop()` unconditionally
  ///     — so on any window wide enough to show the two-pane layout, the back
  ///     arrow and "Edit plan" threw instead of doing anything. Four events in
  ///     39 seconds is one user pressing back and trying again.
  ///
  /// Null means the route case, which [_dismiss] still guards — see there.
  final VoidCallback? onClose;

  /// The one way off this screen, for all three controls.
  ///
  /// 🔴 IT IS A METHOD AND NOT THREE CALL SITES ON PURPOSE. The defect above
  /// was three independent `context.pop()`s that each looked correct in
  /// isolation; the property "this screen knows how it was mounted" has to live
  /// in one place or the next control added here reintroduces it.
  ///
  /// The `canPop` arm is NOT dead code for the route case, and that is the
  /// second, quieter half of the same bug. Web is on the HASH strategy (see
  /// `reset_password_screen.dart`), so `…/#/sub/abc` is a real, bookmarkable,
  /// reloadable URL — and a reload restores that location with a ONE-ENTRY
  /// stack. The back arrow of a freshly-loaded detail page therefore has
  /// nothing under it either. `/home` is where `/` redirects, so it is the
  /// same destination the browser's own back button would have reached.
  void _dismiss(BuildContext context) {
    final VoidCallback? close = onClose;
    if (close != null) {
      close();
      return;
    }
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go('/home');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    final Color ink = isLight ? AppColors.ink : scheme.onSurface;
    final Color muted = isLight ? AppColors.muted : scheme.onSurfaceVariant;
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    Subscription? sub;
    for (final Subscription s in subs) {
      if (s.id == id) {
        sub = s;
        break;
      }
    }
    if (sub == null) {
      // The NOT-FOUND branch stays exactly what it was — a bare Scaffold with
      // an empty AppBar and a centred line — because the route resolved and
      // only the record is missing. (`subscriptionNotFound`, deliberately NOT
      // the chassis `notFoundTitle`, which is the router's "page not found".)
      return Scaffold(
        appBar: AppBar(elevation: 0),
        body: Center(child: Text(l10n.subscriptionNotFound)),
      );
    }
    final Subscription s = sub;
    // `brightness:` is what ACTIVATES the light arm of the urgent-branch fork
    // in due.dart. Without it the call takes the dark-safe default and paints
    // AppColors.warn #F59E0B as small bold text on the white card — 2.15:1,
    // against a 4.5 bar. The fork landed before these three call sites did, so
    // a11y_semantics_test.dart carried a named exemption citing this exact line;
    // passing brightness is what expires it.
    final DueInfo due = DueInfo.localized(
      l10n,
      s,
      DateTime.now(),
      brightness: Theme.of(context).brightness,
    );

    return Scaffold(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // 🔴 THE SPLIT: the gradient stays FULL-BLEED, its CONTENT is capped.
          //
          // Capping the gradient itself would leave a 1280 px painted block
          // floating in the middle of the page background on a wide display —
          // a hero that reads as a mis-sized image rather than a header. So the
          // `Container` keeps taking the whole surface (the enclosing `Column`
          // is `stretch`), and a `ContentPane` INSIDE it caps the back button,
          // the glyph tile and the title at the same `AppBreakpoints.reading`
          // the body `ListView` below uses.
          //
          // ⚠️ THAT SENTENCE SAID `kMaxBodyWidth` UNTIL 2026-08-21 AND WAS
          // CORRECTED, NOT DELETED — the two panes must agree, and what they
          // agree ON moved when the body cap did (see the body pane's note).
          // The pairing is the load-bearing half: an edit that re-caps one pane
          // and not the other misaligns the title against the mini-cards, and
          // `test/width_detail_test.dart` pins both numbers for that reason.
          //
          // ⚠️ THE 18/18 INSET IS INSIDE THE CAP, not outside it, and that is
          // the whole point of the pane split. `ContentPane` applies `padding`
          // within `maxWidth`, exactly as the `ListView` below applies its own
          // padding within the pane — so at 1920 both content boxes start at
          // the same x and the title lines up with the mini-cards. Hoisting
          // this `Padding` outside the pane would shift the header 18 px left
          // of the body and nothing would go red.
          //
          // ⚠️ AND THE GRADIENT IS THE SAME IN BOTH BRIGHTNESSES, ON PURPOSE.
          // `AppColors.heroGradient` is heroA/B/C — 0xFF1B1930, 0xFF2A2456,
          // 0xFF3A2F6E — three dark indigos. The hero is therefore already a
          // DARK surface on a light page, which is why every colour inside it
          // below is a white or a white alpha and why none of them forks on
          // brightness: they are correct ink on this gradient either way.
          // Deriving the gradient from `AppThemeX.heroGradient` instead would
          // repaint the header of the light build (its light arm is the
          // container ramp, not these indigos) to fix a defect that does not
          // exist here.
          Container(
            key: const Key('detail-hero-gradient'),
            decoration: const BoxDecoration(gradient: AppColors.heroGradient),
            child: SafeArea(
              bottom: false,
              child: ContentPane.reading(
                key: const Key('detail-header-pane'),
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: <Widget>[
                        _iconButton(
                          Icons.arrow_back,
                          l10n.back,
                          () => _dismiss(context),
                        ),
                        // The `more_horiz` control is still a STUB — it opens
                        // nothing. Its label is localized anyway because a
                        // screen reader announces it today regardless of what
                        // the tap does.
                        _iconButton(Icons.more_horiz, l10n.moreOptions, () {}),
                      ],
                    ),
                    const SizedBox(height: 14),
                    // ⚠️ DECORATIVE, and the rule is [GlyphTile]'s — read that
                    // class doc; this hero square is the same mark hand-rolled
                    // at 56 px because it sits on the gradient rather than on a
                    // card. `s.glyph` is a two-letter abbreviation of `s.name`,
                    // and `s.name` is the 30 pt title twelve pixels below it, so
                    // announcing both makes every detail screen open with "SP,
                    // Spotify". The tile is not a control and carries nothing
                    // the title does not.
                    ExcludeSemantics(
                      child: Container(
                        width: 56,
                        height: 56,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          color: const Color.fromRGBO(255, 255, 255, 0.14),
                          border: Border.all(
                            color: const Color.fromRGBO(255, 255, 255, 0.2),
                          ),
                        ),
                        child: Text(
                          s.glyph,
                          style: const TextStyle(
                            fontFamily: 'Space Grotesk',
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      s.name,
                      style: AppText.title.copyWith(
                        fontSize: 30,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      '${s.category} · ${s.plan}',
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                        color: Color.fromRGBO(255, 255, 255, 0.82),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // 🔴 `AppBreakpoints.reading` (720), NOT THE DEFAULT `kMaxBodyWidth`
          // (1280) THIS PANE CARRIED UNTIL 2026-08-21. The default never bound
          // on any real desktop: `AppScaffold` hands its body
          // `min(W - 361, 1280)` because a 360 px drawer and a 1 px divider
          // take the width first, so at a 1440 px window the body is 1079 and a
          // 1280 cap is arithmetic that never fires. The screen was therefore a
          // phone column that simply got wider — a two-up mini-card row, a
          // meter and a payment list stretched to 1079, which is the "looks
          // stretched" report this change answers.
          //
          // WHY 720 AND NOT AN 840–960 ROW-LIST NUMBER. Both would bind, and a
          // number that binds is the minimum bar, not the decision. 720 is
          // `AppBreakpoints.reading` — a constant this design system already
          // owns and already justifies for a stack of cards inside a page that
          // is legitimately wide. Inventing 900 here would put a seventh
          // uncommented literal in a repo whose `ContentPane` doc exists
          // because six copies of a width used to drift apart with nothing red
          // to say so. The body is a CARD STACK (two mini-cards, a meter card,
          // a run of payment rows), which is exactly the shape `reading` names.
          //
          // `.pane` (480) was considered and rejected, and that reasoning still
          // stands: this is a full route pushed over the shell, not a side
          // panel, and 480 would make it dramatically narrower than the screen
          // that pushed it. 720 sits between the two and is the one that is a
          // named constant rather than a taste.
          //
          // The `ListView` keeps its OWN padding rather than handing it to the
          // pane: a scroll view's padding scrolls with the content and supplies
          // the bottom run-off, and moving it out would clip rows at the inset
          // edge instead.
          Expanded(
            child: ContentPane.reading(
              key: const Key('detail-body-pane'),
              child: ListView(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
                children: <Widget>[
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: _miniCard(
                          context,
                          l10n.fieldLabelPrice,
                          currency.fmt(s.price),
                          s.cycle == BillingCycle.yearly
                              ? l10n.perYear
                              : l10n.perMonth,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _miniCard(
                          context,
                          l10n.nextChargeLabel,
                          // Was `'${_shortMon(month)} ${day}'` off a hardcoded
                          // English abbreviation table. `MMMd` is the same
                          // shape in English and the correct one everywhere
                          // else — Tamil does not put the month first.
                          DateFormat.MMMd(
                            l10n.localeName,
                          ).format(s.nextRenewal),
                          due.label,
                          valueSub: due.color,
                        ),
                      ),
                    ],
                  ),
                  // 🔴 THE USAGE CARD IS GATED ON USAGE DATA EXISTING.
                  // `unused` and `usedPct` are never collected: the add sheet
                  // builds every draft without them and the API never writes
                  // them back, so `unused` is always false and `usedPct` always
                  // 0. Ungated, this card told every real user their
                  // subscription was "Active" — with a 0% meter underneath it
                  // — which is an assertion about behaviour the app has never
                  // observed. Home carried the mirror image of the same defect
                  // (everything permanently "Occasional") and was gated in the
                  // same pass.
                  //
                  // Gated, not deleted: the moment anything writes usage the
                  // card is correct as written. Inventing a signal to fill it
                  // is the repair that would actually be wrong.
                  if (s.unused || s.usedPct > 0) ...<Widget>[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: cardDecoration(context, radius: 18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: <Widget>[
                              // 🔴 `Flexible`, ADDED BY THE l10n INCREMENT AND
                              // NOT BY TASTE. Two translated labels in one
                              // `spaceBetween` Row is the classic l10n overflow
                              // shape: English "Usage this month" + "Active" fits
                              // a 352 px card, Tamil "இந்த மாதப் பயன்பாடு" +
                              // "அரிதாகப் பயன்படுத்தப்படுகிறது" does not, and an
                              // inflexible Row answers that with a yellow-and-
                              // black overflow stripe.
                              //
                              // `Flexible` and NOT `Expanded`, and only on the
                              // LEADING child: loose fit means it takes its
                              // intrinsic width whenever that fits, so the
                              // English build lays out byte-identically and
                              // `spaceBetween` still distributes the same free
                              // space. Making BOTH children flexible would give
                              // each half the row and wrap the English label too.
                              Flexible(
                                child: Text(
                                  l10n.usageThisMonth,
                                  style: AppText.body.copyWith(
                                    fontWeight: FontWeight.w700,
                                    fontSize: 14,
                                    color: ink,
                                  ),
                                ),
                              ),
                              // The status colours do NOT fork — see the class
                              // doc. `AppThemeX.fromScheme` keeps warn/positive
                              // literal in both brightnesses too.
                              Text(
                                s.unused
                                    ? l10n.usageRarelyUsed
                                    : l10n.usageActive,
                                style: TextStyle(
                                  fontFamily: 'Manrope',
                                  fontWeight: FontWeight.w700,
                                  fontSize: 12,
                                  color: s.unused
                                      ? AppColors.warn
                                      : AppColors.positive,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: LinearProgressIndicator(
                              value: s.usedPct / 100,
                              minHeight: 8,
                              // The TRACK is a light neutral (0xFFECECF2) and
                              // therefore forks: unbranched it is a near-white
                              // bar across a dark card, brighter than the meter
                              // it is the background of.
                              backgroundColor: isLight
                                  ? AppColors.line
                                  : scheme.outlineVariant,
                              color: s.unused
                                  ? AppColors.warn
                                  : AppColors.positive,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            s.usageNote,
                            style: AppText.muted.copyWith(
                              fontSize: 12,
                              color: muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  Padding(
                    padding: const EdgeInsets.fromLTRB(2, 18, 2, 10),
                    child: Text(
                      l10n.paymentHistory,
                      style: TextStyle(
                        fontFamily: 'Space Grotesk',
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                        color: ink,
                      ),
                    ),
                  ),
                  _history(ref, currency, s.id),
                  const SizedBox(height: 20),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: SoftButton(
                          label: l10n.editPlan,
                          onPressed: () => _dismiss(context),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: SizedBox(
                          height: 50,
                          child: FilledButton(
                            onPressed: () async {
                              await showCancelSheet(context, s);
                              // `context.mounted` answers "is this element
                              // still in the tree", NEVER "can the router
                              // pop" — the two came apart in the pane case,
                              // where the element is alive and the stack is
                              // one deep. Both checks are needed, in this
                              // order: the guard inside [_dismiss] cannot run
                              // at all on a context torn down across the await.
                              if (context.mounted) _dismiss(context);
                            },
                            style: FilledButton.styleFrom(
                              backgroundColor: AppColors.danger,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(16),
                              ),
                            ),
                            // `cancelPlanButton`, NOT the chassis `cancelPlan`
                            // ("Cancel subscription") — work order §8 decision
                            // 1. Its VALUE is byte-identical to the literal it
                            // replaces, which is what keeps
                            // `integration_test/app_test.dart:476/:481`
                            // (`find.text('Cancel plan')`) green with no edit.
                            child: Text(
                              l10n.cancelPlanButton,
                              style: const TextStyle(
                                fontFamily: 'Manrope',
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// 🔴 THE `FutureBuilder` STAYS, AND SO DOES `ref.read` INSIDE IT. It is
  /// re-fired on every rebuild of the screen, which is a known cost recorded
  /// against this file and deliberately NOT fixed here: converting it to a
  /// provider is a state-layer change, and this increment is l10n + brightness.
  /// Folding an unrelated refactor in would make a bisect over the P4 wave
  /// ambiguous about which change moved what.
  ///
  /// It reads `l10n` and the theme off the BUILDER's context rather than taking
  /// them as parameters: that context is a descendant of the screen's, so both
  /// resolve, and the signature stays what every other increment expects.
  Widget _history(WidgetRef ref, Currency currency, String subId) {
    return FutureBuilder<List<PaymentRecord>>(
      future: ref.read(subscriptionRepositoryProvider).history(subId),
      builder: (BuildContext context, AsyncSnapshot<List<PaymentRecord>> snap) {
        final AppLocalizations l10n = AppLocalizations.of(context);
        final ThemeData theme = Theme.of(context);
        final bool isLight = theme.brightness == Brightness.light;
        final ColorScheme scheme = theme.colorScheme;
        final List<PaymentRecord> hist = snap.data ?? const <PaymentRecord>[];
        if (hist.isEmpty) {
          return Text(
            l10n.noPaymentsYet,
            style: AppText.muted.copyWith(
              fontSize: 12,
              color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
            ),
          );
        }
        // The row date was `'${_months[month - 1]} $day, $year'` off a
        // hardcoded English month table — "June 15, 2026". `yMMMd` is the
        // locale's own long-ish date, so English abbreviates the month
        // ("Jun 15, 2026") and Tamil orders the parts its own way. The
        // abbreviation is the intended trade: the table is gone, and a table
        // is what has to go for the screen to read correctly in any locale.
        final DateFormat rowDate = DateFormat.yMMMd(l10n.localeName);
        return Column(
          children: hist
              .map(
                (PaymentRecord h) => Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    // Same fork, same reason, as `cardDecoration` and
                    // `RowCard`: a white row on a dark scaffold. NOT a call to
                    // `cardDecoration` — that would add `kCardShadow` to a row
                    // that has never had one, i.e. repaint the light build.
                    color: isLight
                        ? AppColors.surface
                        : scheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: <Widget>[
                      // 🔴 `Flexible`, AND MEASURED BEFORE IT WAS ADDED. At the
                      // 375 px surface the row gets 375 - 36 (ListView gutters)
                      // - 28 (this card's horizontal padding) = 311 px. At
                      // textScaler 1.3 an inflexible Row overflowed that by
                      // **2.2 px in English** and by **19–36 px in Tamil**
                      // (`DateFormat.yMMMd('ta')` writes the month out) — a
                      // yellow-and-black stripe on the shipping accessibility
                      // setting, on every payment row at once.
                      //
                      // Same shape and same reasoning as the usage-meter Row
                      // above: `Flexible` and NOT `Expanded`, and only on the
                      // LEADING child. Loose fit means the date takes its
                      // intrinsic width whenever that fits, so the default
                      // scale lays out byte-identically and `spaceBetween`
                      // still distributes the same free space.
                      //
                      // ⚠️ AND DELIBERATELY NO `TextOverflow.ellipsis`. Flexible
                      // alone lets the date WRAP to a second line, which costs
                      // vertical space in a scroll view that has it. Ellipsis
                      // would turn "15 ஜூன், 2026" into "15 ஜூன்…", i.e. hide the
                      // YEAR — and the year is the one part of a payment-history
                      // date a reader is scanning for. `test/width_detail_test.dart`
                      // pins the no-overflow property in both locales.
                      Flexible(
                        child: Text(
                          rowDate.format(h.date),
                          style: AppText.muted.copyWith(
                            fontSize: 13,
                            color: isLight
                                ? AppColors.muted
                                : scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                      Text(
                        currency.fmt(h.amount),
                        style: AppText.fig.copyWith(
                          fontSize: 14,
                          color: isLight ? AppColors.ink : scheme.onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }

  Widget _miniCard(
    BuildContext context,
    String label,
    String value,
    String sub, {
    Color? valueSub,
  }) {
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: cardDecoration(context, radius: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: AppText.label.copyWith(
              fontSize: 10,
              color: isLight ? AppColors.muted : scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: AppText.fig.copyWith(
              fontSize: 21,
              color: isLight ? AppColors.ink : scheme.onSurface,
            ),
          ),
          Text(
            sub,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontWeight: FontWeight.w700,
              fontSize: 10,
              // `valueSub` is the DueInfo urgency colour when the caller passes
              // one — a status colour, so it does not fork. Only the default
              // neutral does.
              color:
                  valueSub ??
                  (isLight ? AppColors.muted : scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }

  // 48px + a label: the chassis floor for icon-only controls, and what a
  // screen reader announces (P2.6b route-walk findings).
  //
  // The white alpha fill and the white icon are ON THE HERO GRADIENT, which is
  // dark in both brightnesses — see the class doc. They do not fork.
  /// The two hero app-bar controls — "Back" and "More options".
  ///
  /// 🔴 `FocusableTap`, NOT `Semantics(button: true)` + `GestureDetector`.
  /// BOTH DOORS OFF THIS SCREEN WERE KEYBOARD-DEAD, WHICH IS THE WHOLE APP BAR.
  /// `Semantics(button: true)` announces a ROLE and creates no `FocusNode`, so
  /// Tab passed over both: a keyboard user could read the detail screen, tab
  /// through every row on it, and leave by no door on it — SC 2.1.1, Level A.
  /// `test/a11y/keyboard_sweep_test.dart` measured `/sub/:id` at 2 of 4 and
  /// named this pair, recording that home carried the identical defect until
  /// 2026-08-25; `home_screen.dart`'s own icon button says the same sentence
  /// about the same shape. One shared primitive, not one fix per call site.
  ///
  /// ⚠️ NOTHING A READER HEARS CHANGES. `label:` re-emits the same
  /// `Semantics(button: true, label: …)`, and `mergeDescendants: false` because
  /// an icon-only control has no descendant text to merge — [semanticLabel] IS
  /// its name. `borderRadius` matches the 13 px square below so the ring is not
  /// squared off round a rounded button.
  ///
  /// ⚠️ AND NOT ONE PIXEL OF THE 48x48 MOVES. `a11y_semantics_test.dart` and
  /// `chassis_properties_test.dart` pin that floor route-wide; `FocusableTap`
  /// paints its ring as a `DecorationPosition.foreground` decoration precisely
  /// so wrapping a control passes its constraints straight through. A border
  /// that participated in layout would have shrunk the target it was added to
  /// protect.
  ///
  /// 🔴 `focusColor: Colors.white`, AND THE REASON IS THIS FILE'S OWN HERO RULE
  /// twelve screens up: `AppColors.heroGradient` is three dark indigos and does
  /// NOT fork on brightness, "which is why every colour inside it below is a
  /// white or a white alpha". `colorScheme.primary` is #5B5891 in light — a
  /// dark indigo ring on a dark indigo ground, i.e. a focus indicator a sighted
  /// keyboard user would have to hunt for, which is the failure the ring exists
  /// to prevent. The white ring is the same ink the icon and the border already
  /// use here.
  ///
  /// ⚠️ NO RATIO IS CLAIMED FOR IT. `test/a11y/focus_ring_contrast_test.dart`
  /// measures the ring against two grounds — the scaffold and a card — and says
  /// in its own header that it asserts "nothing about the 14 unmeasured
  /// routes". This hero is one of them. The ring here is chosen by the same
  /// rule as every other colour on this gradient, not by a measurement, and
  /// saying otherwise would be the unmeasured conformance claim that file was
  /// written to retire.
  Widget _iconButton(IconData icon, String semanticLabel, VoidCallback onTap) {
    return FocusableTap(
      onTap: onTap,
      label: semanticLabel,
      mergeDescendants: false,
      borderRadius: BorderRadius.circular(13),
      focusColor: Colors.white,
      child: Container(
        width: 48,
        height: 48,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: const Color.fromRGBO(255, 255, 255, 0.16),
          borderRadius: BorderRadius.circular(13),
        ),
        child: Icon(icon, color: Colors.white, size: 19),
      ),
    );
  }

  // `_months` and `_shortMon` — two hardcoded English month tables — were
  // DELETED here (work order §3). They are `DateFormat.yMMMd` and
  // `DateFormat.MMMd` above. A table like these is not a translation gap that
  // an .arb can close: it bakes the ORDER of the parts as well as their names,
  // so no set of month keys would have made "June 15, 2026" correct in a
  // locale that writes the day first.
}
