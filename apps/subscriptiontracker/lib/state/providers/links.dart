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

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_external_links/nikatru_external_links.dart'
    show UrlLauncherExternalLinks;
import 'package:nikatru_purchases/nikatru_purchases.dart' show BillingSource;

import '../../core/app_config.dart';
import 'analytics_envelope.dart' show kPlatformBaseUrl;
import 'content_pack.dart' show serviceCatalogueProvider;

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
    // ⏱ 2026-10-01 · MO-03 / MO-05: Apple's standard EULA (the paywall of an
    // Apple build) and the two stores' own subscriptions pages (Manage plan,
    // for a plan bought in a store) — `BillingSource.manageUrl`.
    AppConfig.appleEulaUrl,
    for (final BillingSource s in BillingSource.values)
      ?s.manageUrl?.toString(),
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

/// The launcher for ONE subscription's "website to cancel" (ST truth pass,
/// DE-01): [appLinkPolicy] plus that one https URL, the same one-URL widening
/// [updateLinkLauncher] makes — the user typed the address and the API
/// validated it, so it is a destination this row names and no other. A
/// PROVIDER so a test sees which URL the detail screen opened.
final Provider<core.ExternalLinkLauncher Function(String url)>
websiteLinkLauncherProvider =
    Provider<core.ExternalLinkLauncher Function(String url)>(
      (ref) =>
          (String url) =>
              UrlLauncherExternalLinks(policy: appLinkPolicy.withHttpsUrl(url)),
    );

/// The calendar feed's launcher (ST-T4a client): [appLinkPolicy] plus the
/// platform host, for `webcal:` (a calendar app subscribes) and `https:` (web
/// downloads the file). A PROVIDER, unlike the two above, so a test can see
/// which URL "Add to calendar" opened without a platform channel.
final Provider<core.ExternalLinkLauncher> calendarLinkLauncherProvider =
    Provider<core.ExternalLinkLauncher>(
      (ref) => UrlLauncherExternalLinks(
        policy: appLinkPolicy.withCalendarFeedUrl(kPlatformBaseUrl),
      ),
    );

/// "How to cancel {name}"'s launcher (DE-06): [appLinkPolicy] plus the host
/// of every cancel and store-manage page the SERVICE CATALOGUE names — the
/// pack the store signed with the app, so the widening is content this build
/// already trusts, never a URL a user typed. A PROVIDER, like the calendar's,
/// so a test sees which link was opened without a platform channel.
final Provider<core.ExternalLinkLauncher> cancelLinkLauncherProvider =
    Provider<core.ExternalLinkLauncher>((ref) {
      core.LinkPolicy policy = appLinkPolicy;
      final core.ServiceCatalogue? catalogue = ref
          .watch(serviceCatalogueProvider('en'))
          .value;
      for (final core.ServiceEntry e
          in catalogue?.entries ?? const <core.ServiceEntry>[]) {
        policy = policy
            .withHttpsUrl(e.cancelUrl.toString())
            .withHttpsUrl(e.playManageUrl.toString())
            .withHttpsUrl(e.appStoreManageUrl.toString());
      }
      return UrlLauncherExternalLinks(policy: policy);
    });
