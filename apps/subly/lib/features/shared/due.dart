import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';

/// Human "due in N days" label + urgency color, shared by Home/Calendar/Detail.
class DueInfo {
  const DueInfo(this.label, this.color);
  final String label;
  final Color color;

  /// The on-LIGHT TEXT tone for the urgent branch. **#9C6406, not
  /// [AppColors.warn] #F59E0B.**
  ///
  /// 🔴 THE DEFECT THIS FIXES, MEASURED 2026-08-21 OFF THE REAL PUMPED TREE.
  /// [of] and [localized] hand ONE colour to home, calendar and detail alike,
  /// and all three paint it as small bold TEXT — home's row subtitle at 11px
  /// w700 on the white `RowCard` fill (`home_screen.dart:1064-1070`),
  /// calendar's renewal row at 11px w700 on the same white card
  /// (`calendar_screen.dart:823-829`), detail's mini-card at 10px w700
  /// (`subscription_detail_screen.dart:261-262`). That colour was
  /// [AppColors.warn], which is a **FILL** token — badges, meters, the amber
  /// glyph square — and as text on #FFFFFF it measures **2.15:1** against WCAG
  /// 2.1 SC 1.4.3 AA's 4.5:1 for normal-size text. 11px w700 is NOT large text:
  /// the framework's own bar is >18px, or >14px when bold
  /// (`accessibility.dart`'s `targetContrastRatio`), so 4.5 governs, not 3.
  ///
  /// ⚠️ [AppColors.warn] ITSELF DOES NOT MOVE, and must not: it is correct as a
  /// fill, `AppThemeX.fromScheme` deliberately refuses to re-hue the status trio
  /// so that amber means "attention" in every stamped app, and the same literal
  /// is CORRECT as text on the dark surfaces (5.74:1 on the dark `RowCard` fill
  /// `scheme.surfaceContainerHighest` #35343A, 8.62:1 on the dark scaffold
  /// #131318). What is wrong is the LIGHT ground, so the fork is by brightness
  /// and not a new value for the token.
  ///
  /// MEASURED for this value against every light ground a due label is painted
  /// on — by `a11y_semantics_test.dart`'s "the due-label fork clears AA in BOTH
  /// brightnesses" case, so these numbers are asserted rather than typed from a
  /// calculator:
  ///   · #FFFFFF (the light `RowCard`/calendar/detail card fill) — **4.95:1**
  ///   · #FCF8FF (the live light scaffold, `ColorScheme.fromSeed(0xFF6459F5)`)
  ///     — **4.72:1**
  ///   · #F4F4F8 ([AppColors.bg]) — **4.52:1**
  /// Hue and saturation are untouched from [AppColors.warn] (HSL 38°/100%), so
  /// this is a legibility step and not a re-tint — the label still reads as the
  /// same amber warning. It is the same step `app_colors.dart:100-113` already
  /// measured and named when it recorded the status-trio fork as owed.
  ///
  /// 📌 IT IS A LOCAL CONST BECAUSE THE TOKEN IT BELONGS TO IS NOT IN THIS
  /// PACKAGE. The right long-term home is a `warnText` slot on `AppThemeX`
  /// beside the existing `warn`, resolved by brightness the way `AppText.of`
  /// resolves prose; `packages/design_system` is a separate increment and a
  /// separate owner. Until then this is the single place the value is spelled,
  /// and it is reached only through [_urgentText].
  static const Color _warnOnLight = Color(0xFF9C6406);

  /// The urgent branch's colour, resolved for the ambient [brightness].
  ///
  /// 🔴 NO SINGLE COLOUR CAN SERVE BOTH GROUNDS, AND THAT IS ARITHMETIC RATHER
  /// THAN TASTE. Measured 2026-08-21: a due label has to clear 4.5:1 on the
  /// light card (#FFFFFF, relative luminance 1.0) AND on the dark card
  /// (`scheme.surfaceContainerHighest` #35343A, luminance 0.0352).
  ///   · white   ⇒ the text's luminance must be ≤ 1.05/4.5 − 0.05 = **0.1833**
  ///   · #35343A ⇒ it must be ≥ 4.5·(0.0352+0.05) − 0.05 = **0.3333**
  /// 0.1833 < 0.3333, so the set of colours satisfying both is EMPTY — of any
  /// hue, at any saturation. (The two windows overlap only if the dark ground's
  /// luminance is ≤0.0019, i.e. very nearly #000000, which
  /// `surfaceContainerHighest` is not.) A "compromise amber" is not a thing that
  /// exists; the branch has to know which surface it is on.
  ///
  /// ⚠️ [brightness] IS OPTIONAL AND ITS DEFAULT IS THE SHIPPED DARK-SAFE
  /// LITERAL. That is deliberate, and it is NOT the end of this fix. The three
  /// call sites live in files this increment does not own, so until each passes
  /// `Theme.of(context).brightness` they keep the exact colour they render
  /// today: correct in dark, still 2.15:1 in light. Defaulting to
  /// [Brightness.light] instead would fix light and REGRESS dark to 2.49:1 for
  /// every unmigrated caller — trading a known open defect for a new one on a
  /// shipped surface, which is worse than leaving the seam unused for one
  /// increment. `a11y_semantics_test.dart` names the light failure in an
  /// `except:` entry that ASSERTS IT IS STILL NEEDED, so the day the last call
  /// site migrates that case goes red and the exemption has to be deleted.
  ///
  /// The parameter is a plain [Brightness] rather than a [BuildContext] for the
  /// same reason [localized] takes an [AppLocalizations]: a context-free
  /// signature keeps both factories testable without pumping a widget.
  static Color _urgentText(Brightness? brightness) =>
      brightness == Brightness.light ? _warnOnLight : AppColors.warn;

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
  ///
  /// ⚠️ [brightness] IS CARRIED HERE TOO, NOT ONLY ON [localized]. The two
  /// factories are one behaviour spelled twice; forking only the live one would
  /// leave this method handing out a 2.15:1 light colour that its own tests
  /// would go on calling correct, and the cleanup increment above would then
  /// delete the record of the fix along with the method. See [_urgentText].
  static DueInfo of(Subscription s, DateTime now, {Brightness? brightness}) {
    final int d = s.daysUntil(now);
    if (d <= 0) return DueInfo('Due today', _urgentText(brightness));
    if (d == 1) return DueInfo('Renews tomorrow', _urgentText(brightness));
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
  ///
  /// 📌 THE OTHER TWO BRANCHES ARE LEFT ALONE ON PURPOSE, AND THAT IS A
  /// MEASUREMENT RATHER THAN AN OMISSION. On the light card [AppColors.accent]
  /// is 4.90:1 and [AppColors.muted] is 4.96:1 — both clear AA — so darkening
  /// them beside the urgent branch would repaint a screen the owner eyeballs in
  /// order to fix nothing. (Both DO fail on the DARK card — 2.52:1 and 2.49:1 —
  /// but neither branch reaches it in any state pumped on 2026-08-21, and the
  /// fix for them is the same `isLight ? … : scheme.onSurfaceVariant` fork the
  /// rest of the tree already carries, owned by their own increment.)
  static DueInfo localized(
    AppLocalizations l10n,
    Subscription s,
    DateTime now, {
    Brightness? brightness,
  }) {
    final int d = s.daysUntil(now);
    if (d <= 0) return DueInfo(l10n.dueToday, _urgentText(brightness));
    if (d == 1) {
      return DueInfo(l10n.renewsTomorrow, _urgentText(brightness));
    }
    if (d <= 5) return DueInfo(l10n.dueInDays(d), AppColors.accent);
    return DueInfo(l10n.dueInDays(d), AppColors.muted);
  }
}
