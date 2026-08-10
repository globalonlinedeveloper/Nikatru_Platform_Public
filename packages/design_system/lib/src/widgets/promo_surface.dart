import 'package:flutter/material.dart';

import 'promo_objection_control.dart';

/// THE FRAME EVERY PROMOTIONAL SURFACE RENDERS THROUGH — the labelled container
/// and the Art 21(4) objection control, bolted together so neither can ship
/// without the other.
///
/// 🔴 WHY A FRAME AND NOT A FLAG ON THE CARD. Two obligations attach to the
/// *first* promotional communication, and both of them are the kind that a
/// creative increment forgets because they are not part of the creative:
///
///   1. **It must be labelled and visually distinct.** research/44 §6: one
///      chassis rule satisfies Apple 2.5.18 (*"must clearly indicate that they
///      are an ad"*), Microsoft 10.10.4 (*"clearly distinguishable from other
///      content"*), Play's native-ads trigger and India's Disguised
///      Advertisement dark pattern simultaneously. An unlabelled promotional
///      surface, or one styled as app content, is on research/44 V5's FORBIDDEN
///      list in all configurations.
///   2. **The objection must be there, on the card.** GDPR Art 21(4) wants the
///      right *"presented clearly and separately from any other information"*
///      **at the latest at the time of the first communication** — not one
///      screen away in Settings, where a person meeting their first offer has no
///      reason to look.
///
/// Passing those as parameters would make them optional in practice. So they are
/// the frame: there is no constructor argument that renders the creative without
/// the label, and none that renders it without the control.
///
/// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
/// It is not the creative. The offer copy, the price (absolute only — research/44
/// V6 forbids "-25%" and "was/now" until a price history exists), the CTA and the
/// **close control with its latched dismissal** (§6, `PromoGateState.dismiss`)
/// belong to the promo-card increment and arrive as [child]. Re-implementing the
/// label or the objection inside that child would be [pipeline C-3]'s "no
/// capability exists twice" in the surface layer.
///
/// It also holds no decision. [show] is the answer `PromoObjection.decide`
/// already gave; this widget never consults a gate, a config or a clock.
class PromoSurface extends StatelessWidget {
  const PromoSurface({
    super.key,
    required this.show,
    required this.objected,
    required this.onObjectionChanged,
    required this.child,
    this.promotionalLabel = 'Promotion',
    this.stopLabel = 'Stop showing offers',
    this.resumeLabel = 'Show offers again',
    this.objectedNotice = 'Offers are off.',
  });

  /// The gate's verdict, resolved by the caller.
  ///
  /// FAIL-CLOSED BY SHAPE: false renders nothing at all — not a collapsed
  /// container, not an empty frame. research/44 §4.5 requires an app that has
  /// never reached the network (`features.promo_card_enabled` absent) to show no
  /// promo, and an objection to end the surface rather than empty it.
  final bool show;

  /// Whether this person has objected. Comes from the consent rail.
  ///
  /// Its FIRST job is to let the control render its own state — the objection is
  /// decided by `PromoObjection`/`PromoGate`, not here, and a second gate in the
  /// widget would be a second place for the objection to live, which is the
  /// exact defect `PromoObjection` exists to prevent.
  ///
  /// 🔴 IT IS NEVERTHELESS A REFUSAL, NOT A DECISION, and the difference is why
  /// this is not the second store. A decision would consult a rail, a clock or a
  /// flag; this widget consults nothing. It only declines to render a
  /// contradiction it was handed: `show && objected` says the gate was told this
  /// person objected and answered "show" anyway, which cannot happen through
  /// `PromoObjection.decide` and can happen through a caller that reached
  /// `PromoGate.decide` directly. The whole point of this frame is that the
  /// promotional creative cannot be rendered without the legal furniture; a leaf
  /// that renders one to somebody who exercised an absolute right to stop it,
  /// because it "trusted the caller", is the same class of failure one widget
  /// further in.
  ///
  /// ⚠️ A REFUSAL RATHER THAN AN `assert`, AND THE REASON IS MEASURED. An
  /// `assert(!(show && objected))` in the constructor was written first and
  /// removed: it throws in every debug build, which is every widget test, so the
  /// RELEASE behaviour — the one that decides whether a person who objected sees
  /// an offer — becomes unreachable from a test. An assertion that makes the
  /// load-bearing path untestable buys a loud debug crash at the price of the
  /// only evidence that the refusal works.
  ///
  /// The loud half lives where it belongs and costs nothing at runtime:
  /// `assert-consent-withdrawal-surface.mjs` limbs 5 and 6 fail the BUILD for
  /// the only caller shape that can produce this contradiction — a `.decide(` on
  /// a promo gate that does not go through `PromoObjection`, or a creative
  /// decided in a file that never names this frame. Found at CI time, on every
  /// branch, whether or not anybody happens to render the path.
  final bool objected;

  /// New objection state: `true` = stop, `false` = resume.
  final ValueChanged<bool> onObjectionChanged;

  /// The creative.
  final Widget child;

  /// The visible promotional label. Localised by the caller.
  final String promotionalLabel;

  final String stopLabel;
  final String resumeLabel;
  final String objectedNotice;

  /// The container, for "did anything promotional render" assertions.
  static const Key rootKey = Key('promo_surface');

  @override
  Widget build(BuildContext context) {
    if (!show || objected) return const SizedBox.shrink();
    final ThemeData theme = Theme.of(context);
    return Container(
      key: rootKey,
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        // A distinct container, not the app's own card styling: "clearly
        // distinguishable from other content" is a rule about what the surface
        // looks like next to the app, so it deliberately does not inherit
        // whatever the host app decided its content cards look like.
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.colorScheme.outlineVariant),
        color: theme.colorScheme.surfaceContainerHighest,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            promotionalLabel,
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              letterSpacing: 0.8,
            ),
          ),
          const SizedBox(height: 8),
          child,
          const SizedBox(height: 4),
          PromoObjectionControl(
            objected: objected,
            onChanged: onObjectionChanged,
            stopLabel: stopLabel,
            resumeLabel: resumeLabel,
            objectedNotice: objectedNotice,
          ),
        ],
      ),
    );
  }
}
