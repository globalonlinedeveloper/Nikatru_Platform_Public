import 'package:flutter/material.dart';

/// Palette lifted straight from the Subly design tokens.
class AppColors {
  AppColors._();

  static const Color bg = Color(0xFFF4F4F8);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color ink = Color(0xFF141420);

  /// Secondary prose. **#6F6F7B, not #73737F — a 1.5% HSL-lightness step taken
  /// for WCAG 2.1 SC 1.4.3 (AA, 4.5:1 for normal text), 2026-08-13.**
  ///
  /// This is a TEXT-ONLY token: `AppText.muted` and `AppText.label` bake it, and
  /// every other reader paints prose or a chevron with it. So 1.4.3 governs, not
  /// 1.4.11's 3:1 — and #73737F missed it on two of the three light grounds this
  /// app actually paints:
  ///   · `AppColors.bg` #F4F4F8 (the notifications scaffold, the login page and
  ///     `cancel_sheet`'s `_SheetPalette.sheet`) — 4.27:1 → **4.52:1**
  ///   · the LIVE light scaffold, `ColorScheme.fromSeed(0xFF6459F5).surface`
  ///     = #FCF8FF (measured, not assumed — `app.dart` is on the chassis path,
  ///     so `AppColors.bg` is NOT what most screens sit on) — 4.46:1 → **4.72:1**
  ///   · a white card (`cardDecoration`/`RowCard`) — 4.68:1 → 4.96:1, already AA
  ///
  /// Hue and saturation are untouched (HSL 240°/5%), so this is a legibility
  /// step and not a re-tint: the grey still reads as the same grey beside
  /// [ink], and the ink/muted hierarchy is unchanged (16.6:1 vs 4.5:1).
  ///
  /// ⚠️ IT MOVES THE DARK LEAKS THE WRONG WAY, BY 0.2, AND THEY WERE ALREADY
  /// BROKEN. Three sites still paint this light literal unconditionally, so it
  /// reaches the dark scaffold: `home_screen.dart:400` (the row chevron),
  /// `notifications_screen.dart:197` (the empty-state prose) and
  /// `due.dart:28`/`:51` (the >5-days label). Measured on #131318 they go
  /// 3.96:1 → 3.74:1, and on a dark `surfaceContainerHighest` #35343A
  /// 2.63:1 → 2.49:1. Both were under AA before this change and are under it
  /// after; the fix for them is the per-site `isLight ? … : scheme.onSurfaceVariant`
  /// branch the rest of the tree already carries, NOT a compromise value here —
  /// no single literal can clear 4.5:1 on #FCF8FF and on #131318 at once.
  static const Color muted = Color(0xFF6F6F7B);

  static const Color line = Color(0xFFECECF2);

  static const Color accent = Color(0xFF6459F5);

  /// The far end of [brandGradient]. **#8950FF, not #9B6BFF — a 5.2%
  /// HSL-lightness step taken for SC 1.4.3, 2026-08-13.**
  ///
  /// White is painted on this gradient in both brightnesses and deliberately so
  /// (an on-gradient colour must not follow the scheme, because the surface
  /// under it does not) — but at the gradient's END the old value scored
  /// **3.53:1**, and every label riding it is NORMAL-size text, not large:
  ///   · `GradientButton`'s label is 15px w700 — the app's primary CTA, on
  ///     "Sign in", "Add subscription", "Cancel", "Go to dashboard". WCAG's
  ///     large-scale floor is 18pt (24px), or 14pt (18.66px) when bold, so 15px
  ///     bold is normal text and owes 4.5:1, not 3:1.
  ///   · `calendar_screen.dart:314` paints the today-pill's day number white at
  ///     12px on the same gradient.
  /// White on it is now **4.51:1**. The accent end was never the problem
  /// (4.90:1) and does not move.
  ///
  /// 🔴 THE DOC COMMENT ON `GradientButton` CLAIMED THIS WAS FINE — "Contrast
  /// holds at both gradient ends for the 15px w700 label (4.9:1 on #6459F5,
  /// 3.5:1 on #9B6BFF; AA large-text is 3:1)" (`widgets.dart:402-404`). Both
  /// measurements were right and the conclusion was wrong: 15px w700 is not
  /// large text, so the bar it had to clear was 4.5:1 and the second number was
  /// a failure being reported as a pass. Corrected there in the same change.
  ///
  /// Hue and saturation are untouched (HSL 262°/100%), so the indigo→violet
  /// sweep keeps its character; only the second stop stops being pale.
  /// Safe in dark: nothing anywhere paints [accent2] as a FOREGROUND — its only
  /// readers are this gradient, `onboarding_screen.dart:121`'s decorative blob,
  /// and the pinned-legacy `AppTheme.light/dark` scheme slots.
  static const Color accent2 = Color(0xFF8950FF);

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE STATUS TRIO FAILS AA AS *TEXT* IN LIGHT AND NO VALUE HERE CAN FIX
  // IT. Measured 2026-08-13, and left unchanged deliberately — read this before
  // "just darkening them".
  //
  // As foregrounds on the light grounds this app paints (white card #FFFFFF /
  // #F4F4F8 / the live scaffold #FCF8FF) they score 2.54:1 (positive), 2.15:1
  // (warn) and 3.54:1 (danger). Eight sites paint them as normal-size text —
  // `insights_screen.dart:376` (11px w700), `subscription_detail_screen.dart:288`
  // (12px w700), `home_screen.dart:653` (the due label, 11px w700),
  // `budget_screen.dart:237`/`:334`, `cancel_sheet.dart:56`, the insights
  // savings `Pill`, and `SoftButton`'s label at `settings_screen.dart:747`/`:781`
  // — so SC 1.4.3's 4.5:1 governs and all eight are under it.
  //
  // AND THE SAME LITERALS ARE PAINTED, UNBRANCHED, ON THE DARK SURFACES, which
  // is a documented and TESTED decision, not an oversight:
  // `dark_group_detail_test.dart:512-532` asserts the usage label is exactly
  // `AppColors.positive` at BOTH brightnesses — "green means good in every app
  // and at every brightness" — and `AppThemeX.fromScheme` refuses to re-hue the
  // trio for the same reason. On the dark scaffold #131318 they currently score
  // 7.30 / 8.62 / 5.24, i.e. they are CORRECT there.
  //
  // The two requirements are arithmetically incompatible for one literal:
  //   · ≥4.5:1 on white  ⇒ relative luminance ≤ 1.05/4.5 − 0.05 = 0.1833
  //   · ≥4.5:1 on #131318 (L 0.0139) ⇒ luminance ≥ 4.5·(0.0139+0.05) − 0.05
  //                                              = 0.2376
  // 0.1833 < 0.2376, so no colour of any hue satisfies both. Darkening the
  // tokens in place was measured and would trade a light failure for a worse
  // dark one: positive 7.30 → 3.65 and warn 8.62 → 3.74 on the dark scaffold,
  // and 4.86 → 2.43 / 5.74 → 2.49 on a dark card.
  //
  // ✅ THE FIX IS A BRIGHTNESS FORK, the shape `AppText.of` already uses for the
  // prose tokens: a light text tone per status (measured minimum steps that
  // clear every real ground — positive #0B7E58, warn #9C6406, danger #DD1438)
  // resolved by ambient brightness, with the existing literals kept for dark.
  // That reverses the "status colours do not fork" decision above and rewrites
  // the tests that pin it, so it is an owner-visible design-system change with
  // its own increment — not a silent token edit here.
  static const Color positive = Color(0xFF10B981);
  static const Color warn = Color(0xFFF59E0B);
  static const Color danger = Color(0xFFEF4D6A);

  // Dark hero / detail header
  static const Color heroA = Color(0xFF1B1930);
  static const Color heroB = Color(0xFF2A2456);
  static const Color heroC = Color(0xFF3A2F6E);
  static const Color onboardBg = Color(0xFF12111C);

  // Category ramp (matches the design's donut/legend order)
  static const List<Color> ramp = <Color>[
    Color(0xFF6459F5),
    Color(0xFF10B981),
    Color(0xFFF59E0B),
    Color(0xFFFF5D8F),
    Color(0xFF3BC7F5),
    Color(0xFF9B6BFF),
    Color(0xFF5B8DEF),
    Color(0xFFFFB020),
  ];

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[accent, accent2],
  );

  static const LinearGradient heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: <Color>[heroA, heroB, heroC],
    stops: <double>[0.0, 0.7, 1.0],
  );
}
