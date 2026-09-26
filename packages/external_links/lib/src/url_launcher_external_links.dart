import 'package:flutter/foundation.dart' show debugPrint;
import 'package:nikatru_core/nikatru_core.dart'
    show ExternalLinkLauncher, LinkOutcome, LinkPolicy, LinkVerdict;
import 'package:url_launcher/url_launcher.dart' show LaunchMode, launchUrl;

/// The real [ExternalLinkLauncher]: [policy] first, then `url_launcher`,
/// external application, no in-app webview.
///
/// 🔴 THE POLICY IS A REQUIRED ARGUMENT, not an optional one with a permissive
/// default. A launcher that can be built without a policy is one somebody will
/// build without a policy, and then every string a screen passes goes straight
/// to the operating system — the state both apps were in before this seam.
///
/// 🔒 [LaunchMode.externalApplication] for the same reason `CheckoutLauncher`
/// uses it: a legal page or a store listing renders in the user's own browser,
/// with its own address bar, never inside a webview this app controls.
class UrlLauncherExternalLinks implements ExternalLinkLauncher {
  const UrlLauncherExternalLinks({required this.policy});

  /// Which links this launcher may open. Checked before the plugin is touched.
  final LinkPolicy policy;

  @override
  Future<LinkOutcome> open(Uri uri) async {
    final LinkVerdict verdict = policy.check(uri);
    if (!verdict.allowed) {
      // The reason names a scheme or a host and never an address, so it is
      // safe in a device log.
      debugPrint('[external_links] refused: ${verdict.reason}');
      return LinkOutcome.refused;
    }
    try {
      final bool opened = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      return opened ? LinkOutcome.opened : LinkOutcome.notOpened;
    } catch (e) {
      // A MissingPluginException where no implementation is registered, or a
      // PlatformException from a platform with no handler for the scheme. Both
      // mean "it did not open". Only the type is logged: a platform message can
      // carry the URL, and a mailto URL carries an address.
      debugPrint('[external_links] launch failed: ${e.runtimeType}');
      return LinkOutcome.notOpened;
    }
  }
}
