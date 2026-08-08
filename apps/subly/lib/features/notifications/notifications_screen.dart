import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/currency.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final double savings = SubMath.savings(subs);

    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;

    // 🔴 D/M/Y WAS HARDCODED, and it was wrong for most of the world rather than
    // merely untranslated. The line read
    // `'${x.nextRenewal.day}/${x.nextRenewal.month}/${x.nextRenewal.year}'`,
    // so every locale got day-first — including `en`, where 9/8/2026 means
    // September 8th to the reader and August 9th to the code. A date built by
    // string concatenation cannot be localised at all; only a formatter can.
    //
    // The locale comes from `Localizations.localeOf`, and `toString()` (not
    // `toLanguageTag()`) is deliberate: intl keys its symbol tables with the
    // underscore form (`en_US`), while the BCP-47 tag uses a hyphen. The symbol
    // data itself is loaded by `GlobalMaterialLocalizations`, which is in
    // `AppLocalizations.localizationsDelegates` — so any host that can build
    // this screen at all has already initialised the formatter's data.
    final DateFormat renewalDate = DateFormat.yMd(
      Localizations.localeOf(context).toString(),
    );

    // 2026-07-27 - this list was FIVE HARDCODED entries naming real brands and
    // inventing facts about the user's own accounts: "Adobe CC and Disney+
    // haven't been opened in weeks", "Netflix price increased from 13.99 to
    // 15.49", renewals for plans the user may not even track. It rendered
    // identically for everyone, because none of it came from their data.
    //
    // The app has no usage tracking and no price history, so neither claim could
    // ever have been derived. Every row below is now computed from the
    // subscriptions actually held, and anything that cannot be computed is not
    // shown at all.
    final DateTime now = DateTime.now();

    final List<Subscription> dueSoon =
        subs.where((Subscription x) {
          final int d = x.daysUntil(now);
          return d >= 0 && d <= 7;
        }).toList()..sort(
          (Subscription a, Subscription b) =>
              a.daysUntil(now).compareTo(b.daysUntil(now)),
        );

    final List<Subscription> flaggedUnused = subs
        .where((Subscription x) => x.unused)
        .toList();

    // 🔴 THE PLURAL ARMS CARRY WHOLE CLAUSES, NOT A NOUN.
    //
    // What was here glued fragments together with inline ternaries:
    //   '${n} ${n == 1 ? "plan is" : "plans are"} marked unused'
    //   'Cancelling ${n == 1 ? "it" : "them"} would save …'
    // Both are English grammar written as Dart. The first agrees a VERB with a
    // count, the second swaps a PRONOUN — and neither agreement is a property of
    // the number, it is a property of the language. Tamil inflects the noun in a
    // different position and does not have the pronoun split at all, so a
    // translator handed the fragments "plan is" / "plans are" has been handed a
    // puzzle rather than a sentence.
    //
    // So each arm of `notifUnusedCount` and `notifCancellingSaves` is a complete
    // clause. The count still selects the arm; the arm is what a translator
    // rewrites freely.
    final List<_Notif> items = <_Notif>[
      for (final Subscription x in dueSoon)
        _Notif(
          Icons.notifications_none,
          AppColors.accent,
          const Color.fromRGBO(100, 89, 245, 0.12),
          x.daysUntil(now) == 0
              ? l10n.notifRenewsToday(x.name)
              // (name, count) — gen-l10n orders the parameters by the arb's
              // placeholder map, and the plural SELECTOR is the second one here.
              : l10n.notifRenewsInDays(x.name, x.daysUntil(now)),
          l10n.notifChargeOn(
            currency.fmt(x.price),
            renewalDate.format(x.nextRenewal),
          ),
        ),
      if (flaggedUnused.isNotEmpty)
        _Notif(
          Icons.priority_high,
          AppColors.warn,
          const Color.fromRGBO(245, 158, 11, 0.13),
          l10n.notifUnusedCount(flaggedUnused.length),
          l10n.notifCancellingSaves(
            flaggedUnused.length,
            currency.fmt(savings),
          ),
        ),
    ];

    return Scaffold(
      // Light byte-identical (the literal AppColors.bg); dark takes
      // `scheme.surface`, which is what `buildAppTheme` gives
      // `scaffoldBackgroundColor` — so this screen stops being a pale sheet in
      // front of a dark app.
      backgroundColor: isLight ? AppColors.bg : scheme.surface,
      body: SafeArea(
        // ── THE CONTENT PANE ──────────────────────────────────────────────────
        // Same defect and same fix as home and PR #210's three screens: this is
        // a pushed full-screen route, so NOTHING capped it. On a 1920px desktop
        // the header put the title at one edge and the close button at the
        // other, ~1850px apart, and every notification card became a 1900px
        // band with a 40px glyph at the left and two lines of text beside it.
        //
        // The DEFAULT cap (`AppBreakpoints.kMaxBodyWidth`) rather than
        // `.reading`: these are cards in a list, the same shape home caps, not
        // continuous prose. The pane wraps the WHOLE column — header, rule and
        // list together — because capping only the list would leave the title
        // and the close button hanging off the edges of a centred list, which is
        // worse than not capping at all.
        child: ContentPane(
          child: Column(
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.gutterCompact,
                  8,
                  AppSpacing.gutterCompact,
                  14,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Text(
                      l10n.notifications,
                      style: AppText.title.copyWith(fontSize: 22),
                    ),
                    Semantics(
                      button: true,
                      label: l10n.close,
                      child: GestureDetector(
                        onTap: () => context.pop(),
                        child: Container(
                          width: 48,
                          height: 48,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: isLight
                                ? AppColors.surface
                                : scheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(
                              color: isLight
                                  ? AppColors.line
                                  : scheme.outlineVariant,
                            ),
                          ),
                          child: Icon(
                            Icons.close,
                            size: 18,
                            color: isLight ? AppColors.ink : scheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Divider(
                height: 1,
                color: isLight ? AppColors.line : scheme.outlineVariant,
              ),
              Expanded(
                child: items.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(32),
                          child: Text(
                            l10n.notifNothingDue,
                            textAlign: TextAlign.center,
                            style: AppText.body.copyWith(
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                      )
                    : ListView.separated(
                        // Rebased onto the chassis gutter, matching home: the
                        // horizontal 18 was already `AppSpacing.gutterCompact`
                        // by value and is now so by name, and the bottom grows
                        // to `AppSpacing.xl` so the last card is not flush
                        // against the safe-area edge.
                        padding: const EdgeInsets.fromLTRB(
                          AppSpacing.gutterCompact,
                          AppSpacing.gutterCompact,
                          AppSpacing.gutterCompact,
                          AppSpacing.xl,
                        ),
                        itemCount: items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 10),
                        itemBuilder: (BuildContext context, int i) =>
                            _card(context, items[i]),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _card(BuildContext context, _Notif n) {
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.all(14),
      // Spelled out rather than delegating to `cardDecoration`: that helper's
      // LIGHT branch carries `kCardShadow`, and this card has never had one.
      // Calling it would have been a one-line diff that repainted the light
      // screen — the exact repaint the pinned light branches exist to prevent.
      // The DARK branch is identical to the helper's, so the two stay one look.
      decoration: isLight
          ? BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(18),
            )
          : BoxDecoration(
              color: scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: scheme.outlineVariant),
            ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 40,
            height: 40,
            alignment: Alignment.center,
            // `n.bg` is a TRANSLUCENT accent/warn tint (12–13% alpha), so it
            // composites over whatever the card is and works in both
            // brightnesses. It is not a light-hardcoded fill and is left alone
            // deliberately.
            decoration: BoxDecoration(
              color: n.bg,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(n.icon, color: n.color, size: 18),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  n.title,
                  style: AppText.body.copyWith(
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  n.body,
                  style: AppText.muted.copyWith(fontSize: 13, height: 1.45),
                ),
                // 🔴 A THIRD `Text` LIVED HERE AND RENDERED NOTHING, for as long
                // as this screen has been data-driven. It was
                // `Text(n.time.toUpperCase(), style: AppText.label…)`, and BOTH
                // construction sites above passed `''` — the field was the last
                // remnant of the five hardcoded entries ("2 HOURS AGO") deleted
                // on 2026-07-27. `''.toUpperCase()` is `''`, so it laid out a
                // zero-width Text plus a 6px gap on every card, invisible and
                // untestable. Deleted here WITH its field (WORKORDER §1 flags
                // it): a struct member every caller passes empty is not data, it
                // is a leftover, and leaving it would have meant l10n-ing a
                // string nobody can see.
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Notif {
  const _Notif(this.icon, this.color, this.bg, this.title, this.body);
  final IconData icon;
  final Color color;
  final Color bg;
  final String title;
  final String body;
}
