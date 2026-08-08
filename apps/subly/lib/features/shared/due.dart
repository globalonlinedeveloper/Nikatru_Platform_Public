import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';

/// Human "due in N days" label + urgency color, shared by Home/Calendar/Detail.
class DueInfo {
  const DueInfo(this.label, this.color);
  final String label;
  final Color color;

  /// The English-only original. **RETAINED DURING THE L10N MIGRATION.**
  ///
  /// The workorder specifies changing this signature to take an
  /// [AppLocalizations]; doing that in one step would drag the three call sites
  /// (home:459, calendar:256, detail:56) into this increment, and those files
  /// belong to later file-group increments that also port their date tables and
  /// dark tokens. Adding [localized] alongside instead keeps every increment
  /// independently compilable and collision-free — the three call sites migrate
  /// with their own files, and the FINAL cleanup increment deletes this method
  /// once the last one has moved. Do not add new callers.
  static DueInfo of(Subscription s, DateTime now) {
    final int d = s.daysUntil(now);
    if (d <= 0) return const DueInfo('Due today', AppColors.warn);
    if (d == 1) return const DueInfo('Renews tomorrow', AppColors.warn);
    if (d <= 5) return DueInfo('In $d days', AppColors.accent);
    return DueInfo('In $d days', AppColors.muted);
  }

  /// The localized form. Identical thresholds and colors to [of]; only the label
  /// comes from the arb.
  ///
  /// 🔴 `dueInDays` IS A PLURAL KEY, and that is a bug fix rather than a
  /// translation nicety: both live branches of [of] read `In $d days`, so a
  /// one-day horizon rendered "In 1 days". English needed the plural before
  /// Tamil did.
  ///
  /// Takes the [AppLocalizations] rather than a [BuildContext] because the three
  /// call sites are inside build methods that already hold `l10n`, and because a
  /// context-free signature keeps this testable without pumping a widget.
  static DueInfo localized(
    AppLocalizations l10n,
    Subscription s,
    DateTime now,
  ) {
    final int d = s.daysUntil(now);
    if (d <= 0) return DueInfo(l10n.dueToday, AppColors.warn);
    if (d == 1) return DueInfo(l10n.renewsTomorrow, AppColors.warn);
    if (d <= 5) return DueInfo(l10n.dueInDays(d), AppColors.accent);
    return DueInfo(l10n.dueInDays(d), AppColors.muted);
  }
}
