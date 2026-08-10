import 'package:flutter/material.dart';
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
    // The whole label is a tap target for the box: a 20 px square is below every
    // platform's minimum touch size, and a checkbox whose only hit area is the
    // box itself is how people tick the wrong one.
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
        onTap: () async {
          try {
            await launchUrl(
              Uri.parse(url),
              mode: LaunchMode.externalApplication,
            );
          } catch (_) {
            // Best-effort — a link that will not open must never break sign-up.
          }
        },
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
