import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../l10n/app_localizations.dart';

const List<BoxShadow> kCardShadow = <BoxShadow>[
  BoxShadow(color: Color(0x0A141420), blurRadius: 5, offset: Offset(0, 2)),
  BoxShadow(
    color: Color(0x24141420),
    blurRadius: 44,
    spreadRadius: -26,
    offset: Offset(0, 20),
  ),
];

/// The shared card surface. **Theme-aware — the light branch is pinned.**
///
/// 🔴 THE LIGHT BRANCH IS BYTE-FOR-BYTE THE PRE-DARK DECORATION AND MUST STAY
/// THAT WAY. `apps/subly` ships as a frozen legacy rail-prover and the owner
/// eyeballs the light build; a "harmless" swap of [AppColors.surface] for
/// `scheme.surface` would repaint every card on every screen at once, which is
/// exactly the repaint `app.dart`'s theme-fork note exists to avoid.
/// `test/dark_card_surface_test.dart` pins the resolved light colour to the
/// literal token so that swap fails the build rather than shipping.
///
/// 🔴 DARK DROPS THE SHADOW AND GAINS A BORDER, and that is a correctness fix
/// rather than a taste call: [kCardShadow] is two BLACK alphas (`0x0A141420`,
/// `0x24141420`). Black-on-dark is invisible, so a card carrying only a shadow
/// has NO edge at all against a dark scaffold — it reads as a flat region of
/// background with text floating on it. The affordance has to come from
/// somewhere, so it comes from a `scheme.outlineVariant` hairline.
///
/// `surfaceContainerHighest` is the slot, matching the brick's own home screen
/// (`tooling/bricks/app/__brick__/…/home_screen.dart`). In an M3 dark scheme it
/// is the lightest of the container ramp, so it separates from the scaffold
/// (which `buildAppTheme` sets to `scheme.surface`) by the widest margin any
/// single scheme slot offers — the card lifts without inventing a colour the
/// seed never derived.
BoxDecoration cardDecoration(BuildContext context, {double radius = 24}) {
  final ThemeData theme = Theme.of(context);
  if (theme.brightness == Brightness.light) {
    return BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(radius),
      boxShadow: kCardShadow,
    );
  }
  final ColorScheme scheme = theme.colorScheme;
  return BoxDecoration(
    color: scheme.surfaceContainerHighest,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: scheme.outlineVariant),
  );
}

/// Rounded gradient-tinted glyph square used for every subscription.
class GlyphTile extends StatelessWidget {
  const GlyphTile({
    super.key,
    required this.glyph,
    this.size = 44,
    this.fontSize = 12,
    this.statusColor,
  });

  final String glyph;
  final double size;
  final double fontSize;
  final Color? statusColor;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        Container(
          width: size,
          height: size,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(size * 0.3),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: <Color>[
                Color.fromRGBO(100, 89, 245, 0.13),
                Color.fromRGBO(155, 107, 255, 0.13),
              ],
            ),
          ),
          child: Text(
            glyph,
            style: TextStyle(
              fontFamily: 'Space Grotesk',
              fontWeight: FontWeight.w700,
              fontSize: fontSize,
              color: AppColors.accent,
            ),
          ),
        ),
        if (statusColor != null)
          Positioned(
            bottom: -2,
            right: -2,
            child: Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.surface, width: 2),
              ),
            ),
          ),
      ],
    );
  }
}

/// Soft white card row (subscription rows, list items).
class RowCard extends StatelessWidget {
  const RowCard({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.accentBar,
    this.padding = 14,
  });

  final Widget? leading;
  final String title;
  final Widget? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final Color? accentBar;
  final double padding;

  @override
  Widget build(BuildContext context) {
    final Widget row = Row(
      children: <Widget>[
        if (accentBar != null) ...<Widget>[
          Container(
            width: 3,
            height: 40,
            decoration: BoxDecoration(
              color: accentBar,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: 11),
        ],
        if (leading != null) ...<Widget>[leading!, const SizedBox(width: 12)],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                title,
                style: AppText.body.copyWith(
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (subtitle != null) ...<Widget>[
                const SizedBox(height: 2),
                subtitle!,
              ],
            ],
          ),
        ),
        if (trailing != null) ...<Widget>[const SizedBox(width: 8), trailing!],
      ],
    );

    // 🔴 THE SAME DEFECT AND THE SAME FIX AS [cardDecoration] — read its doc
    // comment first; this is its deferred sibling, named in W0's report.
    //
    // RowCard cannot simply CALL cardDecoration: the fill has to live on the
    // [Material] so the InkWell splash clips to it, while the shadow/border
    // lives on the Container outside it. So the branch is spelled out, but the
    // rule is identical and the two must move together.
    //   · LIGHT is byte-identical to the pre-dark widget: the literal
    //     [AppColors.surface] + [kCardShadow]. Pinned against the literal in
    //     `test/shared_primitives_test.dart` so "tidying" it to `scheme.surface`
    //     goes red rather than repainting every row the owner eyeballs.
    //   · DARK fills from `scheme.surfaceContainerHighest` and swaps the shadow
    //     for an `outlineVariant` hairline. kCardShadow is two BLACK alphas, so
    //     on a dark scaffold a row carrying only a shadow has no edge at all.
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;

    return Container(
      decoration: isLight
          ? BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              boxShadow: kCardShadow,
            )
          : BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: scheme.outlineVariant),
            ),
      child: Material(
        color: isLight ? AppColors.surface : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(18),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(padding: EdgeInsets.all(padding), child: row),
        ),
      ),
    );
  }
}

/// The heading above a list section ("By date", "By category", the two on home).
///
/// 🔴 THE PUREST CASE OF THE P4·TEXT ROOT CAUSE, WHICH IS WHY IT CHANGES BY ONE
/// WORD. `AppText.title` bakes [AppColors.ink] (0xFF141420) into a `const`
/// TextStyle, so this heading rendered near-black on the dark calendar and
/// budget screens — the widget itself paints nothing else, so the const style
/// WAS the whole defect. `AppText.of(context)` resolves it at the chassis:
///   · LIGHT returns the const object itself (`identical(…title, AppText.title)`
///     — pinned in `packages/design_system/test/app_text_test.dart`), so this
///     heading is byte-identical to the pre-dark one on every screen;
///   · DARK returns the same style with `scheme.onSurface`.
/// No `copyWith(color:)` at any of the four call sites, and none needed at the
/// other 105 — they keep the const styles and keep compiling.
class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.trailing});
  final String title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(2, 22, 2, 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Text(
              title,
              style: AppText.of(context).title.copyWith(fontSize: 17),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, required this.bg, required this.fg});
  final String text;
  final Color bg;
  final Color fg;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: 'Manrope',
          fontWeight: FontWeight.w700,
          fontSize: 11,
          color: fg,
        ),
      ),
    );
  }
}

/// The accent glow under [GradientButton] in LIGHT. Named so the dark branch can
/// state that it drops it, and so a test can pin the light half against the
/// literal rather than against "whatever the widget currently does".
const List<BoxShadow> kBrandGlow = <BoxShadow>[
  BoxShadow(
    color: Color.fromRGBO(100, 89, 245, 0.5),
    blurRadius: 24,
    offset: Offset(0, 12),
    spreadRadius: -12,
  ),
];

/// The primary CTA. **Theme-aware — the light branch is pinned.**
///
/// 🔴 ITS DARK DEFECT IS THE OPPOSITE OF [kCardShadow]'s, AND THAT IS THE WHOLE
/// POINT. Both are fixed-alpha shadows tuned against ONE background, so both
/// misbehave on the other — just in opposite directions. `kCardShadow` is two
/// BLACK alphas, so on a dark scaffold it paints nothing and the card loses its
/// edge (see [cardDecoration]). [kBrandGlow] is the ACCENT at 50%, so it does
/// the reverse: composited over the near-white page it is a soft lift, but
/// composited over `scheme.surface` in dark (measured #131318 for Subly's seed)
/// the same constant resolves to #3B3687 (measured) — a hard purple bloom several
/// times the weight the design asks for. A light-mode elevation cue does not
/// become a dark-mode one by being left alone.
///
/// So DARK DROPS THE GLOW AND ADDS NOTHING. That is not an omission:
///   · M3 conveys elevation in dark with surface lightness, not with shadow,
///     and this button is far brighter than any scaffold it sits on, so it
///     already reads as raised. Unlike the card, no affordance goes missing —
///     which is why this widget gets no border and [cardDecoration] does.
///
/// 🔒 THE FILL AND THE LABEL ARE DELIBERATELY NOT BRANCHED, and this is the one
/// of the three widgets where the text was never broken. `AppColors.brandGradient`
/// + `Colors.white` is already the app's established treatment on its DARK
/// surfaces — the onboarding CTA, the home and detail heroes, the FAB and the
/// calendar's today-pill all paint exactly that pair. Contrast holds at both
/// gradient ends for the 15px w700 label (4.9:1 on #6459F5, 3.5:1 on #9B6BFF;
/// AA large-text is 3:1). Swapping dark to the theme's derived
/// `AppThemeX.brandGradient` would ALSO force `scheme.onPrimary` for the label —
/// M3 dark `primary` is a tone-80 lavender, on which white scores 1.70:1 — and
/// would leave this one CTA diverging from every other brand surface in the app.
/// A repaint with no defect behind it is not a fix.
class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.label,
    this.onPressed,
    this.height = 52,
    this.fontSize = 15,
  });
  final String label;
  final VoidCallback? onPressed;
  final double height;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    final bool isLight = Theme.of(context).brightness == Brightness.light;
    return SizedBox(
      height: height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: AppColors.brandGradient,
          borderRadius: BorderRadius.circular(16),
          boxShadow: isLight ? kBrandGlow : null,
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onPressed,
            child: Center(
              child: Text(
                label,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontWeight: FontWeight.w700,
                  fontSize: fontSize,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The secondary action beside a [GradientButton]. **Theme-aware — the light
/// branch is pinned.**
///
/// 🔴 THE WORST-LOOKING OF THE THREE IN DARK, because all three of its colours
/// were light literals at once: a WHITE pill ([AppColors.surface]) with a
/// near-white hairline ([AppColors.line], 0xFFECECF2) carrying near-black text
/// ([AppColors.ink]). On a dark sheet that is a glaring white slab — "Keep it"
/// on the cancel sheet, "Continue with Apple" on login, the two consent answers.
/// The border is the same class of bug as [kCardShadow] read the other way: a
/// pale hairline tuned to sit ON white becomes the brightest thing on the screen
/// once the surface behind it is dark.
///
/// The dark branch is the [RowCard] idiom, slot for slot:
///   · fill   → `scheme.surfaceContainerHighest` (the same slot the card and the
///              row use, so the three read as one surface family)
///   · edge   → `scheme.outlineVariant`
///   · label  → `scheme.onSurface`
/// LIGHT keeps the three literals exactly, pinned in
/// `test/shared_primitives_test.dart`.
///
/// ⚠️ [color] BECAME NULLABLE, AND THE DEFAULT IS THE ONLY THING THAT MOVED.
/// It used to default to `AppColors.ink`, which is a light literal baked into
/// the signature where no `BuildContext` exists — a const default cannot consult
/// the theme, so the brightness fix HAS to live in `build`. Null now means
/// "resolve it", and an explicit [color] is still honoured verbatim in both
/// brightnesses, because a caller that passes one is choosing an accent
/// (`consent_prompt.dart` passes `AppColors.accent` for "Allow") rather than
/// asking for default prose. Every call site that omitted it renders the
/// identical `AppColors.ink` in light.
class SoftButton extends StatelessWidget {
  const SoftButton({
    super.key,
    required this.label,
    this.onPressed,
    this.height = 50,
    this.color,
  });
  final String label;
  final VoidCallback? onPressed;
  final double height;

  /// The label/foreground colour. Null resolves per brightness — see the class
  /// doc; an explicit value is used as given in BOTH brightnesses.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    final Color fg = color ?? (isLight ? AppColors.ink : scheme.onSurface);

    return SizedBox(
      height: height,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: fg,
          backgroundColor: isLight
              ? AppColors.surface
              : scheme.surfaceContainerHighest,
          side: BorderSide(
            color: isLight ? AppColors.line : scheme.outlineVariant,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: 'Manrope',
            fontWeight: FontWeight.w700,
            color: fg,
          ),
        ),
      ),
    );
  }
}

/// Opens an external URL (legal pages, company site) in the platform browser.
/// Works on all six targets via url_launcher; failures are swallowed so a
/// missing handler never crashes the UI.
Future<void> openExternalUrl(String url) async {
  final Uri uri = Uri.parse(url);
  if (await canLaunchUrl(uri)) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

/// The Nikatru full lockup (icon + wordmark) as a bundled PNG. Defaults to the
/// light-background asset; pass [onDark] for the dark-background variant.
class NikatruWordmark extends StatelessWidget {
  const NikatruWordmark({super.key, this.height = 22, this.onDark = false});

  final double height;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      onDark
          ? 'assets/brand/nikatru-logo-dark-bg.png'
          : 'assets/brand/nikatru-logo.png',
      height: height,
      filterQuality: FilterQuality.medium,
      semanticLabel: AppConfig.companyName,
    );
  }
}

/// Publisher co-branding: the Nikatru wordmark, "<app> by Nikatru", and
/// (optionally) tappable Privacy · Terms · Refund links to the live site.
/// Company name + URLs come from [AppConfig] so every portfolio app inherits.
class PoweredByNikatru extends StatelessWidget {
  const PoweredByNikatru({
    super.key,
    this.onDark = false,
    this.showLinks = true,
  });

  final bool onDark;
  final bool showLinks;

  @override
  Widget build(BuildContext context) {
    // 🔴 `poweredByLine` IS A PLACEHOLDER KEY, NOT A CONCATENATION, and the
    // Tamil value is why: it reads "{company} வழங்கும் {app}" — the two names
    // swap places. Interpolating `'$appName by $companyName'` and translating
    // only the word "by" would have produced word salad in every language whose
    // order differs from English. The names themselves stay untranslated; they
    // come from [AppConfig] so every portfolio app inherits the line.
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Color faint = onDark
        ? const Color.fromRGBO(255, 255, 255, 0.6)
        : AppColors.muted;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        NikatruWordmark(onDark: onDark),
        const SizedBox(height: 8),
        Text(
          l10n.poweredByLine(AppConfig.appName, AppConfig.companyName),
          style: AppText.muted.copyWith(fontSize: 12, color: faint),
        ),
        if (showLinks) ...<Widget>[
          const SizedBox(height: 8),
          // Wrap, not Row (P2.6b route-walk finding): three links and two dots
          // have no flex, and at narrow widths — or under the wide test font —
          // a Row overflows where a Wrap folds to a second centred line.
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              // The SHORT forms, deliberately not the chassis `privacyPolicy` /
              // `termsOfService` keys: three of these plus two dots share one
              // line, so the values differ from the long-form ones by design.
              _LegalLink(l10n.linkPrivacyShort, AppConfig.privacyUrl, faint),
              _LegalDot(faint),
              _LegalLink(l10n.linkTermsShort, AppConfig.termsUrl, faint),
              _LegalDot(faint),
              _LegalLink(l10n.linkRefundShort, AppConfig.refundUrl, faint),
            ],
          ),
        ],
      ],
    );
  }
}

class _LegalDot extends StatelessWidget {
  const _LegalDot(this.color);
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Text('·', style: TextStyle(color: color, fontSize: 12)),
    );
  }
}

class _LegalLink extends StatelessWidget {
  const _LegalLink(this.label, this.url, this.color);
  final String label;
  final String url;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => openExternalUrl(url),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: 'Manrope',
          fontWeight: FontWeight.w700,
          fontSize: 12,
          color: color,
          decoration: TextDecoration.underline,
        ),
      ),
    );
  }
}
