import 'package:flutter/material.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_core/nikatru_core.dart' show ExternalLinkLauncherUrl;

import '../../core/app_config.dart';
import '../../state/providers.dart' show externalLinks;

/// The two consent tick boxes — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]), including
/// the whole argument for why terms and marketing are two different legal
/// animals and why neither may ever arrive ticked. What stays here is the ONE
/// thing that could not travel: the URLs and the call that opens them.
///
/// 🔴 THE LAUNCHER IS WHY, AND IT IS A MEASURED BOUNDARY RATHER THAN A
/// PREFERENCE. `packages/chassis_screens` declares no plugin, so it stays a
/// plain widget library and never becomes an adapter under
/// `assert-package-boundaries.mjs` limb C. The call lives here and goes through
/// the app's ONE `externalLinks` launcher (lib/state/providers.dart), whose
/// policy admits the legal pages `app_config.dart` names. ⏱ 2026-09-24: the
/// dated `brick|url_launcher` bypass this file used to lean on is deleted
/// (O-LINK-LAUNCHER-SEAM-UNOWNED).
///
/// ⚠️ AND THIS WIDGET IS STILL MOUNTED, not merely still present. `SignUpScreen`
/// and `ReacceptTermsScreen` hand their chassis views a `ConsentFieldsBuilder`
/// that builds THIS class, so the render tree is unchanged. Letting the package
/// build its own boxes would have left a file the guards can `existsSync` and a
/// widget nothing renders — which the stamped probe caught immediately, on the
/// brick's own `find.descendant(of: LegalConsentFields, matching: FocusableTap)`.
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
  final bool showMarketing;

  static const Key termsCheckbox = LegalConsentFieldsView.termsCheckbox;
  static const Key marketingCheckbox = LegalConsentFieldsView.marketingCheckbox;

  /// Best-effort — a link that will not open must never break sign-up. A
  /// refusal or a missing handler reads as not opened, never as a throw, so
  /// the consent is still takeable.
  static Future<void> _open(String url) async {
    await externalLinks.openUrl(url);
  }

  @override
  Widget build(BuildContext context) => LegalConsentFieldsView(
    termsAccepted: termsAccepted,
    marketingAccepted: marketingAccepted,
    onTermsChanged: onTermsChanged,
    onMarketingChanged: onMarketingChanged,
    // ⚠️ THE LINKS OPEN THE LIVE PAGES. `AppConfig.termsUrl` / `privacyUrl` are
    // the text the user is bound by; an embedded copy is a second version of a
    // legal document that nothing keeps in step with the published one.
    onOpenTerms: () => _open(AppConfig.termsUrl),
    onOpenPrivacy: () => _open(AppConfig.privacyUrl),
    enabled: enabled,
    showMarketing: showMarketing,
  );
}
