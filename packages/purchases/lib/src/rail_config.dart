import 'package:flutter/foundation.dart' show immutable;

import 'offering.dart';

/// Everything the client needs to sell, as the RAIL declares it — the resolved
/// `paywall` block of the CFG-1 config document.
///
/// ## Why the URLs are TEMPLATES supplied by configuration
/// The merchant of record's hosted-checkout URL shape is a **vendor fact this
/// repo has not verified against a primary source** — the research note that
/// carries a `_ptxn=` query parameter is dated 2026-07-28 and has never been
/// re-fetched, and no seller account exists to check it against (OWNER_QUEUE
/// A-1, PENDING). Encoding a guessed URL shape would produce a checkout button
/// that opens a 404 for the first real buyer, and the failure would be invisible
/// until then.
///
/// So the shape is not encoded anywhere in this repo. It arrives as a template
/// the owner pastes out of the seller console, and this package substitutes
/// placeholders it defines itself. When the template is ABSENT — which is the
/// state today — [checkoutUrlTemplate] is null, [canCheckout] is false, and the
/// paywall says so instead of opening something.
@immutable
class RailConfig {
  const RailConfig({
    required this.offerings,
    required this.checkoutUrlTemplate,
    required this.manageUrlTemplate,
  });

  /// Nothing to sell, no way to sell it. The resolved value whenever the config
  /// document has no `paywall` block, or has one nobody can read.
  static const RailConfig empty = RailConfig(
    offerings: <Offering>[],
    checkoutUrlTemplate: null,
    manageUrlTemplate: null,
  );

  /// Plans in the order the rail listed them. Unreadable entries are dropped by
  /// [Offering.tryFromJson], so this list holds only sellable plans.
  final List<Offering> offerings;

  /// The hosted checkout, with `{price_id}`, `{account_id}`, `{app_id}` and
  /// `{return_url}` placeholders. Null until the owner supplies it.
  final String? checkoutUrlTemplate;

  /// The merchant of record's own subscription-management page, with the same
  /// placeholders. Used by the cancel flow as the second half of the ROSCA path
  /// — the first half is a real request to our own host. Null until supplied.
  final String? manageUrlTemplate;

  /// Whether a checkout can be started at all from a configuration standpoint.
  /// The platform's own answer is [PurchaseCapabilities.canStartCheckout], and
  /// BOTH have to be true.
  bool get canCheckout =>
      offerings.isNotEmpty && (checkoutUrlTemplate?.isNotEmpty ?? false);

  /// The longest free trial any plan offers, in days. 0 when none do.
  ///
  /// Read by CI, not only by the UI: `assert-purchase-path.mjs` compares the
  /// entitlement staleness ceiling against this, because a bound longer than the
  /// trial lets a user cancel on the last trial day and keep access past it.
  int get longestTrialDays => offerings.fold<int>(
    0,
    (int m, Offering o) => o.trialDays > m ? o.trialDays : m,
  );

  /// Parses `AppConfig.paywall.extra`.
  ///
  /// Every field is optional and every failure is silent-and-closed: a rail we
  /// cannot read is a rail that sells nothing, which is the same state as a rail
  /// nobody has configured, and both are honestly representable in the UI.
  static RailConfig fromPaywallExtra(Map<String, Object?> extra) {
    final Object? raw = extra['offerings'];
    final List<Offering> offerings = <Offering>[];
    if (raw is List) {
      for (final Object? e in raw) {
        final Offering? o = Offering.tryFromJson(e);
        if (o != null) offerings.add(o);
      }
    }
    return RailConfig(
      offerings: offerings,
      checkoutUrlTemplate: _url(extra['checkout_url_template']),
      manageUrlTemplate: _url(extra['manage_url_template']),
    );
  }

  /// 🔒 HTTPS OR NOTHING. A template is a string from a config document served
  /// over the network, and it ends up in a platform `launchUrl` call — i.e. it
  /// is an instruction to the operating system. Anything that is not an
  /// absolute `https:` URL is refused here rather than at the call site, so no
  /// caller has to remember: `javascript:`, `file:`, `intent:` and a bare
  /// relative path are all rejected by the same test.
  static String? _url(Object? v) {
    if (v is! String || v.isEmpty) return null;
    final Uri? u = Uri.tryParse(v);
    if (u == null || u.scheme != 'https' || u.host.isEmpty) return null;
    return v;
  }

  /// Fills the placeholders this package defines. Values are percent-encoded, so
  /// an account id or a return URL can never break out of its parameter.
  ///
  /// Returns null when [template] is null — a caller that forgot to check
  /// [canCheckout] gets nothing to launch rather than a URL with the literal
  /// text `{price_id}` in it.
  static String? fill(
    String? template, {
    required String appId,
    required String priceId,
    required String accountId,
    required String returnUrl,
  }) {
    if (template == null || template.isEmpty) return null;
    return template
        .replaceAll('{app_id}', Uri.encodeComponent(appId))
        .replaceAll('{price_id}', Uri.encodeComponent(priceId))
        // 🔒 [pipeline 5]M-7. The buyer's account id rides in the checkout URL
        // so the merchant of record echoes it back on the notification and the
        // payment resolves to a person. Without it every purchase arrives
        // unclaimed and the buyer pays for an unlock nobody can grant them.
        .replaceAll('{account_id}', Uri.encodeComponent(accountId))
        .replaceAll('{return_url}', Uri.encodeComponent(returnUrl));
  }
}
