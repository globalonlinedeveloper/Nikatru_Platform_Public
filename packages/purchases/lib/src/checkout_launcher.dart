import 'package:flutter/foundation.dart' show debugPrint;
import 'package:url_launcher/url_launcher.dart'
    show LaunchMode, canLaunchUrl, launchUrl;

/// Opens an external checkout page — the one platform call in this package.
///
/// A seam rather than a direct `launchUrl`, and the reason is [pipeline 5]M-6's
/// acceptance: *for every platform the adapter marks supported, a test asserts
/// the launcher opens the provider's checkout URL*. A test cannot observe a real
/// browser opening, so the assertion has to land on something injectable. With
/// `launchUrl` called inline there is no such thing, and "the checkout opens" is
/// a claim nobody can check on any platform — which is how a paywall ships with
/// a button that does nothing.
abstract interface class CheckoutLauncher {
  /// Returns whether the page was handed to the platform. FALSE is a real
  /// outcome, not an exception: a web build with a popup blocker and a Linux box
  /// with no `xdg-open` both fail here, and the paywall must say so rather than
  /// sit on a spinner.
  Future<bool> open(Uri url);
}

/// The real one: `url_launcher`, external application, no in-app webview.
///
/// 🔒 [LaunchMode.externalApplication] IS A SECURITY CHOICE, not a preference.
/// A payment page must render in the user's own browser with its own address bar
/// and its own certificate indicator. Rendering somebody's card form inside a
/// webview we control removes every signal a buyer has for telling a real
/// checkout from a page that merely looks like one — and it is what the card
/// networks' own guidance exists to prevent.
class UrlCheckoutLauncher implements CheckoutLauncher {
  const UrlCheckoutLauncher();

  @override
  Future<bool> open(Uri url) async {
    // 🔴 SECOND LINE OF DEFENCE. RailConfig._url already refuses anything that
    // is not absolute https, so this cannot normally fire — but this method
    // hands a string to the operating system, and the cost of the two checks
    // disagreeing is `launchUrl` executing a `javascript:` or `file:` URL that
    // arrived in a config document. A guard at the syscall is worth its
    // redundancy.
    if (url.scheme != 'https') {
      debugPrint('[purchases] refused to open a non-https checkout URL');
      return false;
    }
    try {
      if (!await canLaunchUrl(url)) return false;
      return await launchUrl(url, mode: LaunchMode.externalApplication);
    } catch (e) {
      // A MissingPluginException on an unexpected platform, or a PlatformException
      // from a desktop with no handler registered. Both mean "it did not open",
      // which the caller already handles; neither is worth crashing a paywall.
      debugPrint('[purchases] checkout launch failed: $e');
      return false;
    }
  }
}
