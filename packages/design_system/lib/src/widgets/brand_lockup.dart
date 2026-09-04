import 'package:flutter/material.dart';

import '../tokens/app_colors.dart';
import '../tokens/app_text.dart';
import 'focusable_tap.dart';

/// The publisher lockup and the publisher footer — the two pieces of BRAND
/// every app in the portfolio wears, in the one place a portfolio-wide widget
/// can live.
///
/// ── WHY THEY MOVED [backlog P-3] ────────────────────────────────────────────
/// These were `NikatruWordmark` and `PoweredByNikatru` in
/// `apps/subly/lib/features/shared/widgets.dart`, and that file's own doc said
/// of them *"Company name + URLs come from `AppConfig` so every portfolio app
/// inherits"*. Measured on 2026-09-04:
/// `grep -rn "PoweredByNikatru" tooling/bricks/` returned NOTHING, and
/// `grep -rn "FocusableTap" tooling/bricks/` returned nothing either. Not one
/// stamped app inherited a line of it. "Inherits" described an intention, and
/// the inheritance ran through a file no other app can see.
///
/// 🔴 AND TWO MEASURED FIXES WERE TRAPPED IN THERE WITH THEM.
///   1. CONTRAST. [BrandFooter]'s quiet ink used to be the light literal
///      `AppColors.muted` (#6F6F7B) on BOTH brightnesses, which on the dark
///      scaffold #131318 measures 3.74:1 — under SC 1.4.3's 4.5:1 for 12px w700
///      link text. The `onDark == false` arm now resolves through
///      [AppText.of], so dark takes `colorScheme.onSurfaceVariant`.
///      ⚠️ `onDark` IS NOT "the app is in dark mode": it means "this footer is
///      sitting on a dark HERO or gradient" and the caller passes it
///      explicitly. Conflating the two is the bug that produced the 3.74:1
///      reading in the first place, so the two stay separate here.
///   2. KEYBOARD. The three footer links were `Semantics(link: true)` round a
///      `GestureDetector` — a role with no [FocusNode], so `Tab` passed
///      straight over them. They are [FocusableTap] now (SC 2.1.1, Level A).
/// A stamped app got neither. That is the whole argument for the move.
///
/// ── WHAT THE MOVE COULD NOT BRING, AND WHY ──────────────────────────────────
/// EVERY USER-VISIBLE STRING IS A REQUIRED PARAMETER WITH NO ENGLISH DEFAULT.
/// `tooling/ci/assert-no-hardcoded-strings.mjs` scans exactly two roots — the
/// brick and `apps/subly/lib` (:119-131) — and NOT `packages/`. A default
/// sentence here would therefore be a shipped literal that escaped the guard by
/// moving house, so the copy stays in the app and arrives as an argument. Same
/// rule the `AuthField` move set (commit 4e4b1a50).
///
/// The URL OPENER is a parameter too, for a different reason: `packages/
/// design_system` does not depend on `url_launcher` and adding it would make
/// this package an adapter under `assert-package-boundaries.mjs`'s derivation.
/// So [BrandFooterLink] carries a [VoidCallback]; the app keeps its own
/// `openExternalUrl`.
class BrandWordmark extends StatelessWidget {
  const BrandWordmark({
    super.key,
    required this.semanticLabel,
    this.height = 22,
    this.onDark = false,
    this.lightAsset = 'assets/brand/nikatru-logo.png',
    this.darkAsset = 'assets/brand/nikatru-logo-dark-bg.png',
  });

  /// What a screen reader calls the lockup — normally the company name.
  ///
  /// REQUIRED and undefaulted: it is copy, and see the class note on why copy
  /// may not carry a default in this package. An image with no accessible name
  /// is announced as nothing at all, so this is not decoration.
  final String semanticLabel;

  final double height;

  /// The lockup is sitting on a DARK ground (a hero, a brand gradient) and
  /// needs the reversed artwork. Not "the app is in dark mode" — see the class
  /// note.
  final bool onDark;

  /// Asset keys, not copy, so they may default.
  ///
  /// They resolve against the HOST APP's bundle rather than this package's:
  /// there is no `package:` argument on the [Image.asset] below, which is what
  /// makes `assets/brand/…` mean the app's own declared asset. That is
  /// deliberate — a stamped app ships its own artwork under the same key and
  /// needs no code change — and it is also why these are overridable.
  final String lightAsset;
  final String darkAsset;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      onDark ? darkAsset : lightAsset,
      height: height,
      filterQuality: FilterQuality.medium,
      semanticLabel: semanticLabel,
    );
  }
}

/// One link in a [BrandFooter]'s legal row: the word, and what activating it
/// does.
///
/// A callback rather than a URL string because this package cannot open one —
/// see the [BrandWordmark] class note. It also means a host that routes its
/// legal pages in-app rather than out to a browser needs no second widget.
@immutable
class BrandFooterLink {
  const BrandFooterLink({required this.label, required this.onTap});

  /// The word shown. Copy — supplied by the app, never defaulted here.
  final String label;

  final VoidCallback onTap;
}

/// Publisher co-branding: the lockup, the `"<app> by <company>"` line, and an
/// optional row of legal links separated by middots.
///
/// See the [BrandWordmark] class note for why this moved and what came with it.
class BrandFooter extends StatelessWidget {
  const BrandFooter({
    super.key,
    required this.wordmarkSemanticLabel,
    required this.poweredByLine,
    this.links = const <BrandFooterLink>[],
    this.onDark = false,
  });

  /// Passed straight to [BrandWordmark.semanticLabel].
  final String wordmarkSemanticLabel;

  /// The whole publisher sentence, ALREADY RESOLVED by the caller.
  ///
  /// 🔴 A SENTENCE, NOT TWO NAMES TO CONCATENATE. `apps/subly`'s arb carries
  /// this as a placeholder message because the Tamil value reads
  /// "{company} வழங்கும் {app}" — the two names SWAP PLACES. Taking `appName`
  /// and `companyName` here and building `'$app by $company'` would have
  /// produced word salad in every language whose order differs from English,
  /// and would have put an English word ("by") in a package the string guard
  /// does not scan. So the app formats it and hands over the result.
  final String poweredByLine;

  /// Empty means no legal row at all — no separator gap, no [Wrap]. This
  /// replaces the old `showLinks` boolean: the caller that wanted the row off
  /// passes no links, and there is no way to ask for a row with nothing in it.
  final List<BrandFooterLink> links;

  /// This footer sits on a dark hero/gradient. See the [BrandWordmark] note.
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    // The quiet ink. `onDark` keeps its own literal (60% white on a hero);
    // everything else resolves through [AppText], which is what carries the
    // dark branch to `onSurfaceVariant` and lifts the 3.74:1 reading recorded
    // in the [BrandWordmark] note.
    final Color faint = onDark
        ? const Color.fromRGBO(255, 255, 255, 0.6)
        : (AppText.of(context).muted.color ?? AppColors.muted);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        BrandWordmark(onDark: onDark, semanticLabel: wordmarkSemanticLabel),
        const SizedBox(height: 8),
        Text(
          poweredByLine,
          style: AppText.muted.copyWith(fontSize: 12, color: faint),
        ),
        if (links.isNotEmpty) ...<Widget>[
          const SizedBox(height: 8),
          // Wrap, not Row: the links and their separators have no flex, and at
          // narrow widths — or under a wide test font — a Row overflows where a
          // Wrap folds to a second centred line.
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: _row(faint),
          ),
        ],
      ],
    );
  }

  /// link · link · link — separators BETWEEN, never trailing.
  ///
  /// Built from the list rather than hand-written, which is the one structural
  /// change the move makes: `apps/subly` hard-coded exactly three links and two
  /// dots, and a stamped app with two legal pages would have shipped a dangling
  /// middot. For three links this emits the identical five children, which is
  /// what `apps/subly/test/brand_footer_parity_test.dart` pins.
  List<Widget> _row(Color color) {
    final List<Widget> out = <Widget>[];
    for (int i = 0; i < links.length; i++) {
      if (i > 0) out.add(_BrandFooterDot(color));
      out.add(_BrandFooterLink(links[i], color));
    }
    return out;
  }
}

class _BrandFooterDot extends StatelessWidget {
  const _BrandFooterDot(this.color);
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Text('·', style: TextStyle(color: color, fontSize: 12)),
    );
  }
}

class _BrandFooterLink extends StatelessWidget {
  const _BrandFooterLink(this.link, this.color);
  final BrandFooterLink link;
  final Color color;

  @override
  Widget build(BuildContext context) {
    // `TapRole.link`, NOT `button`. Activating this normally leaves the app.
    // Screen readers announce the two differently on purpose, and "link" is
    // exactly the warning a person wants BEFORE activating something on a
    // phone. A bare `GestureDetector` round a `Text` carries neither: it is
    // prose you can happen to tap.
    //
    // 🔴 AND `FocusableTap`, NOT `Semantics(link: true)` — THESE WERE
    // KEYBOARD-DEAD ON TWO SCREENS AT ONCE in the app they came from.
    // `apps/subly/test/keyboard_traversal_test.dart` found them among login's
    // four unreachable controls AND among settings' eighteen, because this
    // footer renders on both: one shared defect counted twice, which is the
    // argument for fixing it in a shared primitive rather than per screen.
    //
    // `deferToChild`, NOT the primitive's `opaque` default: the underlined
    // words ARE the target, and they sit in a `Wrap` beside the separator dots
    // — an opaque box round each would claim the gaps and widen the target into
    // ground the layout leaves inert. The pointer behaviour is therefore
    // byte-identical to what it replaced.
    return FocusableTap(
      onTap: link.onTap,
      role: TapRole.link,
      behavior: HitTestBehavior.deferToChild,
      borderRadius: BorderRadius.circular(4),
      // No `focusColor`: the ring takes the theme's primary rather than
      // [color]. [color] is the deliberately quiet link ink, and a ring painted
      // in it would be a focus indicator the sighted keyboard user has to hunt
      // for — the failure the ring exists to prevent.
      child: Text(
        link.label,
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
