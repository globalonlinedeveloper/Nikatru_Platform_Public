import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';

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

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: kCardShadow,
      ),
      child: Material(
        color: AppColors.surface,
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
              style: AppText.title.copyWith(fontSize: 17),
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
    return SizedBox(
      height: height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: AppColors.brandGradient,
          borderRadius: BorderRadius.circular(16),
          boxShadow: const <BoxShadow>[
            BoxShadow(
              color: Color.fromRGBO(100, 89, 245, 0.5),
              blurRadius: 24,
              offset: Offset(0, 12),
              spreadRadius: -12,
            ),
          ],
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

class SoftButton extends StatelessWidget {
  const SoftButton({
    super.key,
    required this.label,
    this.onPressed,
    this.height = 50,
    this.color = AppColors.ink,
  });
  final String label;
  final VoidCallback? onPressed;
  final double height;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: height,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          backgroundColor: AppColors.surface,
          side: const BorderSide(color: AppColors.line),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontFamily: 'Manrope',
            fontWeight: FontWeight.w700,
            color: color,
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
    final Color faint = onDark
        ? const Color.fromRGBO(255, 255, 255, 0.6)
        : AppColors.muted;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        NikatruWordmark(onDark: onDark),
        const SizedBox(height: 8),
        Text(
          '${AppConfig.appName} by ${AppConfig.companyName}',
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
              _LegalLink('Privacy', AppConfig.privacyUrl, faint),
              _LegalDot(faint),
              _LegalLink('Terms', AppConfig.termsUrl, faint),
              _LegalDot(faint),
              _LegalLink('Refund', AppConfig.refundUrl, faint),
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
