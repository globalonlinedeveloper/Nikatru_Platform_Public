import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';
import 'app_monogram.dart';
import 'app_scaffold.dart' show AppBreakpoints;
import 'content_pane.dart';

/// ⏱ 2026-09-29 · ST-D10 (canvas v2: `SignIn`, `SignUp`, `CheckInbox`,
/// `VerifyEmail`, `ResetPassword`, `ResetExpired`, `ReacceptTerms`,
/// `DesktopSignIn`). The ONE frame every auth surface stands in — the app's
/// forks and the chassis views alike — so the seven screens differ only in the
/// controls they carry, never in how the page is built.
///
/// What it owns, and why each belongs to the frame rather than the screen:
///   · THE PAGE. Scaffold, SafeArea, scroll, the 420 form cap and TOP alignment
///     (`ContentPane.form`): an inline error or a toggled arm must never slide
///     the field the user is about to correct out from under the cursor.
///   · THE HEADING, AS A HEADING. The title is `header` + `namesRoute`, which is
///     what the `AppBar` title it replaces gave a screen reader — the canvas
///     draws no app bar, and dropping it must not drop the route's name.
///   · BACK. Shown exactly where an `AppBar` would have implied it (the route
///     can pop), unless the screen is a gate that must not offer one.
///   · THE SPLIT. At [splitFrom] and wider, a caller-supplied [panel] takes the
///     leading side (`DesktopSignIn`); without one the form stays centred.
///
/// Everything painted comes from the scheme, the type ramp, `AppSpacing` and
/// `AppRadius` — no colour, size or type literal (ST-D0).
class AuthFrame extends StatelessWidget {
  const AuthFrame({
    super.key,
    required this.title,
    required this.children,
    this.titleKey,
    this.subtitle,
    this.brand,
    this.icon,
    this.notices = const <Widget>[],
    this.panel,
    this.showBack = true,
    this.inset = const EdgeInsets.all(AppSpacing.xl),
  });

  /// The width from which a supplied [panel] splits the page — the LARGE class,
  /// the same edge `AppScaffold` collapses its rail at (ADR 083 §5).
  static const double splitFrom = AppBreakpoints.large;

  /// The panel's share of the window at the split, capped at [panelMaxWidth]:
  /// at 1200 the form side keeps 1200 × 0.55 = 660, the 420 cap plus gutters.
  static const double panelFraction = 0.45;
  static const double panelMaxWidth = 620;

  static const Key panelKey = Key('authFramePanel');
  static const Key backKey = Key('authFrameBack');

  final String title;
  final Key? titleKey;
  final String? subtitle;

  /// The brand lockup above the title (`SignIn`, `SignUp`). Null draws none.
  final AuthBrand? brand;

  /// A glyph above the title (`CheckInbox`'s envelope). Decorative.
  final IconData? icon;

  /// Answers to something that happened elsewhere (a deletion outcome, a
  /// failed link) — ABOVE the title, because they are read first.
  final List<Widget> notices;

  final List<Widget> children;

  /// The leading half of the split at [splitFrom] and wider.
  final Widget? panel;

  /// False for a gate the user must answer (re-accept terms, verify email).
  final bool showBack;

  /// Around the form, outside the 420 cap — so the cap engages at 420 plus
  /// this, and a phone narrower than that renders exactly as before the cap.
  final EdgeInsets inset;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final bool canPop =
        showBack && (ModalRoute.of(context)?.impliesAppBarDismissal ?? false);
    final Widget form = SingleChildScrollView(
      padding: inset,
      child: ContentPane.form(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            if (canPop)
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: BackButton(key: AuthFrame.backKey),
              ),
            if (brand case final AuthBrand b) ...<Widget>[
              _BrandRow(brand: b),
              const SizedBox(height: AppSpacing.xl),
            ],
            ...notices,
            if (icon case final IconData glyph) ...<Widget>[
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: AppMonogram.icon(glyph, size: AppMonogram.large),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
            Semantics(
              header: true,
              namesRoute: true,
              child: Text(
                title,
                key: titleKey,
                style: theme.textTheme.headlineMedium?.copyWith(
                  color: theme.colorScheme.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (subtitle case final String line) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              Text(
                line,
                style: theme.textTheme.bodyLarge?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.xl),
            ...children,
          ],
        ),
      ),
    );
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints c) {
          final Widget? side = panel;
          if (side == null || c.maxWidth < splitFrom) {
            return SafeArea(child: form);
          }
          final double width = (c.maxWidth * panelFraction).clamp(
            0,
            panelMaxWidth,
          );
          return Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              SizedBox(key: AuthFrame.panelKey, width: width, child: side),
              Expanded(
                child: SafeArea(child: Center(child: form)),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The brand lockup an auth screen opens with: a mark tile and the product's
/// name. The mark is decoration — the name beside it already says it.
@immutable
class AuthBrand {
  const AuthBrand({required this.mark, required this.name});

  /// One or two letters on the tile.
  final String mark;
  final String name;
}

class _BrandRow extends StatelessWidget {
  const _BrandRow({required this.brand});

  final AuthBrand brand;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Row(
      children: <Widget>[
        AppMonogram(text: brand.mark),
        const SizedBox(width: AppSpacing.md),
        Flexible(
          child: Text(
            brand.name,
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.onSurface,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
      ],
    );
  }
}

/// The leading half of the wide split (`DesktopSignIn`): the product's promise
/// on the inverse surface. The words are the app's; the frame is shared.
class AuthBrandPanel extends StatelessWidget {
  const AuthBrandPanel({
    super.key,
    required this.brand,
    required this.headline,
    this.body,
    this.footnote,
  });

  final AuthBrand brand;
  final String headline;
  final String? body;
  final String? footnote;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    // Inverse in light (the canvas's ink panel beside a light form); in dark
    // the form already sits on ink, so the panel steps UP one container
    // instead of inverting into a white slab.
    final bool light = theme.brightness == Brightness.light;
    final Color fill = light ? scheme.inverseSurface : scheme.surfaceContainer;
    final Color ink = light ? scheme.onInverseSurface : scheme.onSurface;
    return ColoredBox(
      color: fill,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xxxl),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              ExcludeSemantics(
                child: Text(
                  brand.name,
                  style: theme.textTheme.titleMedium?.copyWith(
                    color: ink,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
              Text(
                headline,
                style: theme.textTheme.displaySmall?.copyWith(
                  color: ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (body case final String words) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                Text(
                  words,
                  style: theme.textTheme.bodyLarge?.copyWith(color: ink),
                ),
              ],
              if (footnote case final String note) ...<Widget>[
                const SizedBox(height: AppSpacing.xl),
                Text(
                  note,
                  style: theme.textTheme.bodyMedium?.copyWith(color: ink),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// "or" between the password door and the provider doors. The caption is the
/// sentence's other half, so callers render it only with the doors after it.
class AuthOrDivider extends StatelessWidget {
  const AuthOrDivider({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Row(
      children: <Widget>[
        const Expanded(child: Divider()),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          child: Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
        const Expanded(child: Divider()),
      ],
    );
  }
}

/// An inline answer on an auth form — the error under the fields, a "sent"
/// line — in place of a SnackBar that vanished before it was read and was tied
/// to nothing (M1 §2.26 gap "errors arrive only as SnackBars").
///
/// A LIVE REGION, so a screen reader speaks it the moment it appears, without
/// the user having to go looking. [kind] null is a neutral notice.
class AuthMessage extends StatelessWidget {
  const AuthMessage({
    super.key,
    required this.message,
    this.kind,
    this.textKey,
  });

  final String message;
  final StatusKind? kind;

  /// The key the words carry — the anchor a test reads, never the colour.
  final Key? textKey;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final StatusTones tones = StatusTones.of(context);
    final StatusKind? k = kind;
    final Color fill = k == null
        ? scheme.surfaceContainerHighest
        : tones.tintOf(k);
    final Color ink = k == null ? scheme.onSurface : tones.toneOf(k);
    final IconData glyph = switch (k) {
      StatusKind.danger => Icons.error_outline,
      StatusKind.warn => Icons.schedule,
      StatusKind.positive => Icons.check_circle_outline,
      null => Icons.info_outline,
    };
    return Semantics(
      liveRegion: true,
      container: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: fill,
          borderRadius: BorderRadius.circular(AppRadius.control),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              ExcludeSemantics(child: Icon(glyph, color: ink)),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  message,
                  key: textKey,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: k == null ? scheme.onSurface : ink,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Where one password rule stands. [pending] is "not known yet" — the breach
/// check is the server's, so it stays pending until the server has answered.
enum AuthRuleState { pending, met, failed }

@immutable
class AuthRule {
  const AuthRule({required this.label, required this.state});

  final String label;
  final AuthRuleState state;
}

/// The password requirement checklist under a new-password field (`SignUp`).
///
/// It SHOWS the rules; it enforces none. The sign-up handler keeps its own
/// length refusal and the server keeps the breach check — this is where the
/// user reads them before they are refused, not a second gate.
class AuthPasswordChecklist extends StatelessWidget {
  const AuthPasswordChecklist({super.key, required this.rules});

  final List<AuthRule> rules;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final StatusTones tones = StatusTones.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (final AuthRule r in rules)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs),
            child: Row(
              children: <Widget>[
                ExcludeSemantics(
                  child: Icon(
                    switch (r.state) {
                      AuthRuleState.met => Icons.check_circle,
                      AuthRuleState.failed => Icons.cancel,
                      AuthRuleState.pending => Icons.radio_button_unchecked,
                    },
                    size: AppSpacing.lg,
                    color: switch (r.state) {
                      AuthRuleState.met => tones.positive,
                      AuthRuleState.failed => tones.danger,
                      AuthRuleState.pending => scheme.onSurfaceVariant,
                    },
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    r.label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: switch (r.state) {
                        AuthRuleState.failed => tones.danger,
                        _ => scheme.onSurfaceVariant,
                      },
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
