import 'package:flutter/material.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';
import '../shared/widgets.dart' show openExternalUrl;

/// The two tick boxes every sign-up surface must carry, and the one place their
/// rules live.
///
/// Adopted from research/43's SPLIT verdict (owner, 2026-08-09 night) and
/// research/44's rider ([ADR 040]). Two boxes, two completely different legal
/// characters, and mixing them up is the failure mode:
///
///   · TERMS — MANDATORY and BLOCKING. Unticked on arrival; the submit button
///     stays disabled until it is ticked. This is a clickwrap: an affirmative
///     act against named documents, taken before the account exists.
///   · MARKETING EMAIL — OPTIONAL and NON-BLOCKING. Unticked on arrival and it
///     must be possible to sign up without ever touching it. Gating sign-up on
///     an optional consent is GDPR Art 7(4) conditionality, which the same
///     research declined as legally unavailable in every target market — not as
///     a matter of taste.
///
/// 🔴 NEITHER MAY EVER BE PRE-TICKED, and the widget cannot be asked to.
/// [termsAccepted] and [marketingAccepted] come in from the caller, but there is
/// no `initial…` argument here at all: the state lives in the parent, which
/// starts it false, and `tooling/ci/assert-signup-consent-shape.mjs` fails the
/// build if any sign-up surface initialises either flag to true. Pre-ticked or
/// uncheckable consent is dark-pattern territory under Planet49/EDPB, DPDP
/// Rules 2025 and CPRA alike; an "optional" box that arrives ticked is the
/// oldest one there is.
///
/// ⚠️ THE LINKS OPEN THE LIVE PAGES, not an in-app copy. `AppConfig.termsUrl` /
/// `privacyUrl` point at nikatru.com, which is the text the user is actually
/// bound by — an embedded copy is a second version of a legal document that
/// nothing keeps in step with the published one.
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
  /// legally required notice into a repeated sales prompt, and a user who
  /// already declined would be asked again on a screen they cannot leave. Their
  /// existing `marketing-email` artifact stands untouched.
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
          // ONE WHOLE SENTENCE PER KEY, and the two document links are separate
          // keys below it rather than spans inside it. A rich-text "I agree to
          // the [Terms] and [Privacy Policy]" fixes English word order and
          // leaves a translator splicing a link into the middle of a clause
          // whose verb belongs at the end — the same reasoning that turned
          // `newHerePrompt` into a complete line.
          label: l10n.legalAcceptTerms,
          links: <Widget>[
            _LegalLink(l10n.linkTermsShort, AppConfig.termsUrl),
            _LegalLink(l10n.linkPrivacyShort, AppConfig.privacyUrl),
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
    // The whole label is a tap target for the box — a 20 px square is below
    // every platform's minimum touch size, and a checkbox whose only hit area
    // is the box itself is the reason people tick the wrong one.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Checkbox(
          key: checkboxKey,
          value: value,
          onChanged: enabled ? (bool? v) => onChanged(v ?? false) : null,
        ),
        Expanded(
          child: GestureDetector(
            onTap: enabled ? () => onChanged(!value) : null,
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(label, style: theme.textTheme.bodyMedium),
                  if (links.isNotEmpty) ...<Widget>[
                    const SizedBox(height: 4),
                    Wrap(spacing: 16, runSpacing: 4, children: links),
                  ],
                ],
              ),
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

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      link: true,
      child: GestureDetector(
        onTap: () => openExternalUrl(url),
        child: Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.primary,
            fontWeight: FontWeight.w700,
            decoration: TextDecoration.underline,
          ),
        ),
      ),
    );
  }
}
