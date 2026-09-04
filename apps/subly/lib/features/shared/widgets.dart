import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show BrandFooter, BrandFooterLink, BrandWordmark;
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
/// THAT WAY. The owner eyeballs the light build; a "harmless" swap of
/// [AppColors.surface] for `scheme.surface` would repaint every card on every
/// screen at once, which is exactly the repaint `app.dart`'s theme-fork note
/// exists to avoid. `test/dark_card_surface_test.dart` pins the resolved light
/// colour to the literal token so that swap fails the build rather than
/// shipping.
///
/// 📌 PREMISE CORRECTED 2026-08-21 — the paragraph above used to open
/// *"`apps/subly` ships as a frozen legacy rail-prover"*. It does not, and did
/// not when this comment was written:
/// `Private/decisions/036-subly-freeze-dissolved-by-owner-order.md` dissolved
/// that freeze by owner order on 2026-08-08 — *"Subly stops being a frozen
/// legacy rail-prover and becomes the active commercial product"*. Subly is the
/// shipping product, live on the web. THE PIN IS UNAFFECTED, because it never
/// rested on the freeze: it rests on blast radius, and the blast radius GREW
/// when the app stopped being parked. `test/dark_card_surface_test.dart:14`
/// and `:82` still carry the old framing in their own words; the pin they
/// enforce is correct either way.
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
///
/// 🔴 THE GLYPH IS DECORATIVE BY DEFAULT, AND THAT IS THE A11Y FIX RATHER THAN
/// AN OMISSION. [glyph] is a two- or three-letter mark ("N", "SP", "CG") derived
/// from the subscription's name, and every place this tile is used it sits
/// BESIDE that name as text — [RowCard]'s title on home and scan, the row label
/// on insights. So a screen reader that reads the tile reads a meaningless token
/// immediately before the real one: "N, Netflix, ₹649". Excluding it removes a
/// stutter that no sighted user ever experiences and loses nothing, because the
/// tile carries no information the row does not already say in words.
///
/// [semanticLabel] is the escape hatch for the opposite case — a tile standing
/// ALONE, with no adjacent text — where the mark IS the only identifier and must
/// be announced as the thing it stands for rather than as its letters. No
/// product call site needs it today (every current one is accompanied), so it is
/// exercised directly by `test/a11y_semantics_test.dart` instead of by a screen;
/// an untested optional parameter is the dead-seam shape this repo keeps
/// removing.
///
/// [statusColor] is deliberately NOT announced either: the dot encodes the
/// usage tier, and `home_screen.dart`'s `_subTile` only paints it on the branch
/// whose subtitle already spells that tier out in words.
class GlyphTile extends StatelessWidget {
  const GlyphTile({
    super.key,
    required this.glyph,
    this.size = 44,
    this.fontSize = 12,
    this.statusColor,
    this.semanticLabel,
  });

  final String glyph;
  final double size;
  final double fontSize;
  final Color? statusColor;

  /// What a screen reader should announce INSTEAD of the glyph. Null (the
  /// default) makes the tile decorative — see the class doc.
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final String? label = semanticLabel;
    final Widget tile = _tile();
    // Both branches drop the glyph itself; they differ only in what replaces
    // it. `excludeSemantics` rather than a sibling `ExcludeSemantics` so the
    // label cannot end up concatenated with the token it exists to replace.
    return label == null
        ? ExcludeSemantics(child: tile)
        : Semantics(label: label, excludeSemantics: true, child: tile);
  }

  Widget _tile() {
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

/// The soft card row (subscription rows, list items). **Theme-aware in all
/// three of its colours — fill, edge and title — and POINTER-AWARE in its
/// density and its hover state.**
///
/// *(This read "Soft white card row" until 2026-08-21. It became false when the
/// fill was dark-forked below and stayed false while the title was still
/// near-black — the one line of prose describing this widget was the one place
/// that still claimed it was white, which is how the remaining half of the leak
/// read as finished.)*
///
/// 🖥 DENSITY COMES FROM `theme.visualDensity`, NOT FROM A WIDTH, AND THAT IS THE
/// WHOLE REASON THERE IS NO BREAKPOINT IN THIS FILE. Width is a bad proxy for
/// the thing that actually decides how tall a row should be: a phone in
/// landscape is 900px wide and still wants a thumb row, a desktop window docked
/// to half a screen is 700px and still wants a mouse row. Any `AppBreakpoints`
/// test would therefore be wrong in BOTH directions.
///
/// `ThemeData` already resolves the right signal for us:
/// `visualDensity ??= VisualDensity.defaultDensityForPlatform(platform)`
/// (`flutter/lib/src/material/theme_data.dart:412`), which is
/// `VisualDensity.compact` on macOS/Windows/Linux and `standard` on
/// Android/iOS/Fuchsia (`:3243-3246`). `buildAppTheme` sets NEITHER `platform`
/// NOR `visualDensity` (measured 2026-08-21), so it inherits that default and
/// **the seam is already open on the three desktop targets** — no change to the
/// shared theme builder, no per-app switch to forget, and an app that wants to
/// override it can, because it is a theme property and not a literal in here.
///
/// The arithmetic is the framework's, not a taste number: `compact` is
/// `(-2, -2)` (`:3225`) and `baseSizeAdjustment` is density × 4 logical pixels
/// (`:3307-3314`), so `dy` is **-8** — a TOTAL size adjustment, hence -4 per
/// edge. The default `padding: 14` resolves to 10; home's 44px [GlyphTile] row
/// goes **72 → 64**, and scan's 38px tile at `padding: 11` goes **60 → 52**.
///
/// ⚠️ VERTICAL ONLY, and that is Material's own reading rather than a shortcut:
/// "for chips, it only affects the vertical size, not the horizontal size"
/// (`:3159`) — components are expected to interpret the density themselves. The
/// horizontal inset is left alone because it sets this row's text rhythm against
/// the [cardDecoration] cards beside it on home and insights, which are NOT
/// RowCards and do not tighten. Moving it would leave a mixed screen's left edge
/// flush on mobile and ragged on desktop.
///
/// 🖱 HOVER IS DRIVEN BY ACTUAL HOVER, which is the only signal that reports the
/// POINTER rather than the platform: a touch screen never fires it, so nothing
/// has to be inferred and a tablet build needs no special case. It is
/// deliberately NOT wired to the density above — a row that changed height under
/// the cursor would shove every row below it as the pointer crossed the list.
class RowCard extends StatefulWidget {
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
  State<RowCard> createState() => _RowCardState();
}

class _RowCardState extends State<RowCard> {
  /// Whether a hovering pointer is currently inside the row. Only ever set from
  /// [InkWell.onHover], i.e. only by a device that hovers at all.
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final Widget row = Row(
      children: <Widget>[
        if (widget.accentBar != null) ...<Widget>[
          Container(
            width: 3,
            height: 40,
            decoration: BoxDecoration(
              color: widget.accentBar,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
          const SizedBox(width: 11),
        ],
        if (widget.leading != null) ...<Widget>[
          widget.leading!,
          const SizedBox(width: 12),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              // 🔴 THE TITLE WAS THE LAST HALF OF THIS WIDGET STILL PAINTING A
              // LIGHT LITERAL, AND IT WAS THE WORST ONE IN THE APP. The FILL
              // below was dark-forked (`scheme.surfaceContainerHighest`) while
              // this line kept the bare const `AppText.body`, which bakes
              // [AppColors.ink] (0xFF141420) — so every subscription row in
              // Subly, the app's commonest control, put near-black text on a
              // dark card. Fixing the surface without the text on it is how a
              // contrast leak survives a dark-mode pass looking finished.
              //
              // ✅ LIGHT IS UNCHANGED AND A REVIEWER DOES NOT HAVE TO DIFF
              // SCREENSHOTS TO BELIEVE IT. `AppText.of(context)` returns the
              // const objects THEMSELVES in light — `identical(…body,
              // AppText.body)` is pinned in
              // `packages/design_system/test/app_text_test.dart` — so this is
              // the same `TextStyle` instance, and the same `copyWith` on it,
              // that the pre-dark widget built. DARK is `scheme.onSurface`.
              // Exactly the one-word migration [SectionHeader] below records.
              Text(
                widget.title,
                style: AppText.of(
                  context,
                ).body.copyWith(fontWeight: FontWeight.w700, fontSize: 15),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              if (widget.subtitle != null) ...<Widget>[
                const SizedBox(height: 2),
                widget.subtitle!,
              ],
            ],
          ),
        ),
        if (widget.trailing != null) ...<Widget>[
          const SizedBox(width: 8),
          widget.trailing!,
        ],
      ],
    );

    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;

    // `widget.onTap != null` is re-checked rather than trusted. `onHover` is
    // only wired on the tappable branch below, but a rebuild can take `onTap`
    // away while the pointer is still inside the row, and a row that has stopped
    // being a control must not keep painting a control's hover.
    final bool hovered = _hovered && widget.onTap != null;

    // 🖥 THE DESKTOP ROW — see the class doc for why this reads the theme's
    // density rather than a width. `baseSizeAdjustment.dy` is the TOTAL height
    // adjustment (-8 for `compact`), so half of it applies per edge: 14 → 10.
    // Clamped at zero because `VisualDensity` legitimately goes to -4 on both
    // axes (`minimumDensity`, theme_data.dart:3195), which would take scan's
    // `padding: 11` negative and assert inside EdgeInsets.
    final double verticalPadding =
        (widget.padding + theme.visualDensity.baseSizeAdjustment.dy / 2).clamp(
          0.0,
          double.infinity,
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
    final Color restFill = isLight
        ? AppColors.surface
        : scheme.surfaceContainerHighest;

    // 🖱 THE HOVER WASH IS COMPOSITED ONTO THE `Material`'S OWN COLOUR RATHER
    // THAN LEFT TO THE INK LAYER, AND THE COLOUR IS THE FRAMEWORK'S OWN TOKEN
    // RATHER THAN AN ALPHA INVENTED HERE. `InkWell` already paints a hover
    // highlight of `ThemeData.hoverColor` — white/black at 0.04, defaulted at
    // `flutter/lib/src/material/theme_data.dart:468` and untouched by
    // `buildAppTheme` — into the Material's ink layer. Compositing that SAME
    // token here is the same pixels by the same arithmetic, but it lands on
    // `Material.color`, the property the resting fill is already pinned on in
    // `test/shared_primitives_test.dart`, instead of in an ink layer a test can
    // only reach with a `paints` matcher. A hover state nothing can assert is
    // how this widget lost its title colour in the first place.
    //
    // ⚠️ `hoverColor: Colors.transparent` below is therefore REQUIRED, not
    // tidiness: without it the ink layer composites the same token a SECOND time
    // on top of this one, so the row lifts by roughly twice the overlay the
    // theme asks for.
    final Color fill = hovered
        ? Color.alphaBlend(theme.hoverColor, restFill)
        : restFill;

    // ⚠️ AND DARK GAINS AN EDGE STEP THE INK LAYER CANNOT GIVE IT: the hairline
    // moves `outlineVariant` → `outline`, the scheme's own two divider weights,
    // so nothing is invented. It is a colour change on a border that is ALREADY
    // THERE at rest, so it costs no layout. Light gets the wash only — its row
    // has no border at rest, and `Border.all` insets its child, so adding one on
    // hover would shift the title 1px as the pointer arrived.
    final Color edge = hovered ? scheme.outline : scheme.outlineVariant;

    final Widget card = Container(
      decoration: isLight
          ? BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              boxShadow: kCardShadow,
            )
          : BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: edge),
            ),
      child: Material(
        color: fill,
        borderRadius: BorderRadius.circular(18),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: widget.onTap,
          hoverColor: Colors.transparent,
          // Wired only on the tappable branch: an inert RowCard (a plain list
          // row with nothing behind it) must not light up under the pointer,
          // for the same reason it does not announce as a button below.
          //
          // ⚠️ THIS CONDITIONAL IS BELT-AND-BRACES AND THE MEASUREMENT SAYS SO:
          // wiring `onHover` unconditionally changed no test outcome (mutation
          // run 2026-08-21), because `InkResponse` is `enabled` only when it has
          // a callback and does not fire `onHover` while disabled. It is kept
          // because it states the intent at the point of wiring — but the
          // property is enforced by the `widget.onTap != null` re-check above,
          // which IS load-bearing and has its own case in
          // `test/shared_primitives_test.dart` ("STOPS being tappable while
          // hovered").
          onHover: widget.onTap == null
              ? null
              : (bool value) => setState(() => _hovered = value),
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: widget.padding,
              vertical: verticalPadding,
            ),
            child: row,
          ),
        ),
      ),
    );

    // 🔴 `InkWell` GIVES A TAP ACTION AND NOT A BUTTON. That distinction is the
    // whole defect on this widget: `InkResponse` wraps its child in
    // `Semantics(onTap: …)`, so the row is activatable — but it carries no
    // `isButton` flag, which is what TalkBack and VoiceOver read to say "button"
    // and what tells a switch/keyboard user this is a control at all. Every
    // subscription row in the app is a RowCard, so the app's single commonest
    // control announced as prose you happen to be able to double-tap. Material's
    // own buttons set the flag explicitly (`ButtonStyleButton` does, which is
    // why [SoftButton] needs nothing here); a bare InkWell does not.
    //
    // ⚠️ AND `MergeSemantics` IS THE OTHER HALF, not tidiness. Without it the
    // row is three or four sibling nodes — title, subtitle, trailing figure —
    // and the flag sits on a parent the reader steps past on its way to them, so
    // a user swipes four times through fragments to hear one row. Merged, the
    // row is one node: "Netflix ₹649 a month, button". The children keep their
    // own text, so nothing is re-stated in Dart and nothing can drift.
    //
    // ⚠️ `button:` IS CONDITIONAL because [onTap] is nullable and RowCard is
    // used inertly (a plain list row with nothing behind it). Announcing
    // "button" for a row that does nothing when activated is the same lie one
    // size down.
    return MergeSemantics(
      child: Semantics(button: widget.onTap != null, child: card),
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

/// A read-only status chip (the savings figure on insights, the two hero counts
/// on home).
///
/// ✅ NO `Semantics` WRAPPER, AND THAT IS THE FINDING RATHER THAN AN OVERSIGHT.
/// It is not interactive — no `onTap`, no gesture, nothing to activate — so
/// `button: true` here would announce a control that does not exist, and a
/// `label:` would be the same string the [Text] below already contributes, read
/// twice. The chip's whole content is that text, which a screen reader reads
/// today with no help from this file. `test/a11y_semantics_test.dart` pins that:
/// the insights savings pill's own value IS reachable in the semantics tree and
/// carries NO button flag.
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
/// calendar's today-pill all paint exactly that pair.
///
/// 🔴 RETRACTED 2026-08-13 — THIS PARAGRAPH USED TO CLEAR THE LABEL AT BOTH
/// GRADIENT ENDS AND THE ARITHMETIC WAS WRONG. It read: "Contrast holds at both
/// gradient ends for the 15px w700 label (4.9:1 on #6459F5, 3.5:1 on #9B6BFF;
/// AA large-text is 3:1)". Both measurements were correct; the RULE cited was
/// not. WCAG 2.1 large-scale text is 18pt (24px), or 14pt (18.66px) when bold —
/// a 15px w700 label is NORMAL text, so its bar is SC 1.4.3's 4.5:1, and 3.5:1
/// was a failure being reported as a pass on the app's primary CTA. A stated
/// threshold is as load-bearing as the number it is compared against.
///
/// Fixed at the token: `AppColors.accent2` moved #9B6BFF → #8950FF (a 5.2%
/// HSL-lightness step, hue and saturation untouched), so the label now measures
/// **4.90:1 at the accent end and 4.51:1 at the accent2 end** — AA at every
/// point of the sweep. `calendar_screen.dart:314`'s white 12px today-pill day
/// number rode the same gradient and is fixed by the same step.
/// Swapping dark to the theme's derived
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
    // 🔴 SAME DEFECT AS [RowCard]'s, ON THE APP'S PRIMARY CTA. This is an
    // `InkWell`, not a `ButtonStyleButton`, so it has a tap action and no
    // `isButton` flag and no enabled state — "Sign in", "Add subscription",
    // "Cancel" and "Go to dashboard" all announced as plain text. `enabled:` is
    // carried too because this button really is disabled mid-flight (scan holds
    // `onPressed: null` until the scan finishes, the add sheet while saving),
    // and a disabled control that still announces as actionable sends somebody
    // tapping at nothing.
    return MergeSemantics(
      child: Semantics(
        button: true,
        enabled: onPressed != null,
        child: SizedBox(
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
/// ✅ NO `Semantics` WRAPPER HERE EITHER, AND FOR THE OPPOSITE REASON TO [Pill]:
/// it is interactive and it is ALREADY ANNOUNCED. This is an [OutlinedButton],
/// i.e. a `ButtonStyleButton`, which wraps itself in
/// `Semantics(container: true, button: true, enabled: …)` — the very thing
/// [GradientButton] and [RowCard] had to be given by hand because they are bare
/// `InkWell`s. Adding a second wrapper would nest a duplicate button node inside
/// Material's own. `test/a11y_semantics_test.dart` asserts the flag is there
/// rather than asserting that this file put it there, so the day Material stops
/// providing it the test goes red instead of the app going silent.
///
/// ⚠️ [color] BECAME NULLABLE, AND THE DEFAULT IS THE ONLY THING THAT MOVED.
/// It used to default to `AppColors.ink`, which is a light literal baked into
/// the signature where no `BuildContext` exists — a const default cannot consult
/// the theme, so the brightness fix HAS to live in `build`. Null now means
/// "resolve it", and an explicit [color] is still honoured verbatim in both
/// brightnesses, because a caller that passes one is choosing an accent
/// (`settings_screen.dart:671` passes `AppColors.danger` for the delete-account
/// row) rather than asking for default prose. Every call site that omitted it
/// renders the identical `AppColors.ink` in light.
///
/// (That example read `consent_prompt.dart passes AppColors.accent for "Allow"`
/// until that widget was deleted on 2026-08-10. The behaviour is unchanged and
/// still has a real caller — but a doc comment naming a file nobody can open is
/// how a symbol survives its last real caller, which is the exact defect that
/// deletion was cleaning up.)
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

/// The Nikatru full lockup — now [BrandWordmark]'s, with this app's company
/// name.
///
/// 📌 MOVED 2026-09-04 [backlog P-3]. The widget itself is
/// `packages/design_system/lib/src/widgets/brand_lockup.dart`; what is left
/// here is the ADAPTER that supplies the one thing the package may not know —
/// the accessible name, which is copy. The doc on [PoweredByNikatru] below
/// carries the measurement that justified the move.
class NikatruWordmark extends StatelessWidget {
  const NikatruWordmark({super.key, this.height = 22, this.onDark = false});

  final double height;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return BrandWordmark(
      height: height,
      onDark: onDark,
      semanticLabel: AppConfig.companyName,
    );
  }
}

/// Publisher co-branding — now [BrandFooter]'s, with this app's strings.
///
/// 📌 MOVED 2026-09-04 [backlog P-3], AND THE OLD DOC HERE WAS WRONG. It read
/// *"Company name + URLs come from [AppConfig] so every portfolio app
/// inherits"*. Measured on the day of the move:
/// `grep -rn "PoweredByNikatru" tooling/bricks/` returned NOTHING. No stamped
/// app inherited any of it, because the inheritance ran through THIS file,
/// which is `apps/subly`'s and which no other app can see. Reading `AppConfig`
/// made the widget parameterised, not shared.
///
/// Two measured fixes were trapped in here with it — the dark-ground contrast
/// branch (the old `onDark: false` arm painted the light literal
/// [AppColors.muted] at 3.74:1 on the dark scaffold) and the keyboard fix that
/// turned three dead `Semantics(link:)` spans into `FocusableTap`s. A stamped
/// app got neither. Both now live in `packages/design_system`; the reasoning
/// for each moved with them, in `brand_lockup.dart`.
///
/// WHAT STAYED, AND WHY IT HAD TO
/// · The COPY. Every user-visible string is a REQUIRED parameter on the package
///   widget with no English default — `tooling/ci/assert-no-hardcoded-strings
///   .mjs` scans the brick and `apps/subly/lib` (:119-131) and NOT `packages/`,
///   so a default sentence over there is a shipped literal that escaped the
///   guard by moving house. Same rule the `AuthField` move set (4e4b1a50).
/// · [openExternalUrl]. `packages/design_system` has no `url_launcher`
///   dependency and must not grow one, so [BrandFooterLink] takes a callback
///   and this file supplies it.
///
/// 🔴 `poweredByLine` IS RESOLVED HERE, NOT PASSED AS TWO NAMES. It is a
/// placeholder key rather than a concatenation because the Tamil value reads
/// "{company} வழங்கும் {app}" — the two names swap places. Handing the package
/// `appName` and `companyName` to join with the word "by" would have produced
/// word salad in every language whose order differs from English, and would
/// have put that English word in the package the string guard does not scan.
///
/// ⚠️ `showLinks: false` NOW MEANS "PASS NO LINKS". The package renders the
/// legal row only when the list is non-empty, so there is no way to ask it for
/// a row with nothing in it. The rendered output for both arms is unchanged;
/// `test/brand_footer_parity_test.dart` pins the whole tree, in both
/// brightnesses, against a digest captured BEFORE the move.
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
    final AppLocalizations l10n = AppLocalizations.of(context);
    return BrandFooter(
      onDark: onDark,
      wordmarkSemanticLabel: AppConfig.companyName,
      poweredByLine: l10n.poweredByLine(
        AppConfig.appName,
        AppConfig.companyName,
      ),
      links: showLinks
          ? <BrandFooterLink>[
              // The SHORT forms, deliberately not the chassis `privacyPolicy` /
              // `termsOfService` keys: three of these plus two separators share
              // one line, so the values differ from the long-form ones by
              // design.
              BrandFooterLink(
                label: l10n.linkPrivacyShort,
                onTap: () => openExternalUrl(AppConfig.privacyUrl),
              ),
              BrandFooterLink(
                label: l10n.linkTermsShort,
                onTap: () => openExternalUrl(AppConfig.termsUrl),
              ),
              BrandFooterLink(
                label: l10n.linkRefundShort,
                onTap: () => openExternalUrl(AppConfig.refundUrl),
              ),
            ]
          : const <BrandFooterLink>[],
    );
  }
}
