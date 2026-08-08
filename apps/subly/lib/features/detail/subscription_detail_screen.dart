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
  const SubscriptionDetailScreen({super.key, required this.id});
  final String id;

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
    final DueInfo due = DueInfo.localized(l10n, s, DateTime.now());

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
          // the glyph tile and the title at the same `kMaxBodyWidth` the body
          // `ListView` below uses.
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
              child: ContentPane(
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
                          () => context.pop(),
                        ),
                        // The `more_horiz` control is still a STUB — it opens
                        // nothing. Its label is localized anyway because a
                        // screen reader announces it today regardless of what
                        // the tap does.
                        _iconButton(Icons.more_horiz, l10n.moreOptions, () {}),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Container(
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
          // The body is a PAGE (mini-cards, a meter, a history list), so it
          // takes the default `kMaxBodyWidth` cap — the same one settings and
          // home record. `.pane` (480) was considered and rejected: this is a
          // full route pushed over the shell, not a side panel, and 480 would
          // make it dramatically narrower than the screen that pushed it.
          //
          // The `ListView` keeps its OWN padding rather than handing it to the
          // pane: a scroll view's padding scrolls with the content and supplies
          // the bottom run-off, and moving it out would clip rows at the inset
          // edge instead.
          Expanded(
            child: ContentPane(
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
                          onPressed: () => context.pop(),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: SizedBox(
                          height: 50,
                          child: FilledButton(
                            onPressed: () async {
                              await showCancelSheet(context, s);
                              if (context.mounted) context.pop();
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
                      Text(
                        rowDate.format(h.date),
                        style: AppText.muted.copyWith(
                          fontSize: 13,
                          color: isLight
                              ? AppColors.muted
                              : scheme.onSurfaceVariant,
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
  Widget _iconButton(IconData icon, String semanticLabel, VoidCallback onTap) {
    return Semantics(
      button: true,
      label: semanticLabel,
      child: GestureDetector(
        onTap: onTap,
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
