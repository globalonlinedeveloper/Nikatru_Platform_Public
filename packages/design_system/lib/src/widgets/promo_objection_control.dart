import 'package:flutter/material.dart';

/// THE STOP-OFFERS CONTROL — the GDPR **Art 21** objection, as a widget.
///
/// One widget, two homes, deliberately: it is rendered inside every promotional
/// surface (by [PromoSurface]) *and* in Settings. Art 21(4) requires the right
/// to object to be *"explicitly brought to the attention of the data subject
/// and… presented clearly and separately from any other information"* **at the
/// latest at the time of the first communication** — so a control that lived
/// only in Settings would be late for the first card, and one that lived only on
/// the card would vanish the moment the person used it.
///
/// The DECISION lives with the caller (`PaywallGate(locked: …)` shape), so
/// `design_system` gains neither a domain nor an l10n dependency. The English
/// defaults below are the same arrangement `PaywallGate` uses: they exist so the
/// widget is usable and previewable on its own, and every app passes its
/// localised strings over them.
///
/// ── STATE-REFLECTING, NOT A ONE-WAY BUTTON ──────────────────────────────────
/// It renders its current value in both directions. That is a copy of the rule
/// `assert-consent-withdrawal-surface.mjs` limb 3 enforces for the analytics
/// row — *"a toggle whose state the user cannot see is a button that appears to
/// do nothing"* — and Art 21 needs the return path anyway: a person has the
/// right to object, not a duty to stay objected. A control that only travels one
/// way is a trap, not a control.
///
/// ── COPY RULES THE CALLER MUST HONOUR (research/44 V5) ──────────────────────
/// India's CCPA Dark Patterns Guidelines 2023 forbid **confirm-shaming**, so the
/// stop label is a plain statement of what happens ("Stop showing offers") and
/// never "No thanks, I don't want to save money". Nothing here can enforce a
/// string a caller passes in — this paragraph is the enforcement, and the l10n
/// values in both trees are written to it.
/// 🔴 THE COPY IS REQUIRED, NOT DEFAULTED. An English default here is a
/// user-visible literal living in `packages/`, and
/// `tooling/ci/assert-no-hardcoded-strings.mjs` scans exactly two roots — the
/// brick and `apps/subly/lib` (`:119-131`) — not this one. So a default is a
/// shipped string that has left the domain of the only guard that hunts for
/// one. Requiring it puts the string back in a scanned tree, because the
/// caller lives in `apps/` or in the brick.
///
/// ⚠️ EVERY CALL SITE ALREADY PASSED ITS COPY when this changed on 2026-09-04,
/// so nothing about what a user sees moved. The defaults were a SECOND source
/// of truth beside the arb, waiting for a caller that forgot — which is exactly
/// what had happened to [ForceUpdateGate], whose defaults were the only copy
/// any app ever shipped.
class PromoObjectionControl extends StatelessWidget {
  const PromoObjectionControl({
    super.key,
    required this.objected,
    required this.onChanged,
    required this.stopLabel,
    required this.resumeLabel,
    required this.objectedNotice,
    this.known = true,
  });

  /// Whether this person has objected to promotional processing.
  ///
  /// Comes from the consent rail (`ConsentPurpose.promo`), never from a private
  /// flag — see `PromoObjection` in `packages/core`.
  final bool objected;

  /// **Has the rail been read yet?** False for the first frames of every launch.
  ///
  /// 🔴 A CONTROL AND A GATE NEED OPPOSITE ANSWERS IN THIS WINDOW, and collapsing
  /// them is how a settings row forges a decision. A promotional SURFACE must
  /// treat "not read yet" as objected — showing an offer to somebody whose
  /// objection has not been loaded is exactly what Art 21(3) forbids, so the
  /// unresolved rail falls closed. A CONTROL that did the same would tell a
  /// person who has never objected "Offers are off" on every visit to Settings,
  /// and one tap in that window writes — and uploads — a `promo granted: true`
  /// artifact recording a withdrawal they never made. Falling closed protects
  /// them from a card; it does not license a claim about what they chose.
  ///
  /// So the third state renders as neither: a fixed-height blank that reserves
  /// the row and cannot be tapped. It states nothing, because nothing is known.
  /// Deliberately not a spinner — a legal control that appears to be *working*
  /// invites a wait, and this resolves in a frame or two or not at all.
  final bool known;

  /// Called with the NEW objection state: `true` = stop, `false` = resume.
  final ValueChanged<bool> onChanged;

  final String stopLabel;
  final String resumeLabel;

  /// Shown beside the resume action so the off state is legible without the
  /// person having to infer it from the button they are being offered.
  final String objectedNotice;

  /// Drives the objection. One key for the action in BOTH states: a test that
  /// had to know which state it was in before it could find the control would be
  /// asserting on the implementation rather than on the affordance.
  static const Key actionKey = Key('promo_objection_action');

  /// The whole control, for a "is it present at all" assertion.
  static const Key rootKey = Key('promo_objection_control');

  /// Roughly one [TextButton] tall, so the row does not jump when the rail
  /// lands.
  static const double _unknownHeight = 48;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    if (!known) {
      // No labels, no notice, no callback — see [known]. The root key is kept so
      // "the control is present" assertions still hold and a test can catch the
      // window rather than pump past it.
      return const SizedBox(key: rootKey, height: _unknownHeight);
    }
    if (objected) {
      return Row(
        key: rootKey,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Flexible(
            child: Text(objectedNotice, style: theme.textTheme.bodySmall),
          ),
          const SizedBox(width: 8),
          TextButton(
            key: actionKey,
            onPressed: () => onChanged(false),
            child: Text(resumeLabel),
          ),
        ],
      );
    }
    return Align(
      key: rootKey,
      alignment: AlignmentDirectional.centerStart,
      child: TextButton(
        key: actionKey,
        onPressed: () => onChanged(true),
        child: Text(stopLabel),
      ),
    );
  }
}
