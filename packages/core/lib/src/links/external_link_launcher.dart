/// The external-link seam — O-LINK-LAUNCHER-SEAM-UNOWNED.
///
/// Pure Dart, provider-free, like every other seam in `core`. The concrete
/// implementation wraps `url_launcher` and lives in `packages/external_links`,
/// which is the one place outside the money rail that imports the plugin.
/// `packages/purchases`' `CheckoutLauncher` is a different seam on purpose: it
/// opens hosted checkout pages, https-only, and refuses `mailto:` by design.
library;

/// What came of asking for a link to open.
///
/// Three outcomes, because a caller is owed the difference between "the
/// platform could not" and "this app would not".
enum LinkOutcome {
  /// Handed to the platform, which accepted it. Whether a browser or mail
  /// client then drew anything is not something any platform reports.
  opened,

  /// Allowed by the policy, and the platform declined or failed: no handler
  /// for the scheme, a blocked popup, a missing plugin. Nothing was shown.
  notOpened,

  /// Refused by the `LinkPolicy` before anything reached the platform.
  refused,
}

/// Opens an external link in the platform's own browser or mail client.
///
/// An implementation checks every [Uri] against a `LinkPolicy` before it
/// reaches the platform, so a caller holding this interface cannot open a
/// link the app's configuration does not name.
abstract interface class ExternalLinkLauncher {
  /// Opens [uri], or says why it did not. Never throws: a link that will not
  /// open must never crash the screen that offered it.
  Future<LinkOutcome> open(Uri uri);
}

/// [ExternalLinkLauncher.open] over a string, which every configured URL is.
extension ExternalLinkLauncherUrl on ExternalLinkLauncher {
  /// Parses [url] and opens it. A string that is not a URI is [LinkOutcome.refused].
  Future<LinkOutcome> openUrl(String url) async {
    final Uri? uri = Uri.tryParse(url.trim());
    if (uri == null) return LinkOutcome.refused;
    return open(uri);
  }
}
