import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show FocusableTap, TapRole;
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';

/// The two tick boxes every sign-up surface must carry, and the one place their
/// rules live.
///
/// Adopted from research/43's SPLIT verdict (owner, 2026-08-09 night) and
/// research/44's rider ([ADR 040]). Born into the BRICK so every stamped app
/// inherits a compliant sign-up rather than reinventing one — the same reason
/// `SignInScreen` lives here. Two boxes, two completely different legal
/// characters, and mixing them up is the failure mode:
///
///   · TERMS — MANDATORY and BLOCKING. Unticked on arrival; the submit control
///     stays disabled until it is ticked. A clickwrap is an affirmative act
///     against named documents, taken before the account exists.
///   · MARKETING EMAIL — OPTIONAL and NON-BLOCKING. Unticked on arrival, and it
///     must be possible to sign up without touching it. Gating sign-up on an
///     optional consent is GDPR Art 7(4) conditionality, which the same research
///     declined as legally unavailable in every target market — not as taste.
///
/// 🔴 NEITHER MAY EVER BE PRE-TICKED, and this widget cannot be asked to.
/// [termsAccepted] / [marketingAccepted] come in from the caller and there is no
/// `initial…` argument: the state lives in the parent, which starts it false,
/// and `tooling/ci/assert-signup-consent-shape.mjs` fails the build if any
/// sign-up surface — in this template or in any app — initialises either flag to
/// true. Pre-ticked or uncheckable consent is dark-pattern territory under
/// Planet49/EDPB, DPDP Rules 2025 and CPRA alike.
///
/// ⚠️ THE LINKS OPEN THE LIVE PAGES. `AppConfig.termsUrl` / `privacyUrl` are the
/// text the user is bound by; an embedded copy is a second version of a legal
/// document that nothing keeps in step with the published one.
class LegalConsentFields extends StatelessWidget {
  const LegalConsentFields({
    super.key,
    required this.termsAccepted,
    required this.marketingAccepted,
    required this.onTermsChanged,
    required this.onMarketingChanged,
    this.enabled = true,
    this.showMarketing = true,
  });

  final bool termsAccepted;
  final bool marketingAccepted;
  final ValueChanged<bool> onTermsChanged;
  final ValueChanged<bool> onMarketingChanged;
  final bool enabled;

  /// The re-acceptance interstitial re-takes the TERMS and nothing else.
  ///
  /// Re-asking for a marketing opt-in every time the policy changes turns a
  /// legally required notice into a repeated sales prompt, on a screen the user
  /// cannot leave. Their existing `marketing-email` artifact stands untouched.
  final bool showMarketing;

  static const Key termsCheckbox = Key('legalConsentTerms');
  static const Key marketingCheckbox = Key('legalConsentMarketing');

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _Row(
          checkboxKey: termsCheckbox,
          value: termsAccepted,
          enabled: enabled,
          onChanged: onTermsChanged,
          // ONE COMPLETE SENTENCE PER KEY, with the document links as separate
          // controls beneath it rather than spans inside it. A rich-text "I
          // agree to the [Terms] and [Privacy Policy]" fixes English word order
          // and leaves a translator splicing links into the middle of a clause
          // whose verb belongs at the end.
          label: l10n.legalAcceptTerms,
          links: <Widget>[
            _LegalLink(l10n.termsOfService, AppConfig.termsUrl),
            _LegalLink(l10n.privacyPolicy, AppConfig.privacyUrl),
          ],
        ),
        if (showMarketing) ...<Widget>[
          const SizedBox(height: 8),
          _Row(
            checkboxKey: marketingCheckbox,
            value: marketingAccepted,
            enabled: enabled,
            onChanged: onMarketingChanged,
            label: l10n.legalMarketingOptIn,
          ),
        ],
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.checkboxKey,
    required this.value,
    required this.enabled,
    required this.onChanged,
    required this.label,
    this.links = const <Widget>[],
  });

  final Key checkboxKey;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;
  final String label;
  final List<Widget> links;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    // The label SENTENCE is a second tap target for the box: a 20 px square is
    // below every platform's minimum touch size, and a checkbox whose only hit
    // area is the box itself is how people tick the wrong one.
    //
    // ⚠️ THE SENTENCE, NOT THE WHOLE COLUMN. This detector used to wrap the
    // Column — links and all — so A TAP IN THE GUTTER BESIDE "Privacy" TICKED
    // THE CONSENT BOX instead of opening the document. That is a legal
    // acceptance recorded by a mis-tap, on the one control that blocks
    // registration, and it is the worst of the three defects fixed here. Both
    // consent strings still wrap at 375 px and so still fill the width, keeping
    // their hit area; the 12 px strip above and the links gutter below
    // deliberately no longer toggle.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        // 🔴 `semanticLabel` IS THE NAME OF THIS CONTROL AND IT WAS MISSING.
        // A bare `Checkbox` contributes a node with a CHECKED state and NO
        // label, so a stamped app's only clickwrap announced as "not checked,
        // checkbox" — a legally blocking control whose subject a reader is
        // never told. The sentence beside it is not a substitute: it sits on a
        // DIFFERENT node, which a reader reaches on a separate swipe and can
        // just as easily reach afterwards.
        Checkbox(
          key: checkboxKey,
          value: value,
          onChanged: enabled ? (bool? v) => onChanged(v ?? false) : null,
          semanticLabel: label,
        ),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // 🔴 THE LABEL IS A SECOND HIT TARGET FOR THE BOX, NOT A SECOND
                // CONTROL — so it is excluded from the semantics tree rather
                // than annotated. Its `GestureDetector` contributed a TAP
                // ACTION with no role and no state: a node announced as prose
                // that happens to respond, sitting next to the real checkbox
                // and doing the same thing. Naming it as a second checkbox
                // would be worse — two nodes claiming one tick, and a reader
                // with no way to know they are the same box. The sentence is
                // spoken ONCE, by the control that owns it.
                //
                // ⚠️ THE EXCLUSION WRAPS THE DETECTOR, NOT THE TEXT. Inside it,
                // the detector's own tap action survives into the tree and the
                // node is merely nameless — worse than before, not better.
                ExcludeSemantics(
                  child: GestureDetector(
                    onTap: enabled ? () => onChanged(!value) : null,
                    behavior: HitTestBehavior.opaque,
                    child: Text(label, style: theme.textTheme.bodyMedium),
                  ),
                ),
                // ⚠️ AND THE LINKS STAY OUTSIDE THAT EXCLUSION, which is why
                // the detector no longer wraps them. Excluding a detector that
                // covered this whole column would have taken both `link` nodes
                // with it, and left the mis-tap above in place.
                if (links.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 4),
                  Wrap(spacing: 16, runSpacing: 4, children: links),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _LegalLink extends StatelessWidget {
  const _LegalLink(this.label, this.url);

  final String label;
  final String url;

  Future<void> _open() async {
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // Best-effort — a link that will not open must never break sign-up.
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    // 🔴 `FocusableTap`, NOT `Semantics(link: true)` + `GestureDetector` — AND
    // THIS PAIR IS THE MOST POINTED SC 2.1.1 (LEVEL A) FAILURE A STAMPED APP IS
    // BORN WITH. Four instances, because both consent surfaces render this
    // widget: Terms and Privacy on sign-up, and the same two again on
    // re-acceptance. `Semantics(link: true)` tells a screen reader what the
    // control IS and creates no `FocusNode`, so Tab passes straight over all
    // four — A KEYBOARD USER CANNOT OPEN THE DOCUMENT THEY ARE BEING ASKED TO
    // AGREE TO, on the one screen where agreeing is the point and on the gate
    // the router puts in front of every signed-in user when the terms version
    // moves.
    //
    // Measured in this brick on 2026-09-04, before this change:
    // `grep -rc "FocusableTap" tooling/bricks/` -> 0. The primitive had been in
    // `packages/design_system` since 2026-08-25, the brick already depended on
    // that package, and not one control here used it.
    //
    // ⚠️ NOTHING A READER HEARS CHANGES. `role: TapRole.link` re-emits the
    // `Semantics(link: true)` this replaces, unchanged; `link` rather than
    // `button` because the URL goes to the platform browser and "link" is the
    // warning a user wants BEFORE activating something that leaves the app.
    //
    // `deferToChild`, NOT the primitive's `opaque` default: these two sit in a
    // `Wrap` in the gutter beneath the consent sentence, and the note in `_Row`
    // records why that gutter must NOT toggle the box. An opaque box round each
    // link would claim the run spacing between them and widen the target into
    // ground the layout deliberately leaves inert. The pointer behaviour is
    // therefore byte-identical to what it replaced.
    return FocusableTap(
      onTap: _open,
      role: TapRole.link,
      behavior: HitTestBehavior.deferToChild,
      borderRadius: BorderRadius.circular(4),
      child: Text(
        label,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.primary,
          fontWeight: FontWeight.w700,
          decoration: TextDecoration.underline,
        ),
      ),
    );
  }
}
