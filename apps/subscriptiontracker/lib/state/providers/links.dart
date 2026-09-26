// SECTION · EXTERNAL LINKS (O-LINK-LAUNCHER-SEAM-UNOWNED). Re-exported from
// `../providers.dart`.
//
// 🔴 THE ONE PLACE THIS APP BUILDS AN `ExternalLinkLauncher`. The legal pages,
// the site, the contact page, the support mailto and the force-update
// destination all open through what this file constructs; `url_launcher` itself
// is imported only by `packages/external_links`, which checks each link against
// the policy below before the plugin is touched.
//
// ⚠️ TOP-LEVEL VALUES, NOT PROVIDERS, and that is deliberate: `openExternalUrl`
// is called from widgets that are pumped WITHOUT a ProviderScope
// (`test/consent_clickwrap_a11y_test.dart`, the footer parity test), and the
// tests observe the launch at the PLATFORM CHANNEL, which is unchanged.

import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_external_links/nikatru_external_links.dart'
    show UrlLauncherExternalLinks;

import '../../core/app_config.dart';

/// Every link this app's configuration names, and its one support address.
/// A constant that is not absolute https widens nothing
/// (`core.LinkPolicy.fromUrls`).
final core.LinkPolicy appLinkPolicy = core.LinkPolicy.fromUrls(
  httpsUrls: <String>[
    AppConfig.companyUrl,
    AppConfig.privacyUrl,
    AppConfig.termsUrl,
    AppConfig.refundUrl,
    AppConfig.contactUrl,
    AppConfig.updateUrl,
  ],
  supportEmail: AppConfig.supportEmail,
);

/// The launcher every screen opens a link through.
final core.ExternalLinkLauncher externalLinks = UrlLauncherExternalLinks(
  policy: appLinkPolicy,
);

/// The force-update wall's launcher: [appLinkPolicy] plus the ONE destination
/// the config resolved.
///
/// 🔴 NOT [externalLinks]. Owner decision #19 made `update_url` RUNTIME config
/// so the wall can send users somewhere new without shipping the build it
/// exists to replace; a fixed host list would freeze that destination at build
/// time again. The widening is exactly one https URL, and only this wall uses it.
core.ExternalLinkLauncher updateLinkLauncher(String resolvedUpdateUrl) =>
    UrlLauncherExternalLinks(
      policy: appLinkPolicy.withHttpsUrl(resolvedUpdateUrl),
    );
