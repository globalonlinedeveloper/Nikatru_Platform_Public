import 'package:flutter/material.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// A labelled, dismissible in-app promotional card — [research/44 §4.3, §6].
///
/// ## Why it takes its decision from the caller
/// Exactly [PaywallGate]'s shape (`PaywallGate(locked: …)`), and for exactly the
/// same reason: `design_system` must gain no domain dependency and no l10n
/// dependency. Every word arrives as a parameter, the SHOW/HOLD answer arrives
/// as [show], and this file knows nothing about config documents, entitlements,
/// offerings or frequency governors. The decision is
/// `core.PromoGate.decide(…)`'s and the caller's; the pixels are this file's.
///
/// ## The five rules from research/44 §6 that are STRUCTURAL here, not advisory
/// A rule that lives only in a comment is a rule the next caller breaks. These
/// five are enforced by the SHAPE OF THE API, so breaking them does not compile:
///
/// 1. **ABSOLUTE PRICES ONLY.** [priceLabel] is one opaque string and there is
///    no second price field — no `wasPrice`, no `discountPercent`, no
///    `savingsLabel`. EU Directive 98/6/EC Art 6a plus CJEU **C-330/23** (Aldi
///    Süd) require any announced reduction to be calculated against the lowest
///    price of the prior 30 days, and **this repository holds no price
///    history**, so the comparison cannot be computed and therefore must not be
///    displayed. A `wasPrice` parameter would be an invitation to ship an
///    unlawful creative in a locale nobody on this side of the build reads. The
///    caller derives [priceLabel] from `Offering.formattedPrice` — "a displayed
///    price that cannot disagree with the price the buyer is charged is not a
///    price; it is a decoration" (`packages/purchases/lib/src/offering.dart`).
///
/// 2. **NO COUNTDOWN, NO SCARCITY.** There is no `expiresAt`, no `Duration`, no
///    timer and no clock anywhere in this file. UCPD Annex I(7) makes false
///    urgency unfair *in all circumstances* — no disclosure cures it — and
///    India's CCPA Dark Patterns Guidelines 2023 name it directly. A timer that
///    resets per session is the exact failing case, and the cheapest way never
///    to ship one is to have nowhere to put it.
///
/// 3. **THE CARD CANNOT OPEN ITS OWN URL.** There is no `Uri`, no link and no
///    launcher parameter — only [onPrimaryAction]. Every offer link resolves to
///    the apex buy surface through the one hosted rail (ADR 038 · research/44
///    V14); a second checkout would be a second merchant of record, with its own
///    VAT/GST posture, which ADR 038/039 lock against.
///
/// 4. **ROSCA PARITY IS NOT OPTIONAL.** [manageLabel] and [onManageAction] are
///    `required` and non-nullable, so a card that offers a way to start paying
///    and no equally-adjacent way to stop **does not compile**. Everything else
///    on this surface may be absent; that one may not.
///
/// 5. **IT IS DISMISSIBLE AND THE DECLINE COPY IS NEUTRAL.** The close control
///    is a real 48 px target, and [dismissLabel] is a plain "Not now" the caller
///    supplies from l10n — never confirm-shaming ("No thanks, I don't want to
///    save"), which India's CCPA guidelines name as a dark pattern. Latching the
///    dismissal is the caller's job (`PromoGateState.dismissed`), because this
///    widget persists nothing.
///
/// ## And it is LABELLED
/// One visible label plus a distinct container satisfies Apple 2.5.18, Microsoft
/// Store 10.10.4, Play's native-ads trigger and India's Disguised Advertisement
/// pattern simultaneously — one chassis rule, four regimes. [label] is required
/// for that reason. It is deliberately NOT the string "Ad": a same-app upgrade
/// card matches none of Play's three ads triggers (research/44 V2), so the
/// caller supplies the honest word for what this is, and the widget only
/// guarantees that SOMETHING distinguishing is drawn.
///
/// ## Fail closed
/// [show] false renders `SizedBox.shrink()` — zero height, zero pixels, no
/// `Padding`, no divider, nothing that could reserve space in a `Column`. The
/// slot COLLAPSES. That matters because the caller's `features.promo_card_enabled`
/// is absent by default (research/44 §4.5), so this is the state every stamped
/// app is in on the day it is born and the state it stays in until an operator
/// deliberately turns a campaign on.
class PromoCard extends StatelessWidget {
  const PromoCard({
    super.key,
    required this.show,
    required this.label,
    required this.title,
    required this.message,
    required this.manageLabel,
    required this.onManageAction,
    this.priceLabel,
    this.primaryActionLabel,
    this.onPrimaryAction,
    this.dismissLabel,
    this.onDismiss,
    this.dismissSemanticLabel,
  });

  /// Stable handles for the three controls.
  ///
  /// 🔴 THEY EXIST SO A TEST CAN NAME A CONTROL WITHOUT NAMING ITS COPY, and
  /// that is not a convenience. The words on this card are l10n in one app and
  /// a server-side `AppConfig.copy` override in the next, so a test that looks
  /// for a string is a test that breaks when a campaign changes wording — and,
  /// worse in the chassis, one that smuggles an app's domain vocabulary into
  /// shared code (`assert-no-clone-tells.mjs` [C-10] fails the build on exactly
  /// that, and it caught this file's first property test doing it).
  static const Key primaryActionKey = Key('promo_card.primary');
  static const Key manageActionKey = Key('promo_card.manage');
  static const Key dismissActionKey = Key('promo_card.dismiss');
  static const Key closeControlKey = Key('promo_card.close');

  /// Whether to render at all. The caller's decision, never this widget's.
  ///
  /// False ⇒ nothing is drawn and the slot has no height.
  final bool show;

  /// The promotional label — the visible marker that says what this surface is.
  /// Drawn in its own row above the title, never inline with the copy, because
  /// "clearly distinguishable from other content" is about position as much as
  /// wording.
  final String label;

  final String title;
  final String message;

  /// The absolute price, already formatted by the caller from the rail's own
  /// amount and currency. Null when the rail has nothing sellable to quote —
  /// in which case the card still says its piece and simply quotes no number,
  /// which is honest. NEVER a percentage and never a "was" price; see rule 1.
  final String? priceLabel;

  /// The call to action. BOTH the label and the callback must be non-null for a
  /// button to appear: a labelled button that does nothing is worse than no
  /// button, and a callback with no label cannot be drawn.
  ///
  /// 🔒 The caller hides this by passing null when
  /// `PurchaseCapabilities.canStartCheckout` is false — which is the state on
  /// `ios-appstore`, `macos-appstore` and `android-play` (ADR 039 D3 ·
  /// research/44 V13). A card that offers to sell where the store forbids
  /// selling is a documented rejection cause, not a cosmetic slip.
  final String? primaryActionLabel;
  final VoidCallback? onPrimaryAction;

  /// The manage/cancel entry. REQUIRED — see rule 4.
  final String manageLabel;
  final VoidCallback onManageAction;

  /// Neutral decline copy, e.g. "Not now". Shown as a text button beside the
  /// close control when both it and [onDismiss] are supplied.
  final String? dismissLabel;
  final VoidCallback? onDismiss;

  /// What a screen reader announces for the icon-only close control. Falls back
  /// to [dismissLabel]; an icon-only control with neither is unusable, so the
  /// icon is not drawn at all in that case rather than drawn silently.
  final String? dismissSemanticLabel;

  @override
  Widget build(BuildContext context) {
    // ⚠️ FIRST STATEMENT, AND NOTHING IS READ BEFORE IT. `Theme.of(context)`
    // above this line would make the hidden case do work — small, but it runs
    // on every rebuild of a home body for the entire life of every app that
    // never runs a campaign, which is all of them today.
    if (!show) return const SizedBox.shrink();

    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final String? closeLabel = dismissSemanticLabel ?? dismissLabel;

    return Padding(
      // The gutter is the caller's page inset elsewhere; here it is the card's
      // own breathing room inside whatever column it was dropped into.
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          // The same cap `PaywallGate` uses. A promotional card stretched across
          // a 1920 px window is not a card, and the width decision belongs to
          // the chassis rather than to fifty home screens.
          constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
          child: Card(
            // 🔴 A DISTINCT CONTAINER, NOT THE PAGE'S OWN SURFACE. The outlined
            // variant is the point: the four regimes above all ask for the same
            // thing in different words — a promotional surface must not be
            // styled as app content. Sharing `RowCard`'s fill would make this
            // read as another row of the user's own data.
            margin: EdgeInsets.zero,
            color: scheme.surfaceContainerHighest,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: scheme.outlineVariant),
            ),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          label,
                          style: theme.textTheme.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            letterSpacing: 0.8,
                          ),
                        ),
                      ),
                      // The close control. 48 px, the chassis floor for an
                      // icon-only target, and wrapped in Semantics because an
                      // icon-only control a screen reader cannot name is a
                      // control that user does not have.
                      // 🔴 THE CLOSE CONTROL, AND THE THREE SHAPES THAT DID NOT
                      // WORK — measured against the compiled semantics tree,
                      // not reasoned about.
                      //
                      //   · `Semantics(label:…, child: IconButton(…))` — the
                      //     label merged UPWARD into the card's text node and
                      //     the button's own node kept an EMPTY name. A screen
                      //     reader then hears the words somewhere in the prose
                      //     and reaches an unnamed control separately.
                      //   · adding `excludeSemantics: true` — same, plus the
                      //     tap action disappears with the node it lived on.
                      //   · wrapping the pair in `MergeSemantics` — the label
                      //     and the action finally land together, and
                      //     `IconButton`'s inner node SURVIVES as a nested
                      //     tappable with no name: a NAKED CONTROL by
                      //     `apps/subly/test/a11y_semantics_test.dart`'s own
                      //     definition, hidden inside a control that reads
                      //     correctly.
                      //
                      //   · `Semantics(…, child: InkResponse(…))` without the
                      //     merge — worst of the four: `InkResponse` forces no
                      //     node of its own, so the label AND the tap action
                      //     merged into the card's text node and the WHOLE
                      //     CARD became one 420×172 tappable thing.
                      //
                      // What works is all three together: `MergeSemantics`
                      // forces a node to exist (so nothing escapes upward),
                      // `Semantics` names it and gives it the button role, and
                      // `InkResponse` contributes the tap without insisting on
                      // a node of its own — leaving ONE 48×48 node carrying the
                      // name, the role and the action, and no nested nameless
                      // one. 48 px is the chassis floor for an icon-only
                      // target. Verified against the compiled tree in
                      // `test/promo_card_test.dart`.
                      if (onDismiss != null && closeLabel != null)
                        MergeSemantics(
                          child: Semantics(
                            key: closeControlKey,
                            button: true,
                            label: closeLabel,
                            child: InkResponse(
                              onTap: onDismiss,
                              radius: 24,
                              child: const SizedBox(
                                width: 48,
                                height: 48,
                                // Deliberately NOT a badge, alert or
                                // notification affordance: simulating system UI
                                // is banned outright by Play's Deceptive Ads
                                // policy, and a promotional surface wearing
                                // system chrome is the paradigm case.
                                child: Icon(Icons.close, size: 20),
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(title, style: theme.textTheme.titleMedium),
                        const SizedBox(height: 4),
                        Text(message, style: theme.textTheme.bodySmall),
                        if (priceLabel != null) ...<Widget>[
                          const SizedBox(height: 8),
                          Text(
                            priceLabel!,
                            style: theme.textTheme.titleSmall?.copyWith(
                              color: scheme.primary,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  // `Wrap`, not `Row`: three intrinsic-width controls overflow a
                  // narrow card where a Wrap folds to a second line. Same fix,
                  // same reason, as the hero pills and the PoweredByNikatru
                  // legal links.
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: <Widget>[
                      if (primaryActionLabel != null && onPrimaryAction != null)
                        FilledButton(
                          key: primaryActionKey,
                          onPressed: onPrimaryAction,
                          child: Text(primaryActionLabel!),
                        ),
                      // 🔒 ROSCA PARITY, IN THE SAME ROW AS THE BUY CONTROL.
                      // Equal prominence is the substance of the rule: a cancel
                      // entry one level deeper survives an equal hop count and
                      // is exactly the pattern ROSCA exists to stop
                      // (`tooling/ci/assert-purchase-path.mjs`).
                      TextButton(
                        key: manageActionKey,
                        onPressed: onManageAction,
                        child: Text(manageLabel),
                      ),
                      if (dismissLabel != null && onDismiss != null)
                        TextButton(
                          key: dismissActionKey,
                          onPressed: onDismiss,
                          child: Text(dismissLabel!),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
